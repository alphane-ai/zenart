import type {
  AbuseControlHook,
  AbuseEvent,
  AbuseQueueRuntimeEntry,
  AbuseRuntimeDecision,
  AdminRole
} from "@/lib/types";

const roleRank: Record<AdminRole, number> = {
  support_operator: 1,
  admin_viewer: 1,
  admin_operator: 2,
  admin_reviewer: 3,
  admin_superadmin: 4
};

function roleCanExecute(attemptedRole: AdminRole, requiredRole: AdminRole) {
  return roleRank[attemptedRole] >= roleRank[requiredRole];
}

function parseFixtureTime(value: string) {
  if (value === "pending") {
    return Number.POSITIVE_INFINITY;
  }

  const iso = value.includes("T") ? value : `${value.replace(" ", "T")}:00Z`;
  return Date.parse(iso);
}

function eventQueueAction(event: AbuseEvent, hook: AbuseControlHook): AbuseRuntimeDecision["queueAction"] {
  if (event.severity === "critical" || event.category === "hidden_prompt_extraction") {
    return "escalate_security_review";
  }

  if (hook.action === "temporary_hold" || hook.action === "quota_hold") {
    return "hold_until_release_evidence";
  }

  if (hook.action === "rate_limit" || hook.action === "crawler_import_hold") {
    return "throttle_until_review";
  }

  return "no_action";
}

export function buildAbuseRuntimeDecisions(
  events: AbuseEvent[],
  hooks: AbuseControlHook[],
  now: Date = new Date()
): AbuseRuntimeDecision[] {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const evaluatedAt = now.toISOString();
  const nowMs = now.getTime();

  return hooks.map((hook) => {
    const event = eventsById.get(hook.abuseEventId);
    const allowedByRole = roleCanExecute(hook.attemptedRole, hook.requiredRole);
    const expired = parseFixtureTime(hook.expiresAt) <= nowMs;
    const released = hook.state === "released";
    const expiryLifecycle: AbuseRuntimeDecision["expiryLifecycle"] =
      !allowedByRole || hook.rbacDecision === "denied"
        ? "dry_run_not_enforced"
        : released
          ? "released_after_evidence"
          : expired
            ? "expired_requires_release_evidence"
            : "within_window";
    const base = {
      hookId: hook.id,
      abuseEventId: hook.abuseEventId,
      userId: hook.userId,
      action: hook.action,
      enforcementPoint: hook.enforcementPoint,
      evaluatedAt,
      expiryLifecycle,
      userVisibleState: hook.userVisibleState,
      requiredRole: hook.requiredRole,
      attemptedRole: hook.attemptedRole,
      rbacDecision: hook.rbacDecision,
      expiresAt: hook.expiresAt,
      auditRef: hook.auditRef,
      evidenceRefs: hook.evidenceRefs,
      releaseEvidenceRefs: hook.releaseEvidenceRefs,
      rationale: event
        ? `${event.reviewRationale} ${hook.releaseCondition}`
        : `Missing abuse event ${hook.abuseEventId}; keep hook non-enforcing until fixture linkage is repaired.`
    };

    if (!allowedByRole || hook.rbacDecision === "denied") {
      return {
        ...base,
        runtimeStatus: "dry_run_denied",
        requestOutcome: "dry_run_only",
        queueAction: event ? eventQueueAction(event, hook) : "no_action",
        canCreateQuotaConsumingTask: true
      };
    }

    if (released) {
      return {
        ...base,
        runtimeStatus: "released",
        requestOutcome: "allow",
        queueAction: "release_after_evidence",
        canCreateQuotaConsumingTask: true
      };
    }

    if (expired) {
      return {
        ...base,
        runtimeStatus: "expired",
        requestOutcome: "allow_read_only",
        queueAction: "release_after_evidence",
        canCreateQuotaConsumingTask: false
      };
    }

    if (hook.executionMode === "enforced" && hook.action === "temporary_hold") {
      return {
        ...base,
        runtimeStatus: "enforced",
        requestOutcome: "deny_423_account_hold",
        queueAction: event ? eventQueueAction(event, hook) : "hold_until_release_evidence",
        canCreateQuotaConsumingTask: false
      };
    }

    if (
      hook.executionMode === "enforced" &&
      (hook.action === "rate_limit" || hook.action === "crawler_import_hold" || hook.action === "quota_hold")
    ) {
      return {
        ...base,
        runtimeStatus: "enforced",
        requestOutcome: "throttle_429_rate_limited",
        queueAction: event ? eventQueueAction(event, hook) : "throttle_until_review",
        canCreateQuotaConsumingTask: false
      };
    }

    return {
      ...base,
      runtimeStatus: "dry_run_denied",
      requestOutcome: "dry_run_only",
      queueAction: event ? eventQueueAction(event, hook) : "no_action",
      canCreateQuotaConsumingTask: true
    };
  });
}

