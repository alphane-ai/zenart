import { describe, expect, it } from "vitest";
import { DevZenariClient } from "./api-client";
import { BatchClient } from "./batch-client";
import { BillingClient } from "./billing-client";
import { AssetLibraryClient } from "./asset-library-client";
import { buildPromptComposerPayload } from "./prompt-context";
import { createInitialWorkspace, createReferenceAsset } from "./dev-state";

const billingClient = {
  getQuotaState: async () => ({ buckets: [], transactions: [] }),
  getSubscription: async () => ({
    id: "sub_test_001",
    plan_id: "plan_pro",
    status: "active",
    current_period_start: "2026-06-01T00:00:00Z"
  }),
  listInvoices: async () => ({ items: [] }),
  createCheckoutSession: async () => {
    throw new Error("not used");
  },
  createPortalSession: async () => {
    throw new Error("not used");
  },
  cancelSubscription: async () => {
    throw new Error("not used");
  },
  getTeamSeatUsage: async () => ({
    team_id: "team_1",
    tenant_id: "tenant_1",
    plan_id: "plan_pro",
    seat_limit: 5,
    active_seats: 3,
    invited_seats: 0,
    billable_seats: 3,
    available_seats: 2
  }),
  checkTeamSeatEntitlement: async () => ({
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
  }),
  acceptTeamInvite: async () => {
    throw new Error("not used");
  }
} satisfies BillingClient;

const batchClient = {
  getBatchGeneration: async () => {
    throw new Error("not used");
  },
  listBatchGenerationChildren: async () => {
    throw new Error("not used");
  },
  getBatchGenerationProgress: async () => {
    throw new Error("not used");
  }
} satisfies BatchClient;

const assetLibraryClient = {
  listAssetLibrary: async () => ({ items: [] }),
  createAssetLibraryEntry: async () => {
    throw new Error("not used");
  },
  updateAssetLibraryEntry: async () => {
    throw new Error("not used");
  },
  listBrandKits: async () => ({ items: [] }),
  createBrandKit: async () => {
    throw new Error("not used");
  },
  updateBrandKit: async () => {
    throw new Error("not used");
  },
  getProjectDefaultBrandKit: async () => {
    throw new Error("not used");
  },
  setProjectDefaultBrandKit: async () => {
    throw new Error("not used");
  }
} satisfies AssetLibraryClient;

describe("Stage 1 prompt composer payload contract", () => {
  it("projects selected objects, accepted references, Brand Kit, allowed model hints, and batch params", () => {
    const state = createInitialWorkspace();
    const payload = buildPromptComposerPayload(state, {
      text:
        "请生成 @object[Confirmed Brief] @asset[Primary logo reference] @asset[Primary logo reference] @brand[Aurora Retail] @model[image-fast-v1]",
      requestedCount: 6,
      aspectRatio: "4:5",
      quality: "high"
    });

    expect(payload).toMatchObject({
      schema_version: "stage1.prompt-composer-contract.v1",
      prompt_context_status: "local",
      requested_count: 6,
      aspect_ratio: "4:5",
      quality: "high",
      prompt_context: {
        selected_object_ids: ["node-brief"],
        reference_asset_ids: ["ref-001", "asset_logo_1"],
        brand_kit_id: "brand_kit_1",
        model_hints: ["image-fast-v1"],
        tool_hint: "image.generate"
      },
      allowed_models: ["image-fast-v1"],
      projected: {
        selected_object_count: 1,
        reference_asset_count: 2,
        brand_kit_selected: true,
        allowed_model_count: 1
      },
      blocked: {
        duplicate_mention_count: 1,
        forbidden_model_mention_count: 0
      },
      redaction: {
        raw_provider_payload_persisted: false,
        raw_hidden_prompt_projected: false,
        secret_like_value_projected: false
      },
      operations: ["createBatchGeneration"]
    });
  });

  it("blocks forbidden model mentions and rejected or archived assets from projection", () => {
    const initial = createInitialWorkspace();
    const rejectedReference = {
      ...createReferenceAsset("unsafe-reference.exe", "image"),
      id: "ref-rejected",
      validation: {
        state: "rejected" as const,
        reason: "unsupported"
      }
    };
    const state = {
      ...initial,
      brief: {
        ...initial.brief,
        references: [...initial.brief.references, rejectedReference]
      },
      assetLibrary: {
        ...initial.assetLibrary,
        items: [
          ...initial.assetLibrary.items,
          {
            ...initial.assetLibrary.items[0],
            id: "library_archived",
            assetId: "asset_archived_1",
            title: "Archived asset",
            archived: true
          }
        ]
      }
    };

    const payload = buildPromptComposerPayload(state, {
      text: "@asset[unsafe-reference.exe] @asset[Archived asset] @model[internal-shadow-model] @model[unknown-model]",
      requestedCount: 3,
      aspectRatio: "1:1",
      quality: "draft"
    });

    expect(payload.prompt_context.reference_asset_ids).toEqual(["ref-001"]);
    expect(payload.prompt_context.model_hints).toEqual([]);
    expect(payload.allowed_models).toEqual(["image-fast-v1"]);
    expect(payload.blocked).toMatchObject({
      rejected_reference_count: 1,
      archived_asset_count: 1,
      unresolved_mention_count: 1,
      forbidden_model_mention_count: 2
    });
    expect(JSON.stringify(payload.projected)).not.toContain("internal-shadow-model");
    expect(JSON.stringify(payload.projected)).not.toContain("asset_archived_1");
    expect(JSON.stringify(payload.projected)).not.toContain("ref-rejected");
  });

  it("stores the composer payload on locally created batch generations", async () => {
    const client = new DevZenariClient(billingClient, batchClient, assetLibraryClient);
    client.resetWorkspace();
    const initial = await client.loadWorkspace();
    const payload = buildPromptComposerPayload(initial, {
      text: "@object[Confirmed Brief] @asset[Primary logo reference] @brand[Aurora Retail] @model[image-fast-v1]",
      requestedCount: 5,
      aspectRatio: "9:16",
      quality: "standard"
    });

    const next = await client.createBatchGeneration(payload);

    expect(next.batchGenerations[0]).toMatchObject({
      prompt: payload.prompt_context.text,
      requestedCount: 5,
      modelId: "image-fast-v1",
      promptContext: payload.prompt_context,
      promptComposerPayload: payload
    });
    expect(next.batchGenerations[0].children).toHaveLength(5);
  });
});
