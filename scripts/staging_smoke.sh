#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${STAGING_BASE_URL:-}}"
WEB_URL="${WEB_URL:-${STAGING_WEB_URL:-}}"
ADMIN_URL="${ADMIN_URL:-${STAGING_ADMIN_URL:-}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}"
DRY_RUN="${DRY_RUN:-0}"
STAGING_SMOKE_PROFILE="${STAGING_SMOKE_PROFILE:-post_deploy}"
REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}"
REQUEST_ID_VALUE="${REQUEST_ID_VALUE:-stage0-staging-smoke}"
OUT_DIR="${OUT_DIR:-ops/evidence/staging-smoke}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-staging-smoke-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
RESULTS_PATH="$OUT_DIR/${RUN_ID}.ndjson"

RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
RELEASE_TAG="${RELEASE_TAG:-}"
RELEASE_NOTES_PATH="${RELEASE_NOTES_PATH:-}"
IMAGE_REFS="${IMAGE_REFS:-}"
MIGRATION_EVIDENCE="${MIGRATION_EVIDENCE:-}"
CONFIG_DIFF_EVIDENCE="${CONFIG_DIFF_EVIDENCE:-}"
OBSERVABILITY_EVIDENCE="${OBSERVABILITY_EVIDENCE:-}"
BACKUP_RESTORE_EVIDENCE="${BACKUP_RESTORE_EVIDENCE:-}"
LOAD_EVIDENCE="${LOAD_EVIDENCE:-}"
ROLLBACK_EVIDENCE="${ROLLBACK_EVIDENCE:-}"
SECURITY_SCAN_EVIDENCE="${SECURITY_SCAN_EVIDENCE:-}"

SMOKE_USER_ID="${SMOKE_USER_ID:-}"
SMOKE_TENANT_ID="${SMOKE_TENANT_ID:-}"
SMOKE_ADMIN_USER_ID="${SMOKE_ADMIN_USER_ID:-$SMOKE_USER_ID}"
SMOKE_ADMIN_TENANT_ID="${SMOKE_ADMIN_TENANT_ID:-$SMOKE_TENANT_ID}"
SMOKE_ADMIN_ROLES="${SMOKE_ADMIN_ROLES:-admin}"
SMOKE_TASK_ID="${SMOKE_TASK_ID:-}"
SMOKE_PACKAGE_ID="${SMOKE_PACKAGE_ID:-}"
SMOKE_EXPORT_ID="${SMOKE_EXPORT_ID:-}"

REQUIRED_CATEGORIES=(
  backend_health
  web
  admin
  auth_boundary
  worker_task
  export_package
  signed_download
  crawler_admin
  quota_rate_limit
  observability
)

CHECKS=(
  "backend_health|backend_health|GET|$BASE_URL/healthz|200|none||request_id"
  "backend_ready|backend_health|GET|$BASE_URL/readyz|200|none||"
  "observability_request_id|observability|GET|$BASE_URL/healthz|200|none||request_id"
  "web_home|web|GET|$WEB_URL/|200|none||"
  "admin_home|admin|GET|$ADMIN_URL/|200|none||"
  "user_task_auth_boundary|auth_boundary|GET|$BASE_URL/api/v1/tasks/stage0-smoke-auth|401|none||"
  "admin_audit_auth_boundary|auth_boundary|GET|$BASE_URL/api/admin/v1/audit|401|none||"
  "task_status|worker_task|GET|$BASE_URL/api/v1/tasks/$SMOKE_TASK_ID|200|user||request_id"
  "export_create|export_package|POST|$BASE_URL/api/v1/packages/$SMOKE_PACKAGE_ID/exports|202|user|{\"format\":\"zip\"}|request_id"
  "export_status|signed_download|GET|$BASE_URL/api/v1/exports/$SMOKE_EXPORT_ID|200|user||request_id"
  "crawler_sources|crawler_admin|GET|$BASE_URL/api/admin/v1/crawler/sources|200|admin||request_id"
  "quota_rate_limit|quota_rate_limit|GET|$BASE_URL/api/v1/quota|200,429|user||request_id"
)

