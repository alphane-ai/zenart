export type SubscriptionStatus = "trialing" | "active" | "past_due" | "inactive";
export type BillingScenario = "trialing" | "active" | "past_due" | "inactive" | "quota_exhausted";

export type ChatRole = "user" | "assistant" | "system";

export type QaSeverity = "pass" | "warn" | "block";

export type ExportFormat = "zip" | "pdf-placeholder";

export type EditToolType = "crop" | "rotate" | "flip" | "remove_background" | "upscale" | "erase" | "expand";
export type MaskKind = "brush" | "rect" | "lasso";

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
    domain?: string;
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
    domain: string;
    hostOnly: boolean;
  };
  hostPrefixInvariant: {
    prefix: "__Host-";
    prefixPresent: boolean;
    secure: boolean;
    pathRoot: boolean;
    hostOnly: boolean;
    status: "pass" | "fail";
    failureReasons: Array<"cookie-prefix" | "cookie-secure" | "cookie-path" | "cookie-domain">;
  };
  setCookieContract: string;
  acceptedSameSiteValues: Array<"lax" | "strict">;
  rejectedSameSiteValues: Array<"none">;
  sameSiteAcceptanceMatrix: Array<{
    sameSite: SessionContract["cookie"]["sameSite"];
    status: "pass" | "fail";
    failureReason: "" | "cookie-same-site";
  }>;
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
  methodCoverage: {
    schema_version: "stage0.rev2.generated-api-csrf-method-coverage";
    status: "pass" | "fail";
    protectedMethods: SessionContract["csrf"]["protectedMethods"];
    safeMethods: Array<"GET" | "HEAD" | "OPTIONS">;
    coveredUnsafeMethods: string[];
    coveredSafeMethods: string[];
    unsafeMethodCoverage: string[];
    safeMethodCoverage: string[];
    failureReasons: string[];
  };
  unsafeRequestContracts: Array<{
    operationId: string;
    method: string;
    path: string;
    credentials: SessionContract["csrf"]["credentialMode"];
    csrfHeaderName: SessionContract["csrf"]["headerName"];
    csrfHeaderValue: SessionContract["csrf"]["headerValue"];
    idempotencyHeaderRequired: boolean;
  }>;
  safeRequestContracts: Array<{
    operationId: string;
    method: string;
    path: string;
    credentials: SessionContract["csrf"]["credentialMode"];
    csrfHeaderName: "not-required";
    csrfHeaderValue: "not-required";
    idempotencyHeaderRequired: false;
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
  checkoutSessionId?: string;
  checkoutProvider?: string;
  checkoutRedirectUrl?: string;
  checkoutCreatedAt?: string;
  portalSessionId?: string;
  portalRedirectUrl?: string;
  cancellationStatus?: string;
  cancelAtPeriodEnd?: boolean;
  cancellationUpdatedAt?: string;
  invoices: BillingInvoice[];
  invoiceSyncStatus: "api" | "local" | "unavailable";
  invoiceSyncedAt?: string;
}

export interface BillingInvoice {
  id: string;
  provider: string;
  status: string;
  currency: string;
  amountDueCents: number;
  amountPaidCents: number;
  invoiceUrl?: string;
  receiptUrl?: string;
  createdAt: string;
}

export interface TeamSeatUsage {
  teamId: string;
  tenantId: string;
  planId: string;
  seatLimit: number;
  activeSeats: number;
  invitedSeats: number;
  billableSeats: number;
  availableSeats: number;
}

export interface TeamSeatEntitlement {
  allowed: boolean;
  reason: "ok" | "seat_limit_exceeded";
  additionalSeats: number;
  checkedAt: string;
}

export interface TeamInviteState {
  teamId: string;
  inviteId: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted";
  acceptedAt?: string;
}

