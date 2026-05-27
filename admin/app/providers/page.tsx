import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { RbacOverrideAttemptDecisionTable } from "@/components/RbacOverrideAttemptDecisionTable";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacOverrideAttemptDecisions,
  getAdminRbacRuntimeDecisions,
  getProductionProviderModeEvidence,
  getProviderHealth
} from "@/lib/admin-api";
import type { AdminRbacEvidence, ProductionProviderModeCoverage, ProductionProviderModeEvidence, ProviderHealth } from "@/lib/types";

export default async function ProviderHealthPage() {
  const [providers, rbacEvidence, rbacRuntime, rbacAttemptDecisions, productionProviderModeEvidence] = await Promise.all([
    getProviderHealth(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacOverrideAttemptDecisions(),
    getProductionProviderModeEvidence()
  ]);
  const providerRbacEvidence = rbacEvidence.filter((item) => item.surface === "provider_routing");
  const providerRbacRuntime = rbacRuntime.filter((item) => item.surface === "provider_routing");
  const providerRbacAttemptDecisions = rbacAttemptDecisions.filter((item) => item.surface === "provider_routing");

  return (
    <>
      <PageHeader
        title="Provider Health"
        description="Provider, model, spend-cap, error-rate, and routing action dashboard."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Providers</h3>
            <p>Operations can reduce routing load or block providers while preserving QA enforcement.</p>
          </div>
        </div>
        <DataTable<ProviderHealth>
          rows={providers}
          columns={[
            { key: "provider", header: "Provider", render: (row) => row.provider },
            { key: "model", header: "Model", render: (row) => row.model },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "latency", header: "P95 Latency", render: (row) => `${row.p95LatencyMs} ms` },
            { key: "errors", header: "Error Rate", render: (row) => `${(row.errorRate * 100).toFixed(1)}%` },
            { key: "spend", header: "Spend Cap", render: (row) => `${row.spendCapUsedPercent}%` },
            { key: "action", header: "Routing Action", render: (row) => row.routingAction },
            { key: "contract", header: "Contract Evidence", render: (row) => row.contractEvidence },
            { key: "canary", header: "Canary Evidence", render: (row) => row.canaryEvidence },
            { key: "release", header: "Release Evidence", render: (row) => row.releaseEvidence }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Production Provider Mode Evidence</h3>
            <p>Production provider evidence binds launch mode, provider contract, monitoring, cost records, and public paid/real-generation claims while preserving unrelated launch blockers.</p>
          </div>
        </div>
        <DataTable<ProductionProviderModeEvidence>
          rows={[productionProviderModeEvidence]}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "role", header: "Validated By", render: (row) => row.validatedByRole },
            { key: "check", header: "Release Gate Check", render: (row) => row.releaseGateCheckId },
            { key: "conditions", header: "Cleared Conditions", render: (row) => row.doNotLaunchConditionIds.join(", ") },
            { key: "provider-path", header: "Provider Evidence", render: (row) => row.providerModeEvidencePath },
            { key: "claims-path", header: "Claims Evidence", render: (row) => row.publicClaimsEvidencePath },
            { key: "clear", header: "Can Clear Rows", render: (row) => (row.gateImpact.canClearCheckLevelItems ? "yes" : "no") },
            { key: "aggregate", header: "Aggregate Gate", render: (row) => row.gateImpact.aggregateProductionGateStatus },
            { key: "remaining", header: "Remaining Blockers", render: (row) => row.gateImpact.remainingBlockers.join(", ") }
          ]}
        />
        <DataTable<ProductionProviderModeCoverage>
          rows={productionProviderModeEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Validation", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "runtime", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "deployment", header: "Deployment Evidence", render: (row) => row.deploymentEvidence },
            { key: "audit", header: "Provider Audit Evidence", render: (row) => row.providerAuditEvidence },
            { key: "artifacts", header: "Admin Artifacts", render: (row) => row.linkedAdminArtifacts.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Provider Routing RBAC Evidence</h3>
            <p>Provider routing changes must prove attempted role, required role, audit ref, and safety-preserving rationale before traffic shifts.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={providerRbacEvidence}
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
            <h3>Provider Routing RBAC Runtime Decisions</h3>
            <p>Computed provider routing outcomes distinguish live temporary routing changes from expired overrides that must preserve the prior audited state.</p>
          </div>
        </div>
        <RbacRuntimeDecisionTable rows={providerRbacRuntime} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Provider Routing RBAC Override Attempt Evidence</h3>
            <p>Request-level evidence proves provider routing mutations preserve idempotency, state digest, expected HTTP outcome, audit, expiry, and no-silent-fallback blockers.</p>
          </div>
        </div>
        <RbacOverrideAttemptDecisionTable rows={providerRbacAttemptDecisions} />
      </section>
    </>
  );
}
