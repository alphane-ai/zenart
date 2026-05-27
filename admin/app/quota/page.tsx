import { DataTable } from "@/components/DataTable";
import { KeyValue } from "@/components/KeyValue";
import { PageHeader } from "@/components/PageHeader";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacRuntimeDecisions,
  getQuotaAccounts,
  getStagingQuotaRateLimitSpendCapEvidence
} from "@/lib/admin-api";
import type { AdminRbacEvidence, QuotaAccount, StagingQuotaRateLimitSpendCapCoverage } from "@/lib/types";

export default async function QuotaPage() {
  const [accounts, rbacEvidence, rbacRuntime, stagingEvidence] = await Promise.all([
    getQuotaAccounts(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getStagingQuotaRateLimitSpendCapEvidence()
  ]);
  const quotaRbacEvidence = rbacEvidence.filter((item) => item.surface === "quota_override");
  const quotaRbacRuntime = rbacRuntime.filter((item) => item.surface === "quota_override");

  return (
    <>
      <PageHeader
        title="Quota Credit and Debit"
        description="Admin quota operations for reservation, commit, refund, credit, debit, anomalies, and support-linked adjustments."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Quota Accounts</h3>
            <p>Credit and debit changes require rationale, support ticket linkage, and audit logging.</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="form-row">
            <div className="field">
              <label htmlFor="user">User</label>
              <input id="user" defaultValue="usr-301" />
            </div>
            <div className="field">
              <label htmlFor="amount">Amount</label>
              <input id="amount" defaultValue="120" />
            </div>
            <div className="field">
              <label htmlFor="reason">Reason</label>
              <input id="reason" defaultValue="Refund failed export credits" />
            </div>
          </div>
        </div>
        <DataTable<QuotaAccount>
          rows={accounts}
          columns={[
            { key: "user", header: "User", render: (row) => <span className="mono">{row.userId}</span> },
            { key: "balance", header: "Balance", render: (row) => row.balance },
            { key: "reserved", header: "Reserved", render: (row) => row.reserved },
            { key: "limit", header: "Monthly Limit", render: (row) => row.monthlyLimit },
            { key: "anomaly", header: "Anomaly", render: (row) => row.anomaly },
            { key: "last", header: "Last Transaction", render: (row) => row.lastTransaction }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Quota Override RBAC</h3>
            <p>Quota credit and debit overrides must deny support-only mutation attempts and keep support, transaction, export, and audit evidence linked.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={quotaRbacEvidence}
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
            { key: "rationale", header: "Rationale", render: (row) => row.rationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Quota Override RBAC Runtime Decisions</h3>
            <p>Computed quota mutation outcomes prove support-only balance changes are denied before credits or debits can post.</p>
          </div>
        </div>
        <RbacRuntimeDecisionTable rows={quotaRbacRuntime} />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Staging Quota Rate Limit Spend Cap Evidence</h3>
            <p>Private beta evidence for quota reservation, refund, throttling, provider spend cap, and emergency kill switch enforcement.</p>
          </div>
          <StatusBadge value={stagingEvidence.status} label={stagingEvidence.status} />
        </div>
        <div className="panel-body">
          <KeyValue
            items={[
              ["Evidence Path", <span key="quota-evidence-path" className="mono">{stagingEvidence.evidencePath}</span>],
              ["Release Gate Check", <span key="quota-release-gate-check" className="mono">{stagingEvidence.releaseGateCheckId}</span>],
              ["Do Not Launch Condition", <span key="quota-dnl-condition" className="mono">{stagingEvidence.doNotLaunchConditionId}</span>],
              ["Validated At", stagingEvidence.validatedAt],
              ["Validated By", stagingEvidence.validatedByRole],
              ["Can Clear Row", stagingEvidence.gateImpact.canClearCheckLevelItem ? "Yes" : "No"],
              ["Remaining Blockers", stagingEvidence.gateImpact.remainingBlockers.join(", ")]
            ]}
          />
        </div>
        <DataTable<StagingQuotaRateLimitSpendCapCoverage>
          rows={stagingEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => <span className="mono">{row.area}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "runtime", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "external", header: "External User Evidence", render: (row) => row.externalUserEvidence },
            { key: "enforcement", header: "Enforcement Evidence", render: (row) => row.enforcementEvidence },
            { key: "artifacts", header: "Admin Artifacts", render: (row) => row.linkedAdminArtifacts.join(", ") },
            { key: "refs", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>
    </>
  );
}
