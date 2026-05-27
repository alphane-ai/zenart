import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactPath = path.join(root, "validation", "package-export-metadata-smoke.json");
const referenceExportBrowserSmokePath = path.join(root, "validation", "reference-export-browser-smoke.json");
const userRoutesPath = path.join(root, "validation", "user-routes-smoke.json");
const ecommerceSmokePath = path.join(root, "validation", "ecommerce-growth-web-smoke.json");
const componentPath = path.join(root, "components", "workspace-app.tsx");
const workspaceSmokeTestPath = path.join(root, "components", "workspace-app.smoke.test.tsx");
const referenceExportPlaywrightSpecPath = path.join(root, "tests", "reference-export.spec.ts");
const packageExportPlaywrightSpecPath = path.join(root, "tests", "package-export-metadata.spec.ts");
const exportDownloadTestPath = path.join(root, "lib", "export-download.test.ts");
const devStatePath = path.join(root, "lib", "dev-state.ts");
const contractsPath = path.join(root, "lib", "contracts.ts");
const downloadPath = path.join(root, "lib", "export-download.ts");

const fail = (message) => {
  console.error(`package/export metadata smoke failed: ${message}`);
  process.exit(1);
};

const [
  artifact,
  referenceExportBrowserSmoke,
  userRoutes,
  ecommerceSmoke,
  componentSource,
  workspaceSmokeTestSource,
  referenceExportPlaywrightSpecSource,
  packageExportPlaywrightSpecSource,
  exportDownloadTestSource,
  devStateSource,
  contractsSource,
  downloadSource
] = await Promise.all([
  readFile(artifactPath, "utf8").then(JSON.parse),
  readFile(referenceExportBrowserSmokePath, "utf8").then(JSON.parse),
  readFile(userRoutesPath, "utf8").then(JSON.parse),
  readFile(ecommerceSmokePath, "utf8").then(JSON.parse),
  readFile(componentPath, "utf8"),
  readFile(workspaceSmokeTestPath, "utf8"),
  readFile(referenceExportPlaywrightSpecPath, "utf8"),
  readFile(packageExportPlaywrightSpecPath, "utf8"),
  readFile(exportDownloadTestPath, "utf8"),
  readFile(devStatePath, "utf8"),
  readFile(contractsPath, "utf8"),
  readFile(downloadPath, "utf8")
]);

if (artifact.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("artifact must cite Docs/stage0_blueprint_rev2.md");
}

if (
  referenceExportBrowserSmoke.blueprintSource !== "Docs/stage0_blueprint_rev2.md" ||
  referenceExportBrowserSmoke.schemaVersion !== "stage0.rev2.reference-export-browser-smoke" ||
  referenceExportBrowserSmoke.status !== "pass" ||
  referenceExportBrowserSmoke.browserEvidence?.script !== "npm run smoke:reference-export-playwright" ||
  referenceExportBrowserSmoke.doesNotCloseChecklistGates !== true
) {
  fail("reference export browser smoke artifact must be a passing non-gate browser contract");
}

if (
  artifact.schemaVersion !== "stage0.rev2.package-export-metadata-static-smoke" ||
  artifact.status !== "pass" ||
  artifact.scope !== "user-web-local-dev-client" ||
  artifact.doesNotCloseChecklistGates !== true ||
  artifact.checklistPolicy?.localAlphaGateRemainsOpen !== true ||
  artifact.checklistPolicy?.productionPolicyGateRemainsOpen !== true
) {
  fail("artifact must be a passing user-web static smoke that keeps runtime gates open");
}

if (
  artifact.browserEvidence?.config !== "web/playwright.config.ts" ||
  artifact.browserEvidence?.test !== "web/tests/package-export-metadata.spec.ts" ||
  artifact.browserEvidence?.script !== "npm run smoke:package-export-metadata-playwright" ||
  artifact.browserEvidence?.scenario !== "package-export-metadata-download-parity-browser" ||
  artifact.browserEvidence?.route !== "/export"
) {
  fail("artifact must pin the package/export metadata browser smoke");
}

for (const assertion of artifact.browserEvidence?.requiredAssertions ?? []) {
  if (!packageExportPlaywrightSpecSource.includes(assertion)) {
    fail(`package/export metadata browser smoke missing assertion ${assertion}`);
  }
}

for (const expectedBrowserSnippet of [
  "JSZip.loadAsync",
  "downloaded ZIP payload",
  "downloaded ZIP must not contain extra top-level contract payloads",
  "data-package-export-metadata-status",
  "data-package-export-zip-payload-parity-status",
  "data-package-export-zip-payload-contract-digest",
  "data-package-export-workflow-metadata-payload-present",
  "data-package-export-workflow-taxonomy-count",
  "data-package-export-workflow-required-file-count",
  "data-export-zip-payload-smoke",
  "data-export-download-parity-payloads-match",
  "data-export-download-parity-payload-contract-digest",
  "data-export-download-parity-payload-digest-match",
  "data-export-download-handoff",
  "data-export-download-payload-contract-digest",
  "download.suggestedFilename()"
]) {
  if (!packageExportPlaywrightSpecSource.includes(expectedBrowserSnippet)) {
    fail(`package/export metadata browser smoke missing ${expectedBrowserSnippet}`);
  }
}

