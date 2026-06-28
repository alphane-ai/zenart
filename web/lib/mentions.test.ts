import { describe, expect, it } from "vitest";
import { buildMentionPickerOptions, mentionSummary, parseMentionTokens, resolveMentions } from "./mentions";
import { createInitialWorkspace, ecommerceGrowthWorkflowAcceptance } from "./dev-state";

const mentionOptions = () => {
  const state = createInitialWorkspace();
  return buildMentionPickerOptions({
    objects: state.canvas.nodes,
    references: state.brief.references,
    assetLibraryItems: state.assetLibrary.items,
    brandKits: state.assetLibrary.brandKits,
    skills: [
      {
        type: "skill",
        id: ecommerceGrowthWorkflowAcceptance.workflow_id,
        label: "Ecommerce Growth Pack",
        allowed: true
      }
    ],
    models: [
      {
        type: "model",
        id: "image-fast-v1",
        label: "image-fast-v1",
        allowed: true
      },
      {
        type: "model",
        id: "internal-shadow-model",
        label: "internal-shadow-model",
        allowed: false
      }
    ]
  });
};

describe("Stage 1 mention parser and picker contract", () => {
  it("parses object, asset, brand, skill, and model mentions with Chinese and spaces", () => {
    const text =
      "请用 @object[Confirmed Brief] 和 @asset[Primary logo reference]，保持 @brand[Aurora Retail]，技能 @skill[Ecommerce Growth Pack]，模型 @model[image-fast-v1]。";

    const tokens = parseMentionTokens(text);
    expect(tokens.map((token) => `${token.type}:${token.query}`)).toEqual([
      "object:Confirmed Brief",
      "asset:Primary logo reference",
      "brand:Aurora Retail",
      "skill:Ecommerce Growth Pack",
      "model:image-fast-v1"
    ]);
    expect(tokens[0].start).toBeGreaterThan(0);
  });

  it("resolves mentions through picker options and deduplicates repeated refs", () => {
    const result = resolveMentions(
      "@asset[Primary logo reference] @asset[Primary logo reference] @object[node-brief] @brand[brand_kit_1] @skill[ecommerce_growth_pack] @model[image-fast-v1]",
      mentionOptions()
    );

    expect(result.tokens).toHaveLength(6);
    expect(result.uniqueResolutions.map((item) => `${item.type}:${item.id}`)).toEqual([
      "asset:asset_logo_1",
      "object:node-brief",
      "brand:brand_kit_1",
      "skill:ecommerce_growth_pack",
      "model:image-fast-v1"
    ]);
    expect(result.duplicateCount).toBe(1);
    expect(result.unresolved).toHaveLength(0);
    expect(mentionSummary(result)).toMatchObject({
      tokenCount: 6,
      uniqueCount: 5,
      duplicateCount: 1,
      unresolvedCount: 0,
      forbiddenModelCount: 0
    });
  });

  it("keeps unresolved mentions and blocks non-allowed model mentions from projection", () => {
    const result = resolveMentions(
      "@asset[不存在的素材] @model[internal-shadow-model] @model[unknown-model]",
      mentionOptions()
    );

    expect(result.unresolved.map((token) => `${token.type}:${token.query}`)).toEqual(["asset:不存在的素材", "model:unknown-model"]);
    expect(result.forbiddenModelMentions.map((item) => item.query)).toEqual(["internal-shadow-model", "unknown-model"]);
    expect(mentionSummary(result)).toMatchObject({
      tokenCount: 3,
      uniqueCount: 1,
      unresolvedCount: 2,
      forbiddenModelCount: 2
    });
  });
});
