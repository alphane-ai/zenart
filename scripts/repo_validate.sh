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
test -f ops/release/stage0_rev2_current_no_go_release_notes.md
test -x scripts/load_smoke.sh
test -x scripts/backup_restore_drill.sh
test -x scripts/playwright_smoke.sh
test -x scripts/docker_build_smoke.sh
test -x scripts/staging_smoke.sh
test -x scripts/observability_smoke.sh
test -x scripts/staging_observability_backup_load_smoke.sh
test -x scripts/staging_object_storage_signed_url_smoke.sh
test -x scripts/staging_object_storage_retention_cleanup_smoke.sh
test -x scripts/staging_legal_support_visibility_smoke.sh
test -x scripts/production_backup_rollback_split_smoke.sh
test -x scripts/security_scan_smoke.sh
test -x scripts/release_evidence_bundle_smoke.sh
test -x scripts/render_no_go_release_notes.py
test -x scripts/run_workflow_api_smoke.py
test -x scripts/validate_workflow_api_smoke_evidence.py

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
observability_evidence = json.loads(Path("ops/evidence/stage0_observability_evidence.json").read_text(encoding="utf-8"))

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
signals = {signal["name"]: signal["runtime_status"] for signal in observability_evidence["signals"]}
for signal in (
    "request_id_propagation",
    "structured_json_logs",
    "opentelemetry_traces",
    "backend_worker_crawler_metrics",
    "dashboards",
    "alerts",
):
    if signals.get(signal) != "staging_validated":
        raise SystemExit(f"{signal} evidence must be staging_validated")
open_items = set(observability_evidence.get("open_items", []))
for open_item in (
    "staging_backup_restore_runtime_evidence",
    "staging_load_runtime_evidence",
    "staging_post_deploy_smoke_runtime_evidence",
    "production_release_observability_runtime_evidence",
):
    if open_item not in open_items:
        raise SystemExit(f"observability evidence must preserve open item {open_item}")
for closed_item in (
    "staging_request_id_propagation_across_web_admin_backend_worker_crawler_logs_metrics_traces",
    "staging_structured_json_log_capture_with_request_id_user_id_tenant_id_route_status_latency",
    "worker_crawler_domain_metrics_and_staging_backend_metrics_runtime_capture",
    "staging_dashboard_import_and_runtime_data",
    "staging_alert_routes_and_threshold_evaluations",
):
    if closed_item in open_items:
        raise SystemExit(f"observability evidence must not preserve closed staging item {closed_item}")
PY

log "release no-go evidence validation"
python3 scripts/render_no_go_release_notes.py --check
release_bundle_tmp="$(mktemp -d)"
trap 'rm -rf "$release_bundle_tmp"' EXIT
if OUT_DIR="$release_bundle_tmp" DRY_RUN=1 scripts/release_evidence_bundle_smoke.sh >/tmp/stage0-release-bundle-smoke.out 2>/tmp/stage0-release-bundle-smoke.err; then
  printf 'release evidence bundle dry-run unexpectedly returned go\n' >&2
  cat /tmp/stage0-release-bundle-smoke.out >&2
  cat /tmp/stage0-release-bundle-smoke.err >&2
  exit 1
fi
python3 - "$release_bundle_tmp" <<'PY'
import json
import sys
from pathlib import Path

out_dir = Path(sys.argv[1])
reports = [
    path
    for path in sorted(out_dir.glob("*-release-evidence-bundle-*.json"))
    if json.loads(path.read_text(encoding="utf-8")).get("kind") == "release_evidence_bundle"
]
if len(reports) != 1:
    raise SystemExit(f"expected one release bundle report, found {len(reports)}")
report = json.loads(reports[0].read_text(encoding="utf-8"))
source_report = Path(report["source_staging_smoke_report"])
source_results = Path(report["source_staging_smoke_results"])
if report["status"] != "blocked" or report["decision"] != "no-go":
    raise SystemExit("release evidence bundle dry-run must remain blocked/no-go")
if not source_report.exists() or source_report.parent != out_dir:
    raise SystemExit("release bundle must promote nested staging smoke report into OUT_DIR")
if not source_results.exists() or source_results.parent != out_dir:
    raise SystemExit("release bundle must promote nested staging smoke NDJSON into OUT_DIR")
object_retention_probe = report.get("object_retention_cleanup_probe", {})
if object_retention_probe.get("status") != "blocked":
    raise SystemExit("release bundle dry-run must surface blocked object-retention cleanup status")
if set(object_retention_probe.get("required_checks", [])) != {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}:
    raise SystemExit("release bundle dry-run must surface object-retention required checks")
runtime_requirements = object_retention_probe.get("runtime_input_requirements", {})
if runtime_requirements.get("required_release_sha") != "d3b1107c33dc40b8936f28549e06553fbd7b104a":
    raise SystemExit("release bundle dry-run must surface required object-retention release SHA")
if runtime_requirements.get("required_base_url") != "STAGING_BASE_URL or explicit probe URL env vars":
    raise SystemExit("release bundle dry-run must surface staging URL requirement for object-retention probe")
if "ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE" not in runtime_requirements.get("required_auth", ""):
    raise SystemExit("release bundle dry-run must surface admin auth requirement for object-retention probe")
if "SMOKE_ADMIN_USER_ID" not in runtime_requirements.get("required_smoke_admin_user_id", ""):
    raise SystemExit("release bundle dry-run must surface admin user requirement for object-retention probe")
if "SMOKE_ADMIN_TENANT_ID" not in runtime_requirements.get("required_smoke_admin_tenant_id", ""):
    raise SystemExit("release bundle dry-run must surface admin tenant requirement for object-retention probe")
if "X-Request-ID" not in runtime_requirements.get("required_request_id_echo", ""):
    raise SystemExit("release bundle dry-run must surface request-id echo requirement for object-retention probe")
if runtime_requirements.get("canonical_pass_report") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit("release bundle dry-run must surface canonical object-retention pass report path")
split_evidence = object_retention_probe.get("split_evidence", {})
if split_evidence.get("signed_url_ready") is not True:
    raise SystemExit("release bundle dry-run must surface signed URL split readiness")
if split_evidence.get("retention_cleanup_ready") is not False:
    raise SystemExit("release bundle dry-run must keep retention cleanup readiness false")
if report.get("blocking_reason_count") != len(report.get("blocking_reasons", [])):
    raise SystemExit("release bundle blocking_reason_count must match blocking_reasons length")
decision_inputs = report.get("decision_inputs", {})
if decision_inputs.get("gate_fixtures_clear") is not False:
    raise SystemExit("release bundle dry-run must preserve blocked gate fixture context")
PY
python3 - <<'PY'
import json
from pathlib import Path

private_beta = json.loads(Path("fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json").read_text(encoding="utf-8"))
production = json.loads(Path("fixtures/stage0/rev2/release_gate_evidence.production_launch.json").read_text(encoding="utf-8"))
notes = Path("ops/release/stage0_rev2_current_no_go_release_notes.md").read_text(encoding="utf-8")
required_fragments = [
    "Release gate status: `no-go`.",
    "- Decision: `no-go`",
    "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
    "Staging smoke: staging status `passed` from `ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json` with 10/10 smoke categories passed; staging post-deploy smoke is validator-visible through combined preflight `passed` from `ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json` for release `d3b1107c33dc40b8936f28549e06553fbd7b104a` with 4/4 slots verified, but the private beta gate remains `no-go` while object retention/cleanup remains blocked.",
    "Config diff: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=config_diff`, and record status `passed`, `reviewed`, or `no_diff` before private beta/production decisions.",
    "Observability smoke: local status `passed` from `ops/evidence/observability/local/20260526T192311Z-observability-smoke-7780.json`; staging status `passed` from `ops/evidence/staging/20260527T1830Z-observability-runtime.json` with 6/6 required signals validator-visible; combined preflight `passed` from `ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json` for release `d3b1107c33dc40b8936f28549e06553fbd7b104a` with 4/4 slots verified.",
    "Backup/restore drill: local status `passed` from `ops/evidence/backup-restore/local/20260526T153126Z/report.json`; staging status `passed` from `ops/evidence/staging/20260527T2115Z-backup-restore.json` with 2/2 restore drills passed; production backup/restore evidence remains separate and required before production decisions.",
    "Load evidence: staging status `passed` from `ops/evidence/staging/20260527T2120Z-load.json` with 7/7 load modes passed; production load evidence remains separate and required before production decisions.",
    "Rollback drill: `missing`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=rollback`, record status `passed` or `validated`, and include passed/validated evidence refs for image rollback, feature flag rollback, migration compatibility, worker drain, and post-rollback smoke.",
    "Security scan: local status `passed` from `ops/evidence/security/local/20260526T142040Z-security-scan-smoke-65314.json`; staging JSON must reference the release SHA, set `environment=staging`, set `kind=security_scan`, record status `passed`, and include passed/validated evidence refs for dependency, image/container, and committed-secret scans before private beta/production decisions.",
    "Object-storage signed URL: staging status `pass_with_blockers_preserved` from `ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json` with 4/4 signed URL probes validator-visible; retention/cleanup evidence still required; object retention policy, expired export cleanup, orphan cleanup, and audit refs remain required before the object-storage gate can close.",
    "Object-storage retention cleanup: `blocked` from `ops/evidence/staging/object-storage-retention-cleanup.blocked.json` with 4/4 probes blocked by missing STAGING_BASE_URL or explicit retention/audit probe URLs; canonical pass evidence is still missing at `ops/evidence/staging/object-storage-retention-cleanup.json`, so the object-storage gate remains open.",
    "Legal/support external-user visibility: staging split status `pass,pass` from `ops/evidence/staging/legal-pages-external-user.json` and `ops/evidence/staging/support-contact-external-user.json`; external-user legal/support visibility is validator-visible.",
    "Object storage changes: staging signed URL evidence is attached; staging retention/cleanup pass evidence remains required before the object-storage gate can close.",
    "Operational risks: staging rollback evidence remains absent; staging backup/restore, load, post-deploy smoke, and legal/support visibility evidence are attached, but object-retention, CI, and production gates remain open.",
    "Object-storage risks: signed URL staging evidence is attached, but retention/cleanup runtime evidence still blocks the object-storage release gate.",
    "Conditions: CI installed workflow evidence, object retention cleanup evidence, staging migration/config/rollback/security evidence, production deployment evidence, release owner, and gate fixture blockers must be cleared before any private beta or production decision.",
    "## Open Rev2 Runtime Checklist",
    "CI and staging runtime open target rows:",
    "Release gate runtime open target rows:",
    "These are blueprint checklist labels that remain unchecked, not satisfied release evidence.",
    "Private Beta/Staging external-user runtime evidence 通过",
]
missing = [fragment for fragment in required_fragments if fragment not in notes]
if missing:
    raise SystemExit(f"release no-go notes missing required fragments: {missing}")
blocked_retention_path = Path("ops/evidence/staging/object-storage-retention-cleanup.blocked.json")
canonical_retention_path = Path("ops/evidence/staging/object-storage-retention-cleanup.json")
if not blocked_retention_path.exists():
    raise SystemExit("blocked object-storage retention cleanup evidence must exist after the staging probe attempt")
if canonical_retention_path.exists():
    raise SystemExit("canonical object-storage retention cleanup pass evidence must not exist while the gate is blocked")
blocked_retention = json.loads(blocked_retention_path.read_text(encoding="utf-8"))
if blocked_retention.get("status") != "blocked":
    raise SystemExit("blocked object-storage retention cleanup evidence must keep status=blocked")
if blocked_retention.get("release_gate_check_id") != "staging_object_storage_signed_downloads":
    raise SystemExit("blocked object-storage retention cleanup evidence must target staging_object_storage_signed_downloads")
if blocked_retention.get("gate_impact", {}).get("can_clear_release_gate_check") is not False:
    raise SystemExit("blocked object-storage retention cleanup evidence must not clear the object-storage gate")
if set(blocked_retention.get("required_checks", [])) != {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}:
    raise SystemExit("blocked object-storage retention cleanup evidence must retain all required probes")
runtime_requirements = blocked_retention.get("runtime_input_requirements", {})
if runtime_requirements.get("required_release_sha") != "d3b1107c33dc40b8936f28549e06553fbd7b104a":
    raise SystemExit("blocked object-storage retention cleanup evidence must name the signed URL release SHA required for pass evidence")
if "admin_operator" not in runtime_requirements.get("required_auth", ""):
    raise SystemExit("blocked object-storage retention cleanup evidence must name admin_operator auth requirement")
if "SMOKE_ADMIN_USER_ID" not in runtime_requirements.get("required_smoke_admin_user_id", ""):
    raise SystemExit("blocked object-storage retention cleanup evidence must name the smoke admin user ID requirement")
if "SMOKE_ADMIN_TENANT_ID" not in runtime_requirements.get("required_smoke_admin_tenant_id", ""):
    raise SystemExit("blocked object-storage retention cleanup evidence must name the smoke admin tenant ID requirement")
if "X-Request-ID" not in runtime_requirements.get("required_request_id_echo", ""):
    raise SystemExit("blocked object-storage retention cleanup evidence must name the request-id echo requirement")
if runtime_requirements.get("canonical_pass_report") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit("blocked object-storage retention cleanup evidence must name the canonical pass report path")
if "canonical pass paths" not in runtime_requirements.get("pass_file_policy", ""):
    raise SystemExit("blocked object-storage retention cleanup evidence must describe canonical pass-file policy")
probe_routes = runtime_requirements.get("required_probe_routes", {})
expected_probe_routes = {
    "retention_policy": ("GET", "RETENTION_POLICY_URL", "/api/admin/v1/object-storage/retention-policy"),
    "expired_export_cleanup": ("POST", "EXPIRED_EXPORT_CLEANUP_URL", "/api/admin/v1/object-storage/cleanup/expired-exports"),
    "orphan_cleanup": ("POST", "ORPHAN_CLEANUP_URL", "/api/admin/v1/object-storage/cleanup/orphans"),
    "audit_refs": ("GET", "AUDIT_REFS_URL", "/api/admin/v1/audit?subject=object_storage_cleanup&limit=20"),
}
for probe_id, (method, env_var, default_path) in expected_probe_routes.items():
    route = probe_routes.get(probe_id, {})
    if route.get("method") != method or route.get("env_var") != env_var or route.get("default_path") != default_path:
        raise SystemExit(f"blocked object-storage retention cleanup evidence missing route contract for {probe_id}: {route}")
if any("missing_staging_base_url_or_explicit_probe_urls" not in item for item in blocked_retention.get("blocked_checks", [])):
    raise SystemExit("blocked object-storage retention cleanup evidence must explain the missing staging probe URLs")
