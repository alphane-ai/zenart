#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PRESET_API_URL="${API_URL-}"
PRESET_API_URL_RESOLVE_ADDR="${API_URL_RESOLVE_ADDR-}"
PRESET_API_URL_CA_CERT="${API_URL_CA_CERT-}"
PRESET_STAGING_API_URL="${STAGING_API_URL-}"
PRESET_TIME_OUT_SECONDS="${TIMEOUT_SECONDS-}"
PRESET_DATABASE_URL="${DATABASE_URL-}"
PRESET_POSTGRES_USER="${POSTGRES_USER-}"
PRESET_POSTGRES_DB="${POSTGRES_DB-}"
PRESET_LLM_PROVIDER="${LLM_PROVIDER-}"
PRESET_LLM_OPENAI_BASE_URL="${LLM_OPENAI_BASE_URL-}"
PRESET_LLM_OPENAI_API_KEY="${LLM_OPENAI_API_KEY-}"
PRESET_LLM_OPENAI_RESOLVE_ADDR="${LLM_OPENAI_RESOLVE_ADDR-}"
PRESET_LLM_OPENAI_CA_CERT="${LLM_OPENAI_CA_CERT-}"
PRESET_ZAI_API_KEY="${ZAI_API_KEY-}"
PRESET_OPENAI_API_KEY="${OPENAI_API_KEY-}"
PRESET_LLM_OPENAI_MODEL="${LLM_OPENAI_MODEL-}"
PRESET_LLM_ENABLE_LIVE_CALLS="${LLM_ENABLE_LIVE_CALLS-}"
PRESET_WORKER_BATCH_ENABLED="${WORKER_BATCH_ENABLED-}"
PRESET_AUTO_SEED_PROVIDER_REGISTRY="${AUTO_SEED_PROVIDER_REGISTRY-}"
PRESET_ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN-}"
PRESET_ADMIN_SESSION_COOKIE="${ADMIN_SESSION_COOKIE-}"
PRESET_USER_BEARER_TOKEN="${USER_BEARER_TOKEN-}"
PRESET_USER_SESSION_COOKIE="${USER_SESSION_COOKIE-}"
PRESET_USE_DEV_IDENTITY_HEADERS="${USE_DEV_IDENTITY_HEADERS-}"
PRESET_ADMIN_DEV_ROLES="${ADMIN_DEV_ROLES-}"
PRESET_USER_DEV_ROLES="${USER_DEV_ROLES-}"
PRESET_TENANT_ID="${TENANT_ID-}"
PRESET_PROJECT_ID="${PROJECT_ID-}"
PRESET_WORKSPACE_ID="${WORKSPACE_ID-}"
PRESET_CSRF_ORIGIN="${CSRF_ORIGIN-}"
PRESET_RELEASE_SHA="${RELEASE_SHA-}"
PRESET_POLL_ATTEMPTS="${POLL_ATTEMPTS-}"
PRESET_POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS-}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

restore_preset_env() {
  local name="$1"
  local value="$2"
  if [[ -n "$value" ]]; then
    printf -v "$name" '%s' "$value"
    export "$name"
  fi
}

restore_preset_env API_URL "$PRESET_API_URL"
restore_preset_env API_URL_RESOLVE_ADDR "$PRESET_API_URL_RESOLVE_ADDR"
restore_preset_env API_URL_CA_CERT "$PRESET_API_URL_CA_CERT"
restore_preset_env STAGING_API_URL "$PRESET_STAGING_API_URL"
restore_preset_env TIMEOUT_SECONDS "$PRESET_TIME_OUT_SECONDS"
restore_preset_env DATABASE_URL "$PRESET_DATABASE_URL"
restore_preset_env POSTGRES_USER "$PRESET_POSTGRES_USER"
restore_preset_env POSTGRES_DB "$PRESET_POSTGRES_DB"
restore_preset_env LLM_PROVIDER "$PRESET_LLM_PROVIDER"
restore_preset_env LLM_OPENAI_BASE_URL "$PRESET_LLM_OPENAI_BASE_URL"
restore_preset_env LLM_OPENAI_API_KEY "$PRESET_LLM_OPENAI_API_KEY"
restore_preset_env LLM_OPENAI_RESOLVE_ADDR "$PRESET_LLM_OPENAI_RESOLVE_ADDR"
restore_preset_env LLM_OPENAI_CA_CERT "$PRESET_LLM_OPENAI_CA_CERT"
restore_preset_env ZAI_API_KEY "$PRESET_ZAI_API_KEY"
restore_preset_env OPENAI_API_KEY "$PRESET_OPENAI_API_KEY"
restore_preset_env LLM_OPENAI_MODEL "$PRESET_LLM_OPENAI_MODEL"
restore_preset_env LLM_ENABLE_LIVE_CALLS "$PRESET_LLM_ENABLE_LIVE_CALLS"
restore_preset_env WORKER_BATCH_ENABLED "$PRESET_WORKER_BATCH_ENABLED"
restore_preset_env AUTO_SEED_PROVIDER_REGISTRY "$PRESET_AUTO_SEED_PROVIDER_REGISTRY"
restore_preset_env ADMIN_BEARER_TOKEN "$PRESET_ADMIN_BEARER_TOKEN"
restore_preset_env ADMIN_SESSION_COOKIE "$PRESET_ADMIN_SESSION_COOKIE"
restore_preset_env USER_BEARER_TOKEN "$PRESET_USER_BEARER_TOKEN"
restore_preset_env USER_SESSION_COOKIE "$PRESET_USER_SESSION_COOKIE"
restore_preset_env USE_DEV_IDENTITY_HEADERS "$PRESET_USE_DEV_IDENTITY_HEADERS"
restore_preset_env ADMIN_DEV_ROLES "$PRESET_ADMIN_DEV_ROLES"
restore_preset_env USER_DEV_ROLES "$PRESET_USER_DEV_ROLES"
restore_preset_env TENANT_ID "$PRESET_TENANT_ID"
restore_preset_env PROJECT_ID "$PRESET_PROJECT_ID"
restore_preset_env WORKSPACE_ID "$PRESET_WORKSPACE_ID"
restore_preset_env CSRF_ORIGIN "$PRESET_CSRF_ORIGIN"
restore_preset_env RELEASE_SHA "$PRESET_RELEASE_SHA"
restore_preset_env POLL_ATTEMPTS "$PRESET_POLL_ATTEMPTS"
restore_preset_env POLL_INTERVAL_SECONDS "$PRESET_POLL_INTERVAL_SECONDS"

API_URL="${API_URL:-${STAGING_API_URL:-}}"
API_URL_RESOLVE_ADDR="${API_URL_RESOLVE_ADDR:-${STAGING_API_URL_RESOLVE_ADDR:-${STAGING_API_RESOLVE_ADDR:-}}}"
API_URL_CA_CERT="${API_URL_CA_CERT:-${STAGING_API_URL_CA_CERT:-${STAGING_API_CA_CERT:-}}}"
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
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/stage1-provider-sandbox.local-devport.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/stage1-provider-sandbox.local-devport.ndjson}"
else
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/stage1-provider-sandbox.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/stage1-provider-sandbox.ndjson}"
fi
RUN_ID="${RUN_ID:-stage1-provider-sandbox}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
PROVIDER_ID="${PROVIDER_ID:-zenari-image-sandbox}"
MODEL_ID="${MODEL_ID:-${LLM_OPENAI_MODEL:-glm-5.2}}"
USER_MODEL_ID="${USER_MODEL_ID:-$MODEL_ID}"
TOOL_TYPE="${TOOL_TYPE:-generate}"
REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}"
CSRF_HEADER_NAME="${CSRF_HEADER_NAME:-X-Zenari-CSRF}"
CSRF_HEADER_VALUE="${CSRF_HEADER_VALUE:-same-site-origin-check}"
CSRF_ORIGIN="${CSRF_ORIGIN:-${STAGING_ADMIN_URL:-${ADMIN_URL:-${STAGING_WEB_URL:-${WEB_URL:-}}}}}"

