import type {
  AbuseControlHook,
  FailedTaskControl,
  FailedTaskRuntimeDecision,
  FailedTaskSubmissionContract,
  SupportTicket
} from "@/lib/types";

const requiredClosureEvidenceCount = 4;
const supportedAppVersion = "admin-0.0.0";
const supportedSchemaVersion = "task.v1";
const supportedWorkerVersions = new Set(["worker-2026.05.26", "crawler-2026.05.26"]);
const roleRank: Record<FailedTaskControl["requestedByRole"], number> = {
  support_operator: 1,
  admin_operator: 2,
  admin_reviewer: 3,
  admin_superadmin: 4
};

function idempotencyStatus(task: FailedTaskControl): FailedTaskRuntimeDecision["idempotencyStatus"] {
  const [action, taskId, supportTicketId, reason] = task.idempotencyKey.split(":");

  return action === task.requestedAction &&
    taskId === task.id &&
    supportTicketId === task.supportTicketId &&
    typeof reason === "string" &&
    reason.trim().length > 0
    ? "stable"
    : "unstable";
}

function stateDigestStatus(task: FailedTaskControl): FailedTaskRuntimeDecision["stateDigestStatus"] {
  return task.preActionStateDigest === task.observedStateDigest ? "stable" : "stale_replay";
}

function supportTicketLinkageStatus(
  task: FailedTaskControl,
  ticket: SupportTicket | undefined
): FailedTaskRuntimeDecision["supportTicketLinkageStatus"] {
  if (!ticket) {
    return "missing_ticket";
  }

  return ticket.taskId === task.id ? "linked" : "mismatched_ticket";
}

function tenantScopeStatus(
  task: FailedTaskControl,
  ticket: SupportTicket | undefined
): FailedTaskRuntimeDecision["tenantScopeStatus"] {
  return ticket && ticket.userId === task.userId && ticket.projectId === task.projectId
    ? "linked"
    : "mismatched_tenant_scope";
}

function traceLinkageStatus(
  task: FailedTaskControl,
  ticket: SupportTicket | undefined
): FailedTaskRuntimeDecision["traceLinkageStatus"] {
  if (task.traceId === "none" && ticket?.traceId === "none") {
    return "not_required";
  }

  return ticket && ticket.traceId === task.traceId ? "linked" : "mismatched_trace";
}

function stateTransition(
  task: FailedTaskControl,
  submitDecision: FailedTaskRuntimeDecision["submitDecision"]
): FailedTaskRuntimeDecision["stateTransition"] {
  if (task.requestedAction === "retry") {
    return submitDecision === "submit_ready" ? "failed_to_retrying_after_submit" : "failed_retry_preserved";
  }

  if (task.requestedAction === "cancel") {
    return submitDecision === "submit_ready" ? "cancelled_closure_ready" : "cancelled_state_preserved_pending_review";
  }

  return "blocked_state_preserved";
}

function closureOutcome(
  task: FailedTaskControl,
  submitDecision: FailedTaskRuntimeDecision["submitDecision"]
): FailedTaskRuntimeDecision["closureOutcome"] {
  if (task.requestedAction === "retry") {
    return submitDecision === "submit_ready" ? "retry_submits_with_audit" : "retry_blocked_until_evidence";
  }

  if (task.requestedAction === "cancel") {
    return submitDecision === "submit_ready" ? "cancel_submits_with_audit" : "cancel_requires_second_review";
  }

  return "hold_blocked_until_policy_review";
}

function releaseGateDisposition(
  task: FailedTaskControl,
  submitDecision: FailedTaskRuntimeDecision["submitDecision"],
  regressionFixtureStatus: FailedTaskRuntimeDecision["regressionFixtureStatus"]
): FailedTaskRuntimeDecision["releaseGateDisposition"] {
  if (regressionFixtureStatus !== "declared") {
    return "blocked_not_regression_fixture";
  }

  return submitDecision === "submit_ready"
    ? "converted_regression_fixture"
    : "eval_gate_preserved_by_regression_fixture";
}

function regressionFixtureStatus(
  task: FailedTaskControl,
  regressionFixturePathSet: Set<string> | undefined
): FailedTaskRuntimeDecision["regressionFixtureStatus"] {
  if (!task.regressionFixtureRef.startsWith("fixtures/")) {
    return "not_required";
  }

  return regressionFixturePathSet?.has(task.regressionFixtureRef) === false ? "missing" : "declared";
}

