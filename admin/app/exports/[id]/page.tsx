import { KeyValue } from "@/components/KeyValue";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getExportJob, getExportRegenerationRuntimeDecision } from "@/lib/admin-api";

export default async function ExportDetailPage({ params }: { params: { id: string } }) {
  const [job, runtimeDecision] = await Promise.all([
    getExportJob(params.id),
    getExportRegenerationRuntimeDecision(params.id)
  ]);

  return (
    <>
      <PageHeader
        title={`Export ${job.id}`}
        description="Export job detail with QA status, failure reason, and regenerate eligibility for support and operations."
        actions={
          <>
            <button className="button" type="button" disabled={!job.regenerateEligible || job.rbacDecision !== "allowed"}>
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
                ["Support ticket", <span key="ticket" className="mono">{job.supportTicketId}</span>],
                ["Requested role", job.requestedByRole],
                ["Required role", job.requiredRole],
                ["RBAC decision", <StatusBadge key="rbac" value={job.rbacDecision} label={job.rbacDecision} />],
                ["Quota effect", job.quotaEffect],
                ["Audit ref", <span key="audit" className="mono">{job.auditRef}</span>],
                ["Failure reason", job.failureReason]
              ]}
            />
          </div>
        </div>
        <div className="panel span-6">
          <div className="panel-header">
            <div>
              <h3>Regenerate Request</h3>
              <p>Regeneration requires support linkage, idempotency, RBAC, quota handling, and immutable audit evidence.</p>
            </div>
          </div>
          <div className="panel-body">
            <KeyValue
              items={[
                ["Idempotency key", <span key="idem" className="mono">{job.idempotencyKey}</span>],
                ["Mode", job.regenerationMode],
                ["Rationale", job.regenerationRationale],
                ["Closure evidence", job.closureEvidenceRefs.join(", ")],
                ["Operator runbook", job.operatorRunbook]
              ]}
            />
            <div className="form-row">
              <div className="field">
                <label htmlFor="reason">Reason</label>
                <input id="reason" defaultValue={job.regenerationRationale} />
              </div>
              <div className="field">
                <label htmlFor="ticket">Ticket</label>
                <input id="ticket" defaultValue={job.supportTicketId} />
              </div>
              <div className="field">
                <label htmlFor="mode">Mode</label>
                <select id="mode" defaultValue={job.regenerationMode}>
                  <option value="qa_preserving">QA preserving</option>
                  <option value="full_rebuild">Full rebuild</option>
                  <option value="not_allowed">Not allowed</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div className="panel span-12">
          <div className="panel-header">
            <div>
              <h3>Runtime Decision</h3>
              <p>Operator-visible submit readiness for this export regeneration request.</p>
            </div>
            <StatusBadge value={runtimeDecision.decision} label={runtimeDecision.decision} />
          </div>
          <div className="panel-body">
            <KeyValue
              items={[
                ["QA gate", <StatusBadge key="qa-gate" value={runtimeDecision.qaGate} label={runtimeDecision.qaGate} />],
                ["Audit status", <StatusBadge key="audit-status" value={runtimeDecision.auditStatus} label={runtimeDecision.auditStatus} />],
                ["Closure evidence status", <StatusBadge key="closure-status" value={runtimeDecision.closureEvidenceStatus} label={runtimeDecision.closureEvidenceStatus} />],
                ["Quota settlement", runtimeDecision.quotaSettlement],
                ["Blocker codes", runtimeDecision.blockerCodes.length ? runtimeDecision.blockerCodes.join(", ") : "None"],
                ["Submit disabled reason", runtimeDecision.submitDisabledReason],
                ["Operator action", runtimeDecision.operatorAction]
              ]}
            />
          </div>
        </div>
      </section>
    </>
  );
}
