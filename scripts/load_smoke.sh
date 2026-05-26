#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
ADMIN_URL="${ADMIN_URL:-http://localhost:3001}"
REQUESTS="${REQUESTS:-20}"
CONCURRENCY="${CONCURRENCY:-4}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-5}"
LOAD_MODE="${LOAD_MODE:-chat_task}"
DRY_RUN="${DRY_RUN:-0}"
OUT_DIR="${OUT_DIR:-ops/evidence/load/local}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

case "$LOAD_MODE" in
  chat_task)
    PATHS=("/healthz" "/readyz" "/api/v1/tasks/load-smoke")
    EXPECTED=("/healthz:200" "/readyz:200" "/api/v1/tasks/load-smoke:501")
    ;;
  worker_generation)
    PATHS=("/readyz" "/api/v1/tasks/load-smoke" "/api/v1/agent-tasks/load-smoke")
    EXPECTED=("/readyz:200" "/api/v1/tasks/load-smoke:501" "/api/v1/agent-tasks/load-smoke:404")
    ;;
  zip_export)
    PATHS=("/readyz" "/api/v1/exports/load-smoke.zip")
    EXPECTED=("/readyz:200" "/api/v1/exports/load-smoke.zip:404" "/api/v1/exports/load-smoke.zip:501")
    ;;
  signed_download)
    PATHS=("/readyz" "/api/v1/assets/load-smoke/download")
    EXPECTED=("/readyz:200" "/api/v1/assets/load-smoke/download:404" "/api/v1/assets/load-smoke/download:501")
    ;;
  crawler_throttle)
    PATHS=("/readyz" "/api/v1/admin/crawler/sources")
    EXPECTED=("/readyz:200" "/api/v1/admin/crawler/sources:401" "/api/v1/admin/crawler/sources:403" "/api/v1/admin/crawler/sources:501")
    ;;
  quota_contention)
    PATHS=("/readyz" "/api/v1/quota")
    EXPECTED=("/readyz:200" "/api/v1/quota:401" "/api/v1/quota:403" "/api/v1/quota:501")
    ;;
  workspace_rendering)
    PATHS=("/")
    EXPECTED=("/:200" "/:307" "/:308")
    BASE_URL="$WEB_URL"
    ;;
  *)
    printf 'unsupported LOAD_MODE=%s\n' "$LOAD_MODE" >&2
    exit 64
    ;;
esac

write_report() {
  local status="$1"
  mkdir -p "$OUT_DIR"
  local paths_json expected_json
  paths_json="$(printf '%s\n' "${PATHS[@]}" | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')"
  expected_json="$(printf '%s\n' "${EXPECTED[@]}" | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')"
  cat >"$OUT_DIR/${STAMP}-${LOAD_MODE}.json" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "mode": "$LOAD_MODE",
  "status": "$status",
  "base_url": "$BASE_URL",
  "requests": $REQUESTS,
  "concurrency": $CONCURRENCY,
  "paths": $paths_json,
  "expected_statuses": $expected_json
}
JSON
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

fetch() {
  local path="$1"
  local status
  status="$(curl -sS -m "$TIMEOUT_SECONDS" -o /dev/null -w '%{http_code}' "$BASE_URL$path")"
  local expected
  for expected in "${EXPECTED[@]}"; do
    if [[ "$path:$status" == "$expected" ]]; then
      return 0
    fi
  done
  printf 'unexpected status %s for %s%s in mode %s\n' "$status" "$BASE_URL" "$path" "$LOAD_MODE" >&2
  return 1
}

if ! has_cmd curl; then
  printf 'curl is required for load smoke\n' >&2
  exit 127
fi

printf 'load assumptions: requests=%s concurrency=%s base_url=%s\n' "$REQUESTS" "$CONCURRENCY" "$BASE_URL"

if [[ "$DRY_RUN" == "1" ]]; then
  write_report "planned"
  printf 'load smoke dry-run planned for mode %s\n' "$LOAD_MODE"
  exit 0
fi

preflight_path="${PATHS[0]}"
if ! curl -sS -m "$TIMEOUT_SECONDS" -o /dev/null "$BASE_URL$preflight_path"; then
  printf 'load target is not reachable at %s%s; start the required docker compose service first\n' "$BASE_URL" "$preflight_path" >&2
  write_report "blocked_target_unreachable"
  exit 2
fi

failures=0
for ((i = 1; i <= REQUESTS; i++)); do
  path="${PATHS[$(( (i - 1) % ${#PATHS[@]} ))]}"
  fetch "$path" || failures=$((failures + 1)) &
  if (( i % CONCURRENCY == 0 )); then
    wait || failures=$((failures + 1))
  fi
done
wait || failures=$((failures + 1))

if (( failures > 0 )); then
  printf 'load smoke failed with %s failed request groups\n' "$failures" >&2
  write_report "failed"
  exit 1
fi

write_report "passed"
printf 'load smoke passed\n'
