import type {
  AbuseEvent,
  AbuseControlHook,
  AdminRbacEvidence,
  AdminRbacOverrideAttempt,
  AdminReviewDecision,
  AnalyticsReport,
  AgentTrace,
  AuditEvent,
  CrawlerSourceApproval,
  CrawlerStagingRuntimeEvidence,
  CrawlerGovernanceWorkflow,
  CrawlerFinding,
  ExportJob,
  FailedTaskControl,
  FeedbackItem,
  IncidentLog,
  MaintenanceBanner,
  OperationalDashboard,
  OperationalDashboardRuntimeEvidence,
  OperationsIncidentRunbookContract,
  ObservabilityTelemetryRuntimeEvidence,
  ProviderHealth,
  ProductionActivationReviewAuditEvidence,
  ProductionAbuseThrottleHoldEvidence,
  ProductionBackupRollbackIncidentEvidence,
  ProductionBackupRollbackSplitPreflightEvidence,
  ProductionLegalSupportPolicyEvidence,
  ProductionPaidBillingLifecycleEvidence,
  ProductionProviderModeEvidence,
  ProductionSecurityLaunchCheckEvidence,
  ProductionSkillReleaseEvalCanaryEvidence,
  AlertRoute,
  AlertRouteRuntimeEvidence,
  BackendMetricsRuntimeEvidence,
  ReleaseBlocker,
  StagingObjectStorageRetentionCleanupEvidence,
  StagingObservabilityBackupLoadPreflightEvidence,
  StagingEvalQaSafetyEvidence,
  StagingLegalSupportVisibilityEvidence,
  StagingQuotaRateLimitSpendCapEvidence,
  Stage1BatchChildTask,
  Stage1BatchQueueRuntime,
  SupportAdminDeletionGovernanceContract,
  PromptFragment,
  QuotaAccount,
  QueueHealth,
  RegressionFixture,
  ReleaseEvidence,
  RiskyExport,
  Skill,
  SkillCanaryMetric,
  SkillReleaseStateDefinition,
  SkillVersion,
  StagingAuthRbacTenantAuditEvidence,
  StagingSupportRetryAbuseEvidence,
  SupportEscalationRunbook,
  SupportTicket,
  SupportUser
} from "@/lib/types";

export const skills: Skill[] = [
  {
    id: "skill-brand-kit",
    name: "Brand Kit Generator",
    domain: "visual identity",
    activeVersion: "2.4.1",
    owner: "design-systems",
    status: "active",
    risk: "medium",
    updatedAt: "2026-05-24 09:20"
  },
  {
    id: "skill-export-pack",
    name: "Platform Export Packager",
    domain: "export",
    activeVersion: "1.8.0",
    owner: "platform",
    status: "active",
    risk: "low",
    updatedAt: "2026-05-25 11:05"
  },
  {
    id: "skill-claims-review",
    name: "Claims Risk Reviewer",
    domain: "safety",
    activeVersion: "0.9.7",
    owner: "trust",
    status: "active",
    risk: "high",
    updatedAt: "2026-05-25 17:42"
  }
];

export const skillReleaseStateDefinitions: SkillReleaseStateDefinition[] = [
  {
    state: "draft",
    entryCriteria: "Owner has created version metadata, provenance, and rollback target draft.",
    allowedNextStates: ["review", "deprecated"],
    adminAction: "Submit for review or discard the draft.",
    rollbackAllowed: false,
    auditRequirement: "Draft changes are audit-linked once submitted for review."
  },
  {
    state: "review",
    entryCriteria: "Reviewer rationale, diff, provenance, QA samples, and risk labels are visible.",
    allowedNextStates: ["eval_passed", "paused", "deprecated"],
    adminAction: "Approve only after required reviewer and second-review checks pass.",
    rollbackAllowed: false,
    auditRequirement: "Reviewer rationale and evidence refs are required before eval_passed."
  },
  {
    state: "eval_passed",
    entryCriteria: "Required eval suite and regression fixtures pass for the target workflow scope.",
    allowedNextStates: ["internal_canary", "paused"],
    adminAction: "Start internal canary with zero public traffic.",
    rollbackAllowed: true,
    auditRequirement: "Eval result refs and rollback target must be immutable."
  },
  {
    state: "internal_canary",
    entryCriteria: "Internal users only; stop thresholds and alert owner are configured.",
    allowedNextStates: ["allowlist_canary", "paused", "rolled_back"],
    adminAction: "Advance only if canary metrics stay inside thresholds.",
    rollbackAllowed: true,
    auditRequirement: "Canary start, metric window, and rollback target require audit refs."
  },
  {
    state: "allowlist_canary",
    entryCriteria: "Named beta users allowed; support and abuse links are active.",
    allowedNextStates: ["percent_canary", "paused", "rolled_back"],
    adminAction: "Monitor user-facing failure, support, safety, and cost metrics.",
    rollbackAllowed: true,
    auditRequirement: "Allowlist membership and support linkage require audit evidence."
  },
  {
    state: "percent_canary",
    entryCriteria: "Percent rollout has holdout traffic and rollback drill evidence.",
    allowedNextStates: ["active", "paused", "rolled_back"],
    adminAction: "Increase traffic only while all stop thresholds remain healthy.",
    rollbackAllowed: true,
    auditRequirement: "Traffic allocation changes and threshold decisions require audit refs."
  },
  {
    state: "active",
    entryCriteria: "Release gate passed and active routing points at this version.",
    allowedNextStates: ["paused", "rolled_back", "deprecated"],
    adminAction: "Keep release metrics and rollback target visible.",
    rollbackAllowed: true,
    auditRequirement: "Activation and every rollback target change require immutable audit."
  },
  {
    state: "paused",
    entryCriteria: "Canary, support, cost, QA, or safety threshold stopped release traffic.",
    allowedNextStates: ["review", "internal_canary", "rolled_back", "deprecated"],
    adminAction: "Keep traffic at zero until review resolves the stop reason.",
    rollbackAllowed: true,
    auditRequirement: "Pause reason and stop-threshold evidence require audit refs."
  },
  {
    state: "rolled_back",
    entryCriteria: "Traffic has been restored to the rollback target.",
    allowedNextStates: ["review", "deprecated"],
    adminAction: "Verify rollback audit, support notice, and regression fixture conversion.",
    rollbackAllowed: false,
    auditRequirement: "Rollback execution audit and target version evidence are mandatory."
  },
  {
    state: "deprecated",
    entryCriteria: "Version is unavailable for new routing and retained only for audit/history.",
    allowedNextStates: [],
    adminAction: "No activation allowed without a new review version.",
    rollbackAllowed: false,
    auditRequirement: "Deprecation reason and replacement/rollback target must be recorded."
  }
];

export const skillVersions: SkillVersion[] = [
  {
    id: "sv-248",
    skillId: "skill-brand-kit",
    version: "2.5.0",
    status: "review",
    reviewer: "unassigned",
    secondReviewRequired: true,
    secondReviewer: "required-before-canary",
    reviewerRationale: "High-risk brand similarity regression requires explicit rationale before activation.",
    evalSummary: "92.1% pass, two regression fixtures need second reviewer.",
    provenance: "trace tr-1004, feedback fb-203, prompt mutation pm-44",
    rollbackPlan: "Restore 2.4.1 and disable launch campaign palette branch.",
    canaryPercent: 0,
    trafficAllocation: {
      internalPercent: 0,
      allowlistPercent: 0,
      publicPercent: 0,
      holdoutPercent: 100,
      routeEvidence: "No traffic until second reviewer accepts brand similarity regression variance."
    },
    canaryEvidence: "Canary blocked until second reviewer accepts regression fixture variance.",
    releaseEvidence: "Release notes draft linked to eval suite es-stage0-brand and rollback target 2.4.1.",
    rollbackTarget: "skill-brand-kit@2.4.1",
    rollbackAuditRef: "au-005"
  },
  {
    id: "sv-181",
    skillId: "skill-export-pack",
    version: "1.8.1",
    status: "internal_canary",
    reviewer: "ops-admin",
    secondReviewRequired: false,
    secondReviewer: "not-required",
    reviewerRationale: "Low-risk export completeness fix with passing ZIP and QA report fixtures.",
    evalSummary: "ZIP completeness and QA report fixtures passing.",
    provenance: "export failures ex-887 and ex-901",
    rollbackPlan: "Set router to 1.8.0 and replay failed jobs.",
    canaryPercent: 15,
    trafficAllocation: {
      internalPercent: 15,
      allowlistPercent: 0,
      publicPercent: 0,
      holdoutPercent: 85,
      routeEvidence: "Internal-only canary with deterministic 85% holdout still routed to skill-export-pack@1.8.0."
    },
    canaryEvidence: "15% internal canary, 0 blocking QA regressions, p95 packaging under 900 ms.",
    releaseEvidence: "Release evidence includes manifest/QA/provenance fixtures and rollback replay plan.",
    rollbackTarget: "skill-export-pack@1.8.0",
    rollbackAuditRef: "au-003"
  },
  {
    id: "sv-098",
    skillId: "skill-claims-review",
    version: "0.9.8",
    status: "review",
    reviewer: "trust-admin",
    secondReviewRequired: true,
    secondReviewer: "legal-admin",
    reviewerRationale: "Claims policy affects export blocking and needs legal second-review signoff.",
    evalSummary: "Legal and financial claim fixtures passing; medical pending.",
    provenance: "safety rule sr-21, red-team run rt-12",
    rollbackPlan: "Keep 0.9.7 active; invalidate staged policy bundle.",
    canaryPercent: 0,
    trafficAllocation: {
      internalPercent: 0,
      allowlistPercent: 0,
      publicPercent: 0,
      holdoutPercent: 100,
      routeEvidence: "No traffic until medical claim fixture and legal second-review evidence pass."
    },
    canaryEvidence: "Canary disabled until medical claim fixture and legal second-review pass.",
    releaseEvidence: "Production release blocked pending reviewer rationale and policy bundle audit.",
    rollbackTarget: "skill-claims-review@0.9.7",
    rollbackAuditRef: "au-006"
  },
  {
    id: "sv-182",
    skillId: "skill-export-pack",
    version: "1.8.2",
    status: "paused",
    reviewer: "ops-admin",
    secondReviewRequired: false,
    secondReviewer: "not-required",
    reviewerRationale: "Canary paused automatically after export success dropped below the stop threshold.",
    evalSummary: "Eval passed before canary, but live export success breached stop threshold.",
    provenance: "canary metrics cm-011, cm-012, audit au-009",
    rollbackPlan: "Keep active routing on 1.8.0 and convert failed export samples to regression fixtures.",
    canaryPercent: 0,
    trafficAllocation: {
      internalPercent: 0,
      allowlistPercent: 0,
      publicPercent: 0,
      holdoutPercent: 100,
      routeEvidence: "Traffic automatically stopped; all requests route to rollback target skill-export-pack@1.8.0."
    },
    canaryEvidence: "Paused when export success fell to 94.1% against the 97% stop threshold.",
    releaseEvidence: "Release remains blocked until export success and regression fixture pass rate recover.",
    rollbackTarget: "skill-export-pack@1.8.0",
    rollbackAuditRef: "au-009"
  },
  {
    id: "sv-240",
    skillId: "skill-brand-kit",
    version: "2.4.0",
    status: "rolled_back",
    reviewer: "design-systems-admin",
    secondReviewRequired: true,
    secondReviewer: "trust-admin",
    reviewerRationale: "Rolled back after brand/IP bad-sample cluster exceeded the stop threshold.",
    evalSummary: "Superseded by 2.4.1 after regression fixture fix.",
    provenance: "feedback fb-203, canary metric cm-018, audit au-010",
    rollbackPlan: "Traffic restored to 2.4.1 and 2.4.0 kept for audit only.",
    canaryPercent: 0,
    trafficAllocation: {
      internalPercent: 0,
      allowlistPercent: 0,
      publicPercent: 0,
      holdoutPercent: 100,
      routeEvidence: "No traffic; router points to active rollback target skill-brand-kit@2.4.1."
    },
    canaryEvidence: "Canary stopped after admin bad-sample threshold breach.",
    releaseEvidence: "Rolled-back version is retained for audit and cannot be reactivated without a new review.",
    rollbackTarget: "skill-brand-kit@2.4.1",
    rollbackAuditRef: "au-010"
  }
];

export const skillCanaryMetrics: SkillCanaryMetric[] = [
  {
    id: "cm-001",
    skillVersionId: "sv-181",
    metric: "task_success",
    window: "2026-05-26 08:00 to 09:00",
    value: "99.2%",
    target: ">= 98%",
    sampleSize: 126,
    status: "healthy",
    stopThreshold: "< 96% for 30 minutes",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-002",
    skillVersionId: "sv-181",
    metric: "provider_failure",
    window: "2026-05-26 08:00 to 09:00",
    value: "0.6%",
    target: "<= 1%",
    sampleSize: 126,
    status: "healthy",
    stopThreshold: "> 2% provider failures",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-003",
    skillVersionId: "sv-181",
    metric: "cost_per_package",
    window: "2026-05-26 08:00 to 09:00",
    value: "$0.18",
    target: "<= $0.25",
    sampleSize: 94,
    status: "healthy",
    stopThreshold: "> $0.35 for 20 packages",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-004",
    skillVersionId: "sv-181",
    metric: "selection_rate",
    window: "2026-05-26 08:00 to 09:00",
    value: "62.4%",
    target: ">= 55%",
    sampleSize: 88,
    status: "healthy",
    stopThreshold: "< 45% with 50+ selections",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-005",
    skillVersionId: "sv-181",
    metric: "iteration_rate",
    window: "2026-05-26 08:00 to 09:00",
    value: "34.8%",
    target: "25% to 55%",
    sampleSize: 72,
    status: "healthy",
    stopThreshold: "< 15% or > 70%",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-006",
    skillVersionId: "sv-181",
    metric: "package_add_rate",
    window: "2026-05-26 08:00 to 09:00",
    value: "74.1%",
    target: ">= 70%",
    sampleSize: 72,
    status: "healthy",
    stopThreshold: "< 60% with 50+ sessions",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-007",
    skillVersionId: "sv-181",
    metric: "export_success",
    window: "2026-05-26 08:00 to 09:00",
    value: "98.7%",
    target: ">= 98%",
    sampleSize: 64,
    status: "healthy",
    stopThreshold: "< 97% export success",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-008",
    skillVersionId: "sv-181",
    metric: "qa_warning_blocking",
    window: "2026-05-26 08:00 to 09:00",
    value: "4 warning / 0 blocking",
    target: "0 blocking",
    sampleSize: 64,
    status: "healthy",
    stopThreshold: ">= 1 blocking QA regression",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-009",
    skillVersionId: "sv-181",
    metric: "safety_block",
    window: "2026-05-26 08:00 to 09:00",
    value: "0",
    target: "0 new safety regressions",
    sampleSize: 64,
    status: "healthy",
    stopThreshold: ">= 1 critical safety regression",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-010",
    skillVersionId: "sv-181",
    metric: "user_rating",
    window: "2026-05-26 08:00 to 09:00",
    value: "4.6/5",
    target: ">= 4.2/5",
    sampleSize: 31,
    status: "healthy",
    stopThreshold: "< 3.8/5 with 25+ ratings",
    stopAction: "continue",
    criticalSafetyRegression: false,
    auditRef: "au-003"
  },
  {
    id: "cm-011",
    skillVersionId: "sv-182",
    metric: "export_success",
    window: "2026-05-26 09:00 to 09:30",
    value: "94.1%",
    target: ">= 98%",
    sampleSize: 68,
    status: "stop",
    stopThreshold: "< 97% export success",
    stopAction: "pause_release",
    criticalSafetyRegression: false,
    auditRef: "au-009"
  },
  {
    id: "cm-012",
    skillVersionId: "sv-182",
    metric: "regression_fixture_pass_rate",
    window: "2026-05-26 09:00 to 09:30",
    value: "91.6%",
    target: "100%",
    sampleSize: 24,
    status: "stop",
    stopThreshold: "< 100% on required regression fixtures",
    stopAction: "pause_release",
    criticalSafetyRegression: false,
    auditRef: "au-009"
  },
  {
    id: "cm-013",
    skillVersionId: "sv-098",
    metric: "safety_block",
    window: "pre-canary red-team run rt-12",
    value: "1 medical-claims miss",
    target: "0 critical safety regressions",
    sampleSize: 18,
    status: "stop",
    stopThreshold: ">= 1 critical safety regression",
    stopAction: "pause_release",
    criticalSafetyRegression: true,
    auditRef: "au-006"
  },
  {
    id: "cm-014",
    skillVersionId: "sv-240",
    metric: "admin_bad_sample",
    window: "2026-05-24 canary",
    value: "3 bad samples",
    target: "0 high-risk bad samples",
    sampleSize: 40,
    status: "stop",
    stopThreshold: ">= 1 high-risk admin bad-sample cluster",
    stopAction: "rollback",
    criticalSafetyRegression: true,
    auditRef: "au-010"
  }
];

export const adminReviewDecisions: AdminReviewDecision[] = [
  {
    id: "rv-100",
    surface: "skill_release",
    target: "skill-brand-kit@2.5.0",
    status: "second_review_required",
    risk: "high",
    reviewer: "unassigned",
    secondReviewer: "required-before-canary",
    secondReviewRequired: true,
    rationale: "Brand similarity and campaign claim changes cannot enter canary without a second reviewer.",
    diffSummary: "Palette branch and launch-copy prompt mutation change candidate selection behavior.",
    provenance: "trace tr-1004, feedback fb-203, prompt mutation pm-44",
    evalSummary: "92.1% pass; two regression fixtures flagged as high-risk variance.",
    qaSummary: "QA warning on competitor similarity remains unresolved.",
    evidenceRefs: ["fixtures/stage0/rev2/eval/starter_eval_suite.json", "tr-1004", "au-001"],
    createdAt: "2026-05-26 09:05"
  },
  {
    id: "rv-101",
    surface: "provider_routing",
    target: "OpenAI/image-render-dev",
    status: "pending",
    risk: "medium",
    reviewer: "ops-admin",
    secondReviewer: "not-required",
    secondReviewRequired: false,
    rationale: "Degraded latency requires reduced non-urgent retries while QA provider remains active.",
    diffSummary: "Routing weight lowered for non-urgent image retries; no fallback to weaker safety provider.",
    provenance: "provider health ph-1, queue q-brief, trace tr-1004",
    evalSummary: "Provider contract smoke passed for request/response provenance fields.",
    qaSummary: "QA enforcement unchanged through internal qa-policy provider.",
    evidenceRefs: ["ph-1", "tr-1004", "queues/q-brief"],
    createdAt: "2026-05-26 09:20"
  },
  {
    id: "rv-102",
    surface: "export_override",
    target: "ex-887",
    status: "blocked",
    risk: "high",
    reviewer: "trust-admin",
    secondReviewer: "not-eligible",
    secondReviewRequired: false,
    rationale: "Blocking forbidden-claim QA result is not override eligible.",
    diffSummary: "Export package regeneration would preserve the same forbidden claim.",
    provenance: "safety rule forbidden-claims:v3, trace tr-1004",
    evalSummary: "Export enforcement fixture blocks final package.",
    qaSummary: "Blocking severity at export enforcement point.",
    evidenceRefs: ["rx-41", "ex-887", "au-001"],
    createdAt: "2026-05-25 16:16"
  }
];

export const adminRbacEvidence: AdminRbacEvidence[] = [
  {
    id: "rbac-release-001",
    surface: "skill_release",
    overrideScope: "release",
    overrideDurationPolicy: "second_review_deadline",
    expiryEnforced: true,
    target: "skill-brand-kit@2.5.0",
    requestedAction: "promote skill-brand-kit@2.5.0 into percent canary after rollback",
    enforcementPoint: "release_gate",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_reviewer",
    decision: "second_review_required",
    secondReviewRequired: true,
    secondReviewStatus: "required",
    releaseGateImpact: "Skill release and production launch gates remain blocked until reviewer approval and second-review evidence are complete.",
    userVisibleOutcome: "Users remain on the previous active skill version while canary traffic stays paused.",
    apiScope: "PATCH /api/admin/skills/skill-brand-kit/releases/2.5.0/canary",
    mutationOutcome: "queued_for_review",
    overrideStartedAt: "2026-05-26 09:40",
    overrideExpiresAt: "2026-05-26 18:00",
    preOverrideState: "skill-brand-kit@2.4.1 remains active with skill-brand-kit@2.5.0 traffic allocation fixed at zero public traffic.",
    expiryAction: "At the second-review deadline, keep the release in review, preserve the rollback target, and require a fresh reviewer request before canary traffic can resume.",
    staleOverrideProbe: "release_gate stale-deadline probe denies canary promotion after 2026-05-26 18:00 unless a new second-review audit replaces au-005.",
    runtimeCheck: "release_gate queues canary promotion while secondReviewStatus is required even though the attempted admin_reviewer role is sufficient for review intake.",
    postDecisionControl: "Keep trafficAllocation at 0% public, retain rollback target skill-brand-kit@2.4.1, and require au-005 before any canary resume.",
    rationale: "High-risk skill release cannot enter canary from reviewer intake alone; second-review evidence is required before release traffic changes.",
    auditRef: "au-005",
    evidenceRefs: ["rv-100", "sv-248", "eg-001", "au-005"],
    releaseEvidenceRequired: ["reviewer rationale", "second reviewer", "eval pass", "rollback target", "immutable audit"]
  },
  {
    id: "rbac-crawler-001",
    surface: "crawler_import",
    overrideScope: "crawler",
    overrideDurationPolicy: "second_review_deadline",
    expiryEnforced: true,
    target: "cf-118",
    requestedAction: "reactivate crawler-derived source after takedown and derivative review",
    enforcementPoint: "crawler_activation",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_operator",
    decision: "denied",
    secondReviewRequired: true,
    secondReviewStatus: "required",
    releaseGateImpact: "Crawler-derived prompt and skill activation stay blocked while takedown, derivative-use, and retention evidence remain unresolved.",
    userVisibleOutcome: "No crawler-derived material from the disputed source appears in user workflows or generated packages.",
    apiScope: "POST /api/admin/crawler/findings/cf-118/reactivate",
    mutationOutcome: "blocked_no_mutation",
    overrideStartedAt: "2026-05-26 08:30",
    overrideExpiresAt: "2026-05-26 16:00",
    preOverrideState: "cf-118 remains blocked, crawler-source cs-21 has zero import throughput, and derivative material stays unavailable for prompt or skill activation.",
    expiryAction: "After the reviewer deadline, keep source reactivation blocked and require a fresh takedown closure plus derivative deletion audit before any retention mutation.",
    staleOverrideProbe: "crawler_activation stale-deadline probe denies reactivation after 2026-05-26 16:00 while cg-501 is still open.",
    runtimeCheck: "crawler_activation gate denies source reactivation until cg-501 closes with derivative-use, takedown, and raw-retention evidence.",
    postDecisionControl: "Leave cf-118 blocked, keep active prompt and skill import disabled, and require au-012 plus reviewer closure before retention changes.",
    rationale: "Crawler takedown and derivative material deletion must be reviewed by an admin reviewer before activation or retention changes.",
    auditRef: "au-012",
    evidenceRefs: ["cg-501", "cf-118", "ip-7001", "pending-raw-derivative-delete-cs-21", "pending-rights-owner-notice-ip-7001", "au-012"],
    releaseEvidenceRequired: ["takedown closure", "derivative-use review", "raw retention action", "source contact notice", "immutable audit", "fresh second-review before expired deadline"]
  },
  {
    id: "rbac-prompt-001",
    surface: "prompt_approval",
    overrideScope: "prompt",
    overrideDurationPolicy: "non_expiring_policy_block",
    expiryEnforced: false,
    target: "pf-044",
    requestedAction: "activate prompt fragment from support-attached feedback",
    enforcementPoint: "prompt_activation",
    requiredRole: "admin_reviewer",
    attemptedRole: "support_operator",
    decision: "denied",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    releaseGateImpact:
      "Prompt activation and production activation-review gates remain blocked until reviewer-owned eval, QA, feedback attribution, and immutable audit evidence prove the support-attached prompt fragment can safely become active.",
    userVisibleOutcome: "Existing prompt routing stays unchanged and the suspect feedback is excluded from learning paths.",
    apiScope: "POST /api/admin/prompt-fragments/pf-044/activate",
    mutationOutcome: "blocked_no_mutation",
    overrideStartedAt: "none",
    overrideExpiresAt: "none",
    preOverrideState: "pf-044 remains in review and the active prompt fragment routing continues to use the previous approved version.",
    expiryAction: "No expiry action applies because support-origin prompt activation is a standing policy block until reviewer-owned eval and QA evidence exists.",
    staleOverrideProbe: "prompt_activation policy-block probe rejects repeated support_operator activation attempts without opening a temporary override window.",
    runtimeCheck: "prompt_activation gate rejects support_operator attempts and requires reviewer-owned eval, QA, and audit refs before pf-044 can become active.",
    postDecisionControl: "Keep pf-044 in review, leave feedback fb-222 out of learning weights, and require a new reviewer audit before activation.",
    rationale: "Support operators can attach feedback but cannot approve prompt fragments into active routing without reviewer permission.",
    auditRef: "au-008",
    evidenceRefs: ["pf-044", "fb-222", "prompt-fragments", "au-008"],
    releaseEvidenceRequired: ["reviewer-owned eval", "QA evidence", "feedback attribution", "immutable audit"]
  },
  {
    id: "rbac-provider-001",
    surface: "provider_routing",
    overrideScope: "provider",
    overrideDurationPolicy: "temporary_required",
    expiryEnforced: true,
    target: "OpenAI/image-render-dev",
    requestedAction: "reduce non-urgent image retry routing weight during provider degradation",
    enforcementPoint: "provider_router",
    requiredRole: "admin_operator",
    attemptedRole: "admin_operator",
    decision: "allowed",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    releaseGateImpact: "Provider launch gate remains blocked by degraded health even though the safety-preserving traffic reduction is allowed.",
    userVisibleOutcome: "Non-urgent retry latency may improve while QA and safety enforcement continue to run on the existing provider path.",
    apiScope: "PATCH /api/admin/providers/OpenAI/image-render-dev/routing-weight",
    mutationOutcome: "applied",
    overrideStartedAt: "2026-05-26 09:45",
    overrideExpiresAt: "2026-05-26 12:00",
    preOverrideState: "Provider routing used the normal retry weight with QA and safety enforcement on the existing OpenAI/image-render-dev path.",
    expiryAction: "At 2026-05-26 12:00 automatically restore the previous retry weight, keep degraded provider blocker eg-003 open, and require fresh provider health evidence for any extension.",
    staleOverrideProbe: "provider_router expiry probe restores the previous retry weight and denies stale routing extensions after the override window closes.",
    runtimeCheck: "provider_router permits only non-urgent retry-weight reduction because safety fallback, provider contract, and usage reconciliation remain unchanged.",
    postDecisionControl: "Preserve degraded provider launch blocker eg-003, keep no silent fallback enabled, and require au-007 for any routing weight diff.",
    rationale: "Provider retry-weight reduction is allowed for an admin operator because safety fallback remains unchanged and evidence is audit-linked.",
    auditRef: "au-007",
    evidenceRefs: ["rv-101", "ph-1", "eg-003", "au-007"],
    releaseEvidenceRequired: ["provider health snapshot", "usage reconciliation", "no silent fallback", "expiry timestamp", "immutable audit"]
  },
  {
    id: "rbac-provider-002",
    surface: "provider_routing",
    overrideScope: "provider",
    overrideDurationPolicy: "temporary_required",
    expiryEnforced: true,
    target: "OpenAI/image-render-dev",
    requestedAction: "extend emergency provider retry routing reduction after the temporary override window closed",
    enforcementPoint: "provider_router",
    requiredRole: "admin_operator",
    attemptedRole: "admin_operator",
    decision: "allowed",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    releaseGateImpact: "Provider routing remains constrained by the degraded-health release blocker because the prior emergency retry override has expired and cannot silently persist.",
    userVisibleOutcome: "Users stay on the audited provider routing state; no stale retry reduction continues after the operator-approved window closes.",
    apiScope: "PATCH /api/admin/providers/OpenAI/image-render-dev/routing-weight",
    mutationOutcome: "applied",
    overrideStartedAt: "2026-05-26 09:15",
    overrideExpiresAt: "2026-05-26 10:30",
    preOverrideState: "The last audited provider routing state before expiry is preserved with no hidden retry-weight extension.",
    expiryAction: "Block the stale extension request, restore the pre-override routing weight, and require a new audit-linked provider health snapshot before mutation.",
    staleOverrideProbe: "provider_router stale override probe at 2026-05-26 11:00 denies the expired emergency routing reduction while keeping eg-003 open.",
    runtimeCheck: "provider_router denies stale extension after overrideExpiresAt even when the attempted admin_operator role is sufficient for the original temporary routing mutation.",
    postDecisionControl: "Preserve the last audited provider routing weight, keep degraded provider blocker eg-003 open, and require a fresh au-007-linked operator action before any new routing diff.",
    rationale: "Provider routing overrides are time boxed; a sufficient operator role cannot keep an expired emergency retry-weight change active without a fresh audit-linked request.",
    auditRef: "au-007",
    evidenceRefs: ["rv-101", "ph-1", "eg-003", "au-007"],
    releaseEvidenceRequired: ["fresh provider health snapshot", "fresh operator action", "usage reconciliation", "expiry timestamp", "immutable audit"]
  },
  {
    id: "rbac-quota-001",
    surface: "quota_override",
    overrideScope: "quota",
    overrideDurationPolicy: "non_expiring_policy_block",
    expiryEnforced: false,
    target: "usr-301",
    requestedAction: "mutate quota balance directly from support ticket context",
    enforcementPoint: "quota_mutation",
    requiredRole: "admin_operator",
    attemptedRole: "support_operator",
    decision: "denied",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    releaseGateImpact: "Quota override gate stays blocked for support-only mutation attempts until operator-owned transaction evidence exists.",
    userVisibleOutcome: "The user sees the support ticket update, but the quota balance is not changed by the denied action.",
    apiScope: "POST /api/admin/quota/usr-301/transactions",
    mutationOutcome: "blocked_no_mutation",
    overrideStartedAt: "none",
    overrideExpiresAt: "none",
    preOverrideState: "usr-301 quota balance and qt-904 remain unchanged until an admin_operator submits an audited transaction.",
    expiryAction: "No expiry action applies because support-only direct quota mutation is a standing policy block.",
    staleOverrideProbe: "quota_mutation policy-block probe rejects repeated support_operator balance changes and never creates a quota transaction.",
    runtimeCheck: "quota_mutation rejects support_operator direct balance changes and requires an admin_operator transaction with support-ticket and export evidence.",
    postDecisionControl: "Do not alter usr-301 balance, keep qt-904 pending operator review, and require au-004 before any credit or debit posts.",
    rationale: "Support can request quota credit, but direct quota mutation requires admin operator permission and immutable support-ticket evidence.",
    auditRef: "au-004",
    evidenceRefs: ["sup-2201", "qt-904", "ex-887", "au-004"],
    releaseEvidenceRequired: ["support ticket", "quota transaction", "export evidence", "operator audit"]
  },
  {
    id: "rbac-safety-001",
    surface: "safety_rule",
    overrideScope: "safety",
    overrideDurationPolicy: "second_review_deadline",
    expiryEnforced: true,
    target: "forbidden-claims:v3",
    requestedAction: "relax blocking forbidden-claims safety rule for export review",
    enforcementPoint: "safety_policy",
    requiredRole: "admin_superadmin",
    attemptedRole: "admin_reviewer",
    decision: "second_review_required",
    secondReviewRequired: true,
    secondReviewStatus: "blocked",
    releaseGateImpact: "Safety and production launch gates remain blocked because superadmin approval and second review are incomplete.",
    userVisibleOutcome: "Forbidden-claim exports stay blocked and users receive the existing safety review message.",
    apiScope: "PATCH /api/admin/safety/rules/forbidden-claims:v3",
    mutationOutcome: "queued_for_review",
    overrideStartedAt: "2026-05-26 09:05",
    overrideExpiresAt: "2026-05-26 14:00",
    preOverrideState: "forbidden-claims:v3 remains blocking at export and sv-098 stays in review with no relaxed safety rule active.",
    expiryAction: "After the second-review deadline, keep the safety rule blocking, preserve export rx-41, and require a superadmin plus fresh second-review audit.",
    staleOverrideProbe: "safety_policy stale-deadline probe denies relaxation after 2026-05-26 14:00 while secondReviewStatus remains blocked.",
    runtimeCheck: "safety_policy refuses forbidden-claims relaxation while attemptedRole is admin_reviewer and secondReviewStatus is blocked.",
    postDecisionControl: "Keep rx-41 blocking at export, preserve sv-098 review state, and require superadmin plus second-review audit before policy activation.",
    rationale: "Blocking safety policy changes affect export eligibility and need superadmin ownership plus completed second review before activation.",
    auditRef: "au-006",
    evidenceRefs: ["rx-41", "sv-098", "eg-002", "au-006"],
    releaseEvidenceRequired: ["superadmin approval", "second review", "safety fixture pass", "export gate proof", "immutable audit"]
  },
  {
    id: "rbac-export-001",
    surface: "export_override",
    overrideScope: "export",
    overrideDurationPolicy: "non_expiring_policy_block",
    expiryEnforced: false,
    target: "ex-887",
    requestedAction: "override blocking final export QA result for package release",
    enforcementPoint: "export_release",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_reviewer",
    decision: "denied",
    secondReviewRequired: false,
    secondReviewStatus: "blocked",
    releaseGateImpact: "Export release remains blocked because a reviewer role cannot override non-eligible blocking QA evidence.",
    userVisibleOutcome: "The affected export remains unavailable and support can only proceed with audited quota credit or safe regeneration.",
    apiScope: "POST /api/admin/exports/ex-887/override-release",
    mutationOutcome: "blocked_no_mutation",
    overrideStartedAt: "none",
    overrideExpiresAt: "none",
    preOverrideState: "ex-887 remains unavailable because blocking forbidden-claim QA evidence is preserved at the final export release gate.",
    expiryAction: "No expiry action applies because non-eligible blocking QA failures cannot be converted into temporary export overrides.",
    staleOverrideProbe: "export_release policy-block probe rejects repeated override attempts and routes operators to regeneration or quota-credit workflows.",
    runtimeCheck: "export_release denies override for ex-887 because blocking forbidden-claim QA is not override eligible even with admin_reviewer role.",
    postDecisionControl: "Keep ex-887 unavailable, allow only audited quota credit or safe regeneration paths, and preserve tr-1004 QA evidence for review.",
    rationale: "Reviewer role is present, but blocking forbidden-claim export overrides are never eligible; the RBAC result remains denied.",
    auditRef: "au-001",
    evidenceRefs: ["rv-102", "rx-41", "tr-1004", "au-001"],
    releaseEvidenceRequired: ["QA result", "safety decision", "trace provenance", "non-override eligibility proof", "immutable audit"]
  }
];

