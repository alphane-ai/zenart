import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactPath = path.join(root, "validation", "workspace-rendering-performance-smoke.json");
const userRoutesPath = path.join(root, "validation", "user-routes-smoke.json");
const referenceUploadArtifactPath = path.join(root, "validation", "reference-upload-integration-smoke.json");
const referenceExportBrowserSmokePath = path.join(root, "validation", "reference-export-browser-smoke.json");
const componentPath = path.join(root, "components", "workspace-app.tsx");
const workspaceSmokeTestPath = path.join(root, "components", "workspace-app.smoke.test.tsx");
const referenceExportPlaywrightSpecPath = path.join(root, "tests", "reference-export.spec.ts");
const devStatePath = path.join(root, "lib", "dev-state.ts");
const devStateTestPath = path.join(root, "lib", "dev-state.test.ts");
const contractsPath = path.join(root, "lib", "contracts.ts");
const packageJsonPath = path.join(root, "package.json");

const fail = (message) => {
  console.error(`workspace rendering performance smoke failed: ${message}`);
  process.exit(1);
};

const [
  artifact,
  userRoutes,
  referenceUploadArtifact,
  referenceExportBrowserSmoke,
  componentSource,
  workspaceSmokeTestSource,
  referenceExportPlaywrightSpecSource,
  devStateSource,
  devStateTestSource,
  contractsSource,
  packageJson
] = await Promise.all([
  readFile(artifactPath, "utf8").then(JSON.parse),
  readFile(userRoutesPath, "utf8").then(JSON.parse),
  readFile(referenceUploadArtifactPath, "utf8").then(JSON.parse),
  readFile(referenceExportBrowserSmokePath, "utf8").then(JSON.parse),
  readFile(componentPath, "utf8"),
  readFile(workspaceSmokeTestPath, "utf8"),
  readFile(referenceExportPlaywrightSpecPath, "utf8"),
  readFile(devStatePath, "utf8"),
  readFile(devStateTestPath, "utf8"),
  readFile(contractsPath, "utf8"),
  readFile(packageJsonPath, "utf8").then(JSON.parse)
]);

if (
  artifact.schemaVersion !== "stage0.rev2.workspace-rendering-performance-static-smoke" ||
  artifact.blueprintSource !== "Docs/stage0_blueprint_rev2.md" ||
  artifact.status !== "pass" ||
  artifact.scope !== "user-web-local-dev-client" ||
  artifact.doesNotCloseChecklistGates !== true ||
  artifact.checklistPolicy?.workspaceRenderingPerformanceChecklistAlreadyClosed !== true ||
  artifact.checklistPolicy?.localAlphaGateRemainsOpen !== true ||
  artifact.checklistPolicy?.privateBetaStagingGateRemainsOpen !== true ||
  artifact.checklistPolicy?.productionLaunchGateRemainsOpen !== true
) {
  fail("artifact must be passing Rev2 user-web static evidence that preserves runtime gates");
}

if (packageJson.scripts?.["smoke:workspace-rendering-performance"] !== "node scripts/smoke-workspace-rendering-performance.mjs") {
  fail("package.json must expose smoke:workspace-rendering-performance");
}

if (userRoutes.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("user route smoke artifact must cite Docs/stage0_blueprint_rev2.md");
}

const securityEvidenceBySchema = new Map((userRoutes.securityEvidence ?? []).map((entry) => [entry.schemaVersion, entry]));
const routeRenderingEvidence = securityEvidenceBySchema.get("stage0.rev2.workspace-rendering-performance");
if (!routeRenderingEvidence) {
  fail("user route smoke is missing workspace rendering performance evidence");
}

const evidence = artifact.evidence;
if (
  evidence.schemaVersion !== routeRenderingEvidence.schemaVersion ||
  evidence.route !== routeRenderingEvidence.route ||
  evidence.source !== routeRenderingEvidence.source ||
  evidence.statusAttribute !== routeRenderingEvidence.statusAttribute ||
  evidence.expectedStatus !== routeRenderingEvidence.expectedStatus ||
  evidence.expectedFailureCount !== routeRenderingEvidence.expectedFailureCount ||
  JSON.stringify(evidence.expectedBudgets) !== JSON.stringify(routeRenderingEvidence.expectedBudgets) ||
  JSON.stringify(evidence.expectedFinalInteractionSteps) !== JSON.stringify(routeRenderingEvidence.requiredInteractionSteps) ||
  evidence.expectedFinalCounts.duplicateRenderIdentityCount !== routeRenderingEvidence.expectedDuplicateIdentityCount ||
  routeRenderingEvidence.expectedIdentityCountMatchesRenderElementCount !== "true" ||
  JSON.stringify(evidence.budgetAttributes) !== JSON.stringify(routeRenderingEvidence.budgetAttributes) ||
  JSON.stringify(evidence.summaryAttributes) !== JSON.stringify(routeRenderingEvidence.summaryAttributes)
) {
  fail("workspace rendering artifact drifted from user route smoke evidence");
}

