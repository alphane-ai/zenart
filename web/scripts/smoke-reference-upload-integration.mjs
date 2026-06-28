import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactPath = path.join(root, "validation", "reference-upload-integration-smoke.json");
const browserArtifactPath = path.join(root, "validation", "reference-export-browser-smoke.json");
const packageExportArtifactPath = path.join(root, "validation", "package-export-metadata-smoke.json");
const userRoutesPath = path.join(root, "validation", "user-routes-smoke.json");
const componentPath = path.join(root, "components", "workspace-app.tsx");
const workspaceSmokeTestPath = path.join(root, "components", "workspace-app.smoke.test.tsx");
const browserSpecPath = path.join(root, "tests", "reference-export.spec.ts");
const devStatePath = path.join(root, "lib", "dev-state.ts");
const contractsPath = path.join(root, "lib", "contracts.ts");
const exportDownloadTestPath = path.join(root, "lib", "export-download.test.ts");

const fail = (message) => {
  console.error(`reference upload integration smoke failed: ${message}`);
  process.exit(1);
};

const [
  artifact,
  browserArtifact,
  packageExportArtifact,
  userRoutes,
  componentSource,
  workspaceSmokeTestSource,
  browserSpecSource,
  devStateSource,
  contractsSource,
  exportDownloadTestSource
] = await Promise.all([
  readFile(artifactPath, "utf8").then(JSON.parse),
  readFile(browserArtifactPath, "utf8").then(JSON.parse),
  readFile(packageExportArtifactPath, "utf8").then(JSON.parse),
  readFile(userRoutesPath, "utf8").then(JSON.parse),
  readFile(componentPath, "utf8"),
  readFile(workspaceSmokeTestPath, "utf8"),
  readFile(browserSpecPath, "utf8"),
  readFile(devStatePath, "utf8"),
  readFile(contractsPath, "utf8"),
  readFile(exportDownloadTestPath, "utf8")
]);

if (
  artifact.schemaVersion !== "stage0.rev2.reference-upload-integration-static-smoke" ||
  artifact.blueprintSource !== "Docs/stage0_blueprint_rev2.md" ||
  artifact.status !== "pass" ||
  artifact.scope !== "user-web-local-dev-client" ||
  artifact.doesNotCloseChecklistGates !== true ||
  artifact.checklistPolicy?.localAlphaGateRemainsOpen !== true
) {
  fail("artifact must be a passing Rev2 user-web static smoke that keeps runtime gates open");
}

if (
  browserArtifact.schemaVersion !== "stage0.rev2.reference-export-browser-smoke" ||
  browserArtifact.status !== "pass" ||
  browserArtifact.doesNotCloseChecklistGates !== true ||
  browserArtifact.browserEvidence?.script !== "npm run smoke:reference-export-playwright"
) {
  fail("reference export browser smoke artifact must be passing non-gate evidence");
}

const securityEvidenceBySchema = new Map(
  (userRoutes.securityEvidence ?? []).map((entry) => [entry.schemaVersion, entry])
);
const routeReferenceUpload = securityEvidenceBySchema.get("stage0.rev2.reference-upload-integration-smoke");
const routeWorkspaceRendering = securityEvidenceBySchema.get("stage0.rev2.workspace-rendering-performance");
const routePackageExport = securityEvidenceBySchema.get("stage0.rev2.package-export-metadata-ui");
const routeDownloadParity = securityEvidenceBySchema.get("stage0.rev2.export-download-parity-smoke");

if (!routeReferenceUpload || !routeWorkspaceRendering || !routePackageExport || !routeDownloadParity) {
  fail("user route smoke must expose reference upload, workspace rendering, package/export, and download parity evidence");
}

