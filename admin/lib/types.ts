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

export type SkillVersion = {
  id: string;
  skillId: string;
  version: string;
  status: "review" | "canary" | "approved" | "rolled-back";
  reviewer: string;
  secondReviewRequired: boolean;
  secondReviewer: string;
  reviewerRationale: string;
  evalSummary: string;
  provenance: string;
  rollbackPlan: string;
  canaryPercent: number;
  canaryEvidence: string;
  releaseEvidence: string;
};

export type CrawlerFinding = {
  id: string;
  source: string;
  type: "source" | "finding";
  status: "pending" | "approved" | "blocked";
  provenance: string;
  riskLabels: string[];
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
};

export type AuditEvent = {
  id: string;
  actor: string;
  action: string;
  target: string;
  risk: RiskLevel;
  createdAt: string;
  rationale: string;
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
};
