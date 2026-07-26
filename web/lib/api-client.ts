"use client";

import {
  AccountSettings,
  BatchGeneration,
  BatchGenerationChild,
  BatchGenerationChildStatus,
  BatchGenerationStatus,
  BillingScenario,
  CanvasTool,
  EditMaskState,
  EditToolType,
  EditToolRevision,
  ExportFormat,
  AssetLibraryItem,
  BrandKitItem,
  Candidate,
  PackageItem,
  PackageManifest,
  PromptComposerPayload,
  QaFinding,
  SessionUser,
  WorkspaceState,
  ZenariClient
} from "./contracts";
import {
  BatchClient,
  BatchGenerationRequest,
  BatchProgress,
  ChildTaskStatus,
  GenerationChildTask,
  createBatchClient
} from "./batch-client";
import {
  buildManifest,
  buildPptReadyMetadata,
  requiredExportPackageOutputs,
  createCanvasVersionSnapshot,
  defaultCanvasInteraction,
  createDisabledShareLink,
  createInitialWorkspace,
  defaultAssetLibraryState,
  defaultEditToolState,
  defaultTeamSeatState,
  createReferenceAsset,
  createSessionContract,
  createSupportTicket,
  evaluatePackageQa,
  formatExportFileName,
  runSafetyPolicy,
  businessVisualDocCandidates,
  characterIpConceptCandidates,
  localMerchantCampaignCandidates
} from "./dev-state";
import { BillingClient, BillingPortalSession, CheckoutSession, SubscriptionCancellation, createBillingClient, defaultCheckoutPlanId } from "./billing-client";
import {
  AssetLibraryClient,
  AssetLibraryEntryCreateRequest,
  AssetLibraryEntryResponse,
  BrandKitWriteRequest,
  BrandKitResponse,
  createAssetLibraryClient
} from "./asset-library-client";
import { buildPromptComposerPayload } from "./prompt-context";
import { applyBatchResultPlacement } from "./result-placement";

export const workspaceStorageKey = "zenari.dev.workspace.v1";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const assetLibraryOperations: WorkspaceState["assetLibrary"]["operations"] = [
  "listAssetLibrary",
  "createAssetLibraryEntry",
  "updateAssetLibraryEntry",
  "listBrandKits",
  "createBrandKit",
  "updateBrandKit",
  "getProjectDefaultBrandKit",
  "setProjectDefaultBrandKit"
];

const saveState = (state: WorkspaceState) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(state));
  }
  return clone(state);
};

const defaultBilling = createInitialWorkspace().billing;
const defaultTeamSeats = createInitialWorkspace().teamSeats;
const defaultAssetLibrary = createInitialWorkspace().assetLibrary;
const defaultEditTools = createInitialWorkspace().editTools;

const migrateCanvasNode = (node: WorkspaceState["canvas"]["nodes"][number], index: number) => ({
  ...node,
  width: node.width ?? 230,
  height: node.height ?? 118,
  zIndex: node.zIndex ?? index + 1,
  locked: node.locked ?? false,
  hidden: node.hidden ?? false
});

const cloneCanvasNodes = (nodes: WorkspaceState["canvas"]["nodes"]) => nodes.map((node, index) => migrateCanvasNode({ ...node }, index));

const cloneCanvasEdges = (edges: WorkspaceState["canvas"]["edges"]) => edges.map((edge) => ({ ...edge }));

const canvasNodeEqual = (left: WorkspaceState["canvas"]["nodes"][number], right: WorkspaceState["canvas"]["nodes"][number]) =>
  JSON.stringify(left) === JSON.stringify(right);

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
    } else if (canvasNodeEqual(previous, node)) {
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

const migrateCanvasVersions = (state: WorkspaceState) => {
  const currentNodes = cloneCanvasNodes(state.canvas.nodes);
  const currentEdges = cloneCanvasEdges(state.canvas.edges);
  return state.canvas.versions.map((version, index, versions) => {
    const snapshotNodes = cloneCanvasNodes(version.snapshot?.nodes ?? currentNodes);
    const snapshotEdges = cloneCanvasEdges(version.snapshot?.edges ?? currentEdges);
    const previousSnapshotNodes = index > 0 ? cloneCanvasNodes(versions[index - 1]?.snapshot?.nodes ?? currentNodes) : [];
    const nodeIds = snapshotNodes.map((node) => node.id).sort();
    return {
      ...version,
      versionNumber: version.versionNumber ?? index + 1,
      snapshot: {
        nodes: snapshotNodes,
        edges: snapshotEdges
      },
      diff: version.diff ?? buildCanvasVersionDiff(previousSnapshotNodes, snapshotNodes),
      restorePreview: version.restorePreview ?? {
        restoresNodeIds: nodeIds,
        preservesNodeIds: [],
        conflictNodeIds: []
      }
    };
  });
};

const migrateCanvasInteraction = (state: WorkspaceState) => ({
  ...defaultCanvasInteraction,
  ...state.canvas?.interaction,
  selectedNodeIds:
    state.canvas?.interaction?.selectedNodeIds?.filter((nodeId) => state.canvas.nodes.some((node) => node.id === nodeId)) ??
    defaultCanvasInteraction.selectedNodeIds,
  pan: {
    ...defaultCanvasInteraction.pan,
    ...state.canvas?.interaction?.pan
  },
  keyboardShortcuts: [...defaultCanvasInteraction.keyboardShortcuts],
  toolbarTools: [...defaultCanvasInteraction.toolbarTools],
  layersPanelEnabled: true
});

const clampCanvasZoom = (zoom: number) => Math.min(2, Math.max(0.25, Number.isFinite(zoom) ? zoom : 1));

const clampMaskCoverage = (coveragePct: number) => Math.min(1, Math.max(0.01, Number.isFinite(coveragePct) ? coveragePct : 0.18));

const migrateEditTools = (state: WorkspaceState) => ({
  ...defaultEditTools,
  ...(state.editTools ?? {}),
  availableTools: state.editTools?.availableTools ?? defaultEditTools.availableTools,
  activeTool: state.editTools?.activeTool ?? defaultEditTools.activeTool,
  mask: {
    ...defaultEditTools.mask,
    ...(state.editTools?.mask ?? {}),
    width: state.editTools?.mask?.width ?? state.editTools?.sourceWidth ?? defaultEditTools.sourceWidth,
    height: state.editTools?.mask?.height ?? state.editTools?.sourceHeight ?? defaultEditTools.sourceHeight,
    coveragePct: clampMaskCoverage(state.editTools?.mask?.coveragePct ?? defaultEditTools.mask.coveragePct)
  },
  revisions: state.editTools?.revisions ?? [],
  syncStatus: state.editTools?.syncStatus ?? "local"
});

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
      email: "dev@zenari.ai"
    }),
  brief: {
    ...state.brief,
    references: state.brief.references.map((reference) => ({
      ...reference,
      upload: reference.upload ?? createReferenceAsset(reference.name, reference.kind).upload,
      validation: reference.validation ?? { state: "accepted" }
    }))
  },
  canvas: {
    ...state.canvas,
    nodes: state.canvas.nodes.map(migrateCanvasNode),
    versions: migrateCanvasVersions(state),
    interaction: migrateCanvasInteraction(state)
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
    linkedBatchId: ticket.linkedBatchId ?? state.batchGenerations[0]?.id ?? "batch-local-workspace",
    linkedTaskId: ticket.linkedTaskId ?? (state.selectedCandidateId ? `task-${state.selectedCandidateId}` : "task-brief"),
    linkedTraceId: ticket.linkedTraceId ?? (ticket.linkedExportId ? `trace-${ticket.linkedExportId}` : "trace-local-workspace"),
    linkedAssetIds: ticket.linkedAssetIds ?? state.brief.references.map((reference) => reference.id),
    linkedQuotaSnapshot: {
      ...ticket.linkedQuotaSnapshot,
      remaining: ticket.linkedQuotaSnapshot.remaining ?? Math.max(0, ticket.linkedQuotaSnapshot.limit - ticket.linkedQuotaSnapshot.used),
      status: ticket.linkedQuotaSnapshot.status ?? state.billing.status,
      resetAt: ticket.linkedQuotaSnapshot.resetAt ?? state.billing.resetAt
    },
    linkedBillingReferenceId:
      ticket.linkedBillingReferenceId ??
      state.billing.invoices[0]?.id ??
      state.billing.checkoutSessionId ??
      state.billing.portalSessionId ??
      `quota:${state.billing.status}:${state.billing.resetAt}`
  })),
  batchGenerations: (state.batchGenerations ?? []).map((batch) => ({
    ...batch,
    status: normalizeBatchStatus(batch.status),
    promptContext: batch.promptContext ?? {
      text: batch.prompt,
      selected_object_ids: state.canvas.interaction.selectedNodeIds.filter((nodeId) => state.canvas.nodes.some((node) => node.id === nodeId)),
      reference_asset_ids: state.brief.references.filter((reference) => reference.validation.state === "accepted").map((reference) => reference.id),
      brand_kit_id: state.assetLibrary?.defaultBrandKit?.id ?? state.assetLibrary?.brandKits?.find((kit) => kit.status === "active")?.id,
      model_hints: batch.modelId ? [batch.modelId] : [],
      tool_hint: "image.generate"
    },
    blockedCount: batch.blockedCount ?? batch.children.filter((child) => child.status === "blocked").length,
    retryableCount: batch.retryableCount ?? countRetryableChildren(batch.children),
    progressSyncStatus: batch.progressSyncStatus ?? "local",
    progressSyncedAt: batch.progressSyncedAt
  })),
  billing: {
    ...state.billing,
    invoices: state.billing.invoices ?? defaultBilling.invoices,
    invoiceSyncStatus: state.billing.invoiceSyncStatus ?? "local",
    invoiceSyncedAt: state.billing.invoiceSyncedAt ?? defaultBilling.invoiceSyncedAt
  },
  teamSeats: {
    ...defaultTeamSeatState,
    ...(state.teamSeats ?? {}),
    billingProjection: {
      ...defaultTeamSeatState.billingProjection,
      ...(state.teamSeats?.billingProjection ?? {})
    }
  },
  assetLibrary: {
    ...defaultAssetLibrary,
    ...(state.assetLibrary ?? {}),
    items: state.assetLibrary?.items ?? defaultAssetLibrary.items,
    brandKits: state.assetLibrary?.brandKits ?? defaultAssetLibrary.brandKits,
    defaultBrandKit: state.assetLibrary?.defaultBrandKit ?? state.assetLibrary?.brandKits?.[0] ?? defaultAssetLibrary.defaultBrandKit,
    operations: state.assetLibrary?.operations ?? defaultAssetLibrary.operations,
    packagedAssetIds: state.assetLibrary?.packagedAssetIds ?? []
  },
  editTools: migrateEditTools(state)
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