for (const expectedZipToUiParitySnippet of [
  "manifest.workflow_acceptance.strategy_taxonomy.length",
  "manifest.workflow_acceptance.required_files.length",
  "String(qaReport.filter((finding) => finding.severity === \"block\").length)",
  "String(safetyReport.enforcementStages.length)",
  "String(provenance.items.length)",
  "provenance.package_id",
  "aiContentDisclaimer.project_id",
  "workflowMetadata.package_id",
  "traceProvenance.package_id",
  "String(aiContentDisclaimer.schema_version === \"stage0.rev2.ai-content-disclaimer\")",
  "String(pptReadyMetadata.slides.length)",
  "workflowMetadata.prompt_spec.join(\",\")",
  "String(traceProvenance.workflow_id === workflowMetadata.workflow_id)"
]) {
  if (!packageExportPlaywrightSpecSource.includes(expectedZipToUiParitySnippet)) {
    fail(`package/export metadata browser smoke missing ZIP-to-UI parity assertion ${expectedZipToUiParitySnippet}`);
  }
}

for (const payloadName of [
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "provenance.json",
  "ai-content-disclaimer.json",
  "ppt-ready-metadata.json",
  "metadata.json",
  "trace_provenance.json",
  "assets/README.txt"
]) {
  if (!packageExportPlaywrightSpecSource.includes(payloadName)) {
    fail(`package/export metadata browser smoke missing downloaded ZIP payload assertion for ${payloadName}`);
  }
}

const securityEvidenceBySchema = new Map(
  (userRoutes.securityEvidence ?? []).map((entry) => [entry.schemaVersion, entry])
);
const routePackageExportEvidence = securityEvidenceBySchema.get("stage0.rev2.package-export-metadata-ui");
const routeZipPayloadEvidence = securityEvidenceBySchema.get("stage0.rev2.export-zip-payload-smoke");
const routeDownloadParityEvidence = securityEvidenceBySchema.get("stage0.rev2.export-download-parity-smoke");

if (!routePackageExportEvidence || !routeZipPayloadEvidence || !routeDownloadParityEvidence) {
  fail("user route smoke must expose package/export metadata, ZIP payload, and download parity evidence");
}

const evidence = artifact.evidence;
const workflowMetadata = artifact.workflowMetadata;
const zipPayloadSmoke = artifact.zipPayloadSmoke;
const downloadParity = artifact.downloadParity;
const downloadHandoff = artifact.downloadHandoff;

if (
  evidence.schemaVersion !== routePackageExportEvidence.schemaVersion ||
  evidence.route !== routePackageExportEvidence.route ||
  evidence.statusAttribute !== routePackageExportEvidence.statusAttribute ||
  evidence.expectedStatus !== routePackageExportEvidence.expectedStatus ||
  evidence.expectedMissingOutputCount !== routePackageExportEvidence.expectedMissingOutputCount ||
  evidence.expectedDownloadArtifactStatus !== routePackageExportEvidence.expectedDownloadArtifactStatus ||
  evidence.expectedMissingZipPayloadCount !== routePackageExportEvidence.expectedMissingZipPayloadCount ||
  evidence.expectedProvenanceCount !== routePackageExportEvidence.expectedProvenanceCount ||
  evidence.expectedBlockingQaCount !== routePackageExportEvidence.expectedBlockingQaCount ||
  evidence.expectedSafetyStatus !== routePackageExportEvidence.expectedSafetyStatus ||
  evidence.expectedPptAspectRatio !== routePackageExportEvidence.expectedPptAspectRatio ||
  evidence.expectedPptCanvasSize !== routePackageExportEvidence.expectedPptCanvasSize ||
  evidence.expectedPptSafeArea !== routePackageExportEvidence.expectedPptSafeArea ||
  evidence.expectedPptThemeFont !== routePackageExportEvidence.expectedPptThemeFont ||
  evidence.expectedPptHandoffChecklistCount !== routePackageExportEvidence.expectedPptHandoffChecklistCount ||
  evidence.expectedCrossPayloadIdentityStatus !== routePackageExportEvidence.expectedCrossPayloadIdentityStatus ||
  evidence.expectedCrossPayloadIdentityCount !== routePackageExportEvidence.expectedCrossPayloadIdentityCount ||
  evidence.expectedMissingCrossPayloadIdentityCount !== routePackageExportEvidence.expectedMissingCrossPayloadIdentityCount ||
  evidence.payloadAttribute !== routePackageExportEvidence.payloadAttribute ||
  evidence.requiredPayloadAttribute !== routePackageExportEvidence.requiredPayloadAttribute
) {
  fail("package/export metadata artifact drifted from user route smoke evidence");
}

