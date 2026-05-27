import type { AdminRole, ExportJob, ExportRegenerationRuntimeDecision } from "@/lib/types";

const roleRank: Record<AdminRole, number> = {
  support_operator: 1,
  admin_viewer: 1,
  admin_operator: 2,
  admin_reviewer: 3,
  admin_superadmin: 4
};

function roleCanSubmit(requestedByRole: AdminRole, requiredRole: AdminRole) {
  return roleRank[requestedByRole] >= roleRank[requiredRole];
}

function closureEvidenceStatus(job: ExportJob) {
  const refs = new Set(job.closureEvidenceRefs);
  const hasRequiredRefs = refs.has(job.id) && refs.has(job.supportTicketId);
  const hasAuditWhenRequired = job.auditRef === "pending" || refs.has(job.auditRef);
  return hasRequiredRefs && hasAuditWhenRequired ? "complete" : "incomplete";
}

function qaGate(job: ExportJob): ExportRegenerationRuntimeDecision["qaGate"] {
  if (job.qaSeverity === "blocking") {
    return "blocking_denied";
  }

  return job.qaSeverity === "warning" ? "warning_review" : "pass";
}

function blockerCodes(job: ExportJob): string[] {
  const blockers: string[] = [];

  if (!job.regenerateEligible) {
    blockers.push("NOT_REGENERATE_ELIGIBLE");
  }

  if (job.qaSeverity === "blocking") {
    blockers.push("BLOCKING_QA");
  }

  if (job.auditRef === "pending") {
    blockers.push("PENDING_AUDIT");
  }

  if (!roleCanSubmit(job.requestedByRole, job.requiredRole)) {
    blockers.push("INSUFFICIENT_ROLE");
  }

  if (job.rbacDecision === "denied") {
    blockers.push("RBAC_DENIED");
  }

  if (job.rbacDecision === "second_review_required") {
    blockers.push("SECOND_REVIEW_REQUIRED");
  }

  if (job.regenerationMode === "not_allowed") {
    blockers.push("NOT_EXECUTABLE_MODE");
  }

  if (closureEvidenceStatus(job) === "incomplete") {
    blockers.push("MISSING_CLOSURE_EVIDENCE");
  }

  return blockers;
}

function quotaSettlement(job: ExportJob): ExportRegenerationRuntimeDecision["quotaSettlement"] {
  return job.quotaEffect === "none" ? "no_quota_change" : job.quotaEffect;
}

function runtimeDecision(blockers: string[]): ExportRegenerationRuntimeDecision["decision"] {
  if (blockers.length === 0) {
    return "submit_ready";
  }

  return blockers.some((blocker) =>
    ["BLOCKING_QA", "RBAC_DENIED", "NOT_EXECUTABLE_MODE"].includes(blocker)
  )
    ? "blocked"
    : "review_required";
}

function disabledReason(decision: ExportRegenerationRuntimeDecision["decision"], blockers: string[]) {
  if (decision === "submit_ready") {
    return "Ready for one idempotent regeneration request with linked support, quota, and audit evidence.";
  }

  return `Disabled until ${blockers.join(", ")} is resolved.`;
}

function operatorAction(job: ExportJob, decision: ExportRegenerationRuntimeDecision["decision"]) {
  if (decision === "submit_ready") {
    return `Submit ${job.regenerationMode} once, then verify package manifest, QA report, quota settlement, and audit ${job.auditRef}.`;
  }

  if (decision === "review_required") {
    return "Attach the missing audit or second-review evidence before enabling the regenerate command.";
  }

  return "Keep regeneration disabled and close through support, quota remediation, or safety review according to the runbook.";
}

export function buildExportRegenerationRuntimeDecisions(
  jobs: ExportJob[]
): ExportRegenerationRuntimeDecision[] {
  return jobs.map((job) => {
    const blockers = blockerCodes(job);
    const decision = runtimeDecision(blockers);

    return {
      exportId: job.id,
      supportTicketId: job.supportTicketId,
      decision,
      qaGate: qaGate(job),
      auditStatus: job.auditRef === "pending" ? "pending" : "attached",
      closureEvidenceStatus: closureEvidenceStatus(job),
      requestedByRole: job.requestedByRole,
      requiredRole: job.requiredRole,
      rbacDecision: job.rbacDecision,
      idempotencyKey: job.idempotencyKey,
      quotaSettlement: quotaSettlement(job),
      blockerCodes: blockers,
      submitDisabledReason: disabledReason(decision, blockers),
      operatorAction: operatorAction(job, decision)
    };
  });
}
