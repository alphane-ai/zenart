import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");
const repoRoot = new URL("../../", import.meta.url);

const parseFixtures = () => {
  const moduleSource = source
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/export const (\w+)[^=]*=/g, "const $1 =");
  return Function(`${moduleSource}\nreturn { skillVersions, skillReleaseStateDefinitions, skillCanaryMetrics, releaseEvidence, supportTickets, supportEscalationRunbooks, supportUsers, riskyExports, abuseEvents, abuseControlHooks, auditEvents, exportJobs, traces, quotaAccounts, feedbackItems, regressionFixtures, analyticsReports, queueHealth, failedTaskControls, crawlerFindings, crawlerSourceApprovals, crawlerGovernanceWorkflows, adminRbacEvidence };`)();
};

const {
  skillVersions,
  skillReleaseStateDefinitions,
  skillCanaryMetrics,
  releaseEvidence,
  supportTickets,
  supportEscalationRunbooks,
  supportUsers,
  riskyExports,
  abuseEvents,
  abuseControlHooks,
  auditEvents,
  exportJobs,
  feedbackItems,
  regressionFixtures,
  analyticsReports,
  traces,
  quotaAccounts,
  queueHealth,
  failedTaskControls,
  crawlerFindings,
  crawlerSourceApprovals,
  crawlerGovernanceWorkflows,
  adminRbacEvidence
} = parseFixtures();

const auditIds = new Set(auditEvents.map((event) => event.id));
const supportTicketIds = new Set(supportTickets.map((ticket) => ticket.id));
const supportTicketById = new Map(supportTickets.map((ticket) => [ticket.id, ticket]));
const supportUserIds = new Set(supportUsers.map((user) => user.id));
const traceIds = new Set(traces.map((trace) => trace.id));
const exportIds = new Set(exportJobs.map((job) => job.id));
const quotaUserIds = new Set(quotaAccounts.map((account) => account.userId));
const queueIds = new Set(queueHealth.map((queue) => queue.id));
const crawlerFindingIds = new Set(crawlerFindings.map((finding) => finding.id));
const crawlerFindingById = new Map(crawlerFindings.map((finding) => [finding.id, finding]));
const incidentIds = new Set(["none", "inc-20260526-queue", "inc-20260525-crawler"]);
const abuseEventById = new Map(abuseEvents.map((event) => [event.id, event]));
const canaryMetricIds = new Set(skillCanaryMetrics.map((metric) => metric.id));

const roleOrder = new Map([
  ["support_operator", 1],
  ["admin_viewer", 1],
  ["admin_operator", 2],
  ["admin_reviewer", 3],
  ["admin_superadmin", 4]
]);

test("skill release governance defines states, traffic allocation, canary thresholds, and rollback audit", () => {
  const states = new Set(skillReleaseStateDefinitions.map((definition) => definition.state));
  for (const state of [
    "draft",
    "review",
    "eval_passed",
    "internal_canary",
    "allowlist_canary",
    "percent_canary",
    "active",
    "paused",
    "rolled_back",
    "deprecated"
  ]) {
    assert.ok(states.has(state), `missing release state ${state}`);
  }

  for (const version of skillVersions) {
    const allocationTotal =
      version.trafficAllocation.internalPercent +
      version.trafficAllocation.allowlistPercent +
      version.trafficAllocation.publicPercent +
      version.trafficAllocation.holdoutPercent;
    assert.equal(allocationTotal, 100, `${version.id} traffic allocation must total 100`);
    assert.ok(version.trafficAllocation.routeEvidence.length > 20, `${version.id} needs route evidence`);
    assert.ok(auditIds.has(version.rollbackAuditRef), `${version.id} needs rollback audit`);
  }

  assert.ok(skillCanaryMetrics.some((metric) => metric.status === "stop"), "canary metrics need stop signals");
  assert.ok(
    skillCanaryMetrics.some((metric) => metric.stopAction === "rollback"),
    "canary metrics need rollback stop actions"
  );
  for (const metric of skillCanaryMetrics) {
    assert.ok(metric.sampleSize > 0, `${metric.id} needs sample size`);
    assert.ok(metric.stopThreshold.length > 10, `${metric.id} needs stop threshold`);
    assert.ok(auditIds.has(metric.auditRef), `${metric.id} links unknown audit ${metric.auditRef}`);
  }
});

