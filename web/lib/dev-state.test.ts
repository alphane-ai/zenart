import { describe, expect, it } from "vitest";
import { ExportRecord } from "./contracts";
import {
  buildManifest,
  buildSupportProblemContext,
  createDisabledShareLink,
  createInitialWorkspace,
  createReferenceAsset,
  createSessionContract,
  evaluatePackageQa
} from "./dev-state";

describe("dev workspace contracts", () => {
  it("creates four deterministic candidates", () => {
    const state = createInitialWorkspace();

    expect(state.candidates).toHaveLength(4);
    expect(new Set(state.candidates.map((candidate) => candidate.strategy)).size).toBe(4);
  });

  it("blocks empty exports and includes required manifest outputs", () => {
    const state = createInitialWorkspace();
    const qa = evaluatePackageQa([]);
    const manifest = buildManifest(state.activeProjectId, []);

    expect(qa.some((finding) => finding.severity === "block")).toBe(true);
    expect(manifest.required_outputs).toEqual(["manifest.json", "qa-report.json", "provenance.json", "ppt-ready-metadata.json", "assets/"]);
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
        sameSiteRequired: "lax-or-strict"
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
      qaReport: []
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
