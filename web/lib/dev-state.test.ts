import { describe, expect, it } from "vitest";
import { ExportRecord } from "./contracts";
import {
  buildManifest,
  buildBriefUploadConfirmationRuntimeEvidence,
  buildBusinessVisualDocApiSmokeEvidence,
  buildDownloadableExportZipPayloadNames,
  buildEcommerceGrowthApiSmokeEvidence,
  buildPackageExportMetadataEvidence,
  buildReferenceUploadIntegrationSmoke,
  buildReferenceUploadValidationMatrixEvidence,
  buildSupportProblemContext,
  buildWorkspaceRenderingPerformanceSmoke,
  createDisabledShareLink,
  createInitialWorkspace,
  createReferenceAsset,
  createSessionContract,
  buildExportDownloadParityEvidence,
  buildExportZipPayloadSmokeEvidence,
  businessVisualDocCandidates,
  businessVisualDocWorkflowAcceptance,
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
      "ai-content-disclaimer.json",
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
      exportId: "export-001",
      packageId: "pkg-002",
      projectId: "project-001",
      downloadArtifactStatus: "pass",
      downloadArtifactFormat: "zip",
      manifestCreatedAt: manifest.created_at,
      manifestItemCount: 2,
      manifestRequiredOutputCount: 7,
      requiredOutputCount: 7,
      missingRequiredOutputs: [],
      manifestOutputStatuses: [
        {
          name: "manifest.json",
          zipPayloadName: "manifest.json",
          present: true
        },
        {
          name: "qa-report.json",
          zipPayloadName: "qa-report.json",
          present: true
        },
        {
          name: "safety-policy-report.json",
          zipPayloadName: "safety-policy-report.json",
          present: true
        },
        {
          name: "provenance.json",
          zipPayloadName: "provenance.json",
          present: true
        },
        {
          name: "ai-content-disclaimer.json",
          zipPayloadName: "ai-content-disclaimer.json",
          present: true
        },
        {
          name: "ppt-ready-metadata.json",
          zipPayloadName: "ppt-ready-metadata.json",
          present: true
        },
        {
          name: "assets/",
          zipPayloadName: "assets/README.txt",
          present: true
        }
      ],
      itemCount: 2,
      itemTypes: ["candidate", "reference"],
      provenanceCount: 2,
      itemProvenanceParityStatus: "pass",
      itemProvenanceParityCount: 2,
      missingItemProvenanceParityCount: 0,
      referenceProvenanceCount: 1,
      candidateProvenanceCount: 1,
      itemProvenanceStatuses: [
        {
          itemId: "pkg-item-001",
          title: "Studio System",
          type: "candidate",
          provenance: "dev-client:cand-studio",
          expectedPrefix: "dev-client:",
          provenanceStatus: "pass",
          pptSlideStatus: "pass"
        },
        {
          itemId: "pkg-item-002",
          title: "brand-moodboard.png",
          type: "reference",
          provenance: "dev-client-reference:ref-001",
          expectedPrefix: "dev-client-reference:",
          provenanceStatus: "pass",
          pptSlideStatus: "pass"
        }
      ],
      qaFindingCount: 2,
      blockingQaCount: 0,
      safetyStatus: "pass",
      safetyStageCount: 5,
      safetyFindingCount: 0,
      pptAspectRatio: "16:9",
      pptSlideCount: 2,
      pptCanvasSize: "1920x1080",
      pptSafeArea: "72/96/72/96",
      pptThemeFont: "Inter, Arial, sans-serif",
      handoffChecklistCount: 5,
      zipPayloadCount: 7,
      zipPayloadNames: [
        "manifest.json",
        "qa-report.json",
        "safety-policy-report.json",
        "provenance.json",
        "ai-content-disclaimer.json",
        "ppt-ready-metadata.json",
        "assets/README.txt"
      ],
      zipPayloadContractDigest:
        "export-001::pkg-002::project-001::generic-stage0-export::none::ai-content-disclaimer.json|assets/README.txt|manifest.json|ppt-ready-metadata.json|provenance.json|qa-report.json|safety-policy-report.json",
      requiredZipPayloadNames: [
        "manifest.json",
        "qa-report.json",
        "safety-policy-report.json",
        "provenance.json",
        "ai-content-disclaimer.json",
        "ppt-ready-metadata.json",
        "assets/README.txt"
      ],
      requiredZipPayloadCount: 7,
      requiredZipPayloadStatuses: [
        {
          name: "manifest.json",
          present: true
        },
        {
          name: "qa-report.json",
          present: true
        },
        {
          name: "safety-policy-report.json",
          present: true
        },
        {
          name: "provenance.json",
          present: true
        },
        {
          name: "ai-content-disclaimer.json",
          present: true
        },
        {
          name: "ppt-ready-metadata.json",
          present: true
        },
        {
          name: "assets/README.txt",
          present: true
        }
      ],
      zipPayloadParityStatus: "pass",
      zipPayloadParityRatio: "7/7",
      missingZipPayloadNames: [],
      zipPayloadPathSafetyStatus: "pass",
      unsafeManifestPayloadNames: [],
      unsafeExpectedPayloadNames: [],
      crossPayloadIdentityStatus: "pass",
      identityContractDigest:
        "export-001::pkg-002::project-001::generic-stage0-export::none::dev-provider::deterministic-local-alpha::::generic-stage0-export::pass",
      crossPayloadIdentityNames: ["manifest.json", "provenance.json", "ai-content-disclaimer.json"],
      missingCrossPayloadIdentityNames: [],
      crossPayloadIdentityStatuses: [
        expect.objectContaining({
          payloadName: "manifest.json",
          exportId: "pass",
          packageId: "pass",
          projectId: "pass",
          workflowId: "pass",
          provider: "pass",
          model: "pass",
          promptSpec: "pass",
          skill: "pass",
          safety: "pass"
        }),
        expect.objectContaining({
          payloadName: "provenance.json",
          exportId: "pass",
          workflowId: "pass",
          provider: "pass",
          model: "pass",
          promptSpec: "pass",
          skill: "pass",
          safety: "pass"
        }),
        expect.objectContaining({
          payloadName: "ai-content-disclaimer.json",
          exportId: "pass",
          workflowId: "pass",
          provider: "pass",
          model: "pass",
          promptSpec: "pass",
          skill: "pass",
          safety: "pass"
        })
      ],
      workflowId: "generic-stage0-export",
      workflowFixtureId: "none",
      workflowStrategyTaxonomyCount: 0,
      workflowRequiredFileCount: 0,
      workflowZipPayloadCount: 0,
      workflowPayloadStatuses: [],
      workflowMetadataPayloadPresent: false,
      workflowTraceProvenancePayloadPresent: false,
      aiContentDisclaimerPayloadPresent: true,
      workflowProviderMetadataPresent: false,
      workflowPromptSpecMetadataPresent: false,
      workflowSkillMetadataPresent: false,
      workflowSafetyMetadataPresent: false,
      workflowMetadataGeneratedBy: "zenart-web-dev-client",
      workflowMetadataProvider: "dev-provider",
      workflowMetadataModel: "deterministic-local-alpha",
      workflowPromptSpecTaxonomy: [],
      workflowSkill: "generic-stage0-export",
      workflowSafety: "pass"
    });
  });

  it("builds ZIP payload smoke evidence from manifest-required outputs", () => {
    const state = createInitialWorkspace();
    const packageItems = state.candidates.map((candidate, index) => ({
      id: `pkg-item-${String(index + 1).padStart(3, "0")}`,
      sourceId: candidate.id,
      title: candidate.title,
      type: "candidate" as const,
      addedAt: "2026-05-26T10:00:00.000Z",
      workflowId: candidate.workflowId,
      strategyTaxonomy: candidate.strategyTaxonomy,
      requiredOutputFiles: candidate.requiredOutputFiles
    }));
    const qaReport = evaluatePackageQa(packageItems);
    const exportRecord: ExportRecord = {
      id: "export-zip-001",
      format: "zip",
      status: "ready",
      createdAt: "2026-05-26T10:06:00.000Z",
      fileName: "zenart-zip-001.zip",
      manifest: buildManifest(state.activeProjectId, packageItems),
      qaReport,
      safetyReport: runSafetyPolicy({ ...state, selectedCandidateId: "cand-editorial", packageItems }, qaReport)
    };

    expect(buildDownloadableExportZipPayloadNames(exportRecord)).toEqual([
      "manifest.json",
      "qa-report.json",
      "safety-policy-report.json",
      "provenance.json",
      "ai-content-disclaimer.json",
      "ppt-ready-metadata.json",
      "assets/README.txt",
      "assets/hero_product_ad.png",
      "assets/square_social_ad.png",
      "assets/story_variant.png",
      "assets/marketplace_banner.png",
      "metadata.json",
      "qa_report.json",
      "trace_provenance.json"
    ]);
    expect(buildExportZipPayloadSmokeEvidence(exportRecord)).toEqual({
      schema_version: "stage0.rev2.export-zip-payload-smoke",
      status: "pass",
      scenario: "manifest-required-output-to-downloadable-zip-payloads",
      exportId: "export-zip-001",
      packageId: "pkg-004",
      manifestRequiredOutputCount: 14,
      expectedPayloadCount: 14,
      requiredBaselinePayloadNames: [
        "manifest.json",
        "qa-report.json",
        "safety-policy-report.json",
        "provenance.json",
        "ai-content-disclaimer.json",
        "ppt-ready-metadata.json",
        "assets/README.txt"
      ],
      expectedPayloadNames: [
        "manifest.json",
        "qa-report.json",
        "safety-policy-report.json",
        "provenance.json",
        "ai-content-disclaimer.json",
        "ppt-ready-metadata.json",
        "assets/README.txt",
        "assets/hero_product_ad.png",
        "assets/square_social_ad.png",
        "assets/story_variant.png",
        "assets/marketplace_banner.png",
        "metadata.json",
        "qa_report.json",
        "trace_provenance.json"
      ],
      payloadContractDigest:
        "export-zip-001::pkg-004::project-001::ecommerce_growth_pack::fx_ecommerce_growth_golden::ai-content-disclaimer.json|assets/README.txt|assets/hero_product_ad.png|assets/marketplace_banner.png|assets/square_social_ad.png|assets/story_variant.png|manifest.json|metadata.json|ppt-ready-metadata.json|provenance.json|qa-report.json|qa_report.json|safety-policy-report.json|trace_provenance.json",
      missingPayloadNames: [],
      pathSafetyStatus: "pass",
      unsafeManifestPayloadNames: [],
      unsafeExpectedPayloadNames: [],
      workflowPayloadNames: [
        "manifest.json",
        "assets/hero_product_ad.png",
        "assets/square_social_ad.png",
        "assets/story_variant.png",
        "assets/marketplace_banner.png",
        "metadata.json",
        "qa_report.json",
        "trace_provenance.json"
      ],
      metadataPayloadPresent: true,
      traceProvenancePayloadPresent: true,
      aiContentDisclaimerPayloadPresent: true,
      assetsPayloadPresent: true,
      failures: []
    });
  });

  it("builds download parity evidence across metadata, ZIP smoke, and handoff contracts", () => {
    const state = createInitialWorkspace();
    const packageItems = state.candidates.map((candidate, index) => ({
      id: `pkg-item-${String(index + 1).padStart(3, "0")}`,
      sourceId: candidate.id,
      title: candidate.title,
      type: "candidate" as const,
      addedAt: "2026-05-26T10:00:00.000Z",
      workflowId: candidate.workflowId,
      strategyTaxonomy: candidate.strategyTaxonomy,
      requiredOutputFiles: candidate.requiredOutputFiles
    }));
    const qaReport = evaluatePackageQa(packageItems);
    const exportRecord: ExportRecord = {
      id: "export-parity-001",
      format: "zip",
      status: "ready",
      createdAt: "2026-05-26T10:07:00.000Z",
      fileName: "zenart-parity-001.zip",
      manifest: buildManifest(state.activeProjectId, packageItems),
      qaReport,
      safetyReport: runSafetyPolicy({ ...state, selectedCandidateId: "cand-editorial", packageItems }, qaReport)
    };

    expect(buildExportDownloadParityEvidence(exportRecord)).toEqual({
      schema_version: "stage0.rev2.export-download-parity-smoke",
      status: "pass",
      scenario: "metadata-zip-smoke-download-handoff-parity",
      exportId: "export-parity-001",
      packageId: "pkg-004",
      projectId: "project-001",
      workflowId: "ecommerce_growth_pack",
      workflowFixtureId: "fx_ecommerce_growth_golden",
      fileName: "zenart-parity-001.zip",
      format: "zip",
      metadataStatus: "pass",
      zipPayloadStatus: "pass",
      downloadHandoffStatus: "pass",
      manifestRequiredOutputCount: 14,
      metadataZipPayloadCount: 14,
      zipExpectedPayloadCount: 14,
      metadataMissingZipPayloadCount: 0,
      zipMissingPayloadCount: 0,
      requiredZipPayloadParityStatus: "pass",
      metadataPayloadsMatchZipPayloads: true,
      payloadListStatus: "pass",
      metadataPayloadNames: [
        "manifest.json",
        "qa-report.json",
        "safety-policy-report.json",
        "provenance.json",
        "ai-content-disclaimer.json",
        "ppt-ready-metadata.json",
        "assets/README.txt",
        "assets/hero_product_ad.png",
        "assets/square_social_ad.png",
        "assets/story_variant.png",
        "assets/marketplace_banner.png",
        "metadata.json",
        "qa_report.json",
        "trace_provenance.json"
      ],
      zipExpectedPayloadNames: [
        "manifest.json",
        "qa-report.json",
        "safety-policy-report.json",
        "provenance.json",
        "ai-content-disclaimer.json",
        "ppt-ready-metadata.json",
        "assets/README.txt",
        "assets/hero_product_ad.png",
        "assets/square_social_ad.png",
        "assets/story_variant.png",
        "assets/marketplace_banner.png",
        "metadata.json",
        "qa_report.json",
        "trace_provenance.json"
      ],
      payloadContractDigest:
        "export-parity-001::pkg-004::project-001::ecommerce_growth_pack::fx_ecommerce_growth_golden::ai-content-disclaimer.json|assets/README.txt|assets/hero_product_ad.png|assets/marketplace_banner.png|assets/square_social_ad.png|assets/story_variant.png|manifest.json|metadata.json|ppt-ready-metadata.json|provenance.json|qa-report.json|qa_report.json|safety-policy-report.json|trace_provenance.json",
      metadataPayloadDigestMatchesZipPayloadDigest: true,
      payloadPathSafetyStatus: "pass",
      identityContractDigest:
        "export-parity-001::pkg-004::project-001::ecommerce_growth_pack::fx_ecommerce_growth_golden::dev-provider::deterministic-local-alpha::conversion_offer|social_proof|feature_comparison|retention_bundle::ecommerce_growth_pack::pass",
      metadataIdentityDigestMatchesRecord: true,
      identityStatus: "pass",
      itemProvenanceParityStatus: "pass",
      itemProvenanceParityCount: 4,
      missingItemProvenanceParityCount: 0,
      provider: "dev-provider",
      model: "deterministic-local-alpha",
      promptSpecTaxonomy: ["conversion_offer", "social_proof", "feature_comparison", "retention_bundle"],
      skill: "ecommerce_growth_pack",
      safetyStatus: "pass",
      workflowMetadataPresent: true,
      traceProvenancePresent: true,
      failures: []
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
      downloadArtifactStatus: "fail",
      missingRequiredOutputs: ["qa-report.json", "safety-policy-report.json", "provenance.json", "ai-content-disclaimer.json", "ppt-ready-metadata.json", "assets/"],
      missingZipPayloadNames: [],
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
      candidateCount: 4,
      packageItemCount: 1,
      referenceCount: 1,
      exportHistoryCount: 0,
      renderElementCount: 14,
      renderIdentityCount: 14,
      duplicateRenderIdentityCount: 0,
      duplicateRenderIdentities: [],
      renderIdentityDigest:
        "node:node-brief|node:node-cand-studio|node:node-iteration-003|edge:node-brief->node-cand-studio|edge:node-cand-studio->node-iteration-003|version:version-001|version:version-002|version:version-003|candidate:cand-editorial|candidate:cand-studio|candidate:cand-gallery|candidate:cand-utility|package:pkg-item-001|reference:ref-001",
      interactionStepBudgets: [
        { step: "load", status: "pass", renderElementCount: 4, estimatedInteractionMs: 4, failureCount: 0 },
        { step: "candidate-select", status: "pass", renderElementCount: 7, estimatedInteractionMs: 9, failureCount: 0 },
        { step: "iteration", status: "pass", renderElementCount: 11, estimatedInteractionMs: 13, failureCount: 0 },
        { step: "package-add", status: "pass", renderElementCount: 14, estimatedInteractionMs: 16, failureCount: 0 }
      ],
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
    expect(smoke.interactionStepBudgets.every((entry) => entry.status === "pass" && entry.failureCount === 0)).toBe(true);
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
      candidateCount: 4,
      packageItemCount: 12,
      referenceCount: 1,
      exportHistoryCount: 0,
      renderElementCount: 100,
      renderIdentityCount: 100,
      duplicateRenderIdentityCount: 0,
      duplicateRenderIdentities: []
    });
    expect(smoke.failures).toEqual(["nodes", "edges", "versions", "render-elements", "interaction"]);
    expect(smoke.interactionStepBudgets).toContainEqual({
      step: "package-add",
      status: "fail",
      renderElementCount: 100,
      estimatedInteractionMs: 80,
      failureCount: 1
    });
    expect(smoke.interactionStepBudgets.filter((entry) => entry.status === "fail")).toHaveLength(1);
  });

  it("fails workspace rendering smoke when rendered element identities are duplicated", () => {
    const state = createInitialWorkspace();
    const smoke = buildWorkspaceRenderingPerformanceSmoke({
      ...state,
      canvas: {
        ...state.canvas,
        versions: [
          ...state.canvas.versions,
          {
            id: "version-001",
            label: "Duplicate version",
            createdAt: "2026-05-26T10:00:00.000Z",
            nodeCount: 1
          }
        ]
      }
    });

    expect(smoke).toMatchObject({
      status: "fail",
      renderElementCount: 8,
      renderIdentityCount: 8,
      duplicateRenderIdentityCount: 1,
      duplicateRenderIdentities: ["version:version-001"]
    });
    expect(smoke.failures).toContain("duplicate-render-identities");
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
      apiOperationIds: ["createUpload", "createPackage", "createExport", "getExport"],
      acceptedCount: 4,
      acceptedKinds: ["image", "document", "url"],
      rejectedCount: 1,
      latestAcceptedReferenceId: acceptedUrl.id,
      latestAcceptedReferenceName: acceptedUrl.name,
      latestAcceptedReferenceKind: acceptedUrl.kind,
      latestAcceptedReferenceUploadMethod: "POST",
      latestAcceptedReferenceUploadPath: "/uploads",
      latestAcceptedReferenceCsrfHeaderName: "X-ZenArt-CSRF",
      latestAcceptedReferenceIdempotencyRequired: true,
      latestAcceptedReferencePreviewScope: "tenant-scoped-dev-preview",
      latestAcceptedReferencePackageItemId: "pkg-item-004",
      latestAcceptedReferenceExportTitle: acceptedUrl.name,
      latestAcceptedReferencePptSlideSourceItemId: "pkg-item-004",
      latestAcceptedReferenceIdentityStatus: "pass",
      latestAcceptedReferencePackaged: true,
      latestAcceptedReferenceProvenancePresent: true,
      latestAcceptedReferencePptSlidePresent: true,
      uploadRequestContractCount: 4,
      packagedReferenceCount: 3,
      packageHistoryReferenceCount: 3,
      readyExportCount: 1,
      provenanceCount: 3,
      pptAssetGridSlideCount: 3,
      rejectedReferencePackagedCount: 0,
      rejectedReferenceExportedCount: 0,
      failures: []
    });
  });

  it("summarizes reference upload validation matrix evidence for safe and unsupported inputs", () => {
    expect(buildReferenceUploadValidationMatrixEvidence()).toEqual({
      schema_version: "stage0.rev2.reference-upload-validation-matrix",
      status: "pass",
      scenario: "safe-image-document-https-url-reject-unsupported",
      acceptedKinds: ["image", "document", "url"],
      acceptedSampleNames: [
        "accepted-product-angle.webp",
        "launch-brief.pdf",
        "https://assets.example.com/reference-pack"
      ],
      acceptedAttachedCount: 3,
      rejectedSampleNames: ["unsafe-reference.exe", "http://assets.example.com/reference-pack"],
      rejectedReasons: ["Images must be PNG, JPG, JPEG, or WEBP files.", "Reference URLs must use HTTPS."],
      rejectedQueuedCount: 2,
      rejectedPackageActionCount: 0,
      expectedAcceptedKinds: ["image", "document", "url"],
      expectedRejectedCount: 2,
      expectedRejectedReasons: ["Images must be PNG, JPG, JPEG, or WEBP files.", "Reference URLs must use HTTPS."],
      failures: []
    });
  });

  it("summarizes user-web brief/upload/confirmation runtime evidence", () => {
    const state = createInitialWorkspace();
    const acceptedReference = createReferenceAsset("aurora-packshot.webp", "image");

    expect(
      buildBriefUploadConfirmationRuntimeEvidence({
        ...state,
        brief: {
          ...state.brief,
          confirmed: true,
          missingInfo: [],
          references: [...state.brief.references, acceptedReference]
        },
        chat: [
          ...state.chat,
          {
            id: "msg-confirmed",
            role: "assistant",
            body: "Brief confirmed. I generated four deterministic strategy candidates for review.",
            createdAt: "2026-05-26T10:00:00.000Z"
          }
        ]
      })
    ).toEqual({
      schema_version: "stage0.rev2.brief-upload-confirmation-runtime-evidence",
      status: "pass",
      scenario: "user-web-brief-upload-confirmation",
      gateImpact: "private-beta-staging-runtime",
      apiOperationIds: ["createChatSession", "createChatMessage", "createUpload", "createCandidateSet"],
      briefConfirmed: true,
      missingInfoCount: 0,
      acceptedReferenceCount: 2,
      rejectedReferenceCount: 0,
      latestReferenceValidationState: "accepted",
      confirmationMessageVisible: true,
      candidateSetReady: true,
      failures: []
    });
  });

  it("fails user-web brief/upload/confirmation evidence until confirmation and a clean upload are visible", () => {
    const state = createInitialWorkspace();

    expect(
      buildBriefUploadConfirmationRuntimeEvidence({
        ...state,
        brief: {
          ...state.brief,
          references: [...state.brief.references, createReferenceAsset("unsafe-reference.exe", "image")]
        }
      })
    ).toMatchObject({
      status: "fail",
      briefConfirmed: false,
      missingInfoCount: 2,
      acceptedReferenceCount: 1,
      rejectedReferenceCount: 1,
      latestReferenceValidationState: "rejected",
      confirmationMessageVisible: false,
      candidateSetReady: true,
      failures: [
        "brief-confirmed",
        "missing-info-cleared",
        "no-rejected-reference",
        "confirmation-message"
      ]
    });
  });

  it("fails reference upload integration smoke before references reach a ready export", () => {
    const state = createInitialWorkspace();

    expect(buildReferenceUploadIntegrationSmoke(state)).toMatchObject({
      status: "fail",
      acceptedCount: 1,
      latestAcceptedReferenceId: "ref-001",
      latestAcceptedReferenceName: "brand-moodboard.png",
      latestAcceptedReferenceKind: "image",
      latestAcceptedReferenceUploadMethod: "POST",
      latestAcceptedReferenceUploadPath: "/uploads",
      latestAcceptedReferenceCsrfHeaderName: "X-ZenArt-CSRF",
      latestAcceptedReferenceIdempotencyRequired: true,
      latestAcceptedReferencePreviewScope: "tenant-scoped-dev-preview",
      latestAcceptedReferencePackageItemId: "missing",
      latestAcceptedReferenceExportTitle: "missing",
      latestAcceptedReferencePptSlideSourceItemId: "missing",
      latestAcceptedReferenceIdentityStatus: "fail",
      latestAcceptedReferencePackaged: false,
      latestAcceptedReferenceProvenancePresent: false,
      latestAcceptedReferencePptSlidePresent: false,
      uploadRequestContractCount: 1,
      packagedReferenceCount: 0,
      readyExportCount: 0,
      provenanceCount: 0,
      pptAssetGridSlideCount: 0,
      rejectedReferencePackagedCount: 0,
      rejectedReferenceExportedCount: 0,
      failures: ["packaged-reference", "latest-reference-packaged", "ready-export"]
    });
  });

  it("summarizes ecommerce growth API smoke evidence after the full local web workflow", () => {
    const state = createInitialWorkspace();
    const packageItems = state.candidates.map((candidate, index) => ({
      id: `pkg-item-${String(index + 1).padStart(3, "0")}`,
      sourceId: candidate.id,
      title: candidate.title,
      type: "candidate" as const,
      addedAt: "2026-05-26T10:00:00.000Z",
      workflowId: candidate.workflowId,
      strategyTaxonomy: candidate.strategyTaxonomy,
      requiredOutputFiles: candidate.requiredOutputFiles
    }));
    const qaReport = evaluatePackageQa(packageItems);
    const exportRecord: ExportRecord = {
      id: "export-011",
      format: "zip",
      status: "ready",
      createdAt: "2026-05-26T10:06:00.000Z",
      fileName: "zenart-011.zip",
      manifest: buildManifest(state.activeProjectId, packageItems),
      qaReport,
      safetyReport: runSafetyPolicy({ ...state, selectedCandidateId: "cand-editorial", packageItems }, qaReport)
    };

    expect(
      buildEcommerceGrowthApiSmokeEvidence({
        ...state,
        brief: {
          ...state.brief,
          confirmed: true,
          missingInfo: []
        },
        selectedCandidateId: "cand-editorial",
        canvas: {
          ...state.canvas,
          nodes: [
            ...state.canvas.nodes,
            {
              id: "node-iteration-002",
              title: "Iteration",
              kind: "iteration",
              x: 650,
              y: 260,
              body: "Ecommerce output placements refined."
            }
          ]
        },
        packageItems,
        exports: [exportRecord]
      })
    ).toEqual({
      schema_version: "stage0.rev2.workflow-api-smoke",
      workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id,
      fixture_id: ecommerceGrowthWorkflowAcceptance.fixture_id,
      status: "pass",
      scenario: "brief-reference-four-candidates-select-iterate-package-export-zip",
      apiOperationIds: [
        "createChatSession",
        "createChatMessage",
        "createCandidateSet",
        "listCandidateAssets",
        "selectDirection",
        "createPackage",
        "createExport",
        "getExport"
      ],
      apiOperationContracts: [
        {
          operationId: "createChatSession",
          method: "POST",
          path: "/projects/{project_id}/chat/sessions",
          credentialMode: "include",
          csrfProtected: true,
          csrfHeaderName: "X-ZenArt-CSRF",
          idempotencyRequired: true
        },
        {
          operationId: "createChatMessage",
          method: "POST",
          path: "/chat/sessions/{chat_session_id}/messages",
          credentialMode: "include",
          csrfProtected: true,
          csrfHeaderName: "X-ZenArt-CSRF",
          idempotencyRequired: true
        },
        {
          operationId: "createCandidateSet",
          method: "POST",
          path: "/projects/{project_id}/candidate-sets",
          credentialMode: "include",
          csrfProtected: true,
          csrfHeaderName: "X-ZenArt-CSRF",
          idempotencyRequired: true
        },
        {
          operationId: "listCandidateAssets",
          method: "GET",
          path: "/candidate-sets/{candidate_set_id}/assets",
          credentialMode: "include",
          csrfProtected: false,
          csrfHeaderName: "not-required",
          idempotencyRequired: false
        },
        {
          operationId: "selectDirection",
          method: "PUT",
          path: "/projects/{project_id}/selected-direction",
          credentialMode: "include",
          csrfProtected: true,
          csrfHeaderName: "X-ZenArt-CSRF",
          idempotencyRequired: true
        },
        {
          operationId: "createPackage",
          method: "POST",
          path: "/projects/{project_id}/packages",
          credentialMode: "include",
          csrfProtected: true,
          csrfHeaderName: "X-ZenArt-CSRF",
          idempotencyRequired: true
        },
        {
          operationId: "createExport",
          method: "POST",
          path: "/packages/{package_id}/exports",
          credentialMode: "include",
          csrfProtected: true,
          csrfHeaderName: "X-ZenArt-CSRF",
          idempotencyRequired: true
        },
        {
          operationId: "getExport",
          method: "GET",
          path: "/exports/{export_id}",
          credentialMode: "include",
          csrfProtected: false,
          csrfHeaderName: "not-required",
          idempotencyRequired: false
        }
      ],
      csrfProtectedOperationCount: 6,
      idempotencyRequiredOperationCount: 6,
      candidateCount: 4,
      taxonomyCount: 4,
      packagedTaxonomyCount: 4,
      readyZipExportCount: 1,
      requiredOutputCount: 14,
      missingRequiredOutputs: [],
      qaTaxonomyId: "qa-ecommerce-growth-taxonomy",
      qaTaxonomyStatus: "pass",
      safetyStatus: "pass",
      failures: []
    });
  });

  it("summarizes business visual document API smoke evidence after the full local web workflow", () => {
    const state = createInitialWorkspace();
    const packageItems = businessVisualDocCandidates.map((candidate, index) => ({
      id: `pkg-item-doc-${String(index + 1).padStart(3, "0")}`,
      sourceId: candidate.id,
      title: candidate.title,
      type: "candidate" as const,
      addedAt: "2026-05-26T10:00:00.000Z",
      workflowId: candidate.workflowId,
      strategyTaxonomy: candidate.strategyTaxonomy,
      requiredOutputFiles: candidate.requiredOutputFiles
    }));
    const qaReport = evaluatePackageQa(packageItems);
    const exportRecord: ExportRecord = {
      id: "export-012",
      format: "zip",
      status: "ready",
      createdAt: "2026-05-26T10:06:00.000Z",
      fileName: "zenart-012.zip",
      manifest: buildManifest(state.activeProjectId, packageItems),
      qaReport,
      safetyReport: runSafetyPolicy(
        {
          ...state,
          selectedCandidateId: "biz-executive",
          packageItems,
          brief: {
            ...state.brief,
            prompt: "Business Visual Document Pack for board-ready operating memo.",
            confirmed: true,
            missingInfo: [],
            references: [createReferenceAsset("q2-operating-notes.pdf", "document")]
          }
        },
        qaReport
      )
    };

    expect(
      buildBusinessVisualDocApiSmokeEvidence({
        ...state,
        candidates: [...state.candidates, ...businessVisualDocCandidates],
        brief: {
          ...state.brief,
          prompt: "Business Visual Document Pack for board-ready operating memo.",
          confirmed: true,
          missingInfo: [],
          references: [createReferenceAsset("q2-operating-notes.pdf", "document")]
        },
        selectedCandidateId: "biz-executive",
        canvas: {
          ...state.canvas,
          nodes: [
            ...state.canvas.nodes,
            {
              id: "node-iteration-doc-002",
              title: "Iteration",
              kind: "iteration",
              x: 650,
              y: 260,
              body: "Business document readability refined."
            }
          ]
        },
        packageItems,
        exports: [exportRecord]
      })
    ).toMatchObject({
      schema_version: "stage0.rev2.workflow-api-smoke",
      workflow_id: businessVisualDocWorkflowAcceptance.workflow_id,
      fixture_id: businessVisualDocWorkflowAcceptance.fixture_id,
      status: "pass",
      candidateCount: 4,
      taxonomyCount: 4,
      packagedTaxonomyCount: 4,
      readyZipExportCount: 1,
      requiredOutputCount: 14,
      missingRequiredOutputs: [],
      qaTaxonomyId: "qa-business-visual-doc-taxonomy",
      qaTaxonomyStatus: "pass",
      safetyStatus: "pass",
      failures: []
    });
    expect(qaReport).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "qa-business-visual-doc-taxonomy", severity: "pass" }),
        expect.objectContaining({ id: "qa-business-visual-doc-readability", severity: "pass" })
      ])
    );
  });

  it("fails ecommerce growth API smoke evidence until the complete package/export path is present", () => {
    const state = createInitialWorkspace();

    expect(buildEcommerceGrowthApiSmokeEvidence(state)).toMatchObject({
      status: "fail",
      candidateCount: 4,
      taxonomyCount: 4,
      packagedTaxonomyCount: 0,
      readyZipExportCount: 0,
      qaTaxonomyStatus: "missing",
      safetyStatus: "missing",
      failures: ["brief", "selection", "iteration", "package-taxonomy", "ready-zip-export", "required-outputs", "qa-taxonomy", "safety"]
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
