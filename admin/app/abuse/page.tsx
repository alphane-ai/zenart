import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAbuseControlHooks, getAbuseEvents } from "@/lib/admin-api";
import type { AbuseControlHook, AbuseEvent } from "@/lib/types";

export default async function AbusePage() {
  const events = await getAbuseEvents();
  const hooks = await getAbuseControlHooks();

  return (
    <>
      <PageHeader
        title="Abuse Queue"
        description="Abuse monitoring for generation spikes, quota drain, safety blocks, prompt extraction, impersonation, crawler abuse, and export/share abuse."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Incidents</h3>
            <p>Admin actions include rate-limit, temporary hold, severity assignment, and resolution.</p>
          </div>
        </div>
        <DataTable<AbuseEvent>
          rows={events}
          columns={[
            { key: "id", header: "Incident", render: (row) => <span className="mono">{row.id}</span> },
            { key: "user", header: "User", render: (row) => row.userId },
            { key: "category", header: "Category", render: (row) => row.category },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
            { key: "resolution", header: "Resolution", render: (row) => <StatusBadge value={row.resolution === "temporary_hold" ? "blocked" : row.resolution} label={row.resolution} /> },
            { key: "role", header: "Assigned Role", render: (row) => row.assignedRole },
            { key: "actions", header: "Allowed Actions", render: (row) => row.allowedActions.join(", ") },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.linkedSupportTicket}</span> },
            { key: "rationale", header: "Review Rationale", render: (row) => row.reviewRationale },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence", header: "Evidence", render: (row) => row.evidence }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Temporary Hold and Throttle Hooks</h3>
            <p>Abuse controls must name the trigger, enforcement point, role boundary, expiry, release condition, support ticket, and immutable audit ref.</p>
          </div>
        </div>
        <DataTable<AbuseControlHook>
          rows={hooks}
          columns={[
            { key: "id", header: "Hook", render: (row) => <span className="mono">{row.id}</span> },
            { key: "event", header: "Abuse Event", render: (row) => <span className="mono">{row.abuseEventId}</span> },
            { key: "action", header: "Action", render: (row) => <StatusBadge value={row.action === "temporary_hold" ? "blocked" : "warning"} label={row.action} /> },
            { key: "target", header: "Target Surface", render: (row) => row.targetSurface },
            { key: "enforcement", header: "Enforcement Point", render: (row) => row.enforcementPoint },
            { key: "state", header: "State", render: (row) => <StatusBadge value={row.state === "active" ? "blocked" : "warning"} label={row.state} /> },
            { key: "threshold", header: "Threshold", render: (row) => row.threshold },
            { key: "expires", header: "Expires", render: (row) => `${row.durationMinutes} min, ${row.expiresAt}` },
            { key: "role", header: "Required Role", render: (row) => row.requiredRole },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "release", header: "Release Condition", render: (row) => row.releaseCondition },
            { key: "runbook", header: "Operator Runbook", render: (row) => row.operatorRunbook },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