const applyCheckoutSession = (state: WorkspaceState, session?: CheckoutSession): WorkspaceState => ({
  ...state,
  billing: {
    ...state.billing,
    status: "active",
    quotaLimit: 80,
    quotaUsed: Math.min(state.billing.quotaUsed, 80),
    renewalMode: session ? "provider" : "mock-checkout",
    checkoutSessionId: session?.id,
    checkoutProvider: session?.provider,
    checkoutRedirectUrl: session?.redirect_url,
    checkoutCreatedAt: session?.created_at
  }
});

const applyBillingPortalSession = (state: WorkspaceState, session?: BillingPortalSession): WorkspaceState => ({
  ...state,
  billing: {
    ...state.billing,
    portalSessionId: session?.id ?? `local-portal-${state.session.id}`,
    portalRedirectUrl: session?.redirect_url ?? "/billing"
  }
});

const applySubscriptionCancellation = (state: WorkspaceState, cancellation?: SubscriptionCancellation): WorkspaceState => ({
  ...state,
  billing: {
    ...state.billing,
    renewalMode: state.billing.renewalMode,
    cancellationStatus: cancellation?.status ?? "cancelled",
    cancelAtPeriodEnd: cancellation?.cancel_at_period_end ?? true,
    cancellationUpdatedAt: cancellation?.updated_at ?? new Date().toISOString()
  }
});

const mapBillingInvoice = (invoice: {
  id: string;
  provider: string;
  status: string;
  currency: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  invoice_url?: string;
  receipt_url?: string;
  created_at: string;
}) => ({
  id: invoice.id,
  provider: invoice.provider,
  status: invoice.status,
  currency: invoice.currency,
  amountDueCents: invoice.amount_due_cents,
  amountPaidCents: invoice.amount_paid_cents,
  invoiceUrl: invoice.invoice_url,
  receiptUrl: invoice.receipt_url,
  createdAt: invoice.created_at
});

const refreshBillingInvoiceProjection = async (state: WorkspaceState, billingClient: BillingClient): Promise<WorkspaceState> => {
  const page = await billingClient.listInvoices();
  return {
    ...state,
    billing: {
      ...state.billing,
      invoices: page.items.map(mapBillingInvoice),
      invoiceSyncStatus: "api",
      invoiceSyncedAt: new Date().toISOString()
    }
  };
};

const mapTeamSeatUsage = (usage: {
  team_id: string;
  tenant_id: string;
  plan_id: string;
  seat_limit: number;
  active_seats: number;
  invited_seats: number;
  billable_seats: number;
  available_seats: number;
}) => ({
  teamId: usage.team_id,
  tenantId: usage.tenant_id,
  planId: usage.plan_id,
  seatLimit: usage.seat_limit,
  activeSeats: usage.active_seats,
  invitedSeats: usage.invited_seats,
  billableSeats: usage.billable_seats,
  availableSeats: usage.available_seats
});

const refreshTeamSeatProjection = async (
  state: WorkspaceState,
  billingClient: BillingClient,
  auditEvent: WorkspaceState["teamSeats"]["billingProjection"]["auditEvent"] = "team.seat.refresh"
): Promise<WorkspaceState> => {
  const teamID = state.teamSeats.usage.teamId;
  const [usage, entitlement] = await Promise.all([
    billingClient.getTeamSeatUsage(teamID),
    billingClient.checkTeamSeatEntitlement(teamID, 1)
  ]);

  return {
    ...state,
    teamSeats: {
      ...state.teamSeats,
      usage: mapTeamSeatUsage(usage),
      entitlement: {
        allowed: entitlement.allowed,
        reason: entitlement.reason,
        additionalSeats: 1,
        checkedAt: new Date().toISOString()
      },
      billingProjection: {
        ...state.teamSeats.billingProjection,
        nextBillableSeats: usage.billable_seats,
        syncStatus: "api",
        lastSyncedAt: new Date().toISOString(),
        auditEvent,
        safeProjection: true
      },
      lastSyncStatus: "api"
    }
  };
};

const mapAssetLibraryEntry = (entry: AssetLibraryEntryResponse): AssetLibraryItem => {
  const asset = entry.asset ?? {};
  const objectKey = asset.storage_ref?.object_key ?? asset.object_metadata?.object_key;
  return {
    id: entry.id,
    assetId: asset.id ?? entry.id,
    title: entry.tags?.includes("logo") ? "Primary logo reference" : asset.asset_type ? `${asset.asset_type.replace(/_/g, " ")} asset` : entry.id,
    assetType: asset.asset_type ?? "asset",
    status: asset.status ?? "active",
    visibility: entry.visibility,
    favorite: entry.favorite,
    archived: entry.archived,
    reusable: entry.reusable,
    allowedProjects: entry.allowed_projects ?? [],
    tags: entry.tags ?? [],
    objectKey,
    thumbnailKey: asset.thumbnail_ref?.object_key,
    lineageKind: asset.lineage?.source?.kind,
    traceId: asset.lineage?.source?.trace_id,
    createdAt: entry.created_at ?? asset.created_at ?? new Date().toISOString(),
    updatedAt: entry.updated_at ?? entry.created_at ?? new Date().toISOString()
  };
};