if [[ "$STAGING_SMOKE_PROFILE" == "contract" ]]; then
  CHECKS=(
    "backend_health|backend_health|GET|$BASE_URL/healthz|200|none||request_id"
    "backend_ready|backend_health|GET|$BASE_URL/readyz|200,503|none||"
    "observability_request_id|observability|GET|$BASE_URL/healthz|200|none||request_id"
    "web_home|web|GET|$WEB_URL/|200,307,308|none||"
    "admin_home|admin|GET|$ADMIN_URL/|200,307,308|none||"
    "user_task_auth_boundary|auth_boundary|GET|$BASE_URL/api/v1/tasks/stage0-smoke-auth|401|none||"
    "admin_audit_auth_boundary|auth_boundary|GET|$BASE_URL/api/admin/v1/audit|401|none||"
    "task_status_contract|worker_task|GET|$BASE_URL/api/v1/tasks/stage0-smoke-task|401,404,501|none||"
    "export_create_contract|export_package|POST|$BASE_URL/api/v1/packages/stage0-smoke-package/exports|401,404,501|none|{\"format\":\"zip\"}|"
    "export_status_contract|signed_download|GET|$BASE_URL/api/v1/exports/stage0-smoke-export|401,404,501|none||"
    "crawler_sources_contract|crawler_admin|GET|$BASE_URL/api/admin/v1/crawler/sources|401,403,404,501|none||"
    "quota_rate_limit_contract|quota_rate_limit|GET|$BASE_URL/api/v1/quota|401,403,404,429,501|none||"
  )
fi

json_array() {
  python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))'
}

write_plan() {
  mkdir -p "$OUT_DIR"
  : >"$RESULTS_PATH"
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r name category method url expected auth body verify <<<"$check"
    python3 - "$RESULTS_PATH" "$name" "$category" "$method" "$url" "$expected" "$auth" "$verify" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
with path.open("a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "name": sys.argv[2],
        "category": sys.argv[3],
        "method": sys.argv[4],
        "url": sys.argv[5],
        "expected_statuses": [int(value) for value in sys.argv[6].split(",") if value],
        "auth_profile": sys.argv[7],
        "verify": sys.argv[8],
        "planned": True,
    }, sort_keys=True) + "\n")
PY
  done
}

write_report() {
  local status="$1"
  mkdir -p "$OUT_DIR"
  local summary required_json
  required_json="$(printf '%s\n' "${REQUIRED_CATEGORIES[@]}" | json_array)"
  summary="$(python3 - "$RESULTS_PATH" "$required_json" "$status" "$RELEASE_SHA" "$RELEASE_TAG" "$RELEASE_NOTES_PATH" "$IMAGE_REFS" "$MIGRATION_EVIDENCE" "$CONFIG_DIFF_EVIDENCE" "$OBSERVABILITY_EVIDENCE" "$BACKUP_RESTORE_EVIDENCE" "$LOAD_EVIDENCE" "$ROLLBACK_EVIDENCE" "$SECURITY_SCAN_EVIDENCE" <<'PY'
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

path = Path(sys.argv[1])
required = set(json.loads(sys.argv[2]))
status = sys.argv[3]
release_sha = sys.argv[4].strip()
release_tag = sys.argv[5].strip()
release_notes_path = sys.argv[6].strip()
image_refs = [value.strip() for value in sys.argv[7].split(",") if value.strip()]
evidence_refs = {
    "migration": sys.argv[8].strip(),
    "config_diff": sys.argv[9].strip(),
    "observability": sys.argv[10].strip(),
    "backup_restore": sys.argv[11].strip(),
    "load": sys.argv[12].strip(),
    "rollback": sys.argv[13].strip(),
    "security_scan": sys.argv[14].strip(),
}
root = Path(".")


def is_url(value):
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def resolve_local_path(value):
    if not value or is_url(value):
        return None
    candidate = Path(value)
    return candidate if candidate.is_absolute() else root / candidate


def read_json_or_text(local_path):
    if local_path is None or not local_path.exists() or not local_path.is_file():
        return None, ""
    text = local_path.read_text(encoding="utf-8", errors="replace")
    try:
        return json.loads(text), text
    except json.JSONDecodeError:
        return None, text


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


def collect_key_values(value, keys):
    values = []
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in keys and isinstance(nested, str):
                values.append(nested)
            values.extend(collect_key_values(nested, keys))
    elif isinstance(value, list):
        for item in value:
            values.extend(collect_key_values(item, keys))
    return values


def normalized_token(value):
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def collect_named_entries(parsed):
    entries = {}
    if not isinstance(parsed, dict):
        return entries
    for container_key in ("signals", "checks", "drills", "restore_drills", "modes", "scans", "steps"):
        container = parsed.get(container_key)
        if isinstance(container, dict):
            for key, value in container.items():
                if isinstance(value, dict):
                    entries[normalized_token(key)] = value
        elif isinstance(container, list):
            for item in container:
                if not isinstance(item, dict):
                    continue
                name = (
                    item.get("name")
                    or item.get("signal")
                    or item.get("signal_id")
                    or item.get("check_id")
                    or item.get("drill_id")
                    or item.get("id")
                )
                if name:
                    entries[normalized_token(name)] = item
    return entries


def entry_passed(entry, accepted_statuses):
    status_values = [
        normalized_token(value)
        for value in collect_key_values(entry, {"status", "result", "runtime_status"})
    ]
    accepted = {normalized_token(value) for value in accepted_statuses}
    return any(value in accepted for value in status_values)


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
    "run_url",
    "run_urls",
    "scan_report",
    "scan_reports",
    "smoke_report",
    "load_report",
    "rollback_report",
}


