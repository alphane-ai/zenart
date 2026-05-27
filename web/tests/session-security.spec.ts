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
  await expect(sessionContract).toHaveAttribute("data-session-csrf-strategy", "same-site-origin-check");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-header", "X-ZenArt-CSRF");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-credential-mode", "include");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-origin-policy", "same-site-only");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-same-site-requirement", "lax-or-strict");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-missing-operation-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard", "authenticated-same-site-session");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "enabled");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-safe-labels", "load,login");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-protected-methods", "POST,PUT,PATCH,DELETE");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard-count", "18");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-operation-count", "18");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-csrf-protected-operation-count", "15");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard-coverage-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-missing-csrf-operation-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-missing-csrf-operations", "");
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

  const browserProbe = page.getByLabel("Generated API CSRF browser request probe");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe", "stage0.rev2.generated-api-csrf-browser-probe");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-status", "pass");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-operation", "updateAccount");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-method", "PATCH");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-credentials", "include");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-csrf-header", "same-site-origin-check");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-idempotency-key", "csrf-probe-update-account");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-operation", "getSession");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-method", "GET");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-credentials", "include");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-csrf-header", "not-required");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-failure-reason", "");

  const saveSettings = page.getByRole("button", { name: "Save Settings" });
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard", "authenticated-same-site-session");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-label", "Save Settings");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-status", "enabled");
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

  await page.getByRole("button", { name: "Expire" }).click();
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).toBeVisible();
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "blocked");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-status", "blocked");
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-status", "blocked");

  await page.getByRole("textbox", { name: "Email" }).fill("dev@zenart.local");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(sessionContract).toHaveAttribute("data-session-security-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "enabled");
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-status", "enabled");
});
