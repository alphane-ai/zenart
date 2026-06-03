#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCAL_CI_INSTALL="${LOCAL_CI_INSTALL:-1}"
LOCAL_CI_BACKEND="${LOCAL_CI_BACKEND:-1}"
LOCAL_CI_WEB="${LOCAL_CI_WEB:-1}"
LOCAL_CI_ADMIN="${LOCAL_CI_ADMIN:-1}"
LOCAL_CI_MANAGER="${LOCAL_CI_MANAGER:-1}"
LOCAL_CI_DOCKER="${LOCAL_CI_DOCKER:-0}"
LOCAL_CI_DOCKER_BUILD="${LOCAL_CI_DOCKER_BUILD:-0}"
LOCAL_CI_PLAYWRIGHT="${LOCAL_CI_PLAYWRIGHT:-0}"
LOCAL_CI_REPO_VALIDATE="${LOCAL_CI_REPO_VALIDATE:-0}"
LOCAL_CI_OUT_DIR="${LOCAL_CI_OUT_DIR:-tmp/local-ci}"

mkdir -p "$LOCAL_CI_OUT_DIR"

log() {
  printf '\n==> %s\n' "$*"
}

skip() {
  printf 'skip: %s\n' "$*"
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

run_npm_project() {
  local dir="$1"
  shift

  if [[ ! -f "$dir/package.json" ]]; then
    skip "$dir/package.json is missing"
    return 0
  fi

  if [[ "$LOCAL_CI_INSTALL" == "1" ]]; then
    log "$dir npm ci"
    (cd "$dir" && npm ci)
  elif [[ ! -d "$dir/node_modules" ]]; then
    skip "$dir node_modules missing and LOCAL_CI_INSTALL=0"
    return 0
  fi

  local script
  for script in "$@"; do
    if (cd "$dir" && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$script'] ? 0 : 1)"); then
      log "$dir npm run $script"
      (cd "$dir" && npm run "$script")
    else
      skip "$dir has no npm script $script"
    fi
  done
}

run_allow_exit() {
  local expected="$1"
  shift
  set +e
  "$@"
  local status=$?
  set -e
  if [[ "$status" != "$expected" ]]; then
    printf 'expected exit %s, got %s: %s\n' "$expected" "$status" "$*" >&2
    return 1
  fi
}

log "repo scaffolding"
test -f .env.example
test -f .dockerignore
test -f docker-compose.yml
test -f ops/ci/stage0-rev2-ci.yml
test -f .github/workflows/stage0-rev2-ci.yml
test -f ops/ci/INSTALLATION.md
test -f openapi/zenart.v1.yaml
test -f Docs/stage0_blueprint_rev2.md
test -f manager/package.json
test -f manager/Dockerfile
test -f manager/app/page.tsx
cmp -s ops/ci/stage0-rev2-ci.yml .github/workflows/stage0-rev2-ci.yml

log "YAML syntax"
if has_cmd ruby; then
  ruby -e "require 'yaml'; YAML.load_file('docker-compose.yml'); YAML.load_file('ops/ci/stage0-rev2-ci.yml'); YAML.load_file('.github/workflows/stage0-rev2-ci.yml')"
elif has_cmd python3; then
  python3 - <<'PY'
from pathlib import Path
for path in ("docker-compose.yml", "ops/ci/stage0-rev2-ci.yml", ".github/workflows/stage0-rev2-ci.yml"):
    text = Path(path).read_text(encoding="utf-8")
    if "\t" in text:
        raise SystemExit(f"{path}: tabs are not allowed in YAML indentation")
PY
else
  skip "no ruby or python3 for YAML syntax check"
fi

log "OpenAPI generated client stale check"
python3 scripts/generate_openapi_clients.py --check

log "Stage 0 Rev2 contract and evidence validation"
python3 scripts/validate_stage0_rev2.py

log "workflow contract replays"
python3 scripts/validate_workflow_acceptance_contract.py
python3 scripts/validate_workflow_api_smoke_evidence.py
python3 scripts/run_workflow_api_smoke.py --check-fixture
python3 scripts/validate_workflow_runtime_evidence_contract.py

log "script syntax"
bash -n scripts/repo_validate.sh
bash -n scripts/load_smoke.sh
bash -n scripts/backup_restore_drill.sh
bash -n scripts/playwright_smoke.sh
bash -n scripts/docker_build_smoke.sh
bash -n scripts/staging_smoke.sh
bash -n scripts/observability_smoke.sh
bash -n scripts/staging_observability_backup_load_smoke.sh
bash -n scripts/staging_object_storage_signed_url_smoke.sh
bash -n scripts/staging_object_storage_retention_cleanup_smoke.sh
bash -n scripts/staging_legal_support_visibility_smoke.sh
bash -n scripts/security_scan_smoke.sh
bash -n scripts/release_evidence_bundle_smoke.sh
bash -n scripts/collect_release_runtime_artifacts.sh
bash -n scripts/run_release_closure_pipeline.sh
bash -n .ops/watch_stage0_rev2_lanes.sh
bash -n .ops/audit_stage0_rev2_cron_config.sh
.ops/watch_stage0_rev2_lanes.sh --help >/dev/null
.ops/audit_stage0_rev2_cron_config.sh --help >/dev/null
scripts/collect_release_runtime_artifacts.sh --help >/dev/null
scripts/run_release_closure_pipeline.sh --help >/dev/null
run_allow_exit 2 scripts/collect_release_runtime_artifacts.sh --unknown-option
python3 -m py_compile scripts/write_ci_runtime_evidence.py
python3 -m py_compile scripts/promote_ci_runtime_artifacts.py
python3 -m py_compile scripts/promote_staging_runtime_artifacts.py
python3 -m py_compile scripts/promote_production_runtime_artifacts.py
python3 -m py_compile scripts/promote_release_runtime_artifacts.py
python3 -m py_compile scripts/reconcile_release_gate_runtime_evidence.py
python3 -m py_compile scripts/plan_release_runtime_inputs.py
python3 -m py_compile scripts/prepare_release_runtime_inputs.py
python3 -m py_compile scripts/plan_release_gate_fixture_updates.py
python3 -m py_compile scripts/plan_stage0_rev2_checklist_closure.py
python3 -m py_compile scripts/apply_release_closure_plan.py

log "dry-run smoke wrappers"
DRY_RUN=1 OUT_DIR="$LOCAL_CI_OUT_DIR/playwright" scripts/playwright_smoke.sh
DRY_RUN=1 OUT_DIR="$LOCAL_CI_OUT_DIR/docker" scripts/docker_build_smoke.sh
DRY_RUN=1 OUT_DIR="$LOCAL_CI_OUT_DIR/staging" scripts/staging_smoke.sh
DRY_RUN=1 OUT_DIR="$LOCAL_CI_OUT_DIR/observability" scripts/observability_smoke.sh
DRY_RUN=1 OUT_DIR="$LOCAL_CI_OUT_DIR/security" scripts/security_scan_smoke.sh
run_allow_exit 2 env OUT_DIR="$LOCAL_CI_OUT_DIR/staging-observability-backup-load" scripts/staging_observability_backup_load_smoke.sh
RUN_ID="local-ci-object-storage-signed-url" OUT_DIR="$LOCAL_CI_OUT_DIR/object-storage" scripts/staging_object_storage_signed_url_smoke.sh
run_allow_exit 2 env DRY_RUN=1 RUN_ID="local-ci-object-storage-retention-cleanup" OUT_DIR="$LOCAL_CI_OUT_DIR/object-storage-retention-cleanup" scripts/staging_object_storage_retention_cleanup_smoke.sh
run_allow_exit 2 env DRY_RUN=1 RUN_ID="local-ci-legal-support" OUT_DIR="$LOCAL_CI_OUT_DIR/legal-support" scripts/staging_legal_support_visibility_smoke.sh
run_allow_exit 2 env DRY_RUN=1 OUT_DIR="$LOCAL_CI_OUT_DIR/release-bundle" scripts/release_evidence_bundle_smoke.sh
mkdir -p "$LOCAL_CI_OUT_DIR/empty-ci-artifacts"
run_allow_exit 2 python3 scripts/promote_ci_runtime_artifacts.py --input-dir "$LOCAL_CI_OUT_DIR/empty-ci-artifacts" --dry-run
mkdir -p "$LOCAL_CI_OUT_DIR/empty-staging-artifacts"
run_allow_exit 2 python3 scripts/promote_staging_runtime_artifacts.py --input-dir "$LOCAL_CI_OUT_DIR/empty-staging-artifacts" --dry-run
mkdir -p "$LOCAL_CI_OUT_DIR/empty-production-artifacts"
run_allow_exit 2 python3 scripts/promote_production_runtime_artifacts.py --input-dir "$LOCAL_CI_OUT_DIR/empty-production-artifacts" --dry-run
run_allow_exit 2 python3 scripts/promote_release_runtime_artifacts.py \
  --ci-input-dir "$LOCAL_CI_OUT_DIR/empty-ci-artifacts" \
  --staging-input-dir "$LOCAL_CI_OUT_DIR/empty-staging-artifacts" \
  --production-input-dir "$LOCAL_CI_OUT_DIR/empty-production-artifacts" \
  --dry-run
run_allow_exit 2 env \
  ARTIFACT_ROOT="$LOCAL_CI_OUT_DIR/runtime-inputs" \
  DRY_RUN=1 \
  scripts/collect_release_runtime_artifacts.sh
python3 scripts/reconcile_release_gate_runtime_evidence.py --out "$LOCAL_CI_OUT_DIR/runtime-reconciliation.json"
test -f "$LOCAL_CI_OUT_DIR/runtime-reconciliation.json"
python3 scripts/plan_release_runtime_inputs.py \
  --reconciliation "$LOCAL_CI_OUT_DIR/runtime-reconciliation.json" \
  --out "$LOCAL_CI_OUT_DIR/runtime-input-manifest.json"
test -f "$LOCAL_CI_OUT_DIR/runtime-input-manifest.json"
python3 -m json.tool "$LOCAL_CI_OUT_DIR/runtime-input-manifest.json" >/dev/null
python3 scripts/prepare_release_runtime_inputs.py \
  --manifest "$LOCAL_CI_OUT_DIR/runtime-input-manifest.json" \
  --artifact-root "$LOCAL_CI_OUT_DIR/runtime-inputs" \
  --out "$LOCAL_CI_OUT_DIR/runtime-input-workspace.json"
test -f "$LOCAL_CI_OUT_DIR/runtime-input-workspace.json"
python3 -m json.tool "$LOCAL_CI_OUT_DIR/runtime-input-workspace.json" >/dev/null
python3 scripts/plan_release_gate_fixture_updates.py \
  --reconciliation "$LOCAL_CI_OUT_DIR/runtime-reconciliation.json" \
  --out "$LOCAL_CI_OUT_DIR/fixture-update-plan.json"
test -f "$LOCAL_CI_OUT_DIR/fixture-update-plan.json"
python3 scripts/plan_stage0_rev2_checklist_closure.py \
  --fixture-plan "$LOCAL_CI_OUT_DIR/fixture-update-plan.json" \
  --out "$LOCAL_CI_OUT_DIR/checklist-closure-plan.json"
test -f "$LOCAL_CI_OUT_DIR/checklist-closure-plan.json"
python3 scripts/apply_release_closure_plan.py \
  --fixture-plan "$LOCAL_CI_OUT_DIR/fixture-update-plan.json" \
  --checklist-plan "$LOCAL_CI_OUT_DIR/checklist-closure-plan.json" \
  --out "$LOCAL_CI_OUT_DIR/closure-apply-report.json"
test -f "$LOCAL_CI_OUT_DIR/closure-apply-report.json"
.ops/watch_stage0_rev2_lanes.sh \
  --check-only \
  --out "$LOCAL_CI_OUT_DIR/stage0-rev2-lane-health.json"
python3 -m json.tool "$LOCAL_CI_OUT_DIR/stage0-rev2-lane-health.json" >/dev/null
.ops/audit_stage0_rev2_cron_config.sh --json > "$LOCAL_CI_OUT_DIR/stage0-rev2-cron-config-audit.json"
python3 -m json.tool "$LOCAL_CI_OUT_DIR/stage0-rev2-cron-config-audit.json" >/dev/null
scripts/run_release_closure_pipeline.sh \
  --artifact-root "$LOCAL_CI_OUT_DIR/runtime-inputs" \
  --release-out-dir "$LOCAL_CI_OUT_DIR/release-closure-pipeline"
test -f "$LOCAL_CI_OUT_DIR/release-closure-pipeline/runtime-input-manifest.json"
test -f "$LOCAL_CI_OUT_DIR/release-closure-pipeline/runtime-input-workspace.json"
test -f "$LOCAL_CI_OUT_DIR/release-closure-pipeline/closure-pipeline-report.json"
python3 -m json.tool "$LOCAL_CI_OUT_DIR/release-closure-pipeline/runtime-input-manifest.json" >/dev/null
python3 -m json.tool "$LOCAL_CI_OUT_DIR/release-closure-pipeline/runtime-input-workspace.json" >/dev/null
python3 -m json.tool "$LOCAL_CI_OUT_DIR/release-closure-pipeline/closure-pipeline-report.json" >/dev/null

log "secret scan smoke"
OUT_DIR="$LOCAL_CI_OUT_DIR/security-runtime" scripts/security_scan_smoke.sh

if [[ "$LOCAL_CI_DOCKER" == "1" ]]; then
  log "docker compose syntax"
  docker compose --env-file .env.example config --quiet
else
  skip "docker compose syntax; set LOCAL_CI_DOCKER=1"
fi

if [[ "$LOCAL_CI_BACKEND" == "1" ]]; then
  log "backend gofmt"
  unformatted="$(cd backend && gofmt -l $(find . -name '*.go' -not -path './vendor/*'))"
  if [[ -n "$unformatted" ]]; then
    printf 'gofmt required:\n%s\n' "$unformatted" >&2
    exit 1
  fi

  log "backend go test"
  (cd backend && go test ./...)
  log "backend go vet"
  (cd backend && go vet ./...)
  log "backend command builds"
  (cd backend && go build ./cmd/server ./cmd/worker ./cmd/crawler ./cmd/migrate)
else
  skip "backend checks; set LOCAL_CI_BACKEND=1"
fi

if [[ "$LOCAL_CI_WEB" == "1" ]]; then
  run_npm_project web lint typecheck test build smoke:user-routes
else
  skip "web checks; set LOCAL_CI_WEB=1"
fi

if [[ "$LOCAL_CI_ADMIN" == "1" ]]; then
  run_npm_project admin lint typecheck test build
else
  skip "admin checks; set LOCAL_CI_ADMIN=1"
fi

if [[ "$LOCAL_CI_MANAGER" == "1" ]]; then
  run_npm_project manager lint typecheck test build
else
  skip "manager checks; set LOCAL_CI_MANAGER=1"
fi

if [[ "$LOCAL_CI_DOCKER_BUILD" == "1" ]]; then
  log "docker image build smoke"
  OUT_DIR="$LOCAL_CI_OUT_DIR/docker-build" scripts/docker_build_smoke.sh
else
  skip "docker image build smoke; set LOCAL_CI_DOCKER_BUILD=1"
fi

if [[ "$LOCAL_CI_PLAYWRIGHT" == "1" ]]; then
  log "Playwright smoke against running web/admin"
  OUT_DIR="$LOCAL_CI_OUT_DIR/playwright-runtime" scripts/playwright_smoke.sh
else
  skip "runtime Playwright smoke; start web/admin and set LOCAL_CI_PLAYWRIGHT=1"
fi

if [[ "$LOCAL_CI_REPO_VALIDATE" == "1" ]]; then
  log "legacy full repo_validate.sh"
  scripts/repo_validate.sh
else
  skip "legacy full repo_validate.sh; set LOCAL_CI_REPO_VALIDATE=1"
fi

log "local CI passed"
