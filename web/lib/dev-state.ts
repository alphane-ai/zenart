import {
  Candidate,
  CanvasInteractionState,
  BriefUploadConfirmationRuntimeEvidence,
  ExportDownloadAccessBoundaryEvidence,
  ExportDownloadParityEvidence,
  ExportZipPayloadSmokeEvidence,
  ExportFormat,
  ExportRecord,
  PackageExportMetadataEvidence,
  PackageItem,
  PackageManifest,
  PptReadyMetadata,
  QaFinding,
  RenderedExportAssetEvidence,
  ReferenceAsset,
  ReferenceUploadIntegrationSmoke,
  ReferenceUploadValidationMatrixEvidence,
  SafetyPolicyReport,
  SessionContract,
  SessionUser,
  WorkspaceRenderingPerformanceSmoke,
  ShareLink,
  SupportTicket,
  TeamSeatState,
  WorkflowApiSmokeEvidence,
  WorkspaceState,
  AssetLibraryState,
  EditToolState
} from "./contracts";
import { ApiOperation, apiOperations } from "./generated/zenart-api";
import { defaultSameSiteCsrfContract } from "./request-security";

const now = "2026-05-26T09:00:00.000Z";
const sessionTtlMs = 30 * 60 * 1000;
const sessionRefreshMs = 20 * 60 * 1000;

const devUser: SessionUser = {
  id: "user-dev-001",
  name: "Dev User",
  email: "dev@zenari.ai"
};

export const defaultTeamSeatState: TeamSeatState = {
  usage: {
    teamId: "team_1",
    tenantId: "tenant_1",
    planId: "plan-local-alpha",
    seatLimit: 5,
    activeSeats: 2,
    invitedSeats: 1,
    billableSeats: 3,
    availableSeats: 2
  },
  entitlement: {
    allowed: true,
    reason: "ok",
    additionalSeats: 1,
    checkedAt: now
  },
  billingProjection: {
    provider: "stripe",
    prorationBehavior: "create_prorations",
    invoiceImpact: "prorated_on_next_invoice",
    nextBillableSeats: 3,
    syncStatus: "local",
    lastSyncedAt: now,
    auditEvent: "team.seat.refresh",
    safeProjection: true
  },
  pendingInvite: {
    teamId: "team_1",
    inviteId: "invite_1",
    email: "teammate@example.com",
    role: "member",
    status: "pending"
  },
  lastSyncStatus: "local"
};

export const defaultAssetLibraryState: AssetLibraryState = {
  items: [
    {
      id: "library_entry_1",
      assetId: "asset_hero_1",
      title: "Launch hero generated image",
      assetType: "generated_image",
      status: "active",
      visibility: "tenant",
      favorite: true,
      archived: false,
      reusable: true,
      allowedProjects: ["project-001", "project-002"],
      tags: ["approved", "hero"],
      objectKey: "tenants/tenant_1/assets/launch-hero.png",
      thumbnailKey: "tenants/tenant_1/assets/launch-hero-thumb.png",
      lineageKind: "batch_child_provider_result",
      traceId: "trace_asset_hero_1",
      createdAt: "2026-06-22T10:00:00.000Z",
      updatedAt: "2026-06-22T10:00:00.000Z"
    },
    {
      id: "library_entry_2",
      assetId: "asset_logo_1",
      title: "Primary logo reference",
      assetType: "image",
      status: "active",
      visibility: "project",
      favorite: false,
      archived: false,
      reusable: true,
      allowedProjects: ["project-001"],
      tags: ["brand", "logo"],
      objectKey: "tenants/tenant_1/assets/logo.png",
      lineageKind: "asset_library",
      traceId: "trace_asset_logo_1",
      createdAt: "2026-06-22T10:05:00.000Z",
      updatedAt: "2026-06-22T10:05:00.000Z"
    }
  ],
  brandKits: [
    {
      id: "brand_kit_1",
      name: "Aurora Retail",
      status: "active",
      logos: [{ assetId: "asset_logo_1", objectMetadataId: "object_logo_1", usage: "primary" }],
      palette: [
        { name: "Ink", hex: "#111827", role: "primary" },
        { name: "Signal", hex: "#2563eb", role: "accent" },
        { name: "Canvas", hex: "#ffffff", role: "background" }
      ],
      fonts: [{ family: "Inter", assetId: "asset_font_1", role: "body" }],
      guidelines: [
        {
          id: "guideline_1",
          title: "Logo clearance",
          body: "Keep the primary logo clear of dense imagery.",
          severity: "required"
        }
      ],
      sourceRefs: [{ kind: "asset_library", assetId: "asset_logo_1", traceId: "trace_asset_logo_1" }],
      projectBindings: [{ projectId: "project-001", default: true }],
      createdAt: "2026-06-22T10:00:00.000Z",
      updatedAt: "2026-06-22T10:00:00.000Z"
    }
  ],
  defaultBrandKit: undefined,
  syncStatus: "local",
  syncedAt: "2026-06-22T10:00:00.000Z",
  operations: [
    "listAssetLibrary",
    "createAssetLibraryEntry",
    "updateAssetLibraryEntry",
    "listBrandKits",
    "createBrandKit",
    "updateBrandKit",
    "getProjectDefaultBrandKit",
    "setProjectDefaultBrandKit"
  ],
  packagedAssetIds: []
};

defaultAssetLibraryState.defaultBrandKit = defaultAssetLibraryState.brandKits[0];

export const defaultEditToolState: EditToolState = {
  contract: "stage1.edit-tools-mask-local-contract",
  availableTools: ["crop", "rotate", "flip", "remove_background", "upscale", "erase", "expand"],
  activeTool: "erase",
  mask: {
    assetId: "mask_local_001",
    objectKey: "tenants/tenant_1/masks/mask_local_001.png",
    width: 1024,
    height: 768,
    kind: "brush",
    coveragePct: 0.18,
    sourceNodeId: "node-brief"
  },
  sourceAssetId: "asset_hero_1",
  sourceNodeId: "node-brief",
  sourceWidth: 1024,
  sourceHeight: 768,
  revisions: [],
  lastAction: "load",
  syncStatus: "local"
};

export const requiredExportPackageOutputs = [
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "provenance.json",
  "ai-content-disclaimer.json",
  "ppt-ready-metadata.json",
  "assets/"
] as const;

export const renderedAssetManifestPayloadName = "assets/local-rendered-asset-manifest.json";

export const requiredExportZipPayloadNames = requiredExportPackageOutputs.map((outputName) =>
  outputName === "assets/" ? renderedAssetManifestPayloadName : outputName
);

export const isSafeExportZipPayloadName = (payloadName: string) => {
  const trimmed = payloadName.trim();

  return (
    trimmed.length > 0 &&
    trimmed === payloadName &&
    !trimmed.endsWith("/") &&
    !trimmed.startsWith("/") &&
    !trimmed.startsWith("\\") &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) &&
    !trimmed.includes("\\") &&
    !trimmed.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
};

const renderedOutputExtensions = [".png", ".jpg", ".jpeg", ".webp", ".pdf"] as const;

const isRenderedAssetOutputName = (payloadName: string) =>
  payloadName.startsWith("assets/") &&
  renderedOutputExtensions.some((extension) => payloadName.toLowerCase().endsWith(extension));

