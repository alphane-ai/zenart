import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatGrid } from "@/components/StatGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { getAnalyticsReports } from "@/lib/admin-api";
import type { AnalyticsReport } from "@/lib/types";

function reportStatusTone(status: AnalyticsReport["status"]) {
  if (status === "healthy") {
    return "healthy";
  }

  return status === "watch" ? "warning" : "blocked";
}

export default async function AnalyticsPage() {
  const reports = await getAnalyticsReports();
  const blockedReports = reports.filter((report) => report.status === "blocked");
  const watchReports = reports.filter((report) => report.status === "watch");
  const totalSamples = reports.reduce((sum, report) => sum + report.sampleSize, 0);

  return (
    <>
      <PageHeader
        title="Analytics Reports"
        description="Admin go/no-go reporting for Stage 0 workflow funnel, QA, cost, support, and failure metrics."
      />

      <StatGrid
        stats={[
          {
            label: "Reports",
            value: reports.length,
            detail: "Stage 0 analytics surfaces"
          },
          {
            label: "Watch",
            value: watchReports.length,
            detail: "metrics near a release threshold"
          },
          {
            label: "Blocked",
            value: blockedReports.length,
            detail: "go/no-go blockers"
          },
          {
            label: "Samples",
            value: totalSamples,
            detail: "fixture-backed event samples"
          }
        ]}
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Product Analytics</h3>
            <p>Reports cover first prompt to four candidates, selection, iteration, package/export completion, weekly return, QA, cost, and support failure rate.</p>
          </div>
        </div>
        <DataTable<AnalyticsReport>
          rows={reports}
          columns={[
            { key: "name", header: "Report", render: (row) => row.name.replaceAll("_", " ") },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={reportStatusTone(row.status)} label={row.status} /> },
            { key: "value", header: "Value", render: (row) => row.value },
            { key: "target", header: "Target", render: (row) => row.target },
            { key: "window", header: "Window", render: (row) => row.window },
            { key: "samples", header: "Samples", render: (row) => row.sampleSize },
            { key: "segment", header: "Segment", render: (row) => row.segment },
            { key: "events", header: "Source Events", render: (row) => row.sourceEvents.join(", ") },
            { key: "decision", header: "Decision Use", render: (row) => row.decisionUse }
          ]}
        />
      </section>
    </>
  );
}
