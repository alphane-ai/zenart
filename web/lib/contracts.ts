export type SubscriptionStatus = "trialing" | "active" | "past_due" | "inactive";
export type BillingScenario = "trialing" | "active" | "past_due" | "inactive" | "quota_exhausted";

export type ChatRole = "user" | "assistant" | "system";

export type QaSeverity = "pass" | "warn" | "block";

export type ExportFormat = "zip" | "pdf-placeholder";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface SessionContract {
  id: string;
  user: SessionUser;
  status: "authenticated" | "expired" | "signed_out";
  issuedAt: string;
  expiresAt: string;
  refreshAfter: string;
  cookie: {
    name: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "strict" | "lax" | "none";
    path: string;
  };
  csrf: {
    strategy: "same-site-origin-check";
    headerName: string;
    headerValue: string;
    sameSiteRequired: "lax-or-strict";
    credentialMode: "include";
    originPolicy: "same-site-only";
    protectedMethods: Array<"POST" | "PUT" | "PATCH" | "DELETE">;
  };
}

export interface SessionSecurityContractEvidence {
  schema_version: "stage0.rev2.session-csrf-client-evidence";
  status: "pass" | "fail";
  cookieName: string;
  cookieAttributes: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: SessionContract["cookie"]["sameSite"];
    path: string;
  };
  sameSiteRequirement: SessionContract["csrf"]["sameSiteRequired"];
  csrfStrategy: SessionContract["csrf"]["strategy"];
  csrfHeaderName: SessionContract["csrf"]["headerName"];
  credentialMode: SessionContract["csrf"]["credentialMode"];
  originPolicy: SessionContract["csrf"]["originPolicy"];
  protectedMethods: SessionContract["csrf"]["protectedMethods"];
  protectedOperationIds: string[];
  missingCsrfOperationIds: string[];
  cookieFailureReasons: string[];
  csrfFailureReasons: string[];
}

export interface GeneratedApiCsrfRequestContractEvidence {
  schema_version: "stage0.rev2.generated-api-csrf-contract";
  status: "pass" | "fail";
  credentialMode: SessionContract["csrf"]["credentialMode"];
  csrfHeaderName: SessionContract["csrf"]["headerName"];
  csrfHeaderValue: SessionContract["csrf"]["headerValue"];
  sameSiteRequirement: SessionContract["csrf"]["sameSiteRequired"];
  originPolicy: SessionContract["csrf"]["originPolicy"];
  protectedMethods: SessionContract["csrf"]["protectedMethods"];
  unsafeOperationCount: number;
  safeOperationCount: number;
  unsafeOperationIds: string[];
  safeOperationIds: string[];
  unsafeIdempotencyRequiredOperationIds: string[];
  unsafeIdempotencyExemptOperationIds: string[];
  missingUnsafeOperationIds: string[];
  unsafeRequestContracts: Array<{
    operationId: string;
    method: string;
    path: string;
    credentials: SessionContract["csrf"]["credentialMode"];
    csrfHeaderName: SessionContract["csrf"]["headerName"];
    csrfHeaderValue: SessionContract["csrf"]["headerValue"];
    idempotencyHeaderRequired: boolean;
  }>;
  failureReasons: string[];
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
  validation: {
    state: "accepted" | "rejected";
    reason?: string;
  };
}

export interface ReferenceUploadIntegrationSmoke {
  schema_version: "stage0.rev2.reference-upload-integration-smoke";
  status: "pass" | "fail";
  scenario: "reference-upload-to-ready-zip-export";
  apiOperationIds: Array<"createUpload" | "createPackage" | "createExport" | "getExport">;
  acceptedCount: number;
  acceptedKinds: ReferenceAsset["kind"][];
  rejectedCount: number;
  latestAcceptedReferenceId: string;
  latestAcceptedReferenceName: string;
  latestAcceptedReferencePackaged: boolean;
  latestAcceptedReferenceProvenancePresent: boolean;
  latestAcceptedReferencePptSlidePresent: boolean;
  packagedReferenceCount: number;
  packageHistoryReferenceCount: number;
  readyExportCount: number;
  provenanceCount: number;
  pptAssetGridSlideCount: number;
  failures: Array<
    | "accepted-reference"
    | "packaged-reference"
    | "latest-reference-packaged"
    | "ready-export"
    | "manifest-provenance"
    | "latest-reference-provenance"
    | "ppt-asset-grid"
    | "latest-reference-ppt-slide"
  >;
}

