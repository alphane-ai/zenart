import { WorkspaceApp } from "@/components/workspace-app";
import { supportContactEmail } from "@/lib/legal-policies";

export default function SupportPage() {
  return (
    <>
      <section className="sr-only" aria-label="External support visibility summary">
        <h1>Report Problem</h1>
        <p>
          Contact {supportContactEmail}. Report Problem and Submit Ticket are available for support requests, privacy redaction,
          escalation, billing, export, and complaint help. The support contact is visible before paid launch.
        </p>
        <p>
          AI Content Responsibility: Local alpha previews use deterministic generation evidence unless a real provider is explicitly
          configured. Review rights, claims, likeness, and brand usage before sharing exported assets.
        </p>
        <p>
          The Acceptable Use Policy applies to support, exports, prompts, uploaded references, and generated candidates.
        </p>
        <p>
          Support SLA: severity, response time, and escalation handling are visible before paid launch. Billing policy support covers
          cancellation, refund, credit, quota reset, and past_due subscription questions.
        </p>
      </section>
      <WorkspaceApp initialView="support" />
    </>
  );
}
