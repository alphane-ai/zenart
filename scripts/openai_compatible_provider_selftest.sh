#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PRESET_LLM_PROVIDER="${LLM_PROVIDER-}"
PRESET_LLM_OPENAI_BASE_URL="${LLM_OPENAI_BASE_URL-}"
PRESET_LLM_OPENAI_API_KEY="${LLM_OPENAI_API_KEY-}"
PRESET_LLM_OPENAI_RESOLVE_ADDR="${LLM_OPENAI_RESOLVE_ADDR-}"
PRESET_LLM_OPENAI_CA_CERT="${LLM_OPENAI_CA_CERT-}"
PRESET_ZAI_API_KEY="${ZAI_API_KEY-}"
PRESET_OPENAI_API_KEY="${OPENAI_API_KEY-}"
PRESET_LLM_OPENAI_MODEL="${LLM_OPENAI_MODEL-}"
PRESET_LLM_ENABLE_LIVE_CALLS="${LLM_ENABLE_LIVE_CALLS-}"
PRESET_TIMEOUT_SECONDS="${TIMEOUT_SECONDS-}"
PRESET_SELFTEST_RETRY_COUNT="${SELFTEST_RETRY_COUNT-}"
PRESET_SELFTEST_RETRY_DELAY_SECONDS="${SELFTEST_RETRY_DELAY_SECONDS-}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if [[ -n "$PRESET_LLM_PROVIDER" ]]; then
  LLM_PROVIDER="$PRESET_LLM_PROVIDER"
fi
if [[ -n "$PRESET_LLM_OPENAI_BASE_URL" ]]; then
  LLM_OPENAI_BASE_URL="$PRESET_LLM_OPENAI_BASE_URL"
fi
if [[ -n "$PRESET_LLM_OPENAI_API_KEY" ]]; then
  LLM_OPENAI_API_KEY="$PRESET_LLM_OPENAI_API_KEY"
fi
if [[ -n "$PRESET_LLM_OPENAI_RESOLVE_ADDR" ]]; then
  LLM_OPENAI_RESOLVE_ADDR="$PRESET_LLM_OPENAI_RESOLVE_ADDR"
fi
if [[ -n "$PRESET_LLM_OPENAI_CA_CERT" ]]; then
  LLM_OPENAI_CA_CERT="$PRESET_LLM_OPENAI_CA_CERT"
fi
if [[ -n "$PRESET_ZAI_API_KEY" ]]; then
  ZAI_API_KEY="$PRESET_ZAI_API_KEY"
fi
if [[ -n "$PRESET_OPENAI_API_KEY" ]]; then
  OPENAI_API_KEY="$PRESET_OPENAI_API_KEY"
fi
if [[ -n "$PRESET_LLM_OPENAI_MODEL" ]]; then
  LLM_OPENAI_MODEL="$PRESET_LLM_OPENAI_MODEL"
fi
if [[ -n "$PRESET_LLM_ENABLE_LIVE_CALLS" ]]; then
  LLM_ENABLE_LIVE_CALLS="$PRESET_LLM_ENABLE_LIVE_CALLS"
fi
if [[ -n "$PRESET_TIMEOUT_SECONDS" ]]; then
  TIMEOUT_SECONDS="$PRESET_TIMEOUT_SECONDS"
fi
if [[ -n "$PRESET_SELFTEST_RETRY_COUNT" ]]; then
  SELFTEST_RETRY_COUNT="$PRESET_SELFTEST_RETRY_COUNT"
fi
if [[ -n "$PRESET_SELFTEST_RETRY_DELAY_SECONDS" ]]; then
  SELFTEST_RETRY_DELAY_SECONDS="$PRESET_SELFTEST_RETRY_DELAY_SECONDS"
fi

