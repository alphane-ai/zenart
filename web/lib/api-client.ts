"use client";

import {
  AccountSettings,
  BillingScenario,
  ExportFormat,
  Candidate,
  PackageItem,
  PackageManifest,
  QaFinding,
  SessionUser,
  WorkspaceState,
  ZenArtClient
} from "./contracts";
import {
  buildManifest,
  buildPptReadyMetadata,
  requiredExportPackageOutputs,
  createDisabledShareLink,
  createInitialWorkspace,
  createReferenceAsset,
  createSessionContract,
  createSupportTicket,
  evaluatePackageQa,
  formatExportFileName,
  runSafetyPolicy,
  businessVisualDocCandidates,
  localMerchantCampaignCandidates
} from "./dev-state";

export const workspaceStorageKey = "zenart.dev.workspace.v1";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const saveState = (state: WorkspaceState) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(state));
  }
  return clone(state);
};

const defaultBilling = createInitialWorkspace().billing;

const migrateManifest = (manifest: PackageManifest, createdAt: string): PackageManifest => {
  const requiredOutputs = new Set([
    ...manifest.required_outputs,
    ...requiredExportPackageOutputs
  ]);

  return {
    ...manifest,
    required_outputs: Array.from(requiredOutputs),
    workflow_acceptance: manifest.workflow_acceptance,
    ppt_ready_metadata:
      manifest.ppt_ready_metadata ??
      buildPptReadyMetadata(
        manifest.items.map((item) => ({
          id: item.id,
          sourceId: item.provenance.replace(/^dev-client:/, ""),
          title: item.title,
          type: item.type,
          addedAt: createdAt
        }))
      )
  };
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

const migrateState = (state: WorkspaceState): WorkspaceState => ({
  ...state,
  sessionContract:
    state.sessionContract ??
    createSessionContract(state.session ?? {
      id: "user-dev-001",
      name: "Dev User",
      email: "dev@zenart.local"
    }),
  brief: {
    ...state.brief,
    references: state.brief.references.map((reference) => ({
      ...reference,
      upload: reference.upload ?? createReferenceAsset(reference.name, reference.kind).upload,
      validation: reference.validation ?? { state: "accepted" }
    }))
  },
  exports: (state.exports ?? []).map((item) => ({
    ...item,
    manifest: migrateManifest(item.manifest, item.createdAt),
    safetyReport: item.safetyReport ?? runSafetyPolicy(state, item.qaReport)
  })),
  shareLinks: state.shareLinks ?? [],
  supportTickets: (state.supportTickets ?? []).map((ticket) => ({
    ...ticket,
    projectName: ticket.projectName ?? state.projects.find((project) => project.id === ticket.projectId)?.name ?? "Unknown project",
    linkedTaskId: ticket.linkedTaskId ?? (state.selectedCandidateId ? `task-${state.selectedCandidateId}` : "task-brief"),
    linkedTraceId: ticket.linkedTraceId ?? (ticket.linkedExportId ? `trace-${ticket.linkedExportId}` : "trace-local-workspace"),
    linkedAssetIds: ticket.linkedAssetIds ?? state.brief.references.map((reference) => reference.id),
    linkedQuotaSnapshot: {
      ...ticket.linkedQuotaSnapshot,
      remaining: ticket.linkedQuotaSnapshot.remaining ?? Math.max(0, ticket.linkedQuotaSnapshot.limit - ticket.linkedQuotaSnapshot.used),
      status: ticket.linkedQuotaSnapshot.status ?? state.billing.status,
      resetAt: ticket.linkedQuotaSnapshot.resetAt ?? state.billing.resetAt
    }
  }))
});

const canSpendQuota = (state: WorkspaceState, amount: number) =>
  state.billing.status !== "inactive" &&
  state.billing.status !== "past_due" &&
  state.billing.quotaUsed + amount <= state.billing.quotaLimit;

const withQuota = (state: WorkspaceState, amount: number): WorkspaceState =>
  amount > 0 && canSpendQuota(state, amount)
    ? {
        ...state,
        billing: {
          ...state.billing,
          quotaUsed: state.billing.quotaUsed + amount
        }
      }
    : state;

export class DevZenArtClient implements ZenArtClient {
  resetWorkspace() {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(workspaceStorageKey);
    }
  }

  async loadWorkspace() {
    return clone(migrateState(loadState()));
  }

  async login(email: string) {
    const state = migrateState(loadState());
    const normalizedEmail = email.trim().toLowerCase() || "dev@zenart.local";
    const user: SessionUser = {
      id: normalizedEmail === "dev@zenart.local" ? "user-dev-001" : `user-${normalizedEmail.replace(/[^a-z0-9]+/g, "-")}`,
      name: normalizedEmail === "dev@zenart.local" ? "Dev User" : normalizedEmail.split("@")[0] || "Local User",
      email: normalizedEmail
    };

    return saveState({
      ...state,
      session: user,
      sessionContract: createSessionContract(user, "authenticated", new Date().toISOString())
    });
  }

  async logout() {
    const state = migrateState(loadState());
    return saveState({
      ...state,
      sessionContract: {
        ...state.sessionContract,
        status: "signed_out"
      }
    });
  }

  async refreshSession() {
    const state = migrateState(loadState());
    if (state.sessionContract.status !== "authenticated") {
      return clone(state);
    }

    return saveState({
      ...state,
      sessionContract: createSessionContract(state.session, "authenticated", new Date().toISOString())
    });
  }

  async expireSession() {
    const state = migrateState(loadState());
    const expiredAt = new Date(Date.now() - 1000).toISOString();

    return saveState({
      ...state,
      sessionContract: {
        ...createSessionContract(state.session, "expired", new Date(Date.now() - 31 * 60 * 1000).toISOString()),
        expiresAt: expiredAt
      }
    });
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

  async activateBusinessVisualDocWorkflow() {
    const state = loadState();
    const existingCandidateIds = new Set(state.candidates.map((candidate) => candidate.id));
    const nextCandidates = [
      ...state.candidates.filter((candidate) => !businessVisualDocCandidates.some((item) => item.id === candidate.id)),
      ...businessVisualDocCandidates.filter((candidate) => !existingCandidateIds.has(candidate.id))
    ] satisfies Candidate[];

    return saveState({
      ...state,
      candidates: nextCandidates
    });
  }

  async activateLocalMerchantCampaignWorkflow() {
    const state = loadState();
    const existingCandidateIds = new Set(state.candidates.map((candidate) => candidate.id));
    const nextCandidates = [
      ...state.candidates.filter((candidate) => !localMerchantCampaignCandidates.some((item) => item.id === candidate.id)),
      ...localMerchantCampaignCandidates.filter((candidate) => !existingCandidateIds.has(candidate.id))
    ] satisfies Candidate[];

    return saveState({
      ...state,
      candidates: nextCandidates
    });
  }

  async createProject(name: string) {
    const state = migrateState(loadState());
    const projectName = name.trim() || `Project ${state.projects.length + 1}`;
    const createdAt = new Date().toISOString();
    const project = {
      id: `project-${String(state.projects.length + 1).padStart(3, "0")}`,
      name: projectName,
      updatedAt: createdAt,
      brief: "New local alpha project ready for brief, references, package, and export.",
      assetCount: 0,
      exportCount: 0
    };

    return saveState({
      ...state,
      projects: [project, ...state.projects],
      activeProjectId: project.id
    });
  }

  async updateProject(projectId: string, name: string) {
    const state = migrateState(loadState());
    const projectName = name.trim();
    if (!projectName) {
      return clone(state);
    }

    return saveState({
      ...state,
      projects: state.projects.map((project) =>
        project.id === projectId
          ? {
              ...project,
              name: projectName,
              updatedAt: new Date().toISOString()
            }
          : project
      )
    });
  }

  async attachReference(asset: { name: string; kind: "image" | "document" | "url" }) {
    const state = loadState();
    const reference = createReferenceAsset(asset.name, asset.kind);
    return saveState({
      ...state,
      brief: {
        ...state.brief,
        references: [...state.brief.references, reference]
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
    const reference = state.brief.references.find((item) => item.id === sourceId && item.validation.state === "accepted");
    const existing = state.packageItems.some((item) => item.sourceId === sourceId);
    if ((!candidate && !node && !reference) || existing) {
      return clone(state);
    }

    const item: PackageItem = {
      id: `pkg-item-${String(state.packageItems.length + 1).padStart(3, "0")}`,
      sourceId,
      title: candidate?.title ?? node?.title ?? reference?.name ?? "Canvas item",
      type: candidate ? "candidate" : reference ? "reference" : "canvas-frame",
      addedAt: new Date().toISOString(),
      workflowId: candidate?.workflowId,
      strategyTaxonomy: candidate?.strategyTaxonomy,
      requiredOutputFiles: candidate?.requiredOutputFiles
    };

    return saveState({
      ...state,
      packageItems: [...state.packageItems, item]
    });
  }

  async createExport(format: ExportFormat) {
    const state = migrateState(loadState());
    const qaReport = evaluatePackageQa(state.packageItems);
    const safetyReport = runSafetyPolicy(state, qaReport);
    const entitlementBlock =
      state.billing.status === "inactive" || state.billing.status === "past_due" || state.billing.quotaUsed >= state.billing.quotaLimit;
    const blocked = entitlementBlock || qaReport.some((item) => item.severity === "block") || safetyReport.status === "block";
    const entitlementFinding: QaFinding = {
      id: "qa-entitlement",
      severity: "block",
      title: state.billing.quotaUsed >= state.billing.quotaLimit ? "Quota exhausted" : "Subscription action required",
      detail:
        state.billing.quotaUsed >= state.billing.quotaLimit
          ? "Export is blocked until quota resets or the local alpha plan is activated."
          : "Export is blocked while the subscription is inactive or past due."
    };
    const manifest = buildManifest(state.activeProjectId, state.packageItems);
    const exportRecord = {
      id: `export-${String(state.exports.length + 1).padStart(3, "0")}`,
      format,
      status: blocked ? "blocked" : "ready",
      createdAt: new Date().toISOString(),
      fileName: formatExportFileName(format, state.exports.length),
      manifest,
      qaReport: entitlementBlock ? [...qaReport, entitlementFinding] : qaReport,
      safetyReport
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
        quotaUsed: Math.min(state.billing.quotaUsed, 80),
        renewalMode: "mock-checkout"
      }
    });
  }

  async setBillingScenario(scenario: BillingScenario) {
    const state = migrateState(loadState());
    const billingByScenario: Record<BillingScenario, WorkspaceState["billing"]> = {
      trialing: {
        ...defaultBilling
      },
      active: {
        ...defaultBilling,
        status: "active",
        quotaLimit: 80,
        renewalMode: "mock-checkout"
      },
      past_due: {
        ...defaultBilling,
        status: "past_due",
        quotaUsed: 24
      },
      inactive: {
        ...defaultBilling,
        status: "inactive",
        quotaUsed: 24
      },
      quota_exhausted: {
        ...defaultBilling,
        status: "active",
        quotaUsed: defaultBilling.quotaLimit
      }
    };

    return saveState({
      ...state,
      billing: billingByScenario[scenario]
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
