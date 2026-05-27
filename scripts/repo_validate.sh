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
test -x scripts/staging_observability_backup_load_smoke.sh
test -x scripts/security_scan_smoke.sh
test -x scripts/release_evidence_bundle_smoke.sh
test -x scripts/render_no_go_release_notes.py
test -x scripts/run_workflow_api_smoke.py
test -x scripts/validate_workflow_api_smoke_evidence.py

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
if signals.get("backend_worker_crawler_metrics") != "backend_runtime_worker_crawler_definitions_validated_staging_capture_open":
	raise SystemExit("metrics evidence must validate backend runtime plus worker/crawler definitions while keeping staging capture open")
if "staging_request_id_propagation_across_web_admin_backend_worker_crawler_logs_metrics_traces" not in observability_evidence.get("open_items", []):
	raise SystemExit("observability evidence must keep staging request-id propagation open")
PY

log "release no-go evidence validation"
python3 scripts/render_no_go_release_notes.py --check
release_bundle_tmp="$(mktemp -d)"
trap 'rm -rf "$release_bundle_tmp"' EXIT
if OUT_DIR="$release_bundle_tmp" DRY_RUN=1 scripts/release_evidence_bundle_smoke.sh >/tmp/stage0-release-bundle-smoke.out 2>/tmp/stage0-release-bundle-smoke.err; then
  printf 'release evidence bundle dry-run unexpectedly returned go\n' >&2
  cat /tmp/stage0-release-bundle-smoke.out >&2
  cat /tmp/stage0-release-bundle-smoke.err >&2
  exit 1
fi
python3 - "$release_bundle_tmp" <<'PY'
import json
import sys
from pathlib import Path

out_dir = Path(sys.argv[1])
reports = [
    path
    for path in sorted(out_dir.glob("*-release-evidence-bundle-*.json"))
    if not path.name.endswith(".staging-smoke.json")
]
if len(reports) != 1:
    raise SystemExit(f"expected one release bundle report, found {len(reports)}")
report = json.loads(reports[0].read_text(encoding="utf-8"))
source_report = Path(report["source_staging_smoke_report"])
source_results = Path(report["source_staging_smoke_results"])
if report["status"] != "blocked" or report["decision"] != "no-go":
    raise SystemExit("release evidence bundle dry-run must remain blocked/no-go")
if not source_report.exists() or source_report.parent != out_dir:
    raise SystemExit("release bundle must promote nested staging smoke report into OUT_DIR")
if not source_results.exists() or source_results.parent != out_dir:
    raise SystemExit("release bundle must promote nested staging smoke NDJSON into OUT_DIR")
if report.get("blocking_reason_count") != len(report.get("blocking_reasons", [])):
    raise SystemExit("release bundle blocking_reason_count must match blocking_reasons length")
decision_inputs = report.get("decision_inputs", {})
if decision_inputs.get("gate_fixtures_clear") is not False:
    raise SystemExit("release bundle dry-run must preserve blocked gate fixture context")
PY
python3 - <<'PY'
import json
from pathlib import Path

private_beta = json.loads(Path("fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json").read_text(encoding="utf-8"))
production = json.loads(Path("fixtures/stage0/rev2/release_gate_evidence.production_launch.json").read_text(encoding="utf-8"))
notes = Path("ops/release/stage0_rev2_current_no_go_release_notes.md").read_text(encoding="utf-8")
required_fragments = [
    "Release gate status: `no-go`.",
    "- Decision: `no-go`",
    "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
    "Staging smoke: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=post_deploy_smoke`, record status `passed`, verify backend health/readiness, web, admin, auth boundary, worker task, export/package, signed download, crawler admin, quota/rate-limit, request-id observability categories, and include seeded user, tenant, task, package, and export smoke IDs.",
    "Config diff: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=config_diff`, and record status `passed`, `reviewed`, or `no_diff` before private beta/production decisions.",
    "Observability smoke: local status `passed` from `ops/evidence/observability/local/20260526T192311Z-observability-smoke-7780.json`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=observability`, record status `passed`, and include passed/validated evidence refs for request-id propagation, structured JSON logs, OpenTelemetry traces, backend/worker/crawler metrics, dashboard import, and alert routes.",
    "Backup/restore drill: local status `passed` from `ops/evidence/backup-restore/local/20260526T153126Z/report.json`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=backup_restore`, record status `passed`, and include passed/validated evidence refs for Postgres restore and exported package/object restore before private beta/production decisions.",
    "Load evidence: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=load`, record status `passed`, and include passed/validated evidence refs for `chat_task`, `worker_generation`, `zip_export`, `signed_download`, `crawler_throttle`, `quota_contention`, and `workspace_rendering` before private beta/production decisions.",
    "Rollback drill: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=rollback`, record status `passed` or `validated`, and include passed/validated evidence refs for image rollback, feature flag rollback, migration compatibility, worker drain, and post-rollback smoke.",
    "Security scan: local status `passed` from `ops/evidence/security/local/20260526T142040Z-security-scan-smoke-65314.json`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=security_scan`, record status `passed`, and include passed/validated evidence refs for dependency, image/container, and committed-secret scans before private beta/production decisions.",
    "## Open Rev2 Runtime Checklist",
    "Observability runtime: staging request id propagation runtime evidence 通过",
    "Private Beta/Staging external-user runtime evidence 通过",
]
missing = [fragment for fragment in required_fragments if fragment not in notes]
if missing:
    raise SystemExit(f"release no-go notes missing required fragments: {missing}")
if notes.count("- Load evidence:") != 1:
    raise SystemExit("release no-go notes must contain exactly one Load evidence line")
if notes.count("- Load smoke:") != 1:
    raise SystemExit("release no-go notes must contain exactly one local Load smoke summary line")

def fixture_blockers(gate):
    return [
        str(check.get("check_id", "unknown_check"))
        for check in gate.get("checks", [])
        if check.get("status") not in {"pass", "passed"}
    ]

def present_do_not_launch(gate):
    return [
        str(check.get("condition_id", "unknown_condition"))
        for check in gate.get("do_not_launch_checks", [])
        if check.get("is_present") is True
    ]

