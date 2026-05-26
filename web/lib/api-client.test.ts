import { beforeEach, describe, expect, it } from "vitest";
import { DevZenArtClient, workspaceStorageKey } from "./api-client";

const makeClient = () => new DevZenArtClient();

describe("dev web client user lifecycle coverage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists account settings across workspace reloads", async () => {
    const client = makeClient();
    const initial = await client.loadWorkspace();

    const saved = await client.updateAccount({
      ...initial.account,
      brandName: "Acme Launch Studio",
      defaultExportFormat: "pdf-placeholder",
      emailNotifications: false
    });
    const reloaded = await client.loadWorkspace();

    expect(saved.session.email).toBe("dev@zenart.local");
    expect(reloaded.account).toEqual({
      brandName: "Acme Launch Studio",
      defaultExportFormat: "pdf-placeholder",
      emailNotifications: false
    });
    expect(window.localStorage.getItem(workspaceStorageKey)).toContain("Acme Launch Studio");
  });

  it("runs login, refresh, expired-session handling, and logout states", async () => {
    const client = makeClient();

    const loggedIn = await client.login("member@example.com");
    const refreshed = await client.refreshSession();
    const expired = await client.expireSession();
    const refreshWhileExpired = await client.refreshSession();
    const signedOut = await client.logout();
    const reloaded = await client.loadWorkspace();

    expect(loggedIn.session).toMatchObject({
      email: "member@example.com",
      name: "member"
    });
    expect(loggedIn.sessionContract).toMatchObject({
      status: "authenticated",
      cookie: {
        httpOnly: true,
        secure: true,
        sameSite: "lax"
      },
      csrf: {
        strategy: "same-site-origin-check",
        headerName: "X-ZenArt-CSRF"
      }
    });
    expect(new Date(refreshed.sessionContract.issuedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(loggedIn.sessionContract.issuedAt).getTime()
    );
    expect(expired.sessionContract.status).toBe("expired");
    expect(refreshWhileExpired.sessionContract.status).toBe("expired");
    expect(signedOut.sessionContract.status).toBe("signed_out");
    expect(reloaded.sessionContract.status).toBe("signed_out");
  });

  it("autosaves project workspace selection, canvas versions, and package history", async () => {
    const client = makeClient();
    const initial = await client.loadWorkspace();

    const selected = await client.selectCandidate("cand-studio");
    const iterated = await client.iterateSelected("Make the production handoff states more explicit.");
    const packaged = await client.addPackageItem("cand-studio");
    const reloaded = await client.loadWorkspace();

    expect(selected.activeProjectId).toBe(initial.activeProjectId);
    expect(selected.selectedCandidateId).toBe("cand-studio");
    expect(iterated.canvas.nodes.some((node) => node.kind === "iteration")).toBe(true);
    expect(iterated.canvas.versions.at(-1)?.label).toBe("Canvas iteration");
    expect(packaged.packageItems).toHaveLength(1);
    expect(reloaded.selectedCandidateId).toBe("cand-studio");
    expect(reloaded.packageItems[0]).toMatchObject({
      sourceId: "cand-studio",
      title: "Studio System",
      type: "candidate"
    });
  });

  it("records report-problem tickets with project, export, and quota context", async () => {
    const client = makeClient();
    await client.attachReference({ name: "product-angle.webp", kind: "image" });
    await client.selectCandidate("cand-utility");
    await client.addPackageItem("cand-utility");
    const exported = await client.createExport("zip");

    const ticketed = await client.reportProblem({
      category: "export",
      body: "The downloaded package is missing the social crop.",
      linkedExportId: exported.exports[0]?.id
    });

    expect(ticketed.supportTickets).toHaveLength(1);
    expect(ticketed.supportTickets[0]).toMatchObject({
      id: "ticket-001",
      projectId: ticketed.activeProjectId,
      projectName: "Launch Direction Board",
      category: "export",
      status: "open",
      linkedExportId: exported.exports[0]?.id,
      linkedTaskId: "task-cand-utility",
      linkedTraceId: `trace-${exported.exports[0]?.id}`,
      linkedAssetIds: ["ref-001", "ref-product-angle-webp"],
      linkedQuotaSnapshot: {
        used: exported.billing.quotaUsed,
        limit: exported.billing.quotaLimit,
        remaining: exported.billing.quotaLimit - exported.billing.quotaUsed,
        status: exported.billing.status,
        resetAt: exported.billing.resetAt
      }
    });
  });

  it("validates reference uploads and keeps rejected assets visible but not support-linked", async () => {
    const client = makeClient();

    const rejected = await client.attachReference({ name: "campaign.exe", kind: "image" });
    const acceptedUrl = await client.attachReference({ name: "https://example.com/brief", kind: "url" });
    const ticketed = await client.reportProblem({
      category: "quality",
      body: "Reference validation should be visible.",
      linkedExportId: undefined
    });

    expect(rejected.brief.references.at(-1)).toMatchObject({
      name: "campaign.exe",
      status: "queued",
      validation: {
        state: "rejected",
        reason: "Images must be PNG, JPG, JPEG, or WEBP files."
      }
    });
    expect(acceptedUrl.brief.references.at(-1)).toMatchObject({
      name: "https://example.com/brief",
      status: "attached",
      validation: {
        state: "accepted"
      }
    });
    expect(ticketed.supportTickets[0].linkedAssetIds).toEqual(["ref-001", "ref-https-example-com-brief"]);
  });

  it("models billing quota states without charging blocked exports", async () => {
    const client = makeClient();
    const initial = await client.loadWorkspace();

    const blockedExport = await client.createExport("zip");
    const checkedOut = await client.createMockCheckout();

    expect(blockedExport.exports[0]).toMatchObject({
      status: "blocked",
      fileName: "zenart-001.zip"
    });
    expect(blockedExport.billing.quotaUsed).toBe(initial.billing.quotaUsed);
    expect(checkedOut.billing).toMatchObject({
      status: "active",
      quotaLimit: 80,
      renewalMode: "mock-checkout"
    });
  });

  it("blocks quota-consuming exports for inactive, past-due, and exhausted billing states", async () => {
    const client = makeClient();
    await client.selectCandidate("cand-studio");
    await client.addPackageItem("cand-studio");

    const pastDue = await client.setBillingScenario("past_due");
    const pastDueExport = await client.createExport("zip");
    const exhausted = await client.setBillingScenario("quota_exhausted");
    const exhaustedExport = await client.createExport("pdf-placeholder");

    expect(pastDueExport.exports[0]).toMatchObject({
      status: "blocked",
      qaReport: expect.arrayContaining([
        expect.objectContaining({
          id: "qa-entitlement",
          title: "Subscription action required"
        })
      ])
    });
    expect(pastDueExport.billing.quotaUsed).toBe(pastDue.billing.quotaUsed);
    expect(exhaustedExport.exports[0]).toMatchObject({
      status: "blocked",
      qaReport: expect.arrayContaining([
        expect.objectContaining({
          id: "qa-entitlement",
          title: "Quota exhausted"
        })
      ])
    });
    expect(exhaustedExport.billing.quotaUsed).toBe(exhausted.billing.quotaUsed);
  });

  it("can reset the persisted dev workspace for isolated smoke runs", async () => {
    const client = makeClient();
    await client.updateAccount({
      brandName: "Temporary Brand",
      defaultExportFormat: "zip",
      emailNotifications: true
    });

    client.resetWorkspace();
    const reset = await client.loadWorkspace();

    expect(reset.account.brandName).toBe("Northstar Studio");
    expect(window.localStorage.getItem(workspaceStorageKey)).toContain("Northstar Studio");
  });
});