test("abuse queue entries require actionable governance evidence", () => {
  for (const event of abuseEvents) {
    assert.ok(event.assignedRole, `${event.id} needs an assigned admin role`);
    assert.ok(event.allowedActions.length > 0, `${event.id} needs allowed actions`);
    assert.ok(event.reviewRationale.length > 20, `${event.id} needs reviewer rationale`);
    assert.notEqual(event.auditRef, "pending", `${event.id} needs immutable audit before closure`);

    if (event.linkedSupportTicket !== "pending") {
      assert.ok(
        supportTicketIds.has(event.linkedSupportTicket),
        `${event.id} links unknown support ticket ${event.linkedSupportTicket}`
      );
    }

    if (event.auditRef !== "pending") {
      assert.ok(auditIds.has(event.auditRef), `${event.id} links unknown audit event ${event.auditRef}`);
    }

    if (event.severity === "critical") {
      assert.equal(event.assignedRole, "admin_superadmin", `${event.id} critical abuse needs superadmin ownership`);
      assert.equal(event.resolution, "open", `${event.id} critical abuse stays open until audited escalation`);
    }
  }
});

test("temporary hold and throttle hooks enforce abuse controls with RBAC, expiry, and audit evidence", () => {
  assert.ok(abuseControlHooks.length > 0, "temporary hold/throttle hooks need fixtures");

  const actions = new Set(abuseControlHooks.map((hook) => hook.action));
  assert.ok(actions.has("temporary_hold"), "abuse controls need temporary hold hooks");
  assert.ok(actions.has("rate_limit"), "abuse controls need throttle/rate-limit hooks");

  for (const hook of abuseControlHooks) {
    const event = abuseEventById.get(hook.abuseEventId);
    assert.ok(event, `${hook.id} links unknown abuse event ${hook.abuseEventId}`);
    assert.equal(hook.userId, event.userId, `${hook.id} user must match linked abuse event`);
    assert.ok(auditIds.has(hook.auditRef), `${hook.id} links unknown audit ${hook.auditRef}`);
    assert.ok(hook.durationMinutes > 0, `${hook.id} needs positive duration`);
    assert.notEqual(hook.expiresAt, "pending", `${hook.id} needs explicit expiration`);
    assert.ok(hook.hookPayload.length > 70, `${hook.id} needs executable hook payload`);
    assert.ok(hook.threshold.length > 50, `${hook.id} needs a concrete trigger threshold`);
    assert.ok(hook.rollbackAction.length > 90, `${hook.id} needs rollback action`);
    assert.ok(hook.releaseCondition.length > 80, `${hook.id} needs release evidence condition`);
    assert.ok(hook.operatorRunbook.length > 80, `${hook.id} needs operator runbook`);
    assert.ok(hook.evidenceRefs.length >= 3, `${hook.id} needs at least three evidence refs`);
    assert.ok(
      ["api_gateway", "worker_scheduler", "crawler_scheduler", "export_service"].includes(hook.enforcementPoint),
      `${hook.id} needs executable enforcement point`
    );

    for (const ref of hook.evidenceRefs) {
      assert.ok(
        ref === hook.abuseEventId || auditIds.has(ref) || supportTicketIds.has(ref) || traceIds.has(ref) || exportIds.has(ref) || crawlerFindingIds.has(ref),
        `${hook.id} links unknown evidence ref ${ref}`
      );
    }

    if (hook.supportTicketId !== "pending") {
      assert.ok(supportTicketIds.has(hook.supportTicketId), `${hook.id} links unknown support ticket`);
    }

    if (roleOrder.get(hook.attemptedRole) >= roleOrder.get(hook.requiredRole)) {
      assert.equal(hook.rbacDecision, "allowed", `${hook.id} sufficient role should be allowed`);
    } else {
      assert.equal(hook.rbacDecision, "denied", `${hook.id} insufficient role must be denied`);
    }

    if (hook.action === "temporary_hold") {
      assert.match(hook.requiredRole, /admin_reviewer|admin_superadmin/, `${hook.id} temporary hold needs reviewer or superadmin`);
      assert.notEqual(hook.state, "released", `${hook.id} active temporary hold cannot be released without evidence`);
    }

    if (hook.action === "rate_limit") {
      assert.match(hook.enforcementPoint, /gateway|scheduler|service/, `${hook.id} rate limit needs enforcement point`);
      assert.notEqual(hook.state, "expired", `${hook.id} throttle cannot expire without release condition evidence`);
    }
  }

  assert.ok(
    abuseControlHooks.some((hook) => hook.rbacDecision === "denied" && hook.action === "temporary_hold"),
    "temporary hold hooks need denied RBAC evidence"
  );
});

