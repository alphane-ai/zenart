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
  "audit"
];

test("admin fixtures cover required operational surfaces", () => {
  for (const token of [
    "export const skills",
    "export const skillVersions",
    "export const adminReviewDecisions",
    "export const crawlerFindings",
    "export const promptFragments",
    "export const metaPrompts",
    "export const traces",
    "export const feedbackItems",
    "export const providerHealth",
    "export const queueHealth",
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
    "export const auditEvents"
  ]) {
    assert.match(fixtures, new RegExp(token.replaceAll(" ", "\\s+")));
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

test("admin fixtures cover operations gate evidence", () => {
  for (const token of [
    "customerImpact",
    "mitigation",
    "nextUpdateAt",
    "linkedSupportTickets",
    "rollbackPlan",
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

  const safetyPage = readFileSync(
    new URL("../app/safety/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(safetyPage, /Review Rationale/);

  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );
  assert.match(operationsPage, /Incident Log/);
  assert.match(operationsPage, /Maintenance Banner/);
  assert.match(operationsPage, /Rollback Plan/);
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
