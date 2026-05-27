import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAlertRoutes,
  getAlertRouteRuntimeEvidence,
  getBackendMetricsRuntimeEvidence,
  getIncidentLogs,
  getMaintenanceBanners,
  getOperationalDashboardRuntimeEvidence,
  getOperationalDashboards,
  getObservabilityTelemetryRuntimeEvidence,
  getProductionBackupRollbackIncidentEvidence,
  getReleaseBlockers,
  getStagingObjectStorageRetentionCleanupEvidence,
  getStagingObservabilityBackupLoadPreflightEvidence
} from "@/lib/admin-api";
import type {
  AlertRoute,
  AlertRouteRuntimeEvidence,
  BackendMetricsRuntimeEvidence,
  BackendMetricsRuntimeProbe,
  IncidentLog,
  MaintenanceBanner,
  OperationalDashboard,
  OperationalDashboardRuntimeEvidence,
  ObservabilityTelemetryRuntimeControl,
  ObservabilityTelemetryRuntimeEvidence,
  ProductionBackupRollbackIncidentCoverage,
  ProductionBackupRollbackIncidentEvidence,
  ReleaseBlocker,
  StagingObjectStorageRetentionCleanupCoverage,
  StagingObjectStorageRetentionCleanupEvidence,
  StagingObservabilityBackupLoadPreflightEvidence,
  StagingObservabilityBackupLoadPreflightSlot
} from "@/lib/types";

function incidentTone(status: IncidentLog["status"]) {
  if (status === "resolved") {
    return "healthy";
  }

  return status === "mitigating" ? "warning" : "blocked";
}