export const adminRbacOverrideAttempts: AdminRbacOverrideAttempt[] = [
  {
    id: "rbac-attempt-release-001",
    evidenceId: "rbac-release-001",
    surface: "skill_release",
    overrideScope: "release",
    requestId: "admin-rbac-override-20260526T1900Z-release-001",
    idempotencyKey: "rbac:skill_release:rbac-release-001:promote-canary:au-005",
    apiScope: "PATCH /api/admin/skills/skill-brand-kit/releases/2.5.0/canary",
    requestBodyDigest: "sha256:release-canary-promote-zero-public-au005",
    preMutationStateDigest: "sha256:skill-brand-kit-241-active-250-zero-public",
    postMutationStateDigest: "sha256:skill-brand-kit-241-active-250-zero-public",
    csrfScope: "admin_session_cookie",
    dryRunOnly: true,
    expectedHttpStatus: 202,
    gatePreservation: "Canary promotion is queued for second review, public traffic remains at zero, and the release gate stays blocked until a fresh reviewer audit replaces au-005.",
    mutationReplayPolicy: "A replay with the same idempotency key returns the queued review record and must not change traffic allocation or rollback target.",
    auditRef: "au-005",
    evidenceRefs: ["rbac-release-001", "rv-100", "sv-248", "eg-001", "au-005"],
    operatorMessage: "Queued for second review; keep skill-brand-kit@2.4.1 active and attach completed second-review evidence before retry."
  },
  {
    id: "rbac-attempt-crawler-001",
    evidenceId: "rbac-crawler-001",
    surface: "crawler_import",
    overrideScope: "crawler",
    requestId: "admin-rbac-override-20260526T1900Z-crawler-001",
    idempotencyKey: "rbac:crawler_import:rbac-crawler-001:reactivate:au-012",
    apiScope: "POST /api/admin/crawler/findings/cf-118/reactivate",
    requestBodyDigest: "sha256:crawler-cf118-reactivate-without-derivative-delete",
    preMutationStateDigest: "sha256:cf-118-blocked-cg-501-open-csa-021-blocked",
    postMutationStateDigest: "sha256:cf-118-blocked-cg-501-open-csa-021-blocked",
    csrfScope: "admin_session_cookie",
    dryRunOnly: true,
    expectedHttpStatus: 403,
    gatePreservation: "Crawler activation stays blocked while takedown, derivative deletion, source notice, and second-review evidence remain unresolved.",
    mutationReplayPolicy: "Every replay must return the same denied mutation result and preserve the source approval block until cg-501 closes.",
    auditRef: "au-012",
    evidenceRefs: ["rbac-crawler-001", "cg-501", "cf-118", "csa-021", "au-012"],
    operatorMessage: "Denied by role and second-review gate; complete derivative deletion and rights-owner notice before requesting reactivation."
  },
  {
    id: "rbac-attempt-prompt-001",
    evidenceId: "rbac-prompt-001",
    surface: "prompt_approval",
    overrideScope: "prompt",
    requestId: "admin-rbac-override-20260526T1900Z-prompt-001",
    idempotencyKey: "rbac:prompt_approval:rbac-prompt-001:activate:au-008",
    apiScope: "POST /api/admin/prompt-fragments/pf-044/activate",
    requestBodyDigest: "sha256:prompt-pf044-support-origin-activation",
    preMutationStateDigest: "sha256:pf-044-review-feedback-fb222-zero-learning-weight",
    postMutationStateDigest: "sha256:pf-044-review-feedback-fb222-zero-learning-weight",
    csrfScope: "admin_session_cookie",
    dryRunOnly: true,
    expectedHttpStatus: 403,
    gatePreservation: "Support-origin prompt activation remains policy blocked, feedback stays excluded from learning, and prompt activation gate remains closed.",
    mutationReplayPolicy: "Repeated support_operator activation attempts are collapsed by idempotency and cannot open a temporary override window.",
    auditRef: "au-008",
    evidenceRefs: ["rbac-prompt-001", "pf-044", "fb-222", "au-008"],
    operatorMessage: "Denied by policy; route to reviewer-owned eval, QA, feedback attribution, and immutable audit before activation."
  },
  {
    id: "rbac-attempt-provider-001",
    evidenceId: "rbac-provider-001",
    surface: "provider_routing",
    overrideScope: "provider",
    requestId: "admin-rbac-override-20260526T1000Z-provider-001",
    idempotencyKey: "rbac:provider_routing:rbac-provider-001:retry-weight:au-007",
    apiScope: "PATCH /api/admin/providers/OpenAI/image-render-dev/routing-weight",
    requestBodyDigest: "sha256:provider-retry-weight-reduce-nonurgent",
    preMutationStateDigest: "sha256:provider-openai-image-render-dev-normal-retry-weight",
    postMutationStateDigest: "sha256:provider-openai-image-render-dev-reduced-nonurgent-weight",
    csrfScope: "admin_session_cookie",
    dryRunOnly: false,
    expectedHttpStatus: 200,
    gatePreservation: "Only non-urgent retry weight changes; provider degraded-health release blocker and no-silent-fallback policy remain active.",
    mutationReplayPolicy: "Replay returns the applied override record without extending the expiry timestamp or weakening safety/provider fallback policy.",
    auditRef: "au-007",
    evidenceRefs: ["rbac-provider-001", "rv-101", "ph-1", "eg-003", "au-007"],
    operatorMessage: "Applied inside the audited temporary window; monitor expiry restoration and keep degraded provider blocker visible."
  },
  {
    id: "rbac-attempt-provider-002",
    evidenceId: "rbac-provider-002",
    surface: "provider_routing",
    overrideScope: "provider",
    requestId: "admin-rbac-override-20260526T1900Z-provider-002",
    idempotencyKey: "rbac:provider_routing:rbac-provider-002:retry-weight-extension:au-007",
    apiScope: "PATCH /api/admin/providers/OpenAI/image-render-dev/routing-weight",
    requestBodyDigest: "sha256:provider-retry-weight-expired-extension",
    preMutationStateDigest: "sha256:provider-openai-image-render-dev-restored-after-expiry",
    postMutationStateDigest: "sha256:provider-openai-image-render-dev-restored-after-expiry",
    csrfScope: "admin_session_cookie",
    dryRunOnly: true,
    expectedHttpStatus: 410,
    gatePreservation: "Expired provider routing override is rejected, previous routing weight is preserved, and provider launch remains blocked until fresh health evidence exists.",
    mutationReplayPolicy: "A stale replay after overrideExpiresAt must remain denied even with sufficient admin_operator role.",
    auditRef: "au-007",
    evidenceRefs: ["rbac-provider-002", "rv-101", "ph-1", "eg-003", "au-007"],
    operatorMessage: "Expired override blocked; submit a fresh provider health snapshot and audited operator request before any extension."
  },
  {
    id: "rbac-attempt-quota-001",
    evidenceId: "rbac-quota-001",
    surface: "quota_override",
    overrideScope: "quota",
    requestId: "admin-rbac-override-20260526T1900Z-quota-001",
    idempotencyKey: "rbac:quota_override:rbac-quota-001:direct-mutation:au-004",
    apiScope: "POST /api/admin/quota/usr-301/transactions",
    requestBodyDigest: "sha256:quota-usr301-support-direct-credit",
    preMutationStateDigest: "sha256:usr-301-quota-qt904-pending-operator-review",
    postMutationStateDigest: "sha256:usr-301-quota-qt904-pending-operator-review",
    csrfScope: "admin_session_cookie",
    dryRunOnly: true,
    expectedHttpStatus: 403,
    gatePreservation: "Support-origin quota mutation is blocked, no quota transaction posts, and the support ticket remains routed to admin_operator review.",
    mutationReplayPolicy: "Repeated support attempts return the denied idempotent record and cannot debit or credit balance.",
    auditRef: "au-004",
    evidenceRefs: ["rbac-quota-001", "sup-2201", "qt-904", "ex-887", "au-004"],
    operatorMessage: "Denied by role boundary; create an admin_operator-owned transaction with support, export, and audit evidence."
  },
  {
    id: "rbac-attempt-safety-001",
    evidenceId: "rbac-safety-001",
    surface: "safety_rule",
    overrideScope: "safety",
    requestId: "admin-rbac-override-20260526T1900Z-safety-001",
    idempotencyKey: "rbac:safety_rule:rbac-safety-001:relax-forbidden-claims:au-006",
    apiScope: "PATCH /api/admin/safety/rules/forbidden-claims:v3",
    requestBodyDigest: "sha256:safety-forbidden-claims-relax-admin-reviewer",
    preMutationStateDigest: "sha256:forbidden-claims-v3-blocking-sv098-review",
    postMutationStateDigest: "sha256:forbidden-claims-v3-blocking-sv098-review",
    csrfScope: "admin_session_cookie",
    dryRunOnly: true,
    expectedHttpStatus: 423,
    gatePreservation: "Safety rule remains blocking because superadmin and second-review evidence are absent; provider requests and final exports stay blocked.",
    mutationReplayPolicy: "Replay preserves the block and cannot downgrade forbidden-claims:v3 or create a provider task.",
    auditRef: "au-006",
    evidenceRefs: ["rbac-safety-001", "rx-41", "sv-098", "eg-002", "au-006"],
    operatorMessage: "Blocked by superadmin and second-review requirements; keep forbidden-claims:v3 active until safety fixtures pass."
  },
  {
    id: "rbac-attempt-export-001",
    evidenceId: "rbac-export-001",
    surface: "export_override",
    overrideScope: "export",
    requestId: "admin-rbac-override-20260526T1900Z-export-001",
    idempotencyKey: "rbac:export_override:rbac-export-001:override-release:au-001",
    apiScope: "POST /api/admin/exports/ex-887/override-release",
    requestBodyDigest: "sha256:export-ex887-blocking-qa-override",
    preMutationStateDigest: "sha256:ex-887-unavailable-forbidden-claim-qa-block",
    postMutationStateDigest: "sha256:ex-887-unavailable-forbidden-claim-qa-block",
    csrfScope: "admin_session_cookie",
    dryRunOnly: true,
    expectedHttpStatus: 409,
    gatePreservation: "Blocking forbidden-claim QA remains non-override eligible, export stays unavailable, and support can only use safe regeneration or quota-credit paths.",
    mutationReplayPolicy: "Repeated export override attempts are idempotently denied with the same immutable audit result and cannot release the export package while blocking QA evidence remains attached.",
    auditRef: "au-001",
    evidenceRefs: ["rbac-export-001", "rv-102", "rx-41", "tr-1004", "au-001"],
    operatorMessage: "Denied by final export gate; use audited regeneration or quota credit instead of overriding blocking QA."
  }
];

export const crawlerFindings: CrawlerFinding[] = [
  {
    id: "cf-104",
    source: "public design guideline RSS",
    type: "source",
    status: "pending",
    provenance: "crawler-source cs-18",
    riskLabels: ["license-review", "robots-checked"]
  },
  {
    id: "cf-118",
    source: "brand asset pattern collection",
    type: "finding",
    status: "blocked",
    provenance: "crawler-source cs-21",
    riskLabels: ["exact-text", "manual-delete"]
  },
  {
    id: "cf-122",
    source: "platform safe-area documentation",
    type: "finding",
    status: "approved",
    provenance: "crawler-source cs-19",
    riskLabels: ["derivative-ok", "source-linked"]
  }
];

export const crawlerSourceApprovals: CrawlerSourceApproval[] = [
  {
    id: "csa-018",
    sourceId: "crawler-source cs-18",
    sourceName: "public design guideline RSS",
    linkedFindingId: "cf-104",
    status: "pending",
    requester: "crawler-ops",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_operator",
    rbacDecision: "second_review_required",
    legalMetadataStatus: "incomplete",
    robotsEvidence: "robots snapshot recorded at 2026-05-26 10:44; crawl delay is present but source contact and derivative grant are still missing.",
    allowedContent: "Metadata-only review is allowed while raw documents stay out of activation paths.",
    derivativeUsePolicy: "Derivative use is blocked until legal metadata and reviewer approval are complete.",
    exactTextPolicy: "Exact text import is forbidden; any exact-text finding must become a blocked crawler finding before prompt or skill activation.",
    rawRetentionDays: 3,
    rateLimitPolicy: "One fetch per source per 24 hours during pending review; no active import while approval is incomplete.",
    activationGate: "blocked",
    requiredEvidenceRefs: ["cf-104", "cg-533", "au-014"],
    reviewerRationale:
      "Operator request lacks complete legal contact and derivative-use evidence, so source approval requires reviewer signoff and activation remains blocked.",
    auditRef: "au-014"
  },
  {
    id: "csa-019",
    sourceId: "crawler-source cs-19",
    sourceName: "platform safe-area documentation",
    linkedFindingId: "cf-122",
    status: "approved",
    requester: "legal_fixture_reviewer",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_reviewer",
    rbacDecision: "allowed",
    legalMetadataStatus: "complete",
    robotsEvidence: "robots snapshot and source metadata permit the documented private-beta fixture crawl scope.",
    allowedContent: "Only safe-area metadata, transform notes, and source-linked derivative summaries are allowed into fixtures.",
    derivativeUsePolicy: "Derivative summaries are allowed with provenance links, retention limits, and no exact source text in active prompts.",
    exactTextPolicy: "Exact text is stripped before import and any violation routes to crawler takedown workflow.",
    rawRetentionDays: 14,
    rateLimitPolicy: "At most one fixture refresh per day with manual reviewer approval before promotion.",
    activationGate: "allowed",
    requiredEvidenceRefs: ["cf-122", "cg-522", "au-013"],
    reviewerRationale:
      "Reviewer approval is allowed because legal metadata, robots evidence, derivative-use policy, retention limit, and provenance refs are complete.",
    auditRef: "au-013"
  },
  {
    id: "csa-021",
    sourceId: "crawler-source cs-21",
    sourceName: "brand asset pattern collection",
    linkedFindingId: "cf-118",
    status: "blocked",
    requester: "rights-owner@example.invalid",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_operator",
    rbacDecision: "denied",
    legalMetadataStatus: "blocked",
    robotsEvidence: "Source has an active rights-owner takedown claim; robots status cannot override the complaint evidence.",
    allowedContent: "No raw, derivative, or summary material is allowed while the takedown request is open.",
    derivativeUsePolicy: "Derivative use is blocked and queued for deletion with the raw source material.",
    exactTextPolicy: "Exact text and brand-pattern imports are blocked from activation and converted to deletion evidence.",
    rawRetentionDays: 0,
    rateLimitPolicy: "Crawler fetches are disabled for this source and imports remain held at zero throughput.",
    activationGate: "blocked",
    requiredEvidenceRefs: ["cf-118", "cg-501", "ip-7001", "au-012"],
    reviewerRationale:
      "Rights-owner complaint and exact-text risk require blocked source approval, derivative deletion, and reviewer-owned takedown audit before any future review.",
    auditRef: "au-012"
  }
];

export const crawlerGovernanceWorkflows: CrawlerGovernanceWorkflow[] = [
  {
    id: "cg-501",
    findingId: "cf-118",
    requestType: "source_takedown",
    status: "evidence_review",
    requestedAt: "2026-05-26 10:35",
    dueAt: "2026-05-26 16:35",
    requester: "rights-owner@example.invalid",
    sourceContact: "IP complaint flow ticket ip-7001 with crawler-takedown tag",
    derivativeUseStatus: "blocked",
    rawRetentionAction: "delete_raw_and_derivatives",
    deletionEvidenceRef: "pending-raw-derivative-delete-cs-21",
    requesterNoticeRef: "pending-rights-owner-notice-ip-7001",
    escalationEvidenceRef: "pending-deadline-escalation-cg-501",
    activationGateDecision: "blocked",
    quarantineStatus: "active",
    slaStatus: "expired",
    affectedActivationSurfaces: ["prompt_fragment", "skill_version", "meta_prompt", "provider_route"],
    linkedReview: "rv-crawler-118",
    fixtureCaseId: "crawler_disallowed_source",
    operatorNextAction:
      "Keep source cs-21 blocked, confirm the IP complaint owner, delete raw and derivative material, and keep any linked prompt or skill activation paused.",
    closureCriteria:
      "Close only after the takedown requester is notified, raw and derivative deletion evidence is attached, expired deadline escalation is recorded, activation stays blocked, second review completes, and audit au-012 remains immutable.",
    requiredEvidenceRefs: ["cf-118", "crawler-source cs-21", "ip-7001", "pending-raw-derivative-delete-cs-21", "pending-rights-owner-notice-ip-7001", "pending-deadline-escalation-cg-501", "au-012"],
    blockedActivation: true,
    reviewerRole: "admin_reviewer",
    secondReviewRequired: true,
    secondReviewStatus: "required",
    reviewRationale:
      "Exact-text finding must stay blocked while the rights-owner claim is reviewed and all raw and derivative material is queued for deletion.",
    auditRef: "au-012"
  },
  {
    id: "cg-522",
    findingId: "cf-122",
    requestType: "derivative_review",
    status: "approved",
    requestedAt: "2026-05-26 10:38",
    dueAt: "2026-05-27 10:38",
    requester: "legal_fixture_reviewer",
    sourceContact: "Approved internal fixture source with documented derivative-use allowance",
    derivativeUseStatus: "allowed",
    rawRetentionAction: "retain_with_limit",
    deletionEvidenceRef: "not_required_retention_limited",
    requesterNoticeRef: "notice-legal-fixture-reviewer-cg-522",
    escalationEvidenceRef: "not_required_deadline_clear",
    activationGateDecision: "allowed",
    quarantineStatus: "cleared",
    slaStatus: "within_window",
    affectedActivationSurfaces: ["prompt_fragment", "skill_version", "meta_prompt"],
    linkedReview: "rv-crawler-122",
    fixtureCaseId: "crawler_approved_local_test_source",
    operatorNextAction:
      "Allow derivative summaries only for the approved fixture source, retain raw material within the review window, and keep provenance links visible.",
    closureCriteria:
      "Close after reviewer confirms robots evidence, derivative-use allowance, retention limit, active provenance references, and audit au-013 remain attached.",
    requiredEvidenceRefs: ["cf-122", "crawler-governance/crawler_approved_local_test_source", "notice-legal-fixture-reviewer-cg-522", "au-013"],
    blockedActivation: false,
    reviewerRole: "admin_reviewer",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    reviewRationale:
      "Derivative use is allowed by fixture legal metadata, provenance remains linked, and raw content retention is limited to the approved window.",
    auditRef: "au-013"
  },
  {
    id: "cg-533",
    findingId: "cf-104",
    requestType: "raw_retention_delete",
    status: "intake",
    requestedAt: "2026-05-26 10:44",
    dueAt: "2026-05-27 10:44",
    requester: "crawler-ops",
    sourceContact: "Pending source approval; contact process must be confirmed before import",
    derivativeUseStatus: "unknown",
    rawRetentionAction: "delete_raw",
    deletionEvidenceRef: "pending-raw-delete-cs-18",
    requesterNoticeRef: "pending-crawler-ops-notice-cg-533",
    escalationEvidenceRef: "not_required_within_window",
    activationGateDecision: "blocked",
    quarantineStatus: "scheduled",
    slaStatus: "within_window",
    affectedActivationSurfaces: ["prompt_fragment", "meta_prompt"],
    linkedReview: "rv-crawler-104",
    fixtureCaseId: "crawler_pending_review_import",
    operatorNextAction:
      "Keep the import held, delete raw material at expiry, request source contact evidence, and prevent crawler-derived prompt activation.",
    closureCriteria:
      "Close only after source contact, robots evidence, derivative-use status, and retention deletion proof are reviewed and audit au-014 is attached.",
    requiredEvidenceRefs: ["cf-104", "crawler-source cs-18", "pending-raw-delete-cs-18", "pending-crawler-ops-notice-cg-533", "au-014"],
    blockedActivation: true,
    reviewerRole: "admin_operator",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    reviewRationale:
      "Pending source lacks complete legal contact and derivative-use evidence, so activation remains blocked and raw content expires unless review approves it.",
    auditRef: "au-014"
  }
];

export const crawlerStagingRuntimeEvidence: CrawlerStagingRuntimeEvidence[] = [
  {
    id: "crawler-staging-runtime-20260527T1100Z",
    environment: "staging",
    status: "pass_with_blockers_preserved",
    validatedAt: "2026-05-27T11:00:00Z",
    validatedByRole: "admin_reviewer",
    evidencePath: "ops/evidence/staging/20260527T1100Z-crawler-governance-runtime.json",
    releaseGateCheckId: "staging_crawler_approval_provenance",
    controls: [
      {
        control: "source_approval",
        runtimeRef: "staging-crawler-source-approval-20260527T1100Z",
        status: "verified",
        enforcementPoint: "crawler_fetch_gate",
        linkedFindingId: "cf-104",
        sourceApprovalId: "csa-018",
        governanceWorkflowId: "cg-533",
        gateDecision: "deny",
        probeResult:
          "Staging fetch probe for crawler-source cs-18 returned governance_denied because legal metadata and derivative-use approval remain incomplete.",
        releaseGateUse:
          "Private beta crawler approval/provenance check can cite runtime denial evidence while keeping unresolved source approval blocked.",
        auditRef: "au-014",
        evidenceRefs: ["cf-104", "csa-018", "cg-533", "au-014"]
      },
      {
        control: "robots",
        runtimeRef: "staging-crawler-robots-20260527T1100Z",
        status: "verified",
        enforcementPoint: "crawler_fetch_gate",
        linkedFindingId: "cf-104",
        sourceApprovalId: "csa-018",
        governanceWorkflowId: "cg-533",
        gateDecision: "deny",
        probeResult:
          "Robots probe preserved crawl-delay and disallow evidence and denied fetch before importer enqueue for the pending source.",
        releaseGateUse:
          "Robots runtime evidence is validator-resolvable and blocks import until reviewer-owned source approval completes.",
        auditRef: "au-014",
        evidenceRefs: ["cf-104", "csa-018", "cg-533", "au-014"]
      },
      {
        control: "ssrf",
        runtimeRef: "staging-crawler-ssrf-20260527T1100Z",
        status: "verified",
        enforcementPoint: "crawler_fetch_gate",
        linkedFindingId: "cf-104",
        sourceApprovalId: "csa-018",
        governanceWorkflowId: "cg-533",
        gateDecision: "deny",
        probeResult:
          "Synthetic private-IP redirect and DNS rebinding probes were rejected before network fetch and emitted crawler_ssrf_blocked_total.",
        releaseGateUse:
          "SSRF runtime evidence confirms crawler fetch/import cannot reach private networks during staging source review.",
        auditRef: "au-014",
        evidenceRefs: ["cf-104", "csa-018", "cg-533", "au-014"]
      },
      {
        control: "rate_limit",
        runtimeRef: "staging-crawler-rate-limit-20260527T1100Z",
        status: "verified",
        enforcementPoint: "crawler_fetch_gate",
        linkedFindingId: "cf-122",
        sourceApprovalId: "csa-019",
        governanceWorkflowId: "cg-522",
        gateDecision: "allow",
        probeResult:
          "Approved source probe allowed one fixture refresh and denied the second same-window request with crawler_source_rate_limited_total.",
        releaseGateUse:
          "Rate-limit runtime evidence supports private beta crawler governance while preserving per-source throughput bounds.",
        auditRef: "au-013",
        evidenceRefs: ["cf-122", "csa-019", "cg-522", "au-013"]
      },
      {
        control: "retention",
        runtimeRef: "staging-crawler-retention-20260527T1100Z",
        status: "verified",
        enforcementPoint: "crawler_import_gate",
        linkedFindingId: "cf-118",
        sourceApprovalId: "csa-021",
        governanceWorkflowId: "cg-501",
        gateDecision: "deny",
        probeResult:
          "Blocked source probe scheduled raw and derivative deletion evidence and prevented raw retention beyond zero days.",
        releaseGateUse:
          "Retention runtime evidence keeps crawler-derived active material blocked until takedown deletion evidence closes.",
        auditRef: "au-012",
        evidenceRefs: ["cf-118", "csa-021", "cg-501", "au-012"]
      },
      {
        control: "exact_text_warning",
        runtimeRef: "staging-crawler-exact-text-20260527T1100Z",
        status: "verified",
        enforcementPoint: "crawler_import_gate",
        linkedFindingId: "cf-118",
        sourceApprovalId: "csa-021",
        governanceWorkflowId: "cg-501",
        gateDecision: "deny",
        probeResult:
          "Exact-text fixture emitted crawler_exact_text_import_warning_total and routed the finding to takedown review without activation.",
        releaseGateUse:
          "Exact-text warning runtime evidence proves importer warnings become blocked admin review items instead of active prompt material.",
        auditRef: "au-012",
        evidenceRefs: ["cf-118", "csa-021", "cg-501", "au-012"]
      },
      {
        control: "provenance",
        runtimeRef: "staging-crawler-provenance-20260527T1100Z",
        status: "verified",
        enforcementPoint: "crawler_activation",
        linkedFindingId: "cf-122",
        sourceApprovalId: "csa-019",
        governanceWorkflowId: "cg-522",
        gateDecision: "allow",
        probeResult:
          "Approved derivative summary activation retained source id, finding id, review id, audit ref, and retention window in provenance metadata.",
        releaseGateUse:
          "Provenance runtime evidence allows only approved fixture-derived summaries with source links and bounded raw retention.",
        auditRef: "au-013",
        evidenceRefs: ["cf-122", "csa-019", "cg-522", "au-013"]
      },
      {
        control: "source_blocklist",
        runtimeRef: "staging-crawler-blocklist-20260527T1100Z",
        status: "verified",
        enforcementPoint: "crawler_fetch_gate",
        linkedFindingId: "cf-118",
        sourceApprovalId: "csa-021",
        governanceWorkflowId: "cg-501",
        gateDecision: "deny",
        probeResult:
          "Blocked source cs-21 could not be fetched or imported and emitted crawler_source_blocked_total tied to takedown workflow cg-501.",
        releaseGateUse:
          "Source blocklist runtime evidence keeps crawler-derived prompt and skill activation denied while rights-owner takedown remains open.",
        auditRef: "au-012",
        evidenceRefs: ["cf-118", "csa-021", "cg-501", "au-012"]
      }
    ],
    remainingBlockers: [
      "Private beta gate remains blocked by object storage and legal visibility runtime items."
    ]
  }
];

export const promptFragments: PromptFragment[] = [
  {
    id: "pf-044",
    name: "Local services campaign structure",
    surface: "prompt-fragment",
    status: "review",
    diffSummary: "Adds brief confirmation constraints and forbids unsupported price claims.",
    evalSummary: "17/19 fixtures pass; failures are wording regressions.",
    risk: "medium"
  },
  {
    id: "pf-051",
    name: "Four candidate strategic distinction",
    surface: "prompt-fragment",
    status: "approved",
    diffSummary: "Tightens candidate differentiation rubric.",
    evalSummary: "All diversity and duplicate-similarity fixtures pass.",
    risk: "low"
  }
];

export const metaPrompts: PromptFragment[] = [
  {
    id: "mp-012",
    name: "Image specification normalizer",
    surface: "meta-prompt",
    status: "review",
    diffSummary: "Normalizes platform safe areas and structured text preservation.",
    evalSummary: "Needs second reviewer for export enforcement point.",
    risk: "high"
  },
  {
    id: "is-032",
    name: "Product logo preservation image spec",
    surface: "image-spec",
    status: "review",
    diffSummary: "Adds product/logo preservation and watermark risk fields.",
    evalSummary: "QA sample set has one false positive.",
    risk: "medium"
  }
];

export const traces: AgentTrace[] = [
  {
    id: "tr-1004",
    workflowId: "wf-774",
    userId: "usr-301",
    skillVersion: "skill-brand-kit@2.5.0",
    promptVersion: "pf-044",
    assetId: "asset-441",
    exportId: "ex-887",
    status: "retrying",
    steps: [
      {
        at: "2026-05-25 16:10",
        stage: "brief",
        provider: "openai",
        model: "image-reasoning-dev",
        status: "completed",
        latencyMs: 1130,
        costUsd: 0.04
      },
      {
        at: "2026-05-25 16:12",
        stage: "provider_response",
        provider: "openai",
        model: "image-render-dev",
        status: "retrying",
        latencyMs: 9200,
        costUsd: 0.18
      },
      {
        at: "2026-05-25 16:14",
        stage: "qa",
        provider: "internal",
        model: "qa-policy",
        status: "blocked",
        latencyMs: 420,
        costUsd: 0
      }
    ]
  },
  {
    id: "tr-1019",
    workflowId: "wf-790",
    userId: "usr-318",
    skillVersion: "skill-export-pack@1.8.1",
    promptVersion: "pf-051",
    assetId: "asset-489",
    exportId: "ex-901",
    status: "completed",
    steps: [
      {
        at: "2026-05-26 08:15",
        stage: "export",
        provider: "internal",
        model: "zip-packager",
        status: "completed",
        latencyMs: 780,
        costUsd: 0
      }
    ]
  }
];

export const feedbackItems: FeedbackItem[] = [
  {
    id: "fb-203",
    kind: "reject",
    status: "open",
    attribution: "wf-774 · skill-brand-kit@2.5.0 · tr-1004",
    signal: "Candidate looked too close to existing competitor campaign.",
    delayed: false,
    filterDecision: "eligible",
    weight: 0.9,
    weightingReason: "Explicit rejection with trace, export, and reviewer evidence; high learning value but still gated by review.",
    availableForLearningAt: "2026-05-26 09:30",
    blockedReason: "none",
    regressionFixtureRef: "fixtures/stage0/rev2/regressions/brand_similarity_fb_203.json"
  },
  {
    id: "fb-211",
    kind: "qa_warning",
    status: "open",
    attribution: "wf-790 · export ex-901 · tr-1019",
    signal: "Structured phone number was low contrast on mobile export.",
    delayed: true,
    filterDecision: "hold",
    weight: 0.65,
    weightingReason: "QA warning is useful after the delayed export review confirms the regeneration result.",
    availableForLearningAt: "2026-05-27 08:15",
    blockedReason: "Delayed feedback window remains open until mobile export regeneration is reviewed.",
    regressionFixtureRef: "pending-delayed-feedback"
  },
  {
    id: "fb-217",
    kind: "rating",
    status: "resolved",
    attribution: "wf-799 · prompt pf-051",
    signal: "Five-star rating after package add and export.",
    delayed: false,
    filterDecision: "eligible",
    weight: 0.35,
    weightingReason: "Positive rating has weak attribution, so it receives low weight and cannot activate a prompt alone.",
    availableForLearningAt: "2026-05-25 18:00",
    blockedReason: "none",
    regressionFixtureRef: "none-positive-signal"
  },
  {
    id: "fb-222",
    kind: "text_feedback",
    status: "open",
    attribution: "wf-812 · crawler source cs-21 · support sup-2212",
    signal: "User pasted prompt-extraction instructions inside a source ownership note.",
    delayed: false,
    filterDecision: "discard",
    weight: 0,
    weightingReason: "Suspected abuse signal is routed to abuse review and cannot train prompt or skill evolution.",
    availableForLearningAt: "blocked",
    blockedReason: "Suspected abuse and crawler ownership evidence unresolved.",
    regressionFixtureRef: "fixtures/stage0/rev2/regressions/safety_policy_miss_fb_222.json"
  }
];

export const regressionFixtures: RegressionFixture[] = [
  {
    id: "reg-brand-similarity-fb-203",
    sourceFeedbackId: "fb-203",
    sourceKind: "admin_bad_sample",
    fixturePath: "fixtures/stage0/rev2/regressions/brand_similarity_fb_203.json",
    workflowId: "wf-774",
    skillVersionId: "sv-240",
    failureMode: "brand_similarity",
    severity: "critical",
    status: "eval_blocking",
    evalSuiteId: "es-stage0-brand",
    requiredGate: "skill_canary",
    expectedAssertion:
      "Candidate visual direction must stay below the configured competitor-similarity threshold and preserve distinct brand marks before canary traffic resumes.",
    owner: "trust-admin",
    linkedCanaryMetric: "cm-014",
    linkedAuditRef: "au-010",
    reviewerRationale:
      "The admin bad-sample cluster caused a rollback, so this fixture is blocking until the brand/IP regression passes in the release eval suite."
  },
  {
    id: "reg-safety-policy-miss-fb-222",
    sourceFeedbackId: "fb-222",
    sourceKind: "admin_bad_sample",
    fixturePath: "fixtures/stage0/rev2/regressions/safety_policy_miss_fb_222.json",
    workflowId: "wf-812",
    skillVersionId: "sv-098",
    failureMode: "safety_policy_miss",
    severity: "critical",
    status: "eval_blocking",
    evalSuiteId: "es-stage0-safety",
    requiredGate: "prompt_activation",
    expectedAssertion:
      "Prompt and safety policy activation must block prompt-extraction and unsafe medical-claim feedback samples until superadmin safety review, second-review evidence, and immutable audit refs are complete.",
    owner: "security-admin",
    linkedCanaryMetric: "cm-013",
    linkedAuditRef: "au-006",
    reviewerRationale:
      "The discarded support-attached feedback exposed a safety policy miss, so it becomes an eval-blocking prompt activation fixture instead of learning input for prompt or skill evolution."
  },
  {
    id: "reg-mobile-readability-fb-211",
    sourceFeedbackId: "fb-211",
    sourceKind: "qa_warning",
    fixturePath: "fixtures/stage0/rev2/regressions/mobile_readability_fb_211.json",
    workflowId: "wf-790",
    skillVersionId: "sv-182",
    failureMode: "structured_text_readability",
    severity: "medium",
    status: "converted",
    evalSuiteId: "es-stage0-export",
    requiredGate: "skill_canary",
    expectedAssertion:
      "Mobile export text must preserve required phone and offer copy with contrast and safe-area checks before export-pack canary advances.",
    owner: "ops-admin",
    linkedCanaryMetric: "cm-012",
    linkedAuditRef: "au-009",
    reviewerRationale:
      "Delayed QA feedback was converted after regeneration review and now guards the export canary pass-rate threshold."
  },
  {
    id: "reg-export-manifest-sup-2204",
    sourceFeedbackId: "sup-2204",
    sourceKind: "support_ticket",
    fixturePath: "fixtures/stage0/rev2/regressions/export_manifest_sup_2204.json",
    workflowId: "wf-790",
    skillVersionId: "sv-182",
    failureMode: "export_manifest_completeness",
    severity: "medium",
    status: "converted",
    evalSuiteId: "es-stage0-export",
    requiredGate: "skill_canary",
    expectedAssertion:
      "Regenerated ZIP exports must include manifest, QA report, provenance metadata, and deterministic file names for every package item.",
    owner: "ops-admin",
    linkedCanaryMetric: "cm-012",
    linkedAuditRef: "au-011",
    reviewerRationale:
      "A support-linked export failure became a regression fixture so future release gates cannot pass on visual output alone."
  },
  {
    id: "reg-failed-task-retry-task-export-489",
    sourceFeedbackId: "task-export-489",
    sourceKind: "failed_task",
    fixturePath: "fixtures/stage0/rev2/regressions/failed_task_retry_task_export_489.json",
    workflowId: "wf-790",
    skillVersionId: "sv-182",
    failureMode: "failed_task_retry_cancel",
    severity: "medium",
    status: "converted",
    evalSuiteId: "es-stage0-export",
    requiredGate: "skill_canary",
    expectedAssertion:
      "Failed export task retries must reuse the support-linked idempotency key, attach manifest and QA evidence, release reserved credit exactly once, and keep the original failed export immutable.",
    owner: "ops-admin",
    linkedCanaryMetric: "cm-012",
    linkedAuditRef: "au-011",
    reviewerRationale:
      "The retry path was promoted from admin dead-letter evidence into a regression fixture so future export-pack canaries cannot reintroduce duplicate quota settlement or missing QA-report closure."
  },
  {
    id: "reg-failed-task-cancel-task-crawler-019",
    sourceFeedbackId: "task-crawler-019",
    sourceKind: "failed_task",
    fixturePath: "fixtures/stage0/rev2/regressions/failed_task_cancel_task_crawler_019.json",
    workflowId: "wf-812",
    skillVersionId: "sv-240",
    failureMode: "failed_task_retry_cancel",
    severity: "high",
    status: "eval_blocking",
    evalSuiteId: "es-stage0-crawler",
    requiredGate: "skill_canary",
    expectedAssertion:
      "Crawler task cancellation must require second review, preserve the cancelled import state, block crawler-derived activation, and keep source ownership evidence pending until support and audit refs are complete.",
    owner: "trust-admin",
    linkedCanaryMetric: "cm-014",
    linkedAuditRef: "au-002",
    reviewerRationale:
      "The crawler cancel sample is eval-blocking because a support-visible cancellation could otherwise be retried into active crawler-derived prompt material before ownership, robots, and takedown review evidence are complete."
  },
  {
    id: "reg-failed-task-cancel-task-crawler-122",
    sourceFeedbackId: "task-crawler-122",
    sourceKind: "failed_task",
    fixturePath: "fixtures/stage0/rev2/regressions/failed_task_cancel_task_crawler_122.json",
    workflowId: "wf-812",
    skillVersionId: "sv-240",
    failureMode: "failed_task_retry_cancel",
    severity: "medium",
    status: "converted",
    evalSuiteId: "es-stage0-crawler",
    requiredGate: "skill_canary",
    expectedAssertion:
      "Crawler task cancellation may close only after second review is approved, support-ticket scope matches the cancelled task, crawler derivative provenance remains attached, and queue mutation follows immutable audit evidence.",
    owner: "legal-admin",
    linkedCanaryMetric: "cm-014",
    linkedAuditRef: "au-013",
    reviewerRationale:
      "The approved derivative-review cancellation sample is retained as a regression fixture so future admin queue changes must prove closure-ready cancel behavior instead of only preserving pending-review cancels."
  },
  {
    id: "reg-crawler-takedown-sup-2212",
    sourceFeedbackId: "sup-2212",
    sourceKind: "support_ticket",
    fixturePath: "fixtures/stage0/rev2/regressions/crawler_takedown_sup_2212.json",
    workflowId: "wf-812",
    skillVersionId: "sv-240",
    failureMode: "crawler_takedown_activation",
    severity: "high",
    status: "eval_blocking",
    evalSuiteId: "es-stage0-brand",
    requiredGate: "skill_canary",
    expectedAssertion:
      "Crawler-derived prompt or skill activation must remain blocked while takedown deletion evidence, requester notice, second-review completion, and immutable audit evidence are incomplete.",
    owner: "legal-admin",
    linkedCanaryMetric: "cm-014",
    linkedAuditRef: "au-012",
    reviewerRationale:
      "The crawler support and takedown sample is eval-blocking because incomplete deletion or notice evidence could otherwise let rights-owner-disputed crawler material influence an active prompt or skill route."
  },
  {
    id: "reg-crawler-derivative-cg-522",
    sourceFeedbackId: "sup-2212",
    sourceKind: "support_ticket",
    fixturePath: "fixtures/stage0/rev2/regressions/crawler_derivative_review_cg_522.json",
    workflowId: "wf-812",
    skillVersionId: "sv-240",
    failureMode: "crawler_derivative_review",
    severity: "high",
    status: "eval_blocking",
    evalSuiteId: "es-stage0-crawler",
    requiredGate: "skill_canary",
    expectedAssertion:
      "Crawler derivative review must preserve source approval, provenance, requester notice, bounded raw retention, and immutable audit evidence before any crawler-derived prompt, fragment, or skill canary activation can proceed.",
    owner: "legal-admin",
    linkedCanaryMetric: "cm-014",
    linkedAuditRef: "au-013",
    reviewerRationale:
      "The derivative review sample is eval-blocking because an approved crawler source can still regress into unsafe activation if provenance, retention bounds, requester notice, or derivative-use policy evidence is dropped from the admin workflow."
  }
];

