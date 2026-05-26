import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fixtures = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");
const routes = [
  "skills",
  "skills/releases",
  "reviews",
  "crawler",
  "prompt-fragments",
  "meta-prompts",
  "traces",
  "feedback",
  "providers",
  "queues",
  "operations",
  "exports",
  "exports/[id]",
  "support",
  "quota",
  "safety",
  "abuse",
  "audit",
  "analytics"
];

test("admin fixtures cover required operational surfaces", () => {
  for (const token of [
    "export const skills",
    "export const skillVersions",
    "export const adminReviewDecisions",
    "export const crawlerFindings",
    "export const crawlerSourceApprovals",
    "export const crawlerGovernanceWorkflows",
    "export const promptFragments",
    "export const metaPrompts",
    "export const traces",
    "export const feedbackItems",
    "export const regressionFixtures",
    "export const providerHealth",
    "export const queueHealth",
    "export const failedTaskControls",
    "export const incidentLogs",
    "export const maintenanceBanners",
    "export const exportJobs",
    "export const supportTickets",
    "export const supportEscalationRunbooks",
    "export const supportUsers",
    "export const quotaAccounts",
    "export const riskyExports",
    "export const releaseEvidence",
    "export const abuseEvents",
    "export const abuseControlHooks",
    "export const operationalDashboards",
    "export const alertRoutes",
    "export const auditEvents",
    "export const analyticsReports",
    "export const skillReleaseStateDefinitions",
    "export const skillCanaryMetrics",
    "export const adminRbacEvidence"
  ]) {
    assert.match(fixtures, new RegExp(token.replaceAll(" ", "\\s+")));
  }
});

