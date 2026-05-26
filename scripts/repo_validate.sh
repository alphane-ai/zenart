#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() {
  printf '\n==> %s\n' "$*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_node_project_checks() {
  local dir="$1"
  if [[ ! -d "$dir" ]]; then
    printf 'skip: %s is not present yet\n' "$dir"
    return 0
  fi
  if [[ ! -f "$dir/package.json" ]]; then
    printf 'skip: %s/package.json is not present yet\n' "$dir"
    return 0
  fi

  local runner="npm"
  local install="npm ci"
  if [[ -f "$dir/pnpm-lock.yaml" ]] && has_cmd pnpm; then
    runner="pnpm"
    install="pnpm install --frozen-lockfile"
  elif [[ -f "$dir/yarn.lock" ]] && has_cmd yarn; then
    runner="yarn"
    install="yarn install --frozen-lockfile"
  fi

  (cd "$dir" && eval "$install")
  for script in lint typecheck test build; do
    if (cd "$dir" && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$script'] ? 0 : 1)"); then
      (cd "$dir" && "$runner" run "$script")
    else
      printf 'skip: %s has no npm script %s\n' "$dir" "$script"
    fi
  done
}

log "repo scaffolding files"
test -f .env.example
test -f .dockerignore
test -f docker-compose.yml
test -f ops/ci/stage0-rev2-ci.yml
test -f ops/ci/INSTALLATION.md
test -f ops/evidence/stage0_environment_evidence.json
test -f ops/evidence/stage0_drill_plan.json
test -f ops/evidence/stage0_release_ops_evidence.json
test -f ops/observability/dashboards/stage0_rev2_overview.json
test -f ops/observability/alerts/stage0_rev2_alerts.json
test -f ops/ci/playwright-smoke.spec.ts
test -f ops/release/staging_deploy.md
test -f ops/release/release_notes_template.md
test -f ops/release/stage0_rev2_current_no_go_release_notes.md
test -x scripts/load_smoke.sh
test -x scripts/backup_restore_drill.sh
test -x scripts/playwright_smoke.sh
test -x scripts/docker_build_smoke.sh
test -x scripts/staging_smoke.sh
test -x scripts/observability_smoke.sh
test -x scripts/security_scan_smoke.sh
test -x scripts/render_no_go_release_notes.py

log "docker compose syntax"
if docker compose version >/dev/null 2>&1; then
  docker compose --env-file .env.example config --quiet
else
  printf 'skip: docker compose is not installed\n'
fi

log "yaml syntax"
if has_cmd ruby; then
  ruby -e "require 'yaml'; YAML.load_file('docker-compose.yml'); YAML.load_file('ops/ci/stage0-rev2-ci.yml')"
elif has_cmd python3; then
  python3 - <<'PY'
from pathlib import Path
for path in ("docker-compose.yml", "ops/ci/stage0-rev2-ci.yml"):
    text = Path(path).read_text(encoding="utf-8")
    if "\t" in text:
        raise SystemExit(f"{path}: tabs are not allowed in YAML indentation")
PY
else
  printf 'skip: no ruby or python3 available for YAML smoke check\n'
fi

log "observability definition validation"
python3 - <<'PY'
import json
from pathlib import Path

dashboard = json.loads(Path("ops/observability/dashboards/stage0_rev2_overview.json").read_text(encoding="utf-8"))
alerts = json.loads(Path("ops/observability/alerts/stage0_rev2_alerts.json").read_text(encoding="utf-8"))
observability_evidence = json.loads(Path("ops/evidence/stage0_observability_evidence.json").read_text(encoding="utf-8"))

