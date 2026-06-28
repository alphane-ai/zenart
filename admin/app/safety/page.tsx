import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { RbacOverrideAttemptDecisionTable } from "@/components/RbacOverrideAttemptDecisionTable";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacOverrideAttemptDecisions,
  getAdminRbacRuntimeDecisions,
  getRiskyExports,
  getStagingEvalQaSafetyEvidence
} from "@/lib/admin-api";
import type { AdminRbacEvidence, RiskyExport, StagingEvalQaSafetyCoverage } from "@/lib/types";

export default async function SafetyPage() {
  const [exports, rbacEvidence, rbacRuntime, rbacAttemptDecisions, stagingEvidence] = await Promise.all([
    getRiskyExports(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacOverrideAttemptDecisions(),
    getStagingEvalQaSafetyEvidence()
  ]);
  const safetyRbacEvidence = rbacEvidence.filter((item) => item.surface === "safety_rule" || item.surface === "export_override");
  const safetyRbacRuntime = rbacRuntime.filter((item) => item.surface === "safety_rule" || item.surface === "export_override");
  const safetyRbacAttemptDecisions = rbacAttemptDecisions.filter((item) => item.surface === "safety_rule" || item.surface === "export_override");

  return (
    <>
      <PageHeader
        title="Safety and Risky Export Queue"
        description="Safety policy queue for risky exports, enforcement points, admin override eligibility, and audit requirements."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Safety Review Queue</h3>
            <p>API-backed queue for risky exports and safety decisions; fixture fallback is used only when the admin backend is unavailable.</p>
          </div>
          <StatusBadge
            value={exports.some((row) => row.source === "api") ? "healthy" : "warning"}
            label={exports.some((row) => row.source === "api") ? "live api" : "fixture fallback"}
          />
        </div>
        <DataTable<RiskyExport>
          rows={exports}
          columns={[
            { key: "export", header: "Export", render: (row) => <span className="mono">{row.exportId}</span> },
            { key: "decision-id", header: "Safety Decision", render: (row) => <span className="mono">{row.safetyDecisionId ?? row.id}</span> },
            { key: "rule", header: "Rule", render: (row) => row.rule },
            { key: "point", header: "Enforcement", render: (row) => row.enforcementPoint },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
            { key: "action", header: "Action", render: (row) => <StatusBadge value={row.action === "block" ? "blocked" : "warning"} label={row.action} /> },
            { key: "review-status", header: "Review Status", render: (row) => <StatusBadge value={row.reviewStatus === "approved" ? "approved" : row.reviewStatus === "pending" ? "warning" : "blocked"} label={row.reviewStatus ?? "fixture"} /> },
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
            { key: "outcome", header: "User Outcome", render: (row) => row.userVisibleOutcome ?? "review policy pending" },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.requiredEvidenceRefs?.join(", ") ?? "fixture evidence" },
            { key: "audit-ref", header: "Audit Ref", render: (row) => (row.auditRef ? <span className="mono">{row.auditRef}</span> : "pending") },
            { key: "rationale", header: "Review Rationale", render: (row) => row.reviewRationale }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Staging Eval QA Safety Runtime Evidence</h3>
            <p>Check-level private beta evidence for brief, provider request, provider response, QA, and export safety enforcement.</p>
          </div>
          <StatusBadge value={stagingEvidence.status === "pass" ? "approved" : "blocked"} label={stagingEvidence.status} />
        </div>
        <DataTable<StagingEvalQaSafetyCoverage>
          rows={stagingEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "pass" ? "approved" : "blocked"} label={row.status} /> },
            { key: "probe", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "external", header: "External User Evidence", render: (row) => row.externalUserEvidence },
            { key: "enforcement", header: "Enforcement Evidence", render: (row) => row.enforcementEvidence },
            { key: "refs", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
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
            { key: "rationale", header: "Rationale", render: (row) => row.rationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Safety and Export Override RBAC Runtime Decisions</h3>
            <p>Computed safety and export outcomes deny forbidden-claim relaxation and non-eligible blocking QA overrides at runtime.</p>
          </div>
        </div>
        <RbacRuntimeDecisionTable rows={safetyRbacRuntime} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Safety and Export Override RBAC Override Attempt Evidence</h3>
            <p>Request-level evidence proves safety and export override attempts preserve idempotency, state digest, HTTP outcome, audit, and non-overridable QA or policy blockers.</p>
          </div>
        </div>
        <RbacOverrideAttemptDecisionTable rows={safetyRbacAttemptDecisions} />
      </section>
    </>
  );
}