if (
  workflowMetadata.workflowId !== ecommerceSmoke.workflow?.workflowId ||
  workflowMetadata.fixtureId !== ecommerceSmoke.workflow?.fixtureId ||
  workflowMetadata.skill !== ecommerceSmoke.workflow?.workflowId ||
  JSON.stringify(workflowMetadata.promptSpecTaxonomy) !== JSON.stringify(routePackageExportEvidence.expectedWorkflowMetadata?.promptSpecTaxonomy)
) {
  fail("package/export workflow metadata drifted from ecommerce workflow evidence");
}

if (
  workflowMetadata.generatedBy !== routePackageExportEvidence.expectedWorkflowMetadata?.generatedBy ||
  workflowMetadata.provider !== routePackageExportEvidence.expectedWorkflowMetadata?.provider ||
  workflowMetadata.model !== routePackageExportEvidence.expectedWorkflowMetadata?.model ||
  workflowMetadata.skill !== routePackageExportEvidence.expectedWorkflowMetadata?.skill ||
  workflowMetadata.safety !== routePackageExportEvidence.expectedWorkflowMetadata?.safety
) {
  fail("package/export workflow metadata expected values drifted from user route smoke");
}

if (
  zipPayloadSmoke.schemaVersion !== routeZipPayloadEvidence.schemaVersion ||
  zipPayloadSmoke.statusAttribute !== routeZipPayloadEvidence.statusAttribute ||
  zipPayloadSmoke.expectedStatus !== routeZipPayloadEvidence.expectedStatus ||
  zipPayloadSmoke.scenario !== routeZipPayloadEvidence.scenario ||
  zipPayloadSmoke.expectedMissingPayloadCount !== routeZipPayloadEvidence.expectedMissingPayloadCount ||
  zipPayloadSmoke.expectedMetadataPayloadPresent !== routeZipPayloadEvidence.expectedMetadataPayloadPresent ||
  zipPayloadSmoke.expectedTraceProvenancePayloadPresent !== routeZipPayloadEvidence.expectedTraceProvenancePayloadPresent ||
  zipPayloadSmoke.expectedAiContentDisclaimerPayloadPresent !== routeZipPayloadEvidence.expectedAiContentDisclaimerPayloadPresent ||
  zipPayloadSmoke.expectedAssetsPayloadPresent !== routeZipPayloadEvidence.expectedAssetsPayloadPresent ||
  zipPayloadSmoke.expectedPayloadContractDigest !== routeZipPayloadEvidence.expectedPayloadContractDigest ||
  zipPayloadSmoke.sharedPayloadPlanner !== routeZipPayloadEvidence.sharedPayloadPlanner
) {
  fail("ZIP payload smoke artifact drifted from user route smoke evidence");
}

if (
  !Array.isArray(zipPayloadSmoke.expectedPayloadNames) ||
  zipPayloadSmoke.expectedPayloadNames.length !== Number(zipPayloadSmoke.expectedPayloadCount) ||
  JSON.stringify(zipPayloadSmoke.expectedPayloadNames) !== JSON.stringify(evidence.requiredPayloads) ||
  zipPayloadSmoke.expectedPayloadContractDigest !== evidence.expectedZipPayloadContractDigest
) {
  fail("ZIP payload smoke expected payload names must pin the exact package/export metadata payload contract");
}

if (
  downloadParity.schemaVersion !== routeDownloadParityEvidence.schemaVersion ||
  downloadParity.statusAttribute !== routeDownloadParityEvidence.statusAttribute ||
  downloadParity.expectedStatus !== routeDownloadParityEvidence.expectedStatus ||
  downloadParity.scenario !== routeDownloadParityEvidence.scenario ||
  downloadParity.expectedMetadataStatus !== routeDownloadParityEvidence.expectedMetadataStatus ||
  downloadParity.expectedZipPayloadStatus !== routeDownloadParityEvidence.expectedZipPayloadStatus ||
  downloadParity.expectedDownloadHandoffStatus !== routeDownloadParityEvidence.expectedDownloadHandoffStatus ||
  downloadParity.expectedZipMissingCount !== routeDownloadParityEvidence.expectedMissingPayloadCount ||
  downloadParity.expectedPayloadsMatch !== routeDownloadParityEvidence.expectedPayloadsMatch ||
  downloadParity.expectedPayloadListStatus !== routeDownloadParityEvidence.expectedPayloadListStatus ||
  downloadParity.expectedPayloadContractDigest !== routeDownloadParityEvidence.expectedPayloadContractDigest ||
  downloadParity.expectedPayloadDigestMatch !== routeDownloadParityEvidence.expectedPayloadDigestMatch ||
  downloadParity.expectedIdentityStatus !== routeDownloadParityEvidence.expectedIdentityStatus ||
  downloadParity.expectedProvider !== routeDownloadParityEvidence.expectedProvider ||
  downloadParity.expectedModel !== routeDownloadParityEvidence.expectedModel ||
  downloadParity.expectedPromptSpecTaxonomy !== routeDownloadParityEvidence.expectedPromptSpecTaxonomy ||
  downloadParity.expectedSkill !== routeDownloadParityEvidence.expectedSkill ||
  downloadParity.expectedSafetyStatus !== routeDownloadParityEvidence.expectedSafetyStatus ||
  downloadParity.expectedWorkflowMetadataPresent !== routeDownloadParityEvidence.expectedWorkflowMetadataPresent ||
  downloadParity.expectedTraceProvenancePresent !== routeDownloadParityEvidence.expectedTraceProvenancePresent
) {
  fail("download parity artifact drifted from user route smoke evidence");
}

