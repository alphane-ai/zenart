import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatGrid } from "@/components/StatGrid";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacClosureMatrix,
  getAdminRbacEvidencePacks,
  getAdminRbacOverrideAttemptDecisions,
  getAdminRbacReleaseEvidenceClosures,
  getAdminRbacReleaseReadinessSummaries,
  getAdminRbacRuntimeDecisions,
  getAdminRbacStaleReplayDecisions,
  getAdminRbacSurfaceSummaries,
  getAdminReviewDecisions,
  getAuditEvents,
  getProductionActivationReviewAuditEvidence,
  getProductionSecurityLaunchCheckEvidence,
  getStagingAuthRbacTenantAuditEvidence
} from "@/lib/admin-api";
import type {
  AdminRbacEvidence,
  AdminRbacClosureMatrixRow,
  AdminRbacEvidencePack,
  AdminRbacOverrideAttemptDecision,
  AdminRbacReleaseEvidenceClosure,
  AdminRbacReleaseReadinessSummary,
  AdminRbacRuntimeDecision,
  AdminRbacStaleReplayDecision,
  AdminRbacSurfaceSummary,
  AdminReviewDecision,
  AuditEvent,
  ProductionActivationReviewAuditCoverage,
  ProductionSecurityLaunchCheckCoverage,
  StagingAuthRbacTenantAuditCoverage
} from "@/lib/types";

