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
    "Staging load evidence: `missing`; required JSON must reference the release SHA, set `environment=staging`, set `kind=load`, and record status `passed` before private beta/production decisions.",
    "## Open Rev2 Runtime Checklist",
    "Observability runtime: staging request id propagation runtime evidence 通过",
    "Private Beta/Staging external-user runtime evidence 通过",
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
if go_no_go.get("gate_fixtures_clear") is not False:
    raise SystemExit("staging smoke dry-run must keep gate fixtures blocked")
blocking_reasons = go_no_go.get("blocking_reasons", [])
for reason in (
    "staging_smoke_not_passed",
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
if decision_inputs.get("release_evidence_complete") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record release_evidence_complete=false")
if decision_inputs.get("gate_fixtures_clear") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record gate_fixtures_clear=false")
for gate in ("private_beta_staging", "production_launch"):
    if gate not in summary["release_gate_fixtures"]:
        raise SystemExit(f"staging smoke missing gate fixture summary for {gate}")
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
    "smoke_passed": False,
    "release_evidence_complete": True,
    "gate_fixtures_clear": False,
}:
    raise SystemExit(f"complete-evidence staging smoke decision inputs mismatch: {decision_inputs}")
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
  grep -Ev '^(\.env\.example|fixtures/|schemas/|ops/ci/stage0-rev2-ci\.yml|scripts/repo_validate\.sh|scripts/security_scan_smoke\.sh|backend/internal/security/redact_test\.go):' "$secret_candidates" >"$secret_findings" || true
  if [[ -s "$secret_findings" ]]; then
    cat "$secret_findings"
    printf 'potential committed secret found\n' >&2
    exit 1
  fi
  rm -f "$secret_candidates" "$secret_findings"
fi

log "repo validation complete"
