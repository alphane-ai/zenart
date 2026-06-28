import { expect, test } from "@playwright/test";

const unsafeOperationIds = [
  "deleteSession",
  "updateAccount",
  "createProject",
  "updateProject",
  "createChatSession",
  "createChatMessage",
  "createBatchGeneration",
  "cancelBatchGeneration",
  "retryBatchGenerationChild",
  "createCandidateSet",
  "selectDirection",
  "createCanvasNode",
  "createCanvasVersion",
  "createUpload",
  "createAssetLibraryEntry",
  "updateAssetLibraryEntry",
  "createBrandKit",
  "updateBrandKit",
  "setProjectDefaultBrandKit",
  "createPackage",
  "createExport",
  "createShareLink",
  "createCheckoutSession",
  "createBillingPortalSession",
  "cancelSubscription",
  "acceptTeamInvite",
  "createSupportTicket"
] as const;

const expectedBrowserProbeRequestContracts = [
  "deleteSession:DELETE:include:same-site-origin-check:not-required",
  "updateAccount:PATCH:include:same-site-origin-check:csrf-probe-updateAccount",
  "createProject:POST:include:same-site-origin-check:csrf-probe-createProject",
  "updateProject:PATCH:include:same-site-origin-check:csrf-probe-updateProject",
  "createChatSession:POST:include:same-site-origin-check:csrf-probe-createChatSession",
  "createChatMessage:POST:include:same-site-origin-check:csrf-probe-createChatMessage",
  "createBatchGeneration:POST:include:same-site-origin-check:csrf-probe-createBatchGeneration",
  "cancelBatchGeneration:POST:include:same-site-origin-check:csrf-probe-cancelBatchGeneration",
  "retryBatchGenerationChild:POST:include:same-site-origin-check:csrf-probe-retryBatchGenerationChild",
  "createCandidateSet:POST:include:same-site-origin-check:csrf-probe-createCandidateSet",
  "selectDirection:PUT:include:same-site-origin-check:csrf-probe-selectDirection",
  "createCanvasNode:POST:include:same-site-origin-check:csrf-probe-createCanvasNode",
  "createCanvasVersion:POST:include:same-site-origin-check:csrf-probe-createCanvasVersion",
  "createUpload:POST:include:same-site-origin-check:csrf-probe-createUpload",
  "createAssetLibraryEntry:POST:include:same-site-origin-check:csrf-probe-createAssetLibraryEntry",
  "updateAssetLibraryEntry:PATCH:include:same-site-origin-check:csrf-probe-updateAssetLibraryEntry",
  "createBrandKit:POST:include:same-site-origin-check:csrf-probe-createBrandKit",
  "updateBrandKit:PATCH:include:same-site-origin-check:csrf-probe-updateBrandKit",
  "setProjectDefaultBrandKit:PUT:include:same-site-origin-check:csrf-probe-setProjectDefaultBrandKit",
  "createPackage:POST:include:same-site-origin-check:csrf-probe-createPackage",
  "createExport:POST:include:same-site-origin-check:csrf-probe-createExport",
  "createShareLink:POST:include:same-site-origin-check:csrf-probe-createShareLink",
  "createCheckoutSession:POST:include:same-site-origin-check:csrf-probe-createCheckoutSession",
  "createBillingPortalSession:POST:include:same-site-origin-check:csrf-probe-createBillingPortalSession",
  "cancelSubscription:POST:include:same-site-origin-check:csrf-probe-cancelSubscription",
  "acceptTeamInvite:POST:include:same-site-origin-check:csrf-probe-acceptTeamInvite",
  "createSupportTicket:POST:include:same-site-origin-check:csrf-probe-createSupportTicket"
] as const;

