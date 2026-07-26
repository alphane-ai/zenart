import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { RbacOverrideAttemptDecisionTable } from "@/components/RbacOverrideAttemptDecisionTable";
import { RbacRuntimeDecisionTable } from "@/components/RbacRuntimeDecisionTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  cleanupExportsAction,
  createExportOverrideAction,
  regenerateExportAction
} from "@/app/exports/actions";
import {
  getAdminRbacEvidence,
  getAdminRbacOverrideAttemptDecisions,
  getAdminRbacRuntimeDecisions,
  getExportJobs,
  getExportRegenerationRuntimeDecisions
} from "@/lib/admin-api";
import type { AdminRbacEvidence, ExportJob, ExportRegenerationRuntimeDecision } from "@/lib/types";

function yesNo(value: boolean | undefined) {
  if (value === undefined) {
    return "Unknown";
  }

  return value ? "Yes" : "No";
}

function listText(values: string[] | undefined) {
  return values && values.length > 0 ? values.join(", ") : "None";
}

function firstExport(jobs: ExportJob[], predicate: (job: ExportJob) => boolean) {
  return jobs.find(predicate) ?? jobs[0];
}

export default async function ExportsPage({
  searchParams
}: {
  searchParams?: { export_ops?: string; export_id?: string; status?: string };
}) {
  const [jobs, runtimeDecisions, rbacEvidence, rbacRuntime, rbacAttemptDecisions] = await Promise.all([
    getExportJobs(),
    getExportRegenerationRuntimeDecisions(),
    getAdminRbacEvidence(),
    getAdminRbacRuntimeDecisions(),
    getAdminRbacOverrideAttemptDecisions()
  ]);
  const exportRbacEvidence = rbacEvidence.filter((item) => item.surface === "export_override");
  const exportRbacRuntime = rbacRuntime.filter((item) => item.surface === "export_override");
  const exportRbacAttemptDecisions = rbacAttemptDecisions.filter((item) => item.surface === "export_override");
  const liveAPIAvailable = jobs.some((row) => row.source === "api");
  const defaultRegenerate = firstExport(jobs, (job) => job.regenerateEligible && job.rbacDecision === "allowed");
  const defaultOverride = firstExport(jobs, (job) => job.status === "blocked" || job.qaSeverity === "blocking");
  const exportOpsMessage = searchParams?.export_ops;
  const exportOpsLabel = liveAPIAvailable ? "live api" : "fixture fallback";

  return (
    <>
      <PageHeader
        title="Export Operations"
        description="Export jobs, regeneration, override decisions, retention, signed URL, and cleanup controls for support and operations."
        actions={<StatusBadge value={liveAPIAvailable ? "available" : "configured"} label={exportOpsLabel} />}
      />
      {exportOpsMessage ? (
        <section className="panel" data-export-ops-result={exportOpsMessage}>
          <div className="panel-body">
            <strong>Export operation result:</strong>{" "}
            <span className="mono">
              {exportOpsMessage}
              {searchParams?.export_id ? `:${searchParams.export_id}` : ""}
              {searchParams?.status ? `:${searchParams.status}` : ""}
            </span>
          </div>
        </section>
      ) : null}
      <section
        className="panel"
        data-admin-endpoint="export-ops"
        data-export-ops-source={exportOpsLabel}
        data-generated-api-contract="listExports:GET:/exports:admin|regenerateExport:POST:/exports/{export_id}/regenerate:include:X-Zenari-CSRF:true:Idempotency-Key|required|createExportOverride:POST:/exports/{export_id}/override:include:X-Zenari-CSRF:true:Idempotency-Key|required|exports cleanup:POST:/exports/cleanup:include:X-Zenari-CSRF:true"
      >
        <div className="panel-header">
          <div>
            <h3>Export API Contract</h3>
            <p>listExports, regenerateExport, createExportOverride, and exports cleanup use admin cookies, X-Zenari-CSRF, and Idempotency-Key for state-changing requests.</p>
          </div>
          <StatusBadge value={liveAPIAvailable ? "available" : "configured"} label={exportOpsLabel} />
        </div>
        <div className="panel-body">
          <p className="mono">
            listExports | regenerateExport | createExportOverride | exports cleanup | X-Zenari-CSRF | Idempotency-Key
          </p>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Jobs</h3>
            <p>Final exports remain blocked when QA is blocking unless an eligible audited override exists. Signed URL and retention fields stay fail-closed in fixture fallback.</p>
          </div>
        </div>
        <DataTable<ExportJob>
          rows={jobs}
          columns={[
            { key: "id", header: "Export", render: (row) => <Link className="mono" href={`/exports/${row.id}`}>{row.id}</Link> },
            { key: "source", header: "Source", render: (row) => <StatusBadge value={row.source === "api" ? "available" : "configured"} label={row.source ?? "fixture"} /> },
            { key: "user", header: "User", render: (row) => row.userId },
            { key: "package", header: "Package", render: (row) => row.packageId },
            { key: "format", header: "Format", render: (row) => row.format ?? "zip" },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "qa", header: "QA", render: (row) => <StatusBadge value={row.qaSeverity === "blocking" ? "blocked" : row.qaSeverity} label={row.qaSeverity} /> },
            { key: "download", header: "Download", render: (row) => <StatusBadge value={row.downloadEnabled ? "available" : "blocked"} label={yesNo(row.downloadEnabled)} /> },
            { key: "signed-url", header: "Signed URL", render: (row) => row.signedUrlPresent ? `Present until ${row.downloadExpiresAt ?? "unknown"}` : "Absent" },
            { key: "retention", header: "Retention Until", render: (row) => row.retentionUntil ?? "Unknown" },
            { key: "blocked-reasons", header: "Blocked Reasons", render: (row) => listText(row.blockedReasons) },
            { key: "manifest", header: "Manifest", render: (row) => <StatusBadge value={row.manifestPresent ? "available" : "missing"} label={yesNo(row.manifestPresent)} /> },
            { key: "qa-report", header: "QA Report", render: (row) => <StatusBadge value={row.qaReportPresent ? "available" : "missing"} label={yesNo(row.qaReportPresent)} /> },
            { key: "provenance", header: "Provenance", render: (row) => <StatusBadge value={row.provenancePresent ? "available" : "missing"} label={yesNo(row.provenancePresent)} /> },
            { key: "trace", header: "Trace", render: (row) => <span className="mono">{row.traceId ?? "trace-required"}</span> },
            { key: "regen", header: "Regenerate", render: (row) => (row.regenerateEligible ? "Eligible" : "Not eligible") },
            { key: "rbac", header: "RBAC Decision", render: (row) => <StatusBadge value={row.rbacDecision} label={row.rbacDecision} /> },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "quota", header: "Quota Effect", render: (row) => row.quotaEffect },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "reason", header: "Reason", render: (row) => row.failureReason }
          ]}
        />
      </section>
      <section className="grid">
        <form className="panel span-4" action={regenerateExportAction} data-export-op-form="regenerateExport">
          <div className="panel-header">
            <div>
              <h3>Regenerate Export</h3>
              <p>Submits regenerateExport with support rationale, second review, X-Zenari-CSRF, and Idempotency-Key.</p>
            </div>
          </div>
          <div className="panel-body form-row">
            <div className="field">
              <label htmlFor="regenerate_export_id">Export</label>
              <select id="regenerate_export_id" name="export_id" defaultValue={defaultRegenerate?.id}>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.id}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="regenerate_second_reviewer_id">Second reviewer</label>
              <input id="regenerate_second_reviewer_id" name="second_reviewer_id" defaultValue="admin_reviewer_2" />
            </div>
            <div className="field">
              <label htmlFor="regenerate_second_reviewer_role">Second reviewer role</label>
              <select id="regenerate_second_reviewer_role" name="second_reviewer_role" defaultValue="admin_reviewer">
                <option value="admin_reviewer">admin_reviewer</option>
                <option value="admin_superadmin">admin_superadmin</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="regenerate_rationale">Rationale</label>
              <textarea id="regenerate_rationale" name="rationale" defaultValue={defaultRegenerate?.regenerationRationale ?? "Support-approved export regeneration after QA evidence review."} />
            </div>
            <div className="field">
              <label htmlFor="regenerate_second_review_rationale">Second-review rationale</label>
              <textarea id="regenerate_second_review_rationale" name="second_review_rationale" defaultValue="Second reviewer confirmed regeneration remains QA-preserving and auditable." />
            </div>
            <div className="field">
              <label>Submit</label>
              <button className="button" type="submit" disabled={!liveAPIAvailable}>Run Regeneration</button>
            </div>
          </div>
        </form>
        <form className="panel span-4" action={createExportOverrideAction} data-export-op-form="createExportOverride">
          <div className="panel-header">
            <div>
              <h3>Create Export Override</h3>
              <p>Records createExportOverride before any release gate can change; local contract keeps final_export_allowed fail-closed.</p>
            </div>
          </div>
          <div className="panel-body form-row">
            <div className="field">
              <label htmlFor="override_export_id">Export</label>
              <select id="override_export_id" name="export_id" defaultValue={defaultOverride?.id}>
                {jobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.id}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="override_source_type">Source type</label>
              <select id="override_source_type" name="source_type" defaultValue="qa_result">
                <option value="qa_result">qa_result</option>
                <option value="safety_decision">safety_decision</option>
                <option value="export_contract">export_contract</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="override_decision">Decision</label>
              <select id="override_decision" name="decision" defaultValue="denied">
                <option value="approved">approved</option>
                <option value="denied">denied</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="override_source_id">Source ID</label>
              <input id="override_source_id" name="source_id" defaultValue={defaultOverride?.objectMetadataId ?? "qa_result_required"} />
            </div>
            <div className="field">
              <label htmlFor="override_trace_id">Trace</label>
              <input id="override_trace_id" name="trace_id" defaultValue={defaultOverride?.traceId ?? "trace-required"} />
            </div>
            <div className="field">
              <label htmlFor="override_denial_reason">Denial reason</label>
              <select id="override_denial_reason" name="denial_reason" defaultValue="missing_approval_audit">
                <option value="">none</option>
                <option value="qa_blocking">qa_blocking</option>
                <option value="safety_blocking">safety_blocking</option>
                <option value="missing_provenance">missing_provenance</option>
                <option value="missing_approval_audit">missing_approval_audit</option>
                <option value="retention_policy_block">retention_policy_block</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="override_ticket_id">Ticket</label>
              <input id="override_ticket_id" name="ticket_id" defaultValue={defaultOverride?.supportTicketId ?? "support-required"} />
            </div>
            <div className="field">
              <label htmlFor="override_rationale">Rationale</label>
              <textarea id="override_rationale" name="rationale" defaultValue="Operator recorded export override decision after reviewing QA, safety, trace, retention, and audit evidence." />
            </div>
            <div className="field">
              <label>Submit</label>
              <button className="button" type="submit" disabled={!liveAPIAvailable}>Record Override</button>
            </div>
          </div>
        </form>
        <form className="panel span-4" action={cleanupExportsAction} data-export-op-form="exportsCleanup">
          <div className="panel-header">
            <div>
              <h3>Exports Cleanup</h3>
              <p>Runs exports cleanup for expired export objects and orphans; dry run remains the safe default.</p>
            </div>
          </div>
          <div className="panel-body form-row">
            <div className="field">
              <label htmlFor="cleanup_limit">Limit</label>
              <input id="cleanup_limit" name="limit" type="number" min="1" max="500" defaultValue="25" />
            </div>
            <div className="field">
              <label htmlFor="cleanup_second_reviewer_id">Second reviewer</label>
              <input id="cleanup_second_reviewer_id" name="second_reviewer_id" defaultValue="admin_operator_2" />
            </div>
            <div className="field">
              <label htmlFor="cleanup_second_reviewer_role">Second reviewer role</label>
              <select id="cleanup_second_reviewer_role" name="second_reviewer_role" defaultValue="admin_operator">
                <option value="admin_operator">admin_operator</option>
                <option value="admin_reviewer">admin_reviewer</option>
                <option value="admin_superadmin">admin_superadmin</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="cleanup_rationale">Rationale</label>
              <textarea id="cleanup_rationale" name="rationale" defaultValue="Retention cleanup reviewed for expired export objects and orphaned object metadata." />
            </div>
            <div className="field">
              <label htmlFor="cleanup_second_review_rationale">Second-review rationale</label>
              <textarea id="cleanup_second_review_rationale" name="second_review_rationale" defaultValue="Second reviewer confirmed cleanup scope and retention policy before execution." />
            </div>
            <div className="field">
              <label htmlFor="cleanup_dry_run">Dry run</label>
              <input id="cleanup_dry_run" name="dry_run" type="checkbox" defaultChecked />
              <button className="button" type="submit" disabled={!liveAPIAvailable}>Run Cleanup</button>
            </div>
          </div>
        </form>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Regeneration Runtime Decisions</h3>
            <p>Submit readiness is computed from QA gate, RBAC, support linkage, idempotency, quota settlement, closure evidence, and audit state.</p>
          </div>
        </div>
        <DataTable<ExportRegenerationRuntimeDecision>
          rows={runtimeDecisions}
          columns={[
            { key: "export", header: "Export", render: (row) => <Link className="mono" href={`/exports/${row.exportId}`}>{row.exportId}</Link> },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "qa", header: "QA Gate", render: (row) => <StatusBadge value={row.qaGate} label={row.qaGate} /> },
            { key: "audit", header: "Audit Status", render: (row) => <StatusBadge value={row.auditStatus} label={row.auditStatus} /> },
            { key: "closure", header: "Closure Evidence", render: (row) => <StatusBadge value={row.closureEvidenceStatus} label={row.closureEvidenceStatus} /> },
            { key: "role", header: "Requested / Required", render: (row) => `${row.requestedByRole} / ${row.requiredRole}` },
            { key: "rbac", header: "RBAC Decision", render: (row) => <StatusBadge value={row.rbacDecision} label={row.rbacDecision} /> },
            { key: "quota", header: "Quota Settlement", render: (row) => row.quotaSettlement },
            { key: "idempotency", header: "Idempotency Key", render: (row) => <span className="mono">{row.idempotencyKey}</span> },
            { key: "blockers", header: "Blocker Codes", render: (row) => row.blockerCodes.length ? row.blockerCodes.join(", ") : "None" },
            { key: "reason", header: "Submit Disabled Reason", render: (row) => row.submitDisabledReason },
            { key: "action", header: "Operator Action", render: (row) => row.operatorAction }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Export Override RBAC Evidence</h3>
            <p>Export release overrides must prove non-override eligibility, trace provenance, safety decisions, immutable audit, and release-gate preservation.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={exportRbacEvidence}
          columns={[
            { key: "id", header: "Evidence", render: (row) => <span className="mono">{row.id}</span> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "scope", header: "Override Scope", render: (row) => row.overrideScope },
            { key: "target", header: "Target", render: (row) => row.target },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => row.secondReviewStatus },
            { key: "api", header: "API Scope", render: (row) => <span className="mono">{row.apiScope}</span> },
            { key: "mutation", header: "Mutation Outcome", render: (row) => row.mutationOutcome },
            { key: "duration-policy", header: "Duration Policy", render: (row) => row.overrideDurationPolicy },
            { key: "starts", header: "Override Start", render: (row) => row.overrideStartedAt },
            { key: "expires", header: "Override Expiration", render: (row) => row.overrideExpiresAt },
            { key: "expiry", header: "Expiry Enforced", render: (row) => (row.expiryEnforced ? "Yes" : "No") },
            { key: "pre-state", header: "Pre-Override State", render: (row) => row.preOverrideState },
            { key: "expiry-action", header: "Expiry Action", render: (row) => row.expiryAction },
            { key: "stale-probe", header: "Stale Override Probe", render: (row) => row.staleOverrideProbe },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post", header: "Post Decision Control", render: (row) => row.postDecisionControl },
            { key: "release-required", header: "Release Evidence Required", render: (row) => row.releaseEvidenceRequired.join(", ") },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Export Override RBAC Runtime Decisions</h3>
            <p>Computed export release outcomes prove blocked final exports stay unavailable when the QA result is not override eligible.</p>
          </div>
        </div>
        <RbacRuntimeDecisionTable rows={exportRbacRuntime} />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Export Override RBAC Override Attempt Evidence</h3>
            <p>Request-level evidence proves final export override attempts preserve idempotency, state digest, expected HTTP outcome, audit, trace, safety, and QA blockers.</p>
          </div>
        </div>
        <RbacOverrideAttemptDecisionTable rows={exportRbacAttemptDecisions} />
      </section>
    </>
  );
}
