import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminRbacEvidence, getAdminRbacRuntimeDecisions, getQuotaAccounts } from "@/lib/admin-api";
import type { AdminRbacEvidence, QuotaAccount } from "@/lib/types";

export default async function QuotaPage() {
  const [accounts, rbacEvidence, rbacRuntime] = await Promise.all([
    getQuotaAccounts(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions()
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
            { key: "expires", header: "Override Expiration", render: (row) => row.overrideExpiresAt },
            { key: "expiry-enforced", header: "Expiry Enforced", render: (row) => (row.expiryEnforced ? "Yes" : "No") },
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
    </>
  );
}
