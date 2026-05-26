import {
  Candidate,
  ExportFormat,
  PackageItem,
  PackageManifest,
  QaFinding,
  ReferenceAsset,
  ShareLink,
  SupportTicket,
  WorkspaceState
} from "./contracts";

const now = "2026-05-26T09:00:00.000Z";

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
  session: {
    id: "user-dev-001",
    name: "Dev User",
    email: "dev@zenart.local"
  },
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
        status: "attached"
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
  required_outputs: ["manifest.json", "qa-report.json", "provenance.json", "assets/"],
  items: items.map((item) => ({
    id: item.id,
    title: item.title,
    type: item.type,
    provenance: `dev-client:${item.sourceId}`
  }))
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

export const createReferenceAsset = (name: string, kind: ReferenceAsset["kind"]): ReferenceAsset => ({
  id: `ref-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name,
  kind,
  status: "attached"
});

export const createSupportTicket = (
  state: WorkspaceState,
  input: Pick<SupportTicket, "category" | "body" | "linkedExportId">
): SupportTicket => ({
  id: `ticket-${String(state.supportTickets.length + 1).padStart(3, "0")}`,
  projectId: state.activeProjectId,
  category: input.category,
  body: input.body,
  status: "open",
  linkedExportId: input.linkedExportId,
  linkedQuotaSnapshot: {
    used: state.billing.quotaUsed,
    limit: state.billing.quotaLimit
  }
});

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
