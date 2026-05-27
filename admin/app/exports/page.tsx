import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminRbacEvidence, getExportJobs } from "@/lib/admin-api";
import type { AdminRbacEvidence, ExportJob } from "@/lib/types";

export default async function ExportsPage() {
  const [jobs, rbacEvidence] = await Promise.all([
    getExportJobs(),
    getAdminRbacEvidence()
  ]);
  const exportRbacEvidence = rbacEvidence.filter((item) => item.surface === "export_override");

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
            { key: "rbac", header: "RBAC Decision", render: (row) => <StatusBadge value={row.rbacDecision} label={row.rbacDecision} /> },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "quota", header: "Quota Effect", render: (row) => row.quotaEffect },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "reason", header: "Reason", render: (row) => row.failureReason }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Export Override RBAC Evidence</h3>
            <p>Export release overrides must prove non-override eligibility, trace provenance, safety decisions, immutable audit, and release-gate preservation.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={exportRbacEvidence}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "target", header: "Target", render: (row) => row.target },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => row.secondReviewStatus },
            { key: "api", header: "API Scope", render: (row) => <span className="mono">{row.apiScope}</span> },
            { key: "mutation", header: "Mutation Outcome", render: (row) => row.mutationOutcome },
            { key: "duration-policy", header: "Duration Policy", render: (row) => row.overrideDurationPolicy },
            { key: "expires", header: "Override Expiration", render: (row) => row.overrideExpiresAt },
            { key: "expiry", header: "Expiry Enforced", render: (row) => (row.expiryEnforced ? "Yes" : "No") },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post", header: "Post Decision Control", render: (row) => row.postDecisionControl },
            { key: "release-required", header: "Release Evidence Required", render: (row) => row.releaseEvidenceRequired.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
    </>
  );
}
