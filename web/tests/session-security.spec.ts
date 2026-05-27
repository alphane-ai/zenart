import { expect, test } from "@playwright/test";

const unsafeOperationIds = [
  "deleteSession",
  "updateAccount",
  "createProject",
  "updateProject",
  "createChatSession",
  "createChatMessage",
  "createCandidateSet",
  "selectDirection",
  "createCanvasNode",
  "createCanvasVersion",
  "createUpload",
  "createPackage",
  "createExport",
  "createShareLink",
  "createSupportTicket"
] as const;

const expectedBrowserProbeRequestContracts = [
  "deleteSession:DELETE:include:same-site-origin-check:not-required",
  "updateAccount:PATCH:include:same-site-origin-check:csrf-probe-updateAccount",
  "createProject:POST:include:same-site-origin-check:csrf-probe-createProject",
  "updateProject:PATCH:include:same-site-origin-check:csrf-probe-updateProject",
  "createChatSession:POST:include:same-site-origin-check:csrf-probe-createChatSession",
  "createChatMessage:POST:include:same-site-origin-check:csrf-probe-createChatMessage",
  "createCandidateSet:POST:include:same-site-origin-check:csrf-probe-createCandidateSet",
  "selectDirection:PUT:include:same-site-origin-check:csrf-probe-selectDirection",
  "createCanvasNode:POST:include:same-site-origin-check:csrf-probe-createCanvasNode",
  "createCanvasVersion:POST:include:same-site-origin-check:csrf-probe-createCanvasVersion",
  "createUpload:POST:include:same-site-origin-check:csrf-probe-createUpload",
  "createPackage:POST:include:same-site-origin-check:csrf-probe-createPackage",
  "createExport:POST:include:same-site-origin-check:csrf-probe-createExport",
  "createShareLink:POST:include:same-site-origin-check:csrf-probe-createShareLink",
  "createSupportTicket:POST:include:same-site-origin-check:csrf-probe-createSupportTicket"
] as const;

const safeOperationIds = [
  "getSession",
  "getAccount",
  "listProjects",
  "getProject",
  "getWorkspace",
  "listChatMessages",
  "getTask",
  "listCandidateSets",
  "listCandidateAssets",
  "listCanvasNodes",
  "listCanvasFrames",
  "listCanvasVersions",
  "listAssets",
  "listPackages",
  "getExport",
  "getQuota",
  "getSubscription"
] as const;

const expectedBrowserProbeSafeRequestContracts = [
  "getSession:GET:include:not-required",
  "getAccount:GET:include:not-required",
  "listProjects:GET:include:not-required",
  "getProject:GET:include:not-required",
  "getWorkspace:GET:include:not-required",
  "listChatMessages:GET:include:not-required",
  "getTask:GET:include:not-required",
  "listCandidateSets:GET:include:not-required",
  "listCandidateAssets:GET:include:not-required",
  "listCanvasNodes:GET:include:not-required",
  "listCanvasFrames:GET:include:not-required",
  "listCanvasVersions:GET:include:not-required",
  "listAssets:GET:include:not-required",
  "listPackages:GET:include:not-required",
  "getExport:GET:include:not-required",
  "getQuota:GET:include:not-required",
  "getSubscription:GET:include:not-required"
] as const;

