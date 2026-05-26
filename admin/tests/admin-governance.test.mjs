import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");
const abuseRuntimeSource = readFileSync(new URL("../lib/abuse-runtime.ts", import.meta.url), "utf8");
const rbacRuntimeSource = readFileSync(new URL("../lib/rbac-runtime.ts", import.meta.url), "utf8");
const repoRoot = new URL("../../", import.meta.url);
const blueprint = readFileSync(new URL("../../Docs/stage0_blueprint_rev2.md", import.meta.url), "utf8");

const parseFixtures = () => {
  const moduleSource = source
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/export const (\w+)[^=]*=/g, "const $1 =");
  return Function(`${moduleSource}\nreturn { skillVersions, skillReleaseStateDefinitions, skillCanaryMetrics, releaseEvidence, releaseBlockers, supportTickets, supportEscalationRunbooks, supportUsers, riskyExports, abuseEvents, abuseControlHooks, stagingAuthRbacTenantAuditEvidence, stagingSupportRetryAbuseEvidence, productionAbuseThrottleHoldEvidence, productionActivationReviewAuditEvidence, auditEvents, exportJobs, traces, quotaAccounts, feedbackItems, regressionFixtures, analyticsReports, queueHealth, failedTaskControls, crawlerFindings, crawlerSourceApprovals, crawlerGovernanceWorkflows, crawlerStagingRuntimeEvidence, adminRbacEvidence, operationalDashboards, operationalDashboardRuntimeEvidence, alertRoutes, alertRouteRuntimeEvidence, backendMetricsRuntimeEvidence };`)();
};

const crawlerGovernanceCases = JSON.parse(
  readFileSync(new URL("../../fixtures/stage0/rev2/crawler/crawler_governance_cases.json", import.meta.url), "utf8")
);

const {
  skillVersions,
  skillReleaseStateDefinitions,
  skillCanaryMetrics,
  releaseEvidence,
  releaseBlockers,
  supportTickets,
  supportEscalationRunbooks,
  supportUsers,
  riskyExports,
  abuseEvents,
  abuseControlHooks,
  stagingAuthRbacTenantAuditEvidence,
  stagingSupportRetryAbuseEvidence,
  productionAbuseThrottleHoldEvidence,
  productionActivationReviewAuditEvidence,
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
  crawlerStagingRuntimeEvidence,
  adminRbacEvidence,
  operationalDashboards,
  operationalDashboardRuntimeEvidence,
  alertRoutes,
  alertRouteRuntimeEvidence,
  backendMetricsRuntimeEvidence
} = parseFixtures();

const parseAbuseRuntime = () => {
  const runtimeSource = abuseRuntimeSource
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/export function (\w+)/g, "function $1")
    .replaceAll(/: Record<AdminRole, number>/g, "")
    .replaceAll(/: AbuseRuntimeDecision\["queueAction"\]/g, "")
    .replaceAll(/: AbuseRuntimeDecision\[\]/g, "")
    .replaceAll(/: AbuseQueueRuntimeEntry\[\]/g, "")
    .replaceAll(/: AbuseEvent\[\]/g, "")
    .replaceAll(/: AbuseControlHook\[\]/g, "")
    .replaceAll(/: AdminRole/g, "")
    .replaceAll(/: AbuseEvent/g, "")
    .replaceAll(/: AbuseControlHook/g, "")
    .replaceAll(/: string/g, "")
    .replaceAll(/: Date/g, "")
    .replaceAll(/ as const/g, "");
  return Function(`${runtimeSource}\nreturn { buildAbuseRuntimeDecisions, buildAbuseQueueRuntime };`)();
};

const parseRbacRuntime = () => {
  const runtimeSource = rbacRuntimeSource
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/const roleRank: Record<AdminRole, number> =/g, "const roleRank =")
    .replaceAll(/export function (\w+)/g, "function $1")
    .replaceAll(/: AdminRbacEvidence\[\]/g, "")
    .replaceAll(/: AdminRbacRuntimeDecision\[\]/g, "")
    .replaceAll(/: AdminRbacEvidence/g, "")
    .replaceAll(/: string/g, "")
    .replaceAll(/: Date/g, "")
    .replaceAll(/: boolean/g, "");
  return Function(`${runtimeSource}\nreturn { buildAdminRbacRuntimeDecisions };`)();
};

const auditIds = new Set(auditEvents.map((event) => event.id));
const supportTicketIds = new Set(supportTickets.map((ticket) => ticket.id));
const supportTicketById = new Map(supportTickets.map((ticket) => [ticket.id, ticket]));
const supportUserIds = new Set(supportUsers.map((user) => user.id));
const traceIds = new Set(traces.map((trace) => trace.id));
const exportIds = new Set(exportJobs.map((job) => job.id));
const quotaUserIds = new Set(quotaAccounts.map((account) => account.userId));
const queueIds = new Set(queueHealth.map((queue) => queue.id));
const taskIds = new Set(failedTaskControls.map((task) => task.id));
const crawlerFindingIds = new Set(crawlerFindings.map((finding) => finding.id));
const crawlerFindingById = new Map(crawlerFindings.map((finding) => [finding.id, finding]));
const crawlerGovernanceCaseById = new Map(crawlerGovernanceCases.map((entry) => [entry.fixture_id, entry]));
const incidentIds = new Set(["none", "inc-20260526-queue", "inc-20260525-crawler"]);
const operationalDashboardIds = new Set(operationalDashboards.map((dashboard) => dashboard.id));
const alertRouteIds = new Set(alertRoutes.map((alert) => alert.id));
const releaseEvidenceIds = new Set(releaseEvidence.map((evidence) => evidence.id));
const abuseEventById = new Map(abuseEvents.map((event) => [event.id, event]));
const abuseHookIds = new Set(abuseControlHooks.map((hook) => hook.id));
const canaryMetricIds = new Set(skillCanaryMetrics.map((metric) => metric.id));
const runtimeEvidencePattern = /^staging-(dashboard|alert)-[a-z-]+-\d{8}T\d{4}Z$/;
const overrideScopeBySurface = new Map([
  ["skill_release", "release"],
  ["crawler_import", "crawler"],
  ["prompt_approval", "prompt"],
  ["provider_routing", "provider"],
  ["quota_override", "quota"],
  ["safety_rule", "safety"],
  ["export_override", "export"]
]);
const stagingAuthRbacTenantAuditPath = new URL(
  "../../ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
  import.meta.url
);
const stagingSupportRetryAbusePath = new URL(
  "../../ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
  import.meta.url
);
const stagingDashboardRuntimePath = new URL(
  "../../ops/evidence/staging/20260526T1000Z-dashboard-runtime.json",
  import.meta.url
);
const stagingAlertRuntimePath = new URL(
  "../../ops/evidence/staging/20260526T1000Z-alert-runtime.json",
  import.meta.url
);
const stagingMetricsRuntimePath = new URL(
  "../../ops/evidence/staging/20260527T1215Z-backend-worker-crawler-metrics.json",
  import.meta.url
);
const crawlerStagingRuntimePath = new URL(
  "../../ops/evidence/staging/20260527T1100Z-crawler-governance-runtime.json",
  import.meta.url
);
const privateBetaGatePath = new URL(
  "../../fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
  import.meta.url
);
const productionGatePath = new URL(
  "../../fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
  import.meta.url
);
const productionAbuseThrottleHoldPath = new URL(
  "../../ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
  import.meta.url
);
const productionActivationReviewAuditPath = new URL(
  "../../ops/evidence/production/20260527T1430Z-activation-review-audit.json",
  import.meta.url
);

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
    assert.match(hook.executionMode, /dry_run|enforced/, `${hook.id} needs hook execution mode`);
    assert.ok(hook.lastDryRunEvidence.length > 90, `${hook.id} needs dry-run execution evidence`);
    assert.ok(hook.threshold.length > 50, `${hook.id} needs a concrete trigger threshold`);
    assert.ok(hook.telemetrySignal.length > 80, `${hook.id} needs concrete telemetry signal`);
    assert.ok(hook.userVisibleState.length > 70, `${hook.id} needs user-visible hold/throttle state`);
    assert.ok(hook.rollbackAction.length > 90, `${hook.id} needs rollback action`);
    assert.ok(hook.releaseCondition.length > 80, `${hook.id} needs release evidence condition`);
    assert.ok(hook.releaseEvidenceRefs.length >= 3, `${hook.id} needs release evidence refs`);
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

    for (const ref of hook.releaseEvidenceRefs) {
      assert.ok(
        ref === hook.abuseEventId || auditIds.has(ref) || supportTicketIds.has(ref) || traceIds.has(ref) || exportIds.has(ref) || crawlerFindingIds.has(ref),
        `${hook.id} links unknown release evidence ref ${ref}`
      );
    }

    assert.ok(
      hook.releaseEvidenceRefs.some((ref) => supportTicketIds.has(ref) || auditIds.has(ref)),
      `${hook.id} release condition needs support or audit evidence`
    );

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

    if (hook.rbacDecision === "denied") {
      assert.equal(hook.executionMode, "dry_run", `${hook.id} denied hook can only be dry-run evidence`);
    }

    if (hook.action === "rate_limit") {
      assert.match(hook.enforcementPoint, /gateway|scheduler|service/, `${hook.id} rate limit needs enforcement point`);
      assert.notEqual(hook.state, "expired", `${hook.id} throttle cannot expire without release condition evidence`);
      assert.equal(hook.executionMode, "enforced", `${hook.id} allowed throttle hooks must be enforceable`);
    }
  }

  assert.ok(
    abuseControlHooks.some((hook) => hook.rbacDecision === "denied" && hook.action === "temporary_hold"),
    "temporary hold hooks need denied RBAC evidence"
  );
});

test("temporary hold and throttle runtime enforcement blocks quota-consuming work and preserves audit evidence", () => {
  const { buildAbuseRuntimeDecisions } = parseAbuseRuntime();
  const decisions = buildAbuseRuntimeDecisions(abuseEvents, abuseControlHooks, new Date("2026-05-26T11:00:00Z"));

  assert.equal(decisions.length, abuseControlHooks.length, "every hook needs a runtime decision");
  assert.ok(
    decisions.some(
      (decision) =>
        decision.runtimeStatus === "enforced" &&
        decision.requestOutcome === "deny_423_account_hold" &&
        decision.canCreateQuotaConsumingTask === false
    ),
    "temporary holds must deny quota-consuming account work"
  );
  assert.ok(
    decisions.some(
      (decision) =>
        decision.runtimeStatus === "enforced" &&
        decision.requestOutcome === "throttle_429_rate_limited" &&
        decision.queueAction === "throttle_until_review"
    ),
    "throttle hooks must enforce a rate-limited runtime outcome"
  );
  assert.ok(
    decisions.some(
      (decision) =>
        decision.runtimeStatus === "dry_run_denied" &&
        decision.requestOutcome === "dry_run_only" &&
        decision.queueAction === "escalate_security_review"
    ),
    "denied critical holds must stay dry-run and escalate security review"
  );

  for (const decision of decisions) {
    assert.ok(auditIds.has(decision.auditRef), `${decision.hookId} runtime decision links unknown audit`);
    assert.ok(decision.evidenceRefs.length >= 3, `${decision.hookId} runtime decision needs evidence refs`);
    assert.ok(decision.rationale.length > 120, `${decision.hookId} runtime decision needs rationale and release condition`);

    if (decision.runtimeStatus === "enforced") {
      assert.equal(
        decision.canCreateQuotaConsumingTask,
        false,
        `${decision.hookId} enforced abuse control must block quota-consuming task creation`
      );
      assert.match(
        decision.requestOutcome,
        /deny_423_account_hold|throttle_429_rate_limited/,
        `${decision.hookId} enforced abuse control needs concrete request outcome`
      );
    }
  }
});

