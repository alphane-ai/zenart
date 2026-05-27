import type { FailedTaskControl, FailedTaskRuntimeDecision } from "@/lib/types";

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
  submitDecision: FailedTaskRuntimeDecision["submitDecision"]
): FailedTaskRuntimeDecision["releaseGateDisposition"] {
  if (!task.regressionFixtureRef.startsWith("fixtures/")) {
    return "blocked_not_regression_fixture";
  }

  return submitDecision === "submit_ready"
    ? "converted_regression_fixture"
    : "eval_gate_preserved_by_regression_fixture";
}

export function buildFailedTaskRuntimeDecisions(tasks: FailedTaskControl[]): FailedTaskRuntimeDecision[] {
  return tasks.map((task) => {
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
    const compatibilityStatus =
      task.appVersion === supportedAppVersion &&
      task.schemaVersion === supportedSchemaVersion &&
      supportedWorkerVersions.has(task.workerVersion)
        ? "compatible"
        : "stale";
    const compatibilityEvidence =
      `app:${task.appVersion}; worker:${task.workerVersion}; schema:${task.schemaVersion}`;
    const roleAuthorizationStatus =
      roleRank[task.requestedByRole] >= roleRank[task.allowedRole] ? "sufficient" : "insufficient";
    const roleAuthorizationEvidence = `requested:${task.requestedByRole}; required:${task.allowedRole}`;

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
      "version_compatibility_stale"
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
    const computedReleaseGateDisposition = releaseGateDisposition(task, submitDecision);
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
      requestedAction: task.requestedAction,
      submitDecision,
      stateTransition: computedStateTransition,
      closureOutcome: computedClosureOutcome,
      releaseGateDisposition: computedReleaseGateDisposition,
      retryBudgetStatus,
      rbacStatus: task.rbacDecision,
      roleAuthorizationStatus,
      roleAuthorizationEvidence,
      quotaSettlement: task.quotaEffect,
      idempotencyKey: task.idempotencyKey,
      idempotencyStatus: computedIdempotencyStatus,
      stateDigestStatus: computedStateDigestStatus,
      stateDigestEvidence,
      compatibilityStatus,
      compatibilityEvidence,
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
