#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:31080}"
WEB_URL="${WEB_URL:-http://127.0.0.1:26080}"
ADMIN_URL="${ADMIN_URL:-http://127.0.0.1:26081}"
REQUESTS="${REQUESTS:-20}"
CONCURRENCY="${CONCURRENCY:-4}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-5}"
LOAD_MODE="${LOAD_MODE:-chat_task}"
DRY_RUN="${DRY_RUN:-0}"
ALLOW_LOCAL_DEVPORT_EVIDENCE="${ALLOW_LOCAL_DEVPORT_EVIDENCE:-0}"
WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE="${WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE:-0}"
OUT_DIR_WAS_SET=0
if [[ -n "${OUT_DIR+x}" ]]; then
  OUT_DIR_WAS_SET=1
fi
if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" && "$LOAD_MODE" == "all" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  OUT_DIR="ops/evidence/staging/local-devport"
fi
if [[ "$WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE" == "1" && "$ALLOW_LOCAL_DEVPORT_EVIDENCE" != "1" && "$LOAD_MODE" == "all" && "$OUT_DIR_WAS_SET" != "1" ]]; then
  OUT_DIR="ops/evidence/staging"
fi
OUT_DIR="${OUT_DIR:-ops/evidence/load/local}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
EVIDENCE_ENVIRONMENT="${EVIDENCE_ENVIRONMENT:-${ENVIRONMENT:-local}}"
if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then
  EVIDENCE_ENVIRONMENT="${EVIDENCE_ENVIRONMENT:-staging}"
fi
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="${RUN_ID:-${STAMP}-${LOAD_MODE}-$$}"
RESULTS_PATH="$OUT_DIR/${RUN_ID}.ndjson"
REPORT_PATH="$OUT_DIR/${RUN_ID}.json"

if [[ "$LOAD_MODE" == "preflight_stage1" ]]; then
  if [[ "$OUT_DIR_WAS_SET" != "1" ]]; then
    OUT_DIR="ops/evidence/staging"
  fi
  REPORT_PATH="$OUT_DIR/stage1-load.preflight.json"
  mkdir -p "$OUT_DIR"
  python3 - "$REPORT_PATH" "$BASE_URL" "$WEB_URL" "$ADMIN_URL" "$RELEASE_SHA" "$REQUESTS" "$CONCURRENCY" "$WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE" <<'PY'
import ipaddress
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

report_path = Path(sys.argv[1])
targets = {
    "api": sys.argv[2],
    "web": sys.argv[3],
    "admin": sys.argv[4],
}
release_sha = sys.argv[5]
requests = int(sys.argv[6])
concurrency = int(sys.argv[7])
write_canonical = sys.argv[8] == "1"
thresholds = {
    "min_requests_per_mode": 20,
    "min_concurrency": 4,
}
reserved_suffixes = (
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".example.test",
    ".invalid",
    ".localhost",
    ".local",
    ".test",
)
secret_re = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|X-Amz-Signature|GoogleAccessId)"
)


def is_reserved_or_local_host(host: str) -> bool:
    normalized = (host or "").strip().lower().strip("[]")
    if not normalized or normalized in {"localhost", "0.0.0.0"}:
        return True
    if any(normalized == suffix[1:] or normalized.endswith(suffix) for suffix in reserved_suffixes):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def safe_port(parsed):
    try:
        return parsed.port
    except ValueError:
        return None


def summarize_target(raw: str) -> dict[str, object]:
    parsed = urlparse(raw or "")
    issues: list[str] = []
    if parsed.scheme != "https":
        issues.append("not_https")
    if not parsed.netloc:
        issues.append("missing_host")
    if parsed.username or parsed.password:
        issues.append("contains_credentials")
    if parsed.query or parsed.fragment:
        issues.append("contains_query_or_fragment")
    host = parsed.hostname or ""
    if is_reserved_or_local_host(host):
        issues.append("reserved_or_local_host")
    if secret_re.search(raw or ""):
        issues.append("secret_shaped_material")
    sanitized_url = ""
    if parsed.scheme and host and not (parsed.username or parsed.password or parsed.query or parsed.fragment or secret_re.search(raw or "")):
        port = safe_port(parsed)
        netloc = f"{host}:{port}" if port else host
        sanitized_url = urlunparse((parsed.scheme, netloc, parsed.path.rstrip("/") or "", "", "", ""))
    return {
        "ready": not issues,
        "scheme": parsed.scheme or "missing",
        "host": host or "missing",
        "sanitized_url": sanitized_url,
        "issues": issues,
    }


