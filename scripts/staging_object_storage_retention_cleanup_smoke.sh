#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE_URL="${BASE_URL:-${STAGING_API_URL:-${STAGING_BASE_URL:-}}}"
BASE_URL_RESOLVE_ADDR="${BASE_URL_RESOLVE_ADDR:-${STAGING_API_URL_RESOLVE_ADDR:-${STAGING_BASE_URL_RESOLVE_ADDR:-${STAGING_API_RESOLVE_ADDR:-}}}}"
BASE_URL_CA_CERT="${BASE_URL_CA_CERT:-${STAGING_API_URL_CA_CERT:-${STAGING_BASE_URL_CA_CERT:-${STAGING_API_CA_CERT:-}}}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}"
DRY_RUN="${DRY_RUN:-0}"
ALLOW_LOCAL_DEVPORT_EVIDENCE="${ALLOW_LOCAL_DEVPORT_EVIDENCE:-0}"
WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE="${WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE:-0}"
OBJECT_RETENTION_MODE="${OBJECT_RETENTION_MODE:-${RETENTION_MODE:-}}"
RUN_ID="${RUN_ID:-object-storage-retention-cleanup}"
OUT_DIR_WAS_SET=0
REPORT_PATH_WAS_SET=0
RESULTS_PATH_WAS_SET=0
if [[ -n "${REPORT_PATH+x}" ]]; then
  REPORT_PATH_WAS_SET=1
fi
if [[ -n "${RESULTS_PATH+x}" ]]; then
  RESULTS_PATH_WAS_SET=1
fi
if [[ -n "${OUT_DIR+x}" || -n "${REPORT_PATH+x}" || -n "${RESULTS_PATH+x}" ]]; then
  OUT_DIR_WAS_SET=1
