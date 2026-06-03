#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN="${DRY_RUN:-0}"
BASE_URL="${BASE_URL:-http://localhost:31080}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-5}"
REQUEST_ID_HEADER="${REQUEST_ID_HEADER:-X-Request-ID}"
REQUEST_ID_VALUE="${REQUEST_ID_VALUE:-stage0-observability-smoke}"
OUT_DIR="${OUT_DIR:-ops/evidence/observability/local}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
EVIDENCE_ENVIRONMENT="${EVIDENCE_ENVIRONMENT:-${ENVIRONMENT:-local}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-observability-smoke-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
HEADERS_PATH="$OUT_DIR/${RUN_ID}.headers"
BODY_PATH="$OUT_DIR/${RUN_ID}.json.body"
METRICS_URL="${METRICS_URL:-http://localhost:${METRICS_PORT:-9090}/metrics}"
METRICS_BODY_PATH="$OUT_DIR/${RUN_ID}.metrics.body"
METRICS_STATUS_PATH="$OUT_DIR/${RUN_ID}.metrics.status"
LOG_QUERY_REF="${LOG_QUERY_REF:-$OUT_DIR/${RUN_ID}.logs.query}"
TRACE_ID_REF="${TRACE_ID_REF:-}"
DASHBOARD_RUNTIME_REF="${DASHBOARD_RUNTIME_REF:-ops/evidence/staging/20260526T1000Z-dashboard-runtime.json}"
ALERT_RUNTIME_REF="${ALERT_RUNTIME_REF:-ops/evidence/staging/20260526T1000Z-alert-runtime.json}"