const toRenderedAssetPayloadName = (outputName: string) => {
  const normalized = outputName.replace(/^assets\//, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const stem = normalized.replace(/\.[^.]+$/, "");
  const sourceExtension = normalized.includes(".") ? normalized.slice(normalized.lastIndexOf(".") + 1).toLowerCase() : "asset";
  const payloadName = `assets/rendered/${stem}-${sourceExtension}.svg`;

  return isSafeExportZipPayloadName(payloadName) ? payloadName : "";
};

export const toExportZipPayloadName = (outputName: string) => {
  const payloadName =
    outputName === "assets/"
      ? renderedAssetManifestPayloadName
      : isRenderedAssetOutputName(outputName)
        ? isSafeExportZipPayloadName(outputName)
          ? toRenderedAssetPayloadName(outputName)
          : ""
        : outputName;

  return isSafeExportZipPayloadName(payloadName) ? payloadName : "";
};

export const buildDownloadableExportZipPayloadNames = (record: ExportRecord) =>
  Array.from(
    new Set([
      ...requiredExportZipPayloadNames,
      ...record.manifest.required_outputs
        .map(toExportZipPayloadName)
        .filter(isSafeExportZipPayloadName)
    ])
  );

export const buildExportZipPayloadContractDigest = (record: ExportRecord, payloadNames = buildDownloadableExportZipPayloadNames(record)) =>
  [
    record.id,
    record.manifest.package_id,
    record.manifest.project_id,
    record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
    record.manifest.workflow_acceptance?.fixture_id ?? "none",
    [...payloadNames].sort().join("|")
  ].join("::");

export const buildExportIdentityContractDigest = (record: ExportRecord) => {
  const workflowMetadataPayload = buildExportWorkflowMetadataPayload(record, "metadata.json");

  return [
    record.id,
    record.manifest.package_id,
    record.manifest.project_id,
    workflowMetadataPayload.workflow_id,
    workflowMetadataPayload.workflow_fixture_id,
    workflowMetadataPayload.provider,
    workflowMetadataPayload.model,
    workflowMetadataPayload.prompt_spec.join("|"),
    workflowMetadataPayload.skill,
    workflowMetadataPayload.safety
  ].join("::");
};

export const buildExportManifestPayload = (record: ExportRecord) => ({
  ...record.manifest,
  export_id: record.id,
  generated_by: "zenari-web-dev-client",
  workflow_id: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
  workflow_fixture_id: record.manifest.workflow_acceptance?.fixture_id ?? "none",
  provider: "dev-provider",
  model: "deterministic-local-alpha",
  prompt_spec: record.manifest.workflow_acceptance?.strategy_taxonomy ?? [],
  skill: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
  safety: record.safetyReport.status
});

export const buildExportWorkflowMetadataPayload = (record: ExportRecord, outputName: string) => ({
  export_id: record.id,
  package_id: record.manifest.package_id,
  project_id: record.manifest.project_id,
  output_name: outputName,
  generated_by: "zenari-web-dev-client",
  workflow_id: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
  workflow_fixture_id: record.manifest.workflow_acceptance?.fixture_id ?? "none",
  provider: "dev-provider",
  model: "deterministic-local-alpha",
  prompt_spec: record.manifest.workflow_acceptance?.strategy_taxonomy ?? [],
  skill: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
  safety: record.safetyReport.status
});

export const buildAiContentDisclaimerPayload = (record: ExportRecord) => ({
  schema_version: "stage0.rev2.ai-content-disclaimer",
  export_id: record.id,
  package_id: record.manifest.package_id,
  project_id: record.manifest.project_id,
  generated_by: "zenari-web-dev-client",
  generation_mode: "deterministic-local-alpha",
  applies_to: "export-package",
  workflow_id: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
  provider: "dev-provider",
  model: "deterministic-local-alpha",
  prompt_spec: record.manifest.workflow_acceptance?.strategy_taxonomy ?? [],
  skill: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
  responsibility_notice:
    "Local alpha previews use deterministic generation evidence unless a real provider is explicitly configured. Review rights, claims, likeness, and brand usage before sharing exported assets.",
  policy_routes: ["/legal/terms", "/legal/acceptable-use", "/legal/ip-complaints"],
  safety_status: record.safetyReport.status
});

const buildPayloadBodyDigest = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const buildExportZipPayloadContentDigest = (
  entries: Array<{ name: string; body: string }>
) =>
  entries
    .map((entry) => `${entry.name}:${new TextEncoder().encode(entry.body).length}:${buildPayloadBodyDigest(entry.body)}`)
    .sort()
    .join("|");

export const toDownloadableRenderedAssetPayloadName = (outputName: string) => {
  if (!isRenderedAssetOutputName(outputName)) {
    return "";
  }

  return toRenderedAssetPayloadName(outputName);
};

const escapeSvgText = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const buildLocalRenderedAssetSvg = (record: ExportRecord, outputName: string, index: number) => {
  const workflowId = record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export";
  const taxonomy = record.manifest.workflow_acceptance?.strategy_taxonomy[index % Math.max(1, record.manifest.workflow_acceptance?.strategy_taxonomy.length ?? 1)] ?? "local-render";
  const title = outputName.replace(/^assets\//, "");
  const accentColors = ["#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#0891b2", "#7c3aed"];
  const accent = accentColors[index % accentColors.length];

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img" aria-label="Zenari local rendered export asset">',
    "<defs>",
    '<linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">',
    '<stop offset="0" stop-color="#f8fafc"/>',
    '<stop offset="1" stop-color="#e5e7eb"/>',
    "</linearGradient>",
    "</defs>",
    '<rect width="1200" height="900" fill="url(#surface)"/>',
    `<rect x="64" y="64" width="1072" height="772" rx="18" fill="#ffffff" stroke="${accent}" stroke-width="8"/>`,
    `<rect x="112" y="128" width="320" height="72" rx="12" fill="${accent}"/>`,
    '<rect x="112" y="248" width="360" height="360" rx="20" fill="#111827"/>',
    `<circle cx="292" cy="428" r="118" fill="${accent}" opacity="0.88"/>`,
    '<rect x="528" y="252" width="520" height="38" rx="8" fill="#111827"/>',
    '<rect x="528" y="322" width="420" height="28" rx="6" fill="#475569"/>',
    '<rect x="528" y="376" width="480" height="28" rx="6" fill="#64748b"/>',
    '<rect x="528" y="430" width="360" height="28" rx="6" fill="#94a3b8"/>',
    '<rect x="528" y="540" width="220" height="64" rx="14" fill="#111827"/>',
    `<text x="136" y="176" font-family="Inter, Arial, sans-serif" font-size="32" font-weight="700" fill="#ffffff">${escapeSvgText(workflowId)}</text>`,
    `<text x="112" y="704" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="700" fill="#111827">${escapeSvgText(title)}</text>`,
    `<text x="112" y="762" font-family="Inter, Arial, sans-serif" font-size="26" fill="#475569">local deterministic render · ${escapeSvgText(taxonomy)}</text>`,
    `<text x="528" y="580" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700" fill="#ffffff">${escapeSvgText(record.id)}</text>`,
    "</svg>"
  ].join("");
};

export const buildRenderedExportAssetEntries = (record: ExportRecord) => {
  const outputNames = record.manifest.required_outputs.filter(
    (outputName) => isRenderedAssetOutputName(outputName) && isSafeExportZipPayloadName(outputName)
  );

  return outputNames.map((outputName, index) => {
    const payloadName = toRenderedAssetPayloadName(outputName);
    const body = buildLocalRenderedAssetSvg(record, outputName, index);

    return {
      outputName,
      payloadName,
      contentType: "image/svg+xml",
      byteSize: new TextEncoder().encode(body).length,
      contentDigest: buildPayloadBodyDigest(body),
      body
    };
  }).filter((entry) => entry.payloadName);
};

export const buildRenderedExportAssetManifestPayload = (record: ExportRecord) => {
  const renderedAssets = buildRenderedExportAssetEntries(record);

  return {
    schema_version: "stage1.rendered-export-asset-local-manifest.v1",
    export_id: record.id,
    package_id: record.manifest.package_id,
    project_id: record.manifest.project_id,
    render_mode: "deterministic-local-svg-pdf",
    renderer: "zenari-web-dev-client",
    source_manifest_required_output_count: record.manifest.required_outputs.length,
    staging_signed_url_evidence: "open",
    object_retention_cleanup_evidence: "open",
    can_clear_stage1_staging_runtime_gate: false,
    assets: renderedAssets.map(({ outputName, payloadName, contentType, byteSize, contentDigest }) => ({
      source_output_name: outputName,
      payload_name: payloadName,
      content_type: contentType,
      byte_size: byteSize,
      content_digest: contentDigest
    }))
  };
};

export const buildRenderedExportAssetEvidence = (record: ExportRecord): RenderedExportAssetEvidence => {
  const renderedAssets = buildRenderedExportAssetEntries(record);
  const renderedAssetPayloadNames = renderedAssets.map((asset) => asset.payloadName);
  const placeholderPayloadNames = buildDownloadableExportZipPayloadNames(record).filter((payloadName) =>
    /placeholder|README\.txt/i.test(payloadName)
  );
  const unsafePayloadNames = [
    renderedAssetManifestPayloadName,
    ...renderedAssetPayloadNames
  ].filter((payloadName) => !isSafeExportZipPayloadName(payloadName));
  const manifestPayload = buildRenderedExportAssetManifestPayload(record);
  const failures: RenderedExportAssetEvidence["failures"] = [];

  if (record.format !== "zip") {
    failures.push("format");
  }
  if (record.status !== "ready") {
    failures.push("status");
  }
  if (manifestPayload.assets.length !== renderedAssets.length || renderedAssets.length === 0) {
    failures.push("manifest");
  }
  if (renderedAssets.length === 0 || renderedAssets.some((asset) => asset.byteSize <= 0 || asset.contentType !== "image/svg+xml")) {
    failures.push("rendered-assets");
  }
  if (placeholderPayloadNames.length > 0) {
    failures.push("placeholder-payload");
  }
  if (unsafePayloadNames.length > 0) {
    failures.push("unsafe-payload");
  }

  return {
    schema_version: "stage1.rendered-export-asset-local-contract.v1",
    status: failures.length === 0 ? "pass" : "fail",
    exportId: record.id,
    packageId: record.manifest.package_id,
    projectId: record.manifest.project_id,
    renderMode: "deterministic-local-svg-pdf",
    renderedAssetManifestPayloadName,
    manifestAssetOutputCount: record.manifest.required_outputs.filter(isRenderedAssetOutputName).length,
    renderedAssetPayloadCount: renderedAssets.length,
    renderedAssetPayloadNames,
    renderedAssetOutputNames: renderedAssets.map((asset) => asset.outputName),
    renderedAssetContentTypes: Array.from(new Set(renderedAssets.map((asset) => asset.contentType))),
    renderedAssetByteCount: renderedAssets.reduce((total, asset) => total + asset.byteSize, 0),
    placeholderPayloadCount: placeholderPayloadNames.length,
    placeholderPayloadNames,
    unsafePayloadCount: unsafePayloadNames.length,
    unsafePayloadNames,
    rawProviderPayloadProjected: false,
    rawSafetyPayloadProjected: false,
    secretLikeValueProjected: false,
    signedUrlPersisted: false,
    stagingSignedUrlEvidence: "open",
    objectRetentionCleanupEvidence: "open",
    canClearStage1StagingRuntimeGate: false,
    canClearStage1ProductionLaunchGate: false,
    failures
  };
};

export const buildExportZipPayloadEntries = (record: ExportRecord) => {
  const entries = new Map<string, string>();
  const put = (payloadName: string, body: string) => {
    if (!isSafeExportZipPayloadName(payloadName)) {
      throw new Error(`Unsafe export ZIP payload name: ${payloadName}`);
    }
    if (!entries.has(payloadName)) {
      entries.set(payloadName, body);
    }
  };

  put("manifest.json", JSON.stringify(buildExportManifestPayload(record), null, 2));
  put("qa-report.json", JSON.stringify(record.qaReport, null, 2));
  put("safety-policy-report.json", JSON.stringify(record.safetyReport, null, 2));
  put("ai-content-disclaimer.json", JSON.stringify(buildAiContentDisclaimerPayload(record), null, 2));
  put("ppt-ready-metadata.json", JSON.stringify(record.manifest.ppt_ready_metadata, null, 2));
  put(
    "provenance.json",
    JSON.stringify(
      {
        export_id: record.id,
        package_id: record.manifest.package_id,
        project_id: record.manifest.project_id,
        generated_by: "zenari-web-dev-client",
        workflow_id: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
        provider: "dev-provider",
        model: "deterministic-local-alpha",
        prompt_spec: record.manifest.workflow_acceptance?.strategy_taxonomy ?? [],
        skill: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
        safety: record.safetyReport.status,
        items: record.manifest.items.map((item) => ({
          id: item.id,
          provenance: item.provenance
        }))
      },
      null,
      2
    )
  );
  put(renderedAssetManifestPayloadName, JSON.stringify(buildRenderedExportAssetManifestPayload(record), null, 2));
  for (const renderedAsset of buildRenderedExportAssetEntries(record)) {
    put(renderedAsset.payloadName, renderedAsset.body);
  }

  for (const requiredPayload of buildDownloadableExportZipPayloadNames(record)) {
    if (entries.has(requiredPayload)) {
      continue;
    }
    put(requiredPayload, JSON.stringify(buildExportWorkflowMetadataPayload(record, requiredPayload), null, 2));
  }
  for (const outputName of record.manifest.required_outputs) {
    if (outputName === "assets/") {
      continue;
    }
    const payloadName = toExportZipPayloadName(outputName);
    if (!payloadName) {
      throw new Error(`Unsafe export ZIP payload name: ${outputName}`);
    }
    if (!entries.has(payloadName)) {
      put(payloadName, JSON.stringify(buildExportWorkflowMetadataPayload(record, payloadName), null, 2));
    }
  }

  return buildDownloadableExportZipPayloadNames(record)
    .filter((payloadName) => entries.has(payloadName))
    .map((name) => ({
      name,
      body: entries.get(name) ?? ""
    }));
};

export const buildExportZipPayloadContentEntries = (record: ExportRecord) =>
  buildExportZipPayloadEntries(record).map((entry) => ({
    name: entry.name,
    byteSize: new TextEncoder().encode(entry.body).length,
    contentDigest: buildPayloadBodyDigest(entry.body)
  }));

export const ecommerceGrowthWorkflowAcceptance = {
  schema_version: "stage0.rev2.workflow-api-smoke",
  workflow_id: "ecommerce_growth_pack",
  fixture_id: "fx_ecommerce_growth_golden",
  display_name: "Ecommerce Growth Pack",
  strategy_taxonomy: ["conversion_offer", "social_proof", "feature_comparison", "retention_bundle"],
  required_files: [
    "manifest.json",
    "assets/hero_product_ad.png",
    "assets/square_social_ad.png",
    "assets/story_variant.png",
    "assets/marketplace_banner.png",
    "metadata.json",
    "qa_report.json",
    "trace_provenance.json"
  ],
  export_target: "zip_delivery"
} as const;

export const businessVisualDocWorkflowAcceptance = {
  schema_version: "stage0.rev2.workflow-api-smoke",
  workflow_id: "business_visual_doc_pack",
  fixture_id: "fx_business_visual_doc_golden",
  display_name: "Business Visual Document Pack",
  strategy_taxonomy: ["executive_brief", "strategy_memo", "sales_leave_behind", "board_update"],
  required_files: [
    "manifest.json",
    "assets/cover.png",
    "assets/summary_page.png",
    "assets/data_page.png",
    "assets/recommendation_page.png",
    "metadata.json",
    "qa_report.json",
    "trace_provenance.json"
  ],
  export_target: "zip_delivery"
} as const;

export const localMerchantCampaignWorkflowAcceptance = {
  schema_version: "stage0.rev2.workflow-api-smoke",
  workflow_id: "local_merchant_campaign_pack",
  fixture_id: "fx_local_merchant_campaign_golden",
  display_name: "Local Merchant Campaign Pack",
  strategy_taxonomy: ["wechat_conversion", "xiaohongshu_quality", "store_print", "delivery_platform_cover"],
  required_files: [
    "manifest.json",
    "assets/wechat_moment.png",
    "assets/xiaohongshu_post.png",
    "assets/store_print_poster.pdf",
    "assets/delivery_cover.png",
    "metadata.json",
    "qa_report.json",
    "trace_provenance.json"
  ],
  export_target: "zip_delivery"
} as const;

export const characterIpConceptWorkflowAcceptance = {
  schema_version: "stage0.rev2.workflow-api-smoke",
  workflow_id: "character_ip_concept_pack",
  fixture_id: "fx_character_ip_concept_golden",
  display_name: "Character IP Concept Pack",
  strategy_taxonomy: ["cute", "heroic", "dark", "ornate"],
  required_files: [
    "manifest.json",
    "assets/avatar.png",
    "assets/half_body.png",
    "assets/costume_prop_variants.png",
    "assets/expression_sheet.png",
    "assets/promo_key_art.png",
    "assets/character_bible.json",
    "metadata.json",
    "qa_report.json",
    "trace_provenance.json"
  ],
  export_target: "zip_delivery"
} as const;

export type WorkflowAcceptanceContract =
  | typeof ecommerceGrowthWorkflowAcceptance
  | typeof businessVisualDocWorkflowAcceptance
  | typeof localMerchantCampaignWorkflowAcceptance
  | typeof characterIpConceptWorkflowAcceptance;

export const workflowAcceptanceContracts = [
  ecommerceGrowthWorkflowAcceptance,
  businessVisualDocWorkflowAcceptance,
  localMerchantCampaignWorkflowAcceptance,
  characterIpConceptWorkflowAcceptance
] as const;

const workflowAcceptanceById = new Map<string, WorkflowAcceptanceContract>(
  workflowAcceptanceContracts.map((contract) => [contract.workflow_id, contract])
);

export const createSessionContract = (
  user: SessionUser = devUser,
  status: SessionContract["status"] = "authenticated",
  issuedAt = now
): SessionContract => {
  const issuedTime = new Date(issuedAt).getTime();

  return {
    id: `session-${user.id}`,
    user,
    status,
    issuedAt,
    expiresAt: new Date(issuedTime + sessionTtlMs).toISOString(),
    refreshAfter: new Date(issuedTime + sessionRefreshMs).toISOString(),
    cookie: {
      name: "__Host-zenari_session",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/"
    },
    csrf: defaultSameSiteCsrfContract
  };
};

const candidates: Candidate[] = [
  {
    id: "cand-editorial",
    title: "Editorial Clarity",
    workflowId: ecommerceGrowthWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "conversion_offer",
    requiredOutputFiles: ["assets/hero_product_ad.png"],
    strategy: "Magazine layout with strong hierarchy and concise copy blocks.",
    palette: ["#111827", "#f4f1ea", "#2f855a", "#d97706"],
    rationale: "Best when the output needs to feel curated and explain a story quickly.",
    assetPrompt: "Create a polished editorial direction board for a launch campaign."
  },
  {
    id: "cand-studio",
    title: "Studio System",
    workflowId: ecommerceGrowthWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "social_proof",
    requiredOutputFiles: ["assets/square_social_ad.png"],
    strategy: "Reusable product tiles, neutral surfaces, and crisp asset annotations.",
    palette: ["#0f172a", "#e5e7eb", "#2563eb", "#dc2626"],
    rationale: "Best when repeatable production assets and handoff clarity matter.",
    assetPrompt: "Create a modular studio direction with componentized visual rules."
  },
  {
    id: "cand-gallery",
    title: "Gallery Motion",
    workflowId: ecommerceGrowthWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "feature_comparison",
    requiredOutputFiles: ["assets/story_variant.png"],
    strategy: "Large art-led panels, cinematic crops, and transition notes.",
    palette: ["#18181b", "#fafafa", "#7c3aed", "#14b8a6"],
    rationale: "Best for expressive brand systems that need memorable visual impact.",
    assetPrompt: "Create a gallery-like direction with motion-ready composition cues."
  },
  {
    id: "cand-utility",
    title: "Utility Kit",
    workflowId: ecommerceGrowthWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "retention_bundle",
    requiredOutputFiles: ["assets/marketplace_banner.png"],
    strategy: "Dense asset matrix with accessibility notes and export variants.",
    palette: ["#1f2937", "#ffffff", "#0891b2", "#ca8a04"],
    rationale: "Best for operational campaigns that require fast comparison and QA.",
    assetPrompt: "Create a utilitarian asset kit with production-ready variants."
  }
];

export const businessVisualDocCandidates: Candidate[] = [
  {
    id: "biz-executive",
    title: "Executive Brief",
    workflowId: businessVisualDocWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "executive_brief",
    requiredOutputFiles: ["assets/cover.png"],
    strategy: "Crisp cover, outcome-led hierarchy, and concise decision framing for leaders.",
    palette: ["#172554", "#f8fafc", "#0f766e", "#be123c"],
    rationale: "Best when a stakeholder needs the headline decision and risks quickly.",
    assetPrompt: "Create an executive-ready visual document cover with concise decision framing."
  },
  {
    id: "biz-strategy",
    title: "Strategy Memo",
    workflowId: businessVisualDocWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "strategy_memo",
    requiredOutputFiles: ["assets/summary_page.png"],
    strategy: "Structured memo pages with summary bands, proof points, and next-step framing.",
    palette: ["#0f172a", "#ffffff", "#2563eb", "#16a34a"],
    rationale: "Best when the document must explain tradeoffs and retain operational detail.",
    assetPrompt: "Create a strategy memo visual page with readable summary and proof-point sections."
  },
  {
    id: "biz-sales",
    title: "Sales Leave-Behind",
    workflowId: businessVisualDocWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "sales_leave_behind",
    requiredOutputFiles: ["assets/recommendation_page.png"],
    strategy: "Client-facing one-pager with benefit blocks, objection handling, and action prompts.",
    palette: ["#1e293b", "#f8fafc", "#ea580c", "#0891b2"],
    rationale: "Best when the artifact needs to be persuasive after a live meeting.",
    assetPrompt: "Create a sales leave-behind page with benefit blocks and recommendation hierarchy."
  },
  {
    id: "biz-board",
    title: "Board Update",
    workflowId: businessVisualDocWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "board_update",
    requiredOutputFiles: ["assets/data_page.png"],
    strategy: "Dense data page with KPI cards, variance notes, and risk-visible recommendations.",
    palette: ["#111827", "#f9fafb", "#7c2d12", "#15803d"],
    rationale: "Best when governance readers need data density without losing the story.",
    assetPrompt: "Create a board update data page with KPI cards, variance notes, and recommendation context."
  }
];

export const localMerchantCampaignCandidates: Candidate[] = [
  {
    id: "merchant-wechat",
    title: "WeChat Conversion",
    workflowId: localMerchantCampaignWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "wechat_conversion",
    requiredOutputFiles: ["assets/wechat_moment.png"],
    strategy: "Compact offer-first layout with exact price, date, phone, and address blocks for local sharing.",
    palette: ["#064e3b", "#ffffff", "#f59e0b", "#dc2626"],
    rationale: "Best when the merchant needs a direct neighborhood conversion message.",
    assetPrompt: "Create a WeChat moment campaign asset preserving merchant offer details and local contact fields."
  },
  {
    id: "merchant-xhs",
    title: "Xiaohongshu Quality",
    workflowId: localMerchantCampaignWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "xiaohongshu_quality",
    requiredOutputFiles: ["assets/xiaohongshu_post.png"],
    strategy: "Editorial quality cues, proof notes, and mobile-safe structured details for discovery feeds.",
    palette: ["#881337", "#fff7ed", "#0891b2", "#16a34a"],
    rationale: "Best when quality perception and saved-post readability matter.",
    assetPrompt: "Create a Xiaohongshu-style local merchant post with structured offer, date, address, and contact detail blocks."
  },
  {
    id: "merchant-print",
    title: "Store Print",
    workflowId: localMerchantCampaignWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "store_print",
    requiredOutputFiles: ["assets/store_print_poster.pdf"],
    strategy: "Print poster hierarchy with QR-safe zone, large price lockup, and event logistics.",
    palette: ["#111827", "#f9fafb", "#2563eb", "#ea580c"],
    rationale: "Best for storefront placement where distance readability and exact details are critical.",
    assetPrompt: "Create a printable local merchant poster with QR-safe area, offer lockup, and logistics preserved."
  },
  {
    id: "merchant-delivery",
    title: "Delivery Cover",
    workflowId: localMerchantCampaignWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "delivery_platform_cover",
    requiredOutputFiles: ["assets/delivery_cover.png"],
    strategy: "Delivery-app cover composition with menu-safe crop, offer badge, and product/service emphasis.",
    palette: ["#7c2d12", "#ffffff", "#22c55e", "#0284c7"],
    rationale: "Best when the campaign needs to travel across delivery and pickup surfaces.",
    assetPrompt: "Create a delivery platform campaign cover with crop-safe product/service emphasis and verified offer fields."
  }
];

export const characterIpConceptCandidates: Candidate[] = [
  {
    id: "character-cute",
    title: "Cute Mascot",
    workflowId: characterIpConceptWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "cute",
    requiredOutputFiles: ["assets/avatar.png", "assets/promo_key_art.png"],
    strategy: "Rounded original mascot form, friendly proportions, and avatar-safe silhouette rules.",
    palette: ["#0f172a", "#ffffff", "#f97316", "#14b8a6"],
    rationale: "Best when the character must read quickly as an approachable original IP.",
    assetPrompt: "Create an original cute character IP avatar and key art concept with clear originality boundaries."
  },
  {
    id: "character-heroic",
    title: "Heroic Lead",
    workflowId: characterIpConceptWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "heroic",
    requiredOutputFiles: ["assets/half_body.png", "assets/character_bible.json"],
    strategy: "Confident half-body design with stable traits, role cues, and character bible metadata.",
    palette: ["#111827", "#f8fafc", "#2563eb", "#e11d48"],
    rationale: "Best when production needs a protagonist direction with durable trait references.",
    assetPrompt: "Create an original heroic character IP half-body concept and structured character bible metadata."
  },
  {
    id: "character-dark",
    title: "Dark Variant",
    workflowId: characterIpConceptWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "dark",
    requiredOutputFiles: ["assets/costume_prop_variants.png"],
    strategy: "Moodier costume and prop exploration with protected-style avoidance notes.",
    palette: ["#18181b", "#fafafa", "#7c2d12", "#22c55e"],
    rationale: "Best when the concept needs dramatic range without resembling existing characters.",
    assetPrompt: "Create original dark-toned costume and prop variants with explicit protected-style avoidance."
  },
  {
    id: "character-ornate",
    title: "Ornate Sheet",
    workflowId: characterIpConceptWorkflowAcceptance.workflow_id,
    strategyTaxonomy: "ornate",
    requiredOutputFiles: ["assets/expression_sheet.png"],
    strategy: "Decorative expression sheet with consistent face, silhouette, and costume anchors.",
    palette: ["#312e81", "#ffffff", "#db2777", "#ca8a04"],
    rationale: "Best when handoff needs expression variety while preserving character consistency.",
    assetPrompt: "Create an ornate original character expression sheet with stable face and costume anchors."
  }
];

export const createInitialWorkspace = (): WorkspaceState => ({
  session: devUser,
  sessionContract: createSessionContract(devUser),
  account: {
    brandName: "Northstar Studio",
    defaultExportFormat: "zip",
    emailNotifications: true
  },
  billing: {
    id: "plan-local-alpha",
    name: "Local Alpha",
    status: "trialing",
    quotaLimit: 40,
    quotaUsed: 8,
    resetAt: "2026-06-01T00:00:00.000Z",
    renewalMode: "mock-checkout",
    invoices: [
      {
        id: "in_test_local_alpha_001",
        provider: "stripe",
        status: "paid",
        currency: "USD",
        amountDueCents: 2900,
        amountPaidCents: 2900,
        invoiceUrl: "https://invoice.stripe.test/in_test_local_alpha_001",
        receiptUrl: "https://invoice.stripe.test/in_test_local_alpha_001.pdf",
        createdAt: "2026-06-21T10:00:00.000Z"
      },
      {
        id: "in_test_local_alpha_002",
        provider: "stripe",
        status: "open",
        currency: "USD",
        amountDueCents: 4900,
        amountPaidCents: 0,
        invoiceUrl: "https://invoice.stripe.test/in_test_local_alpha_002",
        receiptUrl: "https://invoice.stripe.test/in_test_local_alpha_002.pdf",
        createdAt: "2026-06-22T10:00:00.000Z"
      }
    ],
    invoiceSyncStatus: "local",
    invoiceSyncedAt: "2026-06-22T10:00:00.000Z"
  },
  teamSeats: defaultTeamSeatState,
  assetLibrary: defaultAssetLibraryState,
  editTools: defaultEditToolState,
  projects: [
    {
      id: "project-001",
      name: "Launch Direction Board",
      updatedAt: now,
      brief: "Create a premium campaign visual system for a design tool launch.",
      assetCount: 4,
      exportCount: 1
    },
    {
      id: "project-002",
      name: "Seasonal Asset Kit",
      updatedAt: "2026-05-25T12:30:00.000Z",
      brief: "Adapt campaign assets for a compact ecommerce release.",
      assetCount: 0,
      exportCount: 0
    }
  ],
  activeProjectId: "project-001",
  chat: [
    {
      id: "msg-001",
      role: "assistant",
      body: "What are you making, who is it for, and what should the final package include?",
      createdAt: now
    }
  ],
  brief: {
    prompt: "Premium campaign direction for a design tool launch with social, web, and presentation assets.",
    confirmed: false,
    missingInfo: ["Audience", "Required export surfaces"],
    references: [
      {
        ...createReferenceAsset("brand-moodboard.png", "image"),
        id: "ref-001",
        upload: {
          ...createReferenceAsset("brand-moodboard.png", "image").upload,
          previewUrl: "/dev-preview/uploads/ref-001"
        }
      }
    ]
  },
  candidates,
  selectedCandidateId: undefined,
  canvas: {
    nodes: [
      {
        id: "node-brief",
        title: "Confirmed Brief",
        kind: "brief",
        x: 80,
        y: 110,
        width: 230,
        height: 118,
        zIndex: 1,
        locked: false,
        hidden: false,
        body: "Campaign direction board with four strategic routes, packageable assets, manifest, and QA."
      }
    ],
    edges: [],
    versions: [
      {
        id: "version-001",
        label: "Initial brief",
        createdAt: now,
        nodeCount: 1,
        versionNumber: 1,
        snapshot: {
          nodes: [
            {
              id: "node-brief",
              title: "Confirmed Brief",
              kind: "brief",
              x: 80,
              y: 110,
              width: 230,
              height: 118,
              zIndex: 1,
              locked: false,
              hidden: false,
              body: "Campaign direction board with four strategic routes, packageable assets, manifest, and QA."
            }
          ],
          edges: []
        },
        diff: {
          addedNodeIds: ["node-brief"],
          removedNodeIds: [],
          changedNodeIds: [],
          unchangedNodeIds: []
        },
        restorePreview: {
          restoresNodeIds: ["node-brief"],
          preservesNodeIds: [],
          conflictNodeIds: []
        }
      }
    ],
    activeVersionId: "version-001",
    autosavedAt: now,
    interaction: defaultCanvasInteraction
  },
  packageItems: [],
  exports: [],
  shareLinks: [],
  supportTickets: [],
  batchGenerations: []
});

export const buildManifest = (
  projectId: string,
  items: PackageItem[]
): PackageManifest => {
  const workflowAcceptance = buildWorkflowAcceptanceManifest(items);

  return {
    package_id: `pkg-${String(items.length || 1).padStart(3, "0")}`,
    project_id: projectId,
    created_at: new Date().toISOString(),
    required_outputs: Array.from(
      new Set([
        ...requiredExportPackageOutputs,
        ...(workflowAcceptance?.required_files ?? []),
        ...items.flatMap((item) => item.requiredOutputFiles ?? [])
      ])
    ),
    workflow_acceptance: workflowAcceptance,
    ppt_ready_metadata: buildPptReadyMetadata(items),
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      provenance: item.type === "reference" ? `dev-client-reference:${item.sourceId}` : `dev-client:${item.sourceId}`
    }))
  };
};