fail() {
  printf 'openai-compatible provider selftest failed: %s\n' "$*" >&2
  exit 1
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

usage() {
  cat <<'EOF'
usage: scripts/openai_compatible_provider_selftest.sh [--contract-only]
       scripts/openai_compatible_provider_selftest.sh [--output <safe-evidence.json>]

Runs the OpenAI-compatible provider connectivity selftest when live LLM env is enabled.
Use --contract-only to validate URL normalization, endpoint construction, and unsafe URL
rejection without making network calls or requiring a provider key.
EOF
}

CONTRACT_ONLY=false
OUTPUT_PATH=""
while [[ "$#" -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    --contract-only)
      CONTRACT_ONLY=true
      shift
      ;;
    --output)
      [[ "$#" -ge 2 ]] || fail "--output requires a path"
      OUTPUT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $arg"
      ;;
  esac
done

if [[ "$CONTRACT_ONLY" != "true" ]]; then
  has_cmd curl || fail "curl is not installed"
fi

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
LLM_OPENAI_MODEL="${LLM_OPENAI_MODEL:-glm-5.2}"
LLM_ENABLE_LIVE_CALLS="${LLM_ENABLE_LIVE_CALLS:-false}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-20}"
SELFTEST_RETRY_COUNT="${SELFTEST_RETRY_COUNT:-3}"
SELFTEST_RETRY_DELAY_SECONDS="${SELFTEST_RETRY_DELAY_SECONDS:-2}"

is_placeholder() {
  case "$1" in
    ""|replace_me|*_replace_me|*replace_me*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

endpoint_url() {
  local raw="$1"
  local endpoint="$2"
  local default_v1="$3"
  python3 - "$raw" "$endpoint" "$default_v1" <<'PY'
import sys
from urllib.parse import urlparse, urlunparse

raw, endpoint, default_v1_raw = sys.argv[1:]
raw = raw.strip()
endpoint = endpoint.strip("/")
default_v1 = default_v1_raw == "true"
parsed = urlparse(raw)
if parsed.scheme not in {"http", "https"} or not parsed.netloc:
    raise SystemExit("LLM_OPENAI_BASE_URL must be an absolute HTTP URL")
if parsed.username or parsed.password:
    raise SystemExit("LLM_OPENAI_BASE_URL must not include credentials")
if parsed.query or parsed.fragment:
    raise SystemExit("LLM_OPENAI_BASE_URL must not include query or fragment")
path = parsed.path.rstrip("/")
if not path or path == "/":
    if default_v1:
        path = "/v1/" + endpoint
    else:
        path = "/" + endpoint
elif not path.endswith("/" + endpoint):
    path = path + "/" + endpoint
print(urlunparse((parsed.scheme, parsed.netloc, path, "", "", "")))
PY
}

models_url() {
  endpoint_url "$LLM_OPENAI_BASE_URL" "models" "false"
}

chat_completions_url() {
  endpoint_url "$LLM_OPENAI_BASE_URL" "chat/completions" "true"
}

assert_endpoint_url() {
  local raw="$1"
  local endpoint="$2"
  local default_v1="$3"
  local want="$4"
  local got
  got="$(endpoint_url "$raw" "$endpoint" "$default_v1")"
  if [[ "$got" != "$want" ]]; then
    fail "endpoint URL contract mismatch for $raw $endpoint: got $got, want $want"
  fi
}

assert_endpoint_url_rejected() {
  local raw="$1"
  local endpoint="$2"
  local default_v1="$3"
  local want_fragment="$4"
  local got
  if got="$(endpoint_url "$raw" "$endpoint" "$default_v1" 2>&1)"; then
    fail "endpoint URL contract accepted unsafe base URL: $raw"
  fi
  if [[ "$got" != *"$want_fragment"* ]]; then
    fail "endpoint URL rejection mismatch for $raw: got $got, want fragment $want_fragment"
  fi
}

summarize_provider_error_body() {
  python3 - "$@" <<'PY'
import json
import re
import sys
from pathlib import Path

status, body_path = sys.argv[1:]
text = Path(body_path).read_text(encoding="utf-8", errors="replace") if body_path else ""
secret_re = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
text = secret_re.sub("[redacted]", text)
code = ""
message = ""
try:
    payload = json.loads(text)
except json.JSONDecodeError:
    payload = None
if isinstance(payload, dict):
    err = payload.get("error")
    if isinstance(err, dict):
        code = str(err.get("code") or err.get("type") or "").strip()
        message = str(err.get("message") or "").strip().lower()
category = "provider_http_error"
if status in {"000", "408"}:
    category = "provider_retryable_http_error"
elif status in {"402"} or code == "1113" or "insufficient balance" in message or "no resource package" in message:
    category = "provider_quota_unavailable"
elif status in {"409", "425", "429"} or status.startswith("5"):
    category = "provider_retryable_http_error"
safe_provider_codes = {"1113", "rate_limit_exceeded", "invalid_api_key"}
if code and code not in safe_provider_codes:
    code = "[redacted]"
parts = [f"http_status={status}", f"error={category}"]
if code:
    parts.append(f"provider_code={code}")
print(" ".join(parts))
PY
}

assert_provider_error_summary() {
  local status="$1"
  local body="$2"
  local want="$3"
  local body_file
  local got
  body_file="$(mktemp)"
  printf '%s' "$body" >"$body_file"
  got="$(summarize_provider_error_body "$status" "$body_file")"
  rm -f "$body_file"
  if [[ "$got" != "$want" ]]; then
    fail "provider error summary mismatch: got $got, want $want"
  fi
  if [[ "$got" == *"Bearer"* || "$got" == *"Authorization"* || "$got" =~ [0-9a-f]{32}\.[A-Za-z0-9_-]{16,} ]]; then
    fail "provider error summary leaked secret-bearing material"
  fi
}

run_contract_tests() {
  assert_endpoint_url "https://api.z.ai/api/coding/paas/v4" "chat/completions" "true" "https://api.z.ai/api/coding/paas/v4/chat/completions"
  assert_endpoint_url "https://api.openai.example.test/v1" "chat/completions" "true" "https://api.openai.example.test/v1/chat/completions"
  assert_endpoint_url "https://api.openai.example.test/chat/completions" "chat/completions" "true" "https://api.openai.example.test/chat/completions"
  assert_endpoint_url "https://api.openai.example.test/" "chat/completions" "true" "https://api.openai.example.test/v1/chat/completions"
  assert_endpoint_url "https://api.z.ai/api/coding/paas/v4" "models" "false" "https://api.z.ai/api/coding/paas/v4/models"
  assert_endpoint_url "https://api.openai.example.test/v1" "models" "false" "https://api.openai.example.test/v1/models"
  assert_endpoint_url "https://api.openai.example.test/" "models" "false" "https://api.openai.example.test/models"
  assert_endpoint_url_rejected "https://key:secret@api.z.ai/api/coding/paas/v4" "models" "false" "must not include credentials"
  assert_endpoint_url_rejected "https://api.z.ai/api/coding/paas/v4?token=debug" "models" "false" "must not include query or fragment"
  assert_endpoint_url_rejected "ftp://api.z.ai/api/coding/paas/v4" "models" "false" "must be an absolute HTTP URL"
  assert_provider_error_summary "429" '{"error":{"code":"1113","message":"Insufficient balance or no resource package. Authorization header redacted by contract."}}' "http_status=429 error=provider_quota_unavailable provider_code=1113"
  assert_provider_error_summary "429" '{"error":{"type":"rate_limit_exceeded","message":"try later"}}' "http_status=429 error=provider_retryable_http_error provider_code=rate_limit_exceeded"
  assert_provider_error_summary "000" '' "http_status=000 error=provider_retryable_http_error"
  assert_provider_error_summary "401" '{"error":{"type":"invalid_api_key","message":"Authorization failed"}}' "http_status=401 error=provider_http_error provider_code=invalid_api_key"
  assert_provider_error_summary "401" '{"error":{"code":"provider-error-code-that-must-be-redacted-because-it-is-long","message":"Authorization failed"}}' "http_status=401 error=provider_http_error provider_code=[redacted]"
  printf 'openai-compatible provider selftest contract passed\n'
}

if [[ "$CONTRACT_ONLY" == "true" ]]; then
  run_contract_tests
  exit 0
fi

provider_network_args() {
  local target_url="$1"
  local resolve_host=""
  local resolve_port=""
  PROVIDER_NETWORK_ARGS=()
  if [[ -n "$target_url" && -n "$LLM_OPENAI_RESOLVE_ADDR" ]]; then
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
      PROVIDER_NETWORK_ARGS+=(--resolve "$resolve_host:$resolve_port:$LLM_OPENAI_RESOLVE_ADDR" --noproxy "$resolve_host")
    fi
  fi
  if [[ -n "$LLM_OPENAI_CA_CERT" ]]; then
    PROVIDER_NETWORK_ARGS+=(--cacert "$LLM_OPENAI_CA_CERT")
  fi
}

redact_file() {
  python3 - "$@" <<'PY'
import re
import sys
from pathlib import Path

secret_re = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
for path in sys.argv[1:]:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        cleaned = secret_re.sub("[redacted]", line)
        if cleaned.strip():
            print(cleaned)
PY
}

summarize_provider_error() {
  summarize_provider_error_body "$@"
}

is_retryable_provider_result() {
  local status="$1"
  local body_file="$2"
  local summary
  if [[ "$status" == "000" || -z "$status" ]]; then
    return 0
  fi
  summary="$(summarize_provider_error "$status" "$body_file")"
  [[ "$summary" == *"error=provider_retryable_http_error"* ]]
}

curl_with_retries() {
  local label="$1"
  local response_body="$2"
  local stderr_file="$3"
  shift 3
  local attempt=1
  local http_status=""
  local max_attempts="$SELFTEST_RETRY_COUNT"
  if ! [[ "$max_attempts" =~ ^[0-9]+$ ]] || (( max_attempts < 1 )); then
    max_attempts=1
  fi
  while (( attempt <= max_attempts )); do
    : >"$response_body"
    : >"$stderr_file"
    http_status="$(curl "$@" 2>"$stderr_file" || true)"
    if [[ "$http_status" == "200" || "$http_status" == "201" || "$http_status" == "202" ]]; then
      printf '%s' "$http_status"
      return 0
    fi
    if (( attempt >= max_attempts )) || ! is_retryable_provider_result "$http_status" "$response_body"; then
      printf '%s' "$http_status"
      return 0
    fi
    printf 'openai-compatible provider selftest retry: %s attempt=%s http_status=%s\n' "$label" "$attempt" "${http_status:-000}" >&2
    sleep "$SELFTEST_RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done
  printf '%s' "$http_status"
}

[[ "$LLM_PROVIDER" == "openai-compatible" ]] || fail "LLM_PROVIDER must be openai-compatible"
[[ "$LLM_ENABLE_LIVE_CALLS" == "true" ]] || fail "LLM_ENABLE_LIVE_CALLS must be true for provider selftest"
if is_placeholder "$LLM_OPENAI_API_KEY"; then
  fail "LLM_OPENAI_API_KEY, ZAI_API_KEY, or OPENAI_API_KEY must be a non-placeholder live test key"
fi
if is_placeholder "$LLM_OPENAI_MODEL"; then
  fail "LLM_OPENAI_MODEL must be a non-placeholder model id"
fi

url="$(models_url)"
body="$(mktemp)"
chat_body="$(mktemp)"
chat_payload="$(mktemp)"
headers="$(mktemp)"
curl_err="$(mktemp)"
cleanup() {
  rm -f "$curl_err" "$headers" "$body" "$chat_body" "$chat_payload"
}
trap cleanup EXIT
models_curl_args=(
    --silent \
    --show-error \
    --location \
    --max-time "$TIMEOUT_SECONDS" \
    --request GET \
    --header "Accept: application/json" \
    --header "Authorization: Bearer $LLM_OPENAI_API_KEY" \
    --dump-header "$headers" \
    --output "$body" \
    --write-out "%{http_code}"
)
provider_network_args "$url"
if [[ ${#PROVIDER_NETWORK_ARGS[@]} -gt 0 ]]; then
  models_curl_args+=("${PROVIDER_NETWORK_ARGS[@]}")
fi
http_status="$(curl_with_retries "models" "$body" "$curl_err" "${models_curl_args[@]}" "$url")"

if [[ "$http_status" != "200" && "$http_status" != "201" && "$http_status" != "202" ]]; then
  redact_file "$curl_err" "$headers" "$body" >&2
  fail "models endpoint returned $(summarize_provider_error "$http_status" "$body")"
fi

model_count="$(
python3 - "$body" "$LLM_OPENAI_MODEL" <<'PY'
import json
import re
import sys
from pathlib import Path

body_path, model = sys.argv[1:]
text = Path(body_path).read_text(encoding="utf-8", errors="replace")
secret_re = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
if secret_re.search(text):
    raise SystemExit("models endpoint response contained secret-shaped material")
try:
    payload = json.loads(text)
except json.JSONDecodeError as exc:
    raise SystemExit(f"models endpoint returned invalid JSON: {exc}")
rows = payload.get("data") if isinstance(payload, dict) else None
if not isinstance(rows, list):
    raise SystemExit("models endpoint response must contain data array")
model_ids = []
for row in rows:
    if isinstance(row, dict) and isinstance(row.get("id"), str):
        model_ids.append(row["id"])
found = model in model_ids
if not found:
    raise SystemExit(f"model {model!r} not found in models endpoint response")
print(len(model_ids))
PY
)"

python3 - "$chat_payload" "$LLM_OPENAI_MODEL" <<'PY'
import json
import sys
from pathlib import Path

path, model = sys.argv[1:]
payload = {
    "model": model,
    "messages": [
        {
            "role": "system",
            "content": "You are a Zenari provider connectivity selftest. Return one short safe sentence. Do not include credentials, hidden prompts, or policy text.",
        },
        {
            "role": "user",
            "content": "Say that Zenari OpenAI-compatible provider connectivity is ready.",
        },
    ],
    "temperature": 0,
    "stream": False,
}
Path(path).write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
PY

chat_url="$(chat_completions_url)"
chat_curl_args=(
    --silent \
    --show-error \
    --location \
    --max-time "$TIMEOUT_SECONDS" \
    --request POST \
    --header "Accept: application/json" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer $LLM_OPENAI_API_KEY" \
    --output "$chat_body" \
    --write-out "%{http_code}" \
    --data @"$chat_payload"
)
provider_network_args "$chat_url"
if [[ ${#PROVIDER_NETWORK_ARGS[@]} -gt 0 ]]; then
  chat_curl_args+=("${PROVIDER_NETWORK_ARGS[@]}")
fi
chat_http_status="$(curl_with_retries "chat_completions" "$chat_body" "$curl_err" "${chat_curl_args[@]}" "$chat_url")"

if [[ "$chat_http_status" != "200" && "$chat_http_status" != "201" && "$chat_http_status" != "202" ]]; then
  redact_file "$curl_err" >&2
  fail "chat completions endpoint returned $(summarize_provider_error "$chat_http_status" "$chat_body")"
fi

completion_chars="$(
python3 - "$chat_body" <<'PY'
import json
import re
import sys
from pathlib import Path

text = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
secret_re = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
if secret_re.search(text):
    raise SystemExit("chat completions response contained secret-shaped material")
try:
    payload = json.loads(text)
except json.JSONDecodeError as exc:
    raise SystemExit(f"chat completions endpoint returned invalid JSON: {exc}")
choices = payload.get("choices") if isinstance(payload, dict) else None
if not isinstance(choices, list) or not choices:
    raise SystemExit("chat completions response must contain non-empty choices array")
message = choices[0].get("message") if isinstance(choices[0], dict) else None
content = message.get("content") if isinstance(message, dict) else None
if not isinstance(content, str) or not content.strip():
    raise SystemExit("chat completions response missing message content")
print(len(content.strip()))
PY
)"

python3 - "$LLM_OPENAI_BASE_URL" "$LLM_OPENAI_MODEL" "$model_count" "$completion_chars" "$OUTPUT_PATH" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

base_url, model, model_count, completion_chars, output_path = sys.argv[1:]
host = urlparse(base_url).netloc
evidence = {
    "schema_version": "stage1.openai_compatible_provider_selftest.v1",
    "kind": "openai_compatible_provider_selftest",
    "status": "passed",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "provider": "openai-compatible",
    "host": host,
    "model": model,
    "models_seen": int(model_count),
    "chat_completion_chars": int(completion_chars),
    "secret_material_persisted": False,
    "authorization_header_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_prompt_persisted": False,
    "completion_text_persisted": False,
    "can_clear_stage1_production_launch_gate": False,
    "can_close_do_not_launch": False,
}
if output_path:
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
print(
    "openai-compatible provider selftest passed: "
    f"host={host} model={model} models_seen={model_count} chat_completion_chars={completion_chars}"
)
PY
