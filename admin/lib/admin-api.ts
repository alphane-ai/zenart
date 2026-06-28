import {
  adminReviewDecisions,
  adminRbacEvidence,
  adminRbacOverrideAttempts,
  abuseControlHooks,
  abuseEvents,
  alertRouteRuntimeEvidence,
  alertRoutes,
  analyticsReports,
  backendMetricsRuntimeEvidence,
  crawlerGovernanceWorkflows,
  crawlerStagingRuntimeEvidence,
  crawlerSourceApprovals,
  auditEvents,
  crawlerFindings,
  exportJobs,
  failedTaskControls,
  feedbackItems,
  incidentLogs,
  maintenanceBanners,
  operationalDashboardRuntimeEvidence,
  operationsIncidentRunbookContract,
  observabilityTelemetryRuntimeEvidence,
  metaPrompts,
  operationalDashboards,
  productionActivationReviewAuditEvidence,
  productionAbuseThrottleHoldEvidence,
  productionBackupRollbackIncidentEvidence,
  productionBackupRollbackSplitPreflightEvidence,
  productionLegalSupportPolicyEvidence,
  productionPaidBillingLifecycleEvidence,
  productionProviderModeEvidence,
  productionSecurityLaunchCheckEvidence,
  productionSkillReleaseEvalCanaryEvidence,
  stagingLegalSupportVisibilityEvidence,
  stagingObjectStorageRetentionCleanupEvidence,
  stagingObservabilityBackupLoadPreflightEvidence,
  stagingEvalQaSafetyEvidence,
  stagingQuotaRateLimitSpendCapEvidence,
  stage1BatchChildTasks,
  stage1BatchQueueRuntime,
  promptFragments,
  providerHealth,
  quotaAccounts,
  queueHealth,
  regressionFixtures,
  releaseEvidence,
  releaseBlockers,
  riskyExports,
  skillCanaryMetrics,
  skillReleaseStateDefinitions,
  skillVersions,
  skills,
  stagingAuthRbacTenantAuditEvidence,
  stagingSupportRetryAbuseEvidence,
  supportEscalationRunbooks,
  supportAdminDeletionGovernanceContract,
  supportTickets,
  supportUsers,
  traces
} from "@/lib/fixtures";
import type {
  AdminBillingOperation,
  AdminBillingOpsSource,
  AdminTeamMemberRemoveResult,
  EvalResult,
  ExportJob,
  ProviderRegistryEntry,
  ProviderRegistrySource,
  ProviderStrategyGroup,
  RiskLevel,
  RiskyExport,
  Skill,
  SkillVersion,
  Stage1BatchChildTask,
  Stage1BatchQueueRuntime,
  Stage1AggregateEvidence,
  Stage1AggregateGateCheck,
  Stage1AzureCliPreflight,
  Stage1AzureOriginDnsProbe,
  Stage1AzureOriginHttpProbe,
  Stage1AzureOriginReadiness,
  Stage1AzureOriginSshPreflight,
  Stage1AzureOriginTcpProbe,
  Stage1AzureTransportDiagnosis,
  Stage1EvidenceClosureQueue,
  Stage1EvidenceClosureQueueOperatorActionPacketItem,
  Stage1EvidenceClosureQueueOperatorActionPacketSummary,
  Stage1EvidenceClosureQueueParallelBlocker,
  Stage1EvidenceClosureQueueRow,
  Stage1ExternalResourceNonClearingRefreshSummary,
  Stage1ExternalResourceGroup,
  Stage1ExternalResourceHandoff,
  Stage1ExternalResourceReadiness,
  Stage1ProductionActionMatrix,
  Stage1ProductionBlockerAudit,
  Stage1ProductionBlockerChecklist,
  Stage1ProductionBlockerAuditSourceRow,
  Stage1ProductionDnsDetail,
  Stage1ProductionInputTemplate,
  Stage1ProductionLaunchInputPacket,
  Stage1ProductionLaunchOperatorBrief,
  Stage1ProductionMissingInputChecklist,
  Stage1NextBlockersSummary,
  Stage1ProductionLaunchSourcePipeline,
  Stage1ProductionSourceProbeRunbook,
  Stage1ProductionNonClearingRefresh,
  Stage1ProductionOperatorPacket,
  Stage1ProductionProofBundle,
  Stage1ProductionProofDiagnostic,
  Stage1ProductionProofDiagnostics,
  Stage1ProductionProofBundleRequirement,
  Stage1ProductionSourceProbeRequirement,
  Stage1MissingEvidenceRef,
  Stage1ReleaseReadinessComponent,
  Stage1ReleaseReadinessSnapshot,
  Team,
  TeamBillingLink,
  TeamBillingLinkSource,
  TeamInvite,
  TeamSeatUsage,
  TeamSeatBillingSync
} from "@/lib/types";
import { buildAbuseQueueRuntime, buildAbuseRuntimeDecisions } from "@/lib/abuse-runtime";
import {
  buildCrawlerGovernanceAdminActionContracts,
  buildCrawlerGovernanceClosureSummaries,
  buildCrawlerDerivativeReplayHardeningSummaries,
  buildCrawlerGovernanceRuntimeDecisions
} from "@/lib/crawler-runtime";
import { buildExportRegenerationRuntimeDecisions } from "@/lib/export-runtime";
import {
  buildFailedTaskRuntimeDecisions,
  buildFailedTaskSubmissionContracts
} from "@/lib/failed-task-runtime";
import { buildRegressionFixtureRuntimeSummaries } from "@/lib/regression-fixture-runtime";
import {
  buildAdminRbacClosureMatrix,
  buildAdminRbacEvidencePacks,
  buildAdminRbacOverrideAttemptDecisions,
  buildAdminRbacOverrideReleaseBundles,
  buildAdminRbacReleaseEvidenceMatrix,
  buildAdminRbacReleaseEvidenceClosures,
  buildAdminRbacReleaseReadinessSummaries,
  buildAdminRbacRuntimeDecisions,
  buildAdminRbacStaleReplayDecisions,
  buildAdminRbacSurfaceSummaries
} from "@/lib/rbac-runtime";
import { buildStagingObjectStorageRetentionCleanupEvidence } from "@/lib/object-storage-runtime";
import { cookies } from "next/headers";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const evidenceFileCandidates = {
  "ops/evidence/staging/object-storage-retention-cleanup.json": [
    "ops/evidence/staging/object-storage-retention-cleanup.json",
    "../ops/evidence/staging/object-storage-retention-cleanup.json"
  ],
  "ops/evidence/staging/object-storage-retention-cleanup.blocked.json": [
    "ops/evidence/staging/object-storage-retention-cleanup.blocked.json",
    "../ops/evidence/staging/object-storage-retention-cleanup.blocked.json"
  ],
  "ops/evidence/staging/stage1-runtime.json": [
    "ops/evidence/staging/stage1-runtime.json",
    "../ops/evidence/staging/stage1-runtime.json"
  ],
  "ops/evidence/staging/stage1-runtime.ndjson": [
    "ops/evidence/staging/stage1-runtime.ndjson",
    "../ops/evidence/staging/stage1-runtime.ndjson"
  ],
  "ops/evidence/staging/stage1-azure-origin-readiness.json": [
    "ops/evidence/staging/stage1-azure-origin-readiness.json",
    "../ops/evidence/staging/stage1-azure-origin-readiness.json"
  ],
  "ops/evidence/production/stage1-production-launch.json": [
    "ops/evidence/production/stage1-production-launch.json",
    "../ops/evidence/production/stage1-production-launch.json"
  ],
  "ops/evidence/production/stage1-production-launch.ndjson": [
    "ops/evidence/production/stage1-production-launch.ndjson",
    "../ops/evidence/production/stage1-production-launch.ndjson"
  ],
  "ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json": [
    "ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json",
    "../ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json"
  ],
  "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json": [
    "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json",
    "../ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json"
  ],
  "ops/evidence/non_clearing/production-blocker-audit.json": [
    "ops/evidence/non_clearing/production-blocker-audit.json",
    "../ops/evidence/non_clearing/production-blocker-audit.json"
  ],
  "ops/evidence/non_clearing/production-launch-operator-brief.json": [
    "ops/evidence/non_clearing/production-launch-operator-brief.json",
    "../ops/evidence/non_clearing/production-launch-operator-brief.json"
  ],
  "ops/evidence/non_clearing/production-missing-input-checklist.json": [
    "ops/evidence/non_clearing/production-missing-input-checklist.json",
    "../ops/evidence/non_clearing/production-missing-input-checklist.json"
  ],
  "ops/evidence/non_clearing/production-launch-input-packet.json": [
    "ops/evidence/non_clearing/production-launch-input-packet.json",
    "../ops/evidence/non_clearing/production-launch-input-packet.json"
  ],
  "ops/evidence/non_clearing/production-launch-source-pipeline.json": [
    "ops/evidence/non_clearing/production-launch-source-pipeline.json",
    "../ops/evidence/non_clearing/production-launch-source-pipeline.json"
  ],
  "ops/evidence/non_clearing/production-source-probe-runbook.json": [
    "ops/evidence/non_clearing/production-source-probe-runbook.json",
    "../ops/evidence/non_clearing/production-source-probe-runbook.json"
  ],
  "ops/evidence/non_clearing/production-non-clearing-refresh.json": [
    "ops/evidence/non_clearing/production-non-clearing-refresh.json",
    "../ops/evidence/non_clearing/production-non-clearing-refresh.json"
  ],
  "ops/evidence/non_clearing/production-proof-bundle.json": [
    "ops/evidence/non_clearing/production-proof-bundle.json",
    "../ops/evidence/non_clearing/production-proof-bundle.json"
  ],
  "ops/evidence/non_clearing/production-dns-readiness.json": [
    "ops/evidence/non_clearing/production-dns-readiness.json",
    "../ops/evidence/non_clearing/production-dns-readiness.json"
  ],
  "ops/evidence/non_clearing/production-dns-cutover-plan.json": [
    "ops/evidence/non_clearing/production-dns-cutover-plan.json",
    "../ops/evidence/non_clearing/production-dns-cutover-plan.json"
  ],
  "ops/evidence/non_clearing/production-dns-repair-packet.json": [
    "ops/evidence/non_clearing/production-dns-repair-packet.json",
    "../ops/evidence/non_clearing/production-dns-repair-packet.json"
  ],
  "ops/evidence/non_clearing/production-live-billing-proof.blocked.json": [
    "ops/evidence/non_clearing/production-live-billing-proof.blocked.json",
    "../ops/evidence/non_clearing/production-live-billing-proof.blocked.json"
  ],
  "ops/evidence/non_clearing/production-security-proof.blocked.json": [
    "ops/evidence/non_clearing/production-security-proof.blocked.json",
    "../ops/evidence/non_clearing/production-security-proof.blocked.json"
  ],
  "ops/evidence/non_clearing/production-governance-proof.blocked.json": [
    "ops/evidence/non_clearing/production-governance-proof.blocked.json",
    "../ops/evidence/non_clearing/production-governance-proof.blocked.json"
  ],
  "ops/evidence/non_clearing/production-billing-operator-packet.json": [
    "ops/evidence/non_clearing/production-billing-operator-packet.json",
    "../ops/evidence/non_clearing/production-billing-operator-packet.json"
  ],
  "ops/evidence/non_clearing/production-security-operator-packet.json": [
    "ops/evidence/non_clearing/production-security-operator-packet.json",
    "../ops/evidence/non_clearing/production-security-operator-packet.json"
  ],
  "ops/evidence/non_clearing/production-legal-support-operator-packet.json": [
    "ops/evidence/non_clearing/production-legal-support-operator-packet.json",
    "../ops/evidence/non_clearing/production-legal-support-operator-packet.json"
  ],
  "ops/evidence/non_clearing/production-governance-operator-packet.json": [
    "ops/evidence/non_clearing/production-governance-operator-packet.json",
    "../ops/evidence/non_clearing/production-governance-operator-packet.json"
  ],
  "ops/evidence/non_clearing/production-blocker-checklist.md": [
    "ops/evidence/non_clearing/production-blocker-checklist.md",
    "../ops/evidence/non_clearing/production-blocker-checklist.md"
  ],
  "ops/evidence/non_clearing/production-action-matrix.json": [
    "ops/evidence/non_clearing/production-action-matrix.json",
    "../ops/evidence/non_clearing/production-action-matrix.json"
  ],
  "ops/evidence/non_clearing/production-action-matrix.md": [
    "ops/evidence/non_clearing/production-action-matrix.md",
    "../ops/evidence/non_clearing/production-action-matrix.md"
  ],
  "ops/evidence/non_clearing/production-input-template.env": [
    "ops/evidence/non_clearing/production-input-template.env",
    "../ops/evidence/non_clearing/production-input-template.env"
  ],
  "ops/evidence/non_clearing/production-input-template.json": [
    "ops/evidence/non_clearing/production-input-template.json",
    "../ops/evidence/non_clearing/production-input-template.json"
  ],
  "ops/evidence/non_clearing/stage1-next-blockers-summary.json": [
    "ops/evidence/non_clearing/stage1-next-blockers-summary.json",
    "../ops/evidence/non_clearing/stage1-next-blockers-summary.json"
  ]
} as const;

type EvidenceFilePath = keyof typeof evidenceFileCandidates;

async function readJsonIfPresent<T>(evidencePath: EvidenceFilePath): Promise<T | null> {
  const candidates = evidenceFileCandidates[evidencePath];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(join(/* turbopackIgnore: true */ process.cwd(), candidate), "utf8")) as T;
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function readNdjsonIfPresent(evidencePath: EvidenceFilePath): Promise<Record<string, unknown>[] | null> {
  const candidates = evidenceFileCandidates[evidencePath];
  for (const candidate of candidates) {
    try {
      const text = await readFile(join(/* turbopackIgnore: true */ process.cwd(), candidate), "utf8");
      return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

async function readTextIfPresent(evidencePath: EvidenceFilePath): Promise<string | null> {
  const candidates = evidenceFileCandidates[evidencePath];
  for (const candidate of candidates) {
    try {
      return await readFile(join(/* turbopackIgnore: true */ process.cwd(), candidate), "utf8");
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }
  return null;
}

export async function getSkills(): Promise<Skill[]> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return skills.map((item) => ({ ...item, source: "fixture" as const }));
  }
  try {
    const headers = await adminAPIForwardHeaders();
    const response = await fetch(`${apiBaseURL}/api/admin/v1/skills?page_size=100`, {
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      return skills.map((item) => ({ ...item, source: "fixture" as const }));
    }
    const page = (await response.json()) as SkillPageAPI;
    const items = Array.isArray(page.items) ? page.items.map(mapSkillAPI) : [];
    return items.length > 0 ? items : skills.map((item) => ({ ...item, source: "fixture" as const }));
  } catch {
    return skills.map((item) => ({ ...item, source: "fixture" as const }));
  }
}

export async function getSkillVersions(): Promise<SkillVersion[]> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return skillVersions.map((item) => ({ ...item, source: "fixture" as const }));
  }
  try {
    const headers = await adminAPIForwardHeaders();
    const skillPageResponse = await fetch(`${apiBaseURL}/api/admin/v1/skills?page_size=100`, {
      cache: "no-store",
      headers
    });
    if (!skillPageResponse.ok) {
      return skillVersions.map((item) => ({ ...item, source: "fixture" as const }));
    }
    const skillPage = (await skillPageResponse.json()) as SkillPageAPI;
    const apiSkills = Array.isArray(skillPage.items) ? skillPage.items : [];
    const pages = await Promise.all(
      apiSkills.map(async (skill) => {
        const response = await fetch(`${apiBaseURL}/api/admin/v1/skills/${encodeURIComponent(skill.id)}/versions?page_size=100`, {
          cache: "no-store",
          headers
        });
        if (!response.ok) {
          return [] as SkillVersionAPI[];
        }
        const page = (await response.json()) as SkillVersionPageAPI;
        return Array.isArray(page.items) ? page.items : [];
      })
    );
    const versions = pages.flat().map(mapSkillVersionAPI);
    return versions.length > 0 ? versions : skillVersions.map((item) => ({ ...item, source: "fixture" as const }));
  } catch {
    return skillVersions.map((item) => ({ ...item, source: "fixture" as const }));
  }
}

export async function getEvalResults(): Promise<EvalResult[]> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return evalResultFixtures();
  }
  try {
    const headers = await adminAPIForwardHeaders();
    const response = await fetch(`${apiBaseURL}/api/admin/v1/eval/results?page_size=100&latest_only=true`, {
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      return evalResultFixtures();
    }
    const page = (await response.json()) as EvalResultPageAPI;
    const results = Array.isArray(page.items) ? page.items.map(mapEvalResultAPI) : [];
    return results.length > 0 ? results : evalResultFixtures();
  } catch {
    return evalResultFixtures();
  }
}

export async function getSkillReleaseStateDefinitions() {
  return skillReleaseStateDefinitions;
}

export async function getSkillCanaryMetrics() {
  return skillCanaryMetrics;
}

export async function getAdminReviewDecisions() {
  return adminReviewDecisions;
}

export async function getAdminRbacEvidence() {
  return adminRbacEvidence;
}

export async function getAdminRbacOverrideAttempts() {
  return adminRbacOverrideAttempts;
}

export async function getAdminRbacRuntimeDecisions() {
  return buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
}

export async function getAdminRbacOverrideAttemptDecisions() {
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  return buildAdminRbacOverrideAttemptDecisions(adminRbacOverrideAttempts, runtimeDecisions);
}

export async function getAdminRbacStaleReplayDecisions() {
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  return buildAdminRbacStaleReplayDecisions(adminRbacEvidence, runtimeDecisions, new Date("2026-05-26T19:00:00Z"));
}

export async function getAdminRbacSurfaceSummaries() {
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  return buildAdminRbacSurfaceSummaries(adminRbacEvidence, runtimeDecisions);
}

export async function getAdminRbacEvidencePacks() {
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const staleReplayDecisions = buildAdminRbacStaleReplayDecisions(
    adminRbacEvidence,
    runtimeDecisions,
    new Date("2026-05-26T19:00:00Z")
  );
  return buildAdminRbacEvidencePacks(adminRbacEvidence, runtimeDecisions, staleReplayDecisions);
}

export async function getAdminRbacClosureMatrix() {
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const staleReplayDecisions = buildAdminRbacStaleReplayDecisions(
    adminRbacEvidence,
    runtimeDecisions,
    new Date("2026-05-26T19:00:00Z")
  );
  const evidencePacks = buildAdminRbacEvidencePacks(adminRbacEvidence, runtimeDecisions, staleReplayDecisions);

  return buildAdminRbacClosureMatrix(evidencePacks, runtimeDecisions);
}

export async function getAdminRbacReleaseEvidenceClosures() {
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const attemptDecisions = buildAdminRbacOverrideAttemptDecisions(adminRbacOverrideAttempts, runtimeDecisions);
  const staleReplayDecisions = buildAdminRbacStaleReplayDecisions(
    adminRbacEvidence,
    runtimeDecisions,
    new Date("2026-05-26T19:00:00Z")
  );
  const evidencePacks = buildAdminRbacEvidencePacks(adminRbacEvidence, runtimeDecisions, staleReplayDecisions);

  return buildAdminRbacReleaseEvidenceClosures(evidencePacks, attemptDecisions, staleReplayDecisions);
}

export async function getAdminRbacReleaseReadinessSummaries() {
  const runtimeDecisions = buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
  const attemptDecisions = buildAdminRbacOverrideAttemptDecisions(adminRbacOverrideAttempts, runtimeDecisions);
  const staleReplayDecisions = buildAdminRbacStaleReplayDecisions(
    adminRbacEvidence,
    runtimeDecisions,
    new Date("2026-05-26T19:00:00Z")
  );
  const evidencePacks = buildAdminRbacEvidencePacks(adminRbacEvidence, runtimeDecisions, staleReplayDecisions);
  const closures = buildAdminRbacReleaseEvidenceClosures(evidencePacks, attemptDecisions, staleReplayDecisions);

  return buildAdminRbacReleaseReadinessSummaries(closures, evidencePacks);
}

export async function getAdminRbacOverrideReleaseBundles() {
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

  return buildAdminRbacOverrideReleaseBundles(readinessSummaries, closures, runtimeDecisions);
}

export async function getAdminRbacReleaseEvidenceMatrix() {
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

  return buildAdminRbacReleaseEvidenceMatrix(
    adminRbacEvidence,
    adminRbacOverrideAttempts,
    attemptDecisions,
    runtimeDecisions,
    closures,
    bundles
  );
}

export async function getCrawlerFindings() {
  return crawlerFindings;
}

export async function getCrawlerSourceApprovals() {
  return crawlerSourceApprovals;
}

export async function getCrawlerGovernanceWorkflows() {
  return crawlerGovernanceWorkflows;
}

export async function getCrawlerGovernanceRuntimeDecisions() {
  return buildCrawlerGovernanceRuntimeDecisions(crawlerGovernanceWorkflows, new Date("2026-05-26T18:30:00Z"));
}

export async function getCrawlerGovernanceClosureSummaries() {
  return buildCrawlerGovernanceClosureSummaries(
    buildCrawlerGovernanceRuntimeDecisions(crawlerGovernanceWorkflows, new Date("2026-05-26T18:30:00Z"))
  );
}

export async function getCrawlerGovernanceAdminActionContracts() {
  const decisions = buildCrawlerGovernanceRuntimeDecisions(crawlerGovernanceWorkflows, new Date("2026-05-26T18:30:00Z"));

  return buildCrawlerGovernanceAdminActionContracts(
    crawlerGovernanceWorkflows,
    decisions,
    regressionFixtures.map((fixture) => fixture.fixturePath)
  );
}

export async function getCrawlerDerivativeReplayHardeningSummaries() {
  return buildCrawlerDerivativeReplayHardeningSummaries(
    crawlerGovernanceWorkflows,
    regressionFixtures.map((fixture) => fixture.fixturePath)
  );
}

export async function getCrawlerStagingRuntimeEvidence() {
  return crawlerStagingRuntimeEvidence;
}

export async function getPromptFragments() {
  return promptFragments;
}

export async function getMetaPrompts() {
  return metaPrompts;
}

export async function getTraces() {
  return traces;
}

export async function getTrace(id: string) {
  return traces.find((trace) => trace.id === id) ?? traces[0];
}

export async function getFeedbackItems() {
  return feedbackItems;
}

export async function getRegressionFixtures() {
  return regressionFixtures;
}

export async function getRegressionFixtureRuntimeSummaries() {
  return buildRegressionFixtureRuntimeSummaries({
    fixtures: regressionFixtures,
    feedbackItems,
    supportTickets,
    exportJobs,
    failedTaskControls,
    skillCanaryMetrics,
    auditEvents
  });
}

export async function getProviderHealth() {
  return providerHealth;
}

type ProviderRegistryPage = {
  items: ProviderRegistryEntry[];
  total_count?: number;
  next_page_token?: string;
};

type ProviderStrategyGroupPage = {
  items: ProviderStrategyGroup[];
  total_count?: number;
  next_page_token?: string;
};

type SkillAPI = {
  id: string;
  tenant_id?: string | null;
  name: string;
  domain: string;
  owner: string;
  risk_level: RiskLevel;
  status: string;
  active_version?: string;
  updated_at?: string;
};

type SkillPageAPI = {
  items: SkillAPI[];
};

type SkillVersionAPI = {
  id: string;
  skill_id: string;
  version: string;
  status: SkillVersion["status"];
  eval_suite_id?: string | null;
  release_gate?: {
    requires_eval_pass: boolean;
    eligible_for_canary: boolean;
    eligible_for_active: boolean;
    blocking_reason: string;
    last_eval_result_id?: string | null;
    last_eval_status?: "pass" | "fail" | "blocked" | null;
    eval_contract_complete: boolean;
    critical_safety_regressions: number;
  };
  release_notes?: string;
  rollback_target_version_id?: string | null;
  created_at?: string;
};

type SkillVersionPageAPI = {
  items: SkillVersionAPI[];
};

type EvalResultAPI = {
  result_id: string;
  suite_id: string;
  subject: {
    subject_type: string;
    subject_id: string;
    version: string;
    candidate_status_after_eval: EvalResult["candidateStatusAfterEval"];
  };
  status: EvalResult["status"];
  completed_at: string;
  created_at: string;
  summary?: {
    total_fixtures?: number;
    passed_fixtures?: number;
    failed_fixtures?: number;
    blocked_fixtures?: number;
    critical_safety_regressions?: number;
    regression_pass_rate?: number;
    trace_complete?: boolean;
    export_contract_complete?: boolean;
    qa_fixture_coverage_complete?: boolean;
  };
  fixture_results?: unknown[];
  runner_contract?: {
    runner_sha256?: string;
  };
  storage_contract?: {
    table?: string;
  };
};

type EvalResultPageAPI = {
  items: EvalResultAPI[];
};

type TeamSeatBillingSyncPage = {
  items: TeamSeatBillingSync[];
};

type AdminBatchQueueRuntimeAPI = {
  id: string;
  batch_id: string;
  tenant_id: string;
  project_id: string;
  workspace_id: string;
  status: Stage1BatchQueueRuntime["status"];
  requested_count: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  blocked: number;
  retryable: number;
  worker_id: string;
  claim_timeout_seconds: number;
  oldest_child_age_minutes: number;
  provider_id: string;
  model_id: string;
  tool_type: string;
  provider_strategy_group_id: string;
  provider_selection_policy: Stage1BatchQueueRuntime["providerSelectionPolicy"];
  provider_concurrency: string;
  provider_model_concurrency: string;
  claim_lease_policy: string;
  drain_policy: string;
  quota_policy: string;
  dead_letter_policy: string;
  idempotency_scope: string;
  next_operator_action: string;
  audit_ref: string;
  evidence_refs: string[];
};

type AdminBatchQueueRuntimePage = {
  items: AdminBatchQueueRuntimeAPI[];
};

const PRODUCTION_MISSING_INPUT_DISALLOWED_SUBSTITUTES = [
  "local_debug_evidence",
  "staging_preflight_evidence",
  "blocked_probe_evidence",
  "placeholder_values",
  "stripe_sandbox_test_mode",
  "stripe_test_keys"
];

const PRODUCTION_MISSING_INPUT_ACCEPTABLE_EVIDENCE_SOURCE_FALLBACKS: Record<string, string> = {
  production_dns: "production_https_dns_or_cloudflare_cutover_evidence",
  billing: "live_stripe_production_billing_evidence",
  security: "production_https_runtime_security_evidence",
  governance: "production_governance_audit_release_evidence"
};

type AdminBatchChildTaskAPI = {
  id: string;
  batch_id: string;
  tenant_id: string;
  status: Stage1BatchChildTask["status"];
  provider_id: string;
  model_id: string;
  tool_type: string;
  retry_count: number;
  max_retries: number;
  worker_id: string;
  claim_attempt: number;
  claim_expires_at: string;
  fanout_stage: string;
  failure_code: string;
  review_reason: string;
  quota_estimate_units: number;
  quota_committed_units: number;
  quota_refunded_units: number;
  retry_state: Stage1BatchChildTask["retryState"];
  dead_letter_state: Stage1BatchChildTask["deadLetterState"];
  result_asset_id: string;
  canvas_object_id: string;
  visible_trace_ref: string;
  provider_usage_ref: string;
  idempotency_key: string;
  operator_action: string;
  audit_ref: string;
  evidence_refs: string[];
};

type AdminBatchChildTaskPage = {
  items: AdminBatchChildTaskAPI[];
};

type SafetyReviewAPI = {
  id: string;
  safety_decision_id: string;
  subject_type: string;
  subject_id: string;
  enforcement_point: RiskyExport["enforcementPoint"];
  safety_decision: RiskyExport["action"];
  safety_rationale: string;
  rule_id?: string | null;
  rule_key?: string;
  rule_version?: string;
  severity: RiskyExport["severity"];
  override_eligible: boolean;
  audit_required: boolean;
  review_status: NonNullable<RiskyExport["reviewStatus"]>;
  reviewer_id?: string;
  review_rationale?: string;
  audit_ref?: string;
  required_evidence_refs?: string[];
  user_visible_outcome?: string;
};

type SafetyReviewPage = {
  items: SafetyReviewAPI[];
};

type ExportAPI = {
  id: string;
  tenant_id?: string;
  package_id: string;
  project_id?: string | null;
  task_id?: string | null;
  format: string;
  status: string;
  qa_status: string;
  object_metadata_id?: string | null;
  object_metadata?: {
    id?: string;
    retention_until?: string | null;
  } | null;
  manifest?: Record<string, unknown>;
  qa_report?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
  trace_id?: string | null;
  final_export_allowed?: boolean;
  download_enabled?: boolean;
  denial_reasons?: string[];
  audit_event_required?: boolean;
  download_url?: string | null;
  download_expires_at?: string | null;
  delivery?: {
    retention_until?: string | null;
    download_expires_at?: string | null;
    signed_url_expires_at?: string | null;
    [key: string]: unknown;
  };
  error?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  regenerated_at?: string | null;
};

type ExportPage = {
  items: ExportAPI[];
};

export type TeamSeatOpsPanel = {
  teamID: string;
  usage: TeamSeatUsage | null;
  link: TeamBillingLink | null;
  syncs: TeamSeatBillingSync[];
  recentTeam?: Team;
  recentInvite?: TeamInvite;
  recentRemoval?: AdminTeamMemberRemoveResult;
  source: TeamBillingLinkSource;
  error?: string;
};

export type AdminBillingOpsPanel = {
  operations: AdminBillingOperation[];
  source: AdminBillingOpsSource;
  apiAvailable: boolean;
  error?: string;
};

export async function getProviderRegistry(): Promise<{
  items: ProviderRegistryEntry[];
  source: ProviderRegistrySource;
  error?: string;
}> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return {
      items: providerRegistryFixture(),
      source: "fixture"
    };
  }

  try {
    const headers = await adminAPIForwardHeaders();
    const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/registry?page_size=100`, {
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      return {
        items: providerRegistryFixture(),
        source: "fixture",
        error: `provider registry API returned ${response.status}`
      };
    }
    const page = (await response.json()) as ProviderRegistryPage;
    return {
      items: Array.isArray(page.items) ? page.items : [],
      source: "api"
    };
  } catch (error) {
    return {
      items: providerRegistryFixture(),
      source: "fixture",
      error: error instanceof Error ? error.message : "provider registry API unavailable"
    };
  }
}

export async function getProviderStrategyGroups(): Promise<{
  items: ProviderStrategyGroup[];
  source: ProviderRegistrySource;
  error?: string;
}> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return {
      items: providerStrategyGroupFixture(),
      source: "fixture"
    };
  }

  try {
    const headers = await adminAPIForwardHeaders();
    const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/strategy-groups?page_size=100`, {
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      return {
        items: providerStrategyGroupFixture(),
        source: "fixture",
        error: `provider strategy groups API returned ${response.status}`
      };
    }
    const page = (await response.json()) as ProviderStrategyGroupPage;
    return {
      items: Array.isArray(page.items) ? page.items : [],
      source: "api"
    };
  } catch (error) {
    return {
      items: providerStrategyGroupFixture(),
      source: "fixture",
      error: error instanceof Error ? error.message : "provider strategy groups API unavailable"
    };
  }
}

