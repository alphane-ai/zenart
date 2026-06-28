import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getStagingLegalSupportVisibilityEvidence,
  getStagingSupportRetryAbuseEvidence,
  getSupportAdminDeletionGovernanceContract,
  getSupportEscalationRunbooks,
  getSupportTickets,
  getSupportUsers
} from "@/lib/admin-api";
import type {
  StagingLegalSupportVisibilityCoverage,
  StagingSupportRetryAbuseCoverage,
  SupportAdminDeletionGovernanceContract,
  SupportAdminDeletionRequest,
  SupportEscalationRunbook,
  SupportLookupAction,
  SupportTicket,
  SupportUser
} from "@/lib/types";

export default async function SupportPage() {
  const [users, tickets, runbooks, deletionGovernance, stagingEvidence, legalSupportEvidence] = await Promise.all([
    getSupportUsers(),
    getSupportTickets(),
    getSupportEscalationRunbooks(),
    getSupportAdminDeletionGovernanceContract(),
    getStagingSupportRetryAbuseEvidence(),
    getStagingLegalSupportVisibilityEvidence()
  ]);

  return (
    <>
      <PageHeader
        title="Support Console"
        description="User lookup surface for projects, recent tasks, traces, assets, exports, quota, tickets, and risk flags."
      />
      <section className="panel" data-support-deletion-governance-contract="stage1.support-admin-deletion-governance-local-contract">
        <div className="panel-header">
          <div>
            <h3>Deletion Governance</h3>
            <p>Support-side deletion and account-disposition requests remain evidence-bound, retention-aware, and review-gated without closing staging or production launch gates.</p>
          </div>
        </div>
        <div className="dependency-summary" data-support-deletion-non-launch-status="local-contract-only">
          <article>
            <span>Staging gate</span>
            <strong>preserved</strong>
            <small>canClearStagingGate: false</small>
          </article>
          <article>
            <span>Production gate</span>
            <strong>preserved</strong>
            <small>canClearProductionGate: false</small>
          </article>
          <article>
            <span>DNL closure</span>
            <strong>blocked</strong>
            <small>canCloseDoNotLaunch: false</small>
          </article>
          <article>
            <span>Mutation controls</span>
            <strong>disabled</strong>
            <small>mutationControlsEnabled: false</small>
          </article>
        </div>
        <DataTable<SupportAdminDeletionGovernanceContract>
          rows={[deletionGovernance]}
          columns={[
            { key: "id", header: "Contract", render: (row) => <span className="mono">{row.contractId}</span> },
            { key: "schema", header: "Schema", render: (row) => row.schema },
            { key: "blueprint", header: "Blueprint Items", render: (row) => row.blueprintItems.join(", ") },
            { key: "source", header: "Evidence Source", render: (row) => row.evidenceSource },
            { key: "route", header: "Admin Route", render: (row) => row.adminRoute },
            { key: "blocked", header: "Blocked Gate Checks", render: (row) => <span data-support-deletion-blocked-gate-checks>{row.blockedGateChecks.join(", ")}</span> },
            { key: "dnl", header: "Preserved DNL Conditions", render: (row) => <span data-support-deletion-preserved-dnl>{row.preservedDoNotLaunchConditions.join(", ")}</span> }
          ]}
        />
        <DataTable<SupportAdminDeletionGovernanceContract>
          rows={[deletionGovernance]}
          columns={[
            { key: "fields", header: "Required Deletion Fields", render: (row) => <span data-support-deletion-required-fields>{row.requiredDeletionFields.join(", ")}</span> },
            { key: "evidence", header: "Required Linked Evidence", render: (row) => <span data-support-deletion-linked-evidence>{row.requiredLinkedEvidence.join(", ")}</span> },
            { key: "denied", header: "Denied Projection Fields", render: (row) => <span data-support-deletion-denied-fields>{row.deniedProjectionFields.join(", ")}</span> }
          ]}
        />
        <DataTable<SupportAdminDeletionRequest>
          rows={deletionGovernance.requests}
          columns={[
            { key: "id", header: "Request", render: (row) => <span className="mono">{row.requestId}</span> },
            { key: "type", header: "Type", render: (row) => row.requestType },
            { key: "user", header: "User", render: (row) => <span className="mono">{row.subjectUserId}</span> },
            { key: "ticket", header: "Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "role", header: "Required Role", render: (row) => row.requiredRole },
            { key: "review", header: "Second Review", render: (row) => `${row.secondReviewRequired ? "required" : "not required"} / ${row.secondReviewStatus}` },
            { key: "hold", header: "Abuse Hold", render: (row) => <span className="mono">{row.abuseHoldRef}</span> },
            { key: "linked", header: "Linked Objects", render: (row) => <span data-support-deletion-request-links>{[...row.linkedTraceIds, ...row.linkedAssetIds, ...row.linkedExportIds, ...row.billingReferenceIds].join(", ")}</span> },
            { key: "retained", header: "Retained Evidence", render: (row) => row.retainedEvidenceRefs.join(", ") },
            { key: "plan", header: "Deletion Plan", render: (row) => row.deletionPlan },
            { key: "retention", header: "Retention Boundary", render: (row) => row.retentionBoundary },
            { key: "blocked", header: "Blocked Reason", render: (row) => row.blockedReason },
            { key: "message", header: "User Message", render: (row) => row.userVisibleMessage },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Staging Support Retry Abuse Evidence</h3>
            <p>Check-level private beta evidence for external-user support linkage, failed task retry/cancel, abuse hold/throttle, RBAC, and audit closure blocking.</p>
          </div>
          <StatusBadge value={stagingEvidence.status === "pass" ? "approved" : "blocked"} label={stagingEvidence.status} />
        </div>
        <div className="panel-body">
          <div className="evidence-line">
            <strong>Evidence path</strong>
            <span className="mono">{stagingEvidence.evidencePath}</span>
          </div>
          <div className="evidence-line">
            <strong>Gate impact</strong>
            <span>{stagingEvidence.gateImpact.checklistItem} · {stagingEvidence.gateImpact.aggregatePrivateBetaGateStatus}</span>
          </div>
          <div className="evidence-line">
            <strong>Runtime request ids</strong>
            <span className="mono">{stagingEvidence.runtimeRequestIds.join(", ")}</span>
          </div>
        </div>
        <DataTable<StagingSupportRetryAbuseCoverage>
          rows={stagingEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "pass" ? "approved" : "blocked"} label={row.status} /> },
            { key: "runtime", header: "Runtime Probe", render: (row) => row.runtimeProbe },
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
            <h3>Staging Legal Support Visibility Evidence</h3>
            <p>Private beta external-user probes must prove deployed legal pages, support contact, and report-problem visibility before the legal/support check can close.</p>
          </div>
          <StatusBadge value={legalSupportEvidence.status === "pass" ? "approved" : "blocked"} label={legalSupportEvidence.status} />
        </div>
        <div className="panel-body">
          <div className="evidence-line">
            <strong>Legal pages</strong>
            <span className="mono">{legalSupportEvidence.legalPageEvidencePath}</span>
          </div>
          <div className="evidence-line">
            <strong>Support contact</strong>
            <span className="mono">{legalSupportEvidence.supportContactEvidencePath}</span>
          </div>
          <div className="evidence-line">
            <strong>Remaining blockers</strong>
            <span>{legalSupportEvidence.gateImpact.remainingBlockers.join(", ")}</span>
          </div>
        </div>
        <DataTable<StagingLegalSupportVisibilityCoverage>
          rows={legalSupportEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "pass" ? "approved" : "blocked"} label={row.status} /> },
            { key: "runtime", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "external", header: "External User Evidence", render: (row) => row.externalUserEvidence },
            { key: "policy", header: "Policy Evidence", render: (row) => row.policyEvidence },
            { key: "artifacts", header: "Admin Artifacts", render: (row) => row.linkedAdminArtifacts.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>User Lookup</h3>
            <p>Support actions that mutate quota, retry tasks, or regenerate exports must produce audit records.</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="form-row">
            <div className="field">
              <label htmlFor="lookup">Lookup</label>
              <input id="lookup" placeholder="user id or email" defaultValue="usr-301" />
            </div>
            <div className="field">
              <label htmlFor="ticket">Ticket</label>
              <input id="ticket" placeholder="support ticket id" defaultValue="sup-2201" />
            </div>
            <div className="field">
              <label htmlFor="scope">Scope</label>
              <select id="scope" defaultValue="read-only">
                <option value="read-only">Read-only</option>
                <option value="quota">Quota mutation</option>
                <option value="retry">Retry failed task</option>
                <option value="regenerate">Export regeneration</option>
                <option value="hold">Temporary hold</option>
              </select>
            </div>
          </div>
        </div>
        <DataTable<SupportUser>
          rows={users}
          columns={[
            { key: "user", header: "User", render: (row) => <span className="mono">{row.id}</span> },
            { key: "email", header: "Email", render: (row) => row.email },
            { key: "plan", header: "Plan", render: (row) => row.plan },
            { key: "tenant", header: "Tenant", render: (row) => <span className="mono">{row.tenantId}</span> },
            { key: "status", header: "Account Status", render: (row) => <StatusBadge value={row.accountStatus} label={row.accountStatus} /> },
            { key: "projects", header: "Projects", render: (row) => row.projects },
            { key: "project-ids", header: "Project IDs", render: (row) => row.projectIds.join(", ") },
            { key: "tasks", header: "Recent Tasks", render: (row) => row.recentTasks },
            { key: "task-ids", header: "Task IDs", render: (row) => row.taskIds.join(", ") },
            { key: "traces", header: "Traces", render: (row) => row.traces.join(", ") },
            { key: "exports", header: "Exports", render: (row) => row.exportIds.length ? row.exportIds.join(", ") : "None" },
            { key: "tickets", header: "Tickets", render: (row) => row.ticketIds.join(", ") },
            { key: "quota", header: "Quota Account", render: (row) => <span className="mono">{row.quotaAccountRef}</span> },
            { key: "keys", header: "Lookup Keys", render: (row) => row.lookupKeys.join(", ") },
            { key: "risk", header: "Risk Flags", render: (row) => row.riskFlags.length ? row.riskFlags.map((flag) => <StatusBadge key={flag} value="warning" label={flag} />) : "None" }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Lookup Action Evidence</h3>
            <p>Every lookup result must state redaction, role boundary, linked evidence, and whether mutation is allowed, review-gated, or blocked.</p>
          </div>
        </div>
        <div className="lookup-action-grid">
          {users.map((user) => (
            <article className="record-card" key={user.id}>
              <header>
                <div>
                  <h4>{user.email}</h4>
                  <p className="mono">{user.id} · {user.tenantId}</p>
                </div>
                <StatusBadge value={user.accountStatus} label={user.accountStatus} />
              </header>
              <p>{user.privacyRedaction}</p>
              <div className="evidence-line">
                <strong>Audit refs</strong>
                <span className="mono">{user.auditRefs.join(", ")}</span>
              </div>
              <DataTable<SupportLookupAction>
                rows={user.lookupActions}
                columns={[
                  { key: "scope", header: "Scope", render: (row) => row.scope },
                  { key: "role", header: "Required Role", render: (row) => row.requiredRole },
                  { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
                  { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
                  { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
                  { key: "rationale", header: "Rationale", render: (row) => row.rationale }
                ]}
              />
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Escalation Readiness</h3>
            <p>Escalated support work needs an owner, role boundary, update cadence, user-facing message, evidence refs, and closure blockers.</p>
          </div>
        </div>
        <DataTable<SupportEscalationRunbook>
          rows={runbooks}
          columns={[
            { key: "ticket", header: "Ticket", render: (row) => <span className="mono">{row.ticketId}</span> },
            { key: "readiness", header: "Readiness", render: (row) => <StatusBadge value={row.readiness === "ready" ? "approved" : row.readiness} label={row.readiness} /> },
            { key: "role", header: "Escalation Role", render: (row) => row.escalationRole },
            { key: "owner", header: "Owner", render: (row) => row.owner },
            { key: "due", header: "Due", render: (row) => row.dueAt },
            { key: "cadence", header: "Update Cadence", render: (row) => row.customerUpdateCadence },
            { key: "message", header: "Customer Message", render: (row) => row.customerMessage },
            { key: "runbook", header: "Runbook", render: (row) => row.runbook },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.requiredEvidenceRefs.join(", ") },
            { key: "blockers", header: "Closure Blockers", render: (row) => row.closureBlockers.length ? row.closureBlockers.join(", ") : "None" }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Ticket Linkage</h3>
            <p>Each support ticket must preserve user, project, batch, task, trace, asset, export, quota, billing, next action, and audit evidence.</p>
          </div>
        </div>
        <DataTable<SupportTicket>
          rows={tickets}
          columns={[
            { key: "ticket", header: "Ticket", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "escalated" ? "danger" : row.status} label={row.status} /> },
            { key: "priority", header: "Priority", render: (row) => <StatusBadge value={row.priority} /> },
            { key: "user", header: "User", render: (row) => <span className="mono">{row.userId}</span> },
            { key: "project", header: "Project", render: (row) => <span className="mono">{row.projectId}</span> },
            { key: "batch", header: "Batch", render: (row) => <span className="mono">{row.batchId}</span> },
            { key: "task", header: "Task", render: (row) => <span className="mono">{row.taskId}</span> },
            { key: "trace", header: "Trace", render: (row) => <span className="mono">{row.traceId}</span> },
            { key: "asset", header: "Asset", render: (row) => <span className="mono">{row.assetId}</span> },
            { key: "export", header: "Export", render: (row) => <span className="mono">{row.exportId}</span> },
            { key: "quota-bucket", header: "Quota Bucket", render: (row) => <span className="mono">{row.quotaBucketId}</span> },
            { key: "quota", header: "Quota Txn", render: (row) => <span className="mono">{row.quotaTransactionId}</span> },
            { key: "billing", header: "Billing", render: (row) => <span className="mono">{row.billingReferenceId}</span> },
            { key: "subject", header: "Subject", render: (row) => row.subject },
            { key: "action", header: "Next Action", render: (row) => row.nextAction },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