if (
  referenceUploadArtifact.workspaceRendering?.schemaVersion !== evidence.schemaVersion ||
  referenceUploadArtifact.workspaceRendering?.expectedStatus !== evidence.expectedStatus ||
  referenceUploadArtifact.workspaceRendering?.expectedFailureCount !== evidence.expectedFailureCount ||
  !referenceUploadArtifact.workspaceRendering?.requiredAttributes?.includes("data-render-identity-count") ||
  !referenceUploadArtifact.workspaceRendering?.requiredAttributes?.includes("data-render-duplicate-identity-count")
) {
  fail("reference upload integration artifact must continue to pin rendering performance evidence");
}

if (
  referenceExportBrowserSmoke.expectedContracts?.workspaceRendering?.schemaVersion !== evidence.schemaVersion ||
  referenceExportBrowserSmoke.expectedContracts?.workspaceRendering?.expectedStatus !== evidence.expectedStatus ||
  referenceExportBrowserSmoke.expectedContracts?.workspaceRendering?.expectedFailureCount !== evidence.expectedFailureCount ||
  referenceExportBrowserSmoke.expectedContracts?.workspaceRendering?.expectedDuplicateIdentityCount !==
    evidence.expectedFinalCounts.duplicateRenderIdentityCount
) {
  fail("reference export browser artifact must continue to pin rendering performance evidence");
}

for (const attribute of [...evidence.budgetAttributes, ...evidence.summaryAttributes, evidence.statusAttribute]) {
  if (!componentSource.includes(attribute)) {
    fail(`workspace component missing rendering evidence attribute ${attribute}`);
  }
}

for (const [budgetName, expectedValue] of Object.entries(evidence.expectedBudgets)) {
  if (!devStateSource.includes(`${budgetName}: ${expectedValue}`)) {
    fail(`workspace rendering budget drifted for ${budgetName}`);
  }
}

for (const [countName, expectedValue] of Object.entries(evidence.expectedFinalCounts)) {
  const attributeName = countName
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^node-count$/, "render-node-count")
    .replace(/^edge-count$/, "render-edge-count")
    .replace(/^version-count$/, "render-version-count")
    .replace(/^candidate-count$/, "render-candidate-count")
    .replace(/^package-item-count$/, "render-package-item-count")
    .replace(/^reference-count$/, "render-reference-count")
    .replace(/^export-history-count$/, "render-export-history-count")
    .replace(/^render-element-count$/, "render-element-count")
    .replace(/^estimated-interaction-ms$/, "render-estimated-interaction-ms")
    .replace(/^render-identity-count$/, "render-identity-count")
    .replace(/^duplicate-render-identity-count$/, "render-duplicate-identity-count");
  if (!componentSource.includes(`data-${attributeName}`) && !workspaceSmokeTestSource.includes(`data-${attributeName}`)) {
    fail(`workspace rendering final count is missing UI/test attribute coverage for ${countName}`);
  }
  if (!/^\d+$/.test(expectedValue)) {
    fail(`workspace rendering final count must be numeric for ${countName}`);
  }
}

if (evidence.expectedFinalCounts.renderIdentityCount !== evidence.expectedFinalCounts.renderElementCount) {
  fail("workspace rendering identity count must match render element count");
}

if (evidence.expectedFinalCounts.duplicateRenderIdentityCount !== "0") {
  fail("workspace rendering contract must expect zero duplicate render identities");
}

