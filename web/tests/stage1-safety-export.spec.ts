import { expect, test } from "@playwright/test";

const safetyExportContract = "stage1.safety-export-state-local-contract.v1";

async function clearLocalStorageOnce(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("zenari-stage1-safety-export-reset")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("zenari-stage1-safety-export-reset", "true");
    }
  });
}

async function createPackagedStudioExport(page: import("@playwright/test").Page, brief?: string) {
  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  if (brief) {
    await page.getByRole("textbox", { name: "Brief" }).fill(brief);
    await page.getByRole("button", { name: "Confirm Brief" }).click();
  }

  await page.getByRole("button", { name: "Select Studio System" }).click();
  await page.getByTestId("package-add-selected").click();
  await page.getByTestId("export-download").click();
}

test("blocked safety exports suppress download and share controls", async ({ page }) => {
  await clearLocalStorageOnce(page);

  await createPackagedStudioExport(page, "Campaign visual with phishing and secret key instructions.");

  const safetyState = page.getByLabel("Package export safety state");
  await expect(safetyState).toHaveAttribute("data-safety-export-state-contract", safetyExportContract);
  await expect(safetyState).toHaveAttribute("data-safety-export-state-status", "pass");
  await expect(safetyState).toHaveAttribute("data-safety-export-total-count", "1");
  await expect(safetyState).toHaveAttribute("data-safety-export-ready-count", "0");
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-count", "1");
  await expect(safetyState).toHaveAttribute("data-safety-export-qa-block-count", "0");
  await expect(safetyState).toHaveAttribute("data-safety-export-safety-block-count", "4");
  await expect(safetyState).toHaveAttribute("data-safety-export-admin-review-required-count", "0");
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-download-cta-count", "0");
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-share-cta-count", "0");
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-without-download-count", "1");
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-without-share-count", "1");
  await expect(safetyState).toHaveAttribute("data-safety-export-latest-export-id", "export-001");
  await expect(safetyState).toHaveAttribute("data-safety-export-latest-status", "blocked");
  await expect(safetyState).toHaveAttribute("data-safety-export-latest-blocked-reason", "export_status_blocked");
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-reasons", /safety_policy_block/);
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-reasons", /safety:brief:safety-illegal-abuse-v1/);
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-reasons", /safety:brief:safety-private-data-v1/);
  await expect(safetyState).toHaveAttribute("data-safety-export-raw-provider-payload", "false");
  await expect(safetyState).toHaveAttribute("data-safety-export-raw-safety-payload", "false");
  await expect(safetyState).toHaveAttribute("data-safety-export-secret-like-projected", "false");
  await expect(safetyState).toHaveAttribute("data-safety-export-can-clear-staging", "false");

  const record = page.locator("[data-safety-export-record-id='export-001']");
  await expect(record).toHaveAttribute("data-safety-export-record-status", "blocked");
  await expect(record).toHaveAttribute("data-safety-export-record-download-eligible", "false");
  await expect(record).toHaveAttribute("data-safety-export-record-share-eligible", "false");
  await expect(record).toHaveAttribute("data-safety-export-record-blocked-reasons", /safety_policy_block/);
  await expect(page.locator("[data-export-download-id='export-001']")).toHaveCount(0);
  await expect(page.locator("[data-safety-export-download-disabled-reason]")).toHaveAttribute(
    "data-safety-export-download-disabled-reason",
    /export_status_blocked/
  );

  const shareState = page.locator("[data-safety-export-share-export-id='export-001']");
  await expect(shareState).toHaveAttribute("data-safety-export-share-status", "blocked");
  await expect(shareState).toHaveAttribute("data-safety-export-share-disabled-reason", /export_status_blocked/);
  await expect(shareState.locator("[data-safety-export-share-cta]")).toHaveAttribute("data-safety-export-share-cta", "blocked");

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export Preview" })).toBeVisible();
  const exportSafetyState = page.getByLabel("Safety export state");
  await expect(exportSafetyState).toHaveAttribute("data-safety-export-state-contract", safetyExportContract);
  await expect(exportSafetyState).toHaveAttribute("data-safety-export-blocked-count", "1");
  await expect(exportSafetyState).toHaveAttribute("data-safety-export-safety-block-count", "4");
  await expect(exportSafetyState).toHaveAttribute("data-safety-export-blocked-download-cta-count", "0");
  await expect(exportSafetyState).toHaveAttribute("data-safety-export-blocked-share-cta-count", "0");

  const safetyPolicy = page.getByLabel("Safety policy report");
  await expect(safetyPolicy).toHaveAttribute("data-safety-policy-status", "block");
  await expect(safetyPolicy).toHaveAttribute("data-safety-policy-stage-count", "5");
  await expect(safetyPolicy).toHaveAttribute("data-safety-policy-finding-count", "4");
});

test("entitlement blocked exports require review without exposing export actions", async ({ page }) => {
  await clearLocalStorageOnce(page);

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Billing and Quota" })).toBeVisible();
  await page.getByRole("button", { name: "Past Due" }).click();
  await expect(page.getByText("Status: past_due")).toBeVisible();

  await createPackagedStudioExport(page);

  const safetyState = page.getByLabel("Package export safety state");
  await expect(safetyState).toHaveAttribute("data-safety-export-state-contract", safetyExportContract);
  await expect(safetyState).toHaveAttribute("data-safety-export-state-status", "pass");
  await expect(safetyState).toHaveAttribute("data-safety-export-total-count", "1");
  await expect(safetyState).toHaveAttribute("data-safety-export-ready-count", "0");
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-count", "1");
  await expect(safetyState).toHaveAttribute("data-safety-export-qa-block-count", "1");
  await expect(safetyState).toHaveAttribute("data-safety-export-safety-block-count", "0");
  await expect(safetyState).toHaveAttribute("data-safety-export-admin-review-required-count", "1");
  await expect(safetyState).toHaveAttribute("data-safety-export-latest-export-id", "export-001");
  await expect(safetyState).toHaveAttribute("data-safety-export-latest-status", "blocked");
  await expect(safetyState).toHaveAttribute("data-safety-export-latest-blocked-reason", "export_status_blocked");
  await expect(safetyState).toHaveAttribute("data-safety-export-blocked-reasons", /qa:qa-entitlement/);
  await expect(safetyState).toHaveAttribute("data-safety-export-raw-provider-payload", "false");
  await expect(safetyState).toHaveAttribute("data-safety-export-raw-safety-payload", "false");
  await expect(safetyState).toHaveAttribute("data-safety-export-secret-like-projected", "false");
  await expect(safetyState).toHaveAttribute("data-safety-export-can-clear-staging", "false");

  const record = page.locator("[data-safety-export-record-id='export-001']");
  await expect(record).toHaveAttribute("data-safety-export-record-status", "blocked");
  await expect(record).toHaveAttribute("data-safety-export-record-blocked-reasons", /qa:qa-entitlement/);
  await expect(record).toHaveAttribute("data-safety-export-record-download-eligible", "false");
  await expect(record).toHaveAttribute("data-safety-export-record-share-eligible", "false");
  await expect(record.getByText("Subscription action required")).toBeVisible();
  await expect(page.locator("[data-export-download-id='export-001']")).toHaveCount(0);

  const shareState = page.locator("[data-safety-export-share-export-id='export-001']");
  await expect(shareState).toHaveAttribute("data-safety-export-share-status", "blocked");
  await expect(shareState).toHaveAttribute("data-safety-export-share-disabled-reason", /qa:qa-entitlement/);
  await expect(shareState.locator("[data-safety-export-share-cta]")).toHaveAttribute("data-safety-export-share-cta", "blocked");
});