test("admin skill release fixtures define state, allocation, canary, and rollback controls", () => {
  for (const token of [
    "internal_canary",
    "allowlist_canary",
    "percent_canary",
    "trafficAllocation",
    "holdoutPercent",
    "routeEvidence",
    "stopThreshold",
    "pause_release",
    "regression_fixture_pass_rate",
    "criticalSafetyRegression",
    "rolled_back",
    "rollbackAuditRef"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin queue fixtures expose retry idempotency, RBAC, and quota effects", () => {
  const queuesPage = readFileSync(
    new URL("../app/queues/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Idempotency Scope",
    "Retry Backoff",
    "Requested By",
    "RBAC Decision",
    "Idempotency Key",
    "Quota Effect",
    "Closure Evidence"
  ]) {
    assert.match(queuesPage, new RegExp(token));
  }

  for (const token of [
    "idempotencyScope",
    "retryBackoffPolicy",
    "requestedByRole",
    "rbacDecision",
    "idempotencyKey",
    "quotaEffect",
    "closureEvidenceRefs"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin abuse fixtures expose hold throttle telemetry and release evidence", () => {
  const abusePage = readFileSync(
    new URL("../app/abuse/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Telemetry Signal",
    "User Visible State",
    "Release Evidence",
    "Temporary Hold and Throttle Hooks"
  ]) {
    assert.match(abusePage, new RegExp(token));
  }

  for (const token of [
    "telemetrySignal",
    "userVisibleState",
    "releaseEvidenceRefs",
    "hook-ab-304-hold",
    "rbacDecision"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin analytics reports cover stage 0 go/no-go reports", () => {
  const analyticsPage = readFileSync(
    new URL("../app/analytics/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "first prompt to four candidates",
    "selection",
    "iteration",
    "package/export completion",
    "weekly return",
    "QA",
    "cost",
    "support failure rate",
    "Decision Use",
    "Source Events"
  ]) {
    assert.match(analyticsPage, new RegExp(token));
  }

  assert.match(fixtures, /first_prompt_to_four_candidates/);
  assert.match(fixtures, /package_add_export_completion/);
  assert.match(fixtures, /support_ticket_failure_rate/);
});

test("admin feedback page surfaces bad samples converted to regression fixtures", () => {
  const feedbackPage = readFileSync(
    new URL("../app/feedback/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Bad Samples to Regression Fixtures",
    "RegressionFixture",
    "Expected Assertion",
    "Reviewer Rationale",
    "Canary Metric",
    "fixturePath"
  ]) {
    assert.match(feedbackPage, new RegExp(token));
  }

  for (const token of [
    "regressionFixtures",
    "brand_similarity_fb_203",
    "mobile_readability_fb_211",
    "export_manifest_sup_2204",
    "admin_bad_sample",
    "requiredGate",
    "linkedCanaryMetric",
    "reviewerRationale"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin fixtures expose review governance and release evidence", () => {
  for (const token of [
    "secondReviewRequired",
    "secondReviewer",
    "reviewerRationale",
    "canaryEvidence",
    "releaseEvidence",
    "contractEvidence",
    "reviewRationale",
    "evidenceRefs",
    "smokeEvidence",
    "rollbackEvidence"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin fixtures cover RBAC evidence for governed override surfaces", () => {
  for (const token of [
    "adminRbacEvidence",
    "skill_release",
    "crawler_import",
    "prompt_approval",
    "provider_routing",
    "quota_override",
    "safety_rule",
    "export_override",
    "requiredRole",
    "attemptedRole",
    "secondReviewStatus"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin fixtures cover operations gate evidence", () => {
  for (const token of [
    "customerImpact",
    "mitigation",
    "nextUpdateAt",
    "linkedSupportTickets",
    "rollbackPlan",
    "operationalDashboards",
    "alertRoutes",
    "provider_latency_error",
    "crawler_policy_violation",
    "releaseGateUse",
    "escalationRole",
    "audience",
    "approval",
    "auditRef"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin app exposes a route for every stage 0 admin surface", () => {
  for (const route of routes) {
    const page = readFileSync(
      new URL(`../app/${route}/page.tsx`, import.meta.url),
      "utf8"
    );
    assert.match(page, /PageHeader/);
  }
});

test("admin routes surface governance evidence", () => {
  const releasePage = readFileSync(
    new URL("../app/skills/releases/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(releasePage, /Second Review/);
  assert.match(releasePage, /Reviewer Rationale/);
  assert.match(releasePage, /Canary Evidence/);
  assert.match(releasePage, /Release Gate Evidence/);

  const providerPage = readFileSync(
    new URL("../app/providers/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(providerPage, /Contract Evidence/);
  assert.match(providerPage, /Canary Evidence/);
  assert.match(providerPage, /Release Evidence/);

  const reviewsPage = readFileSync(
    new URL("../app/reviews/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(reviewsPage, /Review Queue/);
  assert.match(reviewsPage, /Second Review/);
  assert.match(reviewsPage, /Evidence Refs/);

  const auditPage = readFileSync(
    new URL("../app/audit/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(auditPage, /Review Rationale Evidence/);
  assert.match(auditPage, /Second Review/);
  assert.match(auditPage, /High-risk admin changes/);
  assert.match(auditPage, /Support and quota actions/);
  assert.match(auditPage, /Release and canary changes/);
  assert.match(auditPage, /RBAC Override Evidence/);
  assert.match(auditPage, /Required Role/);

  const safetyPage = readFileSync(
    new URL("../app/safety/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(safetyPage, /Review Rationale/);
  assert.match(safetyPage, /Safety and Export Override RBAC/);

  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(operationsPage, /Incident Log/);
  assert.match(operationsPage, /Maintenance Banner/);
  assert.match(operationsPage, /Dashboards/);
  assert.match(operationsPage, /Alert Routes/);
  assert.match(operationsPage, /SLO Threshold/);
  assert.match(operationsPage, /Escalation Role/);
  assert.match(operationsPage, /Rollback Plan/);

  const queuesPage = readFileSync(
    new URL("../app/queues/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(queuesPage, /Retry Policy/);
  assert.match(queuesPage, /Cancel Policy/);
  assert.match(queuesPage, /Failed Task Retry and Cancel Controls/);
  assert.match(queuesPage, /Operator Runbook/);
  assert.match(queuesPage, /Allowed Role/);

  const crawlerPage = readFileSync(
    new URL("../app/crawler/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(crawlerPage, /Takedown and Derivative Review Workflow/);
  assert.match(crawlerPage, /Crawler Source Approval/);
  assert.match(crawlerPage, /Robots Evidence/);
  assert.match(crawlerPage, /Exact-text Policy/);
  assert.match(crawlerPage, /Requester/);
  assert.match(crawlerPage, /Source Contact/);
  assert.match(crawlerPage, /Derivative Use/);
  assert.match(crawlerPage, /Retention Action/);
  assert.match(crawlerPage, /Activation/);
  assert.match(crawlerPage, /Linked Review/);
  assert.match(crawlerPage, /Fixture Case/);
  assert.match(crawlerPage, /Operator Next Action/);
  assert.match(crawlerPage, /Closure Criteria/);
  assert.match(crawlerPage, /Review Rationale/);
  assert.match(crawlerPage, /Audit Ref/);

  const quotaPage = readFileSync(
    new URL("../app/quota/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(quotaPage, /Quota Override RBAC/);
  assert.match(quotaPage, /Attempted Role/);

  assert.match(releasePage, /Release Gate Evidence/);
  assert.match(reviewsPage, /Admin RBAC Evidence/);
  assert.match(reviewsPage, /Attempted Role/);

  const abusePage = readFileSync(
    new URL("../app/abuse/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(abusePage, /Temporary Hold and Throttle Hooks/);
  assert.match(abusePage, /Enforcement Point/);
  assert.match(abusePage, /Hook Payload/);
  assert.match(abusePage, /Attempted Role/);
  assert.match(abusePage, /RBAC Decision/);
  assert.match(abusePage, /Rollback Action/);
  assert.match(abusePage, /Release Condition/);
  assert.match(abusePage, /Evidence Refs/);
  assert.match(abusePage, /Operator Runbook/);
  assert.match(abusePage, /Audit Ref/);
});

test("support console surfaces ticket linkage and audit evidence", () => {
  const supportPage = readFileSync(
    new URL("../app/support/page.tsx", import.meta.url),
    "utf8"
  );
  for (const token of [
    "Ticket Linkage",
    "Project",
    "Task",
    "Trace",
    "Asset",
    "Export",
    "Quota Txn",
    "Next Action",
    "Escalation Readiness",
    "Update Cadence",
    "Customer Message",
    "Closure Blockers",
    "Audit Ref"
  ]) {
    assert.match(supportPage, new RegExp(token));
  }

  for (const token of [
    "projectId",
    "taskId",
    "traceId",
    "assetId",
    "exportId",
    "quotaTransactionId",
    "customerUpdateCadence",
    "customerMessage",
    "requiredEvidenceRefs",
    "closureBlockers",
    "auditRef"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});
