import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

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
  await expect(referenceValidation).toHaveAttribute("data-reference-upload-validation-accepted-attached-count", "3");
  await expect(referenceValidation).toHaveAttribute("data-reference-upload-validation-rejected-count", "2");
  await expect(referenceValidation).toHaveAttribute("data-reference-upload-validation-rejected-queued-count", "2");
  await expect(referenceValidation).toHaveAttribute("data-reference-upload-validation-rejected-package-action-count", "0");
  await expect(referenceValidation).toHaveAttribute(
    "data-reference-upload-validation-rejected-reasons",
    "Images must be PNG, JPG, JPEG, or WEBP files.|Reference URLs must use HTTPS."
  );

  await page.getByRole("textbox", { name: "Brief" }).fill(
    "Create an ecommerce reference export smoke package with product image provenance, presentation handoff metadata, and web/social ZIP assets."
  );
  await page.getByRole("button", { name: "Confirm Brief" }).click();
  await expect(page.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeVisible();

  await page.getByLabel("Reference asset name or URL").fill("campaign-reference.webp");
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("button", { name: "Add reference campaign-reference.webp to package" })).toBeVisible();
  await page.getByRole("button", { name: "Add reference campaign-reference.webp to package" }).click();

  await page.getByLabel("Reference asset name or URL").fill("unsafe-reference.exe");
  await page.getByRole("button", { name: "Attach" }).click();
  const rejectedFileReference = page.locator("[data-reference-upload-item='ref-unsafe-reference-exe']");
  await expect(rejectedFileReference).toHaveAttribute("data-reference-upload-state", "rejected");
  await expect(rejectedFileReference).toHaveAttribute(
    "data-reference-upload-rejection-reason",
    "Images must be PNG, JPG, JPEG, or WEBP files."
  );
  await expect(rejectedFileReference).toHaveAttribute("data-reference-upload-package-action", "blocked");
  await expect(page.getByRole("button", { name: "Add reference unsafe-reference.exe to package" })).toHaveCount(0);

  await page.getByLabel("Reference type").selectOption("url");
  await page.getByLabel("Reference asset name or URL").fill("http://assets.example.com/reference-pack");
  await page.getByRole("button", { name: "Attach" }).click();
  const rejectedUrlReference = page.locator("[data-reference-upload-item='ref-http-assets-example-com-reference-pack']");
  await expect(rejectedUrlReference).toHaveAttribute("data-reference-upload-state", "rejected");
  await expect(rejectedUrlReference).toHaveAttribute("data-reference-upload-rejection-reason", "Reference URLs must use HTTPS.");
  await expect(rejectedUrlReference).toHaveAttribute("data-reference-upload-package-action", "blocked");
  await expect(page.getByRole("button", { name: "Add reference http://assets.example.com/reference-pack to package" })).toHaveCount(0);
  await page.getByLabel("Reference type").selectOption("image");

  const referenceSmoke = page.locator("[data-reference-upload-integration-smoke='stage0.rev2.reference-upload-integration-smoke']");
  await expect(referenceSmoke).toHaveAttribute(
    "data-reference-upload-integration-operations",
    "createUpload,createPackage,createExport,getExport"
  );
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-accepted-id", "ref-campaign-reference-webp");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-upload-method", "POST");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-upload-path", "/uploads");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-upload-csrf-header", "X-ZenArt-CSRF");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-upload-idempotency-required", "true");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-preview-scope", "tenant-scoped-dev-preview");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-packaged", "true");

  const uploadedReference = page.locator("[data-reference-upload-item='ref-campaign-reference-webp']");
  await expect(uploadedReference).toHaveAttribute("data-reference-upload-state", "accepted");
  await expect(uploadedReference).toHaveAttribute("data-reference-upload-operation", "createUpload");
  await expect(uploadedReference).toHaveAttribute("data-reference-upload-method", "POST");
  await expect(uploadedReference).toHaveAttribute("data-reference-upload-path", "/uploads");
  await expect(uploadedReference).toHaveAttribute("data-reference-upload-csrf-header", "X-ZenArt-CSRF");
  await expect(uploadedReference).toHaveAttribute("data-reference-upload-idempotency-required", "true");
  await expect(uploadedReference).toHaveAttribute("data-reference-upload-preview-scope", "tenant-scoped-dev-preview");

  await page.getByRole("button", { name: "Select Studio System" }).click();
  await expect(page.getByRole("button", { name: "Select Studio System" })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("package-add-selected").click();
  await expect(page.getByText("Studio System").nth(1)).toBeVisible();

  await page.getByTestId("export-download").click();
  await expect(page.getByText("zenart-001.zip")).toBeVisible();
  await expect(referenceSmoke).toHaveAttribute("data-reference-upload-integration-status", "pass");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-provenance-present", "true");
  await expect(referenceSmoke).toHaveAttribute("data-reference-latest-ppt-slide-present", "true");
  await expect(referenceSmoke).toHaveAttribute("data-reference-upload-request-contract-count", "2");
  await expect(referenceSmoke).toHaveAttribute("data-reference-rejected-packaged-count", "0");
  await expect(referenceSmoke).toHaveAttribute("data-reference-rejected-exported-count", "0");
  await expect(referenceSmoke).toHaveAttribute("data-reference-upload-integration-failures", "");

  const renderingSmoke = page.locator("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
  await expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
  await expect(renderingSmoke).toHaveAttribute("data-render-failure-count", "0");
  await expect(renderingSmoke).toHaveAttribute("data-render-reference-count", "4");
  await expect(renderingSmoke).toHaveAttribute("data-render-package-item-count", "2");
  await expect(renderingSmoke).toHaveAttribute("data-render-export-history-count", "1");
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /brief-confirm/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /candidate-select/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /package-add/);
  await expect(renderingSmoke).toHaveAttribute("data-render-interaction-steps", /export-ready/);
  const renderElementCount = Number(await renderingSmoke.getAttribute("data-render-element-count"));
  const renderMaxElements = Number(await renderingSmoke.getAttribute("data-render-max-elements"));
  const renderEstimatedInteractionMs = Number(await renderingSmoke.getAttribute("data-render-estimated-interaction-ms"));
  const renderMaxInteractionMs = Number(await renderingSmoke.getAttribute("data-render-max-interaction-ms"));
  expect(renderElementCount).toBeLessThanOrEqual(renderMaxElements);
  expect(renderEstimatedInteractionMs, "render estimated interaction budget should stay within max").toBeLessThanOrEqual(
    renderMaxInteractionMs
  );

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
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  const zip = await JSZip.loadAsync(await readFile(downloadPath!));
  const zipPayloadSmoke = page.getByLabel("Export ZIP payload smoke");
  const expectedPayloads = (await zipPayloadSmoke.getAttribute("data-export-zip-payload-expected-payloads"))?.split(",") ?? [];
  expect(expectedPayloads).toHaveLength(14);
  for (const payloadName of expectedPayloads) {
    expect(zip.file(payloadName), `downloaded ZIP payload ${payloadName} should exist`).toBeTruthy();
  }
  const actualPayloads = Object.keys(zip.files).filter((payloadName) => !zip.files[payloadName].dir).sort();
  expect(actualPayloads, "downloaded ZIP payload set should match package/export metadata").toEqual([...expectedPayloads].sort());

  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
    package_id: string;
    project_id: string;
    items: Array<{ type: string; provenance: string }>;
    workflow_acceptance: {
      workflow_id: string;
      fixture_id: string;
      strategy_taxonomy: string[];
      required_files: string[];
    };
  };
  const provenance = JSON.parse(await zip.file("provenance.json")!.async("string")) as {
    export_id: string;
    items: Array<{ provenance: string }>;
  };
  const pptReadyMetadata = JSON.parse(await zip.file("ppt-ready-metadata.json")!.async("string")) as {
    aspect_ratio: string;
    slides: Array<{ source_item_id: string }>;
  };
  const workflowMetadata = JSON.parse(await zip.file("metadata.json")!.async("string")) as {
    workflow_id: string;
    workflow_fixture_id: string;
    provider: string;
    model: string;
    prompt_spec: string[];
    skill: string;
    safety: string;
  };
  const traceProvenance = JSON.parse(await zip.file("trace_provenance.json")!.async("string")) as {
    workflow_id: string;
    provider: string;
    model: string;
    prompt_spec: string[];
    skill: string;
    safety: string;
  };

  expect(manifest).toMatchObject({
    package_id: "pkg-002",
    project_id: "project-001",
    workflow_acceptance: {
      workflow_id: "ecommerce_growth_pack",
      fixture_id: "fx_ecommerce_growth_golden",
      strategy_taxonomy: ["social_proof"]
    }
  });
  expect(manifest.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "reference",
        provenance: "dev-client-reference:ref-campaign-reference-webp"
      }),
      expect.objectContaining({
        type: "candidate",
        provenance: "dev-client:cand-studio"
      })
    ])
  );
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-taxonomy-count", String(manifest.workflow_acceptance.strategy_taxonomy.length));
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-required-file-count", String(manifest.workflow_acceptance.required_files.length));
  expect(provenance).toMatchObject({ export_id: "export-001" });
  expect(provenance.items.map((item) => item.provenance)).toEqual(
    expect.arrayContaining(["dev-client-reference:ref-campaign-reference-webp", "dev-client:cand-studio"])
  );
  await expect(metadataEvidence).toHaveAttribute("data-package-export-provenance-count", String(provenance.items.length));
  expect(pptReadyMetadata.aspect_ratio).toBe("16:9");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-aspect-ratio", pptReadyMetadata.aspect_ratio);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-slide-count", String(pptReadyMetadata.slides.length));
  expect(workflowMetadata).toMatchObject({
    workflow_id: "ecommerce_growth_pack",
    workflow_fixture_id: "fx_ecommerce_growth_golden",
    provider: "dev-provider",
    model: "deterministic-local-alpha",
    prompt_spec: ["social_proof"],
    skill: "ecommerce_growth_pack",
    safety: "pass"
  });
  expect(traceProvenance).toMatchObject({
    workflow_id: workflowMetadata.workflow_id,
    provider: workflowMetadata.provider,
    model: workflowMetadata.model,
    prompt_spec: workflowMetadata.prompt_spec,
    skill: workflowMetadata.skill,
    safety: workflowMetadata.safety
  });
});