fi
if [[ "$OBJECT_RETENTION_MODE" == "preflight_stage1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  OUT_DIR="ops/evidence/staging"
elif [[ "$DRY_RUN" == "1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  OUT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/stage0-object-retention-dry-run.XXXXXX")"
elif [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  OUT_DIR="ops/evidence/staging/local-devport"
else
  OUT_DIR="${OUT_DIR:-ops/evidence/staging}"
fi
if [[ "$OBJECT_RETENTION_MODE" == "preflight_stage1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/object-storage-retention-cleanup.preflight.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/object-storage-retention-cleanup.preflight.ndjson}"
elif [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/object-storage-retention-cleanup.local-devport.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/object-storage-retention-cleanup.local-devport.ndjson}"
elif [[ "$WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE" == "1" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/$RUN_ID.candidate.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/$RUN_ID.candidate.ndjson}"
elif [[ "$RUN_ID" == "object-storage-retention-cleanup" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/object-storage-retention-cleanup.blocked.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/object-storage-retention-cleanup.blocked.ndjson}"
else
  REPORT_PATH="${REPORT_PATH:-$OUT_DIR/$RUN_ID.json}"
  RESULTS_PATH="${RESULTS_PATH:-$OUT_DIR/$RUN_ID.ndjson}"
fi
if [[ "$OBJECT_RETENTION_MODE" == "preflight_stage1" ]]; then
  if [[ "$REPORT_PATH_WAS_SET" != "1" ]]; then
    REPORT_PATH="$OUT_DIR/object-storage-retention-cleanup.preflight.json"
  fi
  if [[ "$RESULTS_PATH_WAS_SET" != "1" ]]; then
    RESULTS_PATH="$OUT_DIR/object-storage-retention-cleanup.preflight.ndjson"
  fi
fi
if [[ "$WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE" == "1" ]]; then
  canonical_path_requested="$(
    python3 - "$REPORT_PATH" "$RESULTS_PATH" <<'PY'
import sys
from pathlib import Path

report_path = Path(sys.argv[1]).resolve()
results_path = Path(sys.argv[2]).resolve()
canonical_report = Path("ops/evidence/staging/object-storage-retention-cleanup.json").resolve()
canonical_results = Path("ops/evidence/staging/object-storage-retention-cleanup.ndjson").resolve()
print("1" if report_path == canonical_report or results_path == canonical_results else "0")
PY
  )"
  if [[ "$canonical_path_requested" == "1" ]]; then
    REPORT_PATH="${OUT_DIR%/}/$RUN_ID.candidate.json"
    RESULTS_PATH="${OUT_DIR%/}/$RUN_ID.candidate.ndjson"
  fi
fi
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
SIGNED_URL_EVIDENCE="${SIGNED_URL_EVIDENCE:-ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json}"
REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}"
REQUEST_ID_VALUE="${REQUEST_ID_VALUE:-stage0-object-retention-cleanup}"
CSRF_HEADER_NAME="${CSRF_HEADER_NAME:-X-Zenari-CSRF}"
CSRF_HEADER_VALUE="${CSRF_HEADER_VALUE:-same-site-origin-check}"
CSRF_ORIGIN="${CSRF_ORIGIN:-${STAGING_ADMIN_URL:-${ADMIN_URL:-${STAGING_WEB_URL:-${WEB_URL:-}}}}}"

RETENTION_POLICY_URL="${RETENTION_POLICY_URL:-}"
EXPIRED_EXPORT_CLEANUP_URL="${EXPIRED_EXPORT_CLEANUP_URL:-}"
ORPHAN_CLEANUP_URL="${ORPHAN_CLEANUP_URL:-}"
AUDIT_REFS_URL="${AUDIT_REFS_URL:-}"

ADMIN_BEARER_TOKEN="${ADMIN_BEARER_TOKEN:-${STAGING_ADMIN_BEARER_TOKEN:-}}"
ADMIN_SESSION_COOKIE="${ADMIN_SESSION_COOKIE:-${STAGING_ADMIN_SESSION_COOKIE:-}}"
USE_DEV_IDENTITY_HEADERS="${USE_DEV_IDENTITY_HEADERS:-0}"
ADMIN_DEV_ROLES="${ADMIN_DEV_ROLES:-admin_operator}"
SMOKE_ADMIN_USER_ID="${SMOKE_ADMIN_USER_ID:-${ADMIN_USER_ID:-}}"
SMOKE_ADMIN_TENANT_ID="${SMOKE_ADMIN_TENANT_ID:-${TENANT_ID:-}}"
LOCAL_ADMIN_SESSION_EMAIL="${LOCAL_ADMIN_SESSION_EMAIL:-admin@zenari.ai}"

mkdir -p "$OUT_DIR"
: >"$RESULTS_PATH"

if [[ -n "$BASE_URL" ]]; then
  RETENTION_POLICY_URL="${RETENTION_POLICY_URL:-${BASE_URL%/}/api/admin/v1/object-storage/retention-policy}"
  EXPIRED_EXPORT_CLEANUP_URL="${EXPIRED_EXPORT_CLEANUP_URL:-${BASE_URL%/}/api/admin/v1/object-storage/cleanup/expired-exports}"
  ORPHAN_CLEANUP_URL="${ORPHAN_CLEANUP_URL:-${BASE_URL%/}/api/admin/v1/object-storage/cleanup/orphans}"
  AUDIT_REFS_URL="${AUDIT_REFS_URL:-${BASE_URL%/}/api/admin/v1/audit?subject=object_storage_cleanup&limit=20}"
fi

acquire_local_admin_session() {
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" || -n "$ADMIN_BEARER_TOKEN" || -n "$ADMIN_SESSION_COOKIE" ]]; then
    return 0
  fi
  if [[ -z "$BASE_URL" || -z "$CSRF_ORIGIN" || -z "$SMOKE_ADMIN_TENANT_ID" ]]; then
    return 0
  fi
  local session_url="${BASE_URL%/}/api/admin/v1/auth/local/session"
  local headers_path body_path http_status cookie_value
  headers_path="$(mktemp /tmp/zenari-object-retention-admin-session-headers.XXXXXX)"
  body_path="$(mktemp /tmp/zenari-object-retention-admin-session-body.XXXXXX)"
  local curl_resolve_args=()
  if [[ -n "$BASE_URL_RESOLVE_ADDR" ]]; then
    local resolve_host resolve_port
    read -r resolve_host resolve_port < <(
      python3 - "$session_url" <<'PY'
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
    if [[ -n "${resolve_host:-}" && -n "${resolve_port:-}" ]]; then
      curl_resolve_args+=(--resolve "$resolve_host:$resolve_port:$BASE_URL_RESOLVE_ADDR" --noproxy "$resolve_host")
    fi
  fi
  local curl_tls_args=()
  if [[ -n "$BASE_URL_CA_CERT" ]]; then
    curl_tls_args+=(--cacert "$BASE_URL_CA_CERT")
  fi
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
    --header "$REQUEST_ID_HEADER: $RUN_ID-bootstrap-admin-session"
    --header "Content-Type: application/json"
    --header "$CSRF_HEADER_NAME: $CSRF_HEADER_VALUE"
    --header "Origin: $CSRF_ORIGIN"
    --data '{"email":"'"$LOCAL_ADMIN_SESSION_EMAIL"'","tenant_id":"'"$SMOKE_ADMIN_TENANT_ID"'","roles":["admin_operator"]}'
  )
  if [[ ${#curl_resolve_args[@]} -gt 0 ]]; then
    curl_args+=("${curl_resolve_args[@]}")
  fi
  if [[ ${#curl_tls_args[@]} -gt 0 ]]; then
    curl_args+=("${curl_tls_args[@]}")
  fi
  http_status="$(curl "${curl_args[@]}" || true)"
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

acquire_local_admin_session

AUTH_READY="0"
if [[ -n "$ADMIN_BEARER_TOKEN" || -n "$ADMIN_SESSION_COOKIE" ]]; then
  AUTH_READY="1"
fi
if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
  AUTH_READY="1"
fi
CSRF_READY="0"
if [[ -n "$CSRF_HEADER_NAME" && -n "$CSRF_HEADER_VALUE" && -n "$CSRF_ORIGIN" ]]; then
  CSRF_READY="1"
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
  local request_id="$9"
  local headers_path="${10:-}"
  python3 - "$RESULTS_PATH" "$check_id" "$method" "$url" "$expected_tokens" "$status" "$http_status" "$reason" "$body_path" "$request_id" "$REQUEST_ID_HEADER" "$headers_path" <<'PY'
import json
import sys
from pathlib import Path

(
    result_path,
    check_id,
    method,
    url,
    expected_tokens,
    status,
    http_status,
    reason,
    body_path,
    request_id,
    request_id_header,
    headers_path,
) = sys.argv[1:]
tokens = [token.strip() for token in expected_tokens.split(",") if token.strip()]
body = ""
if body_path:
    path = Path(body_path)
    if path.exists() and path.is_file():
        body = path.read_text(encoding="utf-8", errors="replace")
body_lower = body.lower()
try:
    parsed_body = json.loads(body) if body else None
except json.JSONDecodeError:
    parsed_body = None
json_blob = json.dumps(parsed_body, sort_keys=True).lower() if parsed_body is not None else ""


def has_token(token):
    normalized = token.lower()
    aliases = {
        "retention policy": [
            "retention policy",
            "retention_policy",
            "retention_state",
            "retention_until",
        ],
        "versioning": ["versioning", "version_id", "object_versioning"],
        "retention_until": ["retention_until"],
        "tenant": ["tenant", "tenant_id"],
        "expired export cleanup": [
            "expired export cleanup",
            "expired_export_cleanup",
            "expired_exports",
            "export.cleanup",
            "export.cleanup.preview",
        ],
        "orphan cleanup": [
            "orphan cleanup",
            "orphan_cleanup",
            "orphaned_objects",
            "export.cleanup",
            "export.cleanup.preview",
        ],
        "deleted": ["deleted", "deleted_objects"],
        "retained": [
            "retained",
            "retention_state",
            "retention_until",
            "preview_objects",
            "dry_run",
        ],
        "audit": ["audit", "audit_id", "audit_refs", "object_retention_cleanup"],
        "object_storage_cleanup": [
            "object_storage_cleanup",
            "object_retention_cleanup",
            "export.cleanup",
            "export.cleanup.preview",
        ],
        "admin": ["admin", "actor_id", "admin_user_id", "requested_by"],
    }.get(normalized, [normalized])
    return any(alias in body_lower or alias in json_blob for alias in aliases)


matched_tokens = [token for token in tokens if has_token(token)]
missing_tokens = [token for token in tokens if token.lower() not in body.lower()]
missing_tokens = [token for token in tokens if not has_token(token)]
response_request_id_values = []
if headers_path:
    path = Path(headers_path)
    if path.exists() and path.is_file():
        header_name = request_id_header.lower()
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if ":" not in line:
                continue
            name, value = line.split(":", 1)
            if name.strip().lower() == header_name:
                response_request_id_values.append(value.strip())
request_id_echoed = bool(request_id) and request_id in response_request_id_values
final_status = status
final_reason = reason
if status == "passed" and not request_id_echoed:
    final_status = "failed"
    final_reason = "missing_response_request_id_header"
with open(result_path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "check_id": check_id,
        "method": method,
        "url": url,
        "request_id_header": request_id_header,
        "request_id": request_id,
        "response_request_id_values": response_request_id_values,
        "request_id_echoed": request_id_echoed,
        "expected_tokens": tokens,
        "matched_tokens": matched_tokens,
        "missing_tokens": missing_tokens,
        "response_bytes": len(body.encode("utf-8")),
        "status": final_status,
        "http_status": int(http_status) if http_status.isdigit() else None,
        "reason": final_reason,
        "body_path": body_path or None,
        "headers_path": headers_path or None,
    }, sort_keys=True) + "\n")
PY
}

production_like_staging_url_ready() {
  python3 - "$BASE_URL" "$RETENTION_POLICY_URL" "$EXPIRED_EXPORT_CLEANUP_URL" "$ORPHAN_CLEANUP_URL" "$AUDIT_REFS_URL" <<'PY'
import ipaddress
import sys
from urllib.parse import urlparse


def is_private_or_local(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    if normalized in {"", "localhost", "0.0.0.0"} or normalized.endswith(".local"):
        return True
    reserved_suffixes = (
        ".example",
        ".example.com",
        ".example.net",
        ".example.org",
        ".example.test",
        ".invalid",
        ".localhost",
        ".test",
    )
    if any(normalized == suffix[1:] or normalized.endswith(suffix) for suffix in reserved_suffixes):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return bool(ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified)


for raw in sys.argv[1:]:
    raw = raw.strip()
    if not raw:
        continue
    parsed = urlparse(raw)
    if parsed.scheme != "https" or is_private_or_local(parsed.hostname or ""):
        raise SystemExit(1)
raise SystemExit(0)
PY
}

run_probe() {
  local check_id="$1"
  local method="$2"
  local url="$3"
  local expected_tokens="$4"
  local body_file="$OUT_DIR/$RUN_ID.$check_id.body"
  local headers_file="$OUT_DIR/$RUN_ID.$check_id.headers"
  local request_id="$REQUEST_ID_VALUE-$check_id"
  local curl_resolve_args=()
  if [[ -n "$url" && -n "$BASE_URL_RESOLVE_ADDR" ]]; then
    local resolve_host resolve_port
    read -r resolve_host resolve_port < <(
      python3 - "$url" <<'PY'
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
    if [[ -n "${resolve_host:-}" && -n "${resolve_port:-}" ]]; then
      curl_resolve_args+=(--resolve "$resolve_host:$resolve_port:$BASE_URL_RESOLVE_ADDR" --noproxy "$resolve_host")
    fi
  fi
  local curl_tls_args=()
  if [[ -n "$BASE_URL_CA_CERT" ]]; then
    curl_tls_args+=(--cacert "$BASE_URL_CA_CERT")
  fi
  local curl_args=(
    --silent
    --show-error
    --location
    --max-time "$TIMEOUT_SECONDS"
    --request "$method"
    --header "$REQUEST_ID_HEADER: $request_id"
    --dump-header "$headers_file"
    --output "$body_file"
    --write-out "%{http_code}"
  )
  if [[ ${#curl_resolve_args[@]} -gt 0 ]]; then
    curl_args+=("${curl_resolve_args[@]}")
  fi
  if [[ ${#curl_tls_args[@]} -gt 0 ]]; then
    curl_args+=("${curl_tls_args[@]}")
  fi
  if [[ -n "$ADMIN_BEARER_TOKEN" ]]; then
    curl_args+=(--header "Authorization: Bearer $ADMIN_BEARER_TOKEN")
  fi
  if [[ -n "$ADMIN_SESSION_COOKIE" ]]; then
    curl_args+=(--header "Cookie: $ADMIN_SESSION_COOKIE")
  fi
  if [[ "$USE_DEV_IDENTITY_HEADERS" == "1" ]]; then
    curl_args+=(--header "X-Zenari-User-ID: $SMOKE_ADMIN_USER_ID")
    curl_args+=(--header "X-Zenari-Tenant-ID: $SMOKE_ADMIN_TENANT_ID")
    curl_args+=(--header "X-Zenari-Roles: $ADMIN_DEV_ROLES")
  fi
  if [[ "$method" == "POST" ]]; then
    curl_args+=(
      --header "Content-Type: application/json"
      --header "$CSRF_HEADER_NAME: $CSRF_HEADER_VALUE"
      --header "Idempotency-Key: $request_id"
      --header "Origin: $CSRF_ORIGIN"
      --data "{\"rationale\":\"stage0 retention cleanup smoke ${check_id}\",\"limit\":25,\"dry_run\":true}"
    )
  fi

  local http_status
  http_status="$(curl "${curl_args[@]}" "$url" || true)"
  if [[ "$http_status" != "200" && "$http_status" != "202" ]]; then
    append_result "$check_id" "$method" "$url" "$expected_tokens" "failed" "$http_status" "unexpected_http_status" "$body_file" "$request_id" "$headers_file"
    return
  fi

  append_result "$check_id" "$method" "$url" "$expected_tokens" "passed" "$http_status" "ok" "$body_file" "$request_id" "$headers_file"
}

if [[ "$OBJECT_RETENTION_MODE" == "preflight_stage1" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    append_result "$check_id" "$method" "$url" "$expected_tokens" "planned" "" "preflight_stage1_no_runtime_probe" "" "$REQUEST_ID_VALUE-$check_id" ""
  done
elif [[ "$DRY_RUN" == "1" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    append_result "$check_id" "$method" "$url" "$expected_tokens" "planned" "" "dry_run_no_staging_runtime_probe" "" "$REQUEST_ID_VALUE-$check_id" ""
  done
elif [[ -z "$BASE_URL" && -z "$RETENTION_POLICY_URL$EXPIRED_EXPORT_CLEANUP_URL$ORPHAN_CLEANUP_URL$AUDIT_REFS_URL" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    append_result "$check_id" "$method" "$url" "$expected_tokens" "blocked" "" "missing_staging_base_url_or_explicit_probe_urls" "" "$REQUEST_ID_VALUE-$check_id" ""
  done
elif [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" ]] && ! production_like_staging_url_ready; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    append_result "$check_id" "$method" "$url" "$expected_tokens" "blocked" "" "production_like_staging_url_required" "" "$REQUEST_ID_VALUE-$check_id" ""
  done
elif [[ "$AUTH_READY" != "1" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    append_result "$check_id" "$method" "$url" "$expected_tokens" "blocked" "" "missing_admin_auth" "" "$REQUEST_ID_VALUE-$check_id" ""
  done
elif [[ -z "$SMOKE_ADMIN_USER_ID" || -z "$SMOKE_ADMIN_TENANT_ID" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    append_result "$check_id" "$method" "$url" "$expected_tokens" "blocked" "" "missing_smoke_admin_user_or_tenant_id" "" "$REQUEST_ID_VALUE-$check_id" ""
  done
elif [[ "$CSRF_READY" != "1" ]]; then
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    if [[ "$method" == "POST" ]]; then
      append_result "$check_id" "$method" "$url" "$expected_tokens" "blocked" "" "missing_csrf_origin_or_header" "" "$REQUEST_ID_VALUE-$check_id" ""
    else
      append_result "$check_id" "$method" "$url" "$expected_tokens" "planned" "" "waiting_for_post_probe_csrf_inputs" "" "$REQUEST_ID_VALUE-$check_id" ""
    fi
  done
else
  for check in "${CHECKS[@]}"; do
    IFS='|' read -r check_id method url expected_tokens <<<"$check"
    if [[ -z "$url" ]]; then
      append_result "$check_id" "$method" "$url" "$expected_tokens" "blocked" "" "missing_probe_url" "" "$REQUEST_ID_VALUE-$check_id" ""
    else
      run_probe "$check_id" "$method" "$url" "$expected_tokens"
    fi
  done
fi

actual_report_path="$(
python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RUN_ID" "$RELEASE_SHA" "$BASE_URL" "$SMOKE_ADMIN_USER_ID" "$SMOKE_ADMIN_TENANT_ID" "$SIGNED_URL_EVIDENCE" "$AUTH_READY" "$REQUEST_ID_HEADER" "$CSRF_READY" "$CSRF_HEADER_NAME" "$CSRF_ORIGIN" "$ALLOW_LOCAL_DEVPORT_EVIDENCE" "$USE_DEV_IDENTITY_HEADERS" "$ADMIN_DEV_ROLES" "$WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE" "$BASE_URL_RESOLVE_ADDR" <<'PY'
import ipaddress
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
run_id = sys.argv[3]
release_sha = sys.argv[4].strip()
base_url = sys.argv[5].strip()
admin_user_id = sys.argv[6].strip()
admin_tenant_id = sys.argv[7].strip()
signed_url_evidence = sys.argv[8].strip()
auth_ready = sys.argv[9] == "1"
request_id_header = sys.argv[10].strip()
csrf_ready = sys.argv[11] == "1"
csrf_header_name = sys.argv[12].strip()
csrf_origin = sys.argv[13].strip()
allow_local_devport = sys.argv[14].strip() == "1"
use_dev_identity_headers = sys.argv[15].strip() == "1"
admin_dev_roles = sys.argv[16].strip()
write_canonical = sys.argv[17].strip() == "1"
base_url_resolve_addr = sys.argv[18].strip()
preflight_mode = run_id == "object-storage-retention-cleanup" and report_path.name == "object-storage-retention-cleanup.preflight.json"


reserved_suffixes = (
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".example.test",
    ".invalid",
    ".localhost",
    ".local",
    ".test",
)


def is_reserved_or_local_host(host):
    normalized = (host or "").strip().lower().strip("[]")
    if not normalized or normalized in {"localhost", "0.0.0.0"}:
        return True
    if any(normalized == suffix[1:] or normalized.endswith(suffix) for suffix in reserved_suffixes):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def strict_staging_url_ready(value):
    parsed = urlparse(value or "")
    return parsed.scheme == "https" and bool(parsed.netloc) and not is_reserved_or_local_host(parsed.hostname)


results = [
    json.loads(line)
    for line in results_path.read_text(encoding="utf-8").splitlines()
    if line.strip()
]
probe_urls_ready = all(str(item.get("url", "")).strip() for item in results)
required = {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}
passed = {item["check_id"] for item in results if item["status"] == "passed"}
observed = {item["check_id"] for item in results}
missing_required_results = sorted(required - observed)
unexpected_results = sorted(observed - required)
blocked_or_failed = [
    f"{item['check_id']}:{item['reason']}"
    for item in results
    if item["status"] != "passed"
]
token_blockers = [
    f"{item['check_id']}:missing_expected_tokens:{','.join(item.get('missing_tokens', []))}"
    for item in results
    if item["status"] == "passed" and item.get("missing_tokens")
]
empty_response_blockers = [
    f"{item['check_id']}:empty_runtime_response_body"
    for item in results
    if item["status"] == "passed" and int(item.get("response_bytes") or 0) <= 0
]
request_id_blockers = [
    f"{item['check_id']}:missing_request_id"
    for item in results
    if item["status"] == "passed" and not item.get("request_id")
]
request_id_echo_blockers = [
    f"{item['check_id']}:missing_response_request_id_header"
    for item in results
    if item["status"] == "passed" and item.get("request_id_echoed") is not True
]
shape_blockers = [f"missing_required_result:{item}" for item in missing_required_results]
shape_blockers.extend(f"unexpected_result:{item}" for item in unexpected_results)
blocked_or_failed.extend(token_blockers)
blocked_or_failed.extend(empty_response_blockers)
blocked_or_failed.extend(request_id_blockers)
blocked_or_failed.extend(request_id_echo_blockers)
blocked_or_failed.extend(shape_blockers)
def load_result_body(item):
    body_path = item.get("body_path")
    if not body_path:
        return None
    path = Path(str(body_path))
    if not path.exists() or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="replace"))
    except json.JSONDecodeError:
        return None


def collect_audit_refs(value):
    refs = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            normalized_key = str(key).lower()
            if normalized_key in {"audit_id", "audit_ref", "audit_reference"} and isinstance(nested, str):
                refs.add(nested)
            elif normalized_key in {"audit_refs", "audit_references", "audit_ids"}:
                if isinstance(nested, list):
                    for item in nested:
                        if isinstance(item, str):
                            refs.add(item)
                        elif isinstance(item, dict):
                            refs.update(collect_audit_refs(item))
                elif isinstance(nested, str):
                    refs.add(nested)
                elif isinstance(nested, dict):
                    refs.update(collect_audit_refs(nested))
            refs.update(collect_audit_refs(nested))
    elif isinstance(value, list):
        for item in value:
            refs.update(collect_audit_refs(item))
    return refs


def collect_audit_entries(value):
    entries = []
    if isinstance(value, dict):
        if collect_audit_refs(value):
            entries.append(value)
        for nested in value.values():
            entries.extend(collect_audit_entries(nested))
    elif isinstance(value, list):
        for item in value:
            entries.extend(collect_audit_entries(item))
    return entries


def audit_entry_has_cleanup_semantics(entry):
    blob = json.dumps(entry, sort_keys=True).lower()
    has_cleanup_subject = any(
        token in blob
        for token in (
            "object_storage_cleanup",
            "object_retention_cleanup",
            "expired_export_cleanup",
            "orphan_cleanup",
            "export.cleanup",
            "export.cleanup.preview",
        )
    )
    has_admin_actor = any(
        token in blob
        for token in (
            "admin",
            "actor_id",
            "admin_user_id",
            "requested_by",
            "performed_by",
        )
    )
    has_tenant_scope = "tenant" in blob or "tenant_id" in blob
    return has_cleanup_subject and has_admin_actor and has_tenant_scope


def audit_entry_contains_request_id(entry, request_id):
    if not request_id:
        return False
    return request_id in json.dumps(entry, sort_keys=True)


passed_by_check = {
    item["check_id"]: item
    for item in results
    if item["status"] == "passed"
}
cleanup_audit_refs_by_probe = {}
cleanup_audit_refs = set()
for cleanup_check in ("expired_export_cleanup", "orphan_cleanup"):
    cleanup_body = load_result_body(passed_by_check.get(cleanup_check, {}))
    refs = collect_audit_refs(cleanup_body)
    cleanup_audit_refs_by_probe[cleanup_check] = sorted(refs)
    if cleanup_check in passed_by_check and not refs:
        blocked_or_failed.append(f"{cleanup_check}:missing_cleanup_audit_refs")
    cleanup_audit_refs.update(refs)
audit_refs_body = load_result_body(passed_by_check.get("audit_refs", {}))
audit_endpoint_refs = collect_audit_refs(audit_refs_body)
audit_endpoint_entries = collect_audit_entries(audit_refs_body)
missing_cleanup_audit_refs = sorted(cleanup_audit_refs - audit_endpoint_refs)
audit_endpoint_covers_cleanup_refs = {
    probe_id: [ref for ref in refs if ref in audit_endpoint_refs]
    for probe_id, refs in cleanup_audit_refs_by_probe.items()
}
audit_endpoint_missing_cleanup_refs = {
    probe_id: [ref for ref in refs if ref not in audit_endpoint_refs]
    for probe_id, refs in cleanup_audit_refs_by_probe.items()
}
if cleanup_audit_refs and missing_cleanup_audit_refs:
    blocked_or_failed.append(
        "audit_refs:missing_cleanup_audit_refs:" + ",".join(missing_cleanup_audit_refs)
    )
semantic_audit_refs = set()
semantic_audit_refs_by_probe = {}
request_id_audit_refs_by_probe = {}
for probe_id, refs in cleanup_audit_refs_by_probe.items():
    semantic_audit_refs_by_probe[probe_id] = []
    request_id_audit_refs_by_probe[probe_id] = []
    probe_request_id = str(passed_by_check.get(probe_id, {}).get("request_id", ""))
    for entry in audit_endpoint_entries:
        entry_refs = collect_audit_refs(entry)
        if not entry_refs or not audit_entry_has_cleanup_semantics(entry):
            continue
        for ref in refs:
            if ref in entry_refs:
                semantic_audit_refs.add(ref)
                semantic_audit_refs_by_probe[probe_id].append(ref)
                if audit_entry_contains_request_id(entry, probe_request_id):
                    request_id_audit_refs_by_probe[probe_id].append(ref)
semantic_audit_refs_by_probe = {
    probe_id: sorted(set(refs))
    for probe_id, refs in semantic_audit_refs_by_probe.items()
}
request_id_audit_refs_by_probe = {
    probe_id: sorted(set(refs))
    for probe_id, refs in request_id_audit_refs_by_probe.items()
}
semantic_missing_cleanup_audit_refs = sorted(cleanup_audit_refs - semantic_audit_refs)
if cleanup_audit_refs and semantic_missing_cleanup_audit_refs:
    blocked_or_failed.append(
        "audit_refs:missing_cleanup_audit_ref_semantics:"
        + ",".join(semantic_missing_cleanup_audit_refs)
    )
request_id_missing_by_probe = {
    probe_id: sorted(set(refs) - set(request_id_audit_refs_by_probe.get(probe_id, [])))
    for probe_id, refs in cleanup_audit_refs_by_probe.items()
}
request_id_missing_cleanup_audit_refs = sorted({
    ref
    for refs in request_id_missing_by_probe.values()
    for ref in refs
})
if cleanup_audit_refs and request_id_missing_cleanup_audit_refs:
    blocked_or_failed.append(
        "audit_refs:missing_cleanup_audit_request_id_linkage:"
        + ",".join(request_id_missing_cleanup_audit_refs)
    )
audit_linkage_verified = (
    bool(cleanup_audit_refs)
    and not missing_cleanup_audit_refs
    and not semantic_missing_cleanup_audit_refs
    and not request_id_missing_cleanup_audit_refs
    and all(cleanup_audit_refs_by_probe.get(probe_id) for probe_id in ("expired_export_cleanup", "orphan_cleanup"))
    and all(request_id_audit_refs_by_probe.get(probe_id) for probe_id in ("expired_export_cleanup", "orphan_cleanup"))
)
runtime_checks_passed = required <= passed and not blocked_or_failed
canonical_report_path = Path("ops/evidence/staging/object-storage-retention-cleanup.json")
canonical_results_path = Path("ops/evidence/staging/object-storage-retention-cleanup.ndjson")
source_results_path = results_path
strict_target_ready = strict_staging_url_ready(base_url)
strict_target_ready = strict_target_ready and strict_staging_url_ready(csrf_origin)
strict_target_ready = strict_target_ready and all(strict_staging_url_ready(item.get("url", "")) for item in results)
strict_target_ready = strict_target_ready and not base_url_resolve_addr
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
if runtime_checks_passed and not auth_ready:
    release_binding_blockers.append("admin_auth_missing")
if runtime_checks_passed and not admin_user_id:
    release_binding_blockers.append("smoke_admin_user_id_missing")
if runtime_checks_passed and not admin_tenant_id:
    release_binding_blockers.append("smoke_admin_tenant_id_missing")
if runtime_checks_passed and not csrf_ready:
    release_binding_blockers.append("csrf_origin_or_header_missing")
if runtime_checks_passed and preflight_mode:
    release_binding_blockers.append("preflight_stage1_cannot_clear_staging_gate")
if runtime_checks_passed and allow_local_devport:
    release_binding_blockers.append("local_devport_debug_evidence_cannot_clear_staging_gate")
if runtime_checks_passed and not strict_target_ready:
    release_binding_blockers.append("real_staging_target_required_for_canonical_pass")
if runtime_checks_passed and not write_canonical:
    release_binding_blockers.append("canonical_write_not_requested")

blocked_or_failed = blocked_or_failed + release_binding_blockers
all_passed = runtime_checks_passed and signed_url_ready and release_sha_matches_signed_url
all_passed = all_passed and auth_ready and bool(admin_user_id) and bool(admin_tenant_id)
all_passed = all_passed and csrf_ready
all_passed = all_passed and not preflight_mode
all_passed = all_passed and not allow_local_devport
all_passed = all_passed and strict_target_ready and write_canonical
can_clear_release_gate_check = all_passed
if all_passed:
    canonical_report_path.parent.mkdir(parents=True, exist_ok=True)
    results_path = canonical_results_path
    report_path = canonical_report_path
pass_file_policy_ok = report_path == canonical_report_path and results_path == canonical_results_path
if all_passed and not pass_file_policy_ok:
    blocked_or_failed.append("canonical_pass_paths_required_for_gate_closure")
    all_passed = False
    can_clear_release_gate_check = False

if not all_passed and report_path == canonical_report_path:
    blocked_report_path = report_path.with_name("object-storage-retention-cleanup.blocked.json")
    blocked_results_path = results_path.with_name("object-storage-retention-cleanup.blocked.ndjson")
    if results_path.exists():
        blocked_results_path.write_text(results_path.read_text(encoding="utf-8"), encoding="utf-8")
        if results_path == canonical_results_path:
            results_path.unlink()
    report_path = blocked_report_path
    results_path = blocked_results_path
canonical_pass_paths = all_passed and report_path == canonical_report_path and results_path == canonical_results_path

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
        "release_sha_bound": bool(release_sha_matches_signed_url),
        "admin_identity_bound": bool(auth_ready and admin_user_id and admin_tenant_id),
        "request_ids": [
            item.get("request_id", "")
            for item in related
            if item.get("request_id")
        ],
        "response_bytes": sum(int(item.get("response_bytes") or 0) for item in related),
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
        "body": {"rationale": "stage0 retention cleanup smoke expired_export_cleanup", "limit": 25, "dry_run": True},
    },
    "orphan_cleanup": {
        "method": "POST",
        "env_var": "ORPHAN_CLEANUP_URL",
        "default_path": "/api/admin/v1/object-storage/cleanup/orphans",
        "body": {"rationale": "stage0 retention cleanup smoke orphan_cleanup", "limit": 25, "dry_run": True},
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
        "required_base_url": "STAGING_API_URL, STAGING_BASE_URL, or explicit probe URL env vars",
        "required_smoke_admin_user_id": "SMOKE_ADMIN_USER_ID bound to the admin operator executing the cleanup probes",
        "required_smoke_admin_tenant_id": "SMOKE_ADMIN_TENANT_ID bound to the staging tenant whose objects and audit refs are probed",
        "required_csrf_origin": "CSRF_ORIGIN, STAGING_ADMIN_URL, ADMIN_URL, STAGING_WEB_URL, or WEB_URL matching an allowed staging origin for POST cleanup probes",
        "required_csrf_header": f"{csrf_header_name or 'CSRF_HEADER_NAME'} header with CSRF_HEADER_VALUE for state-changing object cleanup POST probes",
        "required_request_id_echo": f"each probe must send {request_id_header} and receive the same value in response headers",
        "required_probe_routes": probe_routes,
        "canonical_pass_report": str(canonical_report_path),
        "canonical_pass_results": str(canonical_results_path),
}
runtime_input_requirements["pass_file_policy"] = (
    "canonical pass paths require passing evidence to be written to ops/evidence/staging/object-storage-retention-cleanup.json "
    "and ops/evidence/staging/object-storage-retention-cleanup.ndjson; non-canonical paths are validation-only."
)
probe_contract = {
    "schema_version": "stage0.rev2.staging.probe_contract",
    "contract_id": "object_storage_retention_cleanup_runtime_probe",
    "environment": "staging",
    "release_gate_check_id": "staging_object_storage_signed_downloads",
    "do_not_launch_condition_id": "object_storage_signed_retention_runtime_missing",
    "canonical_pass_report": str(canonical_report_path),
    "canonical_pass_results": str(canonical_results_path),
    "blocked_report": "ops/evidence/staging/object-storage-retention-cleanup.blocked.json",
    "blocked_results": "ops/evidence/staging/object-storage-retention-cleanup.blocked.ndjson",
    "preflight_report": "ops/evidence/staging/object-storage-retention-cleanup.preflight.json",
    "preflight_results": "ops/evidence/staging/object-storage-retention-cleanup.preflight.ndjson",
    "blocked_without_runtime_inputs": True,
    "preflight_does_not_run_cleanup": True,
    "preflight_can_clear_stage1_staging_runtime_gate": False,
    "non_canonical_reports_are_validation_only": True,
    "pass_evidence_written_only_after_strict_validator_accepts": True,
    "canonical_outputs_are_atomic": True,
    "failed_strict_candidate_writes_blocked_evidence_only": True,
    "local_blocked_command": "DRY_RUN=1 scripts/staging_object_storage_retention_cleanup_smoke.sh || test \"$?\" = 2",
    "preflight_command": "OBJECT_RETENTION_MODE=preflight_stage1 scripts/staging_object_storage_retention_cleanup_smoke.sh || test \"$?\" = 2",
    "local_devport_debug_command": (
        "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 BASE_URL=http://127.0.0.1:31080 "
        "USE_DEV_IDENTITY_HEADERS=1 SMOKE_ADMIN_USER_ID=<admin-user> "
        "SMOKE_ADMIN_TENANT_ID=<tenant> CSRF_ORIGIN=http://localhost:26081 "
        "scripts/staging_object_storage_retention_cleanup_smoke.sh"
    ),
    "local_devport_report": "ops/evidence/staging/local-devport/object-storage-retention-cleanup.local-devport.json",
    "local_devport_results": "ops/evidence/staging/local-devport/object-storage-retention-cleanup.local-devport.ndjson",
    "staging_pass_command": (
        "WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE=1 "
        "STAGING_API_URL=https://<real-staging-admin-or-api> RELEASE_SHA=<signed-url-release-sha> "
        "ADMIN_BEARER_TOKEN=<token> SMOKE_ADMIN_USER_ID=<admin-user> "
        "SMOKE_ADMIN_TENANT_ID=<tenant> CSRF_ORIGIN=<allowed-origin> "
        "CSRF_HEADER_VALUE=<csrf> scripts/staging_object_storage_retention_cleanup_smoke.sh"
    ),
    "production_like_local_fixture_command": (
        "STAGING_API_URL=https://zenari-staging.example.test:<port> "
        "BASE_URL_RESOLVE_ADDR=127.0.0.1 BASE_URL_CA_CERT=<self-signed-ca.pem> "
        "RELEASE_SHA=<signed-url-release-sha> ADMIN_BEARER_TOKEN=<token> "
        "SMOKE_ADMIN_USER_ID=<admin-user> SMOKE_ADMIN_TENANT_ID=<tenant> "
        "CSRF_ORIGIN=https://zenari-staging.example.test:<port> "
        "CSRF_HEADER_VALUE=<csrf> scripts/staging_object_storage_retention_cleanup_smoke.sh"
    ),
    "required_env": [
        "STAGING_API_URL or STAGING_BASE_URL or explicit RETENTION_POLICY_URL/EXPIRED_EXPORT_CLEANUP_URL/ORPHAN_CLEANUP_URL/AUDIT_REFS_URL",
        "optional BASE_URL_RESOLVE_ADDR/STAGING_API_URL_RESOLVE_ADDR/STAGING_BASE_URL_RESOLVE_ADDR and BASE_URL_CA_CERT/STAGING_API_URL_CA_CERT/STAGING_BASE_URL_CA_CERT for production-like local HTTPS fixtures",
        "RELEASE_SHA matching signed URL evidence",
        "ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE",
        "SMOKE_ADMIN_USER_ID",
        "SMOKE_ADMIN_TENANT_ID",
        "CSRF_ORIGIN or STAGING_ADMIN_URL/ADMIN_URL/STAGING_WEB_URL/WEB_URL",
        "CSRF_HEADER_VALUE",
    ],
    "allow_local_devport_evidence_env": "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only evidence under ops/evidence/staging/local-devport/ and cannot clear staging gates",
    "request_id_header": request_id_header,
    "required_checks": sorted(required),
    "probe_routes": probe_routes,
    "success_criteria": [
        "retention_policy, expired_export_cleanup, orphan_cleanup, and audit_refs all return 200 or 202",
        "each response body is non-empty and matches the expected retention/cleanup/audit tokens",
        "each response echoes the per-probe request ID in the configured request-id header",
        "expired-export and orphan cleanup responses include cleanup audit refs",
        "the audit endpoint contains those cleanup audit refs with admin, tenant, cleanup semantics, and the exact cleanup probe request IDs",
        "the generated pass candidate is accepted by scripts/validate_stage1_staging_object_retention_evidence.py before canonical files are replaced",
        "the canonical pass report and NDJSON paths under ops/evidence/staging/ are used",
    ],
}
input_readiness = {
    "probe_urls_ready": probe_urls_ready,
    "production_like_staging_targets": strict_target_ready,
    "canonical_write_requested": write_canonical,
    "preflight_stage1": preflight_mode,
    "auth_ready": auth_ready,
    "admin_user_id_ready": bool(admin_user_id),
    "admin_tenant_id_ready": bool(admin_tenant_id),
    "csrf_ready": csrf_ready,
    "release_sha_provided": bool(release_sha),
    "signed_url_evidence_ready": signed_url_ready,
    "release_sha_matches_signed_url": release_sha_matches_signed_url,
    "canonical_pass_path": canonical_pass_paths,
    "allow_local_devport_evidence": allow_local_devport,
    "use_dev_identity_headers": use_dev_identity_headers,
}
if preflight_mode:
    runtime_input_requirements["blocked_input_reason"] = "preflight_stage1 records input readiness only and cannot run cleanup or clear canonical staging object-retention gate"
elif not probe_urls_ready:
    runtime_input_requirements["blocked_input_reason"] = "missing STAGING_API_URL, STAGING_BASE_URL, or explicit probe URL env vars"
elif not strict_target_ready and not allow_local_devport:
    runtime_input_requirements["blocked_input_reason"] = "real staging https target required; localhost, private IPs, reserved test domains, and local resolve overrides cannot write canonical pass evidence"
elif not auth_ready:
    runtime_input_requirements["blocked_input_reason"] = "missing admin auth; set ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE"
elif not admin_user_id or not admin_tenant_id:
    runtime_input_requirements["blocked_input_reason"] = "missing smoke admin identity; set SMOKE_ADMIN_USER_ID and SMOKE_ADMIN_TENANT_ID"
elif not csrf_ready:
    runtime_input_requirements["blocked_input_reason"] = "missing CSRF origin/header; set CSRF_ORIGIN or STAGING_ADMIN_URL plus CSRF_HEADER_NAME/CSRF_HEADER_VALUE for POST cleanup probes"
elif runtime_checks_passed and not release_sha_matches_signed_url:
    runtime_input_requirements["blocked_input_reason"] = "RELEASE_SHA must match signed URL split evidence release_sha"
elif runtime_checks_passed and allow_local_devport:
    runtime_input_requirements["blocked_input_reason"] = "local-devport debug evidence cannot clear canonical staging object-retention gate"
elif runtime_checks_passed and not write_canonical:
    runtime_input_requirements["blocked_input_reason"] = "canonical pass evidence write was not requested; set WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE=1 only for real staging targets"
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
    "local_devport_debug": allow_local_devport,
    "use_dev_identity_headers": use_dev_identity_headers,
    "validated_by_role": "admin_operator",
    "admin_user_id": admin_user_id,
    "admin_tenant_id": admin_tenant_id,
    "admin_dev_roles": admin_dev_roles,
    "csrf": {
        "origin": csrf_origin,
        "header_name": csrf_header_name,
        "ready": csrf_ready,
    },
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
        "canonical_pass_paths": canonical_pass_paths,
    },
    "audit_linkage": {
        "cleanup_audit_refs_by_probe": cleanup_audit_refs_by_probe,
        "cleanup_audit_refs": sorted(cleanup_audit_refs),
        "audit_endpoint_covers_cleanup_refs": audit_endpoint_covers_cleanup_refs,
        "audit_endpoint_missing_cleanup_refs": audit_endpoint_missing_cleanup_refs,
        "audit_endpoint_semantic_cleanup_refs": sorted(semantic_audit_refs),
        "audit_endpoint_semantic_cleanup_refs_by_probe": semantic_audit_refs_by_probe,
        "audit_endpoint_semantic_missing_cleanup_refs": semantic_missing_cleanup_audit_refs,
        "audit_endpoint_request_id_cleanup_refs_by_probe": request_id_audit_refs_by_probe,
        "audit_endpoint_request_id_missing_cleanup_refs_by_probe": request_id_missing_by_probe,
        "audit_endpoint_request_id_missing_cleanup_refs": request_id_missing_cleanup_audit_refs,
        "audit_endpoint_refs": sorted(audit_endpoint_refs),
        "missing_cleanup_audit_refs": missing_cleanup_audit_refs,
        "verified": audit_linkage_verified,
        "semantic_verified": bool(cleanup_audit_refs) and not semantic_missing_cleanup_audit_refs,
        "request_id_verified": bool(cleanup_audit_refs) and not request_id_missing_cleanup_audit_refs,
    },
    "required_checks": sorted(required),
    "probe_contract": probe_contract,
    "runtime_input_requirements": runtime_input_requirements,
    "input_readiness": input_readiness,
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


def write_json_report(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def replace_coverage_refs(payload, evidence_ref, results_ref):
    for item in payload.get("coverage", []):
        if isinstance(item, dict):
            item["evidence_refs"] = [str(results_ref), str(evidence_ref)]


if all_passed:
    tmp_report_name = None
    tmp_results_name = None
    validation = None
    try:
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=canonical_report_path.parent,
            prefix=".object-storage-retention-cleanup.",
            suffix=".json",
            delete=False,
        ) as tmp_report:
            tmp_report_name = tmp_report.name
            json.dump(report, tmp_report, indent=2, sort_keys=True)
            tmp_report.write("\n")
        with tempfile.NamedTemporaryFile(
            "w",
            encoding="utf-8",
            dir=canonical_results_path.parent,
            prefix=".object-storage-retention-cleanup.",
            suffix=".ndjson",
            delete=False,
        ) as tmp_results:
            tmp_results_name = tmp_results.name
            tmp_results.write(source_results_path.read_text(encoding="utf-8"))
        env = os.environ.copy()
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        validation = subprocess.run(
            [
                sys.executable,
                "scripts/validate_stage1_staging_object_retention_evidence.py",
                "--evidence",
                tmp_report_name,
                "--results",
                tmp_results_name,
            ],
            cwd=".",
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        if validation.returncode == 0:
            os.replace(tmp_results_name, canonical_results_path)
            os.replace(tmp_report_name, canonical_report_path)
            tmp_results_name = None
            tmp_report_name = None
        else:
            all_passed = False
            can_clear_release_gate_check = False
            canonical_pass_paths = False
            blocked_or_failed = blocked_or_failed + ["strict_validator_rejected_candidate"]
            report_path = canonical_report_path.with_name("object-storage-retention-cleanup.blocked.json")
            results_path = canonical_results_path.with_name("object-storage-retention-cleanup.blocked.ndjson")
            results_path.write_text(source_results_path.read_text(encoding="utf-8"), encoding="utf-8")
            report["status"] = "blocked"
            report["results_path"] = str(results_path)
            report["blocked_checks"] = blocked_or_failed
            report["split_evidence"]["retention_cleanup_ready"] = False
            report["split_evidence"]["canonical_pass_paths"] = False
            report["input_readiness"]["canonical_pass_path"] = False
            report["runtime_input_requirements"]["blocked_input_reason"] = (
                "strict validator rejected pass-shaped candidate; canonical pass evidence was not written"
            )
            report["strict_validation"] = {
                "validator": "scripts/validate_stage1_staging_object_retention_evidence.py",
                "accepted_before_canonical_replace": False,
                "return_code": validation.returncode,
                "canonical_outputs_written": False,
            }
            report["gate_impact"]["can_clear_retention_cleanup_checklist_item"] = False
            report["gate_impact"]["can_clear_release_gate_check"] = False
            report["gate_impact"]["remaining_release_gate_blockers_after_pass"] = [
                "staging_object_storage_signed_downloads",
            ]
            report["gate_impact"]["preserved_release_gate_check_id"] = "staging_object_storage_signed_downloads"
            report["gate_impact"]["preserved_do_not_launch_condition_id"] = "object_storage_signed_retention_runtime_missing"
            replace_coverage_refs(report, report_path, results_path)
            write_json_report(report_path, report)
    finally:
        for tmp_name in (tmp_report_name, tmp_results_name):
            if tmp_name:
                Path(tmp_name).unlink(missing_ok=True)
else:
    write_json_report(report_path, report)
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
