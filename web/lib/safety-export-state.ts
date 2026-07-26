import { ExportRecord, SafetyExportStateEvidence, WorkspaceState } from "./contracts";

const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort();

const isAdminReviewFinding = (value: string) => /review|override|entitlement|subscription|quota/i.test(value);

export const blockedReasonsForExport = (record: ExportRecord) =>
  unique([
    record.status === "blocked" ? "export_status_blocked" : "",
    record.status === "failed" ? "export_status_failed" : "",
    ...record.qaReport
      .filter((finding) => finding.severity === "block")
      .map((finding) => `qa:${finding.id}`),
    ...record.safetyReport.findings.map((finding) => `safety:${finding.stage}:${finding.ruleId}`),
    record.safetyReport.status === "block" ? "safety_policy_block" : ""
  ]);

export const buildSafetyExportStateEvidence = (state: WorkspaceState): SafetyExportStateEvidence => {
  const exportRecords = state.exports;
  const blockedExports = exportRecords.filter((record) => record.status === "blocked");
  const latestExport = exportRecords[0];
  const qaBlockFindings = exportRecords.flatMap((record) =>
    record.qaReport.filter((finding) => finding.severity === "block")
  );
  const safetyBlockFindings = exportRecords.flatMap((record) => record.safetyReport.findings);
  const blockedReasons = unique(blockedExports.flatMap(blockedReasonsForExport));
  const latestBlockedReason = latestExport ? blockedReasonsForExport(latestExport)[0] ?? "" : "";
  const adminReviewRequiredCount = exportRecords.filter((record) =>
    [...blockedReasonsForExport(record), ...record.qaReport.map((finding) => finding.title), ...record.safetyReport.findings.map((finding) => finding.title)]
      .some(isAdminReviewFinding)
  ).length;

  return {
    schema_version: "stage1.safety-export-state-local-contract.v1",
    status: exportRecords.length > 0 ? "pass" : "empty",
    export_count: exportRecords.length,
    ready_export_count: exportRecords.filter((record) => record.status === "ready").length,
    blocked_export_count: blockedExports.length,
    failed_export_count: exportRecords.filter((record) => record.status === "failed").length,
    running_export_count: exportRecords.filter((record) => record.status === "running").length,
    qa_block_finding_count: qaBlockFindings.length,
    safety_block_finding_count: safetyBlockFindings.length,
    admin_review_required_count: adminReviewRequiredCount,
    blocked_download_cta_count: 0,
    blocked_share_cta_count: 0,
    downloadable_ready_export_count: exportRecords.filter((record) => record.status === "ready" && record.format === "zip").length,
    blocked_export_without_download_count: blockedExports.length,
    blocked_export_without_share_count: blockedExports.length,
    latest_export_id: latestExport?.id ?? "",
    latest_export_status: latestExport?.status ?? "none",
    latest_blocked_reason: latestBlockedReason,
    blocked_reasons: blockedReasons,
    raw_provider_payload_projected: false,
    raw_safety_payload_projected: false,
    secret_like_value_projected: false,
    can_clear_stage1_staging_runtime_gate: false
  };
};