test("admin abuse queue runtime enforcement keeps events open until controls and release evidence pass", () => {
  const { buildAbuseRuntimeDecisions, buildAbuseQueueRuntime } = parseAbuseRuntime();
  const decisions = buildAbuseRuntimeDecisions(abuseEvents, abuseControlHooks, new Date("2026-05-26T11:00:00Z"));
  const queueRuntime = buildAbuseQueueRuntime(abuseEvents, decisions);

  assert.equal(queueRuntime.length, abuseEvents.length, "every abuse event needs queue runtime enforcement");
  assert.ok(queueRuntime.some((entry) => entry.runtimeStatus === "controlled"), "queue needs controlled entries");
  assert.ok(queueRuntime.some((entry) => entry.runtimeStatus === "blocked_by_rbac"), "queue needs RBAC-blocked entries");

  for (const entry of queueRuntime) {
    const event = abuseEventById.get(entry.abuseEventId);
    assert.ok(event, `${entry.abuseEventId} queue runtime links unknown abuse event`);
    assert.equal(entry.userId, event.userId, `${entry.abuseEventId} queue user must match event`);
    assert.ok(auditIds.has(entry.auditRef), `${entry.abuseEventId} queue runtime links unknown audit`);
    assert.equal(entry.closureAllowed, false, `${entry.abuseEventId} cannot close without release evidence`);
    assert.ok(entry.blockingReason.length > 90, `${entry.abuseEventId} needs blocking reason`);
    assert.ok(entry.nextAction.length > 90, `${entry.abuseEventId} needs next action`);

    if (entry.runtimeStatus === "controlled") {
      assert.ok(entry.activeHookIds.length > 0, `${entry.abuseEventId} controlled queue entry needs active hooks`);
    }

    if (event.severity === "critical") {
      assert.equal(entry.runtimeStatus, "blocked_by_rbac", `${entry.abuseEventId} critical abuse needs RBAC/security block`);
      assert.equal(entry.closureAllowed, false, `${entry.abuseEventId} critical abuse cannot auto-close`);
    }
  }
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

test("admin user lookup resolves user evidence without bypassing RBAC or redaction", () => {
  assert.ok(supportUsers.length >= 3, "admin user lookup needs representative support users");

  for (const user of supportUsers) {
    assert.ok(user.tenantId.length > 4, `${user.id} needs tenant isolation evidence`);
    assert.ok(user.lookupKeys.includes(user.id), `${user.id} lookup keys must include user id`);
    assert.ok(user.lookupKeys.includes(user.email), `${user.id} lookup keys must include email`);
    assert.ok(user.lookupKeys.includes(user.tenantId), `${user.id} lookup keys must include tenant id`);
    assert.ok(user.privacyRedaction.length > 60, `${user.id} needs privacy redaction policy`);
    assert.ok(user.auditRefs.length > 0, `${user.id} needs lookup audit refs`);
    assert.ok(user.lookupActions.length > 0, `${user.id} needs action governance`);

    for (const auditRef of user.auditRefs) {
      assert.ok(auditIds.has(auditRef), `${user.id} links unknown audit ref ${auditRef}`);
    }

    for (const ticketId of user.ticketIds) {
      const ticket = supportTicketById.get(ticketId);
      assert.ok(ticket, `${user.id} links unknown ticket ${ticketId}`);
      assert.equal(ticket.userId, user.id, `${ticketId} must belong to lookup user ${user.id}`);
      assert.ok(user.lookupKeys.includes(ticketId), `${user.id} lookup keys must include ticket ${ticketId}`);
    }

    for (const taskId of user.taskIds) {
      assert.ok(taskIds.has(taskId), `${user.id} links unknown task ${taskId}`);
      assert.ok(user.lookupKeys.includes(taskId) || supportTickets.some((ticket) => ticket.taskId === taskId && user.lookupKeys.includes(ticket.id)), `${user.id} must expose task ${taskId} directly or through ticket lookup`);
    }

    for (const traceId of user.traces) {
      assert.ok(traceIds.has(traceId), `${user.id} links unknown trace ${traceId}`);
      assert.ok(user.lookupKeys.includes(traceId), `${user.id} lookup keys must include trace ${traceId}`);
    }

    for (const exportId of user.exportIds) {
      assert.ok(exportIds.has(exportId), `${user.id} links unknown export ${exportId}`);
      assert.ok(user.lookupKeys.includes(exportId), `${user.id} lookup keys must include export ${exportId}`);
    }

    if (user.quotaAccountRef !== "none") {
      assert.ok(quotaUserIds.has(user.quotaAccountRef), `${user.id} links unknown quota account ${user.quotaAccountRef}`);
    }

    for (const action of user.lookupActions) {
      assert.ok(action.rationale.length > 50, `${user.id} ${action.scope} needs action rationale`);
      assert.ok(auditIds.has(action.auditRef), `${user.id} ${action.scope} links unknown audit ${action.auditRef}`);
      assert.ok(action.evidenceRefs.length >= 3, `${user.id} ${action.scope} needs at least three evidence refs`);

      for (const ref of action.evidenceRefs) {
        assert.ok(
          ref === user.id ||
            ref === user.quotaAccountRef ||
            supportTicketIds.has(ref) ||
            traceIds.has(ref) ||
            exportIds.has(ref) ||
            taskIds.has(ref) ||
            queueIds.has(ref) ||
            auditIds.has(ref) ||
            abuseEventById.has(ref) ||
            ref.startsWith("qt-") ||
            ref.startsWith("rx-") ||
            crawlerFindingIds.has(ref),
          `${user.id} ${action.scope} links unknown evidence ref ${ref}`
        );
      }

      if (action.scope !== "read_profile") {
        assert.match(
          action.requiredRole,
          /support_operator|admin_operator|admin_reviewer|admin_superadmin/,
          `${user.id} ${action.scope} needs explicit mutation role boundary`
        );
        assert.ok(
          action.evidenceRefs.some((ref) => supportTicketIds.has(ref)) && action.evidenceRefs.includes(action.auditRef),
          `${user.id} ${action.scope} needs support ticket and audit evidence`
        );
      }

      if (action.decision === "allowed") {
        assert.match(action.requiredRole, /support_operator|admin_operator|admin_reviewer|admin_superadmin/, `${user.id} allowed action needs role boundary`);
      }

      if (action.decision === "blocked") {
        assert.match(action.rationale, /blocked|cannot|until/i, `${user.id} blocked action needs blocking rationale`);
      }
    }
  }

  assert.ok(
    supportUsers.some((user) => user.lookupActions.some((action) => action.scope === "quota_credit" && action.decision === "allowed")),
    "lookup needs audited quota credit eligibility"
  );
  assert.ok(
    supportUsers.some((user) => user.lookupActions.some((action) => action.scope === "retry_failed_task" && action.decision === "blocked")),
    "lookup needs blocked retry evidence"
  );
  assert.ok(
    supportUsers.some((user) => user.lookupActions.some((action) => action.scope === "temporary_hold" && action.decision === "requires_review")),
    "lookup needs temporary hold review evidence"
  );
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
    assert.ok(queue.idempotencyScope.length > 80, `${queue.id} needs idempotency scope`);
    assert.ok(queue.retryBackoffPolicy.length > 70, `${queue.id} needs retry backoff policy`);
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
    assert.ok(roleOrder.has(task.requestedByRole), `${task.id} needs requesting role`);
    assert.ok(task.idempotencyKey.startsWith(`${task.requestedAction}:${task.id}:`), `${task.id} needs stable action/task idempotency key`);
    assert.ok(task.closureEvidenceRefs.length >= 4, `${task.id} needs closure evidence refs`);
    assert.ok(task.operatorRunbook.length > 60, `${task.id} needs operator runbook`);

    for (const ref of task.closureEvidenceRefs) {
      assert.ok(
        ref === task.id ||
          supportTicketIds.has(ref) ||
          traceIds.has(ref) ||
          exportIds.has(ref) ||
          queueIds.has(ref) ||
          auditIds.has(ref) ||
          abuseEventById.has(ref),
        `${task.id} links unknown closure evidence ref ${ref}`
      );
    }

    if (roleOrder.get(task.requestedByRole) >= roleOrder.get(task.allowedRole) && task.actionEligibility === "eligible") {
      assert.equal(task.rbacDecision, "allowed", `${task.id} eligible sufficient role should be allowed`);
    }

    if (roleOrder.get(task.requestedByRole) < roleOrder.get(task.allowedRole)) {
      assert.notEqual(task.rbacDecision, "allowed", `${task.id} insufficient role cannot act`);
    }

    if (task.requestedAction === "retry") {
      assert.equal(task.actionEligibility, "eligible", `${task.id} retry must be eligible`);
      assert.notEqual(task.quotaEffect, "none", `${task.id} retry needs explicit quota handling`);
    }

    if (task.requestedAction === "cancel") {
      assert.notEqual(task.actionEligibility, "blocked", `${task.id} cancel must remain actionable`);
      assert.match(task.rbacDecision, /allowed|second_review_required/, `${task.id} cancel needs RBAC path`);
    }

    if (task.requestedAction === "hold") {
      assert.equal(task.allowedRole, "admin_reviewer", `${task.id} hold needs reviewer role`);
      assert.notEqual(task.rbacDecision, "allowed", `${task.id} blocked hold cannot be allowed`);
    }
  }
});

test("staging support retry abuse evidence validates external-user support, retry, hold, and audit paths", () => {
  assert.ok(existsSync(stagingSupportRetryAbusePath), "staging support/retry/abuse evidence file is missing");
  const evidenceFile = JSON.parse(readFileSync(stagingSupportRetryAbusePath, "utf8"));

  assert.equal(stagingSupportRetryAbuseEvidence.id, evidenceFile.evidence_id, "admin fixture must match evidence id");
  assert.equal(stagingSupportRetryAbuseEvidence.environment, "staging", "evidence must be staging scoped");
  assert.equal(stagingSupportRetryAbuseEvidence.status, "pass", "check-level evidence must pass");
  assert.equal(evidenceFile.environment, "staging", "evidence file must be staging scoped");
  assert.equal(evidenceFile.status, "pass", "evidence file must pass");
  assert.equal(
    stagingSupportRetryAbuseEvidence.evidencePath,
    "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
    "evidence path must cite gate-specific staging evidence"
  );
  assert.equal(
    stagingSupportRetryAbuseEvidence.releaseGateCheckId,
    "staging_support_retry_abuse_ops",
    "evidence must bind the support/retry/abuse release-gate check"
  );
  assert.equal(
    stagingSupportRetryAbuseEvidence.doNotLaunchConditionId,
    "support_abuse_runtime_missing",
    "evidence must bind the support abuse do-not-launch condition"
  );
  assert.equal(
    stagingSupportRetryAbuseEvidence.gateImpact.canClearCheckLevelItem,
    true,
    "validated evidence should clear only the check-level support/retry/abuse checklist item"
  );
  assert.equal(
    stagingSupportRetryAbuseEvidence.gateImpact.aggregatePrivateBetaGateStatus,
    "blocked_by_other_staging_runtime_items",
    "support/retry/abuse evidence must not close the aggregate private beta gate"
  );

  for (const requestId of stagingSupportRetryAbuseEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^staging-support-retry-abuse-\d{8}T\d{4}Z-/,
      `${requestId} must be a staging support/retry/abuse runtime probe`
    );
  }

  for (const ticketId of stagingSupportRetryAbuseEvidence.supportTicketIds) {
    assert.ok(supportTicketIds.has(ticketId), `${ticketId} must link an admin support ticket`);
  }

  for (const taskId of stagingSupportRetryAbuseEvidence.failedTaskIds) {
    assert.ok(taskIds.has(taskId), `${taskId} must link a failed task control`);
  }

  for (const eventId of stagingSupportRetryAbuseEvidence.abuseEventIds) {
    assert.ok(abuseEventById.has(eventId), `${eventId} must link an abuse event`);
  }

  for (const hookId of stagingSupportRetryAbuseEvidence.abuseHookIds) {
    assert.ok(abuseHookIds.has(hookId), `${hookId} must link an abuse hold/throttle hook`);
  }

  const requiredAreas = new Set([
    "support_ticket_linkage",
    "failed_task_retry_cancel",
    "abuse_hold_throttle",
    "abuse_queue_closure"
  ]);
  for (const area of evidenceFile.coverage.map((item) => item.area)) {
    assert.ok(requiredAreas.has(area), `${area} is not an expected evidence area`);
  }

  for (const coverage of stagingSupportRetryAbuseEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("staging"), `${coverage.area} must describe staging runtime`);
    assert.match(coverage.runtimeProbe, /support|retry|hold|throttle|abuse|queue/i, `${coverage.area} must cover admin operations`);
    assert.ok(coverage.externalUserEvidence.length > 90, `${coverage.area} needs external-user evidence`);
    assert.ok(coverage.rbacAuditEvidence.length > 90, `${coverage.area} needs RBAC and audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes("ops/evidence/staging/20260527T1000Z-support-retry-abuse.json"),
      `${coverage.area} must cite the staging evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          supportTicketIds.has(ref) ||
          taskIds.has(ref) ||
          abuseEventById.has(ref) ||
          abuseHookIds.has(ref) ||
          auditIds.has(ref) ||
          queueIds.has(ref)
      ),
      `${coverage.area} needs validator-resolvable admin evidence refs`
    );
  }

  assert.deepEqual([...requiredAreas], [], "staging support/retry/abuse evidence is missing coverage areas");
  assert.deepEqual(
    evidenceFile.runtime_request_ids,
    stagingSupportRetryAbuseEvidence.runtimeRequestIds,
    "evidence file and admin fixture runtime probe ids must match"
  );
});