const mapBrandKit = (kit: BrandKitResponse): BrandKitItem => ({
  id: kit.id,
  name: kit.name,
  status: kit.status,
  logos: (kit.logos ?? []).map((logo) => ({
    assetId: logo.asset_id,
    objectMetadataId: logo.object_metadata_id,
    usage: logo.usage
  })),
  palette: kit.palette ?? [],
  fonts: (kit.fonts ?? []).map((font) => ({
    family: font.family,
    assetId: font.asset_id,
    role: font.role
  })),
  guidelines: kit.guidelines ?? [],
  sourceRefs: (kit.source_refs ?? []).map((source) => ({
    kind: source.kind,
    assetId: source.asset_id,
    traceId: source.trace_id
  })),
  projectBindings: (kit.project_bindings ?? []).map((binding) => ({
    projectId: binding.project_id,
    default: binding.default
  })),
  createdAt: kit.created_at,
  updatedAt: kit.updated_at
});

const refreshAssetLibraryProjection = async (
  state: WorkspaceState,
  assetLibraryClient: AssetLibraryClient
): Promise<WorkspaceState> => {
  const [libraryPage, brandKitPage, defaultBrandKit] = await Promise.all([
    assetLibraryClient.listAssetLibrary(state.activeProjectId, "active"),
    assetLibraryClient.listBrandKits(state.activeProjectId, "active"),
    assetLibraryClient.getProjectDefaultBrandKit(state.activeProjectId)
  ]);
  const brandKits = brandKitPage.items.map(mapBrandKit);
  const defaultKit = mapBrandKit(defaultBrandKit);
  return {
    ...state,
    assetLibrary: {
      ...state.assetLibrary,
      items: libraryPage.items.map(mapAssetLibraryEntry),
      brandKits,
      defaultBrandKit: brandKits.find((kit) => kit.id === defaultKit.id) ?? defaultKit,
      syncStatus: "api",
      syncedAt: new Date().toISOString(),
      operations: assetLibraryOperations,
      packagedAssetIds: state.assetLibrary.packagedAssetIds
    }
  };
};

const normalizeBatchStatus = (status: string): BatchGenerationStatus => {
  if (status === "partial_failed") {
    return "partial_succeeded";
  }
  if (
    status === "queued" ||
    status === "running" ||
    status === "succeeded" ||
    status === "partial_succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked"
  ) {
    return status;
  }
  return "queued";
};

const normalizeChildStatus = (status: ChildTaskStatus | string): BatchGenerationChildStatus => {
  if (
    status === "queued" ||
    status === "running" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "blocked"
  ) {
    return status;
  }
  return "queued";
};

const childAllowsRetry = (child: Pick<BatchGenerationChild, "status" | "retryCount" | "maxRetries" | "failureCode">) => {
  const finalFailureCodes = new Set([
    "provider_request_invalid",
    "provider_usage_record_failed",
    "result_sink_unavailable",
    "result_persistence_failed",
    "result_persistence_missing_ids",
    "quota_insufficient",
    "safety_rejected",
    "safety_review_required",
    "content_blocked"
  ]);
  return child.status === "failed" && child.retryCount < child.maxRetries && !finalFailureCodes.has(child.failureCode ?? "");
};

const countRetryableChildren = (children: BatchGenerationChild[]) => children.filter(childAllowsRetry).length;

const mapBatchChildFromApi = (child: GenerationChildTask): BatchGenerationChild => ({
  id: child.id,
  batchId: child.batch_id,
  status: normalizeChildStatus(child.status),
  providerId: child.provider_id,
  modelId: child.model_id,
  toolType: child.tool_type === "image.generate" ? "image.generate" : "image.generate",
  seed: child.seed ?? child.id,
  retryCount: child.retry_count,
  maxRetries: child.max_retries,
  quotaEstimateUnits: child.quota_estimate_units,
  quotaCommittedUnits: child.quota_committed_units,
  quotaRefundedUnits: child.quota_refunded_units,
  assetId: child.asset_id,
  canvasObjectId: child.canvas_object_id,
  traceId: child.trace_id,
  visibleTraceRef: child.visible_trace_ref ?? child.trace_id,
  failureCode: child.failure_code ?? child.review_reason,
  failureMessage: child.failure_message
});

const mapBatchFromApi = (
  batch: BatchGenerationRequest,
  progress?: BatchProgress,
  childrenOverride?: GenerationChildTask[]
): BatchGeneration => {
  const children = (childrenOverride ?? batch.children).map(mapBatchChildFromApi);
  const queuedCount = progress?.queued ?? children.filter((child) => child.status === "queued").length;
  const runningCount = progress?.running ?? children.filter((child) => child.status === "running").length;
  const succeededCount = progress?.succeeded ?? children.filter((child) => child.status === "succeeded").length;
  const failedCount =
    (progress ? progress.failed + progress.blocked : children.filter((child) => child.status === "failed" || child.status === "blocked").length);
  const cancelledCount = progress?.cancelled ?? children.filter((child) => child.status === "cancelled").length;
  const blockedCount = progress?.blocked ?? children.filter((child) => child.status === "blocked").length;
  const terminalCount = succeededCount + failedCount + cancelledCount;

  return {
    id: batch.id,
    projectId: batch.project_id,
    status: normalizeBatchStatus(progress?.status ?? batch.status),
    prompt: batch.prompt_context.text,
    requestedCount: progress?.requested_count ?? batch.requested_count,
    providerId: children[0]?.providerId ?? batch.allowed_models?.[0] ?? "zenari-image-sandbox",
    modelId: children[0]?.modelId ?? batch.allowed_models?.[0] ?? "image-fast-v1",
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    progressPercent: children.length === 0 ? 0 : Math.round((terminalCount / children.length) * 100),
    queuedCount,
    runningCount,
    succeededCount,
    failedCount,
    cancelledCount,
    blockedCount,
    retryableCount: progress?.retryable ?? countRetryableChildren(children),
    progressSyncStatus: "api",
    progressSyncedAt: new Date().toISOString(),
    promptContext: {
      text: batch.prompt_context.text,
      selected_object_ids: batch.prompt_context.selected_object_ids ?? [],
      reference_asset_ids: batch.prompt_context.reference_asset_ids ?? [],
      brand_kit_id: batch.prompt_context.brand_kit_id,
      model_hints: batch.prompt_context.model_hints ?? [],
      tool_hint: batch.prompt_context.tool_hint ?? "image.generate"
    },
    children
  };
};

const mergeBatchGeneration = (state: WorkspaceState, refreshedBatch: BatchGeneration): WorkspaceState => {
  const seen = new Set<string>();
  const batchGenerations = [refreshedBatch, ...state.batchGenerations.filter((batch) => batch.id !== refreshedBatch.id)].filter((batch) => {
    if (seen.has(batch.id)) {
      return false;
    }
    seen.add(batch.id);
    return true;
  });
  return {
    ...state,
    batchGenerations
  };
};

