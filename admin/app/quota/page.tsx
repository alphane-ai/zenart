import { DataTable } from "@/components/DataTable";
import { KeyValue } from "@/components/KeyValue";
import { PageHeader } from "@/components/PageHeader";
import { RbacOverrideAttemptDecisionTable } from "@/components/RbacOverrideAttemptDecisionTable";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAdminRbacEvidence,
  getAdminRbacOverrideAttemptDecisions,
  getAdminRbacRuntimeDecisions,
  getAdminBillingOpsPanel,
  getProductionPaidBillingLifecycleEvidence,
  getQuotaAccounts,
  getStagingQuotaRateLimitSpendCapEvidence,
  getTeamSeatOpsPanel
} from "@/lib/admin-api";
import type {
  AdminBillingOperation,
  AdminRbacEvidence,
  ProductionPaidBillingLifecycleCoverage,
  ProductionPaidBillingLifecycleEvidence,
  QuotaAccount,
  StagingQuotaRateLimitSpendCapCoverage,
  TeamBillingLink,
  TeamSeatUsage,
  TeamSeatBillingSync
} from "@/lib/types";
import {
  createAdminBillingAccountLockAction,
  createAdminBillingManualCreditAction,
  createAdminBillingRefundNoteAction,
  createAdminBillingSubscriptionSyncAction,
  createAdminTeamAction,
  createAdminTeamInviteAction,
  removeAdminTeamMemberAction,
  upsertTeamBillingLinkAction
} from "./actions";