const expectedBrowserProbeUnsafePathContracts = [
  "deleteSession:/session:/session",
  "updateAccount:/account:/account",
  "createProject:/projects:/projects",
  "updateProject:/projects/{project_id}:/projects/project-001",
  "createChatSession:/projects/{project_id}/chat/sessions:/projects/project-001/chat/sessions",
  "createChatMessage:/chat/sessions/{chat_session_id}/messages:/chat/sessions/chat-001/messages",
  "createBatchGeneration:/projects/{project_id}/batch-generations:/projects/project-001/batch-generations",
  "cancelBatchGeneration:/batch-generations/{batch_id}/cancel:/batch-generations/batch-001/cancel",
  "retryBatchGenerationChild:/batch-generation-children/{child_id}/retry:/batch-generation-children/child-001/retry",
  "createCandidateSet:/projects/{project_id}/candidate-sets:/projects/project-001/candidate-sets",
  "selectDirection:/projects/{project_id}/selected-direction:/projects/project-001/selected-direction",
  "createCanvasNode:/workspaces/{workspace_id}/canvas/nodes:/workspaces/workspace-001/canvas/nodes",
  "createCanvasVersion:/workspaces/{workspace_id}/canvas/versions:/workspaces/workspace-001/canvas/versions",
  "createUpload:/uploads:/uploads",
  "createAssetLibraryEntry:/assets/library:/assets/library",
  "updateAssetLibraryEntry:/assets/library/{entry_id}:/assets/library/entry-001",
  "createBrandKit:/brand-kits:/brand-kits",
  "updateBrandKit:/brand-kits/{brand_kit_id}:/brand-kits/brand-kit-001",
  "setProjectDefaultBrandKit:/projects/{project_id}/brand-kit-default:/projects/project-001/brand-kit-default",
  "createPackage:/projects/{project_id}/packages:/projects/project-001/packages",
  "createExport:/packages/{package_id}/exports:/packages/pkg-001/exports",
  "createShareLink:/exports/{export_id}/share-links:/exports/export-001/share-links",
  "createCheckoutSession:/billing/checkout:/billing/checkout",
  "createBillingPortalSession:/billing/portal:/billing/portal",
  "cancelSubscription:/billing/subscription/cancel:/billing/subscription/cancel",
  "acceptTeamInvite:/teams/{team_id}/invites/{invite_id}/accept:/teams/team-001/invites/invite-001/accept",
  "createSupportTicket:/support/tickets:/support/tickets"
] as const;

const safeOperationIds = [
  "getSession",
  "getAccount",
  "listProjects",
  "getProject",
  "getWorkspace",
  "listChatMessages",
  "getTask",
  "getBatchGeneration",
  "listBatchGenerationChildren",
  "getBatchGenerationProgress",
  "listCandidateSets",
  "listCandidateAssets",
  "listCanvasNodes",
  "listCanvasFrames",
  "listCanvasVersions",
  "listAssets",
  "listAssetLibrary",
  "listBrandKits",
  "getProjectDefaultBrandKit",
  "listPackages",
  "getExport",
  "getQuota",
  "getSubscription",
  "listBillingInvoices",
  "getTeamSeatUsage",
  "checkTeamSeatEntitlement"
] as const;

const expectedBrowserProbeSafeRequestContracts = [
  "getSession:GET:include:not-required",
  "getAccount:GET:include:not-required",
  "listProjects:GET:include:not-required",
  "getProject:GET:include:not-required",
  "getWorkspace:GET:include:not-required",
  "listChatMessages:GET:include:not-required",
  "getTask:GET:include:not-required",
  "getBatchGeneration:GET:include:not-required",
  "listBatchGenerationChildren:GET:include:not-required",
  "getBatchGenerationProgress:GET:include:not-required",
  "listCandidateSets:GET:include:not-required",
  "listCandidateAssets:GET:include:not-required",
  "listCanvasNodes:GET:include:not-required",
  "listCanvasFrames:GET:include:not-required",
  "listCanvasVersions:GET:include:not-required",
  "listAssets:GET:include:not-required",
  "listAssetLibrary:GET:include:not-required",
  "listBrandKits:GET:include:not-required",
  "getProjectDefaultBrandKit:GET:include:not-required",
  "listPackages:GET:include:not-required",
  "getExport:GET:include:not-required",
  "getQuota:GET:include:not-required",
  "getSubscription:GET:include:not-required",
  "listBillingInvoices:GET:include:not-required",
  "getTeamSeatUsage:GET:include:not-required",
  "checkTeamSeatEntitlement:GET:include:not-required"
] as const;

