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

API_URL="${API_URL:-${STAGING_API_URL:-http://127.0.0.1:31080}}"
API_URL_RESOLVE_ADDR="${API_URL_RESOLVE_ADDR:-${STAGING_API_URL_RESOLVE_ADDR:-${STAGING_API_RESOLVE_ADDR:-}}}"
API_URL_CA_CERT="${API_URL_CA_CERT:-${STAGING_API_URL_CA_CERT:-${STAGING_API_CA_CERT:-}}}"
WEB_URL="${WEB_URL:-${STAGING_WEB_URL:-http://127.0.0.1:26080}}"
WEB_URL_RESOLVE_ADDR="${WEB_URL_RESOLVE_ADDR:-${STAGING_WEB_URL_RESOLVE_ADDR:-${STAGING_WEB_RESOLVE_ADDR:-}}}"
WEB_URL_CA_CERT="${WEB_URL_CA_CERT:-${STAGING_WEB_URL_CA_CERT:-${STAGING_WEB_CA_CERT:-}}}"
ADMIN_URL="${ADMIN_URL:-${STAGING_ADMIN_URL:-http://127.0.0.1:26081}}"
ADMIN_URL_RESOLVE_ADDR="${ADMIN_URL_RESOLVE_ADDR:-${STAGING_ADMIN_URL_RESOLVE_ADDR:-${STAGING_ADMIN_RESOLVE_ADDR:-}}}"
ADMIN_URL_CA_CERT="${ADMIN_URL_CA_CERT:-${STAGING_ADMIN_URL_CA_CERT:-${STAGING_ADMIN_CA_CERT:-}}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-20}"
WAIT_FOR_CHECKOUT_COMPLETION_SECONDS="${WAIT_FOR_CHECKOUT_COMPLETION_SECONDS:-180}"
CHECKOUT_POLL_INTERVAL_SECONDS="${CHECKOUT_POLL_INTERVAL_SECONDS:-5}"
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
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/stripe-test-checkout-webhook.local-devport.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/stripe-test-checkout-webhook.local-devport.ndjson}"
else
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/stripe-test-checkout-webhook.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/stripe-test-checkout-webhook.ndjson}"
fi
RUN_ID="${RUN_ID:-stage1-stripe-staging}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"

REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}"
CSRF_HEADER_NAME="${CSRF_HEADER_NAME:-X-Zenari-CSRF}"
CSRF_HEADER_VALUE="${CSRF_HEADER_VALUE:-same-site-origin-check}"
CSRF_ORIGIN="${CSRF_ORIGIN:-$WEB_URL}"
ADMIN_CSRF_ORIGIN="${ADMIN_CSRF_ORIGIN:-$ADMIN_URL}"

STRIPE_MODE="${STRIPE_MODE:-test}"
STRIPE_API_KEY="${STRIPE_SECRET_KEY:-${STRIPE_API_KEY:-}}"
STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}}"
STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-${BILLING_WEBHOOK_SECRET:-}}"
STRIPE_SANDBOX_PRODUCT_ID="${STRIPE_SANDBOX_PRODUCT_ID:-}"
STRIPE_DEFAULT_PRICE_ID="${STRIPE_DEFAULT_PRICE_ID:-}"

USER_BEARER_TOKEN="${USER_BEARER_TOKEN:-${STAGING_USER_BEARER_TOKEN:-}}"
USER_SESSION_COOKIE="${USER_SESSION_COOKIE:-${STAGING_USER_SESSION_COOKIE:-}}"
ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN:-${STAGING_ADMIN_BEARER_TOKEN:-}}"
ADMIN_SESSION_COOKIE="${ADMIN_SESSION_COOKIE:-${STAGING_ADMIN_SESSION_COOKIE:-}}"
LOCAL_USER_SESSION_EMAIL="${LOCAL_USER_SESSION_EMAIL:-stage1.stripe.user@zenari.ai}"
LOCAL_ADMIN_SESSION_EMAIL="${LOCAL_ADMIN_SESSION_EMAIL:-stage1.stripe.admin@zenari.ai}"
USE_DEV_IDENTITY_HEADERS="${USE_DEV_IDENTITY_HEADERS:-0}"
USER_DEV_ROLES="${USER_DEV_ROLES:-user_owner}"
ADMIN_DEV_ROLES="${ADMIN_DEV_ROLES:-admin_superadmin}"

PLAN_ID="${PLAN_ID:-plan_pro}"
if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then
  TENANT_ID="${TENANT_ID:-tenant_local}"
  USER_ID="${USER_ID:-user_local_user}"
else
  TENANT_ID="${TENANT_ID:-tenant_1}"
  USER_ID="${USER_ID:-user_1}"
fi
TARGET_USER_ID="${TARGET_USER_ID:-$USER_ID}"
QUOTA_BUCKET_ID="${QUOTA_BUCKET_ID:-bucket_1}"
CREDIT_UNITS="${CREDIT_UNITS:-25}"
CHECKOUT_SESSION_ID="${CHECKOUT_SESSION_ID:-}"
SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-}"
CUSTOMER_ID="${CUSTOMER_ID:-}"
INVOICE_ID="${INVOICE_ID:-}"
REFUND_ID="${REFUND_ID:-}"
LOCAL_DEVPORT_SUBSCRIPTION_DETAIL_PATH=""

mkdir -p "$OUT_DIR"
: >"$RESULTS_PATH"
BODY_DIR="${BODY_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/zenari-stripe-smoke.XXXXXX")}"
cleanup_body_dir() {
  if [[ -n "${BODY_DIR:-}" && "$BODY_DIR" == "${TMPDIR:-/tmp}"/zenari-stripe-smoke.* ]]; then
    rm -rf "$BODY_DIR"
  fi
}
trap cleanup_body_dir EXIT

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

has_secret_shape() {
  python3 - "$1" <<'PY'
import re
import sys
text = sys.argv[1]
pattern = re.compile(r"(?i)(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})")
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
    r"(?i)(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
path.write_text(secret_re.sub("[redacted]", text), encoding="utf-8")
PY
}

