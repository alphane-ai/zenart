import type {
  AbuseEvent,
  AbuseControlHook,
  AdminRbacEvidence,
  AdminReviewDecision,
  AnalyticsReport,
  AgentTrace,
  AuditEvent,
  CrawlerSourceApproval,
  CrawlerGovernanceWorkflow,
  CrawlerFinding,
  ExportJob,
  FailedTaskControl,
  FeedbackItem,
  IncidentLog,
  MaintenanceBanner,
  OperationalDashboard,
  ProviderHealth,
  AlertRoute,
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
    target: "skill-brand-kit@2.5.0",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_operator",
    decision: "second_review_required",
    secondReviewRequired: true,
    secondReviewStatus: "required",
    rationale: "High-risk skill release cannot enter canary from an operator-only action; reviewer and second-review evidence are required.",
    auditRef: "au-005",
    evidenceRefs: ["rv-100", "sv-248", "eg-001"]
  },
  {
    id: "rbac-crawler-001",
    surface: "crawler_import",
    target: "cf-118",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_operator",
    decision: "denied",
    secondReviewRequired: true,
    secondReviewStatus: "required",
    rationale: "Crawler takedown and derivative material deletion must be reviewed by an admin reviewer before activation or retention changes.",
    auditRef: "au-012",
    evidenceRefs: ["cg-501", "cf-118", "ip-7001"]
  },
  {
    id: "rbac-prompt-001",
    surface: "prompt_approval",
    target: "pf-044",
    requiredRole: "admin_reviewer",
    attemptedRole: "support_operator",
    decision: "denied",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    rationale: "Support operators can attach feedback but cannot approve prompt fragments into active routing without reviewer permission.",
    auditRef: "au-008",
    evidenceRefs: ["pf-044", "fb-222", "prompt-fragments"]
  },
  {
    id: "rbac-provider-001",
    surface: "provider_routing",
    target: "OpenAI/image-render-dev",
    requiredRole: "admin_operator",
    attemptedRole: "admin_operator",
    decision: "allowed",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    rationale: "Provider retry-weight reduction is allowed for an admin operator because safety fallback remains unchanged and evidence is audit-linked.",
    auditRef: "au-007",
    evidenceRefs: ["rv-101", "ph-1", "eg-003"]
  },
  {
    id: "rbac-quota-001",
    surface: "quota_override",
    target: "usr-301",
    requiredRole: "admin_operator",
    attemptedRole: "support_operator",
    decision: "denied",
    secondReviewRequired: false,
    secondReviewStatus: "not_required",
    rationale: "Support can request quota credit, but direct quota mutation requires admin operator permission and immutable support-ticket evidence.",
    auditRef: "au-004",
    evidenceRefs: ["sup-2201", "qt-904", "ex-887"]
  },
  {
    id: "rbac-safety-001",
    surface: "safety_rule",
    target: "forbidden-claims:v3",
    requiredRole: "admin_superadmin",
    attemptedRole: "admin_reviewer",
    decision: "second_review_required",
    secondReviewRequired: true,
    secondReviewStatus: "blocked",
    rationale: "Blocking safety policy changes affect export eligibility and need superadmin ownership plus completed second review before activation.",
    auditRef: "au-006",
    evidenceRefs: ["rx-41", "sv-098", "eg-002"]
  },
  {
    id: "rbac-export-001",
    surface: "export_override",
    target: "ex-887",
    requiredRole: "admin_reviewer",
    attemptedRole: "admin_reviewer",
    decision: "denied",
    secondReviewRequired: false,
    secondReviewStatus: "blocked",
    rationale: "Reviewer role is present, but blocking forbidden-claim export overrides are never eligible; the RBAC result remains denied.",
    auditRef: "au-001",
    evidenceRefs: ["rv-102", "rx-41", "tr-1004"]
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
    requester: "rights-owner@example.invalid",
    sourceContact: "IP complaint flow ticket ip-7001 with crawler-takedown tag",
    derivativeUseStatus: "blocked",
    rawRetentionAction: "delete_raw_and_derivatives",
    linkedReview: "rv-crawler-118",
    requiredEvidenceRefs: ["cf-118", "crawler-source cs-21", "ip-7001", "au-012"],
    blockedActivation: true,
    reviewerRole: "admin_reviewer",
    reviewRationale:
      "Exact-text finding must stay blocked while the rights-owner claim is reviewed and all raw and derivative material is queued for deletion.",
    auditRef: "au-012"
  },
  {
    id: "cg-522",
    findingId: "cf-122",
    requestType: "derivative_review",
    status: "approved",
    requester: "legal_fixture_reviewer",
    sourceContact: "Approved internal fixture source with documented derivative-use allowance",
    derivativeUseStatus: "allowed",
    rawRetentionAction: "retain_with_limit",
    linkedReview: "rv-crawler-122",
    requiredEvidenceRefs: ["cf-122", "crawler-governance/crawler_approved_local_test_source", "au-013"],
    blockedActivation: false,
    reviewerRole: "admin_reviewer",
    reviewRationale:
      "Derivative use is allowed by fixture legal metadata, provenance remains linked, and raw content retention is limited to the approved window.",
    auditRef: "au-013"
  },
  {
    id: "cg-533",
    findingId: "cf-104",
    requestType: "raw_retention_delete",
    status: "intake",
    requester: "crawler-ops",
    sourceContact: "Pending source approval; contact process must be confirmed before import",
    derivativeUseStatus: "unknown",
    rawRetentionAction: "delete_raw",
    linkedReview: "rv-crawler-104",
    requiredEvidenceRefs: ["cf-104", "crawler-source cs-18", "au-014"],
    blockedActivation: true,
    reviewerRole: "admin_operator",
    reviewRationale:
      "Pending source lacks complete legal contact and derivative-use evidence, so activation remains blocked and raw content expires unless review approves it.",
    auditRef: "au-014"
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
    regressionFixtureRef: "none-abuse-filtered"
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
    evidenceRefs: ["ph-1", "eg-003", "au-007"]
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
    evidenceRefs: ["q-export", "inc-20260526-queue", "au-004", "sup-2204"]
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
    evidenceRefs: ["q-crawler", "inc-20260525-crawler", "au-012", "cg-501"]
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
    evidenceRefs: ["ab-304", "au-008", "tr-1004"]
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
    incidentRef: "none",
    auditRef: "au-007",
    evidenceRefs: ["od-provider-latency", "ph-1", "eg-003", "au-007"]
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
    incidentRef: "inc-20260526-queue",
    auditRef: "au-004",
    evidenceRefs: ["od-export-failure", "q-export", "inc-20260526-queue", "sup-2204", "au-004"]
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
    incidentRef: "inc-20260525-crawler",
    auditRef: "au-012",
    evidenceRefs: ["od-crawler-policy", "inc-20260525-crawler", "cf-118", "cg-501", "au-012"]
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
    incidentRef: "none",
    auditRef: "au-008",
    evidenceRefs: ["od-admin-security", "ab-304", "au-008", "tr-1004"]
  }
];

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

