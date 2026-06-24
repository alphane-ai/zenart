#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_PLAYWRIGHT_PORT="${WEB_PLAYWRIGHT_PORT:-26080}"
ADMIN_PLAYWRIGHT_PORT="${ADMIN_PLAYWRIGHT_PORT:-26081}"
WEB_URL="${WEB_URL:-http://127.0.0.1:${WEB_PLAYWRIGHT_PORT}}"
ADMIN_URL="${ADMIN_URL:-http://127.0.0.1:${ADMIN_PLAYWRIGHT_PORT}}"
PLAYWRIGHT_PROJECT="${PLAYWRIGHT_PROJECT:-chromium}"
PLAYWRIGHT_GREP="${PLAYWRIGHT_GREP:-}"
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
  "coverage": {
    "user_web": {
      "status": "$status",
      "url": "$WEB_URL",
      "evidence_refs": ["$SPEC_PATH#web workspace shell renders", "$LOG_PATH"]
    },
    "admin_web": {
      "status": "$status",
      "url": "$ADMIN_URL",
      "evidence_refs": ["$SPEC_PATH#admin operations shell renders", "$LOG_PATH"]
    },
    "billing": {
      "status": "$status",
      "evidence_refs": ["$SPEC_PATH#billing smoke validates quota, invoices, team seats, and checkout guards", "$LOG_PATH"]
    },
    "workspace": {
      "status": "$status",
      "evidence_refs": ["$SPEC_PATH#workspace smoke validates core workspace shell", "$LOG_PATH"]
    }
  },
  "safe_projection": {
    "secret_material_persisted": false,
    "raw_prompt_persisted": false,
    "raw_provider_payload_persisted": false,
    "raw_stripe_payload_persisted": false,
    "raw_support_body_projected": false,
    "signed_url_persisted": false,
    "authorization_header_persisted": false,
    "cookie_persisted": false
  },
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

if [[ ! -d web/node_modules/@playwright/test ]]; then
  printf 'web Playwright dependencies are required for CI smoke; run npm ci in web first\n' >&2
  write_report "blocked_missing_playwright_dependency" 127
  exit 127
fi

mkdir -p "$OUT_DIR"
log_abs="$LOG_PATH"
case "$log_abs" in
  /*) ;;
  *) log_abs="$ROOT/$LOG_PATH" ;;
esac
tmp_parent="$ROOT/web/tmp"
mkdir -p "$tmp_parent"
tmp_dir="$(mktemp -d "$tmp_parent/playwright-ci.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
cp "$SPEC_PATH" "$tmp_dir/playwright-smoke.spec.ts"
cat >"$tmp_dir/playwright.config.ts" <<'TS'
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  expect: {
    timeout: 8_000
  },
  reporter: "line",
  use: {
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 1000 }
      }
    }
  ]
});
TS
tmp_rel="${tmp_dir#$ROOT/web/}"
set +e
playwright_args=(
  test "$tmp_rel/playwright-smoke.spec.ts"
  --config "$tmp_rel/playwright.config.ts"
  --project="$PLAYWRIGHT_PROJECT"
  --reporter=line
)
if [[ -n "$PLAYWRIGHT_GREP" ]]; then
  playwright_args+=(--grep "$PLAYWRIGHT_GREP")
fi
(
  cd web
  WEB_URL="$WEB_URL" ADMIN_URL="$ADMIN_URL" \
    npx playwright "${playwright_args[@]}"
) >"$log_abs" 2>&1
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
