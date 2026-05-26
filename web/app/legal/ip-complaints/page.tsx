import { LegalPolicyPage } from "@/components/legal-policy-page";
import { legalPolicies } from "@/lib/legal-policies";

export default function IpComplaintsPage() {
  return <LegalPolicyPage policy={legalPolicies["ip-complaints"]} />;
}
