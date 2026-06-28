import { beforeEach, describe, expect, it, vi } from "vitest";
import { DevZenariClient, workspaceStorageKey } from "./api-client";
import { ecommerceGrowthWorkflowAcceptance } from "./dev-state";

const makeClient = () => new DevZenariClient();

const createBillingClientMock = (overrides = {}) => ({
  getQuotaState: vi.fn(async () => ({ buckets: [], transactions: [] })),
  getSubscription: vi.fn(async () => ({
    id: "sub_test_001",
    plan_id: "plan_pro",
    status: "active",
    current_period_start: "2026-06-01T00:00:00Z"
  })),
  listInvoices: vi.fn(async () => ({ items: [] })),
  createCheckoutSession: vi.fn(async () => {
    throw new Error("not configured");
  }),
  createPortalSession: vi.fn(async () => {
    throw new Error("not configured");
  }),
  cancelSubscription: vi.fn(async () => {
    throw new Error("not configured");
  }),
  getTeamSeatUsage: vi.fn(async () => ({
    team_id: "team_1",
    tenant_id: "tenant_1",
    plan_id: "plan_pro",
    seat_limit: 5,
    active_seats: 3,
    invited_seats: 0,
    billable_seats: 3,
    available_seats: 2
  })),
  checkTeamSeatEntitlement: vi.fn(async () => ({
    allowed: true,
    reason: "ok" as const,
    usage: {
      team_id: "team_1",
      tenant_id: "tenant_1",
      plan_id: "plan_pro",
      seat_limit: 5,
      active_seats: 3,
      invited_seats: 0,
      billable_seats: 3,
      available_seats: 2
    }
  })),
  acceptTeamInvite: vi.fn(async () => ({
    id: "member_3",
    team_id: "team_1",
    tenant_id: "tenant_1",
    user_id: "user-dev-001",
    email: "teammate@example.com",
    role: "member" as const,
    status: "active" as const,
    created_at: "2026-06-21T10:00:00Z",
    updated_at: "2026-06-21T10:05:00Z"
  })),
  ...overrides
});

const createBatchClientMock = (overrides = {}) => ({
  getBatchGeneration: vi.fn(async () => {
    throw new Error("not configured");
  }),
  listBatchGenerationChildren: vi.fn(async () => {
    throw new Error("not configured");
  }),
  getBatchGenerationProgress: vi.fn(async () => {
    throw new Error("not configured");
  }),
  ...overrides
});

const createAssetLibraryClientMock = (overrides = {}) => ({
  listAssetLibrary: vi.fn(async () => ({
    items: [
      {
        id: "library_entry_api_1",
        asset: {
          id: "asset_api_1",
          asset_type: "generated_image",
          status: "active",
          storage_ref: {
            object_key: "tenants/tenant_1/assets/api-hero.png"
          },
          thumbnail_ref: {
            object_key: "tenants/tenant_1/assets/api-hero-thumb.png"
          },
          lineage: {
            source: {
              kind: "batch_child_provider_result",
              trace_id: "trace_api_1"
            }
          },
          created_at: "2026-06-22T10:00:00Z"
        },
        visibility: "tenant" as const,
        favorite: true,
        archived: false,
        reusable: true,
        allowed_projects: ["project-001"],
        tags: ["approved", "hero"],
        created_at: "2026-06-22T10:00:00Z",
        updated_at: "2026-06-22T10:01:00Z"
      }
    ]
  })),
  listBrandKits: vi.fn(async () => ({
    items: [
      {
        id: "brand_kit_api_1",
        name: "Aurora API",
        status: "active" as const,
        logos: [{ asset_id: "asset_logo_api_1", object_metadata_id: "object_logo_api_1", usage: "primary" }],
        palette: [{ name: "Ink", hex: "#111827", role: "primary" }],
        fonts: [{ family: "Inter", asset_id: "asset_font_api_1", role: "body" }],
        guidelines: [{ id: "guideline_api_1", title: "Logo", body: "Keep logo clear.", severity: "required" }],
        source_refs: [{ kind: "asset_library", asset_id: "asset_logo_api_1", trace_id: "trace_logo_api_1" }],
        project_bindings: [{ project_id: "project-001", default: true }],
        created_at: "2026-06-22T10:00:00Z",
        updated_at: "2026-06-22T10:01:00Z"
      }
    ]
  })),
  getProjectDefaultBrandKit: vi.fn(async () => ({
    id: "brand_kit_api_1",
    name: "Aurora API",
    status: "active" as const,
    logos: [{ asset_id: "asset_logo_api_1", object_metadata_id: "object_logo_api_1", usage: "primary" }],
    palette: [{ name: "Ink", hex: "#111827", role: "primary" }],
    fonts: [{ family: "Inter", asset_id: "asset_font_api_1", role: "body" }],
    guidelines: [{ id: "guideline_api_1", title: "Logo", body: "Keep logo clear.", severity: "required" }],
    source_refs: [{ kind: "asset_library", asset_id: "asset_logo_api_1", trace_id: "trace_logo_api_1" }],
    project_bindings: [{ project_id: "project-001", default: true }],
    created_at: "2026-06-22T10:00:00Z",
    updated_at: "2026-06-22T10:01:00Z"
  })),
  createAssetLibraryEntry: vi.fn(async () => ({
    id: "library_entry_api_created",
    asset: {
      id: "asset_api_created",
      asset_type: "generated_image",
      status: "active",
      storage_ref: { object_key: "tenants/tenant_1/assets/created.png" },
      lineage: { source: { kind: "canvas_selection", trace_id: "trace_api_created" } },
      created_at: "2026-06-22T10:02:00Z"
    },
    visibility: "project" as const,
    favorite: false,
    archived: false,
    reusable: true,
    allowed_projects: ["project-001"],
    tags: ["canvas"],
    created_at: "2026-06-22T10:02:00Z",
    updated_at: "2026-06-22T10:02:00Z"
  })),
  updateAssetLibraryEntry: vi.fn(async () => ({
    id: "library_entry_api_1",
    asset: {
      id: "asset_api_1",
      asset_type: "generated_image",
      status: "active",
      storage_ref: { object_key: "tenants/tenant_1/assets/api-hero.png" },
      lineage: { source: { kind: "batch_child_provider_result", trace_id: "trace_api_1" } },
      created_at: "2026-06-22T10:00:00Z"
    },
    visibility: "tenant" as const,
    favorite: false,
    archived: false,
    reusable: true,
    allowed_projects: ["project-001"],
    tags: ["approved", "hero"],
    created_at: "2026-06-22T10:00:00Z",
    updated_at: "2026-06-22T10:03:00Z"
  })),
  createBrandKit: vi.fn(async () => ({
    id: "brand_kit_api_created",
    name: "Created Brand Kit",
    status: "active" as const,
    logos: [{ asset_id: "asset_api_1", usage: "primary" }],
    palette: [{ name: "Ink", hex: "#111827", role: "primary" }],
    fonts: [{ family: "Inter", role: "body" }],
    guidelines: [{ id: "guideline_created", title: "Logo", body: "Keep logo clear.", severity: "required" }],
    source_refs: [{ kind: "asset_library", asset_id: "asset_api_1", trace_id: "trace_api_1" }],
    project_bindings: [{ project_id: "project-001", default: true }],
    created_at: "2026-06-22T10:04:00Z",
    updated_at: "2026-06-22T10:04:00Z"
  })),
  updateBrandKit: vi.fn(async () => ({
    id: "brand_kit_api_1",
    name: "Aurora API",
    status: "active" as const,
    logos: [{ asset_id: "asset_logo_api_1", object_metadata_id: "object_logo_api_1", usage: "primary" }],
    palette: [{ name: "Ink", hex: "#111827", role: "primary" }],
    fonts: [{ family: "Inter", asset_id: "asset_font_api_1", role: "body" }],
    guidelines: [{ id: "guideline_api_1", title: "Logo", body: "Keep logo clear.", severity: "required" }],
    source_refs: [{ kind: "asset_library", asset_id: "asset_logo_api_1", trace_id: "trace_logo_api_1" }],
    project_bindings: [{ project_id: "project-001", default: true }],
    created_at: "2026-06-22T10:00:00Z",
    updated_at: "2026-06-22T10:05:00Z"
  })),
  setProjectDefaultBrandKit: vi.fn(async () => ({
    id: "brand_kit_api_1",
    name: "Aurora API",
    status: "active" as const,
    logos: [{ asset_id: "asset_logo_api_1", object_metadata_id: "object_logo_api_1", usage: "primary" }],
    palette: [{ name: "Ink", hex: "#111827", role: "primary" }],
    fonts: [{ family: "Inter", asset_id: "asset_font_api_1", role: "body" }],
    guidelines: [{ id: "guideline_api_1", title: "Logo", body: "Keep logo clear.", severity: "required" }],
    source_refs: [{ kind: "asset_library", asset_id: "asset_logo_api_1", trace_id: "trace_logo_api_1" }],
    project_bindings: [{ project_id: "project-001", default: true }],
    created_at: "2026-06-22T10:00:00Z",
    updated_at: "2026-06-22T10:06:00Z"
  })),
  ...overrides
});

