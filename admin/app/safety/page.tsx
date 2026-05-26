import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminRbacEvidence, getRiskyExports } from "@/lib/admin-api";
import type { AdminRbacEvidence, RiskyExport } from "@/lib/types";

export default async function SafetyPage() {
  const [exports, rbacEvidence] = await Promise.all([
    getRiskyExports(),
    getAdminRbacEvidence()
  ]);
  const safetyRbacEvidence = rbacEvidence.filter((item) => item.surface === "safety_rule" || item.surface === "export_override");

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

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Safety and Export Override RBAC</h3>
            <p>Safety rule and risky export overrides must prove role eligibility and still deny non-overridable blocking QA failures.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={safetyRbacEvidence}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post-decision", header: "Post Decision Control", render: (row) => row.postDecisionControl },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
