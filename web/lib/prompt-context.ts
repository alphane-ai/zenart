"use client";

import {
  PromptComposerAspectRatio,
  PromptComposerPayload,
  PromptComposerQuality,
  WorkspaceState
} from "./contracts";
import { MentionOption, buildMentionPickerOptions, resolveMentions } from "./mentions";

export type PromptComposerInput = {
  text: string;
  requestedCount: number;
  aspectRatio: PromptComposerAspectRatio;
  quality: PromptComposerQuality;
  toolHint?: string;
  explicitSelectedObjectIds?: string[];
  explicitReferenceAssetIds?: string[];
  mentionOptions?: MentionOption[];
  skills?: MentionOption[];
  models?: MentionOption[];
};

const secretLikePattern =
  /sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}/i;

export const defaultPromptComposerModels: MentionOption[] = [
  { type: "model", id: "image-fast-v1", label: "image-fast-v1", allowed: true },
  { type: "model", id: "deterministic-local-alpha", label: "deterministic-local-alpha", allowed: true },
  { type: "model", id: "internal-shadow-model", label: "internal-shadow-model", allowed: false }
];

export const defaultPromptComposerSkills: MentionOption[] = [
  { type: "skill", id: "ecommerce_growth_pack", label: "Ecommerce Growth Pack", allowed: true },
  { type: "skill", id: "business_visual_doc_pack", label: "Business Visual Document Pack", allowed: true },
  { type: "skill", id: "local_merchant_campaign_pack", label: "Local Merchant Campaign Pack", allowed: true },
  { type: "skill", id: "character_ip_concept_pack", label: "Character IP Concept Pack", allowed: true }
];

export const buildPromptComposerMentionOptions = (
  state: WorkspaceState,
  skills: MentionOption[] = defaultPromptComposerSkills,
  models: MentionOption[] = defaultPromptComposerModels
) =>
  buildMentionPickerOptions({
    objects: state.canvas.nodes,
    references: state.brief.references,
    assetLibraryItems: state.assetLibrary.items,
    brandKits: state.assetLibrary.brandKits,
    skills,
    models
  });

export const buildPromptComposerPayload = (state: WorkspaceState, input: PromptComposerInput): PromptComposerPayload => {
  const mentionOptions = input.mentionOptions ?? buildPromptComposerMentionOptions(state, input.skills, input.models);
  const mentionResult = resolveMentions(input.text, mentionOptions);
  const allowedUniqueMentions = mentionResult.uniqueResolutions.filter((item) => item.allowed);
  const activeNodeIds = new Set(state.canvas.nodes.filter((node) => !node.hidden).map((node) => node.id));
  const hiddenObjectMentionCount = mentionResult.uniqueResolutions.filter((item) => item.type === "object" && !item.allowed).length;
  const selectedObjectIds = unique([
    ...(input.explicitSelectedObjectIds ?? state.canvas.interaction.selectedNodeIds).filter((id) => activeNodeIds.has(id)),
    ...allowedUniqueMentions.filter((item) => item.type === "object").map((item) => item.id)
  ]);
  const acceptedReferenceIds = new Set(
    state.brief.references.filter((reference) => reference.validation.state === "accepted").map((reference) => reference.id)
  );
  const reusableAssetIds = new Set(
    state.assetLibrary.items
      .filter((item) => item.status === "active" && item.reusable && !item.archived)
      .map((item) => item.assetId)
  );
  const rejectedReferenceCount = state.brief.references.filter((reference) => reference.validation.state === "rejected").length;
  const archivedAssetCount = state.assetLibrary.items.filter((item) => item.archived || item.status !== "active" || !item.reusable).length;
  const referenceAssetIds = unique([
    ...(input.explicitReferenceAssetIds ?? state.brief.references.map((reference) => reference.id)).filter(
      (id) => acceptedReferenceIds.has(id) || reusableAssetIds.has(id)
    ),
    ...allowedUniqueMentions
      .filter((item) => item.type === "asset")
      .map((item) => item.id)
      .filter((id) => acceptedReferenceIds.has(id) || reusableAssetIds.has(id))
  ]);
  const brandKitId =
    allowedUniqueMentions.find((item) => item.type === "brand")?.id ??
    state.assetLibrary.defaultBrandKit?.id ??
    state.assetLibrary.brandKits.find((kit) => kit.status === "active")?.id;
  const modelHints = unique(
    allowedUniqueMentions
      .filter((item) => item.type === "model")
      .map((item) => item.id)
      .filter((id) => mentionOptions.some((option) => option.type === "model" && option.id === id && option.allowed))
  );
  const allowedModels = modelHints.length > 0 ? modelHints : ["image-fast-v1"];
  const projectedHasSecretLikeValue = payloadHasSecretLikeValue({
    selectedObjectIds,
    referenceAssetIds,
    brandKitId: brandKitId ?? "",
    modelHints,
    allowedModels
  });
  const sanitizedText = input.text.trim() || state.brief.prompt;

  return {
    schema_version: "stage1.prompt-composer-contract.v1",
    prompt_context_status: "local",
    prompt_context: {
      text: sanitizedText,
      selected_object_ids: selectedObjectIds,
      reference_asset_ids: referenceAssetIds,
      brand_kit_id: brandKitId,
      model_hints: modelHints,
      tool_hint: input.toolHint ?? "image.generate"
    },
    requested_count: clampRequestedCount(input.requestedCount),
    aspect_ratio: input.aspectRatio,
    quality: input.quality,
    allowed_models: allowedModels,
    projected: {
      selected_object_count: selectedObjectIds.length,
      reference_asset_count: referenceAssetIds.length,
      brand_kit_selected: Boolean(brandKitId),
      allowed_model_count: allowedModels.length,
      selected_object_ids: selectedObjectIds,
      reference_asset_ids: referenceAssetIds,
      brand_kit_id: brandKitId ?? "",
      model_hints: modelHints
    },
    blocked: {
      hidden_object_count: hiddenObjectMentionCount,
      rejected_reference_count: rejectedReferenceCount,
      archived_asset_count: archivedAssetCount,
      unresolved_mention_count: mentionResult.unresolved.length,
      duplicate_mention_count: mentionResult.duplicateCount,
      forbidden_model_mention_count: mentionResult.forbiddenModelMentions.length + (projectedHasSecretLikeValue ? 1 : 0)
    },
    redaction: {
      raw_provider_payload_persisted: false,
      raw_hidden_prompt_projected: false,
      secret_like_value_projected: false
    },
    operations: ["createBatchGeneration"]
  };
};

const clampRequestedCount = (value: number) => Math.max(1, Math.min(20, Math.floor(Number.isFinite(value) ? value : 1)));

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

const payloadHasSecretLikeValue = (payload: unknown) => secretLikePattern.test(JSON.stringify(payload));
