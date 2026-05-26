import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAlertRoutes,
  getAlertRouteRuntimeEvidence,
  getIncidentLogs,
  getMaintenanceBanners,
  getOperationalDashboardRuntimeEvidence,
  getOperationalDashboards,
  getReleaseBlockers
} from "@/lib/admin-api";
import type {
  AlertRoute,
  AlertRouteRuntimeEvidence,
  IncidentLog,
  MaintenanceBanner,
  OperationalDashboard,
  OperationalDashboardRuntimeEvidence,
  ReleaseBlocker
} from "@/lib/types";

function incidentTone(status: IncidentLog["status"]) {
  if (status === "resolved") {
    return "healthy";
  }

  return status === "mitigating" ? "warning" : "blocked";
}

export default async function OperationsPage() {
  const [incidents, banners, dashboards, dashboardRuntimeEvidence, alerts, alertRuntimeEvidence] = await Promise.all([
    getIncidentLogs(),
    getMaintenanceBanners(),
    getOperationalDashboards(),
    getOperationalDashboardRuntimeEvidence(),
    getAlertRoutes(),
    getAlertRouteRuntimeEvidence()
  ]);
  const releaseBlockers = await getReleaseBlockers();

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
            { key: "runtime", header: "Runtime Evidence", render: (row) => `${row.runtimeEnvironment} / ${row.runtimeEvidenceRef}` },
            { key: "runtime-status", header: "Runtime Status", render: (row) => <StatusBadge value={row.runtimeEvidenceStatus} label={row.runtimeEvidenceStatus} /> },
            { key: "validated", header: "Validated At", render: (row) => row.runtimeValidatedAt },
            { key: "evidence", header: "Evidence", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Dashboard Runtime Evidence</h3>
            <p>Each staging dashboard import must prove signal binding, SLO evaluation, blocker linkage, and release-gate handling.</p>
          </div>
        </div>
        <DataTable<OperationalDashboardRuntimeEvidence>
          rows={dashboardRuntimeEvidence}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "dashboard", header: "Dashboard", render: (row) => row.dashboardId },
            { key: "status", header: "Validation", render: (row) => <StatusBadge value={row.validationStatus} label={row.validationStatus} /> },
            { key: "role", header: "Validated By", render: (row) => row.validatedByRole },
            { key: "import", header: "Import Probe", render: (row) => row.importProbe },
            { key: "signals", header: "Signal Probe", render: (row) => row.signalProbe },
            { key: "slo", header: "SLO Probe", render: (row) => row.sloProbe },
            { key: "blocker", header: "Blocker Probe", render: (row) => row.blockerProbe },
            { key: "release", header: "Release Gate Use", render: (row) => row.releaseGateUse },
            { key: "validated", header: "Validated At", render: (row) => row.validatedAt },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
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
            { key: "runtime", header: "Runtime Evidence", render: (row) => `${row.runtimeEnvironment} / ${row.runtimeEvidenceRef}` },
            { key: "runtime-status", header: "Runtime Status", render: (row) => <StatusBadge value={row.runtimeEvidenceStatus} label={row.runtimeEvidenceStatus} /> },
            { key: "validated", header: "Validated At", render: (row) => row.runtimeValidatedAt },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Alert Runtime Evidence</h3>
            <p>Each staging alert route must prove delivery, threshold, escalation, runbook, incident linkage, and release-gate handling.</p>
          </div>
        </div>
        <DataTable<AlertRouteRuntimeEvidence>
          rows={alertRuntimeEvidence}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "alert", header: "Alert Route", render: (row) => row.alertRouteId },
            { key: "status", header: "Validation", render: (row) => <StatusBadge value={row.validationStatus} label={row.validationStatus} /> },
            { key: "role", header: "Validated By", render: (row) => row.validatedByRole },
            { key: "binding", header: "Route Binding", render: (row) => row.routeBinding },
            { key: "delivery", header: "Delivery Probe", render: (row) => row.deliveryProbe },
            { key: "threshold", header: "Threshold Probe", render: (row) => row.thresholdProbe },
            { key: "escalation", header: "Escalation Probe", render: (row) => row.escalationProbe },
            { key: "runbook", header: "Runbook Probe", render: (row) => row.runbookProbe },
            { key: "incident", header: "Incident Linkage", render: (row) => row.incidentLinkage },
            { key: "release", header: "Release Gate Use", render: (row) => row.releaseGateUse },
            { key: "validated", header: "Validated At", render: (row) => row.validatedAt },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Release Blocker Matrix</h3>
            <p>Verified dashboard or alert probes do not close beta or production gates while linked blocker evidence remains open.</p>
          </div>
        </div>
        <DataTable<ReleaseBlocker>
          rows={releaseBlockers}
          columns={[
            { key: "id", header: "Blocker", render: (row) => <span className="mono">{row.id}</span> },
            { key: "gate", header: "Gate", render: (row) => <StatusBadge value={row.status} label={row.gate} /> },
            { key: "kind", header: "Kind", render: (row) => row.blockerKind },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity === "sev1" ? "critical" : row.severity === "sev2" ? "high" : "medium"} label={row.severity.toUpperCase()} /> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "open" ? "blocked" : row.status === "mitigating" ? "warning" : "review"} label={row.status} /> },
            { key: "owner", header: "Owner Role", render: (row) => row.ownerRole },
            { key: "dashboard", header: "Dashboard", render: (row) => row.dashboardId },
            { key: "alert", header: "Alert Route", render: (row) => row.alertRouteId },
            { key: "runtime", header: "Runtime Evidence", render: (row) => row.runtimeEvidenceRef },
            { key: "signal", header: "Blocking Signal", render: (row) => row.blockingSignal },
            { key: "required", header: "Required Evidence", render: (row) => row.requiredEvidence },
            { key: "unblock", header: "Unblock Criteria", render: (row) => row.unblockCriteria },
            { key: "review", header: "Next Review", render: (row) => row.nextReviewAt },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
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