for (const requiredStepBudgetSnippet of [
  "interactionStepBudgets",
  "workspaceRenderingStepWeights",
  "data-render-interaction-step-budget-statuses",
  "data-render-interaction-step-budget-failure-count",
  "data-rendering-step-budget-statuses",
  "data-rendering-step-budget-failure-count",
  "renderIdentities",
  "duplicateRenderIdentities",
  "data-render-identity-count",
  "data-render-duplicate-identity-count",
  "data-render-identity-digest",
  "brief-confirm:pass:",
  "candidate-select:pass:",
  "package-add:pass:",
  "export-ready:pass:"
]) {
  if (
    !devStateSource.includes(requiredStepBudgetSnippet) &&
    !contractsSource.includes(requiredStepBudgetSnippet) &&
    !componentSource.includes(requiredStepBudgetSnippet) &&
    !workspaceSmokeTestSource.includes(requiredStepBudgetSnippet) &&
    !referenceExportPlaywrightSpecSource.includes(requiredStepBudgetSnippet) &&
    !JSON.stringify(artifact).includes(requiredStepBudgetSnippet) &&
    !JSON.stringify(userRoutes).includes(requiredStepBudgetSnippet)
  ) {
    fail(`workspace rendering step budget evidence missing ${requiredStepBudgetSnippet}`);
  }
}

for (const step of evidence.expectedFinalInteractionSteps) {
  if (!devStateSource.includes(step)) {
    fail(`workspace rendering builder missing interaction step ${step}`);
  }
  if (!workspaceSmokeTestSource.includes(step)) {
    fail(`component smoke missing interaction step assertion ${step}`);
  }
}

for (const assertion of evidence.finalFlowAssertions) {
  if (!workspaceSmokeTestSource.includes(assertion)) {
    fail(`component smoke missing final flow assertion ${assertion}`);
  }
}

for (const assertion of artifact.browserEvidence.requiredAssertions) {
  if (!referenceExportPlaywrightSpecSource.includes(assertion)) {
    fail(`reference export browser smoke missing rendering assertion ${assertion}`);
  }
}

for (const requiredSourceSnippet of [
  "export const workspaceRenderingPerformanceBudget",
  "export const buildWorkspaceRenderingPerformanceSmoke",
  "renderElementCount",
  "estimatedInteractionMs",
  "renderIdentityCount",
  "duplicateRenderIdentityCount",
  "duplicateRenderIdentities",
  "renderIdentityDigest",
  "failures.push(\"nodes\")",
  "failures.push(\"edges\")",
  "failures.push(\"versions\")",
  "failures.push(\"render-elements\")",
  "failures.push(\"interaction\")",
  "failures.push(\"duplicate-render-identities\")"
]) {
  if (!devStateSource.includes(requiredSourceSnippet)) {
    fail(`workspace rendering builder missing ${requiredSourceSnippet}`);
  }
}

for (const requiredContractSnippet of [
  "export interface WorkspaceRenderingPerformanceSmoke",
  "schema_version: \"stage0.rev2.workspace-rendering-performance\"",
  "\"load\" | \"brief-confirm\" | \"candidate-select\" | \"iteration\" | \"package-add\" | \"export-ready\" | \"version-restore\"",
  "interactionStepBudgets: Array",
  "renderElementCount: number",
  "estimatedInteractionMs: number",
  "renderIdentityCount: number",
  "duplicateRenderIdentityCount: number",
  "duplicateRenderIdentities: string[]",
  "renderIdentityDigest: string",
  "maxRenderElements: number",
  "maxInteractionMs: number"
]) {
  if (!contractsSource.includes(requiredContractSnippet)) {
    fail(`workspace rendering TypeScript contract missing ${requiredContractSnippet}`);
  }
}

for (const requiredTestSnippet of [
  "keeps workspace rendering inside the smoke budget across the interactive canvas flow",
  "fails workspace rendering smoke when local alpha budgets are exceeded",
  "fails workspace rendering smoke when rendered element identities are duplicated",
  "data-render-failure-count",
  "data-render-identity-count",
  "data-render-duplicate-identity-count",
  "data-render-identity-digest",
  "data-render-interaction-step-budget-failure-count",
  "data-render-estimated-interaction-ms",
  "data-render-max-interaction-ms",
  "toBeLessThanOrEqual"
]) {
  if (
    !workspaceSmokeTestSource.includes(requiredTestSnippet) &&
    !devStateTestSource.includes(requiredTestSnippet) &&
    !devStateSource.includes(requiredTestSnippet)
  ) {
    fail(`workspace rendering tests missing ${requiredTestSnippet}`);
  }
}

console.log(
  `workspace rendering performance smoke passed: ${evidence.expectedFinalInteractionSteps.length} interaction steps, ${evidence.expectedFinalCounts.renderElementCount}/${evidence.expectedBudgets.maxRenderElements} render elements, ${evidence.expectedFinalCounts.estimatedInteractionMs}/${evidence.expectedBudgets.maxInteractionMs}ms estimated interaction budget.`
);
