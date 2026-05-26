#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-${STAGING_BASE_URL:-}}"
WEB_URL="${WEB_URL:-${STAGING_WEB_URL:-}}"
ADMIN_URL="${ADMIN_URL:-${STAGING_ADMIN_URL:-}}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}"
DRY_RUN="${DRY_RUN:-0}"
OUT_DIR="${OUT_DIR:-ops/evidence/staging-smoke}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${STAMP}-staging-smoke-$$"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"
RESULTS_PATH="$OUT_DIR/${RUN_ID}.ndjson"

write_report() {
  local status="$1"
  mkdir -p "$OUT_DIR"
  local summary
  summary="$(python3 - "$RESULTS_PATH" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
rows = []
if path.exists():
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
print(json.dumps({
    "check_count": len(rows),
    "failure_count": sum(1 for row in rows if not row["ok"]),
    "statuses": {f"{row['name']}:{row['status_code']}": row.get("url") for row in rows},
}, sort_keys=True))
PY
)"
  cat >"$REPORT_PATH" <<JSON
{
  "blueprint_source": "Docs/stage0_blueprint_rev2.md",
  "created_by_lane": "lane5",
  "created_at": "$STAMP",
  "run_id": "$RUN_ID",
  "status": "$status",
  "base_url": "$BASE_URL",
  "web_url": "$WEB_URL",
  "admin_url": "$ADMIN_URL",
  "results_path": "$RESULTS_PATH",
  "summary": $summary,
  "private_beta_gate": "open_until_staging_smoke_runs_against_production_like_postgres_redis_object_storage_observability_and_backups",
  "production_gate": "open_until_post_deploy_smoke_passes_for_approved_release_sha"
}
JSON
}

record_check() {
  local name="$1"
  local url="$2"
  local expected="$3"
  local response status elapsed ok
  response="$(curl -sS -m "$TIMEOUT_SECONDS" -o /dev/null -w '%{http_code} %{time_total}' "$url")" || response="000 0"
  status="${response%% *}"
  elapsed="${response##* }"
  ok=false
  if [[ "$status" == "$expected" ]]; then
    ok=true
  fi
  python3 - "$RESULTS_PATH" "$name" "$url" "$status" "$elapsed" "$ok" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
path.parent.mkdir(parents=True, exist_ok=True)
with path.open("a", encoding="utf-8") as fh:
    fh.write(json.dumps({
        "name": sys.argv[2],
        "url": sys.argv[3],
        "status_code": int(sys.argv[4]) if sys.argv[4].isdigit() else 0,
        "duration_ms": int(round(float(sys.argv[5]) * 1000)),
        "ok": sys.argv[6] == "true",
    }, sort_keys=True) + "\n")
PY
  [[ "$ok" == "true" ]]
}

if [[ "$DRY_RUN" == "1" ]]; then
  rm -f "$RESULTS_PATH"
  write_report "planned"
  printf 'staging smoke dry-run planned\n'
  exit 0
fi

if [[ -z "$BASE_URL" || -z "$WEB_URL" || -z "$ADMIN_URL" ]]; then
  printf 'STAGING_BASE_URL, STAGING_WEB_URL, and STAGING_ADMIN_URL are required\n' >&2
  write_report "blocked_missing_staging_urls"
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  printf 'curl is required for staging smoke\n' >&2
  write_report "blocked_missing_curl"
  exit 127
fi

mkdir -p "$OUT_DIR"
rm -f "$RESULTS_PATH"

failures=0
record_check backend_health "$BASE_URL/healthz" 200 || failures=$((failures + 1))
record_check backend_ready "$BASE_URL/readyz" 200 || failures=$((failures + 1))
record_check web_home "$WEB_URL/" 200 || failures=$((failures + 1))
record_check admin_home "$ADMIN_URL/" 200 || failures=$((failures + 1))

if (( failures > 0 )); then
  write_report "failed"
  printf 'staging smoke failed with %s failed checks\n' "$failures" >&2
  exit 1
fi

write_report "passed"
printf 'staging smoke passed; evidence written to %s\n' "$REPORT_PATH"