test("support tickets link user, trace, export, quota, and audit evidence", () => {
  for (const ticket of supportTickets) {
    assert.ok(supportUserIds.has(ticket.userId), `${ticket.id} links unknown support user ${ticket.userId}`);

    if (ticket.traceId !== "none") {
      assert.ok(traceIds.has(ticket.traceId), `${ticket.id} links unknown trace ${ticket.traceId}`);
    }

    if (ticket.exportId !== "none") {
      assert.ok(exportIds.has(ticket.exportId), `${ticket.id} links unknown export ${ticket.exportId}`);
    }

    if (ticket.quotaTransactionId !== "none") {
      assert.ok(quotaUserIds.has(ticket.userId), `${ticket.id} has quota action without user quota account`);
    }

    if (ticket.auditRef !== "pending") {
      assert.ok(auditIds.has(ticket.auditRef), `${ticket.id} links unknown audit event ${ticket.auditRef}`);
    }
  }
});

test("support escalation runbooks gate customer updates and closure safety", () => {
  for (const runbook of supportEscalationRunbooks) {
    const ticket = supportTicketById.get(runbook.ticketId);
    assert.ok(ticket, `${runbook.ticketId} must link an existing support ticket`);
    assert.ok(runbook.owner.length > 0, `${runbook.ticketId} needs an escalation owner`);
    assert.ok(runbook.customerUpdateCadence.length > 20, `${runbook.ticketId} needs customer update cadence`);
    assert.ok(runbook.customerMessage.length > 20, `${runbook.ticketId} needs customer-safe message`);
    assert.ok(runbook.runbook.length > 30, `${runbook.ticketId} needs operator runbook guidance`);
    assert.ok(runbook.requiredEvidenceRefs.length > 0, `${runbook.ticketId} needs required evidence refs`);

    if (runbook.readiness === "ready") {
      assert.equal(runbook.closureBlockers.length, 0, `${runbook.ticketId} ready runbook cannot keep closure blockers`);
      assert.notEqual(ticket.auditRef, "pending", `${runbook.ticketId} ready runbook needs ticket audit ref`);
    } else {
      assert.ok(runbook.closureBlockers.length > 0, `${runbook.ticketId} blocked runbook needs closure blockers`);
    }

    if (ticket.status === "escalated") {
      assert.notEqual(runbook.escalationRole, "support_operator", `${runbook.ticketId} escalated ticket needs admin role boundary`);
    }
  }
});

test("feedback filtering and delayed feedback cannot bypass review", () => {
  const decisions = new Set(feedbackItems.map((item) => item.filterDecision));

  assert.ok(decisions.has("eligible"), "feedback filters need eligible signals");
  assert.ok(decisions.has("hold"), "feedback filters need held delayed signals");
  assert.ok(decisions.has("discard"), "feedback filters need discarded abuse signals");

  for (const item of feedbackItems) {
    assert.ok(item.weight >= 0 && item.weight <= 1, `${item.id} weight must stay between 0 and 1`);
    assert.ok(item.weightingReason.length > 30, `${item.id} needs weighting rationale`);

    if (item.delayed) {
      assert.equal(item.filterDecision, "hold", `${item.id} delayed feedback must stay on hold`);
      assert.notEqual(item.availableForLearningAt, "blocked", `${item.id} delayed feedback needs a release time`);
      assert.notEqual(item.regressionFixtureRef, "none-positive-signal", `${item.id} delayed feedback needs explicit fixture state`);
    }

    if (item.filterDecision === "discard") {
      assert.equal(item.weight, 0, `${item.id} discarded feedback cannot influence learning`);
      assert.match(item.blockedReason, /abuse|unresolved/i, `${item.id} discarded feedback needs a blocking reason`);
    }

    if (item.filterDecision === "eligible") {
      assert.ok(item.weight > 0, `${item.id} eligible feedback needs positive weight`);
      assert.notEqual(item.availableForLearningAt, "blocked", `${item.id} eligible feedback needs availability`);
    }
  }
});

