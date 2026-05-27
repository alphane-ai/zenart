import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const generatedApiPath = path.join(root, "lib", "generated", "zenart-api.ts");
const requestSecurityPath = path.join(root, "lib", "request-security.ts");
const devStatePath = path.join(root, "lib", "dev-state.ts");
const workspaceAppPath = path.join(root, "components", "workspace-app.tsx");
const workspaceSmokeTestPath = path.join(root, "components", "workspace-app.smoke.test.tsx");
const sessionSecurityPlaywrightSpecPath = path.join(root, "tests", "session-security.spec.ts");
const userRouteSmokePath = path.join(root, "validation", "user-routes-smoke.json");
const generatedApiCsrfContractPath = path.join(root, "validation", "generated-api-csrf-contract.json");

const fail = (message) => {
  console.error(`security contract smoke failed: ${message}`);
  process.exit(1);
};

const [
  generatedApiSource,
  requestSecuritySource,
  devStateSource,
  workspaceAppSource,
  workspaceSmokeTestSource,
  sessionSecurityPlaywrightSpecSource,
  userRouteSmoke,
  generatedApiCsrfContract
] = await Promise.all([
  readFile(generatedApiPath, "utf8"),
  readFile(requestSecurityPath, "utf8"),
  readFile(devStatePath, "utf8"),
  readFile(workspaceAppPath, "utf8"),
  readFile(workspaceSmokeTestPath, "utf8"),
  readFile(sessionSecurityPlaywrightSpecPath, "utf8"),
  readFile(userRouteSmokePath, "utf8").then(JSON.parse),
  readFile(generatedApiCsrfContractPath, "utf8").then(JSON.parse)
]);

if (userRouteSmoke.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("user route smoke artifact must cite the Rev2 blueprint");
}

if (generatedApiCsrfContract.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("generated API CSRF artifact must cite the Rev2 blueprint");
}

if (
  generatedApiCsrfContract.status !== "pass" ||
  generatedApiCsrfContract.credentialMode !== "include" ||
  generatedApiCsrfContract.csrfHeaderName !== "X-ZenArt-CSRF" ||
  generatedApiCsrfContract.csrfHeaderValue !== "same-site-origin-check" ||
  generatedApiCsrfContract.sameSiteRequirement !== "lax-or-strict" ||
  generatedApiCsrfContract.originPolicy !== "same-site-only" ||
  generatedApiCsrfContract.missingUnsafeOperationCount !== 0 ||
  generatedApiCsrfContract.failureCount !== 0
) {
  fail("generated API CSRF artifact is not a passing same-site request contract");
}

const operationMap = new Map(
  Array.from(
    generatedApiSource.matchAll(
      /^  ([a-zA-Z0-9]+): \{ method: "([A-Z]+)", path: "([^"]+)", rbac: "user", idempotencyRequired: (true|false), errorEnvelope: true \}/gm
    )
  ).map(([, operationId, method, operationPath, idempotencyRequired]) => [
    operationId,
    {
      method,
      path: operationPath,
      idempotencyRequired: idempotencyRequired === "true"
    }
  ])
);

if (operationMap.size !== generatedApiCsrfContract.safeOperationCount + generatedApiCsrfContract.unsafeOperationCount) {
  fail("generated API operation inventory count drifted from CSRF artifact");
}

const protectedMethods = new Set(generatedApiCsrfContract.protectedMethods);
const unsafeOperations = Array.from(operationMap.entries())
  .filter(([, operation]) => protectedMethods.has(operation.method))
  .map(([operationId]) => operationId);
const safeOperations = Array.from(operationMap.entries())
  .filter(([, operation]) => !protectedMethods.has(operation.method))
  .map(([operationId]) => operationId);

if (JSON.stringify(unsafeOperations) !== JSON.stringify(generatedApiCsrfContract.unsafeOperations)) {
  fail("unsafe operation inventory drifted from generated client order");
}

if (JSON.stringify(safeOperations) !== JSON.stringify(generatedApiCsrfContract.safeOperations)) {
  fail("safe operation inventory drifted from generated client order");
}

