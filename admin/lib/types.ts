export type StatusTone = "ok" | "warn" | "danger" | "info";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type AdminReviewSurface =
  | "skill_release"
  | "crawler_import"
  | "prompt_approval"
  | "provider_routing"
  | "quota_override"
  | "safety_rule"
  | "export_override";

export type AdminRole =
  | "support_operator"
  | "admin_viewer"
  | "admin_operator"
  | "admin_reviewer"
  | "admin_superadmin";

export type AdminSession = {
  id: string;
  name: string;
  role: "local-dev-admin";
  environment: "local/dev";
};

export type Skill = {
  id: string;
  name: string;
  domain: string;
  activeVersion: string;
  owner: string;
  status: "active" | "suspended";
  risk: RiskLevel;
  updatedAt: string;
};

export type SkillReleaseState =
  | "draft"
  | "review"
  | "eval_passed"
  | "internal_canary"
  | "allowlist_canary"
  | "percent_canary"
  | "active"
  | "paused"
  | "rolled_back"
  | "deprecated";

export type SkillReleaseStateDefinition = {
  state: SkillReleaseState;
  entryCriteria: string;
  allowedNextStates: SkillReleaseState[];
  adminAction: string;
  rollbackAllowed: boolean;
  auditRequirement: string;
};

export type SkillTrafficAllocation = {
  internalPercent: number;
  allowlistPercent: number;
  publicPercent: number;
  holdoutPercent: number;
  routeEvidence: string;
};

export type SkillVersion = {
  id: string;
  skillId: string;
  version: string;
  status: SkillReleaseState;
  reviewer: string;
  secondReviewRequired: boolean;
  secondReviewer: string;
  reviewerRationale: string;
  evalSummary: string;
  provenance: string;
  rollbackPlan: string;
  canaryPercent: number;
  trafficAllocation: SkillTrafficAllocation;
  canaryEvidence: string;
  releaseEvidence: string;
  rollbackTarget: string;
  rollbackAuditRef: string;
};

export type SkillCanaryMetricName =
  | "task_success"
  | "provider_failure"
  | "cost_per_package"
  | "selection_rate"
  | "iteration_rate"
  | "package_add_rate"
  | "export_success"
  | "qa_warning_blocking"
  | "safety_block"
  | "user_rating"
  | "admin_bad_sample"
  | "regression_fixture_pass_rate";

export type SkillCanaryMetric = {
  id: string;
  skillVersionId: string;
  metric: SkillCanaryMetricName;
  window: string;
  value: string;
  target: string;
  sampleSize: number;
  status: "healthy" | "watch" | "stop";
  stopThreshold: string;
  stopAction: "continue" | "pause_release" | "rollback";
  criticalSafetyRegression: boolean;
  auditRef: string;
};

export type CrawlerFinding = {
  id: string;
  source: string;
  type: "source" | "finding";
  status: "pending" | "approved" | "blocked";
  provenance: string;
  riskLabels: string[];
};

export type CrawlerGovernanceWorkflow = {
  id: string;
  findingId: string;
  requestType: "source_takedown" | "derivative_review" | "raw_retention_delete";
  status: "intake" | "evidence_review" | "approved" | "blocked" | "deleted";
  requester: string;
  sourceContact: string;
  derivativeUseStatus: "allowed" | "restricted" | "unknown" | "blocked";
  rawRetentionAction: "retain_with_limit" | "delete_raw" | "delete_raw_and_derivatives";
  linkedReview: string;
  requiredEvidenceRefs: string[];
  blockedActivation: boolean;
  reviewerRole: "admin_operator" | "admin_reviewer" | "admin_superadmin";
  reviewRationale: string;
  auditRef: string;
};

export type PromptFragment = {
  id: string;
  name: string;
  surface: "prompt-fragment" | "meta-prompt" | "image-spec";
  status: "review" | "approved" | "blocked";
  diffSummary: string;
  evalSummary: string;
  risk: RiskLevel;
};

export type TraceStep = {
  at: string;
  stage: string;
  provider: string;
  model: string;
  status: "completed" | "retrying" | "blocked";
  latencyMs: number;
  costUsd: number;
};

export type AgentTrace = {
  id: string;
  workflowId: string;
  userId: string;
  skillVersion: string;
  promptVersion: string;
  assetId: string;
  exportId: string;
  status: "completed" | "retrying" | "blocked";
  steps: TraceStep[];
};

export type FeedbackItem = {
  id: string;
  kind:
    | "select"
    | "reject"
    | "iterate"
    | "edit"
    | "package_add"
    | "export"
    | "rating"
    | "text_feedback"
    | "qa_warning"
    | "export_failure"
    | "admin_label"
    | "support_ticket";
  status: "open" | "resolved";
  attribution: string;
  signal: string;
  delayed: boolean;
  filterDecision: "eligible" | "hold" | "discard";
  weight: number;
  weightingReason: string;
  availableForLearningAt: string;
  blockedReason: string;
  regressionFixtureRef: string;
};

export type AnalyticsReport = {
  id: string;
  name:
    | "first_prompt_to_four_candidates"
    | "selection_rate"
    | "iteration_rate"
    | "package_add_export_completion"
    | "weekly_return"
    | "qa_warning_block"
    | "cost_per_successful_package"
    | "support_ticket_failure_rate";
  window: string;
  value: string;
  target: string;
  status: "healthy" | "watch" | "blocked";
  sampleSize: number;
  segment: string;
  sourceEvents: string[];
  decisionUse: string;
};

export type ProviderHealth = {
  id: string;
  provider: string;
  model: string;
  status: "healthy" | "degraded" | "blocked";
  p95LatencyMs: number;
  errorRate: number;
  spendCapUsedPercent: number;
  routingAction: string;
  contractEvidence: string;
  canaryEvidence: string;
  releaseEvidence: string;
};