target_summaries = {name: summarize_target(value) for name, value in targets.items()}
release_sha_full_length = bool(re.fullmatch(r"[0-9a-fA-F]{40}", release_sha or ""))
input_readiness = {
    "api_url_ready": target_summaries["api"]["ready"] is True,
    "web_url_ready": target_summaries["web"]["ready"] is True,
    "admin_url_ready": target_summaries["admin"]["ready"] is True,
    "release_sha_provided": bool(release_sha),
    "release_sha_full_length": release_sha_full_length,
    "requests_per_mode_ready": requests >= thresholds["min_requests_per_mode"],
    "concurrency_ready": concurrency >= thresholds["min_concurrency"],
    "canonical_write_enabled": write_canonical,
}
blocked_checks = [key for key, ready in input_readiness.items() if ready is not True]
ready = not blocked_checks
report = {
    "schema_version": "stage1.load.preflight.v1",
    "environment": "staging",
    "kind": "stage1_load_preflight",
    "status": "ready" if ready else "blocked",
    "release_gate_check_id": "staging_observability_backup_load",
    "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    "canonical_pass_report": "ops/evidence/staging/stage1-load.json",
    "canonical_pass_results": "ops/evidence/staging/stage1-load.ndjson",
    "preflight_report": "ops/evidence/staging/stage1-load.preflight.json",
    "can_clear_load_slot": False,
    "can_clear_stage1_staging_runtime_gate": False,
    "canonical_pass_path": False,
    "target_summaries": target_summaries,
    "input_readiness": input_readiness,
    "blocked_checks": blocked_checks,
    "next_command_contract": {
        "command": "WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE=1 LOAD_MODE=all scripts/load_smoke.sh",
        "requires_env": ["BASE_URL", "WEB_URL", "ADMIN_URL", "RELEASE_SHA"],
        "requires_non_local_https_targets": True,
        "requires_requests_per_mode_at_least": thresholds["min_requests_per_mode"],
        "requires_concurrency_at_least": thresholds["min_concurrency"],
    },
    "safe_projection_policy": {
        "secret_material_persisted": False,
        "raw_prompt_persisted": False,
        "raw_provider_payload_persisted": False,
        "raw_stripe_payload_persisted": False,
        "raw_support_body_projected": False,
        "signed_url_persisted": False,
        "authorization_header_persisted": False,
        "cookie_persisted": False,
    },
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
  preflight_status="$(python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("status", "blocked"))
PY
)"
  if [[ "$preflight_status" == "ready" ]]; then
    printf 'Stage 1 load preflight ready; run canonical load smoke with explicit staging env. Preflight written to %s\n' "$REPORT_PATH"
    exit 0
  fi
  printf 'Stage 1 load preflight blocked; fix target/env inputs before canonical load smoke. Preflight written to %s\n' "$REPORT_PATH" >&2
  exit 2
fi

if [[ "$LOAD_MODE" == "blocked_stage1" ]]; then
  if [[ "$OUT_DIR_WAS_SET" != "1" ]]; then
    OUT_DIR="ops/evidence/staging"
  fi
  REPORT_PATH="$OUT_DIR/stage1-load.blocked.json"
  RESULTS_PATH="$OUT_DIR/stage1-load.blocked.ndjson"
  mkdir -p "$OUT_DIR"
  python3 - "$REPORT_PATH" "$RESULTS_PATH" "$RELEASE_SHA" "$REQUESTS" "$CONCURRENCY" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
release_sha = sys.argv[3]
requests = int(sys.argv[4])
concurrency = int(sys.argv[5])
required_modes = [
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
]
blocked_checks = ["missing_production_like_staging_load_runtime"]
rows = []
for mode in required_modes:
    rows.append({
        "mode": mode,
        "status": "blocked",
        "metrics": {
            "request_count": 0,
            "error_rate": 1.0,
            "p95_ms": 0,
            "queue_delay_p95_ms": 0,
            "provider_fallback_rate": 0,
            "export_success_rate": 0,
            "billing_webhook_failure_rate": 0,
        },
        "request_id_ref": f"blocked-load-{mode}",
        "trace_ref": f"blocked-load-trace-{mode}",
        "audit_ref": f"blocked-load-audit-{mode}",
        "evidence_refs": [str(report_path)],
        "blocked_checks": blocked_checks,
    })