const referenceUpload = artifact.referenceUpload;
if (
  referenceUpload.schemaVersion !== routeReferenceUpload.schemaVersion ||
  referenceUpload.route !== routeReferenceUpload.route ||
  referenceUpload.source !== routeReferenceUpload.source ||
  referenceUpload.statusAttribute !== routeReferenceUpload.statusAttribute ||
  referenceUpload.expectedStatus !== routeReferenceUpload.expectedStatus ||
  referenceUpload.scenario !== routeReferenceUpload.scenario ||
  referenceUpload.expectedOperationCount !== routeReferenceUpload.expectedOperationCount ||
  JSON.stringify(referenceUpload.expectedOperations) !== JSON.stringify(routeReferenceUpload.expectedOperations) ||
  referenceUpload.expectedUploadMethod !== routeReferenceUpload.expectedUploadMethod ||
  referenceUpload.expectedUploadPath !== routeReferenceUpload.expectedUploadPath ||
  referenceUpload.expectedUploadCsrfHeader !== routeReferenceUpload.expectedUploadCsrfHeader ||
  referenceUpload.expectedUploadIdempotencyRequired !== routeReferenceUpload.expectedUploadIdempotencyRequired ||
  referenceUpload.expectedPreviewScope !== routeReferenceUpload.expectedPreviewScope ||
  referenceUpload.expectedLatestReferenceId !== routeReferenceUpload.expectedLatestAcceptedId ||
  referenceUpload.expectedLatestReferenceName !== routeReferenceUpload.expectedLatestAcceptedName ||
  referenceUpload.expectedLatestReferenceKind !== routeReferenceUpload.expectedLatestAcceptedKind ||
  referenceUpload.expectedLatestPackageItemId !== routeReferenceUpload.expectedLatestPackageItemId ||
  referenceUpload.expectedLatestExportTitle !== routeReferenceUpload.expectedLatestExportTitle ||
  referenceUpload.expectedLatestPptSlideSourceItemId !== routeReferenceUpload.expectedLatestPptSlideSourceItemId ||
  referenceUpload.expectedLatestIdentityStatus !== routeReferenceUpload.expectedLatestIdentityStatus ||
  referenceUpload.expectedLatestPackaged !== routeReferenceUpload.expectedLatestPackaged ||
  referenceUpload.expectedLatestProvenancePresent !== routeReferenceUpload.expectedLatestProvenancePresent ||
  referenceUpload.expectedLatestPptSlidePresent !== routeReferenceUpload.expectedLatestPptSlidePresent ||
  referenceUpload.expectedReadyExportCount !== routeReferenceUpload.expectedReadyExportCount ||
  referenceUpload.expectedRejectedReferencePackagedCount !== routeReferenceUpload.expectedRejectedReferencePackagedCount ||
  referenceUpload.expectedRejectedReferenceExportedCount !== routeReferenceUpload.expectedRejectedReferenceExportedCount
) {
  fail("reference upload artifact drifted from user route smoke evidence");
}

const browserReferenceUpload = browserArtifact.expectedContracts?.referenceUpload;
const browserReferenceUploadValidation = browserArtifact.expectedContracts?.referenceUploadValidation;
if (
  browserReferenceUpload?.schemaVersion !== referenceUpload.schemaVersion ||
  browserReferenceUpload?.expectedStatus !== referenceUpload.expectedStatus ||
  JSON.stringify(browserReferenceUpload?.expectedOperations) !== JSON.stringify(referenceUpload.expectedOperations) ||
  browserReferenceUpload?.expectedUploadMethod !== referenceUpload.expectedUploadMethod ||
  browserReferenceUpload?.expectedUploadPath !== referenceUpload.expectedUploadPath ||
  browserReferenceUpload?.expectedUploadCsrfHeader !== referenceUpload.expectedUploadCsrfHeader ||
  browserReferenceUpload?.expectedUploadIdempotencyRequired !== referenceUpload.expectedUploadIdempotencyRequired ||
  browserReferenceUpload?.expectedPreviewScope !== referenceUpload.expectedPreviewScope ||
  browserReferenceUpload?.expectedLatestReferenceId !== referenceUpload.expectedLatestReferenceId ||
  browserReferenceUpload?.expectedLatestReferenceName !== referenceUpload.expectedLatestReferenceName ||
  browserReferenceUpload?.expectedLatestReferenceKind !== referenceUpload.expectedLatestReferenceKind ||
  browserReferenceUpload?.expectedLatestPackageItemId !== referenceUpload.expectedLatestPackageItemId ||
  browserReferenceUpload?.expectedLatestExportTitle !== referenceUpload.expectedLatestExportTitle ||
  browserReferenceUpload?.expectedLatestPptSlideSourceItemId !== referenceUpload.expectedLatestPptSlideSourceItemId ||
  browserReferenceUpload?.expectedLatestIdentityStatus !== referenceUpload.expectedLatestIdentityStatus ||
  browserReferenceUpload?.expectedLatestPackaged !== referenceUpload.expectedLatestPackaged ||
  browserReferenceUpload?.expectedLatestProvenancePresent !== referenceUpload.expectedLatestProvenancePresent ||
  browserReferenceUpload?.expectedLatestPptSlidePresent !== referenceUpload.expectedLatestPptSlidePresent ||
  browserReferenceUpload?.expectedRejectedReferencePackagedCount !== referenceUpload.expectedRejectedReferencePackagedCount ||
  browserReferenceUpload?.expectedRejectedReferenceExportedCount !== referenceUpload.expectedRejectedReferenceExportedCount
) {
  fail("reference upload artifact drifted from browser smoke artifact");
}