def classify_evidence_ref(ref):
    value = str(ref).strip()
    if not value:
        return {"ref": value, "kind": "empty", "exists": False}
    if is_url(value):
        return {"ref": value, "kind": "url", "exists": None}
    local_path = resolve_local_path(value)
    if local_path is not None:
        return {
            "ref": value,
            "kind": "local_file" if local_path.exists() else "artifact_pointer",
            "path": str(local_path),
            "exists": local_path.exists(),
        }
    return {"ref": value, "kind": "artifact_pointer", "exists": None}


def collect_evidence_refs(entry):
    refs = []
    if not isinstance(entry, dict):
        return refs
    for key, value in entry.items():
        if key in EVIDENCE_REF_KEYS:
            values = value if isinstance(value, list) else [value]
            for item in values:
                if isinstance(item, str) and item.strip():
                    classified = classify_evidence_ref(item)
                    classified["field"] = key
                    refs.append(classified)
        if isinstance(value, dict):
            refs.extend(collect_evidence_refs(value))
        elif isinstance(value, list):
            for item in value:
                refs.extend(collect_evidence_refs(item))
    return refs


def entry_has_evidence_ref(entry):
    return bool(collect_evidence_refs(entry))


def validate_named_contract(parsed, required_aliases, accepted_statuses):
    entries = collect_named_entries(parsed)
    result = {
        "required": sorted(required_aliases),
        "present": sorted(entries),
        "missing": [],
        "not_passed": [],
        "missing_evidence_ref": [],
        "evidence_refs": {},
        "verified": False,
    }
    for requirement, aliases in required_aliases.items():
        entry = next((entries[normalized_token(alias)] for alias in aliases if normalized_token(alias) in entries), None)
        if entry is None:
            result["missing"].append(requirement)
            continue
        if not entry_passed(entry, accepted_statuses):
            result["not_passed"].append(requirement)
        refs = collect_evidence_refs(entry)
        result["evidence_refs"][requirement] = refs
        if not refs:
            result["missing_evidence_ref"].append(requirement)
    result["evidence_ref_counts"] = {
        key: len(value) for key, value in result["evidence_refs"].items()
    }
    result["verified"] = not result["missing"] and not result["not_passed"] and not result["missing_evidence_ref"]
    return result


def validate_local_ref(name, value, *, require_sha=False):
    local_path = resolve_local_path(value)
    result = {
        "ref": value,
        "kind": "missing" if not value else ("url_unverified" if is_url(value) else "local_file"),
        "exists": False,
        "sha_match": False,
        "verified": False,
    }
    if not value:
        result["reason"] = "missing_ref"
        return result
    if local_path is None:
        result["reason"] = "remote_url_cannot_be_verified_by_local_smoke"
        return result
    result["path"] = str(local_path)
    if not local_path.exists() or not local_path.is_file():
        result["reason"] = "local_file_not_found"
        return result
    parsed, text = read_json_or_text(local_path)
    result["exists"] = True
    if not release_sha or not require_sha:
        result["sha_match"] = True
        result["verified"] = True
        return result
    sha_values = collect_sha_values(parsed) if parsed is not None else []
    if sha_values:
        result["sha_values"] = sha_values
        result["sha_match"] = release_sha in sha_values
    else:
        result["sha_match"] = release_sha in text
    result["verified"] = result["sha_match"]
    if not result["verified"]:
        result["reason"] = f"{name}_does_not_reference_release_sha"
    return result