if blocked_retention.get("split_evidence", {}).get("canonical_pass_paths") is not False:
    raise SystemExit("blocked object-storage retention cleanup evidence must not claim canonical pass paths")
for item in blocked_retention.get("coverage", []):
    for key in ("release_sha_bound", "admin_identity_bound", "request_ids", "response_bytes"):
        if key not in item:
            raise SystemExit(f"blocked object-storage retention cleanup coverage missing {key}: {item}")
    for result in item.get("source_results", []):
        if "request_id_echoed" not in result or "response_request_id_values" not in result:
            raise SystemExit(f"blocked object-storage retention cleanup result missing request-id echo fields: {result}")
obsolete_fragments = [
    "Observability runtime: staging request id propagation runtime evidence 通过",
    "staging observability, restore, rollback, load, and post-deploy smoke evidence are absent",
    "observability runtime evidence, restore/rollback evidence",
]
obsolete = [fragment for fragment in obsolete_fragments if fragment in notes]
if obsolete:
    raise SystemExit(f"release no-go notes list already-closed runtime fragments as open: {obsolete}")
if notes.count("- Load evidence:") != 1:
    raise SystemExit("release no-go notes must contain exactly one Load evidence line")
if notes.count("- Load smoke:") != 1:
    raise SystemExit("release no-go notes must contain exactly one local Load smoke summary line")

def fixture_blockers(gate):
    return [
        str(check.get("check_id", "unknown_check"))
        for check in gate.get("checks", [])
        if check.get("status") not in {"pass", "passed"}
    ]

def present_do_not_launch(gate):
    return [
        str(check.get("condition_id", "unknown_condition"))
        for check in gate.get("do_not_launch_checks", [])
        if check.get("is_present") is True
    ]

def assert_line_matches(label, path, values):
    expected = f"- {label}: `{path}`: {', '.join(values) if values else 'none recorded'}."
    if expected not in notes:
        raise SystemExit(f"release no-go notes drifted from fixture decision; expected line: {expected}")

def assert_condition_line_matches(label, values):
    expected = f"- {label}: {', '.join(values) if values else 'none recorded'}."
    if expected not in notes:
        raise SystemExit(f"release no-go notes drifted from fixture decision; expected line: {expected}")

assert_line_matches(
    "Open private beta blockers",
    "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    fixture_blockers(private_beta),
)
assert_condition_line_matches(
    "Private beta do-not-launch conditions present",
    present_do_not_launch(private_beta),
)
assert_line_matches(
    "Open production blockers",
    "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
    fixture_blockers(production),
)
assert_condition_line_matches(
    "Production do-not-launch conditions present",
    present_do_not_launch(production),
)

template = Path("ops/release/release_notes_template.md").read_text(encoding="utf-8")
if template.count("- Load evidence:") != 1:
    raise SystemExit("release notes template must contain exactly one Load evidence slot")
if template.count("- Load smoke run:") != 1:
    raise SystemExit("release notes template must contain exactly one Load smoke run slot")
if template.count("- Object-storage signed URL evidence:") != 1:
    raise SystemExit("release notes template must contain exactly one object-storage signed URL evidence slot")
if template.count("- Object-storage retention cleanup evidence:") != 1:
    raise SystemExit("release notes template must contain exactly one object-storage retention cleanup evidence slot")
if template.count("- Legal/support external-user visibility evidence:") != 1:
    raise SystemExit("release notes template must contain exactly one legal/support external-user visibility evidence slot")
for token in (
    "release_gate_check_id=staging_object_storage_signed_downloads",
    "release_gate_check_id=staging_legal_external_user_pages",
    "deployed staging routes rather than source files",
):
    if token not in template:
        raise SystemExit(f"release notes template missing split evidence guardrail: {token}")
if "seeded user, tenant, task, package, and export smoke IDs" not in template:
    raise SystemExit("release notes template must require seeded runtime smoke IDs")
PY

production_backup_tmp="$(mktemp -d)"
if REPORT_PATH="$production_backup_tmp/backup-rollback-split.blocked.json" RUN_ID=repo-validate-production-backup-rollback-split scripts/production_backup_rollback_split_smoke.sh >/tmp/stage0-production-backup-rollback-split.out 2>/tmp/stage0-production-backup-rollback-split.err; then
  printf 'production backup/rollback split smoke unexpectedly cleared launch blockers\n' >&2
  cat /tmp/stage0-production-backup-rollback-split.out >&2
  cat /tmp/stage0-production-backup-rollback-split.err >&2
  exit 1
fi
python3 - "$production_backup_tmp/backup-rollback-split.blocked.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if report["schema_version"] != "stage0.rev2.production.backup_rollback_split_preflight":
    raise SystemExit("production backup/rollback split smoke schema mismatch")
if report["environment"] != "production" or report["kind"] != "production_backup_rollback_split_preflight":
    raise SystemExit("production backup/rollback split smoke must be production-scoped")
if report["status"] != "blocked_by_upstream_gates":
    raise SystemExit("production backup/rollback split smoke must stay blocked without exact split evidence")
if report["release_gate_check_id"] != "production_backup_rollback_incident":
    raise SystemExit("production backup/rollback split smoke must target production_backup_rollback_incident")
if set(report["do_not_launch_condition_ids"]) != {
    "backup_restore_rollback_smoke_missing",
    "production_deploy_rollback_smoke_missing",
    "ci_staging_gates_not_passed",
}:
    raise SystemExit("production backup/rollback split smoke must preserve backup, deploy-smoke, and upstream gate blockers")
if report["gate_impact"]["can_clear_release_gate_check"] is not False:
    raise SystemExit("production backup/rollback split smoke must not clear the release gate while blocked")
if report["gate_impact"]["preserved_release_gate_check_id"] != "production_backup_rollback_incident":
    raise SystemExit("production backup/rollback split smoke must preserve the production backup release gate")
if report["upstream_gates"]["ci"]["gate_decision_status"] != "no_go":
    raise SystemExit("production split smoke must surface CI no-go state")
if report["upstream_gates"]["private_beta_staging"]["gate_decision_status"] != "no_go":
    raise SystemExit("production split smoke must surface private beta/staging no-go state")
if report["admin_visible_probe"]["ready"] is not True:
    raise SystemExit("production split smoke must detect the admin-visible blocked probe evidence")
split = report["split_evidence"]
if split["all_exact_split_files_ready"] is not False:
    raise SystemExit("production split smoke must keep exact split readiness false")
if split["backup_restore"]["path"] != "ops/evidence/production/backup-restore.json":
    raise SystemExit("production backup split path mismatch")
if split["rollback_incident_post_deploy_smoke"]["path"] != "ops/evidence/production/rollback-incident-post-deploy-smoke.json":
    raise SystemExit("production rollback split path mismatch")
if "production_backup_restore_split_not_passed" not in report["blocked_checks"]:
    raise SystemExit("production split smoke must block on missing backup/restore split")
if "production_rollback_incident_post_deploy_split_not_passed" not in report["blocked_checks"]:
    raise SystemExit("production split smoke must block on missing rollback/incident/post-deploy split")
requirements = report["runtime_input_requirements"]["required_split_evidence"]
if "Postgres restore" not in requirements["backup_restore"]["must_prove"]:
    raise SystemExit("production backup split requirements must include Postgres restore")
if "post-deploy smoke" not in requirements["rollback_incident_post_deploy_smoke"]["must_prove"]:
    raise SystemExit("production rollback split requirements must include post-deploy smoke")
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
python3 scripts/validate_workflow_api_smoke_evidence.py
python3 scripts/run_workflow_api_smoke.py --check-fixture

log "web/admin conditional validation"
run_node_project_checks web
run_node_project_checks admin

log "load smoke script syntax"
bash -n scripts/load_smoke.sh
load_validate_dir="$(mktemp -d)"
for mode in chat_task worker_generation zip_export signed_download crawler_throttle quota_contention workspace_rendering; do
  LOAD_MODE="$mode" DRY_RUN=1 OUT_DIR="$load_validate_dir" scripts/load_smoke.sh >/dev/null
done
python3 - "$load_validate_dir" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 7:
    raise SystemExit(f"load smoke dry-run must write one report per mode, got {len(reports)}")
by_mode = {}
for path in reports:
    report = json.loads(path.read_text(encoding="utf-8"))
    by_mode[report.get("mode")] = report
required_modes = {
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
}
missing = sorted(required_modes - set(by_mode))
if missing:
    raise SystemExit(f"load smoke dry-run missing modes: {missing}")
crawler = by_mode["crawler_throttle"]
paths = set(crawler.get("paths", []))
expected = set(crawler.get("expected_statuses", []))
if "/api/admin/v1/crawler/sources" not in paths:
    raise SystemExit(f"crawler throttle load smoke must use admin route contract: {crawler}")
if any(value.startswith("/api/v1/admin/") for value in paths | expected):
    raise SystemExit(f"crawler throttle load smoke must not use stale /api/v1/admin route: {crawler}")
for status in ("401", "403", "404", "501"):
    expected_value = f"/api/admin/v1/crawler/sources:{status}"
    if expected_value not in expected:
        raise SystemExit(f"crawler throttle load smoke missing expected status {expected_value}")
PY
run_id_validate_dir="$(mktemp -d)"
RUN_ID="stage0-validate-load-run-id" DRY_RUN=1 OUT_DIR="$run_id_validate_dir/load" scripts/load_smoke.sh >/dev/null
RUN_ID="stage0-validate-staging-run-id" DRY_RUN=1 OUT_DIR="$run_id_validate_dir/staging" scripts/staging_smoke.sh >/dev/null
set +e
RUN_ID="stage0-validate-preflight-run-id" OUT_DIR="$run_id_validate_dir/preflight" scripts/staging_observability_backup_load_smoke.sh >/dev/null
run_id_preflight_status=$?
set -e
if [[ "$run_id_preflight_status" -ne 2 ]]; then
  printf 'run-id preflight dry-run must exit 2 while evidence is missing, got %s\n' "$run_id_preflight_status" >&2
  exit 1
fi
set +e
RUN_ID="stage0-validate-release-bundle-run-id" DRY_RUN=1 OUT_DIR="$run_id_validate_dir/release-bundle" scripts/release_evidence_bundle_smoke.sh >/dev/null
run_id_bundle_status=$?
set -e
if [[ "$run_id_bundle_status" -ne 2 ]]; then
  printf 'run-id release bundle dry-run must exit 2 while release gates are no-go, got %s\n' "$run_id_bundle_status" >&2
  exit 1
fi
python3 - "$run_id_validate_dir" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
expectations = {
    root / "load" / "stage0-validate-load-run-id.json": "stage0-validate-load-run-id",
    root / "staging" / "stage0-validate-staging-run-id.json": "stage0-validate-staging-run-id",
    root / "preflight" / "stage0-validate-preflight-run-id.json": "stage0-validate-preflight-run-id",
    root / "release-bundle" / "stage0-validate-release-bundle-run-id.json": "stage0-validate-release-bundle-run-id",
    root / "release-bundle" / "stage0-validate-release-bundle-run-id.staging-smoke.json": "stage0-validate-release-bundle-run-id.staging-smoke",
    root / "release-bundle" / "stage0-validate-release-bundle-run-id.object-storage-retention-cleanup.json": "stage0-validate-release-bundle-run-id.object-storage-retention-cleanup",
    root / "release-bundle" / "stage0-validate-release-bundle-run-id.legal-support-visibility.json": "stage0-validate-release-bundle-run-id.legal-support-visibility",
}
for path, expected_run_id in expectations.items():
    if not path.exists():
        raise SystemExit(f"deterministic RUN_ID report missing: {path}")
    report = json.loads(path.read_text(encoding="utf-8"))
    actual_run_id = report.get("run_id") or report.get("evidence_id")
    if actual_run_id != expected_run_id:
        raise SystemExit(f"{path} run_id/evidence_id mismatch: {actual_run_id} != {expected_run_id}")
    if path.stem != expected_run_id:
        raise SystemExit(f"{path} filename stem must match run_id {expected_run_id}")
release_bundle = json.loads((root / "release-bundle" / "stage0-validate-release-bundle-run-id.json").read_text(encoding="utf-8"))
staging_smoke = json.loads((root / "release-bundle" / "stage0-validate-release-bundle-run-id.staging-smoke.json").read_text(encoding="utf-8"))
object_retention = json.loads((root / "release-bundle" / "stage0-validate-release-bundle-run-id.object-storage-retention-cleanup.json").read_text(encoding="utf-8"))
if staging_smoke.get("created_at") != "stage0-validate-release-bundle-run-id.staging-smoke":
    raise SystemExit("release bundle must normalize copied staging smoke created_at to the deterministic component run ID")
if release_bundle.get("source_staging_smoke_report") != str(root / "release-bundle" / "stage0-validate-release-bundle-run-id.staging-smoke.json"):
    raise SystemExit("release bundle must promote deterministic staging smoke report path")
if release_bundle.get("source_staging_smoke_results") != str(root / "release-bundle" / "stage0-validate-release-bundle-run-id.staging-smoke.ndjson"):
    raise SystemExit("release bundle must promote deterministic staging smoke results path")
if release_bundle.get("source_object_retention_cleanup_report") != str(root / "release-bundle" / "stage0-validate-release-bundle-run-id.object-storage-retention-cleanup.json"):
    raise SystemExit("release bundle must promote deterministic object-retention report path")
if release_bundle.get("source_object_retention_cleanup_results") != object_retention.get("results_path"):
    raise SystemExit("release bundle must promote object-retention report-declared results path")
if not Path(release_bundle["source_object_retention_cleanup_results"]).exists():
    raise SystemExit("release bundle object-retention report-declared results path must exist")
if release_bundle.get("source_legal_support_visibility_report") != str(root / "release-bundle" / "stage0-validate-release-bundle-run-id.legal-support-visibility.json"):
    raise SystemExit("release bundle must promote deterministic legal/support report path")
if release_bundle.get("source_legal_support_visibility_results") != str(root / "release-bundle" / "stage0-validate-release-bundle-run-id.legal-support-visibility.ndjson"):
    raise SystemExit("release bundle must promote deterministic legal/support results path")
if release_bundle.get("source_legal_pages_external_user_report") != str(root / "release-bundle" / "stage0-validate-release-bundle-run-id.legal-pages-external-user.json"):
    raise SystemExit("release bundle must preserve deterministic legal-pages split report path")
if release_bundle.get("source_support_contact_external_user_report") != str(root / "release-bundle" / "stage0-validate-release-bundle-run-id.support-contact-external-user.json"):
    raise SystemExit("release bundle must preserve deterministic support-contact split report path")