if (
  JSON.stringify(downloadParity.expectedMetadataPayloadNames) !== JSON.stringify(zipPayloadSmoke.expectedPayloadNames) ||
  JSON.stringify(downloadParity.expectedZipPayloadNames) !== JSON.stringify(zipPayloadSmoke.expectedPayloadNames)
) {
  fail("download parity payload-name evidence must match the ZIP payload smoke contract exactly");
}

for (const attribute of evidence.requiredAttributes) {
  if (!componentSource.includes(attribute)) {
    fail(`workspace export UI missing metadata attribute ${attribute}`);
  }
}

for (const attribute of routePackageExportEvidence.requiredIdentityAttributes ?? []) {
  if (!evidence.requiredAttributes.includes(attribute)) {
    fail(`package/export static artifact does not require route identity attribute ${attribute}`);
  }
}

for (const attribute of [
  evidence.payloadStatusMatrix.rowAttribute,
  evidence.payloadStatusMatrix.nameAttribute,
  evidence.payloadStatusMatrix.presentAttribute,
  evidence.payloadStatusMatrix.zipNameAttribute
]) {
  if (!componentSource.includes(attribute)) {
    fail(`package/export payload status matrix missing ${attribute}`);
  }
}

if (
  evidence.crossPayloadIdentityMatrix.groupSelector !== "[aria-label=\"Package export cross-payload identity matrix\"]" ||
  !componentSource.includes("Package export cross-payload identity matrix")
) {
  fail("package/export cross-payload identity matrix missing aria-label selector contract");
}

for (const attribute of [
  evidence.crossPayloadIdentityMatrix.rowAttribute,
  evidence.crossPayloadIdentityMatrix.payloadAttribute,
  evidence.crossPayloadIdentityMatrix.exportIdAttribute,
  evidence.crossPayloadIdentityMatrix.packageIdAttribute,
  evidence.crossPayloadIdentityMatrix.projectIdAttribute,
  evidence.crossPayloadIdentityMatrix.workflowIdAttribute,
  evidence.crossPayloadIdentityMatrix.providerAttribute,
  evidence.crossPayloadIdentityMatrix.modelAttribute,
  evidence.crossPayloadIdentityMatrix.promptSpecAttribute,
  evidence.crossPayloadIdentityMatrix.skillAttribute,
  evidence.crossPayloadIdentityMatrix.safetyAttribute
]) {
  if (!componentSource.includes(attribute) && !workspaceSmokeTestSource.includes(attribute) && !packageExportPlaywrightSpecSource.includes(attribute)) {
    fail(`package/export cross-payload identity matrix missing ${attribute}`);
  }
}

for (const payload of evidence.crossPayloadIdentityMatrix.expectedPayloads ?? []) {
  if (!workspaceSmokeTestSource.includes(payload) || !packageExportPlaywrightSpecSource.includes(payload)) {
    fail(`package/export cross-payload identity matrix missing browser assertion for ${payload}`);
  }
}

for (const payload of evidence.requiredPayloads) {
  if (
    !devStateSource.includes(payload) &&
    !workspaceSmokeTestSource.includes(payload) &&
    !downloadSource.includes(payload) &&
    !JSON.stringify(userRoutes).includes(payload)
  ) {
    fail(`package/export required payload missing source or test evidence ${payload}`);
  }
}

for (const payload of evidence.requiredBaselinePayloads) {
  if (!devStateSource.includes(payload) && !downloadSource.includes(payload)) {
    fail(`baseline ZIP payload missing from builder/download source ${payload}`);
  }
}

