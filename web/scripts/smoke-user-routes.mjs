import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactPath = path.join(root, "validation", "user-routes-smoke.json");
const generatedApiCsrfContractPath = path.join(root, "validation", "generated-api-csrf-contract.json");
const ecommerceGrowthWebSmokePath = path.join(root, "validation", "ecommerce-growth-web-smoke.json");
const appDir = path.join(root, "app");
const componentPath = path.join(root, "components", "workspace-app.tsx");
const workspaceSmokeTestPath = path.join(root, "components", "workspace-app.smoke.test.tsx");
const playwrightConfigPath = path.join(root, "playwright.config.ts");
const ecommercePlaywrightSpecPath = path.join(root, "tests", "ecommerce-growth.spec.ts");
const sessionSecurityPlaywrightSpecPath = path.join(root, "tests", "session-security.spec.ts");
const layoutPath = path.join(root, "app", "layout.tsx");
const legalPoliciesPath = path.join(root, "lib", "legal-policies.ts");
const telemetryPath = path.join(root, "lib", "telemetry.ts");
const requestSecurityPath = path.join(root, "lib", "request-security.ts");
const generatedApiPath = path.join(root, "lib", "generated", "zenart-api.ts");
const devStatePath = path.join(root, "lib", "dev-state.ts");

const fail = (message) => {
  console.error(`user route smoke failed: ${message}`);
  process.exit(1);
};

const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const componentSource = await readFile(componentPath, "utf8");
const workspaceSmokeTestSource = await readFile(workspaceSmokeTestPath, "utf8");
const playwrightConfigSource = await readFile(playwrightConfigPath, "utf8");
const ecommercePlaywrightSpecSource = await readFile(ecommercePlaywrightSpecPath, "utf8");
const sessionSecurityPlaywrightSpecSource = await readFile(sessionSecurityPlaywrightSpecPath, "utf8");
const layoutSource = await readFile(layoutPath, "utf8");
const legalPoliciesSource = await readFile(legalPoliciesPath, "utf8");
const telemetrySource = await readFile(telemetryPath, "utf8");
const requestSecuritySource = await readFile(requestSecurityPath, "utf8");
const generatedApiSource = await readFile(generatedApiPath, "utf8");
const devStateSource = await readFile(devStatePath, "utf8");
const generatedApiCsrfContract = JSON.parse(await readFile(generatedApiCsrfContractPath, "utf8"));
const ecommerceGrowthWebSmoke = JSON.parse(await readFile(ecommerceGrowthWebSmokePath, "utf8"));
const expectedViews = new Set(["workspace", "projects", "export", "billing", "account", "support"]);
const seenViews = new Set();

if (artifact.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("artifact must cite Docs/stage0_blueprint_rev2.md");
}

if (generatedApiCsrfContract.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("generated API CSRF contract must cite Docs/stage0_blueprint_rev2.md");
}

if (ecommerceGrowthWebSmoke.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("ecommerce growth web smoke must cite Docs/stage0_blueprint_rev2.md");
}

if (
  ecommerceGrowthWebSmoke.status !== "pass" ||
  ecommerceGrowthWebSmoke.scope !== "user-web-local-dev-client" ||
  ecommerceGrowthWebSmoke.doesNotCloseChecklistGates !== true ||
  ecommerceGrowthWebSmoke.checklistPolicy?.ecommerceApiSmokeChecklistRemainsOpen !== true ||
  ecommerceGrowthWebSmoke.checklistPolicy?.ecommercePlaywrightChecklistRemainsOpen !== true ||
  ecommerceGrowthWebSmoke.checklistPolicy?.localAlphaGateRemainsOpen !== true
) {
  fail("ecommerce growth web smoke must be passing web-local evidence while keeping runtime gates open");
}

const securityEvidence = artifact.securityEvidence ?? [];
const securityEvidenceBySchema = new Map(
  securityEvidence
    .filter((entry) => typeof entry === "object" && entry !== null)
    .map((entry) => [entry.schemaVersion, entry])
);

const requireSecurityEvidence = (schemaVersion) => {
  const evidence = securityEvidenceBySchema.get(schemaVersion);
  if (!evidence) {
    fail(`smoke artifact missing structured security evidence ${schemaVersion}`);
  }
  return evidence;
};

const sessionEvidence = requireSecurityEvidence("stage0.rev2.session-csrf-client-evidence");
const generatedCsrfEvidence = requireSecurityEvidence("stage0.rev2.generated-api-csrf-contract");
const renderingEvidence = requireSecurityEvidence("stage0.rev2.workspace-rendering-performance");
const referenceValidationEvidence = requireSecurityEvidence("stage0.rev2.reference-upload-validation-matrix");
const referenceUploadEvidence = requireSecurityEvidence("stage0.rev2.reference-upload-integration-smoke");
const briefUploadConfirmationEvidence = requireSecurityEvidence("stage0.rev2.brief-upload-confirmation-runtime-evidence");
const packageExportEvidence = requireSecurityEvidence("stage0.rev2.package-export-metadata-ui");
const exportZipPayloadEvidence = requireSecurityEvidence("stage0.rev2.export-zip-payload-smoke");
const exportDownloadParityEvidence = requireSecurityEvidence("stage0.rev2.export-download-parity-smoke");
const workflowApiSmokeEvidence = requireSecurityEvidence("stage0.rev2.workflow-api-smoke");

if (
  workflowApiSmokeEvidence.workflowId !== ecommerceGrowthWebSmoke.workflow.workflowId ||
  workflowApiSmokeEvidence.fixtureId !== ecommerceGrowthWebSmoke.workflow.fixtureId ||
  workflowApiSmokeEvidence.scenario !== ecommerceGrowthWebSmoke.workflow.scenario ||
  workflowApiSmokeEvidence.expectedStatus !== ecommerceGrowthWebSmoke.workflow.expectedStatus ||
  workflowApiSmokeEvidence.expectedOperationCount !== String(ecommerceGrowthWebSmoke.workflow.expectedOperationCount) ||
  workflowApiSmokeEvidence.expectedCandidateCount !== String(ecommerceGrowthWebSmoke.workflow.expectedCandidateCount) ||
  workflowApiSmokeEvidence.expectedTaxonomyCount !== String(ecommerceGrowthWebSmoke.workflow.expectedTaxonomyCount) ||
  workflowApiSmokeEvidence.expectedPackagedTaxonomyCount !== String(ecommerceGrowthWebSmoke.workflow.expectedPackagedTaxonomyCount) ||
  workflowApiSmokeEvidence.expectedReadyZipExportCount !== String(ecommerceGrowthWebSmoke.workflow.expectedReadyZipExportCount) ||
  workflowApiSmokeEvidence.expectedMissingOutputCount !== String(ecommerceGrowthWebSmoke.workflow.expectedMissingOutputCount) ||
  workflowApiSmokeEvidence.expectedCsrfProtectedOperationCount !== String(ecommerceGrowthWebSmoke.workflow.expectedCsrfProtectedOperationCount) ||
  workflowApiSmokeEvidence.expectedIdempotencyRequiredOperationCount !== String(ecommerceGrowthWebSmoke.workflow.expectedIdempotencyRequiredOperationCount)
) {
  fail("ecommerce growth web smoke fixture does not match user route smoke workflow evidence");
}