def validate_staging_evidence_ref(name, value, *, expected_kind, accepted_statuses):
    result = validate_local_ref(name, value, require_sha=True)
    result["expected_evidence_kind"] = expected_kind
    result["accepted_statuses"] = sorted(accepted_statuses)
    result["required_environment"] = "staging"
    result["semantic_checks"] = {
        "json_parseable": False,
        "release_sha_present": bool(release_sha),
        "release_sha_match": result.get("sha_match") is True,
        "environment_staging": False,
        "evidence_kind_match": False,
        "status_accepted": False,
    }
    if not value or not result.get("exists"):
        result["verified"] = False
        return result
    if not release_sha:
        result["reason"] = "missing_release_sha_for_staging_evidence"
        result["verified"] = False
        return result
    local_path = resolve_local_path(value)
    parsed, _ = read_json_or_text(local_path)
    if parsed is None:
        result["reason"] = f"{name}_must_be_json_for_validator_resolvable_release_evidence"
        result["verified"] = False
        return result

    status_values = [item.lower() for item in collect_key_values(parsed, {"status", "result", "runtime_status"})]
    environment_values = [item.lower() for item in collect_key_values(parsed, {"environment", "env"})]
    kind_values = [item.lower() for item in collect_key_values(parsed, {"kind", "evidence_kind", "type", "evidence_type"})]
    result["status_values"] = status_values
    result["environment_values"] = environment_values
    result["evidence_kind_values"] = kind_values
    result["semantic_checks"] = {
        "json_parseable": True,
        "release_sha_present": True,
        "release_sha_match": result.get("sha_match") is True,
        "environment_staging": "staging" in environment_values,
        "evidence_kind_match": expected_kind in kind_values,
        "status_accepted": any(status in accepted_statuses for status in status_values),
    }
    missing_semantics = [
        key for key, passed in result["semantic_checks"].items() if passed is not True
    ]
    if expected_kind == "observability":
        result["observability_contract"] = validate_named_contract(
            parsed,
            {
                "request_id_propagation": {"request_id_propagation", "request_id"},
                "structured_json_logs": {"structured_json_logs", "structured_logs", "json_logs"},
                "opentelemetry_traces": {"opentelemetry_traces", "otel_traces", "traces"},
                "backend_worker_crawler_metrics": {"backend_worker_crawler_metrics", "metrics"},
                "dashboard_import": {"dashboard_import", "dashboard_runtime", "dashboards"},
                "alert_routes": {"alert_routes", "alert_runtime", "alerts"},
            },
            {"passed", "validated"},
        )
        if result["observability_contract"]["verified"] is not True:
            missing_semantics.append("observability_contract")
    elif expected_kind == "backup_restore":
        result["backup_restore_contract"] = validate_named_contract(
            parsed,
            {
                "postgres_restore": {"postgres_restore", "postgres_restore_drill", "database_restore"},
                "object_restore": {"object_restore", "object_restore_drill", "exported_package_object_restore"},
            },
            {"passed", "validated"},
        )
        if result["backup_restore_contract"]["verified"] is not True:
            missing_semantics.append("backup_restore_contract")
    elif expected_kind == "load":
        result["load_contract"] = validate_named_contract(
            parsed,
            {
                "chat_task": {"chat_task", "chat_task_load"},
                "worker_generation": {"worker_generation", "worker_generation_load"},
                "zip_export": {"zip_export", "export_package", "zip_export_load"},
                "signed_download": {"signed_download", "signed_download_load"},
                "crawler_throttle": {"crawler_throttle", "crawler_throttle_load"},
                "quota_contention": {"quota_contention", "quota_contention_load"},
                "workspace_rendering": {"workspace_rendering", "workspace_rendering_load"},
            },
            {"passed", "validated"},
        )
        if result["load_contract"]["verified"] is not True:
            missing_semantics.append("load_contract")
    elif expected_kind == "rollback":
        result["rollback_contract"] = validate_named_contract(
            parsed,
            {
                "image_rollback": {"image_rollback", "image_promote_previous_sha"},
                "feature_flag_rollback": {"feature_flag_rollback", "flag_rollback"},
                "migration_compatibility": {"migration_compatibility", "forward_repair", "db_compatibility"},
                "worker_drain": {"worker_drain", "worker_pause_resume"},
                "post_rollback_smoke": {"post_rollback_smoke", "rollback_smoke"},
            },
            {"passed", "validated"},
        )
        if result["rollback_contract"]["verified"] is not True:
            missing_semantics.append("rollback_contract")
    elif expected_kind == "security_scan":
        result["security_scan_contract"] = validate_named_contract(
            parsed,
            {
                "dependency_scan": {"dependency_scan", "deps", "npm_go_vulncheck"},
                "image_scan": {"image_scan", "docker_image_scan", "container_scan"},
                "secret_scan": {"secret_scan", "committed_secret_scan"},
            },
            {"passed", "validated"},
        )
        if result["security_scan_contract"]["verified"] is not True:
            missing_semantics.append("security_scan_contract")
    result["verified"] = not missing_semantics
    if missing_semantics:
        result["reason"] = f"{name}_failed_semantic_checks:{','.join(missing_semantics)}"
    return result


