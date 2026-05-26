import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getCrawlerFindings,
  getCrawlerGovernanceWorkflows,
  getCrawlerSourceApprovals,
  getCrawlerStagingRuntimeEvidence
} from "@/lib/admin-api";
import type {
  AdminRbacEvidence,
  CrawlerFinding,
  CrawlerGovernanceWorkflow,
  CrawlerSourceApproval,
  CrawlerStagingRuntimeEvidence
} from "@/lib/types";

export default async function CrawlerReviewPage() {
  const [findings, sourceApprovals, governanceWorkflows, stagingRuntimeEvidence, rbacEvidence] = await Promise.all([
    getCrawlerFindings(),
    getCrawlerSourceApprovals(),
    getCrawlerGovernanceWorkflows(),
    getCrawlerStagingRuntimeEvidence(),
    getAdminRbacEvidence()
  ]);
  const crawlerRbacEvidence = rbacEvidence.filter((item) => item.surface === "crawler_import");

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
            <h3>Crawler Import RBAC Evidence</h3>
            <p>Crawler import, source activation, takedown, and derivative-use changes must keep RBAC evidence visible beside review workflow evidence.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={crawlerRbacEvidence}
          columns={[
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post-decision", header: "Post Decision Control", render: (row) => row.postDecisionControl },
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
            { key: "activation", header: "Activation", render: (row) => <StatusBadge value={row.activationGateDecision} label={row.activationGateDecision} /> },
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