if (JSON.stringify(ecommerceGrowthWebSmoke.workflow.operationIds) !== JSON.stringify([
  "createChatSession",
  "createChatMessage",
  "createCandidateSet",
  "listCandidateAssets",
  "selectDirection",
  "createPackage",
  "createExport",
  "getExport"
])) {
  fail("ecommerce growth web smoke operation order drifted");
}

const generatedOperationMap = new Map(
  Array.from(generatedApiSource.matchAll(/^  ([a-zA-Z0-9]+): \{ method: "([A-Z]+)", path: "([^"]+)", rbac: "user", idempotencyRequired: (true|false)/gm))
    .map(([, operationId, method, operationPath, idempotencyRequired]) => [
      operationId,
      {
        method,
        path: operationPath,
        idempotencyRequired: idempotencyRequired === "true"
      }
    ])
);

for (const expectedContract of ecommerceGrowthWebSmoke.workflow.operationContracts ?? []) {
  const generatedOperation = generatedOperationMap.get(expectedContract.operationId);
  if (!generatedOperation) {
    fail(`ecommerce growth web smoke references unknown generated operation ${expectedContract.operationId}`);
  }
  if (
    generatedOperation.method !== expectedContract.method ||
    generatedOperation.path !== expectedContract.path ||
    generatedOperation.idempotencyRequired !== expectedContract.idempotencyRequired
  ) {
    fail(`ecommerce growth web smoke operation contract drifted for ${expectedContract.operationId}`);
  }
  if (expectedContract.credentialMode !== generatedApiCsrfContract.credentialMode) {
    fail(`ecommerce growth web smoke credential mode drifted for ${expectedContract.operationId}`);
  }
  const csrfProtected = generatedApiCsrfContract.protectedMethods.includes(expectedContract.method);
  const expectedCsrfHeader = csrfProtected ? generatedApiCsrfContract.csrfHeaderName : "not-required";
  if (expectedContract.csrfHeaderName !== expectedCsrfHeader) {
    fail(`ecommerce growth web smoke CSRF header contract drifted for ${expectedContract.operationId}`);
  }
}

if ((ecommerceGrowthWebSmoke.workflow.operationContracts ?? []).length !== ecommerceGrowthWebSmoke.workflow.operationIds.length) {
  fail("ecommerce growth web smoke must define one operation contract per operation");
}

for (const attribute of ecommerceGrowthWebSmoke.uiEvidence?.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`ecommerce growth web smoke UI source missing ${attribute}`);
  }
}

for (const snippet of ecommerceGrowthWebSmoke.uiEvidence?.requiredTestSnippets ?? []) {
  if (!workspaceSmokeTestSource.includes(snippet)) {
    fail(`ecommerce growth web smoke test missing ${snippet}`);
  }
}

if (ecommerceGrowthWebSmoke.browserEvidence?.doesNotCloseChecklistGates !== true) {
  fail("ecommerce growth browser smoke evidence must keep running-stack checklist gates open");
}

for (const snippet of ecommerceGrowthWebSmoke.browserEvidence?.requiredAssertions ?? []) {
  if (!ecommercePlaywrightSpecSource.includes(snippet)) {
    fail(`ecommerce growth browser smoke spec missing ${snippet}`);
  }
}

for (const expectedPlaywrightConfigSnippet of [
  "defineConfig",
  "webServer",
  "npm run dev -- --hostname 127.0.0.1",
  "channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? \"chrome\""
]) {
  if (!playwrightConfigSource.includes(expectedPlaywrightConfigSnippet)) {
    fail(`ecommerce growth browser smoke config missing ${expectedPlaywrightConfigSnippet}`);
  }
}

for (const taxonomy of ecommerceGrowthWebSmoke.workflow.strategyTaxonomy ?? []) {
  if (!devStateSource.includes(taxonomy) || !workspaceSmokeTestSource.includes(`candidate-card-${taxonomy}`) && !workspaceSmokeTestSource.includes(taxonomy)) {
    fail(`ecommerce growth web smoke missing taxonomy ${taxonomy}`);
  }
}

for (const requiredOutput of ecommerceGrowthWebSmoke.workflow.requiredOutputFiles ?? []) {
  if (!devStateSource.includes(requiredOutput) && !JSON.stringify(artifact).includes(requiredOutput)) {
    fail(`ecommerce growth web smoke missing required output ${requiredOutput}`);
  }
}

if (sessionEvidence.route !== "/account") {
  fail("session/CSRF client evidence must be attached to /account");
}

for (const requiredSessionAttribute of [
  sessionEvidence.statusAttribute,
  sessionEvidence.cookie?.httpOnlyAttribute,
  sessionEvidence.cookie?.secureAttribute,
  sessionEvidence.cookie?.sameSiteAttribute,
  sessionEvidence.cookie?.pathAttribute,
  sessionEvidence.csrf?.headerAttribute,
  sessionEvidence.csrf?.originPolicyAttribute,
  sessionEvidence.csrf?.missingOperationCountAttribute,
  sessionEvidence.csrf?.cookieFailureCountAttribute,
  sessionEvidence.csrf?.cookieFailureReasonsAttribute,
  sessionEvidence.csrf?.csrfFailureCountAttribute,
  sessionEvidence.csrf?.csrfFailureReasonsAttribute,
  sessionEvidence.unsafeActionGuard?.guardAttribute,
  sessionEvidence.unsafeActionGuard?.statusAttribute,
  sessionEvidence.unsafeActionGuard?.safeLabelsAttribute,
  sessionEvidence.unsafeActionGuard?.protectedMethodsAttribute,
  sessionEvidence.unsafeActionGuard?.guardCountAttribute,
  sessionEvidence.unsafeActionGuard?.guardLabelsAttribute
]) {
  if (!requiredSessionAttribute || !componentSource.includes(requiredSessionAttribute)) {
    fail(`session/CSRF UI evidence missing ${requiredSessionAttribute}`);
  }
}