export default async function QuotaPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = (await searchParams) ?? {};
  const teamID = searchValue(params.team_id) || "team_1";
  const [accounts, rbacEvidence, rbacRuntime, rbacAttemptDecisions, stagingEvidence, productionPaidBillingEvidence, teamSeatOpsPanel, adminBillingOpsPanel] = await Promise.all([
    getQuotaAccounts(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacOverrideAttemptDecisions(),
    getStagingQuotaRateLimitSpendCapEvidence(),
    getProductionPaidBillingLifecycleEvidence(),
    getTeamSeatOpsPanel(teamID),
    getAdminBillingOpsPanel()
  ]);
  const quotaRbacEvidence = rbacEvidence.filter((item) => item.surface === "quota_override");
  const quotaRbacRuntime = rbacRuntime.filter((item) => item.surface === "quota_override");
  const quotaRbacAttemptDecisions = rbacAttemptDecisions.filter((item) => item.surface === "quota_override");
  const teamBillingLinkState = searchValue(params.team_billing_link);
  const teamOpsState = searchValue(params.team_ops);
  const teamOpsStatus = searchValue(params.status);
  const teamBillingLinkTeam = searchValue(params.team_id) || teamSeatOpsPanel.teamID;
  const teamSeatOpsLive = teamSeatOpsPanel.source === "api";
  const billingOpsState = searchValue(params.billing_ops);
  const billingOpsOperation = searchValue(params.billing_operation);
  const billingOpsStatus = searchValue(params.status);
  const billingOpsLive = adminBillingOpsPanel.apiAvailable;

  return (
    <>
      <PageHeader
        title="Quota Credit and Debit"
        description="Admin quota operations for reservation, commit, refund, credit, debit, anomalies, and support-linked adjustments."
      />
      <section className="panel" data-admin-endpoint="team-seat-ops">
        <div className="panel-header">
          <div>
            <h3>Team Seat Operations</h3>
            <p>Create teams, reserve billable seats with invites, remove members, and verify tenant-scoped seat usage before Stripe quantity sync.</p>
          </div>
          <StatusBadge value={teamSeatOpsLive ? "healthy" : "warning"} label={teamSeatOpsPanel.source} />
        </div>
        <div className="panel-body">
          {teamOpsState ? (
            <p className={["created", "invited", "removed"].includes(teamOpsState) ? "notice success" : "notice warning"}>
              {teamOpsMessage(teamOpsState, teamBillingLinkTeam, teamOpsStatus)}
            </p>
          ) : !teamSeatOpsLive ? (
            <p className="notice warning">Live team seat operations API is unavailable; fixture fallback is read-only. {teamSeatOpsPanel.error}</p>
          ) : teamSeatOpsPanel.error ? (
            <p className="notice warning">{teamSeatOpsPanel.error}</p>
          ) : null}
          <div className="stat-grid">
            <div className="stat-card">
              <span>Seat Limit</span>
              <strong>{teamSeatOpsPanel.usage?.seat_limit ?? "n/a"}</strong>
              <small className="mono">{teamSeatOpsPanel.usage?.plan_id ?? "plan unknown"}</small>
            </div>
            <div className="stat-card">
              <span>Active Seats</span>
              <strong>{teamSeatOpsPanel.usage?.active_seats ?? "n/a"}</strong>
              <small>accepted members</small>
            </div>
            <div className="stat-card">
              <span>Invited Seats</span>
              <strong>{teamSeatOpsPanel.usage?.invited_seats ?? "n/a"}</strong>
              <small>pending invites reserve seats</small>
            </div>
            <div className="stat-card">
              <span>Available Seats</span>
              <strong>{teamSeatOpsPanel.usage?.available_seats ?? "n/a"}</strong>
              <small>{teamSeatOpsPanel.usage ? `${teamSeatOpsPanel.usage.billable_seats} billable` : "usage unavailable"}</small>
            </div>
          </div>
        </div>
        <DataTable<TeamSeatUsage>
          rows={teamSeatOpsPanel.usage ? [teamSeatOpsPanel.usage] : []}
          columns={[
            { key: "team", header: "Team", render: (row) => <span className="mono">{row.team_id}</span> },
            { key: "tenant", header: "Tenant", render: (row) => <span className="mono">{row.tenant_id}</span> },
            { key: "plan", header: "Plan", render: (row) => row.plan_id },
            { key: "limit", header: "Limit", render: (row) => row.seat_limit },
            { key: "active", header: "Active", render: (row) => row.active_seats },
            { key: "invited", header: "Invited", render: (row) => row.invited_seats },
            { key: "billable", header: "Billable", render: (row) => row.billable_seats },
            { key: "available", header: "Available", render: (row) => row.available_seats }
          ]}
        />
        <div className="panel-body">
          <div className="provider-control-grid">
            <form className="provider-control" action={createAdminTeamAction}>
              <div className="provider-control-title span-full">
                <strong>Create Team</strong>
                <span>Creates the owner seat and tenant team record.</span>
              </div>
              <label>
                Team ID
                <input name="team_id" defaultValue={teamSeatOpsPanel.teamID} disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Team name
                <input name="team_name" defaultValue={teamSeatOpsPanel.recentTeam?.name ?? ""} placeholder="Design Ops" disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Plan
                <input name="plan_id" defaultValue={teamSeatOpsPanel.usage?.plan_id ?? teamSeatOpsPanel.recentTeam?.plan_id ?? "pro"} disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Seat limit
                <input name="seat_limit" type="number" min="1" defaultValue={teamSeatOpsPanel.usage?.seat_limit ?? teamSeatOpsPanel.recentTeam?.seat_limit ?? 5} disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Owner user
                <input name="owner_user_id" placeholder="owner_1" disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Owner email
                <input name="owner_email" type="email" placeholder="owner@example.com" disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Ticket
                <input name="ticket_id" placeholder="ticket_team_create" disabled={!teamSeatOpsLive} />
              </label>
              <label className="span-full">
                Rationale
                <textarea name="rationale" required={teamSeatOpsLive} minLength={1} placeholder="Operational reason for audit" disabled={!teamSeatOpsLive} />
              </label>
              <button className="button" type="submit" disabled={!teamSeatOpsLive}>
                Create Team
              </button>
            </form>
            <form className="provider-control" action={createAdminTeamInviteAction}>
              <input type="hidden" name="team_id" value={teamSeatOpsPanel.teamID} />
              <div className="provider-control-title span-full">
                <strong>Invite Seat</strong>
                <span>Reserves a billable pending seat and triggers seat quantity sync.</span>
              </div>
              <label>
                Team
                <input defaultValue={teamSeatOpsPanel.teamID} disabled />
              </label>
              <label>
                Email
                <input name="email" type="email" defaultValue={teamSeatOpsPanel.recentInvite?.email ?? ""} placeholder="member@example.com" disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Role
                <select name="role" defaultValue={teamSeatOpsPanel.recentInvite?.role ?? "member"} disabled={!teamSeatOpsLive}>
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              <label>
                Expires at
                <input name="expires_at" placeholder="2026-07-06T10:00:00Z" disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Ticket
                <input name="ticket_id" placeholder="ticket_team_invite" disabled={!teamSeatOpsLive} />
              </label>
              <label className="span-full">
                Rationale
                <textarea name="rationale" required={teamSeatOpsLive} minLength={1} placeholder="Operational reason for audit" disabled={!teamSeatOpsLive} />
              </label>
              <button className="button" type="submit" disabled={!teamSeatOpsLive}>
                Invite Seat
              </button>
            </form>
            <form className="provider-control" action={removeAdminTeamMemberAction}>
              <input type="hidden" name="team_id" value={teamSeatOpsPanel.teamID} />
              <div className="provider-control-title span-full">
                <strong>Remove Member</strong>
                <span>Owner removal is denied by backend policy; successful removal syncs billable quantity.</span>
              </div>
              <label>
                Team
                <input defaultValue={teamSeatOpsPanel.teamID} disabled />
              </label>
              <label>
                Member ID
                <input name="member_id" defaultValue={teamSeatOpsPanel.recentRemoval?.member_id ?? ""} placeholder="member_1" disabled={!teamSeatOpsLive} />
              </label>
              <label>
                Ticket
                <input name="ticket_id" placeholder="ticket_team_remove" disabled={!teamSeatOpsLive} />
              </label>
              <label className="span-full">
                Rationale
                <textarea name="rationale" required={teamSeatOpsLive} minLength={1} placeholder="Operational reason for audit" disabled={!teamSeatOpsLive} />
              </label>
              <button className="button secondary" type="submit" disabled={!teamSeatOpsLive}>
                Remove Member
              </button>
            </form>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Team Billing Link</h3>
            <p>Bind a tenant team to the Stripe subscription item used for billable seat quantity and proration sync.</p>
          </div>
          <StatusBadge value={teamSeatOpsLive ? "healthy" : "warning"} label={teamSeatOpsPanel.source} />
        </div>
        <div className="panel-body">
          {teamBillingLinkState ? (
            <p className={teamBillingLinkState === "saved" ? "notice success" : "notice warning"}>
              {teamBillingLinkState === "saved"
                ? `Saved team billing link for ${teamBillingLinkTeam}.`
                : `Team billing link update ${teamBillingLinkState}${teamSeatOpsPanel.error ? `: ${teamSeatOpsPanel.error}` : ""}.`}
            </p>
          ) : teamSeatOpsPanel.error ? (
            <p className="notice warning">{teamSeatOpsPanel.error}</p>
          ) : null}
          <form className="provider-control" action={upsertTeamBillingLinkAction}>
            <input type="hidden" name="team_id" value={teamSeatOpsPanel.teamID} />
            <div className="provider-control-title span-full">
              <strong>Stripe subscription item</strong>
              <span className="mono">{teamSeatOpsPanel.link?.provider_subscription_item_id ?? "not linked"}</span>
            </div>
            <label>
              Team
              <input name="team_display" defaultValue={teamSeatOpsPanel.teamID} disabled />
            </label>
            <label>
              Provider
              <select name="provider" defaultValue={teamSeatOpsPanel.link?.provider ?? "stripe"} disabled={!teamSeatOpsLive}>
                <option value="stripe">stripe</option>
                <option value="mock">mock</option>
              </select>
            </label>
            <label>
              Subscription
              <input name="provider_subscription_id" defaultValue={teamSeatOpsPanel.link?.provider_subscription_id ?? ""} placeholder="sub_test_..." disabled={!teamSeatOpsLive} />
            </label>
            <label>
              Subscription item
              <input name="provider_subscription_item_id" defaultValue={teamSeatOpsPanel.link?.provider_subscription_item_id ?? ""} placeholder="si_test_..." disabled={!teamSeatOpsLive} />
            </label>
            <label>
              Price
              <input name="price_id" defaultValue={teamSeatOpsPanel.link?.price_id ?? ""} placeholder="price_..." disabled={!teamSeatOpsLive} />
            </label>
            <label>
              Proration
              <select name="proration_behavior" defaultValue={teamSeatOpsPanel.link?.proration_behavior ?? "create_prorations"} disabled={!teamSeatOpsLive}>
                <option value="create_prorations">create_prorations</option>
                <option value="always_invoice">always_invoice</option>
                <option value="none">none</option>
              </select>
            </label>
            <label>
              Status
              <select name="status" defaultValue={teamSeatOpsPanel.link?.status ?? "active"} disabled={!teamSeatOpsLive}>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="removed">removed</option>
              </select>
            </label>
            <label>
              Ticket
              <input name="ticket_id" defaultValue={metadataString(teamSeatOpsPanel.link, "ticket_id")} disabled={!teamSeatOpsLive} />
            </label>
            <label className="span-full">
              Rationale
              <textarea name="rationale" required={teamSeatOpsLive} minLength={1} placeholder="Operational reason for audit" disabled={!teamSeatOpsLive} />
            </label>
            <button className="button" type="submit" disabled={!teamSeatOpsLive}>
              Save Billing Link
            </button>
          </form>
        </div>
        <div data-admin-endpoint="seat-syncs">
          <DataTable<TeamSeatBillingSync>
            rows={teamSeatOpsPanel.syncs}
            columns={[
              { key: "id", header: "Sync", render: (row) => <span className="mono">{row.id}</span> },
              { key: "operation", header: "Operation", render: (row) => row.operation },
              { key: "provider_subscription_item_id", header: "Subscription Item", render: (row) => <span className="mono">{row.provider_subscription_item_id ?? ""}</span> },
              { key: "requested_quantity", header: "Requested", render: (row) => row.requested_quantity },
              { key: "synced_quantity", header: "Synced", render: (row) => row.synced_quantity },
              { key: "proration_behavior", header: "Proration", render: (row) => row.proration_behavior },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "synced" ? "healthy" : row.status === "skipped" ? "warning" : "blocked"} label={row.status} /> },
              { key: "created_at", header: "Created", render: (row) => row.created_at }
            ]}
          />
        </div>
      </section>
      <section className="panel" data-admin-endpoint="billing-ops">
        <div className="panel-header">
          <div>
            <h3>Admin Billing Operations</h3>
            <p>Record audited quota credits, Stripe refund notes, subscription syncs, and billing account locks against the admin billing API.</p>
          </div>
          <StatusBadge value={billingOpsLive ? "healthy" : "warning"} label={adminBillingOpsPanel.source} />
        </div>
        <div className="panel-body">
          {billingOpsState ? (
            <p className={billingOpsState === "recorded" ? "notice success" : "notice warning"}>
              {billingOpsMessage(billingOpsState, billingOpsOperation, billingOpsStatus)}
            </p>
          ) : !billingOpsLive ? (
            <p className="notice warning">Live admin billing operations API is unavailable; mutation forms are disabled. {adminBillingOpsPanel.error}</p>
          ) : adminBillingOpsPanel.error ? (
            <p className="notice warning">{adminBillingOpsPanel.error}</p>
          ) : null}
          <div
            className="contract-chip-row"
            data-admin-billing-contracts={[
              "createAdminBillingManualCredit:POST:/billing/manual-credit:include:X-Zenari-CSRF:true",
              "createAdminBillingRefundNote:POST:/billing/refund-note:include:X-Zenari-CSRF:true",
              "createAdminBillingSubscriptionSync:POST:/billing/subscription-sync:include:X-Zenari-CSRF:true",
              "createAdminBillingAccountLock:POST:/billing/account-lock:include:X-Zenari-CSRF:true"
            ].join("|")}
          >
            <span className="mono">Idempotency-Key</span>
            <span className="mono">X-Zenari-CSRF</span>
            <span className="mono">rationale_required</span>
            <span className="mono">secret_redaction</span>
          </div>
          <div className="provider-control-grid">
            <form className="provider-control" action={createAdminBillingManualCreditAction} data-admin-billing-op="manual_credit">
              <div className="provider-control-title span-full">
                <strong>Manual Credit</strong>
                <span>Credits a quota bucket after support or refund approval.</span>
              </div>
              <label>
                Target user
                <input name="target_user_id" defaultValue="user_301" disabled={!billingOpsLive} />
              </label>
              <label>
                Bucket
                <input name="bucket_id" defaultValue="monthly_generation" disabled={!billingOpsLive} />
              </label>
              <label>
                Units
                <input name="units" type="number" min="1" defaultValue={120} disabled={!billingOpsLive} />
              </label>
              <label>
                Ticket
                <input name="ticket_id" defaultValue="ticket_billing_301" disabled={!billingOpsLive} />
              </label>
              <label className="span-full">
                Rationale
                <textarea name="rationale" required={billingOpsLive} minLength={1} defaultValue="Support-approved refund for failed export credits." disabled={!billingOpsLive} />
              </label>
              <button className="button" type="submit" disabled={!billingOpsLive}>
                Record Manual Credit
              </button>
            </form>
            <form className="provider-control" action={createAdminBillingRefundNoteAction} data-admin-billing-op="refund_note">
              <div className="provider-control-title span-full">
                <strong>Refund Note</strong>
                <span>Records Stripe refund or credit-note reconciliation without raw secret material.</span>
              </div>
              <label>
                Target user
                <input name="target_user_id" defaultValue="user_302" disabled={!billingOpsLive} />
              </label>
              <label>
                Subscription
                <input name="subscription_id" defaultValue="sub_test_refund_note" disabled={!billingOpsLive} />
              </label>
              <label>
                Provider
                <select name="provider" defaultValue="stripe" disabled={!billingOpsLive}>
                  <option value="stripe">stripe</option>
                  <option value="mock">mock</option>
                </select>
              </label>
              <label>
                Provider ref
                <input name="provider_ref" defaultValue="re_test_refund_note" disabled={!billingOpsLive} />
              </label>
              <label>
                Ticket
                <input name="ticket_id" defaultValue="ticket_billing_302" disabled={!billingOpsLive} />
              </label>
              <label className="span-full">
                Note
                <textarea name="note" required={billingOpsLive} minLength={1} defaultValue="Refund note recorded without raw secret material." disabled={!billingOpsLive} />
              </label>
              <label className="span-full">
                Rationale
                <textarea name="rationale" required={billingOpsLive} minLength={1} defaultValue="Stripe refund reconciled to support ticket." disabled={!billingOpsLive} />
              </label>
              <button className="button" type="submit" disabled={!billingOpsLive}>
                Record Refund Note
              </button>
            </form>
            <form className="provider-control" action={createAdminBillingSubscriptionSyncAction} data-admin-billing-op="sync_subscription">
              <div className="provider-control-title span-full">
                <strong>Subscription Sync</strong>
                <span>Replays subscription state after webhook or dashboard reconciliation.</span>
              </div>
              <label>
                Target user
                <input name="target_user_id" defaultValue="user_303" disabled={!billingOpsLive} />
              </label>
              <label>
                Subscription
                <input name="subscription_id" defaultValue="sub_test_subscription_sync" disabled={!billingOpsLive} />
              </label>
              <label>
                Provider
                <select name="provider" defaultValue="stripe" disabled={!billingOpsLive}>
                  <option value="stripe">stripe</option>
                  <option value="mock">mock</option>
                </select>
              </label>
              <label>
                Provider ref
                <input name="provider_ref" defaultValue="evt_test_subscription_updated" disabled={!billingOpsLive} />
              </label>
              <label>
                Ticket
                <input name="ticket_id" defaultValue="ticket_billing_303" disabled={!billingOpsLive} />
              </label>
              <label className="span-full">
                Rationale
                <textarea name="rationale" required={billingOpsLive} minLength={1} defaultValue="Replay subscription state after webhook reconciliation." disabled={!billingOpsLive} />
              </label>
              <button className="button" type="submit" disabled={!billingOpsLive}>
                Sync Subscription
              </button>
            </form>
            <form className="provider-control" action={createAdminBillingAccountLockAction} data-admin-billing-op="account_lock">
              <div className="provider-control-title span-full">
                <strong>Account Lock</strong>
                <span>Records billing lock or unlock decisions with audit metadata.</span>
              </div>
              <label>
                Target user
                <input name="target_user_id" defaultValue="user_304" disabled={!billingOpsLive} />
              </label>
              <label>
                Lock state
                <select name="locked" defaultValue="true" disabled={!billingOpsLive}>
                  <option value="true">locked</option>
                  <option value="false">unlocked</option>
                </select>
              </label>
              <label>
                Ticket
                <input name="ticket_id" defaultValue="ticket_billing_304" disabled={!billingOpsLive} />
              </label>
              <label className="span-full">
                Rationale
                <textarea name="rationale" required={billingOpsLive} minLength={1} defaultValue="Temporary billing hold after repeated payment failure." disabled={!billingOpsLive} />
              </label>
              <button className="button secondary" type="submit" disabled={!billingOpsLive}>
                Save Account Lock
              </button>
            </form>
          </div>
        </div>
        <DataTable<AdminBillingOperation>
          rows={adminBillingOpsPanel.operations}
          columns={[
            { key: "id", header: "Operation", render: (row) => <span className="mono">{row.id}</span> },
            { key: "target", header: "Target User", render: (row) => <span className="mono">{row.target_user_id}</span> },
            { key: "kind", header: "Kind", render: (row) => row.operation },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "failed" ? "blocked" : row.status === "pending" ? "warning" : "healthy"} label={row.status} /> },
            { key: "units", header: "Units", render: (row) => row.units ?? "" },
            { key: "bucket", header: "Bucket", render: (row) => row.bucket_id ?? "" },
            { key: "provider", header: "Provider", render: (row) => row.provider ?? "" },
            { key: "provider-ref", header: "Provider Ref", render: (row) => <span className="mono">{row.provider_ref ?? ""}</span> },
            { key: "locked", header: "Locked", render: (row) => (typeof row.locked === "boolean" ? String(row.locked) : "") },
            { key: "ticket", header: "Ticket", render: (row) => metadataStringFromRecord(row.metadata, "ticket_id") },
            { key: "idempotency", header: "Idempotency", render: (row) => <span className="mono">{row.idempotency_key}</span> },
            { key: "created", header: "Created", render: (row) => row.created_at }
          ]}
        />
      </section>
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
            <h3>Production Paid Billing Lifecycle Evidence</h3>
            <p>Production billing evidence validates checkout, subscription, cancellation, past_due, refund, credit, quota reset, and webhook idempotency while preserving unrelated launch blockers.</p>
          </div>
        </div>
        <DataTable<ProductionPaidBillingLifecycleEvidence>
          rows={[productionPaidBillingEvidence]}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "role", header: "Validated By", render: (row) => row.validatedByRole },
            { key: "check", header: "Release Gate Check", render: (row) => row.releaseGateCheckId },
            { key: "condition", header: "Cleared Condition", render: (row) => row.doNotLaunchConditionId },
            { key: "lifecycle-path", header: "Lifecycle Evidence", render: (row) => row.billingLifecycleEvidencePath },
            { key: "refund-path", header: "Refund/Webhook Evidence", render: (row) => row.billingRefundCreditWebhookEvidencePath },
            { key: "clear", header: "Can Clear Rows", render: (row) => (row.gateImpact.canClearCheckLevelItems ? "yes" : "no") },
            { key: "aggregate", header: "Aggregate Gate", render: (row) => row.gateImpact.aggregateProductionGateStatus },
            { key: "remaining", header: "Remaining Blockers", render: (row) => row.gateImpact.remainingBlockers.join(", ") }
          ]}
        />
        <DataTable<ProductionPaidBillingLifecycleCoverage>
          rows={productionPaidBillingEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Validation", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "runtime", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "deployment", header: "Deployment Evidence", render: (row) => row.deploymentEvidence },
            { key: "audit", header: "Billing Audit Evidence", render: (row) => row.billingAuditEvidence },
            { key: "artifacts", header: "Admin Artifacts", render: (row) => row.linkedAdminArtifacts.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
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
            <h3>Quota Override RBAC Override Attempt Evidence</h3>
            <p>Request-level evidence proves quota mutations preserve idempotency, state digest, expected HTTP outcome, audit, support-ticket linkage, and transaction blockers.</p>
          </div>
        </div>
        <RbacOverrideAttemptDecisionTable rows={quotaRbacAttemptDecisions} />
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

function searchValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}

function metadataString(link: TeamBillingLink | null, key: string) {
  const value = link?.metadata?.[key];
  return typeof value === "string" ? value : "";
}

function metadataStringFromRecord(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

function teamOpsMessage(state: string, teamID: string, status?: string) {
  const suffix = status ? ` (HTTP ${status})` : "";
  switch (state) {
    case "created":
      return `Created team ${teamID}.`;
    case "invited":
      return `Invited a billable seat for ${teamID}.`;
    case "removed":
      return `Removed a team member for ${teamID}.`;
    case "create_failed":
      return `Team creation failed for ${teamID}${suffix}.`;
    case "invite_failed":
      return `Team invite failed for ${teamID}${suffix}.`;
    case "remove_failed":
      return `Team member removal failed for ${teamID}${suffix}.`;
    default:
      return `Team seat operation ${state || "unavailable"} for ${teamID}${suffix}.`;
  }
}

function billingOpsMessage(state: string, operation: string, status?: string) {
  const suffix = status ? ` (HTTP ${status})` : "";
  switch (state) {
    case "recorded":
      return `Recorded admin billing operation ${operation}.`;
    case "failed":
      return `Admin billing operation ${operation} failed${suffix}.`;
    default:
      return `Admin billing operation ${operation || "unavailable"} ${state || "unavailable"}${suffix}.`;
  }
}
