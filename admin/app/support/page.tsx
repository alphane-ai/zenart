import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getSupportTickets, getSupportUsers } from "@/lib/admin-api";
import type { SupportTicket, SupportUser } from "@/lib/types";

export default async function SupportPage() {
  const [users, tickets] = await Promise.all([
    getSupportUsers(),
    getSupportTickets()
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
            { key: "projects", header: "Projects", render: (row) => row.projects },
            { key: "tasks", header: "Recent Tasks", render: (row) => row.recentTasks },
            { key: "traces", header: "Traces", render: (row) => row.traces.join(", ") },
            { key: "risk", header: "Risk Flags", render: (row) => row.riskFlags.length ? row.riskFlags.map((flag) => <StatusBadge key={flag} value="warning" label={flag} />) : "None" }
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
