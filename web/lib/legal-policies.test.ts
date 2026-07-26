import { describe, expect, it } from "vitest";
import { legalPolicies, legalPolicyList, supportContactEmail } from "./legal-policies";

describe("legal policy route contracts", () => {
  it("exposes required user-facing legal and support routes", () => {
    expect(legalPolicyList.map((policy) => policy.route)).toEqual([
      "/legal/terms",
      "/legal/privacy",
      "/legal/acceptable-use",
      "/legal/ip-complaints",
      "/legal/billing-policy"
    ]);
  });

  it("keeps visible support contact and local alpha billing limits in policy copy", () => {
    expect(supportContactEmail).toBe("support@zenari.ai");
    expect(legalPolicies.privacy.sections.map((section) => section.body).join(" ")).toContain("Client analytics capture");
    expect(legalPolicies["billing-policy"].sections.map((section) => section.body).join(" ")).toContain("mock checkout");
    expect(legalPolicies["ip-complaints"].contact).toBe("legal@zenari.ai");
  });
});
