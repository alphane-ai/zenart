#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
REQUESTS="${REQUESTS:-20}"
CONCURRENCY="${CONCURRENCY:-4}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-5}"
PATHS=(
  "/healthz"
  "/readyz"
  "/api/v1/tasks/load-smoke"
)

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

fetch() {
  local path="$1"
  local status
  status="$(curl -sS -m "$TIMEOUT_SECONDS" -o /dev/null -w '%{http_code}' "$BASE_URL$path")"
  case "$path:$status" in
    /healthz:200|/readyz:200|/api/v1/tasks/load-smoke:501)
      return 0
      ;;
    *)
      printf 'unexpected status %s for %s%s\n' "$status" "$BASE_URL" "$path" >&2
      return 1
      ;;
  esac
}

if ! has_cmd curl; then
  printf 'curl is required for load smoke\n' >&2
  exit 127
fi

printf 'load assumptions: requests=%s concurrency=%s base_url=%s\n' "$REQUESTS" "$CONCURRENCY" "$BASE_URL"

if ! curl -sS -m "$TIMEOUT_SECONDS" -o /dev/null "$BASE_URL/healthz"; then
  printf 'backend is not reachable at %s; start it with docker compose up backend first\n' "$BASE_URL" >&2
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
  exit 1
fi

printf 'load smoke passed\n'