if (
  sessionEvidence.expectedStatus !== "pass" ||
  sessionEvidence.cookie?.name !== "__Host-zenart_session" ||
  sessionEvidence.cookie?.expectedHttpOnly !== "true" ||
  sessionEvidence.cookie?.expectedSecure !== "true" ||
  sessionEvidence.cookie?.expectedSameSite !== "lax" ||
  sessionEvidence.cookie?.expectedPath !== "/" ||
  sessionEvidence.csrf?.expectedHeader !== "X-ZenArt-CSRF" ||
  sessionEvidence.csrf?.expectedSameSiteRequirement !== "lax-or-strict" ||
  sessionEvidence.csrf?.expectedOriginPolicy !== "same-site-only" ||
  sessionEvidence.csrf?.expectedMissingOperationCount !== "0" ||
  sessionEvidence.csrf?.expectedCookieFailureCount !== "0" ||
  sessionEvidence.csrf?.expectedCsrfFailureCount !== "0" ||
  sessionEvidence.unsafeActionGuard?.expectedGuard !== "authenticated-same-site-session" ||
  sessionEvidence.unsafeActionGuard?.expectedEnabledStatus !== "enabled" ||
  sessionEvidence.unsafeActionGuard?.expectedBlockedStatus !== "blocked" ||
  sessionEvidence.unsafeActionGuard?.expectedSafeLabels !== "load,login" ||
  sessionEvidence.unsafeActionGuard?.expectedProtectedMethods !== "POST,PUT,PATCH,DELETE" ||
  sessionEvidence.unsafeActionGuard?.expectedGuardCount !== "16"
) {
  fail("session/CSRF UI evidence does not assert the secure-cookie and same-site contract");
}

for (const expectedGuardLabel of sessionEvidence.unsafeActionGuard?.expectedGuardLabels ?? []) {
  if (!componentSource.includes(expectedGuardLabel) || !JSON.stringify(artifact).includes(expectedGuardLabel)) {
    fail(`same-site CSRF unsafe-action guard matrix missing ${expectedGuardLabel}`);
  }
}

for (const requiredGuardSnippet of [
  "requiresAuthenticatedSession",
  "sessionSafeActionLabels",
  "sameSiteUnsafeActionGuardLabels",
  "data-session-unsafe-action-guard",
  "data-session-unsafe-action-status",
  "data-session-unsafe-action-safe-labels",
  "data-session-unsafe-action-protected-methods",
  "data-session-unsafe-action-guard-count",
  "data-session-unsafe-action-guard-labels",
  "authenticated-same-site-session",
  "sessionBlocked || busy === \"brief\"",
  "sessionBlocked || !referenceName.trim()",
  "sessionBlocked || !state.selectedCandidateId",
  "sessionBlocked || !selectedCandidate",
  "sessionBlocked || busy === \"checkout\"",
  "sessionBlocked || busy === \"support\"",
  "Blocked ${label}: authenticated same-site session required"
]) {
  if (!componentSource.includes(requiredGuardSnippet)) {
    fail(`same-site CSRF unsafe-action guard missing ${requiredGuardSnippet}`);
  }
}

for (const requiredSessionBrowserSnippet of [
  "account route exposes secure-cookie, same-site CSRF, and unsafe-action guard browser evidence",
  "data-session-security-evidence",
  "data-session-cookie-name",
  "data-session-cookie-http-only",
  "data-session-cookie-secure",
  "data-session-cookie-same-site",
  "data-session-csrf-header",
  "data-session-csrf-origin-policy",
  "data-session-unsafe-action-guard",
  "data-session-unsafe-action-status",
  "data-session-unsafe-action-operation-contracts",
  "data-generated-api-csrf-contract",
  "data-generated-api-csrf-unsafe-operations",
  "data-generated-api-csrf-operation-contracts",
  "Session expired. Refresh or sign in to continue.",
  "Refresh Session",
  "Save Settings",
  "Sign In"
]) {
  if (!sessionSecurityPlaywrightSpecSource.includes(requiredSessionBrowserSnippet)) {
    fail(`session security browser smoke missing assertion ${requiredSessionBrowserSnippet}`);
  }
}

if (
  generatedCsrfEvidence.expectedStatus !== generatedApiCsrfContract.status ||
  generatedCsrfEvidence.credentialMode !== generatedApiCsrfContract.credentialMode ||
  generatedCsrfEvidence.csrfHeaderName !== generatedApiCsrfContract.csrfHeaderName ||
  generatedCsrfEvidence.csrfHeaderValue !== generatedApiCsrfContract.csrfHeaderValue ||
  generatedCsrfEvidence.sameSiteRequirement !== generatedApiCsrfContract.sameSiteRequirement ||
  generatedCsrfEvidence.originPolicy !== generatedApiCsrfContract.originPolicy ||
  generatedCsrfEvidence.unsafeOperationCount !== generatedApiCsrfContract.unsafeOperationCount ||
  generatedCsrfEvidence.safeOperationCount !== generatedApiCsrfContract.safeOperationCount ||
  generatedCsrfEvidence.missingUnsafeOperationCount !== generatedApiCsrfContract.missingUnsafeOperationCount ||
  generatedCsrfEvidence.failureCount !== generatedApiCsrfContract.failureCount
) {
  fail("structured generated API CSRF evidence does not match validation/generated-api-csrf-contract.json");
}
for (const attribute of generatedCsrfEvidence.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`generated API CSRF UI evidence missing ${attribute}`);
  }
}
for (const requestContract of generatedApiCsrfContract.unsafeRequestContracts ?? []) {
  if (
    requestContract.credentials !== generatedApiCsrfContract.credentialMode ||
    requestContract.csrfHeaderName !== generatedApiCsrfContract.csrfHeaderName ||
    requestContract.csrfHeaderValue !== generatedApiCsrfContract.csrfHeaderValue ||
    !generatedApiSource.includes(requestContract.operationId)
  ) {
    fail(`generated API CSRF request contract drifted for ${requestContract.operationId}`);
  }
}

for (const evidence of [renderingEvidence, referenceUploadEvidence, packageExportEvidence, exportZipPayloadEvidence]) {
  if (evidence.expectedStatus !== "pass") {
    fail(`${evidence.schemaVersion} must assert a passing local-alpha UI evidence status`);
  }
  if (!artifact.routes.some((route) => route.path === evidence.route)) {
    fail(`${evidence.schemaVersion} is attached to an unknown route ${evidence.route}`);
  }
  if (!componentSource.includes(evidence.statusAttribute)) {
    fail(`${evidence.schemaVersion} UI source missing ${evidence.statusAttribute}`);
  }
}

if (
  workflowApiSmokeEvidence.expectedStatus !== "pass" ||
  workflowApiSmokeEvidence.workflowId !== "ecommerce_growth_pack" ||
  workflowApiSmokeEvidence.fixtureId !== "fx_ecommerce_growth_golden" ||
  workflowApiSmokeEvidence.scenario !== "brief-reference-four-candidates-select-iterate-package-export-zip" ||
  workflowApiSmokeEvidence.expectedOperationCount !== "8" ||
  workflowApiSmokeEvidence.expectedCandidateCount !== "4" ||
  workflowApiSmokeEvidence.expectedTaxonomyCount !== "4" ||
  workflowApiSmokeEvidence.expectedPackagedTaxonomyCount !== "4" ||
  workflowApiSmokeEvidence.expectedReadyZipExportCount !== "1" ||
  workflowApiSmokeEvidence.expectedMissingOutputCount !== "0" ||
  workflowApiSmokeEvidence.expectedCsrfProtectedOperationCount !== "6" ||
  workflowApiSmokeEvidence.expectedIdempotencyRequiredOperationCount !== "6"
) {
  fail("ecommerce workflow API smoke evidence must assert a passing local web workflow contract");
}

