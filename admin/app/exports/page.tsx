import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getExportJobs } from "@/lib/admin-api";
import type { ExportJob } from "@/lib/types";

export default async function ExportsPage() {
  const jobs = await getExportJobs();

  return (
    <>
      <PageHeader
        title="Export Jobs"
        description="Export job detail and regenerate eligibility for failed or blocked packages."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Jobs</h3>
            <p>Final exports remain blocked when QA is blocking unless an eligible audited override exists.</p>
          </div>
        </div>
        <DataTable<ExportJob>
          rows={jobs}
          columns={[
            { key: "id", header: "Export", render: (row) => <Link className="mono" href={`/exports/${row.id}`}>{row.id}</Link> },
            { key: "user", header: "User", render: (row) => row.userId },
            { key: "package", header: "Package", render: (row) => row.packageId },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "qa", header: "QA", render: (row) => <StatusBadge value={row.qaSeverity === "blocking" ? "blocked" : row.qaSeverity} label={row.qaSeverity} /> },
            { key: "regen", header: "Regenerate", render: (row) => (row.regenerateEligible ? "Eligible" : "Not eligible") },
            { key: "reason", header: "Reason", render: (row) => row.failureReason }
          ]}
        />
      </section>
    </>
  );
}