export async function getTeamBillingLinkPanel(teamID = "team_1"): Promise<{
  teamID: string;
  link: TeamBillingLink | null;
  syncs: TeamSeatBillingSync[];
  source: TeamBillingLinkSource;
  error?: string;
}> {
  const panel = await getTeamSeatOpsPanel(teamID);
  return {
    teamID: panel.teamID,
    link: panel.link,
    syncs: panel.syncs,
    source: panel.source,
    error: panel.error
  };
}

export async function getAdminBillingOpsPanel(): Promise<AdminBillingOpsPanel> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  return {
    operations: adminBillingOperationFixtures(),
    source: "fixture",
    apiAvailable: Boolean(apiBaseURL),
    error: apiBaseURL
      ? undefined
      : "Admin billing operation mutations require ADMIN_API_BASE_URL or NEXT_PUBLIC_ADMIN_API_BASE_URL."
  };
}

export async function getTeamSeatOpsPanel(teamID = "team_1"): Promise<TeamSeatOpsPanel> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return {
      teamID,
      usage: teamSeatUsageFixture(teamID),
      link: teamBillingLinkFixture(teamID),
      syncs: teamSeatBillingSyncFixtures(teamID),
      recentTeam: teamFixture(teamID),
      recentInvite: teamInviteFixture(teamID),
      recentRemoval: teamMemberRemoveFixture(teamID),
      source: "fixture"
    };
  }

  try {
    const headers = await adminAPIForwardHeaders();
    const [usageResponse, linkResponse, syncResponse] = await Promise.all([
      fetch(`${apiBaseURL}/api/admin/v1/team-seat-ops/${encodeURIComponent(teamID)}/seat-usage`, {
        cache: "no-store",
        headers
      }),
      fetch(`${apiBaseURL}/api/admin/v1/team-seat-ops/${encodeURIComponent(teamID)}/billing-link`, {
        cache: "no-store",
        headers
      }),
      fetch(`${apiBaseURL}/api/admin/v1/team-seat-ops/${encodeURIComponent(teamID)}/seat-syncs?page_size=20`, {
        cache: "no-store",
        headers
      })
    ]);
    const usageMissing = usageResponse.status === 404;
    const linkMissing = linkResponse.status === 404;
    if (!usageResponse.ok && !usageMissing) {
      return {
        teamID,
        usage: teamSeatUsageFixture(teamID),
        link: teamBillingLinkFixture(teamID),
        syncs: teamSeatBillingSyncFixtures(teamID),
        recentTeam: teamFixture(teamID),
        recentInvite: teamInviteFixture(teamID),
        recentRemoval: teamMemberRemoveFixture(teamID),
        source: "fixture",
        error: `team seat usage API returned ${usageResponse.status}`
      };
    }
    if (!linkResponse.ok && !linkMissing) {
      return {
        teamID,
        usage: usageMissing ? null : ((await usageResponse.json()) as TeamSeatUsage),
        link: teamBillingLinkFixture(teamID),
        syncs: teamSeatBillingSyncFixtures(teamID),
        recentTeam: teamFixture(teamID),
        recentInvite: teamInviteFixture(teamID),
        recentRemoval: teamMemberRemoveFixture(teamID),
        source: "fixture",
        error: `team billing API returned ${linkResponse.status}`
      };
    }
    const usage = usageMissing ? null : ((await usageResponse.json()) as TeamSeatUsage);
    const link = linkMissing ? null : ((await linkResponse.json()) as TeamBillingLink);
    const page = syncResponse.ok ? ((await syncResponse.json()) as TeamSeatBillingSyncPage) : { items: [] };
    const errors = [
      usageMissing ? "team seat usage is not available yet" : "",
      linkMissing ? "team billing link is not bound yet" : "",
      syncResponse.ok ? "" : `team seat sync API returned ${syncResponse.status}`
    ].filter(Boolean);
    return {
      teamID,
      usage,
      link,
      syncs: Array.isArray(page.items) ? page.items : [],
      source: "api",
      error: errors.length > 0 ? errors.join("; ") : undefined
    };
  } catch (error) {
    return {
      teamID,
      usage: teamSeatUsageFixture(teamID),
      link: teamBillingLinkFixture(teamID),
      syncs: teamSeatBillingSyncFixtures(teamID),
      recentTeam: teamFixture(teamID),
      recentInvite: teamInviteFixture(teamID),
      recentRemoval: teamMemberRemoveFixture(teamID),
      source: "fixture",
      error: error instanceof Error ? error.message : "team billing API unavailable"
    };
  }
}

export async function getReleaseEvidence() {
  return releaseEvidence;
}

export async function getQueueHealth() {
  return queueHealth;
}

export async function getStage1BatchQueueRuntime(): Promise<Stage1BatchQueueRuntime[]> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return stage1BatchQueueRuntime;
  }

  try {
    const headers = await adminAPIForwardHeaders();
    const response = await fetch(`${apiBaseURL}/api/admin/v1/batch-generations/queue-runtime?page_size=50`, {
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      return stage1BatchQueueRuntime;
    }
    const page = (await response.json()) as AdminBatchQueueRuntimePage;
    return Array.isArray(page.items) ? page.items.map(mapAdminBatchQueueRuntime) : stage1BatchQueueRuntime;
  } catch {
    return stage1BatchQueueRuntime;
  }
}

export async function getStage1BatchChildTasks(): Promise<Stage1BatchChildTask[]> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return stage1BatchChildTasks;
  }

  try {
    const headers = await adminAPIForwardHeaders();
    const response = await fetch(`${apiBaseURL}/api/admin/v1/batch-generation-children?page_size=50`, {
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      return stage1BatchChildTasks;
    }
    const page = (await response.json()) as AdminBatchChildTaskPage;
    return Array.isArray(page.items) ? page.items.map(mapAdminBatchChildTask) : stage1BatchChildTasks;
  } catch {
    return stage1BatchChildTasks;
  }
}

export async function getExportJobs(): Promise<ExportJob[]> {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return exportJobFixtures();
  }

  try {
    const headers = await adminAPIForwardHeaders();
    const response = await fetch(`${apiBaseURL}/api/admin/v1/exports?page_size=100`, {
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      return exportJobFixtures();
    }
    const page = (await response.json()) as ExportPage;
    const items = Array.isArray(page.items) ? page.items.map(mapExportToJob) : [];
    return items.length > 0 ? items : exportJobFixtures();
  } catch {
    return exportJobFixtures();
  }
}

export async function getFailedTaskControls() {
  return failedTaskControls;
}

export async function getFailedTaskRuntimeDecisions() {
  return buildFailedTaskRuntimeDecisions(
    failedTaskControls,
    supportTickets,
    regressionFixtures.map((fixture) => fixture.fixturePath),
    abuseControlHooks
  );
}

export async function getFailedTaskSubmissionContracts() {
  return buildFailedTaskSubmissionContracts(
    failedTaskControls,
    buildFailedTaskRuntimeDecisions(
      failedTaskControls,
      supportTickets,
      regressionFixtures.map((fixture) => fixture.fixturePath),
      abuseControlHooks
    )
  );
}

export async function getStagingSupportRetryAbuseEvidence() {
  return stagingSupportRetryAbuseEvidence;
}

export async function getStagingLegalSupportVisibilityEvidence() {
  return stagingLegalSupportVisibilityEvidence;
}

export async function getStagingAuthRbacTenantAuditEvidence() {
  return stagingAuthRbacTenantAuditEvidence;
}

export async function getStagingEvalQaSafetyEvidence() {
  return stagingEvalQaSafetyEvidence;
}

export async function getStagingQuotaRateLimitSpendCapEvidence() {
  return stagingQuotaRateLimitSpendCapEvidence;
}

export async function getProductionAbuseThrottleHoldEvidence() {
  return productionAbuseThrottleHoldEvidence;
}

export async function getProductionProviderModeEvidence() {
  return productionProviderModeEvidence;
}

export async function getProductionPaidBillingLifecycleEvidence() {
  return productionPaidBillingLifecycleEvidence;
}

export async function getProductionActivationReviewAuditEvidence() {
  return productionActivationReviewAuditEvidence;
}

export async function getProductionSkillReleaseEvalCanaryEvidence() {
  return productionSkillReleaseEvalCanaryEvidence;
}

export async function getProductionSecurityLaunchCheckEvidence() {
  return productionSecurityLaunchCheckEvidence;
}

export async function getProductionBackupRollbackIncidentEvidence() {
  return productionBackupRollbackIncidentEvidence;
}

export async function getProductionBackupRollbackSplitPreflightEvidence() {
  return productionBackupRollbackSplitPreflightEvidence;
}

export async function getProductionLegalSupportPolicyEvidence() {
  return productionLegalSupportPolicyEvidence;
}

export async function getExportJob(id: string) {
  const jobs = await getExportJobs();
  return jobs.find((job) => job.id === id) ?? jobs[0] ?? exportJobFixtures()[0];
}

export async function getExportRegenerationRuntimeDecisions() {
  return buildExportRegenerationRuntimeDecisions(await getExportJobs());
}

export async function getExportRegenerationRuntimeDecision(id: string) {
  const decisions = await getExportRegenerationRuntimeDecisions();
  return decisions.find((decision) => decision.exportId === id) ?? decisions[0];
}

export async function getSupportUsers() {
  return supportUsers;
}

export async function getSupportTickets() {
  return supportTickets;
}

export async function getSupportEscalationRunbooks() {
  return supportEscalationRunbooks;
}

export async function getSupportAdminDeletionGovernanceContract() {
  return supportAdminDeletionGovernanceContract;
}

export async function getQuotaAccounts() {
  return quotaAccounts;
}

export async function getRiskyExports() {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    return riskyExports.map((item) => ({ ...item, source: "fixture" as const }));
  }

  try {
    const headers = await adminAPIForwardHeaders();
    const response = await fetch(`${apiBaseURL}/api/admin/v1/safety/reviews?status=pending&page_size=100`, {
      cache: "no-store",
      headers
    });
    if (!response.ok) {
      return riskyExports.map((item) => ({ ...item, source: "fixture" as const }));
    }
    const page = (await response.json()) as SafetyReviewPage;
    const items = Array.isArray(page.items) ? page.items.map(mapSafetyReviewToRiskyExport) : [];
    return items.length > 0 ? items : riskyExports.map((item) => ({ ...item, source: "fixture" as const }));
  } catch {
    return riskyExports.map((item) => ({ ...item, source: "fixture" as const }));
  }
}

export async function getAbuseEvents() {
  return abuseEvents;
}

export async function getAbuseControlHooks() {
  return abuseControlHooks;
}

export async function getAbuseRuntimeDecisions() {
  return buildAbuseRuntimeDecisions(abuseEvents, abuseControlHooks, new Date("2026-05-26T11:00:00Z"));
}

export async function getAbuseQueueRuntime() {
  const decisions = await getAbuseRuntimeDecisions();
  return buildAbuseQueueRuntime(abuseEvents, decisions);
}

export async function getAuditEvents() {
  return auditEvents;
}

export async function getIncidentLogs() {
  return incidentLogs;
}

export async function getMaintenanceBanners() {
  return maintenanceBanners;
}

export async function getOperationalDashboards() {
  return operationalDashboards;
}

export async function getOperationalDashboardRuntimeEvidence() {
  return operationalDashboardRuntimeEvidence;
}

export async function getOperationsIncidentRunbookContract() {
  return operationsIncidentRunbookContract;
}

export async function getAlertRoutes() {
  return alertRoutes;
}

export async function getAlertRouteRuntimeEvidence() {
  return alertRouteRuntimeEvidence;
}

export async function getBackendMetricsRuntimeEvidence() {
  return backendMetricsRuntimeEvidence;
}

export async function getObservabilityTelemetryRuntimeEvidence() {
  return observabilityTelemetryRuntimeEvidence;
}

export async function getStagingObservabilityBackupLoadPreflightEvidence() {
  return stagingObservabilityBackupLoadPreflightEvidence;
}

export async function getStagingObjectStorageRetentionCleanupEvidence() {
  const passingReport = await readJsonIfPresent<Record<string, unknown>>(
    "ops/evidence/staging/object-storage-retention-cleanup.json"
  );
  const blockedReport = await readJsonIfPresent<Record<string, unknown>>(
    "ops/evidence/staging/object-storage-retention-cleanup.blocked.json"
  );
  const report = passingReport ?? blockedReport;

  return buildStagingObjectStorageRetentionCleanupEvidence(stagingObjectStorageRetentionCleanupEvidence, report);
}

export async function getReleaseBlockers() {
  return releaseBlockers;
}