split_inputs = release_bundle.get("split_probe_decision_inputs", {})
if split_inputs.get("legal_pages_external_user_verified") is not False:
    raise SystemExit("deterministic release bundle must keep missing legal-pages split evidence unverified")
if split_inputs.get("support_contact_external_user_verified") is not False:
    raise SystemExit("deterministic release bundle must keep missing support-contact split evidence unverified")
if split_inputs.get("canonical_legal_pages_external_user_verified") is not True:
    raise SystemExit("deterministic release bundle must recognize canonical legal-pages split evidence")
if split_inputs.get("canonical_support_contact_external_user_verified") is not True:
    raise SystemExit("deterministic release bundle must recognize canonical support-contact split evidence")
if split_inputs.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("deterministic release bundle must use canonical staging legal/support split evidence")
if release_bundle.get("legal_support_visibility_verified") is not True:
    raise SystemExit("deterministic release bundle must verify legal/support from canonical staging split evidence")
if release_bundle.get("legal_support_split_reports_verified") is not True:
    raise SystemExit("deterministic release bundle must verify legal/support split reports from canonical staging evidence")
PY

log "backup/restore drill script syntax"
bash -n scripts/backup_restore_drill.sh
backup_validate_dir="$(mktemp -d)"
DRY_RUN=1 DRILL_DIR="$backup_validate_dir" scripts/backup_restore_drill.sh >/dev/null

log "ops smoke wrappers"
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
ops_validate_dir="$(mktemp -d)"
DRY_RUN=1 OUT_DIR="$ops_validate_dir/playwright" scripts/playwright_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/docker" scripts/docker_build_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/staging" scripts/staging_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/observability" scripts/observability_smoke.sh >/dev/null
set +e
OUT_DIR="$ops_validate_dir/staging-observability-backup-load" scripts/staging_observability_backup_load_smoke.sh >/dev/null
staging_obl_status=$?
set -e
if [[ "$staging_obl_status" -ne 2 ]]; then
  printf 'staging observability/backup/load preflight must exit 2 with missing evidence, got %s\n' "$staging_obl_status" >&2
  exit 1
fi
RUN_ID="stage0-validate-object-storage-signed-url" OUT_DIR="$ops_validate_dir/object-storage" scripts/staging_object_storage_signed_url_smoke.sh >/dev/null
set +e
RUN_ID="stage0-validate-object-storage-retention-cleanup" DRY_RUN=1 OUT_DIR="$ops_validate_dir/object-storage-retention" scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_status=$?
set -e
if [[ "$object_retention_status" -ne 2 ]]; then
  printf 'staging object-storage retention cleanup dry-run must exit 2 without runtime evidence, got %s\n' "$object_retention_status" >&2
  exit 1
fi
python3 - "$ops_validate_dir/object-storage-retention" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1]) / "object-storage-retention-cleanup.json"
results_path = Path(sys.argv[1]) / "object-storage-retention-cleanup.ndjson"
if not report_path.exists():
    raise SystemExit("object-storage retention cleanup dry-run must write canonical report")
if not results_path.exists():
    raise SystemExit("object-storage retention cleanup dry-run must write canonical NDJSON results")
report = json.loads(report_path.read_text(encoding="utf-8"))
if report.get("schema_version") != "stage0.rev2.staging.object_storage_retention_cleanup":
    raise SystemExit(f"object-storage retention cleanup report has wrong schema: {report}")
if report.get("environment") != "staging":
    raise SystemExit("object-storage retention cleanup report must be staging-scoped")
if report.get("kind") != "object_storage_retention_cleanup":
    raise SystemExit("object-storage retention cleanup report must declare the retention cleanup kind")
if report.get("status") != "blocked":
    raise SystemExit("object-storage retention cleanup dry-run must remain blocked without staging runtime probes")
if report.get("release_gate_check_id") != "staging_object_storage_signed_downloads":
    raise SystemExit("object-storage retention cleanup report must target the object-storage release-gate check")
if report.get("do_not_launch_condition_id") != "object_storage_signed_retention_runtime_missing":
    raise SystemExit("object-storage retention cleanup report must preserve the object-storage Do-Not-Launch condition")
expected_checks = {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}
if set(report.get("required_checks", [])) != expected_checks:
    raise SystemExit(f"object-storage retention cleanup required checks mismatch: {report.get('required_checks')}")
coverage = {item.get("area"): item for item in report.get("coverage", [])}
if set(coverage) != expected_checks:
    raise SystemExit(f"object-storage retention cleanup coverage mismatch: {set(coverage)}")
for area, item in coverage.items():
    if item.get("status") != "blocked":
        raise SystemExit(f"{area} dry-run coverage must stay blocked")
    if item.get("evidence_path_policy") != "ops/evidence/staging/":
        raise SystemExit(f"{area} coverage must declare staging evidence path policy")
    source_results = item.get("source_results", [])
    if len(source_results) != 1 or source_results[0].get("status") != "planned":
        raise SystemExit(f"{area} dry-run source probe must be planned: {source_results}")
    if source_results[0].get("reason") != "dry_run_no_staging_runtime_probe":
        raise SystemExit(f"{area} dry-run source probe must name dry-run runtime skip: {source_results}")
split = report.get("split_evidence", {})
if split.get("signed_url_evidence") != "ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json":
    raise SystemExit("object-storage retention cleanup must cite exact signed URL split evidence")
if split.get("signed_url_ready") is not True:
    raise SystemExit("object-storage retention cleanup dry-run must still verify the signed URL split evidence")
if split.get("signed_url_release_sha") != "d3b1107c33dc40b8936f28549e06553fbd7b104a":
    raise SystemExit("object-storage retention cleanup dry-run must read the signed URL release SHA")
if split.get("release_sha_matches_signed_url") is not False:
    raise SystemExit("object-storage retention cleanup dry-run without RELEASE_SHA must not match signed URL release binding")
if split.get("retention_cleanup_runtime_ready") is not False:
    raise SystemExit("object-storage retention cleanup dry-run must not claim retention cleanup runtime readiness")
if split.get("retention_cleanup_ready") is not False:
    raise SystemExit("object-storage retention cleanup dry-run must not claim retention cleanup readiness")
runtime_requirements = report.get("runtime_input_requirements", {})
if runtime_requirements.get("required_release_sha") != "d3b1107c33dc40b8936f28549e06553fbd7b104a":
    raise SystemExit("object-storage retention cleanup dry-run must name the signed URL release SHA")
if runtime_requirements.get("required_base_url") != "STAGING_BASE_URL or explicit probe URL env vars":
    raise SystemExit("object-storage retention cleanup dry-run must name the staging URL input requirement")
if "ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE" not in runtime_requirements.get("required_auth", ""):
    raise SystemExit("object-storage retention cleanup dry-run must name admin auth input requirement")
if "SMOKE_ADMIN_USER_ID" not in runtime_requirements.get("required_smoke_admin_user_id", ""):
    raise SystemExit("object-storage retention cleanup dry-run must name smoke admin user input requirement")
if "SMOKE_ADMIN_TENANT_ID" not in runtime_requirements.get("required_smoke_admin_tenant_id", ""):
    raise SystemExit("object-storage retention cleanup dry-run must name smoke admin tenant input requirement")
if "X-Request-ID" not in runtime_requirements.get("required_request_id_echo", ""):
    raise SystemExit("object-storage retention cleanup dry-run must name request-id echo input requirement")
if runtime_requirements.get("canonical_pass_results") != "ops/evidence/staging/object-storage-retention-cleanup.ndjson":
    raise SystemExit("object-storage retention cleanup dry-run must name the canonical pass results path")
if "canonical pass paths" not in runtime_requirements.get("pass_file_policy", ""):
    raise SystemExit("object-storage retention cleanup dry-run must describe canonical pass-file policy")
probe_routes = runtime_requirements.get("required_probe_routes", {})
expected_probe_routes = {
    "retention_policy": ("GET", "RETENTION_POLICY_URL", "/api/admin/v1/object-storage/retention-policy"),
    "expired_export_cleanup": ("POST", "EXPIRED_EXPORT_CLEANUP_URL", "/api/admin/v1/object-storage/cleanup/expired-exports"),
    "orphan_cleanup": ("POST", "ORPHAN_CLEANUP_URL", "/api/admin/v1/object-storage/cleanup/orphans"),
    "audit_refs": ("GET", "AUDIT_REFS_URL", "/api/admin/v1/audit?subject=object_storage_cleanup&limit=20"),
}
for probe_id, (method, env_var, default_path) in expected_probe_routes.items():
    route = probe_routes.get(probe_id, {})
    if route.get("method") != method or route.get("env_var") != env_var or route.get("default_path") != default_path:
        raise SystemExit(f"object-storage retention cleanup dry-run missing route contract for {probe_id}: {route}")
gate_impact = report.get("gate_impact", {})
if gate_impact.get("can_clear_retention_cleanup_checklist_item") is not False:
    raise SystemExit("object-storage retention cleanup dry-run must not clear the retention checklist item")
if gate_impact.get("can_clear_release_gate_check") is not False:
    raise SystemExit("object-storage retention cleanup dry-run must not clear the object-storage release gate")
if gate_impact.get("remaining_release_gate_blockers_after_pass") != ["staging_object_storage_signed_downloads"]:
    raise SystemExit("object-storage retention cleanup dry-run must preserve the object-storage blocker")
if split.get("canonical_pass_paths") is not False:
    raise SystemExit("object-storage retention cleanup dry-run using validation paths must not claim canonical pass paths")
for item in coverage.values():
    for key in ("release_sha_bound", "admin_identity_bound", "request_ids", "response_bytes"):
        if key not in item:
            raise SystemExit(f"{item.get('area')} dry-run coverage missing {key}: {item}")
PY
object_retention_pass_dir="$(mktemp -d)"
object_retention_web_dir="$object_retention_pass_dir/web"
mkdir -p "$object_retention_web_dir/api/admin/v1/object-storage/retention-policy" \
  "$object_retention_web_dir/api/admin/v1/object-storage/cleanup/expired-exports" \
  "$object_retention_web_dir/api/admin/v1/object-storage/cleanup/orphans"
cat >"$object_retention_web_dir/api/admin/v1/object-storage/retention-policy/index.html" <<'EOF'
{"retention_policy":{"tenant_id":"tenant-alpha","versioning":{"enabled":true},"retention_until":"2026-06-01T00:00:00Z"}}
EOF
cat >"$object_retention_web_dir/api/admin/v1/object-storage/cleanup/expired-exports/index.html" <<'EOF'
{"expired_exports":{"deleted_objects":2,"preview_objects":1,"audit_refs":["au-007"],"dry_run":true}}
EOF
cat >"$object_retention_web_dir/api/admin/v1/object-storage/cleanup/orphans/index.html" <<'EOF'
{"orphaned_objects":{"deleted_objects":1,"preview_objects":2,"audit_refs":["au-015"],"dry_run":true}}
EOF
cat >"$object_retention_pass_dir/server.py" <<'PY'
import json
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import sys
from urllib.parse import urlparse