for (const attribute of workflowApiSmokeEvidence.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`ecommerce workflow API smoke evidence missing attribute ${attribute}`);
  }
}

for (const expectedContract of workflowApiSmokeEvidence.expectedOperationContracts ?? []) {
  const structuredContractPresent = (ecommerceGrowthWebSmoke.workflow.operationContracts ?? []).some((contract) => {
    const serializedContract = [
      contract.operationId,
      contract.method,
      contract.path,
      contract.credentialMode,
      contract.csrfHeaderName,
      String(contract.idempotencyRequired)
    ].join(":");
    return serializedContract === expectedContract;
  });
  if (!structuredContractPresent && !workspaceSmokeTestSource.includes(expectedContract)) {
    fail(`ecommerce workflow API smoke evidence missing operation contract ${expectedContract}`);
  }
}

for (const attribute of renderingEvidence.budgetAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`workspace rendering evidence missing budget attribute ${attribute}`);
  }
}
if (renderingEvidence.expectedFailureCount !== "0") {
  fail("workspace rendering evidence must assert zero failures");
}

if (
  referenceValidationEvidence.expectedStatus !== "pass" ||
  referenceValidationEvidence.scenario !== "safe-image-document-https-url-reject-unsupported" ||
  referenceValidationEvidence.expectedRejectedCount !== "2" ||
  JSON.stringify(referenceValidationEvidence.expectedAcceptedKinds) !== JSON.stringify(["image", "document", "url"])
) {
  fail("reference upload validation matrix must assert safe image, PDF, HTTPS URL acceptance and unsupported input rejection");
}
for (const attribute of referenceValidationEvidence.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`reference upload validation matrix missing attribute ${attribute}`);
  }
}
for (const sample of [
  ...(referenceValidationEvidence.requiredAcceptedSamples ?? []),
  ...(referenceValidationEvidence.requiredRejectedSamples ?? [])
]) {
  if (!componentSource.includes(sample) && !devStateSource.includes(sample) && !JSON.stringify(artifact).includes(sample)) {
    fail(`reference upload validation matrix missing sample ${sample}`);
  }
}

for (const attribute of referenceUploadEvidence.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`reference upload evidence missing attribute ${attribute}`);
  }
}
if (referenceUploadEvidence.scenario !== "reference-upload-to-ready-zip-export") {
  fail("reference upload evidence must pin the reference-upload-to-ready-zip-export scenario");
}
if (
  referenceUploadEvidence.expectedOperationCount !== "4" ||
  JSON.stringify(referenceUploadEvidence.expectedOperations) !== JSON.stringify([
    "createUpload",
    "createPackage",
    "createExport",
    "getExport"
  ])
) {
  fail("reference upload evidence must prove createUpload -> createPackage -> createExport -> getExport operation coverage");
}
for (const expectedSnippet of [
  "latestAcceptedReferenceId",
  "latestAcceptedReferenceName",
  "latestAcceptedReferencePackaged",
  "latestAcceptedReferenceProvenancePresent",
  "latestAcceptedReferencePptSlidePresent",
  "referenceUploadIntegrationOperationIds"
]) {
  if (!devStateSource.includes(expectedSnippet)) {
    fail(`reference upload integration smoke missing latest-reference contract field ${expectedSnippet}`);
  }
}

if (
  briefUploadConfirmationEvidence.expectedStatus !== "pass" ||
  briefUploadConfirmationEvidence.scenario !== "user-web-brief-upload-confirmation" ||
  briefUploadConfirmationEvidence.gateImpact !== "private-beta-staging-runtime" ||
  briefUploadConfirmationEvidence.expectedOperationCount !== "4" ||
  briefUploadConfirmationEvidence.stagingEvidencePath !== "ops/evidence/staging/20260526T2330Z-brief-upload-confirmation.json" ||
  !briefUploadConfirmationEvidence.canCloseChecklistGate
) {
  fail("brief/upload/confirmation runtime evidence must cite the validator-owned staging evidence artifact");
}
for (const attribute of briefUploadConfirmationEvidence.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`brief/upload/confirmation runtime evidence missing attribute ${attribute}`);
  }
}

if (packageExportEvidence.expectedMissingOutputCount !== "0") {
  fail("package/export metadata evidence must assert zero missing required outputs");
}
if (packageExportEvidence.expectedDownloadArtifactStatus !== "pass") {
  fail("package/export metadata evidence must assert a passing downloadable artifact contract");
}
if (packageExportEvidence.expectedMissingZipPayloadCount !== "0") {
  fail("package/export metadata evidence must assert zero missing ZIP payloads");
}
if (packageExportEvidence.minimumZipPayloadCount !== "7") {
  fail("package/export metadata evidence must assert at least the seven required ZIP payloads");
}
if (
  packageExportEvidence.expectedWorkflowMetadata?.generatedBy !== "zenart-web-dev-client" ||
  packageExportEvidence.expectedWorkflowMetadata?.provider !== "dev-provider" ||
  packageExportEvidence.expectedWorkflowMetadata?.model !== "deterministic-local-alpha" ||
  packageExportEvidence.expectedWorkflowMetadata?.skill !== "ecommerce_growth_pack" ||
  packageExportEvidence.expectedWorkflowMetadata?.safety !== "pass"
) {
  fail("package/export metadata evidence must assert provider, model, skill, prompt/spec, and safety metadata values");
}
if (!componentSource.includes(packageExportEvidence.payloadAttribute)) {
  fail(`package/export metadata evidence missing payload attribute ${packageExportEvidence.payloadAttribute}`);
}
if (!componentSource.includes(packageExportEvidence.requiredPayloadAttribute)) {
  fail(`package/export metadata evidence missing required payload attribute ${packageExportEvidence.requiredPayloadAttribute}`);
}
for (const attribute of packageExportEvidence.requiredIdentityAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`package/export metadata evidence missing identity attribute ${attribute}`);
  }
}
for (const payload of packageExportEvidence.requiredPayloads ?? []) {
  if (!JSON.stringify(artifact).includes(payload)) {
    fail(`package/export metadata evidence missing required payload ${payload}`);
  }
}
for (const taxonomy of packageExportEvidence.expectedWorkflowMetadata?.promptSpecTaxonomy ?? []) {
  if (!devStateSource.includes(taxonomy) && !JSON.stringify(artifact).includes(taxonomy)) {
    fail(`package/export metadata evidence missing prompt/spec taxonomy ${taxonomy}`);
  }
}