def assert_line_matches(label, path, values):
    expected = f"- {label}: `{path}`: {', '.join(values) if values else 'none recorded'}."
    if expected not in notes:
        raise SystemExit(f"release no-go notes drifted from fixture decision; expected line: {expected}")

def assert_condition_line_matches(label, values):
    expected = f"- {label}: {', '.join(values) if values else 'none recorded'}."
    if expected not in notes:
        raise SystemExit(f"release no-go notes drifted from fixture decision; expected line: {expected}")

assert_line_matches(
    "Open private beta blockers",
    "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    fixture_blockers(private_beta),
)
assert_condition_line_matches(
    "Private beta do-not-launch conditions present",
    present_do_not_launch(private_beta),
)
assert_line_matches(
    "Open production blockers",
    "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
    fixture_blockers(production),
)
assert_condition_line_matches(
    "Production do-not-launch conditions present",
    present_do_not_launch(production),
)

template = Path("ops/release/release_notes_template.md").read_text(encoding="utf-8")
if template.count("- Load evidence:") != 1:
    raise SystemExit("release notes template must contain exactly one Load evidence slot")
if template.count("- Load smoke run:") != 1:
    raise SystemExit("release notes template must contain exactly one Load smoke run slot")
if "seeded user, tenant, task, package, and export smoke IDs" not in template:
    raise SystemExit("release notes template must require seeded runtime smoke IDs")
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
python3 scripts/validate_workflow_api_smoke_evidence.py
python3 scripts/run_workflow_api_smoke.py --check-fixture

log "web/admin conditional validation"
run_node_project_checks web
run_node_project_checks admin

log "load smoke script syntax"
bash -n scripts/load_smoke.sh
load_validate_dir="$(mktemp -d)"
for mode in chat_task worker_generation zip_export signed_download crawler_throttle quota_contention workspace_rendering; do
  LOAD_MODE="$mode" DRY_RUN=1 OUT_DIR="$load_validate_dir" scripts/load_smoke.sh >/dev/null
done
python3 - "$load_validate_dir" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 7:
    raise SystemExit(f"load smoke dry-run must write one report per mode, got {len(reports)}")
by_mode = {}
for path in reports:
    report = json.loads(path.read_text(encoding="utf-8"))
    by_mode[report.get("mode")] = report
required_modes = {
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
}
missing = sorted(required_modes - set(by_mode))
if missing:
    raise SystemExit(f"load smoke dry-run missing modes: {missing}")
crawler = by_mode["crawler_throttle"]
paths = set(crawler.get("paths", []))
expected = set(crawler.get("expected_statuses", []))
if "/api/admin/v1/crawler/sources" not in paths:
    raise SystemExit(f"crawler throttle load smoke must use admin route contract: {crawler}")
if any(value.startswith("/api/v1/admin/") for value in paths | expected):
    raise SystemExit(f"crawler throttle load smoke must not use stale /api/v1/admin route: {crawler}")
for status in ("401", "403", "404", "501"):
    expected_value = f"/api/admin/v1/crawler/sources:{status}"
    if expected_value not in expected:
        raise SystemExit(f"crawler throttle load smoke missing expected status {expected_value}")
PY

log "backup/restore drill script syntax"
bash -n scripts/backup_restore_drill.sh
backup_validate_dir="$(mktemp -d)"
DRY_RUN=1 DRILL_DIR="$backup_validate_dir" scripts/backup_restore_drill.sh >/dev/null

log "ops smoke wrappers"
bash -n scripts/playwright_smoke.sh
bash -n scripts/docker_build_smoke.sh
bash -n scripts/staging_smoke.sh
bash -n scripts/observability_smoke.sh
bash -n scripts/staging_observability_backup_load_smoke.sh
bash -n scripts/security_scan_smoke.sh
bash -n scripts/release_evidence_bundle_smoke.sh
ops_validate_dir="$(mktemp -d)"
DRY_RUN=1 OUT_DIR="$ops_validate_dir/playwright" scripts/playwright_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/docker" scripts/docker_build_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/staging" scripts/staging_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/observability" scripts/observability_smoke.sh >/dev/null
set +e
OUT_DIR="$ops_validate_dir/staging-observability-backup-load" scripts/staging_observability_backup_load_smoke.sh >/dev/null
staging_obl_status=$?
set -e
if [[ "$staging_obl_status" -ne 2 ]]; then
  printf 'staging observability/backup/load preflight must exit 2 with missing evidence, got %s\n' "$staging_obl_status" >&2
  exit 1
fi
DRY_RUN=1 OUT_DIR="$ops_validate_dir/security" scripts/security_scan_smoke.sh >/dev/null
set +e
DRY_RUN=1 OUT_DIR="$ops_validate_dir/release-bundle" scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_status=$?
set -e
if [[ "$release_bundle_status" -ne 2 ]]; then
  raise_msg="release evidence bundle dry-run must exit 2 while release gates are no-go, got $release_bundle_status"
  printf '%s\n' "$raise_msg" >&2
  exit 1
fi
find "$ops_validate_dir" -name '*.json' -type f | grep -q .
python3 - "$ops_validate_dir/release-bundle" <<'PY'
import json
import sys
from pathlib import Path

