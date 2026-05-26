export type SubscriptionStatus = "trialing" | "active" | "past_due" | "inactive";

export type ChatRole = "user" | "assistant" | "system";

export type QaSeverity = "pass" | "warn" | "block";

export type ExportFormat = "zip" | "pdf-placeholder";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface AccountSettings {
  brandName: string;
  defaultExportFormat: ExportFormat;
  emailNotifications: boolean;
}

export interface BillingPlan {
  id: string;
  name: string;
  status: SubscriptionStatus;
  quotaLimit: number;
  quotaUsed: number;
  resetAt: string;
  renewalMode: "mock-checkout" | "provider";
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  brief: string;
  assetCount: number;
  exportCount: number;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  body: string;
  createdAt: string;
}

export interface BriefState {
  prompt: string;
  confirmed: boolean;
  missingInfo: string[];
  references: ReferenceAsset[];
}

export interface ReferenceAsset {
  id: string;
  name: string;
  kind: "image" | "document" | "url";
  status: "attached" | "queued";
}

export interface Candidate {
  id: string;
  title: string;
  strategy: string;
  palette: string[];
  rationale: string;
  assetPrompt: string;
}

export interface CanvasNode {
  id: string;
  title: string;
  kind: "brief" | "candidate" | "iteration" | "export";
  x: number;
  y: number;
  body: string;
}

export interface CanvasEdge {
  from: string;
  to: string;
}

export interface CanvasVersion {
  id: string;
  label: string;
  createdAt: string;
  nodeCount: number;
}

export interface PackageItem {
  id: string;
  sourceId: string;
  title: string;
  type: "candidate" | "canvas-frame" | "reference";
  addedAt: string;
}

export interface PackageManifest {
  package_id: string;
  project_id: string;
  created_at: string;
  required_outputs: string[];
  items: Array<{
    id: string;
    title: string;
    type: PackageItem["type"];
    provenance: string;
  }>;
}

export interface QaFinding {
  id: string;
  severity: QaSeverity;
  title: string;
  detail: string;
}

export interface ExportRecord {
  id: string;
  format: ExportFormat;
  status: "ready" | "blocked" | "failed" | "running";
  createdAt: string;
  fileName: string;
  manifest: PackageManifest;
  qaReport: QaFinding[];
}

export interface ShareLink {
  id: string;
  exportId: string;
  status: "disabled" | "active" | "revoked";
  access: "private" | "link";
  createdAt: string;
  expiresAt?: string;
  url?: string;
  reason?: string;
}

export interface SupportTicket {
  id: string;
  projectId: string;
  category: "bug" | "billing" | "export" | "quality" | "other";
  body: string;
  status: "open" | "triaged";
  linkedExportId?: string;
  linkedQuotaSnapshot: {
    used: number;
    limit: number;
  };
}

export interface WorkspaceState {
  session: SessionUser;
  account: AccountSettings;
  billing: BillingPlan;
  projects: ProjectSummary[];
  activeProjectId: string;
  chat: ChatMessage[];
  brief: BriefState;
  candidates: Candidate[];
  selectedCandidateId?: string;
  canvas: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    versions: CanvasVersion[];
    activeVersionId: string;
    autosavedAt: string;
  };
  packageItems: PackageItem[];
  exports: ExportRecord[];
  shareLinks: ShareLink[];
  supportTickets: SupportTicket[];
}

export interface ZenArtClient {
  loadWorkspace(): Promise<WorkspaceState>;
  confirmBrief(prompt: string): Promise<WorkspaceState>;
  attachReference(asset: Pick<ReferenceAsset, "name" | "kind">): Promise<WorkspaceState>;
  selectCandidate(candidateId: string): Promise<WorkspaceState>;
  iterateSelected(instruction: string): Promise<WorkspaceState>;
  restoreCanvasVersion(versionId: string): Promise<WorkspaceState>;
  addPackageItem(sourceId: string): Promise<WorkspaceState>;
  createExport(format: ExportFormat): Promise<WorkspaceState>;
  createShareLink(exportId: string): Promise<WorkspaceState>;
  createMockCheckout(): Promise<WorkspaceState>;
  updateAccount(settings: AccountSettings): Promise<WorkspaceState>;
  reportProblem(input: Pick<SupportTicket, "category" | "body" | "linkedExportId">): Promise<WorkspaceState>;
}