def validate_release_notes_ref(value):
    result = validate_local_ref("release_notes_path", value, require_sha=True)
    required_fragments = [
        "## Identity",
        "## Scope",
        "## Migration List",
        "## Config Diff",
        "## Feature Flags",
        "## Smoke Plan",
        "## Evidence",
        "## Rollback Plan",
        "## Known Risks",
        "## Go/No-Go",
    ]
    result["required_fragments"] = required_fragments
    result["missing_fragments"] = required_fragments[:]
    result["unresolved_placeholders"] = []
    result["decision_recorded"] = False
    if not result.get("exists"):
        result["verified"] = False
        return result
    local_path = resolve_local_path(value)
    text = local_path.read_text(encoding="utf-8", errors="replace") if local_path else ""
    result["missing_fragments"] = [fragment for fragment in required_fragments if fragment not in text]
    result["unresolved_placeholders"] = sorted(set(re.findall(r"<[^>\n]+>", text)))
    result["decision_recorded"] = "- Decision:" in text or "Decision:" in text
    result["verified"] = (
        result.get("sha_match") is True
        and not result["missing_fragments"]
        and not result["unresolved_placeholders"]
        and result["decision_recorded"] is True
    )
    if result["missing_fragments"]:
        result["reason"] = "release_notes_missing_required_sections"
    elif result["unresolved_placeholders"]:
        result["reason"] = "release_notes_have_unresolved_placeholders"
    elif result["decision_recorded"] is not True:
        result["reason"] = "release_notes_missing_go_no_go_decision"
    return result


def validate_image_refs(refs):
    required_images = ["backend", "web", "admin"]
    sha_tokens = [release_sha]
    if len(release_sha) >= 12:
        sha_tokens.append(release_sha[:12])
    result = {
        "refs": refs,
        "required_images": required_images,
        "release_sha": release_sha,
        "sha_tokens": [token for token in sha_tokens if token],
        "missing_images": [],
        "refs_without_release_sha": [],
        "verified": False,
    }
    if not refs:
        result["reason"] = "missing_image_refs"
        result["missing_images"] = required_images
        return result
    if not release_sha:
        result["reason"] = "missing_release_sha"
        result["missing_images"] = [name for name in required_images if not any(name in ref for ref in refs)]
        result["refs_without_release_sha"] = refs
        return result
    result["missing_images"] = [name for name in required_images if not any(name in ref for ref in refs)]
    result["refs_without_release_sha"] = [
        ref for ref in refs if not any(token and token in ref for token in sha_tokens)
    ]
    result["verified"] = not result["missing_images"] and not result["refs_without_release_sha"]
    if not result["verified"]:
        result["reason"] = "image_refs_missing_required_images_or_release_sha"
    return result


rows = []
if path.exists():
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
categories = sorted({row.get("category") for row in rows if row.get("category")})
statuses = {}
for row in rows:
    key = f"{row.get('name')}:{row.get('status_code', 'planned')}"
    statuses[key] = row.get("url")
