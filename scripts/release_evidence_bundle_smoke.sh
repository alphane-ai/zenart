#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-ops/evidence/release/staging}"
DRY_RUN="${DRY_RUN:-1}"
STAGING_OUT_DIR="$(mktemp -d)"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${RUN_ID:-${STAMP}-release-evidence-bundle-$$}"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
STAGING_REPORT_PATH="$OUT_DIR/${RUN_ID}.staging-smoke.json"
STAGING_RESULTS_PATH="$OUT_DIR/${RUN_ID}.staging-smoke.ndjson"
OBJECT_RETENTION_REPORT_PATH="$OUT_DIR/${RUN_ID}.object-storage-retention-cleanup.json"
OBJECT_RETENTION_RESULTS_PATH="$OUT_DIR/${RUN_ID}.object-storage-retention-cleanup.ndjson"
LEGAL_SUPPORT_REPORT_PATH="$OUT_DIR/${RUN_ID}.legal-support-visibility.json"
LEGAL_SUPPORT_RESULTS_PATH="$OUT_DIR/${RUN_ID}.legal-support-visibility.ndjson"
LEGAL_PAGES_REPORT_PATH="$OUT_DIR/${RUN_ID}.legal-pages-external-user.json"
SUPPORT_CONTACT_REPORT_PATH="$OUT_DIR/${RUN_ID}.support-contact-external-user.json"
CANONICAL_LEGAL_PAGES_REPORT_PATH="${CANONICAL_LEGAL_PAGES_REPORT_PATH:-ops/evidence/staging/legal-pages-external-user.json}"
CANONICAL_SUPPORT_CONTACT_REPORT_PATH="${CANONICAL_SUPPORT_CONTACT_REPORT_PATH:-ops/evidence/staging/support-contact-external-user.json}"
CANONICAL_OBJECT_RETENTION_REPORT_PATH="${CANONICAL_OBJECT_RETENTION_REPORT_PATH:-ops/evidence/staging/object-storage-retention-cleanup.json}"
CI_INSTALLED_WORKFLOW_PATH="${CI_INSTALLED_WORKFLOW_PATH:-.github/workflows/stage0-rev2-ci.yml}"
CI_PR_MAIN_RUN_EVIDENCE="${CI_PR_MAIN_RUN_EVIDENCE:-ops/evidence/ci/stage0-rev2-pr-main-run.json}"
CI_PLAYWRIGHT_SMOKE_EVIDENCE="${CI_PLAYWRIGHT_SMOKE_EVIDENCE:-ops/evidence/ci/stage0-rev2-playwright-smoke.json}"
CI_DOCKER_IMAGE_BUILD_EVIDENCE="${CI_DOCKER_IMAGE_BUILD_EVIDENCE:-ops/evidence/ci/stage0-rev2-docker-image-build.json}"
PRODUCTION_BACKUP_ROLLBACK_SPLIT_PREFLIGHT="${PRODUCTION_BACKUP_ROLLBACK_SPLIT_PREFLIGHT:-ops/evidence/production/backup-rollback-split.blocked.json}"

mkdir -p "$OUT_DIR"
cleanup() {
  rm -rf "$STAGING_OUT_DIR"
}
trap cleanup EXIT

