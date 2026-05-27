import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getFailedTaskControls, getQueueHealth } from "@/lib/admin-api";
import { buildFailedTaskRuntimeDecisions } from "@/lib/failed-task-runtime";
import type { FailedTaskControl, FailedTaskRuntimeDecision, QueueHealth } from "@/lib/types";

function actionTone(task: FailedTaskControl) {
  if (task.actionEligibility === "blocked") {
    return "blocked";
  }

  return task.actionEligibility === "requires_review" ? "warning" : "approved";
}

export default async function QueuesPage() {
  const [queues, failedTasks] = await Promise.all([
    getQueueHealth(),
    getFailedTaskControls()
  ]);
  const failedTaskRuntime = buildFailedTaskRuntimeDecisions(failedTasks);

  return (
    <>
      <PageHeader
        title="Queue and Dead-letter Dashboard"
        description="Operational visibility for pending, running, failed, and dead-letter queue work."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Queues</h3>
            <p>Dead-letter work must be inspected before retry, regeneration, or permanent closure.</p>
          </div>
        </div>
        <DataTable<QueueHealth>
          rows={queues}
          columns={[
            { key: "name", header: "Queue", render: (row) => <strong>{row.name}</strong> },
            { key: "pending", header: "Pending", render: (row) => row.pending },
            { key: "running", header: "Running", render: (row) => row.running },
            { key: "dead", header: "Dead Letters", render: (row) => <StatusBadge value={row.deadLetters > 0 ? "warning" : "healthy"} label={String(row.deadLetters)} /> },
            { key: "oldest", header: "Oldest Age", render: (row) => `${row.oldestAgeMinutes} min` },
            { key: "action", header: "Action", render: (row) => row.action },
            { key: "retry", header: "Retry Policy", render: (row) => row.retryPolicy },
            { key: "cancel", header: "Cancel Policy", render: (row) => row.cancelPolicy },
            { key: "idempotency", header: "Idempotency Scope", render: (row) => row.idempotencyScope },
            { key: "backoff", header: "Retry Backoff", render: (row) => row.retryBackoffPolicy },
            { key: "role", header: "Owner Role", render: (row) => row.ownerRole },
            { key: "incident", header: "Incident", render: (row) => <span className="mono">{row.linkedIncident}</span> },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Retry and Cancel Submit Gates</h3>
            <p>Computed submit decisions keep blocked holds disabled, send second-review cancels to reviewers, and prove retry idempotency before quota settlement.</p>
          </div>
        </div>
        <DataTable<FailedTaskRuntimeDecision>
          rows={failedTaskRuntime}
          columns={[
            { key: "task", header: "Task", render: (row) => <span className="mono">{row.taskId}</span> },
            { key: "queue", header: "Queue", render: (row) => <span className="mono">{row.queueId}</span> },
            { key: "action", header: "Action", render: (row) => row.requestedAction },
            { key: "submit", header: "Submit Gate", render: (row) => <StatusBadge value={row.submitDecision} /> },
            { key: "transition", header: "State Transition", render: (row) => <StatusBadge value={row.stateTransition} label={row.stateTransition} /> },
            { key: "closure-outcome", header: "Closure Outcome", render: (row) => <StatusBadge value={row.closureOutcome} label={row.closureOutcome} /> },
            { key: "release-gate", header: "Release Gate", render: (row) => <StatusBadge value={row.releaseGateDisposition} label={row.releaseGateDisposition} /> },
            { key: "retry-budget", header: "Retry Budget", render: (row) => <StatusBadge value={row.retryBudgetStatus} /> },
            { key: "rbac", header: "RBAC", render: (row) => <StatusBadge value={row.rbacStatus} /> },
            { key: "quota", header: "Quota Settlement", render: (row) => row.quotaSettlement },
            { key: "idempotency-key", header: "Idempotency Key", render: (row) => <span className="mono">{row.idempotencyKey}</span> },
            { key: "idempotency", header: "Idempotency", render: (row) => <StatusBadge value={row.idempotencyStatus} /> },
            { key: "state-digest", header: "State Digest", render: (row) => <StatusBadge value={row.stateDigestStatus} /> },
            { key: "state-digest-evidence", header: "State Digest Evidence", render: (row) => <span className="mono">{row.stateDigestEvidence}</span> },
            { key: "compatibility", header: "Compatibility", render: (row) => <StatusBadge value={row.compatibilityStatus} /> },
            { key: "compatibility-evidence", header: "Compatibility Evidence", render: (row) => <span className="mono">{row.compatibilityEvidence}</span> },
            { key: "api-outcome", header: "API Outcome", render: (row) => <StatusBadge value={row.apiOutcome} label={row.apiOutcome} /> },
            { key: "quota-ledger", header: "Quota Ledger", render: (row) => <StatusBadge value={row.quotaLedgerEffect} label={row.quotaLedgerEffect} /> },
            { key: "support-notice", header: "Support Notice", render: (row) => <StatusBadge value={row.supportNoticeStatus} label={row.supportNoticeStatus} /> },
            { key: "audit-policy", header: "Audit Write Policy", render: (row) => row.auditWritePolicy },
            { key: "regression-effect", header: "Regression Gate Effect", render: (row) => <StatusBadge value={row.regressionGateEffect} label={row.regressionGateEffect} /> },
            { key: "closure", header: "Closure Evidence", render: (row) => <StatusBadge value={row.closureEvidenceStatus} /> },
            { key: "rbac-evidence-status", header: "RBAC Evidence Status", render: (row) => <StatusBadge value={row.rbacEvidenceStatus} /> },
            { key: "rbac-evidence", header: "RBAC Evidence", render: (row) => row.rbacEvidenceRefs.join(", ") },
            { key: "message", header: "User Message", render: (row) => <StatusBadge value={row.userMessageStatus} /> },
            {
              key: "blockers",
              header: "Blockers",
              render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none")
            },
            { key: "disabled", header: "Disabled Reason", render: (row) => row.submitDisabledReason },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Failed Task Retry and Cancel Controls</h3>
            <p>Retry, cancel, and hold decisions require support linkage, role eligibility, user-visible messaging, version evidence, and immutable audit refs.</p>
          </div>
        </div>
        <DataTable<FailedTaskControl>
          rows={failedTasks}
          columns={[
            { key: "task", header: "Task", render: (row) => <span className="mono">{row.id}</span> },
            { key: "queue", header: "Queue", render: (row) => <span className="mono">{row.queueId}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "request", header: "Requested Action", render: (row) => <StatusBadge value={actionTone(row)} label={row.requestedAction} /> },
            { key: "eligibility", header: "Eligibility", render: (row) => row.actionEligibility },
            { key: "retry-count", header: "Retry Count", render: (row) => `${row.retryCount}/${row.maxRetries}` },
            { key: "timeout", header: "Timeout", render: (row) => `${row.timeoutSeconds}s` },
            { key: "error", header: "Error Code", render: (row) => <span className="mono">{row.errorCode}</span> },
            { key: "message", header: "User Message", render: (row) => row.userMessage },
            { key: "versions", header: "Versions", render: (row) => `${row.appVersion} · ${row.workerVersion} · ${row.schemaVersion}` },
            { key: "state-digests", header: "State Digests", render: (row) => <span className="mono">{row.preActionStateDigest} · {row.observedStateDigest}</span> },
            { key: "role", header: "Allowed Role", render: (row) => row.allowedRole },
            { key: "request-role", header: "Requested By", render: (row) => row.requestedByRole },
            { key: "rbac", header: "RBAC Decision", render: (row) => <StatusBadge value={row.rbacDecision === "allowed" ? "approved" : "blocked"} label={row.rbacDecision} /> },
            { key: "idempotency", header: "Idempotency Key", render: (row) => <span className="mono">{row.idempotencyKey}</span> },
            { key: "quota", header: "Quota Effect", render: (row) => row.quotaEffect },
            { key: "regression", header: "Regression Fixture", render: (row) => row.regressionFixtureRef },
            { key: "closure", header: "Closure Evidence", render: (row) => row.closureEvidenceRefs.join(", ") },
            { key: "rbac-evidence", header: "RBAC Evidence", render: (row) => row.rbacEvidenceRefs.join(", ") },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "trace", header: "Trace", render: (row) => <span className="mono">{row.traceId}</span> },
            { key: "runbook", header: "Operator Runbook", render: (row) => row.operatorRunbook },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
