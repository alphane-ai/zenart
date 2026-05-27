import type {
  AdminRbacEvidence,
  AdminRbacClosureMatrixRow,
  AdminRbacEvidencePack,
  AdminRbacOverrideAttempt,
  AdminRbacOverrideAttemptDecision,
  AdminRbacOverrideReleaseBundle,
  AdminRbacReleaseEvidenceMatrixRow,
  AdminRbacReleaseEvidenceClosure,
  AdminRbacReleaseReadinessSummary,
  AdminRbacRuntimeDecision,
  AdminRbacStaleReplayDecision,
  AdminRbacSurfaceSummary,
  AdminRole
} from "@/lib/types";

const roleRank: Record<AdminRole, number> = {
  support_operator: 1,
  admin_viewer: 1,
  admin_operator: 2,
  admin_reviewer: 3,
  admin_superadmin: 4
};

function isExpired(expiresAt: string, now: Date) {
  if (expiresAt === "none") {
    return false;
  }

  const normalized = expiresAt.replace(" ", "T");
  return new Date(`${normalized}:00Z`).getTime() <= now.getTime();
}

function hasSufficientRole(item: AdminRbacEvidence) {
  return roleRank[item.attemptedRole] >= roleRank[item.requiredRole];
}

function highestRole(roles: AdminRole[]) {
  return roles.reduce((highest, role) => (roleRank[role] > roleRank[highest] ? role : highest), roles[0]);
}

function expiryPolicyStatus(item: AdminRbacEvidence, expired: boolean) {
  if (item.overrideDurationPolicy === "non_expiring_policy_block") {
    return "non_expiring_policy_block";
  }

  if (item.overrideDurationPolicy === "second_review_deadline") {
    return expired ? "expired_temporary_window" : "second_review_deadline_open";
  }

  return expired ? "expired_temporary_window" : "valid_temporary_window";
}

function overrideWindow(item: AdminRbacEvidence, expired: boolean) {
  if (item.overrideDurationPolicy === "non_expiring_policy_block") {
    return "policy_block";
  }

  return expired ? "expired" : "active";
}

function buildBlockerCodes(item: AdminRbacEvidence, sufficientRole: boolean, expired: boolean, secondReviewOpen: boolean) {
  const blockerCodes: string[] = [];

  if (expired && item.expiryEnforced) {
    blockerCodes.push("expired_override_window");
  }

  if (!sufficientRole) {
    blockerCodes.push("insufficient_role");
  }

  if (secondReviewOpen) {
    blockerCodes.push("second_review_open");
  }

  if (item.decision === "denied" || item.mutationOutcome === "blocked_no_mutation") {
    blockerCodes.push("policy_or_gate_denied");
  }

  return blockerCodes;
}

export function buildAdminRbacRuntimeDecisions(
  evidence: AdminRbacEvidence[],
  now: Date
): AdminRbacRuntimeDecision[] {
  return evidence.map((item) => {
    const sufficientRole = hasSufficientRole(item);
    const expired = isExpired(item.overrideExpiresAt, now);
    const policyStatus = expiryPolicyStatus(item, expired);
    const windowStatus = overrideWindow(item, expired);
    const evaluatedAt = now.toISOString();
    const secondReviewOpen =
      item.secondReviewRequired &&
      (item.secondReviewStatus === "required" || item.secondReviewStatus === "blocked");
    const roleGateStatus = sufficientRole ? "sufficient" : "insufficient";
    const blockerCodes = buildBlockerCodes(item, sufficientRole, expired, secondReviewOpen);

    if (expired && item.expiryEnforced) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        requestedAction: item.requestedAction,
        enforcementPoint: item.enforcementPoint,
        requiredRole: item.requiredRole,
        attemptedRole: item.attemptedRole,
        roleGateStatus,
        secondReviewStatus: item.secondReviewStatus,
        expiryPolicyStatus: policyStatus,
        overrideWindow: windowStatus,
        effectiveDecision: "deny_mutation",
        requestOutcome: "denied_expired_override",
        mutationAllowed: false,
        queueAction: "block_and_preserve_state",
        releaseGateStatus: "release_gate_preserved",
        evaluatedAt,
        preOverrideState: item.preOverrideState,
        expiryAction: item.expiryAction,
        staleOverrideProbe: item.staleOverrideProbe,
        blockerCodes,
        auditRef: item.auditRef,
        evidenceRefs: item.evidenceRefs,
        rationale: `${item.enforcementPoint} denied ${item.requestedAction} because the temporary override expired at ${item.overrideExpiresAt}; ${item.expiryAction} ${item.postDecisionControl}`
      };
    }

    if (!sufficientRole) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        requestedAction: item.requestedAction,
        enforcementPoint: item.enforcementPoint,
        requiredRole: item.requiredRole,
        attemptedRole: item.attemptedRole,
        roleGateStatus,
        secondReviewStatus: item.secondReviewStatus,
        expiryPolicyStatus: policyStatus,
        overrideWindow: windowStatus,
        effectiveDecision: "deny_mutation",
        requestOutcome: "denied_insufficient_role",
        mutationAllowed: false,
        queueAction: "block_and_preserve_state",
        releaseGateStatus: "release_gate_preserved",
        evaluatedAt,
        preOverrideState: item.preOverrideState,
        expiryAction: item.expiryAction,
        staleOverrideProbe: item.staleOverrideProbe,
        blockerCodes,
        auditRef: item.auditRef,
        evidenceRefs: item.evidenceRefs,
        rationale: `${item.enforcementPoint} denied ${item.requestedAction} because ${item.attemptedRole} is below ${item.requiredRole}; ${item.postDecisionControl}`
      };
    }

    if (item.decision === "second_review_required" || (item.decision !== "denied" && secondReviewOpen)) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        requestedAction: item.requestedAction,
        enforcementPoint: item.enforcementPoint,
        requiredRole: item.requiredRole,
        attemptedRole: item.attemptedRole,
        roleGateStatus,
        secondReviewStatus: item.secondReviewStatus,
        expiryPolicyStatus: policyStatus,
        overrideWindow: windowStatus,
        effectiveDecision: "queue_for_review",
        requestOutcome: "queued_second_review",
        mutationAllowed: false,
        queueAction: "hold_for_second_review",
        releaseGateStatus: "canary_or_release_blocked",
        evaluatedAt,
        preOverrideState: item.preOverrideState,
        expiryAction: item.expiryAction,
        staleOverrideProbe: item.staleOverrideProbe,
        blockerCodes,
        auditRef: item.auditRef,
        evidenceRefs: item.evidenceRefs,
        rationale: `${item.enforcementPoint} queued ${item.requestedAction} for second review; ${item.releaseGateImpact} ${item.postDecisionControl}`
      };
    }

    if (item.decision === "denied" || item.mutationOutcome === "blocked_no_mutation") {
      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        requestedAction: item.requestedAction,
        enforcementPoint: item.enforcementPoint,
        requiredRole: item.requiredRole,
        attemptedRole: item.attemptedRole,
        roleGateStatus,
        secondReviewStatus: item.secondReviewStatus,
        expiryPolicyStatus: policyStatus,
        overrideWindow: windowStatus,
        effectiveDecision: "deny_mutation",
        requestOutcome: "denied_policy_block",
        mutationAllowed: false,
        queueAction: "block_and_preserve_state",
        releaseGateStatus: "release_gate_preserved",
        evaluatedAt,
        preOverrideState: item.preOverrideState,
        expiryAction: item.expiryAction,
        staleOverrideProbe: item.staleOverrideProbe,
        blockerCodes,
        auditRef: item.auditRef,
        evidenceRefs: item.evidenceRefs,
        rationale: `${item.enforcementPoint} preserved the block for ${item.requestedAction}; ${item.rationale} ${item.postDecisionControl}`
      };
    }

    return {
      evidenceId: item.id,
      surface: item.surface,
      overrideScope: item.overrideScope,
      target: item.target,
      requestedAction: item.requestedAction,
      enforcementPoint: item.enforcementPoint,
      requiredRole: item.requiredRole,
      attemptedRole: item.attemptedRole,
      roleGateStatus,
      secondReviewStatus: item.secondReviewStatus,
      expiryPolicyStatus: policyStatus,
      overrideWindow: windowStatus,
      effectiveDecision: "allow_mutation",
      requestOutcome: "applied",
      mutationAllowed: true,
      queueAction: "apply_with_expiry",
      releaseGateStatus: "runtime_override_applied_with_expiry",
      evaluatedAt,
      preOverrideState: item.preOverrideState,
      expiryAction: item.expiryAction,
      staleOverrideProbe: item.staleOverrideProbe,
      blockerCodes,
      auditRef: item.auditRef,
      evidenceRefs: item.evidenceRefs,
      rationale: `${item.enforcementPoint} applied ${item.requestedAction} with expiry ${item.overrideExpiresAt}; ${item.runtimeCheck} ${item.expiryAction}`
    };
  });
}