test("private beta gate consumes staging support retry abuse evidence without closing aggregate gate", () => {
  assert.ok(existsSync(privateBetaGatePath), "private beta gate evidence fixture is missing");
  const gateFixture = JSON.parse(readFileSync(privateBetaGatePath, "utf8"));
  const supportEvidenceFile = JSON.parse(readFileSync(stagingSupportRetryAbusePath, "utf8"));

  assert.equal(gateFixture.gate, "private_beta_staging", "gate fixture must remain private beta scoped");

  const supportCheck = gateFixture.checks.find((check) => check.check_id === "staging_support_retry_abuse_ops");
  assert.ok(supportCheck, "private beta gate needs support/retry/abuse check");
  assert.equal(supportCheck.status, "pass", "validated support/retry/abuse evidence should clear only its check");
  assert.ok(
    supportCheck.evidence_ref.includes(stagingSupportRetryAbuseEvidence.evidencePath),
    "support/retry/abuse gate check must cite the staging runtime evidence path"
  );
  assert.equal(
    supportEvidenceFile.gate_impact.aggregate_private_beta_gate_status,
    "blocked_by_other_staging_runtime_items",
    "support/retry/abuse evidence cannot close the aggregate private beta gate"
  );

  const supportDoNotLaunch = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === stagingSupportRetryAbuseEvidence.doNotLaunchConditionId
  );
  assert.ok(supportDoNotLaunch, "private beta do-not-launch fixture needs support/abuse condition");
  assert.equal(
    supportDoNotLaunch.is_present,
    false,
    "validated support/retry/abuse runtime evidence should clear the matching do-not-launch condition"
  );
  assert.ok(
    supportDoNotLaunch.evidence_ref.includes(stagingSupportRetryAbuseEvidence.evidencePath),
    "cleared support/abuse do-not-launch condition must cite the staging runtime evidence path"
  );

  for (const blocker of stagingSupportRetryAbuseEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the private beta gate fixture`);
    assert.equal(check.status, "blocked", `${blocker} must stay blocked after support/retry/abuse clears`);
  }

  assert.ok(
    gateFixture.checks.some((check) => check.status === "blocked"),
    "aggregate private beta gate must remain blocked by other staging runtime items"
  );
});

test("staging auth rbac tenant audit evidence clears only its private beta check", () => {
  assert.ok(existsSync(stagingAuthRbacTenantAuditPath), "staging auth/RBAC/tenant/audit evidence file is missing");
  assert.ok(existsSync(privateBetaGatePath), "private beta gate evidence fixture is missing");

  const evidenceFile = JSON.parse(readFileSync(stagingAuthRbacTenantAuditPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(privateBetaGatePath, "utf8"));

  assert.equal(evidenceFile.environment, "staging", "auth/RBAC/tenant/audit evidence must be staging scoped");
  assert.equal(evidenceFile.status, "pass", "auth/RBAC/tenant/audit evidence must pass");
  assert.equal(
    evidenceFile.release_gate_check_id,
    "staging_auth_rbac_tenant_audit",
    "auth/RBAC/tenant/audit evidence must target the matching release gate check"
  );
  assert.equal(
    evidenceFile.do_not_launch_condition_id,
    "tenant_isolation_not_enforced",
    "auth/RBAC/tenant/audit evidence must target the tenant isolation condition"
  );
  assert.deepEqual(
    evidenceFile.runtime_request_ids,
    stagingAuthRbacTenantAuditEvidence.runtimeRequestIds,
    "evidence file and admin fixture runtime request ids must match"
  );
  assert.deepEqual(
    evidenceFile.admin_rbac_evidence_ids,
    stagingAuthRbacTenantAuditEvidence.adminRbacEvidenceIds,
    "evidence file and admin fixture RBAC ids must match"
  );
  assert.deepEqual(
    [...new Set(evidenceFile.admin_rbac_evidence_ids)].sort(),
    evidenceFile.admin_rbac_evidence_ids.toSorted(),
    "staging auth/RBAC evidence file cannot cite duplicate RBAC rows"
  );
  assert.deepEqual(
    [...new Set(stagingAuthRbacTenantAuditEvidence.adminRbacEvidenceIds)].sort(),
    stagingAuthRbacTenantAuditEvidence.adminRbacEvidenceIds.toSorted(),
    "admin auth/RBAC fixture cannot cite duplicate RBAC rows"
  );
  assert.equal(
    evidenceFile.gate_impact.aggregate_private_beta_gate_status,
    "blocked_by_other_staging_runtime_items",
    "auth/RBAC/tenant/audit evidence cannot close the aggregate private beta gate"
  );

  const requiredAreas = new Set([
    "admin_session_boundary",
    "tenant_isolation_denial",
    "admin_rbac_runtime",
    "immutable_audit_linkage"
  ]);
  const rbacIds = new Set(adminRbacEvidence.map((item) => item.id));
  const fileCoverageByArea = new Map(evidenceFile.coverage.map((coverage) => [coverage.area, coverage]));

  for (const coverage of stagingAuthRbacTenantAuditEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    const fileCoverage = fileCoverageByArea.get(coverage.area);
    assert.ok(fileCoverage, `${coverage.area} missing from evidence file`);
    assert.equal(coverage.status, "pass", `${coverage.area} admin fixture coverage must pass`);
    assert.equal(fileCoverage.status, coverage.status, `${coverage.area} file and fixture status mismatch`);
    assert.ok(coverage.runtimeProbe.length > 100, `${coverage.area} needs runtime probe detail`);
    assert.ok(coverage.externalUserEvidence.length > 90, `${coverage.area} needs external-user evidence`);
    assert.ok(coverage.rbacAuditEvidence.length > 90, `${coverage.area} needs RBAC and audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes(stagingAuthRbacTenantAuditEvidence.evidencePath),
      `${coverage.area} must cite the staging evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          rbacIds.has(ref) ||
          supportTicketIds.has(ref) ||
          traceIds.has(ref) ||
          exportIds.has(ref)
      ),
      `${coverage.area} needs validator-resolvable admin evidence refs`
    );
  }

  assert.deepEqual([...requiredAreas], [], "staging auth/RBAC/tenant/audit evidence is missing coverage areas");

  for (const id of stagingAuthRbacTenantAuditEvidence.adminRbacEvidenceIds) {
    const rbac = adminRbacEvidence.find((item) => item.id === id);
    assert.ok(rbac, `${id} must link to admin RBAC evidence`);
    assert.match(
      rbac.apiScope,
      /^(GET|POST|PATCH|DELETE) \/api\/admin\//,
      `${id} staging auth/RBAC evidence must stay scoped to admin APIs`
    );
    assert.ok(auditIds.has(rbac.auditRef), `${id} must link immutable audit evidence`);
    assert.ok(
      rbac.runtimeCheck.includes(rbac.enforcementPoint),
      `${id} runtime check must identify the governed enforcement point`
    );
  }
  for (const auditRef of stagingAuthRbacTenantAuditEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link to immutable audit evidence`);
  }

  const gateCheck = gateFixture.checks.find((check) => check.check_id === "staging_auth_rbac_tenant_audit");
  assert.ok(gateCheck, "private beta gate needs auth/RBAC/tenant/audit check");
  assert.equal(gateCheck.status, "pass", "validated auth/RBAC/tenant/audit evidence should clear only its check");
  assert.ok(
    gateCheck.evidence_ref.includes(stagingAuthRbacTenantAuditEvidence.evidencePath),
    "auth/RBAC/tenant/audit gate check must cite the staging runtime evidence path"
  );

  const tenantCondition = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === stagingAuthRbacTenantAuditEvidence.doNotLaunchConditionId
  );
  assert.ok(tenantCondition, "private beta do-not-launch fixture needs tenant isolation condition");
  assert.equal(
    tenantCondition.is_present,
    false,
    "validated auth/RBAC/tenant/audit runtime evidence should clear the matching tenant condition"
  );
  assert.ok(
    tenantCondition.evidence_ref.includes(stagingAuthRbacTenantAuditEvidence.evidencePath),
    "cleared tenant isolation condition must cite the staging runtime evidence path"
  );

  for (const blocker of stagingAuthRbacTenantAuditEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the private beta gate fixture`);
    assert.equal(check.status, "blocked", `${blocker} must stay blocked after auth/RBAC/tenant/audit clears`);
  }
});

test("production abuse throttle hold evidence clears only the production abuse check", () => {
  assert.ok(existsSync(productionAbuseThrottleHoldPath), "production abuse throttle/hold evidence file is missing");
  assert.ok(existsSync(productionGatePath), "production launch gate evidence fixture is missing");

  const evidenceFile = JSON.parse(readFileSync(productionAbuseThrottleHoldPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(productionGatePath, "utf8"));

  assert.equal(productionAbuseThrottleHoldEvidence.id, evidenceFile.evidence_id, "admin fixture must match production evidence id");
  assert.equal(productionAbuseThrottleHoldEvidence.environment, "production", "evidence must be production scoped");
  assert.equal(evidenceFile.environment, "production", "evidence file must be production scoped");
  assert.equal(
    productionAbuseThrottleHoldEvidence.status,
    "pass_with_blockers_preserved",
    "production abuse evidence must preserve unrelated blockers"
  );
  assert.equal(evidenceFile.status, "pass_with_blockers_preserved", "evidence file must preserve unrelated blockers");
  assert.equal(
    productionAbuseThrottleHoldEvidence.evidencePath,
    "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
    "evidence path must cite gate-specific production evidence"
  );
  assert.equal(
    productionAbuseThrottleHoldEvidence.releaseGateCheckId,
    "production_abuse_throttle_hold",
    "evidence must bind the production abuse release-gate check"
  );
  assert.equal(
    productionAbuseThrottleHoldEvidence.doNotLaunchConditionId,
    "abuse_throttle_hold_missing",
    "evidence must bind the production abuse do-not-launch condition"
  );
  assert.equal(
    productionAbuseThrottleHoldEvidence.gateImpact.canClearCheckLevelItem,
    true,
    "validated evidence should clear only the check-level production abuse checklist item"
  );
  assert.equal(
    productionAbuseThrottleHoldEvidence.gateImpact.aggregateProductionGateStatus,
    "blocked_by_other_production_runtime_items",
    "abuse evidence must not close the aggregate production gate"
  );

  for (const requestId of productionAbuseThrottleHoldEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^production-abuse-throttle-hold-\d{8}T\d{4}Z-/,
      `${requestId} must be a production abuse runtime probe`
    );
  }

  for (const eventId of productionAbuseThrottleHoldEvidence.abuseEventIds) {
    assert.ok(abuseEventById.has(eventId), `${eventId} must link an abuse event`);
  }

  for (const hookId of productionAbuseThrottleHoldEvidence.abuseHookIds) {
    assert.ok(abuseHookIds.has(hookId), `${hookId} must link an abuse hold/throttle hook`);
  }

  const requiredAreas = new Set([
    "account_hold_enforcement",
    "rate_limit_enforcement",
    "rbac_audit_release",
    "gate_blocker_preservation"
  ]);

  for (const area of evidenceFile.coverage.map((item) => item.area)) {
    assert.ok(requiredAreas.has(area), `${area} is not an expected production abuse evidence area`);
  }

  for (const coverage of productionAbuseThrottleHoldEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("production"), `${coverage.area} must describe production runtime`);
    assert.match(
      coverage.runtimeProbe,
      /hold|throttle|gateway|scheduler|release-gate|dry-run/i,
      `${coverage.area} must cover abuse enforcement`
    );
    assert.ok(coverage.deploymentEvidence.length > 100, `${coverage.area} needs deployment evidence`);
    assert.ok(coverage.rbacAuditEvidence.length > 100, `${coverage.area} needs RBAC and audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes("ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json"),
      `${coverage.area} must cite the production evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          supportTicketIds.has(ref) ||
          abuseEventById.has(ref) ||
          abuseHookIds.has(ref) ||
          auditIds.has(ref) ||
          traceIds.has(ref) ||
          exportIds.has(ref) ||
          crawlerFindingIds.has(ref) ||
          ref.startsWith("rb-production-") ||
          ref.startsWith("eg-")
      ),
      `${coverage.area} needs validator-resolvable admin evidence refs`
    );
  }

  assert.deepEqual([...requiredAreas], [], "production abuse evidence is missing coverage areas");
  assert.deepEqual(
    evidenceFile.runtime_request_ids,
    productionAbuseThrottleHoldEvidence.runtimeRequestIds,
    "evidence file and admin fixture runtime probe ids must match"
  );

  const abuseCheck = gateFixture.checks.find((check) => check.check_id === "production_abuse_throttle_hold");
  assert.ok(abuseCheck, "production gate needs abuse throttle/hold check");
  assert.equal(abuseCheck.status, "pass", "validated production abuse evidence should clear only its check");
  assert.ok(
    abuseCheck.evidence_ref.includes(productionAbuseThrottleHoldEvidence.evidencePath),
    "production abuse check must cite the production runtime evidence path"
  );

  const abuseDoNotLaunch = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === productionAbuseThrottleHoldEvidence.doNotLaunchConditionId
  );
  assert.ok(abuseDoNotLaunch, "production do-not-launch fixture needs abuse condition");
  assert.equal(
    abuseDoNotLaunch.is_present,
    false,
    "validated production abuse runtime evidence should clear the matching do-not-launch condition"
  );
  assert.ok(
    abuseDoNotLaunch.evidence_ref.includes(productionAbuseThrottleHoldEvidence.evidencePath),
    "cleared production abuse do-not-launch condition must cite the production runtime evidence path"
  );

  for (const blocker of productionAbuseThrottleHoldEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the production gate fixture`);
    assert.equal(check.status, "blocked", `${blocker} must stay blocked after abuse throttle/hold clears`);
  }

  assert.ok(
    gateFixture.do_not_launch_checks.some((condition) => condition.is_present === true),
    "aggregate production gate must remain blocked by other do-not-launch conditions"
  );
});

