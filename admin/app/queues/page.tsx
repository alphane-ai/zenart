import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getFailedTaskControls,
  getFailedTaskRuntimeDecisions,
  getFailedTaskSubmissionContracts,
  getQueueHealth
} from "@/lib/admin-api";
import type {
  FailedTaskControl,
  FailedTaskRuntimeDecision,
  FailedTaskSubmissionContract,
  QueueHealth
} from "@/lib/types";

function actionTone(task: FailedTaskControl) {
  if (task.actionEligibility === "blocked") {
    return "blocked";
  }

  return task.actionEligibility === "requires_review" ? "warning" : "approved";
}

export default async function QueuesPage() {
  const [queues, failedTasks, failedTaskRuntime, failedTaskSubmissionContracts] = await Promise.all([
    getQueueHealth(),
    getFailedTaskControls(),
    getFailedTaskRuntimeDecisions(),
    getFailedTaskSubmissionContracts()
  ]);

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
            <h3>Failed Task Submission Contract</h3>
            <p>Admin retry, cancel, and hold requests must bind CSRF, idempotency, precondition digest, support ticket, audit ordering, quota settlement, and release-gate disposition before mutation.</p>
          </div>
        </div>
        <DataTable<FailedTaskSubmissionContract>
          rows={failedTaskSubmissionContracts}
          columns={[
            { key: "task", header: "Task", render: (row) => <span className="mono">{row.taskId}</span> },
            { key: "path", header: "Request Path", render: (row) => <span className="mono">{row.requestPath}</span> },
            { key: "enabled", header: "Submit Enabled", render: (row) => <StatusBadge value={row.submitEnabled ? "approved" : "blocked"} label={String(row.submitEnabled)} /> },
            { key: "decision", header: "Submit Decision", render: (row) => <StatusBadge value={row.submitDecision} /> },
            { key: "api", header: "API Outcome", render: (row) => <StatusBadge value={row.apiOutcome} label={row.apiOutcome} /> },
            { key: "csrf", header: "CSRF Scope", render: (row) => row.csrfScope },
            { key: "headers", header: "Required Headers", render: (row) => row.requiredHeaders.join(", ") },
            { key: "idempotency", header: "Idempotency", render: (row) => <StatusBadge value={row.idempotencyHeaderStatus} /> },
            { key: "precondition", header: "Precondition Digest", render: (row) => <StatusBadge value={row.preconditionDigestStatus} label={row.preconditionDigestStatus} /> },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "abuse-control", header: "Abuse Control", render: (row) => <StatusBadge value={row.abuseControlStatus} label={row.abuseControlStatus} /> },
            { key: "abuse-control-header", header: "Abuse Control Header", render: (row) => <span className="mono">{row.abuseControlHeader}</span> },
            { key: "response", header: "Response Contract", render: (row) => row.responseContract },
            { key: "mutation", header: "Mutation Order", render: (row) => <StatusBadge value={row.mutationOrder} label={row.mutationOrder} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "second-review-evidence", header: "Second Review Evidence", render: (row) => <StatusBadge value={row.secondReviewEvidenceStatus} label={row.secondReviewEvidenceStatus} /> },
            { key: "second-review-header", header: "Second Review Header", render: (row) => <span className="mono">{row.secondReviewHeader}</span> },
            { key: "quota", header: "Quota Ledger", render: (row) => <StatusBadge value={row.quotaLedgerEffect} label={row.quotaLedgerEffect} /> },
            { key: "release", header: "Release Gate Use", render: (row) => <StatusBadge value={row.releaseGateUse} label={row.releaseGateUse} /> },
            { key: "replay", header: "Replay Protection", render: (row) => <StatusBadge value={row.replayProtection} label={row.replayProtection} /> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "blockers", header: "Blockers", render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none") },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction },
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
            { key: "regression-fixture-status", header: "Regression Fixture Status", render: (row) => <StatusBadge value={row.regressionFixtureStatus} label={row.regressionFixtureStatus} /> },
            { key: "regression-fixture-evidence", header: "Regression Fixture Evidence", render: (row) => <span className="mono">{row.regressionFixtureEvidence}</span> },
            { key: "abuse-control-status", header: "Abuse Control", render: (row) => <StatusBadge value={row.abuseControlStatus} label={row.abuseControlStatus} /> },
            { key: "abuse-control-evidence", header: "Abuse Control Evidence", render: (row) => <span className="mono">{row.abuseControlEvidence}</span> },
            { key: "retry-budget", header: "Retry Budget", render: (row) => <StatusBadge value={row.retryBudgetStatus} /> },
            { key: "rbac", header: "RBAC", render: (row) => <StatusBadge value={row.rbacStatus} /> },
            { key: "role-authorization", header: "Role Authorization", render: (row) => <StatusBadge value={row.roleAuthorizationStatus} /> },
            { key: "role-authorization-evidence", header: "Role Authorization Evidence", render: (row) => <span className="mono">{row.roleAuthorizationEvidence}</span> },
            { key: "second-review-status", header: "Second Review Status", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "second-review-distinct", header: "Second Review Distinctness", render: (row) => <StatusBadge value={row.secondReviewDistinctnessStatus} label={row.secondReviewDistinctnessStatus} /> },
            { key: "second-review-evidence-status", header: "Second Review Evidence", render: (row) => <StatusBadge value={row.secondReviewEvidenceStatus} label={row.secondReviewEvidenceStatus} /> },
            { key: "second-review-proof", header: "Second Review Proof", render: (row) => <span className="mono">{row.secondReviewEvidence}</span> },
            { key: "quota", header: "Quota Settlement", render: (row) => row.quotaSettlement },
            { key: "idempotency-key", header: "Idempotency Key", render: (row) => <span className="mono">{row.idempotencyKey}</span> },
            { key: "idempotency", header: "Idempotency", render: (row) => <StatusBadge value={row.idempotencyStatus} /> },
            { key: "state-digest", header: "State Digest", render: (row) => <StatusBadge value={row.stateDigestStatus} /> },
            { key: "state-digest-evidence", header: "State Digest Evidence", render: (row) => <span className="mono">{row.stateDigestEvidence}</span> },
            { key: "compatibility", header: "Compatibility", render: (row) => <StatusBadge value={row.compatibilityStatus} /> },
            { key: "app-compatibility", header: "App Version Gate", render: (row) => <StatusBadge value={row.appCompatibilityStatus} label={row.appCompatibilityStatus} /> },
            { key: "worker-compatibility", header: "Worker Version Gate", render: (row) => <StatusBadge value={row.workerCompatibilityStatus} label={row.workerCompatibilityStatus} /> },
            { key: "schema-compatibility", header: "Schema Version Gate", render: (row) => <StatusBadge value={row.schemaCompatibilityStatus} label={row.schemaCompatibilityStatus} /> },
            { key: "compatibility-evidence", header: "Compatibility Evidence", render: (row) => <span className="mono">{row.compatibilityEvidence}</span> },
            { key: "support-linkage", header: "Support Linkage", render: (row) => <StatusBadge value={row.supportTicketLinkageStatus} label={row.supportTicketLinkageStatus} /> },
            { key: "support-linkage-evidence", header: "Support Linkage Evidence", render: (row) => <span className="mono">{row.supportTicketLinkageEvidence}</span> },
            { key: "tenant-scope", header: "Tenant Scope", render: (row) => <StatusBadge value={row.tenantScopeStatus} label={row.tenantScopeStatus} /> },
            { key: "tenant-scope-evidence", header: "Tenant Scope Evidence", render: (row) => <span className="mono">{row.tenantScopeEvidence}</span> },
            { key: "trace-linkage", header: "Trace Linkage", render: (row) => <StatusBadge value={row.traceLinkageStatus} label={row.traceLinkageStatus} /> },
            { key: "trace-linkage-evidence", header: "Trace Linkage Evidence", render: (row) => <span className="mono">{row.traceLinkageEvidence}</span> },
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
            { key: "request-admin", header: "Requested Admin", render: (row) => <span className="mono">{row.requestedByAdminId}</span> },
            { key: "rbac", header: "RBAC Decision", render: (row) => <StatusBadge value={row.rbacDecision === "allowed" ? "approved" : "blocked"} label={row.rbacDecision} /> },
            { key: "second-review-required", header: "Second Review Required", render: (row) => <StatusBadge value={row.secondReviewRequired ? "warning" : "healthy"} label={String(row.secondReviewRequired)} /> },
            { key: "second-review-state", header: "Second Review State", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "second-reviewer", header: "Second Reviewer", render: (row) => <span className="mono">{row.secondReviewerAdminId}</span> },
            { key: "second-review-audit", header: "Second Review Audit", render: (row) => <span className="mono">{row.secondReviewAuditRef}</span> },
            { key: "second-review-refs", header: "Second Review Refs", render: (row) => row.secondReviewEvidenceRefs.join(", ") },
            { key: "idempotency", header: "Idempotency Key", render: (row) => <span className="mono">{row.idempotencyKey}</span> },
            { key: "quota", header: "Quota Effect", render: (row) => row.quotaEffect },
            { key: "regression", header: "Regression Fixture", render: (row) => row.regressionFixtureRef },
            { key: "abuse-control-hooks", header: "Abuse Control Hooks", render: (row) => row.abuseControlHookRefs.join(", ") || "none" },
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
