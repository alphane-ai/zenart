import type {
  AbuseEvent,
  AgentTrace,
  AuditEvent,
  CrawlerFinding,
  ExportJob,
  FeedbackItem,
  ProviderHealth,
  PromptFragment,
  QuotaAccount,
  QueueHealth,
  RiskyExport,
  Skill,
  SkillVersion,
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
    evalSummary: "92.1% pass, two regression fixtures need second reviewer.",
    provenance: "trace tr-1004, feedback fb-203, prompt mutation pm-44",
    rollbackPlan: "Restore 2.4.1 and disable launch campaign palette branch.",
    canaryPercent: 0
  },
  {
    id: "sv-181",
    skillId: "skill-export-pack",
    version: "1.8.1",
    status: "canary",
    reviewer: "ops-admin",
    evalSummary: "ZIP completeness and QA report fixtures passing.",
    provenance: "export failures ex-887 and ex-901",
    rollbackPlan: "Set router to 1.8.0 and replay failed jobs.",
    canaryPercent: 15
  },
  {
    id: "sv-098",
    skillId: "skill-claims-review",
    version: "0.9.8",
    status: "review",
    reviewer: "trust-admin",
    evalSummary: "Legal and financial claim fixtures passing; medical pending.",
    provenance: "safety rule sr-21, red-team run rt-12",
    rollbackPlan: "Keep 0.9.7 active; invalidate staged policy bundle.",
    canaryPercent: 0
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
    routingAction: "Reduce non-urgent image retries by 25%."
  },
  {
    id: "ph-2",
    provider: "Internal",
    model: "qa-policy",
    status: "healthy",
    p95LatencyMs: 510,
    errorRate: 0.002,
    spendCapUsedPercent: 18,
    routingAction: "Keep all QA enforcement points active."
  },
  {
    id: "ph-3",
    provider: "Crawler",
    model: "source-normalizer",
    status: "blocked",
    p95LatencyMs: 0,
    errorRate: 1,
    spendCapUsedPercent: 3,
    routingAction: "Blocked by source allowlist incident."
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
    auditRequired: true
  },
  {
    id: "rx-42",
    exportId: "ex-913",
    rule: "financial-claim-review:v1",
    enforcementPoint: "provider_response",
    severity: "medium",
    action: "require_admin_review",
    overrideEligible: true,
    auditRequired: true
  },
  {
    id: "rx-43",
    exportId: "ex-922",
    rule: "watermark-risk:v2",
    enforcementPoint: "qa",
    severity: "low",
    action: "warn",
    overrideEligible: true,
    auditRequired: true
  }
];

export const abuseEvents: AbuseEvent[] = [
  {
    id: "ab-300",
    userId: "usr-301",
    category: "quota_drain",
    severity: "high",
    resolution: "temporary_hold",
    evidence: "43 blocked export retries in 25 minutes."
  },
  {
    id: "ab-304",
    userId: "usr-411",
    category: "hidden_prompt_extraction",
    severity: "critical",
    resolution: "open",
    evidence: "Repeated attempts to extract prompt fragments from trace output."
  },
  {
    id: "ab-309",
    userId: "usr-455",
    category: "crawler_abuse",
    severity: "medium",
    resolution: "rate_limited",
    evidence: "Source import burst tripped global crawler limit."
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
    rationale: "Forbidden claim detected at export enforcement point."
  },
  {
    id: "au-002",
    actor: "trust-admin",
    action: "placed temporary hold",
    target: "usr-301",
    risk: "high",
    createdAt: "2026-05-25 16:30",
    rationale: "Quota drain and repeated safety blocks."
  },
  {
    id: "au-003",
    actor: "ops-admin",
    action: "started skill canary",
    target: "skill-export-pack@1.8.1",
    risk: "medium",
    createdAt: "2026-05-26 08:00",
    rationale: "Export completeness fixtures passed."
  },
  {
    id: "au-004",
    actor: "support-admin",
    action: "credited quota",
    target: "usr-301",
    risk: "low",
    createdAt: "2026-05-26 09:40",
    rationale: "Refund for blocked export package regeneration."
  }
];
