import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";

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
  await expect(metadataEvidence).toHaveAttribute("data-package-export-item-provenance-parity-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-item-provenance-parity-count", "2");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-item-provenance-parity-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-reference-provenance-count", "1");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-candidate-provenance-count", "1");
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
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-path-safety-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-unsafe-manifest-payload-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-unsafe-manifest-payloads", "");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-unsafe-expected-payload-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-unsafe-expected-payloads", "");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-contract-digest", /export-001::pkg-002::project-001::ecommerce_growth_pack/);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-cross-payload-identity-status", "pass");
  const expectedIdentityContractDigest = [
    "export-001",
    "pkg-002",
    "project-001",
    "ecommerce_growth_pack",
    "fx_ecommerce_growth_golden",
    "dev-provider",
    "deterministic-local-alpha",
    "social_proof",
    "ecommerce_growth_pack",
    "pass"
  ].join("::");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-identity-contract-digest", expectedIdentityContractDigest);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-cross-payload-identity-count", "5");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-cross-payload-identity-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-cross-payload-identities", /manifest\.json/);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-cross-payload-identities", /provenance\.json/);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-cross-payload-identities", /metadata\.json/);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-cross-payload-identities", /trace_provenance\.json/);
  const identityMatrix = page.getByLabel("Package export cross-payload identity matrix");
  await expect(identityMatrix.locator("[data-package-export-identity-row='cross-payload-identity']")).toHaveCount(5);
  for (const payloadName of ["manifest.json", "provenance.json", "ai-content-disclaimer.json", "metadata.json", "trace_provenance.json"]) {
    const row = identityMatrix.locator(`[data-package-export-identity-payload='${payloadName}']`);
    await expect(row).toHaveAttribute("data-package-export-identity-package-id", "pass");
    await expect(row).toHaveAttribute("data-package-export-identity-project-id", "pass");
  }
  for (const payloadName of ["manifest.json", "provenance.json", "ai-content-disclaimer.json", "metadata.json", "trace_provenance.json"]) {
    const row = identityMatrix.locator(`[data-package-export-identity-payload='${payloadName}']`);
    await expect(row).toHaveAttribute("data-package-export-identity-export-id", "pass");
    await expect(row).toHaveAttribute("data-package-export-identity-workflow-id", "pass");
    await expect(row).toHaveAttribute("data-package-export-identity-provider", "pass");
    await expect(row).toHaveAttribute("data-package-export-identity-model", "pass");
    await expect(row).toHaveAttribute("data-package-export-identity-prompt-spec", "pass");
    await expect(row).toHaveAttribute("data-package-export-identity-skill", "pass");
    await expect(row).toHaveAttribute("data-package-export-identity-safety", "pass");
  }
  const itemProvenanceMatrix = page.getByLabel("Package export item provenance parity matrix");
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-row='item-provenance-parity']")).toHaveCount(2);
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-001']")).toHaveAttribute(
    "data-package-export-item-provenance-type",
    "reference"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-001']")).toHaveAttribute(
    "data-package-export-item-provenance-value",
    "dev-client-reference:ref-campaign-reference-webp"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-001']")).toHaveAttribute(
    "data-package-export-item-provenance-prefix",
    "dev-client-reference:"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-001']")).toHaveAttribute(
    "data-package-export-item-provenance-status",
    "pass"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-001']")).toHaveAttribute(
    "data-package-export-item-ppt-slide-status",
    "pass"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-002']")).toHaveAttribute(
    "data-package-export-item-provenance-type",
    "candidate"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-002']")).toHaveAttribute(
    "data-package-export-item-provenance-value",
    "dev-client:cand-studio"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-002']")).toHaveAttribute(
    "data-package-export-item-provenance-prefix",
    "dev-client:"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-002']")).toHaveAttribute(
    "data-package-export-item-provenance-status",
    "pass"
  );
  await expect(itemProvenanceMatrix.locator("[data-package-export-item-provenance-id='pkg-item-002']")).toHaveAttribute(
    "data-package-export-item-ppt-slide-status",
    "pass"
  );
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
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-path-safety-status", "pass");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-unsafe-manifest-count", "0");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-unsafe-manifest-payloads", "");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-unsafe-expected-count", "0");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-unsafe-expected-payloads", "");
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-failures", "");

  const downloadParity = page.getByLabel("Export download parity smoke");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-smoke", "stage0.rev2.export-download-parity-smoke");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-project-id", "project-001");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-workflow-id", "ecommerce_growth_pack");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-workflow-fixture-id", "fx_ecommerce_growth_golden");
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
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payload-list-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-workflow-metadata-present", "true");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-trace-provenance-present", "true");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-identity-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-provider", "dev-provider");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-model", "deterministic-local-alpha");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-prompt-spec-taxonomy", "social_proof");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-skill", "ecommerce_growth_pack");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-safety-status", "pass");
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
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();

  const zip = await JSZip.loadAsync(await readFile(downloadPath!));
  const expectedPayloads = (await zipPayloadSmoke.getAttribute("data-export-zip-payload-expected-payloads"))?.split(",") ?? [];
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-metadata-payloads", expectedPayloads.join(","));
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-zip-expected-payloads", expectedPayloads.join(","));
  const expectedPayloadContractDigest = [
    "export-001",
    "pkg-002",
    "project-001",
    "ecommerce_growth_pack",
    "fx_ecommerce_growth_golden",
    [...expectedPayloads].sort().join("|")
  ].join("::");
  expect(expectedPayloads).toHaveLength(14);
  await expect(zipPayloadSmoke).toHaveAttribute("data-export-zip-payload-contract-digest", expectedPayloadContractDigest);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-contract-digest", expectedPayloadContractDigest);
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payload-contract-digest", expectedPayloadContractDigest);
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payload-digest-match", "true");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payload-path-safety-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-identity-contract-digest", expectedIdentityContractDigest);
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-identity-digest-match", "true");
  await expect(downloadHandoff).toHaveAttribute("data-export-download-payload-contract-digest", expectedPayloadContractDigest);
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-item-provenance-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-item-provenance-count", "2");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-missing-item-provenance-count", "0");
  for (const payloadName of expectedPayloads) {
    expect(zip.file(payloadName), `downloaded ZIP payload ${payloadName} should exist`).toBeTruthy();
  }
  const actualPayloads = Object.keys(zip.files).filter((payloadName) => !zip.files[payloadName].dir).sort();
  expect(actualPayloads, "downloaded ZIP must not contain extra top-level contract payloads").toEqual([...expectedPayloads].sort());
  const payloadContentMatrix = page
    .getByLabel("Package export payload status matrix")
    .locator("[data-payload-status-kind='payload-content']");
  await expect(payloadContentMatrix.locator("[data-package-export-payload-row='payload-content']")).toHaveCount(expectedPayloads.length);
  const downloadedPayloadContentEntries = await Promise.all(
    actualPayloads.map(async (payloadName) => {
      const body = await zip.file(payloadName)!.async("string");
      return `${payloadName}:${new TextEncoder().encode(body).length}:${fnv1aDigest(body)}`;
    })
  );
  const downloadedPayloadContentDigest = downloadedPayloadContentEntries.sort().join("|");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-payload-content-count", String(expectedPayloads.length));
  await expect(metadataEvidence).toHaveAttribute("data-package-export-payload-content-digest", downloadedPayloadContentDigest);
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payload-content-count", String(expectedPayloads.length));
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payload-content-status", "pass");
  await expect(downloadParity).toHaveAttribute("data-export-download-parity-payload-content-digest", downloadedPayloadContentDigest);
  for (const entry of downloadedPayloadContentEntries) {
    const [payloadName, byteSize, contentDigest] = entry.split(":");
    await expect(payloadContentMatrix.locator(`[data-package-export-payload-name='${payloadName}']`)).toHaveAttribute(
      "data-package-export-payload-zip-name",
      `${byteSize}:${contentDigest}`
    );
  }
  expect(
    [
      "export-001",
      "pkg-002",
      "project-001",
      "ecommerce_growth_pack",
      "fx_ecommerce_growth_golden",
      actualPayloads.join("|")
    ].join("::"),
    "downloaded ZIP payload contract digest must match UI evidence"
  ).toBe(expectedPayloadContractDigest);

  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string")) as {
    package_id: string;
    project_id: string;
    required_outputs: string[];
    items: Array<{ id: string; type: string; provenance: string }>;
    workflow_acceptance: {
      workflow_id: string;
      fixture_id: string;
      strategy_taxonomy: string[];
      required_files: string[];
    };
  };
  const qaReport = JSON.parse(await zip.file("qa-report.json")!.async("string")) as Array<{ severity: string }>;
  const safetyReport = JSON.parse(await zip.file("safety-policy-report.json")!.async("string")) as {
    status: string;
    enforcementStages: string[];
  };
  const provenance = JSON.parse(await zip.file("provenance.json")!.async("string")) as {
    export_id: string;
    package_id: string;
    project_id: string;
    generated_by: string;
    workflow_id: string;
    provider: string;
    model: string;
    prompt_spec: string[];
    skill: string;
    safety: string;
    items: Array<{ provenance: string }>;
  };
  const aiContentDisclaimer = JSON.parse(await zip.file("ai-content-disclaimer.json")!.async("string")) as {
    schema_version: string;
    export_id: string;
    package_id: string;
    project_id: string;
    generation_mode: string;
    workflow_id: string;
    provider: string;
    model: string;
    prompt_spec: string[];
    skill: string;
    safety_status: string;
  };
  const pptReadyMetadata = JSON.parse(await zip.file("ppt-ready-metadata.json")!.async("string")) as {
    schema_version: string;
    aspect_ratio: string;
    slides: Array<{ source_item_id: string }>;
  };
  const workflowMetadata = JSON.parse(await zip.file("metadata.json")!.async("string")) as {
    export_id: string;
    package_id: string;
    project_id: string;
    workflow_id: string;
    workflow_fixture_id: string;
    provider: string;
    model: string;
    prompt_spec: string[];
    skill: string;
    safety: string;
  };
  const traceProvenance = JSON.parse(await zip.file("trace_provenance.json")!.async("string")) as {
    export_id: string;
    package_id: string;
    project_id: string;
    workflow_id: string;
    provider: string;
    model: string;
    prompt_spec: string[];
    skill: string;
    safety: string;
  };
  const assetsReadme = await zip.file("assets/README.txt")!.async("string");

  expect(manifest).toMatchObject({
    package_id: "pkg-002",
    project_id: "project-001",
    workflow_acceptance: {
      workflow_id: "ecommerce_growth_pack",
      fixture_id: "fx_ecommerce_growth_golden",
      strategy_taxonomy: ["social_proof"]
    }
  });
  expect(manifest.required_outputs).toEqual(
    expect.arrayContaining([
      "manifest.json",
      "qa-report.json",
      "safety-policy-report.json",
      "provenance.json",
      "ai-content-disclaimer.json",
      "ppt-ready-metadata.json",
      "assets/",
      "metadata.json",
      "trace_provenance.json"
    ])
  );
  await expect(metadataEvidence).toHaveAttribute("data-package-export-package-id", manifest.package_id);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-project-id", manifest.project_id);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-id", manifest.workflow_acceptance.workflow_id);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-fixture-id", manifest.workflow_acceptance.fixture_id);
  await expect(metadataEvidence).toHaveAttribute(
    "data-package-export-workflow-taxonomy-count",
    String(manifest.workflow_acceptance.strategy_taxonomy.length)
  );
  await expect(metadataEvidence).toHaveAttribute(
    "data-package-export-workflow-required-file-count",
    String(manifest.workflow_acceptance.required_files.length)
  );
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
  await expect(metadataEvidence).toHaveAttribute("data-package-export-item-provenance-parity-count", String(manifest.items.length));
  expect(qaReport.every((finding) => finding.severity !== "block")).toBe(true);
  await expect(metadataEvidence).toHaveAttribute(
    "data-package-export-blocking-qa-count",
    String(qaReport.filter((finding) => finding.severity === "block").length)
  );
  expect(safetyReport).toMatchObject({
    status: "pass",
    enforcementStages: ["brief", "provider_request", "provider_response", "qa", "export"]
  });
  await expect(metadataEvidence).toHaveAttribute("data-package-export-safety-status", safetyReport.status);
  await expect(metadataEvidence).toHaveAttribute(
    "data-package-export-safety-stage-count",
    String(safetyReport.enforcementStages.length)
  );
  expect(provenance).toMatchObject({
    export_id: "export-001",
    package_id: "pkg-002",
    project_id: "project-001",
    generated_by: "zenart-web-dev-client",
    workflow_id: "ecommerce_growth_pack",
    provider: "dev-provider",
    model: "deterministic-local-alpha",
    prompt_spec: ["social_proof"],
    skill: "ecommerce_growth_pack",
    safety: "pass"
  });
  expect(provenance.items.map((item) => item.provenance)).toEqual(
    expect.arrayContaining(["dev-client-reference:ref-campaign-reference-webp", "dev-client:cand-studio"])
  );
  for (const item of manifest.items) {
    const itemRow = itemProvenanceMatrix.locator(`[data-package-export-item-provenance-id='${item.id}']`);
    await expect(itemRow).toHaveAttribute("data-package-export-item-provenance-value", item.provenance);
    await expect(itemRow).toHaveAttribute("data-package-export-item-provenance-status", "pass");
    await expect(itemRow).toHaveAttribute("data-package-export-item-ppt-slide-status", "pass");
  }
  await expect(metadataEvidence).toHaveAttribute("data-package-export-provenance-count", String(provenance.items.length));
  expect(aiContentDisclaimer).toMatchObject({
    schema_version: "stage0.rev2.ai-content-disclaimer",
    export_id: "export-001",
    package_id: "pkg-002",
    project_id: "project-001",
    generation_mode: "deterministic-local-alpha",
    workflow_id: "ecommerce_growth_pack",
    provider: "dev-provider",
    model: "deterministic-local-alpha",
    prompt_spec: ["social_proof"],
    skill: "ecommerce_growth_pack",
    safety_status: "pass"
  });
  await expect(metadataEvidence).toHaveAttribute(
    "data-package-export-ai-content-disclaimer-payload-present",
    String(aiContentDisclaimer.schema_version === "stage0.rev2.ai-content-disclaimer")
  );
  expect(pptReadyMetadata).toMatchObject({
    schema_version: "stage0.rev2.ppt-ready-metadata",
    aspect_ratio: "16:9"
  });
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-aspect-ratio", pptReadyMetadata.aspect_ratio);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-ppt-slide-count", String(pptReadyMetadata.slides.length));
  expect(pptReadyMetadata.slides.map((slide) => slide.source_item_id)).toEqual(
    expect.arrayContaining(["pkg-item-001", "pkg-item-002"])
  );
  expect(workflowMetadata).toMatchObject({
    export_id: "export-001",
    package_id: "pkg-002",
    project_id: "project-001",
    workflow_id: "ecommerce_growth_pack",
    workflow_fixture_id: "fx_ecommerce_growth_golden",
    provider: "dev-provider",
    model: "deterministic-local-alpha",
    prompt_spec: ["social_proof"],
    skill: "ecommerce_growth_pack",
    safety: "pass"
  });
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-provider", workflowMetadata.provider);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-metadata-model", workflowMetadata.model);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-skill", workflowMetadata.skill);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-safety", workflowMetadata.safety);
  expect(aiContentDisclaimer.safety_status).toBe(workflowMetadata.safety);
  await expect(metadataEvidence).toHaveAttribute(
    "data-package-export-workflow-prompt-spec-taxonomy",
    workflowMetadata.prompt_spec.join(",")
  );
  expect(traceProvenance).toMatchObject({
    export_id: "export-001",
    package_id: "pkg-002",
    project_id: "project-001",
    workflow_id: "ecommerce_growth_pack",
    provider: "dev-provider",
    model: "deterministic-local-alpha",
    prompt_spec: ["social_proof"],
    skill: "ecommerce_growth_pack",
    safety: "pass"
  });
  await expect(metadataEvidence).toHaveAttribute(
    "data-package-export-workflow-trace-provenance-payload-present",
    String(traceProvenance.workflow_id === workflowMetadata.workflow_id)
  );
  const identityPayloads = [provenance, aiContentDisclaimer, workflowMetadata, traceProvenance];
  expect(provenance.package_id).toBe(manifest.package_id);
  expect(provenance.project_id).toBe(manifest.project_id);
  expect(aiContentDisclaimer.project_id).toBe(manifest.project_id);
  expect(workflowMetadata.package_id).toBe(manifest.package_id);
  expect(workflowMetadata.project_id).toBe(manifest.project_id);
  expect(traceProvenance.package_id).toBe(manifest.package_id);
  expect(traceProvenance.project_id).toBe(manifest.project_id);
  for (const payload of identityPayloads) {
    expect(payload.export_id).toBe("export-001");
    expect(payload.package_id).toBe(manifest.package_id);
    expect(payload.project_id).toBe(manifest.project_id);
    expect(payload.workflow_id).toBe(manifest.workflow_acceptance.workflow_id);
    expect(payload.provider).toBe(workflowMetadata.provider);
    expect(payload.model).toBe(workflowMetadata.model);
    expect(payload.prompt_spec).toEqual(workflowMetadata.prompt_spec);
    expect(payload.skill).toBe(workflowMetadata.skill);
  }
  expect(aiContentDisclaimer.safety_status).toBe(safetyReport.status);
  expect(aiContentDisclaimer.safety_status).toBe(traceProvenance.safety);
  expect(assetsReadme).toContain("Deterministic local alpha export placeholder");
});

const fnv1aDigest = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
};