LLM_PROVIDER="${LLM_PROVIDER:-openai-compatible}"
LLM_OPENAI_BASE_URL="${LLM_OPENAI_BASE_URL:-https://api.z.ai/api/coding/paas/v4}"
LLM_OPENAI_API_KEY="$(python3 - "${LLM_OPENAI_API_KEY:-}" "${ZAI_API_KEY:-}" "${OPENAI_API_KEY:-}" <<'PY'
import sys

def placeholder(value: str) -> bool:
    normalized = value.strip()
    return not normalized or normalized == "replace_me" or "replace_me" in normalized

for candidate in sys.argv[1:]:
    if not placeholder(candidate):
        print(candidate)
        break
else:
    print(sys.argv[1].strip() if len(sys.argv) > 1 else "")
PY
)"
LLM_OPENAI_RESOLVE_ADDR="${LLM_OPENAI_RESOLVE_ADDR:-${ZAI_RESOLVE_ADDR:-}}"
LLM_OPENAI_CA_CERT="${LLM_OPENAI_CA_CERT:-${ZAI_CA_CERT:-}}"
LLM_ENABLE_LIVE_CALLS="${LLM_ENABLE_LIVE_CALLS:-false}"
WORKER_BATCH_ENABLED="${WORKER_BATCH_ENABLED:-false}"

ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN:-${STAGING_ADMIN_BEARER_TOKEN:-}}"
ADMIN_SESSION_COOKIE="${ADMIN_SESSION_COOKIE:-${STAGING_ADMIN_SESSION_COOKIE:-}}"
USER_BEARER_TOKEN="${USER_BEARER_TOKEN:-${STAGING_USER_BEARER_TOKEN:-}}"
USER_SESSION_COOKIE="${USER_SESSION_COOKIE:-${STAGING_USER_SESSION_COOKIE:-}}"
LOCAL_USER_SESSION_EMAIL="${LOCAL_USER_SESSION_EMAIL:-stage1.provider.user@zenari.ai}"
LOCAL_ADMIN_SESSION_EMAIL="${LOCAL_ADMIN_SESSION_EMAIL:-stage1.provider.admin@zenari.ai}"
USE_DEV_IDENTITY_HEADERS="${USE_DEV_IDENTITY_HEADERS:-0}"
USER_DEV_ROLES="${USER_DEV_ROLES:-user_owner}"
ADMIN_DEV_ROLES="${ADMIN_DEV_ROLES:-admin_superadmin}"

if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then
  PROJECT_ID="${PROJECT_ID:-${STAGING_PROJECT_ID:-project_local_ecommerce_growth}}"
  WORKSPACE_ID="${WORKSPACE_ID:-${STAGING_WORKSPACE_ID:-ws_stage1_smoke}}"
  TENANT_ID="${TENANT_ID:-${STAGING_TENANT_ID:-tenant_local}}"
  USER_ID="${USER_ID:-${STAGING_USER_ID:-user_local_user}}"
  ADMIN_USER_ID="${ADMIN_USER_ID:-${STAGING_ADMIN_USER_ID:-user_local_admin}}"
else
  PROJECT_ID="${PROJECT_ID:-${STAGING_PROJECT_ID:-}}"
  WORKSPACE_ID="${WORKSPACE_ID:-${STAGING_WORKSPACE_ID:-}}"
  TENANT_ID="${TENANT_ID:-${STAGING_TENANT_ID:-tenant_1}}"
  USER_ID="${USER_ID:-${STAGING_USER_ID:-user_1}}"
  ADMIN_USER_ID="${ADMIN_USER_ID:-${STAGING_ADMIN_USER_ID:-admin_operator_1}}"
fi
PROMPT_TEXT="${PROMPT_TEXT:-Zenari provider sandbox smoke: generate a simple launch poster concept.}"
REQUESTED_COUNT="${REQUESTED_COUNT:-1}"
POLL_ATTEMPTS="${POLL_ATTEMPTS:-20}"
POLL_INTERVAL_SECONDS="${POLL_INTERVAL_SECONDS:-2}"
AUTO_SEED_PROVIDER_REGISTRY="${AUTO_SEED_PROVIDER_REGISTRY:-0}"
PROVIDER_SECRET_REF="${PROVIDER_SECRET_REF:-secrets/provider/$PROVIDER_ID}"

mkdir -p "$OUT_DIR"
: >"$RESULTS_PATH"

has_secret_shape() {
  python3 - "$1" <<'PY'
import re
import sys
text = sys.argv[1]
pattern = re.compile(r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})")
raise SystemExit(0 if pattern.search(text) else 1)
PY
}

redact_secret_file_in_place() {
  local path="$1"
  if [[ -z "$path" || ! -f "$path" ]]; then
    return 0
  fi
  python3 - "$path" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8", errors="replace")
secret_re = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
path.write_text(secret_re.sub("[redacted]", text), encoding="utf-8")
PY
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
  local expected_tokens="${9:-}"
  python3 - "$RESULTS_PATH" "$check_id" "$method" "$path" "$status" "$http_status" "$reason" "$request_id" "$body_path" "$expected_tokens" <<'PY'
import json
import re
import sys
from pathlib import Path

result_path, check_id, method, path, status, http_status, reason, request_id, body_path, expected_tokens = sys.argv[1:]
body = ""
persisted_body_path = None
if body_path:
    path_obj = Path(body_path)
    if path_obj.exists():
        body = path_obj.read_text(encoding="utf-8", errors="replace")
secret_re = re.compile(r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})")
secret_leak_detected = bool(secret_re.search(body))
if body_path and secret_leak_detected:
    Path(body_path).write_text("[redacted secret-bearing response omitted]\n", encoding="utf-8")
if body_path and body and not secret_leak_detected:
    persisted_body_path = body_path
tokens = [item.strip() for item in expected_tokens.split(",") if item.strip()]
body_lower = body.lower()
matched = [token for token in tokens if token.lower() in body_lower]
missing = [token for token in tokens if token.lower() not in body_lower]
if status == "passed" and missing:
    status = "failed"
    reason = "missing_expected_tokens"