describe("dev web client user lifecycle coverage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists account settings across workspace reloads", async () => {
    const client = makeClient();
    const initial = await client.loadWorkspace();

    const saved = await client.updateAccount({
      ...initial.account,
      brandName: "Acme Launch Studio",
      defaultExportFormat: "pdf-placeholder",
      emailNotifications: false
    });
    const reloaded = await client.loadWorkspace();

    expect(saved.session.email).toBe("dev@zenari.ai");
    expect(reloaded.account).toEqual({
      brandName: "Acme Launch Studio",
      defaultExportFormat: "pdf-placeholder",
      emailNotifications: false
    });
    expect(window.localStorage.getItem(workspaceStorageKey)).toContain("Acme Launch Studio");
  });

  it("runs login, refresh, expired-session handling, and logout states", async () => {
    const client = makeClient();

    const loggedIn = await client.login("member@example.com");
    const refreshed = await client.refreshSession();
    const expired = await client.expireSession();
    const refreshWhileExpired = await client.refreshSession();
    const signedOut = await client.logout();
    const reloaded = await client.loadWorkspace();

    expect(loggedIn.session).toMatchObject({
      email: "member@example.com",
      name: "member"
    });
    expect(loggedIn.sessionContract).toMatchObject({
      status: "authenticated",
      cookie: {
        httpOnly: true,
        secure: true,
        sameSite: "lax"
      },
      csrf: {
        strategy: "same-site-origin-check",
        headerName: "X-Zenari-CSRF",
        headerValue: "same-site-origin-check",
        credentialMode: "include",
        originPolicy: "same-site-only",
        protectedMethods: ["POST", "PUT", "PATCH", "DELETE"]
      }
    });
    expect(new Date(refreshed.sessionContract.issuedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(loggedIn.sessionContract.issuedAt).getTime()
    );
    expect(expired.sessionContract.status).toBe("expired");
    expect(refreshWhileExpired.sessionContract.status).toBe("authenticated");
    expect(new Date(refreshWhileExpired.sessionContract.issuedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(expired.sessionContract.issuedAt).getTime()
    );
    expect(signedOut.sessionContract.status).toBe("signed_out");
    expect(reloaded.sessionContract.status).toBe("signed_out");
  });

  it("autosaves project workspace selection, canvas versions, and package history", async () => {
    const client = makeClient();
    const initial = await client.loadWorkspace();

    const selected = await client.selectCandidate("cand-studio");
    const iterated = await client.iterateSelected("Make the production handoff states more explicit.");
    const packaged = await client.addPackageItem("cand-studio");
    const reloaded = await client.loadWorkspace();

    expect(selected.activeProjectId).toBe(initial.activeProjectId);
    expect(selected.selectedCandidateId).toBe("cand-studio");
    expect(selected.canvas.nodes.find((node) => node.id === "node-cand-studio")).toMatchObject({
      title: "Studio System",
      kind: "candidate",
      width: 230,
      height: 118,
      locked: false,
      hidden: false
    });
    expect(selected.canvas.interaction).toMatchObject({
      contract: "stage1.canvas-interaction-user-contract",
      selectedNodeIds: ["node-cand-studio"],
      lastAction: "select"
    });
    expect(iterated.canvas.nodes.some((node) => node.kind === "iteration")).toBe(true);
    expect(iterated.canvas.versions.at(-1)?.label).toBe("Canvas iteration");
    expect(packaged.packageItems).toHaveLength(1);
    expect(reloaded.selectedCandidateId).toBe("cand-studio");
    expect(reloaded.packageItems[0]).toMatchObject({
      sourceId: "cand-studio",
      title: "Studio System",
      type: "candidate"
    });
  });

  it("tracks Stage 1 canvas toolbar, layers, zoom, drag, and keyboard interactions locally", async () => {
    const client = makeClient();

    await client.selectCandidate("cand-studio");
    const selected = await client.selectCanvasNode("node-cand-studio");
    const moved = await client.moveCanvasNode("node-cand-studio", { x: 24, y: 18 });
    const zoomed = await client.setCanvasZoom(1.35);
    const fit = await client.fitCanvasToView();
    const handTool = await client.setCanvasTool("hand");
    const locked = await client.toggleCanvasNodeLocked("node-cand-studio");
    const hidden = await client.toggleCanvasNodeHidden("node-cand-studio");
    const shown = await client.toggleCanvasNodeHidden("node-cand-studio");
    const unlocked = await client.toggleCanvasNodeLocked("node-cand-studio");
    const duplicated = await client.duplicateSelectedCanvasNodes();
    const deleted = await client.deleteSelectedCanvasNodes();

    expect(selected.canvas.interaction).toMatchObject({
      contract: "stage1.canvas-interaction-user-contract",
      selectedNodeIds: ["node-cand-studio"],
      lastAction: "select"
    });
    expect(moved.canvas.nodes.find((node) => node.id === "node-cand-studio")).toMatchObject({
      x: 384,
      y: 198
    });
    expect(moved.canvas.versions.at(-1)?.label).toBe("Canvas move");
    expect(zoomed.canvas.interaction.zoom).toBe(1.35);
    expect(fit.canvas.interaction).toMatchObject({
      zoom: 1,
      pan: { x: 0, y: 0 },
      lastAction: "fit"
    });
    expect(handTool.canvas.interaction.tool).toBe("hand");
    expect(locked.canvas.nodes.find((node) => node.id === "node-cand-studio")?.locked).toBe(true);
    expect(hidden.canvas.nodes.find((node) => node.id === "node-cand-studio")?.hidden).toBe(true);
    expect(shown.canvas.nodes.find((node) => node.id === "node-cand-studio")?.hidden).toBe(false);
    expect(unlocked.canvas.nodes.find((node) => node.id === "node-cand-studio")?.locked).toBe(false);
    expect(duplicated.canvas.nodes.some((node) => node.id.startsWith("node-cand-studio-copy-"))).toBe(true);
    expect(duplicated.canvas.versions.at(-1)?.label).toBe("Canvas duplicate");
    expect(deleted.canvas.nodes.some((node) => node.id.startsWith("node-cand-studio-copy-"))).toBe(false);
    expect(deleted.canvas.versions.at(-1)?.label).toBe("Canvas delete");
  });

  it("restores canvas version snapshots while preserving later unversioned objects", async () => {
    const client = makeClient();

    const selected = await client.selectCandidate("cand-studio");
    const selectedVersionId = selected.canvas.activeVersionId;
    const moved = await client.moveCanvasNode("node-cand-studio", { x: 24, y: 18 });
    await client.selectCandidate("cand-utility");
    const restored = await client.restoreCanvasVersion(selectedVersionId);

    expect(selected.canvas.versions.find((version) => version.id === selectedVersionId)).toMatchObject({
      label: "Selected Studio System",
      snapshot: {
        nodes: expect.arrayContaining([expect.objectContaining({ id: "node-cand-studio", x: 360, y: 180 })])
      },
      diff: expect.objectContaining({
        addedNodeIds: ["node-cand-studio"]
      })
    });
    expect(moved.canvas.nodes.find((node) => node.id === "node-cand-studio")).toMatchObject({
      x: 384,
      y: 198
    });
    expect(restored.canvas.nodes.find((node) => node.id === "node-cand-studio")).toMatchObject({
      x: 360,
      y: 180
    });
    expect(restored.canvas.nodes.find((node) => node.id === "node-cand-utility")).toBeTruthy();
    expect(restored.canvas.versions.find((version) => version.id === selectedVersionId)?.restorePreview).toMatchObject({
      restoresNodeIds: ["node-brief", "node-cand-studio"],
      preservesNodeIds: ["node-cand-utility"],
      conflictNodeIds: []
    });
    expect(restored.canvas.interaction).toMatchObject({
      selectedNodeIds: ["node-brief"],
      lastAction: "undo"
    });
  });

  it("applies local edit tools with aligned masks and derived asset revisions", async () => {
    const client = makeClient();

    await client.selectCandidate("cand-studio");
    const tool = await client.setEditTool("erase");
    const masked = await client.updateEditMask({ kind: "rect", coveragePct: 0.24 });
    const edited = await client.applyEditTool();

    expect(tool.editTools.activeTool).toBe("erase");
    expect(masked.editTools.mask).toMatchObject({
      kind: "rect",
      width: 1024,
      height: 768,
      coveragePct: 0.24
    });
    expect(edited.editTools.revisions[0]).toMatchObject({
      id: "edit-revision-001",
      sourceAssetId: "asset_hero_1",
      derivedAssetId: "asset-edit-001",
      tool: "erase",
      providerRequestRequired: true,
      originalAssetRetained: true,
      mask: expect.objectContaining({
        width: 1024,
        height: 768,
        kind: "rect"
      }),
      lineage: expect.objectContaining({
        originalAssetId: "asset_hero_1",
        derivedFromAssetId: "asset_hero_1",
        toolType: "erase",
        rawPayloadPersisted: false
      })
    });
    expect(edited.canvas.nodes.find((node) => node.id === "node-edit-001")).toMatchObject({
      kind: "iteration",
      title: expect.stringContaining("erase")
    });
    expect(edited.assetLibrary.items.find((item) => item.assetId === "asset-edit-001")).toMatchObject({
      lineageKind: "edit_tool_revision",
      reusable: true
    });
    expect(edited.billing.quotaUsed).toBe(12);
  });

  it("passes the ecommerce growth pack API smoke from brief to ready ZIP export", async () => {
    const client = makeClient();
    const fixtureBrief =
      "Create a launch ad pack for the Aurora insulated bottle using the supplied packshot, targeting outdoor commuters on web and social.";

    const briefed = await client.confirmBrief(fixtureBrief);
    const referenced = await client.attachReference({ name: "aurora-bottle-packshot.png", kind: "image" });

    expect(briefed.brief).toMatchObject({
      prompt: fixtureBrief,
      confirmed: true,
      missingInfo: []
    });
    expect(referenced.brief.references.at(-1)).toMatchObject({
      name: "aurora-bottle-packshot.png",
      status: "attached",
      validation: {
        state: "accepted"
      }
    });

    const candidates = (await client.loadWorkspace()).candidates;
    expect(candidates).toHaveLength(4);
    expect(new Set(candidates.map((candidate) => candidate.workflowId))).toEqual(
      new Set([ecommerceGrowthWorkflowAcceptance.workflow_id])
    );
    expect(candidates.map((candidate) => candidate.strategyTaxonomy)).toEqual(
      ecommerceGrowthWorkflowAcceptance.strategy_taxonomy
    );

    await client.selectCandidate("cand-editorial");
    await client.iterateSelected("Adapt the ecommerce outputs for marketplace, square social, story, and web hero placements.");

    for (const candidate of candidates) {
      await client.addPackageItem(candidate.id);
    }

    const exported = await client.createExport("zip");
    const latestExport = exported.exports[0];

    expect(exported.packageItems.map((item) => item.strategyTaxonomy)).toEqual(
      ecommerceGrowthWorkflowAcceptance.strategy_taxonomy
    );
    expect(latestExport).toMatchObject({
      format: "zip",
      status: "ready",
      fileName: "zenari-001.zip",
      manifest: {
        workflow_acceptance: {
          schema_version: "stage0.rev2.workflow-api-smoke",
          workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
          fixture_id: ecommerceGrowthWorkflowAcceptance.fixture_id,
          strategy_taxonomy: ecommerceGrowthWorkflowAcceptance.strategy_taxonomy,
          required_files: ecommerceGrowthWorkflowAcceptance.required_files,
          export_target: "zip_delivery"
        },
        required_outputs: expect.arrayContaining([...ecommerceGrowthWorkflowAcceptance.required_files])
      },
      qaReport: expect.arrayContaining([
        expect.objectContaining({
          id: "qa-ecommerce-growth-taxonomy",
          severity: "pass"
        })
      ]),
      safetyReport: {
        status: "pass",
        enforcementStages: ["brief", "provider_request", "provider_response", "qa", "export"]
      }
    });
    expect(latestExport.manifest.items).toHaveLength(4);
    expect(latestExport.manifest.items.every((item) => item.provenance.startsWith("dev-client:"))).toBe(true);
  });

  it("records report-problem tickets with project, export, and quota context", async () => {
    const client = makeClient();
    await client.attachReference({ name: "product-angle.webp", kind: "image" });
    await client.selectCandidate("cand-utility");
    await client.addPackageItem("cand-utility");
    const exported = await client.createExport("zip");

    const ticketed = await client.reportProblem({
      category: "export",
      body: "The downloaded package is missing the social crop.",
      linkedExportId: exported.exports[0]?.id
    });

    expect(ticketed.supportTickets).toHaveLength(1);
    expect(ticketed.supportTickets[0]).toMatchObject({
      id: "ticket-001",
      projectId: ticketed.activeProjectId,
      projectName: "Launch Direction Board",
      category: "export",
      status: "open",
      linkedExportId: exported.exports[0]?.id,
      linkedTaskId: "task-cand-utility",
      linkedTraceId: `trace-${exported.exports[0]?.id}`,
      linkedAssetIds: ["ref-001", "ref-product-angle-webp"],
      linkedQuotaSnapshot: {
        used: exported.billing.quotaUsed,
        limit: exported.billing.quotaLimit,
        remaining: exported.billing.quotaLimit - exported.billing.quotaUsed,
        status: exported.billing.status,
        resetAt: exported.billing.resetAt
      }
    });
  });

  it("validates reference uploads and keeps rejected assets visible but not support-linked", async () => {
    const client = makeClient();

    const rejected = await client.attachReference({ name: "campaign.exe", kind: "image" });
    const acceptedUrl = await client.attachReference({ name: "https://example.com/brief", kind: "url" });
    const ticketed = await client.reportProblem({
      category: "quality",
      body: "Reference validation should be visible.",
      linkedExportId: undefined
    });

    expect(rejected.brief.references.at(-1)).toMatchObject({
      name: "campaign.exe",
      status: "queued",
      validation: {
        state: "rejected",
        reason: "Images must be PNG, JPG, JPEG, or WEBP files."
      }
    });
    expect(acceptedUrl.brief.references.at(-1)).toMatchObject({
      name: "https://example.com/brief",
      status: "attached",
      validation: {
        state: "accepted"
      }
    });
    expect(ticketed.supportTickets[0].linkedAssetIds).toEqual(["ref-001", "ref-https-example-com-brief"]);
  });

  it("packages accepted references into ready ZIP export manifest and PPT metadata", async () => {
    const client = makeClient();

    const accepted = await client.attachReference({ name: "visual-style.pdf", kind: "document" });
    const rejected = await client.attachReference({ name: "ftp://example.com/reference", kind: "url" });
    const packaged = await client.addPackageItem("ref-visual-style-pdf");
    const blockedReferencePackage = await client.addPackageItem("ref-ftp-example-com-reference");
    const exported = await client.createExport("zip");

    expect(accepted.brief.references.at(-1)).toMatchObject({
      id: "ref-visual-style-pdf",
      status: "attached",
      upload: {
        operationId: "createUpload",
        method: "POST",
        path: "/uploads",
        credentialMode: "include",
        csrfHeaderName: "X-Zenari-CSRF",
        idempotencyRequired: true,
        previewUrl: "/dev-preview/uploads/ref-visual-style-pdf",
        previewScope: "tenant-scoped-dev-preview"
      },
      validation: {
        state: "accepted"
      }
    });
    expect(rejected.brief.references.at(-1)).toMatchObject({
      id: "ref-ftp-example-com-reference",
      status: "queued",
      upload: {
        operationId: "createUpload",
        method: "POST",
        path: "/uploads",
        credentialMode: "include",
        csrfHeaderName: "X-Zenari-CSRF",
        idempotencyRequired: true,
        previewScope: "tenant-scoped-dev-preview"
      },
      validation: {
        state: "rejected",
        reason: "Reference URLs must use HTTPS."
      }
    });
    expect(packaged.packageItems).toEqual([
      {
        id: "pkg-item-001",
        sourceId: "ref-visual-style-pdf",
        title: "visual-style.pdf",
        type: "reference",
        addedAt: expect.any(String)
      }
    ]);
    expect(blockedReferencePackage.packageItems).toEqual(packaged.packageItems);
    expect(exported.exports[0]).toMatchObject({
      status: "ready",
      safetyReport: {
        schema_version: "stage0.rev2.safety-policy-export",
        status: "pass",
        enforcementStages: ["brief", "provider_request", "provider_response", "qa", "export"],
        findings: []
      },
      manifest: {
        items: [
          {
            id: "pkg-item-001",
            title: "visual-style.pdf",
            type: "reference",
            provenance: "dev-client-reference:ref-visual-style-pdf"
          }
        ],
        ppt_ready_metadata: {
          slides: [
            {
              source_item_id: "pkg-item-001",
              title: "visual-style.pdf",
              layout: "asset-grid"
            }
          ]
        }
      }
    });
  });

  it("models billing quota states without charging blocked exports", async () => {
    const billingClient = createBillingClientMock({
      createCheckoutSession: vi.fn(async () => ({
        id: "cs_test_001",
        tenant_id: "tenant-dev-001",
        user_id: "user-dev-001",
        provider: "stripe",
        redirect_url: "https://checkout.stripe.test/cs_test_001",
        created_at: "2026-06-21T10:00:00Z"
      })),
      createPortalSession: vi.fn(async () => ({
        id: "bps_test_001",
        tenant_id: "tenant-dev-001",
        user_id: "user-dev-001",
        provider: "stripe",
        redirect_url: "https://billing.stripe.test/session/bps_test_001",
        created_at: "2026-06-21T10:01:00Z"
      })),
      cancelSubscription: vi.fn(async () => ({
        id: "sub_test_001",
        provider: "stripe",
        status: "active",
        cancel_at_period_end: true,
        current_period_end: "2026-07-01T00:00:00Z",
        updated_at: "2026-06-21T10:02:00Z"
      }))
    });
    const client = new DevZenariClient(billingClient);
    const initial = await client.loadWorkspace();

    const blockedExport = await client.createExport("zip");
    const checkedOut = await client.createMockCheckout();

    expect(blockedExport.exports[0]).toMatchObject({
      status: "blocked",
      fileName: "zenari-001.zip",
      manifest: {
        required_outputs: expect.arrayContaining(["ppt-ready-metadata.json"]),
        ppt_ready_metadata: {
          schema_version: "stage0.rev2.ppt-ready-metadata",
          aspect_ratio: "16:9"
        }
      }
    });
    expect(blockedExport.billing.quotaUsed).toBe(initial.billing.quotaUsed);
    expect(billingClient.createCheckoutSession).toHaveBeenCalledWith(
      { plan_id: "plan_pro" },
      "checkout-user-dev-001-plan_pro"
    );
    expect(checkedOut.billing).toMatchObject({
      status: "active",
      quotaLimit: 80,
      renewalMode: "provider",
      checkoutSessionId: "cs_test_001",
      checkoutProvider: "stripe",
      checkoutRedirectUrl: "https://checkout.stripe.test/cs_test_001",
      checkoutCreatedAt: "2026-06-21T10:00:00Z"
    });
  });

  it("stores billing portal and cancellation projections from the billing API", async () => {
    const billingClient = createBillingClientMock({
      createCheckoutSession: vi.fn(async () => {
        throw new Error("not used");
      }),
      createPortalSession: vi.fn(async () => ({
        id: "bps_test_001",
        tenant_id: "tenant-dev-001",
        user_id: "user-dev-001",
        provider: "stripe",
        redirect_url: "https://billing.stripe.test/session/bps_test_001",
        created_at: "2026-06-21T10:01:00Z"
      })),
      cancelSubscription: vi.fn(async () => ({
        id: "sub_test_001",
        provider: "stripe",
        status: "active",
        cancel_at_period_end: true,
        current_period_end: "2026-07-01T00:00:00Z",
        updated_at: "2026-06-21T10:02:00Z"
      }))
    });
    const client = new DevZenariClient(billingClient);

    const portal = await client.createBillingPortalSession();
    const cancelled = await client.cancelSubscription();

    expect(billingClient.createPortalSession).toHaveBeenCalledWith("portal-user-dev-001");
    expect(portal.billing).toMatchObject({
      portalSessionId: "bps_test_001",
      portalRedirectUrl: "https://billing.stripe.test/session/bps_test_001"
    });
    expect(billingClient.cancelSubscription).toHaveBeenCalledWith("cancel-user-dev-001");
    expect(cancelled.billing).toMatchObject({
      cancellationStatus: "active",
      cancelAtPeriodEnd: true,
      cancellationUpdatedAt: "2026-06-21T10:02:00Z"
    });
  });

  it("refreshes invoice and receipt links through the billing API", async () => {
    const billingClient = createBillingClientMock({
      listInvoices: vi.fn(async () => ({
        items: [
          {
            id: "in_test_001",
            provider: "stripe",
            status: "paid",
            currency: "USD",
            amount_due_cents: 2900,
            amount_paid_cents: 2900,
            invoice_url: "https://invoice.stripe.test/in_test_001",
            receipt_url: "https://invoice.stripe.test/in_test_001.pdf",
            created_at: "2026-06-21T10:00:00Z"
          }
        ]
      }))
    });
    const client = new DevZenariClient(billingClient);

    const refreshed = await client.refreshBillingInvoices();

    expect(billingClient.listInvoices).toHaveBeenCalledOnce();
    expect(refreshed.billing.invoiceSyncStatus).toBe("api");
    expect(refreshed.billing.invoices).toMatchObject([
      {
        id: "in_test_001",
        provider: "stripe",
        status: "paid",
        amountPaidCents: 2900,
        invoiceUrl: "https://invoice.stripe.test/in_test_001",
        receiptUrl: "https://invoice.stripe.test/in_test_001.pdf"
      }
    ]);
  });

  it("keeps a local checkout fallback when the billing API is unavailable", async () => {
    const billingClient = createBillingClientMock({
      createCheckoutSession: vi.fn(async () => {
        throw new Error("billing unavailable");
      }),
      createPortalSession: vi.fn(async () => {
        throw new Error("billing unavailable");
      }),
      cancelSubscription: vi.fn(async () => {
        throw new Error("billing unavailable");
      })
    });
    const client = new DevZenariClient(billingClient);

    const checkedOut = await client.createMockCheckout();

    expect(checkedOut.billing).toMatchObject({
      status: "active",
      quotaLimit: 80,
      renewalMode: "mock-checkout"
    });
    expect(checkedOut.billing.checkoutSessionId).toBeUndefined();
  });

  it("refreshes team seat usage and accepts pending invites through the billing API", async () => {
    const billingClient = createBillingClientMock();
    const client = new DevZenariClient(billingClient);

    const refreshed = await client.refreshTeamSeats();
    const accepted = await client.acceptTeamInvite();

    expect(billingClient.getTeamSeatUsage).toHaveBeenCalledWith("team_1");
    expect(billingClient.checkTeamSeatEntitlement).toHaveBeenCalledWith("team_1", 1);
    expect(billingClient.acceptTeamInvite).toHaveBeenCalledWith(
      "team_1",
      "invite_1",
      "team-invite-accept-user-dev-001-invite_1"
    );
    expect(refreshed.teamSeats).toMatchObject({
      usage: {
        teamId: "team_1",
        activeSeats: 3,
        invitedSeats: 0,
        billableSeats: 3,
        availableSeats: 2
      },
      entitlement: {
        allowed: true,
        reason: "ok",
        additionalSeats: 1
      },
      billingProjection: {
        provider: "stripe",
        prorationBehavior: "create_prorations",
        invoiceImpact: "prorated_on_next_invoice",
        nextBillableSeats: 3,
        syncStatus: "api",
        auditEvent: "team.seat.refresh",
        safeProjection: true
      },
      lastSyncStatus: "api"
    });
    expect(accepted.teamSeats.pendingInvite).toMatchObject({
      inviteId: "invite_1",
      status: "accepted",
      acceptedAt: "2026-06-21T10:05:00Z"
    });
    expect(accepted.teamSeats.billingProjection).toMatchObject({
      nextBillableSeats: 3,
      syncStatus: "api",
      auditEvent: "team.invite.accept",
      safeProjection: true
    });
    expect(accepted.teamSeats.lastAcceptedInviteId).toBe("invite_1");
  });

  it("refreshes asset library and Brand Kit picker data through the read API", async () => {
    const assetLibraryClient = createAssetLibraryClientMock();
    const client = new DevZenariClient(createBillingClientMock(), createBatchClientMock(), assetLibraryClient);

    const refreshed = await client.refreshAssetLibrary();

    expect(assetLibraryClient.listAssetLibrary).toHaveBeenCalledWith("project-001", "active");
    expect(assetLibraryClient.listBrandKits).toHaveBeenCalledWith("project-001", "active");
    expect(assetLibraryClient.getProjectDefaultBrandKit).toHaveBeenCalledWith("project-001");
    expect(refreshed.assetLibrary).toMatchObject({
      syncStatus: "api",
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
      items: [
        expect.objectContaining({
          id: "library_entry_api_1",
          assetId: "asset_api_1",
          visibility: "tenant",
          reusable: true,
          lineageKind: "batch_child_provider_result",
          traceId: "trace_api_1"
        })
      ],
      defaultBrandKit: expect.objectContaining({
        id: "brand_kit_api_1",
        name: "Aurora API",
        status: "active"
      })
    });
  });

  it("packages reusable asset library entries as local references without replacing write API coverage", async () => {
    const client = new DevZenariClient(createBillingClientMock(), createBatchClientMock(), createAssetLibraryClientMock());
    const initial = await client.loadWorkspace();

    const packaged = await client.packageAssetLibraryItem("library_entry_1");
    const duplicate = await client.packageAssetLibraryItem("library_entry_1");

    expect(packaged.packageItems).toHaveLength(initial.packageItems.length + 1);
    expect(packaged.packageItems.at(-1)).toMatchObject({
      sourceId: "asset-library:asset_hero_1",
      title: "Launch hero generated image",
      type: "reference"
    });
    expect(packaged.assetLibrary.packagedAssetIds).toContain("asset_hero_1");
    expect(duplicate.packageItems).toHaveLength(packaged.packageItems.length);
  });

  it("writes asset library and Brand Kit product actions through idempotent APIs", async () => {
    const assetLibraryClient = createAssetLibraryClientMock();
    const client = new DevZenariClient(createBillingClientMock(), createBatchClientMock(), assetLibraryClient);

    await client.createAssetLibraryEntryFromSelection();
    await client.toggleAssetLibraryFavorite("library_entry_api_1");
    await client.archiveAssetLibraryEntry("library_entry_api_1");
    await client.createBrandKitFromLogoAsset("library_entry_api_1");
    await client.updateBrandKitGuidelines("brand_kit_api_1");
    await client.setDefaultBrandKit("brand_kit_api_1");

    expect(assetLibraryClient.createAssetLibraryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "project-001",
        visibility: "project",
        reusable: true
      }),
      expect.stringContaining("asset-library-create-")
    );
    expect(assetLibraryClient.updateAssetLibraryEntry).toHaveBeenCalledWith(
      "library_entry_api_1",
      { favorite: false },
      "asset-library-favorite-library_entry_api_1-false"
    );
    expect(assetLibraryClient.updateAssetLibraryEntry).toHaveBeenCalledWith(
      "library_entry_api_1",
      { archived: true, favorite: false },
      "asset-library-archive-library_entry_api_1"
    );
    expect(assetLibraryClient.createBrandKit).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
        logos: [expect.objectContaining({ asset_id: "asset_api_1" })],
        project_bindings: [{ project_id: "project-001", default: true }]
      }),
      "brand-kit-create-user-dev-001-asset_api_1"
    );
    expect(assetLibraryClient.updateBrandKit).toHaveBeenCalledWith(
      "brand_kit_api_1",
      expect.objectContaining({
        guidelines: expect.arrayContaining([
          expect.objectContaining({
            id: "guideline-update-brand_kit_api_1",
            severity: "recommended"
          })
        ])
      }),
      "brand-kit-update-brand_kit_api_1"
    );
    expect(assetLibraryClient.setProjectDefaultBrandKit).toHaveBeenCalledWith(
      "project-001",
      "brand_kit_api_1",
      "brand-kit-default-project-001-brand_kit_api_1"
    );
  });

  it("refreshes batch progress, children, and result ids through the batch API", async () => {
    const batchClient = createBatchClientMock({
      getBatchGeneration: vi.fn(async () => ({
        id: "batch-001",
        tenant_id: "tenant-dev-001",
        user_id: "user-dev-001",
        project_id: "project-001",
        workspace_id: "workspace-001",
        prompt_context: {
          text: "Generate four paid launch image variants."
        },
        requested_count: 4,
        quota_reservation_id: "quota_reservation_batch_001",
        quota_estimated_units: 16,
        quota_committed_units: 8,
        quota_refunded_units: 4,
        trace_id: "trace-batch-001",
        status: "partial_succeeded" as const,
        children: [],
        created_at: "2026-06-21T10:00:00Z",
        updated_at: "2026-06-21T10:03:00Z"
      })),
      getBatchGenerationProgress: vi.fn(async () => ({
        batch_id: "batch-001",
        status: "partial_succeeded" as const,
        requested_count: 4,
        queued: 0,
        running: 0,
        succeeded: 2,
        failed: 1,
        cancelled: 1,
        blocked: 0,
        retryable: 1
      })),
      listBatchGenerationChildren: vi.fn(async () => ({
        items: [
          {
            id: "child-001-01",
            batch_id: "batch-001",
            tenant_id: "tenant-dev-001",
            status: "succeeded" as const,
            provider_id: "zenari-image-sandbox",
            model_id: "image-fast-v1",
            tool_type: "image.generate",
            seed: "batch-001-001",
            retry_count: 0,
            max_retries: 2,
            quota_estimate_units: 4,
            quota_committed_units: 4,
            quota_refunded_units: 0,
            asset_id: "asset-batch-001-01",
            canvas_object_id: "canvas-batch-001-01",
            trace_id: "trace-child-001-01",
            visible_trace_ref: "trace_projection_child_001_01",
            created_at: "2026-06-21T10:00:00Z",
            updated_at: "2026-06-21T10:02:00Z"
          },
          {
            id: "child-001-02",
            batch_id: "batch-001",
            tenant_id: "tenant-dev-001",
            status: "succeeded" as const,
            provider_id: "zenari-image-sandbox",
            model_id: "image-fast-v1",
            tool_type: "image.generate",
            seed: "batch-001-002",
            retry_count: 0,
            max_retries: 2,
            quota_estimate_units: 4,
            quota_committed_units: 4,
            quota_refunded_units: 0,
            asset_id: "asset-batch-001-02",
            canvas_object_id: "canvas-batch-001-02",
            trace_id: "trace-child-001-02",
            visible_trace_ref: "trace_projection_child_001_02",
            created_at: "2026-06-21T10:00:00Z",
            updated_at: "2026-06-21T10:02:00Z"
          },
          {
            id: "child-001-03",
            batch_id: "batch-001",
            tenant_id: "tenant-dev-001",
            status: "failed" as const,
            provider_id: "zenari-image-sandbox",
            model_id: "image-fast-v1",
            tool_type: "image.generate",
            seed: "batch-001-003",
            retry_count: 1,
            max_retries: 2,
            quota_estimate_units: 4,
            quota_committed_units: 0,
            quota_refunded_units: 4,
            trace_id: "trace-child-001-03",
            visible_trace_ref: "trace_projection_child_001_03",
            failure_code: "provider_unavailable",
            failure_message: "Provider timed out.",
            created_at: "2026-06-21T10:00:00Z",
            updated_at: "2026-06-21T10:02:00Z"
          },
          {
            id: "child-001-04",
            batch_id: "batch-001",
            tenant_id: "tenant-dev-001",
            status: "cancelled" as const,
            provider_id: "zenari-image-sandbox",
            model_id: "image-fast-v1",
            tool_type: "image.generate",
            seed: "batch-001-004",
            retry_count: 0,
            max_retries: 2,
            quota_estimate_units: 4,
            quota_committed_units: 0,
            quota_refunded_units: 4,
            trace_id: "trace-child-001-04",
            visible_trace_ref: "trace_projection_child_001_04",
            created_at: "2026-06-21T10:00:00Z",
            updated_at: "2026-06-21T10:02:00Z"
          }
        ]
      }))
    });
    const client = new DevZenariClient(createBillingClientMock(), batchClient);

    await client.createBatchGeneration(4);
    const refreshed = await client.refreshBatchGenerationProgress("batch-001");

    expect(batchClient.getBatchGeneration).toHaveBeenCalledWith("batch-001");
    expect(batchClient.getBatchGenerationProgress).toHaveBeenCalledWith("batch-001");
    expect(batchClient.listBatchGenerationChildren).toHaveBeenCalledWith("batch-001");
    expect(refreshed.batchGenerations[0]).toMatchObject({
      id: "batch-001",
      status: "partial_succeeded",
      progressPercent: 100,
      succeededCount: 2,
      failedCount: 1,
      cancelledCount: 1,
      retryableCount: 1,
      progressSyncStatus: "api",
      children: expect.arrayContaining([
        expect.objectContaining({
          id: "child-001-01",
          assetId: "asset-batch-001-01",
          canvasObjectId: "canvas-batch-001-01"
        }),
        expect.objectContaining({
          id: "child-001-03",
          status: "failed",
          failureCode: "provider_unavailable"
        })
      ])
    });
    expect(refreshed.canvas.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "canvas-batch-001-01",
          kind: "generated_layer",
          body: "asset-batch-001-01 · trace-child-001-01"
        }),
        expect.objectContaining({
          id: "canvas-batch-001-02",
          kind: "generated_layer",
          body: "asset-batch-001-02 · trace-child-001-02"
        })
      ])
    );
    expect(refreshed.assetLibrary.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetId: "asset-batch-001-01",
          lineageKind: "batch_child_provider_result",
          traceId: "trace-child-001-01"
        }),
        expect.objectContaining({
          assetId: "asset-batch-001-02",
          lineageKind: "batch_child_provider_result",
          traceId: "trace-child-001-02"
        })
      ])
    );
  });

  it("blocks exports when safety policy fails at brief/provider/export enforcement points", async () => {
    const client = makeClient();
    await client.confirmBrief("Campaign visual with phishing and secret key instructions.");
    await client.selectCandidate("cand-studio");
    await client.addPackageItem("cand-studio");

    const exported = await client.createExport("zip");

    expect(exported.exports[0]).toMatchObject({
      status: "blocked",
      safetyReport: {
        status: "block",
        enforcementStages: ["brief", "provider_request", "provider_response", "qa", "export"],
        findings: expect.arrayContaining([
          expect.objectContaining({
            ruleId: "safety-illegal-abuse-v1",
            stage: "brief"
          }),
          expect.objectContaining({
            ruleId: "safety-private-data-v1",
            stage: "brief"
          })
        ])
      }
    });
    expect(exported.billing.quotaUsed).toBe(11);
  });

  it("blocks quota-consuming exports for inactive, past-due, and exhausted billing states", async () => {
    const client = makeClient();
    await client.selectCandidate("cand-studio");
    await client.addPackageItem("cand-studio");

    const pastDue = await client.setBillingScenario("past_due");
    const pastDueExport = await client.createExport("zip");
    const exhausted = await client.setBillingScenario("quota_exhausted");
    const exhaustedExport = await client.createExport("pdf-placeholder");

    expect(pastDueExport.exports[0]).toMatchObject({
      status: "blocked",
      qaReport: expect.arrayContaining([
        expect.objectContaining({
          id: "qa-entitlement",
          title: "Subscription action required"
        })
      ])
    });
    expect(pastDueExport.billing.quotaUsed).toBe(pastDue.billing.quotaUsed);
    expect(exhaustedExport.exports[0]).toMatchObject({
      status: "blocked",
      qaReport: expect.arrayContaining([
        expect.objectContaining({
          id: "qa-entitlement",
          title: "Quota exhausted"
        })
      ])
    });
    expect(exhaustedExport.billing.quotaUsed).toBe(exhausted.billing.quotaUsed);
  });

  it("can reset the persisted dev workspace for isolated smoke runs", async () => {
    const client = makeClient();
    await client.updateAccount({
      brandName: "Temporary Brand",
      defaultExportFormat: "zip",
      emailNotifications: true
    });

    client.resetWorkspace();
    const reset = await client.loadWorkspace();

    expect(reset.account.brandName).toBe("Northstar Studio");
    expect(window.localStorage.getItem(workspaceStorageKey)).toContain("Northstar Studio");
  });
});