export default async function AuditPage() {
  const [
    events,
    reviews,
    rbacEvidence,
    rbacRuntime,
    rbacOverrideAttemptDecisions,
    rbacStaleReplay,
    rbacSurfaceSummaries,
    rbacEvidencePacks,
    rbacClosureMatrix,
    rbacReleaseEvidenceClosures,
    rbacReleaseReadinessSummaries,
    productionActivationEvidence,
    productionSecurityEvidence,
    stagingAuthRbacTenantAuditEvidence
  ] = await Promise.all([
    getAuditEvents(),
    getAdminReviewDecisions(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacOverrideAttemptDecisions(),
    getAdminRbacStaleReplayDecisions(),
    getAdminRbacSurfaceSummaries(),
    getAdminRbacEvidencePacks(),
    getAdminRbacClosureMatrix(),
    getAdminRbacReleaseEvidenceClosures(),
    getAdminRbacReleaseReadinessSummaries(),
    getProductionActivationReviewAuditEvidence(),
    getProductionSecurityLaunchCheckEvidence(),
    getStagingAuthRbacTenantAuditEvidence()
  ]);
  const filterPresets = [
    {
      name: "High-risk admin changes",
      filter: "risk:high OR risk:critical",
      evidence: "Requires rationale, immutable audit, and second-review status."
    },
    {
      name: "Support and quota actions",
      filter: "action:credited quota OR target:usr-*",
      evidence: "Must include support ticket, quota transaction, and reviewer reason."
    },
    {
      name: "Release and canary changes",
      filter: "action:started skill canary OR surface:skill_release",
      evidence: "Must preserve eval, canary, release, smoke, and rollback evidence."
    }
  ];
  const rbacRuntimeStats = [
    {
      label: "Denied Mutations",
      value: rbacRuntime.filter((decision) => decision.effectiveDecision === "deny_mutation").length,
      detail: "Insufficient role, expired override, or policy block preserved."
    },
    {
      label: "Second Review Holds",
      value: rbacRuntime.filter((decision) => decision.effectiveDecision === "queue_for_review").length,
      detail: "Sufficient role requests waiting on reviewer evidence."
    },
    {
      label: "Timed Overrides",
      value: rbacRuntime.filter((decision) => decision.effectiveDecision === "allow_mutation").length,
      detail: "Allowed admin changes with enforced expiration evidence."
    },
    {
      label: "Stale Replays Blocked",
      value: rbacStaleReplay.filter((decision) => decision.staleOutcome === "blocked_stale_replay").length,
      detail: "Expired temporary windows replayed after closure and preserved gates."
    }
  ];

  return (
    <>
      <PageHeader
        title="Audit Log Search"
        description="Searchable audit record surface for review, override, support, quota, abuse, safety, and release operations."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Search</h3>
            <p>Filters are static until the backend API lands, but the route and data contract are in place.</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="form-row">
            <div className="field">
              <label htmlFor="actor">Actor</label>
              <input id="actor" defaultValue="local-dev-admin" />
            </div>
            <div className="field">
              <label htmlFor="target">Target</label>
              <input id="target" defaultValue="ex-887" />
            </div>
            <div className="field">
              <label htmlFor="risk">Risk</label>
              <select id="risk" defaultValue="all">
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
        </div>
        <div className="panel-body filter-presets">
          {filterPresets.map((preset) => (
            <article className="record-card" key={preset.name}>
              <header>
                <div>
                  <h4>{preset.name}</h4>
                  <p className="mono">{preset.filter}</p>
                </div>
                <StatusBadge value="info" label="preset" />
              </header>
              <p>{preset.evidence}</p>
            </article>
          ))}
        </div>
        <DataTable<AuditEvent>
          rows={events}
          columns={[
            { key: "created", header: "Created", render: (row) => row.createdAt },
            { key: "actor", header: "Actor", render: (row) => row.actor },
            { key: "action", header: "Action", render: (row) => row.action },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "risk", header: "Risk", render: (row) => <StatusBadge value={row.risk} /> },
            { key: "immutable", header: "Immutable", render: (row) => (row.immutable ? "Yes" : "No") },
            { key: "second-review", header: "Second Review Status", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>RBAC Override Closure Matrix</h3>
            <p>Cross-surface closure evidence proves each governed override family has runtime role gates, second-review coverage, expiry handling, stale replay behavior, immutable audit, and release evidence before release use.</p>
          </div>
        </div>
        <DataTable<AdminRbacClosureMatrixRow>
          rows={rbacClosureMatrix}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "evidence", header: "Evidence IDs", render: (row) => <span className="mono">{row.evidenceIds.join(", ")}</span> },
            { key: "roles", header: "Required Roles", render: (row) => row.requiredRoles.join(", ") },
            { key: "runtime", header: "Runtime Outcomes", render: (row) => row.runtimeOutcomes.join(", ") },
            { key: "role-gate", header: "Role Gate", render: (row) => <StatusBadge value={row.roleGateCoverage === "covered" ? "approved" : "blocked"} label={row.roleGateCoverage} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewCoverage === "missing" ? "blocked" : "approved"} label={row.secondReviewCoverage} /> },
            { key: "expiry", header: "Expiry", render: (row) => <StatusBadge value={row.expiryCoverage === "missing" ? "blocked" : "approved"} label={row.expiryCoverage} /> },
            { key: "stale", header: "Stale Replay", render: (row) => <StatusBadge value={row.staleReplayCoverage === "missing" ? "blocked" : "approved"} label={row.staleReplayCoverage} /> },
            { key: "audit", header: "Audit", render: (row) => <StatusBadge value={row.auditCoverage === "attached" ? "approved" : "blocked"} label={row.auditCoverage} /> },
            { key: "release-evidence", header: "Release Evidence", render: (row) => <StatusBadge value={row.releaseEvidenceCoverage === "attached" ? "approved" : "blocked"} label={row.releaseEvidenceCoverage} /> },
            { key: "disposition", header: "Closure Disposition", render: (row) => <StatusBadge value={row.closureDisposition} label={row.closureDisposition} /> },
            { key: "gate", header: "Release Gate", render: (row) => row.releaseGateStatus },
            { key: "blockers", header: "Blockers", render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none") },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>RBAC Release Evidence Closure</h3>
            <p>Release, crawler, prompt, provider, quota, safety, and export overrides are closed only when request attempts, stale replay evidence, audit refs, and release evidence are attached.</p>
          </div>
        </div>
        <DataTable<AdminRbacReleaseEvidenceClosure>
          rows={rbacReleaseEvidenceClosures}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "evidence", header: "Evidence IDs", render: (row) => <span className="mono">{row.evidenceIds.join(", ")}</span> },
            { key: "attempts", header: "Attempt IDs", render: (row) => <span className="mono">{row.attemptIds.join(", ")}</span> },
            { key: "stale", header: "Stale Replay IDs", render: (row) => row.staleReplayEvidenceIds.join(", ") || "none" },
            { key: "runtime", header: "Runtime Outcomes", render: (row) => row.runtimeOutcomes.join(", ") },
            { key: "attempt-outcomes", header: "Attempt Outcomes", render: (row) => row.attemptOutcomes.join(", ") },
            { key: "stale-outcomes", header: "Stale Outcomes", render: (row) => row.staleReplayOutcomes.join(", ") || "none" },
            { key: "attempt-coverage", header: "Attempt Coverage", render: (row) => <StatusBadge value={row.attemptCoverage === "covered" ? "approved" : "blocked"} label={row.attemptCoverage} /> },
            { key: "stale-coverage", header: "Stale Replay Coverage", render: (row) => <StatusBadge value={row.staleReplayCoverage === "missing" ? "blocked" : "approved"} label={row.staleReplayCoverage} /> },
            { key: "release-evidence", header: "Release Evidence", render: (row) => <StatusBadge value={row.releaseEvidenceStatus === "attached" ? "approved" : "blocked"} label={row.releaseEvidenceStatus} /> },
            { key: "disposition", header: "Disposition", render: (row) => row.releaseGateDisposition },
            { key: "closure", header: "Closure Status", render: (row) => <StatusBadge value={row.closureStatus} label={row.closureStatus} /> },
            { key: "gate", header: "Release Gate", render: (row) => row.releaseGateStatus },
            { key: "audit", header: "Audit Refs", render: (row) => <span className="mono">{row.auditRefs.join(", ")}</span> },
            { key: "required", header: "Release Evidence Required", render: (row) => row.releaseEvidenceRequired.join(" ") },
            { key: "closure-refs", header: "Closure Evidence Refs", render: (row) => row.closureEvidenceRefs.join(", ") },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>RBAC Release Readiness Summary</h3>
            <p>Each governed override surface gets a compact release-state verdict from request attempts, stale replay probes, audit refs, and closure evidence.</p>
          </div>
        </div>
        <DataTable<AdminRbacReleaseReadinessSummary>
          rows={rbacReleaseReadinessSummaries}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "ready", header: "Ready State", render: (row) => <StatusBadge value={row.readyState === "release_ready" ? "approved" : row.readyState === "missing_evidence" ? "blocked" : "warning"} label={row.readyState} /> },
            { key: "mode", header: "Mutation Mode", render: (row) => row.mutationMode },
            { key: "evidence", header: "Evidence IDs", render: (row) => <span className="mono">{row.evidenceIds.join(", ")}</span> },
            { key: "roles", header: "Required Roles", render: (row) => row.requiredRoles.join(", ") },
            { key: "attempt", header: "Attempt Coverage", render: (row) => <StatusBadge value={row.attemptCoverage === "covered" ? "approved" : "blocked"} label={row.attemptCoverage} /> },
            { key: "stale", header: "Stale Replay Coverage", render: (row) => <StatusBadge value={row.staleReplayCoverage === "missing" ? "blocked" : "approved"} label={row.staleReplayCoverage} /> },
            { key: "release-evidence", header: "Release Evidence", render: (row) => <StatusBadge value={row.releaseEvidenceStatus === "attached" ? "approved" : "blocked"} label={row.releaseEvidenceStatus} /> },
            { key: "closure", header: "Closure Status", render: (row) => row.closureStatus },
            { key: "gate", header: "Release Gate", render: (row) => row.releaseGateStatus },
            { key: "audit", header: "Audit Refs", render: (row) => <span className="mono">{row.auditRefs.join(", ")}</span> },
            { key: "closure-refs", header: "Closure Evidence Refs", render: (row) => row.closureEvidenceRefs.join(", ") },
            { key: "rationale", header: "Readiness Rationale", render: (row) => row.readinessRationale },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>RBAC Override Release Summary</h3>
            <p>Surface-level evidence summarizes which high-risk admin overrides are applied, held for second review, denied by policy, or denied by expired temporary windows.</p>
          </div>
        </div>
        <DataTable<AdminRbacSurfaceSummary>
          rows={rbacSurfaceSummaries}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "total", header: "Evidence Items", render: (row) => row.totalEvidence },
            { key: "summary", header: "Decision Summary", render: (row) => row.decisionSummary },
            { key: "expired", header: "Expired Denials", render: (row) => row.expiredOverrideDenials },
            { key: "gate", header: "Release Gate Statuses", render: (row) => row.releaseGateStatuses.join(", ") },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction },
            { key: "required", header: "Release Evidence Required", render: (row) => row.releaseEvidenceRequired.join(", ") },
            { key: "audit", header: "Audit Refs", render: (row) => <span className="mono">{row.auditRefs.join(", ")}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Production Security Evidence</h3>
            <p>Production probes cover secure cookies, CSRF/same-site enforcement, secret redaction, and admin privacy without closing unrelated launch blockers.</p>
          </div>
          <StatusBadge
            value={productionSecurityEvidence.status === "pass_with_blockers_preserved" ? "warning" : "blocked"}
            label={productionSecurityEvidence.status}
          />
        </div>
        <div className="panel-body">
          <div className="record-card">
            <header>
              <div>
                <h4>{productionSecurityEvidence.id}</h4>
                <p className="mono">{productionSecurityEvidence.evidencePath}</p>
              </div>
              <StatusBadge value="info" label={productionSecurityEvidence.validatedByRole} />
            </header>
            <p>{productionSecurityEvidence.gateImpact.checklistItem}</p>
            <p className="mono">
              {productionSecurityEvidence.doNotLaunchConditionIds.join(", ")} ·{" "}
              {productionSecurityEvidence.gateImpact.aggregateProductionGateStatus}
            </p>
          </div>
        </div>
        <DataTable<ProductionSecurityLaunchCheckCoverage>
          rows={productionSecurityEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "pass" ? "approved" : "blocked"} label={row.status} /> },
            { key: "probe", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "deployment", header: "Deployment Evidence", render: (row) => row.deploymentEvidence },
            { key: "audit", header: "Security Audit Evidence", render: (row) => row.securityAuditEvidence },
            { key: "artifacts", header: "Admin Artifacts", render: (row) => row.linkedAdminArtifacts.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Staging Auth RBAC Tenant Audit Evidence</h3>
            <p>Private beta staging probes cover admin-session separation, tenant denial, governed RBAC runtime decisions, and immutable audit linkage.</p>
          </div>
          <StatusBadge
            value={stagingAuthRbacTenantAuditEvidence.status === "pass" ? "approved" : "blocked"}
            label={stagingAuthRbacTenantAuditEvidence.status}
          />
        </div>
        <div className="panel-body">
          <div className="record-card">
            <header>
              <div>
                <h4>{stagingAuthRbacTenantAuditEvidence.id}</h4>
                <p className="mono">{stagingAuthRbacTenantAuditEvidence.evidencePath}</p>
              </div>
              <StatusBadge value="info" label={stagingAuthRbacTenantAuditEvidence.releaseGateCheckId} />
            </header>
            <p>{stagingAuthRbacTenantAuditEvidence.gateImpact.checklistItem}</p>
            <p className="mono">
              Runtime request ids: {stagingAuthRbacTenantAuditEvidence.runtimeRequestIds.join(", ")}
            </p>
            <p className="mono">
              Remaining blockers: {stagingAuthRbacTenantAuditEvidence.gateImpact.remainingBlockers.join(", ")}
            </p>
          </div>
        </div>
        <DataTable<StagingAuthRbacTenantAuditCoverage>
          rows={stagingAuthRbacTenantAuditEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "pass" ? "approved" : "blocked"} label={row.status} /> },
            { key: "probe", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "external", header: "External User Evidence", render: (row) => row.externalUserEvidence },
            { key: "rbac", header: "RBAC Audit Evidence", render: (row) => row.rbacAuditEvidence },
            { key: "artifacts", header: "Admin Artifacts", render: (row) => row.linkedAdminArtifacts.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>RBAC Runtime Decisions</h3>
            <p>Audit search includes the effective runtime outcome for every high-risk admin override surface.</p>
          </div>
        </div>
        <StatGrid stats={rbacRuntimeStats} />
        <DataTable<AdminRbacRuntimeDecision>
          rows={rbacRuntime}
          columns={[
            { key: "evidence", header: "Evidence", render: (row) => <span className="mono">{row.evidenceId}</span> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "window", header: "Override Window", render: (row) => <StatusBadge value={row.overrideWindow} label={row.overrideWindow} /> },
            { key: "expiry-policy", header: "Expiry Policy Status", render: (row) => <StatusBadge value={row.expiryPolicyStatus} label={row.expiryPolicyStatus} /> },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "requested-action", header: "Requested Action", render: (row) => row.requestedAction },
            { key: "role-gate", header: "Role Gate", render: (row) => <StatusBadge value={row.roleGateStatus} label={`${row.attemptedRole} -> ${row.requiredRole}`} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "decision", header: "Effective Decision", render: (row) => <StatusBadge value={row.effectiveDecision === "allow_mutation" ? "allowed" : row.effectiveDecision === "queue_for_review" ? "warning" : "denied"} label={row.effectiveDecision} /> },
            { key: "outcome", header: "Request Outcome", render: (row) => row.requestOutcome },
            { key: "queue", header: "Queue Action", render: (row) => row.queueAction },
            { key: "gate", header: "Release Gate Status", render: (row) => row.releaseGateStatus },
            { key: "blockers", header: "Blockers", render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none") },
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
            <h3>RBAC Override Attempt Evidence</h3>
            <p>Request-level override evidence proves idempotency, admin-session scope, state preservation, and expected HTTP outcomes before any high-risk admin mutation can change release state.</p>
          </div>
        </div>
        <DataTable<AdminRbacOverrideAttemptDecision>
          rows={rbacOverrideAttemptDecisions}
          columns={[
            { key: "attempt", header: "Attempt", render: (row) => <span className="mono">{row.attemptId}</span> },
            { key: "evidence", header: "Evidence", render: (row) => <span className="mono">{row.evidenceId}</span> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "request", header: "Request ID", render: (row) => <span className="mono">{row.requestId}</span> },
            { key: "idempotency", header: "Idempotency", render: (row) => <StatusBadge value={row.idempotencyStatus === "stable" ? "approved" : "blocked"} label={row.idempotencyStatus} /> },
            { key: "state", header: "State Digest", render: (row) => <StatusBadge value={row.stateDigestStatus === "mutation_recorded" || row.stateDigestStatus === "mutation_preserved" ? "approved" : "blocked"} label={row.stateDigestStatus} /> },
            { key: "outcome", header: "Attempt Outcome", render: (row) => row.requestOutcome },
            { key: "submit", header: "Submit Allowed", render: (row) => (row.submitAllowed ? "Yes" : "No") },
            { key: "http", header: "Expected HTTP", render: (row) => row.expectedHttpStatus },
            { key: "runtime", header: "Runtime Outcome", render: (row) => row.runtimeRequestOutcome },
            { key: "gate", header: "Release Gate", render: (row) => row.releaseGateStatus },
            { key: "blockers", header: "Blockers", render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidenceRefs", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>RBAC Override Evidence Pack</h3>
            <p>Audit evidence packs keep release, crawler, prompt, provider, quota, safety, and export overrides tied to runtime disposition, expiry, second review, and immutable audit refs.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidencePack>
          rows={rbacEvidencePacks}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "ids", header: "Evidence IDs", render: (row) => <span className="mono">{row.evidenceIds.join(", ")}</span> },
            { key: "api", header: "API Scopes", render: (row) => <span className="mono">{row.apiScopes.join(", ")}</span> },
            { key: "roles", header: "Highest Required Role", render: (row) => row.highestRequiredRole },
            { key: "outcomes", header: "Request Outcomes", render: (row) => row.requestOutcomes.join(", ") },
            { key: "mutations", header: "Mutation Decisions", render: (row) => row.mutationDecisions.join(", ") },
            {
              key: "disposition",
              header: "Release Gate Disposition",
              render: (row) => <StatusBadge value={row.releaseGateDisposition} label={row.releaseGateDisposition} />
            },
            {
              key: "complete",
              header: "Evidence Completeness",
              render: (row) => <StatusBadge value={row.evidenceCompleteness} label={row.evidenceCompleteness} />
            },
            { key: "expiry", header: "Expiry Statuses", render: (row) => row.expiryStatuses.join(", ") },
            {
              key: "expiry-enforcement",
              header: "Expiry Enforcement",
              render: (row) => <StatusBadge value={row.expiryEnforcementStatus} label={row.expiryEnforcementStatus} />
            },
            { key: "expiry-ids", header: "Expiry Enforced IDs", render: (row) => row.expiryEnforcedEvidenceIds.join(", ") || "none" },
            { key: "policy-ids", header: "Policy Block IDs", render: (row) => row.policyBlockEvidenceIds.join(", ") || "none" },
            { key: "stale-replay", header: "Stale Replay Outcomes", render: (row) => row.staleReplayOutcomes.join(", ") || "none" },
            { key: "stale-ids", header: "Stale Replay IDs", render: (row) => row.staleReplayEvidenceIds.join(", ") || "none" },
            { key: "second-review", header: "Second Review Statuses", render: (row) => row.secondReviewStatuses.join(", ") },
            { key: "audit", header: "Audit Refs", render: (row) => <span className="mono">{row.auditRefs.join(", ")}</span> },
            { key: "checklist", header: "Operator Checklist", render: (row) => row.operatorChecklist.join(" ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>RBAC Stale Override Replay</h3>
            <p>Expired temporary windows and standing policy blocks are replayed after closure to prove stale admin overrides cannot mutate release, crawler, prompt, provider, quota, safety, or export state.</p>
          </div>
        </div>
        <DataTable<AdminRbacStaleReplayDecision>
          rows={rbacStaleReplay}
          columns={[
            { key: "evidence", header: "Evidence", render: (row) => <span className="mono">{row.evidenceId}</span> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "enforcement", header: "Enforcement Point", render: (row) => row.enforcementPoint },
            { key: "replay", header: "Replay At", render: (row) => row.staleReplayAt },
            { key: "original", header: "Original Outcome", render: (row) => row.originalOutcome },
            { key: "stale", header: "Stale Outcome", render: (row) => <StatusBadge value={row.staleOutcome} label={row.staleOutcome} /> },
            { key: "window", header: "Window Status", render: (row) => <StatusBadge value={row.staleWindowStatus} label={row.staleWindowStatus} /> },
            { key: "gate", header: "Release Gate", render: (row) => row.releaseGateStatus },
            { key: "restore", header: "State Restoration", render: (row) => row.stateRestoration },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence-refs", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Production Activation Evidence</h3>
            <p>Production probes cover release, crawler, prompt, provider, quota, safety, and export activation review/audit gates without closing unrelated launch blockers.</p>
          </div>
          <StatusBadge
            value={productionActivationEvidence.status === "pass_with_blockers_preserved" ? "warning" : "blocked"}
            label={productionActivationEvidence.status}
          />
        </div>
        <div className="panel-body">
          <div className="record-card">
            <header>
              <div>
                <h4>{productionActivationEvidence.id}</h4>
                <p className="mono">{productionActivationEvidence.evidencePath}</p>
              </div>
              <StatusBadge value="info" label={productionActivationEvidence.validatedByRole} />
            </header>
            <p>{productionActivationEvidence.gateImpact.checklistItem}</p>
            <p className="mono">
              {productionActivationEvidence.doNotLaunchConditionIds.join(", ")} ·{" "}
              {productionActivationEvidence.gateImpact.aggregateProductionGateStatus}
            </p>
          </div>
        </div>
        <DataTable<ProductionActivationReviewAuditCoverage>
          rows={productionActivationEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "pass" ? "approved" : "blocked"} label={row.status} /> },
            { key: "probe", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "deployment", header: "Deployment Evidence", render: (row) => row.deploymentEvidence },
            { key: "rbac", header: "RBAC Audit Evidence", render: (row) => row.rbacAuditEvidence },
            { key: "artifacts", header: "Admin Artifacts", render: (row) => row.linkedAdminArtifacts.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Review Rationale Evidence</h3>
            <p>High-risk admin decisions must preserve reviewer rationale, evidence refs, and second-review status.</p>
          </div>
        </div>
        <DataTable<AdminReviewDecision>
          rows={reviews}
          columns={[
            { key: "created", header: "Created", render: (row) => row.createdAt },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "risk", header: "Risk", render: (row) => <StatusBadge value={row.risk} /> },
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
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>RBAC Override Evidence</h3>
            <p>High-risk release, crawler, prompt, provider, quota, safety, and export overrides must prove the attempted role, required role, decision, rationale, and audit ref.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={rbacEvidence}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "action", header: "Requested Action", render: (row) => row.requestedAction },
            { key: "enforcement", header: "Enforcement Point", render: (row) => row.enforcementPoint },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review Status", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "gate", header: "Release Gate Impact", render: (row) => row.releaseGateImpact },
            { key: "outcome", header: "User Outcome", render: (row) => row.userVisibleOutcome },
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
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
    </>
  );
}
