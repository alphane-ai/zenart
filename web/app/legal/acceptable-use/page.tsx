import { LegalPolicyPage } from "@/components/legal-policy-page";
import { legalPolicies } from "@/lib/legal-policies";

export default function AcceptableUsePage() {
  return <LegalPolicyPage policy={legalPolicies["acceptable-use"]} />;
}
