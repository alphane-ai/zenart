import {
  Candidate,
  ExportFormat,
  ExportRecord,
  PackageExportMetadataEvidence,
  PackageItem,
  PackageManifest,
  PptReadyMetadata,
  QaFinding,
  ReferenceAsset,
  SessionContract,
  SessionUser,
  WorkspaceRenderingPerformanceSmoke,
  ShareLink,
  SupportTicket,
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
  "provenance.json",
  "ppt-ready-metadata.json",
  "assets/"
] as const;

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
    strategy: "Magazine layout with strong hierarchy and concise copy blocks.",
    palette: ["#111827", "#f4f1ea", "#2f855a", "#d97706"],
    rationale: "Best when the output needs to feel curated and explain a story quickly.",
    assetPrompt: "Create a polished editorial direction board for a launch campaign."
  },
  {
    id: "cand-studio",
    title: "Studio System",
    strategy: "Reusable product tiles, neutral surfaces, and crisp asset annotations.",
    palette: ["#0f172a", "#e5e7eb", "#2563eb", "#dc2626"],
    rationale: "Best when repeatable production assets and handoff clarity matter.",
    assetPrompt: "Create a modular studio direction with componentized visual rules."
  },
  {
    id: "cand-gallery",
    title: "Gallery Motion",
    strategy: "Large art-led panels, cinematic crops, and transition notes.",
    palette: ["#18181b", "#fafafa", "#7c3aed", "#14b8a6"],
    rationale: "Best for expressive brand systems that need memorable visual impact.",
    assetPrompt: "Create a gallery-like direction with motion-ready composition cues."
  },
  {
    id: "cand-utility",
    title: "Utility Kit",
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
): PackageManifest => ({
  package_id: `pkg-${String(items.length || 1).padStart(3, "0")}`,
  project_id: projectId,
  created_at: new Date().toISOString(),
  required_outputs: [...requiredExportPackageOutputs],
  ppt_ready_metadata: buildPptReadyMetadata(items),
  items: items.map((item) => ({
    id: item.id,
    title: item.title,
    type: item.type,
    provenance: item.type === "reference" ? `dev-client-reference:${item.sourceId}` : `dev-client:${item.sourceId}`
  }))
});

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
  return [
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
  const zipPayloadNames = requiredExportPackageOutputs.map((outputName) =>
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
