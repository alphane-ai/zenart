import { LegalPolicyPage } from "@/components/legal-policy-page";
import { legalPolicies } from "@/lib/legal-policies";

export default function PrivacyPolicyPage() {
  return <LegalPolicyPage policy={legalPolicies.privacy} />;
}