for (const requiredSourceSnippet of [
  "export const requiredExportPackageOutputs",
  "export const requiredExportZipPayloadNames",
  "export const isSafeExportZipPayloadName",
  "export const toExportZipPayloadName",
  "export const buildDownloadableExportZipPayloadNames",
  "export const buildExportZipPayloadContractDigest",
  "export const buildExportWorkflowMetadataPayload",
  "export const buildAiContentDisclaimerPayload",
  "export const ecommerceGrowthWorkflowAcceptance",
  "export const buildPackageExportMetadataEvidence",
  "export const buildExportZipPayloadSmokeEvidence",
  "export const buildExportDownloadParityEvidence",
  "metadataPayloadsMatchZipPayloads",
  "payloadListStatus",
  "metadataPayloadNames",
  "zipExpectedPayloadNames",
  "metadataPayloadDigestMatchesZipPayloadDigest",
  "unsafeManifestPayloadNames",
  "unsafeExpectedPayloadNames",
  "identityStatus",
  "provider: metadataEvidence.workflowMetadataProvider",
  "model: metadataEvidence.workflowMetadataModel",
  "promptSpecTaxonomy: metadataEvidence.workflowPromptSpecTaxonomy",
  "skill: metadataEvidence.workflowSkill",
  "safetyStatus: record.safetyReport.status",
  "workflowMetadataPayloadPresent",
  "workflowTraceProvenancePayloadPresent",
  "aiContentDisclaimerPayloadPresent",
  "workflowProviderMetadataPresent",
  "workflowPromptSpecMetadataPresent",
  "workflowSkillMetadataPresent",
  "workflowSafetyMetadataPresent",
  "crossPayloadIdentityStatuses",
  "exportId: hasRuntimeIdentity ? status : \"not-applicable\"",
  "packageId: status",
  "projectId: status"
]) {
  if (!devStateSource.includes(requiredSourceSnippet)) {
    fail(`package/export metadata builder missing source contract ${requiredSourceSnippet}`);
  }
}

for (const requiredContractSnippet of [
  "export interface PackageExportMetadataEvidence",
  "export interface ExportZipPayloadSmokeEvidence",
  "export interface ExportDownloadParityEvidence",
  "schema_version: \"stage0.rev2.package-export-metadata-ui\"",
  "schema_version: \"stage0.rev2.export-zip-payload-smoke\"",
  "schema_version: \"stage0.rev2.export-download-parity-smoke\"",
  "workflowMetadataPayloadPresent",
  "workflowTraceProvenancePayloadPresent",
  "aiContentDisclaimerPayloadPresent",
  "metadataPayloadsMatchZipPayloads",
  "payloadListStatus",
  "metadataPayloadNames",
  "zipExpectedPayloadNames",
  "payloadContractDigest",
  "metadataPayloadDigestMatchesZipPayloadDigest",
  "unsafeManifestPayloadNames",
  "unsafeExpectedPayloadNames",
  "identityStatus",
  "crossPayloadIdentityStatuses"
]) {
  if (!contractsSource.includes(requiredContractSnippet)) {
    fail(`package/export metadata TypeScript contract missing ${requiredContractSnippet}`);
  }
}

for (const requiredDownloadSnippet of [
  "buildExportPackageBlob",
  "manifest.json",
  "qa-report.json",
  "safety-policy-report.json",
  "ai-content-disclaimer.json",
  "ppt-ready-metadata.json",
  "provenance.json",
  "assets/README.txt",
  "buildDownloadableExportZipPayloadNames(record)",
  "assertSafeExportZipPayloadName(requiredPayload)",
  "assertSafeExportZipPayloadName(outputName)",
  "Unsafe export ZIP payload name",
  "buildExportWorkflowMetadataPayload(record, requiredPayload)",
  "downloadExportPackage"
]) {
  if (!downloadSource.includes(requiredDownloadSnippet)) {
    fail(`download planner missing package/export payload contract ${requiredDownloadSnippet}`);
  }
}

if (
  artifact.pathSafetyEvidence?.status !== "pass" ||
  artifact.pathSafetyEvidence?.unsafeSamplesRejected !== "true" ||
  artifact.pathSafetyEvidence?.safeSamplesAccepted !== "true" ||
  artifact.pathSafetyEvidence?.downloadPlannerFailsClosed !== "true" ||
  artifact.pathSafetyEvidence?.expectedFailureReason !== "unsafe-payload-name"
) {
  fail("artifact must declare passing export ZIP path-safety evidence");
}

for (const unsafeSample of artifact.pathSafetyEvidence?.unsafeSamples ?? []) {
  if (!exportDownloadTestSource.includes(unsafeSample)) {
    fail(`path-safety unit smoke missing unsafe sample ${unsafeSample}`);
  }
}

for (const requiredPathSafetySnippet of [
  "rejects unsafe manifest ZIP payload paths before browser download generation",
  "isSafeExportZipPayloadName",
  "buildExportZipPayloadSmokeEvidence",
  "Unsafe export ZIP payload name: ../evil.json",
  "unsafeManifestPayloadNames",
  "unsafeExpectedPayloadNames",
  "unsafe-payload-name",
  "../evil.json",
  "/absolute.json",
  "nested/../evil.json",
  "https://assets.example.com/evil.json",
  "folder/"
]) {
  if (!exportDownloadTestSource.includes(requiredPathSafetySnippet)) {
    fail(`export download unit smoke missing export ZIP path-safety assertion ${requiredPathSafetySnippet}`);
  }
}