const referenceUploadValidation = artifact.referenceUploadValidation;
const routeReferenceUploadValidation = securityEvidenceBySchema.get("stage0.rev2.reference-upload-validation-matrix");
if (!routeReferenceUploadValidation) {
  fail("user route smoke must expose reference upload validation matrix evidence");
}
if (
  referenceUploadValidation?.schemaVersion !== routeReferenceUploadValidation.schemaVersion ||
  referenceUploadValidation?.route !== routeReferenceUploadValidation.route ||
  referenceUploadValidation?.statusAttribute !== routeReferenceUploadValidation.statusAttribute ||
  referenceUploadValidation?.expectedStatus !== routeReferenceUploadValidation.expectedStatus ||
  referenceUploadValidation?.scenario !== routeReferenceUploadValidation.scenario ||
  JSON.stringify(referenceUploadValidation?.expectedAcceptedKinds) !==
    JSON.stringify(routeReferenceUploadValidation.expectedAcceptedKinds) ||
  referenceUploadValidation?.expectedAcceptedAttachedCount !== routeReferenceUploadValidation.expectedAcceptedAttachedCount ||
  referenceUploadValidation?.expectedRejectedCount !== routeReferenceUploadValidation.expectedRejectedCount ||
  referenceUploadValidation?.expectedRejectedQueuedCount !== routeReferenceUploadValidation.expectedRejectedQueuedCount ||
  referenceUploadValidation?.expectedRejectedPackageActionCount !== routeReferenceUploadValidation.expectedRejectedPackageActionCount ||
  JSON.stringify(referenceUploadValidation?.expectedRejectedReasons) !==
    JSON.stringify(routeReferenceUploadValidation.expectedRejectedReasons)
) {
  fail("reference upload validation artifact drifted from user route smoke evidence");
}
if (
  browserReferenceUploadValidation?.schemaVersion !== referenceUploadValidation.schemaVersion ||
  browserReferenceUploadValidation?.expectedStatus !== referenceUploadValidation.expectedStatus ||
  browserReferenceUploadValidation?.expectedAcceptedAttachedCount !== referenceUploadValidation.expectedAcceptedAttachedCount ||
  browserReferenceUploadValidation?.expectedRejectedQueuedCount !== referenceUploadValidation.expectedRejectedQueuedCount ||
  browserReferenceUploadValidation?.expectedRejectedPackageActionCount !==
    referenceUploadValidation.expectedRejectedPackageActionCount ||
  JSON.stringify(browserReferenceUploadValidation?.expectedRejectedReasons) !==
    JSON.stringify(referenceUploadValidation.expectedRejectedReasons)
) {
  fail("reference upload validation artifact drifted from browser smoke artifact");
}

