import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { RbacOverrideAttemptDecisionTable } from "@/components/RbacOverrideAttemptDecisionTable";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacOverrideAttemptDecisions,
  getAdminRbacRuntimeDecisions,
  getCrawlerFindings,
  getCrawlerGovernanceAdminActionContracts,
  getCrawlerGovernanceClosureSummaries,
  getCrawlerGovernanceRuntimeDecisions,
  getCrawlerGovernanceWorkflows,
  getCrawlerSourceApprovals,
  getCrawlerStagingRuntimeEvidence
} from "@/lib/admin-api";
import type {
  AdminRbacEvidence,
  CrawlerGovernanceAdminActionContract,
  CrawlerFinding,
  CrawlerGovernanceClosureSummary,
  CrawlerGovernanceRuntimeDecision,
  CrawlerGovernanceWorkflow,
  CrawlerSourceApproval,
  CrawlerStagingRuntimeEvidence
} from "@/lib/types";

export default async function CrawlerReviewPage() {
  const [
    findings,
    sourceApprovals,
    governanceWorkflows,
    governanceRuntime,
    governanceClosureSummaries,
    governanceActionContracts,
    stagingRuntimeEvidence,
    rbacEvidence,
    rbacRuntime,
    rbacAttemptDecisions
  ] = await Promise.all([
    getCrawlerFindings(),
    getCrawlerSourceApprovals(),
    getCrawlerGovernanceWorkflows(),
    getCrawlerGovernanceRuntimeDecisions(),
    getCrawlerGovernanceClosureSummaries(),
    getCrawlerGovernanceAdminActionContracts(),
    getCrawlerStagingRuntimeEvidence(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacOverrideAttemptDecisions()
  ]);
  const crawlerRbacEvidence = rbacEvidence.filter((item) => item.surface === "crawler_import");
  const crawlerRbacRuntime = rbacRuntime.filter((item) => item.surface === "crawler_import");
  const crawlerRbacAttemptDecisions = rbacAttemptDecisions.filter((item) => item.surface === "crawler_import");

  return (
    <>
      <PageHeader
        title="Crawler Review"
        description="Crawler sources and findings require provenance, source governance, and review before anything reaches active skills or prompts."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Sources and Findings</h3>
            <p>Exact third-party prompt or code imports stay blocked until special approval.</p>
          </div>
        </div>
        <DataTable<CrawlerFinding>
          rows={findings}
          columns={[
            { key: "id", header: "ID", render: (row) => <span className="mono">{row.id}</span> },
            { key: "source", header: "Source", render: (row) => row.source },
            { key: "type", header: "Type", render: (row) => row.type },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "provenance", header: "Provenance", render: (row) => row.provenance },
            { key: "risk", header: "Risk Labels", render: (row) => row.riskLabels.join(", ") }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Crawler Import RBAC Runtime Decisions</h3>
            <p>Computed crawler activation outcomes keep takedown, derivative-use, and retention changes blocked until runtime role and review checks pass.</p>
          </div>
        </div>
        <RbacRuntimeDecisionTable rows={crawlerRbacRuntime} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Crawler Import RBAC Override Attempt Evidence</h3>
            <p>Request-level evidence proves crawler reactivation attempts preserve idempotency, state digest, HTTP outcome, audit, and takedown or derivative-review blockers.</p>
          </div>
        </div>
        <RbacOverrideAttemptDecisionTable rows={crawlerRbacAttemptDecisions} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Crawler Import RBAC Evidence</h3>
            <p>Crawler import, source activation, takedown, and derivative-use changes must keep RBAC evidence visible beside review workflow evidence.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={crawlerRbacEvidence}
          columns={[
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "api", header: "API Scope", render: (row) => <span className="mono">{row.apiScope}</span> },
            { key: "mutation", header: "Mutation Outcome", render: (row) => <StatusBadge value={row.mutationOutcome === "applied" ? "healthy" : row.mutationOutcome === "queued_for_review" ? "warning" : "blocked"} label={row.mutationOutcome} /> },
            { key: "duration-policy", header: "Duration Policy", render: (row) => row.overrideDurationPolicy },
            { key: "starts", header: "Override Start", render: (row) => row.overrideStartedAt },
            { key: "expires", header: "Override Expiration", render: (row) => row.overrideExpiresAt },
            { key: "expiry-enforced", header: "Expiry Enforced", render: (row) => (row.expiryEnforced ? "Yes" : "No") },
            { key: "pre-state", header: "Pre-Override State", render: (row) => row.preOverrideState },
            { key: "expiry-action", header: "Expiry Action", render: (row) => row.expiryAction },
            { key: "stale-probe", header: "Stale Override Probe", render: (row) => row.staleOverrideProbe },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post-decision", header: "Post Decision Control", render: (row) => row.postDecisionControl },
            { key: "release-required", header: "Release Evidence Required", render: (row) => row.releaseEvidenceRequired.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Crawler Source Approval</h3>
            <p>Source approval needs RBAC, legal metadata, robots evidence, exact-text policy, rate limits, retention limits, and immutable audit evidence.</p>
          </div>
        </div>
        <DataTable<CrawlerSourceApproval>
          rows={sourceApprovals}
          columns={[
            { key: "id", header: "ID", render: (row) => <span className="mono">{row.id}</span> },
            { key: "source", header: "Source", render: (row) => row.sourceName },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "rbac", header: "RBAC", render: (row) => <StatusBadge value={row.rbacDecision} label={`${row.attemptedRole} -> ${row.requiredRole}`} /> },
            { key: "legal", header: "Legal Metadata", render: (row) => <StatusBadge value={row.legalMetadataStatus} /> },
            { key: "robots", header: "Robots Evidence", render: (row) => row.robotsEvidence },
            { key: "derivative", header: "Derivative Policy", render: (row) => row.derivativeUsePolicy },
            { key: "exactText", header: "Exact-text Policy", render: (row) => row.exactTextPolicy },
            { key: "retention", header: "Retention", render: (row) => `${row.rawRetentionDays} days` },
            { key: "rateLimit", header: "Rate Limit", render: (row) => row.rateLimitPolicy },
            { key: "activation", header: "Activation", render: (row) => <StatusBadge value={row.activationGate} /> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.requiredEvidenceRefs.join(", ") },
            { key: "rationale", header: "Reviewer Rationale", render: (row) => row.reviewerRationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Takedown and Derivative Review Workflow</h3>
            <p>Source takedown, derivative-use review, and raw retention deletion must keep activation blocked until audit evidence is complete.</p>
          </div>
        </div>
        <DataTable<CrawlerGovernanceWorkflow>
          rows={governanceWorkflows}
          columns={[
            { key: "id", header: "ID", render: (row) => <span className="mono">{row.id}</span> },
            { key: "finding", header: "Finding", render: (row) => <span className="mono">{row.findingId}</span> },
            { key: "request", header: "Request", render: (row) => row.requestType },
            { key: "requested", header: "Requested At", render: (row) => row.requestedAt },
            { key: "due", header: "Due At", render: (row) => row.dueAt },
            { key: "requester", header: "Requester", render: (row) => row.requester },
            { key: "contact", header: "Source Contact", render: (row) => row.sourceContact },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "derivative", header: "Derivative Use", render: (row) => <StatusBadge value={row.derivativeUseStatus} label={row.derivativeUseStatus} /> },
            { key: "retention", header: "Retention Action", render: (row) => row.rawRetentionAction },
            { key: "delete", header: "Deletion Evidence", render: (row) => <span className="mono">{row.deletionEvidenceRef}</span> },
            { key: "notice", header: "Requester Notice", render: (row) => <span className="mono">{row.requesterNoticeRef}</span> },
            { key: "escalation", header: "Escalation Evidence", render: (row) => <span className="mono">{row.escalationEvidenceRef}</span> },
            { key: "activation", header: "Activation", render: (row) => <StatusBadge value={row.activationGateDecision} label={row.activationGateDecision} /> },
            { key: "quarantine", header: "Quarantine", render: (row) => <StatusBadge value={row.quarantineStatus === "cleared" ? "allowed" : row.quarantineStatus === "scheduled" ? "warning" : "blocked"} label={row.quarantineStatus} /> },
            { key: "sla", header: "SLA", render: (row) => <StatusBadge value={row.slaStatus === "expired" ? "blocked" : "healthy"} label={row.slaStatus} /> },
            { key: "surfaces", header: "Affected Surfaces", render: (row) => row.affectedActivationSurfaces.join(", ") },
            { key: "review", header: "Linked Review", render: (row) => <span className="mono">{row.linkedReview}</span> },
            { key: "fixture", header: "Fixture Case", render: (row) => row.fixtureCaseId },
            { key: "role", header: "Reviewer Role", render: (row) => row.reviewerRole },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewRequired ? row.secondReviewStatus : "not required"} /> },
            { key: "next", header: "Operator Next Action", render: (row) => row.operatorNextAction },
            { key: "closure", header: "Closure Criteria", render: (row) => row.closureCriteria },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.requiredEvidenceRefs.join(", ") },
            { key: "rationale", header: "Review Rationale", render: (row) => row.reviewRationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Crawler Governance Runtime Decisions</h3>
            <p>Computed closure gates deny reactivation until takedown deletion evidence, requester notice, second review, and audit evidence are attached.</p>
          </div>
        </div>
        <DataTable<CrawlerGovernanceRuntimeDecision>
          rows={governanceRuntime}
          columns={[
            { key: "workflow", header: "Workflow", render: (row) => <span className="mono">{row.workflowId}</span> },
            { key: "finding", header: "Finding", render: (row) => <span className="mono">{row.findingId}</span> },
            { key: "request", header: "Request", render: (row) => row.requestType },
            { key: "closure", header: "Closure Decision", render: (row) => <StatusBadge value={row.closureDecision} label={row.closureDecision} /> },
            { key: "activation", header: "Activation Decision", render: (row) => <StatusBadge value={row.activationDecision === "allow_activation" ? "allowed" : "blocked"} label={row.activationDecision} /> },
            { key: "delete", header: "Deletion Evidence", render: (row) => <StatusBadge value={row.deletionEvidenceStatus} label={row.deletionEvidenceStatus} /> },
            { key: "notice", header: "Requester Notice", render: (row) => <StatusBadge value={row.requesterNoticeStatus} label={row.requesterNoticeStatus} /> },
            { key: "escalation", header: "Escalation Evidence", render: (row) => <StatusBadge value={row.escalationEvidenceStatus} label={row.escalationEvidenceStatus} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "audit-status", header: "Audit Status", render: (row) => <StatusBadge value={row.auditStatus} label={row.auditStatus} /> },
            { key: "required-status", header: "Required Evidence Status", render: (row) => <StatusBadge value={row.requiredEvidenceStatus} label={row.requiredEvidenceStatus} /> },
            { key: "missing-required", header: "Missing Required Evidence", render: (row) => (row.missingRequiredEvidenceRefs.length > 0 ? row.missingRequiredEvidenceRefs.join(", ") : "none") },
            { key: "deadline", header: "Deadline", render: (row) => <StatusBadge value={row.deadlineStatus} label={row.deadlineStatus} /> },
            { key: "blockers", header: "Blockers", render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none") },
            { key: "closure-checklist", header: "Closure Checklist", render: (row) => row.closureEvidenceChecklist.join(", ") },
            { key: "guardrail", header: "Activation Guardrail", render: (row) => row.activationGuardrail },
            { key: "escalation", header: "Review Escalation", render: (row) => row.reviewEscalation },
            { key: "action", header: "Operator Action", render: (row) => row.operatorAction },
            { key: "release", header: "Release Gate Evidence", render: (row) => row.releaseGateEvidence },
            { key: "evidence", header: "Required Evidence", render: (row) => row.requiredEvidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Crawler Release Closure Summary</h3>
            <p>Aggregated takedown and derivative-review closure states show which crawler workflows can be cited as release evidence and which must preserve blockers.</p>
          </div>
        </div>
        <DataTable<CrawlerGovernanceClosureSummary>
          rows={governanceClosureSummaries}
          columns={[
            { key: "workflow", header: "Workflow", render: (row) => <span className="mono">{row.workflowId}</span> },
            { key: "finding", header: "Finding", render: (row) => <span className="mono">{row.findingId}</span> },
            { key: "request", header: "Request", render: (row) => row.requestType },
            { key: "closure", header: "Release Closure State", render: (row) => <StatusBadge value={row.releaseClosureState} label={row.releaseClosureState} /> },
            { key: "activation", header: "Activation Safety State", render: (row) => <StatusBadge value={row.activationSafetyState === "activation_safe" ? "allowed" : "blocked"} label={row.activationSafetyState} /> },
            { key: "evidence", header: "Evidence Completeness", render: (row) => <StatusBadge value={row.evidenceCompleteness} label={row.evidenceCompleteness} /> },
            { key: "delete", header: "Takedown Delete Status", render: (row) => <StatusBadge value={row.takedownDeleteStatus} label={row.takedownDeleteStatus} /> },
            { key: "deadline", header: "Deadline Escalation Status", render: (row) => <StatusBadge value={row.deadlineEscalationStatus} label={row.deadlineEscalationStatus} /> },
            { key: "second-review", header: "Second Review Gate", render: (row) => <StatusBadge value={row.secondReviewGate} label={row.secondReviewGate} /> },
            { key: "release", header: "Release Gate Disposition", render: (row) => <StatusBadge value={row.releaseGateDisposition === "can_cite_release_evidence" ? "approved" : "blocked"} label={row.releaseGateDisposition} /> },
            { key: "missing", header: "Missing Evidence Refs", render: (row) => (row.missingEvidenceRefs.length > 0 ? row.missingEvidenceRefs.join(", ") : "none") },
            { key: "blockers", header: "Blocker Codes", render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none") },
            { key: "summary", header: "Operator Summary", render: (row) => row.operatorSummary },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Crawler Admin Action Contracts</h3>
            <p>Concrete mutation contracts bind each takedown, derivative review, and retention delete action to RBAC role, audit ordering, quarantine outcome, regression fixture, and release evidence disposition.</p>
          </div>
        </div>
        <DataTable<CrawlerGovernanceAdminActionContract>
          rows={governanceActionContracts}
          columns={[
            { key: "workflow", header: "Workflow", render: (row) => <span className="mono">{row.workflowId}</span> },
            { key: "finding", header: "Finding", render: (row) => <span className="mono">{row.findingId}</span> },
            { key: "scope", header: "Endpoint Scope", render: (row) => row.endpointScope },
            { key: "mutation", header: "Requested Mutation", render: (row) => row.requestedMutation },
            { key: "allowed", header: "Allowed", render: (row) => <StatusBadge value={row.allowedMutation ? "allowed" : "blocked"} label={row.allowedMutation ? "allowed" : "blocked"} /> },
            { key: "http", header: "HTTP Outcome", render: (row) => row.httpOutcome },
            { key: "order", header: "Mutation Order", render: (row) => row.mutationOrder },
            { key: "quarantine", header: "Quarantine Outcome", render: (row) => <StatusBadge value={row.quarantineOutcome === "clear" ? "allowed" : "blocked"} label={row.quarantineOutcome} /> },
            { key: "role", header: "Required Role", render: (row) => row.requiredOperatorRole },
            { key: "second", header: "Second Review Gate", render: (row) => <StatusBadge value={row.secondReviewGate === "pass" || row.secondReviewGate === "not_required" ? "healthy" : "blocked"} label={row.secondReviewGate} /> },
            { key: "evidence", header: "Evidence Gate", render: (row) => <StatusBadge value={row.evidenceGate === "pass" ? "healthy" : "blocked"} label={row.evidenceGate} /> },
            { key: "deadline", header: "Deadline Gate", render: (row) => <StatusBadge value={row.deadlineGate === "pass" ? "healthy" : "blocked"} label={row.deadlineGate} /> },
            { key: "activation", header: "Activation Gate", render: (row) => <StatusBadge value={row.activationGate === "pass" ? "allowed" : "blocked"} label={row.activationGate} /> },
            { key: "fixtures", header: "Regression Fixtures", render: (row) => row.regressionFixtureRefs.join(", ") },
            { key: "release", header: "Release Evidence", render: (row) => <StatusBadge value={row.releaseEvidenceDisposition === "can_cite_release_evidence" ? "approved" : "blocked"} label={row.releaseEvidenceDisposition} /> },
            { key: "blockers", header: "Blockers", render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none") },
            { key: "message", header: "Support Message", render: (row) => row.supportVisibleMessage },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Staging Crawler Governance Runtime Evidence</h3>
            <p>Staging fetch/import probes must cover source approval, robots, SSRF, rate limits, retention, exact-text warnings, provenance, and blocklist controls.</p>
          </div>
        </div>
        <DataTable<CrawlerStagingRuntimeEvidence>
          rows={stagingRuntimeEvidence}
          columns={[
            { key: "id", header: "ID", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "validated", header: "Validated At", render: (row) => row.validatedAt },
            { key: "role", header: "Validated By", render: (row) => row.validatedByRole },
            { key: "path", header: "Evidence Path", render: (row) => <span className="mono">{row.evidencePath}</span> },
            { key: "check", header: "Release Gate Check", render: (row) => row.releaseGateCheckId },
            {
              key: "controls",
              header: "Runtime Controls",
              render: (row) => row.controls.map((control) => `${control.control}:${control.gateDecision}`).join(", ")
            },
            { key: "blockers", header: "Remaining Blockers", render: (row) => row.remainingBlockers.join(" ") }
          ]}
        />
      </section>
    </>
  );
}