export const analyticsReports: AnalyticsReport[] = [
  {
    id: "ar-001",
    name: "first_prompt_to_four_candidates",
    window: "2026-05-19 to 2026-05-26",
    value: "84.2%",
    target: ">= 80%",
    status: "healthy",
    sampleSize: 214,
    segment: "private-beta starter workflows",
    sourceEvents: ["prompt_submitted", "four_candidates_ready", "task_failed"],
    decisionUse: "Local alpha gate can keep four-candidate workflow enabled while task failures stay below threshold."
  },
  {
    id: "ar-002",
    name: "selection_rate",
    window: "2026-05-19 to 2026-05-26",
    value: "61.8%",
    target: ">= 55%",
    status: "healthy",
    sampleSize: 178,
    segment: "candidate sets with four rendered options",
    sourceEvents: ["four_candidates_ready", "candidate_selected", "candidate_rejected"],
    decisionUse: "Selection rate supports candidate distinction quality but does not bypass eval or review."
  },
  {
    id: "ar-003",
    name: "iteration_rate",
    window: "2026-05-19 to 2026-05-26",
    value: "38.6%",
    target: "25% to 55%",
    status: "healthy",
    sampleSize: 110,
    segment: "selected directions",
    sourceEvents: ["candidate_selected", "iteration_requested", "iteration_completed"],
    decisionUse: "Iteration rate is inside the expected range for starter workflows."
  },
  {
    id: "ar-004",
    name: "package_add_export_completion",
    window: "2026-05-19 to 2026-05-26",
    value: "72.4% / 66.1%",
    target: ">= 70% package add and >= 60% export completion",
    status: "healthy",
    sampleSize: 98,
    segment: "sessions with selected direction",
    sourceEvents: ["package_item_added", "export_started", "export_completed"],
    decisionUse: "Package and export funnel remains eligible for private-beta observation."
  },
  {
    id: "ar-005",
    name: "weekly_return",
    window: "2026-05-19 to 2026-05-26",
    value: "31.5%",
    target: ">= 30%",
    status: "watch",
    sampleSize: 89,
    segment: "private-beta activated accounts",
    sourceEvents: ["user_signed_in", "project_opened", "weekly_return"],
    decisionUse: "Retention is barely above target, so do not expand allowlist without support and failure-rate review."
  },
  {
    id: "ar-006",
    name: "qa_warning_block",
    window: "2026-05-19 to 2026-05-26",
    value: "9.1% warning / 2.3% block",
    target: "<= 12% warning and <= 3% block",
    status: "watch",
    sampleSize: 132,
    segment: "export QA runs",
    sourceEvents: ["qa_warning", "safety_block", "export_blocked"],
    decisionUse: "QA remains under threshold but blocks must stay visible in safety and support queues."
  },
  {
    id: "ar-007",
    name: "cost_per_successful_package",
    window: "2026-05-19 to 2026-05-26",
    value: "$0.42",
    target: "<= $0.50",
    status: "healthy",
    sampleSize: 76,
    segment: "successful package exports",
    sourceEvents: ["provider_usage_recorded", "package_completed", "export_completed"],
    decisionUse: "Cost is below local-alpha budget but provider reconciliation remains required before production."
  },
  {
    id: "ar-008",
    name: "support_ticket_failure_rate",
    window: "2026-05-19 to 2026-05-26",
    value: "4.7%",
    target: "<= 4%",
    status: "blocked",
    sampleSize: 214,
    segment: "workflow sessions",
    sourceEvents: ["support_ticket_opened", "task_failed", "export_failed"],
    decisionUse: "Private beta expansion blocked until support tickets and failed exports return below threshold."
  }
];

export const providerHealth: ProviderHealth[] = [
  {
    id: "ph-1",
    provider: "OpenAI",
    model: "image-render-dev",
    status: "degraded",
    p95LatencyMs: 9400,
    errorRate: 0.047,
    spendCapUsedPercent: 72,
    routingAction: "Reduce non-urgent image retries by 25%.",
    contractEvidence: "Request/response schema smoke captured provider, model, cost, latency, and safety provenance.",
    canaryEvidence: "Routing reduction canary limited to non-urgent retries; no safety fallback allowed.",
    releaseEvidence: "Production release blocked while status is degraded and error rate exceeds 4%."
  },
  {
    id: "ph-2",
    provider: "Internal",
    model: "qa-policy",
    status: "healthy",
    p95LatencyMs: 510,
    errorRate: 0.002,
    spendCapUsedPercent: 18,
    routingAction: "Keep all QA enforcement points active.",
    contractEvidence: "Safety policy contract validates brief, provider request, provider response, QA, and export points.",
    canaryEvidence: "QA policy canary has zero blocking-regression misses across local alpha fixtures.",
    releaseEvidence: "Eligible for local alpha enforcement; production needs staging alert evidence."
  },
  {
    id: "ph-3",
    provider: "Crawler",
    model: "source-normalizer",
    status: "blocked",
    p95LatencyMs: 0,
    errorRate: 1,
    spendCapUsedPercent: 3,
    routingAction: "Blocked by source allowlist incident.",
    contractEvidence: "Crawler governance cases require robots evidence and legal review before import.",
    canaryEvidence: "Canary stopped after source allowlist incident; pending-review import held.",
    releaseEvidence: "Release blocked until disallowed source and robots denied cases pass."
  }
];

export const productionProviderModeEvidence: ProductionProviderModeEvidence = {
  id: "production_provider_mode_20260527T1930Z",
  environment: "production",
  status: "pass_with_blockers_preserved",
  validatedAt: "2026-05-27T19:30:00Z",
  validatedByRole: "admin_superadmin",
  releaseGateCheckId: "production_provider_or_comp_only_mode",
  doNotLaunchConditionIds: [
    "dev_mock_provider_public_claims_unresolved",
    "real_provider_or_comp_only_mode_missing"
  ],
  providerModeEvidencePath: "ops/evidence/production/provider-mode.json",
  publicClaimsEvidencePath: "ops/evidence/production/public-paid-real-generation-claims.json",
  runtimeRequestIds: [
    "production-provider-mode-20260527T1930Z-launch-mode",
    "production-provider-mode-20260527T1930Z-contract-monitoring-cost",
    "production-provider-mode-20260527T1930Z-public-claims",
    "production-provider-mode-20260527T1930Z-gate-preservation"
  ],
  providerIds: ["dev-deterministic-image"],
  auditRefs: ["au-021"],
  coverage: [
    {
      area: "provider_launch_mode",
      status: "pass",
      runtimeProbe:
        "Production launch-mode replay verified provider routing is explicit invite/comp-only: no paid traffic is enabled, dev-deterministic-image remains labelled development-only, and public generation is invite-gated until real provider and Stripe evidence exist.",
      deploymentEvidence:
        "ops/evidence/production/provider-mode.json records production mode invite_comp_only, provider_status deferred, no dev-provider routing for user-visible paid generation, no silent fallback, no production checkout, and hidden paid/real-generation claims while payment provider integration is deferred.",
      providerAuditEvidence:
        "Provider mode evidence links immutable audit au-021, provider health ph-1, release evidence eg-002, and RBAC provider override rbac-provider-001 so routing state is visible to admin review and cannot silently fall back to a weaker provider.",
      linkedAdminArtifacts: [
        "admin/app/providers/page.tsx",
        "admin/lib/fixtures.ts:productionProviderModeEvidence",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/production/provider-mode.json",
        "ops/evidence/production/public-paid-real-generation-claims.json",
        "ph-1",
        "eg-002",
        "rbac-provider-001",
        "au-021"
      ]
    },
    {
      area: "provider_contract_monitoring_cost",
      status: "pass",
      runtimeProbe:
        "Production provider/comp-only replay verified that real provider contract, Stripe billing, provider cost records, and staging verification are deferred and cannot route public paid traffic; comp-only monitoring still records no-paid-spend and alert evidence.",
      deploymentEvidence:
        "ops/evidence/production/provider-mode.json records provider_status deferred, monitoring_dashboard, no-paid cost meter, comp-only spend cap, and no silent fallback probes for the invite-only production deployment.",
      providerAuditEvidence:
        "Comp-only monitoring evidence ties provider health ph-1, operational dashboard od-provider-latency, alert route al-provider-error, quota spend-cap evidence, and audit au-021 to the production provider launch gate without closing paid lifecycle readiness.",
      linkedAdminArtifacts: [
        "admin/app/providers/page.tsx",
        "admin/app/operations/page.tsx",
        "admin/lib/fixtures.ts:providerHealth"
      ],
      evidenceRefs: [
        "ops/evidence/production/provider-mode.json",
        "ops/evidence/production/public-paid-real-generation-claims.json",
        "ph-1",
        "od-provider-latency",
        "al-provider-error",
        "au-021"
      ]
    },
    {
      area: "public_paid_real_generation_claims",
      status: "pass",
      runtimeProbe:
        "Production public-claims probe crawled public pages, billing policy, onboarding copy, and admin provider surfaces and verified real-generation and paid claims are hidden for invite/comp-only mode while Stripe evidence is deferred.",
      deploymentEvidence:
        "ops/evidence/production/public-paid-real-generation-claims.json records public copy tokens, hidden dev-provider labels, comp-only claim alignment, no mock-checkout readiness claim, no paid lifecycle claim, and provider evidence back-reference.",
      providerAuditEvidence:
        "Claims evidence binds public policy audit au-020 to provider audit au-021 so legal/support pages, billing copy, and provider status cannot imply real production generation or paid launch without matching production provider and Stripe evidence.",
      linkedAdminArtifacts: [
        "admin/app/providers/page.tsx",
        "admin/app/operations/page.tsx",
        "admin/lib/fixtures.ts:productionLegalSupportPolicyEvidence"
      ],
      evidenceRefs: [
        "ops/evidence/production/public-paid-real-generation-claims.json",
        "ops/evidence/production/provider-mode.json",
        "au-020",
        "au-021",
        "production_legal_support_policy"
      ]
    },
    {
      area: "gate_blocker_preservation",
      status: "pass",
      runtimeProbe:
        "Production release-gate replay cleared production_provider_or_comp_only_mode and its two provider-related do-not-launch conditions for invite/comp-only mode while preserving paid billing, backup rollback, plus upstream CI and staging blockers.",
      deploymentEvidence:
        "The production gate fixture cites both exact provider mode files, clears only the provider-or-comp-only check, and keeps aggregate no-go status because Stripe paid billing and backup evidence remain separate launch blockers.",
      providerAuditEvidence:
        "Gate preservation links au-021, the production gate fixture, and remaining blocker ids so comp-only provider readiness cannot imply paid billing, backup rollback, post-deploy smoke, CI, or staging readiness.",
      linkedAdminArtifacts: [
        "admin/app/providers/page.tsx",
        "admin/app/operations/page.tsx",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/production/provider-mode.json",
        "ops/evidence/production/public-paid-real-generation-claims.json",
        "au-021",
        "production_paid_billing_lifecycle",
        "production_backup_rollback_incident"
      ]
    }
  ],
  gateImpact: {
    checklistItems: [
      "Production provider-or-comp-only runtime/deployment evidence 通过。",
      "Production provider mode deployment evidence 通过：production evidence proves either real provider contract/monitoring/cost/staging verification or explicit invite/comp-only mode under `ops/evidence/production/`。",
      "Production public paid/real-generation claims evidence 通过：production evidence proves paid and real-generation claims are enabled only with real provider evidence, or hidden for invite/comp-only mode under `ops/evidence/production/`。"
    ],
    canClearCheckLevelItems: true,
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items",
    remainingBlockers: [
      "production_paid_billing_lifecycle",
      "production_backup_rollback_incident"
    ]
  }
};

export const operationalDashboards: OperationalDashboard[] = [
  {
    id: "od-provider-latency",
    name: "provider_latency_error",
    ownerRole: "admin_operator",
    status: "blocked",
    window: "2026-05-26 09:00 to 10:00",
    currentValue: "p95 9400 ms, error 4.7%",
    sloThreshold: "p95 <= 8000 ms and error rate <= 4% for private beta provider routes.",
    linkedSystems: ["providers", "worker-generation", "release-gate"],
    sourceSignals: ["provider_request_latency_ms", "provider_error_total", "provider_usage_reconciled_total"],
    releaseGateUse: "Private beta and production provider launch stay blocked until the alert resolves and provider usage reconciliation has matching audit evidence.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "blocked",
    runtimeEvidenceRef: "staging-dashboard-provider-20260526T1000Z",
    runtimeValidatedAt: "2026-05-26 10:05",
    evidenceRefs: ["ph-1", "eg-003", "au-007", "staging-dashboard-provider-20260526T1000Z"]
  },
  {
    id: "od-export-failure",
    name: "export_failure",
    ownerRole: "admin_reviewer",
    status: "blocked",
    window: "2026-05-26 09:00 to 10:00",
    currentValue: "3 dead-letter exports, oldest 84 minutes",
    sloThreshold: "Failed export rate <= 2% and queue oldest age <= 30 minutes before release can advance.",
    linkedSystems: ["export-packaging", "queue-dead-letter", "support-console"],
    sourceSignals: ["export_failed_total", "queue_dead_letter_total", "qa_report_packaging_failed_total"],
    releaseGateUse: "Release gate requires manual regenerate, quota refund audit, and manifest validation evidence before export success can be marked healthy.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "verified",
    runtimeEvidenceRef: "staging-dashboard-export-20260526T1000Z",
    runtimeValidatedAt: "2026-05-26 10:06",
    evidenceRefs: ["q-export", "inc-20260526-queue", "au-004", "sup-2204", "staging-dashboard-export-20260526T1000Z"]
  },
  {
    id: "od-crawler-policy",
    name: "crawler_policy_violation",
    ownerRole: "admin_reviewer",
    status: "watch",
    window: "2026-05-25 14:00 to 2026-05-26 10:00",
    currentValue: "1 resolved blocklist incident, pending derivative review",
    sloThreshold: "Zero active crawler policy violations and every approved import must include robots, provenance, legal metadata, and retention evidence.",
    linkedSystems: ["crawler-findings", "review-queue", "prompt-fragments"],
    sourceSignals: ["crawler_source_blocked_total", "robots_denied_total", "crawler_derivative_review_open_total"],
    releaseGateUse: "Crawler-derived prompt or skill activation remains blocked whenever takedown, derivative-use, or retention evidence is unresolved.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "verified",
    runtimeEvidenceRef: "staging-dashboard-crawler-20260526T1000Z",
    runtimeValidatedAt: "2026-05-26 10:07",
    evidenceRefs: ["q-crawler", "inc-20260525-crawler", "au-012", "cg-501", "staging-dashboard-crawler-20260526T1000Z"]
  },
  {
    id: "od-admin-security",
    name: "admin_security",
    ownerRole: "admin_superadmin",
    status: "blocked",
    window: "2026-05-26 10:00 to 10:30",
    currentValue: "1 critical prompt extraction investigation open",
    sloThreshold: "Zero critical admin/security abuse events before public release gates can pass.",
    linkedSystems: ["admin-abuse", "prompt-fragments", "trace-redaction"],
    sourceSignals: ["safety_block_total", "trace_redaction_violation_total", "admin_override_denied_total"],
    releaseGateUse: "Production launch is blocked until the security-admin investigation closes with audit, support, and release evidence refs.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "blocked",
    runtimeEvidenceRef: "staging-dashboard-admin-security-20260526T1030Z",
    runtimeValidatedAt: "2026-05-26 10:31",
    evidenceRefs: ["ab-304", "au-008", "tr-1004", "staging-dashboard-admin-security-20260526T1030Z"]
  },
  {
    id: "od-legal-support-visibility",
    name: "legal_support_visibility",
    ownerRole: "admin_reviewer",
    status: "blocked",
    window: "2026-05-27 21:30 to 22:00",
    currentValue: "0 of 2 required external-user evidence artifacts present",
    sloThreshold:
      "Terms, Privacy, Acceptable Use, AI/content disclaimer, IP complaint flow, visible support contact, report-problem path, and billing/support policy must be visible to an external staging user before private beta readiness can advance.",
    linkedSystems: ["web-legal-pages", "support-contact", "release-gate"],
    sourceSignals: [
      "legal_page_visibility_probe_total",
      "support_contact_visibility_probe_total",
      "external_user_legal_pages_missing"
    ],
    releaseGateUse:
      "Private Beta/Staging legal/support visibility is blocked until deployed external-user staging probes pass for legal pages and support contact under ops/evidence/staging/.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "blocked",
    runtimeEvidenceRef: "staging-dashboard-legal-support-20260527T2200Z",
    runtimeValidatedAt: "2026-05-27 22:00",
    evidenceRefs: [
      "rb-private-beta-legal-support-visibility",
      "eg-005",
      "au-020",
      "staging-dashboard-legal-support-20260527T2200Z"
    ]
  }
];

export const operationalDashboardRuntimeEvidence: OperationalDashboardRuntimeEvidence[] = [
  {
    id: "odre-provider-latency-20260526T1000Z",
    dashboardId: "od-provider-latency",
    environment: "staging",
    validationStatus: "blocked",
    validatedAt: "2026-05-26 10:05",
    validatedByRole: "admin_operator",
    importProbe: "Imported staging-dashboard-provider-20260526T1000Z with provider latency, provider error, and provider usage reconciliation panels bound to the provider route.",
    signalProbe: "Signal probe joined provider_request_latency_ms, provider_error_total, and provider_usage_reconciled_total into the dashboard window without missing series.",
    sloProbe: "SLO probe remained blocked because p95 9400 ms and 4.7% error rate exceeded the private beta provider thresholds.",
    blockerProbe: "Release blocker rb-private-beta-provider-slo stayed open and linked provider routing audit au-007 plus provider health evidence ph-1.",
    releaseGateUse: "Private beta and production provider launch remain blocked until a healthy dashboard window and usage reconciliation evidence are attached; staging dashboard import evidence is recorded in ops/evidence/staging/20260526T1000Z-dashboard-runtime.json.",
    auditRef: "au-007",
    evidenceRefs: ["od-provider-latency", "rb-private-beta-provider-slo", "ph-1", "eg-003", "au-007", "staging-dashboard-provider-20260526T1000Z"]
  },
  {
    id: "odre-export-failure-20260526T1000Z",
    dashboardId: "od-export-failure",
    environment: "staging",
    validationStatus: "verified",
    validatedAt: "2026-05-26 10:06",
    validatedByRole: "admin_reviewer",
    importProbe: "Imported staging-dashboard-export-20260526T1000Z with export failure, dead-letter queue, QA packaging failure, and support-ticket panels.",
    signalProbe: "Signal probe joined export_failed_total, queue_dead_letter_total, and qa_report_packaging_failed_total with support ticket sup-2204.",
    sloProbe: "SLO probe verified the dashboard query and intentionally preserved the blocked status while three dead-letter exports remain unresolved.",
    blockerProbe: "Export dashboard evidence is linked to incident inc-20260526-queue, audit au-004, queue q-export, and support ticket sup-2204 before closure.",
    releaseGateUse: "Export release success cannot be marked healthy until regenerate, quota refund, support update, and manifest validation evidence are attached; staging dashboard import evidence is recorded in ops/evidence/staging/20260526T1000Z-dashboard-runtime.json.",
    auditRef: "au-004",
    evidenceRefs: ["od-export-failure", "q-export", "inc-20260526-queue", "sup-2204", "au-004", "staging-dashboard-export-20260526T1000Z"]
  },
  {
    id: "odre-crawler-policy-20260526T1000Z",
    dashboardId: "od-crawler-policy",
    environment: "staging",
    validationStatus: "verified",
    validatedAt: "2026-05-26 10:07",
    validatedByRole: "admin_reviewer",
    importProbe: "Imported staging-dashboard-crawler-20260526T1000Z with crawler blocklist, robots denial, derivative review, and source-retention panels.",
    signalProbe: "Signal probe joined crawler_source_blocked_total, robots_denied_total, and crawler_derivative_review_open_total with governance workflow cg-501.",
    sloProbe: "SLO probe verified zero active crawler policy violations while preserving watch status for the pending derivative-use review.",
    blockerProbe: "Production blocker rb-production-crawler-derivative stayed mitigating until takedown or derivative review closes with provenance and audit evidence.",
    releaseGateUse: "Crawler-derived prompt or skill activation remains blocked whenever takedown, derivative-use, provenance, or retention evidence is unresolved; staging dashboard import evidence is recorded in ops/evidence/staging/20260526T1000Z-dashboard-runtime.json.",
    auditRef: "au-012",
    evidenceRefs: ["od-crawler-policy", "rb-production-crawler-derivative", "q-crawler", "inc-20260525-crawler", "cg-501", "au-012", "staging-dashboard-crawler-20260526T1000Z"]
  },
  {
    id: "odre-admin-security-20260526T1030Z",
    dashboardId: "od-admin-security",
    environment: "staging",
    validationStatus: "blocked",
    validatedAt: "2026-05-26 10:31",
    validatedByRole: "admin_superadmin",
    importProbe: "Imported staging-dashboard-admin-security-20260526T1030Z with safety block, trace redaction violation, and admin override denial panels.",
    signalProbe: "Signal probe joined safety_block_total, trace_redaction_violation_total, and admin_override_denied_total with abuse event ab-304.",
    sloProbe: "SLO probe stayed blocked because the critical hidden prompt extraction investigation is still open.",
    blockerProbe: "Production blocker rb-production-admin-security stayed open and linked abuse event ab-304, trace tr-1004, and immutable audit au-008.",
    releaseGateUse: "Production launch remains blocked until the security-admin investigation closes with audit, support, trace-redaction, and release evidence refs; staging dashboard import evidence is recorded in ops/evidence/staging/20260526T1000Z-dashboard-runtime.json.",
    auditRef: "au-008",
    evidenceRefs: ["od-admin-security", "rb-production-admin-security", "ab-304", "au-008", "tr-1004", "staging-dashboard-admin-security-20260526T1030Z"]
  },
  {
    id: "odre-legal-support-visibility-20260527T2200Z",
    dashboardId: "od-legal-support-visibility",
    environment: "staging",
    validationStatus: "blocked",
    validatedAt: "2026-05-27 22:00",
    validatedByRole: "admin_reviewer",
    importProbe:
      "Imported staging-dashboard-legal-support-20260527T2200Z with panels for Terms, Privacy, Acceptable Use, AI/content disclaimer, IP complaint flow, visible support contact, report-problem path, and billing/support policy visibility.",
    signalProbe:
      "Signal probe joined legal_page_visibility_probe_total, support_contact_visibility_probe_total, and external_user_legal_pages_missing to the private beta release gate check staging_legal_external_user_pages.",
    sloProbe:
      "SLO probe stayed blocked because ops/evidence/staging/legal-pages-external-user.json and ops/evidence/staging/support-contact-external-user.json currently contain missing_staging_web_url diagnostics and source files alone do not satisfy external-user staging visibility.",
    blockerProbe:
      "Release blocker rb-private-beta-legal-support-visibility linked audit au-020, release evidence eg-005, and the blocked staging legal/support smoke evidence.",
    releaseGateUse:
      "Private Beta/Staging legal/support visibility remains blocked until STAGING_WEB_URL probes pass under ops/evidence/staging/; this dashboard must not close the aggregate gate while legal/support or object-storage retention remains blocked.",
    auditRef: "au-020",
    evidenceRefs: [
      "od-legal-support-visibility",
      "rb-private-beta-legal-support-visibility",
      "eg-005",
      "au-020",
      "staging-dashboard-legal-support-20260527T2200Z"
    ]
  }
];

export const alertRoutes: AlertRoute[] = [
  {
    id: "al-provider-error",
    dashboardId: "od-provider-latency",
    severity: "sev2",
    status: "firing",
    threshold: "Provider error rate > 4% for 15 minutes or p95 latency > 8000 ms for 30 minutes.",
    routeTarget: "ops-admin pager plus provider-routing review queue",
    escalationRole: "admin_operator",
    runbook: "Reduce non-urgent routing, verify provider usage reconciliation, attach audit evidence, and keep production provider launch blocked until the dashboard returns healthy.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "verified",
    runtimeEvidenceRef: "staging-alert-provider-20260526T1000Z",
    runtimeValidatedAt: "2026-05-26 10:05",
    incidentRef: "none",
    auditRef: "au-007",
    evidenceRefs: ["od-provider-latency", "ph-1", "eg-003", "au-007", "staging-alert-provider-20260526T1000Z"]
  },
  {
    id: "al-export-dead-letter",
    dashboardId: "od-export-failure",
    severity: "sev2",
    status: "firing",
    threshold: "Export dead letters >= 3 or oldest export queue age > 60 minutes.",
    routeTarget: "support-admin incident channel and export regeneration queue",
    escalationRole: "admin_reviewer",
    runbook: "Hold automatic retries, regenerate only eligible exports, verify quota refunds, and update support tickets before resolving the incident.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "verified",
    runtimeEvidenceRef: "staging-alert-export-20260526T1000Z",
    runtimeValidatedAt: "2026-05-26 10:06",
    incidentRef: "inc-20260526-queue",
    auditRef: "au-004",
    evidenceRefs: ["od-export-failure", "q-export", "inc-20260526-queue", "sup-2204", "au-004", "staging-alert-export-20260526T1000Z"]
  },
  {
    id: "al-crawler-policy",
    dashboardId: "od-crawler-policy",
    severity: "sev3",
    status: "resolved",
    threshold: "Any crawler source blocklist hit, robots denial, or derivative review blocks activation.",
    routeTarget: "trust-admin crawler review queue",
    escalationRole: "admin_reviewer",
    runbook: "Keep findings pending, block active prompt and skill import, complete takedown or derivative review, and retain raw content only inside the approved window.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "verified",
    runtimeEvidenceRef: "staging-alert-crawler-20260526T1000Z",
    runtimeValidatedAt: "2026-05-26 10:08",
    incidentRef: "inc-20260525-crawler",
    auditRef: "au-012",
    evidenceRefs: ["od-crawler-policy", "inc-20260525-crawler", "cf-118", "cg-501", "au-012", "staging-alert-crawler-20260526T1000Z"]
  },
  {
    id: "al-admin-security",
    dashboardId: "od-admin-security",
    severity: "sev1",
    status: "firing",
    threshold: "Any critical hidden prompt extraction, trace redaction violation, or unsafe admin override attempt.",
    routeTarget: "security-admin emergency queue",
    escalationRole: "admin_superadmin",
    runbook: "Place temporary hold, preserve trace and audit evidence, block prompt-fragment activation, and require security-admin closure before release gates advance.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "verified",
    runtimeEvidenceRef: "staging-alert-admin-security-20260526T1030Z",
    runtimeValidatedAt: "2026-05-26 10:31",
    incidentRef: "none",
    auditRef: "au-008",
    evidenceRefs: ["od-admin-security", "ab-304", "au-008", "tr-1004", "staging-alert-admin-security-20260526T1030Z"]
  },
  {
    id: "al-legal-support-visibility",
    dashboardId: "od-legal-support-visibility",
    severity: "sev2",
    status: "firing",
    threshold:
      "Any missing external-user staging evidence for Terms, Privacy, Acceptable Use, AI/content disclaimer, IP complaint flow, visible support contact, report-problem path, or billing/support policy.",
    routeTarget: "release-admin and support-admin legal/support visibility queue",
    escalationRole: "admin_reviewer",
    runbook:
      "Run scripts/staging_legal_support_visibility_smoke.sh with STAGING_WEB_URL, attach legal-pages-external-user and support-contact-external-user evidence, keep the private beta gate blocked until both coverage areas pass, and preserve object-storage retention as a separate blocker.",
    runtimeEnvironment: "staging",
    runtimeEvidenceStatus: "verified",
    runtimeEvidenceRef: "staging-alert-legal-support-20260527T2200Z",
    runtimeValidatedAt: "2026-05-27 22:00",
    incidentRef: "none",
    auditRef: "au-020",
    evidenceRefs: [
      "od-legal-support-visibility",
      "rb-private-beta-legal-support-visibility",
      "eg-005",
      "au-020",
      "staging-alert-legal-support-20260527T2200Z"
    ]
  }
];

export const alertRouteRuntimeEvidence: AlertRouteRuntimeEvidence[] = [
  {
    id: "are-provider-error-20260526T1000Z",
    alertRouteId: "al-provider-error",
    dashboardId: "od-provider-latency",
    environment: "staging",
    validationStatus: "verified",
    validatedAt: "2026-05-26 10:05",
    validatedByRole: "admin_operator",
    routeBinding: "stage0-ops pager and provider-routing review queue received the staging-alert-provider-20260526T1000Z probe.",
    deliveryProbe: "Synthetic provider_error_total and provider_request_latency_ms breach delivered one SEV2 firing event with no duplicate notifications.",
    thresholdProbe: "Threshold matched p95 latency > 8000 ms for 30 minutes or provider error rate > 4% for 15 minutes.",
    escalationProbe: "Escalation stayed on admin_operator because severity is SEV2 and the provider dashboard still blocks release.",
    runbookProbe: "Runbook opened provider routing mitigation, usage reconciliation, and release-gate block instructions.",
    incidentLinkage: "No incident opened because this probe validates the route while the dashboard remains blocked for launch readiness.",
    auditRef: "au-007",
    releaseGateUse: "Private beta and production provider launch remain blocked until dashboard health and provider usage reconciliation are both verified; staging alert route evidence is recorded in ops/evidence/staging/20260526T1000Z-alert-runtime.json.",
    evidenceRefs: ["al-provider-error", "od-provider-latency", "ph-1", "eg-003", "au-007", "staging-alert-provider-20260526T1000Z"]
  },
  {
    id: "are-export-dead-letter-20260526T1000Z",
    alertRouteId: "al-export-dead-letter",
    dashboardId: "od-export-failure",
    environment: "staging",
    validationStatus: "verified",
    validatedAt: "2026-05-26 10:06",
    validatedByRole: "admin_reviewer",
    routeBinding: "stage0-support incident channel and export regeneration queue received the staging-alert-export-20260526T1000Z probe.",
    deliveryProbe: "Synthetic export dead-letter count breach delivered one SEV2 firing event and attached support ticket sup-2204.",
    thresholdProbe: "Threshold matched export dead letters >= 3 or oldest export queue age > 60 minutes.",
    escalationProbe: "Escalation required admin_reviewer ownership before retry, cancel, regenerate, or quota refund actions could proceed.",
    runbookProbe: "Runbook opened retry hold, export regenerate eligibility, quota refund audit, and support-update instructions.",
    incidentLinkage: "Incident inc-20260526-queue remained linked to the alert route and export queue evidence.",
    auditRef: "au-004",
    releaseGateUse: "Export release success cannot be marked healthy until dead-letter closure, regenerate, quota refund, and manifest evidence are attached; staging alert route evidence is recorded in ops/evidence/staging/20260526T1000Z-alert-runtime.json.",
    evidenceRefs: ["al-export-dead-letter", "od-export-failure", "q-export", "inc-20260526-queue", "sup-2204", "au-004", "staging-alert-export-20260526T1000Z"]
  },
  {
    id: "are-crawler-policy-20260526T1000Z",
    alertRouteId: "al-crawler-policy",
    dashboardId: "od-crawler-policy",
    environment: "staging",
    validationStatus: "verified",
    validatedAt: "2026-05-26 10:08",
    validatedByRole: "admin_reviewer",
    routeBinding: "trust-admin crawler review queue received the staging-alert-crawler-20260526T1000Z probe.",
    deliveryProbe: "Synthetic crawler blocklist and derivative-review signals delivered one resolved SEV3 route validation event.",
    thresholdProbe: "Threshold matched any crawler source blocklist hit, robots denial, or derivative review block.",
    escalationProbe: "Escalation stayed with admin_reviewer because crawler-derived activation is blocked until review closes.",
    runbookProbe: "Runbook opened finding hold, active prompt/skill import block, takedown review, derivative review, and raw-retention instructions.",
    incidentLinkage: "Incident inc-20260525-crawler stayed attached with crawler finding cf-118 and governance workflow cg-501 evidence.",
    auditRef: "au-012",
    releaseGateUse: "Crawler-derived activation remains blocked whenever takedown, derivative-use, provenance, or retention evidence is unresolved; staging alert route evidence is recorded in ops/evidence/staging/20260526T1000Z-alert-runtime.json.",
    evidenceRefs: ["al-crawler-policy", "od-crawler-policy", "inc-20260525-crawler", "cf-118", "cg-501", "au-012", "staging-alert-crawler-20260526T1000Z"]
  },
  {
    id: "are-admin-security-20260526T1030Z",
    alertRouteId: "al-admin-security",
    dashboardId: "od-admin-security",
    environment: "staging",
    validationStatus: "verified",
    validatedAt: "2026-05-26 10:31",
    validatedByRole: "admin_superadmin",
    routeBinding: "security-admin emergency queue received the staging-alert-admin-security-20260526T1030Z probe.",
    deliveryProbe: "Synthetic hidden prompt extraction and admin override denial signals delivered one SEV1 firing event.",
    thresholdProbe: "Threshold matched any critical hidden prompt extraction, trace redaction violation, or unsafe admin override attempt.",
    escalationProbe: "Escalation required admin_superadmin ownership before release gates, prompt activation, or override closure could proceed.",
    runbookProbe: "Runbook opened temporary hold, trace preservation, immutable audit, prompt-fragment activation block, and security closure instructions.",
    incidentLinkage: "No separate incident opened because the critical abuse queue ab-304 remains the authoritative investigation record.",
    auditRef: "au-008",
    releaseGateUse: "Production launch remains blocked until the security-admin investigation closes with audit, support, and release evidence refs; staging alert route evidence is recorded in ops/evidence/staging/20260526T1000Z-alert-runtime.json.",
    evidenceRefs: ["al-admin-security", "od-admin-security", "ab-304", "au-008", "tr-1004", "staging-alert-admin-security-20260526T1030Z"]
  },
  {
    id: "are-legal-support-visibility-20260527T2200Z",
    alertRouteId: "al-legal-support-visibility",
    dashboardId: "od-legal-support-visibility",
    environment: "staging",
    validationStatus: "verified",
    validatedAt: "2026-05-27 22:00",
    validatedByRole: "admin_reviewer",
    routeBinding:
      "release-admin and support-admin legal/support visibility queue received the staging-alert-legal-support-20260527T2200Z probe.",
    deliveryProbe:
      "Synthetic external_user_legal_pages_missing breach delivered one SEV2 firing event with the exact required evidence paths for legal-pages-external-user and support-contact-external-user.",
    thresholdProbe:
      "Threshold matched any missing external-user staging visibility evidence for legal pages, support contact, report-problem path, or billing/support policy.",
    escalationProbe:
      "Escalation required admin_reviewer ownership because release operators cannot clear the private beta legal/support check from web artifacts or dry-run evidence.",
    runbookProbe:
      "Runbook opened STAGING_WEB_URL smoke instructions, exact ops/evidence/staging artifact requirements, gate-impact preservation, and object-storage retention blocker separation.",
    incidentLinkage:
      "No incident opened because the alert validates release-gate visibility routing while rb-private-beta-legal-support-visibility remains the authoritative blocker.",
    auditRef: "au-020",
    releaseGateUse:
      "The alert route proves admin notification and runbook coverage; check closure is now backed by passing external-user smoke evidence.",
    evidenceRefs: [
      "al-legal-support-visibility",
      "od-legal-support-visibility",
      "rb-private-beta-legal-support-visibility",
      "eg-005",
      "au-020",
      "staging-alert-legal-support-20260527T2200Z"
    ]
  }
];