test("admin bad samples convert into regression fixtures before release gates pass", () => {
  assert.ok(regressionFixtures.length > 0, "bad samples need regression fixture conversion");

  const sourceIds = new Set([
    ...feedbackItems.map((item) => item.id),
    ...supportTickets.map((ticket) => ticket.id),
    ...exportJobs.map((job) => job.id)
  ]);
  const statuses = new Set(regressionFixtures.map((fixture) => fixture.status));
  const fixturePaths = new Set(regressionFixtures.map((fixture) => fixture.fixturePath));

  assert.ok(statuses.has("converted"), "regression fixtures need converted samples");
  assert.ok(statuses.has("eval_blocking"), "regression fixtures need eval-blocking bad samples");
  assert.ok(
    regressionFixtures.some((fixture) => fixture.sourceKind === "admin_bad_sample"),
    "admin bad samples must be represented as regression fixtures"
  );
  assert.ok(
    regressionFixtures.some((fixture) => fixture.requiredGate === "skill_canary"),
    "regression fixtures must gate skill canary advancement"
  );

  for (const fixture of regressionFixtures) {
    assert.ok(sourceIds.has(fixture.sourceFeedbackId), `${fixture.id} links unknown source ${fixture.sourceFeedbackId}`);
    assert.ok(canaryMetricIds.has(fixture.linkedCanaryMetric), `${fixture.id} links unknown metric ${fixture.linkedCanaryMetric}`);
    assert.ok(auditIds.has(fixture.linkedAuditRef), `${fixture.id} links unknown audit ${fixture.linkedAuditRef}`);
    assert.match(fixture.fixturePath, /^fixtures\/stage0\/rev2\/regressions\/.+\.json$/, `${fixture.id} needs a regression fixture path`);
    assert.ok(existsSync(new URL(fixture.fixturePath, repoRoot)), `${fixture.id} fixture file is missing`);
    assert.ok(fixture.expectedAssertion.length > 90, `${fixture.id} needs concrete expected assertion`);
    assert.ok(fixture.reviewerRationale.length > 90, `${fixture.id} needs reviewer rationale`);

    if (fixture.severity === "high" || fixture.severity === "critical") {
      assert.notEqual(fixture.status, "candidate", `${fixture.id} high-risk samples cannot stay candidate only`);
      assert.notEqual(fixture.requiredGate, "production_launch", `${fixture.id} high-risk samples must block earlier gates`);
    }
  }

  for (const item of feedbackItems) {
    if (item.filterDecision === "eligible" && item.regressionFixtureRef.startsWith("fixtures/")) {
      assert.ok(
        fixturePaths.has(item.regressionFixtureRef),
        `${item.id} points at missing regression fixture inventory entry`
      );
    }
  }
});

test("analytics reports cover product funnel and operational go/no-go metrics", () => {
  const requiredReports = new Set([
    "first_prompt_to_four_candidates",
    "selection_rate",
    "iteration_rate",
    "package_add_export_completion",
    "weekly_return",
    "qa_warning_block",
    "cost_per_successful_package",
    "support_ticket_failure_rate"
  ]);

  for (const report of analyticsReports) {
    requiredReports.delete(report.name);
    assert.ok(report.sourceEvents.length > 0, `${report.id} needs source events`);
    assert.ok(report.decisionUse.length > 30, `${report.id} needs go/no-go decision use`);
    assert.ok(report.sampleSize > 0, `${report.id} needs sample size`);
  }

  assert.deepEqual([...requiredReports], [], "analytics reports are missing required Stage 0 surfaces");
  assert.ok(
    analyticsReports.some((report) => report.status === "blocked"),
    "analytics reports need at least one blocked gate signal"
  );
});