export class DevZenariClient implements ZenariClient {
  constructor(
    private readonly billingClient: BillingClient = createBillingClient(),
    private readonly batchClient: BatchClient = createBatchClient(),
    private readonly assetLibraryClient: AssetLibraryClient = createAssetLibraryClient()
  ) {}

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
    const normalizedEmail = email.trim().toLowerCase() || "dev@zenari.ai";
    const user: SessionUser = {
      id: normalizedEmail === "dev@zenari.ai" ? "user-dev-001" : `user-${normalizedEmail.replace(/[^a-z0-9]+/g, "-")}`,
      name: normalizedEmail === "dev@zenari.ai" ? "Dev User" : normalizedEmail.split("@")[0] || "Local User",
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
    if (state.sessionContract.status === "signed_out") {
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

  async activateCharacterIpConceptWorkflow() {
    const state = loadState();
    const existingCandidateIds = new Set(state.candidates.map((candidate) => candidate.id));
    const nextCandidates = [
      ...state.candidates.filter((candidate) => !characterIpConceptCandidates.some((item) => item.id === candidate.id)),
      ...characterIpConceptCandidates.filter((candidate) => !existingCandidateIds.has(candidate.id))
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
    const state = migrateState(loadState());
    const candidate = state.candidates.find((item) => item.id === candidateId);
    if (!candidate) {
      return clone(state);
    }

    const nodeId = `node-${candidate.id}`;
    const retainedNodes = state.canvas.nodes.filter((node) => node.id !== nodeId);
    const nextNodes: WorkspaceState["canvas"]["nodes"] = [
      ...retainedNodes,
      {
        id: nodeId,
        title: candidate.title,
        kind: "candidate",
        x: 360,
        y: 180,
        width: 230,
        height: 118,
        zIndex: retainedNodes.length + 1,
        locked: false,
        hidden: false,
        body: `${candidate.strategy} ${candidate.rationale}`
      }
    ];
    const snapshot = createCanvasVersionSnapshot(
      {
        ...state,
        canvas: {
          ...state.canvas,
          nodes: nextNodes
        }
      },
      `Selected ${candidate.title}`
    );
    const next = withQuota(
      {
        ...state,
        selectedCandidateId: candidateId,
        canvas: {
          ...state.canvas,
          nodes: nextNodes,
          edges: [...state.canvas.edges.filter((edge) => edge.to !== nodeId), { from: "node-brief", to: nodeId }],
          versions: [...state.canvas.versions, snapshot],
          activeVersionId: snapshot.id,
          autosavedAt: new Date().toISOString(),
          interaction: {
            ...state.canvas.interaction,
            selectedNodeIds: [nodeId],
            lastAction: "select"
          }
        }
      },
      2
    );
    return saveState(next);
  }

  async iterateSelected(instruction: string) {
    const state = migrateState(loadState());
    if (!state.selectedCandidateId || !instruction.trim()) {
      return clone(state);
    }

    const selected = state.candidates.find((item) => item.id === state.selectedCandidateId);
    const nodeId = `node-iteration-${state.canvas.nodes.length + 1}`;
    const nextNodes: WorkspaceState["canvas"]["nodes"] = [
      ...state.canvas.nodes,
      {
        id: nodeId,
        title: "Iteration",
        kind: "iteration",
        x: 650,
        y: 260,
        width: 230,
        height: 118,
        zIndex: state.canvas.nodes.length + 1,
        locked: false,
        hidden: false,
        body: `${selected?.title ?? "Selected direction"} refined with: ${instruction}`
      }
    ];
    const snapshot = createCanvasVersionSnapshot(
      {
        ...state,
        canvas: {
          ...state.canvas,
          nodes: nextNodes
        }
      },
      "Canvas iteration"
    );
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
          nodes: nextNodes,
          edges: [...state.canvas.edges, { from: `node-${state.selectedCandidateId}`, to: nodeId }],
          versions: [...state.canvas.versions, snapshot],
          activeVersionId: snapshot.id,
          autosavedAt: new Date().toISOString(),
          interaction: {
            ...state.canvas.interaction,
            selectedNodeIds: [nodeId],
            lastAction: "select"
          }
        }
      },
      3
    );
    return saveState(next);
  }

