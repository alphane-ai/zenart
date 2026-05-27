import type { CrawlerGovernanceRuntimeDecision, CrawlerGovernanceWorkflow } from "@/lib/types";

function isPendingEvidence(ref: string) {
  return ref === "pending" || ref.startsWith("pending-") || ref.trim().length === 0;
}

export function buildCrawlerGovernanceRuntimeDecisions(
  workflows: CrawlerGovernanceWorkflow[]
): CrawlerGovernanceRuntimeDecision[] {
  return workflows.map((workflow) => {
    const blockerCodes: string[] = [];
    const deletionEvidenceStatus = isPendingEvidence(workflow.deletionEvidenceRef) ? "pending" : "complete";
    const requesterNoticeStatus = isPendingEvidence(workflow.requesterNoticeRef) ? "pending" : "complete";
    const auditStatus = workflow.auditRef === "pending" || workflow.auditRef.trim().length === 0 ? "missing" : "attached";
    const secondReviewOpen =
      workflow.secondReviewRequired &&
      workflow.secondReviewStatus === "required";

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

    if (auditStatus === "missing") {
      blockerCodes.push("audit_missing");
    }

    const closureDecision =
      blockerCodes.includes("deletion_evidence_pending") ||
      blockerCodes.includes("requester_notice_pending") ||
      blockerCodes.includes("audit_missing")
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
      blockerCodes,
      operatorAction,
      auditRef: workflow.auditRef,
      requiredEvidenceRefs: workflow.requiredEvidenceRefs
    };
  });
}
