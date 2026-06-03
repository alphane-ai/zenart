import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";

const workflowId = "ecommerce_growth_pack";
const fixtureId = "fx_ecommerce_growth_golden";
const evidenceDir = path.resolve(process.cwd(), "..", "ops", "evidence", "local_alpha");
const evidenceCreatedAt = process.env.STAGE0_EVIDENCE_CREATED_AT ?? new Date().toISOString();
const assignedWebPort = Number(process.env.WEB_PLAYWRIGHT_PORT ?? 26080);
const assignedWebBaseURL = process.env.WEB_PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${assignedWebPort}`;
const evidenceRunner = "web/tests/local-alpha-ecommerce-evidence.spec.ts";
const evidenceCommand = "npm run smoke:local-alpha-workflow-evidence";
const candidateLabels = ["Editorial Clarity", "Studio System", "Gallery Motion", "Utility Kit"] as const;
const requiredZipPayloads = [
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "provenance.json",
  "ai-content-disclaimer.json",
  "ppt-ready-metadata.json",
  "assets/README.txt",
  "assets/hero_product_ad.png",
  "assets/square_social_ad.png",
  "assets/story_variant.png",
  "assets/marketplace_banner.png",
  "metadata.json",
  "qa_report.json",
  "trace_provenance.json"
] as const;

const commonEvidence = (baseURL: string | undefined) => ({
  schema_version: "stage0.rev2.local-alpha-runtime-evidence",
  blueprint_source: "Docs/stage0_blueprint_rev2.md",
  blueprint_sections: ["6.1", "15.3", "23.1", "25.12", "25.20"],
  created_by_lane: "lane1",
  created_at: evidenceCreatedAt,
  environment: "local_alpha",
  workflow_id: workflowId,
  fixture_id: fixtureId,
  release_gate_check_id: "local_alpha_e2e_workflow_smoke",
  release_gate_fixture_ref: "fixtures/stage0/rev2/release_gate_evidence.local_alpha.json",
  proves_running_local_stack: true,
  local_stack: {
    web_base_url: baseURL ?? assignedWebBaseURL,
    assigned_web_port: assignedWebPort,
    web_playwright_port_env: process.env.WEB_PLAYWRIGHT_PORT ?? "26080",
    web_server_contract: `web/playwright.config.ts webServer starts npm run dev -- --hostname 127.0.0.1 --port ${assignedWebPort}`,
    worker_clone_root_rel: "web",
    user_route: "/workspace",
    export_route: "/export",
    client_contract: "web deterministic dev client with generated API operation evidence"
  }
});

const writeEvidence = async (fileName: string, data: unknown) => {
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(path.join(evidenceDir, fileName), `${JSON.stringify(data, null, 2)}\n`);
};

const businessWorkflowId = "business_visual_doc_pack";
const businessFixtureId = "fx_business_visual_doc_golden";
const businessCandidateLabels = ["Executive Brief", "Strategy Memo", "Sales Leave-Behind", "Board Update"] as const;
const businessRequiredZipPayloads = [
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "provenance.json",
  "ai-content-disclaimer.json",
  "ppt-ready-metadata.json",
  "assets/README.txt",
  "assets/cover.png",
  "assets/summary_page.png",
  "assets/data_page.png",
  "assets/recommendation_page.png",
  "metadata.json",
  "qa_report.json",
  "trace_provenance.json"
] as const;

const localMerchantWorkflowId = "local_merchant_campaign_pack";
const localMerchantFixtureId = "fx_local_merchant_campaign_golden";
const localMerchantCandidateLabels = ["WeChat Conversion", "Xiaohongshu Quality", "Store Print", "Delivery Cover"] as const;
const localMerchantRequiredZipPayloads = [
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "provenance.json",
  "ai-content-disclaimer.json",
  "ppt-ready-metadata.json",
  "assets/README.txt",
  "assets/wechat_moment.png",
  "assets/xiaohongshu_post.png",
  "assets/store_print_poster.pdf",
  "assets/delivery_cover.png",
  "metadata.json",
  "qa_report.json",
  "trace_provenance.json"
] as const;

const characterIpWorkflowId = "character_ip_concept_pack";
const characterIpFixtureId = "fx_character_ip_concept_golden";
const characterIpCandidateLabels = ["Cute Mascot", "Heroic Lead", "Dark Variant", "Ornate Sheet"] as const;
const characterIpRequiredZipPayloads = [
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "provenance.json",
  "ai-content-disclaimer.json",
  "ppt-ready-metadata.json",
  "assets/README.txt",
  "assets/avatar.png",
  "assets/half_body.png",
  "assets/costume_prop_variants.png",
  "assets/expression_sheet.png",
  "assets/promo_key_art.png",
  "assets/character_bible.json",
  "metadata.json",
  "qa_report.json",
  "trace_provenance.json"
] as const;

test("writes ecommerce growth Local Alpha API, Playwright, and export ZIP runtime evidence", async ({ page, baseURL }) => {
  const startedAt = Date.now();
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("zenart-local-alpha-ecommerce-evidence-reset")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("zenart-local-alpha-ecommerce-evidence-reset", "true");
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

  for (const taxonomy of ["conversion_offer", "social_proof", "feature_comparison", "retention_bundle"]) {
    await expect(page.getByTestId(`candidate-card-${taxonomy}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Select Editorial Clarity" }).click();
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
  }

  await page.getByTestId("export-download").click();
  await expect(page.getByText("zenart-001.zip")).toBeVisible();

  const workflowSmoke = page.locator("[data-workflow-api-smoke='stage0.rev2.workflow-api-smoke']");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-status", "pass");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-workflow", workflowId);
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-fixture", fixtureId);
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-ready-zip-export-count", "1");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-missing-output-count", "0");

  const apiAttributes = await workflowSmoke.evaluate((element) => ({
    status: element.getAttribute("data-workflow-api-smoke-status"),
    scenario: element.getAttribute("data-workflow-api-smoke-scenario"),
    operationCount: element.getAttribute("data-workflow-api-smoke-operation-count"),
    operationIds: element.getAttribute("data-workflow-api-smoke-operations")?.split(",") ?? [],
    operationContracts: element.getAttribute("data-workflow-api-smoke-operation-contracts")?.split("|") ?? [],
    candidateCount: element.getAttribute("data-workflow-api-smoke-candidate-count"),
    taxonomyCount: element.getAttribute("data-workflow-api-smoke-taxonomy-count"),
    packagedTaxonomyCount: element.getAttribute("data-workflow-api-smoke-packaged-taxonomy-count"),
    readyZipExportCount: element.getAttribute("data-workflow-api-smoke-ready-zip-export-count"),
    missingOutputCount: element.getAttribute("data-workflow-api-smoke-missing-output-count"),
    csrfProtectedOperationCount: element.getAttribute("data-workflow-api-smoke-csrf-protected-operation-count"),
    idempotencyRequiredOperationCount: element.getAttribute("data-workflow-api-smoke-idempotency-required-operation-count"),
    qaTaxonomyStatus: element.getAttribute("data-workflow-api-smoke-qa-taxonomy-status"),
    safetyStatus: element.getAttribute("data-workflow-api-smoke-safety-status"),
    failures: element.getAttribute("data-workflow-api-smoke-failures")
  }));

  const renderingSmoke = page.locator("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
  await expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
  await expect(renderingSmoke).toHaveAttribute("data-render-failure-count", "0");

  const renderingAttributes = await renderingSmoke.evaluate((element) => ({
    status: element.getAttribute("data-rendering-status"),
    interactionSteps: element.getAttribute("data-render-interaction-steps")?.split(",") ?? [],
    renderElementCount: element.getAttribute("data-render-element-count"),
    maxRenderElements: element.getAttribute("data-render-max-elements"),
    estimatedInteractionMs: element.getAttribute("data-render-estimated-interaction-ms"),
    maxInteractionMs: element.getAttribute("data-render-max-interaction-ms"),
    failureCount: element.getAttribute("data-render-failure-count")
  }));

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export Preview" })).toBeVisible();

  const metadataEvidence = page.locator("[data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui']");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-metadata-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-parity-status", "pass");

  const exportMetadata = await metadataEvidence.evaluate((element) => ({
    status: element.getAttribute("data-package-export-metadata-status"),
    exportId: element.getAttribute("data-package-export-id"),
    packageId: element.getAttribute("data-package-export-package-id"),
    manifestItemCount: element.getAttribute("data-package-export-manifest-item-count"),
    manifestRequiredOutputCount: element.getAttribute("data-package-export-manifest-required-output-count"),
    missingOutputCount: element.getAttribute("data-package-export-missing-output-count"),
    zipPayloadParityStatus: element.getAttribute("data-package-export-zip-payload-parity-status"),
    workflowMetadataProvider: element.getAttribute("data-package-export-workflow-metadata-provider"),
    workflowMetadataModel: element.getAttribute("data-package-export-workflow-metadata-model"),
    workflowMetadataPayloadPresent: element.getAttribute("data-package-export-workflow-metadata-payload-present"),
    traceProvenancePayloadPresent: element.getAttribute("data-package-export-workflow-trace-provenance-payload-present"),
    aiContentDisclaimerPayloadPresent: element.getAttribute("data-package-export-ai-content-disclaimer-payload-present")
  }));

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect(download.suggestedFilename()).toBe("zenart-001.zip");

  const zipBuffer = await readFile(downloadPath as string);
  const zipHash = createHash("sha256").update(zipBuffer).digest("hex");
  const zip = await JSZip.loadAsync(zipBuffer);
  const zipPayloads = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort();
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  const qaReport = JSON.parse(await zip.file("qa-report.json")!.async("string"));
  const safetyReport = JSON.parse(await zip.file("safety-policy-report.json")!.async("string"));
  const metadataPayload = JSON.parse(await zip.file("metadata.json")!.async("string"));
  const traceProvenance = JSON.parse(await zip.file("trace_provenance.json")!.async("string"));
  const missingZipPayloads = requiredZipPayloads.filter((payload) => !zipPayloads.includes(payload));

  expect(missingZipPayloads).toEqual([]);
  expect(manifest.workflow_acceptance.workflow_id).toBe(workflowId);
  expect(manifest.workflow_acceptance.fixture_id).toBe(fixtureId);
  expect(qaReport.some((finding: { id: string; severity: string }) => finding.id === "qa-ecommerce-growth-taxonomy" && finding.severity === "pass")).toBe(true);
  expect(safetyReport.status).toBe("pass");
  expect(metadataPayload.provider).toBe("dev-provider");
  expect(metadataPayload.model).toBe("deterministic-local-alpha");

  const completedAt = Date.now();
  const common = commonEvidence(baseURL);

  await writeEvidence("ecommerce_growth_pack.api_smoke.json", {
    ...common,
    evidence_kind: "api_smoke",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    operation_ids: apiAttributes.operationIds,
    operation_contracts: apiAttributes.operationContracts,
    operation_count: Number(apiAttributes.operationCount),
    csrf_protected_operation_count: Number(apiAttributes.csrfProtectedOperationCount),
    idempotency_required_operation_count: Number(apiAttributes.idempotencyRequiredOperationCount),
    scenario: apiAttributes.scenario,
    assertions: {
      status: apiAttributes.status,
      candidate_count: Number(apiAttributes.candidateCount),
      taxonomy_count: Number(apiAttributes.taxonomyCount),
      packaged_taxonomy_count: Number(apiAttributes.packagedTaxonomyCount),
      ready_zip_export_count: Number(apiAttributes.readyZipExportCount),
      missing_output_count: Number(apiAttributes.missingOutputCount),
      qa_taxonomy_status: apiAttributes.qaTaxonomyStatus,
      safety_status: apiAttributes.safetyStatus,
      failures: apiAttributes.failures
    }
  });

  await writeEvidence("ecommerce_growth_pack.playwright_happy_path.json", {
    ...common,
    evidence_kind: "playwright_happy_path",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    browser: "Desktop Chrome",
    route_assertions: ["/workspace", "/export"],
    interaction_steps: [
      "brief_confirmed",
      "reference_uploaded",
      "four_candidates_visible",
      "candidate_selected",
      "iteration_created",
      "all_taxonomy_candidates_packaged",
      "zip_export_created",
      "download_handoff_completed"
    ],
    rendering_performance: renderingAttributes,
    export_metadata_ui: exportMetadata,
    downloaded_file_name: download.suggestedFilename(),
    elapsed_ms: completedAt - startedAt
  });

  await writeEvidence("ecommerce_growth_pack.export_zip.json", {
    ...common,
    evidence_kind: "export_zip",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    file_name: download.suggestedFilename(),
    byte_size: zipBuffer.byteLength,
    sha256: zipHash,
    payloads: zipPayloads,
    required_payloads: [...requiredZipPayloads],
    missing_payloads: missingZipPayloads,
    manifest: {
      package_id: manifest.package_id,
      project_id: manifest.project_id,
      item_count: manifest.items.length,
      required_output_count: manifest.required_outputs.length,
      workflow_acceptance: manifest.workflow_acceptance,
      ppt_ready_metadata_schema: manifest.ppt_ready_metadata.schema_version,
      ppt_slide_count: manifest.ppt_ready_metadata.slides.length
    },
    qa_report: {
      finding_count: qaReport.length,
      blocking_count: qaReport.filter((finding: { severity: string }) => finding.severity === "block").length,
      ecommerce_taxonomy_status: qaReport.find((finding: { id: string }) => finding.id === "qa-ecommerce-growth-taxonomy")?.severity
    },
    safety_report: {
      status: safetyReport.status,
      enforcement_stages: safetyReport.enforcementStages,
      finding_count: safetyReport.findings.length
    },
    metadata_payload: {
      provider: metadataPayload.provider,
      model: metadataPayload.model,
      skill: metadataPayload.skill,
      safety: metadataPayload.safety,
      prompt_spec: metadataPayload.prompt_spec
    },
    trace_provenance: {
      workflow_id: traceProvenance.workflow_id,
      workflow_fixture_id: traceProvenance.workflow_fixture_id,
      generated_by: traceProvenance.generated_by
    }
  });
});

