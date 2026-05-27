import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { RbacOverrideAttemptDecisionTable } from "@/components/RbacOverrideAttemptDecisionTable";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacOverrideAttemptDecisions,
  getAdminRbacRuntimeDecisions,
  getPromptFragments
} from "@/lib/admin-api";
import type { AdminRbacEvidence, PromptFragment } from "@/lib/types";

export default async function PromptFragmentsPage() {
  const [fragments, rbacEvidence, rbacRuntime, rbacAttemptDecisions] = await Promise.all([
    getPromptFragments(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacOverrideAttemptDecisions()
  ]);
  const promptRbacEvidence = rbacEvidence.filter((item) => item.surface === "prompt_approval");
  const promptRbacRuntime = rbacRuntime.filter((item) => item.surface === "prompt_approval");
  const promptRbacAttemptDecisions = rbacAttemptDecisions.filter((item) => item.surface === "prompt_approval");

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
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "api", header: "API Scope", render: (row) => <span className="mono">{row.apiScope}</span> },
            { key: "mutation", header: "Mutation Outcome", render: (row) => <StatusBadge value={row.mutationOutcome === "applied" ? "healthy" : row.mutationOutcome === "queued_for_review" ? "warning" : "blocked"} label={row.mutationOutcome} /> },
            { key: "duration-policy", header: "Duration Policy", render: (row) => row.overrideDurationPolicy },
            { key: "starts", header: "Override Start", render: (row) => row.overrideStartedAt },
            { key: "expires", header: "Override Expiration", render: (row) => row.overrideExpiresAt },
            { key: "expiry-enforced", header: "Expiry Enforced", render: (row) => (row.expiryEnforced ? "Yes" : "No") },
            { key: "pre-state", header: "Pre-Override State", render: (row) => row.preOverrideState },
            { key: "expiry-action", header: "Expiry Action", render: (row) => row.expiryAction },
            { key: "stale-probe", header: "Stale Override Probe", render: (row) => row.staleOverrideProbe },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post-decision", header: "Post Decision Control", render: (row) => row.postDecisionControl },
            { key: "release-required", header: "Release Evidence Required", render: (row) => row.releaseEvidenceRequired.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Prompt Approval RBAC Runtime Decisions</h3>
            <p>Computed prompt activation outcomes prevent support-attached feedback from becoming active prompt material without reviewer runtime evidence.</p>
          </div>
        </div>
        <RbacRuntimeDecisionTable rows={promptRbacRuntime} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Prompt Approval RBAC Override Attempt Evidence</h3>
            <p>Request-level evidence proves prompt activation attempts preserve idempotency, state digest, HTTP outcome, audit, and eval or QA blockers.</p>
          </div>
        </div>
        <RbacOverrideAttemptDecisionTable rows={promptRbacAttemptDecisions} />
      </section>
    </>
  );
}