const referenceExportContract = artifact.referenceExportContract;
if (
  referenceExportContract?.route !== "/export" ||
  referenceExportContract?.source !== "web/components/workspace-app.tsx" ||
  referenceExportContract?.unitSmoke !== "web/components/workspace-app.smoke.test.tsx" ||
  referenceExportContract?.browserSmoke !== "web/tests/reference-export.spec.ts" ||
  referenceExportContract?.zipDownloadSmoke !== "web/lib/export-download.test.ts" ||
  referenceExportContract?.ariaLabel !== "Reference upload to ready ZIP export contract" ||
  referenceExportContract?.contractAttribute !== "data-reference-upload-export-contract" ||
  referenceExportContract?.expectedContract !== "reference-upload-to-ready-zip-export" ||
  referenceExportContract?.statusAttribute !== "data-reference-export-contract-status" ||
  referenceExportContract?.expectedStatus !== "pass" ||
  referenceExportContract?.scenarioAttribute !== "data-reference-export-contract-scenario" ||
  referenceExportContract?.expectedScenario !== "reference-upload-to-ready-zip-export" ||
  referenceExportContract?.provenanceCountAttribute !== "data-reference-provenance-count" ||
  referenceExportContract?.expectedProvenanceCount !== "1" ||
  referenceExportContract?.provenancePrefixAttribute !== "data-reference-export-provenance-prefix" ||
  referenceExportContract?.expectedProvenancePrefix !== "dev-client-reference:" ||
  referenceExportContract?.provenancesAttribute !== "data-reference-export-provenances" ||
  referenceExportContract?.expectedProvenance !== `dev-client-reference:${referenceUpload.expectedLatestReferenceId}` ||
  referenceExportContract?.referenceTitleAttribute !== "data-reference-export-item-title" ||
  referenceExportContract?.expectedReferenceTitle !== referenceUpload.expectedLatestReferenceName ||
  referenceExportContract?.pptSlideCountAttribute !== "data-reference-export-ppt-slide-count" ||
  referenceExportContract?.expectedPptSlideCount !== "1" ||
  referenceExportContract?.pptSlideSourceItemIdsAttribute !== "data-reference-export-ppt-slide-source-item-ids" ||
  referenceExportContract?.expectedPptSlideSourceItemIds !== "pkg-item-001" ||
  referenceExportContract?.failuresAttribute !== "data-reference-export-failures" ||
  referenceExportContract?.expectedFailures !== referenceUpload.expectedFailures
) {
  fail("reference export contract must explicitly mirror ready reference provenance and PPT evidence");
}
for (const attribute of [
  referenceExportContract.contractAttribute,
  referenceExportContract.statusAttribute,
  referenceExportContract.scenarioAttribute,
  referenceExportContract.provenanceCountAttribute,
  referenceExportContract.provenancePrefixAttribute,
  referenceExportContract.provenancesAttribute,
  referenceExportContract.pptSlideCountAttribute,
  referenceExportContract.pptSlideSourceItemIdsAttribute,
  referenceExportContract.failuresAttribute,
  ...(referenceExportContract.requiredItemAttributes ?? [])
]) {
  if (!componentSource.includes(attribute)) {
    fail(`workspace UI missing reference export contract attribute ${attribute}`);
  }
  if (!workspaceSmokeTestSource.includes(attribute) && !browserSpecSource.includes(attribute)) {
    fail(`reference export contract tests missing assertion for ${attribute}`);
  }
}
for (const expectedSnippet of [
  referenceExportContract.expectedContract,
  referenceExportContract.expectedScenario,
  referenceExportContract.expectedStatus,
  referenceExportContract.expectedProvenancePrefix,
  referenceExportContract.expectedProvenance,
  referenceExportContract.expectedReferenceTitle,
  referenceExportContract.expectedPptSlideSourceItemIds
]) {
  if (!workspaceSmokeTestSource.includes(expectedSnippet) || !browserSpecSource.includes(expectedSnippet)) {
    fail(`reference export contract tests missing expected value ${expectedSnippet}`);
  }
}
for (const zipAssertion of [
  referenceExportContract.expectedProvenance,
  "pptReadyMetadata.slides",
  referenceExportContract.expectedPptSlideSourceItemIds
]) {
  if (!browserSpecSource.includes(zipAssertion)) {
    fail(`reference export browser smoke missing ZIP parity assertion ${zipAssertion}`);
  }
}
for (const attribute of referenceUploadValidation.requiredAttributes ?? []) {
  if (!componentSource.includes(attribute) && !workspaceSmokeTestSource.includes(attribute) && !browserSpecSource.includes(attribute)) {
    fail(`reference upload validation evidence missing attribute ${attribute}`);
  }
}
for (const rejectedSample of referenceUploadValidation.requiredRejectedSamples ?? []) {
  if (!devStateSource.includes(rejectedSample) && !workspaceSmokeTestSource.includes(rejectedSample) && !browserSpecSource.includes(rejectedSample)) {
    fail(`reference upload validation evidence missing rejected sample ${rejectedSample}`);
  }
}
for (const rejectedReason of referenceUploadValidation.expectedRejectedReasons ?? []) {
  if (!devStateSource.includes(rejectedReason) || !workspaceSmokeTestSource.includes(rejectedReason) || !browserSpecSource.includes(rejectedReason)) {
    fail(`reference upload validation evidence missing rejected reason ${rejectedReason}`);
  }
}