out_dir = Path(sys.argv[1])
reports = [
    path
    for path in sorted(out_dir.glob("*.json"))
    if not path.name.endswith(".staging-smoke.json")
]
if len(reports) != 1:
    raise SystemExit("release evidence bundle dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "release_evidence_bundle":
    raise SystemExit(f"release evidence bundle report has wrong kind: {report}")
if report.get("status") != "blocked":
    raise SystemExit("release evidence bundle dry-run must remain blocked")
if report.get("decision") != "no-go":
    raise SystemExit("release evidence bundle dry-run must keep no-go decision")
if report.get("release_evidence_complete") is not False:
    raise SystemExit("release evidence bundle dry-run must keep release evidence incomplete")
if report.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("release evidence bundle dry-run must keep post-deploy smoke unverified")
if report.get("gate_fixtures_clear") is not False:
    raise SystemExit("release evidence bundle dry-run must keep gate fixtures blocked")
for slot in (
    "release_sha",
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in report.get("missing_slots", []):
        raise SystemExit(f"release evidence bundle missing expected absent slot {slot}")
for slot in (
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in report.get("unverified_slots", []):
        raise SystemExit(f"release evidence bundle missing expected unverified slot {slot}")
blocking = report.get("blocking_reasons", [])
for reason in (
    "staging_smoke_not_passed",
    "post_deploy_smoke_contract_unverified",
    "missing_release_evidence:release_sha",
    "missing_release_evidence:observability_evidence",
):
    if reason not in blocking:
        raise SystemExit(f"release evidence bundle missing blocking reason {reason}")
if not any(reason.startswith("gate_fixture_blocked:private_beta_staging:") for reason in blocking):
    raise SystemExit("release evidence bundle must include private beta fixture blockers")
if not any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking):
    raise SystemExit("release evidence bundle must include production fixture blockers")
if not report.get("source_staging_smoke_report"):
    raise SystemExit("release evidence bundle must cite source staging smoke report")
if not Path(report["source_staging_smoke_report"]).exists():
    raise SystemExit("release evidence bundle must preserve source staging smoke report")
if not Path(report["source_staging_smoke_results"]).exists():
    raise SystemExit("release evidence bundle must preserve source staging smoke results")
PY
python3 - "$ops_validate_dir/observability" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("observability smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
signals = {signal["signal_id"]: signal for signal in report.get("signals", [])}
metrics = signals.get("backend_worker_crawler_metrics")
if not metrics:
    raise SystemExit("observability smoke report missing backend_worker_crawler_metrics signal")
refs = set(metrics.get("evidence_refs", []))
for ref in (
    "backend/internal/server/metrics.go",
    "backend/internal/worker/metrics.go",
    "backend/internal/crawler/metrics.go",
):
    if ref not in refs:
        raise SystemExit(f"observability metrics evidence refs missing {ref}")
checks = report.get("checks", {})
for key in (
    "backend_metrics_definition_validated",
    "worker_metrics_definition_validated",
    "crawler_metrics_definition_validated",
    "backend_worker_crawler_metrics_contract_validated",
):
    if key not in checks:
        raise SystemExit(f"observability smoke checks missing {key}")
if checks["backend_worker_crawler_metrics_contract_validated"] is not False:
    raise SystemExit("observability dry-run must not claim metrics runtime contract without backend scrape evidence")
statuses = report.get("signal_statuses", {})
if statuses.get("backend_worker_crawler_metrics") != "open":
    raise SystemExit("observability dry-run must keep backend/worker/crawler metrics runtime evidence open")
open_items = report.get("open_items", [])
if "staging_backend_worker_crawler_metrics_capture_with_release_sha_and_bounded_labels" not in open_items:
    raise SystemExit("observability smoke must keep staging metrics capture open")
PY
python3 - "$ops_validate_dir/staging-observability-backup-load" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("staging observability/backup/load preflight must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "staging_observability_backup_load_preflight":
    raise SystemExit(f"preflight report has wrong kind: {report}")
if report.get("status") != "blocked":
    raise SystemExit("preflight with missing evidence must remain blocked")
if report.get("private_beta_check_id") != "staging_observability_backup_load":
    raise SystemExit("preflight must map to the private beta observability/backup/load check")
if report.get("release_gate_check_id") != "staging_observability_backup_load":
    raise SystemExit("preflight must preserve the staging observability/backup/load release gate check id")
if report.get("evidence_path_policy") != "ops/evidence/staging/":
    raise SystemExit("preflight must declare the staging runtime evidence path policy")
expected_slots = {
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
}
if set(report.get("blocked_slots", [])) != expected_slots:
    raise SystemExit(f"preflight missing-evidence blocked slots mismatch: {report.get('blocked_slots')}")
checks = {check["slot"]: check for check in report.get("checks", [])}
if set(checks) != expected_slots:
    raise SystemExit(f"preflight checks missing required slots: {checks}")
for slot, check in checks.items():
    if check.get("verified") is not False:
        raise SystemExit(f"missing {slot} must not verify")
    if check.get("expected_environment") != "staging":
        raise SystemExit(f"{slot} must require staging environment")
    if check.get("semantic_checks", {}).get("local_json_file") is not False:
        raise SystemExit(f"{slot} must fail local_json_file when missing")
for reason in (
    "unverified_observability_evidence:",
    "unverified_backup_restore_evidence:",
    "unverified_load_evidence:",
):
    if not any(item.startswith(reason) for item in report.get("blocking_reasons", [])):
        raise SystemExit(f"preflight missing blocking reason prefix {reason}")
PY
preflight_pass_dir="$(mktemp -d)"
preflight_sha="abcdef1234567890abcdef1234567890abcdef12"
cat >"$preflight_pass_dir/observability.json" <<EOF
{
  "release_sha": "$preflight_sha",
  "environment": "staging",
  "kind": "observability",
  "status": "passed",
  "signals": [
    {"signal_id": "request_id_propagation", "status": "passed", "evidence_ref": "ops/evidence/staging/request-id-$preflight_sha.json"},
    {"signal_id": "structured_json_logs", "status": "passed", "log_query": "release_sha=$preflight_sha request_id:*"},
    {"signal_id": "opentelemetry_traces", "status": "passed", "trace_id": "trace-$preflight_sha"},
    {"signal_id": "backend_worker_crawler_metrics", "status": "passed", "metrics_query": "release_sha=$preflight_sha"},
    {"signal_id": "dashboard_import", "status": "validated", "dashboard_uid": "stage0-$preflight_sha"},
    {"signal_id": "alert_routes", "status": "validated", "alert_rule_url": "https://monitoring.example.invalid/$preflight_sha"}
  ]
}
EOF
cat >"$preflight_pass_dir/backup.json" <<EOF
{
  "release_sha": "$preflight_sha",
  "environment": "staging",
  "kind": "backup_restore",
  "status": "passed",
  "drills": [
    {"drill_id": "postgres_restore", "status": "passed", "report_path": "ops/evidence/staging/postgres-restore-$preflight_sha.json"},
    {"drill_id": "object_restore", "status": "validated", "report_path": "ops/evidence/staging/object-restore-$preflight_sha.json"}
  ]
}
EOF
cat >"$preflight_pass_dir/load.json" <<EOF
{
  "release_sha": "$preflight_sha",
  "environment": "staging",
  "kind": "load",
  "status": "passed",
  "modes": [
    {"name": "chat_task", "status": "passed", "load_report": "ops/evidence/staging/load-chat-task-$preflight_sha.json"},
    {"name": "worker_generation", "status": "passed", "load_report": "ops/evidence/staging/load-worker-generation-$preflight_sha.json"},
    {"name": "zip_export", "status": "passed", "load_report": "ops/evidence/staging/load-zip-export-$preflight_sha.json"},
    {"name": "signed_download", "status": "passed", "load_report": "ops/evidence/staging/load-signed-download-$preflight_sha.json"},
    {"name": "crawler_throttle", "status": "passed", "load_report": "ops/evidence/staging/load-crawler-throttle-$preflight_sha.json"},
    {"name": "quota_contention", "status": "passed", "load_report": "ops/evidence/staging/load-quota-contention-$preflight_sha.json"},
    {"name": "workspace_rendering", "status": "passed", "load_report": "ops/evidence/staging/load-workspace-rendering-$preflight_sha.json"}
  ]
}
EOF
RELEASE_SHA="$preflight_sha" \
  OUT_DIR="$preflight_pass_dir/out" \
  OBSERVABILITY_EVIDENCE="$preflight_pass_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$preflight_pass_dir/backup.json" \
  LOAD_EVIDENCE="$preflight_pass_dir/load.json" \
  scripts/staging_observability_backup_load_smoke.sh >/dev/null
python3 - "$preflight_pass_dir/out" "$preflight_sha" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
expected_sha = sys.argv[2]
if len(reports) != 1:
    raise SystemExit("passing preflight must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("status") != "passed":
    raise SystemExit(f"synthetic complete preflight should pass: {report}")
if report.get("release_sha") != expected_sha:
    raise SystemExit("passing preflight must preserve release SHA")
if report.get("blocked_slots"):
    raise SystemExit(f"passing preflight must not have blocked slots: {report.get('blocked_slots')}")
for check in report.get("checks", []):
    if check.get("verified") is not True:
        raise SystemExit(f"passing preflight must verify every check: {check}")
    failed = [key for key, value in check.get("semantic_checks", {}).items() if value is not True]
    if failed:
        raise SystemExit(f"passing preflight semantic checks failed for {check.get('slot')}: {failed}")
PY
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
    "post_deploy_smoke_evidence",
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
local_evidence_verification = release_evidence.get("local_evidence_verification", {})
for slot in (
    "release_sha",
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in required_slots:
        raise SystemExit(f"staging smoke release evidence missing slot {slot}")
for slot in (
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in local_evidence_verification:
        raise SystemExit(f"staging smoke local evidence verification missing slot {slot}")
    if local_evidence_verification[slot].get("verified") is not False:
        raise SystemExit(f"staging smoke dry-run must not verify missing evidence slot {slot}")
if release_evidence.get("complete") is not False:
    raise SystemExit("staging smoke dry-run must keep release evidence incomplete")
go_no_go = summary["go_no_go"]
if go_no_go.get("decision") != "no-go":
    raise SystemExit("staging smoke dry-run must remain no-go")
if go_no_go.get("release_evidence_verified") is not False:
    raise SystemExit("staging smoke dry-run must keep release evidence unverified")
if go_no_go.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("staging smoke dry-run must keep post-deploy smoke evidence unverified")
if go_no_go.get("gate_fixtures_clear") is not False:
    raise SystemExit("staging smoke dry-run must keep gate fixtures blocked")
post_deploy_smoke = summary["post_deploy_smoke_evidence"]
if post_deploy_smoke.get("verified") is not False:
    raise SystemExit("staging smoke dry-run must keep post-deploy smoke contract unverified")
if post_deploy_smoke.get("expected_evidence_kind") != "post_deploy_smoke":
    raise SystemExit("staging smoke dry-run must declare post_deploy_smoke evidence kind")
if post_deploy_smoke.get("required_environment") != "staging":
    raise SystemExit("staging smoke dry-run must declare staging environment requirement")
if "all_checks_passed" not in post_deploy_smoke.get("reason", ""):
    raise SystemExit(f"staging smoke dry-run must explain failed post-deploy checks: {post_deploy_smoke}")
blocking_reasons = go_no_go.get("blocking_reasons", [])
for reason in (
    "staging_smoke_not_passed",
    "post_deploy_smoke_contract_unverified",
    "missing_release_evidence:release_sha",
    "missing_release_evidence:release_notes_path",
    "unverified_release_evidence:release_notes_path",
    "unverified_release_evidence:image_refs",
    "missing_release_evidence:load_evidence",
    "unverified_release_evidence:load_evidence",
):
    if reason not in blocking_reasons:
        raise SystemExit(f"staging smoke dry-run missing blocking reason {reason}")
if not any(reason.startswith("gate_fixture_blocked:private_beta_staging:") for reason in blocking_reasons):
    raise SystemExit("staging smoke dry-run must include private beta gate blocking reasons")
if not any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking_reasons):
    raise SystemExit("staging smoke dry-run must include production gate blocking reasons")
decision_inputs = go_no_go.get("decision_inputs", {})
if decision_inputs.get("smoke_passed") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record smoke_passed=false")
if decision_inputs.get("profile_post_deploy") is not True:
    raise SystemExit("staging smoke default dry-run decision inputs must record profile_post_deploy=true")
if decision_inputs.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record post_deploy_smoke_verified=false")
if decision_inputs.get("release_evidence_complete") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record release_evidence_complete=false")
if decision_inputs.get("gate_fixtures_clear") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record gate_fixtures_clear=false")
for gate in ("private_beta_staging", "production_launch"):
    if gate not in summary["release_gate_fixtures"]:
        raise SystemExit(f"staging smoke missing gate fixture summary for {gate}")
for passed_check in (
    "private_beta_staging:staging_support_retry_abuse_ops",
    "private_beta_staging:staging_crawler_approval_provenance",
    "production_launch:production_abuse_throttle_hold",
):
    if f"gate_fixture_blocked:{passed_check}" in blocking_reasons:
        raise SystemExit(f"staging smoke must not report passed fixture check as blocked: {passed_check}")
PY
contract_profile_dir="$(mktemp -d)"
DRY_RUN=1 \
  STAGING_SMOKE_PROFILE=contract \
  OUT_DIR="$contract_profile_dir/staging" \
  scripts/staging_smoke.sh >/dev/null
python3 - "$contract_profile_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("contract-profile staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report["summary"]
go_no_go = summary["go_no_go"]
decision_inputs = go_no_go.get("decision_inputs", {})
if decision_inputs.get("profile_post_deploy") is not False:
    raise SystemExit(f"contract-profile staging smoke must record profile_post_deploy=false: {decision_inputs}")
if decision_inputs.get("smoke_passed") is not False:
    raise SystemExit(f"contract-profile staging smoke must not count as post-deploy smoke passed: {decision_inputs}")
if "post_deploy_profile_required" not in go_no_go.get("blocking_reasons", []):
    raise SystemExit(f"contract-profile staging smoke must block on post_deploy_profile_required: {go_no_go}")
post_deploy_smoke = summary["post_deploy_smoke_evidence"]
if post_deploy_smoke.get("verified") is not False:
    raise SystemExit("contract-profile staging smoke must not verify post-deploy smoke evidence")
semantic_checks = post_deploy_smoke.get("semantic_checks", {})
if semantic_checks.get("profile_post_deploy") is not False:
    raise SystemExit(f"contract-profile post-deploy contract must fail profile_post_deploy: {semantic_checks}")
PY
complete_validate_dir="$(mktemp -d)"
complete_sha="1234567890abcdef1234567890abcdef12345678"
cat >"$complete_validate_dir/release-notes.md" <<EOF
# Synthetic Stage 0 Rev2 Release Notes

Release SHA: $complete_sha

## Identity
## Scope
## Migration List
## Config Diff
## Feature Flags
## Smoke Plan
## Evidence
## Rollback Plan
## Known Risks
## Go/No-Go
- Decision: \`no-go\`
EOF
printf '{"release_sha":"%s","environment":"staging","kind":"migration","status":"passed"}\n' "$complete_sha" >"$complete_validate_dir/migration.json"
printf '{"release_sha":"%s","environment":"staging","kind":"config_diff","status":"reviewed"}\n' "$complete_sha" >"$complete_validate_dir/config.json"
cat >"$complete_validate_dir/observability.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "observability",
  "status": "passed",
  "signals": [
    {"name": "request_id_propagation", "status": "passed", "evidence_ref": "staging/logs/request-id-$complete_sha.json"},
    {"name": "structured_json_logs", "status": "passed", "evidence_ref": "staging/logs/json-logs-$complete_sha.json"},
    {"name": "opentelemetry_traces", "status": "passed", "trace_id": "trace-$complete_sha"},
    {"name": "backend_worker_crawler_metrics", "status": "passed", "metrics_query": "staging metrics release_sha=$complete_sha"},
    {"name": "dashboard_import", "status": "passed", "dashboard_uid": "stage0-rev2-$complete_sha"},
    {"name": "alert_routes", "status": "validated", "alert_rule_url": "https://monitoring.example.invalid/stage0/$complete_sha"}
  ]
}
EOF
cat >"$complete_validate_dir/backup.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "backup_restore",
  "status": "passed",
  "drills": [
    {"drill_id": "postgres_restore", "status": "passed", "report_path": "staging/restore/postgres-$complete_sha.json"},
    {"drill_id": "object_restore", "status": "passed", "report_path": "staging/restore/object-$complete_sha.json"}
  ]
}
EOF
cat >"$complete_validate_dir/load.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "load",
  "status": "passed",
  "modes": [
    {"name": "chat_task", "status": "passed", "load_report": "staging/load/chat-task-$complete_sha.json"},
    {"name": "worker_generation", "status": "passed", "load_report": "staging/load/worker-generation-$complete_sha.json"},
    {"name": "zip_export", "status": "passed", "load_report": "staging/load/zip-export-$complete_sha.json"},
    {"name": "signed_download", "status": "passed", "load_report": "staging/load/signed-download-$complete_sha.json"},
    {"name": "crawler_throttle", "status": "passed", "load_report": "staging/load/crawler-throttle-$complete_sha.json"},
    {"name": "quota_contention", "status": "passed", "load_report": "staging/load/quota-contention-$complete_sha.json"},
    {"name": "workspace_rendering", "status": "passed", "load_report": "staging/load/workspace-rendering-$complete_sha.json"}
  ]
}
EOF
cat >"$complete_validate_dir/rollback.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "rollback",
  "status": "validated",
  "steps": [
    {"name": "image_rollback", "status": "validated", "rollback_report": "staging/rollback/images-$complete_sha.json"},
    {"name": "feature_flag_rollback", "status": "validated", "rollback_report": "staging/rollback/flags-$complete_sha.json"},
    {"name": "migration_compatibility", "status": "validated", "rollback_report": "staging/rollback/migration-compat-$complete_sha.json"},
    {"name": "worker_drain", "status": "validated", "rollback_report": "staging/rollback/worker-drain-$complete_sha.json"},
    {"name": "post_rollback_smoke", "status": "passed", "smoke_report": "staging/rollback/post-smoke-$complete_sha.json"}
  ]
}
EOF
cat >"$complete_validate_dir/security.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "security_scan",
  "status": "passed",
  "scans": [
    {"name": "dependency_scan", "status": "passed", "scan_report": "staging/security/dependencies-$complete_sha.json"},
    {"name": "image_scan", "status": "passed", "scan_report": "staging/security/images-$complete_sha.json"},
    {"name": "secret_scan", "status": "passed", "scan_report": "staging/security/secrets-$complete_sha.json"}
  ]
}
EOF
DRY_RUN=1 \
  OUT_DIR="$complete_validate_dir/staging" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenart-backend:$complete_sha,ghcr.io/alphane-ai/zenart-web:$complete_sha,ghcr.io/alphane-ai/zenart-admin:$complete_sha" \
  MIGRATION_EVIDENCE="$complete_validate_dir/migration.json" \
  CONFIG_DIFF_EVIDENCE="$complete_validate_dir/config.json" \
  OBSERVABILITY_EVIDENCE="$complete_validate_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$complete_validate_dir/backup.json" \
  LOAD_EVIDENCE="$complete_validate_dir/load.json" \
  ROLLBACK_EVIDENCE="$complete_validate_dir/rollback.json" \
  SECURITY_SCAN_EVIDENCE="$complete_validate_dir/security.json" \
  scripts/staging_smoke.sh >/dev/null
python3 - "$complete_validate_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("complete-evidence staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report["summary"]
release_evidence = summary["release_evidence"]
go_no_go = summary["go_no_go"]
if release_evidence.get("complete") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify all local evidence slots")
post_deploy_smoke = summary["post_deploy_smoke_evidence"]
if post_deploy_smoke.get("verified") is not False:
    raise SystemExit("complete-evidence dry-run must keep post-deploy smoke unverified without runtime URLs and seeded smoke records")
if "all_checks_passed" not in post_deploy_smoke.get("reason", ""):
    raise SystemExit(f"complete-evidence dry-run must block on post-deploy smoke checks: {post_deploy_smoke}")
for slot, evidence in release_evidence.get("local_evidence_verification", {}).items():
    if slot in {
        "migration_evidence",
        "config_diff_evidence",
        "observability_evidence",
        "backup_restore_evidence",
        "load_evidence",
        "rollback_evidence",
        "security_scan_evidence",
    }:
        checks = evidence.get("semantic_checks", {})
        failed = sorted(key for key, value in checks.items() if value is not True)
        if failed:
            raise SystemExit(f"{slot} semantic checks failed in complete-evidence dry-run: {failed}")
if release_evidence["local_evidence_verification"]["observability_evidence"].get("observability_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify observability signal contract")
observability_refs = release_evidence["local_evidence_verification"]["observability_evidence"]["observability_contract"].get("evidence_refs", {})
if sorted(observability_refs) != [
    "alert_routes",
    "backend_worker_crawler_metrics",
    "dashboard_import",
    "opentelemetry_traces",
    "request_id_propagation",
    "structured_json_logs",
]:
    raise SystemExit(f"complete-evidence staging smoke must expose observability evidence refs: {observability_refs}")
if not all(observability_refs[key] for key in observability_refs):
    raise SystemExit(f"complete-evidence staging smoke must expose non-empty observability refs: {observability_refs}")
if release_evidence["local_evidence_verification"]["backup_restore_evidence"].get("backup_restore_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify backup/restore drill contract")
if release_evidence["local_evidence_verification"]["load_evidence"].get("load_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify load mode contract")
if release_evidence["local_evidence_verification"]["rollback_evidence"].get("rollback_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify rollback contract")
if release_evidence["local_evidence_verification"]["security_scan_evidence"].get("security_scan_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify security scan contract")
for contract_name, expected_keys in {
    "backup_restore_contract": {"postgres_restore", "object_restore"},
    "load_contract": {"chat_task", "worker_generation", "zip_export", "signed_download", "crawler_throttle", "quota_contention", "workspace_rendering"},
    "rollback_contract": {"image_rollback", "feature_flag_rollback", "migration_compatibility", "worker_drain", "post_rollback_smoke"},
    "security_scan_contract": {"dependency_scan", "image_scan", "secret_scan"},
}.items():
    owner_slot = {
        "backup_restore_contract": "backup_restore_evidence",
        "load_contract": "load_evidence",
        "rollback_contract": "rollback_evidence",
        "security_scan_contract": "security_scan_evidence",
    }[contract_name]
    refs = release_evidence["local_evidence_verification"][owner_slot][contract_name].get("evidence_refs", {})
    if set(refs) != expected_keys:
        raise SystemExit(f"{contract_name} must expose evidence refs for every required entry: {refs}")
    if not all(refs[key] for key in refs):
        raise SystemExit(f"{contract_name} evidence refs must be non-empty: {refs}")
if go_no_go.get("release_evidence_complete") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must expose release_evidence_complete=true")
if go_no_go.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("complete-evidence staging smoke dry-run must expose post_deploy_smoke_verified=false")
if go_no_go.get("gate_fixtures_clear") is not False:
    raise SystemExit("complete-evidence staging smoke dry-run must keep gate_fixtures_clear=false")
if go_no_go.get("decision") != "no-go":
    raise SystemExit("complete-evidence staging smoke dry-run must remain no-go while gate fixtures are blocked")
blocked = go_no_go.get("blocked_conditions", [])
if not any(item.startswith("private_beta_staging:") for item in blocked):
    raise SystemExit("complete-evidence staging smoke dry-run must include private beta blockers")
if not any(item.startswith("production_launch:") for item in blocked):
    raise SystemExit("complete-evidence staging smoke dry-run must include production blockers")
blocking_reasons = go_no_go.get("blocking_reasons", [])
if "staging_smoke_not_passed" not in blocking_reasons:
    raise SystemExit("complete-evidence staging smoke dry-run must still block on missing runtime smoke pass")
if "post_deploy_smoke_contract_unverified" not in blocking_reasons:
    raise SystemExit("complete-evidence staging smoke dry-run must still block on unverified post-deploy smoke evidence")
if any(reason.startswith("missing_release_evidence:") for reason in blocking_reasons):
    raise SystemExit(f"complete-evidence staging smoke dry-run must not report missing release evidence: {blocking_reasons}")
if any(reason.startswith("unverified_release_evidence:") for reason in blocking_reasons):
    raise SystemExit(f"complete-evidence staging smoke dry-run must not report unverified release evidence: {blocking_reasons}")
if not any(reason.startswith("gate_fixture_blocked:private_beta_staging:") for reason in blocking_reasons):
    raise SystemExit("complete-evidence staging smoke dry-run must include private beta gate blocking reasons")
if not any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking_reasons):
    raise SystemExit("complete-evidence staging smoke dry-run must include production gate blocking reasons")
decision_inputs = go_no_go.get("decision_inputs", {})
if decision_inputs != {
    "profile_post_deploy": True,
    "smoke_passed": False,
    "post_deploy_smoke_verified": False,
    "release_evidence_complete": True,
    "gate_fixtures_clear": False,
}:
    raise SystemExit(f"complete-evidence staging smoke decision inputs mismatch: {decision_inputs}")
PY
set +e
DRY_RUN=1 \
  OUT_DIR="$complete_validate_dir/release-bundle" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenart-backend:$complete_sha,ghcr.io/alphane-ai/zenart-web:$complete_sha,ghcr.io/alphane-ai/zenart-admin:$complete_sha" \
  MIGRATION_EVIDENCE="$complete_validate_dir/migration.json" \
  CONFIG_DIFF_EVIDENCE="$complete_validate_dir/config.json" \
  OBSERVABILITY_EVIDENCE="$complete_validate_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$complete_validate_dir/backup.json" \
  LOAD_EVIDENCE="$complete_validate_dir/load.json" \
  ROLLBACK_EVIDENCE="$complete_validate_dir/rollback.json" \
  SECURITY_SCAN_EVIDENCE="$complete_validate_dir/security.json" \
  scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_complete_status=$?
set -e
if [[ "$release_bundle_complete_status" -ne 2 ]]; then
  printf 'complete-evidence release bundle must remain no-go with blocked gate fixtures, got %s\n' "$release_bundle_complete_status" >&2
  exit 1
fi
python3 - "$complete_validate_dir/release-bundle" "$complete_sha" <<'PY'
import json
import sys
from pathlib import Path

out_dir = Path(sys.argv[1])
reports = [
    path
    for path in sorted(out_dir.glob("*.json"))
    if not path.name.endswith(".staging-smoke.json")
]
expected_sha = sys.argv[2]
if len(reports) != 1:
    raise SystemExit("complete-evidence release bundle dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "release_evidence_bundle":
    raise SystemExit(f"complete-evidence release bundle report has wrong kind: {report}")
if report.get("status") != "blocked":
    raise SystemExit("complete-evidence release bundle must remain blocked while gate fixtures are no-go")
if report.get("decision") != "no-go":
    raise SystemExit("complete-evidence release bundle must preserve no-go decision")
if report.get("release_sha") != expected_sha:
    raise SystemExit(f"complete-evidence release bundle must forward release SHA: {report}")
if report.get("release_evidence_complete") is not True:
    raise SystemExit("complete-evidence release bundle must forward and verify all release evidence slots")
if report.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("complete-evidence release bundle must not verify runtime post-deploy smoke from dry-run evidence")
if report.get("gate_fixtures_clear") is not False:
    raise SystemExit("complete-evidence release bundle must keep gate fixtures blocked")
if report.get("missing_slots"):
    raise SystemExit(f"complete-evidence release bundle must not report missing slots: {report.get('missing_slots')}")
if report.get("unverified_slots"):
    raise SystemExit(f"complete-evidence release bundle must not report unverified slots: {report.get('unverified_slots')}")
blocking = report.get("blocking_reasons", [])
if any(reason.startswith("missing_release_evidence:") for reason in blocking):
    raise SystemExit(f"complete-evidence release bundle must not report missing release evidence: {blocking}")
if any(reason.startswith("unverified_release_evidence:") for reason in blocking):
    raise SystemExit(f"complete-evidence release bundle must not report unverified release evidence: {blocking}")
for reason in ("staging_smoke_not_passed", "post_deploy_smoke_contract_unverified"):
    if reason not in blocking:
        raise SystemExit(f"complete-evidence release bundle missing runtime blocker {reason}: {blocking}")
if not any(reason.startswith("gate_fixture_blocked:private_beta_staging:") for reason in blocking):
    raise SystemExit("complete-evidence release bundle must preserve private beta fixture blockers")
if not any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking):
    raise SystemExit("complete-evidence release bundle must preserve production fixture blockers")
if not report.get("source_staging_smoke_report"):
    raise SystemExit("complete-evidence release bundle must cite source staging smoke report")
if not Path(report["source_staging_smoke_report"]).exists():
    raise SystemExit("complete-evidence release bundle must preserve source staging smoke report")
if not Path(report["source_staging_smoke_results"]).exists():
    raise SystemExit("complete-evidence release bundle must preserve source staging smoke results")
PY
nested_only_dir="$(mktemp -d)"
cat >"$nested_only_dir/observability.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "qa",
  "kind": "ops_bundle",
  "status": "failed",
  "signals": [
    {"name": "request_id_propagation", "status": "passed", "evidence_ref": "staging/logs/request-id-$complete_sha.json"},
    {"name": "structured_json_logs", "status": "passed", "evidence_ref": "staging/logs/json-logs-$complete_sha.json"},
    {"name": "opentelemetry_traces", "status": "passed", "trace_id": "trace-$complete_sha"},
    {"name": "backend_worker_crawler_metrics", "status": "passed", "metrics_query": "staging metrics release_sha=$complete_sha"},
    {"name": "dashboard_import", "status": "passed", "dashboard_uid": "stage0-rev2-$complete_sha"},
    {"name": "alert_routes", "status": "validated", "alert_rule_url": "https://monitoring.example.invalid/stage0/$complete_sha"}
  ]
}
EOF
DRY_RUN=1 \
  OUT_DIR="$nested_only_dir/staging" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenart-backend:$complete_sha,ghcr.io/alphane-ai/zenart-web:$complete_sha,ghcr.io/alphane-ai/zenart-admin:$complete_sha" \
  MIGRATION_EVIDENCE="$complete_validate_dir/migration.json" \
  CONFIG_DIFF_EVIDENCE="$complete_validate_dir/config.json" \
  OBSERVABILITY_EVIDENCE="$nested_only_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$complete_validate_dir/backup.json" \
  LOAD_EVIDENCE="$complete_validate_dir/load.json" \
  ROLLBACK_EVIDENCE="$complete_validate_dir/rollback.json" \
  SECURITY_SCAN_EVIDENCE="$complete_validate_dir/security.json" \
  scripts/staging_smoke.sh >/dev/null
python3 - "$nested_only_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("nested-only staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report["summary"]
release_evidence = summary["release_evidence"]
observability = release_evidence["local_evidence_verification"]["observability_evidence"]
semantic_checks = observability.get("semantic_checks", {})
for key in ("environment_staging", "evidence_kind_match", "status_accepted"):
    if semantic_checks.get(key) is not False:
        raise SystemExit(f"nested-only observability evidence must fail top-level {key}: {semantic_checks}")
if observability.get("observability_contract", {}).get("verified") is not True:
    raise SystemExit("nested-only observability sub-signals should still be recognized independently")
if observability.get("verified") is not False:
    raise SystemExit(f"nested-only observability evidence must not verify from nested metadata: {observability}")
if release_evidence.get("complete") is not False:
    raise SystemExit("nested-only staging smoke must reject release evidence with wrong top-level metadata")
if "unverified_release_evidence:observability_evidence" not in summary["go_no_go"].get("blocking_reasons", []):
    raise SystemExit("nested-only staging smoke must block on unverified observability evidence")
PY
incomplete_contract_dir="$(mktemp -d)"
printf '{"release_sha":"%s","environment":"staging","kind":"observability","status":"passed","signals":[{"name":"request_id_propagation","status":"passed","evidence_ref":"only-one-signal.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/observability.json"
printf '{"release_sha":"%s","environment":"staging","kind":"backup_restore","status":"passed","drills":[{"drill_id":"postgres_restore","status":"passed","report_path":"postgres.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/backup.json"
printf '{"release_sha":"%s","environment":"staging","kind":"load","status":"passed","modes":[{"name":"chat_task","status":"passed","load_report":"chat-task.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/load.json"
printf '{"release_sha":"%s","environment":"staging","kind":"rollback","status":"validated","steps":[{"name":"image_rollback","status":"validated","rollback_report":"image.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/rollback.json"
printf '{"release_sha":"%s","environment":"staging","kind":"security_scan","status":"passed","scans":[{"name":"dependency_scan","status":"passed","scan_report":"dependencies.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/security.json"
DRY_RUN=1 \
  OUT_DIR="$incomplete_contract_dir/staging" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenart-backend:$complete_sha,ghcr.io/alphane-ai/zenart-web:$complete_sha,ghcr.io/alphane-ai/zenart-admin:$complete_sha" \
  MIGRATION_EVIDENCE="$complete_validate_dir/migration.json" \
  CONFIG_DIFF_EVIDENCE="$complete_validate_dir/config.json" \
  OBSERVABILITY_EVIDENCE="$incomplete_contract_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$incomplete_contract_dir/backup.json" \
  LOAD_EVIDENCE="$incomplete_contract_dir/load.json" \
  ROLLBACK_EVIDENCE="$incomplete_contract_dir/rollback.json" \
  SECURITY_SCAN_EVIDENCE="$incomplete_contract_dir/security.json" \
  scripts/staging_smoke.sh >/dev/null
python3 - "$incomplete_contract_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("incomplete-contract staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report["summary"]
release_evidence = summary["release_evidence"]
if release_evidence.get("complete") is not False:
    raise SystemExit("incomplete-contract staging smoke dry-run must reject incomplete observability/restore contracts")
verification = release_evidence["local_evidence_verification"]
observability = verification["observability_evidence"]
backup = verification["backup_restore_evidence"]
load = verification["load_evidence"]
rollback = verification["rollback_evidence"]
security = verification["security_scan_evidence"]
if observability.get("verified") is not False or "observability_contract" not in observability.get("reason", ""):
    raise SystemExit(f"incomplete observability contract must be unverified: {observability}")
if backup.get("verified") is not False or "backup_restore_contract" not in backup.get("reason", ""):
    raise SystemExit(f"incomplete backup/restore contract must be unverified: {backup}")
if load.get("verified") is not False or "load_contract" not in load.get("reason", ""):
    raise SystemExit(f"incomplete load contract must be unverified: {load}")
if rollback.get("verified") is not False or "rollback_contract" not in rollback.get("reason", ""):
    raise SystemExit(f"incomplete rollback contract must be unverified: {rollback}")
if security.get("verified") is not False or "security_scan_contract" not in security.get("reason", ""):
    raise SystemExit(f"incomplete security scan contract must be unverified: {security}")
if "unverified_release_evidence:observability_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete observability evidence must block go/no-go")
if "unverified_release_evidence:backup_restore_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete backup/restore evidence must block go/no-go")
if "unverified_release_evidence:load_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete load evidence must block go/no-go")
if "unverified_release_evidence:rollback_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete rollback evidence must block go/no-go")
if "unverified_release_evidence:security_scan_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete security scan evidence must block go/no-go")
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
  grep -Ev '^(\.env\.example|fixtures/|schemas/|ops/ci/stage0-rev2-ci\.yml|scripts/repo_validate\.sh|scripts/security_scan_smoke\.sh|backend/internal/security/redact_test\.go):|^backend/internal/server/server_test\.go:[0-9]+:.*sk-proj-abcdefghijklmnopqrstuvwxyz123456|^backend/internal/stage0/services_test\.go:[0-9]+:.*sk-ant-abcdefghijklmnopqrstuvwxyz123456' "$secret_candidates" >"$secret_findings" || true
  if [[ -s "$secret_findings" ]]; then
    cat "$secret_findings"
    printf 'potential committed secret found\n' >&2
    exit 1
  fi
  rm -f "$secret_candidates" "$secret_findings"
fi

log "repo validation complete"
