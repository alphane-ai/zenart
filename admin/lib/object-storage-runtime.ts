import type {
  StagingObjectStorageRetentionCleanupCoverage,
  StagingObjectStorageRetentionCleanupEvidence
} from "@/lib/types";

type ProbeResult = {
  method?: string;
  url?: string;
  request_id?: string;
  request_id_echoed?: boolean;
  response_bytes?: number;
};

type RetentionCleanupReportCoverage = {
  area?: string;
  status?: string;
  runtime_probe?: string;
  evidence_refs?: string[];
  expected_tokens?: string[];
  release_sha_bound?: boolean;
  admin_identity_bound?: boolean;
  response_bytes?: number;
  source_results?: ProbeResult[];
};

type RetentionCleanupReport = {
  evidence_id?: string;
  environment?: string;
  status?: string;
  results_path?: string;
  admin_user_id?: string;
  admin_tenant_id?: string;
  release_gate_check_id?: string;
  do_not_launch_condition_id?: string;
  split_evidence?: {
    signed_url_ready?: boolean;
    release_sha_matches_signed_url?: boolean;
    retention_cleanup_ready?: boolean;
    canonical_pass_paths?: boolean;
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

const canonicalPassReportPath = "ops/evidence/staging/object-storage-retention-cleanup.json";
const canonicalPassResultsPath = "ops/evidence/staging/object-storage-retention-cleanup.ndjson";

function isRequiredArea(area: string | undefined): area is StagingObjectStorageRetentionCleanupCoverage["area"] {
  return area !== undefined && requiredAreas.has(area);
}

function probeMatchesEndpoint(
  area: StagingObjectStorageRetentionCleanupCoverage["area"],
  result: ProbeResult
) {
  const [expectedMethod, expectedUrl] = endpointByArea[area].split(" ");
  if (result.method !== expectedMethod || result.url === undefined) {
    return false;
  }

  try {
    const parsedUrl = new URL(result.url, "https://staging.invalid");
    return `${parsedUrl.pathname}${parsedUrl.search}` === expectedUrl;
  } catch {
    return false;
  }
}

function reportIsPassing(report: RetentionCleanupReport) {
  const coverage = report.coverage ?? [];
  const passingAreas = new Set();
  const hasNoBlockedChecks = (report.blocked_checks ?? []).length === 0;
  const canClearGate =
    report.gate_impact?.can_clear_retention_cleanup_checklist_item === true &&
    report.gate_impact?.can_clear_release_gate_check === true &&
    (report.gate_impact.remaining_release_gate_blockers_after_pass ?? []).length === 0;

  for (const item of coverage) {
    if (!isRequiredArea(item.area) || item.status !== "pass") {
      continue;
    }

    const sourceResults = item.source_results ?? [];
    const hasRuntimeSource = sourceResults.length > 0;
    const everySourceEchoedRequestId = sourceResults.every(
      (result) => result.request_id_echoed === true && (result.request_id ?? "").length > 0
    );
    const everySourceMatchesEndpoint = sourceResults.every((result) =>
      probeMatchesEndpoint(item.area as StagingObjectStorageRetentionCleanupCoverage["area"], result)
    );
    const citesCanonicalReport = (item.evidence_refs ?? []).includes(canonicalPassReportPath);
    const responseBytes =
      item.response_bytes ??
      sourceResults.reduce((total, result) => total + (result.response_bytes ?? 0), 0);
    if (
      item.release_sha_bound === true &&
      item.admin_identity_bound === true &&
      hasRuntimeSource &&
      everySourceEchoedRequestId &&
      everySourceMatchesEndpoint &&
      citesCanonicalReport &&
      responseBytes > 0
    ) {
      passingAreas.add(item.area);
    }
  }

  return (
    report.environment === "staging" &&
    report.status === "pass" &&
    report.evidence_id === "object-storage-retention-cleanup" &&
    report.release_gate_check_id === "staging_object_storage_signed_downloads" &&
    report.do_not_launch_condition_id === "object_storage_signed_retention_runtime_missing" &&
    report.results_path === canonicalPassResultsPath &&
    report.split_evidence?.signed_url_ready === true &&
    report.split_evidence.release_sha_matches_signed_url === true &&
    report.split_evidence.retention_cleanup_ready === true &&
    report.split_evidence.canonical_pass_paths === true &&
    hasNoBlockedChecks &&
    canClearGate &&
    report.admin_user_id !== undefined &&
    report.admin_user_id.length > 0 &&
    report.admin_tenant_id !== undefined &&
    report.admin_tenant_id.length > 0 &&
    [...requiredAreas].every((area) => passingAreas.has(area))
  );
}

function reportKind(report: RetentionCleanupReport, passable: boolean) {
  if (passable) {
    return "canonical_pass";
  }

  if (report.status === "blocked") {
    return "blocked_probe";
  }

  return "rejected_report";
}

function observedReportPath(report: RetentionCleanupReport, passable: boolean) {
  if (passable || report.status === "pass") {
    return "ops/evidence/staging/object-storage-retention-cleanup.json";
  }

  if (report.status === "blocked") {
    return "ops/evidence/staging/object-storage-retention-cleanup.blocked.json";
  }

  return "unknown retention cleanup report";
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
    const responseBytes =
      reportCoverage?.response_bytes ??
      (reportCoverage?.source_results ?? []).reduce(
        (total, result) => total + (result.response_bytes ?? 0),
        0
      );
    const requestIdEchoStatus =
      reportCoverage?.source_results?.length
        ? reportCoverage.source_results.every(
            (result) => result.request_id_echoed === true && (result.request_id ?? "").length > 0
          )
          ? "echoed"
          : "missing"
        : baseCoverage?.requestIdEchoStatus ?? "not_evaluated";

    return {
      area: typedArea,
      status: passable && reportCoverage?.status === "pass" ? "pass" : "blocked",
      smokeScript: "scripts/staging_object_storage_retention_cleanup_smoke.sh",
      adminEndpoint: `${method} ${url}`,
      expectedTokens: reportCoverage?.expected_tokens ?? baseCoverage?.expectedTokens ?? [],
      releaseShaBound: passable && reportCoverage?.release_sha_bound === true,
      adminIdentityBound: passable && reportCoverage?.admin_identity_bound === true,
      requestIdEchoStatus,
      responseBytes,
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
    reportKind: reportKind(report, passable),
    observedReportPath: observedReportPath(report, passable),
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
