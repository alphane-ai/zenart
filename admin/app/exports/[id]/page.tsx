import { KeyValue } from "@/components/KeyValue";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getExportJob } from "@/lib/admin-api";

export default async function ExportDetailPage({ params }: { params: { id: string } }) {
  const job = await getExportJob(params.id);

  return (
    <>
      <PageHeader
        title={`Export ${job.id}`}
        description="Export job detail with QA status, failure reason, and regenerate eligibility for support and operations."
        actions={
          <>
            <button className="button" type="button">
              Regenerate
            </button>
            <button className="ghost-button" type="button">
              Attach audit rationale
            </button>
          </>
        }
      />
      <section className="grid">
        <div className="panel span-6">
          <div className="panel-header">
            <div>
              <h3>Job</h3>
              <p>Regeneration must preserve QA report generation and audit provenance.</p>
            </div>
            <StatusBadge value={job.status} />
          </div>
          <div className="panel-body">
            <KeyValue
              items={[
                ["User", job.userId],
                ["Package", job.packageId],
                ["QA severity", <StatusBadge key="qa" value={job.qaSeverity === "blocking" ? "blocked" : job.qaSeverity} label={job.qaSeverity} />],
                ["Regenerate", job.regenerateEligible ? "Eligible" : "Not eligible"],
                ["Failure reason", job.failureReason]
              ]}
            />
          </div>
        </div>
        <div className="panel span-6">
          <div className="panel-header">
            <div>
              <h3>Regenerate Request</h3>
              <p>Static control shape for the future backend mutation contract.</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="form-row">
              <div className="field">
                <label htmlFor="reason">Reason</label>
                <input id="reason" defaultValue="Retry failed package with full QA report" />
              </div>
              <div className="field">
                <label htmlFor="ticket">Ticket</label>
                <input id="ticket" defaultValue="sup-2201" />
              </div>
              <div className="field">
                <label htmlFor="mode">Mode</label>
                <select id="mode" defaultValue="qa-preserving">
                  <option value="qa-preserving">QA preserving</option>
                  <option value="full-rebuild">Full rebuild</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
