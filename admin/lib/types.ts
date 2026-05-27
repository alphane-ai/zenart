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
  requestedAt: string;
  dueAt: string;
  requester: string;
  sourceContact: string;
  derivativeUseStatus: "allowed" | "restricted" | "unknown" | "blocked";
  rawRetentionAction: "retain_with_limit" | "delete_raw" | "delete_raw_and_derivatives";
  deletionEvidenceRef: string;
  requesterNoticeRef: string;
  activationGateDecision: "allowed" | "blocked";
  linkedReview: string;
  fixtureCaseId: string;
  operatorNextAction: string;
  closureCriteria: string;
  requiredEvidenceRefs: string[];
  blockedActivation: boolean;
  reviewerRole: "admin_operator" | "admin_reviewer" | "admin_superadmin";
  secondReviewRequired: boolean;
  secondReviewStatus: "not_required" | "required" | "completed" | "rejected";
  reviewRationale: string;
  auditRef: string;
};

export type CrawlerGovernanceRuntimeDecision = {
  workflowId: string;
  findingId: string;
  requestType: CrawlerGovernanceWorkflow["requestType"];
  closureDecision: "ready_to_close" | "review_required" | "blocked";
  activationDecision: "allow_activation" | "block_activation";
  deletionEvidenceStatus: "complete" | "pending";
  requesterNoticeStatus: "complete" | "pending";
  secondReviewStatus: CrawlerGovernanceWorkflow["secondReviewStatus"];
  auditStatus: "attached" | "missing";
  requiredEvidenceStatus: "complete" | "missing";
  missingRequiredEvidenceRefs: string[];
  deadlineStatus: "within_window" | "expired" | "not_evaluated";
  blockerCodes: string[];
  operatorAction: string;
  closureEvidenceChecklist: string[];
  activationGuardrail: string;
  reviewEscalation: string;
  releaseGateEvidence: string;
  auditRef: string;
  requiredEvidenceRefs: string[];
};

export type CrawlerStagingRuntimeControlName =
  | "source_approval"
  | "robots"
  | "ssrf"
  | "rate_limit"
  | "retention"
  | "exact_text_warning"
  | "provenance"
  | "source_blocklist";

export type CrawlerStagingRuntimeControl = {
  control: CrawlerStagingRuntimeControlName;
  runtimeRef: string;
  status: "verified" | "blocked";
  enforcementPoint: "crawler_fetch_gate" | "crawler_import_gate" | "crawler_activation";
  linkedFindingId: string;
  sourceApprovalId: string;
  governanceWorkflowId: string;
  gateDecision: "allow" | "deny";
  probeResult: string;
  releaseGateUse: string;
  auditRef: string;
  evidenceRefs: string[];
};