const workspaceRendering = artifact.workspaceRendering;
if (
  workspaceRendering.schemaVersion !== routeWorkspaceRendering.schemaVersion ||
  workspaceRendering.route !== routeWorkspaceRendering.route ||
  workspaceRendering.statusAttribute !== routeWorkspaceRendering.statusAttribute ||
  workspaceRendering.expectedStatus !== routeWorkspaceRendering.expectedStatus ||
  workspaceRendering.expectedFailureCount !== routeWorkspaceRendering.expectedFailureCount
) {
  fail("workspace rendering contract drifted from user route smoke evidence");
}

const browserRendering = browserArtifact.expectedContracts?.workspaceRendering;
if (
  browserRendering?.schemaVersion !== workspaceRendering.schemaVersion ||
  browserRendering?.expectedStatus !== workspaceRendering.expectedStatus ||
  browserRendering?.expectedFailureCount !== workspaceRendering.expectedFailureCount ||
  !workspaceRendering.requiredInteractionSteps.every((step) => browserRendering.requiredInteractionSteps?.includes(step))
) {
  fail("workspace rendering contract drifted from browser smoke artifact");
}

if (
  artifact.packageExportMetadata.schemaVersion !== packageExportArtifact.evidence.schemaVersion ||
  artifact.packageExportMetadata.expectedStatus !== packageExportArtifact.evidence.expectedStatus ||
  artifact.packageExportMetadata.expectedMissingOutputCount !== packageExportArtifact.evidence.expectedMissingOutputCount ||
  artifact.packageExportMetadata.expectedZipPayloadParityStatus !== packageExportArtifact.evidence.expectedZipPayloadParityStatus ||
  artifact.packageExportMetadata.expectedWorkflowMetadataPayloadPresent !==
    packageExportArtifact.workflowMetadata.expectedWorkflowMetadataPayloadPresent ||
  artifact.packageExportMetadata.expectedTraceProvenancePayloadPresent !==
    packageExportArtifact.workflowMetadata.expectedWorkflowTraceProvenancePayloadPresent ||
  artifact.packageExportMetadata.expectedAiContentDisclaimerPayloadPresent !==
    packageExportArtifact.workflowMetadata.expectedAiContentDisclaimerPayloadPresent ||
  artifact.packageExportMetadata.expectedCrossPayloadIdentityPayloadCount !==
    packageExportArtifact.evidence.crossPayloadIdentityMatrix.expectedPayloadCount ||
  artifact.packageExportMetadata.expectedCrossPayloadIdentityPresentStatus !==
    packageExportArtifact.evidence.crossPayloadIdentityMatrix.expectedPresentStatus
) {
  fail("package/export metadata contract drifted from package export smoke artifact");
}