test("writes character IP concept Local Alpha API, Playwright, and export ZIP runtime evidence", async ({ page, baseURL }) => {
  const startedAt = Date.now();
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("zenart-local-alpha-character-ip-evidence-reset")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("zenart-local-alpha-character-ip-evidence-reset", "true");
    }
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  await page.getByRole("textbox", { name: "Brief" }).fill(
    "Character IP Concept Pack: create an original sky courier mascot named Luma Reed for a cozy fantasy game, using reference images only for pose mood. Genre is cozy fantasy adventure. Use case is avatar, half-body key art, costume and prop variants, expression sheet, promo key art, and character bible. Originality constraints: no protected characters, no trademarked costumes, no third-party resemblance. Style boundary: bright readable stylized game art without copying any named artist or franchise. Consistency constraints: teal scarf, brass compass charm, short silver hair, amber eyes, messenger satchel, and stable silhouette across all outputs."
  );
  await page.getByRole("button", { name: "Confirm Brief" }).click();
  await expect(page.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeVisible();

  await page.getByLabel("Reference type").selectOption("image");
  await page.getByLabel("Reference asset name or URL").fill("luma-original-pose-reference.webp");
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("button", { name: "Add reference luma-original-pose-reference.webp to package" })).toBeVisible();

  for (const taxonomy of ["cute", "heroic", "dark", "ornate"]) {
    await expect(page.getByTestId(`candidate-card-${taxonomy}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Select Cute Mascot" }).click();
  await page.getByLabel("Iteration instruction").fill(
    "Refine the original character sheet for stronger silhouette consistency, protected-style avoidance, and clearer expression handoff."
  );
  await page.getByRole("button", { name: "Iterate" }).click();
  await expect(
    page.getByText("Cute Mascot refined with: Refine the original character sheet for stronger silhouette consistency, protected-style avoidance, and clearer expression handoff.")
  ).toBeVisible();

  for (const candidateLabel of characterIpCandidateLabels) {
    await page.getByRole("button", { name: `Select ${candidateLabel}` }).click();
    await expect(page.getByRole("button", { name: `Select ${candidateLabel}` })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("package-add-selected").click();
  }

  await page.getByTestId("export-download").click();
  await expect(page.getByText("zenart-001.zip")).toBeVisible();

  const workflowSmoke = page.locator("[data-workflow-api-smoke='stage0.rev2.workflow-api-smoke']");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-status", "pass");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-workflow", characterIpWorkflowId);
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-fixture", characterIpFixtureId);
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-ready-zip-export-count", "1");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-missing-output-count", "0");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-qa-taxonomy-id", "qa-character-ip-concept-taxonomy");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-qa-taxonomy-status", "pass");

  const apiAttributes = await workflowSmoke.evaluate((element) => ({
    status: element.getAttribute("data-workflow-api-smoke-status"),
    scenario: element.getAttribute("data-workflow-api-smoke-scenario"),
    operationCount: element.getAttribute("data-workflow-api-smoke-operation-count"),
    operationIds: element.getAttribute("data-workflow-api-smoke-operations")?.split(",") ?? [],
    operationContracts: element.getAttribute("data-workflow-api-smoke-operation-contracts")?.split("|") ?? [],
    candidateCount: element.getAttribute("data-workflow-api-smoke-candidate-count"),
    taxonomyCount: element.getAttribute("data-workflow-api-smoke-taxonomy-count"),
    packagedTaxonomyCount: element.getAttribute("data-workflow-api-smoke-packaged-taxonomy-count"),
    readyZipExportCount: element.getAttribute("data-workflow-api-smoke-ready-zip-export-count"),
    missingOutputCount: element.getAttribute("data-workflow-api-smoke-missing-output-count"),
    csrfProtectedOperationCount: element.getAttribute("data-workflow-api-smoke-csrf-protected-operation-count"),
    idempotencyRequiredOperationCount: element.getAttribute("data-workflow-api-smoke-idempotency-required-operation-count"),
    qaTaxonomyId: element.getAttribute("data-workflow-api-smoke-qa-taxonomy-id"),
    qaTaxonomyStatus: element.getAttribute("data-workflow-api-smoke-qa-taxonomy-status"),
    safetyStatus: element.getAttribute("data-workflow-api-smoke-safety-status"),
    failures: element.getAttribute("data-workflow-api-smoke-failures")
  }));

  const renderingSmoke = page.locator("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
  await expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
  await expect(renderingSmoke).toHaveAttribute("data-render-failure-count", "0");

  const renderingAttributes = await renderingSmoke.evaluate((element) => ({
    status: element.getAttribute("data-rendering-status"),
    interactionSteps: element.getAttribute("data-render-interaction-steps")?.split(",") ?? [],
    renderElementCount: element.getAttribute("data-render-element-count"),
    maxRenderElements: element.getAttribute("data-render-max-elements"),
    estimatedInteractionMs: element.getAttribute("data-render-estimated-interaction-ms"),
    maxInteractionMs: element.getAttribute("data-render-max-interaction-ms"),
    failureCount: element.getAttribute("data-render-failure-count")
  }));

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export Preview" })).toBeVisible();

  const exportSmoke = page.locator("[data-workflow-api-smoke-export='stage0.rev2.workflow-api-smoke']");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-workflow", characterIpWorkflowId);
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-status", "pass");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-missing-output-count", "0");

  const metadataEvidence = page.locator("[data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui']");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-metadata-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-id", characterIpWorkflowId);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-fixture-id", characterIpFixtureId);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-parity-status", "pass");

  const exportMetadata = await metadataEvidence.evaluate((element) => ({
    status: element.getAttribute("data-package-export-metadata-status"),
    exportId: element.getAttribute("data-package-export-id"),
    packageId: element.getAttribute("data-package-export-package-id"),
    manifestItemCount: element.getAttribute("data-package-export-manifest-item-count"),
    manifestRequiredOutputCount: element.getAttribute("data-package-export-manifest-required-output-count"),
    missingOutputCount: element.getAttribute("data-package-export-missing-output-count"),
    zipPayloadParityStatus: element.getAttribute("data-package-export-zip-payload-parity-status"),
    workflowMetadataProvider: element.getAttribute("data-package-export-workflow-metadata-provider"),
    workflowMetadataModel: element.getAttribute("data-package-export-workflow-metadata-model"),
    workflowMetadataPayloadPresent: element.getAttribute("data-package-export-workflow-metadata-payload-present"),
    traceProvenancePayloadPresent: element.getAttribute("data-package-export-workflow-trace-provenance-payload-present"),
    aiContentDisclaimerPayloadPresent: element.getAttribute("data-package-export-ai-content-disclaimer-payload-present")
  }));

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect(download.suggestedFilename()).toBe("zenart-001.zip");

  const zipBuffer = await readFile(downloadPath as string);
  const zipHash = createHash("sha256").update(zipBuffer).digest("hex");
  const zip = await JSZip.loadAsync(zipBuffer);
  const zipPayloads = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort();
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  const qaReport = JSON.parse(await zip.file("qa-report.json")!.async("string"));
  const safetyReport = JSON.parse(await zip.file("safety-policy-report.json")!.async("string"));
  const metadataPayload = JSON.parse(await zip.file("metadata.json")!.async("string"));
  const traceProvenance = JSON.parse(await zip.file("trace_provenance.json")!.async("string"));
  const missingZipPayloads = characterIpRequiredZipPayloads.filter((payload) => !zipPayloads.includes(payload));

  expect(missingZipPayloads).toEqual([]);
  expect(manifest.workflow_acceptance.workflow_id).toBe(characterIpWorkflowId);
  expect(manifest.workflow_acceptance.fixture_id).toBe(characterIpFixtureId);
  expect(qaReport.some((finding: { id: string; severity: string }) => finding.id === "qa-character-ip-concept-taxonomy" && finding.severity === "pass")).toBe(true);
  expect(qaReport.some((finding: { id: string; severity: string }) => finding.id === "qa-character-ip-originality-boundary" && finding.severity === "pass")).toBe(true);
  expect(safetyReport.status).toBe("pass");
  expect(metadataPayload.provider).toBe("dev-provider");
  expect(metadataPayload.model).toBe("deterministic-local-alpha");

  const completedAt = Date.now();
  const common = {
    ...commonEvidence(baseURL),
    workflow_id: characterIpWorkflowId,
    fixture_id: characterIpFixtureId
  };

  await writeEvidence("character_ip_concept_pack.api_smoke.json", {
    ...common,
    evidence_kind: "api_smoke",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    operation_ids: apiAttributes.operationIds,
    operation_contracts: apiAttributes.operationContracts,
    operation_count: Number(apiAttributes.operationCount),
    csrf_protected_operation_count: Number(apiAttributes.csrfProtectedOperationCount),
    idempotency_required_operation_count: Number(apiAttributes.idempotencyRequiredOperationCount),
    scenario: apiAttributes.scenario,
    assertions: {
      status: apiAttributes.status,
      candidate_count: Number(apiAttributes.candidateCount),
      taxonomy_count: Number(apiAttributes.taxonomyCount),
      packaged_taxonomy_count: Number(apiAttributes.packagedTaxonomyCount),
      ready_zip_export_count: Number(apiAttributes.readyZipExportCount),
      missing_output_count: Number(apiAttributes.missingOutputCount),
      qa_taxonomy_id: apiAttributes.qaTaxonomyId,
      qa_taxonomy_status: apiAttributes.qaTaxonomyStatus,
      safety_status: apiAttributes.safetyStatus,
      failures: apiAttributes.failures
    }
  });

  await writeEvidence("character_ip_concept_pack.playwright_happy_path.json", {
    ...common,
    evidence_kind: "playwright_happy_path",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    browser: "Desktop Chrome",
    route_assertions: ["/workspace", "/export"],
    interaction_steps: [
      "brief_confirmed",
      "original_character_reference_uploaded",
      "four_character_ip_candidates_visible",
      "candidate_selected",
      "iteration_created",
      "all_character_ip_taxonomy_candidates_packaged",
      "zip_export_created",
      "download_handoff_completed"
    ],
    rendering_performance: renderingAttributes,
    export_metadata_ui: exportMetadata,
    downloaded_file_name: download.suggestedFilename(),
    elapsed_ms: completedAt - startedAt
  });

  await writeEvidence("character_ip_concept_pack.export_zip.json", {
    ...common,
    evidence_kind: "export_zip",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    file_name: download.suggestedFilename(),
    byte_size: zipBuffer.byteLength,
    sha256: zipHash,
    payloads: zipPayloads,
    required_payloads: [...characterIpRequiredZipPayloads],
    missing_payloads: missingZipPayloads,
    manifest: {
      package_id: manifest.package_id,
      project_id: manifest.project_id,
      item_count: manifest.items.length,
      required_output_count: manifest.required_outputs.length,
      workflow_acceptance: manifest.workflow_acceptance,
      ppt_ready_metadata_schema: manifest.ppt_ready_metadata.schema_version,
      ppt_slide_count: manifest.ppt_ready_metadata.slides.length
    },
    qa_report: {
      finding_count: qaReport.length,
      blocking_count: qaReport.filter((finding: { severity: string }) => finding.severity === "block").length,
      character_ip_taxonomy_status: qaReport.find((finding: { id: string }) => finding.id === "qa-character-ip-concept-taxonomy")?.severity,
      originality_boundary_status: qaReport.find((finding: { id: string }) => finding.id === "qa-character-ip-originality-boundary")?.severity
    },
    safety_report: {
      status: safetyReport.status,
      enforcement_stages: safetyReport.enforcementStages,
      finding_count: safetyReport.findings.length
    },
    metadata_payload: {
      provider: metadataPayload.provider,
      model: metadataPayload.model,
      skill: metadataPayload.skill,
      safety: metadataPayload.safety,
      prompt_spec: metadataPayload.prompt_spec
    },
    trace_provenance: {
      workflow_id: traceProvenance.workflow_id,
      workflow_fixture_id: traceProvenance.workflow_fixture_id,
      generated_by: traceProvenance.generated_by
    }
  });
});

test("writes business visual document Local Alpha API, Playwright, and export ZIP runtime evidence", async ({ page, baseURL }) => {
  const startedAt = Date.now();
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("zenart-local-alpha-business-doc-evidence-reset")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("zenart-local-alpha-business-doc-evidence-reset", "true");
    }
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  await page.getByRole("textbox", { name: "Brief" }).fill(
    "Business Visual Document Pack: build an executive-ready operating memo from the uploaded source notes for finance and operations leaders, with board update format, clear data page, recommendation page, and no unsupported financial performance claims."
  );
  await page.getByRole("button", { name: "Confirm Brief" }).click();
  await expect(page.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeVisible();

  await page.getByLabel("Reference type").selectOption("document");
  await page.getByLabel("Reference asset name or URL").fill("q2-operating-notes.pdf");
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("button", { name: "Add reference q2-operating-notes.pdf to package" })).toBeVisible();

  for (const taxonomy of ["executive_brief", "strategy_memo", "sales_leave_behind", "board_update"]) {
    await expect(page.getByTestId(`candidate-card-${taxonomy}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Select Executive Brief" }).click();
  await page.getByLabel("Iteration instruction").fill(
    "Tighten readability, move claims into evidence-backed summary blocks, and keep board-level handoff notes visible."
  );
  await page.getByRole("button", { name: "Iterate" }).click();
  await expect(
    page.getByText("Executive Brief refined with: Tighten readability, move claims into evidence-backed summary blocks, and keep board-level handoff notes visible.")
  ).toBeVisible();

  for (const candidateLabel of businessCandidateLabels) {
    await page.getByRole("button", { name: `Select ${candidateLabel}` }).click();
    await expect(page.getByRole("button", { name: `Select ${candidateLabel}` })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("package-add-selected").click();
  }

  await page.getByTestId("export-download").click();
  await expect(page.getByText("zenart-001.zip")).toBeVisible();

  const workflowSmoke = page.locator("[data-workflow-api-smoke='stage0.rev2.workflow-api-smoke']");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-status", "pass");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-workflow", businessWorkflowId);
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-fixture", businessFixtureId);
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-ready-zip-export-count", "1");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-missing-output-count", "0");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-qa-taxonomy-id", "qa-business-visual-doc-taxonomy");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-qa-taxonomy-status", "pass");

  const apiAttributes = await workflowSmoke.evaluate((element) => ({
    status: element.getAttribute("data-workflow-api-smoke-status"),
    scenario: element.getAttribute("data-workflow-api-smoke-scenario"),
    operationCount: element.getAttribute("data-workflow-api-smoke-operation-count"),
    operationIds: element.getAttribute("data-workflow-api-smoke-operations")?.split(",") ?? [],
    operationContracts: element.getAttribute("data-workflow-api-smoke-operation-contracts")?.split("|") ?? [],
    candidateCount: element.getAttribute("data-workflow-api-smoke-candidate-count"),
    taxonomyCount: element.getAttribute("data-workflow-api-smoke-taxonomy-count"),
    packagedTaxonomyCount: element.getAttribute("data-workflow-api-smoke-packaged-taxonomy-count"),
    readyZipExportCount: element.getAttribute("data-workflow-api-smoke-ready-zip-export-count"),
    missingOutputCount: element.getAttribute("data-workflow-api-smoke-missing-output-count"),
    csrfProtectedOperationCount: element.getAttribute("data-workflow-api-smoke-csrf-protected-operation-count"),
    idempotencyRequiredOperationCount: element.getAttribute("data-workflow-api-smoke-idempotency-required-operation-count"),
    qaTaxonomyId: element.getAttribute("data-workflow-api-smoke-qa-taxonomy-id"),
    qaTaxonomyStatus: element.getAttribute("data-workflow-api-smoke-qa-taxonomy-status"),
    safetyStatus: element.getAttribute("data-workflow-api-smoke-safety-status"),
    failures: element.getAttribute("data-workflow-api-smoke-failures")
  }));

  const renderingSmoke = page.locator("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
  await expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
  await expect(renderingSmoke).toHaveAttribute("data-render-failure-count", "0");

  const renderingAttributes = await renderingSmoke.evaluate((element) => ({
    status: element.getAttribute("data-rendering-status"),
    interactionSteps: element.getAttribute("data-render-interaction-steps")?.split(",") ?? [],
    renderElementCount: element.getAttribute("data-render-element-count"),
    maxRenderElements: element.getAttribute("data-render-max-elements"),
    estimatedInteractionMs: element.getAttribute("data-render-estimated-interaction-ms"),
    maxInteractionMs: element.getAttribute("data-render-max-interaction-ms"),
    failureCount: element.getAttribute("data-render-failure-count")
  }));

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export Preview" })).toBeVisible();

  const exportSmoke = page.locator("[data-workflow-api-smoke-export='stage0.rev2.workflow-api-smoke']");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-workflow", businessWorkflowId);
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-status", "pass");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-missing-output-count", "0");

  const metadataEvidence = page.locator("[data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui']");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-metadata-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-id", businessWorkflowId);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-fixture-id", businessFixtureId);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-parity-status", "pass");

  const exportMetadata = await metadataEvidence.evaluate((element) => ({
    status: element.getAttribute("data-package-export-metadata-status"),
    exportId: element.getAttribute("data-package-export-id"),
    packageId: element.getAttribute("data-package-export-package-id"),
    manifestItemCount: element.getAttribute("data-package-export-manifest-item-count"),
    manifestRequiredOutputCount: element.getAttribute("data-package-export-manifest-required-output-count"),
    missingOutputCount: element.getAttribute("data-package-export-missing-output-count"),
    zipPayloadParityStatus: element.getAttribute("data-package-export-zip-payload-parity-status"),
    workflowMetadataProvider: element.getAttribute("data-package-export-workflow-metadata-provider"),
    workflowMetadataModel: element.getAttribute("data-package-export-workflow-metadata-model"),
    workflowMetadataPayloadPresent: element.getAttribute("data-package-export-workflow-metadata-payload-present"),
    traceProvenancePayloadPresent: element.getAttribute("data-package-export-workflow-trace-provenance-payload-present"),
    aiContentDisclaimerPayloadPresent: element.getAttribute("data-package-export-ai-content-disclaimer-payload-present")
  }));

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect(download.suggestedFilename()).toBe("zenart-001.zip");

  const zipBuffer = await readFile(downloadPath as string);
  const zipHash = createHash("sha256").update(zipBuffer).digest("hex");
  const zip = await JSZip.loadAsync(zipBuffer);
  const zipPayloads = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort();
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  const qaReport = JSON.parse(await zip.file("qa-report.json")!.async("string"));
  const safetyReport = JSON.parse(await zip.file("safety-policy-report.json")!.async("string"));
  const metadataPayload = JSON.parse(await zip.file("metadata.json")!.async("string"));
  const traceProvenance = JSON.parse(await zip.file("trace_provenance.json")!.async("string"));
  const missingZipPayloads = businessRequiredZipPayloads.filter((payload) => !zipPayloads.includes(payload));

  expect(missingZipPayloads).toEqual([]);
  expect(manifest.workflow_acceptance.workflow_id).toBe(businessWorkflowId);
  expect(manifest.workflow_acceptance.fixture_id).toBe(businessFixtureId);
  expect(qaReport.some((finding: { id: string; severity: string }) => finding.id === "qa-business-visual-doc-taxonomy" && finding.severity === "pass")).toBe(true);
  expect(qaReport.some((finding: { id: string; severity: string }) => finding.id === "qa-business-visual-doc-readability" && finding.severity === "pass")).toBe(true);
  expect(safetyReport.status).toBe("pass");
  expect(metadataPayload.provider).toBe("dev-provider");
  expect(metadataPayload.model).toBe("deterministic-local-alpha");

  const completedAt = Date.now();
  const common = {
    ...commonEvidence(baseURL),
    workflow_id: businessWorkflowId,
    fixture_id: businessFixtureId
  };

  await writeEvidence("business_visual_doc_pack.api_smoke.json", {
    ...common,
    evidence_kind: "api_smoke",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    operation_ids: apiAttributes.operationIds,
    operation_contracts: apiAttributes.operationContracts,
    operation_count: Number(apiAttributes.operationCount),
    csrf_protected_operation_count: Number(apiAttributes.csrfProtectedOperationCount),
    idempotency_required_operation_count: Number(apiAttributes.idempotencyRequiredOperationCount),
    scenario: apiAttributes.scenario,
    assertions: {
      status: apiAttributes.status,
      candidate_count: Number(apiAttributes.candidateCount),
      taxonomy_count: Number(apiAttributes.taxonomyCount),
      packaged_taxonomy_count: Number(apiAttributes.packagedTaxonomyCount),
      ready_zip_export_count: Number(apiAttributes.readyZipExportCount),
      missing_output_count: Number(apiAttributes.missingOutputCount),
      qa_taxonomy_id: apiAttributes.qaTaxonomyId,
      qa_taxonomy_status: apiAttributes.qaTaxonomyStatus,
      safety_status: apiAttributes.safetyStatus,
      failures: apiAttributes.failures
    }
  });

  await writeEvidence("business_visual_doc_pack.playwright_happy_path.json", {
    ...common,
    evidence_kind: "playwright_happy_path",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    browser: "Desktop Chrome",
    route_assertions: ["/workspace", "/export"],
    interaction_steps: [
      "brief_confirmed",
      "source_notes_uploaded",
      "four_document_candidates_visible",
      "candidate_selected",
      "iteration_created",
      "all_document_taxonomy_candidates_packaged",
      "zip_export_created",
      "download_handoff_completed"
    ],
    rendering_performance: renderingAttributes,
    export_metadata_ui: exportMetadata,
    downloaded_file_name: download.suggestedFilename(),
    elapsed_ms: completedAt - startedAt
  });

  await writeEvidence("business_visual_doc_pack.export_zip.json", {
    ...common,
    evidence_kind: "export_zip",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    file_name: download.suggestedFilename(),
    byte_size: zipBuffer.byteLength,
    sha256: zipHash,
    payloads: zipPayloads,
    required_payloads: [...businessRequiredZipPayloads],
    missing_payloads: missingZipPayloads,
    manifest: {
      package_id: manifest.package_id,
      project_id: manifest.project_id,
      item_count: manifest.items.length,
      required_output_count: manifest.required_outputs.length,
      workflow_acceptance: manifest.workflow_acceptance,
      ppt_ready_metadata_schema: manifest.ppt_ready_metadata.schema_version,
      ppt_slide_count: manifest.ppt_ready_metadata.slides.length
    },
    qa_report: {
      finding_count: qaReport.length,
      blocking_count: qaReport.filter((finding: { severity: string }) => finding.severity === "block").length,
      business_taxonomy_status: qaReport.find((finding: { id: string }) => finding.id === "qa-business-visual-doc-taxonomy")?.severity,
      readability_status: qaReport.find((finding: { id: string }) => finding.id === "qa-business-visual-doc-readability")?.severity
    },
    safety_report: {
      status: safetyReport.status,
      enforcement_stages: safetyReport.enforcementStages,
      finding_count: safetyReport.findings.length
    },
    metadata_payload: {
      provider: metadataPayload.provider,
      model: metadataPayload.model,
      skill: metadataPayload.skill,
      safety: metadataPayload.safety,
      prompt_spec: metadataPayload.prompt_spec
    },
    trace_provenance: {
      workflow_id: traceProvenance.workflow_id,
      workflow_fixture_id: traceProvenance.workflow_fixture_id,
      generated_by: traceProvenance.generated_by
    }
  });
});

