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
    "export const crawlerStagingRuntimeEvidence",
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
    "export const stagingAuthRbacTenantAuditEvidence",
    "export const stagingSupportRetryAbuseEvidence",
    "export const stagingLegalSupportVisibilityEvidence",
    "export const stagingQuotaRateLimitSpendCapEvidence",
    "export const productionSkillReleaseEvalCanaryEvidence",
    "export const productionSecurityLaunchCheckEvidence",
    "export const productionBackupRollbackIncidentEvidence",
    "export const operationalDashboards",
    "export const operationalDashboardRuntimeEvidence",
    "export const alertRoutes",
    "export const alertRouteRuntimeEvidence",
    "export const backendMetricsRuntimeEvidence",
    "export const observabilityTelemetryRuntimeEvidence",
    "export const stagingObservabilityBackupLoadPreflightEvidence",
    "export const stagingObjectStorageRetentionCleanupEvidence",
    "export const releaseBlockers",
    "export const auditEvents",
    "export const analyticsReports",
    "export const skillReleaseStateDefinitions",
    "export const skillCanaryMetrics",
    "export const adminRbacEvidence",
    "export const adminRbacOverrideAttempts"
  ]) {
    assert.match(fixtures, new RegExp(token.replaceAll(" ", "\\s+")));
  }
});