export interface TeamSeatBillingProjection {
  provider: "stripe" | "local";
  prorationBehavior: "create_prorations" | "none" | "always_invoice";
  invoiceImpact: "prorated_on_next_invoice" | "no_proration" | "immediate_invoice";
  nextBillableSeats: number;
  syncStatus: "api" | "local" | "pending" | "failed" | "unavailable";
  lastSyncedAt?: string;
  auditEvent: "team.seat.refresh" | "team.invite.accept";
  safeProjection: true;
}

export interface TeamSeatState {
  usage: TeamSeatUsage;
  entitlement: TeamSeatEntitlement;
  billingProjection: TeamSeatBillingProjection;
  pendingInvite?: TeamInviteState;
  lastAcceptedInviteId?: string;
  lastSyncStatus?: "local" | "api";
}

export interface AssetLibraryItem {
  id: string;
  assetId: string;
  title: string;
  assetType: string;
  status: string;
  visibility: "project" | "tenant" | "private";
  favorite: boolean;
  archived: boolean;
  reusable: boolean;
  allowedProjects: string[];
  tags: string[];
  objectKey?: string;
  thumbnailKey?: string;
  lineageKind?: string;
  traceId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrandKitItem {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  logos: Array<{ assetId?: string; objectMetadataId?: string; usage?: string }>;
  palette: Array<{ name: string; hex: string; role?: string }>;
  fonts: Array<{ family: string; assetId?: string; role?: string }>;
  guidelines: Array<{ id: string; title: string; body: string; severity: "recommended" | "required" | string }>;
  sourceRefs: Array<{ kind: string; assetId?: string; traceId?: string }>;
  projectBindings: Array<{ projectId: string; default?: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export interface AssetLibraryState {
  items: AssetLibraryItem[];
  brandKits: BrandKitItem[];
  defaultBrandKit?: BrandKitItem;
  syncStatus: "local" | "api" | "unavailable";
  syncedAt?: string;
  operations: Array<
    | "listAssetLibrary"
    | "createAssetLibraryEntry"
    | "updateAssetLibraryEntry"
    | "listBrandKits"
    | "createBrandKit"
    | "updateBrandKit"
    | "getProjectDefaultBrandKit"
    | "setProjectDefaultBrandKit"
  >;
  packagedAssetIds: string[];
}

export interface EditMaskState {
  assetId: string;
  objectKey: string;
  width: number;
  height: number;
  kind: MaskKind;
  coveragePct: number;
  sourceNodeId?: string;
}

export interface EditToolRevision {
  id: string;
  sourceAssetId: string;
  derivedAssetId: string;
  sourceNodeId: string;
  derivedNodeId: string;
  tool: EditToolType;
  nonDestructive: boolean;
  originalAssetRetained: boolean;
  providerRequestRequired: boolean;
  mask?: EditMaskState;
  transform?: {
    crop?: { x: number; y: number; width: number; height: number };
    rotate?: number;
    flipX?: boolean;
    flipY?: boolean;
  };
  lineage: {
    originalAssetId: string;
    derivedFromAssetId: string;
    toolType: EditToolType;
    traceId: string;
    rawPayloadPersisted: false;
  };
  createdAt: string;
}

export interface EditToolState {
  contract: "stage1.edit-tools-mask-local-contract";
  availableTools: EditToolType[];
  activeTool: EditToolType;
  mask: EditMaskState;
  sourceAssetId: string;
  sourceNodeId: string;
  sourceWidth: number;
  sourceHeight: number;
  revisions: EditToolRevision[];
  lastRevisionId?: string;
  lastAction: "load" | "mask" | "tool" | "apply";
  syncStatus: "local" | "api" | "unavailable";
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
  upload: {
    operationId: "createUpload";
    method: "POST";
    path: "/uploads";
    credentialMode: SessionContract["csrf"]["credentialMode"];
    csrfHeaderName: SessionContract["csrf"]["headerName"];
    idempotencyRequired: true;
    previewUrl: string;
    previewScope: "tenant-scoped-dev-preview";
    previewExpiresAt: string;
  };
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
  latestAcceptedReferenceKind: ReferenceAsset["kind"] | "missing";
  latestAcceptedReferenceUploadMethod: string;
  latestAcceptedReferenceUploadPath: string;
  latestAcceptedReferenceCsrfHeaderName: string;
  latestAcceptedReferenceIdempotencyRequired: boolean;
  latestAcceptedReferencePreviewScope: ReferenceAsset["upload"]["previewScope"] | "missing";
  latestAcceptedReferencePackageItemId: string;
  latestAcceptedReferenceExportTitle: string;
  latestAcceptedReferencePptSlideSourceItemId: string;
  latestAcceptedReferenceIdentityStatus: "pass" | "fail";
  latestAcceptedReferencePackaged: boolean;
  latestAcceptedReferenceProvenancePresent: boolean;
  latestAcceptedReferencePptSlidePresent: boolean;
  uploadRequestContractCount: number;
  packagedReferenceCount: number;
  packageHistoryReferenceCount: number;
  readyExportCount: number;
  provenanceCount: number;
  pptAssetGridSlideCount: number;
  rejectedReferencePackagedCount: number;
  rejectedReferenceExportedCount: number;
  failures: Array<
    | "accepted-reference"
    | "upload-request-contract"
    | "packaged-reference"
    | "latest-reference-packaged"
    | "ready-export"
    | "manifest-provenance"
    | "latest-reference-identity"
    | "latest-reference-provenance"
    | "ppt-asset-grid"
    | "latest-reference-ppt-slide"
    | "rejected-reference-packaged"
    | "rejected-reference-exported"
  >;
}

export interface ReferenceUploadValidationMatrixEvidence {
  schema_version: "stage0.rev2.reference-upload-validation-matrix";
  status: "pass" | "fail";
  scenario: "safe-image-document-https-url-reject-unsupported";
  acceptedKinds: ReferenceAsset["kind"][];
  acceptedSampleNames: string[];
  acceptedAttachedCount: number;
  rejectedSampleNames: string[];
  rejectedReasons: string[];
  rejectedQueuedCount: number;
  rejectedPackageActionCount: number;
  expectedAcceptedKinds: ReferenceAsset["kind"][];
  expectedRejectedCount: number;
  expectedRejectedReasons: string[];
  failures: Array<
    | "image-acceptance"
    | "document-acceptance"
    | "url-acceptance"
    | "unsupported-rejection"
    | "rejection-reason"
    | "rejected-queue-state"
    | "rejected-package-action"
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
  workflow_id: string;
  fixture_id: string;
  status: "pass" | "fail";
  scenario: "brief-reference-four-candidates-select-iterate-package-export-zip";
  apiOperationIds: string[];
  apiOperationContracts: Array<{
    operationId: string;
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    credentialMode: SessionContract["csrf"]["credentialMode"];
    csrfProtected: boolean;
    csrfHeaderName: SessionContract["csrf"]["headerName"] | "not-required";
    idempotencyRequired: boolean;
  }>;
  csrfProtectedOperationCount: number;
  idempotencyRequiredOperationCount: number;
  candidateCount: number;
  taxonomyCount: number;
  packagedTaxonomyCount: number;
  readyZipExportCount: number;
  requiredOutputCount: number;
  missingRequiredOutputs: string[];
  qaTaxonomyId: string;
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
    | "operation-contract"
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
  kind: "brief" | "candidate" | "iteration" | "export" | "generated_layer";
  x: number;
  y: number;
  body: string;
  width?: number;
  height?: number;
  zIndex?: number;
  locked?: boolean;
  hidden?: boolean;
  frameId?: string;
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
  versionNumber?: number;
  snapshot?: {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
  };
  diff?: {
    addedNodeIds: string[];
    removedNodeIds: string[];
    changedNodeIds: string[];
    unchangedNodeIds: string[];
  };
  restorePreview?: {
    restoresNodeIds: string[];
    preservesNodeIds: string[];
    conflictNodeIds: string[];
  };
}

export type CanvasTool = "select" | "hand" | "frame" | "text" | "shape" | "upload";

export interface CanvasInteractionState {
  contract: "stage1.canvas-interaction-user-contract";
  tool: CanvasTool;
  zoom: number;
  selectedNodeIds: string[];
  pan: {
    x: number;
    y: number;
  };
  lastAction: "load" | "select" | "drag" | "zoom" | "fit" | "tool" | "layer-hide" | "layer-lock" | "keyboard" | "undo" | "redo";
  keyboardShortcuts: Array<"delete" | "duplicate" | "undo" | "redo" | "zoom_in" | "zoom_out" | "space_hand" | "shift_multi_select">;
  toolbarTools: CanvasTool[];
  layersPanelEnabled: boolean;
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
  candidateCount: number;
  packageItemCount: number;
  referenceCount: number;
  exportHistoryCount: number;
  renderElementCount: number;
  estimatedInteractionMs: number;
  renderIdentityCount: number;
  duplicateRenderIdentityCount: number;
  duplicateRenderIdentities: string[];
  renderIdentityDigest: string;
  interactionStepBudgets: Array<{
    step: WorkspaceRenderingPerformanceSmoke["interactionSteps"][number];
    status: "pass" | "fail";
    renderElementCount: number;
    estimatedInteractionMs: number;
    failureCount: number;
  }>;
  failures: Array<"nodes" | "edges" | "versions" | "render-elements" | "interaction" | "duplicate-render-identities">;
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
  export_id?: string;
  generated_by?: string;
  workflow_id?: string;
  workflow_fixture_id?: string;
  provider?: string;
  model?: string;
  prompt_spec?: string[];
  skill?: string;
  safety?: string;
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

export interface SafetyExportStateEvidence {
  schema_version: "stage1.safety-export-state-local-contract.v1";
  status: "pass" | "empty";
  export_count: number;
  ready_export_count: number;
  blocked_export_count: number;
  failed_export_count: number;
  running_export_count: number;
  qa_block_finding_count: number;
  safety_block_finding_count: number;
  admin_review_required_count: number;
  blocked_download_cta_count: 0;
  blocked_share_cta_count: 0;
  downloadable_ready_export_count: number;
  blocked_export_without_download_count: number;
  blocked_export_without_share_count: number;
  latest_export_id: string;
  latest_export_status: ExportRecord["status"] | "none";
  latest_blocked_reason: string;
  blocked_reasons: string[];
  raw_provider_payload_projected: false;
  raw_safety_payload_projected: false;
  secret_like_value_projected: false;
  can_clear_stage1_staging_runtime_gate: false;
}

export interface RenderedExportAssetEvidence {
  schema_version: "stage1.rendered-export-asset-local-contract.v1";
  status: "pass" | "fail";
  exportId: string;
  packageId: string;
  projectId: string;
  renderMode: "deterministic-local-svg-pdf";
  renderedAssetManifestPayloadName: string;
  manifestAssetOutputCount: number;
  renderedAssetPayloadCount: number;
  renderedAssetPayloadNames: string[];
  renderedAssetOutputNames: string[];
  renderedAssetContentTypes: string[];
  renderedAssetByteCount: number;
  placeholderPayloadCount: number;
  placeholderPayloadNames: string[];
  unsafePayloadCount: number;
  unsafePayloadNames: string[];
  rawProviderPayloadProjected: false;
  rawSafetyPayloadProjected: false;
  secretLikeValueProjected: false;
  signedUrlPersisted: false;
  stagingSignedUrlEvidence: "open";
  objectRetentionCleanupEvidence: "open";
  canClearStage1StagingRuntimeGate: false;
  canClearStage1ProductionLaunchGate: false;
  failures: Array<
    | "format"
    | "status"
    | "manifest"
    | "rendered-assets"
    | "placeholder-payload"
    | "unsafe-payload"
    | "raw-payload"
    | "signed-url"
  >;
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
  manifestOutputStatuses: Array<{
    name: string;
    zipPayloadName: string;
    present: boolean;
  }>;
  itemCount: number;
  itemTypes: PackageItem["type"][];
  provenanceCount: number;
  itemProvenanceParityStatus: "pass" | "fail";
  itemProvenanceParityCount: number;
  missingItemProvenanceParityCount: number;
  referenceProvenanceCount: number;
  candidateProvenanceCount: number;
  itemProvenanceStatuses: Array<{
    itemId: string;
    title: string;
    type: PackageItem["type"];
    provenance: string;
    expectedPrefix: "dev-client-reference:" | "dev-client:" | "dev-client-canvas:";
    provenanceStatus: "pass" | "missing";
    pptSlideStatus: "pass" | "missing";
  }>;
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
  zipPayloadContractDigest: string;
  requiredZipPayloadNames: string[];
  requiredZipPayloadCount: number;
  requiredZipPayloadStatuses: Array<{
    name: string;
    present: boolean;
  }>;
  payloadContentDigest: string;
  payloadContentStatuses: Array<{
    name: string;
    byteSize: number;
    contentDigest: string;
  }>;
  zipPayloadParityStatus: "pass" | "fail";
  zipPayloadParityRatio: string;
  missingZipPayloadNames: string[];
  zipPayloadPathSafetyStatus: "pass" | "fail";
  unsafeManifestPayloadNames: string[];
  unsafeExpectedPayloadNames: string[];
  crossPayloadIdentityStatus: "pass" | "fail";
  identityContractDigest: string;
  crossPayloadIdentityNames: string[];
  missingCrossPayloadIdentityNames: string[];
  crossPayloadIdentityStatuses: Array<{
    payloadName: string;
    exportId: "pass" | "missing";
    packageId: "pass" | "missing";
    projectId: "pass" | "missing";
    workflowId: "pass" | "missing";
    provider: "pass" | "missing";
    model: "pass" | "missing";
    promptSpec: "pass" | "missing";
    skill: "pass" | "missing";
    safety: "pass" | "missing";
  }>;
  workflowId: string;
  workflowFixtureId: string;
  workflowStrategyTaxonomyCount: number;
  workflowRequiredFileCount: number;
  workflowZipPayloadCount: number;
  workflowPayloadStatuses: Array<{
    name: string;
    present: boolean;
  }>;
  workflowMetadataPayloadPresent: boolean;
  workflowTraceProvenancePayloadPresent: boolean;
  aiContentDisclaimerPayloadPresent: boolean;
  workflowProviderMetadataPresent: boolean;
  workflowPromptSpecMetadataPresent: boolean;
  workflowSkillMetadataPresent: boolean;
  workflowSafetyMetadataPresent: boolean;
  workflowMetadataGeneratedBy: string;
  workflowMetadataProvider: string;
  workflowMetadataModel: string;
  workflowPromptSpecTaxonomy: string[];
  workflowSkill: string;
  workflowSafety: string;
}

export interface ExportZipPayloadSmokeEvidence {
  schema_version: "stage0.rev2.export-zip-payload-smoke";
  status: "pass" | "fail";
  scenario: "manifest-required-output-to-downloadable-zip-payloads";
  exportId: string;
  packageId: string;
  manifestRequiredOutputCount: number;
  expectedPayloadCount: number;
  requiredBaselinePayloadNames: string[];
  expectedPayloadNames: string[];
  payloadContractDigest: string;
  missingPayloadNames: string[];
  pathSafetyStatus: "pass" | "fail";
  unsafeManifestPayloadNames: string[];
  unsafeExpectedPayloadNames: string[];
  workflowPayloadNames: string[];
  metadataPayloadPresent: boolean;
  traceProvenancePayloadPresent: boolean;
  aiContentDisclaimerPayloadPresent: boolean;
  assetsPayloadPresent: boolean;
  failures: Array<
    | "baseline-payloads"
    | "manifest-required-payloads"
    | "unsafe-payload-name"
    | "workflow-metadata"
    | "trace-provenance"
    | "ai-content-disclaimer"
    | "rendered-asset-manifest"
  >;
}

export interface ExportDownloadParityEvidence {
  schema_version: "stage0.rev2.export-download-parity-smoke";
  status: "pass" | "fail";
  scenario: "metadata-zip-smoke-download-handoff-parity";
  exportId: string;
  packageId: string;
  projectId: string;
  workflowId: string;
  workflowFixtureId: string;
  fileName: string;
  format: ExportFormat;
  metadataStatus: PackageExportMetadataEvidence["status"];
  zipPayloadStatus: ExportZipPayloadSmokeEvidence["status"];
  downloadHandoffStatus: "pass" | "fail";
  manifestRequiredOutputCount: number;
  metadataZipPayloadCount: number;
  zipExpectedPayloadCount: number;
  metadataMissingZipPayloadCount: number;
  zipMissingPayloadCount: number;
  requiredZipPayloadParityStatus: PackageExportMetadataEvidence["zipPayloadParityStatus"];
  metadataPayloadsMatchZipPayloads: boolean;
  payloadListStatus: "pass" | "fail";
  metadataPayloadNames: string[];
  zipExpectedPayloadNames: string[];
  payloadContractDigest: string;
  metadataPayloadDigestMatchesZipPayloadDigest: boolean;
  payloadContentDigest: string;
  payloadContentDigestStatus: "pass" | "fail";
  payloadContentCount: number;
  payloadPathSafetyStatus: "pass" | "fail";
  identityContractDigest: string;
  metadataIdentityDigestMatchesRecord: boolean;
  identityStatus: "pass" | "fail";
  itemProvenanceParityStatus: PackageExportMetadataEvidence["itemProvenanceParityStatus"];
  itemProvenanceParityCount: number;
  missingItemProvenanceParityCount: number;
  provider: string;
  model: string;
  promptSpecTaxonomy: string[];
  skill: string;
  safetyStatus: SafetyPolicyReport["status"];
  workflowMetadataPresent: boolean;
  traceProvenancePresent: boolean;
  failures: Array<
    | "export-id"
    | "package-id"
    | "project-id"
    | "workflow-id"
    | "workflow-fixture-id"
    | "file-name"
    | "format"
    | "metadata-status"
    | "zip-payload-status"
    | "download-handoff-status"
    | "manifest-output-count"
    | "payload-count"
    | "missing-payloads"
    | "required-parity"
    | "payload-list"
    | "payload-digest"
    | "payload-content-digest"
    | "path-safety"
    | "identity-digest"
    | "identity"
    | "item-provenance"
    | "provider"
    | "model"
    | "prompt-spec"
    | "skill"
    | "safety"
    | "workflow-metadata"
    | "trace-provenance"
  >;
}

export interface ExportDownloadAccessBoundaryEvidence {
  schema_version: "stage1.export-download-access-boundary-local-contract.v1";
  status: "pass" | "fail";
  scenario: "local-browser-zip-does-not-clear-server-signed-url-or-retention-gates";
  exportId: string;
  packageId: string;
  fileName: string;
  localBrowserDownloadStatus: ExportDownloadParityEvidence["downloadHandoffStatus"];
  localZipPayloadStatus: ExportZipPayloadSmokeEvidence["status"];
  renderedAssetStatus: RenderedExportAssetEvidence["status"];
  productDownloadUrlPolicy: "server-mediated-relative-signed-url";
  serverDownloadRoute: "GET /api/v1/objects/download";
  objectStoreDirectSigningUsedForExportDownload: false;
  signedUrlPersisted: false;
  signedUrlMaterialProjected: false;
  downloadResponseDisclosesObjectKeyHeader: false;
  requiresActiveRetentionMetadata: true;
  requiresDownloadAudit: true;
  requiresDownloadAnalytics: true;
  strictStagingSignedUrlEvidence: "open";
  strictStagingRetentionCleanupEvidence: "open";
  productionObjectStorageEvidence: "open";
  canClearStage1StagingRuntimeGate: false;
  canClearStage1ProductionLaunchGate: false;
  canClearObjectStorageDoNotLaunch: false;
  failures: Array<
    | "local-download"
    | "zip-payload"
    | "rendered-assets"
    | "signed-url-persisted"
    | "staging-signed-url"
    | "retention"
    | "gate-boundary"
  >;
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
  linkedBatchId?: string;
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
  linkedBillingReferenceId?: string;
}

export type PromptComposerAspectRatio = "1:1" | "4:5" | "16:9" | "9:16";
export type PromptComposerQuality = "draft" | "standard" | "high";

export interface PromptComposerContext {
  text: string;
  selected_object_ids: string[];
  reference_asset_ids: string[];
  brand_kit_id?: string;
  model_hints: string[];
  tool_hint: string;
}

export interface PromptComposerPayload {
  schema_version: "stage1.prompt-composer-contract.v1";
  prompt_context_status: "local";
  prompt_context: PromptComposerContext;
  requested_count: number;
  aspect_ratio: PromptComposerAspectRatio;
  quality: PromptComposerQuality;
  allowed_models: string[];
  projected: {
    selected_object_count: number;
    reference_asset_count: number;
    brand_kit_selected: boolean;
    allowed_model_count: number;
    selected_object_ids: string[];
    reference_asset_ids: string[];
    brand_kit_id: string;
    model_hints: string[];
  };
  blocked: {
    hidden_object_count: number;
    rejected_reference_count: number;
    archived_asset_count: number;
    unresolved_mention_count: number;
    duplicate_mention_count: number;
    forbidden_model_mention_count: number;
  };
  redaction: {
    raw_provider_payload_persisted: false;
    raw_hidden_prompt_projected: false;
    secret_like_value_projected: false;
  };
  operations: ["createBatchGeneration"];
}

export type BatchGenerationStatus = "queued" | "running" | "succeeded" | "partial_succeeded" | "partial_failed" | "failed" | "cancelled" | "blocked";
export type BatchGenerationChildStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "blocked";

export interface BatchGenerationChild {
  id: string;
  batchId: string;
  status: BatchGenerationChildStatus;
  providerId: string;
  modelId: string;
  toolType: "image.generate";
  seed: string;
  retryCount: number;
  maxRetries: number;
  quotaEstimateUnits: number;
  quotaCommittedUnits: number;
  quotaRefundedUnits: number;
  assetId?: string;
  canvasObjectId?: string;
  traceId: string;
  visibleTraceRef: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface BatchGeneration {
  id: string;
  projectId: string;
  status: BatchGenerationStatus;
  prompt: string;
  requestedCount: number;
  providerId: string;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  progressPercent: number;
  queuedCount: number;
  runningCount: number;
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
  blockedCount: number;
  retryableCount: number;
  progressSyncStatus: "local" | "api" | "unavailable";
  progressSyncedAt?: string;
  promptContext?: PromptComposerContext;
  promptComposerPayload?: PromptComposerPayload;
  children: BatchGenerationChild[];
}

export interface ResultPlacementEvidence {
  schema_version: "stage1.result-placement-contract.v1";
  status: "local" | "empty";
  projected_child_count: number;
  placed_canvas_object_count: number;
  asset_library_entry_count: number;
  latest_child_id: string;
  latest_asset_id: string;
  latest_canvas_object_id: string;
  latest_trace_id: string;
  duplicate_projection_count: number;
  raw_provider_payload_projected: false;
  missing_projection_count: number;
}

export interface WorkspaceState {
  session: SessionUser;
  sessionContract: SessionContract;
  account: AccountSettings;
  billing: BillingPlan;
  teamSeats: TeamSeatState;
  assetLibrary: AssetLibraryState;
  editTools: EditToolState;
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
    interaction: CanvasInteractionState;
  };
  packageItems: PackageItem[];
  exports: ExportRecord[];
  shareLinks: ShareLink[];
  supportTickets: SupportTicket[];
  batchGenerations: BatchGeneration[];
}

export interface ZenariClient {
  loadWorkspace(): Promise<WorkspaceState>;
  login(email: string): Promise<WorkspaceState>;
  logout(): Promise<WorkspaceState>;
  refreshSession(): Promise<WorkspaceState>;
  expireSession(): Promise<WorkspaceState>;
  confirmBrief(prompt: string): Promise<WorkspaceState>;
  activateBusinessVisualDocWorkflow(): Promise<WorkspaceState>;
  activateLocalMerchantCampaignWorkflow(): Promise<WorkspaceState>;
  createProject(name: string): Promise<WorkspaceState>;
  updateProject(projectId: string, name: string): Promise<WorkspaceState>;
  attachReference(asset: Pick<ReferenceAsset, "name" | "kind">): Promise<WorkspaceState>;
  selectCandidate(candidateId: string): Promise<WorkspaceState>;
  iterateSelected(instruction: string): Promise<WorkspaceState>;
  restoreCanvasVersion(versionId: string): Promise<WorkspaceState>;
  selectCanvasNode(nodeId: string, additive?: boolean): Promise<WorkspaceState>;
  moveCanvasNode(nodeId: string, delta: { x: number; y: number }): Promise<WorkspaceState>;
  setCanvasZoom(zoom: number): Promise<WorkspaceState>;
  fitCanvasToView(): Promise<WorkspaceState>;
  setCanvasTool(tool: CanvasTool): Promise<WorkspaceState>;
  toggleCanvasNodeHidden(nodeId: string): Promise<WorkspaceState>;
  toggleCanvasNodeLocked(nodeId: string): Promise<WorkspaceState>;
  duplicateSelectedCanvasNodes(): Promise<WorkspaceState>;
  deleteSelectedCanvasNodes(): Promise<WorkspaceState>;
  setEditTool(tool: EditToolType): Promise<WorkspaceState>;
  updateEditMask(mask: Partial<EditMaskState>): Promise<WorkspaceState>;
  applyEditTool(): Promise<WorkspaceState>;
  addPackageItem(sourceId: string): Promise<WorkspaceState>;
  createExport(format: ExportFormat): Promise<WorkspaceState>;
  createShareLink(exportId: string): Promise<WorkspaceState>;
  createBatchGeneration(countOrPayload?: number | PromptComposerPayload): Promise<WorkspaceState>;
  refreshBatchGenerationProgress(batchId: string): Promise<WorkspaceState>;
  cancelBatchGeneration(batchId: string): Promise<WorkspaceState>;
  retryBatchGenerationChild(childId: string): Promise<WorkspaceState>;
  createMockCheckout(): Promise<WorkspaceState>;
  createBillingPortalSession(): Promise<WorkspaceState>;
  cancelSubscription(): Promise<WorkspaceState>;
  refreshBillingInvoices(): Promise<WorkspaceState>;
  refreshTeamSeats(): Promise<WorkspaceState>;
  acceptTeamInvite(): Promise<WorkspaceState>;
  refreshAssetLibrary(): Promise<WorkspaceState>;
  createAssetLibraryEntryFromSelection(): Promise<WorkspaceState>;
  toggleAssetLibraryFavorite(entryId: string): Promise<WorkspaceState>;
  archiveAssetLibraryEntry(entryId: string): Promise<WorkspaceState>;
  createBrandKitFromLogoAsset(entryId: string): Promise<WorkspaceState>;
  updateBrandKitGuidelines(brandKitId: string): Promise<WorkspaceState>;
  setDefaultBrandKit(brandKitId: string): Promise<WorkspaceState>;
  packageAssetLibraryItem(entryId: string): Promise<WorkspaceState>;
  setBillingScenario(scenario: BillingScenario): Promise<WorkspaceState>;
  updateAccount(settings: AccountSettings): Promise<WorkspaceState>;
  reportProblem(input: Pick<SupportTicket, "category" | "body" | "linkedExportId">): Promise<WorkspaceState>;
}