if (
  exportZipPayloadEvidence.expectedMissingPayloadCount !== "0" ||
  exportZipPayloadEvidence.expectedMetadataPayloadPresent !== "true" ||
  exportZipPayloadEvidence.expectedTraceProvenancePayloadPresent !== "true" ||
  exportZipPayloadEvidence.expectedAiContentDisclaimerPayloadPresent !== "true" ||
  exportZipPayloadEvidence.expectedAssetsPayloadPresent !== "true" ||
  exportZipPayloadEvidence.sharedPayloadPlanner !== "buildDownloadableExportZipPayloadNames" ||
  exportZipPayloadEvidence.scenario !== "manifest-required-output-to-downloadable-zip-payloads"
) {
  fail("export ZIP payload smoke must assert complete manifest-required downloadable payload coverage through the shared payload planner");
}
for (const attribute of exportZipPayloadEvidence.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`export ZIP payload smoke missing attribute ${attribute}`);
  }
}
for (const payload of exportZipPayloadEvidence.requiredPayloads ?? []) {
  if (!componentSource.includes(payload) && !devStateSource.includes(payload) && !JSON.stringify(artifact).includes(payload)) {
    fail(`export ZIP payload smoke missing required payload ${payload}`);
  }
}
if (
  exportZipPayloadEvidence.downloadHandoffEvidence?.schemaVersion !== "stage0.rev2.package-export-download-handoff" ||
  exportZipPayloadEvidence.downloadHandoffEvidence?.buttonAttribute !== "data-export-download-handoff" ||
  exportZipPayloadEvidence.downloadHandoffEvidence?.statusAttribute !== "data-export-download-handoff-status" ||
  exportZipPayloadEvidence.downloadHandoffEvidence?.expectedStatus !== "pass"
) {
  fail("export ZIP payload smoke must define browser download handoff evidence");
}
for (const attribute of [
  exportZipPayloadEvidence.downloadHandoffEvidence?.buttonAttribute,
  exportZipPayloadEvidence.downloadHandoffEvidence?.statusAttribute,
  ...(exportZipPayloadEvidence.downloadHandoffEvidence?.requiredAttributes ?? [])
]) {
  if (!attribute || !componentSource.includes(attribute)) {
    fail(`export ZIP payload smoke missing download handoff attribute ${attribute}`);
  }
}
for (const expectedSnippet of [
  "buildExportZipPayloadSmokeEvidence",
  "buildDownloadableExportZipPayloadNames",
  "stage0.rev2.export-zip-payload-smoke",
  "manifest-required-output-to-downloadable-zip-payloads",
  "metadataPayloadPresent",
  "traceProvenancePayloadPresent",
  "aiContentDisclaimerPayloadPresent",
  "assetsPayloadPresent"
]) {
  if (!devStateSource.includes(expectedSnippet) && !componentSource.includes(expectedSnippet)) {
    fail(`export ZIP payload smoke missing source contract ${expectedSnippet}`);
  }
}

if (
  exportDownloadParityEvidence.expectedStatus !== "pass" ||
  exportDownloadParityEvidence.expectedMetadataStatus !== "pass" ||
  exportDownloadParityEvidence.expectedZipPayloadStatus !== "pass" ||
  exportDownloadParityEvidence.expectedDownloadHandoffStatus !== "pass" ||
  exportDownloadParityEvidence.expectedMissingPayloadCount !== "0" ||
  exportDownloadParityEvidence.expectedPayloadsMatch !== "true" ||
  exportDownloadParityEvidence.scenario !== "metadata-zip-smoke-download-handoff-parity"
) {
  fail("export download parity smoke must assert metadata, ZIP payload, and browser handoff parity");
}
for (const attribute of exportDownloadParityEvidence.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute)) {
    fail(`export download parity smoke missing attribute ${attribute}`);
  }
}
for (const sourceContract of exportDownloadParityEvidence.requiredSourceContracts ?? []) {
  if (!componentSource.includes(sourceContract) && !devStateSource.includes(sourceContract)) {
    fail(`export download parity smoke missing source contract ${sourceContract}`);
  }
}

for (const route of artifact.routes) {
  if (!expectedViews.has(route.initialView)) {
    fail(`${route.path} has unsupported initialView ${route.initialView}`);
  }

  seenViews.add(route.initialView);
  const pagePath = path.join(appDir, route.path.slice(1), "page.tsx");
  if (!existsSync(pagePath)) {
    fail(`${route.path} is missing ${path.relative(root, pagePath)}`);
  }

  const pageSource = await readFile(pagePath, "utf8");
  if (!pageSource.includes(`initialView="${route.initialView}"`)) {
    fail(`${route.path} page does not render WorkspaceApp with initialView="${route.initialView}"`);
  }

  if (!componentSource.includes(`${route.initialView}: "${route.path}"`)) {
    fail(`WorkspaceApp route map does not send ${route.initialView} to ${route.path}`);
  }
}

for (const policyRoute of artifact.policyRoutes) {
  const pagePath = path.join(appDir, policyRoute.path.slice(1), "page.tsx");
  if (!existsSync(pagePath)) {
    fail(`${policyRoute.path} is missing ${path.relative(root, pagePath)}`);
  }

  const pageSource = await readFile(pagePath, "utf8");
  if (!pageSource.includes("LegalPolicyPage")) {
    fail(`${policyRoute.path} does not render LegalPolicyPage`);
  }

  if (!legalPoliciesSource.includes(`route: "${policyRoute.path}"`)) {
    fail(`legal policy contract missing route ${policyRoute.path}`);
  }
}

for (const view of expectedViews) {
  if (!seenViews.has(view)) {
    fail(`artifact missing ${view} route`);
  }
}

