import type {
  CrawlerGovernanceAdminActionContract,
  CrawlerGovernanceClosureSummary,
  CrawlerGovernanceRuntimeDecision,
  CrawlerGovernanceWorkflow
} from "@/lib/types";

function isPendingEvidence(ref: string) {
  return ref === "pending" || ref.startsWith("pending-") || ref.trim().length === 0;
}

function isConcreteRequiredEvidence(ref: string) {
  return !isPendingEvidence(ref) && !ref.startsWith("not_required");
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
      workflow.requesterNoticeRef,
      workflow.escalationEvidenceRef
    ].filter(isConcreteRequiredEvidence));
    const missingConcreteEvidenceRefs = [...expectedEvidenceRefs].filter(
      (ref) => !workflow.requiredEvidenceRefs.includes(ref)
    );
    const unresolvedRequiredEvidenceRefs = workflow.requiredEvidenceRefs.filter(isPendingEvidence);
    const missingRequiredEvidenceRefs = [
      ...unresolvedRequiredEvidenceRefs,
      ...missingConcreteEvidenceRefs.filter((ref) => !unresolvedRequiredEvidenceRefs.includes(ref))
    ];
    const requiredEvidenceStatus = missingRequiredEvidenceRefs.length === 0 ? "complete" : "missing";
    const dueAt = Date.parse(`${workflow.dueAt.replace(" ", "T")}Z`);
    const deadlineStatus =
      Number.isNaN(dueAt) || workflow.status === "approved" || workflow.status === "deleted"
        ? "not_evaluated"
        : dueAt < now.getTime()
          ? "expired"
          : "within_window";
    const escalationEvidenceRequired = deadlineStatus === "expired" || workflow.escalationEvidenceRef.startsWith("required-");
    const escalationEvidenceStatus =
      escalationEvidenceRequired
        ? isPendingEvidence(workflow.escalationEvidenceRef) || workflow.escalationEvidenceRef.startsWith("required-")
          ? "pending"
          : "complete"
        : "not_required";
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

    if (escalationEvidenceStatus === "pending") {
      blockerCodes.push("deadline_escalation_pending");
    }

    const closureDecision =
      blockerCodes.includes("deletion_evidence_pending") ||
      blockerCodes.includes("requester_notice_pending") ||
      blockerCodes.includes("deadline_escalation_pending") ||
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
          : "Keep crawler activation disabled and attach deletion evidence, requester notice, deadline escalation, second-review outcome, and audit evidence before closure.";
    const closureEvidenceChecklist = [
      `finding:${workflow.findingId}`,
      `deletion:${deletionEvidenceStatus}`,
      `requester_notice:${requesterNoticeStatus}`,
      `deadline_escalation:${escalationEvidenceStatus}`,
      `second_review:${workflow.secondReviewStatus}`,
      `audit:${auditStatus}`,
      `required_evidence:${requiredEvidenceStatus}`,
      `deadline:${deadlineStatus}`
    ];
    const activationGuardrail =
      activationDecision === "allow_activation"
        ? `Activation can proceed only for ${workflow.findingId} with provenance, bounded retention, requester notice, reviewer rationale, and audit ${workflow.auditRef} attached to every crawler-derived prompt, skill, and fragment change.`
        : `Activation remains blocked for ${workflow.findingId}; crawler-derived prompt, skill, and fragment changes cannot activate until closure is ready.`;
    const reviewEscalation =
      secondReviewRejected
        ? "Second review rejected the workflow; keep activation blocked and restart reviewer-owned takedown or derivative review."
        : secondReviewOpen
          ? "Second reviewer must complete the high-risk crawler review before closure or activation changes."
          : "Second review is not blocking; preserve reviewer rationale and audit linkage for release evidence.";
    const releaseGateEvidence =
      closureDecision === "ready_to_close"
        ? `Release gate can cite ${workflow.id}, ${workflow.findingId}, ${workflow.auditRef}, and required evidence refs after preserving takedown, derivative-use, retention, provenance, deadline escalation, and notice evidence.`
        : `Release gate must keep ${workflow.id} blocked with blocker codes ${blockerCodes.join(", ") || "none"} until takedown, derivative-use, retention, notice, deadline escalation, and audit evidence are complete.`;

    return {
      workflowId: workflow.id,
      findingId: workflow.findingId,
      requestType: workflow.requestType,
      closureDecision,
      activationDecision,
      deletionEvidenceStatus,
      requesterNoticeStatus,
      escalationEvidenceStatus,
      secondReviewStatus: workflow.secondReviewStatus,
      auditStatus,
      requiredEvidenceStatus,
      missingRequiredEvidenceRefs,
      deadlineStatus,
      blockerCodes,
      operatorAction,
      closureEvidenceChecklist,
      activationGuardrail,
      reviewEscalation,
      releaseGateEvidence,
      auditRef: workflow.auditRef,
      requiredEvidenceRefs: workflow.requiredEvidenceRefs
    };
  });
}