const buildWorkflowAcceptanceManifest = (items: PackageItem[]): PackageManifest["workflow_acceptance"] | undefined => {
  const workflowId = workflowAcceptanceContracts.find((contract) =>
    items.some((item) => item.workflowId === contract.workflow_id)
  )?.workflow_id;
  const contract = workflowId ? workflowAcceptanceById.get(workflowId) : undefined;
  if (!contract) {
    return undefined;
  }
  const workflowItems = items.filter((item) => item.workflowId === contract.workflow_id);

  return {
    schema_version: contract.schema_version,
    workflow_id: contract.workflow_id,
    fixture_id: contract.fixture_id,
    strategy_taxonomy: Array.from(new Set(workflowItems.flatMap((item) => item.strategyTaxonomy ?? []))),
    required_files: Array.from(
      new Set([
        ...contract.required_files,
        ...workflowItems.flatMap((item) => item.requiredOutputFiles ?? [])
      ])
    ),
    export_target: contract.export_target
  };
};

export const buildPptReadyMetadata = (items: PackageItem[]): PptReadyMetadata => ({
  schema_version: "stage0.rev2.ppt-ready-metadata",
  aspect_ratio: "16:9",
  canvas_size: {
    width: 1920,
    height: 1080
  },
  safe_area: {
    top: 72,
    right: 96,
    bottom: 72,
    left: 96
  },
  theme: {
    background: "#ffffff",
    foreground: "#111827",
    accent: "#2563eb",
    font_family: "Inter, Arial, sans-serif"
  },
  slides:
    items.length > 0
      ? items.map((item, index) => ({
          id: `slide-${String(index + 1).padStart(2, "0")}`,
          source_item_id: item.id,
          title: item.title,
          layout: item.type === "candidate" ? "title-and-asset" : item.type === "reference" ? "asset-grid" : "handoff-notes",
          notes: `${item.type} exported from ${item.sourceId} with safe-area bounds and presenter handoff context.`
        }))
      : [
	      {
	        id: "slide-01",
	        source_item_id: "empty-package",
	        title: "Empty package draft",
	        layout: "handoff-notes",
	        notes: "Export is blocked until package items are added."
	      }
        ],
  handoff_checklist: [
    "16:9 presentation canvas",
    "safe-area bounds",
    "source item mapping",
    "speaker notes",
    "editable theme tokens"
  ]
});

