#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN="${DRY_RUN:-0}"
BASE_URL="${BASE_URL:-http://localhost:8080}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-5}"
REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}"
REQUEST_ID_VALUE="${REQUEST_ID_VALUE:-stage0-observability-smoke}"
OUT_DIR="${OUT_DIR:-ops/evidence/observability/local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-observability-smoke-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
HEADERS_PATH="$OUT_DIR/${RUN_ID}.headers"
BODY_PATH="$OUT_DIR/${RUN_ID}.json.body"

write_report() {
  local status="$1"
  local http_status="${2:-0}"
  mkdir -p "$OUT_DIR"
  python3 - "$REPORT_PATH" "$status" "$http_status" "$BASE_URL" "$REQUEST_ID_HEADER" "$REQUEST_ID_VALUE" "$HEADERS_PATH" "$BODY_PATH" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
status = sys.argv[2]
http_status = int(sys.argv[3])
base_url = sys.argv[4]
request_id_header = sys.argv[5]
request_id_value = sys.argv[6]
headers_path = Path(sys.argv[7])
body_path = Path(sys.argv[8])
headers = headers_path.read_text(encoding="utf-8", errors="replace") if headers_path.exists() else ""
body = body_path.read_text(encoding="utf-8", errors="replace") if body_path.exists() else ""
header_echo = request_id_value in headers
body_echo = request_id_value in body
json_body = False
try:
    parsed = json.loads(body) if body else {}
    json_body = isinstance(parsed, dict)
except json.JSONDecodeError:
    parsed = {}
report_path.write_text(json.dumps({
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "created_by_lane": "lane5",
    "created_at": report_path.name.split("-observability-smoke-")[0],
    "run_id": report_path.stem,
    "status": status,
    "base_url": base_url,
    "http_status": http_status,
    "request_id_header": request_id_header,
    "request_id_value": request_id_value,
    "headers_path": str(headers_path),
    "body_path": str(body_path),
    "checks": {
        "request_id_response_header_echo": header_echo,
        "request_id_json_body_echo": body_echo,
        "json_response_body": json_body,
        "structured_log_contract_defined": "slog.NewJSONHandler" in Path("backend/internal/app/runtime.go").read_text(encoding="utf-8"),
        "recover_log_includes_request_id": '"request_id"' in Path("backend/internal/server/server.go").read_text(encoding="utf-8"),
        "metrics_config_declared": "METRICS_ENABLED=true" in Path(".env.example").read_text(encoding="utf-8"),
        "otel_config_declared": "OTEL_EXPORTER_OTLP_ENDPOINT" in Path(".env.example").read_text(encoding="utf-8"),
    },
    "private_beta_gate": "open_until_staging_logs_metrics_traces_dashboards_alerts_have_runtime_evidence",
    "production_gate": "open_until_observability_evidence_is_attached_to_release_go_no_go",
}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

if [[ "$DRY_RUN" == "1" ]]; then
  rm -f "$HEADERS_PATH" "$BODY_PATH"
  write_report "planned" 0
  printf 'observability smoke dry-run planned for %s\n' "$BASE_URL"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  printf 'curl is required for observability smoke\n' >&2
  write_report "blocked_missing_curl" 127
  exit 127
fi

mkdir -p "$OUT_DIR"
http_status="$(curl -sS -m "$TIMEOUT_SECONDS" -D "$HEADERS_PATH" -o "$BODY_PATH" -w '%{http_code}' -H "$REQUEST_ID_HEADER: $REQUEST_ID_VALUE" "$BASE_URL/healthz" || printf '000')"
if [[ "$http_status" != "200" ]]; then
  write_report "failed" "$http_status"
  printf 'observability smoke failed with HTTP %s\n' "$http_status" >&2
  exit 1
fi
if ! grep -q "$REQUEST_ID_VALUE" "$HEADERS_PATH" || ! grep -q "$REQUEST_ID_VALUE" "$BODY_PATH"; then
  write_report "failed" "$http_status"
  printf 'observability smoke failed: request id was not echoed in response header and body\n' >&2
  exit 1
fi
write_report "passed" "$http_status"
printf 'observability smoke passed; evidence written to %s\n' "$REPORT_PATH"
