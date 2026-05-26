import {
  adminReviewDecisions,
  abuseEvents,
  auditEvents,
  crawlerFindings,
  exportJobs,
  feedbackItems,
  incidentLogs,
  maintenanceBanners,
  metaPrompts,
  promptFragments,
  providerHealth,
  quotaAccounts,
  queueHealth,
  releaseEvidence,
  riskyExports,
  skillVersions,
  skills,
  supportTickets,
  supportUsers,
  traces
} from "@/lib/fixtures";

export async function getSkills() {
  return skills;
}

export async function getSkillVersions() {
  return skillVersions;
}

export async function getAdminReviewDecisions() {
  return adminReviewDecisions;
}

export async function getCrawlerFindings() {
  return crawlerFindings;
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

export async function getExportJob(id: string) {
  return exportJobs.find((job) => job.id === id) ?? exportJobs[0];
}

export async function getSupportUsers() {
  return supportUsers;
}

export async function getSupportTickets() {
  return supportTickets;
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

export async function getAuditEvents() {
  return auditEvents;
}

export async function getIncidentLogs() {
  return incidentLogs;
}

export async function getMaintenanceBanners() {
  return maintenanceBanners;
}