for (const contract of generatedApiCsrfContract.unsafeRequestContracts) {
  const operation = operationMap.get(contract.operationId);
  if (!operation) {
    fail(`unsafe request contract references unknown operation ${contract.operationId}`);
  }
  if (
    operation.method !== contract.method ||
    operation.path !== contract.path ||
    operation.idempotencyRequired !== contract.idempotencyHeaderRequired ||
    contract.credentials !== "include" ||
    contract.csrfHeaderName !== "X-ZenArt-CSRF" ||
    contract.csrfHeaderValue !== "same-site-origin-check"
  ) {
    fail(`unsafe request contract drifted for ${contract.operationId}`);
  }
}

for (const requiredGeneratedClientSnippet of [
  "credentials: defaultSameSiteCsrfContract.credentialMode",
  "headers: buildCsrfRequestHeaders(operation.method, headers)",
  "operation.idempotencyRequired",
  "Idempotency-Key",
  "assertSameSiteBaseUrl(baseUrl)",
  "baseUrl.startsWith(\"//\")",
  "parsed.origin !== currentOrigin",
  "isUnsafePathParam"
]) {
  if (!generatedApiSource.includes(requiredGeneratedClientSnippet)) {
    fail(`generated client missing request security snippet ${requiredGeneratedClientSnippet}`);
  }
}

for (const requiredRequestSecuritySnippet of [
  "same-site-origin-check",
  "X-ZenArt-CSRF",
  "credentialMode: \"include\"",
  "originPolicy: \"same-site-only\"",
  "csrfProtectedMethods",
  "buildCsrfRequestHeaders",
  "buildSessionSecurityContractEvidence",
  "buildGeneratedApiCsrfRequestContractEvidence",
  "cookieFailureReasons",
  "csrfFailureReasons"
]) {
  if (!requestSecuritySource.includes(requiredRequestSecuritySnippet)) {
    fail(`request security contract missing ${requiredRequestSecuritySnippet}`);
  }
}

for (const requiredSessionSnippet of [
  "__Host-zenart_session",
  "httpOnly: true",
  "secure: true",
  "sameSite: \"lax\"",
  "path: \"/\"",
  "csrf: defaultSameSiteCsrfContract"
]) {
  if (!devStateSource.includes(requiredSessionSnippet)) {
    fail(`dev session contract missing ${requiredSessionSnippet}`);
  }
}

const securityEvidenceBySchema = new Map(
  (userRouteSmoke.securityEvidence ?? []).map((entry) => [entry.schemaVersion, entry])
);
const sessionEvidence = securityEvidenceBySchema.get("stage0.rev2.session-csrf-client-evidence");
const generatedClientEvidence = securityEvidenceBySchema.get("stage0.rev2.generated-api-csrf-contract");

if (!sessionEvidence || !generatedClientEvidence) {
  fail("user route smoke artifact is missing session or generated-client CSRF evidence");
}

if (
  sessionEvidence.route !== "/account" ||
  sessionEvidence.expectedStatus !== "pass" ||
  sessionEvidence.cookie?.name !== "__Host-zenart_session" ||
  sessionEvidence.cookie?.expectedHttpOnly !== "true" ||
  sessionEvidence.cookie?.expectedSecure !== "true" ||
  sessionEvidence.cookie?.expectedSameSite !== "lax" ||
  sessionEvidence.cookie?.expectedPath !== "/" ||
  sessionEvidence.csrf?.expectedHeader !== "X-ZenArt-CSRF" ||
  sessionEvidence.csrf?.expectedStrategy !== "same-site-origin-check" ||
  sessionEvidence.csrf?.expectedCredentialMode !== "include" ||
  sessionEvidence.csrf?.expectedSameSiteRequirement !== "lax-or-strict" ||
  sessionEvidence.csrf?.expectedOriginPolicy !== "same-site-only" ||
  sessionEvidence.csrf?.expectedMissingOperationCount !== "0" ||
  sessionEvidence.csrf?.expectedCookieFailureCount !== "0" ||
  sessionEvidence.csrf?.expectedCsrfFailureCount !== "0"
) {
  fail("session evidence artifact no longer proves the secure-cookie and same-site CSRF UX contract");
}