export interface ReferenceUploadValidationMatrixEvidence {
  schema_version: "stage0.rev2.reference-upload-validation-matrix";
  status: "pass" | "fail";
  scenario: "safe-image-document-https-url-reject-unsupported";
  acceptedKinds: ReferenceAsset["kind"][];
  acceptedSampleNames: string[];
  rejectedSampleNames: string[];
  expectedAcceptedKinds: ReferenceAsset["kind"][];
  expectedRejectedCount: number;
  failures: Array<
    | "image-acceptance"
    | "document-acceptance"
    | "url-acceptance"
    | "unsupported-rejection"
    | "unexpected-rejection"
  >;
}

export interface BriefUploadConfirmationRuntimeEvidence {
  schema_version: "stage0.rev2.brief-upload-confirmation-runtime-evidence";
  status: "pass" | "fail";
  scenario: "user-web-brief-upload-confirmation";
  gateImpact: "private-beta-staging-runtime";
  apiOperationIds: Array<"createChatSession" | "createChatMessage" | "createUpload" | "createCandidateSet">;
  briefConfirmed: boolean;
  missingInfoCount: number;
  acceptedReferenceCount: number;
  rejectedReferenceCount: number;
  latestReferenceValidationState: ReferenceAsset["validation"]["state"] | "missing";
  confirmationMessageVisible: boolean;
  candidateSetReady: boolean;
  failures: Array<
    | "brief-confirmed"
    | "missing-info-cleared"
    | "accepted-reference"
    | "no-rejected-reference"
    | "confirmation-message"
    | "candidate-set"
  >;
}

export interface WorkflowApiSmokeEvidence {
  schema_version: "stage0.rev2.workflow-api-smoke";
  workflow_id: "ecommerce_growth_pack";
  fixture_id: "fx_ecommerce_growth_golden";
  status: "pass" | "fail";
  scenario: "brief-reference-four-candidates-select-iterate-package-export-zip";
  apiOperationIds: string[];
  candidateCount: number;
  taxonomyCount: number;
  packagedTaxonomyCount: number;
  readyZipExportCount: number;
  requiredOutputCount: number;
  missingRequiredOutputs: string[];
  qaTaxonomyStatus: "pass" | "warn" | "missing";
  safetyStatus: "pass" | "block" | "missing";
  failures: Array<
    | "brief"
    | "reference"
    | "candidate-count"
    | "candidate-taxonomy"
    | "selection"
    | "iteration"
    | "package-taxonomy"
    | "ready-zip-export"
    | "required-outputs"
    | "qa-taxonomy"
    | "safety"
  >;
}

