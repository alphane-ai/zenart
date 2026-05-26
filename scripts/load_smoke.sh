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
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
EVIDENCE_ENVIRONMENT="${EVIDENCE_ENVIRONMENT:-${ENVIRONMENT:-local}}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-${LOAD_MODE}-$$"
RESULTS_PATH="$OUT_DIR/${RUN_ID}.ndjson"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"

case "$LOAD_MODE" in
  chat_task)
    PATHS=("/healthz" "/readyz" "/api/v1/tasks/load-smoke")
    EXPECTED=("/healthz:200" "/readyz:200" "/api/v1/tasks/load-smoke:401" "/api/v1/tasks/load-smoke:501")
    ;;
  worker_generation)
    PATHS=("/readyz" "/api/v1/tasks/load-smoke" "/api/v1/agent-tasks/load-smoke")
    EXPECTED=("/readyz:200" "/api/v1/tasks/load-smoke:401" "/api/v1/tasks/load-smoke:501" "/api/v1/agent-tasks/load-smoke:404")
    ;;
  zip_export)
    PATHS=("/readyz" "/api/v1/exports/load-smoke.zip")
    EXPECTED=("/readyz:200" "/api/v1/exports/load-smoke.zip:401" "/api/v1/exports/load-smoke.zip:404" "/api/v1/exports/load-smoke.zip:501")
    ;;
  signed_download)
    PATHS=("/readyz" "/api/v1/assets/load-smoke/download")
    EXPECTED=("/readyz:200" "/api/v1/assets/load-smoke/download:404" "/api/v1/assets/load-smoke/download:501")
    ;;
  crawler_throttle)
    PATHS=("/readyz" "/api/v1/admin/crawler/sources")
    EXPECTED=("/readyz:200" "/api/v1/admin/crawler/sources:401" "/api/v1/admin/crawler/sources:403" "/api/v1/admin/crawler/sources:404" "/api/v1/admin/crawler/sources:501")
    ;;
  quota_contention)
    PATHS=("/readyz" "/api/v1/quota")
    EXPECTED=("/readyz:200" "/api/v1/quota:401" "/api/v1/quota:403" "/api/v1/quota:404" "/api/v1/quota:501")
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
  local paths_json expected_json summary_json
  paths_json="$(printf '%s\n' "${PATHS[@]}" | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')"
  expected_json="$(printf '%s\n' "${EXPECTED[@]}" | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')"
  summary_json="$(python3 - "$RESULTS_PATH" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
if not path.exists():
    print(json.dumps({
        "request_count": 0,
        "failure_count": 0,
        "p50_ms": None,
        "p95_ms": None,
        "max_ms": None,
        "statuses": {},
    }))
    raise SystemExit

rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
durations = sorted(row["duration_ms"] for row in rows)
statuses = {}
for row in rows:
    key = f"{row['path']}:{row['status_code']}"
    statuses[key] = statuses.get(key, 0) + 1

def percentile(values, pct):
    if not values:
        return None
    index = max(0, min(len(values) - 1, int((len(values) * pct + 99) // 100) - 1))
    return values[index]

print(json.dumps({
    "request_count": len(rows),
    "failure_count": sum(1 for row in rows if not row["ok"]),
    "p50_ms": percentile(durations, 50),
    "p95_ms": percentile(durations, 95),
    "max_ms": durations[-1] if durations else None,
    "statuses": statuses,
}, sort_keys=True))
PY
)"
  cat >"$REPORT_PATH" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "run_id": "$RUN_ID",
  "kind": "load",
  "environment": "$EVIDENCE_ENVIRONMENT",
  "release_sha": "$RELEASE_SHA",
  "mode": "$LOAD_MODE",
  "status": "$status",
  "base_url": "$BASE_URL",
  "requests": $REQUESTS,
  "concurrency": $CONCURRENCY,
  "paths": $paths_json,
  "expected_statuses": $expected_json,
  "results_path": "$RESULTS_PATH",
  "summary": $summary_json,
  "production_gate": "open_until_runtime_thresholds_and_full_staging_load_results_exist"
}
JSON
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

wait_batch() {
  local pid
  local batch_failures=0
  for pid in "$@"; do
    if ! wait "$pid"; then
      batch_failures=$((batch_failures + 1))
    fi
  done
  return "$batch_failures"
}

fetch() {
  local path="$1"
  local response status elapsed duration_ms ok
  response="$(curl -sS -m "$TIMEOUT_SECONDS" -o /dev/null -w '%{http_code} %{time_total}' "$BASE_URL$path")" || response="000 0"
  status="${response%% *}"
  elapsed="${response##* }"
  duration_ms="$(python3 - "$elapsed" <<'PY'
import sys
print(int(round(float(sys.argv[1]) * 1000)))
PY
)"
  ok=false
  local expected
  for expected in "${EXPECTED[@]}"; do
    if [[ "$path:$status" == "$expected" ]]; then
      ok=true
      break
    fi
  done
  python3 - "$RESULTS_PATH" "$path" "$status" "$duration_ms" "$ok" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
with path.open("a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "path": sys.argv[2],
        "status_code": int(sys.argv[3]) if sys.argv[3].isdigit() else 0,
        "duration_ms": int(sys.argv[4]),
        "ok": sys.argv[5] == "true",
    }, sort_keys=True) + "\n")
PY
  if [[ "$ok" == "true" ]]; then
    return 0
  fi
  printf 'unexpected status %s for %s%s in mode %s\n' "$status" "$BASE_URL" "$path" "$LOAD_MODE" >&2
  return 1
}

if ! has_cmd curl; then
  printf 'curl is required for load smoke\n' >&2
  exit 127
fi

printf 'load assumptions: requests=%s concurrency=%s base_url=%s\n' "$REQUESTS" "$CONCURRENCY" "$BASE_URL"

if [[ "$DRY_RUN" == "1" ]]; then
  rm -f "$RESULTS_PATH"
  write_report "planned"
  printf 'load smoke dry-run planned for mode %s\n' "$LOAD_MODE"
  exit 0
fi

mkdir -p "$OUT_DIR"
rm -f "$RESULTS_PATH"

preflight_path="${PATHS[0]}"
if ! curl -sS -m "$TIMEOUT_SECONDS" -o /dev/null "$BASE_URL$preflight_path"; then
  printf 'load target is not reachable at %s%s; start the required docker compose service first\n' "$BASE_URL" "$preflight_path" >&2
  write_report "blocked_target_unreachable"
  exit 2
fi

failures=0
pids=()
for ((i = 1; i <= REQUESTS; i++)); do
  path="${PATHS[$(( (i - 1) % ${#PATHS[@]} ))]}"
  fetch "$path" &
  pids+=("$!")
  if (( i % CONCURRENCY == 0 )); then
    wait_batch "${pids[@]}" || failures=$((failures + $?))
    pids=()
  fi
done
if (( ${#pids[@]} > 0 )); then
  wait_batch "${pids[@]}" || failures=$((failures + $?))
fi

if (( failures > 0 )); then
  printf 'load smoke failed with %s failed request groups\n' "$failures" >&2
  write_report "failed"
  exit 1
fi

write_report "passed"
printf 'load smoke passed\n'