test("writes local merchant campaign Local Alpha API, Playwright, and export ZIP runtime evidence", async ({ page, baseURL }) => {
  const startedAt = Date.now();
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem("zenart-local-alpha-local-merchant-evidence-reset")) {
      window.localStorage.clear();
      window.sessionStorage.setItem("zenart-local-alpha-local-merchant-evidence-reset", "true");
    }
  });

  await page.goto("/workspace");
  await expect(page.getByRole("heading", { name: "Launch Direction Board" })).toBeVisible();

  await page.getByRole("textbox", { name: "Brief" }).fill(
    "Local Merchant Campaign Pack: build a neighborhood bakery weekend offer for Maple Street Bakery with 20% pastry bundle, RMB 39 set price, 2026-06-06 event date, 88 Maple Road address, 021-5555-0136 phone, WeChat, Xiaohongshu, storefront print, and delivery platform cover outputs. Preserve price, date, phone, address, and QR-safe print/mobile details exactly."
  );
  await page.getByRole("button", { name: "Confirm Brief" }).click();
  await expect(page.getByText("Brief confirmed. I generated four deterministic strategy candidates for review.")).toBeVisible();

  await page.getByLabel("Reference type").selectOption("image");
  await page.getByLabel("Reference asset name or URL").fill("maple-bakery-storefront.webp");
  await page.getByRole("button", { name: "Attach" }).click();
  await expect(page.getByRole("button", { name: "Add reference maple-bakery-storefront.webp to package" })).toBeVisible();

  for (const taxonomy of ["wechat_conversion", "xiaohongshu_quality", "store_print", "delivery_platform_cover"]) {
    await expect(page.getByTestId(`candidate-card-${taxonomy}`)).toBeVisible();
  }

  await page.getByRole("button", { name: "Select WeChat Conversion" }).click();
  await page.getByLabel("Iteration instruction").fill(
    "Tighten mobile hierarchy, keep the RMB 39 price and 2026-06-06 date prominent, and preserve phone and address fields."
  );
  await page.getByRole("button", { name: "Iterate" }).click();
  await expect(
    page.getByText("WeChat Conversion refined with: Tighten mobile hierarchy, keep the RMB 39 price and 2026-06-06 date prominent, and preserve phone and address fields.")
  ).toBeVisible();

  for (const candidateLabel of localMerchantCandidateLabels) {
    await page.getByRole("button", { name: `Select ${candidateLabel}` }).click();
    await expect(page.getByRole("button", { name: `Select ${candidateLabel}` })).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("package-add-selected").click();
  }

  await page.getByTestId("export-download").click();
  await expect(page.getByText("zenart-001.zip")).toBeVisible();

  const workflowSmoke = page.locator("[data-workflow-api-smoke='stage0.rev2.workflow-api-smoke']");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-status", "pass");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-workflow", localMerchantWorkflowId);
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-fixture", localMerchantFixtureId);
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-ready-zip-export-count", "1");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-missing-output-count", "0");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-qa-taxonomy-id", "qa-local-merchant-campaign-taxonomy");
  await expect(workflowSmoke).toHaveAttribute("data-workflow-api-smoke-qa-taxonomy-status", "pass");

  const apiAttributes = await workflowSmoke.evaluate((element) => ({
    status: element.getAttribute("data-workflow-api-smoke-status"),
    scenario: element.getAttribute("data-workflow-api-smoke-scenario"),
    operationCount: element.getAttribute("data-workflow-api-smoke-operation-count"),
    operationIds: element.getAttribute("data-workflow-api-smoke-operations")?.split(",") ?? [],
    operationContracts: element.getAttribute("data-workflow-api-smoke-operation-contracts")?.split("|") ?? [],
    candidateCount: element.getAttribute("data-workflow-api-smoke-candidate-count"),
    taxonomyCount: element.getAttribute("data-workflow-api-smoke-taxonomy-count"),
    packagedTaxonomyCount: element.getAttribute("data-workflow-api-smoke-packaged-taxonomy-count"),
    readyZipExportCount: element.getAttribute("data-workflow-api-smoke-ready-zip-export-count"),
    missingOutputCount: element.getAttribute("data-workflow-api-smoke-missing-output-count"),
    csrfProtectedOperationCount: element.getAttribute("data-workflow-api-smoke-csrf-protected-operation-count"),
    idempotencyRequiredOperationCount: element.getAttribute("data-workflow-api-smoke-idempotency-required-operation-count"),
    qaTaxonomyId: element.getAttribute("data-workflow-api-smoke-qa-taxonomy-id"),
    qaTaxonomyStatus: element.getAttribute("data-workflow-api-smoke-qa-taxonomy-status"),
    safetyStatus: element.getAttribute("data-workflow-api-smoke-safety-status"),
    failures: element.getAttribute("data-workflow-api-smoke-failures")
  }));

  const renderingSmoke = page.locator("[data-rendering-smoke='stage0.rev2.workspace-rendering-performance']");
  await expect(renderingSmoke).toHaveAttribute("data-rendering-status", "pass");
  await expect(renderingSmoke).toHaveAttribute("data-render-failure-count", "0");

  const renderingAttributes = await renderingSmoke.evaluate((element) => ({
    status: element.getAttribute("data-rendering-status"),
    interactionSteps: element.getAttribute("data-render-interaction-steps")?.split(",") ?? [],
    renderElementCount: element.getAttribute("data-render-element-count"),
    maxRenderElements: element.getAttribute("data-render-max-elements"),
    estimatedInteractionMs: element.getAttribute("data-render-estimated-interaction-ms"),
    maxInteractionMs: element.getAttribute("data-render-max-interaction-ms"),
    failureCount: element.getAttribute("data-render-failure-count")
  }));

  await page.goto("/export");
  await expect(page.getByRole("heading", { name: "Export Preview" })).toBeVisible();

  const exportSmoke = page.locator("[data-workflow-api-smoke-export='stage0.rev2.workflow-api-smoke']");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-workflow", localMerchantWorkflowId);
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-status", "pass");
  await expect(exportSmoke).toHaveAttribute("data-workflow-api-smoke-export-missing-output-count", "0");

  const metadataEvidence = page.locator("[data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui']");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-metadata-status", "pass");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-id", localMerchantWorkflowId);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-workflow-fixture-id", localMerchantFixtureId);
  await expect(metadataEvidence).toHaveAttribute("data-package-export-missing-output-count", "0");
  await expect(metadataEvidence).toHaveAttribute("data-package-export-zip-payload-parity-status", "pass");

  const exportMetadata = await metadataEvidence.evaluate((element) => ({
    status: element.getAttribute("data-package-export-metadata-status"),
    exportId: element.getAttribute("data-package-export-id"),
    packageId: element.getAttribute("data-package-export-package-id"),
    manifestItemCount: element.getAttribute("data-package-export-manifest-item-count"),
    manifestRequiredOutputCount: element.getAttribute("data-package-export-manifest-required-output-count"),
    missingOutputCount: element.getAttribute("data-package-export-missing-output-count"),
    zipPayloadParityStatus: element.getAttribute("data-package-export-zip-payload-parity-status"),
    workflowMetadataProvider: element.getAttribute("data-package-export-workflow-metadata-provider"),
    workflowMetadataModel: element.getAttribute("data-package-export-workflow-metadata-model"),
    workflowMetadataPayloadPresent: element.getAttribute("data-package-export-workflow-metadata-payload-present"),
    traceProvenancePayloadPresent: element.getAttribute("data-package-export-workflow-trace-provenance-payload-present"),
    aiContentDisclaimerPayloadPresent: element.getAttribute("data-package-export-ai-content-disclaimer-payload-present")
  }));

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  expect(download.suggestedFilename()).toBe("zenart-001.zip");

  const zipBuffer = await readFile(downloadPath as string);
  const zipHash = createHash("sha256").update(zipBuffer).digest("hex");
  const zip = await JSZip.loadAsync(zipBuffer);
  const zipPayloads = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir)
    .sort();
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  const qaReport = JSON.parse(await zip.file("qa-report.json")!.async("string"));
  const safetyReport = JSON.parse(await zip.file("safety-policy-report.json")!.async("string"));
  const metadataPayload = JSON.parse(await zip.file("metadata.json")!.async("string"));
  const traceProvenance = JSON.parse(await zip.file("trace_provenance.json")!.async("string"));
  const missingZipPayloads = localMerchantRequiredZipPayloads.filter((payload) => !zipPayloads.includes(payload));

  expect(missingZipPayloads).toEqual([]);
  expect(manifest.workflow_acceptance.workflow_id).toBe(localMerchantWorkflowId);
  expect(manifest.workflow_acceptance.fixture_id).toBe(localMerchantFixtureId);
  expect(qaReport.some((finding: { id: string; severity: string }) => finding.id === "qa-local-merchant-campaign-taxonomy" && finding.severity === "pass")).toBe(true);
  expect(qaReport.some((finding: { id: string; severity: string }) => finding.id === "qa-local-merchant-structured-details" && finding.severity === "pass")).toBe(true);
  expect(safetyReport.status).toBe("pass");
  expect(metadataPayload.provider).toBe("dev-provider");
  expect(metadataPayload.model).toBe("deterministic-local-alpha");

  const completedAt = Date.now();
  const common = {
    ...commonEvidence(baseURL),
    workflow_id: localMerchantWorkflowId,
    fixture_id: localMerchantFixtureId
  };

  await writeEvidence("local_merchant_campaign_pack.api_smoke.json", {
    ...common,
    evidence_kind: "api_smoke",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    operation_ids: apiAttributes.operationIds,
    operation_contracts: apiAttributes.operationContracts,
    operation_count: Number(apiAttributes.operationCount),
    csrf_protected_operation_count: Number(apiAttributes.csrfProtectedOperationCount),
    idempotency_required_operation_count: Number(apiAttributes.idempotencyRequiredOperationCount),
    scenario: apiAttributes.scenario,
    assertions: {
      status: apiAttributes.status,
      candidate_count: Number(apiAttributes.candidateCount),
      taxonomy_count: Number(apiAttributes.taxonomyCount),
      packaged_taxonomy_count: Number(apiAttributes.packagedTaxonomyCount),
      ready_zip_export_count: Number(apiAttributes.readyZipExportCount),
      missing_output_count: Number(apiAttributes.missingOutputCount),
      qa_taxonomy_id: apiAttributes.qaTaxonomyId,
      qa_taxonomy_status: apiAttributes.qaTaxonomyStatus,
      safety_status: apiAttributes.safetyStatus,
      failures: apiAttributes.failures
    }
  });

  await writeEvidence("local_merchant_campaign_pack.playwright_happy_path.json", {
    ...common,
    evidence_kind: "playwright_happy_path",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    browser: "Desktop Chrome",
    route_assertions: ["/workspace", "/export"],
    interaction_steps: [
      "brief_confirmed",
      "storefront_reference_uploaded",
      "four_local_merchant_candidates_visible",
      "candidate_selected",
      "iteration_created",
      "all_local_merchant_taxonomy_candidates_packaged",
      "zip_export_created",
      "download_handoff_completed"
    ],
    rendering_performance: renderingAttributes,
    export_metadata_ui: exportMetadata,
    downloaded_file_name: download.suggestedFilename(),
    elapsed_ms: completedAt - startedAt
  });

  await writeEvidence("local_merchant_campaign_pack.export_zip.json", {
    ...common,
    evidence_kind: "export_zip",
    status: "pass",
    runner: evidenceRunner,
    command: evidenceCommand,
    file_name: download.suggestedFilename(),
    byte_size: zipBuffer.byteLength,
    sha256: zipHash,
    payloads: zipPayloads,
    required_payloads: [...localMerchantRequiredZipPayloads],
    missing_payloads: missingZipPayloads,
    manifest: {
      package_id: manifest.package_id,
      project_id: manifest.project_id,
      item_count: manifest.items.length,
      required_output_count: manifest.required_outputs.length,
      workflow_acceptance: manifest.workflow_acceptance,
      ppt_ready_metadata_schema: manifest.ppt_ready_metadata.schema_version,
      ppt_slide_count: manifest.ppt_ready_metadata.slides.length
    },
    qa_report: {
      finding_count: qaReport.length,
      blocking_count: qaReport.filter((finding: { severity: string }) => finding.severity === "block").length,
      local_merchant_taxonomy_status: qaReport.find((finding: { id: string }) => finding.id === "qa-local-merchant-campaign-taxonomy")?.severity,
      structured_details_status: qaReport.find((finding: { id: string }) => finding.id === "qa-local-merchant-structured-details")?.severity
    },
    safety_report: {
      status: safetyReport.status,
      enforcement_stages: safetyReport.enforcementStages,
      finding_count: safetyReport.findings.length
    },
    metadata_payload: {
      provider: metadataPayload.provider,
      model: metadataPayload.model,
      skill: metadataPayload.skill,
      safety: metadataPayload.safety,
      prompt_spec: metadataPayload.prompt_spec
    },
    trace_provenance: {
      workflow_id: traceProvenance.workflow_id,
      workflow_fixture_id: traceProvenance.workflow_fixture_id,
      generated_by: traceProvenance.generated_by
    }
  });
});