write_report() {
  local status="$1"
  local http_status="${2:-0}"
  mkdir -p "$OUT_DIR"
  python3 - "$REPORT_PATH" "$status" "$http_status" "$BASE_URL" "$REQUEST_ID_HEADER" "$REQUEST_ID_VALUE" "$HEADERS_PATH" "$BODY_PATH" "$METRICS_URL" "$METRICS_BODY_PATH" "$METRICS_STATUS_PATH" "$RELEASE_SHA" "$EVIDENCE_ENVIRONMENT" "$LOG_QUERY_REF" "$TRACE_ID_REF" "$DASHBOARD_RUNTIME_REF" "$ALERT_RUNTIME_REF" <<'PY'
import json
import re
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
metrics_url = sys.argv[9]
metrics_body_path = Path(sys.argv[10])
metrics_status_path = Path(sys.argv[11])
release_sha = sys.argv[12]
environment = sys.argv[13]
log_query_ref = sys.argv[14]
trace_id_ref = sys.argv[15]
dashboard_runtime_ref = sys.argv[16]
alert_runtime_ref = sys.argv[17]
headers = headers_path.read_text(encoding="utf-8", errors="replace") if headers_path.exists() else ""
body = body_path.read_text(encoding="utf-8", errors="replace") if body_path.exists() else ""
metrics_body = metrics_body_path.read_text(encoding="utf-8", errors="replace") if metrics_body_path.exists() else ""
metrics_http_status = 0
if metrics_status_path.exists():
    raw_metrics_status = metrics_status_path.read_text(encoding="utf-8", errors="replace").strip()
    metrics_http_status = int(raw_metrics_status) if raw_metrics_status.isdigit() else 0
header_echo = request_id_value in headers
body_echo = request_id_value in body
json_body = False
try:
    parsed = json.loads(body) if body else None
    json_body = isinstance(parsed, dict)
except json.JSONDecodeError:
    parsed = None
root = Path(".")
runtime_go = root.joinpath("backend/internal/app/runtime.go").read_text(encoding="utf-8", errors="replace")
server_go = root.joinpath("backend/internal/server/server.go").read_text(encoding="utf-8", errors="replace")
middleware_go = root.joinpath("backend/internal/server/middleware.go").read_text(encoding="utf-8", errors="replace")
backend_metrics_go = root.joinpath("backend/internal/server/metrics.go").read_text(encoding="utf-8", errors="replace")
worker_metrics_go = root.joinpath("backend/internal/worker/metrics.go").read_text(encoding="utf-8", errors="replace")
crawler_metrics_go = root.joinpath("backend/internal/crawler/metrics.go").read_text(encoding="utf-8", errors="replace")
env_example = root.joinpath(".env.example").read_text(encoding="utf-8", errors="replace")
compose = root.joinpath("docker-compose.yml").read_text(encoding="utf-8", errors="replace")
dashboard = json.loads(root.joinpath("ops/observability/dashboards/stage0_rev2_overview.json").read_text(encoding="utf-8"))
alerts = json.loads(root.joinpath("ops/observability/alerts/stage0_rev2_alerts.json").read_text(encoding="utf-8"))
recovery_log_call = re.search(r'logger\.Error\("request panic"(?P<args>[^)]*)\)', server_go, flags=re.DOTALL)
recovery_log_includes_request_id = bool(recovery_log_call and '"request_id"' in recovery_log_call.group("args"))
otel_import_detected = "go.opentelemetry.io/otel" in "\n".join(
    path.read_text(encoding="utf-8", errors="replace")
    for path in root.joinpath("backend").rglob("*.go")
)
metrics_runtime_passed = metrics_http_status == 200 and (
    "backend_http_request_duration" in metrics_body
    or "backend_http_requests_total" in metrics_body
    or "go_gc_duration_seconds" in metrics_body
    or "# HELP" in metrics_body
)
backend_metrics_runtime_passed = metrics_http_status == 200 and all(fragment in metrics_body for fragment in [
    "backend_http_requests_total",
    "backend_http_request_duration_ms_total",
    "backend_http_requests_by_status_total",
    "backend_http_requests_by_route_total",
])
backend_metrics_definition_validated = all(fragment in backend_metrics_go for fragment in [
    "backend_http_requests_total",
    "backend_http_request_duration_ms_total",
    "backend_http_requests_by_status_total",
    "backend_http_requests_by_route_total",
])
worker_metrics_definition_validated = all(fragment in worker_metrics_go for fragment in [
    "worker_task_claims_total",
    "worker_task_claim_errors_total",
    "worker_task_claim_duration_ms_total",
    "worker_unsupported_task_claims_total",
    "worker_drain_operations_total",
    "worker_task_claims_by_type_total",
])
crawler_metrics_definition_validated = all(fragment in crawler_metrics_go for fragment in [
    "crawler_readiness_checks_total",
    "crawler_readiness_failures_total",
    "crawler_process_uptime_seconds",
])
metrics_contract_validated = (
    backend_metrics_runtime_passed
    and backend_metrics_definition_validated
    and worker_metrics_definition_validated
    and crawler_metrics_definition_validated
)
request_id_contract_validated = header_echo and body_echo and json_body
dashboard_definition_validated = dashboard.get("status") == "definition_ready_runtime_evidence_open" and len(dashboard.get("panels", [])) >= 13
alert_definition_validated = alerts.get("status") == "definition_ready_runtime_evidence_open" and len(alerts.get("alerts", [])) >= 11
local_runtime_status = "request_id_contract_passed_runtime_gates_open" if request_id_contract_validated else status
structured_logs_validated = all(fragment in middleware_go for fragment in [
    '"http request"',
    '"request_id"',
    '"user_id"',
    '"tenant_id"',
    '"route"',
    '"status"',
    '"latency_ms"',
]) and "slog.NewJSONHandler" in runtime_go and recovery_log_includes_request_id
traces_validated = bool(otel_import_detected and trace_id_ref)
dashboard_runtime_validated = dashboard_definition_validated and Path(dashboard_runtime_ref).exists()
alert_runtime_validated = alert_definition_validated and Path(alert_runtime_ref).exists()
signals = [
    {
        "signal_id": "request_id_propagation",
        "status": "passed" if request_id_contract_validated else "open",
        "evidence_refs": [str(headers_path), str(body_path)],
    },
    {
        "signal_id": "structured_json_logs",
        "status": "passed" if structured_logs_validated else "open",
        "evidence_refs": [log_query_ref, "backend/internal/server/middleware.go", "backend/internal/app/runtime.go"],
    },
    {
        "signal_id": "opentelemetry_traces",
        "status": "passed" if traces_validated else "open",
        "evidence_refs": [trace_id_ref or "missing_trace_id_ref"],
    },
    {
        "signal_id": "backend_worker_crawler_metrics",
        "status": "passed" if metrics_contract_validated else "open",
        "evidence_refs": [
            str(metrics_body_path),
            str(metrics_status_path),
            "backend/internal/server/metrics.go",
            "backend/internal/worker/metrics.go",
            "backend/internal/crawler/metrics.go",
        ],
    },
    {
        "signal_id": "dashboard_import",
        "status": "passed" if dashboard_runtime_validated else "open",
        "evidence_refs": [dashboard_runtime_ref, "ops/observability/dashboards/stage0_rev2_overview.json"],
    },
    {
        "signal_id": "alert_routes",
        "status": "passed" if alert_runtime_validated else "open",
        "evidence_refs": [alert_runtime_ref, "ops/observability/alerts/stage0_rev2_alerts.json"],
    },
]
report_status = "passed" if status == "passed" and all(signal["status"] == "passed" for signal in signals) else local_runtime_status
report_path.write_text(json.dumps({
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "created_by_lane": "lane5",
    "created_at": report_path.name.split("-observability-smoke-")[0],
    "run_id": report_path.stem,
    "kind": "observability",
    "environment": environment,
    "release_sha": release_sha,
    "status": report_status,
    "base_url": base_url,
    "http_status": http_status,
    "request_id_header": request_id_header,
    "request_id_value": request_id_value,
    "headers_path": str(headers_path),
    "body_path": str(body_path),
    "metrics_url": metrics_url,
    "metrics_http_status": metrics_http_status,
    "metrics_body_path": str(metrics_body_path),
    "log_query_ref": log_query_ref,
    "trace_id_ref": trace_id_ref,
    "dashboard_runtime_ref": dashboard_runtime_ref,
    "alert_runtime_ref": alert_runtime_ref,
    "checks": {
        "request_id_response_header_echo": header_echo,
        "request_id_json_body_echo": body_echo,
        "json_response_body": json_body,
        "structured_log_json_handler_declared": "slog.NewJSONHandler" in runtime_go,
        "access_log_request_context_declared": all(fragment in middleware_go for fragment in [
            '"http request"',
            '"request_id"',
            '"user_id"',
            '"tenant_id"',
            '"route"',
            '"status"',
            '"latency_ms"',
        ]),
        "compose_log_format_json_declared": "LOG_FORMAT: ${LOG_FORMAT:-json}" in compose,
        "recover_log_includes_request_id": recovery_log_includes_request_id,
        "metrics_config_declared": "METRICS_ENABLED=true" in env_example and "METRICS_PORT=9090" in env_example,
        "metrics_runtime_endpoint_passed": metrics_runtime_passed,
        "backend_metrics_runtime_endpoint_passed": backend_metrics_runtime_passed,
        "backend_metrics_definition_validated": backend_metrics_definition_validated,
        "worker_metrics_definition_validated": worker_metrics_definition_validated,
        "crawler_metrics_definition_validated": crawler_metrics_definition_validated,
        "backend_worker_crawler_metrics_contract_validated": metrics_contract_validated,
        "otel_config_declared": "OTEL_EXPORTER_OTLP_ENDPOINT" in env_example,
        "otel_runtime_instrumentation_detected": otel_import_detected,
        "dashboard_definition_validated": dashboard_definition_validated,
        "alert_definition_validated": alert_definition_validated,
    },
    "signals": signals,
    "signal_statuses": {
        "request_id_propagation": "contract_validated" if request_id_contract_validated else "open",
        "structured_json_logs": "passed" if structured_logs_validated else "definition_validated_recovery_log_request_id_open",
        "opentelemetry_traces": "passed" if traces_validated else ("instrumentation_detected_runtime_export_open" if otel_import_detected else "open"),
        "backend_worker_crawler_metrics": "open" if not metrics_contract_validated else "backend_runtime_worker_crawler_definitions_validated_staging_capture_open",
        "dashboards": "passed" if dashboard_runtime_validated else ("definition_validated_runtime_import_open" if dashboard_definition_validated else "open"),
        "alerts": "passed" if alert_runtime_validated else ("definition_validated_runtime_route_evaluation_open" if alert_definition_validated else "open"),
    },
    "open_items": [
        "staging_log_capture_with_request_id_user_id_tenant_id_route_status_latency",
        "opentelemetry_backend_worker_crawler_span_export",
        "staging_backend_worker_crawler_metrics_capture_with_release_sha_and_bounded_labels",
        "staging_dashboard_import_with_release_sha_labels",
        "staging_alert_route_notifications_and_threshold_evaluations"
    ],
    "private_beta_gate": "open_until_staging_logs_metrics_traces_dashboards_alerts_have_runtime_evidence",
    "production_gate": "open_until_observability_evidence_is_attached_to_release_go_no_go",
}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
}

if [[ "$DRY_RUN" == "1" ]]; then
  rm -f "$HEADERS_PATH" "$BODY_PATH" "$METRICS_BODY_PATH" "$METRICS_STATUS_PATH"
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
curl -sS -m "$TIMEOUT_SECONDS" -o "$METRICS_BODY_PATH" -w '%{http_code}' "$METRICS_URL" >"$METRICS_STATUS_PATH" 2>/dev/null || printf '000' >"$METRICS_STATUS_PATH"
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