export function buildCrawlerGovernanceClosureSummaries(
  decisions: CrawlerGovernanceRuntimeDecision[]
): CrawlerGovernanceClosureSummary[] {
  return decisions.map((decision) => {
    const releaseClosureState =
      decision.closureDecision === "ready_to_close"
        ? "closure_ready"
        : decision.closureDecision === "review_required"
          ? "review_required"
          : "blocked";
    const activationSafetyState =
      decision.activationDecision === "allow_activation" ? "activation_safe" : "activation_blocked";
    const secondReviewGate =
      decision.secondReviewStatus === "completed"
        ? "complete"
        : decision.secondReviewStatus === "rejected"
          ? "rejected"
          : decision.secondReviewStatus === "required"
            ? "required"
            : "not_required";
    const takedownDeleteStatus =
      decision.requestType === "source_takedown" || decision.requestType === "raw_retention_delete"
        ? decision.deletionEvidenceStatus
        : "not_applicable";
    const releaseGateDisposition =
      releaseClosureState === "closure_ready" &&
      activationSafetyState === "activation_safe" &&
      decision.requiredEvidenceStatus === "complete"
        ? "can_cite_release_evidence"
        : "preserve_blocker";
    const operatorSummary =
      releaseGateDisposition === "can_cite_release_evidence"
        ? `Release evidence may cite ${decision.workflowId} only with audit ${decision.auditRef}, required evidence refs, provenance, retention policy, and activation guardrail preserved.`
        : `Keep ${decision.workflowId} out of release-clearing evidence until blocker codes ${decision.blockerCodes.join(", ") || "none"} are resolved and crawler-derived activation stays blocked.`;

    return {
      workflowId: decision.workflowId,
      findingId: decision.findingId,
      requestType: decision.requestType,
      releaseClosureState,
      activationSafetyState,
      evidenceCompleteness: decision.requiredEvidenceStatus,
      takedownDeleteStatus,
      deadlineEscalationStatus: decision.escalationEvidenceStatus,
      secondReviewGate,
      releaseGateDisposition,
      missingEvidenceRefs: decision.missingRequiredEvidenceRefs,
      blockerCodes: decision.blockerCodes,
      operatorSummary,
      auditRef: decision.auditRef
    };
  });
}

function workflowEndpointScope(workflow: CrawlerGovernanceWorkflow): CrawlerGovernanceAdminActionContract["endpointScope"] {
  if (workflow.requestType === "source_takedown") {
    return "crawler_takedown_closure";
  }

  if (workflow.requestType === "derivative_review") {
    return "crawler_derivative_activation";
  }

  return "crawler_raw_retention_delete";
}

function workflowMutation(workflow: CrawlerGovernanceWorkflow): CrawlerGovernanceAdminActionContract["requestedMutation"] {
  if (workflow.requestType === "source_takedown") {
    return "close_takedown";
  }

  if (workflow.requestType === "derivative_review") {
    return "allow_derivative_activation";
  }

  return "delete_raw_retention";
}

function workflowRegressionFixtureRefs(workflow: CrawlerGovernanceWorkflow) {
  if (workflow.id === "cg-501") {
    return [
      "fixtures/stage0/rev2/regressions/crawler_takedown_sup_2212.json",
      "fixtures/stage0/rev2/regressions/failed_task_cancel_task_crawler_019.json"
    ];
  }

  if (workflow.id === "cg-522") {
    return ["fixtures/stage0/rev2/regressions/crawler_derivative_review_cg_522.json"];
  }

  return ["fixtures/stage0/rev2/regressions/failed_task_cancel_task_crawler_019.json"];
}

function workflowRequestAttemptRef(workflow: CrawlerGovernanceWorkflow) {
  return `crawler-action:${workflow.id}:${workflow.findingId}:${workflow.auditRef}`;
}

function workflowIdempotencyKey(workflow: CrawlerGovernanceWorkflow) {
  return `crawler-action:${workflow.requestType}:${workflow.id}:${workflow.findingId}:${workflow.auditRef}`;
}

function workflowStateDigest(workflow: CrawlerGovernanceWorkflow) {
  return [
    workflow.id,
    workflow.findingId,
    workflow.requestType,
    workflow.status,
    workflow.activationGateDecision,
    workflow.quarantineStatus,
    workflow.secondReviewStatus,
    workflow.deletionEvidenceRef,
    workflow.requesterNoticeRef,
    workflow.escalationEvidenceRef,
    workflow.auditRef
  ].join("|");
}