for (const requiredSnippet of [
  "aria-current",
  "role=\"status\"",
  "role=\"alert\"",
  "role=\"progressbar\"",
  "aria-label=\"Reload workspace\"",
  "className=\"sr-only\"",
  "id=\"reference-kind\"",
  "aria-pressed",
  "manifest-preview",
  "qa-report",
  "provenance-report",
  "package-export-metadata-evidence",
  "export-zip-payload-smoke",
  "Export ZIP payload smoke",
  "ZIP Payload Smoke",
  "data-export-zip-payload-smoke",
  "data-export-zip-payload-smoke-status",
  "data-export-zip-payload-smoke-scenario",
  "data-export-zip-payload-export-id",
  "data-export-zip-payload-package-id",
  "data-export-zip-payload-manifest-required-output-count",
  "data-export-zip-payload-expected-count",
  "data-export-zip-payload-baseline-payloads",
  "data-export-zip-payload-expected-payloads",
  "data-export-zip-payload-missing-count",
  "data-export-zip-payload-missing-payloads",
  "data-export-zip-payload-workflow-payloads",
  "data-export-zip-payload-metadata-present",
  "data-export-zip-payload-trace-provenance-present",
  "data-export-zip-payload-assets-present",
  "data-export-zip-payload-failures",
  "data-export-download-handoff",
  "data-export-download-handoff-status",
  "data-export-download-id",
  "data-export-download-file-name",
  "data-export-download-format",
  "data-export-download-package-id",
  "data-export-download-manifest-output-count",
  "data-export-download-zip-payload-status",
  "data-export-download-zip-payload-count",
  "data-export-download-missing-payload-count",
  "data-export-download-metadata-status",
  "data-export-download-artifact-status",
  "data-export-download-required-payload-parity",
  "data-package-export-metadata-ui",
  "data-package-export-metadata-status",
  "data-package-export-id",
  "data-package-export-package-id",
  "data-package-export-project-id",
  "data-package-export-manifest-created-at",
  "data-package-export-manifest-item-count",
  "data-package-export-manifest-required-output-count",
  "data-package-export-download-artifact-status",
  "data-package-export-download-artifact-format",
  "data-package-export-required-output-count",
  "data-package-export-missing-output-count",
  "data-package-export-item-types",
  "data-package-export-provenance-count",
  "data-package-export-blocking-qa-count",
  "data-package-export-safety-status",
  "data-package-export-safety-stage-count",
  "data-package-export-safety-finding-count",
  "data-package-export-ppt-aspect-ratio",
  "data-package-export-ppt-slide-count",
  "data-package-export-ppt-canvas-size",
  "data-package-export-ppt-safe-area",
  "data-package-export-ppt-theme-font",
  "data-package-export-ppt-handoff-checklist-count",
  "data-package-export-zip-payload-count",
  "data-package-export-zip-payloads",
  "data-package-export-required-zip-payloads",
  "data-package-export-missing-zip-payload-count",
  "data-package-export-workflow-id",
  "data-package-export-workflow-fixture-id",
  "data-package-export-workflow-taxonomy-count",
  "data-package-export-workflow-required-file-count",
  "data-package-export-workflow-zip-payload-count",
  "data-package-export-workflow-metadata-payload-present",
  "data-package-export-workflow-trace-provenance-payload-present",
  "data-package-export-ai-content-disclaimer-payload-present",
  "data-package-export-workflow-provider-metadata-present",
  "data-package-export-workflow-prompt-spec-metadata-present",
  "data-package-export-workflow-skill-metadata-present",
  "data-package-export-workflow-safety-metadata-present",
  "payload-status-groups",
  "Package export payload status matrix",
  "data-payload-status-kind",
  "data-package-export-payload-row",
  "data-package-export-payload-name",
  "data-package-export-payload-present",
  "data-package-export-payload-zip-name",
  "reference-upload-export-contract",
  "brief-upload-confirmation-evidence",
  "Brief upload confirmation runtime evidence",
  "data-brief-upload-confirmation-runtime-evidence",
  "data-brief-upload-confirmation-status",
  "data-brief-upload-confirmation-gate-impact",
  "data-brief-confirmed",
  "data-brief-missing-info-count",
  "data-brief-accepted-reference-count",
  "data-brief-rejected-reference-count",
  "data-brief-latest-reference-validation",
  "data-brief-confirmation-message-visible",
  "data-brief-candidate-set-ready",
  "data-brief-upload-confirmation-operation-count",
  "data-brief-upload-confirmation-operations",
  "data-brief-upload-confirmation-failures",
  "data-reference-upload-export-contract",
  "data-reference-provenance-count",
  "dev-client-reference",
  "ppt-ready-metadata",
  "PPT-ready Metadata",
  "ppt_ready_metadata",
  "share-link-state",
  "setBillingScenario",
  "supportContactEmail",
  "legalPolicyList",
  "/legal/billing-policy",
  "privacy-notice",
  "ai-content-disclaimer",
  "linkedAssetIds",
  "linkedTraceId",
  "validation.state",
  "buildReferenceUploadIntegrationSmoke",
  "reference-export-smoke",
  "data-reference-export-smoke",
  "data-reference-upload-integration-smoke",
  "data-reference-upload-integration-status",
  "data-reference-upload-integration-operation-count",
  "data-reference-upload-integration-operations",
  "data-reference-accepted-count",
  "data-reference-accepted-kinds",
  "data-reference-rejected-count",
  "data-reference-latest-accepted-id",
  "data-reference-latest-accepted-name",
  "data-reference-latest-packaged",
  "data-reference-latest-provenance-present",
  "data-reference-latest-ppt-slide-present",
  "data-reference-packaged-count",
  "data-reference-package-history-count",
  "data-reference-ready-export-count",
  "data-reference-provenance-count",
  "data-reference-ppt-asset-grid-slide-count",
  "data-reference-upload-integration-failures",
  "workflow-api-smoke",
  "Ecommerce growth API smoke",
  "data-workflow-api-smoke",
  "data-workflow-api-smoke-status",
  "data-workflow-api-smoke-workflow",
  "data-workflow-api-smoke-fixture",
  "data-workflow-api-smoke-scenario",
  "data-workflow-api-smoke-operation-count",
  "data-workflow-api-smoke-candidate-count",
  "data-workflow-api-smoke-taxonomy-count",
  "data-workflow-api-smoke-packaged-taxonomy-count",
  "data-workflow-api-smoke-ready-zip-export-count",
  "data-workflow-api-smoke-missing-output-count",
  "data-workflow-api-smoke-qa-taxonomy-status",
  "data-workflow-api-smoke-safety-status",
  "data-workflow-api-smoke-operation-contracts",
  "data-workflow-api-smoke-csrf-protected-operation-count",
  "data-workflow-api-smoke-idempotency-required-operation-count",
  "data-workflow-api-smoke-failures",
  "data-workflow-api-smoke-export",
  "data-workflow-api-smoke-export-status",
  "data-workflow-api-smoke-export-operation-contracts",
  "data-workflow-api-smoke-export-csrf-protected-operation-count",
  "data-workflow-api-smoke-export-idempotency-required-operation-count",
  "data-testid=\"candidate-grid\"",
  "data-testid={candidate.strategyTaxonomy",
  "data-testid=\"candidate-select\"",
  "data-testid=\"iterate-selected-direction\"",
  "data-testid=\"package-add-selected\"",
  "data-testid=\"export-preview\"",
  "data-testid=\"export-download\"",
  "Add reference",
  "reference-package-button",
  "session-contract",
  "Auth and session status",
  "sessionContract.status",
  "data-session-security-evidence",
  "stage0.rev2.session-csrf-client-evidence",
  "data-session-security-status",
  "data-session-cookie-name",
  "data-session-cookie-http-only",
  "data-session-cookie-secure",
  "data-session-cookie-same-site",
  "data-session-cookie-path",
  "data-session-csrf-header",
  "data-session-csrf-origin-policy",
  "data-session-csrf-missing-operation-count",
  "data-session-cookie-failure-count",
  "data-session-cookie-failure-reasons",
  "data-session-csrf-failure-count",
  "data-session-csrf-failure-reasons",
  "__Host-zenart_session",
  "HttpOnly",
  "Secure",
  "SameSite=",
  "X-ZenArt-CSRF",
  "same-site-origin-check",
  "sameSiteRequired",
  "sameSiteRequirement",
  "credentialMode",
  "originPolicy",
  "protectedMethods",
  "cookieFailureReasons",
  "csrfFailureReasons",
  "csrf-operation-inventory",
  "Generated web API CSRF operation inventory",
  "data-csrf-operation-count",
  "data-generated-api-csrf-unsafe-operations",
  "data-generated-api-csrf-safe-operations",
  "data-generated-api-csrf-idempotency-required-operations",
  "data-generated-api-csrf-idempotency-exempt-operations",
  "generated web operations require same-site CSRF headers",
  "CSRF and same-site contract evidence",
  "lax-or-strict",
  "zenArtClient.login",
  "zenArtClient.refreshSession",
  "zenArtClient.expireSession",
  "zenArtClient.logout",
  "Session expired",
  "Signed out"
]) {
  if (!componentSource.includes(requiredSnippet)) {
    fail(`WorkspaceApp missing accessible state snippet ${requiredSnippet}`);
  }
}

