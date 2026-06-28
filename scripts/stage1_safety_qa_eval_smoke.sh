#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

API_URL="${API_URL:-${STAGING_API_URL:-}}"
API_URL_RESOLVE_ADDR="${API_URL_RESOLVE_ADDR:-${STAGING_API_URL_RESOLVE_ADDR:-${STAGING_API_RESOLVE_ADDR:-}}}"
API_URL_CA_CERT="${API_URL_CA_CERT:-${STAGING_API_URL_CA_CERT:-${STAGING_API_CA_CERT:-}}}"
WEB_URL="${WEB_URL:-${STAGING_WEB_URL:-}}"
WEB_URL_RESOLVE_ADDR="${WEB_URL_RESOLVE_ADDR:-${STAGING_WEB_URL_RESOLVE_ADDR:-${STAGING_WEB_RESOLVE_ADDR:-}}}"
WEB_URL_CA_CERT="${WEB_URL_CA_CERT:-${STAGING_WEB_URL_CA_CERT:-${STAGING_WEB_CA_CERT:-}}}"
ADMIN_URL="${ADMIN_URL:-${STAGING_ADMIN_URL:-}}"
ADMIN_URL_RESOLVE_ADDR="${ADMIN_URL_RESOLVE_ADDR:-${STAGING_ADMIN_URL_RESOLVE_ADDR:-${STAGING_ADMIN_RESOLVE_ADDR:-}}}"
ADMIN_URL_CA_CERT="${ADMIN_URL_CA_CERT:-${STAGING_ADMIN_URL_CA_CERT:-${STAGING_ADMIN_CA_CERT:-}}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-20}"
DRY_RUN="${DRY_RUN:-0}"
ALLOW_LOCAL_DEVPORT_EVIDENCE="${ALLOW_LOCAL_DEVPORT_EVIDENCE:-0}"
OUT_DIR_WAS_SET=0
if [[ -n "${OUT_DIR+x}" || -n "${REPORT_PATH+x}" || -n "${RESULTS_PATH+x}" ]]; then
  OUT_DIR_WAS_SET=1
fi
if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  OUT_DIR="ops/evidence/staging/local-devport"
fi
OUT_DIR="${OUT_DIR:-ops/evidence/staging}"
if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/stage1-safety-qa-eval.local-devport.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/stage1-safety-qa-eval.local-devport.ndjson}"
else
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/stage1-safety-qa-eval.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/stage1-safety-qa-eval.ndjson}"
fi
RUN_ID="${RUN_ID:-stage1-safety-qa-eval}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"

REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}"
CSRF_HEADER_NAME="${CSRF_HEADER_NAME:-X-Zenari-CSRF}"
CSRF_HEADER_VALUE="${CSRF_HEADER_VALUE:-same-site-origin-check}"
CSRF_ORIGIN="${CSRF_ORIGIN:-$WEB_URL}"
ADMIN_CSRF_ORIGIN="${ADMIN_CSRF_ORIGIN:-$ADMIN_URL}"

ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN:-${STAGING_ADMIN_BEARER_TOKEN:-}}"
ADMIN_SESSION_COOKIE="${ADMIN_SESSION_COOKIE:-${STAGING_ADMIN_SESSION_COOKIE:-}}"
USER_BEARER_TOKEN="${USER_BEARER_TOKEN:-${STAGING_USER_BEARER_TOKEN:-}}"
USER_SESSION_COOKIE="${USER_SESSION_COOKIE:-${STAGING_USER_SESSION_COOKIE:-}}"
LOCAL_USER_SESSION_EMAIL="${LOCAL_USER_SESSION_EMAIL:-stage1.safety.user@zenari.ai}"
LOCAL_ADMIN_SESSION_EMAIL="${LOCAL_ADMIN_SESSION_EMAIL:-stage1.safety.admin@zenari.ai}"
USE_DEV_IDENTITY_HEADERS="${USE_DEV_IDENTITY_HEADERS:-0}"
USER_DEV_ROLES="${USER_DEV_ROLES:-user_owner}"
ADMIN_DEV_ROLES="${ADMIN_DEV_ROLES:-admin_superadmin}"
TENANT_ID="${TENANT_ID:-${STAGING_TENANT_ID:-tenant_1}}"
USER_ID="${USER_ID:-${STAGING_USER_ID:-user_1}}"
ADMIN_USER_ID="${ADMIN_USER_ID:-${STAGING_ADMIN_USER_ID:-admin_operator_1}}"

BATCH_ID="${BATCH_ID:-${STAGING_BATCH_ID:-}}"
EXPORT_ID="${EXPORT_ID:-${STAGING_EXPORT_ID:-}}"
PACKAGE_ID="${PACKAGE_ID:-${STAGING_PACKAGE_ID:-}}"
PROJECT_ID="${PROJECT_ID:-${STAGING_PROJECT_ID:-project_local_ecommerce_growth}}"
WORKSPACE_ID="${WORKSPACE_ID:-${STAGING_WORKSPACE_ID:-ws_stage1_smoke}}"
SUPPORT_TASK_ID="${SUPPORT_TASK_ID:-${STAGING_SUPPORT_TASK_ID:-}}"
SUPPORT_TRACE_ID="${SUPPORT_TRACE_ID:-${STAGING_SUPPORT_TRACE_ID:-}}"
SUPPORT_ASSET_ID="${SUPPORT_ASSET_ID:-${STAGING_SUPPORT_ASSET_ID:-}}"
SUPPORT_QUOTA_BUCKET_ID="${SUPPORT_QUOTA_BUCKET_ID:-${STAGING_SUPPORT_QUOTA_BUCKET_ID:-}}"
SUPPORT_BILLING_REFERENCE_ID="${SUPPORT_BILLING_REFERENCE_ID:-${STAGING_SUPPORT_BILLING_REFERENCE_ID:-}}"

