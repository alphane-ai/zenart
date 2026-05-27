import { expect, test } from "@playwright/test";

test("export route exposes package metadata, ZIP payload, and download parity browser evidence", async ({ page }) => {
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("zenart-package-export-metadata-smoke-reset")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("zenart-package-export-metadata-smoke-reset", "true");
    }
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();
  await page.getByRole("textbox", { name: "Brief" }).fill(
    "Create an ecommerce package/export metadata smoke with reference provenance, workflow metadata, and ready ZIP handoff evidence."
  );
  await page.getByRole("button", { name: "Confirm Brief" }).click();
  await expect(page.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeVisible();

  await page.getByLabel("Reference asset name or URL").fill("campaign-reference.webp");
  await page.getByRole("button", { name: "Attach" }).click();
  await page.getByRole("button", { name: "Add reference campaign-reference.webp to package" }).click();
  await page.getByRole("button", { name: "Select Studio System" }).click();
  await page.getByTestId("package-add-selected").click();
  await page.getByTestId("export-download").click();
  await expect(page.getByText("zenart-001.zip")).toBeVisible();

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export Preview" })).toBeVisible();

  const metadataEvidence = page.locator("[data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui']");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-metadata-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-id", "export-001");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-package-id", "pkg-002");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-project-id", "project-001");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-manifest-item-count", "2");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-manifest-required-output-count", "14");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-download-artifact-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-download-artifact-format", "zip");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-item-types", "reference,candidate");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-zip-payload-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-provenance-count", "2");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-blocking-qa-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-safety-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-safety-stage-count", "5");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-safety-finding-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-aspect-ratio", "16:9");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-slide-count", "2");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-canvas-size", "1920x1080");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-safe-area", "72/96/72/96");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-theme-font", "Inter, Arial, sans-serif");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-handoff-checklist-count", "5");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-required-zip-payload-count", "7");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-parity-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-parity-ratio", "7/7");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-id", "ecommerce_growth_pack");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-fixture-id", "fx_ecommerce_growth_golden");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-payload-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-trace-provenance-payload-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ai-content-disclaimer-payload-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-provider-metadata-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-prompt-spec-metadata-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-skill-metadata-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-safety-metadata-present", "true");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-provider", "dev-provider");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-model", "deterministic-local-alpha");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-skill", "ecommerce_growth_pack");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-safety", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payloads", /manifest\.json/);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payloads", /metadata\.json/);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payloads", /trace_provenance\.json/);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payloads", /ai-content-disclaimer\.json/);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-required-zip-payloads", /assets\/README\.txt/);
  expect(Number(await metadataEvidence.getAttribute("data-package-export-zip-payload-count"))).toBeGreaterThanOrEqual(14);

  const payloadMatrix = page.getByLabel("Package export payload status matrix");
  await expect(payloadMatrix.locator("[data-package-export-payload-row='manifest-output']")).toHaveCount(14);
  await expect(payloadMatrix.locator("[data-package-export-payload-row='required-zip-payload']")).toHaveCount(7);
  await expect(payloadMatrix.locator("[data-package-export-payload-row='workflow-payload']")).toHaveCount(8);
  await expect(
    payloadMatrix.locator("[data-package-export-payload-row='manifest-output'][data-package-export-payload-name='manifest.json']")
  ).toHaveAttribute("data-package-export-payload-present", "true");
  await expect(
    payloadMatrix.locator("[data-package-export-payload-row='required-zip-payload'][data-package-export-payload-name='safety-policy-report.json']")
  ).toHaveAttribute("data-package-export-payload-present", "true");
  await expect(
    payloadMatrix.locator("[data-package-export-payload-row='workflow-payload'][data-package-export-payload-name='metadata.json']")
  ).toHaveAttribute("data-package-export-payload-present", "true");
  await expect(
    payloadMatrix.locator("[data-package-export-payload-row='workflow-payload'][data-package-export-payload-name='trace_provenance.json']")
  ).toHaveAttribute("data-package-export-payload-present", "true");

  const zipPayloadSmoke = page.getByLabel("Export ZIP payload smoke");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-smoke", "stage0.rev2.export-zip-payload-smoke");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-smoke-status", "pass");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-expected-count", "14");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-missing-count", "0");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-metadata-present", "true");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-trace-provenance-present", "true");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-ai-content-disclaimer-present", "true");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-assets-present", "true");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-failures", "");

  const downloadParity = page.getByLabel("Export download parity smoke");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-smoke", "stage0.rev2.export-download-parity-smoke");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-file-name", "zenart-001.zip");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-format", "zip");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-metadata-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-zip-payload-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-handoff-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-metadata-payload-count", "14");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-zip-expected-count", "14");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-metadata-missing-count", "0");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-zip-missing-count", "0");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-required-zip-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payloads-match", "true");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-workflow-metadata-present", "true");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-trace-provenance-present", "true");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-failures", "");

  const downloadHandoff = page.getByRole("button", { name: "Download" });
  await expect(downloadHandoff).toHaveAttribute("data-export-download-handoff", "stage0.rev2.package-export-download-handoff");
  await expect(downloadHandoff).toHaveAttribute("data-export-download-handoff-status", "pass");
  await expect(downloadHandoff).toHaveAttribute("data-export-download-file-name", "zenart-001.zip");
  await expect(downloadHandoff).toHaveAttribute("data-export-download-format", "zip");
  await expect(downloadHandoff).toHaveAttribute("data-export-download-zip-payload-status", "pass");
  await expect(downloadHandoff).toHaveAttribute("data-export-download-missing-payload-count", "0");

  const downloadPromise = page.waitForEvent("download");
  await downloadHandoff.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("zenart-001.zip");
});