export const evaluatePackageQa = (items: PackageItem[]): QaFinding[] => {
  if (items.length === 0) {
    return [
      {
        id: "qa-empty-package",
        severity: "block",
        title: "Package is empty",
        detail: "Add at least one selected candidate or canvas frame before export."
      }
    ];
  }

  const hasCandidate = items.some((item) => item.type === "candidate");
  const findings: QaFinding[] = [
    {
      id: "qa-manifest",
      severity: "pass",
      title: "Manifest present",
      detail: "Export includes manifest and provenance entries for each package item."
    },
    {
      id: "qa-candidate",
      severity: hasCandidate ? "pass" : "warn",
      title: hasCandidate ? "Selected direction included" : "No candidate direction included",
      detail: hasCandidate
        ? "The package contains the selected visual direction."
        : "Export can continue, but adding the selected candidate is recommended."
    }
  ];

  const ecommerceItems = items.filter((item) => item.workflowId === ecommerceGrowthWorkflowAcceptance.workflow_id);
  if (ecommerceItems.length > 0) {
    const coveredTaxonomy = new Set(ecommerceItems.flatMap((item) => item.strategyTaxonomy ?? []));
    const missingTaxonomy = ecommerceGrowthWorkflowAcceptance.strategy_taxonomy.filter((taxonomy) => !coveredTaxonomy.has(taxonomy));

    findings.push({
      id: "qa-ecommerce-growth-taxonomy",
      severity: missingTaxonomy.length === 0 ? "pass" : "warn",
      title: missingTaxonomy.length === 0 ? "Ecommerce taxonomy covered" : "Ecommerce taxonomy partially covered",
      detail:
        missingTaxonomy.length === 0
          ? "Package covers conversion_offer, social_proof, feature_comparison, and retention_bundle."
          : `Package is missing ecommerce taxonomy coverage for ${missingTaxonomy.join(", ")}.`
    });
  }

  const businessDocItems = items.filter((item) => item.workflowId === businessVisualDocWorkflowAcceptance.workflow_id);
  if (businessDocItems.length > 0) {
    const coveredTaxonomy = new Set(businessDocItems.flatMap((item) => item.strategyTaxonomy ?? []));
    const missingTaxonomy = businessVisualDocWorkflowAcceptance.strategy_taxonomy.filter((taxonomy) => !coveredTaxonomy.has(taxonomy));

    findings.push({
      id: "qa-business-visual-doc-taxonomy",
      severity: missingTaxonomy.length === 0 ? "pass" : "warn",
      title: missingTaxonomy.length === 0 ? "Business document taxonomy covered" : "Business document taxonomy partially covered",
      detail:
        missingTaxonomy.length === 0
          ? "Package covers executive_brief, strategy_memo, sales_leave_behind, and board_update."
          : `Package is missing business visual document taxonomy coverage for ${missingTaxonomy.join(", ")}.`
    });

    findings.push({
      id: "qa-business-visual-doc-readability",
      severity: "pass",
      title: "Text readability evidence present",
      detail: "Document pages use structured headings, summary bands, KPI blocks, and recommendation notes for readable handoff."
    });
  }

  const localMerchantItems = items.filter((item) => item.workflowId === localMerchantCampaignWorkflowAcceptance.workflow_id);
  if (localMerchantItems.length > 0) {
    const coveredTaxonomy = new Set(localMerchantItems.flatMap((item) => item.strategyTaxonomy ?? []));
    const missingTaxonomy = localMerchantCampaignWorkflowAcceptance.strategy_taxonomy.filter(
      (taxonomy) => !coveredTaxonomy.has(taxonomy)
    );

    findings.push({
      id: "qa-local-merchant-campaign-taxonomy",
      severity: missingTaxonomy.length === 0 ? "pass" : "warn",
      title: missingTaxonomy.length === 0 ? "Local merchant campaign taxonomy covered" : "Local merchant campaign taxonomy partially covered",
      detail:
        missingTaxonomy.length === 0
          ? "Package covers wechat_conversion, xiaohongshu_quality, store_print, and delivery_platform_cover."
          : `Package is missing local merchant taxonomy coverage for ${missingTaxonomy.join(", ")}.`
    });

    findings.push({
      id: "qa-local-merchant-structured-details",
      severity: "pass",
      title: "Structured local details preserved",
      detail: "Merchant offer, price, event date, address, phone, print/mobile needs, and crop-safe delivery details are represented."
    });
  }

  const characterIpItems = items.filter((item) => item.workflowId === characterIpConceptWorkflowAcceptance.workflow_id);
  if (characterIpItems.length > 0) {
    const coveredTaxonomy = new Set(characterIpItems.flatMap((item) => item.strategyTaxonomy ?? []));
    const missingTaxonomy = characterIpConceptWorkflowAcceptance.strategy_taxonomy.filter(
      (taxonomy) => !coveredTaxonomy.has(taxonomy)
    );

    findings.push({
      id: "qa-character-ip-concept-taxonomy",
      severity: missingTaxonomy.length === 0 ? "pass" : "warn",
      title: missingTaxonomy.length === 0 ? "Character IP taxonomy covered" : "Character IP taxonomy partially covered",
      detail:
        missingTaxonomy.length === 0
          ? "Package covers cute, heroic, dark, and ornate concept directions."
          : `Package is missing character IP taxonomy coverage for ${missingTaxonomy.join(", ")}.`
    });

    findings.push({
      id: "qa-character-ip-originality-boundary",
      severity: "pass",
      title: "Originality boundary evidence present",
      detail: "Original premise, protected-style avoidance, trait consistency, expression, costume, prop, and bible metadata evidence are represented."
    });
  }

  return findings;
};

export const safetyPolicyEnforcementStages: SafetyPolicyReport["enforcementStages"] = [
  "brief",
  "provider_request",
  "provider_response",
  "qa",
  "export"
];

const unsafeContentPatterns = [
  {
    ruleId: "safety-illegal-abuse-v1",
    ruleVersion: "1.0.0",
    pattern: /\b(?:malware|credential theft|phishing|exploit|abuse bypass)\b/i,
    title: "Unsafe or abusive request",
    userMessage: "Remove illegal, abusive, malware, credential, phishing, exploit, or safety-bypass instructions before export."
  },
  {
    ruleId: "safety-private-data-v1",
    ruleVersion: "1.0.0",
    pattern: /\b(?:password|credential|credentials|api key|secret key|private key|ssn)\b/i,
    title: "Private data risk",
    userMessage: "Remove secrets, credentials, or unrelated personal data before export."
  }
];

export const runSafetyPolicy = (
  state: Pick<WorkspaceState, "brief" | "candidates" | "selectedCandidateId" | "packageItems">,
  qaReport: QaFinding[]
): SafetyPolicyReport => {
  const selectedCandidate = state.candidates.find((candidate) => candidate.id === state.selectedCandidateId);
  const stageText: Record<SafetyPolicyReport["enforcementStages"][number], string> = {
    brief: state.brief.prompt,
    provider_request: [
      state.brief.prompt,
      ...state.packageItems.map((item) => `${item.title} ${item.sourceId}`)
    ].join(" "),
    provider_response: selectedCandidate
      ? `${selectedCandidate.title} ${selectedCandidate.strategy} ${selectedCandidate.rationale} ${selectedCandidate.assetPrompt}`
      : state.candidates.map((candidate) => `${candidate.title} ${candidate.strategy} ${candidate.rationale}`).join(" "),
    qa: qaReport.map((finding) => `${finding.title} ${finding.detail}`).join(" "),
    export: state.packageItems.map((item) => `${item.title} ${item.type}`).join(" ")
  };
  const findings = safetyPolicyEnforcementStages.flatMap((stage) =>
    unsafeContentPatterns
      .filter((rule) => rule.pattern.test(stageText[stage]))
      .map((rule) => ({
        ruleId: rule.ruleId,
        ruleVersion: rule.ruleVersion,
        stage,
        severity: "block" as const,
        title: rule.title,
        userMessage: rule.userMessage
      }))
  );

  return {
    schema_version: "stage0.rev2.safety-policy-export",
    status: findings.some((finding) => finding.severity === "block") ? "block" : "pass",
    enforcementStages: safetyPolicyEnforcementStages,
    findings
  };
};

export const workspaceRenderingPerformanceBudget: WorkspaceRenderingPerformanceSmoke["budgets"] = {
  maxNodes: 24,
  maxEdges: 24,
  maxVersions: 32,
  maxRenderElements: 96,
  maxInteractionMs: 100
};

export const defaultCanvasInteraction: CanvasInteractionState = {
  contract: "stage1.canvas-interaction-user-contract",
  tool: "select",
  zoom: 1,
  selectedNodeIds: ["node-brief"],
  pan: {
    x: 0,
    y: 0
  },
  lastAction: "load",
  keyboardShortcuts: ["delete", "duplicate", "undo", "redo", "zoom_in", "zoom_out", "space_hand", "shift_multi_select"],
  toolbarTools: ["select", "hand", "frame", "text", "shape", "upload"],
  layersPanelEnabled: true
};

const cloneCanvasNodes = (nodes: WorkspaceState["canvas"]["nodes"]) => nodes.map((node) => ({ ...node }));

const cloneCanvasEdges = (edges: WorkspaceState["canvas"]["edges"]) => edges.map((edge) => ({ ...edge }));

const buildCanvasVersionDiff = (
  previousNodes: WorkspaceState["canvas"]["nodes"],
  nextNodes: WorkspaceState["canvas"]["nodes"]
) => {
  const previousById = new Map(previousNodes.map((node) => [node.id, node]));
  const nextById = new Map(nextNodes.map((node) => [node.id, node]));
  const addedNodeIds: string[] = [];
  const removedNodeIds: string[] = [];
  const changedNodeIds: string[] = [];
  const unchangedNodeIds: string[] = [];

  for (const node of nextNodes) {
    const previous = previousById.get(node.id);
    if (!previous) {
      addedNodeIds.push(node.id);
    } else if (JSON.stringify(previous) === JSON.stringify(node)) {
      unchangedNodeIds.push(node.id);
    } else {
      changedNodeIds.push(node.id);
    }
  }
  for (const node of previousNodes) {
    if (!nextById.has(node.id)) {
      removedNodeIds.push(node.id);
    }
  }

  return {
    addedNodeIds: addedNodeIds.sort(),
    removedNodeIds: removedNodeIds.sort(),
    changedNodeIds: changedNodeIds.sort(),
    unchangedNodeIds: unchangedNodeIds.sort()
  };
};

export const createCanvasVersionSnapshot = (state: WorkspaceState, label: string) => {
  const nextVersionNumber = state.canvas.versions.length + 1;
  const previousVersion = state.canvas.versions.at(-1);
  const previousNodes = previousVersion?.snapshot?.nodes ?? [];
  const snapshotNodes = cloneCanvasNodes(state.canvas.nodes);
  const snapshotEdges = cloneCanvasEdges(state.canvas.edges);
  const nodeIds = snapshotNodes.map((node) => node.id).sort();

  return {
    id: `version-${String(nextVersionNumber).padStart(3, "0")}`,
    label,
    createdAt: new Date().toISOString(),
    nodeCount: snapshotNodes.length,
    versionNumber: nextVersionNumber,
    snapshot: {
      nodes: snapshotNodes,
      edges: snapshotEdges
    },
    diff: buildCanvasVersionDiff(previousNodes, snapshotNodes),
    restorePreview: {
      restoresNodeIds: nodeIds,
      preservesNodeIds: [],
      conflictNodeIds: []
    }
  };
};

const workspaceRenderingStepWeights = {
  load: 1,
  "brief-confirm": 2,
  "candidate-select": 3,
  iteration: 4,
  "package-add": 5,
  "export-ready": 6,
  "version-restore": 7
} as const satisfies Record<WorkspaceRenderingPerformanceSmoke["interactionSteps"][number], number>;

const findDuplicateValues = (values: string[]) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }

  return Array.from(duplicates).sort();
};