export default async function OperationsPage() {
  const [
    incidents,
    banners,
    dashboards,
    dashboardRuntimeEvidence,
    alerts,
    alertRuntimeEvidence,
    metricsRuntimeEvidence,
    telemetryRuntimeEvidence,
    observabilityBackupLoadPreflight,
    objectStorageRetentionCleanupEvidence,
    productionBackupRollbackIncidentEvidence
  ] = await Promise.all([
    getIncidentLogs(),
    getMaintenanceBanners(),
    getOperationalDashboards(),
    getOperationalDashboardRuntimeEvidence(),
    getAlertRoutes(),
    getAlertRouteRuntimeEvidence(),
    getBackendMetricsRuntimeEvidence(),
    getObservabilityTelemetryRuntimeEvidence(),
    getStagingObservabilityBackupLoadPreflightEvidence(),
    getStagingObjectStorageRetentionCleanupEvidence(),
    getProductionBackupRollbackIncidentEvidence()
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
            <h3>Production Backup Rollback Incident Evidence</h3>
            <p>Production operations evidence validates backup restore, rollback drills, alert incident paths, and post-deploy smoke while preserving unrelated launch blockers.</p>
          </div>
        </div>
        <DataTable<ProductionBackupRollbackIncidentEvidence>
          rows={[productionBackupRollbackIncidentEvidence]}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "role", header: "Validated By", render: (row) => row.validatedByRole },
            { key: "check", header: "Release Gate Check", render: (row) => row.releaseGateCheckId },
            { key: "conditions", header: "Tracked Conditions", render: (row) => row.doNotLaunchConditionIds.join(", ") },
            { key: "clear", header: "Can Clear Rows", render: (row) => (row.gateImpact.canClearCheckLevelItems ? "yes" : "no") },
            { key: "aggregate", header: "Aggregate Gate", render: (row) => row.gateImpact.aggregateProductionGateStatus },
            { key: "path", header: "Evidence Path", render: (row) => row.evidencePath },
            { key: "remaining", header: "Remaining Blockers", render: (row) => row.gateImpact.remainingBlockers.join(", ") }
          ]}
        />
        <DataTable<ProductionBackupRollbackIncidentCoverage>
          rows={productionBackupRollbackIncidentEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Validation", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "runtime", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "deployment", header: "Deployment Evidence", render: (row) => row.deploymentEvidence },
            { key: "audit", header: "Operational Audit Evidence", render: (row) => row.operationalAuditEvidence },
            { key: "artifacts", header: "Admin Artifacts", render: (row) => row.linkedAdminArtifacts.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Observability Telemetry Runtime</h3>
            <p>Staging telemetry evidence must prove request-id propagation, structured JSON log redaction, trace linkage, and gate handling.</p>
          </div>
        </div>
        <DataTable<ObservabilityTelemetryRuntimeEvidence>
          rows={[telemetryRuntimeEvidence]}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "role", header: "Validated By", render: (row) => row.validatedByRole },
            { key: "check", header: "Release Gate Check", render: (row) => row.releaseGateCheckId },
            { key: "clear", header: "Can Clear Rows", render: (row) => (row.canClearChecklistItems ? "yes" : "no") },
            { key: "items", header: "Closed Checklist Rows", render: (row) => row.closedChecklistItems.join(", ") },
            { key: "aggregate", header: "Aggregate Gate", render: (row) => row.aggregatePrivateBetaGateStatus },
            { key: "path", header: "Evidence Path", render: (row) => row.evidencePath },
            { key: "remaining", header: "Remaining Blockers", render: (row) => row.remainingBlockers.join(", ") }
          ]}
        />
        <DataTable<ObservabilityTelemetryRuntimeControl>
          rows={telemetryRuntimeEvidence.controls}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Validation", render: (row) => <StatusBadge value={row.validationStatus} label={row.validationStatus} /> },
            { key: "runtime", header: "Runtime Ref", render: (row) => row.runtimeRef },
            { key: "services", header: "Services", render: (row) => row.services.join(", ") },
            { key: "propagation", header: "Propagation Probe", render: (row) => row.propagationProbe },
            { key: "redaction", header: "Redaction Probe", render: (row) => row.redactionProbe },
            { key: "trace", header: "Trace Linkage", render: (row) => row.traceLinkageProbe },
            { key: "release", header: "Release Gate Use", render: (row) => row.releaseGateUse },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Observability Backup Load Preflight</h3>
            <p>Combined staging gate evidence must verify observability, restore, and load slots before the private beta aggregate row can close.</p>
          </div>
        </div>
        <DataTable<StagingObservabilityBackupLoadPreflightEvidence>
          rows={[observabilityBackupLoadPreflight]}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "sha", header: "Release SHA", render: (row) => <span className="mono">{row.releaseSha}</span> },
            { key: "check", header: "Release Gate Check", render: (row) => row.releaseGateCheckId },
            { key: "clear", header: "Can Clear Aggregate", render: (row) => (row.canClearAggregateItem ? "yes" : "no") },
            { key: "condition", header: "Preserved Condition", render: (row) => row.preservedDoNotLaunchConditionId },
            { key: "path", header: "Preflight Report", render: (row) => row.latestPreflightReport },
            { key: "action", header: "Operator Action", render: (row) => row.operatorAction },
            { key: "release", header: "Release Gate Use", render: (row) => row.releaseGateUse }
          ]}
        />
        <DataTable<StagingObservabilityBackupLoadPreflightSlot>
          rows={observabilityBackupLoadPreflight.slots}
          columns={[
            { key: "slot", header: "Slot", render: (row) => row.slot },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "path", header: "Evidence Path", render: (row) => row.evidencePath || "missing" },
            { key: "required", header: "Required Entries", render: (row) => row.requiredEntries.join(", ") },
            { key: "verified", header: "Verified Entries", render: (row) => row.verifiedEntries.join(", ") || "none" },
            { key: "missing", header: "Missing Entries", render: (row) => row.missingEntries.join(", ") || "none" },
            { key: "reason", header: "Blocking Reason", render: (row) => row.blockingReason },
            { key: "release", header: "Release Gate Use", render: (row) => row.releaseGateUse },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Object Storage Retention Cleanup</h3>
            <p>Staging object-storage retention and cleanup must produce exact runtime evidence before the signed-download release gate can close.</p>
          </div>
        </div>
        <DataTable<StagingObjectStorageRetentionCleanupEvidence>
          rows={[objectStorageRetentionCleanupEvidence]}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "check", header: "Release Gate Check", render: (row) => row.releaseGateCheckId },
            { key: "condition", header: "Preserved Condition", render: (row) => row.doNotLaunchConditionId },
            { key: "script", header: "Required Script", render: (row) => row.requiredScript },
            { key: "artifact", header: "Required Artifact", render: (row) => row.requiredArtifactPath },
            { key: "signed", header: "Signed URL Evidence", render: (row) => row.signedUrlEvidencePath },
            { key: "clear", header: "Can Clear Retention", render: (row) => (row.canClearRetentionCleanupChecklistItem ? "yes" : "no") },
            { key: "gate", header: "Can Clear Gate", render: (row) => (row.canClearReleaseGateCheck ? "yes" : "no") },
            { key: "missing", header: "Missing Runtime Inputs", render: (row) => row.missingRuntimeInputs.join(", ") },
            { key: "remaining", header: "Remaining Blockers", render: (row) => row.remainingReleaseGateBlockers.join(", ") },
            { key: "action", header: "Operator Action", render: (row) => row.operatorAction }
          ]}
        />
        <DataTable<StagingObjectStorageRetentionCleanupCoverage>
          rows={objectStorageRetentionCleanupEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "endpoint", header: "Admin Endpoint", render: (row) => row.adminEndpoint },
            { key: "tokens", header: "Expected Tokens", render: (row) => row.expectedTokens.join(", ") },
            { key: "blocker", header: "Blocker", render: (row) => row.blocker },
            { key: "release", header: "Release Gate Use", render: (row) => row.releaseGateUse },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
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
            <h3>Backend Worker Crawler Metrics</h3>
            <p>Staging metrics evidence must prove scrape targets, required signals, label redaction, SLO probes, and release-gate handling.</p>
          </div>
        </div>
        <DataTable<BackendMetricsRuntimeEvidence>
          rows={[metricsRuntimeEvidence]}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "role", header: "Validated By", render: (row) => row.validatedByRole },
            { key: "check", header: "Release Gate Check", render: (row) => row.releaseGateCheckId },
            { key: "item", header: "Checklist Item", render: (row) => row.blueprintChecklistItem },
            { key: "clear", header: "Can Clear Row", render: (row) => (row.canClearChecklistItem ? "yes" : "no") },
            { key: "aggregate", header: "Aggregate Gate", render: (row) => row.aggregatePrivateBetaGateStatus },
            { key: "path", header: "Evidence Path", render: (row) => row.evidencePath },
            { key: "remaining", header: "Remaining Blockers", render: (row) => row.remainingBlockers.join(", ") }
          ]}
        />
        <DataTable<BackendMetricsRuntimeProbe>
          rows={metricsRuntimeEvidence.probes}
          columns={[
            { key: "service", header: "Service", render: (row) => row.service },
            { key: "status", header: "Validation", render: (row) => <StatusBadge value={row.validationStatus} label={row.validationStatus} /> },
            { key: "target", header: "Scrape Target", render: (row) => row.scrapeTarget },
            { key: "signals", header: "Required Signals", render: (row) => row.requiredSignals.join(", ") },
            { key: "window", header: "Sample Window", render: (row) => row.sampleWindow },
            { key: "cardinality", header: "Cardinality Probe", render: (row) => row.cardinalityProbe },
            { key: "slo", header: "SLO Probe", render: (row) => row.sloProbe },
            { key: "release", header: "Release Gate Use", render: (row) => row.releaseGateUse },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
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