export const backendMetricsRuntimeEvidence: BackendMetricsRuntimeEvidence = {
  id: "bmre-staging-20260527T1215Z",
  environment: "staging",
  status: "pass_with_blockers_preserved",
  validatedAt: "2026-05-27 12:15",
  validatedByRole: "admin_superadmin",
  evidencePath: "ops/evidence/staging/20260527T1215Z-backend-worker-crawler-metrics.json",
  releaseGateCheckId: "staging_observability_backup_load",
  blueprintChecklistItem: "staging backend/worker/crawler metrics runtime evidence 通过。",
  canClearChecklistItem: true,
  aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items",
  probes: [
    {
      service: "backend_api",
      runtimeRef: "staging-metrics-backend-api-20260527T1215Z",
      validationStatus: "verified",
      scrapeTarget: "https://staging-api.zenari.internal/metrics",
      requiredSignals: [
        "http_requests_total",
        "http_request_duration_ms",
        "quota_reservation_total",
        "admin_api_denied_total",
        "object_signed_url_issued_total"
      ],
      sampleWindow: "2026-05-27 11:45 to 12:15 UTC",
      cardinalityProbe: "Scrape retained tenant_id and user_id redaction, bounded route labels to 38 values, and rejected raw path, prompt, provider key, support text, export filename, and crawler URL labels.",
      sloProbe: "API p95 was 412 ms and error rate was 0.7%; quota reservation/refund counters matched admin quota evidence while object-storage signed-download runtime evidence remains a separate blocker.",
      releaseGateUse: "This verifies backend API metrics ingestion for the staging observability checklist row, but the private beta aggregate gate remains blocked until request-id, structured log, trace, restore, smoke, and load runtime evidence are attached.",
      auditRef: "au-007",
      evidenceRefs: ["bmre-staging-20260527T1215Z", "staging-metrics-backend-api-20260527T1215Z", "au-007"]
    },
    {
      service: "worker",
      runtimeRef: "staging-metrics-worker-20260527T1215Z",
      validationStatus: "verified",
      scrapeTarget: "https://staging-worker.zenari.internal/metrics",
      requiredSignals: [
        "worker_task_started_total",
        "worker_task_failed_total",
        "queue_dead_letter_total",
        "provider_usage_reconciled_total",
        "export_regeneration_total"
      ],
      sampleWindow: "2026-05-27 11:45 to 12:15 UTC",
      cardinalityProbe: "Scrape kept workflow, queue, status, provider, and retry outcome labels bounded and confirmed prompts, trace payloads, support messages, and export object keys were not emitted as metric labels.",
      sloProbe: "Worker queue delay p95 was 74 seconds and export regeneration counters matched support retry evidence; provider p95 latency remains blocked by od-provider-latency and release blocker rb-private-beta-provider-slo.",
      releaseGateUse: "This verifies worker metrics ingestion and queue/export signal binding for staging operations, while provider SLO and non-metrics observability blockers remain open in the private beta gate.",
      auditRef: "au-007",
      evidenceRefs: [
        "bmre-staging-20260527T1215Z",
        "staging-metrics-worker-20260527T1215Z",
        "od-provider-latency",
        "rb-private-beta-provider-slo",
        "au-007"
      ]
    },
    {
      service: "crawler",
      runtimeRef: "staging-metrics-crawler-20260527T1215Z",
      validationStatus: "verified",
      scrapeTarget: "https://staging-crawler.zenari.internal/metrics",
      requiredSignals: [
        "crawler_fetch_total",
        "crawler_source_blocked_total",
        "robots_denied_total",
        "crawler_retention_delete_total",
        "crawler_derivative_review_open_total"
      ],
      sampleWindow: "2026-05-27 11:45 to 12:15 UTC",
      cardinalityProbe: "Scrape preserved source_id and control labels but rejected raw source URLs, exact copied text, request headers, IP addresses, takedown contacts, and crawler document titles as labels.",
      sloProbe: "Crawler metrics matched the source approval, robots denial, retention deletion, and derivative-review staging runtime evidence without allowing crawler-derived activation to bypass review.",
      releaseGateUse: "This verifies crawler metrics ingestion for the staging observability checklist row, but crawler-derived production activation remains governed by takedown and derivative review evidence.",
      auditRef: "au-012",
      evidenceRefs: [
        "bmre-staging-20260527T1215Z",
        "staging-metrics-crawler-20260527T1215Z",
        "cg-501",
        "au-012"
      ]
    }
  ],
  remainingBlockers: [
    "staging backup/restore/load runtime evidence"
  ]
};

export const observabilityTelemetryRuntimeEvidence: ObservabilityTelemetryRuntimeEvidence = {
  id: "otre-staging-20260527T1815Z",
  environment: "staging",
  status: "pass_with_blockers_preserved",
  validatedAt: "2026-05-27 18:15",
  validatedByRole: "admin_superadmin",
  evidencePath: "ops/evidence/staging/20260527T1815Z-observability-telemetry.json",
  releaseGateCheckId: "staging_observability_backup_load",
  closedChecklistItems: [
    "staging request id propagation runtime evidence 通过。",
    "staging structured JSON logs runtime evidence 通过。",
    "staging OpenTelemetry traces runtime evidence 通过。"
  ],
  canClearChecklistItems: true,
  aggregatePrivateBetaGateStatus: "blocked_by_other_staging_runtime_items",
  controls: [
    {
      area: "request_id_propagation",
      runtimeRef: "staging-request-id-admin-api-worker-crawler-20260527T1815Z",
      validationStatus: "verified",
      services: ["admin_console", "backend_api", "worker", "crawler"],
      propagationProbe: "Synthetic external-user request req-stg-7f3a entered the admin console support evidence view, crossed the backend API, queued worker retry control ft-912, and triggered crawler governance lookup cg-501 with the same x-request-id in every sampled record.",
      redactionProbe: "Request-id samples preserved tenant-scoped correlation and omitted prompt text, provider keys, support free text, signed object keys, crawler URLs, cookies, and authorization headers from admin-visible evidence.",
      traceLinkageProbe: "Request-id req-stg-7f3a linked trace tr-1004, support ticket sup-2204, audit au-007, queue q-export, and crawler workflow cg-501 without creating duplicate correlation ids.",
      releaseGateUse: "This closes only the staging request-id propagation checklist row; private beta observability remains blocked until restore drill, staging smoke, and load evidence are attached.",
      auditRef: "au-007",
      evidenceRefs: [
        "otre-staging-20260527T1815Z",
        "staging-request-id-admin-api-worker-crawler-20260527T1815Z",
        "tr-1004",
        "sup-2204",
        "q-export",
        "cg-501",
        "au-007"
      ]
    },
    {
      area: "structured_json_logs",
      runtimeRef: "staging-json-logs-admin-api-worker-crawler-20260527T1815Z",
      validationStatus: "verified",
      services: ["admin_console", "backend_api", "worker", "crawler"],
      propagationProbe: "Runtime log probe sampled admin action, API request, worker retry, export regeneration, and crawler review records with consistent schema fields for timestamp, level, service, request_id, tenant_hash, audit_ref, and release_gate_check_id.",
      redactionProbe: "Structured log sampler rejected raw prompts, user emails, support message bodies, provider keys, signed URL secrets, exact copied crawler text, request headers, and trace payloads while preserving hashed tenant and audit references.",
      traceLinkageProbe: "JSON log records joined to trace tr-1004, audit au-007, failed task ft-912, export ex-909, and crawler workflow cg-501 through request_id and audit_ref fields.",
      releaseGateUse: "This closes only the staging structured JSON logs checklist row; private beta observability remains blocked until restore drill, staging smoke, and load evidence are attached.",
      auditRef: "au-007",
      evidenceRefs: [
        "otre-staging-20260527T1815Z",
        "staging-json-logs-admin-api-worker-crawler-20260527T1815Z",
        "tr-1004",
        "ft-912",
        "ex-909",
        "cg-501",
        "au-007"
      ]
    },
    {
      area: "opentelemetry_traces",
      runtimeRef: "staging-otel-admin-api-worker-crawler-20260527T1815Z",
      validationStatus: "verified",
      services: ["admin_console", "backend_api", "worker", "crawler"],
      propagationProbe: "OpenTelemetry probe captured one distributed trace from admin retry review through backend API, worker retry scheduling, provider handoff placeholder, export packaging, and crawler provenance lookup with parent-child spans intact.",
      redactionProbe: "Span attributes allowed workflow_id, queue_id, provider family, retry outcome, and governance workflow id but rejected prompt bodies, provider credentials, support free text, signed object keys, exact crawler text, and user identifiers.",
      traceLinkageProbe: "Trace runtime linked request id req-stg-7f3a to trace tr-1004, audit au-007, support ticket sup-2204, export ex-909, and crawler governance workflow cg-501.",
      releaseGateUse: "This closes only the staging OpenTelemetry traces checklist row; private beta observability remains blocked until restore drill, staging smoke, and load evidence are attached.",
      auditRef: "au-007",
      evidenceRefs: [
        "otre-staging-20260527T1815Z",
        "staging-otel-admin-api-worker-crawler-20260527T1815Z",
        "tr-1004",
        "sup-2204",
        "ex-909",
        "cg-501",
        "au-007"
      ]
    }
  ],
  remainingBlockers: [
    "staging backup/restore/load runtime evidence",
    "staging post-deploy smoke tests",
    "staging load evidence"
  ]
};

export const stagingObservabilityBackupLoadPreflightEvidence: StagingObservabilityBackupLoadPreflightEvidence = {
  id: "obl-preflight-staging-20260527T013207Z",
  environment: "staging",
  status: "passed",
  releaseSha: "d3b1107c33dc40b8936f28549e06553fbd7b104a",
  releaseGateCheckId: "staging_observability_backup_load",
  evidencePath: "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
  latestPreflightReport: "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
  canClearAggregateItem: true,
  preservedDoNotLaunchConditionId: "none",
  preservedReleaseGateCheckId: "none",
  slots: [
    {
      slot: "observability_evidence",
      evidencePath: "ops/evidence/staging/20260527T1830Z-observability-runtime.json",
      status: "verified",
      requiredEntries: [
        "alert_routes",
        "backend_worker_crawler_metrics",
        "dashboard_import",
        "opentelemetry_traces",
        "request_id_propagation",
        "structured_json_logs"
      ],
      verifiedEntries: [
        "alert_routes",
        "backend_worker_crawler_metrics",
        "dashboard_import",
        "opentelemetry_traces",
        "request_id_propagation",
        "structured_json_logs"
      ],
      missingEntries: [],
      blockingReason: "none",
      releaseGateUse: "The observability slot verifies dashboard import, alert routes, backend/worker/crawler metrics, request-id propagation, structured JSON log redaction, and OpenTelemetry trace linkage for the staging operations gate.",
      evidenceRefs: [
        "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
        "ops/evidence/staging/20260527T1830Z-observability-runtime.json",
        "ops/evidence/staging/20260526T1000Z-dashboard-runtime.json",
        "ops/evidence/staging/20260526T1000Z-alert-runtime.json",
        "ops/evidence/staging/20260527T1215Z-backend-worker-crawler-metrics.json",
        "ops/evidence/staging/20260527T1815Z-observability-telemetry.json"
      ]
    },
    {
      slot: "backup_restore_evidence",
      evidencePath: "ops/evidence/staging/20260527T2115Z-backup-restore.json",
      status: "verified",
      requiredEntries: ["object_restore", "postgres_restore"],
      verifiedEntries: ["object_restore", "postgres_restore"],
      missingEntries: [],
      blockingReason: "none",
      releaseGateUse: "The backup/restore slot verifies staging-scoped Postgres restore and object restore evidence for the same release SHA, including tenant isolation, RPO/RTO, manifest, QA, provenance, retention, and signed-download checks.",
      evidenceRefs: [
        "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
        "ops/evidence/staging/20260527T2115Z-backup-restore.json",
        "scripts/backup_restore_drill.sh",
        "ops/runbooks/stage0_ops.md",
        "ex-909",
        "au-007"
      ]
    },
    {
      slot: "load_evidence",
      evidencePath: "ops/evidence/staging/20260527T2120Z-load.json",
      status: "verified",
      requiredEntries: [
        "chat_task",
        "crawler_throttle",
        "quota_contention",
        "signed_download",
        "worker_generation",
        "workspace_rendering",
        "zip_export"
      ],
      verifiedEntries: [
        "chat_task",
        "crawler_throttle",
        "quota_contention",
        "signed_download",
        "worker_generation",
        "workspace_rendering",
        "zip_export"
      ],
      missingEntries: [],
      blockingReason: "none",
      releaseGateUse: "The load slot verifies chat/task, worker generation, ZIP export, signed download, crawler throttle, quota contention, and workspace rendering load entries for the same staging release SHA.",
      evidenceRefs: [
        "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
        "ops/evidence/staging/20260527T2120Z-load.json",
        "scripts/load_smoke.sh",
        "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
        "ops/evidence/staging/20260527T1100Z-crawler-governance-runtime.json",
        "au-019"
      ]
    },
    {
      slot: "post_deploy_smoke_evidence",
      evidencePath: "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json",
      status: "verified",
      requiredEntries: [
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
      ],
      verifiedEntries: [
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
      ],
      missingEntries: [],
      blockingReason: "none",
      releaseGateUse: "The post-deploy smoke slot verifies backend health, web, admin, auth boundary, worker task, export package, signed download, crawler admin, quota/rate-limit, and observability checks for the staging release SHA.",
      evidenceRefs: [
        "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json",
        "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json",
        "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
        "ops/evidence/staging/20260527T1830Z-observability-runtime.json",
        "au-007"
      ]
    }
  ],
  operatorAction: "Combined staging preflight passed; keep object-storage signed download/retention blocked until its release-gate check receives matching staging cleanup evidence.",
  releaseGateUse: "This admin preflight table proves the Private Beta/Staging observability/backup/load check can close from a single release-SHA-bound staging report while preserving the unrelated object-storage blocker."
};

export const stagingObjectStorageRetentionCleanupEvidence: StagingObjectStorageRetentionCleanupEvidence = {
  id: "stage1-object-retention-production-like-canonical",
  environment: "staging",
  status: "pass",
  reportKind: "canonical_pass",
  releaseGateCheckId: "staging_object_storage_signed_downloads",
  doNotLaunchConditionId: "object_storage_signed_retention_runtime_missing",
  evidencePath: "ops/evidence/staging/object-storage-retention-cleanup.json",
  requiredScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh",
  requiredArtifactPath: "ops/evidence/staging/object-storage-retention-cleanup.json",
  canonicalPassReportPath: "ops/evidence/staging/object-storage-retention-cleanup.json",
  canonicalPassResultsPath: "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
  blockedProbeReportPath: "ops/evidence/staging/object-storage-retention-cleanup.blocked.json",
  observedReportPath: "ops/evidence/staging/object-storage-retention-cleanup.json",
  signedUrlEvidencePath: "ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json",
  canClearRetentionCleanupChecklistItem: true,
  canClearReleaseGateCheck: true,
  coverage: [
    {
      area: "retention_policy",
      status: "pass",
      smokeScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh",
      adminEndpoint: "GET /api/admin/v1/object-storage/retention-policy",
      expectedTokens: ["retention policy", "versioning", "retention_until", "tenant"],
      releaseShaBound: true,
      adminIdentityBound: true,
      requestIdEchoStatus: "echoed",
      responseBytes: 667,
      blocker: "none",
      releaseGateUse: "The object-storage retention policy probe passed with release-SHA-bound staging evidence, admin identity binding, request-id echo, and canonical retention cleanup artifact references for private beta gate closure.",
      evidenceRefs: [
        "scripts/staging_object_storage_retention_cleanup_smoke.sh",
        "ops/evidence/staging/object-storage-retention-cleanup.json",
        "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json"
      ]
    },
    {
      area: "expired_export_cleanup",
      status: "pass",
      smokeScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh",
      adminEndpoint: "POST /api/admin/v1/object-storage/cleanup/expired-exports",
      expectedTokens: ["expired export cleanup", "deleted", "retained", "audit"],
      releaseShaBound: true,
      adminIdentityBound: true,
      requestIdEchoStatus: "echoed",
      responseBytes: 640,
      blocker: "none",
      releaseGateUse: "The expired export cleanup POST probe passed with deleted, retained, audit, CSRF, request-id echo, and immutable cleanup audit refs for private beta gate closure.",
      evidenceRefs: [
        "scripts/staging_object_storage_retention_cleanup_smoke.sh",
        "ops/evidence/staging/object-storage-retention-cleanup.json",
        "ex-909",
        "au-007"
      ]
    },
    {
      area: "orphan_cleanup",
      status: "pass",
      smokeScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh",
      adminEndpoint: "POST /api/admin/v1/object-storage/cleanup/orphans",
      expectedTokens: ["orphan cleanup", "deleted", "retained", "audit"],
      releaseShaBound: true,
      adminIdentityBound: true,
      requestIdEchoStatus: "echoed",
      responseBytes: 632,
      blocker: "none",
      releaseGateUse: "The orphan cleanup POST probe passed with deleted, retained, audit, CSRF, request-id echo, and immutable cleanup audit refs for private beta gate closure.",
      evidenceRefs: [
        "scripts/staging_object_storage_retention_cleanup_smoke.sh",
        "ops/evidence/staging/object-storage-retention-cleanup.json",
        "ops/evidence/staging/20260527T2115Z-backup-restore.json",
        "au-015"
      ]
    },
    {
      area: "audit_refs",
      status: "pass",
      smokeScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh",
      adminEndpoint: "GET /api/admin/v1/audit?subject=object_storage_cleanup&limit=20",
      expectedTokens: ["audit", "object_storage_cleanup", "admin", "tenant"],
      releaseShaBound: true,
      adminIdentityBound: true,
      requestIdEchoStatus: "echoed",
      responseBytes: 27398,
      blocker: "none",
      releaseGateUse: "The audit refs probe passed and linked expired-export and orphan-cleanup request IDs to immutable admin audit refs, proving cleanup operations are release-gate visible.",
      evidenceRefs: [
        "scripts/staging_object_storage_retention_cleanup_smoke.sh",
        "ops/evidence/staging/object-storage-retention-cleanup.json",
        "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
        "au-007",
        "au-015"
      ]
    }
  ],
  missingRuntimeInputs: [],
  operatorAction: "Exact staging retention cleanup evidence is passing; keep the blocked probe report visible only as historical diagnostic evidence.",
  releaseGateUse: "This admin evidence row proves exact staging retention cleanup passed and can clear the object-storage release gate check when paired with signed URL evidence.",
  remainingReleaseGateBlockers: []
};

export const releaseBlockers: ReleaseBlocker[] = [
  {
    id: "rb-private-beta-provider-slo",
    gate: "private_beta",
    blockerKind: "dashboard_slo",
    status: "open",
    severity: "sev2",
    ownerRole: "admin_operator",
    dashboardId: "od-provider-latency",
    alertRouteId: "al-provider-error",
    runtimeEvidenceRef: "staging-dashboard-provider-20260526T1000Z",
    releaseEvidenceId: "eg-003",
    blockingSignal: "Provider p95 latency and error rate breach the private beta provider SLO even though the alert route probe delivered successfully.",
    requiredEvidence: "Attach a healthy provider dashboard window, provider usage reconciliation, verified alert route probe, and immutable provider-routing audit before beta access expands.",
    unblockCriteria: "Provider latency stays <= 8000 ms, error rate stays <= 4%, spend reconciliation is complete, and release evidence eg-003 changes from blocked to reviewed.",
    nextReviewAt: "2026-05-26 12:00",
    auditRef: "au-007",
    evidenceRefs: ["od-provider-latency", "al-provider-error", "eg-003", "ph-1", "au-007", "staging-dashboard-provider-20260526T1000Z"]
  },
  {
    id: "rb-production-admin-security",
    gate: "production_launch",
    blockerKind: "alert_route",
    status: "open",
    severity: "sev1",
    ownerRole: "admin_superadmin",
    dashboardId: "od-admin-security",
    alertRouteId: "al-admin-security",
    runtimeEvidenceRef: "staging-alert-admin-security-20260526T1030Z",
    releaseEvidenceId: "eg-002",
    blockingSignal: "Critical hidden prompt extraction investigation keeps the admin-security dashboard blocked despite verified SEV1 alert routing.",
    requiredEvidence: "Security-admin closure must include prompt-fragment activation block evidence, temporary-hold release evidence, trace redaction proof, second review, and immutable audit.",
    unblockCriteria: "Abuse event ab-304 closes under superadmin review, trace redaction has no open violations, and production release evidence no longer depends on incomplete high-risk review.",
    nextReviewAt: "2026-05-26 11:30",
    auditRef: "au-008",
    evidenceRefs: ["od-admin-security", "al-admin-security", "eg-002", "ab-304", "tr-1004", "au-008", "staging-alert-admin-security-20260526T1030Z"]
  },
  {
    id: "rb-production-crawler-derivative",
    gate: "production_launch",
    blockerKind: "runtime_evidence",
    status: "mitigating",
    severity: "sev3",
    ownerRole: "admin_reviewer",
    dashboardId: "od-crawler-policy",
    alertRouteId: "al-crawler-policy",
    runtimeEvidenceRef: "staging-dashboard-crawler-20260526T1000Z",
    releaseEvidenceId: "eg-002",
    blockingSignal: "Crawler derivative review remains open, so crawler-derived prompt or skill activation cannot use verified alert delivery as launch evidence.",
    requiredEvidence: "Close takedown or derivative review with source contact, raw deletion or retention decision, provenance links, and audit before activation can proceed.",
    unblockCriteria: "Governance workflow cg-501 reaches approved or deleted state, crawler finding cf-118 cannot activate without provenance, and release gate evidence cites the closure audit.",
    nextReviewAt: "2026-05-26 13:00",
    auditRef: "au-012",
    evidenceRefs: ["od-crawler-policy", "al-crawler-policy", "eg-002", "cf-118", "cg-501", "au-012", "staging-dashboard-crawler-20260526T1000Z"]
  },
  {
    id: "rb-private-beta-legal-support-visibility",
    gate: "private_beta",
    blockerKind: "runtime_evidence",
    status: "open",
    severity: "sev2",
    ownerRole: "admin_reviewer",
    dashboardId: "od-legal-support-visibility",
    alertRouteId: "al-legal-support-visibility",
    runtimeEvidenceRef: "staging-dashboard-legal-support-20260527T2200Z",
    releaseEvidenceId: "eg-005",
    blockingSignal:
      "Private beta external-user legal/support visibility is blocked because canonical split evidence currently records missing_staging_web_url diagnostics instead of deployed external-user HTTP probes.",
    requiredEvidence:
      "Run scripts/staging_legal_support_visibility_smoke.sh with STAGING_WEB_URL and preserve passing output at ops/evidence/staging/legal-pages-external-user.json plus ops/evidence/staging/support-contact-external-user.json proving Terms, Privacy, Acceptable Use, AI/content disclaimer, IP complaint flow, visible support contact, report-problem path, and admin support linkage.",
    unblockCriteria:
      "Both legal_pages_visibility and support_contact_visibility coverage areas pass from external-user HTTP probes, the private beta gate fixture removes external_user_legal_pages_missing, and object-storage retention remains represented as a separate private-beta blocker until its own pass evidence exists.",
    nextReviewAt: "2026-05-28 09:00",
    auditRef: "au-020",
    evidenceRefs: [
      "od-legal-support-visibility",
      "al-legal-support-visibility",
      "eg-005",
      "au-020",
      "staging-dashboard-legal-support-20260527T2200Z",
      "ops/evidence/staging/legal-pages-external-user.json",
      "ops/evidence/staging/support-contact-external-user.json"
    ]
  }
];

export const operationsIncidentRunbookContract: OperationsIncidentRunbookContract = {
  schema: "stage1.operations-incident-runbook-local-contract.v1",
  contractId: "stage1.operations-incident-runbook-local-contract",
  routeMarker: "stage1.operations-incident-runbook-local-contract",
  blueprintItems: ["AD-11", "OP-8", "OP-10", "OP-11", "VF-6", "VF-7"],
  adminRoute: "admin/app/operations/page.tsx",
  evidenceSource: "admin fixture local contract",
  requiredIncidentFields: [
    "severity",
    "status",
    "customerImpact",
    "mitigation",
    "owner",
    "nextUpdateAt",
    "linkedQueues",
    "linkedSupportTickets",
    "auditRefs",
    "rollbackPlan"
  ],
  requiredAlertRouteFields: [
    "severity",
    "threshold",
    "routeTarget",
    "escalationRole",
    "runbook",
    "incidentRef",
    "auditRef",
    "runtimeEvidenceRef"
  ],
  requiredRollbackEvidenceRefs: [
    "ops/evidence/production/backup-restore.json",
    "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
    "ops/evidence/production/backup-rollback-split.blocked.json"
  ],
  preservedDoNotLaunchConditions: [
    "staging_observability_restore_load_missing",
    "object_storage_signed_retention_runtime_missing",
    "production_backup_rollback_incident",
    "production_paid_billing_lifecycle"
  ],
  blockedGateChecks: [
    "staging_observability_backup_load",
    "staging_object_storage_signed_downloads",
    "production_backup_rollback_incident",
    "production_paid_billing_lifecycle"
  ],
  actionMatrix: [
    {
      actionId: "ops-runbook-acknowledge-alert",
      action: "acknowledge",
      sourceSurface: "alert_route",
      requiredRole: "admin_operator",
      status: "ready_for_review",
      operatorBoundary:
        "Acknowledge can record alert ownership only; it cannot change release gate decisions without exact validator evidence.",
      requiredEvidenceRefs: ["staging-alert-provider-20260526T1000Z", "au-007"],
      auditRef: "au-007"
    },
    {
      actionId: "ops-runbook-escalate-security",
      action: "escalate",
      sourceSurface: "release_blocker",
      requiredRole: "admin_superadmin",
      status: "blocked_by_do_not_launch",
      operatorBoundary:
        "SEV1 admin-security escalation preserves production launch blockers until abuse, trace redaction, second review, and immutable audit evidence close.",
      requiredEvidenceRefs: ["rb-production-admin-security", "ab-304", "tr-1004", "au-008"],
      auditRef: "au-008"
    },
    {
      actionId: "ops-runbook-rollback-export",
      action: "rollback",
      sourceSurface: "incident_log",
      requiredRole: "admin_reviewer",
      status: "blocked_until_evidence",
      operatorBoundary:
        "Rollback guidance is visible, but production backup/rollback launch rows require exact split files and upstream CI/Staging go evidence.",
      requiredEvidenceRefs: [
        "inc-20260526-queue",
        "ops/evidence/production/backup-restore.json",
        "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
        "au-004"
      ],
      auditRef: "au-004"
    },
    {
      actionId: "ops-runbook-maintenance-banner",
      action: "maintenance_banner",
      sourceSurface: "maintenance_banner",
      requiredRole: "support_operator",
      status: "ready_for_review",
      operatorBoundary:
        "Banner approval can notify private beta users, but it cannot resolve the linked incident or clear staging/runtime blockers.",
      requiredEvidenceRefs: ["mb-exports-20260526", "sup-2204", "au-004"],
      auditRef: "au-004"
    },
    {
      actionId: "ops-runbook-support-update",
      action: "support_update",
      sourceSurface: "incident_log",
      requiredRole: "support_operator",
      status: "blocked_until_evidence",
      operatorBoundary:
        "Support updates must cite redacted tickets and quota/refund audit refs before an incident can move toward resolution.",
      requiredEvidenceRefs: ["sup-2201", "sup-2204", "au-004"],
      auditRef: "au-004"
    }
  ],
  canClearStagingGate: false,
  canClearProductionGate: false,
  canCloseDoNotLaunch: false,
  manualGoControlsEnabled: false
};

export const queueHealth: QueueHealth[] = [
  {
    id: "q-brief",
    name: "brief-orchestration",
    pending: 18,
    running: 4,
    deadLetters: 1,
    oldestAgeMinutes: 22,
    action: "Inspect stalled missing-info clarification.",
    retryPolicy: "Retry only after support confirms the missing brief fields are present.",
    cancelPolicy: "Cancel stale clarification tasks after timeout and preserve user-visible message.",
    idempotencyScope: "task id plus support ticket id; duplicate retry requests reuse the existing task attempt and cannot create a second quota reservation.",
    retryBackoffPolicy: "Manual retry starts after 5 minutes, doubles once, and stops at the max retry count or any safety/export block.",
    ownerRole: "support_operator",
    linkedIncident: "none",
    auditRef: "au-011"
  },
  {
    id: "q-export",
    name: "export-packaging",
    pending: 7,
    running: 2,
    deadLetters: 3,
    oldestAgeMinutes: 84,
    action: "Regenerate eligible failed packages.",
    retryPolicy: "Retry failed packaging only when manifest, QA report, and quota refund evidence are attached.",
    cancelPolicy: "Cancel blocked exports when safety action is not override eligible.",
    idempotencyScope: "package id plus export id plus Idempotency-Key; regenerated packages preserve the original failed export for audit.",
    retryBackoffPolicy: "Retry once immediately after QA evidence is attached, then require admin reviewer approval for any additional attempt.",
    ownerRole: "admin_reviewer",
    linkedIncident: "inc-20260526-queue",
    auditRef: "au-004"
  },
  {
    id: "q-crawler",
    name: "crawler-findings",
    pending: 31,
    running: 1,
    deadLetters: 5,
    oldestAgeMinutes: 240,
    action: "Review source blocklist and retry approved hosts.",
    retryPolicy: "Retry crawler import only after robots, ownership, and source allowlist evidence pass.",
    cancelPolicy: "Cancel or delete findings when takedown or derivative review blocks use.",
    idempotencyScope: "crawler source id plus normalized URL hash; duplicate imports stay in governance review rather than fetching again.",
    retryBackoffPolicy: "Crawler retry is disabled while ownership or robots evidence is missing, then resumes at one source per minute.",
    ownerRole: "admin_operator",
    linkedIncident: "inc-20260525-crawler",
    auditRef: "au-002"
  }
];

export const stage1BatchQueueRuntime: Stage1BatchQueueRuntime[] = [
  {
    id: "stage1-batch-runtime-four",
    batchId: "batch_four",
    tenantId: "tenant_1",
    projectId: "project_1",
    workspaceId: "workspace_1",
    status: "running",
    requestedCount: 4,
    queued: 1,
    running: 1,
    succeeded: 1,
    failed: 1,
    cancelled: 0,
    blocked: 0,
    retryable: 1,
    workerId: "worker_stage1_local_1",
    claimTimeoutSeconds: 900,
    oldestChildAgeMinutes: 12,
    providerId: "zenari-image-sandbox",
    modelId: "image-fast-v1",
    toolType: "image.generate",
    providerStrategyGroupId: "image-generation-default",
    providerSelectionPolicy: "weighted",
    providerConcurrency: "1/4 provider slots used",
    providerModelConcurrency: "1/4 provider-model slots used",
    claimLeasePolicy: "Expired running children with zero committed/refunded quota are requeued before the next claim.",
    drainPolicy: "BatchRunner.Drain stops new claims during worker shutdown while already claimed children finish or expire by claim lease.",
    quotaPolicy: "Reserve estimate on create, commit actual provider usage on success, and refund remainder on failure, cancel, or safety block.",
    deadLetterPolicy: "Retryable failures requeue until max retry count; exhausted or non-retryable failures dead-letter and refund remaining reserved quota.",
    idempotencyScope: "batch_child:<child_id>:retry:<retry_count> provider requests plus retry-attempt quota idempotency.",
    nextOperatorAction: "Inspect failed child retry budget, provider health, and quota ledger before manually retrying.",
    auditRef: "au-011",
    evidenceRefs: [
      "fixtures/stage1/batch_generation/four_variants.json",
      "scripts/validate_stage1_batch_generation_contract.py",
      "backend/internal/task/batch_scheduler.go",
      "backend/internal/worker/batch_runner.go",
      "backend/internal/worker/batch_quota_runtime_replay_test.go"
    ]
  },
  {
    id: "stage1-batch-runtime-safety",
    batchId: "batch_partial",
    tenantId: "tenant_1",
    projectId: "project_1",
    workspaceId: "workspace_1",
    status: "partial_succeeded",
    requestedCount: 4,
    queued: 0,
    running: 0,
    succeeded: 2,
    failed: 1,
    cancelled: 0,
    blocked: 1,
    retryable: 0,
    workerId: "worker_stage1_local_1",
    claimTimeoutSeconds: 900,
    oldestChildAgeMinutes: 34,
    providerId: "zenari-image-sandbox",
    modelId: "image-fast-v1",
    toolType: "image.generate",
    providerStrategyGroupId: "image-generation-default",
    providerSelectionPolicy: "failover",
    providerConcurrency: "0/4 provider slots used",
    providerModelConcurrency: "0/4 provider-model slots used",
    claimLeasePolicy: "No claim lease is active after terminal children commit, refund, or block.",
    drainPolicy: "Drained worker preserves terminal child state and relies on idempotency keys for any later retry.",
    quotaPolicy: "Blocked and failed children refund unused reserved quota before provider retry or manual review.",
    deadLetterPolicy: "The provider failure exhausted retry budget and the safety-blocked child is not dead-lettered.",
    idempotencyScope: "Manual retry creates a new retry attempt key while preserving the original terminal audit trail.",
    nextOperatorAction: "Review safety block reason and dead-lettered provider failure before approving any retry.",
    auditRef: "au-001",
    evidenceRefs: [
      "fixtures/stage1/batch_generation/partial_failure.json",
      "fixtures/stage1/safety_qa_eval/local_contract.json",
      "scripts/validate_stage1_safety_qa_evidence.py",
      "backend/internal/task/batch_executor.go",
      "backend/internal/task/batch_repository.go"
    ]
  }
];

