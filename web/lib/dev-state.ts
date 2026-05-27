import {
  Candidate,
  BriefUploadConfirmationRuntimeEvidence,
  ExportDownloadParityEvidence,
  ExportZipPayloadSmokeEvidence,
  ExportFormat,
  ExportRecord,
  PackageExportMetadataEvidence,
  PackageItem,
  PackageManifest,
  PptReadyMetadata,
  QaFinding,
  ReferenceAsset,
  ReferenceUploadIntegrationSmoke,
  ReferenceUploadValidationMatrixEvidence,
  SafetyPolicyReport,
  SessionContract,
  SessionUser,
  WorkspaceRenderingPerformanceSmoke,
  ShareLink,
  SupportTicket,
  WorkflowApiSmokeEvidence,
  WorkspaceState
} from "./contracts";
import { ApiOperation, apiOperations } from "./generated/zenart-api";
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
  "ai-content-disclaimer.json",
  "ppt-ready-metadata.json",
  "assets/"
] as const;

export const requiredExportZipPayloadNames = requiredExportPackageOutputs.map((outputName) =>
  outputName === "assets/" ? "assets/README.txt" : outputName
);

export const toExportZipPayloadName = (outputName: string) =>
  outputName === "assets/" ? "assets/README.txt" : outputName;

export const buildDownloadableExportZipPayloadNames = (record: ExportRecord) =>
  Array.from(
    new Set([
      ...requiredExportZipPayloadNames,
      ...record.manifest.required_outputs
        .filter((outputName) => !outputName.endsWith("/"))
        .map(toExportZipPayloadName)
    ])
  );

