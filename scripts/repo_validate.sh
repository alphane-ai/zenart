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
test -x scripts/load_smoke.sh
test -x scripts/backup_restore_drill.sh
test -x scripts/playwright_smoke.sh
test -x scripts/docker_build_smoke.sh
test -x scripts/staging_smoke.sh
test -x scripts/observability_smoke.sh
test -x scripts/security_scan_smoke.sh

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

log "secret scan smoke"
if has_cmd git; then
  git grep -nE '(AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,})' -- . ':!.env.example' ':!fixtures' ':!schemas' ':!backend/internal/security/redact_test.go' ':!ops/ci/stage0-rev2-ci.yml' ':!scripts/repo_validate.sh' ':!scripts/security_scan_smoke.sh' && {
    printf 'potential committed secret found\n' >&2
    exit 1
  } || true
fi

log "repo validation complete"
