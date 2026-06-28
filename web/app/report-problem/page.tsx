import { WorkspaceApp } from "@/components/workspace-app";
import { supportContactEmail } from "@/lib/legal-policies";

export default function ReportProblemPage() {
  return (
    <>
      <section className="sr-only" aria-label="Report problem external support summary">
        <h1>Report Problem</h1>
        <p>
          Submit Ticket to send project, task, trace, export, quota, contact email, and billing context to {supportContactEmail}.
        </p>
        <p>
          Support tickets redact secrets, credentials, unrelated personal data, raw prompt text, uploaded assets, and provider payloads from
          external-user evidence.
        </p>
        <p>
          Report problem context supports privacy redaction, escalation, support SLA severity, response time review, cancellation, refund,
          credit, quota reset, and past_due billing policy questions.
        </p>
      </section>
      <WorkspaceApp initialView="support" />
    </>
  );
}