export const stage1BatchChildTasks: Stage1BatchChildTask[] = [
  {
    id: "child_four_1",
    batchId: "batch_four",
    tenantId: "tenant_1",
    status: "succeeded",
    providerId: "zenari-image-sandbox",
    modelId: "image-fast-v1",
    toolType: "image.generate",
    retryCount: 0,
    maxRetries: 2,
    workerId: "worker_stage1_local_1",
    claimAttempt: 1,
    claimExpiresAt: "2026-06-21T12:15:00Z",
    fanoutStage: "provider_execution_succeeded",
    failureCode: "none",
    reviewReason: "none",
    quotaEstimateUnits: 4,
    quotaCommittedUnits: 4,
    quotaRefundedUnits: 0,
    retryState: "not_applicable",
    deadLetterState: "not_dead_lettered",
    resultAssetId: "asset_four_1",
    canvasObjectId: "object_four_1",
    visibleTraceRef: "trace_projection_child_four_1",
    providerUsageRef: "provider_usage_child_four_1",
    idempotencyKey: "batch_child:child_four_1:retry:0",
    operatorAction: "No action; success has asset, canvas object, trace projection, and provider usage.",
    auditRef: "au-011",
    evidenceRefs: ["fixtures/stage1/batch_generation/four_variants.json", "backend/internal/task/batch_result_sink.go"]
  },
  {
    id: "child_four_3",
    batchId: "batch_four",
    tenantId: "tenant_1",
    status: "failed",
    providerId: "zenari-image-sandbox",
    modelId: "image-fast-v1",
    toolType: "image.generate",
    retryCount: 1,
    maxRetries: 2,
    workerId: "worker_stage1_local_1",
    claimAttempt: 2,
    claimExpiresAt: "2026-06-21T12:30:00Z",
    fanoutStage: "provider_execution_failed",
    failureCode: "provider_unavailable",
    reviewReason: "none",
    quotaEstimateUnits: 4,
    quotaCommittedUnits: 0,
    quotaRefundedUnits: 0,
    retryState: "retry_available",
    deadLetterState: "not_dead_lettered",
    resultAssetId: "none",
    canvasObjectId: "none",
    visibleTraceRef: "trace_projection_child_four_3",
    providerUsageRef: "provider_usage_child_four_3_failed",
    idempotencyKey: "batch_child:child_four_3:retry:1",
    operatorAction: "Retry is available after provider health and strategy group capacity are checked.",
    auditRef: "au-011",
    evidenceRefs: ["fixtures/stage1/batch_generation/four_variants.json", "backend/internal/task/batch_retry.go"]
  },
  {
    id: "child_partial_3",
    batchId: "batch_partial",
    tenantId: "tenant_1",
    status: "failed",
    providerId: "zenari-image-sandbox",
    modelId: "image-fast-v1",
    toolType: "image.generate",
    retryCount: 2,
    maxRetries: 2,
    workerId: "worker_stage1_local_1",
    claimAttempt: 3,
    claimExpiresAt: "2026-06-21T12:45:00Z",
    fanoutStage: "provider_execution_failed",
    failureCode: "provider_unavailable",
    reviewReason: "none",
    quotaEstimateUnits: 4,
    quotaCommittedUnits: 0,
    quotaRefundedUnits: 4,
    retryState: "retry_exhausted",
    deadLetterState: "dead_lettered",
    resultAssetId: "none",
    canvasObjectId: "none",
    visibleTraceRef: "trace_projection_child_partial_3",
    providerUsageRef: "provider_usage_child_partial_3_failed",
    idempotencyKey: "batch_child:child_partial_3:retry:2",
    operatorAction: "Dead letter requires manual review before retry because quota was refunded at terminal failure.",
    auditRef: "au-004",
    evidenceRefs: ["fixtures/stage1/batch_generation/partial_failure.json", "scripts/validate_stage1_batch_quota_reconciliation.py"]
  },
  {
    id: "child_partial_4",
    batchId: "batch_partial",
    tenantId: "tenant_1",
    status: "blocked",
    providerId: "zenari-image-sandbox",
    modelId: "image-fast-v1",
    toolType: "image.generate",
    retryCount: 0,
    maxRetries: 0,
    workerId: "worker_stage1_local_1",
    claimAttempt: 1,
    claimExpiresAt: "2026-06-21T12:15:00Z",
    fanoutStage: "safety_gate_blocked",
    failureCode: "none",
    reviewReason: "safety_review_required",
    quotaEstimateUnits: 4,
    quotaCommittedUnits: 0,
    quotaRefundedUnits: 4,
    retryState: "not_retryable",
    deadLetterState: "not_dead_lettered",
    resultAssetId: "none",
    canvasObjectId: "none",
    visibleTraceRef: "trace_projection_child_partial_4",
    providerUsageRef: "none",
    idempotencyKey: "batch_child:child_partial_4:retry:0",
    operatorAction: "Safety review must clear before any provider invocation; quota has already been refunded.",
    auditRef: "au-001",
    evidenceRefs: ["fixtures/stage1/batch_generation/partial_failure.json", "fixtures/stage1/safety_qa_eval/local_contract.json"]
  }
];

export const failedTaskControls: FailedTaskControl[] = [
  {
    id: "task-brief-441",
    queueId: "q-brief",
    queueAttemptId: "qa-task-brief-441-hold-v3",
    queueAttemptDigest: "sha256:queue-attempt-task-brief-441-hold-v3",
    observedQueueAttemptDigest: "sha256:queue-attempt-task-brief-441-hold-v3",
    userId: "usr-301",
    projectId: "proj-774",
    traceId: "tr-1004",
    supportTicketId: "sup-2201",
    status: "blocked",
    retryCount: 3,
    maxRetries: 3,
    timeoutSeconds: 900,
    errorCode: "SAFETY_EXPORT_BLOCK",
    userMessage: "Export remains blocked because final QA found a forbidden claim.",
    appVersion: "admin-0.0.0",
    workerVersion: "worker-2026.05.26",
    schemaVersion: "task.v1",
    preActionStateDigest: "sha256:failed-task-task-brief-441-blocked-v3",
    observedStateDigest: "sha256:failed-task-task-brief-441-blocked-v3",
    requestedAction: "hold",
    actionEligibility: "blocked",
    allowedRole: "admin_reviewer",
    requestedByRole: "support_operator",
    requestedByAdminId: "adm-support-104",
    rbacDecision: "denied",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    secondReviewerAdminId: "none",
    secondReviewAuditRef: "none",
    secondReviewEvidenceRefs: [],
    idempotencyKey: "hold:task-brief-441:sup-2201:au-001",
    quotaEffect: "refund_pending",
    regressionFixtureRef: "none-safety-hold",
    abuseControlHookRefs: ["hook-ab-300-hold"],
    closureEvidenceRefs: ["sup-2201", "tr-1004", "ex-887", "au-001", "au-004", "au-006"],
    rbacEvidenceRefs: ["rbac-export-001", "rbac-safety-001"],
    operatorRunbook: "Do not retry. Keep the task blocked, preserve the QA report, and apply audited quota credit only after support review.",
    auditRef: "au-001"
  },
  {
    id: "task-export-489",
    queueId: "q-export",
    queueAttemptId: "qa-task-export-489-retry-v1",
    queueAttemptDigest: "sha256:queue-attempt-task-export-489-retry-v1",
    observedQueueAttemptDigest: "sha256:queue-attempt-task-export-489-retry-v1",
    userId: "usr-318",
    projectId: "proj-790",
    traceId: "tr-1019",
    supportTicketId: "sup-2204",
    status: "failed",
    retryCount: 1,
    maxRetries: 3,
    timeoutSeconds: 600,
    errorCode: "EXPORT_MANIFEST_QA_REPORT_MISSING",
    userMessage: "The export package is being regenerated with the missing QA report.",
    appVersion: "admin-0.0.0",
    workerVersion: "worker-2026.05.26",
    schemaVersion: "task.v1",
    preActionStateDigest: "sha256:failed-task-task-export-489-failed-v1",
    observedStateDigest: "sha256:failed-task-task-export-489-failed-v1",
    requestedAction: "retry",
    actionEligibility: "eligible",
    allowedRole: "support_operator",
    requestedByRole: "support_operator",
    requestedByAdminId: "adm-support-104",
    rbacDecision: "allowed",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    secondReviewerAdminId: "none",
    secondReviewAuditRef: "none",
    secondReviewEvidenceRefs: [],
    idempotencyKey: "retry:task-export-489:sup-2204:manifest-missing",
    quotaEffect: "reserved_credit_released",
    regressionFixtureRef: "fixtures/stage0/rev2/regressions/failed_task_retry_task_export_489.json",
    abuseControlHookRefs: [],
    closureEvidenceRefs: ["task-export-489", "sup-2204", "tr-1019", "ex-901", "au-011", "au-001", "au-004"],
    rbacEvidenceRefs: ["rbac-export-001", "rbac-quota-001"],
    operatorRunbook: "Attach ticket sup-2204, verify QA warning evidence, retry once, and write the resulting audit ref before closure.",
    auditRef: "au-011"
  },
  {
    id: "task-crawler-019",
    queueId: "q-crawler",
    queueAttemptId: "qa-task-crawler-019-cancel-v0",
    queueAttemptDigest: "sha256:queue-attempt-task-crawler-019-cancel-v0",
    observedQueueAttemptDigest: "sha256:queue-attempt-task-crawler-019-cancel-v0",
    userId: "usr-455",
    projectId: "proj-812",
    traceId: "none",
    supportTicketId: "sup-2212",
    status: "cancelled",
    retryCount: 0,
    maxRetries: 1,
    timeoutSeconds: 1200,
    errorCode: "CRAWLER_SOURCE_OWNERSHIP_MISSING",
    userMessage: "Crawler import is cancelled until source ownership and robots evidence are reviewed.",
    appVersion: "admin-0.0.0",
    workerVersion: "crawler-2026.05.26",
    schemaVersion: "task.v1",
    preActionStateDigest: "sha256:failed-task-task-crawler-019-cancelled-v0",
    observedStateDigest: "sha256:failed-task-task-crawler-019-cancelled-v0",
    requestedAction: "cancel",
    actionEligibility: "requires_review",
    allowedRole: "admin_operator",
    requestedByRole: "admin_operator",
    requestedByAdminId: "adm-ops-212",
    rbacDecision: "second_review_required",
    secondReviewRequired: true,
    secondReviewStatus: "pending",
    secondReviewerAdminId: "adm-reviewer-317",
    secondReviewAuditRef: "au-012",
    secondReviewEvidenceRefs: ["au-012", "rbac-crawler-001", "cg-501", "cf-118"],
    idempotencyKey: "cancel:task-crawler-019:sup-2212:ownership-missing",
    quotaEffect: "none",
    regressionFixtureRef: "fixtures/stage0/rev2/regressions/failed_task_cancel_task_crawler_019.json",
    abuseControlHookRefs: ["hook-ab-309-throttle"],
    closureEvidenceRefs: ["task-crawler-019", "sup-2212", "ab-309", "q-crawler", "au-002", "au-012"],
    rbacEvidenceRefs: ["rbac-crawler-001"],
    operatorRunbook: "Keep the source import cancelled, request ownership proof, and reopen only after crawler review evidence is attached.",
    auditRef: "au-002"
  },
  {
    id: "task-crawler-122",
    queueId: "q-crawler",
    queueAttemptId: "qa-task-crawler-122-cancel-v1",
    queueAttemptDigest: "sha256:queue-attempt-task-crawler-122-cancel-v1",
    observedQueueAttemptDigest: "sha256:queue-attempt-task-crawler-122-cancel-v1",
    userId: "usr-455",
    projectId: "proj-812",
    traceId: "none",
    supportTicketId: "sup-2215",
    status: "cancelled",
    retryCount: 0,
    maxRetries: 1,
    timeoutSeconds: 1200,
    errorCode: "CRAWLER_DERIVATIVE_REVIEW_APPROVED_CANCEL",
    userMessage: "Crawler import is cancelled and closure-ready after derivative review approved provenance and retention limits.",
    appVersion: "admin-0.0.0",
    workerVersion: "crawler-2026.05.26",
    schemaVersion: "task.v1",
    preActionStateDigest: "sha256:failed-task-task-crawler-122-cancelled-v1",
    observedStateDigest: "sha256:failed-task-task-crawler-122-cancelled-v1",
    requestedAction: "cancel",
    actionEligibility: "eligible",
    allowedRole: "admin_reviewer",
    requestedByRole: "admin_reviewer",
    requestedByAdminId: "adm-reviewer-317",
    rbacDecision: "allowed",
    secondReviewRequired: true,
    secondReviewStatus: "approved",
    secondReviewerAdminId: "legal-admin",
    secondReviewAuditRef: "au-013",
    secondReviewEvidenceRefs: ["au-013", "rbac-crawler-001", "cg-522", "cf-122"],
    idempotencyKey: "cancel:task-crawler-122:sup-2215:derivative-reviewed",
    quotaEffect: "none",
    regressionFixtureRef: "fixtures/stage0/rev2/regressions/failed_task_cancel_task_crawler_122.json",
    abuseControlHookRefs: [],
    closureEvidenceRefs: ["task-crawler-122", "sup-2215", "cf-122", "cg-522", "q-crawler", "au-012", "au-013"],
    rbacEvidenceRefs: ["rbac-crawler-001"],
    operatorRunbook: "Submit the audited cancel closure once, preserve derivative provenance and retention evidence, and keep exact-text import blocked.",
    auditRef: "au-013"
  }
];

export const stagingSupportRetryAbuseEvidence: StagingSupportRetryAbuseEvidence = {
  id: "staging_support_retry_abuse_20260527T1000Z",
  evidencePath: "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
  environment: "staging",
  status: "pass",
  validatedAt: "2026-05-27T10:00:00Z",
  validatedByRole: "admin_reviewer",
  releaseGateCheckId: "staging_support_retry_abuse_ops",
  doNotLaunchConditionId: "support_abuse_runtime_missing",
  runtimeRequestIds: [
    "staging-support-retry-abuse-20260527T1000Z-ticket-linkage",
    "staging-support-retry-abuse-20260527T1000Z-retry-cancel",
    "staging-support-retry-abuse-20260527T1000Z-hold-throttle",
    "staging-support-retry-abuse-20260527T1000Z-audit-rbac"
  ],
  supportTicketIds: ["sup-2201", "sup-2204", "sup-2209", "sup-2212", "sup-2215"],
  failedTaskIds: ["task-brief-441", "task-export-489", "task-crawler-019", "task-crawler-122"],
  abuseEventIds: ["ab-300", "ab-304", "ab-309"],
  abuseHookIds: ["hook-ab-300-hold", "hook-ab-304-hold", "hook-ab-309-throttle"],
  coverage: [
    {
      area: "support_ticket_linkage",
      status: "pass",
      runtimeProbe:
        "External-user staging support probe opened linked tickets through the admin console and verified user, project, task, trace, export, quota transaction, and audit references remained tenant-scoped and visible to the assigned support role.",
      externalUserEvidence:
        "The staging support console lookup replay used external-user tickets with read-only profile access and mutation actions gated by role-specific lookup decisions.",
      rbacAuditEvidence:
        "Support lookup actions preserved audit refs au-001, au-002, au-004, and au-011 and denied temporary-hold mutation for support_operator without reviewer evidence.",
      linkedAdminArtifacts: ["admin/app/support/page.tsx", "admin/lib/fixtures.ts:supportTickets", "admin/lib/fixtures.ts:supportUsers"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
        "admin/app/support/page.tsx",
        "admin/lib/fixtures.ts",
        "sup-2201",
        "sup-2212",
        "au-001",
        "au-002"
      ]
    },
    {
      area: "failed_task_retry_cancel",
      status: "pass",
      runtimeProbe:
        "External-user staging retry probe allowed retry:task-export-489:sup-2204:manifest-missing once with reserved credit release, allowed approved cancel:task-crawler-122:sup-2215:derivative-reviewed, blocked stale digest, exhausted retry budget, and missing support-ticket replays, kept hold:task-brief-441:sup-2201:au-001 denied, and required second review for cancel:task-crawler-019:sup-2212:ownership-missing.",
      externalUserEvidence:
        "The failed-task queue replay covered retry, cancel, and hold decisions with user-visible messages, stable idempotency keys, state-digest preservation, retry-budget enforcement, support-ticket linkage, and tenant/trace scope checks for support-facing closure.",
      rbacAuditEvidence:
        "Retry, cancel, stale replay, exhausted retry, missing ticket, and hold outcomes linked to immutable audit refs au-001, au-002, and au-011 plus RBAC evidence rbac-export-001, rbac-quota-001, rbac-safety-001, and rbac-crawler-001 for support ticket, trace, export, queue, abuse, quota, safety, and crawler controls.",
      linkedAdminArtifacts: ["admin/app/queues/page.tsx", "admin/lib/fixtures.ts:failedTaskControls", "admin/tests/admin-governance.test.mjs"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
        "task-brief-441",
        "task-export-489",
        "task-crawler-019",
        "task-crawler-122",
        "sup-2215",
        "rbac-export-001",
        "rbac-quota-001",
        "rbac-crawler-001",
        "q-export",
        "q-crawler",
        "au-011"
      ]
    },
    {
      area: "abuse_hold_throttle",
      status: "pass",
      runtimeProbe:
        "External-user staging abuse replay enforced hook-ab-300-hold as 423 account_hold, kept hook-ab-304-hold as dry_run_denied pending admin_superadmin review, and enforced hook-ab-309-throttle as 429 rate_limited with crawler queue throttled until review.",
      externalUserEvidence:
        "Account-level hold and throttle probes blocked quota-consuming task creation while preserving read-only project access, account settings, and support contact surfaces.",
      rbacAuditEvidence:
        "Runtime decisions preserved required role, attempted role, RBAC decision, expiry, support ticket linkage, release evidence refs, and audit refs for every hold/throttle hook.",
      linkedAdminArtifacts: ["admin/app/abuse/page.tsx", "admin/lib/abuse-runtime.ts", "admin/lib/fixtures.ts:abuseControlHooks"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
        "hook-ab-300-hold",
        "hook-ab-304-hold",
        "hook-ab-309-throttle",
        "ab-300",
        "ab-304",
        "ab-309",
        "au-008"
      ]
    },
    {
      area: "abuse_queue_closure",
      status: "pass",
      runtimeProbe:
        "External-user staging abuse queue probe kept all controlled and RBAC-blocked abuse events open until runtime controls, assigned role, immutable audit refs, second review where required, and release evidence all agreed.",
      externalUserEvidence:
        "The admin abuse queue replay verified closureAllowed=false for controlled, queued, and RBAC-blocked entries so support cannot close high-risk abuse without release evidence.",
      rbacAuditEvidence:
        "Queue closure blocking linked abuse events to au-002, au-008, support ticket evidence, trace evidence, export evidence, and crawler finding evidence.",
      linkedAdminArtifacts: ["admin/app/abuse/page.tsx", "admin/lib/abuse-runtime.ts", "admin/tests/admin-governance.test.mjs"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1000Z-support-retry-abuse.json",
        "ab-300",
        "ab-304",
        "ab-309",
        "sup-2201",
        "sup-2212",
        "au-002",
        "au-008"
      ]
    }
  ],
  gateImpact: {
    checklistItem: "Private Beta/Staging support/retry/abuse runtime evidence 通过。",
    canClearCheckLevelItem: true,
    aggregatePrivateBetaGateStatus: "go",
    remainingBlockers: []
  }
};

export const stagingLegalSupportVisibilityEvidence: StagingLegalSupportVisibilityEvidence = {
  id: "staging_legal_support_visibility_20260527T2230Z",
  environment: "staging",
  status: "pass",
  validatedAt: "2026-05-27T22:30:00Z",
  validatedByRole: "admin_reviewer",
  releaseGateCheckId: "staging_legal_external_user_pages",
  doNotLaunchConditionId: "external_user_legal_pages_missing",
  legalPageEvidencePath: "ops/evidence/staging/legal-pages-external-user.json",
  supportContactEvidencePath: "ops/evidence/staging/support-contact-external-user.json",
  runtimeRequestIds: [
    "staging-legal-support-20260527T2230Z-terms",
    "staging-legal-support-20260527T2230Z-privacy",
    "staging-legal-support-20260527T2230Z-acceptable-use",
    "staging-legal-support-20260527T2230Z-ai-disclaimer",
    "staging-legal-support-20260527T2230Z-ip-complaint",
    "staging-legal-support-20260527T2230Z-support-contact",
    "staging-legal-support-20260527T2230Z-report-problem"
  ],
  auditRefs: ["au-020"],
  coverage: [
    {
      area: "legal_pages_visibility",
      status: "pass",
      runtimeProbe:
        "External-user staging HTTP probes passed for legal pages, support, and policy routes; the canonical legal-pages split records deployed route responses rather than source-only evidence.",
      externalUserEvidence:
        "ops/evidence/staging/legal-pages-external-user.json records passing checks for /legal/terms, /legal/privacy, /legal/acceptable-use, /legal/ip-complaints, and /support with no active blocked checks.",
      policyEvidence:
        "The legal-page probe binds Rev2 legal requirements to deployed staging pages and keeps billing policy out of the beta closure path while paid launch remains separately gated.",
      linkedAdminArtifacts: [
        "admin/app/support/page.tsx",
        "admin/app/operations/page.tsx",
        "admin/lib/fixtures.ts:stagingLegalSupportVisibilityEvidence"
      ],
      evidenceRefs: [
        "ops/evidence/staging/legal-pages-external-user.json",
        "ops/evidence/staging/support-contact-external-user.json",
        "rb-private-beta-legal-support-visibility",
        "eg-005",
        "au-020"
      ]
    },
    {
      area: "support_contact_visibility",
      status: "pass",
      runtimeProbe:
        "External-user staging support probe passed for /support, /report-problem, and /legal/billing-policy with deployed route responses and support-safe ticket context.",
      externalUserEvidence:
        "ops/evidence/staging/support-contact-external-user.json records passing checks for /support, /report-problem, and /legal/billing-policy with no active blocked checks.",
      policyEvidence:
        "The support visibility probe binds the visible support contact requirement to admin support ticket linkage and release blocker evidence so private beta users can report legal, abuse, billing, export, and quota issues.",
      linkedAdminArtifacts: [
        "admin/app/support/page.tsx",
        "admin/lib/fixtures.ts:supportTickets",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/staging/support-contact-external-user.json",
        "ops/evidence/staging/legal-pages-external-user.json",
        "sup-2201",
        "sup-2212",
        "au-020"
      ]
    }
  ],
  gateImpact: {
    checklistItems: [
      "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
      "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
      "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。"
    ],
    canClearCheckLevelItem: true,
    aggregatePrivateBetaGateStatus: "go",
    remainingBlockers: []
  }
};

export const stagingAuthRbacTenantAuditEvidence: StagingAuthRbacTenantAuditEvidence = {
  id: "staging_auth_rbac_tenant_audit_20260527T1515Z",
  evidencePath: "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
  environment: "staging",
  status: "pass",
  validatedAt: "2026-05-27T15:15:00Z",
  validatedByRole: "admin_reviewer",
  releaseGateCheckId: "staging_auth_rbac_tenant_audit",
  doNotLaunchConditionId: "tenant_isolation_not_enforced",
  runtimeRequestIds: [
    "staging-auth-rbac-tenant-audit-20260527T1515Z-admin-cookie-boundary",
    "staging-auth-rbac-tenant-audit-20260527T1515Z-cross-tenant-denial",
    "staging-auth-rbac-tenant-audit-20260527T1515Z-rbac-overrides",
    "staging-auth-rbac-tenant-audit-20260527T1515Z-audit-immutability"
  ],
  tenantIds: ["tenant-alpha", "tenant-beta"],
  adminRbacEvidenceIds: [
    "rbac-release-001",
    "rbac-crawler-001",
    "rbac-prompt-001",
    "rbac-provider-001",
    "rbac-provider-002",
    "rbac-quota-001",
    "rbac-safety-001",
    "rbac-export-001"
  ],
  auditRefs: ["au-001", "au-004", "au-005", "au-006", "au-007", "au-008", "au-012", "au-015"],
  coverage: [
    {
      area: "admin_session_boundary",
      status: "pass",
      runtimeProbe:
        "External-user staging probe verified ordinary user sessions and disabled dev identity headers receive 403 on /api/admin/* while independent admin session cookies can read only assigned console surfaces.",
      externalUserEvidence:
        "The replay used tenant-alpha user credentials, tenant-beta user credentials, and a separate admin cookie; neither external user could elevate into admin APIs or reuse admin-only evidence refs.",
      rbacAuditEvidence:
        "Denied user requests and allowed admin reads produced immutable audit ref au-015 and preserved admin-auth separation evidence in admin/lib/admin-auth.ts.",
      linkedAdminArtifacts: ["admin/lib/admin-auth.ts", "admin/components/AdminShell.tsx", "admin/app/audit/page.tsx"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
        "admin/lib/admin-auth.ts",
        "admin/components/AdminShell.tsx",
        "au-015"
      ]
    },
    {
      area: "tenant_isolation_denial",
      status: "pass",
      runtimeProbe:
        "Staging tenant probe denied tenant-alpha access to tenant-beta project, trace, export, support ticket, quota account, and audit search records while preserving same-tenant reads.",
      externalUserEvidence:
        "The external-user request set included usr-301 in tenant-alpha and usr-455 in tenant-beta with cross-tenant task, export, support, and crawler references blocked before admin rendering.",
      rbacAuditEvidence:
        "Every cross-tenant denial kept request id, tenant id, user id, route, and immutable audit linkage in au-015 without exposing secrets or foreign object identifiers beyond the denied reference.",
      linkedAdminArtifacts: ["admin/app/support/page.tsx", "admin/app/traces/page.tsx", "admin/app/exports/page.tsx"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
        "sup-2201",
        "sup-2212",
        "tr-1004",
        "tr-1019",
        "ex-887",
        "ex-901",
        "au-015"
      ]
    },
    {
      area: "admin_rbac_runtime",
      status: "pass",
      runtimeProbe:
        "Runtime replay covered release, crawler, prompt, active provider, expired provider, quota, safety, and export override attempts, proving allowed mutations expire, stale temporary overrides deny, insufficient roles are denied, and second-review mutations queue without applying.",
      externalUserEvidence:
        "No external-user session could trigger governed admin mutations; admin_operator, admin_reviewer, and support_operator attempts matched the effective RBAC decisions shown in the admin audit console.",
      rbacAuditEvidence:
        "RBAC runtime decisions preserved required role, attempted role, effective decision, mutation outcome, release gate status, evidence refs, and audit refs for all governed override records, including the expired rbac-provider-002 denial.",
      linkedAdminArtifacts: ["admin/lib/rbac-runtime.ts", "admin/app/audit/page.tsx", "admin/tests/admin-governance.test.mjs"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
        "rbac-release-001",
        "rbac-crawler-001",
        "rbac-prompt-001",
        "rbac-provider-001",
        "rbac-provider-002",
        "rbac-quota-001",
        "rbac-safety-001",
        "rbac-export-001",
        "au-015"
      ]
    },
    {
      area: "immutable_audit_linkage",
      status: "pass",
      runtimeProbe:
        "Audit immutability replay attempted to alter reviewer rationale, second-review status, and evidence refs after closure; the admin audit surface returned append-only au-015 evidence instead of mutating prior events.",
      externalUserEvidence:
        "External-user staging denial records are visible only as redacted support-safe outcomes, while admin audit search preserves actor, tenant, request id, rationale, second-review state, and evidence references.",
      rbacAuditEvidence:
        "Audit refs au-001, au-004, au-005, au-006, au-007, au-008, au-012, and au-015 remained immutable and linked back to validator-resolvable admin fixtures.",
      linkedAdminArtifacts: ["admin/app/audit/page.tsx", "admin/lib/fixtures.ts:auditEvents", "admin/tests/admin-data.test.mjs"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
        "au-001",
        "au-004",
        "au-005",
        "au-006",
        "au-007",
        "au-008",
        "au-012",
        "au-015"
      ]
    }
  ],
  gateImpact: {
    checklistItem: "Private Beta/Staging auth/RBAC/tenant/audit runtime evidence 通过。",
    canClearCheckLevelItem: true,
    aggregatePrivateBetaGateStatus: "go",
    remainingBlockers: []
  }
};

export const stagingEvalQaSafetyEvidence: StagingEvalQaSafetyEvidence = {
  id: "staging_eval_qa_safety_20260527T1900Z",
  evidencePath: "ops/evidence/staging/20260527T1900Z-eval-qa-safety.json",
  environment: "staging",
  status: "pass",
  validatedAt: "2026-05-27T19:00:00Z",
  validatedByRole: "admin_reviewer",
  releaseGateCheckId: "staging_eval_qa_safety_runtime",
  doNotLaunchConditionId: "eval_qa_safety_runtime_missing",
  runtimeRequestIds: [
    "staging-eval-qa-safety-20260527T1900Z-brief-safety",
    "staging-eval-qa-safety-20260527T1900Z-provider-request",
    "staging-eval-qa-safety-20260527T1900Z-provider-response",
    "staging-eval-qa-safety-20260527T1900Z-qa-result",
    "staging-eval-qa-safety-20260527T1900Z-export-block"
  ],
  traceIds: ["tr-1004", "tr-1019"],
  riskyExportIds: ["rx-41", "rx-42", "rx-43"],
  adminRbacEvidenceIds: ["rbac-safety-001", "rbac-export-001"],
  adminReviewDecisionIds: ["rv-102"],
  auditRefs: ["au-001", "au-006", "au-008", "au-018"],
  coverage: [
    {
      area: "brief_safety_gate",
      status: "pass",
      runtimeProbe:
        "External-user staging brief replay submitted unsafe medical and financial claim text and the brief safety gate returned a blocked safety decision before provider request construction.",
      externalUserEvidence:
        "The replay used the private-beta tenant account from trace tr-1004 and preserved the user-visible safety message while allowing support-safe project reads.",
      enforcementEvidence:
        "Safety policy evidence stayed linked to rbac-safety-001 and au-008; the prompt extraction abuse path could not proceed to provider invocation.",
      linkedAdminArtifacts: ["admin/app/safety/page.tsx", "admin/app/reviews/page.tsx", "admin/lib/fixtures.ts"],
      evidenceRefs: ["ops/evidence/staging/20260527T1900Z-eval-qa-safety.json", "tr-1004", "rbac-safety-001", "au-008"]
    },
    {
      area: "provider_request_policy",
      status: "pass",
      runtimeProbe:
        "Provider request staging probe redacted hidden prompt extraction instructions, preserved allowed brief fields, and denied unsafe provider payload assembly before any cost-bearing task could start.",
      externalUserEvidence:
        "The external user saw a blocked generation state tied to the safety policy rather than raw prompt internals or provider request metadata.",
      enforcementEvidence:
        "The admin safety console cites rbac-safety-001, abuse event ab-304, trace tr-1004, and immutable audit au-008 for the provider request denial.",
      linkedAdminArtifacts: ["admin/app/safety/page.tsx", "admin/app/abuse/page.tsx", "admin/app/traces/page.tsx"],
      evidenceRefs: ["ops/evidence/staging/20260527T1900Z-eval-qa-safety.json", "tr-1004", "rbac-safety-001", "au-008"]
    },
    {
      area: "provider_response_policy",
      status: "pass",
      runtimeProbe:
        "Provider response staging replay flagged financial-claim-review:v1 on export ex-913, required admin review, and prevented automatic package release while preserving response provenance.",
      externalUserEvidence:
        "The user-facing result stayed in review-required state and did not expose unsafe claim copy as a downloadable final asset.",
      enforcementEvidence:
        "Risky export rx-42 remains override eligible only with reviewer rationale and audit evidence; no support-only or reviewer-bypass mutation can release it.",
      linkedAdminArtifacts: ["admin/app/safety/page.tsx", "admin/app/reviews/page.tsx", "admin/lib/rbac-runtime.ts"],
      evidenceRefs: ["ops/evidence/staging/20260527T1900Z-eval-qa-safety.json", "rx-42", "rbac-safety-001", "au-006"]
    },
    {
      area: "qa_result_gate",
      status: "pass",
      runtimeProbe:
        "QA runtime replay processed watermark-risk:v2 and structured text warnings, kept warning metadata in admin and export evidence, and prevented warning loss during regeneration review.",
      externalUserEvidence:
        "The external user could continue only after the warning stayed attached to package metadata; support could not remove the QA warning from the evidence chain.",
      enforcementEvidence:
        "Risky export rx-43 and trace tr-1019 remain visible with QA enforcement point, audit requirement, and warning-preserving regeneration evidence.",
      linkedAdminArtifacts: ["admin/app/safety/page.tsx", "admin/app/exports/page.tsx", "admin/app/support/page.tsx"],
      evidenceRefs: ["ops/evidence/staging/20260527T1900Z-eval-qa-safety.json", "rx-43", "tr-1019", "au-001"]
    },
    {
      area: "export_block_gate",
      status: "pass",
      runtimeProbe:
        "Export release staging replay attempted to override forbidden-claims:v3 on ex-887; export_release denied the mutation, preserved blocked QA evidence, and kept quota credit as the only support path.",
      externalUserEvidence:
        "The external user could not download the blocked export and saw the support-safe blocked-export state while support retained quota-credit workflow evidence.",
      enforcementEvidence:
        "rbac-export-001, risky export rx-41, review decision rv-102, trace tr-1004, and audit au-001 prove blocking QA failures are not override eligible.",
      linkedAdminArtifacts: ["admin/app/safety/page.tsx", "admin/app/exports/page.tsx", "admin/lib/rbac-runtime.ts"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T1900Z-eval-qa-safety.json",
        "rx-41",
        "rv-102",
        "ex-887",
        "tr-1004",
        "rbac-export-001",
        "au-001"
      ]
    }
  ],
  gateImpact: {
    checklistItem: "Private Beta/Staging eval/QA/safety enforcement runtime evidence 通过。",
    canClearCheckLevelItem: true,
    aggregatePrivateBetaGateStatus: "go",
    remainingBlockers: []
  }
};

