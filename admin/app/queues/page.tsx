import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getFailedTaskControls,
  getFailedTaskRuntimeDecisions,
  getFailedTaskSubmissionContracts,
  getQueueHealth,
  getStage1BatchChildTasks,
  getStage1BatchQueueRuntime
} from "@/lib/admin-api";
import type {
  FailedTaskControl,
  FailedTaskRuntimeDecision,
  FailedTaskSubmissionContract,
  QueueHealth,
  Stage1BatchChildTask,
  Stage1BatchQueueRuntime
} from "@/lib/types";

function actionTone(task: FailedTaskControl) {
  if (task.actionEligibility === "blocked") {
    return "blocked";
  }

  return task.actionEligibility === "requires_review" ? "warning" : "approved";
}

export default async function QueuesPage() {
  const [stage1BatchRuntime, stage1BatchChildren, queues, failedTasks, failedTaskRuntime, failedTaskSubmissionContracts] = await Promise.all([
    getStage1BatchQueueRuntime(),
    getStage1BatchChildTasks(),
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
            <h3>Stage 1 Batch Queue Runtime</h3>
            <p>Batch operations surface child status, worker claim leases, provider strategy group capacity, quota policy, retry idempotency, and drain behavior for launch readiness review.</p>
          </div>
        </div>
        <DataTable<Stage1BatchQueueRuntime>
          rows={stage1BatchRuntime}
          columns={[
            { key: "batch", header: "Batch", render: (row) => <span className="mono">{row.batchId}</span> },
            { key: "tenant", header: "Tenant", render: (row) => <span className="mono">{row.tenantId}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "progress", header: "Progress", render: (row) => `${row.succeeded}/${row.requestedCount} succeeded · ${row.running} running · ${row.retryable} retryable` },
            { key: "provider", header: "Provider/Model", render: (row) => `${row.providerId} · ${row.modelId}` },
            { key: "strategy", header: "Provider Strategy Group", render: (row) => <span className="mono">{row.providerStrategyGroupId}</span> },
            { key: "selection", header: "Selection Policy", render: (row) => <StatusBadge value={row.providerSelectionPolicy} label={row.providerSelectionPolicy} /> },
            { key: "provider-concurrency", header: "Provider Concurrency", render: (row) => row.providerConcurrency },
            { key: "model-concurrency", header: "Provider/Model Concurrency", render: (row) => row.providerModelConcurrency },
            { key: "worker", header: "Worker", render: (row) => <span className="mono">{row.workerId}</span> },
            { key: "claim-timeout", header: "Claim Timeout", render: (row) => `${row.claimTimeoutSeconds}s` },
            { key: "oldest", header: "Oldest Child Age", render: (row) => `${row.oldestChildAgeMinutes} min` },
            { key: "claim-lease", header: "Claim Lease Policy", render: (row) => row.claimLeasePolicy },
            { key: "drain", header: "Drain Policy", render: (row) => row.drainPolicy },
            { key: "quota", header: "Quota Policy", render: (row) => row.quotaPolicy },
            { key: "dead-letter", header: "Dead-letter Policy", render: (row) => row.deadLetterPolicy },
            { key: "idempotency", header: "Provider Idempotency Scope", render: (row) => row.idempotencyScope },
            { key: "action", header: "Operator Action", render: (row) => row.nextOperatorAction },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Stage 1 Batch Child Tasks</h3>
            <p>Child task rows expose retry budget, claim attempts, safety blocks, dead letters, quota commit/refund, result placement, and provider usage linkage.</p>
          </div>
        </div>
        <DataTable<Stage1BatchChildTask>
          rows={stage1BatchChildren}
          columns={[
            { key: "child", header: "Child", render: (row) => <span className="mono">{row.id}</span> },
            { key: "batch", header: "Batch", render: (row) => <span className="mono">{row.batchId}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "fanout", header: "Fanout Stage", render: (row) => <StatusBadge value={row.fanoutStage} label={row.fanoutStage} /> },
            { key: "provider", header: "Provider/Model", render: (row) => `${row.providerId} · ${row.modelId}` },
            { key: "retry", header: "Retry Budget", render: (row) => `${row.retryCount}/${row.maxRetries}` },
            { key: "retry-state", header: "Retry State", render: (row) => <StatusBadge value={row.retryState} label={row.retryState} /> },
            { key: "dead-letter", header: "Dead Letter", render: (row) => <StatusBadge value={row.deadLetterState} label={row.deadLetterState} /> },
            { key: "worker", header: "Worker", render: (row) => <span className="mono">{row.workerId}</span> },
            { key: "claim-attempt", header: "Claim Attempt", render: (row) => row.claimAttempt },
            { key: "claim-expires", header: "Claim Expires At", render: (row) => <span className="mono">{row.claimExpiresAt}</span> },
            { key: "failure", header: "Failure Code", render: (row) => <span className="mono">{row.failureCode}</span> },
            { key: "review", header: "Review Reason", render: (row) => <span className="mono">{row.reviewReason}</span> },
            { key: "quota", header: "Quota Estimate/Commit/Refund", render: (row) => `${row.quotaEstimateUnits}/${row.quotaCommittedUnits}/${row.quotaRefundedUnits}` },
            { key: "asset", header: "Asset", render: (row) => <span className="mono">{row.resultAssetId}</span> },
            { key: "canvas", header: "Canvas Object", render: (row) => <span className="mono">{row.canvasObjectId}</span> },
            { key: "trace", header: "Trace", render: (row) => <span className="mono">{row.visibleTraceRef}</span> },
            { key: "usage", header: "Provider Usage", render: (row) => <span className="mono">{row.providerUsageRef}</span> },
            { key: "idempotency", header: "Idempotency Key", render: (row) => <span className="mono">{row.idempotencyKey}</span> },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

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
            { key: "queue-attempt", header: "Queue Attempt", render: (row) => <StatusBadge value={row.queueAttemptStatus} label={row.queueAttemptStatus} /> },
            { key: "queue-attempt-header", header: "Queue Attempt Header", render: (row) => <span className="mono">{row.queueAttemptHeader}</span> },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "abuse-control", header: "Abuse Control", render: (row) => <StatusBadge value={row.abuseControlStatus} label={row.abuseControlStatus} /> },
            { key: "abuse-control-header", header: "Abuse Control Header", render: (row) => <span className="mono">{row.abuseControlHeader}</span> },
            { key: "abuse-release-status", header: "Abuse Release Evidence", render: (row) => <StatusBadge value={row.abuseControlReleaseEvidenceStatus} label={row.abuseControlReleaseEvidenceStatus} /> },
            { key: "abuse-release-header", header: "Abuse Release Header", render: (row) => <span className="mono">{row.abuseControlReleaseEvidenceHeader}</span> },
            { key: "abuse-release-missing", header: "Missing Abuse Release Refs", render: (row) => row.abuseControlMissingReleaseEvidenceRefs.join(", ") || "none" },
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
            { key: "abuse-release-status", header: "Abuse Release Evidence", render: (row) => <StatusBadge value={row.abuseControlReleaseEvidenceStatus} label={row.abuseControlReleaseEvidenceStatus} /> },
            { key: "abuse-release-evidence", header: "Abuse Release Refs", render: (row) => <span className="mono">{row.abuseControlReleaseEvidence}</span> },
            { key: "abuse-release-missing", header: "Missing Abuse Release Refs", render: (row) => row.abuseControlMissingReleaseEvidenceRefs.join(", ") || "none" },
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
            { key: "queue-attempt", header: "Queue Attempt", render: (row) => <StatusBadge value={row.queueAttemptStatus} /> },
            { key: "queue-attempt-evidence", header: "Queue Attempt Evidence", render: (row) => <span className="mono">{row.queueAttemptEvidence}</span> },
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
            { key: "queue-attempt", header: "Queue Attempt", render: (row) => <span className="mono">{row.queueAttemptId}</span> },
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