export function buildAbuseQueueRuntime(
  events: AbuseEvent[],
  decisions: AbuseRuntimeDecision[]
): AbuseQueueRuntimeEntry[] {
  return events.map((event) => {
    const eventDecisions = decisions.filter((decision) => decision.abuseEventId === event.id);
    const enforced = eventDecisions.filter((decision) => decision.runtimeStatus === "enforced");
    const deniedByRbac = eventDecisions.some((decision) => decision.runtimeStatus === "dry_run_denied");
    const activeHookIds = enforced.map((decision) => decision.hookId);
    const releaseEvidenceRefs = new Set(eventDecisions.flatMap((decision) => decision.releaseEvidenceRefs));
    const observedEvidenceRefs = new Set(
      eventDecisions.flatMap((decision) => [decision.auditRef, ...decision.evidenceRefs])
    );
    const missingReleaseEvidenceRefs = [...releaseEvidenceRefs].filter((ref) => !observedEvidenceRefs.has(ref));
    const releaseEvidenceStatus = missingReleaseEvidenceRefs.length === 0 ? "complete" : "missing";
    const criticalOpen = event.severity === "critical" && event.resolution === "open";

    if (deniedByRbac || criticalOpen || releaseEvidenceStatus === "missing") {
      return {
        abuseEventId: event.id,
        userId: event.userId,
        category: event.category,
        severity: event.severity,
        assignedRole: event.assignedRole,
        runtimeStatus: deniedByRbac ? "blocked_by_rbac" : enforced.length > 0 ? "controlled" : "queued_for_review",
        activeHookIds,
        releaseEvidenceStatus,
        missingReleaseEvidenceRefs,
        closureAllowed: false,
        blockingReason:
          releaseEvidenceStatus === "missing"
            ? `Queue closure is blocked until release evidence refs are present in runtime evidence: ${missingReleaseEvidenceRefs.join(", ")}.`
            : "Queue closure requires the assigned role, immutable audit, release evidence, and second review for critical abuse.",
        nextAction:
          releaseEvidenceStatus === "missing"
            ? "Keep the abuse queue item open and attach the missing support, audit, trace, export, or crawler evidence before release."
            : "Escalate to the assigned admin role and keep the abuse queue item open until release evidence is attached.",
        auditRef: event.auditRef
      };
    }

    if (enforced.length > 0) {
      return {
        abuseEventId: event.id,
        userId: event.userId,
        category: event.category,
        severity: event.severity,
        assignedRole: event.assignedRole,
        runtimeStatus: "controlled",
        activeHookIds,
        releaseEvidenceStatus,
        missingReleaseEvidenceRefs,
        closureAllowed: false,
        blockingReason: "Control is active; closure waits for the hook release condition and support or audit evidence.",
        nextAction: "Hold the queue item in review and preserve the active runtime hook until release evidence passes.",
        auditRef: event.auditRef
      };
    }

    return {
      abuseEventId: event.id,
      userId: event.userId,
      category: event.category,
      severity: event.severity,
      assignedRole: event.assignedRole,
      runtimeStatus: "queued_for_review",
      activeHookIds,
      releaseEvidenceStatus,
      missingReleaseEvidenceRefs,
      closureAllowed: false,
      blockingReason: "No enforced control is active; operator review must attach a hook or release rationale.",
      nextAction: "Keep the abuse queue item open and require an operator runtime control decision.",
      auditRef: event.auditRef
    };
  });
}