function secondReviewDistinctnessStatus(
  task: FailedTaskControl
): FailedTaskRuntimeDecision["secondReviewDistinctnessStatus"] {
  if (!task.secondReviewRequired) {
    return "not_required";
  }

  if (task.secondReviewerAdminId === "none" || task.secondReviewerAdminId.trim().length === 0) {
    return "missing_reviewer";
  }

  return task.secondReviewerAdminId === task.requestedByAdminId ? "same_reviewer" : "distinct_reviewer";
}

function secondReviewEvidenceStatus(
  task: FailedTaskControl
): FailedTaskRuntimeDecision["secondReviewEvidenceStatus"] {
  if (!task.secondReviewRequired) {
    return "not_required";
  }

  return task.secondReviewEvidenceRefs.length >= 3 &&
    task.secondReviewAuditRef !== "none" &&
    task.secondReviewEvidenceRefs.includes(task.secondReviewAuditRef)
    ? "complete"
    : "incomplete";
}

function abuseControlStatus(
  task: FailedTaskControl,
  hooksById: Map<string, AbuseControlHook>
): Pick<FailedTaskRuntimeDecision, "abuseControlStatus" | "abuseControlEvidence"> {
  if (task.abuseControlHookRefs.length === 0) {
    return {
      abuseControlStatus: "clear",
      abuseControlEvidence: "hooks:none"
    };
  }

  const hookEvidence = task.abuseControlHookRefs.map((hookRef) => {
    const hook = hooksById.get(hookRef);

    if (!hook) {
      return `${hookRef}:missing`;
    }

    const userScope = hook.userId === task.userId ? "same_user" : "mismatched_user";
    return `${hook.id}:${hook.action}:${hook.state}:${hook.executionMode}:${hook.enforcementPoint}:${userScope}`;
  });

  if (hookEvidence.some((entry) => entry.endsWith(":missing"))) {
    return {
      abuseControlStatus: "missing_hook_evidence",
      abuseControlEvidence: hookEvidence.join("; ")
    };
  }

  if (hookEvidence.some((entry) => entry.endsWith(":mismatched_user"))) {
    return {
      abuseControlStatus: "mismatched_hook_user",
      abuseControlEvidence: hookEvidence.join("; ")
    };
  }

  const hooks = task.abuseControlHookRefs.map((hookRef) => hooksById.get(hookRef)).filter(Boolean) as AbuseControlHook[];

  if (hooks.some((hook) => hook.state === "active" && hook.executionMode === "enforced")) {
    return {
      abuseControlStatus: "active_enforced",
      abuseControlEvidence: hookEvidence.join("; ")
    };
  }

  if (hooks.some((hook) => hook.executionMode === "dry_run" || hook.state === "armed")) {
    return {
      abuseControlStatus: "dry_run_only",
      abuseControlEvidence: hookEvidence.join("; ")
    };
  }

  return {
    abuseControlStatus: "expired_or_released",
    abuseControlEvidence: hookEvidence.join("; ")
  };
}