export const buildExportWorkflowMetadataPayload = (record: ExportRecord, outputName: string) => ({
  export_id: record.id,
  output_name: outputName,
  generated_by: "zenart-web-dev-client",
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
  generated_by: "zenart-web-dev-client",
  generation_mode: "deterministic-local-alpha",
  applies_to: "export-package",
  responsibility_notice:
    "Local alpha previews use deterministic generation evidence unless a real provider is explicitly configured. Review rights, claims, likeness, and brand usage before sharing exported assets.",
  policy_routes: ["/legal/terms", "/legal/acceptable-use", "/legal/ip-complaints"],
  safety_status: record.safetyReport.status
});

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
  const zipPayloadNames = buildDownloadableExportZipPayloadNames(record);
  const workflowMetadataPayload = buildExportWorkflowMetadataPayload(record, "metadata.json");
  const requiredZipPayloadNames = [...requiredExportZipPayloadNames];
  const missingZipPayloadNames = requiredZipPayloadNames.filter((payloadName) => !zipPayloadNames.includes(payloadName));
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
  const workflowPayloadStatuses = record.manifest.workflow_acceptance?.required_files.map((payloadName) => ({
    name: payloadName,
    present: zipPayloadNames.includes(payloadName)
  })) ?? [];
  const workflowZipPayloadCount = record.manifest.workflow_acceptance?.required_files.filter((payloadName) =>
    zipPayloadNames.includes(payloadName)
  ).length ?? 0;
  const workflowMetadataPayloadPresent = zipPayloadNames.includes("metadata.json");
  const workflowTraceProvenancePayloadPresent = zipPayloadNames.includes("trace_provenance.json");
  const aiContentDisclaimerPayloadPresent = zipPayloadNames.includes("ai-content-disclaimer.json");
  const workflowProviderMetadataPresent = workflowMetadataPayloadPresent && Boolean(record.manifest.workflow_acceptance?.workflow_id);
  const workflowPromptSpecMetadataPresent =
    workflowMetadataPayloadPresent && (record.manifest.workflow_acceptance?.strategy_taxonomy.length ?? 0) > 0;
  const workflowSkillMetadataPresent =
    workflowMetadataPayloadPresent && record.manifest.workflow_acceptance?.fixture_id === ecommerceGrowthWorkflowAcceptance.fixture_id;
  const workflowSafetyMetadataPresent =
    workflowTraceProvenancePayloadPresent &&
    record.safetyReport.enforcementStages.every((stage) => safetyPolicyEnforcementStages.includes(stage));
  const provenanceCount = record.manifest.items.filter((item) => item.provenance.trim().length > 0).length;
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
    zipPayloadNames.includes("assets/README.txt")
      ? "pass"
      : "fail";
  const status =
    record.status === "ready" &&
    downloadArtifactStatus === "pass" &&
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
    requiredZipPayloadNames,
    requiredZipPayloadCount: requiredZipPayloadNames.length,
    requiredZipPayloadStatuses,
    zipPayloadParityStatus: missingZipPayloadNames.length === 0 ? "pass" : "fail",
    zipPayloadParityRatio: `${requiredZipPayloadNames.length - missingZipPayloadNames.length}/${requiredZipPayloadNames.length}`,
    missingZipPayloadNames,
    workflowId: record.manifest.workflow_acceptance?.workflow_id ?? "generic-stage0-export",
    workflowFixtureId: record.manifest.workflow_acceptance?.fixture_id ?? "none",
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
  const requiredBaselinePayloadNames = [...requiredExportZipPayloadNames];
  const missingPayloadNames = manifestPayloadNames.filter((payloadName) => !expectedPayloadNames.includes(payloadName));
  const missingBaselinePayloadNames = requiredBaselinePayloadNames.filter(
    (payloadName) => !expectedPayloadNames.includes(payloadName)
  );
  const workflowPayloadNames = record.manifest.workflow_acceptance?.required_files.filter((payloadName) =>
    expectedPayloadNames.includes(payloadName)
  ) ?? [];
  const metadataPayloadPresent = expectedPayloadNames.includes("metadata.json");
  const traceProvenancePayloadPresent = expectedPayloadNames.includes("trace_provenance.json");
  const aiContentDisclaimerPayloadPresent = expectedPayloadNames.includes("ai-content-disclaimer.json");
  const assetsPayloadPresent = expectedPayloadNames.includes("assets/README.txt");
  const failures: ExportZipPayloadSmokeEvidence["failures"] = [];

  if (missingBaselinePayloadNames.length > 0) {
    failures.push("baseline-payloads");
  }
  if (missingPayloadNames.length > 0) {
    failures.push("manifest-required-payloads");
  }
  if (record.manifest.workflow_acceptance && !metadataPayloadPresent) {
    failures.push("workflow-metadata");
  }
  if (record.manifest.workflow_acceptance && !traceProvenancePayloadPresent) {
    failures.push("trace-provenance");
  }
  if (!assetsPayloadPresent) {
    failures.push("assets-readme");
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
    missingPayloadNames: [...missingBaselinePayloadNames, ...missingPayloadNames],
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
  const failures: ExportDownloadParityEvidence["failures"] = [];

  if (metadataEvidence.exportId !== zipPayloadSmoke.exportId || metadataEvidence.exportId !== record.id) {
    failures.push("export-id");
  }
  if (metadataEvidence.packageId !== zipPayloadSmoke.packageId || metadataEvidence.packageId !== record.manifest.package_id) {
    failures.push("package-id");
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
    workflowMetadataPresent: metadataEvidence.workflowMetadataPayloadPresent && zipPayloadSmoke.metadataPayloadPresent,
    traceProvenancePresent: metadataEvidence.workflowTraceProvenancePayloadPresent && zipPayloadSmoke.traceProvenancePayloadPresent,
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

  return {
    id: `ref-${trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: trimmed,
    kind,
    status: validation.state === "accepted" ? "attached" : "queued",
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
  if (acceptedSamples.length !== 3 || expectedAcceptedKinds.some((kind) => !acceptedKinds.includes(kind))) {
    failures.push("unexpected-rejection");
  }

  return {
    schema_version: "stage0.rev2.reference-upload-validation-matrix",
    status: failures.length === 0 ? "pass" : "fail",
    scenario: "safe-image-document-https-url-reject-unsupported",
    acceptedKinds,
    acceptedSampleNames: acceptedSamples.map((asset) => asset.name),
    rejectedSampleNames: rejectedSamples.map((asset) => asset.name),
    expectedAcceptedKinds,
    expectedRejectedCount: 2,
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
  const latestAcceptedReference = acceptedReferences.at(-1);
  const packagedReferenceIds = new Set(
    state.packageItems.filter((item) => item.type === "reference").map((item) => item.sourceId)
  );
  const latestReadyExport = state.exports.find((record) => record.status === "ready");
  const referenceProvenanceCount =
    latestReadyExport?.manifest.items.filter((item) => item.provenance.startsWith("dev-client-reference:")).length ?? 0;
  const pptAssetGridSlideCount =
    latestReadyExport?.manifest.ppt_ready_metadata.slides.filter((slide) => slide.layout === "asset-grid").length ?? 0;
  const latestAcceptedReferencePackaged = latestAcceptedReference ? packagedReferenceIds.has(latestAcceptedReference.id) : false;
  const latestAcceptedReferenceProvenancePresent = latestAcceptedReference
    ? latestReadyExport?.manifest.items.some((item) => item.provenance === `dev-client-reference:${latestAcceptedReference.id}`) ?? false
    : false;
  const latestAcceptedReferencePptSlidePresent = latestAcceptedReference
    ? latestReadyExport?.manifest.ppt_ready_metadata.slides.some((slide) => {
        const sourceItem = state.packageItems.find((item) => item.id === slide.source_item_id);
        return slide.layout === "asset-grid" && sourceItem?.sourceId === latestAcceptedReference.id;
      }) ?? false
    : false;
  const failures: ReferenceUploadIntegrationSmoke["failures"] = [];

  if (acceptedReferences.length === 0) {
    failures.push("accepted-reference");
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
  if (latestReadyExport && !latestAcceptedReferenceProvenancePresent) {
    failures.push("latest-reference-provenance");
  }
  if (latestReadyExport && pptAssetGridSlideCount < packagedReferenceIds.size) {
    failures.push("ppt-asset-grid");
  }
  if (latestReadyExport && !latestAcceptedReferencePptSlidePresent) {
    failures.push("latest-reference-ppt-slide");
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
    latestAcceptedReferencePackaged,
    latestAcceptedReferenceProvenancePresent,
    latestAcceptedReferencePptSlidePresent,
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

export const buildEcommerceGrowthApiSmokeEvidence = (state: WorkspaceState): WorkflowApiSmokeEvidence => {
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
  if (
    apiOperationContracts.length !== ecommerceGrowthApiSmokeOperationIds.length ||
    apiOperationContracts.some((contract) => contract.credentialMode !== "include") ||
    apiOperationContracts.some((contract) => contract.csrfProtected && contract.csrfHeaderName !== "X-ZenArt-CSRF")
  ) {
    failures.push("operation-contract");
  }

  return {
    schema_version: ecommerceGrowthWorkflowAcceptance.schema_version,
    workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
    fixture_id: ecommerceGrowthWorkflowAcceptance.fixture_id,
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