gate_paths = {
    "private_beta_staging": Path("fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json"),
    "production_launch": Path("fixtures/stage0/rev2/release_gate_evidence.production_launch.json"),
}
gate_statuses = {}
blocked_conditions = []
for gate_name, gate_path in gate_paths.items():
    if not gate_path.exists():
        gate_statuses[gate_name] = {"path": str(gate_path), "blocked_checks": None, "do_not_launch_present": None}
        blocked_conditions.append(f"{gate_name}:missing_gate_fixture")
        continue
    gate = json.loads(gate_path.read_text(encoding="utf-8"))
    blocked_checks = [
        check.get("check_id")
        for check in gate.get("checks", [])
        if check.get("status") != "passed"
    ]
    do_not_launch = [
        check.get("condition_id")
        for check in gate.get("do_not_launch_checks", [])
        if check.get("is_present") is True
    ]
    gate_statuses[gate_name] = {
        "path": str(gate_path),
        "blocked_checks": blocked_checks,
        "do_not_launch_present": do_not_launch,
    }
    blocked_conditions.extend(f"{gate_name}:{check}" for check in blocked_checks)
    blocked_conditions.extend(f"{gate_name}:{condition}" for condition in do_not_launch)
release_evidence_required = {
    "release_sha": bool(release_sha),
    "release_notes_path": bool(release_notes_path),
    "image_refs": bool(image_refs),
    "migration_evidence": bool(evidence_refs["migration"]),
    "config_diff_evidence": bool(evidence_refs["config_diff"]),
    "observability_evidence": bool(evidence_refs["observability"]),
    "backup_restore_evidence": bool(evidence_refs["backup_restore"]),
    "load_evidence": bool(evidence_refs["load"]),
    "rollback_evidence": bool(evidence_refs["rollback"]),
    "security_scan_evidence": bool(evidence_refs["security_scan"]),
}
local_evidence_verification = {
    "release_notes_path": validate_release_notes_ref(release_notes_path),
    "image_refs": validate_image_refs(image_refs),
    "migration_evidence": validate_staging_evidence_ref(
        "migration_evidence",
        evidence_refs["migration"],
        expected_kind="migration",
        accepted_statuses={"passed", "compatible"},
    ),
    "config_diff_evidence": validate_staging_evidence_ref(
        "config_diff_evidence",
        evidence_refs["config_diff"],
        expected_kind="config_diff",
        accepted_statuses={"passed", "reviewed", "no_diff"},
    ),
    "observability_evidence": validate_staging_evidence_ref(
        "observability_evidence",
        evidence_refs["observability"],
        expected_kind="observability",
        accepted_statuses={"passed"},
    ),
    "backup_restore_evidence": validate_staging_evidence_ref(
        "backup_restore_evidence",
        evidence_refs["backup_restore"],
        expected_kind="backup_restore",
        accepted_statuses={"passed"},
    ),
    "load_evidence": validate_staging_evidence_ref(
        "load_evidence",
        evidence_refs["load"],
        expected_kind="load",
        accepted_statuses={"passed"},
    ),
    "rollback_evidence": validate_staging_evidence_ref(
        "rollback_evidence",
        evidence_refs["rollback"],
        expected_kind="rollback",
        accepted_statuses={"passed", "validated"},
    ),
    "security_scan_evidence": validate_staging_evidence_ref(
        "security_scan_evidence",
        evidence_refs["security_scan"],
        expected_kind="security_scan",
        accepted_statuses={"passed"},
    ),
}
release_evidence_verified = all(item["verified"] for item in local_evidence_verification.values())
release_evidence_complete = all(release_evidence_required.values()) and release_evidence_verified
smoke_passed = status == "passed" and all(row.get("ok") is not False for row in rows) and not (required - set(categories))
missing_release_evidence_slots = sorted(
    key for key, value in release_evidence_required.items() if not value
)
unverified_release_evidence_slots = sorted(
    key for key, value in local_evidence_verification.items() if not value.get("verified")
)
blocking_reasons = []
if not smoke_passed:
    blocking_reasons.append("staging_smoke_not_passed")
