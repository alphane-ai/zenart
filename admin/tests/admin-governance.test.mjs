import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");
const abuseRuntimeSource = readFileSync(new URL("../lib/abuse-runtime.ts", import.meta.url), "utf8");
const rbacRuntimeSource = readFileSync(new URL("../lib/rbac-runtime.ts", import.meta.url), "utf8");
const exportRuntimeSource = readFileSync(new URL("../lib/export-runtime.ts", import.meta.url), "utf8");
const failedTaskRuntimeSource = readFileSync(new URL("../lib/failed-task-runtime.ts", import.meta.url), "utf8");
const regressionFixtureRuntimeSource = readFileSync(new URL("../lib/regression-fixture-runtime.ts", import.meta.url), "utf8");
const crawlerRuntimeSource = readFileSync(new URL("../lib/crawler-runtime.ts", import.meta.url), "utf8");
const objectStorageRuntimeSource = readFileSync(new URL("../lib/object-storage-runtime.ts", import.meta.url), "utf8");
const repoRoot = new URL("../../", import.meta.url);
const blueprint = readFileSync(new URL("../../Docs/stage0_blueprint_rev2.md", import.meta.url), "utf8");

const parseFixtures = () => {
  const moduleSource = source
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/export const (\w+)[^=]*=/g, "const $1 =");
  return Function(`${moduleSource}\nreturn { skillVersions, skillReleaseStateDefinitions, skillCanaryMetrics, releaseEvidence, releaseBlockers, supportTickets, supportEscalationRunbooks, supportUsers, riskyExports, abuseEvents, abuseControlHooks, stagingAuthRbacTenantAuditEvidence, stagingEvalQaSafetyEvidence, stagingQuotaRateLimitSpendCapEvidence, stagingSupportRetryAbuseEvidence, stagingLegalSupportVisibilityEvidence, productionAbuseThrottleHoldEvidence, productionActivationReviewAuditEvidence, productionSkillReleaseEvalCanaryEvidence, productionSecurityLaunchCheckEvidence, productionBackupRollbackIncidentEvidence, productionLegalSupportPolicyEvidence, productionProviderModeEvidence, productionPaidBillingLifecycleEvidence, adminReviewDecisions, auditEvents, exportJobs, traces, quotaAccounts, feedbackItems, regressionFixtures, analyticsReports, queueHealth, failedTaskControls, crawlerFindings, crawlerSourceApprovals, crawlerGovernanceWorkflows, crawlerStagingRuntimeEvidence, adminRbacEvidence, adminRbacOverrideAttempts, operationalDashboards, operationalDashboardRuntimeEvidence, alertRoutes, alertRouteRuntimeEvidence, backendMetricsRuntimeEvidence, observabilityTelemetryRuntimeEvidence, stagingObservabilityBackupLoadPreflightEvidence, stagingObjectStorageRetentionCleanupEvidence };`)();
};

