#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-ops/evidence/staging}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-staging-observability-backup-load-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"

RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
EVIDENCE_ENVIRONMENT="${EVIDENCE_ENVIRONMENT:-staging}"
OBSERVABILITY_EVIDENCE="${OBSERVABILITY_EVIDENCE:-}"
BACKUP_RESTORE_EVIDENCE="${BACKUP_RESTORE_EVIDENCE:-}"
LOAD_EVIDENCE="${LOAD_EVIDENCE:-}"

mkdir -p "$OUT_DIR"

python3 - \
  "$REPORT_PATH" \
  "$RUN_ID" \
  "$RELEASE_SHA" \
  "$EVIDENCE_ENVIRONMENT" \
  "$OBSERVABILITY_EVIDENCE" \
  "$BACKUP_RESTORE_EVIDENCE" \
  "$LOAD_EVIDENCE" <<'PY'
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

report_path = Path(sys.argv[1])
run_id = sys.argv[2]
release_sha = sys.argv[3].strip()
environment = sys.argv[4].strip() or "staging"
inputs = {
    "observability_evidence": sys.argv[5].strip(),
    "backup_restore_evidence": sys.argv[6].strip(),
    "load_evidence": sys.argv[7].strip(),
}
root = Path(".")


def is_url(value):
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def local_path(value):
    if not value or is_url(value):
        return None
    path = Path(value)
    return path if path.is_absolute() else root / path


def read_json(value):
    path = local_path(value)
    if path is None:
        return None, f"not_local_file:{value or 'missing'}"
    if not path.exists() or not path.is_file():
        return None, f"missing_file:{value}"
    try:
        return json.loads(path.read_text(encoding="utf-8")), ""
    except json.JSONDecodeError as exc:
        return None, f"invalid_json:{value}:{exc}"


def normalize(value):
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def direct_values(value, keys):
    if not isinstance(value, dict):
        return []
    return [
        str(nested)
        for key, nested in value.items()
        if key in keys and isinstance(nested, str)
    ]


def collect_sha_values(value):
    values = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in {"release_sha", "git_sha", "commit_sha", "sha"} and isinstance(nested, str):
                values.append(nested)
            values.extend(collect_sha_values(nested))
    elif isinstance(value, list):
        for item in value:
            values.extend(collect_sha_values(item))
    return values


def collect_entries(parsed):
    entries = {}
    if not isinstance(parsed, dict):
        return entries
    for key in ("signals", "drills", "restore_drills", "modes", "checks", "steps"):
        container = parsed.get(key)
        if isinstance(container, dict):
            for name, entry in container.items():
                if isinstance(entry, dict):
                    entries[normalize(name)] = entry
        elif isinstance(container, list):
            for entry in container:
                if not isinstance(entry, dict):
                    continue
                name = (
                    entry.get("name")
                    or entry.get("signal_id")
                    or entry.get("signal")
                    or entry.get("drill_id")
                    or entry.get("check_id")
                    or entry.get("id")
                )
                if name:
                    entries[normalize(name)] = entry
    return entries


EVIDENCE_REF_KEYS = {
    "evidence_ref",
    "evidence_refs",
    "report_path",
    "report_paths",
    "source_report",
    "source_reports",
    "query_ref",
    "dashboard_url",
    "dashboard_uid",
    "alert_rule_url",
    "trace_id",
    "log_query",
    "metrics_query",
    "artifact_path",
    "artifact_paths",
    "load_report",
}


def collect_refs(value):
    refs = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in EVIDENCE_REF_KEYS:
                items = nested if isinstance(nested, list) else [nested]
                refs.extend(str(item).strip() for item in items if str(item).strip())
            refs.extend(collect_refs(nested))
    elif isinstance(value, list):
        for item in value:
            refs.extend(collect_refs(item))
    return refs


def entry_passed(entry):
    statuses = {normalize(value) for value in direct_values(entry, {"status", "result", "runtime_status"})}
    return bool(statuses & {"passed", "validated"})


