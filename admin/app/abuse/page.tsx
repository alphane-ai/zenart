import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAbuseControlHooks,
  getAbuseEvents,
  getAbuseQueueRuntime,
  getAbuseRuntimeDecisions,
  getProductionAbuseThrottleHoldEvidence
} from "@/lib/admin-api";
import type {
  AbuseControlHook,
  AbuseEvent,
  AbuseQueueRuntimeEntry,
  AbuseRuntimeDecision,
  ProductionAbuseThrottleHoldCoverage
} from "@/lib/types";

export default async function AbusePage() {
  const events = await getAbuseEvents();
  const hooks = await getAbuseControlHooks();
  const runtimeDecisions = await getAbuseRuntimeDecisions();
  const queueRuntime = await getAbuseQueueRuntime();
  const productionEvidence = await getProductionAbuseThrottleHoldEvidence();

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
            { key: "execution", header: "Execution Mode", render: (row) => <StatusBadge value={row.executionMode === "enforced" ? "blocked" : "warning"} label={row.executionMode} /> },
            { key: "dry-run", header: "Dry Run Evidence", render: (row) => row.lastDryRunEvidence },
            { key: "payload", header: "Hook Payload", render: (row) => row.hookPayload },
            { key: "threshold", header: "Threshold", render: (row) => row.threshold },
            { key: "telemetry", header: "Telemetry Signal", render: (row) => row.telemetrySignal },
            { key: "user-state", header: "User Visible State", render: (row) => row.userVisibleState },
            { key: "expires", header: "Expires", render: (row) => `${row.durationMinutes} min, ${row.expiresAt}` },
            { key: "role", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted-role", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "rbac", header: "RBAC Decision", render: (row) => <StatusBadge value={row.rbacDecision === "allowed" ? "approved" : "blocked"} label={row.rbacDecision} /> },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "rollback", header: "Rollback Action", render: (row) => row.rollbackAction },
            { key: "release", header: "Release Condition", render: (row) => row.releaseCondition },
            { key: "release-evidence", header: "Release Evidence", render: (row) => row.releaseEvidenceRefs.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "runbook", header: "Operator Runbook", render: (row) => row.operatorRunbook },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Runtime Enforcement Decisions</h3>
            <p>Executable admin policy maps active hooks to account holds, throttles, RBAC dry runs, quota-consuming task blocks, and release evidence.</p>
          </div>
        </div>
        <DataTable<AbuseRuntimeDecision>
          rows={runtimeDecisions}
          columns={[
            { key: "hook", header: "Hook", render: (row) => <span className="mono">{row.hookId}</span> },
            { key: "status", header: "Runtime Status", render: (row) => <StatusBadge value={row.runtimeStatus === "enforced" ? "blocked" : "warning"} label={row.runtimeStatus} /> },
            { key: "outcome", header: "Request Outcome", render: (row) => row.requestOutcome },
            { key: "quota-task", header: "Quota Task", render: (row) => (row.canCreateQuotaConsumingTask ? "allowed" : "blocked") },
            { key: "queue", header: "Queue Action", render: (row) => row.queueAction },
            { key: "rbac", header: "RBAC Decision", render: (row) => row.rbacDecision },
            { key: "expires", header: "Expires", render: (row) => row.expiresAt },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Production Abuse Gate Evidence</h3>
            <p>Production probes clear only the abuse throttle/hold check and preserve unrelated launch blockers.</p>
          </div>
          <StatusBadge value="warning" label={productionEvidence.status} />
        </div>
        <DataTable<ProductionAbuseThrottleHoldCoverage>
          rows={productionEvidence.coverage}
          columns={[
            { key: "area", header: "Area", render: (row) => row.area },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status === "pass" ? "approved" : "blocked"} label={row.status} /> },
            { key: "probe", header: "Runtime Probe", render: (row) => row.runtimeProbe },
            { key: "deployment", header: "Deployment Evidence", render: (row) => row.deploymentEvidence },
            { key: "rbac", header: "RBAC/Audit Evidence", render: (row) => row.rbacAuditEvidence },
            { key: "refs", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Abuse Queue Runtime</h3>
            <p>Queue entries stay open until runtime controls, role ownership, audit refs, and release evidence all agree.</p>
          </div>
        </div>
        <DataTable<AbuseQueueRuntimeEntry>
          rows={queueRuntime}
          columns={[
            { key: "event", header: "Abuse Event", render: (row) => <span className="mono">{row.abuseEventId}</span> },
            { key: "status", header: "Runtime Status", render: (row) => <StatusBadge value={row.runtimeStatus === "controlled" ? "blocked" : "warning"} label={row.runtimeStatus} /> },
            { key: "hooks", header: "Active Hooks", render: (row) => row.activeHookIds.join(", ") || "none" },
            { key: "closure", header: "Closure Allowed", render: (row) => (row.closureAllowed ? "yes" : "no") },
            { key: "reason", header: "Blocking Reason", render: (row) => row.blockingReason },
            { key: "next", header: "Next Action", render: (row) => row.nextAction },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
