import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminReviewDecisions } from "@/lib/admin-api";
import type { AdminReviewDecision } from "@/lib/types";

export default async function ReviewsPage() {
  const reviews = await getAdminReviewDecisions();

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
    </>
  );
}
