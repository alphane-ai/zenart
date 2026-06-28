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
  source?: "api" | "fixture";
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
  evalSuiteId?: string | null;
  releaseGate?: {
    requiresEvalPass: boolean;
    eligibleForCanary: boolean;
    eligibleForActive: boolean;
    blockingReason: string;
    lastEvalResultId?: string | null;
    lastEvalStatus?: "pass" | "fail" | "blocked" | null;
    evalContractComplete: boolean;
    criticalSafetyRegressions: number;
  };
  source?: "api" | "fixture";
};

export type EvalResult = {
  resultId: string;
  suiteId: string;
  subjectType: string;
  subjectId: string;
  subjectVersion: string;
  candidateStatusAfterEval: "draft" | "eligible_for_canary" | "eligible_for_active" | "blocked";
  status: "pass" | "fail" | "blocked";
  completedAt: string;
  createdAt: string;
  totalFixtures: number;
  passedFixtures: number;
  failedFixtures: number;
  blockedFixtures: number;
  criticalSafetyRegressions: number;
  regressionPassRate: string;
  traceComplete: boolean;
  exportContractComplete: boolean;
  qaFixtureCoverageComplete: boolean;
  fixtureResultCount: number;
  runnerSha256: string;
  storageTable: string;
  artifactRef: string;
  source: "api" | "fixture";
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
  escalationEvidenceRef: string;
  activationGateDecision: "allowed" | "blocked";
  quarantineStatus: "active" | "cleared" | "scheduled";
  slaStatus: "within_window" | "expired" | "not_required";
  affectedActivationSurfaces: Array<"prompt_fragment" | "skill_version" | "meta_prompt" | "provider_route">;
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
  escalationEvidenceStatus: "complete" | "pending" | "not_required";
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

export type CrawlerGovernanceClosureSummary = {
  workflowId: string;
  findingId: string;
  requestType: CrawlerGovernanceWorkflow["requestType"];
  releaseClosureState: "closure_ready" | "review_required" | "blocked";
  activationSafetyState: "activation_safe" | "activation_blocked";
  evidenceCompleteness: "complete" | "missing";
  takedownDeleteStatus: "complete" | "pending" | "not_applicable";
  deadlineEscalationStatus: "complete" | "pending" | "not_required";
  secondReviewGate: "complete" | "required" | "rejected" | "not_required";
  releaseGateDisposition: "can_cite_release_evidence" | "preserve_blocker";
  missingEvidenceRefs: string[];
  blockerCodes: string[];
  operatorSummary: string;
  auditRef: string;
};

export type CrawlerGovernanceAdminActionContract = {
  workflowId: string;
  findingId: string;
  requestType: CrawlerGovernanceWorkflow["requestType"];
  endpointScope:
    | "crawler_takedown_closure"
    | "crawler_derivative_activation"
    | "crawler_raw_retention_delete";
  requestedMutation:
    | "close_takedown"
    | "allow_derivative_activation"
    | "delete_raw_retention";
  allowedMutation: boolean;
  httpOutcome: "200_close_ready" | "200_activation_ready" | "423_governance_blocked";
  mutationOrder:
    | "audit_then_quarantine_release"
    | "audit_then_derivative_activation"
    | "audit_then_keep_quarantine";
  quarantineOutcome: "keep_active" | "keep_scheduled" | "clear";
  requiredOperatorRole: CrawlerGovernanceWorkflow["reviewerRole"];
  secondReviewGate: "pass" | "required" | "rejected" | "not_required";
  evidenceGate: "pass" | "missing_required_evidence";
  deadlineGate: "pass" | "expired_requires_escalation";
  activationGate: "pass" | "blocked";
  adminSessionScope: "admin_session_cookie_csrf";
  requestAttemptRef: string;
  idempotencyKey: string;
  requestStateDigest: string;
  staleReplayOutcome: "deny_409_stale_digest" | "deny_423_governance_blocked";
  requestAuditOrder: "validate_session_then_digest_then_audit_then_mutation";
  requestEvidenceRefs: string[];
  supportVisibleMessage: string;
  regressionFixtureRefs: string[];
  regressionFixtureInventoryStatus: "declared" | "missing" | "unverified";
  regressionFixtureGate: "pass" | "missing_regression_fixture" | "missing_inventory" | "inventory_unverified";
  releaseEvidenceDisposition: "can_cite_release_evidence" | "preserve_blocker";
  blockerCodes: string[];
  auditRef: string;
};

export type CrawlerDerivativeReplayHardeningSummary = {
  caseId: string;
  workflowId: string;
  findingId: string;
  replayMutation:
    | "drop_provenance_evidence"
    | "pending_requester_notice"
    | "unbounded_retention"
    | "restricted_derivative_use";
  expectedBlocker: string;
  removedEvidenceRefs: string[];
  mutatedEvidenceRefs: string[];
  closureDecision: CrawlerGovernanceRuntimeDecision["closureDecision"];
  activationDecision: CrawlerGovernanceRuntimeDecision["activationDecision"];
  adminActionAllowed: boolean;
  httpOutcome: CrawlerGovernanceAdminActionContract["httpOutcome"];
  releaseEvidenceDisposition: CrawlerGovernanceAdminActionContract["releaseEvidenceDisposition"];
  regressionFixtureGate: CrawlerGovernanceAdminActionContract["regressionFixtureGate"];
  replayOutcome: "blocked_as_expected" | "unsafe_release";
  operatorEvidence: string;
  auditRef: string;
  regressionFixtureRefs: string[];
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

export type RegressionFixtureRuntimeSummary = {
  fixtureId: string;
  sourceFeedbackId: string;
  sourceKind: RegressionFixture["sourceKind"];
  failureMode: RegressionFixture["failureMode"];
  severity: RiskLevel;
  status: RegressionFixtureStatus;
  requiredGate: RegressionFixture["requiredGate"];
  sourceLinkStatus: "linked" | "missing_source";
  fixturePathStatus: "declared" | "invalid_path";
  canaryMetricStatus: "linked" | "missing_metric";
  auditStatus: "attached" | "missing_audit";
  highRiskGateStatus: "blocks_pre_production" | "late_gate" | "not_high_risk";
  releaseGateDisposition:
    | "release_blocking"
    | "gate_ready"
    | "candidate_only"
    | "resolved";
  blockerCodes: string[];
  operatorAction: string;
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

export type ProviderRegistryCapability = {
  provider_id: string;
  model_id: string;
  endpoints: string[];
  input_types: string[];
  output_types: string[];
  tool_types?: string[];
  max_cost_units: number;
  cost_currency?: string;
  estimated_cost_cents?: number;
  supports_batch: boolean;
  max_batch_size?: number;
  supports_seed?: boolean;
  supports_cancel?: boolean;
  supported_aspect_ratios?: string[];
  supported_qualities?: string[];
};

export type ProviderRoutingPolicy = {
  weight: number;
  canary_percent: number;
  max_concurrency: number;
  fallback_provider_ids?: string[];
  kill_switch: boolean;
};

export type ProviderHealthSnapshot = {
  available: boolean;
  latency_ms: number;
  error_rate_percent: number;
  last_checked_at: string;
  message?: string;
};

export type ProviderRegistryEntry = {
  provider_id: string;
  display_name: string;
  mode: "dev" | "sandbox" | "production";
  status: "enabled" | "disabled" | "kill_switch";
  secret_ref?: string;
  capabilities: ProviderRegistryCapability[];
  routing: ProviderRoutingPolicy;
  health: ProviderHealthSnapshot;
  metadata?: Record<string, string>;
  secret_present: boolean;
  updated_at: string;
};

export type ProviderRegistrySource = "api" | "fixture";

export type ProviderStrategySelectionPolicy = "weighted" | "priority" | "canary" | "failover";

export type ProviderStrategyGroupMember = {
  provider_id: string;
  weight: number;
  canary_percent: number;
  max_concurrency: number;
  fallback_rank: number;
  enabled: boolean;
};

export type ProviderStrategyGroup = {
  group_id: string;
  display_name: string;
  tool_type: string;
  status: "enabled" | "disabled" | "kill_switch";
  selection_policy: ProviderStrategySelectionPolicy;
  fallback_provider_ids?: string[];
  kill_switch: boolean;
  members: ProviderStrategyGroupMember[];
  metadata?: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type Team = {
  id: string;
  tenant_id: string;
  name: string;
  plan_id: string;
  seat_limit: number;
  created_at: string;
};

export type TeamInvite = {
  id: string;
  team_id: string;
  tenant_id: string;
  email: string;
  role: "admin" | "member";
  idempotency_key: string;
  invited_by: string;
  expires_at: string;
  created_at: string;
};

export type AdminTeamMemberRemoveResult = {
  team_id: string;
  tenant_id: string;
  member_id: string;
  removed_by: string;
  removed: boolean;
};

export type TeamSeatUsage = {
  team_id: string;
  tenant_id: string;
  plan_id: string;
  seat_limit: number;
  active_seats: number;
  invited_seats: number;
  billable_seats: number;
  available_seats: number;
};

export type TeamBillingLink = {
  tenant_id: string;
  team_id: string;
  provider: "stripe" | "mock";
  provider_subscription_id: string;
  provider_subscription_item_id: string;
  price_id?: string;
  proration_behavior: "create_prorations" | "none" | "always_invoice";
  status: "active" | "paused" | "removed";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type TeamSeatBillingSync = {
  id: string;
  tenant_id: string;
  team_id: string;
  provider: string;
  provider_subscription_id?: string;
  provider_subscription_item_id?: string;
  price_id?: string;
  requested_quantity: number;
  synced_quantity: number;
  proration_behavior: "create_prorations" | "none" | "always_invoice";
  status: "synced" | "skipped" | "failed";
  reason?: string;
  operation: string;
  idempotency_key: string;
  created_at: string;
};

export type TeamBillingLinkSource = "api" | "fixture";

export type AdminBillingOperationKind = "manual_credit" | "refund_note" | "sync_subscription" | "account_lock";

export type AdminBillingOperationStatus = "pending" | "recorded" | "succeeded" | "failed";

export type AdminBillingOperation = {
  id: string;
  tenant_id: string;
  actor_id: string;
  target_user_id: string;
  operation: AdminBillingOperationKind;
  idempotency_key: string;
  status: AdminBillingOperationStatus;
  units?: number;
  bucket_id?: string;
  subscription_id?: string;
  provider?: string;
  provider_ref?: string;
  rationale: string;
  note?: string;
  locked?: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type AdminBillingOpsSource = "fixture";

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

export type PrivateBetaAggregateGateStatus = "blocked_by_other_staging_runtime_items" | "go";

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
  aggregatePrivateBetaGateStatus: PrivateBetaAggregateGateStatus;
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
  aggregatePrivateBetaGateStatus: PrivateBetaAggregateGateStatus;
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
  reportKind: "missing" | "canonical_pass" | "blocked_probe" | "rejected_report";
  releaseGateCheckId: "staging_object_storage_signed_downloads";
  doNotLaunchConditionId: "object_storage_signed_retention_runtime_missing";
  evidencePath: "ops/evidence/staging/object-storage-retention-cleanup.json";
  requiredScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh";
  requiredArtifactPath: "ops/evidence/staging/object-storage-retention-cleanup.json";
  canonicalPassReportPath: "ops/evidence/staging/object-storage-retention-cleanup.json";
  canonicalPassResultsPath: "ops/evidence/staging/object-storage-retention-cleanup.ndjson";
  blockedProbeReportPath: "ops/evidence/staging/object-storage-retention-cleanup.blocked.json";
  observedReportPath: string;
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

export type OperationsIncidentRunbookAction = {
  actionId: string;
  action:
    | "acknowledge"
    | "mitigate"
    | "escalate"
    | "rollback"
    | "maintenance_banner"
    | "support_update"
    | "resolve";
  sourceSurface: "incident_log" | "alert_route" | "release_blocker" | "maintenance_banner";
  requiredRole: AdminRole;
  status: "ready_for_review" | "blocked_until_evidence" | "blocked_by_do_not_launch";
  operatorBoundary: string;
  requiredEvidenceRefs: string[];
  auditRef: string;
};

export type OperationsIncidentRunbookContract = {
  schema: "stage1.operations-incident-runbook-local-contract.v1";
  contractId: "stage1.operations-incident-runbook-local-contract";
  routeMarker: "stage1.operations-incident-runbook-local-contract";
  blueprintItems: Array<"AD-11" | "OP-8" | "OP-10" | "OP-11" | "VF-6" | "VF-7">;
  adminRoute: "admin/app/operations/page.tsx";
  evidenceSource: "admin fixture local contract";
  requiredIncidentFields: string[];
  requiredAlertRouteFields: string[];
  requiredRollbackEvidenceRefs: string[];
  preservedDoNotLaunchConditions: string[];
  blockedGateChecks: string[];
  actionMatrix: OperationsIncidentRunbookAction[];
  canClearStagingGate: false;
  canClearProductionGate: false;
  canCloseDoNotLaunch: false;
  manualGoControlsEnabled: false;
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

export type Stage1BatchQueueRuntime = {
  id: string;
  batchId: string;
  tenantId: string;
  projectId: string;
  workspaceId: string;
  status: "queued" | "running" | "partial_succeeded" | "succeeded" | "failed" | "cancelled" | "blocked";
  requestedCount: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  blocked: number;
  retryable: number;
  workerId: string;
  claimTimeoutSeconds: number;
  oldestChildAgeMinutes: number;
  providerId: string;
  modelId: string;
  toolType: string;
  providerStrategyGroupId: string;
  providerSelectionPolicy: ProviderStrategySelectionPolicy;
  providerConcurrency: string;
  providerModelConcurrency: string;
  claimLeasePolicy: string;
  drainPolicy: string;
  quotaPolicy: string;
  deadLetterPolicy: string;
  idempotencyScope: string;
  nextOperatorAction: string;
  auditRef: string;
  evidenceRefs: string[];
};

export type Stage1BatchChildTask = {
  id: string;
  batchId: string;
  tenantId: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";
  providerId: string;
  modelId: string;
  toolType: string;
  retryCount: number;
  maxRetries: number;
  workerId: string;
  claimAttempt: number;
  claimExpiresAt: string;
  fanoutStage: string;
  failureCode: string;
  reviewReason: string;
  quotaEstimateUnits: number;
  quotaCommittedUnits: number;
  quotaRefundedUnits: number;
  retryState: "not_retryable" | "retry_available" | "retry_exhausted" | "not_applicable";
  deadLetterState: "not_dead_lettered" | "dead_lettered";
  resultAssetId: string;
  canvasObjectId: string;
  visibleTraceRef: string;
  providerUsageRef: string;
  idempotencyKey: string;
  operatorAction: string;
  auditRef: string;
  evidenceRefs: string[];
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
  source?: "api" | "fixture";
  projectId?: string;
  taskId?: string;
  format?: string;
  downloadEnabled?: boolean;
  signedUrlPresent?: boolean;
  downloadExpiresAt?: string;
  retentionUntil?: string;
  blockedReasons?: string[];
  finalExportAllowed?: boolean;
  objectMetadataId?: string;
  manifestPresent?: boolean;
  qaReportPresent?: boolean;
  provenancePresent?: boolean;
  traceId?: string;
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
  queueAttemptId: string;
  queueAttemptDigest: string;
  observedQueueAttemptDigest: string;
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
  preActionStateDigest: string;
  observedStateDigest: string;
  requestedAction: "retry" | "cancel" | "hold";
  actionEligibility: "eligible" | "requires_review" | "blocked";
  allowedRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  requestedByRole: "support_operator" | "admin_operator" | "admin_reviewer" | "admin_superadmin";
  requestedByAdminId: string;
  rbacDecision: "allowed" | "denied" | "second_review_required";
  secondReviewRequired: boolean;
  secondReviewStatus: "not_required" | "pending" | "approved" | "rejected" | "expired";
  secondReviewerAdminId: string;
  secondReviewAuditRef: string;
  secondReviewEvidenceRefs: string[];
  idempotencyKey: string;
  quotaEffect: "none" | "refund_pending" | "refund_on_cancel" | "reserved_credit_released";
  regressionFixtureRef: string;
  abuseControlHookRefs: string[];
  closureEvidenceRefs: string[];
  rbacEvidenceRefs: string[];
  operatorRunbook: string;
  auditRef: string;
};

export type FailedTaskRuntimeDecision = {
  taskId: string;
  queueId: string;
  supportTicketId: string;
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
  regressionFixtureStatus: "declared" | "missing" | "not_required";
  regressionFixtureEvidence: string;
  abuseControlStatus:
    | "clear"
    | "active_enforced"
    | "dry_run_only"
    | "expired_or_released"
    | "missing_hook_evidence"
    | "mismatched_hook_user";
  abuseControlEvidence: string;
  abuseControlReleaseEvidenceStatus: "not_required" | "complete" | "missing";
  abuseControlReleaseEvidenceRefs: string[];
  abuseControlMissingReleaseEvidenceRefs: string[];
  abuseControlReleaseEvidence: string;
  retryBudgetStatus: "available" | "exhausted" | "not_retry";
  rbacStatus: "allowed" | "denied" | "second_review_required";
  roleAuthorizationStatus: "sufficient" | "insufficient";
  roleAuthorizationEvidence: string;
  secondReviewStatus: FailedTaskControl["secondReviewStatus"];
  secondReviewDistinctnessStatus: "not_required" | "distinct_reviewer" | "same_reviewer" | "missing_reviewer";
  secondReviewEvidenceStatus: "not_required" | "complete" | "incomplete";
  secondReviewEvidence: string;
  secondReviewAuditRef: string;
  quotaSettlement: FailedTaskControl["quotaEffect"];
  idempotencyKey: string;
  idempotencyStatus: "stable" | "unstable";
  stateDigestStatus: "stable" | "stale_replay";
  stateDigestEvidence: string;
  queueAttemptStatus: "stable" | "stale_replay";
  queueAttemptEvidence: string;
  appCompatibilityStatus: "compatible" | "stale";
  workerCompatibilityStatus: "compatible" | "stale";
  schemaCompatibilityStatus: "compatible" | "stale";
  compatibilityStatus: "compatible" | "stale";
  compatibilityEvidence: string;
  supportTicketLinkageStatus: "linked" | "missing_ticket" | "mismatched_ticket";
  supportTicketLinkageEvidence: string;
  tenantScopeStatus: "linked" | "mismatched_tenant_scope";
  tenantScopeEvidence: string;
  traceLinkageStatus: "linked" | "not_required" | "mismatched_trace";
  traceLinkageEvidence: string;
  apiOutcome:
    | "post_retry_202_accepted"
    | "post_cancel_202_review_required"
    | "post_cancel_202_cancelled"
    | "disabled_423_hold"
    | "disabled_409_conflict";
  quotaLedgerEffect:
    | "release_reserved_credit_once"
    | "refund_pending_until_audit"
    | "refund_on_cancel_after_review"
    | "no_quota_mutation";
  supportNoticeStatus: "ready" | "missing";
  auditWritePolicy:
    | "write_submit_audit_before_queue_mutation"
    | "write_review_audit_before_cancel_closure"
    | "write_blocked_attempt_audit";
  regressionGateEffect:
    | "canary_fixture_ready"
    | "canary_fixture_blocks_until_review"
    | "no_regression_fixture_blocks_release";
  closureEvidenceStatus: "complete" | "incomplete";
  rbacEvidenceStatus: "complete" | "missing";
  rbacEvidenceRefs: string[];
  userMessageStatus: "ready" | "missing";
  blockerCodes: string[];
  submitDisabledReason: string;
  operatorAction: string;
  auditRef: string;
};

export type FailedTaskSubmissionContract = {
  taskId: string;
  queueId: string;
  requestedAction: FailedTaskControl["requestedAction"];
  requestMethod: "POST";
  requestPath: string;
  submitEnabled: boolean;
  submitDecision: FailedTaskRuntimeDecision["submitDecision"];
  apiOutcome: FailedTaskRuntimeDecision["apiOutcome"];
  csrfScope: "admin_session_cookie";
  requiredHeaders: string[];
  idempotencyKey: string;
  idempotencyHeaderStatus: "stable" | "unstable";
  preconditionHeader: string;
  preconditionDigestStatus: FailedTaskRuntimeDecision["stateDigestStatus"];
  queueAttemptHeader: string;
  queueAttemptStatus: FailedTaskRuntimeDecision["queueAttemptStatus"];
  supportTicketId: string;
  abuseControlHeader: string;
  abuseControlStatus: FailedTaskRuntimeDecision["abuseControlStatus"];
  abuseControlReleaseEvidenceHeader: string;
  abuseControlReleaseEvidenceStatus: FailedTaskRuntimeDecision["abuseControlReleaseEvidenceStatus"];
  abuseControlReleaseEvidenceRefs: string[];
  abuseControlMissingReleaseEvidenceRefs: string[];
  responseContract: string;
  mutationOrder: "audit_then_queue_mutation" | "audit_then_review_hold" | "blocked_attempt_audit_only";
  quotaLedgerEffect: FailedTaskRuntimeDecision["quotaLedgerEffect"];
  releaseGateUse: "release_evidence_candidate" | "preserve_eval_gate" | "not_release_evidence";
  replayProtection: "stable_idempotent_precondition" | "blocked_replay_or_unstable_key";
  secondReviewStatus: FailedTaskRuntimeDecision["secondReviewStatus"];
  secondReviewEvidenceStatus: FailedTaskRuntimeDecision["secondReviewEvidenceStatus"];
  secondReviewHeader: string;
  evidenceRefs: string[];
  blockerCodes: string[];
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
    aggregatePrivateBetaGateStatus: PrivateBetaAggregateGateStatus;
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
    aggregatePrivateBetaGateStatus: PrivateBetaAggregateGateStatus;
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
    aggregatePrivateBetaGateStatus: PrivateBetaAggregateGateStatus;
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
    aggregatePrivateBetaGateStatus: PrivateBetaAggregateGateStatus;
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
    aggregatePrivateBetaGateStatus: PrivateBetaAggregateGateStatus;
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

export type ProductionBackupRollbackIncidentSplitReadiness = {
  split:
    | "backup_restore"
    | "rollback_incident_smoke";
  exactEvidencePath: string;
  status: "blocked_until_exact_split_file";
  requiredRuntimeProof: string[];
  upstreamBlockers: string[];
  adminReviewSurface: string;
  checklistItem: string;
};

export type ProductionBackupRollbackSplitEvidenceStatus = {
  splitId: "backup_restore" | "rollback_incident_post_deploy_smoke";
  path: string;
  exists: boolean;
  status: "missing" | "invalid" | "passed" | "pass";
  passed: boolean;
  environment: "production" | null;
  releaseGateCheckId: "production_backup_rollback_incident" | null;
  missingRequirements: string[];
};

export type ProductionBackupRollbackUpstreamGateStatus = {
  gate: "ci" | "private_beta_staging" | "production_launch";
  path: string;
  exists: boolean;
  gateDecisionStatus: "go" | "no_go" | "missing";
  ready: boolean;
  blockedByChecks: string[];
  activeDoNotLaunchConditions: string[];
};

export type ProductionBackupRollbackSplitPreflightEvidence = {
  id: string;
  evidencePath: "ops/evidence/production/backup-rollback-split.blocked.json";
  environment: "production";
  status: "blocked_by_upstream_gates" | "exact_split_ready_blocked_by_other_production_runtime_items";
  releaseGateCheckId: "production_backup_rollback_incident";
  kind: "production_backup_rollback_split_preflight";
  releaseShaStatus: "missing_or_not_full_sha" | "bound";
  adminVisibleProbePath: "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json";
  adminVisibleProbeReady: boolean;
  blockedChecks: string[];
  upstreamGates: ProductionBackupRollbackUpstreamGateStatus[];
  exactSplitEvidence: ProductionBackupRollbackSplitEvidenceStatus[];
  requiredUpstreamGates: string[];
  canClearReleaseGateCheck: boolean;
  canClearCheckLevelItems: boolean;
  aggregateProductionGateStatus:
    | "blocked_by_upstream_or_missing_exact_split_evidence"
    | "blocked_by_other_production_runtime_items";
  preservedReleaseGateCheckId: "production_backup_rollback_incident" | null;
  preservedDoNotLaunchConditionIds: string[];
  runtimeInputRequirements: Array<{
    split: "backup_restore" | "rollback_incident_post_deploy_smoke";
    path: string;
    mustProve: string[];
  }>;
  operatorAction: string;
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
  splitReadiness: ProductionBackupRollbackIncidentSplitReadiness[];
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
  batchId: string;
  taskId: string;
  traceId: string;
  assetId: string;
  exportId: string;
  quotaBucketId: string;
  quotaTransactionId: string;
  billingReferenceId: string;
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

export type SupportAdminDeletionRequest = {
  requestId: string;
  requestType:
    | "account_deletion"
    | "project_deletion"
    | "asset_deletion"
    | "export_deletion"
    | "billing_data_erasure_review";
  subjectUserId: string;
  tenantId: string;
  supportTicketId: string;
  status:
    | "blocked_pending_evidence"
    | "ready_for_second_review"
    | "retention_hold"
    | "closed_no_action";
  requiredRole: AdminRole;
  secondReviewRequired: boolean;
  secondReviewStatus: "required" | "completed" | "not_required" | "blocked";
  abuseHoldRef: string;
  linkedTraceIds: string[];
  linkedAssetIds: string[];
  linkedExportIds: string[];
  billingReferenceIds: string[];
  retainedEvidenceRefs: string[];
  deletionPlan: string;
  retentionBoundary: string;
  blockedReason: string;
  userVisibleMessage: string;
  auditRef: string;
};

export type SupportAdminDeletionGovernanceContract = {
  schema: "stage1.support-admin-deletion-governance-local-contract.v1";
  contractId: "stage1.support-admin-deletion-governance-local-contract";
  routeMarker: "stage1.support-admin-deletion-governance-local-contract";
  blueprintItems: Array<"AD-12" | "BE-12" | "OP-12" | "OP-13" | "VF-5" | "VF-7">;
  adminRoute: "admin/app/support/page.tsx";
  evidenceSource: "admin fixture local contract";
  requiredDeletionFields: string[];
  requiredLinkedEvidence: string[];
  deniedProjectionFields: string[];
  preservedDoNotLaunchConditions: string[];
  blockedGateChecks: string[];
  requests: SupportAdminDeletionRequest[];
  canClearStagingGate: false;
  canClearProductionGate: false;
  canCloseDoNotLaunch: false;
  mutationControlsEnabled: false;
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
  safetyDecisionId?: string;
  rule: string;
  enforcementPoint: "brief" | "provider_request" | "provider_response" | "qa" | "export";
  severity: RiskLevel;
  action: "warn" | "require_admin_review" | "block";
  overrideEligible: boolean;
  auditRequired: boolean;
  reviewRationale: string;
  secondReviewRequired: boolean;
  reviewStatus?: "pending" | "approved" | "rejected" | "escalated" | "blocked";
  reviewerId?: string;
  auditRef?: string;
  requiredEvidenceRefs?: string[];
  userVisibleOutcome?: string;
  source?: "api" | "fixture";
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
  expiryLifecycle:
    | "within_window"
    | "expired_requires_release_evidence"
    | "released_after_evidence"
    | "dry_run_not_enforced";
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
  releaseEvidenceRefs: string[];
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
  releaseEvidenceStatus: "complete" | "missing";
  missingReleaseEvidenceRefs: string[];
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

export type AuditSearchExportManifest = {
  schema: "stage1.audit-search-export-local-contract.v1";
  route: "/audit";
  exportedAt: string;
  resultCount: number;
  highRiskCount: number;
  secondReviewOpenCount: number;
  immutableCount: number;
  fieldAllowlist: string[];
  deniedFields: string[];
  filterPresets: string[];
  canClearStagingGate: false;
  canClearProductionGate: false;
  canCloseDoNotLaunch: false;
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

export type AdminRbacClosureMatrixRow = {
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  evidenceIds: string[];
  requiredRoles: AdminRole[];
  runtimeOutcomes: AdminRbacRuntimeDecision["requestOutcome"][];
  roleGateCoverage: "covered" | "missing";
  secondReviewCoverage: "covered" | "not_required" | "missing";
  expiryCoverage: "enforced" | "policy_block" | "missing";
  staleReplayCoverage: "covered" | "not_required" | "missing";
  auditCoverage: "attached" | "missing";
  releaseEvidenceCoverage: "attached" | "missing";
  closureDisposition:
    | "ready_for_release_use"
    | "preserved_by_second_review"
    | "preserved_by_policy_or_role"
    | "preserved_by_mixed_runtime";
  releaseGateStatus: "release_use_allowed" | "release_gate_preserved";
  blockerCodes: string[];
  operatorAction: string;
};

export type AdminRbacReleaseEvidenceClosure = {
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  evidenceIds: string[];
  attemptIds: string[];
  staleReplayEvidenceIds: string[];
  closureEvidenceRefs: string[];
  releaseEvidenceRequired: string[];
  runtimeOutcomes: AdminRbacRuntimeDecision["requestOutcome"][];
  attemptOutcomes: AdminRbacOverrideAttemptDecision["requestOutcome"][];
  staleReplayOutcomes: AdminRbacStaleReplayDecision["staleOutcome"][];
  auditRefs: string[];
  attemptCoverage: "covered" | "missing";
  staleReplayCoverage: "covered" | "not_required" | "missing";
  releaseEvidenceStatus: "attached" | "missing";
  attemptEvidenceStatus: "valid" | "invalid" | "missing";
  releaseMutationAttemptStatus: "submittable" | "blocked" | "not_applicable";
  attemptBlockerCodes: string[];
  releaseGateDisposition: AdminRbacEvidencePack["releaseGateDisposition"];
  closureStatus:
    | "release_ready_with_expiry"
    | "preserved_for_review"
    | "preserved_by_policy"
    | "preserved_by_stale_replay"
    | "missing_evidence";
  releaseGateStatus: "release_use_allowed" | "release_gate_preserved";
  operatorAction: string;
};

export type AdminRbacReleaseReadinessSummary = {
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  readyState: "release_ready" | "gate_preserved" | "missing_evidence";
  mutationMode:
    | "temporary_mutation"
    | "second_review_hold"
    | "policy_block"
    | "stale_replay_preserved"
    | "mixed_runtime";
  evidenceIds: string[];
  requiredRoles: AdminRole[];
  auditRefs: string[];
  closureEvidenceRefs: string[];
  attemptCoverage: AdminRbacReleaseEvidenceClosure["attemptCoverage"];
  staleReplayCoverage: AdminRbacReleaseEvidenceClosure["staleReplayCoverage"];
  releaseEvidenceStatus: AdminRbacReleaseEvidenceClosure["releaseEvidenceStatus"];
  attemptEvidenceStatus: AdminRbacReleaseEvidenceClosure["attemptEvidenceStatus"];
  releaseMutationAttemptStatus: AdminRbacReleaseEvidenceClosure["releaseMutationAttemptStatus"];
  attemptBlockerCodes: string[];
  closureStatus: AdminRbacReleaseEvidenceClosure["closureStatus"];
  releaseGateStatus: AdminRbacReleaseEvidenceClosure["releaseGateStatus"];
  readinessRationale: string;
  operatorAction: string;
};

export type AdminRbacOverrideReleaseBundle = {
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  targetCount: number;
  evidenceIds: string[];
  attemptIds: string[];
  staleReplayEvidenceIds: string[];
  auditRefs: string[];
  releaseEvidenceRequired: string[];
  closureEvidenceRefs: string[];
  requiredRoles: AdminRole[];
  effectiveDecisions: AdminRbacRuntimeDecision["effectiveDecision"][];
  runtimeOutcomes: AdminRbacRuntimeDecision["requestOutcome"][];
  attemptOutcomes: AdminRbacOverrideAttemptDecision["requestOutcome"][];
  gateVerdict:
    | "release_ready_with_expiry"
    | "gate_preserved_by_review"
    | "gate_preserved_by_policy"
    | "gate_preserved_by_stale_replay"
    | "missing_evidence";
  releaseGateStatus: AdminRbacReleaseReadinessSummary["releaseGateStatus"];
  reviewHoldCount: number;
  deniedMutationCount: number;
  expiredReplayCount: number;
  temporaryMutationCount: number;
  evidenceHealth: "complete" | "missing_evidence";
  blockerCodes: string[];
  releaseUseEligibility:
    | "eligible_temporary_mutation"
    | "preserved_by_review"
    | "preserved_by_policy"
    | "preserved_by_stale_replay"
    | "missing_evidence";
  releaseUseAllowed: boolean;
  operatorAction: string;
};

export type AdminRbacReleaseEvidenceMatrixRow = {
  surface: AdminReviewSurface;
  overrideScope: AdminRbacEvidence["overrideScope"];
  evidenceId: string;
  attemptId: string;
  target: string;
  apiScope: string;
  csrfScope: AdminRbacOverrideAttempt["csrfScope"];
  idempotencyStatus: AdminRbacOverrideAttemptDecision["idempotencyStatus"];
  stateDigestStatus: AdminRbacOverrideAttemptDecision["stateDigestStatus"];
  expectedHttpStatus: AdminRbacOverrideAttempt["expectedHttpStatus"];
  runtimeRequestOutcome: AdminRbacOverrideAttemptDecision["runtimeRequestOutcome"];
  releaseMutationAttemptStatus: AdminRbacReleaseEvidenceClosure["releaseMutationAttemptStatus"];
  releaseUseEligibility: AdminRbacOverrideReleaseBundle["releaseUseEligibility"];
  releaseGateStatus: AdminRbacOverrideReleaseBundle["releaseGateStatus"];
  staleReplayCoverage: AdminRbacReleaseEvidenceClosure["staleReplayCoverage"];
  releaseEvidenceStatus: AdminRbacReleaseEvidenceClosure["releaseEvidenceStatus"];
  auditRef: string;
  closureEvidenceRefs: string[];
  blockerCodes: string[];
  operatorAction: string;
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

export type Stage1ReleaseReadinessComponent = {
  componentId: string;
  environment: "staging" | "production" | "unknown";
  status: string;
  exactEvidence: boolean;
  localOnly: boolean;
  dryRun: boolean;
  blockersPreserved?: boolean;
  secretLeakDetected: boolean;
  rawPayloadPersisted: boolean;
  evidenceRefs: string[];
  checkLevelPassed?: boolean;
  checkLevelBlockersPreserved?: boolean;
  checkLevelEvidenceRefs?: string[];
  resultsRef?: string | null;
  proofs: string[];
  blockers: string[];
  validatorCommands: string[];
};

export type Stage1ReleaseGateFixture = {
  gateId: string;
  path: string;
  status: string;
  blockedByChecks: string[];
  activeDoNotLaunchConditions: string[];
  blockers: string[];
};

export type Stage1CIEvidence = {
  path: string;
  status: string;
  blockers: string[];
};

export type Stage1ReleaseBundlePreflight = {
  path: string;
  exists: boolean;
  status: string;
  decision: string;
  stage1StagingRuntimeVerified: boolean;
  stage1QuotaReplayVerified: boolean;
  stage1LoadVerified: boolean;
  objectRetentionCleanupVerified: boolean;
  legalSupportVisibilityVerified: boolean;
  ciClosureArtifactsReady: boolean;
  productionBackupRollbackSplitReady: boolean;
  releaseMetadataPreflightStatus: string;
  releaseMetadataPreflightComplete: boolean;
  releaseMetadataMissingSlots: string[];
  releaseMetadataUnverifiedSlots: string[];
  releaseMetadataBlockingReasons: string[];
  blockingReasonCount?: number;
  stage1StagingRuntimeBlockingReasons: string[];
  stage1QuotaReplayBlockingReasons: string[];
  stage1LoadBlockingReasons: string[];
  missingSlots: string[];
  unverifiedSlots: string[];
  ciClosureArtifactBlockingReasons: string[];
  productionBackupRollbackSplitBlockingReasons: string[];
  blockingReasons: string[];
  blockers: string[];
};

export type Stage1AggregateResultRow = {
  componentId: string;
  environment: "staging" | "production" | "unknown";
  status: string;
  exactEvidence: boolean;
  secretLeakDetected: boolean;
  rawPayloadPersisted: boolean;
  blockersPreserved?: boolean;
  checkLevelPassed?: boolean;
  checkLevelBlockersPreserved?: boolean;
  checkLevelEvidenceRefs?: string[];
  blockers: string[];
};

export type Stage1AggregateGateCheck = {
  checkId: string;
  passed: boolean;
  detail: string;
};

export type Stage1AggregateGateSafety = {
  strictGateReady: boolean;
  verdict: "go" | "blocked";
  strictGateBlockers: string[];
  checks: Stage1AggregateGateCheck[];
};

export type Stage1MissingEvidenceRef = {
  componentId: string;
  refType: "evidence" | "results" | "unknown";
  path: string;
  source: "aggregate" | "component";
  blocker: string;
};

export type Stage1AggregateEvidence = {
  schemaVersion: string;
  kind: string;
  environment: "staging" | "production" | "unknown";
  sourcePath: string;
  resultsPath: string;
  evidencePresent: boolean;
  resultsPresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  allComponentsPassed: boolean;
  allReleaseGatesGo?: boolean;
  blockers: string[];
  doNotLaunchConditions: string[];
  missingEvidenceRefs: Stage1MissingEvidenceRef[];
  components: Stage1ReleaseReadinessComponent[];
  resultRows: Stage1AggregateResultRow[];
  releaseGateFixtures: Stage1ReleaseGateFixture[];
  ciEvidence: Stage1CIEvidence[];
  releaseBundlePreflight?: Stage1ReleaseBundlePreflight;
  runtimeInputReadiness: Record<string, boolean>;
  validatorCommands: string[];
  gateSafety: Stage1AggregateGateSafety;
  safetyPolicy: {
    secretMaterialPersisted: boolean;
    rawPromptPersisted: boolean;
    rawProviderPayloadPersisted: boolean;
    rawStripePayloadPersisted: boolean;
    rawSupportBodyProjected: boolean;
    signedUrlPersisted: boolean;
    authorizationHeaderPersisted: boolean;
    cookiePersisted: boolean;
  };
};

export type Stage1ExternalResourceGroup = {
  resourceId: string;
  lane: "provider" | "staging" | "ci" | "production" | "unknown";
  status: "ready" | "provided_unverified" | "blocked" | "missing" | "unknown";
  requiredResource: string;
  providedSignal: string;
  validationSignal: string;
  currentBlocker: string;
  gateDependency: string;
  evidenceRefs: string[];
  validator: string;
  nextAction: string;
  operatorAsk: string;
  sourceProbeRequirements: Stage1ProductionSourceProbeRequirement[];
};

export type Stage1ProductionSourceProbeRequirement = {
  probeId: string;
  path: string;
  schemaVersion: string;
  status: "present" | "missing" | "unknown";
  sourceProbeExists: boolean;
  reportedByProductionAggregate: boolean;
  currentBlocker: string;
  generator: string;
  strictValidator: string;
};

export type Stage1NonClearingRefreshBlockedEvidenceDetail = {
  stepId: string;
  source: string;
  detail: string;
};

export type Stage1ExternalResourceNonClearingRefreshSummary = {
  path: string;
  status: string;
  stepSummary: Stage1ProductionNonClearingRefreshStepSummary;
  stage1Progress: {
    completed: number;
    total: number;
    completionPercent: number;
  };
  productionInputProgress: {
    configured: number;
    total: number;
    completionPercent: number;
  };
  blockedEvidenceDetails: Stage1NonClearingRefreshBlockedEvidenceDetail[];
};

export type Stage1ExternalResourceHandoff = {
  status: string;
  currentLoopBreaker: string;
  readyResourceIds: string[];
  missingResourceIds: string[];
  blockedResourceIds: string[];
  missingVariables: string[];
  resourceClasses: string[];
  productionSourceProbeRequirements: Stage1ProductionSourceProbeRequirement[];
  commandsAfterInputs: string[];
  inputPacketRef: string;
  operatorBriefRef: string;
  missingInputChecklistRef: string;
  sourceProbeRunbookRef: string;
  resourceStatus: Record<string, string>;
  nonClearingPreflight: boolean;
  nonClearingRefreshSummary: Stage1ExternalResourceNonClearingRefreshSummary;
};

export type Stage1ExternalResourceReadiness = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  total: number;
  ready: number;
  providedUnverified: number;
  blocked: number;
  missing: number;
  readyPercent: number;
  blockers: string[];
  operatorHandoff: Stage1ExternalResourceHandoff;
  nonClearingRefreshSummary: Stage1ExternalResourceNonClearingRefreshSummary;
  productionSourceProbeRequirements: Stage1ProductionSourceProbeRequirement[];
  resourceGroups: Stage1ExternalResourceGroup[];
};

export type Stage1AzureOriginProbeRow = {
  status: string;
  errorSummary: string;
};

export type Stage1AzureOriginTcpProbe = Stage1AzureOriginProbeRow & {
  host: string;
  port: number;
};

export type Stage1AzureOriginHttpProbe = Stage1AzureOriginProbeRow & {
  url: string;
  method: string;
  httpStatus: number | null;
  finalUrlHost: string;
  bodySamplePresent: boolean;
  networkPhase: string;
  failureCategory: string;
  responseBytes: number;
};

export type Stage1AzureOriginDnsProbe = Stage1AzureOriginProbeRow & {
  host: string;
  addresses: string[];
};

export type Stage1AzureOriginSshPreflight = Stage1AzureOriginProbeRow & {
  targetUser: string;
  targetHost: string;
  exitCode: number;
  authMethod: string;
  reason: string;
  passwordAttempted: boolean;
  hardTimeoutSeconds: number;
};

export type Stage1AzureCliPreflight = Stage1AzureOriginProbeRow & {
  reason: string;
  subscriptionId: string;
  resourceGroup: string;
  vmName: string;
  azureIp: string;
  exitCode: number;
};

export type Stage1AzureTransportDiagnosis = Stage1AzureOriginProbeRow & {
  lane: string;
  nextAction: string;
  operatorSummary: string;
  blockedReasons: string[];
  tcpEntryPortsReachable: boolean;
  tcp22Reachable: boolean;
  tcp80Reachable: boolean;
  tcp443Reachable: boolean;
  sshTransportPhase: string;
  sshBannerReceived: boolean;
  sshAuthReached: boolean;
  sshPasswordKeyRepairViable: boolean;
  httpRequestSent: boolean;
  httpResponseStarted: boolean;
  httpZeroBytesAfterRequest: boolean;
  tlsServerhelloTimeout: boolean;
  azurePortalRunCommandRequired: boolean;
};

export type Stage1AzureOriginReadiness = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  azureIp: string;
  stagingWebUrl: string;
  stagingHost: string;
  nonClearingOriginProbe: boolean;
  canonicalPassPath: boolean;
  canClearStage1StagingRuntimeGate: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  tcpPorts: Stage1AzureOriginTcpProbe[];
  stagingDns: Stage1AzureOriginDnsProbe;
  httpProbes: Stage1AzureOriginHttpProbe[];
  sshKeyPreflight: Stage1AzureOriginSshPreflight;
  azureCliPreflight: Stage1AzureCliPreflight;
  transportDiagnosis: Stage1AzureTransportDiagnosis;
  blockedChecks: string[];
  sshHardTimeoutSeconds: number;
  localRepairPasswordEnvKey: string;
  localRepairPasswordConfigured: boolean;
  localRepairPasswordRequired: boolean;
  originRepairCommands: string[];
  originDiagnosticsCommand: string;
  originRepairCommand: string;
  operatorNextActions: string[];
};

export type Stage1EvidenceClosureQueueRow = {
  priority: string;
  lane: "staging" | "ci" | "production" | "unknown";
  rowStatus: "open" | "passed" | "unknown";
  gate: string;
  requiredEvidence: string;
  validator: string;
  generator: string;
  currentBlocker: string;
  dnlImpact: string;
};

export type Stage1EvidenceClosureQueueParallelBlocker = {
  blockerId: string;
  lane: string;
  status: string;
  releaseGateImpact: string;
  sourceRefs: string[];
  currentBlocker: string;
  nextAction: string;
  operatorCommand: string;
  transportLane: string;
  transportNextAction: string;
  runCommandNextRepairLane: string;
  runCommandInputPresent: boolean;
  canClearStage1StagingRuntimeGate: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
};

export type Stage1EvidenceClosureQueueOperatorActionPacketItem = {
  order: number;
  itemId: string;
  owner: string;
  status: string;
  requiresExternalInput: boolean;
  requiredReturnArtifact: string;
  agentCommandAfterReturn: string;
  validationAfterReturn: string;
  evidenceRef: string;
  gateImpact: string;
  canClearStage1StagingRuntimeGate: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
};

export type Stage1EvidenceClosureQueueOperatorActionPacketSummary = {
  sourcePath: string;
  sourceSchemaVersion: string;
  status: string;
  releaseGateDecision: string;
  canonicalPassPath: boolean;
  total: number;
  blocked: number;
  requiresExternalInput: number;
  ownerCounts: Record<string, number>;
  gateImpactCounts: Record<string, number>;
  sourceGateFlagsAllFalse: boolean;
  items: Stage1EvidenceClosureQueueOperatorActionPacketItem[];
  canClearStage1StagingRuntimeGate: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
};

export type Stage1EvidenceClosureQueue = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  total: number;
  open: number;
  completed: number;
  completionPercent: number;
  p0: number;
  p1: number;
  p2: number;
  staging: number;
  ci: number;
  production: number;
  openGates: string[];
  queue: Stage1EvidenceClosureQueueRow[];
  parallelOperationalBlockers: Stage1EvidenceClosureQueueParallelBlocker[];
  parallelOperationalBlockerCount: number;
  operatorActionPacketSummary: Stage1EvidenceClosureQueueOperatorActionPacketSummary;
  operatorActionPacketItems: number;
};

export type Stage1ProductionProofInputCoverageGroup = {
  groupId: string;
  requiredTotal: number;
  requiredConfigured: number;
  requiredMissing: number;
  requiredInvalid: number;
};

export type Stage1ProductionProofInputCoverage = {
  schemaVersion: string;
  valueRedaction: "variable_names_only" | string;
  requiredTotal: number;
  requiredConfigured: number;
  requiredMissing: number;
  requiredInvalid: number;
  requiredCompletionPercent: number;
  blockingInputCount: number;
  firstMissingOrInvalidInputs: string[];
  groups: Stage1ProductionProofInputCoverageGroup[];
};

export type Stage1ProductionBlockerAuditClosureSummary = {
  status: string;
  releaseGateDecision: string;
  path: string;
  total: number;
  completed: number;
  open: number;
  completionPercent: number;
  openGates: string[];
};

export type Stage1ProductionBlockerAuditDnsReadiness = {
  status: string;
  releaseGateDecision: string;
  path: string;
  productionWebUrl: string;
  publicDnsAStatus: string;
  publicDnsAaaaStatus: string;
  systemResolverStatus: string;
  firstBlocker: string;
};

export type Stage1ProductionDnsProbeRow = {
  probeId: string;
  status: string;
  host: string;
  rrtype: string;
  addresses: string[];
  records: string[];
  httpStatus: number | null;
  url: string;
  error: string;
};

export type Stage1ProductionDnsCutoverCloudflareZone = {
  zoneIdConfigured: boolean;
  apiTokenConfigured: boolean;
  proxied: boolean;
};

export type Stage1ProductionDnsCutoverTarget = {
  status: string;
  targetKind: string;
  targetHint: string;
  stagingControlCandidate: string;
};

export type Stage1ProductionDnsEvidenceOutputs = {
  cutoverPlan: string;
  dnsReadiness: string;
  legalSupportOperatorPacket: string;
  dnsRepairPacket?: string;
};

export type Stage1ProductionDnsRepairPacketSummary = {
  dnsBlockerCount: number;
  requiredInputCount: number;
  productionSystemResolverStatus: string;
  stagingControlResolverStatus: string;
  productionAStatus: string;
  productionAaaaStatus: string;
  stagingAStatus: string;
  cloudflareZoneIdConfigured: boolean;
  cloudflareApiTokenConfigured: boolean;
  productionDnsTargetStatus: string;
  sourceRunbookStepId: string;
  sourceRunbookBlockingInputCount: number;
};

export type Stage1ProductionDnsRecommendedRecord = {
  host: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: string;
  requiredWhen: string;
  currentStatus: string;
};

export type Stage1ProductionDnsPrivateEnvTemplate = {
  pathPlaceholder: string;
  gitignoreRequired: boolean;
  blankValuesOnly: boolean;
  allowedVariableNames: string[];
  templateLines: string[];
};

export type Stage1ProductionDnsOperatorCommand = {
  stepId: string;
  command: string;
  sideEffect: string;
  mayWriteDns: boolean;
  requiresReview: boolean;
};

export type Stage1ProductionDnsRepairPacket = {
  sourcePath: string;
  evidencePresent: boolean;
  schemaVersion: string;
  status: string;
  releaseGateDecision: string;
  nonClearingRepairPacket: boolean;
  canApplyDnsChanges: boolean;
  summary: Stage1ProductionDnsRepairPacketSummary;
  recommendedRecords: Stage1ProductionDnsRecommendedRecord[];
  cloudflareUiSteps: string[];
  cloudflareApiPlan: string[];
  privateEnvTemplate: Stage1ProductionDnsPrivateEnvTemplate;
  verificationCommands: string[];
  requiredInputs: string[];
  blockedChecks: string[];
  commandsAfterInputs: string[];
  operatorCommandPacket: Stage1ProductionDnsOperatorCommand[];
  operatorNextActions: string[];
};

export type Stage1ProductionDnsDetail = {
  schemaVersion: string;
  kind: string;
  readinessPath: string;
  cutoverPlanPath: string;
  readinessPresent: boolean;
  cutoverPlanPresent: boolean;
  status: string;
  cutoverStatus: string;
  releaseGateDecision: string;
  generatedAt: string;
  productionWebUrl: string;
  stagingControlUrl: string;
  nonClearingCutoverPlan: boolean;
  canonicalPassPath: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canClearProductionLegalSupportPolicy: boolean;
  canCloseDoNotLaunch: boolean;
  dnsSplitBrainObserved: boolean;
  cloudflareZone: Stage1ProductionDnsCutoverCloudflareZone;
  target: Stage1ProductionDnsCutoverTarget;
  requiredHosts: string[];
  blockedChecks: string[];
  operatorNextActions: string[];
  currentRecords: Stage1ProductionDnsProbeRow[];
  authoritativePublicDnsProbe: Stage1ProductionDnsProbeRow[];
  systemResolver: Stage1ProductionDnsProbeRow[];
  httpsProbe: Stage1ProductionDnsProbeRow[];
  applyResults: Stage1ProductionDnsProbeRow[];
  evidenceOutputs: Stage1ProductionDnsEvidenceOutputs;
  repairPacket: Stage1ProductionDnsRepairPacket;
};

export type Stage1ProductionBlockerAuditSourceRow = {
  probeId: string;
  status: string;
  missingInput: string;
  firstBlocker: string;
  operatorAction: string;
  sourcePath: string;
  sourceProbeExists: boolean;
  strictValidationSummary: string;
};

export type Stage1ProductionBlockerAudit = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  finalBlockerCount: number;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  nonClearingAudit: boolean;
  canonicalPassPath: boolean;
  closureSummary: Stage1ProductionBlockerAuditClosureSummary;
  productionDnsReadiness: Stage1ProductionBlockerAuditDnsReadiness;
  proofBundlePath: string;
  proofBundleStatus: string;
  proofBundleReleaseGateDecision: string;
  proofStatuses: Record<string, string>;
  proofInputCoverage: Stage1ProductionProofInputCoverage;
  productionSourceAudit: Stage1ProductionBlockerAuditSourceRow[];
  openSourceProbeIds: string[];
  liveSourceInputsNeeded: string[];
  stagingIsNotCurrentBlocker: boolean;
  stripeSandboxIsNotCurrentBlocker: boolean;
};

export type Stage1ProductionLaunchOperatorBriefSummary = {
  stage1GatesCompleted: number;
  stage1GatesTotal: number;
  stage1CompletionPercent: number;
  openGateCount: number;
  finalBlockerCount: number;
  productionInputsConfigured: number;
  productionInputsTotal: number;
  productionInputsCompletionPercent: number;
  productionInputsMissing: number;
  productionInputsInvalid: number;
  blockingInputCount: number;
};

export type Stage1ProductionLaunchOperatorBriefDiagnostic = {
  path: string;
  exists: boolean;
  status: string;
  schemaVersion: string;
  firstBlocker: string;
  canonicalSourceWritten: boolean;
};

export type Stage1ProductionLaunchOperatorBriefMatrixRow = {
  blockerId: string;
  title: string;
  status: string;
  coverageGroup: string;
  gateIds: string[];
  requiredConfigured: number;
  requiredTotal: number;
  requiredMissing: number;
  requiredInvalid: number;
  blockingInputCount: number;
  completionPercent: number;
  firstBlocker: string;
  firstMissingRequiredInputs: string[];
  invalidRequiredInputs: string[];
  diagnostic: Stage1ProductionLaunchOperatorBriefDiagnostic;
  sourceRefs: Record<string, string>;
  operatorNextActions: string[];
};

export type Stage1ProductionLaunchOperatorBrief = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  nonClearingOperatorBrief: boolean;
  canonicalPassPath: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  valueRedaction: string;
  sourceRefs: Record<string, string>;
  summary: Stage1ProductionLaunchOperatorBriefSummary;
  openGates: string[];
  blockerMatrix: Stage1ProductionLaunchOperatorBriefMatrixRow[];
  operatorNextActions: string[];
};

export type Stage1ProductionMissingInputChecklistSummary = {
  requiredTotal: number;
  requiredConfigured: number;
  requiredMissing: number;
  requiredInvalid: number;
  blockingInputCount: number;
  requiredCompletionPercent: number;
};

export type Stage1ProductionMissingInputChecklistItem = {
  groupId: string;
  requirementId: string;
  displayName: string;
  status: string;
  acceptedVariableNames: string[];
  configuredVariableName: string | null;
  acceptableEvidenceSource: string;
  disallowedSubstitutes: string[];
  canBeSatisfiedByExistingSandboxOrStagingResources: boolean;
  operatorAction: string;
};

export type Stage1ProductionMissingInputChecklistGroup = {
  groupId: string;
  title: string;
  requiredTotal: number;
  requiredConfigured: number;
  requiredMissing: number;
  requiredInvalid: number;
  blockingInputCount: number;
  completionPercent: number;
  firstMissingRequiredInputs: string[];
  invalidRequiredInputs: string[];
  operatorNextAction: string;
  items: Stage1ProductionMissingInputChecklistItem[];
};

export type Stage1ProductionMissingInputChecklist = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  nonClearingChecklist: boolean;
  canonicalPassPath: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  valueRedaction: string;
  sourceRefs: Record<string, string>;
  summary: Stage1ProductionMissingInputChecklistSummary;
  groups: Stage1ProductionMissingInputChecklistGroup[];
  items: Stage1ProductionMissingInputChecklistItem[];
  operatorNextActions: string[];
};

export type Stage1ProductionLaunchInputPacketSourceInput = {
  probeId: string;
  status: string;
  sourceProbeExists: boolean;
  sourcePath: string;
  sourceSchemaVersion: string;
  diagnosticPath: string;
  missingInput: string;
  firstBlocker: string;
  currentBlocker: string;
  proofTemplateRef: string | null;
  sourceTemplateRef: string;
  sourceProbeCommand: string;
  evidenceGenerator: string;
  strictValidator: string;
  supportingDiagnostics: string[];
};

export type Stage1ProductionLaunchInputPacketCommandGroup = {
  groupId: string;
  commands: string[];
};

export type Stage1ProductionLaunchInputPacketEnvGroup = {
  groupId: string;
  variables: string[];
};

export type Stage1ProductionLaunchInputPacket = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  nonClearingInputPacket: boolean;
  canonicalPassPath: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  productionDnsReadinessStatus: string;
  productionDnsReadinessPath: string;
  productionDnsReadinessFirstBlocker: string;
  proofBundlePath: string;
  proofBundleStatus: string;
  proofBundleReleaseGateDecision: string;
  proofBundleCanonicalSourcesRequested: boolean;
  proofBundlePipelineStatus: string;
  proofBundleFirstBlockers: string[];
  proofInputCoverage: Stage1ProductionProofInputCoverage;
  requiredEnvVariableGroups: Stage1ProductionLaunchInputPacketEnvGroup[];
  sourceInputs: Stage1ProductionLaunchInputPacketSourceInput[];
  executionOrder: Stage1ProductionLaunchInputPacketCommandGroup[];
  missingVariables: string[];
  canonicalWritePolicy: string;
};

export type Stage1ProductionOperatorPacketSourceProbe = {
  canonicalSourcePath: string;
  canonicalSourceExists: boolean;
  sourceProbeCommand: string;
  diagnosticPath: string;
  diagnosticStatus: string;
  firstBlocker: string;
};

export type Stage1ProductionOperatorPacketProof = {
  candidatePath: string;
  blockedDiagnosticPath: string;
  blockedDiagnosticStatus: string;
  firstBlocker: string;
  proofGeneratorCommand: string;
  proofValidatorCommand: string;
};

export type Stage1ProductionOperatorPacketRequirementGroup = {
  groupId: string;
  count: number;
  summary: string;
};

export type Stage1ProductionBillingLiveArtifact = {
  flag: string;
  name: string;
  prefix: string;
  section: string;
};

export type Stage1ProductionBillingNumericControl = {
  flag: string;
  name: string;
  rule: string;
};

export type Stage1ProductionBillingWebhookControl = {
  controlId: string;
  rule: string;
};

export type Stage1ProductionBillingPrivateEnvTemplate = {
  pathPlaceholder: string;
  gitignoreRequired: boolean;
  blankValuesOnly: boolean;
  allowedVariableNames: string[];
  templateLines: string[];
};

export type Stage1ProductionBillingOperatorCommand = {
  stepId: string;
  command: string;
  sideEffect: string;
  mayWriteCanonicalSource: boolean;
  requiresReview: boolean;
};

export type Stage1ProductionPrivateEnvTemplate = {
  pathPlaceholder: string;
  gitignoreRequired: boolean;
  blankValuesOnly: boolean;
  allowedVariableNames: string[];
  templateLines: string[];
};

export type Stage1ProductionOperatorCommand = {
  stepId: string;
  command: string;
  sideEffect: string;
  mayWriteCanonicalSource: boolean;
  mayApplyProductionDns: boolean;
  requiresReview: boolean;
};

export type Stage1ProductionSecurityRuntimeRef = {
  section: string;
  flag: string;
  requiredRuntimeAssertions: string;
};

export type Stage1ProductionLegalDnsRequirement = {
  field: string;
  value: string;
};

export type Stage1ProductionLegalPublicPath = {
  group: string;
  pageId: string;
  method: string;
  path: string;
  expectedHttpStatus: number;
  visibility: string;
  externalUserVisible: boolean;
  adminSessionRequired: boolean;
  requiredTokens: string[];
};

export type Stage1ProductionLegalHttpsProbe = {
  path: string;
  status: string;
  httpStatus: string;
  errorSummary: string;
};

export type Stage1ProductionGovernanceComponent = {
  component: string;
  releaseGateCheckId: string;
  runtimeFlag: string;
  auditFlag: string;
  sectionRefCount: number;
  requiredIdCount: number;
};

export type Stage1ProductionGovernanceSectionRef = {
  component: string;
  section: string;
  flag: string;
  requiredAssertions: string;
};

export type Stage1ProductionGovernanceRequiredId = {
  component: string;
  field: string;
  flag: string;
  rule: string;
};

export type Stage1ProductionOperatorPacket = {
  packetId: "billing" | "security" | "legal_support" | "governance" | "unknown";
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  releaseGateCheckId: string;
  nonClearingOperatorPacket: boolean;
  canonicalPassPath: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  blockedUntil: string[];
  evidenceOutputs: Record<string, string>;
  sourceProbe: Stage1ProductionOperatorPacketSourceProbe;
  proof: Stage1ProductionOperatorPacketProof;
  requirementGroups: Stage1ProductionOperatorPacketRequirementGroup[];
  billingEnvClassification: Record<string, string>;
  billingLiveArtifacts: Stage1ProductionBillingLiveArtifact[];
  billingNumericControls: Stage1ProductionBillingNumericControl[];
  billingWebhookControls: Stage1ProductionBillingWebhookControl[];
  billingAuditRefs: string[];
  billingExecutionOrder: string[];
  billingPrivateEnvTemplate: Stage1ProductionBillingPrivateEnvTemplate;
  billingOperatorCommandPacket: Stage1ProductionBillingOperatorCommand[];
  securityRuntimeRefs: Stage1ProductionSecurityRuntimeRef[];
  securityExecutionOrder: string[];
  securityPrivateEnvTemplate: Stage1ProductionPrivateEnvTemplate;
  securityOperatorCommandPacket: Stage1ProductionOperatorCommand[];
  legalDnsRequirements: Stage1ProductionLegalDnsRequirement[];
  legalPublicPaths: Stage1ProductionLegalPublicPath[];
  legalHttpsProbes: Stage1ProductionLegalHttpsProbe[];
  legalOperatorNextActions: string[];
  legalExecutionOrder: string[];
  legalOperatorCommandPacket: Stage1ProductionOperatorCommand[];
  governanceComponents: Stage1ProductionGovernanceComponent[];
  governanceSectionRefs: Stage1ProductionGovernanceSectionRef[];
  governanceRequiredIds: Stage1ProductionGovernanceRequiredId[];
  governanceExecutionOrder: string[];
  governancePrivateEnvTemplate: Stage1ProductionPrivateEnvTemplate;
  governanceOperatorCommandPacket: Stage1ProductionOperatorCommand[];
};

export type Stage1ProductionLaunchSourcePipelineStep = {
  stepId: string;
  status: string;
  exitCode: number;
  expectedExit: boolean;
  command: string;
  outputSummary: string;
};

export type Stage1ProductionLaunchSourcePipelineProofReadiness = {
  proofId: string;
  path: string;
  exists: boolean;
  required: boolean;
};

export type Stage1ProductionLaunchSourcePipeline = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  releaseSha: string;
  productionWebUrl: string;
  nonClearingPipelineSummary: boolean;
  canonicalSourcesRequested: boolean;
  canonicalSourcesMayBeWritten: boolean;
  aggregateAttempted: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  preservedDoNotLaunchCondition: string;
  strictValidator: string;
  blockedChecks: string[];
  proofReadiness: Stage1ProductionLaunchSourcePipelineProofReadiness[];
  steps: Stage1ProductionLaunchSourcePipelineStep[];
};

export type Stage1ProductionSourceProbeRunbookSummary = {
  runbookStepCount: number;
  readyToExecuteCount: number;
  blockedStepCount: number;
  blockingInputCount: number;
  productionInputsConfigured: number;
  productionInputsTotal: number;
  productionInputsMissing: number;
  productionInputsInvalid: number;
  productionInputsCompletionPercent: number;
  stage1GatesCompleted: number;
  stage1GatesTotal: number;
  stage1CompletionPercent: number;
};

export type Stage1ProductionSourceProbeRunbookPipelineState = {
  status: string;
  releaseGateDecision: string;
  canonicalSourcesRequested: boolean;
  canonicalSourcesMayBeWritten: boolean;
  aggregateAttempted: boolean;
  blockedChecks: string[];
};

export type Stage1ProductionSourceProbeRunbookStep = {
  stepId: string;
  order: number;
  coverageGroup: string;
  probeId: string;
  gateIds: string[];
  status: string;
  readyToExecute: boolean;
  blockingInputCount: number;
  requiredTotal: number;
  requiredConfigured: number;
  completionPercent: number;
  requiredBefore: string[];
  sourceProbeCommand: string;
  sourceOutputPath: string;
  diagnosticPath: string;
  strictValidator: string;
  evidenceGenerator: string;
  operatorPacketRef: string;
  sourceTemplateRef: string | null;
  proofTemplateRef: string | null;
  firstBlocker: string;
  missingOrInvalidInputs: string[];
  acceptableEvidenceSources: string[];
  disallowedSubstitutes: string[];
  canBeSatisfiedByExistingSandboxOrStagingResources: boolean;
  blockedUntil: string[];
  operatorNextAction: string;
};

export type Stage1ProductionSourceProbeRunbook = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  nonClearingRunbook: boolean;
  canonicalPassPath: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  valueRedaction: string;
  sourceRefs: Record<string, string>;
  summary: Stage1ProductionSourceProbeRunbookSummary;
  pipelineState: Stage1ProductionSourceProbeRunbookPipelineState;
  steps: Stage1ProductionSourceProbeRunbookStep[];
  operatorNextActions: string[];
};

export type Stage1ProductionProofBundleProof = {
  proofId: string;
  status: string;
  path: string;
  schemaVersion: string;
  firstBlocker: string;
};

export type Stage1ProductionProofBundleStep = {
  stepId: string;
  status: string;
  exitCode: number;
  expectedExit: boolean;
  command: string;
  outputSummary: string;
};

export type Stage1ProductionProofBundleRequirement = {
  groupId: string;
  requirementId: string;
  displayName: string;
  status: "configured" | "missing" | "invalid" | "unknown";
  configuredVariableName: string | null;
  acceptedVariableNames: string[];
};

export type Stage1ProductionProofBundleInputGroup = {
  groupId: string;
  requiredTotal: number;
  requiredConfigured: number;
  requiredMissing: number;
  requiredInvalid: number;
  configuredVariableNames: string[];
  missingRequiredInputs: string[];
  invalidRequiredInputs: string[];
  optionalOrDefaultedConfigured: number;
  optionalOrDefaultedTotal: number;
  optionalOrDefaultedConfiguredVariableNames: string[];
  requirements: Stage1ProductionProofBundleRequirement[];
};

export type Stage1ProductionProofBundle = {
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  releaseSha: string;
  productionWebUrl: string;
  nonClearingBundle: boolean;
  canonicalSourcesRequested: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  strictValidator: string;
  configuredInputVariableNames: Record<string, string[]>;
  inputCoverage: Stage1ProductionProofInputCoverage;
  inputGroups: Stage1ProductionProofBundleInputGroup[];
  proofs: Stage1ProductionProofBundleProof[];
  steps: Stage1ProductionProofBundleStep[];
  blockedChecks: string[];
};

export type Stage1ProductionProofDiagnosticFlag = {
  flag: string;
  persisted: boolean;
};

export type Stage1ProductionProofDiagnostic = {
  proofId: "billing" | "security" | "governance";
  schemaVersion: string;
  kind: string;
  sourcePath: string;
  evidencePresent: boolean;
  status: string;
  generatedAt: string;
  releaseSha: string;
  environment: string;
  canonicalSourceWritten: boolean;
  operatorNextCommandAfterPass: string;
  blockedChecks: string[];
  safetyFlags: Stage1ProductionProofDiagnosticFlag[];
};

export type Stage1ProductionProofDiagnostics = {
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  diagnostics: Stage1ProductionProofDiagnostic[];
  blockedDiagnosticCount: number;
  canonicalSourcesWritten: number;
  safeProjectionReady: boolean;
  firstBlockers: string[];
};

export type Stage1ProductionBlockerChecklistSection = {
  title: string;
  lineNumber: number;
};

export type Stage1ProductionBlockerChecklist = {
  sourcePath: string;
  evidencePresent: boolean;
  generatedAt: string;
  lineCount: number;
  releaseGateDecision: string;
  stage1GatesCompleted: number;
  stage1GatesTotal: number;
  stage1CompletionPercent: number;
  productionInputsConfigured: number;
  productionInputsTotal: number;
  productionInputsCompletionPercent: number;
  productionInputsMissing: number;
  productionInputsInvalid: number;
  blockingProductionInputs: number;
  productionSourceProbesReady: number;
  productionSourceProbesTotal: number;
  productionSourceProbesBlocked: number;
  sourceProbeBlockingInputCount: number;
  sections: Stage1ProductionBlockerChecklistSection[];
  firstBlockingRows: string[];
  commandCount: number;
  validatorCommand: string;
  generatorCommand: string;
  nonClearingChecklist: boolean;
  canClearStage1ProductionLaunchGate: false;
  canCloseDoNotLaunch: false;
};

export type Stage1ProductionActionMatrixLane = {
  laneId: string;
  order: number;
  title: string;
  status: string;
  owner: string;
  helpKind: string;
  blockingInputCount: number;
  completionPercent: number;
  requiredConfigured: number;
  requiredTotal: number;
  firstBlocker: string;
  immediateAction: string;
  agentActionAfterInputs: string;
  agentCanExecuteNow: boolean;
  agentCanExecuteAfterInputs: boolean;
  requiredUserMaterial: string[];
  blockedUntil: string[];
  automationCommands: string[];
  sourceProbeCommand: string;
  evidenceGenerator: string;
  strictValidator: string;
  operatorPacketRef: string;
  sourceOutputPath: string;
};

export type Stage1ProductionActionMatrixHelpItem = {
  rank: number;
  laneId: string;
  blockingInputCount: number;
  ask: string;
  firstRequiredMaterial: string[];
};

export type Stage1ProductionActionMatrix = {
  sourcePath: string;
  markdownPath: string;
  evidencePresent: boolean;
  markdownPresent: boolean;
  schemaVersion: string;
  kind: string;
  environment: string;
  generatedAt: string;
  status: string;
  releaseGateDecision: string;
  nonClearingActionMatrix: boolean;
  canonicalPassPath: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  stage1GatesCompleted: number;
  stage1GatesTotal: number;
  stage1CompletionPercent: number;
  productionInputsConfigured: number;
  productionInputsTotal: number;
  productionInputsCompletionPercent: number;
  productionInputsMissing: number;
  productionInputsInvalid: number;
  blockingInputCount: number;
  sourceProbesReady: number;
  sourceProbesTotal: number;
  sourceProbesBlocked: number;
  lanes: Stage1ProductionActionMatrixLane[];
  immediateHelpQueue: Stage1ProductionActionMatrixHelpItem[];
  notCurrentBlockers: string[];
  markdownLineCount: number;
  commandCount: number;
  generatorCommand: string;
  validatorCommand: string;
};

export type Stage1ProductionInputTemplateGroup = {
  groupId: string;
  title: string;
  requiredRequirementCount: number;
  requiredTemplateVariableCount: number;
  requiredTemplateVariables: string[];
  optionalOrDefaultedCount: number;
  optionalOrDefaultedVariables: string[];
  notes: string[];
};

export type Stage1ProductionInputTemplate = {
  sourcePath: string;
  manifestPath: string;
  evidencePresent: boolean;
  templatePresent: boolean;
  schemaVersion: string;
  kind: string;
  environment: string;
  generatedAt: string;
  status: string;
  releaseGateDecision: string;
  templatePath: string;
  nonClearingTemplate: boolean;
  canonicalPassPath: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  valuePolicy: string;
  templateVariableCount: number;
  requiredRequirementCount: number;
  requiredTemplateVariableCount: number;
  optionalOrDefaultedVariableCount: number;
  templateLineCount: number;
  commandCount: number;
  groups: Stage1ProductionInputTemplateGroup[];
  commandsAfterFill: string[];
  generatorCommand: string;
  validatorCommand: string;
};

export type Stage1ProductionNonClearingRefreshStepSummary = {
  total: number;
  passed: number;
  blocked: number;
  failed: number;
  unexpectedExitCount: number;
};

export type Stage1ProductionNonClearingRefreshProgressStage1 = {
  completed: number;
  total: number;
  completionPercent: number;
  releaseGateDecision: string;
};

export type Stage1ProductionNonClearingRefreshExternalResources = {
  ready: number;
  total: number;
  readyPercent: number;
};

export type Stage1ProductionNonClearingRefreshProductionInputs = {
  configured: number;
  total: number;
  completionPercent: number;
  missing: number;
  invalid: number;
  blockingInputCount: number;
};

export type Stage1ProductionNonClearingRefreshSourceProbes = {
  ready: number;
  total: number;
  blocked: number;
  blockingInputCount: number;
};

export type Stage1ProductionNonClearingRefreshActionLane = {
  laneId: string;
  blockingInputCount: number;
  completionPercent: number;
  firstBlocker: string;
};

export type Stage1ProductionNonClearingRefreshProgress = {
  stage1: Stage1ProductionNonClearingRefreshProgressStage1;
  externalResources: Stage1ProductionNonClearingRefreshExternalResources;
  productionInputs: Stage1ProductionNonClearingRefreshProductionInputs;
  productionSourceProbes: Stage1ProductionNonClearingRefreshSourceProbes;
  productionActionLanes: Stage1ProductionNonClearingRefreshActionLane[];
};

export type Stage1ProductionNonClearingRefreshStep = {
  stepId: string;
  status: string;
  exitCode: number;
  expectedExit: boolean;
  command: string;
  outputSummary: string;
};

export type Stage1ProductionNonClearingRefresh = {
  sourcePath: string;
  evidencePresent: boolean;
  schemaVersion: string;
  kind: string;
  environment: string;
  status: string;
  releaseGateDecision: string;
  generatedAt: string;
  productionWebUrl: string;
  stagingWebUrl: string;
  envFile: string;
  nonClearingRefresh: boolean;
  canonicalSourcesRequested: boolean;
  dnsApplyRequested: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  stepSummary: Stage1ProductionNonClearingRefreshStepSummary;
  progress: Stage1ProductionNonClearingRefreshProgress;
  steps: Stage1ProductionNonClearingRefreshStep[];
  blockedChecks: string[];
  outputRefs: Record<string, string>;
  nonClearingEvidenceOnly: boolean;
  preservedDoNotLaunchCondition: string;
  canonicalSourceWriteCommand: string;
  strictLaunchValidator: string;
  generatorCommand: string;
  validatorCommand: string;
};

export type Stage1NextBlockersStage1 = {
  completed: number;
  total: number;
  completionPercent: number;
  open: number;
  openGates: string[];
};

export type Stage1NextBlockersProductionInputs = {
  configured: number;
  total: number;
  completionPercent: number;
  missing: number;
  invalid: number;
  blockingInputCount: number;
};

export type Stage1NextBlockersSourceProbes = {
  ready: number;
  total: number;
  blocked: number;
  blockingInputCount: number;
};

export type Stage1NextBlockersNonClearingRefresh = {
  passed: number;
  total: number;
  blocked: number;
  failed: number;
};

export type Stage1NextBlockersAzureOrigin = {
  status: string;
  releaseGateDecision: string;
  blockedChecks: string[];
  httpPassed: number;
  httpTotal: number;
  httpFailureCategories: string[];
  tcpPassed: number;
  tcpTotal: number;
  sshStatus: string;
  sshReason: string;
  azureCliStatus: string;
  azureCliReason: string;
  transportLane: string;
  transportNextAction: string;
  transportSummary: string;
  transportBlockedReasons: string[];
  sshTransportPhase: string;
  sshPasswordKeyRepairViable: boolean;
  azurePortalRunCommandRequired: boolean;
  httpResponseStarted: boolean;
  repairCommandCount: number;
  repairCommands: string[];
};

export type Stage1NextBlockersRunCommandDiagnosis = {
  status: string;
  sourceStatus: string;
  supersededBy: string;
  findings: string[];
  sourceFindings: string[];
  sshRepairStatus: string;
  originRuntimeStatus: string;
  nextRepairLane: string;
  inputPresent: boolean;
  rawOutputPersisted: boolean;
  originSummary: Record<string, string>;
  outputPath: string;
};

export type Stage1NextBlockersProductionLane = {
  laneId: string;
  blockingInputCount: number;
  completionPercent: number;
  firstBlocker: string;
};

export type Stage1NextBlockersTopPriorityAction = {
  actionId: string;
  lane: string;
  status: string;
  why: string;
  command: string;
  requiresExternalInput: boolean;
  externalInput: string;
};

export type Stage1NextBlockersOperatorShortlistItem = {
  order: number;
  itemId: string;
  lane: string;
  status: string;
  requiresExternalInput: boolean;
  currentBlocker: string;
  operatorAction: string;
  agentActionAfterInput: string;
  command: string;
  evidenceRef: string;
  gateImpact: string;
  canClearStage1StagingRuntimeGate: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
};

export type Stage1NextBlockersOperatorActionPacketItem = {
  order: number;
  itemId: string;
  owner: string;
  status: string;
  requiresExternalInput: boolean;
  requiredReturnArtifact: string;
  agentCommandAfterReturn: string;
  validationAfterReturn: string;
  blindHandoffNote: string;
  evidenceRef: string;
  gateImpact: string;
  canClearStage1StagingRuntimeGate: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
};

export type Stage1NextBlockersSummary = {
  sourcePath: string;
  evidencePresent: boolean;
  schemaVersion: string;
  kind: string;
  environment: string;
  generatedAt: string;
  status: string;
  releaseGateDecision: string;
  canonicalPassPath: boolean;
  canClearStage1StagingRuntimeGate: boolean;
  canClearStage1ProductionLaunchGate: boolean;
  canCloseDoNotLaunch: boolean;
  stage1: Stage1NextBlockersStage1;
  productionInputs: Stage1NextBlockersProductionInputs;
  productionSourceProbes: Stage1NextBlockersSourceProbes;
  nonClearingRefresh: Stage1NextBlockersNonClearingRefresh;
  azureOrigin: Stage1NextBlockersAzureOrigin;
  azureRunCommandDiagnosis: Stage1NextBlockersRunCommandDiagnosis;
  productionLanes: Stage1NextBlockersProductionLane[];
  operatorShortlist: Stage1NextBlockersOperatorShortlistItem[];
  operatorActionPacket: Stage1NextBlockersOperatorActionPacketItem[];
  topPriorityAction: Stage1NextBlockersTopPriorityAction;
  evidenceRefs: Record<string, string>;
  secretMaterialPersisted: boolean;
  rawPromptPersisted: boolean;
  rawProviderPayloadPersisted: boolean;
  rawStripePayloadPersisted: boolean;
  rawSupportBodyProjected: boolean;
  signedUrlPersisted: boolean;
  authorizationHeaderPersisted: boolean;
  cookiePersisted: boolean;
  rawRunCommandOutputPersisted: boolean;
};

export type Stage1ReleaseReadinessContractAnchor = {
  id:
    | "staging_runtime"
    | "production_launch"
    | "release_evidence_closure_queue"
    | "external_resource_readiness"
    | "r2_bucket_readiness";
  contractPath: string;
  evidencePath: string;
  resultsPath: string;
  contractValidatorCommand: string;
  strictValidatorCommand: string;
  preflightValidatorCommand?: string;
  generatorCommand: string;
  gatePolicy: string;
};

export type Stage1ReleaseReadinessSummary = {
  gateId: string;
  path: string;
  status: string;
  blockerCount: number;
  activeDoNotLaunchCount: number;
};

export type Stage1ReleaseReadinessSnapshot = {
  generatedAt: string;
  decisionSource: "validator_evidence_only";
  manualGoControlsEnabled: false;
  staging: Stage1AggregateEvidence;
  production: Stage1AggregateEvidence;
  resourceReadiness: Stage1ExternalResourceReadiness;
  azureOriginReadiness: Stage1AzureOriginReadiness;
  closureQueue: Stage1EvidenceClosureQueue;
  productionBlockerAudit: Stage1ProductionBlockerAudit;
  productionLaunchOperatorBrief: Stage1ProductionLaunchOperatorBrief;
  productionMissingInputChecklist: Stage1ProductionMissingInputChecklist;
  productionDnsDetail: Stage1ProductionDnsDetail;
  productionLaunchInputPacket: Stage1ProductionLaunchInputPacket;
  productionOperatorPackets: Stage1ProductionOperatorPacket[];
  productionLaunchSourcePipeline: Stage1ProductionLaunchSourcePipeline;
  productionSourceProbeRunbook: Stage1ProductionSourceProbeRunbook;
  productionProofBundle: Stage1ProductionProofBundle;
  productionProofDiagnostics: Stage1ProductionProofDiagnostics;
  productionBlockerChecklist: Stage1ProductionBlockerChecklist;
  productionActionMatrix: Stage1ProductionActionMatrix;
  productionInputTemplate: Stage1ProductionInputTemplate;
  productionNonClearingRefresh: Stage1ProductionNonClearingRefresh;
  nextBlockersSummary: Stage1NextBlockersSummary;
  contractAnchors: Stage1ReleaseReadinessContractAnchor[];
  releaseGateSummary: Stage1ReleaseReadinessSummary[];
  nextOperatorActions: string[];
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