row = {
    "check_id": check_id,
    "method": method,
    "path": path,
    "status": status,
    "http_status": int(http_status) if http_status.isdigit() else None,
    "reason": reason,
    "request_id": request_id,
    "expected_tokens": tokens,
    "matched_tokens": matched,
    "missing_tokens": missing,
    "body_path": persisted_body_path,
    "response_bytes": len(body.encode("utf-8")),
    "secret_leak_detected": secret_leak_detected,
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

llm_models_url() {
  python3 - "$LLM_OPENAI_BASE_URL" <<'PY'
import sys
from urllib.parse import urlparse, urlunparse

raw = sys.argv[1].strip()
parsed = urlparse(raw)
path = parsed.path.rstrip("/")
if not path or path == "/":
    path = "/models"
elif not path.endswith("/models"):
    path = path + "/models"
print(urlunparse((parsed.scheme, parsed.netloc, path, "", "", "")))
PY
}

production_like_staging_url_ready() {
  python3 - "$API_URL" <<'PY'
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


parsed = urlparse(sys.argv[1])
if parsed.scheme != "https" or is_private_or_local(parsed.hostname or ""):
    raise SystemExit(1)
raise SystemExit(0)
PY
}

production_like_local_fixture_ready() {
  [[ -n "$API_URL_RESOLVE_ADDR" && -n "$API_URL_CA_CERT" ]] || return 1
  production_like_staging_url_ready
}

run_adapter_health_probe() {
  local check_id="adapter_health_probe"
  local body_path="$OUT_DIR/$RUN_ID.$check_id.body"
  local stderr_path="$OUT_DIR/$RUN_ID.$check_id.stderr"
  local request_id="$RUN_ID-$check_id"
  local http_status="200"
  local status="failed"
  local reason="openai_compatible_selftest_failed"
  if LLM_PROVIDER="$LLM_PROVIDER" \
    LLM_OPENAI_BASE_URL="$LLM_OPENAI_BASE_URL" \
    LLM_OPENAI_API_KEY="$LLM_OPENAI_API_KEY" \
    LLM_OPENAI_RESOLVE_ADDR="$LLM_OPENAI_RESOLVE_ADDR" \
    LLM_OPENAI_CA_CERT="$LLM_OPENAI_CA_CERT" \
    LLM_OPENAI_MODEL="$MODEL_ID" \
    LLM_ENABLE_LIVE_CALLS="$LLM_ENABLE_LIVE_CALLS" \
    TIMEOUT_SECONDS="$TIMEOUT_SECONDS" \
    bash scripts/openai_compatible_provider_selftest.sh >"$body_path" 2>"$stderr_path"; then
    status="passed"
    reason="ok"
    if has_secret_shape "$(cat "$body_path")"; then
      status="failed"
      reason="secret_shape_in_response"
    fi
  else
    redact_secret_file_in_place "$stderr_path"
    {
      printf 'openai-compatible provider selftest failed\n'
      sed -n '1,40p' "$stderr_path" 2>/dev/null || true
    } >"$body_path"
    if has_secret_shape "$(cat "$body_path")"; then
      printf 'openai-compatible provider selftest failed: redacted provider error\n' >"$body_path"
    fi
  fi
  append_result "$check_id" "SELFTEST" "scripts/openai_compatible_provider_selftest.sh" "$status" "$http_status" "$reason" "$request_id" "$body_path" "openai-compatible provider selftest passed,$MODEL_ID,chat_completion_chars"
}

curl_probe() {
  local check_id="$1"
  local method="$2"
  local path="$3"
  local auth_kind="$4"
  local body="$5"
  local expected_tokens="$6"
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
    if [[ -n "$ADMIN_BEARER_TOKEN" ]]; then
      curl_args+=(--header "Authorization: Bearer $ADMIN_BEARER_TOKEN")
    fi
    if [[ -n "$ADMIN_SESSION_COOKIE" ]]; then
      curl_args+=(--header "Cookie: $ADMIN_SESSION_COOKIE")
    fi
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: $ADMIN_USER_ID")
      curl_args+=(--header "X-Zenari-Tenant-ID: $TENANT_ID")
      curl_args+=(--header "X-Zenari-Roles: $ADMIN_DEV_ROLES")
    fi
  else
    if [[ -n "$USER_BEARER_TOKEN" ]]; then
      curl_args+=(--header "Authorization: Bearer $USER_BEARER_TOKEN")
    fi
    if [[ -n "$USER_SESSION_COOKIE" ]]; then
      curl_args+=(--header "Cookie: $USER_SESSION_COOKIE")
    fi
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: $USER_ID")
      curl_args+=(--header "X-Zenari-Tenant-ID: $TENANT_ID")
      curl_args+=(--header "X-Zenari-Roles: $USER_DEV_ROLES")
    fi
  fi
  if [[ "$method" == "POST" || "$method" == "PATCH" || "$method" == "PUT" || "$method" == "DELETE" ]]; then
    curl_args+=(--header "Content-Type: application/json")
    curl_args+=(--header "$CSRF_HEADER_NAME: $CSRF_HEADER_VALUE")
    if [[ -n "$CSRF_ORIGIN" ]]; then
      curl_args+=(--header "Origin: $CSRF_ORIGIN")
    fi
    curl_args+=(--header "Idempotency-Key: $request_id")
    curl_args+=(--data "$body")
  fi
  local http_status
  http_status="$(curl "${curl_args[@]}" "$url" || true)"
  local status="failed"
  local reason="unexpected_http_status"
  if [[ "$http_status" == "200" || "$http_status" == "201" || "$http_status" == "202" ]]; then
    status="passed"
    reason="ok"
    if has_secret_shape "$(cat "$body_path")"; then
      status="failed"
      reason="secret_shape_in_response"
    fi
  fi
  append_result "$check_id" "$method" "$path" "$status" "$http_status" "$reason" "$request_id" "$body_path" "$expected_tokens"
}

local_fixture_psql() {
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
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  if ! docker ps --format '{{.Names}}' | grep -qx 'zenari-stage0-postgres-1'; then
    return 1
  fi
  if ! docker exec zenari-stage0-postgres-1 psql -U "${POSTGRES_USER:-zenari}" -d "${POSTGRES_DB:-zenari}" -AtX -c "SELECT 1" >/dev/null 2>&1; then
    return 1
  fi
  docker exec -i zenari-stage0-postgres-1 psql -U "${POSTGRES_USER:-zenari}" -d "${POSTGRES_DB:-zenari}" -AtX "$@"
}

local_fixture_postgres_ready() {
  local_fixture_psql --command "SELECT 1" >/dev/null 2>&1 </dev/null
}

local_fixture_sql_safe() {
  [[ "$1" =~ ^[A-Za-z0-9._:-]+$ ]]
}

local_fixture_email_safe() {
  [[ "$1" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$ ]]
}

local_session_user_id_for_email() {
  printf 'local_%s' "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed 's/@/_/g')"
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
  headers_path="$(mktemp /tmp/zenari-provider-session-headers.XXXXXX)"
  body_path="$(mktemp /tmp/zenari-provider-session-body.XXXXXX)"
  local session_curl_args=(
    --silent
    --show-error
    --location
    --max-time "$TIMEOUT_SECONDS"
    --request POST "$session_url"
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
    session_curl_args+=("${API_NETWORK_ARGS[@]}")
  fi
  http_status="$(curl "${session_curl_args[@]}" || true)"
  if [[ "$http_status" == "200" || "$http_status" == "201" ]]; then
    cookie_value="$(
      awk 'BEGIN{IGNORECASE=1} /^Set-Cookie:/ { sub(/\r$/, ""); sub(/^Set-Cookie:[[:space:]]*/, ""); split($0, a, ";"); print a[1]; exit }' "$headers_path"
    )"
    if [[ -n "$cookie_value" ]]; then
      printf -v "$out_var" '%s' "$cookie_value"
    fi
  fi
  if [[ -z "${!out_var}" ]]; then
    printf 'warning: %s local provider session bootstrap did not return a cookie; status=%s\n' "$session_kind" "$http_status" >&2
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
    "$CSRF_ORIGIN" \
    "$RUN_ID-bootstrap-admin-session" \
    '{"email":"'"$LOCAL_ADMIN_SESSION_EMAIL"'","tenant_id":"'"$TENANT_ID"'","roles":["admin_superadmin"]}' \
    ADMIN_SESSION_COOKIE
}

bootstrap_local_runtime_identity() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
    return 0
  fi
  if ! local_fixture_postgres_ready; then
    return 0
  fi
  local session_user_id session_admin_id quota_bucket_id sql
  session_user_id="$(local_session_user_id_for_email "$LOCAL_USER_SESSION_EMAIL")"
  session_admin_id="$(local_session_user_id_for_email "$LOCAL_ADMIN_SESSION_EMAIL")"
  PROJECT_ID="${PROJECT_ID:-project_stage1_provider_sandbox_runtime}"
  WORKSPACE_ID="${WORKSPACE_ID:-ws_stage1_provider_sandbox_runtime}"
  quota_bucket_id="quota_${TENANT_ID}_${session_user_id}_stage1_provider"
  if ! local_fixture_email_safe "$LOCAL_USER_SESSION_EMAIL" || ! local_fixture_email_safe "$LOCAL_ADMIN_SESSION_EMAIL"; then
    return 0
  fi
  for value in "$TENANT_ID" "$session_user_id" "$session_admin_id" "$PROJECT_ID" "$WORKSPACE_ID" "$quota_bucket_id"; do
    if ! local_fixture_sql_safe "$value"; then
      return 0
    fi
  done
  USER_ID="$session_user_id"
  ADMIN_USER_ID="$session_admin_id"
  sql="
INSERT INTO tenants(id, name)
VALUES('$TENANT_ID', 'Zenari Stage 1 provider sandbox runtime tenant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO users(id, tenant_id, email, display_name)
VALUES
  ('$session_user_id', '$TENANT_ID', '$LOCAL_USER_SESSION_EMAIL', 'Zenari Stage 1 Provider User'),
  ('$session_admin_id', '$TENANT_ID', '$LOCAL_ADMIN_SESSION_EMAIL', 'Zenari Stage 1 Provider Admin')
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name;

INSERT INTO projects(id, tenant_id, owner_id, name, status, workflow_id, brief, metadata, updated_at)
VALUES(
  '$PROJECT_ID',
  '$TENANT_ID',
  '$session_user_id',
  'Zenari Stage 1 provider sandbox runtime project',
  'active',
  'stage1_provider_sandbox_runtime',
  'Stage 1 provider sandbox runtime probe project',
  jsonb_build_object('source', 'stage1_provider_sandbox_runtime_probe', 'local_devport_debug', $([[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]] && echo true || echo false)),
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

INSERT INTO workspaces(id, tenant_id, project_id, name, metadata, updated_at)
VALUES(
  '$WORKSPACE_ID',
  '$TENANT_ID',
  '$PROJECT_ID',
  'Zenari Stage 1 provider sandbox runtime workspace',
  jsonb_build_object('source', 'stage1_provider_sandbox_runtime_probe', 'local_devport_debug', $([[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]] && echo true || echo false)),
  now()
)
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  project_id = EXCLUDED.project_id,
  name = EXCLUDED.name,
  metadata = workspaces.metadata || EXCLUDED.metadata,
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
  if ! printf '%s' "$sql" | local_fixture_psql >/dev/null; then
    printf 'warning: local provider runtime identity bootstrap failed\n' >&2
  fi
}

refresh_auth_readiness() {
  user_auth_ready="0"
  if [[ -n "$USER_BEARER_TOKEN" || -n "$USER_SESSION_COOKIE" ]]; then
    user_auth_ready="1"
  fi
  if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
    user_auth_ready="1"
  fi
  admin_auth_ready="0"
  if [[ -n "$ADMIN_BEARER_TOKEN" || -n "$ADMIN_SESSION_COOKIE" ]]; then
    admin_auth_ready="1"
  fi
  if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" && -z "$ADMIN_SESSION_COOKIE" ]]; then
    admin_auth_ready="1"
  fi
}

acquire_local_devport_admin_session() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" || "$USE_DEV_IDENTITY_HEADERS" == "1" || -n "$ADMIN_BEARER_TOKEN" || -n "$ADMIN_SESSION_COOKIE" ]]; then
    return 0
  fi
  if [[ -z "$API_URL" || -z "$CSRF_ORIGIN" ]]; then
    return 0
  fi
  local headers_path body_path http_status cookie_value
  headers_path="$(mktemp /tmp/zenari-provider-admin-session-headers.XXXXXX)"
  body_path="$(mktemp /tmp/zenari-provider-admin-session-body.XXXXXX)"
  local session_url="${API_URL%/}/api/admin/v1/auth/local/session"
  local session_curl_args=(
    --silent
    --show-error
    --location
    --max-time "$TIMEOUT_SECONDS"
    --request POST "$session_url"
    --dump-header "$headers_path"
    --output "$body_path"
    --write-out "%{http_code}"
    --header "$REQUEST_ID_HEADER: $RUN_ID-bootstrap-admin-session"
    --header "Content-Type: application/json"
    --header "$CSRF_HEADER_NAME: $CSRF_HEADER_VALUE"
    --header "Origin: $CSRF_ORIGIN"
    --data '{"email":"admin@zenari.ai","tenant_id":"'"$TENANT_ID"'"}'
  )
  api_network_args "$session_url"
  if [[ ${#API_NETWORK_ARGS[@]} -gt 0 ]]; then
    session_curl_args+=("${API_NETWORK_ARGS[@]}")
  fi
  http_status="$(
    curl "${session_curl_args[@]}" || true
  )"
  if [[ "$http_status" == "200" || "$http_status" == "201" ]]; then
    cookie_value="$(
      awk 'BEGIN{IGNORECASE=1} /^Set-Cookie:/ { sub(/\r$/, ""); sub(/^Set-Cookie:[[:space:]]*/, ""); split($0, a, ";"); print a[1]; exit }' "$headers_path"
    )"
    if [[ -n "$cookie_value" ]]; then
      ADMIN_SESSION_COOKIE="$cookie_value"
    fi
  fi
  rm -f "$headers_path" "$body_path"
}

curl_probe_raw() {
  local check_id="$1"
  local method="$2"
  local path="$3"
  local auth_kind="$4"
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
    if [[ -n "$ADMIN_BEARER_TOKEN" ]]; then
      curl_args+=(--header "Authorization: Bearer $ADMIN_BEARER_TOKEN")
    fi
    if [[ -n "$ADMIN_SESSION_COOKIE" ]]; then
      curl_args+=(--header "Cookie: $ADMIN_SESSION_COOKIE")
    fi
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: $ADMIN_USER_ID")
      curl_args+=(--header "X-Zenari-Tenant-ID: $TENANT_ID")
      curl_args+=(--header "X-Zenari-Roles: $ADMIN_DEV_ROLES")
    fi
  else
    if [[ -n "$USER_BEARER_TOKEN" ]]; then
      curl_args+=(--header "Authorization: Bearer $USER_BEARER_TOKEN")
    fi
    if [[ -n "$USER_SESSION_COOKIE" ]]; then
      curl_args+=(--header "Cookie: $USER_SESSION_COOKIE")
    fi
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: $USER_ID")
      curl_args+=(--header "X-Zenari-Tenant-ID: $TENANT_ID")
      curl_args+=(--header "X-Zenari-Roles: $USER_DEV_ROLES")
    fi
  fi
  if [[ "$method" == "POST" || "$method" == "PATCH" || "$method" == "PUT" || "$method" == "DELETE" ]]; then
    curl_args+=(--header "Content-Type: application/json")
    curl_args+=(--header "$CSRF_HEADER_NAME: $CSRF_HEADER_VALUE")
    if [[ -n "$CSRF_ORIGIN" ]]; then
      curl_args+=(--header "Origin: $CSRF_ORIGIN")
    fi
    curl_args+=(--header "Idempotency-Key: $request_id")
    curl_args+=(--data "$body")
  fi
  curl "${curl_args[@]}" "$url" || true
}

provider_registry_contains_sandbox() {
  local body_path="$1"
  python3 - "$body_path" "$PROVIDER_ID" <<'PY'
import json
import sys
from pathlib import Path

body_path, provider_id = sys.argv[1:]
try:
    data = json.loads(Path(body_path).read_text(encoding="utf-8", errors="replace"))
except Exception:
    raise SystemExit(1)
items = data.get("items") if isinstance(data, dict) else None
if not isinstance(items, list):
    raise SystemExit(1)
for item in items:
    if isinstance(item, dict) and item.get("provider_id") == provider_id:
        raise SystemExit(0)
raise SystemExit(1)
PY
}

provider_registry_sandbox_ready() {
  local body_path="$1"
  python3 - "$body_path" "$PROVIDER_ID" "$USER_MODEL_ID" "$TOOL_TYPE" "$PROVIDER_SECRET_REF" <<'PY'
import json
import sys
from pathlib import Path

body_path, provider_id, model_id, tool_type, secret_ref = sys.argv[1:]
try:
    data = json.loads(Path(body_path).read_text(encoding="utf-8", errors="replace"))
except Exception:
    raise SystemExit(1)
items = data.get("items") if isinstance(data, dict) else None
if not isinstance(items, list):
    raise SystemExit(1)
for item in items:
    if not isinstance(item, dict) or item.get("provider_id") != provider_id:
        continue
    if item.get("status") != "enabled":
        raise SystemExit(1)
    routing = item.get("routing") if isinstance(item.get("routing"), dict) else {}
    if routing.get("kill_switch") is True:
        raise SystemExit(1)
    if item.get("secret_ref") != secret_ref:
        raise SystemExit(1)
    capabilities = item.get("capabilities")
    if not isinstance(capabilities, list):
        raise SystemExit(1)
    for capability in capabilities:
        if not isinstance(capability, dict):
            continue
        if capability.get("model_id") != model_id:
            continue
        tool_types = capability.get("tool_types") if isinstance(capability.get("tool_types"), list) else []
        endpoints = capability.get("endpoints") if isinstance(capability.get("endpoints"), list) else []
        if tool_type in tool_types or tool_type in endpoints or "image.generate" in endpoints:
            raise SystemExit(0)
raise SystemExit(1)
PY
}

sandbox_provider_create_body() {
  python3 - "$PROVIDER_ID" "$USER_MODEL_ID" "$PROVIDER_SECRET_REF" <<'PY'
import json
import sys
from datetime import datetime, timezone

provider_id, model_id, secret_ref = sys.argv[1:]
now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
capability = {
    "provider_id": provider_id,
    "model_id": model_id,
    "endpoints": ["image.generate"],
    "input_types": ["prompt"],
    "output_types": ["image"],
    "tool_types": ["generate"],
    "max_cost_units": 8,
    "cost_currency": "USD",
    "estimated_cost_cents": 12,
    "supports_batch": True,
    "max_batch_size": 20,
    "supports_seed": True,
    "supports_cancel": True,
    "supported_aspect_ratios": ["1:1", "16:9", "9:16"],
    "supported_qualities": ["draft", "standard", "high"],
}
print(json.dumps({
    "provider_id": provider_id,
    "display_name": "Zenari image sandbox",
    "mode": "sandbox",
    "status": "enabled",
    "secret_ref": secret_ref,
    "routing": {
        "weight": 100,
        "canary_percent": 0,
        "max_concurrency": 4,
        "fallback_provider_ids": ["dev"],
        "kill_switch": False,
    },
    "health": {
        "available": True,
        "latency_ms": 420,
        "error_rate_percent": 0,
        "last_checked_at": now,
        "message": "seeded by Stage 1 provider sandbox smoke",
    },
    "capabilities": [capability],
    "metadata": {
        "adapter": "openai-compatible",
        "adapter_endpoint_version": "openai_compatible_chat_completions_v1",
        "config_base_url_env": "LLM_OPENAI_BASE_URL",
        "config_live_calls_env": "LLM_ENABLE_LIVE_CALLS",
        "seed_source": "stage1_provider_sandbox_smoke",
    },
    "rationale": "Seed local Stage 1 sandbox provider registry entry for runtime smoke",
}))
PY
}

sandbox_provider_update_body() {
  python3 - "$PROVIDER_ID" "$USER_MODEL_ID" "$PROVIDER_SECRET_REF" <<'PY'
import json
import sys

provider_id, model_id, secret_ref = sys.argv[1:]
print(json.dumps({
    "status": "enabled",
    "secret_ref": secret_ref,
    "routing": {
        "weight": 100,
        "canary_percent": 0,
        "max_concurrency": 4,
        "fallback_provider_ids": ["dev"],
        "kill_switch": False,
    },
    "capabilities": [
        {
            "provider_id": provider_id,
            "model_id": model_id,
            "endpoints": ["image.generate"],
            "input_types": ["prompt"],
            "output_types": ["image"],
            "tool_types": ["generate"],
            "max_cost_units": 8,
            "cost_currency": "USD",
            "estimated_cost_cents": 12,
            "supports_batch": True,
            "max_batch_size": 20,
            "supports_seed": True,
            "supports_cancel": True,
            "supported_aspect_ratios": ["1:1", "16:9", "9:16"],
            "supported_qualities": ["draft", "standard", "high"],
        }
    ],
    "rationale": "Align Stage 1 sandbox provider registry capability for runtime smoke",
}))
PY
}

seed_provider_registry_if_needed() {
  local registry_body="$OUT_DIR/$RUN_ID.admin_registry.body"
  if [[ "$AUTO_SEED_PROVIDER_REGISTRY" != "1" || ! -f "$registry_body" ]]; then
    return 0
  fi
  if provider_registry_sandbox_ready "$registry_body"; then
    return 0
  fi
  local seed_body
  if provider_registry_contains_sandbox "$registry_body"; then
    seed_body="$(sandbox_provider_update_body)"
    curl_probe "admin_registry_seed" "PATCH" "/api/admin/v1/providers/registry/$PROVIDER_ID" "admin" "$seed_body" "$PROVIDER_ID,$USER_MODEL_ID"
  else
    seed_body="$(sandbox_provider_create_body)"
    curl_probe "admin_registry_seed" "POST" "/api/admin/v1/providers/registry" "admin" "$seed_body" "$PROVIDER_ID,$USER_MODEL_ID"
  fi
  curl_probe "admin_registry" "GET" "/api/admin/v1/providers/registry" "admin" "" "$PROVIDER_ID,openai-compatible"
}

check_status() {
  local check_id="$1"
  python3 - "$RESULTS_PATH" "$check_id" <<'PY'
import json
import sys
from pathlib import Path

results_path, check_id = sys.argv[1:]
status = ""
for line in Path(results_path).read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    row = json.loads(line)
    if row.get("check_id") == check_id:
        status = str(row.get("status") or "")
print(status)
PY
}

adapter_health_provider_failure() {
  local body_path="$OUT_DIR/$RUN_ID.adapter_health_probe.body"
  if [[ ! -f "$body_path" ]]; then
    return 0
  fi
  python3 - "$body_path" <<'PY'
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
for code in ("provider_quota_unavailable", "provider_retryable_http_error", "provider_http_error"):
    if code in text:
        print(code)
        raise SystemExit(0)
raise SystemExit(0)
PY
}

blocked_all() {
  local reason="$1"
  append_result "adapter_health_probe" "GET" "${LLM_OPENAI_BASE_URL%/}/models" "blocked" "" "$reason" "$RUN_ID-adapter_health_probe"
  append_result "admin_registry" "GET" "/api/admin/v1/providers/registry" "blocked" "" "$reason" "$RUN_ID-admin_registry"
  append_result "admin_sandbox_test_call" "POST" "/api/admin/v1/providers/registry/$PROVIDER_ID/test-call" "blocked" "" "$reason" "$RUN_ID-admin_sandbox_test_call"
  append_result "batch_create" "POST" "/api/v1/projects/$PROJECT_ID/batch-generations" "blocked" "" "$reason" "$RUN_ID-batch_create"
  append_result "batch_progress" "GET" "/api/v1/batch-generations/{batch_id}/progress" "blocked" "" "$reason" "$RUN_ID-batch_progress"
  append_result "batch_children" "GET" "/api/v1/batch-generations/{batch_id}/children" "blocked" "" "$reason" "$RUN_ID-batch_children"
}

user_auth_ready="0"
if [[ -n "$USER_BEARER_TOKEN" || -n "$USER_SESSION_COOKIE" ]]; then
  user_auth_ready="1"
fi
if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
  user_auth_ready="1"
fi
csrf_ready="0"
if [[ -n "$CSRF_HEADER_NAME" && -n "$CSRF_HEADER_VALUE" && -n "$CSRF_ORIGIN" ]]; then
  csrf_ready="1"
fi
bootstrap_local_runtime_identity
if [[ "$DRY_RUN" != "1" && -n "$API_URL" && "$csrf_ready" == "1" ]]; then
  acquire_local_sessions
fi
if [[ "$DRY_RUN" != "1" && -n "$API_URL" && "$csrf_ready" == "1" ]]; then
  acquire_local_devport_admin_session
fi
admin_auth_ready="0"
if [[ -n "$ADMIN_BEARER_TOKEN" || -n "$ADMIN_SESSION_COOKIE" ]]; then
  admin_auth_ready="1"
fi
if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" && -z "$ADMIN_SESSION_COOKIE" ]]; then
  admin_auth_ready="1"
fi
refresh_auth_readiness
llm_live_ready="0"
if [[ "$LLM_PROVIDER" == "openai-compatible" && "$LLM_ENABLE_LIVE_CALLS" == "true" && -n "$LLM_OPENAI_BASE_URL" && -n "$LLM_OPENAI_API_KEY" ]]; then
  llm_live_ready="1"
fi
llm_runtime_ready="$llm_live_ready"
if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" && "$LLM_ENABLE_LIVE_CALLS" != "true" ]]; then
  llm_runtime_ready="1"
fi
worker_batch_ready="0"
if [[ "$WORKER_BATCH_ENABLED" == "true" ]]; then
  worker_batch_ready="1"
fi

batch_id=""
if [[ "$DRY_RUN" == "1" ]]; then
  blocked_all "dry_run_no_staging_runtime_probe"
elif [[ -z "$API_URL" ]]; then
  blocked_all "missing_staging_api_url"
elif [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_staging_url_ready; then
  blocked_all "production_like_staging_url_required"
elif [[ "$admin_auth_ready" != "1" ]]; then
  blocked_all "missing_admin_auth"
elif [[ "$user_auth_ready" != "1" ]]; then
  blocked_all "missing_user_auth"
elif [[ "$csrf_ready" != "1" ]]; then
  blocked_all "missing_csrf_origin_or_header"
elif [[ "$llm_runtime_ready" != "1" ]]; then
  blocked_all "missing_openai_compatible_live_llm_config"
elif [[ "$worker_batch_ready" != "1" ]]; then
  blocked_all "worker_batch_not_enabled"
elif [[ -z "$PROJECT_ID" || -z "$WORKSPACE_ID" ]]; then
  blocked_all "missing_project_or_workspace_id"
else
  if [[ "$llm_live_ready" == "1" ]]; then
    run_adapter_health_probe
  else
    append_result "adapter_health_probe" "GET" "$(llm_models_url)" "blocked" "" "local_devport_offline_adapter_probe_skipped" "$RUN_ID-adapter_health_probe"
  fi
  curl_probe "admin_registry" "GET" "/api/admin/v1/providers/registry" "admin" "" "$PROVIDER_ID,openai-compatible"
  seed_provider_registry_if_needed
  sandbox_body="$(python3 - "$USER_MODEL_ID" "$TOOL_TYPE" <<'PY'
import json
import sys
model_id, tool_type = sys.argv[1:]
print(json.dumps({
    "model_id": model_id,
    "tool_type": tool_type,
    "prompt": "provider sandbox smoke prompt",
    "rationale": "Stage 1 provider sandbox smoke",
}))
PY
)"
  curl_probe "admin_sandbox_test_call" "POST" "/api/admin/v1/providers/registry/$PROVIDER_ID/test-call" "admin" "$sandbox_body" "succeeded,prompt_hash"
  if [[ "$llm_live_ready" == "1" && "$(check_status adapter_health_probe)" != "passed" ]]; then
    adapter_failure="$(adapter_health_provider_failure)"
    if [[ -n "$adapter_failure" ]]; then
      append_result "batch_create" "POST" "/api/v1/projects/$PROJECT_ID/batch-generations" "blocked" "" "$adapter_failure" "$RUN_ID-batch_create"
      append_result "batch_progress" "GET" "/api/v1/batch-generations/{batch_id}/progress" "blocked" "" "$adapter_failure" "$RUN_ID-batch_progress"
      append_result "batch_children" "GET" "/api/v1/batch-generations/{batch_id}/children" "blocked" "" "$adapter_failure" "$RUN_ID-batch_children"
    else
      append_result "batch_create" "POST" "/api/v1/projects/$PROJECT_ID/batch-generations" "blocked" "" "provider_health_preflight_failed" "$RUN_ID-batch_create"
      append_result "batch_progress" "GET" "/api/v1/batch-generations/{batch_id}/progress" "blocked" "" "provider_health_preflight_failed" "$RUN_ID-batch_progress"
      append_result "batch_children" "GET" "/api/v1/batch-generations/{batch_id}/children" "blocked" "" "provider_health_preflight_failed" "$RUN_ID-batch_children"
    fi
  else
  create_body="$(python3 - "$WORKSPACE_ID" "$PROMPT_TEXT" "$REQUESTED_COUNT" "$USER_MODEL_ID" <<'PY'
import json
import sys
workspace_id, prompt, requested_count, model_id = sys.argv[1:]
print(json.dumps({
    "workspace_id": workspace_id,
    "prompt_context": {
        "text": prompt,
        "model_hints": [model_id],
        "tool_hint": "image.generate",
    },
    "requested_count": int(requested_count),
    "allowed_models": [model_id],
}))
PY
)"
  curl_probe "batch_create" "POST" "/api/v1/projects/$PROJECT_ID/batch-generations" "user" "$create_body" "zenari-image-sandbox"
  batch_create_body="$OUT_DIR/$RUN_ID.batch_create.body"
  if [[ -f "$batch_create_body" ]]; then
    batch_id="$(python3 - "$batch_create_body" <<'PY'
import json
import sys
from pathlib import Path
try:
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except Exception:
    data = {}
print(data.get("id", ""))
PY
)"
  fi
  if [[ -z "$batch_id" ]]; then
    append_result "batch_progress" "GET" "/api/v1/batch-generations/{batch_id}/progress" "blocked" "" "missing_batch_id_after_create" "$RUN_ID-batch_progress"
    append_result "batch_children" "GET" "/api/v1/batch-generations/{batch_id}/children" "blocked" "" "missing_batch_id_after_create" "$RUN_ID-batch_children"
  else
    progress_http_status=""
    done_count="0"
    for _ in $(seq 1 "$POLL_ATTEMPTS"); do
      progress_http_status="$(curl_probe_raw "batch_progress" "GET" "/api/v1/batch-generations/$batch_id/progress" "user" "")"
      progress_body="$OUT_DIR/$RUN_ID.batch_progress.body"
      done_count="$(python3 - "$progress_body" <<'PY'