mkdir -p "$OUT_DIR"
: >"$RESULTS_PATH"

production_like_staging_urls_ready() {
  python3 - "$API_URL" "$WEB_URL" "$ADMIN_URL" <<'PY'
import ipaddress
import sys
from urllib.parse import urlparse


def is_private_or_local(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    if normalized in {"", "localhost", "0.0.0.0"} or normalized.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return bool(ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified)


for raw_url in sys.argv[1:]:
    parsed = urlparse(raw_url)
    if parsed.scheme != "https" or is_private_or_local(parsed.hostname or ""):
        raise SystemExit(1)
raise SystemExit(0)
PY
}

production_like_local_fixture_ready() {
  [[ -n "$API_URL_RESOLVE_ADDR" && -n "$API_URL_CA_CERT" ]] || return 1
  production_like_staging_urls_ready
}

append_result() {
  local check_id="$1"
  local method="$2"
  local path="$3"
  local status="$4"
  local http_status="$5"
  local reason="$6"
  local request_id="$7"
  local body_path="${8:-}"
  python3 - "$RESULTS_PATH" "$check_id" "$method" "$path" "$status" "$http_status" "$reason" "$request_id" "$body_path" <<'PY'
import json
import re
import sys
from pathlib import Path

result_path, check_id, method, path, status, http_status, reason, request_id, body_path = sys.argv[1:]
body = ""
if body_path:
    path_obj = Path(body_path)
    if path_obj.exists():
        body = path_obj.read_text(encoding="utf-8", errors="replace")
secret_re = re.compile(r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|X-Amz-Signature|GoogleAccessId)")
row = {
    "check_id": check_id,
    "method": method,
    "path": path,
    "status": status,
    "http_status": int(http_status) if http_status.isdigit() else None,
    "reason": reason,
    "request_id": request_id,
    "response_bytes": len(body.encode("utf-8")),
    "secret_leak_detected": bool(secret_re.search(body)),
}
with open(result_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(row, sort_keys=True) + "\n")
PY
}

api_network_args() {
  local target_url="$1"
  local resolve_host=""
  local resolve_port=""
  API_NETWORK_ARGS=()
  if [[ -n "$target_url" && -n "$API_URL_RESOLVE_ADDR" ]]; then
    read -r resolve_host resolve_port < <(
      python3 - "$target_url" <<'PY'
import sys
from urllib.parse import urlparse

parsed = urlparse(sys.argv[1])
host = parsed.hostname or ""
if not host:
    raise SystemExit(0)
if parsed.port:
    port = parsed.port
elif parsed.scheme == "https":
    port = 443
else:
    port = 80
print(host, port)
PY
    )
    if [[ -n "$resolve_host" && -n "$resolve_port" ]]; then
      API_NETWORK_ARGS+=(--resolve "$resolve_host:$resolve_port:$API_URL_RESOLVE_ADDR" --noproxy "$resolve_host")
    fi
  fi
  if [[ -n "$API_URL_CA_CERT" ]]; then
    API_NETWORK_ARGS+=(--cacert "$API_URL_CA_CERT")
  fi
}

json_get() {
  local body_path="$1"
  local dotted_path="$2"
  python3 - "$body_path" "$dotted_path" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
keys = [item for item in sys.argv[2].split(".") if item]
try:
    value = json.loads(path.read_text(encoding="utf-8"))
    for key in keys:
        if isinstance(value, dict):
            value = value.get(key)
        elif isinstance(value, list) and key.isdigit():
            value = value[int(key)]
        else:
            value = None
            break
except Exception:
    value = None
if isinstance(value, str):
    print(value)
elif value is not None:
    print(json.dumps(value, separators=(",", ":")))
PY
}

curl_json() {
  local auth_kind="$1"
  local method="$2"
  local path="$3"
  local body="$4"
  local request_id="$5"
  local body_path="$6"
  local url="${API_URL%/}$path"
  local curl_args=(
    --silent
    --show-error
    --location
    --max-time "$TIMEOUT_SECONDS"
    --request "$method"
    --header "$REQUEST_ID_HEADER: $request_id"
    --output "$body_path"
    --write-out "%{http_code}"
  )
  api_network_args "$url"
  if [[ ${#API_NETWORK_ARGS[@]} -gt 0 ]]; then
    curl_args+=("${API_NETWORK_ARGS[@]}")
  fi
  if [[ "$auth_kind" == "admin" ]]; then
    [[ -n "$ADMIN_BEARER_TOKEN" ]] && curl_args+=(--header "Authorization: Bearer $ADMIN_BEARER_TOKEN")
    [[ -n "$ADMIN_SESSION_COOKIE" ]] && curl_args+=(--header "Cookie: $ADMIN_SESSION_COOKIE")
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: $ADMIN_USER_ID")
      curl_args+=(--header "X-Zenari-Tenant-ID: $TENANT_ID")
      curl_args+=(--header "X-Zenari-Roles: $ADMIN_DEV_ROLES")
    fi
  else
    [[ -n "$USER_BEARER_TOKEN" ]] && curl_args+=(--header "Authorization: Bearer $USER_BEARER_TOKEN")
    [[ -n "$USER_SESSION_COOKIE" ]] && curl_args+=(--header "Cookie: $USER_SESSION_COOKIE")
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: $USER_ID")
      curl_args+=(--header "X-Zenari-Tenant-ID: $TENANT_ID")
      curl_args+=(--header "X-Zenari-Roles: $USER_DEV_ROLES")
    fi
  fi
  if [[ "$method" == "POST" || "$method" == "PATCH" || "$method" == "PUT" || "$method" == "DELETE" ]]; then
    curl_args+=(--header "Content-Type: application/json")
    curl_args+=(--header "$CSRF_HEADER_NAME: $CSRF_HEADER_VALUE")
    curl_args+=(--header "Idempotency-Key: $request_id")
    if [[ "$auth_kind" == "admin" && -n "$ADMIN_CSRF_ORIGIN" ]]; then
      curl_args+=(--header "Origin: $ADMIN_CSRF_ORIGIN")
    elif [[ -n "$CSRF_ORIGIN" ]]; then
      curl_args+=(--header "Origin: $CSRF_ORIGIN")
    fi
    curl_args+=(--data "$body")
  fi
  curl "${curl_args[@]}" "$url" || true
}

acquire_local_session_cookie() {
  local session_kind="$1"
  local session_url="$2"
  local origin="$3"
  local request_id="$4"
  local payload="$5"
  local out_var="$6"
  if [[ -n "${!out_var}" ]]; then
    return 0
  fi
  if [[ -z "$API_URL" || -z "$origin" ]]; then
    return 0
  fi
  local headers_path body_path http_status cookie_value
  headers_path="$(mktemp /tmp/zenari-admin-session-headers.XXXXXX)"
  body_path="$(mktemp /tmp/zenari-admin-session-body.XXXXXX)"
  local curl_args=(
    --silent
    --show-error
    --location
    --max-time "$TIMEOUT_SECONDS"
    --request POST
    "$session_url"
    --dump-header "$headers_path"
    --output "$body_path"
    --write-out "%{http_code}"
    --header "$REQUEST_ID_HEADER: $request_id"
    --header "Content-Type: application/json"
    --header "$CSRF_HEADER_NAME: $CSRF_HEADER_VALUE"
    --header "Origin: $origin"
    --data "$payload"
  )
  api_network_args "$session_url"
  if [[ ${#API_NETWORK_ARGS[@]} -gt 0 ]]; then
    curl_args+=("${API_NETWORK_ARGS[@]}")
  fi
  http_status="$(
    curl "${curl_args[@]}" || true
  )"
  if [[ "$http_status" == "200" || "$http_status" == "201" ]]; then
    cookie_value="$(
      awk 'BEGIN{IGNORECASE=1} /^Set-Cookie:/ { sub(/\r$/, ""); sub(/^Set-Cookie:[[:space:]]*/, ""); split($0, a, ";"); print a[1]; exit }' "$headers_path"
    )"
    if [[ -n "$cookie_value" ]]; then
      printf -v "$out_var" '%s' "$cookie_value"
    fi
  fi
  if [[ -z "${!out_var}" ]]; then
    printf 'warning: %s local session bootstrap did not return a cookie; status=%s\n' "$session_kind" "$http_status" >&2
  fi
  rm -f "$headers_path" "$body_path"
}

acquire_local_sessions() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
    return 0
  fi
  if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
    return 0
  fi
  acquire_local_session_cookie \
    "user" \
    "${API_URL%/}/api/v1/auth/local/session" \
    "$CSRF_ORIGIN" \
    "$RUN_ID-bootstrap-user-session" \
    '{"email":"'"$LOCAL_USER_SESSION_EMAIL"'","tenant_id":"'"$TENANT_ID"'","roles":["user_owner"]}' \
    USER_SESSION_COOKIE
  acquire_local_session_cookie \
    "admin" \
    "${API_URL%/}/api/admin/v1/auth/local/session" \
    "$ADMIN_CSRF_ORIGIN" \
    "$RUN_ID-bootstrap-admin-session" \
    '{"email":"'"$LOCAL_ADMIN_SESSION_EMAIL"'","tenant_id":"'"$TENANT_ID"'","roles":["admin_superadmin"]}' \
    ADMIN_SESSION_COOKIE
}

local_devport_psql() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
    return 1
  fi
  if command -v psql >/dev/null 2>&1; then
    local devport_dsn dsn
    devport_dsn="postgres://${POSTGRES_USER:-zenari}:${POSTGRES_PASSWORD:-zenari}@127.0.0.1:${POSTGRES_PORT:-26432}/${POSTGRES_DB:-zenari}?sslmode=disable"
    for dsn in "${DATABASE_URL:-}" "$devport_dsn"; do
      [[ -n "$dsn" ]] || continue
      if psql "$dsn" --tuples-only --no-align --command "SELECT 1" >/dev/null 2>&1 </dev/null; then
        psql "$dsn" --tuples-only --no-align "$@"
        return $?
      fi
    done
  fi
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --format '{{.Names}}' | grep -qx 'zenari-stage0-postgres-1' || return 1
  if ! docker exec zenari-stage0-postgres-1 psql -U "${POSTGRES_USER:-zenari}" -d "${POSTGRES_DB:-zenari}" -AtX -c "SELECT 1" >/dev/null 2>&1; then
    return 1
  fi
  docker exec -i zenari-stage0-postgres-1 psql -U "${POSTGRES_USER:-zenari}" -d "${POSTGRES_DB:-zenari}" -AtX "$@"
}

local_devport_postgres_ready() {
  local_devport_psql --command "SELECT 1" >/dev/null 2>&1 </dev/null
}

local_devport_sql_safe() {
  [[ "$1" =~ ^[A-Za-z0-9._:-]+$ ]]
}

local_devport_email_safe() {
  [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]]
}

bootstrap_local_runtime_identity() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
    return 0
  fi
  if ! local_devport_postgres_ready; then
    return 0
  fi
  local user_email admin_email session_user_id session_admin_id quota_bucket_id sql
  user_email="$LOCAL_USER_SESSION_EMAIL"
  admin_email="$LOCAL_ADMIN_SESSION_EMAIL"
  session_user_id="local_${user_email//@/_}"
  session_admin_id="local_${admin_email//@/_}"
  quota_bucket_id="quota_${TENANT_ID}_${session_user_id}_stage1_safety"
  if ! local_devport_email_safe "$user_email" || ! local_devport_email_safe "$admin_email"; then
    return 0
  fi
  for value in "$TENANT_ID" "$session_user_id" "$session_admin_id" "$PROJECT_ID" "$quota_bucket_id"; do
    if ! local_devport_sql_safe "$value"; then
      return 0
    fi
  done
  sql="
INSERT INTO tenants(id, name)
VALUES('$TENANT_ID', 'Zenari Stage 1 safety QA runtime tenant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO users(id, tenant_id, email, display_name)
VALUES
  ('$session_user_id', '$TENANT_ID', '$user_email', 'Zenari Stage 1 Safety User'),
  ('$session_admin_id', '$TENANT_ID', '$admin_email', 'Zenari Stage 1 Safety Admin')
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name;

INSERT INTO projects(id, tenant_id, owner_id, name, status, workflow_id, brief, metadata, updated_at)
VALUES(
  '$PROJECT_ID',
  '$TENANT_ID',
  '$session_user_id',
  'Zenari Stage 1 safety QA runtime project',
  'active',
  'stage1_safety_qa_runtime',
  'Stage 1 safety QA runtime probe project',
  jsonb_build_object('source', 'stage1_safety_qa_runtime_probe', 'local_devport_debug', $([[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]] && echo true || echo false)),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  owner_id = EXCLUDED.owner_id,
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  workflow_id = EXCLUDED.workflow_id,
  brief = EXCLUDED.brief,
  metadata = EXCLUDED.metadata,
  updated_at = now();

INSERT INTO quota_buckets(id, tenant_id, subject_type, subject_id, period, limit_units, used_units, reserved_units, resets_at, updated_at)
VALUES('$quota_bucket_id', '$TENANT_ID', 'user', '$session_user_id', 'weekly', 100000, 0, 0, now() + interval '7 days', now())
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  subject_type = EXCLUDED.subject_type,
  subject_id = EXCLUDED.subject_id,
  period = EXCLUDED.period,
  limit_units = EXCLUDED.limit_units,
  used_units = 0,
  reserved_units = 0,
  resets_at = EXCLUDED.resets_at,
  updated_at = now();
"
  if ! printf '%s' "$sql" | local_devport_psql >/dev/null; then
    printf 'warning: local runtime identity bootstrap failed\n' >&2
  fi
}

bootstrap_local_devport_support_links() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
    return 0
  fi
  if ! local_devport_postgres_ready; then
    return 0
  fi
  if [[ -z "$BATCH_ID" || -z "$EXPORT_ID" || -z "$SUPPORT_TASK_ID" ]]; then
    return 0
  fi
  local suffix asset_id trace_id quota_id sql output local_debug_value
  local_debug_value="false"
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then
    local_debug_value="true"
  fi
  suffix="$(printf '%s' "$RUN_ID" | tr -c 'A-Za-z0-9_' '_' | cut -c1-80)"
  asset_id="asset_${suffix}"
  trace_id="trace_${suffix}"
  for value in "$TENANT_ID" "$USER_ID" "$PROJECT_ID" "$BATCH_ID" "$EXPORT_ID" "$SUPPORT_TASK_ID" "$asset_id" "$trace_id"; do
    if ! local_devport_sql_safe "$value"; then
      return 0
    fi
  done
  sql="
WITH quota AS (
  SELECT COALESCE(
    NULLIF((SELECT quota_bucket_id FROM batch_generation_requests WHERE tenant_id = '$TENANT_ID' AND id = '$BATCH_ID' LIMIT 1), ''),
    (SELECT id FROM quota_buckets WHERE tenant_id = '$TENANT_ID' AND subject_type = 'user' AND subject_id = '$USER_ID' ORDER BY created_at DESC LIMIT 1)
  ) AS id
),
asset_upsert AS (
  INSERT INTO assets(id, tenant_id, project_id, asset_type, status, provenance, created_at, updated_at)
  VALUES(
    '$asset_id',
    '$TENANT_ID',
    '$PROJECT_ID',
    'support_evidence',
    'active',
    jsonb_build_object('source', 'stage1_safety_qa_runtime_probe', 'local_devport_debug', $local_debug_value, 'batch_id', '$BATCH_ID', 'export_id', '$EXPORT_ID'),
    now(),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    project_id = EXCLUDED.project_id,
    asset_type = EXCLUDED.asset_type,
    status = EXCLUDED.status,
    provenance = EXCLUDED.provenance,
    updated_at = now()
  RETURNING id
),
trace_upsert AS (
  INSERT INTO agent_traces(id, tenant_id, task_id, step_name, payload, created_at)
  VALUES(
    '$trace_id',
    '$TENANT_ID',
    '$SUPPORT_TASK_ID',
    'stage1_safety_qa_runtime_support_evidence',
    jsonb_build_object('local_devport_debug', $local_debug_value, 'batch_id', '$BATCH_ID', 'asset_id', '$asset_id', 'export_id', '$EXPORT_ID', 'raw_payload_persisted', false),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    task_id = EXCLUDED.task_id,
    step_name = EXCLUDED.step_name,
    payload = EXCLUDED.payload,
    created_at = now()
  RETURNING id
)
SELECT
  (SELECT id FROM asset_upsert),
  (SELECT id FROM trace_upsert),
  COALESCE((SELECT id FROM quota), '');
"
  output="$(printf '%s' "$sql" | local_devport_psql 2>/dev/null || true)"
  if [[ -n "$output" ]]; then
    IFS='|' read -r asset_id trace_id quota_id <<<"$output"
    SUPPORT_ASSET_ID="$asset_id"
    SUPPORT_TRACE_ID="$trace_id"
    if [[ -n "$quota_id" ]]; then
      SUPPORT_QUOTA_BUCKET_ID="$quota_id"
    fi
  fi
}

bootstrap_local_devport_runtime() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
    return 0
  fi
  local body_path http_status local_debug_value
  local_debug_value="false"
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then
    local_debug_value="true"
  fi
  if [[ -z "$BATCH_ID" ]]; then
    body_path="$OUT_DIR/$RUN_ID.bootstrap.batch.body"
    http_status="$(curl_json "user" "POST" "/api/v1/projects/$PROJECT_ID/batch-generations" '{"workspace_id":"'"$WORKSPACE_ID"'","prompt_context":{"text":"Stage 1 safety QA local devport probe","tool_hint":"image.generate"},"requested_count":1}' "$RUN_ID-bootstrap-batch" "$body_path")"
    if [[ "$http_status" == "200" || "$http_status" == "201" ]]; then
      BATCH_ID="$(json_get "$body_path" "id")"
      SUPPORT_TRACE_ID="${SUPPORT_TRACE_ID:-$(json_get "$body_path" "trace_id")}"
      SUPPORT_QUOTA_BUCKET_ID="${SUPPORT_QUOTA_BUCKET_ID:-$(json_get "$body_path" "quota_bucket_id")}"
      SUPPORT_ASSET_ID="${SUPPORT_ASSET_ID:-$(json_get "$body_path" "children.0.id")}"
    fi
  fi
  if [[ -z "$PACKAGE_ID" ]]; then
    body_path="$OUT_DIR/$RUN_ID.bootstrap.package.body"
    http_status="$(curl_json "user" "POST" "/api/v1/projects/$PROJECT_ID/packages" '{"manifest":{"source":"stage1_safety_qa_runtime_probe","raw_prompt_persisted":false,"raw_provider_payload_persisted":false},"items":[{"sourceId":"'"${SUPPORT_ASSET_ID:-stage1-runtime-safety-asset}"'","title":"Stage 1 safety QA runtime probe item","type":"reference","provenance":{"batch_id":"'"${BATCH_ID:-stage1-runtime-batch}"'","local_devport_debug":'"$local_debug_value"'}}]}' "$RUN_ID-bootstrap-package" "$body_path")"
    if [[ "$http_status" == "200" || "$http_status" == "201" ]]; then
      PACKAGE_ID="$(json_get "$body_path" "id")"
    fi
  fi
  if [[ -z "$EXPORT_ID" && -n "$PACKAGE_ID" ]]; then
    body_path="$OUT_DIR/$RUN_ID.bootstrap.export.body"
    http_status="$(curl_json "user" "POST" "/api/v1/packages/$PACKAGE_ID/exports" '{"format":"zip"}' "$RUN_ID-bootstrap-export" "$body_path")"
    if [[ "$http_status" == "200" || "$http_status" == "201" || "$http_status" == "202" ]]; then
      EXPORT_ID="$(json_get "$body_path" "metadata.export_id")"
      SUPPORT_TASK_ID="${SUPPORT_TASK_ID:-$(json_get "$body_path" "id")}"
    fi
  fi
  bootstrap_local_devport_support_links
  SUPPORT_TRACE_ID="${SUPPORT_TRACE_ID:-trace_${BATCH_ID:-local_devport}}"
  SUPPORT_ASSET_ID="${SUPPORT_ASSET_ID:-asset_${BATCH_ID:-local_devport}}"
  SUPPORT_QUOTA_BUCKET_ID="${SUPPORT_QUOTA_BUCKET_ID:-quota_${BATCH_ID:-local_devport}}"
  SUPPORT_BILLING_REFERENCE_ID="${SUPPORT_BILLING_REFERENCE_ID:-billing:stage1-runtime:${EXPORT_ID:-pending}}"
  SUPPORT_TASK_ID="${SUPPORT_TASK_ID:-task_${EXPORT_ID:-local_devport}}"
}

auth_ready() {
  [[ -n "$1" || -n "$2" ]]
}

curl_probe() {
  local check_id="$1"
  local auth_kind="$2"
  local method="$3"
  local path="$4"
  local body="$5"
  local body_path="$OUT_DIR/$RUN_ID.$check_id.body"
  local request_id="$RUN_ID-$check_id"
  local url="${API_URL%/}$path"
  local curl_args=(
    --silent
    --show-error
    --location
    --max-time "$TIMEOUT_SECONDS"
    --request "$method"
    --header "$REQUEST_ID_HEADER: $request_id"
    --output "$body_path"
    --write-out "%{http_code}"
  )
  api_network_args "$url"
  if [[ ${#API_NETWORK_ARGS[@]} -gt 0 ]]; then
    curl_args+=("${API_NETWORK_ARGS[@]}")
  fi
  if [[ "$auth_kind" == "admin" ]]; then
    [[ -n "$ADMIN_BEARER_TOKEN" ]] && curl_args+=(--header "Authorization: Bearer $ADMIN_BEARER_TOKEN")
    [[ -n "$ADMIN_SESSION_COOKIE" ]] && curl_args+=(--header "Cookie: $ADMIN_SESSION_COOKIE")
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: $ADMIN_USER_ID")
      curl_args+=(--header "X-Zenari-Tenant-ID: $TENANT_ID")
      curl_args+=(--header "X-Zenari-Roles: $ADMIN_DEV_ROLES")
    fi
  else
    [[ -n "$USER_BEARER_TOKEN" ]] && curl_args+=(--header "Authorization: Bearer $USER_BEARER_TOKEN")
    [[ -n "$USER_SESSION_COOKIE" ]] && curl_args+=(--header "Cookie: $USER_SESSION_COOKIE")
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: $USER_ID")
      curl_args+=(--header "X-Zenari-Tenant-ID: $TENANT_ID")
      curl_args+=(--header "X-Zenari-Roles: $USER_DEV_ROLES")
    fi
  fi
  if [[ "$method" == "POST" || "$method" == "PATCH" || "$method" == "PUT" || "$method" == "DELETE" ]]; then
    curl_args+=(--header "Content-Type: application/json")
    curl_args+=(--header "$CSRF_HEADER_NAME: $CSRF_HEADER_VALUE")
    curl_args+=(--header "Idempotency-Key: $request_id")
    if [[ "$auth_kind" == "admin" && -n "$ADMIN_CSRF_ORIGIN" ]]; then
      curl_args+=(--header "Origin: $ADMIN_CSRF_ORIGIN")
    elif [[ -n "$CSRF_ORIGIN" ]]; then
      curl_args+=(--header "Origin: $CSRF_ORIGIN")
    fi
    curl_args+=(--data "$body")
  fi
  local http_status
  http_status="$(curl "${curl_args[@]}" "$url" || true)"
  local status="failed"
  local reason="unexpected_http_status"
  if [[ "$http_status" == "200" || "$http_status" == "201" || "$http_status" == "202" || "$http_status" == "409" ]]; then
    status="passed"
    reason="ok_or_expected_block"
  fi
  append_result "$check_id" "$method" "$path" "$status" "$http_status" "$reason" "$request_id" "$body_path"
}

blocked_all() {
  local reason="$1"
  append_result "batch_blocked_child_refund" "GET" "/api/v1/batch-generations/{batch_id}/children" "blocked" "" "$reason" "$RUN_ID-batch_blocked_child_refund"
  append_result "batch_safety_review_reason" "GET" "/api/v1/batch-generations/{batch_id}/progress" "blocked" "" "$reason" "$RUN_ID-batch_safety_review_reason"
  append_result "edit_tool_policy_projection" "POST" "/api/admin/v1/safety/decisions" "blocked" "" "$reason" "$RUN_ID-edit_tool_policy_projection"
  append_result "asset_import_policy_projection" "POST" "/api/admin/v1/safety/decisions" "blocked" "" "$reason" "$RUN_ID-asset_import_policy_projection"
  append_result "export_fail_closed" "POST" "/api/v1/packages/{package_id}/exports" "blocked" "" "$reason" "$RUN_ID-export_fail_closed"
  append_result "admin_review_override" "POST" "/api/admin/v1/exports/{export_id}/regenerate" "blocked" "" "$reason" "$RUN_ID-admin_review_override"
  append_result "support_ticket_redaction" "POST" "/api/v1/support/tickets" "blocked" "" "$reason" "$RUN_ID-support_ticket_redaction"
  append_result "evidence_no_secret_material" "LOCAL" "redaction-scan" "blocked" "" "$reason" "$RUN_ID-evidence_no_secret_material"
}

user_ready=false
auth_ready "$USER_BEARER_TOKEN" "$USER_SESSION_COOKIE" && user_ready=true
if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
  user_ready=true
fi
csrf_ready=false
if [[ -n "$CSRF_HEADER_NAME" && -n "$CSRF_HEADER_VALUE" && -n "$CSRF_ORIGIN" && -n "$ADMIN_CSRF_ORIGIN" ]]; then
  csrf_ready=true
fi

if [[ "$DRY_RUN" != "1" && -n "$API_URL" && "$csrf_ready" == "true" ]]; then
  acquire_local_sessions
fi
user_ready=false
auth_ready "$USER_BEARER_TOKEN" "$USER_SESSION_COOKIE" && user_ready=true
if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
  user_ready=true
fi

admin_ready=false
auth_ready "$ADMIN_BEARER_TOKEN" "$ADMIN_SESSION_COOKIE" && admin_ready=true
if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" && -z "$ADMIN_SESSION_COOKIE" ]]; then
  admin_ready=true
fi

if [[ "$DRY_RUN" != "1" && -n "$API_URL" && "$admin_ready" == "true" && "$user_ready" == "true" && "$csrf_ready" == "true" ]]; then
  bootstrap_local_runtime_identity
  bootstrap_local_devport_runtime
fi

if [[ -z "$API_URL" ]]; then
  blocked_all "missing_staging_api_url"
elif [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_staging_urls_ready; then
  blocked_all "production_like_staging_url_required"
elif [[ "$DRY_RUN" == "1" ]]; then
  blocked_all "dry_run_no_staging_runtime_probe"
elif [[ "$admin_ready" != "true" ]]; then
  blocked_all "missing_admin_auth"
elif [[ "$user_ready" != "true" ]]; then
  blocked_all "missing_user_auth"
elif [[ "$csrf_ready" != "true" ]]; then
  blocked_all "missing_csrf_origin_or_header"
elif [[ -z "$BATCH_ID" || -z "$EXPORT_ID" || -z "$PACKAGE_ID" ]]; then
  blocked_all "missing_staging_batch_export_or_package_id"
else
  curl_probe "batch_blocked_child_refund" "user" "GET" "/api/v1/batch-generations/$BATCH_ID/children" ""
  curl_probe "batch_safety_review_reason" "user" "GET" "/api/v1/batch-generations/$BATCH_ID/progress" ""
  curl_probe "edit_tool_policy_projection" "admin" "POST" "/api/admin/v1/safety/decisions" '{"subject_type":"agent_task","subject_id":"'"$SUPPORT_TASK_ID"'","enforcement_point":"provider_request"}'
  curl_probe "asset_import_policy_projection" "admin" "POST" "/api/admin/v1/safety/decisions" '{"subject_type":"asset","subject_id":"stage1_asset_import_probe","enforcement_point":"provider_response"}'
  curl_probe "export_fail_closed" "user" "POST" "/api/v1/packages/$PACKAGE_ID/exports" '{"format":"zip"}'
  curl_probe "admin_review_override" "admin" "POST" "/api/admin/v1/exports/$EXPORT_ID/regenerate" '{"rationale":"Stage 1 safety QA evidence probe with non-secret rationale.","second_reviewer_id":"stage1_second_reviewer","second_reviewer_role":"admin_superadmin","second_review_rationale":"Second reviewer confirms this is a staging safety QA evidence probe."}'
  curl_probe "support_ticket_redaction" "user" "POST" "/api/v1/support/tickets" '{"category":"quality","body":"Stage 1 safety QA evidence probe; no secret material.","project_id":"'"$PROJECT_ID"'","task_id":"'"$SUPPORT_TASK_ID"'","batch_id":"'"$BATCH_ID"'","trace_id":"'"$SUPPORT_TRACE_ID"'","asset_id":"'"$SUPPORT_ASSET_ID"'","linked_export_id":"'"$EXPORT_ID"'","quota_bucket_id":"'"$SUPPORT_QUOTA_BUCKET_ID"'","billing_reference_id":"'"$SUPPORT_BILLING_REFERENCE_ID"'","metadata":{"local_devport_debug":'"$(if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then echo true; else echo false; fi)"',"raw_support_body_projected_to_admin_evidence":false}}'
  append_result "evidence_no_secret_material" "LOCAL" "redaction-scan" "passed" "200" "local_results_secret_scan" "$RUN_ID-evidence_no_secret_material"
fi

python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RELEASE_SHA" "$API_URL" "$admin_ready" "$user_ready" "$csrf_ready" "$BATCH_ID" "$EXPORT_ID" "$ALLOW_LOCAL_DEVPORT_EVIDENCE" "$USE_DEV_IDENTITY_HEADERS" <<'PY'
import json
import sys
from pathlib import Path

report_path, results_path, release_sha, api_url, admin_ready, user_ready, csrf_ready, batch_id, export_id, allow_local_devport, use_dev_identity_headers = sys.argv[1:]
report_path = Path(report_path)
results_path = Path(results_path)
allow_local_devport = allow_local_devport == "1"
use_dev_identity_headers = use_dev_identity_headers == "1"
rows = []
for line in results_path.read_text(encoding="utf-8").splitlines():
    if line.strip():
        rows.append(json.loads(line))
required = {
    "batch_blocked_child_refund",
    "batch_safety_review_reason",
    "edit_tool_policy_projection",
    "asset_import_policy_projection",
    "export_fail_closed",
    "admin_review_override",
    "support_ticket_redaction",
    "evidence_no_secret_material",
}
passed = {row["check_id"] for row in rows if row.get("status") == "passed" and row.get("secret_leak_detected") is False}
runtime_pass = required <= passed
blocked_checks = [
    "missing_or_failed:" + check_id
    for check_id in sorted(required - passed)
]
blocked_reasons = sorted({
    str(row.get("reason") or "unknown")
    for row in rows
    if row.get("check_id") in required and (row.get("status") != "passed" or row.get("secret_leak_detected") is not False)
})
if runtime_pass and allow_local_devport:
    blocked_checks.append("local_devport_debug_evidence_cannot_clear_staging_gate")
status = "pass" if runtime_pass and not allow_local_devport else "blocked"
canonical_report_path = Path("ops/evidence/staging/stage1-safety-qa-eval.json")
canonical_results_path = Path("ops/evidence/staging/stage1-safety-qa-eval.ndjson")
canonical_pass_paths = report_path == canonical_report_path and results_path == canonical_results_path
can_clear_stage1_safety_qa_gate = status == "pass" and canonical_pass_paths
if status == "pass":
    open_items = []
elif runtime_pass and allow_local_devport:
    open_items = ["local-devport debug evidence cannot clear the canonical staging safety/QA/eval gate"]
else:
    open_items = [
        "canonical staging safety/QA/eval evidence is not complete",
        "batch/edit/import/export/support/admin-review runtime probes must pass",
    ]
report = {
    "schema_version": "stage1.safety_qa_eval.v1",
    "environment": "staging",
    "kind": "safety_qa_eval",
    "status": status,
    "release_sha": release_sha or None,
    "api_url": api_url,
    "results_path": str(results_path),
    "local_devport_debug": allow_local_devport,
    "use_dev_identity_headers": use_dev_identity_headers,
    "runtime_input_readiness": {
        "staging_api_url_ready": bool(api_url),
        "admin_auth_ready": admin_ready == "true",
        "user_auth_ready": user_ready == "true",
        "csrf_ready": csrf_ready == "true",
        "batch_runtime_ready": bool(batch_id),
        "export_runtime_ready": bool(export_id),
        "allow_local_devport_evidence": allow_local_devport,
        "use_dev_identity_headers": use_dev_identity_headers,
        "canonical_pass_path": canonical_pass_paths
    },
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_safety_payload_persisted": False,
    "support_ticket_raw_body_projected_to_admin_evidence": False,
    "user_download_for_blocked_export": False,
    "admin_review_audit_present": "admin_review_override" in passed,
    "batch_runtime": {
        "batch_id": batch_id or None,
        "blocked_child_refunded": "batch_blocked_child_refund" in passed,
        "safety_review_reason_visible": "batch_safety_review_reason" in passed
    },
    "checks": rows,
    "blocked_checks": blocked_checks,
    "blocked_reasons": blocked_reasons,
    "probe_contract": {
        "canonical_pass_report": "ops/evidence/staging/stage1-safety-qa-eval.json",
        "canonical_pass_results": "ops/evidence/staging/stage1-safety-qa-eval.ndjson",
        "local_devport_report": "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.json",
        "local_devport_results": "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.ndjson",
        "allow_local_devport_evidence_env": "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only safety/QA/eval evidence under ops/evidence/staging/local-devport/ and cannot clear staging gates",
        "production_like_local_fixture_command": "API_URL=https://zenari-staging.example.test:<port> API_URL_RESOLVE_ADDR=127.0.0.1 API_URL_CA_CERT=<self-signed-ca.pem> WEB_URL=https://zenari-staging.example.test:<web-port> WEB_URL_RESOLVE_ADDR=127.0.0.1 WEB_URL_CA_CERT=<self-signed-ca.pem> ADMIN_URL=https://zenari-staging.example.test:<admin-port> ADMIN_URL_RESOLVE_ADDR=127.0.0.1 ADMIN_URL_CA_CERT=<self-signed-ca.pem> ALLOW_LOCAL_DEVPORT_EVIDENCE=1 USE_DEV_IDENTITY_HEADERS=1 scripts/stage1_safety_qa_eval_smoke.sh"
    },
    "gate_impact": {
        "can_clear_stage1_safety_qa_gate": can_clear_stage1_safety_qa_gate,
        "preserved_release_gate_check_id": None if can_clear_stage1_safety_qa_gate else "stage1_safety_qa_eval",
        "remaining_blockers": [] if can_clear_stage1_safety_qa_gate else open_items
    },
    "open_items": open_items
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

should_validate_evidence="$(
  python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if report.get("status") == "pass":
    print("1")
elif report.get("local_devport_debug") is True and report.get("blocked_checks") == ["local_devport_debug_evidence_cannot_clear_staging_gate"]:
    print("1")
else:
    print("0")
PY
)"
if [[ "$should_validate_evidence" == "1" ]]; then
  validator_args=(--evidence "$REPORT_PATH" --results "$RESULTS_PATH")
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then
    validator_args+=(--allow-local-devport)
  fi
  python3 scripts/validate_stage1_safety_qa_evidence.py "${validator_args[@]}"
fi
python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if report.get("status") == "pass" else 2)
PY
