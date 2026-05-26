import { LegalPolicyPage } from "@/components/legal-policy-page";
import { legalPolicies } from "@/lib/legal-policies";

export default function BillingPolicyPage() {
  return <LegalPolicyPage policy={legalPolicies["billing-policy"]} />;
}