blocking_reasons.extend(f"missing_release_evidence:{slot}" for slot in missing_release_evidence_slots)
blocking_reasons.extend(f"unverified_release_evidence:{slot}" for slot in unverified_release_evidence_slots)
blocking_reasons.extend(f"gate_fixture_blocked:{condition}" for condition in blocked_conditions)
go_no_go = {
    "decision": "go" if smoke_passed and release_evidence_complete and not blocked_conditions else "no-go",
    "smoke_passed": smoke_passed,
    "release_evidence_complete": release_evidence_complete,
    "release_evidence_verified": release_evidence_verified,
    "missing_release_evidence_slots": missing_release_evidence_slots,
    "unverified_release_evidence_slots": unverified_release_evidence_slots,
    "gate_fixtures_clear": not blocked_conditions,
    "blocked_conditions": blocked_conditions,
    "blocking_reasons": blocking_reasons,
    "decision_inputs": {
        "smoke_passed": smoke_passed,
        "release_evidence_complete": release_evidence_complete,
        "gate_fixtures_clear": not blocked_conditions,
    },
}
print(json.dumps({
    "check_count": len(rows),
    "failure_count": sum(1 for row in rows if row.get("ok") is False),
    "categories": categories,
    "missing_required_categories": sorted(required - set(categories)),
    "statuses": statuses,
    "release_evidence": {
        "release_sha": release_sha,
        "release_tag": release_tag,
        "release_notes_path": release_notes_path,
        "image_refs": image_refs,
        "evidence_refs": evidence_refs,
        "required_slots": release_evidence_required,
        "local_evidence_verification": local_evidence_verification,
        "complete": release_evidence_complete,
    },
    "release_gate_fixtures": gate_statuses,
    "go_no_go": go_no_go,
}, sort_keys=True))
PY
)"
  cat >"$REPORT_PATH" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "run_id": "$RUN_ID",
  "status": "$status",
  "profile": "$STAGING_SMOKE_PROFILE",
  "release_sha": "$RELEASE_SHA",
  "release_tag": "$RELEASE_TAG",
  "release_notes_path": "$RELEASE_NOTES_PATH",
  "base_url": "$BASE_URL",
  "web_url": "$WEB_URL",
  "admin_url": "$ADMIN_URL",
  "request_id_header": "$REQUEST_ID_HEADER",
  "request_id_value": "$REQUEST_ID_VALUE",
  "results_path": "$RESULTS_PATH",
  "required_categories": $required_json,
  "summary": $summary,
  "private_beta_gate": "open_until_this_smoke_passes_against_production_like_postgres_redis_object_storage_observability_backups_and_seeded_release_smoke_records",
  "production_gate": "open_until_post_deploy_smoke_passes_for_approved_release_sha_with_attached_release_notes"
}
JSON
}

record_check() {
  local name="$1"
  local category="$2"
  local method="$3"
  local url="$4"
  local expected_csv="$5"
  local auth_profile="$6"
  local body="$7"
  local verify="$8"

  local body_path="/tmp/stage0-staging-smoke-body.$$"
  local curl_err_path="/tmp/stage0-staging-smoke-curl.$$"
  local curl_args=(-sS -m "$TIMEOUT_SECONDS" -D - -o "$body_path" -w $'\n%{http_code} %{time_total}' -X "$method" -H "$REQUEST_ID_HEADER: $REQUEST_ID_VALUE")
  if [[ "$auth_profile" == "user" ]]; then
    curl_args+=(-H "X-Zenart-User-ID: $SMOKE_USER_ID" -H "X-Zenart-Tenant-ID: $SMOKE_TENANT_ID")
  elif [[ "$auth_profile" == "admin" ]]; then
    curl_args+=(-H "X-Zenart-User-ID: $SMOKE_ADMIN_USER_ID" -H "X-Zenart-Tenant-ID: $SMOKE_ADMIN_TENANT_ID" -H "X-Zenart-Roles: $SMOKE_ADMIN_ROLES")
  fi
  if [[ -n "$body" ]]; then
    curl_args+=(-H "Content-Type: application/json" --data "$body")
  fi

  local response meta headers status elapsed duration_ms ok request_id_ok
  response="$(curl "${curl_args[@]}" "$url" 2>"$curl_err_path")" || response=$'\n000 0'
  meta="${response##*$'\n'}"
  headers="${response%$'\n'*}"
  status="${meta%% *}"
  elapsed="${meta##* }"
  duration_ms="$(python3 - "$elapsed" <<'PY'
import sys
try:
    print(int(round(float(sys.argv[1]) * 1000)))
except ValueError:
    print(0)
PY
)"

  ok=false
  IFS=',' read -ra expected_values <<<"$expected_csv"
  for expected in "${expected_values[@]}"; do
    if [[ "$status" == "$expected" ]]; then
      ok=true
      break
    fi
  done

  request_id_ok=true
  if [[ "$verify" == "request_id" ]]; then
    request_id_ok=false
    if grep -qi "^$REQUEST_ID_HEADER: $REQUEST_ID_VALUE" <<<"$headers" || grep -q "$REQUEST_ID_VALUE" "$body_path"; then
      request_id_ok=true
    fi
    if [[ "$request_id_ok" != "true" ]]; then
      ok=false
    fi
  fi

  python3 - "$RESULTS_PATH" "$name" "$category" "$method" "$url" "$expected_csv" "$auth_profile" "$status" "$duration_ms" "$ok" "$request_id_ok" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