import json
import sys
from pathlib import Path
try:
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
except Exception:
    data = {}
print(int(data.get("succeeded", 0)))
PY
)"
      if [[ "$done_count" -ge 1 ]]; then
        break
      fi
      sleep "$POLL_INTERVAL_SECONDS"
    done
    progress_body="$OUT_DIR/$RUN_ID.batch_progress.body"
    progress_status="failed"
    progress_reason="succeeded_children_not_ready"
    if [[ "$progress_http_status" == "200" || "$progress_http_status" == "201" || "$progress_http_status" == "202" ]]; then
      if [[ "$done_count" -ge 1 ]]; then
        progress_status="passed"
        progress_reason="ok"
      fi
      if has_secret_shape "$(cat "$progress_body")"; then
        progress_status="failed"
        progress_reason="secret_shape_in_response"
      fi
    else
      progress_reason="unexpected_http_status"
    fi
    append_result "batch_progress" "GET" "/api/v1/batch-generations/$batch_id/progress" "$progress_status" "$progress_http_status" "$progress_reason" "$RUN_ID-batch_progress" "$progress_body" "succeeded"

    children_http_status="$(curl_probe_raw "batch_children" "GET" "/api/v1/batch-generations/$batch_id/children" "user" "")"
    children_body="$OUT_DIR/$RUN_ID.batch_children.body"
    children_ready_count="$(python3 - "$children_body" "$PROVIDER_ID" <<'PY'
