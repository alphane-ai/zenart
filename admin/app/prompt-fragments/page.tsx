import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminRbacEvidence, getPromptFragments } from "@/lib/admin-api";
import type { AdminRbacEvidence, PromptFragment } from "@/lib/types";

export default async function PromptFragmentsPage() {
  const [fragments, rbacEvidence] = await Promise.all([
    getPromptFragments(),
    getAdminRbacEvidence()
  ]);
  const promptRbacEvidence = rbacEvidence.filter((item) => item.surface === "prompt_approval");

  return (
    <>
      <PageHeader
        title="Prompt Fragment Review"
        description="Prompt candidates are reviewed with diffs, provenance, eval summaries, and risk labels before activation."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Candidate Fragments</h3>
            <p>Feedback can influence candidates but cannot bypass review and regression fixtures.</p>
          </div>
        </div>
        <DataTable<PromptFragment>
          rows={fragments}
          columns={[
            { key: "name", header: "Name", render: (row) => <strong>{row.name}</strong> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "risk", header: "Risk", render: (row) => <StatusBadge value={row.risk} /> },
            { key: "diff", header: "Diff", render: (row) => row.diffSummary },
            { key: "eval", header: "Eval", render: (row) => row.evalSummary }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Prompt Approval RBAC Evidence</h3>
            <p>Prompt fragment approval requires reviewer role evidence, audit ref, rationale, and linked feedback or regression fixture evidence before activation.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={promptRbacEvidence}
          columns={[
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "api", header: "API Scope", render: (row) => <span className="mono">{row.apiScope}</span> },
            { key: "mutation", header: "Mutation Outcome", render: (row) => <StatusBadge value={row.mutationOutcome === "applied" ? "healthy" : row.mutationOutcome === "queued_for_review" ? "warning" : "blocked"} label={row.mutationOutcome} /> },
            { key: "expires", header: "Override Expiration", render: (row) => row.overrideExpiresAt },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post-decision", header: "Post Decision Control", render: (row) => row.postDecisionControl },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
    </>
  );
}