test("queue and failed task controls gate retry and cancel with audit evidence", () => {
  assert.ok(queueHealth.length > 0, "queue dashboard needs queue fixtures");
  assert.ok(failedTaskControls.length > 0, "failed task retry/cancel needs fixtures");

  for (const queue of queueHealth) {
    assert.ok(queue.retryPolicy.length > 40, `${queue.id} needs retry policy`);
    assert.ok(queue.cancelPolicy.length > 40, `${queue.id} needs cancel policy`);
    assert.match(queue.ownerRole, /support_operator|admin_operator|admin_reviewer|admin_superadmin/, `${queue.id} needs owner role`);
    assert.ok(incidentIds.has(queue.linkedIncident), `${queue.id} links unknown incident ${queue.linkedIncident}`);
    assert.ok(auditIds.has(queue.auditRef), `${queue.id} links unknown audit ${queue.auditRef}`);
  }

  const actions = new Set(failedTaskControls.map((task) => task.requestedAction));
  assert.ok(actions.has("retry"), "failed task controls need retry action");
  assert.ok(actions.has("cancel"), "failed task controls need cancel action");
  assert.ok(actions.has("hold"), "failed task controls need hold action");

  for (const task of failedTaskControls) {
    assert.ok(queueIds.has(task.queueId), `${task.id} links unknown queue ${task.queueId}`);
    assert.ok(supportTicketIds.has(task.supportTicketId), `${task.id} links unknown support ticket`);
    assert.ok(task.traceId === "none" || traceIds.has(task.traceId), `${task.id} links unknown trace`);
    assert.ok(auditIds.has(task.auditRef), `${task.id} links unknown audit ${task.auditRef}`);
    assert.ok(task.retryCount <= task.maxRetries, `${task.id} retry count exceeds max retries`);
    assert.ok(task.timeoutSeconds > 0, `${task.id} needs timeout`);
    assert.ok(task.errorCode.length > 5, `${task.id} needs machine-readable error code`);
    assert.ok(task.userMessage.length > 30, `${task.id} needs user-visible message`);
    assert.ok(task.appVersion.length > 0, `${task.id} needs app version`);
    assert.ok(task.workerVersion.length > 0, `${task.id} needs worker version`);
    assert.ok(task.schemaVersion.length > 0, `${task.id} needs schema version`);
    assert.ok(task.operatorRunbook.length > 60, `${task.id} needs operator runbook`);

    if (task.requestedAction === "retry") {
      assert.equal(task.actionEligibility, "eligible", `${task.id} retry must be eligible`);
    }

    if (task.requestedAction === "cancel") {
      assert.notEqual(task.actionEligibility, "blocked", `${task.id} cancel must remain actionable`);
    }

    if (task.requestedAction === "hold") {
      assert.equal(task.allowedRole, "admin_reviewer", `${task.id} hold needs reviewer role`);
    }
  }
});

test("high-risk audit and release operations are immutable and rollback-linked", () => {
  for (const event of auditEvents) {
    assert.equal(event.immutable, true, `${event.id} must be immutable`);
    assert.ok(event.evidenceRefs.length > 0, `${event.id} needs evidence refs`);

    if (event.risk === "high" || event.risk === "critical") {
      assert.notEqual(event.secondReviewStatus, "not_required", `${event.id} high-risk event needs second-review state`);
    }
  }

  for (const version of skillVersions) {
    assert.ok(version.rollbackTarget.length > 0, `${version.id} needs rollback target`);
    assert.ok(auditIds.has(version.rollbackAuditRef), `${version.id} links unknown rollback audit`);

    if (version.secondReviewRequired) {
      assert.match(version.secondReviewer, /required|admin/, `${version.id} needs second reviewer marker`);
    }
  }

  for (const evidence of releaseEvidence) {
    assert.ok(evidence.rollbackTarget.length > 0, `${evidence.id} needs rollback target`);
    assert.ok(auditIds.has(evidence.auditRef) || evidence.auditRef === evidence.id, `${evidence.id} links unknown audit ref`);
  }
});

