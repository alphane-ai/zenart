#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_URL="${BASE_URL:-${STAGING_BASE_URL:-}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}"
DRY_RUN="${DRY_RUN:-0}"
OUT_DIR="${OUT_DIR:-ops/evidence/staging}"
REPORT_PATH="${REPORT_PATH:-$OUT_DIR/object-storage-retention-cleanup.json}"
RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/object-storage-retention-cleanup.ndjson}"
RUN_ID="${RUN_ID:-object-storage-retention-cleanup}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
SIGNED_URL_EVIDENCE="${SIGNED_URL_EVIDENCE:-ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json}"
REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}"
REQUEST_ID_VALUE="${REQUEST_ID_VALUE:-stage0-object-retention-cleanup}"

RETENTION_POLICY_URL="${RETENTION_POLICY_URL:-}"
EXPIRED_EXPORT_CLEANUP_URL="${EXPIRED_EXPORT_CLEANUP_URL:-}"
ORPHAN_CLEANUP_URL="${ORPHAN_CLEANUP_URL:-}"
AUDIT_REFS_URL="${AUDIT_REFS_URL:-}"

ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN:-${STAGING_ADMIN_BEARER_TOKEN:-}}"
ADMIN_SESSION_COOKIE="${ADMIN_SESSION_COOKIE:-${STAGING_ADMIN_SESSION_COOKIE:-}}"
SMOKE_ADMIN_USER_ID="${SMOKE_ADMIN_USER_ID:-}"
SMOKE_ADMIN_TENANT_ID="${SMOKE_ADMIN_TENANT_ID:-}"

mkdir -p "$OUT_DIR"
: >"$RESULTS_PATH"

if [[ -n "$BASE_URL" ]]; then
  RETENTION_POLICY_URL="${RETENTION_POLICY_URL:-${BASE_URL%/}/api/admin/v1/object-storage/retention-policy}"
  EXPIRED_EXPORT_CLEANUP_URL="${EXPIRED_EXPORT_CLEANUP_URL:-${BASE_URL%/}/api/admin/v1/object-storage/cleanup/expired-exports}"
  ORPHAN_CLEANUP_URL="${ORPHAN_CLEANUP_URL:-${BASE_URL%/}/api/admin/v1/object-storage/cleanup/orphans}"
  AUDIT_REFS_URL="${AUDIT_REFS_URL:-${BASE_URL%/}/api/admin/v1/audit?subject=object_storage_cleanup&limit=20}"
fi

CHECKS=(
  "retention_policy|GET|$RETENTION_POLICY_URL|retention policy,versioning,retention_until,tenant"
  "expired_export_cleanup|POST|$EXPIRED_EXPORT_CLEANUP_URL|expired export cleanup,deleted,retained,audit"
  "orphan_cleanup|POST|$ORPHAN_CLEANUP_URL|orphan cleanup,deleted,retained,audit"
  "audit_refs|GET|$AUDIT_REFS_URL|audit,object_storage_cleanup,admin,tenant"
)

append_result() {
  local check_id="$1"
  local method="$2"
  local url="$3"
  local expected_tokens="$4"
  local status="$5"
  local http_status="$6"
  local reason="$7"
  local body_path="$8"
  python3 - "$RESULTS_PATH" "$check_id" "$method" "$url" "$expected_tokens" "$status" "$http_status" "$reason" "$body_path" <<'PY'
import json
import sys

result_path, check_id, method, url, expected_tokens, status, http_status, reason, body_path = sys.argv[1:]
with open(result_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "check_id": check_id,
        "method": method,
        "url": url,
        "expected_tokens": [token.strip() for token in expected_tokens.split(",") if token.strip()],
        "status": status,
        "http_status": int(http_status) if http_status.isdigit() else None,
        "reason": reason,
        "body_path": body_path or None,
    }, sort_keys=True) + "\n")
PY
}

run_probe() {
  local check_id="$1"
  local method="$2"
  local url="$3"
  local expected_tokens="$4"
  local body_file="$OUT_DIR/$RUN_ID.$check_id.body"
  local curl_args=(
    --silent
    --show-error
    --location
    --max-time "$TIMEOUT_SECONDS"
    --request "$method"
    --header "$REQUEST_ID_HEADER: $REQUEST_ID_VALUE-$check_id"
    --output "$body_file"
    --write-out "%{http_code}"
  )
  if [[ -n "$ADMIN_BEARER_TOKEN" ]]; then
    curl_args+=(--header "Authorization: Bearer $ADMIN_BEARER_TOKEN")
  fi
  if [[ -n "$ADMIN_SESSION_COOKIE" ]]; then
    curl_args+=(--header "Cookie: $ADMIN_SESSION_COOKIE")
  fi
  if [[ "$method" == "POST" ]]; then
    curl_args+=(--header "Content-Type: application/json" --data '{"mode":"stage0_retention_cleanup_smoke"}')
  fi

  local http_status
  http_status="$(curl "${curl_args[@]}" "$url" || true)"
  if [[ "$http_status" != "200" && "$http_status" != "202" ]]; then
    append_result "$check_id" "$method" "$url" "$expected_tokens" "failed" "$http_status" "unexpected_http_status" "$body_file"
    return
  fi

  local missing=()
  local token
  IFS=',' read -r -a tokens <<<"$expected_tokens"
  for token in "${tokens[@]}"; do
    if ! grep -Fqi "$token" "$body_file"; then
      missing+=("$token")
    fi
  done
  if [[ "${#missing[@]}" -gt 0 ]]; then
    append_result "$check_id" "$method" "$url" "$expected_tokens" "failed" "$http_status" "missing_tokens:${missing[*]}" "$body_file"
  else
    append_result "$check_id" "$method" "$url" "$expected_tokens" "passed" "$http_status" "ok" "$body_file"
  fi
}