if (
  generatedClientEvidence.expectedStatus !== generatedApiCsrfContract.status ||
  generatedClientEvidence.credentialMode !== generatedApiCsrfContract.credentialMode ||
  generatedClientEvidence.csrfHeaderName !== generatedApiCsrfContract.csrfHeaderName ||
  generatedClientEvidence.csrfHeaderValue !== generatedApiCsrfContract.csrfHeaderValue ||
  generatedClientEvidence.unsafeOperationCount !== generatedApiCsrfContract.unsafeOperationCount ||
  generatedClientEvidence.safeOperationCount !== generatedApiCsrfContract.safeOperationCount ||
  generatedClientEvidence.missingUnsafeOperationCount !== generatedApiCsrfContract.missingUnsafeOperationCount ||
  generatedClientEvidence.failureCount !== generatedApiCsrfContract.failureCount
) {
  fail("generated-client route evidence drifted from generated-api-csrf-contract.json");
}

const requiredSessionAttributes = [
  sessionEvidence.statusAttribute,
  sessionEvidence.cookie?.httpOnlyAttribute,
  sessionEvidence.cookie?.secureAttribute,
  sessionEvidence.cookie?.sameSiteAttribute,
  sessionEvidence.cookie?.pathAttribute,
  sessionEvidence.csrf?.strategyAttribute,
  sessionEvidence.csrf?.headerAttribute,
  sessionEvidence.csrf?.credentialModeAttribute,
  sessionEvidence.csrf?.originPolicyAttribute,
  sessionEvidence.csrf?.sameSiteRequirementAttribute,
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
  sessionEvidence.unsafeActionGuard?.guardLabelsAttribute,
  sessionEvidence.unsafeActionGuard?.operationCountAttribute,
  sessionEvidence.unsafeActionGuard?.csrfProtectedOperationCountAttribute,
  sessionEvidence.unsafeActionGuard?.generatedUnsafeOperationsAttribute,
  sessionEvidence.unsafeActionGuard?.guardCoverageStatusAttribute,
  sessionEvidence.unsafeActionGuard?.missingCsrfOperationCountAttribute,
  sessionEvidence.unsafeActionGuard?.missingCsrfOperationsAttribute,
  sessionEvidence.unsafeActionGuard?.operationContractsAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.guardAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.labelAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.statusAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.operationCountAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.operationsAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.contractsAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.csrfProtectedOperationCountAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.idempotencyRequiredOperationCountAttribute,
  ...generatedClientEvidence.requiredAttributes
];

for (const attribute of requiredSessionAttributes) {
  if (!attribute || !workspaceAppSource.includes(attribute)) {
    fail(`workspace UI source missing security evidence attribute ${attribute}`);
  }
}

for (const expectedGuardLabel of sessionEvidence.unsafeActionGuard?.expectedGuardLabels ?? []) {
  if (!workspaceAppSource.includes(expectedGuardLabel)) {
    fail(`workspace UI source missing unsafe-action guard label ${expectedGuardLabel}`);
  }
}

if (
  generatedApiCsrfContract.browserSmoke?.script !== "npm run smoke:session-security-playwright" ||
  generatedClientEvidence.browserSmoke !== generatedApiCsrfContract.browserSmoke?.test ||
  generatedClientEvidence.browserSmokeScript !== generatedApiCsrfContract.browserSmoke?.script ||
  JSON.stringify(generatedClientEvidence.browserSmokeRequiredAssertions) !==
    JSON.stringify(generatedApiCsrfContract.browserSmoke?.requiredAssertions)
) {
  fail("generated API CSRF artifact must pin the account-route browser smoke evidence");
}

for (const requiredBrowserAssertion of generatedApiCsrfContract.browserSmoke?.requiredAssertions ?? []) {
  if (!sessionSecurityPlaywrightSpecSource.includes(requiredBrowserAssertion)) {
    fail(`generated API CSRF browser smoke missing required assertion ${requiredBrowserAssertion}`);
  }
}