set +e
DRY_RUN="$DRY_RUN" \
  OUT_DIR="$STAGING_OUT_DIR" \
  BASE_URL="${BASE_URL:-}" \
  WEB_URL="${WEB_URL:-}" \
  ADMIN_URL="${ADMIN_URL:-}" \
  STAGING_SMOKE_PROFILE="${STAGING_SMOKE_PROFILE:-post_deploy}" \
  TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}" \
  REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}" \
  REQUEST_ID_VALUE="${REQUEST_ID_VALUE:-stage0-staging-smoke}" \
  RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}" \
  RELEASE_TAG="${RELEASE_TAG:-}" \
  RELEASE_NOTES_PATH="${RELEASE_NOTES_PATH:-}" \
  IMAGE_REFS="${IMAGE_REFS:-}" \
  MIGRATION_EVIDENCE="${MIGRATION_EVIDENCE:-}" \
  CONFIG_DIFF_EVIDENCE="${CONFIG_DIFF_EVIDENCE:-}" \
  OBSERVABILITY_EVIDENCE="${OBSERVABILITY_EVIDENCE:-}" \
  BACKUP_RESTORE_EVIDENCE="${BACKUP_RESTORE_EVIDENCE:-}" \
  LOAD_EVIDENCE="${LOAD_EVIDENCE:-}" \
  ROLLBACK_EVIDENCE="${ROLLBACK_EVIDENCE:-}" \
  SECURITY_SCAN_EVIDENCE="${SECURITY_SCAN_EVIDENCE:-}" \
  SMOKE_USER_ID="${SMOKE_USER_ID:-}" \
  SMOKE_TENANT_ID="${SMOKE_TENANT_ID:-}" \
  SMOKE_ADMIN_USER_ID="${SMOKE_ADMIN_USER_ID:-${SMOKE_USER_ID:-}}" \
  SMOKE_ADMIN_TENANT_ID="${SMOKE_ADMIN_TENANT_ID:-${SMOKE_TENANT_ID:-}}" \
  SMOKE_ADMIN_ROLES="${SMOKE_ADMIN_ROLES:-admin}" \
  SMOKE_TASK_ID="${SMOKE_TASK_ID:-}" \
  SMOKE_PACKAGE_ID="${SMOKE_PACKAGE_ID:-}" \
  SMOKE_EXPORT_ID="${SMOKE_EXPORT_ID:-}" \
  RUN_ID="${RUN_ID}.staging-smoke" \
  scripts/staging_smoke.sh >/dev/null
status=$?
set -e

set +e
DRY_RUN="$DRY_RUN" \
  OUT_DIR="$OUT_DIR" \
  REPORT_PATH="$OBJECT_RETENTION_REPORT_PATH" \
  RESULTS_PATH="$OBJECT_RETENTION_RESULTS_PATH" \
  BASE_URL="${BASE_URL:-}" \
  STAGING_BASE_URL="${STAGING_BASE_URL:-}" \
  TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}" \
  REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}" \
  REQUEST_ID_VALUE="${REQUEST_ID_VALUE:-stage0-object-retention-cleanup}" \
  RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}" \
  SIGNED_URL_EVIDENCE="${SIGNED_URL_EVIDENCE:-ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json}" \
  RETENTION_POLICY_URL="${RETENTION_POLICY_URL:-}" \
  EXPIRED_EXPORT_CLEANUP_URL="${EXPIRED_EXPORT_CLEANUP_URL:-}" \
  ORPHAN_CLEANUP_URL="${ORPHAN_CLEANUP_URL:-}" \
  AUDIT_REFS_URL="${AUDIT_REFS_URL:-}" \
  ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN:-${STAGING_ADMIN_BEARER_TOKEN:-}}" \
  ADMIN_SESSION_COOKIE="${ADMIN_SESSION_COOKIE:-${STAGING_ADMIN_SESSION_COOKIE:-}}" \
  SMOKE_ADMIN_USER_ID="${SMOKE_ADMIN_USER_ID:-${SMOKE_USER_ID:-}}" \
  SMOKE_ADMIN_TENANT_ID="${SMOKE_ADMIN_TENANT_ID:-${SMOKE_TENANT_ID:-}}" \
  RUN_ID="${RUN_ID}.object-storage-retention-cleanup" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_status=$?
set -e

set +e
DRY_RUN="$DRY_RUN" \
  OUT_DIR="$OUT_DIR" \
  WEB_URL="${WEB_URL:-${STAGING_WEB_URL:-}}" \
  TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}" \
  RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}" \
  LEGAL_PAGES_REPORT_PATH="$LEGAL_PAGES_REPORT_PATH" \
  SUPPORT_CONTACT_REPORT_PATH="$SUPPORT_CONTACT_REPORT_PATH" \
  RUN_ID="${RUN_ID}.legal-support-visibility" \
  scripts/staging_legal_support_visibility_smoke.sh >/dev/null
legal_support_status=$?
set -e

staging_report="$(find "$STAGING_OUT_DIR" -maxdepth 1 -type f -name '*.json' | sort | tail -n 1)"
if [[ -z "$staging_report" ]]; then
  printf 'staging smoke did not produce a report\n' >&2
  exit 1
fi

python3 - "$staging_report" "$STAGING_REPORT_PATH" "$STAGING_RESULTS_PATH" <<'PY'
import json
import sys
from pathlib import Path

source_report_path = Path(sys.argv[1])
target_report_path = Path(sys.argv[2])
target_results_path = Path(sys.argv[3])
target_report_path.parent.mkdir(parents=True, exist_ok=True)