const crawlerGovernanceCases = JSON.parse(
  readFileSync(new URL("../../fixtures/stage0/rev2/crawler/crawler_governance_cases.json", import.meta.url), "utf8")
);
const crawlerGovernanceRuntimeEvidence = JSON.parse(
  readFileSync(
    new URL("../../fixtures/stage0/rev2/crawler/crawler_governance_runtime_evidence.json", import.meta.url),
    "utf8"
  )
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
  stagingEvalQaSafetyEvidence,
  stagingQuotaRateLimitSpendCapEvidence,
  stagingSupportRetryAbuseEvidence,
  stagingLegalSupportVisibilityEvidence,
  productionAbuseThrottleHoldEvidence,
  productionActivationReviewAuditEvidence,
  productionSkillReleaseEvalCanaryEvidence,
  productionSecurityLaunchCheckEvidence,
  productionBackupRollbackIncidentEvidence,
  productionLegalSupportPolicyEvidence,
  productionProviderModeEvidence,
  productionPaidBillingLifecycleEvidence,
  adminReviewDecisions,
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
  adminRbacOverrideAttempts,
  operationalDashboards,
  operationalDashboardRuntimeEvidence,
  alertRoutes,
  alertRouteRuntimeEvidence,
  backendMetricsRuntimeEvidence,
  observabilityTelemetryRuntimeEvidence,
  stagingObservabilityBackupLoadPreflightEvidence,
  stagingObjectStorageRetentionCleanupEvidence
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
    .replaceAll(/new Set<string>/g, "new Set")
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
    .replaceAll(/function uniqueSorted<T extends string>\(values: T\[\]\)/g, "function uniqueSorted(values)")
    .replaceAll(/new Set<T>/g, "new Set")
    .replaceAll(/new Set<string>/g, "new Set")
    .replaceAll(/function expectedIdempotencyPrefix\(attempt: AdminRbacOverrideAttempt\)/g, "function expectedIdempotencyPrefix(attempt)")
    .replaceAll(/function stateDigestStatus\(\n  attempt: AdminRbacOverrideAttempt,\n  runtimeDecision: AdminRbacRuntimeDecision \| undefined\n\): AdminRbacOverrideAttemptDecision\["stateDigestStatus"\]/g, "function stateDigestStatus(attempt, runtimeDecision)")
    .replaceAll(/function overrideAttemptOutcome\(\n  attempt: AdminRbacOverrideAttempt,\n  runtimeDecision: AdminRbacRuntimeDecision \| undefined,\n  idempotencyStable: boolean,\n  digestStatus: AdminRbacOverrideAttemptDecision\["stateDigestStatus"\]\n\): AdminRbacOverrideAttemptDecision\["requestOutcome"\]/g, "function overrideAttemptOutcome(attempt, runtimeDecision, idempotencyStable, digestStatus)")
    .replaceAll(/function overrideAttemptBlockers\(\n  runtimeDecision: AdminRbacRuntimeDecision \| undefined,\n  idempotencyStable: boolean,\n  digestStatus: AdminRbacOverrideAttemptDecision\["stateDigestStatus"\],\n  expectedHttpStatusMatches: boolean\n\)/g, "function overrideAttemptBlockers(runtimeDecision, idempotencyStable, digestStatus, expectedHttpStatusMatches)")
    .replaceAll(/: AdminRbacEvidence\[\]/g, "")
    .replaceAll(/: AdminRbacOverrideAttempt\[\]/g, "")
    .replaceAll(/: AdminRbacOverrideAttemptDecision\[\]/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure\[\]/g, "")
    .replaceAll(/: AdminRbacReleaseReadinessSummary\[\]/g, "")
    .replaceAll(/: AdminRbacOverrideReleaseBundle\[\]/g, "")
    .replaceAll(/: AdminRbacRuntimeDecision\[\]/g, "")
    .replaceAll(/: AdminRbacSurfaceSummary\[\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\[\]/g, "")
    .replaceAll(/: AdminRbacEvidencePack\[\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\["closureDisposition"\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\["secondReviewCoverage"\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\["expiryCoverage"\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\["staleReplayCoverage"\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\["releaseGateStatus"\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\["roleGateCoverage"\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\["auditCoverage"\]/g, "")
    .replaceAll(/: AdminRbacClosureMatrixRow\["releaseEvidenceCoverage"\]/g, "")
    .replaceAll(/const releaseGateStatus =/g, "const releaseGateStatus =")
    .replaceAll(/const roleGateCoverage =/g, "const roleGateCoverage =")
    .replaceAll(/const auditCoverage =/g, "const auditCoverage =")
    .replaceAll(/const releaseEvidenceCoverage =/g, "const releaseEvidenceCoverage =")
    .replaceAll(/: AdminRbacEvidencePack\["releaseGateDisposition"\]/g, "")
    .replaceAll(/: AdminRbacEvidencePack\["evidenceCompleteness"\]/g, "")
    .replaceAll(/: AdminRbacEvidencePack\["expiryEnforcementStatus"\]/g, "")
    .replaceAll(/: AdminRbacEvidencePack/g, "")
    .replaceAll(/: AdminRbacOverrideAttemptDecision\["idempotencyStatus"\]/g, "")
    .replaceAll(/: AdminRbacOverrideAttemptDecision\["runtimeRequestOutcome"\]/g, "")
    .replaceAll(/: AdminRbacOverrideAttemptDecision\["releaseGateStatus"\]/g, "")
    .replaceAll(/: AdminRbacStaleReplayDecision\[\]/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure\["attemptCoverage"\]/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure\["staleReplayCoverage"\]/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure\["releaseEvidenceStatus"\]/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure\["attemptEvidenceStatus"\]/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure\["releaseMutationAttemptStatus"\]/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure\["closureStatus"\]/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure\["releaseGateStatus"\]/g, "")
    .replaceAll(/: AdminRbacReleaseReadinessSummary\["mutationMode"\]/g, "")
    .replaceAll(/: AdminRbacReleaseReadinessSummary\["readyState"\]/g, "")
    .replaceAll(/: AdminRbacReleaseReadinessSummary\["releaseGateStatus"\]/g, "")
    .replaceAll(/: AdminRbacOverrideReleaseBundle\["gateVerdict"\]/g, "")
    .replaceAll(/: AdminRbacOverrideReleaseBundle\["evidenceHealth"\]/g, "")
    .replaceAll(/: AdminRbacStaleReplayDecision\["surface"\]/g, "")
    .replaceAll(/: AdminRbacStaleReplayDecision\["staleWindowStatus"\]/g, "")
    .replaceAll(/: AdminRbacStaleReplayDecision\["releaseGateStatus"\]/g, "")
    .replaceAll(/: AdminRbacStaleReplayDecision\["staleOutcome"\]\[\]/g, "")
    .replaceAll(/: AdminRbacStaleReplayDecision\["staleOutcome"\]/g, "")
    .replaceAll(/: AdminRbacEvidence\["surface"\]/g, "")
    .replaceAll(/: AdminRbacRuntimeDecision\["surface"\]/g, "")
    .replaceAll(/new Map<AdminRbacEvidence\["surface"\], AdminRbacEvidence\[\]>/g, "new Map")
    .replaceAll(/new Map<AdminRbacRuntimeDecision\["surface"\], AdminRbacRuntimeDecision\[\]>/g, "new Map")
    .replaceAll(/new Map<AdminRbacStaleReplayDecision\["surface"\], AdminRbacStaleReplayDecision\[\]>/g, "new Map")
    .replaceAll(/new Map<AdminRbacOverrideAttemptDecision\["surface"\], AdminRbacOverrideAttemptDecision\[\]>/g, "new Map")
    .replaceAll(/new Map<string, AdminRbacRuntimeDecision>/g, "new Map")
    .replaceAll(/: AdminRbacOverrideAttemptDecision\["stateDigestStatus"\]/g, "")
    .replaceAll(/: AdminRbacOverrideAttemptDecision\["requestOutcome"\]/g, "")
    .replaceAll(/: AdminRbacOverrideAttempt/g, "")
    .replaceAll(/: AdminRbacReleaseEvidenceClosure/g, "")
    .replaceAll(/: AdminRbacEvidence/g, "")
    .replaceAll(/: AdminRbacRuntimeDecision/g, "")
    .replaceAll(/: AdminRbacEvidencePack/g, "")
    .replaceAll(/: AdminRbacReleaseReadinessSummary/g, "")
    .replaceAll(/function bundleGateVerdict\(\n  readiness: AdminRbacReleaseReadinessSummary,\n  closure: AdminRbacReleaseEvidenceClosure\n\)/g, "function bundleGateVerdict(readiness, closure)")
    .replaceAll(/export function buildAdminRbacOverrideReleaseBundles\(\n  readinessSummaries: AdminRbacReleaseReadinessSummary\[\],\n  closures: AdminRbacReleaseEvidenceClosure\[\],\n  runtimeDecisions: AdminRbacRuntimeDecision\[\]\n\)/g, "function buildAdminRbacOverrideReleaseBundles(readinessSummaries, closures, runtimeDecisions)")
    .replaceAll(/: AdminRole\[\]/g, "")
    .replaceAll(/: string\[\]/g, "")
    .replaceAll(/: string/g, "")
    .replaceAll(/: Date/g, "")
    .replaceAll(/: boolean/g, "");
  return Function(`${runtimeSource}\nreturn { buildAdminRbacRuntimeDecisions, buildAdminRbacOverrideAttemptDecisions, buildAdminRbacStaleReplayDecisions, buildAdminRbacSurfaceSummaries, buildAdminRbacEvidencePacks, buildAdminRbacClosureMatrix, buildAdminRbacReleaseEvidenceClosures, buildAdminRbacReleaseReadinessSummaries, buildAdminRbacOverrideReleaseBundles };`)();
};

const parseExportRuntime = () => {
  const runtimeSource = exportRuntimeSource
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/const roleRank: Record<AdminRole, number> =/g, "const roleRank =")
    .replaceAll(/export function (\w+)/g, "function $1")
    .replaceAll(/: ExportRegenerationRuntimeDecision\["qaGate"\]/g, "")
    .replaceAll(/: ExportRegenerationRuntimeDecision\["decision"\]/g, "")
    .replaceAll(/: ExportRegenerationRuntimeDecision\["quotaSettlement"\]/g, "")
    .replaceAll(/: ExportRegenerationRuntimeDecision\[\]/g, "")
    .replaceAll(/: ExportJob\[\]/g, "")
    .replaceAll(/: ExportJob/g, "")
    .replaceAll(/: AdminRole/g, "")
    .replaceAll(/: string\[\]/g, "")
    .replaceAll(/: string/g, "")
    .replaceAll(/ as const/g, "");
  return Function(`${runtimeSource}\nreturn { buildExportRegenerationRuntimeDecisions };`)();
};

const parseFailedTaskRuntime = () => {
  const runtimeSource = failedTaskRuntimeSource
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/export function (\w+)/g, "function $1")
    .replaceAll(/function idempotencyStatus\(task: FailedTaskControl\): FailedTaskRuntimeDecision\["idempotencyStatus"\]/g, "function idempotencyStatus(task)")
    .replaceAll(/function stateDigestStatus\(task: FailedTaskControl\): FailedTaskRuntimeDecision\["stateDigestStatus"\]/g, "function stateDigestStatus(task)")
    .replaceAll(/function supportTicketLinkageStatus\(\n  task: FailedTaskControl,\n  ticket: SupportTicket \| undefined\n\): FailedTaskRuntimeDecision\["supportTicketLinkageStatus"\]/g, "function supportTicketLinkageStatus(task, ticket)")
    .replaceAll(/function tenantScopeStatus\(\n  task: FailedTaskControl,\n  ticket: SupportTicket \| undefined\n\): FailedTaskRuntimeDecision\["tenantScopeStatus"\]/g, "function tenantScopeStatus(task, ticket)")
    .replaceAll(/function traceLinkageStatus\(\n  task: FailedTaskControl,\n  ticket: SupportTicket \| undefined\n\): FailedTaskRuntimeDecision\["traceLinkageStatus"\]/g, "function traceLinkageStatus(task, ticket)")
    .replaceAll(/function stateTransition\(\n  task: FailedTaskControl,\n  submitDecision: FailedTaskRuntimeDecision\["submitDecision"\]\n\): FailedTaskRuntimeDecision\["stateTransition"\]/g, "function stateTransition(task, submitDecision)")
    .replaceAll(/function closureOutcome\(\n  task: FailedTaskControl,\n  submitDecision: FailedTaskRuntimeDecision\["submitDecision"\]\n\): FailedTaskRuntimeDecision\["closureOutcome"\]/g, "function closureOutcome(task, submitDecision)")
    .replaceAll(/function releaseGateDisposition\(\n  task: FailedTaskControl,\n  submitDecision: FailedTaskRuntimeDecision\["submitDecision"\]\n\): FailedTaskRuntimeDecision\["releaseGateDisposition"\]/g, "function releaseGateDisposition(task, submitDecision)")
    .replaceAll(/: FailedTaskRuntimeDecision\[\]/g, "")
    .replaceAll(/: FailedTaskControl\[\]/g, "")
    .replaceAll(/: string\[\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["retryBudgetStatus"\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["closureEvidenceStatus"\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["userMessageStatus"\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["idempotencyStatus"\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["stateDigestStatus"\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["submitDecision"\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["supportTicketLinkageStatus"\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["tenantScopeStatus"\]/g, "")
    .replaceAll(/: FailedTaskRuntimeDecision\["traceLinkageStatus"\]/g, "")
    .replaceAll(/const roleRank: Record<FailedTaskControl\["requestedByRole"\], number> =/g, "const roleRank =")
    .replaceAll(/: SupportTicket\[\]/g, "")
    .replaceAll(/: SupportTicket \| undefined/g, "")
    .replaceAll(/new Map<string, SupportTicket>/g, "new Map")
    .replaceAll(/: string/g, "");
  return Function(`${runtimeSource}\nreturn { buildFailedTaskRuntimeDecisions };`)();
};

const parseRegressionFixtureRuntime = () => {
  const runtimeSource = regressionFixtureRuntimeSource
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replace(/type RegressionFixtureRuntimeInput = [\s\S]*?;\n\n/, "")
    .replaceAll(/export function (\w+)/g, "function $1")
    .replaceAll(/function highRiskGateStatus\(fixture: RegressionFixture\): RegressionFixtureRuntimeSummary\["highRiskGateStatus"\]/g, "function highRiskGateStatus(fixture)")
    .replaceAll(/function releaseGateDisposition\(\n  fixture: RegressionFixture,\n  blockerCodes: string\[\]\n\): RegressionFixtureRuntimeSummary\["releaseGateDisposition"\]/g, "function releaseGateDisposition(fixture, blockerCodes)")
    .replaceAll(/}: RegressionFixtureRuntimeInput\)/g, "})")
    .replaceAll(/: string\[\]/g, "")
    .replaceAll(/: RegressionFixtureRuntimeSummary\[\]/g, "");
  return Function(`${runtimeSource}\nreturn { buildRegressionFixtureRuntimeSummaries };`)();
};

const parseCrawlerRuntime = () => {
  const runtimeSource = crawlerRuntimeSource
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/export function (\w+)/g, "function $1")
    .replaceAll(/function isConcreteRequiredEvidence\(ref: string\)/g, "function isConcreteRequiredEvidence(ref)")
    .replaceAll(/: CrawlerGovernanceRuntimeDecision\[\]/g, "")
    .replaceAll(/: CrawlerGovernanceClosureSummary\[\]/g, "")
    .replaceAll(/: CrawlerGovernanceClosureSummary\["releaseClosureState"\]/g, "")
    .replaceAll(/: CrawlerGovernanceClosureSummary\["activationSafetyState"\]/g, "")
    .replaceAll(/: CrawlerGovernanceClosureSummary\["secondReviewGate"\]/g, "")
    .replaceAll(/: CrawlerGovernanceClosureSummary\["takedownDeleteStatus"\]/g, "")
    .replaceAll(/: CrawlerGovernanceClosureSummary\["releaseGateDisposition"\]/g, "")
    .replaceAll(/: CrawlerGovernanceWorkflow\[\]/g, "")
    .replaceAll(/: CrawlerGovernanceWorkflow\["requestType"\]/g, "")
    .replaceAll(/: CrawlerGovernanceRuntimeDecision\["escalationEvidenceStatus"\]/g, "")
    .replaceAll(/new Set<string>/g, "new Set")
    .replaceAll(/: string\[\]/g, "")
    .replaceAll(/: string \| undefined/g, "")
    .replaceAll(/: string/g, "")
    .replaceAll(/: Date/g, "")
    .replaceAll(/ as const/g, "");
  return Function(`${runtimeSource}\nreturn { buildCrawlerGovernanceRuntimeDecisions, buildCrawlerGovernanceClosureSummaries };`)();
};

const parseObjectStorageRuntime = () => {
  const runtimeSource = objectStorageRuntimeSource
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/type [\s\S]*?;\n\n/g, "")
    .replaceAll(/const endpointByArea: Record<StagingObjectStorageRetentionCleanupCoverage\["area"\], string> =/g, "const endpointByArea =")
    .replaceAll(/function isRequiredArea\(area: string \| undefined\): area is StagingObjectStorageRetentionCleanupCoverage\["area"\]/g, "function isRequiredArea(area)")
    .replaceAll(/function reportIsPassing\(report: RetentionCleanupReport\)/g, "function reportIsPassing(report)")
    .replaceAll(/function reportKind\(report: RetentionCleanupReport, passable: boolean\)/g, "function reportKind(report, passable)")
    .replaceAll(/function observedReportPath\(report: RetentionCleanupReport, passable: boolean\)/g, "function observedReportPath(report, passable)")
    .replaceAll(/function buildCoverageFromReport\(\n  base: StagingObjectStorageRetentionCleanupEvidence,\n  report: RetentionCleanupReport,\n  passable: boolean\n\): StagingObjectStorageRetentionCleanupCoverage\[\]/g, "function buildCoverageFromReport(base, report, passable)")
    .replaceAll(/export function buildStagingObjectStorageRetentionCleanupEvidence\(\n  base: StagingObjectStorageRetentionCleanupEvidence,\n  report\?: RetentionCleanupReport \| null\n\): StagingObjectStorageRetentionCleanupEvidence/g, "function buildStagingObjectStorageRetentionCleanupEvidence(base, report)")
    .replaceAll(/ as StagingObjectStorageRetentionCleanupCoverage\["area"\]/g, "");
  return Function(`${runtimeSource}\nreturn { buildStagingObjectStorageRetentionCleanupEvidence };`)();
};

const auditIds = new Set(auditEvents.map((event) => event.id));
const supportTicketIds = new Set(supportTickets.map((ticket) => ticket.id));
const supportTicketById = new Map(supportTickets.map((ticket) => [ticket.id, ticket]));
const supportUserIds = new Set(supportUsers.map((user) => user.id));
const traceIds = new Set(traces.map((trace) => trace.id));
const exportIds = new Set(exportJobs.map((job) => job.id));
const riskyExportIds = new Set(riskyExports.map((entry) => entry.id));
const adminReviewDecisionIds = new Set(adminReviewDecisions.map((entry) => entry.id));
const quotaUserIds = new Set(quotaAccounts.map((account) => account.userId));
const queueIds = new Set(queueHealth.map((queue) => queue.id));
const taskIds = new Set(failedTaskControls.map((task) => task.id));
const adminRbacEvidenceById = new Map(adminRbacEvidence.map((item) => [item.id, item]));
const adminRbacEvidenceIds = new Set(adminRbacEvidence.map((item) => item.id));
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
const stagingEvalQaSafetyPath = new URL(
  "../../ops/evidence/staging/20260527T1900Z-eval-qa-safety.json",
  import.meta.url
);
const stagingQuotaRateLimitSpendCapPath = new URL(
  "../../ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
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
const stagingObservabilityTelemetryPath = new URL(
  "../../ops/evidence/staging/20260527T1815Z-observability-telemetry.json",
  import.meta.url
);
const stagingObservabilityBackupLoadPreflightPath = new URL(
  "../../ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
  import.meta.url
);
const stagingObjectStorageRetentionCleanupBlockedPath = new URL(
  "../../ops/evidence/staging/object-storage-retention-cleanup.blocked.json",
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
const productionSkillReleaseEvalCanaryPath = new URL(
  "../../ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
  import.meta.url
);
const productionSecurityLaunchCheckPath = new URL(
  "../../ops/evidence/production/20260527T1700Z-security-launch-checks.json",
  import.meta.url
);
const productionBackupRollbackIncidentPath = new URL(
  "../../ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
  import.meta.url
);
const productionPublicLegalPolicyPath = new URL(
  "../../ops/evidence/production/public-legal-policy.json",
  import.meta.url
);
const productionPublicSupportBillingPolicyPath = new URL(
  "../../ops/evidence/production/public-support-billing-policy.json",
  import.meta.url
);
const productionProviderModePath = new URL(
  "../../ops/evidence/production/provider-mode.json",
  import.meta.url
);
const productionPublicPaidRealGenerationClaimsPath = new URL(
  "../../ops/evidence/production/public-paid-real-generation-claims.json",
  import.meta.url
);
const productionBillingLifecyclePath = new URL(
  "../../ops/evidence/production/billing-lifecycle.json",
  import.meta.url
);
const productionBillingRefundCreditWebhookPath = new URL(
  "../../ops/evidence/production/billing-refund-credit-webhook.json",
  import.meta.url
);

const roleOrder = new Map([
  ["support_operator", 1],
  ["admin_viewer", 1],
  ["admin_operator", 2],
  ["admin_reviewer", 3],
  ["admin_superadmin", 4]
]);
const { buildFailedTaskRuntimeDecisions } = parseFailedTaskRuntime();
const { buildRegressionFixtureRuntimeSummaries } = parseRegressionFixtureRuntime();
const { buildCrawlerGovernanceRuntimeDecisions, buildCrawlerGovernanceClosureSummaries } = parseCrawlerRuntime();
const { buildStagingObjectStorageRetentionCleanupEvidence } = parseObjectStorageRuntime();

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
    assert.match(entry.releaseEvidenceStatus, /complete|missing/, `${entry.abuseEventId} needs release evidence status`);
    assert.ok(Array.isArray(entry.missingReleaseEvidenceRefs), `${entry.abuseEventId} needs missing release evidence refs`);
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

  const missingReleaseEvidenceQueue = buildAbuseQueueRuntime(abuseEvents, [
    {
      ...decisions.find((decision) => decision.hookId === "hook-ab-300-hold"),
      evidenceRefs: ["ab-300", "au-002"],
      releaseEvidenceRefs: ["sup-2201", "au-004", "ex-887", "tr-1004"]
    }
  ]);
  const blockedEntry = missingReleaseEvidenceQueue.find((entry) => entry.abuseEventId === "ab-300");
  assert.ok(blockedEntry, "missing release evidence replay needs queue entry");
  assert.equal(blockedEntry.releaseEvidenceStatus, "missing");
  assert.deepEqual(blockedEntry.missingReleaseEvidenceRefs, ["sup-2201", "au-004", "ex-887", "tr-1004"]);
  assert.match(blockedEntry.blockingReason, /release evidence refs/, "missing release evidence must block queue closure");
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
    ...exportJobs.map((job) => job.id),
    ...failedTaskControls.map((task) => task.id)
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
  assert.ok(
    regressionFixtures.some((fixture) => fixture.sourceKind === "failed_task"),
    "failed task retry/cancel bad samples must be represented as regression fixtures"
  );
  assert.ok(
    regressionFixtures.some(
      (fixture) =>
        fixture.failureMode === "safety_policy_miss" &&
        fixture.sourceKind === "admin_bad_sample" &&
        fixture.requiredGate === "prompt_activation" &&
        fixture.status === "eval_blocking"
    ),
    "safety policy misses must become prompt-activation-blocking regression fixtures"
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

  const crawlerTakedownRegression = regressionFixtures.find((fixture) => fixture.failureMode === "crawler_takedown_activation");
  assert.ok(crawlerTakedownRegression, "crawler takedown bad samples need an activation-blocking regression fixture");
  assert.equal(crawlerTakedownRegression.status, "eval_blocking");
  assert.equal(crawlerTakedownRegression.sourceFeedbackId, "sup-2212");
  assert.equal(crawlerTakedownRegression.linkedAuditRef, "au-012");

  const crawlerTakedownFixture = JSON.parse(
    readFileSync(new URL(crawlerTakedownRegression.fixturePath, repoRoot), "utf8")
  );
  assert.equal(crawlerTakedownFixture.failure_mode, "crawler_takedown_activation");
  assert.equal(crawlerTakedownFixture.bad_sample.governance_workflow_id, "cg-501");
  assert.equal(crawlerTakedownFixture.bad_sample.finding_id, "cf-118");
  assert.equal(crawlerTakedownFixture.bad_sample.source_approval_id, "csa-021");
  assert.ok(
    crawlerTakedownFixture.expected_assertions.includes("activation_gate_decision == blocked"),
    "crawler takedown regression must assert activation remains blocked"
  );
  assert.ok(
    crawlerTakedownFixture.expected_assertions.includes("raw_and_derivative_delete_evidence_present == true"),
    "crawler takedown regression must require deletion evidence"
  );
  assert.ok(
    crawlerTakedownFixture.expected_assertions.includes("requester_notice_evidence_present == true"),
    "crawler takedown regression must require requester notice evidence"
  );
  assert.ok(
    crawlerTakedownFixture.expected_assertions.includes("pending_placeholder_refs_do_not_satisfy_required_evidence == true"),
    "crawler takedown regression must reject pending placeholder refs as required evidence"
  );
  assert.ok(
    crawlerTakedownFixture.expected_assertions.includes("second_review_completed_before_activation == true"),
    "crawler takedown regression must require second review before activation"
  );
  assert.equal(crawlerTakedownFixture.release_block.audit_ref, "au-012");

  const takedownWorkflow = crawlerGovernanceWorkflows.find((workflow) => workflow.id === crawlerTakedownFixture.bad_sample.governance_workflow_id);
  const blockedSourceApproval = crawlerSourceApprovals.find((approval) => approval.id === crawlerTakedownFixture.bad_sample.source_approval_id);
  assert.ok(takedownWorkflow, "crawler takedown regression links unknown governance workflow");
  assert.ok(blockedSourceApproval, "crawler takedown regression links unknown source approval");
  assert.equal(takedownWorkflow.findingId, crawlerTakedownFixture.bad_sample.finding_id);
  assert.equal(blockedSourceApproval.linkedFindingId, crawlerTakedownFixture.bad_sample.finding_id);
  assert.equal(takedownWorkflow.requestType, "source_takedown");
  assert.equal(takedownWorkflow.activationGateDecision, "blocked");
  assert.equal(takedownWorkflow.rawRetentionAction, "delete_raw_and_derivatives");
  assert.equal(takedownWorkflow.secondReviewRequired, true);
  assert.notEqual(takedownWorkflow.requesterNoticeRef, "pending");
  assert.notEqual(takedownWorkflow.deletionEvidenceRef, "pending");
  assert.equal(blockedSourceApproval.activationGate, "blocked");

  const crawlerDerivativeRegression = regressionFixtures.find((fixture) => fixture.failureMode === "crawler_derivative_review");
  assert.ok(crawlerDerivativeRegression, "crawler derivative review bad samples need an activation-guard regression fixture");
  assert.equal(crawlerDerivativeRegression.status, "eval_blocking");
  assert.equal(crawlerDerivativeRegression.sourceFeedbackId, "sup-2212");
  assert.equal(crawlerDerivativeRegression.linkedAuditRef, "au-013");

  const crawlerDerivativeFixture = JSON.parse(
    readFileSync(new URL(crawlerDerivativeRegression.fixturePath, repoRoot), "utf8")
  );
  assert.equal(crawlerDerivativeFixture.failure_mode, "crawler_derivative_review");
  assert.equal(crawlerDerivativeFixture.bad_sample.governance_workflow_id, "cg-522");
  assert.equal(crawlerDerivativeFixture.bad_sample.finding_id, "cf-122");
  assert.equal(crawlerDerivativeFixture.bad_sample.source_approval_id, "csa-019");
  assert.ok(
    crawlerDerivativeFixture.expected_assertions.includes("activation_gate_decision == allowed_only_with_provenance"),
    "crawler derivative regression must assert activation is allowed only with provenance"
  );
  assert.ok(
    crawlerDerivativeFixture.expected_assertions.includes("bounded_raw_retention_days <= 14"),
    "crawler derivative regression must assert bounded raw retention"
  );
  assert.ok(
    crawlerDerivativeFixture.expected_assertions.includes("requester_notice_evidence_present == true"),
    "crawler derivative regression must require requester notice evidence"
  );
  assert.ok(
    crawlerDerivativeFixture.expected_assertions.includes("exact_text_import_blocked == true"),
    "crawler derivative regression must assert exact text import stays blocked"
  );
  assert.equal(crawlerDerivativeFixture.release_block.audit_ref, "au-013");

  const derivativeWorkflow = crawlerGovernanceWorkflows.find((workflow) => workflow.id === crawlerDerivativeFixture.bad_sample.governance_workflow_id);
  const approvedSourceApproval = crawlerSourceApprovals.find((approval) => approval.id === crawlerDerivativeFixture.bad_sample.source_approval_id);
  assert.ok(derivativeWorkflow, "crawler derivative regression links unknown governance workflow");
  assert.ok(approvedSourceApproval, "crawler derivative regression links unknown source approval");
  assert.equal(derivativeWorkflow.findingId, crawlerDerivativeFixture.bad_sample.finding_id);
  assert.equal(approvedSourceApproval.linkedFindingId, crawlerDerivativeFixture.bad_sample.finding_id);
  assert.equal(derivativeWorkflow.requestType, "derivative_review");
  assert.equal(derivativeWorkflow.derivativeUseStatus, "allowed");
  assert.equal(derivativeWorkflow.activationGateDecision, "allowed");
  assert.equal(derivativeWorkflow.rawRetentionAction, "retain_with_limit");
  assert.equal(approvedSourceApproval.status, "approved");
  assert.equal(approvedSourceApproval.activationGate, "allowed");
  assert.match(approvedSourceApproval.exactTextPolicy, /stripped|violation routes/i);

  const safetyPolicyRegression = regressionFixtures.find(
    (fixture) => fixture.failureMode === "safety_policy_miss"
  );
  assert.ok(safetyPolicyRegression, "safety policy miss bad samples need a prompt-activation regression fixture");
  assert.equal(safetyPolicyRegression.status, "eval_blocking");
  assert.equal(safetyPolicyRegression.requiredGate, "prompt_activation");
  assert.equal(safetyPolicyRegression.sourceFeedbackId, "fb-222");
  assert.equal(safetyPolicyRegression.linkedAuditRef, "au-006");

  const safetyPolicyFixture = JSON.parse(
    readFileSync(new URL(safetyPolicyRegression.fixturePath, repoRoot), "utf8")
  );
  const safetyFeedback = feedbackItems.find((item) => item.id === safetyPolicyRegression.sourceFeedbackId);
  const safetyRbac = adminRbacEvidence.find((item) => item.id === safetyPolicyFixture.release_block.rbac_evidence);
  assert.ok(safetyFeedback, "safety policy regression links unknown feedback");
  assert.ok(safetyRbac, "safety policy regression links unknown RBAC evidence");
  assert.equal(safetyPolicyFixture.failure_mode, "safety_policy_miss");
  assert.equal(safetyPolicyFixture.gate, "prompt_activation");
  assert.equal(safetyPolicyFixture.bad_sample.feedback_id, "fb-222");
  assert.equal(safetyPolicyFixture.bad_sample.abuse_event_id, "ab-304");
  assert.equal(safetyPolicyFixture.bad_sample.prompt_fragment_id, "pf-044");
  assert.equal(safetyPolicyFixture.release_block.audit_ref, "au-006");
  assert.equal(safetyPolicyFixture.release_block.rbac_evidence, "rbac-safety-001");
  assert.equal(safetyFeedback.filterDecision, "discard");
  assert.equal(safetyFeedback.weight, 0);
  assert.equal(safetyFeedback.regressionFixtureRef, safetyPolicyRegression.fixturePath);
  assert.equal(safetyRbac.surface, "safety_rule");
  assert.equal(safetyRbac.requiredRole, "admin_superadmin");
  assert.equal(safetyRbac.enforcementPoint, "safety_policy");
  assert.ok(
    safetyPolicyFixture.expected_assertions.includes("discarded_feedback_learning_weight == 0"),
    "safety policy regression must assert discarded feedback cannot train"
  );
  assert.ok(
    safetyPolicyFixture.expected_assertions.includes("prompt_activation_gate_decision == blocked"),
    "safety policy regression must assert prompt activation stays blocked"
  );
  assert.ok(
    safetyPolicyFixture.expected_assertions.includes("provider_request_not_created == true"),
    "safety policy regression must assert provider task creation is blocked"
  );

  for (const item of feedbackItems) {
    if (item.regressionFixtureRef.startsWith("fixtures/")) {
      assert.ok(
        fixturePaths.has(item.regressionFixtureRef),
        `${item.id} points at missing regression fixture inventory entry`
      );
    }
  }
});

test("admin regression fixture runtime summaries gate bad-sample release use", () => {
  const summaries = buildRegressionFixtureRuntimeSummaries({
    fixtures: regressionFixtures,
    feedbackItems,
    supportTickets,
    exportJobs,
    failedTaskControls,
    skillCanaryMetrics,
    auditEvents
  });
  assert.equal(summaries.length, regressionFixtures.length, "each regression fixture needs one runtime summary");

  const summaryByFixture = new Map(summaries.map((summary) => [summary.fixtureId, summary]));
  const brandSummary = summaryByFixture.get("reg-brand-similarity-fb-203");
  const exportRetrySummary = summaryByFixture.get("reg-failed-task-retry-task-export-489");
  const exportManifestSummary = summaryByFixture.get("reg-export-manifest-sup-2204");
  const crawlerCancelSummary = summaryByFixture.get("reg-failed-task-cancel-task-crawler-019");
  const safetySummary = summaryByFixture.get("reg-safety-policy-miss-fb-222");
  assert.ok(brandSummary, "brand bad-sample summary is missing");
  assert.ok(exportRetrySummary, "failed task retry summary is missing");
  assert.ok(exportManifestSummary, "support export manifest summary is missing");
  assert.ok(crawlerCancelSummary, "crawler cancel summary is missing");
  assert.ok(safetySummary, "safety policy bad-sample summary is missing");

  for (const summary of summaries) {
    assert.equal(summary.sourceLinkStatus, "linked", `${summary.fixtureId} needs linked source evidence`);
    assert.equal(summary.fixturePathStatus, "declared", `${summary.fixtureId} needs a declared regression fixture path`);
    assert.equal(summary.canaryMetricStatus, "linked", `${summary.fixtureId} needs linked canary metric evidence`);
    assert.equal(summary.auditStatus, "attached", `${summary.fixtureId} needs attached immutable audit evidence`);
    assert.ok(summary.operatorAction.length > 80, `${summary.fixtureId} needs concrete operator action`);
    assert.notEqual(summary.releaseGateDisposition, "candidate_only", `${summary.fixtureId} cannot be candidate-only after conversion`);

    if (summary.severity === "high" || summary.severity === "critical") {
      assert.equal(
        summary.highRiskGateStatus,
        "blocks_pre_production",
        `${summary.fixtureId} high-risk fixture must block before production launch`
      );
    }
  }

  assert.equal(brandSummary.releaseGateDisposition, "release_blocking");
  assert.equal(brandSummary.status, "eval_blocking");
  assert.equal(safetySummary.releaseGateDisposition, "release_blocking");
  assert.equal(safetySummary.requiredGate, "prompt_activation");
  assert.equal(crawlerCancelSummary.releaseGateDisposition, "release_blocking");
  assert.equal(crawlerCancelSummary.status, "eval_blocking");
  assert.equal(exportRetrySummary.releaseGateDisposition, "gate_ready");
  assert.equal(exportManifestSummary.releaseGateDisposition, "gate_ready");

  const missingAudit = buildRegressionFixtureRuntimeSummaries({
    fixtures: [
      {
        ...regressionFixtures.find((fixture) => fixture.id === "reg-failed-task-retry-task-export-489"),
        linkedAuditRef: "au-missing"
      }
    ],
    feedbackItems,
    supportTickets,
    exportJobs,
    failedTaskControls,
    skillCanaryMetrics,
    auditEvents
  })[0];
  assert.equal(missingAudit.auditStatus, "missing_audit");
  assert.equal(missingAudit.releaseGateDisposition, "release_blocking");
  assert.ok(missingAudit.blockerCodes.includes("missing_audit_ref"));

  const missingSource = buildRegressionFixtureRuntimeSummaries({
    fixtures: [
      {
        ...regressionFixtures.find((fixture) => fixture.id === "reg-export-manifest-sup-2204"),
        sourceFeedbackId: "sup-missing"
      }
    ],
    feedbackItems,
    supportTickets,
    exportJobs,
    failedTaskControls,
    skillCanaryMetrics,
    auditEvents
  })[0];
  assert.equal(missingSource.sourceLinkStatus, "missing_source");
  assert.equal(missingSource.releaseGateDisposition, "release_blocking");
  assert.ok(missingSource.blockerCodes.includes("missing_source_link"));

  const lateHighRiskGate = buildRegressionFixtureRuntimeSummaries({
    fixtures: [
      {
        ...regressionFixtures.find((fixture) => fixture.id === "reg-brand-similarity-fb-203"),
        requiredGate: "production_launch"
      }
    ],
    feedbackItems,
    supportTickets,
    exportJobs,
    failedTaskControls,
    skillCanaryMetrics,
    auditEvents
  })[0];
  assert.equal(lateHighRiskGate.highRiskGateStatus, "late_gate");
  assert.equal(lateHighRiskGate.releaseGateDisposition, "release_blocking");
  assert.ok(lateHighRiskGate.blockerCodes.includes("high_risk_fixture_blocks_too_late"));

  const invalidFixturePath = buildRegressionFixtureRuntimeSummaries({
    fixtures: [
      {
        ...regressionFixtures.find((fixture) => fixture.id === "reg-mobile-readability-fb-211"),
        fixturePath: "Docs/not-a-regression.json"
      }
    ],
    feedbackItems,
    supportTickets,
    exportJobs,
    failedTaskControls,
    skillCanaryMetrics,
    auditEvents
  })[0];
  assert.equal(invalidFixturePath.fixturePathStatus, "invalid_path");
  assert.equal(invalidFixturePath.releaseGateDisposition, "release_blocking");
  assert.ok(invalidFixturePath.blockerCodes.includes("invalid_fixture_path"));
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
  const fixturePaths = new Set(regressionFixtures.map((fixture) => fixture.fixturePath));

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
    assert.match(task.preActionStateDigest, /^sha256:[a-z0-9-]+$/, `${task.id} needs pre-action state digest`);
    assert.match(task.observedStateDigest, /^sha256:[a-z0-9-]+$/, `${task.id} needs observed state digest`);
    assert.equal(task.preActionStateDigest, task.observedStateDigest, `${task.id} fixture must not start as stale replay evidence`);
    assert.ok(roleOrder.has(task.requestedByRole), `${task.id} needs requesting role`);
    assert.ok(task.idempotencyKey.startsWith(`${task.requestedAction}:${task.id}:`), `${task.id} needs stable action/task idempotency key`);
    assert.ok(task.regressionFixtureRef.length > 10, `${task.id} needs explicit regression fixture state`);
    assert.ok(task.closureEvidenceRefs.length >= 4, `${task.id} needs closure evidence refs`);
    assert.ok(task.rbacEvidenceRefs.length > 0, `${task.id} needs admin RBAC evidence refs`);
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

    for (const ref of task.rbacEvidenceRefs) {
      const rbac = adminRbacEvidenceById.get(ref);
      assert.ok(rbac, `${task.id} links unknown RBAC evidence ref ${ref}`);
      assert.ok(auditIds.has(rbac.auditRef), `${task.id} RBAC evidence ${ref} links unknown audit ${rbac.auditRef}`);
      assert.match(rbac.apiScope, /\/api\/admin\//, `${task.id} RBAC evidence ${ref} must cover an admin API scope`);
      assert.ok(
        task.closureEvidenceRefs.includes(rbac.auditRef) || task.auditRef === rbac.auditRef,
        `${task.id} RBAC evidence ${ref} audit must be part of task closure or submit audit`
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
      assert.ok(
        task.rbacEvidenceRefs.some((ref) => adminRbacEvidenceById.get(ref)?.surface === "export_override"),
        `${task.id} retry must cite export override RBAC evidence`
      );
      assert.ok(
        task.rbacEvidenceRefs.some((ref) => adminRbacEvidenceById.get(ref)?.surface === "quota_override"),
        `${task.id} retry must cite quota override RBAC evidence`
      );
      assert.match(
        task.idempotencyKey,
        new RegExp(`^retry:${task.id}:${task.supportTicketId}:[a-z0-9-]+$`),
        `${task.id} retry needs an action-scoped idempotency key`
      );
      assert.ok(fixturePaths.has(task.regressionFixtureRef), `${task.id} retry must link a converted regression fixture`);
    }

    if (task.requestedAction === "cancel") {
      assert.notEqual(task.actionEligibility, "blocked", `${task.id} cancel must remain actionable`);
      assert.match(task.rbacDecision, /allowed|second_review_required/, `${task.id} cancel needs RBAC path`);
      assert.ok(
        task.rbacEvidenceRefs.some((ref) => adminRbacEvidenceById.get(ref)?.surface === "crawler_import"),
        `${task.id} cancel must cite crawler import RBAC evidence`
      );
      assert.match(
        task.idempotencyKey,
        new RegExp(`^cancel:${task.id}:${task.supportTicketId}:[a-z0-9-]+$`),
        `${task.id} cancel needs an action-scoped idempotency key`
      );
      assert.ok(fixturePaths.has(task.regressionFixtureRef), `${task.id} cancel must link a converted regression fixture`);
    }

    if (task.requestedAction === "hold") {
      assert.equal(task.allowedRole, "admin_reviewer", `${task.id} hold needs reviewer role`);
      assert.notEqual(task.rbacDecision, "allowed", `${task.id} blocked hold cannot be allowed`);
      assert.ok(
        task.rbacEvidenceRefs.some((ref) => adminRbacEvidenceById.get(ref)?.surface === "safety_rule"),
        `${task.id} hold must cite safety rule RBAC evidence`
      );
    }
  }
});

test("failed task retry and cancel samples are durable regression fixtures", () => {
  const decisionsByTask = new Map(
    buildFailedTaskRuntimeDecisions(failedTaskControls, supportTickets).map((decision) => [decision.taskId, decision])
  );

  const retryTask = failedTaskControls.find((task) => task.id === "task-export-489");
  const cancelTask = failedTaskControls.find((task) => task.id === "task-crawler-019");
  assert.ok(retryTask, "retry task fixture is missing");
  assert.ok(cancelTask, "cancel task fixture is missing");

  const retryRegression = regressionFixtures.find((fixture) => fixture.sourceFeedbackId === retryTask.id);
  const cancelRegression = regressionFixtures.find((fixture) => fixture.sourceFeedbackId === cancelTask.id);
  assert.ok(retryRegression, "failed export retry must have a regression fixture inventory entry");
  assert.ok(cancelRegression, "crawler cancel must have a regression fixture inventory entry");

  assert.equal(retryTask.regressionFixtureRef, retryRegression.fixturePath);
  assert.equal(cancelTask.regressionFixtureRef, cancelRegression.fixturePath);
  assert.equal(retryRegression.sourceKind, "failed_task");
  assert.equal(cancelRegression.sourceKind, "failed_task");
  assert.equal(retryRegression.failureMode, "failed_task_retry_cancel");
  assert.equal(cancelRegression.failureMode, "failed_task_retry_cancel");
  assert.equal(cancelRegression.status, "eval_blocking", "crawler cancel regression must block canary activation");

  const retryFixture = JSON.parse(readFileSync(new URL(retryRegression.fixturePath, repoRoot), "utf8"));
  const cancelFixture = JSON.parse(readFileSync(new URL(cancelRegression.fixturePath, repoRoot), "utf8"));
  const retryDecision = decisionsByTask.get(retryTask.id);
  const cancelDecision = decisionsByTask.get(cancelTask.id);

  assert.equal(retryFixture.source_kind, "failed_task");
  assert.equal(cancelFixture.source_kind, "failed_task");
  assert.equal(retryFixture.bad_sample.task_id, retryTask.id);
  assert.equal(cancelFixture.bad_sample.task_id, cancelTask.id);
  assert.equal(retryFixture.bad_sample.support_ticket_id, retryTask.supportTicketId);
  assert.equal(cancelFixture.bad_sample.support_ticket_id, cancelTask.supportTicketId);
  assert.equal(retryFixture.bad_sample.idempotency_key, retryTask.idempotencyKey);
  assert.equal(cancelFixture.bad_sample.idempotency_key, cancelTask.idempotencyKey);
  assert.equal(retryFixture.bad_sample.quota_effect, retryTask.quotaEffect);
  assert.equal(cancelFixture.bad_sample.quota_effect, cancelTask.quotaEffect);
  assert.equal(retryDecision.submitDecision, "submit_ready");
  assert.equal(cancelDecision.submitDecision, "review_required");
  assert.equal(retryFixture.runtime_contract.submit_decision, retryDecision.submitDecision);
  assert.equal(cancelFixture.runtime_contract.submit_decision, cancelDecision.submitDecision);
  assert.equal(retryDecision.stateTransition, retryFixture.runtime_contract.state_transition);
  assert.equal(cancelDecision.stateTransition, cancelFixture.runtime_contract.state_transition);
  assert.equal(retryDecision.closureOutcome, retryFixture.runtime_contract.closure_outcome);
  assert.equal(cancelDecision.closureOutcome, cancelFixture.runtime_contract.closure_outcome);
  assert.equal(retryDecision.releaseGateDisposition, retryFixture.runtime_contract.release_gate_disposition);
  assert.equal(cancelDecision.releaseGateDisposition, cancelFixture.runtime_contract.release_gate_disposition);
  assert.equal(retryDecision.apiOutcome, retryFixture.runtime_contract.api_outcome);
  assert.equal(cancelDecision.apiOutcome, cancelFixture.runtime_contract.api_outcome);
  assert.equal(retryDecision.quotaLedgerEffect, retryFixture.runtime_contract.quota_ledger_effect);
  assert.equal(cancelDecision.quotaLedgerEffect, cancelFixture.runtime_contract.quota_ledger_effect);
  assert.equal(retryDecision.supportNoticeStatus, retryFixture.runtime_contract.support_notice_status);
  assert.equal(cancelDecision.supportNoticeStatus, cancelFixture.runtime_contract.support_notice_status);
  assert.equal(retryDecision.auditWritePolicy, retryFixture.runtime_contract.audit_write_policy);
  assert.equal(cancelDecision.auditWritePolicy, cancelFixture.runtime_contract.audit_write_policy);
  assert.equal(retryDecision.regressionGateEffect, retryFixture.runtime_contract.regression_gate_effect);
  assert.equal(cancelDecision.regressionGateEffect, cancelFixture.runtime_contract.regression_gate_effect);

  assert.ok(
    retryFixture.expected_assertions.includes("action_scoped_idempotency_key == true"),
    "retry regression must assert action-scoped idempotency"
  );
  assert.ok(
    retryFixture.expected_assertions.includes("idempotency_key_reused == true"),
    "retry regression must assert idempotency reuse"
  );
  assert.ok(
    retryFixture.expected_assertions.includes("reserved_credit_released_exactly_once == true"),
    "retry regression must assert one-time quota settlement"
  );
  assert.ok(
    retryFixture.expected_assertions.includes("manifest_and_qa_report_evidence_present == true"),
    "retry regression must assert manifest and QA evidence"
  );
  assert.ok(
    cancelFixture.expected_assertions.includes("action_scoped_idempotency_key == true"),
    "cancel regression must assert action-scoped idempotency"
  );
  assert.ok(
    cancelFixture.expected_assertions.includes("second_review_required_before_cancel_closure == true"),
    "cancel regression must assert second review"
  );
  assert.ok(
    cancelFixture.expected_assertions.includes("crawler_derived_activation_blocked == true"),
    "cancel regression must assert crawler activation block"
  );
  assert.equal(retryFixture.release_block.audit_ref, retryTask.auditRef);
  assert.equal(cancelFixture.release_block.audit_ref, cancelTask.auditRef);
});

test("failed task runtime submit gates preserve retry, cancel, hold, RBAC, and audit outcomes", () => {
  const decisions = buildFailedTaskRuntimeDecisions(failedTaskControls, supportTickets);
  const decisionsByTask = new Map(decisions.map((decision) => [decision.taskId, decision]));

  assert.equal(decisions.length, failedTaskControls.length, "each failed task needs one runtime decision");
  assert.equal(decisionsByTask.get("task-export-489").submitDecision, "submit_ready", "eligible retry should be submittable");
  assert.equal(decisionsByTask.get("task-crawler-019").submitDecision, "review_required", "crawler cancel should require second review");
  assert.equal(decisionsByTask.get("task-brief-441").submitDecision, "blocked", "safety hold should stay blocked");
  assert.equal(
    decisionsByTask.get("task-export-489").stateTransition,
    "failed_to_retrying_after_submit",
    "eligible retry should expose its post-submit transition"
  );
  assert.equal(
    decisionsByTask.get("task-crawler-019").stateTransition,
    "cancelled_state_preserved_pending_review",
    "crawler cancel should preserve cancelled state while review is open"
  );
  assert.equal(
    decisionsByTask.get("task-brief-441").stateTransition,
    "blocked_state_preserved",
    "blocked safety hold should preserve blocked task state"
  );
  assert.equal(
    decisionsByTask.get("task-crawler-019").releaseGateDisposition,
    "eval_gate_preserved_by_regression_fixture",
    "crawler cancel regression must preserve the eval gate while second review is open"
  );
  assert.equal(
    decisionsByTask.get("task-export-489").apiOutcome,
    "post_retry_202_accepted",
    "eligible retry should expose accepted admin API outcome"
  );
  assert.equal(
    decisionsByTask.get("task-export-489").quotaLedgerEffect,
    "release_reserved_credit_once",
    "eligible retry must release reserved credit exactly once"
  );
  assert.equal(
    decisionsByTask.get("task-export-489").auditWritePolicy,
    "write_submit_audit_before_queue_mutation",
    "eligible retry must write audit before queue mutation"
  );
  assert.equal(
    decisionsByTask.get("task-export-489").regressionGateEffect,
    "canary_fixture_ready",
    "eligible retry regression should be canary-ready after conversion"
  );
  assert.equal(
    decisionsByTask.get("task-crawler-019").apiOutcome,
    "post_cancel_202_review_required",
    "crawler cancel should return review-required admin API outcome"
  );
  assert.equal(
    decisionsByTask.get("task-crawler-019").auditWritePolicy,
    "write_review_audit_before_cancel_closure",
    "crawler cancel must write review audit before closure"
  );
  assert.equal(
    decisionsByTask.get("task-crawler-019").regressionGateEffect,
    "canary_fixture_blocks_until_review",
    "crawler cancel regression must keep canary blocked until review closes"
  );
  assert.equal(
    decisionsByTask.get("task-brief-441").apiOutcome,
    "disabled_423_hold",
    "blocked safety hold should expose disabled hold outcome"
  );
  assert.equal(
    decisionsByTask.get("task-brief-441").quotaLedgerEffect,
    "refund_pending_until_audit",
    "blocked safety hold should preserve pending refund ledger effect"
  );
  assert.equal(
    decisionsByTask.get("task-brief-441").auditWritePolicy,
    "write_blocked_attempt_audit",
    "blocked safety hold must write blocked-attempt audit evidence"
  );

  for (const task of failedTaskControls) {
    const decision = decisionsByTask.get(task.id);
    assert.ok(decision, `${task.id} is missing runtime decision`);
    assert.equal(decision.queueId, task.queueId, `${task.id} must preserve queue linkage`);
    assert.equal(decision.rbacStatus, task.rbacDecision, `${task.id} must preserve RBAC outcome`);
    assert.equal(
      decision.roleAuthorizationStatus,
      roleOrder.get(task.requestedByRole) >= roleOrder.get(task.allowedRole) ? "sufficient" : "insufficient",
      `${task.id} must compute requested-role authorization`
    );
    assert.equal(
      decision.roleAuthorizationEvidence,
      `requested:${task.requestedByRole}; required:${task.allowedRole}`,
      `${task.id} must expose requested and required role evidence`
    );
    assert.equal(decision.quotaSettlement, task.quotaEffect, `${task.id} must preserve quota settlement`);
    assert.equal(decision.auditRef, task.auditRef, `${task.id} must preserve audit ref`);
    assert.equal(decision.idempotencyKey, task.idempotencyKey, `${task.id} must preserve idempotency key`);
    assert.equal(decision.idempotencyStatus, "stable", `${task.id} must preserve stable idempotency`);
    assert.equal(decision.stateDigestStatus, "stable", `${task.id} must preserve stable state digest`);
    assert.equal(
      decision.stateDigestEvidence,
      `pre:${task.preActionStateDigest}; observed:${task.observedStateDigest}`,
      `${task.id} must expose pre-action and observed state digest evidence`
    );
    assert.equal(decision.rbacEvidenceStatus, "complete", `${task.id} must expose complete RBAC evidence`);
    assert.deepEqual(decision.rbacEvidenceRefs, task.rbacEvidenceRefs, `${task.id} must preserve RBAC evidence refs`);
    assert.equal(decision.compatibilityStatus, "compatible", `${task.id} must expose compatible app worker schema evidence`);
    assert.equal(
      decision.compatibilityEvidence,
      `app:${task.appVersion}; worker:${task.workerVersion}; schema:${task.schemaVersion}`,
      `${task.id} must preserve version compatibility evidence`
    );
    const supportTicket = supportTicketById.get(task.supportTicketId);
    assert.ok(supportTicket, `${task.id} must link a support ticket fixture`);
    assert.equal(decision.supportTicketLinkageStatus, "linked", `${task.id} must link the support ticket to the failed task`);
    assert.equal(
      decision.supportTicketLinkageEvidence,
      `ticket:${supportTicket.id}; task:${supportTicket.taskId}; expectedTask:${task.id}`,
      `${task.id} must expose support-ticket task linkage evidence`
    );
    assert.equal(decision.tenantScopeStatus, "linked", `${task.id} must preserve support-ticket tenant scope`);
    assert.equal(
      decision.tenantScopeEvidence,
      `ticketUser:${supportTicket.userId}; taskUser:${task.userId}; ticketProject:${supportTicket.projectId}; taskProject:${task.projectId}`,
      `${task.id} must expose support-ticket user/project scope evidence`
    );
    assert.equal(
      decision.traceLinkageStatus,
      task.traceId === "none" ? "not_required" : "linked",
      `${task.id} must preserve support-ticket trace linkage`
    );
    assert.equal(
      decision.traceLinkageEvidence,
      `ticketTrace:${supportTicket.traceId}; taskTrace:${task.traceId}`,
      `${task.id} must expose support-ticket trace linkage evidence`
    );
    assert.match(
      decision.apiOutcome,
      /post_retry_202_accepted|post_cancel_202_review_required|post_cancel_202_cancelled|disabled_423_hold|disabled_409_conflict/,
      `${task.id} needs explicit admin API outcome`
    );
    assert.match(
      decision.quotaLedgerEffect,
      /release_reserved_credit_once|refund_pending_until_audit|refund_on_cancel_after_review|no_quota_mutation/,
      `${task.id} needs explicit quota ledger effect`
    );
    assert.equal(decision.supportNoticeStatus, decision.userMessageStatus, `${task.id} support notice must mirror user-message readiness`);
    assert.match(
      decision.auditWritePolicy,
      /write_submit_audit_before_queue_mutation|write_review_audit_before_cancel_closure|write_blocked_attempt_audit/,
      `${task.id} needs explicit audit write policy`
    );
    assert.match(
      decision.regressionGateEffect,
      /canary_fixture_ready|canary_fixture_blocks_until_review|no_regression_fixture_blocks_release/,
      `${task.id} needs explicit regression gate effect`
    );
    assert.equal(decision.closureEvidenceStatus, "complete", `${task.id} must have complete closure evidence`);
    assert.equal(decision.userMessageStatus, "ready", `${task.id} must expose user-visible messaging`);
    assert.match(
      decision.stateTransition,
      /failed_to_retrying_after_submit|failed_retry_preserved|cancelled_closure_ready|cancelled_state_preserved_pending_review|blocked_state_preserved/,
      `${task.id} needs explicit runtime state transition`
    );
    assert.match(
      decision.closureOutcome,
      /retry_submits_with_audit|retry_blocked_until_evidence|cancel_submits_with_audit|cancel_requires_second_review|hold_blocked_until_policy_review/,
      `${task.id} needs explicit closure outcome`
    );
    assert.match(
      decision.releaseGateDisposition,
      /converted_regression_fixture|eval_gate_preserved_by_regression_fixture|blocked_not_regression_fixture/,
      `${task.id} needs explicit release gate disposition`
    );
    assert.ok(decision.operatorAction.length > 40, `${task.id} needs executable operator action`);

    if (task.rbacDecision === "denied") {
      assert.ok(decision.blockerCodes.includes("rbac_denied"), `${task.id} must expose RBAC blocker`);
    }

    if (task.actionEligibility === "blocked") {
      assert.ok(decision.blockerCodes.includes("action_blocked"), `${task.id} must expose action blocker`);
      assert.match(decision.submitDisabledReason, /action_blocked|rbac_denied/, `${task.id} needs disabled reason`);
    }
  }

  const unstableRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        idempotencyKey: "retry:wrong-task:sup-2204:manifest-missing"
      }
    ],
    supportTickets
  );
  assert.equal(unstableRetry[0].idempotencyStatus, "unstable", "mismatched retry idempotency key must be unstable");
  assert.equal(unstableRetry[0].submitDecision, "blocked", "unstable retry idempotency must block submission");
  assert.ok(
    unstableRetry[0].blockerCodes.includes("idempotency_key_unstable"),
    "unstable retry idempotency must expose a blocker code"
  );

  const exhaustedRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        retryCount: 3,
        maxRetries: 3
      }
    ],
    supportTickets
  )[0];
  assert.equal(exhaustedRetry.retryBudgetStatus, "exhausted", "retry at max attempts must exhaust budget");
  assert.equal(exhaustedRetry.submitDecision, "blocked", "exhausted retry budget must block submission");
  assert.ok(
    exhaustedRetry.blockerCodes.includes("retry_budget_exhausted"),
    "exhausted retry budget must expose a blocker code"
  );
  assert.match(
    exhaustedRetry.submitDisabledReason,
    /retry_budget_exhausted/,
    "exhausted retry budget must be visible in disabled reason"
  );

  const staleSchemaRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        schemaVersion: "task.v0"
      }
    ],
    supportTickets
  )[0];
  assert.equal(staleSchemaRetry.compatibilityStatus, "stale", "stale task schema must be detected");
  assert.match(
    staleSchemaRetry.compatibilityEvidence,
    /schema:task\.v0/,
    "stale schema evidence must include the observed schema version"
  );
  assert.equal(staleSchemaRetry.submitDecision, "blocked", "stale task schema must block retry submission");
  assert.ok(
    staleSchemaRetry.blockerCodes.includes("version_compatibility_stale"),
    "stale task schema must expose a compatibility blocker code"
  );

  const staleReplayRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        observedStateDigest: "sha256:failed-task-task-export-489-retrying-v2"
      }
    ],
    supportTickets
  )[0];
  assert.equal(staleReplayRetry.stateDigestStatus, "stale_replay", "changed observed state digest must be detected");
  assert.match(
    staleReplayRetry.stateDigestEvidence,
    /observed:sha256:failed-task-task-export-489-retrying-v2/,
    "stale replay evidence must include the observed state digest"
  );
  assert.equal(staleReplayRetry.submitDecision, "blocked", "stale replay must block retry submission");
  assert.ok(
    staleReplayRetry.blockerCodes.includes("state_digest_stale_replay"),
    "stale replay must expose a state digest blocker code"
  );

  const incompleteClosureCancel = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-crawler-019"),
        rbacDecision: "allowed",
        actionEligibility: "eligible",
        closureEvidenceRefs: ["task-crawler-019", "sup-2212", "au-002"]
      }
    ],
    supportTickets
  )[0];
  assert.equal(
    incompleteClosureCancel.closureEvidenceStatus,
    "incomplete",
    "cancel without enough evidence refs must expose incomplete closure evidence"
  );
  assert.equal(
    incompleteClosureCancel.submitDecision,
    "blocked",
    "cancel cannot submit without complete closure evidence"
  );
  assert.ok(
    incompleteClosureCancel.blockerCodes.includes("closure_evidence_incomplete"),
    "incomplete closure evidence must expose a blocker code"
  );

  const missingUserMessageRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        userMessage: "   "
      }
    ],
    supportTickets
  )[0];
  assert.equal(missingUserMessageRetry.userMessageStatus, "missing", "blank user message must be detected");
  assert.equal(
    missingUserMessageRetry.submitDecision,
    "blocked",
    "retry cannot submit without user-visible messaging"
  );
  assert.ok(
    missingUserMessageRetry.blockerCodes.includes("user_message_missing"),
    "missing user message must expose a blocker code"
  );

  const missingRbacEvidenceRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        rbacEvidenceRefs: []
      }
    ],
    supportTickets
  )[0];
  assert.equal(missingRbacEvidenceRetry.rbacEvidenceStatus, "missing", "blank RBAC evidence refs must be detected");
  assert.equal(
    missingRbacEvidenceRetry.submitDecision,
    "blocked",
    "retry cannot submit without RBAC evidence refs"
  );
  assert.ok(
    missingRbacEvidenceRetry.blockerCodes.includes("rbac_evidence_missing"),
    "missing RBAC evidence must expose a blocker code"
  );

  const insufficientRoleAllowedRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        allowedRole: "admin_reviewer",
        requestedByRole: "support_operator",
        rbacDecision: "allowed"
      }
    ],
    supportTickets
  )[0];
  assert.equal(
    insufficientRoleAllowedRetry.roleAuthorizationStatus,
    "insufficient",
    "runtime must detect an allowed RBAC decision from an insufficient role"
  );
  assert.equal(
    insufficientRoleAllowedRetry.submitDecision,
    "blocked",
    "insufficient requested role must block failed-task retry submission even if fixture RBAC says allowed"
  );
  assert.ok(
    insufficientRoleAllowedRetry.blockerCodes.includes("role_authorization_insufficient"),
    "insufficient requested role must expose a blocker code"
  );
  assert.match(
    insufficientRoleAllowedRetry.roleAuthorizationEvidence,
    /requested:support_operator; required:admin_reviewer/,
    "insufficient requested role evidence must include requested and required roles"
  );

  const missingSupportTicketRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        supportTicketId: "sup-missing"
      }
    ],
    supportTickets
  )[0];
  assert.equal(missingSupportTicketRetry.supportTicketLinkageStatus, "missing_ticket", "missing support ticket must be detected");
  assert.equal(missingSupportTicketRetry.submitDecision, "blocked", "retry cannot submit without support ticket evidence");
  assert.ok(
    missingSupportTicketRetry.blockerCodes.includes("support_ticket_missing"),
    "missing support ticket must expose a blocker code"
  );

  const mismatchedTicketRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        supportTicketId: "sup-2209"
      }
    ],
    supportTickets
  )[0];
  assert.equal(mismatchedTicketRetry.supportTicketLinkageStatus, "linked", "alternate ticket for same task can link");
  assert.equal(
    mismatchedTicketRetry.traceLinkageStatus,
    "linked",
    "alternate same-task support ticket must still preserve trace linkage"
  );
  assert.equal(mismatchedTicketRetry.submitDecision, "blocked", "changed ticket must still block through idempotency mismatch");
  assert.ok(
    mismatchedTicketRetry.blockerCodes.includes("idempotency_key_unstable"),
    "changed support ticket must invalidate action-scoped idempotency"
  );

  const crossTaskTicketRetry = buildFailedTaskRuntimeDecisions(
    [
      {
        ...failedTaskControls.find((task) => task.id === "task-export-489"),
        supportTicketId: "sup-2201",
        idempotencyKey: "retry:task-export-489:sup-2201:manifest-missing"
      }
    ],
    supportTickets
  )[0];
  assert.equal(crossTaskTicketRetry.supportTicketLinkageStatus, "mismatched_ticket", "cross-task support ticket must be detected");
  assert.equal(crossTaskTicketRetry.tenantScopeStatus, "mismatched_tenant_scope", "cross-user/project ticket must be detected");
  assert.equal(crossTaskTicketRetry.traceLinkageStatus, "mismatched_trace", "cross-trace ticket must be detected");
  assert.equal(crossTaskTicketRetry.submitDecision, "blocked", "cross-linked support ticket must block retry submission");
  assert.ok(
    crossTaskTicketRetry.blockerCodes.includes("support_ticket_task_mismatch"),
    "cross-task ticket must expose task mismatch blocker"
  );
  assert.ok(
    crossTaskTicketRetry.blockerCodes.includes("support_ticket_user_project_mismatch"),
    "cross-task ticket must expose tenant-scope mismatch blocker"
  );
  assert.ok(
    crossTaskTicketRetry.blockerCodes.includes("support_ticket_trace_mismatch"),
    "cross-task ticket must expose trace mismatch blocker"
  );
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
          adminRbacEvidenceIds.has(ref) ||
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