with path.open("a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "name": sys.argv[2],
        "category": sys.argv[3],
        "method": sys.argv[4],
        "url": sys.argv[5],
        "expected_statuses": [int(value) for value in sys.argv[6].split(",") if value],
        "auth_profile": sys.argv[7],
        "status_code": int(sys.argv[8]) if sys.argv[8].isdigit() else 0,
        "duration_ms": int(sys.argv[9]),
        "ok": sys.argv[10] == "true",
        "request_id_ok": sys.argv[11] == "true",
    }, sort_keys=True) + "\n")
PY

  rm -f "$body_path" "$curl_err_path"
  [[ "$ok" == "true" ]]
}

require_urls() {
  if [[ -z "$BASE_URL" || -z "$WEB_URL" || -z "$ADMIN_URL" ]]; then
    printf 'STAGING_BASE_URL, STAGING_WEB_URL, and STAGING_ADMIN_URL are required\n' >&2
    write_plan
    write_report "blocked_missing_staging_urls"
    exit 2
  fi
}

require_post_deploy_inputs() {
  if [[ "$STAGING_SMOKE_PROFILE" != "post_deploy" || "$DRY_RUN" == "1" ]]; then
    return 0
  fi
  local missing=()
  for key in RELEASE_SHA RELEASE_NOTES_PATH IMAGE_REFS MIGRATION_EVIDENCE CONFIG_DIFF_EVIDENCE OBSERVABILITY_EVIDENCE BACKUP_RESTORE_EVIDENCE LOAD_EVIDENCE ROLLBACK_EVIDENCE SECURITY_SCAN_EVIDENCE SMOKE_USER_ID SMOKE_TENANT_ID SMOKE_ADMIN_USER_ID SMOKE_ADMIN_TENANT_ID SMOKE_TASK_ID SMOKE_PACKAGE_ID SMOKE_EXPORT_ID; do
    if [[ -z "${!key}" ]]; then
      missing+=("$key")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    printf 'post-deploy staging smoke requires seeded evidence inputs: %s\n' "${missing[*]}" >&2
    write_plan
    write_report "blocked_missing_seeded_smoke_inputs"
    exit 2
  fi
}

case "$STAGING_SMOKE_PROFILE" in
  post_deploy|contract) ;;
  *)
    printf 'unsupported STAGING_SMOKE_PROFILE=%s\n' "$STAGING_SMOKE_PROFILE" >&2
    exit 64
    ;;
esac

if [[ "$DRY_RUN" == "1" ]]; then
  write_plan
  write_report "planned"
  printf 'staging smoke dry-run planned with profile %s\n' "$STAGING_SMOKE_PROFILE"
  exit 0
fi

require_urls
require_post_deploy_inputs

if ! command -v curl >/dev/null 2>&1; then
  printf 'curl is required for staging smoke\n' >&2
  write_plan
  write_report "blocked_missing_curl"
  exit 127
fi

mkdir -p "$OUT_DIR"
rm -f "$RESULTS_PATH"

failures=0
for check in "${CHECKS[@]}"; do
  IFS='|' read -r name category method url expected auth body verify <<<"$check"
  record_check "$name" "$category" "$method" "$url" "$expected" "$auth" "$body" "$verify" || failures=$((failures + 1))
done

if (( failures > 0 )); then
  write_report "failed"
  printf 'staging smoke failed with %s failed checks\n' "$failures" >&2
  exit 1
fi

write_report "passed"
printf 'staging smoke passed; evidence written to %s\n' "$REPORT_PATH"