for (const expectedSecuritySnippet of [
  "defaultSameSiteCsrfContract",
  "buildSessionSecurityContractEvidence",
  "schema_version: \"stage0.rev2.session-csrf-client-evidence\"",
  "credentialMode: \"include\"",
  "originPolicy: \"same-site-only\"",
  "protectedMethods",
  "missingCsrfOperationIds",
  "cookieFailureReasons",
  "csrfFailureReasons",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "buildCsrfRequestHeaders",
  "headers[contract.headerName] ?? contract.headerValue"
]) {
  if (!requestSecuritySource.includes(expectedSecuritySnippet)) {
    fail(`same-site CSRF request contract missing ${expectedSecuritySnippet}`);
  }
}

for (const expectedApiSnippet of [
  "buildCsrfRequestHeaders(operation.method",
  "credentials: defaultSameSiteCsrfContract.credentialMode",
  "\"X-ZenArt-CSRF\"",
  "assertSameSiteBaseUrl",
  "same-origin for same-site CSRF protection",
  "isUnsafePathParam"
]) {
  if (!generatedApiSource.includes(expectedApiSnippet) && !requestSecuritySource.includes(expectedApiSnippet)) {
    fail(`generated web API client CSRF integration missing ${expectedApiSnippet}`);
  }
}