if [[ -z "$BASE_URL" && -z "$RETENTION_POLICY_URL$EXPIRED_EXPORT_CLEANUP_URL$ORPHAN_CLEANUP_URL$AUDIT_REFS_URL" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    append_result "$check_id" "$method" "$url" "$expected_tokens" "blocked" "" "missing_staging_base_url_or_explicit_probe_urls" ""
  done
elif [[ "$DRY_RUN" == "1" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    append_result "$check_id" "$method" "$url" "$expected_tokens" "planned" "" "dry_run_no_staging_runtime_probe" ""
  done
else
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    if [[ -z "$url" ]]; then
      append_result "$check_id" "$method" "$url" "$expected_tokens" "blocked" "" "missing_probe_url" ""
    else
      run_probe "$check_id" "$method" "$url" "$expected_tokens"
    fi
  done
fi

actual_report_path="$(
python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RUN_ID" "$RELEASE_SHA" "$BASE_URL" "$SMOKE_ADMIN_USER_ID" "$SMOKE_ADMIN_TENANT_ID" "$SIGNED_URL_EVIDENCE" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
run_id = sys.argv[3]
release_sha = sys.argv[4].strip()
base_url = sys.argv[5].strip()
admin_user_id = sys.argv[6].strip()
admin_tenant_id = sys.argv[7].strip()
signed_url_evidence = sys.argv[8].strip()

results = [
    json.loads(line)
    for line in results_path.read_text(encoding="utf-8").splitlines()
    if line.strip()
]
required = {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}
passed = {item["check_id"] for item in results if item["status"] == "passed"}
blocked_or_failed = [
    f"{item['check_id']}:{item['reason']}"
    for item in results
    if item["status"] != "passed"
]
runtime_checks_passed = required <= passed and not blocked_or_failed
canonical_report_path = Path("ops/evidence/staging/object-storage-retention-cleanup.json")
canonical_results_path = Path("ops/evidence/staging/object-storage-retention-cleanup.ndjson")
signed_url_path = Path(signed_url_evidence) if signed_url_evidence else None
signed_url_ready = False
signed_url_reason = "missing_signed_url_evidence_path"
signed_url_release_sha = ""
if signed_url_path is not None and signed_url_path.exists() and signed_url_path.is_file():
    try:
        signed_url = json.loads(signed_url_path.read_text(encoding="utf-8"))
        signed_url_release_sha = str(signed_url.get("release_sha", "")).strip()
        signed_url_ready = (
            signed_url.get("environment") == "staging"
            and signed_url.get("kind") == "object_storage_signed_url"
            and signed_url.get("release_gate_check_id") == "staging_object_storage_signed_downloads"
            and signed_url.get("status") in {"pass", "passed", "pass_with_blockers_preserved"}
        )
        signed_url_reason = "signed_url_runtime_evidence_ready" if signed_url_ready else "signed_url_runtime_evidence_not_passing"
    except json.JSONDecodeError:
        signed_url_reason = "signed_url_evidence_invalid_json"
elif signed_url_path is not None:
    signed_url_reason = "signed_url_evidence_missing"

release_sha_matches_signed_url = bool(release_sha) and signed_url_release_sha == release_sha
release_binding_blockers = []
if runtime_checks_passed and not release_sha:
    release_binding_blockers.append("release_sha_missing")
elif runtime_checks_passed and not release_sha_matches_signed_url:
    release_binding_blockers.append("release_sha_mismatch_with_signed_url_evidence")

blocked_or_failed = blocked_or_failed + release_binding_blockers
all_passed = runtime_checks_passed and signed_url_ready and release_sha_matches_signed_url
can_clear_release_gate_check = all_passed

if not all_passed and report_path == canonical_report_path:
    blocked_report_path = report_path.with_name("object-storage-retention-cleanup.blocked.json")
    blocked_results_path = results_path.with_name("object-storage-retention-cleanup.blocked.ndjson")
    if results_path.exists():
        blocked_results_path.write_text(results_path.read_text(encoding="utf-8"), encoding="utf-8")
        if results_path == canonical_results_path:
            results_path.unlink()
    report_path = blocked_report_path
    results_path = blocked_results_path

coverage = []
for area, tokens in {
    "retention_policy": ["retention policy", "versioning", "retention_until", "tenant"],
    "expired_export_cleanup": ["expired export cleanup", "deleted", "retained", "audit"],
    "orphan_cleanup": ["orphan cleanup", "deleted", "retained", "audit"],
    "audit_refs": ["audit", "object_storage_cleanup", "admin", "tenant"],
}.items():
    related = [item for item in results if item["check_id"] == area]
    status = "pass" if related and all(item["status"] == "passed" for item in related) else "blocked"
    coverage.append({
        "area": area,
        "status": status,
        "runtime_probe": (
            "Staging object storage retention cleanup probe verifies "
            + area.replace("_", " ")
            + " with release-SHA-bound admin runtime evidence and audit context."
        ),
        "evidence_path_policy": "ops/evidence/staging/",
        "evidence_refs": [str(results_path), str(report_path)],
        "expected_tokens": tokens,
        "source_results": related,
    })

probe_routes = {
    "retention_policy": {
        "method": "GET",
        "env_var": "RETENTION_POLICY_URL",
        "default_path": "/api/admin/v1/object-storage/retention-policy",
    },
    "expired_export_cleanup": {
        "method": "POST",
        "env_var": "EXPIRED_EXPORT_CLEANUP_URL",
        "default_path": "/api/admin/v1/object-storage/cleanup/expired-exports",
    },
    "orphan_cleanup": {
        "method": "POST",
        "env_var": "ORPHAN_CLEANUP_URL",
        "default_path": "/api/admin/v1/object-storage/cleanup/orphans",
    },
    "audit_refs": {
        "method": "GET",
        "env_var": "AUDIT_REFS_URL",
        "default_path": "/api/admin/v1/audit?subject=object_storage_cleanup&limit=20",
    },
}
runtime_input_requirements = {
    "required_release_sha": signed_url_release_sha or "must match signed URL split evidence release_sha",
    "required_auth": "ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE with admin_operator access",
    "required_base_url": "STAGING_BASE_URL or explicit probe URL env vars",
    "required_probe_routes": probe_routes,
    "canonical_pass_report": str(canonical_report_path),
    "canonical_pass_results": str(canonical_results_path),
}
if not base_url:
    runtime_input_requirements["blocked_input_reason"] = "missing STAGING_BASE_URL; set explicit probe URL env vars if routes differ"
elif runtime_checks_passed and not release_sha_matches_signed_url:
    runtime_input_requirements["blocked_input_reason"] = "RELEASE_SHA must match signed URL split evidence release_sha"
else:
    runtime_input_requirements["blocked_input_reason"] = ""

report = {
    "schema_version": "stage0.rev2.staging.object_storage_retention_cleanup",
    "evidence_id": run_id,
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "environment": "staging",
    "kind": "object_storage_retention_cleanup",
    "status": "pass" if all_passed else "blocked",
    "release_sha": release_sha,
    "base_url": base_url,
    "validated_by_role": "admin_operator",
    "admin_user_id": admin_user_id,
    "admin_tenant_id": admin_tenant_id,
    "release_gate_check_id": "staging_object_storage_signed_downloads",
    "do_not_launch_condition_id": "object_storage_signed_retention_runtime_missing",
    "results_path": str(results_path),
    "split_evidence": {
        "signed_url_evidence": signed_url_evidence,
        "signed_url_ready": signed_url_ready,
        "signed_url_reason": signed_url_reason,
        "signed_url_release_sha": signed_url_release_sha,
        "release_sha_matches_signed_url": release_sha_matches_signed_url,
        "retention_cleanup_runtime_ready": runtime_checks_passed,
        "retention_cleanup_ready": all_passed,
    },
    "required_checks": sorted(required),
    "runtime_input_requirements": runtime_input_requirements,
    "coverage": coverage,
    "blocked_checks": blocked_or_failed,
    "gate_impact": {
        "check_level_item": "Private Beta/Staging object retention/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops/evidence/staging/`。",
        "can_clear_retention_cleanup_checklist_item": all_passed,
        "can_clear_release_gate_check": can_clear_release_gate_check,
        "remaining_release_gate_blockers_after_pass": [] if can_clear_release_gate_check else [
            "staging_object_storage_signed_downloads",
        ],
        "requires_release_gate_fixture_update_after_pass": all_passed,
        "preserved_release_gate_check_id": None if can_clear_release_gate_check else "staging_object_storage_signed_downloads",
        "preserved_do_not_launch_condition_id": None if can_clear_release_gate_check else "object_storage_signed_retention_runtime_missing",
    },
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
if all_passed:
    print(f"staging object-storage retention cleanup passed; evidence written to {report_path}", file=sys.stderr)
else:
    print(f"staging object-storage retention cleanup blocked; evidence written to {report_path}", file=sys.stderr)
print(report_path)
PY
)"

python3 - "$actual_report_path" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if report["status"] == "pass" else 2)
PY