import json
import sys
from pathlib import Path

body_path, provider_id = sys.argv[1:]
try:
    data = json.loads(Path(body_path).read_text(encoding="utf-8"))
except Exception:
    data = {}
items = data.get("items") if isinstance(data, dict) else []
if not isinstance(items, list):
    items = []
count = 0
for item in items:
    if not isinstance(item, dict):
        continue
    if item.get("status") == "succeeded" and item.get("asset_id") and item.get("canvas_object_id") and item.get("provider_id") == provider_id:
        count += 1
print(count)
PY
)"
    children_status="failed"
    children_reason="missing_succeeded_child_asset_canvas"
    if [[ "$children_http_status" == "200" || "$children_http_status" == "201" || "$children_http_status" == "202" ]]; then
      if [[ "$children_ready_count" -ge 1 ]]; then
        children_status="passed"
        children_reason="ok"
      fi
      if has_secret_shape "$(cat "$children_body")"; then
        children_status="failed"
        children_reason="secret_shape_in_response"
      fi
    else
      children_reason="unexpected_http_status"
    fi
    append_result "batch_children" "GET" "/api/v1/batch-generations/$batch_id/children" "$children_status" "$children_http_status" "$children_reason" "$RUN_ID-batch_children" "$children_body" "asset_id,canvas_object_id,zenari-image-sandbox"
  fi
  fi