export function buildFailedTaskRuntimeDecisions(
  tasks: FailedTaskControl[],
  supportTickets: SupportTicket[] = [],
  regressionFixturePaths?: string[],
  abuseControlHooks: AbuseControlHook[] = []
): FailedTaskRuntimeDecision[] {
  const supportTicketsById = new Map<string, SupportTicket>(supportTickets.map((ticket) => [ticket.id, ticket]));
  const regressionFixturePathSet = regressionFixturePaths ? new Set(regressionFixturePaths) : undefined;
  const abuseControlHooksById = new Map<string, AbuseControlHook>(abuseControlHooks.map((hook) => [hook.id, hook]));

  return tasks.map((task) => {
    const linkedSupportTicket = supportTicketsById.get(task.supportTicketId);
    const blockerCodes: string[] = [];
    const retryBudgetStatus =
      task.requestedAction === "retry"
        ? task.retryCount < task.maxRetries
          ? "available"
          : "exhausted"
        : "not_retry";
    const closureEvidenceStatus =
      task.closureEvidenceRefs.length >= requiredClosureEvidenceCount ? "complete" : "incomplete";
    const rbacEvidenceStatus = task.rbacEvidenceRefs.length > 0 ? "complete" : "missing";
    const userMessageStatus = task.userMessage.trim().length > 0 ? "ready" : "missing";
    const computedIdempotencyStatus = idempotencyStatus(task);
    const computedStateDigestStatus = stateDigestStatus(task);
    const stateDigestEvidence = `pre:${task.preActionStateDigest}; observed:${task.observedStateDigest}`;
    const appCompatibilityStatus = task.appVersion === supportedAppVersion ? "compatible" : "stale";
    const workerCompatibilityStatus = supportedWorkerVersions.has(task.workerVersion) ? "compatible" : "stale";
    const schemaCompatibilityStatus = task.schemaVersion === supportedSchemaVersion ? "compatible" : "stale";
    const compatibilityStatus =
      appCompatibilityStatus === "compatible" &&
      workerCompatibilityStatus === "compatible" &&
      schemaCompatibilityStatus === "compatible"
        ? "compatible"
        : "stale";
    const compatibilityEvidence =
      `app:${task.appVersion}; worker:${task.workerVersion}; schema:${task.schemaVersion}`;
    const computedSupportTicketLinkageStatus = supportTicketLinkageStatus(task, linkedSupportTicket);
    const supportTicketLinkageEvidence = linkedSupportTicket
      ? `ticket:${linkedSupportTicket.id}; task:${linkedSupportTicket.taskId}; expectedTask:${task.id}`
      : `ticket:${task.supportTicketId}; task:missing; expectedTask:${task.id}`;
    const computedTenantScopeStatus = tenantScopeStatus(task, linkedSupportTicket);
    const tenantScopeEvidence = linkedSupportTicket
      ? `ticketUser:${linkedSupportTicket.userId}; taskUser:${task.userId}; ticketProject:${linkedSupportTicket.projectId}; taskProject:${task.projectId}`
      : `ticket:missing; taskUser:${task.userId}; taskProject:${task.projectId}`;
    const computedTraceLinkageStatus = traceLinkageStatus(task, linkedSupportTicket);
    const traceLinkageEvidence = linkedSupportTicket
      ? `ticketTrace:${linkedSupportTicket.traceId}; taskTrace:${task.traceId}`
      : `ticketTrace:missing; taskTrace:${task.traceId}`;
    const computedRegressionFixtureStatus = regressionFixtureStatus(task, regressionFixturePathSet);
    const regressionFixtureEvidence =
      computedRegressionFixtureStatus === "declared"
        ? `fixture:${task.regressionFixtureRef}; inventory:declared`
        : computedRegressionFixtureStatus === "missing"
          ? `fixture:${task.regressionFixtureRef}; inventory:missing`
          : `fixture:${task.regressionFixtureRef}; inventory:not-required`;
    const roleAuthorizationStatus =
      roleRank[task.requestedByRole] >= roleRank[task.allowedRole] ? "sufficient" : "insufficient";
    const roleAuthorizationEvidence = `requested:${task.requestedByRole}; required:${task.allowedRole}`;
    const computedSecondReviewDistinctnessStatus = secondReviewDistinctnessStatus(task);
    const computedSecondReviewEvidenceStatus = secondReviewEvidenceStatus(task);
    const computedAbuseControl = abuseControlStatus(task, abuseControlHooksById);
    const secondReviewEvidence =
      task.secondReviewRequired
        ? `status:${task.secondReviewStatus}; requester:${task.requestedByAdminId}; reviewer:${task.secondReviewerAdminId}; audit:${task.secondReviewAuditRef}; refs:${task.secondReviewEvidenceRefs.join("|")}`
        : `status:not_required; requester:${task.requestedByAdminId}; reviewer:none; audit:none; refs:none`;

    if (task.actionEligibility === "blocked") {
      blockerCodes.push("action_blocked");
    }

    if (task.requestedAction === "retry" && retryBudgetStatus === "exhausted") {
      blockerCodes.push("retry_budget_exhausted");
    }

    if (task.rbacDecision === "denied") {
      blockerCodes.push("rbac_denied");
    }

    if (task.rbacDecision === "allowed" && roleAuthorizationStatus === "insufficient") {
      blockerCodes.push("role_authorization_insufficient");
    }

    if (task.rbacDecision === "second_review_required" && !task.secondReviewRequired) {
      blockerCodes.push("second_review_contract_missing");
    }

    if (task.secondReviewRequired && task.secondReviewStatus === "approved") {
      if (computedSecondReviewDistinctnessStatus !== "distinct_reviewer") {
        blockerCodes.push("second_review_distinct_reviewer_missing");
      }

      if (computedSecondReviewEvidenceStatus !== "complete") {
        blockerCodes.push("second_review_evidence_incomplete");
      }
    }

    if (task.secondReviewRequired && task.secondReviewStatus === "rejected") {
      blockerCodes.push("second_review_rejected");
    }

    if (task.secondReviewRequired && task.secondReviewStatus === "expired") {
      blockerCodes.push("second_review_expired");
    }

    if (closureEvidenceStatus === "incomplete") {
      blockerCodes.push("closure_evidence_incomplete");
    }

    if (rbacEvidenceStatus === "missing") {
      blockerCodes.push("rbac_evidence_missing");
    }

    if (userMessageStatus === "missing") {
      blockerCodes.push("user_message_missing");
    }

    if (computedIdempotencyStatus === "unstable") {
      blockerCodes.push("idempotency_key_unstable");
    }

    if (computedStateDigestStatus === "stale_replay") {
      blockerCodes.push("state_digest_stale_replay");
    }

    if (compatibilityStatus === "stale") {
      blockerCodes.push("version_compatibility_stale");
    }

    if (appCompatibilityStatus === "stale") {
      blockerCodes.push("app_version_stale");
    }

    if (workerCompatibilityStatus === "stale") {
      blockerCodes.push("worker_version_stale");
    }

    if (schemaCompatibilityStatus === "stale") {
      blockerCodes.push("schema_version_stale");
    }

    if (computedSupportTicketLinkageStatus === "missing_ticket") {
      blockerCodes.push("support_ticket_missing");
    }

    if (computedSupportTicketLinkageStatus === "mismatched_ticket") {
      blockerCodes.push("support_ticket_task_mismatch");
    }

    if (computedTenantScopeStatus === "mismatched_tenant_scope") {
      blockerCodes.push("support_ticket_user_project_mismatch");
    }

    if (computedTraceLinkageStatus === "mismatched_trace") {
      blockerCodes.push("support_ticket_trace_mismatch");
    }

    if (computedRegressionFixtureStatus === "missing") {
      blockerCodes.push("regression_fixture_missing");
    }

    if (computedAbuseControl.abuseControlStatus === "missing_hook_evidence") {
      blockerCodes.push("abuse_control_hook_missing");
    }

    if (computedAbuseControl.abuseControlStatus === "mismatched_hook_user") {
      blockerCodes.push("abuse_control_user_mismatch");
    }

    if (task.requestedAction === "retry" && computedAbuseControl.abuseControlStatus === "active_enforced") {
      blockerCodes.push("active_abuse_control_blocks_retry");
    }

    if (
      task.requestedAction === "cancel" &&
      task.actionEligibility === "eligible" &&
      task.secondReviewStatus === "approved" &&
      computedAbuseControl.abuseControlStatus === "active_enforced"
    ) {
      blockerCodes.push("active_abuse_control_blocks_cancel");
    }

    const hardBlockers = new Set([
      "action_blocked",
      "retry_budget_exhausted",
      "rbac_denied",
      "role_authorization_insufficient",
      "closure_evidence_incomplete",
      "rbac_evidence_missing",
      "user_message_missing",
      "idempotency_key_unstable",
      "state_digest_stale_replay",
      "version_compatibility_stale",
      "app_version_stale",
      "worker_version_stale",
      "schema_version_stale",
      "support_ticket_missing",
      "support_ticket_task_mismatch",
      "support_ticket_user_project_mismatch",
      "support_ticket_trace_mismatch",
      "second_review_contract_missing",
      "second_review_distinct_reviewer_missing",
      "second_review_evidence_incomplete",
      "second_review_rejected",
      "second_review_expired",
      "regression_fixture_missing",
      "abuse_control_hook_missing",
      "abuse_control_user_mismatch",
      "active_abuse_control_blocks_retry",
      "active_abuse_control_blocks_cancel"
    ]);
    const submitDecision =
      blockerCodes.some((code) => hardBlockers.has(code))
        ? "blocked"
        : task.actionEligibility === "requires_review" || task.rbacDecision === "second_review_required"
          ? "review_required"
          : "submit_ready";

    const submitDisabledReason =
      submitDecision === "submit_ready"
        ? "Action can be submitted with stable idempotency and attached audit evidence."
        : blockerCodes.length > 0
          ? blockerCodes.join(", ")
          : "Second review must be attached before the action can be submitted.";

    const operatorAction =
      submitDecision === "submit_ready"
        ? `Submit ${task.requestedAction}, preserve the idempotency key, settle quota as ${task.quotaEffect}, and attach audit ${task.auditRef}.`
        : submitDecision === "review_required"
          ? "Route to the required reviewer, preserve the idempotency key, and keep the user message visible."
          : "Keep submission disabled and resolve the blocking evidence before retry, cancel, or hold.";
    const computedStateTransition = stateTransition(task, submitDecision);
    const computedClosureOutcome = closureOutcome(task, submitDecision);
    const computedReleaseGateDisposition = releaseGateDisposition(
      task,
      submitDecision,
      computedRegressionFixtureStatus
    );
    const apiOutcome =
      task.requestedAction === "retry"
        ? submitDecision === "submit_ready"
          ? "post_retry_202_accepted"
          : "disabled_409_conflict"
        : task.requestedAction === "cancel"
          ? submitDecision === "submit_ready"
            ? "post_cancel_202_cancelled"
            : submitDecision === "review_required"
              ? "post_cancel_202_review_required"
              : "disabled_409_conflict"
          : "disabled_423_hold";
    const quotaLedgerEffect =
      task.quotaEffect === "reserved_credit_released"
        ? "release_reserved_credit_once"
        : task.quotaEffect === "refund_pending"
          ? "refund_pending_until_audit"
          : task.quotaEffect === "refund_on_cancel"
            ? "refund_on_cancel_after_review"
            : "no_quota_mutation";
    const auditWritePolicy =
      submitDecision === "submit_ready"
        ? "write_submit_audit_before_queue_mutation"
        : submitDecision === "review_required"
          ? "write_review_audit_before_cancel_closure"
          : "write_blocked_attempt_audit";
    const regressionGateEffect =
      computedReleaseGateDisposition === "converted_regression_fixture"
        ? "canary_fixture_ready"
        : computedReleaseGateDisposition === "eval_gate_preserved_by_regression_fixture"
          ? "canary_fixture_blocks_until_review"
          : "no_regression_fixture_blocks_release";

    return {
      taskId: task.id,
      queueId: task.queueId,
      supportTicketId: task.supportTicketId,
      requestedAction: task.requestedAction,
      submitDecision,
      stateTransition: computedStateTransition,
      closureOutcome: computedClosureOutcome,
      releaseGateDisposition: computedReleaseGateDisposition,
      regressionFixtureStatus: computedRegressionFixtureStatus,
      regressionFixtureEvidence,
      abuseControlStatus: computedAbuseControl.abuseControlStatus,
      abuseControlEvidence: computedAbuseControl.abuseControlEvidence,
      retryBudgetStatus,
      rbacStatus: task.rbacDecision,
      roleAuthorizationStatus,
      roleAuthorizationEvidence,
      secondReviewStatus: task.secondReviewStatus,
      secondReviewDistinctnessStatus: computedSecondReviewDistinctnessStatus,
      secondReviewEvidenceStatus: computedSecondReviewEvidenceStatus,
      secondReviewEvidence,
      secondReviewAuditRef: task.secondReviewAuditRef,
      quotaSettlement: task.quotaEffect,
      idempotencyKey: task.idempotencyKey,
      idempotencyStatus: computedIdempotencyStatus,
      stateDigestStatus: computedStateDigestStatus,
      stateDigestEvidence,
      appCompatibilityStatus,
      workerCompatibilityStatus,
      schemaCompatibilityStatus,
      compatibilityStatus,
      compatibilityEvidence,
      supportTicketLinkageStatus: computedSupportTicketLinkageStatus,
      supportTicketLinkageEvidence,
      tenantScopeStatus: computedTenantScopeStatus,
      tenantScopeEvidence,
      traceLinkageStatus: computedTraceLinkageStatus,
      traceLinkageEvidence,
      apiOutcome,
      quotaLedgerEffect,
      supportNoticeStatus: userMessageStatus,
      auditWritePolicy,
      regressionGateEffect,
      closureEvidenceStatus,
      rbacEvidenceStatus,
      rbacEvidenceRefs: task.rbacEvidenceRefs,
      userMessageStatus,
      blockerCodes,
      submitDisabledReason,
      operatorAction,
      auditRef: task.auditRef
    };
  });
}