for (const requiredTestSnippet of [
  "data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui'",
  "data-package-export-metadata-status",
  "data-package-export-manifest-item-count",
  "data-package-export-manifest-required-output-count",
  "data-package-export-download-artifact-status",
  "data-package-export-item-types",
  "data-package-export-workflow-id",
  "data-package-export-workflow-fixture-id",
  "data-package-export-workflow-metadata-payload-present",
  "data-package-export-ai-content-disclaimer-payload-present",
  "data-package-export-zip-payload-contract-digest",
  "data-package-export-payload-row",
  "data-package-export-identity-row",
  "data-export-zip-payload-smoke-status",
  "data-export-zip-payload-contract-digest",
  "data-export-download-parity-status",
  "data-export-download-parity-payload-list-status",
  "data-export-download-parity-payload-digest-match",
  "data-export-download-parity-identity-status",
  "data-export-download-handoff-status"
]) {
  if (!workspaceSmokeTestSource.includes(requiredTestSnippet)) {
    fail(`workspace smoke test missing package/export assertion ${requiredTestSnippet}`);
  }
}

const expectedDataAttributeValues = new Map([
  ["data-package-export-metadata-ui", evidence.schemaVersion],
  ["data-package-export-metadata-status", evidence.expectedStatus],
  ["data-package-export-id", evidence.expectedExportId],
  ["data-package-export-package-id", evidence.expectedPackageId],
  ["data-package-export-project-id", evidence.expectedProjectId],
  ["data-package-export-manifest-item-count", evidence.expectedManifestItemCount],
  ["data-package-export-manifest-required-output-count", evidence.expectedManifestRequiredOutputCount],
  ["data-package-export-download-artifact-status", evidence.expectedDownloadArtifactStatus],
  ["data-package-export-download-artifact-format", evidence.expectedDownloadArtifactFormat],
  ["data-package-export-missing-output-count", evidence.expectedMissingOutputCount],
  ["data-package-export-missing-zip-payload-count", evidence.expectedMissingZipPayloadCount],
  ["data-package-export-provenance-count", evidence.expectedProvenanceCount],
  ["data-package-export-blocking-qa-count", evidence.expectedBlockingQaCount],
  ["data-package-export-safety-status", evidence.expectedSafetyStatus],
  ["data-package-export-safety-stage-count", evidence.expectedSafetyStageCount],
  ["data-package-export-safety-finding-count", evidence.expectedSafetyFindingCount],
  ["data-package-export-ppt-aspect-ratio", evidence.expectedPptAspectRatio],
  ["data-package-export-ppt-slide-count", evidence.expectedPptSlideCount],
  ["data-package-export-ppt-canvas-size", evidence.expectedPptCanvasSize],
  ["data-package-export-ppt-safe-area", evidence.expectedPptSafeArea],
  ["data-package-export-ppt-theme-font", evidence.expectedPptThemeFont],
  ["data-package-export-ppt-handoff-checklist-count", evidence.expectedPptHandoffChecklistCount],
  ["data-package-export-required-zip-payload-count", evidence.expectedRequiredZipPayloadCount],
  ["data-package-export-zip-payload-contract-digest", evidence.expectedZipPayloadContractDigest],
  ["data-package-export-zip-payload-parity-status", evidence.expectedZipPayloadParityStatus],
  ["data-package-export-zip-payload-parity-ratio", evidence.expectedZipPayloadParityRatio],
  ["data-package-export-cross-payload-identity-status", evidence.expectedCrossPayloadIdentityStatus],
  ["data-package-export-cross-payload-identity-count", evidence.expectedCrossPayloadIdentityCount],
  ["data-package-export-missing-cross-payload-identity-count", evidence.expectedMissingCrossPayloadIdentityCount],
  ["data-package-export-workflow-id", workflowMetadata.workflowId],
  ["data-package-export-workflow-fixture-id", workflowMetadata.fixtureId],
  ["data-package-export-workflow-taxonomy-count", workflowMetadata.expectedWorkflowTaxonomyCount],
  ["data-package-export-workflow-required-file-count", workflowMetadata.expectedWorkflowRequiredFileCount],
  ["data-package-export-workflow-metadata-payload-present", workflowMetadata.expectedWorkflowMetadataPayloadPresent],
  ["data-package-export-workflow-trace-provenance-payload-present", workflowMetadata.expectedWorkflowTraceProvenancePayloadPresent],
  ["data-package-export-ai-content-disclaimer-payload-present", workflowMetadata.expectedAiContentDisclaimerPayloadPresent],
  ["data-package-export-workflow-provider-metadata-present", workflowMetadata.expectedWorkflowProviderMetadataPresent],
  ["data-package-export-workflow-prompt-spec-metadata-present", workflowMetadata.expectedWorkflowPromptSpecMetadataPresent],
  ["data-package-export-workflow-skill-metadata-present", workflowMetadata.expectedWorkflowSkillMetadataPresent],
  ["data-package-export-workflow-safety-metadata-present", workflowMetadata.expectedWorkflowSafetyMetadataPresent],
  ["data-package-export-workflow-metadata-generated-by", workflowMetadata.generatedBy],
  ["data-package-export-workflow-metadata-provider", workflowMetadata.provider],
  ["data-package-export-workflow-metadata-model", workflowMetadata.model],
  ["data-package-export-workflow-prompt-spec-taxonomy", workflowMetadata.promptSpecTaxonomy.join(",")],
  ["data-package-export-workflow-skill", workflowMetadata.skill],
  ["data-package-export-workflow-safety", workflowMetadata.safety],
  ["data-export-zip-payload-smoke", zipPayloadSmoke.schemaVersion],
  ["data-export-zip-payload-smoke-status", zipPayloadSmoke.expectedStatus],
  ["data-export-zip-payload-smoke-scenario", zipPayloadSmoke.scenario],
  ["data-export-zip-payload-export-id", zipPayloadSmoke.expectedExportId],
  ["data-export-zip-payload-package-id", zipPayloadSmoke.expectedPackageId],
  ["data-export-zip-payload-manifest-required-output-count", zipPayloadSmoke.expectedManifestRequiredOutputCount],
  ["data-export-zip-payload-expected-count", zipPayloadSmoke.expectedPayloadCount],
  ["data-export-zip-payload-missing-count", zipPayloadSmoke.expectedMissingPayloadCount],
  ["data-export-zip-payload-expected-payloads", zipPayloadSmoke.expectedPayloadNames.join(",")],
  ["data-export-zip-payload-contract-digest", zipPayloadSmoke.expectedPayloadContractDigest],
  ["data-export-zip-payload-metadata-present", zipPayloadSmoke.expectedMetadataPayloadPresent],
  ["data-export-zip-payload-trace-provenance-present", zipPayloadSmoke.expectedTraceProvenancePayloadPresent],
  ["data-export-zip-payload-ai-content-disclaimer-present", zipPayloadSmoke.expectedAiContentDisclaimerPayloadPresent],
  ["data-export-zip-payload-assets-present", zipPayloadSmoke.expectedAssetsPayloadPresent],
  ["data-export-download-parity-smoke", downloadParity.schemaVersion],
  ["data-export-download-parity-status", downloadParity.expectedStatus],
  ["data-export-download-parity-scenario", downloadParity.scenario],
  ["data-export-download-parity-file-name", downloadParity.expectedFileName],
  ["data-export-download-parity-format", downloadParity.expectedFormat],
  ["data-export-download-parity-metadata-status", downloadParity.expectedMetadataStatus],
  ["data-export-download-parity-zip-payload-status", downloadParity.expectedZipPayloadStatus],
  ["data-export-download-parity-handoff-status", downloadParity.expectedDownloadHandoffStatus],
  ["data-export-download-parity-metadata-payload-count", downloadParity.expectedMetadataPayloadCount],
  ["data-export-download-parity-zip-expected-count", downloadParity.expectedZipPayloadCount],
  ["data-export-download-parity-metadata-missing-count", downloadParity.expectedMetadataMissingCount],
  ["data-export-download-parity-zip-missing-count", downloadParity.expectedZipMissingCount],
  ["data-export-download-parity-required-zip-status", downloadParity.expectedRequiredZipStatus],
  ["data-export-download-parity-payloads-match", downloadParity.expectedPayloadsMatch],
  ["data-export-download-parity-payload-list-status", downloadParity.expectedPayloadListStatus],
  ["data-export-download-parity-metadata-payloads", downloadParity.expectedMetadataPayloadNames.join(",")],
  ["data-export-download-parity-zip-expected-payloads", downloadParity.expectedZipPayloadNames.join(",")],
  ["data-export-download-parity-payload-contract-digest", downloadParity.expectedPayloadContractDigest],
  ["data-export-download-parity-payload-digest-match", downloadParity.expectedPayloadDigestMatch],
  ["data-export-download-parity-identity-status", downloadParity.expectedIdentityStatus],
  ["data-export-download-parity-provider", downloadParity.expectedProvider],
  ["data-export-download-parity-model", downloadParity.expectedModel],
  ["data-export-download-parity-prompt-spec-taxonomy", downloadParity.expectedPromptSpecTaxonomy],
  ["data-export-download-parity-skill", downloadParity.expectedSkill],
  ["data-export-download-parity-safety-status", downloadParity.expectedSafetyStatus],
  ["data-export-download-parity-workflow-metadata-present", downloadParity.expectedWorkflowMetadataPresent],
  ["data-export-download-parity-trace-provenance-present", downloadParity.expectedTraceProvenancePresent],
  ["data-export-download-handoff", downloadHandoff.schemaVersion],
  ["data-export-download-handoff-status", downloadHandoff.expectedStatus],
  ["data-export-download-file-name", downloadHandoff.expectedFileName],
  ["data-export-download-format", downloadHandoff.expectedFormat],
  ["data-export-download-payload-contract-digest", downloadHandoff.expectedPayloadContractDigest]
]);