export type QueueHealth = {
  id: string;
  name: string;
  pending: number;
  running: number;
  deadLetters: number;
  oldestAgeMinutes: number;
  action: string;
  retryPolicy: string;
  cancelPolicy: string;
  ownerRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  linkedIncident: string;
  auditRef: string;
};

export type ExportJob = {
  id: string;
  userId: string;
  packageId: string;
  status: "completed" | "failed" | "retrying" | "blocked";
  qaSeverity: "info" | "warning" | "blocking";
  regenerateEligible: boolean;
  failureReason: string;
};

export type FailedTaskControl = {
  id: string;
  queueId: string;
  userId: string;
  projectId: string;
  traceId: string;
  supportTicketId: string;
  status: "failed" | "retrying" | "cancelled" | "blocked";
  retryCount: number;
  maxRetries: number;
  timeoutSeconds: number;
  errorCode: string;
  userMessage: string;
  appVersion: string;
  workerVersion: string;
  schemaVersion: string;
  requestedAction: "retry" | "cancel" | "hold";
  actionEligibility: "eligible" | "requires_review" | "blocked";
  allowedRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  operatorRunbook: string;
  auditRef: string;
};

export type SupportTicket = {
  id: string;
  status: "open" | "waiting_user" | "resolved" | "escalated";
  priority: "low" | "medium" | "high" | "critical";
  userId: string;
  projectId: string;
  taskId: string;
  traceId: string;
  assetId: string;
  exportId: string;
  quotaTransactionId: string;
  subject: string;
  nextAction: string;
  auditRef: string;
};

export type SupportEscalationRunbook = {
  ticketId: string;
  readiness: "ready" | "blocked" | "waiting_user";
  escalationRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  owner: string;
  dueAt: string;
  customerUpdateCadence: string;
  customerMessage: string;
  runbook: string;
  requiredEvidenceRefs: string[];
  closureBlockers: string[];
};

export type SupportUser = {
  id: string;
  email: string;
  plan: string;
  projects: number;
  recentTasks: number;
  traces: string[];
  riskFlags: string[];
};

export type QuotaAccount = {
  userId: string;
  balance: number;
  reserved: number;
  monthlyLimit: number;
  anomaly: string;
  lastTransaction: string;
};

export type RiskyExport = {
  id: string;
  exportId: string;
  rule: string;
  enforcementPoint: "brief" | "provider_request" | "provider_response" | "qa" | "export";
  severity: RiskLevel;
  action: "warn" | "require_admin_review" | "block";
  overrideEligible: boolean;
  auditRequired: boolean;
  reviewRationale: string;
  secondReviewRequired: boolean;
};

export type AbuseEvent = {
  id: string;
  userId: string;
  category:
    | "generation_spike"
    | "quota_drain"
    | "safety_blocks"
    | "prompt_injection"
    | "hidden_prompt_extraction"
    | "brand_impersonation"
    | "crawler_abuse"
    | "export_share_abuse";
  severity: RiskLevel;
  resolution: "open" | "rate_limited" | "temporary_hold" | "resolved";
  evidence: string;
  assignedRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  allowedActions: string[];
  linkedSupportTicket: string;
  reviewRationale: string;
  auditRef: string;
};

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  risk: RiskLevel;
  createdAt: string;
  rationale: string;
  immutable: true;
  evidenceRefs: string[];
  secondReviewStatus: "not_required" | "required" | "completed" | "blocked";
};

export type AdminReviewDecision = {
  id: string;
  surface: AdminReviewSurface;
  target: string;
  status: "pending" | "approved" | "blocked" | "second_review_required";
  risk: RiskLevel;
  reviewer: string;
  secondReviewer: string;
  secondReviewRequired: boolean;
  rationale: string;
  diffSummary: string;
  provenance: string;
  evalSummary: string;
  qaSummary: string;
  evidenceRefs: string[];
  createdAt: string;
};

export type AdminRbacEvidence = {
  id: string;
  surface: AdminReviewSurface;
  target: string;
  requiredRole: AdminRole;
  attemptedRole: AdminRole;
  decision: "allowed" | "denied" | "second_review_required";
  secondReviewRequired: boolean;
  secondReviewStatus: "not_required" | "required" | "completed" | "blocked";
  rationale: string;
  auditRef: string;
  evidenceRefs: string[];
};

export type ReleaseEvidence = {
  id: string;
  target: string;
  gate: "local_alpha" | "private_beta" | "production_launch";
  status: "passed" | "blocked" | "missing";
  providerEvidence: string;
  canaryEvidence: string;
  releaseEvidence: string;
  smokeEvidence: string;
  rollbackEvidence: string;
  reviewerRationale: string;
  rollbackTarget: string;
  auditRef: string;
};

export type IncidentLog = {
  id: string;
  severity: "sev1" | "sev2" | "sev3";
  status: "open" | "mitigating" | "resolved";
  startedAt: string;
  detectedBy: string;
  impactedSystems: string[];
  customerImpact: string;
  mitigation: string;
  owner: string;
  nextUpdateAt: string;
  linkedQueues: string[];
  linkedSupportTickets: string[];
  auditRefs: string[];
  rollbackPlan: string;
};

export type MaintenanceBanner = {
  id: string;
  status: "draft" | "scheduled" | "active" | "expired";
  scope: "admin" | "web" | "all";
  audience: "internal" | "private_beta" | "all_users";
  message: string;
  startsAt: string;
  endsAt: string;
  owner: string;
  approval: string;
  auditRef: string;
};