export const failedTaskControls: FailedTaskControl[] = [
  {
    id: "task-brief-441",
    queueId: "q-brief",
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
    requestedAction: "hold",
    actionEligibility: "blocked",
    allowedRole: "admin_reviewer",
    requestedByRole: "support_operator",
    rbacDecision: "denied",
    idempotencyKey: "hold:task-brief-441:sup-2201:au-001",
    quotaEffect: "refund_pending",
    closureEvidenceRefs: ["sup-2201", "tr-1004", "ex-887", "au-001", "au-004"],
    operatorRunbook: "Do not retry. Keep the task blocked, preserve the QA report, and apply audited quota credit only after support review.",
    auditRef: "au-001"
  },
  {
    id: "task-export-489",
    queueId: "q-export",
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
    requestedAction: "retry",
    actionEligibility: "eligible",
    allowedRole: "support_operator",
    requestedByRole: "support_operator",
    rbacDecision: "allowed",
    idempotencyKey: "retry:task-export-489:sup-2204:manifest-missing",
    quotaEffect: "reserved_credit_released",
    closureEvidenceRefs: ["task-export-489", "sup-2204", "tr-1019", "ex-901", "au-011"],
    operatorRunbook: "Attach ticket sup-2204, verify QA warning evidence, retry once, and write the resulting audit ref before closure.",
    auditRef: "au-011"
  },
  {
    id: "task-crawler-019",
    queueId: "q-crawler",
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
    requestedAction: "cancel",
    actionEligibility: "requires_review",
    allowedRole: "admin_operator",
    requestedByRole: "admin_operator",
    rbacDecision: "second_review_required",
    idempotencyKey: "cancel:task-crawler-019:sup-2212:ownership-missing",
    quotaEffect: "none",
    closureEvidenceRefs: ["task-crawler-019", "sup-2212", "ab-309", "q-crawler", "au-002"],
    operatorRunbook: "Keep the source import cancelled, request ownership proof, and reopen only after crawler review evidence is attached.",
    auditRef: "au-002"
  }
];

export const exportJobs: ExportJob[] = [
  {
    id: "ex-887",
    userId: "usr-301",
    packageId: "pkg-441",
    status: "blocked",
    qaSeverity: "blocking",
    regenerateEligible: true,
    failureReason: "Forbidden claim in final export QA."
  },
  {
    id: "ex-901",
    userId: "usr-318",
    packageId: "pkg-489",
    status: "completed",
    qaSeverity: "warning",
    regenerateEligible: false,
    failureReason: "None"
  },
  {
    id: "ex-909",
    userId: "usr-355",
    packageId: "pkg-510",
    status: "failed",
    qaSeverity: "info",
    regenerateEligible: true,
    failureReason: "ZIP manifest missing QA report."
  }
];

export const supportTickets: SupportTicket[] = [
  {
    id: "sup-2201",
    status: "escalated",
    priority: "high",
    userId: "usr-301",
    projectId: "proj-774",
    taskId: "task-brief-441",
    traceId: "tr-1004",
    assetId: "asset-441",
    exportId: "ex-887",
    quotaTransactionId: "qt-904",
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
    taskId: "task-export-489",
    traceId: "tr-1019",
    assetId: "asset-489",
    exportId: "ex-901",
    quotaTransactionId: "qt-911",
    subject: "Low contrast phone number in mobile export.",
    nextAction: "Attach QA warning to regeneration request and keep original package immutable.",
    auditRef: "pending"
  },
  {
    id: "sup-2212",
    status: "waiting_user",
    priority: "low",
    userId: "usr-455",
    projectId: "proj-812",
    taskId: "task-crawler-019",
    traceId: "none",
    assetId: "none",
    exportId: "none",
    quotaTransactionId: "none",
    subject: "Crawler source import paused after abuse rate limit.",
    nextAction: "Request source ownership details before any retry or allowlist change.",
    auditRef: "au-002"
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
    exportIds: ["ex-901"],
    ticketIds: ["sup-2204"],
    quotaAccountRef: "usr-318",
    lookupKeys: ["usr-318", "ops@example.test", "tenant-ops", "sup-2204", "ex-901", "tr-1019"],
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
    taskIds: ["task-crawler-019"],
    traces: [],
    exportIds: [],
    ticketIds: ["sup-2212"],
    quotaAccountRef: "none",
    lookupKeys: ["usr-455", "crawler-owner@example.test", "tenant-crawler", "sup-2212", "task-crawler-019"],
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