export async function getStage1ReleaseReadiness(): Promise<Stage1ReleaseReadinessSnapshot> {
  const [
    stagingEvidence,
    stagingResults,
    productionEvidence,
    productionResults,
    closureQueueEvidence,
    resourceReadinessEvidence,
    azureOriginReadinessEvidence,
    productionBlockerAuditEvidence,
    productionLaunchOperatorBriefEvidence,
    productionMissingInputChecklistEvidence,
    productionLaunchInputPacketEvidence,
    productionLaunchSourcePipelineEvidence,
    productionSourceProbeRunbookEvidence,
    productionNonClearingRefreshEvidence,
    productionProofBundleEvidence,
    productionDnsReadinessEvidence,
    productionDnsCutoverPlanEvidence,
    productionDnsRepairPacketEvidence,
    productionBillingProofBlockedEvidence,
    productionSecurityProofBlockedEvidence,
    productionGovernanceProofBlockedEvidence,
    productionBillingOperatorPacketEvidence,
    productionSecurityOperatorPacketEvidence,
    productionLegalSupportOperatorPacketEvidence,
    productionGovernanceOperatorPacketEvidence,
    productionBlockerChecklistMarkdown,
    productionActionMatrixEvidence,
    productionActionMatrixMarkdown,
    productionInputTemplateText,
    productionInputTemplateEvidence,
    nextBlockersSummaryEvidence
  ] = await Promise.all([
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/staging/stage1-runtime.json"),
    readNdjsonIfPresent("ops/evidence/staging/stage1-runtime.ndjson"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/production/stage1-production-launch.json"),
    readNdjsonIfPresent("ops/evidence/production/stage1-production-launch.ndjson"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/staging/stage1-azure-origin-readiness.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-blocker-audit.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-launch-operator-brief.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-missing-input-checklist.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-launch-input-packet.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-launch-source-pipeline.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-source-probe-runbook.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-non-clearing-refresh.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-proof-bundle.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-dns-readiness.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-dns-cutover-plan.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-dns-repair-packet.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-live-billing-proof.blocked.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-security-proof.blocked.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-governance-proof.blocked.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-billing-operator-packet.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-security-operator-packet.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-legal-support-operator-packet.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-governance-operator-packet.json"),
    readTextIfPresent("ops/evidence/non_clearing/production-blocker-checklist.md"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-action-matrix.json"),
    readTextIfPresent("ops/evidence/non_clearing/production-action-matrix.md"),
    readTextIfPresent("ops/evidence/non_clearing/production-input-template.env"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/production-input-template.json"),
    readJsonIfPresent<Record<string, unknown>>("ops/evidence/non_clearing/stage1-next-blockers-summary.json")
  ]);
  const staging = mapStage1AggregateEvidence(
    stagingEvidence,
    stagingResults,
    "ops/evidence/staging/stage1-runtime.json",
    "ops/evidence/staging/stage1-runtime.ndjson",
    "staging"
  );
  const production = mapStage1AggregateEvidence(
    productionEvidence,
    productionResults,
    "ops/evidence/production/stage1-production-launch.json",
    "ops/evidence/production/stage1-production-launch.ndjson",
    "production"
  );
  const resourceReadiness = mapStage1ExternalResourceReadiness(
    resourceReadinessEvidence,
    "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json"
  );
  const azureOriginReadiness = mapStage1AzureOriginReadiness(
    azureOriginReadinessEvidence,
    "ops/evidence/staging/stage1-azure-origin-readiness.json"
  );
  const closureQueue = mapStage1EvidenceClosureQueue(
    closureQueueEvidence,
    "ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json"
  );
  const productionBlockerAudit = mapStage1ProductionBlockerAudit(
    productionBlockerAuditEvidence,
    "ops/evidence/non_clearing/production-blocker-audit.json"
  );
  const productionLaunchOperatorBrief = mapStage1ProductionLaunchOperatorBrief(
    productionLaunchOperatorBriefEvidence,
    "ops/evidence/non_clearing/production-launch-operator-brief.json"
  );
  const productionMissingInputChecklist = mapStage1ProductionMissingInputChecklist(
    productionMissingInputChecklistEvidence,
    "ops/evidence/non_clearing/production-missing-input-checklist.json"
  );
  const productionLaunchInputPacket = mapStage1ProductionLaunchInputPacket(
    productionLaunchInputPacketEvidence,
    "ops/evidence/non_clearing/production-launch-input-packet.json"
  );
  const productionLaunchSourcePipeline = mapStage1ProductionLaunchSourcePipeline(
    productionLaunchSourcePipelineEvidence,
    "ops/evidence/non_clearing/production-launch-source-pipeline.json"
  );
  const productionSourceProbeRunbook = mapStage1ProductionSourceProbeRunbook(
    productionSourceProbeRunbookEvidence,
    "ops/evidence/non_clearing/production-source-probe-runbook.json"
  );
  const productionNonClearingRefresh = mapStage1ProductionNonClearingRefresh(
    productionNonClearingRefreshEvidence,
    "ops/evidence/non_clearing/production-non-clearing-refresh.json"
  );
  const productionProofBundle = mapStage1ProductionProofBundle(
    productionProofBundleEvidence,
    "ops/evidence/non_clearing/production-proof-bundle.json"
  );
  const productionDnsDetail = mapStage1ProductionDnsDetail(
    productionDnsReadinessEvidence,
    productionDnsCutoverPlanEvidence,
    productionDnsRepairPacketEvidence,
    "ops/evidence/non_clearing/production-dns-readiness.json",
    "ops/evidence/non_clearing/production-dns-cutover-plan.json",
    "ops/evidence/non_clearing/production-dns-repair-packet.json"
  );
  const productionProofDiagnostics = mapStage1ProductionProofDiagnostics([
    {
      proofId: "billing",
      sourcePath: "ops/evidence/non_clearing/production-live-billing-proof.blocked.json",
      data: productionBillingProofBlockedEvidence
    },
    {
      proofId: "security",
      sourcePath: "ops/evidence/non_clearing/production-security-proof.blocked.json",
      data: productionSecurityProofBlockedEvidence
    },
    {
      proofId: "governance",
      sourcePath: "ops/evidence/non_clearing/production-governance-proof.blocked.json",
      data: productionGovernanceProofBlockedEvidence
    }
  ]);
  const productionOperatorPackets = [
    mapStage1ProductionOperatorPacket(
      productionBillingOperatorPacketEvidence,
      "billing",
      "ops/evidence/non_clearing/production-billing-operator-packet.json"
    ),
    mapStage1ProductionOperatorPacket(
      productionSecurityOperatorPacketEvidence,
      "security",
      "ops/evidence/non_clearing/production-security-operator-packet.json"
    ),
    mapStage1ProductionOperatorPacket(
      productionLegalSupportOperatorPacketEvidence,
      "legal_support",
      "ops/evidence/non_clearing/production-legal-support-operator-packet.json"
    ),
    mapStage1ProductionOperatorPacket(
      productionGovernanceOperatorPacketEvidence,
      "governance",
      "ops/evidence/non_clearing/production-governance-operator-packet.json"
    )
  ];
  const productionBlockerChecklist = mapStage1ProductionBlockerChecklist(
    productionBlockerChecklistMarkdown,
    "ops/evidence/non_clearing/production-blocker-checklist.md"
  );
  const productionActionMatrix = mapStage1ProductionActionMatrix(
    productionActionMatrixEvidence,
    productionActionMatrixMarkdown,
    "ops/evidence/non_clearing/production-action-matrix.json",
    "ops/evidence/non_clearing/production-action-matrix.md"
  );
  const productionInputTemplate = mapStage1ProductionInputTemplate(
    productionInputTemplateEvidence,
    productionInputTemplateText,
    "ops/evidence/non_clearing/production-input-template.env",
    "ops/evidence/non_clearing/production-input-template.json"
  );
  const nextBlockersSummary = mapStage1NextBlockersSummary(
    nextBlockersSummaryEvidence,
    "ops/evidence/non_clearing/stage1-next-blockers-summary.json"
  );

  return {
    generatedAt: newestTimestamp(
      newestTimestamp(
        newestTimestamp(newestTimestamp(staging.generatedAt, production.generatedAt), closureQueue.generatedAt),
        newestTimestamp(resourceReadiness.generatedAt, azureOriginReadiness.generatedAt)
      ),
      newestTimestamp(
        newestTimestamp(productionBlockerAudit.generatedAt, productionLaunchInputPacket.generatedAt),
        newestTimestamp(
          newestTimestamp(
            newestTimestamp(productionLaunchSourcePipeline.generatedAt, productionProofBundle.generatedAt),
            newestTimestamp(
              newestTimestamp(productionDnsDetail.generatedAt, productionProofDiagnostics.generatedAt),
                newestTimestamp(
                  newestTimestamp(productionLaunchOperatorBrief.generatedAt, productionMissingInputChecklist.generatedAt),
                  newestTimestamp(
                    productionSourceProbeRunbook.generatedAt,
                    newestTimestamp(
                      productionBlockerChecklist.generatedAt,
                      newestTimestamp(
                      productionActionMatrix.generatedAt,
                        newestTimestamp(
                          productionInputTemplate.generatedAt,
                          newestTimestamp(productionNonClearingRefresh.generatedAt, nextBlockersSummary.generatedAt)
                        )
                      )
                    )
                  )
                )
            )
          ),
          newestTimestampFromList(productionOperatorPackets.map((packet) => packet.generatedAt))
        )
      )
    ),
    decisionSource: "validator_evidence_only",
    manualGoControlsEnabled: false,
    staging,
    production,
    resourceReadiness,
    azureOriginReadiness,
    closureQueue,
    productionBlockerAudit,
    productionLaunchOperatorBrief,
    productionMissingInputChecklist,
    productionDnsDetail,
    productionLaunchInputPacket,
    productionOperatorPackets,
    productionLaunchSourcePipeline,
    productionSourceProbeRunbook,
    productionProofBundle,
    productionProofDiagnostics,
    productionBlockerChecklist,
    productionActionMatrix,
    productionInputTemplate,
    productionNonClearingRefresh,
    nextBlockersSummary,
    contractAnchors: [
      {
        id: "staging_runtime",
        contractPath: "fixtures/stage1/staging_runtime/local_contract.json",
        evidencePath: "ops/evidence/staging/stage1-runtime.json",
        resultsPath: "ops/evidence/staging/stage1-runtime.ndjson",
        contractValidatorCommand: "python3 scripts/validate_stage1_staging_runtime.py --contract-only",
        strictValidatorCommand: "python3 scripts/validate_stage1_staging_runtime.py",
        preflightValidatorCommand: "python3 scripts/validate_stage1_staging_runtime.py --allow-preflight",
        generatorCommand: "python3 scripts/generate_stage1_staging_runtime_evidence.py",
        gatePolicy: "strict validator evidence only; local, blocked, dry-run, raw payload, and secret material preserve no-go"
      },
      {
        id: "production_launch",
        contractPath: "fixtures/stage1/production_launch/local_contract.json",
        evidencePath: "ops/evidence/production/stage1-production-launch.json",
        resultsPath: "ops/evidence/production/stage1-production-launch.ndjson",
        contractValidatorCommand: "python3 scripts/validate_stage1_production_launch.py --contract-only",
        strictValidatorCommand: "python3 scripts/validate_stage1_production_launch.py",
        preflightValidatorCommand: "python3 scripts/validate_stage1_production_launch.py --allow-preflight",
        generatorCommand: "python3 scripts/generate_stage1_production_launch_evidence.py",
        gatePolicy: "all Stage 0 gates, exact CI evidence, strict staging, and production child evidence must be go"
      },
      {
        id: "release_evidence_closure_queue",
        contractPath: "fixtures/stage1/release_evidence_closure_queue/local_contract.json",
        evidencePath: "ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json",
        resultsPath: "n/a",
        contractValidatorCommand: "python3 scripts/validate_stage1_release_evidence_closure_queue.py --contract-only",
        strictValidatorCommand: "python3 scripts/validate_stage1_release_evidence_closure_queue.py",
        preflightValidatorCommand: "python3 scripts/validate_stage1_release_evidence_closure_queue.py --allow-preflight",
        generatorCommand: "python3 scripts/generate_stage1_release_evidence_closure_queue.py",
        gatePolicy: "operator queue preflight only; cannot clear staging, production, CI, or Do-Not-Launch gates"
      },
      {
        id: "external_resource_readiness",
        contractPath: "fixtures/stage1/external_resource_readiness/local_contract.json",
        evidencePath: "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json",
        resultsPath: "n/a",
        contractValidatorCommand: "python3 scripts/validate_stage1_external_resource_readiness.py --contract-only",
        strictValidatorCommand: "python3 scripts/validate_stage1_external_resource_readiness.py",
        preflightValidatorCommand: "python3 scripts/validate_stage1_external_resource_readiness.py --allow-preflight",
        generatorCommand: "python3 scripts/generate_stage1_external_resource_readiness.py",
        gatePolicy: "external resource preflight only; cannot clear staging, production, CI, or Do-Not-Launch gates"
      },
      {
        id: "r2_bucket_readiness",
        contractPath: "fixtures/stage1/r2_bucket_readiness/local_contract.json",
        evidencePath: "ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json",
        resultsPath: "n/a",
        contractValidatorCommand: "python3 scripts/validate_stage1_r2_bucket_readiness.py --contract-only",
        strictValidatorCommand: "python3 scripts/validate_stage1_r2_bucket_readiness.py",
        preflightValidatorCommand: "python3 scripts/validate_stage1_r2_bucket_readiness.py --allow-preflight",
        generatorCommand: "python3 scripts/stage1_r2_bucket_readiness.py --create-bucket",
        gatePolicy: "R2 bucket access preflight only; cannot clear staging object-retention, staging runtime, or Do-Not-Launch gates"
      }
    ],
    releaseGateSummary: production.releaseGateFixtures.map((gate) => ({
      gateId: gate.gateId,
      path: gate.path,
      status: gate.status,
      blockerCount: gate.blockers.length + gate.blockedByChecks.length,
      activeDoNotLaunchCount: gate.activeDoNotLaunchConditions.length
    })),
    nextOperatorActions: [
      ...summarizeStage1NextBlockersSummaryActions(nextBlockersSummary),
      ...summarizeResourceReadinessActions(resourceReadiness),
      ...summarizeAzureOriginReadinessActions(azureOriginReadiness),
      ...summarizeProductionLaunchOperatorBriefActions(productionLaunchOperatorBrief),
      ...summarizeProductionMissingInputChecklistActions(productionMissingInputChecklist),
      ...summarizeProductionActionMatrixActions(productionActionMatrix),
      ...summarizeProductionInputTemplateActions(productionInputTemplate),
      ...summarizeProductionNonClearingRefreshActions(productionNonClearingRefresh),
      ...summarizeProductionBlockerAuditActions(productionBlockerAudit),
      ...summarizeProductionDnsDetailActions(productionDnsDetail),
      ...summarizeProductionLaunchInputPacketActions(productionLaunchInputPacket),
      ...summarizeProductionLaunchSourcePipelineActions(productionLaunchSourcePipeline),
      ...summarizeProductionProofBundleActions(productionProofBundle),
      ...summarizeProductionProofDiagnosticsActions(productionProofDiagnostics),
      ...summarizeProductionOperatorPacketActions(productionOperatorPackets),
      ...summarizeAggregateAction("staging", staging),
      ...summarizeAggregateAction("production", production)
    ]
  };
}

export async function getAnalyticsReports() {
  return analyticsReports;
}

function normalizedAdminAPIBaseURL() {
  const value = (process.env.ADMIN_API_BASE_URL || process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL)?.trim();
  if (!value) {
    return "";
  }
  return value.replace(/\/$/, "");
}

async function adminAPIForwardHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    ...localAdminDevIdentityHeaders()
  };
  const cookieHeader = (await cookies()).toString();
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  return headers;
}

function localAdminDevIdentityHeaders(): Record<string, string> {
  if (
    process.env.ADMIN_DEV_IDENTITY_HEADERS_ENABLED !== "true" ||
    process.env.NEXT_PUBLIC_ADMIN_AUTH_MODE !== "local"
  ) {
    return {};
  }
  return {
    "X-Zenari-User-ID": process.env.SMOKE_ADMIN_USER_ID?.trim() || "local_admin_zenari.ai",
    "X-Zenari-Tenant-ID": process.env.SMOKE_ADMIN_TENANT_ID?.trim() || "tenant_local",
    "X-Zenari-Roles": process.env.LOCAL_ADMIN_ROLES?.trim() || "admin_superadmin"
  };
}

function mapAdminBatchQueueRuntime(item: AdminBatchQueueRuntimeAPI): Stage1BatchQueueRuntime {
  return {
    id: item.id,
    batchId: item.batch_id,
    tenantId: item.tenant_id,
    projectId: item.project_id,
    workspaceId: item.workspace_id,
    status: item.status,
    requestedCount: item.requested_count,
    queued: item.queued,
    running: item.running,
    succeeded: item.succeeded,
    failed: item.failed,
    cancelled: item.cancelled,
    blocked: item.blocked,
    retryable: item.retryable,
    workerId: item.worker_id,
    claimTimeoutSeconds: item.claim_timeout_seconds,
    oldestChildAgeMinutes: item.oldest_child_age_minutes,
    providerId: item.provider_id,
    modelId: item.model_id,
    toolType: item.tool_type,
    providerStrategyGroupId: item.provider_strategy_group_id,
    providerSelectionPolicy: item.provider_selection_policy,
    providerConcurrency: item.provider_concurrency,
    providerModelConcurrency: item.provider_model_concurrency,
    claimLeasePolicy: item.claim_lease_policy,
    drainPolicy: item.drain_policy,
    quotaPolicy: item.quota_policy,
    deadLetterPolicy: item.dead_letter_policy,
    idempotencyScope: item.idempotency_scope,
    nextOperatorAction: item.next_operator_action,
    auditRef: item.audit_ref,
    evidenceRefs: Array.isArray(item.evidence_refs) ? item.evidence_refs : []
  };
}

function mapAdminBatchChildTask(item: AdminBatchChildTaskAPI): Stage1BatchChildTask {
  return {
    id: item.id,
    batchId: item.batch_id,
    tenantId: item.tenant_id,
    status: item.status,
    providerId: item.provider_id,
    modelId: item.model_id,
    toolType: item.tool_type,
    retryCount: item.retry_count,
    maxRetries: item.max_retries,
    workerId: item.worker_id,
    claimAttempt: item.claim_attempt,
    claimExpiresAt: item.claim_expires_at,
    fanoutStage: item.fanout_stage,
    failureCode: item.failure_code,
    reviewReason: item.review_reason,
    quotaEstimateUnits: item.quota_estimate_units,
    quotaCommittedUnits: item.quota_committed_units,
    quotaRefundedUnits: item.quota_refunded_units,
    retryState: item.retry_state,
    deadLetterState: item.dead_letter_state,
    resultAssetId: item.result_asset_id,
    canvasObjectId: item.canvas_object_id,
    visibleTraceRef: item.visible_trace_ref,
    providerUsageRef: item.provider_usage_ref,
    idempotencyKey: item.idempotency_key,
    operatorAction: item.operator_action,
    auditRef: item.audit_ref,
    evidenceRefs: Array.isArray(item.evidence_refs) ? item.evidence_refs : []
  };
}

function exportJobFixtures(): ExportJob[] {
  return exportJobs.map((job) => ({ ...job, source: "fixture" as const }));
}

function mapExportToJob(item: ExportAPI): ExportJob {
  const denialReasons = Array.isArray(item.denial_reasons) ? item.denial_reasons : exportDenialReasons(item);
  const blocked = item.final_export_allowed === false || item.download_enabled === false || denialReasons.length > 0 || item.status === "blocked";
  const qaSeverity: ExportJob["qaSeverity"] =
    denialReasons.some((reason) => reason.includes("qa") || reason.includes("safety")) || item.qa_status === "failed"
      ? "blocking"
      : item.qa_status === "warning"
        ? "warning"
        : "info";
  const status = mapExportStatus(item.status, blocked);
  const auditRef = exportString(item.delivery?.audit_ref) || exportString(item.error?.audit_ref) || (item.audit_event_required ? "pending" : "api-export-read");
  const supportTicketId = exportString(item.delivery?.support_ticket_id) || exportString(item.error?.support_ticket_id) || "support-required";
  const traceId = item.trace_id ?? exportString(item.manifest?.trace_id) ?? exportString(item.delivery?.trace_id) ?? "trace-required";
  const retentionUntil = item.object_metadata?.retention_until ?? item.delivery?.retention_until ?? undefined;
  const downloadExpiresAt = item.download_expires_at ?? item.delivery?.download_expires_at ?? item.delivery?.signed_url_expires_at ?? undefined;

  return {
    id: item.id,
    userId: exportString(item.delivery?.user_id) || "tenant-scoped-admin-projection",
    packageId: item.package_id,
    status,
    qaSeverity,
    regenerateEligible: status === "failed" && qaSeverity !== "blocking",
    failureReason: denialReasons.length > 0 ? denialReasons.join(", ") : exportString(item.error?.message) || item.qa_status || "none",
    supportTicketId,
    requestedByRole: "admin_operator",
    requiredRole: qaSeverity === "blocking" ? "admin_reviewer" : "admin_operator",
    rbacDecision: qaSeverity === "blocking" ? "denied" : status === "failed" ? "allowed" : "second_review_required",
    idempotencyKey: `regenerate:${item.id}:${supportTicketId}:${item.updated_at}`,
    quotaEffect: qaSeverity === "blocking" ? "credit_after_audit" : status === "failed" ? "reserved_credit_released" : "none",
    regenerationMode: qaSeverity === "blocking" ? "not_allowed" : status === "failed" ? "full_rebuild" : "qa_preserving",
    regenerationRationale: exportRegenerationRationale(status, qaSeverity, denialReasons),
    closureEvidenceRefs: [item.id, supportTicketId, traceId, auditRef].filter((value) => value && value !== "pending"),
    auditRef,
    operatorRunbook: exportOperatorRunbook(status, qaSeverity),
    source: "api",
    projectId: item.project_id ?? undefined,
    taskId: item.task_id ?? undefined,
    format: item.format,
    downloadEnabled: item.download_enabled === true,
    signedUrlPresent: Boolean(item.download_url),
    downloadExpiresAt: downloadExpiresAt ?? undefined,
    retentionUntil: retentionUntil ?? undefined,
    blockedReasons: denialReasons,
    finalExportAllowed: item.final_export_allowed === true,
    objectMetadataId: item.object_metadata_id ?? item.object_metadata?.id ?? undefined,
    manifestPresent: Boolean(item.manifest && Object.keys(item.manifest).length > 0),
    qaReportPresent: Boolean(item.qa_report && Object.keys(item.qa_report).length > 0),
    provenancePresent: Boolean(item.provenance && Object.keys(item.provenance).length > 0),
    traceId
  };
}

function mapExportStatus(status: string, blocked: boolean): ExportJob["status"] {
  if (blocked) {
    return "blocked";
  }
  if (status === "ready" || status === "completed" || status === "succeeded") {
    return "completed";
  }
  if (status === "pending" || status === "running" || status === "retrying") {
    return "retrying";
  }
  return "failed";
}

function exportDenialReasons(item: ExportAPI): string[] {
  const reasons: string[] = [];
  for (const value of [item.error?.code, item.error?.reason, item.error?.message, item.qa_status]) {
    const text = exportString(value);
    if (text && text !== "pass" && text !== "ready" && text !== "completed") {
      reasons.push(text);
    }
  }
  return Array.from(new Set(reasons));
}

function exportRegenerationRationale(status: ExportJob["status"], qaSeverity: ExportJob["qaSeverity"], denialReasons: string[]) {
  if (qaSeverity === "blocking") {
    return `Export remains fail-closed because ${denialReasons.join(", ") || "a blocking QA or safety decision"} requires audit-safe review before any regeneration can be attempted.`;
  }
  if (status === "failed") {
    return "Failed export can be rebuilt once with an idempotency key after the support ticket, quota settlement, manifest, QA report, provenance, and audit evidence are linked.";
  }
  return "Export is already available or review-gated; regeneration remains disabled until a support-linked rationale and second-review audit evidence justify a QA-preserving rebuild.";
}

function exportOperatorRunbook(status: ExportJob["status"], qaSeverity: ExportJob["qaSeverity"]) {
  if (qaSeverity === "blocking") {
    return "Keep download disabled, preserve the blocked export and QA evidence, attach support and audit refs, then route remediation through safety review or quota credit without bypassing export gates.";
  }
  if (status === "failed") {
    return "Submit one idempotent regeneration after confirming support linkage, quota settlement, manifest and QA report requirements, retention metadata, signed URL policy, and immutable audit evidence.";
  }
  return "Do not regenerate from the list view; verify the signed URL, retention window, manifest, QA report, provenance, and audit refs before closing support.";
}

function exportString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapSafetyReviewToRiskyExport(item: SafetyReviewAPI): RiskyExport {
  return {
    id: item.id,
    exportId: item.subject_type === "export" ? item.subject_id : `${item.subject_type}:${item.subject_id}`,
    safetyDecisionId: item.safety_decision_id,
    rule: item.rule_key || item.rule_id || "safety-review",
    enforcementPoint: item.enforcement_point,
    severity: item.severity,
    action: item.safety_decision,
    overrideEligible: item.override_eligible,
    auditRequired: item.audit_required,
    reviewRationale: item.review_rationale || item.safety_rationale,
    secondReviewRequired: item.safety_decision === "block" || item.severity === "critical",
    reviewStatus: item.review_status,
    reviewerId: item.reviewer_id,
    auditRef: item.audit_ref,
    requiredEvidenceRefs: Array.isArray(item.required_evidence_refs) ? item.required_evidence_refs : [],
    userVisibleOutcome: item.user_visible_outcome,
    source: "api"
  };
}

function teamBillingLinkFixture(teamID: string): TeamBillingLink {
  return {
    tenant_id: "tenant_1",
    team_id: teamID,
    provider: "stripe",
    provider_subscription_id: "sub_test_team_seats",
    provider_subscription_item_id: "si_test_team_seats",
    price_id: "price_team_seat",
    proration_behavior: "create_prorations",
    status: "active",
    metadata: {
      ticket_id: "ticket_team_billing_link"
    },
    created_at: "2026-06-22T10:00:00Z",
    updated_at: "2026-06-22T10:00:00Z"
  };
}

function teamFixture(teamID: string): Team {
  return {
    id: teamID,
    tenant_id: "tenant_1",
    name: "Design Ops",
    plan_id: "pro",
    seat_limit: 5,
    created_at: "2026-06-22T10:00:00Z"
  };
}

function teamInviteFixture(teamID: string): TeamInvite {
  return {
    id: "team_invite_fixture_1",
    team_id: teamID,
    tenant_id: "tenant_1",
    email: "member@example.com",
    role: "member",
    idempotency_key: "team-invite-fixture-1",
    invited_by: "admin_operator_1",
    expires_at: "2026-07-06T10:00:00Z",
    created_at: "2026-06-22T10:00:00Z"
  };
}

function teamMemberRemoveFixture(teamID: string): AdminTeamMemberRemoveResult {
  return {
    team_id: teamID,
    tenant_id: "tenant_1",
    member_id: "member_fixture_removed",
    removed_by: "admin_operator_1",
    removed: true
  };
}

function teamSeatUsageFixture(teamID: string): TeamSeatUsage {
  return {
    team_id: teamID,
    tenant_id: "tenant_1",
    plan_id: "pro",
    seat_limit: 5,
    active_seats: 2,
    invited_seats: 1,
    billable_seats: 3,
    available_seats: 2
  };
}

function teamSeatBillingSyncFixtures(teamID: string): TeamSeatBillingSync[] {
  return [
    {
      id: "team_seat_sync_fixture_1",
      tenant_id: "tenant_1",
      team_id: teamID,
      provider: "stripe",
      provider_subscription_id: "sub_test_team_seats",
      provider_subscription_item_id: "si_test_team_seats",
      price_id: "price_team_seat",
      requested_quantity: 3,
      synced_quantity: 3,
      proration_behavior: "create_prorations",
      status: "synced",
      operation: "team.invite",
      idempotency_key: "team-invite-fixture-1",
      created_at: "2026-06-22T10:00:00Z"
    }
  ];
}

function mapSkillAPI(item: SkillAPI): Skill {
  const status = item.status === "active" ? "active" : item.status === "suspended" ? "suspended" : "suspended";
  return {
    id: item.id,
    name: item.name,
    domain: item.domain,
    activeVersion: item.active_version || "none",
    owner: item.owner,
    status,
    risk: item.risk_level,
    updatedAt: formatAdminDate(item.updated_at),
    source: "api"
  };
}

function mapSkillVersionAPI(item: SkillVersionAPI): SkillVersion {
  const gate = item.release_gate;
  const blockingReason = gate?.blocking_reason || "missing_eval_result";
  const lastStatus = gate?.last_eval_status ?? null;
  return {
    id: item.id,
    skillId: item.skill_id,
    version: item.version,
    status: item.status,
    reviewer: "api-skill-release-reader",
    secondReviewRequired: !gate?.eligible_for_active,
    secondReviewer: gate?.eligible_for_active ? "not-required" : "required-before-active",
    reviewerRationale: `Read-only API projection; release gate is ${blockingReason || "clear"}.`,
    evalSummary: lastStatus
      ? `${lastStatus}; contract ${gate?.eval_contract_complete ? "complete" : "incomplete"}; critical safety regressions ${gate?.critical_safety_regressions ?? 0}`
      : "No tenant-scoped eval result found.",
    provenance: gate?.last_eval_result_id ? `eval result ${gate.last_eval_result_id}` : "tenant-scoped skill_versions projection",
    rollbackPlan: item.rollback_target_version_id ? `Rollback to ${item.rollback_target_version_id}` : "Rollback target must be linked before activation.",
    canaryPercent: gate?.eligible_for_canary ? 0 : 0,
    trafficAllocation: {
      internalPercent: 0,
      allowlistPercent: 0,
      publicPercent: 0,
      holdoutPercent: 100,
      routeEvidence: gate?.eligible_for_canary
        ? "API release gate allows canary, but this admin view is read-only."
        : `No canary traffic while ${blockingReason || "release gate"} blocks rollout.`
    },
    canaryEvidence: gate?.eligible_for_canary ? "Eligible for canary by tenant-scoped eval result." : `Canary blocked: ${blockingReason}.`,
    releaseEvidence: gate?.eligible_for_active ? "Eligible for active release by eval contract." : `Active release blocked: ${blockingReason}.`,
    rollbackTarget: item.rollback_target_version_id || "missing-rollback-target",
    rollbackAuditRef: gate?.last_eval_result_id || "audit-required-before-mutation",
    evalSuiteId: item.eval_suite_id ?? null,
    releaseGate: gate
      ? {
          requiresEvalPass: gate.requires_eval_pass,
          eligibleForCanary: gate.eligible_for_canary,
          eligibleForActive: gate.eligible_for_active,
          blockingReason: gate.blocking_reason,
          lastEvalResultId: gate.last_eval_result_id ?? null,
          lastEvalStatus: gate.last_eval_status ?? null,
          evalContractComplete: gate.eval_contract_complete,
          criticalSafetyRegressions: gate.critical_safety_regressions
        }
      : undefined,
    source: "api"
  };
}

function mapEvalResultAPI(item: EvalResultAPI): EvalResult {
  const summary = item.summary ?? {};
  return {
    resultId: item.result_id,
    suiteId: item.suite_id,
    subjectType: item.subject?.subject_type ?? "",
    subjectId: item.subject?.subject_id ?? "",
    subjectVersion: item.subject?.version ?? "",
    candidateStatusAfterEval: item.subject?.candidate_status_after_eval ?? "draft",
    status: item.status,
    completedAt: item.completed_at,
    createdAt: item.created_at,
    totalFixtures: summary.total_fixtures ?? 0,
    passedFixtures: summary.passed_fixtures ?? 0,
    failedFixtures: summary.failed_fixtures ?? 0,
    blockedFixtures: summary.blocked_fixtures ?? 0,
    criticalSafetyRegressions: summary.critical_safety_regressions ?? 0,
    regressionPassRate: typeof summary.regression_pass_rate === "number" ? `${Math.round(summary.regression_pass_rate * 1000) / 10}%` : "n/a",
    traceComplete: summary.trace_complete === true,
    exportContractComplete: summary.export_contract_complete === true,
    qaFixtureCoverageComplete: summary.qa_fixture_coverage_complete === true,
    fixtureResultCount: Array.isArray(item.fixture_results) ? item.fixture_results.length : 0,
    runnerSha256: item.runner_contract?.runner_sha256 ?? "missing",
    storageTable: item.storage_contract?.table ?? "eval_results",
    artifactRef: `getEvalResultArtifact:${item.result_id}`,
    source: "api"
  };
}

function evalResultFixtures(): EvalResult[] {
  return [
    {
      resultId: "eval_result_stage0_rev2_starter_contract",
      suiteId: "eval_stage0_rev2_starter",
      subjectType: "vertical_workflow_pack",
      subjectId: "stage0_rev2_starter_workflows",
      subjectVersion: "rev2.fixture-contract.1",
      candidateStatusAfterEval: "blocked",
      status: "blocked",
      completedAt: "2026-05-26T00:00:00Z",
      createdAt: "2026-05-26T00:00:00Z",
      totalFixtures: 12,
      passedFixtures: 0,
      failedFixtures: 0,
      blockedFixtures: 12,
      criticalSafetyRegressions: 0,
      regressionPassRate: "100%",
      traceComplete: true,
      exportContractComplete: true,
      qaFixtureCoverageComplete: false,
      fixtureResultCount: 12,
      runnerSha256: "0ddc16f08fd696fba2c878c985c336a867099f7fd223b179ca0b44d652fc0638",
      storageTable: "eval_results",
      artifactRef: "getEvalResultArtifact:eval_result_stage0_rev2_starter_contract",
      source: "fixture"
    }
  ];
}

function formatAdminDate(value?: string) {
  if (!value) {
    return "unknown";
  }
  return value.replace("T", " ").replace(/:\d\d(?:\.\d+)?Z$/, " UTC");
}

function extractStage1MissingEvidenceRefs(
  aggregateBlockers: string[],
  components: Stage1ReleaseReadinessComponent[]
): Stage1MissingEvidenceRef[] {
  const rows = new Map<string, Stage1MissingEvidenceRef>();
  const addRows = (blockers: string[], componentId: string, source: Stage1MissingEvidenceRef["source"]) => {
    for (const blocker of blockers) {
      const match = blocker.match(/missing (evidence|results):\s+(ops\/evidence\/[^\s|,]+)/);
      if (!match) {
        continue;
      }
      const refType = match[1] === "evidence" || match[1] === "results" ? match[1] : "unknown";
      const path = match[2];
      const key = `${componentId}:${refType}:${path}:${source}`;
      rows.set(key, {
        componentId,
        refType,
        path,
        source,
        blocker
      });
    }
  };

  addRows(aggregateBlockers, "aggregate", "aggregate");
  for (const component of components) {
    addRows(component.blockers, component.componentId, "component");
  }
  return [...rows.values()].sort((left, right) =>
    `${left.componentId}:${left.path}:${left.source}`.localeCompare(`${right.componentId}:${right.path}:${right.source}`)
  );
}

function mapStage1AggregateEvidence(
  data: Record<string, unknown> | null,
  results: Record<string, unknown>[] | null,
  sourcePath: string,
  resultsPath: string,
  expectedEnvironment: Stage1AggregateEvidence["environment"]
): Stage1AggregateEvidence {
  if (!data) {
    return missingStage1AggregateEvidence(sourcePath, resultsPath, expectedEnvironment);
  }
  const components = arrayOfRecords(data.components).map(mapStage1ReleaseReadinessComponent);
  const resultRows = (results ?? []).map(mapStage1AggregateResultRow);
  const releaseGateFixtures = arrayOfRecords(data.release_gate_fixtures).map((item) => ({
    gateId: stringValue(item.gate_id, "unknown"),
    path: stringValue(item.path, "missing"),
    status: stringValue(item.status, "missing"),
    blockedByChecks: stringArray(item.blocked_by_checks),
    activeDoNotLaunchConditions: stringArray(item.active_do_not_launch_conditions),
    blockers: stringArray(item.blockers)
  }));
  const ciEvidence = arrayOfRecords(data.ci_evidence).map((item) => ({
    path: stringValue(item.path, "missing"),
    status: stringValue(item.status, "missing"),
    blockers: stringArray(item.blockers)
  }));
  const releaseBundlePreflight = mapStage1ReleaseBundlePreflight(data.release_bundle_preflight);
  const safetyPolicy = {
    secretMaterialPersisted: data.secret_material_persisted === true,
    rawPromptPersisted: data.raw_prompt_persisted === true,
    rawProviderPayloadPersisted: data.raw_provider_payload_persisted === true,
    rawStripePayloadPersisted: data.raw_stripe_payload_persisted === true,
    rawSupportBodyProjected: data.raw_support_body_projected === true,
    signedUrlPersisted: data.signed_url_persisted === true,
    authorizationHeaderPersisted: data.authorization_header_persisted === true,
    cookiePersisted: data.cookie_persisted === true
  };
  const blockers = stringArray(data.blockers);
  const missingEvidenceRefs = extractStage1MissingEvidenceRefs(blockers, components);

  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, `stage1_${expectedEnvironment}_aggregate`),
    environment: aggregateEnvironment(data.environment, expectedEnvironment),
    sourcePath,
    resultsPath,
    evidencePresent: true,
    resultsPresent: results !== null,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    allComponentsPassed: data.all_components_passed === true,
    allReleaseGatesGo: typeof data.all_release_gates_go === "boolean" ? data.all_release_gates_go : undefined,
    blockers,
    doNotLaunchConditions: stringArray(data.do_not_launch_conditions),
    missingEvidenceRefs,
    components,
    resultRows,
    releaseGateFixtures,
    ciEvidence,
    releaseBundlePreflight,
    runtimeInputReadiness: booleanRecord(data.runtime_input_readiness),
    validatorCommands: stringArray(data.validator_commands),
    gateSafety: buildStage1AggregateGateSafety({
      evidencePresent: true,
      status: stringValue(data.status, "missing"),
      releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
      blockers: stringArray(data.blockers),
      doNotLaunchConditions: stringArray(data.do_not_launch_conditions),
      allComponentsPassed: data.all_components_passed === true,
      allReleaseGatesGo: typeof data.all_release_gates_go === "boolean" ? data.all_release_gates_go : undefined,
      components,
      resultRows,
      releaseGateFixtures,
      ciEvidence,
      resultsPresent: results !== null,
      runtimeInputReadiness: booleanRecord(data.runtime_input_readiness),
      safetyPolicy,
      expectedEnvironment
    }),
    safetyPolicy
  };
}

function missingStage1AggregateEvidence(
  sourcePath: string,
  resultsPath: string,
  environment: Stage1AggregateEvidence["environment"]
): Stage1AggregateEvidence {
  return {
    schemaVersion: "missing",
    kind: `stage1_${environment}_aggregate_missing`,
    environment,
    sourcePath,
    resultsPath,
    evidencePresent: false,
    resultsPresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    allComponentsPassed: false,
    allReleaseGatesGo: environment === "production" ? false : undefined,
    blockers: [`missing aggregate evidence: ${sourcePath}`],
    doNotLaunchConditions: [`stage1_${environment}_evidence_missing`],
    missingEvidenceRefs: [
      {
        componentId: "aggregate",
        refType: "evidence",
        path: sourcePath,
        source: "aggregate",
        blocker: `missing aggregate evidence: ${sourcePath}`
      },
      {
        componentId: "aggregate",
        refType: "results",
        path: resultsPath,
        source: "aggregate",
        blocker: `missing aggregate results: ${resultsPath}`
      }
    ],
    components: [],
    resultRows: [],
    releaseGateFixtures: [],
    ciEvidence: [],
    releaseBundlePreflight: undefined,
    runtimeInputReadiness: {},
    validatorCommands: [
      environment === "staging"
        ? "python3 scripts/generate_stage1_staging_runtime_evidence.py"
        : "python3 scripts/generate_stage1_production_launch_evidence.py"
    ],
    gateSafety: buildStage1AggregateGateSafety({
      evidencePresent: false,
      status: "missing",
      releaseGateDecision: "no_go",
      blockers: [`missing aggregate evidence: ${sourcePath}`],
      doNotLaunchConditions: [`stage1_${environment}_evidence_missing`],
      allComponentsPassed: false,
      allReleaseGatesGo: environment === "production" ? false : undefined,
      components: [],
      resultRows: [],
      releaseGateFixtures: [],
      ciEvidence: [],
      resultsPresent: false,
      runtimeInputReadiness: {},
      safetyPolicy: {
        secretMaterialPersisted: false,
        rawPromptPersisted: false,
        rawProviderPayloadPersisted: false,
        rawStripePayloadPersisted: false,
        rawSupportBodyProjected: false,
        signedUrlPersisted: false,
        authorizationHeaderPersisted: false,
        cookiePersisted: false
      },
      expectedEnvironment: environment
    }),
    safetyPolicy: {
      secretMaterialPersisted: false,
      rawPromptPersisted: false,
      rawProviderPayloadPersisted: false,
      rawStripePayloadPersisted: false,
      rawSupportBodyProjected: false,
      signedUrlPersisted: false,
      authorizationHeaderPersisted: false,
      cookiePersisted: false
    }
  };
}

function mapStage1ReleaseBundlePreflight(value: unknown): Stage1AggregateEvidence["releaseBundlePreflight"] {
  if (!isRecord(value)) {
    return undefined;
  }
  const releaseMetadataPreflight = isRecord(value.release_metadata_preflight) ? value.release_metadata_preflight : {};
  return {
    path: stringValue(value.path, "missing"),
    exists: value.exists === true,
    status: stringValue(value.status, "missing"),
    decision: stringValue(value.decision, "missing"),
    stage1StagingRuntimeVerified: value.stage1_staging_runtime_verified === true,
    stage1QuotaReplayVerified: value.stage1_quota_replay_verified === true,
    stage1LoadVerified: value.stage1_load_verified === true,
    objectRetentionCleanupVerified: value.object_retention_cleanup_verified === true,
    legalSupportVisibilityVerified: value.legal_support_visibility_verified === true,
    ciClosureArtifactsReady: value.ci_closure_artifacts_ready === true,
    productionBackupRollbackSplitReady: value.production_backup_rollback_split_ready === true,
    releaseMetadataPreflightStatus: stringValue(releaseMetadataPreflight.status, "missing"),
    releaseMetadataPreflightComplete: releaseMetadataPreflight.metadata_complete === true,
    releaseMetadataMissingSlots: stringArray(releaseMetadataPreflight.missing_slots),
    releaseMetadataUnverifiedSlots: stringArray(releaseMetadataPreflight.unverified_slots),
    releaseMetadataBlockingReasons: stringArray(value.release_metadata_blocking_reasons),
    blockingReasonCount: typeof value.blocking_reason_count === "number" ? value.blocking_reason_count : undefined,
    stage1StagingRuntimeBlockingReasons: stringArray(value.stage1_staging_runtime_blocking_reasons),
    stage1QuotaReplayBlockingReasons: stringArray(value.stage1_quota_replay_blocking_reasons),
    stage1LoadBlockingReasons: stringArray(value.stage1_load_blocking_reasons),
    missingSlots: stringArray(value.missing_slots),
    unverifiedSlots: stringArray(value.unverified_slots),
    ciClosureArtifactBlockingReasons: stringArray(value.ci_closure_artifact_blocking_reasons),
    productionBackupRollbackSplitBlockingReasons: stringArray(value.production_backup_rollback_split_blocking_reasons),
    blockingReasons: stringArray(value.blocking_reasons),
    blockers: stringArray(value.blockers)
  };
}

function buildStage1AggregateGateSafety(input: {
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  blockers: string[];
  doNotLaunchConditions: string[];
  allComponentsPassed: boolean;
  allReleaseGatesGo?: boolean;
  components: Stage1ReleaseReadinessComponent[];
  resultRows: Stage1AggregateEvidence["resultRows"];
  releaseGateFixtures: Stage1AggregateEvidence["releaseGateFixtures"];
  ciEvidence: Stage1AggregateEvidence["ciEvidence"];
  resultsPresent: boolean;
  runtimeInputReadiness: Record<string, boolean>;
  safetyPolicy: Stage1AggregateEvidence["safetyPolicy"];
  expectedEnvironment: Stage1AggregateEvidence["environment"];
}): Stage1AggregateEvidence["gateSafety"] {
  const componentIssues = input.components.flatMap((component) => {
    const issues = [];
    if (component.status !== "passed" && component.status !== "pass") {
      issues.push(`${component.componentId}:status=${component.status}`);
    }
    if (!component.exactEvidence) {
      issues.push(`${component.componentId}:exact_evidence=false`);
    }
    if (component.localOnly) {
      issues.push(`${component.componentId}:local_only=true`);
    }
    if (component.dryRun) {
      issues.push(`${component.componentId}:dry_run=true`);
    }
    if (component.secretLeakDetected) {
      issues.push(`${component.componentId}:secret_leak_detected=true`);
    }
    if (component.rawPayloadPersisted) {
      issues.push(`${component.componentId}:raw_payload_persisted=true`);
    }
    if (component.blockersPreserved) {
      issues.push(`${component.componentId}:blockers_preserved=true`);
    }
    if (component.blockers.length > 0) {
      issues.push(`${component.componentId}:blockers=${component.blockers.length}`);
    }
    return issues;
  });
  const componentIds = new Set(input.components.map((component) => component.componentId));
  const resultRowIds = new Set(input.resultRows.map((row) => row.componentId));
  const missingResultRows = [...componentIds].filter((componentId) => !resultRowIds.has(componentId));
  const resultRowIssues = input.resultRows.flatMap((row) => {
    const issues = [];
    if (row.status !== "passed" && row.status !== "pass") {
      issues.push(`${row.componentId}:status=${row.status}`);
    }
    if (!row.exactEvidence) {
      issues.push(`${row.componentId}:exact_evidence=false`);
    }
    if (row.secretLeakDetected) {
      issues.push(`${row.componentId}:secret_leak_detected=true`);
    }
    if (row.rawPayloadPersisted) {
      issues.push(`${row.componentId}:raw_payload_persisted=true`);
    }
    if (row.blockersPreserved) {
      issues.push(`${row.componentId}:blockers_preserved=true`);
    }
    if (row.blockers.length > 0) {
      issues.push(`${row.componentId}:blockers=${row.blockers.length}`);
    }
    return issues;
  });
  resultRowIssues.push(...missingResultRows.map((componentId) => `${componentId}:missing_result_row`));
  const runtimeInputIssues = Object.entries(input.runtimeInputReadiness)
    .filter(([, ready]) => ready !== true)
    .map(([field]) => `${field}=false`);
  const safetyIssues = Object.entries(input.safetyPolicy)
    .filter(([, persisted]) => persisted === true)
    .map(([field]) => `${field}=true`);
  const releaseGateIssues = input.releaseGateFixtures.flatMap((gate) => {
    const issues = [];
    if (gate.status !== "go") {
      issues.push(`${gate.gateId}:status=${gate.status}`);
    }
    if (gate.blockedByChecks.length > 0) {
      issues.push(`${gate.gateId}:blocked_by_checks=${gate.blockedByChecks.length}`);
    }
    if (gate.activeDoNotLaunchConditions.length > 0) {
      issues.push(`${gate.gateId}:active_dnl=${gate.activeDoNotLaunchConditions.length}`);
    }
    if (gate.blockers.length > 0) {
      issues.push(`${gate.gateId}:blockers=${gate.blockers.length}`);
    }
    return issues;
  });
  const ciIssues = input.ciEvidence.flatMap((item) => {
    const issues = [];
    if (item.status !== "pass" && item.status !== "passed") {
      issues.push(`${item.path}:status=${item.status}`);
    }
    if (item.blockers.length > 0) {
      issues.push(`${item.path}:blockers=${item.blockers.length}`);
    }
    return issues;
  });

  const checks: Stage1AggregateGateCheck[] = [
    {
      checkId: "aggregate_evidence_present",
      passed: input.evidencePresent,
      detail: input.evidencePresent ? "aggregate evidence file is present" : "aggregate evidence file is missing"
    },
    {
      checkId: "aggregate_status_go",
      passed: input.status === "pass" && input.releaseGateDecision === "go",
      detail: `${input.status} / ${input.releaseGateDecision}`
    },
    {
      checkId: "do_not_launch_clear",
      passed: input.doNotLaunchConditions.length === 0,
      detail: input.doNotLaunchConditions.join(", ") || "none"
    },
    {
      checkId: "aggregate_blockers_clear",
      passed: input.blockers.length === 0,
      detail: input.blockers.slice(0, 3).join(" | ") || "none"
    },
    {
      checkId: "components_exact_and_safe",
      passed: input.allComponentsPassed && componentIssues.length === 0,
      detail: componentIssues.slice(0, 5).join(" | ") || "all components exact and safe"
    },
    {
      checkId: "results_rows_exact_and_safe",
      passed: input.resultsPresent && input.resultRows.length > 0 && resultRowIssues.length === 0,
      detail: resultRowIssues.slice(0, 5).join(" | ") || "all aggregate result rows exact and safe"
    },
    {
      checkId: "runtime_inputs_ready",
      passed: runtimeInputIssues.length === 0,
      detail: runtimeInputIssues.slice(0, 5).join(" | ") || "all runtime inputs ready"
    },
    {
      checkId: "safe_projection_clear",
      passed: safetyIssues.length === 0,
      detail: safetyIssues.join(" | ") || "no unsafe projection flags"
    }
  ];

  if (input.expectedEnvironment === "production") {
    checks.push(
      {
        checkId: "stage0_release_gates_go",
        passed: input.allReleaseGatesGo === true && releaseGateIssues.length === 0,
        detail: releaseGateIssues.slice(0, 5).join(" | ") || "all release gate fixtures go"
      },
      {
        checkId: "ci_evidence_exact",
        passed: input.ciEvidence.length > 0 && ciIssues.length === 0,
        detail: ciIssues.slice(0, 5).join(" | ") || "all CI evidence exact"
      }
    );
  }

  const strictGateBlockers = checks.filter((check) => !check.passed).map((check) => `${check.checkId}: ${check.detail}`);
  return {
    strictGateReady: strictGateBlockers.length === 0,
    verdict: strictGateBlockers.length === 0 ? "go" : "blocked",
    strictGateBlockers,
    checks
  };
}

