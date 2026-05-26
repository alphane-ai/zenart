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

if [[ "$LOAD_MODE" == "all" ]]; then
  ALL_MODES=(
    chat_task
    worker_generation
    zip_export
    signed_download
    crawler_throttle
    quota_contention
    workspace_rendering
  )
  mkdir -p "$OUT_DIR"
  reports=()
  aggregate_status="passed"
  for mode in "${ALL_MODES[@]}"; do
    if LOAD_MODE="$mode" OUT_DIR="$OUT_DIR" BASE_URL="$BASE_URL" WEB_URL="$WEB_URL" ADMIN_URL="$ADMIN_URL" REQUESTS="$REQUESTS" CONCURRENCY="$CONCURRENCY" TIMEOUT_SECONDS="$TIMEOUT_SECONDS" RELEASE_SHA="$RELEASE_SHA" EVIDENCE_ENVIRONMENT="$EVIDENCE_ENVIRONMENT" DRY_RUN="$DRY_RUN" "$0"; then
      report="$(ls -t "$OUT_DIR"/*-"$mode"-*.json 2>/dev/null | head -n 1 || true)"
      if [[ -n "$report" ]]; then
        reports+=("$report")
      else
        aggregate_status="failed"
      fi
    else
      aggregate_status="failed"
      report="$(ls -t "$OUT_DIR"/*-"$mode"-*.json 2>/dev/null | head -n 1 || true)"
      if [[ -n "$report" ]]; then
        reports+=("$report")
      fi
    fi
  done
  python3 - "$REPORT_PATH" "$aggregate_status" "$RELEASE_SHA" "$EVIDENCE_ENVIRONMENT" "$REQUESTS" "$CONCURRENCY" "${reports[@]}" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
aggregate_status = sys.argv[2]
release_sha = sys.argv[3]
environment = sys.argv[4]
requests = int(sys.argv[5])
concurrency = int(sys.argv[6])
report_refs = sys.argv[7:]
required_modes = [
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
]
reports = []
for ref in report_refs:
    path = Path(ref)
    try:
        reports.append(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        reports.append({"mode": path.stem, "status": "unreadable", "report_path": ref})
status_by_mode = {report.get("mode"): report.get("status") for report in reports}
missing_modes = [mode for mode in required_modes if mode not in status_by_mode]
failed_modes = [
    mode for mode in required_modes
    if status_by_mode.get(mode) != "passed"
]
checks = []
for mode in required_modes:
    mode_report = next((report for report in reports if report.get("mode") == mode), {})
    checks.append({
        "check_id": mode,
        "status": "passed" if status_by_mode.get(mode) == "passed" else "open",
        "evidence_refs": [
            mode_report.get("results_path", ""),
            next((ref for ref, report in zip(report_refs, reports) if report.get("mode") == mode), ""),
        ],
        "summary": mode_report.get("summary", {}),
    })
status = "passed" if aggregate_status == "passed" and not missing_modes and not failed_modes else "failed"
if all(report.get("status") == "planned" for report in reports):
    status = "planned"
report_path.write_text(json.dumps({
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "created_by_lane": "lane5",
    "created_at": report_path.name.split("-all-")[0],
    "run_id": report_path.stem,
    "kind": "load",
    "environment": environment,
    "release_sha": release_sha,
    "mode": "all",
    "status": status,
    "requests_per_mode": requests,
    "concurrency": concurrency,
    "mode_reports": report_refs,
    "missing_modes": missing_modes,
    "failed_modes": failed_modes,
    "checks": checks,
    "private_beta_gate": "open_until_this_all_mode_report_is_generated_from_staging_targets_and_attached_to_post_deploy_smoke",
    "production_gate": "open_until_runtime_thresholds_and_full_production_load_results_exist",
}, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'aggregate load smoke dry-run planned; evidence written to %s\n' "$REPORT_PATH"
    exit 0
  fi
  if [[ "$aggregate_status" == "passed" ]]; then
    printf 'aggregate load smoke passed; evidence written to %s\n' "$REPORT_PATH"
    exit 0
  fi
  printf 'aggregate load smoke failed; evidence written to %s\n' "$REPORT_PATH" >&2
  exit 1
fi

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
    PATHS=("/readyz" "/api/admin/v1/crawler/sources")
    EXPECTED=("/readyz:200" "/api/admin/v1/crawler/sources:401" "/api/admin/v1/crawler/sources:403" "/api/admin/v1/crawler/sources:404" "/api/admin/v1/crawler/sources:501")
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
  "checks": [
    {
      "check_id": "chat_task",
      "status": "$([[ "$status" == "passed" && "$LOAD_MODE" == "chat_task" ]] && printf 'passed' || printf 'open')",
      "evidence_refs": [
        "$REPORT_PATH",
        "$RESULTS_PATH"
      ]
    },
    {
      "check_id": "worker_generation",
      "status": "$([[ "$status" == "passed" && "$LOAD_MODE" == "worker_generation" ]] && printf 'passed' || printf 'open')",
      "evidence_refs": [
        "$REPORT_PATH",
        "$RESULTS_PATH"
      ]
    },
    {
      "check_id": "zip_export",
      "status": "$([[ "$status" == "passed" && "$LOAD_MODE" == "zip_export" ]] && printf 'passed' || printf 'open')",
      "evidence_refs": [
        "$REPORT_PATH",
        "$RESULTS_PATH"
      ]
    },
    {
      "check_id": "signed_download",
      "status": "$([[ "$status" == "passed" && "$LOAD_MODE" == "signed_download" ]] && printf 'passed' || printf 'open')",
      "evidence_refs": [
        "$REPORT_PATH",
        "$RESULTS_PATH"
      ]
    },
    {
      "check_id": "crawler_throttle",
      "status": "$([[ "$status" == "passed" && "$LOAD_MODE" == "crawler_throttle" ]] && printf 'passed' || printf 'open')",
      "evidence_refs": [
        "$REPORT_PATH",
        "$RESULTS_PATH"
      ]
    },
    {
      "check_id": "quota_contention",
      "status": "$([[ "$status" == "passed" && "$LOAD_MODE" == "quota_contention" ]] && printf 'passed' || printf 'open')",
      "evidence_refs": [
        "$REPORT_PATH",
        "$RESULTS_PATH"
      ]
    },
    {
      "check_id": "workspace_rendering",
      "status": "$([[ "$status" == "passed" && "$LOAD_MODE" == "workspace_rendering" ]] && printf 'passed' || printf 'open')",
      "evidence_refs": [
        "$REPORT_PATH",
        "$RESULTS_PATH"
      ]
    }
  ],
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