test("production activation review audit evidence covers every high-risk admin override gate", () => {
  assert.ok(existsSync(productionActivationReviewAuditPath), "production activation review/audit evidence file is missing");
  assert.ok(existsSync(productionGatePath), "production launch gate evidence fixture is missing");

  const evidenceFile = JSON.parse(readFileSync(productionActivationReviewAuditPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(productionGatePath, "utf8"));
  const { buildAdminRbacRuntimeDecisions } = parseRbacRuntime();
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const decisionByEvidenceId = new Map(runtimeDecisions.map((decision) => [decision.evidenceId, decision]));
  const rbacById = new Map(adminRbacEvidence.map((item) => [item.id, item]));

  assert.equal(
    productionActivationReviewAuditEvidence.id,
    evidenceFile.evidence_id,
    "admin fixture must match production activation evidence id"
  );
  assert.equal(productionActivationReviewAuditEvidence.environment, "production", "evidence must be production scoped");
  assert.equal(evidenceFile.environment, "production", "evidence file must be production scoped");
  assert.equal(
    productionActivationReviewAuditEvidence.status,
    "pass_with_blockers_preserved",
    "production activation evidence must preserve unrelated blockers"
  );
  assert.equal(evidenceFile.status, "pass_with_blockers_preserved", "evidence file must preserve unrelated blockers");
  assert.equal(
    productionActivationReviewAuditEvidence.evidencePath,
    "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
    "evidence path must cite gate-specific production evidence"
  );
  assert.equal(
    productionActivationReviewAuditEvidence.releaseGateCheckId,
    "production_activation_review_audit",
    "evidence must bind the production activation review/audit release-gate check"
  );
  assert.deepEqual(
    productionActivationReviewAuditEvidence.doNotLaunchConditionIds,
    ["activation_eval_review_audit_runtime_missing", "admin_high_risk_review_runtime_missing"],
    "activation evidence must clear only the activation and high-risk admin review blockers"
  );

  for (const requestId of productionActivationReviewAuditEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^production-activation-review-audit-\d{8}T\d{4}Z-/,
      `${requestId} must be a production activation review/audit runtime probe`
    );
  }

  const requiredSurfaces = new Set([
    "skill_release",
    "crawler_import",
    "prompt_approval",
    "provider_routing",
    "quota_override",
    "safety_rule",
    "export_override"
  ]);
  for (const evidenceId of productionActivationReviewAuditEvidence.adminRbacEvidenceIds) {
    const rbac = rbacById.get(evidenceId);
    const runtimeDecision = decisionByEvidenceId.get(evidenceId);
    assert.ok(rbac, `${evidenceId} must link admin RBAC evidence`);
    assert.ok(runtimeDecision, `${evidenceId} must have a runtime RBAC decision`);
    requiredSurfaces.delete(rbac.surface);
    assert.equal(runtimeDecision.enforcementPoint, rbac.enforcementPoint, `${evidenceId} runtime enforcement must match RBAC evidence`);
    assert.equal(runtimeDecision.auditRef, rbac.auditRef, `${evidenceId} runtime audit ref must match RBAC evidence`);
    assert.ok(auditIds.has(rbac.auditRef), `${evidenceId} links unknown audit ${rbac.auditRef}`);

    if (rbac.decision === "allowed") {
      assert.equal(runtimeDecision.effectiveDecision, "allow_mutation", `${evidenceId} allowed RBAC evidence should apply with expiry`);
      assert.equal(runtimeDecision.releaseGateStatus, "runtime_override_applied_with_expiry");
    } else if (rbac.decision === "second_review_required") {
      assert.equal(runtimeDecision.effectiveDecision, "queue_for_review", `${evidenceId} second-review evidence should queue`);
      assert.equal(runtimeDecision.releaseGateStatus, "canary_or_release_blocked");
    } else {
      assert.equal(runtimeDecision.effectiveDecision, "deny_mutation", `${evidenceId} denied evidence should block mutation`);
      assert.equal(runtimeDecision.releaseGateStatus, "release_gate_preserved");
    }
  }
  assert.deepEqual([...requiredSurfaces], [], "production activation evidence must include every admin override surface");

  for (const reviewId of productionActivationReviewAuditEvidence.adminReviewDecisionIds) {
    assert.ok(
      ["rv-100", "rv-101", "rv-102"].includes(reviewId),
      `${reviewId} must link a production activation review fixture`
    );
  }

  for (const auditRef of productionActivationReviewAuditEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }

  const requiredAreas = new Set([
    "skill_release_gate",
    "crawler_activation_gate",
    "prompt_activation_gate",
    "provider_routing_gate",
    "quota_override_gate",
    "safety_policy_gate",
    "export_override_gate",
    "gate_blocker_preservation"
  ]);
  for (const area of evidenceFile.coverage.map((item) => item.area)) {
    assert.ok(requiredAreas.has(area), `${area} is not an expected production activation evidence area`);
  }

  for (const coverage of productionActivationReviewAuditEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("production"), `${coverage.area} must describe production runtime`);
    assert.match(
      coverage.runtimeProbe,
      /release|crawler|prompt|provider|quota|safety|export|release-gate/i,
      `${coverage.area} must cover activation review/audit enforcement`
    );
    assert.ok(coverage.deploymentEvidence.length > 120, `${coverage.area} needs deployment evidence`);
    assert.ok(coverage.rbacAuditEvidence.length > 120, `${coverage.area} needs RBAC and audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes("ops/evidence/production/20260527T1430Z-activation-review-audit.json"),
      `${coverage.area} must cite the production evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some((ref) => productionActivationReviewAuditEvidence.adminRbacEvidenceIds.includes(ref)),
      `${coverage.area} needs RBAC evidence refs`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          releaseEvidenceIds.has(ref) ||
          crawlerFindingIds.has(ref) ||
          supportTicketIds.has(ref) ||
          traceIds.has(ref) ||
          exportIds.has(ref)
      ),
      `${coverage.area} needs validator-resolvable audit, release, crawler, support, trace, or export refs`
    );
  }

  assert.deepEqual([...requiredAreas], [], "production activation evidence is missing coverage areas");

  const activationCheck = gateFixture.checks.find((check) => check.check_id === "production_activation_review_audit");
  assert.ok(activationCheck, "production gate needs activation review/audit check");
  assert.equal(activationCheck.status, "pass", "validated production activation evidence should clear only its check");
  assert.ok(
    activationCheck.evidence_ref.includes(productionActivationReviewAuditEvidence.evidencePath),
    "production activation check must cite the production runtime evidence path"
  );

  for (const conditionId of productionActivationReviewAuditEvidence.doNotLaunchConditionIds) {
    const condition = gateFixture.do_not_launch_checks.find((entry) => entry.condition_id === conditionId);
    assert.ok(condition, `${conditionId} must exist in production do-not-launch checks`);
    assert.equal(condition.is_present, false, `${conditionId} should be cleared by activation review/audit evidence`);
    assert.ok(
      condition.evidence_ref.includes(productionActivationReviewAuditEvidence.evidencePath),
      `${conditionId} must cite the activation review/audit evidence path`
    );
  }

  for (const blocker of productionActivationReviewAuditEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the production gate fixture`);
    assert.equal(check.status, "blocked", `${blocker} must stay blocked after activation review/audit clears`);
  }

  assert.ok(
    gateFixture.do_not_launch_checks.some((condition) => condition.is_present === true),
    "aggregate production gate must remain blocked by unrelated launch conditions"
  );
});

test("export regeneration requests require idempotency, support linkage, RBAC, quota handling, and audit evidence", () => {
  assert.ok(exportJobs.length > 0, "export regenerate needs fixtures");

  const decisions = new Set(exportJobs.map((job) => job.rbacDecision));
  assert.ok(decisions.has("allowed"), "export regeneration needs an allowed fixture");
  assert.ok(decisions.has("denied"), "export regeneration needs a denied fixture");
  assert.ok(decisions.has("second_review_required"), "export regeneration needs a review-gated fixture");

  for (const job of exportJobs) {
    const ticket = supportTicketById.get(job.supportTicketId);
    assert.ok(ticket, `${job.id} links unknown support ticket ${job.supportTicketId}`);
    assert.equal(ticket.userId, job.userId, `${job.id} support ticket must belong to export user`);
    assert.equal(ticket.exportId, job.id, `${job.id} support ticket must point at the same export`);
    assert.ok(roleOrder.has(job.requestedByRole), `${job.id} needs requesting role`);
    assert.ok(roleOrder.has(job.requiredRole), `${job.id} needs required role`);
    assert.ok(job.idempotencyKey.startsWith(`regenerate:${job.id}:${job.supportTicketId}:`), `${job.id} needs stable regenerate idempotency key`);
    assert.ok(job.regenerationRationale.length > 100, `${job.id} needs regeneration rationale`);
    assert.ok(job.operatorRunbook.length > 100, `${job.id} needs operator runbook`);
    assert.ok(job.closureEvidenceRefs.length >= 4, `${job.id} needs closure evidence refs`);
    assert.ok(job.closureEvidenceRefs.includes(job.id), `${job.id} closure evidence must include export`);
    assert.ok(job.closureEvidenceRefs.includes(job.supportTicketId), `${job.id} closure evidence must include support ticket`);

    if (job.auditRef !== "pending") {
      assert.ok(auditIds.has(job.auditRef), `${job.id} links unknown audit ${job.auditRef}`);
      assert.ok(job.closureEvidenceRefs.includes(job.auditRef), `${job.id} closure evidence must include audit ref`);
    }

    for (const ref of job.closureEvidenceRefs) {
      assert.ok(
        ref === job.id || supportTicketIds.has(ref) || traceIds.has(ref) || queueIds.has(ref) || auditIds.has(ref),
        `${job.id} links unknown closure evidence ref ${ref}`
      );
    }

    if (roleOrder.get(job.requestedByRole) < roleOrder.get(job.requiredRole)) {
      assert.notEqual(job.rbacDecision, "allowed", `${job.id} insufficient role cannot regenerate export`);
    }

    if (job.rbacDecision === "allowed") {
      assert.equal(job.regenerateEligible, true, `${job.id} allowed regeneration must be eligible`);
      assert.notEqual(job.auditRef, "pending", `${job.id} allowed regeneration needs audit ref`);
      assert.notEqual(job.regenerationMode, "not_allowed", `${job.id} allowed regeneration needs executable mode`);
    }

    if (job.qaSeverity === "blocking") {
      assert.equal(job.rbacDecision, "denied", `${job.id} blocking QA regeneration cannot be allowed`);
      assert.equal(job.regenerationMode, "not_allowed", `${job.id} blocking QA regeneration must stay disabled`);
      assert.match(job.quotaEffect, /credit|refund/, `${job.id} blocking QA needs quota remediation`);
    }

    if (job.auditRef === "pending") {
      assert.equal(job.rbacDecision, "second_review_required", `${job.id} pending audit must stay review-gated`);
      assert.equal(job.regenerateEligible, false, `${job.id} pending audit cannot be directly eligible`);
    }
  }
});

test("operations dashboards and alert routes bind SLOs to release-gate evidence", () => {
  assert.ok(operationalDashboards.length > 0, "operations dashboards need fixtures");
  assert.ok(alertRoutes.length > 0, "alert routes need fixtures");

  const requiredDashboards = new Set([
    "provider_latency_error",
    "export_failure",
    "crawler_policy_violation",
    "admin_security"
  ]);

  for (const dashboard of operationalDashboards) {
    requiredDashboards.delete(dashboard.name);
    assert.ok(roleOrder.has(dashboard.ownerRole), `${dashboard.id} has unknown owner role`);
    assert.ok(dashboard.linkedSystems.length >= 2, `${dashboard.id} needs linked systems`);
    assert.ok(dashboard.sourceSignals.length >= 2, `${dashboard.id} needs source signals`);
    assert.ok(dashboard.sloThreshold.length > 50, `${dashboard.id} needs concrete SLO threshold`);
    assert.ok(dashboard.releaseGateUse.length > 90, `${dashboard.id} needs release-gate usage`);
    assert.equal(dashboard.runtimeEnvironment, "staging", `${dashboard.id} needs staging runtime evidence`);
    assert.match(dashboard.runtimeEvidenceStatus, /verified|blocked/, `${dashboard.id} needs imported runtime evidence status`);
    assert.match(dashboard.runtimeEvidenceRef, runtimeEvidencePattern, `${dashboard.id} needs staging dashboard evidence ref`);
    assert.notEqual(dashboard.runtimeValidatedAt, "pending", `${dashboard.id} needs runtime validation timestamp`);
    assert.ok(dashboard.evidenceRefs.includes(dashboard.runtimeEvidenceRef), `${dashboard.id} evidence must include runtime ref`);
    assert.ok(dashboard.evidenceRefs.length >= 3, `${dashboard.id} needs evidence refs`);

    for (const ref of dashboard.evidenceRefs) {
      assert.ok(
        auditIds.has(ref) ||
          ref.startsWith("eg-") ||
          ref.startsWith("ph-") ||
          ref.startsWith("q-") ||
          ref.startsWith("cg-") ||
          ref.startsWith("staging-dashboard-") ||
          incidentIds.has(ref) ||
          supportTicketIds.has(ref) ||
          abuseEventById.has(ref) ||
          traceIds.has(ref),
        `${dashboard.id} links unknown dashboard evidence ref ${ref}`
      );
    }
  }

  assert.deepEqual([...requiredDashboards], [], "operations dashboards are missing required release surfaces");
  assert.ok(
    operationalDashboards.some((dashboard) => dashboard.status === "blocked"),
    "operations dashboards need at least one blocked release signal"
  );

  for (const alert of alertRoutes) {
    assert.ok(operationalDashboardIds.has(alert.dashboardId), `${alert.id} links unknown dashboard`);
    assert.ok(incidentIds.has(alert.incidentRef), `${alert.id} links unknown incident ${alert.incidentRef}`);
    assert.ok(auditIds.has(alert.auditRef), `${alert.id} links unknown audit ${alert.auditRef}`);
    assert.ok(roleOrder.has(alert.escalationRole), `${alert.id} has unknown escalation role`);
    assert.ok(alert.threshold.length > 50, `${alert.id} needs concrete threshold`);
    assert.ok(alert.runbook.length > 90, `${alert.id} needs actionable runbook`);
    assert.equal(alert.runtimeEnvironment, "staging", `${alert.id} needs staging runtime route evidence`);
    assert.equal(alert.runtimeEvidenceStatus, "verified", `${alert.id} alert route runtime evidence must be verified`);
    assert.match(alert.runtimeEvidenceRef, runtimeEvidencePattern, `${alert.id} needs staging alert evidence ref`);
    assert.notEqual(alert.runtimeValidatedAt, "pending", `${alert.id} needs runtime validation timestamp`);
    assert.ok(alert.evidenceRefs.includes(alert.dashboardId), `${alert.id} evidence must include dashboard`);
    assert.ok(alert.evidenceRefs.includes(alert.auditRef), `${alert.id} evidence must include audit`);
    assert.ok(alert.evidenceRefs.includes(alert.runtimeEvidenceRef), `${alert.id} evidence must include runtime ref`);

    if (alert.status === "firing") {
      assert.match(alert.incidentRef, /none|inc-/, `${alert.id} firing alerts need incident linkage state`);
      assert.notEqual(alert.severity, "sev3", `${alert.id} firing alerts should not stay low severity`);
    }

    if (alert.severity === "sev1") {
      assert.equal(alert.escalationRole, "admin_superadmin", `${alert.id} sev1 alerts need superadmin escalation`);
    }
  }
});

test("dashboard runtime evidence verifies staging imports and preserves release blockers", () => {
  assert.ok(existsSync(stagingDashboardRuntimePath), "staging dashboard runtime evidence file is missing");
  const evidenceFile = JSON.parse(readFileSync(stagingDashboardRuntimePath, "utf8"));

  assert.equal(evidenceFile.environment, "staging", "dashboard evidence file must be staging scoped");
  assert.equal(evidenceFile.status, "pass_with_blockers_preserved", "dashboard evidence must pass while preserving blockers");
  assert.equal(
    evidenceFile.blueprint_checklist_item,
    "导入并验证 staging dashboards runtime evidence。",
    "dashboard evidence must bind the exact checklist item"
  );
  assert.equal(
    evidenceFile.gate_impact.can_clear_dashboard_checklist_item,
    true,
    "dashboard evidence should clear only the dashboard checklist row"
  );
  assert.equal(
    evidenceFile.gate_impact.aggregate_private_beta_gate_status,
    "blocked_by_other_staging_runtime_items",
    "dashboard evidence must not close the aggregate private beta gate"
  );

  assert.equal(
    operationalDashboardRuntimeEvidence.length,
    operationalDashboards.length,
    "every operational dashboard needs one staging runtime evidence record"
  );

  const evidenceByDashboard = new Map();
  const runtimeFileRefs = new Set(evidenceFile.runtime_refs);
  const runtimeFileResults = new Map(evidenceFile.dashboard_results.map((result) => [result.dashboard_id, result]));
  const releaseBlockerIds = new Set(releaseBlockers.map((blocker) => blocker.id));

  for (const evidence of operationalDashboardRuntimeEvidence) {
    assert.ok(operationalDashboardIds.has(evidence.dashboardId), `${evidence.id} links unknown dashboard`);
    assert.equal(evidence.environment, "staging", `${evidence.id} must be staging runtime evidence`);
    assert.match(evidence.validationStatus, /verified|blocked/, `${evidence.id} needs explicit runtime status`);
    assert.notEqual(evidence.validatedAt, "pending", `${evidence.id} needs validation timestamp`);
    assert.ok(roleOrder.has(evidence.validatedByRole), `${evidence.id} has unknown validator role`);
    assert.ok(auditIds.has(evidence.auditRef), `${evidence.id} links unknown audit ${evidence.auditRef}`);
    assert.ok(evidence.importProbe.length > 90, `${evidence.id} needs dashboard import proof`);
    assert.ok(evidence.signalProbe.length > 90, `${evidence.id} needs signal binding proof`);
    assert.ok(evidence.sloProbe.length > 80, `${evidence.id} needs SLO evaluation proof`);
    assert.ok(evidence.blockerProbe.length > 90, `${evidence.id} needs blocker linkage proof`);
    assert.ok(evidence.releaseGateUse.length > 90, `${evidence.id} needs release-gate use proof`);
    assert.ok(evidence.evidenceRefs.includes(evidence.dashboardId), `${evidence.id} evidence must include dashboard`);
    assert.ok(evidence.evidenceRefs.includes(evidence.auditRef), `${evidence.id} evidence must include audit`);
    assert.ok(
      evidence.evidenceRefs.some((ref) => /^staging-dashboard-[a-z-]+-\d{8}T\d{4}Z$/.test(ref)),
      `${evidence.id} needs staging dashboard runtime ref`
    );
    assert.ok(
      evidence.evidenceRefs.some((ref) => runtimeFileRefs.has(ref)),
      `${evidence.id} must cite a runtime ref from the staging dashboard evidence file`
    );

    if (evidence.validationStatus === "blocked") {
      assert.ok(
        evidence.evidenceRefs.some((ref) => releaseBlockerIds.has(ref)),
        `${evidence.id} blocked dashboard evidence needs a release blocker ref`
      );
      assert.match(evidence.sloProbe, /blocked|exceeded|open/i, `${evidence.id} blocked evidence needs blocking SLO proof`);
    }

    assert.equal(evidenceByDashboard.has(evidence.dashboardId), false, `${evidence.dashboardId} has duplicate evidence`);
    evidenceByDashboard.set(evidence.dashboardId, evidence);
  }

  for (const dashboard of operationalDashboards) {
    const evidence = evidenceByDashboard.get(dashboard.id);
    const fileResult = runtimeFileResults.get(dashboard.id);
    assert.ok(evidence, `${dashboard.id} missing runtime evidence`);
    assert.ok(fileResult, `${dashboard.id} missing dashboard evidence file result`);
    assert.equal(evidence.validatedAt, dashboard.runtimeValidatedAt, `${dashboard.id} validation timestamp mismatch`);
    assert.equal(evidence.validationStatus, dashboard.runtimeEvidenceStatus, `${dashboard.id} runtime status mismatch`);
    assert.equal(fileResult.validation_status, dashboard.runtimeEvidenceStatus, `${dashboard.id} evidence file status mismatch`);
    assert.equal(fileResult.runtime_ref, dashboard.runtimeEvidenceRef, `${dashboard.id} evidence file runtime ref mismatch`);
    assert.ok(evidence.evidenceRefs.includes(dashboard.runtimeEvidenceRef), `${dashboard.id} evidence missing runtime ref`);

    if (dashboard.ownerRole === "admin_superadmin") {
      assert.equal(evidence.validatedByRole, "admin_superadmin", `${dashboard.id} superadmin dashboard needs superadmin validation`);
    }
  }

  assert.ok(
    operationalDashboardRuntimeEvidence.some((evidence) => evidence.validationStatus === "blocked"),
    "dashboard runtime evidence must preserve blocked staging dashboards"
  );
});

test("alert route runtime evidence verifies staging delivery without closing dashboard blockers", () => {
  assert.ok(existsSync(stagingAlertRuntimePath), "staging alert runtime evidence file is missing");
  const evidenceFile = JSON.parse(readFileSync(stagingAlertRuntimePath, "utf8"));

  assert.equal(evidenceFile.environment, "staging", "alert evidence file must be staging scoped");
  assert.equal(evidenceFile.status, "pass", "alert route evidence must pass");
  assert.equal(
    evidenceFile.blueprint_checklist_item,
    "配置并验证 staging alert routes/runtime evidence。",
    "alert evidence must bind the exact checklist item"
  );
  assert.equal(
    evidenceFile.gate_impact.can_clear_alert_checklist_item,
    true,
    "alert evidence should clear only the alert checklist row"
  );
  assert.equal(
    evidenceFile.gate_impact.aggregate_private_beta_gate_status,
    "blocked_by_other_staging_runtime_items",
    "alert evidence must not close the aggregate private beta gate"
  );

  assert.equal(
    alertRouteRuntimeEvidence.length,
    alertRoutes.length,
    "every alert route needs one staging runtime evidence record"
  );

  const evidenceByAlertRoute = new Map();
  const runtimeFileRefs = new Set(evidenceFile.runtime_refs);
  const runtimeFileResults = new Map(evidenceFile.alert_results.map((result) => [result.alert_route_id, result]));

  for (const evidence of alertRouteRuntimeEvidence) {
    assert.ok(alertRouteIds.has(evidence.alertRouteId), `${evidence.id} links unknown alert route`);
    assert.ok(operationalDashboardIds.has(evidence.dashboardId), `${evidence.id} links unknown dashboard`);
    assert.equal(evidence.environment, "staging", `${evidence.id} must be staging runtime evidence`);
    assert.equal(evidence.validationStatus, "verified", `${evidence.id} must be verified`);
    assert.notEqual(evidence.validatedAt, "pending", `${evidence.id} needs validation timestamp`);
    assert.ok(roleOrder.has(evidence.validatedByRole), `${evidence.id} has unknown validator role`);
    assert.ok(auditIds.has(evidence.auditRef), `${evidence.id} links unknown audit ${evidence.auditRef}`);
    assert.ok(evidence.routeBinding.length > 70, `${evidence.id} needs route binding proof`);
    assert.ok(evidence.deliveryProbe.length > 80, `${evidence.id} needs delivery probe proof`);
    assert.ok(evidence.thresholdProbe.length > 60, `${evidence.id} needs threshold probe proof`);
    assert.ok(evidence.escalationProbe.length > 70, `${evidence.id} needs escalation probe proof`);
    assert.ok(evidence.runbookProbe.length > 80, `${evidence.id} needs runbook probe proof`);
    assert.ok(evidence.incidentLinkage.length > 70, `${evidence.id} needs incident linkage proof`);
    assert.ok(evidence.releaseGateUse.length > 90, `${evidence.id} needs release-gate use proof`);
    assert.ok(evidence.evidenceRefs.includes(evidence.alertRouteId), `${evidence.id} evidence must include alert route`);
    assert.ok(evidence.evidenceRefs.includes(evidence.dashboardId), `${evidence.id} evidence must include dashboard`);
    assert.ok(evidence.evidenceRefs.includes(evidence.auditRef), `${evidence.id} evidence must include audit`);
    assert.ok(
      evidence.evidenceRefs.some((ref) => /^staging-alert-[a-z-]+-\d{8}T\d{4}Z$/.test(ref)),
      `${evidence.id} needs staging alert runtime ref`
    );
    assert.ok(
      evidence.evidenceRefs.some((ref) => runtimeFileRefs.has(ref)),
      `${evidence.id} must cite a runtime ref from the staging alert evidence file`
    );

    assert.equal(evidenceByAlertRoute.has(evidence.alertRouteId), false, `${evidence.alertRouteId} has duplicate evidence`);
    evidenceByAlertRoute.set(evidence.alertRouteId, evidence);
  }

  for (const alert of alertRoutes) {
    const evidence = evidenceByAlertRoute.get(alert.id);
    const fileResult = runtimeFileResults.get(alert.id);
    assert.ok(evidence, `${alert.id} missing runtime evidence`);
    assert.ok(fileResult, `${alert.id} missing alert evidence file result`);
    assert.equal(evidence.dashboardId, alert.dashboardId, `${alert.id} dashboard mismatch`);
    assert.equal(evidence.validatedAt, alert.runtimeValidatedAt, `${alert.id} validation timestamp mismatch`);
    assert.equal(evidence.auditRef, alert.auditRef, `${alert.id} audit mismatch`);
    assert.equal(fileResult.validation_status, alert.runtimeEvidenceStatus, `${alert.id} evidence file status mismatch`);
    assert.equal(fileResult.runtime_ref, alert.runtimeEvidenceRef, `${alert.id} evidence file runtime ref mismatch`);

    if (alert.severity === "sev1") {
      assert.equal(evidence.validatedByRole, "admin_superadmin", `${alert.id} sev1 evidence needs superadmin validation`);
    }

    if (alert.status === "firing") {
      assert.match(
        evidence.escalationProbe,
        /required|stayed|Escalation/,
        `${alert.id} firing alert needs explicit escalation proof`
      );
    }
  }

  assert.ok(
    operationalDashboards.some((dashboard) => dashboard.runtimeEvidenceStatus === "blocked"),
    "verified alert-route evidence must not imply all dashboards are runtime-verified"
  );
});

test("backend worker crawler metrics runtime evidence validates staging scrapes without closing aggregate gate", () => {
  assert.ok(existsSync(stagingMetricsRuntimePath), "staging metrics runtime evidence file is missing");
  const evidenceFile = JSON.parse(readFileSync(stagingMetricsRuntimePath, "utf8"));

  assert.equal(evidenceFile.environment, "staging", "metrics evidence file must be staging scoped");
  assert.equal(
    evidenceFile.status,
    "pass_with_blockers_preserved",
    "metrics evidence must pass while preserving non-metrics blockers"
  );
  assert.equal(
    evidenceFile.blueprint_checklist_item,
    "staging backend/worker/crawler metrics runtime evidence 通过。",
    "metrics evidence must bind the exact checklist item"
  );
  assert.equal(
    evidenceFile.gate_impact.can_clear_metrics_checklist_item,
    true,
    "metrics evidence should clear only the metrics checklist row"
  );
  assert.equal(
    evidenceFile.gate_impact.aggregate_private_beta_gate_status,
    "blocked_by_other_staging_runtime_items",
    "metrics evidence must not close the aggregate private beta gate"
  );

  assert.equal(backendMetricsRuntimeEvidence.environment, "staging", "admin metrics evidence must be staging scoped");
  assert.equal(
    backendMetricsRuntimeEvidence.evidencePath,
    "ops/evidence/staging/20260527T1215Z-backend-worker-crawler-metrics.json",
    "admin fixture must point at the metrics evidence file"
  );
  assert.equal(
    backendMetricsRuntimeEvidence.releaseGateCheckId,
    "staging_observability_backup_load",
    "metrics evidence must remain inside the observability backup/load gate"
  );
  assert.equal(backendMetricsRuntimeEvidence.canClearChecklistItem, true, "metrics checklist row should be clearable");
  assert.ok(
    backendMetricsRuntimeEvidence.remainingBlockers.includes("staging request id propagation runtime evidence"),
    "metrics evidence must preserve request-id blocker"
  );
  assert.ok(
    backendMetricsRuntimeEvidence.remainingBlockers.includes("staging structured JSON logs runtime evidence"),
    "metrics evidence must preserve structured log blocker"
  );
  assert.ok(
    backendMetricsRuntimeEvidence.remainingBlockers.includes("staging OpenTelemetry traces runtime evidence"),
    "metrics evidence must preserve trace blocker"
  );
  assert.ok(
    backendMetricsRuntimeEvidence.remainingBlockers.includes("staging backup/restore/load runtime evidence"),
    "metrics evidence must preserve restore/load blocker"
  );

  const requiredServices = new Set(["backend_api", "worker", "crawler"]);
  const runtimeFileRefs = new Set(evidenceFile.runtime_refs);
  const runtimeFileResults = new Map(evidenceFile.metrics_results.map((result) => [result.service, result]));
  const allRequiredSignals = new Set();

  for (const probe of backendMetricsRuntimeEvidence.probes) {
    requiredServices.delete(probe.service);
    const fileResult = runtimeFileResults.get(probe.service);
    assert.ok(fileResult, `${probe.service} missing metrics evidence file result`);
    assert.equal(fileResult.runtime_ref, probe.runtimeRef, `${probe.service} runtime ref mismatch`);
    assert.equal(fileResult.validation_status, probe.validationStatus, `${probe.service} status mismatch`);
    assert.equal(fileResult.scrape_target, probe.scrapeTarget, `${probe.service} scrape target mismatch`);
    assert.equal(fileResult.audit_ref, probe.auditRef, `${probe.service} audit mismatch`);
    assert.equal(probe.validationStatus, "verified", `${probe.service} metrics probe must be verified`);
    assert.match(probe.runtimeRef, /^staging-metrics-[a-z-]+-\d{8}T\d{4}Z$/, `${probe.service} needs staging metrics runtime ref`);
    assert.ok(runtimeFileRefs.has(probe.runtimeRef), `${probe.service} runtime ref must appear in evidence file`);
    assert.ok(probe.scrapeTarget.includes("/metrics"), `${probe.service} needs a metrics scrape target`);
    assert.ok(probe.requiredSignals.length >= 5, `${probe.service} needs required metric signals`);
    assert.ok(probe.cardinalityProbe.length > 120, `${probe.service} needs cardinality and redaction proof`);
    assert.ok(probe.sloProbe.length > 100, `${probe.service} needs SLO probe proof`);
    assert.ok(probe.releaseGateUse.length > 100, `${probe.service} needs release-gate use proof`);
    assert.ok(auditIds.has(probe.auditRef), `${probe.service} links unknown audit ${probe.auditRef}`);
    assert.ok(probe.evidenceRefs.includes(backendMetricsRuntimeEvidence.id), `${probe.service} evidence must include parent evidence`);
    assert.ok(probe.evidenceRefs.includes(probe.runtimeRef), `${probe.service} evidence must include runtime ref`);
    assert.ok(probe.evidenceRefs.includes(probe.auditRef), `${probe.service} evidence must include audit`);
    assert.match(
      `${probe.cardinalityProbe} ${fileResult.cardinality_probe}`,
      /redact|absent|rejected|bounded/i,
      `${probe.service} needs label redaction/cardinality proof`
    );

    for (const signal of probe.requiredSignals) {
      allRequiredSignals.add(signal);
    }
  }

  assert.deepEqual([...requiredServices], [], "metrics evidence must cover backend API, worker, and crawler");
  for (const signal of [
    "http_request_duration_ms",
    "quota_reservation_total",
    "worker_task_failed_total",
    "provider_usage_reconciled_total",
    "crawler_source_blocked_total",
    "crawler_derivative_review_open_total"
  ]) {
    assert.ok(allRequiredSignals.has(signal), `missing required metrics signal ${signal}`);
  }

  assert.equal(
    evidenceFile.metrics_results.length,
    backendMetricsRuntimeEvidence.probes.length,
    "metrics evidence file and admin fixture must cover the same probe count"
  );
});

test("release blocker matrix prevents partial operations evidence from closing beta and production gates", () => {
  assert.ok(releaseBlockers.length > 0, "release blocker matrix needs fixtures");

  const gates = new Set(releaseBlockers.map((blocker) => blocker.gate));
  assert.ok(gates.has("private_beta"), "release blockers need private beta coverage");
  assert.ok(gates.has("production_launch"), "release blockers need production launch coverage");

  for (const blocker of releaseBlockers) {
    assert.ok(operationalDashboardIds.has(blocker.dashboardId), `${blocker.id} links unknown dashboard`);
    assert.ok(alertRouteIds.has(blocker.alertRouteId), `${blocker.id} links unknown alert route`);
    assert.ok(releaseEvidenceIds.has(blocker.releaseEvidenceId), `${blocker.id} links unknown release evidence`);
    assert.ok(auditIds.has(blocker.auditRef), `${blocker.id} links unknown audit ${blocker.auditRef}`);
    assert.ok(roleOrder.has(blocker.ownerRole), `${blocker.id} has unknown owner role`);
    assert.match(blocker.runtimeEvidenceRef, runtimeEvidencePattern, `${blocker.id} needs staging runtime evidence ref`);
    assert.ok(blocker.blockingSignal.length > 90, `${blocker.id} needs concrete blocking signal`);
    assert.ok(blocker.requiredEvidence.length > 100, `${blocker.id} needs required evidence`);
    assert.ok(blocker.unblockCriteria.length > 100, `${blocker.id} needs unblock criteria`);
    assert.notEqual(blocker.nextReviewAt, "pending", `${blocker.id} needs next review timestamp`);
    assert.ok(blocker.evidenceRefs.includes(blocker.dashboardId), `${blocker.id} evidence must include dashboard`);
    assert.ok(blocker.evidenceRefs.includes(blocker.alertRouteId), `${blocker.id} evidence must include alert route`);
    assert.ok(blocker.evidenceRefs.includes(blocker.releaseEvidenceId), `${blocker.id} evidence must include release evidence`);
    assert.ok(blocker.evidenceRefs.includes(blocker.auditRef), `${blocker.id} evidence must include audit`);
    assert.ok(blocker.evidenceRefs.includes(blocker.runtimeEvidenceRef), `${blocker.id} evidence must include runtime ref`);

    if (blocker.severity === "sev1") {
      assert.equal(blocker.ownerRole, "admin_superadmin", `${blocker.id} sev1 blockers need superadmin ownership`);
      assert.equal(blocker.status, "open", `${blocker.id} sev1 blockers cannot be review-ready`);
    }

    if (blocker.gate === "production_launch") {
      assert.notEqual(blocker.status, "ready_for_review", `${blocker.id} production blockers cannot close on partial evidence`);
      assert.match(
        blocker.unblockCriteria,
        /closes|reaches|stays|no open|no longer/i,
        `${blocker.id} production blocker needs closure criteria`
      );
    }
  }

  assert.ok(
    releaseBlockers.some((blocker) => blocker.blockerKind === "dashboard_slo" && blocker.status === "open"),
    "provider SLO blockers must stay open despite verified alert route probes"
  );
  assert.ok(
    releaseBlockers.some((blocker) => blocker.blockerKind === "runtime_evidence" && blocker.status === "mitigating"),
    "runtime evidence blockers need a mitigation state before gate closure"
  );
});

test("operations runtime evidence closes only the validated dashboard and alert checklist rows", () => {
  assert.match(
    blueprint,
    /- \[x\] 导入并验证 staging dashboards runtime evidence。/,
    "staging dashboard runtime evidence checklist row should close after validator-backed staging evidence"
  );
  assert.match(
    blueprint,
    /- \[x\] 配置并验证 staging alert routes\/runtime evidence。/,
    "staging alert route runtime evidence checklist row should close after validator-backed staging evidence"
  );
  assert.match(
    blueprint,
    /- \[x\] staging backend\/worker\/crawler metrics runtime evidence 通过。/,
    "metrics runtime evidence checklist row should close after validator-backed staging evidence"
  );

  const dashboardRuntimeRefs = new Set(operationalDashboards.map((dashboard) => dashboard.runtimeEvidenceRef));
  const alertRuntimeRefs = new Set(alertRoutes.map((alert) => alert.runtimeEvidenceRef));
  const metricsRuntimeRefs = new Set(backendMetricsRuntimeEvidence.probes.map((probe) => probe.runtimeRef));

  for (const ref of [
    "staging-dashboard-provider-20260526T1000Z",
    "staging-dashboard-export-20260526T1000Z",
    "staging-dashboard-crawler-20260526T1000Z",
    "staging-dashboard-admin-security-20260526T1030Z"
  ]) {
    assert.ok(dashboardRuntimeRefs.has(ref), `missing dashboard runtime evidence ref ${ref}`);
  }

  for (const ref of [
    "staging-alert-provider-20260526T1000Z",
    "staging-alert-export-20260526T1000Z",
    "staging-alert-crawler-20260526T1000Z",
    "staging-alert-admin-security-20260526T1030Z"
  ]) {
    assert.ok(alertRuntimeRefs.has(ref), `missing alert route runtime evidence ref ${ref}`);
  }

  for (const ref of [
    "staging-metrics-backend-api-20260527T1215Z",
    "staging-metrics-worker-20260527T1215Z",
    "staging-metrics-crawler-20260527T1215Z"
  ]) {
    assert.ok(metricsRuntimeRefs.has(ref), `missing backend/worker/crawler metrics runtime evidence ref ${ref}`);
  }

  assert.ok(
    operationalDashboards.every((dashboard) => dashboard.runtimeEnvironment === "staging"),
    "all operational dashboard evidence must be staged runtime evidence"
  );
  assert.ok(
    operationalDashboards.every((dashboard) => dashboard.runtimeEvidenceStatus !== "definition_only"),
    "dashboard checklist cannot close on definition-only evidence"
  );
  assert.ok(
    alertRoutes.every((alert) => alert.runtimeEnvironment === "staging" && alert.runtimeEvidenceStatus === "verified"),
    "alert route checklist cannot close until every route has verified staging evidence"
  );
  assert.ok(
    alertRouteRuntimeEvidence.every((evidence) => evidence.validationStatus === "verified"),
    "alert route checklist cannot close until every runtime evidence record is verified"
  );
  assert.ok(
    backendMetricsRuntimeEvidence.probes.every((probe) => probe.validationStatus === "verified"),
    "metrics checklist cannot close until backend, worker, and crawler probes are verified"
  );
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
    assert.equal(
      item.overrideScope,
      overrideScopeBySurface.get(item.surface),
      `${item.id} override scope must match governed surface`
    );
    assert.match(
      item.overrideDurationPolicy,
      /temporary_required|second_review_deadline|non_expiring_policy_block/,
      `${item.id} needs override duration policy`
    );
    assert.equal(typeof item.expiryEnforced, "boolean", `${item.id} needs explicit expiry enforcement flag`);
    assert.ok(item.releaseEvidenceRequired.length >= 4, `${item.id} needs release evidence requirements`);
    assert.ok(item.requestedAction.length > 40, `${item.id} needs a concrete requested action`);
    assert.match(
      item.enforcementPoint,
      /release_gate|crawler_activation|prompt_activation|provider_router|quota_mutation|safety_policy|export_release/,
      `${item.id} needs an executable admin enforcement point`
    );
    assert.ok(item.releaseGateImpact.length > 90, `${item.id} needs release-gate impact evidence`);
    assert.ok(item.userVisibleOutcome.length > 70, `${item.id} needs user-visible outcome evidence`);
    assert.match(item.apiScope, /^(GET|POST|PATCH|DELETE) \/api\/admin\//, `${item.id} API scope must stay inside admin API`);
    assert.match(
      item.mutationOutcome,
      /applied|queued_for_review|blocked_no_mutation/,
      `${item.id} needs explicit mutation outcome`
    );
    assert.notEqual(item.overrideExpiresAt, "pending", `${item.id} needs explicit temporary override expiration state`);
    assert.ok(
      item.overrideExpiresAt === "none" || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(item.overrideExpiresAt),
      `${item.id} override expiration must be none or an operator-readable timestamp`
    );
    assert.ok(item.runtimeCheck.length > 90, `${item.id} needs runtime enforcement check evidence`);
    assert.ok(item.postDecisionControl.length > 90, `${item.id} needs post-decision control evidence`);
    assert.match(
      item.runtimeCheck,
      new RegExp(item.enforcementPoint),
      `${item.id} runtime check must name its enforcement point`
    );
    assert.ok(item.rationale.length > 80, `${item.id} needs rationale with role and risk context`);

    if (item.decision === "allowed") {
      assert.ok(
        roleOrder.get(item.attemptedRole) >= roleOrder.get(item.requiredRole),
        `${item.id} allowed decision needs sufficient attempted role`
      );
      assert.equal(item.mutationOutcome, "applied", `${item.id} allowed decision must record applied mutation outcome`);
      assert.notEqual(item.overrideExpiresAt, "none", `${item.id} allowed temporary override must have an expiration`);
      assert.equal(item.overrideDurationPolicy, "temporary_required", `${item.id} allowed admin override must be temporary`);
      assert.equal(item.expiryEnforced, true, `${item.id} allowed temporary override must enforce expiry`);
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

    if (item.decision !== "allowed") {
      assert.notEqual(item.mutationOutcome, "applied", `${item.id} denied or gated decisions cannot apply mutations`);
      assert.match(
        item.postDecisionControl,
        /keep|deny|do not|leave|preserve/i,
        `${item.id} denied or gated decisions need a restrictive post-decision control`
      );
    }

    if (item.secondReviewStatus === "blocked") {
      assert.notEqual(item.mutationOutcome, "applied", `${item.id} blocked second review cannot apply mutation`);
    }

    if (item.overrideDurationPolicy === "non_expiring_policy_block") {
      assert.equal(item.overrideExpiresAt, "none", `${item.id} non-expiring policy block must not expose fake expiry`);
      assert.equal(item.expiryEnforced, false, `${item.id} non-expiring policy block cannot rely on expiry enforcement`);
      assert.equal(item.mutationOutcome, "blocked_no_mutation", `${item.id} non-expiring policy block must preserve state`);
    } else {
      assert.notEqual(item.overrideExpiresAt, "none", `${item.id} temporary/deadline override needs timestamp`);
      assert.equal(item.expiryEnforced, true, `${item.id} temporary/deadline override must enforce expiry`);
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
  assert.ok(
    adminRbacEvidence.some((item) => item.mutationOutcome === "queued_for_review"),
    "high-risk overrides need queued-for-review mutation evidence"
  );
  assert.ok(
    adminRbacEvidence.some((item) => item.mutationOutcome === "blocked_no_mutation"),
    "denied overrides need no-mutation evidence"
  );
  assert.ok(
    adminRbacEvidence.some(
      (item) => item.surface === "provider_routing" && item.decision === "allowed" && item.overrideExpiresAt !== "none"
    ),
    "provider routing needs an allowed temporary override fixture"
  );
  assert.ok(
    adminRbacEvidence.some(
      (item) =>
        item.surface === "provider_routing" &&
        item.decision === "allowed" &&
        new Date(`${item.overrideExpiresAt.replace(" ", "T")}:00Z`).getTime() <=
          new Date("2026-05-26T11:00:00Z").getTime()
    ),
    "provider routing needs an expired temporary override fixture"
  );

  const enforcementBySurface = new Map(adminRbacEvidence.map((item) => [item.surface, item.enforcementPoint]));
  assert.equal(enforcementBySurface.get("skill_release"), "release_gate", "skill release RBAC must bind to release gate");
  assert.equal(enforcementBySurface.get("crawler_import"), "crawler_activation", "crawler RBAC must bind to activation gate");
  assert.equal(enforcementBySurface.get("prompt_approval"), "prompt_activation", "prompt RBAC must bind to activation gate");
  assert.equal(enforcementBySurface.get("provider_routing"), "provider_router", "provider RBAC must bind to routing gate");
  assert.equal(enforcementBySurface.get("quota_override"), "quota_mutation", "quota RBAC must bind to mutation gate");
  assert.equal(enforcementBySurface.get("safety_rule"), "safety_policy", "safety RBAC must bind to policy gate");
  assert.equal(enforcementBySurface.get("export_override"), "export_release", "export RBAC must bind to release gate");
});

test("admin RBAC runtime decisions enforce high-risk override outcomes", () => {
  const { buildAdminRbacRuntimeDecisions } = parseRbacRuntime();
  const decisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));

  assert.equal(decisions.length, adminRbacEvidence.length, "every RBAC evidence item needs a runtime decision");
  assert.ok(
    decisions.some((decision) => decision.effectiveDecision === "allow_mutation" && decision.requestOutcome === "applied"),
    "RBAC runtime needs an allowed mutation with expiry"
  );
  assert.ok(
    decisions.some((decision) => decision.effectiveDecision === "queue_for_review" && decision.requestOutcome === "queued_second_review"),
    "RBAC runtime needs queued second-review decisions"
  );
  assert.ok(
    decisions.some((decision) => decision.effectiveDecision === "deny_mutation" && decision.requestOutcome === "denied_insufficient_role"),
    "RBAC runtime needs insufficient-role denials"
  );
  assert.ok(
    decisions.some((decision) => decision.effectiveDecision === "deny_mutation" && decision.requestOutcome === "denied_policy_block"),
    "RBAC runtime needs policy-block denials"
  );
  assert.ok(
    decisions.some(
      (decision) => decision.effectiveDecision === "deny_mutation" && decision.requestOutcome === "denied_expired_override"
    ),
    "RBAC runtime needs expired temporary override denials"
  );

  const evidenceById = new Map(adminRbacEvidence.map((item) => [item.id, item]));

  for (const decision of decisions) {
    const item = evidenceById.get(decision.evidenceId);
    assert.ok(item, `${decision.evidenceId} links unknown RBAC evidence`);
    assert.equal(decision.surface, item.surface, `${decision.evidenceId} surface mismatch`);
    assert.equal(decision.overrideScope, item.overrideScope, `${decision.evidenceId} override scope mismatch`);
    assert.equal(decision.target, item.target, `${decision.evidenceId} target mismatch`);
    assert.equal(decision.enforcementPoint, item.enforcementPoint, `${decision.evidenceId} enforcement mismatch`);
    assert.ok(auditIds.has(decision.auditRef), `${decision.evidenceId} links unknown audit ${decision.auditRef}`);
    assert.deepEqual(decision.evidenceRefs, item.evidenceRefs, `${decision.evidenceId} evidence refs must be preserved`);
    assert.ok(decision.rationale.length > 120, `${decision.evidenceId} needs runtime rationale`);
    assert.match(
      decision.rationale,
      new RegExp(item.enforcementPoint),
      `${decision.evidenceId} runtime rationale must name enforcement point`
    );

    if (item.overrideDurationPolicy === "temporary_required" && decision.requestOutcome !== "denied_expired_override") {
      assert.equal(
        decision.expiryPolicyStatus,
        "valid_temporary_window",
        `${decision.evidenceId} active temporary override needs valid window status`
      );
    }

    if (item.overrideDurationPolicy === "second_review_deadline" && decision.requestOutcome !== "denied_expired_override") {
      assert.equal(
        decision.expiryPolicyStatus,
        "second_review_deadline_open",
        `${decision.evidenceId} second-review override needs deadline-open status`
      );
    }

    if (item.overrideDurationPolicy === "non_expiring_policy_block") {
      assert.equal(
        decision.expiryPolicyStatus,
        "non_expiring_policy_block",
        `${decision.evidenceId} policy block must not be treated as a temporary override`
      );
      assert.equal(decision.mutationAllowed, false, `${decision.evidenceId} policy block cannot mutate`);
    }

    if (decision.mutationAllowed) {
      assert.equal(decision.effectiveDecision, "allow_mutation", `${decision.evidenceId} mutation allowed only for allow decisions`);
      assert.equal(decision.queueAction, "apply_with_expiry", `${decision.evidenceId} allowed mutation needs expiry action`);
      assert.equal(decision.releaseGateStatus, "runtime_override_applied_with_expiry", `${decision.evidenceId} allowed mutation needs runtime gate status`);
    } else {
      assert.notEqual(decision.effectiveDecision, "allow_mutation", `${decision.evidenceId} denied or queued decision cannot allow mutation`);
      assert.match(
        decision.queueAction,
        /hold_for_second_review|block_and_preserve_state/,
        `${decision.evidenceId} denied or queued decision needs restrictive queue action`
      );
    }

    if (decision.requestOutcome === "denied_expired_override") {
      assert.notEqual(item.overrideExpiresAt, "none", `${decision.evidenceId} expired override needs a real expiration`);
      assert.equal(decision.queueAction, "block_and_preserve_state", `${decision.evidenceId} expired override must preserve state`);
      assert.equal(decision.releaseGateStatus, "release_gate_preserved", `${decision.evidenceId} expired override must preserve release gate`);
      assert.equal(decision.expiryPolicyStatus, "expired_temporary_window", `${decision.evidenceId} expired override needs expired policy status`);
      assert.match(decision.rationale, /expired/i, `${decision.evidenceId} expired override rationale must name expiry`);
    }

    if (item.surface === "export_override") {
      assert.equal(decision.effectiveDecision, "deny_mutation", "blocking export override must be denied at runtime");
      assert.equal(decision.requestOutcome, "denied_policy_block", "blocking export override needs policy-block outcome");
    }

    if (item.surface === "safety_rule") {
      assert.equal(decision.effectiveDecision, "queue_for_review", "safety rule override must remain queued for superadmin/second review");
      assert.equal(decision.releaseGateStatus, "canary_or_release_blocked", "safety rule override must keep release gate blocked");
    }
  }
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
    const fixtureCase = crawlerGovernanceCaseById.get(workflow.fixtureCaseId);

    assert.ok(crawlerFindingIds.has(workflow.findingId), `${workflow.id} links unknown crawler finding`);
    assert.ok(fixtureCase, `${workflow.id} links unknown crawler governance fixture ${workflow.fixtureCaseId}`);
    assert.notEqual(workflow.requestedAt, "pending", `${workflow.id} needs request timestamp`);
    assert.notEqual(workflow.dueAt, "pending", `${workflow.id} needs operator due timestamp`);
    assert.ok(workflow.sourceContact.length > 30, `${workflow.id} needs takedown contact process`);
    assert.ok(workflow.sourceContact !== "pending", `${workflow.id} needs concrete source contact process`);
    assert.match(workflow.linkedReview, /^rv-crawler-\d+$/, `${workflow.id} needs linked crawler review id`);
    assert.ok(workflow.operatorNextAction.length > 100, `${workflow.id} needs actionable operator next action`);
    assert.ok(workflow.closureCriteria.length > 100, `${workflow.id} needs closure criteria`);
    assert.ok(workflow.closureCriteria.includes(workflow.auditRef), `${workflow.id} closure criteria must cite audit ref`);
    assert.ok(workflow.requiredEvidenceRefs.length >= 3, `${workflow.id} needs evidence refs`);
    assert.notEqual(workflow.deletionEvidenceRef, "pending", `${workflow.id} needs deletion or retention evidence ref`);
    assert.notEqual(workflow.requesterNoticeRef, "pending", `${workflow.id} needs requester notice evidence ref`);
    assert.ok(
      workflow.requiredEvidenceRefs.includes(workflow.deletionEvidenceRef) || workflow.deletionEvidenceRef.startsWith("not_required"),
      `${workflow.id} deletion evidence must be either required or explicitly not required`
    );
    assert.ok(
      workflow.requiredEvidenceRefs.includes(workflow.requesterNoticeRef),
      `${workflow.id} requester notice evidence must be required for closure`
    );
    assert.ok(workflow.reviewRationale.length > 60, `${workflow.id} needs reviewer rationale`);
    assert.ok(auditIds.has(workflow.auditRef), `${workflow.id} links unknown audit ${workflow.auditRef}`);
    assert.match(workflow.reviewerRole, /admin_operator|admin_reviewer|admin_superadmin/, `${workflow.id} needs admin reviewer role`);
    assert.equal(
      workflow.activationGateDecision === "blocked",
      workflow.blockedActivation,
      `${workflow.id} activation gate decision must match blocked activation flag`
    );
    assert.match(workflow.secondReviewStatus, /not_required|required|completed/, `${workflow.id} needs second-review state`);
    if (workflow.secondReviewRequired) {
      assert.notEqual(workflow.secondReviewStatus, "not_required", `${workflow.id} required second review needs an active status`);
      assert.match(workflow.reviewRationale, /blocked|delete|review/i, `${workflow.id} second-review workflow needs high-risk rationale`);
    }
    assert.equal(
      fixtureCase.import_governance.takedown_workflow_required,
      true,
      `${workflow.id} fixture must require takedown workflow`
    );
    assert.equal(
      fixtureCase.import_governance.derivative_review_delete_required,
      true,
      `${workflow.id} fixture must require derivative/delete workflow`
    );
    assert.equal(
      fixtureCase.import_governance.direct_activation_allowed,
      false,
      `${workflow.id} fixture cannot permit direct activation`
    );

    if (workflow.requestType === "source_takedown") {
      assert.equal(workflow.blockedActivation, true, `${workflow.id} takedown must block activation`);
      assert.equal(workflow.rawRetentionAction, "delete_raw_and_derivatives", `${workflow.id} takedown must delete raw and derivative material`);
      assert.equal(workflow.derivativeUseStatus, "blocked", `${workflow.id} takedown must block derivative use`);
      assert.match(workflow.operatorNextAction, /delete raw and derivative material/i, `${workflow.id} takedown next action must require deletion`);
      assert.match(workflow.closureCriteria, /requester is notified/i, `${workflow.id} takedown closure must include requester notice`);
      assert.match(workflow.deletionEvidenceRef, /delete/i, `${workflow.id} takedown needs deletion evidence`);
      assert.match(workflow.requesterNoticeRef, /notice/i, `${workflow.id} takedown needs requester notice evidence`);
      assert.equal(workflow.secondReviewRequired, true, `${workflow.id} takedown needs second review`);
      assert.equal(workflow.activationGateDecision, "blocked", `${workflow.id} takedown activation gate must be blocked`);
    }

    if (workflow.requestType === "derivative_review" && workflow.derivativeUseStatus === "allowed") {
      assert.equal(workflow.blockedActivation, false, `${workflow.id} allowed derivative review should permit activation`);
      assert.equal(workflow.rawRetentionAction, "retain_with_limit", `${workflow.id} allowed derivative review still needs retention limit`);
      assert.equal(workflow.activationGateDecision, "allowed", `${workflow.id} allowed derivative review must permit activation gate`);
      assert.equal(fixtureCase.source.derivative_use_status, "allowed", `${workflow.id} allowed derivative review needs allowed source fixture`);
      assert.ok(
        fixtureCase.import_governance.raw_content_retention_days > 0,
        `${workflow.id} allowed derivative review needs bounded positive raw retention`
      );
      assert.match(workflow.closureCriteria, /provenance/i, `${workflow.id} derivative closure must preserve provenance`);
    }

    if (workflow.derivativeUseStatus === "unknown" || workflow.derivativeUseStatus === "restricted") {
      assert.equal(workflow.blockedActivation, true, `${workflow.id} unresolved derivative status must block activation`);
      assert.match(workflow.operatorNextAction, /prevent crawler-derived prompt activation/i, `${workflow.id} unresolved derivative review must prevent activation`);
      assert.equal(workflow.activationGateDecision, "blocked", `${workflow.id} unresolved derivative review must block activation gate`);
    }
  }
});

test("staging crawler governance runtime evidence covers every fetch and import control", () => {
  assert.ok(crawlerStagingRuntimeEvidence.length > 0, "crawler staging runtime evidence needs admin fixtures");
  assert.ok(existsSync(crawlerStagingRuntimePath), "crawler staging runtime evidence file is missing");

  const runtimeEvidenceFile = JSON.parse(readFileSync(crawlerStagingRuntimePath, "utf8"));
  assert.equal(runtimeEvidenceFile.evidence_id, crawlerStagingRuntimeEvidence[0].id);
  assert.equal(runtimeEvidenceFile.release_gate_check_id, "staging_crawler_approval_provenance");
  assert.equal(runtimeEvidenceFile.status, "pass_with_blockers_preserved");

  const jsonControlsByName = new Map(runtimeEvidenceFile.controls.map((control) => [control.control, control]));
  const requiredControls = new Set([
    "source_approval",
    "robots",
    "ssrf",
    "rate_limit",
    "retention",
    "exact_text_warning",
    "provenance",
    "source_blocklist"
  ]);

  for (const evidence of crawlerStagingRuntimeEvidence) {
    assert.equal(evidence.environment, "staging", `${evidence.id} must be staging evidence`);
    assert.equal(evidence.status, "pass_with_blockers_preserved", `${evidence.id} should preserve remaining gate blockers`);
    assert.equal(evidence.releaseGateCheckId, "staging_crawler_approval_provenance", `${evidence.id} links wrong release gate check`);
    assert.equal(evidence.evidencePath, "ops/evidence/staging/20260527T1100Z-crawler-governance-runtime.json");
    assert.ok(existsSync(new URL(evidence.evidencePath, repoRoot)), `${evidence.id} evidence path does not resolve`);
    assert.ok(roleOrder.has(evidence.validatedByRole), `${evidence.id} has unknown validating role`);
    assert.ok(evidence.remainingBlockers.length > 0, `${evidence.id} must preserve unrelated private beta blockers`);

    for (const control of evidence.controls) {
      requiredControls.delete(control.control);

      const jsonControl = jsonControlsByName.get(control.control);
      assert.ok(jsonControl, `${control.control} missing from staging evidence JSON`);
      assert.equal(jsonControl.runtime_ref, control.runtimeRef, `${control.control} runtime ref differs from JSON evidence`);
      assert.equal(jsonControl.enforcement_point, control.enforcementPoint, `${control.control} enforcement point differs from JSON evidence`);
      assert.equal(jsonControl.gate_decision, control.gateDecision, `${control.control} gate decision differs from JSON evidence`);
      assert.equal(jsonControl.audit_ref, control.auditRef, `${control.control} audit ref differs from JSON evidence`);

      assert.equal(control.status, "verified", `${control.control} must be verified`);
      assert.match(
        control.enforcementPoint,
        /crawler_fetch_gate|crawler_import_gate|crawler_activation/,
        `${control.control} needs executable crawler enforcement point`
      );
      assert.ok(crawlerFindingIds.has(control.linkedFindingId), `${control.control} links unknown crawler finding`);
      assert.ok(crawlerSourceApprovals.some((approval) => approval.id === control.sourceApprovalId), `${control.control} links unknown source approval`);
      assert.ok(crawlerGovernanceWorkflows.some((workflow) => workflow.id === control.governanceWorkflowId), `${control.control} links unknown governance workflow`);
      assert.ok(auditIds.has(control.auditRef), `${control.control} links unknown audit ${control.auditRef}`);
      assert.ok(control.probeResult.length > 90, `${control.control} needs concrete runtime probe result`);
      assert.ok(control.releaseGateUse.length > 90, `${control.control} needs release gate usage`);
      assert.ok(control.evidenceRefs.includes(control.linkedFindingId), `${control.control} evidence refs need finding id`);
      assert.ok(control.evidenceRefs.includes(control.sourceApprovalId), `${control.control} evidence refs need source approval id`);
      assert.ok(control.evidenceRefs.includes(control.governanceWorkflowId), `${control.control} evidence refs need governance workflow id`);
      assert.ok(control.evidenceRefs.includes(control.auditRef), `${control.control} evidence refs need audit ref`);

      const approval = crawlerSourceApprovals.find((entry) => entry.id === control.sourceApprovalId);
      const workflow = crawlerGovernanceWorkflows.find((entry) => entry.id === control.governanceWorkflowId);
      assert.ok(approval, `${control.control} source approval must exist`);
      assert.ok(workflow, `${control.control} workflow must exist`);
      assert.equal(approval.linkedFindingId, control.linkedFindingId, `${control.control} approval must match finding`);
      assert.equal(workflow.findingId, control.linkedFindingId, `${control.control} workflow must match finding`);

      if (control.gateDecision === "allow") {
        assert.equal(approval.activationGate, "allowed", `${control.control} allowed runtime control needs approved activation gate`);
      } else {
        assert.notEqual(approval.activationGate, "allowed", `${control.control} denied runtime control cannot point at allowed approval`);
      }
    }
  }

  assert.deepEqual([...requiredControls], [], "crawler staging runtime evidence is missing required controls");
  assert.ok(runtimeEvidenceFile.gate_impact.can_clear_crawler_governance_runtime_checklist_item);
  assert.equal(runtimeEvidenceFile.gate_impact.aggregate_private_beta_gate_status, "blocked_by_other_staging_runtime_items");
});
