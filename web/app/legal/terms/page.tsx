import { LegalPolicyPage } from "@/components/legal-policy-page";
import { legalPolicies } from "@/lib/legal-policies";

export default function TermsPage() {
  return <LegalPolicyPage policy={legalPolicies.terms} />;
}
