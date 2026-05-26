import { describe, expect, it } from "vitest";
import { ExportRecord } from "./contracts";
import {
  buildManifest,
  buildPackageExportMetadataEvidence,
  buildReferenceUploadIntegrationSmoke,
  buildSupportProblemContext,
  buildWorkspaceRenderingPerformanceSmoke,
  createDisabledShareLink,
  createInitialWorkspace,
  createReferenceAsset,
  createSessionContract,
  ecommerceGrowthWorkflowAcceptance,
  evaluatePackageQa,
  runSafetyPolicy
} from "./dev-state";

describe("dev workspace contracts", () => {
  it("creates four deterministic candidates", () => {
    const state = createInitialWorkspace();

    expect(state.candidates).toHaveLength(4);
    expect(new Set(state.candidates.map((candidate) => candidate.strategy)).size).toBe(4);
    expect(state.candidates.map((candidate) => candidate.strategyTaxonomy)).toEqual(
      ecommerceGrowthWorkflowAcceptance.strategy_taxonomy
    );
  });

  it("blocks empty exports and includes required manifest outputs", () => {
    const state = createInitialWorkspace();
    const qa = evaluatePackageQa([]);
    const manifest = buildManifest(state.activeProjectId, []);

    expect(qa.some((finding) => finding.severity === "block")).toBe(true);
    expect(manifest.required_outputs).toEqual([
      "manifest.json",
      "qa-report.json",
      "safety-policy-report.json",
      "provenance.json",
      "ppt-ready-metadata.json",
      "assets/"
    ]);
    expect(manifest.ppt_ready_metadata).toMatchObject({
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
      slides: [
        {
          id: "slide-01",
          source_item_id: "empty-package",
          layout: "handoff-notes"
        }
      ]
    });
  });

  it("maps package items into PPT-ready slide metadata", () => {
    const state = createInitialWorkspace();
    const manifest = buildManifest(state.activeProjectId, [
      {
        id: "pkg-item-001",
        sourceId: "cand-studio",
        title: "Studio System",
        type: "candidate",
        addedAt: "2026-05-26T10:00:00.000Z"
      }
    ]);

    expect(manifest.ppt_ready_metadata.slides).toEqual([
      {
        id: "slide-01",
        source_item_id: "pkg-item-001",
        title: "Studio System",
        layout: "title-and-asset",
        notes: "candidate exported from cand-studio with safe-area bounds and presenter handoff context."
      }
    ]);
    expect(manifest.ppt_ready_metadata.handoff_checklist).toEqual([
      "16:9 presentation canvas",
      "safe-area bounds",
      "source item mapping",
      "speaker notes",
      "editable theme tokens"
    ]);
  });

  it("builds package/export metadata UI evidence for ready exports", () => {
    const state = createInitialWorkspace();
    const manifest = buildManifest(state.activeProjectId, [
      {
        id: "pkg-item-001",
        sourceId: "cand-studio",
        title: "Studio System",
        type: "candidate",
        addedAt: "2026-05-26T10:00:00.000Z"
      },
      {
        id: "pkg-item-002",
        sourceId: "ref-001",
        title: "brand-moodboard.png",
        type: "reference",
        addedAt: "2026-05-26T10:03:00.000Z"
      }
    ]);
    const qaReport = evaluatePackageQa([
      {
        id: "pkg-item-001",
        sourceId: "cand-studio",
        title: "Studio System",
        type: "candidate",
        addedAt: "2026-05-26T10:00:00.000Z"
      }
    ]);
    const record: ExportRecord = {
      id: "export-001",
      format: "zip",
      status: "ready",
      createdAt: "2026-05-26T10:04:00.000Z",
      fileName: "zenart-001.zip",
      manifest,
      qaReport,
      safetyReport: runSafetyPolicy(state, qaReport)
    };

    expect(buildPackageExportMetadataEvidence(record)).toEqual({
      schema_version: "stage0.rev2.package-export-metadata-ui",
      status: "pass",
      requiredOutputCount: 6,
      missingRequiredOutputs: [],
      itemCount: 2,
      provenanceCount: 2,
      qaFindingCount: 2,
      blockingQaCount: 0,
      pptSlideCount: 2,
      handoffChecklistCount: 5,
      zipPayloadNames: [
        "manifest.json",
        "qa-report.json",
        "safety-policy-report.json",
        "provenance.json",
        "ppt-ready-metadata.json",
        "assets/README.txt"
      ]
    });
  });

  it("fails package/export metadata UI evidence when manifest or QA are incomplete", () => {
    const state = createInitialWorkspace();
    const record: ExportRecord = {
      id: "export-002",
      format: "zip",
      status: "blocked",
      createdAt: "2026-05-26T10:04:00.000Z",
      fileName: "zenart-002.zip",
      manifest: {
        ...buildManifest(state.activeProjectId, []),
        required_outputs: ["manifest.json"]
      },
      qaReport: evaluatePackageQa([]),
      safetyReport: runSafetyPolicy(state, evaluatePackageQa([]))
    };

    expect(buildPackageExportMetadataEvidence(record)).toMatchObject({
      status: "fail",
      missingRequiredOutputs: ["qa-report.json", "safety-policy-report.json", "provenance.json", "ppt-ready-metadata.json", "assets/"],
      itemCount: 0,
      provenanceCount: 0,
      blockingQaCount: 1
    });
  });

  it("runs safety policy across brief, provider, QA, and export enforcement stages", () => {
    const state = createInitialWorkspace();
    const packageItems = [
      {
        id: "pkg-item-001",
        sourceId: "cand-studio",
        title: "Studio System",
        type: "candidate" as const,
        addedAt: "2026-05-26T10:00:00.000Z"
      }
    ];
    const qaReport = evaluatePackageQa(packageItems);
    const passingReport = runSafetyPolicy(
      {
        ...state,
        selectedCandidateId: "cand-studio",
        packageItems
      },
      qaReport
    );
    const blockedReport = runSafetyPolicy(
      {
        ...state,
        brief: {
          ...state.brief,
          prompt: "Create phishing artwork with credential theft instructions."
        },
        packageItems
      },
      qaReport
    );

    expect(passingReport).toEqual({
      schema_version: "stage0.rev2.safety-policy-export",
      status: "pass",
      enforcementStages: ["brief", "provider_request", "provider_response", "qa", "export"],
      findings: []
    });
    expect(blockedReport).toMatchObject({
      status: "block",
      enforcementStages: ["brief", "provider_request", "provider_response", "qa", "export"],
      findings: expect.arrayContaining([
        expect.objectContaining({
          ruleId: "safety-illegal-abuse-v1",
          stage: "brief",
          severity: "block"
        }),
        expect.objectContaining({
          ruleId: "safety-private-data-v1",
          stage: "brief",
          severity: "block"
        })
      ])
    });
  });

  it("keeps workspace rendering within the local alpha smoke budget", () => {
    const state = createInitialWorkspace();
    const smoke = buildWorkspaceRenderingPerformanceSmoke({
      ...state,
      selectedCandidateId: "cand-studio",
      canvas: {
        ...state.canvas,
        nodes: [
          ...state.canvas.nodes,
          {
            id: "node-cand-studio",
            title: "Studio System",
            kind: "candidate",
            x: 360,
            y: 180,
            body: "Reusable product tiles, neutral surfaces, and crisp asset annotations."
          },
          {
            id: "node-iteration-003",
            title: "Iteration",
            kind: "iteration",
            x: 650,
            y: 260,
            body: "Studio System refined with production handoff states."
          }
        ],
        edges: [
          { from: "node-brief", to: "node-cand-studio" },
          { from: "node-cand-studio", to: "node-iteration-003" }
        ],
        versions: [
          ...state.canvas.versions,
          {
            id: "version-002",
            label: "Selected Studio System",
            createdAt: "2026-05-26T10:00:00.000Z",
            nodeCount: 2
          },
          {
            id: "version-003",
            label: "Canvas iteration",
            createdAt: "2026-05-26T10:05:00.000Z",
            nodeCount: 3
          }
        ],
        activeVersionId: "version-003"
      },
      packageItems: [
        {
          id: "pkg-item-001",
          sourceId: "cand-studio",
          title: "Studio System",
          type: "candidate",
          addedAt: "2026-05-26T10:10:00.000Z"
        }
      ]
    });

    expect(smoke).toMatchObject({
      schema_version: "stage0.rev2.workspace-rendering-performance",
      scenario: "local-alpha-canvas",
      status: "pass",
      interactionSteps: ["load", "candidate-select", "iteration", "package-add"],
      nodeCount: 3,
      edgeCount: 2,
      versionCount: 3,
      failures: [],
      budgets: {
        maxNodes: 24,
        maxEdges: 24,
        maxVersions: 32,
        maxRenderElements: 96,
        maxInteractionMs: 100
      }
    });
    expect(smoke.renderElementCount).toBeLessThanOrEqual(smoke.budgets.maxRenderElements);
    expect(smoke.estimatedInteractionMs).toBeLessThanOrEqual(smoke.budgets.maxInteractionMs);
  });

  it("fails workspace rendering smoke when local alpha budgets are exceeded", () => {
    const state = createInitialWorkspace();
    const nodes = Array.from({ length: 25 }, (_, index) => ({
      id: `node-budget-${index}`,
      title: `Budget node ${index}`,
      kind: "iteration" as const,
      x: 80 + index,
      y: 120 + index,
      body: "Budget overflow fixture."
    }));
    const smoke = buildWorkspaceRenderingPerformanceSmoke({
      ...state,
      canvas: {
        ...state.canvas,
        nodes,
        edges: Array.from({ length: 25 }, (_, index) => ({
          from: `node-budget-${index}`,
          to: `node-budget-${index + 1}`
        })),
        versions: Array.from({ length: 33 }, (_, index) => ({
          id: `version-budget-${index}`,
          label: `Budget ${index}`,
          createdAt: "2026-05-26T10:00:00.000Z",
          nodeCount: index + 1
        })),
        activeVersionId: "version-budget-32"
      },
      packageItems: Array.from({ length: 12 }, (_, index) => ({
        id: `pkg-item-budget-${index}`,
        sourceId: `node-budget-${index}`,
        title: `Budget item ${index}`,
        type: "canvas-frame" as const,
        addedAt: "2026-05-26T10:05:00.000Z"
      }))
    });

    expect(smoke).toMatchObject({
      status: "fail",
      nodeCount: 25,
      edgeCount: 25,
      versionCount: 33,
      renderElementCount: 99
    });
    expect(smoke.failures).toEqual(["nodes", "edges", "versions", "render-elements", "interaction"]);
  });

  it("summarizes reference upload integration through package history, provenance, and PPT asset-grid slides", () => {
    const state = createInitialWorkspace();
    const acceptedImage = createReferenceAsset("campaign-reference.webp", "image");
    const acceptedDocument = createReferenceAsset("brief-source.pdf", "document");
    const acceptedUrl = createReferenceAsset("https://assets.example.com/pack", "url");
    const rejectedReference = createReferenceAsset("unsafe-reference.exe", "image");
    const packageItems = [
      {
        id: "pkg-item-001",
        sourceId: "cand-studio",
        title: "Studio System",
        type: "candidate" as const,
        addedAt: "2026-05-26T10:00:00.000Z",
        workflowId: ecommerceGrowthWorkflowAcceptance.workflow_id,
        strategyTaxonomy: "social_proof",
        requiredOutputFiles: ["assets/square_social_ad.png"]
      },
      {
        id: "pkg-item-002",
        sourceId: acceptedImage.id,
        title: acceptedImage.name,
        type: "reference" as const,
        addedAt: "2026-05-26T10:03:00.000Z"
      },
      {
        id: "pkg-item-003",
        sourceId: acceptedDocument.id,
        title: acceptedDocument.name,
        type: "reference" as const,
        addedAt: "2026-05-26T10:04:00.000Z"
      },
      {
        id: "pkg-item-004",
        sourceId: acceptedUrl.id,
        title: acceptedUrl.name,
        type: "reference" as const,
        addedAt: "2026-05-26T10:05:00.000Z"
      }
    ];
    const qaReport = evaluatePackageQa(packageItems);
    const exportRecord: ExportRecord = {
      id: "export-010",
      format: "zip",
      status: "ready",
      createdAt: "2026-05-26T10:06:00.000Z",
      fileName: "zenart-010.zip",
      manifest: buildManifest(state.activeProjectId, packageItems),
      qaReport,
      safetyReport: runSafetyPolicy({ ...state, selectedCandidateId: "cand-studio", packageItems }, qaReport)
    };

    expect(
      buildReferenceUploadIntegrationSmoke({
        ...state,
        brief: {
          ...state.brief,
          references: [...state.brief.references, acceptedImage, acceptedDocument, acceptedUrl, rejectedReference]
        },
        packageItems,
        exports: [exportRecord]
      })
    ).toEqual({
      schema_version: "stage0.rev2.reference-upload-integration-smoke",
      status: "pass",
      scenario: "reference-upload-to-ready-zip-export",
      acceptedCount: 4,
      acceptedKinds: ["image", "document", "url"],
      rejectedCount: 1,
      packagedReferenceCount: 3,
      packageHistoryReferenceCount: 3,
      readyExportCount: 1,
      provenanceCount: 3,
      pptAssetGridSlideCount: 3,
      failures: []
    });
  });

  it("fails reference upload integration smoke before references reach a ready export", () => {
    const state = createInitialWorkspace();

    expect(buildReferenceUploadIntegrationSmoke(state)).toMatchObject({
      status: "fail",
      acceptedCount: 1,
      packagedReferenceCount: 0,
      readyExportCount: 0,
      provenanceCount: 0,
      pptAssetGridSlideCount: 0,
      failures: ["packaged-reference", "ready-export"]
    });
  });

  it("models local alpha share links as disabled and private", () => {
    const shareLink = createDisabledShareLink("export-001", 0);

    expect(shareLink.status).toBe("disabled");
    expect(shareLink.access).toBe("private");
    expect(shareLink.reason).toContain("disabled in local alpha");
  });

  it("defines secure cookie and same-site CSRF client session evidence", () => {
    const session = createSessionContract();

    expect(session).toMatchObject({
      status: "authenticated",
      cookie: {
        name: "__Host-zenart_session",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/"
      },
      csrf: {
        strategy: "same-site-origin-check",
        headerName: "X-ZenArt-CSRF",
        headerValue: "same-site-origin-check",
        sameSiteRequired: "lax-or-strict",
        credentialMode: "include",
        originPolicy: "same-site-only",
        protectedMethods: ["POST", "PUT", "PATCH", "DELETE"]
      }
    });
    expect(new Date(session.refreshAfter).getTime()).toBeLessThan(new Date(session.expiresAt).getTime());
  });

  it("builds visible report-problem context from accepted references and latest export", () => {
    const state = createInitialWorkspace();
    const validReference = createReferenceAsset("accepted-product-angle.webp", "image");
    const rejectedReference = createReferenceAsset("unsafe-reference.exe", "image");
    const exportRecord: ExportRecord = {
      id: "export-009",
      format: "zip",
      status: "ready",
      createdAt: "2026-05-26T10:00:00.000Z",
      fileName: "zenart-009.zip",
      manifest: buildManifest(state.activeProjectId, []),
      qaReport: [],
      safetyReport: runSafetyPolicy(state, [])
    };

    const context = buildSupportProblemContext({
      ...state,
      selectedCandidateId: "cand-utility",
      brief: {
        ...state.brief,
        references: [...state.brief.references, validReference, rejectedReference]
      },
      exports: [exportRecord]
    });

    expect(context).toMatchObject({
      projectId: "project-001",
      projectName: "Launch Direction Board",
      linkedExportId: "export-009",
      linkedTaskId: "task-cand-utility",
      linkedTraceId: "trace-export-009",
      linkedAssetIds: ["ref-001", "ref-accepted-product-angle-webp"],
      linkedAssetNames: ["brand-moodboard.png", "accepted-product-angle.webp"],
      linkedQuotaSnapshot: {
        used: state.billing.quotaUsed,
        limit: state.billing.quotaLimit,
        remaining: state.billing.quotaLimit - state.billing.quotaUsed,
        status: state.billing.status,
        resetAt: state.billing.resetAt
      }
    });
  });
});