test("admin RBAC evidence covers every governed override surface", () => {
  const requiredSurfaces = new Set([
    "skill_release",
    "crawler_import",
    "prompt_approval",
    "provider_routing",
    "quota_override",
    "safety_rule",
    "export_override"
  ]);

  assert.ok(adminRbacEvidence.length >= requiredSurfaces.size, "admin RBAC evidence needs every override surface");

  for (const item of adminRbacEvidence) {
    requiredSurfaces.delete(item.surface);
    assert.ok(roleOrder.has(item.requiredRole), `${item.id} has unknown required role`);
    assert.ok(roleOrder.has(item.attemptedRole), `${item.id} has unknown attempted role`);
    assert.ok(auditIds.has(item.auditRef), `${item.id} links unknown audit ${item.auditRef}`);
    assert.ok(item.evidenceRefs.length >= 3, `${item.id} needs at least three evidence refs`);
    assert.ok(item.rationale.length > 80, `${item.id} needs rationale with role and risk context`);

    if (item.decision === "allowed") {
      assert.ok(
        roleOrder.get(item.attemptedRole) >= roleOrder.get(item.requiredRole),
        `${item.id} allowed decision needs sufficient attempted role`
      );
    }

    if (roleOrder.get(item.attemptedRole) < roleOrder.get(item.requiredRole)) {
      assert.notEqual(item.decision, "allowed", `${item.id} insufficient role cannot be allowed`);
    }

    if (item.secondReviewRequired) {
      assert.notEqual(
        item.secondReviewStatus,
        "not_required",
        `${item.id} second-review-required item cannot mark second review not required`
      );
    }
  }

  assert.deepEqual([...requiredSurfaces], [], "admin RBAC evidence missing override surfaces");
  assert.ok(
    adminRbacEvidence.some((item) => item.surface === "export_override" && item.decision === "denied"),
    "blocking export override must stay denied even with reviewer role"
  );
  assert.ok(
    adminRbacEvidence.some((item) => item.surface === "safety_rule" && item.requiredRole === "admin_superadmin"),
    "safety rule overrides need superadmin evidence"
  );
});

test("blocking safety exports cannot be overridden without audit-safe eligibility", () => {
  for (const riskyExport of riskyExports) {
    assert.equal(riskyExport.auditRequired, true, `${riskyExport.id} must require audit`);
    assert.ok(riskyExport.reviewRationale.length > 20, `${riskyExport.id} needs review rationale`);

    if (riskyExport.action === "block") {
      assert.equal(riskyExport.overrideEligible, false, `${riskyExport.id} blocking safety action cannot be override eligible`);
    }

    if (riskyExport.overrideEligible) {
      assert.notEqual(riskyExport.action, "block", `${riskyExport.id} override must not bypass blocking action`);
    }
  }
});

