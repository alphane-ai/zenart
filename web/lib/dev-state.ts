import {
  Candidate,
  BriefUploadConfirmationRuntimeEvidence,
  ExportFormat,
  ExportRecord,
  PackageExportMetadataEvidence,
  PackageItem,
  PackageManifest,
  PptReadyMetadata,
  QaFinding,
  ReferenceAsset,
  ReferenceUploadIntegrationSmoke,
  SafetyPolicyReport,
  SessionContract,
  SessionUser,
  WorkspaceRenderingPerformanceSmoke,
  ShareLink,
  SupportTicket,
  WorkflowApiSmokeEvidence,
  WorkspaceState
} from "./contracts";
import { defaultSameSiteCsrfContract } from "./request-security";

const now = "2026-05-26T09:00:00.000Z";
const sessionTtlMs = 30 * 60 * 1000;
const sessionRefreshMs = 20 * 60 * 1000;

const devUser: SessionUser = {
  id: "user-dev-001",
  name: "Dev User",
  email: "dev@zenart.local"
};

export const requiredExportPackageOutputs = [
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "provenance.json",
  "ppt-ready-metadata.json",
  "assets/"
] as const;

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
      name: "__Host-zenart_session",
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
    renewalMode: "mock-checkout"
  },
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
        id: "ref-001",
        name: "brand-moodboard.png",
        kind: "image",
        status: "attached",
        validation: {
          state: "accepted"
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
        body: "Campaign direction board with four strategic routes, packageable assets, manifest, and QA."
      }
    ],
    edges: [],
    versions: [
      {
        id: "version-001",
        label: "Initial brief",
        createdAt: now,
        nodeCount: 1
      }
    ],
    activeVersionId: "version-001",
    autosavedAt: now
  },
  packageItems: [],
  exports: [],
  shareLinks: [],
  supportTickets: []
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
  const ecommerceItems = items.filter((item) => item.workflowId === ecommerceGrowthWorkflowAcceptance.workflow_id);
  if (ecommerceItems.length === 0) {
    return undefined;
  }

  return {
    schema_version: ecommerceGrowthWorkflowAcceptance.schema_version,
    workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
    fixture_id: ecommerceGrowthWorkflowAcceptance.fixture_id,
    strategy_taxonomy: Array.from(new Set(ecommerceItems.flatMap((item) => item.strategyTaxonomy ?? []))),
    required_files: Array.from(
      new Set([
        ...ecommerceGrowthWorkflowAcceptance.required_files,
        ...ecommerceItems.flatMap((item) => item.requiredOutputFiles ?? [])
      ])
    ),
    export_target: ecommerceGrowthWorkflowAcceptance.export_target
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
            title: "Package placeholder",
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
    state.packageItems.length;
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

  return {
    schema_version: "stage0.rev2.workspace-rendering-performance",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "local-alpha-canvas",
    interactionSteps,
    nodeCount: state.canvas.nodes.length,
    edgeCount: state.canvas.edges.length,
    versionCount: state.canvas.versions.length,
    renderElementCount,
    estimatedInteractionMs,
    failures,
    budgets
  };
};

