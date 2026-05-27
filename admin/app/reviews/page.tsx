import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacRuntimeDecisions,
  getAdminRbacSurfaceSummaries,
  getAdminReviewDecisions
} from "@/lib/admin-api";
import type {
  AdminRbacEvidence,
  AdminRbacRuntimeDecision,
  AdminRbacSurfaceSummary,
  AdminReviewDecision
} from "@/lib/types";

export default async function ReviewsPage() {
  const [reviews, rbacEvidence, rbacRuntime, rbacSurfaceSummaries] = await Promise.all([
    getAdminReviewDecisions(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacSurfaceSummaries()
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
            <h3>RBAC Runtime Decisions</h3>
            <p>Effective override outcomes are evaluated from role rank, second-review state, policy blocks, expiry, mutation result, and audit evidence.</p>
          </div>
        </div>
        <DataTable<AdminRbacRuntimeDecision>
          rows={rbacRuntime}
          columns={[
            { key: "evidence", header: "Evidence", render: (row) => <span className="mono">{row.evidenceId}</span> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "enforcement", header: "Enforcement", render: (row) => row.enforcementPoint },
            { key: "window", header: "Override Window", render: (row) => <StatusBadge value={row.overrideWindow} label={row.overrideWindow} /> },
            { key: "decision", header: "Effective Decision", render: (row) => <StatusBadge value={row.effectiveDecision === "allow_mutation" ? "allowed" : row.effectiveDecision === "queue_for_review" ? "warning" : "denied"} label={row.effectiveDecision} /> },
            { key: "outcome", header: "Request Outcome", render: (row) => row.requestOutcome },
            { key: "mutation", header: "Mutation Allowed", render: (row) => (row.mutationAllowed ? "Yes" : "No") },
            { key: "queue", header: "Queue Action", render: (row) => row.queueAction },
            { key: "gate", header: "Release Gate Status", render: (row) => row.releaseGateStatus },
            { key: "pre-state", header: "Pre-Override State", render: (row) => row.preOverrideState },
            { key: "expiry-action", header: "Expiry Action", render: (row) => row.expiryAction },
            { key: "stale-probe", header: "Stale Override Probe", render: (row) => row.staleOverrideProbe },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Runtime Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Override Surface Summary</h3>
            <p>Release, crawler, prompt, provider, quota, safety, and export override surfaces are grouped by runtime outcome, audit ref, and required release evidence.</p>
          </div>
        </div>
        <DataTable<AdminRbacSurfaceSummary>
          rows={rbacSurfaceSummaries}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "summary", header: "Decision Summary", render: (row) => row.decisionSummary },
            { key: "gates", header: "Release Gate Statuses", render: (row) => row.releaseGateStatuses.join(", ") },
            { key: "action", header: "Operator Action", render: (row) => row.operatorAction },
            { key: "evidence", header: "Release Evidence Required", render: (row) => row.releaseEvidenceRequired.join(", ") },
            { key: "audit", header: "Audit Refs", render: (row) => <span className="mono">{row.auditRefs.join(", ")}</span> }
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
            { key: "api", header: "API Scope", render: (row) => <span className="mono">{row.apiScope}</span> },
            { key: "mutation", header: "Mutation Outcome", render: (row) => <StatusBadge value={row.mutationOutcome === "applied" ? "healthy" : row.mutationOutcome === "queued_for_review" ? "warning" : "blocked"} label={row.mutationOutcome} /> },
            { key: "starts", header: "Override Start", render: (row) => row.overrideStartedAt },
            { key: "expires", header: "Override Expiration", render: (row) => row.overrideExpiresAt },
            { key: "pre-state", header: "Pre-Override State", render: (row) => row.preOverrideState },
            { key: "expiry-action", header: "Expiry Action", render: (row) => row.expiryAction },
            { key: "stale-probe", header: "Stale Override Probe", render: (row) => row.staleOverrideProbe },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post-decision", header: "Post Decision Control", render: (row) => row.postDecisionControl },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>
    </>
  );
}