for (const [attribute, expectedValue] of expectedDataAttributeValues) {
  const stringLiteral = `"${expectedValue}"`;
  if (!workspaceSmokeTestSource.includes(attribute) || !workspaceSmokeTestSource.includes(stringLiteral)) {
    fail(`workspace smoke test missing expected ${attribute}=${expectedValue}`);
  }
}

if (!workspaceSmokeTestSource.includes("Number(metadataEvidence?.getAttribute(\"data-package-export-zip-payload-count\"))")) {
  fail("workspace smoke test must assert package/export ZIP payload count numerically");
}

for (const payload of evidence.crossPayloadIdentityPayloads ?? []) {
  if (!packageExportPlaywrightSpecSource.includes(payload) || !workspaceSmokeTestSource.includes(payload)) {
    fail(`package/export identity evidence missing cross-payload assertion for ${payload}`);
  }
}

if (!workspaceSmokeTestSource.includes("Package export cross-payload identity matrix")) {
  fail("workspace smoke test must inspect the package export cross-payload identity matrix");
}

if (!packageExportPlaywrightSpecSource.includes("Package export cross-payload identity matrix")) {
  fail("browser smoke test must inspect the package export cross-payload identity matrix");
}

if (!workspaceSmokeTestSource.includes("Package export payload status matrix")) {
  fail("workspace smoke test must inspect the package export payload status matrix");
}

