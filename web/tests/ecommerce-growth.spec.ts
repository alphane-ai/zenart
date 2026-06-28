import { expect, test } from "@playwright/test";

const candidateLabels = ["Editorial Clarity", "Studio System", "Gallery Motion", "Utility Kit"] as const;

test("ecommerce growth pack user-web happy path exposes API, render, export, and download evidence", async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("zenari-ecommerce-smoke-reset")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("zenari-ecommerce-smoke-reset", "true");
    }
  });
  await page.goto("/workspace");

  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  await page.getByRole("textbox", { name: "Brief" }).fill(
    "Create an ecommerce growth package for the Aurora bottle using the uploaded packshot reference, shopper audience, and web, social, marketplace, and presentation export surfaces."
  );
  await page.getByRole("button", { name: "Confirm Brief" }).click();
  await expect(page.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeVisible();

  await page.getByLabel("Reference asset name or URL").fill("aurora-packshot.webp");
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("button", { name: "Add reference aurora-packshot.webp to package" })).toBeVisible();

  const candidateGrid = page.getByTestId("candidate-grid");
  await expect(candidateGrid.locator("article")).toHaveCount(4);
  for (const taxonomy of ["conversion_offer", "social_proof", "feature_comparison", "retention_bundle"]) {
    await expect(page.getByTestId(`candidate-card-${taxonomy}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Select Editorial Clarity" }).click();
  await expect(page.getByRole("button", { name: "Select Editorial Clarity" })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Iteration instruction").fill(
    "Refine the ecommerce story for clearer offer hierarchy and handoff notes."
  );
  await page.getByRole("button", { name: "Iterate" }).click();
  await expect(
    page.getByText("Editorial Clarity refined with: Refine the ecommerce story for clearer offer hierarchy and handoff notes.")
  ).toBeVisible();

  for (const candidateLabel of candidateLabels) {
    await page.getByRole("button", { name: `Select ${candidateLabel}` }).click();
    await expect(page.getByRole("button", { name: `Select ${candidateLabel}` })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("package-add-selected").click();
    await expect(page.getByText(candidateLabel).nth(1)).toBeVisible();
  }

  await page.getByTestId("export-download").click();
  await expect(page.getByText("zenari-001.zip")).toBeVisible();

  const workflowSmoke = page.locator("[data-workflow-api-smoke='stage0.rev2.workflow-api-smoke']");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-status", "pass");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-workflow", "ecommerce_growth_pack");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-fixture", "fx_ecommerce_growth_golden");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-packaged-taxonomy-count", "4");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-ready-zip-export-count", "1");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-missing-output-count", "0");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-csrf-protected-operation-count", "6");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-idempotency-required-operation-count", "6");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-failures", "");
  await expect(workflowSmoke).toHaveAttribute(
    "data-workflow-api-smoke-operations",
    "createChatSession,createChatMessage,createCandidateSet,listCandidateAssets,selectDirection,createPackage,createExport,getExport"
  );
  await expect(workflowSmoke).toHaveAttribute(
    "data-workflow-api-smoke-operation-contracts",
    /createExport:POST:\/packages\/\{package_id\}\/exports:include:X-Zenari-CSRF:true/
  );

  const renderingSmoke = page.locator("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
  await expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
  await expect(renderingSmoke).toHaveAttribute("data-render-failure-count", "0");
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /brief-confirm/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /candidate-select/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /iteration/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /package-add/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /export-ready/);

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export Preview" })).toBeVisible();

  const exportSmoke = page.locator("[data-workflow-api-smoke-export='stage0.rev2.workflow-api-smoke']");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-status", "pass");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-operation-count", "8");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-missing-output-count", "0");

  const metadataEvidence = page.locator("[data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui']");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-metadata-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-id", "ecommerce_growth_pack");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-manifest-required-output-count", "14");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-parity-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-provider", "dev-provider");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-model", "deterministic-local-alpha");

  const downloadParity = page.getByLabel("Export download parity smoke");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payloads-match", "true");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-failures", "");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("zenari-001.zip");
});