export const stagingQuotaRateLimitSpendCapEvidence: StagingQuotaRateLimitSpendCapEvidence = {
  id: "staging_quota_rate_limit_spend_cap_20260527T2015Z",
  evidencePath: "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
  environment: "staging",
  status: "pass",
  validatedAt: "2026-05-27T20:15:00Z",
  validatedByRole: "admin_operator",
  releaseGateCheckId: "staging_quota_rate_limit_spend_cap",
  doNotLaunchConditionId: "rate_limit_spend_cap_runtime_missing",
  runtimeRequestIds: [
    "staging-quota-rate-limit-spend-cap-20260527T2015Z-reserve-commit-refund",
    "staging-quota-rate-limit-spend-cap-20260527T2015Z-api-throttle",
    "staging-quota-rate-limit-spend-cap-20260527T2015Z-provider-spend-cap",
    "staging-quota-rate-limit-spend-cap-20260527T2015Z-emergency-kill-switch"
  ],
  quotaUserIds: ["usr-301", "usr-318"],
  adminRbacEvidenceIds: ["rbac-quota-001", "rbac-provider-001"],
  auditRefs: ["au-004", "au-007", "au-019"],
  coverage: [
    {
      area: "quota_reservation_commit_refund",
      status: "pass",
      runtimeProbe:
        "External-user staging quota probe reserved 180 credits for usr-301, committed the successful package path for usr-318, refunded the blocked ex-887 export, and verified retry idempotency reused qt-904 without double-crediting.",
      externalUserEvidence:
        "The user-visible billing and quota state showed pending reservation, committed usage, and refunded failed export credit with tenant-scoped support ticket context for usr-301 and usr-318.",
      enforcementEvidence:
        "Quota mutations required admin_operator ownership for balance changes, denied support_operator direct mutation through rbac-quota-001, and linked every posted transaction to au-004 or au-019.",
      linkedAdminArtifacts: ["admin/app/quota/page.tsx", "admin/lib/fixtures.ts:quotaAccounts", "admin/lib/rbac-runtime.ts"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
        "usr-301",
        "usr-318",
        "sup-2201",
        "qt-904",
        "ex-887",
        "rbac-quota-001",
        "au-004",
        "au-019"
      ]
    },
    {
      area: "rate_limit_enforcement",
      status: "pass",
      runtimeProbe:
        "External-user staging rate-limit probe saturated chat, export, and admin quota-adjustment routes until the gateway returned 429 with retry-after while preserving read-only account, project, and support access.",
      externalUserEvidence:
        "The throttled user could still view quota balance, support ticket state, and retry-after copy, but could not create additional quota-consuming generation or export work until the window reset.",
      enforcementEvidence:
        "Gateway and worker scheduler decisions shared the same request ids, kept quota reservations unchanged during throttle, and emitted audit-linked evidence for the admin quota console.",
      linkedAdminArtifacts: ["admin/app/quota/page.tsx", "admin/app/abuse/page.tsx", "admin/lib/abuse-runtime.ts"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
        "hook-ab-309-throttle",
        "ab-309",
        "sup-2212",
        "cf-118",
        "au-002",
        "au-019"
      ]
    },
    {
      area: "provider_spend_cap",
      status: "pass",
      runtimeProbe:
        "External-user staging provider spend probe drove OpenAI/image-render-dev usage to the daily cap, verified non-urgent provider calls failed closed, and confirmed already reserved user quota was released without silent fallback.",
      externalUserEvidence:
        "The affected workflow showed spend-cap blocked provider generation and support-safe failure messaging instead of silently routing to another provider or consuming extra package quota.",
      enforcementEvidence:
        "Provider router and quota reconciliation evidence linked ph-1, rbac-provider-001, and au-007, proving spend-cap enforcement and quota release were visible in admin provider and quota surfaces.",
      linkedAdminArtifacts: ["admin/app/providers/page.tsx", "admin/app/quota/page.tsx", "admin/lib/fixtures.ts:providerHealth"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
        "ph-1",
        "tr-1004",
        "rbac-provider-001",
        "au-007",
        "au-019"
      ]
    },
    {
      area: "emergency_kill_switch",
      status: "pass",
      runtimeProbe:
        "Staging emergency kill-switch probe disabled quota-consuming generation, export regeneration, and provider calls for private-beta traffic while preserving support lookup, admin audit search, and read-only project state.",
      externalUserEvidence:
        "External users saw a temporary unavailable state for quota-consuming actions, no new reservations were created, and support tickets retained enough context for operator follow-up.",
      enforcementEvidence:
        "Kill-switch activation and rollback required admin_operator evidence, preserved immutable audit au-019, and left object storage and legal page blockers visible in the release gate.",
      linkedAdminArtifacts: ["admin/app/quota/page.tsx", "admin/app/operations/page.tsx", "admin/app/audit/page.tsx"],
      evidenceRefs: [
        "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
        "q-export",
        "task-export-489",
        "sup-2204",
        "rbac-quota-001",
        "au-019"
      ]
    }
  ],
  gateImpact: {
    checklistItem: "Private Beta/Staging quota/rate-limit/spend-cap runtime evidence 通过。",
    canClearCheckLevelItem: true,
    aggregatePrivateBetaGateStatus: "go",
    remainingBlockers: []
  }
};

export const productionAbuseThrottleHoldEvidence: ProductionAbuseThrottleHoldEvidence = {
  id: "production_abuse_throttle_hold_20260527T1330Z",
  evidencePath: "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
  environment: "production",
  status: "pass_with_blockers_preserved",
  validatedAt: "2026-05-27T13:30:00Z",
  validatedByRole: "admin_superadmin",
  releaseGateCheckId: "production_abuse_throttle_hold",
  doNotLaunchConditionId: "abuse_throttle_hold_missing",
  runtimeRequestIds: [
    "production-abuse-throttle-hold-20260527T1330Z-account-hold",
    "production-abuse-throttle-hold-20260527T1330Z-rate-limit",
    "production-abuse-throttle-hold-20260527T1330Z-rbac-audit",
    "production-abuse-throttle-hold-20260527T1330Z-gate-preservation"
  ],
  abuseEventIds: ["ab-300", "ab-304", "ab-309"],
  abuseHookIds: ["hook-ab-300-hold", "hook-ab-304-hold", "hook-ab-309-throttle"],
  coverage: [
    {
      area: "account_hold_enforcement",
      status: "pass",
      runtimeProbe:
        "Production gateway replay enforced hook-ab-300-hold as deny_423_account_hold for export and share mutations while preserving read-only project access, account settings, and support attachment upload.",
      deploymentEvidence:
        "The production evidence file records the account-level hold probe, the user-visible held state, the export-service enforcement point, and the rollback action tied to support ticket sup-2201.",
      rbacAuditEvidence:
        "The enforced hold used admin_reviewer authorization, immutable audit au-002, release audit au-004, and blocked QA/export evidence before any release condition can clear.",
      linkedAdminArtifacts: ["admin/app/abuse/page.tsx", "admin/lib/abuse-runtime.ts", "admin/lib/fixtures.ts:abuseControlHooks"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
        "hook-ab-300-hold",
        "ab-300",
        "sup-2201",
        "ex-887",
        "tr-1004",
        "au-002",
        "au-004"
      ]
    },
    {
      area: "rate_limit_enforcement",
      status: "pass",
      runtimeProbe:
        "Production crawler scheduler replay enforced hook-ab-309-throttle as throttle_429_rate_limited and kept crawler import concurrency at zero until source ownership, robots evidence, and support ticket evidence are attached.",
      deploymentEvidence:
        "The production evidence file records the crawler scheduler throttle probe, queue action throttle_until_review, and source import hold state for account usr-455.",
      rbacAuditEvidence:
        "The throttle used admin_operator authorization, support ticket sup-2212, crawler finding cf-118, and immutable audit au-002 without allowing support-only release.",
      linkedAdminArtifacts: ["admin/app/abuse/page.tsx", "admin/app/crawler/page.tsx", "admin/lib/fixtures.ts:abuseControlHooks"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
        "hook-ab-309-throttle",
        "ab-309",
        "sup-2212",
        "cf-118",
        "au-002"
      ]
    },
    {
      area: "rbac_audit_release",
      status: "pass",
      runtimeProbe:
        "Production dry-run replay kept hook-ab-304-hold as dry_run_denied because admin_operator cannot enforce a critical hidden prompt extraction hold that requires admin_superadmin review.",
      deploymentEvidence:
        "The production evidence file records the denied high-risk hold probe, the security escalation queue action, and the release condition requiring prompt extraction investigation closure.",
      rbacAuditEvidence:
        "The critical abuse path preserved audit au-008, trace tr-1004, second-review requirement, and the admin-security release blocker instead of mutating production state with an insufficient role.",
      linkedAdminArtifacts: ["admin/app/abuse/page.tsx", "admin/app/audit/page.tsx", "admin/lib/abuse-runtime.ts"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
        "hook-ab-304-hold",
        "ab-304",
        "tr-1004",
        "au-008",
        "rb-production-admin-security"
      ]
    },
    {
      area: "gate_blocker_preservation",
      status: "pass",
      runtimeProbe:
        "Production release-gate replay cleared production_abuse_throttle_hold while preserving backup rollback plus upstream CI and staging checks that remain blocked after provider, billing, activation audit, security, and legal support evidence passed.",
      deploymentEvidence:
        "The production gate fixture cites this production evidence path on the abuse check, clears only abuse_throttle_hold_missing, and preserves unrelated production do-not-launch conditions.",
      rbacAuditEvidence:
        "Gate preservation links release blocker rb-production-admin-security, release evidence eg-002, and immutable audit au-008 so verified abuse controls do not imply production launch readiness.",
      linkedAdminArtifacts: ["admin/app/abuse/page.tsx", "admin/app/operations/page.tsx", "admin/tests/admin-governance.test.mjs"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
        "rb-production-admin-security",
        "eg-002",
        "au-008",
        "hook-ab-300-hold",
        "hook-ab-309-throttle"
      ]
    }
  ],
  gateImpact: {
    checklistItem: "Production abuse throttle/hold runtime/deployment evidence 通过。",
    canClearCheckLevelItem: true,
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items",
    remainingBlockers: [
      "production_paid_billing_lifecycle",
      "production_backup_rollback_incident"
    ]
  }
};

export const productionActivationReviewAuditEvidence: ProductionActivationReviewAuditEvidence = {
  id: "production_activation_review_audit_20260527T1430Z",
  evidencePath: "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
  environment: "production",
  status: "pass_with_blockers_preserved",
  validatedAt: "2026-05-27T14:30:00Z",
  validatedByRole: "admin_superadmin",
  releaseGateCheckId: "production_activation_review_audit",
  doNotLaunchConditionIds: [
    "activation_eval_review_audit_runtime_missing",
    "admin_high_risk_review_runtime_missing"
  ],
  runtimeRequestIds: [
    "production-activation-review-audit-20260527T1430Z-skill-release",
    "production-activation-review-audit-20260527T1430Z-crawler-activation",
    "production-activation-review-audit-20260527T1430Z-prompt-activation",
    "production-activation-review-audit-20260527T1430Z-provider-routing",
    "production-activation-review-audit-20260527T1430Z-provider-routing-expired",
    "production-activation-review-audit-20260527T1430Z-quota-override",
    "production-activation-review-audit-20260527T1430Z-safety-policy",
    "production-activation-review-audit-20260527T1430Z-export-override",
    "production-activation-review-audit-20260527T1430Z-gate-preservation"
  ],
  adminRbacEvidenceIds: [
    "rbac-release-001",
    "rbac-crawler-001",
    "rbac-prompt-001",
    "rbac-provider-001",
    "rbac-provider-002",
    "rbac-quota-001",
    "rbac-safety-001",
    "rbac-export-001"
  ],
  adminReviewDecisionIds: ["rv-100", "rv-101", "rv-102"],
  auditRefs: ["au-001", "au-004", "au-005", "au-006", "au-007", "au-008", "au-012"],
  coverage: [
    {
      area: "skill_release_gate",
      status: "pass",
      runtimeProbe:
        "Production release-gate replay queued rbac-release-001 as queued_second_review, kept skill-brand-kit@2.5.0 at 0% public traffic, and preserved rollback target skill-brand-kit@2.4.1 until reviewer and second-review evidence close.",
      deploymentEvidence:
        "The production activation evidence file records the skill release runtime request, admin review rv-100, immutable audit au-005, release evidence eg-001, and blocked canary mutation outcome before any production skill traffic can change.",
      rbacAuditEvidence:
        "rbac-release-001 is attempted by admin_reviewer but still requires second-review completion, so runtime holds the change for second review and cites au-005, rv-100, sv-248, and eg-001.",
      linkedAdminArtifacts: [
        "admin/app/skills/releases/page.tsx",
        "admin/app/audit/page.tsx",
        "admin/lib/rbac-runtime.ts"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
        "rbac-release-001",
        "rv-100",
        "sv-248",
        "eg-001",
        "au-005"
      ]
    },
    {
      area: "crawler_activation_gate",
      status: "pass",
      runtimeProbe:
        "Production crawler activation replay denied rbac-crawler-001, left cf-118 blocked, and prevented crawler-derived prompt or skill activation while takedown cg-501 and derivative deletion evidence remain unresolved.",
      deploymentEvidence:
        "The production evidence file records the crawler activation runtime request, source takedown workflow cg-501, IP complaint ip-7001, and immutable audit au-012 with no mutation applied to the source activation state.",
      rbacAuditEvidence:
        "rbac-crawler-001 requires admin_reviewer and second review, but the attempted role is admin_operator, so crawler_activation denies mutation and preserves takedown review evidence.",
      linkedAdminArtifacts: [
        "admin/app/crawler/page.tsx",
        "admin/app/audit/page.tsx",
        "admin/lib/rbac-runtime.ts"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
        "rbac-crawler-001",
        "cg-501",
        "cf-118",
        "ip-7001",
        "au-012"
      ]
    },
    {
      area: "prompt_activation_gate",
      status: "pass",
      runtimeProbe:
        "Production prompt activation replay denied rbac-prompt-001 because support_operator cannot activate prompt fragment pf-044 from support-attached feedback without reviewer-owned eval, QA, and audit evidence.",
      deploymentEvidence:
        "The production evidence file records the prompt activation runtime request, feedback exclusion refs, and audit au-008 while keeping pf-044 in review and leaving active prompt routing unchanged.",
      rbacAuditEvidence:
        "rbac-prompt-001 has insufficient role evidence and blocked_no_mutation outcome, so prompt_activation preserves the existing prompt route and excludes fb-222 from learning weights.",
      linkedAdminArtifacts: [
        "admin/app/prompt-fragments/page.tsx",
        "admin/app/audit/page.tsx",
        "admin/lib/rbac-runtime.ts"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
        "rbac-prompt-001",
        "pf-044",
        "fb-222",
        "au-008"
      ]
    },
    {
      area: "provider_routing_gate",
      status: "pass",
      runtimeProbe:
        "Production provider router replay allowed only rbac-provider-001 non-urgent retry-weight reduction with active expiry, denied expired rbac-provider-002 as denied_expired_override, kept no silent fallback enabled, and preserved the degraded provider launch blocker.",
      deploymentEvidence:
        "The production evidence file records active and expired provider routing runtime requests, admin review rv-101, provider health ph-1, release blocker eg-003, and immutable audit au-007 with explicit temporary override expirations.",
      rbacAuditEvidence:
        "rbac-provider-001 has sufficient admin_operator role and applied mutation with expiry, while rbac-provider-002 proves stale temporary provider overrides are denied after expiry; releaseGateImpact keeps provider production launch blocked until health and alert evidence pass.",
      linkedAdminArtifacts: [
        "admin/app/providers/page.tsx",
        "admin/app/audit/page.tsx",
        "admin/lib/rbac-runtime.ts"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
        "rbac-provider-001",
        "rbac-provider-002",
        "rv-101",
        "ph-1",
        "eg-003",
        "au-007"
      ]
    },
    {
      area: "quota_override_gate",
      status: "pass",
      runtimeProbe:
        "Production quota override replay denied rbac-quota-001 because support_operator cannot directly mutate usr-301 quota balance from support context without admin_operator transaction evidence.",
      deploymentEvidence:
        "The production evidence file records the quota mutation runtime request, support ticket sup-2201, quota transaction qt-904, export ex-887, and audit au-004 with no direct balance mutation from support.",
      rbacAuditEvidence:
        "rbac-quota-001 fails required-role enforcement, keeps the user-visible ticket update only, and requires immutable audit au-004 before any credit or debit posts.",
      linkedAdminArtifacts: [
        "admin/app/quota/page.tsx",
        "admin/app/support/page.tsx",
        "admin/lib/rbac-runtime.ts"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
        "rbac-quota-001",
        "sup-2201",
        "qt-904",
        "ex-887",
        "au-004"
      ]
    },
    {
      area: "safety_policy_gate",
      status: "pass",
      runtimeProbe:
        "Production safety policy replay denied rbac-safety-001 before second-review routing because admin_reviewer is below admin_superadmin, kept forbidden-claims:v3 blocking at export, and blocked production launch activation for the policy relaxation.",
      deploymentEvidence:
        "The production evidence file records the safety policy runtime request, risky export rx-41, release evidence eg-002, skill sv-098, and immutable audit au-006 without relaxing the blocking rule.",
      rbacAuditEvidence:
        "rbac-safety-001 requires admin_superadmin while attempted role is admin_reviewer, so runtime returns denied_insufficient_role before second-review routing and preserves the safety gate.",
      linkedAdminArtifacts: [
        "admin/app/safety/page.tsx",
        "admin/app/audit/page.tsx",
        "admin/lib/rbac-runtime.ts"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
        "rbac-safety-001",
        "rx-41",
        "sv-098",
        "eg-002",
        "au-006"
      ]
    },
    {
      area: "export_override_gate",
      status: "pass",
      runtimeProbe:
        "Production export release replay denied rbac-export-001 even with admin_reviewer role because ex-887 has non-override-eligible forbidden-claim QA evidence at final export enforcement.",
      deploymentEvidence:
        "The production evidence file records the export release runtime request, review rv-102, risky export rx-41, trace tr-1004, and audit au-001 while keeping the export unavailable.",
      rbacAuditEvidence:
        "rbac-export-001 is policy denied with blocked_no_mutation outcome, so export_release preserves the block and only allows audited quota credit or safe regeneration paths.",
      linkedAdminArtifacts: [
        "admin/app/safety/page.tsx",
        "admin/app/audit/page.tsx",
        "admin/lib/rbac-runtime.ts"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
        "rbac-export-001",
        "rv-102",
        "rx-41",
        "tr-1004",
        "au-001"
      ]
    },
    {
      area: "gate_blocker_preservation",
      status: "pass",
      runtimeProbe:
        "Production release-gate replay cleared production_activation_review_audit while preserving backup rollback plus upstream CI and staging blockers.",
      deploymentEvidence:
        "The production gate fixture cites this production evidence path on the activation review audit check, clears only activation and high-risk admin review do-not-launch conditions, and preserves unrelated production blockers.",
      rbacAuditEvidence:
        "Gate preservation links all eight admin RBAC evidence records, admin review decisions rv-100 through rv-102, and immutable audits au-001, au-004, au-005, au-006, au-007, au-008, and au-012 without implying production launch readiness.",
      linkedAdminArtifacts: [
        "admin/app/audit/page.tsx",
        "admin/lib/rbac-runtime.ts",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
        "rbac-release-001",
        "rbac-crawler-001",
        "rbac-prompt-001",
        "rbac-provider-001",
        "rbac-provider-002",
        "rbac-quota-001",
        "rbac-safety-001",
        "rbac-export-001",
        "rv-100",
        "rv-101",
        "rv-102",
        "au-001",
        "au-004",
        "au-005",
        "au-006",
        "au-007",
        "au-008",
        "au-012"
      ]
    }
  ],
  gateImpact: {
    checklistItem: "Production activation review/audit runtime/deployment evidence 通过。",
    canClearCheckLevelItem: true,
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items",
    remainingBlockers: [
      "production_paid_billing_lifecycle",
      "production_backup_rollback_incident"
    ]
  }
};

export const productionSkillReleaseEvalCanaryEvidence: ProductionSkillReleaseEvalCanaryEvidence = {
  id: "production_skill_release_eval_canary_20260527T1600Z",
  evidencePath: "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
  environment: "production",
  status: "pass_with_blockers_preserved",
  validatedAt: "2026-05-27T16:00:00Z",
  validatedByRole: "admin_superadmin",
  releaseGateCheckId: "production_skill_release_eval_canary",
  doNotLaunchConditionId: "skill_release_eval_canary_missing",
  runtimeRequestIds: [
    "production-skill-release-eval-canary-20260527T1600Z-eval-suite",
    "production-skill-release-eval-canary-20260527T1600Z-canary-thresholds",
    "production-skill-release-eval-canary-20260527T1600Z-release-notes",
    "production-skill-release-eval-canary-20260527T1600Z-rollback",
    "production-skill-release-eval-canary-20260527T1600Z-gate-preservation"
  ],
  skillVersionIds: ["sv-181", "sv-182", "sv-240", "sv-248"],
  canaryMetricIds: ["cm-001", "cm-011", "cm-012", "cm-014"],
  releaseEvidenceIds: ["eg-001", "eg-004"],
  auditRefs: ["au-003", "au-005", "au-009", "au-010", "au-016"],
  coverage: [
    {
      area: "eval_suite_gate",
      status: "pass",
      runtimeProbe:
        "Production skill release replay accepted only skill-export-pack@1.8.1 because eval suite, QA fixtures, regression fixtures, owner, risk level, and safety refs were present before canary traffic moved.",
      deploymentEvidence:
        "The production evidence file records eval suite es-stage0-export, release evidence eg-004, release notes stage0-skill-export-pack-1.8.1, and immutable audit au-016 before any active skill route can change.",
      rbacAuditEvidence:
        "Skill release evidence links admin review rv-101, rollback audit au-003, production audit au-016, and blocks skill-brand-kit@2.5.0 plus skill-claims-review@0.9.8 from using incomplete eval or second-review state as production launch evidence.",
      linkedAdminArtifacts: [
        "admin/app/skills/releases/page.tsx",
        "admin/app/feedback/page.tsx",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
        "sv-181",
        "eg-004",
        "rv-101",
        "au-016"
      ]
    },
    {
      area: "canary_threshold_gate",
      status: "pass",
      runtimeProbe:
        "Production canary replay verified cm-001 stayed healthy while cm-011 and cm-012 remained stopped, so skill-export-pack@1.8.1 could keep internal canary evidence and skill-export-pack@1.8.2 stayed paused at zero traffic.",
      deploymentEvidence:
        "The evidence file records canary threshold windows, stop actions, sample sizes, holdout routing, and critical safety regression flags without promoting any stopped canary to active production traffic.",
      rbacAuditEvidence:
        "Canary decisions cite immutable audits au-003 and au-009, keep rollback target skill-export-pack@1.8.0, and require admin_operator release ownership plus second-review preservation for stopped metrics.",
      linkedAdminArtifacts: [
        "admin/app/skills/releases/page.tsx",
        "admin/app/analytics/page.tsx",
        "admin/lib/fixtures.ts:skillCanaryMetrics"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
        "cm-001",
        "cm-011",
        "cm-012",
        "sv-182",
        "au-009"
      ]
    },
    {
      area: "release_notes_gate",
      status: "pass",
      runtimeProbe:
        "Production release-note replay required SHA, migration list, config diff, feature flags, owner, smoke plan, rollback plan, known risks, go/no-go, eval summary, canary summary, and release notes evidence before clearing the skill row.",
      deploymentEvidence:
        "The production evidence file links release notes stage0-skill-export-pack-1.8.1 to eg-004, sv-181, audit au-016, and admin release page evidence so the release-gate fixture can clear only the skill canary check.",
      rbacAuditEvidence:
        "Release notes evidence is immutable through au-016 and does not weaken provider, billing, security, backup, legal, CI, or staging blockers still listed in the production gate fixture.",
      linkedAdminArtifacts: [
        "admin/app/skills/releases/page.tsx",
        "admin/app/operations/page.tsx",
        "admin/app/audit/page.tsx"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
        "stage0-skill-export-pack-1.8.1",
        "eg-004",
        "sv-181",
        "au-016"
      ]
    },
    {
      area: "rollback_gate",
      status: "pass",
      runtimeProbe:
        "Production rollback replay restored skill-export-pack routing to 1.8.0 for stopped canary sv-182, preserved rolled-back brand-kit sv-240, and verified active release candidate sv-181 has rollback target skill-export-pack@1.8.0.",
      deploymentEvidence:
        "Rollback evidence records route smoke, rollback target, holdout routing, regression fixture conversion, and immutable audits au-003, au-009, au-010, and au-016 for production release review.",
      rbacAuditEvidence:
        "Rollback gate evidence keeps skill-brand-kit@2.5.0 queued behind rbac-release-001 and au-005 while allowing only validated export-pack rollback paths to be cited by the production skill release check.",
      linkedAdminArtifacts: [
        "admin/app/skills/releases/page.tsx",
        "admin/app/audit/page.tsx",
        "admin/lib/rbac-runtime.ts"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
        "sv-181",
        "sv-182",
        "sv-240",
        "au-003",
        "au-009",
        "au-010"
      ]
    },
    {
      area: "gate_blocker_preservation",
      status: "pass",
      runtimeProbe:
        "Production release-gate replay cleared only production_skill_release_eval_canary and kept backup rollback plus upstream CI and staging blockers active.",
      deploymentEvidence:
        "The production gate fixture cites this production evidence path on the skill release check, clears skill_release_eval_canary_missing, and preserves aggregate no-go status while unrelated production evidence remains absent.",
      rbacAuditEvidence:
        "Gate preservation links release evidence eg-004, skill versions sv-181 and sv-182, canary metrics cm-001, cm-011, cm-012, and immutable audits au-003, au-009, au-010, and au-016 without implying production launch readiness.",
      linkedAdminArtifacts: [
        "admin/app/skills/releases/page.tsx",
        "admin/app/operations/page.tsx",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
        "eg-004",
        "sv-181",
        "sv-182",
        "cm-001",
        "cm-011",
        "cm-012",
        "au-016"
      ]
    }
  ],
  gateImpact: {
    checklistItem: "Production skill release/eval/canary runtime/deployment evidence 通过。",
    canClearCheckLevelItem: true,
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items",
    remainingBlockers: [
      "production_paid_billing_lifecycle",
      "production_backup_rollback_incident"
    ]
  }
};

export const productionSecurityLaunchCheckEvidence: ProductionSecurityLaunchCheckEvidence = {
  id: "production_security_launch_checks_20260527T1700Z",
  evidencePath: "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
  environment: "production",
  status: "pass_with_blockers_preserved",
  validatedAt: "2026-05-27T17:00:00Z",
  validatedByRole: "admin_superadmin",
  releaseGateCheckId: "production_security_launch_checks",
  doNotLaunchConditionIds: ["security_privacy_legal_incomplete", "secret_exposure_runtime_not_verified"],
  runtimeRequestIds: [
    "production-security-launch-checks-20260527T1700Z-secure-cookie",
    "production-security-launch-checks-20260527T1700Z-csrf-same-site",
    "production-security-launch-checks-20260527T1700Z-secret-redaction",
    "production-security-launch-checks-20260527T1700Z-admin-privacy",
    "production-security-launch-checks-20260527T1700Z-gate-preservation"
  ],
  auditRefs: ["au-008", "au-015", "au-017"],
  coverage: [
    {
      area: "secure_session_cookie",
      status: "pass",
      runtimeProbe:
        "Production admin and web session replay rejected non-secure cookies, verified HttpOnly and SameSite attributes on session cookies, and denied dev identity headers while preserving independent admin session boundaries.",
      deploymentEvidence:
        "The production evidence file records Set-Cookie attribute probes for admin and web sessions, disabled ADMIN_DEV_IDENTITY_HEADERS fallback, TLS-only cookie transport, and no user-session reuse on /api/admin/*.",
      securityAuditEvidence:
        "Cookie validation links immutable audits au-015 and au-017 plus admin-auth fixtures, proving secure cookie runtime behavior without weakening remaining provider, billing, backup, legal, CI, or staging blockers.",
      linkedAdminArtifacts: ["admin/lib/admin-auth.ts", "admin/app/audit/page.tsx", "admin/tests/admin-governance.test.mjs"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
        "au-015",
        "au-017",
        "rbac-release-001"
      ]
    },
    {
      area: "csrf_same_site_enforcement",
      status: "pass",
      runtimeProbe:
        "Production cross-site mutation replay denied admin support, quota, crawler, safety, and export override POST requests without same-site session context while allowing same-site read probes with audit-linked admin cookies.",
      deploymentEvidence:
        "The production evidence file records rejected Origin and Sec-Fetch-Site probes, admin mutation denial responses, CSRF/same-site request contract checks, and unchanged queue, quota, crawler, and export state after denial.",
      securityAuditEvidence:
        "CSRF evidence links au-017, rbac-quota-001, rbac-crawler-001, and rbac-export-001 so failed cross-site mutations remain visible in admin audit without applying any high-risk change.",
      linkedAdminArtifacts: ["admin/app/audit/page.tsx", "admin/app/quota/page.tsx", "admin/app/crawler/page.tsx"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
        "au-017",
        "rbac-quota-001",
        "rbac-crawler-001",
        "rbac-export-001"
      ]
    },
    {
      area: "secret_exposure_redaction",
      status: "pass",
      runtimeProbe:
        "Production redaction replay scanned frontend bundle summaries, admin tables, support ticket views, traces, exports, crawler findings, and audit evidence for provider keys and classified secrets with no raw secret exposure.",
      deploymentEvidence:
        "The production evidence file records the runtime secret corpus, redaction match counts, fail-closed scanner statuses, and representative admin evidence refs showing prompt text, provider keys, crawler URLs, and support messages stayed redacted.",
      securityAuditEvidence:
        "Secret exposure validation links au-008, au-015, au-017, trace tr-1004, crawler finding cf-118, export ex-887, and support ticket sup-2201 while preserving immutable audit and support-safe redaction policy.",
      linkedAdminArtifacts: ["admin/app/audit/page.tsx", "admin/app/traces/page.tsx", "admin/app/support/page.tsx"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
        "au-008",
        "au-015",
        "au-017",
        "tr-1004",
        "cf-118",
        "ex-887",
        "sup-2201"
      ]
    },
    {
      area: "admin_surface_privacy",
      status: "pass",
      runtimeProbe:
        "Production admin privacy replay verified support lookup, audit search, crawler findings, abuse events, trace details, risky exports, and quota accounts render only redacted user, tenant, prompt, source, and object references.",
      deploymentEvidence:
        "The production evidence file records admin console snapshots and data-contract probes for support, audit, crawler, abuse, traces, quota, and safety pages, with private object keys, raw crawler content, provider keys, and full prompt payloads absent.",
      securityAuditEvidence:
        "Admin privacy evidence links support user redaction rules, au-015 tenant denial evidence, au-017 security launch audit, and high-risk audit au-008 without granting production launch for legal policy deployment.",
      linkedAdminArtifacts: ["admin/app/support/page.tsx", "admin/app/audit/page.tsx", "admin/app/crawler/page.tsx"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
        "au-015",
        "au-017",
        "ab-304",
        "tr-1004",
        "cf-118",
        "sup-2201"
      ]
    },
    {
      area: "gate_blocker_preservation",
      status: "pass",
      runtimeProbe:
        "Production release-gate replay cleared production_security_launch_checks while preserving backup rollback plus upstream CI and staging blockers.",
      deploymentEvidence:
        "The production gate fixture cites this security evidence path on the security launch check, clears only security and secret-exposure do-not-launch conditions, and preserves aggregate no-go status.",
      securityAuditEvidence:
        "Gate preservation links release blocker rb-production-admin-security, release evidence eg-002, immutable audits au-008 and au-017, and the production gate fixture without implying production launch readiness.",
      linkedAdminArtifacts: ["admin/app/audit/page.tsx", "admin/app/operations/page.tsx", "admin/tests/admin-governance.test.mjs"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
        "rb-production-admin-security",
        "eg-002",
        "au-008",
        "au-017"
      ]
    }
  ],
  gateImpact: {
    checklistItem: "Production security launch-check runtime/deployment evidence 通过。",
    canClearCheckLevelItem: true,
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items",
    remainingBlockers: [
      "production_paid_billing_lifecycle",
      "production_backup_rollback_incident"
    ]
  }
};

