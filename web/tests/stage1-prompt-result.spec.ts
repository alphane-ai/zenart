import { expect, test } from "@playwright/test";

const createdAt = "2026-06-23T08:00:00.000Z";
const promptText =
  "Localized launch poster @object[Confirmed Brief] @asset[Primary logo reference] @brand[Aurora Retail] @model[image-fast-v1] @model[image-fast-v1] @skill[Ecommerce Growth Pack] @asset[Missing Reference]";

const successfulChildren = [
  {
    id: "child-001-01",
    batch_id: "batch-001",
    tenant_id: "tenant_1",
    status: "succeeded",
    provider_id: "zenari-image-sandbox",
    model_id: "image-fast-v1",
    tool_type: "image.generate",
    seed: "batch-001-001",
    retry_count: 0,
    max_retries: 2,
    quota_estimate_units: 4,
    quota_committed_units: 4,
    quota_refunded_units: 0,
    asset_id: "asset_batch_result_1",
    canvas_object_id: "canvas_batch_result_1",
    trace_id: "trace-child-001-01",
    visible_trace_ref: "trace_projection_child-001-01",
    created_at: createdAt,
    updated_at: createdAt
  },
  {
    id: "child-001-02",
    batch_id: "batch-001",
    tenant_id: "tenant_1",
    status: "succeeded",
    provider_id: "zenari-image-sandbox",
    model_id: "image-fast-v1",
    tool_type: "image.generate",
    seed: "batch-001-002",
    retry_count: 0,
    max_retries: 2,
    quota_estimate_units: 4,
    quota_committed_units: 4,
    quota_refunded_units: 0,
    asset_id: "asset_batch_result_2",
    canvas_object_id: "canvas_batch_result_2",
    trace_id: "trace-child-001-02",
    visible_trace_ref: "trace_projection_child-001-02",
    created_at: createdAt,
    updated_at: createdAt
  }
];

async function resetWorkspace(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });
}

async function mockSuccessfulBatchRefresh(page: import("@playwright/test").Page) {
  await page.route("**/api/v1/batch-generations/batch-001", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "batch-001",
        tenant_id: "tenant_1",
        user_id: "user-dev-001",
        project_id: "project-001",
        workspace_id: "workspace-001",
        prompt_context: {
          text: promptText,
          selected_object_ids: ["node-brief"],
          reference_asset_ids: ["ref-primary-logo-reference", "asset_logo_1"],
          brand_kit_id: "brand_kit_1",
          model_hints: ["image-fast-v1"],
          tool_hint: "image.generate"
        },
        requested_count: 2,
        allowed_models: ["image-fast-v1"],
        quota_reservation_id: "quota-reservation-batch-001",
        quota_estimated_units: 8,
        quota_committed_units: 8,
        quota_refunded_units: 0,
        trace_id: "trace-batch-001",
        status: "succeeded",
        children: successfulChildren,
        metadata: {
          result_projection: "asset-and-canvas"
        },
        created_at: createdAt,
        updated_at: createdAt
      })
    });
  });

  await page.route("**/api/v1/batch-generations/batch-001/children", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        items: successfulChildren
      })
    });
  });

  await page.route("**/api/v1/batch-generations/batch-001/progress", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "batch-001",
        status: "succeeded",
        requested_count: 2,
        queued: 0,
        running: 0,
        succeeded: 2,
        failed: 0,
        cancelled: 0,
        blocked: 0,
        retryable: 0
      })
    });
  });
}

