import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getCrawlerFindings } from "@/lib/admin-api";
import type { CrawlerFinding } from "@/lib/types";

export default async function CrawlerReviewPage() {
  const findings = await getCrawlerFindings();

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
    </>
  );
}