test("admin skill release fixtures define state, allocation, canary, and rollback controls", () => {
  const releasesPage = readFileSync(
    new URL("../app/skills/releases/page.tsx", import.meta.url),
    "utf8"
  );

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

  for (const token of [
    "Production Skill Release Runtime Evidence",
    "ProductionSkillReleaseEvalCanaryCoverage",
    "Runtime Probe",
    "Deployment Evidence",
    "RBAC Audit Evidence",
    "Remaining blockers"
  ]) {
    assert.match(releasesPage, new RegExp(token));
  }

  for (const token of [
    "productionSkillReleaseEvalCanaryEvidence",
    "production_skill_release_eval_canary_20260527T1600Z",
    "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
    "eval_suite_gate",
    "canary_threshold_gate",
    "release_notes_gate",
    "rollback_gate",
    "gate_blocker_preservation"
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
    "Role Authorization",
    "Role Authorization Evidence",
    "Second Review Status",
    "Second Review Distinctness",
    "Second Review Header",
    "Idempotency Key",
    "Quota Effect",
    "State Transition",
    "Closure Outcome",
    "Release Gate",
    "Regression Fixture",
    "Closure Evidence"
  ]) {
    assert.match(queuesPage, new RegExp(token));
  }

  for (const token of [
    "idempotencyScope",
    "retryBackoffPolicy",
    "requestedByRole",
    "rbacDecision",
    "requestedByAdminId",
    "secondReviewRequired",
    "secondReviewEvidenceRefs",
    "idempotencyKey",
    "quotaEffect",
    "regressionFixtureRef",
    "closureEvidenceRefs",
    "rbacEvidenceRefs"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin audit page exposes RBAC stale override replay evidence", () => {
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
  const rbacRuntime = readFileSync(new URL("../lib/rbac-runtime.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");

  for (const token of [
    "RBAC Stale Override Replay",
    "getAdminRbacStaleReplayDecisions",
    "Stale Replays Blocked",
    "Stale Outcome",
    "State Restoration",
    "Release Gate",
    "Stale Replay Outcomes",
    "Stale Replay IDs"
  ]) {
    assert.match(auditPage, new RegExp(token));
  }

  for (const token of [
    "AdminRbacStaleReplayDecision",
    "blocked_stale_replay",
    "policy_block_preserved",
    "release_gate_preserved",
    "buildAdminRbacStaleReplayDecisions"
  ]) {
    assert.match(rbacRuntime + api + types, new RegExp(token));
  }
});

test("admin export pages expose regeneration governance evidence", () => {
  const exportsPage = readFileSync(
    new URL("../app/exports/page.tsx", import.meta.url),
    "utf8"
  );
  const exportDetailPage = readFileSync(
    new URL("../app/exports/[id]/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "RBAC Decision",
    "Support Ticket",
    "Quota Effect",
    "Audit Ref",
    "Regeneration Runtime Decisions",
    "QA Gate",
    "Closure Evidence",
    "Submit Disabled Reason",
    "Operator Action"
  ]) {
    assert.match(exportsPage, new RegExp(token));
  }

  for (const token of [
    "Idempotency key",
    "Requested role",
    "Required role",
    "Closure evidence",
    "Operator runbook",
    "Runtime Decision",
    "QA gate",
    "Audit status",
    "Closure evidence status",
    "Blocker codes",
    "Submit disabled reason",
    "regenerationRationale",
    "closureEvidenceRefs",
    "rbacDecision"
  ]) {
    assert.match(exportDetailPage, new RegExp(token));
  }

  for (const token of [
    "supportTicketId",
    "requestedByRole",
    "requiredRole",
    "idempotencyKey",
    "quotaEffect",
    "regenerationMode",
    "operatorRunbook",
    "regenerate:ex-909:sup-2209:missing-qa-report"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin abuse fixtures expose hold throttle telemetry and release evidence", () => {
  const abusePage = readFileSync(
    new URL("../app/abuse/page.tsx", import.meta.url),
    "utf8"
  );
  const abuseRuntime = readFileSync(
    new URL("../lib/abuse-runtime.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Telemetry Signal",
    "User Visible State",
    "Execution Mode",
    "Dry Run Evidence",
    "Release Evidence",
    "Temporary Hold and Throttle Hooks",
    "Runtime Enforcement Decisions",
    "Abuse Queue Runtime",
    "Quota Task",
    "Closure Allowed"
  ]) {
    assert.match(abusePage, new RegExp(token));
  }

  for (const token of [
    "telemetrySignal",
    "userVisibleState",
    "executionMode",
    "lastDryRunEvidence",
    "releaseEvidenceRefs",
    "hook-ab-304-hold",
    "rbacDecision"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }

  for (const token of [
    "buildAbuseRuntimeDecisions",
    "buildAbuseQueueRuntime",
    "deny_423_account_hold",
    "throttle_429_rate_limited",
    "canCreateQuotaConsumingTask: false",
    "closureAllowed: false"
  ]) {
    assert.match(abuseRuntime, new RegExp(token));
  }
});

test("admin operations page exposes backend worker crawler metrics runtime evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Backend Worker Crawler Metrics",
    "Scrape Target",
    "Required Signals",
    "Cardinality Probe",
    "SLO Probe",
    "Release Gate Check",
    "Can Clear Row",
    "Remaining Blockers",
    "getBackendMetricsRuntimeEvidence"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  for (const token of [
    "backendMetricsRuntimeEvidence",
    "staging-metrics-backend-api-20260527T1215Z",
    "staging-metrics-worker-20260527T1215Z",
    "staging-metrics-crawler-20260527T1215Z",
    "quota_reservation_total",
    "queue_dead_letter_total",
    "crawler_derivative_review_open_total",
    "pass_with_blockers_preserved"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin operations page exposes observability telemetry runtime evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Observability Telemetry Runtime",
    "getObservabilityTelemetryRuntimeEvidence",
    "Closed Checklist Rows",
    "Propagation Probe",
    "Redaction Probe",
    "Trace Linkage",
    "Can Clear Rows"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  for (const token of [
    "observabilityTelemetryRuntimeEvidence",
    "staging-request-id-admin-api-worker-crawler-20260527T1815Z",
    "staging-json-logs-admin-api-worker-crawler-20260527T1815Z",
    "staging-otel-admin-api-worker-crawler-20260527T1815Z",
    "request_id_propagation",
    "structured_json_logs",
    "opentelemetry_traces",
    "ops/evidence/staging/20260527T1815Z-observability-telemetry.json"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin operations page exposes observability backup load preflight evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Observability Backup Load Preflight",
    "getStagingObservabilityBackupLoadPreflightEvidence",
    "Can Clear Aggregate",
    "Preserved Condition",
    "Preflight Report",
    "Required Entries",
    "Missing Entries",
    "Blocking Reason"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  for (const token of [
    "stagingObservabilityBackupLoadPreflightEvidence",
    "obl-preflight-staging-20260527T013207Z",
    "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
    "ops/evidence/staging/20260527T2115Z-backup-restore.json",
    "ops/evidence/staging/20260527T2120Z-load.json",
    "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json",
    "backup_restore_evidence",
    "load_evidence",
    "post_deploy_smoke_evidence",
    "canClearAggregateItem: true",
    "preservedDoNotLaunchConditionId: \"none\""
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin quota page exposes staging quota rate limit spend cap evidence", () => {
  const quotaPage = readFileSync(
    new URL("../app/quota/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Staging Quota Rate Limit Spend Cap Evidence",
    "getStagingQuotaRateLimitSpendCapEvidence",
    "Release Gate Check",
    "Do Not Launch Condition",
    "Can Clear Row",
    "Remaining Blockers",
    "External User Evidence",
    "Enforcement Evidence"
  ]) {
    assert.match(quotaPage, new RegExp(token));
  }

  for (const token of [
    "stagingQuotaRateLimitSpendCapEvidence",
    "staging_quota_rate_limit_spend_cap_20260527T2015Z",
    "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
    "quota_reservation_commit_refund",
    "rate_limit_enforcement",
    "provider_spend_cap",
    "emergency_kill_switch",
    "rate_limit_spend_cap_runtime_missing"
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
    "Regression Fixture Runtime Gates",
    "RegressionFixture",
    "RegressionFixtureRuntimeSummary",
    "getRegressionFixtureRuntimeSummaries",
    "Release Gate Disposition",
    "High Risk Gate",
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
    "failed_task_retry_task_export_489",
    "failed_task_cancel_task_crawler_019",
    "admin_bad_sample",
    "failed_task",
    "requiredGate",
    "linkedCanaryMetric",
    "reviewerRationale"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin support page surfaces staging support retry abuse evidence", () => {
  const supportPage = readFileSync(
    new URL("../app/support/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Staging Support Retry Abuse Evidence",
    "Runtime Probe",
    "External User Evidence",
    "RBAC Audit Evidence",
    "Gate impact",
    "Runtime request ids"
  ]) {
    assert.match(supportPage, new RegExp(token));
  }

  for (const token of [
    "stagingSupportRetryAbuseEvidence",
    "staging_support_retry_abuse_20260527T1000Z",
    "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
    "support_ticket_linkage",
    "failed_task_retry_cancel",
    "abuse_hold_throttle",
    "abuse_queue_closure"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin audit page surfaces production security launch evidence", () => {
  const auditPage = readFileSync(
    new URL("../app/audit/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Production Security Evidence",
    "ProductionSecurityLaunchCheckCoverage",
    "Security Audit Evidence",
    "secure cookies",
    "CSRF/same-site",
    "secret redaction"
  ]) {
    assert.match(auditPage, new RegExp(token));
  }

  for (const token of [
    "productionSecurityLaunchCheckEvidence",
    "production_security_launch_checks_20260527T1700Z",
    "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
    "secure_session_cookie",
    "csrf_same_site_enforcement",
    "secret_exposure_redaction",
    "admin_surface_privacy",
    "security_privacy_legal_incomplete",
    "secret_exposure_runtime_not_verified"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin operations page surfaces production backup rollback incident evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );
  const adminApi = readFileSync(
    new URL("../lib/admin-api.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Production Backup Rollback Incident Evidence",
    "ProductionBackupRollbackIncidentCoverage",
    "Operational Audit Evidence",
    "Launch-Clearing Split",
    "Exact Evidence Path",
    "Required Runtime Proof",
    "Tracked Conditions",
    "Can Clear Rows",
    "Remaining Blockers",
    "getProductionBackupRollbackIncidentEvidence"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  assert.match(adminApi, /getProductionBackupRollbackIncidentEvidence/);

  for (const token of [
    "productionBackupRollbackIncidentEvidence",
    "production_backup_rollback_incident_20260527T1800Z",
    "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
    "backup_restore",
    "rollback_drill",
    "incident_alert_path",
    "post_deploy_smoke",
    "splitReadiness",
    "ops/evidence/production/backup-restore.json",
    "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
    "blocked_until_exact_split_file",
    "blocked_by_upstream_gates",
    "ci_staging_gates_not_passed"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin operations page surfaces legal support visibility evidence", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Dashboards",
    "Alert Routes",
    "Release Blocker Matrix",
    "Runtime Evidence",
    "Required Evidence",
    "Unblock Criteria"
  ]) {
    assert.match(operationsPage, new RegExp(token));
  }

  for (const token of [
    "od-legal-support-visibility",
    "legal_support_visibility",
    "al-legal-support-visibility",
    "rb-private-beta-legal-support-visibility",
    "eg-005",
    "au-020",
    "staging-dashboard-legal-support-20260527T2200Z",
    "staging-alert-legal-support-20260527T2200Z",
    "scripts/staging_legal_support_visibility_smoke.sh",
    "ops/evidence/staging/legal-pages-external-user.json",
    "ops/evidence/staging/support-contact-external-user.json",
    "staging_legal_support_visibility_20260527T2230Z",
    "legal_pages_visibility",
    "support_contact_visibility",
    "external_user_legal_pages_missing"
  ]) {
    assert.match(fixtures, new RegExp(token.replaceAll("/", "\\/")));
  }
});

test("admin audit page surfaces staging auth rbac tenant audit evidence", () => {
  const auditPage = readFileSync(
    new URL("../app/audit/page.tsx", import.meta.url),
    "utf8"
  );
  const adminApi = readFileSync(
    new URL("../lib/admin-api.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "getStagingAuthRbacTenantAuditEvidence",
    "Staging Auth RBAC Tenant Audit Evidence",
    "Runtime request ids",
    "Remaining blockers",
    "Runtime Probe",
    "External User Evidence",
    "RBAC Audit Evidence"
  ]) {
    assert.match(auditPage + adminApi, new RegExp(token));
  }

  for (const token of [
    "stagingAuthRbacTenantAuditEvidence",
    "staging_auth_rbac_tenant_audit_20260527T1515Z",
    "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
    "admin_session_boundary",
    "tenant_isolation_denial",
    "admin_rbac_runtime",
    "immutable_audit_linkage"
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

test("admin review and audit pages expose RBAC runtime decisions", () => {
  const reviewsPage = readFileSync(
    new URL("../app/reviews/page.tsx", import.meta.url),
    "utf8"
  );
  const auditPage = readFileSync(
    new URL("../app/audit/page.tsx", import.meta.url),
    "utf8"
  );
  const adminApi = readFileSync(
    new URL("../lib/admin-api.ts", import.meta.url),
    "utf8"
  );
  const rbacRuntime = readFileSync(
    new URL("../lib/rbac-runtime.ts", import.meta.url),
    "utf8"
  );

  for (const token of [
    "getAdminRbacRuntimeDecisions",
    "getAdminRbacEvidencePacks",
    "RBAC Runtime Decisions",
    "RBAC Override Evidence Pack",
    "RBAC Release Evidence Closure",
    "Effective Decision",
    "Request Outcome",
    "Queue Action",
    "Release Gate Status",
    "Release Gate Disposition",
    "Evidence Completeness",
    "Highest Required Role",
    "Operator Checklist",
    "API Scopes",
    "Expiry Enforcement",
    "Expiry Enforced IDs",
    "Policy Block IDs",
    "Attempt Coverage",
    "Stale Replay Coverage",
    "Closure Status",
    "Closure Evidence Refs",
    "Override Window",
    "Pre-Override State",
    "Expiry Action",
    "Stale Override Probe",
    "Runtime Rationale"
  ]) {
    assert.match(reviewsPage, new RegExp(token));
    assert.match(auditPage, new RegExp(token));
  }

  for (const token of [
    "buildAdminRbacRuntimeDecisions",
    "buildAdminRbacSurfaceSummaries",
    "buildAdminRbacEvidencePacks",
    "buildAdminRbacReleaseEvidenceClosures",
    "denied_insufficient_role",
    "denied_policy_block",
    "queued_second_review",
    "denied_expired_override",
    "apply_with_expiry",
    "held_for_second_review",
    "blocked_by_policy_or_role",
    "overrideWindow",
    "staleOverrideProbe",
    "operatorAction",
    "apiScopes",
    "expiryEnforcementStatus",
    "expiryEnforcedEvidenceIds",
    "policyBlockEvidenceIds"
  ]) {
    assert.match(adminApi + rbacRuntime, new RegExp(token));
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
    "overrideScope",
    "overrideDurationPolicy",
    "expiryEnforced",
    "requiredRole",
    "attemptedRole",
    "secondReviewStatus",
    "apiScope",
    "mutationOutcome",
    "overrideStartedAt",
    "overrideExpiresAt",
    "preOverrideState",
    "expiryAction",
    "staleOverrideProbe",
    "runtimeCheck",
    "postDecisionControl",
    "releaseEvidenceRequired"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }
});

test("admin review and audit pages expose RBAC override release summaries", () => {
  const reviewsPage = readFileSync(new URL("../app/reviews/page.tsx", import.meta.url), "utf8");
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");

  for (const source of [reviewsPage, auditPage]) {
    for (const token of [
      "getAdminRbacSurfaceSummaries",
      "AdminRbacSurfaceSummary",
      "Override Scope",
      "Decision Summary",
      "Release Gate Statuses",
      "Operator Action",
      "Release Evidence Required",
      "Audit Refs"
    ]) {
      assert.match(source, new RegExp(token));
    }
  }

  assert.match(reviewsPage, /Override Surface Summary/);
  assert.match(auditPage, /RBAC Override Release Summary/);
});

test("admin review and audit pages expose computed RBAC override evidence packs", () => {
  const reviewsPage = readFileSync(new URL("../app/reviews/page.tsx", import.meta.url), "utf8");
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const rbacRuntime = readFileSync(new URL("../lib/rbac-runtime.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");
  const statusBadge = readFileSync(new URL("../components/StatusBadge.tsx", import.meta.url), "utf8");

  for (const source of [reviewsPage, auditPage]) {
    for (const token of [
      "getAdminRbacEvidencePacks",
      "AdminRbacEvidencePack",
      "RBAC Override Evidence Pack",
      "Release Gate Disposition",
      "Evidence Completeness",
      "Highest Required Role",
      "Request Outcomes",
      "API Scopes",
      "Expiry Statuses",
      "Expiry Enforcement",
      "Expiry Enforced IDs",
      "Policy Block IDs",
      "Second Review Statuses",
      "Operator Checklist"
    ]) {
      assert.match(source, new RegExp(token));
    }
  }

  for (const token of [
    "buildAdminRbacEvidencePacks",
    "evidenceCompleteness",
    "releaseGateDisposition",
    "operatorChecklist",
    "apiScopes",
    "expiryEnforcementStatus",
    "expiryEnforcedEvidenceIds",
    "policyBlockEvidenceIds",
    "all_enforced",
    "policy_block_only",
    "mixed_enforcement",
    "missing_enforcement",
    "applied_with_expiry",
    "held_for_second_review",
    "blocked_by_policy_or_role",
    "mixed_preserved",
    "missing_audit",
    "missing_runtime",
    "missing_release_evidence"
  ]) {
    assert.match(adminApi + rbacRuntime + types + statusBadge, new RegExp(token));
  }
});

test("admin action pages show scoped RBAC evidence at decision points", () => {
  const pages = [
    {
      path: "../app/skills/releases/page.tsx",
      heading: "Skill Release RBAC Evidence",
      runtimeHeading: "Skill Release RBAC Runtime Decisions",
      surface: "skill_release"
    },
    {
      path: "../app/crawler/page.tsx",
      heading: "Crawler Import RBAC Evidence",
      runtimeHeading: "Crawler Import RBAC Runtime Decisions",
      surface: "crawler_import"
    },
    {
      path: "../app/prompt-fragments/page.tsx",
      heading: "Prompt Approval RBAC Evidence",
      runtimeHeading: "Prompt Approval RBAC Runtime Decisions",
      surface: "prompt_approval"
    },
    {
      path: "../app/providers/page.tsx",
      heading: "Provider Routing RBAC Evidence",
      runtimeHeading: "Provider Routing RBAC Runtime Decisions",
      surface: "provider_routing"
    },
    {
      path: "../app/quota/page.tsx",
      heading: "Quota Override RBAC",
      runtimeHeading: "Quota Override RBAC Runtime Decisions",
      surface: "quota_override"
    },
    {
      path: "../app/exports/page.tsx",
      heading: "Export Override RBAC Evidence",
      runtimeHeading: "Export Override RBAC Runtime Decisions",
      surface: "export_override"
    },
    {
      path: "../app/safety/page.tsx",
      heading: "Safety and Export Override RBAC",
      runtimeHeading: "Safety and Export Override RBAC Runtime Decisions",
      surface: "safety_rule"
    }
  ];

  for (const page of pages) {
    const source = readFileSync(new URL(page.path, import.meta.url), "utf8");

    for (const token of [
      "getAdminRbacEvidence",
      "getAdminRbacRuntimeDecisions",
      "RbacRuntimeDecisionTable",
      page.heading,
      page.runtimeHeading,
      page.surface,
      "Override Scope",
      "Required Role",
      "Attempted Role",
      "Decision",
      "Second Review",
      "API Scope",
      "Mutation Outcome",
      "Duration Policy",
      "Override Start",
      "Override Expiration",
      "Expiry Enforced",
      "Pre-Override State",
      "Expiry Action",
      "Stale Override Probe",
      "Runtime Check",
      "Post Decision Control",
      "Release Evidence Required",
      "Evidence Refs",
      "Audit Ref",
      "Rationale"
    ]) {
      assert.match(source, new RegExp(token));
    }
  }
});

test("shared RBAC runtime table exposes computed override outcomes", () => {
  const source = readFileSync(new URL("../components/RbacRuntimeDecisionTable.tsx", import.meta.url), "utf8");

  for (const token of [
    "Runtime Evidence",
    "Enforcement Point",
    "Expiry Policy Status",
    "Override Window",
    "Effective Decision",
    "Request Outcome",
    "Mutation Allowed",
    "Queue Action",
    "Release Gate Status",
    "Pre-Override State",
    "Expiry Action",
    "Stale Override Probe",
    "Evaluated At",
    "Audit Ref",
    "Evidence Refs",
    "Runtime Rationale",
    "allow_mutation",
    "queue_for_review",
    "denied"
  ]) {
    assert.match(source, new RegExp(token));
  }
});

test("admin crawler page exposes staging runtime governance evidence", () => {
  const crawlerPage = readFileSync(new URL("../app/crawler/page.tsx", import.meta.url), "utf8");

  for (const token of [
    "getCrawlerStagingRuntimeEvidence",
    "getCrawlerGovernanceClosureSummaries",
    "Staging Crawler Governance Runtime Evidence",
    "Crawler Release Closure Summary",
    "source approval, robots, SSRF, rate limits, retention, exact-text warnings, provenance, and blocklist controls",
    "Runtime Controls",
    "Evidence Path",
    "Release Gate Check",
    "Remaining Blockers",
    "Release Closure State",
    "Activation Safety State",
    "Evidence Completeness",
    "Takedown Delete Status",
    "Deadline Escalation Status",
    "Release Gate Disposition",
    "Missing Evidence Refs",
    "Operator Summary"
  ]) {
    assert.match(crawlerPage, new RegExp(token));
  }

  for (const token of [
    "crawlerStagingRuntimeEvidence",
    "source_approval",
    "robots",
    "ssrf",
    "rate_limit",
    "retention",
    "exact_text_warning",
    "provenance",
    "source_blocklist",
    "ops/evidence/staging/20260527T1100Z-crawler-governance-runtime.json"
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
    "operationalDashboardRuntimeEvidence",
    "alertRoutes",
    "provider_latency_error",
    "crawler_policy_violation",
    "releaseGateUse",
    "runtimeEnvironment",
    "runtimeEvidenceStatus",
    "runtimeEvidenceRef",
    "runtimeValidatedAt",
    "staging-dashboard-crawler",
    "staging-alert-crawler",
    "ops/evidence/staging/20260526T1000Z-dashboard-runtime.json",
    "ops/evidence/staging/20260526T1000Z-alert-runtime.json",
    "ops/evidence/staging/20260527T1815Z-observability-telemetry.json",
    "importProbe",
    "signalProbe",
    "sloProbe",
    "blockerProbe",
    "deliveryProbe",
    "thresholdProbe",
    "escalationProbe",
    "runbookProbe",
    "incidentLinkage",
    "releaseBlockers",
    "blockingSignal",
    "requiredEvidence",
    "unblockCriteria",
    "rb-production-admin-security",
    "escalationRole",
    "audience",
    "approval",
    "auditRef"
  ]) {
    assert.match(fixtures, new RegExp(token));
  }

  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Release Blocker Matrix",
    "Dashboard Runtime Evidence",
    "getOperationalDashboardRuntimeEvidence",
    "Import Probe",
    "Signal Probe",
    "SLO Probe",
    "Blocker Probe",
    "getReleaseBlockers",
    "getObservabilityTelemetryRuntimeEvidence",
    "Blocking Signal",
    "Required Evidence",
    "Unblock Criteria"
  ]) {
    assert.match(operationsPage, new RegExp(token));
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
  assert.match(operationsPage, /Alert Runtime Evidence/);
  assert.match(operationsPage, /SLO Threshold/);
  assert.match(operationsPage, /Escalation Role/);
  assert.match(operationsPage, /Runtime Evidence/);
  assert.match(operationsPage, /Runtime Status/);
  assert.match(operationsPage, /Validated At/);
  assert.match(operationsPage, /Delivery Probe/);
  assert.match(operationsPage, /Threshold Probe/);
  assert.match(operationsPage, /Incident Linkage/);
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
  assert.match(crawlerPage, /getCrawlerGovernanceRuntimeDecisions/);
  assert.match(crawlerPage, /getCrawlerGovernanceClosureSummaries/);
  assert.match(crawlerPage, /Crawler Governance Runtime Decisions/);
  assert.match(crawlerPage, /Crawler Release Closure Summary/);
  assert.match(crawlerPage, /Closure Decision/);
  assert.match(crawlerPage, /Activation Decision/);
  assert.match(crawlerPage, /Release Closure State/);
  assert.match(crawlerPage, /Activation Safety State/);
  assert.match(crawlerPage, /Release Gate Disposition/);
  assert.match(crawlerPage, /Deletion Evidence/);
  assert.match(crawlerPage, /Requester Notice/);
  assert.match(crawlerPage, /Blockers/);
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