test("prompt composer, mentions, and result placement browser contract remains locally covered", async ({ page }) => {
  await resetWorkspace(page);
  await mockSuccessfulBatchRefresh(page);

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  const mentions = page.getByLabel("Mention parser and picker contract");
  await page.getByRole("textbox", { name: "Brief" }).fill(promptText);
  await expect(mentions).toHaveAttribute("data-mention-parser-picker", "stage1.mention-parser-picker-local-contract");
  await expect(mentions).toHaveAttribute("data-mention-token-count", "7");
  await expect(mentions).toHaveAttribute("data-mention-unique-count", "5");
  await expect(mentions).toHaveAttribute("data-mention-duplicate-count", "1");
  await expect(mentions).toHaveAttribute("data-mention-unresolved-count", "1");
  await expect(mentions).toHaveAttribute("data-mention-forbidden-model-count", "0");
  await expect(mentions).toHaveAttribute("data-mention-picker-types", "object,asset,brand,skill,model");
  await expect(mentions).toHaveAttribute("data-mention-projected-types", "object,asset,brand,skill,model");
  await expect(mentions).toHaveAttribute(
    "data-mention-projected-ids",
    "object:node-brief,asset:asset_logo_1,brand:brand_kit_1,model:image-fast-v1,skill:ecommerce_growth_pack"
  );
  await expect(mentions).toHaveAttribute("data-mention-unresolved-queries", "asset:Missing Reference");

  await page.getByRole("button", { name: "Confirm Brief" }).click();
  await expect(page.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeVisible();

  const promptComposer = page.getByLabel("Prompt composer controls");
  await promptComposer.getByLabel("Count").fill("2");
  await promptComposer.getByLabel("Ratio").selectOption("9:16");
  await promptComposer.getByLabel("Quality").selectOption("high");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-contract", "stage1.prompt-composer-contract.v1");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-status", "local");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-requested-count", "2");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-aspect-ratio", "9:16");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-quality", "high");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-selected-object-count", "1");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-reference-asset-count", "2");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-brand-kit-id", "brand_kit_1");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-model-hints", "image-fast-v1");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-allowed-models", "image-fast-v1");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-tool-hint", "image.generate");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-unresolved-count", "1");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-duplicate-count", "5");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-forbidden-model-count", "0");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-redaction-secret-like", "false");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-redaction-provider-payload", "false");
  await expect(promptComposer).toHaveAttribute("data-prompt-composer-operation", "createBatchGeneration");

  const batchContract = page.getByLabel("Batch generation API contract");
  await page.getByRole("button", { name: "Create Batch" }).click();
  await expect(batchContract).toHaveAttribute("data-batch-generation-count", "1");
  await expect(batchContract).toHaveAttribute("data-batch-generation-prompt-context-selected-object-ids", "node-brief");
  await expect(batchContract).toHaveAttribute(
    "data-batch-generation-prompt-context-reference-asset-ids",
    "ref-primary-logo-reference,asset_logo_1"
  );
  await expect(batchContract).toHaveAttribute("data-batch-generation-prompt-context-brand-kit-id", "brand_kit_1");
  await expect(batchContract).toHaveAttribute("data-batch-generation-prompt-context-model-hints", "image-fast-v1");
  await expect(batchContract).toHaveAttribute("data-batch-generation-prompt-context-tool-hint", "image.generate");

  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-status", "succeeded", { timeout: 5_000 });
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-progress", "100");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-succeeded-count", "2");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-retryable-count", "0");
  await expect(batchContract).toHaveAttribute("data-batch-generation-result-asset-id", "asset_batch_result_1");
  await expect(batchContract).toHaveAttribute("data-batch-generation-result-canvas-object-id", "canvas_batch_result_1");
  await expect(page.getByRole("progressbar", { name: "Batch generation progress" })).toHaveAttribute("aria-valuenow", "100");

  const canvas = page.getByLabel("Stage 1 canvas editor");
  await expect(canvas).toHaveAttribute("data-result-placement-contract", "stage1.result-placement-contract.v1");
  await expect(canvas).toHaveAttribute("data-result-placement-status", "local");
  await expect(canvas).toHaveAttribute("data-result-placement-projected-child-count", "2");
  await expect(canvas).toHaveAttribute("data-result-placement-canvas-object-count", "2");
  await expect(canvas).toHaveAttribute("data-result-placement-asset-library-entry-count", "2");
  await expect(canvas).toHaveAttribute("data-result-placement-latest-child-id", "child-001-01");
  await expect(canvas).toHaveAttribute("data-result-placement-latest-asset-id", "asset_batch_result_1");
  await expect(canvas).toHaveAttribute("data-result-placement-latest-canvas-object-id", "canvas_batch_result_1");
  await expect(canvas).toHaveAttribute("data-result-placement-latest-trace-id", "trace-child-001-01");
  await expect(canvas).toHaveAttribute("data-result-placement-duplicate-count", "0");
  await expect(canvas).toHaveAttribute("data-result-placement-missing-count", "0");
  await expect(canvas).toHaveAttribute("data-result-placement-raw-provider-payload", "false");
  await expect(page.locator("[data-canvas-node='canvas_batch_result_1']")).toBeVisible();
  await expect(page.locator("[data-asset-library-item='library_entry_asset_batch_result_1']")).toHaveAttribute(
    "data-asset-library-lineage-kind",
    "batch_child_provider_result"
  );
  await expect(page.locator("[data-asset-library-item='library_entry_asset_batch_result_1']")).toHaveAttribute(
    "data-asset-library-trace-id",
    "trace-child-001-01"
  );
});
