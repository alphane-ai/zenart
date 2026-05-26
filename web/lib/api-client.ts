"use client";

import {
  AccountSettings,
  ExportFormat,
  PackageItem,
  WorkspaceState,
  ZenArtClient
} from "./contracts";
import {
  buildManifest,
  createDisabledShareLink,
  createInitialWorkspace,
  createReferenceAsset,
  createSupportTicket,
  evaluatePackageQa,
  formatExportFileName
} from "./dev-state";

export const workspaceStorageKey = "zenart.dev.workspace.v1";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const saveState = (state: WorkspaceState) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(state));
  }
  return clone(state);
};

const loadState = (): WorkspaceState => {
  if (typeof window === "undefined") {
    return createInitialWorkspace();
  }

  const stored = window.localStorage.getItem(workspaceStorageKey);
  if (!stored) {
    return saveState(createInitialWorkspace());
  }

  try {
    return migrateState(JSON.parse(stored) as WorkspaceState);
  } catch {
    return saveState(createInitialWorkspace());
  }
};

const withQuota = (state: WorkspaceState, amount: number): WorkspaceState => ({
  ...state,
  billing: {
    ...state.billing,
    quotaUsed: Math.min(state.billing.quotaLimit, state.billing.quotaUsed + amount)
  }
});

const migrateState = (state: WorkspaceState): WorkspaceState => ({
  ...state,
  shareLinks: state.shareLinks ?? []
});