required_panels = {
    "api_latency_p95",
    "api_5xx_rate",
    "worker_queue_delay_p95",
    "generation_duration_p95",
    "export_duration_p95",
    "provider_errors",
    "quota_contention",
    "crawler_throttle",
    "object_storage_errors",
    "billing_and_subscription_failures",
    "safety_and_qa_blocks",
    "admin_failures",
    "frontend_error_rate",
}
required_alerts = {
    "api_5xx_rate_high",
    "api_latency_p95_high",
    "worker_queue_delay_high",
    "export_duration_high",
    "provider_error_rate_high",
    "object_storage_errors_present",
    "quota_contention_high",
    "crawler_governance_failure",
    "safety_critical_block",
    "admin_rbac_denial_spike",
    "frontend_error_rate_high",
}
panel_ids = {panel["panel_id"] for panel in dashboard["panels"]}
alert_ids = {alert["alert_id"] for alert in alerts["alerts"]}
missing_panels = sorted(required_panels - panel_ids)
missing_alerts = sorted(required_alerts - alert_ids)
if missing_panels:
    raise SystemExit(f"observability dashboard missing panels: {missing_panels}")
if missing_alerts:
    raise SystemExit(f"observability alerts missing rules: {missing_alerts}")
if dashboard["status"] != "definition_ready_runtime_evidence_open":
    raise SystemExit("dashboard must not claim runtime completion")
if alerts["status"] != "definition_ready_runtime_evidence_open":
    raise SystemExit("alerts must not claim runtime completion")
signals = {signal["name"]: signal["runtime_status"] for signal in observability_evidence["signals"]}
if signals.get("request_id_propagation") != "backend_local_contract_validated_staging_runtime_open":
	raise SystemExit("request-id evidence must keep staging/runtime propagation open")
if signals.get("structured_json_logs") != "backend_local_contract_validated_staging_log_capture_open":
	raise SystemExit("structured log evidence must not claim full runtime completion")
if "staging_request_id_propagation_across_web_admin_backend_worker_crawler_logs_metrics_traces" not in observability_evidence.get("open_items", []):
	raise SystemExit("observability evidence must keep staging request-id propagation open")
PY

log "release no-go evidence validation"
python3 scripts/render_no_go_release_notes.py --check
python3 - <<'PY'
from pathlib import Path

notes = Path("ops/release/stage0_rev2_current_no_go_release_notes.md").read_text(encoding="utf-8")
required_fragments = [
    "Release gate status: `no-go`.",
    "- Decision: `no-go`",
    "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
    "staging logs, metrics, traces, dashboard import, and alert-route evidence required",
]
missing = [fragment for fragment in required_fragments if fragment not in notes]
if missing:
    raise SystemExit(f"release no-go notes missing required fragments: {missing}")
PY

log "backend Go validation"
if [[ -d backend ]]; then
  unformatted="$(cd backend && gofmt -l $(find . -name '*.go' -not -path './vendor/*'))"
  if [[ -n "$unformatted" ]]; then
    printf 'gofmt required:\n%s\n' "$unformatted" >&2
    exit 1
  fi
  (cd backend && go test ./...)
  (cd backend && go vet ./...)
  (cd backend && go build ./cmd/server ./cmd/worker ./cmd/crawler ./cmd/migrate)
else
  printf 'skip: backend is not present yet\n'
fi

log "fixture/schema validation"
if [[ -f scripts/validate_stage0_rev2.py ]]; then
  python3 scripts/validate_stage0_rev2.py
else
  printf 'skip: scripts/validate_stage0_rev2.py is not present yet\n'
fi

log "web/admin conditional validation"
run_node_project_checks web
run_node_project_checks admin

log "load smoke script syntax"
bash -n scripts/load_smoke.sh
load_validate_dir="$(mktemp -d)"
for mode in chat_task worker_generation zip_export signed_download crawler_throttle quota_contention workspace_rendering; do
  LOAD_MODE="$mode" DRY_RUN=1 OUT_DIR="$load_validate_dir" scripts/load_smoke.sh >/dev/null
done

log "backup/restore drill script syntax"
bash -n scripts/backup_restore_drill.sh
backup_validate_dir="$(mktemp -d)"
DRY_RUN=1 DRILL_DIR="$backup_validate_dir" scripts/backup_restore_drill.sh >/dev/null

