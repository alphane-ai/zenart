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
  summary="$(python3 - "$RESULTS_PATH" "$required_json" "$status" "$RELEASE_SHA" "$RELEASE_TAG" "$RELEASE_NOTES_PATH" "$IMAGE_REFS" "$MIGRATION_EVIDENCE" "$CONFIG_DIFF_EVIDENCE" "$OBSERVABILITY_EVIDENCE" "$BACKUP_RESTORE_EVIDENCE" "$ROLLBACK_EVIDENCE" "$SECURITY_SCAN_EVIDENCE" <<'PY'
import json
import sys
from pathlib import Path

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
    "rollback": sys.argv[12].strip(),
    "security_scan": sys.argv[13].strip(),
}
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
    "rollback_evidence": bool(evidence_refs["rollback"]),
    "security_scan_evidence": bool(evidence_refs["security_scan"]),
}
release_evidence_complete = all(release_evidence_required.values())
smoke_passed = status == "passed" and all(row.get("ok") is not False for row in rows) and not (required - set(categories))
go_no_go = {
    "decision": "go" if smoke_passed and release_evidence_complete and not blocked_conditions else "no-go",
    "smoke_passed": smoke_passed,
    "release_evidence_complete": release_evidence_complete,
    "blocked_conditions": blocked_conditions,
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
  for key in RELEASE_SHA RELEASE_NOTES_PATH IMAGE_REFS MIGRATION_EVIDENCE CONFIG_DIFF_EVIDENCE OBSERVABILITY_EVIDENCE BACKUP_RESTORE_EVIDENCE ROLLBACK_EVIDENCE SECURITY_SCAN_EVIDENCE SMOKE_USER_ID SMOKE_TENANT_ID SMOKE_ADMIN_USER_ID SMOKE_ADMIN_TENANT_ID SMOKE_TASK_ID SMOKE_PACKAGE_ID SMOKE_EXPORT_ID; do
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