export type CrawlerStagingRuntimeEvidence = {
  id: string;
  environment: "staging";
  status: "pass_with_blockers_preserved";
  validatedAt: string;
  validatedByRole: AdminRole;
  evidencePath: string;
  releaseGateCheckId: "staging_crawler_approval_provenance";
  controls: CrawlerStagingRuntimeControl[];
  remainingBlockers: string[];
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
  sourceKind: "admin_bad_sample" | "support_ticket" | "qa_warning" | "export_failure" | "failed_task";
  fixturePath: string;
  workflowId: string;
  skillVersionId: string;
  failureMode:
    | "brand_similarity"
    | "structured_text_readability"
    | "export_manifest_completeness"
    | "crawler_takedown_activation"
    | "crawler_derivative_review"
    | "failed_task_retry_cancel"
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

export type ProductionProviderModeCoverage = {
  area:
    | "provider_launch_mode"
    | "provider_contract_monitoring_cost"
    | "public_paid_real_generation_claims"
    | "gate_blocker_preservation";
  status: "pass" | "blocked";
  runtimeProbe: string;
  deploymentEvidence: string;
  providerAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type ProductionProviderModeEvidence = {
  id: string;
  environment: "production";
  status: "pass_with_blockers_preserved" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "production_provider_or_comp_only_mode";
  doNotLaunchConditionIds: ["dev_mock_provider_public_claims_unresolved", "real_provider_or_comp_only_mode_missing"];
  providerModeEvidencePath: "ops/evidence/production/provider-mode.json";
  publicClaimsEvidencePath: "ops/evidence/production/public-paid-real-generation-claims.json";
  runtimeRequestIds: string[];
  providerIds: string[];
  auditRefs: string[];
  coverage: ProductionProviderModeCoverage[];
  gateImpact: {
    checklistItems: string[];
    canClearCheckLevelItems: boolean;
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items";
    remainingBlockers: string[];
  };
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
    | "admin_security"
    | "legal_support_visibility";
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

export type OperationalDashboardRuntimeEvidence = {
  id: string;
  dashboardId: string;
  environment: "staging";
  validationStatus: "verified" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  importProbe: string;
  signalProbe: string;
  sloProbe: string;
  blockerProbe: string;
  releaseGateUse: string;
  auditRef: string;
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

export type AlertRouteRuntimeEvidence = {
  id: string;
  alertRouteId: string;
  dashboardId: string;
  environment: "staging";
  validationStatus: "verified";
  validatedAt: string;
  validatedByRole: AdminRole;
  routeBinding: string;
  deliveryProbe: string;
  thresholdProbe: string;
  escalationProbe: string;
  runbookProbe: string;
  incidentLinkage: string;
  auditRef: string;
  releaseGateUse: string;
  evidenceRefs: string[];
};

export type BackendMetricsRuntimeProbe = {
  service: "backend_api" | "worker" | "crawler";
  runtimeRef: string;
  validationStatus: "verified" | "blocked";
  scrapeTarget: string;
  requiredSignals: string[];
  sampleWindow: string;
  cardinalityProbe: string;
  sloProbe: string;
  releaseGateUse: string;
  auditRef: string;
  evidenceRefs: string[];
};

export type BackendMetricsRuntimeEvidence = {
  id: string;
  environment: "staging";
  status: "pass_with_blockers_preserved";
  validatedAt: string;
  validatedByRole: AdminRole;
  evidencePath: string;
  releaseGateCheckId: "staging_observability_backup_load";
  blueprintChecklistItem: "staging backend/worker/crawler metrics runtime evidence 通过。";
  canClearChecklistItem: boolean;
  aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items";
  probes: BackendMetricsRuntimeProbe[];
  remainingBlockers: string[];
};

export type ObservabilityTelemetryRuntimeControl = {
  area: "request_id_propagation" | "structured_json_logs" | "opentelemetry_traces";
  runtimeRef: string;
  validationStatus: "verified" | "blocked";
  services: Array<"admin_console" | "backend_api" | "worker" | "crawler">;
  propagationProbe: string;
  redactionProbe: string;
  traceLinkageProbe: string;
  releaseGateUse: string;
  auditRef: string;
  evidenceRefs: string[];
};

export type ObservabilityTelemetryRuntimeEvidence = {
  id: string;
  environment: "staging";
  status: "pass_with_blockers_preserved";
  validatedAt: string;
  validatedByRole: AdminRole;
  evidencePath: string;
  releaseGateCheckId: "staging_observability_backup_load";
  closedChecklistItems: Array<
    | "staging request id propagation runtime evidence 通过。"
    | "staging structured JSON logs runtime evidence 通过。"
    | "staging OpenTelemetry traces runtime evidence 通过。"
  >;
  canClearChecklistItems: boolean;
  aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items";
  controls: ObservabilityTelemetryRuntimeControl[];
  remainingBlockers: string[];
};

export type StagingObservabilityBackupLoadPreflightSlot = {
  slot: "observability_evidence" | "backup_restore_evidence" | "load_evidence" | "post_deploy_smoke_evidence";
  evidencePath: string;
  status: "verified" | "blocked";
  requiredEntries: string[];
  verifiedEntries: string[];
  missingEntries: string[];
  blockingReason: string;
  releaseGateUse: string;
  evidenceRefs: string[];
};

export type StagingObservabilityBackupLoadPreflightEvidence = {
  id: string;
  environment: "staging";
  status: "blocked" | "passed";
  releaseSha: string;
  releaseGateCheckId: "staging_observability_backup_load";
  evidencePath: string;
  latestPreflightReport: string;
  canClearAggregateItem: boolean;
  preservedDoNotLaunchConditionId: "staging_observability_restore_load_missing" | "none";
  preservedReleaseGateCheckId: "staging_observability_backup_load" | "none";
  slots: StagingObservabilityBackupLoadPreflightSlot[];
  operatorAction: string;
  releaseGateUse: string;
};

export type StagingObjectStorageRetentionCleanupCoverage = {
  area: "retention_policy" | "expired_export_cleanup" | "orphan_cleanup" | "audit_refs";
  status: "missing_runtime" | "pass" | "blocked";
  smokeScript: string;
  adminEndpoint: string;
  expectedTokens: string[];
  releaseShaBound: boolean;
  adminIdentityBound: boolean;
  requestIdEchoStatus: "echoed" | "missing" | "not_evaluated";
  responseBytes: number;
  blocker: string;
  releaseGateUse: string;
  evidenceRefs: string[];
};

export type StagingObjectStorageRetentionCleanupEvidence = {
  id: string;
  environment: "staging";
  status: "missing_runtime" | "pass" | "blocked";
  releaseGateCheckId: "staging_object_storage_signed_downloads";
  doNotLaunchConditionId: "object_storage_signed_retention_runtime_missing";
  evidencePath: "ops/evidence/staging/object-storage-retention-cleanup.json";
  requiredScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh";
  requiredArtifactPath: "ops/evidence/staging/object-storage-retention-cleanup.json";
  signedUrlEvidencePath: "ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json";
  canClearRetentionCleanupChecklistItem: boolean;
  canClearReleaseGateCheck: boolean;
  coverage: StagingObjectStorageRetentionCleanupCoverage[];
  missingRuntimeInputs: string[];
  operatorAction: string;
  releaseGateUse: string;
  remainingReleaseGateBlockers: string[];
};

export type ReleaseBlocker = {
  id: string;
  gate: "private_beta" | "production_launch";
  blockerKind: "dashboard_slo" | "alert_route" | "runtime_evidence" | "release_evidence";
  status: "open" | "mitigating" | "ready_for_review";
  severity: "sev1" | "sev2" | "sev3";
  ownerRole: AdminRole;
  dashboardId: string;
  alertRouteId: string;
  runtimeEvidenceRef: string;
  releaseEvidenceId: string;
  blockingSignal: string;
  requiredEvidence: string;
  unblockCriteria: string;
  nextReviewAt: string;
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
  supportTicketId: string;
  requestedByRole: AdminRole;
  requiredRole: AdminRole;
  rbacDecision: "allowed" | "denied" | "second_review_required";
  idempotencyKey: string;
  quotaEffect: "none" | "refund_pending" | "reserved_credit_released" | "credit_after_audit";
  regenerationMode: "qa_preserving" | "full_rebuild" | "not_allowed";
  regenerationRationale: string;
  closureEvidenceRefs: string[];
  auditRef: string;
  operatorRunbook: string;
};

export type ExportRegenerationRuntimeDecision = {
  exportId: string;
  supportTicketId: string;
  decision: "submit_ready" | "review_required" | "blocked";
  qaGate: "pass" | "warning_review" | "blocking_denied";
  auditStatus: "attached" | "pending";
  closureEvidenceStatus: "complete" | "incomplete";
  requestedByRole: AdminRole;
  requiredRole: AdminRole;
  rbacDecision: ExportJob["rbacDecision"];
  idempotencyKey: string;
  quotaSettlement: "no_quota_change" | "refund_pending" | "reserved_credit_released" | "credit_after_audit";
  blockerCodes: string[];
  submitDisabledReason: string;
  operatorAction: string;
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
  regressionFixtureRef: string;
  closureEvidenceRefs: string[];
  operatorRunbook: string;
  auditRef: string;
};

export type FailedTaskRuntimeDecision = {
  taskId: string;
  queueId: string;
  requestedAction: FailedTaskControl["requestedAction"];
  submitDecision: "submit_ready" | "review_required" | "blocked";
  stateTransition:
    | "failed_to_retrying_after_submit"
    | "failed_retry_preserved"
    | "cancelled_closure_ready"
    | "cancelled_state_preserved_pending_review"
    | "blocked_state_preserved";
  closureOutcome:
    | "retry_submits_with_audit"
    | "retry_blocked_until_evidence"
    | "cancel_submits_with_audit"
    | "cancel_requires_second_review"
    | "hold_blocked_until_policy_review";
  releaseGateDisposition:
    | "converted_regression_fixture"
    | "eval_gate_preserved_by_regression_fixture"
    | "blocked_not_regression_fixture";
  retryBudgetStatus: "available" | "exhausted" | "not_retry";
  rbacStatus: "allowed" | "denied" | "second_review_required";
  quotaSettlement: FailedTaskControl["quotaEffect"];
  idempotencyKey: string;
  idempotencyStatus: "stable" | "unstable";
  closureEvidenceStatus: "complete" | "incomplete";
  userMessageStatus: "ready" | "missing";
  blockerCodes: string[];
  submitDisabledReason: string;
  operatorAction: string;
  auditRef: string;
};

export type StagingSupportRetryAbuseCoverage = {
  area:
    | "support_ticket_linkage"
    | "failed_task_retry_cancel"
    | "abuse_hold_throttle"
    | "abuse_queue_closure";
  status: "pass" | "blocked";
  runtimeProbe: string;
  externalUserEvidence: string;
  rbacAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type StagingSupportRetryAbuseEvidence = {
  id: string;
  evidencePath: string;
  environment: "staging";
  status: "pass" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "staging_support_retry_abuse_ops";
  doNotLaunchConditionId: "support_abuse_runtime_missing";
  runtimeRequestIds: string[];
  supportTicketIds: string[];
  failedTaskIds: string[];
  abuseEventIds: string[];
  abuseHookIds: string[];
  coverage: StagingSupportRetryAbuseCoverage[];
  gateImpact: {
    checklistItem: string;
    canClearCheckLevelItem: boolean;
    aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items";
    remainingBlockers: string[];
  };
};

export type StagingLegalSupportVisibilityCoverage = {
  area: "legal_pages_visibility" | "support_contact_visibility";
  status: "pass" | "blocked";
  runtimeProbe: string;
  externalUserEvidence: string;
  policyEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type StagingLegalSupportVisibilityEvidence = {
  id: string;
  environment: "staging";
  status: "pass" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "staging_legal_external_user_pages";
  doNotLaunchConditionId: "external_user_legal_pages_missing";
  legalPageEvidencePath: "ops/evidence/staging/legal-pages-external-user.json";
  supportContactEvidencePath: "ops/evidence/staging/support-contact-external-user.json";
  runtimeRequestIds: string[];
  auditRefs: string[];
  coverage: StagingLegalSupportVisibilityCoverage[];
  gateImpact: {
    checklistItems: string[];
    canClearCheckLevelItem: boolean;
    aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items";
    remainingBlockers: string[];
  };
};

export type StagingAuthRbacTenantAuditCoverage = {
  area:
    | "admin_session_boundary"
    | "tenant_isolation_denial"
    | "admin_rbac_runtime"
    | "immutable_audit_linkage";
  status: "pass" | "blocked";
  runtimeProbe: string;
  externalUserEvidence: string;
  rbacAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type StagingAuthRbacTenantAuditEvidence = {
  id: string;
  evidencePath: string;
  environment: "staging";
  status: "pass" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "staging_auth_rbac_tenant_audit";
  doNotLaunchConditionId: "tenant_isolation_not_enforced";
  runtimeRequestIds: string[];
  tenantIds: string[];
  adminRbacEvidenceIds: string[];
  auditRefs: string[];
  coverage: StagingAuthRbacTenantAuditCoverage[];
  gateImpact: {
    checklistItem: string;
    canClearCheckLevelItem: boolean;
    aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items";
    remainingBlockers: string[];
  };
};

export type StagingEvalQaSafetyCoverage = {
  area:
    | "brief_safety_gate"
    | "provider_request_policy"
    | "provider_response_policy"
    | "qa_result_gate"
    | "export_block_gate";
  status: "pass" | "blocked";
  runtimeProbe: string;
  externalUserEvidence: string;
  enforcementEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type StagingEvalQaSafetyEvidence = {
  id: string;
  evidencePath: string;
  environment: "staging";
  status: "pass" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "staging_eval_qa_safety_runtime";
  doNotLaunchConditionId: "eval_qa_safety_runtime_missing";
  runtimeRequestIds: string[];
  traceIds: string[];
  riskyExportIds: string[];
  adminRbacEvidenceIds: string[];
  adminReviewDecisionIds: string[];
  auditRefs: string[];
  coverage: StagingEvalQaSafetyCoverage[];
  gateImpact: {
    checklistItem: string;
    canClearCheckLevelItem: boolean;
    aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items";
    remainingBlockers: string[];
  };
};

export type StagingQuotaRateLimitSpendCapCoverage = {
  area:
    | "quota_reservation_commit_refund"
    | "rate_limit_enforcement"
    | "provider_spend_cap"
    | "emergency_kill_switch";
  status: "pass" | "blocked";
  runtimeProbe: string;
  externalUserEvidence: string;
  enforcementEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type StagingQuotaRateLimitSpendCapEvidence = {
  id: string;
  evidencePath: string;
  environment: "staging";
  status: "pass" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "staging_quota_rate_limit_spend_cap";
  doNotLaunchConditionId: "rate_limit_spend_cap_runtime_missing";
  runtimeRequestIds: string[];
  quotaUserIds: string[];
  adminRbacEvidenceIds: string[];
  auditRefs: string[];
  coverage: StagingQuotaRateLimitSpendCapCoverage[];
  gateImpact: {
    checklistItem: string;
    canClearCheckLevelItem: boolean;
    aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items";
    remainingBlockers: string[];
  };
};

export type ProductionAbuseThrottleHoldCoverage = {
  area:
    | "account_hold_enforcement"
    | "rate_limit_enforcement"
    | "rbac_audit_release"
    | "gate_blocker_preservation";
  status: "pass" | "blocked";
  runtimeProbe: string;
  deploymentEvidence: string;
  rbacAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type ProductionAbuseThrottleHoldEvidence = {
  id: string;
  evidencePath: string;
  environment: "production";
  status: "pass_with_blockers_preserved" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "production_abuse_throttle_hold";
  doNotLaunchConditionId: "abuse_throttle_hold_missing";
  runtimeRequestIds: string[];
  abuseEventIds: string[];
  abuseHookIds: string[];
  coverage: ProductionAbuseThrottleHoldCoverage[];
  gateImpact: {
    checklistItem: string;
    canClearCheckLevelItem: boolean;
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items";
    remainingBlockers: string[];
  };
};

export type ProductionActivationReviewAuditCoverage = {
  area:
    | "skill_release_gate"
    | "crawler_activation_gate"
    | "prompt_activation_gate"
    | "provider_routing_gate"
    | "quota_override_gate"
    | "safety_policy_gate"
    | "export_override_gate"
    | "gate_blocker_preservation";
  status: "pass" | "blocked";
  runtimeProbe: string;
  deploymentEvidence: string;
  rbacAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type ProductionActivationReviewAuditEvidence = {
  id: string;
  evidencePath: string;
  environment: "production";
  status: "pass_with_blockers_preserved" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "production_activation_review_audit";
  doNotLaunchConditionIds: ["activation_eval_review_audit_runtime_missing", "admin_high_risk_review_runtime_missing"];
  runtimeRequestIds: string[];
  adminRbacEvidenceIds: string[];
  adminReviewDecisionIds: string[];
  auditRefs: string[];
  coverage: ProductionActivationReviewAuditCoverage[];
  gateImpact: {
    checklistItem: string;
    canClearCheckLevelItem: boolean;
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items";
    remainingBlockers: string[];
  };
};

export type ProductionSkillReleaseEvalCanaryCoverage = {
  area:
    | "eval_suite_gate"
    | "canary_threshold_gate"
    | "release_notes_gate"
    | "rollback_gate"
    | "gate_blocker_preservation";
  status: "pass" | "blocked";
  runtimeProbe: string;
  deploymentEvidence: string;
  rbacAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type ProductionSkillReleaseEvalCanaryEvidence = {
  id: string;
  evidencePath: string;
  environment: "production";
  status: "pass_with_blockers_preserved" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "production_skill_release_eval_canary";
  doNotLaunchConditionId: "skill_release_eval_canary_missing";
  runtimeRequestIds: string[];
  skillVersionIds: string[];
  canaryMetricIds: string[];
  releaseEvidenceIds: string[];
  auditRefs: string[];
  coverage: ProductionSkillReleaseEvalCanaryCoverage[];
  gateImpact: {
    checklistItem: string;
    canClearCheckLevelItem: boolean;
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items";
    remainingBlockers: string[];
  };
};

export type ProductionSecurityLaunchCheckCoverage = {
  area:
    | "secure_session_cookie"
    | "csrf_same_site_enforcement"
    | "secret_exposure_redaction"
    | "admin_surface_privacy"
    | "gate_blocker_preservation";
  status: "pass" | "blocked";
  runtimeProbe: string;
  deploymentEvidence: string;
  securityAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type ProductionSecurityLaunchCheckEvidence = {
  id: string;
  evidencePath: string;
  environment: "production";
  status: "pass_with_blockers_preserved" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "production_security_launch_checks";
  doNotLaunchConditionIds: ["security_privacy_legal_incomplete", "secret_exposure_runtime_not_verified"];
  runtimeRequestIds: string[];
  auditRefs: string[];
  coverage: ProductionSecurityLaunchCheckCoverage[];
  gateImpact: {
    checklistItem: string;
    canClearCheckLevelItem: boolean;
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items";
    remainingBlockers: string[];
  };
};

export type ProductionBackupRollbackIncidentCoverage = {
  area:
    | "backup_restore"
    | "rollback_drill"
    | "incident_alert_path"
    | "post_deploy_smoke"
    | "gate_blocker_preservation";
  status: "pass" | "blocked";
  runtimeProbe: string;
  deploymentEvidence: string;
  operationalAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type ProductionBackupRollbackIncidentEvidence = {
  id: string;
  evidencePath: string;
  environment: "production";
  status: "blocked_by_upstream_gates" | "pass_with_blockers_preserved" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "production_backup_rollback_incident";
  doNotLaunchConditionIds: ["backup_restore_rollback_smoke_missing", "production_deploy_rollback_smoke_missing"];
  runtimeRequestIds: string[];
  incidentIds: string[];
  dashboardIds: string[];
  alertRouteIds: string[];
  auditRefs: string[];
  coverage: ProductionBackupRollbackIncidentCoverage[];
  gateImpact: {
    checklistItems: string[];
    canClearCheckLevelItems: boolean;
    aggregateProductionGateStatus: "blocked_by_upstream_and_other_production_runtime_items";
    remainingBlockers: string[];
  };
};

export type ProductionLegalSupportPolicyCoverage = {
  area:
    | "public_legal_pages"
    | "public_support_contact"
    | "billing_policy_visibility"
    | "gate_blocker_preservation";
  status: "pass" | "blocked";
  runtimeProbe: string;
  deploymentEvidence: string;
  policyAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type ProductionLegalSupportPolicyEvidence = {
  id: string;
  environment: "production";
  status: "pass_with_blockers_preserved" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "production_legal_support_policy";
  doNotLaunchConditionId: "public_legal_support_policy_not_deployed";
  legalPolicyEvidencePath: "ops/evidence/production/public-legal-policy.json";
  supportBillingPolicyEvidencePath: "ops/evidence/production/public-support-billing-policy.json";
  runtimeRequestIds: string[];
  auditRefs: string[];
  coverage: ProductionLegalSupportPolicyCoverage[];
  gateImpact: {
    checklistItems: string[];
    canClearCheckLevelItems: boolean;
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items";
    remainingBlockers: string[];
  };
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

export type ProductionPaidBillingLifecycleCoverage = {
  area:
    | "checkout_subscription_cancellation_past_due"
    | "refund_credit_quota_reset"
    | "webhook_idempotency"
    | "gate_blocker_preservation";
  status: "pass" | "blocked";
  runtimeProbe: string;
  deploymentEvidence: string;
  billingAuditEvidence: string;
  linkedAdminArtifacts: string[];
  evidenceRefs: string[];
};

export type ProductionPaidBillingLifecycleEvidence = {
  id: string;
  environment: "production";
  status: "pass_with_blockers_preserved" | "blocked";
  validatedAt: string;
  validatedByRole: AdminRole;
  releaseGateCheckId: "production_paid_billing_lifecycle";
  doNotLaunchConditionId: "paid_billing_or_comp_only_mode_missing";
  billingLifecycleEvidencePath: "ops/evidence/production/billing-lifecycle.json";
  billingRefundCreditWebhookEvidencePath: "ops/evidence/production/billing-refund-credit-webhook.json";
  runtimeRequestIds: string[];
  quotaAccountIds: string[];
  supportTicketIds: string[];
  auditRefs: string[];
  coverage: ProductionPaidBillingLifecycleCoverage[];
  gateImpact: {
    checklistItems: string[];
    canClearCheckLevelItems: boolean;
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items";
    remainingBlockers: string[];
  };
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
  overrideScope: "release" | "crawler" | "prompt" | "provider" | "quota" | "safety" | "export";
  overrideDurationPolicy: "temporary_required" | "second_review_deadline" | "non_expiring_policy_block";
  expiryEnforced: boolean;
  target: string;
  requestedAction: string;
  enforcementPoint:
    | "release_gate"
    | "crawler_activation"
    | "prompt_activation"
    | "provider_router"
    | "quota_mutation"
    | "safety_policy"
    | "export_release";
  requiredRole: AdminRole;
  attemptedRole: AdminRole;
  decision: "allowed" | "denied" | "second_review_required";
  secondReviewRequired: boolean;
  secondReviewStatus: "not_required" | "required" | "completed" | "blocked";
  releaseGateImpact: string;
  userVisibleOutcome: string;
  apiScope: string;
  mutationOutcome: "applied" | "queued_for_review" | "blocked_no_mutation";
  overrideStartedAt: string;
  overrideExpiresAt: string;
  preOverrideState: string;
  expiryAction: string;
  staleOverrideProbe: string;
  runtimeCheck: string;
  postDecisionControl: string;
  rationale: string;
  auditRef: string;
  evidenceRefs: string[];
  releaseEvidenceRequired: string[];
};

export type AdminRbacRuntimeDecision = {
  evidenceId: string;
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  target: string;
  requestedAction: string;
  enforcementPoint: AdminRbacEvidence["enforcementPoint"];
  requiredRole: AdminRole;
  attemptedRole: AdminRole;
  roleGateStatus: "sufficient" | "insufficient";
  secondReviewStatus: AdminRbacEvidence["secondReviewStatus"];
  expiryPolicyStatus:
    | "valid_temporary_window"
    | "expired_temporary_window"
    | "second_review_deadline_open"
    | "non_expiring_policy_block";
  overrideWindow: "active" | "expired" | "policy_block";
  effectiveDecision: "allow_mutation" | "queue_for_review" | "deny_mutation";
  requestOutcome: "applied" | "queued_second_review" | "denied_insufficient_role" | "denied_policy_block" | "denied_expired_override";
  mutationAllowed: boolean;
  queueAction: "apply_with_expiry" | "hold_for_second_review" | "block_and_preserve_state";
  releaseGateStatus: "canary_or_release_blocked" | "runtime_override_applied_with_expiry" | "release_gate_preserved";
  evaluatedAt: string;
  preOverrideState: string;
  expiryAction: string;
  staleOverrideProbe: string;
  blockerCodes: string[];
  auditRef: string;
  evidenceRefs: string[];
  rationale: string;
};

export type AdminRbacOverrideAttempt = {
  id: string;
  evidenceId: string;
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  requestId: string;
  idempotencyKey: string;
  apiScope: string;
  requestBodyDigest: string;
  preMutationStateDigest: string;
  postMutationStateDigest: string;
  csrfScope: "admin_session_cookie";
  dryRunOnly: boolean;
  expectedHttpStatus: 200 | 202 | 403 | 409 | 410 | 423;
  gatePreservation: string;
  mutationReplayPolicy: string;
  auditRef: string;
  evidenceRefs: string[];
  operatorMessage: string;
};

export type AdminRbacOverrideAttemptDecision = {
  attemptId: string;
  evidenceId: string;
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  requestId: string;
  idempotencyStatus: "stable" | "unstable";
  stateDigestStatus: "mutation_recorded" | "mutation_preserved" | "unexpected_mutation" | "mutation_missing";
  requestOutcome:
    | "mutation_applied"
    | "queued_without_mutation"
    | "blocked_without_mutation"
    | "stale_replay_blocked"
    | "invalid_evidence";
  submitAllowed: boolean;
  expectedHttpStatus: AdminRbacOverrideAttempt["expectedHttpStatus"];
  runtimeRequestOutcome: AdminRbacRuntimeDecision["requestOutcome"] | "missing_runtime";
  releaseGateStatus: AdminRbacRuntimeDecision["releaseGateStatus"] | "release_gate_preserved";
  blockerCodes: string[];
  auditRef: string;
  evidenceRefs: string[];
  rationale: string;
};

export type AdminRbacStaleReplayDecision = {
  evidenceId: string;
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  target: string;
  enforcementPoint: AdminRbacEvidence["enforcementPoint"];
  staleReplayAt: string;
  originalOutcome: AdminRbacRuntimeDecision["requestOutcome"];
  staleOutcome: "blocked_stale_replay" | "policy_block_preserved";
  staleWindowStatus: "expired" | "policy_block";
  releaseGateStatus: "release_gate_preserved";
  stateRestoration: string;
  evidenceRefs: string[];
  auditRef: string;
  operatorAction: string;
};

export type AdminRbacSurfaceSummary = {
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  totalEvidence: number;
  allowedMutations: number;
  queuedSecondReview: number;
  deniedMutations: number;
  expiredOverrideDenials: number;
  releaseGateStatuses: AdminRbacRuntimeDecision["releaseGateStatus"][];
  auditRefs: string[];
  releaseEvidenceRequired: string[];
  decisionSummary: string;
  operatorAction: string;
};

export type AdminRbacEvidencePack = {
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  evidenceIds: string[];
  targets: string[];
  apiScopes: string[];
  requiredRoles: AdminRole[];
  attemptedRoles: AdminRole[];
  requestOutcomes: AdminRbacRuntimeDecision["requestOutcome"][];
  mutationDecisions: AdminRbacRuntimeDecision["effectiveDecision"][];
  releaseGateStatuses: AdminRbacRuntimeDecision["releaseGateStatus"][];
  expiryStatuses: AdminRbacRuntimeDecision["expiryPolicyStatus"][];
  expiryEnforcementStatus: "all_enforced" | "policy_block_only" | "mixed_enforcement" | "missing_enforcement";
  expiryEnforcedEvidenceIds: string[];
  policyBlockEvidenceIds: string[];
  secondReviewStatuses: AdminRbacEvidence["secondReviewStatus"][];
  auditRefs: string[];
  evidenceRefs: string[];
  staleReplayOutcomes: AdminRbacStaleReplayDecision["staleOutcome"][];
  staleReplayEvidenceIds: string[];
  highestRequiredRole: AdminRole;
  releaseGateDisposition:
    | "applied_with_expiry"
    | "held_for_second_review"
    | "blocked_by_policy_or_role"
    | "mixed_preserved";
  evidenceCompleteness: "complete" | "missing_audit" | "missing_runtime" | "missing_release_evidence";
  operatorChecklist: string[];
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
