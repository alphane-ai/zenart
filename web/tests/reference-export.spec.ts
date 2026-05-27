import { expect, test } from "@playwright/test";

test("reference upload browser smoke reaches ready export metadata and render budget evidence", async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("zenart-reference-export-smoke-reset")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("zenart-reference-export-smoke-reset", "true");
    }
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  const referenceValidation = page.getByLabel("Reference upload validation matrix");
  await expect(referenceValidation).toHaveAttribute(
    "data-reference-upload-validation-matrix",
    "stage0.rev2.reference-upload-validation-matrix"
  );
  await expect(referenceValidation).toHaveAttribute("data-reference-upload-validation-status", "pass");
  await expect(referenceValidation).toHaveAttribute("data-reference-upload-validation-accepted-kinds", "image,document,url");
  await expect(referenceValidation).toHaveAttribute("data-reference-upload-validation-rejected-count", "2");

  await page.getByRole("textbox", { name: "Brief" }).fill(
    "Create an ecommerce reference export smoke package with product image provenance, presentation handoff metadata, and web/social ZIP assets."
  );
  await page.getByRole("button", { name: "Confirm Brief" }).click();
  await expect(page.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeVisible();

  await page.getByLabel("Reference asset name or URL").fill("campaign-reference.webp");
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("button", { name: "Add reference campaign-reference.webp to package" })).toBeVisible();
  await page.getByRole("button", { name: "Add reference campaign-reference.webp to package" }).click();

  const referenceSmoke = page.locator("[data-reference-upload-integration-smoke='stage0.rev2.reference-upload-integration-smoke']");
  await expect(referenceSmoke).toHaveAttribute(
    "data-reference-upload-integration-operations",
    "createUpload,createPackage,createExport,getExport"
  );
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-accepted-id", "ref-campaign-reference-webp");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-packaged", "true");

  await page.getByRole("button", { name: "Select Studio System" }).click();
  await expect(page.getByRole("button", { name: "Select Studio System" })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("package-add-selected").click();
  await expect(page.getByText("Studio System").nth(1)).toBeVisible();

  await page.getByTestId("export-download").click();
  await expect(page.getByText("zenart-001.zip")).toBeVisible();
  await expect(referenceSmoke).toHaveAttribute("data-reference-upload-integration-status", "pass");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-provenance-present", "true");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-ppt-slide-present", "true");
  await expect(referenceSmoke).toHaveAttribute("data-reference-upload-integration-failures", "");

  const renderingSmoke = page.locator("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
  await expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
  await expect(renderingSmoke).toHaveAttribute("data-render-failure-count", "0");
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /brief-confirm/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /candidate-select/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /package-add/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /export-ready/);
  const renderElementCount = Number(await renderingSmoke.getAttribute("data-render-element-count"));
  const renderMaxElements = Number(await renderingSmoke.getAttribute("data-render-max-elements"));
  expect(renderElementCount).toBeLessThanOrEqual(renderMaxElements);

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export Preview" })).toBeVisible();

  const referenceContract = page.getByLabel("Reference upload to ready ZIP export contract");
  await expect(referenceContract).toHaveAttribute("data-reference-provenance-count", "1");
  await expect(referenceContract).toContainText("dev-client-reference:ref-campaign-reference-webp");

  const metadataEvidence = page.locator("[data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui']");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-metadata-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-item-types", "reference,candidate");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-parity-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-payload-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-trace-provenance-payload-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ai-content-disclaimer-payload-present", "true");

  const payloadMatrix = page.getByLabel("Package export payload status matrix");
  await expect(payloadMatrix.locator("[data-package-export-payload-row='manifest-output']")).toHaveCount(14);
  await expect(
    payloadMatrix.locator("[data-package-export-payload-row='workflow-payload'][data-package-export-payload-name='metadata.json']")
  ).toHaveAttribute("data-package-export-payload-present", "true");
  await expect(
    payloadMatrix.locator("[data-package-export-payload-row='workflow-payload'][data-package-export-payload-name='trace_provenance.json']")
  ).toHaveAttribute("data-package-export-payload-present", "true");

  const downloadParity = page.getByLabel("Export download parity smoke");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payloads-match", "true");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-failures", "");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("zenart-001.zip");
});