const generatedOperationIds = Array.from(generatedApiSource.matchAll(/^  ([a-zA-Z0-9]+): \{ method: "([A-Z]+)"/gm)).map(
  ([, operationId, method]) => ({ operationId, method })
);
const generatedUnsafeOperationIds = generatedOperationIds
  .filter(({ method }) => generatedApiCsrfContract.protectedMethods.includes(method))
  .map(({ operationId }) => operationId);
const generatedSafeOperationIds = generatedOperationIds
  .filter(({ method }) => !generatedApiCsrfContract.protectedMethods.includes(method))
  .map(({ operationId }) => operationId);

for (const expectedContractField of [
  "stage0.rev2.generated-api-csrf-contract",
  "web/lib/generated/zenart-api.ts",
  "web/lib/request-security.ts",
  "include",
  "X-ZenArt-CSRF",
  "same-site-origin-check",
  "lax-or-strict",
  "same-site-only"
]) {
  if (!JSON.stringify(generatedApiCsrfContract).includes(expectedContractField)) {
    fail(`generated API CSRF contract artifact missing ${expectedContractField}`);
  }
}

if (generatedApiCsrfContract.unsafeOperationCount !== generatedUnsafeOperationIds.length) {
  fail("generated API CSRF unsafe operation count does not match generated client");
}

if (JSON.stringify(generatedApiCsrfContract.unsafeOperations) !== JSON.stringify(generatedUnsafeOperationIds)) {
  fail("generated API CSRF unsafe operation inventory does not match generated client");
}

if (JSON.stringify(generatedApiCsrfContract.safeOperations) !== JSON.stringify(generatedSafeOperationIds)) {
  fail("generated API CSRF safe operation inventory does not match generated client");
}

if (generatedApiCsrfContract.credentialMode !== "include") {
  fail("generated API CSRF contract must require same-site credentials include mode");
}

for (const requiredSnippet of [
  "ClientTelemetry",
  "captureAnalyticsEvent(\"route_viewed\")",
  "reportFrontendError"
]) {
  const telemetryComponentPath = path.join(root, "components", "client-telemetry.tsx");
  const telemetryComponentSource = await readFile(telemetryComponentPath, "utf8");
  if (!layoutSource.includes(requiredSnippet) && !telemetrySource.includes(requiredSnippet) && !telemetryComponentSource.includes(requiredSnippet)) {
    fail(`client telemetry contract missing ${requiredSnippet}`);
  }
}

for (const expectedEvent of artifact.analyticsEvents) {
  if (!telemetrySource.includes(`${expectedEvent}:`)) {
    fail(`analytics taxonomy missing ${expectedEvent}`);
  }
}

for (const expectedPolicy of [
  "Terms of Service",
  "Privacy Policy",
  "Acceptable Use Policy",
  "IP Complaint Flow",
  "Billing, Cancellation, and Refund Policy",
  "support@zenart.local",
  "legal@zenart.local"
]) {
  if (!legalPoliciesSource.includes(expectedPolicy)) {
    fail(`legal policy source missing ${expectedPolicy}`);
  }
}

for (const expectedCapability of [
  "reference-validation",
  "reference-upload-validation-matrix",
  "brief-upload-confirmation-runtime-evidence",
  "reference-upload-export-contract",
  "workspace-rendering-performance-smoke",
  "ecommerce-growth-api-smoke",
  "past-due-edge",
  "inactive-edge",
  "quota-exhausted-edge",
  "visible-support-contact",
  "privacy-notice",
  "terms-of-service",
  "privacy-policy-route",
  "acceptable-use-policy",
  "ip-complaint-flow",
  "billing-cancellation-refund-policy",
  "ai-content-disclaimer",
  "linked-task-trace-asset-context",
  "analytics-event-taxonomy",
  "client-side-ui-funnel-capture",
  "frontend-error-reporting"
]) {
  if (!JSON.stringify(artifact).includes(expectedCapability)) {
    fail(`smoke artifact missing expected capability ${expectedCapability}`);
  }
}

for (const expectedIntegration of [
  "reference-upload-to-ready-zip-export",
  "safe-image-document-https-url-reject-unsupported",
  "brief-upload-confirmation-runtime-evidence",
  "reference-upload-zip-provenance-ppt-asset-grid",
  "ecommerce-growth-pack-api-smoke",
  "generated-api-unsafe-operation-csrf-inventory",
  "workspace-rendering-performance-budget",
  "zip-download-manifest-qa-provenance-assets",
  "zip-download-safety-policy-report",
  "export-zip-payload-smoke",
  "export-download-parity-smoke",
  "package-export-metadata-ui-evidence",
  "ppt-ready-metadata-export-contract",
  "pdf-placeholder-download-contract",
  "browser-download-handoff"
]) {
  if (!JSON.stringify(artifact).includes(expectedIntegration)) {
    fail(`smoke artifact missing expected integration ${expectedIntegration}`);
  }
}

for (const expectedDownloadSnippet of [
  "buildExportPackageBlob",
  "buildDownloadableExportZipPayloadNames",
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "provenance.json",
  "ppt-ready-metadata.json",
  "assets/README.txt",
  "application/pdf",
  "URL.createObjectURL",
  "link.download"
]) {
  const exportDownloadPath = path.join(root, "lib", "export-download.ts");
  const exportDownloadSource = await readFile(exportDownloadPath, "utf8");
  if (!exportDownloadSource.includes(expectedDownloadSnippet)) {
    fail(`export download contract missing ${expectedDownloadSnippet}`);
  }
}

const exportDownloadTestPath = path.join(root, "lib", "export-download.test.ts");
const exportDownloadTestSource = await readFile(exportDownloadTestPath, "utf8");
for (const expectedDownloadSmokeSnippet of [
  "buildDownloadableExportZipPayloadNames",
  "dev-client-reference:ref-campaign-reference-webp",
  "dev-client-reference:ref-launch-brief-pdf",
  "dev-client-reference:ref-https-assets-example-com-reference-pack",
  "layout: \"asset-grid\"",
  "safety-policy-report.json",
  "assets/square_social_ad.png",
  "workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id",
  "URL.createObjectURL",
  "for (const payloadName of expectedPayloadNames)",
  "ZIP payload ${payloadName} should exist"
]) {
  if (!exportDownloadTestSource.includes(expectedDownloadSmokeSnippet)) {
    fail(`reference upload ZIP integration smoke missing ${expectedDownloadSmokeSnippet}`);
  }
}

for (const expectedPackageExportMetadataSnippet of [
  "requiredZipPayloadCount",
  "zipPayloadParityStatus",
  "zipPayloadParityRatio",
  "manifestOutputStatuses",
  "requiredZipPayloadStatuses",
  "workflowPayloadStatuses",
  "data-package-export-required-zip-payload-count",
  "data-package-export-zip-payload-parity-status",
  "data-package-export-zip-payload-parity-ratio",
  "data-package-export-payload-row",
  "data-package-export-payload-name",
  "data-package-export-payload-present",
  "data-package-export-payload-zip-name",
  "required ZIP parity",
  "required payloads present"
]) {
  if (!componentSource.includes(expectedPackageExportMetadataSnippet) && !devStateSource.includes(expectedPackageExportMetadataSnippet)) {
    fail(`package/export metadata UI evidence missing ${expectedPackageExportMetadataSnippet}`);
  }
}

for (const requiredPayloadRowAttribute of packageExportEvidence.requiredPayloadRowAttributes ?? []) {
  if (!componentSource.includes(requiredPayloadRowAttribute)) {
    fail(`package/export metadata payload row evidence missing ${requiredPayloadRowAttribute}`);
  }
}

for (const requiredPayloadKind of packageExportEvidence.payloadStatusMatrix?.requiredKinds ?? []) {
  if (!componentSource.includes(requiredPayloadKind)) {
    fail(`package/export metadata payload status matrix missing ${requiredPayloadKind}`);
  }
}

for (const expectedReferenceValidationSnippet of [
  "buildReferenceUploadValidationMatrixEvidence",
  "referenceUploadValidationSamples",
  "stage0.rev2.reference-upload-validation-matrix",
  "safe-image-document-https-url-reject-unsupported",
  "accepted-product-angle.webp",
  "launch-brief.pdf",
  "https://assets.example.com/reference-pack",
  "unsafe-reference.exe",
  "http://assets.example.com/reference-pack",
  "data-reference-upload-validation-matrix",
  "data-reference-upload-validation-status",
  "data-reference-upload-validation-accepted-kinds",
  "data-reference-upload-validation-rejected-samples",
  "data-reference-upload-validation-failures"
]) {
  if (!componentSource.includes(expectedReferenceValidationSnippet) && !devStateSource.includes(expectedReferenceValidationSnippet)) {
    fail(`reference upload validation matrix source missing ${expectedReferenceValidationSnippet}`);
  }
}

for (const expectedRenderingSnippet of [
  "buildWorkspaceRenderingPerformanceSmoke",
  "data-rendering-smoke",
  "data-rendering-status",
  "data-render-node-count",
  "data-render-edge-count",
  "data-render-element-count",
  "data-render-estimated-interaction-ms",
  "data-render-failure-count",
  "data-render-max-elements",
  "data-render-max-interaction-ms",
  "data-rendering-smoke-summary",
  "data-rendering-smoke-status",
  "data-rendering-smoke-failures",
  "data-rendering-interaction-steps",
  "data-rendering-estimated-interaction-ms",
  "data-rendering-budget-node-count",
  "data-rendering-budget-edge-count",
  "data-rendering-budget-version-count",
  "data-render-interaction-steps",
  "maxRenderElements",
  "maxInteractionMs",
  "estimatedInteractionMs",
  "interactionSteps",
  "failures"
]) {
  if (!componentSource.includes(expectedRenderingSnippet)) {
    fail(`workspace rendering performance smoke missing ${expectedRenderingSnippet}`);
  }
}

for (const expectedRenderingContract of [
  "workspaceRenderingPerformanceBudget",
  "maxNodes: 24",
  "maxEdges: 24",
  "maxVersions: 32",
  "maxRenderElements: 96",
  "maxInteractionMs: 100",
  "stage0.rev2.workspace-rendering-performance",
  "estimatedInteractionMs",
  "brief-confirm",
  "candidate-select",
  "export-ready",
  "version-restore",
  "failures.push(\"interaction\")"
]) {
  if (!devStateSource.includes(expectedRenderingContract)) {
    fail(`workspace rendering performance budget missing ${expectedRenderingContract}`);
  }
}

for (const expectedWorkflowAcceptanceSnippet of [
  "ecommerceGrowthWorkflowAcceptance",
  "ecommerceGrowthApiSmokeOperationIds",
  "buildEcommerceGrowthApiSmokeEvidence",
  "stage0.rev2.workflow-api-smoke",
  "apiOperationContracts",
  "csrfProtectedOperationCount",
  "idempotencyRequiredOperationCount",
  "brief-reference-four-candidates-select-iterate-package-export-zip",
  "createChatSession",
  "createChatMessage",
  "createCandidateSet",
  "listCandidateAssets",
  "selectDirection",
  "createPackage",
  "createExport",
  "getExport",
  "ecommerce_growth_pack",
  "fx_ecommerce_growth_golden",
  "conversion_offer",
  "social_proof",
  "feature_comparison",
  "retention_bundle",
  "assets/hero_product_ad.png",
  "assets/square_social_ad.png",
  "assets/story_variant.png",
  "assets/marketplace_banner.png",
  "qa-ecommerce-growth-taxonomy",
  "workflow_acceptance"
]) {
  if (!devStateSource.includes(expectedWorkflowAcceptanceSnippet)) {
    fail(`ecommerce growth API smoke contract missing ${expectedWorkflowAcceptanceSnippet}`);
  }
}

console.log("user route smoke passed");