export function buildAdminRbacStaleReplayDecisions(
  evidence: AdminRbacEvidence[],
  runtimeDecisions: AdminRbacRuntimeDecision[],
  replayAt: Date
): AdminRbacStaleReplayDecision[] {
  const decisionByEvidenceId = new Map(runtimeDecisions.map((decision) => [decision.evidenceId, decision]));

  return evidence
    .filter(
      (item) =>
        item.overrideDurationPolicy === "non_expiring_policy_block" ||
        (item.expiryEnforced && isExpired(item.overrideExpiresAt, replayAt))
    )
    .map((item) => {
      const runtimeDecision = decisionByEvidenceId.get(item.id);
      const isPolicyBlock = item.overrideDurationPolicy === "non_expiring_policy_block";
      const staleOutcome: AdminRbacStaleReplayDecision["staleOutcome"] = isPolicyBlock
        ? "policy_block_preserved"
        : "blocked_stale_replay";
      const staleWindowStatus: AdminRbacStaleReplayDecision["staleWindowStatus"] = isPolicyBlock
        ? "policy_block"
        : "expired";
      const releaseGateStatus: AdminRbacStaleReplayDecision["releaseGateStatus"] = "release_gate_preserved";

      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
        staleReplayAt: replayAt.toISOString(),
        originalOutcome: runtimeDecision?.requestOutcome ?? "denied_policy_block",
        staleOutcome,
        staleWindowStatus,
        releaseGateStatus,
        stateRestoration: isPolicyBlock
          ? `${item.enforcementPoint} keeps ${item.target} in its pre-override state because ${item.overrideDurationPolicy} forbids temporary mutation. ${item.postDecisionControl}`
          : `${item.enforcementPoint} rejects stale replay for ${item.target}, restores or preserves the pre-override state after ${item.overrideExpiresAt}, and requires a fresh audited request. ${item.expiryAction}`,
        evidenceRefs: item.evidenceRefs,
        auditRef: item.auditRef,
        operatorAction: isPolicyBlock
          ? "Preserve the policy block and route the operator to the documented safe path."
          : "Block stale replay, preserve the release gate, and require fresh runtime evidence before retry."
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface) || a.evidenceId.localeCompare(b.evidenceId));
}

function uniqueSorted<T extends string>(values: T[]) {
  return Array.from(new Set<T>(values)).sort();
}

function expectedIdempotencyPrefix(attempt: AdminRbacOverrideAttempt) {
  return `rbac:${attempt.surface}:${attempt.evidenceId}:`;
}

function stateDigestStatus(
  attempt: AdminRbacOverrideAttempt,
  runtimeDecision: AdminRbacRuntimeDecision | undefined
): AdminRbacOverrideAttemptDecision["stateDigestStatus"] {
  const stateChanged = attempt.preMutationStateDigest !== attempt.postMutationStateDigest;

  if (runtimeDecision?.effectiveDecision === "allow_mutation") {
    return stateChanged ? "mutation_recorded" : "mutation_missing";
  }

  return stateChanged ? "unexpected_mutation" : "mutation_preserved";
}

function overrideAttemptOutcome(
  attempt: AdminRbacOverrideAttempt,
  runtimeDecision: AdminRbacRuntimeDecision | undefined,
  idempotencyStable: boolean,
  digestStatus: AdminRbacOverrideAttemptDecision["stateDigestStatus"]
): AdminRbacOverrideAttemptDecision["requestOutcome"] {
  if (!runtimeDecision || !idempotencyStable || digestStatus === "unexpected_mutation" || digestStatus === "mutation_missing") {
    return "invalid_evidence";
  }

  if (runtimeDecision.requestOutcome === "applied") {
    return "mutation_applied";
  }

  if (runtimeDecision.requestOutcome === "queued_second_review") {
    return "queued_without_mutation";
  }

  if (runtimeDecision.requestOutcome === "denied_expired_override") {
    return "stale_replay_blocked";
  }

  return "blocked_without_mutation";
}

function overrideAttemptBlockers(
  runtimeDecision: AdminRbacRuntimeDecision | undefined,
  idempotencyStable: boolean,
  digestStatus: AdminRbacOverrideAttemptDecision["stateDigestStatus"],
  expectedHttpStatusMatches: boolean
) {
  const blockers = new Set(runtimeDecision?.blockerCodes ?? []);

  if (!runtimeDecision) {
    blockers.add("runtime_decision_missing");
  }

  if (!idempotencyStable) {
    blockers.add("idempotency_key_unstable");
  }

  if (digestStatus === "unexpected_mutation") {
    blockers.add("unexpected_state_mutation");
  }

  if (digestStatus === "mutation_missing") {
    blockers.add("allowed_mutation_missing");
  }

  if (!expectedHttpStatusMatches) {
    blockers.add("http_status_mismatch");
  }

  return Array.from(blockers).sort();
}