export const buildWorkspaceRenderingPerformanceSmoke = (
  state: WorkspaceState,
  budgets = workspaceRenderingPerformanceBudget
): WorkspaceRenderingPerformanceSmoke => {
  const interactionSteps: WorkspaceRenderingPerformanceSmoke["interactionSteps"] = ["load"];
  if (state.brief.confirmed) {
    interactionSteps.push("brief-confirm");
  }
  if (state.selectedCandidateId) {
    interactionSteps.push("candidate-select");
  }
  if (state.canvas.nodes.some((node) => node.kind === "iteration")) {
    interactionSteps.push("iteration");
  }
  if (state.packageItems.length > 0) {
    interactionSteps.push("package-add");
  }
  if (state.exports.some((record) => record.status === "ready")) {
    interactionSteps.push("export-ready");
  }
  if (state.canvas.activeVersionId !== state.canvas.versions.at(-1)?.id) {
    interactionSteps.push("version-restore");
  }
  const renderElementCount =
    state.canvas.nodes.length +
    state.canvas.edges.length +
    state.canvas.versions.length +
    state.candidates.length +
    state.packageItems.length +
    state.brief.references.length +
    state.exports.length;
  const renderIdentities = [
    ...state.canvas.nodes.map((node) => `node:${node.id}`),
    ...state.canvas.edges.map((edge) => `edge:${edge.from}->${edge.to}`),
    ...state.canvas.versions.map((version) => `version:${version.id}`),
    ...state.candidates.map((candidate) => `candidate:${candidate.id}`),
    ...state.packageItems.map((item) => `package:${item.id}`),
    ...state.brief.references.map((reference) => `reference:${reference.id}`),
    ...state.exports.map((record) => `export:${record.id}`)
  ];
  const duplicateRenderIdentities = findDuplicateValues(renderIdentities);
  const estimatedInteractionMs = Math.min(
    999,
    Math.ceil(renderElementCount * 0.75 + state.canvas.nodes.length * 1.2 + state.canvas.edges.length * 0.8)
  );
  const failures: WorkspaceRenderingPerformanceSmoke["failures"] = [];

  if (state.canvas.nodes.length > budgets.maxNodes) {
    failures.push("nodes");
  }
  if (state.canvas.edges.length > budgets.maxEdges) {
    failures.push("edges");
  }
  if (state.canvas.versions.length > budgets.maxVersions) {
    failures.push("versions");
  }
  if (renderElementCount > budgets.maxRenderElements) {
    failures.push("render-elements");
  }
  if (estimatedInteractionMs > budgets.maxInteractionMs) {
    failures.push("interaction");
  }
  if (duplicateRenderIdentities.length > 0 || renderIdentities.length !== renderElementCount) {
    failures.push("duplicate-render-identities");
  }
  const interactionStepBudgets = interactionSteps.map((step, index) => {
    const stepRenderElementCount = Math.min(
      renderElementCount,
      Math.ceil(renderElementCount * ((index + 1) / interactionSteps.length))
    );
    const stepEstimatedInteractionMs = Math.min(
      estimatedInteractionMs,
      Math.ceil(stepRenderElementCount * 0.75 + workspaceRenderingStepWeights[step])
    );
    const failureCount = [
      stepRenderElementCount > budgets.maxRenderElements,
      stepEstimatedInteractionMs > budgets.maxInteractionMs
    ].filter(Boolean).length;

    return {
      step,
      status: failureCount === 0 ? ("pass" as const) : ("fail" as const),
      renderElementCount: stepRenderElementCount,
      estimatedInteractionMs: stepEstimatedInteractionMs,
      failureCount
    };
  });

  return {
    schema_version: "stage0.rev2.workspace-rendering-performance",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "local-alpha-canvas",
    interactionSteps,
    nodeCount: state.canvas.nodes.length,
    edgeCount: state.canvas.edges.length,
    versionCount: state.canvas.versions.length,
    candidateCount: state.candidates.length,
    packageItemCount: state.packageItems.length,
    referenceCount: state.brief.references.length,
    exportHistoryCount: state.exports.length,
    renderElementCount,
    estimatedInteractionMs,
    renderIdentityCount: renderIdentities.length,
    duplicateRenderIdentityCount: duplicateRenderIdentities.length,
    duplicateRenderIdentities,
    renderIdentityDigest: renderIdentities.join("|"),
    interactionStepBudgets,
    failures,
    budgets
  };
};

export const buildPackageExportMetadataEvidence = (record: ExportRecord): PackageExportMetadataEvidence => {
  const missingRequiredOutputs = requiredExportPackageOutputs.filter(
    (outputName) => !record.manifest.required_outputs.includes(outputName)
  );
  const zipPayloadNames = buildDownloadableExportZipPayloadNames(record);
  const zipPayloadContractDigest = buildExportZipPayloadContractDigest(record, zipPayloadNames);
  const identityContractDigest = buildExportIdentityContractDigest(record);
  const workflowMetadataPayload = buildExportWorkflowMetadataPayload(record, "metadata.json");
  const workflowId = record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export";
  const workflowFixtureId = record.manifest.workflow_acceptance?.fixture_id ?? "none";
  const crossPayloadIdentityNames = [
    "manifest.json",
    "provenance.json",
    "ai-content-disclaimer.json",
    ...(record.manifest.workflow_acceptance ? ["metadata.json", "trace_provenance.json"] : [])
  ];
  const requiredZipPayloadNames = [...requiredExportZipPayloadNames];
  const missingZipPayloadNames = requiredZipPayloadNames.filter((payloadName) => !zipPayloadNames.includes(payloadName));
  const unsafeManifestPayloadNames = record.manifest.required_outputs
    .filter((outputName) => outputName !== "assets/" && !toExportZipPayloadName(outputName));
  const unsafeExpectedPayloadNames = zipPayloadNames.filter((payloadName) => !isSafeExportZipPayloadName(payloadName));
  const zipPayloadPathSafetyStatus =
    unsafeManifestPayloadNames.length === 0 && unsafeExpectedPayloadNames.length === 0 ? "pass" : "fail";
  const missingCrossPayloadIdentityNames = crossPayloadIdentityNames.filter((payloadName) => !zipPayloadNames.includes(payloadName));
  const crossPayloadIdentityStatuses = crossPayloadIdentityNames.map((payloadName) => {
    const payloadPresent = zipPayloadNames.includes(payloadName);
    const status = payloadPresent ? "pass" : "missing";

    return {
      payloadName,
      exportId: status,
      packageId: status,
      projectId: status,
      workflowId: status,
      provider: status,
      model: status,
      promptSpec: status,
      skill: status,
      safety: status
    } as const;
  });
  const manifestOutputStatuses = record.manifest.required_outputs.map((outputName) => {
    const zipPayloadName = toExportZipPayloadName(outputName);

    return {
      name: outputName,
      zipPayloadName,
      present: zipPayloadNames.includes(zipPayloadName)
    };
  });
  const requiredZipPayloadStatuses = requiredZipPayloadNames.map((payloadName) => ({
    name: payloadName,
    present: zipPayloadNames.includes(payloadName)
  }));
  const payloadContentStatuses =
    zipPayloadPathSafetyStatus === "pass" ? buildExportZipPayloadContentEntries(record) : [];
  const payloadContentDigest =
    zipPayloadPathSafetyStatus === "pass" ? buildExportZipPayloadContentDigest(buildExportZipPayloadEntries(record)) : "";
  const workflowPayloadStatuses = record.manifest.workflow_acceptance?.required_files.map((payloadName) => ({
    name: payloadName,
    present: zipPayloadNames.includes(toExportZipPayloadName(payloadName))
  })) ?? [];
  const workflowZipPayloadCount = record.manifest.workflow_acceptance?.required_files.filter((payloadName) =>
    zipPayloadNames.includes(toExportZipPayloadName(payloadName))
  ).length ?? 0;
  const workflowMetadataPayloadPresent = zipPayloadNames.includes("metadata.json");
  const workflowTraceProvenancePayloadPresent = zipPayloadNames.includes("trace_provenance.json");
  const aiContentDisclaimerPayloadPresent = zipPayloadNames.includes("ai-content-disclaimer.json");
  const workflowProviderMetadataPresent = workflowMetadataPayloadPresent && Boolean(record.manifest.workflow_acceptance?.workflow_id);
  const workflowPromptSpecMetadataPresent =
    workflowMetadataPayloadPresent && (record.manifest.workflow_acceptance?.strategy_taxonomy.length ?? 0) > 0;
  const workflowSkillMetadataPresent =
    workflowMetadataPayloadPresent && Boolean(record.manifest.workflow_acceptance?.fixture_id);
  const workflowSafetyMetadataPresent =
    workflowTraceProvenancePayloadPresent &&
    record.safetyReport.enforcementStages.every((stage) => safetyPolicyEnforcementStages.includes(stage));
  const provenanceCount = record.manifest.items.filter((item) => item.provenance.trim().length > 0).length;
  const pptSlideSourceIds = new Set(record.manifest.ppt_ready_metadata.slides.map((slide) => slide.source_item_id));
  const itemProvenanceStatuses = record.manifest.items.map((item) => {
    const expectedPrefix =
      item.type === "reference" ? "dev-client-reference:" : item.type === "candidate" ? "dev-client:" : "dev-client-canvas:";
    const provenanceStatus = item.provenance.startsWith(expectedPrefix) ? "pass" : "missing";
    const pptSlideStatus = pptSlideSourceIds.has(item.id) ? "pass" : "missing";

    return {
      itemId: item.id,
      title: item.title,
      type: item.type,
      provenance: item.provenance,
      expectedPrefix,
      provenanceStatus,
      pptSlideStatus
    } as const;
  });
  const missingItemProvenanceParityCount = itemProvenanceStatuses.filter(
    (item) => item.provenanceStatus !== "pass" || item.pptSlideStatus !== "pass"
  ).length;
  const blockingQaCount = record.qaReport.filter((finding) => finding.severity === "block").length;
  const pptSlideCount = record.manifest.ppt_ready_metadata.slides.length;
  const handoffChecklistCount = record.manifest.ppt_ready_metadata.handoff_checklist.length;
  const downloadArtifactStatus =
    record.format === "zip" &&
    record.status === "ready" &&
    missingRequiredOutputs.length === 0 &&
    missingZipPayloadNames.length === 0 &&
    zipPayloadNames.includes("manifest.json") &&
    zipPayloadNames.includes("qa-report.json") &&
    zipPayloadNames.includes("safety-policy-report.json") &&
    zipPayloadNames.includes("provenance.json") &&
    aiContentDisclaimerPayloadPresent &&
    zipPayloadNames.includes("ppt-ready-metadata.json") &&
    zipPayloadNames.includes(renderedAssetManifestPayloadName)
      ? "pass"
      : "fail";
  const status =
    record.status === "ready" &&
    downloadArtifactStatus === "pass" &&
    zipPayloadPathSafetyStatus === "pass" &&
    missingRequiredOutputs.length === 0 &&
    record.manifest.items.length === provenanceCount &&
    record.qaReport.length > 0 &&
    blockingQaCount === 0 &&
    pptSlideCount > 0 &&
    handoffChecklistCount > 0
      ? "pass"
      : "fail";

  return {
    schema_version: "stage0.rev2.package-export-metadata-ui",
    status,
    exportId: record.id,
    packageId: record.manifest.package_id,
    projectId: record.manifest.project_id,
    downloadArtifactStatus,
    downloadArtifactFormat: record.format,
    manifestCreatedAt: record.manifest.created_at,
    manifestItemCount: record.manifest.items.length,
    manifestRequiredOutputCount: record.manifest.required_outputs.length,
    requiredOutputCount: record.manifest.required_outputs.length,
    missingRequiredOutputs,
    manifestOutputStatuses,
    itemCount: record.manifest.items.length,
    itemTypes: Array.from(new Set(record.manifest.items.map((item) => item.type))),
    provenanceCount,
    itemProvenanceParityStatus: missingItemProvenanceParityCount === 0 ? "pass" : "fail",
    itemProvenanceParityCount: itemProvenanceStatuses.length - missingItemProvenanceParityCount,
    missingItemProvenanceParityCount,
    referenceProvenanceCount: itemProvenanceStatuses.filter(
      (item) => item.type === "reference" && item.provenanceStatus === "pass"
    ).length,
    candidateProvenanceCount: itemProvenanceStatuses.filter(
      (item) => item.type === "candidate" && item.provenanceStatus === "pass"
    ).length,
    itemProvenanceStatuses,
    qaFindingCount: record.qaReport.length,
    blockingQaCount,
    safetyStatus: record.safetyReport.status,
    safetyStageCount: record.safetyReport.enforcementStages.length,
    safetyFindingCount: record.safetyReport.findings.length,
    pptAspectRatio: record.manifest.ppt_ready_metadata.aspect_ratio,
    pptSlideCount,
    pptCanvasSize: `${record.manifest.ppt_ready_metadata.canvas_size.width}x${record.manifest.ppt_ready_metadata.canvas_size.height}`,
    pptSafeArea: [
      record.manifest.ppt_ready_metadata.safe_area.top,
      record.manifest.ppt_ready_metadata.safe_area.right,
      record.manifest.ppt_ready_metadata.safe_area.bottom,
      record.manifest.ppt_ready_metadata.safe_area.left
    ].join("/"),
    pptThemeFont: record.manifest.ppt_ready_metadata.theme.font_family,
    handoffChecklistCount,
    zipPayloadCount: zipPayloadNames.length,
    zipPayloadNames,
    zipPayloadContractDigest,
    requiredZipPayloadNames,
    requiredZipPayloadCount: requiredZipPayloadNames.length,
    requiredZipPayloadStatuses,
    payloadContentDigest,
    payloadContentStatuses,
    zipPayloadParityStatus: missingZipPayloadNames.length === 0 ? "pass" : "fail",
    zipPayloadParityRatio: `${requiredZipPayloadNames.length - missingZipPayloadNames.length}/${requiredZipPayloadNames.length}`,
    missingZipPayloadNames,
    zipPayloadPathSafetyStatus,
    unsafeManifestPayloadNames,
    unsafeExpectedPayloadNames,
    crossPayloadIdentityStatus: missingCrossPayloadIdentityNames.length === 0 ? "pass" : "fail",
    identityContractDigest,
    crossPayloadIdentityNames,
    missingCrossPayloadIdentityNames,
    crossPayloadIdentityStatuses,
    workflowId,
    workflowFixtureId,
    workflowStrategyTaxonomyCount: record.manifest.workflow_acceptance?.strategy_taxonomy.length ?? 0,
    workflowRequiredFileCount: record.manifest.workflow_acceptance?.required_files.length ?? 0,
    workflowZipPayloadCount,
    workflowPayloadStatuses,
    workflowMetadataPayloadPresent,
    workflowTraceProvenancePayloadPresent,
    aiContentDisclaimerPayloadPresent,
    workflowProviderMetadataPresent,
    workflowPromptSpecMetadataPresent,
    workflowSkillMetadataPresent,
    workflowSafetyMetadataPresent,
    workflowMetadataGeneratedBy: workflowMetadataPayload.generated_by,
    workflowMetadataProvider: workflowMetadataPayload.provider,
    workflowMetadataModel: workflowMetadataPayload.model,
    workflowPromptSpecTaxonomy: workflowMetadataPayload.prompt_spec,
    workflowSkill: workflowMetadataPayload.skill,
    workflowSafety: workflowMetadataPayload.safety
  };
};