root = Path(sys.argv[1])

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)

    def end_headers(self):
        request_id = self.headers.get("X-Request-ID")
        if request_id:
            self.send_header("X-Request-ID", request_id)
        super().end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path.endswith("/cleanup/expired-exports"):
            self._json({
                "expired_exports": {
                    "deleted_objects": 2,
                    "preview_objects": 1,
                    "audit_refs": ["au-007"],
                    "dry_run": True,
                }
            })
            return
        if parsed.path.endswith("/cleanup/orphans"):
            self._json({
                "orphaned_objects": {
                    "deleted_objects": 1,
                    "preview_objects": 2,
                    "audit_refs": ["au-015"],
                    "dry_run": True,
                }
            })
            return
        self.send_error(404)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/admin/v1/audit":
            self._json({
                "audit_refs": [
                    {"audit_id": "au-007", "kind": "object_retention_cleanup", "actor_id": "admin-ops", "tenant_id": "tenant-alpha"},
                    {"audit_id": "au-015", "kind": "export.cleanup.preview", "actor_id": "admin-ops", "tenant_id": "tenant-alpha"},
                ]
            })
            return
        super().do_GET()

    def _json(self, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

port = int(sys.argv[2])
ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
PY
object_retention_port="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
python3 "$object_retention_pass_dir/server.py" "$object_retention_web_dir" "$object_retention_port" >"$object_retention_pass_dir/server.log" 2>&1 &
object_retention_server_pid=$!
for _ in $(seq 1 50); do
  if curl --silent --show-error --max-time 1 "http://127.0.0.1:$object_retention_port/api/admin/v1/object-storage/retention-policy/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! curl --silent --show-error --max-time 1 "http://127.0.0.1:$object_retention_port/api/admin/v1/object-storage/retention-policy/" >/dev/null 2>&1; then
  kill "$object_retention_server_pid" 2>/dev/null || true
  printf 'failed to start local object-retention fixture server\n' >&2
  cat "$object_retention_pass_dir/server.log" >&2 || true
  exit 1
fi
set +e
RUN_ID="stage0-validate-object-retention-alias-pass" \
  OUT_DIR="$object_retention_pass_dir/out" \
  BASE_URL="http://127.0.0.1:$object_retention_port" \
  RELEASE_SHA="d3b1107c33dc40b8936f28549e06553fbd7b104a" \
  ADMIN_BEARER_TOKEN="stage0-local-fixture" \
  SMOKE_ADMIN_USER_ID="admin-ops" \
  SMOKE_ADMIN_TENANT_ID="tenant-alpha" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_alias_status=$?
set -e
kill "$object_retention_server_pid" 2>/dev/null || true
if [[ "$object_retention_alias_status" -ne 2 ]]; then
  printf 'object-retention alias fixture must exit 2 because non-canonical validation paths cannot close the gate, got %s\n' "$object_retention_alias_status" >&2
  exit 1
fi
python3 - "$object_retention_pass_dir/out/object-storage-retention-cleanup.json" "$object_retention_pass_dir/out/object-storage-retention-cleanup.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("non-canonical object-retention alias fixture must stay blocked")
if report.get("blocked_checks") != ["canonical_pass_paths_required_for_gate_closure"]:
    raise SystemExit(f"alias fixture should only be blocked by canonical path policy: {report.get('blocked_checks')}")
split = report.get("split_evidence", {})
if split.get("retention_cleanup_runtime_ready") is not True:
    raise SystemExit("alias fixture must prove retention cleanup runtime readiness")
if split.get("retention_cleanup_ready") is not False:
    raise SystemExit("alias fixture must not mark retention cleanup gate ready on validation paths")
if split.get("canonical_pass_paths") is not False:
    raise SystemExit("alias fixture must not claim canonical pass paths")
if split.get("release_sha_matches_signed_url") is not True:
    raise SystemExit("alias fixture must bind to the signed URL release SHA")
if report.get("gate_impact", {}).get("can_clear_release_gate_check") is not False:
    raise SystemExit("alias fixture must not clear object-storage release gate from non-canonical paths")
if {row.get("status") for row in rows} != {"passed"}:
    raise SystemExit(f"alias fixture rows must all pass before canonical policy blocks: {rows}")
for row in rows:
    if row.get("missing_tokens"):
        raise SystemExit(f"alias-aware matcher should not leave missing tokens: {row}")
    if row.get("request_id_echoed") is not True:
        raise SystemExit(f"alias fixture must verify request-id echo: {row}")
    if not row.get("matched_tokens"):
        raise SystemExit(f"alias fixture must record matched semantic tokens: {row}")
PY
set +e
RUN_ID="stage0-validate-legal-support-visibility" DRY_RUN=1 OUT_DIR="$ops_validate_dir/legal-support" scripts/staging_legal_support_visibility_smoke.sh >/dev/null
legal_support_status=$?
set -e
if [[ "$legal_support_status" -ne 2 ]]; then
  printf 'staging legal/support visibility dry-run must exit 2 without external-user runtime evidence, got %s\n' "$legal_support_status" >&2
  exit 1
fi
DRY_RUN=1 OUT_DIR="$ops_validate_dir/security" scripts/security_scan_smoke.sh >/dev/null
set +e
DRY_RUN=1 OUT_DIR="$ops_validate_dir/release-bundle" scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_status=$?
set -e
if [[ "$release_bundle_status" -ne 2 ]]; then
  raise_msg="release evidence bundle dry-run must exit 2 while release gates are no-go, got $release_bundle_status"
  printf '%s\n' "$raise_msg" >&2
  exit 1
fi
find "$ops_validate_dir" -name '*.json' -type f | grep -q .
python3 - "$ops_validate_dir/release-bundle" <<'PY'
import json
import sys
from pathlib import Path

out_dir = Path(sys.argv[1])
reports = [
    path
    for path in sorted(out_dir.glob("*.json"))
    if json.loads(path.read_text(encoding="utf-8")).get("kind") == "release_evidence_bundle"
]
if len(reports) != 1:
    raise SystemExit("release evidence bundle dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "release_evidence_bundle":
    raise SystemExit(f"release evidence bundle report has wrong kind: {report}")
if report.get("status") != "blocked":
    raise SystemExit("release evidence bundle dry-run must remain blocked")
if report.get("decision") != "no-go":
    raise SystemExit("release evidence bundle dry-run must keep no-go decision")
if report.get("release_evidence_complete") is not False:
    raise SystemExit("release evidence bundle dry-run must keep release evidence incomplete")
if report.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("release evidence bundle dry-run must keep post-deploy smoke unverified")
if report.get("object_retention_cleanup_verified") is not False:
    raise SystemExit("release evidence bundle dry-run must keep object-retention cleanup unverified")
object_retention_probe = report.get("object_retention_cleanup_probe", {})
if object_retention_probe.get("status") != "blocked":
    raise SystemExit("release evidence bundle dry-run must surface blocked object-retention cleanup status")
if report.get("source_object_retention_cleanup_results") != object_retention_probe.get("results_path"):
    raise SystemExit("release evidence bundle dry-run must cite object-retention report-declared results path")
if not Path(report["source_object_retention_cleanup_results"]).exists():
    raise SystemExit("release evidence bundle dry-run object-retention results path must exist")
if set(object_retention_probe.get("required_checks", [])) != {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}:
    raise SystemExit("release evidence bundle dry-run must surface object-retention required checks")
runtime_requirements = object_retention_probe.get("runtime_input_requirements", {})
if runtime_requirements.get("required_release_sha") != "d3b1107c33dc40b8936f28549e06553fbd7b104a":
    raise SystemExit("release evidence bundle dry-run must surface required object-retention release SHA")
if runtime_requirements.get("required_base_url") != "STAGING_BASE_URL or explicit probe URL env vars":
    raise SystemExit("release evidence bundle dry-run must surface staging URL requirement for object-retention probe")
if "ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE" not in runtime_requirements.get("required_auth", ""):
    raise SystemExit("release evidence bundle dry-run must surface admin auth requirement for object-retention probe")
if "SMOKE_ADMIN_USER_ID" not in runtime_requirements.get("required_smoke_admin_user_id", ""):
    raise SystemExit("release evidence bundle dry-run must surface admin user requirement for object-retention probe")
if "SMOKE_ADMIN_TENANT_ID" not in runtime_requirements.get("required_smoke_admin_tenant_id", ""):
    raise SystemExit("release evidence bundle dry-run must surface admin tenant requirement for object-retention probe")
if "X-Request-ID" not in runtime_requirements.get("required_request_id_echo", ""):
    raise SystemExit("release evidence bundle dry-run must surface request-id echo requirement for object-retention probe")
if runtime_requirements.get("canonical_pass_report") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit("release evidence bundle dry-run must surface canonical object-retention pass report path")
split_evidence = object_retention_probe.get("split_evidence", {})
if split_evidence.get("signed_url_ready") is not True:
    raise SystemExit("release evidence bundle dry-run must surface signed URL split readiness")
if split_evidence.get("retention_cleanup_ready") is not False:
    raise SystemExit("release evidence bundle dry-run must keep retention cleanup readiness false")
if report.get("legal_support_visibility_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must verify legal/support from canonical staging split evidence")
if report.get("legal_support_split_reports_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must verify legal/support split reports from canonical staging evidence")
if report.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("release evidence bundle dry-run must cite canonical staging legal/support split evidence")
if report.get("gate_fixtures_clear") is not False:
    raise SystemExit("release evidence bundle dry-run must keep gate fixtures blocked")
for slot in (
    "release_sha",
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in report.get("missing_slots", []):
        raise SystemExit(f"release evidence bundle missing expected absent slot {slot}")
for slot in (
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in report.get("unverified_slots", []):
        raise SystemExit(f"release evidence bundle missing expected unverified slot {slot}")
blocking = report.get("blocking_reasons", [])
for reason in (
    "staging_smoke_not_passed",
    "post_deploy_smoke_contract_unverified",
    "object_storage_retention_cleanup_not_passed",
    "missing_release_evidence:release_sha",
    "missing_release_evidence:observability_evidence",
):
    if reason not in blocking:
        raise SystemExit(f"release evidence bundle missing blocking reason {reason}")
if not any(reason.startswith("gate_fixture_blocked:private_beta_staging:") for reason in blocking):
    raise SystemExit("release evidence bundle must include private beta fixture blockers")
if not any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking):
    raise SystemExit("release evidence bundle must include production fixture blockers")
if not report.get("source_staging_smoke_report"):
    raise SystemExit("release evidence bundle must cite source staging smoke report")
if not Path(report["source_staging_smoke_report"]).exists():
    raise SystemExit("release evidence bundle must preserve source staging smoke report")
if not Path(report["source_staging_smoke_results"]).exists():
    raise SystemExit("release evidence bundle must preserve source staging smoke results")
split_inputs = report.get("split_probe_decision_inputs", {})
if split_inputs.get("legal_pages_external_user_verified") is not False:
    raise SystemExit("release evidence bundle dry-run must keep legal-pages split evidence unverified")
if split_inputs.get("support_contact_external_user_verified") is not False:
    raise SystemExit("release evidence bundle dry-run must keep support-contact split evidence unverified")
if split_inputs.get("canonical_legal_pages_external_user_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must recognize canonical legal-pages split evidence")
if split_inputs.get("canonical_support_contact_external_user_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must recognize canonical support-contact split evidence")
if split_inputs.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("release evidence bundle dry-run must report canonical staging legal/support evidence source")
for field in (
    "canonical_legal_pages_external_user_probe",
    "canonical_support_contact_external_user_probe",
):
    probe = report.get(field, {})
    if probe.get("exists") is not True:
        raise SystemExit(f"{field} canonical evidence must exist")
    if probe.get("passed") is not True:
        raise SystemExit(f"{field} canonical evidence must pass")
for field in (
    "legal_pages_external_user_probe",
    "support_contact_external_user_probe",
):
    probe = report.get(field, {})
    if probe.get("exists") is not False:
        raise SystemExit(f"{field} dry-run probe must be absent")
    if probe.get("status") != "missing":
        raise SystemExit(f"{field} dry-run status must be missing")
PY
python3 - "$ops_validate_dir/observability" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("observability smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
signals = {signal["signal_id"]: signal for signal in report.get("signals", [])}
metrics = signals.get("backend_worker_crawler_metrics")
if not metrics:
    raise SystemExit("observability smoke report missing backend_worker_crawler_metrics signal")
refs = set(metrics.get("evidence_refs", []))
for ref in (
    "backend/internal/server/metrics.go",
    "backend/internal/worker/metrics.go",
    "backend/internal/crawler/metrics.go",
):
    if ref not in refs:
        raise SystemExit(f"observability metrics evidence refs missing {ref}")
checks = report.get("checks", {})
for key in (
    "backend_metrics_definition_validated",
    "worker_metrics_definition_validated",
    "crawler_metrics_definition_validated",
    "backend_worker_crawler_metrics_contract_validated",
):
    if key not in checks:
        raise SystemExit(f"observability smoke checks missing {key}")
if checks["backend_worker_crawler_metrics_contract_validated"] is not False:
    raise SystemExit("observability dry-run must not claim metrics runtime contract without backend scrape evidence")
statuses = report.get("signal_statuses", {})
if statuses.get("backend_worker_crawler_metrics") != "open":
    raise SystemExit("observability dry-run must keep backend/worker/crawler metrics runtime evidence open")
open_items = report.get("open_items", [])
if "staging_backend_worker_crawler_metrics_capture_with_release_sha_and_bounded_labels" not in open_items:
    raise SystemExit("observability smoke must keep staging metrics capture open")
PY
python3 - "$ops_validate_dir/staging-observability-backup-load" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("staging observability/backup/load preflight must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "staging_observability_backup_load_preflight":
    raise SystemExit(f"preflight report has wrong kind: {report}")
if report.get("status") != "blocked":
    raise SystemExit("preflight with missing evidence must remain blocked")
if report.get("private_beta_check_id") != "staging_observability_backup_load":
    raise SystemExit("preflight must map to the private beta observability/backup/load check")
if report.get("release_gate_check_id") != "staging_observability_backup_load":
    raise SystemExit("preflight must preserve the staging observability/backup/load release gate check id")
if report.get("evidence_path_policy") != "ops/evidence/staging/":
    raise SystemExit("preflight must declare the staging runtime evidence path policy")
expected_slots = {
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "post_deploy_smoke_evidence",
}
if set(report.get("blocked_slots", [])) != expected_slots:
    raise SystemExit(f"preflight missing-evidence blocked slots mismatch: {report.get('blocked_slots')}")
if report.get("verified_observability_entries") != []:
    raise SystemExit("missing-evidence preflight must not summarize verified observability entries")
for field in (
    "verified_postgres_restore_entries",
    "verified_object_restore_entries",
    "verified_load_entries",
    "verified_post_deploy_smoke_entries",
):
    if report.get(field) != []:
        raise SystemExit(f"missing-evidence preflight must leave {field} empty")
if report.get("missing_blockers") != ["staging_observability_restore_load_missing"]:
    raise SystemExit("missing-evidence preflight must preserve staging_observability_restore_load_missing")
if report.get("overall_verified") is not False:
    raise SystemExit("missing-evidence preflight must set overall_verified=false")
release_gate_fixture = report.get("release_gate_fixture", {})
if release_gate_fixture.get("verified_for_aggregate_closure") is not True:
    raise SystemExit("missing-evidence preflight must recognize the current gate fixture has already cleared this check")
if report.get("closure_blockers") != []:
    raise SystemExit("missing-evidence preflight must be blocked by missing input slots, not by stale gate fixture blockers")
checks = {check["slot"]: check for check in report.get("checks", [])}
if set(checks) != expected_slots:
    raise SystemExit(f"preflight checks missing required slots: {checks}")
for slot, check in checks.items():
    if check.get("verified") is not False:
        raise SystemExit(f"missing {slot} must not verify")
    if check.get("expected_environment") != "staging":
        raise SystemExit(f"{slot} must require staging environment")
    if check.get("required_evidence_path_prefix") != "ops/evidence/staging/":
        raise SystemExit(f"{slot} must declare the staging evidence path prefix")
    if check.get("semantic_checks", {}).get("local_json_file") is not False:
        raise SystemExit(f"{slot} must fail local_json_file when missing")
    if check.get("semantic_checks", {}).get("staging_evidence_path") is not False:
        raise SystemExit(f"{slot} must fail staging_evidence_path when missing")
for reason in (
    "unverified_observability_evidence:",
    "unverified_backup_restore_evidence:",
    "unverified_load_evidence:",
    "unverified_post_deploy_smoke_evidence:",
):
    if not any(item.startswith(reason) for item in report.get("blocking_reasons", [])):
        raise SystemExit(f"preflight missing blocking reason prefix {reason}")
PY
preflight_observability_dir="$(mktemp -d)"
preflight_observability_sha="d3b1107c33dc40b8936f28549e06553fbd7b104a"
set +e
RELEASE_SHA="$preflight_observability_sha" \
  OUT_DIR="$preflight_observability_dir/out" \
  OBSERVABILITY_EVIDENCE="ops/evidence/staging/20260527T1830Z-observability-runtime.json" \
  scripts/staging_observability_backup_load_smoke.sh >/dev/null
preflight_observability_status=$?
set -e
if [[ "$preflight_observability_status" -ne 2 ]]; then
  printf 'observability-only preflight must still exit 2 while restore/load evidence is missing, got %s\n' "$preflight_observability_status" >&2
  exit 1
fi
python3 - "$preflight_observability_dir/out" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("observability-only preflight must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("status") != "blocked":
    raise SystemExit("observability-only preflight must remain blocked")
if set(report.get("blocked_slots", [])) != {"backup_restore_evidence", "load_evidence", "post_deploy_smoke_evidence"}:
    raise SystemExit(f"observability-only preflight should block restore/load/post-deploy slots: {report.get('blocked_slots')}")
expected_observability_entries = [
    "alert_routes",
    "backend_worker_crawler_metrics",
    "dashboard_import",
    "opentelemetry_traces",
    "request_id_propagation",
    "structured_json_logs",
]
if report.get("verified_observability_entries") != expected_observability_entries:
    raise SystemExit("observability-only preflight must summarize verified observability entries")
for field in (
    "verified_postgres_restore_entries",
    "verified_object_restore_entries",
    "verified_load_entries",
    "verified_post_deploy_smoke_entries",
):
    if report.get(field) != []:
        raise SystemExit(f"observability-only preflight must leave {field} empty")
if report.get("missing_blockers") != ["staging_observability_restore_load_missing"]:
    raise SystemExit("observability-only preflight must preserve staging_observability_restore_load_missing")
if report.get("overall_verified") is not False:
    raise SystemExit("observability-only preflight must set overall_verified=false")
release_gate_fixture = report.get("release_gate_fixture", {})
if release_gate_fixture.get("verified_for_aggregate_closure") is not True:
    raise SystemExit("observability-only preflight must recognize the current gate fixture has already cleared this check")
if report.get("closure_blockers") != []:
    raise SystemExit("observability-only preflight must be blocked by missing restore/load/post-deploy slots, not by stale gate fixture blockers")
checks = {check["slot"]: check for check in report.get("checks", [])}
if checks["observability_evidence"].get("verified") is not True:
    raise SystemExit(f"staging observability evidence should verify: {checks['observability_evidence']}")
for slot in ("backup_restore_evidence", "load_evidence", "post_deploy_smoke_evidence"):
    if checks[slot].get("verified") is not False:
        raise SystemExit(f"{slot} must remain unverified when absent")
PY
preflight_pass_dir="$(mktemp -d)"
preflight_fixture_dir="ops/evidence/staging/.repo-validate-preflight-$$"
rm -rf "$preflight_fixture_dir"
mkdir -p "$preflight_fixture_dir"
preflight_sha="abcdef1234567890abcdef1234567890abcdef12"
cat >"$preflight_fixture_dir/observability.json" <<EOF
{
  "release_sha": "$preflight_sha",
  "environment": "staging",
  "kind": "observability",
  "status": "passed",
  "signals": [
    {"signal_id": "request_id_propagation", "status": "passed", "evidence_ref": "ops/evidence/staging/request-id-$preflight_sha.json"},
    {"signal_id": "structured_json_logs", "status": "passed", "log_query": "release_sha=$preflight_sha request_id:*"},
    {"signal_id": "opentelemetry_traces", "status": "passed", "trace_id": "trace-$preflight_sha"},
    {"signal_id": "backend_worker_crawler_metrics", "status": "passed", "metrics_query": "release_sha=$preflight_sha"},
    {"signal_id": "dashboard_import", "status": "validated", "dashboard_uid": "stage0-$preflight_sha"},
    {"signal_id": "alert_routes", "status": "validated", "alert_rule_url": "https://monitoring.example.invalid/$preflight_sha"}
  ]
}
EOF
cat >"$preflight_fixture_dir/backup.json" <<EOF
{
  "release_sha": "$preflight_sha",
  "environment": "staging",
  "kind": "backup_restore",
  "status": "passed",
  "drills": [
    {"drill_id": "postgres_restore", "status": "passed", "report_path": "ops/evidence/staging/postgres-restore-$preflight_sha.json"},
    {"drill_id": "object_restore", "status": "validated", "report_path": "ops/evidence/staging/object-restore-$preflight_sha.json"}
  ]
}
EOF
cat >"$preflight_fixture_dir/load.json" <<EOF
{
  "release_sha": "$preflight_sha",
  "environment": "staging",
  "kind": "load",
  "status": "passed",
  "modes": [
    {"name": "chat_task", "status": "passed", "load_report": "ops/evidence/staging/load-chat-task-$preflight_sha.json"},
    {"name": "worker_generation", "status": "passed", "load_report": "ops/evidence/staging/load-worker-generation-$preflight_sha.json"},
    {"name": "zip_export", "status": "passed", "load_report": "ops/evidence/staging/load-zip-export-$preflight_sha.json"},
    {"name": "signed_download", "status": "passed", "load_report": "ops/evidence/staging/load-signed-download-$preflight_sha.json"},
    {"name": "crawler_throttle", "status": "passed", "load_report": "ops/evidence/staging/load-crawler-throttle-$preflight_sha.json"},
    {"name": "quota_contention", "status": "passed", "load_report": "ops/evidence/staging/load-quota-contention-$preflight_sha.json"},
    {"name": "workspace_rendering", "status": "passed", "load_report": "ops/evidence/staging/load-workspace-rendering-$preflight_sha.json"}
  ]
}
EOF
cat >"$preflight_fixture_dir/post_deploy_smoke.ndjson" <<EOF
{"name":"backend_health","category":"backend_health","ok":true,"status_code":200,"request_id_ok":true}
{"name":"web_home","category":"web","ok":true,"status_code":200}
{"name":"admin_home","category":"admin","ok":true,"status_code":200}
{"name":"user_task_auth_boundary","category":"auth_boundary","ok":true,"status_code":401}
{"name":"task_status","category":"worker_task","ok":true,"status_code":200,"request_id_ok":true}
{"name":"export_create","category":"export_package","ok":true,"status_code":202,"request_id_ok":true}
{"name":"export_status","category":"signed_download","ok":true,"status_code":200,"request_id_ok":true}
{"name":"crawler_sources","category":"crawler_admin","ok":true,"status_code":200,"request_id_ok":true}
{"name":"quota_rate_limit","category":"quota_rate_limit","ok":true,"status_code":200,"request_id_ok":true}
{"name":"observability_request_id","category":"observability","ok":true,"status_code":200,"request_id_ok":true}
EOF
cat >"$preflight_fixture_dir/post_deploy_smoke.json" <<EOF
{
  "release_sha": "$preflight_sha",
  "environment": "staging",
  "kind": "post_deploy_smoke",
  "status": "passed",
  "required_categories": [
    "backend_health",
    "web",
    "admin",
    "auth_boundary",
    "worker_task",
    "export_package",
    "signed_download",
    "crawler_admin",
    "quota_rate_limit",
    "observability"
  ],
  "results_path": "$preflight_fixture_dir/post_deploy_smoke.ndjson",
  "summary": {
    "post_deploy_smoke_evidence": {
      "verified": true,
      "report_path": "$preflight_fixture_dir/post_deploy_smoke.json",
      "present_categories": [
        "backend_health",
        "web",
        "admin",
        "auth_boundary",
        "worker_task",
        "export_package",
        "signed_download",
        "crawler_admin",
        "quota_rate_limit",
        "observability"
      ]
    }
  }
}
EOF
cat >"$preflight_fixture_dir/private_beta_gate.json" <<EOF
{
  "gate": "private_beta_staging",
  "checks": [
    {"check_id": "staging_observability_backup_load", "status": "pass"}
  ],
  "do_not_launch_checks": [
    {"condition_id": "staging_observability_restore_load_missing", "is_present": false}
  ],
  "gate_decision": {
    "status": "no_go",
    "blocked_by_checks": ["staging_object_storage_signed_downloads", "staging_legal_external_user_pages"],
    "active_do_not_launch_conditions": ["object_storage_signed_retention_runtime_missing", "external_user_legal_pages_missing"],
    "evidence_ref": "synthetic validator fixture keeps unrelated private beta blockers open"
  }
}
EOF
RELEASE_SHA="$preflight_sha" \
  OUT_DIR="$preflight_pass_dir/out" \
  OBSERVABILITY_EVIDENCE="$preflight_fixture_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$preflight_fixture_dir/backup.json" \
  LOAD_EVIDENCE="$preflight_fixture_dir/load.json" \
  POST_DEPLOY_SMOKE_EVIDENCE="$preflight_fixture_dir/post_deploy_smoke.json" \
  PRIVATE_BETA_GATE_FIXTURE="$preflight_fixture_dir/private_beta_gate.json" \
  scripts/staging_observability_backup_load_smoke.sh >/dev/null
rm -rf "$preflight_fixture_dir"
python3 - "$preflight_pass_dir/out" "$preflight_sha" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
expected_sha = sys.argv[2]
if len(reports) != 1:
    raise SystemExit("passing preflight must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("status") != "passed":
    raise SystemExit(f"synthetic complete preflight should pass: {report}")
if report.get("release_sha") != expected_sha:
    raise SystemExit("passing preflight must preserve release SHA")
if report.get("blocked_slots"):
    raise SystemExit(f"passing preflight must not have blocked slots: {report.get('blocked_slots')}")
expected_summary_entries = {
    "verified_observability_entries": [
        "alert_routes",
        "backend_worker_crawler_metrics",
        "dashboard_import",
        "opentelemetry_traces",
        "request_id_propagation",
        "structured_json_logs",
    ],
    "verified_postgres_restore_entries": ["postgres_restore"],
    "verified_object_restore_entries": ["object_restore"],
    "verified_load_entries": [
        "chat_task",
        "crawler_throttle",
        "quota_contention",
        "signed_download",
        "worker_generation",
        "workspace_rendering",
        "zip_export",
    ],
    "verified_post_deploy_smoke_entries": [
        "admin",
        "auth_boundary",
        "backend_health",
        "crawler_admin",
        "export_package",
        "observability",
        "quota_rate_limit",
        "signed_download",
        "web",
        "worker_task",
    ],
}
for field, expected in expected_summary_entries.items():
    if report.get(field) != expected:
        raise SystemExit(f"passing preflight {field} mismatch: {report.get(field)}")
if report.get("missing_blockers") != []:
    raise SystemExit("passing preflight must not preserve missing blockers")
if report.get("overall_verified") is not True:
    raise SystemExit("passing preflight must set overall_verified=true")
release_gate_fixture = report.get("release_gate_fixture", {})
if release_gate_fixture.get("verified_for_aggregate_closure") is not True:
    raise SystemExit(f"passing preflight must verify the supplied gate fixture: {release_gate_fixture}")
if report.get("closure_blockers") != []:
    raise SystemExit(f"passing preflight must not preserve closure blockers: {report.get('closure_blockers')}")
gate_impact = report.get("gate_impact", {})
if gate_impact.get("can_clear_aggregate_item") is not True:
    raise SystemExit(f"passing preflight must allow aggregate closure after gate fixture update: {gate_impact}")
for check in report.get("checks", []):
    if check.get("verified") is not True:
        raise SystemExit(f"passing preflight must verify every check: {check}")
    failed = [key for key, value in check.get("semantic_checks", {}).items() if value is not True]
    if failed:
        raise SystemExit(f"passing preflight semantic checks failed for {check.get('slot')}: {failed}")
PY
python3 - "$ops_validate_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report.get("summary", {})
required_summary_keys = {
    "release_evidence",
    "post_deploy_smoke_evidence",
    "release_gate_fixtures",
    "go_no_go",
    "missing_required_categories",
    "statuses",
}
missing = sorted(required_summary_keys - set(summary))
if missing:
    raise SystemExit(f"staging smoke summary missing release gate keys: {missing}")
release_evidence = summary["release_evidence"]
required_slots = release_evidence.get("required_slots", {})
local_evidence_verification = release_evidence.get("local_evidence_verification", {})
for slot in (
    "release_sha",
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in required_slots:
        raise SystemExit(f"staging smoke release evidence missing slot {slot}")
for slot in (
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
):
    if slot not in local_evidence_verification:
        raise SystemExit(f"staging smoke local evidence verification missing slot {slot}")
    if local_evidence_verification[slot].get("verified") is not False:
        raise SystemExit(f"staging smoke dry-run must not verify missing evidence slot {slot}")
if release_evidence.get("complete") is not False:
    raise SystemExit("staging smoke dry-run must keep release evidence incomplete")
go_no_go = summary["go_no_go"]
if go_no_go.get("decision") != "no-go":
    raise SystemExit("staging smoke dry-run must remain no-go")
if go_no_go.get("release_evidence_verified") is not False:
    raise SystemExit("staging smoke dry-run must keep release evidence unverified")
if go_no_go.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("staging smoke dry-run must keep post-deploy smoke evidence unverified")
if go_no_go.get("gate_fixtures_clear") is not False:
    raise SystemExit("staging smoke dry-run must keep gate fixtures blocked")
post_deploy_smoke = summary["post_deploy_smoke_evidence"]
if post_deploy_smoke.get("verified") is not False:
    raise SystemExit("staging smoke dry-run must keep post-deploy smoke contract unverified")
if post_deploy_smoke.get("expected_evidence_kind") != "post_deploy_smoke":
    raise SystemExit("staging smoke dry-run must declare post_deploy_smoke evidence kind")
if post_deploy_smoke.get("required_environment") != "staging":
    raise SystemExit("staging smoke dry-run must declare staging environment requirement")
if "all_checks_passed" not in post_deploy_smoke.get("reason", ""):
    raise SystemExit(f"staging smoke dry-run must explain failed post-deploy checks: {post_deploy_smoke}")
blocking_reasons = go_no_go.get("blocking_reasons", [])
for reason in (
    "staging_smoke_not_passed",
    "post_deploy_smoke_contract_unverified",
    "missing_release_evidence:release_sha",
    "missing_release_evidence:release_notes_path",
    "unverified_release_evidence:release_notes_path",
    "unverified_release_evidence:image_refs",
    "missing_release_evidence:load_evidence",
    "unverified_release_evidence:load_evidence",
):
    if reason not in blocking_reasons:
        raise SystemExit(f"staging smoke dry-run missing blocking reason {reason}")
if not any(reason.startswith("gate_fixture_blocked:private_beta_staging:") for reason in blocking_reasons):
    raise SystemExit("staging smoke dry-run must include private beta gate blocking reasons")
if not any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking_reasons):
    raise SystemExit("staging smoke dry-run must include production gate blocking reasons")
decision_inputs = go_no_go.get("decision_inputs", {})
if decision_inputs.get("smoke_passed") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record smoke_passed=false")
if decision_inputs.get("profile_post_deploy") is not True:
    raise SystemExit("staging smoke default dry-run decision inputs must record profile_post_deploy=true")
if decision_inputs.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record post_deploy_smoke_verified=false")
if decision_inputs.get("release_evidence_complete") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record release_evidence_complete=false")
if decision_inputs.get("gate_fixtures_clear") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record gate_fixtures_clear=false")
for gate in ("private_beta_staging", "production_launch"):
    if gate not in summary["release_gate_fixtures"]:
        raise SystemExit(f"staging smoke missing gate fixture summary for {gate}")
for passed_check in (
    "private_beta_staging:staging_support_retry_abuse_ops",
    "private_beta_staging:staging_crawler_approval_provenance",
    "production_launch:production_abuse_throttle_hold",
):
    if f"gate_fixture_blocked:{passed_check}" in blocking_reasons:
        raise SystemExit(f"staging smoke must not report passed fixture check as blocked: {passed_check}")
PY
contract_profile_dir="$(mktemp -d)"
DRY_RUN=1 \
  STAGING_SMOKE_PROFILE=contract \
  OUT_DIR="$contract_profile_dir/staging" \
  scripts/staging_smoke.sh >/dev/null
python3 - "$contract_profile_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("contract-profile staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report["summary"]
go_no_go = summary["go_no_go"]
decision_inputs = go_no_go.get("decision_inputs", {})
if decision_inputs.get("profile_post_deploy") is not False:
    raise SystemExit(f"contract-profile staging smoke must record profile_post_deploy=false: {decision_inputs}")
if decision_inputs.get("smoke_passed") is not False:
    raise SystemExit(f"contract-profile staging smoke must not count as post-deploy smoke passed: {decision_inputs}")
if "post_deploy_profile_required" not in go_no_go.get("blocking_reasons", []):
    raise SystemExit(f"contract-profile staging smoke must block on post_deploy_profile_required: {go_no_go}")
post_deploy_smoke = summary["post_deploy_smoke_evidence"]
if post_deploy_smoke.get("verified") is not False:
    raise SystemExit("contract-profile staging smoke must not verify post-deploy smoke evidence")
semantic_checks = post_deploy_smoke.get("semantic_checks", {})
if semantic_checks.get("profile_post_deploy") is not False:
    raise SystemExit(f"contract-profile post-deploy contract must fail profile_post_deploy: {semantic_checks}")
PY
complete_validate_dir="$(mktemp -d)"
complete_sha="1234567890abcdef1234567890abcdef12345678"
cat >"$complete_validate_dir/release-notes.md" <<EOF
# Synthetic Stage 0 Rev2 Release Notes

Release SHA: $complete_sha

## Identity
## Scope
## Migration List
## Config Diff
## Feature Flags
## Smoke Plan
## Evidence
## Rollback Plan
## Known Risks
## Go/No-Go
- Decision: \`no-go\`
EOF
printf '{"release_sha":"%s","environment":"staging","kind":"migration","status":"passed"}\n' "$complete_sha" >"$complete_validate_dir/migration.json"
printf '{"release_sha":"%s","environment":"staging","kind":"config_diff","status":"reviewed"}\n' "$complete_sha" >"$complete_validate_dir/config.json"
cat >"$complete_validate_dir/observability.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "observability",
  "status": "passed",
  "signals": [
    {"name": "request_id_propagation", "status": "passed", "evidence_ref": "staging/logs/request-id-$complete_sha.json"},
    {"name": "structured_json_logs", "status": "passed", "evidence_ref": "staging/logs/json-logs-$complete_sha.json"},
    {"name": "opentelemetry_traces", "status": "passed", "trace_id": "trace-$complete_sha"},
    {"name": "backend_worker_crawler_metrics", "status": "passed", "metrics_query": "staging metrics release_sha=$complete_sha"},
    {"name": "dashboard_import", "status": "passed", "dashboard_uid": "stage0-rev2-$complete_sha"},
    {"name": "alert_routes", "status": "validated", "alert_rule_url": "https://monitoring.example.invalid/stage0/$complete_sha"}
  ]
}
EOF
cat >"$complete_validate_dir/backup.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "backup_restore",
  "status": "passed",
  "drills": [
    {"drill_id": "postgres_restore", "status": "passed", "report_path": "staging/restore/postgres-$complete_sha.json"},
    {"drill_id": "object_restore", "status": "passed", "report_path": "staging/restore/object-$complete_sha.json"}
  ]
}
EOF
cat >"$complete_validate_dir/load.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "load",
  "status": "passed",
  "modes": [
    {"name": "chat_task", "status": "passed", "load_report": "staging/load/chat-task-$complete_sha.json"},
    {"name": "worker_generation", "status": "passed", "load_report": "staging/load/worker-generation-$complete_sha.json"},
    {"name": "zip_export", "status": "passed", "load_report": "staging/load/zip-export-$complete_sha.json"},
    {"name": "signed_download", "status": "passed", "load_report": "staging/load/signed-download-$complete_sha.json"},
    {"name": "crawler_throttle", "status": "passed", "load_report": "staging/load/crawler-throttle-$complete_sha.json"},
    {"name": "quota_contention", "status": "passed", "load_report": "staging/load/quota-contention-$complete_sha.json"},
    {"name": "workspace_rendering", "status": "passed", "load_report": "staging/load/workspace-rendering-$complete_sha.json"}
  ]
}
EOF
cat >"$complete_validate_dir/rollback.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "rollback",
  "status": "validated",
  "steps": [
    {"name": "image_rollback", "status": "validated", "rollback_report": "staging/rollback/images-$complete_sha.json"},
    {"name": "feature_flag_rollback", "status": "validated", "rollback_report": "staging/rollback/flags-$complete_sha.json"},
    {"name": "migration_compatibility", "status": "validated", "rollback_report": "staging/rollback/migration-compat-$complete_sha.json"},
    {"name": "worker_drain", "status": "validated", "rollback_report": "staging/rollback/worker-drain-$complete_sha.json"},
    {"name": "post_rollback_smoke", "status": "passed", "smoke_report": "staging/rollback/post-smoke-$complete_sha.json"}
  ]
}
EOF
cat >"$complete_validate_dir/security.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "staging",
  "kind": "security_scan",
  "status": "passed",
  "scans": [
    {"name": "dependency_scan", "status": "passed", "scan_report": "staging/security/dependencies-$complete_sha.json"},
    {"name": "image_scan", "status": "passed", "scan_report": "staging/security/images-$complete_sha.json"},
    {"name": "secret_scan", "status": "passed", "scan_report": "staging/security/secrets-$complete_sha.json"}
  ]
}
EOF
DRY_RUN=1 \
  OUT_DIR="$complete_validate_dir/staging" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenart-backend:$complete_sha,ghcr.io/alphane-ai/zenart-web:$complete_sha,ghcr.io/alphane-ai/zenart-admin:$complete_sha" \
  MIGRATION_EVIDENCE="$complete_validate_dir/migration.json" \
  CONFIG_DIFF_EVIDENCE="$complete_validate_dir/config.json" \
  OBSERVABILITY_EVIDENCE="$complete_validate_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$complete_validate_dir/backup.json" \
  LOAD_EVIDENCE="$complete_validate_dir/load.json" \
  ROLLBACK_EVIDENCE="$complete_validate_dir/rollback.json" \
  SECURITY_SCAN_EVIDENCE="$complete_validate_dir/security.json" \
  scripts/staging_smoke.sh >/dev/null
python3 - "$complete_validate_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("complete-evidence staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report["summary"]
release_evidence = summary["release_evidence"]
go_no_go = summary["go_no_go"]
if release_evidence.get("complete") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify all local evidence slots")
post_deploy_smoke = summary["post_deploy_smoke_evidence"]
if post_deploy_smoke.get("verified") is not False:
    raise SystemExit("complete-evidence dry-run must keep post-deploy smoke unverified without runtime URLs and seeded smoke records")
if "all_checks_passed" not in post_deploy_smoke.get("reason", ""):
    raise SystemExit(f"complete-evidence dry-run must block on post-deploy smoke checks: {post_deploy_smoke}")
for slot, evidence in release_evidence.get("local_evidence_verification", {}).items():
    if slot in {
        "migration_evidence",
        "config_diff_evidence",
        "observability_evidence",
        "backup_restore_evidence",
        "load_evidence",
        "rollback_evidence",
        "security_scan_evidence",
    }:
        checks = evidence.get("semantic_checks", {})
        failed = sorted(key for key, value in checks.items() if value is not True)
        if failed:
            raise SystemExit(f"{slot} semantic checks failed in complete-evidence dry-run: {failed}")
if release_evidence["local_evidence_verification"]["observability_evidence"].get("observability_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify observability signal contract")
observability_refs = release_evidence["local_evidence_verification"]["observability_evidence"]["observability_contract"].get("evidence_refs", {})
if sorted(observability_refs) != [
    "alert_routes",
    "backend_worker_crawler_metrics",
    "dashboard_import",
    "opentelemetry_traces",
    "request_id_propagation",
    "structured_json_logs",
]:
    raise SystemExit(f"complete-evidence staging smoke must expose observability evidence refs: {observability_refs}")
if not all(observability_refs[key] for key in observability_refs):
    raise SystemExit(f"complete-evidence staging smoke must expose non-empty observability refs: {observability_refs}")
if release_evidence["local_evidence_verification"]["backup_restore_evidence"].get("backup_restore_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify backup/restore drill contract")
if release_evidence["local_evidence_verification"]["load_evidence"].get("load_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify load mode contract")
if release_evidence["local_evidence_verification"]["rollback_evidence"].get("rollback_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify rollback contract")
if release_evidence["local_evidence_verification"]["security_scan_evidence"].get("security_scan_contract", {}).get("verified") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must verify security scan contract")
for contract_name, expected_keys in {
    "backup_restore_contract": {"postgres_restore", "object_restore"},
    "load_contract": {"chat_task", "worker_generation", "zip_export", "signed_download", "crawler_throttle", "quota_contention", "workspace_rendering"},
    "rollback_contract": {"image_rollback", "feature_flag_rollback", "migration_compatibility", "worker_drain", "post_rollback_smoke"},
    "security_scan_contract": {"dependency_scan", "image_scan", "secret_scan"},
}.items():
    owner_slot = {
        "backup_restore_contract": "backup_restore_evidence",
        "load_contract": "load_evidence",
        "rollback_contract": "rollback_evidence",
        "security_scan_contract": "security_scan_evidence",
    }[contract_name]
    refs = release_evidence["local_evidence_verification"][owner_slot][contract_name].get("evidence_refs", {})
    if set(refs) != expected_keys:
        raise SystemExit(f"{contract_name} must expose evidence refs for every required entry: {refs}")
    if not all(refs[key] for key in refs):
        raise SystemExit(f"{contract_name} evidence refs must be non-empty: {refs}")
if go_no_go.get("release_evidence_complete") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must expose release_evidence_complete=true")
if go_no_go.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("complete-evidence staging smoke dry-run must expose post_deploy_smoke_verified=false")
if go_no_go.get("gate_fixtures_clear") is not False:
    raise SystemExit("complete-evidence staging smoke dry-run must keep gate_fixtures_clear=false")
if go_no_go.get("decision") != "no-go":
    raise SystemExit("complete-evidence staging smoke dry-run must remain no-go while gate fixtures are blocked")
blocked = go_no_go.get("blocked_conditions", [])
if not any(item.startswith("private_beta_staging:") for item in blocked):
    raise SystemExit("complete-evidence staging smoke dry-run must include private beta blockers")
if not any(item.startswith("production_launch:") for item in blocked):
    raise SystemExit("complete-evidence staging smoke dry-run must include production blockers")
blocking_reasons = go_no_go.get("blocking_reasons", [])
if "staging_smoke_not_passed" not in blocking_reasons:
    raise SystemExit("complete-evidence staging smoke dry-run must still block on missing runtime smoke pass")
if "post_deploy_smoke_contract_unverified" not in blocking_reasons:
    raise SystemExit("complete-evidence staging smoke dry-run must still block on unverified post-deploy smoke evidence")
if any(reason.startswith("missing_release_evidence:") for reason in blocking_reasons):
    raise SystemExit(f"complete-evidence staging smoke dry-run must not report missing release evidence: {blocking_reasons}")
if any(reason.startswith("unverified_release_evidence:") for reason in blocking_reasons):
    raise SystemExit(f"complete-evidence staging smoke dry-run must not report unverified release evidence: {blocking_reasons}")
if not any(reason.startswith("gate_fixture_blocked:private_beta_staging:") for reason in blocking_reasons):
    raise SystemExit("complete-evidence staging smoke dry-run must include private beta gate blocking reasons")
if not any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking_reasons):
    raise SystemExit("complete-evidence staging smoke dry-run must include production gate blocking reasons")
decision_inputs = go_no_go.get("decision_inputs", {})
if decision_inputs != {
    "profile_post_deploy": True,
    "smoke_passed": False,
    "post_deploy_smoke_verified": False,
    "release_evidence_complete": True,
    "gate_fixtures_clear": False,
}:
    raise SystemExit(f"complete-evidence staging smoke decision inputs mismatch: {decision_inputs}")
PY
set +e
DRY_RUN=1 \
  OUT_DIR="$complete_validate_dir/release-bundle" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenart-backend:$complete_sha,ghcr.io/alphane-ai/zenart-web:$complete_sha,ghcr.io/alphane-ai/zenart-admin:$complete_sha" \
  MIGRATION_EVIDENCE="$complete_validate_dir/migration.json" \
  CONFIG_DIFF_EVIDENCE="$complete_validate_dir/config.json" \
  OBSERVABILITY_EVIDENCE="$complete_validate_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$complete_validate_dir/backup.json" \
  LOAD_EVIDENCE="$complete_validate_dir/load.json" \
  ROLLBACK_EVIDENCE="$complete_validate_dir/rollback.json" \
  SECURITY_SCAN_EVIDENCE="$complete_validate_dir/security.json" \
  scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_complete_status=$?
set -e
if [[ "$release_bundle_complete_status" -ne 2 ]]; then
  printf 'complete-evidence release bundle must remain no-go with blocked gate fixtures, got %s\n' "$release_bundle_complete_status" >&2
  exit 1
fi
python3 - "$complete_validate_dir/release-bundle" "$complete_sha" <<'PY'
import json
import sys
from pathlib import Path

out_dir = Path(sys.argv[1])
reports = [
    path
    for path in sorted(out_dir.glob("*.json"))
    if json.loads(path.read_text(encoding="utf-8")).get("kind") == "release_evidence_bundle"
]
expected_sha = sys.argv[2]
if len(reports) != 1:
    raise SystemExit("complete-evidence release bundle dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "release_evidence_bundle":
    raise SystemExit(f"complete-evidence release bundle report has wrong kind: {report}")
if report.get("status") != "blocked":
    raise SystemExit("complete-evidence release bundle must remain blocked while gate fixtures are no-go")
if report.get("decision") != "no-go":
    raise SystemExit("complete-evidence release bundle must preserve no-go decision")
if report.get("release_sha") != expected_sha:
    raise SystemExit(f"complete-evidence release bundle must forward release SHA: {report}")
if report.get("release_evidence_complete") is not True:
    raise SystemExit("complete-evidence release bundle must forward and verify all release evidence slots")
if report.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("complete-evidence release bundle must not verify runtime post-deploy smoke from dry-run evidence")
if report.get("object_retention_cleanup_verified") is not False:
    raise SystemExit("complete-evidence release bundle must not verify object-retention cleanup from dry-run evidence")
object_retention_probe = report.get("object_retention_cleanup_probe", {})
if object_retention_probe.get("status") != "blocked":
    raise SystemExit("complete-evidence release bundle must surface blocked object-retention cleanup status")
if set(object_retention_probe.get("required_checks", [])) != {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}:
    raise SystemExit("complete-evidence release bundle must surface object-retention required checks")
runtime_requirements = object_retention_probe.get("runtime_input_requirements", {})
if runtime_requirements.get("required_release_sha") != "d3b1107c33dc40b8936f28549e06553fbd7b104a":
    raise SystemExit("complete-evidence release bundle must surface required object-retention release SHA")
if runtime_requirements.get("required_base_url") != "STAGING_BASE_URL or explicit probe URL env vars":
    raise SystemExit("complete-evidence release bundle must surface staging URL requirement for object-retention probe")
if "ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE" not in runtime_requirements.get("required_auth", ""):
    raise SystemExit("complete-evidence release bundle must surface admin auth requirement for object-retention probe")
if "SMOKE_ADMIN_USER_ID" not in runtime_requirements.get("required_smoke_admin_user_id", ""):
    raise SystemExit("complete-evidence release bundle must surface admin user requirement for object-retention probe")
if "SMOKE_ADMIN_TENANT_ID" not in runtime_requirements.get("required_smoke_admin_tenant_id", ""):
    raise SystemExit("complete-evidence release bundle must surface admin tenant requirement for object-retention probe")
if "X-Request-ID" not in runtime_requirements.get("required_request_id_echo", ""):
    raise SystemExit("complete-evidence release bundle must surface request-id echo requirement for object-retention probe")
if runtime_requirements.get("canonical_pass_report") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit("complete-evidence release bundle must surface canonical object-retention pass report path")
split_evidence = object_retention_probe.get("split_evidence", {})
if split_evidence.get("signed_url_ready") is not True:
    raise SystemExit("complete-evidence release bundle must surface signed URL split readiness")
if split_evidence.get("retention_cleanup_ready") is not False:
    raise SystemExit("complete-evidence release bundle must keep retention cleanup readiness false")
if report.get("legal_support_visibility_verified") is not True:
    raise SystemExit("complete-evidence release bundle must verify legal/support from canonical staging split evidence")
if report.get("legal_support_split_reports_verified") is not True:
    raise SystemExit("complete-evidence release bundle must verify legal/support split reports from canonical staging evidence")
if report.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("complete-evidence release bundle must cite canonical staging legal/support split evidence")
if report.get("gate_fixtures_clear") is not False:
    raise SystemExit("complete-evidence release bundle must keep gate fixtures blocked")
if report.get("missing_slots"):
    raise SystemExit(f"complete-evidence release bundle must not report missing slots: {report.get('missing_slots')}")
if report.get("unverified_slots"):
    raise SystemExit(f"complete-evidence release bundle must not report unverified slots: {report.get('unverified_slots')}")
blocking = report.get("blocking_reasons", [])
if any(reason.startswith("missing_release_evidence:") for reason in blocking):
    raise SystemExit(f"complete-evidence release bundle must not report missing release evidence: {blocking}")
if any(reason.startswith("unverified_release_evidence:") for reason in blocking):
    raise SystemExit(f"complete-evidence release bundle must not report unverified release evidence: {blocking}")
for reason in (
    "staging_smoke_not_passed",
    "post_deploy_smoke_contract_unverified",
    "object_storage_retention_cleanup_not_passed",
):
    if reason not in blocking:
        raise SystemExit(f"complete-evidence release bundle missing runtime blocker {reason}: {blocking}")
if not any(reason.startswith("gate_fixture_blocked:private_beta_staging:") for reason in blocking):
    raise SystemExit("complete-evidence release bundle must preserve private beta fixture blockers")
if not any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking):
    raise SystemExit("complete-evidence release bundle must preserve production fixture blockers")
if not report.get("source_staging_smoke_report"):
    raise SystemExit("complete-evidence release bundle must cite source staging smoke report")
if not Path(report["source_staging_smoke_report"]).exists():
    raise SystemExit("complete-evidence release bundle must preserve source staging smoke report")
if not Path(report["source_staging_smoke_results"]).exists():
    raise SystemExit("complete-evidence release bundle must preserve source staging smoke results")
if not Path(report["source_object_retention_cleanup_report"]).exists():
    raise SystemExit("complete-evidence release bundle must preserve object-retention report")
if not Path(report["source_object_retention_cleanup_results"]).exists():
    raise SystemExit("complete-evidence release bundle must preserve object-retention results")
if report.get("source_object_retention_cleanup_results") != object_retention_probe.get("results_path"):
    raise SystemExit("complete-evidence release bundle must cite object-retention report-declared results path")
if not Path(report["source_legal_support_visibility_report"]).exists():
    raise SystemExit("complete-evidence release bundle must preserve legal/support visibility report")
if not Path(report["source_legal_support_visibility_results"]).exists():
    raise SystemExit("complete-evidence release bundle must preserve legal/support visibility results")
if report.get("source_legal_pages_external_user_report") is None:
    raise SystemExit("complete-evidence release bundle must cite legal-pages split report path")
if report.get("source_support_contact_external_user_report") is None:
    raise SystemExit("complete-evidence release bundle must cite support-contact split report path")
split_inputs = report.get("split_probe_decision_inputs", {})
if split_inputs.get("legal_pages_external_user_verified") is not False:
    raise SystemExit("complete-evidence release bundle must keep legal-pages split evidence unverified")
if split_inputs.get("support_contact_external_user_verified") is not False:
    raise SystemExit("complete-evidence release bundle must keep support-contact split evidence unverified")
if split_inputs.get("canonical_legal_pages_external_user_verified") is not True:
    raise SystemExit("complete-evidence release bundle must recognize canonical legal-pages split evidence")
if split_inputs.get("canonical_support_contact_external_user_verified") is not True:
    raise SystemExit("complete-evidence release bundle must recognize canonical support-contact split evidence")
if split_inputs.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("complete-evidence release bundle must report canonical staging legal/support evidence source")
PY
nested_only_dir="$(mktemp -d)"
cat >"$nested_only_dir/observability.json" <<EOF
{
  "release_sha": "$complete_sha",
  "environment": "qa",
  "kind": "ops_bundle",
  "status": "failed",
  "signals": [
    {"name": "request_id_propagation", "status": "passed", "evidence_ref": "staging/logs/request-id-$complete_sha.json"},
    {"name": "structured_json_logs", "status": "passed", "evidence_ref": "staging/logs/json-logs-$complete_sha.json"},
    {"name": "opentelemetry_traces", "status": "passed", "trace_id": "trace-$complete_sha"},
    {"name": "backend_worker_crawler_metrics", "status": "passed", "metrics_query": "staging metrics release_sha=$complete_sha"},
    {"name": "dashboard_import", "status": "passed", "dashboard_uid": "stage0-rev2-$complete_sha"},
    {"name": "alert_routes", "status": "validated", "alert_rule_url": "https://monitoring.example.invalid/stage0/$complete_sha"}
  ]
}
EOF
DRY_RUN=1 \
  OUT_DIR="$nested_only_dir/staging" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenart-backend:$complete_sha,ghcr.io/alphane-ai/zenart-web:$complete_sha,ghcr.io/alphane-ai/zenart-admin:$complete_sha" \
  MIGRATION_EVIDENCE="$complete_validate_dir/migration.json" \
  CONFIG_DIFF_EVIDENCE="$complete_validate_dir/config.json" \
  OBSERVABILITY_EVIDENCE="$nested_only_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$complete_validate_dir/backup.json" \
  LOAD_EVIDENCE="$complete_validate_dir/load.json" \
  ROLLBACK_EVIDENCE="$complete_validate_dir/rollback.json" \
  SECURITY_SCAN_EVIDENCE="$complete_validate_dir/security.json" \
  scripts/staging_smoke.sh >/dev/null
python3 - "$nested_only_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("nested-only staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report["summary"]
release_evidence = summary["release_evidence"]
observability = release_evidence["local_evidence_verification"]["observability_evidence"]
semantic_checks = observability.get("semantic_checks", {})
for key in ("environment_staging", "evidence_kind_match", "status_accepted"):
    if semantic_checks.get(key) is not False:
        raise SystemExit(f"nested-only observability evidence must fail top-level {key}: {semantic_checks}")
if observability.get("observability_contract", {}).get("verified") is not True:
    raise SystemExit("nested-only observability sub-signals should still be recognized independently")
if observability.get("verified") is not False:
    raise SystemExit(f"nested-only observability evidence must not verify from nested metadata: {observability}")
if release_evidence.get("complete") is not False:
    raise SystemExit("nested-only staging smoke must reject release evidence with wrong top-level metadata")
if "unverified_release_evidence:observability_evidence" not in summary["go_no_go"].get("blocking_reasons", []):
    raise SystemExit("nested-only staging smoke must block on unverified observability evidence")
PY
incomplete_contract_dir="$(mktemp -d)"
printf '{"release_sha":"%s","environment":"staging","kind":"observability","status":"passed","signals":[{"name":"request_id_propagation","status":"passed","evidence_ref":"only-one-signal.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/observability.json"
printf '{"release_sha":"%s","environment":"staging","kind":"backup_restore","status":"passed","drills":[{"drill_id":"postgres_restore","status":"passed","report_path":"postgres.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/backup.json"
printf '{"release_sha":"%s","environment":"staging","kind":"load","status":"passed","modes":[{"name":"chat_task","status":"passed","load_report":"chat-task.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/load.json"
printf '{"release_sha":"%s","environment":"staging","kind":"rollback","status":"validated","steps":[{"name":"image_rollback","status":"validated","rollback_report":"image.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/rollback.json"
printf '{"release_sha":"%s","environment":"staging","kind":"security_scan","status":"passed","scans":[{"name":"dependency_scan","status":"passed","scan_report":"dependencies.json"}]}\n' "$complete_sha" >"$incomplete_contract_dir/security.json"
DRY_RUN=1 \
  OUT_DIR="$incomplete_contract_dir/staging" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenart-backend:$complete_sha,ghcr.io/alphane-ai/zenart-web:$complete_sha,ghcr.io/alphane-ai/zenart-admin:$complete_sha" \
  MIGRATION_EVIDENCE="$complete_validate_dir/migration.json" \
  CONFIG_DIFF_EVIDENCE="$complete_validate_dir/config.json" \
  OBSERVABILITY_EVIDENCE="$incomplete_contract_dir/observability.json" \
  BACKUP_RESTORE_EVIDENCE="$incomplete_contract_dir/backup.json" \
  LOAD_EVIDENCE="$incomplete_contract_dir/load.json" \
  ROLLBACK_EVIDENCE="$incomplete_contract_dir/rollback.json" \
  SECURITY_SCAN_EVIDENCE="$incomplete_contract_dir/security.json" \
  scripts/staging_smoke.sh >/dev/null
python3 - "$incomplete_contract_dir/staging" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("incomplete-contract staging smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
summary = report["summary"]
release_evidence = summary["release_evidence"]
if release_evidence.get("complete") is not False:
    raise SystemExit("incomplete-contract staging smoke dry-run must reject incomplete observability/restore contracts")
verification = release_evidence["local_evidence_verification"]
observability = verification["observability_evidence"]
backup = verification["backup_restore_evidence"]
load = verification["load_evidence"]
rollback = verification["rollback_evidence"]
security = verification["security_scan_evidence"]
if observability.get("verified") is not False or "observability_contract" not in observability.get("reason", ""):
    raise SystemExit(f"incomplete observability contract must be unverified: {observability}")
if backup.get("verified") is not False or "backup_restore_contract" not in backup.get("reason", ""):
    raise SystemExit(f"incomplete backup/restore contract must be unverified: {backup}")
if load.get("verified") is not False or "load_contract" not in load.get("reason", ""):
    raise SystemExit(f"incomplete load contract must be unverified: {load}")
if rollback.get("verified") is not False or "rollback_contract" not in rollback.get("reason", ""):
    raise SystemExit(f"incomplete rollback contract must be unverified: {rollback}")
if security.get("verified") is not False or "security_scan_contract" not in security.get("reason", ""):
    raise SystemExit(f"incomplete security scan contract must be unverified: {security}")
if "unverified_release_evidence:observability_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete observability evidence must block go/no-go")
if "unverified_release_evidence:backup_restore_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete backup/restore evidence must block go/no-go")
if "unverified_release_evidence:load_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete load evidence must block go/no-go")
if "unverified_release_evidence:rollback_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete rollback evidence must block go/no-go")
if "unverified_release_evidence:security_scan_evidence" not in summary["go_no_go"]["blocking_reasons"]:
    raise SystemExit("incomplete security scan evidence must block go/no-go")
PY
python3 - "$ops_validate_dir/object-storage" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("object-storage signed URL smoke must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "object_storage_signed_url":
    raise SystemExit(f"object-storage signed URL report has wrong kind: {report}")
if report.get("status") != "pass_with_blockers_preserved":
    raise SystemExit("object-storage signed URL report must pass while preserving blockers")
if report.get("release_gate_check_id") != "staging_object_storage_signed_downloads":
    raise SystemExit("object-storage signed URL report must target the object-storage release check")
if report.get("do_not_launch_condition_id") != "object_storage_signed_retention_runtime_missing":
    raise SystemExit("object-storage signed URL report must preserve the object-storage Do-Not-Launch condition")
areas = {item["area"]: item for item in report.get("coverage", [])}
expected = {
    "tenant_scoped_signed_download",
    "expiry_denial",
    "direct_object_denial",
    "cross_tenant_denial",
}
if set(areas) != expected:
    raise SystemExit(f"object-storage signed URL coverage mismatch: {sorted(areas)}")
for area, item in areas.items():
    if item.get("status") != "pass":
        raise SystemExit(f"{area} object-storage coverage must pass")
    refs = set(item.get("evidence_refs", []))
    for ref in (
        "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json",
        "ops/evidence/staging/20260527T2115Z-backup-restore.json",
        "ops/evidence/staging/20260527T2120Z-load.json",
    ):
        if ref not in refs:
            raise SystemExit(f"{area} object-storage coverage missing source ref {ref}")
retention = report.get("retention_cleanup_gate", {})
if retention.get("status") != "blocked":
    raise SystemExit("object-storage signed URL smoke must keep retention cleanup blocked")
gate = report.get("gate_impact", {})
if gate.get("can_clear_signed_url_checklist_item") is not True:
    raise SystemExit("object-storage signed URL smoke must clear only the signed URL subitem")
if gate.get("can_clear_release_gate_check") is not False:
    raise SystemExit("object-storage signed URL smoke must not clear the release gate check")
if gate.get("remaining_release_gate_blockers") != [
    "staging_object_storage_signed_downloads",
    "staging_legal_external_user_pages",
]:
    raise SystemExit("object-storage signed URL smoke must preserve object-storage and legal blockers")
PY
python3 - "$ops_validate_dir/object-storage-retention" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("object-storage retention cleanup dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "object_storage_retention_cleanup":
    raise SystemExit(f"object-storage retention cleanup report has wrong kind: {report}")
if report.get("environment") != "staging":
    raise SystemExit("object-storage retention cleanup report must be staging-scoped")
if report.get("status") != "blocked":
    raise SystemExit("object-storage retention cleanup dry-run must remain blocked")
if report.get("release_gate_check_id") != "staging_object_storage_signed_downloads":
    raise SystemExit("object-storage retention cleanup report must target the object-storage release check")
if report.get("do_not_launch_condition_id") != "object_storage_signed_retention_runtime_missing":
    raise SystemExit("object-storage retention cleanup report must target the object-storage Do-Not-Launch condition")
areas = {item["area"]: item for item in report.get("coverage", [])}
expected = {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}
if set(areas) != expected:
    raise SystemExit(f"object-storage retention cleanup coverage mismatch: {sorted(areas)}")
if not report.get("blocked_checks"):
    raise SystemExit("object-storage retention cleanup dry-run must record blocked checks")
gate = report.get("gate_impact", {})
if gate.get("can_clear_retention_cleanup_checklist_item") is not False:
    raise SystemExit("object-storage retention cleanup dry-run must not clear the checklist item")
if gate.get("can_clear_release_gate_check") is not False:
    raise SystemExit("object-storage retention cleanup dry-run must not clear the release gate check")
split = report.get("split_evidence", {})
if split.get("signed_url_ready") is not True:
    raise SystemExit("object-storage retention cleanup dry-run must recognize existing signed URL split evidence")
if split.get("signed_url_release_sha") != "d3b1107c33dc40b8936f28549e06553fbd7b104a":
    raise SystemExit("object-storage retention cleanup dry-run must carry signed URL release SHA")
if split.get("release_sha_matches_signed_url") is not False:
    raise SystemExit("object-storage retention cleanup dry-run without release SHA must preserve release binding blocker")
if split.get("retention_cleanup_runtime_ready") is not False:
    raise SystemExit("object-storage retention cleanup dry-run must keep retention cleanup runtime unready")
if split.get("retention_cleanup_ready") is not False:
    raise SystemExit("object-storage retention cleanup dry-run must keep retention cleanup unready")
if split.get("canonical_pass_paths") is not False:
    raise SystemExit("object-storage retention cleanup dry-run using validation paths must not claim canonical pass paths")
if gate.get("remaining_release_gate_blockers_after_pass") != ["staging_object_storage_signed_downloads"]:
    raise SystemExit("object-storage retention cleanup dry-run must preserve only the object-storage blocker")
if gate.get("preserved_release_gate_check_id") != "staging_object_storage_signed_downloads":
    raise SystemExit("object-storage retention cleanup dry-run must preserve the object-storage gate")
if gate.get("preserved_do_not_launch_condition_id") != "object_storage_signed_retention_runtime_missing":
    raise SystemExit("object-storage retention cleanup dry-run must preserve the matching Do-Not-Launch condition")
for item in areas.values():
    for key in ("release_sha_bound", "admin_identity_bound", "request_ids", "response_bytes"):
        if key not in item:
            raise SystemExit(f"{item['area']} retention cleanup coverage missing {key}")
    for result in item.get("source_results", []):
        if "request_id_echoed" not in result or "response_request_id_values" not in result:
            raise SystemExit(f"{item['area']} retention cleanup source result missing request-id echo fields")
    combined = json.dumps(item).lower()
    for token in ("ops/evidence/staging", "retention", "audit"):
        if token not in combined:
            raise SystemExit(f"{item['area']} retention cleanup coverage missing {token}")
PY
python3 - "$ops_validate_dir/legal-support" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("legal/support visibility dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
if report.get("kind") != "legal_support_visibility":
    raise SystemExit(f"legal/support visibility report has wrong kind: {report}")
if report.get("environment") != "staging":
    raise SystemExit("legal/support visibility report must be staging-scoped")
if report.get("status") != "blocked":
    raise SystemExit("legal/support visibility dry-run must remain blocked")
if report.get("release_gate_check_id") != "staging_legal_external_user_pages":
    raise SystemExit("legal/support visibility report must target the private beta legal/support release-gate check")
if report.get("do_not_launch_condition_id") != "external_user_legal_pages_missing":
    raise SystemExit("legal/support visibility report must target the legal/support Do-Not-Launch condition")
areas = {item["area"]: item for item in report.get("coverage", [])}
if set(areas) != {"legal_pages_visibility", "support_contact_visibility"}:
    raise SystemExit(f"legal/support visibility coverage mismatch: {sorted(areas)}")
required_routes = {
    "/legal/terms",
    "/legal/privacy",
    "/legal/acceptable-use",
    "/legal/ip-complaints",
    "/support",
    "/legal/billing-policy",
}
if set(report.get("required_routes", [])) != required_routes:
    raise SystemExit(f"legal/support visibility required routes mismatch: {report.get('required_routes')}")
if not report.get("blocked_checks"):
    raise SystemExit("legal/support visibility dry-run must record blocked checks")
gate = report.get("gate_impact", {})
if gate.get("can_clear_release_gate_check") is not False:
    raise SystemExit("legal/support visibility dry-run must not clear the release gate check")
if gate.get("can_clear_aggregate_item") is not False:
    raise SystemExit("legal/support visibility must not clear aggregate private beta readiness by itself")
if gate.get("preserved_release_gate_check_id") != "staging_object_storage_signed_downloads":
    raise SystemExit("legal/support visibility must preserve object-storage retention cleanup as a separate blocker")
if gate.get("preserved_do_not_launch_condition_id") != "object_storage_signed_retention_runtime_missing":
    raise SystemExit("legal/support visibility must preserve object-storage retention Do-Not-Launch condition")
for item in areas.values():
    combined = json.dumps(item).lower()
    for token in ("external-user", "ops/evidence/staging", "source files alone do not satisfy"):
        if token not in combined:
            raise SystemExit(f"{item['area']} legal/support coverage missing {token}")
PY
legal_support_pass_dir="$(mktemp -d)"
legal_support_web_dir="$legal_support_pass_dir/web"
mkdir -p "$legal_support_web_dir/legal/terms" \
  "$legal_support_web_dir/legal/privacy" \
  "$legal_support_web_dir/legal/acceptable-use" \
  "$legal_support_web_dir/legal/ip-complaints" \
  "$legal_support_web_dir/legal/billing-policy" \
  "$legal_support_web_dir/support"
cat >"$legal_support_web_dir/legal/terms/index.html" <<'EOF'
Terms of Service
Support
Local Alpha Generation
EOF
cat >"$legal_support_web_dir/legal/privacy/index.html" <<'EOF'
Privacy Policy
Support Context
Telemetry
EOF
cat >"$legal_support_web_dir/legal/acceptable-use/index.html" <<'EOF'
Acceptable Use Policy
Prohibited Inputs
Enforcement
EOF
cat >"$legal_support_web_dir/legal/ip-complaints/index.html" <<'EOF'
IP Complaint Flow
legal@zenart.local
support@zenart.local
EOF
cat >"$legal_support_web_dir/support/index.html" <<'EOF'
AI Content Responsibility
Acceptable Use Policy
Local alpha previews
support@zenart.local
Report Problem
Submit Ticket
EOF
cat >"$legal_support_web_dir/legal/billing-policy/index.html" <<'EOF'
Billing, Cancellation, and Refund Policy
support@zenart.local
Cancellation
EOF
legal_support_port="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
python3 -m http.server "$legal_support_port" --bind 127.0.0.1 --directory "$legal_support_web_dir" >"$legal_support_pass_dir/server.log" 2>&1 &
legal_support_server_pid=$!
for _ in $(seq 1 50); do
  if curl --silent --show-error --max-time 1 "http://127.0.0.1:$legal_support_port/legal/terms/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! curl --silent --show-error --max-time 1 "http://127.0.0.1:$legal_support_port/legal/terms/" >/dev/null 2>&1; then
  kill "$legal_support_server_pid" 2>/dev/null || true
  printf 'failed to start local legal/support visibility fixture server\n' >&2
  cat "$legal_support_pass_dir/server.log" >&2 || true
  exit 1
fi
RUN_ID="stage0-validate-legal-support-pass" \
  OUT_DIR="$legal_support_pass_dir/out" \
  WEB_URL="http://127.0.0.1:$legal_support_port" \
  RELEASE_SHA="legal-support-visibility-sha" \
  scripts/staging_legal_support_visibility_smoke.sh >/dev/null
kill "$legal_support_server_pid" 2>/dev/null || true
python3 - "$legal_support_pass_dir/out" <<'PY'
import json
import sys
from pathlib import Path

out_dir = Path(sys.argv[1])
reports = sorted(out_dir.glob("*.json"))
if len(reports) != 3:
    raise SystemExit(f"legal/support visibility pass fixture must write combined plus two split reports, got {len(reports)}")
report = next(
    json.loads(path.read_text(encoding="utf-8"))
    for path in reports
    if path.name == "stage0-validate-legal-support-pass.json"
)
if report.get("status") != "pass":
    raise SystemExit(f"legal/support visibility pass fixture should pass: {report}")
if report.get("release_gate_check_id") != "staging_legal_external_user_pages":
    raise SystemExit("legal/support visibility pass fixture must target legal/support release check")
if report.get("blocked_checks") != []:
    raise SystemExit(f"legal/support visibility pass fixture must not preserve legal blockers: {report.get('blocked_checks')}")
gate = report.get("gate_impact", {})
if gate.get("can_clear_release_gate_check") is not True:
    raise SystemExit("legal/support visibility pass fixture must allow the check-level gate to clear")
if gate.get("remaining_release_gate_blockers_after_pass") != ["staging_object_storage_signed_downloads"]:
    raise SystemExit("legal/support visibility pass fixture must keep object-storage retention cleanup as the remaining blocker")
areas = {item["area"]: item for item in report.get("coverage", [])}
if any(item.get("status") != "pass" for item in areas.values()):
    raise SystemExit(f"legal/support visibility pass fixture coverage must pass: {areas}")
split_expectations = {
    "legal-pages-external-user.json": {
        "kind": "legal_pages_external_user_visibility",
        "tokens": ("terms", "privacy", "acceptable use", "ai/content", "ip complaint"),
    },
    "support-contact-external-user.json": {
        "kind": "support_contact_external_user_visibility",
        "tokens": ("support", "report-problem", "external user"),
    },
}
for name, expectation in split_expectations.items():
    path = out_dir / name
    if not path.exists():
        raise SystemExit(f"legal/support visibility pass fixture missing split report {name}")
    split = json.loads(path.read_text(encoding="utf-8"))
    if split.get("environment") != "staging":
        raise SystemExit(f"{name} must be staging-scoped")
    if split.get("status") != "pass":
        raise SystemExit(f"{name} must pass")
    if split.get("kind") != expectation["kind"]:
        raise SystemExit(f"{name} kind mismatch: {split.get('kind')}")
    if split.get("release_gate_check_id") != "staging_legal_external_user_pages":
        raise SystemExit(f"{name} must target legal/support release check")
    gate = split.get("gate_impact", {})
    if gate.get("can_clear_check_level_item") is not True:
        raise SystemExit(f"{name} must allow its check-level checklist item to clear")
    combined = json.dumps(split, ensure_ascii=False).lower()
    missing = [token for token in expectation["tokens"] if token not in combined]
    if missing:
        raise SystemExit(f"{name} missing split evidence tokens: {missing}")
PY
python3 - "$ops_validate_dir/observability" <<'PY'
import json
import sys
from pathlib import Path

reports = sorted(Path(sys.argv[1]).glob("*.json"))
if len(reports) != 1:
    raise SystemExit("observability smoke dry-run must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
required_checks = {
    "request_id_response_header_echo",
    "request_id_json_body_echo",
	"json_response_body",
	"structured_log_json_handler_declared",
	"access_log_request_context_declared",
	"compose_log_format_json_declared",
    "recover_log_includes_request_id",
    "metrics_config_declared",
    "metrics_runtime_endpoint_passed",
    "otel_config_declared",
    "otel_runtime_instrumentation_detected",
    "dashboard_definition_validated",
    "alert_definition_validated",
}
required_signals = {
    "request_id_propagation",
    "structured_json_logs",
    "opentelemetry_traces",
    "backend_worker_crawler_metrics",
    "dashboards",
    "alerts",
}
missing_checks = sorted(required_checks - set(report.get("checks", {})))
missing_signals = sorted(required_signals - set(report.get("signal_statuses", {})))
if missing_checks:
    raise SystemExit(f"observability smoke report missing checks: {missing_checks}")
if missing_signals:
    raise SystemExit(f"observability smoke report missing signal statuses: {missing_signals}")
if "private_beta_gate" not in report or "production_gate" not in report:
    raise SystemExit("observability smoke report must keep launch gates explicit")
if report.get("status") != "planned":
    raise SystemExit("observability dry-run report must remain planned, not runtime-passed")
PY

log "secret scan smoke"
if has_cmd git; then
  secret_candidates="$(mktemp)"
  secret_findings="$(mktemp)"
  git grep -nE '(^|[^A-Za-z0-9_-])(AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,})' -- . >"$secret_candidates" || true
  grep -E '(^|[^A-Za-z0-9_-])(AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,})|[A-Za-z_]*(secret|token|key)[A-Za-z_]*[[:space:]]*[:=]' "$secret_candidates" >"$secret_findings" || true
  grep -Ev '^(\.env\.example|fixtures/.*|schemas/.*|ops/ci/stage0-rev2-ci\.yml|scripts/repo_validate\.sh|scripts/security_scan_smoke\.sh|backend/internal/security/redact_test\.go):|^backend/internal/server/server_test\.go:[0-9]+:.*sk-proj-abcdefghijklmnopqrstuvwxyz123456|^backend/internal/stage0/services_test\.go:[0-9]+:.*sk-ant-abcdefghijklmnopqrstuvwxyz123456' "$secret_findings" >"$secret_candidates.filtered" || true
  mv "$secret_candidates.filtered" "$secret_findings"
  if [[ -s "$secret_findings" ]]; then
    cat "$secret_findings"
    printf 'potential committed secret found\n' >&2
    exit 1
  fi
  rm -f "$secret_candidates" "$secret_findings"
fi

log "repo validation complete"