export const productionBackupRollbackIncidentEvidence: ProductionBackupRollbackIncidentEvidence = {
  id: "production_backup_rollback_incident_20260527T1800Z",
  evidencePath: "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
  environment: "production",
  status: "blocked_by_upstream_gates",
  validatedAt: "2026-05-27T18:00:00Z",
  validatedByRole: "admin_superadmin",
  releaseGateCheckId: "production_backup_rollback_incident",
  doNotLaunchConditionIds: [
    "backup_restore_rollback_smoke_missing",
    "production_deploy_rollback_smoke_missing"
  ],
  runtimeRequestIds: [
    "production-backup-rollback-incident-20260527T1800Z-postgres-restore",
    "production-backup-rollback-incident-20260527T1800Z-object-restore",
    "production-backup-rollback-incident-20260527T1800Z-app-rollback",
    "production-backup-rollback-incident-20260527T1800Z-feature-flag-rollback",
    "production-backup-rollback-incident-20260527T1800Z-worker-image-rollback",
    "production-backup-rollback-incident-20260527T1800Z-alert-incident",
    "production-backup-rollback-incident-20260527T1800Z-post-deploy-smoke",
    "production-backup-rollback-incident-20260527T1800Z-gate-preservation"
  ],
  incidentIds: ["inc-20260526-queue", "inc-20260525-crawler"],
  dashboardIds: ["od-provider-latency", "od-export-failure", "od-crawler-policy", "od-admin-security"],
  alertRouteIds: ["al-provider-error", "al-export-dead-letter", "al-crawler-policy", "al-admin-security"],
  auditRefs: ["au-003", "au-004", "au-009", "au-010", "au-016", "au-018"],
  coverage: [
    {
      area: "backup_restore",
      status: "pass",
      runtimeProbe:
        "Production restore replay validated the scheduled Postgres snapshot, object manifest, restore verification counts, RPO/RTO envelope, and audit au-018 before release approval could move past the backup gate.",
      deploymentEvidence:
        "The production evidence file records postgres_restore_verified, object_restore_verified, restore_count_match, backup_schedule_active, and rpo_rto_within_policy probes for the production backup slot.",
      operationalAuditEvidence:
        "Restore evidence links immutable audit au-018, support-visible incident inc-20260526-queue, and operations dashboard evidence so the admin console can show backup readiness without closing provider, billing, or legal policy blockers.",
      linkedAdminArtifacts: ["admin/app/operations/page.tsx", "admin/app/audit/page.tsx", "admin/lib/fixtures.ts:incidentLogs"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
        "au-018",
        "inc-20260526-queue",
        "od-export-failure"
      ]
    },
    {
      area: "rollback_drill",
      status: "pass",
      runtimeProbe:
        "Production rollback replay validated the SHA-tagged worker image rollback target runtime-worker, drained worker queues, verified task schema compatibility, restored skill-export-pack routing to 1.8.0, and reverted the export canary feature flag without losing retry idempotency evidence.",
      deploymentEvidence:
        "The production evidence file records app_rollback_verified, feature_flag_rollback_verified, worker_image_rollback_runtime_worker_verified, worker_drain_verified, migration_compatibility_verified, and route_smoke_verified probes for the rollback slot.",
      operationalAuditEvidence:
        "Rollback evidence cites audits au-003, au-009, au-010, and au-016 plus incident inc-20260526-queue, keeping the rollback path immutable and visible in admin operations.",
      linkedAdminArtifacts: ["admin/app/operations/page.tsx", "admin/app/skills/releases/page.tsx", "admin/lib/fixtures.ts:skillVersions"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
        "sv-181",
        "sv-182",
        "ops/evidence/ci/stage0-rev2-docker-image-build.json",
        "runtime-worker",
        "/app/worker",
        "au-003",
        "au-009",
        "au-010",
        "au-016"
      ]
    },
    {
      area: "incident_alert_path",
      status: "pass",
      runtimeProbe:
        "Production incident replay fired provider, export, crawler, and admin-security alert routes, created incident handoff entries, verified escalation owner roles, and kept unresolved crawler takedown work from mutating activation state.",
      deploymentEvidence:
        "The production evidence file records alert_delivery_verified, incident_handoff_verified, escalation_route_verified, runbook_link_verified, and postmortem_template_attached probes for the incident slot.",
      operationalAuditEvidence:
        "Incident evidence links al-provider-error, al-export-dead-letter, al-crawler-policy, al-admin-security, incidents inc-20260526-queue and inc-20260525-crawler, and immutable audit au-004.",
      linkedAdminArtifacts: ["admin/app/operations/page.tsx", "admin/app/crawler/page.tsx", "admin/lib/fixtures.ts:alertRoutes"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
        "al-provider-error",
        "al-export-dead-letter",
        "al-crawler-policy",
        "al-admin-security",
        "inc-20260525-crawler",
        "au-004"
      ]
    },
    {
      area: "post_deploy_smoke",
      status: "pass",
      runtimeProbe:
        "Production post-deploy smoke replay verified admin login isolation, support lookup, failed task retry/cancel visibility, abuse hold enforcement, crawler takedown queue visibility, dashboard imports, and alert route status after rollback checks.",
      deploymentEvidence:
        "The production evidence file records post_deploy_smoke_verified probes for admin-auth, support, queue retry/cancel, abuse, crawler, dashboard, and alert surfaces with request ids preserved.",
      operationalAuditEvidence:
        "Smoke evidence links audits au-004 and au-018 plus admin operations, support, abuse, crawler, and queue pages so production smoke is reviewable without touching user-facing launch claims.",
      linkedAdminArtifacts: ["admin/app/operations/page.tsx", "admin/app/support/page.tsx", "admin/app/queues/page.tsx", "admin/app/abuse/page.tsx"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
        "au-004",
        "au-018",
        "sup-2201",
        "ft-887",
        "hook-ab-300-hold",
        "cg-501"
      ]
    },
    {
      area: "gate_blocker_preservation",
      status: "blocked",
      runtimeProbe:
        "Production release-gate replay preserved production_backup_rollback_incident because CI and Private Beta/Staging gates remain blocked, even though backup restore, rollback, incident, and smoke probes are present in this admin operations evidence slice.",
      deploymentEvidence:
        "The production gate fixture keeps this check blocked until upstream gates pass, cites this production evidence path as the current admin-visible operations probe, and preserves aggregate no-go status.",
      operationalAuditEvidence:
        "Gate preservation links immutable audit au-018, operations alerts, incidents, dashboards, and the production gate fixture without implying CI, staging, real-provider, billing lifecycle, or legal/support deployment readiness.",
      linkedAdminArtifacts: ["admin/app/operations/page.tsx", "admin/tests/admin-governance.test.mjs"],
      evidenceRefs: [
        "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
        "au-018",
        "od-provider-latency",
        "al-provider-error",
        "inc-20260526-queue"
      ]
    }
  ],
  splitReadiness: [
    {
      split: "backup_restore",
      exactEvidencePath: "ops/evidence/production/backup-restore.json",
      status: "blocked_until_exact_split_file",
      requiredRuntimeProof: [
        "backup_schedule_active",
        "postgres_restore_verified",
        "object_restore_verified",
        "restore_count_match",
        "rpo_rto_within_policy",
        "audit_refs_bound"
      ],
      upstreamBlockers: [
        "exact production backup split file missing",
        "ci_staging_gates_not_passed"
      ],
      adminReviewSurface:
        "Operations page keeps backup restore probe evidence visible beside incidents, dashboards, alert routes, and immutable audit refs while the launch-clearing split file is absent.",
      checklistItem:
        "Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。"
    },
    {
      split: "rollback_incident_smoke",
      exactEvidencePath: "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
      status: "blocked_until_exact_split_file",
      requiredRuntimeProof: [
        "app_rollback_verified",
        "feature_flag_rollback_verified",
        "worker_image_rollback_runtime_worker_verified",
        "worker_image_entrypoint_app_worker_verified",
        "worker_image_digest_matches_ci_artifact",
        "migration_compatibility_verified",
        "alert_incident_path_verified",
        "post_deploy_smoke_verified",
        "ci_and_staging_gate_refs_bound"
      ],
      upstreamBlockers: [
        "exact production rollback incident smoke split file missing",
        "ci_staging_gates_not_passed"
      ],
      adminReviewSurface:
        "Operations page separates rollback, incident, and smoke proof from the aggregate probe so admins can see why release remains blocked until the exact split evidence cites passing CI and staging gates plus the SHA-tagged runtime-worker image rollback target.",
      checklistItem:
        "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves app rollback, feature flag rollback, worker image rollback to runtime-worker (/app/worker), worker drain, incident/alert path, migration compatibility, and post-deploy smoke under `ops/evidence/production/`。"
    }
  ],
  gateImpact: {
    checklistItems: [
      "Production backup/rollback/incident/post-deploy smoke runtime/deployment evidence 通过。",
      "Production backup/restore runtime evidence 通过。",
      "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves app rollback, feature flag rollback, worker image rollback to runtime-worker (/app/worker), worker drain, incident/alert path, migration compatibility, and post-deploy smoke under `ops/evidence/production/`。",
      "Production backup/rollback/incident/post-deploy admin-visible probe evidence recorded but launch blocker preserved: `ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json` has `status=blocked_by_upstream_gates`, proves backup、rollback、incident、post-deploy smoke probes, and cannot close production backup/rollback launch readiness until upstream CI/Staging gates and exact split files pass。",
      "Production post-deploy launch-clearing smoke evidence 通过：exact production split evidence exists at `ops/evidence/production/rollback-incident-post-deploy-smoke.json`, cites passing CI and Private Beta/Staging gate fixtures, and clears `production_deploy_rollback_smoke_missing` without preserved blockers。"
    ],
    canClearCheckLevelItems: false,
    aggregateProductionGateStatus: "blocked_by_upstream_and_other_production_runtime_items",
    remainingBlockers: [
      "ci_staging_gates_not_passed"
    ]
  }
};

export const productionBackupRollbackSplitPreflightEvidence: ProductionBackupRollbackSplitPreflightEvidence = {
  id: "production-backup-rollback-split",
  evidencePath: "ops/evidence/production/backup-rollback-split.blocked.json",
  environment: "production",
  status: "exact_split_ready_blocked_by_other_production_runtime_items",
  releaseGateCheckId: "production_backup_rollback_incident",
  kind: "production_backup_rollback_split_preflight",
  releaseShaStatus: "bound",
  adminVisibleProbePath: "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json",
  adminVisibleProbeReady: true,
  blockedChecks: ["production_gate_fixture_has_unrelated_blockers"],
  upstreamGates: [
    {
      gate: "ci",
      path: "fixtures/stage0/rev2/release_gate_evidence.ci.json",
      exists: true,
      gateDecisionStatus: "go",
      ready: true,
      blockedByChecks: [],
      activeDoNotLaunchConditions: []
    },
    {
      gate: "private_beta_staging",
      path: "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
      exists: true,
      gateDecisionStatus: "go",
      ready: true,
      blockedByChecks: [],
      activeDoNotLaunchConditions: []
    },
    {
      gate: "production_launch",
      path: "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
      exists: true,
      gateDecisionStatus: "no_go",
      ready: false,
      blockedByChecks: [
        "production_paid_billing_lifecycle",
        "production_skill_release_eval_canary",
        "production_activation_review_audit",
        "production_abuse_throttle_hold",
        "production_security_launch_checks",
        "production_legal_support_policy"
      ],
      activeDoNotLaunchConditions: [
        "paid_billing_or_comp_only_mode_missing",
        "skill_release_eval_canary_missing",
        "activation_eval_review_audit_runtime_missing",
        "admin_high_risk_review_runtime_missing",
        "abuse_throttle_hold_missing",
        "security_privacy_legal_incomplete",
        "secret_exposure_runtime_not_verified",
        "public_legal_support_policy_not_deployed"
      ]
    }
  ],
  exactSplitEvidence: [
    {
      splitId: "backup_restore",
      path: "ops/evidence/production/backup-restore.json",
      exists: true,
      status: "pass",
      passed: true,
      environment: "production",
      releaseGateCheckId: "production_backup_rollback_incident",
      missingRequirements: []
    },
    {
      splitId: "rollback_incident_post_deploy_smoke",
      path: "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
      exists: true,
      status: "pass",
      passed: true,
      environment: "production",
      releaseGateCheckId: "production_backup_rollback_incident",
      missingRequirements: []
    }
  ],
  requiredUpstreamGates: [
    "fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=go",
    "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json gate_decision.status=go"
  ],
  canClearReleaseGateCheck: true,
  canClearCheckLevelItems: true,
  aggregateProductionGateStatus: "blocked_by_other_production_runtime_items",
  preservedReleaseGateCheckId: null,
  preservedDoNotLaunchConditionIds: [
    "paid_billing_or_comp_only_mode_missing",
    "skill_release_eval_canary_missing",
    "activation_eval_review_audit_runtime_missing",
    "admin_high_risk_review_runtime_missing",
    "abuse_throttle_hold_missing",
    "security_privacy_legal_incomplete",
    "secret_exposure_runtime_not_verified",
    "public_legal_support_policy_not_deployed"
  ],
  runtimeInputRequirements: [
    {
      split: "backup_restore",
      path: "ops/evidence/production/backup-restore.json",
      mustProve: [
        "backup schedule",
        "Postgres restore",
        "object restore",
        "RPO/RTO",
        "audit refs"
      ]
    },
    {
      split: "rollback_incident_post_deploy_smoke",
      path: "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
      mustProve: [
        "app rollback",
        "feature flag rollback",
        "worker image rollback",
        "runtime-worker target",
        "/app/worker entrypoint",
        "worker drain",
        "migration compatibility",
        "incident/alert path",
        "post-deploy smoke"
      ]
    }
  ],
  operatorAction:
    "Keep production backup/rollback launch readiness blocked until a full release SHA, passing CI gate, passing Private Beta/Staging gate, both exact production split evidence files, and a SHA-tagged runtime-worker (/app/worker) rollback proof are present and validator-passable."
};

export const productionLegalSupportPolicyEvidence: ProductionLegalSupportPolicyEvidence = {
  id: "production_legal_support_policy_20260527T1900Z",
  environment: "production",
  status: "pass_with_blockers_preserved",
  validatedAt: "2026-05-27T19:00:00Z",
  validatedByRole: "admin_superadmin",
  releaseGateCheckId: "production_legal_support_policy",
  doNotLaunchConditionId: "public_legal_support_policy_not_deployed",
  legalPolicyEvidencePath: "ops/evidence/production/public-legal-policy.json",
  supportBillingPolicyEvidencePath: "ops/evidence/production/public-support-billing-policy.json",
  runtimeRequestIds: [
    "production-legal-support-policy-20260527T1900Z-terms",
    "production-legal-support-policy-20260527T1900Z-privacy",
    "production-legal-support-policy-20260527T1900Z-acceptable-use",
    "production-legal-support-policy-20260527T1900Z-ai-disclaimer",
    "production-legal-support-policy-20260527T1900Z-ip-complaint",
    "production-legal-support-policy-20260527T1900Z-support-contact",
    "production-legal-support-policy-20260527T1900Z-billing-policy",
    "production-legal-support-policy-20260527T1900Z-gate-preservation"
  ],
  auditRefs: ["au-020"],
  coverage: [
    {
      area: "public_legal_pages",
      status: "pass",
      runtimeProbe:
        "Production public HTTP probes loaded Terms, Privacy Policy, Acceptable Use, AI/content disclaimer, and IP complaint flow without admin credentials and verified required public-launch policy tokens, support contact links, effective dates, and no provider-real-generation claim.",
      deploymentEvidence:
        "ops/evidence/production/public-legal-policy.json records production 200 responses for /terms, /privacy, /acceptable-use, /ai-content-disclaimer, and /ip-complaint with public visibility and required policy titles.",
      policyAuditEvidence:
        "Legal page deployment is bound to immutable audit au-020, release evidence eg-005, and crawler takedown workflow cg-501 so IP complaint intake reaches crawler takedown and derivative review handling.",
      linkedAdminArtifacts: [
        "admin/app/operations/page.tsx",
        "admin/app/support/page.tsx",
        "admin/lib/fixtures.ts:productionLegalSupportPolicyEvidence"
      ],
      evidenceRefs: [
        "ops/evidence/production/public-legal-policy.json",
        "ops/evidence/production/public-support-billing-policy.json",
        "eg-005",
        "au-020",
        "cg-501"
      ]
    },
    {
      area: "public_support_contact",
      status: "pass",
      runtimeProbe:
        "Production support visibility probe loaded public support and report-problem entry points, verified visible support contact, user-safe ticket context copy, privacy redaction notice, and IP complaint handoff without requiring admin session state.",
      deploymentEvidence:
        "ops/evidence/production/public-support-billing-policy.json records production /support and /report-problem probes with support contact, escalation copy, ticket context tokens, and user-visible reporting path evidence.",
      policyAuditEvidence:
        "Support contact deployment links support tickets sup-2201 and sup-2212, immutable audit au-020, and support console evidence so public users can report billing, abuse, export, crawler, and legal issues.",
      linkedAdminArtifacts: [
        "admin/app/support/page.tsx",
        "admin/lib/fixtures.ts:supportTickets",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/production/public-support-billing-policy.json",
        "ops/evidence/production/public-legal-policy.json",
        "sup-2201",
        "sup-2212",
        "au-020"
      ]
    },
    {
      area: "billing_policy_visibility",
      status: "pass",
      runtimeProbe:
        "Production billing policy probe verified billing, cancellation, and refund policy visibility; policy copy links paid-launch claims to the separate production billing lifecycle evidence and avoids standalone readiness claims.",
      deploymentEvidence:
        "ops/evidence/production/public-support-billing-policy.json records production billing policy tokens for cancellation, refund/credit, past_due support path, quota reset support path, and comp-only/paid-mode caveat visibility.",
      policyAuditEvidence:
        "Billing policy visibility links immutable audit au-020 and production billing audit au-022 so deployed policy pages remain aligned with checkout, subscription, cancellation, past_due, refund, credit, quota reset, and webhook idempotency runtime evidence.",
      linkedAdminArtifacts: [
        "admin/app/operations/page.tsx",
        "admin/app/quota/page.tsx",
        "admin/lib/fixtures.ts:productionLegalSupportPolicyEvidence"
      ],
      evidenceRefs: [
        "ops/evidence/production/public-support-billing-policy.json",
        "ops/evidence/production/public-legal-policy.json",
        "au-020",
        "au-022"
      ]
    },
    {
      area: "gate_blocker_preservation",
      status: "pass",
      runtimeProbe:
        "Production release-gate replay cleared production_legal_support_policy and public_legal_support_policy_not_deployed while preserving backup rollback plus upstream CI and staging blockers.",
      deploymentEvidence:
        "The production gate fixture cites both exact production legal/support policy evidence files, clears only the legal/support policy check, and keeps aggregate no-go status because unrelated production and upstream evidence remains absent.",
      policyAuditEvidence:
        "Gate preservation links immutable audit au-020, release evidence eg-005, production gate fixture state, and the still-blocked backup/rollback check without implying global production launch readiness.",
      linkedAdminArtifacts: [
        "admin/app/operations/page.tsx",
        "admin/app/audit/page.tsx",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/production/public-legal-policy.json",
        "ops/evidence/production/public-support-billing-policy.json",
        "au-020",
        "eg-005",
        "production_paid_billing_lifecycle",
        "production_backup_rollback_incident"
      ]
    }
  ],
  gateImpact: {
    checklistItems: [
      "Production legal/support policy deployment evidence 通过。",
      "Production public legal policy deployment evidence 通过：production evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow visibility under `ops/evidence/production/`。",
      "Production public support/billing policy deployment evidence 通过：production evidence proves support contact and paid billing/cancellation/refund policy visibility under `ops/evidence/production/`。"
    ],
    canClearCheckLevelItems: true,
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items",
    remainingBlockers: [
      "production_paid_billing_lifecycle",
      "production_backup_rollback_incident"
    ]
  }
};

export const exportJobs: ExportJob[] = [
  {
    id: "ex-887",
    userId: "usr-301",
    packageId: "pkg-441",
    status: "blocked",
    qaSeverity: "blocking",
    regenerateEligible: true,
    failureReason: "Forbidden claim in final export QA.",
    supportTicketId: "sup-2201",
    requestedByRole: "admin_reviewer",
    requiredRole: "admin_reviewer",
    rbacDecision: "denied",
    idempotencyKey: "regenerate:ex-887:sup-2201:blocking-forbidden-claim",
    quotaEffect: "credit_after_audit",
    regenerationMode: "not_allowed",
    regenerationRationale: "Blocking forbidden-claim QA cannot be regenerated into a releasable package; only audited quota credit and safe user messaging may proceed.",
    closureEvidenceRefs: ["ex-887", "sup-2201", "tr-1004", "au-001", "au-004"],
    auditRef: "au-001",
    operatorRunbook: "Keep the blocked export immutable, deny regeneration, apply audited quota credit through the support ticket, and preserve the final QA evidence for release review."
  },
  {
    id: "ex-901",
    userId: "usr-318",
    packageId: "pkg-489",
    status: "completed",
    qaSeverity: "warning",
    regenerateEligible: false,
    failureReason: "None",
    supportTicketId: "sup-2204",
    requestedByRole: "support_operator",
    requiredRole: "admin_operator",
    rbacDecision: "second_review_required",
    idempotencyKey: "regenerate:ex-901:sup-2204:qa-warning-review",
    quotaEffect: "none",
    regenerationMode: "qa_preserving",
    regenerationRationale: "Completed warning-only export stays immutable until support attaches QA warning evidence and an admin operator approves a QA-preserving rebuild.",
    closureEvidenceRefs: ["ex-901", "sup-2204", "tr-1019", "q-export"],
    auditRef: "pending",
    operatorRunbook: "Attach the mobile readability QA warning, create the missing audit ref, then request admin_operator review before a QA-preserving regeneration can run."
  },
  {
    id: "ex-909",
    userId: "usr-318",
    packageId: "pkg-510",
    status: "failed",
    qaSeverity: "info",
    regenerateEligible: true,
    failureReason: "ZIP manifest missing QA report.",
    supportTicketId: "sup-2209",
    requestedByRole: "admin_operator",
    requiredRole: "admin_operator",
    rbacDecision: "allowed",
    idempotencyKey: "regenerate:ex-909:sup-2209:missing-qa-report",
    quotaEffect: "reserved_credit_released",
    regenerationMode: "full_rebuild",
    regenerationRationale: "The original failed package is immutable, but a full rebuild is allowed because the failure is export completeness, the QA severity is informational, and quota reservation release is linked.",
    closureEvidenceRefs: ["ex-909", "sup-2209", "q-export", "au-003"],
    auditRef: "au-003",
    operatorRunbook: "Submit one idempotent full rebuild, verify the regenerated ZIP contains manifest and QA report, then attach audit au-003 before support closure."
  }
];

export const supportTickets: SupportTicket[] = [
  {
    id: "sup-2201",
    status: "escalated",
    priority: "high",
    userId: "usr-301",
    projectId: "proj-774",
    batchId: "batch-2201",
    taskId: "task-brief-441",
    traceId: "tr-1004",
    assetId: "asset-441",
    exportId: "ex-887",
    quotaBucketId: "qb-301",
    quotaTransactionId: "qt-904",
    billingReferenceId: "billing_admin_operation:bao-2201",
    subject: "Blocked export consumed retries and quota.",
    nextAction: "Confirm blocked QA result, keep export closed, and apply audited quota credit.",
    auditRef: "au-004"
  },
  {
    id: "sup-2204",
    status: "open",
    priority: "medium",
    userId: "usr-318",
    projectId: "proj-790",
    batchId: "batch-2204",
    taskId: "task-export-489",
    traceId: "tr-1019",
    assetId: "asset-489",
    exportId: "ex-901",
    quotaBucketId: "qb-318",
    quotaTransactionId: "qt-911",
    billingReferenceId: "invoice:in_2204",
    subject: "Low contrast phone number in mobile export.",
    nextAction: "Attach QA warning to regeneration request and keep original package immutable.",
    auditRef: "pending"
  },
  {
    id: "sup-2209",
    status: "open",
    priority: "high",
    userId: "usr-318",
    projectId: "proj-790",
    batchId: "batch-2209",
    taskId: "task-export-489",
    traceId: "tr-1019",
    assetId: "asset-489",
    exportId: "ex-909",
    quotaBucketId: "qb-318",
    quotaTransactionId: "qt-912",
    billingReferenceId: "subscription:sub_2209",
    subject: "ZIP export failed without QA report in package manifest.",
    nextAction: "Run one idempotent full rebuild, verify manifest and QA report evidence, and release reserved credits before support closure.",
    auditRef: "au-003"
  },
  {
    id: "sup-2212",
    status: "waiting_user",
    priority: "low",
    userId: "usr-455",
    projectId: "proj-812",
    batchId: "none",
    taskId: "task-crawler-019",
    traceId: "none",
    assetId: "none",
    exportId: "none",
    quotaBucketId: "none",
    quotaTransactionId: "none",
    billingReferenceId: "none",
    subject: "Crawler source import paused after abuse rate limit.",
    nextAction: "Request source ownership details before any retry or allowlist change.",
    auditRef: "au-002"
  },
  {
    id: "sup-2215",
    status: "open",
    priority: "medium",
    userId: "usr-455",
    projectId: "proj-812",
    batchId: "none",
    taskId: "task-crawler-122",
    traceId: "none",
    assetId: "none",
    exportId: "none",
    quotaBucketId: "none",
    quotaTransactionId: "none",
    billingReferenceId: "none",
    subject: "Crawler derivative review cancellation ready for closure.",
    nextAction: "Close the cancelled crawler task only after second-review audit, provenance, and bounded retention evidence remain attached.",
    auditRef: "au-013"
  }
];

export const supportEscalationRunbooks: SupportEscalationRunbook[] = [
  {
    ticketId: "sup-2201",
    readiness: "ready",
    escalationRole: "admin_reviewer",
    owner: "trust-admin",
    dueAt: "2026-05-26 10:30",
    customerUpdateCadence: "Every 30 minutes until quota credit and export closure are confirmed.",
    customerMessage: "A blocked QA export remains closed while an audited quota credit is applied.",
    runbook: "Keep the export blocked, verify quota credit audit au-004, and link the abuse hold before closure.",
    requiredEvidenceRefs: ["au-001", "au-004", "rx-41", "tr-1004"],
    closureBlockers: []
  },
  {
    ticketId: "sup-2204",
    readiness: "blocked",
    escalationRole: "support_operator",
    owner: "support-admin",
    dueAt: "2026-05-26 11:00",
    customerUpdateCadence: "Send one update before regeneration and another after QA warning review.",
    customerMessage: "The original package stays immutable while a QA-preserving regeneration is reviewed.",
    runbook: "Attach QA warning evidence, create an audit ref, then submit a regenerate request from the export detail page.",
    requiredEvidenceRefs: ["tr-1019", "ex-901", "fb-211"],
    closureBlockers: ["Audit ref is pending", "Regeneration rationale is not attached"]
  },
  {
    ticketId: "sup-2209",
    readiness: "ready",
    escalationRole: "admin_operator",
    owner: "export-ops-admin",
    dueAt: "2026-05-26 11:15",
    customerUpdateCadence: "Send one update before full rebuild and one after manifest and QA report evidence is attached.",
    customerMessage: "The failed ZIP export is being rebuilt once with the same package inputs while the original failed package remains immutable.",
    runbook: "Submit the idempotent export regeneration, verify manifest and QA report files, release reserved credits, and link audit au-003 before closure.",
    requiredEvidenceRefs: ["au-003", "ex-909", "q-export", "tr-1019"],
    closureBlockers: []
  },
  {
    ticketId: "sup-2212",
    readiness: "waiting_user",
    escalationRole: "admin_operator",
    owner: "crawler-admin",
    dueAt: "waiting on source owner",
    customerUpdateCadence: "Hold every retry until the user provides source ownership details.",
    customerMessage: "Crawler import remains paused until source ownership and robots evidence are reviewed.",
    runbook: "Keep crawler import held, collect ownership proof, and link robots evidence before allowlist changes.",
    requiredEvidenceRefs: ["au-002", "ab-309", "q-crawler"],
    closureBlockers: ["Source ownership details missing", "Robots evidence missing"]
  }
];

export const supportUsers: SupportUser[] = [
  {
    id: "usr-301",
    email: "founder@example.test",
    plan: "Team trial",
    tenantId: "tenant-alpha",
    accountStatus: "held",
    projects: 4,
    projectIds: ["proj-774", "proj-brand-112", "proj-export-204", "proj-archive-019"],
    recentTasks: 12,
    taskIds: ["task-brief-441"],
    traces: ["tr-1004"],
    exportIds: ["ex-887"],
    ticketIds: ["sup-2201"],
    quotaAccountRef: "usr-301",
    lookupKeys: ["usr-301", "founder@example.test", "tenant-alpha", "sup-2201", "ex-887", "tr-1004"],
    riskFlags: ["safety-block-review", "quota-drain-watch"],
    privacyRedaction: "Show email, IDs, plan, and evidence refs only; redact prompt text and uploaded assets unless admin_reviewer opens trace evidence.",
    auditRefs: ["au-001", "au-002", "au-004"],
    lookupActions: [
      {
        scope: "read_profile",
        requiredRole: "support_operator",
        decision: "allowed",
        evidenceRefs: ["sup-2201", "tr-1004", "ex-887", "au-004"],
        auditRef: "au-004",
        rationale: "Support can inspect linked ticket, trace, export, and quota state while prompt and asset contents stay redacted."
      },
      {
        scope: "retry_failed_task",
        requiredRole: "admin_reviewer",
        decision: "blocked",
        evidenceRefs: ["task-brief-441", "sup-2201", "rx-41", "au-001"],
        auditRef: "au-001",
        rationale: "Safety-blocked export task cannot be retried while forbidden-claim QA evidence remains blocking."
      },
      {
        scope: "quota_credit",
        requiredRole: "support_operator",
        decision: "allowed",
        evidenceRefs: ["sup-2201", "qt-904", "ex-887", "au-004"],
        auditRef: "au-004",
        rationale: "Audited quota credit is allowed because the blocked export consumed reserved credits."
      },
      {
        scope: "temporary_hold",
        requiredRole: "admin_reviewer",
        decision: "requires_review",
        evidenceRefs: ["ab-300", "sup-2201", "au-002"],
        auditRef: "au-002",
        rationale: "Temporary hold remains review-gated until abuse and support evidence confirm release conditions."
      }
    ]
  },
  {
    id: "usr-318",
    email: "ops@example.test",
    plan: "Pro",
    tenantId: "tenant-ops",
    accountStatus: "active",
    projects: 9,
    projectIds: ["proj-790", "proj-sales-221", "proj-packaging-044"],
    recentTasks: 31,
    taskIds: ["task-export-489"],
    traces: ["tr-1019"],
    exportIds: ["ex-901", "ex-909"],
    ticketIds: ["sup-2204", "sup-2209"],
    quotaAccountRef: "usr-318",
    lookupKeys: ["usr-318", "ops@example.test", "tenant-ops", "sup-2204", "sup-2209", "ex-901", "ex-909", "tr-1019"],
    riskFlags: [],
    privacyRedaction: "Support can view package metadata and QA warning summary; uploaded source files require trace-level reviewer access.",
    auditRefs: ["au-011"],
    lookupActions: [
      {
        scope: "read_profile",
        requiredRole: "support_operator",
        decision: "allowed",
        evidenceRefs: ["sup-2204", "tr-1019", "ex-901"],
        auditRef: "au-011",
        rationale: "Open ticket has linked trace and export metadata for support-safe inspection."
      },
      {
        scope: "retry_failed_task",
        requiredRole: "support_operator",
        decision: "allowed",
        evidenceRefs: ["task-export-489", "sup-2204", "q-export", "au-011"],
        auditRef: "au-011",
        rationale: "Manifest packaging failure is retry eligible after ticket and QA warning evidence are attached."
      },
      {
        scope: "export_regenerate",
        requiredRole: "support_operator",
        decision: "requires_review",
        evidenceRefs: ["sup-2204", "tr-1019", "ex-901", "au-011"],
        auditRef: "au-011",
        rationale: "Regeneration is review-gated until a fresh immutable audit ref replaces the pending ticket audit state."
      }
    ]
  },
  {
    id: "usr-455",
    email: "crawler-owner@example.test",
    plan: "Team trial",
    tenantId: "tenant-crawler",
    accountStatus: "rate_limited",
    projects: 2,
    projectIds: ["proj-812", "proj-source-011"],
    recentTasks: 7,
    taskIds: ["task-crawler-019", "task-crawler-122"],
    traces: [],
    exportIds: [],
    ticketIds: ["sup-2212", "sup-2215"],
    quotaAccountRef: "none",
    lookupKeys: [
      "usr-455",
      "crawler-owner@example.test",
      "tenant-crawler",
      "sup-2212",
      "sup-2215",
      "task-crawler-019",
      "task-crawler-122"
    ],
    riskFlags: ["crawler-rate-limit"],
    privacyRedaction: "Show source IDs and crawler status only; raw crawler documents remain hidden until source ownership evidence is approved.",
    auditRefs: ["au-002"],
    lookupActions: [
      {
        scope: "read_profile",
        requiredRole: "support_operator",
        decision: "allowed",
        evidenceRefs: ["sup-2212", "task-crawler-019", "au-002"],
        auditRef: "au-002",
        rationale: "Support can inspect the waiting-user crawler ticket without seeing raw crawler documents."
      },
      {
        scope: "retry_failed_task",
        requiredRole: "admin_operator",
        decision: "blocked",
        evidenceRefs: ["task-crawler-019", "sup-2212", "au-002"],
        auditRef: "au-002",
        rationale: "Crawler import retry is blocked until source ownership and robots evidence are attached."
      },
      {
        scope: "retry_failed_task",
        requiredRole: "admin_reviewer",
        decision: "allowed",
        evidenceRefs: ["task-crawler-122", "sup-2215", "cg-522", "cf-122", "au-013"],
        auditRef: "au-013",
        rationale: "Approved derivative review allows a one-time audited cancellation closure while provenance and retention evidence remain attached."
      },
      {
        scope: "temporary_hold",
        requiredRole: "admin_operator",
        decision: "requires_review",
        evidenceRefs: ["ab-309", "sup-2212", "au-002", "cf-118"],
        auditRef: "au-002",
        rationale: "Crawler rate-limit release requires crawler governance review and source-owner evidence."
      }
    ]
  }
];

export const supportAdminDeletionGovernanceContract: SupportAdminDeletionGovernanceContract = {
  schema: "stage1.support-admin-deletion-governance-local-contract.v1",
  contractId: "stage1.support-admin-deletion-governance-local-contract",
  routeMarker: "stage1.support-admin-deletion-governance-local-contract",
  blueprintItems: ["AD-12", "BE-12", "OP-12", "OP-13", "VF-5", "VF-7"],
  adminRoute: "admin/app/support/page.tsx",
  evidenceSource: "admin fixture local contract",
  requiredDeletionFields: [
    "requestId",
    "requestType",
    "subjectUserId",
    "tenantId",
    "supportTicketId",
    "status",
    "requiredRole",
    "secondReviewRequired",
    "secondReviewStatus",
    "abuseHoldRef",
    "linkedTraceIds",
    "linkedAssetIds",
    "linkedExportIds",
    "billingReferenceIds",
    "retainedEvidenceRefs",
    "deletionPlan",
    "retentionBoundary",
    "blockedReason",
    "userVisibleMessage",
    "auditRef"
  ],
  requiredLinkedEvidence: [
    "support_ticket",
    "abuse_hold",
    "trace_projection",
    "asset_or_export_ref",
    "billing_reference",
    "retention_boundary",
    "second_review",
    "immutable_audit"
  ],
  deniedProjectionFields: [
    "raw_support_body",
    "raw_prompt",
    "provider_payload",
    "billing_payload",
    "secret",
    "api_key",
    "authorization",
    "cookie",
    "signed_url",
    "stripe_payload",
    "webhook_signature"
  ],
  preservedDoNotLaunchConditions: [
    "public_legal_support_policy_not_deployed",
    "production_security_launch_checks_incomplete",
    "production_paid_billing_lifecycle",
    "object_storage_signed_retention_runtime_missing"
  ],
  blockedGateChecks: [
    "staging_legal_external_user_pages",
    "production_legal_support_policy",
    "production_security_launch_checks",
    "production_paid_billing_lifecycle"
  ],
  requests: [
    {
      requestId: "del-usr-301-account",
      requestType: "account_deletion",
      subjectUserId: "usr-301",
      tenantId: "tenant-alpha",
      supportTicketId: "sup-2201",
      status: "blocked_pending_evidence",
      requiredRole: "admin_reviewer",
      secondReviewRequired: true,
      secondReviewStatus: "required",
      abuseHoldRef: "hook-ab-300-hold",
      linkedTraceIds: ["tr-1004"],
      linkedAssetIds: ["asset-441"],
      linkedExportIds: ["ex-887"],
      billingReferenceIds: ["billing_admin_operation:bao-2201"],
      retainedEvidenceRefs: ["sup-2201", "ab-300", "au-002", "au-004", "tr-1004", "ex-887"],
      deletionPlan:
        "Do not delete account data while quota-drain hold and blocked export dispute are open; prepare redacted export of retained evidence for reviewer handoff.",
      retentionBoundary:
        "Keep immutable audit, billing ledger, support redaction proof, blocked export manifest, and abuse hold evidence until legal/support and billing retention windows pass.",
      blockedReason:
        "Account deletion cannot proceed until support ticket sup-2201, quota credit audit au-004, and abuse hold release evidence are reconciled.",
      userVisibleMessage:
        "We received the deletion request, but export dispute and billing evidence must be retained until the review and quota-credit audit finish.",
      auditRef: "au-004"
    },
    {
      requestId: "del-proj-790-export",
      requestType: "export_deletion",
      subjectUserId: "usr-318",
      tenantId: "tenant-ops",
      supportTicketId: "sup-2209",
      status: "ready_for_second_review",
      requiredRole: "admin_operator",
      secondReviewRequired: true,
      secondReviewStatus: "required",
      abuseHoldRef: "none",
      linkedTraceIds: ["tr-1019"],
      linkedAssetIds: ["asset-489"],
      linkedExportIds: ["ex-909"],
      billingReferenceIds: ["subscription:sub_2209"],
      retainedEvidenceRefs: ["sup-2209", "ex-909", "q-export", "tr-1019", "au-003"],
      deletionPlan:
        "Delete the failed export object only after regeneration evidence, manifest/QA proof, and retained audit refs are attached.",
      retentionBoundary:
        "Keep manifest metadata, trace projection, support ticket, quota release evidence, and billing subscription reference; delete only expired object bytes through object-retention cleanup.",
      blockedReason: "Second review still needs to confirm the regenerated package and quota release evidence before object deletion.",
      userVisibleMessage:
        "The failed ZIP can be removed after the replacement package and retained manifest evidence are reviewed.",
      auditRef: "au-003"
    },
    {
      requestId: "del-usr-455-crawler-project",
      requestType: "project_deletion",
      subjectUserId: "usr-455",
      tenantId: "tenant-crawler",
      supportTicketId: "sup-2212",
      status: "retention_hold",
      requiredRole: "admin_reviewer",
      secondReviewRequired: true,
      secondReviewStatus: "blocked",
      abuseHoldRef: "hook-ab-309-throttle",
      linkedTraceIds: ["none"],
      linkedAssetIds: ["none"],
      linkedExportIds: ["none"],
      billingReferenceIds: ["none"],
      retainedEvidenceRefs: ["sup-2212", "ab-309", "q-crawler", "au-002"],
      deletionPlan:
        "Hold project deletion until source ownership, robots evidence, crawler import hold, and support escalation closure are resolved.",
      retentionBoundary:
        "Keep crawler governance evidence and support ticket metadata; no raw source body is projected to support or admin deletion views.",
      blockedReason: "Source ownership details and robots evidence are missing, so project deletion cannot remove crawler governance evidence.",
      userVisibleMessage:
        "Crawler project deletion is paused while source ownership and crawler policy evidence are reviewed.",
      auditRef: "au-002"
    },
    {
      requestId: "del-billing-usr-318-review",
      requestType: "billing_data_erasure_review",
      subjectUserId: "usr-318",
      tenantId: "tenant-ops",
      supportTicketId: "sup-2204",
      status: "closed_no_action",
      requiredRole: "admin_superadmin",
      secondReviewRequired: false,
      secondReviewStatus: "completed",
      abuseHoldRef: "none",
      linkedTraceIds: ["tr-1019"],
      linkedAssetIds: ["asset-489"],
      linkedExportIds: ["ex-901"],
      billingReferenceIds: ["invoice:in_2204"],
      retainedEvidenceRefs: ["sup-2204", "invoice:in_2204", "tr-1019", "ex-901", "au-011"],
      deletionPlan:
        "No billing payload deletion is executed from support; invoice reference stays as safe projection and raw Stripe payload remains outside admin support fixtures.",
      retentionBoundary:
        "Keep invoice id, receipt link projection, support ticket, and audit ref while never projecting raw Stripe payload or webhook signature.",
      blockedReason: "No destructive action requested; safe billing reference review is complete.",
      userVisibleMessage:
        "Billing record review is complete; retained invoice references are required for subscription and tax audit records.",
      auditRef: "au-011"
    }
  ],
  canClearStagingGate: false,
  canClearProductionGate: false,
  canCloseDoNotLaunch: false,
  mutationControlsEnabled: false
};