if (
  artifact.downloadParity.schemaVersion !== packageExportArtifact.downloadParity.schemaVersion ||
  artifact.downloadParity.expectedStatus !== packageExportArtifact.downloadParity.expectedStatus ||
  artifact.downloadParity.expectedPayloadsMatch !== packageExportArtifact.downloadParity.expectedPayloadsMatch
) {
  fail("download parity contract drifted from package export smoke artifact");
}

for (const attribute of [...referenceUpload.requiredAttributes, ...referenceUpload.requiredItemAttributes]) {
  if (!componentSource.includes(attribute)) {
    fail(`workspace UI missing reference upload attribute ${attribute}`);
  }
}

for (const attribute of workspaceRendering.requiredAttributes) {
  if (!componentSource.includes(attribute)) {
    fail(`workspace UI missing render budget attribute ${attribute}`);
  }
}

for (const snippet of [
  "buildReferenceUploadIntegrationSmoke",
  "referenceUploadIntegrationOperationIds",
  "latestAcceptedReferencePackaged",
  "latestAcceptedReferenceIdentityStatus",
  "latestAcceptedReferenceProvenancePresent",
  "latestAcceptedReferencePptSlidePresent",
  "rejectedReferencePackagedCount",
  "rejectedReferenceExportedCount",
  "uploadRequestContractCount",
  "tenant-scoped-dev-preview",
  "X-Zenari-CSRF"
]) {
  if (!devStateSource.includes(snippet)) {
    fail(`reference upload builder missing source contract ${snippet}`);
  }
}

for (const snippet of [
  "export interface ReferenceUploadIntegrationSmoke",
  "schema_version: \"stage0.rev2.reference-upload-integration-smoke\"",
  "apiOperationIds: Array<\"createUpload\" | \"createPackage\" | \"createExport\" | \"getExport\">",
  "latestAcceptedReferenceKind",
  "latestAcceptedReferencePackageItemId",
  "latestAcceptedReferenceExportTitle",
  "latestAcceptedReferenceIdentityStatus",
  "latestAcceptedReferenceProvenancePresent",
  "latestAcceptedReferencePptSlidePresent",
  "rejectedReferenceExportedCount"
]) {
  if (!contractsSource.includes(snippet)) {
    fail(`reference upload TypeScript contract missing ${snippet}`);
  }
}

for (const snippet of [
  "data-reference-upload-integration-status",
  "data-reference-latest-upload-csrf-header",
  "data-reference-latest-accepted-kind",
  "data-reference-latest-package-item-id",
  "data-reference-latest-export-title",
  "data-reference-latest-ppt-slide-source-item-id",
  "data-reference-latest-identity-status",
  "data-reference-latest-packaged",
  "data-reference-latest-provenance-present",
  "data-reference-latest-ppt-slide-present",
  "data-reference-rejected-packaged-count",
  "data-reference-rejected-exported-count",
  "data-reference-upload-integration-failures",
  "data-rendering-smoke='stage0.rev2.workspace-rendering-performance'",
  "data-package-export-metadata-ui='stage0.rev2.package-export-metadata-ui'",
  "data-export-download-parity-status"
]) {
  if (!workspaceSmokeTestSource.includes(snippet)) {
    fail(`workspace smoke test missing reference/export assertion ${snippet}`);
  }
}

for (const snippet of artifact.browserEvidence.requiredAssertions) {
  if (!browserSpecSource.includes(snippet)) {
    fail(`reference export browser spec missing assertion ${snippet}`);
  }
}

for (const snippet of [
  "campaign-reference.webp",
  "unsafe-reference.exe",
  "http://assets.example.com/reference-pack",
  "dev-client-reference:ref-campaign-reference-webp",
  "buildExportPackageBlob",
  "ppt-ready-metadata.json"
]) {
  if (!exportDownloadTestSource.includes(snippet)) {
    fail(`export download integration test missing ${snippet}`);
  }
}

console.log(
  `reference upload integration smoke passed: ${referenceUpload.expectedOperations.length} operations, ${workspaceRendering.requiredInteractionSteps.length} render steps, package/export metadata and download parity contracts are wired to browser evidence.`
);