  async restoreCanvasVersion(versionId: string) {
    const state = migrateState(loadState());
    const version = state.canvas.versions.find((item) => item.id === versionId);
    if (!version) {
      return clone(state);
    }
    const snapshotNodes = cloneCanvasNodes(version.snapshot?.nodes ?? state.canvas.nodes);
    const snapshotNodeIds = new Set(snapshotNodes.map((node) => node.id));
    const preservedNodes = state.canvas.nodes.filter((node) => !snapshotNodeIds.has(node.id));
    const nextNodes = [...snapshotNodes, ...preservedNodes].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));
    const existingNodeIds = new Set(nextNodes.map((node) => node.id));
    const snapshotEdges = cloneCanvasEdges(version.snapshot?.edges ?? state.canvas.edges).filter(
      (edge) => existingNodeIds.has(edge.from) && existingNodeIds.has(edge.to)
    );
    const preservedEdges = state.canvas.edges.filter(
      (edge) => !snapshotEdges.some((snapshotEdge) => snapshotEdge.from === edge.from && snapshotEdge.to === edge.to)
    );
    const restoredNodeIds = snapshotNodes.map((node) => node.id).sort();
    const preservedNodeIds = preservedNodes.map((node) => node.id).sort();
    const restoredVersions = state.canvas.versions.map((item) =>
      item.id === version.id
        ? {
            ...item,
            restorePreview: {
              restoresNodeIds: restoredNodeIds,
              preservesNodeIds: preservedNodeIds,
              conflictNodeIds: []
            }
          }
        : item
    );

    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        nodes: nextNodes,
        edges: [...snapshotEdges, ...preservedEdges],
        versions: restoredVersions,
        activeVersionId: versionId,
        autosavedAt: new Date().toISOString(),
        interaction: {
          ...state.canvas.interaction,
          selectedNodeIds: restoredNodeIds.slice(0, 1),
          lastAction: "undo"
        }
      }
    });
  }

  async selectCanvasNode(nodeId: string, additive = false) {
    const state = migrateState(loadState());
    const node = state.canvas.nodes.find((item) => item.id === nodeId);
    if (!node || node.hidden) {
      return clone(state);
    }
    const selectedNodeIds = additive
      ? Array.from(new Set([...state.canvas.interaction.selectedNodeIds, nodeId]))
      : [nodeId];

    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        autosavedAt: new Date().toISOString(),
        interaction: {
          ...state.canvas.interaction,
          selectedNodeIds,
          lastAction: "select"
        }
      }
    });
  }

  async moveCanvasNode(nodeId: string, delta: { x: number; y: number }) {
    const state = migrateState(loadState());
    const node = state.canvas.nodes.find((item) => item.id === nodeId);
    if (!node || node.locked || node.hidden) {
      return clone(state);
    }
    const movedNodes = state.canvas.nodes.map((item) =>
      item.id === nodeId
        ? {
            ...item,
            x: Math.max(0, item.x + delta.x),
            y: Math.max(0, item.y + delta.y)
          }
        : item
    );
    const snapshot = createCanvasVersionSnapshot(
      {
        ...state,
        canvas: {
          ...state.canvas,
          nodes: movedNodes
        }
      },
      "Canvas move"
    );

    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        nodes: movedNodes,
        versions: [...state.canvas.versions, snapshot],
        activeVersionId: snapshot.id,
        autosavedAt: new Date().toISOString(),
        interaction: {
          ...state.canvas.interaction,
          selectedNodeIds: [nodeId],
          lastAction: "drag"
        }
      }
    });
  }

  async setCanvasZoom(zoom: number) {
    const state = migrateState(loadState());
    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        autosavedAt: new Date().toISOString(),
        interaction: {
          ...state.canvas.interaction,
          zoom: clampCanvasZoom(zoom),
          lastAction: "zoom"
        }
      }
    });
  }

  async fitCanvasToView() {
    const state = migrateState(loadState());
    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        autosavedAt: new Date().toISOString(),
        interaction: {
          ...state.canvas.interaction,
          zoom: 1,
          pan: { x: 0, y: 0 },
          lastAction: "fit"
        }
      }
    });
  }

  async setCanvasTool(tool: CanvasTool) {
    const state = migrateState(loadState());
    if (!state.canvas.interaction.toolbarTools.includes(tool)) {
      return clone(state);
    }
    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        interaction: {
          ...state.canvas.interaction,
          tool,
          lastAction: "tool"
        }
      }
    });
  }

  async toggleCanvasNodeHidden(nodeId: string) {
    const state = migrateState(loadState());
    const node = state.canvas.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return clone(state);
    }
    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        nodes: state.canvas.nodes.map((item) => (item.id === nodeId ? { ...item, hidden: !item.hidden } : item)),
        interaction: {
          ...state.canvas.interaction,
          selectedNodeIds: state.canvas.interaction.selectedNodeIds.filter((id) => id !== nodeId),
          lastAction: "layer-hide"
        },
        autosavedAt: new Date().toISOString()
      }
    });
  }

  async toggleCanvasNodeLocked(nodeId: string) {
    const state = migrateState(loadState());
    const node = state.canvas.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return clone(state);
    }
    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        nodes: state.canvas.nodes.map((item) => (item.id === nodeId ? { ...item, locked: !item.locked } : item)),
        interaction: {
          ...state.canvas.interaction,
          selectedNodeIds: [nodeId],
          lastAction: "layer-lock"
        },
        autosavedAt: new Date().toISOString()
      }
    });
  }

  async duplicateSelectedCanvasNodes() {
    const state = migrateState(loadState());
    const selectedNodes = state.canvas.nodes.filter(
      (node) => state.canvas.interaction.selectedNodeIds.includes(node.id) && !node.locked && !node.hidden
    );
    if (selectedNodes.length === 0) {
      return clone(state);
    }
    const copies = selectedNodes.map((node, index) => ({
      ...node,
      id: `${node.id}-copy-${state.canvas.nodes.length + index + 1}`,
      title: `${node.title} Copy`,
      x: node.x + 32,
      y: node.y + 32,
      zIndex: state.canvas.nodes.length + index + 1,
      locked: false,
      hidden: false
    }));
    const nextNodes = [...state.canvas.nodes, ...copies];
    const snapshot = createCanvasVersionSnapshot(
      {
        ...state,
        canvas: {
          ...state.canvas,
          nodes: nextNodes
        }
      },
      "Canvas duplicate"
    );

    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        nodes: nextNodes,
        versions: [...state.canvas.versions, snapshot],
        activeVersionId: snapshot.id,
        autosavedAt: new Date().toISOString(),
        interaction: {
          ...state.canvas.interaction,
          selectedNodeIds: copies.map((node) => node.id),
          lastAction: "keyboard"
        }
      }
    });
  }

  async deleteSelectedCanvasNodes() {
    const state = migrateState(loadState());
    const selectedIds = new Set(state.canvas.interaction.selectedNodeIds);
    const deletableIds = new Set(
      state.canvas.nodes.filter((node) => selectedIds.has(node.id) && !node.locked && node.id !== "node-brief").map((node) => node.id)
    );
    if (deletableIds.size === 0) {
      return clone(state);
    }
    const nextNodes = state.canvas.nodes.filter((node) => !deletableIds.has(node.id));
    const snapshot = createCanvasVersionSnapshot(
      {
        ...state,
        canvas: {
          ...state.canvas,
          nodes: nextNodes
        }
      },
      "Canvas delete"
    );

    return saveState({
      ...state,
      canvas: {
        ...state.canvas,
        nodes: nextNodes,
        edges: state.canvas.edges.filter((edge) => !deletableIds.has(edge.from) && !deletableIds.has(edge.to)),
        versions: [...state.canvas.versions, snapshot],
        activeVersionId: snapshot.id,
        autosavedAt: new Date().toISOString(),
        interaction: {
          ...state.canvas.interaction,
          selectedNodeIds: [],
          lastAction: "keyboard"
        }
      }
    });
  }

  async setEditTool(tool: EditToolType) {
    const state = migrateState(loadState());
    if (!state.editTools.availableTools.includes(tool)) {
      return clone(state);
    }
    return saveState({
      ...state,
      editTools: {
        ...state.editTools,
        activeTool: tool,
        lastAction: "tool"
      }
    });
  }

  async updateEditMask(mask: Partial<EditMaskState>) {
    const state = migrateState(loadState());
    const nextMask = {
      ...state.editTools.mask,
      ...mask,
      width: mask.width ?? state.editTools.sourceWidth,
      height: mask.height ?? state.editTools.sourceHeight,
      coveragePct: clampMaskCoverage(mask.coveragePct ?? state.editTools.mask.coveragePct)
    };
    return saveState({
      ...state,
      editTools: {
        ...state.editTools,
        mask: nextMask,
        lastAction: "mask"
      }
    });
  }

  async applyEditTool() {
    const state = migrateState(loadState());
    const selectedNodeId = state.canvas.interaction.selectedNodeIds[0] ?? state.editTools.sourceNodeId;
    const sourceNode = state.canvas.nodes.find((node) => node.id === selectedNodeId) ?? state.canvas.nodes.find((node) => node.id === state.editTools.sourceNodeId);
    if (!sourceNode || sourceNode.locked || sourceNode.hidden) {
      return clone(state);
    }
    const revisionIndex = state.editTools.revisions.length + 1;
    const revisionId = `edit-revision-${String(revisionIndex).padStart(3, "0")}`;
    const derivedAssetId = `asset-edit-${String(revisionIndex).padStart(3, "0")}`;
    const derivedNodeId = `node-edit-${String(revisionIndex).padStart(3, "0")}`;
    const tool = state.editTools.activeTool;
    const providerRequestRequired = ["remove_background", "upscale", "erase", "expand"].includes(tool);
    const maskRequired = ["erase", "expand"].includes(tool);
    if (maskRequired && (state.editTools.mask.width !== state.editTools.sourceWidth || state.editTools.mask.height !== state.editTools.sourceHeight)) {
      return clone(state);
    }

    const revision: EditToolRevision = {
      id: revisionId,
      sourceAssetId: state.editTools.sourceAssetId,
      derivedAssetId,
      sourceNodeId: sourceNode.id,
      derivedNodeId,
      tool,
      nonDestructive: !providerRequestRequired,
      originalAssetRetained: true,
      providerRequestRequired,
      mask: maskRequired ? state.editTools.mask : undefined,
      transform:
        tool === "crop"
          ? { crop: { x: 96, y: 64, width: 768, height: 512 } }
          : tool === "rotate"
            ? { rotate: 90 }
            : tool === "flip"
              ? { flipX: true }
              : undefined,
      lineage: {
        originalAssetId: state.editTools.sourceAssetId,
        derivedFromAssetId: state.editTools.sourceAssetId,
        toolType: tool,
        traceId: `trace-${revisionId}`,
        rawPayloadPersisted: false
      },
      createdAt: new Date().toISOString()
    };
    const derivedNode = {
      ...sourceNode,
      id: derivedNodeId,
      title: `${sourceNode.title} ${tool.replace(/_/g, " ")}`,
      kind: "iteration" as const,
      x: sourceNode.x + 42,
      y: sourceNode.y + 42,
      zIndex: state.canvas.nodes.length + 1,
      locked: false,
      hidden: false,
      body: `Edit revision ${revisionId} keeps ${state.editTools.sourceAssetId} and creates ${derivedAssetId} with ${tool}.`
    };
    const nextNodes = [...state.canvas.nodes, derivedNode];
    const snapshot = createCanvasVersionSnapshot(
      {
        ...state,
        canvas: {
          ...state.canvas,
          nodes: nextNodes
        }
      },
      `Edit ${tool.replace(/_/g, " ")}`
    );
    const nextAssetLibraryItems: AssetLibraryItem[] = [
      ...state.assetLibrary.items,
      {
        id: `library_entry_edit_${String(revisionIndex).padStart(3, "0")}`,
        assetId: derivedAssetId,
        title: `Edit revision ${revisionIndex}`,
        assetType: "generated_image",
        status: "active",
        visibility: "project",
        favorite: false,
        archived: false,
        reusable: true,
        allowedProjects: [state.activeProjectId],
        tags: ["edit", tool],
        objectKey: `tenants/tenant_1/assets/${derivedAssetId}.png`,
        thumbnailKey: `tenants/tenant_1/assets/${derivedAssetId}-thumb.png`,
        lineageKind: "edit_tool_revision",
        traceId: revision.lineage.traceId,
        createdAt: revision.createdAt,
        updatedAt: revision.createdAt
      }
    ];

    return saveState(
      withQuota(
        {
          ...state,
          canvas: {
            ...state.canvas,
            nodes: nextNodes,
            edges: [...state.canvas.edges, { from: sourceNode.id, to: derivedNodeId }],
            versions: [...state.canvas.versions, snapshot],
            activeVersionId: snapshot.id,
            autosavedAt: new Date().toISOString(),
            interaction: {
              ...state.canvas.interaction,
              selectedNodeIds: [derivedNodeId],
              lastAction: "select"
            }
          },
          assetLibrary: {
            ...state.assetLibrary,
            items: nextAssetLibraryItems,
            syncStatus: "local",
            syncedAt: revision.createdAt
          },
          editTools: {
            ...state.editTools,
            sourceNodeId: sourceNode.id,
            revisions: [revision, ...state.editTools.revisions],
            lastRevisionId: revision.id,
            lastAction: "apply",
            syncStatus: "local"
          }
        },
        providerRequestRequired ? 2 : 1
      )
    );
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

    const addedAt = new Date().toISOString();
    const outputFiles = candidate?.requiredOutputFiles ?? [];
    const items: PackageItem[] = candidate && outputFiles.length > 1
      ? outputFiles.map((outputFile, index) => ({
          id: `pkg-item-${String(state.packageItems.length + index + 1).padStart(3, "0")}`,
          sourceId: `${sourceId}:${outputFile}`,
          title: `${candidate.title} · ${outputFile.split("/").at(-1) ?? outputFile}`,
          type: "candidate",
          addedAt,
          workflowId: candidate.workflowId,
          strategyTaxonomy: candidate.strategyTaxonomy,
          requiredOutputFiles: [outputFile]
        }))
      : [
          {
            id: `pkg-item-${String(state.packageItems.length + 1).padStart(3, "0")}`,
            sourceId,
            title: candidate?.title ?? node?.title ?? reference?.name ?? "Canvas item",
            type: candidate ? "candidate" : reference ? "reference" : "canvas-frame",
            addedAt,
            workflowId: candidate?.workflowId,
            strategyTaxonomy: candidate?.strategyTaxonomy,
            requiredOutputFiles: candidate?.requiredOutputFiles
          }
        ];

    return saveState({
      ...state,
      packageItems: [...state.packageItems, ...items]
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

  async createBatchGeneration(countOrPayload: number | PromptComposerPayload = 4) {
    const state = migrateState(loadState());
    const createdAt = new Date().toISOString();
    const payload =
      typeof countOrPayload === "number"
        ? buildPromptComposerPayload(state, {
            text: state.brief.prompt,
            requestedCount: countOrPayload,
            aspectRatio: "16:9",
            quality: "standard"
          })
        : countOrPayload;
    const requestedCount = Math.max(1, Math.min(20, Math.floor(payload.requested_count)));
    const batchIndex = state.batchGenerations.length + 1;
    const batchId = `batch-${String(batchIndex).padStart(3, "0")}`;
    const modelId = payload.allowed_models[0] ?? payload.prompt_context.model_hints[0] ?? "image-fast-v1";
    const providerId = "zenari-image-sandbox";
    const children: BatchGenerationChild[] = Array.from({ length: requestedCount }, (_item, index) => {
      const childIndex = index + 1;
      const childId = `child-${String(batchIndex).padStart(3, "0")}-${String(childIndex).padStart(2, "0")}`;
      return {
        id: childId,
        batchId,
        status: childIndex === requestedCount ? "failed" : "queued",
        providerId,
        modelId,
        toolType: "image.generate",
        seed: `${batchId}-${String(childIndex).padStart(3, "0")}`,
        retryCount: childIndex === requestedCount ? 1 : 0,
        maxRetries: 2,
        quotaEstimateUnits: 4,
        quotaCommittedUnits: 0,
        quotaRefundedUnits: childIndex === requestedCount ? 4 : 0,
        traceId: `trace-${childId}`,
        visibleTraceRef: `trace_projection_${childId}`,
        failureCode: childIndex === requestedCount ? "provider_unavailable" : undefined,
        failureMessage: childIndex === requestedCount ? "Sandbox provider queued retryable failure evidence." : undefined
      };
    });
    const batch = this.summarizeBatch({
      id: batchId,
      projectId: state.activeProjectId,
      status: "queued",
      prompt: payload.prompt_context.text,
      requestedCount,
      providerId,
      modelId,
      createdAt,
      updatedAt: createdAt,
      progressPercent: 0,
      queuedCount: 0,
      runningCount: 0,
      succeededCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      blockedCount: 0,
      retryableCount: 0,
      progressSyncStatus: "local",
      progressSyncedAt: createdAt,
      promptContext: payload.prompt_context,
      promptComposerPayload: payload,
      children
    });

    return saveState(
      withQuota(
        {
          ...state,
          batchGenerations: [batch, ...state.batchGenerations]
        },
        requestedCount
      )
    );
  }

  async refreshBatchGenerationProgress(batchId: string) {
    const state = migrateState(loadState());
    const existingBatch = state.batchGenerations.find((batch) => batch.id === batchId);
    if (!existingBatch) {
      return clone(state);
    }

    try {
      const [batch, progress, children] = await Promise.all([
        this.batchClient.getBatchGeneration(batchId),
        this.batchClient.getBatchGenerationProgress(batchId),
        this.batchClient.listBatchGenerationChildren(batchId)
      ]);
      const refreshedBatch = mapBatchFromApi(batch, progress, children.items);
      return saveState(applyBatchResultPlacement(mergeBatchGeneration(state, refreshedBatch), refreshedBatch));
    } catch {
      return saveState(
        mergeBatchGeneration(state, {
          ...this.summarizeBatch(existingBatch),
          progressSyncStatus: "unavailable",
          progressSyncedAt: new Date().toISOString()
        })
      );
    }
  }

  async cancelBatchGeneration(batchId: string) {
    const state = migrateState(loadState());

    return saveState({
      ...state,
      batchGenerations: state.batchGenerations.map((batch) => {
        if (batch.id !== batchId) {
          return batch;
        }
        return this.summarizeBatch({
          ...batch,
          updatedAt: new Date().toISOString(),
          children: batch.children.map((child) =>
            child.status === "queued" || child.status === "running"
              ? {
                  ...child,
                  status: "cancelled",
                  quotaRefundedUnits: child.quotaEstimateUnits
                }
              : child
          )
        });
      })
    });
  }

  async retryBatchGenerationChild(childId: string) {
    const state = migrateState(loadState());

    return saveState({
      ...state,
      batchGenerations: state.batchGenerations.map((batch) =>
        this.summarizeBatch({
          ...batch,
          updatedAt: new Date().toISOString(),
          children: batch.children.map((child) =>
            child.id === childId && child.status === "failed" && child.retryCount < child.maxRetries
              ? {
                  ...child,
                  status: "queued",
                  retryCount: child.retryCount + 1,
                  quotaRefundedUnits: 0,
                  failureCode: undefined,
                  failureMessage: undefined
                }
              : child
          )
        })
      )
    });
  }

  private summarizeBatch(batch: BatchGeneration): BatchGeneration {
    const queuedCount = batch.children.filter((child) => child.status === "queued").length;
    const runningCount = batch.children.filter((child) => child.status === "running").length;
    const succeededCount = batch.children.filter((child) => child.status === "succeeded").length;
    const failedCount = batch.children.filter((child) => child.status === "failed" || child.status === "blocked").length;
    const cancelledCount = batch.children.filter((child) => child.status === "cancelled").length;
    const terminalCount = succeededCount + failedCount + cancelledCount;
    const status: BatchGeneration["status"] =
      cancelledCount === batch.children.length
        ? "cancelled"
        : failedCount > 0 && terminalCount === batch.children.length
        ? succeededCount > 0
          ? "partial_succeeded"
          : "failed"
        : runningCount > 0
        ? "running"
        : queuedCount > 0
        ? "queued"
        : "succeeded";

    return {
      ...batch,
      status,
      progressPercent: batch.children.length === 0 ? 0 : Math.round((terminalCount / batch.children.length) * 100),
      queuedCount,
      runningCount,
      succeededCount,
      failedCount,
      cancelledCount,
      blockedCount: batch.children.filter((child) => child.status === "blocked").length,
      retryableCount: countRetryableChildren(batch.children),
      progressSyncStatus: batch.progressSyncStatus ?? "local",
      progressSyncedAt: batch.progressSyncedAt ?? new Date().toISOString()
    };
  }

  async createMockCheckout() {
    const state = migrateState(loadState());
    try {
      const session = await this.billingClient.createCheckoutSession(
        { plan_id: defaultCheckoutPlanId },
        `checkout-${state.session.id}-${defaultCheckoutPlanId}`
      );
      return saveState(applyCheckoutSession(state, session));
    } catch {
      return saveState(applyCheckoutSession(state));
    }
  }

  async createBillingPortalSession() {
    const state = migrateState(loadState());
    try {
      const session = await this.billingClient.createPortalSession(`portal-${state.session.id}`);
      return saveState(applyBillingPortalSession(state, session));
    } catch {
      return saveState(applyBillingPortalSession(state));
    }
  }

  async cancelSubscription() {
    const state = migrateState(loadState());
    try {
      const cancellation = await this.billingClient.cancelSubscription(`cancel-${state.session.id}`);
      return saveState(applySubscriptionCancellation(state, cancellation));
    } catch {
      return saveState(applySubscriptionCancellation(state));
    }
  }

  async refreshBillingInvoices() {
    const state = migrateState(loadState());
    try {
      return saveState(await refreshBillingInvoiceProjection(state, this.billingClient));
    } catch {
      return saveState({
        ...state,
        billing: {
          ...state.billing,
          invoiceSyncStatus: "unavailable",
          invoiceSyncedAt: new Date().toISOString()
        }
      });
    }
  }

  async refreshTeamSeats() {
    const state = migrateState(loadState());
    try {
      return saveState(await refreshTeamSeatProjection(state, this.billingClient));
    } catch {
      return saveState({
        ...state,
        teamSeats: {
          ...state.teamSeats,
          lastSyncStatus: "local"
        }
      });
    }
  }

  async acceptTeamInvite() {
    const state = migrateState(loadState());
    const invite = state.teamSeats.pendingInvite;
    if (!invite || invite.status === "accepted") {
      return saveState(state);
    }

    try {
      const member = await this.billingClient.acceptTeamInvite(
        invite.teamId,
        invite.inviteId,
        `team-invite-accept-${state.session.id}-${invite.inviteId}`
      );
      const refreshed = await refreshTeamSeatProjection(
        {
          ...state,
          teamSeats: {
            ...state.teamSeats,
            pendingInvite: {
              ...invite,
              status: "accepted",
              acceptedAt: member.updated_at
            },
            lastAcceptedInviteId: invite.inviteId,
            lastSyncStatus: "api",
            billingProjection: {
              ...state.teamSeats.billingProjection,
              nextBillableSeats: state.teamSeats.usage.billableSeats,
              syncStatus: "api",
              lastSyncedAt: member.updated_at,
              auditEvent: "team.invite.accept",
              safeProjection: true
            }
          }
        },
        this.billingClient,
        "team.invite.accept"
      );
      return saveState(refreshed);
    } catch {
      const now = new Date().toISOString();
      const usage = state.teamSeats.usage;
      const acceptedUsage = {
        ...usage,
        activeSeats: usage.activeSeats + 1,
        invitedSeats: Math.max(0, usage.invitedSeats - 1),
        billableSeats: usage.billableSeats,
        availableSeats: usage.availableSeats
      };
      return saveState({
        ...state,
        teamSeats: {
          ...state.teamSeats,
          usage: acceptedUsage,
          entitlement: {
            allowed: acceptedUsage.availableSeats > 0,
            reason: acceptedUsage.availableSeats > 0 ? "ok" : "seat_limit_exceeded",
            additionalSeats: 1,
            checkedAt: now
          },
          pendingInvite: {
            ...invite,
            status: "accepted",
            acceptedAt: now
          },
          lastAcceptedInviteId: invite.inviteId,
          lastSyncStatus: "local",
          billingProjection: {
            ...state.teamSeats.billingProjection,
            nextBillableSeats: acceptedUsage.billableSeats,
            syncStatus: "local",
            lastSyncedAt: now,
            auditEvent: "team.invite.accept",
            safeProjection: true
          }
        }
      });
    }
  }

  async refreshAssetLibrary() {
    const state = migrateState(loadState());
    try {
      return saveState(await refreshAssetLibraryProjection(state, this.assetLibraryClient));
    } catch {
      return saveState({
        ...state,
        assetLibrary: {
          ...state.assetLibrary,
          syncStatus: state.assetLibrary.items.length > 0 ? "local" : "unavailable",
          syncedAt: new Date().toISOString()
        }
      });
    }
  }

  async createAssetLibraryEntryFromSelection() {
    const state = migrateState(loadState());
    const selectedNodeId = state.canvas.interaction.selectedNodeIds[0];
    const selectedNode = state.canvas.nodes.find((node) => node.id === selectedNodeId) ?? state.canvas.nodes[0];
    if (!selectedNode) {
      return clone(state);
    }
    const assetId = `canvas-${selectedNode.id}`;
    const request: AssetLibraryEntryCreateRequest = {
      asset_id: assetId,
      project_id: state.activeProjectId,
      visibility: "project",
      favorite: false,
      reusable: true,
      allowed_projects: [state.activeProjectId],
      tags: ["canvas", selectedNode.kind]
    };
    const idempotencyKey = `asset-library-create-${state.session.id}-${assetId}`;
    try {
      await this.assetLibraryClient.createAssetLibraryEntry(request, idempotencyKey);
      return saveState(await refreshAssetLibraryProjection(state, this.assetLibraryClient));
    } catch {
      const now = new Date().toISOString();
      const existing = state.assetLibrary.items.find((item) => item.assetId === assetId);
      if (existing) {
        return clone(state);
      }
      return saveState({
        ...state,
        assetLibrary: {
          ...state.assetLibrary,
          items: [
            ...state.assetLibrary.items,
            {
              id: `library_entry_${assetId}`,
              assetId,
              title: selectedNode.title,
              assetType: "canvas_object",
              status: "active",
              visibility: "project",
              favorite: false,
              archived: false,
              reusable: true,
              allowedProjects: [state.activeProjectId],
              tags: ["canvas", selectedNode.kind],
              objectKey: undefined,
              lineageKind: "canvas_selection",
              traceId: undefined,
              createdAt: now,
              updatedAt: now
            }
          ],
          operations: assetLibraryOperations,
          syncStatus: "local",
          syncedAt: now
        }
      });
    }
  }

  async toggleAssetLibraryFavorite(entryId: string) {
    const state = migrateState(loadState());
    const entry = state.assetLibrary.items.find((item) => item.id === entryId);
    if (!entry || entry.archived) {
      return clone(state);
    }
    const favorite = !entry.favorite;
    try {
      await this.assetLibraryClient.updateAssetLibraryEntry(entryId, { favorite }, `asset-library-favorite-${entryId}-${favorite}`);
      return saveState(await refreshAssetLibraryProjection(state, this.assetLibraryClient));
    } catch {
      const now = new Date().toISOString();
      return saveState({
        ...state,
        assetLibrary: {
          ...state.assetLibrary,
          items: state.assetLibrary.items.map((item) => (item.id === entryId ? { ...item, favorite, updatedAt: now } : item)),
          operations: assetLibraryOperations,
          syncStatus: "local",
          syncedAt: now
        }
      });
    }
  }

  async archiveAssetLibraryEntry(entryId: string) {
    const state = migrateState(loadState());
    const entry = state.assetLibrary.items.find((item) => item.id === entryId);
    if (!entry || entry.archived) {
      return clone(state);
    }
    try {
      await this.assetLibraryClient.updateAssetLibraryEntry(entryId, { archived: true, favorite: false }, `asset-library-archive-${entryId}`);
      return saveState(await refreshAssetLibraryProjection(state, this.assetLibraryClient));
    } catch {
      const now = new Date().toISOString();
      return saveState({
        ...state,
        assetLibrary: {
          ...state.assetLibrary,
          items: state.assetLibrary.items.map((item) =>
            item.id === entryId ? { ...item, archived: true, favorite: false, updatedAt: now } : item
          ),
          operations: assetLibraryOperations,
          syncStatus: "local",
          syncedAt: now
        }
      });
    }
  }

  async createBrandKitFromLogoAsset(entryId: string) {
    const state = migrateState(loadState());
    const entry = state.assetLibrary.items.find((item) => item.id === entryId && !item.archived);
    if (!entry) {
      return clone(state);
    }
    const request: BrandKitWriteRequest = {
      name: `${entry.title} Brand Kit`,
      status: "active",
      logos: [{ asset_id: entry.assetId, usage: "primary" }],
      palette: [
        { name: "Ink", hex: "#111827", role: "primary" },
        { name: "Signal", hex: "#2563eb", role: "accent" }
      ],
      fonts: [{ family: "Inter", role: "body" }],
      guidelines: [{ id: `guideline-${entry.assetId}`, title: "Logo clearance", body: "Keep the logo clear.", severity: "required" }],
      source_refs: [{ kind: "asset_library", asset_id: entry.assetId, trace_id: entry.traceId }],
      project_bindings: [{ project_id: state.activeProjectId, default: true }]
    };
    try {
      await this.assetLibraryClient.createBrandKit(request, `brand-kit-create-${state.session.id}-${entry.assetId}`);
      return saveState(await refreshAssetLibraryProjection(state, this.assetLibraryClient));
    } catch {
      const now = new Date().toISOString();
      const kit: BrandKitItem = {
        id: `brand_kit_${entry.assetId}`,
        name: request.name,
        status: "active",
        logos: [{ assetId: entry.assetId, usage: "primary" }],
        palette: request.palette,
        fonts: [{ family: "Inter", role: "body" }],
        guidelines: [{ id: `guideline-${entry.assetId}`, title: "Logo clearance", body: "Keep the logo clear.", severity: "required" }],
        sourceRefs: [{ kind: "asset_library", assetId: entry.assetId, traceId: entry.traceId }],
        projectBindings: [{ projectId: state.activeProjectId, default: true }],
        createdAt: now,
        updatedAt: now
      };
      return saveState({
        ...state,
        assetLibrary: {
          ...state.assetLibrary,
          brandKits: [kit, ...state.assetLibrary.brandKits.map((existing) => ({ ...existing, projectBindings: existing.projectBindings.map((binding) => binding.projectId === state.activeProjectId ? { ...binding, default: false } : binding) }))],
          defaultBrandKit: kit,
          operations: assetLibraryOperations,
          syncStatus: "local",
          syncedAt: now
        }
      });
    }
  }

  async setDefaultBrandKit(brandKitId: string) {
    const state = migrateState(loadState());
    const kit = state.assetLibrary.brandKits.find((item) => item.id === brandKitId && item.status !== "archived");
    if (!kit) {
      return clone(state);
    }
    try {
      await this.assetLibraryClient.setProjectDefaultBrandKit(state.activeProjectId, brandKitId, `brand-kit-default-${state.activeProjectId}-${brandKitId}`);
      return saveState(await refreshAssetLibraryProjection(state, this.assetLibraryClient));
    } catch {
      const now = new Date().toISOString();
      const brandKits = state.assetLibrary.brandKits.map((item) => ({
        ...item,
        projectBindings: item.projectBindings.map((binding) =>
          binding.projectId === state.activeProjectId ? { ...binding, default: item.id === brandKitId } : binding
        )
      }));
      return saveState({
        ...state,
        assetLibrary: {
          ...state.assetLibrary,
          brandKits,
          defaultBrandKit: brandKits.find((item) => item.id === brandKitId),
          operations: assetLibraryOperations,
          syncStatus: "local",
          syncedAt: now
        }
      });
    }
  }

  async updateBrandKitGuidelines(brandKitId: string) {
    const state = migrateState(loadState());
    const kit = state.assetLibrary.brandKits.find((item) => item.id === brandKitId && item.status !== "archived");
    if (!kit) {
      return clone(state);
    }
    const nextGuidelines = [
      ...kit.guidelines,
      {
        id: `guideline-update-${kit.id}`,
        title: "Asset reuse",
        body: "Use approved library assets for launch variants.",
        severity: "recommended"
      }
    ];
    try {
      await this.assetLibraryClient.updateBrandKit(
        brandKitId,
        {
          guidelines: nextGuidelines.map((guideline) => ({
            id: guideline.id,
            title: guideline.title,
            body: guideline.body,
            severity: guideline.severity
          }))
        },
        `brand-kit-update-${brandKitId}`
      );
      return saveState(await refreshAssetLibraryProjection(state, this.assetLibraryClient));
    } catch {
      const now = new Date().toISOString();
      const brandKits = state.assetLibrary.brandKits.map((item) =>
        item.id === brandKitId ? { ...item, guidelines: nextGuidelines, updatedAt: now } : item
      );
      return saveState({
        ...state,
        assetLibrary: {
          ...state.assetLibrary,
          brandKits,
          defaultBrandKit: brandKits.find((item) => item.id === state.assetLibrary.defaultBrandKit?.id),
          operations: assetLibraryOperations,
          syncStatus: "local",
          syncedAt: now
        }
      });
    }
  }

  async packageAssetLibraryItem(entryId: string) {
    const state = migrateState(loadState());
    const entry = state.assetLibrary.items.find((item) => item.id === entryId);
    if (!entry || entry.archived || !entry.reusable || state.assetLibrary.packagedAssetIds.includes(entry.assetId)) {
      return clone(state);
    }
    const packageItem: PackageItem = {
      id: `pkg-item-${String(state.packageItems.length + 1).padStart(3, "0")}`,
      sourceId: `asset-library:${entry.assetId}`,
      title: entry.title,
      type: "reference",
      addedAt: new Date().toISOString()
    };
    return saveState({
      ...state,
      packageItems: [...state.packageItems, packageItem],
      assetLibrary: {
        ...state.assetLibrary,
        packagedAssetIds: [...state.assetLibrary.packagedAssetIds, entry.assetId]
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
      billing: billingByScenario[scenario],
      teamSeats: state.teamSeats ?? defaultTeamSeats
    });
  }

  async updateAccount(settings: AccountSettings) {
    const state = loadState();
    return saveState({
      ...state,
      account: settings
    });
  }

  async reportProblem(input: Pick<Parameters<ZenariClient["reportProblem"]>[0], "category" | "body" | "linkedExportId">) {
    const state = loadState();
    const ticket = createSupportTicket(state, input);
    return saveState({
      ...state,
      supportTickets: [ticket, ...state.supportTickets]
    });
  }
}

export const zenariClient = new DevZenariClient();
