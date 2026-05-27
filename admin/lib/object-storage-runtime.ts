import type {
  StagingObjectStorageRetentionCleanupCoverage,
  StagingObjectStorageRetentionCleanupEvidence
} from "@/lib/types";

type ProbeResult = {
  method?: string;
  url?: string;
};

type RetentionCleanupReportCoverage = {
  area?: string;
  status?: string;
  runtime_probe?: string;
  evidence_refs?: string[];
  expected_tokens?: string[];
  source_results?: ProbeResult[];
};

type RetentionCleanupReport = {
  evidence_id?: string;
  environment?: string;
  status?: string;
  release_gate_check_id?: string;
  do_not_launch_condition_id?: string;
  split_evidence?: {
    signed_url_ready?: boolean;
    retention_cleanup_ready?: boolean;
  };
  coverage?: RetentionCleanupReportCoverage[];
  blocked_checks?: string[];
  gate_impact?: {
    can_clear_retention_cleanup_checklist_item?: boolean;
    can_clear_release_gate_check?: boolean;
    remaining_release_gate_blockers_after_pass?: string[];
  };
};

const requiredAreas = new Set([
  "retention_policy",
  "expired_export_cleanup",
  "orphan_cleanup",
  "audit_refs"
]);

const endpointByArea: Record<StagingObjectStorageRetentionCleanupCoverage["area"], string> = {
  retention_policy: "GET /api/admin/v1/object-storage/retention-policy",
  expired_export_cleanup: "POST /api/admin/v1/object-storage/cleanup/expired-exports",
  orphan_cleanup: "POST /api/admin/v1/object-storage/cleanup/orphans",
  audit_refs: "GET /api/admin/v1/audit?subject=object_storage_cleanup&limit=20"
};

function isRequiredArea(area: string | undefined): area is StagingObjectStorageRetentionCleanupCoverage["area"] {
  return area !== undefined && requiredAreas.has(area);
}

function reportIsPassing(report: RetentionCleanupReport) {
  const coverage = report.coverage ?? [];
  const passingAreas = new Set(
    coverage
      .filter((item) => isRequiredArea(item.area) && item.status === "pass")
      .map((item) => item.area)
  );

  return (
    report.environment === "staging" &&
    report.status === "pass" &&
    report.release_gate_check_id === "staging_object_storage_signed_downloads" &&
    report.do_not_launch_condition_id === "object_storage_signed_retention_runtime_missing" &&
    report.split_evidence?.signed_url_ready === true &&
    report.split_evidence.retention_cleanup_ready === true &&
    [...requiredAreas].every((area) => passingAreas.has(area))
  );
}

function buildCoverageFromReport(
  base: StagingObjectStorageRetentionCleanupEvidence,
  report: RetentionCleanupReport,
  passable: boolean
): StagingObjectStorageRetentionCleanupCoverage[] {
  const baseByArea = new Map(base.coverage.map((item) => [item.area, item]));
  const reportByArea = new Map(
    (report.coverage ?? [])
      .filter((item) => isRequiredArea(item.area))
      .map((item) => [item.area as StagingObjectStorageRetentionCleanupCoverage["area"], item])
  );

  return [...requiredAreas].map((area) => {
    const typedArea = area as StagingObjectStorageRetentionCleanupCoverage["area"];
    const baseCoverage = baseByArea.get(typedArea);
    const reportCoverage = reportByArea.get(typedArea);
    const firstResult = reportCoverage?.source_results?.[0];
    const method = firstResult?.method ?? endpointByArea[typedArea].split(" ")[0];
    const url = firstResult?.url ?? endpointByArea[typedArea].split(" ").slice(1).join(" ");

    return {
      area: typedArea,
      status: passable && reportCoverage?.status === "pass" ? "pass" : "blocked",
      smokeScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh",
      adminEndpoint: `${method} ${url}`,
      expectedTokens: reportCoverage?.expected_tokens ?? baseCoverage?.expectedTokens ?? [],
      blocker: passable
        ? "Staging runtime evidence passed for this retention/cleanup probe with release-SHA-bound admin audit context."
        : (report.blocked_checks ?? []).join(", ") || baseCoverage?.blocker || "Staging runtime evidence is not passing.",
      releaseGateUse:
        reportCoverage?.runtime_probe ??
        baseCoverage?.releaseGateUse ??
        "The object-storage release gate consumes exact staging retention cleanup runtime evidence.",
      evidenceRefs: [
        "ops/evidence/staging/object-storage-retention-cleanup.json",
        "scripts/staging_object_storage_retention_cleanup_smoke.sh",
        ...(reportCoverage?.evidence_refs ?? baseCoverage?.evidenceRefs ?? [])
      ].filter((value, index, values) => values.indexOf(value) === index)
    };
  });
}

export function buildStagingObjectStorageRetentionCleanupEvidence(
  base: StagingObjectStorageRetentionCleanupEvidence,
  report?: RetentionCleanupReport | null
): StagingObjectStorageRetentionCleanupEvidence {
  if (!report) {
    return base;
  }

  const passable = reportIsPassing(report);

  return {
    ...base,
    id: report.evidence_id ?? base.id,
    status: passable ? "pass" : "blocked",
    canClearRetentionCleanupChecklistItem:
      passable && report.gate_impact?.can_clear_retention_cleanup_checklist_item === true,
    canClearReleaseGateCheck: passable && report.gate_impact?.can_clear_release_gate_check === true,
    coverage: buildCoverageFromReport(base, report, passable),
    missingRuntimeInputs: passable ? [] : report.blocked_checks ?? base.missingRuntimeInputs,
    operatorAction: passable
      ? "Exact staging retention cleanup evidence is passing; update the private beta release gate fixture and checklist only with this artifact cited beside the signed URL evidence."
      : base.operatorAction,
    releaseGateUse: passable
      ? "This admin evidence row proves the exact staging retention cleanup artifact passed and can clear the object-storage release gate when paired with signed URL evidence."
      : base.releaseGateUse,
    remainingReleaseGateBlockers: passable
      ? report.gate_impact?.remaining_release_gate_blockers_after_pass ?? []
      : base.remainingReleaseGateBlockers
  };
}