export const buildPackageExportMetadataEvidence = (record: ExportRecord): PackageExportMetadataEvidence => {
  const missingRequiredOutputs = requiredExportPackageOutputs.filter(
    (outputName) => !record.manifest.required_outputs.includes(outputName)
  );
  const zipPayloadNames = record.manifest.required_outputs.map((outputName) =>
    outputName === "assets/" ? "assets/README.txt" : outputName
  );
  const provenanceCount = record.manifest.items.filter((item) => item.provenance.trim().length > 0).length;
  const blockingQaCount = record.qaReport.filter((finding) => finding.severity === "block").length;
  const pptSlideCount = record.manifest.ppt_ready_metadata.slides.length;
  const handoffChecklistCount = record.manifest.ppt_ready_metadata.handoff_checklist.length;
  const status =
    record.status === "ready" &&
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
    requiredOutputCount: record.manifest.required_outputs.length,
    missingRequiredOutputs,
    itemCount: record.manifest.items.length,
    provenanceCount,
    qaFindingCount: record.qaReport.length,
    blockingQaCount,
    pptSlideCount,
    handoffChecklistCount,
    zipPayloadNames
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

  return {
    id: `ref-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: trimmed,
    kind,
    status: validation.state === "accepted" ? "attached" : "queued",
    validation
  };
};

export const buildReferenceUploadIntegrationSmoke = (state: WorkspaceState): ReferenceUploadIntegrationSmoke => {
  const acceptedReferences = state.brief.references.filter((reference) => reference.validation.state === "accepted");
  const packagedReferenceIds = new Set(
    state.packageItems.filter((item) => item.type === "reference").map((item) => item.sourceId)
  );
  const latestReadyExport = state.exports.find((record) => record.status === "ready");
  const referenceProvenanceCount =
    latestReadyExport?.manifest.items.filter((item) => item.provenance.startsWith("dev-client-reference:")).length ?? 0;
  const pptAssetGridSlideCount =
    latestReadyExport?.manifest.ppt_ready_metadata.slides.filter((slide) => slide.layout === "asset-grid").length ?? 0;
  const failures: ReferenceUploadIntegrationSmoke["failures"] = [];

  if (acceptedReferences.length === 0) {
    failures.push("accepted-reference");
  }
  if (packagedReferenceIds.size === 0) {
    failures.push("packaged-reference");
  }
  if (!latestReadyExport) {
    failures.push("ready-export");
  }
  if (latestReadyExport && referenceProvenanceCount < packagedReferenceIds.size) {
    failures.push("manifest-provenance");
  }
  if (latestReadyExport && pptAssetGridSlideCount < packagedReferenceIds.size) {
    failures.push("ppt-asset-grid");
  }

  return {
    schema_version: "stage0.rev2.reference-upload-integration-smoke",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "reference-upload-to-ready-zip-export",
    acceptedCount: acceptedReferences.length,
    acceptedKinds: Array.from(new Set(acceptedReferences.map((reference) => reference.kind))),
    rejectedCount: state.brief.references.filter((reference) => reference.validation.state === "rejected").length,
    packagedReferenceCount: packagedReferenceIds.size,
    packageHistoryReferenceCount: state.packageItems.filter((item) => item.type === "reference").length,
    readyExportCount: state.exports.filter((record) => record.status === "ready").length,
    provenanceCount: referenceProvenanceCount,
    pptAssetGridSlideCount,
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
    gateImpact: "user-web-evidence-only",
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

export const buildEcommerceGrowthApiSmokeEvidence = (state: WorkspaceState): WorkflowApiSmokeEvidence => {
  const candidateTaxonomies = state.candidates
    .filter((candidate) => candidate.workflowId === ecommerceGrowthWorkflowAcceptance.workflow_id)
    .map((candidate) => candidate.strategyTaxonomy)
    .filter((taxonomy): taxonomy is string => Boolean(taxonomy));
  const packagedTaxonomies = state.packageItems
    .filter((item) => item.workflowId === ecommerceGrowthWorkflowAcceptance.workflow_id)
    .map((item) => item.strategyTaxonomy)
    .filter((taxonomy): taxonomy is string => Boolean(taxonomy));
  const latestReadyZip = state.exports.find((record) => record.format === "zip" && record.status === "ready");
  const requiredOutputNames = new Set([
    ...ecommerceGrowthWorkflowAcceptance.required_files,
    ...requiredExportPackageOutputs
  ]);
  const missingRequiredOutputs = latestReadyZip
    ? Array.from(requiredOutputNames).filter((outputName) => !latestReadyZip.manifest.required_outputs.includes(outputName))
    : Array.from(requiredOutputNames);
  const qaTaxonomyFinding = latestReadyZip?.qaReport.find((finding) => finding.id === "qa-ecommerce-growth-taxonomy");
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
    ecommerceGrowthWorkflowAcceptance.strategy_taxonomy.some((taxonomy) => !candidateTaxonomies.includes(taxonomy))
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
    ecommerceGrowthWorkflowAcceptance.strategy_taxonomy.some((taxonomy) => !packagedTaxonomies.includes(taxonomy))
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

  return {
    schema_version: ecommerceGrowthWorkflowAcceptance.schema_version,
    workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
    fixture_id: ecommerceGrowthWorkflowAcceptance.fixture_id,
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "brief-reference-four-candidates-select-iterate-package-export-zip",
    apiOperationIds: [...ecommerceGrowthApiSmokeOperationIds],
    candidateCount: candidateTaxonomies.length,
    taxonomyCount: new Set(candidateTaxonomies).size,
    packagedTaxonomyCount: new Set(packagedTaxonomies).size,
    readyZipExportCount: state.exports.filter((record) => record.format === "zip" && record.status === "ready").length,
    requiredOutputCount: requiredOutputNames.size,
    missingRequiredOutputs,
    qaTaxonomyStatus: qaTaxonomyFinding?.severity === "pass" ? "pass" : qaTaxonomyFinding?.severity === "warn" ? "warn" : "missing",
    safetyStatus: latestReadyZip?.safetyReport.status ?? "missing",
    failures
  };
};

export const buildSupportProblemContext = (state: WorkspaceState, linkedExportId?: string) => {
  const linkedExport = linkedExportId
    ? state.exports.find((item) => item.id === linkedExportId)
    : state.exports[0];
  const acceptedReferences = state.brief.references.filter((reference) => reference.validation.state === "accepted");

  return {
    projectId: state.activeProjectId,
    projectName: state.projects.find((project) => project.id === state.activeProjectId)?.name ?? "Unknown project",
    linkedExportId: linkedExport?.id,
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
    }
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
    linkedTaskId: context.linkedTaskId,
    linkedTraceId: context.linkedTraceId,
    linkedAssetIds: context.linkedAssetIds,
    linkedQuotaSnapshot: context.linkedQuotaSnapshot
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
  `zenart-${String(exportCount + 1).padStart(3, "0")}.${format === "zip" ? "zip" : "pdf"}`;
