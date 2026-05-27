import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatGrid } from "@/components/StatGrid";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacRuntimeDecisions,
  getAdminRbacSurfaceSummaries,
  getAdminReviewDecisions,
  getAuditEvents,
  getProductionActivationReviewAuditEvidence,
  getProductionSecurityLaunchCheckEvidence,
  getStagingAuthRbacTenantAuditEvidence
} from "@/lib/admin-api";
import type {
  AdminRbacEvidence,
  AdminRbacRuntimeDecision,
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
    rbacSurfaceSummaries,
    productionActivationEvidence,
    productionSecurityEvidence,
    stagingAuthRbacTenantAuditEvidence
  ] = await Promise.all([
    getAuditEvents(),
    getAdminReviewDecisions(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacSurfaceSummaries(),
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