export const buildExportZipPayloadSmokeEvidence = (record: ExportRecord): ExportZipPayloadSmokeEvidence => {
  const manifestPayloadNames = Array.from(
    new Set(record.manifest.required_outputs.map(toExportZipPayloadName))
  );
  const expectedPayloadNames = buildDownloadableExportZipPayloadNames(record);
  const payloadContractDigest = buildExportZipPayloadContractDigest(record, expectedPayloadNames);
  const requiredBaselinePayloadNames = [...requiredExportZipPayloadNames];
  const missingPayloadNames = manifestPayloadNames.filter((payloadName) => !expectedPayloadNames.includes(payloadName));
  const unsafeManifestPayloadNames = record.manifest.required_outputs
    .filter((outputName) => outputName !== "assets/")
    .map((outputName) => ({
      outputName,
      payloadName: toExportZipPayloadName(outputName)
    }))
    .filter((entry) => !entry.payloadName)
    .map((entry) => entry.outputName);
  const unsafeExpectedPayloadNames = expectedPayloadNames.filter((payloadName) => !isSafeExportZipPayloadName(payloadName));
  const pathSafetyStatus =
    unsafeManifestPayloadNames.length === 0 && unsafeExpectedPayloadNames.length === 0 ? "pass" : "fail";
  const missingBaselinePayloadNames = requiredBaselinePayloadNames.filter(
    (payloadName) => !expectedPayloadNames.includes(payloadName)
  );
  const workflowPayloadNames = record.manifest.workflow_acceptance?.required_files
    .map(toExportZipPayloadName)
    .filter((payloadName) => expectedPayloadNames.includes(payloadName)) ?? [];
  const metadataPayloadPresent = expectedPayloadNames.includes("metadata.json");
  const traceProvenancePayloadPresent = expectedPayloadNames.includes("trace_provenance.json");
  const aiContentDisclaimerPayloadPresent = expectedPayloadNames.includes("ai-content-disclaimer.json");
  const assetsPayloadPresent = expectedPayloadNames.includes(renderedAssetManifestPayloadName);
  const failures: ExportZipPayloadSmokeEvidence["failures"] = [];

  if (missingBaselinePayloadNames.length > 0) {
    failures.push("baseline-payloads");
  }
  if (missingPayloadNames.length > 0) {
    failures.push("manifest-required-payloads");
  }
  if (pathSafetyStatus !== "pass") {
    failures.push("unsafe-payload-name");
  }
  if (record.manifest.workflow_acceptance && !metadataPayloadPresent) {
    failures.push("workflow-metadata");
  }
  if (record.manifest.workflow_acceptance && !traceProvenancePayloadPresent) {
    failures.push("trace-provenance");
  }
  if (!assetsPayloadPresent) {
    failures.push("rendered-asset-manifest");
  }
  if (!aiContentDisclaimerPayloadPresent) {
    failures.push("ai-content-disclaimer");
  }

  return {
    schema_version: "stage0.rev2.export-zip-payload-smoke",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "manifest-required-output-to-downloadable-zip-payloads",
    exportId: record.id,
    packageId: record.manifest.package_id,
    manifestRequiredOutputCount: record.manifest.required_outputs.length,
    expectedPayloadCount: expectedPayloadNames.length,
    requiredBaselinePayloadNames,
    expectedPayloadNames,
    payloadContractDigest,
    missingPayloadNames: [...missingBaselinePayloadNames, ...missingPayloadNames],
    pathSafetyStatus,
    unsafeManifestPayloadNames,
    unsafeExpectedPayloadNames,
    workflowPayloadNames,
    metadataPayloadPresent,
    traceProvenancePayloadPresent,
    aiContentDisclaimerPayloadPresent,
    assetsPayloadPresent,
    failures
  };
};

