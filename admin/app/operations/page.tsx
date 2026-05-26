import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAlertRoutes,
  getIncidentLogs,
  getMaintenanceBanners,
  getOperationalDashboards
} from "@/lib/admin-api";
import type { AlertRoute, IncidentLog, MaintenanceBanner, OperationalDashboard } from "@/lib/types";

function incidentTone(status: IncidentLog["status"]) {
  if (status === "resolved") {
    return "healthy";
  }

  return status === "mitigating" ? "warning" : "blocked";
}

export default async function OperationsPage() {
  const [incidents, banners, dashboards, alerts] = await Promise.all([
    getIncidentLogs(),
    getMaintenanceBanners(),
    getOperationalDashboards(),
    getAlertRoutes()
  ]);

  return (
    <>
      <PageHeader
        title="Operations Gate"
        description="Incident log and maintenance banner control surface for support, retry, rollback, and release gate evidence."
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Dashboards</h3>
            <p>Stage 0 operational dashboards bind SLO thresholds, source signals, owner roles, release gate use, and evidence refs.</p>
          </div>
        </div>
        <DataTable<OperationalDashboard>
          rows={dashboards}
          columns={[
            { key: "id", header: "Dashboard", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "owner", header: "Owner Role", render: (row) => row.ownerRole },
            { key: "current", header: "Current Value", render: (row) => row.currentValue },
            { key: "slo", header: "SLO Threshold", render: (row) => row.sloThreshold },
            { key: "signals", header: "Source Signals", render: (row) => row.sourceSignals.join(", ") },
            { key: "release", header: "Release Gate Use", render: (row) => row.releaseGateUse },
            { key: "evidence", header: "Evidence", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Alert Routes</h3>
            <p>Alerts require severity, threshold, target, escalation role, runbook, incident linkage, and immutable audit evidence.</p>
          </div>
        </div>
        <DataTable<AlertRoute>
          rows={alerts}
          columns={[
            { key: "id", header: "Alert", render: (row) => <span className="mono">{row.id}</span> },
            { key: "dashboard", header: "Dashboard", render: (row) => row.dashboardId },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity === "sev1" ? "critical" : row.severity === "sev2" ? "high" : "medium"} label={row.severity.toUpperCase()} /> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "firing" ? "blocked" : row.status === "armed" ? "warning" : row.status} label={row.status} /> },
            { key: "threshold", header: "Threshold", render: (row) => row.threshold },
            { key: "target", header: "Route Target", render: (row) => row.routeTarget },
            { key: "role", header: "Escalation Role", render: (row) => row.escalationRole },
            { key: "runbook", header: "Runbook", render: (row) => row.runbook },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Incident Log</h3>
            <p>Every operational incident needs impact, mitigation, owner, update cadence, audit refs, and rollback evidence.</p>
          </div>
        </div>
        <DataTable<IncidentLog>
          rows={incidents}
          columns={[
            { key: "id", header: "Incident", render: (row) => <span className="mono">{row.id}</span> },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity === "sev1" ? "critical" : row.severity === "sev2" ? "high" : "medium"} label={row.severity.toUpperCase()} /> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={incidentTone(row.status)} label={row.status} /> },
            { key: "impact", header: "Customer Impact", render: (row) => row.customerImpact },
            { key: "mitigation", header: "Mitigation", render: (row) => row.mitigation },
            { key: "owner", header: "Owner", render: (row) => row.owner },
            { key: "next", header: "Next Update", render: (row) => row.nextUpdateAt },
            { key: "links", header: "Evidence", render: (row) => `${row.linkedQueues.join(", ")} · ${row.linkedSupportTickets.join(", ") || "no tickets"} · ${row.auditRefs.join(", ")}` },
            { key: "rollback", header: "Rollback Plan", render: (row) => row.rollbackPlan }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Maintenance Banner</h3>
            <p>Visible maintenance messaging must record scope, audience, owner, approval, timing, and audit linkage.</p>
          </div>
        </div>
        <DataTable<MaintenanceBanner>
          rows={banners}
          columns={[
            { key: "id", header: "Banner", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "active" ? "healthy" : row.status === "scheduled" ? "warning" : "info"} label={row.status} /> },
            { key: "scope", header: "Scope", render: (row) => row.scope },
            { key: "audience", header: "Audience", render: (row) => row.audience },
            { key: "message", header: "Message", render: (row) => row.message },
            { key: "window", header: "Window", render: (row) => `${row.startsAt} to ${row.endsAt}` },
            { key: "approval", header: "Approval", render: (row) => row.approval },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
