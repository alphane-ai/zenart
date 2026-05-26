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

export type CrawlerSourceApproval = {
  id: string;
  sourceId: string;
  sourceName: string;
  linkedFindingId: string;
  status: "pending" | "approved" | "blocked" | "rejected";
  requester: string;
  requiredRole: "admin_operator" | "admin_reviewer" | "admin_superadmin";
  attemptedRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  rbacDecision: "allowed" | "denied" | "second_review_required";
  legalMetadataStatus: "complete" | "incomplete" | "blocked";
  robotsEvidence: string;
  allowedContent: string;
  derivativeUsePolicy: string;
  exactTextPolicy: string;
  rawRetentionDays: number;
  rateLimitPolicy: string;
  activationGate: "allowed" | "blocked" | "requires_review";
  requiredEvidenceRefs: string[];
  reviewerRationale: string;
  auditRef: string;
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
  fixtureCaseId: string;
  operatorNextAction: string;
  closureCriteria: string;
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

export type RegressionFixtureStatus =
  | "candidate"
  | "converted"
  | "eval_blocking"
  | "resolved";

export type RegressionFixture = {
  id: string;
  sourceFeedbackId: string;
  sourceKind: "admin_bad_sample" | "support_ticket" | "qa_warning" | "export_failure";
  fixturePath: string;
  workflowId: string;
  skillVersionId: string;
  failureMode:
    | "brand_similarity"
    | "structured_text_readability"
    | "export_manifest_completeness"
    | "safety_policy_miss";
  severity: RiskLevel;
  status: RegressionFixtureStatus;
  evalSuiteId: string;
  requiredGate: "skill_canary" | "prompt_activation" | "production_launch";
  expectedAssertion: string;
  owner: string;
  linkedCanaryMetric: string;
  linkedAuditRef: string;
  reviewerRationale: string;
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

export type OperationalDashboard = {
  id: string;
  name:
    | "provider_latency_error"
    | "queue_dead_letter"
    | "export_failure"
    | "quota_anomaly"
    | "safety_spike"
    | "crawler_policy_violation"
    | "admin_security";
  ownerRole: AdminRole;
  status: "healthy" | "watch" | "blocked";
  window: string;
  currentValue: string;
  sloThreshold: string;
  linkedSystems: string[];
  sourceSignals: string[];
  releaseGateUse: string;
  runtimeEnvironment: "local" | "ci" | "staging" | "production";
  runtimeEvidenceStatus: "definition_only" | "imported" | "verified" | "blocked";
  runtimeEvidenceRef: string;
  runtimeValidatedAt: string;
  evidenceRefs: string[];
};

export type AlertRoute = {
  id: string;
  dashboardId: string;
  severity: "sev1" | "sev2" | "sev3";
  status: "armed" | "firing" | "muted" | "resolved";
  threshold: string;
  routeTarget: string;
  escalationRole: AdminRole;
  runbook: string;
  runtimeEnvironment: "local" | "ci" | "staging" | "production";
  runtimeEvidenceStatus: "definition_only" | "configured" | "verified" | "blocked";
  runtimeEvidenceRef: string;
  runtimeValidatedAt: string;
  incidentRef: string;
  auditRef: string;
  evidenceRefs: string[];
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
  idempotencyScope: string;
  retryBackoffPolicy: string;
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
  requestedByRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  rbacDecision: "allowed" | "denied" | "second_review_required";
  idempotencyKey: string;
  quotaEffect: "none" | "refund_pending" | "refund_on_cancel" | "reserved_credit_released";
  closureEvidenceRefs: string[];
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

export type SupportLookupAction = {
  scope:
    | "read_profile"
    | "quota_credit"
    | "retry_failed_task"
    | "export_regenerate"
    | "temporary_hold";
  requiredRole: AdminRole;
  decision: "allowed" | "requires_review" | "blocked";
  evidenceRefs: string[];
  auditRef: string;
  rationale: string;
};

export type SupportUser = {
  id: string;
  email: string;
  plan: string;
  tenantId: string;
  accountStatus: "active" | "held" | "rate_limited";
  projects: number;
  projectIds: string[];
  recentTasks: number;
  taskIds: string[];
  traces: string[];
  exportIds: string[];
  ticketIds: string[];
  quotaAccountRef: string;
  lookupKeys: string[];
  riskFlags: string[];
  privacyRedaction: string;
  auditRefs: string[];
  lookupActions: SupportLookupAction[];
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

export type AbuseControlHook = {
  id: string;
  abuseEventId: string;
  userId: string;
  triggerSource: "abuse_queue" | "support_ticket" | "crawler_rate_limit" | "safety_block";
  action: "rate_limit" | "temporary_hold" | "crawler_import_hold" | "quota_hold";
  targetSurface: "generation" | "crawler_import" | "export_share" | "quota";
  enforcementPoint: "api_gateway" | "worker_scheduler" | "crawler_scheduler" | "export_service";
  state: "armed" | "active" | "expired" | "released";
  executionMode: "dry_run" | "enforced";
  lastDryRunEvidence: string;
  hookPayload: string;
  threshold: string;
  telemetrySignal: string;
  userVisibleState: string;
  durationMinutes: number;
  expiresAt: string;
  rollbackAction: string;
  releaseCondition: string;
  releaseEvidenceRefs: string[];
  requiredRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  attemptedRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  rbacDecision: "allowed" | "denied";
  supportTicketId: string;
  evidenceRefs: string[];
  auditRef: string;
  operatorRunbook: string;
};

export type AbuseRuntimeDecision = {
  hookId: string;
  abuseEventId: string;
  userId: string;
  action: AbuseControlHook["action"];
  enforcementPoint: AbuseControlHook["enforcementPoint"];
  evaluatedAt: string;
  runtimeStatus: "enforced" | "dry_run_denied" | "expired" | "released";
  requestOutcome:
    | "deny_423_account_hold"
    | "throttle_429_rate_limited"
    | "allow_read_only"
    | "allow"
    | "dry_run_only";
  queueAction:
    | "hold_until_release_evidence"
    | "throttle_until_review"
    | "escalate_security_review"
    | "release_after_evidence"
    | "no_action";
  canCreateQuotaConsumingTask: boolean;
  userVisibleState: string;
  requiredRole: AdminRole;
  attemptedRole: AdminRole;
  rbacDecision: "allowed" | "denied";
  expiresAt: string;
  auditRef: string;
  evidenceRefs: string[];
  rationale: string;
};

export type AbuseQueueRuntimeEntry = {
  abuseEventId: string;
  userId: string;
  category: AbuseEvent["category"];
  severity: RiskLevel;
  assignedRole: AbuseEvent["assignedRole"];
  runtimeStatus: "controlled" | "queued_for_review" | "blocked_by_rbac";
  activeHookIds: string[];
  closureAllowed: boolean;
  blockingReason: string;
  nextAction: string;
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