export function buildFailedTaskSubmissionContracts(
  tasks: FailedTaskControl[],
  decisions: FailedTaskRuntimeDecision[]
): FailedTaskSubmissionContract[] {
  const taskById = new Map<string, FailedTaskControl>(tasks.map((task) => [task.id, task]));

  return decisions.map((decision) => {
    const task = taskById.get(decision.taskId);
    const submitEnabled = decision.submitDecision === "submit_ready";
    const reviewHold = decision.submitDecision === "review_required";
    const requestPath = `/api/admin/tasks/${decision.taskId}/${decision.requestedAction}`;
    const requiredHeaders = [
      "X-Admin-CSRF",
      "Idempotency-Key",
      "If-Match",
      "X-Support-Ticket",
      "X-Admin-Audit-Ref",
      "X-Abuse-Control-Refs"
    ];
    const mutationOrder = submitEnabled
      ? "audit_then_queue_mutation"
      : reviewHold
        ? "audit_then_review_hold"
        : "blocked_attempt_audit_only";
    const releaseGateUse =
      decision.regressionGateEffect === "canary_fixture_ready"
        ? "release_evidence_candidate"
        : decision.regressionGateEffect === "canary_fixture_blocks_until_review"
          ? "preserve_eval_gate"
          : "not_release_evidence";
    const replayProtection =
      submitEnabled &&
      decision.idempotencyStatus === "stable" &&
      decision.stateDigestStatus === "stable" &&
      decision.blockerCodes.length === 0
        ? "stable_idempotent_precondition"
        : "blocked_replay_or_unstable_key";
    const evidenceRefs = [
      decision.taskId,
      decision.supportTicketId,
      decision.queueId,
      decision.auditRef,
      ...(task?.abuseControlHookRefs ?? []),
      ...(decision.secondReviewAuditRef === "none" ? [] : [decision.secondReviewAuditRef]),
      ...decision.rbacEvidenceRefs,
      ...(task?.closureEvidenceRefs ?? [])
    ];
    const secondReviewHeader =
      decision.secondReviewEvidenceStatus === "not_required"
        ? "X-Admin-Second-Review: not_required"
        : `X-Admin-Second-Review: ${decision.secondReviewStatus}; ${decision.secondReviewEvidence}`;

    return {
      taskId: decision.taskId,
      queueId: decision.queueId,
      requestedAction: decision.requestedAction,
      requestMethod: "POST",
      requestPath,
      submitEnabled,
      submitDecision: decision.submitDecision,
      apiOutcome: decision.apiOutcome,
      csrfScope: "admin_session_cookie",
      requiredHeaders,
      idempotencyKey: decision.idempotencyKey,
      idempotencyHeaderStatus: decision.idempotencyStatus,
      preconditionHeader: decision.stateDigestEvidence,
      preconditionDigestStatus: decision.stateDigestStatus,
      supportTicketId: decision.supportTicketId,
      abuseControlHeader: `X-Abuse-Control-Refs: ${(task?.abuseControlHookRefs ?? []).join(",") || "none"}; ${decision.abuseControlStatus}; ${decision.abuseControlEvidence}`,
      abuseControlStatus: decision.abuseControlStatus,
      responseContract: `${decision.apiOutcome}; ${decision.stateTransition}; ${decision.closureOutcome}`,
      mutationOrder,
      quotaLedgerEffect: decision.quotaLedgerEffect,
      releaseGateUse,
      replayProtection,
      secondReviewStatus: decision.secondReviewStatus,
      secondReviewEvidenceStatus: decision.secondReviewEvidenceStatus,
      secondReviewHeader,
      evidenceRefs: [...new Set(evidenceRefs)],
      blockerCodes: decision.blockerCodes,
      operatorAction: decision.operatorAction,
      auditRef: decision.auditRef
    };
  });
}
