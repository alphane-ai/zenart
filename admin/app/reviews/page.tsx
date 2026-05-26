import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminRbacEvidence, getAdminReviewDecisions } from "@/lib/admin-api";
import type { AdminRbacEvidence, AdminReviewDecision } from "@/lib/types";

export default async function ReviewsPage() {
  const [reviews, rbacEvidence] = await Promise.all([
    getAdminReviewDecisions(),
    getAdminRbacEvidence()
  ]);

  return (
    <>
      <PageHeader
        title="Review Queue"
        description="Admin review queue for release, routing, safety, quota, crawler, prompt, and export decisions."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Governed Decisions</h3>
            <p>Each decision carries diff, provenance, eval, QA, risk, rationale, evidence refs, and second-review state.</p>
          </div>
        </div>
        <DataTable<AdminReviewDecision>
          rows={reviews}
          columns={[
            { key: "created", header: "Created", render: (row) => row.createdAt },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "risk", header: "Risk", render: (row) => <StatusBadge value={row.risk} /> },
            { key: "reviewer", header: "Reviewer", render: (row) => row.reviewer },
            {
              key: "second-review",
              header: "Second Review",
              render: (row) => (
                <StatusBadge
                  value={row.secondReviewRequired ? "high" : "approved"}
                  label={row.secondReviewRequired ? row.secondReviewer : "Not required"}
                />
              )
            },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale },
            { key: "diff", header: "Diff", render: (row) => row.diffSummary },
            { key: "provenance", header: "Provenance", render: (row) => row.provenance },
            { key: "eval", header: "Eval", render: (row) => row.evalSummary },
            { key: "qa", header: "QA", render: (row) => row.qaSummary },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Admin RBAC Evidence</h3>
            <p>Release, crawler, prompt, provider, quota, safety, and export overrides require role checks, rationale, evidence refs, and audit linkage.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={rbacEvidence}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "action", header: "Requested Action", render: (row) => row.requestedAction },
            { key: "enforcement", header: "Enforcement Point", render: (row) => row.enforcementPoint },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            {
              key: "second-review",
              header: "Second Review",
              render: (row) => (
                <StatusBadge
                  value={row.secondReviewRequired ? row.secondReviewStatus : "approved"}
                  label={row.secondReviewRequired ? row.secondReviewStatus : "Not required"}
                />
              )
            },
            { key: "gate", header: "Release Gate Impact", render: (row) => row.releaseGateImpact },
            { key: "outcome", header: "User Outcome", render: (row) => row.userVisibleOutcome },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>
    </>
  );
}