if (!componentSource.includes("function PayloadStatusList") || !componentSource.includes("payload-status-list")) {
  fail("workspace export UI must render payload status rows");
}

if (!componentSource.includes("function PayloadIdentityStatusList") || !componentSource.includes("payload-identity-status-list")) {
  fail("workspace export UI must render cross-payload identity rows");
}

if (!componentSource.includes("downloadExportPackage(item)")) {
  fail("workspace export UI must wire download handoff to the export download planner");
}

const browserContracts = referenceExportBrowserSmoke.expectedContracts ?? {};
if (
  browserContracts.packageExportMetadata?.schemaVersion !== evidence.schemaVersion ||
  browserContracts.packageExportMetadata?.expectedStatus !== evidence.expectedStatus ||
  browserContracts.packageExportMetadata?.expectedMissingOutputCount !== evidence.expectedMissingOutputCount ||
  browserContracts.packageExportMetadata?.expectedZipPayloadParityStatus !== evidence.expectedZipPayloadParityStatus ||
  browserContracts.packageExportMetadata?.expectedZipPayloadContractDigest !== evidence.expectedZipPayloadContractDigest ||
  browserContracts.packageExportMetadata?.expectedCrossPayloadIdentityPayloadCount !==
    evidence.crossPayloadIdentityMatrix.expectedPayloadCount ||
  browserContracts.packageExportMetadata?.expectedCrossPayloadIdentityPresentStatus !==
    evidence.crossPayloadIdentityMatrix.expectedPresentStatus ||
  browserContracts.downloadParity?.schemaVersion !== downloadParity.schemaVersion ||
  browserContracts.downloadParity?.expectedStatus !== downloadParity.expectedStatus ||
  browserContracts.downloadParity?.expectedPayloadsMatch !== downloadParity.expectedPayloadsMatch ||
  browserContracts.downloadParity?.expectedPayloadDigestMatch !== downloadParity.expectedPayloadDigestMatch ||
  browserContracts.downloadParity?.expectedPayloadListStatus !== downloadParity.expectedPayloadListStatus ||
  browserContracts.downloadParity?.expectedIdentityStatus !== downloadParity.expectedIdentityStatus ||
  browserContracts.downloadParity?.expectedProvider !== downloadParity.expectedProvider ||
  browserContracts.downloadParity?.expectedModel !== downloadParity.expectedModel ||
  browserContracts.downloadParity?.expectedPromptSpecTaxonomy !== downloadParity.expectedPromptSpecTaxonomy ||
  browserContracts.downloadParity?.expectedSkill !== downloadParity.expectedSkill ||
  browserContracts.downloadParity?.expectedSafetyStatus !== downloadParity.expectedSafetyStatus
) {
  fail("reference export browser smoke artifact drifted from package/export metadata evidence");
}

if (
  browserContracts.referenceUpload?.expectedUploadMethod !== "POST" ||
  browserContracts.referenceUpload?.expectedUploadPath !== "/uploads" ||
  browserContracts.referenceUpload?.expectedUploadCsrfHeader !== "X-ZenArt-CSRF" ||
  browserContracts.referenceUpload?.expectedUploadIdempotencyRequired !== "true" ||
  browserContracts.referenceUpload?.expectedPreviewScope !== "tenant-scoped-dev-preview" ||
  browserContracts.referenceUpload?.expectedRejectedReferencePackagedCount !== "0" ||
  browserContracts.referenceUpload?.expectedRejectedReferenceExportedCount !== "0"
) {
  fail("reference export browser smoke artifact must include upload request metadata and rejected-reference exclusion evidence");
}

for (const snippet of referenceExportBrowserSmoke.browserEvidence?.requiredAssertions ?? []) {
  if (!referenceExportPlaywrightSpecSource.includes(snippet)) {
    fail(`reference export browser smoke spec missing ${snippet}`);
  }
}
