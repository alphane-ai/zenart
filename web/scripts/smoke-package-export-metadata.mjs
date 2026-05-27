import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactPath = path.join(root, "validation", "package-export-metadata-smoke.json");
const userRoutesPath = path.join(root, "validation", "user-routes-smoke.json");
const ecommerceSmokePath = path.join(root, "validation", "ecommerce-growth-web-smoke.json");
const componentPath = path.join(root, "components", "workspace-app.tsx");
const workspaceSmokeTestPath = path.join(root, "components", "workspace-app.smoke.test.tsx");
const devStatePath = path.join(root, "lib", "dev-state.ts");
const contractsPath = path.join(root, "lib", "contracts.ts");
const downloadPath = path.join(root, "lib", "export-download.ts");

const fail = (message) => {
  console.error(`package/export metadata smoke failed: ${message}`);
  process.exit(1);
};

const [
  artifact,
  userRoutes,
  ecommerceSmoke,
  componentSource,
  workspaceSmokeTestSource,
  devStateSource,
  contractsSource,
  downloadSource
] = await Promise.all([
  readFile(artifactPath, "utf8").then(JSON.parse),
  readFile(userRoutesPath, "utf8").then(JSON.parse),
  readFile(ecommerceSmokePath, "utf8").then(JSON.parse),
  readFile(componentPath, "utf8"),
  readFile(workspaceSmokeTestPath, "utf8"),
  readFile(devStatePath, "utf8"),
  readFile(contractsPath, "utf8"),
  readFile(downloadPath, "utf8")
]);

if (artifact.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("artifact must cite Docs/stage0_blueprint_rev2.md");
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
  zipPayloadSmoke.sharedPayloadPlanner !== routeZipPayloadEvidence.sharedPayloadPlanner
) {
  fail("ZIP payload smoke artifact drifted from user route smoke evidence");
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
  downloadParity.expectedWorkflowMetadataPresent !== routeDownloadParityEvidence.expectedWorkflowMetadataPresent ||
  downloadParity.expectedTraceProvenancePresent !== routeDownloadParityEvidence.expectedTraceProvenancePresent
) {
  fail("download parity artifact drifted from user route smoke evidence");
}

for (const attribute of evidence.requiredAttributes) {
  if (!componentSource.includes(attribute)) {
    fail(`workspace export UI missing metadata attribute ${attribute}`);
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
  "export const toExportZipPayloadName",
  "export const buildDownloadableExportZipPayloadNames",
  "export const buildExportWorkflowMetadataPayload",
  "export const buildAiContentDisclaimerPayload",
  "export const ecommerceGrowthWorkflowAcceptance",
  "export const buildPackageExportMetadataEvidence",
  "export const buildExportZipPayloadSmokeEvidence",
  "export const buildExportDownloadParityEvidence",
  "metadataPayloadsMatchZipPayloads",
  "workflowMetadataPayloadPresent",
  "workflowTraceProvenancePayloadPresent",
  "aiContentDisclaimerPayloadPresent",
  "workflowProviderMetadataPresent",
  "workflowPromptSpecMetadataPresent",
  "workflowSkillMetadataPresent",
  "workflowSafetyMetadataPresent"
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
  "metadataPayloadsMatchZipPayloads"
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
  "buildExportWorkflowMetadataPayload(record, requiredPayload)",
  "downloadExportPackage"
]) {
  if (!downloadSource.includes(requiredDownloadSnippet)) {
    fail(`download planner missing package/export payload contract ${requiredDownloadSnippet}`);
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
  "data-package-export-payload-row",
  "data-export-zip-payload-smoke-status",
  "data-export-download-parity-status",
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
  ["data-package-export-zip-payload-parity-status", evidence.expectedZipPayloadParityStatus],
  ["data-package-export-zip-payload-parity-ratio", evidence.expectedZipPayloadParityRatio],
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
  ["data-export-download-parity-workflow-metadata-present", downloadParity.expectedWorkflowMetadataPresent],
  ["data-export-download-parity-trace-provenance-present", downloadParity.expectedTraceProvenancePresent],
  ["data-export-download-handoff", downloadHandoff.schemaVersion],
  ["data-export-download-handoff-status", downloadHandoff.expectedStatus],
  ["data-export-download-file-name", downloadHandoff.expectedFileName],
  ["data-export-download-format", downloadHandoff.expectedFormat]
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

if (!workspaceSmokeTestSource.includes("Package export payload status matrix")) {
  fail("workspace smoke test must inspect the package export payload status matrix");
}

if (!componentSource.includes("function PayloadStatusList") || !componentSource.includes("payload-status-list")) {
  fail("workspace export UI must render payload status rows");
}

if (!componentSource.includes("downloadExportPackage(item)")) {
  fail("workspace export UI must wire download handoff to the export download planner");
}
