import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const generatedApiPath = path.join(root, "lib", "generated", "zenart-api.ts");
const requestSecurityPath = path.join(root, "lib", "request-security.ts");
const devStatePath = path.join(root, "lib", "dev-state.ts");
const generatedApiTestPath = path.join(root, "lib", "generated", "zenart-api.test.ts");
const requestSecurityTestPath = path.join(root, "lib", "request-security.test.ts");
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
  generatedApiTestSource,
  requestSecurityTestSource,
  workspaceAppSource,
  workspaceSmokeTestSource,
  sessionSecurityPlaywrightSpecSource,
  userRouteSmoke,
  generatedApiCsrfContract
] = await Promise.all([
  readFile(generatedApiPath, "utf8"),
  readFile(requestSecurityPath, "utf8"),
  readFile(devStatePath, "utf8"),
  readFile(generatedApiTestPath, "utf8"),
  readFile(requestSecurityTestPath, "utf8"),
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

const expectedBrowserUnsafeRequestContracts = generatedApiCsrfContract.unsafeRequestContracts.map((contract) => {
  const idempotencyKey = contract.idempotencyHeaderRequired ? `csrf-probe-${contract.operationId}` : "not-required";
  return `${contract.operationId}:${contract.method}:${contract.credentials}:${contract.csrfHeaderValue}:${idempotencyKey}`;
});

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
const expectedBrowserSafeRequestContracts = safeOperations.map((operationId) => {
  const operation = operationMap.get(operationId);
  return `${operationId}:${operation?.method ?? "missing"}:include:not-required`;
});
const expectedSafeRequestContracts = safeOperations.map((operationId) => {
  const operation = operationMap.get(operationId);
  return {
    operationId,
    method: operation?.method ?? "missing",
    path: operation?.path ?? "missing",
    credentials: "include",
    csrfHeaderName: "not-required",
    csrfHeaderValue: "not-required",
    idempotencyHeaderRequired: false
  };
});
const expectedUiSafeRequestContracts = expectedSafeRequestContracts.map(
  (contract) =>
    `${contract.operationId}:${contract.method}:${contract.credentials}:${contract.csrfHeaderName}:${contract.idempotencyHeaderRequired}`
);

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

if (JSON.stringify(generatedApiCsrfContract.safeRequestContracts) !== JSON.stringify(expectedSafeRequestContracts)) {
  fail("generated API CSRF artifact safe request contracts drifted from generated client safe operation inventory");
}

for (const requiredGeneratedClientSnippet of [
  "credentials: defaultSameSiteCsrfContract.credentialMode",
  "headers: buildCsrfRequestHeaders(operation.method, headers)",
  "operation.idempotencyRequired",
  "Idempotency-Key",
  "assertSameSiteBaseUrl(baseUrl)",
  "baseUrl.startsWith(\"//\")",
  "absolute baseUrl requires a browser origin",
  "parsed.username || parsed.password",
  "baseUrl must not include credentials",
  "parsed.search || parsed.hash",
  "baseUrl must not include query or fragment material",
  "const currentOrigin = window.location.origin",
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
  "stripCsrfHeaderAliases",
  "headerName.toLowerCase() !== contract.headerName.toLowerCase()",
  "buildSessionSecurityContractEvidence",
  "buildGeneratedApiCsrfRequestContractEvidence",
  "cookieFailureReasons",
  "csrfFailureReasons",
  "buildSecureCookieSameSiteRuntimePairingDigest",
  "serializeBackendCsrfValidationContract"
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
  sessionEvidence.cookie?.expectedDomain !== "" ||
  sessionEvidence.cookie?.expectedHostOnly !== "true" ||
  sessionEvidence.cookie?.expectedSetCookieContract !== "__Host-zenart_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly" ||
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
  sessionEvidence.cookie?.domainAttribute,
  sessionEvidence.cookie?.hostOnlyAttribute,
  sessionEvidence.cookie?.setCookieContractAttribute,
  sessionEvidence.cookie?.sameSiteAcceptedValuesAttribute,
  sessionEvidence.cookie?.sameSiteRejectedValuesAttribute,
  sessionEvidence.cookie?.sameSiteAcceptanceMatrixAttribute,
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
  sessionEvidence.backendRuntimePairing?.contractAttribute,
  sessionEvidence.backendRuntimePairing?.statusAttribute,
  sessionEvidence.backendRuntimePairing?.digestAttribute,
  sessionEvidence.backendRuntimePairing?.setCookieContractAttribute,
  sessionEvidence.backendRuntimePairing?.csrfValidationContractAttribute,
  sessionEvidence.backendRuntimePairing?.unsafeRequestContractCountAttribute,
  sessionEvidence.backendRuntimePairing?.missingUnsafeOperationCountAttribute,
  sessionEvidence.backendRuntimePairing?.cookieFailureCountAttribute,
  sessionEvidence.backendRuntimePairing?.csrfFailureCountAttribute,
  sessionEvidence.unsafeActionGuard?.guardAttribute,
  sessionEvidence.unsafeActionGuard?.statusAttribute,
  sessionEvidence.unsafeActionGuard?.safeLabelsAttribute,
  sessionEvidence.unsafeActionGuard?.protectedMethodsAttribute,
  sessionEvidence.unsafeActionGuard?.guardCountAttribute,
  sessionEvidence.unsafeActionGuard?.guardLabelsAttribute,
  sessionEvidence.unsafeActionGuard?.blockedControlCountAttribute,
  sessionEvidence.unsafeActionGuard?.blockedControlLabelsAttribute,
  sessionEvidence.unsafeActionGuard?.blockedReasonAttribute,
  sessionEvidence.unsafeActionGuard?.operationCountAttribute,
  sessionEvidence.unsafeActionGuard?.csrfProtectedOperationCountAttribute,
  sessionEvidence.unsafeActionGuard?.generatedUnsafeOperationsAttribute,
  sessionEvidence.unsafeActionGuard?.guardCoverageStatusAttribute,
  sessionEvidence.unsafeActionGuard?.missingCsrfOperationCountAttribute,
  sessionEvidence.unsafeActionGuard?.missingCsrfOperationsAttribute,
  sessionEvidence.unsafeActionGuard?.operationContractsAttribute,
  generatedClientEvidence.safeOperationContractsAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.guardAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.labelAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.statusAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.requiredSessionStatusAttribute,
  sessionEvidence.unsafeActionGuard?.controlAttributes?.blockedReasonAttribute,
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
  JSON.stringify(generatedApiCsrfContract.browserSmoke?.expectedUnsafeRequestContracts) !==
    JSON.stringify(expectedBrowserUnsafeRequestContracts) ||
  JSON.stringify(generatedApiCsrfContract.browserSmoke?.expectedSafeRequestContracts) !==
    JSON.stringify(expectedBrowserSafeRequestContracts) ||
  JSON.stringify(generatedClientEvidence.browserSmokeExpectedUnsafeRequestContracts) !==
    JSON.stringify(expectedBrowserUnsafeRequestContracts) ||
  JSON.stringify(generatedClientEvidence.browserSmokeExpectedSafeRequestContracts) !==
    JSON.stringify(expectedBrowserSafeRequestContracts) ||
  JSON.stringify(generatedClientEvidence.browserSmokeRequiredAssertions) !==
    JSON.stringify(generatedApiCsrfContract.browserSmoke?.requiredAssertions)
) {
  fail("generated API CSRF artifact must pin the account-route browser smoke evidence");
}

if (
  generatedApiCsrfContract.backendRuntimePairing?.schemaVersion !== "stage0.rev2.secure-cookie-same-site-csrf-runtime-pairing" ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedContract !== sessionEvidence.backendRuntimePairing?.expectedContract ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedStatus !== sessionEvidence.backendRuntimePairing?.expectedStatus ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedDigest !== sessionEvidence.backendRuntimePairing?.expectedDigest ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedSetCookieContract !==
    sessionEvidence.backendRuntimePairing?.expectedSetCookieContract ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedCsrfValidationContract !==
    sessionEvidence.backendRuntimePairing?.expectedCsrfValidationContract ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedUnsafeRequestContractCount !==
    sessionEvidence.backendRuntimePairing?.expectedUnsafeRequestContractCount ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedMissingUnsafeOperationCount !==
    sessionEvidence.backendRuntimePairing?.expectedMissingUnsafeOperationCount ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedCookieFailureCount !== sessionEvidence.backendRuntimePairing?.expectedCookieFailureCount ||
  generatedApiCsrfContract.backendRuntimePairing?.expectedCsrfFailureCount !== sessionEvidence.backendRuntimePairing?.expectedCsrfFailureCount
) {
  fail("generated API CSRF artifact must match the account-route backend runtime pairing evidence");
}

if (
  sessionEvidence.backendRuntimePairing?.expectedStatus !== "pass" ||
  !sessionEvidence.backendRuntimePairing?.expectedDigest?.startsWith(
    "secure-cookie-same-site-csrf-runtime||__Host-zenart_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly||POST,PUT,PATCH,DELETE:X-ZenArt-CSRF:same-site-origin-check:same-site-only:include:lax-or-strict||"
  ) ||
  !sessionEvidence.backendRuntimePairing?.expectedDigest?.includes(
    "createUpload:POST:/uploads:include:X-ZenArt-CSRF:same-site-origin-check:true"
  ) ||
  !sessionEvidence.backendRuntimePairing?.expectedDigest?.endsWith("||missing=none||cookie-failures=none||csrf-failures=none") ||
  sessionEvidence.backendRuntimePairing?.expectedSetCookieContract !== "__Host-zenart_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly" ||
  sessionEvidence.backendRuntimePairing?.expectedCsrfValidationContract !==
    "POST,PUT,PATCH,DELETE:X-ZenArt-CSRF:same-site-origin-check:same-site-only:include:lax-or-strict" ||
  sessionEvidence.backendRuntimePairing?.expectedUnsafeRequestContractCount !== String(generatedApiCsrfContract.unsafeOperationCount) ||
  sessionEvidence.backendRuntimePairing?.expectedMissingUnsafeOperationCount !== String(generatedApiCsrfContract.missingUnsafeOperationCount) ||
  sessionEvidence.backendRuntimePairing?.expectedCookieFailureCount !== "0" ||
  sessionEvidence.backendRuntimePairing?.expectedCsrfFailureCount !== "0"
) {
  fail("account route backend runtime pairing evidence does not prove secure-cookie plus same-site CSRF validation");
}

if (!generatedApiCsrfContract.backendRuntimePairing?.assertion?.includes("runtime cookie or CSRF validation fields drift")) {
  fail("generated API CSRF artifact missing backend runtime pairing assertion text");
}

for (const requiredRuntimePairingAssertion of [
  "data-session-backend-runtime-pairing",
  "data-session-backend-runtime-pairing-status",
  "data-session-backend-runtime-pairing-digest",
  "data-session-backend-set-cookie-contract",
  "data-session-backend-csrf-validation-contract",
  "data-session-backend-unsafe-request-contract-count",
  "data-session-backend-missing-unsafe-operation-count",
  "data-session-backend-cookie-failure-count",
  "data-session-backend-csrf-failure-count"
]) {
  if (!requiredRuntimePairingAssertion || !generatedApiCsrfContract.browserSmoke?.requiredAssertions?.includes(requiredRuntimePairingAssertion)) {
    fail(`generated API CSRF browser smoke contract missing runtime pairing assertion ${requiredRuntimePairingAssertion}`);
  }
}

for (const expectedAssertion of [
  "Generated web API client rejects absolute base URLs when no browser origin is available to prove same-site scope.",
  "Generated web API client allows absolute base URLs only when they match the browser origin.",
  "Generated web API client rejects credential-bearing absolute base URLs before same-site credentialed requests.",
  "Generated web API client rejects query or fragment-bearing absolute base URLs before same-site credentialed requests."
]) {
  if (!generatedApiCsrfContract.assertions?.includes(expectedAssertion)) {
    fail(`generated API CSRF artifact missing absolute-base same-site assertion ${expectedAssertion}`);
  }
}

const absoluteBaseUrlGuard = generatedApiCsrfContract.absoluteBaseUrlGuard;
const routeAbsoluteBaseUrlGuard = generatedClientEvidence.absoluteBaseUrlGuard;
const canonicalHeaderGuard = generatedApiCsrfContract.canonicalHeaderGuard;
const routeCanonicalHeaderGuard = generatedClientEvidence.canonicalHeaderGuard;
if (
  absoluteBaseUrlGuard?.schemaVersion !== "stage0.rev2.generated-api-same-origin-base-guard" ||
  absoluteBaseUrlGuard?.status !== "pass" ||
  absoluteBaseUrlGuard?.sameOriginAllowed !== true ||
  absoluteBaseUrlGuard?.slashRelativeAllowed !== true ||
  absoluteBaseUrlGuard?.protocolRelativeRejected !== true ||
  absoluteBaseUrlGuard?.crossOriginRejected !== true ||
  absoluteBaseUrlGuard?.serverSideAbsoluteRejected !== true ||
  absoluteBaseUrlGuard?.credentialMaterialRejected !== true ||
  absoluteBaseUrlGuard?.queryMaterialRejected !== true ||
  absoluteBaseUrlGuard?.fragmentMaterialRejected !== true ||
  absoluteBaseUrlGuard?.failureCount !== 0 ||
  absoluteBaseUrlGuard?.unitTest !== "web/lib/generated/zenart-api.test.ts" ||
  !absoluteBaseUrlGuard?.assertion?.includes("credential-bearing, query-bearing, and fragment-bearing API bases")
) {
  fail("generated API CSRF artifact missing passing absolute base URL guard evidence");
}

if (
  routeAbsoluteBaseUrlGuard?.schemaVersion !== absoluteBaseUrlGuard.schemaVersion ||
  routeAbsoluteBaseUrlGuard?.expectedStatus !== absoluteBaseUrlGuard.status ||
  routeAbsoluteBaseUrlGuard?.expectedSameOriginAllowed !== absoluteBaseUrlGuard.sameOriginAllowed ||
  routeAbsoluteBaseUrlGuard?.expectedSlashRelativeAllowed !== absoluteBaseUrlGuard.slashRelativeAllowed ||
  routeAbsoluteBaseUrlGuard?.expectedProtocolRelativeRejected !== absoluteBaseUrlGuard.protocolRelativeRejected ||
  routeAbsoluteBaseUrlGuard?.expectedCrossOriginRejected !== absoluteBaseUrlGuard.crossOriginRejected ||
  routeAbsoluteBaseUrlGuard?.expectedServerSideAbsoluteRejected !== absoluteBaseUrlGuard.serverSideAbsoluteRejected ||
  routeAbsoluteBaseUrlGuard?.expectedCredentialMaterialRejected !== absoluteBaseUrlGuard.credentialMaterialRejected ||
  routeAbsoluteBaseUrlGuard?.expectedQueryMaterialRejected !== absoluteBaseUrlGuard.queryMaterialRejected ||
  routeAbsoluteBaseUrlGuard?.expectedFragmentMaterialRejected !== absoluteBaseUrlGuard.fragmentMaterialRejected ||
  routeAbsoluteBaseUrlGuard?.expectedFailureCount !== absoluteBaseUrlGuard.failureCount ||
  routeAbsoluteBaseUrlGuard?.unitTest !== absoluteBaseUrlGuard.unitTest
) {
  fail("user route smoke absolute base URL guard drifted from generated API CSRF artifact");
}

for (const requiredRejectedScenario of [
  "protocol-relative",
  "cross-origin",
  "server-side-absolute",
  "credential-material",
  "query-material",
  "fragment-material"
]) {
  if (
    !absoluteBaseUrlGuard.rejectedExamples?.some(
      (example) => example.scenario === requiredRejectedScenario && example.outcome === "reject-before-fetch"
    )
  ) {
    fail(`generated API CSRF absolute base guard missing rejected scenario ${requiredRejectedScenario}`);
  }
}

for (const requiredGeneratedClientTestSnippet of [
  "rejects credentialed or decorated absolute API bases before same-site requests can be made",
  "baseUrl must not include credentials for same-site CSRF protection",
  "baseUrl must not include query or fragment material for same-site CSRF protection",
  "records absolute base hardening in the generated CSRF evidence artifact",
  "credentialMaterialRejected: true",
  "queryMaterialRejected: true",
  "fragmentMaterialRejected: true"
]) {
  if (!generatedApiTestSource.includes(requiredGeneratedClientTestSnippet)) {
    fail(`generated API CSRF unit evidence missing absolute base guard snippet ${requiredGeneratedClientTestSnippet}`);
  }
}

if (
  canonicalHeaderGuard?.schemaVersion !== "stage0.rev2.generated-api-canonical-csrf-header-guard" ||
  canonicalHeaderGuard?.status !== "pass" ||
  canonicalHeaderGuard?.canonicalHeaderName !== generatedApiCsrfContract.csrfHeaderName ||
  canonicalHeaderGuard?.canonicalHeaderValue !== generatedApiCsrfContract.csrfHeaderValue ||
  canonicalHeaderGuard?.callerAliasStripped !== true ||
  canonicalHeaderGuard?.safeRequestAliasesStripped !== true ||
  canonicalHeaderGuard?.unsafeRequestCanonicalHeaderCount !== 1 ||
  canonicalHeaderGuard?.safeRequestCanonicalHeaderCount !== 0 ||
  canonicalHeaderGuard?.failureCount !== 0 ||
  canonicalHeaderGuard?.unitTest !== "web/lib/request-security.test.ts" ||
  canonicalHeaderGuard?.generatedClientUnitTest !== "web/lib/generated/zenart-api.test.ts" ||
  !canonicalHeaderGuard?.rejectedCallerAliases?.includes("x-zenart-csrf") ||
  !canonicalHeaderGuard?.assertion?.includes("strips caller-supplied CSRF header aliases")
) {
  fail("generated API CSRF artifact missing canonical header alias stripping guard evidence");
}

if (
  routeCanonicalHeaderGuard?.schemaVersion !== canonicalHeaderGuard.schemaVersion ||
  routeCanonicalHeaderGuard?.expectedStatus !== canonicalHeaderGuard.status ||
  routeCanonicalHeaderGuard?.expectedCanonicalHeaderName !== canonicalHeaderGuard.canonicalHeaderName ||
  routeCanonicalHeaderGuard?.expectedCanonicalHeaderValue !== canonicalHeaderGuard.canonicalHeaderValue ||
  routeCanonicalHeaderGuard?.expectedCallerAliasStripped !== canonicalHeaderGuard.callerAliasStripped ||
  routeCanonicalHeaderGuard?.expectedSafeRequestAliasesStripped !== canonicalHeaderGuard.safeRequestAliasesStripped ||
  routeCanonicalHeaderGuard?.expectedUnsafeRequestCanonicalHeaderCount !== canonicalHeaderGuard.unsafeRequestCanonicalHeaderCount ||
  routeCanonicalHeaderGuard?.expectedSafeRequestCanonicalHeaderCount !== canonicalHeaderGuard.safeRequestCanonicalHeaderCount ||
  routeCanonicalHeaderGuard?.expectedFailureCount !== canonicalHeaderGuard.failureCount ||
  routeCanonicalHeaderGuard?.unitTest !== canonicalHeaderGuard.unitTest ||
  routeCanonicalHeaderGuard?.generatedClientUnitTest !== canonicalHeaderGuard.generatedClientUnitTest
) {
  fail("user route smoke canonical CSRF header guard drifted from generated API CSRF artifact");
}

if (
  generatedClientEvidence.safeOperationContractsAttribute !== "data-generated-api-csrf-safe-operation-contracts" ||
  !generatedClientEvidence.requiredAttributes?.includes("data-generated-api-csrf-safe-operation-contracts") ||
  !generatedApiCsrfContract.assertions?.includes(
    "Generated web API client exposes per-operation safe request contracts proving GET operations stay credentialed and CSRF-free."
  )
) {
  fail("generated-client route evidence must expose per-operation safe request contracts");
}

for (const expectedAssertion of [
  "Generated web API client strips caller-supplied CSRF header aliases before applying one canonical X-ZenArt-CSRF header.",
  "Generated web API client strips caller-supplied CSRF header aliases from safe requests."
]) {
  if (!generatedApiCsrfContract.assertions?.includes(expectedAssertion)) {
    fail(`generated API CSRF artifact missing canonical-header assertion ${expectedAssertion}`);
  }
}

for (const requiredCanonicalHeaderSnippet of [
  "stripCsrfHeaderAliases",
  "headerName.toLowerCase() !== contract.headerName.toLowerCase()",
  "const sanitizedHeaders = stripCsrfHeaderAliases(headers, contract)",
  "...sanitizedHeaders"
]) {
  if (!requestSecuritySource.includes(requiredCanonicalHeaderSnippet)) {
    fail(`request security contract missing canonical CSRF header stripping snippet ${requiredCanonicalHeaderSnippet}`);
  }
}

for (const requiredCanonicalHeaderTestSnippet of [
  "strips caller-supplied CSRF aliases before applying the canonical same-site header",
  "removes caller-supplied CSRF header aliases so fetch receives one canonical same-site header",
  "removes caller-supplied CSRF aliases from read-only requests",
  "records canonical CSRF header alias stripping in the generated evidence artifact",
  "callerAliasStripped: true",
  "safeRequestAliasesStripped: true"
]) {
  if (!generatedApiTestSource.includes(requiredCanonicalHeaderTestSnippet) && !requestSecurityTestSource.includes(requiredCanonicalHeaderTestSnippet)) {
    fail(`generated API CSRF unit evidence missing canonical header guard snippet ${requiredCanonicalHeaderTestSnippet}`);
  }
}

for (const requiredBrowserAssertion of generatedApiCsrfContract.browserSmoke?.requiredAssertions ?? []) {
  if (!sessionSecurityPlaywrightSpecSource.includes(requiredBrowserAssertion)) {
    fail(`generated API CSRF browser smoke missing required assertion ${requiredBrowserAssertion}`);
  }
}

for (const expectedBrowserRequestContract of expectedBrowserUnsafeRequestContracts) {
  if (!sessionSecurityPlaywrightSpecSource.includes(expectedBrowserRequestContract)) {
    fail(`generated API CSRF browser smoke missing unsafe request contract ${expectedBrowserRequestContract}`);
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
  "isCsrfProtectedMethod(operation.method)",
  "runGeneratedClientCsrfBrowserProbe",
  "new ZenArtApiClient(\"/api/probe\")",
  "data-generated-api-csrf-browser-probe",
  "data-generated-api-csrf-browser-probe-status",
  "data-generated-api-csrf-browser-probe-unsafe-csrf-header",
  "data-generated-api-csrf-browser-probe-unsafe-operation-count",
  "data-generated-api-csrf-browser-probe-unsafe-covered-operations",
  "data-generated-api-csrf-browser-probe-unsafe-credentialed-request-count",
  "data-generated-api-csrf-browser-probe-unsafe-csrf-header-count",
  "data-generated-api-csrf-browser-probe-unsafe-idempotency-required-count",
  "data-generated-api-csrf-browser-probe-unsafe-idempotency-header-count",
  "data-generated-api-csrf-browser-probe-unsafe-operation-contracts",
  "data-generated-api-csrf-browser-probe-safe-csrf-header",
  "data-generated-api-csrf-browser-probe-safe-operation-count",
  "data-generated-api-csrf-browser-probe-safe-covered-operations",
  "data-generated-api-csrf-browser-probe-safe-credentialed-request-count",
  "data-generated-api-csrf-browser-probe-safe-no-csrf-header-count",
  "data-generated-api-csrf-browser-probe-safe-operation-contracts",
  "data-generated-api-csrf-safe-operation-contracts",
  "data-csrf-ux-guard",
  "data-csrf-ux-guard-label",
  "data-csrf-ux-guard-status",
  "data-csrf-ux-guard-required-session-status",
  "data-csrf-ux-guard-blocked-reason",
  "data-csrf-ux-guard-contracts"
]) {
  if (!workspaceAppSource.includes(requiredControlSnippet)) {
    fail(`workspace UI missing control-level CSRF guard snippet ${requiredControlSnippet}`);
  }
}

for (const forbiddenUiCsrfShortcut of [
  "method === \"GET\" ? \"not-required\"",
  "method !== \"GET\""
]) {
  if (workspaceAppSource.includes(forbiddenUiCsrfShortcut)) {
    fail(`workspace UI must use the shared CSRF method predicate instead of ${forbiddenUiCsrfShortcut}`);
  }
}

if (
  sessionEvidence.unsafeActionGuard?.expectedGuardCoverageStatus !== "pass" ||
  sessionEvidence.unsafeActionGuard?.expectedMissingCsrfOperationCount !== "0" ||
  sessionEvidence.unsafeActionGuard?.expectedMissingCsrfOperations !== ""
) {
  fail("unsafe-action guard coverage must prove every generated unsafe operation is represented");
}

if (
  sessionEvidence.cookie?.expectedSameSiteAcceptedValues !== "lax,strict" ||
  sessionEvidence.cookie?.expectedSameSiteRejectedValues !== "none" ||
  sessionEvidence.cookie?.expectedSameSiteAcceptanceMatrix !== "lax:pass:none|strict:pass:none|none:fail:cookie-same-site" ||
  !requestSecuritySource.includes("serializeSetCookieContract") ||
  !workspaceAppSource.includes("data-session-cookie-set-cookie-contract") ||
  !workspaceAppSource.includes("data-session-cookie-domain") ||
  !workspaceAppSource.includes("data-session-cookie-host-only") ||
  !requestSecuritySource.includes("sameSiteAcceptanceMatrix") ||
  !workspaceAppSource.includes("data-session-cookie-same-site-accepted-values") ||
  !workspaceAppSource.includes("data-session-cookie-same-site-rejected-values") ||
  !workspaceAppSource.includes("data-session-cookie-same-site-acceptance-matrix")
) {
  fail("session evidence must expose the host-only secure-cookie invariant plus the lax/strict SameSite acceptance matrix and reject SameSite=None");
}

for (const requiredTestSnippet of [
  "renders secure-cookie and same-site CSRF session UX evidence as an interactive client contract",
  "blocks unsafe workspace actions when the same-site session is expired",
  "data-session-security-status",
  "data-session-cookie-set-cookie-contract",
  "data-session-cookie-domain",
  "data-session-cookie-host-only",
  "data-session-cookie-same-site-accepted-values",
  "data-session-cookie-same-site-rejected-values",
  "data-session-cookie-same-site-acceptance-matrix",
  "data-session-backend-runtime-pairing-digest",
  "data-session-unsafe-action-status",
  "data-session-unsafe-action-guard-coverage-status",
  "data-session-unsafe-action-blocked-control-count",
  "data-session-unsafe-action-blocked-control-labels",
  "data-session-unsafe-action-blocked-reason",
  "data-session-unsafe-action-missing-csrf-operation-count",
  "data-session-unsafe-action-operation-contracts",
  "data-csrf-ux-guard-contracts",
  "data-csrf-ux-guard-blocked-reason",
  "data-generated-api-csrf-operation-contracts",
  "data-generated-api-csrf-safe-operation-contracts",
  "data-generated-api-csrf-browser-probe",
  "Session expired. Refresh or sign in to continue.",
  "Save Settings"
]) {
  if (!workspaceSmokeTestSource.includes(requiredTestSnippet)) {
    fail(`workspace smoke test missing security assertion ${requiredTestSnippet}`);
  }
}

for (const requiredBrowserSnippet of [
  "account route exposes secure-cookie, same-site CSRF, unsafe-action guard, and generated-client request browser evidence",
  "data-session-security-evidence",
  "data-session-cookie-name",
  "data-session-cookie-http-only",
  "data-session-cookie-secure",
  "data-session-cookie-same-site",
  "data-session-cookie-domain",
  "data-session-cookie-host-only",
  "data-session-cookie-set-cookie-contract",
  "data-session-cookie-same-site-accepted-values",
  "data-session-cookie-same-site-rejected-values",
  "data-session-cookie-same-site-acceptance-matrix",
  "data-session-backend-runtime-pairing",
  "data-session-backend-runtime-pairing-status",
  "data-session-backend-runtime-pairing-digest",
  "data-session-backend-set-cookie-contract",
  "data-session-backend-csrf-validation-contract",
  "data-session-csrf-header",
  "data-session-csrf-origin-policy",
  "data-session-unsafe-action-operation-contracts",
  "data-session-unsafe-action-guard-coverage-status",
  "data-session-unsafe-action-blocked-control-count",
  "data-session-unsafe-action-blocked-control-labels",
  "data-session-unsafe-action-blocked-reason",
  "data-session-unsafe-action-missing-csrf-operation-count",
  "data-csrf-ux-guard-contracts",
  "data-csrf-ux-guard-status",
  "data-csrf-ux-guard-required-session-status",
  "data-csrf-ux-guard-blocked-reason",
  "data-generated-api-csrf-unsafe-operations",
  "data-generated-api-csrf-operation-contracts",
  "data-generated-api-csrf-safe-operation-contracts",
  "data-generated-api-csrf-browser-probe",
  "data-generated-api-csrf-browser-probe-status",
  "data-generated-api-csrf-browser-probe-unsafe-csrf-header",
  "data-generated-api-csrf-browser-probe-unsafe-operation-count",
  "data-generated-api-csrf-browser-probe-unsafe-covered-operations",
  "data-generated-api-csrf-browser-probe-unsafe-credentialed-request-count",
  "data-generated-api-csrf-browser-probe-unsafe-csrf-header-count",
  "data-generated-api-csrf-browser-probe-unsafe-idempotency-required-count",
  "data-generated-api-csrf-browser-probe-unsafe-idempotency-header-count",
  "data-generated-api-csrf-browser-probe-unsafe-operation-contracts",
  "data-generated-api-csrf-browser-probe-safe-csrf-header",
  "data-generated-api-csrf-browser-probe-safe-operation-count",
  "data-generated-api-csrf-browser-probe-safe-covered-operations",
  "data-generated-api-csrf-browser-probe-safe-credentialed-request-count",
  "data-generated-api-csrf-browser-probe-safe-no-csrf-header-count",
  "data-generated-api-csrf-browser-probe-safe-operation-contracts",
  "Session expired. Refresh or sign in to continue.",
  "Refresh Session",
  "Save Settings",
  "Sign In"
]) {
  if (!sessionSecurityPlaywrightSpecSource.includes(requiredBrowserSnippet)) {
    fail(`session security browser smoke missing assertion ${requiredBrowserSnippet}`);
  }
}

if (
  sessionEvidence.unsafeActionGuard?.expectedExpiredBlockedControlCount !== "17" ||
  sessionEvidence.unsafeActionGuard?.expectedExpiredRecoveryLabels !== "Refresh Session" ||
  !workspaceAppSource.includes("expiredSessionRecoveryActionLabels") ||
  !workspaceAppSource.includes("isExpiredSessionRecoveryAction") ||
  !workspaceAppSource.includes("generatedApiCsrfInventory.unsafeRequestContracts") ||
  !workspaceSmokeTestSource.includes("data-generated-api-csrf-browser-probe-unsafe-operation-count\", \"15\"") ||
  !workspaceSmokeTestSource.includes("data-generated-api-csrf-browser-probe-safe-operation-count\", \"17\"") ||
  !sessionSecurityPlaywrightSpecSource.includes("data-generated-api-csrf-browser-probe-unsafe-operation-count\", \"15\"") ||
  !sessionSecurityPlaywrightSpecSource.includes("data-generated-api-csrf-browser-probe-unsafe-credentialed-request-count\", \"15\"") ||
  !sessionSecurityPlaywrightSpecSource.includes("data-generated-api-csrf-browser-probe-unsafe-csrf-header-count\", \"15\"") ||
  !sessionSecurityPlaywrightSpecSource.includes("data-generated-api-csrf-browser-probe-unsafe-idempotency-header-count\", \"14\"") ||
  !sessionSecurityPlaywrightSpecSource.includes("data-generated-api-csrf-browser-probe-safe-operation-count\", \"17\"") ||
  !sessionSecurityPlaywrightSpecSource.includes("data-generated-api-csrf-browser-probe-safe-credentialed-request-count\", \"17\"") ||
  !sessionSecurityPlaywrightSpecSource.includes("data-generated-api-csrf-browser-probe-safe-no-csrf-header-count\", \"17\"") ||
  !workspaceSmokeTestSource.includes(expectedUiSafeRequestContracts[0]) ||
  !workspaceSmokeTestSource.includes(expectedUiSafeRequestContracts.at(-1)) ||
  !sessionSecurityPlaywrightSpecSource.includes(expectedUiSafeRequestContracts[0]) ||
  !sessionSecurityPlaywrightSpecSource.includes(expectedUiSafeRequestContracts.at(-1)) ||
  !sessionSecurityPlaywrightSpecSource.includes("getSubscription:GET:include:not-required") ||
  !sessionSecurityPlaywrightSpecSource.includes("csrf-probe-createSupportTicket") ||
  !workspaceSmokeTestSource.includes("data-session-unsafe-action-blocked-control-count\", \"17\"") ||
  !workspaceSmokeTestSource.includes("expect(screen.getByRole(\"button\", { name: \"Refresh Session\" })).not.toBeDisabled()") ||
  !sessionSecurityPlaywrightSpecSource.includes("data-session-unsafe-action-blocked-control-count\", \"17\"") ||
  !sessionSecurityPlaywrightSpecSource.includes("await expect(page.getByRole(\"button\", { name: \"Refresh Session\" })).toBeEnabled()")
) {
  fail("same-site UX contract must allow Refresh Session as the expired-session recovery action while blocking other unsafe controls");
}

console.log(
  `security contract smoke passed: ${unsafeOperations.length} unsafe operations require ${generatedApiCsrfContract.csrfHeaderName}; ${safeOperations.length} safe operations stay credentialed without CSRF headers; /account exposes secure-cookie same-site UX and browser evidence.`
);
