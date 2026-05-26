import type {
  AbuseEvent,
  AdminReviewDecision,
  AgentTrace,
  AuditEvent,
  CrawlerFinding,
  ExportJob,
  FeedbackItem,
  IncidentLog,
  MaintenanceBanner,
  ProviderHealth,
  PromptFragment,
  QuotaAccount,
  QueueHealth,
  ReleaseEvidence,
  RiskyExport,
  Skill,
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
    canaryEvidence: "Canary blocked until second reviewer accepts regression fixture variance.",
    releaseEvidence: "Release notes draft linked to eval suite es-stage0-brand and rollback target 2.4.1.",
    rollbackTarget: "skill-brand-kit@2.4.1",
    rollbackAuditRef: "au-005"
  },
  {
    id: "sv-181",
    skillId: "skill-export-pack",
    version: "1.8.1",
    status: "canary",
    reviewer: "ops-admin",
    secondReviewRequired: false,
    secondReviewer: "not-required",
    reviewerRationale: "Low-risk export completeness fix with passing ZIP and QA report fixtures.",
    evalSummary: "ZIP completeness and QA report fixtures passing.",
    provenance: "export failures ex-887 and ex-901",
    rollbackPlan: "Set router to 1.8.0 and replay failed jobs.",
    canaryPercent: 15,
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
    canaryEvidence: "Canary disabled until medical claim fixture and legal second-review pass.",
    releaseEvidence: "Production release blocked pending reviewer rationale and policy bundle audit.",
    rollbackTarget: "skill-claims-review@0.9.7",
    rollbackAuditRef: "au-006"
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
    delayed: false
  },
  {
    id: "fb-211",
    kind: "qa_warning",
    status: "open",
    attribution: "wf-790 · export ex-901 · tr-1019",
    signal: "Structured phone number was low contrast on mobile export.",
    delayed: true
  },
  {
    id: "fb-217",
    kind: "rating",
    status: "resolved",
    attribution: "wf-799 · prompt pf-051",
    signal: "Five-star rating after package add and export.",
    delayed: false
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

export const queueHealth: QueueHealth[] = [
  {
    id: "q-brief",
    name: "brief-orchestration",
    pending: 18,
    running: 4,
    deadLetters: 1,
    oldestAgeMinutes: 22,
    action: "Inspect stalled missing-info clarification."
  },
  {
    id: "q-export",
    name: "export-packaging",
    pending: 7,
    running: 2,
    deadLetters: 3,
    oldestAgeMinutes: 84,
    action: "Regenerate eligible failed packages."
  },
  {
    id: "q-crawler",
    name: "crawler-findings",
    pending: 31,
    running: 1,
    deadLetters: 5,
    oldestAgeMinutes: 240,
    action: "Review source blocklist and retry approved hosts."
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
    projects: 4,
    recentTasks: 12,
    traces: ["tr-1004"],
    riskFlags: ["safety-block-review"]
  },
  {
    id: "usr-318",
    email: "ops@example.test",
    plan: "Pro",
    projects: 9,
    recentTasks: 31,
    traces: ["tr-1019"],
    riskFlags: []
  },
  {
    id: "usr-455",
    email: "crawler-owner@example.test",
    plan: "Team trial",
    projects: 2,
    recentTasks: 7,
    traces: [],
    riskFlags: ["crawler-rate-limit"]
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