function mapStage1ReleaseReadinessComponent(item: Record<string, unknown>): Stage1ReleaseReadinessComponent {
  return {
    componentId: stringValue(item.component_id, "unknown"),
    environment: aggregateEnvironment(item.environment, "unknown"),
    status: stringValue(item.status, "missing"),
    exactEvidence: item.exact_evidence === true,
    localOnly: item.local_only === true,
    dryRun: item.dry_run === true,
    blockersPreserved: typeof item.blockers_preserved === "boolean" ? item.blockers_preserved : undefined,
    secretLeakDetected: item.secret_leak_detected === true,
    rawPayloadPersisted: item.raw_payload_persisted === true,
    evidenceRefs: stringArray(item.evidence_refs),
    checkLevelPassed: typeof item.check_level_passed === "boolean" ? item.check_level_passed : undefined,
    checkLevelBlockersPreserved:
      typeof item.check_level_blockers_preserved === "boolean" ? item.check_level_blockers_preserved : undefined,
    checkLevelEvidenceRefs: stringArray(item.check_level_evidence_refs),
    resultsRef: typeof item.results_ref === "string" ? item.results_ref : null,
    proofs: stringArray(item.proofs),
    blockers: stringArray(item.blockers),
    validatorCommands: stringArray(item.validator_commands)
  };
}

function mapStage1AggregateResultRow(item: Record<string, unknown>) {
  return {
    componentId: stringValue(item.component_id, "unknown"),
    environment: aggregateEnvironment(item.environment, "unknown"),
    status: stringValue(item.status, "missing"),
    exactEvidence: item.exact_evidence === true,
    secretLeakDetected: item.secret_leak_detected === true,
    rawPayloadPersisted: item.raw_payload_persisted === true,
    blockersPreserved: typeof item.blockers_preserved === "boolean" ? item.blockers_preserved : undefined,
    checkLevelPassed: typeof item.check_level_passed === "boolean" ? item.check_level_passed : undefined,
    checkLevelBlockersPreserved:
      typeof item.check_level_blockers_preserved === "boolean" ? item.check_level_blockers_preserved : undefined,
    checkLevelEvidenceRefs: stringArray(item.check_level_evidence_refs),
    blockers: stringArray(item.blockers)
  };
}

function mapStage1ExternalResourceReadiness(
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1ExternalResourceReadiness {
  if (!data) {
    return missingStage1ExternalResourceReadiness(sourcePath);
  }
  const summary = isRecord(data.resource_summary) ? data.resource_summary : {};
  const resourceGroups = arrayOfRecords(data.resource_groups).map(mapStage1ExternalResourceGroup);
  const nonClearingRefreshSummary = mapStage1ExternalResourceNonClearingRefreshSummary(data.non_clearing_refresh_summary);
  const operatorHandoff = mapStage1ExternalResourceHandoff(data.operator_handoff, resourceGroups, nonClearingRefreshSummary);
  const productionSourceProbeRequirements = arrayOfRecords(data.production_source_probe_requirements).map(
    mapStage1ProductionSourceProbeRequirement
  );
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_external_resource_readiness_preflight"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    total: numberValue(summary.total, resourceGroups.length),
    ready: numberValue(summary.ready, resourceGroups.filter((row) => row.status === "ready").length),
    providedUnverified: numberValue(summary.provided_unverified, resourceGroups.filter((row) => row.status === "provided_unverified").length),
    blocked: numberValue(summary.blocked, resourceGroups.filter((row) => row.status === "blocked").length),
    missing: numberValue(summary.missing, resourceGroups.filter((row) => row.status === "missing").length),
    readyPercent: numberValue(summary.ready_percent, 0),
    blockers: stringArray(data.blockers),
    operatorHandoff,
    nonClearingRefreshSummary,
    productionSourceProbeRequirements,
    resourceGroups
  };
}