fi

python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RUN_ID" "$RELEASE_SHA" "$API_URL" "$PROVIDER_ID" "$MODEL_ID" "$USER_MODEL_ID" "$LLM_PROVIDER" "$LLM_OPENAI_BASE_URL" "$LLM_ENABLE_LIVE_CALLS" "$admin_auth_ready" "$user_auth_ready" "$csrf_ready" "$llm_live_ready" "$worker_batch_ready" "$batch_id" "$ALLOW_LOCAL_DEVPORT_EVIDENCE" "$USE_DEV_IDENTITY_HEADERS" <<'PY'
import json
import re
import sys
from pathlib import Path

(
    report_path,
    results_path,
    run_id,
    release_sha,
    api_url,
    provider_id,
    model_id,
    user_model_id,
    llm_provider,
    llm_base_url,
    llm_live_calls,
    admin_auth_ready,
    user_auth_ready,
    csrf_ready,
    llm_live_ready,
    worker_batch_ready,
    batch_id,
    allow_local_devport,
    use_dev_identity_headers,
) = sys.argv[1:]
report_path = Path(report_path)
results_path = Path(results_path)
allow_local_devport = allow_local_devport == "1"
use_dev_identity_headers = use_dev_identity_headers == "1"
results = [
    json.loads(line)
    for line in results_path.read_text(encoding="utf-8").splitlines()
    if line.strip()
]
secret_re = re.compile(r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})")

