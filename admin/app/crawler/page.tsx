import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getCrawlerFindings, getCrawlerGovernanceWorkflows } from "@/lib/admin-api";
import type { CrawlerFinding, CrawlerGovernanceWorkflow } from "@/lib/types";

export default async function CrawlerReviewPage() {
  const [findings, governanceWorkflows] = await Promise.all([
    getCrawlerFindings(),
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
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "derivative", header: "Derivative Use", render: (row) => <StatusBadge value={row.derivativeUseStatus} label={row.derivativeUseStatus} /> },
            { key: "retention", header: "Retention Action", render: (row) => row.rawRetentionAction },
            { key: "activation", header: "Activation", render: (row) => (row.blockedActivation ? <StatusBadge value="blocked" label="blocked" /> : <StatusBadge value="approved" label="allowed" />) },
            { key: "role", header: "Reviewer Role", render: (row) => row.reviewerRole },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.requiredEvidenceRefs.join(", ") },
            { key: "rationale", header: "Review Rationale", render: (row) => row.reviewRationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
