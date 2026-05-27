import {
  adminReviewDecisions,
  adminRbacEvidence,
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
  observabilityTelemetryRuntimeEvidence,
  metaPrompts,
  operationalDashboards,
  productionActivationReviewAuditEvidence,
  productionAbuseThrottleHoldEvidence,
  productionSecurityLaunchCheckEvidence,
  productionSkillReleaseEvalCanaryEvidence,
  stagingEvalQaSafetyEvidence,
  stagingQuotaRateLimitSpendCapEvidence,
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
  supportTickets,
  supportUsers,
  traces
} from "@/lib/fixtures";
import { buildAbuseQueueRuntime, buildAbuseRuntimeDecisions } from "@/lib/abuse-runtime";
import { buildAdminRbacRuntimeDecisions } from "@/lib/rbac-runtime";

export async function getSkills() {
  return skills;
}

export async function getSkillVersions() {
  return skillVersions;
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

export async function getAdminRbacRuntimeDecisions() {
  return buildAdminRbacRuntimeDecisions(adminRbacEvidence, new Date("2026-05-26T11:00:00Z"));
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

export async function getProviderHealth() {
  return providerHealth;
}

export async function getReleaseEvidence() {
  return releaseEvidence;
}

export async function getQueueHealth() {
  return queueHealth;
}

export async function getExportJobs() {
  return exportJobs;
}

export async function getFailedTaskControls() {
  return failedTaskControls;
}

export async function getStagingSupportRetryAbuseEvidence() {
  return stagingSupportRetryAbuseEvidence;
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

export async function getProductionActivationReviewAuditEvidence() {
  return productionActivationReviewAuditEvidence;
}

export async function getProductionSkillReleaseEvalCanaryEvidence() {
  return productionSkillReleaseEvalCanaryEvidence;
}

export async function getProductionSecurityLaunchCheckEvidence() {
  return productionSecurityLaunchCheckEvidence;
}

export async function getExportJob(id: string) {
  return exportJobs.find((job) => job.id === id) ?? exportJobs[0];
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

export async function getQuotaAccounts() {
  return quotaAccounts;
}

export async function getRiskyExports() {
  return riskyExports;
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

export async function getReleaseBlockers() {
  return releaseBlockers;
}

export async function getAnalyticsReports() {
  return analyticsReports;
}
