import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { RbacOverrideAttemptDecisionTable } from "@/components/RbacOverrideAttemptDecisionTable";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ProviderRegistryControls } from "./ProviderRegistryControls";
import {
  getAdminRbacEvidence,
  getAdminRbacOverrideAttemptDecisions,
  getAdminRbacRuntimeDecisions,
  getProductionProviderModeEvidence,
  getProviderHealth,
  getProviderRegistry,
  getProviderStrategyGroups
} from "@/lib/admin-api";
import type {
  AdminRbacEvidence,
  ProductionProviderModeCoverage,
  ProductionProviderModeEvidence,
  ProviderHealth,
  ProviderRegistryEntry,
  ProviderStrategyGroup
} from "@/lib/types";

export default async function ProviderHealthPage({
  searchParams
}: {
  searchParams?: Promise<{
    registry_create?: string;
    registry_update?: string;
    registry_delete?: string;
    strategy_create?: string;
    strategy_update?: string;
    provider_health_probe?: string;
    provider_test?: string;
    provider_id?: string;
  }>;
}) {
  const params = (await searchParams) ?? {};
  const [providerRegistry, providerStrategyGroups, providers, rbacEvidence, rbacRuntime, rbacAttemptDecisions, productionProviderModeEvidence] = await Promise.all([
    getProviderRegistry(),
    getProviderStrategyGroups(),
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
            <h3>Provider Registry</h3>
            <p>Admin registry view for provider modes, capabilities, health, routing, and secret-reference presence.</p>
          </div>
          <StatusBadge
            value={providerRegistry.source === "api" ? "healthy" : "warning"}
            label={providerRegistry.source === "api" ? "live api" : "fixture fallback"}
          />
        </div>
        {providerRegistry.error ? <p className="muted">Registry API fallback: {providerRegistry.error}</p> : null}
        <DataTable<ProviderRegistryEntry>
          rows={providerRegistry.items}
          columns={[
            { key: "provider", header: "Provider", render: (row) => row.display_name },
            { key: "id", header: "Provider ID", render: (row) => <span className="mono">{row.provider_id}</span> },
            { key: "mode", header: "Mode", render: (row) => <StatusBadge value={row.mode} label={row.mode} /> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "models", header: "Models", render: (row) => row.capabilities.map((capability) => capability.model_id).join(", ") },
            { key: "tools", header: "Tool Types", render: (row) => Array.from(new Set(row.capabilities.flatMap((capability) => capability.tool_types ?? []))).join(", ") || "none" },
            { key: "batch", header: "Batch", render: (row) => (row.capabilities.some((capability) => capability.supports_batch) ? "yes" : "no") },
            { key: "routing", header: "Routing", render: (row) => `weight ${row.routing.weight}, canary ${row.routing.canary_percent}%` },
            { key: "concurrency", header: "Concurrency", render: (row) => row.routing.max_concurrency },
            { key: "health", header: "Health", render: (row) => <StatusBadge value={row.health.available ? "available" : "blocked"} label={`${row.health.latency_ms} ms / ${row.health.error_rate_percent}%`} /> },
            { key: "secret", header: "Secret Ref", render: (row) => (row.secret_present ? <span className="mono">{row.secret_ref}</span> : "not required") },
            { key: "updated", header: "Updated", render: (row) => row.updated_at }
          ]}
        />
      </section>
      <ProviderRegistryControls
        items={providerRegistry.items}
        strategyGroups={providerStrategyGroups.items}
        source={providerRegistry.source}
        createState={params.registry_create}
        updateState={params.registry_update}
        deleteState={params.registry_delete}
        healthProbeState={params.provider_health_probe}
        updateProviderID={params.provider_id}
        testState={params.provider_test}
        testProviderID={params.provider_id}
        strategyCreateState={params.strategy_create}
        strategyUpdateState={params.strategy_update}
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Provider Strategy Groups</h3>
            <p>Strategy groups bind tool surfaces to provider membership, weighted traffic, canary, failover, concurrency, and kill switch settings.</p>
          </div>
          <StatusBadge
            value={providerStrategyGroups.source === "api" ? "healthy" : "warning"}
            label={providerStrategyGroups.source === "api" ? "live api" : "fixture fallback"}
          />
        </div>
        {providerStrategyGroups.error ? <p className="muted">Strategy group API fallback: {providerStrategyGroups.error}</p> : null}
        <DataTable<ProviderStrategyGroup>
          rows={providerStrategyGroups.items}
          columns={[
            { key: "group", header: "Group", render: (row) => row.display_name },
            { key: "id", header: "Group ID", render: (row) => <span className="mono">{row.group_id}</span> },
            { key: "tool", header: "Tool", render: (row) => row.tool_type },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "policy", header: "Policy", render: (row) => row.selection_policy },
            { key: "members", header: "Members", render: (row) => row.members.map((member) => `${member.provider_id}:${member.weight}`).join(", ") },
            { key: "fallback", header: "Fallback", render: (row) => (row.fallback_provider_ids ?? []).join(", ") || "none" },
            { key: "kill", header: "Kill Switch", render: (row) => (row.kill_switch ? "on" : "off") },
            { key: "updated", header: "Updated", render: (row) => row.updated_at }
          ]}
        />
      </section>
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