test("staging legal support visibility evidence clears only its private beta check", () => {
  const legalPath = new URL("../../ops/evidence/staging/legal-pages-external-user.json", import.meta.url);
  const supportPath = new URL("../../ops/evidence/staging/support-contact-external-user.json", import.meta.url);
  assert.ok(existsSync(legalPath), "legal pages external-user evidence file is missing");
  assert.ok(existsSync(supportPath), "support contact external-user evidence file is missing");

  const legalFile = JSON.parse(readFileSync(legalPath, "utf8"));
  const supportFile = JSON.parse(readFileSync(supportPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(privateBetaGatePath, "utf8"));

  assert.equal(stagingLegalSupportVisibilityEvidence.environment, "staging");
  assert.equal(stagingLegalSupportVisibilityEvidence.status, "pass");
  assert.equal(stagingLegalSupportVisibilityEvidence.releaseGateCheckId, "staging_legal_external_user_pages");
  assert.equal(stagingLegalSupportVisibilityEvidence.doNotLaunchConditionId, "external_user_legal_pages_missing");
  assert.equal(stagingLegalSupportVisibilityEvidence.legalPageEvidencePath, "ops/evidence/staging/legal-pages-external-user.json");
  assert.equal(stagingLegalSupportVisibilityEvidence.supportContactEvidencePath, "ops/evidence/staging/support-contact-external-user.json");
  assert.deepEqual(stagingLegalSupportVisibilityEvidence.gateImpact.remainingBlockers, ["staging_object_storage_signed_downloads"]);

  for (const evidenceFile of [legalFile, supportFile]) {
    assert.equal(evidenceFile.environment, "staging", "split evidence must be staging scoped");
    assert.equal(evidenceFile.status, "pass", "split evidence must pass");
    assert.equal(evidenceFile.release_gate_check_id, "staging_legal_external_user_pages");
    assert.equal(evidenceFile.do_not_launch_condition_id, "external_user_legal_pages_missing");
    assert.equal(
      Object.hasOwn(evidenceFile.gate_impact, "remaining_blockers"),
      false,
      "split legal/support evidence must not preserve blockers directly"
    );
  }

  const requiredAreas = new Set(["legal_pages_visibility", "support_contact_visibility"]);
  for (const coverage of stagingLegalSupportVisibilityEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.length > 100, `${coverage.area} needs runtime probe detail`);
    assert.ok(coverage.externalUserEvidence.length > 100, `${coverage.area} needs external-user evidence`);
    assert.ok(coverage.policyEvidence.length > 100, `${coverage.area} needs policy evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifact refs`);
    assert.ok(
      coverage.evidenceRefs.includes("ops/evidence/staging/legal-pages-external-user.json") &&
        coverage.evidenceRefs.includes("ops/evidence/staging/support-contact-external-user.json"),
      `${coverage.area} must cite both exact staging legal/support evidence files`
    );
  }
  assert.deepEqual([...requiredAreas], [], "legal/support visibility evidence is missing coverage areas");

  const legalCheck = gateFixture.checks.find((check) => check.check_id === "staging_legal_external_user_pages");
  assert.ok(legalCheck, "private beta gate needs legal/support check");
  assert.equal(legalCheck.status, "pass");
  assert.ok(legalCheck.evidence_ref.includes("ops/evidence/staging/legal-pages-external-user.json"));
  assert.ok(legalCheck.evidence_ref.includes("ops/evidence/staging/support-contact-external-user.json"));

  const legalCondition = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === "external_user_legal_pages_missing"
  );
  assert.ok(legalCondition, "private beta gate needs legal/support do-not-launch condition");
  assert.equal(legalCondition.is_present, false);
  assert.ok(legalCondition.evidence_ref.includes("ops/evidence/staging/legal-pages-external-user.json"));
  assert.ok(legalCondition.evidence_ref.includes("ops/evidence/staging/support-contact-external-user.json"));

  assert.deepEqual(gateFixture.gate_decision.blocked_by_checks, ["staging_object_storage_signed_downloads"]);
  assert.deepEqual(gateFixture.gate_decision.active_do_not_launch_conditions, ["object_storage_signed_retention_runtime_missing"]);
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
    stagingAuthRbacTenantAuditEvidence.adminRbacEvidenceIds.toSorted(),
    adminRbacEvidence.map((item) => item.id).toSorted(),
    "staging auth/RBAC evidence must consume every admin RBAC override record, including expired temporary overrides"
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
  const runtimeCoverage = stagingAuthRbacTenantAuditEvidence.coverage.find(
    (coverage) => coverage.area === "admin_rbac_runtime"
  );
  assert.ok(runtimeCoverage, "staging auth/RBAC evidence needs admin RBAC runtime coverage");
  assert.ok(
    runtimeCoverage.evidenceRefs.includes("rbac-provider-002"),
    "staging admin RBAC runtime evidence must cite expired provider override evidence"
  );
  assert.match(
    runtimeCoverage.runtimeProbe,
    /expired provider|stale temporary overrides deny/,
    "staging admin RBAC runtime probe must prove expired temporary provider overrides deny"
  );

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
  }
});

test("staging eval QA safety evidence enforces brief, provider, QA, and export gates", () => {
  assert.ok(existsSync(stagingEvalQaSafetyPath), "staging eval/QA/safety evidence file is missing");
  assert.ok(existsSync(privateBetaGatePath), "private beta gate evidence fixture is missing");

  const evidenceFile = JSON.parse(readFileSync(stagingEvalQaSafetyPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(privateBetaGatePath, "utf8"));
  const rbacIds = new Set(adminRbacEvidence.map((item) => item.id));

  assert.equal(evidenceFile.environment, "staging", "eval/QA/safety evidence must be staging scoped");
  assert.equal(evidenceFile.status, "pass", "eval/QA/safety evidence must pass");
  assert.equal(
    evidenceFile.evidence_id,
    stagingEvalQaSafetyEvidence.id,
    "evidence file and admin fixture ids must match"
  );
  assert.equal(
    evidenceFile.release_gate_check_id,
    "staging_eval_qa_safety_runtime",
    "eval/QA/safety evidence must target the matching release gate check"
  );
  assert.equal(
    evidenceFile.do_not_launch_condition_id,
    "eval_qa_safety_runtime_missing",
    "eval/QA/safety evidence must target the safety enforcement do-not-launch condition"
  );
  assert.deepEqual(
    evidenceFile.runtime_request_ids,
    stagingEvalQaSafetyEvidence.runtimeRequestIds,
    "evidence file and admin fixture runtime request ids must match"
  );
  assert.equal(
    evidenceFile.gate_impact.aggregate_private_beta_gate_status,
    "blocked_by_other_staging_runtime_items",
    "eval/QA/safety evidence cannot close the aggregate private beta gate"
  );

  for (const requestId of stagingEvalQaSafetyEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^staging-eval-qa-safety-\d{8}T\d{4}Z-/,
      `${requestId} must be a staging eval/QA/safety runtime probe`
    );
  }

  const requiredAreas = new Set([
    "brief_safety_gate",
    "provider_request_policy",
    "provider_response_policy",
    "qa_result_gate",
    "export_block_gate"
  ]);
  const fileCoverageByArea = new Map(evidenceFile.coverage.map((coverage) => [coverage.area, coverage]));

  for (const traceId of stagingEvalQaSafetyEvidence.traceIds) {
    assert.ok(traceIds.has(traceId), `${traceId} must link an admin trace`);
  }
  for (const exportId of stagingEvalQaSafetyEvidence.riskyExportIds) {
    assert.ok(riskyExportIds.has(exportId), `${exportId} must link a risky export fixture`);
  }
  for (const id of stagingEvalQaSafetyEvidence.adminRbacEvidenceIds) {
    assert.ok(rbacIds.has(id), `${id} must link admin RBAC evidence`);
  }
  for (const id of stagingEvalQaSafetyEvidence.adminReviewDecisionIds) {
    assert.ok(adminReviewDecisionIds.has(id), `${id} must link admin review evidence`);
  }
  for (const auditRef of stagingEvalQaSafetyEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }

  for (const coverage of stagingEvalQaSafetyEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    const fileCoverage = fileCoverageByArea.get(coverage.area);
    assert.ok(fileCoverage, `${coverage.area} missing from evidence file`);
    assert.equal(coverage.status, "pass", `${coverage.area} admin fixture coverage must pass`);
    assert.equal(fileCoverage.status, coverage.status, `${coverage.area} file and fixture status mismatch`);
    assert.match(
      coverage.runtimeProbe,
      /brief|provider|response|QA|export|safety|policy|release/i,
      `${coverage.area} must describe executable runtime enforcement`
    );
    assert.ok(coverage.runtimeProbe.length > 120, `${coverage.area} needs runtime probe detail`);
    assert.ok(coverage.externalUserEvidence.length > 90, `${coverage.area} needs external-user evidence`);
    assert.ok(coverage.enforcementEvidence.length > 90, `${coverage.area} needs safety enforcement evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes(stagingEvalQaSafetyEvidence.evidencePath),
      `${coverage.area} must cite the staging evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          rbacIds.has(ref) ||
          riskyExportIds.has(ref) ||
          adminReviewDecisionIds.has(ref) ||
          traceIds.has(ref) ||
          exportIds.has(ref)
      ),
      `${coverage.area} needs validator-resolvable safety, review, trace, export, or audit refs`
    );
  }

  assert.deepEqual([...requiredAreas], [], "staging eval/QA/safety evidence is missing coverage areas");

  const gateCheck = gateFixture.checks.find((check) => check.check_id === "staging_eval_qa_safety_runtime");
  assert.ok(gateCheck, "private beta gate needs eval/QA/safety check");
  assert.equal(gateCheck.status, "pass", "validated eval/QA/safety evidence should clear only its check");
  assert.ok(
    gateCheck.evidence_ref.includes(stagingEvalQaSafetyEvidence.evidencePath),
    "eval/QA/safety gate check must cite the staging runtime evidence path"
  );

  const safetyCondition = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === stagingEvalQaSafetyEvidence.doNotLaunchConditionId
  );
  assert.ok(safetyCondition, "private beta do-not-launch fixture needs eval/QA/safety condition");
  assert.equal(
    safetyCondition.is_present,
    false,
    "validated eval/QA/safety runtime evidence should clear the matching do-not-launch condition"
  );
  assert.ok(
    safetyCondition.evidence_ref.includes(stagingEvalQaSafetyEvidence.evidencePath),
    "cleared eval/QA/safety condition must cite the staging runtime evidence path"
  );

  for (const blocker of stagingEvalQaSafetyEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the private beta gate fixture`);
  }

  assert.ok(
    gateFixture.checks.some((check) => check.status === "blocked"),
    "aggregate private beta gate must remain blocked by other staging runtime items"
  );
});

test("staging quota rate limit spend cap evidence clears only its private beta check", () => {
  assert.ok(existsSync(stagingQuotaRateLimitSpendCapPath), "staging quota/rate-limit/spend-cap evidence file is missing");
  assert.ok(existsSync(privateBetaGatePath), "private beta gate evidence fixture is missing");

  const evidenceFile = JSON.parse(readFileSync(stagingQuotaRateLimitSpendCapPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(privateBetaGatePath, "utf8"));
  const rbacIds = new Set(adminRbacEvidence.map((item) => item.id));

  assert.equal(evidenceFile.environment, "staging", "quota/rate-limit/spend-cap evidence must be staging scoped");
  assert.equal(evidenceFile.status, "pass", "quota/rate-limit/spend-cap evidence must pass");
  assert.equal(
    evidenceFile.evidence_id,
    stagingQuotaRateLimitSpendCapEvidence.id,
    "evidence file and admin fixture ids must match"
  );
  assert.equal(
    evidenceFile.release_gate_check_id,
    "staging_quota_rate_limit_spend_cap",
    "quota/rate-limit/spend-cap evidence must target the matching release gate check"
  );
  assert.equal(
    evidenceFile.do_not_launch_condition_id,
    "rate_limit_spend_cap_runtime_missing",
    "quota/rate-limit/spend-cap evidence must target the matching do-not-launch condition"
  );
  assert.deepEqual(
    evidenceFile.runtime_request_ids,
    stagingQuotaRateLimitSpendCapEvidence.runtimeRequestIds,
    "evidence file and admin fixture runtime request ids must match"
  );
  assert.equal(
    evidenceFile.gate_impact.aggregate_private_beta_gate_status,
    "blocked_by_other_staging_runtime_items",
    "quota/rate-limit/spend-cap evidence cannot close the aggregate private beta gate"
  );

  for (const requestId of stagingQuotaRateLimitSpendCapEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^staging-quota-rate-limit-spend-cap-\d{8}T\d{4}Z-/,
      `${requestId} must be a staging quota/rate-limit/spend-cap runtime probe`
    );
  }

  for (const userId of stagingQuotaRateLimitSpendCapEvidence.quotaUserIds) {
    assert.ok(quotaUserIds.has(userId), `${userId} must link an admin quota account`);
  }
  for (const id of stagingQuotaRateLimitSpendCapEvidence.adminRbacEvidenceIds) {
    assert.ok(rbacIds.has(id), `${id} must link admin RBAC evidence`);
  }
  for (const auditRef of stagingQuotaRateLimitSpendCapEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }

  const requiredAreas = new Set([
    "quota_reservation_commit_refund",
    "rate_limit_enforcement",
    "provider_spend_cap",
    "emergency_kill_switch"
  ]);
  const fileCoverageByArea = new Map(evidenceFile.coverage.map((coverage) => [coverage.area, coverage]));

  for (const coverage of stagingQuotaRateLimitSpendCapEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    const fileCoverage = fileCoverageByArea.get(coverage.area);
    assert.ok(fileCoverage, `${coverage.area} missing from evidence file`);
    assert.equal(coverage.status, "pass", `${coverage.area} admin fixture coverage must pass`);
    assert.equal(fileCoverage.status, coverage.status, `${coverage.area} file and fixture status mismatch`);
    assert.match(
      coverage.runtimeProbe,
      /quota|rate-limit|spend|kill-switch|provider|refund|reservation|throttle/i,
      `${coverage.area} must describe executable quota, rate-limit, or spend-cap runtime enforcement`
    );
    assert.ok(coverage.runtimeProbe.length > 120, `${coverage.area} needs runtime probe detail`);
    assert.ok(coverage.externalUserEvidence.length > 90, `${coverage.area} needs external-user evidence`);
    assert.ok(coverage.enforcementEvidence.length > 90, `${coverage.area} needs enforcement evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes(stagingQuotaRateLimitSpendCapEvidence.evidencePath),
      `${coverage.area} must cite the staging evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          rbacIds.has(ref) ||
          supportTicketIds.has(ref) ||
          exportIds.has(ref) ||
          traceIds.has(ref) ||
          taskIds.has(ref) ||
          queueIds.has(ref) ||
          abuseHookIds.has(ref) ||
          abuseEventById.has(ref) ||
          crawlerFindingIds.has(ref) ||
          quotaUserIds.has(ref) ||
          ref.startsWith("qt-") ||
          ref.startsWith("ph-")
      ),
      `${coverage.area} needs validator-resolvable admin quota, provider, support, abuse, trace, or audit refs`
    );
  }

  assert.deepEqual([...requiredAreas], [], "staging quota/rate-limit/spend-cap evidence is missing coverage areas");

  const gateCheck = gateFixture.checks.find((check) => check.check_id === "staging_quota_rate_limit_spend_cap");
  assert.ok(gateCheck, "private beta gate needs quota/rate-limit/spend-cap check");
  assert.equal(gateCheck.status, "pass", "validated quota/rate-limit/spend-cap evidence should clear only its check");
  assert.ok(
    gateCheck.evidence_ref.includes(stagingQuotaRateLimitSpendCapEvidence.evidencePath),
    "quota/rate-limit/spend-cap gate check must cite the staging runtime evidence path"
  );

  const quotaCondition = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === stagingQuotaRateLimitSpendCapEvidence.doNotLaunchConditionId
  );
  assert.ok(quotaCondition, "private beta do-not-launch fixture needs quota/rate-limit/spend-cap condition");
  assert.equal(
    quotaCondition.is_present,
    false,
    "validated quota/rate-limit/spend-cap runtime evidence should clear the matching condition"
  );
  assert.ok(
    quotaCondition.evidence_ref.includes(stagingQuotaRateLimitSpendCapEvidence.evidencePath),
    "cleared quota/rate-limit/spend-cap condition must cite the staging runtime evidence path"
  );

  const currentBlockedChecks = new Set(
    gateFixture.checks.filter((entry) => entry.status === "blocked").map((entry) => entry.check_id)
  );
  for (const blocker of stagingQuotaRateLimitSpendCapEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the private beta gate fixture`);
    if (currentBlockedChecks.has(blocker)) {
      assert.equal(check.status, "blocked", `${blocker} must stay blocked until its own runtime evidence clears`);
    } else {
      assert.equal(check.status, "pass", `${blocker} may pass after newer targeted runtime evidence clears it`);
    }
  }

  assert.ok(
    gateFixture.checks.some((check) => check.status === "blocked"),
    "aggregate private beta gate must remain blocked by other staging runtime items"
  );
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
  const insufficientRoleSecondReviewDecisions = [];

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
  assert.deepEqual(
    productionActivationReviewAuditEvidence.adminRbacEvidenceIds.toSorted(),
    adminRbacEvidence.map((item) => item.id).toSorted(),
    "production activation evidence must consume every admin RBAC override record"
  );
  assert.deepEqual(
    evidenceFile.admin_rbac_evidence_ids.toSorted(),
    productionActivationReviewAuditEvidence.adminRbacEvidenceIds.toSorted(),
    "production evidence file must match admin RBAC fixture coverage"
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

    if (roleOrder.get(rbac.attemptedRole) < roleOrder.get(rbac.requiredRole)) {
      insufficientRoleSecondReviewDecisions.push(runtimeDecision);
      assert.equal(
        runtimeDecision.effectiveDecision,
        "deny_mutation",
        `${evidenceId} insufficient role must deny before second-review routing`
      );
      assert.equal(runtimeDecision.requestOutcome, "denied_insufficient_role");
      assert.equal(runtimeDecision.queueAction, "block_and_preserve_state");
      assert.equal(runtimeDecision.releaseGateStatus, "release_gate_preserved");
    } else if (rbac.decision === "allowed") {
      if (rbac.overrideExpiresAt !== "none" && new Date(`${rbac.overrideExpiresAt.replace(" ", "T")}:00Z`).getTime() <= new Date("2026-05-26T11:00:00Z").getTime() && rbac.expiryEnforced) {
        assert.equal(runtimeDecision.effectiveDecision, "deny_mutation", `${evidenceId} expired allowed evidence must be denied`);
        assert.equal(runtimeDecision.requestOutcome, "denied_expired_override");
      } else {
        assert.equal(runtimeDecision.effectiveDecision, "allow_mutation", `${evidenceId} allowed RBAC evidence should apply with expiry`);
        assert.equal(runtimeDecision.releaseGateStatus, "runtime_override_applied_with_expiry");
      }
    } else if (rbac.decision === "second_review_required") {
      assert.equal(runtimeDecision.effectiveDecision, "queue_for_review", `${evidenceId} sufficient second-review evidence should queue`);
      assert.equal(runtimeDecision.releaseGateStatus, "canary_or_release_blocked");
    } else {
      assert.equal(runtimeDecision.effectiveDecision, "deny_mutation", `${evidenceId} denied evidence should block mutation`);
      assert.equal(runtimeDecision.releaseGateStatus, "release_gate_preserved");
    }
  }
  assert.deepEqual([...requiredSurfaces], [], "production activation evidence must include every admin override surface");
  assert.ok(
    insufficientRoleSecondReviewDecisions.some((decision) => decision.evidenceId === "rbac-safety-001"),
    "insufficient role second-review requests must be represented as hard denials"
  );
  assert.ok(
    runtimeDecisions.some(
      (decision) =>
        decision.evidenceId === "rbac-release-001" &&
        decision.effectiveDecision === "queue_for_review" &&
        decision.releaseGateStatus === "canary_or_release_blocked"
    ),
    "sufficient reviewer role can queue release changes that still require second review"
  );
  assert.ok(
    runtimeDecisions.some(
      (decision) =>
        decision.evidenceId === "rbac-safety-001" &&
        decision.requestOutcome === "denied_insufficient_role" &&
        decision.releaseGateStatus === "release_gate_preserved"
    ),
    "admin reviewer cannot queue superadmin-only safety overrides through second-review routing"
  );
  assert.ok(
    runtimeDecisions.some(
      (decision) =>
        decision.evidenceId === "rbac-provider-002" &&
        decision.requestOutcome === "denied_expired_override" &&
        decision.releaseGateStatus === "release_gate_preserved"
    ),
    "expired provider routing override evidence must be denied and preserve the release gate"
  );
  assert.ok(
    runtimeDecisions.some(
      (decision) =>
        decision.effectiveDecision === "queue_for_review" &&
        roleOrder.get(rbacById.get(decision.evidenceId).attemptedRole) >=
          roleOrder.get(rbacById.get(decision.evidenceId).requiredRole)
    ),
    "second-review queues require a sufficient attempted admin role"
  );

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

test("admin RBAC override evidence is release-grade for every governed override surface", () => {
  const { buildAdminRbacRuntimeDecisions, buildAdminRbacStaleReplayDecisions, buildAdminRbacEvidencePacks } = parseRbacRuntime();
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const staleReplayDecisions = buildAdminRbacStaleReplayDecisions(
    adminRbacEvidence,
    runtimeDecisions,
    new Date("2026-05-26T19:00:00Z")
  );
  const evidencePacks = buildAdminRbacEvidencePacks(adminRbacEvidence, runtimeDecisions, staleReplayDecisions);
  const decisionByEvidenceId = new Map(runtimeDecisions.map((decision) => [decision.evidenceId, decision]));
  const staleReplayByEvidenceId = new Map(staleReplayDecisions.map((decision) => [decision.evidenceId, decision]));
  const packBySurface = new Map(evidencePacks.map((pack) => [pack.surface, pack]));
  const expectedSurfacePolicy = new Map([
    [
      "skill_release",
      {
        scope: "release",
        endpoint: /^PATCH \/api\/admin\/skills\/.+\/releases\/.+\/canary$/,
        enforcementPoint: "release_gate",
        evidenceTokens: ["reviewer", "second reviewer", "rollback"],
        terminalOutcomes: ["queued_second_review"]
      }
    ],
    [
      "crawler_import",
      {
        scope: "crawler",
        endpoint: /^POST \/api\/admin\/crawler\/findings\/.+\/reactivate$/,
        enforcementPoint: "crawler_activation",
        evidenceTokens: ["takedown", "derivative", "raw retention"],
        terminalOutcomes: ["denied_insufficient_role"]
      }
    ],
    [
      "prompt_approval",
      {
        scope: "prompt",
        endpoint: /^POST \/api\/admin\/prompt-fragments\/.+\/activate$/,
        enforcementPoint: "prompt_activation",
        evidenceTokens: ["eval", "QA", "feedback"],
        terminalOutcomes: ["denied_insufficient_role"]
      }
    ],
    [
      "provider_routing",
      {
        scope: "provider",
        endpoint: /^PATCH \/api\/admin\/providers\/.+\/routing-weight$/,
        enforcementPoint: "provider_router",
        evidenceTokens: ["provider health", "usage reconciliation", "expiry timestamp"],
        terminalOutcomes: ["applied", "denied_expired_override"]
      }
    ],
    [
      "quota_override",
      {
        scope: "quota",
        endpoint: /^POST \/api\/admin\/quota\/.+\/transactions$/,
        enforcementPoint: "quota_mutation",
        evidenceTokens: ["support ticket", "quota transaction", "operator audit"],
        terminalOutcomes: ["denied_insufficient_role"]
      }
    ],
    [
      "safety_rule",
      {
        scope: "safety",
        endpoint: /^PATCH \/api\/admin\/safety\/rules\/.+$/,
        enforcementPoint: "safety_policy",
        evidenceTokens: ["superadmin approval", "second review", "safety fixture pass"],
        terminalOutcomes: ["denied_insufficient_role"]
      }
    ],
    [
      "export_override",
      {
        scope: "export",
        endpoint: /^POST \/api\/admin\/exports\/.+\/override-release$/,
        enforcementPoint: "export_release",
        evidenceTokens: ["QA result", "safety decision", "non-override eligibility proof"],
        terminalOutcomes: ["denied_policy_block"]
      }
    ]
  ]);

  assert.equal(adminRbacEvidence.length, runtimeDecisions.length, "every RBAC evidence row needs a runtime decision");
  assert.equal(evidencePacks.length, expectedSurfacePolicy.size, "RBAC evidence packs must cover every governed surface");
  assert.ok(
    staleReplayDecisions.some((decision) => decision.staleOutcome === "blocked_stale_replay"),
    "stale replay fixture needs expired-window denials"
  );
  assert.ok(
    staleReplayDecisions.some((decision) => decision.staleOutcome === "policy_block_preserved"),
    "stale replay fixture needs policy-block preservation"
  );

  for (const [surface, policy] of expectedSurfacePolicy) {
    const surfaceEvidence = adminRbacEvidence.filter((item) => item.surface === surface);
    const surfaceDecisions = runtimeDecisions.filter((decision) => decision.surface === surface);
    const pack = packBySurface.get(surface);

    assert.ok(surfaceEvidence.length > 0, `${surface} needs RBAC evidence`);
    assert.ok(pack, `${surface} needs computed evidence pack`);
    assert.equal(pack.overrideScope, policy.scope, `${surface} override scope mismatch`);
    assert.equal(pack.evidenceCompleteness, "complete", `${surface} pack must be complete`);
    assert.notEqual(pack.expiryEnforcementStatus, "missing_enforcement", `${surface} must encode expiry enforcement policy`);
    assert.ok(pack.staleReplayEvidenceIds.length > 0, `${surface} pack needs stale replay evidence`);
    assert.ok(pack.staleReplayOutcomes.length > 0, `${surface} pack needs stale replay outcomes`);
    assert.ok(
      policy.terminalOutcomes.every((outcome) => pack.requestOutcomes.includes(outcome)),
      `${surface} pack is missing required request outcomes`
    );
    assert.ok(
      pack.operatorChecklist.some((item) => /Verify /.test(item)),
      `${surface} pack needs release-evidence checklist items`
    );

    for (const item of surfaceEvidence) {
      const decision = decisionByEvidenceId.get(item.id);
      assert.ok(decision, `${item.id} needs runtime decision`);
      assert.equal(item.overrideScope, policy.scope, `${item.id} override scope must match surface`);
      assert.equal(item.enforcementPoint, policy.enforcementPoint, `${item.id} enforcement point must match surface`);
      assert.match(item.apiScope, policy.endpoint, `${item.id} API scope must be a concrete admin override endpoint`);
      assert.ok(auditIds.has(item.auditRef), `${item.id} must link immutable audit ref`);
      assert.ok(item.evidenceRefs.includes(item.auditRef) || item.releaseEvidenceRequired.includes("immutable audit"), `${item.id} must carry audit-linked release evidence`);
      assert.ok(item.releaseGateImpact.length > 100, `${item.id} needs concrete release gate impact`);
      assert.ok(item.userVisibleOutcome.length > 80, `${item.id} needs user-visible outcome`);
      assert.ok(item.preOverrideState.length > 100, `${item.id} needs pre-override state`);
      assert.ok(item.postDecisionControl.length > 100, `${item.id} needs post-decision control`);
      assert.ok(item.staleOverrideProbe.includes(item.enforcementPoint), `${item.id} stale override probe must name enforcement point`);
      assert.ok(item.runtimeCheck.includes(item.enforcementPoint), `${item.id} runtime check must name enforcement point`);
      assert.ok(
        policy.evidenceTokens.every((token) =>
          item.releaseEvidenceRequired.some((requiredEvidence) =>
            requiredEvidence.toLowerCase().includes(token.toLowerCase())
          )
        ),
        `${item.id} release evidence is missing required surface tokens`
      );

      if (item.overrideDurationPolicy === "non_expiring_policy_block") {
        const staleReplay = staleReplayByEvidenceId.get(item.id);
        assert.ok(staleReplay, `${item.id} policy block needs stale replay evidence`);
        assert.equal(staleReplay.staleOutcome, "policy_block_preserved", `${item.id} must preserve policy block on replay`);
        assert.equal(staleReplay.staleWindowStatus, "policy_block", `${item.id} must keep policy-block stale window`);
        assert.equal(staleReplay.releaseGateStatus, "release_gate_preserved", `${item.id} stale replay must preserve gate`);
        assert.equal(item.expiryEnforced, false, `${item.id} policy blocks cannot pretend to have expiry enforcement`);
        assert.equal(item.overrideStartedAt, "none", `${item.id} policy blocks cannot open temporary windows`);
        assert.equal(item.overrideExpiresAt, "none", `${item.id} policy blocks cannot expire as temporary windows`);
        assert.equal(decision.overrideWindow, "policy_block", `${item.id} runtime must preserve policy-block window`);
        assert.equal(decision.mutationAllowed, false, `${item.id} policy block cannot allow mutation`);
      } else {
        const staleReplay = staleReplayByEvidenceId.get(item.id);
        assert.ok(staleReplay, `${item.id} temporary override needs stale replay evidence`);
        assert.equal(staleReplay.staleOutcome, "blocked_stale_replay", `${item.id} stale replay must be blocked`);
        assert.equal(staleReplay.staleWindowStatus, "expired", `${item.id} stale replay must use expired window`);
        assert.equal(staleReplay.releaseGateStatus, "release_gate_preserved", `${item.id} stale replay must preserve gate`);
        assert.ok(staleReplay.stateRestoration.includes(item.enforcementPoint), `${item.id} stale replay restoration must name enforcement point`);
        assert.ok(staleReplay.evidenceRefs.includes(item.auditRef), `${item.id} stale replay must retain audit-linked evidence refs`);
        assert.equal(item.expiryEnforced, true, `${item.id} temporary or second-review override must enforce expiry`);
        assert.notEqual(item.overrideStartedAt, "none", `${item.id} temporary override needs start time`);
        assert.notEqual(item.overrideExpiresAt, "none", `${item.id} temporary override needs expiry time`);
        assert.match(item.expiryAction, /restore|block|keep|require|preserve/i, `${item.id} expiry action must preserve state`);
      }

      if (item.decision === "allowed" && decision.requestOutcome === "applied") {
        assert.equal(item.mutationOutcome, "applied", `${item.id} applied runtime decision must match fixture mutation`);
        assert.equal(decision.queueAction, "apply_with_expiry", `${item.id} applied override must retain expiry handling`);
      }

      if (decision.requestOutcome === "denied_expired_override") {
        assert.equal(decision.releaseGateStatus, "release_gate_preserved", `${item.id} expired override must preserve release gate`);
        assert.ok(decision.blockerCodes.includes("expired_override_window"), `${item.id} expired override needs blocker code`);
      }

      if (decision.requestOutcome === "denied_insufficient_role") {
        assert.equal(decision.releaseGateStatus, "release_gate_preserved", `${item.id} insufficient role must preserve release gate`);
        assert.ok(decision.blockerCodes.includes("insufficient_role"), `${item.id} insufficient role needs blocker code`);
      }
    }

    assert.equal(surfaceDecisions.length, surfaceEvidence.length, `${surface} decision count must match evidence count`);
  }
});