for (const expectedContract of sessionEvidence.unsafeActionGuard?.requiredOperationContracts ?? []) {
  if (!workspaceSmokeTestSource.includes(expectedContract) && !workspaceAppSource.includes(expectedContract.split("=>")[0])) {
    fail(`same-site UX smoke missing unsafe-action operation contract ${expectedContract}`);
  }
}

for (const expectedControlContract of sessionEvidence.unsafeActionGuard?.requiredControlContracts ?? []) {
  const [label, contract] = expectedControlContract.split("=>");
  if (!workspaceAppSource.includes(label)) {
    fail(`workspace UI missing unsafe-action control label ${label}`);
  }
  if (!workspaceSmokeTestSource.includes(contract) && !sessionSecurityPlaywrightSpecSource.includes(contract)) {
    fail(`same-site UX smoke missing control-level operation contract ${expectedControlContract}`);
  }
}

for (const requiredControlSnippet of [
  "unsafeActionGuardAttributes",
  "formatUnsafeActionControlContracts",
  "data-csrf-ux-guard",
  "data-csrf-ux-guard-label",
  "data-csrf-ux-guard-status",
  "data-csrf-ux-guard-contracts"
]) {
  if (!workspaceAppSource.includes(requiredControlSnippet)) {
    fail(`workspace UI missing control-level CSRF guard snippet ${requiredControlSnippet}`);
  }
}

if (
  sessionEvidence.unsafeActionGuard?.expectedGuardCoverageStatus !== "pass" ||
  sessionEvidence.unsafeActionGuard?.expectedMissingCsrfOperationCount !== "0" ||
  sessionEvidence.unsafeActionGuard?.expectedMissingCsrfOperations !== ""
) {
  fail("unsafe-action guard coverage must prove every generated unsafe operation is represented");
}

for (const requiredTestSnippet of [
  "renders secure-cookie and same-site CSRF session UX evidence as an interactive client contract",
  "blocks unsafe workspace actions when the same-site session is expired",
  "data-session-security-status",
  "data-session-unsafe-action-status",
  "data-session-unsafe-action-guard-coverage-status",
  "data-session-unsafe-action-missing-csrf-operation-count",
  "data-session-unsafe-action-operation-contracts",
  "data-csrf-ux-guard-contracts",
  "data-generated-api-csrf-operation-contracts",
  "Session expired. Refresh or sign in to continue.",
  "Save Settings"
]) {
  if (!workspaceSmokeTestSource.includes(requiredTestSnippet)) {
    fail(`workspace smoke test missing security assertion ${requiredTestSnippet}`);
  }
}

for (const requiredBrowserSnippet of [
  "account route exposes secure-cookie, same-site CSRF, and unsafe-action guard browser evidence",
  "data-session-security-evidence",
  "data-session-cookie-name",
  "data-session-cookie-http-only",
  "data-session-cookie-secure",
  "data-session-cookie-same-site",
  "data-session-csrf-header",
  "data-session-csrf-origin-policy",
  "data-session-unsafe-action-operation-contracts",
  "data-session-unsafe-action-guard-coverage-status",
  "data-session-unsafe-action-missing-csrf-operation-count",
  "data-csrf-ux-guard-contracts",
  "data-csrf-ux-guard-status",
  "data-generated-api-csrf-unsafe-operations",
  "data-generated-api-csrf-operation-contracts",
  "Session expired. Refresh or sign in to continue.",
  "Refresh Session",
  "Save Settings",
  "Sign In"
]) {
  if (!sessionSecurityPlaywrightSpecSource.includes(requiredBrowserSnippet)) {
    fail(`session security browser smoke missing assertion ${requiredBrowserSnippet}`);
  }
}

console.log(
  `security contract smoke passed: ${unsafeOperations.length} unsafe operations require ${generatedApiCsrfContract.csrfHeaderName}; ${safeOperations.length} safe operations stay credentialed without CSRF headers; /account exposes secure-cookie same-site UX and browser evidence.`
);
