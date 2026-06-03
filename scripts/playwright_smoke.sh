#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_PLAYWRIGHT_PORT="${WEB_PLAYWRIGHT_PORT:-26080}"
ADMIN_PLAYWRIGHT_PORT="${ADMIN_PLAYWRIGHT_PORT:-26081}"
WEB_URL="${WEB_URL:-http://127.0.0.1:${WEB_PLAYWRIGHT_PORT}}"
ADMIN_URL="${ADMIN_URL:-http://127.0.0.1:${ADMIN_PLAYWRIGHT_PORT}}"
DRY_RUN="${DRY_RUN:-0}"
OUT_DIR="${OUT_DIR:-ops/evidence/playwright/local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-playwright-smoke-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
LOG_PATH="$OUT_DIR/${RUN_ID}.log"
SPEC_PATH="ops/ci/playwright-smoke.spec.ts"

write_report() {
  local status="$1"
  local exit_code="${2:-0}"
  mkdir -p "$OUT_DIR"
  cat >"$REPORT_PATH" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "run_id": "$RUN_ID",
  "status": "$status",
  "web_url": "$WEB_URL",
  "admin_url": "$ADMIN_URL",
  "web_playwright_port": "$WEB_PLAYWRIGHT_PORT",
  "admin_playwright_port": "$ADMIN_PLAYWRIGHT_PORT",
  "spec_path": "$SPEC_PATH",
  "log_path": "$LOG_PATH",
  "exit_code": $exit_code,
  "ci_gate": "open_until_installed_workflow_runs_playwright_smoke_on_pr_and_main",
  "private_beta_gate": "open_until_staging_playwright_smoke_passes_against_production_like_dependencies"
}
JSON
}

if [[ "$DRY_RUN" == "1" ]]; then
  write_report "planned" 0
  printf 'Playwright smoke dry-run planned for %s and %s\n' "$WEB_URL" "$ADMIN_URL"
  exit 0
fi

if [[ ! -f "$SPEC_PATH" ]]; then
  printf 'missing Playwright smoke spec: %s\n' "$SPEC_PATH" >&2
  write_report "blocked_missing_spec" 2
  exit 2
fi

if ! command -v npx >/dev/null 2>&1; then
  printf 'npx is required for Playwright smoke\n' >&2
  write_report "blocked_missing_npx" 127
  exit 127
fi

mkdir -p "$OUT_DIR"
set +e
WEB_URL="$WEB_URL" ADMIN_URL="$ADMIN_URL" npx --yes playwright@1.56.0 test "$SPEC_PATH" --project=chromium --reporter=line >"$LOG_PATH" 2>&1
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  write_report "passed" 0
  printf 'Playwright smoke passed; evidence written to %s\n' "$REPORT_PATH"
  exit 0
fi

write_report "failed" "$status"
printf 'Playwright smoke failed with exit code %s; see %s\n' "$status" "$LOG_PATH" >&2
exit "$status"