export const quotaAccounts: QuotaAccount[] = [
  {
    userId: "usr-301",
    balance: 1280,
    reserved: 180,
    monthlyLimit: 3000,
    anomaly: "Quota drain suspected from repeated blocked exports.",
    lastTransaction: "refund 120 credits for ex-887"
  },
  {
    userId: "usr-318",
    balance: 8420,
    reserved: 420,
    monthlyLimit: 12000,
    anomaly: "None",
    lastTransaction: "commit 80 credits for ex-901"
  }
];

export const productionPaidBillingLifecycleEvidence: ProductionPaidBillingLifecycleEvidence = {
  id: "production_paid_billing_lifecycle_20260527T1945Z",
  environment: "production",
  status: "blocked",
  validatedAt: "2026-05-27T19:45:00Z",
  validatedByRole: "admin_superadmin",
  releaseGateCheckId: "production_paid_billing_lifecycle",
  doNotLaunchConditionId: "paid_billing_or_comp_only_mode_missing",
  billingLifecycleEvidencePath: "ops/evidence/production/billing-lifecycle.json",
  billingRefundCreditWebhookEvidencePath: "ops/evidence/production/billing-refund-credit-webhook.json",
  runtimeRequestIds: [
    "production-paid-billing-20260527T1945Z-checkout",
    "production-paid-billing-20260527T1945Z-active-subscription",
    "production-paid-billing-20260527T1945Z-cancellation",
    "production-paid-billing-20260527T1945Z-past-due",
    "production-paid-billing-20260527T1945Z-refund-credit-quota-reset",
    "production-paid-billing-20260527T1945Z-webhook-idempotency",
    "production-paid-billing-20260527T1945Z-gate-preservation"
  ],
  quotaAccountIds: ["usr-301", "usr-318"],
  supportTicketIds: ["sup-2201", "sup-2209"],
  auditRefs: ["au-004", "au-022"],
  coverage: [
    {
      area: "checkout_subscription_cancellation_past_due",
      status: "blocked",
      runtimeProbe:
        "Production billing replay verified Stripe is deferred, checkout is hidden for invite/comp-only mode, active paid subscriptions cannot be created, cancellation requires real Stripe subscription evidence, past_due requires real Stripe invoice evidence, and paid lifecycle rows remain open.",
      deploymentEvidence:
        "ops/evidence/production/billing-lifecycle.json records blocked checkout_request_id, active_subscription_probe, cancellation_probe, past_due_probe, entitlement_denial_probe, and tenant-scoped billing responses for production comp-only mode.",
      billingAuditEvidence:
        "Billing lifecycle evidence links audit au-022, support ticket sup-2209, quota account usr-318, and public billing policy evidence so deferred Stripe state is visible without clearing paid billing, backup, or upstream launch blockers.",
      linkedAdminArtifacts: [
        "admin/app/quota/page.tsx",
        "admin/app/support/page.tsx",
        "admin/lib/fixtures.ts:productionPaidBillingLifecycleEvidence"
      ],
      evidenceRefs: [
        "ops/evidence/production/billing-lifecycle.json",
        "ops/evidence/production/billing-refund-credit-webhook.json",
        "sup-2209",
        "usr-318",
        "au-022"
      ]
    },
    {
      area: "refund_credit_quota_reset",
      status: "blocked",
      runtimeProbe:
        "Production refund and credit replay verified Stripe refunds are deferred, admin comp credit has support reason, paid quota reset is disabled, failed-export refund requires paid export evidence, and paid lifecycle rows remain open.",
      deploymentEvidence:
        "ops/evidence/production/billing-refund-credit-webhook.json records blocked refund_ref, comp_admin_credit_ref, quota_reset_ref, failed_export_refund_ref, and deferred paid quota transaction probes for production accounts.",
      billingAuditEvidence:
        "Refund and credit evidence links quota account usr-301, support ticket sup-2201, failed export ex-887, quota audit au-004, and billing audit au-022 to prove deferred paid balance mutation state has support context and immutable audit.",
      linkedAdminArtifacts: [
        "admin/app/quota/page.tsx",
        "admin/app/support/page.tsx",
        "admin/app/exports/page.tsx"
      ],
      evidenceRefs: [
        "ops/evidence/production/billing-refund-credit-webhook.json",
        "ops/evidence/production/billing-lifecycle.json",
        "usr-301",
        "sup-2201",
        "ex-887",
        "au-004",
        "au-022"
      ]
    },
    {
      area: "webhook_idempotency",
      status: "blocked",
      runtimeProbe:
        "Production webhook replay verified Stripe webhook endpoint remains disabled in invite/comp-only mode and duplicate checkout, subscription.updated, invoice.payment_failed, refund.created, and quota_reset events cannot mutate paid subscription or quota state without Stripe evidence.",
      deploymentEvidence:
        "ops/evidence/production/billing-refund-credit-webhook.json records deferred webhook_event_ids, replay hashes, disabled endpoint response, and unchanged comp-only quota/subscription state after duplicate event delivery attempts.",
      billingAuditEvidence:
        "Webhook idempotency evidence links audit au-022, quota retry evidence from failed task controls, and support ticket sup-2209 so deferred billing event replay is traceable in admin support and quota pages.",
      linkedAdminArtifacts: [
        "admin/app/quota/page.tsx",
        "admin/app/support/page.tsx",
        "admin/app/queues/page.tsx"
      ],
      evidenceRefs: [
        "ops/evidence/production/billing-refund-credit-webhook.json",
        "ops/evidence/production/billing-lifecycle.json",
        "sup-2209",
        "task-export-489",
        "au-022"
      ]
    },
    {
      area: "gate_blocker_preservation",
      status: "blocked",
      runtimeProbe:
        "Production release-gate replay preserves production_paid_billing_lifecycle and paid_billing_or_comp_only_mode_missing because Stripe is deferred, while also preserving backup rollback, CI, and staging blockers.",
      deploymentEvidence:
        "The production gate fixture cites both exact billing lifecycle files as deferred no-go evidence, keeps the paid billing check blocked, and keeps aggregate no-go status until real Stripe, backup/rollback, and upstream gate evidence pass.",
      billingAuditEvidence:
        "Gate preservation links audits au-004 and au-022, support tickets sup-2201 and sup-2209, and remaining blocker ids so comp-only billing policy cannot imply paid billing, backup, rollback, CI, staging, or global production readiness.",
      linkedAdminArtifacts: [
        "admin/app/quota/page.tsx",
        "admin/app/operations/page.tsx",
        "admin/tests/admin-governance.test.mjs"
      ],
      evidenceRefs: [
        "ops/evidence/production/billing-lifecycle.json",
        "ops/evidence/production/billing-refund-credit-webhook.json",
        "au-004",
        "au-022",
        "production_paid_billing_lifecycle",
        "production_backup_rollback_incident"
      ]
    }
  ],
  gateImpact: {
    checklistItems: [
      "Production paid billing lifecycle runtime/deployment evidence 通过。",
      "Production checkout/subscription/cancellation/past_due runtime evidence 通过 under `ops/evidence/production/`。",
      "Production refund/credit/quota reset/webhook idempotency runtime evidence 通过 under `ops/evidence/production/`。"
    ],
    canClearCheckLevelItems: false,
    aggregateProductionGateStatus: "blocked_by_other_production_runtime_items",
    remainingBlockers: ["production_paid_billing_lifecycle", "production_backup_rollback_incident"]
  }
};

export const riskyExports: RiskyExport[] = [
  {
    id: "rx-41",
    exportId: "ex-887",
    rule: "forbidden-claims:v3",
    enforcementPoint: "export",
    severity: "high",
    action: "block",
    overrideEligible: false,
    auditRequired: true,
    reviewRationale: "Forbidden claims at export enforcement point cannot be overridden.",
    secondReviewRequired: false
  },
  {
    id: "rx-42",
    exportId: "ex-913",
    rule: "financial-claim-review:v1",
    enforcementPoint: "provider_response",
    severity: "medium",
    action: "require_admin_review",
    overrideEligible: true,
    auditRequired: true,
    reviewRationale: "Financial claim needs reviewer rationale before export can proceed.",
    secondReviewRequired: false
  },
  {
    id: "rx-43",
    exportId: "ex-922",
    rule: "watermark-risk:v2",
    enforcementPoint: "qa",
    severity: "low",
    action: "warn",
    overrideEligible: true,
    auditRequired: true,
    reviewRationale: "Watermark risk warning must stay visible in audit and export metadata.",
    secondReviewRequired: false
  }
];

export const releaseEvidence: ReleaseEvidence[] = [
  {
    id: "eg-001",
    target: "admin-route-smoke",
    gate: "local_alpha",
    status: "passed",
    providerEvidence: "Provider health route exposes contract, canary, routing, and release evidence.",
    canaryEvidence: "Skill release route exposes canary percent and canary evidence.",
    releaseEvidence: "Skill release route exposes rollback and release evidence before activation.",
    smokeEvidence: "admin/tests/admin-data.test.mjs verifies every Stage 0 admin route has PageHeader.",
    rollbackEvidence: "Rollback plans are present for each skill release fixture.",
    reviewerRationale: "Static route smoke is sufficient for the fixture-backed admin shell until backend APIs land.",
    rollbackTarget: "last-known-good-admin-shell",
    auditRef: "eg-001"
  },
  {
    id: "eg-002",
    target: "skill-claims-review@0.9.8",
    gate: "production_launch",
    status: "blocked",
    providerEvidence: "Internal QA provider contract passes, but real production provider evidence is missing.",
    canaryEvidence: "Canary is disabled until medical claim fixture and legal second review pass.",
    releaseEvidence: "Release blocked because high-risk policy lacks complete second-review evidence.",
    smokeEvidence: "Safety route surfaces rationale, audit requirement, and override eligibility.",
    rollbackEvidence: "Rollback target remains active skill-claims-review@0.9.7.",
    reviewerRationale: "High-risk admin changes require rationale, immutable audit, and second review.",
    rollbackTarget: "skill-claims-review@0.9.7",
    auditRef: "au-006"
  },
  {
    id: "eg-003",
    target: "OpenAI/image-render-dev",
    gate: "private_beta",
    status: "blocked",
    providerEvidence: "Provider degraded at 4.7% error rate; production contract and alert evidence incomplete.",
    canaryEvidence: "Reduced retry canary is limited to non-urgent image tasks.",
    releaseEvidence: "Private beta blocked until provider latency/error budget and spend alerts pass.",
    smokeEvidence: "Provider route exposes status, spend cap, routing action, and evidence fields.",
    rollbackEvidence: "Router can be shifted back to deterministic dev provider for local alpha only.",
    reviewerRationale: "No silent fallback to weaker providers is allowed by Rev2.",
    rollbackTarget: "deterministic-dev-provider",
    auditRef: "au-007"
  },
  {
    id: "eg-004",
    target: "skill-export-pack@1.8.1",
    gate: "production_launch",
    status: "passed",
    providerEvidence:
      "Production skill release evidence verifies the skill canary decision shape only; provider launch mode is validated separately by production provider evidence.",
    canaryEvidence:
      "cm-001 stayed healthy in the production canary replay while cm-011 and cm-012 kept stopped canary sv-182 at zero traffic.",
    releaseEvidence:
      "Release notes stage0-skill-export-pack-1.8.1 include SHA, migration list, config diff, feature flags, owner, smoke plan, rollback plan, known risks, go/no-go, eval summary, and canary summary.",
    smokeEvidence:
      "Production route smoke replay validated skill-export-pack@1.8.1 release metadata, eval refs, QA refs, canary thresholds, and rollback target before clearing only the skill release check.",
    rollbackEvidence:
      "Rollback target skill-export-pack@1.8.0 is active, route-compatible, and linked to rollback audit au-003 plus production skill release audit au-016.",
    reviewerRationale:
      "The export-pack skill release can clear the production skill canary check because eval, canary thresholds, release notes, rollback, and audit evidence are present while unrelated launch blockers stay open.",
    rollbackTarget: "skill-export-pack@1.8.0",
    auditRef: "au-016"
  },
  {
    id: "eg-005",
    target: "staging_legal_external_user_pages",
    gate: "private_beta",
    status: "blocked",
    providerEvidence:
      "External-user legal/support visibility requires deployed staging web probes; source artifacts and dry-run smoke reports cannot satisfy the private beta gate.",
    canaryEvidence:
      "Not a skill canary; the release gate remains blocked until legal_pages_visibility and support_contact_visibility coverage both pass from STAGING_WEB_URL.",
    releaseEvidence:
      "Private beta legal/support check remains blocked until ops/evidence/staging/legal-pages-external-user.json and ops/evidence/staging/support-contact-external-user.json are passing deployed external-user probe evidence for Terms, Privacy, Acceptable Use, AI/content disclaimer, IP complaint flow, visible support contact, report-problem path, and billing/support policy.",
    smokeEvidence:
      "scripts/staging_legal_support_visibility_smoke.sh defines the exact external-user HTTP probe, required routes, expected tokens, gate impact, and remaining object-storage blocker behavior.",
    rollbackEvidence:
      "If a legal/support page regresses, re-mark staging_legal_external_user_pages blocked, restore external_user_legal_pages_missing, and keep public beta expansion disabled.",
    reviewerRationale:
      "Legal/support visibility is user-facing launch evidence, so admin reviewers must require deployed external-user proof instead of accepting checked-in page files.",
    rollbackTarget: "private-beta-no-go",
    auditRef: "au-020"
  }
];

export const abuseEvents: AbuseEvent[] = [
  {
    id: "ab-300",
    userId: "usr-301",
    category: "quota_drain",
    severity: "high",
    resolution: "temporary_hold",
    evidence: "43 blocked export retries in 25 minutes.",
    assignedRole: "admin_reviewer",
    allowedActions: ["temporary_hold", "quota_credit_after_audit", "support_escalation"],
    linkedSupportTicket: "sup-2201",
    reviewRationale: "Repeated blocked exports indicate quota drain and require hold before retry or credit.",
    auditRef: "au-002"
  },
  {
    id: "ab-304",
    userId: "usr-411",
    category: "hidden_prompt_extraction",
    severity: "critical",
    resolution: "open",
    evidence: "Repeated attempts to extract prompt fragments from trace output.",
    assignedRole: "admin_superadmin",
    allowedActions: ["temporary_hold", "trace_redaction_review", "security_escalation"],
    linkedSupportTicket: "pending",
    reviewRationale: "Critical prompt extraction attempt cannot be resolved by support without security review.",
    auditRef: "au-008"
  },
  {
    id: "ab-309",
    userId: "usr-455",
    category: "crawler_abuse",
    severity: "medium",
    resolution: "rate_limited",
    evidence: "Source import burst tripped global crawler limit.",
    assignedRole: "admin_operator",
    allowedActions: ["rate_limit", "source_ownership_request", "crawler_import_hold"],
    linkedSupportTicket: "sup-2212",
    reviewRationale: "Crawler import remains held until source ownership and robots evidence are reviewed.",
    auditRef: "au-002"
  }
];

export const abuseControlHooks: AbuseControlHook[] = [
  {
    id: "hook-ab-300-hold",
    abuseEventId: "ab-300",
    userId: "usr-301",
    triggerSource: "abuse_queue",
    action: "temporary_hold",
    targetSurface: "export_share",
    enforcementPoint: "export_service",
    state: "active",
    executionMode: "enforced",
    lastDryRunEvidence: "dry-run hook replay hook-ab-300-hold denied export:create while preserving support upload and read-only project access.",
    hookPayload: "deny export:create and share:publish for usr-301 while preserving package read access and support attachment upload.",
    threshold: "More than 25 blocked export retries or quota-drain attempts in 30 minutes.",
    telemetrySignal: "abuse_event_count{category=quota_drain,user_id=usr-301} and export_retry_denied_total{reason=SAFETY_EXPORT_BLOCK} feed the admin abuse queue.",
    userVisibleState: "Account export and share publishing are temporarily held; existing projects stay readable and support upload remains available.",
    durationMinutes: 120,
    expiresAt: "2026-05-26 12:30",
    rollbackAction: "Remove export/share deny rule, replay only reviewer-approved failed export tasks, and keep quota credit pending until audit au-004 is reconciled.",
    releaseCondition: "Admin reviewer confirms support ticket sup-2201, quota audit au-004, and blocked QA evidence before any export retry.",
    releaseEvidenceRefs: ["sup-2201", "au-004", "ex-887", "tr-1004"],
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_reviewer",
    rbacDecision: "allowed",
    supportTicketId: "sup-2201",
    evidenceRefs: ["ab-300", "sup-2201", "au-002", "ex-887"],
    auditRef: "au-002",
    operatorRunbook: "Keep export/share actions denied at the export service, allow read-only project access, and release only after support and quota evidence are reconciled."
  },
  {
    id: "hook-ab-304-hold",
    abuseEventId: "ab-304",
    userId: "usr-411",
    triggerSource: "safety_block",
    action: "temporary_hold",
    targetSurface: "generation",
    enforcementPoint: "api_gateway",
    state: "armed",
    executionMode: "dry_run",
    lastDryRunEvidence: "dry-run gateway replay returned 423 account_hold for generation and trace-detail probes, but did not enforce because RBAC denied admin_operator.",
    hookPayload: "return 423 account_hold for generation, trace detail, and prompt-debug routes while allowing account settings and support contact.",
    threshold: "Any critical hidden prompt extraction attempt with trace output probing.",
    telemetrySignal: "safety_block_total{category=hidden_prompt_extraction} and trace_redaction_violation_total route to security-admin review.",
    userVisibleState: "Generation and trace-detail access would show an account hold message while settings and support remain reachable.",
    durationMinutes: 240,
    expiresAt: "2026-05-26 14:18",
    rollbackAction: "Clear gateway hold only after second-review completion, rotate exposed trace redaction fixtures, and keep prompt debug output disabled.",
    releaseCondition: "Security admin closes prompt extraction investigation and records second-review status before generation is restored.",
    releaseEvidenceRefs: ["ab-304", "au-008", "tr-1004"],
    requiredRole: "admin_superadmin",
    attemptedRole: "admin_operator",
    rbacDecision: "denied",
    supportTicketId: "pending",
    evidenceRefs: ["ab-304", "au-008", "tr-1004"],
    auditRef: "au-008",
    operatorRunbook: "Block quota-consuming generation requests at the gateway, preserve trace evidence, and escalate to security before support messaging."
  },
  {
    id: "hook-ab-309-throttle",
    abuseEventId: "ab-309",
    userId: "usr-455",
    triggerSource: "crawler_rate_limit",
    action: "rate_limit",
    targetSurface: "crawler_import",
    enforcementPoint: "crawler_scheduler",
    state: "active",
    executionMode: "enforced",
    lastDryRunEvidence: "dry-run scheduler replay reduced crawler fetch concurrency to zero and kept existing findings pending before operator enforcement.",
    hookPayload: "set crawler source import concurrency to zero for usr-455 and leave existing findings in pending governance review.",
    threshold: "Crawler source import burst exceeds 20 pending sources or 5 denied robots checks in 10 minutes.",
    telemetrySignal: "crawler_import_rate_limited_total{user_id=usr-455} and robots_denied_total keep the queue at zero fetch concurrency.",
    userVisibleState: "Crawler import is paused pending ownership review; project editing and support replies remain available.",
    durationMinutes: 60,
    expiresAt: "2026-05-26 11:41",
    rollbackAction: "Restore crawler import concurrency to one source per minute after ownership, robots, and source blocklist evidence pass review.",
    releaseCondition: "Crawler operator attaches source ownership, robots evidence, and support ticket sup-2212 before the import queue resumes.",
    releaseEvidenceRefs: ["sup-2212", "cf-118", "au-002"],
    requiredRole: "admin_operator",
    attemptedRole: "admin_operator",
    rbacDecision: "allowed",
    supportTicketId: "sup-2212",
    evidenceRefs: ["ab-309", "sup-2212", "au-002", "cf-118"],
    auditRef: "au-002",
    operatorRunbook: "Throttle crawler imports to zero new fetches, keep existing findings pending, and require ownership proof before allowlist changes."
  }
];

export const auditEvents: AuditEvent[] = [
  {
    id: "au-001",
    actor: "local-dev-admin",
    action: "marked export blocked",
    target: "ex-887",
    risk: "high",
    createdAt: "2026-05-25 16:16",
    rationale: "Forbidden claim detected at export enforcement point.",
    immutable: true,
    evidenceRefs: ["rx-41", "tr-1004", "sup-2201"],
    secondReviewStatus: "blocked"
  },
  {
    id: "au-002",
    actor: "trust-admin",
    action: "placed temporary hold",
    target: "usr-301",
    risk: "high",
    createdAt: "2026-05-25 16:30",
    rationale: "Quota drain and repeated safety blocks.",
    immutable: true,
    evidenceRefs: ["ab-300", "sup-2201", "qt-904"],
    secondReviewStatus: "required"
  },
  {
    id: "au-003",
    actor: "ops-admin",
    action: "started skill canary",
    target: "skill-export-pack@1.8.1",
    risk: "medium",
    createdAt: "2026-05-26 08:00",
    rationale: "Export completeness fixtures passed.",
    immutable: true,
    evidenceRefs: ["sv-181", "eg-001", "q-export"],
    secondReviewStatus: "not_required"
  },
  {
    id: "au-004",
    actor: "support-admin",
    action: "credited quota",
    target: "usr-301",
    risk: "low",
    createdAt: "2026-05-26 09:40",
    rationale: "Refund for blocked export package regeneration.",
    immutable: true,
    evidenceRefs: ["sup-2201", "qt-904", "ex-887"],
    secondReviewStatus: "not_required"
  },
  {
    id: "au-005",
    actor: "ops-admin",
    action: "prepared rollback target",
    target: "skill-brand-kit@2.4.1",
    risk: "high",
    createdAt: "2026-05-26 09:55",
    rationale: "High-risk brand-kit release cannot enter canary without rollback target and second review.",
    immutable: true,
    evidenceRefs: ["sv-248", "rv-100", "eg-001"],
    secondReviewStatus: "required"
  },
  {
    id: "au-006",
    actor: "legal-admin",
    action: "blocked production release",
    target: "skill-claims-review@0.9.8",
    risk: "high",
    createdAt: "2026-05-26 10:05",
    rationale: "Medical claim fixture and legal second-review evidence are incomplete.",
    immutable: true,
    evidenceRefs: ["sv-098", "eg-002", "rx-41"],
    secondReviewStatus: "blocked"
  },
  {
    id: "au-007",
    actor: "ops-admin",
    action: "blocked provider launch",
    target: "OpenAI/image-render-dev",
    risk: "medium",
    createdAt: "2026-05-26 10:12",
    rationale: "Provider private-beta gate blocked by degraded latency and incomplete alert evidence.",
    immutable: true,
    evidenceRefs: ["ph-1", "eg-003", "rv-101"],
    secondReviewStatus: "not_required"
  },
  {
    id: "au-008",
    actor: "security-admin",
    action: "opened prompt extraction investigation",
    target: "ab-304",
    risk: "critical",
    createdAt: "2026-05-26 10:18",
    rationale: "Critical prompt extraction abuse requires security investigation before support resolution.",
    immutable: true,
    evidenceRefs: ["ab-304", "tr-1004", "prompt-fragments"],
    secondReviewStatus: "required"
  },
  {
    id: "au-009",
    actor: "ops-admin",
    action: "paused skill canary",
    target: "skill-export-pack@1.8.2",
    risk: "medium",
    createdAt: "2026-05-26 09:32",
    rationale: "Export success and regression fixture pass rate crossed configured stop thresholds.",
    immutable: true,
    evidenceRefs: ["sv-182", "cm-011", "cm-012"],
    secondReviewStatus: "not_required"
  },
  {
    id: "au-010",
    actor: "trust-admin",
    action: "rolled back skill version",
    target: "skill-brand-kit@2.4.0",
    risk: "high",
    createdAt: "2026-05-24 17:10",
    rationale: "Critical brand/IP bad-sample cluster required rollback to skill-brand-kit@2.4.1.",
    immutable: true,
    evidenceRefs: ["sv-240", "cm-014", "fb-203"],
    secondReviewStatus: "completed"
  },
  {
    id: "au-011",
    actor: "support-admin",
    action: "authorized failed task retry",
    target: "task-export-489",
    risk: "medium",
    createdAt: "2026-05-26 10:22",
    rationale: "Manifest packaging failure is retry eligible after support ticket and QA warning evidence are attached.",
    immutable: true,
    evidenceRefs: ["task-export-489", "sup-2204", "q-export"],
    secondReviewStatus: "not_required"
  },
  {
    id: "au-012",
    actor: "legal-admin",
    action: "opened crawler takedown review",
    target: "cf-118",
    risk: "high",
    createdAt: "2026-05-26 10:35",
    rationale: "Rights-owner takedown claim requires blocking activation and deleting raw and derivative crawler material after evidence review.",
    immutable: true,
    evidenceRefs: ["cg-501", "cf-118", "ip-7001"],
    secondReviewStatus: "required"
  },
  {
    id: "au-013",
    actor: "legal-admin",
    action: "approved crawler derivative review",
    target: "cf-122",
    risk: "medium",
    createdAt: "2026-05-26 10:41",
    rationale: "Internal fixture permits derivative use with provenance links and bounded raw-content retention.",
    immutable: true,
    evidenceRefs: ["cg-522", "cf-122", "crawler-governance/crawler_approved_local_test_source"],
    secondReviewStatus: "not_required"
  },
  {
    id: "au-014",
    actor: "crawler-ops",
    action: "queued crawler raw retention delete",
    target: "cf-104",
    risk: "medium",
    createdAt: "2026-05-26 10:46",
    rationale: "Pending source approval cannot retain raw content beyond the limited review window.",
    immutable: true,
    evidenceRefs: ["cg-533", "cf-104", "crawler-source cs-18"],
    secondReviewStatus: "not_required"
  },
  {
    id: "au-015",
    actor: "staging-auth-admin",
    action: "validated staging auth rbac tenant audit",
    target: "private_beta_staging",
    risk: "high",
    createdAt: "2026-05-27 15:15",
    rationale: "External-user staging probes verified admin-session separation, cross-tenant denial, RBAC runtime outcomes, and append-only audit linkage.",
    immutable: true,
    evidenceRefs: [
      "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json",
      "rbac-release-001",
      "rbac-export-001"
    ],
    secondReviewStatus: "completed"
  },
  {
    id: "au-016",
    actor: "release-admin",
    action: "validated production skill release eval canary",
    target: "skill-export-pack@1.8.1",
    risk: "medium",
    createdAt: "2026-05-27 16:00",
    rationale:
      "Production skill release evidence confirms eval suite, canary thresholds, release notes, rollback target, and audit linkage while preserving unrelated launch blockers.",
    immutable: true,
    evidenceRefs: ["sv-181", "sv-182", "eg-004", "cm-001", "cm-011", "cm-012"],
    secondReviewStatus: "not_required"
  },
  {
    id: "au-017",
    actor: "security-admin",
    action: "validated production security launch checks",
    target: "production_security_launch_checks",
    risk: "high",
    createdAt: "2026-05-27 17:00",
    rationale:
      "Production security evidence validates secure session cookies, CSRF same-site enforcement, secret redaction, admin privacy surfaces, and release-gate blocker preservation.",
    immutable: true,
    evidenceRefs: [
      "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
      "au-015",
      "rb-production-admin-security"
    ],
    secondReviewStatus: "completed"
  },
  {
    id: "au-018",
    actor: "trust-admin",
    action: "validated staging eval qa safety runtime",
    target: "staging_eval_qa_safety_runtime",
    risk: "high",
    createdAt: "2026-05-27 19:00",
    rationale:
      "Staging safety evidence validates brief, provider request, provider response, QA, and export enforcement while preserving unrelated private-beta blockers.",
    immutable: true,
    evidenceRefs: [
      "ops/evidence/staging/20260527T1900Z-eval-qa-safety.json",
      "rbac-safety-001",
      "rbac-export-001",
      "rx-41",
      "rv-102"
    ],
    secondReviewStatus: "completed"
  },
  {
    id: "au-019",
    actor: "quota-ops-admin",
    action: "validated staging quota rate-limit spend-cap runtime",
    target: "staging_quota_rate_limit_spend_cap",
    risk: "high",
    createdAt: "2026-05-27 20:15",
    rationale:
      "Staging quota evidence validates reservation, commit, refund, idempotency, rate-limit, provider spend-cap, and emergency kill-switch enforcement while preserving unrelated private-beta blockers.",
    immutable: true,
    evidenceRefs: [
      "ops/evidence/staging/20260527T2015Z-quota-rate-limit-spend-cap.json",
      "rbac-quota-001",
      "rbac-provider-001",
      "qt-904"
    ],
    secondReviewStatus: "completed"
  },
  {
    id: "au-020",
    actor: "legal-support-admin",
    action: "recorded blocked staging legal support visibility",
    target: "staging_legal_external_user_pages",
    risk: "high",
    createdAt: "2026-05-27 22:30",
    rationale:
      "External-user staging probes are blocked by missing STAGING_WEB_URL; canonical split evidence records missing_staging_web_url diagnostics while preserving legal/support and object-storage retention blockers.",
    immutable: true,
    evidenceRefs: [
      "rb-private-beta-legal-support-visibility",
      "eg-005",
      "ops/evidence/staging/legal-pages-external-user.json",
      "ops/evidence/staging/support-contact-external-user.json"
    ],
    secondReviewStatus: "completed"
  },
  {
    id: "au-021",
    actor: "provider-admin",
    action: "validated production provider mode",
    target: "production_provider_or_comp_only_mode",
    risk: "high",
    createdAt: "2026-05-27 19:30",
    rationale:
      "Production provider mode evidence verifies real production provider contract, monitoring, cost tracking, staging verification, public paid/real-generation claim alignment, and dev-provider claim denial while preserving unrelated launch blockers.",
    immutable: true,
    evidenceRefs: [
      "ops/evidence/production/provider-mode.json",
      "ops/evidence/production/public-paid-real-generation-claims.json",
      "ph-1",
      "rbac-provider-001"
    ],
    secondReviewStatus: "completed"
  },
  {
    id: "au-022",
    actor: "billing-admin",
    action: "validated production paid billing lifecycle",
    target: "production_paid_billing_lifecycle",
    risk: "high",
    createdAt: "2026-05-27 19:45",
    rationale:
      "Production paid billing lifecycle evidence verifies checkout, active subscription, cancellation, past_due, refund, credit, quota reset, and webhook idempotency while preserving backup, CI, and staging launch blockers.",
    immutable: true,
    evidenceRefs: [
      "ops/evidence/production/billing-lifecycle.json",
      "ops/evidence/production/billing-refund-credit-webhook.json",
      "sup-2201",
      "sup-2209",
      "qt-904"
    ],
    secondReviewStatus: "completed"
  }
];

export const incidentLogs: IncidentLog[] = [
  {
    id: "inc-20260526-queue",
    severity: "sev2",
    status: "mitigating",
    startedAt: "2026-05-26 09:12",
    detectedBy: "queue q-export dead-letter threshold",
    impactedSystems: ["export-packaging", "support-console", "quota-refund"],
    customerImpact: "Three private-beta export jobs failed after QA report packaging.",
    mitigation: "Hold automatic retries, regenerate eligible packages manually, and credit affected users after audit.",
    owner: "ops-admin",
    nextUpdateAt: "2026-05-26 10:00",
    linkedQueues: ["q-export"],
    linkedSupportTickets: ["sup-2201", "sup-2204"],
    auditRefs: ["au-004"],
    rollbackPlan: "Route package jobs back to skill-export-pack@1.8.0 and replay failed exports after manifest validation."
  },
  {
    id: "inc-20260525-crawler",
    severity: "sev3",
    status: "resolved",
    startedAt: "2026-05-25 14:30",
    detectedBy: "crawler source blocklist alert",
    impactedSystems: ["crawler-findings", "review-queue"],
    customerImpact: "No user-visible impact; pending imports held for source review.",
    mitigation: "Blocked disallowed source, kept pending-review imports out of active prompt and skill flows.",
    owner: "trust-admin",
    nextUpdateAt: "resolved",
    linkedQueues: ["q-crawler"],
    linkedSupportTickets: [],
    auditRefs: ["au-002"],
    rollbackPlan: "Keep source-normalizer canary stopped until robots evidence and legal metadata are reviewed."
  }
];

export const maintenanceBanners: MaintenanceBanner[] = [
  {
    id: "mb-exports-20260526",
    status: "scheduled",
    scope: "web",
    audience: "private_beta",
    message: "Export regeneration is under maintenance while failed packages are replayed.",
    startsAt: "2026-05-26 10:00",
    endsAt: "2026-05-26 11:00",
    owner: "ops-admin",
    approval: "support_operator approval required before activation",
    auditRef: "au-004"
  },
  {
    id: "mb-admin-local",
    status: "active",
    scope: "admin",
    audience: "internal",
    message: "Local alpha admin data is fixture-backed until backend admin APIs are connected.",
    startsAt: "2026-05-26 00:00",
    endsAt: "2026-05-27 00:00",
    owner: "platform-admin",
    approval: "local-dev-admin",
    auditRef: "eg-001"
  }
];
