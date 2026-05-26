import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getCrawlerFindings, getCrawlerGovernanceWorkflows, getCrawlerSourceApprovals } from "@/lib/admin-api";
import type { CrawlerFinding, CrawlerGovernanceWorkflow, CrawlerSourceApproval } from "@/lib/types";

export default async function CrawlerReviewPage() {
  const [findings, sourceApprovals, governanceWorkflows] = await Promise.all([
    getCrawlerFindings(),
    getCrawlerSourceApprovals(),
    getCrawlerGovernanceWorkflows()
  ]);

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
            { key: "requester", header: "Requester", render: (row) => row.requester },
            { key: "contact", header: "Source Contact", render: (row) => row.sourceContact },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "derivative", header: "Derivative Use", render: (row) => <StatusBadge value={row.derivativeUseStatus} label={row.derivativeUseStatus} /> },
            { key: "retention", header: "Retention Action", render: (row) => row.rawRetentionAction },
            { key: "activation", header: "Activation", render: (row) => (row.blockedActivation ? <StatusBadge value="blocked" label="blocked" /> : <StatusBadge value="approved" label="allowed" />) },
            { key: "review", header: "Linked Review", render: (row) => <span className="mono">{row.linkedReview}</span> },
            { key: "fixture", header: "Fixture Case", render: (row) => row.fixtureCaseId },
            { key: "role", header: "Reviewer Role", render: (row) => row.reviewerRole },
            { key: "next", header: "Operator Next Action", render: (row) => row.operatorNextAction },
            { key: "closure", header: "Closure Criteria", render: (row) => row.closureCriteria },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.requiredEvidenceRefs.join(", ") },
            { key: "rationale", header: "Review Rationale", render: (row) => row.reviewRationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