function mapStage1AzureOriginReadiness(
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1AzureOriginReadiness {
  if (!data) {
    return missingStage1AzureOriginReadiness(sourcePath);
  }
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_azure_origin_readiness"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    azureIp: stringValue(data.azure_ip, "missing"),
    stagingWebUrl: stringValue(data.staging_web_url, "missing"),
    stagingHost: stringValue(data.staging_host, "missing"),
    nonClearingOriginProbe: booleanValue(data.non_clearing_origin_probe, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1StagingRuntimeGate: booleanValue(data.can_clear_stage1_staging_runtime_gate, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    tcpPorts: arrayOfRecords(data.tcp_ports).map(mapStage1AzureOriginTcpProbe),
    stagingDns: mapStage1AzureOriginDnsProbe(data.staging_dns),
    httpProbes: arrayOfRecords(data.http_probes).map(mapStage1AzureOriginHttpProbe),
    sshKeyPreflight: mapStage1AzureOriginSshPreflight(data.ssh_key_preflight),
    azureCliPreflight: mapStage1AzureCliPreflight(data.azure_cli_preflight),
    transportDiagnosis: mapStage1AzureTransportDiagnosis(data.transport_diagnosis),
    blockedChecks: stringArray(data.blocked_checks),
    sshHardTimeoutSeconds: numberValue(data.ssh_hard_timeout_seconds, 20),
    localRepairPasswordEnvKey: stringValue(data.local_repair_password_env_key, "STAGING_SSH_PASSWORD"),
    localRepairPasswordConfigured: booleanValue(data.local_repair_password_configured, false),
    localRepairPasswordRequired: booleanValue(data.local_repair_password_required, true),
    originRepairCommands: stringArray(data.origin_repair_commands),
    originDiagnosticsCommand: stringValue(data.origin_diagnostics_command, "scripts/azure_staging_origin_diagnostics.sh"),
    originRepairCommand: stringValue(data.origin_repair_command, "scripts/azure_staging_origin_repair.sh"),
    operatorNextActions: stringArray(data.operator_next_actions)
  };
}

function mapStage1EvidenceClosureQueue(data: Record<string, unknown> | null, sourcePath: string): Stage1EvidenceClosureQueue {
  if (!data) {
    return missingStage1EvidenceClosureQueue(sourcePath);
  }
  const summary = isRecord(data.queue_summary) ? data.queue_summary : {};
  const byPriority = isRecord(summary.by_priority) ? summary.by_priority : {};
  const byLane = isRecord(summary.by_lane) ? summary.by_lane : {};
  const queue = arrayOfRecords(data.queue).map(mapStage1EvidenceClosureQueueRow);
  const parallelOperationalBlockers = arrayOfRecords(data.parallel_operational_blockers).map(
    mapStage1EvidenceClosureQueueParallelBlocker
  );
  const operatorActionPacketSummary = mapStage1EvidenceClosureQueueOperatorActionPacketSummary(
    data.operator_action_packet_summary
  );
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_release_evidence_closure_queue_preflight"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    total: numberValue(summary.total, queue.length),
    open: numberValue(summary.open, queue.filter((row) => row.rowStatus !== "passed").length),
    completed: numberValue(summary.completed, queue.filter((row) => row.rowStatus === "passed").length),
    completionPercent: numberValue(summary.completion_percent, 0),
    p0: numberValue(byPriority.P0, queue.filter((row) => row.priority === "P0").length),
    p1: numberValue(byPriority.P1, queue.filter((row) => row.priority === "P1").length),
    p2: numberValue(byPriority.P2, queue.filter((row) => row.priority === "P2").length),
    staging: numberValue(byLane.staging, queue.filter((row) => row.lane === "staging").length),
    ci: numberValue(byLane.ci, queue.filter((row) => row.lane === "ci").length),
    production: numberValue(byLane.production, queue.filter((row) => row.lane === "production").length),
    openGates: stringArray(summary.open_gates),
    queue,
    parallelOperationalBlockers,
    parallelOperationalBlockerCount: numberValue(
      summary.parallel_operational_blockers,
      parallelOperationalBlockers.length
    ),
    operatorActionPacketSummary,
    operatorActionPacketItems: numberValue(summary.operator_action_packet_items, operatorActionPacketSummary.items.length)
  };
}

function missingStage1EvidenceClosureQueue(sourcePath: string): Stage1EvidenceClosureQueue {
  return {
    schemaVersion: "missing",
    kind: "stage1_release_evidence_closure_queue_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    total: 0,
    open: 0,
    completed: 0,
    completionPercent: 0,
    p0: 0,
    p1: 0,
    p2: 0,
    staging: 0,
    ci: 0,
    production: 0,
    openGates: [],
    queue: [],
    parallelOperationalBlockers: [],
    parallelOperationalBlockerCount: 0,
    operatorActionPacketSummary: missingStage1EvidenceClosureQueueOperatorActionPacketSummary(),
    operatorActionPacketItems: 0
  };
}

function mapStage1EvidenceClosureQueueRow(item: Record<string, unknown>): Stage1EvidenceClosureQueueRow {
  return {
    priority: stringValue(item.priority, "unknown"),
    lane: closureQueueLane(item.lane),
    rowStatus: closureQueueRowStatus(item.row_status),
    gate: stringValue(item.gate, "unknown"),
    requiredEvidence: stringValue(item.required_evidence, "missing"),
    validator: stringValue(item.validator, "missing"),
    generator: stringValue(item.generator, "missing"),
    currentBlocker: stringValue(item.current_blocker, "missing"),
    dnlImpact: stringValue(item.dnl_impact, "missing")
  };
}

function mapStage1EvidenceClosureQueueParallelBlocker(
  item: Record<string, unknown>
): Stage1EvidenceClosureQueueParallelBlocker {
  return {
    blockerId: stringValue(item.blocker_id, "unknown"),
    lane: stringValue(item.lane, "unknown"),
    status: stringValue(item.status, "blocked"),
    releaseGateImpact: stringValue(item.release_gate_impact, "non_clearing_parallel_ops_only"),
    sourceRefs: stringArray(item.source_refs),
    currentBlocker: stringValue(item.current_blocker, "missing"),
    nextAction: stringValue(item.next_action, "missing"),
    operatorCommand: stringValue(item.operator_command, "missing"),
    transportLane: stringValue(item.transport_lane, "unknown"),
    transportNextAction: stringValue(item.transport_next_action, "unknown"),
    runCommandNextRepairLane: stringValue(item.run_command_next_repair_lane, "unknown"),
    runCommandInputPresent: booleanValue(item.run_command_input_present, false),
    canClearStage1StagingRuntimeGate: booleanValue(item.can_clear_stage1_staging_runtime_gate, false),
    canClearStage1ProductionLaunchGate: booleanValue(item.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(item.can_close_do_not_launch, false)
  };
}

function mapStage1EvidenceClosureQueueOperatorActionPacketSummary(
  value: unknown
): Stage1EvidenceClosureQueueOperatorActionPacketSummary {
  if (!isRecord(value)) {
    return missingStage1EvidenceClosureQueueOperatorActionPacketSummary();
  }
  const items = arrayOfRecords(value.items).map(mapStage1EvidenceClosureQueueOperatorActionPacketItem);
  return {
    sourcePath: stringValue(value.source_path, "ops/evidence/non_clearing/stage1-next-blockers-summary.json"),
    sourceSchemaVersion: stringValue(value.source_schema_version, "missing"),
    status: stringValue(value.status, "missing"),
    releaseGateDecision: stringValue(value.release_gate_decision, "no_go"),
    canonicalPassPath: booleanValue(value.canonical_pass_path, false),
    total: numberValue(value.total, items.length),
    blocked: numberValue(value.blocked, items.filter((item) => item.status === "blocked").length),
    requiresExternalInput: numberValue(
      value.requires_external_input,
      items.filter((item) => item.requiresExternalInput).length
    ),
    ownerCounts: numberRecord(value.owner_counts),
    gateImpactCounts: numberRecord(value.gate_impact_counts),
    sourceGateFlagsAllFalse: booleanValue(value.source_gate_flags_all_false, false),
    items,
    canClearStage1StagingRuntimeGate: booleanValue(value.can_clear_stage1_staging_runtime_gate, false),
    canClearStage1ProductionLaunchGate: booleanValue(value.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(value.can_close_do_not_launch, false)
  };
}

function missingStage1EvidenceClosureQueueOperatorActionPacketSummary(): Stage1EvidenceClosureQueueOperatorActionPacketSummary {
  return {
    sourcePath: "ops/evidence/non_clearing/stage1-next-blockers-summary.json",
    sourceSchemaVersion: "missing",
    status: "missing",
    releaseGateDecision: "no_go",
    canonicalPassPath: false,
    total: 0,
    blocked: 0,
    requiresExternalInput: 0,
    ownerCounts: {},
    gateImpactCounts: {},
    sourceGateFlagsAllFalse: false,
    items: [],
    canClearStage1StagingRuntimeGate: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false
  };
}

function mapStage1EvidenceClosureQueueOperatorActionPacketItem(
  item: Record<string, unknown>
): Stage1EvidenceClosureQueueOperatorActionPacketItem {
  return {
    order: numberValue(item.order, 0),
    itemId: stringValue(item.item_id, "unknown"),
    owner: stringValue(item.owner, "unknown"),
    status: stringValue(item.status, "blocked"),
    requiresExternalInput: booleanValue(item.requires_external_input, true),
    requiredReturnArtifact: stringValue(item.required_return_artifact, "not reported"),
    agentCommandAfterReturn: stringValue(item.agent_command_after_return, "not reported"),
    validationAfterReturn: stringValue(item.validation_after_return, "not reported"),
    evidenceRef: stringValue(item.evidence_ref, "not reported"),
    gateImpact: stringValue(item.gate_impact, "non_clearing_operator_shortlist_only"),
    canClearStage1StagingRuntimeGate: booleanValue(item.can_clear_stage1_staging_runtime_gate, false),
    canClearStage1ProductionLaunchGate: booleanValue(item.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(item.can_close_do_not_launch, false)
  };
}

function mapStage1ProductionBlockerAudit(data: Record<string, unknown> | null, sourcePath: string): Stage1ProductionBlockerAudit {
  if (!data) {
    return missingStage1ProductionBlockerAudit(sourcePath);
  }
  const closureSummary = isRecord(data.closure_summary) ? data.closure_summary : {};
  const dnsReadiness = isRecord(data.production_dns_readiness) ? data.production_dns_readiness : {};
  const proofBundle = isRecord(data.production_proof_bundle) ? data.production_proof_bundle : {};
  const coverage = isRecord(proofBundle.input_variable_coverage) ? proofBundle.input_variable_coverage : {};
  const operatorSummary = isRecord(data.operator_summary) ? data.operator_summary : {};
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_blocker_audit"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    finalBlockerCount: numberValue(data.final_blocker_count, 0),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    nonClearingAudit: booleanValue(data.non_clearing_audit, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    closureSummary: {
      status: stringValue(closureSummary.status, "missing"),
      releaseGateDecision: stringValue(closureSummary.release_gate_decision, "no_go"),
      path: stringValue(closureSummary.path, "missing"),
      total: numberValue(closureSummary.total, 0),
      completed: numberValue(closureSummary.completed, 0),
      open: numberValue(closureSummary.open, 0),
      completionPercent: numberValue(closureSummary.completion_percent, 0),
      openGates: stringArray(closureSummary.open_gates)
    },
    productionDnsReadiness: {
      status: stringValue(dnsReadiness.status, "missing"),
      releaseGateDecision: stringValue(dnsReadiness.release_gate_decision, "no_go"),
      path: stringValue(dnsReadiness.path, "missing"),
      productionWebUrl: stringValue(dnsReadiness.production_web_url, "missing"),
      publicDnsAStatus: stringValue(dnsReadiness.public_dns_a_status, "missing"),
      publicDnsAaaaStatus: stringValue(dnsReadiness.public_dns_aaaa_status, "missing"),
      systemResolverStatus: stringValue(dnsReadiness.system_resolver_status, "missing"),
      firstBlocker: stringValue(dnsReadiness.first_blocker, "missing")
    },
    proofBundlePath: stringValue(proofBundle.path, "missing"),
    proofBundleStatus: stringValue(proofBundle.status, "missing"),
    proofBundleReleaseGateDecision: stringValue(proofBundle.release_gate_decision, "no_go"),
    proofStatuses: stringRecord(proofBundle.proof_statuses),
    proofInputCoverage: mapStage1ProductionProofInputCoverage(coverage),
    productionSourceAudit: arrayOfRecords(data.production_source_audit).map(mapStage1ProductionBlockerAuditSourceRow),
    openSourceProbeIds: stringArray(data.open_source_probe_ids),
    liveSourceInputsNeeded: stringArray(operatorSummary.production_live_source_inputs_needed),
    stagingIsNotCurrentBlocker: booleanValue(operatorSummary.staging_is_not_current_blocker, false),
    stripeSandboxIsNotCurrentBlocker: booleanValue(operatorSummary.stripe_sandbox_is_not_current_blocker, false)
  };
}

function missingStage1ProductionBlockerAudit(sourcePath: string): Stage1ProductionBlockerAudit {
  return {
    schemaVersion: "missing",
    kind: "stage1_production_blocker_audit_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    finalBlockerCount: 0,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    nonClearingAudit: true,
    canonicalPassPath: false,
    closureSummary: {
      status: "missing",
      releaseGateDecision: "no_go",
      path: "missing",
      total: 0,
      completed: 0,
      open: 0,
      completionPercent: 0,
      openGates: []
    },
    productionDnsReadiness: {
      status: "missing",
      releaseGateDecision: "no_go",
      path: "missing",
      productionWebUrl: "missing",
      publicDnsAStatus: "missing",
      publicDnsAaaaStatus: "missing",
      systemResolverStatus: "missing",
      firstBlocker: `missing production blocker audit evidence: ${sourcePath}`
    },
    proofBundlePath: "missing",
    proofBundleStatus: "missing",
    proofBundleReleaseGateDecision: "no_go",
    proofStatuses: {},
    proofInputCoverage: mapStage1ProductionProofInputCoverage({}),
    productionSourceAudit: [],
    openSourceProbeIds: [],
    liveSourceInputsNeeded: [],
    stagingIsNotCurrentBlocker: false,
    stripeSandboxIsNotCurrentBlocker: false
  };
}

function mapStage1ProductionProofInputCoverage(data: Record<string, unknown>): Stage1ProductionBlockerAudit["proofInputCoverage"] {
  const groups = isRecord(data.groups) ? data.groups : {};
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    valueRedaction: stringValue(data.value_redaction, "variable_names_only"),
    requiredTotal: numberValue(data.required_total, 0),
    requiredConfigured: numberValue(data.required_configured, 0),
    requiredMissing: numberValue(data.required_missing, 0),
    requiredInvalid: numberValue(data.required_invalid, 0),
    requiredCompletionPercent: numberValue(data.required_completion_percent, 0),
    blockingInputCount: numberValue(data.blocking_input_count, 0),
    firstMissingOrInvalidInputs: stringArray(data.first_missing_or_invalid_inputs),
    groups: Object.entries(groups).map(([groupId, value]) => {
      const group = isRecord(value) ? value : {};
      return {
        groupId,
        requiredTotal: numberValue(group.required_total, 0),
        requiredConfigured: numberValue(group.required_configured, 0),
        requiredMissing: numberValue(group.required_missing, 0),
        requiredInvalid: numberValue(group.required_invalid, 0)
      };
    })
  };
}

function mapStage1ProductionBlockerAuditSourceRow(item: Record<string, unknown>): Stage1ProductionBlockerAuditSourceRow {
  const strictValidation = isRecord(item.strict_validation) ? item.strict_validation : {};
  return {
    probeId: stringValue(item.probe_id, "unknown"),
    status: stringValue(item.status, "missing"),
    missingInput: stringValue(item.missing_input, "missing"),
    firstBlocker: stringValue(item.first_blocker, "missing"),
    operatorAction: stringValue(item.operator_action, "missing"),
    sourcePath: stringValue(item.source_path, "missing"),
    sourceProbeExists: booleanValue(item.source_probe_exists, false),
    strictValidationSummary: stringValue(strictValidation.summary, "missing")
  };
}

function mapStage1ProductionLaunchOperatorBrief(
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1ProductionLaunchOperatorBrief {
  if (!data) {
    return missingStage1ProductionLaunchOperatorBrief(sourcePath);
  }
  const summary = isRecord(data.summary) ? data.summary : {};
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_launch_operator_brief"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    nonClearingOperatorBrief: booleanValue(data.non_clearing_operator_brief, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    valueRedaction: stringValue(data.value_redaction, "variable_names_only"),
    sourceRefs: stringRecord(data.source_refs),
    summary: {
      stage1GatesCompleted: numberValue(summary.stage1_gates_completed, 0),
      stage1GatesTotal: numberValue(summary.stage1_gates_total, 0),
      stage1CompletionPercent: numberValue(summary.stage1_completion_percent, 0),
      openGateCount: numberValue(summary.open_gate_count, 0),
      finalBlockerCount: numberValue(summary.final_blocker_count, 0),
      productionInputsConfigured: numberValue(summary.production_inputs_configured, 0),
      productionInputsTotal: numberValue(summary.production_inputs_total, 0),
      productionInputsCompletionPercent: numberValue(summary.production_inputs_completion_percent, 0),
      productionInputsMissing: numberValue(summary.production_inputs_missing, 0),
      productionInputsInvalid: numberValue(summary.production_inputs_invalid, 0),
      blockingInputCount: numberValue(summary.blocking_input_count, 0)
    },
    openGates: stringArray(data.open_gates),
    blockerMatrix: arrayOfRecords(data.blocker_matrix).map(mapStage1ProductionLaunchOperatorBriefMatrixRow),
    operatorNextActions: stringArray(data.operator_next_actions)
  };
}

function missingStage1ProductionLaunchOperatorBrief(sourcePath: string): Stage1ProductionLaunchOperatorBrief {
  return {
    schemaVersion: "missing",
    kind: "stage1_production_launch_operator_brief_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    nonClearingOperatorBrief: true,
    canonicalPassPath: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    valueRedaction: "variable_names_only",
    sourceRefs: {},
    summary: {
      stage1GatesCompleted: 0,
      stage1GatesTotal: 0,
      stage1CompletionPercent: 0,
      openGateCount: 0,
      finalBlockerCount: 0,
      productionInputsConfigured: 0,
      productionInputsTotal: 0,
      productionInputsCompletionPercent: 0,
      productionInputsMissing: 0,
      productionInputsInvalid: 0,
      blockingInputCount: 0
    },
    openGates: [],
    blockerMatrix: [],
    operatorNextActions: [`missing production launch operator brief: ${sourcePath}`]
  };
}

function mapStage1ProductionLaunchOperatorBriefMatrixRow(
  item: Record<string, unknown>
): Stage1ProductionLaunchOperatorBrief["blockerMatrix"][number] {
  const diagnostic = isRecord(item.diagnostic) ? item.diagnostic : {};
  return {
    blockerId: stringValue(item.blocker_id, "unknown"),
    title: stringValue(item.title, "unknown"),
    status: stringValue(item.status, "missing"),
    coverageGroup: stringValue(item.coverage_group, "unknown"),
    gateIds: stringArray(item.gate_ids),
    requiredConfigured: numberValue(item.required_configured, 0),
    requiredTotal: numberValue(item.required_total, 0),
    requiredMissing: numberValue(item.required_missing, 0),
    requiredInvalid: numberValue(item.required_invalid, 0),
    blockingInputCount: numberValue(item.blocking_input_count, 0),
    completionPercent: numberValue(item.completion_percent, 0),
    firstBlocker: stringValue(item.first_blocker, "missing"),
    firstMissingRequiredInputs: stringArray(item.first_missing_required_inputs),
    invalidRequiredInputs: stringArray(item.invalid_required_inputs),
    diagnostic: {
      path: stringValue(diagnostic.path, "missing"),
      exists: booleanValue(diagnostic.exists, false),
      status: stringValue(diagnostic.status, "missing"),
      schemaVersion: stringValue(diagnostic.schema_version, "missing"),
      firstBlocker: stringValue(diagnostic.first_blocker, "missing"),
      canonicalSourceWritten: booleanValue(diagnostic.canonical_source_written, false)
    },
    sourceRefs: stringRecord(item.source_refs),
    operatorNextActions: stringArray(item.operator_next_actions)
  };
}

function mapStage1ProductionMissingInputChecklist(
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1ProductionMissingInputChecklist {
  if (!data) {
    return missingStage1ProductionMissingInputChecklist(sourcePath);
  }
  const summary = isRecord(data.summary) ? data.summary : {};
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_missing_input_checklist"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    nonClearingChecklist: booleanValue(data.non_clearing_checklist, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    valueRedaction: stringValue(data.value_redaction, "variable_names_only"),
    sourceRefs: stringRecord(data.source_refs),
    summary: {
      requiredTotal: numberValue(summary.required_total, 0),
      requiredConfigured: numberValue(summary.required_configured, 0),
      requiredMissing: numberValue(summary.required_missing, 0),
      requiredInvalid: numberValue(summary.required_invalid, 0),
      blockingInputCount: numberValue(summary.blocking_input_count, 0),
      requiredCompletionPercent: numberValue(summary.required_completion_percent, 0)
    },
    groups: arrayOfRecords(data.groups).map(mapStage1ProductionMissingInputChecklistGroup),
    items: arrayOfRecords(data.items).map(mapStage1ProductionMissingInputChecklistItem),
    operatorNextActions: stringArray(data.operator_next_actions)
  };
}

function missingStage1ProductionMissingInputChecklist(sourcePath: string): Stage1ProductionMissingInputChecklist {
  return {
    schemaVersion: "missing",
    kind: "stage1_production_missing_input_checklist_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    nonClearingChecklist: true,
    canonicalPassPath: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    valueRedaction: "variable_names_only",
    sourceRefs: {},
    summary: {
      requiredTotal: 0,
      requiredConfigured: 0,
      requiredMissing: 0,
      requiredInvalid: 0,
      blockingInputCount: 0,
      requiredCompletionPercent: 0
    },
    groups: [],
    items: [],
    operatorNextActions: [`missing production missing-input checklist: ${sourcePath}`]
  };
}

function mapStage1ProductionMissingInputChecklistGroup(
  item: Record<string, unknown>
): Stage1ProductionMissingInputChecklist["groups"][number] {
  return {
    groupId: stringValue(item.group_id, "unknown"),
    title: stringValue(item.title, "unknown"),
    requiredTotal: numberValue(item.required_total, 0),
    requiredConfigured: numberValue(item.required_configured, 0),
    requiredMissing: numberValue(item.required_missing, 0),
    requiredInvalid: numberValue(item.required_invalid, 0),
    blockingInputCount: numberValue(item.blocking_input_count, 0),
    completionPercent: numberValue(item.completion_percent, 0),
    firstMissingRequiredInputs: stringArray(item.first_missing_required_inputs),
    invalidRequiredInputs: stringArray(item.invalid_required_inputs),
    operatorNextAction: stringValue(item.operator_next_action, "missing"),
    items: arrayOfRecords(item.items).map(mapStage1ProductionMissingInputChecklistItem)
  };
}

function mapStage1ProductionMissingInputChecklistItem(
  item: Record<string, unknown>
): Stage1ProductionMissingInputChecklist["items"][number] {
  const groupId = stringValue(item.group_id, "unknown");
  return {
    groupId,
    requirementId: stringValue(item.requirement_id, "unknown"),
    displayName: stringValue(item.display_name, "unknown"),
    status: stringValue(item.status, "missing"),
    acceptedVariableNames: stringArray(item.accepted_variable_names),
    configuredVariableName: item.configured_variable_name === null ? null : stringValue(item.configured_variable_name, "unknown"),
    acceptableEvidenceSource: stringValue(
      item.acceptable_evidence_source,
      PRODUCTION_MISSING_INPUT_ACCEPTABLE_EVIDENCE_SOURCE_FALLBACKS[groupId] ?? "missing"
    ),
    disallowedSubstitutes:
      stringArray(item.disallowed_substitutes).length > 0
        ? stringArray(item.disallowed_substitutes)
        : PRODUCTION_MISSING_INPUT_DISALLOWED_SUBSTITUTES,
    canBeSatisfiedByExistingSandboxOrStagingResources: booleanValue(
      item.can_be_satisfied_by_existing_sandbox_or_staging_resources,
      false
    ),
    operatorAction: stringValue(item.operator_action, "missing")
  };
}

function mapStage1ProductionDnsDetail(
  readiness: Record<string, unknown> | null,
  cutoverPlan: Record<string, unknown> | null,
  repairPacket: Record<string, unknown> | null,
  readinessPath: string,
  cutoverPlanPath: string,
  repairPacketPath: string
): Stage1ProductionDnsDetail {
  if (!readiness && !cutoverPlan && !repairPacket) {
    return missingStage1ProductionDnsDetail(readinessPath, cutoverPlanPath, repairPacketPath);
  }
  const readinessData = readiness ?? {};
  const cutoverData = cutoverPlan ?? {};
  const repairData = repairPacket ?? {};
  const readinessHttps = isRecord(readinessData.https_probe) ? readinessData.https_probe : {};
  const readinessSystemResolver = isRecord(readinessData.system_resolver) ? readinessData.system_resolver : {};
  const readinessAuthoritativeDns = isRecord(readinessData.authoritative_public_dns_probe)
    ? readinessData.authoritative_public_dns_probe
    : {};
  const currentRecords = isRecord(cutoverData.current_records) ? cutoverData.current_records : {};
  const cloudflareZone = isRecord(cutoverData.cloudflare_zone) ? cutoverData.cloudflare_zone : {};
  const target = isRecord(cutoverData.target) ? cutoverData.target : {};
  const evidenceOutputs = isRecord(cutoverData.evidence_outputs) ? cutoverData.evidence_outputs : {};

  return {
    schemaVersion: stringValue(
      readinessData.schema_version,
      stringValue(cutoverData.schema_version, "stage1.production_dns_detail.missing")
    ),
    kind: "stage1_production_dns_detail",
    readinessPath,
    cutoverPlanPath,
    readinessPresent: readiness !== null,
    cutoverPlanPresent: cutoverPlan !== null,
    status: stringValue(readinessData.status, stringValue(cutoverData.status, "missing")),
    cutoverStatus: stringValue(cutoverData.status, "missing"),
    releaseGateDecision: stringValue(
      readinessData.release_gate_decision,
      stringValue(cutoverData.release_gate_decision, "no_go")
    ),
    generatedAt: newestTimestamp(
      stringValue(readinessData.generated_at, "unknown"),
      stringValue(cutoverData.generated_at, "unknown")
    ),
    productionWebUrl: stringValue(
      readinessData.production_web_url,
      stringValue(cutoverData.production_web_url, "https://zenari.ai")
    ),
    stagingControlUrl: stringValue(readinessData.staging_control_url, "missing"),
    nonClearingCutoverPlan: booleanValue(cutoverData.non_clearing_cutover_plan, true),
    canonicalPassPath: booleanValue(readinessData.canonical_pass_path, booleanValue(cutoverData.canonical_pass_path, false)),
    canClearStage1ProductionLaunchGate: booleanValue(
      readinessData.can_clear_stage1_production_launch_gate,
      booleanValue(cutoverData.can_clear_stage1_production_launch_gate, false)
    ),
    canClearProductionLegalSupportPolicy: booleanValue(
      readinessData.can_clear_production_legal_support_policy,
      booleanValue(cutoverData.can_clear_production_legal_support_policy, false)
    ),
    canCloseDoNotLaunch: booleanValue(
      readinessData.can_close_do_not_launch,
      booleanValue(cutoverData.can_close_do_not_launch, false)
    ),
    dnsSplitBrainObserved: booleanValue(readinessData.dns_split_brain_observed, false),
    cloudflareZone: {
      zoneIdConfigured: booleanValue(cloudflareZone.zone_id_configured, false),
      apiTokenConfigured: booleanValue(cloudflareZone.api_token_configured, false),
      proxied: booleanValue(cloudflareZone.proxied, true)
    },
    target: {
      status: stringValue(target.status, "missing"),
      targetKind: stringValue(target.target_kind, "missing"),
      targetHint: stringValue(target.target_hint, "missing"),
      stagingControlCandidate: stringValue(target.staging_control_candidate, "missing")
    },
    requiredHosts: stringArray(cutoverData.required_hosts),
    blockedChecks: [...stringArray(readinessData.blocked_checks), ...stringArray(cutoverData.blocked_checks)],
    operatorNextActions: stringArray(cutoverData.operator_next_actions),
    currentRecords: mapStage1ProductionDnsProbeRecord(currentRecords),
    authoritativePublicDnsProbe: mapStage1ProductionDnsProbeRecord(readinessAuthoritativeDns),
    systemResolver: mapStage1ProductionDnsProbeRecord(readinessSystemResolver),
    httpsProbe: [
      ...arrayOfRecords(readinessHttps.production_paths).map((item, index) =>
        mapStage1ProductionDnsProbeRow(`production_path_${index + 1}`, item)
      ),
      ...(isRecord(readinessHttps.staging_control)
        ? [mapStage1ProductionDnsProbeRow("staging_control", readinessHttps.staging_control)]
        : [])
    ],
    applyResults: arrayOfRecords(cutoverData.apply_results).map((item, index) =>
      mapStage1ProductionDnsProbeRow(`apply_result_${index + 1}`, item)
    ),
    evidenceOutputs: {
      cutoverPlan: stringValue(evidenceOutputs.cutover_plan, cutoverPlanPath),
      dnsReadiness: stringValue(evidenceOutputs.dns_readiness, readinessPath),
      legalSupportOperatorPacket: stringValue(
        evidenceOutputs.legal_support_operator_packet,
        "ops/evidence/non_clearing/production-legal-support-operator-packet.json"
      ),
      dnsRepairPacket: repairPacketPath
    },
    repairPacket: mapStage1ProductionDnsRepairPacket(repairData, repairPacketPath, repairPacket !== null)
  };
}

function missingStage1ProductionDnsDetail(
  readinessPath: string,
  cutoverPlanPath: string,
  repairPacketPath: string
): Stage1ProductionDnsDetail {
  return {
    schemaVersion: "missing",
    kind: "stage1_production_dns_detail_missing",
    readinessPath,
    cutoverPlanPath,
    readinessPresent: false,
    cutoverPlanPresent: false,
    status: "missing",
    cutoverStatus: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    productionWebUrl: "https://zenari.ai",
    stagingControlUrl: "missing",
    nonClearingCutoverPlan: true,
    canonicalPassPath: false,
    canClearStage1ProductionLaunchGate: false,
    canClearProductionLegalSupportPolicy: false,
    canCloseDoNotLaunch: false,
    dnsSplitBrainObserved: false,
    cloudflareZone: {
      zoneIdConfigured: false,
      apiTokenConfigured: false,
      proxied: true
    },
    target: {
      status: "missing",
      targetKind: "missing",
      targetHint: "missing",
      stagingControlCandidate: "missing"
    },
    requiredHosts: [],
    blockedChecks: [`missing production DNS readiness evidence: ${readinessPath}`, `missing production DNS cutover plan: ${cutoverPlanPath}`],
    operatorNextActions: [],
    currentRecords: [],
    authoritativePublicDnsProbe: [],
    systemResolver: [],
    httpsProbe: [],
    applyResults: [],
    evidenceOutputs: {
      cutoverPlan: cutoverPlanPath,
      dnsReadiness: readinessPath,
      legalSupportOperatorPacket: "ops/evidence/non_clearing/production-legal-support-operator-packet.json",
      dnsRepairPacket: repairPacketPath
    },
    repairPacket: mapStage1ProductionDnsRepairPacket({}, repairPacketPath, false)
  };
}

function mapStage1ProductionDnsRepairPacket(
  data: Record<string, unknown>,
  sourcePath: string,
  evidencePresent: boolean
): Stage1ProductionDnsDetail["repairPacket"] {
  const summary = isRecord(data.summary) ? data.summary : {};
  const privateEnvTemplate = isRecord(data.private_env_template) ? data.private_env_template : {};
  return {
    sourcePath,
    evidencePresent,
    schemaVersion: stringValue(data.schema_version, "missing"),
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    nonClearingRepairPacket: booleanValue(data.non_clearing_repair_packet, true),
    canApplyDnsChanges: booleanValue(data.can_apply_dns_changes, false),
    summary: {
      dnsBlockerCount: numberValue(summary.dns_blocker_count, 0),
      requiredInputCount: numberValue(summary.required_input_count, 0),
      productionSystemResolverStatus: stringValue(summary.production_system_resolver_status, "missing"),
      stagingControlResolverStatus: stringValue(summary.staging_control_resolver_status, "missing"),
      productionAStatus: stringValue(summary.production_a_status, "missing"),
      productionAaaaStatus: stringValue(summary.production_aaaa_status, "missing"),
      stagingAStatus: stringValue(summary.staging_a_status, "missing"),
      cloudflareZoneIdConfigured: booleanValue(summary.cloudflare_zone_id_configured, false),
      cloudflareApiTokenConfigured: booleanValue(summary.cloudflare_api_token_configured, false),
      productionDnsTargetStatus: stringValue(summary.production_dns_target_status, "missing"),
      sourceRunbookStepId: stringValue(summary.source_runbook_step_id, "production_dns_https"),
      sourceRunbookBlockingInputCount: numberValue(summary.source_runbook_blocking_input_count, 0)
    },
    recommendedRecords: arrayOfRecords(data.recommended_records).map(mapStage1ProductionDnsRecommendedRecord),
    cloudflareUiSteps: stringArray(data.cloudflare_ui_steps),
    cloudflareApiPlan: stringArray(data.cloudflare_api_plan),
    privateEnvTemplate: {
      pathPlaceholder: stringValue(privateEnvTemplate.path_placeholder, "<private-production-env>"),
      gitignoreRequired: booleanValue(privateEnvTemplate.gitignore_required, true),
      blankValuesOnly: booleanValue(privateEnvTemplate.blank_values_only, true),
      allowedVariableNames: stringArray(privateEnvTemplate.allowed_variable_names),
      templateLines: stringArray(privateEnvTemplate.template_lines)
    },
    verificationCommands: stringArray(data.verification_commands),
    requiredInputs: stringArray(data.required_inputs),
    blockedChecks: stringArray(data.blocked_checks),
    commandsAfterInputs: stringArray(data.commands_after_inputs),
    operatorCommandPacket: arrayOfRecords(data.operator_command_packet).map(mapStage1ProductionDnsOperatorCommand),
    operatorNextActions: stringArray(data.operator_next_actions)
  };
}

function mapStage1ProductionDnsRecommendedRecord(
  item: Record<string, unknown>
): Stage1ProductionDnsDetail["repairPacket"]["recommendedRecords"][number] {
  return {
    host: stringValue(item.host, "missing"),
    type: stringValue(item.type, "missing"),
    name: stringValue(item.name, "missing"),
    content: stringValue(item.content, "missing"),
    proxied: booleanValue(item.proxied, true),
    ttl: stringValue(item.ttl, "auto"),
    requiredWhen: stringValue(item.required_when, "missing"),
    currentStatus: stringValue(item.current_status, "missing")
  };
}

function mapStage1ProductionDnsOperatorCommand(
  item: Record<string, unknown>
): Stage1ProductionDnsDetail["repairPacket"]["operatorCommandPacket"][number] {
  return {
    stepId: stringValue(item.step_id, "missing"),
    command: stringValue(item.command, "missing"),
    sideEffect: stringValue(item.side_effect, "missing"),
    mayWriteDns: booleanValue(item.may_write_dns, false),
    requiresReview: booleanValue(item.requires_review, false)
  };
}

function mapStage1ProductionDnsProbeRecord(value: Record<string, unknown>): Stage1ProductionDnsDetail["currentRecords"] {
  return Object.entries(value).map(([probeId, item]) =>
    mapStage1ProductionDnsProbeRow(probeId, isRecord(item) ? item : {})
  );
}

function mapStage1ProductionDnsProbeRow(
  probeId: string,
  item: Record<string, unknown>
): Stage1ProductionDnsDetail["currentRecords"][number] {
  return {
    probeId,
    status: stringValue(item.status, "missing"),
    host: stringValue(item.host, "missing"),
    rrtype: stringValue(item.rrtype, "n/a"),
    addresses: stringArray(item.addresses),
    records: stringArray(item.records),
    httpStatus: typeof item.http_status === "number" && Number.isFinite(item.http_status) ? item.http_status : null,
    url: stringValue(item.url, "missing"),
    error: stringValue(item.error, "")
  };
}

function mapStage1ProductionLaunchInputPacket(
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1ProductionLaunchInputPacket {
  if (!data) {
    return missingStage1ProductionLaunchInputPacket(sourcePath);
  }
  const dnsReadiness = isRecord(data.production_dns_readiness) ? data.production_dns_readiness : {};
  const proofBundle = isRecord(data.proof_bundle) ? data.proof_bundle : {};
  const proofSummary = isRecord(proofBundle.summary) ? proofBundle.summary : {};
  const coverage = isRecord(proofSummary.input_variable_coverage) ? proofSummary.input_variable_coverage : {};
  const envGroups = isRecord(proofBundle.required_env_variable_groups) ? proofBundle.required_env_variable_groups : {};
  const executionOrder = isRecord(data.execution_order) ? data.execution_order : {};
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_launch_input_packet"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    nonClearingInputPacket: booleanValue(data.non_clearing_input_packet, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    productionDnsReadinessStatus: stringValue(dnsReadiness.status, "missing"),
    productionDnsReadinessPath: stringValue(dnsReadiness.path, "missing"),
    productionDnsReadinessFirstBlocker: stringValue(dnsReadiness.first_blocker, "missing"),
    proofBundlePath: stringValue(proofSummary.path, "missing"),
    proofBundleStatus: stringValue(proofSummary.status, "missing"),
    proofBundleReleaseGateDecision: stringValue(proofSummary.release_gate_decision, "no_go"),
    proofBundleCanonicalSourcesRequested: booleanValue(proofSummary.canonical_sources_requested, false),
    proofBundlePipelineStatus: stringValue(proofSummary.pipeline_status, "missing"),
    proofBundleFirstBlockers: stringArray(proofSummary.first_blockers),
    proofInputCoverage: mapStage1ProductionProofInputCoverage(coverage),
    requiredEnvVariableGroups: Object.entries(envGroups).map(([groupId, value]) => ({
      groupId,
      variables: stringArray(value)
    })),
    sourceInputs: arrayOfRecords(data.source_inputs).map(mapStage1ProductionLaunchInputPacketSourceInput),
    executionOrder: Object.entries(executionOrder).map(([groupId, value]) => ({
      groupId,
      commands: stringArray(value)
    })),
    missingVariables: stringArray(data.missing_variables),
    canonicalWritePolicy: stringValue(proofBundle.canonical_write_policy, "Use canonical writes only after real production inputs pass.")
  };
}

function missingStage1ProductionLaunchInputPacket(sourcePath: string): Stage1ProductionLaunchInputPacket {
  return {
    schemaVersion: "missing",
    kind: "stage1_production_launch_input_packet_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    nonClearingInputPacket: true,
    canonicalPassPath: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    productionDnsReadinessStatus: "missing",
    productionDnsReadinessPath: "missing",
    productionDnsReadinessFirstBlocker: `missing production launch input packet: ${sourcePath}`,
    proofBundlePath: "missing",
    proofBundleStatus: "missing",
    proofBundleReleaseGateDecision: "no_go",
    proofBundleCanonicalSourcesRequested: false,
    proofBundlePipelineStatus: "missing",
    proofBundleFirstBlockers: [],
    proofInputCoverage: mapStage1ProductionProofInputCoverage({}),
    requiredEnvVariableGroups: [],
    sourceInputs: [],
    executionOrder: [],
    missingVariables: [],
    canonicalWritePolicy: "Use canonical writes only after real production inputs pass."
  };
}

function mapStage1ProductionLaunchInputPacketSourceInput(
  item: Record<string, unknown>
): Stage1ProductionLaunchInputPacket["sourceInputs"][number] {
  return {
    probeId: stringValue(item.probe_id, "unknown"),
    status: stringValue(item.status, "missing"),
    sourceProbeExists: booleanValue(item.source_probe_exists, false),
    sourcePath: stringValue(item.source_path, "missing"),
    sourceSchemaVersion: stringValue(item.source_schema_version, "missing"),
    diagnosticPath: stringValue(item.diagnostic_path, "missing"),
    missingInput: stringValue(item.missing_input, "missing"),
    firstBlocker: stringValue(item.first_blocker, "missing"),
    currentBlocker: stringValue(item.current_blocker, "missing"),
    proofTemplateRef: typeof item.proof_template_ref === "string" && item.proof_template_ref.length > 0 ? item.proof_template_ref : null,
    sourceTemplateRef: stringValue(item.source_template_ref, "missing"),
    sourceProbeCommand: stringValue(item.source_probe_command, "missing"),
    evidenceGenerator: stringValue(item.evidence_generator, "missing"),
    strictValidator: stringValue(item.strict_validator, "missing"),
    supportingDiagnostics: stringArray(item.supporting_diagnostics)
  };
}

function mapStage1ProductionLaunchSourcePipeline(
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1ProductionLaunchSourcePipeline {
  if (!data) {
    return missingStage1ProductionLaunchSourcePipeline(sourcePath);
  }
  const gateImpact = isRecord(data.gate_impact) ? data.gate_impact : {};
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_launch_source_pipeline"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    releaseSha: stringValue(data.release_sha, "missing"),
    productionWebUrl: stringValue(data.production_web_url, "missing"),
    nonClearingPipelineSummary: booleanValue(data.non_clearing_pipeline_summary, true),
    canonicalSourcesRequested: booleanValue(data.canonical_sources_requested, false),
    canonicalSourcesMayBeWritten: booleanValue(data.canonical_sources_may_be_written, false),
    aggregateAttempted: booleanValue(data.aggregate_attempted, false),
    canClearStage1ProductionLaunchGate: booleanValue(gateImpact.can_clear_stage1_production_launch_gate, false),
    preservedDoNotLaunchCondition: stringValue(gateImpact.preserved_do_not_launch_condition, "missing"),
    strictValidator: stringValue(gateImpact.requires_strict_validator, "python3 scripts/validate_stage1_production_launch.py"),
    blockedChecks: stringArray(data.blocked_checks),
    proofReadiness: arrayOfRecords(data.proof_readiness).map(mapStage1ProductionLaunchSourcePipelineProofReadiness),
    steps: arrayOfRecords(data.steps).map(mapStage1ProductionLaunchSourcePipelineStep)
  };
}

function missingStage1ProductionLaunchSourcePipeline(sourcePath: string): Stage1ProductionLaunchSourcePipeline {
  return {
    schemaVersion: "missing",
    kind: "stage1_production_launch_source_pipeline_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    releaseSha: "missing",
    productionWebUrl: "missing",
    nonClearingPipelineSummary: true,
    canonicalSourcesRequested: false,
    canonicalSourcesMayBeWritten: false,
    aggregateAttempted: false,
    canClearStage1ProductionLaunchGate: false,
    preservedDoNotLaunchCondition: "stage1_production_launch_evidence_incomplete",
    strictValidator: "python3 scripts/validate_stage1_production_launch.py",
    blockedChecks: [`missing production launch source pipeline: ${sourcePath}`],
    proofReadiness: [],
    steps: []
  };
}

function mapStage1ProductionLaunchSourcePipelineProofReadiness(
  item: Record<string, unknown>
): Stage1ProductionLaunchSourcePipeline["proofReadiness"][number] {
  return {
    proofId: stringValue(item.proof_id, "unknown"),
    path: stringValue(item.path, "missing"),
    exists: booleanValue(item.exists, false),
    required: booleanValue(item.required, true)
  };
}

function mapStage1ProductionLaunchSourcePipelineStep(
  item: Record<string, unknown>
): Stage1ProductionLaunchSourcePipeline["steps"][number] {
  return {
    stepId: stringValue(item.step_id, "unknown"),
    status: stringValue(item.status, "missing"),
    exitCode: numberValue(item.exit_code, -1),
    expectedExit: booleanValue(item.expected_exit, false),
    command: stringValue(item.command, "missing"),
    outputSummary: stringValue(item.output_summary, "missing")
  };
}

function mapStage1ProductionSourceProbeRunbook(
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1ProductionSourceProbeRunbook {
  if (!data) {
    return missingStage1ProductionSourceProbeRunbook(sourcePath);
  }
  const summary = isRecord(data.summary) ? data.summary : {};
  const pipelineState = isRecord(data.pipeline_state) ? data.pipeline_state : {};
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_source_probe_runbook"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    nonClearingRunbook: booleanValue(data.non_clearing_runbook, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    valueRedaction: stringValue(data.value_redaction, "variable_names_only"),
    sourceRefs: stringRecord(data.source_refs),
    summary: {
      runbookStepCount: numberValue(summary.runbook_step_count, 0),
      readyToExecuteCount: numberValue(summary.ready_to_execute_count, 0),
      blockedStepCount: numberValue(summary.blocked_step_count, 0),
      blockingInputCount: numberValue(summary.blocking_input_count, 0),
      productionInputsConfigured: numberValue(summary.production_inputs_configured, 0),
      productionInputsTotal: numberValue(summary.production_inputs_total, 0),
      productionInputsMissing: numberValue(summary.production_inputs_missing, 0),
      productionInputsInvalid: numberValue(summary.production_inputs_invalid, 0),
      productionInputsCompletionPercent: numberValue(summary.production_inputs_completion_percent, 0),
      stage1GatesCompleted: numberValue(summary.stage1_gates_completed, 0),
      stage1GatesTotal: numberValue(summary.stage1_gates_total, 0),
      stage1CompletionPercent: numberValue(summary.stage1_completion_percent, 0)
    },
    pipelineState: {
      status: stringValue(pipelineState.status, "missing"),
      releaseGateDecision: stringValue(pipelineState.release_gate_decision, "no_go"),
      canonicalSourcesRequested: booleanValue(pipelineState.canonical_sources_requested, false),
      canonicalSourcesMayBeWritten: booleanValue(pipelineState.canonical_sources_may_be_written, false),
      aggregateAttempted: booleanValue(pipelineState.aggregate_attempted, false),
      blockedChecks: stringArray(pipelineState.blocked_checks)
    },
    steps: arrayOfRecords(data.steps).map(mapStage1ProductionSourceProbeRunbookStep),
    operatorNextActions: stringArray(data.operator_next_actions)
  };
}

function missingStage1ProductionSourceProbeRunbook(sourcePath: string): Stage1ProductionSourceProbeRunbook {
  return {
    schemaVersion: "missing",
    kind: "stage1_production_source_probe_runbook_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    nonClearingRunbook: true,
    canonicalPassPath: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    valueRedaction: "variable_names_only",
    sourceRefs: {},
    summary: {
      runbookStepCount: 0,
      readyToExecuteCount: 0,
      blockedStepCount: 0,
      blockingInputCount: 0,
      productionInputsConfigured: 0,
      productionInputsTotal: 0,
      productionInputsMissing: 0,
      productionInputsInvalid: 0,
      productionInputsCompletionPercent: 0,
      stage1GatesCompleted: 0,
      stage1GatesTotal: 0,
      stage1CompletionPercent: 0
    },
    pipelineState: {
      status: "missing",
      releaseGateDecision: "no_go",
      canonicalSourcesRequested: false,
      canonicalSourcesMayBeWritten: false,
      aggregateAttempted: false,
      blockedChecks: [`missing production source probe runbook: ${sourcePath}`]
    },
    steps: [],
    operatorNextActions: [`missing production source probe runbook: ${sourcePath}`]
  };
}

function mapStage1ProductionSourceProbeRunbookStep(
  item: Record<string, unknown>
): Stage1ProductionSourceProbeRunbook["steps"][number] {
  return {
    stepId: stringValue(item.step_id, "unknown"),
    order: numberValue(item.order, 0),
    coverageGroup: stringValue(item.coverage_group, "unknown"),
    probeId: stringValue(item.probe_id, "unknown"),
    gateIds: stringArray(item.gate_ids),
    status: stringValue(item.status, "missing"),
    readyToExecute: booleanValue(item.ready_to_execute, false),
    blockingInputCount: numberValue(item.blocking_input_count, 0),
    requiredTotal: numberValue(item.required_total, 0),
    requiredConfigured: numberValue(item.required_configured, 0),
    completionPercent: numberValue(item.completion_percent, 0),
    requiredBefore: stringArray(item.required_before),
    sourceProbeCommand: stringValue(item.source_probe_command, "missing"),
    sourceOutputPath: stringValue(item.source_output_path, "missing"),
    diagnosticPath: stringValue(item.diagnostic_path, "missing"),
    strictValidator: stringValue(item.strict_validator, "missing"),
    evidenceGenerator: stringValue(item.evidence_generator, "missing"),
    operatorPacketRef: stringValue(item.operator_packet_ref, "missing"),
    sourceTemplateRef: item.source_template_ref === null ? null : stringValue(item.source_template_ref, "missing"),
    proofTemplateRef: item.proof_template_ref === null ? null : stringValue(item.proof_template_ref, "missing"),
    firstBlocker: stringValue(item.first_blocker, "missing"),
    missingOrInvalidInputs: stringArray(item.missing_or_invalid_inputs),
    acceptableEvidenceSources: stringArray(item.acceptable_evidence_sources),
    disallowedSubstitutes: stringArray(item.disallowed_substitutes),
    canBeSatisfiedByExistingSandboxOrStagingResources: booleanValue(
      item.can_be_satisfied_by_existing_sandbox_or_staging_resources,
      false
    ),
    blockedUntil: stringArray(item.blocked_until),
    operatorNextAction: stringValue(item.operator_next_action, "missing")
  };
}

function mapStage1ProductionNonClearingRefresh(
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1ProductionNonClearingRefresh {
  if (!data) {
    return missingStage1ProductionNonClearingRefresh(sourcePath);
  }
  const stepSummary = isRecord(data.step_summary) ? data.step_summary : {};
  const progress = isRecord(data.progress) ? data.progress : {};
  const gateImpact = isRecord(data.gate_impact) ? data.gate_impact : {};
  return {
    sourcePath,
    evidencePresent: true,
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_non_clearing_refresh"),
    environment: stringValue(data.environment, "production"),
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    productionWebUrl: stringValue(data.production_web_url, "missing"),
    stagingWebUrl: stringValue(data.staging_web_url, "missing"),
    envFile: stringValue(data.env_file, ".env"),
    nonClearingRefresh: booleanValue(data.non_clearing_refresh, true),
    canonicalSourcesRequested: booleanValue(data.canonical_sources_requested, false),
    dnsApplyRequested: booleanValue(data.dns_apply_requested, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    stepSummary: {
      total: numberValue(stepSummary.total, 0),
      passed: numberValue(stepSummary.passed, 0),
      blocked: numberValue(stepSummary.blocked, 0),
      failed: numberValue(stepSummary.failed, 0),
      unexpectedExitCount: numberValue(stepSummary.unexpected_exit_count, 0)
    },
    progress: mapStage1ProductionNonClearingRefreshProgress(progress),
    steps: arrayOfRecords(data.steps).map(mapStage1ProductionNonClearingRefreshStep),
    blockedChecks: stringArray(data.blocked_checks),
    outputRefs: stringRecord(data.output_refs),
    nonClearingEvidenceOnly: booleanValue(gateImpact.non_clearing_evidence_only, true),
    preservedDoNotLaunchCondition: stringValue(gateImpact.preserved_do_not_launch_condition, "stage1_production_launch_evidence_incomplete"),
    canonicalSourceWriteCommand: stringValue(
      gateImpact.canonical_source_write_command,
      "python3 scripts/run_stage1_production_proof_bundle.py --write-canonical-sources"
    ),
    strictLaunchValidator: stringValue(gateImpact.strict_launch_validator, "python3 scripts/validate_stage1_production_launch.py"),
    generatorCommand: "python3 scripts/refresh_stage1_production_non_clearing_evidence.py",
    validatorCommand: "python3 scripts/validate_stage1_production_non_clearing_refresh.py"
  };
}

function missingStage1ProductionNonClearingRefresh(sourcePath: string): Stage1ProductionNonClearingRefresh {
  return {
    sourcePath,
    evidencePresent: false,
    schemaVersion: "missing",
    kind: "stage1_production_non_clearing_refresh_missing",
    environment: "production",
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    productionWebUrl: "https://zenari.ai",
    stagingWebUrl: "https://staging.zenari.ai",
    envFile: ".env",
    nonClearingRefresh: true,
    canonicalSourcesRequested: false,
    dnsApplyRequested: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    stepSummary: {
      total: 0,
      passed: 0,
      blocked: 0,
      failed: 0,
      unexpectedExitCount: 0
    },
    progress: mapStage1ProductionNonClearingRefreshProgress({}),
    steps: [],
    blockedChecks: [`missing production non-clearing refresh summary: ${sourcePath}`],
    outputRefs: {},
    nonClearingEvidenceOnly: true,
    preservedDoNotLaunchCondition: "stage1_production_launch_evidence_incomplete",
    canonicalSourceWriteCommand: "python3 scripts/run_stage1_production_proof_bundle.py --write-canonical-sources",
    strictLaunchValidator: "python3 scripts/validate_stage1_production_launch.py",
    generatorCommand: "python3 scripts/refresh_stage1_production_non_clearing_evidence.py",
    validatorCommand: "python3 scripts/validate_stage1_production_non_clearing_refresh.py"
  };
}

function mapStage1ProductionNonClearingRefreshProgress(
  progress: Record<string, unknown>
): Stage1ProductionNonClearingRefresh["progress"] {
  const stage1 = isRecord(progress.stage1) ? progress.stage1 : {};
  const externalResources = isRecord(progress.external_resources) ? progress.external_resources : {};
  const productionInputs = isRecord(progress.production_inputs) ? progress.production_inputs : {};
  const productionSourceProbes = isRecord(progress.production_source_probes) ? progress.production_source_probes : {};
  return {
    stage1: {
      completed: numberValue(stage1.completed, 0),
      total: numberValue(stage1.total, 0),
      completionPercent: numberValue(stage1.completion_percent, 0),
      releaseGateDecision: stringValue(stage1.release_gate_decision, "no_go")
    },
    externalResources: {
      ready: numberValue(externalResources.ready, 0),
      total: numberValue(externalResources.total, 0),
      readyPercent: numberValue(externalResources.ready_percent, 0)
    },
    productionInputs: {
      configured: numberValue(productionInputs.configured, 0),
      total: numberValue(productionInputs.total, 0),
      completionPercent: numberValue(productionInputs.completion_percent, 0),
      missing: numberValue(productionInputs.missing, 0),
      invalid: numberValue(productionInputs.invalid, 0),
      blockingInputCount: numberValue(productionInputs.blocking_input_count, 0)
    },
    productionSourceProbes: {
      ready: numberValue(productionSourceProbes.ready, 0),
      total: numberValue(productionSourceProbes.total, 0),
      blocked: numberValue(productionSourceProbes.blocked, 0),
      blockingInputCount: numberValue(productionSourceProbes.blocking_input_count, 0)
    },
    productionActionLanes: arrayOfRecords(progress.production_action_lanes).map((lane) => ({
      laneId: stringValue(lane.lane_id, "unknown"),
      blockingInputCount: numberValue(lane.blocking_input_count, 0),
      completionPercent: numberValue(lane.completion_percent, 0),
      firstBlocker: stringValue(lane.first_blocker, "not reported")
    }))
  };
}

function mapStage1ProductionNonClearingRefreshStep(
  item: Record<string, unknown>
): Stage1ProductionNonClearingRefresh["steps"][number] {
  return {
    stepId: stringValue(item.step_id, "unknown"),
    status: stringValue(item.status, "missing"),
    exitCode: numberValue(item.exit_code, -1),
    expectedExit: booleanValue(item.expected_exit, false),
    command: stringValue(item.command, "missing"),
    outputSummary: stringValue(item.output_summary, "missing")
  };
}

function mapStage1NextBlockersSummary(data: Record<string, unknown> | null, sourcePath: string): Stage1NextBlockersSummary {
  if (!data) {
    return missingStage1NextBlockersSummary(sourcePath);
  }
  const stage1 = isRecord(data.stage1) ? data.stage1 : {};
  const productionInputs = isRecord(data.production_inputs) ? data.production_inputs : {};
  const productionSourceProbes = isRecord(data.production_source_probes) ? data.production_source_probes : {};
  const nonClearingRefresh = isRecord(data.non_clearing_refresh) ? data.non_clearing_refresh : {};
  const azureOrigin = isRecord(data.azure_origin) ? data.azure_origin : {};
  const diagnosis = isRecord(data.azure_run_command_diagnosis) ? data.azure_run_command_diagnosis : {};
  const action = isRecord(data.top_priority_action) ? data.top_priority_action : {};
  return {
    sourcePath,
    evidencePresent: true,
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_next_blockers_summary"),
    environment: stringValue(data.environment, "non_clearing"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1StagingRuntimeGate: booleanValue(data.can_clear_stage1_staging_runtime_gate, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    stage1: {
      completed: numberValue(stage1.completed, 0),
      total: numberValue(stage1.total, 0),
      completionPercent: numberValue(stage1.completion_percent, 0),
      open: numberValue(stage1.open, 0),
      openGates: stringArray(stage1.open_gates)
    },
    productionInputs: {
      configured: numberValue(productionInputs.configured, 0),
      total: numberValue(productionInputs.total, 0),
      completionPercent: numberValue(productionInputs.completion_percent, 0),
      missing: numberValue(productionInputs.missing, 0),
      invalid: numberValue(productionInputs.invalid, 0),
      blockingInputCount: numberValue(productionInputs.blocking_input_count, 0)
    },
    productionSourceProbes: {
      ready: numberValue(productionSourceProbes.ready, 0),
      total: numberValue(productionSourceProbes.total, 0),
      blocked: numberValue(productionSourceProbes.blocked, 0),
      blockingInputCount: numberValue(productionSourceProbes.blocking_input_count, 0)
    },
    nonClearingRefresh: {
      passed: numberValue(nonClearingRefresh.passed, 0),
      total: numberValue(nonClearingRefresh.total, 0),
      blocked: numberValue(nonClearingRefresh.blocked, 0),
      failed: numberValue(nonClearingRefresh.failed, 0)
    },
    azureOrigin: {
      status: stringValue(azureOrigin.status, "missing"),
      releaseGateDecision: stringValue(azureOrigin.release_gate_decision, "no_go"),
      blockedChecks: stringArray(azureOrigin.blocked_checks),
      httpPassed: numberValue(azureOrigin.http_passed, 0),
      httpTotal: numberValue(azureOrigin.http_total, 0),
      httpFailureCategories: stringArray(azureOrigin.http_failure_categories),
      tcpPassed: numberValue(azureOrigin.tcp_passed, 0),
      tcpTotal: numberValue(azureOrigin.tcp_total, 0),
      sshStatus: stringValue(azureOrigin.ssh_status, "missing"),
      sshReason: stringValue(azureOrigin.ssh_reason, "missing"),
      azureCliStatus: stringValue(azureOrigin.azure_cli_status, "missing"),
      azureCliReason: stringValue(azureOrigin.azure_cli_reason, "missing"),
      transportLane: stringValue(azureOrigin.transport_lane, "missing"),
      transportNextAction: stringValue(azureOrigin.transport_next_action, "missing"),
      transportSummary: stringValue(azureOrigin.transport_summary, "missing"),
      transportBlockedReasons: stringArray(azureOrigin.transport_blocked_reasons),
      sshTransportPhase: stringValue(azureOrigin.ssh_transport_phase, "missing"),
      sshPasswordKeyRepairViable: booleanValue(azureOrigin.ssh_password_key_repair_viable, false),
      azurePortalRunCommandRequired: booleanValue(azureOrigin.azure_portal_run_command_required, false),
      httpResponseStarted: booleanValue(azureOrigin.http_response_started, false),
      repairCommandCount: numberValue(azureOrigin.repair_command_count, 0),
      repairCommands: stringArray(azureOrigin.repair_commands)
    },
    azureRunCommandDiagnosis: {
      status: stringValue(diagnosis.status, "missing"),
      sourceStatus: stringValue(diagnosis.source_status, stringValue(diagnosis.status, "missing")),
      supersededBy: stringValue(diagnosis.superseded_by, "none"),
      findings: stringArray(diagnosis.findings),
      sourceFindings: stringArray(diagnosis.source_findings),
      sshRepairStatus: stringValue(diagnosis.ssh_repair_status, "missing"),
      originRuntimeStatus: stringValue(diagnosis.origin_runtime_status, "missing"),
      nextRepairLane: stringValue(diagnosis.next_repair_lane, "unknown"),
      inputPresent: booleanValue(diagnosis.input_present, false),
      rawOutputPersisted: booleanValue(diagnosis.raw_output_persisted, false),
      originSummary: stringRecord(diagnosis.origin_summary),
      outputPath: stringValue(diagnosis.output_path, "ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json")
    },
    productionLanes: arrayOfRecords(data.production_lanes).map(mapStage1NextBlockersProductionLane),
    operatorShortlist: arrayOfRecords(data.operator_shortlist).map(mapStage1NextBlockersOperatorShortlistItem),
    operatorActionPacket: arrayOfRecords(data.operator_action_packet).map(mapStage1NextBlockersOperatorActionPacketItem),
    topPriorityAction: {
      actionId: stringValue(action.action_id, "missing"),
      lane: stringValue(action.lane, "unknown"),
      status: stringValue(action.status, "blocked"),
      why: stringValue(action.why, "next blocker summary did not report a reason"),
      command: stringValue(action.command, "python3 scripts/generate_stage1_next_blockers_summary.py"),
      requiresExternalInput: booleanValue(action.requires_external_input, true),
      externalInput: stringValue(action.external_input, "missing external input")
    },
    evidenceRefs: stringRecord(data.evidence_refs),
    secretMaterialPersisted: booleanValue(data.secret_material_persisted, false),
    rawPromptPersisted: booleanValue(data.raw_prompt_persisted, false),
    rawProviderPayloadPersisted: booleanValue(data.raw_provider_payload_persisted, false),
    rawStripePayloadPersisted: booleanValue(data.raw_stripe_payload_persisted, false),
    rawSupportBodyProjected: booleanValue(data.raw_support_body_projected, false),
    signedUrlPersisted: booleanValue(data.signed_url_persisted, false),
    authorizationHeaderPersisted: booleanValue(data.authorization_header_persisted, false),
    cookiePersisted: booleanValue(data.cookie_persisted, false),
    rawRunCommandOutputPersisted: booleanValue(data.raw_run_command_output_persisted, false)
  };
}

function missingStage1NextBlockersSummary(sourcePath: string): Stage1NextBlockersSummary {
  return {
    sourcePath,
    evidencePresent: false,
    schemaVersion: "missing",
    kind: "stage1_next_blockers_summary_missing",
    environment: "non_clearing",
    generatedAt: "unknown",
    status: "missing",
    releaseGateDecision: "no_go",
    canonicalPassPath: false,
    canClearStage1StagingRuntimeGate: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    stage1: {
      completed: 0,
      total: 14,
      completionPercent: 0,
      open: 14,
      openGates: []
    },
    productionInputs: {
      configured: 0,
      total: 60,
      completionPercent: 0,
      missing: 60,
      invalid: 0,
      blockingInputCount: 60
    },
    productionSourceProbes: {
      ready: 0,
      total: 4,
      blocked: 4,
      blockingInputCount: 60
    },
    nonClearingRefresh: {
      passed: 0,
      total: 0,
      blocked: 0,
      failed: 0
    },
    azureOrigin: {
      status: "missing",
      releaseGateDecision: "no_go",
      blockedChecks: [`missing Stage 1 next blockers summary: ${sourcePath}`],
      httpPassed: 0,
      httpTotal: 0,
      httpFailureCategories: [],
      tcpPassed: 0,
      tcpTotal: 0,
      sshStatus: "missing",
      sshReason: "missing",
      azureCliStatus: "missing",
      azureCliReason: "missing",
      transportLane: "missing",
      transportNextAction: "missing",
      transportSummary: `missing Stage 1 next blockers summary: ${sourcePath}`,
      transportBlockedReasons: [`missing Stage 1 next blockers summary: ${sourcePath}`],
      sshTransportPhase: "missing",
      sshPasswordKeyRepairViable: false,
      azurePortalRunCommandRequired: false,
      httpResponseStarted: false,
      repairCommandCount: 0,
      repairCommands: []
    },
    azureRunCommandDiagnosis: {
      status: "missing",
      sourceStatus: "missing",
      supersededBy: "none",
      findings: ["missing_summary"],
      sourceFindings: ["missing_summary"],
      sshRepairStatus: "missing",
      originRuntimeStatus: "missing",
      nextRepairLane: "unknown",
      inputPresent: false,
      rawOutputPersisted: false,
      originSummary: {},
      outputPath: "ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json"
    },
    productionLanes: [],
    operatorShortlist: [],
    operatorActionPacket: [],
    topPriorityAction: {
      actionId: "stage1_next_blockers_summary_missing",
      lane: "release_readiness",
      status: "blocked",
      why: `missing Stage 1 next blockers summary: ${sourcePath}`,
      command: "python3 scripts/generate_stage1_next_blockers_summary.py || test $? -eq 2",
      requiresExternalInput: false,
      externalInput: "none"
    },
    evidenceRefs: {},
    secretMaterialPersisted: false,
    rawPromptPersisted: false,
    rawProviderPayloadPersisted: false,
    rawStripePayloadPersisted: false,
    rawSupportBodyProjected: false,
    signedUrlPersisted: false,
    authorizationHeaderPersisted: false,
    cookiePersisted: false,
    rawRunCommandOutputPersisted: false
  };
}

function mapStage1NextBlockersProductionLane(item: Record<string, unknown>): Stage1NextBlockersSummary["productionLanes"][number] {
  return {
    laneId: stringValue(item.lane_id, "unknown"),
    blockingInputCount: numberValue(item.blocking_input_count, 0),
    completionPercent: numberValue(item.completion_percent, 0),
    firstBlocker: stringValue(item.first_blocker, "not reported")
  };
}

function mapStage1NextBlockersOperatorShortlistItem(
  item: Record<string, unknown>
): Stage1NextBlockersSummary["operatorShortlist"][number] {
  return {
    order: numberValue(item.order, 0),
    itemId: stringValue(item.item_id, "unknown"),
    lane: stringValue(item.lane, "unknown"),
    status: stringValue(item.status, "blocked"),
    requiresExternalInput: booleanValue(item.requires_external_input, true),
    currentBlocker: stringValue(item.current_blocker, "not reported"),
    operatorAction: stringValue(item.operator_action, "not reported"),
    agentActionAfterInput: stringValue(item.agent_action_after_input, "not reported"),
    command: stringValue(item.command, "not reported"),
    evidenceRef: stringValue(item.evidence_ref, "not reported"),
    gateImpact: stringValue(item.gate_impact, "non_clearing_operator_shortlist_only"),
    canClearStage1StagingRuntimeGate: booleanValue(item.can_clear_stage1_staging_runtime_gate, false),
    canClearStage1ProductionLaunchGate: booleanValue(item.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(item.can_close_do_not_launch, false)
  };
}

function mapStage1NextBlockersOperatorActionPacketItem(
  item: Record<string, unknown>
): Stage1NextBlockersSummary["operatorActionPacket"][number] {
  return {
    order: numberValue(item.order, 0),
    itemId: stringValue(item.item_id, "unknown"),
    owner: stringValue(item.owner, "unknown"),
    status: stringValue(item.status, "blocked"),
    requiresExternalInput: booleanValue(item.requires_external_input, true),
    requiredReturnArtifact: stringValue(item.required_return_artifact, "not reported"),
    agentCommandAfterReturn: stringValue(item.agent_command_after_return, "not reported"),
    validationAfterReturn: stringValue(item.validation_after_return, "not reported"),
    blindHandoffNote: stringValue(item.blind_handoff_note, "not reported"),
    evidenceRef: stringValue(item.evidence_ref, "not reported"),
    gateImpact: stringValue(item.gate_impact, "non_clearing_operator_shortlist_only"),
    canClearStage1StagingRuntimeGate: booleanValue(item.can_clear_stage1_staging_runtime_gate, false),
    canClearStage1ProductionLaunchGate: booleanValue(item.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(item.can_close_do_not_launch, false)
  };
}

function mapStage1ProductionProofBundle(data: Record<string, unknown> | null, sourcePath: string): Stage1ProductionProofBundle {
  if (!data) {
    return missingStage1ProductionProofBundle(sourcePath);
  }
  const gateImpact = isRecord(data.gate_impact) ? data.gate_impact : {};
  const coverage = isRecord(data.input_variable_coverage) ? data.input_variable_coverage : {};
  const configuredInputVariableNames = mapConfiguredInputVariableNames(data.configured_input_variable_names);
  return {
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_proof_bundle"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    releaseSha: stringValue(data.release_sha, "missing"),
    productionWebUrl: stringValue(data.production_web_url, "missing"),
    nonClearingBundle: booleanValue(data.non_clearing_bundle, true),
    canonicalSourcesRequested: booleanValue(data.canonical_sources_requested, false),
    canClearStage1ProductionLaunchGate: booleanValue(gateImpact.can_clear_stage1_production_launch_gate, false),
    strictValidator: stringValue(gateImpact.requires_strict_validator, "python3 scripts/validate_stage1_production_launch.py"),
    configuredInputVariableNames,
    inputCoverage: mapStage1ProductionProofInputCoverage(coverage),
    inputGroups: mapStage1ProductionProofBundleInputGroups(coverage),
    proofs: mapStage1ProductionProofBundleProofs(data.proofs),
    steps: arrayOfRecords(data.steps).map(mapStage1ProductionProofBundleStep),
    blockedChecks: stringArray(data.blocked_checks)
  };
}

function missingStage1ProductionProofBundle(sourcePath: string): Stage1ProductionProofBundle {
  return {
    schemaVersion: "missing",
    kind: "stage1_production_proof_bundle_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    releaseSha: "missing",
    productionWebUrl: "missing",
    nonClearingBundle: true,
    canonicalSourcesRequested: false,
    canClearStage1ProductionLaunchGate: false,
    strictValidator: "python3 scripts/validate_stage1_production_launch.py",
    configuredInputVariableNames: {},
    inputCoverage: mapStage1ProductionProofInputCoverage({}),
    inputGroups: [],
    proofs: [],
    steps: [],
    blockedChecks: [`missing production proof bundle: ${sourcePath}`]
  };
}

function mapConfiguredInputVariableNames(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([groupId, names]) => [groupId, stringArray(names)]));
}

function mapStage1ProductionProofBundleProofs(value: unknown): Stage1ProductionProofBundle["proofs"] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).map(([proofId, child]) => {
    const proof = isRecord(child) ? child : {};
    return {
      proofId,
      status: stringValue(proof.status, "missing"),
      path: stringValue(proof.path, "missing"),
      schemaVersion: stringValue(proof.schema_version, "missing"),
      firstBlocker: stringValue(proof.first_blocker, "missing")
    };
  });
}

function mapStage1ProductionProofBundleStep(item: Record<string, unknown>): Stage1ProductionProofBundle["steps"][number] {
  return {
    stepId: stringValue(item.step_id, "unknown"),
    status: stringValue(item.status, "missing"),
    exitCode: numberValue(item.exit_code, -1),
    expectedExit: booleanValue(item.expected_exit, false),
    command: stringValue(item.command, "missing"),
    outputSummary: stringValue(item.output_summary, "missing")
  };
}

function mapStage1ProductionProofBundleInputGroups(coverage: Record<string, unknown>): Stage1ProductionProofBundle["inputGroups"] {
  const groups = isRecord(coverage.groups) ? coverage.groups : {};
  return Object.entries(groups).map(([groupId, value]) => {
    const group = isRecord(value) ? value : {};
    const optional = isRecord(group.optional_or_defaulted) ? group.optional_or_defaulted : {};
    return {
      groupId,
      requiredTotal: numberValue(group.required_total, 0),
      requiredConfigured: numberValue(group.required_configured, 0),
      requiredMissing: numberValue(group.required_missing, 0),
      requiredInvalid: numberValue(group.required_invalid, 0),
      configuredVariableNames: stringArray(group.configured_variable_names),
      missingRequiredInputs: stringArray(group.missing_required_inputs),
      invalidRequiredInputs: stringArray(group.invalid_required_inputs),
      optionalOrDefaultedConfigured: numberValue(
        optional.optional_or_defaulted_configured ?? group.optional_or_defaulted_configured,
        0
      ),
      optionalOrDefaultedTotal: numberValue(optional.optional_or_defaulted_total ?? group.optional_or_defaulted_total, 0),
      optionalOrDefaultedConfiguredVariableNames: stringArray(
        optional.configured_variable_names ?? group.optional_or_defaulted_configured_variable_names
      ),
      requirements: arrayOfRecords(group.requirements).map((requirement) =>
        mapStage1ProductionProofBundleRequirement(groupId, requirement)
      )
    };
  });
}

function mapStage1ProductionProofBundleRequirement(
  groupId: string,
  item: Record<string, unknown>
): Stage1ProductionProofBundle["inputGroups"][number]["requirements"][number] {
  return {
    groupId,
    requirementId: stringValue(item.requirement_id, "unknown"),
    displayName: stringValue(item.display_name, "missing"),
    status: proofBundleRequirementStatus(item.status),
    configuredVariableName: typeof item.configured_variable_name === "string" && item.configured_variable_name.length > 0 ? item.configured_variable_name : null,
    acceptedVariableNames: stringArray(item.accepted_variable_names)
  };
}

function mapStage1ProductionProofDiagnostics(
  inputs: Array<{
    proofId: Stage1ProductionProofDiagnostic["proofId"];
    sourcePath: string;
    data: Record<string, unknown> | null;
  }>
): Stage1ProductionProofDiagnostics {
  const diagnostics = inputs.map((input) => mapStage1ProductionProofDiagnostic(input.proofId, input.data, input.sourcePath));
  const blockedDiagnosticCount = diagnostics.filter((diagnostic) => diagnostic.status !== "pass").length;
  const canonicalSourcesWritten = diagnostics.filter((diagnostic) => diagnostic.canonicalSourceWritten).length;
  const safeProjectionReady = diagnostics.every((diagnostic) => diagnostic.safetyFlags.every((flag) => !flag.persisted));
  return {
    status: blockedDiagnosticCount === 0 ? "pass" : "blocked",
    releaseGateDecision: blockedDiagnosticCount === 0 && canonicalSourcesWritten === diagnostics.length ? "go" : "no_go",
    generatedAt: newestTimestampFromList(diagnostics.map((diagnostic) => diagnostic.generatedAt)),
    diagnostics,
    blockedDiagnosticCount,
    canonicalSourcesWritten,
    safeProjectionReady,
    firstBlockers: diagnostics.flatMap((diagnostic) => diagnostic.blockedChecks).slice(0, 6)
  };
}

function mapStage1ProductionBlockerChecklist(
  markdown: string | null,
  sourcePath: string
): Stage1ProductionBlockerChecklist {
  if (!markdown) {
    return {
      sourcePath,
      evidencePresent: false,
      generatedAt: "unknown",
      lineCount: 0,
      releaseGateDecision: "no_go",
      stage1GatesCompleted: 0,
      stage1GatesTotal: 14,
      stage1CompletionPercent: 0,
      productionInputsConfigured: 0,
      productionInputsTotal: 60,
      productionInputsCompletionPercent: 0,
      productionInputsMissing: 60,
      productionInputsInvalid: 0,
      blockingProductionInputs: 60,
      productionSourceProbesReady: 0,
      productionSourceProbesTotal: 4,
      productionSourceProbesBlocked: 4,
      sourceProbeBlockingInputCount: 60,
      sections: [],
      firstBlockingRows: [`missing production blocker checklist: ${sourcePath}`],
      commandCount: 0,
      validatorCommand: "python3 scripts/validate_stage1_production_blocker_checklist.py",
      generatorCommand: "python3 scripts/generate_stage1_production_blocker_checklist.py",
      nonClearingChecklist: true,
      canClearStage1ProductionLaunchGate: false,
      canCloseDoNotLaunch: false
    };
  }
  const lines = markdown.split(/\r?\n/);
  const sections = lines
    .map((line, index) => ({ title: line.replace(/^##\s+/, "").trim(), lineNumber: index + 1, raw: line }))
    .filter((line) => line.raw.startsWith("## "))
    .map(({ title, lineNumber }) => ({ title, lineNumber }));
  const firstBlockingRows = lines
    .filter((line) => line.startsWith("| ") && !line.includes("---") && !line.includes("Group |") && !line.includes("Order |"))
    .slice(0, 8);
  const releaseGateDecision = markdown.includes("Release decision: `no_go`") ? "no_go" : "unknown";
  return {
    sourcePath,
    evidencePresent: true,
    generatedAt: markdownString(markdown, /^Generated at: `([^`]+)`/m, "unknown"),
    lineCount: lines.length,
    releaseGateDecision,
    stage1GatesCompleted: markdownNumber(markdown, /^Stage1 gates: `(\d+)` \/ `\d+` = `[\d.]+%`/m, 0),
    stage1GatesTotal: markdownNumber(markdown, /^Stage1 gates: `\d+` \/ `(\d+)` = `[\d.]+%`/m, 0),
    stage1CompletionPercent: markdownNumber(markdown, /^Stage1 gates: `\d+` \/ `\d+` = `([\d.]+)%`/m, 0),
    productionInputsConfigured: markdownNumber(markdown, /^Production inputs: `(\d+)` \/ `\d+` = `[\d.]+%`/m, 0),
    productionInputsTotal: markdownNumber(markdown, /^Production inputs: `\d+` \/ `(\d+)` = `[\d.]+%`/m, 0),
    productionInputsCompletionPercent: markdownNumber(markdown, /^Production inputs: `\d+` \/ `\d+` = `([\d.]+)%`/m, 0),
    productionInputsMissing: markdownNumber(markdown, /^Production inputs missing: `(\d+)`/m, 0),
    productionInputsInvalid: markdownNumber(markdown, /^Production inputs invalid: `(\d+)`/m, 0),
    blockingProductionInputs: markdownNumber(markdown, /^Blocking production inputs: `(\d+)`/m, 0),
    productionSourceProbesReady: markdownNumber(markdown, /^Production source probes ready: `(\d+)` \/ `\d+`/m, 0),
    productionSourceProbesTotal: markdownNumber(markdown, /^Production source probes ready: `\d+` \/ `(\d+)`/m, 0),
    productionSourceProbesBlocked: markdownNumber(markdown, /^Production source probes blocked: `(\d+)`/m, 0),
    sourceProbeBlockingInputCount: markdownNumber(markdown, /^Source-probe blocking input count: `(\d+)`/m, 0),
    sections,
    firstBlockingRows,
    commandCount: (markdown.match(/```bash/g) ?? []).length,
    validatorCommand: "python3 scripts/validate_stage1_production_blocker_checklist.py",
    generatorCommand: "python3 scripts/generate_stage1_production_blocker_checklist.py",
    nonClearingChecklist: markdown.includes("non-clearing operator checklist"),
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false
  };
}

function mapStage1ProductionActionMatrix(
  data: Record<string, unknown> | null,
  markdown: string | null,
  sourcePath: string,
  markdownPath: string
): Stage1ProductionActionMatrix {
  if (!data) {
    return {
      sourcePath,
      markdownPath,
      evidencePresent: false,
      markdownPresent: Boolean(markdown),
      schemaVersion: "missing",
      kind: "stage1_production_action_matrix_missing",
      environment: "production",
      generatedAt: "unknown",
      status: "missing",
      releaseGateDecision: "no_go",
      nonClearingActionMatrix: true,
      canonicalPassPath: false,
      canClearStage1ProductionLaunchGate: false,
      canCloseDoNotLaunch: false,
      stage1GatesCompleted: 0,
      stage1GatesTotal: 14,
      stage1CompletionPercent: 0,
      productionInputsConfigured: 0,
      productionInputsTotal: 60,
      productionInputsCompletionPercent: 0,
      productionInputsMissing: 60,
      productionInputsInvalid: 0,
      blockingInputCount: 60,
      sourceProbesReady: 0,
      sourceProbesTotal: 4,
      sourceProbesBlocked: 4,
      lanes: [],
      immediateHelpQueue: [
        {
          rank: 1,
          laneId: "production_action_matrix_missing",
          blockingInputCount: 60,
          ask: `run python3 scripts/generate_stage1_production_action_matrix.py to publish ${sourcePath}`,
          firstRequiredMaterial: [sourcePath]
        }
      ],
      notCurrentBlockers: [],
      markdownLineCount: markdown ? markdown.split(/\r?\n/).length : 0,
      commandCount: markdown ? (markdown.match(/```bash/g) ?? []).length : 0,
      generatorCommand: "python3 scripts/generate_stage1_production_action_matrix.py",
      validatorCommand: "python3 scripts/validate_stage1_production_action_matrix.py"
    };
  }
  const summary = isRecord(data.summary) ? data.summary : {};
  const lines = markdown ? markdown.split(/\r?\n/) : [];
  return {
    sourcePath,
    markdownPath,
    evidencePresent: true,
    markdownPresent: Boolean(markdown),
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_action_matrix"),
    environment: stringValue(data.environment, "production"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    nonClearingActionMatrix: booleanValue(data.non_clearing_action_matrix, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    stage1GatesCompleted: numberValue(summary.stage1_gates_completed, 0),
    stage1GatesTotal: numberValue(summary.stage1_gates_total, 14),
    stage1CompletionPercent: numberValue(summary.stage1_completion_percent, 0),
    productionInputsConfigured: numberValue(summary.production_inputs_configured, 0),
    productionInputsTotal: numberValue(summary.production_inputs_total, 60),
    productionInputsCompletionPercent: numberValue(summary.production_inputs_completion_percent, 0),
    productionInputsMissing: numberValue(summary.production_inputs_missing, 60),
    productionInputsInvalid: numberValue(summary.production_inputs_invalid, 0),
    blockingInputCount: numberValue(summary.blocking_input_count, 60),
    sourceProbesReady: numberValue(summary.source_probes_ready, 0),
    sourceProbesTotal: numberValue(summary.source_probes_total, 4),
    sourceProbesBlocked: numberValue(summary.source_probes_blocked, 4),
    lanes: arrayOfRecords(data.lanes).map(mapStage1ProductionActionMatrixLane),
    immediateHelpQueue: arrayOfRecords(data.immediate_user_help_queue).map(mapStage1ProductionActionMatrixHelpItem),
    notCurrentBlockers: stringArray(data.not_current_blockers),
    markdownLineCount: lines.length,
    commandCount: markdown ? (markdown.match(/```bash/g) ?? []).length : 0,
    generatorCommand: "python3 scripts/generate_stage1_production_action_matrix.py",
    validatorCommand: "python3 scripts/validate_stage1_production_action_matrix.py"
  };
}

function mapStage1ProductionActionMatrixLane(item: Record<string, unknown>): Stage1ProductionActionMatrix["lanes"][number] {
  return {
    laneId: stringValue(item.lane_id, "unknown"),
    order: numberValue(item.order, 0),
    title: stringValue(item.title, "unknown"),
    status: stringValue(item.status, "missing"),
    owner: stringValue(item.owner, "unknown"),
    helpKind: stringValue(item.help_kind, "unknown"),
    blockingInputCount: numberValue(item.blocking_input_count, 0),
    completionPercent: numberValue(item.completion_percent, 0),
    requiredConfigured: numberValue(item.required_configured, 0),
    requiredTotal: numberValue(item.required_total, 0),
    firstBlocker: stringValue(item.first_blocker, "missing"),
    immediateAction: stringValue(item.immediate_action, "missing"),
    agentActionAfterInputs: stringValue(item.agent_action_after_inputs, "missing"),
    agentCanExecuteNow: booleanValue(item.agent_can_execute_now, false),
    agentCanExecuteAfterInputs: booleanValue(item.agent_can_execute_after_inputs, false),
    requiredUserMaterial: stringArray(item.required_user_material),
    blockedUntil: stringArray(item.blocked_until),
    automationCommands: stringArray(item.automation_commands),
    sourceProbeCommand: stringValue(item.source_probe_command, "missing"),
    evidenceGenerator: stringValue(item.evidence_generator, "missing"),
    strictValidator: stringValue(item.strict_validator, "missing"),
    operatorPacketRef: stringValue(item.operator_packet_ref, "missing"),
    sourceOutputPath: stringValue(item.source_output_path, "missing")
  };
}

function mapStage1ProductionActionMatrixHelpItem(item: Record<string, unknown>): Stage1ProductionActionMatrix["immediateHelpQueue"][number] {
  return {
    rank: numberValue(item.rank, 0),
    laneId: stringValue(item.lane_id, "unknown"),
    blockingInputCount: numberValue(item.blocking_input_count, 0),
    ask: stringValue(item.ask, "missing"),
    firstRequiredMaterial: stringArray(item.first_required_material)
  };
}

function mapStage1ProductionInputTemplate(
  data: Record<string, unknown> | null,
  templateText: string | null,
  sourcePath: string,
  manifestPath: string
): Stage1ProductionInputTemplate {
  if (!data) {
    return missingStage1ProductionInputTemplate(sourcePath, manifestPath, templateText);
  }
  return {
    sourcePath,
    manifestPath,
    evidencePresent: true,
    templatePresent: Boolean(templateText),
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_input_template"),
    environment: stringValue(data.environment, "production"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    status: stringValue(data.status, "template_only"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    templatePath: stringValue(data.template_path, sourcePath),
    nonClearingTemplate: booleanValue(data.non_clearing_template, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    valuePolicy: stringValue(data.value_policy, "blank_values_only"),
    templateVariableCount: numberValue(data.template_variable_count, 0),
    requiredRequirementCount: numberValue(data.required_requirement_count, 0),
    requiredTemplateVariableCount: numberValue(data.required_template_variable_count, 0),
    optionalOrDefaultedVariableCount: numberValue(data.optional_or_defaulted_variable_count, 0),
    templateLineCount: templateText ? templateText.split(/\r?\n/).length : 0,
    commandCount: stringArray(data.commands_after_fill).length,
    groups: arrayOfRecords(data.groups).map(mapStage1ProductionInputTemplateGroup),
    commandsAfterFill: stringArray(data.commands_after_fill),
    generatorCommand: stringValue(data.generator_command, "python3 scripts/generate_stage1_production_input_template.py"),
    validatorCommand: stringValue(data.validator_command, "python3 scripts/validate_stage1_production_input_template.py")
  };
}

function missingStage1ProductionInputTemplate(
  sourcePath: string,
  manifestPath: string,
  templateText: string | null
): Stage1ProductionInputTemplate {
  return {
    sourcePath,
    manifestPath,
    evidencePresent: false,
    templatePresent: Boolean(templateText),
    schemaVersion: "missing",
    kind: "stage1_production_input_template_missing",
    environment: "production",
    generatedAt: "unknown",
    status: "missing",
    releaseGateDecision: "no_go",
    templatePath: sourcePath,
    nonClearingTemplate: true,
    canonicalPassPath: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    valuePolicy: "blank_values_only",
    templateVariableCount: 0,
    requiredRequirementCount: 60,
    requiredTemplateVariableCount: 62,
    optionalOrDefaultedVariableCount: 29,
    templateLineCount: templateText ? templateText.split(/\r?\n/).length : 0,
    commandCount: 0,
    groups: [],
    commandsAfterFill: [],
    generatorCommand: "python3 scripts/generate_stage1_production_input_template.py",
    validatorCommand: "python3 scripts/validate_stage1_production_input_template.py"
  };
}

function mapStage1ProductionInputTemplateGroup(item: Record<string, unknown>): Stage1ProductionInputTemplate["groups"][number] {
  return {
    groupId: stringValue(item.group_id, "unknown"),
    title: stringValue(item.title, "unknown"),
    requiredRequirementCount: numberValue(item.required_requirement_count, 0),
    requiredTemplateVariableCount: numberValue(item.required_template_variable_count, 0),
    requiredTemplateVariables: stringArray(item.required_template_variables),
    optionalOrDefaultedCount: numberValue(item.optional_or_defaulted_count, 0),
    optionalOrDefaultedVariables: stringArray(item.optional_or_defaulted_variables),
    notes: stringArray(item.notes)
  };
}

function markdownString(markdown: string, pattern: RegExp, fallback: string): string {
  const match = markdown.match(pattern);
  return match?.[1]?.trim() || fallback;
}

function markdownNumber(markdown: string, pattern: RegExp, fallback: number): number {
  const match = markdown.match(pattern);
  if (!match?.[1]) {
    return fallback;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : fallback;
}

function mapStage1ProductionProofDiagnostic(
  proofId: Stage1ProductionProofDiagnostic["proofId"],
  data: Record<string, unknown> | null,
  sourcePath: string
): Stage1ProductionProofDiagnostic {
  if (!data) {
    return missingStage1ProductionProofDiagnostic(proofId, sourcePath);
  }
  return {
    proofId,
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, `production_${proofId}_proof`),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    releaseSha: stringValue(data.release_sha, "missing"),
    environment: stringValue(data.environment, "production"),
    canonicalSourceWritten: booleanValue(data.canonical_source_written, false),
    operatorNextCommandAfterPass: stringValue(data.operator_next_command_after_pass, "missing"),
    blockedChecks: stringArray(data.blocked_checks),
    safetyFlags: mapStage1ProductionProofDiagnosticSafetyFlags(data)
  };
}

function missingStage1ProductionProofDiagnostic(
  proofId: Stage1ProductionProofDiagnostic["proofId"],
  sourcePath: string
): Stage1ProductionProofDiagnostic {
  return {
    proofId,
    schemaVersion: "missing",
    kind: `production_${proofId}_proof_missing`,
    sourcePath,
    evidencePresent: false,
    status: "missing",
    generatedAt: "unknown",
    releaseSha: "missing",
    environment: "production",
    canonicalSourceWritten: false,
    operatorNextCommandAfterPass: "missing",
    blockedChecks: [`missing production ${proofId} proof diagnostic: ${sourcePath}`],
    safetyFlags: mapStage1ProductionProofDiagnosticSafetyFlags({})
  };
}

function mapStage1ProductionProofDiagnosticSafetyFlags(data: Record<string, unknown>): Stage1ProductionProofDiagnostic["safetyFlags"] {
  return [
    "authorization_header_persisted",
    "cookie_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "secret_material_persisted",
    "signed_url_persisted"
  ].map((flag) => ({
    flag,
    persisted: booleanValue(data[flag], false)
  }));
}

function mapStage1ProductionOperatorPacket(
  data: Record<string, unknown> | null,
  packetId: Stage1ProductionOperatorPacket["packetId"],
  sourcePath: string
): Stage1ProductionOperatorPacket {
  if (!data) {
    return missingStage1ProductionOperatorPacket(packetId, sourcePath);
  }
  const sourceProbe = isRecord(data.source_probe) ? data.source_probe : {};
  const proof = isRecord(data.live_proof) ? data.live_proof : isRecord(data.proof) ? data.proof : {};
  const privateEnv = isRecord(data.private_env_template) ? data.private_env_template : {};
  return {
    packetId,
    schemaVersion: stringValue(data.schema_version, "missing"),
    kind: stringValue(data.kind, "stage1_production_operator_packet"),
    sourcePath,
    evidencePresent: true,
    status: stringValue(data.status, "missing"),
    releaseGateDecision: stringValue(data.release_gate_decision, "no_go"),
    generatedAt: stringValue(data.generated_at, "unknown"),
    releaseGateCheckId: stringValue(data.release_gate_check_id, "missing"),
    nonClearingOperatorPacket: booleanValue(data.non_clearing_operator_packet, true),
    canonicalPassPath: booleanValue(data.canonical_pass_path, false),
    canClearStage1ProductionLaunchGate: booleanValue(data.can_clear_stage1_production_launch_gate, false),
    canCloseDoNotLaunch: booleanValue(data.can_close_do_not_launch, false),
    blockedUntil: stringArray(data.blocked_until),
    evidenceOutputs: stringRecord(data.evidence_outputs),
    sourceProbe: mapStage1ProductionOperatorPacketSourceProbe(sourceProbe),
    proof: mapStage1ProductionOperatorPacketProof(packetId, proof, data),
    requirementGroups: mapStage1ProductionOperatorPacketRequirementGroups(packetId, data),
    billingEnvClassification: packetId === "billing" ? mapBillingEnvClassification(data.local_env_classification) : {},
    billingLiveArtifacts: packetId === "billing" ? arrayOfRecords(data.required_live_artifacts).map(mapBillingLiveArtifact) : [],
    billingNumericControls: packetId === "billing" ? arrayOfRecords(data.required_numeric_controls).map(mapBillingNumericControl) : [],
    billingWebhookControls: packetId === "billing" ? mapBillingWebhookControls(data.required_webhook_controls) : [],
    billingAuditRefs: packetId === "billing" ? stringArray(data.required_audit_refs) : [],
    billingExecutionOrder: packetId === "billing" ? stringArray(data.execution_order) : [],
    billingPrivateEnvTemplate:
      packetId === "billing"
        ? mapProductionPrivateEnvTemplate(privateEnv)
        : missingProductionPrivateEnvTemplate(),
    billingOperatorCommandPacket:
      packetId === "billing" ? arrayOfRecords(data.operator_command_packet).map(mapBillingOperatorCommand) : [],
    securityRuntimeRefs: packetId === "security" ? arrayOfRecords(data.required_security_runtime_refs).map(mapSecurityRuntimeRef) : [],
    securityExecutionOrder: packetId === "security" ? stringArray(data.execution_order) : [],
    securityPrivateEnvTemplate:
      packetId === "security"
        ? mapProductionPrivateEnvTemplate(privateEnv)
        : missingProductionPrivateEnvTemplate(),
    securityOperatorCommandPacket:
      packetId === "security" ? arrayOfRecords(data.operator_command_packet).map(mapProductionOperatorCommand) : [],
    legalDnsRequirements: packetId === "legal_support" ? mapLegalDnsRequirements(data.required_dns_and_https) : [],
    legalPublicPaths: packetId === "legal_support" ? arrayOfRecords(data.required_public_paths).map(mapLegalPublicPath) : [],
    legalHttpsProbes: packetId === "legal_support" ? mapLegalHttpsProbes(data.dns_readiness) : [],
    legalOperatorNextActions: packetId === "legal_support" ? stringArray(data.operator_next_actions) : [],
    legalExecutionOrder: packetId === "legal_support" ? stringArray(data.execution_order) : [],
    legalOperatorCommandPacket:
      packetId === "legal_support" ? arrayOfRecords(data.operator_command_packet).map(mapProductionOperatorCommand) : [],
    governanceComponents: packetId === "governance" ? mapGovernanceComponents(data.required_governance_components) : [],
    governanceSectionRefs: packetId === "governance" ? mapGovernanceSectionRefs(data.required_governance_components) : [],
    governanceRequiredIds: packetId === "governance" ? mapGovernanceRequiredIds(data.required_governance_components) : [],
    governanceExecutionOrder: packetId === "governance" ? stringArray(data.execution_order) : [],
    governancePrivateEnvTemplate:
      packetId === "governance"
        ? mapProductionPrivateEnvTemplate(privateEnv)
        : missingProductionPrivateEnvTemplate(),
    governanceOperatorCommandPacket:
      packetId === "governance" ? arrayOfRecords(data.operator_command_packet).map(mapProductionOperatorCommand) : []
  };
}

function missingStage1ProductionOperatorPacket(
  packetId: Stage1ProductionOperatorPacket["packetId"],
  sourcePath: string
): Stage1ProductionOperatorPacket {
  return {
    packetId,
    schemaVersion: "missing",
    kind: "stage1_production_operator_packet_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    releaseGateCheckId: "missing",
    nonClearingOperatorPacket: true,
    canonicalPassPath: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    blockedUntil: [`missing production ${packetId} operator packet: ${sourcePath}`],
    evidenceOutputs: {},
    sourceProbe: {
      canonicalSourcePath: "missing",
      canonicalSourceExists: false,
      sourceProbeCommand: "missing",
      diagnosticPath: "missing",
      diagnosticStatus: "missing",
      firstBlocker: `missing production ${packetId} operator packet`
    },
    proof: {
      candidatePath: "missing",
      blockedDiagnosticPath: "missing",
      blockedDiagnosticStatus: "missing",
      firstBlocker: `missing production ${packetId} operator packet`,
      proofGeneratorCommand: "missing",
      proofValidatorCommand: "missing"
    },
    requirementGroups: [],
    billingEnvClassification: {},
    billingLiveArtifacts: [],
    billingNumericControls: [],
    billingWebhookControls: [],
    billingAuditRefs: [],
    billingExecutionOrder: [],
    billingPrivateEnvTemplate: {
      pathPlaceholder: "<private-production-env>",
      gitignoreRequired: true,
      blankValuesOnly: true,
      allowedVariableNames: [],
      templateLines: []
    },
    billingOperatorCommandPacket: [],
    securityRuntimeRefs: [],
    securityExecutionOrder: [],
    securityPrivateEnvTemplate: {
      pathPlaceholder: "<private-production-env>",
      gitignoreRequired: true,
      blankValuesOnly: true,
      allowedVariableNames: [],
      templateLines: []
    },
    securityOperatorCommandPacket: [],
    legalDnsRequirements: [],
    legalPublicPaths: [],
    legalHttpsProbes: [],
    legalOperatorNextActions: [],
    legalExecutionOrder: [],
    legalOperatorCommandPacket: [],
    governanceComponents: [],
    governanceSectionRefs: [],
    governanceRequiredIds: [],
    governanceExecutionOrder: [],
    governancePrivateEnvTemplate: {
      pathPlaceholder: "<private-production-env>",
      gitignoreRequired: true,
      blankValuesOnly: true,
      allowedVariableNames: [],
      templateLines: []
    },
    governanceOperatorCommandPacket: []
  };
}

function mapStage1ProductionOperatorPacketSourceProbe(
  sourceProbe: Record<string, unknown>
): Stage1ProductionOperatorPacket["sourceProbe"] {
  const diagnostic = isRecord(sourceProbe.source_diagnostic) ? sourceProbe.source_diagnostic : {};
  return {
    canonicalSourcePath: stringValue(sourceProbe.canonical_source_path, "missing"),
    canonicalSourceExists: booleanValue(sourceProbe.canonical_source_exists, false),
    sourceProbeCommand: stringValue(sourceProbe.source_probe_command, "missing"),
    diagnosticPath: stringValue(diagnostic.path, "missing"),
    diagnosticStatus: stringValue(diagnostic.status, "missing"),
    firstBlocker: stringValue(diagnostic.first_blocker, "missing")
  };
}

function mapStage1ProductionOperatorPacketProof(
  packetId: Stage1ProductionOperatorPacket["packetId"],
  proof: Record<string, unknown>,
  data: Record<string, unknown>
): Stage1ProductionOperatorPacket["proof"] {
  const blockedDiagnostic = isRecord(proof.blocked_diagnostic) ? proof.blocked_diagnostic : {};
  if (packetId === "legal_support") {
    const dnsReadiness = isRecord(data.dns_readiness) ? data.dns_readiness : {};
    const dnsCutoverPlan = isRecord(data.dns_cutover_plan) ? data.dns_cutover_plan : {};
    return {
      candidatePath: stringValue(dnsReadiness.path, "ops/evidence/non_clearing/production-dns-readiness.json"),
      blockedDiagnosticPath: stringValue(dnsCutoverPlan.path, "ops/evidence/non_clearing/production-dns-cutover-plan.json"),
      blockedDiagnosticStatus: stringValue(dnsCutoverPlan.status, stringValue(dnsReadiness.status, "missing")),
      firstBlocker: stringValue(
        dnsReadiness.first_blocker,
        stringValue(dnsCutoverPlan.first_blocker, "production DNS/HTTPS proof missing")
      ),
      proofGeneratorCommand: stringValue(
        dnsCutoverPlan.required_command,
        "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json"
      ),
      proofValidatorCommand: "python3 scripts/validate_stage1_production_dns_readiness.py && python3 scripts/validate_stage1_production_dns_cutover_plan.py"
    };
  }
  return {
    candidatePath: stringValue(proof.candidate_path, "missing"),
    blockedDiagnosticPath: stringValue(blockedDiagnostic.path, "missing"),
    blockedDiagnosticStatus: stringValue(blockedDiagnostic.status, "missing"),
    firstBlocker: stringValue(blockedDiagnostic.first_blocker, "missing"),
    proofGeneratorCommand: stringValue(proof.proof_generator_command, "missing"),
    proofValidatorCommand: stringValue(proof.proof_validator_command, "missing")
  };
}

function mapStage1ProductionOperatorPacketRequirementGroups(
  packetId: Stage1ProductionOperatorPacket["packetId"],
  data: Record<string, unknown>
): Stage1ProductionOperatorPacket["requirementGroups"] {
  if (packetId === "billing") {
    const webhookControls = isRecord(data.required_webhook_controls) ? data.required_webhook_controls : {};
    const livePrerequisites = isRecord(data.live_mode_prerequisites) ? data.live_mode_prerequisites : {};
    return [
      {
        groupId: "live_mode_prerequisites",
        count: Object.keys(livePrerequisites).length,
        summary: "production Stripe runtime must be live; sandbox/test artifacts cannot clear this packet"
      },
      {
        groupId: "required_live_artifacts",
        count: arrayOfRecords(data.required_live_artifacts).length,
        summary: requirementNames(arrayOfRecords(data.required_live_artifacts), "name")
      },
      {
        groupId: "required_audit_refs",
        count: stringArray(data.required_audit_refs).length,
        summary: stringArray(data.required_audit_refs).slice(0, 6).join(", ") || "missing"
      },
      {
        groupId: "required_numeric_controls",
        count: arrayOfRecords(data.required_numeric_controls).length,
        summary: requirementNames(arrayOfRecords(data.required_numeric_controls), "name")
      },
      {
        groupId: "required_webhook_controls",
        count: Object.keys(webhookControls).length,
        summary: Object.keys(webhookControls).slice(0, 6).join(", ") || "missing"
      }
    ];
  }
  if (packetId === "security") {
    const refs = arrayOfRecords(data.required_security_runtime_refs);
    return [
      {
        groupId: "required_security_runtime_refs",
        count: refs.length,
        summary: requirementNames(refs, "section")
      }
    ];
  }
  if (packetId === "legal_support") {
    const dnsAndHttps = isRecord(data.required_dns_and_https) ? data.required_dns_and_https : {};
    const dnsReadiness = isRecord(data.dns_readiness) ? data.dns_readiness : {};
    const httpsPass = numberValue(dnsReadiness.https_pass_count, 0);
    const httpsTotal = numberValue(dnsReadiness.https_total, 0);
    return [
      {
        groupId: "required_dns_and_https",
        count: Object.keys(dnsAndHttps).length,
        summary: Object.keys(dnsAndHttps).slice(0, 6).join(", ") || "missing"
      },
      {
        groupId: "required_public_paths",
        count: arrayOfRecords(data.required_public_paths).length,
        summary: requirementNames(arrayOfRecords(data.required_public_paths), "path")
      },
      {
        groupId: "https_probe.production_paths",
        count: httpsTotal,
        summary: `${httpsPass}/${httpsTotal} production HTTPS paths passing`
      },
      {
        groupId: "operator_next_actions",
        count: stringArray(data.operator_next_actions).length,
        summary: stringArray(data.operator_next_actions).slice(0, 2).join(" | ") || "missing"
      }
    ];
  }
  if (packetId === "governance") {
    const components = arrayOfRecords(data.required_governance_components);
    const sectionRefCount = components.reduce((sum, component) => sum + arrayOfRecords(component.required_section_refs).length, 0);
    const idCount = components.reduce((sum, component) => sum + arrayOfRecords(component.required_ids).length, 0);
    return [
      {
        groupId: "required_governance_components",
        count: components.length,
        summary: requirementNames(components, "component")
      },
      {
        groupId: "required_governance_section_refs",
        count: sectionRefCount,
        summary: "activation, abuse, and skill release runtime/audit refs"
      },
      {
        groupId: "required_governance_ids",
        count: idCount,
        summary: "skill owner, suite, rollback target, release notes, and canary sample ids"
      }
    ];
  }
  return [];
}

function mapBillingEnvClassification(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, typeof child === "boolean" ? String(child) : stringValue(child, "unknown")])
  );
}

function mapBillingLiveArtifact(item: Record<string, unknown>): Stage1ProductionOperatorPacket["billingLiveArtifacts"][number] {
  return {
    flag: stringValue(item.flag, "missing"),
    name: stringValue(item.name, "missing"),
    prefix: stringValue(item.prefix, "missing"),
    section: stringValue(item.section, "missing")
  };
}

function mapBillingNumericControl(item: Record<string, unknown>): Stage1ProductionOperatorPacket["billingNumericControls"][number] {
  return {
    flag: stringValue(item.flag, "missing"),
    name: stringValue(item.name, "missing"),
    rule: stringValue(item.rule, "missing")
  };
}

function mapBillingWebhookControls(value: unknown): Stage1ProductionOperatorPacket["billingWebhookControls"] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).map(([controlId, rule]) => ({
    controlId,
    rule: typeof rule === "boolean" ? String(rule) : stringValue(rule, "unknown")
  }));
}

function missingProductionPrivateEnvTemplate(): Stage1ProductionOperatorPacket["securityPrivateEnvTemplate"] {
  return {
    pathPlaceholder: "<private-production-env>",
    gitignoreRequired: true,
    blankValuesOnly: true,
    allowedVariableNames: [],
    templateLines: []
  };
}

function mapProductionPrivateEnvTemplate(item: Record<string, unknown>): Stage1ProductionOperatorPacket["securityPrivateEnvTemplate"] {
  return {
    pathPlaceholder: stringValue(item.path_placeholder, "<private-production-env>"),
    gitignoreRequired: booleanValue(item.gitignore_required, true),
    blankValuesOnly: booleanValue(item.blank_values_only, true),
    allowedVariableNames: stringArray(item.allowed_variable_names),
    templateLines: stringArray(item.template_lines)
  };
}

function mapProductionOperatorCommand(item: Record<string, unknown>): Stage1ProductionOperatorPacket["securityOperatorCommandPacket"][number] {
  return {
    stepId: stringValue(item.step_id, "missing"),
    command: stringValue(item.command, "missing"),
    sideEffect: stringValue(item.side_effect, "missing"),
    mayWriteCanonicalSource: booleanValue(item.may_write_canonical_source, false),
    mayApplyProductionDns: booleanValue(item.may_apply_production_dns, false),
    requiresReview: booleanValue(item.requires_review, false)
  };
}

function mapBillingOperatorCommand(item: Record<string, unknown>): Stage1ProductionOperatorPacket["billingOperatorCommandPacket"][number] {
  return mapProductionOperatorCommand(item);
}

function mapSecurityRuntimeRef(item: Record<string, unknown>): Stage1ProductionOperatorPacket["securityRuntimeRefs"][number] {
  const assertions = isRecord(item.required_runtime_assertions) ? item.required_runtime_assertions : {};
  return {
    section: stringValue(item.section, "missing"),
    flag: stringValue(item.flag, "missing"),
    requiredRuntimeAssertions: JSON.stringify(assertions)
  };
}

function mapLegalDnsRequirements(value: unknown): Stage1ProductionOperatorPacket["legalDnsRequirements"] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value).map(([field, child]) => ({
    field,
    value: Array.isArray(child) ? child.map((item) => String(item)).join(", ") : typeof child === "boolean" ? String(child) : stringValue(child, "unknown")
  }));
}

function mapLegalPublicPath(item: Record<string, unknown>): Stage1ProductionOperatorPacket["legalPublicPaths"][number] {
  return {
    group: stringValue(item.group, "missing"),
    pageId: stringValue(item.page_id, "missing"),
    method: stringValue(item.method, "GET"),
    path: stringValue(item.path, "missing"),
    expectedHttpStatus: numberValue(item.expected_http_status, 0),
    visibility: stringValue(item.visibility, "missing"),
    externalUserVisible: booleanValue(item.external_user_visible, false),
    adminSessionRequired: booleanValue(item.admin_session_required, true),
    requiredTokens: stringArray(item.required_tokens)
  };
}

function mapLegalHttpsProbes(value: unknown): Stage1ProductionOperatorPacket["legalHttpsProbes"] {
  const dnsReadiness = isRecord(value) ? value : {};
  return arrayOfRecords(dnsReadiness.production_paths).map((item) => ({
    path: stringValue(item.path, "missing"),
    status: stringValue(item.status, "missing"),
    httpStatus: item.http_status === null || item.http_status === undefined ? "missing" : String(item.http_status),
    errorSummary: stringValue(item.error_summary, "none")
  }));
}

function mapGovernanceComponents(value: unknown): Stage1ProductionOperatorPacket["governanceComponents"] {
  return arrayOfRecords(value).map((component) => ({
    component: stringValue(component.component, "missing"),
    releaseGateCheckId: stringValue(component.release_gate_check_id, "missing"),
    runtimeFlag: stringValue(component.runtime_flag, "missing"),
    auditFlag: stringValue(component.audit_flag, "missing"),
    sectionRefCount: arrayOfRecords(component.required_section_refs).length,
    requiredIdCount: arrayOfRecords(component.required_ids).length
  }));
}

function mapGovernanceSectionRefs(value: unknown): Stage1ProductionOperatorPacket["governanceSectionRefs"] {
  return arrayOfRecords(value).flatMap((component) => {
    const componentName = stringValue(component.component, "missing");
    return arrayOfRecords(component.required_section_refs).map((section) => {
      const assertions = isRecord(section.required_assertions) ? section.required_assertions : {};
      return {
        component: componentName,
        section: stringValue(section.section, "missing"),
        flag: stringValue(section.flag, "missing"),
        requiredAssertions: JSON.stringify(assertions)
      };
    });
  });
}

function mapGovernanceRequiredIds(value: unknown): Stage1ProductionOperatorPacket["governanceRequiredIds"] {
  return arrayOfRecords(value).flatMap((component) => {
    const componentName = stringValue(component.component, "missing");
    return arrayOfRecords(component.required_ids).map((item) => ({
      component: componentName,
      field: stringValue(item.field, "missing"),
      flag: stringValue(item.flag, "missing"),
      rule: stringValue(item.rule, "string")
    }));
  });
}

function requirementNames(rows: Record<string, unknown>[], field: string): string {
  return rows
    .map((row) => stringValue(row[field], ""))
    .filter(Boolean)
    .slice(0, 6)
    .join(", ") || "missing";
}

function missingStage1ExternalResourceReadiness(sourcePath: string): Stage1ExternalResourceReadiness {
  return {
    schemaVersion: "missing",
    kind: "stage1_external_resource_readiness_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    total: 0,
    ready: 0,
    providedUnverified: 0,
    blocked: 0,
    missing: 0,
    readyPercent: 0,
    blockers: [`missing external resource readiness evidence: ${sourcePath}`],
    operatorHandoff: missingStage1ExternalResourceHandoff(),
    nonClearingRefreshSummary: missingStage1ExternalResourceNonClearingRefreshSummary(),
    productionSourceProbeRequirements: [],
    resourceGroups: []
  };
}

function missingStage1AzureOriginReadiness(sourcePath: string): Stage1AzureOriginReadiness {
  return {
    schemaVersion: "missing",
    kind: "stage1_azure_origin_readiness_missing",
    sourcePath,
    evidencePresent: false,
    status: "missing",
    releaseGateDecision: "no_go",
    generatedAt: "unknown",
    azureIp: "missing",
    stagingWebUrl: "missing",
    stagingHost: "missing",
    nonClearingOriginProbe: true,
    canonicalPassPath: false,
    canClearStage1StagingRuntimeGate: false,
    canClearStage1ProductionLaunchGate: false,
    canCloseDoNotLaunch: false,
    tcpPorts: [],
    stagingDns: {
      host: "missing",
      status: "missing",
      addresses: [],
      errorSummary: `missing Azure origin readiness evidence: ${sourcePath}`
    },
    httpProbes: [],
    sshKeyPreflight: {
      targetUser: "missing",
      targetHost: "missing",
      status: "missing",
      exitCode: -1,
      authMethod: "missing",
      reason: "missing",
      errorSummary: `missing Azure origin readiness evidence: ${sourcePath}`,
      passwordAttempted: false,
      hardTimeoutSeconds: 20
    },
    azureCliPreflight: {
      status: "missing",
      reason: "missing",
      subscriptionId: "",
      resourceGroup: "",
      vmName: "",
      azureIp: "52.237.80.117",
      exitCode: -1,
      errorSummary: `missing Azure origin readiness evidence: ${sourcePath}`
    },
    transportDiagnosis: {
      status: "missing",
      errorSummary: `missing Azure origin readiness evidence: ${sourcePath}`,
      lane: "missing",
      nextAction: "run_stage1_azure_origin_readiness",
      operatorSummary: `missing Azure origin readiness evidence: ${sourcePath}`,
      blockedReasons: [`missing Azure origin readiness evidence: ${sourcePath}`],
      tcpEntryPortsReachable: false,
      tcp22Reachable: false,
      tcp80Reachable: false,
      tcp443Reachable: false,
      sshTransportPhase: "missing",
      sshBannerReceived: false,
      sshAuthReached: false,
      sshPasswordKeyRepairViable: false,
      httpRequestSent: false,
      httpResponseStarted: false,
      httpZeroBytesAfterRequest: false,
      tlsServerhelloTimeout: false,
      azurePortalRunCommandRequired: false
    },
    blockedChecks: [`missing Azure origin readiness evidence: ${sourcePath}`],
    sshHardTimeoutSeconds: 20,
    localRepairPasswordEnvKey: "STAGING_SSH_PASSWORD",
    localRepairPasswordConfigured: false,
    localRepairPasswordRequired: true,
    originRepairCommands: [
      "scripts/azure_staging_run_command_payload.sh",
      "python3 scripts/ingest_azure_run_command_output.py",
      "python3 scripts/sanitize_azure_run_command_output.py --output ops/evidence/staging/azure-run-command-ssh-repair.output.txt --require-marker",
      "python3 scripts/classify_azure_run_command_output.py --input ops/evidence/staging/azure-run-command-ssh-repair.output.txt --output ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json || test $? -eq 2",
      "scripts/azure_staging_cli_preflight.sh",
      "RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh",
      "scripts/azure_staging_password_key_repair.sh",
      "scripts/azure_staging_ssh_preflight.sh",
      "scripts/azure_staging_bootstrap.sh",
      "scripts/azure_staging_deploy.sh",
      "scripts/azure_staging_origin_repair.sh"
    ],
    originDiagnosticsCommand: "scripts/azure_staging_origin_diagnostics.sh",
    originRepairCommand: "scripts/azure_staging_origin_repair.sh",
    operatorNextActions: ["Run python3 scripts/stage1_azure_origin_readiness.py to publish non-clearing Azure origin diagnostics."]
  };
}

function mapStage1AzureOriginTcpProbe(item: Record<string, unknown>): Stage1AzureOriginTcpProbe {
  return {
    host: stringValue(item.host, "missing"),
    port: numberValue(item.port, 0),
    status: stringValue(item.status, "missing"),
    errorSummary: stringValue(item.error_summary, "")
  };
}

function mapStage1AzureOriginHttpProbe(item: Record<string, unknown>): Stage1AzureOriginHttpProbe {
  return {
    url: stringValue(item.url, "missing"),
    method: stringValue(item.method, "missing"),
    status: stringValue(item.status, "missing"),
    httpStatus: typeof item.http_status === "number" ? item.http_status : null,
    finalUrlHost: stringValue(item.final_url_host, "missing"),
    bodySamplePresent: booleanValue(item.body_sample_present, false),
    networkPhase: stringValue(item.network_phase, "missing"),
    failureCategory: stringValue(item.failure_category, "missing"),
    responseBytes: numberValue(item.response_bytes, 0),
    errorSummary: stringValue(item.error_summary, "")
  };
}

function mapStage1AzureOriginDnsProbe(value: unknown): Stage1AzureOriginDnsProbe {
  const item = isRecord(value) ? value : {};
  return {
    host: stringValue(item.host, "missing"),
    status: stringValue(item.status, "missing"),
    addresses: stringArray(item.addresses),
    errorSummary: stringValue(item.error_summary, "")
  };
}

function mapStage1AzureOriginSshPreflight(value: unknown): Stage1AzureOriginSshPreflight {
  const item = isRecord(value) ? value : {};
  return {
    targetUser: stringValue(item.target_user, "missing"),
    targetHost: stringValue(item.target_host, "missing"),
    status: stringValue(item.status, "missing"),
    exitCode: numberValue(item.exit_code, -1),
    authMethod: stringValue(item.auth_method, "missing"),
    reason: stringValue(item.reason, "missing"),
    errorSummary: stringValue(item.error_summary, ""),
    passwordAttempted: booleanValue(item.password_attempted, false),
    hardTimeoutSeconds: numberValue(item.hard_timeout_seconds, 20)
  };
}

function mapStage1AzureCliPreflight(value: unknown): Stage1AzureCliPreflight {
  const item = isRecord(value) ? value : {};
  return {
    status: stringValue(item.status, "missing"),
    reason: stringValue(item.reason, "missing"),
    subscriptionId: stringValue(item.subscription_id, ""),
    resourceGroup: stringValue(item.resource_group, ""),
    vmName: stringValue(item.vm_name, ""),
    azureIp: stringValue(item.azure_ip, "52.237.80.117"),
    exitCode: numberValue(item.exit_code, -1),
    errorSummary: stringValue(item.error_summary, "")
  };
}

function mapStage1AzureTransportDiagnosis(value: unknown): Stage1AzureTransportDiagnosis {
  const item = isRecord(value) ? value : {};
  return {
    status: stringValue(item.status, "missing"),
    errorSummary: stringValue(item.error_summary, ""),
    lane: stringValue(item.lane, "missing"),
    nextAction: stringValue(item.next_action, "missing"),
    operatorSummary: stringValue(item.operator_summary, "missing"),
    blockedReasons: stringArray(item.blocked_reasons),
    tcpEntryPortsReachable: booleanValue(item.tcp_entry_ports_reachable, false),
    tcp22Reachable: booleanValue(item.tcp_22_reachable, false),
    tcp80Reachable: booleanValue(item.tcp_80_reachable, false),
    tcp443Reachable: booleanValue(item.tcp_443_reachable, false),
    sshTransportPhase: stringValue(item.ssh_transport_phase, "missing"),
    sshBannerReceived: booleanValue(item.ssh_banner_received, false),
    sshAuthReached: booleanValue(item.ssh_auth_reached, false),
    sshPasswordKeyRepairViable: booleanValue(item.ssh_password_key_repair_viable, false),
    httpRequestSent: booleanValue(item.http_request_sent, false),
    httpResponseStarted: booleanValue(item.http_response_started, false),
    httpZeroBytesAfterRequest: booleanValue(item.http_zero_bytes_after_request, false),
    tlsServerhelloTimeout: booleanValue(item.tls_serverhello_timeout, false),
    azurePortalRunCommandRequired: booleanValue(item.azure_portal_run_command_required, false)
  };
}

function missingStage1ExternalResourceHandoff(): Stage1ExternalResourceHandoff {
  return {
    status: "missing",
    currentLoopBreaker: "Run python3 scripts/generate_stage1_external_resource_readiness.py to publish isolated staging resource handoff.",
    readyResourceIds: [],
    missingResourceIds: [],
    blockedResourceIds: [],
    missingVariables: [],
    resourceClasses: [],
    productionSourceProbeRequirements: [],
    commandsAfterInputs: [],
    inputPacketRef: "ops/evidence/non_clearing/production-launch-input-packet.json",
    operatorBriefRef: "ops/evidence/non_clearing/production-launch-operator-brief.json",
    missingInputChecklistRef: "ops/evidence/non_clearing/production-missing-input-checklist.json",
    sourceProbeRunbookRef: "ops/evidence/non_clearing/production-source-probe-runbook.json",
    resourceStatus: {},
    nonClearingPreflight: true,
    nonClearingRefreshSummary: missingStage1ExternalResourceNonClearingRefreshSummary()
  };
}

function missingStage1ExternalResourceNonClearingRefreshSummary(): Stage1ExternalResourceNonClearingRefreshSummary {
  return {
    path: "ops/evidence/non_clearing/production-non-clearing-refresh.json",
    status: "missing",
    stepSummary: {
      total: 0,
      passed: 0,
      blocked: 0,
      failed: 0,
      unexpectedExitCount: 0
    },
    stage1Progress: {
      completed: 0,
      total: 0,
      completionPercent: 0
    },
    productionInputProgress: {
      configured: 0,
      total: 0,
      completionPercent: 0
    },
    blockedEvidenceDetails: []
  };
}

function mapStage1ExternalResourceNonClearingRefreshSummary(
  value: unknown,
  fallback: Stage1ExternalResourceNonClearingRefreshSummary = missingStage1ExternalResourceNonClearingRefreshSummary()
): Stage1ExternalResourceNonClearingRefreshSummary {
  if (!isRecord(value)) {
    return fallback;
  }
  const stepSummary = isRecord(value.step_summary) ? value.step_summary : {};
  const stage1Progress = isRecord(value.stage1_progress) ? value.stage1_progress : {};
  const productionInputProgress = isRecord(value.production_input_progress) ? value.production_input_progress : {};
  return {
    path: stringValue(value.path, fallback.path),
    status: stringValue(value.status, fallback.status),
    stepSummary: {
      total: numberValue(stepSummary.total, fallback.stepSummary.total),
      passed: numberValue(stepSummary.passed, fallback.stepSummary.passed),
      blocked: numberValue(stepSummary.blocked, fallback.stepSummary.blocked),
      failed: numberValue(stepSummary.failed, fallback.stepSummary.failed),
      unexpectedExitCount: numberValue(stepSummary.unexpected_exit_count, fallback.stepSummary.unexpectedExitCount)
    },
    stage1Progress: {
      completed: numberValue(stage1Progress.completed, fallback.stage1Progress.completed),
      total: numberValue(stage1Progress.total, fallback.stage1Progress.total),
      completionPercent: numberValue(stage1Progress.completion_percent, fallback.stage1Progress.completionPercent)
    },
    productionInputProgress: {
      configured: numberValue(productionInputProgress.configured, fallback.productionInputProgress.configured),
      total: numberValue(productionInputProgress.total, fallback.productionInputProgress.total),
      completionPercent: numberValue(productionInputProgress.completion_percent, fallback.productionInputProgress.completionPercent)
    },
    blockedEvidenceDetails: arrayOfRecords(value.blocked_evidence_details).map((item) => ({
      stepId: stringValue(item.step_id, "unknown"),
      source: stringValue(item.source, "missing"),
      detail: stringValue(item.detail, "missing")
    }))
  };
}

function mapStage1ExternalResourceHandoff(
  value: unknown,
  rows: Stage1ExternalResourceGroup[],
  fallbackRefreshSummary: Stage1ExternalResourceNonClearingRefreshSummary = missingStage1ExternalResourceNonClearingRefreshSummary()
): Stage1ExternalResourceHandoff {
  if (!isRecord(value)) {
    const fallback = missingStage1ExternalResourceHandoff();
    fallback.readyResourceIds = rows.filter((row) => row.status === "ready").map((row) => row.resourceId);
    fallback.missingResourceIds = rows.filter((row) => row.status === "missing").map((row) => row.resourceId);
    fallback.blockedResourceIds = rows.filter((row) => row.status === "blocked").map((row) => row.resourceId);
    fallback.nonClearingRefreshSummary = fallbackRefreshSummary;
    return fallback;
  }
  const resourceStatusRecord = isRecord(value.resource_status) ? value.resource_status : {};
  return {
    status: stringValue(value.status, "blocked"),
    currentLoopBreaker: stringValue(value.current_loop_breaker, "isolated staging handoff not reported"),
    readyResourceIds: stringArray(value.ready_resource_ids),
    missingResourceIds: stringArray(value.missing_resource_ids),
    blockedResourceIds: stringArray(value.blocked_resource_ids),
    missingVariables: stringArray(value.missing_variables),
    resourceClasses: stringArray(value.resource_classes),
    productionSourceProbeRequirements: arrayOfRecords(value.production_source_probe_requirements).map(
      mapStage1ProductionSourceProbeRequirement
    ),
    commandsAfterInputs: stringArray(value.commands_after_inputs),
    inputPacketRef: stringValue(value.input_packet_ref, "ops/evidence/non_clearing/production-launch-input-packet.json"),
    operatorBriefRef: stringValue(value.operator_brief_ref, "ops/evidence/non_clearing/production-launch-operator-brief.json"),
    missingInputChecklistRef: stringValue(value.missing_input_checklist_ref, "ops/evidence/non_clearing/production-missing-input-checklist.json"),
    sourceProbeRunbookRef: stringValue(value.source_probe_runbook_ref, "ops/evidence/non_clearing/production-source-probe-runbook.json"),
    resourceStatus: Object.fromEntries(Object.entries(resourceStatusRecord).map(([key, item]) => [key, stringValue(item, "unknown")])),
    nonClearingPreflight: booleanValue(value.non_clearing_preflight, true),
    nonClearingRefreshSummary: mapStage1ExternalResourceNonClearingRefreshSummary(
      value.non_clearing_refresh_summary,
      fallbackRefreshSummary
    )
  };
}

function mapStage1ExternalResourceGroup(item: Record<string, unknown>): Stage1ExternalResourceGroup {
  return {
    resourceId: stringValue(item.resource_id, "unknown"),
    lane: externalResourceLane(item.lane),
    status: externalResourceStatus(item.status),
    requiredResource: stringValue(item.required_resource, "missing"),
    providedSignal: stringValue(item.provided_signal, "missing"),
    validationSignal: stringValue(item.validation_signal, "missing"),
    currentBlocker: stringValue(item.current_blocker, "not reported by current aggregate"),
    gateDependency: stringValue(item.gate_dependency, "missing"),
    evidenceRefs: stringArray(item.evidence_refs),
    validator: stringValue(item.validator, "missing"),
    nextAction: stringValue(item.next_action, "missing"),
    operatorAsk: stringValue(item.operator_ask, "missing"),
    sourceProbeRequirements: arrayOfRecords(item.source_probe_requirements).map(mapStage1ProductionSourceProbeRequirement)
  };
}

function mapStage1ProductionSourceProbeRequirement(item: Record<string, unknown>): Stage1ProductionSourceProbeRequirement {
  return {
    probeId: stringValue(item.probe_id, "unknown"),
    path: stringValue(item.path, "missing"),
    schemaVersion: stringValue(item.schema_version, "missing"),
    status: productionSourceProbeStatus(item.status),
    sourceProbeExists: booleanValue(item.source_probe_exists, false),
    reportedByProductionAggregate: booleanValue(item.reported_by_production_aggregate, false),
    currentBlocker: stringValue(item.current_blocker, "missing"),
    generator: stringValue(item.generator, "missing"),
    strictValidator: stringValue(item.strict_validator, "missing")
  };
}

function summarizeResourceReadinessActions(readiness: Stage1ExternalResourceReadiness): string[] {
  if (!readiness.evidencePresent) {
    return [`resources: run python3 scripts/generate_stage1_external_resource_readiness.py to publish external dependency readiness`];
  }
  return readiness.resourceGroups
    .filter((row) => row.status !== "ready")
    .slice(0, 3)
    .map((row) => `resources:${row.resourceId}: ${row.operatorAsk}`);
}

function summarizeAzureOriginReadinessActions(readiness: Stage1AzureOriginReadiness): string[] {
  if (!readiness.evidencePresent) {
    return ["azure_origin: run python3 scripts/stage1_azure_origin_readiness.py to publish origin diagnostics"];
  }
  return readiness.operatorNextActions.slice(0, 3).map((action) => `azure_origin: ${action}`);
}

function summarizeProductionLaunchOperatorBriefActions(brief: Stage1ProductionLaunchOperatorBrief): string[] {
  if (!brief.evidencePresent) {
    return [`production_launch_operator_brief: run python3 scripts/generate_stage1_production_launch_operator_brief.py`];
  }
  const matrixActions = brief.blockerMatrix
    .filter((row) => row.status !== "pass")
    .slice(0, 4)
    .map((row) => `production_launch_operator_brief:${row.blockerId}: ${row.operatorNextActions[0] ?? row.firstBlocker}`);
  return matrixActions.length > 0
    ? matrixActions
    : brief.operatorNextActions.slice(0, 4).map((action) => `production_launch_operator_brief: ${action}`);
}

function summarizeProductionMissingInputChecklistActions(checklist: Stage1ProductionMissingInputChecklist): string[] {
  if (!checklist.evidencePresent) {
    return [`production_missing_input_checklist: run python3 scripts/generate_stage1_production_missing_input_checklist.py`];
  }
  const itemActions = checklist.items
    .filter((row) => row.status === "missing" || row.status === "invalid")
    .slice(0, 4)
    .map((row) => `production_missing_input_checklist:${row.groupId}:${row.displayName}: ${row.operatorAction}`);
  return itemActions.length > 0
    ? itemActions
    : checklist.operatorNextActions.slice(0, 4).map((action) => `production_missing_input_checklist: ${action}`);
}

function summarizeProductionActionMatrixActions(matrix: Stage1ProductionActionMatrix): string[] {
  if (!matrix.evidencePresent) {
    return [`production_action_matrix: run python3 scripts/generate_stage1_production_action_matrix.py`];
  }
  const helpActions = matrix.immediateHelpQueue
    .slice(0, 4)
    .map((row) => `production_action_matrix:${row.laneId}: ${row.ask}`);
  if (helpActions.length > 0) {
    return helpActions;
  }
  return matrix.lanes
    .filter((row) => row.status !== "ready")
    .slice(0, 4)
    .map((row) => `production_action_matrix:${row.laneId}: ${row.immediateAction}`);
}

function summarizeProductionInputTemplateActions(template: Stage1ProductionInputTemplate): string[] {
  if (!template.evidencePresent) {
    return [`production_input_template: run python3 scripts/generate_stage1_production_input_template.py`];
  }
  if (!template.templatePresent) {
    return [`production_input_template: regenerate ${template.sourcePath} with ${template.generatorCommand}`];
  }
  return [
    `production_input_template: fill ${template.requiredTemplateVariableCount} required variable slots in a private gitignored env file, then run ${template.validatorCommand}`,
    ...template.groups
      .filter((group) => group.requiredTemplateVariableCount > 0)
      .slice(0, 3)
      .map(
        (group) =>
          `production_input_template:${group.groupId}: ${group.requiredTemplateVariableCount} required slots / ${group.optionalOrDefaultedCount} optional or defaulted`
      )
  ].slice(0, 4);
}

function summarizeProductionNonClearingRefreshActions(refresh: Stage1ProductionNonClearingRefresh): string[] {
  if (!refresh.evidencePresent) {
    return [`production_non_clearing_refresh: run ${refresh.generatorCommand}`];
  }
  if (refresh.stepSummary.unexpectedExitCount > 0 || refresh.stepSummary.failed > 0) {
    return [`production_non_clearing_refresh: rerun ${refresh.generatorCommand}, then ${refresh.validatorCommand}`];
  }
  return [
    `production_non_clearing_refresh: ${refresh.stepSummary.passed}/${refresh.stepSummary.total} steps passed, ${refresh.stepSummary.blocked} expected blockers remain`,
    `production_non_clearing_refresh: production inputs ${refresh.progress.productionInputs.configured}/${refresh.progress.productionInputs.total} (${refresh.progress.productionInputs.completionPercent}%)`,
    `production_non_clearing_refresh: source probes ${refresh.progress.productionSourceProbes.ready}/${refresh.progress.productionSourceProbes.total} ready`
  ];
}

function summarizeStage1NextBlockersSummaryActions(summary: Stage1NextBlockersSummary): string[] {
  if (!summary.evidencePresent) {
    return [`stage1_next_blockers_summary: run ${summary.topPriorityAction.command}`];
  }
  return [
    `stage1_next_blockers_summary:${summary.topPriorityAction.actionId}: ${summary.topPriorityAction.why}`,
    `stage1_next_blockers_summary: Stage1 ${summary.stage1.completed}/${summary.stage1.total} (${summary.stage1.completionPercent}%), production inputs ${summary.productionInputs.configured}/${summary.productionInputs.total} (${summary.productionInputs.completionPercent}%), source probes ${summary.productionSourceProbes.ready}/${summary.productionSourceProbes.total}`
  ];
}

function summarizeProductionBlockerAuditActions(audit: Stage1ProductionBlockerAudit): string[] {
  if (!audit.evidencePresent) {
    return [`production_blocker_audit: run python3 scripts/generate_stage1_production_blocker_audit.py`];
  }
  return audit.productionSourceAudit
    .filter((row) => row.status !== "present")
    .slice(0, 4)
    .map((row) => `production_blocker_audit:${row.probeId}: ${row.operatorAction}`);
}

function summarizeProductionDnsDetailActions(dnsDetail: Stage1ProductionDnsDetail): string[] {
  if (!dnsDetail.readinessPresent && !dnsDetail.cutoverPlanPresent) {
    return [`production_dns: run python3 scripts/stage1_production_dns_readiness.py and python3 scripts/stage1_production_dns_cutover_plan.py`];
  }
  if (!dnsDetail.repairPacket.evidencePresent) {
    return [
      `production_dns_repair_packet: run python3 scripts/generate_stage1_production_dns_repair_packet.py and python3 scripts/validate_stage1_production_dns_repair_packet.py`
    ];
  }
  if (dnsDetail.repairPacket.evidencePresent && dnsDetail.repairPacket.operatorNextActions.length > 0) {
    return dnsDetail.repairPacket.operatorNextActions.slice(0, 3).map((action) => `production_dns_repair_packet: ${action}`);
  }
  const nextActions = dnsDetail.operatorNextActions.slice(0, 3).map((action) => `production_dns: ${action}`);
  if (nextActions.length > 0) {
    return nextActions;
  }
  return dnsDetail.blockedChecks.slice(0, 3).map((blocker) => `production_dns: ${blocker}`);
}

function summarizeProductionLaunchInputPacketActions(packet: Stage1ProductionLaunchInputPacket): string[] {
  if (!packet.evidencePresent) {
    return [`production_launch_input_packet: run python3 scripts/generate_stage1_production_launch_input_packet.py`];
  }
  return packet.sourceInputs
    .filter((row) => row.status !== "present")
    .slice(0, 4)
    .map((row) => `production_launch_input_packet:${row.probeId}: provide ${row.missingInput}`);
}

function summarizeProductionLaunchSourcePipelineActions(pipeline: Stage1ProductionLaunchSourcePipeline): string[] {
  if (!pipeline.evidencePresent) {
    return [`production_launch_source_pipeline: run python3 scripts/run_stage1_production_launch_source_pipeline.py || test $? -eq 2`];
  }
  if (pipeline.status === "pass" && pipeline.releaseGateDecision === "go") {
    return [`production_launch_source_pipeline: source pipeline pass; run ${pipeline.strictValidator}`];
  }
  return pipeline.blockedChecks
    .slice(0, 4)
    .map((blocker) => `production_launch_source_pipeline: ${blocker}`);
}

function summarizeProductionProofBundleActions(bundle: Stage1ProductionProofBundle): string[] {
  if (!bundle.evidencePresent) {
    return [`production_proof_bundle: run python3 scripts/run_stage1_production_proof_bundle.py || test $? -eq 2`];
  }
  if (bundle.status === "pass" && bundle.releaseGateDecision === "go") {
    return [`production_proof_bundle: proof bundle pass; run ${bundle.strictValidator}`];
  }
  const firstInputs = bundle.inputCoverage.firstMissingOrInvalidInputs
    .slice(0, 4)
    .map((input) => `production_proof_bundle: provide ${input}`);
  return firstInputs.length > 0 ? firstInputs : bundle.blockedChecks.slice(0, 4).map((blocker) => `production_proof_bundle: ${blocker}`);
}

function summarizeProductionProofDiagnosticsActions(diagnostics: Stage1ProductionProofDiagnostics): string[] {
  return diagnostics.diagnostics
    .filter((diagnostic) => diagnostic.status !== "pass" || !diagnostic.canonicalSourceWritten)
    .slice(0, 3)
    .map((diagnostic) => {
      const blocker = diagnostic.blockedChecks[0] ?? "canonical source not written";
      return `production_proof_diagnostics:${diagnostic.proofId}: ${blocker}`;
    });
}

function summarizeProductionOperatorPacketActions(packets: Stage1ProductionOperatorPacket[]): string[] {
  return packets
    .filter((packet) => packet.status !== "pass" && packet.releaseGateDecision !== "go")
    .slice(0, 4)
    .map((packet) => {
      if (!packet.evidencePresent) {
        return `production_operator_packet:${packet.packetId}: run packet generator`;
      }
      return `production_operator_packet:${packet.packetId}: ${packet.proof.firstBlocker || packet.sourceProbe.firstBlocker || packet.blockedUntil[0] || "blocked"}`;
    });
}

function summarizeAggregateAction(label: "staging" | "production", evidence: Stage1AggregateEvidence): string[] {
  if (evidence.status === "pass" && evidence.releaseGateDecision === "go") {
    return [`${label}: strict aggregate validator is go; keep exact evidence attached before release notes change`];
  }
  const blockers = evidence.blockers.slice(0, 3);
  if (blockers.length > 0) {
    return blockers.map((blocker) => `${label}: ${blocker}`);
  }
  return [`${label}: run ${evidence.validatorCommands[0] ?? "strict aggregate validator"} and attach exact evidence`];
}

function newestTimestamp(left: string, right: string): string {
  if (left === "unknown") {
    return right;
  }
  if (right === "unknown") {
    return left;
  }
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function newestTimestampFromList(values: string[]): string {
  return values.reduce((newest, value) => newestTimestamp(newest, value), "unknown");
}

function aggregateEnvironment(
  value: unknown,
  fallback: Stage1AggregateEvidence["environment"]
): Stage1AggregateEvidence["environment"] {
  if (value === "staging" || value === "production") {
    return value;
  }
  return fallback;
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isRecord(item)) : [];
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, child === true]));
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stringValue(item, "unknown")]));
}

function numberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, numberValue(item, 0)]));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function externalResourceLane(value: unknown): Stage1ExternalResourceGroup["lane"] {
  if (value === "provider" || value === "staging" || value === "ci" || value === "production") {
    return value;
  }
  return "unknown";
}

function externalResourceStatus(value: unknown): Stage1ExternalResourceGroup["status"] {
  if (value === "ready" || value === "provided_unverified" || value === "blocked" || value === "missing") {
    return value;
  }
  return "unknown";
}

function productionSourceProbeStatus(value: unknown): Stage1ProductionSourceProbeRequirement["status"] {
  if (value === "present" || value === "missing") {
    return value;
  }
  return "unknown";
}

function proofBundleRequirementStatus(value: unknown): Stage1ProductionProofBundleRequirement["status"] {
  if (value === "configured" || value === "missing" || value === "invalid") {
    return value;
  }
  return "unknown";
}

function closureQueueLane(value: unknown): Stage1EvidenceClosureQueueRow["lane"] {
  if (value === "staging" || value === "ci" || value === "production") {
    return value;
  }
  return "unknown";
}

function closureQueueRowStatus(value: unknown): Stage1EvidenceClosureQueueRow["rowStatus"] {
  if (value === "open" || value === "passed") {
    return value;
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function adminBillingOperationFixtures(): AdminBillingOperation[] {
  return [
    {
      id: "admin_billing_op_manual_credit_fixture_1",
      tenant_id: "tenant_1",
      actor_id: "admin_operator_1",
      target_user_id: "user_301",
      operation: "manual_credit",
      idempotency_key: "admin-billing-manual-credit-fixture-1",
      status: "recorded",
      units: 120,
      bucket_id: "monthly_generation",
      rationale: "Support-approved refund for failed export credits.",
      metadata: {
        ticket_id: "ticket_billing_301",
        audit_action: "billing.manual_credit"
      },
      created_at: "2026-06-22T10:05:00Z",
      updated_at: "2026-06-22T10:05:00Z"
    },
    {
      id: "admin_billing_op_refund_note_fixture_1",
      tenant_id: "tenant_1",
      actor_id: "admin_operator_1",
      target_user_id: "user_302",
      operation: "refund_note",
      idempotency_key: "admin-billing-refund-note-fixture-1",
      status: "recorded",
      subscription_id: "sub_test_refund_note",
      provider: "stripe",
      provider_ref: "re_test_refund_note",
      rationale: "Stripe refund reconciled to support ticket.",
      note: "Refund note recorded without raw secret material.",
      metadata: {
        ticket_id: "ticket_billing_302",
        audit_action: "billing.refund_note"
      },
      created_at: "2026-06-22T10:10:00Z",
      updated_at: "2026-06-22T10:10:00Z"
    },
    {
      id: "admin_billing_op_subscription_sync_fixture_1",
      tenant_id: "tenant_1",
      actor_id: "admin_operator_1",
      target_user_id: "user_303",
      operation: "sync_subscription",
      idempotency_key: "admin-billing-subscription-sync-fixture-1",
      status: "succeeded",
      subscription_id: "sub_test_subscription_sync",
      provider: "stripe",
      provider_ref: "evt_test_subscription_updated",
      rationale: "Replay subscription state after webhook reconciliation.",
      metadata: {
        ticket_id: "ticket_billing_303",
        audit_action: "billing.subscription_sync"
      },
      created_at: "2026-06-22T10:15:00Z",
      updated_at: "2026-06-22T10:15:00Z"
    },
    {
      id: "admin_billing_op_account_lock_fixture_1",
      tenant_id: "tenant_1",
      actor_id: "admin_operator_1",
      target_user_id: "user_304",
      operation: "account_lock",
      idempotency_key: "admin-billing-account-lock-fixture-1",
      status: "recorded",
      locked: true,
      rationale: "Temporary billing hold after repeated payment failure.",
      metadata: {
        ticket_id: "ticket_billing_304",
        audit_action: "billing.account_lock"
      },
      created_at: "2026-06-22T10:20:00Z",
      updated_at: "2026-06-22T10:20:00Z"
    }
  ];
}

function providerRegistryFixture(): ProviderRegistryEntry[] {
  return providerHealth.map((item) => {
    const providerID = fixtureProviderID(item.provider, item.id);
    return {
      provider_id: providerID,
      display_name: item.provider,
      mode: item.provider === "Internal" ? "dev" : "sandbox",
      status: item.status === "blocked" ? "kill_switch" : "enabled",
      secret_ref: item.provider === "Internal" ? "" : `secrets/provider/${item.id}`,
      capabilities: [
        {
          provider_id: providerID,
          model_id: item.model,
          endpoints: ["image.generate"],
          input_types: ["prompt"],
          output_types: ["image"],
          tool_types: ["generate"],
          max_cost_units: Math.max(0, Math.round(item.spendCapUsedPercent / 10)),
          cost_currency: "USD",
          estimated_cost_cents: Math.max(0, Math.round(item.spendCapUsedPercent)),
          supports_batch: true,
          max_batch_size: 20,
          supports_seed: true,
          supports_cancel: item.status !== "blocked",
          supported_aspect_ratios: ["1:1"],
          supported_qualities: ["draft"]
        }
      ],
      routing: {
        weight: item.status === "blocked" ? 0 : 100,
        canary_percent: item.status === "healthy" ? 10 : 0,
        max_concurrency: item.status === "blocked" ? 0 : 4,
        fallback_provider_ids: [],
        kill_switch: item.status === "blocked"
      },
      health: {
        available: item.status === "healthy",
        latency_ms: item.p95LatencyMs,
        error_rate_percent: Math.round(item.errorRate * 100),
        last_checked_at: "2026-06-21T10:00:00Z",
        message: item.routingAction
      },
      secret_present: item.provider !== "Internal",
      updated_at: "2026-06-21T10:00:00Z"
    };
  });
}

function providerStrategyGroupFixture(): ProviderStrategyGroup[] {
  const providers = providerRegistryFixture();
  const sandbox = providers.find((provider) => provider.provider_id === "z-ai");
  const dev = providers.find((provider) => provider.provider_id === "internal");
  return [
    {
      group_id: "image-generation-default",
      display_name: "Image generation default",
      tool_type: "generate",
      status: sandbox?.status === "kill_switch" ? "kill_switch" : "enabled",
      selection_policy: sandbox?.status === "kill_switch" ? "failover" : "weighted",
      fallback_provider_ids: dev ? [dev.provider_id] : [],
      kill_switch: sandbox?.status === "kill_switch",
      members: [
        ...(sandbox
          ? [
              {
                provider_id: sandbox.provider_id,
                weight: sandbox.status === "kill_switch" ? 0 : 90,
                canary_percent: sandbox.status === "kill_switch" ? 0 : 10,
                max_concurrency: sandbox.routing.max_concurrency,
                fallback_rank: 0,
                enabled: sandbox.status !== "kill_switch"
              }
            ]
          : []),
        ...(dev
          ? [
              {
                provider_id: dev.provider_id,
                weight: sandbox?.status === "kill_switch" ? 100 : 10,
                canary_percent: 0,
                max_concurrency: dev.routing.max_concurrency,
                fallback_rank: 1,
                enabled: true
              }
            ]
          : [])
      ],
      metadata: {
        routing_surface: "batch_generation",
        evidence: "fixtures/stage1/provider_registry/sandbox_registry.json"
      },
      created_at: "2026-06-22T10:00:00Z",
      updated_at: "2026-06-22T10:00:00Z"
    }
  ];
}

function fixtureProviderID(providerName: string, fallback: string) {
  return providerName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback;
}