def load_body(check_id):
    matches = [item for item in results if item.get("check_id") == check_id and item.get("body_path")]
    if not matches:
        return {}
    path = Path(str(matches[-1]["body_path"]))
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except json.JSONDecodeError:
        return {}

def text_has_secret(path):
    path_obj = Path(str(path))
    return path_obj.exists() and bool(secret_re.search(path_obj.read_text(encoding="utf-8", errors="replace")))

checks = []
for item in results:
    checks.append({
        "check_id": item.get("check_id"),
        "method": item.get("method"),
        "path": item.get("path"),
        "status": item.get("status"),
        "http_status": item.get("http_status"),
        "reason": item.get("reason"),
        "request_id": item.get("request_id"),
        "expected_tokens": item.get("expected_tokens") or [],
        "matched_tokens": item.get("matched_tokens") or [],
        "missing_tokens": item.get("missing_tokens") or [],
        "secret_leak_detected": item.get("secret_leak_detected") is True,
    })
required = {"admin_registry", "admin_sandbox_test_call", "batch_create", "batch_progress", "batch_children"}
latest_checks = {}
for item in checks:
    check_id = item.get("check_id")
    if check_id:
        latest_checks[check_id] = item
passed = {check_id for check_id, item in latest_checks.items() if item.get("status") == "passed"}
blocked = [
    f"{item['check_id']}:{item['reason']}"
    for item in latest_checks.values()
    if item["status"] != "passed"
]
leaked = [
    item["check_id"]
    for item in results
    if item.get("secret_leak_detected") is True or (item.get("body_path") and text_has_secret(item["body_path"]))
]
if leaked:
    blocked.append("secret_leak_detected:" + ",".join(sorted(set(leaked))))
local_offline_debug = allow_local_devport and llm_live_calls != "true"
local_offline_adapter_blocker = "adapter_health_probe:local_devport_offline_adapter_probe_skipped"

batch_create = load_body("batch_create")
progress = load_body("batch_progress")
children_page = load_body("batch_children")
children = children_page.get("items") if isinstance(children_page, dict) else None
if not isinstance(children, list):
    children = []
succeeded_children = [
    item for item in children
    if isinstance(item, dict) and item.get("status") == "succeeded"
]
failed_children = [
    item for item in children
    if isinstance(item, dict) and str(item.get("status", "")).strip() in {"failed", "blocked"}
]
provider_child_failures = []
for child in failed_children:
    failure_code = str(child.get("failure_code") or "").strip()
    failure_message = str(child.get("failure_message") or "").strip()
    metadata = child.get("metadata") if isinstance(child.get("metadata"), dict) else {}
    failure_kind = str(metadata.get("failure_kind") or "").strip()
    provider_error_code = str(metadata.get("provider_error_code") or "").strip()
    provider_http_status = str(metadata.get("provider_http_status") or "").strip()
    provider_code = str(metadata.get("provider_code") or "").strip()
    if failure_code or failure_kind or provider_error_code:
        provider_child_failures.append({
            "child_id": str(child.get("id") or ""),
            "status": str(child.get("status") or ""),
            "failure_code": failure_code,
            "failure_kind": failure_kind,
            "provider_error_code": provider_error_code,
            "provider_http_status": provider_http_status,
            "provider_code": provider_code,
            "retryable": str(metadata.get("retryable") or ""),
            "failure_message": failure_message,
        })
for item in results:
    if item.get("check_id") not in {"batch_create", "batch_progress", "batch_children"}:
        continue
    reason = str(item.get("reason") or "").strip()
    if reason not in {"provider_quota_unavailable", "provider_retryable_http_error", "provider_http_error"}:
        continue
    if provider_child_failures:
        continue
    provider_child_failures.append({
        "child_id": "provider_health_preflight",
        "status": "blocked",
        "failure_code": reason,
        "failure_kind": "adapter_health_probe",
        "provider_error_code": reason,
        "provider_http_status": "",
        "provider_code": "",
        "retryable": "false" if reason == "provider_quota_unavailable" else "true",
        "failure_message": "OpenAI-compatible provider selftest failed before batch execution completed.",
    })
first_child = succeeded_children[0] if succeeded_children else {}
usage_units = int(first_child.get("quota_committed_units") or 0)
asset_id = str(first_child.get("asset_id") or "")
canvas_object_id = str(first_child.get("canvas_object_id") or "")
child_provider_id = str(first_child.get("provider_id") or "")
if not child_provider_id and isinstance(batch_create.get("children"), list) and batch_create.get("children"):
    first_created_child = batch_create["children"][0]
    if isinstance(first_created_child, dict):
        child_provider_id = str(first_created_child.get("provider_id") or "")
child_model_id = str(first_child.get("model_id") or user_model_id)
adapter_health_body = load_body("adapter_health_probe")
adapter_health_text = ""
for item in results:
    if item.get("check_id") == "adapter_health_probe" and item.get("body_path"):
        path = Path(str(item["body_path"]))
        if path.exists():
            adapter_health_text = path.read_text(encoding="utf-8", errors="replace")
        break
adapter_provider_failure = ""
adapter_provider_http_status = ""
adapter_provider_code = ""
if "provider_quota_unavailable" in adapter_health_text:
    adapter_provider_failure = "provider_quota_unavailable"
elif "provider_retryable_http_error" in adapter_health_text:
    adapter_provider_failure = "provider_retryable_http_error"
elif "provider_http_error" in adapter_health_text:
    adapter_provider_failure = "provider_http_error"