export interface Candidate {
  id: string;
  title: string;
  strategy: string;
  workflowId?: string;
  strategyTaxonomy?: string;
  requiredOutputFiles?: string[];
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

export interface WorkspaceRenderingPerformanceSmoke {
  schema_version: "stage0.rev2.workspace-rendering-performance";
  status: "pass" | "fail";
  scenario: "local-alpha-canvas";
  interactionSteps: Array<
    "load" | "brief-confirm" | "candidate-select" | "iteration" | "package-add" | "export-ready" | "version-restore"
  >;
  nodeCount: number;
  edgeCount: number;
  versionCount: number;
  renderElementCount: number;
  estimatedInteractionMs: number;
  failures: Array<"nodes" | "edges" | "versions" | "render-elements" | "interaction">;
  budgets: {
    maxNodes: number;
    maxEdges: number;
    maxVersions: number;
    maxRenderElements: number;
    maxInteractionMs: number;
  };
}

export interface PackageItem {
  id: string;
  sourceId: string;
  title: string;
  type: "candidate" | "canvas-frame" | "reference";
  addedAt: string;
  workflowId?: string;
  strategyTaxonomy?: string;
  requiredOutputFiles?: string[];
}

export interface PptReadyMetadata {
  schema_version: "stage0.rev2.ppt-ready-metadata";
  aspect_ratio: "16:9";
  canvas_size: {
    width: number;
    height: number;
  };
  safe_area: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  theme: {
    background: string;
    foreground: string;
    accent: string;
    font_family: string;
  };
  slides: Array<{
    id: string;
    source_item_id: string;
    title: string;
    layout: "title-and-asset" | "asset-grid" | "handoff-notes";
    notes: string;
  }>;
  handoff_checklist: string[];
}

export interface PackageManifest {
  package_id: string;
  project_id: string;
  created_at: string;
  required_outputs: string[];
  workflow_acceptance?: {
    schema_version: "stage0.rev2.workflow-api-smoke";
    workflow_id: string;
    fixture_id: string;
    strategy_taxonomy: string[];
    required_files: string[];
    export_target: "zip_delivery";
  };
  ppt_ready_metadata: PptReadyMetadata;
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

export type SafetyPolicyStage = "brief" | "provider_request" | "provider_response" | "qa" | "export";

export interface SafetyPolicyFinding {
  ruleId: string;
  ruleVersion: string;
  stage: SafetyPolicyStage;
  severity: QaSeverity;
  title: string;
  userMessage: string;
}

export interface SafetyPolicyReport {
  schema_version: "stage0.rev2.safety-policy-export";
  status: "pass" | "block";
  enforcementStages: SafetyPolicyStage[];
  findings: SafetyPolicyFinding[];
}

export interface ExportRecord {
  id: string;
  format: ExportFormat;
  status: "ready" | "blocked" | "failed" | "running";
  createdAt: string;
  fileName: string;
  manifest: PackageManifest;
  qaReport: QaFinding[];
  safetyReport: SafetyPolicyReport;
}

export interface PackageExportMetadataEvidence {
  schema_version: "stage0.rev2.package-export-metadata-ui";
  status: "pass" | "fail";
  exportId: string;
  packageId: string;
  projectId: string;
  downloadArtifactStatus: "pass" | "fail";
  downloadArtifactFormat: ExportFormat;
  manifestCreatedAt: string;
  manifestItemCount: number;
  manifestRequiredOutputCount: number;
  requiredOutputCount: number;
  missingRequiredOutputs: string[];
  itemCount: number;
  itemTypes: PackageItem["type"][];
  provenanceCount: number;
  qaFindingCount: number;
  blockingQaCount: number;
  safetyStatus: SafetyPolicyReport["status"];
  safetyStageCount: number;
  safetyFindingCount: number;
  pptAspectRatio: PptReadyMetadata["aspect_ratio"];
  pptSlideCount: number;
  pptCanvasSize: string;
  pptSafeArea: string;
  pptThemeFont: string;
  handoffChecklistCount: number;
  zipPayloadCount: number;
  zipPayloadNames: string[];
  requiredZipPayloadNames: string[];
  missingZipPayloadNames: string[];
  workflowId: string;
  workflowFixtureId: string;
  workflowStrategyTaxonomyCount: number;
  workflowRequiredFileCount: number;
  workflowZipPayloadCount: number;
  workflowMetadataPayloadPresent: boolean;
  workflowTraceProvenancePayloadPresent: boolean;
  workflowProviderMetadataPresent: boolean;
  workflowPromptSpecMetadataPresent: boolean;
  workflowSkillMetadataPresent: boolean;
  workflowSafetyMetadataPresent: boolean;
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
  projectName: string;
  category: "bug" | "billing" | "export" | "quality" | "other";
  body: string;
  status: "open" | "triaged";
  linkedExportId?: string;
  linkedTaskId?: string;
  linkedTraceId?: string;
  linkedAssetIds: string[];
  linkedQuotaSnapshot: {
    used: number;
    limit: number;
    remaining: number;
    status: SubscriptionStatus;
    resetAt: string;
  };
}

export interface WorkspaceState {
  session: SessionUser;
  sessionContract: SessionContract;
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
  login(email: string): Promise<WorkspaceState>;
  logout(): Promise<WorkspaceState>;
  refreshSession(): Promise<WorkspaceState>;
  expireSession(): Promise<WorkspaceState>;
  confirmBrief(prompt: string): Promise<WorkspaceState>;
  attachReference(asset: Pick<ReferenceAsset, "name" | "kind">): Promise<WorkspaceState>;
  selectCandidate(candidateId: string): Promise<WorkspaceState>;
  iterateSelected(instruction: string): Promise<WorkspaceState>;
  restoreCanvasVersion(versionId: string): Promise<WorkspaceState>;
  addPackageItem(sourceId: string): Promise<WorkspaceState>;
  createExport(format: ExportFormat): Promise<WorkspaceState>;
  createShareLink(exportId: string): Promise<WorkspaceState>;
  createMockCheckout(): Promise<WorkspaceState>;
  setBillingScenario(scenario: BillingScenario): Promise<WorkspaceState>;
  updateAccount(settings: AccountSettings): Promise<WorkspaceState>;
  reportProblem(input: Pick<SupportTicket, "category" | "body" | "linkedExportId">): Promise<WorkspaceState>;
}