export class DevZenArtClient implements ZenArtClient {
  resetWorkspace() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(workspaceStorageKey);
    }
  }

  async loadWorkspace() {
    return clone(migrateState(loadState()));
  }

  async confirmBrief(prompt: string) {
    const state = loadState();
    const next = withQuota(
      {
        ...state,
        brief: {
          ...state.brief,
          prompt,
          confirmed: true,
          missingInfo: []
        },
        chat: [
          ...state.chat,
          {
            id: `msg-${String(state.chat.length + 1).padStart(3, "0")}`,
            role: "user",
            body: prompt,
            createdAt: new Date().toISOString()
          },
          {
            id: `msg-${String(state.chat.length + 2).padStart(3, "0")}`,
            role: "assistant",
            body: "Brief confirmed. I generated four deterministic strategy candidates for review.",
            createdAt: new Date().toISOString()
          }
        ]
      },
      1
    );
    return saveState(next);
  }

  async attachReference(asset: { name: string; kind: "image" | "document" | "url" }) {
    const state = loadState();
    return saveState({
      ...state,
      brief: {
        ...state.brief,
        references: [...state.brief.references, createReferenceAsset(asset.name, asset.kind)]
      }
    });
  }

  async selectCandidate(candidateId: string) {
    const state = loadState();
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      return clone(state);
    }

    const nodeId = `node-${candidate.id}`;
    const next = withQuota(
      {
        ...state,
        selectedCandidateId: candidateId,
        canvas: {
          ...state.canvas,
          nodes: [
            ...state.canvas.nodes.filter((node) => node.id !== nodeId),
            {
              id: nodeId,
              title: candidate.title,
              kind: "candidate",
              x: 360,
              y: 180,
              body: `${candidate.strategy} ${candidate.rationale}`
            }
          ],
          edges: [...state.canvas.edges.filter((edge) => edge.to !== nodeId), { from: "node-brief", to: nodeId }],
          versions: [
            ...state.canvas.versions,
            {
              id: `version-${String(state.canvas.versions.length + 1).padStart(3, "0")}`,
              label: `Selected ${candidate.title}`,
              createdAt: new Date().toISOString(),
              nodeCount: state.canvas.nodes.length + 1
            }
          ],
          activeVersionId: `version-${String(state.canvas.versions.length + 1).padStart(3, "0")}`,
          autosavedAt: new Date().toISOString()
        }
      },
      2
    );
    return saveState(next);
  }

  async iterateSelected(instruction: string) {
    const state = loadState();
    if (!state.selectedCandidateId || !instruction.trim()) {
      return clone(state);
    }

    const selected = state.candidates.find((item) => item.id === state.selectedCandidateId);
    const nodeId = `node-iteration-${state.canvas.nodes.length + 1}`;
    const next = withQuota(
      {
        ...state,
        chat: [
          ...state.chat,
          {
            id: `msg-${String(state.chat.length + 1).padStart(3, "0")}`,
            role: "user",
            body: instruction,
            createdAt: new Date().toISOString()
          }
        ],
        canvas: {
          ...state.canvas,
          nodes: [
            ...state.canvas.nodes,
            {
              id: nodeId,
              title: "Iteration",
              kind: "iteration",
              x: 650,
              y: 260,
              body: `${selected?.title ?? "Selected direction"} refined with: ${instruction}`
            }
          ],
          edges: [...state.canvas.edges, { from: `node-${state.selectedCandidateId}`, to: nodeId }],
          versions: [
            ...state.canvas.versions,
            {
              id: `version-${String(state.canvas.versions.length + 1).padStart(3, "0")}`,
              label: "Canvas iteration",
              createdAt: new Date().toISOString(),
              nodeCount: state.canvas.nodes.length + 1
            }
          ],
          activeVersionId: `version-${String(state.canvas.versions.length + 1).padStart(3, "0")}`,
          autosavedAt: new Date().toISOString()
        }
      },
      3
    );
    return saveState(next);
  }

  async restoreCanvasVersion(versionId: string) {
    const state = loadState();
    const version = state.canvas.versions.find((item) => item.id === versionId);
    if (!version) {
      return clone(state);
    }

    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        activeVersionId: versionId,
        autosavedAt: new Date().toISOString()
      }
    });
  }

  async addPackageItem(sourceId: string) {
    const state = loadState();
    const candidate = state.candidates.find((item) => item.id === sourceId);
    const node = state.canvas.nodes.find((item) => item.id === sourceId);
    const existing = state.packageItems.some((item) => item.sourceId === sourceId);
    if ((!candidate && !node) || existing) {
      return clone(state);
    }

    const item: PackageItem = {
      id: `pkg-item-${String(state.packageItems.length + 1).padStart(3, "0")}`,
      sourceId,
      title: candidate?.title ?? node?.title ?? "Canvas item",
      type: candidate ? "candidate" : "canvas-frame",
      addedAt: new Date().toISOString()
    };

    return saveState({
      ...state,
      packageItems: [...state.packageItems, item]
    });
  }

  async createExport(format: ExportFormat) {
    const state = migrateState(loadState());
    const qaReport = evaluatePackageQa(state.packageItems);
    const blocked = qaReport.some((item) => item.severity === "block");
    const manifest = buildManifest(state.activeProjectId, state.packageItems);
    const exportRecord = {
      id: `export-${String(state.exports.length + 1).padStart(3, "0")}`,
      format,
      status: blocked ? "blocked" : "ready",
      createdAt: new Date().toISOString(),
      fileName: formatExportFileName(format, state.exports.length),
      manifest,
      qaReport
    } as const;

    return saveState(
      withQuota(
        {
          ...state,
          exports: [exportRecord, ...state.exports]
        },
        blocked ? 0 : 1
      )
    );
  }

  async createShareLink(exportId: string) {
    const state = migrateState(loadState());
    const targetExport = state.exports.find((item) => item.id === exportId);
    if (!targetExport) {
      return clone(state);
    }

    const existing = state.shareLinks.find((item) => item.exportId === exportId);
    if (existing) {
      return clone(state);
    }

    return saveState({
      ...state,
      shareLinks: [...state.shareLinks, createDisabledShareLink(exportId, state.shareLinks.length)]
    });
  }

  async createMockCheckout() {
    const state = migrateState(loadState());
    return saveState({
      ...state,
      billing: {
        ...state.billing,
        status: "active",
        quotaLimit: 80,
        renewalMode: "mock-checkout"
      }
    });
  }

  async updateAccount(settings: AccountSettings) {
    const state = loadState();
    return saveState({
      ...state,
      account: settings
    });
  }

  async reportProblem(input: Pick<Parameters<ZenArtClient["reportProblem"]>[0], "category" | "body" | "linkedExportId">) {
    const state = loadState();
    const ticket = createSupportTicket(state, input);
    return saveState({
      ...state,
      supportTickets: [ticket, ...state.supportTickets]
    });
  }
}

export const zenArtClient = new DevZenArtClient();