test("crawler source approvals gate activation with RBAC, legal, robots, retention, and audit evidence", () => {
  assert.ok(crawlerSourceApprovals.length > 0, "crawler source approval needs fixtures");

  const statuses = new Set(crawlerSourceApprovals.map((approval) => approval.status));
  assert.ok(statuses.has("approved"), "source approvals need an approved source");
  assert.ok(statuses.has("pending"), "source approvals need a pending source");
  assert.ok(statuses.has("blocked"), "source approvals need a blocked source");

  for (const approval of crawlerSourceApprovals) {
    const finding = crawlerFindingById.get(approval.linkedFindingId);
    assert.ok(finding, `${approval.id} links unknown crawler finding ${approval.linkedFindingId}`);
    assert.equal(approval.sourceId, finding.provenance, `${approval.id} source id must match finding provenance`);
    assert.ok(roleOrder.has(approval.requiredRole), `${approval.id} has unknown required role`);
    assert.ok(roleOrder.has(approval.attemptedRole), `${approval.id} has unknown attempted role`);
    assert.ok(auditIds.has(approval.auditRef), `${approval.id} links unknown audit ${approval.auditRef}`);
    assert.ok(approval.requiredEvidenceRefs.length >= 3, `${approval.id} needs at least three evidence refs`);
    assert.ok(approval.robotsEvidence.length > 70, `${approval.id} needs robots evidence`);
    assert.ok(approval.allowedContent.length > 50, `${approval.id} needs allowed content policy`);
    assert.ok(approval.derivativeUsePolicy.length > 70, `${approval.id} needs derivative-use policy`);
    assert.ok(approval.exactTextPolicy.length > 70, `${approval.id} needs exact-text policy`);
    assert.ok(approval.rateLimitPolicy.length > 50, `${approval.id} needs source rate-limit policy`);
    assert.ok(approval.rawRetentionDays >= 0 && approval.rawRetentionDays <= 30, `${approval.id} raw retention must be bounded`);
    assert.ok(approval.reviewerRationale.length > 90, `${approval.id} needs reviewer rationale`);

    for (const ref of approval.requiredEvidenceRefs) {
      assert.ok(
        ref === approval.linkedFindingId || auditIds.has(ref) || ref.startsWith("cg-") || ref.startsWith("ip-"),
        `${approval.id} links unknown source approval evidence ref ${ref}`
      );
    }

    if (roleOrder.get(approval.attemptedRole) < roleOrder.get(approval.requiredRole)) {
      assert.notEqual(approval.rbacDecision, "allowed", `${approval.id} insufficient role cannot approve source`);
    }

    if (approval.status === "approved") {
      assert.equal(approval.rbacDecision, "allowed", `${approval.id} approved source needs allowed RBAC`);
      assert.equal(approval.legalMetadataStatus, "complete", `${approval.id} approved source needs legal metadata`);
      assert.equal(approval.activationGate, "allowed", `${approval.id} approved source should allow activation`);
      assert.ok(approval.rawRetentionDays > 0, `${approval.id} approved source needs retention window`);
    } else {
      assert.notEqual(approval.activationGate, "allowed", `${approval.id} unresolved source cannot activate`);
    }

    if (approval.status === "blocked") {
      assert.equal(approval.rawRetentionDays, 0, `${approval.id} blocked source should not retain raw content`);
      assert.match(approval.exactTextPolicy, /blocked|forbidden/i, `${approval.id} blocked source needs exact-text block`);
    }
  }
});

test("crawler takedown and derivative review workflow blocks unsafe activation", () => {
  assert.ok(crawlerGovernanceWorkflows.length > 0, "crawler governance needs takedown and derivative workflow fixtures");

  const requestTypes = new Set(crawlerGovernanceWorkflows.map((workflow) => workflow.requestType));
  assert.ok(requestTypes.has("source_takedown"), "crawler governance needs source takedown workflow");
  assert.ok(requestTypes.has("derivative_review"), "crawler governance needs derivative review workflow");
  assert.ok(requestTypes.has("raw_retention_delete"), "crawler governance needs raw retention delete workflow");

  for (const workflow of crawlerGovernanceWorkflows) {
    assert.ok(crawlerFindingIds.has(workflow.findingId), `${workflow.id} links unknown crawler finding`);
    assert.ok(workflow.sourceContact.length > 30, `${workflow.id} needs takedown contact process`);
    assert.ok(workflow.requiredEvidenceRefs.length >= 3, `${workflow.id} needs evidence refs`);
    assert.ok(workflow.reviewRationale.length > 60, `${workflow.id} needs reviewer rationale`);
    assert.ok(auditIds.has(workflow.auditRef), `${workflow.id} links unknown audit ${workflow.auditRef}`);
    assert.match(workflow.reviewerRole, /admin_operator|admin_reviewer|admin_superadmin/, `${workflow.id} needs admin reviewer role`);

    if (workflow.requestType === "source_takedown") {
      assert.equal(workflow.blockedActivation, true, `${workflow.id} takedown must block activation`);
      assert.equal(workflow.rawRetentionAction, "delete_raw_and_derivatives", `${workflow.id} takedown must delete raw and derivative material`);
      assert.equal(workflow.derivativeUseStatus, "blocked", `${workflow.id} takedown must block derivative use`);
    }

    if (workflow.requestType === "derivative_review" && workflow.derivativeUseStatus === "allowed") {
      assert.equal(workflow.blockedActivation, false, `${workflow.id} allowed derivative review should permit activation`);
      assert.equal(workflow.rawRetentionAction, "retain_with_limit", `${workflow.id} allowed derivative review still needs retention limit`);
    }

    if (workflow.derivativeUseStatus === "unknown" || workflow.derivativeUseStatus === "restricted") {
      assert.equal(workflow.blockedActivation, true, `${workflow.id} unresolved derivative status must block activation`);
    }
  }
});