export function buildCrawlerGovernanceAdminActionContracts(
  workflows: CrawlerGovernanceWorkflow[],
  decisions: CrawlerGovernanceRuntimeDecision[],
  regressionFixturePaths?: string[]
): CrawlerGovernanceAdminActionContract[] {
  const decisionByWorkflow = new Map(decisions.map((decision) => [decision.workflowId, decision]));
  const regressionFixturePathSet = regressionFixturePaths ? new Set(regressionFixturePaths) : undefined;

  return workflows.map((workflow) => {
    const decision = decisionByWorkflow.get(workflow.id);
    const regressionFixtureRefs = workflowRegressionFixtureRefs(workflow);
    const regressionFixtureInventoryStatus =
      regressionFixturePathSet === undefined
        ? "unverified"
        : regressionFixtureRefs.every((ref) => regressionFixturePathSet.has(ref))
          ? "declared"
          : "missing";
    const regressionFixtureGate =
      regressionFixtureRefs.length === 0
        ? "missing_regression_fixture"
        : regressionFixtureInventoryStatus === "declared"
          ? "pass"
          : regressionFixtureInventoryStatus === "missing"
            ? "missing_inventory"
            : "inventory_unverified";
    const allowedMutationBase =
      decision !== undefined &&
      decision.closureDecision === "ready_to_close" &&
      decision.activationDecision === "allow_activation" &&
      decision.requiredEvidenceStatus === "complete";
    const allowedMutation = allowedMutationBase && regressionFixtureGate === "pass";
    const secondReviewGate =
      workflow.secondReviewStatus === "completed"
        ? "pass"
        : workflow.secondReviewStatus === "rejected"
          ? "rejected"
          : workflow.secondReviewStatus === "required"
            ? "required"
            : "not_required";
    const evidenceGate =
      decision?.requiredEvidenceStatus === "complete" ? "pass" : "missing_required_evidence";
    const deadlineGate =
      decision?.deadlineStatus === "expired" ? "expired_requires_escalation" : "pass";
    const activationGate =
      allowedMutation ? "pass" : "blocked";
    const httpOutcome =
      allowedMutation && workflow.requestType === "derivative_review"
        ? "200_activation_ready"
        : allowedMutation
          ? "200_close_ready"
          : "423_governance_blocked";
    const mutationOrder =
      allowedMutation && workflow.requestType === "derivative_review"
        ? "audit_then_derivative_activation"
        : allowedMutation
          ? "audit_then_quarantine_release"
          : "audit_then_keep_quarantine";
    const quarantineOutcome =
      allowedMutation
        ? "clear"
        : workflow.quarantineStatus === "scheduled"
          ? "keep_scheduled"
          : "keep_active";
    const requestEvidenceRefs = [...new Set([
      workflow.findingId,
      workflow.linkedReview,
      workflow.auditRef,
      workflowRequestAttemptRef(workflow),
      workflowIdempotencyKey(workflow),
      workflowStateDigest(workflow),
      ...workflow.requiredEvidenceRefs,
      ...regressionFixtureRefs
    ])];
    const releaseEvidenceDisposition =
      allowedMutation ? "can_cite_release_evidence" : "preserve_blocker";
    const staleReplayOutcome =
      allowedMutation ? "deny_409_stale_digest" : "deny_423_governance_blocked";
    const supportVisibleMessage =
      allowedMutation
        ? `Crawler governance workflow ${workflow.id} is ready for admin mutation after audit ${workflow.auditRef}; preserve provenance, bounded retention, requester notice, and exact-text stripping in any crawler-derived activation.`
        : `Crawler governance workflow ${workflow.id} remains blocked; keep source material quarantined and do not mutate crawler-derived prompt, skill, meta prompt, or provider-route activation until required evidence and review gates pass.`;

    return {
      workflowId: workflow.id,
      findingId: workflow.findingId,
      requestType: workflow.requestType,
      endpointScope: workflowEndpointScope(workflow),
      requestedMutation: workflowMutation(workflow),
      allowedMutation,
      httpOutcome,
      mutationOrder,
      quarantineOutcome,
      requiredOperatorRole: workflow.reviewerRole,
      secondReviewGate,
      evidenceGate,
      deadlineGate,
      activationGate,
      adminSessionScope: "admin_session_cookie_csrf",
      requestAttemptRef: workflowRequestAttemptRef(workflow),
      idempotencyKey: workflowIdempotencyKey(workflow),
      requestStateDigest: workflowStateDigest(workflow),
      staleReplayOutcome,
      requestAuditOrder: "validate_session_then_digest_then_audit_then_mutation",
      requestEvidenceRefs,
      supportVisibleMessage,
      regressionFixtureRefs,
      regressionFixtureInventoryStatus,
      regressionFixtureGate,
      releaseEvidenceDisposition,
      blockerCodes: decision?.blockerCodes ?? ["runtime_decision_missing"],
      auditRef: workflow.auditRef
    };
  });
}
