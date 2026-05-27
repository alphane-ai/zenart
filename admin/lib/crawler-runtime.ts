import type { CrawlerGovernanceRuntimeDecision, CrawlerGovernanceWorkflow } from "@/lib/types";

function isPendingEvidence(ref: string) {
  return ref === "pending" || ref.startsWith("pending-") || ref.trim().length === 0;
}

export function buildCrawlerGovernanceRuntimeDecisions(
  workflows: CrawlerGovernanceWorkflow[],
  now = new Date("2026-05-26T12:00:00Z")
): CrawlerGovernanceRuntimeDecision[] {
  return workflows.map((workflow) => {
    const blockerCodes: string[] = [];
    const deletionEvidenceStatus = isPendingEvidence(workflow.deletionEvidenceRef) ? "pending" : "complete";
    const requesterNoticeStatus = isPendingEvidence(workflow.requesterNoticeRef) ? "pending" : "complete";
    const auditStatus = workflow.auditRef === "pending" || workflow.auditRef.trim().length === 0 ? "missing" : "attached";
    const expectedEvidenceRefs = new Set([
      workflow.findingId,
      workflow.auditRef,
      workflow.deletionEvidenceRef,
      workflow.requesterNoticeRef
    ].filter((ref) => !isPendingEvidence(ref) && !ref.startsWith("not_required")));
    const missingRequiredEvidenceRefs = [...expectedEvidenceRefs].filter(
      (ref) => !workflow.requiredEvidenceRefs.includes(ref)
    );
    const requiredEvidenceStatus = missingRequiredEvidenceRefs.length === 0 ? "complete" : "missing";
    const dueAt = Date.parse(`${workflow.dueAt.replace(" ", "T")}Z`);
    const deadlineStatus =
      Number.isNaN(dueAt) || workflow.status === "approved" || workflow.status === "deleted"
        ? "not_evaluated"
        : dueAt < now.getTime()
          ? "expired"
          : "within_window";
    const secondReviewOpen =
      workflow.secondReviewRequired &&
      workflow.secondReviewStatus === "required";
    const secondReviewRejected =
      workflow.secondReviewRequired &&
      workflow.secondReviewStatus === "rejected";

    if (workflow.blockedActivation || workflow.activationGateDecision === "blocked") {
      blockerCodes.push("activation_blocked");
    }

    if (deletionEvidenceStatus === "pending") {
      blockerCodes.push("deletion_evidence_pending");
    }

    if (requesterNoticeStatus === "pending") {
      blockerCodes.push("requester_notice_pending");
    }

    if (secondReviewOpen) {
      blockerCodes.push("second_review_open");
    }

    if (secondReviewRejected) {
      blockerCodes.push("second_review_rejected");
    }

    if (auditStatus === "missing") {
      blockerCodes.push("audit_missing");
    }

    if (requiredEvidenceStatus === "missing") {
      blockerCodes.push("required_evidence_missing");
    }

    if (deadlineStatus === "expired" && (secondReviewOpen || deletionEvidenceStatus === "pending" || requesterNoticeStatus === "pending")) {
      blockerCodes.push("deadline_expired");
    }

    const closureDecision =
      blockerCodes.includes("deletion_evidence_pending") ||
      blockerCodes.includes("requester_notice_pending") ||
      blockerCodes.includes("audit_missing") ||
      blockerCodes.includes("required_evidence_missing") ||
      blockerCodes.includes("second_review_rejected") ||
      blockerCodes.includes("deadline_expired")
        ? "blocked"
        : secondReviewOpen
          ? "review_required"
          : "ready_to_close";
    const activationDecision =
      workflow.blockedActivation || workflow.activationGateDecision === "blocked" || closureDecision !== "ready_to_close"
        ? "block_activation"
        : "allow_activation";
    const operatorAction =
      closureDecision === "ready_to_close"
        ? `Close ${workflow.id} with audit ${workflow.auditRef}, preserve source provenance, and keep the approved retention policy visible.`
        : closureDecision === "review_required"
          ? "Route the crawler workflow to the required second reviewer before any source, derivative, retention, prompt, or skill activation changes."
          : "Keep crawler activation disabled and attach deletion evidence, requester notice, second-review outcome, and audit evidence before closure.";

    return {
      workflowId: workflow.id,
      findingId: workflow.findingId,
      requestType: workflow.requestType,
      closureDecision,
      activationDecision,
      deletionEvidenceStatus,
      requesterNoticeStatus,
      secondReviewStatus: workflow.secondReviewStatus,
      auditStatus,
      requiredEvidenceStatus,
      missingRequiredEvidenceRefs,
      deadlineStatus,
      blockerCodes,
      operatorAction,
      auditRef: workflow.auditRef,
      requiredEvidenceRefs: workflow.requiredEvidenceRefs
    };
  });
}