const expectedBrowserProbeSafePathContracts = [
  "getSession:/session:/session",
  "getAccount:/account:/account",
  "listProjects:/projects:/projects",
  "getProject:/projects/{project_id}:/projects/project-001",
  "getWorkspace:/projects/{project_id}/workspace:/projects/project-001/workspace",
  "listChatMessages:/chat/sessions/{chat_session_id}/messages:/chat/sessions/chat-001/messages",
  "getTask:/tasks/{task_id}:/tasks/task-001",
  "getBatchGeneration:/batch-generations/{batch_id}:/batch-generations/batch-001",
  "listBatchGenerationChildren:/batch-generations/{batch_id}/children:/batch-generations/batch-001/children",
  "getBatchGenerationProgress:/batch-generations/{batch_id}/progress:/batch-generations/batch-001/progress",
  "listCandidateSets:/projects/{project_id}/candidate-sets:/projects/project-001/candidate-sets",
  "listCandidateAssets:/candidate-sets/{candidate_set_id}/assets:/candidate-sets/candidate-set-001/assets",
  "listCanvasNodes:/workspaces/{workspace_id}/canvas/nodes:/workspaces/workspace-001/canvas/nodes",
  "listCanvasFrames:/workspaces/{workspace_id}/canvas/frames:/workspaces/workspace-001/canvas/frames",
  "listCanvasVersions:/workspaces/{workspace_id}/canvas/versions:/workspaces/workspace-001/canvas/versions",
  "listAssets:/assets:/assets",
  "listAssetLibrary:/assets/library:/assets/library",
  "listBrandKits:/brand-kits:/brand-kits",
  "getProjectDefaultBrandKit:/projects/{project_id}/brand-kit-default:/projects/project-001/brand-kit-default",
  "listPackages:/projects/{project_id}/packages:/projects/project-001/packages",
  "getExport:/exports/{export_id}:/exports/export-001",
  "getQuota:/quota:/quota",
  "getSubscription:/billing/subscription:/billing/subscription",
  "listBillingInvoices:/billing/invoices:/billing/invoices",
  "getTeamSeatUsage:/teams/{team_id}/seat-usage:/teams/team-001/seat-usage",
  "checkTeamSeatEntitlement:/teams/{team_id}/seat-entitlement:/teams/team-001/seat-entitlement"
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
  await expect(sessionContract).toHaveAttribute("data-session-cookie-name", "__Host-zenari_session");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-http-only", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-secure", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-same-site", "lax");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-path", "/");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-domain", "");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-only", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-prefix", "__Host-");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-prefix-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-prefix-present", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-prefix-secure", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-prefix-path-root", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-prefix-host-only", "true");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-prefix-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-host-prefix-failure-reasons", "");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-set-cookie-contract", "__Host-zenari_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-same-site-accepted-values", "lax,strict");
  await expect(sessionContract).toHaveAttribute("data-session-cookie-same-site-rejected-values", "none");
  await expect(sessionContract).toHaveAttribute(
    "data-session-cookie-same-site-acceptance-matrix",
    "lax:pass:none|strict:pass:none|none:fail:cookie-same-site"
  );
  await expect(sessionContract).toHaveAttribute("data-session-csrf-strategy", "same-site-origin-check");
  await expect(sessionContract).toHaveAttribute("data-session-csrf-header", "X-Zenari-CSRF");
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
    /secure-cookie-same-site-csrf-runtime\|\|__Host-zenari_session;HttpOnly;Secure;SameSite=lax;Path=\/;HostOnly\|\|POST,PUT,PATCH,DELETE:X-Zenari-CSRF:same-site-origin-check:same-site-only:include:lax-or-strict/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-runtime-pairing-digest",
    /createUpload:POST:\/uploads:include:X-Zenari-CSRF:same-site-origin-check:true/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-runtime-pairing-digest",
    /missing=none\|\|cookie-failures=none\|\|csrf-failures=none/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-set-cookie-contract",
    "__Host-zenari_session;HttpOnly;Secure;SameSite=lax;Path=/;HostOnly"
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-backend-csrf-validation-contract",
    "POST,PUT,PATCH,DELETE:X-Zenari-CSRF:same-site-origin-check:same-site-only:include:lax-or-strict"
  );
  await expect(sessionContract).toHaveAttribute("data-session-backend-unsafe-request-contract-count", "27");
  await expect(sessionContract).toHaveAttribute("data-session-backend-missing-unsafe-operation-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-backend-cookie-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-backend-csrf-failure-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard", "authenticated-same-site-session");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "enabled");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-safe-labels", "load,login,asset-library-refresh");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-protected-methods", "POST,PUT,PATCH,DELETE");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard-count", "35");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-labels", "");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-reason", "");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-operation-count", "36");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-csrf-protected-operation-count", "27");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-guard-coverage-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-missing-csrf-operation-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-missing-csrf-operations", "");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-matrix", "stage0.rev2.csrf-same-site-session-state-ux-matrix");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-matrix-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-matrix-states", "authenticated,expired,signed_out");
  await expect(sessionContract).toHaveAttribute(
    "data-session-ux-state-matrix-contract",
    "authenticated:enabled=35:blocked=0:recovery=none:alert=none|expired:enabled=1:blocked=34:recovery=Refresh Session:alert=Session expired. Refresh or sign in to continue.|signed_out:enabled=0:blocked=35:recovery=none:alert=Signed out. Sign in to continue."
  );
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "authenticated");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-enabled-count", "35");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-blocked-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-recovery-labels", "");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-alert", "none");
  await expect(sessionContract).toHaveAttribute(
    "data-session-ux-transition-contract",
    "stage0.rev2.csrf-same-site-session-transition-ux"
  );
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-count", "5");
  await expect(sessionContract).toHaveAttribute(
    "data-session-ux-transition-digest",
    /authenticated->expired:Expire Session:enabled=1:blocked=34:recovery=Refresh Session/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-ux-transition-digest",
    /authenticated->signed_out:Log Out:enabled=0:blocked=35:recovery=none/
  );
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-expired-recovery-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-signed-out-block-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-required-recovery-action", "Refresh Session");
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-signed-out-blocked-count", "35");
  const guardedUnsafeOperations = await sessionContract.getAttribute("data-session-unsafe-action-generated-unsafe-operations");
  expect(guardedUnsafeOperations?.split(",")).toEqual(unsafeOperationIds);
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Confirm Brief=>createChatSession:POST:X-Zenari-CSRF:true\+createChatMessage:POST:X-Zenari-CSRF:true\+createCandidateSet:POST:X-Zenari-CSRF:true/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Create Project=>createProject:POST:X-Zenari-CSRF:true/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Rename Project=>updateProject:PATCH:X-Zenari-CSRF:true/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Refresh Invoices=>listBillingInvoices:GET:not-required:false/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Refresh Asset Library=>listAssetLibrary:GET:not-required:false\+listBrandKits:GET:not-required:false\+getProjectDefaultBrandKit:GET:not-required:false/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Expire Session=>deleteSession:DELETE:X-Zenari-CSRF:false/
  );
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-operation-contracts",
    /Log Out=>deleteSession:DELETE:X-Zenari-CSRF:false/
  );

  const generatedInventory = page.getByLabel("Generated web API CSRF operation inventory");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-contract", "stage0.rev2.generated-api-csrf-contract");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-status", "pass");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-credential-mode", "include");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-header", "X-Zenari-CSRF");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-header-value", "same-site-origin-check");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-origin-policy", "same-site-only");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-unsafe-operation-count", "27");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-safe-operation-count", "26");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-missing-unsafe-operation-count", "0");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-failure-count", "0");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-method-coverage", "stage0.rev2.generated-api-csrf-method-coverage");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-method-coverage-status", "pass");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-protected-method-coverage", "POST:covered|PUT:covered|PATCH:covered|DELETE:covered");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-safe-method-coverage", "GET:covered|HEAD:not-generated|OPTIONS:not-generated");
  await expect(generatedInventory).toHaveAttribute("data-generated-api-csrf-method-coverage-failure-count", "0");

  const unsafeOperations = await generatedInventory.getAttribute("data-generated-api-csrf-unsafe-operations");
  expect(unsafeOperations?.split(",")).toEqual(unsafeOperationIds);
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-operation-contracts",
    /createUpload:POST:include:X-Zenari-CSRF:true/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-operation-contracts",
    /deleteSession:DELETE:include:X-Zenari-CSRF:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /getSession:GET:include:not-required:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /getSubscription:GET:include:not-required:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /listBillingInvoices:GET:include:not-required:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /listAssetLibrary:GET:include:not-required:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /listBrandKits:GET:include:not-required:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /getProjectDefaultBrandKit:GET:include:not-required:false/
  );
  await expect(generatedInventory).toHaveAttribute(
    "data-generated-api-csrf-safe-operation-contracts",
    /checkTeamSeatEntitlement:GET:include:not-required:false/
  );

  const browserProbe = page.getByLabel("Generated API CSRF browser request probe");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe", "stage0.rev2.generated-api-csrf-browser-probe");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-status", "pass");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-base-url", "/api/probe");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-operation", "updateAccount");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-method", "PATCH");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-path", "/account");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-credentials", "include");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-csrf-header", "same-site-origin-check");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-idempotency-key", "csrf-probe-updateAccount");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-operation-count", "27");
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-covered-operations",
    "deleteSession,updateAccount,createProject,updateProject,createChatSession,createChatMessage,createBatchGeneration,cancelBatchGeneration,retryBatchGenerationChild,createCandidateSet,selectDirection,createCanvasNode,createCanvasVersion,createUpload,createAssetLibraryEntry,updateAssetLibraryEntry,createBrandKit,updateBrandKit,setProjectDefaultBrandKit,createPackage,createExport,createShareLink,createCheckoutSession,createBillingPortalSession,cancelSubscription,acceptTeamInvite,createSupportTicket"
  );
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-credentialed-request-count", "27");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-csrf-header-count", "27");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-idempotency-required-count", "26");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-unsafe-idempotency-header-count", "26");
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-operation-contracts",
    /createUpload:POST:include:same-site-origin-check:csrf-probe-createUpload/
  );
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-operation-contracts",
    /createSupportTicket:POST:include:same-site-origin-check:csrf-probe-createSupportTicket/
  );
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-path-contracts",
    /createExport:\/packages\/\{package_id\}\/exports:\/packages\/pkg-001\/exports/
  );
  const browserProbeRequestContracts = await browserProbe.getAttribute(
    "data-generated-api-csrf-browser-probe-unsafe-operation-contracts"
  );
  expect(browserProbeRequestContracts?.split("|")).toEqual(expectedBrowserProbeRequestContracts);
  const unsafeProbePathContracts = await browserProbe.getAttribute("data-generated-api-csrf-browser-probe-unsafe-path-contracts");
  expect(unsafeProbePathContracts?.split("|")).toEqual(expectedBrowserProbeUnsafePathContracts);
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-operation", "getSession");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-method", "GET");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-path", "/session");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-credentials", "include");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-csrf-header", "not-required");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-operation-count", "26");
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-safe-covered-operations",
    "getSession,getAccount,listProjects,getProject,getWorkspace,listChatMessages,getTask,getBatchGeneration,listBatchGenerationChildren,getBatchGenerationProgress,listCandidateSets,listCandidateAssets,listCanvasNodes,listCanvasFrames,listCanvasVersions,listAssets,listAssetLibrary,listBrandKits,getProjectDefaultBrandKit,listPackages,getExport,getQuota,getSubscription,listBillingInvoices,getTeamSeatUsage,checkTeamSeatEntitlement"
  );
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-credentialed-request-count", "26");
  await expect(browserProbe).toHaveAttribute("data-generated-api-csrf-browser-probe-safe-no-csrf-header-count", "26");
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-safe-operation-contracts",
    /getExport:GET:include:not-required/
  );
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-safe-operation-contracts",
    /getSubscription:GET:include:not-required/
  );
  await expect(browserProbe).toHaveAttribute(
    "data-generated-api-csrf-browser-probe-safe-path-contracts",
    /getWorkspace:\/projects\/\{project_id\}\/workspace:\/projects\/project-001\/workspace/
  );
  const safeProbeOperations = await browserProbe.getAttribute("data-generated-api-csrf-browser-probe-safe-covered-operations");
  expect(safeProbeOperations?.split(",")).toEqual(safeOperationIds);
  const safeProbeRequestContracts = await browserProbe.getAttribute("data-generated-api-csrf-browser-probe-safe-operation-contracts");
  expect(safeProbeRequestContracts?.split("|")).toEqual(expectedBrowserProbeSafeRequestContracts);
  const safeProbePathContracts = await browserProbe.getAttribute("data-generated-api-csrf-browser-probe-safe-path-contracts");
  expect(safeProbePathContracts?.split("|")).toEqual(expectedBrowserProbeSafePathContracts);
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
    "updateAccount:PATCH:/account:include:X-Zenari-CSRF:true"
  );
  await expect(saveSettings).toHaveAttribute(
    "data-csrf-ux-guard-session-matrix",
    "authenticated:enabled:none|expired:blocked:authenticated-session-required|signed_out:blocked:authenticated-session-required"
  );
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-session-matrix-status", "pass");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-current-session-state", "authenticated");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-csrf-protected-operation-count", "1");
  await expect(saveSettings).toHaveAttribute("data-csrf-ux-guard-idempotency-required-operation-count", "1");

  const refreshSession = page.getByRole("button", { name: "Refresh Session" });
  await expect(refreshSession).toHaveAttribute("data-csrf-ux-guard-label", "Refresh Session");
  await expect(refreshSession).toHaveAttribute("data-csrf-ux-guard-contracts", "getSession:GET:/session:include:not-required:false");
  await expect(refreshSession).toHaveAttribute(
    "data-csrf-ux-guard-session-matrix",
    "authenticated:enabled:none|expired:enabled:none|signed_out:blocked:authenticated-session-required"
  );
  await expect(refreshSession).toHaveAttribute("data-csrf-ux-guard-session-matrix-status", "pass");
  await expect(refreshSession).toHaveAttribute("data-csrf-ux-guard-current-session-state", "authenticated");
  await expect(refreshSession).toHaveAttribute("data-csrf-ux-guard-csrf-protected-operation-count", "0");

  const expireSession = page.getByRole("button", { name: "Expire" });
  await expect(expireSession).toHaveAttribute("data-csrf-ux-guard-label", "Expire Session");
  await expect(expireSession).toHaveAttribute("data-csrf-ux-guard-contracts", "deleteSession:DELETE:/session:include:X-Zenari-CSRF:false");

  const logOut = page.getByRole("button", { name: "Log Out" });
  await expect(logOut).toHaveAttribute("data-csrf-ux-guard-label", "Log Out");
  await expect(logOut).toHaveAttribute("data-csrf-ux-guard-contracts", "deleteSession:DELETE:/session:include:X-Zenari-CSRF:false");

  await page.getByRole("button", { name: "Expire" }).click();
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).toBeVisible();
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "blocked");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "34");
  await expect(sessionContract).toHaveAttribute(
    "data-session-unsafe-action-blocked-control-labels",
    "Confirm Brief|Attach|Create Batch|Cancel Batch|Retry Child|Create Project|Rename Project|Package Reference|Select Candidate|Iterate|Apply Edit Tool|Restore Version|Add Asset|Favorite Asset|Archive Asset|Create Brand Kit|Update Brand Kit|Set Brand Kit|Add Selection|Export ZIP|Export PDF|Request Share|Mock Checkout|Billing Portal|Cancel Subscription|Refresh Invoices|Refresh Team Seats|Refresh Asset Library|Accept Invite|Billing Scenario|Save Settings|Submit Ticket|Expire Session|Log Out"
  );
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-reason", "authenticated-session-required");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "expired");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-enabled-count", "1");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-blocked-count", "34");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-recovery-labels", "Refresh Session");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-alert", "Session expired. Refresh or sign in to continue.");
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-required-recovery-action", "Refresh Session");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-status", "enabled");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-blocked-reason", "");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-session-matrix-status", "pass");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-current-session-state", "expired");
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-status", "blocked");
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute(
    "data-csrf-ux-guard-blocked-reason",
    "authenticated-session-required"
  );
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-session-matrix-status", "pass");
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-current-session-state", "expired");
  await expect(page.getByRole("button", { name: "Log Out" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Log Out" })).toHaveAttribute("data-csrf-ux-guard-status", "blocked");

  await page.getByRole("button", { name: "Refresh Session" }).click();
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-status", "enabled");
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "authenticated");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-enabled-count", "35");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-blocked-count", "0");
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeEnabled();

  await page.getByRole("button", { name: "Expire" }).click();
  await expect(page.getByText("Session expired. Refresh or sign in to continue.")).toBeVisible();

  await page.getByRole("textbox", { name: "Email" }).fill("dev@zenari.ai");
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
  await expect(sessionContract).toHaveAttribute("data-session-unsafe-action-blocked-control-count", "35");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current", "signed_out");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-enabled-count", "0");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-blocked-count", "35");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-recovery-labels", "");
  await expect(sessionContract).toHaveAttribute("data-session-ux-state-current-alert", "Signed out. Sign in to continue.");
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-status", "pass");
  await expect(sessionContract).toHaveAttribute("data-session-ux-transition-signed-out-blocked-count", "35");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-status", "blocked");
  await expect(page.getByRole("button", { name: "Refresh Session" })).toHaveAttribute("data-csrf-ux-guard-current-session-state", "signed_out");
  await expect(page.getByRole("button", { name: "Save Settings" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save Settings" })).toHaveAttribute("data-csrf-ux-guard-current-session-state", "signed_out");
});

test("billing route exposes invoice receipt guard and product UI contract", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto("/billing?csrfProbe=1");
  await expect(page.getByRole("heading", { name: "Billing and Quota" })).toBeVisible();

  const refreshInvoices = page.getByRole("button", { name: "Refresh Invoices" });
  await expect(refreshInvoices).toHaveAttribute("data-csrf-ux-guard", "authenticated-same-site-session");
  await expect(refreshInvoices).toHaveAttribute("data-csrf-ux-guard-label", "Refresh Invoices");
  await expect(refreshInvoices).toHaveAttribute("data-csrf-ux-guard-operations", "listBillingInvoices");
  await expect(refreshInvoices).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "listBillingInvoices:GET:/billing/invoices:include:not-required:false"
  );
  await expect(refreshInvoices).toHaveAttribute("data-csrf-ux-guard-csrf-protected-operation-count", "0");
  await expect(refreshInvoices).toHaveAttribute("data-csrf-ux-guard-idempotency-required-operation-count", "0");

  const invoiceCard = page.locator("[data-billing-invoice-ui='stage1.invoice-receipt-product-ui']");
  await expect(invoiceCard).toHaveAttribute(
    "data-billing-invoice-contract",
    "listBillingInvoices:GET:/billing/invoices:include:not-required:false"
  );
  await expect(invoiceCard).toHaveAttribute("data-billing-invoice-sync-status", "local");
  const firstInvoice = invoiceCard.locator("[data-billing-invoice-row='in_test_local_alpha_001']");
  await expect(firstInvoice).toHaveAttribute("data-billing-invoice-provider", "stripe");
  await expect(firstInvoice).toHaveAttribute("data-billing-invoice-status", "paid");
  await expect(firstInvoice).toHaveAttribute("data-billing-invoice-has-invoice-url", "true");
  await expect(firstInvoice).toHaveAttribute("data-billing-invoice-has-receipt-url", "true");
  await expect(firstInvoice.getByRole("link", { name: "Invoice" })).toBeVisible();
  await expect(firstInvoice.getByRole("link", { name: "Receipt" })).toBeVisible();
});
