import type { FailedTaskControl, FailedTaskRuntimeDecision } from "@/lib/types";

const requiredClosureEvidenceCount = 4;
const supportedAppVersion = "admin-0.0.0";
const supportedSchemaVersion = "task.v1";
const supportedWorkerVersions = new Set(["worker-2026.05.26", "crawler-2026.05.26"]);

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
    const compatibilityStatus =
      task.appVersion === supportedAppVersion &&
      task.schemaVersion === supportedSchemaVersion &&
      supportedWorkerVersions.has(task.workerVersion)
        ? "compatible"
        : "stale";
    const compatibilityEvidence =
      `app:${task.appVersion}; worker:${task.workerVersion}; schema:${task.schemaVersion}`;

    if (task.actionEligibility === "blocked") {
      blockerCodes.push("action_blocked");
    }

    if (task.requestedAction === "retry" && retryBudgetStatus === "exhausted") {
      blockerCodes.push("retry_budget_exhausted");
    }

    if (task.rbacDecision === "denied") {
      blockerCodes.push("rbac_denied");
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

    if (compatibilityStatus === "stale") {
      blockerCodes.push("version_compatibility_stale");
    }

    const hardBlockers = new Set([
      "action_blocked",
      "retry_budget_exhausted",
      "rbac_denied",
      "closure_evidence_incomplete",
      "rbac_evidence_missing",
      "user_message_missing",
      "idempotency_key_unstable",
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
      quotaSettlement: task.quotaEffect,
      idempotencyKey: task.idempotencyKey,
      idempotencyStatus: computedIdempotencyStatus,
      compatibilityStatus,
      compatibilityEvidence,
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
