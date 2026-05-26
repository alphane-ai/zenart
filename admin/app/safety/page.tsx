import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getRiskyExports } from "@/lib/admin-api";
import type { RiskyExport } from "@/lib/types";

export default async function SafetyPage() {
  const exports = await getRiskyExports();

  return (
    <>
      <PageHeader
        title="Safety and Risky Export Queue"
        description="Safety policy queue for risky exports, enforcement points, admin override eligibility, and audit requirements."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Risky Exports</h3>
            <p>Rules can allow, warn, require user confirmation, require admin review, or block.</p>
          </div>
        </div>
        <DataTable<RiskyExport>
          rows={exports}
          columns={[
            { key: "export", header: "Export", render: (row) => <span className="mono">{row.exportId}</span> },
            { key: "rule", header: "Rule", render: (row) => row.rule },
            { key: "point", header: "Enforcement", render: (row) => row.enforcementPoint },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
            { key: "action", header: "Action", render: (row) => <StatusBadge value={row.action === "block" ? "blocked" : "warning"} label={row.action} /> },
            { key: "override", header: "Override", render: (row) => (row.overrideEligible ? "Eligible" : "Not eligible") },
            { key: "audit", header: "Audit", render: (row) => (row.auditRequired ? "Required" : "Optional") },
            {
              key: "second-review",
              header: "Second Review",
              render: (row) => (
                <StatusBadge
                  value={row.secondReviewRequired ? "high" : "approved"}
                  label={row.secondReviewRequired ? "Required" : "Not required"}
                />
              )
            },
            { key: "rationale", header: "Review Rationale", render: (row) => row.reviewRationale }
          ]}
        />
      </section>
    </>
  );
}
