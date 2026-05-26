import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getSupportEscalationRunbooks, getSupportTickets, getSupportUsers } from "@/lib/admin-api";
import type { SupportEscalationRunbook, SupportLookupAction, SupportTicket, SupportUser } from "@/lib/types";

export default async function SupportPage() {
  const [users, tickets, runbooks] = await Promise.all([
    getSupportUsers(),
    getSupportTickets(),
    getSupportEscalationRunbooks()
  ]);

  return (
    <>
      <PageHeader
        title="Support Console"
        description="User lookup surface for projects, recent tasks, traces, assets, exports, quota, tickets, and risk flags."
      />
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
            <p>Each support ticket must preserve user, project, task, trace, asset, export, quota, next action, and audit evidence.</p>
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
            { key: "task", header: "Task", render: (row) => <span className="mono">{row.taskId}</span> },
            { key: "trace", header: "Trace", render: (row) => <span className="mono">{row.traceId}</span> },
            { key: "asset", header: "Asset", render: (row) => <span className="mono">{row.assetId}</span> },
            { key: "export", header: "Export", render: (row) => <span className="mono">{row.exportId}</span> },
            { key: "quota", header: "Quota Txn", render: (row) => <span className="mono">{row.quotaTransactionId}</span> },
            { key: "subject", header: "Subject", render: (row) => row.subject },
            { key: "action", header: "Next Action", render: (row) => row.nextAction },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