report = json.loads(source_report_path.read_text(encoding="utf-8"))
source_results = Path(str(report.get("results_path", "")))
if source_results.exists() and source_results.is_file():
    rewritten_lines = []
    for line in source_results.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        if isinstance(item.get("evidence_refs"), list):
            item["evidence_refs"] = [
                str(target_results_path) if ref == str(source_results) else ref
                for ref in item["evidence_refs"]
            ]
        rewritten_lines.append(json.dumps(item, sort_keys=True))
    target_results_path.write_text("\n".join(rewritten_lines) + ("\n" if rewritten_lines else ""), encoding="utf-8")
    report["results_path"] = str(target_results_path)

if "summary" in report:
    go_no_go = report.get("summary", {}).get("go_no_go", {})
    post_deploy = go_no_go.get("post_deploy_smoke_evidence", {})
    if isinstance(post_deploy, dict) and Path(str(post_deploy.get("report_path", ""))).name == source_report_path.name:
        post_deploy["report_path"] = str(target_report_path)
    summary_post_deploy = report.get("summary", {}).get("post_deploy_smoke_evidence", {})
    if (
        isinstance(summary_post_deploy, dict)
        and Path(str(summary_post_deploy.get("report_path", ""))).name == source_report_path.name
    ):
        summary_post_deploy["report_path"] = str(target_report_path)
    local_verification = (
        report.get("summary", {})
        .get("release_evidence", {})
        .get("local_evidence_verification", {})
    )
    if isinstance(local_verification, dict):
        for verifier in local_verification.values():
            if isinstance(verifier, dict) and Path(str(verifier.get("path", ""))).name == source_report_path.name:
                verifier["path"] = str(target_report_path)
report["created_at"] = target_report_path.stem
target_report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

python3 - "$REPORT_PATH" "$STAGING_REPORT_PATH" "$status" "$OBJECT_RETENTION_REPORT_PATH" "$object_retention_status" "$LEGAL_SUPPORT_REPORT_PATH" "$legal_support_status" "$LEGAL_PAGES_REPORT_PATH" "$SUPPORT_CONTACT_REPORT_PATH" "$CANONICAL_LEGAL_PAGES_REPORT_PATH" "$CANONICAL_SUPPORT_CONTACT_REPORT_PATH" "$CANONICAL_OBJECT_RETENTION_REPORT_PATH" "$CI_INSTALLED_WORKFLOW_PATH" "$CI_PR_MAIN_RUN_EVIDENCE" "$CI_PLAYWRIGHT_SMOKE_EVIDENCE" "$CI_DOCKER_IMAGE_BUILD_EVIDENCE" "$PRODUCTION_BACKUP_ROLLBACK_SPLIT_PREFLIGHT" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
staging_report_path = Path(sys.argv[2])
staging_exit_code = int(sys.argv[3])
object_retention_report_path = Path(sys.argv[4])
object_retention_exit_code = int(sys.argv[5])
legal_support_report_path = Path(sys.argv[6])
legal_support_exit_code = int(sys.argv[7])
legal_pages_report_path = Path(sys.argv[8])
support_contact_report_path = Path(sys.argv[9])
canonical_legal_pages_report_path = Path(sys.argv[10])
canonical_support_contact_report_path = Path(sys.argv[11])
canonical_object_retention_report_path = Path(sys.argv[12])
ci_installed_workflow_path = Path(sys.argv[13])
ci_pr_main_run_evidence = Path(sys.argv[14])
ci_playwright_smoke_evidence = Path(sys.argv[15])
ci_docker_image_build_evidence = Path(sys.argv[16])
production_backup_rollback_split_preflight_path = Path(sys.argv[17])
staging = json.loads(staging_report_path.read_text(encoding="utf-8"))
summary = staging.get("summary", {})
release_evidence = summary.get("release_evidence", {})
go_no_go = summary.get("go_no_go", {})
verification = release_evidence.get("local_evidence_verification", {})


def path_exists(path: Path) -> bool:
    return path.exists()


