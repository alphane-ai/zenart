import { KeyValue } from "@/components/KeyValue";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getExportJob, getExportRegenerationRuntimeDecision } from "@/lib/admin-api";

function yesNo(value: boolean | undefined) {
  if (value === undefined) {
    return "Unknown";
  }

  return value ? "Yes" : "No";
}

function listText(values: string[] | undefined) {
  return values && values.length > 0 ? values.join(", ") : "None";
}

export default async function ExportDetailPage({ params }: { params: { id: string } }) {
  const [job, runtimeDecision] = await Promise.all([
    getExportJob(params.id),
    getExportRegenerationRuntimeDecision(params.id)
  ]);

  return (
    <>
      <PageHeader
        title={`Export ${job.id}`}
        description="Export job detail with QA status, signed URL, retention, provenance, failure reason, and regenerate eligibility for support and operations."
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
              <h3>Stage 1 Export Safety</h3>
              <p>Download, signed URL, retention, manifest, QA report, provenance, and trace projections must stay safe and tenant scoped.</p>
            </div>
            <StatusBadge value={job.finalExportAllowed ? "allowed" : "blocked"} label={job.finalExportAllowed ? "allowed" : "blocked"} />
          </div>
          <div className="panel-body">
            <KeyValue
              items={[
                ["Source", <StatusBadge key="source" value={job.source === "api" ? "available" : "configured"} label={job.source ?? "fixture"} />],
                ["Project", <span key="project" className="mono">{job.projectId ?? "unknown"}</span>],
                ["Task", <span key="task" className="mono">{job.taskId ?? "unknown"}</span>],
                ["Format", job.format ?? "zip"],
                ["Object metadata", <span key="object" className="mono">{job.objectMetadataId ?? "missing"}</span>],
                ["Download enabled", <StatusBadge key="download" value={job.downloadEnabled ? "available" : "blocked"} label={yesNo(job.downloadEnabled)} />],
                ["Signed URL", job.signedUrlPresent ? `Present until ${job.downloadExpiresAt ?? "unknown"}` : "Absent"],
                ["Retention until", job.retentionUntil ?? "Unknown"],
                ["Blocked reasons", listText(job.blockedReasons)],
                ["Manifest", <StatusBadge key="manifest" value={job.manifestPresent ? "available" : "missing"} label={yesNo(job.manifestPresent)} />],
                ["QA report", <StatusBadge key="qa-report" value={job.qaReportPresent ? "available" : "missing"} label={yesNo(job.qaReportPresent)} />],
                ["Provenance", <StatusBadge key="provenance" value={job.provenancePresent ? "available" : "missing"} label={yesNo(job.provenancePresent)} />],
                ["Trace", <span key="trace" className="mono">{job.traceId ?? "trace-required"}</span>]
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
