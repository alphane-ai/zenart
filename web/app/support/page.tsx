import { WorkspaceApp } from "@/components/workspace-app";
import { supportContactEmail } from "@/lib/legal-policies";

export default function SupportPage() {
  return (
    <>
      <main className="support-page" aria-label="External user support">
        <section className="support-hero">
          <span className="eyebrow">Visible Support Contact</span>
          <h1>Report Problem</h1>
          <p>
            Contact <a href={`mailto:${supportContactEmail}`}>{supportContactEmail}</a> for access, billing, privacy,
            export, quota, and incident help.
          </p>
        </section>

        <section className="support-public-grid" aria-label="Support and AI policy summary">
          <article>
            <h2>Submit Ticket</h2>
            <p>
              Submit Ticket from the support workspace to attach project, task, trace, asset, export, quota, and account
              context for operator review.
            </p>
          </article>
          <article>
            <h2>AI Content Responsibility</h2>
            <p>
              Local alpha previews use deterministic generation evidence unless a real provider is explicitly configured.
              Review rights, claims, likeness, brand usage, and the Acceptable Use Policy before sharing exports.
            </p>
          </article>
        </section>
      </main>
      <WorkspaceApp initialView="support" />
    </>
  );
}
