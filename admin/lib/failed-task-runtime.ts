import type { FailedTaskControl, FailedTaskRuntimeDecision } from "@/lib/types";

const requiredClosureEvidenceCount = 4;

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
    const userMessageStatus = task.userMessage.trim().length > 0 ? "ready" : "missing";
    const idempotencyStatus = "stable";

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

    if (userMessageStatus === "missing") {
      blockerCodes.push("user_message_missing");
    }

    const submitDecision =
      blockerCodes.includes("action_blocked") || blockerCodes.includes("rbac_denied")
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

    return {
      taskId: task.id,
      queueId: task.queueId,
      requestedAction: task.requestedAction,
      submitDecision,
      retryBudgetStatus,
      rbacStatus: task.rbacDecision,
      quotaSettlement: task.quotaEffect,
      idempotencyStatus,
      closureEvidenceStatus,
      userMessageStatus,
      blockerCodes,
      submitDisabledReason,
      operatorAction,
      auditRef: task.auditRef
    };
  });
}