test("production skill release eval canary evidence clears only the production skill check", () => {
  assert.ok(existsSync(productionSkillReleaseEvalCanaryPath), "production skill release/eval/canary evidence file is missing");
  assert.ok(existsSync(productionGatePath), "production launch gate evidence fixture is missing");

  const evidenceFile = JSON.parse(readFileSync(productionSkillReleaseEvalCanaryPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(productionGatePath, "utf8"));
  const skillVersionIds = new Set(skillVersions.map((version) => version.id));

  assert.equal(
    productionSkillReleaseEvalCanaryEvidence.id,
    evidenceFile.evidence_id,
    "admin fixture must match production skill evidence id"
  );
  assert.equal(productionSkillReleaseEvalCanaryEvidence.environment, "production", "evidence must be production scoped");
  assert.equal(evidenceFile.environment, "production", "evidence file must be production scoped");
  assert.equal(
    productionSkillReleaseEvalCanaryEvidence.status,
    "pass_with_blockers_preserved",
    "production skill evidence must preserve unrelated blockers"
  );
  assert.equal(
    productionSkillReleaseEvalCanaryEvidence.releaseGateCheckId,
    "production_skill_release_eval_canary",
    "evidence must bind the production skill release/eval/canary check"
  );
  assert.equal(
    productionSkillReleaseEvalCanaryEvidence.doNotLaunchConditionId,
    "skill_release_eval_canary_missing",
    "evidence must bind the production skill do-not-launch condition"
  );
  assert.equal(
    productionSkillReleaseEvalCanaryEvidence.gateImpact.canClearCheckLevelItem,
    true,
    "validated evidence should clear only the check-level production skill checklist item"
  );
  assert.equal(
    productionSkillReleaseEvalCanaryEvidence.gateImpact.aggregateProductionGateStatus,
    "blocked_by_other_production_runtime_items",
    "skill evidence must not close the aggregate production gate"
  );

  for (const requestId of productionSkillReleaseEvalCanaryEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^production-skill-release-eval-canary-\d{8}T\d{4}Z-/,
      `${requestId} must be a production skill release runtime probe`
    );
  }

  for (const versionId of productionSkillReleaseEvalCanaryEvidence.skillVersionIds) {
    assert.ok(skillVersionIds.has(versionId), `${versionId} must link a skill version`);
  }

  for (const metricId of productionSkillReleaseEvalCanaryEvidence.canaryMetricIds) {
    assert.ok(canaryMetricIds.has(metricId), `${metricId} must link a canary metric`);
  }

  for (const evidenceId of productionSkillReleaseEvalCanaryEvidence.releaseEvidenceIds) {
    assert.ok(releaseEvidenceIds.has(evidenceId), `${evidenceId} must link release evidence`);
  }

  for (const auditRef of productionSkillReleaseEvalCanaryEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }

  const requiredAreas = new Set([
    "eval_suite_gate",
    "canary_threshold_gate",
    "release_notes_gate",
    "rollback_gate",
    "gate_blocker_preservation"
  ]);

  for (const area of evidenceFile.coverage.map((item) => item.area)) {
    assert.ok(requiredAreas.has(area), `${area} is not an expected production skill evidence area`);
  }

  for (const coverage of productionSkillReleaseEvalCanaryEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("production"), `${coverage.area} must describe production runtime`);
    assert.match(
      coverage.runtimeProbe,
      /eval|canary|release-note|rollback|release-gate|skill/i,
      `${coverage.area} must cover skill release/eval/canary enforcement`
    );
    assert.ok(coverage.deploymentEvidence.length > 120, `${coverage.area} needs deployment evidence`);
    assert.ok(coverage.rbacAuditEvidence.length > 120, `${coverage.area} needs RBAC and audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes("ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json"),
      `${coverage.area} must cite the production evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) => skillVersionIds.has(ref) || canaryMetricIds.has(ref) || releaseEvidenceIds.has(ref) || auditIds.has(ref)
      ),
      `${coverage.area} needs validator-resolvable skill, canary, release, or audit refs`
    );
  }

  assert.deepEqual([...requiredAreas], [], "production skill evidence is missing coverage areas");
  assert.deepEqual(
    evidenceFile.runtime_request_ids,
    productionSkillReleaseEvalCanaryEvidence.runtimeRequestIds,
    "evidence file and admin fixture runtime probe ids must match"
  );

  const skillCheck = gateFixture.checks.find((check) => check.check_id === "production_skill_release_eval_canary");
  assert.ok(skillCheck, "production gate needs skill release/eval/canary check");
  assert.equal(skillCheck.status, "pass", "validated production skill evidence should clear only its check");
  assert.ok(
    skillCheck.evidence_ref.includes(productionSkillReleaseEvalCanaryEvidence.evidencePath),
    "production skill check must cite the production runtime evidence path"
  );

  const skillDoNotLaunch = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === productionSkillReleaseEvalCanaryEvidence.doNotLaunchConditionId
  );
  assert.ok(skillDoNotLaunch, "production do-not-launch fixture needs skill condition");
  assert.equal(
    skillDoNotLaunch.is_present,
    false,
    "validated production skill runtime evidence should clear the matching do-not-launch condition"
  );
  assert.ok(
    skillDoNotLaunch.evidence_ref.includes(productionSkillReleaseEvalCanaryEvidence.evidencePath),
    "cleared production skill do-not-launch condition must cite the production runtime evidence path"
  );

  for (const blocker of productionSkillReleaseEvalCanaryEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the production gate fixture`);
    assert.equal(check.status, "blocked", `${blocker} must stay blocked after skill release/eval/canary clears`);
  }

  assert.ok(
    gateFixture.do_not_launch_checks.some((condition) => condition.is_present === true),
    "aggregate production gate must remain blocked by other do-not-launch conditions"
  );
});

test("production security launch check evidence clears only the production security check", () => {
  assert.ok(existsSync(productionSecurityLaunchCheckPath), "production security launch evidence file is missing");
  assert.ok(existsSync(productionGatePath), "production launch gate evidence fixture is missing");

  const evidenceFile = JSON.parse(readFileSync(productionSecurityLaunchCheckPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(productionGatePath, "utf8"));

  assert.equal(
    productionSecurityLaunchCheckEvidence.id,
    evidenceFile.evidence_id,
    "admin fixture must match production security evidence id"
  );
  assert.equal(productionSecurityLaunchCheckEvidence.environment, "production", "evidence must be production scoped");
  assert.equal(evidenceFile.environment, "production", "evidence file must be production scoped");
  assert.equal(
    productionSecurityLaunchCheckEvidence.status,
    "pass_with_blockers_preserved",
    "production security evidence must preserve unrelated blockers"
  );
  assert.equal(
    productionSecurityLaunchCheckEvidence.releaseGateCheckId,
    "production_security_launch_checks",
    "evidence must bind the production security check"
  );
  assert.deepEqual(
    productionSecurityLaunchCheckEvidence.doNotLaunchConditionIds,
    ["security_privacy_legal_incomplete", "secret_exposure_runtime_not_verified"],
    "security evidence must clear only security and secret-exposure blockers"
  );
  assert.equal(
    productionSecurityLaunchCheckEvidence.gateImpact.canClearCheckLevelItem,
    true,
    "validated evidence should clear only the check-level production security checklist item"
  );
  assert.equal(
    productionSecurityLaunchCheckEvidence.gateImpact.aggregateProductionGateStatus,
    "blocked_by_other_production_runtime_items",
    "security evidence must not close the aggregate production gate"
  );

  for (const requestId of productionSecurityLaunchCheckEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^production-security-launch-checks-\d{8}T\d{4}Z-/,
      `${requestId} must be a production security runtime probe`
    );
  }

  const requiredAreas = new Set([
    "secure_session_cookie",
    "csrf_same_site_enforcement",
    "secret_exposure_redaction",
    "admin_surface_privacy",
    "gate_blocker_preservation"
  ]);

  for (const area of evidenceFile.coverage.map((item) => item.area)) {
    assert.ok(requiredAreas.has(area), `${area} is not an expected production security evidence area`);
  }

  for (const coverage of productionSecurityLaunchCheckEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("production"), `${coverage.area} must describe production runtime`);
    assert.match(
      coverage.runtimeProbe,
      /cookie|csrf|same-site|secret|redaction|privacy|release-gate|admin/i,
      `${coverage.area} must cover security launch enforcement`
    );
    assert.ok(coverage.deploymentEvidence.length > 120, `${coverage.area} needs deployment evidence`);
    assert.ok(coverage.securityAuditEvidence.length > 120, `${coverage.area} needs security audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes("ops/evidence/production/20260527T1700Z-security-launch-checks.json"),
      `${coverage.area} must cite the production evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          supportTicketIds.has(ref) ||
          traceIds.has(ref) ||
          exportIds.has(ref) ||
          crawlerFindingIds.has(ref) ||
          abuseEventById.has(ref) ||
          ref.startsWith("rbac-") ||
          ref.startsWith("rb-production-") ||
          ref.startsWith("eg-")
      ),
      `${coverage.area} needs validator-resolvable admin security evidence refs`
    );
  }

  assert.deepEqual([...requiredAreas], [], "production security evidence is missing coverage areas");
  assert.deepEqual(
    evidenceFile.runtime_request_ids,
    productionSecurityLaunchCheckEvidence.runtimeRequestIds,
    "evidence file and admin fixture runtime probe ids must match"
  );

  for (const auditRef of productionSecurityLaunchCheckEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }

  const securityCheck = gateFixture.checks.find((check) => check.check_id === "production_security_launch_checks");
  assert.ok(securityCheck, "production gate needs security launch check");
  assert.equal(securityCheck.status, "pass", "validated production security evidence should clear only its check");
  assert.ok(
    securityCheck.evidence_ref.includes(productionSecurityLaunchCheckEvidence.evidencePath),
    "production security check must cite the production runtime evidence path"
  );

  for (const conditionId of productionSecurityLaunchCheckEvidence.doNotLaunchConditionIds) {
    const condition = gateFixture.do_not_launch_checks.find((entry) => entry.condition_id === conditionId);
    assert.ok(condition, `${conditionId} must exist in production do-not-launch checks`);
    assert.equal(condition.is_present, false, `${conditionId} should be cleared by security launch evidence`);
    assert.ok(
      condition.evidence_ref.includes(productionSecurityLaunchCheckEvidence.evidencePath),
      `${conditionId} must cite the security launch evidence path`
    );
  }

  for (const blocker of productionSecurityLaunchCheckEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the production gate fixture`);
    assert.equal(check.status, "blocked", `${blocker} must stay blocked after security launch evidence clears`);
  }

  assert.ok(
    gateFixture.do_not_launch_checks.some((condition) => condition.is_present === true),
    "aggregate production gate must remain blocked by other do-not-launch conditions"
  );
});

