import { beforeEach, describe, expect, it } from "vitest";
import { DevZenariClient } from "./api-client";
import { blockedReasonsForExport, buildSafetyExportStateEvidence } from "./safety-export-state";

describe("Stage 1 safety export state contract", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("summarizes blocked safety exports without projecting raw payloads", async () => {
    const client = new DevZenariClient();

    await client.confirmBrief("Campaign visual with phishing and secret key instructions.");
    await client.selectCandidate("cand-studio");
    await client.addPackageItem("cand-studio");

    const exported = await client.createExport("zip");
    const latestExport = exported.exports[0];
    const evidence = buildSafetyExportStateEvidence(exported);

    expect(latestExport.status).toBe("blocked");
    expect(blockedReasonsForExport(latestExport)).toEqual(
      expect.arrayContaining([
        "export_status_blocked",
        "safety:brief:safety-illegal-abuse-v1",
        "safety:brief:safety-private-data-v1",
        "safety_policy_block"
      ])
    );
    expect(evidence).toMatchObject({
      schema_version: "stage1.safety-export-state-local-contract.v1",
      status: "pass",
      export_count: 1,
      blocked_export_count: 1,
      qa_block_finding_count: 0,
      safety_block_finding_count: 4,
      blocked_download_cta_count: 0,
      blocked_share_cta_count: 0,
      blocked_export_without_download_count: 1,
      blocked_export_without_share_count: 1,
      latest_export_id: "export-001",
      latest_export_status: "blocked",
      latest_blocked_reason: "export_status_blocked",
      raw_provider_payload_projected: false,
      raw_safety_payload_projected: false,
      secret_like_value_projected: false,
      can_clear_stage1_staging_runtime_gate: false
    });
  });

  it("marks entitlement and quota blocked exports as requiring review without spending quota", async () => {
    const client = new DevZenariClient();

    await client.selectCandidate("cand-studio");
    await client.addPackageItem("cand-studio");
    const pastDue = await client.setBillingScenario("past_due");
    const exported = await client.createExport("zip");
    const evidence = buildSafetyExportStateEvidence(exported);

    expect(exported.exports[0]).toMatchObject({
      status: "blocked",
      qaReport: expect.arrayContaining([
        expect.objectContaining({
          id: "qa-entitlement",
          severity: "block"
        })
      ])
    });
    expect(exported.billing.quotaUsed).toBe(pastDue.billing.quotaUsed);
    expect(evidence).toMatchObject({
      blocked_export_count: 1,
      qa_block_finding_count: 1,
      safety_block_finding_count: 0,
      admin_review_required_count: 1,
      latest_blocked_reason: "export_status_blocked"
    });
    expect(evidence.blocked_reasons).toEqual(expect.arrayContaining(["qa:qa-entitlement"]));
  });
});