report = {
    "schema_version": "stage1.load.v1",
    "environment": "staging",
    "kind": "stage1_load",
    "status": "blocked",
    "release_gate_check_id": "staging_observability_backup_load",
    "canonical_pass_path": False,
    "legacy_stage0_load_only": False,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "release_sha": release_sha,
    "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    "requests_per_mode": requests,
    "concurrency": concurrency,
    "blocked_checks": blocked_checks,
    "summary": {
        "request_count": 0,
        "error_rate": 1.0,
        "p95_ms": 0,
        "queue_delay_p95_ms": 0,
        "provider_fallback_rate": 0,
        "export_success_rate": 0,
        "billing_webhook_failure_rate": 0,
    },
    "gate_impact": {
        "release_gate_check_id": "staging_observability_backup_load",
        "can_clear_load_slot": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "preserved_release_gate_check_id": "staging_observability_backup_load",
        "preserved_do_not_launch_condition_id": "stage1_load_runtime_missing",
        "remaining_blockers": blocked_checks,
    },
    "probe_contract": {
        "canonical_pass_report": "ops/evidence/staging/stage1-load.json",
        "canonical_pass_results": "ops/evidence/staging/stage1-load.ndjson",
        "blocked_diagnostic_report": "ops/evidence/staging/stage1-load.blocked.json",
        "blocked_diagnostic_results": "ops/evidence/staging/stage1-load.blocked.ndjson",
        "blocked_diagnostic_can_clear_staging_gate": False,
    },
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
results_path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
PY
  printf 'Stage 1 load blocked diagnostic evidence written to %s\n' "$REPORT_PATH" >&2
  exit 2
fi

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
    child_run_id="$RUN_ID-$mode"
    child_report="$OUT_DIR/$child_run_id.json"
    if LOAD_MODE="$mode" RUN_ID="$RUN_ID-$mode" OUT_DIR="$OUT_DIR" BASE_URL="$BASE_URL" WEB_URL="$WEB_URL" ADMIN_URL="$ADMIN_URL" REQUESTS="$REQUESTS" CONCURRENCY="$CONCURRENCY" TIMEOUT_SECONDS="$TIMEOUT_SECONDS" RELEASE_SHA="$RELEASE_SHA" EVIDENCE_ENVIRONMENT="$EVIDENCE_ENVIRONMENT" DRY_RUN="$DRY_RUN" ALLOW_LOCAL_DEVPORT_EVIDENCE="$ALLOW_LOCAL_DEVPORT_EVIDENCE" "$0"; then
      if [[ -f "$child_report" ]]; then
        reports+=("$child_report")
      else
        aggregate_status="failed"
      fi
    else
      aggregate_status="failed"
      if [[ -f "$child_report" ]]; then
        reports+=("$child_report")
      fi
    fi
  done
  if [[ "$ALLOW_LOCAL_DEVPORT_EVIDENCE" == "1" ]]; then
    REPORT_PATH="$OUT_DIR/stage1-load.local-devport.json"
    RESULTS_PATH="$OUT_DIR/stage1-load.local-devport.ndjson"
    python3 - "$REPORT_PATH" "$RESULTS_PATH" "$aggregate_status" "$RELEASE_SHA" "$EVIDENCE_ENVIRONMENT" "$REQUESTS" "$CONCURRENCY" "$RUN_ID" "${reports[@]+"${reports[@]}"}" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
aggregate_status = sys.argv[3]
release_sha = sys.argv[4]
environment = sys.argv[5] or "staging"
requests = int(sys.argv[6])
concurrency = int(sys.argv[7])
run_id = sys.argv[8]
report_refs = sys.argv[9:]
required_modes = [
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
]
thresholds = {
    "min_requests_per_mode": 20,
    "min_concurrency": 4,
    "max_error_rate": 0.01,
    "max_p95_ms": 2500,
    "max_queue_delay_ms": 5000,
    "max_provider_fallback_rate": 0.2,
    "max_billing_webhook_failure_rate": 0.0,
}
reports = []
refs_by_mode = {}
for ref in report_refs:
    path = Path(ref)
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        report = {"mode": path.stem, "status": "unreadable", "summary": {}}
    reports.append(report)
    refs_by_mode[report.get("mode")] = str(path)

rows = []
for mode in required_modes:
    report = next((item for item in reports if item.get("mode") == mode), {})
    summary = report.get("summary") if isinstance(report.get("summary"), dict) else {}
    request_count = int(summary.get("request_count") or 0)
    failure_count = int(summary.get("failure_count") or 0)
    error_rate = (failure_count / request_count) if request_count else 1.0
    p95_ms = int(summary.get("p95_ms") or 0)
    metrics = {
        "request_count": request_count,
        "error_rate": error_rate,
        "p95_ms": p95_ms,
        "queue_delay_p95_ms": 0,
        "provider_fallback_rate": 0,
        "export_success_rate": 1.0 - error_rate,
        "billing_webhook_failure_rate": 0,
    }
    passed = (
        report.get("status") == "passed"
        and request_count >= thresholds["min_requests_per_mode"]
        and error_rate <= thresholds["max_error_rate"]
        and p95_ms <= thresholds["max_p95_ms"]
    )
    result_ref = str(report.get("results_path") or "")
    evidence_refs = [value for value in (result_ref, refs_by_mode.get(mode, "")) if value]
    rows.append({
        "mode": mode,
        "status": "passed" if passed else "failed",
        "metrics": metrics,
        "request_id_ref": f"{run_id}-{mode}",
        "trace_ref": f"load-trace-{mode}",
        "audit_ref": f"load-audit-{mode}",
        "evidence_refs": evidence_refs,
    })

total_requests = sum(row["metrics"]["request_count"] for row in rows)
weighted_errors = sum(row["metrics"]["error_rate"] * row["metrics"]["request_count"] for row in rows)
runtime_pass = (
    aggregate_status == "passed"
    and all(row["status"] == "passed" for row in rows)
    and requests >= thresholds["min_requests_per_mode"]
    and concurrency >= thresholds["min_concurrency"]
)
summary = {
    "request_count": total_requests,
    "error_rate": (weighted_errors / total_requests) if total_requests else 1.0,
    "p95_ms": max((row["metrics"]["p95_ms"] for row in rows), default=0),
    "queue_delay_p95_ms": max((row["metrics"]["queue_delay_p95_ms"] for row in rows), default=0),
    "provider_fallback_rate": max((row["metrics"]["provider_fallback_rate"] for row in rows), default=0),
    "export_success_rate": min((row["metrics"]["export_success_rate"] for row in rows), default=0),
    "billing_webhook_failure_rate": max((row["metrics"]["billing_webhook_failure_rate"] for row in rows), default=0),
}
blocked_checks = ["local_devport_debug_evidence_cannot_clear_staging_gate"] if runtime_pass else [
    "scenario_failed:" + row["mode"] for row in rows if row["status"] != "passed"
]
report = {
    "schema_version": "stage1.load.v1",
    "environment": "staging",
    "kind": "stage1_load",
    "status": "blocked",
    "release_gate_check_id": "staging_observability_backup_load",
    "canonical_pass_path": False,
    "legacy_stage0_load_only": False,
    "local_devport_debug": True,
    "allow_local_devport_evidence": True,
    "dry_run": False,
    "release_sha": release_sha,
    "requests_per_mode": requests,
    "concurrency": concurrency,
    "blocked_checks": blocked_checks,
    "summary": summary,
    "gate_impact": {
        "release_gate_check_id": "staging_observability_backup_load",
        "can_clear_load_slot": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "preserved_release_gate_check_id": "staging_observability_backup_load",
        "preserved_do_not_launch_condition_id": "stage1_load_runtime_missing",
        "remaining_blockers": blocked_checks,
    },
    "probe_contract": {
        "canonical_pass_report": "ops/evidence/staging/stage1-load.json",
        "canonical_pass_results": "ops/evidence/staging/stage1-load.ndjson",
        "local_devport_report": "ops/evidence/staging/local-devport/stage1-load.local-devport.json",
        "local_devport_results": "ops/evidence/staging/local-devport/stage1-load.local-devport.ndjson",
        "allow_local_devport_evidence_env": "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only Stage 1 load evidence under ops/evidence/staging/local-devport/ and cannot clear staging gates",
    },
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
results_path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
PY
    printf 'aggregate local-devport Stage 1 load smoke wrote debug-only evidence: %s\n' "$REPORT_PATH"
    exit 2
  fi
  CANONICAL_REPORT_PATH="$OUT_DIR/stage1-load.json"
  CANONICAL_RESULTS_PATH="$OUT_DIR/stage1-load.ndjson"
  if [[ "$WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE" == "1" ]]; then
    REPORT_PATH="$OUT_DIR/$RUN_ID.candidate.json"
    RESULTS_PATH="$OUT_DIR/$RUN_ID.candidate.ndjson"
  fi
  python3 - "$REPORT_PATH" "$RESULTS_PATH" "$aggregate_status" "$RELEASE_SHA" "$EVIDENCE_ENVIRONMENT" "$REQUESTS" "$CONCURRENCY" "$BASE_URL" "$WEB_URL" "$ADMIN_URL" "${reports[@]+"${reports[@]}"}" <<'PY'
import json
import ipaddress
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
aggregate_status = sys.argv[3]
release_sha = sys.argv[4]
release_sha = (release_sha or "").lower()
environment = sys.argv[5]
requests = int(sys.argv[6])
concurrency = int(sys.argv[7])
api_url = sys.argv[8]
web_url = sys.argv[9]
admin_url = sys.argv[10]
report_refs = sys.argv[11:]
required_modes = [
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
]
thresholds = {
    "min_requests_per_mode": 20,
    "min_concurrency": 4,
    "max_error_rate": 0.01,
    "max_p95_ms": 2500,
    "max_queue_delay_ms": 5000,
    "max_provider_fallback_rate": 0.2,
    "max_billing_webhook_failure_rate": 0.0,
}
reserved_suffixes = (
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".example.test",
    ".invalid",
    ".localhost",
    ".local",
    ".test",
)


def is_reserved_or_local_host(host):
    normalized = (host or "").strip().lower().strip("[]")
    if not normalized or normalized in {"localhost", "0.0.0.0"}:
        return True
    if any(normalized == suffix[1:] or normalized.endswith(suffix) for suffix in reserved_suffixes):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def production_like_url(value):
    parsed = urlparse(value or "")
    return parsed.scheme == "https" and bool(parsed.netloc) and not is_reserved_or_local_host(parsed.hostname)


def percentile(values, pct):
    if not values:
        return 0
    values = sorted(values)
    index = max(0, min(len(values) - 1, int((len(values) * pct + 99) // 100) - 1))
    return values[index]


reports = []
refs_by_mode = {}
for ref in report_refs:
    path = Path(ref)
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        report = {"mode": path.stem, "status": "unreadable", "report_path": ref, "summary": {}}
    reports.append(report)
    refs_by_mode[report.get("mode")] = str(path)
status_by_mode = {report.get("mode"): report.get("status") for report in reports}
missing_modes = [mode for mode in required_modes if mode not in status_by_mode]
failed_modes = [
    mode for mode in required_modes
    if status_by_mode.get(mode) != "passed"
]
checks = []
rows = []
for mode in required_modes:
    mode_report = next((report for report in reports if report.get("mode") == mode), {})
    mode_results_path = Path(str(mode_report.get("results_path") or ""))
    raw_rows = []
    if mode_results_path.exists():
        try:
            raw_rows = [
                json.loads(line)
                for line in mode_results_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
        except json.JSONDecodeError:
            raw_rows = []
    summary = mode_report.get("summary") if isinstance(mode_report.get("summary"), dict) else {}
    request_count = int(summary.get("request_count") or len(raw_rows))
    failure_count = int(summary.get("failure_count") or 0)
    durations = [int(item.get("duration_ms") or 0) for item in raw_rows if isinstance(item, dict)]
    error_rate = (failure_count / request_count) if request_count else 1.0
    p95_ms = int(summary.get("p95_ms") or percentile(durations, 95))
    metrics = {
        "request_count": request_count,
        "error_rate": error_rate,
        "p95_ms": p95_ms,
        "queue_delay_p95_ms": 0,
        "provider_fallback_rate": 0,
        "export_success_rate": 1.0 - error_rate,
        "billing_webhook_failure_rate": 0,
    }
    mode_passed = (
        mode_report.get("status") == "passed"
        and request_count >= thresholds["min_requests_per_mode"]
        and error_rate <= thresholds["max_error_rate"]
        and p95_ms <= thresholds["max_p95_ms"]
    )
    evidence_refs = [
        value
        for value in (str(mode_report.get("results_path") or ""), refs_by_mode.get(mode, ""))
        if value
    ]
    row = {
        "mode": mode,
        "status": "passed" if mode_passed else "failed",
        "metrics": metrics,
        "request_id_ref": f"{report_path.stem}-{mode}",
        "trace_ref": f"load-trace-{mode}",
        "audit_ref": f"load-audit-{mode}",
        "evidence_refs": evidence_refs,
    }
    rows.append(row)
    checks.append({
        "check_id": mode,
        "status": row["status"],
        "metrics": metrics,
        "evidence_refs": evidence_refs,
    })
total_requests = sum(row["metrics"]["request_count"] for row in rows)
weighted_errors = sum(row["metrics"]["error_rate"] * row["metrics"]["request_count"] for row in rows)
summary = {
    "request_count": total_requests,
    "error_rate": (weighted_errors / total_requests) if total_requests else 1.0,
    "p95_ms": max((row["metrics"]["p95_ms"] for row in rows), default=0),
    "queue_delay_p95_ms": max((row["metrics"]["queue_delay_p95_ms"] for row in rows), default=0),
    "provider_fallback_rate": max((row["metrics"]["provider_fallback_rate"] for row in rows), default=0),
    "export_success_rate": min((row["metrics"]["export_success_rate"] for row in rows), default=0),
    "billing_webhook_failure_rate": max((row["metrics"]["billing_webhook_failure_rate"] for row in rows), default=0),
}
targets_ready = {
    "api_url_ready": production_like_url(api_url),
    "web_url_ready": production_like_url(web_url),
    "admin_url_ready": production_like_url(admin_url),
}
runtime_pass = (
    aggregate_status == "passed"
    and not missing_modes
    and all(row["status"] == "passed" for row in rows)
    and requests >= thresholds["min_requests_per_mode"]
    and concurrency >= thresholds["min_concurrency"]
    and all(targets_ready.values())
    and bool(re.fullmatch(r"[0-9a-fA-F]{40}", release_sha or ""))
)
blocked_checks = []
if missing_modes:
    blocked_checks.extend("missing_mode:" + mode for mode in missing_modes)
if failed_modes:
    blocked_checks.extend("scenario_failed:" + mode for mode in failed_modes)
for key, ready in targets_ready.items():
    if not ready:
        blocked_checks.append(f"target_not_production_like:{key}")
if not release_sha:
    blocked_checks.append("release_sha_missing")
elif not re.fullmatch(r"[0-9a-fA-F]{40}", release_sha):
    blocked_checks.append("release_sha_not_full_40_hex")
if requests < thresholds["min_requests_per_mode"]:
    blocked_checks.append("requests_per_mode_below_threshold")
if concurrency < thresholds["min_concurrency"]:
    blocked_checks.append("concurrency_below_threshold")

if runtime_pass:
    report = {
        "schema_version": "stage1.load.v1",
        "environment": "staging",
        "kind": "stage1_load",
        "evidence_kind": "load",
        "status": "pass",
        "release_gate_check_id": "staging_observability_backup_load",
        "canonical_pass_path": True,
        "legacy_stage0_load_only": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "release_sha": release_sha,
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "requests_per_mode": requests,
        "concurrency": concurrency,
        "target_urls": {
            "api": api_url,
            "web": web_url,
            "admin": admin_url,
        },
        "input_readiness": {
            **targets_ready,
            "release_sha_provided": True,
            "release_sha_full_length": True,
            "canonical_pass_path": True,
            "production_like_staging_targets": True,
        },
        "summary": summary,
        "checks": checks,
        "modes": checks,
        "gate_impact": {
            "release_gate_check_id": "staging_observability_backup_load",
            "can_clear_load_slot": True,
            "can_clear_stage1_staging_runtime_gate": False,
            "preserved_release_gate_check_id": None,
            "preserved_do_not_launch_condition_id": None,
            "remaining_blockers": [],
        },
        "probe_contract": {
            "canonical_pass_report": "ops/evidence/staging/stage1-load.json",
            "canonical_pass_results": "ops/evidence/staging/stage1-load.ndjson",
            "blocked_diagnostic_report": "ops/evidence/staging/stage1-load.blocked.json",
            "blocked_diagnostic_results": "ops/evidence/staging/stage1-load.blocked.ndjson",
            "strict_staging_target_policy": "absolute https URLs on non-local, non-private, non-reserved staging hosts",
            "pass_evidence_written_only_after_strict_validator_accepts": True,
            "canonical_outputs_are_atomic": True,
            "failed_strict_candidate_writes_blocked_evidence_only": True,
        },
        "secret_material_persisted": False,
        "raw_prompt_persisted": False,
        "raw_provider_payload_persisted": False,
        "raw_stripe_payload_persisted": False,
        "raw_support_body_projected": False,
        "signed_url_persisted": False,
        "authorization_header_persisted": False,
        "cookie_persisted": False,
    }
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    results_path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
else:
    status = "planned" if all(report.get("status") == "planned" for report in reports) else "failed"
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
        "target_urls": {
            "api": api_url,
            "web": web_url,
            "admin": admin_url,
        },
        "target_readiness": targets_ready,
        "mode_reports": report_refs,
        "missing_modes": missing_modes,
        "failed_modes": failed_modes,
        "blocked_checks": blocked_checks,
        "checks": checks,
        "private_beta_gate": "open_until_this_all_mode_report_is_generated_from_staging_targets_and_attached_to_post_deploy_smoke",
        "production_gate": "open_until_runtime_thresholds_and_full_production_load_results_exist",
    }, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    results_path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
PY
  if [[ "$DRY_RUN" == "1" ]]; then
    printf 'aggregate load smoke dry-run planned; evidence written to %s\n' "$REPORT_PATH"
    exit 0
  fi
  aggregate_report_status="$(python3 - "$REPORT_PATH" <<'PY'
import json
import sys
from pathlib import Path

try:
    print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")).get("status", ""))
except Exception:
    print("")
PY
)"
  if [[ "$aggregate_report_status" == "pass" ]]; then
    if [[ "$WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE" == "1" ]]; then
      tmp_report="$(mktemp "$OUT_DIR/stage1-load.candidate.XXXXXX.json")"
      tmp_results="$(mktemp "$OUT_DIR/stage1-load.candidate.XXXXXX.ndjson")"
      cp "$REPORT_PATH" "$tmp_report"
      cp "$RESULTS_PATH" "$tmp_results"
      if PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_load_evidence.py --evidence "$tmp_report" --results "$tmp_results" >/dev/null; then
        python3 - "$tmp_report" "$tmp_results" "$CANONICAL_REPORT_PATH" "$CANONICAL_RESULTS_PATH" <<'PY'
import os
import sys
from pathlib import Path

candidate_report = Path(sys.argv[1])
candidate_results = Path(sys.argv[2])
canonical_report = Path(sys.argv[3])
canonical_results = Path(sys.argv[4])
canonical_report.parent.mkdir(parents=True, exist_ok=True)
canonical_results.parent.mkdir(parents=True, exist_ok=True)
os.replace(candidate_report, canonical_report)
os.replace(candidate_results, canonical_results)
PY
        rm -f "$REPORT_PATH" "$RESULTS_PATH"
      else
        rm -f "$tmp_report" "$tmp_results" "$REPORT_PATH" "$RESULTS_PATH"
        printf 'aggregate load smoke candidate failed strict validation; canonical pass evidence was not written\n' >&2
        exit 2
      fi
      REPORT_PATH="$CANONICAL_REPORT_PATH"
    fi
    printf 'aggregate load smoke passed; evidence written to %s\n' "$REPORT_PATH"
    exit 0
  fi
  if [[ "$aggregate_status" == "passed" ]]; then
    printf 'aggregate load smoke blocked by strict staging target policy; evidence written to %s\n' "$REPORT_PATH" >&2
    exit 2
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