test("production backup rollback incident evidence stays blocked until upstream gates pass", () => {
  assert.ok(existsSync(productionBackupRollbackIncidentPath), "production backup rollback incident evidence file is missing");
  assert.ok(existsSync(productionGatePath), "production launch gate evidence fixture is missing");

  const evidenceFile = JSON.parse(readFileSync(productionBackupRollbackIncidentPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(productionGatePath, "utf8"));

  assert.equal(
    productionBackupRollbackIncidentEvidence.id,
    evidenceFile.evidence_id,
    "admin fixture must match production backup rollback incident evidence id"
  );
  assert.equal(productionBackupRollbackIncidentEvidence.environment, "production", "evidence must be production scoped");
  assert.equal(evidenceFile.environment, "production", "evidence file must be production scoped");
  assert.equal(
    productionBackupRollbackIncidentEvidence.status,
    "blocked_by_upstream_gates",
    "production backup rollback evidence must stay blocked while CI and staging gates are not ready"
  );
  assert.equal(
    productionBackupRollbackIncidentEvidence.releaseGateCheckId,
    "production_backup_rollback_incident",
    "evidence must bind the production backup rollback incident check"
  );
  assert.deepEqual(
    productionBackupRollbackIncidentEvidence.doNotLaunchConditionIds,
    ["backup_restore_rollback_smoke_missing", "production_deploy_rollback_smoke_missing"],
    "backup rollback evidence must bind only backup and deploy rollback smoke blockers"
  );
  assert.equal(
    productionBackupRollbackIncidentEvidence.gateImpact.canClearCheckLevelItems,
    false,
    "Rev2 forbids clearing production backup rollback evidence before upstream gates pass"
  );
  assert.equal(
    productionBackupRollbackIncidentEvidence.gateImpact.aggregateProductionGateStatus,
    "blocked_by_upstream_and_other_production_runtime_items",
    "backup rollback evidence must preserve aggregate production no-go state"
  );
  assert.ok(
    productionBackupRollbackIncidentEvidence.gateImpact.remainingBlockers.includes("ci_staging_gates_not_passed"),
    "backup rollback evidence must preserve the upstream CI/staging blocker"
  );
  assert.ok(
    !productionBackupRollbackIncidentEvidence.gateImpact.checklistItems.includes("Production post-deploy smoke tests 通过。"),
    "ambiguous production post-deploy smoke checklist label must not appear in admin gate impact metadata"
  );
  assert.ok(
    productionBackupRollbackIncidentEvidence.gateImpact.checklistItems.some((item) =>
      item.includes("admin-visible probe evidence recorded but launch blocker preserved")
    ),
    "admin gate impact must name the explicit non-closure probe checklist row"
  );
  assert.ok(
    productionBackupRollbackIncidentEvidence.gateImpact.checklistItems.some((item) =>
      item.includes("Production post-deploy launch-clearing smoke evidence")
    ),
    "admin gate impact must name the explicit launch-clearing split checklist row"
  );

  for (const requestId of productionBackupRollbackIncidentEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^production-backup-rollback-incident-\d{8}T\d{4}Z-/,
      `${requestId} must be a production backup rollback incident runtime probe`
    );
  }

  const requiredAreas = new Set([
    "backup_restore",
    "rollback_drill",
    "incident_alert_path",
    "post_deploy_smoke",
    "gate_blocker_preservation"
  ]);

  for (const area of evidenceFile.coverage.map((item) => item.area)) {
    assert.ok(requiredAreas.has(area), `${area} is not an expected production backup rollback evidence area`);
  }

  for (const coverage of productionBackupRollbackIncidentEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.ok(["pass", "blocked"].includes(coverage.status), `${coverage.area} has invalid status`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("production"), `${coverage.area} must describe production runtime`);
    assert.match(
      coverage.runtimeProbe,
      /restore|rollback|incident|alert|smoke|release-gate|backup|migration/i,
      `${coverage.area} must cover production operations readiness`
    );
    assert.ok(coverage.deploymentEvidence.length > 120, `${coverage.area} needs deployment evidence`);
    assert.ok(coverage.operationalAuditEvidence.length > 120, `${coverage.area} needs operational audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes(productionBackupRollbackIncidentEvidence.evidencePath),
      `${coverage.area} must cite the production evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          incidentIds.has(ref) ||
          operationalDashboardIds.has(ref) ||
          alertRouteIds.has(ref) ||
          supportTicketIds.has(ref) ||
          taskIds.has(ref) ||
          abuseHookIds.has(ref) ||
          ref.startsWith("sv-") ||
          ref.startsWith("cg-")
      ),
      `${coverage.area} needs validator-resolvable operations evidence refs`
    );

    if (coverage.area === "gate_blocker_preservation") {
      assert.equal(coverage.status, "blocked", "gate preservation must remain blocked by upstream gate policy");
      assert.match(
        coverage.runtimeProbe,
        /CI and Private Beta\/Staging gates remain blocked/i,
        "gate preservation must name the upstream blocker"
      );
    } else {
      assert.equal(coverage.status, "pass", `${coverage.area} probe should be present for admin review`);
    }
  }

  assert.deepEqual([...requiredAreas], [], "production backup rollback evidence is missing coverage areas");
  assert.equal(
    productionBackupRollbackIncidentEvidence.splitReadiness.length,
    2,
    "production backup rollback evidence must expose both launch-clearing split blockers"
  );
  assert.deepEqual(
    productionBackupRollbackIncidentEvidence.splitReadiness.map((entry) => entry.split).sort(),
    ["backup_restore", "rollback_incident_smoke"],
    "production split readiness must separate backup restore from rollback incident smoke"
  );

  for (const split of productionBackupRollbackIncidentEvidence.splitReadiness) {
    assert.equal(
      split.status,
      "blocked_until_exact_split_file",
      `${split.split} must remain blocked until exact split evidence exists`
    );
    assert.match(
      split.exactEvidencePath,
      /^ops\/evidence\/production\/(backup-restore|rollback-incident-post-deploy-smoke)\.json$/,
      `${split.split} must name the exact launch-clearing production evidence path`
    );
    assert.ok(
      split.requiredRuntimeProof.length >= 5,
      `${split.split} must enumerate required runtime proof`
    );
    assert.ok(
      split.upstreamBlockers.includes("ci_staging_gates_not_passed"),
      `${split.split} must preserve upstream CI/staging blocker`
    );
    assert.match(
      split.adminReviewSurface,
      /Operations page/i,
      `${split.split} must bind review to the admin operations surface`
    );
    assert.match(
      split.checklistItem,
      /Production (backup\/restore|rollback\/incident\/post-deploy smoke) runtime evidence/,
      `${split.split} must map to the exact unchecked Rev2 checklist row`
    );
  }

  assert.deepEqual(
    evidenceFile.runtime_request_ids,
    productionBackupRollbackIncidentEvidence.runtimeRequestIds,
    "evidence file and admin fixture runtime probe ids must match"
  );

  for (const auditRef of productionBackupRollbackIncidentEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }

  for (const incidentId of productionBackupRollbackIncidentEvidence.incidentIds) {
    assert.ok(incidentIds.has(incidentId), `${incidentId} must link a known incident`);
  }

  for (const dashboardId of productionBackupRollbackIncidentEvidence.dashboardIds) {
    assert.ok(operationalDashboardIds.has(dashboardId), `${dashboardId} must link a known dashboard`);
  }

  for (const alertRouteId of productionBackupRollbackIncidentEvidence.alertRouteIds) {
    assert.ok(alertRouteIds.has(alertRouteId), `${alertRouteId} must link a known alert route`);
  }

  const backupCheck = gateFixture.checks.find((check) => check.check_id === "production_backup_rollback_incident");
  assert.ok(backupCheck, "production gate needs backup rollback incident check");
  assert.equal(backupCheck.status, "blocked", "backup rollback incident check must remain blocked until upstream gates pass");
  assert.ok(
    backupCheck.evidence_ref.includes(productionBackupRollbackIncidentEvidence.evidencePath),
    "production backup rollback check must cite the current production operations evidence path"
  );

  for (const conditionId of productionBackupRollbackIncidentEvidence.doNotLaunchConditionIds) {
    const condition = gateFixture.do_not_launch_checks.find((entry) => entry.condition_id === conditionId);
    assert.ok(condition, `${conditionId} must exist in production do-not-launch checks`);
    assert.equal(condition.is_present, true, `${conditionId} must remain present while upstream gates are blocked`);
    assert.ok(
      condition.evidence_ref.includes(productionBackupRollbackIncidentEvidence.evidencePath),
      `${conditionId} must cite the production operations evidence path`
    );
  }

  assert.ok(
    gateFixture.gate_decision.blocked_by_checks.includes("production_backup_rollback_incident"),
    "aggregate gate must keep backup rollback check blocked"
  );
  assert.ok(
    gateFixture.gate_decision.active_do_not_launch_conditions.includes("ci_staging_gates_not_passed"),
    "aggregate gate must preserve upstream CI/staging blocker"
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

test("export regeneration runtime decisions preserve submit, review, and block gates", () => {
  const { buildExportRegenerationRuntimeDecisions } = parseExportRuntime();
  const decisions = buildExportRegenerationRuntimeDecisions(exportJobs);
  const byExport = new Map(decisions.map((decision) => [decision.exportId, decision]));

  assert.equal(decisions.length, exportJobs.length, "every export job needs a runtime decision");
  assert.ok(decisions.some((decision) => decision.decision === "submit_ready"), "runtime needs a submit-ready export");
  assert.ok(decisions.some((decision) => decision.decision === "review_required"), "runtime needs a review-gated export");
  assert.ok(decisions.some((decision) => decision.decision === "blocked"), "runtime needs a blocked export");

  for (const job of exportJobs) {
    const decision = byExport.get(job.id);
    assert.ok(decision, `${job.id} is missing runtime decision`);
    assert.equal(decision.supportTicketId, job.supportTicketId, `${job.id} support ticket mismatch`);
    assert.equal(decision.idempotencyKey, job.idempotencyKey, `${job.id} idempotency key mismatch`);
    assert.equal(decision.requestedByRole, job.requestedByRole, `${job.id} requested role mismatch`);
    assert.equal(decision.requiredRole, job.requiredRole, `${job.id} required role mismatch`);
    assert.equal(decision.rbacDecision, job.rbacDecision, `${job.id} RBAC decision mismatch`);
    assert.ok(decision.operatorAction.length > 80, `${job.id} needs actionable operator guidance`);
    assert.ok(decision.submitDisabledReason.length > 60, `${job.id} needs submit disabled reason`);

    if (job.quotaEffect === "none") {
      assert.equal(decision.quotaSettlement, "no_quota_change", `${job.id} should normalize no quota change`);
    } else {
      assert.equal(decision.quotaSettlement, job.quotaEffect, `${job.id} quota settlement mismatch`);
    }

    if (job.rbacDecision === "allowed") {
      assert.equal(decision.decision, "submit_ready", `${job.id} allowed export should be submit-ready`);
      assert.deepEqual(decision.blockerCodes, [], `${job.id} submit-ready export cannot have blockers`);
      assert.equal(decision.auditStatus, "attached", `${job.id} submit-ready export needs attached audit`);
      assert.equal(decision.closureEvidenceStatus, "complete", `${job.id} submit-ready export needs complete closure evidence`);
    }

    if (job.rbacDecision === "second_review_required") {
      assert.equal(decision.decision, "review_required", `${job.id} pending second review must stay review-gated`);
      assert.ok(decision.blockerCodes.includes("SECOND_REVIEW_REQUIRED"), `${job.id} needs second-review blocker`);
      assert.ok(decision.blockerCodes.includes("PENDING_AUDIT"), `${job.id} needs pending-audit blocker`);
    }

    if (job.qaSeverity === "blocking") {
      assert.equal(decision.decision, "blocked", `${job.id} blocking QA must block regeneration`);
      assert.equal(decision.qaGate, "blocking_denied", `${job.id} blocking QA needs denied QA gate`);
      assert.ok(decision.blockerCodes.includes("BLOCKING_QA"), `${job.id} needs blocking-QA blocker`);
      assert.ok(decision.blockerCodes.includes("RBAC_DENIED"), `${job.id} needs RBAC-denied blocker`);
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
    "admin_security",
    "legal_support_visibility"
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
          ref.startsWith("rb-") ||
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
    backendMetricsRuntimeEvidence.remainingBlockers.includes("staging backup/restore/load runtime evidence"),
    "metrics evidence must preserve restore/load blocker"
  );
  assert.ok(
    !backendMetricsRuntimeEvidence.remainingBlockers.includes("staging request id propagation runtime evidence"),
    "metrics evidence should no longer preserve request-id blocker after telemetry evidence closes it"
  );
  assert.ok(
    !backendMetricsRuntimeEvidence.remainingBlockers.includes("staging structured JSON logs runtime evidence"),
    "metrics evidence should no longer preserve structured-log blocker after telemetry evidence closes it"
  );
  assert.ok(
    !backendMetricsRuntimeEvidence.remainingBlockers.includes("staging OpenTelemetry traces runtime evidence"),
    "metrics evidence should no longer preserve trace blocker after telemetry evidence closes it"
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

test("observability telemetry runtime evidence validates staging request ids logs and traces without closing aggregate gate", () => {
  assert.ok(existsSync(stagingObservabilityTelemetryPath), "staging observability telemetry evidence file is missing");
  const evidenceFile = JSON.parse(readFileSync(stagingObservabilityTelemetryPath, "utf8"));

  assert.equal(evidenceFile.environment, "staging", "telemetry evidence file must be staging scoped");
  assert.equal(
    evidenceFile.status,
    "pass_with_blockers_preserved",
    "telemetry evidence must pass while preserving restore/load/smoke blockers"
  );
  assert.equal(
    evidenceFile.release_gate_check_id,
    "staging_observability_backup_load",
    "telemetry evidence must stay inside the observability backup/load gate"
  );
  assert.equal(
    evidenceFile.gate_impact.can_clear_checklist_items,
    true,
    "telemetry evidence should clear only the telemetry checklist rows"
  );
  assert.equal(
    evidenceFile.gate_impact.can_clear_aggregate_item,
    false,
    "telemetry evidence cannot clear the aggregate observability/backup/load item"
  );
  assert.equal(
    evidenceFile.gate_impact.aggregate_private_beta_gate_status,
    "blocked_by_other_staging_runtime_items",
    "telemetry evidence must preserve the private beta aggregate blocker"
  );

  assert.equal(observabilityTelemetryRuntimeEvidence.environment, "staging", "admin telemetry evidence must be staging scoped");
  assert.equal(
    observabilityTelemetryRuntimeEvidence.evidencePath,
    "ops/evidence/staging/20260527T1815Z-observability-telemetry.json",
    "admin fixture must point at the telemetry evidence file"
  );
  assert.equal(
    observabilityTelemetryRuntimeEvidence.canClearChecklistItems,
    true,
    "telemetry checklist rows should be clearable"
  );
  assert.ok(
    observabilityTelemetryRuntimeEvidence.remainingBlockers.includes("staging backup/restore/load runtime evidence"),
    "telemetry evidence must preserve backup/restore/load blocker"
  );
  assert.ok(
    observabilityTelemetryRuntimeEvidence.remainingBlockers.includes("staging post-deploy smoke tests"),
    "telemetry evidence must preserve staging smoke blocker"
  );
  assert.ok(
    observabilityTelemetryRuntimeEvidence.remainingBlockers.includes("staging load evidence"),
    "telemetry evidence must preserve load blocker"
  );

  const requiredAreas = new Set(["request_id_propagation", "structured_json_logs", "opentelemetry_traces"]);
  const requiredServices = ["admin_console", "backend_api", "worker", "crawler"];
  const runtimeFileRefs = new Set(evidenceFile.runtime_refs);
  const runtimeFileResults = new Map(evidenceFile.telemetry_results.map((result) => [result.area, result]));

  for (const item of [
    "staging request id propagation runtime evidence 通过。",
    "staging structured JSON logs runtime evidence 通过。",
    "staging OpenTelemetry traces runtime evidence 通过。"
  ]) {
    assert.ok(observabilityTelemetryRuntimeEvidence.closedChecklistItems.includes(item), `missing closed checklist item ${item}`);
    assert.ok(evidenceFile.closed_checklist_items.includes(item), `evidence file missing closed checklist item ${item}`);
  }

  for (const control of observabilityTelemetryRuntimeEvidence.controls) {
    requiredAreas.delete(control.area);
    const fileResult = runtimeFileResults.get(control.area);
    assert.ok(fileResult, `${control.area} missing telemetry evidence file result`);
    assert.equal(fileResult.runtime_ref, control.runtimeRef, `${control.area} runtime ref mismatch`);
    assert.equal(fileResult.validation_status, control.validationStatus, `${control.area} status mismatch`);
    assert.deepEqual(fileResult.services, control.services, `${control.area} services mismatch`);
    assert.equal(fileResult.audit_ref, control.auditRef, `${control.area} audit mismatch`);
    assert.equal(control.validationStatus, "verified", `${control.area} telemetry probe must be verified`);
    assert.ok(runtimeFileRefs.has(control.runtimeRef), `${control.area} runtime ref must appear in evidence file`);
    assert.ok(auditIds.has(control.auditRef), `${control.area} links unknown audit ${control.auditRef}`);
    assert.ok(control.services.length === requiredServices.length, `${control.area} must cover every runtime service`);

    for (const service of requiredServices) {
      assert.ok(control.services.includes(service), `${control.area} missing service ${service}`);
    }

    assert.ok(control.propagationProbe.length > 150, `${control.area} needs propagation proof`);
    assert.ok(control.redactionProbe.length > 140, `${control.area} needs redaction proof`);
    assert.ok(control.traceLinkageProbe.length > 120, `${control.area} needs trace linkage proof`);
    assert.ok(control.releaseGateUse.length > 120, `${control.area} needs release-gate use proof`);
    assert.ok(control.evidenceRefs.includes(observabilityTelemetryRuntimeEvidence.id), `${control.area} evidence must include parent evidence`);
    assert.ok(control.evidenceRefs.includes(control.runtimeRef), `${control.area} evidence must include runtime ref`);
    assert.ok(control.evidenceRefs.includes(control.auditRef), `${control.area} evidence must include audit`);
    assert.match(
      `${control.redactionProbe} ${fileResult.redaction_probe}`,
      /omitted|rejected|absent|redact/i,
      `${control.area} needs redaction proof in fixture and evidence file`
    );
    assert.match(
      `${control.traceLinkageProbe} ${fileResult.trace_linkage_probe}`,
      /tr-1004|audit|request/i,
      `${control.area} needs trace or audit linkage proof`
    );
  }

  assert.deepEqual([...requiredAreas], [], "telemetry evidence must cover request id, structured logs, and traces");
  assert.equal(
    evidenceFile.telemetry_results.length,
    observabilityTelemetryRuntimeEvidence.controls.length,
    "telemetry evidence file and admin fixture must cover the same control count"
  );
});

test("observability backup load preflight exposes verified observability, restore, load, and smoke slots", () => {
  assert.ok(existsSync(stagingObservabilityBackupLoadPreflightPath), "staging observability backup/load preflight evidence file is missing");
  const evidenceFile = JSON.parse(readFileSync(stagingObservabilityBackupLoadPreflightPath, "utf8"));

  assert.equal(stagingObservabilityBackupLoadPreflightEvidence.environment, "staging", "preflight fixture must be staging scoped");
  assert.equal(stagingObservabilityBackupLoadPreflightEvidence.status, "passed", "admin preflight must expose the passing combined gate state");
  assert.equal(
    stagingObservabilityBackupLoadPreflightEvidence.releaseGateCheckId,
    "staging_observability_backup_load",
    "preflight must bind to the combined observability backup/load release gate"
  );
  assert.equal(
    stagingObservabilityBackupLoadPreflightEvidence.evidencePath,
    "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
    "admin fixture must point at the latest passing preflight report"
  );
  assert.equal(
    stagingObservabilityBackupLoadPreflightEvidence.canClearAggregateItem,
    true,
    "admin console can mark observability backup/load complete only after all slots verify"
  );
  assert.equal(
    stagingObservabilityBackupLoadPreflightEvidence.preservedDoNotLaunchConditionId,
    "none",
    "passing preflight must not preserve the restore/load do-not-launch condition"
  );
  assert.equal(
    stagingObservabilityBackupLoadPreflightEvidence.preservedReleaseGateCheckId,
    "none",
    "passing preflight must not preserve the release gate check"
  );
  assert.match(
    stagingObservabilityBackupLoadPreflightEvidence.operatorAction,
    /object-storage signed download\/retention blocked/,
    "operator action must preserve the remaining object-storage private-beta blocker"
  );

  const fixtureSlots = new Map(stagingObservabilityBackupLoadPreflightEvidence.slots.map((slot) => [slot.slot, slot]));
  const fileSlots = new Map(evidenceFile.checks.map((slot) => [slot.slot, slot]));
  for (const slot of ["observability_evidence", "backup_restore_evidence", "load_evidence", "post_deploy_smoke_evidence"]) {
    assert.ok(fixtureSlots.has(slot), `admin fixture missing ${slot}`);
    assert.ok(fileSlots.has(slot), `preflight file missing ${slot}`);
  }

  assert.equal(evidenceFile.status, "passed", "preflight file must be passing");
  assert.deepEqual(evidenceFile.blocked_slots, [], "passing preflight cannot list blocked slots");
  assert.equal(evidenceFile.gate_impact.can_clear_aggregate_item, true, "preflight file must allow aggregate closure");
  assert.equal(evidenceFile.gate_impact.preserved_do_not_launch_condition_id, null, "preflight file must clear restore/load condition preservation");
  assert.equal(evidenceFile.gate_impact.preserved_release_gate_check_id, null, "preflight file must clear release-gate preservation");

  const expectedEntries = {
    observability_evidence: [
      "request_id_propagation",
      "structured_json_logs",
      "opentelemetry_traces",
      "backend_worker_crawler_metrics",
      "dashboard_import",
      "alert_routes"
    ],
    backup_restore_evidence: ["object_restore", "postgres_restore"],
    load_evidence: [
      "chat_task",
      "crawler_throttle",
      "quota_contention",
      "signed_download",
      "worker_generation",
      "workspace_rendering",
      "zip_export"
    ],
    post_deploy_smoke_evidence: [
      "admin",
      "auth_boundary",
      "backend_health",
      "crawler_admin",
      "export_package",
      "observability",
      "quota_rate_limit",
      "signed_download",
      "web",
      "worker_task"
    ]
  };

  for (const [slotName, entries] of Object.entries(expectedEntries)) {
    const slot = fixtureSlots.get(slotName);
    const fileSlot = fileSlots.get(slotName);
    assert.equal(slot.status, "verified", `${slotName} must be verified`);
    assert.equal(fileSlot.verified, true, `preflight file must verify ${slotName}`);
    assert.equal(slot.blockingReason, "none", `${slotName} must not retain a blocking reason`);
    assert.deepEqual(slot.missingEntries, [], `${slotName} cannot list missing entries`);
    assert.deepEqual(fileSlot.missing_entries, [], `preflight file cannot list missing ${slotName} entries`);
    for (const entry of entries) {
      assert.ok(slot.requiredEntries.includes(entry), `${slotName} missing required fixture entry ${entry}`);
      assert.ok(slot.verifiedEntries.includes(entry), `${slotName} missing verified fixture entry ${entry}`);
      assert.ok(fileSlot.entry_evidence_refs[entry]?.length > 0, `${slotName} file entry ${entry} needs evidence refs`);
    }
  }

  assert.deepEqual(
    stagingObservabilityBackupLoadPreflightEvidence.slots
      .filter((slot) => slot.status === "blocked")
      .map((slot) => slot.slot),
    [],
    "no observability backup/load slots should block after combined preflight passes"
  );
});

test("object storage retention cleanup gate stays blocked until exact staging probe evidence passes", () => {
  const operationsPage = readFileSync(
    new URL("../app/operations/page.tsx", import.meta.url),
    "utf8"
  );

  for (const token of [
    "Object Storage Retention Cleanup",
    "Report Kind",
    "Required Script",
    "Required Artifact",
    "Canonical Pass Report",
    "Blocked Probe Report",
    "Observed Report",
    "Signed URL Evidence",
    "Missing Runtime Inputs",
    "Remaining Blockers",
    "Expected Tokens",
    "Release SHA Bound",
    "Admin Identity Bound",
    "Request ID Echo",
    "Response Bytes"
  ]) {
    assert.match(operationsPage, new RegExp(token), `operations page missing ${token}`);
  }

  assert.equal(stagingObjectStorageRetentionCleanupEvidence.environment, "staging", "retention cleanup evidence must be staging scoped");
  assert.equal(stagingObjectStorageRetentionCleanupEvidence.status, "missing_runtime", "retention cleanup must remain blocked without a passing staging probe");
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.reportKind,
    "missing",
    "static admin fixture must distinguish missing runtime from a blocked probe"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.canonicalPassReportPath,
    "ops/evidence/staging/object-storage-retention-cleanup.json",
    "admin fixture must name the exact canonical pass report"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.canonicalPassResultsPath,
    "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
    "admin fixture must name the exact canonical pass results"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.blockedProbeReportPath,
    "ops/evidence/staging/object-storage-retention-cleanup.blocked.json",
    "admin fixture must name the blocked probe report separately from the pass report"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.observedReportPath,
    "none",
    "static missing fixture cannot claim an observed runtime report"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.releaseGateCheckId,
    "staging_object_storage_signed_downloads",
    "retention cleanup evidence must bind to the object-storage release gate"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.doNotLaunchConditionId,
    "object_storage_signed_retention_runtime_missing",
    "retention cleanup evidence must preserve the object-storage Do-Not-Launch condition"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.requiredScript,
    "scripts/staging_object_storage_retention_cleanup_smoke.sh",
    "admin fixture must name the required smoke script"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.requiredArtifactPath,
    "ops/evidence/staging/object-storage-retention-cleanup.json",
    "admin fixture must name the exact required runtime artifact"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.canClearRetentionCleanupChecklistItem,
    false,
    "missing runtime evidence cannot close the retention/cleanup checklist item"
  );
  assert.equal(
    stagingObjectStorageRetentionCleanupEvidence.canClearReleaseGateCheck,
    false,
    "retention cleanup alone must not close the combined object-storage gate while missing"
  );
  assert.ok(
    stagingObjectStorageRetentionCleanupEvidence.remainingReleaseGateBlockers.includes("staging_object_storage_signed_downloads"),
    "object-storage blocker must remain preserved"
  );
  assert.ok(
    !stagingObjectStorageRetentionCleanupEvidence.remainingReleaseGateBlockers.includes("staging_legal_external_user_pages"),
    "legal/support blocker must not remain after exact staging visibility evidence passes"
  );
  assert.ok(
    stagingObjectStorageRetentionCleanupEvidence.missingRuntimeInputs.some((input) => input.includes("STAGING_BASE_URL")),
    "admin fixture must explain missing staging URL input"
  );
  assert.ok(
    stagingObjectStorageRetentionCleanupEvidence.missingRuntimeInputs.some((input) => input.includes("STAGING_ADMIN")),
    "admin fixture must explain missing staging admin credentials"
  );

  const requiredAreas = new Set(["retention_policy", "expired_export_cleanup", "orphan_cleanup", "audit_refs"]);
  for (const coverage of stagingObjectStorageRetentionCleanupEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "missing_runtime", `${coverage.area} must remain missing until staging probe passes`);
    assert.equal(coverage.smokeScript, "scripts/staging_object_storage_retention_cleanup_smoke.sh", `${coverage.area} must cite smoke script`);
    assert.ok(coverage.expectedTokens.length >= 4, `${coverage.area} needs concrete expected response tokens`);
    assert.equal(coverage.releaseShaBound, false, `${coverage.area} cannot be release-SHA-bound without runtime evidence`);
    assert.equal(coverage.adminIdentityBound, false, `${coverage.area} cannot be admin-identity-bound without runtime evidence`);
    assert.equal(coverage.requestIdEchoStatus, "not_evaluated", `${coverage.area} cannot have request-id echo before runtime evidence`);
    assert.equal(coverage.responseBytes, 0, `${coverage.area} cannot have response bytes before runtime evidence`);
    assert.ok(coverage.blocker.length > 80, `${coverage.area} needs concrete blocker text`);
    assert.ok(coverage.releaseGateUse.length > 110, `${coverage.area} needs release-gate use text`);
    assert.ok(
      coverage.evidenceRefs.includes("ops/evidence/staging/object-storage-retention-cleanup.json"),
      `${coverage.area} must cite the exact missing evidence path`
    );
    assert.ok(
      coverage.evidenceRefs.includes("scripts/staging_object_storage_retention_cleanup_smoke.sh"),
      `${coverage.area} must cite the required script`
    );
  }
  assert.deepEqual([...requiredAreas], [], "retention cleanup coverage must name all required probe areas");

  assert.match(
    blueprint,
    /- \[ \] Private Beta\/Staging object retention\/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops\/evidence\/staging\/`。/,
    "retention/cleanup checklist item must stay open until passing staging evidence exists"
  );
  assert.match(
    blueprint,
    /Private Beta\/Staging object storage pass evidence must cite both signed URL and retention\/cleanup staging files/,
    "blueprint must preserve split object-storage evidence requirement"
  );
});

test("object storage retention cleanup blocked staging probe is surfaced without closing release gates", () => {
  assert.ok(
    existsSync(stagingObjectStorageRetentionCleanupBlockedPath),
    "blocked retention cleanup probe evidence file is missing"
  );
  const blockedFile = JSON.parse(readFileSync(stagingObjectStorageRetentionCleanupBlockedPath, "utf8"));

  assert.equal(blockedFile.environment, "staging", "blocked retention evidence must be staging scoped");
  assert.equal(blockedFile.status, "blocked", "blocked retention evidence must not be pass-shaped");
  assert.equal(
    blockedFile.evidence_id,
    "object-storage-retention-cleanup",
    "blocked evidence must use the canonical retention cleanup evidence id"
  );
  assert.equal(
    blockedFile.release_gate_check_id,
    "staging_object_storage_signed_downloads",
    "blocked evidence must bind to the object-storage release gate check"
  );
  assert.equal(
    blockedFile.do_not_launch_condition_id,
    "object_storage_signed_retention_runtime_missing",
    "blocked evidence must preserve the object-storage Do-Not-Launch condition"
  );
  assert.equal(
    blockedFile.runtime_input_requirements.canonical_pass_report,
    "ops/evidence/staging/object-storage-retention-cleanup.json",
    "blocked evidence must name the exact future pass artifact"
  );
  assert.equal(
    blockedFile.runtime_input_requirements.canonical_pass_results,
    "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
    "blocked evidence must name the exact future pass NDJSON artifact"
  );
  assert.equal(
    blockedFile.gate_impact.can_clear_retention_cleanup_checklist_item,
    false,
    "blocked probe cannot clear the retention cleanup checklist item"
  );
  assert.equal(
    blockedFile.gate_impact.can_clear_release_gate_check,
    false,
    "blocked probe cannot clear the combined object-storage release gate"
  );
  assert.equal(
    blockedFile.gate_impact.preserved_do_not_launch_condition_id,
    "object_storage_signed_retention_runtime_missing",
    "blocked probe must preserve the exact do-not-launch condition"
  );

  const fromBlockedProbe = buildStagingObjectStorageRetentionCleanupEvidence(
    stagingObjectStorageRetentionCleanupEvidence,
    blockedFile
  );
  assert.equal(fromBlockedProbe.status, "blocked", "admin evidence should expose the blocked probe status");
  assert.equal(fromBlockedProbe.reportKind, "blocked_probe", "admin evidence must identify blocked probe reports");
  assert.equal(
    fromBlockedProbe.observedReportPath,
    "ops/evidence/staging/object-storage-retention-cleanup.blocked.json",
    "blocked probe evidence must not look like the canonical pass report"
  );
  assert.equal(
    fromBlockedProbe.canClearRetentionCleanupChecklistItem,
    false,
    "admin evidence cannot clear checklist from blocked probe"
  );
  assert.equal(
    fromBlockedProbe.canClearReleaseGateCheck,
    false,
    "admin evidence cannot clear release gate from blocked probe"
  );
  assert.ok(
    fromBlockedProbe.missingRuntimeInputs.every((input) =>
      /missing_staging_base_url_or_explicit_probe_urls/.test(input)
    ),
    "admin evidence should expose exact missing staging URL probe reasons"
  );
  assert.deepEqual(
    fromBlockedProbe.coverage.map((coverage) => coverage.status),
    ["blocked", "blocked", "blocked", "blocked"],
    "blocked probe must keep every retention cleanup coverage area blocked"
  );
  assert.ok(
    fromBlockedProbe.coverage.every((coverage) =>
      coverage.evidenceRefs.includes("ops/evidence/staging/object-storage-retention-cleanup.blocked.json")
    ),
    "blocked probe coverage should cite the concrete blocked evidence file"
  );
  assert.ok(
    fromBlockedProbe.coverage.every((coverage) => coverage.requestIdEchoStatus === "missing"),
    "blocked probe coverage should surface missing request-id echoes"
  );
  assert.ok(
    fromBlockedProbe.coverage.every((coverage) => coverage.responseBytes === 0),
    "blocked probe coverage cannot report response bytes"
  );

  const adminApiSource = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  assert.match(
    adminApiSource,
    /object-storage-retention-cleanup\.blocked\.json/,
    "admin API should load blocked probe evidence when canonical pass evidence is absent"
  );
  assert.match(
    adminApiSource,
    /passingReport \?\? blockedReport/,
    "admin API should prefer canonical pass evidence over blocked probe evidence"
  );
});

test("object storage retention cleanup runtime evaluator flips only on exact passing staging report", () => {
  const base = stagingObjectStorageRetentionCleanupEvidence;
  const missing = buildStagingObjectStorageRetentionCleanupEvidence(base, null);
  assert.equal(missing.status, "missing_runtime", "missing evidence must preserve the static blocker");
  assert.equal(missing.reportKind, "missing", "missing evidence must retain missing report kind");
  assert.equal(missing.canClearRetentionCleanupChecklistItem, false, "missing evidence cannot clear checklist row");
  assert.deepEqual(missing.remainingReleaseGateBlockers, ["staging_object_storage_signed_downloads"]);

  const blockedReport = {
    environment: "staging",
    status: "blocked",
    release_gate_check_id: "staging_object_storage_signed_downloads",
    do_not_launch_condition_id: "object_storage_signed_retention_runtime_missing",
    split_evidence: {
      signed_url_ready: true,
      retention_cleanup_ready: false
    },
    blocked_checks: ["expired_export_cleanup:unexpected_http_status"],
    coverage: [
      {
        area: "retention_policy",
        status: "pass",
        expected_tokens: ["retention policy", "versioning", "retention_until", "tenant"],
        evidence_refs: ["ops/evidence/staging/object-storage-retention-cleanup.json"]
      }
    ],
    gate_impact: {
      can_clear_retention_cleanup_checklist_item: false,
      can_clear_release_gate_check: false,
      remaining_release_gate_blockers_after_pass: ["staging_object_storage_signed_downloads"]
    }
  };
  const blocked = buildStagingObjectStorageRetentionCleanupEvidence(base, blockedReport);
  assert.equal(blocked.status, "blocked", "non-passing report must stay blocked");
  assert.equal(blocked.reportKind, "blocked_probe", "blocked reports must be classified separately from pass evidence");
  assert.equal(
    blocked.observedReportPath,
    "ops/evidence/staging/object-storage-retention-cleanup.blocked.json",
    "blocked reports must surface the blocked probe path"
  );
  assert.equal(blocked.canClearReleaseGateCheck, false, "blocked report cannot clear release gate");
  assert.ok(
    blocked.missingRuntimeInputs.includes("expired_export_cleanup:unexpected_http_status"),
    "blocked report should expose exact failed probe reason"
  );

  const passingReport = {
    evidence_id: "object-storage-retention-cleanup",
    environment: "staging",
    status: "pass",
    results_path: "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
    admin_user_id: "admin-ops-17",
    admin_tenant_id: "tenant-alpha",
    release_gate_check_id: "staging_object_storage_signed_downloads",
    do_not_launch_condition_id: "object_storage_signed_retention_runtime_missing",
    split_evidence: {
      signed_url_ready: true,
      release_sha_matches_signed_url: true,
      retention_cleanup_ready: true,
      canonical_pass_paths: true
    },
    coverage: [
      {
        area: "retention_policy",
        status: "pass",
        runtime_probe: "Staging object storage retention policy probe verified tenant retention policy, versioning, retention_until, and audit context.",
        expected_tokens: ["retention policy", "versioning", "retention_until", "tenant"],
        release_sha_bound: true,
        admin_identity_bound: true,
        response_bytes: 812,
        evidence_refs: ["ops/evidence/staging/object-storage-retention-cleanup.json", "au-007"],
        source_results: [
          {
            method: "GET",
            url: "https://staging.example.test/api/admin/v1/object-storage/retention-policy",
            request_id: "stage0-object-retention-cleanup-retention_policy",
            request_id_echoed: true,
            response_bytes: 812
          }
        ]
      },
      {
        area: "expired_export_cleanup",
        status: "pass",
        runtime_probe: "Staging expired export cleanup probe verified deleted and retained object decisions with immutable audit refs.",
        expected_tokens: ["expired export cleanup", "deleted", "retained", "audit"],
        release_sha_bound: true,
        admin_identity_bound: true,
        response_bytes: 1044,
        evidence_refs: ["ops/evidence/staging/object-storage-retention-cleanup.json", "ex-909", "au-007"],
        source_results: [
          {
            method: "POST",
            url: "https://staging.example.test/api/admin/v1/object-storage/cleanup/expired-exports",
            request_id: "stage0-object-retention-cleanup-expired_export_cleanup",
            request_id_echoed: true,
            response_bytes: 1044
          }
        ]
      },
      {
        area: "orphan_cleanup",
        status: "pass",
        runtime_probe: "Staging orphan cleanup probe verified deleted and retained orphan decisions with immutable audit refs.",
        expected_tokens: ["orphan cleanup", "deleted", "retained", "audit"],
        release_sha_bound: true,
        admin_identity_bound: true,
        response_bytes: 976,
        evidence_refs: ["ops/evidence/staging/object-storage-retention-cleanup.json", "au-015"],
        source_results: [
          {
            method: "POST",
            url: "https://staging.example.test/api/admin/v1/object-storage/cleanup/orphans",
            request_id: "stage0-object-retention-cleanup-orphan_cleanup",
            request_id_echoed: true,
            response_bytes: 976
          }
        ]
      },
      {
        area: "audit_refs",
        status: "pass",
        runtime_probe: "Staging object_storage_cleanup audit probe verified admin and tenant audit context.",
        expected_tokens: ["audit", "object_storage_cleanup", "admin", "tenant"],
        release_sha_bound: true,
        admin_identity_bound: true,
        response_bytes: 1288,
        evidence_refs: ["ops/evidence/staging/object-storage-retention-cleanup.json", "au-007", "au-015"],
        source_results: [
          {
            method: "GET",
            url: "https://staging.example.test/api/admin/v1/audit?subject=object_storage_cleanup&limit=20",
            request_id: "stage0-object-retention-cleanup-audit_refs",
            request_id_echoed: true,
            response_bytes: 1288
          }
        ]
      }
    ],
    gate_impact: {
      can_clear_retention_cleanup_checklist_item: true,
      can_clear_release_gate_check: true,
      remaining_release_gate_blockers_after_pass: []
    }
  };
  const passing = buildStagingObjectStorageRetentionCleanupEvidence(base, passingReport);
  assert.equal(passing.id, "object-storage-retention-cleanup");
  assert.equal(passing.status, "pass", "passing exact report should flip admin evidence to pass");
  assert.equal(passing.reportKind, "canonical_pass", "passing exact report must identify canonical pass evidence");
  assert.equal(
    passing.observedReportPath,
    "ops/evidence/staging/object-storage-retention-cleanup.json",
    "passing exact report must surface the canonical pass artifact"
  );
  assert.equal(passing.canClearRetentionCleanupChecklistItem, true);
  assert.equal(passing.canClearReleaseGateCheck, true);
  assert.deepEqual(passing.remainingReleaseGateBlockers, []);
  assert.deepEqual(passing.missingRuntimeInputs, []);
  assert.equal(new Set(passing.coverage.map((coverage) => coverage.status)).size, 1);
  assert.ok(passing.coverage.every((coverage) => coverage.status === "pass"));
  assert.ok(passing.coverage.every((coverage) => coverage.releaseShaBound === true));
  assert.ok(passing.coverage.every((coverage) => coverage.adminIdentityBound === true));
  assert.ok(passing.coverage.every((coverage) => coverage.requestIdEchoStatus === "echoed"));
  assert.ok(passing.coverage.every((coverage) => coverage.responseBytes > 0));
  assert.ok(
    passing.coverage.every((coverage) =>
      coverage.evidenceRefs.includes("ops/evidence/staging/object-storage-retention-cleanup.json")
    ),
    "passing coverage must cite exact retention cleanup artifact"
  );
});

test("object storage retention cleanup runtime evaluator rejects spoofed pass reports without bound probes", () => {
  const base = stagingObjectStorageRetentionCleanupEvidence;
  const spoofedPassReport = {
    evidence_id: "object-storage-retention-cleanup",
    environment: "staging",
    status: "pass",
    results_path: "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
    admin_user_id: "admin-ops-17",
    admin_tenant_id: "tenant-alpha",
    release_gate_check_id: "staging_object_storage_signed_downloads",
    do_not_launch_condition_id: "object_storage_signed_retention_runtime_missing",
    split_evidence: {
      signed_url_ready: true,
      release_sha_matches_signed_url: true,
      retention_cleanup_ready: true,
      canonical_pass_paths: true
    },
    coverage: ["retention_policy", "expired_export_cleanup", "orphan_cleanup", "audit_refs"].map((area) => ({
      area,
      status: "pass",
      runtime_probe: `Spoofed ${area} report with no echoed request id.`,
      expected_tokens: ["audit", "tenant", "deleted", "retained"],
      release_sha_bound: true,
      admin_identity_bound: true,
      response_bytes: 512,
      evidence_refs: ["ops/evidence/staging/object-storage-retention-cleanup.json"],
      source_results: [
        {
          method: area === "retention_policy" || area === "audit_refs" ? "GET" : "POST",
          url: `https://staging.example.test/${area}`,
          request_id: `stage0-object-retention-cleanup-${area}`,
          request_id_echoed: false,
          response_bytes: 512
        }
      ]
    })),
    gate_impact: {
      can_clear_retention_cleanup_checklist_item: true,
      can_clear_release_gate_check: true,
      remaining_release_gate_blockers_after_pass: []
    }
  };
  const rejected = buildStagingObjectStorageRetentionCleanupEvidence(base, spoofedPassReport);

  assert.equal(rejected.status, "blocked", "pass-shaped reports without request-id echo must stay blocked");
  assert.equal(rejected.reportKind, "rejected_report", "spoofed pass reports must be classified as rejected");
  assert.equal(
    rejected.observedReportPath,
    "ops/evidence/staging/object-storage-retention-cleanup.json",
    "rejected pass-shaped reports must still show the canonical path under review"
  );
  assert.equal(rejected.canClearRetentionCleanupChecklistItem, false);
  assert.equal(rejected.canClearReleaseGateCheck, false);
  assert.ok(
    rejected.coverage.every((coverage) => coverage.requestIdEchoStatus === "missing"),
    "operator evidence must expose missing request-id echoes for spoofed pass reports"
  );
  assert.ok(
    rejected.remainingReleaseGateBlockers.includes("staging_object_storage_signed_downloads"),
    "spoofed pass reports must preserve the object-storage release blocker"
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
  assert.ok(
    releaseBlockers.some(
      (blocker) =>
        blocker.id === "rb-private-beta-legal-support-visibility" &&
        blocker.status === "open" &&
        blocker.unblockCriteria.includes("legal_pages_visibility") &&
        blocker.requiredEvidence.includes("ops/evidence/staging/legal-pages-external-user.json") &&
        blocker.requiredEvidence.includes("ops/evidence/staging/support-contact-external-user.json")
    ),
    "legal/support external-user visibility history must cite exact staging evidence files"
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
    "staging-dashboard-admin-security-20260526T1030Z",
    "staging-dashboard-legal-support-20260527T2200Z"
  ]) {
    assert.ok(dashboardRuntimeRefs.has(ref), `missing dashboard runtime evidence ref ${ref}`);
  }

  for (const ref of [
    "staging-alert-provider-20260526T1000Z",
    "staging-alert-export-20260526T1000Z",
    "staging-alert-crawler-20260526T1000Z",
    "staging-alert-admin-security-20260526T1030Z",
    "staging-alert-legal-support-20260527T2200Z"
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
  assert.ok(
    observabilityTelemetryRuntimeEvidence.controls.every((control) => control.validationStatus === "verified"),
    "telemetry checklist cannot close until request-id, structured-log, and trace probes are verified"
  );
  for (const item of [
    "staging request id propagation runtime evidence 通过。",
    "staging structured JSON logs runtime evidence 通过。",
    "staging OpenTelemetry traces runtime evidence 通过。"
  ]) {
    assert.ok(observabilityTelemetryRuntimeEvidence.closedChecklistItems.includes(item), `telemetry evidence missing ${item}`);
  }
  assert.match(
    blueprint,
    /- \[x\] Private Beta\/Staging legal\/support external-user visibility runtime evidence 通过。/,
    "legal/support visibility aggregate row should close after external-user staging evidence passes"
  );
  assert.match(
    blueprint,
    /- \[x\] Private Beta\/Staging legal pages external-user visibility evidence 通过/,
    "legal page visibility row should close after legal-pages-external-user evidence passes"
  );
  assert.match(
    blueprint,
    /- \[x\] Private Beta\/Staging support contact external-user visibility evidence 通过/,
    "support contact visibility row should close after support-contact-external-user evidence passes"
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
    assert.notEqual(item.overrideStartedAt, "pending", `${item.id} needs explicit override start state`);
    assert.ok(
      item.overrideStartedAt === "none" || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(item.overrideStartedAt),
      `${item.id} override start must be none or an operator-readable timestamp`
    );
    assert.notEqual(item.overrideExpiresAt, "pending", `${item.id} needs explicit temporary override expiration state`);
    assert.ok(
      item.overrideExpiresAt === "none" || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(item.overrideExpiresAt),
      `${item.id} override expiration must be none or an operator-readable timestamp`
    );
    assert.ok(item.preOverrideState.length > 80, `${item.id} needs pre-override state evidence`);
    assert.ok(item.expiryAction.length > 90, `${item.id} needs expiry action evidence`);
    assert.ok(item.staleOverrideProbe.length > 90, `${item.id} needs stale override probe evidence`);
    assert.match(
      item.staleOverrideProbe,
      new RegExp(item.enforcementPoint),
      `${item.id} stale override probe must name its enforcement point`
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
      assert.notEqual(item.overrideStartedAt, "none", `${item.id} allowed temporary override must have a start timestamp`);
      assert.notEqual(item.overrideExpiresAt, "none", `${item.id} allowed temporary override must have an expiration`);
      assert.equal(item.overrideDurationPolicy, "temporary_required", `${item.id} allowed admin override must be temporary`);
      assert.equal(item.expiryEnforced, true, `${item.id} allowed temporary override must enforce expiry`);
      assert.match(item.expiryAction, /restore|fresh|require/i, `${item.id} allowed override needs executable expiry recovery`);
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
      assert.equal(item.overrideStartedAt, "none", `${item.id} non-expiring policy block must not expose fake start`);
      assert.equal(item.expiryEnforced, false, `${item.id} non-expiring policy block cannot rely on expiry enforcement`);
      assert.equal(item.mutationOutcome, "blocked_no_mutation", `${item.id} non-expiring policy block must preserve state`);
      assert.match(item.expiryAction, /No expiry action applies/, `${item.id} non-expiring policy block must explain absent expiry action`);
    } else {
      assert.notEqual(item.overrideStartedAt, "none", `${item.id} temporary/deadline override needs start timestamp`);
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
    assert.equal(decision.requestedAction, item.requestedAction, `${decision.evidenceId} requested action mismatch`);
    assert.equal(decision.enforcementPoint, item.enforcementPoint, `${decision.evidenceId} enforcement mismatch`);
    assert.equal(decision.requiredRole, item.requiredRole, `${decision.evidenceId} required role mismatch`);
    assert.equal(decision.attemptedRole, item.attemptedRole, `${decision.evidenceId} attempted role mismatch`);
    assert.equal(
      decision.roleGateStatus,
      roleOrder.get(item.attemptedRole) >= roleOrder.get(item.requiredRole) ? "sufficient" : "insufficient",
      `${decision.evidenceId} role gate status must reflect attempted and required roles`
    );
    assert.equal(
      decision.secondReviewStatus,
      item.secondReviewStatus,
      `${decision.evidenceId} second-review status must be preserved`
    );
    assert.equal(decision.preOverrideState, item.preOverrideState, `${decision.evidenceId} pre-override state must be preserved`);
    assert.equal(decision.expiryAction, item.expiryAction, `${decision.evidenceId} expiry action must be preserved`);
    assert.equal(decision.staleOverrideProbe, item.staleOverrideProbe, `${decision.evidenceId} stale override probe must be preserved`);
    assert.match(decision.evaluatedAt, /^2026-05-26T11:00:00\.000Z$/, `${decision.evidenceId} needs deterministic evaluated timestamp`);
    assert.ok(auditIds.has(decision.auditRef), `${decision.evidenceId} links unknown audit ${decision.auditRef}`);
    assert.deepEqual(decision.evidenceRefs, item.evidenceRefs, `${decision.evidenceId} evidence refs must be preserved`);
    assert.deepEqual(
      [...new Set(decision.blockerCodes)],
      decision.blockerCodes,
      `${decision.evidenceId} blocker codes must be unique and ordered by gate evaluation`
    );
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
      assert.equal(decision.overrideWindow, "active", `${decision.evidenceId} active temporary override needs active window`);
    }

    if (item.overrideDurationPolicy === "second_review_deadline" && decision.requestOutcome !== "denied_expired_override") {
      assert.equal(
        decision.expiryPolicyStatus,
        "second_review_deadline_open",
        `${decision.evidenceId} second-review override needs deadline-open status`
      );
      assert.equal(decision.overrideWindow, "active", `${decision.evidenceId} second-review deadline needs active window before expiry`);
    }

    if (item.overrideDurationPolicy === "non_expiring_policy_block") {
      assert.equal(
        decision.expiryPolicyStatus,
        "non_expiring_policy_block",
        `${decision.evidenceId} policy block must not be treated as a temporary override`
      );
      assert.equal(decision.overrideWindow, "policy_block", `${decision.evidenceId} policy block needs policy-block window`);
      assert.equal(decision.mutationAllowed, false, `${decision.evidenceId} policy block cannot mutate`);
    }

    if (decision.mutationAllowed) {
      assert.equal(decision.effectiveDecision, "allow_mutation", `${decision.evidenceId} mutation allowed only for allow decisions`);
      assert.equal(decision.queueAction, "apply_with_expiry", `${decision.evidenceId} allowed mutation needs expiry action`);
      assert.equal(decision.releaseGateStatus, "runtime_override_applied_with_expiry", `${decision.evidenceId} allowed mutation needs runtime gate status`);
      assert.deepEqual(decision.blockerCodes, [], `${decision.evidenceId} allowed mutation cannot expose blockers`);
    } else {
      assert.notEqual(decision.effectiveDecision, "allow_mutation", `${decision.evidenceId} denied or queued decision cannot allow mutation`);
      assert.match(
        decision.queueAction,
        /hold_for_second_review|block_and_preserve_state/,
        `${decision.evidenceId} denied or queued decision needs restrictive queue action`
      );
      assert.ok(decision.blockerCodes.length > 0, `${decision.evidenceId} denied or queued decision needs blocker codes`);
    }

    if (decision.requestOutcome === "denied_expired_override") {
      assert.notEqual(item.overrideExpiresAt, "none", `${decision.evidenceId} expired override needs a real expiration`);
      assert.equal(decision.queueAction, "block_and_preserve_state", `${decision.evidenceId} expired override must preserve state`);
      assert.equal(decision.releaseGateStatus, "release_gate_preserved", `${decision.evidenceId} expired override must preserve release gate`);
      assert.equal(decision.expiryPolicyStatus, "expired_temporary_window", `${decision.evidenceId} expired override needs expired policy status`);
      assert.equal(decision.overrideWindow, "expired", `${decision.evidenceId} expired override needs expired window`);
      assert.ok(decision.blockerCodes.includes("expired_override_window"), `${decision.evidenceId} expired override needs blocker code`);
      assert.match(decision.rationale, /expired/i, `${decision.evidenceId} expired override rationale must name expiry`);
      assert.match(decision.rationale, new RegExp(item.expiryAction.slice(0, 18)), `${decision.evidenceId} expired rationale must include expiry action`);
    }

    if (decision.requestOutcome === "denied_insufficient_role") {
      assert.equal(decision.roleGateStatus, "insufficient", `${decision.evidenceId} insufficient-role denial needs role gate evidence`);
      assert.ok(decision.blockerCodes.includes("insufficient_role"), `${decision.evidenceId} insufficient-role denial needs blocker code`);
    }

    if (decision.requestOutcome === "queued_second_review") {
      assert.ok(decision.blockerCodes.includes("second_review_open"), `${decision.evidenceId} second-review hold needs blocker code`);
    }

    if (decision.requestOutcome === "denied_policy_block") {
      assert.ok(decision.blockerCodes.includes("policy_or_gate_denied"), `${decision.evidenceId} policy denial needs blocker code`);
    }

    if (item.surface === "export_override") {
      assert.equal(decision.effectiveDecision, "deny_mutation", "blocking export override must be denied at runtime");
      assert.equal(decision.requestOutcome, "denied_policy_block", "blocking export override needs policy-block outcome");
    }

    if (item.surface === "safety_rule") {
      assert.equal(decision.effectiveDecision, "deny_mutation", "safety rule override must deny before review when role is below superadmin");
      assert.equal(decision.requestOutcome, "denied_insufficient_role", "safety rule override needs insufficient-role outcome");
      assert.equal(decision.releaseGateStatus, "release_gate_preserved", "safety rule override must preserve the release gate");
    }
  }
});

test("admin RBAC surface summaries expose release evidence for every governed override surface", () => {
  const { buildAdminRbacRuntimeDecisions, buildAdminRbacSurfaceSummaries } = parseRbacRuntime();
  const decisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const summaries = buildAdminRbacSurfaceSummaries(adminRbacEvidence, decisions);
  const requiredSurfaces = new Set([
    "skill_release",
    "crawler_import",
    "prompt_approval",
    "provider_routing",
    "quota_override",
    "safety_rule",
    "export_override"
  ]);
  const summaryBySurface = new Map(summaries.map((summary) => [summary.surface, summary]));

  assert.equal(summaries.length, requiredSurfaces.size, "RBAC release summary must cover each governed surface once");

  for (const surface of requiredSurfaces) {
    const summary = summaryBySurface.get(surface);
    assert.ok(summary, `missing RBAC summary for ${surface}`);
    assert.equal(summary.overrideScope, overrideScopeBySurface.get(surface), `${surface} summary scope mismatch`);
    assert.ok(summary.totalEvidence > 0, `${surface} needs evidence items`);
    assert.ok(summary.auditRefs.length > 0, `${surface} needs audit refs`);
    assert.ok(summary.releaseEvidenceRequired.length > 0, `${surface} needs release evidence requirements`);
    assert.ok(summary.releaseGateStatuses.length > 0, `${surface} needs release gate statuses`);
    assert.match(
      summary.decisionSummary,
      /applied; .*second-review hold; .*denied; .*expired denial/,
      `${surface} needs compact outcome counts`
    );
    assert.ok(summary.operatorAction.length > 60, `${surface} needs actionable operator guidance`);

    for (const auditRef of summary.auditRefs) {
      assert.ok(auditIds.has(auditRef), `${surface} summary links unknown audit ${auditRef}`);
    }
  }

  assert.equal(
    summaryBySurface.get("provider_routing").expiredOverrideDenials,
    1,
    "provider routing summary must expose expired temporary override denial"
  );
  assert.equal(
    summaryBySurface.get("skill_release").queuedSecondReview,
    1,
    "skill release summary must expose second-review hold"
  );
  assert.equal(
    summaryBySurface.get("export_override").deniedMutations,
    1,
    "export summary must expose denied blocking QA override"
  );
  assert.ok(
    summaryBySurface.get("provider_routing").operatorAction.includes("fresh request"),
    "expired provider override summary must require a fresh request"
  );
  assert.ok(
    summaryBySurface.get("safety_rule").releaseEvidenceRequired.includes("superadmin approval"),
    "safety summary must preserve superadmin release evidence"
  );
});

test("admin RBAC evidence packs bind each override surface to runtime, audit, and operator evidence", () => {
  const { buildAdminRbacRuntimeDecisions, buildAdminRbacEvidencePacks } = parseRbacRuntime();
  const decisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const packs = buildAdminRbacEvidencePacks(adminRbacEvidence, decisions);
  const packBySurface = new Map(packs.map((pack) => [pack.surface, pack]));
  const evidenceBySurface = new Map();
  const decisionsBySurface = new Map();

  for (const item of adminRbacEvidence) {
    evidenceBySurface.set(item.surface, [...(evidenceBySurface.get(item.surface) ?? []), item]);
  }

  for (const decision of decisions) {
    decisionsBySurface.set(decision.surface, [...(decisionsBySurface.get(decision.surface) ?? []), decision]);
  }

  assert.equal(packs.length, overrideScopeBySurface.size, "one RBAC evidence pack is required per governed override surface");

  for (const [surface, overrideScope] of overrideScopeBySurface.entries()) {
    const pack = packBySurface.get(surface);
    const surfaceEvidence = evidenceBySurface.get(surface) ?? [];
    const surfaceDecisions = decisionsBySurface.get(surface) ?? [];

    assert.ok(pack, `${surface} needs an RBAC evidence pack`);
    assert.equal(pack.overrideScope, overrideScope, `${surface} pack must preserve override scope`);
    assert.deepEqual(pack.evidenceIds.toSorted(), surfaceEvidence.map((item) => item.id).toSorted(), `${surface} pack evidence IDs must match fixtures`);
    assert.deepEqual(
      pack.apiScopes.toSorted(),
      [...new Set(surfaceEvidence.map((item) => item.apiScope))].sort(),
      `${surface} pack API scopes must match fixtures`
    );
    assert.deepEqual(pack.auditRefs.toSorted(), [...new Set(surfaceEvidence.map((item) => item.auditRef))].sort(), `${surface} pack audit refs must match fixtures`);
    assert.equal(pack.evidenceCompleteness, "complete", `${surface} pack must be complete`);
    assert.ok(roleOrder.has(pack.highestRequiredRole), `${surface} pack highest required role must be known`);
    assert.ok(pack.operatorChecklist.length >= surfaceEvidence[0].releaseEvidenceRequired.length, `${surface} pack needs release checklist evidence`);
    assert.ok(pack.evidenceRefs.length >= surfaceEvidence.length, `${surface} pack needs evidence refs`);
    assert.deepEqual(
      pack.expiryEnforcedEvidenceIds.toSorted(),
      surfaceEvidence.filter((item) => item.expiryEnforced).map((item) => item.id).toSorted(),
      `${surface} pack expiry-enforced IDs must match fixtures`
    );
    assert.deepEqual(
      pack.policyBlockEvidenceIds.toSorted(),
      surfaceEvidence
        .filter((item) => item.overrideDurationPolicy === "non_expiring_policy_block")
        .map((item) => item.id)
        .toSorted(),
      `${surface} pack policy-block IDs must match fixtures`
    );

    const hasTemporaryWindow = surfaceEvidence.some((item) => item.overrideDurationPolicy !== "non_expiring_policy_block");
    const hasPolicyBlock = surfaceEvidence.some((item) => item.overrideDurationPolicy === "non_expiring_policy_block");
    if (hasTemporaryWindow && hasPolicyBlock) {
      assert.equal(pack.expiryEnforcementStatus, "mixed_enforcement", `${surface} pack must show mixed expiry enforcement`);
    } else if (hasTemporaryWindow) {
      assert.equal(pack.expiryEnforcementStatus, "all_enforced", `${surface} pack must enforce every temporary window`);
    } else {
      assert.equal(pack.expiryEnforcementStatus, "policy_block_only", `${surface} pack must show policy-block-only expiry status`);
    }

    for (const decision of surfaceDecisions) {
      assert.ok(pack.requestOutcomes.includes(decision.requestOutcome), `${surface} pack must include ${decision.requestOutcome}`);
      assert.ok(pack.mutationDecisions.includes(decision.effectiveDecision), `${surface} pack must include ${decision.effectiveDecision}`);
      assert.ok(pack.releaseGateStatuses.includes(decision.releaseGateStatus), `${surface} pack must include ${decision.releaseGateStatus}`);
      assert.ok(pack.expiryStatuses.includes(decision.expiryPolicyStatus), `${surface} pack must include ${decision.expiryPolicyStatus}`);
    }

    for (const item of surfaceEvidence) {
      assert.ok(pack.targets.includes(item.target), `${surface} pack must include target ${item.target}`);
      assert.ok(pack.apiScopes.includes(item.apiScope), `${surface} pack must include API scope ${item.apiScope}`);
      assert.ok(pack.requiredRoles.includes(item.requiredRole), `${surface} pack must include required role ${item.requiredRole}`);
      assert.ok(pack.attemptedRoles.includes(item.attemptedRole), `${surface} pack must include attempted role ${item.attemptedRole}`);
      assert.ok(pack.secondReviewStatuses.includes(item.secondReviewStatus), `${surface} pack must include second-review status ${item.secondReviewStatus}`);
      for (const ref of item.evidenceRefs) {
        assert.ok(pack.evidenceRefs.includes(ref), `${surface} pack must include evidence ref ${ref}`);
      }
    }
  }

  assert.equal(
    packBySurface.get("provider_routing").releaseGateDisposition,
    "mixed_preserved",
    "provider routing pack must show applied and expired override outcomes together"
  );
  assert.equal(
    packBySurface.get("skill_release").releaseGateDisposition,
    "held_for_second_review",
    "skill release pack must remain held for second review"
  );
  assert.equal(
    packBySurface.get("quota_override").releaseGateDisposition,
    "blocked_by_policy_or_role",
    "quota pack must preserve support-only mutation block"
  );
  assert.ok(
    packBySurface
      .get("provider_routing")
      .operatorChecklist.some((item) => item.includes("fresh runtime evidence")),
    "expired provider overrides must instruct operators to reopen with fresh runtime evidence"
  );
  assert.ok(
    packBySurface
      .get("safety_rule")
      .operatorChecklist.some((item) => item.includes("required admin role")),
    "safety pack must expose role escalation for superadmin-only changes"
  );
});

test("admin RBAC closure matrix proves every governed override surface before release use", () => {
  const {
    buildAdminRbacRuntimeDecisions,
    buildAdminRbacStaleReplayDecisions,
    buildAdminRbacEvidencePacks,
    buildAdminRbacClosureMatrix
  } = parseRbacRuntime();
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const staleReplayDecisions = buildAdminRbacStaleReplayDecisions(
    adminRbacEvidence,
    runtimeDecisions,
    new Date("2026-05-26T19:00:00Z")
  );
  const evidencePacks = buildAdminRbacEvidencePacks(adminRbacEvidence, runtimeDecisions, staleReplayDecisions);
  const closureMatrix = buildAdminRbacClosureMatrix(evidencePacks, runtimeDecisions);
  const matrixBySurface = new Map(closureMatrix.map((row) => [row.surface, row]));

  assert.equal(
    closureMatrix.length,
    overrideScopeBySurface.size,
    "closure matrix needs one row per governed admin override surface"
  );

  for (const [surface, overrideScope] of overrideScopeBySurface.entries()) {
    const row = matrixBySurface.get(surface);
    const surfaceEvidence = adminRbacEvidence.filter((item) => item.surface === surface);

    assert.ok(row, `${surface} needs a closure matrix row`);
    assert.equal(row.overrideScope, overrideScope, `${surface} closure row must preserve override scope`);
    assert.deepEqual(
      row.evidenceIds.toSorted(),
      surfaceEvidence.map((item) => item.id).toSorted(),
      `${surface} closure row must cite exact RBAC evidence ids`
    );
    assert.equal(row.roleGateCoverage, "covered", `${surface} closure row must prove role gate coverage`);
    assert.notEqual(row.secondReviewCoverage, "missing", `${surface} closure row must prove second review status`);
    assert.notEqual(row.expiryCoverage, "missing", `${surface} closure row must prove expiry handling`);
    assert.notEqual(row.staleReplayCoverage, "missing", `${surface} closure row must prove stale replay handling or mark it not required`);
    assert.equal(row.auditCoverage, "attached", `${surface} closure row must attach immutable audit`);
    assert.equal(row.releaseEvidenceCoverage, "attached", `${surface} closure row must attach release evidence`);
    assert.ok(row.requiredRoles.length > 0, `${surface} closure row must expose required roles`);
    assert.ok(row.runtimeOutcomes.length > 0, `${surface} closure row must expose runtime outcomes`);
    assert.ok(row.operatorAction.length > 0, `${surface} closure row must expose operator action`);
  }

  assert.equal(
    matrixBySurface.get("provider_routing").closureDisposition,
    "preserved_by_mixed_runtime",
    "provider routing closure must preserve mixed applied and expired runtime outcomes"
  );
  assert.equal(
    matrixBySurface.get("skill_release").closureDisposition,
    "preserved_by_second_review",
    "skill release closure must preserve second-review hold"
  );
  assert.equal(
    matrixBySurface.get("quota_override").closureDisposition,
    "preserved_by_policy_or_role",
    "quota closure must preserve policy or role block"
  );
  assert.equal(
    matrixBySurface.get("export_override").releaseGateStatus,
    "release_gate_preserved",
    "export closure must preserve release gate for blocking QA"
  );
  assert.ok(
    matrixBySurface.get("provider_routing").blockerCodes.includes("expired_override_window"),
    "provider closure must expose expired override blocker"
  );
});

test("admin RBAC release evidence closure binds attempts, stale replay, audit, and release evidence", () => {
  const {
    buildAdminRbacRuntimeDecisions,
    buildAdminRbacOverrideAttemptDecisions,
    buildAdminRbacStaleReplayDecisions,
    buildAdminRbacEvidencePacks,
    buildAdminRbacReleaseEvidenceClosures,
    buildAdminRbacReleaseReadinessSummaries
  } = parseRbacRuntime();
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const attemptDecisions = buildAdminRbacOverrideAttemptDecisions(adminRbacOverrideAttempts, runtimeDecisions);
  const staleReplayDecisions = buildAdminRbacStaleReplayDecisions(
    adminRbacEvidence,
    runtimeDecisions,
    new Date("2026-05-26T19:00:00Z")
  );
  const evidencePacks = buildAdminRbacEvidencePacks(adminRbacEvidence, runtimeDecisions, staleReplayDecisions);
  const closures = buildAdminRbacReleaseEvidenceClosures(
    evidencePacks,
    attemptDecisions,
    staleReplayDecisions
  );
  const readinessSummaries = buildAdminRbacReleaseReadinessSummaries(closures, evidencePacks);
  const closureBySurface = new Map(closures.map((closure) => [closure.surface, closure]));
  const readinessBySurface = new Map(readinessSummaries.map((summary) => [summary.surface, summary]));
  const attemptsBySurface = new Map();
  const staleReplaysBySurface = new Map();

  for (const attempt of attemptDecisions) {
    attemptsBySurface.set(attempt.surface, [...(attemptsBySurface.get(attempt.surface) ?? []), attempt]);
  }

  for (const staleReplay of staleReplayDecisions) {
    staleReplaysBySurface.set(staleReplay.surface, [
      ...(staleReplaysBySurface.get(staleReplay.surface) ?? []),
      staleReplay
    ]);
  }

  assert.equal(
    closures.length,
    overrideScopeBySurface.size,
    "release evidence closure needs one row per governed override surface"
  );
  assert.equal(
    readinessSummaries.length,
    overrideScopeBySurface.size,
    "release readiness summary needs one row per governed override surface"
  );

  for (const [surface, overrideScope] of overrideScopeBySurface.entries()) {
    const closure = closureBySurface.get(surface);
    const readiness = readinessBySurface.get(surface);
    const surfaceEvidence = adminRbacEvidence.filter((item) => item.surface === surface);
    const surfaceAttempts = attemptsBySurface.get(surface) ?? [];
    const surfaceStaleReplays = staleReplaysBySurface.get(surface) ?? [];

    assert.ok(closure, `${surface} needs release evidence closure`);
    assert.ok(readiness, `${surface} needs release readiness summary`);
    assert.equal(closure.overrideScope, overrideScope, `${surface} closure scope mismatch`);
    assert.equal(readiness.overrideScope, overrideScope, `${surface} readiness scope mismatch`);
    assert.deepEqual(
      closure.evidenceIds.toSorted(),
      surfaceEvidence.map((item) => item.id).toSorted(),
      `${surface} closure must cite exact RBAC evidence ids`
    );
    assert.deepEqual(
      readiness.evidenceIds.toSorted(),
      closure.evidenceIds.toSorted(),
      `${surface} readiness must cite exact closure evidence ids`
    );
    assert.deepEqual(
      closure.attemptIds.toSorted(),
      surfaceAttempts.map((attempt) => attempt.attemptId).toSorted(),
      `${surface} closure must cite request-level attempt ids`
    );
    assert.equal(closure.attemptCoverage, "covered", `${surface} request attempt coverage must be complete`);
    assert.notEqual(closure.staleReplayCoverage, "missing", `${surface} stale replay coverage cannot be missing`);
    assert.equal(closure.releaseEvidenceStatus, "attached", `${surface} release evidence must be attached`);
    assert.equal(closure.attemptEvidenceStatus, "valid", `${surface} attempt evidence must be valid`);
    assert.equal(readiness.attemptCoverage, closure.attemptCoverage, `${surface} readiness must preserve attempt coverage`);
    assert.equal(readiness.staleReplayCoverage, closure.staleReplayCoverage, `${surface} readiness must preserve stale replay coverage`);
    assert.equal(readiness.releaseEvidenceStatus, closure.releaseEvidenceStatus, `${surface} readiness must preserve release evidence status`);
    assert.equal(readiness.attemptEvidenceStatus, closure.attemptEvidenceStatus, `${surface} readiness must preserve attempt evidence status`);
    assert.equal(
      readiness.releaseMutationAttemptStatus,
      closure.releaseMutationAttemptStatus,
      `${surface} readiness must preserve release mutation attempt status`
    );
    assert.deepEqual(
      readiness.attemptBlockerCodes.toSorted(),
      closure.attemptBlockerCodes.toSorted(),
      `${surface} readiness must preserve attempt blockers`
    );
    assert.equal(readiness.closureStatus, closure.closureStatus, `${surface} readiness must preserve closure status`);
    assert.equal(readiness.releaseGateStatus, closure.releaseGateStatus, `${surface} readiness must preserve gate status`);
    assert.deepEqual(
      readiness.auditRefs.toSorted(),
      closure.auditRefs.toSorted(),
      `${surface} readiness must preserve audit refs`
    );
    assert.deepEqual(
      readiness.closureEvidenceRefs.toSorted(),
      closure.closureEvidenceRefs.toSorted(),
      `${surface} readiness must preserve closure evidence refs`
    );
    assert.ok(readiness.requiredRoles.length > 0, `${surface} readiness must expose required roles`);
    assert.ok(readiness.readinessRationale.length > 120, `${surface} readiness needs executable rationale`);
    assert.ok(readiness.operatorAction.length > 100, `${surface} readiness needs operator action`);
    assert.ok(closure.runtimeOutcomes.length > 0, `${surface} closure needs runtime outcomes`);
    assert.ok(closure.attemptOutcomes.length > 0, `${surface} closure needs request attempt outcomes`);
    assert.ok(Array.isArray(closure.attemptBlockerCodes), `${surface} closure needs attempt blocker array`);
    assert.ok(closure.auditRefs.length > 0, `${surface} closure needs audit refs`);
    assert.ok(closure.releaseEvidenceRequired.length >= surfaceEvidence[0].releaseEvidenceRequired.length, `${surface} closure needs release evidence requirements`);
    assert.ok(closure.closureEvidenceRefs.length >= surfaceEvidence.length, `${surface} closure needs closure refs`);
    assert.ok(closure.operatorAction.length > 100, `${surface} closure needs operator action`);

    for (const evidence of surfaceEvidence) {
      assert.ok(
        closure.closureEvidenceRefs.includes(evidence.auditRef),
        `${surface} closure must include audit ref ${evidence.auditRef}`
      );
      for (const ref of evidence.evidenceRefs) {
        assert.ok(closure.closureEvidenceRefs.includes(ref), `${surface} closure must include evidence ref ${ref}`);
      }
    }

    for (const attempt of surfaceAttempts) {
      assert.ok(
        closure.closureEvidenceRefs.includes(attempt.auditRef),
        `${surface} closure must include attempt audit ref ${attempt.auditRef}`
      );
      assert.notEqual(
        attempt.releaseGateStatus,
        undefined,
        `${surface} closure attempt must expose release gate status`
      );
    }

    if (surfaceStaleReplays.length > 0) {
      assert.equal(closure.staleReplayCoverage, "covered", `${surface} stale replay rows must mark coverage`);
      assert.deepEqual(
        closure.staleReplayEvidenceIds.toSorted(),
        surfaceStaleReplays.map((replay) => replay.evidenceId).toSorted(),
        `${surface} stale replay ids must match runtime replays`
      );
      assert.ok(closure.staleReplayOutcomes.length > 0, `${surface} stale replay outcomes must be visible`);
    }
  }

  assert.equal(
    closureBySurface.get("provider_routing").closureStatus,
    "preserved_by_stale_replay",
    "provider closure must preserve expired override replay evidence"
  );
  assert.equal(
    readinessBySurface.get("provider_routing").readyState,
    "gate_preserved",
    "provider readiness must preserve gate because runtime is mixed and stale replay evidence exists"
  );
  assert.equal(
    readinessBySurface.get("provider_routing").mutationMode,
    "mixed_runtime",
    "provider readiness must expose mixed active and expired runtime mode"
  );
  assert.equal(
    closureBySurface.get("provider_routing").releaseMutationAttemptStatus,
    "not_applicable",
    "mixed provider runtime cannot be treated as a direct release mutation attempt"
  );
  assert.ok(
    closureBySurface.get("provider_routing").attemptBlockerCodes.includes("expired_override_window"),
    "provider closure must carry expired attempt blocker evidence"
  );
  assert.equal(
    closureBySurface.get("skill_release").closureStatus,
    "preserved_by_stale_replay",
    "skill release closure must preserve stale second-review replay evidence"
  );
  assert.equal(
    readinessBySurface.get("skill_release").mutationMode,
    "stale_replay_preserved",
    "skill release readiness must show stale second-review replay preservation"
  );
  assert.equal(
    closureBySurface.get("quota_override").closureStatus,
    "preserved_by_policy",
    "quota closure must preserve policy-block evidence"
  );
  assert.equal(
    readinessBySurface.get("quota_override").mutationMode,
    "policy_block",
    "quota readiness must expose support-only policy block"
  );
  assert.equal(
    closureBySurface.get("export_override").releaseGateStatus,
    "release_gate_preserved",
    "export closure cannot allow release use while blocking QA is preserved"
  );
  assert.equal(
    readinessBySurface.get("export_override").readyState,
    "gate_preserved",
    "export readiness cannot report release-ready while blocking QA is preserved"
  );
  assert.equal(
    closureBySurface.get("export_override").releaseMutationAttemptStatus,
    "not_applicable",
    "policy-blocked export override cannot expose a submittable mutation attempt"
  );

  const invalidAttemptClosures = buildAdminRbacReleaseEvidenceClosures(
    evidencePacks,
    buildAdminRbacOverrideAttemptDecisions(
      [
        ...adminRbacOverrideAttempts.filter((attempt) => attempt.id !== "rbac-attempt-provider-001"),
        {
          ...adminRbacOverrideAttempts.find((attempt) => attempt.id === "rbac-attempt-provider-001"),
          idempotencyKey: "rbac:provider_routing:wrong-evidence:retry-weight:au-007"
        }
      ],
      runtimeDecisions
    ),
    staleReplayDecisions
  );
  const invalidProviderClosure = invalidAttemptClosures.find((closure) => closure.surface === "provider_routing");
  assert.equal(
    invalidProviderClosure.attemptEvidenceStatus,
    "invalid",
    "unstable idempotency in an override attempt must invalidate release evidence closure"
  );
  assert.equal(
    invalidProviderClosure.closureStatus,
    "missing_evidence",
    "invalid override attempt evidence must prevent release-ready closure"
  );
  assert.ok(
    invalidProviderClosure.attemptBlockerCodes.includes("idempotency_key_unstable"),
    "invalid override attempt closure must carry request-attempt blocker codes"
  );

  const missingMutationClosures = buildAdminRbacReleaseEvidenceClosures(
    evidencePacks,
    buildAdminRbacOverrideAttemptDecisions(
      [
        ...adminRbacOverrideAttempts.filter((attempt) => attempt.id !== "rbac-attempt-provider-001"),
        {
          ...adminRbacOverrideAttempts.find((attempt) => attempt.id === "rbac-attempt-provider-001"),
          postMutationStateDigest: "sha256:provider-openai-image-render-dev-normal-retry-weight"
        }
      ],
      runtimeDecisions
    ),
    staleReplayDecisions
  );
  const missingMutationProviderClosure = missingMutationClosures.find((closure) => closure.surface === "provider_routing");
  assert.equal(
    missingMutationProviderClosure.attemptEvidenceStatus,
    "invalid",
    "allowed override without mutation digest must invalidate closure evidence"
  );
  assert.ok(
    missingMutationProviderClosure.attemptBlockerCodes.includes("allowed_mutation_missing"),
    "missing allowed mutation must be visible on the release evidence closure"
  );

  const reviewsPage = readFileSync(new URL("../app/reviews/page.tsx", import.meta.url), "utf8");
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");

  for (const token of [
    "AdminRbacReleaseEvidenceClosure",
    "AdminRbacReleaseReadinessSummary",
    "getAdminRbacReleaseEvidenceClosures",
    "getAdminRbacReleaseReadinessSummaries",
    "buildAdminRbacReleaseEvidenceClosures",
    "buildAdminRbacReleaseReadinessSummaries",
    "RBAC Release Evidence Closure",
    "RBAC Release Readiness Summary",
    "Attempt Coverage",
    "Attempt Evidence",
    "Mutation Attempt",
    "Attempt Blockers",
    "Stale Replay Coverage",
    "Closure Status",
    "Ready State",
    "Mutation Mode",
    "Closure Evidence Refs",
    "release_ready_with_expiry",
    "gate_preserved",
    "mixed_runtime",
    "preserved_by_stale_replay",
    "preserved_by_policy",
    "missing_evidence"
  ]) {
    assert.match(reviewsPage + auditPage + adminApi + rbacRuntimeSource + types, new RegExp(token));
  }
});

test("admin RBAC override attempts preserve idempotency, state digests, and release gates", () => {
  const { buildAdminRbacRuntimeDecisions, buildAdminRbacOverrideAttemptDecisions } = parseRbacRuntime();
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const attemptDecisions = buildAdminRbacOverrideAttemptDecisions(adminRbacOverrideAttempts, runtimeDecisions);
  const evidenceById = new Map(adminRbacEvidence.map((item) => [item.id, item]));
  const runtimeByEvidenceId = new Map(runtimeDecisions.map((decision) => [decision.evidenceId, decision]));
  const attemptDecisionById = new Map(attemptDecisions.map((decision) => [decision.attemptId, decision]));
  const expectedAttemptsBySurface = new Map();

  assert.equal(
    attemptDecisions.length,
    adminRbacOverrideAttempts.length,
    "each RBAC override attempt fixture needs a runtime decision"
  );
  assert.ok(
    attemptDecisions.some((decision) => decision.requestOutcome === "mutation_applied" && decision.submitAllowed),
    "override attempts need one allowed mutation path with expiry"
  );
  assert.ok(
    attemptDecisions.some((decision) => decision.requestOutcome === "queued_without_mutation"),
    "override attempts need queued second-review evidence"
  );
  assert.ok(
    attemptDecisions.some((decision) => decision.requestOutcome === "blocked_without_mutation"),
    "override attempts need blocked no-mutation evidence"
  );
  assert.ok(
    attemptDecisions.some((decision) => decision.requestOutcome === "stale_replay_blocked"),
    "override attempts need stale replay blocking evidence"
  );

  for (const surface of overrideScopeBySurface.keys()) {
    expectedAttemptsBySurface.set(surface, 0);
  }

  for (const attempt of adminRbacOverrideAttempts) {
    const evidence = evidenceById.get(attempt.evidenceId);
    const runtimeDecision = runtimeByEvidenceId.get(attempt.evidenceId);
    const decision = attemptDecisionById.get(attempt.id);

    assert.ok(evidence, `${attempt.id} links unknown RBAC evidence ${attempt.evidenceId}`);
    assert.ok(runtimeDecision, `${attempt.id} links RBAC evidence without runtime decision`);
    assert.ok(decision, `${attempt.id} missing override-attempt decision`);
    expectedAttemptsBySurface.set(attempt.surface, expectedAttemptsBySurface.get(attempt.surface) + 1);
    assert.equal(attempt.surface, evidence.surface, `${attempt.id} surface must match RBAC evidence`);
    assert.equal(attempt.overrideScope, evidence.overrideScope, `${attempt.id} override scope must match RBAC evidence`);
    assert.equal(attempt.apiScope, evidence.apiScope, `${attempt.id} API scope must match RBAC evidence`);
    assert.equal(attempt.auditRef, evidence.auditRef, `${attempt.id} audit ref must match RBAC evidence`);
    assert.equal(attempt.csrfScope, "admin_session_cookie", `${attempt.id} must be bound to admin session cookie scope`);
    assert.match(attempt.requestId, /^admin-rbac-override-\d{8}T\d{4}Z-/, `${attempt.id} needs stable runtime request id`);
    assert.ok(
      attempt.idempotencyKey.startsWith(`rbac:${attempt.surface}:${attempt.evidenceId}:`),
      `${attempt.id} needs surface and evidence scoped idempotency key`
    );
    assert.match(attempt.requestBodyDigest, /^sha256:[a-z0-9-]+$/, `${attempt.id} needs request body digest`);
    assert.match(attempt.preMutationStateDigest, /^sha256:[a-z0-9-]+$/, `${attempt.id} needs pre-mutation state digest`);
    assert.match(attempt.postMutationStateDigest, /^sha256:[a-z0-9-]+$/, `${attempt.id} needs post-mutation state digest`);
    assert.ok(attempt.gatePreservation.length > 100, `${attempt.id} needs gate preservation evidence`);
    assert.ok(attempt.mutationReplayPolicy.length > 90, `${attempt.id} needs mutation replay policy`);
    assert.ok(attempt.operatorMessage.length > 80, `${attempt.id} needs operator message`);
    assert.ok(attempt.evidenceRefs.includes(attempt.evidenceId), `${attempt.id} must include RBAC evidence ref`);
    assert.ok(attempt.evidenceRefs.includes(attempt.auditRef), `${attempt.id} must include audit ref in evidence refs`);

    for (const ref of attempt.evidenceRefs) {
      assert.ok(
        ref === attempt.evidenceId ||
          auditIds.has(ref) ||
          supportTicketIds.has(ref) ||
          traceIds.has(ref) ||
          exportIds.has(ref) ||
          riskyExportIds.has(ref) ||
          adminReviewDecisionIds.has(ref) ||
          crawlerFindingIds.has(ref) ||
          ref.startsWith("cg-") ||
          ref.startsWith("csa-") ||
          ref.startsWith("sv-") ||
          ref.startsWith("eg-") ||
          ref.startsWith("ph-") ||
          ref.startsWith("qt-") ||
          ref.startsWith("pf-") ||
          ref.startsWith("fb-"),
        `${attempt.id} links unknown evidence ref ${ref}`
      );
    }

    assert.equal(decision.evidenceId, attempt.evidenceId, `${attempt.id} decision evidence mismatch`);
    assert.equal(decision.surface, attempt.surface, `${attempt.id} decision surface mismatch`);
    assert.equal(decision.overrideScope, attempt.overrideScope, `${attempt.id} decision override scope mismatch`);
    assert.equal(decision.requestId, attempt.requestId, `${attempt.id} decision request id mismatch`);
    assert.equal(decision.idempotencyStatus, "stable", `${attempt.id} fixture idempotency must be stable`);
    assert.equal(decision.expectedHttpStatus, attempt.expectedHttpStatus, `${attempt.id} expected HTTP status mismatch`);
    assert.equal(decision.runtimeRequestOutcome, runtimeDecision.requestOutcome, `${attempt.id} runtime outcome mismatch`);
    assert.equal(decision.releaseGateStatus, runtimeDecision.releaseGateStatus, `${attempt.id} release gate status mismatch`);
    assert.equal(decision.auditRef, attempt.auditRef, `${attempt.id} decision audit ref mismatch`);
    assert.deepEqual(decision.evidenceRefs, attempt.evidenceRefs, `${attempt.id} decision evidence refs mismatch`);
    assert.ok(decision.rationale.includes(attempt.operatorMessage), `${attempt.id} decision rationale must include operator message`);

    if (runtimeDecision.effectiveDecision === "allow_mutation") {
      assert.equal(attempt.dryRunOnly, false, `${attempt.id} allowed mutation attempt cannot be dry-run only`);
      assert.equal(decision.requestOutcome, "mutation_applied", `${attempt.id} allowed runtime must record mutation applied`);
      assert.equal(decision.stateDigestStatus, "mutation_recorded", `${attempt.id} allowed runtime needs state digest change`);
      assert.equal(decision.submitAllowed, true, `${attempt.id} allowed runtime should be submittable`);
      assert.deepEqual(decision.blockerCodes, [], `${attempt.id} allowed runtime cannot expose blockers`);
    } else {
      assert.equal(attempt.dryRunOnly, true, `${attempt.id} denied or queued attempt must be dry-run only`);
      assert.equal(decision.submitAllowed, false, `${attempt.id} denied or queued attempt cannot submit mutation`);
      assert.equal(decision.stateDigestStatus, "mutation_preserved", `${attempt.id} denied or queued attempt must preserve state digest`);
      assert.ok(
        ["queued_without_mutation", "blocked_without_mutation", "stale_replay_blocked"].includes(decision.requestOutcome),
        `${attempt.id} denied or queued attempt needs restrictive outcome`
      );
      assert.ok(decision.blockerCodes.length > 0, `${attempt.id} denied or queued attempt needs blocker codes`);
      assert.equal(
        attempt.preMutationStateDigest,
        attempt.postMutationStateDigest,
        `${attempt.id} denied or queued attempt cannot mutate state digest`
      );
    }

    if (runtimeDecision.requestOutcome === "denied_expired_override") {
      assert.equal(decision.requestOutcome, "stale_replay_blocked", `${attempt.id} expired override must block stale replay`);
      assert.equal(attempt.expectedHttpStatus, 410, `${attempt.id} stale replay should return expired/closed status`);
      assert.ok(decision.blockerCodes.includes("expired_override_window"), `${attempt.id} stale replay needs expired blocker`);
      assert.match(decision.rationale, /fresh/, `${attempt.id} stale replay rationale must require fresh evidence`);
    }

    if (runtimeDecision.requestOutcome === "queued_second_review") {
      assert.equal(decision.requestOutcome, "queued_without_mutation", `${attempt.id} second-review attempt must queue without mutation`);
      assert.equal(attempt.expectedHttpStatus, 202, `${attempt.id} queued second review should return accepted status`);
      assert.ok(decision.blockerCodes.includes("second_review_open"), `${attempt.id} queued second review needs blocker`);
    }
  }

  for (const [surface, count] of expectedAttemptsBySurface.entries()) {
    assert.ok(count > 0, `${surface} needs at least one request-level override attempt fixture`);
  }

  const unstableAttempt = buildAdminRbacOverrideAttemptDecisions(
    [
      {
        ...adminRbacOverrideAttempts.find((attempt) => attempt.id === "rbac-attempt-provider-001"),
        idempotencyKey: "rbac:provider_routing:wrong-evidence:retry-weight:au-007"
      }
    ],
    runtimeDecisions
  )[0];
  assert.equal(unstableAttempt.idempotencyStatus, "unstable", "wrong evidence id in idempotency key must be unstable");
  assert.equal(unstableAttempt.requestOutcome, "invalid_evidence", "unstable idempotency must invalidate override attempt evidence");
  assert.equal(unstableAttempt.submitAllowed, false, "unstable idempotency cannot submit");
  assert.ok(
    unstableAttempt.blockerCodes.includes("idempotency_key_unstable"),
    "unstable idempotency must expose blocker code"
  );

  const unexpectedMutationAttempt = buildAdminRbacOverrideAttemptDecisions(
    [
      {
        ...adminRbacOverrideAttempts.find((attempt) => attempt.id === "rbac-attempt-export-001"),
        postMutationStateDigest: "sha256:ex-887-released-despite-blocking-qa"
      }
    ],
    runtimeDecisions
  )[0];
  assert.equal(
    unexpectedMutationAttempt.stateDigestStatus,
    "unexpected_mutation",
    "denied export override with changed state digest must be detected"
  );
  assert.equal(
    unexpectedMutationAttempt.requestOutcome,
    "invalid_evidence",
    "unexpected state mutation invalidates override attempt evidence"
  );
  assert.equal(unexpectedMutationAttempt.submitAllowed, false, "unexpected denied mutation cannot submit");
  assert.ok(
    unexpectedMutationAttempt.blockerCodes.includes("unexpected_state_mutation"),
    "unexpected mutation must expose blocker code"
  );

  const missingMutationAttempt = buildAdminRbacOverrideAttemptDecisions(
    [
      {
        ...adminRbacOverrideAttempts.find((attempt) => attempt.id === "rbac-attempt-provider-001"),
        postMutationStateDigest: "sha256:provider-openai-image-render-dev-normal-retry-weight"
      }
    ],
    runtimeDecisions
  )[0];
  assert.equal(
    missingMutationAttempt.stateDigestStatus,
    "mutation_missing",
    "allowed provider override without changed state digest must be detected"
  );
  assert.equal(missingMutationAttempt.requestOutcome, "invalid_evidence", "missing allowed mutation invalidates evidence");
  assert.equal(missingMutationAttempt.submitAllowed, false, "missing allowed mutation cannot submit");
  assert.ok(
    missingMutationAttempt.blockerCodes.includes("allowed_mutation_missing"),
    "missing allowed mutation must expose blocker code"
  );

  const attemptTable = readFileSync(
    new URL("../components/RbacOverrideAttemptDecisionTable.tsx", import.meta.url),
    "utf8"
  );
  const attemptPageBySurface = new Map([
    ["skill_release", readFileSync(new URL("../app/skills/releases/page.tsx", import.meta.url), "utf8")],
    ["crawler_import", readFileSync(new URL("../app/crawler/page.tsx", import.meta.url), "utf8")],
    ["prompt_approval", readFileSync(new URL("../app/prompt-fragments/page.tsx", import.meta.url), "utf8")],
    ["provider_routing", readFileSync(new URL("../app/providers/page.tsx", import.meta.url), "utf8")],
    ["quota_override", readFileSync(new URL("../app/quota/page.tsx", import.meta.url), "utf8")],
    ["safety_rule", readFileSync(new URL("../app/safety/page.tsx", import.meta.url), "utf8")],
    ["export_override", readFileSync(new URL("../app/exports/page.tsx", import.meta.url), "utf8")]
  ]);
  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  for (const token of [
    "RBAC Override Attempt Evidence",
    "RbacOverrideAttemptDecisionTable",
    "getAdminRbacOverrideAttemptDecisions",
    "State Digest",
    "Expected HTTP",
    "Submit Allowed",
    "buildAdminRbacOverrideAttemptDecisions",
    "adminRbacOverrideAttempts"
  ]) {
    assert.match(auditPage + attemptTable + adminApi + rbacRuntimeSource + source, new RegExp(token));
  }

  for (const [surface, pageSource] of attemptPageBySurface.entries()) {
    assert.match(
      pageSource,
      /getAdminRbacOverrideAttemptDecisions/,
      `${surface} console must fetch request-level override attempt evidence`
    );
    assert.match(
      pageSource,
      /RbacOverrideAttemptDecisionTable/,
      `${surface} console must render request-level override attempt evidence`
    );
    assert.match(
      pageSource,
      new RegExp(`item\\.surface === "${surface}"`),
      `${surface} console must filter override attempts to its governed surface`
    );
    assert.match(pageSource, /idempotency/i, `${surface} console must explain idempotency evidence`);
    assert.match(pageSource, /state digest/i, `${surface} console must explain state digest evidence`);
    assert.match(pageSource, /HTTP outcome/i, `${surface} console must explain HTTP outcome evidence`);
  }
});

test("admin RBAC override release bundles give every governed surface one release-facing verdict", () => {
  const {
    buildAdminRbacRuntimeDecisions,
    buildAdminRbacOverrideAttemptDecisions,
    buildAdminRbacStaleReplayDecisions,
    buildAdminRbacEvidencePacks,
    buildAdminRbacReleaseEvidenceClosures,
    buildAdminRbacReleaseReadinessSummaries,
    buildAdminRbacOverrideReleaseBundles
  } = parseRbacRuntime();
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const attemptDecisions = buildAdminRbacOverrideAttemptDecisions(adminRbacOverrideAttempts, runtimeDecisions);
  const staleReplayDecisions = buildAdminRbacStaleReplayDecisions(
    adminRbacEvidence,
    runtimeDecisions,
    new Date("2026-05-26T19:00:00Z")
  );
  const evidencePacks = buildAdminRbacEvidencePacks(adminRbacEvidence, runtimeDecisions, staleReplayDecisions);
  const closures = buildAdminRbacReleaseEvidenceClosures(evidencePacks, attemptDecisions, staleReplayDecisions);
  const readinessSummaries = buildAdminRbacReleaseReadinessSummaries(closures, evidencePacks);
  const bundles = buildAdminRbacOverrideReleaseBundles(readinessSummaries, closures, runtimeDecisions);
  const bundleBySurface = new Map(bundles.map((bundle) => [bundle.surface, bundle]));
  const runtimeBySurface = new Map();

  for (const decision of runtimeDecisions) {
    runtimeBySurface.set(decision.surface, [...(runtimeBySurface.get(decision.surface) ?? []), decision]);
  }

  assert.equal(
    bundles.length,
    overrideScopeBySurface.size,
    "release bundle needs one row per governed admin override surface"
  );

  for (const [surface, overrideScope] of overrideScopeBySurface.entries()) {
    const bundle = bundleBySurface.get(surface);
    const closure = closures.find((entry) => entry.surface === surface);
    const readiness = readinessSummaries.find((entry) => entry.surface === surface);
    const runtime = runtimeBySurface.get(surface) ?? [];

    assert.ok(bundle, `${surface} needs an override release bundle`);
    assert.ok(closure, `${surface} needs release closure for bundle`);
    assert.ok(readiness, `${surface} needs release readiness for bundle`);
    assert.equal(bundle.overrideScope, overrideScope, `${surface} bundle scope mismatch`);
    assert.deepEqual(bundle.evidenceIds.toSorted(), readiness.evidenceIds.toSorted(), `${surface} bundle evidence ids must match readiness`);
    assert.deepEqual(bundle.attemptIds.toSorted(), closure.attemptIds.toSorted(), `${surface} bundle attempt ids must match closure`);
    assert.deepEqual(bundle.auditRefs.toSorted(), readiness.auditRefs.toSorted(), `${surface} bundle audit refs must match readiness`);
    assert.deepEqual(
      bundle.closureEvidenceRefs.toSorted(),
      readiness.closureEvidenceRefs.toSorted(),
      `${surface} bundle closure refs must match readiness`
    );
    assert.equal(bundle.targetCount, runtime.length, `${surface} bundle target count must match runtime decisions`);
    assert.equal(bundle.evidenceHealth, "complete", `${surface} bundle should be complete for current fixtures`);
    assert.ok(bundle.requiredRoles.length > 0, `${surface} bundle needs required role evidence`);
    assert.ok(bundle.runtimeOutcomes.length > 0, `${surface} bundle needs runtime outcomes`);
    assert.ok(bundle.attemptOutcomes.length > 0, `${surface} bundle needs attempt outcomes`);
    assert.ok(bundle.operatorAction.length > 120, `${surface} bundle needs operator action`);

    for (const auditRef of bundle.auditRefs) {
      assert.ok(auditIds.has(auditRef), `${surface} bundle links unknown audit ${auditRef}`);
    }

    assert.equal(
      bundle.reviewHoldCount,
      runtime.filter((decision) => decision.effectiveDecision === "queue_for_review").length,
      `${surface} bundle review hold count mismatch`
    );
    assert.equal(
      bundle.deniedMutationCount,
      runtime.filter((decision) => decision.effectiveDecision === "deny_mutation").length,
      `${surface} bundle denied mutation count mismatch`
    );
    assert.equal(
      bundle.expiredReplayCount,
      runtime.filter((decision) => decision.requestOutcome === "denied_expired_override").length,
      `${surface} bundle expired replay count mismatch`
    );
    assert.equal(
      bundle.temporaryMutationCount,
      runtime.filter((decision) => decision.effectiveDecision === "allow_mutation").length,
      `${surface} bundle temporary mutation count mismatch`
    );

    if (bundle.gateVerdict === "release_ready_with_expiry") {
      assert.equal(bundle.releaseUseAllowed, bundle.blockerCodes.length === 0, `${surface} release-ready bundle cannot hide blockers`);
    } else {
      assert.equal(bundle.releaseUseAllowed, false, `${surface} preserved bundle cannot allow release use`);
    }
  }

  assert.equal(
    bundleBySurface.get("provider_routing").gateVerdict,
    "gate_preserved_by_stale_replay",
    "provider bundle must preserve stale replay evidence"
  );
  assert.ok(
    bundleBySurface.get("provider_routing").blockerCodes.includes("expired_override_window"),
    "provider bundle must expose expired override blocker"
  );
  assert.equal(
    bundleBySurface.get("quota_override").gateVerdict,
    "gate_preserved_by_policy",
    "quota bundle must preserve support-only policy block"
  );
  assert.equal(
    bundleBySurface.get("export_override").gateVerdict,
    "gate_preserved_by_policy",
    "export bundle must preserve blocking QA policy"
  );
  assert.equal(
    bundleBySurface.get("skill_release").gateVerdict,
    "gate_preserved_by_stale_replay",
    "skill release bundle must preserve stale second-review replay evidence"
  );

  const auditPage = readFileSync(new URL("../app/audit/page.tsx", import.meta.url), "utf8");
  const adminApi = readFileSync(new URL("../lib/admin-api.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("../lib/types.ts", import.meta.url), "utf8");

  for (const token of [
    "AdminRbacOverrideReleaseBundle",
    "getAdminRbacOverrideReleaseBundles",
    "buildAdminRbacOverrideReleaseBundles",
    "RBAC Override Release Bundle",
    "Gate Verdict",
    "Evidence Health",
    "Release Use",
    "Expired Replays",
    "gate_preserved_by_stale_replay",
    "gate_preserved_by_policy",
    "release_ready_with_expiry"
  ]) {
    assert.match(auditPage + adminApi + rbacRuntimeSource + types, new RegExp(token));
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
    assert.match(workflow.quarantineStatus, /active|cleared|scheduled/, `${workflow.id} needs quarantine status`);
    assert.match(workflow.slaStatus, /within_window|expired|not_required/, `${workflow.id} needs SLA status`);
    assert.ok(workflow.affectedActivationSurfaces.length >= 2, `${workflow.id} needs affected activation surfaces`);
    assert.ok(
      workflow.affectedActivationSurfaces.every((surface) =>
        ["prompt_fragment", "skill_version", "meta_prompt", "provider_route"].includes(surface)
      ),
      `${workflow.id} has unknown affected activation surface`
    );
    assert.match(workflow.linkedReview, /^rv-crawler-\d+$/, `${workflow.id} needs linked crawler review id`);
    assert.ok(workflow.operatorNextAction.length > 100, `${workflow.id} needs actionable operator next action`);
    assert.ok(workflow.closureCriteria.length > 100, `${workflow.id} needs closure criteria`);
    assert.ok(workflow.closureCriteria.includes(workflow.auditRef), `${workflow.id} closure criteria must cite audit ref`);
    assert.ok(workflow.requiredEvidenceRefs.length >= 3, `${workflow.id} needs evidence refs`);
    assert.notEqual(workflow.deletionEvidenceRef, "pending", `${workflow.id} needs deletion or retention evidence ref`);
    assert.notEqual(workflow.requesterNoticeRef, "pending", `${workflow.id} needs requester notice evidence ref`);
    assert.notEqual(workflow.escalationEvidenceRef, "pending", `${workflow.id} needs escalation evidence ref or explicit not-required marker`);
    assert.ok(
      workflow.requiredEvidenceRefs.includes(workflow.deletionEvidenceRef) || workflow.deletionEvidenceRef.startsWith("not_required"),
      `${workflow.id} deletion evidence must be either required or explicitly not required`
    );
    assert.ok(
      workflow.requiredEvidenceRefs.includes(workflow.requesterNoticeRef),
      `${workflow.id} requester notice evidence must be required for closure`
    );
    assert.ok(
      workflow.requiredEvidenceRefs.includes(workflow.escalationEvidenceRef) || workflow.escalationEvidenceRef.startsWith("not_required"),
      `${workflow.id} escalation evidence must be either required or explicitly not required`
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
      assert.equal(workflow.quarantineStatus, "active", `${workflow.id} takedown must actively quarantine source material`);
      assert.equal(workflow.slaStatus, "expired", `${workflow.id} overdue takedown must expose expired SLA`);
      assert.ok(workflow.affectedActivationSurfaces.includes("provider_route"), `${workflow.id} takedown must block provider routes`);
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
      assert.equal(workflow.quarantineStatus, "cleared", `${workflow.id} approved derivative review should clear quarantine`);
    }

    if (workflow.derivativeUseStatus === "unknown" || workflow.derivativeUseStatus === "restricted") {
      assert.equal(workflow.blockedActivation, true, `${workflow.id} unresolved derivative status must block activation`);
      assert.match(workflow.operatorNextAction, /prevent crawler-derived prompt activation/i, `${workflow.id} unresolved derivative review must prevent activation`);
      assert.equal(workflow.activationGateDecision, "blocked", `${workflow.id} unresolved derivative review must block activation gate`);
      assert.notEqual(workflow.quarantineStatus, "cleared", `${workflow.id} unresolved derivative review cannot clear quarantine`);
    }
  }
});

test("crawler governance runtime decisions gate takedown closure and activation", () => {
  const decisions = buildCrawlerGovernanceRuntimeDecisions(crawlerGovernanceWorkflows, new Date("2026-05-26T18:30:00Z"));
  const decisionsByWorkflow = new Map(decisions.map((decision) => [decision.workflowId, decision]));
  const runtimeEvidenceByWorkflow = new Map(
    crawlerGovernanceRuntimeEvidence.runtime_decisions.map((decision) => [decision.workflow_id, decision])
  );

  assert.equal(decisions.length, crawlerGovernanceWorkflows.length, "each crawler workflow needs one runtime decision");
  assert.equal(crawlerGovernanceRuntimeEvidence.evidence_scope, "admin_fixture_runtime");
  assert.equal(crawlerGovernanceRuntimeEvidence.runtime_source, "admin/lib/crawler-runtime.ts");
  assert.equal(crawlerGovernanceRuntimeEvidence.admin_surface, "admin/app/crawler/page.tsx");
  assert.equal(crawlerGovernanceRuntimeEvidence.launch_gate_impact.can_clear_admin_fixture_item, true);
  assert.equal(crawlerGovernanceRuntimeEvidence.launch_gate_impact.can_clear_private_beta_aggregate, false);
  assert.equal(crawlerGovernanceRuntimeEvidence.launch_gate_impact.can_clear_production_launch, false);
  assert.ok(
    crawlerGovernanceRuntimeEvidence.launch_gate_impact.preserved_blockers.includes("object_storage_signed_retention_runtime_missing"),
    "admin crawler runtime evidence must preserve unrelated staging retention blockers"
  );

  const takedownDecision = decisionsByWorkflow.get("cg-501");
  const takedownRuntimeEvidence = runtimeEvidenceByWorkflow.get("cg-501");
  assert.ok(takedownRuntimeEvidence, "cg-501 must have durable crawler runtime evidence");
  assert.equal(takedownDecision.closureDecision, "blocked", "open takedown with pending evidence must block closure");
  assert.equal(takedownRuntimeEvidence.closure_decision, takedownDecision.closureDecision);
  assert.equal(takedownDecision.activationDecision, "block_activation", "open takedown must block activation");
  assert.equal(takedownRuntimeEvidence.activation_decision, takedownDecision.activationDecision);
  assert.equal(takedownRuntimeEvidence.deletion_evidence_status, takedownDecision.deletionEvidenceStatus);
  assert.equal(takedownRuntimeEvidence.requester_notice_status, takedownDecision.requesterNoticeStatus);
  assert.equal(takedownRuntimeEvidence.escalation_evidence_status, takedownDecision.escalationEvidenceStatus);
  assert.equal(takedownRuntimeEvidence.second_review_status, takedownDecision.secondReviewStatus);
  assert.equal(takedownRuntimeEvidence.audit_status, takedownDecision.auditStatus);
  assert.equal(takedownRuntimeEvidence.required_evidence_status, takedownDecision.requiredEvidenceStatus);
  assert.deepEqual(takedownRuntimeEvidence.missing_required_evidence_refs, takedownDecision.missingRequiredEvidenceRefs);
  assert.equal(takedownRuntimeEvidence.deadline_status, takedownDecision.deadlineStatus);
  assert.deepEqual(takedownRuntimeEvidence.blocker_codes, takedownDecision.blockerCodes);
  assert.deepEqual(takedownRuntimeEvidence.required_evidence_refs, takedownDecision.requiredEvidenceRefs);
  assert.equal(takedownRuntimeEvidence.audit_ref, takedownDecision.auditRef);
  const takedownFixture = JSON.parse(readFileSync(new URL("fixtures/stage0/rev2/regressions/crawler_takedown_sup_2212.json", repoRoot), "utf8"));
  assert.equal(takedownFixture.runtime_contract.closure_decision, takedownDecision.closureDecision);
  assert.equal(takedownFixture.runtime_contract.activation_decision, takedownDecision.activationDecision);
  assert.equal(takedownFixture.runtime_contract.required_evidence_status, takedownDecision.requiredEvidenceStatus);
  assert.deepEqual(
    takedownFixture.runtime_contract.missing_required_evidence_refs,
    takedownDecision.missingRequiredEvidenceRefs
  );
  for (const blockerCode of takedownFixture.runtime_contract.blocker_codes) {
    assert.ok(takedownDecision.blockerCodes.includes(blockerCode), `open takedown must include fixture blocker ${blockerCode}`);
  }
  assert.equal(takedownDecision.deletionEvidenceStatus, "pending", "open takedown must expose pending deletion evidence");
  assert.equal(takedownDecision.requesterNoticeStatus, "pending", "open takedown must expose pending requester notice");
  assert.ok(
    takedownDecision.closureEvidenceChecklist.includes("deletion:pending"),
    "open takedown closure checklist must expose pending deletion evidence"
  );
  assert.ok(
    takedownDecision.closureEvidenceChecklist.includes("requester_notice:pending"),
    "open takedown closure checklist must expose pending requester notice"
  );
  assert.match(
    takedownDecision.activationGuardrail,
    /Activation remains blocked.*crawler-derived prompt, skill, and fragment changes cannot activate/i,
    "open takedown needs an activation guardrail that blocks crawler-derived activation"
  );
  assert.match(
    takedownDecision.reviewEscalation,
    /Second reviewer must complete/i,
    "open takedown needs second-review escalation guidance"
  );
  assert.match(
    takedownDecision.releaseGateEvidence,
    /Release gate must keep cg-501 blocked.*takedown, derivative-use, retention, notice, deadline escalation, and audit evidence/i,
    "open takedown needs release-gate blocker evidence"
  );
  assert.ok(takedownDecision.blockerCodes.includes("deletion_evidence_pending"), "open takedown needs deletion blocker");
  assert.ok(takedownDecision.blockerCodes.includes("requester_notice_pending"), "open takedown needs notice blocker");
  assert.equal(
    takedownDecision.requiredEvidenceStatus,
    "missing",
    "open takedown cannot treat pending placeholder refs as complete required evidence"
  );
  assert.deepEqual(
    takedownDecision.missingRequiredEvidenceRefs,
    ["pending-raw-derivative-delete-cs-21", "pending-rights-owner-notice-ip-7001", "pending-deadline-escalation-cg-501"],
    "open takedown must expose unresolved deletion, requester-notice, and deadline escalation placeholders as missing evidence"
  );
  assert.ok(
    takedownDecision.blockerCodes.includes("required_evidence_missing"),
    "open takedown pending placeholder refs need a required evidence blocker"
  );
  assert.ok(takedownDecision.blockerCodes.includes("second_review_open"), "open takedown needs second-review blocker");
  assert.equal(takedownDecision.deadlineStatus, "expired", "open takedown past due must expose expired deadline status");
  assert.ok(takedownDecision.blockerCodes.includes("deadline_expired"), "open takedown past due needs deadline blocker");
  assert.equal(takedownDecision.escalationEvidenceStatus, "pending", "open expired takedown must expose pending escalation evidence");
  assert.ok(takedownDecision.blockerCodes.includes("deadline_escalation_pending"), "open expired takedown needs escalation evidence blocker");
  assert.ok(
    takedownDecision.closureEvidenceChecklist.includes("deadline_escalation:pending"),
    "open expired takedown closure checklist must expose pending escalation evidence"
  );

  const derivativeDecision = decisionsByWorkflow.get("cg-522");
  const derivativeRuntimeEvidence = runtimeEvidenceByWorkflow.get("cg-522");
  assert.ok(derivativeRuntimeEvidence, "cg-522 must have durable crawler runtime evidence");
  const derivativeFixture = JSON.parse(readFileSync(new URL("fixtures/stage0/rev2/regressions/crawler_derivative_review_cg_522.json", repoRoot), "utf8"));
  assert.equal(derivativeDecision.closureDecision, "ready_to_close", "approved derivative review should be closeable");
  assert.equal(derivativeRuntimeEvidence.closure_decision, derivativeDecision.closureDecision);
  assert.equal(derivativeDecision.activationDecision, "allow_activation", "approved derivative review should allow activation");
  assert.equal(derivativeRuntimeEvidence.activation_decision, derivativeDecision.activationDecision);
  assert.equal(derivativeRuntimeEvidence.deletion_evidence_status, derivativeDecision.deletionEvidenceStatus);
  assert.equal(derivativeRuntimeEvidence.requester_notice_status, derivativeDecision.requesterNoticeStatus);
  assert.equal(derivativeRuntimeEvidence.escalation_evidence_status, derivativeDecision.escalationEvidenceStatus);
  assert.equal(derivativeRuntimeEvidence.required_evidence_status, derivativeDecision.requiredEvidenceStatus);
  assert.deepEqual(derivativeRuntimeEvidence.missing_required_evidence_refs, derivativeDecision.missingRequiredEvidenceRefs);
  assert.deepEqual(derivativeRuntimeEvidence.blocker_codes, derivativeDecision.blockerCodes);
  assert.deepEqual(derivativeRuntimeEvidence.required_evidence_refs, derivativeDecision.requiredEvidenceRefs);
  assert.equal(derivativeFixture.runtime_contract.closure_decision, derivativeDecision.closureDecision);
  assert.equal(derivativeFixture.runtime_contract.activation_decision, derivativeDecision.activationDecision);
  assert.equal(derivativeFixture.runtime_contract.required_evidence_status, derivativeDecision.requiredEvidenceStatus);
  assert.equal(derivativeFixture.runtime_contract.deletion_evidence_status, derivativeDecision.deletionEvidenceStatus);
  assert.equal(derivativeFixture.runtime_contract.requester_notice_status, derivativeDecision.requesterNoticeStatus);
  assert.equal(derivativeDecision.escalationEvidenceStatus, "not_required", "approved derivative review should not require escalation evidence");
  assert.equal(derivativeDecision.blockerCodes.length, 0, "approved derivative review should not expose blockers");
  assert.equal(derivativeDecision.auditStatus, "attached", "approved derivative review needs audit evidence");
  assert.equal(derivativeDecision.requiredEvidenceStatus, "complete", "approved derivative review needs complete required evidence");
  assert.deepEqual(derivativeDecision.missingRequiredEvidenceRefs, [], "approved derivative review should not miss required evidence refs");
  assert.equal(derivativeDecision.deadlineStatus, "not_evaluated", "approved derivative review should not create deadline blockers");
  assert.ok(
    derivativeDecision.requiredEvidenceRefs.includes("crawler-governance/crawler_approved_local_test_source"),
    "approved derivative review must keep source provenance evidence attached"
  );
  assert.ok(
    derivativeDecision.requiredEvidenceRefs.includes("notice-legal-fixture-reviewer-cg-522"),
    "approved derivative review must keep requester notice evidence attached"
  );
  assert.ok(
    derivativeDecision.closureEvidenceChecklist.includes("deletion:complete"),
    "approved derivative review must expose complete deletion or retention evidence"
  );
  assert.match(
    derivativeDecision.activationGuardrail,
    /Activation can proceed only.*bounded retention.*au-013/i,
    "approved derivative review needs bounded-retention activation guardrail"
  );
  assert.match(
    derivativeDecision.releaseGateEvidence,
    /Release gate can cite cg-522.*takedown, derivative-use, retention, provenance, deadline escalation, and notice evidence/i,
    "approved derivative review needs release-gate evidence summary"
  );

  const retentionDecision = decisionsByWorkflow.get("cg-533");
  const retentionRuntimeEvidence = runtimeEvidenceByWorkflow.get("cg-533");
  assert.ok(retentionRuntimeEvidence, "cg-533 must have durable crawler runtime evidence");
  assert.equal(retentionDecision.closureDecision, "blocked", "pending raw retention delete must block closure");
  assert.equal(retentionRuntimeEvidence.closure_decision, retentionDecision.closureDecision);
  assert.equal(retentionDecision.activationDecision, "block_activation", "pending raw retention delete must block activation");
  assert.equal(retentionRuntimeEvidence.activation_decision, retentionDecision.activationDecision);
  assert.equal(retentionRuntimeEvidence.deletion_evidence_status, retentionDecision.deletionEvidenceStatus);
  assert.equal(retentionRuntimeEvidence.requester_notice_status, retentionDecision.requesterNoticeStatus);
  assert.equal(retentionRuntimeEvidence.escalation_evidence_status, retentionDecision.escalationEvidenceStatus);
  assert.equal(retentionRuntimeEvidence.required_evidence_status, retentionDecision.requiredEvidenceStatus);
  assert.deepEqual(retentionRuntimeEvidence.missing_required_evidence_refs, retentionDecision.missingRequiredEvidenceRefs);
  assert.deepEqual(retentionRuntimeEvidence.blocker_codes, retentionDecision.blockerCodes);
  assert.deepEqual(retentionRuntimeEvidence.required_evidence_refs, retentionDecision.requiredEvidenceRefs);
  assert.ok(retentionDecision.blockerCodes.includes("deletion_evidence_pending"), "pending retention delete needs deletion blocker");
  assert.ok(retentionDecision.blockerCodes.includes("requester_notice_pending"), "pending retention delete needs notice blocker");
  assert.equal(retentionDecision.requiredEvidenceStatus, "missing", "pending retention delete cannot close from placeholder refs");
  assert.deepEqual(
    retentionDecision.missingRequiredEvidenceRefs,
    ["pending-raw-delete-cs-18", "pending-crawler-ops-notice-cg-533"],
    "pending retention delete must name unresolved deletion and notice placeholder refs"
  );
  assert.equal(retentionDecision.deadlineStatus, "within_window", "pending retention delete should expose active deadline window");
  assert.equal(retentionDecision.escalationEvidenceStatus, "not_required", "within-window retention delete should not require escalation evidence");

  const rejectedSecondReviewDecision = buildCrawlerGovernanceRuntimeDecisions([
    {
      ...crawlerGovernanceWorkflows.find((workflow) => workflow.id === "cg-501"),
      deletionEvidenceRef: "raw-derivative-delete-cs-21-complete",
      requesterNoticeRef: "rights-owner-notice-ip-7001-complete",
      escalationEvidenceRef: "deadline-escalation-cg-501-complete",
      blockedActivation: false,
      activationGateDecision: "allowed",
      secondReviewStatus: "rejected"
    }
  ])[0];
  assert.equal(
    rejectedSecondReviewDecision.closureDecision,
    "blocked",
    "rejected second review must block crawler workflow closure even when deletion and notice evidence are attached"
  );
  assert.equal(
    rejectedSecondReviewDecision.activationDecision,
    "block_activation",
    "rejected second review must block crawler-derived activation"
  );
  assert.ok(
    rejectedSecondReviewDecision.blockerCodes.includes("second_review_rejected"),
    "rejected second review needs an explicit blocker code"
  );
  assert.match(
    rejectedSecondReviewDecision.reviewEscalation,
    /Second review rejected/i,
    "rejected second review needs explicit escalation text"
  );

  const staleReadyAttemptDecision = buildCrawlerGovernanceRuntimeDecisions(
    [
      {
        ...crawlerGovernanceWorkflows.find((workflow) => workflow.id === "cg-501"),
        deletionEvidenceRef: "raw-derivative-delete-cs-21-complete",
        requesterNoticeRef: "rights-owner-notice-ip-7001-complete",
        escalationEvidenceRef: "deadline-escalation-cg-501-complete",
        requiredEvidenceRefs: [
          "cf-118",
          "crawler-source cs-21",
          "ip-7001",
          "raw-derivative-delete-cs-21-complete",
          "rights-owner-notice-ip-7001-complete",
          "deadline-escalation-cg-501-complete",
          "au-012"
        ],
        blockedActivation: false,
        activationGateDecision: "allowed",
        secondReviewStatus: "required"
      }
    ],
    new Date("2026-05-26T18:30:00Z")
  )[0];
  assert.equal(
    staleReadyAttemptDecision.closureDecision,
    "blocked",
    "expired takedown cannot close from deletion and notice evidence while second review remains open"
  );
  assert.equal(staleReadyAttemptDecision.activationDecision, "block_activation", "expired takedown cannot reactivate crawler material");
  assert.equal(staleReadyAttemptDecision.deletionEvidenceStatus, "complete", "stale attempt should still record attached deletion evidence");
  assert.equal(staleReadyAttemptDecision.requesterNoticeStatus, "complete", "stale attempt should still record attached requester notice");
  assert.equal(staleReadyAttemptDecision.escalationEvidenceStatus, "complete", "stale attempt should record attached escalation evidence");
  assert.equal(staleReadyAttemptDecision.deadlineStatus, "expired", "stale attempt needs expired deadline status");
  assert.ok(staleReadyAttemptDecision.blockerCodes.includes("second_review_open"), "stale attempt needs second-review blocker");
  assert.ok(staleReadyAttemptDecision.blockerCodes.includes("deadline_expired"), "stale attempt needs deadline blocker");
  assert.ok(
    adminRbacEvidence
      .find((item) => item.id === "rbac-crawler-001")
      .releaseEvidenceRequired.includes("fresh second-review before expired deadline"),
    "crawler RBAC evidence must require a fresh second review after an expired takedown deadline"
  );

  const missingRequiredEvidenceDecision = buildCrawlerGovernanceRuntimeDecisions([
    {
      ...crawlerGovernanceWorkflows.find((workflow) => workflow.id === "cg-501"),
      deletionEvidenceRef: "raw-derivative-delete-cs-21-complete",
      requesterNoticeRef: "rights-owner-notice-ip-7001-complete",
      escalationEvidenceRef: "deadline-escalation-cg-501-complete",
      blockedActivation: false,
      activationGateDecision: "allowed",
      secondReviewStatus: "completed"
    }
  ])[0];
  assert.equal(
    missingRequiredEvidenceDecision.closureDecision,
    "blocked",
    "crawler takedown cannot close when attached deletion and notice refs are missing from required evidence"
  );
  assert.equal(
    missingRequiredEvidenceDecision.activationDecision,
    "block_activation",
    "crawler takedown cannot reactivate when required evidence refs are incomplete"
  );
  assert.equal(
    missingRequiredEvidenceDecision.requiredEvidenceStatus,
    "missing",
    "runtime must expose missing required evidence status"
  );
  assert.deepEqual(
    missingRequiredEvidenceDecision.missingRequiredEvidenceRefs,
    [
      "pending-raw-derivative-delete-cs-21",
      "pending-rights-owner-notice-ip-7001",
      "pending-deadline-escalation-cg-501",
      "raw-derivative-delete-cs-21-complete",
      "rights-owner-notice-ip-7001-complete",
      "deadline-escalation-cg-501-complete"
    ],
    "runtime must name stale pending placeholders and the newly attached deletion, notice, and escalation refs missing from required evidence"
  );
  assert.ok(
    missingRequiredEvidenceDecision.blockerCodes.includes("required_evidence_missing"),
    "missing required evidence needs an explicit blocker code"
  );

  for (const workflow of crawlerGovernanceWorkflows) {
    const decision = decisionsByWorkflow.get(workflow.id);
    assert.ok(decision, `${workflow.id} is missing runtime decision`);
    assert.equal(decision.findingId, workflow.findingId, `${workflow.id} must preserve finding linkage`);
    assert.equal(decision.requestType, workflow.requestType, `${workflow.id} must preserve request type`);
    assert.equal(decision.auditRef, workflow.auditRef, `${workflow.id} must preserve audit ref`);
    assert.deepEqual(decision.requiredEvidenceRefs, workflow.requiredEvidenceRefs, `${workflow.id} must preserve required evidence refs`);
    if (
      workflow.requiredEvidenceRefs.some((ref) => ref === "pending" || ref.startsWith("pending-") || ref.trim().length === 0)
    ) {
      assert.equal(decision.requiredEvidenceStatus, "missing", `${workflow.id} pending placeholder refs must keep required evidence incomplete`);
      assert.ok(
        decision.missingRequiredEvidenceRefs.every((ref) => ref === "pending" || ref.startsWith("pending-")),
        `${workflow.id} missing required evidence must name pending placeholder refs`
      );
      assert.ok(decision.blockerCodes.includes("required_evidence_missing"), `${workflow.id} needs required-evidence blocker`);
    } else {
      assert.equal(decision.requiredEvidenceStatus, "complete", `${workflow.id} fixture evidence refs should be complete`);
      assert.deepEqual(decision.missingRequiredEvidenceRefs, [], `${workflow.id} fixture should not miss required evidence refs`);
    }
    assert.ok(decision.operatorAction.length > 80, `${workflow.id} needs executable operator action`);
    assert.ok(decision.closureEvidenceChecklist.length >= 7, `${workflow.id} needs full closure checklist evidence`);
    assert.ok(decision.closureEvidenceChecklist.some((item) => item.startsWith("audit:")), `${workflow.id} checklist must include audit status`);
    assert.ok(decision.activationGuardrail.length > 110, `${workflow.id} needs activation guardrail text`);
    assert.ok(decision.reviewEscalation.length > 90, `${workflow.id} needs review escalation text`);
    assert.ok(decision.releaseGateEvidence.length > 150, `${workflow.id} needs release-gate evidence text`);

    if (workflow.blockedActivation) {
      assert.equal(decision.activationDecision, "block_activation", `${workflow.id} blocked workflow cannot activate`);
      assert.ok(decision.blockerCodes.includes("activation_blocked"), `${workflow.id} needs activation blocker`);
    }
  }
});

test("crawler governance closure summaries preserve release blockers before activation", () => {
  const decisions = buildCrawlerGovernanceRuntimeDecisions(crawlerGovernanceWorkflows, new Date("2026-05-26T18:30:00Z"));
  const summaries = buildCrawlerGovernanceClosureSummaries(decisions);
  const summaryByWorkflow = new Map(summaries.map((summary) => [summary.workflowId, summary]));
  const closureEvidenceByWorkflow = new Map(
    crawlerGovernanceRuntimeEvidence.closure_summaries.map((summary) => [summary.workflow_id, summary])
  );

  assert.equal(summaries.length, crawlerGovernanceWorkflows.length, "each crawler workflow needs one closure summary");

  const takedownSummary = summaryByWorkflow.get("cg-501");
  const takedownClosureEvidence = closureEvidenceByWorkflow.get("cg-501");
  assert.ok(takedownClosureEvidence, "cg-501 must have durable closure summary evidence");
  assert.equal(takedownSummary.releaseClosureState, "blocked");
  assert.equal(takedownClosureEvidence.release_closure_state, takedownSummary.releaseClosureState);
  assert.equal(takedownSummary.activationSafetyState, "activation_blocked");
  assert.equal(takedownClosureEvidence.activation_safety_state, takedownSummary.activationSafetyState);
  assert.equal(takedownSummary.evidenceCompleteness, "missing");
  assert.equal(takedownClosureEvidence.evidence_completeness, takedownSummary.evidenceCompleteness);
  assert.equal(takedownSummary.takedownDeleteStatus, "pending");
  assert.equal(takedownClosureEvidence.takedown_delete_status, takedownSummary.takedownDeleteStatus);
  assert.equal(takedownSummary.deadlineEscalationStatus, "pending");
  assert.equal(takedownClosureEvidence.deadline_escalation_status, takedownSummary.deadlineEscalationStatus);
  assert.equal(takedownSummary.secondReviewGate, "required");
  assert.equal(takedownClosureEvidence.second_review_gate, takedownSummary.secondReviewGate);
  assert.equal(takedownSummary.releaseGateDisposition, "preserve_blocker");
  assert.equal(takedownClosureEvidence.release_gate_disposition, takedownSummary.releaseGateDisposition);
  assert.deepEqual(takedownSummary.missingEvidenceRefs, [
    "pending-raw-derivative-delete-cs-21",
    "pending-rights-owner-notice-ip-7001",
    "pending-deadline-escalation-cg-501"
  ]);
  assert.deepEqual(takedownClosureEvidence.missing_evidence_refs, takedownSummary.missingEvidenceRefs);
  assert.deepEqual(takedownClosureEvidence.blocker_codes, takedownSummary.blockerCodes);
  assert.ok(takedownSummary.blockerCodes.includes("activation_blocked"));
  assert.ok(takedownSummary.blockerCodes.includes("required_evidence_missing"));
  assert.match(
    takedownSummary.operatorSummary,
    /Keep cg-501 out of release-clearing evidence.*crawler-derived activation stays blocked/i
  );

  const derivativeSummary = summaryByWorkflow.get("cg-522");
  const derivativeClosureEvidence = closureEvidenceByWorkflow.get("cg-522");
  assert.ok(derivativeClosureEvidence, "cg-522 must have durable closure summary evidence");
  assert.equal(derivativeSummary.releaseClosureState, "closure_ready");
  assert.equal(derivativeClosureEvidence.release_closure_state, derivativeSummary.releaseClosureState);
  assert.equal(derivativeSummary.activationSafetyState, "activation_safe");
  assert.equal(derivativeClosureEvidence.activation_safety_state, derivativeSummary.activationSafetyState);
  assert.equal(derivativeSummary.evidenceCompleteness, "complete");
  assert.equal(derivativeClosureEvidence.evidence_completeness, derivativeSummary.evidenceCompleteness);
  assert.equal(derivativeSummary.takedownDeleteStatus, "not_applicable");
  assert.equal(derivativeClosureEvidence.takedown_delete_status, derivativeSummary.takedownDeleteStatus);
  assert.equal(derivativeSummary.deadlineEscalationStatus, "not_required");
  assert.equal(derivativeClosureEvidence.deadline_escalation_status, derivativeSummary.deadlineEscalationStatus);
  assert.equal(derivativeSummary.secondReviewGate, "not_required");
  assert.equal(derivativeClosureEvidence.second_review_gate, derivativeSummary.secondReviewGate);
  assert.equal(derivativeSummary.releaseGateDisposition, "can_cite_release_evidence");
  assert.equal(derivativeClosureEvidence.release_gate_disposition, derivativeSummary.releaseGateDisposition);
  assert.deepEqual(derivativeSummary.missingEvidenceRefs, []);
  assert.deepEqual(derivativeClosureEvidence.missing_evidence_refs, derivativeSummary.missingEvidenceRefs);
  assert.deepEqual(derivativeSummary.blockerCodes, []);
  assert.deepEqual(derivativeClosureEvidence.blocker_codes, derivativeSummary.blockerCodes);
  assert.match(
    derivativeSummary.operatorSummary,
    /Release evidence may cite cg-522 only with audit au-013.*retention policy.*activation guardrail preserved/i
  );

  const retentionSummary = summaryByWorkflow.get("cg-533");
  const retentionClosureEvidence = closureEvidenceByWorkflow.get("cg-533");
  assert.ok(retentionClosureEvidence, "cg-533 must have durable closure summary evidence");
  assert.equal(retentionSummary.releaseClosureState, "blocked");
  assert.equal(retentionClosureEvidence.release_closure_state, retentionSummary.releaseClosureState);
  assert.equal(retentionSummary.activationSafetyState, "activation_blocked");
  assert.equal(retentionClosureEvidence.activation_safety_state, retentionSummary.activationSafetyState);
  assert.equal(retentionSummary.takedownDeleteStatus, "pending");
  assert.equal(retentionClosureEvidence.takedown_delete_status, retentionSummary.takedownDeleteStatus);
  assert.equal(retentionSummary.deadlineEscalationStatus, "not_required");
  assert.equal(retentionClosureEvidence.deadline_escalation_status, retentionSummary.deadlineEscalationStatus);
  assert.equal(retentionSummary.releaseGateDisposition, "preserve_blocker");
  assert.equal(retentionClosureEvidence.release_gate_disposition, retentionSummary.releaseGateDisposition);
  assert.deepEqual(retentionClosureEvidence.missing_evidence_refs, retentionSummary.missingEvidenceRefs);
  assert.deepEqual(retentionClosureEvidence.blocker_codes, retentionSummary.blockerCodes);

  for (const summary of summaries) {
    const workflow = crawlerGovernanceWorkflows.find((entry) => entry.id === summary.workflowId);
    assert.ok(workflow, `${summary.workflowId} links unknown workflow`);
    assert.equal(summary.findingId, workflow.findingId, `${summary.workflowId} must preserve finding linkage`);
    assert.equal(summary.requestType, workflow.requestType, `${summary.workflowId} must preserve request type`);
    assert.equal(summary.auditRef, workflow.auditRef, `${summary.workflowId} must preserve audit ref`);
    assert.ok(summary.operatorSummary.length > 120, `${summary.workflowId} needs release operator summary`);

    if (summary.releaseGateDisposition === "can_cite_release_evidence") {
      assert.equal(summary.releaseClosureState, "closure_ready", `${summary.workflowId} release evidence needs closure ready`);
      assert.equal(summary.activationSafetyState, "activation_safe", `${summary.workflowId} release evidence needs activation safe`);
      assert.equal(summary.evidenceCompleteness, "complete", `${summary.workflowId} release evidence needs complete evidence`);
    } else {
      assert.ok(summary.blockerCodes.length > 0, `${summary.workflowId} preserved blocker summary needs blocker codes`);
      assert.equal(summary.activationSafetyState, "activation_blocked", `${summary.workflowId} preserved blocker summary keeps activation blocked`);
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

test("production legal support policy evidence clears only the legal/support production check", () => {
  assert.ok(existsSync(productionPublicLegalPolicyPath), "production public legal policy evidence file is missing");
  assert.ok(
    existsSync(productionPublicSupportBillingPolicyPath),
    "production public support/billing policy evidence file is missing"
  );
  assert.ok(existsSync(productionGatePath), "production launch gate evidence fixture is missing");

  const legalFile = JSON.parse(readFileSync(productionPublicLegalPolicyPath, "utf8"));
  const supportBillingFile = JSON.parse(readFileSync(productionPublicSupportBillingPolicyPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(productionGatePath, "utf8"));

  assert.equal(productionLegalSupportPolicyEvidence.environment, "production");
  assert.equal(productionLegalSupportPolicyEvidence.status, "pass_with_blockers_preserved");
  assert.equal(productionLegalSupportPolicyEvidence.releaseGateCheckId, "production_legal_support_policy");
  assert.equal(productionLegalSupportPolicyEvidence.doNotLaunchConditionId, "public_legal_support_policy_not_deployed");
  assert.equal(productionLegalSupportPolicyEvidence.legalPolicyEvidencePath, "ops/evidence/production/public-legal-policy.json");
  assert.equal(
    productionLegalSupportPolicyEvidence.supportBillingPolicyEvidencePath,
    "ops/evidence/production/public-support-billing-policy.json"
  );
  assert.equal(
    productionLegalSupportPolicyEvidence.gateImpact.aggregateProductionGateStatus,
    "blocked_by_other_production_runtime_items",
    "legal/support policy evidence cannot close the aggregate production gate"
  );

  for (const evidenceFile of [legalFile, supportBillingFile]) {
    assert.equal(evidenceFile.environment, "production", "split policy evidence must be production scoped");
    assert.equal(evidenceFile.status, "pass", "split policy evidence must pass");
    assert.equal(evidenceFile.release_gate_check_id, "production_legal_support_policy");
    assert.equal(evidenceFile.do_not_launch_condition_id, "public_legal_support_policy_not_deployed");
    assert.equal(
      evidenceFile.gate_impact.can_clear_aggregate_production_gate,
      false,
      "split policy evidence cannot clear aggregate production readiness"
    );
  }

  assert.deepEqual(
    [
      ...legalFile.runtime_request_ids,
      ...supportBillingFile.runtime_request_ids
    ].toSorted(),
    productionLegalSupportPolicyEvidence.runtimeRequestIds.toSorted(),
    "split production evidence files must cover the admin fixture runtime probe ids"
  );

  for (const requestId of productionLegalSupportPolicyEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^production-legal-support-policy-\d{8}T\d{4}Z-/,
      `${requestId} must be a production legal/support policy runtime probe`
    );
  }

  for (const auditRef of productionLegalSupportPolicyEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }

  const requiredAreas = new Set([
    "public_legal_pages",
    "public_support_contact",
    "billing_policy_visibility",
    "gate_blocker_preservation"
  ]);
  const legalFileAreas = new Set(legalFile.coverage.map((coverage) => coverage.area));
  const supportBillingFileAreas = new Set(supportBillingFile.coverage.map((coverage) => coverage.area));

  for (const coverage of productionLegalSupportPolicyEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("production"), `${coverage.area} must describe production runtime`);
    assert.match(
      coverage.runtimeProbe,
      /terms|privacy|acceptable|disclaimer|complaint|support|billing|refund|release-gate/i,
      `${coverage.area} must cover legal/support policy visibility`
    );
    assert.ok(coverage.deploymentEvidence.length > 110, `${coverage.area} needs deployment evidence`);
    assert.ok(coverage.policyAuditEvidence.length > 110, `${coverage.area} needs policy audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes(productionLegalSupportPolicyEvidence.legalPolicyEvidencePath) &&
        coverage.evidenceRefs.includes(productionLegalSupportPolicyEvidence.supportBillingPolicyEvidencePath),
      `${coverage.area} must cite both exact production policy evidence files`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          releaseEvidenceIds.has(ref) ||
          supportTicketIds.has(ref) ||
          crawlerGovernanceWorkflows.some((workflow) => workflow.id === ref) ||
          ref.startsWith("production_")
      ),
      `${coverage.area} needs validator-resolvable audit, release, support, crawler, or blocker refs`
    );

    if (coverage.area === "public_legal_pages") {
      assert.ok(legalFileAreas.has(coverage.area), `${coverage.area} must be present in public legal evidence`);
    } else {
      assert.ok(supportBillingFileAreas.has(coverage.area), `${coverage.area} must be present in support/billing evidence`);
    }
  }
  assert.deepEqual([...requiredAreas], [], "production legal/support evidence is missing coverage areas");

  const legalCheck = gateFixture.checks.find((check) => check.check_id === "production_legal_support_policy");
  assert.ok(legalCheck, "production gate needs legal/support policy check");
  assert.equal(legalCheck.status, "pass", "validated production policy evidence should clear only its check");
  assert.ok(legalCheck.evidence_ref.includes(productionLegalSupportPolicyEvidence.legalPolicyEvidencePath));
  assert.ok(legalCheck.evidence_ref.includes(productionLegalSupportPolicyEvidence.supportBillingPolicyEvidencePath));

  const legalCondition = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === productionLegalSupportPolicyEvidence.doNotLaunchConditionId
  );
  assert.ok(legalCondition, "production do-not-launch fixture needs legal/support condition");
  assert.equal(
    legalCondition.is_present,
    false,
    "validated production legal/support evidence should clear the matching do-not-launch condition"
  );
  assert.ok(legalCondition.evidence_ref.includes(productionLegalSupportPolicyEvidence.legalPolicyEvidencePath));
  assert.ok(legalCondition.evidence_ref.includes(productionLegalSupportPolicyEvidence.supportBillingPolicyEvidencePath));

  for (const blocker of productionLegalSupportPolicyEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the production gate fixture`);
    assert.equal(check.status, "blocked", `${blocker} must stay blocked after legal/support policy clears`);
  }

  assert.deepEqual(gateFixture.gate_decision.blocked_by_checks, ["production_backup_rollback_incident"]);
  assert.equal(
    gateFixture.gate_decision.active_do_not_launch_conditions.includes("public_legal_support_policy_not_deployed"),
    false,
    "production legal/support policy condition should be removed from active do-not-launch conditions"
  );
  assert.ok(
    gateFixture.do_not_launch_checks.some((condition) => condition.is_present === true),
    "aggregate production gate must remain blocked by unrelated launch conditions"
  );
});

test("production provider mode evidence clears provider and claims checks only", () => {
  assert.ok(existsSync(productionProviderModePath), "production provider mode evidence file is missing");
  assert.ok(
    existsSync(productionPublicPaidRealGenerationClaimsPath),
    "production public paid/real-generation claims evidence file is missing"
  );
  assert.ok(existsSync(productionGatePath), "production launch gate evidence fixture is missing");

  const providerFile = JSON.parse(readFileSync(productionProviderModePath, "utf8"));
  const claimsFile = JSON.parse(readFileSync(productionPublicPaidRealGenerationClaimsPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(productionGatePath, "utf8"));

  assert.equal(productionProviderModeEvidence.environment, "production");
  assert.equal(productionProviderModeEvidence.status, "pass_with_blockers_preserved");
  assert.equal(productionProviderModeEvidence.releaseGateCheckId, "production_provider_or_comp_only_mode");
  assert.deepEqual(productionProviderModeEvidence.doNotLaunchConditionIds, [
    "dev_mock_provider_public_claims_unresolved",
    "real_provider_or_comp_only_mode_missing"
  ]);
  assert.equal(productionProviderModeEvidence.providerModeEvidencePath, "ops/evidence/production/provider-mode.json");
  assert.equal(
    productionProviderModeEvidence.publicClaimsEvidencePath,
    "ops/evidence/production/public-paid-real-generation-claims.json"
  );
  assert.equal(
    productionProviderModeEvidence.gateImpact.aggregateProductionGateStatus,
    "blocked_by_other_production_runtime_items",
    "provider evidence cannot close the aggregate production gate"
  );

  for (const evidenceFile of [providerFile, claimsFile]) {
    assert.equal(evidenceFile.environment, "production");
    assert.equal(evidenceFile.status, "pass");
    assert.equal(evidenceFile.release_gate_check_id, "production_provider_or_comp_only_mode");
    assert.deepEqual(evidenceFile.do_not_launch_condition_ids, productionProviderModeEvidence.doNotLaunchConditionIds);
    assert.equal(evidenceFile.gate_impact.can_clear_aggregate_production_gate, false);
  }

  assert.deepEqual(
    [...providerFile.runtime_request_ids, ...claimsFile.runtime_request_ids].toSorted(),
    productionProviderModeEvidence.runtimeRequestIds.toSorted(),
    "split provider evidence files must cover the admin fixture runtime probe ids"
  );

  for (const requestId of productionProviderModeEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^production-provider-mode-\d{8}T\d{4}Z-/,
      `${requestId} must be a production provider runtime probe`
    );
  }

  assert.equal(providerFile.provider_mode.dev_provider_public_routing, false);
  assert.equal(providerFile.provider_mode.silent_fallback_enabled, false);
  assert.equal(providerFile.provider_contract.status, "production");
  assert.ok(providerFile.monitoring_cost.dashboard_id.length > 0);
  assert.ok(claimsFile.public_claim_probes.every((probe) => probe.http_status === 200));
  assert.ok(
    claimsFile.public_claim_probes.some((probe) => probe.claim_status === "dev_provider_marked_development_only"),
    "public claims evidence must prove dev provider is not represented as production"
  );

  for (const auditRef of productionProviderModeEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }

  const requiredAreas = new Set([
    "provider_launch_mode",
    "provider_contract_monitoring_cost",
    "public_paid_real_generation_claims",
    "gate_blocker_preservation"
  ]);
  const providerFileAreas = new Set(providerFile.coverage.map((coverage) => coverage.area));
  const claimsFileAreas = new Set(claimsFile.coverage.map((coverage) => coverage.area));

  for (const coverage of productionProviderModeEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("production"), `${coverage.area} must describe production runtime`);
    assert.match(
      coverage.runtimeProbe,
      /provider|claims|launch|real-generation|paid|release-gate/i,
      `${coverage.area} must cover production provider mode`
    );
    assert.ok(coverage.deploymentEvidence.length > 110, `${coverage.area} needs deployment evidence`);
    assert.ok(coverage.providerAuditEvidence.length > 110, `${coverage.area} needs provider audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes(productionProviderModeEvidence.providerModeEvidencePath) &&
        coverage.evidenceRefs.includes(productionProviderModeEvidence.publicClaimsEvidencePath),
      `${coverage.area} must cite both exact production provider evidence files`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          releaseEvidenceIds.has(ref) ||
          operationalDashboardIds.has(ref) ||
          alertRouteIds.has(ref) ||
          ref.startsWith("rbac-") ||
          ref.startsWith("ph-") ||
          ref.startsWith("production_")
      ),
      `${coverage.area} needs validator-resolvable audit, release, dashboard, alert, RBAC, provider, or blocker refs`
    );

    if (coverage.area === "public_paid_real_generation_claims" || coverage.area === "gate_blocker_preservation") {
      assert.ok(claimsFileAreas.has(coverage.area), `${coverage.area} must be present in public claims evidence`);
    } else {
      assert.ok(providerFileAreas.has(coverage.area), `${coverage.area} must be present in provider mode evidence`);
    }
  }
  assert.deepEqual([...requiredAreas], [], "production provider mode evidence is missing coverage areas");

  const providerCheck = gateFixture.checks.find((check) => check.check_id === "production_provider_or_comp_only_mode");
  assert.ok(providerCheck, "production gate needs provider mode check");
  assert.equal(providerCheck.status, "pass");
  assert.ok(providerCheck.evidence_ref.includes(productionProviderModeEvidence.providerModeEvidencePath));
  assert.ok(providerCheck.evidence_ref.includes(productionProviderModeEvidence.publicClaimsEvidencePath));

  for (const conditionId of productionProviderModeEvidence.doNotLaunchConditionIds) {
    const condition = gateFixture.do_not_launch_checks.find((entry) => entry.condition_id === conditionId);
    assert.ok(condition, `production gate needs ${conditionId}`);
    assert.equal(condition.is_present, false, `${conditionId} should be cleared by provider evidence`);
  }

  for (const blocker of productionProviderModeEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the production gate fixture`);
  }
  assert.deepEqual(gateFixture.gate_decision.blocked_by_checks, ["production_backup_rollback_incident"]);
  assert.equal(
    gateFixture.gate_decision.active_do_not_launch_conditions.includes("dev_mock_provider_public_claims_unresolved"),
    false
  );
  assert.equal(
    gateFixture.gate_decision.active_do_not_launch_conditions.includes("real_provider_or_comp_only_mode_missing"),
    false
  );
});

test("production paid billing lifecycle evidence clears billing lifecycle only", () => {
  assert.ok(existsSync(productionBillingLifecyclePath), "production billing lifecycle evidence file is missing");
  assert.ok(
    existsSync(productionBillingRefundCreditWebhookPath),
    "production billing refund/credit/webhook evidence file is missing"
  );
  assert.ok(existsSync(productionGatePath), "production launch gate evidence fixture is missing");

  const lifecycleFile = JSON.parse(readFileSync(productionBillingLifecyclePath, "utf8"));
  const refundWebhookFile = JSON.parse(readFileSync(productionBillingRefundCreditWebhookPath, "utf8"));
  const gateFixture = JSON.parse(readFileSync(productionGatePath, "utf8"));

  assert.equal(productionPaidBillingLifecycleEvidence.environment, "production");
  assert.equal(productionPaidBillingLifecycleEvidence.status, "pass_with_blockers_preserved");
  assert.equal(productionPaidBillingLifecycleEvidence.releaseGateCheckId, "production_paid_billing_lifecycle");
  assert.equal(productionPaidBillingLifecycleEvidence.doNotLaunchConditionId, "paid_billing_or_comp_only_mode_missing");
  assert.equal(productionPaidBillingLifecycleEvidence.billingLifecycleEvidencePath, "ops/evidence/production/billing-lifecycle.json");
  assert.equal(
    productionPaidBillingLifecycleEvidence.billingRefundCreditWebhookEvidencePath,
    "ops/evidence/production/billing-refund-credit-webhook.json"
  );
  assert.equal(
    productionPaidBillingLifecycleEvidence.gateImpact.aggregateProductionGateStatus,
    "blocked_by_other_production_runtime_items",
    "billing evidence cannot close the aggregate production gate"
  );

  for (const evidenceFile of [lifecycleFile, refundWebhookFile]) {
    assert.equal(evidenceFile.environment, "production");
    assert.equal(evidenceFile.status, "pass");
    assert.equal(evidenceFile.release_gate_check_id, "production_paid_billing_lifecycle");
    assert.equal(evidenceFile.do_not_launch_condition_id, "paid_billing_or_comp_only_mode_missing");
    assert.equal(evidenceFile.gate_impact.can_clear_aggregate_production_gate, false);
  }

  assert.deepEqual(
    [...lifecycleFile.runtime_request_ids, ...refundWebhookFile.runtime_request_ids].toSorted(),
    productionPaidBillingLifecycleEvidence.runtimeRequestIds.toSorted(),
    "split billing evidence files must cover the admin fixture runtime probe ids"
  );

  for (const requestId of productionPaidBillingLifecycleEvidence.runtimeRequestIds) {
    assert.match(
      requestId,
      /^production-paid-billing-\d{8}T\d{4}Z-/,
      `${requestId} must be a production paid billing runtime probe`
    );
  }

  assert.equal(lifecycleFile.checkout_provider, "production_paid_provider");
  assert.ok(
    lifecycleFile.lifecycle_probes.some((probe) => probe.probe_id === "past_due" && probe.assertions.includes("quota_consuming_task_denied")),
    "billing lifecycle evidence must prove past_due task denial"
  );
  assert.ok(
    refundWebhookFile.quota_mutation_probes.some(
      (probe) =>
        probe.probe_id === "webhook_idempotency" &&
        probe.assertions.includes("duplicate_events_deduped") &&
        probe.assertions.includes("quota_mutation_exactly_once")
    ),
    "billing refund/webhook evidence must prove webhook idempotency"
  );

  for (const auditRef of productionPaidBillingLifecycleEvidence.auditRefs) {
    assert.ok(auditIds.has(auditRef), `${auditRef} must link immutable audit evidence`);
  }
  for (const userId of productionPaidBillingLifecycleEvidence.quotaAccountIds) {
    assert.ok(quotaUserIds.has(userId), `${userId} must link a quota account`);
  }
  for (const ticketId of productionPaidBillingLifecycleEvidence.supportTicketIds) {
    assert.ok(supportTicketIds.has(ticketId), `${ticketId} must link a support ticket`);
  }

  const requiredAreas = new Set([
    "checkout_subscription_cancellation_past_due",
    "refund_credit_quota_reset",
    "webhook_idempotency",
    "gate_blocker_preservation"
  ]);
  const lifecycleFileAreas = new Set(lifecycleFile.coverage.map((coverage) => coverage.area));
  const refundWebhookFileAreas = new Set(refundWebhookFile.coverage.map((coverage) => coverage.area));

  for (const coverage of productionPaidBillingLifecycleEvidence.coverage) {
    requiredAreas.delete(coverage.area);
    assert.equal(coverage.status, "pass", `${coverage.area} must pass`);
    assert.ok(coverage.runtimeProbe.toLowerCase().includes("production"), `${coverage.area} must describe production runtime`);
    assert.match(
      coverage.runtimeProbe,
      /checkout|subscription|cancellation|past_due|refund|credit|quota|webhook|release-gate/i,
      `${coverage.area} must cover production billing lifecycle`
    );
    assert.ok(coverage.deploymentEvidence.length > 110, `${coverage.area} needs deployment evidence`);
    assert.ok(coverage.billingAuditEvidence.length > 110, `${coverage.area} needs billing audit evidence`);
    assert.ok(coverage.linkedAdminArtifacts.some((ref) => ref.startsWith("admin/")), `${coverage.area} needs admin artifacts`);
    assert.ok(
      coverage.evidenceRefs.includes(productionPaidBillingLifecycleEvidence.billingLifecycleEvidencePath) &&
        coverage.evidenceRefs.includes(productionPaidBillingLifecycleEvidence.billingRefundCreditWebhookEvidencePath),
      `${coverage.area} must cite both exact production billing evidence files`
    );
    assert.ok(
      coverage.evidenceRefs.some(
        (ref) =>
          auditIds.has(ref) ||
          supportTicketIds.has(ref) ||
          exportIds.has(ref) ||
          taskIds.has(ref) ||
          quotaUserIds.has(ref) ||
          ref.startsWith("production_")
      ),
      `${coverage.area} needs validator-resolvable audit, support, export, task, quota, or blocker refs`
    );

    if (coverage.area === "checkout_subscription_cancellation_past_due") {
      assert.ok(lifecycleFileAreas.has(coverage.area), `${coverage.area} must be present in billing lifecycle evidence`);
    } else {
      assert.ok(refundWebhookFileAreas.has(coverage.area), `${coverage.area} must be present in refund/webhook evidence`);
    }
  }
  assert.deepEqual([...requiredAreas], [], "production paid billing evidence is missing coverage areas");

  const billingCheck = gateFixture.checks.find((check) => check.check_id === "production_paid_billing_lifecycle");
  assert.ok(billingCheck, "production gate needs paid billing lifecycle check");
  assert.equal(billingCheck.status, "pass");
  assert.ok(billingCheck.evidence_ref.includes(productionPaidBillingLifecycleEvidence.billingLifecycleEvidencePath));
  assert.ok(billingCheck.evidence_ref.includes(productionPaidBillingLifecycleEvidence.billingRefundCreditWebhookEvidencePath));

  const billingCondition = gateFixture.do_not_launch_checks.find(
    (condition) => condition.condition_id === productionPaidBillingLifecycleEvidence.doNotLaunchConditionId
  );
  assert.ok(billingCondition, "production do-not-launch fixture needs billing condition");
  assert.equal(billingCondition.is_present, false, "billing condition should be cleared by runtime evidence");

  for (const blocker of productionPaidBillingLifecycleEvidence.gateImpact.remainingBlockers) {
    const check = gateFixture.checks.find((entry) => entry.check_id === blocker);
    assert.ok(check, `${blocker} must remain represented in the production gate fixture`);
    assert.equal(check.status, "blocked", `${blocker} must stay blocked after billing lifecycle clears`);
  }

  assert.deepEqual(gateFixture.gate_decision.blocked_by_checks, ["production_backup_rollback_incident"]);
  assert.equal(
    gateFixture.gate_decision.active_do_not_launch_conditions.includes("paid_billing_or_comp_only_mode_missing"),
    false,
    "billing condition should be removed from active do-not-launch conditions"
  );
});
