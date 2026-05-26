import Link from "next/link";
import { ArrowLeft, LifeBuoy, Mail } from "lucide-react";
import { LegalPolicy, legalPolicyList, supportContactEmail } from "@/lib/legal-policies";
import { LegalPolicyTelemetry } from "@/components/legal-policy-telemetry";

export function LegalPolicyPage({ policy }: { policy: LegalPolicy }) {
  return (
    <main className="legal-page">
      <LegalPolicyTelemetry policyKey={policy.key} />
      <nav className="legal-nav" aria-label="Legal navigation">
        <Link className="secondary-button compact" href="/support">
          <ArrowLeft size={15} aria-hidden="true" />
          Support
        </Link>
        {legalPolicyList.map((item) => (
          <Link key={item.key} className={item.key === policy.key ? "legal-tab active" : "legal-tab"} href={item.route} aria-current={item.key === policy.key ? "page" : undefined}>
            {item.title}
          </Link>
        ))}
      </nav>

      <section className="legal-hero">
        <span className="eyebrow">ZenArt Stage 0</span>
        <h1>{policy.title}</h1>
        <p>{policy.summary}</p>
        <div className="legal-meta">
          <span>Last reviewed {policy.lastReviewed}</span>
          <a href={`mailto:${policy.contact}`}>
            <Mail size={15} aria-hidden="true" />
            {policy.contact}
          </a>
        </div>
      </section>

      <section className="legal-content" aria-label={`${policy.title} sections`}>
        {policy.sections.map((section) => (
          <article key={section.title} className="legal-section">
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>

      <section className="legal-support-callout" aria-label="Visible support contact">
        <LifeBuoy size={20} aria-hidden="true" />
        <div>
          <strong>Need account, privacy, billing, export, or complaint help?</strong>
          <span>
            Contact <a href={`mailto:${supportContactEmail}`}>{supportContactEmail}</a> or open the in-app support route.
          </span>
        </div>
      </section>
    </main>
  );
}
