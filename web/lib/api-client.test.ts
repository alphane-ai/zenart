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
      category: "export",
      status: "open",
      linkedExportId: exported.exports[0]?.id,
      linkedQuotaSnapshot: {
        used: exported.billing.quotaUsed,
        limit: exported.billing.quotaLimit
      }
    });
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