test("account route exposes secure-cookie, same-site CSRF, unsafe-action guard, and generated-client request browser evidence", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto("/account?csrfProbe=1");
  await expect(page.getByRole("heading", { name: "Account Settings" })).toBeVisible();

  const sessionContract = page.getByLabel("Auth and session status");
  await expect(sessionContract).toHaveAttribute("data-session-security-evidence", "stage0.rev2.session-csrf-client-evidence");
  await expect(sessionContract).toHaveAttribute("data-session-security-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-name", "__Host-zenart_session");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-http-only", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-secure", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-same-site", "lax");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-path", "/");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-domain", "");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-only", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-set-cookie-contract", "__Host-zenart_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-same-site-accepted-values", "lax,strict");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-same-site-rejected-values", "none");
  await expect(sessionContract).toHaveAttribute(
    "data-session-cookie-same-site-acceptance-matrix",
    "lax:pass:none|strict:pass:none|none:fail:cookie-same-site"
  );
  await expect(sessionContract).toHaveAttribute("data-session-csrf-strategy", "same-site-origin-check");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-header", "X-ZenArt-CSRF");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-credential-mode", "include");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-origin-policy", "same-site-only");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-same-site-requirement", "lax-or-strict");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-missing-operation-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-backend-runtime-pairing", "secure-cookie-same-site-csrf-runtime");
  await expect(sessionContract).toHaveAttribute("data-session-backend-runtime-pairing-status", "pass");
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-runtime-pairing-digest",
    /secure-cookie-same-site-csrf-runtime\|\|__Host-zenart_session;HttpOnly;Secure;SameSite=lax;Path=\/;HostOnly\|\|POST,PUT,PATCH,DELETE:X-ZenArt-CSRF:same-site-origin-check:same-site-only:include:lax-or-strict/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-runtime-pairing-digest",
    /createUpload:POST:\/uploads:include:X-ZenArt-CSRF:same-site-origin-check:true/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-runtime-pairing-digest",
    /missing=none\|\|cookie-failures=none\|\|csrf-failures=none/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-set-cookie-contract",
    "__Host-zenart_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly"
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-csrf-validation-contract",
    "POST,PUT,PATCH,DELETE:X-ZenArt-CSRF:same-site-origin-check:same-site-only:include:lax-or-strict"
  );
  await expect(sessionContract).toHaveAttribute("data-session-backend-unsafe-request-contract-count", "15");
  await expect(sessionContract).toHaveAttribute("data-session-backend-missing-unsafe-operation-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-backend-cookie-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-backend-csrf-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard", "authenticated-same-site-session");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "enabled");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-safe-labels", "load,login");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-protected-methods", "POST,PUT,PATCH,DELETE");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard-count", "19");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-labels", "");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-reason", "");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-operation-count", "18");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-csrf-protected-operation-count", "15");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard-coverage-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-missing-csrf-operation-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-missing-csrf-operations", "");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-matrix", "stage0.rev2.csrf-same-site-session-state-ux-matrix");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-matrix-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-matrix-states", "authenticated,expired,signed_out");
  await expect(sessionContract).toHaveAttribute(
    "data-session-ux-state-matrix-contract",
    "authenticated:enabled=19:blocked=0:recovery=none:alert=none|expired:enabled=1:blocked=18:recovery=Refresh Session:alert=Session expired. Refresh or sign in to continue.|signed_out:enabled=0:blocked=19:recovery=none:alert=Signed out. Sign in to continue."
  );
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "authenticated");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-enabled-count", "19");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-blocked-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-recovery-labels", "");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-alert", "none");
  const guardedUnsafeOperations = await sessionContract.getAttribute("data-session-unsafe-action-generated-unsafe-operations");
  expect(guardedUnsafeOperations?.split(",")).toEqual(unsafeOperationIds);
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Confirm Brief=>createChatSession:POST:X-ZenArt-CSRF:true\+createChatMessage:POST:X-ZenArt-CSRF:true\+createCandidateSet:POST:X-ZenArt-CSRF:true/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Create Project=>createProject:POST:X-ZenArt-CSRF:true/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Rename Project=>updateProject:PATCH:X-ZenArt-CSRF:true/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Expire Session=>deleteSession:DELETE:X-ZenArt-CSRF:false/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Log Out=>deleteSession:DELETE:X-ZenArt-CSRF:false/
  );

  const generatedInventory = page.getByLabel("Generated web API CSRF operation inventory");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-contract", "stage0.rev2.generated-api-csrf-contract");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-status", "pass");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-credential-mode", "include");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-header", "X-ZenArt-CSRF");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-header-value", "same-site-origin-check");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-origin-policy", "same-site-only");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-unsafe-operation-count", "15");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-safe-operation-count", "17");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-missing-unsafe-operation-count", "0");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-failure-count", "0");

  const unsafeOperations = await generatedInventory.getAttribute("data-generated-api-csrf-unsafe-operations");
  expect(unsafeOperations?.split(",")).toEqual(unsafeOperationIds);
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-operation-contracts",
    /createUpload:POST:include:X-ZenArt-CSRF:true/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-operation-contracts",
    /deleteSession:DELETE:include:X-ZenArt-CSRF:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /getSession:GET:include:not-required:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /getSubscription:GET:include:not-required:false/
  );

  const browserProbe = page.getByLabel("Generated API CSRF browser request probe");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe", "stage0.rev2.generated-api-csrf-browser-probe");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-status", "pass");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-operation", "updateAccount");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-method", "PATCH");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-credentials", "include");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-csrf-header", "same-site-origin-check");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-idempotency-key", "csrf-probe-updateAccount");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-operation-count", "15");
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-covered-operations",
    "deleteSession,updateAccount,createProject,updateProject,createChatSession,createChatMessage,createCandidateSet,selectDirection,createCanvasNode,createCanvasVersion,createUpload,createPackage,createExport,createShareLink,createSupportTicket"
  );
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-credentialed-request-count", "15");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-csrf-header-count", "15");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-idempotency-required-count", "14");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-idempotency-header-count", "14");
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-operation-contracts",
    /createUpload:POST:include:same-site-origin-check:csrf-probe-createUpload/
  );
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-operation-contracts",
    /createSupportTicket:POST:include:same-site-origin-check:csrf-probe-createSupportTicket/
  );
  const browserProbeRequestContracts = await browserProbe.getAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-operation-contracts"
  );
  expect(browserProbeRequestContracts?.split("|")).toEqual(expectedBrowserProbeRequestContracts);
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-operation", "getSession");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-method", "GET");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-credentials", "include");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-csrf-header", "not-required");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-operation-count", "17");
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-safe-covered-operations",
    "getSession,getAccount,listProjects,getProject,getWorkspace,listChatMessages,getTask,listCandidateSets,listCandidateAssets,listCanvasNodes,listCanvasFrames,listCanvasVersions,listAssets,listPackages,getExport,getQuota,getSubscription"
  );
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-credentialed-request-count", "17");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-no-csrf-header-count", "17");
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-safe-operation-contracts",
    /getExport:GET:include:not-required/
  );
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-safe-operation-contracts",
    /getSubscription:GET:include:not-required/
  );
  const safeProbeOperations = await browserProbe.getAttribute("data-generated-api-csrf-browser-probe-safe-covered-operations");
  expect(safeProbeOperations?.split(",")).toEqual(safeOperationIds);
  const safeProbeRequestContracts = await browserProbe.getAttribute("data-generated-api-csrf-browser-probe-safe-operation-contracts");
  expect(safeProbeRequestContracts?.split("|")).toEqual(expectedBrowserProbeSafeRequestContracts);
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-failure-reason", "");

  const saveSettings = page.getByRole("button", { name: "Save Settings" });
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard", "authenticated-same-site-session");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-label", "Save Settings");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-status", "enabled");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-required-session-status", "authenticated");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-blocked-reason", "");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-operations", "updateAccount");
  await expect(saveSettings).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "updateAccount:PATCH:/account:include:X-ZenArt-CSRF:true"
  );
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-csrf-protected-operation-count", "1");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-idempotency-required-operation-count", "1");

  const refreshSession = page.getByRole("button", { name: "Refresh Session" });
  await expect(refreshSession).toHaveAttribute("data-csrf-ux-guard-label", "Refresh Session");
  await expect(refreshSession).toHaveAttribute("data-csrf-ux-guard-contracts", "getSession:GET:/session:include:not-required:false");
  await expect(refreshSession).toHaveAttribute("data-csrf-ux-guard-csrf-protected-operation-count", "0");

  const expireSession = page.getByRole("button", { name: "Expire" });
  await expect(expireSession).toHaveAttribute("data-csrf-ux-guard-label", "Expire Session");
  await expect(expireSession).toHaveAttribute("data-csrf-ux-guard-contracts", "deleteSession:DELETE:/session:include:X-ZenArt-CSRF:false");

  const logOut = page.getByRole("button", { name: "Log Out" });
  await expect(logOut).toHaveAttribute("data-csrf-ux-guard-label", "Log Out");
  await expect(logOut).toHaveAttribute("data-csrf-ux-guard-contracts", "deleteSession:DELETE:/session:include:X-ZenArt-CSRF:false");

  await page.getByRole("button", { name: "Expire" }).click();
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).toBeVisible();
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "blocked");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "18");
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-blocked-control-labels",
    "Confirm Brief|Attach|Create Project|Rename Project|Package Reference|Select Candidate|Iterate|Restore Version|Add Selection|Export ZIP|Export PDF|Request Share|Mock Checkout|Billing Scenario|Save Settings|Submit Ticket|Expire Session|Log Out"
  );
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-reason", "authenticated-session-required");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "expired");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-enabled-count", "1");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-blocked-count", "18");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-recovery-labels", "Refresh Session");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-alert", "Session expired. Refresh or sign in to continue.");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-status", "enabled");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-blocked-reason", "");
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-status", "blocked");
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute(
    "data-csrf-ux-guard-blocked-reason",
    "authenticated-session-required"
  );
  await expect(page.getByRole("button", { name: "Log Out" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Log Out" })).toHaveAttribute("data-csrf-ux-guard-status", "blocked");

  await page.getByRole("button", { name: "Refresh Session" }).click();
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "enabled");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "authenticated");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-enabled-count", "19");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-blocked-count", "0");
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeEnabled();

  await page.getByRole("button", { name: "Expire" }).click();
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).toBeVisible();

  await page.getByRole("textbox", { name: "Email" }).fill("dev@zenart.local");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(sessionContract).toHaveAttribute("data-session-security-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "enabled");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "authenticated");
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-status", "enabled");
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-blocked-reason", "");

  await page.getByRole("button", { name: "Log Out" }).click();
  await expect(page.getByText("Signed out. Sign in to continue.")).toBeVisible();
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "blocked");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "19");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "signed_out");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-enabled-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-blocked-count", "19");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-recovery-labels", "");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-alert", "Signed out. Sign in to continue.");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeDisabled();
});
