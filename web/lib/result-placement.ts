"use client";

import { AssetLibraryItem, BatchGeneration, ResultPlacementEvidence, WorkspaceState } from "./contracts";
import { createCanvasVersionSnapshot } from "./dev-state";

const placementNodeOffset = 28;

export const buildResultPlacementEvidence = (state: WorkspaceState): ResultPlacementEvidence => {
  const projectedChildren = resultChildren(state.batchGenerations);
  const latest = projectedChildren[0];
  const canvasObjectIds = new Set(projectedChildren.map((child) => child.canvasObjectId).filter(Boolean));
  const assetIds = new Set(projectedChildren.map((child) => child.assetId).filter(Boolean));
  const placedCanvasNodes = state.canvas.nodes.filter((node) => canvasObjectIds.has(node.id));
  const assetLibraryEntries = state.assetLibrary.items.filter((item) => assetIds.has(item.assetId));

  return {
    schema_version: "stage1.result-placement-contract.v1",
    status: projectedChildren.length > 0 ? "local" : "empty",
    projected_child_count: projectedChildren.length,
    placed_canvas_object_count: placedCanvasNodes.length,
    asset_library_entry_count: assetLibraryEntries.length,
    latest_child_id: latest?.id ?? "",
    latest_asset_id: latest?.assetId ?? "",
    latest_canvas_object_id: latest?.canvasObjectId ?? "",
    latest_trace_id: latest?.traceId ?? "",
    duplicate_projection_count: Math.max(0, projectedChildren.length - new Set(projectedChildren.map((child) => child.canvasObjectId)).size),
    raw_provider_payload_projected: false,
    missing_projection_count: projectedChildren.filter((child) => !child.assetId || !child.canvasObjectId || !child.traceId).length
  };
};

export const applyBatchResultPlacement = (state: WorkspaceState, batch: BatchGeneration): WorkspaceState => {
  const successfulChildren = resultChildren([batch]);
  if (successfulChildren.length === 0) {
    return state;
  }
  const existingNodeIds = new Set(state.canvas.nodes.map((node) => node.id));
  const existingAssetIds = new Set(state.assetLibrary.items.map((item) => item.assetId));
  const newNodes = successfulChildren
    .filter((child) => child.canvasObjectId && !existingNodeIds.has(child.canvasObjectId))
    .map((child, index) => ({
      id: child.canvasObjectId as string,
      title: `Batch result ${index + 1}`,
      kind: "generated_layer" as const,
      x: 360 + index * placementNodeOffset,
      y: 120 + index * placementNodeOffset,
      width: 260,
      height: 132,
      zIndex: state.canvas.nodes.length + index + 1,
      locked: false,
      hidden: false,
      body: `${child.assetId} · ${child.traceId}`
    }));
  const newAssetItems: AssetLibraryItem[] = successfulChildren
    .filter((child) => child.assetId && !existingAssetIds.has(child.assetId))
    .map((child) => ({
      id: `library_entry_${child.assetId}`,
      assetId: child.assetId as string,
      title: `Batch result ${child.id}`,
      assetType: "generated_image",
      status: "active",
      visibility: "project",
      favorite: false,
      archived: false,
      reusable: true,
      allowedProjects: [batch.projectId],
      tags: ["batch-result", child.modelId],
      lineageKind: "batch_child_provider_result",
      traceId: child.traceId,
      createdAt: child.traceId ? batch.updatedAt : new Date().toISOString(),
      updatedAt: batch.updatedAt
    }));

  if (newNodes.length === 0 && newAssetItems.length === 0) {
    return state;
  }
  const nextState = {
    ...state,
    canvas: {
      ...state.canvas,
      nodes: [...state.canvas.nodes, ...newNodes],
      edges: [
        ...state.canvas.edges,
        ...newNodes.map((node) => ({
          from: "node-brief",
          to: node.id
        }))
      ],
      autosavedAt: new Date().toISOString(),
      interaction: {
        ...state.canvas.interaction,
        selectedNodeIds: newNodes.length > 0 ? newNodes.map((node) => node.id) : state.canvas.interaction.selectedNodeIds,
        lastAction: "load" as const
      }
    },
    assetLibrary: {
      ...state.assetLibrary,
      items: [...state.assetLibrary.items, ...newAssetItems],
      operations: state.assetLibrary.operations,
      syncStatus: "local" as const,
      syncedAt: batch.updatedAt
    }
  };
  const snapshot = createCanvasVersionSnapshot(nextState, "Batch result placement");

  return {
    ...nextState,
    canvas: {
      ...nextState.canvas,
      versions: [...nextState.canvas.versions, snapshot],
      activeVersionId: snapshot.id
    }
  };
};

const resultChildren = (batches: BatchGeneration[]) =>
  batches.flatMap((batch) =>
    batch.children.filter(
      (child) =>
        child.status === "succeeded" &&
        Boolean(child.assetId) &&
        Boolean(child.canvasObjectId) &&
        Boolean(child.traceId)
    )
  );
