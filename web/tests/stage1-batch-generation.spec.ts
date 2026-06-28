import { expect, test } from "@playwright/test";

test("workspace batch generation create, progress, retry, and cancel browser workflow remains locally covered", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  const batchContract = page.getByLabel("Batch generation API contract");
  await expect(batchContract).toHaveAttribute("data-batch-generation-contract", "stage1.batch-generation-user-api");
  await expect(batchContract).toHaveAttribute("data-batch-generation-count", "0");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-status", "none");
  await expect(batchContract).toHaveAttribute("data-batch-generation-progress-polling", "idle");

  await expect(page.getByRole("button", { name: "Create Batch" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "createBatchGeneration:POST:/projects/{project_id}/batch-generations:include:X-Zenari-CSRF:true"
  );
  await expect(page.getByRole("button", { name: "Cancel Batch" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "cancelBatchGeneration:POST:/batch-generations/{batch_id}/cancel:include:X-Zenari-CSRF:true"
  );
  await expect(page.getByRole("button", { name: "Retry Child" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "retryBatchGenerationChild:POST:/batch-generation-children/{child_id}/retry:include:X-Zenari-CSRF:true"
  );

  await page.getByRole("button", { name: "Create Batch" }).click();
  await expect(batchContract).toHaveAttribute("data-batch-generation-count", "1");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-id", "batch-001");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-status", "queued");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-child-count", "4");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-progress", "25");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-failed-count", "1");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-succeeded-count", "0");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-retryable-count", "1");
  await expect(batchContract).toHaveAttribute("data-batch-generation-retryable-child-id", "child-001-04");
  await expect(batchContract).toHaveAttribute("data-batch-generation-provider", "zenari-image-sandbox");
  await expect(batchContract).toHaveAttribute("data-batch-generation-model", "image-fast-v1");
  await expect(batchContract).toHaveAttribute("data-batch-generation-progress-sync-status", "local");
  await expect(batchContract).toHaveAttribute("data-batch-generation-progress-polling", "enabled");
  await expect(batchContract).toHaveAttribute(
    "data-batch-generation-progress-operations",
    "getBatchGeneration:GET:/batch-generations/{batch_id}:include:not-required:false|listBatchGenerationChildren:GET:/batch-generations/{batch_id}/children:include:not-required:false|getBatchGenerationProgress:GET:/batch-generations/{batch_id}/progress:include:not-required:false"
  );
  await expect(page.getByRole("progressbar", { name: "Batch generation progress" })).toHaveAttribute("aria-valuenow", "25");
  await expect(page.getByText("child-001-04")).toBeVisible();
  await expect(page.getByText("failed · retry 1/2 · image-fast-v1")).toBeVisible();

  await page.getByRole("button", { name: "Retry Child" }).click();
  await expect(batchContract).toHaveAttribute("data-batch-generation-retryable-child-id", "");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-retryable-count", "0");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-failed-count", "0");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-status", "queued");
  await expect(page.getByText("child-001-04")).toBeVisible();
  await expect(page.getByText("queued · retry 2/2 · image-fast-v1")).toBeVisible();

  await page.getByRole("button", { name: "Cancel Batch" }).click();
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-status", "cancelled");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-cancelled-count", "4");
  await expect(batchContract).toHaveAttribute("data-batch-generation-latest-retryable-count", "0");
  await expect(batchContract).toHaveAttribute("data-batch-generation-progress-polling", "idle");
  await expect(page.getByRole("progressbar", { name: "Batch generation progress" })).toHaveAttribute("aria-valuenow", "100");
  await expect(page.getByText("child-001-01")).toBeVisible();
  await expect(page.getByText("cancelled · retry 0/2 · image-fast-v1")).toHaveCount(3);
  await expect(page.getByText("cancelled · retry 2/2 · image-fast-v1")).toBeVisible();
});