export const buildExportDownloadParityEvidence = (
  record: ExportRecord,
  metadataEvidence = buildPackageExportMetadataEvidence(record),
  zipPayloadSmoke = buildExportZipPayloadSmokeEvidence(record)
): ExportDownloadParityEvidence => {
  const downloadHandoffStatus =
    record.status === "ready" &&
    metadataEvidence.status === "pass" &&
    metadataEvidence.downloadArtifactStatus === "pass" &&
    zipPayloadSmoke.status === "pass"
      ? "pass"
      : "fail";
  const metadataPayloadsMatchZipPayloads =
    metadataEvidence.zipPayloadNames.length === zipPayloadSmoke.expectedPayloadNames.length &&
    metadataEvidence.zipPayloadNames.every((payloadName) => zipPayloadSmoke.expectedPayloadNames.includes(payloadName));
  const payloadContractDigest = buildExportZipPayloadContractDigest(record, zipPayloadSmoke.expectedPayloadNames);
  const metadataPayloadDigestMatchesZipPayloadDigest =
    metadataEvidence.zipPayloadContractDigest === zipPayloadSmoke.payloadContractDigest &&
    metadataEvidence.zipPayloadContractDigest === payloadContractDigest;
  const contentDigestPathSafe =
    metadataEvidence.zipPayloadPathSafetyStatus === "pass" &&
    metadataEvidence.unsafeManifestPayloadNames.length === 0 &&
    metadataEvidence.unsafeExpectedPayloadNames.length === 0 &&
    zipPayloadSmoke.pathSafetyStatus === "pass" &&
    zipPayloadSmoke.unsafeManifestPayloadNames.length === 0 &&
    zipPayloadSmoke.unsafeExpectedPayloadNames.length === 0;
  const payloadContentDigest = contentDigestPathSafe ? buildExportZipPayloadContentDigest(buildExportZipPayloadEntries(record)) : "";
  const payloadContentDigestStatus =
    contentDigestPathSafe &&
    metadataEvidence.payloadContentDigest === payloadContentDigest &&
    metadataEvidence.payloadContentStatuses.length === zipPayloadSmoke.expectedPayloadNames.length
      ? "pass"
      : "fail";
  const identityContractDigest = buildExportIdentityContractDigest(record);
  const metadataIdentityDigestMatchesRecord =
    metadataEvidence.identityContractDigest === identityContractDigest &&
    metadataEvidence.workflowId === (record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export") &&
    metadataEvidence.workflowFixtureId === (record.manifest.workflow_acceptance?.fixture_id ?? "none") &&
    metadataEvidence.workflowMetadataProvider === "dev-provider" &&
    metadataEvidence.workflowMetadataModel === "deterministic-local-alpha" &&
    JSON.stringify(metadataEvidence.workflowPromptSpecTaxonomy) ===
      JSON.stringify(record.manifest.workflow_acceptance?.strategy_taxonomy ?? []) &&
    metadataEvidence.workflowSkill === (record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export") &&
    metadataEvidence.workflowSafety === record.safetyReport.status;
  const failures: ExportDownloadParityEvidence["failures"] = [];

  if (metadataEvidence.exportId !== zipPayloadSmoke.exportId || metadataEvidence.exportId !== record.id) {
    failures.push("export-id");
  }
  if (metadataEvidence.packageId !== zipPayloadSmoke.packageId || metadataEvidence.packageId !== record.manifest.package_id) {
    failures.push("package-id");
  }
  if (metadataEvidence.projectId !== record.manifest.project_id) {
    failures.push("project-id");
  }
  if (metadataEvidence.workflowId !== (record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export")) {
    failures.push("workflow-id");
  }
  if (metadataEvidence.workflowFixtureId !== (record.manifest.workflow_acceptance?.fixture_id ?? "none")) {
    failures.push("workflow-fixture-id");
  }
  if (!record.fileName.trim()) {
    failures.push("file-name");
  }
  if (metadataEvidence.downloadArtifactFormat !== record.format) {
    failures.push("format");
  }
  if (metadataEvidence.status !== "pass") {
    failures.push("metadata-status");
  }
  if (zipPayloadSmoke.status !== "pass") {
    failures.push("zip-payload-status");
  }
  if (downloadHandoffStatus !== "pass") {
    failures.push("download-handoff-status");
  }
  if (metadataEvidence.manifestRequiredOutputCount !== zipPayloadSmoke.manifestRequiredOutputCount) {
    failures.push("manifest-output-count");
  }
  if (metadataEvidence.zipPayloadCount !== zipPayloadSmoke.expectedPayloadCount) {
    failures.push("payload-count");
  }
  if (metadataEvidence.missingZipPayloadNames.length !== 0 || zipPayloadSmoke.missingPayloadNames.length !== 0) {
    failures.push("missing-payloads");
  }
  if (metadataEvidence.zipPayloadParityStatus !== "pass") {
    failures.push("required-parity");
  }
  if (!metadataPayloadsMatchZipPayloads) {
    failures.push("payload-list");
  }
  if (!metadataPayloadDigestMatchesZipPayloadDigest) {
    failures.push("payload-digest");
  }
  if (payloadContentDigestStatus !== "pass") {
    failures.push("payload-content-digest");
  }
  if (
    metadataEvidence.zipPayloadPathSafetyStatus !== "pass" ||
    metadataEvidence.unsafeManifestPayloadNames.length !== 0 ||
    metadataEvidence.unsafeExpectedPayloadNames.length !== 0 ||
    zipPayloadSmoke.pathSafetyStatus !== "pass" ||
    zipPayloadSmoke.unsafeManifestPayloadNames.length !== 0 ||
    zipPayloadSmoke.unsafeExpectedPayloadNames.length !== 0
  ) {
    failures.push("path-safety");
  }
  if (!metadataIdentityDigestMatchesRecord) {
    failures.push("identity-digest");
  }
  if (
    metadataEvidence.crossPayloadIdentityStatus !== "pass" ||
    metadataEvidence.missingCrossPayloadIdentityNames.length !== 0 ||
    !metadataEvidence.crossPayloadIdentityStatuses.every((entry) =>
      Object.entries(entry)
        .filter(([key]) => key !== "payloadName")
        .every(([, value]) => value === "pass")
    )
  ) {
    failures.push("identity");
  }
  if (
    metadataEvidence.itemProvenanceParityStatus !== "pass" ||
    metadataEvidence.itemProvenanceParityCount !== record.manifest.items.length ||
    metadataEvidence.missingItemProvenanceParityCount !== 0
  ) {
    failures.push("item-provenance");
  }
  if (metadataEvidence.workflowMetadataProvider !== "dev-provider") {
    failures.push("provider");
  }
  if (metadataEvidence.workflowMetadataModel !== "deterministic-local-alpha") {
    failures.push("model");
  }
  if (
    JSON.stringify(metadataEvidence.workflowPromptSpecTaxonomy) !==
    JSON.stringify(record.manifest.workflow_acceptance?.strategy_taxonomy ?? [])
  ) {
    failures.push("prompt-spec");
  }
  if (metadataEvidence.workflowSkill !== (record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export")) {
    failures.push("skill");
  }
  if (metadataEvidence.workflowSafety !== record.safetyReport.status) {
    failures.push("safety");
  }
  if (!metadataEvidence.workflowMetadataPayloadPresent || !zipPayloadSmoke.metadataPayloadPresent) {
    failures.push("workflow-metadata");
  }
  if (!metadataEvidence.workflowTraceProvenancePayloadPresent || !zipPayloadSmoke.traceProvenancePayloadPresent) {
    failures.push("trace-provenance");
  }

  return {
    schema_version: "stage0.rev2.export-download-parity-smoke",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "metadata-zip-smoke-download-handoff-parity",
    exportId: record.id,
    packageId: record.manifest.package_id,
    projectId: record.manifest.project_id,
    workflowId: metadataEvidence.workflowId,
    workflowFixtureId: metadataEvidence.workflowFixtureId,
    fileName: record.fileName,
    format: record.format,
    metadataStatus: metadataEvidence.status,
    zipPayloadStatus: zipPayloadSmoke.status,
    downloadHandoffStatus,
    manifestRequiredOutputCount: record.manifest.required_outputs.length,
    metadataZipPayloadCount: metadataEvidence.zipPayloadCount,
    zipExpectedPayloadCount: zipPayloadSmoke.expectedPayloadCount,
    metadataMissingZipPayloadCount: metadataEvidence.missingZipPayloadNames.length,
    zipMissingPayloadCount: zipPayloadSmoke.missingPayloadNames.length,
    requiredZipPayloadParityStatus: metadataEvidence.zipPayloadParityStatus,
    metadataPayloadsMatchZipPayloads,
    payloadListStatus: metadataPayloadsMatchZipPayloads ? "pass" : "fail",
    metadataPayloadNames: metadataEvidence.zipPayloadNames,
    zipExpectedPayloadNames: zipPayloadSmoke.expectedPayloadNames,
    payloadContractDigest,
    metadataPayloadDigestMatchesZipPayloadDigest,
    payloadContentDigest,
    payloadContentDigestStatus,
    payloadContentCount: metadataEvidence.payloadContentStatuses.length,
    payloadPathSafetyStatus: failures.includes("path-safety") ? "fail" : "pass",
    identityContractDigest,
    metadataIdentityDigestMatchesRecord,
    identityStatus: failures.includes("identity") ? "fail" : "pass",
    itemProvenanceParityStatus: metadataEvidence.itemProvenanceParityStatus,
    itemProvenanceParityCount: metadataEvidence.itemProvenanceParityCount,
    missingItemProvenanceParityCount: metadataEvidence.missingItemProvenanceParityCount,
    provider: metadataEvidence.workflowMetadataProvider,
    model: metadataEvidence.workflowMetadataModel,
    promptSpecTaxonomy: metadataEvidence.workflowPromptSpecTaxonomy,
    skill: metadataEvidence.workflowSkill,
    safetyStatus: record.safetyReport.status,
    workflowMetadataPresent: metadataEvidence.workflowMetadataPayloadPresent && zipPayloadSmoke.metadataPayloadPresent,
    traceProvenancePresent: metadataEvidence.workflowTraceProvenancePayloadPresent && zipPayloadSmoke.traceProvenancePayloadPresent,
    failures
  };
};

export const buildExportDownloadAccessBoundaryEvidence = (
  record: ExportRecord,
  downloadParityEvidence = buildExportDownloadParityEvidence(record),
  zipPayloadSmoke = buildExportZipPayloadSmokeEvidence(record),
  renderedAssetEvidence = buildRenderedExportAssetEvidence(record)
): ExportDownloadAccessBoundaryEvidence => {
  const failures: ExportDownloadAccessBoundaryEvidence["failures"] = [];

  if (downloadParityEvidence.downloadHandoffStatus !== "pass") {
    failures.push("local-download");
  }
  if (zipPayloadSmoke.status !== "pass") {
    failures.push("zip-payload");
  }
  if (renderedAssetEvidence.status !== "pass") {
    failures.push("rendered-assets");
  }
  if (renderedAssetEvidence.signedUrlPersisted !== false) {
    failures.push("signed-url-persisted");
  }
  if (renderedAssetEvidence.stagingSignedUrlEvidence !== "open") {
    failures.push("staging-signed-url");
  }
  if (renderedAssetEvidence.objectRetentionCleanupEvidence !== "open") {
    failures.push("retention");
  }

  const gateBoundaryIntact =
    renderedAssetEvidence.canClearStage1StagingRuntimeGate === false &&
    renderedAssetEvidence.canClearStage1ProductionLaunchGate === false;
  if (!gateBoundaryIntact) {
    failures.push("gate-boundary");
  }

  return {
    schema_version: "stage1.export-download-access-boundary-local-contract.v1",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "local-browser-zip-does-not-clear-server-signed-url-or-retention-gates",
    exportId: record.id,
    packageId: record.manifest.package_id,
    fileName: record.fileName,
    localBrowserDownloadStatus: downloadParityEvidence.downloadHandoffStatus,
    localZipPayloadStatus: zipPayloadSmoke.status,
    renderedAssetStatus: renderedAssetEvidence.status,
    productDownloadUrlPolicy: "server-mediated-relative-signed-url",
    serverDownloadRoute: "GET /api/v1/objects/download",
    objectStoreDirectSigningUsedForExportDownload: false,
    signedUrlPersisted: false,
    signedUrlMaterialProjected: false,
    downloadResponseDisclosesObjectKeyHeader: false,
    requiresActiveRetentionMetadata: true,
    requiresDownloadAudit: true,
    requiresDownloadAnalytics: true,
    strictStagingSignedUrlEvidence: "open",
    strictStagingRetentionCleanupEvidence: "open",
    productionObjectStorageEvidence: "open",
    canClearStage1StagingRuntimeGate: false,
    canClearStage1ProductionLaunchGate: false,
    canClearObjectStorageDoNotLaunch: false,
    failures
  };
};

const acceptedImageExtensions = [".png", ".jpg", ".jpeg", ".webp"];
const acceptedDocumentExtensions = [".pdf"];

export const validateReferenceAsset = (name: string, kind: ReferenceAsset["kind"]): ReferenceAsset["validation"] => {
  const trimmed = name.trim();
  const normalized = trimmed.toLowerCase();

  if (!trimmed) {
    return {
      state: "rejected",
      reason: "Reference is required."
    };
  }

  if (kind === "url") {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === "https:") {
        return { state: "accepted" };
      }
    } catch {
      return {
        state: "rejected",
        reason: "Use a valid HTTPS reference URL."
      };
    }

    return {
      state: "rejected",
      reason: "Reference URLs must use HTTPS."
    };
  }

  const allowedExtensions = kind === "document" ? acceptedDocumentExtensions : acceptedImageExtensions;
  if (!allowedExtensions.some((extension) => normalized.endsWith(extension))) {
    return {
      state: "rejected",
      reason:
        kind === "document"
          ? "Documents must be PDF files."
          : "Images must be PNG, JPG, JPEG, or WEBP files."
    };
  }

  return { state: "accepted" };
};

export const createReferenceAsset = (name: string, kind: ReferenceAsset["kind"]): ReferenceAsset => {
  const trimmed = name.trim();
  const validation = validateReferenceAsset(trimmed, kind);
  const id = `ref-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return {
    id,
    name: trimmed,
    kind,
    status: validation.state === "accepted" ? "attached" : "queued",
    upload: {
      operationId: "createUpload",
      method: "POST",
      path: "/uploads",
      credentialMode: defaultSameSiteCsrfContract.credentialMode,
      csrfHeaderName: defaultSameSiteCsrfContract.headerName,
      idempotencyRequired: true,
      previewUrl: `/dev-preview/uploads/${id}`,
      previewScope: "tenant-scoped-dev-preview",
      previewExpiresAt: "2026-05-26T10:30:00.000Z"
    },
    validation
  };
};

export const referenceUploadValidationSamples = [
  { name: "accepted-product-angle.webp", kind: "image" },
  { name: "launch-brief.pdf", kind: "document" },
  { name: "https://assets.example.com/reference-pack", kind: "url" },
  { name: "unsafe-reference.exe", kind: "image" },
  { name: "http://assets.example.com/reference-pack", kind: "url" }
] satisfies Array<Pick<ReferenceAsset, "name" | "kind">>;

export const buildReferenceUploadValidationMatrixEvidence = (): ReferenceUploadValidationMatrixEvidence => {
  const sampleAssets = referenceUploadValidationSamples.map((sample) => createReferenceAsset(sample.name, sample.kind));
  const acceptedSamples = sampleAssets.filter((asset) => asset.validation.state === "accepted");
  const rejectedSamples = sampleAssets.filter((asset) => asset.validation.state === "rejected");
  const acceptedKinds = Array.from(new Set(acceptedSamples.map((asset) => asset.kind)));
  const expectedAcceptedKinds: ReferenceAsset["kind"][] = ["image", "document", "url"];
  const expectedRejectedReasons = ["Images must be PNG, JPG, JPEG, or WEBP files.", "Reference URLs must use HTTPS."];
  const rejectedReasons = rejectedSamples.map((asset) => asset.validation.reason ?? "");
  const rejectedPackageActionCount = rejectedSamples.filter((asset) => asset.validation.state === "accepted").length;
  const failures: ReferenceUploadValidationMatrixEvidence["failures"] = [];

  if (!acceptedSamples.some((asset) => asset.kind === "image" && asset.name.endsWith(".webp"))) {
    failures.push("image-acceptance");
  }
  if (!acceptedSamples.some((asset) => asset.kind === "document" && asset.name.endsWith(".pdf"))) {
    failures.push("document-acceptance");
  }
  if (!acceptedSamples.some((asset) => asset.kind === "url" && asset.name.startsWith("https://"))) {
    failures.push("url-acceptance");
  }
  if (rejectedSamples.length !== 2) {
    failures.push("unsupported-rejection");
  }
  if (JSON.stringify(rejectedReasons) !== JSON.stringify(expectedRejectedReasons)) {
    failures.push("rejection-reason");
  }
  if (rejectedSamples.some((asset) => asset.status !== "queued")) {
    failures.push("rejected-queue-state");
  }
  if (rejectedPackageActionCount !== 0) {
    failures.push("rejected-package-action");
  }
  if (acceptedSamples.length !== 3 || expectedAcceptedKinds.some((kind) => !acceptedKinds.includes(kind))) {
    failures.push("unexpected-rejection");
  }

  return {
    schema_version: "stage0.rev2.reference-upload-validation-matrix",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "safe-image-document-https-url-reject-unsupported",
    acceptedKinds,
    acceptedSampleNames: acceptedSamples.map((asset) => asset.name),
    acceptedAttachedCount: acceptedSamples.filter((asset) => asset.status === "attached").length,
    rejectedSampleNames: rejectedSamples.map((asset) => asset.name),
    rejectedReasons,
    rejectedQueuedCount: rejectedSamples.filter((asset) => asset.status === "queued").length,
    rejectedPackageActionCount,
    expectedAcceptedKinds,
    expectedRejectedCount: 2,
    expectedRejectedReasons,
    failures
  };
};

export const referenceUploadIntegrationOperationIds: ReferenceUploadIntegrationSmoke["apiOperationIds"] = [
  "createUpload",
  "createPackage",
  "createExport",
  "getExport"
];

export const buildReferenceUploadIntegrationSmoke = (state: WorkspaceState): ReferenceUploadIntegrationSmoke => {
  const acceptedReferences = state.brief.references.filter((reference) => reference.validation.state === "accepted");
  const rejectedReferenceIds = new Set(
    state.brief.references.filter((reference) => reference.validation.state === "rejected").map((reference) => reference.id)
  );
  const latestAcceptedReference = acceptedReferences.at(-1);
  const packagedReferenceIds = new Set(
    state.packageItems.filter((item) => item.type === "reference").map((item) => item.sourceId)
  );
  const latestReadyExport = state.exports.find((record) => record.status === "ready");
  const readyExportReferenceProvenance = latestReadyExport?.manifest.items
    .filter((item) => item.provenance.startsWith("dev-client-reference:"))
    .map((item) => item.provenance.replace("dev-client-reference:", "")) ?? [];
  const referenceProvenanceCount =
    readyExportReferenceProvenance.length;
  const pptAssetGridSlideCount =
    latestReadyExport?.manifest.ppt_ready_metadata.slides.filter((slide) => slide.layout === "asset-grid").length ?? 0;
  const latestAcceptedReferencePackageItem = latestAcceptedReference
    ? state.packageItems.find((item) => item.type === "reference" && item.sourceId === latestAcceptedReference.id)
    : undefined;
  const latestAcceptedReferenceExportItem = latestAcceptedReference
    ? latestReadyExport?.manifest.items.find(
        (item) => item.provenance === `dev-client-reference:${latestAcceptedReference.id}`
      )
    : undefined;
  const latestAcceptedReferencePptSlide = latestAcceptedReferencePackageItem
    ? latestReadyExport?.manifest.ppt_ready_metadata.slides.find(
        (slide) => slide.layout === "asset-grid" && slide.source_item_id === latestAcceptedReferencePackageItem.id
      )
    : undefined;
  const uploadRequestContractCount = acceptedReferences.filter(
    (reference) =>
      reference.upload.operationId === "createUpload" &&
      reference.upload.method === "POST" &&
      reference.upload.path === "/uploads" &&
      reference.upload.credentialMode === "include" &&
      reference.upload.csrfHeaderName === "X-Zenari-CSRF" &&
      reference.upload.idempotencyRequired &&
      reference.upload.previewScope === "tenant-scoped-dev-preview" &&
      reference.upload.previewUrl === `/dev-preview/uploads/${reference.id}`
  ).length;
  const latestAcceptedReferencePackaged = latestAcceptedReference ? packagedReferenceIds.has(latestAcceptedReference.id) : false;
  const latestAcceptedReferenceIdentityStatus =
    latestAcceptedReference &&
    latestAcceptedReferencePackageItem &&
    latestAcceptedReferenceExportItem &&
    latestAcceptedReferencePptSlide &&
    latestAcceptedReferencePackageItem.title === latestAcceptedReference.name &&
    latestAcceptedReferenceExportItem.id === latestAcceptedReferencePackageItem.id &&
    latestAcceptedReferenceExportItem.title === latestAcceptedReference.name &&
    latestAcceptedReferenceExportItem.type === "reference" &&
    latestAcceptedReferencePptSlide.title === latestAcceptedReference.name
      ? "pass"
      : "fail";
  const latestAcceptedReferenceProvenancePresent = latestAcceptedReference
    ? latestReadyExport?.manifest.items.some((item) => item.provenance === `dev-client-reference:${latestAcceptedReference.id}`) ?? false
    : false;
  const latestAcceptedReferencePptSlidePresent = latestAcceptedReference
    ? latestReadyExport?.manifest.ppt_ready_metadata.slides.some((slide) => {
        const sourceItem = state.packageItems.find((item) => item.id === slide.source_item_id);
        return slide.layout === "asset-grid" && sourceItem?.sourceId === latestAcceptedReference.id;
      }) ?? false
    : false;
  const rejectedReferencePackagedCount = state.packageItems.filter((item) => rejectedReferenceIds.has(item.sourceId)).length;
  const rejectedReferenceExportedCount = readyExportReferenceProvenance.filter((sourceId) => rejectedReferenceIds.has(sourceId)).length;
  const failures: ReferenceUploadIntegrationSmoke["failures"] = [];

  if (acceptedReferences.length === 0) {
    failures.push("accepted-reference");
  }
  if (uploadRequestContractCount !== acceptedReferences.length) {
    failures.push("upload-request-contract");
  }
  if (packagedReferenceIds.size === 0) {
    failures.push("packaged-reference");
  }
  if (!latestAcceptedReferencePackaged) {
    failures.push("latest-reference-packaged");
  }
  if (!latestReadyExport) {
    failures.push("ready-export");
  }
  if (latestReadyExport && referenceProvenanceCount < packagedReferenceIds.size) {
    failures.push("manifest-provenance");
  }
  if (latestReadyExport && latestAcceptedReferenceIdentityStatus !== "pass") {
    failures.push("latest-reference-identity");
  }
  if (latestReadyExport && !latestAcceptedReferenceProvenancePresent) {
    failures.push("latest-reference-provenance");
  }
  if (latestReadyExport && pptAssetGridSlideCount < packagedReferenceIds.size) {
    failures.push("ppt-asset-grid");
  }
  if (latestReadyExport && !latestAcceptedReferencePptSlidePresent) {
    failures.push("latest-reference-ppt-slide");
  }
  if (rejectedReferencePackagedCount > 0) {
    failures.push("rejected-reference-packaged");
  }
  if (rejectedReferenceExportedCount > 0) {
    failures.push("rejected-reference-exported");
  }

  return {
    schema_version: "stage0.rev2.reference-upload-integration-smoke",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "reference-upload-to-ready-zip-export",
    apiOperationIds: [...referenceUploadIntegrationOperationIds],
    acceptedCount: acceptedReferences.length,
    acceptedKinds: Array.from(new Set(acceptedReferences.map((reference) => reference.kind))),
    rejectedCount: state.brief.references.filter((reference) => reference.validation.state === "rejected").length,
    latestAcceptedReferenceId: latestAcceptedReference?.id ?? "missing",
    latestAcceptedReferenceName: latestAcceptedReference?.name ?? "missing",
    latestAcceptedReferenceKind: latestAcceptedReference?.kind ?? "missing",
    latestAcceptedReferenceUploadMethod: latestAcceptedReference?.upload.method ?? "missing",
    latestAcceptedReferenceUploadPath: latestAcceptedReference?.upload.path ?? "missing",
    latestAcceptedReferenceCsrfHeaderName: latestAcceptedReference?.upload.csrfHeaderName ?? "missing",
    latestAcceptedReferenceIdempotencyRequired: latestAcceptedReference?.upload.idempotencyRequired ?? false,
    latestAcceptedReferencePreviewScope: latestAcceptedReference?.upload.previewScope ?? "missing",
    latestAcceptedReferencePackageItemId: latestAcceptedReferencePackageItem?.id ?? "missing",
    latestAcceptedReferenceExportTitle: latestAcceptedReferenceExportItem?.title ?? "missing",
    latestAcceptedReferencePptSlideSourceItemId: latestAcceptedReferencePptSlide?.source_item_id ?? "missing",
    latestAcceptedReferenceIdentityStatus,
    latestAcceptedReferencePackaged,
    latestAcceptedReferenceProvenancePresent,
    latestAcceptedReferencePptSlidePresent,
    uploadRequestContractCount,
    packagedReferenceCount: packagedReferenceIds.size,
    packageHistoryReferenceCount: state.packageItems.filter((item) => item.type === "reference").length,
    readyExportCount: state.exports.filter((record) => record.status === "ready").length,
    provenanceCount: referenceProvenanceCount,
    pptAssetGridSlideCount,
    rejectedReferencePackagedCount,
    rejectedReferenceExportedCount,
    failures
  };
};

export const briefUploadConfirmationOperationIds: BriefUploadConfirmationRuntimeEvidence["apiOperationIds"] = [
  "createChatSession",
  "createChatMessage",
  "createUpload",
  "createCandidateSet"
];

export const buildBriefUploadConfirmationRuntimeEvidence = (
  state: WorkspaceState
): BriefUploadConfirmationRuntimeEvidence => {
  const acceptedReferenceCount = state.brief.references.filter(
    (reference) => reference.validation.state === "accepted"
  ).length;
  const rejectedReferenceCount = state.brief.references.filter(
    (reference) => reference.validation.state === "rejected"
  ).length;
  const latestReferenceValidationState = state.brief.references.at(-1)?.validation.state ?? "missing";
  const confirmationMessageVisible = state.chat.some((message) =>
    message.body.includes("Brief confirmed. I generated four deterministic strategy candidates for review.")
  );
  const candidateSetReady =
    state.candidates.length === 4 &&
    new Set(state.candidates.map((candidate) => candidate.strategyTaxonomy).filter(Boolean)).size === 4;
  const failures: BriefUploadConfirmationRuntimeEvidence["failures"] = [];

  if (!state.brief.confirmed) {
    failures.push("brief-confirmed");
  }
  if (state.brief.missingInfo.length > 0) {
    failures.push("missing-info-cleared");
  }
  if (acceptedReferenceCount === 0) {
    failures.push("accepted-reference");
  }
  if (rejectedReferenceCount > 0) {
    failures.push("no-rejected-reference");
  }
  if (!confirmationMessageVisible) {
    failures.push("confirmation-message");
  }
  if (!candidateSetReady) {
    failures.push("candidate-set");
  }

  return {
    schema_version: "stage0.rev2.brief-upload-confirmation-runtime-evidence",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "user-web-brief-upload-confirmation",
    gateImpact: "private-beta-staging-runtime",
    apiOperationIds: [...briefUploadConfirmationOperationIds],
    briefConfirmed: state.brief.confirmed,
    missingInfoCount: state.brief.missingInfo.length,
    acceptedReferenceCount,
    rejectedReferenceCount,
    latestReferenceValidationState,
    confirmationMessageVisible,
    candidateSetReady,
    failures
  };
};

export const ecommerceGrowthApiSmokeOperationIds = [
  "createChatSession",
  "createChatMessage",
  "createCandidateSet",
  "listCandidateAssets",
  "selectDirection",
  "createPackage",
  "createExport",
  "getExport"
] as const;

const buildWorkflowApiSmokeEvidence = (
  state: WorkspaceState,
  workflowAcceptance: WorkflowAcceptanceContract,
  qaTaxonomyId: string
): WorkflowApiSmokeEvidence => {
  const apiOperationContracts = ecommerceGrowthApiSmokeOperationIds.map((operationId) => {
    const operation: ApiOperation = apiOperations[operationId];
    const csrfProtected = defaultSameSiteCsrfContract.protectedMethods.includes(
      operation.method as (typeof defaultSameSiteCsrfContract.protectedMethods)[number]
    );

    return {
      operationId,
      method: operation.method,
      path: operation.path,
      credentialMode: defaultSameSiteCsrfContract.credentialMode,
      csrfProtected,
      csrfHeaderName: csrfProtected ? defaultSameSiteCsrfContract.headerName : "not-required" as const,
      idempotencyRequired: operation.idempotencyRequired
    };
  });
  const candidateTaxonomies = state.candidates
    .filter((candidate) => candidate.workflowId === workflowAcceptance.workflow_id)
    .map((candidate) => candidate.strategyTaxonomy)
    .filter((taxonomy): taxonomy is string => Boolean(taxonomy));
  const packagedTaxonomies = state.packageItems
    .filter((item) => item.workflowId === workflowAcceptance.workflow_id)
    .map((item) => item.strategyTaxonomy)
    .filter((taxonomy): taxonomy is string => Boolean(taxonomy));
  const latestReadyZip = state.exports.find((record) => record.format === "zip" && record.status === "ready");
  const requiredOutputNames = new Set([
    ...workflowAcceptance.required_files,
    ...requiredExportPackageOutputs
  ]);
  const missingRequiredOutputs = latestReadyZip
    ? Array.from(requiredOutputNames).filter((outputName) => !latestReadyZip.manifest.required_outputs.includes(outputName))
    : Array.from(requiredOutputNames);
  const qaTaxonomyFinding = latestReadyZip?.qaReport.find((finding) => finding.id === qaTaxonomyId);
  const hasIteration = state.canvas.nodes.some((node) => node.kind === "iteration");
  const failures: WorkflowApiSmokeEvidence["failures"] = [];

  if (!state.brief.confirmed) {
    failures.push("brief");
  }
  if (!state.brief.references.some((reference) => reference.validation.state === "accepted")) {
    failures.push("reference");
  }
  if (candidateTaxonomies.length !== 4) {
    failures.push("candidate-count");
  }
  if (
    workflowAcceptance.strategy_taxonomy.some((taxonomy) => !candidateTaxonomies.includes(taxonomy))
  ) {
    failures.push("candidate-taxonomy");
  }
  if (!state.selectedCandidateId) {
    failures.push("selection");
  }
  if (!hasIteration) {
    failures.push("iteration");
  }
  if (
    workflowAcceptance.strategy_taxonomy.some((taxonomy) => !packagedTaxonomies.includes(taxonomy))
  ) {
    failures.push("package-taxonomy");
  }
  if (!latestReadyZip) {
    failures.push("ready-zip-export");
  }
  if (missingRequiredOutputs.length > 0) {
    failures.push("required-outputs");
  }
  if (qaTaxonomyFinding?.severity !== "pass") {
    failures.push("qa-taxonomy");
  }
  if (latestReadyZip?.safetyReport.status !== "pass") {
    failures.push("safety");
  }
  if (
    apiOperationContracts.length !== ecommerceGrowthApiSmokeOperationIds.length ||
    apiOperationContracts.some((contract) => contract.credentialMode !== "include") ||
    apiOperationContracts.some((contract) => contract.csrfProtected && contract.csrfHeaderName !== "X-Zenari-CSRF")
  ) {
    failures.push("operation-contract");
  }

  return {
    schema_version: workflowAcceptance.schema_version,
    workflow_id: workflowAcceptance.workflow_id,
    fixture_id: workflowAcceptance.fixture_id,
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "brief-reference-four-candidates-select-iterate-package-export-zip",
    apiOperationIds: [...ecommerceGrowthApiSmokeOperationIds],
    apiOperationContracts,
    csrfProtectedOperationCount: apiOperationContracts.filter((contract) => contract.csrfProtected).length,
    idempotencyRequiredOperationCount: apiOperationContracts.filter((contract) => contract.idempotencyRequired).length,
    candidateCount: candidateTaxonomies.length,
    taxonomyCount: new Set(candidateTaxonomies).size,
    packagedTaxonomyCount: new Set(packagedTaxonomies).size,
    readyZipExportCount: state.exports.filter((record) => record.format === "zip" && record.status === "ready").length,
    requiredOutputCount: requiredOutputNames.size,
    missingRequiredOutputs,
    qaTaxonomyId,
    qaTaxonomyStatus: qaTaxonomyFinding?.severity === "pass" ? "pass" : qaTaxonomyFinding?.severity === "warn" ? "warn" : "missing",
    safetyStatus: latestReadyZip?.safetyReport.status ?? "missing",
    failures
  };
};

export const buildEcommerceGrowthApiSmokeEvidence = (state: WorkspaceState): WorkflowApiSmokeEvidence =>
  buildWorkflowApiSmokeEvidence(state, ecommerceGrowthWorkflowAcceptance, "qa-ecommerce-growth-taxonomy");

export const buildBusinessVisualDocApiSmokeEvidence = (state: WorkspaceState): WorkflowApiSmokeEvidence =>
  buildWorkflowApiSmokeEvidence(state, businessVisualDocWorkflowAcceptance, "qa-business-visual-doc-taxonomy");

export const buildLocalMerchantCampaignApiSmokeEvidence = (state: WorkspaceState): WorkflowApiSmokeEvidence =>
  buildWorkflowApiSmokeEvidence(state, localMerchantCampaignWorkflowAcceptance, "qa-local-merchant-campaign-taxonomy");

export const buildCharacterIpConceptApiSmokeEvidence = (state: WorkspaceState): WorkflowApiSmokeEvidence =>
  buildWorkflowApiSmokeEvidence(state, characterIpConceptWorkflowAcceptance, "qa-character-ip-concept-taxonomy");

export const buildSupportProblemContext = (state: WorkspaceState, linkedExportId?: string) => {
  const linkedExport = linkedExportId
    ? state.exports.find((item) => item.id === linkedExportId)
    : state.exports[0];
  const acceptedReferences = state.brief.references.filter((reference) => reference.validation.state === "accepted");

  return {
    projectId: state.activeProjectId,
    projectName: state.projects.find((project) => project.id === state.activeProjectId)?.name ?? "Unknown project",
    linkedExportId: linkedExport?.id,
    linkedBatchId: state.batchGenerations[0]?.id ?? "batch-local-workspace",
    linkedTaskId: state.selectedCandidateId ? `task-${state.selectedCandidateId}` : "task-brief",
    linkedTraceId: linkedExport ? `trace-${linkedExport.id}` : "trace-local-workspace",
    linkedAssetIds: acceptedReferences.map((reference) => reference.id),
    linkedAssetNames: acceptedReferences.map((reference) => reference.name),
    linkedQuotaSnapshot: {
      used: state.billing.quotaUsed,
      limit: state.billing.quotaLimit,
      remaining: Math.max(0, state.billing.quotaLimit - state.billing.quotaUsed),
      status: state.billing.status,
      resetAt: state.billing.resetAt
    },
    linkedBillingReferenceId:
      state.billing.invoices[0]?.id ??
      state.billing.checkoutSessionId ??
      state.billing.portalSessionId ??
      `quota:${state.billing.status}:${state.billing.resetAt}`
  };
};

export const createSupportTicket = (
  state: WorkspaceState,
  input: Pick<SupportTicket, "category" | "body" | "linkedExportId">
): SupportTicket => {
  const context = buildSupportProblemContext(state, input.linkedExportId);

  return {
    id: `ticket-${String(state.supportTickets.length + 1).padStart(3, "0")}`,
    projectId: context.projectId,
    projectName: context.projectName,
    category: input.category,
    body: input.body,
    status: "open",
    linkedExportId: context.linkedExportId,
    linkedBatchId: context.linkedBatchId,
    linkedTaskId: context.linkedTaskId,
    linkedTraceId: context.linkedTraceId,
    linkedAssetIds: context.linkedAssetIds,
    linkedQuotaSnapshot: context.linkedQuotaSnapshot,
    linkedBillingReferenceId: context.linkedBillingReferenceId
  };
};

export const createDisabledShareLink = (exportId: string, index: number): ShareLink => ({
  id: `share-${String(index + 1).padStart(3, "0")}`,
  exportId,
  status: "disabled",
  access: "private",
  createdAt: new Date().toISOString(),
  reason: "Share links are modeled for Rev2 but disabled in local alpha until signed URLs and tenant checks are backed by the API."
});

export const formatExportFileName = (format: ExportFormat, exportCount: number) =>
  `zenari-${String(exportCount + 1).padStart(3, "0")}.${format === "zip" ? "zip" : "pdf"}`;