def ci_closure_artifacts() -> list[dict]:
    artifacts = [
        ("ci_installed_workflow", ci_installed_workflow_path, "installed PR/main workflow"),
        ("ci_pr_main_run", ci_pr_main_run_evidence, "PR/main workflow run evidence"),
        ("ci_playwright_smoke", ci_playwright_smoke_evidence, "CI Playwright smoke evidence"),
        ("ci_docker_image_build", ci_docker_image_build_evidence, "CI Docker image build evidence"),
    ]
    return [
        {
            "artifact_id": artifact_id,
            "label": label,
            "path": str(path),
            "exists": path_exists(path),
            "required_before_ci_gate_closure": True,
        }
        for artifact_id, path, label in artifacts
    ]


def production_split_preflight_summary(path: Path) -> dict:
    if not path.exists():
        return {
            "path": str(path),
            "exists": False,
            "status": "missing",
            "release_gate_check_id": "production_backup_rollback_incident",
            "passed": False,
            "blocked_checks": ["production_backup_rollback_split_preflight_missing"],
            "exact_split_files_ready": False,
            "upstream_ci_gate_status": "unknown",
            "upstream_private_beta_staging_gate_status": "unknown",
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    split = data.get("split_evidence", {})
    upstream = data.get("upstream_gates", {})
    backup = split.get("backup_restore", {}) if isinstance(split, dict) else {}
    rollback = (
        split.get("rollback_incident_post_deploy_smoke", {})
        if isinstance(split, dict)
        else {}
    )
    ci = upstream.get("ci", {}) if isinstance(upstream, dict) else {}
    private_beta = upstream.get("private_beta_staging", {}) if isinstance(upstream, dict) else {}
    return {
        "path": str(path),
        "exists": True,
        "schema_version": data.get("schema_version"),
        "environment": data.get("environment"),
        "kind": data.get("kind"),
        "status": data.get("status", "unknown"),
        "release_gate_check_id": data.get("release_gate_check_id"),
        "passed": data.get("status") in {"pass", "passed"},
        "blocked_checks": data.get("blocked_checks", []),
        "do_not_launch_condition_ids": data.get("do_not_launch_condition_ids", []),
        "exact_split_files_ready": split.get("all_exact_split_files_ready") is True
        if isinstance(split, dict)
        else False,
        "backup_restore_split": {
            "path": backup.get("path", "ops/evidence/production/backup-restore.json"),
            "exists": backup.get("exists") is True,
            "status": backup.get("status", "missing"),
            "passed": backup.get("passed") is True,
            "missing_requirements": backup.get("missing_requirements", []),
        },
        "rollback_incident_post_deploy_split": {
            "path": rollback.get(
                "path",
                "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
            ),
            "exists": rollback.get("exists") is True,
            "status": rollback.get("status", "missing"),
            "passed": rollback.get("passed") is True,
            "missing_requirements": rollback.get("missing_requirements", []),
        },
        "upstream_ci_gate_status": ci.get("gate_decision_status", "missing"),
        "upstream_private_beta_staging_gate_status": private_beta.get(
            "gate_decision_status",
            "missing",
        ),
    }


def load_probe(path: Path, exit_code: int) -> dict:
    if not path.exists():
        return {
            "path": str(path),
            "exit_code": exit_code,
            "exists": False,
            "status": "missing",
            "passed": False,
            "blocked_checks": ["probe_did_not_write_report"],
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    probe_status = data.get("status", "unknown")
    return {
        "path": str(path),
        "exit_code": exit_code,
        "exists": True,
        "results_path": data.get("results_path", str(path.with_suffix(".ndjson"))),
        "kind": data.get("kind"),
        "environment": data.get("environment"),
        "release_gate_check_id": data.get("release_gate_check_id"),
        "status": probe_status,
        "passed": exit_code == 0 and probe_status in {"pass", "passed"},
        "blocked_checks": data.get("blocked_checks", []),
        "required_checks": data.get("required_checks", []),
        "runtime_input_requirements": data.get("runtime_input_requirements", {}),
        "input_readiness": data.get("input_readiness", {}),
        "split_evidence": data.get("split_evidence", {}),
        "gate_impact": data.get("gate_impact", {}),
    }


def load_split_probe(path: Path, *, expected_kind: str, expected_check_id: str) -> dict:
    if not path.exists():
        return {
            "path": str(path),
            "exists": False,
            "status": "missing",
            "passed": False,
            "kind": None,
            "environment": None,
            "release_gate_check_id": None,
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    probe_status = data.get("status", "unknown")
    environment = data.get("environment")
    kind = data.get("kind")
    release_gate_check_id = data.get("release_gate_check_id")
    return {
        "path": str(path),
        "exists": True,
        "kind": kind,
        "environment": environment,
        "release_gate_check_id": release_gate_check_id,
        "status": probe_status,
        "passed": (
            probe_status in {"pass", "passed"}
            and environment == "staging"
            and kind == expected_kind
            and release_gate_check_id == expected_check_id
        ),
        "gate_impact": data.get("gate_impact", {}),
    }


def load_canonical_split_probe(
    path: Path,
    *,
    expected_check_id: str,
    expected_token: str,
) -> dict:
    if not path.exists():
        return {
            "path": str(path),
            "exists": False,
            "status": "missing",
            "passed": False,
            "environment": None,
            "release_gate_check_id": None,
            "canonical": True,
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    probe_status = data.get("status", "unknown")
    environment = data.get("environment")
    release_gate_check_id = data.get("release_gate_check_id")
    searchable = json.dumps(data, sort_keys=True)
    passed = (
        probe_status in {"pass", "passed"}
        and environment == "staging"
        and release_gate_check_id == expected_check_id
        and expected_token in searchable
    )
    return {
        "path": str(path),
        "exists": True,
        "environment": environment,
        "release_gate_check_id": release_gate_check_id,
        "status": probe_status,
        "passed": passed,
        "canonical": True,
        "evidence_id": data.get("evidence_id"),
        "gate_impact": data.get("gate_impact", {}),
    }


def load_canonical_object_retention_probe(path: Path) -> dict:
    expected_areas = {
        "retention_policy",
        "expired_export_cleanup",
        "orphan_cleanup",
        "audit_refs",
    }
    if not path.exists():
        return {
            "path": str(path),
            "exists": False,
            "status": "missing",
            "passed": False,
            "environment": None,
            "release_gate_check_id": None,
            "missing_requirements": ["missing_file"],
            "canonical": True,
        }
    data = json.loads(path.read_text(encoding="utf-8"))
    coverage = data.get("coverage", [])
    coverage_areas = {
        item.get("area")
        for item in coverage
        if isinstance(item, dict) and item.get("status") == "pass"
    }
    split_evidence = data.get("split_evidence", {})
    gate_impact = data.get("gate_impact", {})
    audit_linkage = data.get("audit_linkage", {})
    missing_requirements = []
    if data.get("environment") != "staging":
        missing_requirements.append("environment_staging")
    if data.get("kind") != "object_storage_retention_cleanup":
        missing_requirements.append("kind_object_storage_retention_cleanup")
    if data.get("release_gate_check_id") != "staging_object_storage_signed_downloads":
        missing_requirements.append("release_gate_check_id")
    if data.get("status") not in {"pass", "passed"}:
        missing_requirements.append("passing_status")
    if data.get("blocked_checks") not in ([], None):
        missing_requirements.append("no_blocked_checks")
    if split_evidence.get("canonical_pass_paths") is not True:
        missing_requirements.append("canonical_pass_paths")
    if split_evidence.get("retention_cleanup_ready") is not True:
        missing_requirements.append("retention_cleanup_ready")
    if split_evidence.get("signed_url_ready") is not True:
        missing_requirements.append("signed_url_ready")
    if gate_impact.get("can_clear_release_gate_check") is not True:
        missing_requirements.append("can_clear_release_gate_check")
    if gate_impact.get("preserved_release_gate_check_id") is not None:
        missing_requirements.append("no_preserved_release_gate_check")
    if audit_linkage.get("verified") is not True:
        missing_requirements.append("audit_linkage_verified")
    if not audit_linkage.get("cleanup_audit_refs"):
        missing_requirements.append("cleanup_audit_refs")
    if audit_linkage.get("missing_cleanup_audit_refs") not in ([], None):
        missing_requirements.append("no_missing_cleanup_audit_refs")
    if expected_areas - coverage_areas:
        missing_requirements.append("coverage:" + ",".join(sorted(expected_areas - coverage_areas)))
    return {
        "path": str(path),
        "exists": True,
        "canonical": True,
        "environment": data.get("environment"),
        "kind": data.get("kind"),
        "release_gate_check_id": data.get("release_gate_check_id"),
        "status": data.get("status", "unknown"),
        "release_sha": data.get("release_sha", ""),
        "results_path": data.get("results_path"),
        "passed": not missing_requirements,
        "missing_requirements": missing_requirements,
        "split_evidence": split_evidence,
        "gate_impact": gate_impact,
        "coverage_areas": sorted(coverage_areas),
        "audit_linkage": data.get("audit_linkage", {}),
    }


object_retention_probe = load_probe(object_retention_report_path, object_retention_exit_code)
canonical_object_retention_probe = load_canonical_object_retention_probe(
    canonical_object_retention_report_path
)
legal_support_probe = load_probe(legal_support_report_path, legal_support_exit_code)
legal_pages_probe = load_split_probe(
    legal_pages_report_path,
    expected_kind="legal_pages_external_user_visibility",
    expected_check_id="staging_legal_external_user_pages",
)
support_contact_probe = load_split_probe(
    support_contact_report_path,
    expected_kind="support_contact_external_user_visibility",
    expected_check_id="staging_legal_external_user_pages",
)
canonical_legal_pages_probe = load_canonical_split_probe(
    canonical_legal_pages_report_path,
    expected_check_id="staging_legal_external_user_pages",
    expected_token="legal",
)
canonical_support_contact_probe = load_canonical_split_probe(
    canonical_support_contact_report_path,
    expected_check_id="staging_legal_external_user_pages",
    expected_token="support",
)
generated_legal_support_verified = legal_support_probe["passed"] and legal_pages_probe["passed"] and support_contact_probe["passed"]
canonical_legal_support_verified = canonical_legal_pages_probe["passed"] and canonical_support_contact_probe["passed"]
legal_support_split_reports_passed = (
    (legal_pages_probe["passed"] and support_contact_probe["passed"])
    or canonical_legal_support_verified
)
legal_support_verified = generated_legal_support_verified or canonical_legal_support_verified
legal_support_evidence_source = (
    "generated_probe" if generated_legal_support_verified else (
        "canonical_staging_split_evidence" if canonical_legal_support_verified else "missing_or_blocked"
    )
)


def runtime_blocked_reason(probe: dict) -> str:
    requirements = probe.get("runtime_input_requirements", {})
    if isinstance(requirements, dict):
        reason = requirements.get("blocked_input_reason")
        if isinstance(reason, str) and reason.strip():
            return reason.strip()
    blocked_checks = probe.get("blocked_checks", [])
    if isinstance(blocked_checks, list) and blocked_checks:
        return "; ".join(str(item) for item in blocked_checks)
    return str(probe.get("status", "blocked"))


object_retention_blocked_reason = runtime_blocked_reason(object_retention_probe)
object_retention_verified = canonical_object_retention_probe["passed"]
ci_artifacts = ci_closure_artifacts()
production_split_preflight = production_split_preflight_summary(
    production_backup_rollback_split_preflight_path
)

slots = []
for slot, required in sorted(release_evidence.get("required_slots", {}).items()):
    verifier = verification.get(slot)
    slots.append(
        {
            "slot": slot,
            "provided": bool(required),
            "verified": bool(verifier.get("verified")) if isinstance(verifier, dict) else bool(required),
            "reason": verifier.get("reason") if isinstance(verifier, dict) else None,
        }
    )

missing_slots = [slot["slot"] for slot in slots if not slot["provided"]]
unverified_slots = [slot["slot"] for slot in slots if not slot["verified"]]
decision = go_no_go.get("decision", "no-go")
split_probe_blocking_reasons = []
if not object_retention_verified:
    split_probe_blocking_reasons.append("canonical_object_storage_retention_cleanup_not_passed")
if not legal_support_verified:
    split_probe_blocking_reasons.append("legal_support_external_user_visibility_not_passed")
if legal_support_probe["passed"] and not legal_support_split_reports_passed:
    split_probe_blocking_reasons.append("legal_support_split_evidence_not_passed")
status = (
    "passed"
    if staging_exit_code == 0
    and object_retention_verified
    and legal_support_verified
    and decision == "go"
    else "blocked"
)
decision_inputs = go_no_go.get("decision_inputs", {})
blocking_reasons = go_no_go.get("blocking_reasons", []) + split_probe_blocking_reasons

report_path.write_text(
    json.dumps(
        {
            "blueprint_source": "Docs/stage0_blueprint_rev2.md",
            "created_by_lane": "lane5",
            "created_at": report_path.stem,
            "run_id": report_path.stem,
            "kind": "release_evidence_bundle",
            "environment": staging.get("environment", "staging"),
            "release_sha": staging.get("release_sha", ""),
            "status": status,
            "decision": decision,
            "source_staging_smoke_report": str(staging_report_path),
            "source_staging_smoke_results": staging.get("results_path", ""),
            "source_object_retention_cleanup_report": str(object_retention_report_path),
            "source_object_retention_cleanup_results": object_retention_probe.get(
                "results_path",
                str(object_retention_report_path.with_suffix(".ndjson")),
            ),
            "canonical_object_retention_cleanup_report": str(canonical_object_retention_report_path),
            "source_legal_support_visibility_report": str(legal_support_report_path),
            "source_legal_support_visibility_results": str(legal_support_report_path.with_suffix(".ndjson")),
            "source_legal_pages_external_user_report": str(legal_pages_report_path),
            "source_support_contact_external_user_report": str(support_contact_report_path),
            "canonical_legal_pages_external_user_report": str(canonical_legal_pages_report_path),
            "canonical_support_contact_external_user_report": str(canonical_support_contact_report_path),
            "staging_smoke_exit_code": staging_exit_code,
            "object_retention_cleanup_exit_code": object_retention_exit_code,
            "object_retention_cleanup_blocked_reason": object_retention_blocked_reason,
            "legal_support_visibility_exit_code": legal_support_exit_code,
            "release_evidence_complete": go_no_go.get("release_evidence_complete") is True,
            "post_deploy_smoke_verified": go_no_go.get("post_deploy_smoke_verified") is True,
            "object_retention_cleanup_verified": object_retention_verified,
            "legal_support_visibility_verified": legal_support_verified,
            "legal_support_split_reports_verified": legal_support_split_reports_passed,
            "gate_fixtures_clear": go_no_go.get("gate_fixtures_clear") is True,
            "decision_inputs": decision_inputs,
            "split_probe_decision_inputs": {
                "object_retention_cleanup_verified": object_retention_verified,
                "canonical_object_retention_cleanup_verified": canonical_object_retention_probe["passed"],
                "generated_object_retention_probe_passed": object_retention_probe["passed"],
                "legal_support_visibility_verified": legal_support_verified,
                "legal_pages_external_user_verified": legal_pages_probe["passed"],
                "support_contact_external_user_verified": support_contact_probe["passed"],
                "canonical_legal_pages_external_user_verified": canonical_legal_pages_probe["passed"],
                "canonical_support_contact_external_user_verified": canonical_support_contact_probe["passed"],
                "legal_support_evidence_source": legal_support_evidence_source,
            },
            "ci_closure_artifacts": ci_artifacts,
            "ci_closure_artifacts_ready": all(item["exists"] for item in ci_artifacts),
            "production_backup_rollback_split_preflight": production_split_preflight,
            "object_retention_cleanup_probe": object_retention_probe,
            "canonical_object_retention_cleanup_probe": canonical_object_retention_probe,
            "legal_support_visibility_probe": legal_support_probe,
            "legal_pages_external_user_probe": legal_pages_probe,
            "support_contact_external_user_probe": support_contact_probe,
            "canonical_legal_pages_external_user_probe": canonical_legal_pages_probe,
            "canonical_support_contact_external_user_probe": canonical_support_contact_probe,
            "legal_support_evidence_source": legal_support_evidence_source,
            "missing_slots": missing_slots,
            "unverified_slots": unverified_slots,
            "slots": slots,
            "blocking_reason_count": len(blocking_reasons),
            "blocking_reasons": blocking_reasons,
            "private_beta_gate": "open_until_release_evidence_bundle_status_passed_and_private_beta_fixture_clear",
            "production_gate": "open_until_ci_private_beta_and_production_release_evidence_bundles_pass",
        },
        indent=2,
        sort_keys=True,
    )
    + "\n",
    encoding="utf-8",
)
PY

if [[ "$status" -ne 0 ]]; then
  printf 'release evidence bundle blocked; evidence written to %s\n' "$REPORT_PATH" >&2
  exit "$status"
fi

decision="$(python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("decision", "no-go"))
PY
)"
if [[ "$decision" != "go" ]]; then
  printf 'release evidence bundle remains no-go; evidence written to %s\n' "$REPORT_PATH" >&2
  exit 2
fi

printf 'release evidence bundle passed; evidence written to %s\n' "$REPORT_PATH"