def validate_evidence(slot, value, *, expected_kind, required_entries):
    parsed, read_error = read_json(value)
    result = {
        "slot": slot,
        "ref": value,
        "expected_environment": "staging",
        "expected_kind": expected_kind,
        "required_entries": sorted(required_entries),
        "verified": False,
        "semantic_checks": {
            "local_json_file": parsed is not None,
            "release_sha_present": bool(release_sha),
            "release_sha_match": False,
            "environment_staging": False,
            "kind_match": False,
            "status_passed": False,
            "required_entries_present": False,
            "required_entries_passed": False,
            "required_entries_have_evidence_refs": False,
        },
        "missing_entries": sorted(required_entries),
        "not_passed_entries": [],
        "entries_missing_evidence_refs": [],
        "entry_evidence_refs": {},
    }
    if read_error:
        result["reason"] = read_error
        return result
    sha_values = collect_sha_values(parsed)
    statuses = {normalize(value) for value in direct_values(parsed, {"status", "result", "runtime_status"})}
    environments = {normalize(value) for value in direct_values(parsed, {"environment", "env"})}
    kinds = {normalize(value) for value in direct_values(parsed, {"kind", "evidence_kind", "type", "evidence_type"})}
    entries = collect_entries(parsed)
    result["semantic_checks"].update(
        {
            "release_sha_match": bool(release_sha and release_sha in sha_values),
            "environment_staging": normalize(environment) == "staging" and "staging" in environments,
            "kind_match": expected_kind in kinds,
            "status_passed": bool(statuses & {"passed", "validated"}),
        }
    )

    missing_entries = []
    not_passed_entries = []
    missing_refs = []
    entry_refs = {}
    for requirement, aliases in required_entries.items():
        entry = next((entries.get(normalize(alias)) for alias in aliases if normalize(alias) in entries), None)
        if entry is None:
            missing_entries.append(requirement)
            continue
        if not entry_passed(entry):
            not_passed_entries.append(requirement)
        refs = collect_refs(entry)
        entry_refs[requirement] = refs
        if not refs:
            missing_refs.append(requirement)

    result["missing_entries"] = sorted(missing_entries)
    result["not_passed_entries"] = sorted(not_passed_entries)
    result["entries_missing_evidence_refs"] = sorted(missing_refs)
    result["entry_evidence_refs"] = entry_refs
    result["semantic_checks"]["required_entries_present"] = not missing_entries
    result["semantic_checks"]["required_entries_passed"] = not not_passed_entries and not missing_entries
    result["semantic_checks"]["required_entries_have_evidence_refs"] = not missing_refs and not missing_entries
    result["verified"] = all(result["semantic_checks"].values())
    if not result["verified"]:
        failed = [key for key, passed in result["semantic_checks"].items() if passed is not True]
        result["reason"] = "failed_semantic_checks:" + ",".join(failed)
    return result


checks = [
    validate_evidence(
        "observability_evidence",
        inputs["observability_evidence"],
        expected_kind="observability",
        required_entries={
            "request_id_propagation": {"request_id_propagation", "request_id"},
            "structured_json_logs": {"structured_json_logs", "structured_logs", "json_logs"},
            "opentelemetry_traces": {"opentelemetry_traces", "otel_traces", "traces"},
            "backend_worker_crawler_metrics": {"backend_worker_crawler_metrics", "metrics"},
            "dashboard_import": {"dashboard_import", "dashboard_runtime", "dashboards"},
            "alert_routes": {"alert_routes", "alert_runtime", "alerts"},
        },
    ),
    validate_evidence(
        "backup_restore_evidence",
        inputs["backup_restore_evidence"],
        expected_kind="backup_restore",
        required_entries={
            "postgres_restore": {"postgres_restore", "postgres_restore_drill", "database_restore"},
            "object_restore": {"object_restore", "object_restore_drill", "exported_package_object_restore"},
        },
    ),
    validate_evidence(
        "load_evidence",
        inputs["load_evidence"],
        expected_kind="load",
        required_entries={
            "chat_task": {"chat_task", "chat_task_load"},
            "worker_generation": {"worker_generation", "worker_generation_load"},
            "zip_export": {"zip_export", "export_package", "zip_export_load"},
            "signed_download": {"signed_download", "signed_download_load"},
            "crawler_throttle": {"crawler_throttle", "crawler_throttle_load"},
            "quota_contention": {"quota_contention", "quota_contention_load"},
            "workspace_rendering": {"workspace_rendering", "workspace_rendering_load"},
        },
    ),
]

blocked_slots = [check["slot"] for check in checks if check["verified"] is not True]
status = "passed" if not blocked_slots else "blocked"
blocking_reasons = []
if not release_sha:
    blocking_reasons.append("missing_release_sha")
for check in checks:
    if check["verified"]:
        continue
    blocking_reasons.append(f"unverified_{check['slot']}:{check.get('reason', 'unknown')}")

report = {
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "created_by_lane": "lane5",
    "created_at": report_path.name.split("-staging-observability-backup-load-")[0],
    "run_id": run_id,
    "kind": "staging_observability_backup_load_preflight",
    "environment": environment,
    "release_sha": release_sha,
    "status": status,
    "evidence_path_policy": "ops/evidence/staging/",
    "release_gate_check_id": "staging_observability_backup_load",
    "blueprint_checklist_item": "Private Beta/Staging observability/backup/load runtime evidence 通过。",
    "inputs": inputs,
    "checks": checks,
    "blocked_slots": blocked_slots,
    "blocking_reasons": blocking_reasons,
    "private_beta_check_id": "staging_observability_backup_load",
    "gate_impact": {
        "aggregate_checklist_item": "Private Beta/Staging observability/backup/load runtime evidence 通过。",
        "can_clear_aggregate_item": status == "passed",
        "preserved_do_not_launch_condition_id": None if status == "passed" else "staging_observability_restore_load_missing",
        "preserved_release_gate_check_id": None if status == "passed" else "staging_observability_backup_load",
        "blocked_slots": blocked_slots,
    },
    "private_beta_gate": "open_until_this_preflight_passes_with_real_staging_evidence_and_release_gate_fixture_is_updated",
    "production_gate": "open_until_ci_private_beta_and_production_backup_rollback_post_deploy_evidence_pass",
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(report_path)
raise SystemExit(0 if status == "passed" else 2)
PY