function overrideAttemptBindingBlockers(
  attempt: AdminRbacOverrideAttempt,
  runtimeDecision: AdminRbacRuntimeDecision | undefined
) {
  const blockers = new Set<string>();

  if (!runtimeDecision) {
    return Array.from(blockers);
  }

  if (attempt.surface !== runtimeDecision.surface) {
    blockers.add("request_attempt_surface_mismatch");
  }

  if (attempt.overrideScope !== runtimeDecision.overrideScope) {
    blockers.add("request_attempt_scope_mismatch");
  }

  if (attempt.auditRef !== runtimeDecision.auditRef) {
    blockers.add("request_attempt_audit_mismatch");
  }

  if (!attempt.evidenceRefs.includes(runtimeDecision.evidenceId)) {
    blockers.add("request_attempt_evidence_ref_missing");
  }

  return Array.from(blockers).sort();
}

export function buildAdminRbacOverrideAttemptDecisions(
  attempts: AdminRbacOverrideAttempt[],
  runtimeDecisions: AdminRbacRuntimeDecision[]
): AdminRbacOverrideAttemptDecision[] {
  const runtimeByEvidenceId = new Map(runtimeDecisions.map((decision) => [decision.evidenceId, decision]));

  return attempts
    .map((attempt) => {
      const runtimeDecision = runtimeByEvidenceId.get(attempt.evidenceId);
      const idempotencyStable = attempt.idempotencyKey.startsWith(expectedIdempotencyPrefix(attempt));
      const idempotencyStatus: AdminRbacOverrideAttemptDecision["idempotencyStatus"] = idempotencyStable
        ? "stable"
        : "unstable";
      const digestStatus = stateDigestStatus(attempt, runtimeDecision);
      const expectedHttpStatusMatches =
        (runtimeDecision?.requestOutcome === "applied" && attempt.expectedHttpStatus === 200) ||
        (runtimeDecision?.requestOutcome === "queued_second_review" && attempt.expectedHttpStatus === 202) ||
        (runtimeDecision?.requestOutcome === "denied_insufficient_role" && attempt.expectedHttpStatus === 403) ||
        (runtimeDecision?.requestOutcome === "denied_policy_block" && [403, 409, 423].includes(attempt.expectedHttpStatus)) ||
        (runtimeDecision?.requestOutcome === "denied_expired_override" && attempt.expectedHttpStatus === 410);
      const requestOutcome = overrideAttemptOutcome(attempt, runtimeDecision, idempotencyStable, digestStatus);
      const blockerCodes = overrideAttemptBlockers(
        runtimeDecision,
        idempotencyStable,
        digestStatus,
        expectedHttpStatusMatches
      );
      for (const blocker of overrideAttemptBindingBlockers(attempt, runtimeDecision)) {
        blockerCodes.push(blocker);
      }
      const runtimeRequestOutcome: AdminRbacOverrideAttemptDecision["runtimeRequestOutcome"] =
        runtimeDecision?.requestOutcome ?? "missing_runtime";
      const releaseGateStatus: AdminRbacOverrideAttemptDecision["releaseGateStatus"] =
        runtimeDecision?.releaseGateStatus ?? "release_gate_preserved";
      const submitAllowed =
        requestOutcome === "mutation_applied" &&
        blockerCodes.length === 0 &&
        runtimeDecision?.mutationAllowed === true &&
        !attempt.dryRunOnly;

      return {
        attemptId: attempt.id,
        evidenceId: attempt.evidenceId,
        surface: attempt.surface,
        overrideScope: attempt.overrideScope,
        requestId: attempt.requestId,
        idempotencyStatus,
        stateDigestStatus: digestStatus,
        requestOutcome,
        submitAllowed,
        expectedHttpStatus: attempt.expectedHttpStatus,
        runtimeRequestOutcome,
        releaseGateStatus,
        blockerCodes: uniqueSorted(blockerCodes),
        auditRef: attempt.auditRef,
        evidenceRefs: attempt.evidenceRefs,
        rationale: `${attempt.gatePreservation} ${attempt.mutationReplayPolicy} ${attempt.operatorMessage}`
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface) || a.attemptId.localeCompare(b.attemptId));
}

export function buildAdminRbacSurfaceSummaries(
  evidence: AdminRbacEvidence[],
  decisions: AdminRbacRuntimeDecision[]
): AdminRbacSurfaceSummary[] {
  const evidenceBySurface = new Map<AdminRbacEvidence["surface"], AdminRbacEvidence[]>();
  const decisionsBySurface = new Map<AdminRbacRuntimeDecision["surface"], AdminRbacRuntimeDecision[]>();

  for (const item of evidence) {
    evidenceBySurface.set(item.surface, [...(evidenceBySurface.get(item.surface) ?? []), item]);
  }

  for (const decision of decisions) {
    decisionsBySurface.set(decision.surface, [...(decisionsBySurface.get(decision.surface) ?? []), decision]);
  }

  return Array.from(evidenceBySurface.entries())
    .map(([surface, surfaceEvidence]) => {
      const surfaceDecisions = decisionsBySurface.get(surface) ?? [];
      const allowedMutations = surfaceDecisions.filter(
        (decision) => decision.effectiveDecision === "allow_mutation"
      ).length;
      const queuedSecondReview = surfaceDecisions.filter(
        (decision) => decision.effectiveDecision === "queue_for_review"
      ).length;
      const deniedMutations = surfaceDecisions.filter(
        (decision) => decision.effectiveDecision === "deny_mutation"
      ).length;
      const expiredOverrideDenials = surfaceDecisions.filter(
        (decision) => decision.requestOutcome === "denied_expired_override"
      ).length;
      const requiredEvidence = uniqueSorted(surfaceEvidence.flatMap((item) => item.releaseEvidenceRequired));
      const releaseGateStatuses = uniqueSorted(surfaceDecisions.map((decision) => decision.releaseGateStatus));

      let operatorAction = "Apply only inside the audited temporary window and keep expiry visible.";
      if (expiredOverrideDenials > 0) {
        operatorAction = "Block stale override, preserve the last audited state, and require a fresh request.";
      } else if (deniedMutations > 0) {
        operatorAction = "Preserve the release gate and route the operator to the required evidence path.";
      } else if (queuedSecondReview > 0) {
        operatorAction = "Hold mutation until the second reviewer and immutable audit evidence are attached.";
      }

      return {
        surface,
        overrideScope: surfaceEvidence[0].overrideScope,
        totalEvidence: surfaceEvidence.length,
        allowedMutations,
        queuedSecondReview,
        deniedMutations,
        expiredOverrideDenials,
        releaseGateStatuses,
        auditRefs: uniqueSorted(surfaceEvidence.map((item) => item.auditRef)),
        releaseEvidenceRequired: requiredEvidence,
        decisionSummary: [
          `${allowedMutations} applied`,
          `${queuedSecondReview} second-review hold`,
          `${deniedMutations} denied`,
          `${expiredOverrideDenials} expired denial`
        ].join("; "),
        operatorAction
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

function releaseGateDisposition(decisions: AdminRbacRuntimeDecision[]): AdminRbacEvidencePack["releaseGateDisposition"] {
  const statuses = new Set(decisions.map((decision) => decision.effectiveDecision));

  if (statuses.size > 1) {
    return "mixed_preserved";
  }

  if (statuses.has("allow_mutation")) {
    return "applied_with_expiry";
  }

  if (statuses.has("queue_for_review")) {
    return "held_for_second_review";
  }

  return "blocked_by_policy_or_role";
}

function evidenceCompleteness(
  surfaceEvidence: AdminRbacEvidence[],
  surfaceDecisions: AdminRbacRuntimeDecision[]
): AdminRbacEvidencePack["evidenceCompleteness"] {
  if (surfaceDecisions.length !== surfaceEvidence.length) {
    return "missing_runtime";
  }

  if (surfaceEvidence.some((item) => item.auditRef.length === 0 || item.auditRef === "none")) {
    return "missing_audit";
  }

  if (surfaceEvidence.some((item) => item.releaseEvidenceRequired.length === 0 || item.evidenceRefs.length === 0)) {
    return "missing_release_evidence";
  }

  return "complete";
}

function operatorChecklist(
  surfaceEvidence: AdminRbacEvidence[],
  surfaceDecisions: AdminRbacRuntimeDecision[]
) {
  const checklist = new Set<string>();

  if (surfaceDecisions.some((decision) => decision.requestOutcome === "denied_expired_override")) {
    checklist.add("Reopen with fresh runtime evidence before mutating.");
  }

  if (surfaceDecisions.some((decision) => decision.requestOutcome === "denied_insufficient_role")) {
    checklist.add("Escalate to the required admin role before retry.");
  }

  if (surfaceDecisions.some((decision) => decision.requestOutcome === "queued_second_review")) {
    checklist.add("Attach second-review rationale and immutable audit before release.");
  }

  if (surfaceDecisions.some((decision) => decision.requestOutcome === "denied_policy_block")) {
    checklist.add("Preserve the gate and use the documented safe path.");
  }

  if (surfaceDecisions.some((decision) => decision.requestOutcome === "applied")) {
    checklist.add("Track expiry restoration and release-gate blocker preservation.");
  }

  for (const requiredEvidence of uniqueSorted(surfaceEvidence.flatMap((item) => item.releaseEvidenceRequired))) {
    checklist.add(`Verify ${requiredEvidence}.`);
  }

  return Array.from(checklist);
}

function expiryEnforcementStatus(
  surfaceEvidence: AdminRbacEvidence[]
): AdminRbacEvidencePack["expiryEnforcementStatus"] {
  const temporaryEvidence = surfaceEvidence.filter(
    (item) => item.overrideDurationPolicy !== "non_expiring_policy_block"
  );
  const policyBlockEvidence = surfaceEvidence.filter(
    (item) => item.overrideDurationPolicy === "non_expiring_policy_block"
  );
  const temporaryWindowsEnforced = temporaryEvidence.every((item) => item.expiryEnforced);
  const policyBlocksUnenforced = policyBlockEvidence.every((item) => !item.expiryEnforced);

  if (!temporaryWindowsEnforced || !policyBlocksUnenforced) {
    return "missing_enforcement";
  }

  if (temporaryEvidence.length === 0) {
    return "policy_block_only";
  }

  if (policyBlockEvidence.length > 0) {
    return "mixed_enforcement";
  }

  return "all_enforced";
}

function closureDisposition(
  pack: AdminRbacEvidencePack
): AdminRbacClosureMatrixRow["closureDisposition"] {
  if (pack.releaseGateDisposition === "applied_with_expiry") {
    return "ready_for_release_use";
  }

  if (pack.releaseGateDisposition === "held_for_second_review") {
    return "preserved_by_second_review";
  }

  if (pack.releaseGateDisposition === "mixed_preserved") {
    return "preserved_by_mixed_runtime";
  }

  return "preserved_by_policy_or_role";
}

function secondReviewCoverage(pack: AdminRbacEvidencePack): AdminRbacClosureMatrixRow["secondReviewCoverage"] {
  if (pack.secondReviewStatuses.includes("required") || pack.secondReviewStatuses.includes("blocked")) {
    return "covered";
  }

  if (pack.secondReviewStatuses.includes("completed")) {
    return "covered";
  }

  if (pack.secondReviewStatuses.includes("not_required")) {
    return "not_required";
  }

  return "missing";
}

function expiryCoverage(pack: AdminRbacEvidencePack): AdminRbacClosureMatrixRow["expiryCoverage"] {
  if (pack.expiryEnforcementStatus === "all_enforced" || pack.expiryEnforcementStatus === "mixed_enforcement") {
    return "enforced";
  }

  if (pack.expiryEnforcementStatus === "policy_block_only") {
    return "policy_block";
  }

  return "missing";
}

function staleReplayCoverage(pack: AdminRbacEvidencePack): AdminRbacClosureMatrixRow["staleReplayCoverage"] {
  const replayRequired =
    pack.expiryStatuses.includes("expired_temporary_window") ||
    pack.expiryEnforcementStatus === "policy_block_only" ||
    pack.expiryEnforcementStatus === "mixed_enforcement";

  if (!replayRequired) {
    return "not_required";
  }

  return pack.staleReplayOutcomes.length > 0 ? "covered" : "missing";
}

function closureBlockerCodes(pack: AdminRbacEvidencePack, runtimeDecisions: AdminRbacRuntimeDecision[]) {
  const blockers = new Set<string>();

  for (const decision of runtimeDecisions) {
    for (const blocker of decision.blockerCodes) {
      blockers.add(blocker);
    }
  }

  if (pack.evidenceCompleteness !== "complete") {
    blockers.add(pack.evidenceCompleteness);
  }

  if (pack.expiryEnforcementStatus === "missing_enforcement") {
    blockers.add("expiry_enforcement_missing");
  }

  if (staleReplayCoverage(pack) === "missing") {
    blockers.add("stale_replay_missing");
  }

  return Array.from(blockers).sort();
}

export function buildAdminRbacClosureMatrix(
  evidencePacks: AdminRbacEvidencePack[],
  runtimeDecisions: AdminRbacRuntimeDecision[]
): AdminRbacClosureMatrixRow[] {
  const decisionsBySurface = new Map<AdminRbacRuntimeDecision["surface"], AdminRbacRuntimeDecision[]>();

  for (const decision of runtimeDecisions) {
    decisionsBySurface.set(decision.surface, [...(decisionsBySurface.get(decision.surface) ?? []), decision]);
  }

  return evidencePacks
    .map((pack) => {
      const surfaceRuntimeDecisions = decisionsBySurface.get(pack.surface) ?? [];
      const disposition = closureDisposition(pack);
      const blockerCodes = closureBlockerCodes(pack, surfaceRuntimeDecisions);
      const releaseGateStatus: AdminRbacClosureMatrixRow["releaseGateStatus"] =
        disposition === "ready_for_release_use" && blockerCodes.length === 0
          ? "release_use_allowed"
          : "release_gate_preserved";
      const roleGateCoverage: AdminRbacClosureMatrixRow["roleGateCoverage"] =
        pack.requiredRoles.length > 0 && pack.requestOutcomes.length > 0 ? "covered" : "missing";
      const auditCoverage: AdminRbacClosureMatrixRow["auditCoverage"] =
        pack.auditRefs.length > 0 && !pack.auditRefs.includes("none") ? "attached" : "missing";
      const releaseEvidenceCoverage: AdminRbacClosureMatrixRow["releaseEvidenceCoverage"] =
        pack.evidenceRefs.length > 0 && pack.evidenceCompleteness !== "missing_release_evidence"
          ? "attached"
          : "missing";

      return {
        surface: pack.surface,
        overrideScope: pack.overrideScope,
        evidenceIds: pack.evidenceIds,
        requiredRoles: pack.requiredRoles,
        runtimeOutcomes: pack.requestOutcomes,
        roleGateCoverage,
        secondReviewCoverage: secondReviewCoverage(pack),
        expiryCoverage: expiryCoverage(pack),
        staleReplayCoverage: staleReplayCoverage(pack),
        auditCoverage,
        releaseEvidenceCoverage,
        closureDisposition: disposition,
        releaseGateStatus,
        blockerCodes,
        operatorAction: pack.operatorChecklist.join(" ")
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

export function buildAdminRbacEvidencePacks(
  evidence: AdminRbacEvidence[],
  decisions: AdminRbacRuntimeDecision[],
  staleReplayDecisions: AdminRbacStaleReplayDecision[] = buildAdminRbacStaleReplayDecisions(
    evidence,
    decisions,
    new Date("2026-05-26T19:00:00Z")
  )
): AdminRbacEvidencePack[] {
  const evidenceBySurface = new Map<AdminRbacEvidence["surface"], AdminRbacEvidence[]>();
  const decisionsBySurface = new Map<AdminRbacRuntimeDecision["surface"], AdminRbacRuntimeDecision[]>();
  const staleReplaysBySurface = new Map<AdminRbacStaleReplayDecision["surface"], AdminRbacStaleReplayDecision[]>();

  for (const item of evidence) {
    evidenceBySurface.set(item.surface, [...(evidenceBySurface.get(item.surface) ?? []), item]);
  }

  for (const decision of decisions) {
    decisionsBySurface.set(decision.surface, [...(decisionsBySurface.get(decision.surface) ?? []), decision]);
  }

  for (const staleReplay of staleReplayDecisions) {
    staleReplaysBySurface.set(staleReplay.surface, [
      ...(staleReplaysBySurface.get(staleReplay.surface) ?? []),
      staleReplay
    ]);
  }

  return Array.from(evidenceBySurface.entries())
    .map(([surface, surfaceEvidence]) => {
      const surfaceDecisions = decisionsBySurface.get(surface) ?? [];
      const surfaceStaleReplays = staleReplaysBySurface.get(surface) ?? [];

      return {
        surface,
        overrideScope: surfaceEvidence[0].overrideScope,
        evidenceIds: uniqueSorted(surfaceEvidence.map((item) => item.id)),
        targets: uniqueSorted(surfaceEvidence.map((item) => item.target)),
        apiScopes: uniqueSorted(surfaceEvidence.map((item) => item.apiScope)),
        requiredRoles: uniqueSorted(surfaceEvidence.map((item) => item.requiredRole)),
        attemptedRoles: uniqueSorted(surfaceEvidence.map((item) => item.attemptedRole)),
        requestOutcomes: uniqueSorted(surfaceDecisions.map((decision) => decision.requestOutcome)),
        mutationDecisions: uniqueSorted(surfaceDecisions.map((decision) => decision.effectiveDecision)),
        releaseGateStatuses: uniqueSorted(surfaceDecisions.map((decision) => decision.releaseGateStatus)),
        expiryStatuses: uniqueSorted(surfaceDecisions.map((decision) => decision.expiryPolicyStatus)),
        expiryEnforcementStatus: expiryEnforcementStatus(surfaceEvidence),
        expiryEnforcedEvidenceIds: uniqueSorted(
          surfaceEvidence.filter((item) => item.expiryEnforced).map((item) => item.id)
        ),
        policyBlockEvidenceIds: uniqueSorted(
          surfaceEvidence
            .filter((item) => item.overrideDurationPolicy === "non_expiring_policy_block")
            .map((item) => item.id)
        ),
        secondReviewStatuses: uniqueSorted(surfaceEvidence.map((item) => item.secondReviewStatus)),
        auditRefs: uniqueSorted(surfaceEvidence.map((item) => item.auditRef)),
        evidenceRefs: uniqueSorted(surfaceEvidence.flatMap((item) => item.evidenceRefs)),
        staleReplayOutcomes: uniqueSorted(surfaceStaleReplays.map((staleReplay) => staleReplay.staleOutcome)),
        staleReplayEvidenceIds: uniqueSorted(surfaceStaleReplays.map((staleReplay) => staleReplay.evidenceId)),
        highestRequiredRole: highestRole(surfaceEvidence.map((item) => item.requiredRole)),
        releaseGateDisposition: releaseGateDisposition(surfaceDecisions),
        evidenceCompleteness: evidenceCompleteness(surfaceEvidence, surfaceDecisions),
        operatorChecklist: operatorChecklist(surfaceEvidence, surfaceDecisions)
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

function releaseEvidenceClosureStatus(
  pack: AdminRbacEvidencePack,
  attemptCoverage: AdminRbacReleaseEvidenceClosure["attemptCoverage"],
  staleReplayCoverage: AdminRbacReleaseEvidenceClosure["staleReplayCoverage"],
  releaseEvidenceStatus: AdminRbacReleaseEvidenceClosure["releaseEvidenceStatus"],
  attemptEvidenceStatus: AdminRbacReleaseEvidenceClosure["attemptEvidenceStatus"],
  releaseMutationAttemptStatus: AdminRbacReleaseEvidenceClosure["releaseMutationAttemptStatus"],
  staleReplayOutcomes: AdminRbacStaleReplayDecision["staleOutcome"][]
): AdminRbacReleaseEvidenceClosure["closureStatus"] {
  if (
    attemptCoverage === "missing" ||
    staleReplayCoverage === "missing" ||
    releaseEvidenceStatus === "missing" ||
    attemptEvidenceStatus !== "valid" ||
    releaseMutationAttemptStatus === "blocked"
  ) {
    return "missing_evidence";
  }

  if (
    pack.requestOutcomes.includes("denied_expired_override") ||
    staleReplayOutcomes.includes("blocked_stale_replay")
  ) {
    return "preserved_by_stale_replay";
  }

  if (pack.releaseGateDisposition === "applied_with_expiry") {
    return "release_ready_with_expiry";
  }

  if (pack.releaseGateDisposition === "held_for_second_review") {
    return "preserved_for_review";
  }

  return "preserved_by_policy";
}

export function buildAdminRbacReleaseEvidenceClosures(
  evidencePacks: AdminRbacEvidencePack[],
  attemptDecisions: AdminRbacOverrideAttemptDecision[],
  staleReplayDecisions: AdminRbacStaleReplayDecision[]
): AdminRbacReleaseEvidenceClosure[] {
  const attemptsBySurface = new Map<AdminRbacOverrideAttemptDecision["surface"], AdminRbacOverrideAttemptDecision[]>();
  const staleReplaysBySurface = new Map<AdminRbacStaleReplayDecision["surface"], AdminRbacStaleReplayDecision[]>();

  for (const attempt of attemptDecisions) {
    attemptsBySurface.set(attempt.surface, [...(attemptsBySurface.get(attempt.surface) ?? []), attempt]);
  }

  for (const staleReplay of staleReplayDecisions) {
    staleReplaysBySurface.set(staleReplay.surface, [
      ...(staleReplaysBySurface.get(staleReplay.surface) ?? []),
      staleReplay
    ]);
  }

  return evidencePacks
    .map((pack) => {
      const attempts = attemptsBySurface.get(pack.surface) ?? [];
      const staleReplays = staleReplaysBySurface.get(pack.surface) ?? [];
      const attemptCoverage: AdminRbacReleaseEvidenceClosure["attemptCoverage"] =
        pack.evidenceIds.every((id) => attempts.some((attempt) => attempt.evidenceId === id)) ? "covered" : "missing";
      const staleReplayRequired =
        staleReplays.length > 0 ||
        pack.expiryStatuses.includes("expired_temporary_window") ||
        pack.expiryEnforcementStatus === "policy_block_only" ||
        pack.expiryEnforcementStatus === "mixed_enforcement";
      const staleReplayCoverage: AdminRbacReleaseEvidenceClosure["staleReplayCoverage"] = staleReplayRequired
        ? pack.evidenceIds.some((id) => staleReplays.some((staleReplay) => staleReplay.evidenceId === id))
          ? "covered"
          : "missing"
        : "not_required";
      const releaseEvidenceStatus: AdminRbacReleaseEvidenceClosure["releaseEvidenceStatus"] =
        pack.evidenceCompleteness === "complete" && pack.evidenceRefs.length > 0 ? "attached" : "missing";
      const attemptBlockerCodes = uniqueSorted(attempts.flatMap((attempt) => attempt.blockerCodes));
      const attemptEvidenceStatus: AdminRbacReleaseEvidenceClosure["attemptEvidenceStatus"] =
        attemptCoverage === "covered" &&
        attempts.every(
          (attempt) =>
            attempt.idempotencyStatus === "stable" &&
            attempt.requestOutcome !== "invalid_evidence" &&
            attempt.stateDigestStatus !== "unexpected_mutation" &&
            attempt.stateDigestStatus !== "mutation_missing"
        )
          ? "valid"
          : attemptCoverage === "missing"
            ? "missing"
            : "invalid";
      const releaseMutationAttemptStatus: AdminRbacReleaseEvidenceClosure["releaseMutationAttemptStatus"] =
        pack.releaseGateDisposition === "applied_with_expiry"
          ? attempts.some((attempt) => attempt.submitAllowed && attempt.requestOutcome === "mutation_applied")
            ? "submittable"
            : "blocked"
          : "not_applicable";
      const closureStatus = releaseEvidenceClosureStatus(
        pack,
        attemptCoverage,
        staleReplayCoverage,
        releaseEvidenceStatus,
        attemptEvidenceStatus,
        releaseMutationAttemptStatus,
        staleReplays.map((staleReplay) => staleReplay.staleOutcome)
      );
      const releaseGateStatus: AdminRbacReleaseEvidenceClosure["releaseGateStatus"] =
        closureStatus === "release_ready_with_expiry" ? "release_use_allowed" : "release_gate_preserved";
      const closureEvidenceRefs = uniqueSorted([
        ...pack.evidenceRefs,
        ...attempts.flatMap((attempt) => attempt.evidenceRefs),
        ...staleReplays.flatMap((staleReplay) => staleReplay.evidenceRefs)
      ]);

      return {
        surface: pack.surface,
        overrideScope: pack.overrideScope,
        evidenceIds: pack.evidenceIds,
        attemptIds: uniqueSorted(attempts.map((attempt) => attempt.attemptId)),
        staleReplayEvidenceIds: uniqueSorted(staleReplays.map((staleReplay) => staleReplay.evidenceId)),
        closureEvidenceRefs,
        releaseEvidenceRequired: uniqueSorted(pack.operatorChecklist.filter((item) => item.startsWith("Verify "))),
        runtimeOutcomes: pack.requestOutcomes,
        attemptOutcomes: uniqueSorted(attempts.map((attempt) => attempt.requestOutcome)),
        staleReplayOutcomes: uniqueSorted(staleReplays.map((staleReplay) => staleReplay.staleOutcome)),
        auditRefs: pack.auditRefs,
        attemptCoverage,
        staleReplayCoverage,
        releaseEvidenceStatus,
        attemptEvidenceStatus,
        releaseMutationAttemptStatus,
        attemptBlockerCodes,
        releaseGateDisposition: pack.releaseGateDisposition,
        closureStatus,
        releaseGateStatus,
        operatorAction:
          closureStatus === "release_ready_with_expiry"
            ? "Allow only the audited temporary mutation and keep expiry restoration visible in release evidence."
            : "Preserve the release gate until request attempts, stale replay probes, audit refs, and required evidence stay attached."
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

function releaseReadinessMutationMode(
  closure: AdminRbacReleaseEvidenceClosure
): AdminRbacReleaseReadinessSummary["mutationMode"] {
  if (closure.closureStatus === "release_ready_with_expiry") {
    return "temporary_mutation";
  }

  if (closure.closureStatus === "preserved_by_stale_replay") {
    return closure.releaseGateDisposition === "mixed_preserved" ? "mixed_runtime" : "stale_replay_preserved";
  }

  if (closure.closureStatus === "preserved_for_review") {
    return "second_review_hold";
  }

  return "policy_block";
}

function releaseReadinessState(
  closure: AdminRbacReleaseEvidenceClosure
): AdminRbacReleaseReadinessSummary["readyState"] {
  if (closure.closureStatus === "missing_evidence") {
    return "missing_evidence";
  }

  return closure.releaseGateStatus === "release_use_allowed" ? "release_ready" : "gate_preserved";
}

function releaseReadinessRationale(closure: AdminRbacReleaseEvidenceClosure) {
  if (closure.closureStatus === "release_ready_with_expiry") {
    return `${closure.surface} has covered request attempts, attached release evidence, immutable audit refs, and only an audited temporary mutation may affect release state.`;
  }

  if (closure.closureStatus === "preserved_for_review") {
    return `${closure.surface} keeps release state unchanged because second-review evidence is still required before the requested high-risk mutation can proceed.`;
  }

  if (closure.closureStatus === "preserved_by_stale_replay") {
    return `${closure.surface} preserves the release gate because stale replay or expired-window evidence proves the prior override cannot keep mutating state.`;
  }

  if (closure.closureStatus === "preserved_by_policy") {
    return `${closure.surface} preserves the release gate because policy, role, or non-override-eligible evidence blocks mutation while audit refs stay attached.`;
  }

  return `${closure.surface} is missing request attempt, stale replay, audit, or release evidence and cannot be used for release decisions.`;
}

export function buildAdminRbacReleaseReadinessSummaries(
  closures: AdminRbacReleaseEvidenceClosure[],
  evidencePacks: AdminRbacEvidencePack[]
): AdminRbacReleaseReadinessSummary[] {
  const packBySurface = new Map(evidencePacks.map((pack) => [pack.surface, pack]));

  return closures
    .map((closure) => {
      const pack = packBySurface.get(closure.surface);

      return {
        surface: closure.surface,
        overrideScope: closure.overrideScope,
        readyState: releaseReadinessState(closure),
        mutationMode: releaseReadinessMutationMode(closure),
        evidenceIds: closure.evidenceIds,
        requiredRoles: pack?.requiredRoles ?? [],
        auditRefs: closure.auditRefs,
        closureEvidenceRefs: closure.closureEvidenceRefs,
        attemptCoverage: closure.attemptCoverage,
        staleReplayCoverage: closure.staleReplayCoverage,
        releaseEvidenceStatus: closure.releaseEvidenceStatus,
        attemptEvidenceStatus: closure.attemptEvidenceStatus,
        releaseMutationAttemptStatus: closure.releaseMutationAttemptStatus,
        attemptBlockerCodes: closure.attemptBlockerCodes,
        closureStatus: closure.closureStatus,
        releaseGateStatus: closure.releaseGateStatus,
        readinessRationale: releaseReadinessRationale(closure),
        operatorAction:
          closure.releaseGateStatus === "release_use_allowed"
            ? "Permit only the audited release mutation shown in this row and keep expiry restoration visible to reviewers."
            : "Keep release/crawler/prompt/provider/quota/safety/export state unchanged until this row shows release_ready with complete evidence."
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

function bundleGateVerdict(
  readiness: AdminRbacReleaseReadinessSummary,
  closure: AdminRbacReleaseEvidenceClosure
): AdminRbacOverrideReleaseBundle["gateVerdict"] {
  if (readiness.readyState === "missing_evidence") {
    return "missing_evidence";
  }

  if (closure.closureStatus === "release_ready_with_expiry") {
    return "release_ready_with_expiry";
  }

  if (closure.closureStatus === "preserved_for_review") {
    return "gate_preserved_by_review";
  }

  if (closure.closureStatus === "preserved_by_stale_replay") {
    return "gate_preserved_by_stale_replay";
  }

  return "gate_preserved_by_policy";
}

function releaseUseEligibility(
  gateVerdict: AdminRbacOverrideReleaseBundle["gateVerdict"],
  evidenceHealth: AdminRbacOverrideReleaseBundle["evidenceHealth"],
  blockerCodes: string[],
  releaseGateStatus: AdminRbacReleaseReadinessSummary["releaseGateStatus"]
): AdminRbacOverrideReleaseBundle["releaseUseEligibility"] {
  if (evidenceHealth !== "complete" || gateVerdict === "missing_evidence") {
    return "missing_evidence";
  }

  if (
    gateVerdict === "release_ready_with_expiry" &&
    blockerCodes.length === 0 &&
    releaseGateStatus === "release_use_allowed"
  ) {
    return "eligible_temporary_mutation";
  }

  if (gateVerdict === "gate_preserved_by_review") {
    return "preserved_by_review";
  }

  if (gateVerdict === "gate_preserved_by_stale_replay") {
    return "preserved_by_stale_replay";
  }

  return "preserved_by_policy";
}

export function buildAdminRbacOverrideReleaseBundles(
  readinessSummaries: AdminRbacReleaseReadinessSummary[],
  closures: AdminRbacReleaseEvidenceClosure[],
  runtimeDecisions: AdminRbacRuntimeDecision[]
): AdminRbacOverrideReleaseBundle[] {
  const closureBySurface = new Map(closures.map((closure) => [closure.surface, closure]));
  const runtimeBySurface = new Map<AdminRbacRuntimeDecision["surface"], AdminRbacRuntimeDecision[]>();

  for (const decision of runtimeDecisions) {
    runtimeBySurface.set(decision.surface, [...(runtimeBySurface.get(decision.surface) ?? []), decision]);
  }

  return readinessSummaries
    .map((readiness) => {
      const closure = closureBySurface.get(readiness.surface);
      const runtime = runtimeBySurface.get(readiness.surface) ?? [];
      const blockerCodes = uniqueSorted([
        ...readiness.attemptBlockerCodes,
        ...runtime.flatMap((decision) => decision.blockerCodes),
        ...(readiness.readyState === "missing_evidence" ? ["release_bundle_missing_evidence"] : [])
      ]);
      const gateVerdict = closure ? bundleGateVerdict(readiness, closure) : "missing_evidence";
      const evidenceHealth: AdminRbacOverrideReleaseBundle["evidenceHealth"] =
        readiness.releaseEvidenceStatus === "attached" &&
        readiness.attemptCoverage === "covered" &&
        readiness.attemptEvidenceStatus === "valid" &&
        readiness.staleReplayCoverage !== "missing" &&
        gateVerdict !== "missing_evidence"
          ? "complete"
          : "missing_evidence";
      const eligibility = releaseUseEligibility(
        gateVerdict,
        evidenceHealth,
        blockerCodes,
        readiness.releaseGateStatus
      );

      return {
        surface: readiness.surface,
        overrideScope: readiness.overrideScope,
        targetCount: runtime.length,
        evidenceIds: readiness.evidenceIds,
        attemptIds: closure?.attemptIds ?? [],
        staleReplayEvidenceIds: readiness.staleReplayCoverage === "covered" ? closure?.staleReplayEvidenceIds ?? [] : [],
        auditRefs: readiness.auditRefs,
        releaseEvidenceRequired: closure?.releaseEvidenceRequired ?? [],
        closureEvidenceRefs: readiness.closureEvidenceRefs,
        requiredRoles: readiness.requiredRoles,
        effectiveDecisions: uniqueSorted(runtime.map((decision) => decision.effectiveDecision)),
        runtimeOutcomes: uniqueSorted(runtime.map((decision) => decision.requestOutcome)),
        attemptOutcomes: closure ? closure.attemptOutcomes : [],
        gateVerdict,
        releaseGateStatus: readiness.releaseGateStatus,
        reviewHoldCount: runtime.filter((decision) => decision.effectiveDecision === "queue_for_review").length,
        deniedMutationCount: runtime.filter((decision) => decision.effectiveDecision === "deny_mutation").length,
        expiredReplayCount: runtime.filter((decision) => decision.requestOutcome === "denied_expired_override").length,
        temporaryMutationCount: runtime.filter((decision) => decision.effectiveDecision === "allow_mutation").length,
        evidenceHealth,
        blockerCodes,
        releaseUseEligibility: eligibility,
        releaseUseAllowed: eligibility === "eligible_temporary_mutation",
        operatorAction:
          eligibility === "eligible_temporary_mutation"
            ? "Allow only the audited temporary mutation in this bundle; keep expiry restoration and rollback evidence attached before release use."
            : `Preserve ${readiness.overrideScope} state for ${readiness.surface}; use this bundle as release evidence only after the gate verdict becomes release_ready_with_expiry or the preserved gate is explicitly cited.`
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface));
}

export function buildAdminRbacReleaseEvidenceMatrix(
  evidence: AdminRbacEvidence[],
  attempts: AdminRbacOverrideAttempt[],
  attemptDecisions: AdminRbacOverrideAttemptDecision[],
  runtimeDecisions: AdminRbacRuntimeDecision[],
  closures: AdminRbacReleaseEvidenceClosure[],
  bundles: AdminRbacOverrideReleaseBundle[]
): AdminRbacReleaseEvidenceMatrixRow[] {
  const attemptByEvidenceId = new Map(attempts.map((attempt) => [attempt.evidenceId, attempt]));
  const attemptDecisionByEvidenceId = new Map(attemptDecisions.map((decision) => [decision.evidenceId, decision]));
  const runtimeByEvidenceId = new Map(runtimeDecisions.map((decision) => [decision.evidenceId, decision]));
  const closureBySurface = new Map(closures.map((closure) => [closure.surface, closure]));
  const bundleBySurface = new Map(bundles.map((bundle) => [bundle.surface, bundle]));

  return evidence
    .map((item) => {
      const attempt = attemptByEvidenceId.get(item.id);
      const attemptDecision = attemptDecisionByEvidenceId.get(item.id);
      const runtimeDecision = runtimeByEvidenceId.get(item.id);
      const closure = closureBySurface.get(item.surface);
      const bundle = bundleBySurface.get(item.surface);
      const attemptBindingBlockers = new Set<string>();

      if (attempt) {
        if (attempt.surface !== item.surface) {
          attemptBindingBlockers.add("request_attempt_surface_mismatch");
        }

        if (attempt.overrideScope !== item.overrideScope) {
          attemptBindingBlockers.add("request_attempt_scope_mismatch");
        }

        if (attempt.apiScope !== item.apiScope) {
          attemptBindingBlockers.add("request_attempt_api_scope_mismatch");
        }

        if (attempt.auditRef !== item.auditRef) {
          attemptBindingBlockers.add("request_attempt_audit_mismatch");
        }

        if (!attempt.evidenceRefs.includes(item.id)) {
          attemptBindingBlockers.add("request_attempt_evidence_ref_missing");
        }
      }

      const blockerCodes = uniqueSorted([
        ...(runtimeDecision?.blockerCodes ?? []),
        ...(attemptDecision?.blockerCodes ?? []),
        ...(bundle?.blockerCodes ?? []),
        ...attemptBindingBlockers,
        ...(!attempt ? ["request_attempt_missing"] : []),
        ...(!attemptDecision ? ["attempt_decision_missing"] : []),
        ...(!closure ? ["release_closure_missing"] : []),
        ...(!bundle ? ["release_bundle_missing"] : [])
      ]);
      const releaseUseEligibility = bundle?.releaseUseEligibility ?? "missing_evidence";
      const releaseGateStatus = bundle?.releaseGateStatus ?? "release_gate_preserved";
      const closureEvidenceRefs = uniqueSorted([
        ...(closure?.closureEvidenceRefs ?? []),
        ...(attempt?.evidenceRefs ?? []),
        ...item.evidenceRefs
      ]);

      return {
        surface: item.surface,
        overrideScope: item.overrideScope,
        evidenceId: item.id,
        attemptId: attempt?.id ?? "missing",
        target: item.target,
        apiScope: item.apiScope,
        csrfScope: attempt?.csrfScope ?? "admin_session_cookie",
        idempotencyStatus: attemptDecision?.idempotencyStatus ?? "unstable",
        stateDigestStatus: attemptDecision?.stateDigestStatus ?? "unexpected_mutation",
        expectedHttpStatus: attempt?.expectedHttpStatus ?? 403,
        runtimeRequestOutcome: attemptDecision?.runtimeRequestOutcome ?? "missing_runtime",
        releaseMutationAttemptStatus: closure?.releaseMutationAttemptStatus ?? "blocked",
        releaseUseEligibility,
        releaseGateStatus,
        staleReplayCoverage: closure?.staleReplayCoverage ?? "missing",
        releaseEvidenceStatus: closure?.releaseEvidenceStatus ?? "missing",
        auditRef: item.auditRef,
        closureEvidenceRefs,
        blockerCodes,
        operatorAction:
          releaseUseEligibility === "eligible_temporary_mutation" && blockerCodes.length === 0
            ? "Use the audited temporary mutation only for this exact admin request, preserve expiry restoration, and keep the linked release evidence attached."
            : "Do not use this override to change release state; preserve the existing admin gate until request, audit, stale replay, and release evidence all pass."
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface) || a.evidenceId.localeCompare(b.evidenceId));
}