log "ops smoke wrappers"
bash -n scripts/playwright_smoke.sh
bash -n scripts/docker_build_smoke.sh
bash -n scripts/staging_smoke.sh
bash -n scripts/observability_smoke.sh
bash -n scripts/security_scan_smoke.sh
ops_validate_dir="$(mktemp -d)"
DRY_RUN=1 OUT_DIR="$ops_validate_dir/playwright" scripts/playwright_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/docker" scripts/docker_build_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/staging" scripts/staging_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/observability" scripts/observability_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/security" scripts/security_scan_smoke.sh >/dev/null
find "$ops_validate_dir" -name '*.json' -type f | grep -q .
python3 - "$ops_validate_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report.get("summary", {})
required_summary_keys = {
    "release_evidence",
    "release_gate_fixtures",
    "go_no_go",
    "missing_required_categories",
    "statuses",
}
missing = sorted(required_summary_keys - set(summary))
if missing:
    raise SystemExit(f"staging smoke summary missing release gate keys: {missing}")
release_evidence = summary["release_evidence"]
required_slots = release_evidence.get("required_slots", {})
for slot in (
    "release_sha",
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in required_slots:
        raise SystemExit(f"staging smoke release evidence missing slot {slot}")
if release_evidence.get("complete") is not False:
    raise SystemExit("staging smoke dry-run must keep release evidence incomplete")
go_no_go = summary["go_no_go"]
if go_no_go.get("decision") != "no-go":
    raise SystemExit("staging smoke dry-run must remain no-go")
for gate in ("private_beta_staging", "production_launch"):
    if gate not in summary["release_gate_fixtures"]:
        raise SystemExit(f"staging smoke missing gate fixture summary for {gate}")
PY
python3 - "$ops_validate_dir/observability" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("observability smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
required_checks = {
    "request_id_response_header_echo",
    "request_id_json_body_echo",
	"json_response_body",
	"structured_log_json_handler_declared",
	"access_log_request_context_declared",
	"compose_log_format_json_declared",
    "recover_log_includes_request_id",
    "metrics_config_declared",
    "metrics_runtime_endpoint_passed",
    "otel_config_declared",
    "otel_runtime_instrumentation_detected",
    "dashboard_definition_validated",
    "alert_definition_validated",
}
required_signals = {
    "request_id_propagation",
    "structured_json_logs",
    "opentelemetry_traces",
    "backend_worker_crawler_metrics",
    "dashboards",
    "alerts",
}
missing_checks = sorted(required_checks - set(report.get("checks", {})))
missing_signals = sorted(required_signals - set(report.get("signal_statuses", {})))
if missing_checks:
    raise SystemExit(f"observability smoke report missing checks: {missing_checks}")
if missing_signals:
    raise SystemExit(f"observability smoke report missing signal statuses: {missing_signals}")
if "private_beta_gate" not in report or "production_gate" not in report:
    raise SystemExit("observability smoke report must keep launch gates explicit")
if report.get("status") != "planned":
    raise SystemExit("observability dry-run report must remain planned, not runtime-passed")
PY

log "secret scan smoke"
if has_cmd git; then
  secret_candidates="$(mktemp)"
  secret_findings="$(mktemp)"
  git grep -nE '(AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,})' -- . >"$secret_candidates" || true
  grep -Ev '^(\.env\.example|fixtures/|schemas/|ops/ci/stage0-rev2-ci\.yml|scripts/repo_validate\.sh|scripts/security_scan_smoke\.sh|backend/internal/security/redact_test\.go):' "$secret_candidates" >"$secret_findings" || true
  if [[ -s "$secret_findings" ]]; then
    cat "$secret_findings"
    printf 'potential committed secret found\n' >&2
    exit 1
  fi
  rm -f "$secret_candidates" "$secret_findings"
fi

log "repo validation complete"