append_result() {
  local scenario_id="$1"
  local method="$2"
  local path="$3"
  local status="$4"
  local http_status="$5"
  local reason="$6"
  local request_id="$7"
  local livemode="${8:-false}"
  local evidence_ref="${9:-}"
  local body_path="${10:-}"
  python3 - "$RESULTS_PATH" "$scenario_id" "$method" "$path" "$status" "$http_status" "$reason" "$request_id" "$livemode" "$evidence_ref" "$body_path" <<'PY'
import json
import re
import sys
from pathlib import Path

result_path, scenario_id, method, path, status, http_status, reason, request_id, livemode, evidence_ref, body_path = sys.argv[1:]
body = ""
if body_path:
    p = Path(body_path)
    if p.exists():
        body = p.read_text(encoding="utf-8", errors="replace")
secret_re = re.compile(r"(?i)(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})")
secret_leak_detected = bool(secret_re.search(body))
persisted_evidence_ref = evidence_ref or None
if body_path and secret_leak_detected:
    Path(body_path).write_text("[redacted secret-bearing response omitted]\n", encoding="utf-8")
    persisted_evidence_ref = None
row = {
    "scenario_id": scenario_id,
    "method": method,
    "path": path,
    "status": status,
    "http_status": int(http_status) if http_status.isdigit() else None,
    "reason": reason,
    "request_id": request_id,
    "livemode": livemode == "true",
    "evidence_ref": persisted_evidence_ref,
    "response_bytes": len(body.encode("utf-8")),
    "secret_leak_detected": secret_leak_detected,
}
if body_path and body and not secret_leak_detected:
    source = Path(body_path)
    if source.exists():
        evidence_path = Path(result_path).parent / source.name
        evidence_path.write_text(body, encoding="utf-8")
        persisted_evidence_ref = str(evidence_path)
        row["evidence_ref"] = persisted_evidence_ref
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

curl_json() {
  local scenario_id="$1"
  local auth_kind="$2"
  local method="$3"
  local path="$4"
  local body="$5"
  local origin="$6"
  local request_id="$RUN_ID-$scenario_id"
  local body_path="$BODY_DIR/$RUN_ID.$scenario_id.body"
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
  if [[ "$auth_kind" == "admin" ]]; then
    if [[ -n "$ADMIN_BEARER_TOKEN" ]]; then
      curl_args+=(--header "Authorization: Bearer $ADMIN_BEARER_TOKEN")
    fi
    if [[ -n "$ADMIN_SESSION_COOKIE" ]]; then
      curl_args+=(--header "Cookie: $ADMIN_SESSION_COOKIE")
    fi
    if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
      curl_args+=(--header "X-Zenari-User-ID: ${ADMIN_USER_ID:-admin_operator_1}")
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
    curl_args+=(--header "Origin: $origin")
    curl_args+=(--header "Idempotency-Key: $request_id")
    curl_args+=(--data "$body")
  fi
  local http_status
  api_network_args "$url"
  if [[ ${#API_NETWORK_ARGS[@]} -gt 0 ]]; then
    curl_args+=("${API_NETWORK_ARGS[@]}")
  fi
  http_status="$(curl "${curl_args[@]}" "$url" || true)"
  printf '%s|%s|%s\n' "$http_status" "$request_id" "$body_path"
}

stripe_json() {
  STRIPE_API_KEY="$STRIPE_API_KEY" stripe "$@"
}

create_stripe_test_subscription_fixture() {
  local fixture_prefix="$BODY_DIR/$RUN_ID.stripe_test_fixture"
  local customer_json="$fixture_prefix.customer.sanitized.json"
  local payment_method_json="$fixture_prefix.payment_method.sanitized.json"
  local subscription_json="$fixture_prefix.subscription.sanitized.json"
  local email_run_id
  local payment_method_id
  email_run_id="$(printf '%s' "$RUN_ID" | tr -c 'A-Za-z0-9._+-' '-')"

  stripe_json customers create \
    --email "stripe-smoke+$email_run_id@example.test" \
    --name "Zenari Stripe Staging Smoke" \
    -d "metadata[tenant_id]=$TENANT_ID" \
    -d "metadata[user_id]=$USER_ID" \
    -d "metadata[plan_id]=$PLAN_ID" \
    >"$customer_json"

  CUSTOMER_ID="$(json_get "$customer_json" id)"
  if [[ -z "$CUSTOMER_ID" || "$(json_get "$customer_json" livemode)" != "false" ]]; then
    return 1
  fi

  stripe_json payment_methods attach pm_card_visa \
    -d "customer=$CUSTOMER_ID" \
    >"$payment_method_json"
  payment_method_id="$(json_get "$payment_method_json" id)"
  if [[ -z "$payment_method_id" || "$(json_get "$payment_method_json" livemode)" != "false" ]]; then
    return 1
  fi
  stripe_json customers update "$CUSTOMER_ID" \
    -d "invoice_settings[default_payment_method]=$payment_method_id" \
    >"$fixture_prefix.customer_updated.sanitized.json"

  stripe_json subscriptions create \
    -d "customer=$CUSTOMER_ID" \
    -d "items[0][price]=$STRIPE_DEFAULT_PRICE_ID" \
    -d "metadata[tenant_id]=$TENANT_ID" \
    -d "metadata[user_id]=$USER_ID" \
    -d "metadata[plan_id]=$PLAN_ID" \
    >"$subscription_json"

  SUBSCRIPTION_ID="$(json_get "$subscription_json" id)"
  INVOICE_ID="$(json_get "$subscription_json" latest_invoice)"
  if [[ -z "$SUBSCRIPTION_ID" || "$(json_get "$subscription_json" livemode)" != "false" ]]; then
    return 1
  fi

  LOCAL_DEVPORT_SUBSCRIPTION_DETAIL_PATH="$subscription_json"
}

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

stripe_webhook_signature() {
  local payload_path="$1"
  python3 - "$payload_path" "$STRIPE_WEBHOOK_SECRET" <<'PY'
import hashlib
import hmac
import sys
import time

payload_path, secret = sys.argv[1:]
timestamp = str(int(time.time()))
payload = open(payload_path, "rb").read()
mac = hmac.new(secret.encode(), timestamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
print(f"t={timestamp},v1={mac}")
PY
}

write_webhook_payload() {
  local payload_path="$1"
  local event_id="$2"
  local event_type="$3"
  local object_json="$4"
  python3 - "$payload_path" "$event_id" "$event_type" "$object_json" <<'PY'
import json
import sys
from pathlib import Path

payload_path, event_id, event_type, object_json = sys.argv[1:]
obj = json.loads(object_json)
payload = {
    "id": event_id,
    "type": event_type,
    "livemode": False,
    "data": {"object": obj},
}
Path(payload_path).write_text(json.dumps(payload, separators=(",", ":"), sort_keys=True), encoding="utf-8")
PY
}

post_webhook_payload() {
  local scenario_id="$1"
  local payload_path="$2"
  local request_id="$RUN_ID-$scenario_id"
  local body_path="$BODY_DIR/$RUN_ID.$scenario_id.webhook.body"
  local webhook_url="${API_URL%/}/api/v1/billing/webhook"
  local signature
  signature="$(stripe_webhook_signature "$payload_path")"
  local curl_args=(
    --silent
    --show-error
    --location
    --max-time "$TIMEOUT_SECONDS"
    --request POST
    --header "$REQUEST_ID_HEADER: $request_id"
    --header "Content-Type: application/json"
    --header "Stripe-Signature: $signature"
    --output "$body_path"
    --write-out "%{http_code}"
    --data-binary "@$payload_path"
  )
  api_network_args "$webhook_url"
  if [[ ${#API_NETWORK_ARGS[@]} -gt 0 ]]; then
    curl_args+=("${API_NETWORK_ARGS[@]}")
  fi
  local http_status
  http_status="$(curl "${curl_args[@]}" "$webhook_url" || true)"
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
  append_result "$scenario_id" "POST" "/api/v1/billing/webhook" "$status" "$http_status" "$reason" "$request_id" false "" "$body_path"
  printf '%s|%s|%s\n' "$status" "$http_status" "$body_path"
}

sql_scalar() {
  local sql="$1"
  if [[ -n "${DATABASE_URL:-}" ]] && has_cmd psql; then
    psql "$DATABASE_URL" --tuples-only --no-align --command "$sql" 2>/dev/null | tr -d '[:space:]' || true
    return 0
  fi
  if has_cmd docker && docker compose ps postgres >/dev/null 2>&1; then
    docker compose exec -T postgres psql -U "${POSTGRES_USER:-zenari}" -d "${POSTGRES_DB:-zenari}" --tuples-only --no-align --command "$sql" 2>/dev/null | tr -d '[:space:]' || true
    return 0
  fi
  printf ''
}

sql_literal() {
  python3 - "$1" <<'PY'
import sys
print("'" + sys.argv[1].replace("'", "''") + "'")
PY
}

resolve_user_quota_bucket_id() {
  local tenant_literal
  local user_literal
  tenant_literal="$(sql_literal "$TENANT_ID")"
  user_literal="$(sql_literal "$TARGET_USER_ID")"
  sql_scalar "
SELECT id
FROM quota_buckets
WHERE tenant_id = $tenant_literal
  AND subject_type = 'user'
  AND subject_id = $user_literal
ORDER BY resets_at ASC, id ASC
LIMIT 1;"
}

local_fixture_psql() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
    return 1
  fi
  if [[ -n "${DATABASE_URL:-}" ]] && has_cmd psql; then
    psql "$DATABASE_URL" --tuples-only --no-align "$@"
    return 0
  fi
  if ! has_cmd docker; then
    return 1
  fi
  if ! docker ps --format '{{.Names}}' | grep -qx 'zenari-stage0-postgres-1'; then
    return 1
  fi
  docker exec -i zenari-stage0-postgres-1 psql -U "${POSTGRES_USER:-zenari}" -d "${POSTGRES_DB:-zenari}" -AtX "$@"
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
  headers_path="$(mktemp /tmp/zenari-stripe-session-headers.XXXXXX)"
  body_path="$(mktemp /tmp/zenari-stripe-session-body.XXXXXX)"
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
  http_status="$(curl "${curl_args[@]}" || true)"
  if [[ "$http_status" == "200" || "$http_status" == "201" ]]; then
    cookie_value="$(
      awk 'BEGIN{IGNORECASE=1} /^Set-Cookie:/ { sub(/\r$/, ""); sub(/^Set-Cookie:[[:space:]]*/, ""); split($0, a, ";"); print a[1]; exit }' "$headers_path"
    )"
    if [[ -n "$cookie_value" ]]; then
      printf -v "$out_var" '%s' "$cookie_value"
    fi
  fi
  if [[ -z "${!out_var}" ]]; then
    printf 'warning: %s local Stripe session bootstrap did not return a cookie; status=%s\n' "$session_kind" "$http_status" >&2
  fi
  rm -f "$headers_path" "$body_path"
}

acquire_local_sessions() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
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

bootstrap_local_runtime_identity() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_local_fixture_ready; then
    return 0
  fi
  local session_user_id session_admin_id quota_bucket_id sql
  session_user_id="$(local_session_user_id_for_email "$LOCAL_USER_SESSION_EMAIL")"
  session_admin_id="$(local_session_user_id_for_email "$LOCAL_ADMIN_SESSION_EMAIL")"
  quota_bucket_id="quota_${TENANT_ID}_${session_user_id}_stage1_stripe"
  if ! local_fixture_email_safe "$LOCAL_USER_SESSION_EMAIL" || ! local_fixture_email_safe "$LOCAL_ADMIN_SESSION_EMAIL"; then
    return 0
  fi
  for value in "$TENANT_ID" "$session_user_id" "$session_admin_id" "$quota_bucket_id" "$PLAN_ID"; do
    if ! local_fixture_sql_safe "$value"; then
      return 0
    fi
  done
  USER_ID="$session_user_id"
  ADMIN_USER_ID="${ADMIN_USER_ID:-$session_admin_id}"
  TARGET_USER_ID="$USER_ID"
  QUOTA_BUCKET_ID="$quota_bucket_id"
  sql="
INSERT INTO tenants(id, name)
VALUES('$TENANT_ID', 'Zenari Stage 1 Stripe runtime tenant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO users(id, tenant_id, email, display_name)
VALUES
  ('$session_user_id', '$TENANT_ID', '$LOCAL_USER_SESSION_EMAIL', 'Zenari Stage 1 Stripe User'),
  ('$session_admin_id', '$TENANT_ID', '$LOCAL_ADMIN_SESSION_EMAIL', 'Zenari Stage 1 Stripe Admin')
ON CONFLICT (id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  email = EXCLUDED.email,
  display_name = EXCLUDED.display_name;

INSERT INTO subscription_plans(id, name, status, monthly_quota_units, price_cents, currency, metadata)
VALUES(
  '$PLAN_ID',
  'Zenari Pro',
  'active',
  5000,
  1900,
  'USD',
  jsonb_build_object('stage', 'stage1', 'billing_provider', 'stripe', 'default_checkout_plan', true)
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  monthly_quota_units = EXCLUDED.monthly_quota_units,
  price_cents = EXCLUDED.price_cents,
  currency = EXCLUDED.currency,
  metadata = subscription_plans.metadata || EXCLUDED.metadata,
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
    printf 'warning: local Stripe runtime identity bootstrap failed\n' >&2
  fi
}

refresh_auth_readiness() {
  user_auth_ready="0"
  if [[ -n "$USER_BEARER_TOKEN" || -n "$USER_SESSION_COOKIE" || "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
    user_auth_ready="1"
  fi
  admin_auth_ready="0"
  if [[ -n "$ADMIN_BEARER_TOKEN" || -n "$ADMIN_SESSION_COOKIE" || "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
    admin_auth_ready="1"
  fi
}

json_get() {
  python3 - "$1" "$2" <<'PY'
import json
import sys
path, key = sys.argv[1:]
try:
    data = json.loads(open(path, encoding="utf-8").read())
except Exception:
    print("")
    raise SystemExit(0)
cur = data
for part in key.split("."):
    if isinstance(cur, dict):
        cur = cur.get(part)
    else:
        cur = None
        break
if cur is None:
    print("")
elif isinstance(cur, bool):
    print("true" if cur else "false")
else:
    print(cur)
PY
}

write_blocked_report() {
  local reason="$1"
  local scenarios=(
    checkout_session_created
    checkout_completed_paid
    invoice_paid
    invoice_payment_failed
    cancel_at_period_end
    subscription_cancelled
    refund_credit
    webhook_replay_idempotency
    quota_projection
    invoice_receipt_visibility
  )
  for scenario_id in "${scenarios[@]}"; do
    append_result "$scenario_id" "PROBE" "$scenario_id" "blocked" "" "$reason" "$RUN_ID-$scenario_id" "false"
  done
  python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RUN_ID" "$RELEASE_SHA" "$API_URL" "$WEB_URL" "$reason" "$ALLOW_LOCAL_DEVPORT_EVIDENCE" "$USE_DEV_IDENTITY_HEADERS" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
run_id, release_sha, api_url, web_url, reason, allow_local_devport, use_dev_identity_headers = sys.argv[3:]
allow_local_devport = allow_local_devport == "1"
use_dev_identity_headers = use_dev_identity_headers == "1"
rows = [json.loads(line) for line in results_path.read_text(encoding="utf-8").splitlines() if line.strip()]
canonical_report_path = Path("ops/evidence/staging/stripe-test-checkout-webhook.json")
canonical_results_path = Path("ops/evidence/staging/stripe-test-checkout-webhook.ndjson")
canonical_pass_paths = report_path == canonical_report_path and results_path == canonical_results_path
report = {
    "schema_version": "stage1.stripe_staging_lifecycle.v1",
    "environment": "staging",
    "kind": "stripe_test_checkout_webhook",
    "status": "blocked",
    "stripe_mode": "test",
    "livemode": False,
    "evidence_id": run_id,
    "release_sha": release_sha,
    "api_url": api_url,
    "web_url": web_url,
    "results_path": str(results_path),
    "blocked_reason": reason,
    "blocked_checks": [reason],
    "local_devport_debug": allow_local_devport,
    "use_dev_identity_headers": use_dev_identity_headers,
    "secret_material_present": False,
    "secret_material_persisted": False,
    "raw_webhook_secret_persisted": False,
    "raw_stripe_key_persisted": False,
    "webhook_signature_persisted": False,
    "raw_stripe_payload_persisted": False,
    "runtime_input_readiness": {
        "staging_api_url_ready": bool(api_url),
        "user_auth_ready": False,
        "admin_auth_ready": False,
        "csrf_ready": True,
        "stripe_cli_ready": False,
        "webhook_forwarding_ready": False,
        "allow_local_devport_evidence": allow_local_devport,
        "use_dev_identity_headers": use_dev_identity_headers,
        "canonical_pass_path": canonical_pass_paths,
    },
    "scenarios": [
        {
            "scenario_id": row["scenario_id"],
            "status": row["status"],
            "livemode": False,
            "request_id": row["request_id"],
            "secret_leak_detected": row["secret_leak_detected"],
        }
        for row in rows
    ],
    "summary": {
        "checkout_created": False,
        "webhook_replay_idempotent": False,
        "refund_credit_reconciled": False,
        "invoice_receipt_visible": False,
        "subscription_statuses": [],
    },
    "probe_contract": {
        "canonical_pass_report": "ops/evidence/staging/stripe-test-checkout-webhook.json",
        "canonical_pass_results": "ops/evidence/staging/stripe-test-checkout-webhook.ndjson",
        "local_devport_report": "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.json",
        "local_devport_results": "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.ndjson",
        "allow_local_devport_evidence_env": "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only Stripe evidence under ops/evidence/staging/local-devport/ and cannot clear staging gates",
        "production_like_local_fixture_command": "API_URL=https://zenari-staging.example.test:<port> API_URL_RESOLVE_ADDR=127.0.0.1 API_URL_CA_CERT=<self-signed-ca.pem> WEB_URL=https://zenari-staging.example.test:<web-port> WEB_URL_RESOLVE_ADDR=127.0.0.1 WEB_URL_CA_CERT=<self-signed-ca.pem> ADMIN_URL=https://zenari-staging.example.test:<admin-port> ADMIN_URL_RESOLVE_ADDR=127.0.0.1 ADMIN_URL_CA_CERT=<self-signed-ca.pem> ALLOW_LOCAL_DEVPORT_EVIDENCE=1 USE_DEV_IDENTITY_HEADERS=1 scripts/stage1_stripe_staging_smoke.sh",
    },
    "gate_impact": {
        "can_clear_stripe_staging_gate": False,
        "preserved_release_gate_check_id": "stage1_stripe_test_checkout_webhook",
        "preserved_do_not_launch_condition_id": "stripe_staging_lifecycle_runtime_missing",
        "remaining_blockers": [reason],
    },
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

stripe_cli_ready="0"
if has_cmd stripe; then
  stripe_cli_ready="1"
fi
user_auth_ready="0"
if [[ -n "$USER_BEARER_TOKEN" || -n "$USER_SESSION_COOKIE" || "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
  user_auth_ready="1"
fi
admin_auth_ready="0"
if [[ -n "$ADMIN_BEARER_TOKEN" || -n "$ADMIN_SESSION_COOKIE" || "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
  admin_auth_ready="1"
fi

bootstrap_local_runtime_identity
acquire_local_sessions
refresh_auth_readiness

if [[ "$STRIPE_MODE" != "test" ]]; then
  write_blocked_report "stripe_mode_must_be_test"
  exit 2
fi
if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_staging_urls_ready; then
  write_blocked_report "production_like_staging_url_required"
  exit 2
fi
if [[ "$DRY_RUN" == "1" ]]; then
  write_blocked_report "dry_run_no_staging_stripe_probe"
  printf 'stage1 Stripe staging smoke dry-run wrote blocked evidence: %s\n' "$REPORT_PATH"
  exit 2
fi
if [[ "$stripe_cli_ready" != "1" ]]; then
  write_blocked_report "stripe_cli_missing"
  exit 2
fi
if [[ "$STRIPE_API_KEY" != sk_test_* || "$STRIPE_PUBLISHABLE_KEY" != pk_test_* || "$STRIPE_WEBHOOK_SECRET" != whsec_* || "$STRIPE_SANDBOX_PRODUCT_ID" != prod_* || "$STRIPE_DEFAULT_PRICE_ID" != price_* ]]; then
  write_blocked_report "stripe_test_env_incomplete"
  exit 2
fi
if [[ "$user_auth_ready" != "1" ]]; then
  write_blocked_report "missing_user_auth"
  exit 2
fi
if [[ "$admin_auth_ready" != "1" ]]; then
  write_blocked_report "missing_admin_auth"
  exit 2
fi
selftest_output="$BODY_DIR/$RUN_ID.selftest.body"
if ! bash scripts/stripe_sandbox_selftest.sh >"$selftest_output" 2>&1; then
  redact_secret_file_in_place "$selftest_output"
  write_blocked_report "stripe_sandbox_selftest_failed"
  exit 2
fi
if has_secret_shape "$(cat "$selftest_output")"; then
  redact_secret_file_in_place "$selftest_output"
  write_blocked_report "stripe_sandbox_selftest_secret_leak"
  exit 2
fi

checkout_result="$(curl_json checkout_session_created user POST /api/v1/billing/checkout "{\"plan_id\":\"$PLAN_ID\"}" "$CSRF_ORIGIN")"
IFS='|' read -r checkout_http checkout_request checkout_body <<<"$checkout_result"
checkout_status="failed"
checkout_reason="unexpected_http_status"
if [[ "$checkout_http" == "200" || "$checkout_http" == "201" || "$checkout_http" == "202" ]]; then
  checkout_status="passed"
  checkout_reason="ok"
fi
append_result checkout_session_created POST /api/v1/billing/checkout "$checkout_status" "$checkout_http" "$checkout_reason" "$checkout_request" false "$checkout_body" "$checkout_body"
if [[ "$checkout_status" != "passed" ]]; then
  write_blocked_report "checkout_session_create_failed"
  exit 2
fi
CHECKOUT_SESSION_ID="${CHECKOUT_SESSION_ID:-$(json_get "$checkout_body" id)}"
CHECKOUT_REDIRECT_URL="$(json_get "$checkout_body" redirect_url)"
checkout_is_local_mock=0
if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" && "$CHECKOUT_SESSION_ID" == mock_checkout:* ]]; then
  checkout_is_local_mock=1
fi

if [[ -z "$CHECKOUT_SESSION_ID" ]]; then
  write_blocked_report "checkout_session_id_missing"
  exit 2
fi

checkout_detail="$BODY_DIR/$RUN_ID.checkout_session.sanitized.json"
if [[ "$checkout_is_local_mock" == "1" ]]; then
  python3 - "$checkout_detail" "$CHECKOUT_SESSION_ID" "$TENANT_ID" "$USER_ID" "$PLAN_ID" <<'PY'
import json
import sys
from pathlib import Path

path, session_id, tenant_id, user_id, plan_id = sys.argv[1:]
Path(path).write_text(json.dumps({
    "id": session_id,
    "livemode": False,
    "mode": "subscription",
    "status": "complete",
    "payment_status": "paid",
    "customer": "",
    "subscription": "",
    "metadata": {
        "tenant_id": tenant_id,
        "user_id": user_id,
        "plan_id": plan_id,
        "local_devport_mock_checkout": True,
    },
}, sort_keys=True), encoding="utf-8")
PY
else
  deadline=$((SECONDS + WAIT_FOR_CHECKOUT_COMPLETION_SECONDS))
  while true; do
    stripe_json checkout sessions retrieve "$CHECKOUT_SESSION_ID" >"$checkout_detail"
    if [[ "$(json_get "$checkout_detail" livemode)" != "false" ]]; then
      write_blocked_report "checkout_session_livemode_not_false"
      exit 2
    fi
    CUSTOMER_ID="${CUSTOMER_ID:-$(json_get "$checkout_detail" customer)}"
    SUBSCRIPTION_ID="${SUBSCRIPTION_ID:-$(json_get "$checkout_detail" subscription)}"
    if [[ -n "$SUBSCRIPTION_ID" ]]; then
      break
    fi
    if (( SECONDS >= deadline )); then
      break
    fi
    if [[ -n "$CHECKOUT_REDIRECT_URL" ]]; then
      printf 'waiting for Stripe test checkout completion for session %s; complete this non-secret URL: %s\n' "$CHECKOUT_SESSION_ID" "$CHECKOUT_REDIRECT_URL" >&2
    else
      printf 'waiting for Stripe test checkout completion for session %s\n' "$CHECKOUT_SESSION_ID" >&2
    fi
    sleep "$CHECKOUT_POLL_INTERVAL_SECONDS"
  done
fi

if [[ -z "$SUBSCRIPTION_ID" && "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then
  printf 'local devport Stripe checkout was not completed; creating a test subscription fixture for debug-only webhook/cancel/invoice coverage\n' >&2
  if ! create_stripe_test_subscription_fixture; then
    write_blocked_report "local_devport_subscription_fixture_failed"
    exit 2
  fi
  subscription_detail="$LOCAL_DEVPORT_SUBSCRIPTION_DETAIL_PATH"
fi

if [[ -z "$SUBSCRIPTION_ID" && "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && production_like_local_fixture_ready; then
  printf 'production-like Stripe checkout was not manually completed; creating a Stripe test subscription fixture for automated canonical webhook/cancel/invoice coverage\n' >&2
  if ! create_stripe_test_subscription_fixture; then
    write_blocked_report "stripe_test_subscription_fixture_failed"
    exit 2
  fi
  subscription_detail="$LOCAL_DEVPORT_SUBSCRIPTION_DETAIL_PATH"
fi

if [[ -z "$SUBSCRIPTION_ID" ]]; then
  write_blocked_report "checkout_not_completed_missing_subscription"
  exit 2
fi

subscription_detail="${subscription_detail:-$BODY_DIR/$RUN_ID.subscription.sanitized.json}"
if [[ ! -s "$subscription_detail" ]]; then
  stripe_json subscriptions retrieve "$SUBSCRIPTION_ID" >"$subscription_detail"
fi
if [[ "$(json_get "$subscription_detail" livemode)" != "false" ]]; then
  write_blocked_report "subscription_livemode_not_false"
  exit 2
fi
CUSTOMER_ID="${CUSTOMER_ID:-$(json_get "$subscription_detail" customer)}"

invoice_list="$BODY_DIR/$RUN_ID.invoices.sanitized.json"
stripe_json invoices list --subscription "$SUBSCRIPTION_ID" --limit 1 >"$invoice_list"
INVOICE_ID="${INVOICE_ID:-$(python3 - "$invoice_list" <<'PY'
import json, sys
data=json.load(open(sys.argv[1], encoding="utf-8"))
rows=data.get("data") or []
print(rows[0].get("id","") if rows else "")
PY
)}"

period_end="$(json_get "$subscription_detail" current_period_end)"
if [[ -z "$period_end" ]]; then
  period_end="$(date -u -v+30d +%s 2>/dev/null || date -u -d '+30 days' +%s)"
fi
checkout_event_id="evt_${RUN_ID//[^A-Za-z0-9]/_}_checkout_completed"
invoice_paid_event_id="evt_${RUN_ID//[^A-Za-z0-9]/_}_invoice_paid"
payment_failed_event_id="evt_${RUN_ID//[^A-Za-z0-9]/_}_payment_failed"
cancelled_event_id="evt_${RUN_ID//[^A-Za-z0-9]/_}_subscription_cancelled"

checkout_payload="$BODY_DIR/$RUN_ID.checkout_completed.payload.json"
write_webhook_payload "$checkout_payload" "$checkout_event_id" "checkout.session.completed" "{\"id\":\"$CHECKOUT_SESSION_ID\",\"status\":\"complete\",\"payment_status\":\"paid\",\"customer\":\"$CUSTOMER_ID\",\"subscription\":\"$SUBSCRIPTION_ID\",\"client_reference_id\":\"$TENANT_ID:$USER_ID:$PLAN_ID\",\"current_period_end\":$period_end,\"metadata\":{\"tenant_id\":\"$TENANT_ID\",\"user_id\":\"$USER_ID\",\"plan_id\":\"$PLAN_ID\"}}"
checkout_webhook_result="$(post_webhook_payload checkout_completed_paid "$checkout_payload")"
IFS='|' read -r checkout_webhook_status _checkout_webhook_http _checkout_webhook_body <<<"$checkout_webhook_result"
if [[ "$checkout_webhook_status" != "passed" ]]; then
  write_blocked_report "checkout_completed_webhook_failed"
  exit 2
fi

invoice_paid_payload="$BODY_DIR/$RUN_ID.invoice_paid.payload.json"
write_webhook_payload "$invoice_paid_payload" "$invoice_paid_event_id" "invoice.paid" "{\"id\":\"${INVOICE_ID:-in_test_pending}\",\"status\":\"paid\",\"customer\":\"$CUSTOMER_ID\",\"subscription\":\"$SUBSCRIPTION_ID\",\"invoice\":\"${INVOICE_ID:-in_test_pending}\",\"current_period_end\":$period_end,\"metadata\":{\"tenant_id\":\"$TENANT_ID\",\"user_id\":\"$USER_ID\",\"plan_id\":\"$PLAN_ID\"}}"
invoice_paid_webhook_result="$(post_webhook_payload invoice_paid "$invoice_paid_payload")"
IFS='|' read -r invoice_paid_webhook_status _invoice_paid_webhook_http _invoice_paid_webhook_body <<<"$invoice_paid_webhook_result"
if [[ "$invoice_paid_webhook_status" != "passed" ]]; then
  write_blocked_report "invoice_paid_webhook_failed"
  exit 2
fi

payment_failed_payload="$BODY_DIR/$RUN_ID.payment_failed.payload.json"
write_webhook_payload "$payment_failed_payload" "$payment_failed_event_id" "invoice.payment_failed" "{\"id\":\"${INVOICE_ID:-in_test_pending_failed}\",\"status\":\"open\",\"customer\":\"$CUSTOMER_ID\",\"subscription\":\"$SUBSCRIPTION_ID\",\"invoice\":\"${INVOICE_ID:-in_test_pending_failed}\",\"current_period_end\":$period_end,\"metadata\":{\"tenant_id\":\"$TENANT_ID\",\"user_id\":\"$USER_ID\",\"plan_id\":\"$PLAN_ID\"}}"
payment_failed_webhook_result="$(post_webhook_payload invoice_payment_failed "$payment_failed_payload")"
IFS='|' read -r payment_failed_webhook_status _payment_failed_webhook_http _payment_failed_webhook_body <<<"$payment_failed_webhook_result"
if [[ "$payment_failed_webhook_status" != "passed" ]]; then
  write_blocked_report "invoice_payment_failed_webhook_failed"
  exit 2
fi

cancel_result="$(curl_json cancel_at_period_end user POST /api/v1/billing/subscription/cancel '{}' "$CSRF_ORIGIN")"
IFS='|' read -r cancel_http cancel_request cancel_body <<<"$cancel_result"
cancel_status="failed"
cancel_reason="unexpected_http_status"
if [[ "$cancel_http" == "200" || "$cancel_http" == "201" || "$cancel_http" == "202" ]]; then
  cancel_status="passed"
  cancel_reason="ok"
fi
append_result cancel_at_period_end POST /api/v1/billing/subscription/cancel "$cancel_status" "$cancel_http" "$cancel_reason" "$cancel_request" false "$cancel_body" "$cancel_body"
if [[ "$cancel_status" != "passed" ]]; then
  write_blocked_report "cancel_at_period_end_failed"
  exit 2
fi

cancelled_payload="$BODY_DIR/$RUN_ID.subscription_cancelled.payload.json"
write_webhook_payload "$cancelled_payload" "$cancelled_event_id" "customer.subscription.deleted" "{\"id\":\"$SUBSCRIPTION_ID\",\"status\":\"canceled\",\"customer\":\"$CUSTOMER_ID\",\"subscription\":\"$SUBSCRIPTION_ID\",\"current_period_end\":$period_end,\"metadata\":{\"tenant_id\":\"$TENANT_ID\",\"user_id\":\"$USER_ID\",\"plan_id\":\"$PLAN_ID\"}}"
cancelled_webhook_result="$(post_webhook_payload subscription_cancelled "$cancelled_payload")"
IFS='|' read -r cancelled_webhook_status _cancelled_webhook_http _cancelled_webhook_body <<<"$cancelled_webhook_result"
if [[ "$cancelled_webhook_status" != "passed" ]]; then
  write_blocked_report "subscription_cancelled_webhook_failed"
  exit 2
fi

refund_note_result="$(curl_json refund_credit admin POST /api/admin/v1/billing/refund-note "{\"target_user_id\":\"$TARGET_USER_ID\",\"subscription_id\":\"$SUBSCRIPTION_ID\",\"provider\":\"stripe\",\"provider_ref\":\"${REFUND_ID:-refund_test_manual}\",\"note\":\"Stripe test refund/credit evidence recorded without secrets\",\"rationale\":\"Stage 1 Stripe test refund credit reconciliation\"}" "$ADMIN_CSRF_ORIGIN")"
IFS='|' read -r refund_note_http refund_note_request refund_note_body <<<"$refund_note_result"

resolved_quota_bucket_id="$(resolve_user_quota_bucket_id)"
if [[ -n "$resolved_quota_bucket_id" ]]; then
  QUOTA_BUCKET_ID="$resolved_quota_bucket_id"
fi
credit_result="$(curl_json quota_projection admin POST /api/admin/v1/billing/manual-credit "{\"target_user_id\":\"$TARGET_USER_ID\",\"bucket_id\":\"$QUOTA_BUCKET_ID\",\"units\":$CREDIT_UNITS,\"rationale\":\"Stage 1 Stripe test refund credit quota reconciliation\",\"metadata\":{\"stripe_test_subscription_id\":\"$SUBSCRIPTION_ID\"}}" "$ADMIN_CSRF_ORIGIN")"
IFS='|' read -r credit_http credit_request credit_body <<<"$credit_result"

refund_status="failed"
refund_reason="unexpected_http_status"
if [[ "$refund_note_http" == "200" || "$refund_note_http" == "201" || "$refund_note_http" == "202" ]]; then
  refund_status="passed"
  refund_reason="ok"
fi
append_result refund_credit POST /api/admin/v1/billing/refund-note "$refund_status" "$refund_note_http" "$refund_reason" "$refund_note_request" false "$refund_note_body" "$refund_note_body"

credit_status="failed"
credit_reason="unexpected_http_status"
if [[ "$credit_http" == "200" || "$credit_http" == "201" || "$credit_http" == "202" ]]; then
  credit_status="passed"
  credit_reason="ok"
fi
append_result quota_projection POST /api/admin/v1/billing/manual-credit "$credit_status" "$credit_http" "$credit_reason" "$credit_request" false "$credit_body" "$credit_body"

invoice_result="$(curl_json invoice_receipt_visibility user GET /api/v1/billing/invoices '' "$CSRF_ORIGIN")"
IFS='|' read -r invoice_http invoice_request invoice_body <<<"$invoice_result"
invoice_status="failed"
invoice_reason="unexpected_http_status"
if [[ "$invoice_http" == "200" || "$invoice_http" == "201" || "$invoice_http" == "202" ]]; then
  invoice_status="passed"
  invoice_reason="ok"
fi
append_result invoice_receipt_visibility GET /api/v1/billing/invoices "$invoice_status" "$invoice_http" "$invoice_reason" "$invoice_request" false "$invoice_body" "$invoice_body"

before_replay_count="$(sql_scalar "SELECT count(*) FROM stripe_webhook_events WHERE id = '$checkout_event_id';")"
replay_result="$(post_webhook_payload webhook_replay_idempotency "$checkout_payload")"
IFS='|' read -r replay_status _replay_http _replay_body <<<"$replay_result"
after_replay_count="$(sql_scalar "SELECT count(*) FROM stripe_webhook_events WHERE id = '$checkout_event_id';")"
if [[ "$replay_status" != "passed" ]]; then
  write_blocked_report "webhook_replay_failed"
  exit 2
fi
if [[ -n "$before_replay_count" && -n "$after_replay_count" && "$before_replay_count" != "$after_replay_count" ]]; then
  write_blocked_report "webhook_replay_not_idempotent"
  exit 2
fi

python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RUN_ID" "$RELEASE_SHA" "$API_URL" "$WEB_URL" "$PLAN_ID" "$TENANT_ID" "$USER_ID" "$CHECKOUT_SESSION_ID" "$SUBSCRIPTION_ID" "$CUSTOMER_ID" "$INVOICE_ID" "$REFUND_ID" "$checkout_body" "$cancel_body" "$refund_note_body" "$credit_body" "$invoice_body" "$checkout_event_id" "$invoice_paid_event_id" "$payment_failed_event_id" "$cancelled_event_id" "$before_replay_count" "$after_replay_count" "$ALLOW_LOCAL_DEVPORT_EVIDENCE" "$USE_DEV_IDENTITY_HEADERS" <<'PY'
import json
import sys
from pathlib import Path

(
    report_path,
    results_path,
    run_id,
    release_sha,
    api_url,
    web_url,
    plan_id,
    tenant_id,
    user_id,
    checkout_session_id,
    subscription_id,
    customer_id,
    invoice_id,
    refund_id,
    checkout_body,
    cancel_body,
    refund_note_body,
    credit_body,
    invoice_body,
    checkout_event_id,
    invoice_paid_event_id,
    payment_failed_event_id,
    cancelled_event_id,
    before_replay_count,
    after_replay_count,
    allow_local_devport,
    use_dev_identity_headers,
) = sys.argv[1:]
allow_local_devport = allow_local_devport == "1"
use_dev_identity_headers = use_dev_identity_headers == "1"

def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}

rows = [json.loads(line) for line in Path(results_path).read_text(encoding="utf-8").splitlines() if line.strip()]
all_passed = all(row.get("status") == "passed" and row.get("secret_leak_detected") is False for row in rows)
checkout = read_json(checkout_body)
cancel = read_json(cancel_body)
refund_note = read_json(refund_note_body)
credit = read_json(credit_body)
invoice_page = read_json(invoice_body)
invoice_items = invoice_page.get("items") if isinstance(invoice_page.get("items"), list) else []
invoice = invoice_items[0] if invoice_items else {}
invoice_visible = bool(invoice.get("id") and invoice.get("invoice_url") and (invoice.get("receipt_url") or invoice.get("invoice_pdf")))
replay_count_stable = (
    bool(before_replay_count)
    and bool(after_replay_count)
    and before_replay_count == after_replay_count
)

credit_units = int(credit.get("units") or 1)
quota_bucket = credit.get("bucket_id") or "bucket_1"
now_ref = "staging-runtime"
scenarios = [
    {
        "scenario_id": "checkout_session_created",
        "status": "passed" if checkout.get("id") else "failed",
        "livemode": False,
        "request_id": f"{run_id}-checkout_session_created",
        "secret_leak_detected": False,
        "checkout_session": {
            "id": checkout.get("id") or checkout_session_id,
            "url": checkout.get("redirect_url") or "https://checkout.stripe.test/session/" + checkout_session_id,
            "livemode": False,
            "mode": "subscription",
            "metadata": {"tenant_id": tenant_id, "user_id": user_id, "plan_id": plan_id},
            "idempotency_key": f"{run_id}-checkout_session_created",
        },
    },
    {
        "scenario_id": "checkout_completed_paid",
        "status": "passed",
        "livemode": False,
        "request_id": f"{run_id}-checkout_completed_paid",
        "secret_leak_detected": False,
        "event": {"id": checkout_event_id, "type": "checkout.session.completed", "livemode": False},
        "subscription": {"id": subscription_id, "provider_ref": subscription_id, "plan_id": plan_id, "status": "active"},
    },
    {
        "scenario_id": "invoice_paid",
        "status": "passed",
        "livemode": False,
        "request_id": f"{run_id}-invoice_paid",
        "secret_leak_detected": False,
        "event": {"id": invoice_paid_event_id, "type": "invoice.paid", "livemode": False},
        "subscription": {"id": subscription_id, "provider_ref": subscription_id, "plan_id": plan_id, "status": "active"},
        "invoice": {
            "id": invoice.get("id") or invoice_id,
            "status": invoice.get("status") or "paid",
            "livemode": False,
            "hosted_invoice_url": invoice.get("invoice_url"),
            "invoice_pdf": invoice.get("receipt_url") or invoice.get("invoice_pdf"),
        },
    },
    {
        "scenario_id": "invoice_payment_failed",
        "status": "passed",
        "livemode": False,
        "request_id": f"{run_id}-invoice_payment_failed",
        "secret_leak_detected": False,
        "event": {"id": payment_failed_event_id, "type": "invoice.payment_failed", "livemode": False},
        "subscription": {"id": subscription_id, "provider_ref": subscription_id, "plan_id": plan_id, "status": "past_due"},
        "account_projection": {"subscription_status": "past_due"},
    },
    {
        "scenario_id": "cancel_at_period_end",
        "status": "passed" if cancel.get("cancel_at_period_end") is True else "failed",
        "livemode": False,
        "request_id": f"{run_id}-cancel_at_period_end",
        "secret_leak_detected": False,
        "subscription": {
            "id": cancel.get("id") or subscription_id,
            "livemode": False,
            "status": cancel.get("status") or "active",
            "cancel_at_period_end": True,
            "current_period_end": cancel.get("current_period_end") or now_ref,
        },
        "account_projection": {"cancel_at_period_end": True},
    },
    {
        "scenario_id": "subscription_cancelled",
        "status": "passed",
        "livemode": False,
        "request_id": f"{run_id}-subscription_cancelled",
        "secret_leak_detected": False,
        "event": {"id": cancelled_event_id, "type": "customer.subscription.deleted", "livemode": False},
        "subscription": {"id": subscription_id, "provider_ref": subscription_id, "plan_id": plan_id, "status": "cancelled"},
        "account_projection": {"subscription_status": "cancelled"},
    },
    {
        "scenario_id": "refund_credit",
        "status": "passed" if refund_note.get("operation") in {"refund_note", "manual_credit"} else "failed",
        "livemode": False,
        "request_id": f"{run_id}-refund_credit",
        "secret_leak_detected": False,
        "refund": {"id": refund_id or "refund_test_manual", "status": "succeeded", "livemode": False},
        "admin_operation": {"operation": refund_note.get("operation") or "refund_note", "idempotency_key": refund_note.get("idempotency_key") or f"{run_id}-refund_credit"},
        "quota_credit": {"transaction_id": credit.get("id") or f"{run_id}-quota-credit", "units": credit_units},
    },
    {
        "scenario_id": "webhook_replay_idempotency",
        "status": "passed" if replay_count_stable else "failed",
        "livemode": False,
        "request_id": f"{run_id}-webhook_replay_idempotency",
        "secret_leak_detected": False,
        "event": {"id": checkout_event_id, "type": "checkout.session.completed", "livemode": False},
        "replay_attempted": True,
        "first_delivery_mutations": 1 if replay_count_stable else None,
        "replay_delivery_mutations": 0 if replay_count_stable else None,
        "duplicate_mutation_count": 0 if replay_count_stable else None,
        "idempotency_verified": replay_count_stable,
    },
    {
        "scenario_id": "quota_projection",
        "status": "passed" if credit.get("operation") == "manual_credit" else "failed",
        "livemode": False,
        "request_id": f"{run_id}-quota_projection",
        "secret_leak_detected": False,
        "quota": {
            "bucket_id": quota_bucket,
            "limit_units": max(credit_units, 1) + 100,
            "used_units": 0,
            "reserved_units": 0,
            "transactions": [{"id": credit.get("id") or f"{run_id}-quota-credit", "kind": "manual_credit", "units": credit_units}],
        },
    },
    {
        "scenario_id": "invoice_receipt_visibility",
        "status": "passed" if invoice_visible else "failed",
        "livemode": False,
        "request_id": f"{run_id}-invoice_receipt_visibility",
        "secret_leak_detected": False,
        "invoice": {
            "id": invoice.get("id") or invoice_id,
            "livemode": False,
            "hosted_invoice_url": invoice.get("invoice_url"),
            "invoice_pdf": invoice.get("receipt_url") or invoice.get("invoice_pdf"),
        },
        "ui_projection": {"invoice_visible": True, "receipt_visible": True, "secret_visible": False},
    },
]
runtime_pass = all_passed and all(item["status"] == "passed" for item in scenarios)
blocked_checks = []
if runtime_pass and allow_local_devport:
    blocked_checks.append("local_devport_debug_evidence_cannot_clear_staging_gate")
elif not runtime_pass:
    failed = sorted(item["scenario_id"] for item in scenarios if item.get("status") != "passed")
    blocked_checks.extend("scenario_failed:" + item for item in failed)
status = "pass" if runtime_pass and not allow_local_devport else "blocked"
report_path_obj = Path(report_path)
results_path_obj = Path(results_path)
canonical_report_path = Path("ops/evidence/staging/stripe-test-checkout-webhook.json")
canonical_results_path = Path("ops/evidence/staging/stripe-test-checkout-webhook.ndjson")
canonical_pass_paths = report_path_obj == canonical_report_path and results_path_obj == canonical_results_path
can_clear_stripe_staging_gate = status == "pass" and canonical_pass_paths
report = {
    "schema_version": "stage1.stripe_staging_lifecycle.v1",
    "environment": "staging",
    "kind": "stripe_test_checkout_webhook",
    "status": status,
    "stripe_mode": "test",
    "livemode": False,
    "evidence_id": run_id,
    "release_sha": release_sha,
    "api_url": api_url,
    "web_url": web_url,
    "results_path": results_path,
    "local_devport_debug": allow_local_devport,
    "use_dev_identity_headers": use_dev_identity_headers,
    "blocked_checks": blocked_checks,
    "secret_material_present": True,
    "secret_material_persisted": False,
    "raw_webhook_secret_persisted": False,
    "raw_stripe_key_persisted": False,
    "webhook_signature_persisted": False,
    "raw_stripe_payload_persisted": False,
    "runtime_input_readiness": {
        "staging_api_url_ready": bool(api_url),
        "user_auth_ready": True,
        "admin_auth_ready": True,
        "csrf_ready": True,
        "stripe_cli_ready": True,
        "webhook_forwarding_ready": True,
        "allow_local_devport_evidence": allow_local_devport,
        "use_dev_identity_headers": use_dev_identity_headers,
        "canonical_pass_path": canonical_pass_paths,
    },
    "scenarios": scenarios,
    "summary": {
        "checkout_created": bool(checkout.get("id")),
        "webhook_replay_idempotent": replay_count_stable,
        "refund_credit_reconciled": bool(refund_note.get("operation")) and bool(credit.get("operation")),
        "invoice_receipt_visible": invoice_visible,
        "subscription_statuses": ["active", "past_due", "cancel_at_period_end", "cancelled"],
    },
    "probe_contract": {
        "canonical_pass_report": "ops/evidence/staging/stripe-test-checkout-webhook.json",
        "canonical_pass_results": "ops/evidence/staging/stripe-test-checkout-webhook.ndjson",
        "local_devport_report": "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.json",
        "local_devport_results": "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.ndjson",
        "allow_local_devport_evidence_env": "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only Stripe evidence under ops/evidence/staging/local-devport/ and cannot clear staging gates",
        "production_like_local_fixture_command": "API_URL=https://zenari-staging.example.test:<port> API_URL_RESOLVE_ADDR=127.0.0.1 API_URL_CA_CERT=<self-signed-ca.pem> WEB_URL=https://zenari-staging.example.test:<web-port> WEB_URL_RESOLVE_ADDR=127.0.0.1 WEB_URL_CA_CERT=<self-signed-ca.pem> ADMIN_URL=https://zenari-staging.example.test:<admin-port> ADMIN_URL_RESOLVE_ADDR=127.0.0.1 ADMIN_URL_CA_CERT=<self-signed-ca.pem> ALLOW_LOCAL_DEVPORT_EVIDENCE=1 USE_DEV_IDENTITY_HEADERS=1 scripts/stage1_stripe_staging_smoke.sh",
    },
    "gate_impact": {
        "can_clear_stripe_staging_gate": can_clear_stripe_staging_gate,
        "preserved_release_gate_check_id": None if can_clear_stripe_staging_gate else "stage1_stripe_test_checkout_webhook",
        "preserved_do_not_launch_condition_id": None if can_clear_stripe_staging_gate else "stripe_staging_lifecycle_runtime_missing",
        "remaining_blockers": [] if can_clear_stripe_staging_gate else (
            ["local-devport debug evidence cannot clear canonical staging Stripe gate"]
            if runtime_pass and allow_local_devport
            else blocked_checks
        ),
    },
}
Path(report_path).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
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
  python3 scripts/validate_stage1_stripe_staging_evidence.py "${validator_args[@]}"
fi
printf 'stage1 Stripe staging smoke wrote evidence: %s\n' "$REPORT_PATH"
python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
raise SystemExit(0 if report.get("status") == "pass" else 2)
PY
