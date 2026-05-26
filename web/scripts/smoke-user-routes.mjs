import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const artifactPath = path.join(root, "validation", "user-routes-smoke.json");
const generatedApiCsrfContractPath = path.join(root, "validation", "generated-api-csrf-contract.json");
const appDir = path.join(root, "app");
const componentPath = path.join(root, "components", "workspace-app.tsx");
const layoutPath = path.join(root, "app", "layout.tsx");
const legalPoliciesPath = path.join(root, "lib", "legal-policies.ts");
const telemetryPath = path.join(root, "lib", "telemetry.ts");
const requestSecurityPath = path.join(root, "lib", "request-security.ts");
const generatedApiPath = path.join(root, "lib", "generated", "zenart-api.ts");

const fail = (message) => {
  console.error(`user route smoke failed: ${message}`);
  process.exit(1);
};

const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
const componentSource = await readFile(componentPath, "utf8");
const layoutSource = await readFile(layoutPath, "utf8");
const legalPoliciesSource = await readFile(legalPoliciesPath, "utf8");
const telemetrySource = await readFile(telemetryPath, "utf8");
const requestSecuritySource = await readFile(requestSecurityPath, "utf8");
const generatedApiSource = await readFile(generatedApiPath, "utf8");
const generatedApiCsrfContract = JSON.parse(await readFile(generatedApiCsrfContractPath, "utf8"));
const expectedViews = new Set(["workspace", "projects", "export", "billing", "account", "support"]);
const seenViews = new Set();

if (artifact.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("artifact must cite Docs/stage0_blueprint_rev2.md");
}

if (generatedApiCsrfContract.blueprintSource !== "Docs/stage0_blueprint_rev2.md") {
  fail("generated API CSRF contract must cite Docs/stage0_blueprint_rev2.md");
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
  "data-package-export-metadata-ui",
  "data-package-export-metadata-status",
  "data-package-export-required-output-count",
  "data-package-export-missing-output-count",
  "data-package-export-provenance-count",
  "data-package-export-blocking-qa-count",
  "data-package-export-ppt-slide-count",
  "data-package-export-zip-payloads",
  "reference-upload-export-contract",
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
  "reference-export-smoke",
  "data-reference-export-smoke",
  "data-reference-accepted-count",
  "data-reference-packaged-count",
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
  "csrf-operation-inventory",
  "Generated web API CSRF operation inventory",
  "data-csrf-operation-count",
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
  "reference-upload-zip-provenance-ppt-asset-grid",
  "ecommerce-growth-pack-api-smoke",
  "generated-api-unsafe-operation-csrf-inventory",
  "workspace-rendering-performance-budget",
  "zip-download-manifest-qa-provenance-assets",
  "zip-download-safety-policy-report",
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
  "dev-client-reference:ref-campaign-reference-webp",
  "layout: \"asset-grid\"",
  "safety-policy-report.json",
  "assets/square_social_ad.png",
  "workflow_id: ecommerceGrowthWorkflowAcceptance.workflow_id",
  "URL.createObjectURL"
]) {
  if (!exportDownloadTestSource.includes(expectedDownloadSmokeSnippet)) {
    fail(`reference upload ZIP integration smoke missing ${expectedDownloadSmokeSnippet}`);
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

const devStatePath = path.join(root, "lib", "dev-state.ts");
const devStateSource = await readFile(devStatePath, "utf8");
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
  "stage0.rev2.workflow-api-smoke",
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
