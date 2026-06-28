import { describe, expect, it } from "vitest";
import { BatchGeneration } from "./contracts";
import { createInitialWorkspace } from "./dev-state";
import { applyBatchResultPlacement, buildResultPlacementEvidence } from "./result-placement";

const batch: BatchGeneration = {
  id: "batch-001",
  projectId: "project-001",
  status: "partial_succeeded",
  prompt: "Generate launch images.",
  requestedCount: 2,
  providerId: "zenari-image-sandbox",
  modelId: "image-fast-v1",
  createdAt: "2026-06-22T10:00:00.000Z",
  updatedAt: "2026-06-22T10:02:00.000Z",
  progressPercent: 100,
  queuedCount: 0,
  runningCount: 0,
  succeededCount: 1,
  failedCount: 1,
  cancelledCount: 0,
  blockedCount: 0,
  retryableCount: 1,
  progressSyncStatus: "api",
  progressSyncedAt: "2026-06-22T10:02:01.000Z",
  children: [
    {
      id: "child-001-01",
      batchId: "batch-001",
      status: "succeeded",
      providerId: "zenari-image-sandbox",
      modelId: "image-fast-v1",
      toolType: "image.generate",
      seed: "batch-001-001",
      retryCount: 0,
      maxRetries: 2,
      quotaEstimateUnits: 4,
      quotaCommittedUnits: 4,
      quotaRefundedUnits: 0,
      assetId: "asset-batch-001-01",
      canvasObjectId: "canvas-batch-001-01",
      traceId: "trace-child-001-01",
      visibleTraceRef: "trace_projection_child_001_01"
    },
    {
      id: "child-001-02",
      batchId: "batch-001",
      status: "failed",
      providerId: "zenari-image-sandbox",
      modelId: "image-fast-v1",
      toolType: "image.generate",
      seed: "batch-001-002",
      retryCount: 1,
      maxRetries: 2,
      quotaEstimateUnits: 4,
      quotaCommittedUnits: 0,
      quotaRefundedUnits: 4,
      traceId: "trace-child-001-02",
      visibleTraceRef: "trace_projection_child_001_02",
      failureCode: "provider_unavailable"
    }
  ]
};

describe("Stage 1 result placement contract", () => {
  it("projects successful batch children into canvas nodes and asset library entries", () => {
    const state = {
      ...createInitialWorkspace(),
      batchGenerations: [batch]
    };

    const placed = applyBatchResultPlacement(state, batch);
    const evidence = buildResultPlacementEvidence(placed);

    expect(placed.canvas.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "canvas-batch-001-01",
          kind: "generated_layer",
          title: "Batch result 1",
          body: "asset-batch-001-01 · trace-child-001-01"
        })
      ])
    );
    expect(placed.canvas.edges).toEqual(expect.arrayContaining([{ from: "node-brief", to: "canvas-batch-001-01" }]));
    expect(placed.canvas.versions.at(-1)).toMatchObject({
      label: "Batch result placement",
      diff: {
        addedNodeIds: ["canvas-batch-001-01"]
      }
    });
    expect(placed.assetLibrary.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "library_entry_asset-batch-001-01",
          assetId: "asset-batch-001-01",
          lineageKind: "batch_child_provider_result",
          traceId: "trace-child-001-01",
          reusable: true
        })
      ])
    );
    expect(evidence).toMatchObject({
      schema_version: "stage1.result-placement-contract.v1",
      status: "local",
      projected_child_count: 1,
      placed_canvas_object_count: 1,
      asset_library_entry_count: 1,
      latest_child_id: "child-001-01",
      latest_asset_id: "asset-batch-001-01",
      latest_canvas_object_id: "canvas-batch-001-01",
      latest_trace_id: "trace-child-001-01",
      raw_provider_payload_projected: false,
      missing_projection_count: 0
    });
  });

  it("keeps repeated progress refreshes idempotent", () => {
    const state = {
      ...createInitialWorkspace(),
      batchGenerations: [batch]
    };

    const once = applyBatchResultPlacement(state, batch);
    const twice = applyBatchResultPlacement(once, batch);

    expect(twice.canvas.nodes.filter((node) => node.id === "canvas-batch-001-01")).toHaveLength(1);
    expect(twice.assetLibrary.items.filter((item) => item.assetId === "asset-batch-001-01")).toHaveLength(1);
    expect(buildResultPlacementEvidence(twice)).toMatchObject({
      duplicate_projection_count: 0,
      projected_child_count: 1
    });
  });
});