if adapter_provider_failure:
    match = re.search(r"http_status=([0-9]{3})", adapter_health_text)
    if match:
        adapter_provider_http_status = match.group(1)
    match = re.search(r"provider_code=([A-Za-z0-9._-]+)", adapter_health_text)
    if match:
        adapter_provider_code = match.group(1)
    if not provider_child_failures:
        provider_child_failures.append({
            "child_id": str((children[0].get("id") if children and isinstance(children[0], dict) else "provider_health_preflight")),
            "status": str((children[0].get("status") if children and isinstance(children[0], dict) else "blocked")),
            "failure_code": adapter_provider_failure,
            "failure_kind": "adapter_health_probe",
            "provider_error_code": adapter_provider_failure,
            "provider_http_status": adapter_provider_http_status,
            "provider_code": adapter_provider_code,
            "retryable": "false" if adapter_provider_failure == "provider_quota_unavailable" else "true",
            "failure_message": "OpenAI-compatible provider selftest failed before batch execution completed.",
        })
required_runtime_checks_passed = required <= passed
if not succeeded_children and provider_child_failures:
    failure_codes = sorted({
        item.get("failure_code") or item.get("provider_error_code") or "unknown_provider_child_failure"
        for item in provider_child_failures
    })
    for code in failure_codes:
        marker = "batch_children:provider_child_failure:" + code
        if marker not in blocked:
            blocked.append(marker)
runtime_blockers = [
    item
    for item in blocked
    if not (local_offline_debug and item == local_offline_adapter_blocker)
]
runtime_success = required_runtime_checks_passed and not runtime_blockers and bool(succeeded_children) and bool(asset_id) and bool(canvas_object_id) and usage_units >= 1
provider_failure_diagnosed = bool(provider_child_failures)
if allow_local_devport:
    marker = "local_devport_debug_evidence_cannot_clear_staging_gate"
    if marker not in blocked:
        blocked.append(marker)
status = "pass" if runtime_success and not allow_local_devport else "blocked"
canonical_report_path = Path("ops/evidence/staging/stage1-provider-sandbox.json")
canonical_results_path = Path("ops/evidence/staging/stage1-provider-sandbox.ndjson")
canonical_pass_paths = report_path == canonical_report_path and results_path == canonical_results_path
can_clear_provider_sandbox_gate = status == "pass" and canonical_pass_paths
if can_clear_provider_sandbox_gate:
    remaining_blockers = []
elif allow_local_devport and runtime_success:
    remaining_blockers = ["local-devport debug evidence cannot clear canonical staging provider sandbox gate"]
    if local_offline_debug:
        remaining_blockers.append("local-devport offline adapter health probe skipped; strict staging still requires live provider health")
elif provider_failure_diagnosed:
    remaining_blockers = ["provider sandbox child failed before asset/canvas/usage evidence could be produced"]
else:
    remaining_blockers = [
        "provider sandbox runtime did not produce a succeeded child with asset, canvas object, and usage evidence",
    ]
report = {
    "schema_version": "stage1.provider_sandbox.v1",
    "evidence_id": run_id,
    "blueprint_source": "Docs/Stage1_20260621_blueprint.md",
    "environment": "staging",
    "kind": "provider_sandbox",
    "status": status,
    "release_sha": release_sha,
    "api_url": api_url,
    "results_path": str(results_path),
    "local_devport_debug": allow_local_devport,
    "use_dev_identity_headers": use_dev_identity_headers,
    "provider_id": provider_id,
    "model_id": model_id,
    "user_model_id": user_model_id,
    "adapter": "openai-compatible",
    "adapter_endpoint_version": "openai_compatible_chat_completions_v1",
    "llm_provider": llm_provider,
    "llm_openai_model": model_id,
    "llm_base_url_host": llm_base_url.split("://", 1)[-1].split("/", 1)[0] if llm_base_url else "",
    "live_calls_enabled": llm_live_calls == "true",
    "secret_material_present": llm_live_ready == "1",
    "secret_material_persisted": False,
    "health_probe_passed": "adapter_health_probe" in passed,
    "admin_only_test_call": "admin_sandbox_test_call" in passed,
    "user_visible_provider_secret": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "asset_persisted": bool(asset_id),
    "canvas_persisted": bool(canvas_object_id),
    "usage_recorded": usage_units >= 1,
    "provider_cost_reconciled": "contract_only",
    "runtime_input_readiness": {
        "staging_api_url_ready": bool(api_url),
        "admin_auth_ready": admin_auth_ready == "1",
        "user_auth_ready": user_auth_ready == "1",
        "csrf_ready": csrf_ready == "1",
        "llm_live_config_ready": llm_live_ready == "1",
        "worker_batch_enabled": worker_batch_ready == "1",
        "allow_local_devport_evidence": allow_local_devport,
        "use_dev_identity_headers": use_dev_identity_headers,
        "canonical_pass_path": canonical_pass_paths,
    },
    "checks": checks,
    "blocked_checks": blocked,
    "batch_runtime": {
        "batch_id": batch_id or batch_create.get("id", ""),
        "provider_id": child_provider_id or provider_id,
        "model_id": child_model_id,
        "succeeded_children": len(succeeded_children),
        "failed_children": max(len(failed_children), len(provider_child_failures)),
        "provider_child_failures": provider_child_failures,
        "asset_id": asset_id,
        "canvas_object_id": canvas_object_id,
        "usage_units": usage_units,
        "progress": progress,
    },
    "probe_contract": {
        "canonical_pass_report": "ops/evidence/staging/stage1-provider-sandbox.json",
        "canonical_pass_results": "ops/evidence/staging/stage1-provider-sandbox.ndjson",
        "local_devport_report": "ops/evidence/staging/local-devport/stage1-provider-sandbox.local-devport.json",
        "local_devport_results": "ops/evidence/staging/local-devport/stage1-provider-sandbox.local-devport.ndjson",
        "allow_local_devport_evidence_env": "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only provider sandbox evidence under ops/evidence/staging/local-devport/ and cannot clear staging gates",
        "production_like_local_fixture_command": (
            "API_URL=https://zenari-staging.example.test:<port> "
            "API_URL_RESOLVE_ADDR=127.0.0.1 API_URL_CA_CERT=<self-signed-ca.pem> "
            "LLM_OPENAI_BASE_URL=https://zenari-provider.example.test:<port> "
            "LLM_OPENAI_RESOLVE_ADDR=127.0.0.1 LLM_OPENAI_CA_CERT=<self-signed-ca.pem> "
            "scripts/stage1_provider_sandbox_smoke.sh"
        ),
        "provider_failure_blocker_prefix": "batch_children:provider_child_failure:",
    },
    "gate_impact": {
        "can_clear_provider_sandbox_gate": can_clear_provider_sandbox_gate,
        "can_clear_check_level_item": can_clear_provider_sandbox_gate,
        "preserved_release_gate_check_id": None if can_clear_provider_sandbox_gate else "stage1_provider_sandbox",
        "preserved_do_not_launch_condition_id": None if can_clear_provider_sandbox_gate else "provider_sandbox_runtime_missing",
        "remaining_blockers": remaining_blockers,
    },
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(f"stage1 provider sandbox {status}; evidence written to {report_path}")
PY

should_validate_evidence="$(
  python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
blocked = report.get("blocked_checks") if isinstance(report.get("blocked_checks"), list) else []
if report.get("status") == "pass":
    print("1")
elif report.get("local_devport_debug") is True and (
    blocked == ["local_devport_debug_evidence_cannot_clear_staging_gate"]
    or set(blocked) == {
        "adapter_health_probe:local_devport_offline_adapter_probe_skipped",
        "local_devport_debug_evidence_cannot_clear_staging_gate",
    }
    or any(str(item).startswith("batch_children:provider_child_failure:") for item in blocked)
):
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
  python3 scripts/validate_stage1_provider_sandbox_evidence.py "${validator_args[@]}"
fi
python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if report.get("status") == "pass" else 2)
PY
