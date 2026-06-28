#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() {
  printf '\n==> %s\n' "$*"
}

stop_temp_servers() {
  local pid
  for pid in "$@"; do
    [[ -n "${pid:-}" ]] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}

wait_for_http() {
  local url="$1"
  local timeout_seconds="${2:-60}"
  local elapsed=0
  until curl --silent --show-error --max-time 1 "$url" >/dev/null 2>&1; do
    if (( elapsed >= timeout_seconds )); then
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
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

run_node_audit_gate() {
  local dir="$1"
  if [[ ! -d "$dir" || ! -f "$dir/package.json" ]]; then
    printf 'skip: %s package audit is not present yet\n' "$dir"
    return 0
  fi
  if ! has_cmd npm; then
    printf 'skip: npm is not installed; cannot audit %s\n' "$dir"
    return 0
  fi

  local audit_report
  local audit_err
  local audit_attempt
  local audit_rc
  audit_report="$(mktemp)"
  audit_err="$(mktemp)"
  audit_rc=1
  for audit_attempt in 1 2 3; do
    : >"$audit_report"
    : >"$audit_err"
    if (cd "$dir" && npm audit --audit-level=moderate --json >"$audit_report" 2>"$audit_err"); then
      audit_rc=0
      break
    fi
    audit_rc=$?
    if python3 - "$audit_report" "$audit_err" <<'PY'
import json
import sys
from pathlib import Path

report = Path(sys.argv[1])
err = Path(sys.argv[2])
try:
    data = json.loads(report.read_text(encoding="utf-8"))
except Exception:
    data = {}
error = data.get("error") if isinstance(data, dict) else None
text = " ".join(
    str(part)
    for part in (
        error.get("summary") if isinstance(error, dict) else "",
        error.get("detail") if isinstance(error, dict) else "",
        err.read_text(encoding="utf-8", errors="replace"),
    )
)
network_markers = (
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "network socket disconnected",
    "TLS connection",
    "audit endpoint returned an error",
    "registry.npmjs.org",
)
raise SystemExit(0 if any(marker in text for marker in network_markers) else 1)
PY
    then
      if [[ "$audit_attempt" -lt 3 ]]; then
        printf '%s: npm audit registry/network error on attempt %s; retrying\n' "$dir" "$audit_attempt" >&2
        sleep "$audit_attempt"
        continue
      fi
    fi
    break
  done
  if [[ "$audit_rc" -ne 0 ]]; then
    python3 - "$dir" "$audit_report" "$audit_err" <<'PY'
import json
import sys
from pathlib import Path

project = sys.argv[1]
path = Path(sys.argv[2])
err_path = Path(sys.argv[3])
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except json.JSONDecodeError as exc:
    raise SystemExit(f"{project}: invalid npm audit JSON: {exc}")
vulnerabilities = data.get("metadata", {}).get("vulnerabilities")
if not isinstance(vulnerabilities, dict):
    error = data.get("error") if isinstance(data, dict) else None
    detail = ""
    if isinstance(error, dict):
        detail = " ".join(str(error.get(key, "")) for key in ("code", "summary", "detail")).strip()
    stderr = err_path.read_text(encoding="utf-8", errors="replace").strip()
    if detail or stderr:
        raise SystemExit(f"{project}: npm audit failed without vulnerability metadata: {(detail or stderr)[:500]}")
    raise SystemExit(f"{project}: missing npm audit vulnerability metadata")
moderate_plus = {
    severity: vulnerabilities.get(severity, 0)
    for severity in ("moderate", "high", "critical")
}
if any(count for count in moderate_plus.values()):
    raise SystemExit(f"{project}: npm audit moderate+ vulnerabilities found: {moderate_plus}")
raise SystemExit(f"{project}: npm audit failed without moderate+ vulnerabilities; inspect package manager output")
PY
  fi
  python3 - "$dir" "$audit_report" <<'PY'
import json
import subprocess
import sys
from pathlib import Path

project = sys.argv[1]
path = Path(sys.argv[2])
data = json.loads(path.read_text(encoding="utf-8"))
vulnerabilities = data.get("metadata", {}).get("vulnerabilities")
if not isinstance(vulnerabilities, dict):
    raise SystemExit(f"{project}: missing npm audit vulnerability metadata")
moderate_plus = {
    severity: vulnerabilities.get(severity, 0)
    for severity in ("moderate", "high", "critical")
}
if any(count for count in moderate_plus.values()):
    raise SystemExit(f"{project}: npm audit moderate+ vulnerabilities found: {moderate_plus}")
PY
  rm -f "$audit_report" "$audit_err"
}

run_stripe_selftest_when_configured() {
  (
  if [[ "${SKIP_STRIPE_SANDBOX_SELFTEST:-0}" == "1" ]]; then
    printf 'skip: SKIP_STRIPE_SANDBOX_SELFTEST=1 set; online Stripe sandbox selftest not run\n'
    return 0
  fi
  if ! has_cmd stripe; then
    printf 'skip: stripe CLI is not installed; online Stripe sandbox selftest not run\n'
    return 0
  fi
  if [[ ! -f .env ]]; then
    printf 'skip: .env is not present; online Stripe sandbox selftest not run\n'
    return 0
  fi

  set -a
  # shellcheck disable=SC1091
  source .env
  set +a

  set +e
  python3 - <<'PY'
import os
import sys

values = {
    "STRIPE_MODE": os.environ.get("STRIPE_MODE", "test"),
    "STRIPE_API_KEY": os.environ.get("STRIPE_SECRET_KEY") or os.environ.get("STRIPE_API_KEY") or "",
    "STRIPE_PUBLISHABLE_KEY": os.environ.get("STRIPE_PUBLISHABLE_KEY") or os.environ.get("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY") or "",
    "STRIPE_WEBHOOK_SECRET": os.environ.get("STRIPE_WEBHOOK_SECRET") or os.environ.get("BILLING_WEBHOOK_SECRET") or "",
    "STRIPE_SANDBOX_PRODUCT_ID": os.environ.get("STRIPE_SANDBOX_PRODUCT_ID", ""),
    "STRIPE_DEFAULT_PRICE_ID": os.environ.get("STRIPE_DEFAULT_PRICE_ID", ""),
}
placeholder_fragments = ("replace_me", "from_stripe_cli_listen_print_secret")
ready = (
    values["STRIPE_MODE"] == "test"
    and values["STRIPE_API_KEY"].startswith("sk_test_")
    and values["STRIPE_PUBLISHABLE_KEY"].startswith("pk_test_")
    and values["STRIPE_WEBHOOK_SECRET"].startswith("whsec_")
    and values["STRIPE_SANDBOX_PRODUCT_ID"].startswith("prod_")
    and values["STRIPE_DEFAULT_PRICE_ID"].startswith("price_")
    and not any(fragment in value for value in values.values() for fragment in placeholder_fragments)
)
if not ready:
    print("skip: Stripe sandbox env is incomplete or placeholder-only; online Stripe sandbox selftest not run")
    raise SystemExit(78)
PY
  local readiness_status=$?
  set -e
  if [[ "$readiness_status" == "78" ]]; then
    return 0
  fi
  if [[ "$readiness_status" != "0" ]]; then
    return "$readiness_status"
  fi

  local out
  local err
  out="$(mktemp)"
  err="$(mktemp)"
  if ! bash scripts/stripe_sandbox_selftest.sh >"$out" 2>"$err"; then
    python3 - "$out" "$err" <<'PY'
import re
import sys
from pathlib import Path

secret_re = re.compile(
    r"(?i)(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
for path in sys.argv[1:]:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        cleaned = secret_re.sub("[redacted]", line)
        if cleaned.strip():
            print(cleaned)
PY
    rm -f "$out" "$err"
    return 1
  fi
  python3 - "$out" "$err" <<'PY'
import re
import sys
from pathlib import Path

secret_re = re.compile(
    r"(?i)(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
text = "\n".join(Path(path).read_text(encoding="utf-8", errors="replace") for path in sys.argv[1:])
if secret_re.search(text):
    raise SystemExit("Stripe sandbox selftest output contained secret-shaped material")
for line in text.splitlines():
    if line.strip():
        print(line)
PY
  rm -f "$out" "$err"
  )
}

run_openai_provider_selftest_when_configured() {
  (
  if [[ "${SKIP_OPENAI_COMPATIBLE_SELFTEST:-0}" == "1" ]]; then
    printf 'skip: SKIP_OPENAI_COMPATIBLE_SELFTEST=1 set; online OpenAI-compatible provider selftest not run\n'
    return 0
  fi
  if [[ ! -f .env ]]; then
    printf 'skip: .env is not present; online OpenAI-compatible provider selftest not run\n'
    return 0
  fi

  set -a
  # shellcheck disable=SC1091
  source .env
  set +a

  set +e
  python3 - <<'PY'
import os
import sys

values = {
    "LLM_PROVIDER": os.environ.get("LLM_PROVIDER", "openai-compatible"),
    "LLM_OPENAI_BASE_URL": os.environ.get("LLM_OPENAI_BASE_URL", ""),
    "LLM_OPENAI_API_KEY": os.environ.get("LLM_OPENAI_API_KEY") or os.environ.get("ZAI_API_KEY") or os.environ.get("OPENAI_API_KEY") or "",
    "LLM_OPENAI_MODEL": os.environ.get("LLM_OPENAI_MODEL", ""),
    "LLM_ENABLE_LIVE_CALLS": os.environ.get("LLM_ENABLE_LIVE_CALLS", "false"),
}
placeholder_fragments = ("replace_me",)
ready = (
    values["LLM_PROVIDER"] == "openai-compatible"
    and values["LLM_ENABLE_LIVE_CALLS"] == "true"
    and values["LLM_OPENAI_BASE_URL"].startswith(("http://", "https://"))
    and values["LLM_OPENAI_API_KEY"]
    and values["LLM_OPENAI_MODEL"]
    and not any(fragment in value for value in values.values() for fragment in placeholder_fragments)
)
if not ready:
    print("skip: OpenAI-compatible provider env is incomplete, disabled, or placeholder-only; online provider selftest not run")
    raise SystemExit(78)
PY
  local readiness_status=$?
  set -e
  if [[ "$readiness_status" == "78" ]]; then
    return 0
  fi
  if [[ "$readiness_status" != "0" ]]; then
    return "$readiness_status"
  fi

  local out
  local err
  out="$(mktemp)"
  err="$(mktemp)"
  if ! bash scripts/openai_compatible_provider_selftest.sh >"$out" 2>"$err"; then
    python3 - "$out" "$err" <<'PY'
import re
import sys
from pathlib import Path

secret_re = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
for path in sys.argv[1:]:
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    for line in text.splitlines():
        cleaned = secret_re.sub("[redacted]", line)
        if cleaned.strip():
            print(cleaned)
PY
    rm -f "$out" "$err"
    return 1
  fi
  python3 - "$out" "$err" <<'PY'
import re
import sys
from pathlib import Path

secret_re = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
text = "\n".join(Path(path).read_text(encoding="utf-8", errors="replace") for path in sys.argv[1:])
if secret_re.search(text):
    raise SystemExit("OpenAI-compatible provider selftest output contained secret-shaped material")
for line in text.splitlines():
    if line.strip():
        print(line)
PY
  rm -f "$out" "$err"
  )
}

log "repo scaffolding files"
test -f .env.example
test -f Docs/Stage1_20260621_blueprint.md
test -f Docs/researches/stage1_gap_inventory.md
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
test -x scripts/validate_stage1_env_example_contract.py
test -x scripts/validate_stage1_local_devport_registry.py
test -x scripts/staging_observability_backup_load_smoke.sh
test -x scripts/staging_object_storage_signed_url_smoke.sh
test -x scripts/staging_object_storage_retention_cleanup_smoke.sh
test -x scripts/staging_legal_support_visibility_smoke.sh
test -x scripts/production_backup_rollback_split_smoke.sh
test -x scripts/security_scan_smoke.sh
test -x scripts/stripe_sandbox_selftest.sh
test -x scripts/openai_compatible_provider_selftest.sh
test -x scripts/validate_stage1_blueprint.py
test -x scripts/validate_stage1_gap_inventory.py
test -x scripts/validate_zenari_brand_migration.py
test -x scripts/validate_stage1_release_image_boundary.py
test -x scripts/stage1_scope_guard.py
test -x scripts/validate_stage1_load_evidence.py
test -x scripts/validate_stage1_batch_generation_contract.py
test -x scripts/validate_stage1_batch_result_storage_contract.py
test -x scripts/validate_stage1_batch_quota_reconciliation.py
test -x scripts/validate_stage1_batch_quota_runtime_replay.py
test -x scripts/validate_stage1_staging_quota_replay_evidence.py
test -x scripts/validate_stage1_rate_limit_spend_cap_contract.py
test -x scripts/validate_stage1_api_error_taxonomy_contract.py
test -x scripts/validate_stage1_support_ticket_linking_contract.py
	test -x scripts/validate_stage1_trace_projection_contract.py
	test -x scripts/validate_stage1_canvas_assets_contract.py
	test -x scripts/validate_stage1_canvas_interaction_contract.py
	test -x scripts/validate_stage1_canvas_versioning_contract.py
	test -x scripts/validate_stage1_edit_tools_mask_contract.py
	test -x scripts/validate_stage1_prompt_composer_contract.py
	test -x scripts/validate_stage1_mentions_contract.py
	test -x scripts/validate_stage1_asset_library_brandkit_contract.py
	test -x scripts/validate_stage1_provider_edit_adapter_contract.py
	test -x scripts/validate_stage1_provider_video_adapter_contract.py
test -x scripts/validate_stage1_provider_registry_contract.py
test -x scripts/validate_stage1_provider_cost_reconciliation.py
test -x scripts/validate_stage1_admin_billing_ops_contract.py
test -x scripts/validate_stage1_team_seat_billing_contract.py
test -x scripts/validate_stage1_user_billing_invoice_contract.py
test -x scripts/validate_stage1_user_batch_progress_contract.py
test -x scripts/validate_stage1_result_placement_contract.py
test -x scripts/validate_stage1_safety_export_state_contract.py
test -x scripts/validate_stage1_rendered_export_asset_contract.py
test -x scripts/stage1_provider_sandbox_smoke.sh
test -x scripts/validate_stage1_provider_sandbox_evidence.py
test -x scripts/stage1_stripe_staging_smoke.sh
test -x scripts/validate_stage1_stripe_staging_evidence.py
test -x scripts/validate_stage1_stripe_lifecycle_reconciliation.py
test -x scripts/stage1_safety_qa_eval_smoke.sh
test -x scripts/validate_stage1_safety_qa_evidence.py
test -x scripts/validate_stage1_safety_review_contract.py
test -x scripts/validate_stage1_staging_auth_rbac_tenant_audit_evidence.py
test -x scripts/validate_stage1_staging_object_retention_evidence.py
test -x scripts/validate_stage1_staging_observability_backup_load_evidence.py
test -x scripts/validate_stage1_staging_legal_support_evidence.py
test -x scripts/validate_stage1_security_scan_contract.py
test -x scripts/validate_stage1_skill_eval_release_contract.py
test -x scripts/validate_stage1_eval_skill_release_contract.py
test -x scripts/validate_stage1_export_ops_contract.py
test -x scripts/validate_stage1_export_manifest_render_contract.py
test -x scripts/validate_stage1_export_object_access_contract.py
test -x scripts/validate_stage1_release_readiness_contract.py
test -x scripts/generate_stage1_release_evidence_closure_queue.py
test -x scripts/validate_stage1_release_evidence_closure_queue.py
test -x scripts/generate_stage1_external_resource_readiness.py
test -x scripts/validate_stage1_external_resource_readiness.py
test -x scripts/stage1_r2_bucket_readiness.py
test -x scripts/validate_stage1_r2_bucket_readiness.py
test -x scripts/generate_stage1_release_candidate_metadata.py
test -x scripts/validate_stage1_release_metadata_contract.py
test -x scripts/validate_stage1_audit_search_export_contract.py
test -x scripts/validate_stage1_operations_incident_runbook_contract.py
test -x scripts/validate_stage1_support_admin_deletion_governance_contract.py
test -x scripts/validate_stage1_staging_runtime.py
test -x scripts/azure_staging_run_command_payload.sh
test -x scripts/ingest_azure_run_command_output.py
test -x scripts/validate_azure_run_command_output_ingest.py
test -x scripts/sanitize_azure_run_command_output.py
test -x scripts/classify_azure_run_command_output.py
test -x scripts/validate_azure_run_command_output_classifier.py
test -x scripts/validate_azure_run_command_output_sanitizer.py
test -x scripts/validate_azure_run_command_operator_card.py
test -x scripts/azure_staging_cli_preflight.sh
test -x scripts/azure_staging_run_command_invoke.sh
test -x scripts/validate_azure_staging_run_command_payload.py
test -x scripts/azure_staging_password_key_repair.sh
test -x scripts/validate_azure_staging_password_key_repair.py
test -x scripts/azure_staging_origin_diagnostics.sh
test -x scripts/azure_staging_origin_repair.sh
test -x scripts/validate_azure_staging_origin_ops.py
test -x scripts/stage1_azure_origin_readiness.py
test -x scripts/validate_stage1_azure_origin_readiness.py
test -x scripts/validate_stage1_production_launch.py
test -x scripts/validate_stage1_ci_exact_evidence.py
test -x scripts/validate_stage1_production_security_launch_evidence.py
test -x scripts/validate_stage1_production_provider_claims_evidence.py
test -x scripts/validate_stage1_production_governance_release_evidence.py
test -x scripts/validate_stage1_production_legal_support_evidence.py
test -x scripts/validate_stage1_production_billing_evidence.py
test -x scripts/validate_stage1_production_backup_rollback_evidence.py
test -x scripts/write_stage1_ci_pr_main_evidence.py
test -x scripts/fetch_stage1_ci_artifacts.py
test -x scripts/generate_stage1_ci_exact_preflight.py
test -x scripts/generate_stage1_ci_release_gate_evidence.py
test -x scripts/generate_stage1_production_security_launch_evidence.py
test -x scripts/generate_stage1_production_provider_claims_evidence.py
test -x scripts/generate_stage1_production_governance_release_evidence.py
test -x scripts/generate_stage1_production_legal_support_evidence.py
test -x scripts/generate_stage1_production_billing_evidence.py
test -x scripts/generate_stage1_production_backup_rollback_evidence.py
test -x scripts/run_stage1_production_launch_source_pipeline.py
test -x scripts/validate_stage1_production_launch_source_pipeline.py
test -x scripts/run_stage1_production_proof_bundle.py
test -x scripts/validate_stage1_production_proof_bundle.py
test -x scripts/ingest_stage1_production_return_artifacts.py
test -x scripts/validate_stage1_production_return_artifact_ingest.py
test -x scripts/generate_stage1_production_input_template.py
test -x scripts/validate_stage1_production_input_template.py
test -x scripts/generate_stage1_production_source_probe_templates.py
test -x scripts/validate_stage1_production_source_probe_templates.py
test -x scripts/stage1_production_source_probe.py
test -x scripts/stage1_billing_live_proof_template.py
test -x scripts/stage1_stripe_live_billing_proof.py
test -x scripts/validate_stage1_stripe_live_billing_proof.py
test -x scripts/stage1_production_security_proof.py
test -x scripts/validate_stage1_production_security_proof.py
test -x scripts/stage1_production_governance_proof.py
test -x scripts/validate_stage1_production_governance_proof.py
test -x scripts/generate_stage1_production_launch_input_packet.py
test -x scripts/validate_stage1_production_launch_input_packet.py
test -x scripts/stage1_production_dns_readiness.py
test -x scripts/validate_stage1_production_dns_readiness.py
test -x scripts/stage1_production_dns_cutover_plan.py
test -x scripts/validate_stage1_production_dns_cutover_plan.py
test -x scripts/generate_stage1_production_dns_repair_packet.py
test -x scripts/validate_stage1_production_dns_repair_packet.py
test -x scripts/generate_stage1_production_blocker_audit.py
test -x scripts/validate_stage1_production_blocker_audit.py
test -x scripts/generate_stage1_production_action_matrix.py
test -x scripts/validate_stage1_production_action_matrix.py
test -x scripts/generate_stage1_production_launch_operator_brief.py
test -x scripts/validate_stage1_production_launch_operator_brief.py
test -x scripts/generate_stage1_production_missing_input_checklist.py
test -x scripts/validate_stage1_production_missing_input_checklist.py
test -x scripts/generate_stage1_production_source_probe_runbook.py
test -x scripts/validate_stage1_production_source_probe_runbook.py
test -x scripts/refresh_stage1_production_non_clearing_evidence.py
test -x scripts/validate_stage1_production_non_clearing_refresh.py
test -x scripts/generate_stage1_next_blockers_summary.py
test -x scripts/validate_stage1_next_blockers_summary.py
test -x scripts/generate_stage1_staging_runtime_evidence.py
test -x scripts/generate_stage1_staging_quota_replay_evidence.py
test -x scripts/generate_stage1_production_launch_evidence.py
test -x scripts/generate_stage1_release_metadata_preflight.py
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

log "stage1 blueprint and scope guard"
python3 scripts/validate_stage1_blueprint.py Docs/Stage1_20260621_blueprint.md
python3 scripts/validate_stage1_gap_inventory.py
python3 scripts/validate_stage1_env_example_contract.py
python3 scripts/validate_stage1_local_devport_registry.py --contract-only
python3 scripts/validate_stage1_local_devport_registry.py --allow-missing-devport
python3 scripts/validate_zenari_brand_migration.py
python3 scripts/validate_stage1_release_image_boundary.py
python3 scripts/stage1_scope_guard.py Docs/Stage1_20260621_blueprint.md
python3 scripts/validate_stage1_load_evidence.py --contract-only
python3 scripts/validate_stage1_batch_generation_contract.py
python3 scripts/validate_stage1_batch_result_storage_contract.py
python3 scripts/validate_stage1_batch_quota_reconciliation.py
python3 scripts/validate_stage1_batch_quota_runtime_replay.py
python3 scripts/validate_stage1_staging_quota_replay_evidence.py --contract-only
stage1_quota_preflight_blocked_dir="$(mktemp -d)"
set +e
python3 scripts/generate_stage1_staging_quota_replay_evidence.py \
  --preflight \
  --preflight-evidence "$stage1_quota_preflight_blocked_dir/stage1-quota-replay.preflight.json" >/dev/null 2>&1
stage1_quota_preflight_blocked_status=$?
set -e
if [[ "$stage1_quota_preflight_blocked_status" -ne 2 ]]; then
  printf 'Stage1 quota replay preflight must block missing inputs, got %s\n' "$stage1_quota_preflight_blocked_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_staging_quota_replay_evidence.py \
  --allow-preflight \
  --evidence "$stage1_quota_preflight_blocked_dir/stage1-quota-replay.preflight.json"
stage1_quota_preflight_ready_dir="$(mktemp -d)"
python3 scripts/generate_stage1_staging_quota_replay_evidence.py \
  --preflight \
  --database-url "postgresql://placeholder_user:placeholder_credential@staging-db.zenari.dev:5432/zenari" \
  --staging-api-url "https://staging-api.zenari.dev" \
  --tenant-id "tenant-stage1-quota" \
  --batch-id "batch-stage1-quota" \
  --preflight-evidence "$stage1_quota_preflight_ready_dir/stage1-quota-replay.preflight.json" >/dev/null
python3 scripts/validate_stage1_staging_quota_replay_evidence.py \
  --allow-preflight \
  --evidence "$stage1_quota_preflight_ready_dir/stage1-quota-replay.preflight.json"
set +e
python3 scripts/validate_stage1_staging_quota_replay_evidence.py \
  --evidence "$stage1_quota_preflight_ready_dir/stage1-quota-replay.preflight.json" \
  --results "$stage1_quota_preflight_ready_dir/stage1-quota-replay.preflight.json" >/dev/null 2>&1
stage1_quota_preflight_strict_status=$?
set -e
if [[ "$stage1_quota_preflight_strict_status" -eq 0 ]]; then
  printf 'Stage1 quota replay preflight evidence must not pass strict canonical validation\n' >&2
  exit 1
fi
python3 - "$stage1_quota_preflight_ready_dir/stage1-quota-replay.preflight.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
text = json.dumps(report)
if "placeholder_credential" in text or "postgresql://" in text:
    raise SystemExit("quota replay preflight must not persist database URL or credentials")
if report.get("database_url_persisted") is not False:
    raise SystemExit("quota replay preflight must explicitly mark database_url_persisted=false")
if report.get("can_clear_quota_replay_slot") is not False or report.get("can_clear_stage1_staging_runtime_gate") is not False:
    raise SystemExit("quota replay preflight must not clear staging gates")
if not report.get("input_refs", {}).get("tenant_id_hash") or not report.get("input_refs", {}).get("batch_id_hash"):
    raise SystemExit("quota replay preflight must persist only hashed tenant and batch refs")
PY
stage1_quota_invalid_strict_dir="$(mktemp -d)"
set +e
python3 scripts/generate_stage1_staging_quota_replay_evidence.py \
  --database-url "postgresql://placeholder_user:placeholder_credential@localhost:5432/zenari" \
  --staging-api-url "http://127.0.0.1:31080" \
  --tenant-id "tenant-stage1-quota" \
  --batch-id "batch-stage1-quota" \
  --evidence "$stage1_quota_invalid_strict_dir/stage1-quota-replay.json" \
  --results "$stage1_quota_invalid_strict_dir/stage1-quota-replay.ndjson" \
  --blocked-evidence "$stage1_quota_invalid_strict_dir/stage1-quota-replay.blocked.json" \
  --blocked-results "$stage1_quota_invalid_strict_dir/stage1-quota-replay.blocked.ndjson" >/dev/null 2>&1
stage1_quota_invalid_strict_status=$?
set -e
if [[ "$stage1_quota_invalid_strict_status" -ne 2 ]]; then
  printf 'Stage1 quota replay invalid strict inputs must write blocked diagnostics only, got %s\n' "$stage1_quota_invalid_strict_status" >&2
  exit 1
fi
if [[ -f "$stage1_quota_invalid_strict_dir/stage1-quota-replay.json" || -f "$stage1_quota_invalid_strict_dir/stage1-quota-replay.ndjson" ]]; then
  printf 'Stage1 quota replay invalid strict inputs must not write canonical outputs\n' >&2
  exit 1
fi
python3 - "$stage1_quota_invalid_strict_dir/stage1-quota-replay.blocked.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
text = json.dumps(report)
if "placeholder_credential" in text or "postgresql://" in text:
    raise SystemExit("quota replay blocked diagnostic must not persist database URL or credentials")
if report.get("status") != "blocked" or report.get("release_gate_decision") != "no_go":
    raise SystemExit("quota replay invalid strict inputs must remain blocked/no_go")
if report.get("canonical_pass_path") is not False:
    raise SystemExit("quota replay invalid strict inputs must not claim canonical pass path")
if report.get("staging_api_url"):
    raise SystemExit("quota replay invalid strict input diagnostic must sanitize staging_api_url")
if not any("staging_api_url not production-like" in item for item in report.get("blockers", [])):
    raise SystemExit("quota replay invalid strict diagnostic must explain staging API blocker")
if not any("staging_database_endpoint not production-like" in item for item in report.get("blockers", [])):
    raise SystemExit("quota replay invalid strict diagnostic must explain database blocker")
PY
python3 scripts/validate_stage1_rate_limit_spend_cap_contract.py
python3 scripts/validate_stage1_api_error_taxonomy_contract.py
python3 scripts/validate_stage1_support_ticket_linking_contract.py
	python3 scripts/validate_stage1_trace_projection_contract.py
	python3 scripts/validate_stage1_canvas_assets_contract.py
	python3 scripts/validate_stage1_canvas_interaction_contract.py
	python3 scripts/validate_stage1_canvas_versioning_contract.py
	python3 scripts/validate_stage1_edit_tools_mask_contract.py
	python3 scripts/validate_stage1_prompt_composer_contract.py
	python3 scripts/validate_stage1_mentions_contract.py
	python3 scripts/validate_stage1_asset_library_brandkit_contract.py
	python3 scripts/validate_stage1_provider_edit_adapter_contract.py
	python3 scripts/validate_stage1_provider_video_adapter_contract.py
python3 scripts/validate_stage1_provider_registry_contract.py
python3 scripts/validate_stage1_provider_cost_reconciliation.py
python3 scripts/validate_stage1_admin_billing_ops_contract.py
python3 scripts/validate_stage1_team_seat_billing_contract.py
python3 scripts/validate_stage1_user_billing_invoice_contract.py
python3 scripts/validate_stage1_user_batch_progress_contract.py
python3 scripts/validate_stage1_result_placement_contract.py
python3 scripts/validate_stage1_safety_export_state_contract.py
python3 scripts/validate_stage1_rendered_export_asset_contract.py
python3 scripts/validate_stage1_provider_sandbox_evidence.py --contract-only
python3 scripts/validate_stage1_stripe_staging_evidence.py --contract-only
python3 scripts/validate_stage1_stripe_lifecycle_reconciliation.py
python3 scripts/validate_stage1_safety_qa_evidence.py --contract-only
python3 scripts/validate_stage1_safety_review_contract.py
python3 scripts/validate_stage1_staging_auth_rbac_tenant_audit_evidence.py --contract-only
python3 scripts/validate_stage1_staging_object_retention_evidence.py --contract-only
stage1_object_retention_preflight_dir="$(mktemp -d)"
set +e
OBJECT_RETENTION_MODE=preflight_stage1 \
  OUT_DIR="$stage1_object_retention_preflight_dir" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null 2>&1
stage1_object_retention_preflight_status=$?
set -e
if [[ "$stage1_object_retention_preflight_status" -ne 2 ]]; then
  printf 'Stage1 object-retention preflight must remain blocked/non-clearing, got %s\n' "$stage1_object_retention_preflight_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_staging_object_retention_evidence.py \
  --allow-preflight \
  --evidence "$stage1_object_retention_preflight_dir/object-storage-retention-cleanup.preflight.json" \
  --results "$stage1_object_retention_preflight_dir/object-storage-retention-cleanup.preflight.ndjson"
set +e
python3 scripts/validate_stage1_staging_object_retention_evidence.py \
  --evidence "$stage1_object_retention_preflight_dir/object-storage-retention-cleanup.preflight.json" \
  --results "$stage1_object_retention_preflight_dir/object-storage-retention-cleanup.preflight.ndjson" >/dev/null 2>&1
stage1_object_retention_preflight_strict_status=$?
set -e
if [[ "$stage1_object_retention_preflight_strict_status" -eq 0 ]]; then
  printf 'Stage1 object-retention preflight evidence must not pass strict canonical validation\n' >&2
  exit 1
fi
python3 scripts/validate_stage1_staging_observability_backup_load_evidence.py --contract-only
python3 scripts/validate_stage1_staging_legal_support_evidence.py --contract-only
python3 scripts/validate_stage1_security_scan_contract.py
python3 scripts/validate_stage1_skill_eval_release_contract.py
python3 scripts/validate_stage1_eval_skill_release_contract.py
python3 scripts/validate_stage1_export_ops_contract.py
python3 scripts/validate_stage1_export_manifest_render_contract.py
python3 scripts/validate_stage1_export_object_access_contract.py
python3 scripts/validate_stage1_release_readiness_contract.py
python3 scripts/validate_stage1_release_evidence_closure_queue.py --contract-only
python3 scripts/stage1_r2_bucket_readiness.py --contract-only
python3 scripts/validate_stage1_r2_bucket_readiness.py --contract-only
python3 scripts/validate_stage1_external_resource_readiness.py --contract-only
python3 scripts/generate_stage1_release_candidate_metadata.py --check
python3 scripts/validate_stage1_release_metadata_contract.py --contract-only
python3 scripts/validate_stage1_audit_search_export_contract.py
python3 scripts/validate_stage1_operations_incident_runbook_contract.py
python3 scripts/validate_stage1_support_admin_deletion_governance_contract.py
python3 scripts/validate_stage1_staging_runtime.py --contract-only
scripts/azure_staging_run_command_payload.sh --contract-only
python3 scripts/ingest_azure_run_command_output.py --contract-only
python3 scripts/validate_azure_run_command_output_ingest.py
python3 scripts/sanitize_azure_run_command_output.py --contract-only
python3 scripts/validate_azure_run_command_output_sanitizer.py
python3 scripts/classify_azure_run_command_output.py --contract-only
python3 scripts/validate_azure_run_command_output_classifier.py
python3 scripts/validate_azure_run_command_operator_card.py
scripts/azure_staging_cli_preflight.sh --contract-only
scripts/azure_staging_run_command_invoke.sh --contract-only
python3 scripts/validate_azure_staging_run_command_payload.py
scripts/azure_staging_password_key_repair.sh --contract-only
python3 scripts/validate_azure_staging_password_key_repair.py
scripts/azure_staging_origin_diagnostics.sh --contract-only
scripts/azure_staging_origin_repair.sh --contract-only
python3 scripts/validate_azure_staging_origin_ops.py
python3 scripts/stage1_azure_origin_readiness.py --contract-only
python3 scripts/validate_stage1_azure_origin_readiness.py --contract-only
python3 scripts/validate_stage1_production_launch.py --contract-only
python3 scripts/validate_stage1_ci_exact_evidence.py --contract-only
python3 scripts/validate_stage1_production_security_launch_evidence.py --contract-only
python3 scripts/validate_stage1_production_provider_claims_evidence.py --contract-only
python3 scripts/validate_stage1_production_governance_release_evidence.py --contract-only
python3 scripts/validate_stage1_production_legal_support_evidence.py --contract-only
python3 scripts/validate_stage1_production_billing_evidence.py --contract-only
python3 scripts/validate_stage1_production_backup_rollback_evidence.py --contract-only
python3 scripts/generate_stage1_production_source_probe_templates.py --contract-only
python3 scripts/validate_stage1_production_source_probe_templates.py --contract-only
python3 scripts/stage1_production_source_probe.py --contract-only
python3 scripts/stage1_billing_live_proof_template.py --contract-only
python3 scripts/stage1_stripe_live_billing_proof.py --contract-only
python3 scripts/validate_stage1_stripe_live_billing_proof.py --contract-only
python3 scripts/generate_stage1_production_billing_operator_packet.py --contract-only
python3 scripts/validate_stage1_production_billing_operator_packet.py --contract-only
python3 scripts/stage1_production_security_proof.py --contract-only
python3 scripts/validate_stage1_production_security_proof.py --contract-only
python3 scripts/generate_stage1_production_security_operator_packet.py --contract-only
python3 scripts/validate_stage1_production_security_operator_packet.py --contract-only
python3 scripts/stage1_production_governance_proof.py --contract-only
python3 scripts/validate_stage1_production_governance_proof.py --contract-only
python3 scripts/generate_stage1_production_governance_operator_packet.py --contract-only
python3 scripts/validate_stage1_production_governance_operator_packet.py --contract-only
python3 scripts/run_stage1_production_launch_source_pipeline.py --contract-only
python3 scripts/validate_stage1_production_launch_source_pipeline.py --contract-only
python3 scripts/run_stage1_production_proof_bundle.py --contract-only
python3 scripts/validate_stage1_env_example_contract.py --contract-only
python3 scripts/validate_stage1_local_devport_registry.py --contract-only
python3 scripts/validate_stage1_production_proof_bundle.py --contract-only
python3 scripts/generate_stage1_production_input_template.py --contract-only
python3 scripts/validate_stage1_production_input_template.py --contract-only
python3 scripts/generate_stage1_production_launch_input_packet.py --contract-only
python3 scripts/validate_stage1_production_launch_input_packet.py --contract-only
python3 scripts/stage1_production_dns_readiness.py --contract-only
python3 scripts/validate_stage1_production_dns_readiness.py --contract-only
python3 scripts/stage1_production_dns_cutover_plan.py --contract-only
python3 scripts/validate_stage1_production_dns_cutover_plan.py --contract-only
python3 scripts/generate_stage1_production_dns_repair_packet.py --contract-only
python3 scripts/validate_stage1_production_dns_repair_packet.py --contract-only
python3 scripts/generate_stage1_production_legal_support_operator_packet.py --contract-only
python3 scripts/validate_stage1_production_legal_support_operator_packet.py --contract-only
python3 scripts/generate_stage1_production_blocker_audit.py --contract-only
python3 scripts/validate_stage1_production_blocker_audit.py --contract-only
python3 scripts/generate_stage1_production_blocker_checklist.py --contract-only
python3 scripts/validate_stage1_production_blocker_checklist.py --contract-only
python3 scripts/generate_stage1_production_action_matrix.py --contract-only
python3 scripts/validate_stage1_production_action_matrix.py --contract-only
python3 scripts/generate_stage1_production_launch_operator_brief.py --contract-only
python3 scripts/validate_stage1_production_launch_operator_brief.py --contract-only
python3 scripts/generate_stage1_production_missing_input_checklist.py --contract-only
python3 scripts/validate_stage1_production_missing_input_checklist.py --contract-only
python3 scripts/generate_stage1_production_source_probe_runbook.py --contract-only
python3 scripts/validate_stage1_production_source_probe_runbook.py --contract-only
python3 scripts/refresh_stage1_production_non_clearing_evidence.py --contract-only
python3 scripts/validate_stage1_production_non_clearing_refresh.py --contract-only
python3 scripts/ingest_stage1_production_return_artifacts.py --contract-only
python3 scripts/validate_stage1_production_return_artifact_ingest.py --contract-only
python3 scripts/generate_stage1_next_blockers_summary.py --contract-only
python3 scripts/validate_stage1_next_blockers_summary.py --contract-only
python3 scripts/validate_stage1_production_backup_rollback_evidence.py --allow-preflight
python3 scripts/write_stage1_ci_pr_main_evidence.py --help >/dev/null
python3 scripts/fetch_stage1_ci_artifacts.py --contract-only
python3 scripts/generate_stage1_ci_exact_preflight.py --contract-only
python3 scripts/generate_stage1_ci_release_gate_evidence.py --help >/dev/null
python3 scripts/generate_stage1_production_security_launch_evidence.py --help >/dev/null
python3 scripts/generate_stage1_production_provider_claims_evidence.py --help >/dev/null
python3 scripts/generate_stage1_production_governance_release_evidence.py --help >/dev/null
python3 scripts/generate_stage1_production_legal_support_evidence.py --help >/dev/null
python3 scripts/generate_stage1_production_billing_evidence.py --help >/dev/null
python3 scripts/generate_stage1_production_backup_rollback_evidence.py --help >/dev/null
stage1_prod_source_template_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_source_probe_templates.py \
  --output-dir "$stage1_prod_source_template_dir" \
  --self-test >/dev/null
python3 scripts/validate_stage1_production_source_probe_templates.py \
  --template-dir "$stage1_prod_source_template_dir" \
  --self-test
python3 scripts/stage1_billing_live_proof_template.py \
  --output "$stage1_prod_source_template_dir/billing-live-proof.template.json" \
  --self-test >/dev/null
python3 scripts/generate_stage1_production_source_probe_templates.py \
  --output-dir ops/evidence/non_clearing/templates/production-source-probes \
  --self-test >/dev/null
python3 scripts/validate_stage1_production_source_probe_templates.py \
  --template-dir ops/evidence/non_clearing/templates/production-source-probes
python3 scripts/stage1_billing_live_proof_template.py \
  --output ops/evidence/non_clearing/templates/billing-live-proof.template.json \
  --self-test >/dev/null
stage1_live_billing_proof_dir="$(mktemp -d)"
set +e
python3 scripts/stage1_stripe_live_billing_proof.py \
  --diagnostic "$stage1_live_billing_proof_dir/production-live-billing-proof.blocked.json" \
  --release-sha "0123456789abcdef0123456789abcdef01234567" >/dev/null 2>&1
stage1_live_billing_proof_status=$?
set -e
if [[ "$stage1_live_billing_proof_status" -ne 2 ]]; then
  printf 'Stripe live billing proof helper must remain blocked without live inputs, got %s\n' "$stage1_live_billing_proof_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_stripe_live_billing_proof.py \
  --diagnostic "$stage1_live_billing_proof_dir/production-live-billing-proof.blocked.json"
stage1_prod_billing_operator_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_billing_operator_packet.py \
  --live-proof-diagnostic "$stage1_live_billing_proof_dir/production-live-billing-proof.blocked.json" \
  --output "$stage1_prod_billing_operator_dir/production-billing-operator-packet.json" >/dev/null
python3 scripts/validate_stage1_production_billing_operator_packet.py \
  --packet "$stage1_prod_billing_operator_dir/production-billing-operator-packet.json"
stage1_security_proof_dir="$(mktemp -d)"
set +e
python3 scripts/stage1_production_security_proof.py \
  --diagnostic "$stage1_security_proof_dir/production-security-proof.blocked.json" \
  --release-sha "0123456789abcdef0123456789abcdef01234567" >/dev/null 2>&1
stage1_security_proof_status=$?
set -e
if [[ "$stage1_security_proof_status" -ne 2 ]]; then
  printf 'production security proof helper must remain blocked without production refs, got %s\n' "$stage1_security_proof_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_production_security_proof.py \
  --diagnostic "$stage1_security_proof_dir/production-security-proof.blocked.json"
stage1_prod_security_operator_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_security_operator_packet.py \
  --proof-diagnostic "$stage1_security_proof_dir/production-security-proof.blocked.json" \
  --output "$stage1_prod_security_operator_dir/production-security-operator-packet.json" >/dev/null
python3 scripts/validate_stage1_production_security_operator_packet.py \
  --packet "$stage1_prod_security_operator_dir/production-security-operator-packet.json"
stage1_governance_proof_dir="$(mktemp -d)"
set +e
python3 scripts/stage1_production_governance_proof.py \
  --diagnostic "$stage1_governance_proof_dir/production-governance-proof.blocked.json" \
  --release-sha "0123456789abcdef0123456789abcdef01234567" >/dev/null 2>&1
stage1_governance_proof_status=$?
set -e
if [[ "$stage1_governance_proof_status" -ne 2 ]]; then
  printf 'production governance proof helper must remain blocked without production refs, got %s\n' "$stage1_governance_proof_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_production_governance_proof.py \
  --diagnostic "$stage1_governance_proof_dir/production-governance-proof.blocked.json"
stage1_prod_governance_operator_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_governance_operator_packet.py \
  --proof-diagnostic "$stage1_governance_proof_dir/production-governance-proof.blocked.json" \
  --output "$stage1_prod_governance_operator_dir/production-governance-operator-packet.json" >/dev/null
python3 scripts/validate_stage1_production_governance_operator_packet.py \
  --packet "$stage1_prod_governance_operator_dir/production-governance-operator-packet.json"
set +e
python3 scripts/stage1_production_dns_readiness.py \
  --output ops/evidence/non_clearing/production-dns-readiness.json >/dev/null
stage1_prod_dns_status=$?
set -e
if [[ "$stage1_prod_dns_status" != "0" && "$stage1_prod_dns_status" != "2" ]]; then
  printf 'unexpected Stage1 production DNS readiness exit: %s\n' "$stage1_prod_dns_status" >&2
  exit "$stage1_prod_dns_status"
fi
python3 scripts/validate_stage1_production_dns_readiness.py \
  --evidence ops/evidence/non_clearing/production-dns-readiness.json
set +e
python3 scripts/stage1_production_dns_cutover_plan.py \
  --output ops/evidence/non_clearing/production-dns-cutover-plan.json >/dev/null
stage1_prod_dns_cutover_status=$?
set -e
if [[ "$stage1_prod_dns_cutover_status" != "0" && "$stage1_prod_dns_cutover_status" != "2" ]]; then
  printf 'unexpected Stage1 production DNS cutover plan exit: %s\n' "$stage1_prod_dns_cutover_status" >&2
  exit "$stage1_prod_dns_cutover_status"
fi
python3 scripts/validate_stage1_production_dns_cutover_plan.py \
  --plan ops/evidence/non_clearing/production-dns-cutover-plan.json
stage1_prod_legal_support_operator_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_legal_support_operator_packet.py \
  --output "$stage1_prod_legal_support_operator_dir/production-legal-support-operator-packet.json" >/dev/null
python3 scripts/validate_stage1_production_legal_support_operator_packet.py \
  --packet "$stage1_prod_legal_support_operator_dir/production-legal-support-operator-packet.json"
stage1_prod_input_packet_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_launch_input_packet.py \
  --output "$stage1_prod_input_packet_dir/production-launch-input-packet.json" >/dev/null
python3 scripts/validate_stage1_production_launch_input_packet.py \
  --packet "$stage1_prod_input_packet_dir/production-launch-input-packet.json"
stage1_prod_input_template_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_input_template.py \
  --output "$stage1_prod_input_template_dir/production-input-template.env" \
  --manifest "$stage1_prod_input_template_dir/production-input-template.json" >/dev/null
python3 scripts/validate_stage1_production_input_template.py \
  --template "$stage1_prod_input_template_dir/production-input-template.env" \
  --manifest "$stage1_prod_input_template_dir/production-input-template.json"
stage1_prod_blocker_audit_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_blocker_audit.py \
  --input-packet "$stage1_prod_input_packet_dir/production-launch-input-packet.json" \
  --output "$stage1_prod_blocker_audit_dir/production-blocker-audit.json" >/dev/null
python3 scripts/validate_stage1_production_blocker_audit.py \
  --audit "$stage1_prod_blocker_audit_dir/production-blocker-audit.json"
stage1_prod_operator_brief_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_launch_operator_brief.py \
  --blocker-audit "$stage1_prod_blocker_audit_dir/production-blocker-audit.json" \
  --output "$stage1_prod_operator_brief_dir/production-launch-operator-brief.json" >/dev/null
python3 scripts/validate_stage1_production_launch_operator_brief.py \
  --brief "$stage1_prod_operator_brief_dir/production-launch-operator-brief.json"
stage1_prod_missing_input_checklist_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_missing_input_checklist.py \
  --launch-input-packet "$stage1_prod_input_packet_dir/production-launch-input-packet.json" \
  --launch-operator-brief "$stage1_prod_operator_brief_dir/production-launch-operator-brief.json" \
  --output "$stage1_prod_missing_input_checklist_dir/production-missing-input-checklist.json" >/dev/null
python3 scripts/validate_stage1_production_missing_input_checklist.py \
  --checklist "$stage1_prod_missing_input_checklist_dir/production-missing-input-checklist.json"
stage1_prod_source_probe_dir="$(mktemp -d)"
set +e
python3 scripts/stage1_production_source_probe.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --production-web-url "http://localhost:3000" \
  --diagnostic "$stage1_prod_source_probe_dir/source-probe-diagnostic.json" >/dev/null 2>&1
stage1_prod_source_probe_status=$?
set -e
if [[ "$stage1_prod_source_probe_status" -ne 2 ]]; then
  printf 'production source probe must exit 2 for local/non-HTTPS URLs without writing canonical source, got %s\n' "$stage1_prod_source_probe_status" >&2
  exit 1
fi
python3 - "$stage1_prod_source_probe_dir/source-probe-diagnostic.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
if data.get("status") != "blocked":
    raise SystemExit("production source probe diagnostic must stay blocked")
if data.get("canonical_source_written") is not False:
    raise SystemExit("production source probe diagnostic must not claim canonical source writes")
if not data.get("blocked_checks"):
    raise SystemExit("production source probe diagnostic must include blockers")
if any(data.get(field) is not False for field in (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
)):
    raise SystemExit("production source probe diagnostic must preserve safe projection false flags")
PY
cat >"$stage1_prod_source_probe_dir/billing-test-proof.json" <<'JSON'
{
  "release_sha": "0123456789abcdef0123456789abcdef01234567",
  "stripe_mode": "test",
  "livemode": false,
  "lifecycle": {},
  "refund_credit_webhook": {}
}
JSON
set +e
python3 scripts/stage1_production_source_probe.py \
  --billing \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --billing-proof "$stage1_prod_source_probe_dir/billing-test-proof.json" \
  --billing-source "$stage1_prod_source_probe_dir/billing-source.json" \
  --diagnostic "$stage1_prod_source_probe_dir/billing-diagnostic.json" \
  --write-canonical-source >/dev/null 2>&1
stage1_prod_billing_source_probe_status=$?
set -e
if [[ "$stage1_prod_billing_source_probe_status" -ne 2 ]]; then
  printf 'production billing source probe must exit 2 for test-mode proof, got %s\n' "$stage1_prod_billing_source_probe_status" >&2
  exit 1
fi
python3 - "$stage1_prod_source_probe_dir/billing-diagnostic.json" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if data.get("status") != "blocked":
    raise SystemExit("production billing source diagnostic must stay blocked")
if data.get("canonical_source_written") is not False:
    raise SystemExit("production billing source diagnostic must not claim canonical source writes")
joined = " ".join(str(item) for item in data.get("blocked_checks", []))
if "stripe_mode must be live" not in joined:
    raise SystemExit(f"production billing source diagnostic must reject test mode: {joined}")
PY
stage1_prod_pipeline_dir="$(mktemp -d)"
set +e
python3 scripts/run_stage1_production_launch_source_pipeline.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --production-web-url "http://localhost:3000" \
  --billing-proof "$stage1_prod_pipeline_dir/missing-billing-proof.json" \
  --security-proof "$stage1_prod_pipeline_dir/missing-security-proof.json" \
  --governance-proof "$stage1_prod_pipeline_dir/missing-governance-proof.json" \
  --billing-diagnostic "$stage1_prod_pipeline_dir/billing-diagnostic.json" \
  --security-diagnostic "$stage1_prod_pipeline_dir/security-diagnostic.json" \
  --legal-diagnostic "$stage1_prod_pipeline_dir/legal-diagnostic.json" \
  --governance-diagnostic "$stage1_prod_pipeline_dir/governance-diagnostic.json" \
  --summary "$stage1_prod_pipeline_dir/production-launch-source-pipeline.json" >/dev/null 2>&1
stage1_prod_pipeline_status=$?
set -e
if [[ "$stage1_prod_pipeline_status" -ne 2 ]]; then
  printf 'production launch source pipeline must exit 2 without production proofs, got %s\n' "$stage1_prod_pipeline_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_production_launch_source_pipeline.py \
  --summary "$stage1_prod_pipeline_dir/production-launch-source-pipeline.json"
stage1_prod_source_runbook_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_source_probe_runbook.py \
  --launch-input-packet "$stage1_prod_input_packet_dir/production-launch-input-packet.json" \
  --launch-operator-brief "$stage1_prod_operator_brief_dir/production-launch-operator-brief.json" \
  --missing-input-checklist "$stage1_prod_missing_input_checklist_dir/production-missing-input-checklist.json" \
  --launch-source-pipeline "$stage1_prod_pipeline_dir/production-launch-source-pipeline.json" \
  --output "$stage1_prod_source_runbook_dir/production-source-probe-runbook.json" >/dev/null
python3 scripts/validate_stage1_production_source_probe_runbook.py \
  --runbook "$stage1_prod_source_runbook_dir/production-source-probe-runbook.json" \
  --launch-input-packet "$stage1_prod_input_packet_dir/production-launch-input-packet.json" \
  --launch-operator-brief "$stage1_prod_operator_brief_dir/production-launch-operator-brief.json" \
  --missing-input-checklist "$stage1_prod_missing_input_checklist_dir/production-missing-input-checklist.json" \
  --launch-source-pipeline "$stage1_prod_pipeline_dir/production-launch-source-pipeline.json"
stage1_prod_dns_repair_packet_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_dns_repair_packet.py \
  --dns-readiness ops/evidence/non_clearing/production-dns-readiness.json \
  --dns-cutover-plan ops/evidence/non_clearing/production-dns-cutover-plan.json \
  --source-runbook "$stage1_prod_source_runbook_dir/production-source-probe-runbook.json" \
  --output "$stage1_prod_dns_repair_packet_dir/production-dns-repair-packet.json" \
  --operator-markdown "$stage1_prod_dns_repair_packet_dir/production-dns-operator-checklist.md" >/dev/null
python3 scripts/validate_stage1_production_dns_repair_packet.py \
  --packet "$stage1_prod_dns_repair_packet_dir/production-dns-repair-packet.json" \
  --operator-markdown "$stage1_prod_dns_repair_packet_dir/production-dns-operator-checklist.md" \
  --dns-readiness ops/evidence/non_clearing/production-dns-readiness.json \
  --dns-cutover-plan ops/evidence/non_clearing/production-dns-cutover-plan.json \
  --source-runbook "$stage1_prod_source_runbook_dir/production-source-probe-runbook.json"
stage1_prod_blocker_checklist_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_blocker_checklist.py \
  --operator-brief "$stage1_prod_operator_brief_dir/production-launch-operator-brief.json" \
  --missing-input-checklist "$stage1_prod_missing_input_checklist_dir/production-missing-input-checklist.json" \
  --source-runbook "$stage1_prod_source_runbook_dir/production-source-probe-runbook.json" \
  --dns-packet "$stage1_prod_dns_repair_packet_dir/production-dns-repair-packet.json" \
  --billing-packet "$stage1_prod_billing_operator_dir/production-billing-operator-packet.json" \
  --security-packet "$stage1_prod_security_operator_dir/production-security-operator-packet.json" \
  --governance-packet "$stage1_prod_governance_operator_dir/production-governance-operator-packet.json" \
  --output "$stage1_prod_blocker_checklist_dir/production-blocker-checklist.md" >/dev/null
python3 scripts/validate_stage1_production_blocker_checklist.py \
  --checklist "$stage1_prod_blocker_checklist_dir/production-blocker-checklist.md" \
  --operator-brief "$stage1_prod_operator_brief_dir/production-launch-operator-brief.json" \
  --missing-input-checklist "$stage1_prod_missing_input_checklist_dir/production-missing-input-checklist.json" \
  --source-runbook "$stage1_prod_source_runbook_dir/production-source-probe-runbook.json" \
  --dns-packet "$stage1_prod_dns_repair_packet_dir/production-dns-repair-packet.json" \
  --billing-packet "$stage1_prod_billing_operator_dir/production-billing-operator-packet.json" \
  --security-packet "$stage1_prod_security_operator_dir/production-security-operator-packet.json" \
  --governance-packet "$stage1_prod_governance_operator_dir/production-governance-operator-packet.json"
stage1_prod_action_matrix_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_action_matrix.py \
  --missing-input-checklist "$stage1_prod_missing_input_checklist_dir/production-missing-input-checklist.json" \
  --source-runbook "$stage1_prod_source_runbook_dir/production-source-probe-runbook.json" \
  --dns-packet "$stage1_prod_dns_repair_packet_dir/production-dns-repair-packet.json" \
  --billing-packet "$stage1_prod_billing_operator_dir/production-billing-operator-packet.json" \
  --security-packet "$stage1_prod_security_operator_dir/production-security-operator-packet.json" \
  --governance-packet "$stage1_prod_governance_operator_dir/production-governance-operator-packet.json" \
  --output "$stage1_prod_action_matrix_dir/production-action-matrix.json" \
  --markdown "$stage1_prod_action_matrix_dir/production-action-matrix.md" >/dev/null
python3 scripts/validate_stage1_production_action_matrix.py \
  --matrix "$stage1_prod_action_matrix_dir/production-action-matrix.json" \
  --markdown "$stage1_prod_action_matrix_dir/production-action-matrix.md" \
  --missing-input-checklist "$stage1_prod_missing_input_checklist_dir/production-missing-input-checklist.json" \
  --source-runbook "$stage1_prod_source_runbook_dir/production-source-probe-runbook.json"
stage1_prod_bundle_dir="$(mktemp -d)"
printf 'STRIPE_MODE=test\n' >"$stage1_prod_bundle_dir/.env"
set +e
python3 scripts/run_stage1_production_proof_bundle.py \
  --env "$stage1_prod_bundle_dir/.env" \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --production-web-url "http://localhost:3000" \
  --billing-proof "$stage1_prod_bundle_dir/billing-proof.json" \
  --security-proof "$stage1_prod_bundle_dir/security-proof.json" \
  --governance-proof "$stage1_prod_bundle_dir/governance-proof.json" \
  --billing-diagnostic "$stage1_prod_bundle_dir/billing-blocked.json" \
  --security-diagnostic "$stage1_prod_bundle_dir/security-blocked.json" \
  --legal-diagnostic "$stage1_prod_bundle_dir/legal-blocked.json" \
  --governance-diagnostic "$stage1_prod_bundle_dir/governance-blocked.json" \
  --pipeline-summary "$stage1_prod_bundle_dir/pipeline.json" \
  --summary "$stage1_prod_bundle_dir/production-proof-bundle.json" >/dev/null 2>&1
stage1_prod_bundle_status=$?
set -e
if [[ "$stage1_prod_bundle_status" -ne 2 ]]; then
  printf 'production proof bundle must exit 2 without production proofs, got %s\n' "$stage1_prod_bundle_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_production_proof_bundle.py \
  --summary "$stage1_prod_bundle_dir/production-proof-bundle.json"
python3 scripts/generate_stage1_staging_runtime_evidence.py --contract-only
python3 scripts/stage1_azure_origin_readiness.py --contract-only
python3 scripts/validate_stage1_azure_origin_readiness.py --contract-only
stage1_runtime_preflight_dir="$(mktemp -d)"
set +e
python3 scripts/generate_stage1_staging_runtime_evidence.py \
  --evidence "$stage1_runtime_preflight_dir/stage1-runtime.json" \
  --results "$stage1_runtime_preflight_dir/stage1-runtime.ndjson" >/dev/null 2>&1
stage1_runtime_preflight_status=$?
set -e
if [[ "$stage1_runtime_preflight_status" != "0" && "$stage1_runtime_preflight_status" != "2" ]]; then
  printf 'unexpected Stage1 staging runtime aggregate generator exit: %s\n' "$stage1_runtime_preflight_status" >&2
  exit 1
fi
if [[ "$stage1_runtime_preflight_status" == "0" ]]; then
  python3 scripts/validate_stage1_staging_runtime.py \
    --evidence "$stage1_runtime_preflight_dir/stage1-runtime.json" \
    --results "$stage1_runtime_preflight_dir/stage1-runtime.ndjson"
else
  python3 scripts/validate_stage1_staging_runtime.py --allow-preflight \
    --evidence "$stage1_runtime_preflight_dir/stage1-runtime.json" \
    --results "$stage1_runtime_preflight_dir/stage1-runtime.ndjson"
  set +e
  python3 scripts/validate_stage1_staging_runtime.py \
    --evidence "$stage1_runtime_preflight_dir/stage1-runtime.json" \
    --results "$stage1_runtime_preflight_dir/stage1-runtime.ndjson" >/dev/null 2>&1
  stage1_runtime_preflight_strict_status=$?
  set -e
  if [[ "$stage1_runtime_preflight_strict_status" -eq 0 ]]; then
    printf 'Stage1 staging runtime aggregate preflight must not pass strict canonical validation\n' >&2
    exit 1
  fi
fi
python3 scripts/validate_stage1_azure_origin_readiness.py
python3 scripts/generate_stage1_staging_quota_replay_evidence.py --contract-only
python3 scripts/generate_stage1_production_launch_evidence.py --contract-only
python3 scripts/generate_stage1_release_evidence_closure_queue.py --contract-only
python3 scripts/stage1_r2_bucket_readiness.py --contract-only
python3 scripts/generate_stage1_external_resource_readiness.py --contract-only
python3 scripts/generate_stage1_release_metadata_preflight.py --contract-only
set +e
python3 scripts/generate_stage1_next_blockers_summary.py >/dev/null
stage1_next_blockers_summary_status=$?
set -e
if [[ "$stage1_next_blockers_summary_status" != "0" && "$stage1_next_blockers_summary_status" != "2" ]]; then
  printf 'unexpected Stage1 next blockers summary generator exit: %s\n' "$stage1_next_blockers_summary_status" >&2
  exit "$stage1_next_blockers_summary_status"
fi
python3 scripts/validate_stage1_next_blockers_summary.py

log "stage1 Stripe sandbox selftest"
run_stripe_selftest_when_configured

log "stage1 OpenAI-compatible provider selftest"
bash scripts/openai_compatible_provider_selftest.sh --contract-only
run_openai_provider_selftest_when_configured

log "stage1 aggregate local-devport/debug gate guard"
python3 - <<'PY'
import importlib.util
from pathlib import Path

root = Path.cwd()

validator_spec = importlib.util.spec_from_file_location(
    "validate_stage1_staging_runtime",
    root / "scripts" / "validate_stage1_staging_runtime.py",
)
validator = importlib.util.module_from_spec(validator_spec)
assert validator_spec.loader is not None
validator_spec.loader.exec_module(validator)

generator_spec = importlib.util.spec_from_file_location(
    "generate_stage1_staging_runtime_evidence",
    root / "scripts" / "generate_stage1_staging_runtime_evidence.py",
)
generator = importlib.util.module_from_spec(generator_spec)
assert generator_spec.loader is not None
generator_spec.loader.exec_module(generator)

production_validator_spec = importlib.util.spec_from_file_location(
    "validate_stage1_production_launch",
    root / "scripts" / "validate_stage1_production_launch.py",
)
production_validator = importlib.util.module_from_spec(production_validator_spec)
assert production_validator_spec.loader is not None
production_validator_spec.loader.exec_module(production_validator)

production_generator_spec = importlib.util.spec_from_file_location(
    "generate_stage1_production_launch_evidence",
    root / "scripts" / "generate_stage1_production_launch_evidence.py",
)
production_generator = importlib.util.module_from_spec(production_generator_spec)
assert production_generator_spec.loader is not None
production_generator_spec.loader.exec_module(production_generator)

canonical_pass_shape = {
    "schema_version": "stage0.rev2.staging.object_storage_retention_cleanup",
    "environment": "staging",
    "kind": "object_storage_retention_cleanup",
    "status": "pass",
    "split_evidence": {
        "canonical_pass_paths": True,
        "retention_cleanup_ready": True,
    },
    "input_readiness": {
        "canonical_pass_path": True,
    },
    "gate_impact": {
        "can_clear_release_gate_check": True,
        "preserved_release_gate_check_id": None,
    },
    "blocked_checks": [],
}
validator.require_no_local_debug_flags(canonical_pass_shape, "canonical")
if generator.local_debug_blockers(canonical_pass_shape, "canonical"):
    raise SystemExit("generator must not flag canonical pass-shaped evidence")

context_only_staging_pass = {
    "schema_version": "stage0.rev2.staging.auth_rbac_tenant_audit",
    "environment": "staging",
    "kind": "auth_rbac_tenant_audit",
    "status": "pass",
    "do_not_launch_condition_id": "tenant_isolation_not_enforced",
    "gate_impact": {
        "can_clear_check_level_item": True,
        "aggregate_private_beta_gate_status": "blocked_by_other_staging_runtime_items",
        "remaining_blockers": ["staging_object_storage_signed_downloads"],
    },
}
if not validator.has_component_clear_signal(context_only_staging_pass):
    raise SystemExit("staging context-only pass fixture must expose component clear signal")
validator.require_no_local_debug_flags(context_only_staging_pass, "context", allow_context_only=True)
context_only_blockers = generator.local_debug_blockers(
    context_only_staging_pass,
    "context",
    allow_context_only=True,
)
if context_only_blockers:
    raise SystemExit(f"generator must not flag pass evidence that only preserves other staging blockers: {context_only_blockers}")
context_markers = generator.normalized_string_values(context_only_staging_pass) & generator.BLOCKED_MARKERS
if context_markers - generator.CONTEXT_ONLY_BLOCKED_MARKERS:
    raise SystemExit(f"context-only fixture must not contain hard blocked markers: {context_markers}")

support_ticket_context_probe = {
    "schema_version": "stage0.rev2.staging.legal_support_visibility.split",
    "environment": "staging",
    "kind": "support_contact_external_user_visibility",
    "status": "pass",
    "release_gate_check_id": "staging_legal_external_user_pages",
    "gate_impact": {
        "can_clear_support_contact_subitem": True,
        "can_clear_check_level_item": True,
        "aggregate_private_beta_gate_status": "blocked_by_other_staging_runtime_items",
    },
    "ticket_context_probe": {
        "mode": "dry_run",
        "captured_context_fields": ["project_id", "task_id", "trace_id", "contact_email"],
        "privacy_redaction": "Prompt text and uploaded assets stay redacted.",
    },
}
support_markers = validator.blocked_markers_for_evidence(
    support_ticket_context_probe,
    "legal_support_external_user",
    allow_context_only=True,
)
if support_markers:
    raise SystemExit(f"support ticket context dry-run probe should not block passed support visibility split: {support_markers}")
support_generator_markers = generator.blocked_markers_for_evidence(
    support_ticket_context_probe,
    "legal_support_external_user",
    allow_context_only=True,
)
if support_generator_markers:
    raise SystemExit(f"generator should not block passed support visibility split context probe: {support_generator_markers}")
hard_dry_run_probe = {
    "schema_version": "stage0.rev2.staging.provider_sandbox",
    "environment": "staging",
    "kind": "provider_sandbox",
    "status": "pass",
    "gate_impact": {"can_clear_check_level_item": True},
    "probe": {"mode": "dry_run"},
}
hard_markers = validator.blocked_markers_for_evidence(
    hard_dry_run_probe,
    "provider_sandbox",
    allow_context_only=True,
)
if "dry_run" not in hard_markers:
    raise SystemExit("non legal/support dry-run evidence must still be blocked")

debug_spoof = {
    "schema_version": "stage0.rev2.staging.object_storage_retention_cleanup",
    "environment": "staging",
    "kind": "object_storage_retention_cleanup",
    "status": "pass",
    "local_devport_debug": True,
    "blocked_checks": ["local_devport_debug_evidence_cannot_clear_staging_gate"],
    "split_evidence": {
        "canonical_pass_paths": False,
        "retention_cleanup_runtime_ready": True,
        "retention_cleanup_ready": False,
    },
    "input_readiness": {
        "allow_local_devport_evidence": True,
        "canonical_pass_path": False,
    },
    "gate_impact": {
        "can_clear_release_gate_check": False,
        "preserved_release_gate_check_id": "staging_object_storage_retention_cleanup",
    },
}
try:
    validator.require_no_local_debug_flags(debug_spoof, "spoof")
except validator.Stage1StagingRuntimeError as exc:
    message = str(exc)
    for token in (
        "local_devport_debug",
        "allow_local_devport_evidence",
        "canonical_pass_path",
        "can_clear_release_gate_check",
    ):
        if token not in message:
            raise SystemExit(f"strict validator local-devport guard missed {token}: {message}")
else:
    raise SystemExit("strict validator must reject pass-shaped local-devport debug evidence")

blockers = generator.local_debug_blockers(debug_spoof, "spoof")
for token in (
    "local_devport_debug",
    "allow_local_devport_evidence",
    "canonical_pass_path",
    "can_clear_release_gate_check",
):
    if not any(token in blocker for blocker in blockers):
        raise SystemExit(f"generator local-devport guard missed {token}: {blockers}")

production_pass_shape = {
    "schema_version": "stage1.production.provider_claims.v1",
    "environment": "production",
    "kind": "provider_claims",
    "status": "pass",
    "blocked_checks": [],
    "do_not_launch_conditions": [],
    "gate_impact": {
        "can_clear_aggregate_production_gate": True,
        "remaining_blockers": [],
        "preserved_release_gate_check_id": None,
    },
    "input_readiness": {
        "canonical_pass_path": True,
    },
}
production_validator.require_no_blocked_gate_signals(production_pass_shape, "production")
if production_generator.blocked_gate_signal_blockers(production_pass_shape, "production"):
    raise SystemExit("production generator must not flag canonical pass-shaped evidence")
if not production_generator.check_level_clear_signal(
    {
        "environment": "production",
        "status": "pass_with_blockers_preserved",
        "release_gate_check_id": "production_provider_or_comp_only_mode",
        "gate_impact": {
            "can_clear_check_level_item": True,
            "can_clear_aggregate_production_gate": False,
            "remaining_blockers": ["production_paid_billing_lifecycle"],
        },
    },
    "provider_claims",
):
    raise SystemExit("production check-level projection must recognize pass-with-preserved provider evidence")
if production_generator.check_level_clear_signal(
    {
        "environment": "production",
        "status": "blocked",
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "gate_impact": {
            "can_clear_checkout_subscription_subitem": False,
            "can_clear_aggregate_production_gate": False,
            "remaining_blockers": ["production_paid_billing_lifecycle"],
        },
    },
    "paid_billing_lifecycle",
):
    raise SystemExit("production check-level projection must not clear blocked billing lifecycle evidence")

production_spoof = {
    "schema_version": "stage1.production.provider_claims.v1",
    "environment": "production",
    "kind": "provider_claims",
    "status": "pass",
    "local_devport_debug": True,
    "blocked_checks": ["local_devport_debug_evidence_cannot_clear_staging_gate"],
    "do_not_launch_conditions": ["production_launch_evidence_incomplete"],
    "input_readiness": {
        "allow_local_devport_evidence": True,
        "canonical_pass_path": False,
    },
    "gate_impact": {
        "can_clear_aggregate_production_gate": False,
        "remaining_blockers": ["upstream staging runtime not strict pass"],
        "preserved_release_gate_check_id": "production_provider_claims",
    },
}
try:
    production_validator.require_no_blocked_gate_signals(production_spoof, "production_spoof")
except production_validator.Stage1ProductionLaunchError as exc:
    message = str(exc)
    for token in (
        "local_devport_debug",
        "allow_local_devport_evidence",
        "canonical_pass_path",
        "can_clear_aggregate_production_gate",
        "remaining_blockers",
    ):
        if token not in message:
            raise SystemExit(f"production strict validator guard missed {token}: {message}")
else:
    raise SystemExit("production strict validator must reject pass-shaped blocked/debug evidence")

production_blockers = production_generator.blocked_gate_signal_blockers(production_spoof, "production_spoof")
for token in (
    "local_devport_debug",
    "allow_local_devport_evidence",
    "canonical_pass_path",
    "can_clear_aggregate_production_gate",
    "remaining_blockers",
):
    if not any(token in blocker for blocker in production_blockers):
        raise SystemExit(f"production generator guard missed {token}: {production_blockers}")
PY

log "stage1 aggregate blocked evidence generation"
(
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  set +e
  python3 scripts/generate_stage1_staging_runtime_evidence.py \
    --evidence "$tmpdir/stage1-runtime.json" \
    --results "$tmpdir/stage1-runtime.ndjson"
  staging_status=$?
  python3 scripts/generate_stage1_production_launch_evidence.py \
    --evidence "$tmpdir/stage1-production-launch.json" \
    --results "$tmpdir/stage1-production-launch.ndjson"
  production_status=$?
  set -e
  if [[ "$staging_status" != "0" && "$staging_status" != "2" ]]; then
    printf 'unexpected staging aggregate generator exit: %s\n' "$staging_status" >&2
    exit "$staging_status"
  fi
  if [[ "$production_status" != "0" && "$production_status" != "2" ]]; then
    printf 'unexpected production aggregate generator exit: %s\n' "$production_status" >&2
    exit "$production_status"
  fi
  if [[ "$production_status" == "2" ]]; then
    python3 scripts/validate_stage1_production_launch.py --allow-preflight \
      --evidence "$tmpdir/stage1-production-launch.json" \
      --results "$tmpdir/stage1-production-launch.ndjson"
    set +e
    python3 scripts/validate_stage1_production_launch.py \
      --evidence "$tmpdir/stage1-production-launch.json" \
      --results "$tmpdir/stage1-production-launch.ndjson" >/dev/null 2>&1
    production_strict_status=$?
    set -e
    if [[ "$production_strict_status" -eq 0 ]]; then
      printf 'Stage1 production launch aggregate preflight must not pass strict canonical validation\n' >&2
      exit 1
    fi
  fi
  python3 scripts/generate_stage1_release_evidence_closure_queue.py \
    --staging "$tmpdir/stage1-runtime.json" \
    --production "$tmpdir/stage1-production-launch.json" \
    --output "$tmpdir/stage1-evidence-closure-queue.preflight.json" >/dev/null
  python3 scripts/validate_stage1_release_evidence_closure_queue.py --allow-preflight \
    --evidence "$tmpdir/stage1-evidence-closure-queue.preflight.json"
  set +e
  python3 scripts/validate_stage1_release_evidence_closure_queue.py \
    --evidence "$tmpdir/stage1-evidence-closure-queue.preflight.json" >/dev/null 2>&1
  closure_queue_strict_status=$?
  set -e
  if [[ "$closure_queue_strict_status" -eq 0 ]]; then
    printf 'Stage1 release evidence closure queue preflight must not pass strict canonical validation\n' >&2
    exit 1
  fi
  : >"$tmpdir/missing.env"
  python3 scripts/stage1_r2_bucket_readiness.py \
    --env-file "$tmpdir/missing.env" \
    --output "$tmpdir/stage1-r2-bucket-readiness.preflight.json" >/dev/null
  python3 scripts/validate_stage1_r2_bucket_readiness.py --allow-preflight \
    --evidence "$tmpdir/stage1-r2-bucket-readiness.preflight.json"
  set +e
  python3 scripts/validate_stage1_r2_bucket_readiness.py \
    --evidence "$tmpdir/stage1-r2-bucket-readiness.preflight.json" >/dev/null 2>&1
  r2_readiness_strict_status=$?
  set -e
  if [[ "$r2_readiness_strict_status" -eq 0 ]]; then
    printf 'Stage1 R2 bucket readiness preflight must not pass strict validation\n' >&2
    exit 1
  fi
  python3 scripts/generate_stage1_external_resource_readiness.py \
    --env-file "$tmpdir/missing.env" \
    --staging "$tmpdir/stage1-runtime.json" \
    --production "$tmpdir/stage1-production-launch.json" \
    --r2-readiness "$tmpdir/stage1-r2-bucket-readiness.preflight.json" \
    --output "$tmpdir/stage1-external-resource-readiness.preflight.json" >/dev/null
  python3 scripts/validate_stage1_external_resource_readiness.py --allow-preflight \
    --evidence "$tmpdir/stage1-external-resource-readiness.preflight.json"
  set +e
  python3 scripts/validate_stage1_external_resource_readiness.py \
    --evidence "$tmpdir/stage1-external-resource-readiness.preflight.json" >/dev/null 2>&1
  resource_readiness_strict_status=$?
  set -e
  if [[ "$resource_readiness_strict_status" -eq 0 ]]; then
    printf 'Stage1 external resource readiness preflight must not pass strict canonical validation\n' >&2
    exit 1
  fi
  python3 - "$tmpdir" <<'PY'
import json
import sys
from pathlib import Path

tmpdir = Path(sys.argv[1])
staging = json.loads((tmpdir / "stage1-runtime.json").read_text(encoding="utf-8"))
production = json.loads((tmpdir / "stage1-production-launch.json").read_text(encoding="utf-8"))
closure_queue = json.loads((tmpdir / "stage1-evidence-closure-queue.preflight.json").read_text(encoding="utf-8"))
resource_readiness = json.loads((tmpdir / "stage1-external-resource-readiness.preflight.json").read_text(encoding="utf-8"))
if closure_queue["schema_version"] != "stage1.release_evidence_closure_queue.preflight.v1":
    raise SystemExit("closure queue preflight schema mismatch")
if closure_queue["status"] != "blocked" or closure_queue["release_gate_decision"] != "no_go":
    raise SystemExit("closure queue preflight must stay blocked/no_go")
if closure_queue.get("can_clear_stage1_staging_runtime_gate") is not False:
    raise SystemExit("closure queue preflight must not clear staging gate")
if closure_queue.get("can_clear_stage1_production_launch_gate") is not False:
    raise SystemExit("closure queue preflight must not clear production gate")
if closure_queue.get("can_close_do_not_launch") is not False:
    raise SystemExit("closure queue preflight must not close DNL")
if resource_readiness["schema_version"] != "stage1.external_resource_readiness.preflight.v1":
    raise SystemExit("external resource readiness preflight schema mismatch")
if resource_readiness["status"] != "blocked" or resource_readiness["release_gate_decision"] != "no_go":
    raise SystemExit("external resource readiness preflight must stay blocked/no_go")
if resource_readiness.get("can_clear_stage1_staging_runtime_gate") is not False:
    raise SystemExit("external resource readiness preflight must not clear staging gate")
if resource_readiness.get("can_clear_stage1_production_launch_gate") is not False:
    raise SystemExit("external resource readiness preflight must not clear production gate")
if resource_readiness.get("can_close_do_not_launch") is not False:
    raise SystemExit("external resource readiness preflight must not close DNL")
expected_resources = [
    "llm_zai_openai_compatible",
    "r2_zenari_bucket",
    "staging_public_urls",
    "staging_admin_access",
    "staging_quota_replay_db",
    "ci_exact_artifacts",
    "production_launch_inputs",
]
if [row.get("resource_id") for row in resource_readiness.get("resource_groups", [])] != expected_resources:
    raise SystemExit("external resource readiness resource order mismatch")
summary = resource_readiness.get("resource_summary", {})
if summary.get("total") != len(expected_resources):
    raise SystemExit("external resource readiness total mismatch")
if not (0 <= float(summary.get("ready_percent", -1)) <= 100):
    raise SystemExit("external resource readiness percent out of range")
expected_gates = [
    "stage1_staging_runtime_preflight",
    "staging_quota_replay",
    "stage1_load",
    "object_retention_cleanup",
    "ci_pr_main_run",
    "ci_playwright_smoke",
    "ci_docker_image_build",
    "stage1_production_launch_preflight",
    "production_backup_rollback_split",
    "production_provider_claims",
    "production_paid_billing_lifecycle",
    "production_security_launch_checks",
    "production_legal_support_policy",
    "production_governance_release",
]
queue_rows = closure_queue.get("queue", [])
if [row.get("gate") for row in queue_rows] != expected_gates:
    raise SystemExit("closure queue gate order mismatch")
expected_open_gates = [row.get("gate") for row in queue_rows if row.get("row_status") != "passed"]
summary = closure_queue.get("queue_summary", {})
if summary.get("open_gates") != expected_open_gates:
    raise SystemExit("closure queue open gate order mismatch")
if summary.get("open") != len(expected_open_gates):
    raise SystemExit("closure queue open count mismatch")
if summary.get("completed") != len(expected_gates) - len(expected_open_gates):
    raise SystemExit("closure queue completed count mismatch")
if staging["schema_version"] != "stage1.staging_runtime.v1":
    raise SystemExit("staging aggregate schema mismatch")
if production["schema_version"] != "stage1.production_launch.v1":
    raise SystemExit("production aggregate schema mismatch")
if staging["status"] == "pass":
    if staging["release_gate_decision"] != "go" or staging["do_not_launch_conditions"]:
        raise SystemExit("passing staging aggregate must be go with no DNL conditions")
else:
    if staging["status"] != "blocked" or staging["release_gate_decision"] != "no_go":
        raise SystemExit("incomplete staging aggregate must be blocked/no_go")
    if "stage1_staging_runtime_evidence_incomplete" not in staging.get("do_not_launch_conditions", []):
        raise SystemExit("blocked staging aggregate must preserve incomplete evidence DNL")
    if not staging.get("blockers"):
        raise SystemExit("blocked staging aggregate must list blockers")
    components = {item.get("component_id"): item for item in staging.get("components", []) if isinstance(item, dict)}
    if "staging_quota_replay" not in components:
        raise SystemExit("blocked staging aggregate must include staging_quota_replay component")
    if components["staging_quota_replay"].get("status") != "blocked":
        raise SystemExit("staging_quota_replay must remain blocked until canonical strict evidence exists")
    readiness = staging.get("runtime_input_readiness", {})
    expected_ready = {
        "admin_auth_ready": True,
        "user_auth_ready": True,
        "observability_ready": True,
        "backup_restore_ready": True,
        "stripe_test_ready": True,
        "quota_replay_ready": False,
        "object_storage_ready": False,
        "csrf_ready": False,
        "staging_web_ready": False,
        "provider_live_calls_ready": True,
        "staging_api_ready": False,
        "staging_admin_ready": False,
    }
    for key, expected in expected_ready.items():
        if readiness.get(key) is not expected:
            raise SystemExit(f"blocked staging aggregate readiness {key} must be {expected}, got {readiness.get(key)!r}: {readiness}")
if production["status"] == "pass":
    if production["release_gate_decision"] != "go" or production["do_not_launch_conditions"]:
        raise SystemExit("passing production aggregate must be go with no DNL conditions")
else:
    if production["status"] != "blocked" or production["release_gate_decision"] != "no_go":
        raise SystemExit("incomplete production aggregate must be blocked/no_go")
    if "stage1_production_launch_evidence_incomplete" not in production.get("do_not_launch_conditions", []):
        raise SystemExit("blocked production aggregate must preserve incomplete evidence DNL")
    if not production.get("blockers"):
        raise SystemExit("blocked production aggregate must list blockers")
    release_bundle = production.get("release_bundle_preflight", {})
    if release_bundle.get("path") != "ops/evidence/release/staging/stage0-rev2-current-release-evidence-bundle.json":
        raise SystemExit("blocked production aggregate must cite staging release bundle preflight")
    if release_bundle.get("blockers"):
        if release_bundle.get("status") != "blocked" or release_bundle.get("decision") != "no-go":
            raise SystemExit("blocked production aggregate must preserve release bundle no-go state when bundle blockers exist")
    else:
        if release_bundle.get("status") != "passed" or release_bundle.get("decision") != "go":
            raise SystemExit("blocked production aggregate may cite a passed release bundle once production-only blockers remain")
        for key in (
            "stage1_staging_runtime_verified",
            "stage1_quota_replay_verified",
            "stage1_load_verified",
            "object_retention_cleanup_verified",
            "legal_support_visibility_verified",
            "ci_closure_artifacts_ready",
            "production_backup_rollback_split_ready",
        ):
            if release_bundle.get(key) is not True:
                raise SystemExit(f"passed release bundle in blocked production aggregate must keep {key} true")
    readiness = production.get("runtime_input_readiness", {})
    if readiness.get("release_bundle_ready") != (not release_bundle.get("blockers")):
        raise SystemExit("blocked production aggregate release_bundle_ready must reflect release bundle blockers")
    joined_blockers = "\n".join(str(item) for item in production.get("blockers", []))
    if "production_launch:" not in joined_blockers:
        raise SystemExit("blocked production aggregate must preserve production launch fixture blockers")
    for token in (
        "paid_billing_lifecycle:",
        "security_launch_checks:",
        "legal_support_policy:",
        "activation_review_audit:",
        "abuse_throttle_hold:",
        "skill_release_eval_canary:",
    ):
        if token not in joined_blockers:
            raise SystemExit(f"blocked production aggregate must preserve production component blocker {token}")
PY
)

log "stage1 staging exact child evidence strict fixtures"
stage1_staging_child_fixture_dir="$(mktemp -d)"
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_staging_auth_rbac_tenant_audit_evidence.py
python3 - "$stage1_staging_child_fixture_dir/auth-rbac-spoof.json" <<'PY'
import json
import sys
from pathlib import Path

source = Path("ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json")
data = json.loads(source.read_text(encoding="utf-8"))
data["admin_rbac_evidence_ids"] = [
    item
    for item in data["admin_rbac_evidence_ids"]
    if item != "rbac-provider-002"
]
for coverage in data["coverage"]:
    if coverage.get("area") == "admin_rbac_runtime":
        coverage["evidence_refs"] = [
            ref
            for ref in coverage["evidence_refs"]
            if ref != "rbac-provider-002"
        ]
        coverage["runtime_probe"] = coverage["runtime_probe"].replace("expired provider, ", "")
        coverage["rbac_audit_evidence"] = coverage["rbac_audit_evidence"].replace(", including the expired rbac-provider-002 denial", "")
Path(sys.argv[1]).write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
set +e
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_staging_auth_rbac_tenant_audit_evidence.py \
  --evidence "$stage1_staging_child_fixture_dir/auth-rbac-spoof.json" >/dev/null 2>&1
stage1_staging_auth_spoof_status=$?
set -e
if [[ "$stage1_staging_auth_spoof_status" -eq 0 ]]; then
  printf 'Stage1 staging auth/RBAC validator must reject evidence missing expired override RBAC coverage\n' >&2
  exit 1
fi
python3 - "$stage1_staging_child_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
release_sha = "d3b1107c33dc40b8936f28549e06553fbd7b104a"

object_rows = []
for check_id, method in (
    ("retention_policy", "GET"),
    ("expired_export_cleanup", "POST"),
    ("orphan_cleanup", "POST"),
    ("audit_refs", "GET"),
):
    object_rows.append({
        "check_id": check_id,
        "method": method,
        "url": f"https://staging-api.zenari.test/api/admin/v1/{check_id}",
        "request_id_header": "X-Request-ID",
        "request_id": f"stage1-object-retention-{check_id}",
        "response_request_id_values": [f"stage1-object-retention-{check_id}"],
        "request_id_echoed": True,
        "url": f"https://staging-api.zenari.dev/api/admin/v1/object-storage/{check_id}",
        "expected_tokens": [check_id, "audit", "tenant"],
        "matched_tokens": [check_id, "audit", "tenant"],
        "missing_tokens": [],
        "response_bytes": 512,
        "status": "passed",
        "http_status": 200,
        "reason": "ok",
        "body_path": None,
        "headers_path": None,
    })

object_report = {
    "schema_version": "stage0.rev2.staging.object_storage_retention_cleanup",
    "evidence_id": "stage1-object-retention-strict-fixture",
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "environment": "staging",
    "kind": "object_storage_retention_cleanup",
    "status": "pass",
    "release_sha": release_sha,
    "base_url": "https://staging-api.zenari.dev",
    "local_devport_debug": False,
    "use_dev_identity_headers": False,
    "validated_by_role": "admin_operator",
    "admin_user_id": "admin-staging-fixture",
    "admin_tenant_id": "tenant-staging-fixture",
    "csrf": {"origin": "https://staging-admin.zenari.dev", "header_name": "X-Zenari-CSRF", "ready": True},
    "release_gate_check_id": "staging_object_storage_signed_downloads",
    "do_not_launch_condition_id": "object_storage_signed_retention_runtime_missing",
    "results_path": "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
    "split_evidence": {
        "signed_url_evidence": "ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json",
        "signed_url_ready": True,
        "signed_url_reason": "signed_url_runtime_evidence_ready",
        "signed_url_release_sha": release_sha,
        "release_sha_matches_signed_url": True,
        "retention_cleanup_runtime_ready": True,
        "retention_cleanup_ready": True,
        "canonical_pass_paths": True,
    },
    "audit_linkage": {
        "cleanup_audit_refs_by_probe": {
            "expired_export_cleanup": ["audit-expired-export-cleanup"],
            "orphan_cleanup": ["audit-orphan-cleanup"],
        },
        "cleanup_audit_refs": ["audit-expired-export-cleanup", "audit-orphan-cleanup"],
        "audit_endpoint_covers_cleanup_refs": {
            "expired_export_cleanup": ["audit-expired-export-cleanup"],
            "orphan_cleanup": ["audit-orphan-cleanup"],
        },
        "audit_endpoint_missing_cleanup_refs": {},
        "audit_endpoint_semantic_cleanup_refs": ["audit-expired-export-cleanup", "audit-orphan-cleanup"],
        "audit_endpoint_semantic_cleanup_refs_by_probe": {
            "expired_export_cleanup": ["audit-expired-export-cleanup"],
            "orphan_cleanup": ["audit-orphan-cleanup"],
        },
        "audit_endpoint_semantic_missing_cleanup_refs": [],
        "audit_endpoint_request_id_cleanup_refs_by_probe": {
            "expired_export_cleanup": ["audit-expired-export-cleanup"],
            "orphan_cleanup": ["audit-orphan-cleanup"],
        },
        "audit_endpoint_request_id_missing_cleanup_refs_by_probe": {},
        "audit_endpoint_request_id_missing_cleanup_refs": [],
        "audit_endpoint_refs": ["audit-expired-export-cleanup", "audit-orphan-cleanup"],
        "missing_cleanup_audit_refs": [],
        "verified": True,
        "semantic_verified": True,
        "request_id_verified": True,
    },
    "required_checks": ["audit_refs", "expired_export_cleanup", "orphan_cleanup", "retention_policy"],
    "probe_contract": {
        "canonical_pass_report": "ops/evidence/staging/object-storage-retention-cleanup.json",
        "canonical_pass_results": "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
        "allow_local_devport_evidence_env": "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only evidence under ops/evidence/staging/local-devport/ and cannot clear staging gates",
    },
    "runtime_input_requirements": {
        "required_release_sha": release_sha,
        "canonical_pass_results": "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
    },
    "input_readiness": {
        "probe_urls_ready": True,
        "auth_ready": True,
        "admin_user_id_ready": True,
        "admin_tenant_id_ready": True,
        "csrf_ready": True,
        "release_sha_provided": True,
        "signed_url_evidence_ready": True,
        "release_sha_matches_signed_url": True,
        "canonical_pass_path": True,
        "allow_local_devport_evidence": False,
        "use_dev_identity_headers": False,
    },
    "coverage": [
        {
            "area": row["check_id"],
            "status": "pass",
            "runtime_probe": f"Fixture proves {row['check_id']} runtime behavior.",
            "evidence_path_policy": "ops/evidence/staging/",
            "evidence_refs": [
                "ops/evidence/staging/object-storage-retention-cleanup.ndjson",
                "ops/evidence/staging/object-storage-retention-cleanup.json",
            ],
            "expected_tokens": row["expected_tokens"],
            "release_sha_bound": True,
            "admin_identity_bound": True,
            "request_ids": [row["request_id"]],
            "response_bytes": row["response_bytes"],
            "source_results": [row],
        }
        for row in object_rows
    ],
    "blocked_checks": [],
    "gate_impact": {
        "check_level_item": "Private Beta/Staging object retention/cleanup runtime evidence passed.",
        "can_clear_retention_cleanup_checklist_item": True,
        "can_clear_release_gate_check": True,
        "remaining_release_gate_blockers_after_pass": [],
        "requires_release_gate_fixture_update_after_pass": True,
        "preserved_release_gate_check_id": None,
        "preserved_do_not_launch_condition_id": None,
    },
}
(out / "object-storage-retention-cleanup.json").write_text(json.dumps(object_report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "object-storage-retention-cleanup.ndjson").write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in object_rows), encoding="utf-8")

legal = {
    "schema_version": "stage0.rev2",
    "environment": "staging",
    "kind": "legal_pages_external_user_visibility",
    "status": "pass",
    "release_gate_check_id": "staging_legal_external_user_pages",
    "web_url": "https://staging-web.zenari.test",
    "pages": [
        {"page_id": "terms", "path": "/terms", "http_status": 200, "visibility": "external_user", "required_tokens": ["Terms"], "probe_result": "ok"},
        {"page_id": "privacy_policy", "path": "/privacy", "http_status": 200, "visibility": "external_user", "required_tokens": ["Privacy"], "probe_result": "ok"},
        {"page_id": "acceptable_use", "path": "/acceptable-use", "http_status": 200, "visibility": "external_user", "required_tokens": ["Acceptable"], "probe_result": "ok"},
        {"page_id": "ai_content_disclaimer", "path": "/ai-content-disclaimer", "http_status": 200, "visibility": "external_user", "required_tokens": ["AI"], "probe_result": "ok"},
        {"page_id": "ip_complaint", "path": "/ip-complaint", "http_status": 200, "visibility": "external_user", "required_tokens": ["IP"], "probe_result": "ok"},
    ],
    "coverage": [
        {"area": "legal_pages_visibility", "status": "pass", "runtime_probe": "ok", "evidence_refs": ["ops/evidence/staging/legal-pages-external-user.json"]}
    ],
    "gate_impact": {
        "can_clear_legal_pages_subitem": True,
        "can_clear_check_level_item": True,
        "aggregate_private_beta_gate_status": "blocked_by_other_staging_runtime_items",
    },
}
support = {
    "schema_version": "stage0.rev2",
    "environment": "staging",
    "kind": "support_contact_external_user_visibility",
    "status": "pass",
    "release_gate_check_id": "staging_legal_external_user_pages",
    "web_url": "https://staging-web.zenari.test",
    "support_surfaces": [
        {"surface_id": "support_contact", "path": "/support", "http_status": 200, "visibility": "external_user", "required_tokens": ["support"], "probe_result": "ok"},
        {"surface_id": "report_problem", "path": "/report-problem", "http_status": 200, "visibility": "external_user_session", "required_tokens": ["trace"], "probe_result": "ok"},
        {"surface_id": "billing_policy", "path": "/legal/billing-policy", "http_status": 200, "visibility": "external_user", "required_tokens": ["billing"], "probe_result": "ok"},
    ],
    "coverage": [
        {"area": "support_contact_visibility", "status": "pass", "runtime_probe": "ok", "evidence_refs": ["ops/evidence/staging/support-contact-external-user.json"]},
        {"area": "billing_policy_visibility", "status": "pass", "runtime_probe": "ok", "evidence_refs": ["ops/evidence/staging/support-contact-external-user.json"]},
    ],
    "ticket_context_probe": {
        "mode": "support_ticket_context_capture_probe",
        "linked_admin_ticket_ids": ["sup-fixture"],
        "captured_context_fields": ["user_id", "project_id", "task_id", "trace_id", "export_id", "quota_transaction_id", "contact_email"],
        "privacy_redaction": "Prompt text and uploaded assets stay redacted.",
    },
    "gate_impact": {
        "can_clear_support_contact_subitem": True,
        "can_clear_check_level_item": True,
        "aggregate_private_beta_gate_status": "blocked_by_other_staging_runtime_items",
    },
}
(out / "legal-pages-external-user.json").write_text(json.dumps(legal, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "support-contact-external-user.json").write_text(json.dumps(support, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_staging_object_retention_evidence.py \
  --evidence "$stage1_staging_child_fixture_dir/object-storage-retention-cleanup.json" \
  --results "$stage1_staging_child_fixture_dir/object-storage-retention-cleanup.ndjson"
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_staging_observability_backup_load_evidence.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_staging_legal_support_evidence.py \
  --legal-evidence "$stage1_staging_child_fixture_dir/legal-pages-external-user.json" \
  --support-evidence "$stage1_staging_child_fixture_dir/support-contact-external-user.json"
set +e
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_staging_object_retention_evidence.py >/dev/null 2>&1
stage1_staging_object_retention_status=$?
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_staging_legal_support_evidence.py >/dev/null 2>&1
stage1_staging_legal_support_status=$?
set -e
if [[ -f ops/evidence/staging/object-storage-retention-cleanup.json && -f ops/evidence/staging/object-storage-retention-cleanup.ndjson ]]; then
  if [[ "$stage1_staging_object_retention_status" -ne 0 ]]; then
    printf 'canonical Stage1 staging object retention validator must pass when exact canonical object retention evidence exists\n' >&2
    exit 1
  fi
elif [[ "$stage1_staging_object_retention_status" -eq 0 ]]; then
  printf 'canonical Stage1 staging object retention validator must not pass unless exact canonical object retention evidence exists\n' >&2
  exit 1
fi
if [[ -f ops/evidence/staging/legal-pages-external-user.json && -f ops/evidence/staging/support-contact-external-user.json ]]; then
  if [[ "$stage1_staging_legal_support_status" -ne 0 ]]; then
    printf 'canonical Stage1 staging legal/support validator must pass when exact support split includes billing policy and ticket context evidence\n' >&2
    exit 1
  fi
elif [[ "$stage1_staging_legal_support_status" -eq 0 ]]; then
  printf 'canonical Stage1 staging legal/support validator must not pass unless exact support split includes billing policy and ticket context evidence\n' >&2
  exit 1
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
if runtime_requirements.get("required_base_url") != "STAGING_API_URL, STAGING_BASE_URL, or explicit probe URL env vars":
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
probe_contract = object_retention_probe.get("probe_contract", {})
if probe_contract.get("contract_id") != "object_storage_retention_cleanup_runtime_probe":
    raise SystemExit("release bundle dry-run must surface object-retention runtime probe contract")
if probe_contract.get("canonical_pass_report") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit("release bundle dry-run must surface canonical object-retention pass report in probe contract")
if probe_contract.get("canonical_pass_results") != "ops/evidence/staging/object-storage-retention-cleanup.ndjson":
    raise SystemExit("release bundle dry-run must surface canonical object-retention pass results in probe contract")
if probe_contract.get("blocked_without_runtime_inputs") is not True:
    raise SystemExit("release bundle dry-run must surface honest blocked object-retention probe contract")
if probe_contract.get("non_canonical_reports_are_validation_only") is not True:
    raise SystemExit("release bundle dry-run must surface non-canonical object-retention report policy")
if set(probe_contract.get("required_checks", [])) != {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}:
    raise SystemExit("release bundle dry-run must surface object-retention probe contract required checks")
if probe_contract.get("probe_routes") != runtime_requirements.get("required_probe_routes"):
    raise SystemExit("release bundle dry-run object-retention probe contract routes must match runtime requirements")
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
stage1_runtime = report.get("stage1_staging_runtime", {})
if stage1_runtime.get("path") != "ops/evidence/staging/stage1-runtime.json":
    raise SystemExit("release bundle must surface Stage 1 aggregate staging runtime path")
split_inputs = report.get("split_probe_decision_inputs", {})
if stage1_runtime.get("status") in {"pass", "passed"} and stage1_runtime.get("release_gate_decision") == "go":
    if report.get("stage1_staging_runtime_verified") is not True:
        raise SystemExit("release bundle must verify Stage 1 staging runtime when canonical aggregate passes")
    if report.get("stage1_quota_replay_verified") is not True:
        raise SystemExit("release bundle must verify Stage 1 quota replay when canonical aggregate passes")
    if report.get("stage1_load_verified") is not True:
        raise SystemExit("release bundle must verify Stage 1 load when canonical aggregate passes")
    if report.get("stage1_staging_runtime_blocking_reasons"):
        raise SystemExit("release bundle must not keep Stage 1 runtime blockers after canonical aggregate passes")
    if report.get("stage1_quota_replay_blocking_reasons"):
        raise SystemExit("release bundle must not keep Stage 1 quota replay blockers after canonical aggregate passes")
    if split_inputs.get("stage1_staging_runtime_verified") is not True:
        raise SystemExit("release bundle decision inputs must surface verified Stage 1 staging runtime")
    if split_inputs.get("stage1_quota_replay_verified") is not True:
        raise SystemExit("release bundle decision inputs must surface verified Stage 1 quota replay")
    if split_inputs.get("stage1_staging_runtime_release_gate_decision") != "go":
        raise SystemExit("release bundle decision inputs must surface Stage 1 staging go")
else:
    if stage1_runtime.get("status") != "blocked" or stage1_runtime.get("release_gate_decision") != "no_go":
        raise SystemExit("release bundle must keep blocked Stage 1 aggregate staging runtime state visible")
    if report.get("stage1_staging_runtime_verified") is not False:
        raise SystemExit("release bundle dry-run must not verify blocked Stage 1 staging runtime")
    stage1_readiness = stage1_runtime.get("runtime_input_readiness", {})
    for key in ("quota_replay_ready", "object_storage_ready", "csrf_ready", "staging_web_ready"):
        if stage1_readiness.get(key) is not False:
            raise SystemExit(f"release bundle must surface Stage 1 staging readiness false for {key}")
    if report.get("stage1_quota_replay_verified") is not False:
        raise SystemExit("release bundle dry-run must not verify blocked Stage 1 quota replay")
    if not any("object_storage_retention_cleanup" in str(item) for item in stage1_runtime.get("blockers", [])):
        raise SystemExit("release bundle must surface Stage 1 object-retention child blocker")
    if not any("staging_quota_replay" in str(item) for item in stage1_runtime.get("blockers", [])):
        raise SystemExit("release bundle must surface Stage 1 quota replay child blocker")
    expected_stage1_blockers = {
        "stage1_staging_runtime_not_passed",
        "stage1_staging_runtime_quota_replay_ready_not_ready",
        "stage1_staging_runtime_object_storage_ready_not_ready",
        "stage1_staging_runtime_csrf_ready_not_ready",
        "stage1_staging_runtime_staging_web_ready_not_ready",
    }
    if not expected_stage1_blockers.issubset(set(report.get("stage1_staging_runtime_blocking_reasons", []))):
        raise SystemExit("release bundle must make blocked Stage 1 staging runtime explicit")
    if not expected_stage1_blockers.issubset(set(report.get("blocking_reasons", []))):
        raise SystemExit("release bundle blocking reasons must include blocked Stage 1 staging runtime")
    if report.get("stage1_quota_replay_blocking_reasons") != ["stage1_quota_replay_not_ready"]:
        raise SystemExit("release bundle must expose Stage 1 quota replay blocking reasons")
    if "stage1_quota_replay_not_ready" not in report.get("blocking_reasons", []):
        raise SystemExit("release bundle blocking reasons must include Stage 1 quota replay not ready")
    if split_inputs.get("stage1_staging_runtime_verified") is not False:
        raise SystemExit("release bundle decision inputs must keep Stage 1 staging runtime unverified")
    if split_inputs.get("stage1_quota_replay_verified") is not False:
        raise SystemExit("release bundle decision inputs must keep Stage 1 quota replay unverified")
    if split_inputs.get("stage1_staging_runtime_release_gate_decision") != "no_go":
        raise SystemExit("release bundle decision inputs must surface Stage 1 staging no_go")
ci_artifacts = {
    item.get("artifact_id"): item
    for item in report.get("ci_closure_artifacts", [])
    if isinstance(item, dict)
}
expected_ci_artifacts = {
    "ci_installed_workflow": ".github/workflows/stage0-rev2-ci.yml",
    "ci_pr_main_run": "ops/evidence/ci/stage0-rev2-pr-main-run.json",
    "ci_playwright_smoke": "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
    "ci_docker_image_build": "ops/evidence/ci/stage0-rev2-docker-image-build.json",
}
if set(ci_artifacts) != set(expected_ci_artifacts):
    raise SystemExit(f"release bundle must surface exact CI closure artifacts: {ci_artifacts}")
for artifact_id, expected_path in expected_ci_artifacts.items():
    artifact = ci_artifacts[artifact_id]
    if artifact.get("path") != expected_path:
        raise SystemExit(f"release bundle CI artifact path mismatch for {artifact_id}: {artifact}")
    if artifact.get("required_before_ci_gate_closure") is not True:
        raise SystemExit(f"release bundle must mark {artifact_id} required before CI gate closure")
expected_ci_blockers = {
    f"ci_closure_artifact_missing:{artifact_id}"
    for artifact_id, artifact in ci_artifacts.items()
    if artifact.get("exists") is not True
}
if set(report.get("ci_closure_artifact_blocking_reasons", [])) != expected_ci_blockers:
    raise SystemExit("release bundle must make missing CI closure artifacts explicit blocking reasons")
if not expected_ci_blockers.issubset(set(report.get("blocking_reasons", []))):
    raise SystemExit("release bundle blocking reasons must include missing CI closure artifacts")
if report.get("ci_closure_artifacts_ready") != (not expected_ci_blockers):
    raise SystemExit("release bundle CI closure artifact readiness must reflect missing CI closure artifacts")
production_split = report.get("production_backup_rollback_split_preflight", {})
if production_split.get("path") != "ops/evidence/production/backup-rollback-split.blocked.json":
    raise SystemExit("release bundle must surface production backup/rollback split preflight path")
if production_split.get("release_gate_check_id") != "production_backup_rollback_incident":
    raise SystemExit("release bundle production split preflight must target production_backup_rollback_incident")
if production_split.get("status") == "blocked_by_upstream_gates":
    if production_split.get("exact_split_files_ready") is not False:
        raise SystemExit("release bundle production split preflight must keep exact split readiness false when upstream gates are blocked")
    if production_split.get("upstream_ci_gate_status") != "no_go":
        raise SystemExit("release bundle production split preflight must surface CI no-go state")
    if production_split.get("upstream_private_beta_staging_gate_status") != "no_go":
        raise SystemExit("release bundle production split preflight must surface private beta/staging no-go state")
elif production_split.get("status") == "exact_split_ready_blocked_by_other_production_runtime_items":
    if production_split.get("exact_split_files_ready") is not True:
        raise SystemExit("release bundle production split preflight must surface exact split readiness once split files pass")
    if production_split.get("upstream_ci_gate_status") != "go":
        raise SystemExit("release bundle production split preflight must surface CI go state")
    if production_split.get("upstream_private_beta_staging_gate_status") != "go":
        raise SystemExit("release bundle production split preflight must surface private beta/staging go state")
else:
    raise SystemExit(f"release bundle production split preflight status mismatch: {production_split.get('status')}")
backup_split = production_split.get("backup_restore_split", {})
rollback_split = production_split.get("rollback_incident_post_deploy_split", {})
if backup_split.get("path") != "ops/evidence/production/backup-restore.json":
    raise SystemExit("release bundle production backup split path mismatch")
if rollback_split.get("path") != "ops/evidence/production/rollback-incident-post-deploy-smoke.json":
    raise SystemExit("release bundle production rollback split path mismatch")
expected_production_split_blockers = set()
if production_split.get("upstream_ci_gate_status") != "go":
    expected_production_split_blockers.add("production_upstream_ci_gate_not_go")
if production_split.get("upstream_private_beta_staging_gate_status") != "go":
    expected_production_split_blockers.add("production_upstream_private_beta_staging_gate_not_go")
if backup_split.get("passed") is not True:
    expected_production_split_blockers.add("production_backup_restore_split_not_passed")
if rollback_split.get("passed") is not True:
    expected_production_split_blockers.add("production_rollback_incident_post_deploy_split_not_passed")
if production_split.get("exact_split_files_ready") is not True:
    expected_production_split_blockers.add("production_exact_backup_rollback_split_files_not_ready")
if set(report.get("production_backup_rollback_split_blocking_reasons", [])) != expected_production_split_blockers:
    raise SystemExit("release bundle must make production split blockers explicit")
if not expected_production_split_blockers.issubset(set(report.get("blocking_reasons", []))):
    raise SystemExit("release bundle blocking reasons must include production split blockers")
PY
route_bundle_tmp="$(mktemp -d)"
if OUT_DIR="$route_bundle_tmp" \
  DRY_RUN=1 \
  RUN_ID=stage0-route-propagation \
  RELEASE_SHA=d3b1107c33dc40b8936f28549e06553fbd7b104a \
  RETENTION_POLICY_URL=https://staging.example.invalid/admin/retention \
  EXPIRED_EXPORT_CLEANUP_URL=https://staging.example.invalid/admin/expired \
  ORPHAN_CLEANUP_URL=https://staging.example.invalid/admin/orphans \
  AUDIT_REFS_URL=https://staging.example.invalid/admin/audit \
  scripts/release_evidence_bundle_smoke.sh >/tmp/stage0-release-bundle-route.out 2>/tmp/stage0-release-bundle-route.err; then
  printf 'release evidence bundle route dry-run unexpectedly returned go\n' >&2
  cat /tmp/stage0-release-bundle-route.out >&2
  cat /tmp/stage0-release-bundle-route.err >&2
  exit 1
fi
python3 - "$route_bundle_tmp" <<'PY'
import json
import sys
from pathlib import Path

out_dir = Path(sys.argv[1])
report = out_dir / "stage0-route-propagation.object-storage-retention-cleanup.json"
if not report.exists():
    raise SystemExit("release bundle route dry-run must write object-retention report")
data = json.loads(report.read_text(encoding="utf-8"))
urls = {
    item["check_id"]: item.get("url")
    for coverage in data.get("coverage", [])
    for item in coverage.get("source_results", [])
}
expected = {
    "retention_policy": "https://staging.example.invalid/admin/retention",
    "expired_export_cleanup": "https://staging.example.invalid/admin/expired",
    "orphan_cleanup": "https://staging.example.invalid/admin/orphans",
    "audit_refs": "https://staging.example.invalid/admin/audit",
}
if urls != expected:
    raise SystemExit(f"release bundle must propagate explicit object-retention probe URLs, got {urls!r}")
if data.get("status") != "blocked":
    raise SystemExit("release bundle route dry-run must keep object-retention report blocked without admin auth")
PY
rm -rf "$route_bundle_tmp"
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
    "CI gate: `go` from `fixtures/stage0/rev2/release_gate_evidence.ci.json`",
    "Private Beta/Staging gate: `go` from `fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json`",
    "Production Launch gate: `no_go` from `fixtures/stage0/rev2/release_gate_evidence.production_launch.json`",
    "Object-storage retention cleanup: staging status `pass` from `ops/evidence/staging/object-storage-retention-cleanup.json`",
    "Stage 1 aggregate staging runtime: `pass` / `go` from `ops/evidence/staging/stage1-runtime.json`",
    "Release evidence bundle: `passed` / `go` from `ops/evidence/release/staging/stage0-rev2-current-release-evidence-bundle.json` with 0 blocking reasons",
    "Production backup/rollback split preflight: `exact_split_ready_blocked_by_other_production_runtime_items`",
    "Production backup/rollback split blockers: production_gate_fixture_has_unrelated_blockers",
    "Production backup exact split: `ops/evidence/production/backup-restore.json` status `pass`",
    "Production rollback/incident/post-deploy exact split: `ops/evidence/production/rollback-incident-post-deploy-smoke.json` status `pass`",
    "Production split upstream gates: CI `go` blocked by none recorded; Private Beta/Staging `go` blocked by none recorded.",
    "## Gate Snapshot",
    "Global Do-Not-Launch Conditions: `open`; non-go gate decisions: fixtures/stage0/rev2/release_gate_evidence.production_launch.json gate_decision.status=no_go",
    "Open production blockers:",
    "Production do-not-launch conditions present:",
    "Release posture: Stage 0 Local Alpha is `go`",
    "## Open Rev2 Runtime Checklist",
    "Release gate runtime open target rows:",
    "These are blueprint checklist labels that remain unchecked, not satisfied release evidence.",
]
missing = [fragment for fragment in required_fragments if fragment not in notes]
if missing:
    raise SystemExit(f"release no-go notes missing required fragments: {missing}")
if private_beta.get("gate_decision", {}).get("status") != "go":
    raise SystemExit("private beta fixture must be go once release no-go notes cite staging pass evidence")
if production.get("gate_decision", {}).get("status") != "no_go":
    raise SystemExit("production fixture must remain no_go in no-go release notes validation")
if not production.get("gate_decision", {}).get("blocked_by_checks"):
    raise SystemExit("production fixture must preserve production launch blockers")
if not production.get("gate_decision", {}).get("active_do_not_launch_conditions"):
    raise SystemExit("production fixture must preserve production do-not-launch conditions")
blocked_retention_path = Path("ops/evidence/staging/object-storage-retention-cleanup.blocked.json")
canonical_retention_path = Path("ops/evidence/staging/object-storage-retention-cleanup.json")
if not blocked_retention_path.exists():
    raise SystemExit("blocked object-storage retention cleanup evidence must exist after the staging probe attempt")
blocked_retention = json.loads(blocked_retention_path.read_text(encoding="utf-8"))
if canonical_retention_path.exists():
    canonical_retention = json.loads(canonical_retention_path.read_text(encoding="utf-8"))
    if canonical_retention.get("status") not in {"pass", "passed"}:
        raise SystemExit("canonical object-storage retention cleanup evidence must be passing when present")
    if canonical_retention.get("release_gate_check_id") != "staging_object_storage_signed_downloads":
        raise SystemExit("canonical object-storage retention cleanup evidence must target staging_object_storage_signed_downloads")
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
probe_contract = blocked_retention.get("probe_contract", {})
if probe_contract.get("contract_id") != "object_storage_retention_cleanup_runtime_probe":
    raise SystemExit("blocked object-storage retention cleanup evidence must expose the runtime probe contract")
if probe_contract.get("release_gate_check_id") != "staging_object_storage_signed_downloads":
    raise SystemExit("blocked object-storage retention cleanup probe contract must target staging_object_storage_signed_downloads")
if probe_contract.get("canonical_pass_report") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit("blocked object-storage retention cleanup probe contract must name canonical pass report")
if probe_contract.get("canonical_pass_results") != "ops/evidence/staging/object-storage-retention-cleanup.ndjson":
    raise SystemExit("blocked object-storage retention cleanup probe contract must name canonical pass results")
if probe_contract.get("blocked_without_runtime_inputs") is not True:
    raise SystemExit("blocked object-storage retention cleanup probe contract must preserve blocked evidence without runtime inputs")
if probe_contract.get("non_canonical_reports_are_validation_only") is not True:
    raise SystemExit("blocked object-storage retention cleanup probe contract must mark non-canonical reports validation-only")
if probe_contract.get("pass_evidence_written_only_after_strict_validator_accepts") is not True:
    raise SystemExit("blocked object-storage retention cleanup probe contract must require strict validator acceptance before pass writes")
if probe_contract.get("canonical_outputs_are_atomic") is not True:
    raise SystemExit("blocked object-storage retention cleanup probe contract must require atomic canonical output replacement")
if probe_contract.get("failed_strict_candidate_writes_blocked_evidence_only") is not True:
    raise SystemExit("blocked object-storage retention cleanup probe contract must keep rejected candidates blocked-only")
if set(probe_contract.get("required_checks", [])) != {
    "retention_policy",
    "expired_export_cleanup",
    "orphan_cleanup",
    "audit_refs",
}:
    raise SystemExit("blocked object-storage retention cleanup probe contract must list all required checks")
if probe_contract.get("probe_routes") != runtime_requirements.get("required_probe_routes"):
    raise SystemExit("blocked object-storage retention cleanup probe contract routes must match runtime requirements")
if not any("audit endpoint contains" in item for item in probe_contract.get("success_criteria", [])):
    raise SystemExit("blocked object-storage retention cleanup probe contract must require cleanup audit endpoint linkage")
if not canonical_retention_path.exists():
    if any("missing_staging_base_url_or_explicit_probe_urls" not in item for item in blocked_retention.get("blocked_checks", [])):
        raise SystemExit("blocked object-storage retention cleanup evidence must explain the missing staging probe URLs")
    if blocked_retention.get("split_evidence", {}).get("canonical_pass_paths") is not False:
        raise SystemExit("blocked object-storage retention cleanup evidence must not claim canonical pass paths")
elif blocked_retention.get("gate_impact", {}).get("can_clear_release_gate_check") is not False:
    raise SystemExit("blocked object-storage retention cleanup diagnostic evidence must not clear the object-storage gate")
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
    "with object retention/cleanup and legal/support external-user evidence attached",
    "Object-storage risks: signed URL and retention/cleanup staging evidence are attached",
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

def assert_gate_snapshot_line_matches(label, path, gate):
    blockers = fixture_blockers(gate)
    dnl = present_do_not_launch(gate)
    decision = gate.get("gate_decision", {})
    expected = (
        f"- {label}: `{decision.get('status', 'missing')}` from `{path}`; "
        f"blocked checks: {', '.join(blockers) if blockers else 'none recorded'}; "
        f"active do-not-launch conditions: {', '.join(dnl) if dnl else 'none recorded'}; "
        f"decision evidence: {decision.get('evidence_ref', 'missing')}"
    )
    if expected not in notes:
        raise SystemExit(f"release no-go notes gate snapshot drifted from fixture decision; expected line: {expected}")

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
local_alpha = json.loads(Path("fixtures/stage0/rev2/release_gate_evidence.local_alpha.json").read_text(encoding="utf-8"))
ci = json.loads(Path("fixtures/stage0/rev2/release_gate_evidence.ci.json").read_text(encoding="utf-8"))
assert_gate_snapshot_line_matches(
    "Local Alpha gate",
    "fixtures/stage0/rev2/release_gate_evidence.local_alpha.json",
    local_alpha,
)
assert_gate_snapshot_line_matches(
    "CI gate",
    "fixtures/stage0/rev2/release_gate_evidence.ci.json",
    ci,
)
assert_gate_snapshot_line_matches(
    "Private Beta/Staging gate",
    "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    private_beta,
)
assert_gate_snapshot_line_matches(
    "Production Launch gate",
    "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
    production,
)
production_decision_ref = production.get("gate_decision", {}).get("evidence_ref", "")
for upstream_token in (
    f"present upstream CI fixture fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status={ci.get('gate_decision', {}).get('status', 'missing')}",
    f"present upstream Private Beta/Staging fixture fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json gate_decision.status={private_beta.get('gate_decision', {}).get('status', 'missing')}",
):
    if upstream_token.endswith("status=go"):
        continue
    if upstream_token not in production_decision_ref:
        raise SystemExit(f"production gate decision must preserve upstream fixture no-go token: {upstream_token}")
    if upstream_token not in notes:
        raise SystemExit(f"release no-go notes must preserve upstream fixture no-go token: {upstream_token}")

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
if template.count("- Production split preflight:") != 1:
    raise SystemExit("release notes template must contain exactly one production split preflight slot")
if template.count("## Gate Snapshot") != 1:
    raise SystemExit("release notes template must contain exactly one Gate Snapshot section")
for gate_name in (
    "Local Alpha gate:",
    "CI gate:",
    "Private Beta/Staging gate:",
    "Production Launch gate:",
):
    if gate_name not in template:
        raise SystemExit(f"release notes template missing gate snapshot slot: {gate_name}")
for token in (
    "release_gate_check_id=staging_object_storage_signed_downloads",
    "release_gate_check_id=staging_legal_external_user_pages",
    "scripts/production_backup_rollback_split_smoke.sh",
    "Admin-visible probe evidence alone must not close production backup/rollback rows",
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
if report["status"] not in {"blocked_by_upstream_gates", "exact_split_ready_blocked_by_other_production_runtime_items"}:
    raise SystemExit(f"production backup/rollback split smoke blocked status mismatch: {report['status']}")
if report["release_gate_check_id"] != "production_backup_rollback_incident":
    raise SystemExit("production backup/rollback split smoke must target production_backup_rollback_incident")
dnl = set(report["do_not_launch_condition_ids"])
preserved_dnl = set(report["gate_impact"].get("preserved_do_not_launch_condition_ids", []))
if dnl != preserved_dnl:
    raise SystemExit("production backup/rollback split smoke must preserve reported do-not-launch blockers")
if report["status"] == "blocked_by_upstream_gates":
    expected_dnl = {
        "backup_restore_rollback_smoke_missing",
        "production_deploy_rollback_smoke_missing",
    }
    if not (
        report["upstream_gates"]["ci"].get("ready") is True
        and report["upstream_gates"]["private_beta_staging"].get("ready") is True
    ):
        expected_dnl.add("ci_staging_gates_not_passed")
    if dnl != expected_dnl:
        raise SystemExit(f"production backup/rollback split smoke must preserve current split/upstream blockers: {sorted(dnl)}")
    if report["gate_impact"]["can_clear_release_gate_check"] is not False:
        raise SystemExit("production backup/rollback split smoke must not clear the release gate while split evidence is blocked")
    if report["gate_impact"]["preserved_release_gate_check_id"] != "production_backup_rollback_incident":
        raise SystemExit("production backup/rollback split smoke must preserve the production backup release gate while split evidence is blocked")
else:
    expected_dnl = {
        "paid_billing_or_comp_only_mode_missing",
        "skill_release_eval_canary_missing",
        "activation_eval_review_audit_runtime_missing",
        "admin_high_risk_review_runtime_missing",
        "abuse_throttle_hold_missing",
        "security_privacy_legal_incomplete",
        "secret_exposure_runtime_not_verified",
        "public_legal_support_policy_not_deployed",
    }
    if dnl != expected_dnl:
        raise SystemExit(f"production backup/rollback split smoke must preserve unrelated production blockers once split evidence is exact: {sorted(dnl)}")
    if report["gate_impact"]["can_clear_release_gate_check"] is not True:
        raise SystemExit("production backup/rollback split smoke must clear the backup release gate once exact split evidence is ready")
    if report["gate_impact"]["preserved_release_gate_check_id"] is not None:
        raise SystemExit("production backup/rollback split smoke must not preserve the production backup release gate once exact split evidence is ready")
if report["upstream_gates"]["ci"]["gate_decision_status"] not in {"go", "no_go"}:
    raise SystemExit("production split smoke must surface CI gate state")
if report["upstream_gates"]["private_beta_staging"]["gate_decision_status"] not in {"go", "no_go"}:
    raise SystemExit("production split smoke must surface private beta/staging gate state")
if report["admin_visible_probe"]["ready"] is not True:
    raise SystemExit("production split smoke must detect the admin-visible blocked probe evidence")
admin_semantics = report["admin_visible_probe"].get("semantic_validation", {})
if admin_semantics.get("ready") is not True:
    raise SystemExit("production split smoke must semantically validate admin-visible blocked probe evidence")
if set(admin_semantics.get("required_coverage_areas", [])) != {
    "backup_restore",
    "rollback_drill",
    "incident_alert_path",
    "post_deploy_smoke",
}:
    raise SystemExit("production split smoke must require all admin-visible coverage areas")
if admin_semantics.get("gate_blocker_preservation") is not True:
    raise SystemExit("production split smoke must require admin-visible gate blocker preservation")
if admin_semantics.get("split_readiness_blocked") is not True:
    raise SystemExit("production split smoke must require admin-visible exact split blockers")
if admin_semantics.get("gate_impact_preserves_upstream") is not True:
    raise SystemExit("production split smoke must require admin-visible upstream gate preservation")
split = report["split_evidence"]
if split["all_exact_split_files_ready"] != (report["status"] == "exact_split_ready_blocked_by_other_production_runtime_items"):
    raise SystemExit("production split smoke exact split readiness must match split status")
if split["backup_restore"]["path"] != "ops/evidence/production/backup-restore.json":
    raise SystemExit("production backup split path mismatch")
if split["rollback_incident_post_deploy_smoke"]["path"] != "ops/evidence/production/rollback-incident-post-deploy-smoke.json":
    raise SystemExit("production rollback split path mismatch")
if report["status"] == "blocked_by_upstream_gates":
    if "production_backup_restore_split_not_passed" not in report["blocked_checks"]:
        raise SystemExit("production split smoke must block on missing backup/restore split")
    if "production_rollback_incident_post_deploy_split_not_passed" not in report["blocked_checks"]:
        raise SystemExit("production split smoke must block on missing rollback/incident/post-deploy split")
else:
    if set(report["blocked_checks"]) != {"production_gate_fixture_has_unrelated_blockers"}:
        raise SystemExit(f"production split smoke must only preserve unrelated production blockers once split evidence is exact: {report['blocked_checks']}")
requirements = report["runtime_input_requirements"]["required_split_evidence"]
if "Postgres restore" not in requirements["backup_restore"]["must_prove"]:
    raise SystemExit("production backup split requirements must include Postgres restore")
if "post-deploy smoke" not in requirements["rollback_incident_post_deploy_smoke"]["must_prove"]:
    raise SystemExit("production rollback split requirements must include post-deploy smoke")
if "backend image runtime-worker rollback" not in requirements["rollback_incident_post_deploy_smoke"]["must_prove"]:
    raise SystemExit("production rollback split requirements must include backend image runtime-worker rollback")
if "runtime-worker backend target" not in requirements["rollback_incident_post_deploy_smoke"]["must_prove"]:
    raise SystemExit("production rollback split requirements must include runtime-worker backend target")
PY
python3 scripts/validate_stage1_production_backup_rollback_evidence.py \
  --allow-preflight \
  --preflight "$production_backup_tmp/backup-rollback-split.blocked.json"
split_guard_tmp="$(mktemp -d)"
cat >"$split_guard_tmp/backup-restore.json" <<'JSON'
{
  "environment": "production",
  "release_gate_check_id": "production_backup_rollback_incident",
  "release_sha": "0123456789abcdef0123456789abcdef01234567",
  "status": "pass",
  "coverage": [
    {
      "status": "pass",
      "proof": "backup schedule backup_schedule Postgres restore postgres_restore object restore object_restore RPO rpo RTO rto audit refs"
    }
  ]
}
JSON
cat >"$split_guard_tmp/rollback-incident-post-deploy-smoke.json" <<'JSON'
{
  "environment": "production",
  "release_gate_check_id": "production_backup_rollback_incident",
  "release_sha": "0123456789abcdef0123456789abcdef01234567",
  "status": "pass",
    "coverage": [
    {
      "status": "pass",
      "proof": "rollback app_rollback feature_flag worker_drain migration compatibility migration_compatibility incident post-deploy smoke post_deploy_smoke fixtures/stage0/rev2/release_gate_evidence.ci.json fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json"
    }
  ],
  "gate_impact": {
    "remaining_blockers": [
      "ci_staging_gates_not_passed"
    ],
    "can_clear_release_gate_check": false
  }
}
JSON
if RELEASE_SHA=0123456789abcdef0123456789abcdef01234567 \
  BACKUP_RESTORE_EVIDENCE="$split_guard_tmp/backup-restore.json" \
  ROLLBACK_INCIDENT_SMOKE_EVIDENCE="$split_guard_tmp/rollback-incident-post-deploy-smoke.json" \
  REPORT_PATH="$split_guard_tmp/backup-rollback-split.blocked.json" \
  RUN_ID=repo-validate-production-preserved-blocker-guard \
  scripts/production_backup_rollback_split_smoke.sh >/tmp/stage0-production-preserved-blocker.out 2>/tmp/stage0-production-preserved-blocker.err; then
  printf 'production backup/rollback split smoke accepted preserved-blocker split evidence\n' >&2
  cat /tmp/stage0-production-preserved-blocker.out >&2
  cat /tmp/stage0-production-preserved-blocker.err >&2
  exit 1
fi
python3 - "$split_guard_tmp/backup-rollback-split.blocked.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
missing = report["split_evidence"]["rollback_incident_post_deploy_smoke"]["missing_requirements"]
if not any(item.startswith("no_preserved_blockers:") for item in missing):
    raise SystemExit("production split smoke must reject preserved blocker markers in rollback split evidence")
if "token:runtime-worker" not in missing:
    raise SystemExit("production split smoke must require runtime-worker rollback evidence")
if "runtime_proof:backend_runtime_worker_rollback" not in missing:
    raise SystemExit("production split smoke must require backend_runtime_worker_rollback runtime proof")
if "production_rollback_incident_post_deploy_split_not_passed" not in report["blocked_checks"]:
    raise SystemExit("production split smoke must keep rollback split blocked after preserved blocker rejection")
PY

admin_probe_guard_tmp="$(mktemp -d)"
cat >"$admin_probe_guard_tmp/admin-probe.json" <<'JSON'
{
  "environment": "production",
  "status": "blocked_by_upstream_gates",
  "release_gate_check_id": "production_backup_rollback_incident",
  "coverage": [
    {"area": "backup_restore", "status": "pass"},
    {"area": "rollback_drill", "status": "pass"},
    {"area": "incident_alert_path", "status": "pass"},
    {"area": "post_deploy_smoke", "status": "pass"}
  ],
  "split_readiness": [
    {
      "split": "backup_restore",
      "exact_evidence_path": "ops/evidence/production/backup-restore.json",
      "status": "blocked_until_exact_split_file",
      "required_runtime_proof": ["backup_schedule"]
    },
    {
      "split": "rollback_incident_post_deploy_smoke",
      "exact_evidence_path": "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
      "status": "blocked_until_exact_split_file",
      "required_runtime_proof": ["post_deploy_smoke"]
    }
  ],
  "gate_impact": {
    "can_clear_check_level_items": true,
    "remaining_blockers": []
  }
}
JSON
if ADMIN_VISIBLE_PROBE_EVIDENCE="$admin_probe_guard_tmp/admin-probe.json" \
  REPORT_PATH="$admin_probe_guard_tmp/backup-rollback-split.blocked.json" \
  RUN_ID=repo-validate-production-admin-probe-guard \
  scripts/production_backup_rollback_split_smoke.sh >/tmp/stage0-production-admin-probe-guard.out 2>/tmp/stage0-production-admin-probe-guard.err; then
  printf 'production backup/rollback split smoke accepted admin probe without blocker preservation\n' >&2
  cat /tmp/stage0-production-admin-probe-guard.out >&2
  cat /tmp/stage0-production-admin-probe-guard.err >&2
  exit 1
fi
python3 - "$admin_probe_guard_tmp/backup-rollback-split.blocked.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
admin_probe = report["admin_visible_probe"]
if admin_probe.get("ready") is not False:
    raise SystemExit("production split smoke must reject admin probes that do not preserve blockers")
missing = admin_probe["semantic_validation"].get("missing_requirements", [])
if "coverage:gate_blocker_preservation:blocked" not in missing:
    raise SystemExit("production split smoke must require blocked gate preservation coverage")
if "gate_impact:preserves_ci_staging_gates_not_passed" not in missing:
    raise SystemExit("production split smoke must require admin probe gate impact to preserve upstream blockers")
if not any(item.startswith("admin_visible_probe_not_ready:") for item in report["blocked_checks"]):
    raise SystemExit("production split smoke must keep admin probe readiness as a blocker")
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

log "node dependency audit gate"
run_node_audit_gate web
run_node_audit_gate admin
if [[ "${ZENARI_VALIDATE_LEGACY_MANAGER:-0}" == "1" ]]; then
  run_node_audit_gate manager
else
  printf 'skip: manager legacy local shell audit; set ZENARI_VALIDATE_LEGACY_MANAGER=1 to include it\n'
fi

log "web/admin release surface validation"
run_node_project_checks web
if [[ -d web ]] && (cd web && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['smoke:stage1-canvas-playwright'] ? 0 : 1)"); then
  (cd web && npm run smoke:stage1-canvas-playwright)
fi
if [[ -d web ]] && (cd web && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['smoke:stage1-batch-generation-playwright'] ? 0 : 1)"); then
  (cd web && npm run smoke:stage1-batch-generation-playwright)
fi
if [[ -d web ]] && (cd web && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['smoke:stage1-prompt-result-playwright'] ? 0 : 1)"); then
  (cd web && npm run smoke:stage1-prompt-result-playwright)
fi
if [[ -d web ]] && (cd web && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['smoke:stage1-billing-playwright'] ? 0 : 1)"); then
  (cd web && npm run smoke:stage1-billing-playwright)
fi
if [[ -d web ]] && (cd web && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['smoke:stage1-safety-export-playwright'] ? 0 : 1)"); then
  (cd web && npm run smoke:stage1-safety-export-playwright)
fi
if [[ -d web ]] && (cd web && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['smoke:stage1-asset-brandkit-playwright'] ? 0 : 1)"); then
  (cd web && npm run smoke:stage1-asset-brandkit-playwright)
fi
run_node_project_checks admin
if [[ -d admin ]] && (cd admin && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['smoke:stage1-admin-core-ops-playwright'] ? 0 : 1)"); then
  admin_playwright_port="${ADMIN_PLAYWRIGHT_PORT:-26181}"
  admin_playwright_base_url="http://127.0.0.1:${admin_playwright_port}"
  (cd admin && ./node_modules/.bin/next dev --hostname 127.0.0.1 --port "$admin_playwright_port") &
  admin_playwright_server_pid="$!"
  if ! wait_for_http "$admin_playwright_base_url" 90; then
    stop_temp_servers "$admin_playwright_server_pid"
    printf 'failed to start admin Playwright validation server on %s\n' "$admin_playwright_base_url" >&2
    exit 1
  fi
  set +e
  (
    cd admin &&
      ADMIN_PLAYWRIGHT_PORT="$admin_playwright_port" \
      ADMIN_PLAYWRIGHT_BASE_URL="$admin_playwright_base_url" \
      npm run smoke:stage1-admin-core-ops-playwright
  )
  admin_playwright_exit_code=$?
  set -e
  stop_temp_servers "$admin_playwright_server_pid"
  if [[ "$admin_playwright_exit_code" -ne 0 ]]; then
    exit "$admin_playwright_exit_code"
  fi
fi
if [[ "${ZENARI_VALIDATE_LEGACY_MANAGER:-0}" == "1" ]]; then
  run_node_project_checks manager
else
  printf 'skip: manager legacy local shell checks; set ZENARI_VALIDATE_LEGACY_MANAGER=1 to include it\n'
fi

log "load smoke script syntax"
bash -n scripts/load_smoke.sh
load_validate_dir="$(mktemp -d)"
for mode in chat_task worker_generation zip_export signed_download crawler_throttle quota_contention workspace_rendering; do
  LOAD_MODE="$mode" DRY_RUN=1 OUT_DIR="$load_validate_dir" scripts/load_smoke.sh >/dev/null
done
stage1_load_preflight_blocked_dir="$(mktemp -d)"
set +e
LOAD_MODE=preflight_stage1 \
  OUT_DIR="$stage1_load_preflight_blocked_dir" \
  BASE_URL="http://127.0.0.1:31080" \
  WEB_URL="http://127.0.0.1:26080" \
  ADMIN_URL="http://127.0.0.1:26081" \
  RELEASE_SHA="" \
  scripts/load_smoke.sh >/dev/null 2>&1
stage1_load_preflight_blocked_status=$?
set -e
if [[ "$stage1_load_preflight_blocked_status" -ne 2 ]]; then
  printf 'Stage1 load preflight must block default local-devport inputs, got %s\n' "$stage1_load_preflight_blocked_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_load_evidence.py \
  --allow-preflight \
  --evidence "$stage1_load_preflight_blocked_dir/stage1-load.preflight.json"
stage1_load_preflight_ready_dir="$(mktemp -d)"
LOAD_MODE=preflight_stage1 \
  OUT_DIR="$stage1_load_preflight_ready_dir" \
  BASE_URL="https://staging-api.zenari.dev" \
  WEB_URL="https://staging-web.zenari.dev" \
  ADMIN_URL="https://staging-admin.zenari.dev" \
  RELEASE_SHA="0123456789abcdef0123456789abcdef01234567" \
  REQUESTS=24 \
  CONCURRENCY=4 \
  WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE=1 \
  scripts/load_smoke.sh >/dev/null
python3 scripts/validate_stage1_load_evidence.py \
  --allow-preflight \
  --evidence "$stage1_load_preflight_ready_dir/stage1-load.preflight.json"
set +e
python3 scripts/validate_stage1_load_evidence.py \
  --evidence "$stage1_load_preflight_ready_dir/stage1-load.preflight.json" \
  --results "$stage1_load_preflight_ready_dir/stage1-load.preflight.json" >/dev/null 2>&1
stage1_load_preflight_strict_status=$?
set -e
if [[ "$stage1_load_preflight_strict_status" -eq 0 ]]; then
  printf 'Stage1 load preflight evidence must not pass strict canonical validation\n' >&2
  exit 1
fi
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
stage1_load_fixture_dir="$(mktemp -d)"
python3 - "$stage1_load_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
modes = [
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
]
evidence_path = root / "stage1-load.json"
results_path = root / "stage1-load.ndjson"
rows = []
for mode in modes:
    rows.append({
        "mode": mode,
        "status": "passed",
        "metrics": {
            "request_count": 24,
            "error_rate": 0,
            "p95_ms": 900,
            "queue_delay_p95_ms": 1200,
            "provider_fallback_rate": 0,
            "export_success_rate": 1,
            "billing_webhook_failure_rate": 0,
        },
        "request_id_ref": f"req-{mode}",
        "trace_ref": f"tr-{mode}",
        "audit_ref": "au-load",
        "evidence_refs": ["scripts/load_smoke.sh"],
    })
summary = {
    "request_count": sum(row["metrics"]["request_count"] for row in rows),
    "error_rate": 0,
    "p95_ms": 900,
    "queue_delay_p95_ms": 1200,
    "provider_fallback_rate": 0,
    "export_success_rate": 1,
    "billing_webhook_failure_rate": 0,
}
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
    "release_sha": "0123456789abcdef0123456789abcdef01234567",
    "requests_per_mode": 24,
    "concurrency": 4,
    "target_urls": {
        "api": "https://staging-api.zenari.dev",
        "web": "https://staging-web.zenari.dev",
        "admin": "https://staging-admin.zenari.dev",
    },
    "input_readiness": {
        "api_url_ready": True,
        "web_url_ready": True,
        "admin_url_ready": True,
        "release_sha_provided": True,
        "release_sha_full_length": True,
        "canonical_pass_path": True,
        "production_like_staging_targets": True,
    },
    "summary": summary,
    "checks": [
        {
            "check_id": row["mode"],
            "status": row["status"],
            "metrics": row["metrics"],
            "evidence_refs": row["evidence_refs"],
        }
        for row in rows
    ],
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
evidence_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
results_path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
PY
python3 scripts/validate_stage1_load_evidence.py \
  --evidence "$stage1_load_fixture_dir/stage1-load.json" \
  --results "$stage1_load_fixture_dir/stage1-load.ndjson"
python3 - "$stage1_load_fixture_dir/stage1-load.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
report = json.loads(path.read_text(encoding="utf-8"))
report["target_urls"] = {
    "api": "http://127.0.0.1:31080",
    "web": "http://127.0.0.1:26080",
    "admin": "http://127.0.0.1:26081",
}
path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
set +e
python3 scripts/validate_stage1_load_evidence.py \
  --evidence "$stage1_load_fixture_dir/stage1-load.json" \
  --results "$stage1_load_fixture_dir/stage1-load.ndjson" >/dev/null 2>&1
stage1_load_local_url_status=$?
set -e
if [[ "$stage1_load_local_url_status" -eq 0 ]]; then
  printf 'canonical Stage1 load validator must reject localhost/private strict pass target URLs\n' >&2
  exit 1
fi
stage1_load_canonical_before="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/stage1-load.json"),
    Path("ops/evidence/staging/stage1-load.ndjson"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(str(path.exists()).encode("utf-8"))
    if path.exists():
        digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
stage1_load_canonical_write_dir="$(mktemp -d)"
cat >"$stage1_load_canonical_write_dir/server.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
import ssl
import os


class Handler(BaseHTTPRequestHandler):
    def _write(self, status):
        self.send_response(status)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def do_GET(self):
        if self.path in {"/", "/healthz", "/readyz"}:
            self._write(200)
        elif self.path == "/api/v1/tasks/load-smoke":
            self._write(401)
        elif self.path == "/api/v1/agent-tasks/load-smoke":
            self._write(404)
        elif self.path == "/api/v1/exports/load-smoke.zip":
            self._write(404)
        elif self.path == "/api/v1/assets/load-smoke/download":
            self._write(404)
        elif self.path == "/api/admin/v1/crawler/sources":
            self._write(401)
        elif self.path == "/api/v1/quota":
            self._write(401)
        else:
            self._write(404)

    def log_message(self, _fmt, *_args):
        pass


server = HTTPServer(("127.0.0.1", 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(os.environ["STAGE1_LOAD_FIXTURE_CERT"], os.environ["STAGE1_LOAD_FIXTURE_KEY"])
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_port, flush=True)
server.serve_forever()
PY
stage1_load_canonical_host="localhost"
stage1_load_canonical_cert="$stage1_load_canonical_write_dir/$stage1_load_canonical_host.crt"
stage1_load_canonical_key="$stage1_load_canonical_write_dir/$stage1_load_canonical_host.key"
openssl req -x509 -newkey rsa:2048 -sha256 -days 1 -nodes \
  -subj "/CN=$stage1_load_canonical_host" \
  -addext "subjectAltName=DNS:$stage1_load_canonical_host" \
  -keyout "$stage1_load_canonical_key" \
  -out "$stage1_load_canonical_cert" >/dev/null 2>&1
STAGE1_LOAD_FIXTURE_CERT="$stage1_load_canonical_cert" \
  STAGE1_LOAD_FIXTURE_KEY="$stage1_load_canonical_key" \
  python3 "$stage1_load_canonical_write_dir/server.py" >"$stage1_load_canonical_write_dir/port" 2>"$stage1_load_canonical_write_dir/server.log" &
stage1_load_canonical_server_pid=$!
for _ in {1..50}; do
  if [[ -s "$stage1_load_canonical_write_dir/port" ]]; then
    break
  fi
  sleep 0.1
done
if [[ ! -s "$stage1_load_canonical_write_dir/port" ]]; then
  stop_temp_servers "$stage1_load_canonical_server_pid"
  printf 'failed to start Stage1 load canonical-write fixture server\n' >&2
  cat "$stage1_load_canonical_write_dir/server.log" >&2 || true
  exit 1
fi
stage1_load_canonical_port="$(cat "$stage1_load_canonical_write_dir/port")"
set +e
RUN_ID="stage1-load-reserved-canonical-write" \
  LOAD_MODE=all \
  WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE=1 \
  OUT_DIR="$stage1_load_canonical_write_dir/out" \
  BASE_URL="https://$stage1_load_canonical_host:$stage1_load_canonical_port" \
  WEB_URL="https://$stage1_load_canonical_host:$stage1_load_canonical_port" \
  ADMIN_URL="https://$stage1_load_canonical_host:$stage1_load_canonical_port" \
  REQUESTS=20 \
  CONCURRENCY=4 \
  TIMEOUT_SECONDS=2 \
  RELEASE_SHA="0123456789abcdef0123456789abcdef01234567" \
  CURL_CA_BUNDLE="$stage1_load_canonical_cert" \
  NO_PROXY="$stage1_load_canonical_host,127.0.0.1,localhost" \
  no_proxy="$stage1_load_canonical_host,127.0.0.1,localhost" \
  scripts/load_smoke.sh >/dev/null 2>&1
stage1_load_reserved_canonical_status=$?
set -e
stop_temp_servers "$stage1_load_canonical_server_pid"
if [[ "$stage1_load_reserved_canonical_status" -ne 2 ]]; then
  printf 'reserved target Stage1 load canonical write must be rejected after strict validation, got %s\n' "$stage1_load_reserved_canonical_status" >&2
  exit 1
fi
stage1_load_canonical_after="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/stage1-load.json"),
    Path("ops/evidence/staging/stage1-load.ndjson"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(str(path.exists()).encode("utf-8"))
    if path.exists():
        digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
if [[ "$stage1_load_canonical_before" != "$stage1_load_canonical_after" ]]; then
  printf 'reserved target Stage1 load canonical write must not mutate canonical pass evidence\n' >&2
  exit 1
fi
if [[ -f "$stage1_load_canonical_write_dir/out/stage1-load.json" || -f "$stage1_load_canonical_write_dir/out/stage1-load.ndjson" ]]; then
  printf 'reserved target Stage1 load canonical write must not create temp canonical pass outputs\n' >&2
  exit 1
fi
python3 - "$stage1_load_canonical_write_dir/out/stage1-load-reserved-canonical-write.candidate.json" "$stage1_load_canonical_write_dir/out/stage1-load-reserved-canonical-write.candidate.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
if not report_path.exists() or not results_path.exists():
    raise SystemExit("reserved target canonical write must leave candidate diagnostics")
report = json.loads(report_path.read_text(encoding="utf-8"))
rows = [json.loads(line) for line in results_path.read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") == "pass":
    raise SystemExit("reserved target canonical write candidate must not claim pass")
if not any(str(item).startswith("target_not_production_like:") for item in report.get("blocked_checks", [])):
    raise SystemExit(f"reserved target candidate must record strict target blockers: {report.get('blocked_checks')}")
if len(rows) != 7:
    raise SystemExit(f"reserved target candidate must include all mode rows, got {len(rows)}")
PY
set +e
python3 scripts/validate_stage1_load_evidence.py >/dev/null 2>&1
stage1_load_strict_status=$?
set -e
if [[ "$stage1_load_strict_status" -ne 0 ]]; then
  printf 'canonical Stage1 load validator must pass when ops/evidence/staging/stage1-load.json exists and is strict-pass\n' >&2
  exit 1
fi
set +e
python3 scripts/validate_stage1_load_evidence.py \
  --evidence "$stage1_load_canonical_write_dir/missing-stage1-load.json" \
  --results "$stage1_load_canonical_write_dir/missing-stage1-load.ndjson" >/dev/null 2>&1
stage1_load_missing_strict_status=$?
set -e
if [[ "$stage1_load_missing_strict_status" -eq 0 ]]; then
  printf 'Stage1 load validator must not pass when explicit strict evidence paths are missing\n' >&2
  exit 1
fi
stage1_load_local_fixture_dir="$(mktemp -d)"
python3 - "$stage1_load_local_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
modes = [
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
]
evidence_path = root / "stage1-load.local-devport.json"
results_path = root / "stage1-load.local-devport.ndjson"
rows = []
for mode in modes:
    rows.append({
        "mode": mode,
        "status": "passed",
        "metrics": {
            "request_count": 20,
            "error_rate": 0,
            "p95_ms": 100,
            "queue_delay_p95_ms": 0,
            "provider_fallback_rate": 0,
            "export_success_rate": 1,
            "billing_webhook_failure_rate": 0,
        },
        "request_id_ref": f"local-req-{mode}",
        "trace_ref": f"local-trace-{mode}",
        "audit_ref": f"local-audit-{mode}",
        "evidence_refs": ["scripts/load_smoke.sh"],
    })
summary = {
    "request_count": 140,
    "error_rate": 0,
    "p95_ms": 100,
    "queue_delay_p95_ms": 0,
    "provider_fallback_rate": 0,
    "export_success_rate": 1,
    "billing_webhook_failure_rate": 0,
}
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
    "requests_per_mode": 20,
    "concurrency": 4,
    "blocked_checks": ["local_devport_debug_evidence_cannot_clear_staging_gate"],
    "summary": summary,
    "gate_impact": {
        "release_gate_check_id": "staging_observability_backup_load",
        "can_clear_load_slot": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "preserved_release_gate_check_id": "staging_observability_backup_load",
        "preserved_do_not_launch_condition_id": "stage1_load_runtime_missing",
        "remaining_blockers": ["local_devport_debug_evidence_cannot_clear_staging_gate"],
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
evidence_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
results_path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
PY
python3 scripts/validate_stage1_load_evidence.py \
  --allow-local-devport \
  --evidence "$stage1_load_local_fixture_dir/stage1-load.local-devport.json" \
  --results "$stage1_load_local_fixture_dir/stage1-load.local-devport.ndjson"
set +e
python3 scripts/validate_stage1_load_evidence.py \
  --evidence "$stage1_load_local_fixture_dir/stage1-load.local-devport.json" \
  --results "$stage1_load_local_fixture_dir/stage1-load.local-devport.ndjson" >/dev/null 2>&1
stage1_load_local_strict_status=$?
set -e
if [[ "$stage1_load_local_strict_status" -eq 0 ]]; then
  printf 'local-devport Stage1 load evidence must not pass strict canonical validation\n' >&2
  exit 1
fi
stage1_load_blocked_fixture_dir="$(mktemp -d)"
set +e
LOAD_MODE=blocked_stage1 \
  OUT_DIR="$stage1_load_blocked_fixture_dir" \
  RELEASE_SHA="0123456789abcdef0123456789abcdef01234567" \
  scripts/load_smoke.sh >/dev/null 2>&1
stage1_load_blocked_generate_status=$?
set -e
if [[ "$stage1_load_blocked_generate_status" -ne 2 ]]; then
  printf 'blocked Stage1 load diagnostic generation must exit 2, got %s\n' "$stage1_load_blocked_generate_status" >&2
  exit 1
fi
python3 scripts/validate_stage1_load_evidence.py \
  --allow-blocked-diagnostic \
  --evidence "$stage1_load_blocked_fixture_dir/stage1-load.blocked.json" \
  --results "$stage1_load_blocked_fixture_dir/stage1-load.blocked.ndjson"
set +e
python3 scripts/validate_stage1_load_evidence.py \
  --evidence "$stage1_load_blocked_fixture_dir/stage1-load.blocked.json" \
  --results "$stage1_load_blocked_fixture_dir/stage1-load.blocked.ndjson" >/dev/null 2>&1
stage1_load_blocked_strict_status=$?
set -e
if [[ "$stage1_load_blocked_strict_status" -eq 0 ]]; then
  printf 'blocked Stage1 load diagnostic evidence must not pass strict canonical validation\n' >&2
  exit 1
fi
python3 - "$stage1_load_blocked_fixture_dir/stage1-load.blocked.json" "$stage1_load_blocked_fixture_dir/stage1-load.blocked.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("blocked load diagnostic must stay blocked")
if report.get("local_devport_debug") is not False or report.get("allow_local_devport_evidence") is not False:
    raise SystemExit("blocked load diagnostic must not be local-devport evidence")
if report.get("canonical_pass_path") is not False:
    raise SystemExit("blocked load diagnostic must not claim canonical pass path")
if report.get("blocked_checks") != ["missing_production_like_staging_load_runtime"]:
    raise SystemExit(f"blocked load diagnostic must explain missing staging load runtime: {report.get('blocked_checks')}")
gate = report.get("gate_impact", {})
if gate.get("can_clear_load_slot") is not False or gate.get("can_clear_stage1_staging_runtime_gate") is not False:
    raise SystemExit(f"blocked load diagnostic cannot clear staging gates: {gate}")
if not rows or any(row.get("status") != "blocked" for row in rows):
    raise SystemExit(f"blocked load diagnostic rows must all stay blocked: {rows}")
probe_contract = report.get("probe_contract", {})
if probe_contract.get("blocked_diagnostic_report") != "ops/evidence/staging/stage1-load.blocked.json":
    raise SystemExit(f"blocked load diagnostic probe contract must name blocked report path: {probe_contract}")
if probe_contract.get("blocked_diagnostic_results") != "ops/evidence/staging/stage1-load.blocked.ndjson":
    raise SystemExit(f"blocked load diagnostic probe contract must name blocked results path: {probe_contract}")
if probe_contract.get("blocked_diagnostic_can_clear_staging_gate") is not False:
    raise SystemExit("blocked load diagnostic probe contract must state it cannot clear staging gates")
PY
stage1_load_runtime_fixture_dir="$(mktemp -d)"
python3 - "$stage1_load_runtime_fixture_dir" "$stage1_load_blocked_fixture_dir/stage1-load.blocked.json" "$stage1_load_blocked_fixture_dir/stage1-load.blocked.ndjson" <<'PY'
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
blocked_json = Path(sys.argv[2])
blocked_ndjson = Path(sys.argv[3])
contract = {
    "required_components": [
        {
            "component_id": "load",
            "category": "ops",
            "required_evidence_ref": "ops/evidence/staging/stage1-load.json",
            "required_results_ref": "ops/evidence/staging/stage1-load.ndjson",
            "blocked_evidence_ref": "blocked/stage1-load.blocked.json",
            "blocked_results_ref": "blocked/stage1-load.blocked.ndjson",
            "required_validator": "scripts/validate_stage1_load_evidence.py",
            "required_proofs": ["chat task load", "worker generation load"],
        }
    ]
}
(root / "blocked").mkdir(parents=True, exist_ok=True)
(root / "blocked" / "stage1-load.blocked.json").write_text(blocked_json.read_text(encoding="utf-8"), encoding="utf-8")
(root / "blocked" / "stage1-load.blocked.ndjson").write_text(blocked_ndjson.read_text(encoding="utf-8"), encoding="utf-8")
(root / "contract.json").write_text(json.dumps(contract, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
python3 - "$stage1_load_runtime_fixture_dir/contract.json" "$stage1_load_runtime_fixture_dir" <<'PY'
import importlib.util
import sys
from pathlib import Path

root = Path.cwd()
fixture_root = Path(sys.argv[2])
spec = importlib.util.spec_from_file_location(
    "generate_stage1_staging_runtime_evidence",
    root / "scripts" / "generate_stage1_staging_runtime_evidence.py",
)
generator = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(generator)

original_root = generator.ROOT
try:
    generator.ROOT = fixture_root
    contract = generator.load_json(Path(sys.argv[1]))
    component = generator.component_status(contract["required_components"][0])
finally:
    generator.ROOT = original_root

diagnostic_refs = component.get("diagnostic_evidence_refs") or []
if component.get("status") != "blocked":
    raise SystemExit(f"load component with blocked diagnostic must stay blocked: {component}")
if "blocked/stage1-load.blocked.json" not in diagnostic_refs:
    raise SystemExit(f"staging runtime generator must surface blocked load diagnostic refs: {component}")
if component.get("diagnostic_results_ref") != "blocked/stage1-load.blocked.ndjson":
    raise SystemExit(f"staging runtime generator must surface blocked load diagnostic results: {component}")
blockers = component.get("blockers") or []
if not any("missing canonical pass evidence" in blocker for blocker in blockers):
    raise SystemExit(f"blocked diagnostic fallback must preserve missing canonical evidence blocker: {blockers}")
if not any("strict child validator failed" in blocker for blocker in blockers):
    raise SystemExit(f"blocked diagnostic fallback must still fail strict child validator: {blockers}")
PY

log "stage1 CI exact evidence strict fixture"
stage1_ci_preflight_blocked_dir="$(mktemp -d)"
python3 scripts/generate_stage1_ci_exact_preflight.py --output "$stage1_ci_preflight_blocked_dir/stage1-ci-exact.preflight.json" >/dev/null
python3 scripts/validate_stage1_ci_exact_evidence.py --allow-preflight --preflight "$stage1_ci_preflight_blocked_dir/stage1-ci-exact.preflight.json"
stage1_ci_preflight_ready_dir="$(mktemp -d)"
python3 scripts/generate_stage1_ci_exact_preflight.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --run-id "1234567890" \
  --repository "alphane-ai/zenari" \
  --event-name "pull_request" \
  --base-ref "main" \
  --head-ref "stage1/prelaunch" \
  --output "$stage1_ci_preflight_ready_dir/stage1-ci-exact.preflight.json" >/dev/null
python3 scripts/validate_stage1_ci_exact_evidence.py --allow-preflight --preflight "$stage1_ci_preflight_ready_dir/stage1-ci-exact.preflight.json"
set +e
python3 scripts/validate_stage1_ci_exact_evidence.py \
  --pr-main "$stage1_ci_preflight_ready_dir/stage1-ci-exact.preflight.json" \
  --playwright "$stage1_ci_preflight_ready_dir/stage1-ci-exact.preflight.json" \
  --docker "$stage1_ci_preflight_ready_dir/stage1-ci-exact.preflight.json" >/dev/null 2>&1
stage1_ci_preflight_strict_status=$?
set -e
if [[ "$stage1_ci_preflight_strict_status" -eq 0 ]]; then
  printf 'Stage1 CI exact preflight must not pass strict canonical validation\n' >&2
  exit 1
fi
stage1_ci_fixture_dir="$(mktemp -d)"
python3 - "$stage1_ci_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
release_sha = "0123456789abcdef0123456789abcdef01234567"
safe_false = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}
workflow_run = {
    "run_id": "1234567890",
    "run_url": "https://github.com/alphane-ai/zenari/actions/runs/1234567890",
    "workflow_file": ".github/workflows/stage0-rev2-ci.yml",
    "conclusion": "success",
}
base = {
    "environment": "ci",
    "status": "pass",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "workflow_run": workflow_run,
    "evidence_refs": [".github/workflows/stage0-rev2-ci.yml"],
    **safe_false,
}

playwright = {
    **base,
    "schema_version": "stage1.ci_playwright_smoke.v1",
    "kind": "ci_playwright_smoke",
    "release_gate_check_id": "ci_playwright_smoke",
    "coverage": {
        "user_web": {"status": "pass", "evidence_refs": ["ops/ci/playwright-smoke.spec.ts#user"]},
        "admin_web": {"status": "pass", "evidence_refs": ["ops/ci/playwright-smoke.spec.ts#admin"]},
        "billing": {"status": "pass", "evidence_refs": ["ops/ci/playwright-smoke.spec.ts#billing"]},
        "workspace": {"status": "pass", "evidence_refs": ["ops/ci/playwright-smoke.spec.ts#workspace"]},
    },
    "gate_impact": {
        "release_gate_check_id": "ci_playwright_smoke",
        "can_clear_ci_gate_check": True,
    },
}

docker = {
    **base,
    "schema_version": "stage1.ci_docker_image_build.v1",
    "kind": "ci_docker_image_build",
    "release_gate_check_id": "ci_docker_image_build",
    "image_set": ["backend", "web", "admin"],
    "images": {
        name: {
            "status": "pass",
            "digest": "sha256:" + (str(idx + 1) * 64),
            "evidence_refs": [f"docker://zenari/{name}@sha256"],
        }
        for idx, name in enumerate(("web", "admin", "backend"))
    },
    "gate_impact": {
        "release_gate_check_id": "ci_docker_image_build",
        "can_clear_ci_gate_check": True,
    },
}

(out / "stage0-rev2-playwright-smoke.json").write_text(json.dumps(playwright, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "stage0-rev2-docker-image-build.json").write_text(json.dumps(docker, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
python3 scripts/write_stage1_ci_pr_main_evidence.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --run-id "1234567890" \
  --run-url "https://github.com/alphane-ai/zenari/actions/runs/1234567890" \
  --event-name "pull_request" \
  --base-ref "main" \
  --head-ref "stage1/prelaunch" \
  --canonical-pass-path \
  --output "$stage1_ci_fixture_dir/stage0-rev2-pr-main-run.json"
python3 scripts/validate_stage1_ci_exact_evidence.py \
  --pr-main "$stage1_ci_fixture_dir/stage0-rev2-pr-main-run.json" \
  --playwright "$stage1_ci_fixture_dir/stage0-rev2-playwright-smoke.json" \
  --docker "$stage1_ci_fixture_dir/stage0-rev2-docker-image-build.json"
stage1_ci_fetch_dir="$(mktemp -d)"
stage1_ci_fetch_output_dir="$(mktemp -d)"
mkdir -p "$stage1_ci_fetch_dir/stage0-rev2-pr-main-run" \
  "$stage1_ci_fetch_dir/stage0-rev2-playwright-smoke" \
  "$stage1_ci_fetch_dir/stage0-rev2-docker-image-build"
cp "$stage1_ci_fixture_dir/stage0-rev2-pr-main-run.json" "$stage1_ci_fetch_dir/stage0-rev2-pr-main-run/"
cp "$stage1_ci_fixture_dir/stage0-rev2-playwright-smoke.json" "$stage1_ci_fetch_dir/stage0-rev2-playwright-smoke/"
cp "$stage1_ci_fixture_dir/stage0-rev2-docker-image-build.json" "$stage1_ci_fetch_dir/stage0-rev2-docker-image-build/"
python3 scripts/fetch_stage1_ci_artifacts.py \
  --input-dir "$stage1_ci_fetch_dir" \
  --output-dir "$stage1_ci_fetch_output_dir" \
  --report "$stage1_ci_fetch_output_dir/stage1-ci-artifact-fetch.preflight.json" \
  --dry-run >/dev/null
python3 - "$stage1_ci_fetch_output_dir/stage1-ci-artifact-fetch.preflight.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if report.get("status") != "ready" or report.get("strict_validator_passed") is not True:
    raise SystemExit(f"CI artifact fetch dry-run should be ready: {report}")
if report.get("canonical_artifacts_written") is not False:
    raise SystemExit("CI artifact fetch dry-run must not write canonical artifacts")
if report.get("raw_artifact_zip_persisted") is not False or report.get("github_token_persisted") is not False:
    raise SystemExit("CI artifact fetch must not persist raw zips or GitHub tokens")
PY
python3 scripts/fetch_stage1_ci_artifacts.py \
  --input-dir "$stage1_ci_fetch_dir" \
  --output-dir "$stage1_ci_fetch_output_dir" \
  --report "$stage1_ci_fetch_output_dir/stage1-ci-artifact-fetch.preflight.json" >/dev/null
python3 scripts/validate_stage1_ci_exact_evidence.py \
  --pr-main "$stage1_ci_fetch_output_dir/stage0-rev2-pr-main-run.json" \
  --playwright "$stage1_ci_fetch_output_dir/stage0-rev2-playwright-smoke.json" \
  --docker "$stage1_ci_fetch_output_dir/stage0-rev2-docker-image-build.json"
stage1_ci_latest_error_report="$stage1_ci_fetch_output_dir/stage1-ci-artifact-fetch.latest-error.json"
set +e
python3 scripts/fetch_stage1_ci_artifacts.py \
  --latest-successful \
  --repository alphane-ai/nonexistent-zenari-ci-probe \
  --report "$stage1_ci_latest_error_report" \
  --dry-run >/dev/null 2>&1
stage1_ci_latest_error_status=$?
set -e
if [[ "$stage1_ci_latest_error_status" -eq 0 ]]; then
  printf 'CI artifact latest-successful fetch must fail for invalid repository input\n' >&2
  exit 1
fi
python3 - "$stage1_ci_latest_error_report" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if report.get("status") != "blocked":
    raise SystemExit(f"latest-successful error report should be blocked: {report}")
if report.get("canonical_artifacts_written") is not False:
    raise SystemExit("latest-successful error report must not write canonical artifacts")
if report.get("github_token_persisted") is not False or report.get("raw_artifact_zip_persisted") is not False:
    raise SystemExit("latest-successful error report must not persist token or raw zip")
if "--latest-successful" not in Path("scripts/fetch_stage1_ci_artifacts.py").read_text(encoding="utf-8"):
    raise SystemExit("CI artifact fetcher lost latest-successful support")
PY
set +e
python3 scripts/validate_stage1_ci_exact_evidence.py >/dev/null 2>&1
stage1_ci_strict_status=$?
set -e
if [[ "$stage1_ci_strict_status" -ne 0 ]]; then
  printf 'canonical Stage1 CI exact validator must pass when all three ops/evidence/ci exact files are strict-pass\n' >&2
  exit 1
fi
stage1_ci_missing_dir="$(mktemp -d)"
set +e
python3 scripts/validate_stage1_ci_exact_evidence.py \
  --pr-main "$stage1_ci_missing_dir/missing-pr-main.json" \
  --playwright "$stage1_ci_missing_dir/missing-playwright.json" \
  --docker "$stage1_ci_missing_dir/missing-docker.json" >/dev/null 2>&1
stage1_ci_missing_strict_status=$?
set -e
if [[ "$stage1_ci_missing_strict_status" -eq 0 ]]; then
  printf 'Stage1 CI exact validator must not pass when explicit strict evidence paths are missing\n' >&2
  exit 1
fi

log "stage1 production security launch exact evidence strict fixture"
stage1_prod_security_fixture_dir="$(mktemp -d)"
python3 - "$stage1_prod_security_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
safe_false = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}
section_refs = lambda name: {"status": "pass", "evidence_refs": [f"ops/evidence/production/{name}.json"]}
report = {
    "schema_version": "stage1.production_security_launch.v1",
    "environment": "production",
    "kind": "production_security_launch_checks",
    "status": "pass",
    "release_gate_check_id": "production_security_launch_checks",
    "release_sha": "0123456789abcdef0123456789abcdef01234567",
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "check_level_only": False,
    "secure_session_cookie": {
        **section_refs("secure-session-cookie"),
        "http_only": True,
        "secure": True,
        "same_site": "lax",
    },
    "csrf_same_site_enforcement": {
        **section_refs("csrf-same-site"),
        "cross_site_mutations_denied": True,
    },
    "secret_exposure_redaction": {
        **section_refs("secret-redaction"),
        "raw_secret_exposure_count": 0,
    },
    "admin_surface_privacy": {
        **section_refs("admin-surface-privacy"),
        "raw_private_payload_visible": False,
    },
    "provider_key_containment": {
        **section_refs("provider-key-containment"),
        "frontend_secret_exposure_count": 0,
    },
    "stripe_live_test_separation": {
        **section_refs("stripe-live-test-separation"),
        "live_mode_isolated": True,
    },
    "rate_limit_spend_cap": {
        **section_refs("rate-limit-spend-cap"),
        "kill_switch_ready": True,
    },
    "csp_headers": {
        **section_refs("csp-headers"),
        "csp_present": True,
    },
    "rbac_tenant_isolation": {
        **section_refs("rbac-tenant-isolation"),
        "cross_tenant_denials": True,
    },
    "audit_refs": {
        "status": "pass",
        "refs": ["audit://production/security-launch"],
    },
    "gate_impact": {
        "release_gate_check_id": "production_security_launch_checks",
        "can_clear_security_launch_check": True,
    },
    **safe_false,
}
(out / "production-security-launch.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
python3 scripts/validate_stage1_production_security_launch_evidence.py \
  --evidence "$stage1_prod_security_fixture_dir/production-security-launch.json"
set +e
python3 scripts/validate_stage1_production_security_launch_evidence.py >/dev/null 2>&1
stage1_prod_security_strict_status=$?
set -e
if [[ "$stage1_prod_security_strict_status" -eq 0 ]]; then
  printf 'canonical Stage1 production security validator must not pass unless exact production security evidence is strict-pass\n' >&2
  exit 1
fi
stage1_prod_security_generator_dir="$(mktemp -d)"
set +e
python3 scripts/generate_stage1_production_security_launch_evidence.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --source "$stage1_prod_security_generator_dir/missing-source.json" \
  --evidence "$stage1_prod_security_generator_dir/production-security-launch.json" >/dev/null
stage1_prod_security_generator_status=$?
set -e
if [[ "$stage1_prod_security_generator_status" -ne 2 ]]; then
  printf 'production security generator must exit 2 and write blocked diagnostics while exact production security source evidence is missing, got %s\n' "$stage1_prod_security_generator_status" >&2
  exit 1
fi
python3 - "$stage1_prod_security_generator_dir/production-security-launch.json" <<'PY'
import json
import sys
from pathlib import Path

evidence = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if evidence.get("status") != "blocked":
    raise SystemExit("security generated diagnostic must stay blocked")
if evidence.get("canonical_pass_path") is not False:
    raise SystemExit("security generated diagnostic must not claim canonical pass path")
if evidence.get("local_devport_debug") is not False or evidence.get("allow_local_devport_evidence") is not False:
    raise SystemExit("security generated diagnostic must not be local-devport evidence")
blockers = evidence.get("blocked_checks")
if not isinstance(blockers, list) or not blockers:
    raise SystemExit("security generated diagnostic must include blockers")
joined = " ".join(str(item) for item in blockers)
if "source_probe_missing" not in joined:
    raise SystemExit(f"security generated diagnostic must cite missing source probe: {blockers}")
gate = evidence.get("gate_impact", {})
if gate.get("preserved_release_gate_check_id") != "production_security_launch_checks":
    raise SystemExit(f"security generated diagnostic must preserve production security gate: {gate}")
PY
python3 scripts/validate_stage1_production_security_launch_evidence.py --allow-preflight \
  --evidence "$stage1_prod_security_generator_dir/production-security-launch.json"

log "stage1 production provider claims exact evidence strict fixture"
stage1_prod_provider_claims_fixture_dir="$(mktemp -d)"
python3 - "$stage1_prod_provider_claims_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
release_sha = "0123456789abcdef0123456789abcdef01234567"
safe_false = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}

provider = {
    "schema_version": "stage1.production_provider_mode.v1",
    "environment": "production",
    "kind": "production_provider_mode",
    "status": "pass",
    "release_gate_check_id": "production_provider_or_comp_only_mode",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "check_level_only": False,
    "launch_mode": "invite_comp_only",
    "provider_mode": {
        "production_provider_id": None,
        "development_provider_id": "dev-deterministic-image",
        "invite_comp_only": True,
        "paid_generation_enabled": False,
        "dev_provider_public_routing": False,
        "silent_fallback_enabled": False,
    },
    "provider_contract": {
        "provider_id": None,
        "secret_ref": None,
        "status": "not_required_invite_comp_only",
        "request_response_schema_verified": False,
        "safety_policy_verified": False,
        "staging_verification_id": None,
    },
    "monitoring_cost": {
        "dashboard_id": "prod-provider-mode-dashboard",
        "alert_route_id": "prod-provider-mode-alert-route",
        "provider_usage_log_ref": "prod-provider-usage-ledger",
        "cost_meter_ref": "prod-provider-cost-meter",
        "spend_cap_ref": "prod-provider-spend-cap",
    },
    "routing_safety": {
        "kill_switch_ready": True,
        "strategy_group_audited": True,
        "fallback_policy_explicit": True,
    },
    "runtime_request_ids": [
        "prod-provider-mode-launch-mode",
        "prod-provider-mode-routing-safety",
    ],
    "audit_refs": [
        "audit://production/provider-mode",
        "audit://production/provider-routing",
    ],
    "gate_impact": {
        "release_gate_check_id": "production_provider_or_comp_only_mode",
        "can_clear_provider_mode_subitem": True,
    },
    **safe_false,
}

claims = {
    "schema_version": "stage1.production_public_paid_real_generation_claims.v1",
    "environment": "production",
    "kind": "production_public_paid_real_generation_claims",
    "status": "pass",
    "release_gate_check_id": "production_provider_or_comp_only_mode",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "check_level_only": False,
    "launch_mode": "invite_comp_only",
    "public_claim_probes": [
        {
            "surface": "public_home",
            "path": "/",
            "status": "pass",
            "http_status": 200,
            "visibility": "public",
            "required_tokens": ["invite access", "AI content disclaimer", "support contact"],
        },
        {
            "surface": "billing_policy",
            "path": "/legal/billing-policy",
            "status": "pass",
            "http_status": 200,
            "visibility": "public",
            "required_tokens": ["billing policy", "cancellation", "refund", "support contact"],
        },
        {
            "surface": "admin_provider_health",
            "path": "/admin/providers",
            "status": "pass",
            "http_status": 200,
            "visibility": "public",
            "required_tokens": ["Provider Registry", "Provider Strategy Groups", "development-only"],
        },
    ],
    "paid_real_generation_claims": {
        "paid_claims_enabled": False,
        "real_generation_claims_enabled": False,
        "invite_comp_only_disclosed": True,
        "mock_checkout_readiness_claim": False,
        "unsupported_real_generation_claim": False,
    },
    "dev_provider_claim_denial": {
        "dev_provider_presented_as_production": False,
        "development_only_label_visible": True,
        "silent_fallback_claim": False,
    },
    "runtime_request_ids": [
        "prod-provider-claims-public-home",
        "prod-provider-claims-billing-policy",
        "prod-provider-claims-admin-health",
    ],
    "audit_refs": [
        "audit://production/provider-claims",
        "audit://production/public-claims",
    ],
    "gate_impact": {
        "release_gate_check_id": "production_provider_or_comp_only_mode",
        "can_clear_public_paid_real_generation_claims_subitem": True,
    },
    **safe_false,
}

(out / "provider-mode.json").write_text(json.dumps(provider, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "public-paid-real-generation-claims.json").write_text(json.dumps(claims, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
python3 scripts/validate_stage1_production_provider_claims_evidence.py \
  --provider-evidence "$stage1_prod_provider_claims_fixture_dir/provider-mode.json" \
  --claims-evidence "$stage1_prod_provider_claims_fixture_dir/public-paid-real-generation-claims.json"
set +e
python3 scripts/validate_stage1_production_provider_claims_evidence.py >/dev/null 2>&1
stage1_prod_provider_claims_strict_status=$?
set -e
if [[ "$stage1_prod_provider_claims_strict_status" -ne 0 ]]; then
  printf 'canonical Stage1 production provider claims validator must pass when exact production provider claims evidence is strict-pass\n' >&2
  exit 1
fi
stage1_prod_provider_claims_missing_dir="$(mktemp -d)"
set +e
python3 scripts/validate_stage1_production_provider_claims_evidence.py \
  --provider-evidence "$stage1_prod_provider_claims_missing_dir/missing-provider-mode.json" \
  --claims-evidence "$stage1_prod_provider_claims_missing_dir/missing-public-paid-real-generation-claims.json" >/dev/null 2>&1
stage1_prod_provider_claims_missing_status=$?
set -e
if [[ "$stage1_prod_provider_claims_missing_status" -eq 0 ]]; then
  printf 'Stage1 production provider claims validator must not pass when explicit strict evidence paths are missing\n' >&2
  exit 1
fi
stage1_prod_provider_claims_generator_dir="$(mktemp -d)"
set +e
python3 scripts/generate_stage1_production_provider_claims_evidence.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --source "$stage1_prod_provider_claims_generator_dir/missing-source.json" \
  --provider-evidence "$stage1_prod_provider_claims_generator_dir/provider-mode.json" \
  --claims-evidence "$stage1_prod_provider_claims_generator_dir/public-paid-real-generation-claims.json" >/dev/null
stage1_prod_provider_claims_generator_status=$?
set -e
if [[ "$stage1_prod_provider_claims_generator_status" -ne 2 ]]; then
  printf 'production provider claims generator must exit 2 and write blocked diagnostics while exact production provider source evidence is missing, got %s\n' "$stage1_prod_provider_claims_generator_status" >&2
  exit 1
fi
python3 - "$stage1_prod_provider_claims_generator_dir/provider-mode.json" "$stage1_prod_provider_claims_generator_dir/public-paid-real-generation-claims.json" <<'PY'
import json
import sys
from pathlib import Path

provider = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
claims = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
for label, evidence in (("provider", provider), ("claims", claims)):
    if evidence.get("status") != "blocked":
        raise SystemExit(f"{label} generated diagnostic must stay blocked")
    if evidence.get("canonical_pass_path") is not False:
        raise SystemExit(f"{label} generated diagnostic must not claim canonical pass path")
    if evidence.get("local_devport_debug") is not False or evidence.get("allow_local_devport_evidence") is not False:
        raise SystemExit(f"{label} generated diagnostic must not be local-devport evidence")
    blockers = evidence.get("blocked_checks")
    if not isinstance(blockers, list) or not blockers:
        raise SystemExit(f"{label} generated diagnostic must include blockers")
    joined = " ".join(str(item) for item in blockers)
    if "source_probe_missing" not in joined:
        raise SystemExit(f"{label} generated diagnostic must cite missing source probe: {blockers}")
    gate = evidence.get("gate_impact", {})
    if gate.get("preserved_release_gate_check_id") != "production_provider_or_comp_only_mode":
        raise SystemExit(f"{label} generated diagnostic must preserve production provider claims gate: {gate}")
PY
python3 scripts/validate_stage1_production_provider_claims_evidence.py --allow-preflight \
  --provider-evidence "$stage1_prod_provider_claims_generator_dir/provider-mode.json" \
  --claims-evidence "$stage1_prod_provider_claims_generator_dir/public-paid-real-generation-claims.json"

log "stage1 production governance/release exact evidence strict fixture"
stage1_prod_governance_release_fixture_dir="$(mktemp -d)"
python3 - "$stage1_prod_governance_release_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
release_sha = "0123456789abcdef0123456789abcdef01234567"
safe_false = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}

def section(name, **extra):
    return {
        "status": "pass",
        "evidence_refs": [f"ops/evidence/production/{name}.json"],
        **extra,
    }

base = {
    "environment": "production",
    "status": "pass",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "check_level_only": False,
    **safe_false,
}

activation = {
    **base,
    "schema_version": "stage1.production_activation_review_audit.v1",
    "kind": "production_activation_review_audit",
    "release_gate_check_id": "production_activation_review_audit",
    "runtime_request_ids": [
        "prod-activation-review-audit-skill",
        "prod-activation-review-audit-provider",
        "prod-activation-review-audit-export",
    ],
    "audit_refs": [
        "audit://production/activation-review",
        "audit://production/high-risk-admin",
    ],
    "high_risk_rbac": section("activation-high-risk-rbac", all_high_risk_surfaces_covered=True),
    "reviewer_rationale": section("activation-reviewer-rationale", rationale_required=True, rationale_captured=True),
    "second_review": section("activation-second-review", required_for_high_risk=True, distinct_reviewer_enforced=True),
    "audit_immutability": section("activation-audit-immutability", immutable_audit_refs=True),
    "activation_gates": section(
        "activation-gates",
        skill=True,
        crawler=True,
        prompt=True,
        provider=True,
        quota=True,
        safety=True,
        export=True,
    ),
    "gate_impact": {
        "release_gate_check_id": "production_activation_review_audit",
        "can_clear_activation_review_audit_component": True,
    },
}

abuse = {
    **base,
    "schema_version": "stage1.production_abuse_throttle_hold.v1",
    "kind": "production_abuse_throttle_hold",
    "release_gate_check_id": "production_abuse_throttle_hold",
    "runtime_request_ids": [
        "prod-abuse-throttle-hold-account",
        "prod-abuse-throttle-hold-rate-limit",
        "prod-abuse-throttle-hold-kill-switch",
    ],
    "audit_refs": [
        "audit://production/abuse-hold",
        "audit://production/abuse-throttle",
    ],
    "account_hold": section("abuse-account-hold", hold_enforced=True),
    "rate_limit": section("abuse-rate-limit", rate_limit_enforced=True),
    "spend_cap_or_kill_switch": section("abuse-spend-cap-kill-switch", spend_cap_ready=True, kill_switch_ready=True),
    "rbac_audit": section("abuse-rbac-audit", rbac_enforced=True, immutable_audit_refs=True),
    "gate_impact": {
        "release_gate_check_id": "production_abuse_throttle_hold",
        "can_clear_abuse_throttle_hold_component": True,
    },
}

skill = {
    **base,
    "schema_version": "stage1.production_skill_release_eval_canary.v1",
    "kind": "production_skill_release_eval_canary",
    "release_gate_check_id": "production_skill_release_eval_canary",
    "runtime_request_ids": [
        "prod-skill-release-eval-suite",
        "prod-skill-release-canary",
        "prod-skill-release-rollback",
    ],
    "audit_refs": [
        "audit://production/skill-release",
        "audit://production/skill-rollback",
    ],
    "owner_risk": section("skill-owner-risk", owner_id="admin-release-owner", risk_level="medium"),
    "eval_suite": section("skill-eval-suite", eval_passed=True, suite_id="eval-suite-production-release"),
    "safety_refs": section("skill-safety-refs", safety_refs_complete=True),
    "canary_metrics": section("skill-canary-metrics", metrics_within_threshold=True, sample_size=250),
    "rollback_target": section("skill-rollback-target", rollback_target_id="skill-export-pack@1.8.0", route_smoke_passed=True),
    "release_notes": section("skill-release-notes", release_notes_id="release-notes-skill-export-pack-1.8.1", go_no_go_recorded=True),
    "gate_impact": {
        "release_gate_check_id": "production_skill_release_eval_canary",
        "can_clear_skill_release_eval_canary_component": True,
    },
}

(out / "activation-review-audit.json").write_text(json.dumps(activation, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "abuse-throttle-hold.json").write_text(json.dumps(abuse, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "skill-release-eval-canary.json").write_text(json.dumps(skill, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
python3 scripts/validate_stage1_production_governance_release_evidence.py \
  --activation-evidence "$stage1_prod_governance_release_fixture_dir/activation-review-audit.json" \
  --abuse-evidence "$stage1_prod_governance_release_fixture_dir/abuse-throttle-hold.json" \
  --skill-evidence "$stage1_prod_governance_release_fixture_dir/skill-release-eval-canary.json"
set +e
python3 scripts/validate_stage1_production_governance_release_evidence.py >/dev/null 2>&1
stage1_prod_governance_release_strict_status=$?
set -e
if [[ "$stage1_prod_governance_release_strict_status" -eq 0 ]]; then
  printf 'canonical Stage1 production governance/release validator must not pass unless exact production governance/release evidence is strict-pass\n' >&2
  exit 1
fi
stage1_prod_governance_release_generator_dir="$(mktemp -d)"
set +e
python3 scripts/generate_stage1_production_governance_release_evidence.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --source "$stage1_prod_governance_release_generator_dir/missing-source.json" \
  --activation-evidence "$stage1_prod_governance_release_generator_dir/activation-review-audit.json" \
  --abuse-evidence "$stage1_prod_governance_release_generator_dir/abuse-throttle-hold.json" \
  --skill-evidence "$stage1_prod_governance_release_generator_dir/skill-release-eval-canary.json" >/dev/null
stage1_prod_governance_release_generator_status=$?
set -e
if [[ "$stage1_prod_governance_release_generator_status" -ne 2 ]]; then
  printf 'production governance/release generator must exit 2 and write blocked diagnostics while exact production governance/release source evidence is missing, got %s\n' "$stage1_prod_governance_release_generator_status" >&2
  exit 1
fi
python3 - \
  "$stage1_prod_governance_release_generator_dir/activation-review-audit.json" \
  "$stage1_prod_governance_release_generator_dir/abuse-throttle-hold.json" \
  "$stage1_prod_governance_release_generator_dir/skill-release-eval-canary.json" <<'PY'
import json
import sys
from pathlib import Path

expected_gates = {
    "activation-review-audit.json": "production_activation_review_audit",
    "abuse-throttle-hold.json": "production_abuse_throttle_hold",
    "skill-release-eval-canary.json": "production_skill_release_eval_canary",
}
for raw_path in sys.argv[1:]:
    path = Path(raw_path)
    evidence = json.loads(path.read_text(encoding="utf-8"))
    if evidence.get("status") != "blocked":
        raise SystemExit(f"{path.name} generated diagnostic must stay blocked")
    if evidence.get("canonical_pass_path") is not False:
        raise SystemExit(f"{path.name} generated diagnostic must not claim canonical pass path")
    if evidence.get("local_devport_debug") is not False or evidence.get("allow_local_devport_evidence") is not False:
        raise SystemExit(f"{path.name} generated diagnostic must not be local-devport evidence")
    blockers = evidence.get("blocked_checks")
    if not isinstance(blockers, list) or not blockers:
        raise SystemExit(f"{path.name} generated diagnostic must include blockers")
    joined = " ".join(str(item) for item in blockers)
    if "source_probe_missing" not in joined:
        raise SystemExit(f"{path.name} generated diagnostic must cite missing source probe: {blockers}")
    gate = evidence.get("gate_impact", {})
    if gate.get("preserved_release_gate_check_id") != expected_gates[path.name]:
        raise SystemExit(f"{path.name} generated diagnostic must preserve production gate: {gate}")
PY
python3 scripts/validate_stage1_production_governance_release_evidence.py --allow-preflight \
  --activation-evidence "$stage1_prod_governance_release_generator_dir/activation-review-audit.json" \
  --abuse-evidence "$stage1_prod_governance_release_generator_dir/abuse-throttle-hold.json" \
  --skill-evidence "$stage1_prod_governance_release_generator_dir/skill-release-eval-canary.json"

log "stage1 production legal/support exact evidence strict fixture"
stage1_prod_legal_support_fixture_dir="$(mktemp -d)"
python3 - "$stage1_prod_legal_support_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
release_sha = "0123456789abcdef0123456789abcdef01234567"
safe_false = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}

def probe(page_id, path, tokens):
    return {
        "page_id": page_id,
        "path": path,
        "status": "pass",
        "http_status": 200,
        "visibility": "public",
        "external_user_visible": True,
        "admin_session_required": False,
        "required_tokens": tokens,
    }

legal = {
    "schema_version": "stage1.production_legal_policy.v1",
    "environment": "production",
    "kind": "production_public_legal_policy",
    "status": "pass",
    "release_gate_check_id": "production_legal_support_policy",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "check_level_only": False,
    "runtime_request_ids": [
        "production-legal-support-policy-prod-terms",
        "production-legal-support-policy-prod-privacy",
    ],
    "audit_refs": ["audit://production/legal-support"],
    "page_probes": [
        probe("terms", "/legal/terms", ["Terms", "support contact", "AI content"]),
        probe("privacy", "/legal/privacy", ["Privacy", "data deletion", "support contact"]),
        probe("acceptable_use", "/legal/acceptable-use", ["Acceptable Use", "abuse", "support contact"]),
        probe("ai_content_disclaimer", "/support", ["AI content", "responsibility", "review"]),
        probe("ip_complaint", "/legal/ip-complaints", ["IP complaint", "copyright", "trademark", "takedown"]),
    ],
    "coverage": [
        {
            "area": "public_legal_pages",
            "status": "pass",
            "evidence_refs": ["ops/evidence/production/public-legal-policy.json"],
        },
        {
            "area": "gate_clearance",
            "status": "pass",
            "evidence_refs": ["ops/evidence/production/public-legal-policy.json"],
        },
    ],
    "gate_impact": {
        "release_gate_check_id": "production_legal_support_policy",
        "can_clear_public_legal_subitem": True,
    },
    **safe_false,
}

support = {
    "schema_version": "stage1.production_support_billing_policy.v1",
    "environment": "production",
    "kind": "production_public_support_billing_policy",
    "status": "pass",
    "release_gate_check_id": "production_legal_support_policy",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "check_level_only": False,
    "runtime_request_ids": [
        "production-legal-support-policy-prod-support",
        "production-legal-support-policy-prod-billing",
    ],
    "audit_refs": ["audit://production/legal-support"],
    "page_probes": [
        probe("support_contact", "/support", ["support contact", "report problem", "privacy redaction", "escalation"]),
        probe("report_problem", "/support", ["project", "task", "trace", "export", "quota"]),
        probe("billing_policy", "/legal/billing-policy", ["billing", "cancellation", "refund", "credit", "quota reset", "past_due"]),
        probe("support_sla", "/support", ["support SLA", "severity", "response time", "escalation"]),
    ],
    "coverage": [
        {
            "area": "public_support_contact",
            "status": "pass",
            "evidence_refs": ["ops/evidence/production/public-support-billing-policy.json"],
        },
        {
            "area": "billing_policy_visibility",
            "status": "pass",
            "evidence_refs": ["ops/evidence/production/public-support-billing-policy.json"],
        },
        {
            "area": "support_sla",
            "status": "pass",
            "evidence_refs": ["ops/evidence/production/public-support-billing-policy.json"],
        },
        {
            "area": "gate_clearance",
            "status": "pass",
            "evidence_refs": ["ops/evidence/production/public-support-billing-policy.json"],
        },
    ],
    "paid_launch_policy_alignment": {
        "billing_policy_visible": True,
        "refund_policy_visible": True,
        "cancellation_policy_visible": True,
        "support_sla_visible": True,
        "standalone_production_readiness_claim": False,
    },
    "gate_impact": {
        "release_gate_check_id": "production_legal_support_policy",
        "can_clear_support_billing_policy_subitem": True,
    },
    **safe_false,
}

(out / "public-legal-policy.json").write_text(json.dumps(legal, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "public-support-billing-policy.json").write_text(json.dumps(support, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
python3 scripts/validate_stage1_production_legal_support_evidence.py \
  --legal-evidence "$stage1_prod_legal_support_fixture_dir/public-legal-policy.json" \
  --support-evidence "$stage1_prod_legal_support_fixture_dir/public-support-billing-policy.json"
set +e
python3 scripts/validate_stage1_production_legal_support_evidence.py >/dev/null 2>&1
stage1_prod_legal_support_strict_status=$?
set -e
if [[ "$stage1_prod_legal_support_strict_status" -eq 0 ]]; then
  printf 'canonical Stage1 production legal/support validator must not pass unless exact production legal/support evidence is strict-pass\n' >&2
  exit 1
fi
stage1_prod_legal_support_generator_dir="$(mktemp -d)"
set +e
python3 scripts/generate_stage1_production_legal_support_evidence.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --source "$stage1_prod_legal_support_generator_dir/missing-source.json" \
  --legal-evidence "$stage1_prod_legal_support_generator_dir/public-legal-policy.json" \
  --support-evidence "$stage1_prod_legal_support_generator_dir/public-support-billing-policy.json" >/dev/null
stage1_prod_legal_support_generator_status=$?
set -e
if [[ "$stage1_prod_legal_support_generator_status" -ne 2 ]]; then
  printf 'production legal/support generator must exit 2 and write blocked diagnostics while exact production legal/support source evidence is missing, got %s\n' "$stage1_prod_legal_support_generator_status" >&2
  exit 1
fi
python3 - "$stage1_prod_legal_support_generator_dir/public-legal-policy.json" "$stage1_prod_legal_support_generator_dir/public-support-billing-policy.json" <<'PY'
import json
import sys
from pathlib import Path

legal = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
support = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
for label, evidence in (("legal", legal), ("support", support)):
    if evidence.get("status") != "blocked":
        raise SystemExit(f"{label} generated diagnostic must stay blocked")
    if evidence.get("canonical_pass_path") is not False:
        raise SystemExit(f"{label} generated diagnostic must not claim canonical pass path")
    if evidence.get("local_devport_debug") is not False or evidence.get("allow_local_devport_evidence") is not False:
        raise SystemExit(f"{label} generated diagnostic must not be local-devport evidence")
    blockers = evidence.get("blocked_checks")
    if not isinstance(blockers, list) or not blockers:
        raise SystemExit(f"{label} generated diagnostic must include blockers")
    joined = " ".join(str(item) for item in blockers)
    if "source_probe_missing" not in joined:
        raise SystemExit(f"{label} generated diagnostic must cite missing source probe: {blockers}")
    gate = evidence.get("gate_impact", {})
    if gate.get("preserved_release_gate_check_id") != "production_legal_support_policy":
        raise SystemExit(f"{label} generated diagnostic must preserve production legal/support gate: {gate}")
PY
python3 scripts/validate_stage1_production_legal_support_evidence.py --allow-preflight \
  --legal-evidence "$stage1_prod_legal_support_generator_dir/public-legal-policy.json" \
  --support-evidence "$stage1_prod_legal_support_generator_dir/public-support-billing-policy.json"

log "stage1 production billing exact evidence strict fixture"
stage1_prod_billing_fixture_dir="$(mktemp -d)"
python3 - "$stage1_prod_billing_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
release_sha = "0123456789abcdef0123456789abcdef01234567"
safe_false = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}
lifecycle = {
    "schema_version": "stage1.production_billing_lifecycle.v1",
    "environment": "production",
    "kind": "production_paid_billing_lifecycle",
    "status": "pass",
    "release_gate_check_id": "production_paid_billing_lifecycle",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "invite_comp_only_substitute": False,
    "stripe_live_test_separation": {
        "status": "pass",
        "stripe_mode": "live",
        "live_mode_enabled": True,
        "test_mode_isolated": True,
        "live_artifacts_verified": True,
        "test_artifact_refs": [],
        "evidence_refs": ["ops/evidence/production/stripe-live-test-separation.json"],
    },
    "paid_checkout": {
        "status": "pass",
        "livemode": True,
        "checkout_session_id": "cs_live_prodcheckout",
        "customer_id": "cus_prodcheckout",
        "price_id": "price_prodcheckout",
        "evidence_refs": ["ops/evidence/production/checkout-session.json"],
    },
    "subscription_active": {
        "status": "pass",
        "livemode": True,
        "subscription_id": "sub_prodactive",
        "customer_id": "cus_prodcheckout",
        "subscription_status": "active",
        "evidence_refs": ["ops/evidence/production/subscription-active.json"],
    },
    "subscription_past_due": {
        "status": "pass",
        "livemode": True,
        "subscription_id": "sub_prodpastdue",
        "invoice_id": "in_prodpastdue",
        "subscription_status": "past_due",
        "evidence_refs": ["ops/evidence/production/subscription-past-due.json"],
    },
    "subscription_cancel": {
        "status": "pass",
        "livemode": True,
        "subscription_id": "sub_prodcancel",
        "cancel_at_period_end": True,
        "evidence_refs": ["ops/evidence/production/subscription-cancel.json"],
    },
    "team_seat_quantity_sync": {
        "status": "pass",
        "seat_quantity": 4,
        "synced_quantity": 4,
        "provider_subscription_item_id": "si_prodteamseat",
        "proration_behavior": "create_prorations",
        "sync_idempotency_key": "prod-team-seat-sync-0123456789abcdef",
        "idempotency_verified": True,
        "evidence_refs": ["ops/evidence/production/team-seat-sync.json"],
    },
    "invoice_receipt_visibility": {
        "status": "pass",
        "livemode": True,
        "invoice_id": "in_prodreceipt",
        "invoice_visible": True,
        "receipt_visible": True,
        "secret_visible": False,
        "hosted_invoice_url_visible": True,
        "invoice_pdf_visible": True,
        "internal_url_visible": False,
        "public_invoice_links_safe": True,
        "evidence_refs": ["ops/evidence/production/invoice-receipt-visibility.json"],
    },
    "audit_refs": {
        "status": "pass",
        "refs": ["audit://production/billing-lifecycle"],
    },
    "gate_impact": {
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "can_clear_billing_lifecycle_subitem": True,
    },
    **safe_false,
}
refund = {
    "schema_version": "stage1.production_billing_refund_credit_webhook.v1",
    "environment": "production",
    "kind": "production_billing_refund_credit_webhook",
    "status": "pass",
    "release_gate_check_id": "production_paid_billing_lifecycle",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "invite_comp_only_substitute": False,
    "refund_or_credit": {
        "status": "pass",
        "livemode": True,
        "charge_id": "ch_prodrefund",
        "refund_id": "re_prodrefund",
        "refund_status": "succeeded",
        "admin_operation": "refund_note",
        "evidence_refs": ["ops/evidence/production/refund-credit.json"],
    },
    "quota_reset": {
        "status": "pass",
        "invoice_id": "in_prodquotareset",
        "reset_invoked": True,
        "evidence_refs": ["ops/evidence/production/quota-reset.json"],
    },
    "webhook_idempotency": {
        "status": "pass",
        "livemode": True,
        "event_ids": ["evt_prodcheckout", "evt_prodinvoicepaid", "evt_prodpaymentfailed"],
        "event_types_observed": ["checkout.session.completed", "invoice.paid", "invoice.payment_failed", "refund.created"],
        "replay_attempted": True,
        "first_delivery_mutations": 2,
        "replay_delivery_mutations": 0,
        "duplicate_mutation_count": 0,
        "idempotency_verified": True,
        "evidence_refs": ["ops/evidence/production/webhook-idempotency.json"],
    },
    "failed_export_refund": {
        "status": "pass",
        "livemode": True,
        "refund_id": "re_prodfailedexport",
        "refund_issued": True,
        "evidence_refs": ["ops/evidence/production/failed-export-refund.json"],
    },
    "quota_projection": {
        "status": "pass",
        "projection_valid": True,
        "secret_fields_projected": False,
        "evidence_refs": ["ops/evidence/production/quota-projection.json"],
    },
    "audit_refs": {
        "status": "pass",
        "refs": ["audit://production/billing-refund-credit-webhook"],
    },
    "gate_impact": {
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "can_clear_refund_credit_webhook_subitem": True,
    },
    **safe_false,
}
(out / "billing-lifecycle.json").write_text(json.dumps(lifecycle, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "billing-refund-credit-webhook.json").write_text(json.dumps(refund, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
python3 scripts/validate_stage1_production_billing_evidence.py \
  --lifecycle-evidence "$stage1_prod_billing_fixture_dir/billing-lifecycle.json" \
  --refund-evidence "$stage1_prod_billing_fixture_dir/billing-refund-credit-webhook.json"
set +e
python3 scripts/validate_stage1_production_billing_evidence.py >/dev/null 2>&1
stage1_prod_billing_strict_status=$?
set -e
if [[ "$stage1_prod_billing_strict_status" -eq 0 ]]; then
  printf 'canonical Stage1 production billing validator must not pass unless exact production billing evidence exists and is strict-pass\n' >&2
  exit 1
fi
stage1_prod_billing_generator_dir="$(mktemp -d)"
set +e
python3 scripts/generate_stage1_production_billing_evidence.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --source "$stage1_prod_billing_generator_dir/missing-source.json" \
  --lifecycle-evidence "$stage1_prod_billing_generator_dir/billing-lifecycle.json" \
  --refund-evidence "$stage1_prod_billing_generator_dir/billing-refund-credit-webhook.json" >/dev/null
stage1_prod_billing_generator_status=$?
set -e
if [[ "$stage1_prod_billing_generator_status" -ne 2 ]]; then
  printf 'production billing generator must exit 2 and write blocked diagnostics while exact production Stripe source evidence is missing, got %s\n' "$stage1_prod_billing_generator_status" >&2
  exit 1
fi
python3 - "$stage1_prod_billing_generator_dir/billing-lifecycle.json" "$stage1_prod_billing_generator_dir/billing-refund-credit-webhook.json" <<'PY'
import json
import sys
from pathlib import Path

lifecycle = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
refund = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
for label, evidence in (("lifecycle", lifecycle), ("refund", refund)):
    if evidence.get("status") != "blocked":
        raise SystemExit(f"{label} generated diagnostic must stay blocked")
    if evidence.get("canonical_pass_path") is not False:
        raise SystemExit(f"{label} generated diagnostic must not claim canonical pass path")
    if evidence.get("local_devport_debug") is not False or evidence.get("allow_local_devport_evidence") is not False:
        raise SystemExit(f"{label} generated diagnostic must not be local-devport evidence")
    blockers = evidence.get("blocked_checks")
    if not isinstance(blockers, list) or not blockers:
        raise SystemExit(f"{label} generated diagnostic must include blockers")
    joined = " ".join(str(item) for item in blockers)
    if "source_probe_missing" not in joined:
        raise SystemExit(f"{label} generated diagnostic must cite missing source probe: {blockers}")
    gate = evidence.get("gate_impact", {})
    if gate.get("preserved_release_gate_check_id") != "production_paid_billing_lifecycle":
        raise SystemExit(f"{label} generated diagnostic must preserve production billing gate: {gate}")
PY
python3 scripts/validate_stage1_production_billing_evidence.py --allow-preflight \
  --lifecycle-evidence "$stage1_prod_billing_generator_dir/billing-lifecycle.json" \
  --refund-evidence "$stage1_prod_billing_generator_dir/billing-refund-credit-webhook.json"

log "stage1 production backup/rollback exact evidence strict fixture"
stage1_prod_backup_rollback_fixture_dir="$(mktemp -d)"
python3 - "$stage1_prod_backup_rollback_fixture_dir" <<'PY'
import json
import sys
from pathlib import Path

out = Path(sys.argv[1])
release_sha = "0123456789abcdef0123456789abcdef01234567"
safe_false = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}

backup = {
    "schema_version": "stage1.production_backup_restore.v1",
    "environment": "production",
    "kind": "production_backup_restore",
    "status": "pass",
    "release_gate_check_id": "production_backup_rollback_incident",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "backup_schedule": {
        "status": "pass",
        "schedule_ref": "prod-backup-schedule",
        "timezone": "UTC",
        "evidence_refs": ["ops/runbooks/stage0_ops.md"],
    },
    "postgres_restore": {
        "status": "pass",
        "restore_id": "pg-restore-prod-smoke",
        "evidence_refs": ["ops/evidence/production/postgres-restore-audit.json"],
    },
    "object_restore": {
        "status": "pass",
        "restore_id": "object-restore-prod-smoke",
        "evidence_refs": ["ops/evidence/production/object-restore-audit.json"],
    },
    "asset_lineage": {
        "status": "pass",
        "lineage_refs": ["ops/evidence/production/asset-lineage-audit.json"],
    },
    "billing_ledger": {
        "status": "pass",
        "ledger_refs": ["ops/evidence/production/billing-ledger-audit.json"],
    },
    "rpo_rto": {
        "status": "pass",
        "rpo_minutes": 15,
        "rto_minutes": 30,
        "evidence_refs": ["ops/evidence/production/rpo-rto-audit.json"],
    },
    "audit_refs": {
        "status": "pass",
        "refs": ["audit://production/backup-restore"],
    },
    "gate_impact": {
        "release_gate_check_id": "production_backup_rollback_incident",
        "can_clear_backup_restore_split": True,
        "check_level_item": "Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。",
    },
    **safe_false,
}

rollback = {
    "schema_version": "stage1.production_rollback_incident_post_deploy.v1",
    "environment": "production",
    "kind": "production_rollback_incident_post_deploy_smoke",
    "status": "pass",
    "release_gate_check_id": "production_backup_rollback_incident",
    "release_sha": release_sha,
    "canonical_pass_path": True,
    "local_devport_debug": False,
    "allow_local_devport_evidence": False,
    "dry_run": False,
    "app_rollback": {
        "status": "pass",
        "evidence_refs": ["ops/evidence/production/app-rollback-audit.json"],
    },
    "feature_flag_rollback": {
        "status": "pass",
        "evidence_refs": ["ops/evidence/production/feature-flag-rollback-audit.json"],
    },
    "backend_runtime_worker_rollback": {
        "status": "pass",
        "release_image_name": "backend",
        "standalone_release_image": False,
        "docker_target": "runtime-worker",
        "entrypoint": "/app/worker",
        "evidence_refs": [
            "ops/evidence/ci/stage0-rev2-docker-image-build.json",
            "ops/evidence/production/worker-image-rollback-audit.json",
        ],
    },
    "worker_drain": {
        "status": "pass",
        "evidence_refs": ["ops/evidence/production/worker-drain-audit.json"],
    },
    "migration_compatibility": {
        "status": "pass",
        "evidence_refs": ["ops/evidence/production/migration-compatibility-audit.json"],
    },
    "incident_alert_path": {
        "status": "pass",
        "evidence_refs": ["ops/evidence/production/incident-alert-audit.json"],
    },
    "post_deploy_smoke": {
        "status": "pass",
        "evidence_refs": ["ops/evidence/production/post-deploy-smoke-audit.json"],
    },
    "upstream_gate_dependencies": {
        "status": "pass",
        "gates": {
            "ci": {
                "path": "fixtures/stage0/rev2/release_gate_evidence.ci.json",
                "status": "go",
            },
            "private_beta_staging": {
                "path": "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
                "status": "go",
            },
            "strict_stage1_staging_runtime": {
                "path": "ops/evidence/staging/stage1-runtime.json",
                "status": "pass",
            },
        },
        "ci_evidence_refs": [
            "ops/evidence/ci/stage0-rev2-pr-main-run.json",
            "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
            "ops/evidence/ci/stage0-rev2-docker-image-build.json",
        ],
        "gate_decision_status_summary": "CI gate_decision.status=go; private_beta_staging gate_decision.status=go; strict_stage1_staging_runtime status=pass",
    },
    "audit_refs": {
        "status": "pass",
        "refs": ["audit://production/rollback-incident-post-deploy"],
    },
    "gate_impact": {
        "release_gate_check_id": "production_backup_rollback_incident",
        "can_clear_rollback_incident_post_deploy_split": True,
        "check_level_item": "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves app rollback, feature flag rollback, backend image runtime-worker rollback (/app/worker), worker drain, incident/alert path, migration compatibility, and post-deploy smoke under `ops/evidence/production/`。",
    },
    **safe_false,
}

(out / "backup-restore.json").write_text(json.dumps(backup, indent=2, sort_keys=True) + "\n", encoding="utf-8")
(out / "rollback-incident-post-deploy-smoke.json").write_text(json.dumps(rollback, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
python3 scripts/validate_stage1_production_backup_rollback_evidence.py \
  --backup-evidence "$stage1_prod_backup_rollback_fixture_dir/backup-restore.json" \
  --rollback-evidence "$stage1_prod_backup_rollback_fixture_dir/rollback-incident-post-deploy-smoke.json"
set +e
python3 scripts/validate_stage1_production_backup_rollback_evidence.py >/dev/null 2>&1
stage1_prod_backup_rollback_strict_status=$?
set -e
if [[ "$stage1_prod_backup_rollback_strict_status" -ne 0 ]]; then
  printf 'canonical Stage1 production backup/rollback validator must pass when exact production split evidence exists and is strict-pass\n' >&2
  exit 1
fi
stage1_prod_backup_rollback_missing_dir="$(mktemp -d)"
set +e
python3 scripts/validate_stage1_production_backup_rollback_evidence.py \
  --backup-evidence "$stage1_prod_backup_rollback_missing_dir/missing-backup-restore.json" \
  --rollback-evidence "$stage1_prod_backup_rollback_missing_dir/missing-rollback-incident-post-deploy-smoke.json" >/dev/null 2>&1
stage1_prod_backup_rollback_missing_status=$?
set -e
if [[ "$stage1_prod_backup_rollback_missing_status" -eq 0 ]]; then
  printf 'Stage1 production backup/rollback validator must not pass when explicit strict evidence paths are missing\n' >&2
  exit 1
fi
stage1_prod_backup_rollback_generator_dir="$(mktemp -d)"
python3 scripts/generate_stage1_production_backup_rollback_evidence.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --backup-evidence "$stage1_prod_backup_rollback_generator_dir/backup-restore.json" \
  --rollback-evidence "$stage1_prod_backup_rollback_generator_dir/rollback-incident-post-deploy-smoke.json" >/dev/null
python3 scripts/validate_stage1_production_backup_rollback_evidence.py \
  --backup-evidence "$stage1_prod_backup_rollback_generator_dir/backup-restore.json" \
  --rollback-evidence "$stage1_prod_backup_rollback_generator_dir/rollback-incident-post-deploy-smoke.json"
stage1_prod_backup_rollback_blocked_generator_dir="$(mktemp -d)"
python3 - "$stage1_prod_backup_rollback_blocked_generator_dir/ci-gate.no-go.json" <<'PY'
import json
import sys
from pathlib import Path

Path(sys.argv[1]).write_text(
    json.dumps(
        {
            "gate_decision": {
                "status": "no_go",
                "blocked_by_checks": ["ci_gate_runtime_execution"],
                "active_do_not_launch_conditions": ["ci_staging_gates_not_passed"],
            }
        },
        indent=2,
        sort_keys=True,
    )
    + "\n",
    encoding="utf-8",
)
PY
set +e
python3 scripts/generate_stage1_production_backup_rollback_evidence.py \
  --release-sha "0123456789abcdef0123456789abcdef01234567" \
  --ci-gate "$stage1_prod_backup_rollback_blocked_generator_dir/ci-gate.no-go.json" \
  --backup-evidence "$stage1_prod_backup_rollback_blocked_generator_dir/backup-restore.json" \
  --rollback-evidence "$stage1_prod_backup_rollback_blocked_generator_dir/rollback-incident-post-deploy-smoke.json" >/dev/null
stage1_prod_backup_rollback_blocked_generator_status=$?
set -e
if [[ "$stage1_prod_backup_rollback_blocked_generator_status" -ne 2 ]]; then
  printf 'production backup/rollback generator must exit 2 and write blocked diagnostics while explicit CI gate evidence is no-go, got %s\n' "$stage1_prod_backup_rollback_blocked_generator_status" >&2
  exit 1
fi
python3 - "$stage1_prod_backup_rollback_blocked_generator_dir/backup-restore.json" "$stage1_prod_backup_rollback_blocked_generator_dir/rollback-incident-post-deploy-smoke.json" <<'PY'
import json
import sys
from pathlib import Path

backup = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rollback = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
for label, evidence in (("backup", backup), ("rollback", rollback)):
    if evidence.get("status") != "blocked":
        raise SystemExit(f"{label} generated diagnostic must stay blocked")
    if evidence.get("canonical_pass_path") is not False:
        raise SystemExit(f"{label} generated diagnostic must not claim canonical pass path")
    if evidence.get("local_devport_debug") is not False or evidence.get("allow_local_devport_evidence") is not False:
        raise SystemExit(f"{label} generated diagnostic must not be local-devport evidence")
    blockers = evidence.get("blocked_checks")
    if not isinstance(blockers, list) or not blockers:
        raise SystemExit(f"{label} generated diagnostic must include blockers")
    joined = " ".join(str(item) for item in blockers)
    if "gate_decision.status is not go" not in joined and "missing CI evidence" not in joined:
        raise SystemExit(f"{label} generated diagnostic must cite upstream gate or CI blockers: {blockers}")
    gate = evidence.get("gate_impact", {})
    if gate.get("preserved_release_gate_check_id") != "production_backup_rollback_incident":
        raise SystemExit(f"{label} generated diagnostic must preserve production backup/rollback gate: {gate}")
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
    raise SystemExit("deterministic release bundle must verify canonical legal-pages split evidence")
if split_inputs.get("canonical_support_contact_external_user_verified") is not True:
    raise SystemExit("deterministic release bundle must verify canonical support-contact split evidence")
if split_inputs.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("deterministic release bundle must use canonical staging legal/support split evidence")
if release_bundle.get("legal_support_visibility_verified") is not True:
    raise SystemExit("deterministic release bundle must verify canonical legal/support visibility")
if release_bundle.get("legal_support_split_reports_verified") is not True:
    raise SystemExit("deterministic release bundle must verify canonical legal/support split reports")
if object_retention.get("status") != "blocked":
    raise SystemExit("deterministic release bundle must keep generated object-retention probe blocked under reserved dry-run inputs")
if split_inputs.get("generated_object_retention_probe_passed") is not False:
    raise SystemExit("deterministic release bundle must surface generated object-retention probe as blocked")
if release_bundle.get("object_retention_cleanup_verified") is not True:
    raise SystemExit("deterministic release bundle must verify canonical object-retention split evidence when canonical staging evidence is strict-pass")
if split_inputs.get("canonical_object_retention_cleanup_verified") is not True:
    raise SystemExit("deterministic release bundle must surface canonical object-retention split evidence as verified")
canonical_probe = release_bundle.get("canonical_object_retention_cleanup_probe", {})
if canonical_probe.get("passed") is not True:
    raise SystemExit(f"canonical object-retention probe must pass once strict staging evidence exists: {canonical_probe}")
if canonical_probe.get("path") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit(f"canonical object-retention probe must cite canonical pass report: {canonical_probe}")
ci_artifacts = {
    item.get("artifact_id"): item
    for item in release_bundle.get("ci_closure_artifacts", [])
    if isinstance(item, dict)
}
if ci_artifacts.get("ci_installed_workflow", {}).get("path") != ".github/workflows/stage0-rev2-ci.yml":
    raise SystemExit("deterministic release bundle must cite exact installed workflow path")
if ci_artifacts.get("ci_pr_main_run", {}).get("path") != "ops/evidence/ci/stage0-rev2-pr-main-run.json":
    raise SystemExit("deterministic release bundle must cite exact CI PR/main run evidence path")
deterministic_ci_blockers = {
    artifact_id
    for artifact_id, artifact in ci_artifacts.items()
    if artifact.get("exists") is not True
}
if release_bundle.get("ci_closure_artifacts_ready") != (not deterministic_ci_blockers):
    raise SystemExit("deterministic release bundle CI closure readiness must reflect exact CI artifacts")
production_split = release_bundle.get("production_backup_rollback_split_preflight", {})
if production_split.get("status") == "blocked_by_upstream_gates":
    if production_split.get("exact_split_files_ready") is not False:
        raise SystemExit("deterministic release bundle must keep production exact split readiness false when upstream gates are blocked")
elif production_split.get("status") == "exact_split_ready_blocked_by_other_production_runtime_items":
    if production_split.get("exact_split_files_ready") is not True:
        raise SystemExit("deterministic release bundle must surface production exact split readiness once split files pass")
else:
    raise SystemExit(f"deterministic release bundle production split status mismatch: {production_split.get('status')}")
if production_split.get("backup_restore_split", {}).get("path") != "ops/evidence/production/backup-restore.json":
    raise SystemExit("deterministic release bundle must cite exact production backup split path")
if production_split.get("rollback_incident_post_deploy_split", {}).get("path") != "ops/evidence/production/rollback-incident-post-deploy-smoke.json":
    raise SystemExit("deterministic release bundle must cite exact production rollback split path")
PY

log "backup/restore drill script syntax"
bash -n scripts/backup_restore_drill.sh
backup_validate_dir="$(mktemp -d)"
DRY_RUN=1 DRILL_DIR="$backup_validate_dir" scripts/backup_restore_drill.sh >/dev/null

log "ops smoke wrappers"
bash -n scripts/playwright_smoke.sh
bash -n scripts/docker_build_smoke.sh
bash -n scripts/staging_smoke.sh
bash -n scripts/azure_staging_run_command_payload.sh
python3 -m py_compile scripts/ingest_azure_run_command_output.py
python3 -m py_compile scripts/sanitize_azure_run_command_output.py
bash -n scripts/azure_staging_cli_preflight.sh
bash -n scripts/azure_staging_run_command_invoke.sh
bash -n scripts/azure_staging_ssh_preflight.sh
bash -n scripts/azure_staging_bootstrap.sh
bash -n scripts/azure_staging_deploy.sh
bash -n scripts/azure_staging_origin_diagnostics.sh
bash -n scripts/azure_staging_origin_repair.sh
bash -n scripts/observability_smoke.sh
bash -n scripts/staging_observability_backup_load_smoke.sh
bash -n scripts/staging_object_storage_signed_url_smoke.sh
bash -n scripts/staging_object_storage_retention_cleanup_smoke.sh
bash -n scripts/staging_legal_support_visibility_smoke.sh
bash -n scripts/stage1_provider_sandbox_smoke.sh
bash -n scripts/stage1_safety_qa_eval_smoke.sh
bash -n scripts/security_scan_smoke.sh
bash -n scripts/release_evidence_bundle_smoke.sh
python3 - <<'PY'
from pathlib import Path

deploy = Path("scripts/azure_staging_deploy.sh").read_text(encoding="utf-8")
preflight = Path("scripts/azure_staging_ssh_preflight.sh").read_text(encoding="utf-8")
bootstrap = Path("scripts/azure_staging_bootstrap.sh").read_text(encoding="utf-8")
doc = Path("ops/release/staging_deploy.md").read_text(encoding="utf-8")
env_example = Path(".env.example").read_text(encoding="utf-8")

for token in (
    "STAGING_SSH_TARGET",
    "STAGING_SSH_KEY",
    "STAGING_REMOTE_DIR",
    "docker compose --profile frontend up -d --build",
    "docker compose run --rm --entrypoint /app/migrate backend",
    "azure_staging_bootstrap.sh",
):
    if token not in deploy:
        raise SystemExit(f"azure staging deploy script missing {token}")
for token in ("tcp_22=reachable", "ssh_auth=failed", "docker_compose", "passwordless_sudo"):
    if token not in preflight:
        raise SystemExit(f"azure staging ssh preflight script missing {token}")
for token in ("apt-get install -y", "docker-compose-plugin", "remote_dir_ready", "docker_access"):
    if token not in bootstrap:
        raise SystemExit(f"azure staging bootstrap script missing {token}")
for token in ("Azure VM Bootstrap", "scripts/azure_staging_ssh_preflight.sh", "scripts/azure_staging_bootstrap.sh", "scripts/azure_staging_deploy.sh", "admin@zenari.ai"):
    if token not in doc:
        raise SystemExit(f"staging deploy doc missing {token}")
for token in ("STAGING_SSH_TARGET=", "STAGING_SSH_KEY=", "STAGING_REMOTE_DIR=", "ADMIN_SESSION_COOKIE=", "STAGING_ADMIN_SESSION_COOKIE="):
    if token not in env_example:
        raise SystemExit(f".env.example missing {token}")
PY

log "stage1 smoke secret-body persistence guards"
secret_guard_dir="$(mktemp -d)"
python3 - scripts/stage1_provider_sandbox_smoke.sh "$secret_guard_dir/provider_append_only.sh" <<'PY'
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text(encoding="utf-8")
helper_start = source.index("has_secret_shape() {")
append_end = source.index("\napi_network_args() {", helper_start)
Path(sys.argv[2]).write_text("set -euo pipefail\n" + source[helper_start:append_end] + "\n", encoding="utf-8")
PY
provider_secret_body="$secret_guard_dir/provider-secret.body"
provider_results="$secret_guard_dir/provider-results.ndjson"
printf 'provider failure includes Bearer providersecretguardtoken123456\n' >"$provider_secret_body"
RESULTS_PATH="$provider_results" bash -c 'source "$0"; append_result adapter_health_probe SELFTEST scripts/openai_compatible_provider_selftest.sh failed 500 provider_http_error req_provider "$1" "chat_completion_chars"' "$secret_guard_dir/provider_append_only.sh" "$provider_secret_body"
python3 - "$provider_results" "$provider_secret_body" <<'PY'
import json
import sys
from pathlib import Path

row = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
body = Path(sys.argv[2]).read_text(encoding="utf-8")
if row.get("secret_leak_detected") is not True:
    raise SystemExit("provider append_result must flag secret-shaped diagnostic bodies")
if row.get("body_path") is not None:
    raise SystemExit("provider append_result must not persist body_path for secret-shaped diagnostics")
if "[redacted secret-bearing response omitted]" not in body:
    raise SystemExit("provider append_result must overwrite secret-shaped diagnostic bodies")
PY

python3 - scripts/stage1_stripe_staging_smoke.sh "$secret_guard_dir/stripe_append_only.sh" <<'PY'
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_text(encoding="utf-8")
helper_start = source.index("has_secret_shape() {")
append_end = source.index("\napi_network_args() {", helper_start)
Path(sys.argv[2]).write_text("set -euo pipefail\n" + source[helper_start:append_end] + "\n", encoding="utf-8")
PY
stripe_secret_body="$secret_guard_dir/stripe-secret.body"
stripe_results="$secret_guard_dir/stripe-results.ndjson"
printf 'stripe failure includes sk_test_%s and t=1234567890,v1=abcdefabcdefabcdef\n' '1234567890abcdef123456' >"$stripe_secret_body"
RESULTS_PATH="$stripe_results" bash -c 'source "$0"; append_result checkout_session_created POST /api/v1/billing/checkout failed 500 stripe_error req_stripe false "$1" "$1"' "$secret_guard_dir/stripe_append_only.sh" "$stripe_secret_body"
python3 - "$stripe_results" "$stripe_secret_body" <<'PY'
import json
import sys
from pathlib import Path

row = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
body = Path(sys.argv[2]).read_text(encoding="utf-8")
if row.get("secret_leak_detected") is not True:
    raise SystemExit("Stripe append_result must flag secret-shaped diagnostic bodies")
if row.get("evidence_ref") is not None:
    raise SystemExit("Stripe append_result must not persist evidence_ref for secret-shaped diagnostics")
if "[redacted secret-bearing response omitted]" not in body:
    raise SystemExit("Stripe append_result must overwrite secret-shaped diagnostic bodies")
PY

ops_validate_dir="$(mktemp -d)"
DRY_RUN=1 OUT_DIR="$ops_validate_dir/playwright" scripts/playwright_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/docker" scripts/docker_build_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/staging" scripts/staging_smoke.sh >/dev/null
DRY_RUN=1 OUT_DIR="$ops_validate_dir/observability" scripts/observability_smoke.sh >/dev/null
set +e
DRY_RUN=1 OUT_DIR="$ops_validate_dir/stage1-safety-qa-dry-run" RUN_ID="stage1-validate-safety-qa-dry-run" scripts/stage1_safety_qa_eval_smoke.sh >/dev/null
stage1_safety_qa_dry_run_status=$?
set -e
if [[ "$stage1_safety_qa_dry_run_status" -ne 2 ]]; then
  printf 'stage1 safety/QA/eval dry-run must exit 2 without runtime evidence, got %s\n' "$stage1_safety_qa_dry_run_status" >&2
  exit 1
fi
python3 - "$ops_validate_dir/stage1-safety-qa-dry-run/stage1-safety-qa-eval.json" "$ops_validate_dir/stage1-safety-qa-dry-run/stage1-safety-qa-eval.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("stage1 safety/QA/eval dry-run must remain blocked")
if report.get("local_devport_debug") is not False:
    raise SystemExit("stage1 safety/QA/eval dry-run must not be marked local-devport debug")
row_reasons = {row.get("reason") for row in rows}
if row_reasons not in ({"dry_run_no_staging_runtime_probe"}, {"missing_staging_api_url"}):
    raise SystemExit(f"stage1 safety/QA/eval dry-run rows must cite blocked dry-run/runtime-input reason: {rows}")
if {row.get("status") for row in rows} != {"blocked"}:
    raise SystemExit(f"stage1 safety/QA/eval dry-run rows must all be blocked: {rows}")
PY
set +e
DRY_RUN=1 OUT_DIR="$ops_validate_dir/stage1-stripe-dry-run" RUN_ID="stage1-validate-stripe-dry-run" scripts/stage1_stripe_staging_smoke.sh >/dev/null
stage1_stripe_dry_run_status=$?
set -e
if [[ "$stage1_stripe_dry_run_status" -ne 2 ]]; then
  printf 'stage1 Stripe dry-run must exit 2 without runtime evidence, got %s\n' "$stage1_stripe_dry_run_status" >&2
  exit 1
fi
python3 - "$ops_validate_dir/stage1-stripe-dry-run/stripe-test-checkout-webhook.json" "$ops_validate_dir/stage1-stripe-dry-run/stripe-test-checkout-webhook.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("stage1 Stripe dry-run must remain blocked")
if report.get("local_devport_debug") is not False:
    raise SystemExit("stage1 Stripe dry-run must not be marked local-devport debug")
allowed_reasons = {"dry_run_no_staging_stripe_probe", "production_like_staging_url_required"}
blocked_checks = report.get("blocked_checks")
row_reasons = {row.get("reason") for row in rows}
if not isinstance(blocked_checks, list) or len(blocked_checks) != 1 or blocked_checks[0] not in allowed_reasons:
    raise SystemExit(f"stage1 Stripe dry-run blocker mismatch: {report.get('blocked_checks')}")
if len(row_reasons) != 1 or not row_reasons <= allowed_reasons:
    raise SystemExit(f"stage1 Stripe dry-run rows must cite blocked dry-run/runtime-input reason: {rows}")
if blocked_checks[0] not in row_reasons:
    raise SystemExit(f"stage1 Stripe dry-run report and row blockers must match: {blocked_checks} vs {row_reasons}")
if {row.get("status") for row in rows} != {"blocked"}:
    raise SystemExit(f"stage1 Stripe dry-run rows must all be blocked: {rows}")
PY
stage1_stripe_fixture_dir="$ops_validate_dir/stage1-stripe-local-fixture"
mkdir -p "$stage1_stripe_fixture_dir"
python3 - "$stage1_stripe_fixture_dir/stripe-test-checkout-webhook.local-devport.json" "$stage1_stripe_fixture_dir/stripe-test-checkout-webhook.local-devport.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
run_id = "stage1-validate-stripe-local-fixture"
tenant = "tenant_1"
user = "user_1"
plan = "plan_pro"
subscription = "sub_test_fixture"
invoice = "in_test_fixture"
checkout = "cs_test_fixture"


def base(scenario_id):
    return {
        "scenario_id": scenario_id,
        "status": "passed",
        "livemode": False,
        "request_id": f"{run_id}-{scenario_id}",
        "secret_leak_detected": False,
    }


scenarios = [
    {
        **base("checkout_session_created"),
        "checkout_session": {
            "id": checkout,
            "url": "https://checkout.stripe.test/session/cs_test_fixture",
            "livemode": False,
            "mode": "subscription",
            "metadata": {"tenant_id": tenant, "user_id": user, "plan_id": plan},
            "idempotency_key": f"{run_id}-checkout_session_created",
        },
    },
    {
        **base("checkout_completed_paid"),
        "event": {"id": "evt_checkout_fixture", "type": "checkout.session.completed", "livemode": False},
        "subscription": {"id": subscription, "provider_ref": subscription, "plan_id": plan, "status": "active"},
    },
    {
        **base("invoice_paid"),
        "event": {"id": "evt_invoice_paid_fixture", "type": "invoice.paid", "livemode": False},
        "subscription": {"id": subscription, "provider_ref": subscription, "plan_id": plan, "status": "active"},
        "invoice": {
            "id": invoice,
            "status": "paid",
            "livemode": False,
            "hosted_invoice_url": "https://billing.stripe.test/invoice",
            "invoice_pdf": "https://billing.stripe.test/invoice.pdf",
        },
    },
    {
        **base("invoice_payment_failed"),
        "event": {"id": "evt_payment_failed_fixture", "type": "invoice.payment_failed", "livemode": False},
        "subscription": {"id": subscription, "provider_ref": subscription, "plan_id": plan, "status": "past_due"},
        "account_projection": {"subscription_status": "past_due"},
    },
    {
        **base("cancel_at_period_end"),
        "subscription": {
            "id": subscription,
            "livemode": False,
            "status": "active",
            "cancel_at_period_end": True,
            "current_period_end": "staging-runtime",
        },
        "account_projection": {"cancel_at_period_end": True},
    },
    {
        **base("subscription_cancelled"),
        "event": {"id": "evt_cancelled_fixture", "type": "customer.subscription.deleted", "livemode": False},
        "subscription": {"id": subscription, "provider_ref": subscription, "plan_id": plan, "status": "cancelled"},
        "account_projection": {"subscription_status": "cancelled"},
    },
    {
        **base("refund_credit"),
        "refund": {"id": "refund_test_manual", "status": "succeeded", "livemode": False},
        "admin_operation": {"operation": "refund_note", "idempotency_key": f"{run_id}-refund_credit"},
        "quota_credit": {"transaction_id": "quota-credit-fixture", "units": 25},
    },
    {
        **base("webhook_replay_idempotency"),
        "event": {"id": "evt_checkout_fixture", "type": "checkout.session.completed", "livemode": False},
        "replay_attempted": True,
        "first_delivery_mutations": 1,
        "replay_delivery_mutations": 0,
        "duplicate_mutation_count": 0,
        "idempotency_verified": True,
    },
    {
        **base("quota_projection"),
        "quota": {
            "bucket_id": "bucket_1",
            "limit_units": 125,
            "used_units": 0,
            "reserved_units": 0,
            "transactions": [{"id": "quota-credit-fixture", "kind": "manual_credit", "units": 25}],
        },
    },
    {
        **base("invoice_receipt_visibility"),
        "invoice": {
            "id": invoice,
            "livemode": False,
            "hosted_invoice_url": "https://billing.stripe.test/invoice",
            "invoice_pdf": "https://billing.stripe.test/invoice.pdf",
        },
        "ui_projection": {"invoice_visible": True, "receipt_visible": True, "secret_visible": False},
    },
]
with results_path.open("w", encoding="utf-8") as fh:
    for item in scenarios:
        fh.write(json.dumps({key: item[key] for key in ("scenario_id", "status", "livemode", "request_id", "secret_leak_detected")}, sort_keys=True) + "\n")
report = {
    "schema_version": "stage1.stripe_staging_lifecycle.v1",
    "environment": "staging",
    "kind": "stripe_test_checkout_webhook",
    "status": "blocked",
    "stripe_mode": "test",
    "livemode": False,
    "evidence_id": run_id,
    "release_sha": "",
    "api_url": "http://127.0.0.1:31080",
    "web_url": "http://127.0.0.1:26080",
    "results_path": str(results_path),
    "local_devport_debug": True,
    "use_dev_identity_headers": True,
    "blocked_checks": ["local_devport_debug_evidence_cannot_clear_staging_gate"],
    "secret_material_present": True,
    "secret_material_persisted": False,
    "raw_webhook_secret_persisted": False,
    "raw_stripe_key_persisted": False,
    "webhook_signature_persisted": False,
    "raw_stripe_payload_persisted": False,
    "runtime_input_readiness": {
        "staging_api_url_ready": True,
        "user_auth_ready": True,
        "admin_auth_ready": True,
        "csrf_ready": True,
        "stripe_cli_ready": True,
        "webhook_forwarding_ready": True,
        "allow_local_devport_evidence": True,
        "use_dev_identity_headers": True,
        "canonical_pass_path": False,
    },
    "scenarios": scenarios,
    "summary": {
        "checkout_created": True,
        "webhook_replay_idempotent": True,
        "refund_credit_reconciled": True,
        "invoice_receipt_visible": True,
        "subscription_statuses": ["active", "past_due", "cancel_at_period_end", "cancelled"],
    },
    "probe_contract": {
        "canonical_pass_report": "ops/evidence/staging/stripe-test-checkout-webhook.json",
        "canonical_pass_results": "ops/evidence/staging/stripe-test-checkout-webhook.ndjson",
        "local_devport_report": "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.json",
        "local_devport_results": "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.ndjson",
        "allow_local_devport_evidence_env": "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only Stripe evidence under ops/evidence/staging/local-devport/ and cannot clear staging gates",
        "production_like_local_fixture_command": "API_URL=https://zenari-staging.example.test:<port> API_URL_RESOLVE_ADDR=127.0.0.1 API_URL_CA_CERT=<self-signed-ca.pem> WEB_URL=https://zenari-staging.example.test:<web-port> WEB_URL_RESOLVE_ADDR=127.0.0.1 WEB_URL_CA_CERT=<self-signed-ca.pem> ADMIN_URL=https://zenari-staging.example.test:<admin-port> ADMIN_URL_RESOLVE_ADDR=127.0.0.1 ADMIN_URL_CA_CERT=<self-signed-ca.pem> ALLOW_LOCAL_DEVPORT_EVIDENCE=1 USE_DEV_IDENTITY_HEADERS=1 scripts/stage1_stripe_staging_smoke.sh",
    },
    "gate_impact": {
        "can_clear_stripe_staging_gate": False,
        "preserved_release_gate_check_id": "stage1_stripe_test_checkout_webhook",
        "preserved_do_not_launch_condition_id": "stripe_staging_lifecycle_runtime_missing",
        "remaining_blockers": ["local-devport debug evidence cannot clear canonical staging Stripe gate"],
    },
}
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_stripe_staging_evidence.py \
  --allow-local-devport \
  --evidence "$stage1_stripe_fixture_dir/stripe-test-checkout-webhook.local-devport.json" \
  --results "$stage1_stripe_fixture_dir/stripe-test-checkout-webhook.local-devport.ndjson" >/dev/null
python3 - "$stage1_stripe_fixture_dir/stripe-test-checkout-webhook.local-devport.json" "$stage1_stripe_fixture_dir/stripe-test-checkout-webhook.local-devport.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("stage1 Stripe local-devport fixture must stay blocked")
if report.get("local_devport_debug") is not True:
    raise SystemExit("stage1 Stripe local-devport fixture must mark debug evidence")
if report.get("blocked_checks") != ["local_devport_debug_evidence_cannot_clear_staging_gate"]:
    raise SystemExit(f"local-devport Stripe fixture should only be blocked by debug gate policy: {report.get('blocked_checks')}")
if report.get("gate_impact", {}).get("can_clear_stripe_staging_gate") is not False:
    raise SystemExit("local-devport Stripe fixture cannot clear Stripe staging gate")
if report.get("gate_impact", {}).get("preserved_release_gate_check_id") != "stage1_stripe_test_checkout_webhook":
    raise SystemExit("local-devport Stripe fixture must preserve Stripe release gate")
if {row.get("status") for row in rows} != {"passed"}:
    raise SystemExit(f"local-devport Stripe fixture must prove runtime rows passed: {rows}")
probe_contract = report.get("probe_contract", {})
if probe_contract.get("local_devport_report") != "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.json":
    raise SystemExit(f"probe contract must name local-devport Stripe report path: {probe_contract}")
if probe_contract.get("local_devport_results") != "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.ndjson":
    raise SystemExit(f"probe contract must name local-devport Stripe results path: {probe_contract}")
if "cannot clear staging gates" not in probe_contract.get("allow_local_devport_evidence_env", ""):
    raise SystemExit("probe contract must state local-devport Stripe evidence cannot clear staging gates")
fixture_command = probe_contract.get("production_like_local_fixture_command", "")
for token in ("API_URL_RESOLVE_ADDR=127.0.0.1", "API_URL_CA_CERT=<self-signed-ca.pem>", "WEB_URL_RESOLVE_ADDR=127.0.0.1", "WEB_URL_CA_CERT=<self-signed-ca.pem>", "ADMIN_URL_RESOLVE_ADDR=127.0.0.1", "ADMIN_URL_CA_CERT=<self-signed-ca.pem>"):
    if token not in fixture_command:
        raise SystemExit(f"probe contract must document production-like HTTPS fixture token {token}: {probe_contract}")
PY
stage1_safety_qa_fixture_dir="$ops_validate_dir/stage1-safety-qa-local-fixture"
mkdir -p "$stage1_safety_qa_fixture_dir"
cat >"$stage1_safety_qa_fixture_dir/server.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import ssl


class Handler(BaseHTTPRequestHandler):
    def _write(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Request-ID", self.headers.get("X-Request-ID", ""))
        self.end_headers()
        payload = {
            "ok": True,
            "path": self.path,
            "audit_ref": "audit-stage1-safety-qa-fixture",
            "review_reason": "safety_review_required",
            "quota_refunded_units": 1,
            "download_enabled": False,
        }
        self.wfile.write(json.dumps(payload, sort_keys=True).encode())

    def do_GET(self):
        self._write(200)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length:
            self.rfile.read(length)
        self._write(200)

    def log_message(self, _fmt, *_args):
        pass


server = HTTPServer(("127.0.0.1", 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(os.environ["STAGE1_SAFETY_QA_FIXTURE_CERT"], os.environ["STAGE1_SAFETY_QA_FIXTURE_KEY"])
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_port, flush=True)
server.serve_forever()
PY
stage1_safety_qa_fixture_host="zenari-staging.example.test"
stage1_safety_qa_fixture_cert="$stage1_safety_qa_fixture_dir/$stage1_safety_qa_fixture_host.crt"
stage1_safety_qa_fixture_key="$stage1_safety_qa_fixture_dir/$stage1_safety_qa_fixture_host.key"
openssl req -x509 -newkey rsa:2048 -sha256 -days 1 -nodes \
  -subj "/CN=$stage1_safety_qa_fixture_host" \
  -addext "subjectAltName=DNS:$stage1_safety_qa_fixture_host" \
  -keyout "$stage1_safety_qa_fixture_key" \
  -out "$stage1_safety_qa_fixture_cert" >/dev/null 2>&1
STAGE1_SAFETY_QA_FIXTURE_CERT="$stage1_safety_qa_fixture_cert" \
  STAGE1_SAFETY_QA_FIXTURE_KEY="$stage1_safety_qa_fixture_key" \
  python3 "$stage1_safety_qa_fixture_dir/server.py" >"$stage1_safety_qa_fixture_dir/port" 2>"$stage1_safety_qa_fixture_dir/server.log" &
stage1_safety_qa_server_pid=$!
for _ in {1..50}; do
  if [[ -s "$stage1_safety_qa_fixture_dir/port" ]]; then
    break
  fi
  sleep 0.1
done
if [[ ! -s "$stage1_safety_qa_fixture_dir/port" ]]; then
  stop_temp_servers "$stage1_safety_qa_server_pid"
  printf 'failed to start local safety/QA fixture server\n' >&2
  cat "$stage1_safety_qa_fixture_dir/server.log" >&2 || true
  exit 1
fi
stage1_safety_qa_port="$(cat "$stage1_safety_qa_fixture_dir/port")"
for _ in {1..50}; do
  if curl --silent --show-error --max-time 1 \
    --cacert "$stage1_safety_qa_fixture_cert" \
    --resolve "$stage1_safety_qa_fixture_host:$stage1_safety_qa_port:127.0.0.1" \
    --noproxy "$stage1_safety_qa_fixture_host" \
    "https://$stage1_safety_qa_fixture_host:$stage1_safety_qa_port/api/v1/batch-generations/batch_fixture/children" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! curl --silent --show-error --max-time 1 \
  --cacert "$stage1_safety_qa_fixture_cert" \
  --resolve "$stage1_safety_qa_fixture_host:$stage1_safety_qa_port:127.0.0.1" \
  --noproxy "$stage1_safety_qa_fixture_host" \
  "https://$stage1_safety_qa_fixture_host:$stage1_safety_qa_port/api/v1/batch-generations/batch_fixture/children" >/dev/null 2>&1; then
  stop_temp_servers "$stage1_safety_qa_server_pid"
  printf 'stage1 safety/QA HTTPS fixture did not become reachable\n' >&2
  cat "$stage1_safety_qa_fixture_dir/server.log" >&2 || true
  exit 1
fi
set +e
ALLOW_LOCAL_DEVPORT_EVIDENCE=1 \
  USE_DEV_IDENTITY_HEADERS=1 \
  API_URL="https://$stage1_safety_qa_fixture_host:$stage1_safety_qa_port" \
  API_URL_RESOLVE_ADDR="127.0.0.1" \
  API_URL_CA_CERT="$stage1_safety_qa_fixture_cert" \
  WEB_URL="https://$stage1_safety_qa_fixture_host:$stage1_safety_qa_port" \
  WEB_URL_RESOLVE_ADDR="127.0.0.1" \
  WEB_URL_CA_CERT="$stage1_safety_qa_fixture_cert" \
  ADMIN_URL="https://$stage1_safety_qa_fixture_host:$stage1_safety_qa_port" \
  ADMIN_URL_RESOLVE_ADDR="127.0.0.1" \
  ADMIN_URL_CA_CERT="$stage1_safety_qa_fixture_cert" \
  BATCH_ID="batch_fixture" \
  EXPORT_ID="export_fixture" \
  PACKAGE_ID="package_fixture" \
  OUT_DIR="$stage1_safety_qa_fixture_dir/out" \
  RUN_ID="stage1-validate-safety-qa-local-fixture" \
  scripts/stage1_safety_qa_eval_smoke.sh >/dev/null
stage1_safety_qa_local_status=$?
set -e
stop_temp_servers "$stage1_safety_qa_server_pid"
if [[ "$stage1_safety_qa_local_status" -ne 2 ]]; then
  printf 'stage1 safety/QA/eval local-devport fixture must exit 2 because debug evidence cannot close the staging gate, got %s\n' "$stage1_safety_qa_local_status" >&2
  exit 1
fi
python3 - "$stage1_safety_qa_fixture_dir/out/stage1-safety-qa-eval.json" "$stage1_safety_qa_fixture_dir/out/stage1-safety-qa-eval.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("stage1 safety/QA/eval local-devport fixture must stay blocked")
if report.get("local_devport_debug") is not True:
    raise SystemExit("stage1 safety/QA/eval local-devport fixture must mark debug evidence")
if report.get("blocked_checks") != ["local_devport_debug_evidence_cannot_clear_staging_gate"]:
    raise SystemExit(f"local-devport safety/QA fixture should only be blocked by debug gate policy: {report.get('blocked_checks')}")
if report.get("runtime_input_readiness", {}).get("allow_local_devport_evidence") is not True:
    raise SystemExit("local-devport safety/QA fixture must expose allow_local_devport_evidence readiness")
if report.get("runtime_input_readiness", {}).get("canonical_pass_path") is not False:
    raise SystemExit("local-devport safety/QA fixture must not claim canonical pass path")
if report.get("gate_impact", {}).get("can_clear_stage1_safety_qa_gate") is not False:
    raise SystemExit("local-devport safety/QA fixture cannot clear stage1 safety/QA gate")
if report.get("gate_impact", {}).get("preserved_release_gate_check_id") != "stage1_safety_qa_eval":
    raise SystemExit("local-devport safety/QA fixture must preserve stage1 safety/QA release gate")
if {row.get("status") for row in rows} != {"passed"}:
    raise SystemExit(f"local-devport safety/QA fixture must prove runtime rows passed: {rows}")
probe_contract = report.get("probe_contract", {})
if probe_contract.get("local_devport_report") != "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.json":
    raise SystemExit(f"probe contract must name local-devport safety/QA report path: {probe_contract}")
if probe_contract.get("local_devport_results") != "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.ndjson":
    raise SystemExit(f"probe contract must name local-devport safety/QA results path: {probe_contract}")
if "cannot clear staging gates" not in probe_contract.get("allow_local_devport_evidence_env", ""):
    raise SystemExit("probe contract must state local-devport safety/QA evidence cannot clear staging gates")
fixture_command = probe_contract.get("production_like_local_fixture_command", "")
for token in ("API_URL_RESOLVE_ADDR=127.0.0.1", "API_URL_CA_CERT=<self-signed-ca.pem>", "WEB_URL_RESOLVE_ADDR=127.0.0.1", "WEB_URL_CA_CERT=<self-signed-ca.pem>", "ADMIN_URL_RESOLVE_ADDR=127.0.0.1", "ADMIN_URL_CA_CERT=<self-signed-ca.pem>"):
    if token not in fixture_command:
        raise SystemExit(f"probe contract must document production-like HTTPS fixture token {token}: {probe_contract}")
PY
stage1_provider_fixture_dir="$ops_validate_dir/stage1-provider-local-fixture"
mkdir -p "$stage1_provider_fixture_dir"
cat >"$stage1_provider_fixture_dir/server.py" <<'PY'
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
import ssl


class Handler(BaseHTTPRequestHandler):
    def _write(self, payload, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("X-Request-ID", self.headers.get("X-Request-ID", ""))
        self.end_headers()
        self.wfile.write(json.dumps(payload, sort_keys=True).encode())

    def do_GET(self):
        if self.path.endswith("/models"):
            self._write({"object": "list", "data": [{"id": "glm-5.2", "object": "model"}]})
        elif self.path == "/api/admin/v1/providers/registry":
            self._write({
                "items": [{
                    "provider_id": "zenari-image-sandbox",
                    "adapter": "openai-compatible",
                    "status": "enabled",
                    "secret_ref": "secrets/provider/zenari-image-sandbox",
                    "routing": {"kill_switch": False},
                    "capabilities": [{
                        "provider_id": "zenari-image-sandbox",
                        "model_id": "glm-5.2",
                        "tool_types": ["generate"],
                        "endpoints": ["image.generate"],
                    }],
                }]
            })
        elif self.path.endswith("/progress"):
            batch_id = self.path.split("/")[-2]
            self._write({
                "batch_id": batch_id,
                "status": "failed",
                "requested_count": 1,
                "succeeded": 0,
                "failed": 1,
                "blocked": 0,
                "queued": 0,
                "running": 0,
                "retryable": 0,
            })
        elif self.path.endswith("/children"):
            self._write({
                "items": [{
                    "id": "child_provider_quota_fixture",
                    "status": "failed",
                    "provider_id": "zenari-image-sandbox",
                    "model_id": "glm-5.2",
                    "failure_code": "provider_quota_unavailable",
                    "failure_message": "provider quota unavailable",
                    "metadata": {
                        "failure_kind": "provider_invoke_failed",
                        "provider_error_code": "provider_quota_unavailable",
                        "provider_http_status": "429",
                        "provider_code": "1113",
                        "retryable": False,
                    },
                }]
            })
        else:
            self._write({"ok": True, "path": self.path})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length:
            self.rfile.read(length)
        if self.path.endswith("/chat/completions"):
            self._write({
                "id": "chatcmpl_provider_fixture",
                "object": "chat.completion",
                "model": "glm-5.2",
                "choices": [{
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": "Zenari OpenAI-compatible provider connectivity is ready.",
                    },
                }],
            }, status=200)
        elif self.path.endswith("/test-call"):
            self._write({"status": "succeeded", "prompt_hash": "sha256:provider-fixture"}, status=201)
        elif self.path.endswith("/batch-generations"):
            self._write({
                "id": "batch_provider_quota_fixture",
                "provider_id": "zenari-image-sandbox",
                "children": [{
                    "id": "child_provider_quota_fixture",
                    "provider_id": "zenari-image-sandbox",
                    "model_id": "glm-5.2",
                    "status": "queued",
                }],
            }, status=201)
        else:
            self._write({"ok": True, "path": self.path}, status=201)

    def do_PATCH(self):
        length = int(self.headers.get("Content-Length", "0") or "0")
        if length:
            self.rfile.read(length)
        self._write({"provider_id": "zenari-image-sandbox", "model_id": "glm-5.2", "status": "enabled"})

    def log_message(self, _fmt, *_args):
        pass


server = HTTPServer(("127.0.0.1", 0), Handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(os.environ["STAGE1_PROVIDER_FIXTURE_CERT"], os.environ["STAGE1_PROVIDER_FIXTURE_KEY"])
server.socket = context.wrap_socket(server.socket, server_side=True)
print(server.server_port, flush=True)
server.serve_forever()
PY
	stage1_provider_fixture_host="zenari-staging.example.test"
	stage1_provider_fixture_cert="$stage1_provider_fixture_dir/$stage1_provider_fixture_host.crt"
	stage1_provider_fixture_key="$stage1_provider_fixture_dir/$stage1_provider_fixture_host.key"
	openssl req -x509 -newkey rsa:2048 -sha256 -days 1 -nodes \
	  -subj "/CN=$stage1_provider_fixture_host" \
	  -addext "subjectAltName=DNS:$stage1_provider_fixture_host" \
	  -keyout "$stage1_provider_fixture_key" \
	  -out "$stage1_provider_fixture_cert" >/dev/null 2>&1
	STAGE1_PROVIDER_FIXTURE_CERT="$stage1_provider_fixture_cert" \
	  STAGE1_PROVIDER_FIXTURE_KEY="$stage1_provider_fixture_key" \
	  python3 "$stage1_provider_fixture_dir/server.py" >"$stage1_provider_fixture_dir/port" 2>"$stage1_provider_fixture_dir/server.log" &
	stage1_provider_server_pid=$!
for _ in {1..50}; do
  if [[ -s "$stage1_provider_fixture_dir/port" ]]; then
    break
  fi
  sleep 0.1
done
if [[ ! -s "$stage1_provider_fixture_dir/port" ]]; then
  stop_temp_servers "$stage1_provider_server_pid"
  printf 'failed to start local provider fixture server\n' >&2
  cat "$stage1_provider_fixture_dir/server.log" >&2 || true
  exit 1
	fi
	stage1_provider_port="$(cat "$stage1_provider_fixture_dir/port")"
	for _ in {1..50}; do
	  if curl --silent --show-error --max-time 1 \
	    --cacert "$stage1_provider_fixture_cert" \
	    --resolve "$stage1_provider_fixture_host:$stage1_provider_port:127.0.0.1" \
	    --noproxy "$stage1_provider_fixture_host" \
	    "https://$stage1_provider_fixture_host:$stage1_provider_port/models" >/dev/null 2>&1; then
	    break
	  fi
	  sleep 0.1
	done
	if ! curl --silent --show-error --max-time 1 \
	  --cacert "$stage1_provider_fixture_cert" \
	  --resolve "$stage1_provider_fixture_host:$stage1_provider_port:127.0.0.1" \
	  --noproxy "$stage1_provider_fixture_host" \
	  "https://$stage1_provider_fixture_host:$stage1_provider_port/models" >/dev/null 2>&1; then
	  stop_temp_servers "$stage1_provider_server_pid"
	  printf 'stage1 provider HTTPS fixture did not become reachable\n' >&2
	  cat "$stage1_provider_fixture_dir/server.log" >&2 || true
	  exit 1
	fi
	set +e
	ALLOW_LOCAL_DEVPORT_EVIDENCE=1 \
	  USE_DEV_IDENTITY_HEADERS=1 \
	  API_URL="https://$stage1_provider_fixture_host:$stage1_provider_port" \
	  API_URL_RESOLVE_ADDR="127.0.0.1" \
	  API_URL_CA_CERT="$stage1_provider_fixture_cert" \
	  LLM_OPENAI_BASE_URL="https://$stage1_provider_fixture_host:$stage1_provider_port" \
	  LLM_OPENAI_RESOLVE_ADDR="127.0.0.1" \
	  LLM_OPENAI_CA_CERT="$stage1_provider_fixture_cert" \
	  LLM_OPENAI_API_KEY="fixture-non-secret-token" \
	  LLM_OPENAI_MODEL="glm-5.2" \
	  MODEL_ID="glm-5.2" \
	  USER_MODEL_ID="glm-5.2" \
	  LLM_ENABLE_LIVE_CALLS=true \
	  WORKER_BATCH_ENABLED=true \
	  CSRF_ORIGIN="https://$stage1_provider_fixture_host:$stage1_provider_port" \
	  PROJECT_ID="project_fixture" \
	  WORKSPACE_ID="workspace_fixture" \
  OUT_DIR="$stage1_provider_fixture_dir/out" \
  RUN_ID="stage1-validate-provider-local-fixture" \
  POLL_ATTEMPTS=1 \
  POLL_INTERVAL_SECONDS=0 \
  scripts/stage1_provider_sandbox_smoke.sh >/dev/null
stage1_provider_local_status=$?
set -e
stop_temp_servers "$stage1_provider_server_pid"
if [[ "$stage1_provider_local_status" -ne 2 ]]; then
  printf 'stage1 provider sandbox local-devport fixture must exit 2 because provider failure/debug evidence cannot close the staging gate, got %s\n' "$stage1_provider_local_status" >&2
  exit 1
fi
python3 - "$stage1_provider_fixture_dir/out/stage1-provider-sandbox.json" "$stage1_provider_fixture_dir/out/stage1-provider-sandbox.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("stage1 provider local-devport fixture must stay blocked")
if report.get("local_devport_debug") is not True:
    raise SystemExit("stage1 provider local-devport fixture must mark debug evidence")
blocked = report.get("blocked_checks", [])
if "batch_children:provider_child_failure:provider_quota_unavailable" not in blocked:
    raise SystemExit(f"provider fixture must expose quota blocker: {blocked}")
if report.get("gate_impact", {}).get("can_clear_provider_sandbox_gate") is not False:
    raise SystemExit("provider local-devport fixture cannot clear provider sandbox gate")
if report.get("gate_impact", {}).get("preserved_release_gate_check_id") != "stage1_provider_sandbox":
    raise SystemExit("provider local-devport fixture must preserve provider sandbox release gate")
batch = report.get("batch_runtime", {})
failures = batch.get("provider_child_failures")
if not isinstance(failures, list) or not failures:
    raise SystemExit(f"provider fixture must include provider_child_failures: {batch}")
failure = failures[0]
if failure.get("provider_http_status") != "429" or failure.get("provider_code") != "1113":
    raise SystemExit(f"provider fixture must retain provider quota diagnostics: {failure}")
if batch.get("succeeded_children") != 0 or batch.get("asset_id") or batch.get("canvas_object_id") or batch.get("usage_units") != 0:
    raise SystemExit(f"provider failure fixture must not claim generated asset/canvas/usage: {batch}")
if rows[-1].get("check_id") != "batch_children" or rows[-1].get("status") != "failed":
    raise SystemExit(f"provider fixture must keep failed batch_children diagnostic row: {rows[-1]}")
probe_contract = report.get("probe_contract", {})
if probe_contract.get("local_devport_report") != "ops/evidence/staging/local-devport/stage1-provider-sandbox.local-devport.json":
    raise SystemExit(f"probe contract must name local-devport provider report path: {probe_contract}")
if probe_contract.get("local_devport_results") != "ops/evidence/staging/local-devport/stage1-provider-sandbox.local-devport.ndjson":
    raise SystemExit(f"probe contract must name local-devport provider results path: {probe_contract}")
if probe_contract.get("provider_failure_blocker_prefix") != "batch_children:provider_child_failure:":
    raise SystemExit(f"probe contract must name provider failure blocker prefix: {probe_contract}")
fixture_command = probe_contract.get("production_like_local_fixture_command", "")
for token in ("API_URL_RESOLVE_ADDR=127.0.0.1", "API_URL_CA_CERT=<self-signed-ca.pem>", "LLM_OPENAI_RESOLVE_ADDR=127.0.0.1", "LLM_OPENAI_CA_CERT=<self-signed-ca.pem>"):
    if token not in fixture_command:
        raise SystemExit(f"probe contract must document production-like HTTPS fixture token {token}: {probe_contract}")
PY
set +e
OUT_DIR="$ops_validate_dir/staging-observability-backup-load" scripts/staging_observability_backup_load_smoke.sh >/dev/null
staging_obl_status=$?
set -e
if [[ "$staging_obl_status" -ne 2 ]]; then
  printf 'staging observability/backup/load preflight must exit 2 with missing evidence, got %s\n' "$staging_obl_status" >&2
  exit 1
fi
RUN_ID="stage0-validate-object-storage-signed-url" OUT_DIR="$ops_validate_dir/object-storage" scripts/staging_object_storage_signed_url_smoke.sh >/dev/null
before_default_retention_sha="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/object-storage-retention-cleanup.blocked.json"),
    Path("ops/evidence/staging/object-storage-retention-cleanup.blocked.ndjson"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
set +e
DRY_RUN=1 scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
default_object_retention_status=$?
set -e
if [[ "$default_object_retention_status" -ne 2 ]]; then
  printf 'default staging object-storage retention cleanup dry-run must exit 2 without runtime evidence, got %s\n' "$default_object_retention_status" >&2
  exit 1
fi
after_default_retention_sha="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/object-storage-retention-cleanup.blocked.json"),
    Path("ops/evidence/staging/object-storage-retention-cleanup.blocked.ndjson"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
if [[ "$before_default_retention_sha" != "$after_default_retention_sha" ]]; then
  printf 'default staging object-storage retention cleanup dry-run must not mutate checked-in blocked evidence\n' >&2
  exit 1
fi
object_retention_reserved_candidate="ops/evidence/staging/stage0-validate-object-retention-reserved-canonical-write.candidate.json"
object_retention_reserved_candidate_results="ops/evidence/staging/stage0-validate-object-retention-reserved-canonical-write.candidate.ndjson"
object_retention_canonical_before="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/object-storage-retention-cleanup.json"),
    Path("ops/evidence/staging/object-storage-retention-cleanup.ndjson"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(str(path.exists()).encode("utf-8"))
    if path.exists():
        digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
rm -f "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results"
set +e
RUN_ID="stage0-validate-object-retention-reserved-canonical-write" \
  WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE=1 \
  BASE_URL="https://zenari-staging.example.test" \
  RELEASE_SHA="d3b1107c33dc40b8936f28549e06553fbd7b104a" \
  ADMIN_BEARER_TOKEN="stage0-local-fixture" \
  SMOKE_ADMIN_USER_ID="admin-ops" \
  SMOKE_ADMIN_TENANT_ID="tenant-alpha" \
  CSRF_ORIGIN="https://zenari-staging.example.test" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_reserved_candidate_status=$?
set -e
if [[ "$object_retention_reserved_candidate_status" -ne 2 ]]; then
  rm -f "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results"
  printf 'reserved test-domain object-retention canonical-write request must exit 2, got %s\n' "$object_retention_reserved_candidate_status" >&2
  exit 1
fi
object_retention_canonical_after="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/object-storage-retention-cleanup.json"),
    Path("ops/evidence/staging/object-storage-retention-cleanup.ndjson"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(str(path.exists()).encode("utf-8"))
    if path.exists():
        digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
if [[ "$object_retention_canonical_before" != "$object_retention_canonical_after" ]]; then
  rm -f "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results"
  printf 'reserved test-domain object-retention canonical-write request must not mutate canonical pass evidence\n' >&2
  exit 1
fi
python3 - "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
if not report_path.exists() or not results_path.exists():
    raise SystemExit("reserved canonical-write request must write candidate diagnostics")
report = json.loads(report_path.read_text(encoding="utf-8"))
rows = [json.loads(line) for line in results_path.read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit(f"reserved canonical-write candidate must stay blocked: {report.get('status')}")
if report.get("input_readiness", {}).get("canonical_write_requested") is not True:
    raise SystemExit("reserved canonical-write candidate must record the explicit canonical write request")
if report.get("input_readiness", {}).get("production_like_staging_targets") is not False:
    raise SystemExit("reserved canonical-write candidate must reject reserved test-domain staging targets")
if report.get("split_evidence", {}).get("canonical_pass_paths") is not False:
    raise SystemExit("reserved canonical-write candidate must not claim canonical pass paths")
if report.get("gate_impact", {}).get("can_clear_release_gate_check") is not False:
    raise SystemExit("reserved canonical-write candidate must not clear the release gate")
probe_contract = report.get("probe_contract", {})
if probe_contract.get("pass_evidence_written_only_after_strict_validator_accepts") is not True:
    raise SystemExit("reserved canonical-write candidate must require strict validator acceptance before pass writes")
if probe_contract.get("canonical_outputs_are_atomic") is not True:
    raise SystemExit("reserved canonical-write candidate must require atomic canonical output replacement")
if probe_contract.get("failed_strict_candidate_writes_blocked_evidence_only") is not True:
    raise SystemExit("reserved canonical-write candidate must keep rejected candidates blocked-only")
if {row.get("reason") for row in rows} != {"production_like_staging_url_required"}:
    raise SystemExit(f"reserved canonical-write rows must be blocked by target policy: {rows}")
PY
rm -f "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results"
rm -f "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results"
set +e
RUN_ID="stage0-validate-object-retention-reserved-canonical-write" \
  WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE=1 \
  REPORT_PATH="ops/evidence/staging/object-storage-retention-cleanup.json" \
  RESULTS_PATH="ops/evidence/staging/object-storage-retention-cleanup.ndjson" \
  BASE_URL="https://zenari-staging.example.test" \
  RELEASE_SHA="d3b1107c33dc40b8936f28549e06553fbd7b104a" \
  ADMIN_BEARER_TOKEN="stage0-local-fixture" \
  SMOKE_ADMIN_USER_ID="admin-ops" \
  SMOKE_ADMIN_TENANT_ID="tenant-alpha" \
  CSRF_ORIGIN="https://zenari-staging.example.test" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_explicit_canonical_status=$?
set -e
if [[ "$object_retention_explicit_canonical_status" -ne 2 ]]; then
  rm -f "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results"
  printf 'explicit canonical object-retention write request must be redirected to candidate diagnostics and exit 2, got %s\n' "$object_retention_explicit_canonical_status" >&2
  exit 1
fi
object_retention_explicit_canonical_after="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/object-storage-retention-cleanup.json"),
    Path("ops/evidence/staging/object-storage-retention-cleanup.ndjson"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(str(path.exists()).encode("utf-8"))
    if path.exists():
        digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
if [[ "$object_retention_canonical_before" != "$object_retention_explicit_canonical_after" ]]; then
  rm -f "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results"
  printf 'explicit canonical object-retention write request must not mutate canonical pass evidence before strict validation\n' >&2
  exit 1
fi
python3 - "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
if not report_path.exists() or not results_path.exists():
    raise SystemExit("explicit canonical write request must be redirected to candidate diagnostics")
report = json.loads(report_path.read_text(encoding="utf-8"))
if report.get("status") != "blocked":
    raise SystemExit("explicit canonical write candidate must stay blocked")
if report.get("results_path") != str(results_path):
    raise SystemExit("explicit canonical write candidate must reference candidate results path, not canonical results path")
if report.get("input_readiness", {}).get("canonical_write_requested") is not True:
    raise SystemExit("explicit canonical write candidate must preserve canonical write intent")
if report.get("split_evidence", {}).get("canonical_pass_paths") is not False:
    raise SystemExit("explicit canonical write candidate must not claim canonical pass paths")
PY
rm -f "$object_retention_reserved_candidate" "$object_retention_reserved_candidate_results"
set +e
RUN_ID="stage0-validate-object-storage-retention-cleanup" \
  DRY_RUN=1 \
  OUT_DIR="$ops_validate_dir/object-storage-retention" \
  REPORT_PATH="$ops_validate_dir/object-storage-retention/object-storage-retention-cleanup.json" \
  RESULTS_PATH="$ops_validate_dir/object-storage-retention/object-storage-retention-cleanup.ndjson" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
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
if runtime_requirements.get("required_base_url") != "STAGING_API_URL, STAGING_BASE_URL, or explicit probe URL env vars":
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
probe_contract = report.get("probe_contract", {})
if probe_contract.get("contract_id") != "object_storage_retention_cleanup_runtime_probe":
    raise SystemExit("object-storage retention cleanup dry-run must expose its runtime probe contract")
if probe_contract.get("release_gate_check_id") != "staging_object_storage_signed_downloads":
    raise SystemExit("object-storage retention cleanup probe contract must target staging_object_storage_signed_downloads")
if probe_contract.get("canonical_pass_report") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit("object-storage retention cleanup probe contract must name the canonical pass report")
if probe_contract.get("canonical_pass_results") != "ops/evidence/staging/object-storage-retention-cleanup.ndjson":
    raise SystemExit("object-storage retention cleanup probe contract must name the canonical pass results")
if probe_contract.get("blocked_without_runtime_inputs") is not True:
    raise SystemExit("object-storage retention cleanup probe contract must preserve honest blocked evidence without runtime inputs")
if probe_contract.get("non_canonical_reports_are_validation_only") is not True:
    raise SystemExit("object-storage retention cleanup probe contract must mark non-canonical reports validation-only")
if probe_contract.get("pass_evidence_written_only_after_strict_validator_accepts") is not True:
    raise SystemExit("object-storage retention cleanup probe contract must require strict validator acceptance before pass writes")
if probe_contract.get("canonical_outputs_are_atomic") is not True:
    raise SystemExit("object-storage retention cleanup probe contract must require atomic canonical output replacement")
if probe_contract.get("failed_strict_candidate_writes_blocked_evidence_only") is not True:
    raise SystemExit("object-storage retention cleanup probe contract must keep rejected candidates blocked-only")
if set(probe_contract.get("required_checks", [])) != expected_checks:
    raise SystemExit("object-storage retention cleanup probe contract must list all required checks")
if probe_contract.get("probe_routes") != runtime_requirements.get("required_probe_routes"):
    raise SystemExit("object-storage retention cleanup probe contract routes must match runtime input route requirements")
if not any("audit endpoint contains" in item for item in probe_contract.get("success_criteria", [])):
    raise SystemExit("object-storage retention cleanup probe contract must require cleanup audit endpoint linkage")
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
import ssl
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
            if self.server.generic_cleanup_ids:
                self._json({
                    "expired_exports": {
                        "id": "expired-export-row-007",
                        "deleted_objects": 2,
                        "preview_objects": 1,
                        "audit_status": "recorded",
                        "dry_run": True,
                    }
                })
                return
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
            if self.server.generic_cleanup_ids:
                self._json({
                    "orphaned_objects": {
                        "id": "orphan-row-015",
                        "deleted_objects": 1,
                        "preview_objects": 2,
                        "audit_status": "recorded",
                        "dry_run": True,
                    }
                })
                return
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
            expired_request_id = "stage0-object-retention-cleanup-expired_export_cleanup"
            orphan_request_id = "stage0-object-retention-cleanup-orphan_cleanup"
            audit_refs = [
                {"audit_id": "au-007", "kind": "object_retention_cleanup", "actor_id": "admin-ops", "tenant_id": "tenant-alpha", "request_id": expired_request_id},
                {"audit_id": "au-015", "kind": "export.cleanup.preview", "actor_id": "admin-ops", "tenant_id": "tenant-alpha", "request_id": orphan_request_id},
            ]
            if self.server.omit_orphan_audit_ref:
                audit_refs = audit_refs[:1]
            if self.server.omit_orphan_request_id:
                audit_refs[-1].pop("request_id", None)
            self._json({"audit_refs": audit_refs})
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
server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
args = sys.argv[3:]
server.omit_orphan_audit_ref = "omit-orphan-audit-ref" in args
server.generic_cleanup_ids = "generic-cleanup-ids" in args
server.omit_orphan_request_id = "omit-orphan-request-id" in args
tls_cert = next((arg.split("=", 1)[1] for arg in args if arg.startswith("tls-cert=")), "")
tls_key = next((arg.split("=", 1)[1] for arg in args if arg.startswith("tls-key=")), "")
if tls_cert and tls_key:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(tls_cert, tls_key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
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
  stop_temp_servers "$object_retention_server_pid"
  printf 'failed to start local object-retention fixture server\n' >&2
  cat "$object_retention_pass_dir/server.log" >&2 || true
  exit 1
fi
set +e
RUN_ID="stage0-validate-object-retention-strict-localhost-blocked" \
  OUT_DIR="$object_retention_pass_dir/strict-localhost-out" \
  REPORT_PATH="$object_retention_pass_dir/strict-localhost-out/object-storage-retention-cleanup.json" \
  RESULTS_PATH="$object_retention_pass_dir/strict-localhost-out/object-storage-retention-cleanup.ndjson" \
  BASE_URL="http://127.0.0.1:$object_retention_port" \
  RELEASE_SHA="d3b1107c33dc40b8936f28549e06553fbd7b104a" \
  ADMIN_BEARER_TOKEN="stage0-local-fixture" \
  SMOKE_ADMIN_USER_ID="admin-ops" \
  SMOKE_ADMIN_TENANT_ID="tenant-alpha" \
  CSRF_ORIGIN="http://127.0.0.1:$object_retention_port" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_strict_localhost_status=$?
set -e
if [[ "$object_retention_strict_localhost_status" -ne 2 ]]; then
  stop_temp_servers "$object_retention_server_pid"
  printf 'object-retention strict localhost fixture must exit 2 because canonical staging probes require production-like HTTPS, got %s\n' "$object_retention_strict_localhost_status" >&2
  exit 1
fi
python3 - "$object_retention_pass_dir/strict-localhost-out/object-storage-retention-cleanup.json" "$object_retention_pass_dir/strict-localhost-out/object-storage-retention-cleanup.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("strict localhost object-retention fixture must stay blocked")
if report.get("local_devport_debug") is not False:
    raise SystemExit("strict localhost object-retention fixture must not be marked local-devport debug")
if report.get("split_evidence", {}).get("retention_cleanup_runtime_ready") is not False:
    raise SystemExit("strict localhost object-retention fixture must not run runtime probes")
if {row.get("reason") for row in rows} != {"production_like_staging_url_required"}:
    raise SystemExit(f"strict localhost fixture must be blocked by production-like staging URL policy: {rows}")
if {row.get("status") for row in rows} != {"blocked"}:
    raise SystemExit(f"strict localhost fixture rows must all be blocked: {rows}")
PY
object_retention_tls_port="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
object_retention_tls_cert="$object_retention_pass_dir/zenari-staging.example.test.crt"
object_retention_tls_key="$object_retention_pass_dir/zenari-staging.example.test.key"
openssl req -x509 -newkey rsa:2048 -sha256 -days 1 -nodes \
  -subj "/CN=zenari-staging.example.test" \
  -addext "subjectAltName=DNS:zenari-staging.example.test" \
  -keyout "$object_retention_tls_key" \
  -out "$object_retention_tls_cert" >/dev/null 2>&1
python3 "$object_retention_pass_dir/server.py" "$object_retention_web_dir" "$object_retention_tls_port" \
  "tls-cert=$object_retention_tls_cert" "tls-key=$object_retention_tls_key" >"$object_retention_pass_dir/server.tls.log" 2>&1 &
object_retention_tls_server_pid=$!
for _ in $(seq 1 50); do
  if curl --silent --show-error --max-time 1 \
    --resolve "zenari-staging.example.test:$object_retention_tls_port:127.0.0.1" \
    --noproxy "zenari-staging.example.test" \
    --cacert "$object_retention_tls_cert" \
    "https://zenari-staging.example.test:$object_retention_tls_port/api/admin/v1/object-storage/retention-policy/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! curl --silent --show-error --max-time 1 \
  --resolve "zenari-staging.example.test:$object_retention_tls_port:127.0.0.1" \
  --noproxy "zenari-staging.example.test" \
	  --cacert "$object_retention_tls_cert" \
	  "https://zenari-staging.example.test:$object_retention_tls_port/api/admin/v1/object-storage/retention-policy/" >/dev/null 2>&1; then
  stop_temp_servers "$object_retention_server_pid" "$object_retention_tls_server_pid"
  printf 'failed to start local object-retention TLS fixture server\n' >&2
  cat "$object_retention_pass_dir/server.tls.log" >&2 || true
  exit 1
fi
set +e
RUN_ID="stage0-validate-object-retention-production-like-https-pass" \
  OUT_DIR="$object_retention_pass_dir/production-like-https-out" \
  REPORT_PATH="$object_retention_pass_dir/production-like-https-out/object-storage-retention-cleanup.json" \
  RESULTS_PATH="$object_retention_pass_dir/production-like-https-out/object-storage-retention-cleanup.ndjson" \
  BASE_URL="https://zenari-staging.example.test:$object_retention_tls_port" \
  BASE_URL_RESOLVE_ADDR="127.0.0.1" \
  BASE_URL_CA_CERT="$object_retention_tls_cert" \
  RELEASE_SHA="d3b1107c33dc40b8936f28549e06553fbd7b104a" \
  ADMIN_BEARER_TOKEN="stage0-local-fixture" \
  SMOKE_ADMIN_USER_ID="admin-ops" \
  SMOKE_ADMIN_TENANT_ID="tenant-alpha" \
  CSRF_ORIGIN="https://zenari-staging.example.test:$object_retention_tls_port" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_production_like_https_status=$?
set -e
stop_temp_servers "$object_retention_tls_server_pid"
if [[ "$object_retention_production_like_https_status" -ne 2 ]]; then
  stop_temp_servers "$object_retention_server_pid"
  printf 'object-retention reserved HTTPS fixture must exit 2 because canonical staging probes require a real staging host, got %s\n' "$object_retention_production_like_https_status" >&2
  cat "$object_retention_pass_dir/server.tls.log" >&2 || true
  exit 1
fi
python3 - "$object_retention_pass_dir/production-like-https-out/object-storage-retention-cleanup.json" "$object_retention_pass_dir/production-like-https-out/object-storage-retention-cleanup.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit(f"reserved HTTPS fixture must stay blocked by staging target policy: {report.get('status')}")
if report.get("local_devport_debug") is not False:
    raise SystemExit("reserved HTTPS fixture must not be local-devport debug")
if report.get("split_evidence", {}).get("retention_cleanup_runtime_ready") is not False:
    raise SystemExit("reserved HTTPS fixture must not run runtime probes")
if report.get("split_evidence", {}).get("retention_cleanup_ready") is not False:
    raise SystemExit("reserved HTTPS fixture must not mark gate readiness")
if report.get("split_evidence", {}).get("canonical_pass_paths") is not False:
    raise SystemExit("reserved HTTPS fixture must not claim checked-in canonical pass paths")
if report.get("input_readiness", {}).get("canonical_pass_path") is not False:
    raise SystemExit("reserved HTTPS fixture must expose noncanonical temp path readiness")
if report.get("input_readiness", {}).get("production_like_staging_targets") is not False:
    raise SystemExit("reserved HTTPS fixture must reject reserved test-domain targets")
if report.get("input_readiness", {}).get("canonical_write_requested") is not False:
    raise SystemExit("reserved HTTPS fixture must not request canonical writes")
if report.get("base_url") != report.get("csrf", {}).get("origin"):
    raise SystemExit("reserved HTTPS fixture must bind CSRF origin to the target URL")
if report.get("base_url", "").startswith("http://") or "127.0.0.1" in report.get("base_url", ""):
    raise SystemExit(f"reserved HTTPS fixture must expose only HTTPS target URL, got {report.get('base_url')}")
if report.get("gate_impact", {}).get("can_clear_release_gate_check") is not False:
    raise SystemExit("reserved HTTPS fixture must not clear object-storage release gate")
if {row.get("reason") for row in rows} != {"production_like_staging_url_required"}:
    raise SystemExit(f"reserved HTTPS fixture must be blocked by staging target policy: {rows}")
if {row.get("status") for row in rows} != {"blocked"}:
    raise SystemExit(f"reserved HTTPS fixture rows must all be blocked: {rows}")
PY
set +e
RUN_ID="stage0-validate-object-retention-alias-pass" \
  OUT_DIR="$object_retention_pass_dir/out" \
  REPORT_PATH="$object_retention_pass_dir/out/object-storage-retention-cleanup.json" \
  RESULTS_PATH="$object_retention_pass_dir/out/object-storage-retention-cleanup.ndjson" \
  ALLOW_LOCAL_DEVPORT_EVIDENCE=1 \
  BASE_URL="http://127.0.0.1:$object_retention_port" \
  RELEASE_SHA="d3b1107c33dc40b8936f28549e06553fbd7b104a" \
  ADMIN_BEARER_TOKEN="stage0-local-fixture" \
  SMOKE_ADMIN_USER_ID="admin-ops" \
  SMOKE_ADMIN_TENANT_ID="tenant-alpha" \
  CSRF_ORIGIN="http://127.0.0.1:$object_retention_port" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_alias_status=$?
set -e
stop_temp_servers "$object_retention_server_pid"
if [[ "$object_retention_alias_status" -ne 2 ]]; then
  printf 'object-retention local-devport alias fixture must exit 2 because debug evidence cannot close the staging gate, got %s\n' "$object_retention_alias_status" >&2
  exit 1
fi
python3 - "$object_retention_pass_dir/out/object-storage-retention-cleanup.json" "$object_retention_pass_dir/out/object-storage-retention-cleanup.ndjson" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
rows = [json.loads(line) for line in Path(sys.argv[2]).read_text(encoding="utf-8").splitlines() if line.strip()]
if report.get("status") != "blocked":
    raise SystemExit("local-devport object-retention alias fixture must stay blocked")
if report.get("local_devport_debug") is not True:
    raise SystemExit("local-devport alias fixture must mark debug evidence")
if report.get("allow_local_devport_evidence") is not None:
    raise SystemExit("allow_local_devport_evidence must stay under input_readiness, not as a top-level gate signal")
expected_blockers = [
    "local_devport_debug_evidence_cannot_clear_staging_gate",
    "real_staging_target_required_for_canonical_pass",
    "canonical_write_not_requested",
]
if report.get("blocked_checks") != expected_blockers:
    raise SystemExit(f"local-devport alias fixture should be blocked by canonical staging policy: {report.get('blocked_checks')}")
split = report.get("split_evidence", {})
if split.get("retention_cleanup_runtime_ready") is not True:
    raise SystemExit("alias fixture must prove retention cleanup runtime readiness")
if split.get("retention_cleanup_ready") is not False:
    raise SystemExit("local-devport alias fixture must not mark retention cleanup gate ready")
if split.get("canonical_pass_paths") is not False:
    raise SystemExit("alias fixture must not claim canonical pass paths")
if split.get("release_sha_matches_signed_url") is not True:
    raise SystemExit("alias fixture must bind to the signed URL release SHA")
input_readiness = report.get("input_readiness", {})
if input_readiness.get("allow_local_devport_evidence") is not True:
    raise SystemExit(f"local-devport alias fixture must expose local devport input readiness: {input_readiness}")
if input_readiness.get("canonical_pass_path") is not False:
    raise SystemExit(f"local-devport alias fixture must not claim canonical pass path: {input_readiness}")
runtime_requirements = report.get("runtime_input_requirements", {})
if runtime_requirements.get("blocked_input_reason") != "local-devport debug evidence cannot clear canonical staging object-retention gate":
    raise SystemExit(f"local-devport alias fixture must explain debug-only blocker: {runtime_requirements}")
probe_contract = report.get("probe_contract", {})
if "ALLOW_LOCAL_DEVPORT_EVIDENCE=1" not in probe_contract.get("local_devport_debug_command", ""):
    raise SystemExit("probe contract must expose the local-devport debug command")
if probe_contract.get("local_devport_report") != "ops/evidence/staging/local-devport/object-storage-retention-cleanup.local-devport.json":
    raise SystemExit(f"probe contract must name local-devport report path: {probe_contract}")
if probe_contract.get("local_devport_results") != "ops/evidence/staging/local-devport/object-storage-retention-cleanup.local-devport.ndjson":
    raise SystemExit(f"probe contract must name local-devport results path: {probe_contract}")
if "cannot clear staging gates" not in probe_contract.get("allow_local_devport_evidence_env", ""):
    raise SystemExit("probe contract must state local-devport evidence cannot clear staging gates")
audit_linkage = report.get("audit_linkage", {})
if audit_linkage.get("verified") is not True:
    raise SystemExit(f"alias fixture must verify cleanup audit refs through audit endpoint: {audit_linkage}")
if audit_linkage.get("cleanup_audit_refs_by_probe") != {
    "expired_export_cleanup": ["au-007"],
    "orphan_cleanup": ["au-015"],
}:
    raise SystemExit(f"alias fixture must expose per-probe cleanup audit refs: {audit_linkage}")
if audit_linkage.get("audit_endpoint_covers_cleanup_refs") != {
    "expired_export_cleanup": ["au-007"],
    "orphan_cleanup": ["au-015"],
}:
    raise SystemExit(f"alias fixture must expose per-probe audit endpoint coverage: {audit_linkage}")
if audit_linkage.get("audit_endpoint_missing_cleanup_refs") != {
    "expired_export_cleanup": [],
    "orphan_cleanup": [],
}:
    raise SystemExit(f"alias fixture must expose empty per-probe missing audit refs: {audit_linkage}")
if audit_linkage.get("cleanup_audit_refs") != ["au-007", "au-015"]:
    raise SystemExit(f"alias fixture cleanup audit refs mismatch: {audit_linkage}")
if audit_linkage.get("missing_cleanup_audit_refs") != []:
    raise SystemExit(f"alias fixture must not miss cleanup audit refs: {audit_linkage}")
if audit_linkage.get("request_id_verified") is not True:
    raise SystemExit(f"alias fixture must verify cleanup audit request-id linkage: {audit_linkage}")
if audit_linkage.get("audit_endpoint_request_id_cleanup_refs_by_probe") != {
    "expired_export_cleanup": ["au-007"],
    "orphan_cleanup": ["au-015"],
}:
    raise SystemExit(f"alias fixture must expose per-probe request-id audit refs: {audit_linkage}")
if audit_linkage.get("audit_endpoint_request_id_missing_cleanup_refs_by_probe") != {
    "expired_export_cleanup": [],
    "orphan_cleanup": [],
}:
    raise SystemExit(f"alias fixture must expose empty per-probe missing request-id audit refs: {audit_linkage}")
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
object_retention_audit_port="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
python3 "$object_retention_pass_dir/server.py" "$object_retention_web_dir" "$object_retention_audit_port" omit-orphan-audit-ref >"$object_retention_pass_dir/server.audit-mismatch.log" 2>&1 &
object_retention_audit_server_pid=$!
for _ in $(seq 1 50); do
  if curl --silent --show-error --max-time 1 "http://127.0.0.1:$object_retention_audit_port/api/admin/v1/object-storage/retention-policy/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! curl --silent --show-error --max-time 1 "http://127.0.0.1:$object_retention_audit_port/api/admin/v1/object-storage/retention-policy/" >/dev/null 2>&1; then
  stop_temp_servers "$object_retention_audit_server_pid"
  printf 'failed to start local object-retention audit mismatch fixture server\n' >&2
  cat "$object_retention_pass_dir/server.audit-mismatch.log" >&2 || true
  exit 1
fi
set +e
RUN_ID="stage0-validate-object-retention-audit-mismatch" \
  OUT_DIR="$object_retention_pass_dir/audit-mismatch-out" \
  REPORT_PATH="$object_retention_pass_dir/audit-mismatch-out/object-storage-retention-cleanup.json" \
  RESULTS_PATH="$object_retention_pass_dir/audit-mismatch-out/object-storage-retention-cleanup.ndjson" \
  ALLOW_LOCAL_DEVPORT_EVIDENCE=1 \
  BASE_URL="http://127.0.0.1:$object_retention_audit_port" \
  RELEASE_SHA="d3b1107c33dc40b8936f28549e06553fbd7b104a" \
  ADMIN_BEARER_TOKEN="stage0-local-fixture" \
  SMOKE_ADMIN_USER_ID="admin-ops" \
  SMOKE_ADMIN_TENANT_ID="tenant-alpha" \
  CSRF_ORIGIN="http://127.0.0.1:$object_retention_audit_port" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_audit_status=$?
set -e
stop_temp_servers "$object_retention_audit_server_pid"
if [[ "$object_retention_audit_status" -ne 2 ]]; then
  printf 'object-retention audit mismatch fixture must exit 2, got %s\n' "$object_retention_audit_status" >&2
  exit 1
fi
python3 - "$object_retention_pass_dir/audit-mismatch-out/object-storage-retention-cleanup.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if report.get("status") != "blocked":
    raise SystemExit("audit mismatch fixture must remain blocked")
if "audit_refs:missing_cleanup_audit_refs:au-015" not in report.get("blocked_checks", []):
    raise SystemExit(f"audit mismatch fixture must block on missing cleanup audit ref: {report.get('blocked_checks')}")
audit_linkage = report.get("audit_linkage", {})
if audit_linkage.get("verified") is not False:
    raise SystemExit(f"audit mismatch fixture must not verify audit linkage: {audit_linkage}")
if audit_linkage.get("cleanup_audit_refs") != ["au-007", "au-015"]:
    raise SystemExit(f"audit mismatch fixture cleanup audit refs mismatch: {audit_linkage}")
if audit_linkage.get("cleanup_audit_refs_by_probe") != {
    "expired_export_cleanup": ["au-007"],
    "orphan_cleanup": ["au-015"],
}:
    raise SystemExit(f"audit mismatch fixture must expose per-probe cleanup audit refs: {audit_linkage}")
if audit_linkage.get("audit_endpoint_covers_cleanup_refs") != {
    "expired_export_cleanup": ["au-007"],
    "orphan_cleanup": [],
}:
    raise SystemExit(f"audit mismatch fixture must expose per-probe audit endpoint coverage: {audit_linkage}")
if audit_linkage.get("audit_endpoint_missing_cleanup_refs") != {
    "expired_export_cleanup": [],
    "orphan_cleanup": ["au-015"],
}:
    raise SystemExit(f"audit mismatch fixture must expose per-probe missing audit refs: {audit_linkage}")
if audit_linkage.get("audit_endpoint_refs") != ["au-007"]:
    raise SystemExit(f"audit mismatch fixture endpoint refs mismatch: {audit_linkage}")
if audit_linkage.get("missing_cleanup_audit_refs") != ["au-015"]:
    raise SystemExit(f"audit mismatch fixture missing refs mismatch: {audit_linkage}")
if audit_linkage.get("request_id_verified") is not False:
    raise SystemExit(f"audit mismatch fixture must not verify request-id audit linkage: {audit_linkage}")
if report.get("split_evidence", {}).get("retention_cleanup_runtime_ready") is not False:
    raise SystemExit("audit mismatch fixture must not mark retention cleanup runtime ready")
PY
object_retention_generic_id_port="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
python3 "$object_retention_pass_dir/server.py" "$object_retention_web_dir" "$object_retention_generic_id_port" generic-cleanup-ids >"$object_retention_pass_dir/server.generic-id.log" 2>&1 &
object_retention_generic_id_server_pid=$!
for _ in $(seq 1 50); do
  if curl --silent --show-error --max-time 1 "http://127.0.0.1:$object_retention_generic_id_port/api/admin/v1/object-storage/retention-policy/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! curl --silent --show-error --max-time 1 "http://127.0.0.1:$object_retention_generic_id_port/api/admin/v1/object-storage/retention-policy/" >/dev/null 2>&1; then
  stop_temp_servers "$object_retention_generic_id_server_pid"
  printf 'failed to start local object-retention generic-id fixture server\n' >&2
  cat "$object_retention_pass_dir/server.generic-id.log" >&2 || true
  exit 1
fi
set +e
RUN_ID="stage0-validate-object-retention-generic-id" \
  OUT_DIR="$object_retention_pass_dir/generic-id-out" \
  REPORT_PATH="$object_retention_pass_dir/generic-id-out/object-storage-retention-cleanup.json" \
  RESULTS_PATH="$object_retention_pass_dir/generic-id-out/object-storage-retention-cleanup.ndjson" \
  ALLOW_LOCAL_DEVPORT_EVIDENCE=1 \
  BASE_URL="http://127.0.0.1:$object_retention_generic_id_port" \
  RELEASE_SHA="d3b1107c33dc40b8936f28549e06553fbd7b104a" \
  ADMIN_BEARER_TOKEN="stage0-local-fixture" \
  SMOKE_ADMIN_USER_ID="admin-ops" \
  SMOKE_ADMIN_TENANT_ID="tenant-alpha" \
  CSRF_ORIGIN="http://127.0.0.1:$object_retention_generic_id_port" \
  scripts/staging_object_storage_retention_cleanup_smoke.sh >/dev/null
object_retention_generic_id_status=$?
set -e
stop_temp_servers "$object_retention_generic_id_server_pid"
if [[ "$object_retention_generic_id_status" -ne 2 ]]; then
  printf 'object-retention generic-id fixture must exit 2, got %s\n' "$object_retention_generic_id_status" >&2
  exit 1
fi
python3 - "$object_retention_pass_dir/generic-id-out/object-storage-retention-cleanup.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
if report.get("status") != "blocked":
    raise SystemExit("generic-id fixture must remain blocked")
blocked_checks = set(report.get("blocked_checks", []))
for expected in (
    "expired_export_cleanup:missing_cleanup_audit_refs",
    "orphan_cleanup:missing_cleanup_audit_refs",
):
    if expected not in blocked_checks:
        raise SystemExit(f"generic-id fixture must reject non-audit id fields as cleanup refs: {blocked_checks}")
audit_linkage = report.get("audit_linkage", {})
if audit_linkage.get("cleanup_audit_refs") != []:
    raise SystemExit(f"generic-id fixture must not collect generic id fields as cleanup audit refs: {audit_linkage}")
if audit_linkage.get("verified") is not False:
    raise SystemExit(f"generic-id fixture must not verify audit linkage: {audit_linkage}")
if report.get("split_evidence", {}).get("retention_cleanup_runtime_ready") is not False:
    raise SystemExit("generic-id fixture must not mark retention cleanup runtime ready")
PY
set +e
RUN_ID="stage0-validate-legal-support-visibility" DRY_RUN=1 OUT_DIR="$ops_validate_dir/legal-support" scripts/staging_legal_support_visibility_smoke.sh >/dev/null
legal_support_status=$?
set -e
if [[ "$legal_support_status" -ne 2 ]]; then
  printf 'staging legal/support visibility dry-run must exit 2 without external-user runtime evidence, got %s\n' "$legal_support_status" >&2
  exit 1
fi
before_default_legal_support_sha="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/legal-pages-external-user.json"),
    Path("ops/evidence/staging/support-contact-external-user.json"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
set +e
DRY_RUN=1 scripts/staging_legal_support_visibility_smoke.sh >/dev/null
default_legal_support_status=$?
set -e
if [[ "$default_legal_support_status" -ne 2 ]]; then
  printf 'default staging legal/support visibility dry-run must exit 2 without external-user runtime evidence, got %s\n' "$default_legal_support_status" >&2
  exit 1
fi
after_default_legal_support_sha="$(
  python3 - <<'PY'
import hashlib
from pathlib import Path

paths = [
    Path("ops/evidence/staging/legal-pages-external-user.json"),
    Path("ops/evidence/staging/support-contact-external-user.json"),
]
digest = hashlib.sha256()
for path in paths:
    digest.update(path.read_bytes())
print(digest.hexdigest())
PY
)"
if [[ "$before_default_legal_support_sha" != "$after_default_legal_support_sha" ]]; then
  printf 'default staging legal/support visibility dry-run must not mutate checked-in pass evidence\n' >&2
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
import subprocess
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
if report.get("release_evidence_complete") is not True:
    raise SystemExit("release evidence bundle dry-run must use the complete canonical release evidence metadata")
if report.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("release evidence bundle dry-run must keep post-deploy smoke unverified")
if report.get("object_retention_cleanup_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must verify canonical object-retention cleanup")
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
if runtime_requirements.get("required_base_url") != "STAGING_API_URL, STAGING_BASE_URL, or explicit probe URL env vars":
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
    raise SystemExit("release evidence bundle generated object-retention probe must keep retention cleanup readiness false")
if report.get("legal_support_visibility_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must verify canonical legal/support visibility")
if report.get("legal_support_split_reports_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must verify canonical legal/support split reports")
if report.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("release evidence bundle dry-run must use canonical staging legal/support split evidence")
if report.get("gate_fixtures_clear") is not False:
    raise SystemExit("release evidence bundle dry-run must keep gate fixtures blocked")
if report.get("missing_slots") != []:
    raise SystemExit(f"release evidence bundle dry-run must have no missing release slots once canonical metadata is complete: {report.get('missing_slots')}")
if report.get("unverified_slots") != []:
    raise SystemExit(f"release evidence bundle dry-run must have no unverified release slots once canonical metadata is complete: {report.get('unverified_slots')}")
release_metadata = report.get("release_metadata_preflight", {})
if release_metadata.get("path") != "ops/evidence/release/staging/stage1-release-metadata-preflight.json":
    raise SystemExit("release evidence bundle must surface release metadata preflight path")
if release_metadata.get("metadata_complete") is not True:
    raise SystemExit("release evidence bundle dry-run must surface complete release metadata")
canonical_metadata_path = Path("ops/evidence/release/staging/stage1-release-metadata-preflight.json")
canonical_metadata = json.loads(canonical_metadata_path.read_text(encoding="utf-8"))
expected_release_sha = canonical_metadata.get("release_sha")
if release_metadata.get("release_sha") != expected_release_sha:
    raise SystemExit("release evidence bundle must surface canonical candidate metadata release SHA")
if release_metadata.get("release_notes_path") != "ops/release/stage1_release_candidate_metadata_draft.md":
    raise SystemExit("release evidence bundle must surface candidate release notes path")
if report.get("release_metadata_blocking_reasons") != []:
    raise SystemExit(f"release evidence bundle must not project release metadata blockers once metadata is complete: {report.get('release_metadata_blocking_reasons')}")
blocking = report.get("blocking_reasons", [])
for reason in (
    "staging_smoke_not_passed",
    "post_deploy_smoke_contract_unverified",
):
    if reason not in blocking:
        raise SystemExit(f"release evidence bundle missing blocking reason {reason}")
for closed_reason in (
    "legal_support_external_user_visibility_not_passed",
    "release_metadata_preflight_not_complete",
    "missing_release_evidence:image_refs",
    "unverified_release_evidence:observability_evidence",
    "canonical_object_storage_retention_cleanup_not_passed",
):
    if closed_reason in blocking:
        raise SystemExit(f"release evidence bundle must not keep closed canonical blocker {closed_reason}")
private_beta_blockers = [reason for reason in blocking if reason.startswith("gate_fixture_blocked:private_beta_staging:")]
if private_beta_blockers:
    raise SystemExit(f"release evidence bundle must not keep closed private beta blockers: {private_beta_blockers}")
if any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking):
    raise SystemExit("release evidence bundle must keep production fixture blockers out of staging bundle blocking reasons")
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
    raise SystemExit("release evidence bundle dry-run must verify canonical legal-pages split evidence")
if split_inputs.get("canonical_support_contact_external_user_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must verify canonical support-contact split evidence")
if split_inputs.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("release evidence bundle dry-run must use canonical staging legal/support split evidence")
if split_inputs.get("generated_object_retention_probe_passed") is not False:
    raise SystemExit("release evidence bundle dry-run must surface generated object-retention probe as blocked")
if split_inputs.get("canonical_object_retention_cleanup_verified") is not True:
    raise SystemExit("release evidence bundle dry-run must verify canonical object-retention cleanup")
for field in (
    "canonical_legal_pages_external_user_probe",
    "canonical_support_contact_external_user_probe",
):
    probe = report.get(field, {})
    if probe.get("exists") is not True:
        raise SystemExit(f"{field} canonical evidence must exist")
    if probe.get("passed") is not True:
        raise SystemExit(f"{field} canonical evidence must pass")
    if probe.get("status") not in {"pass", "passed"}:
        raise SystemExit(f"{field} canonical evidence must stay passed")
for field in (
    "legal_pages_external_user_probe",
    "support_contact_external_user_probe",
):
    probe = report.get(field, {})
    if probe.get("exists") is not True:
        raise SystemExit(f"{field} dry-run generated split probe must exist")
    if probe.get("passed") is not False:
        raise SystemExit(f"{field} dry-run generated split probe must not pass")
    if probe.get("status") != "blocked":
        raise SystemExit(f"{field} dry-run generated split probe must stay blocked")
    if probe.get("gate_impact", {}).get("can_clear_release_gate_check") is not False:
        raise SystemExit(f"{field} dry-run generated split probe cannot clear the release gate")
canonical_probe = report.get("canonical_object_retention_cleanup_probe", {})
if canonical_probe.get("passed") is not True:
    raise SystemExit(f"canonical object-retention probe must pass once canonical staging evidence exists: {canonical_probe}")
if canonical_probe.get("path") != "ops/evidence/staging/object-storage-retention-cleanup.json":
    raise SystemExit(f"canonical object-retention probe must cite canonical pass report: {canonical_probe}")
audit_linkage = canonical_probe.get("audit_linkage", {})
if audit_linkage and (audit_linkage.get("verified") is not True or audit_linkage.get("semantic_verified") is not True):
    raise SystemExit("canonical object-retention probe must preserve verified audit linkage")
PY
object_retention_canonical_dir="$(mktemp -d)"
object_retention_canonical_report="$object_retention_canonical_dir/object-storage-retention-cleanup.json"
object_retention_canonical_results="$object_retention_canonical_dir/object-storage-retention-cleanup.ndjson"
cat >"$object_retention_canonical_results" <<'EOF'
{"check_id":"retention_policy","status":"passed","url":"https://staging-api.zenari.dev/api/admin/v1/object-storage/retention-policy","matched_tokens":["retention policy","versioning","retention_until","tenant"],"missing_tokens":[],"request_id":"stage0-object-retention-cleanup-retention_policy","request_id_echoed":true,"response_request_id_values":["stage0-object-retention-cleanup-retention_policy"],"response_bytes":128}
{"check_id":"expired_export_cleanup","status":"passed","url":"https://staging-api.zenari.dev/api/admin/v1/object-storage/cleanup/expired-exports","matched_tokens":["expired export cleanup","deleted","retained","audit"],"missing_tokens":[],"request_id":"stage0-object-retention-cleanup-expired_export_cleanup","request_id_echoed":true,"response_request_id_values":["stage0-object-retention-cleanup-expired_export_cleanup"],"response_bytes":128}
{"check_id":"orphan_cleanup","status":"passed","url":"https://staging-api.zenari.dev/api/admin/v1/object-storage/cleanup/orphans","matched_tokens":["orphan cleanup","deleted","retained","audit"],"missing_tokens":[],"request_id":"stage0-object-retention-cleanup-orphan_cleanup","request_id_echoed":true,"response_request_id_values":["stage0-object-retention-cleanup-orphan_cleanup"],"response_bytes":128}
{"check_id":"audit_refs","status":"passed","url":"https://staging-api.zenari.dev/api/admin/v1/audit?subject=object_storage_cleanup&limit=20","matched_tokens":["audit","object_storage_cleanup","admin","tenant"],"missing_tokens":[],"request_id":"stage0-object-retention-cleanup-audit_refs","request_id_echoed":true,"response_request_id_values":["stage0-object-retention-cleanup-audit_refs"],"response_bytes":128}
EOF
cat >"$object_retention_canonical_report" <<EOF
{
  "schema_version": "stage0.rev2.staging.object_storage_retention_cleanup",
  "environment": "staging",
  "kind": "object_storage_retention_cleanup",
  "status": "pass",
  "release_sha": "d3b1107c33dc40b8936f28549e06553fbd7b104a",
  "base_url": "https://staging-api.zenari.dev",
  "release_gate_check_id": "staging_object_storage_signed_downloads",
  "admin_user_id": "admin-ops",
  "admin_tenant_id": "tenant-alpha",
  "csrf": {
    "ready": true,
    "origin": "https://staging-admin.zenari.dev",
    "header_name": "X-Zenari-CSRF"
  },
  "results_path": "$object_retention_canonical_results",
  "blocked_checks": [],
  "coverage": [
    {"area":"retention_policy","status":"pass"},
    {"area":"expired_export_cleanup","status":"pass"},
    {"area":"orphan_cleanup","status":"pass"},
    {"area":"audit_refs","status":"pass"}
  ],
  "split_evidence": {
    "canonical_pass_paths": true,
    "retention_cleanup_runtime_ready": true,
    "retention_cleanup_ready": true,
    "signed_url_ready": true,
    "release_sha_matches_signed_url": true
  },
  "input_readiness": {
    "probe_urls_ready": true,
    "auth_ready": true,
    "admin_user_id_ready": true,
    "admin_tenant_id_ready": true,
    "csrf_ready": true,
    "release_sha_provided": true,
    "signed_url_evidence_ready": true,
    "release_sha_matches_signed_url": true,
    "canonical_pass_path": true
  },
  "gate_impact": {
    "can_clear_release_gate_check": true,
    "preserved_release_gate_check_id": null
  },
  "audit_linkage": {
    "verified": true,
    "semantic_verified": true,
    "cleanup_audit_refs_by_probe": {
      "expired_export_cleanup": ["au-007"],
      "orphan_cleanup": ["au-015"]
    },
    "cleanup_audit_refs": ["au-007", "au-015"],
    "audit_endpoint_covers_cleanup_refs": {
      "expired_export_cleanup": ["au-007"],
      "orphan_cleanup": ["au-015"]
    },
    "audit_endpoint_missing_cleanup_refs": {
      "expired_export_cleanup": [],
      "orphan_cleanup": []
    },
    "audit_endpoint_semantic_cleanup_refs": ["au-007", "au-015"],
    "audit_endpoint_semantic_cleanup_refs_by_probe": {
      "expired_export_cleanup": ["au-007"],
      "orphan_cleanup": ["au-015"]
    },
    "audit_endpoint_semantic_missing_cleanup_refs": [],
    "audit_endpoint_request_id_cleanup_refs_by_probe": {
      "expired_export_cleanup": ["au-007"],
      "orphan_cleanup": ["au-015"]
    },
    "audit_endpoint_request_id_missing_cleanup_refs_by_probe": {
      "expired_export_cleanup": [],
      "orphan_cleanup": []
    },
    "audit_endpoint_request_id_missing_cleanup_refs": [],
    "audit_endpoint_refs": ["au-007", "au-015"],
    "missing_cleanup_audit_refs": [],
    "request_id_verified": true
  }
}
EOF
set +e
DRY_RUN=1 \
  OUT_DIR="$object_retention_canonical_dir/release-bundle" \
  CANONICAL_OBJECT_RETENTION_REPORT_PATH="$object_retention_canonical_report" \
  scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_canonical_status=$?
set -e
if [[ "$release_bundle_canonical_status" -ne 2 ]]; then
  printf 'release evidence bundle canonical retention fixture must still exit 2 while other release gates are no-go, got %s\n' "$release_bundle_canonical_status" >&2
  exit 1
fi
python3 - "$object_retention_canonical_dir/release-bundle" <<'PY'
import json
import sys
from pathlib import Path

reports = [
    path
    for path in sorted(Path(sys.argv[1]).glob("*.json"))
    if json.loads(path.read_text(encoding="utf-8")).get("kind") == "release_evidence_bundle"
]
if len(reports) != 1:
    raise SystemExit("canonical release bundle fixture must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
probe = report.get("canonical_object_retention_cleanup_probe", {})
if probe.get("passed") is not True:
    raise SystemExit(f"complete canonical retention cleanup fixture must pass split verification: {probe}")
if probe.get("missing_requirements") != []:
    raise SystemExit(f"complete canonical retention cleanup fixture must have no missing requirements: {probe}")
if report.get("object_retention_cleanup_verified") is not True:
    raise SystemExit("complete canonical retention cleanup fixture must mark object retention verified")
if "canonical_object_storage_retention_cleanup_not_passed" in report.get("blocking_reasons", []):
    raise SystemExit("complete canonical retention cleanup fixture must remove object-retention blocking reason")
if probe.get("result_count") != 4:
    raise SystemExit(f"complete canonical retention cleanup fixture must inspect four result rows: {probe}")
if probe.get("input_readiness", {}).get("csrf_ready") is not True:
    raise SystemExit(f"complete canonical retention cleanup fixture must surface CSRF readiness: {probe}")
audit_linkage = probe.get("audit_linkage", {})
if audit_linkage.get("request_id_verified") is not True:
    raise SystemExit(f"complete canonical retention cleanup fixture must verify request-id audit linkage: {audit_linkage}")
PY
object_retention_spoof_dir="$(mktemp -d)"
object_retention_spoof_report="$object_retention_spoof_dir/object-storage-retention-cleanup.json"
object_retention_spoof_results="$object_retention_spoof_dir/object-storage-retention-cleanup.ndjson"
cat >"$object_retention_spoof_results" <<'EOF'
{"check_id":"retention_policy","status":"passed","matched_tokens":["retention policy","versioning","retention_until","tenant"],"missing_tokens":[],"request_id":"stage0-object-retention-cleanup-retention_policy","request_id_echoed":true,"response_request_id_values":["stage0-object-retention-cleanup-retention_policy"],"response_bytes":128}
{"check_id":"expired_export_cleanup","status":"passed","matched_tokens":["expired export cleanup","deleted","retained","audit"],"missing_tokens":[],"request_id":"stage0-object-retention-cleanup-expired_export_cleanup","request_id_echoed":true,"response_request_id_values":["stage0-object-retention-cleanup-expired_export_cleanup"],"response_bytes":128}
{"check_id":"orphan_cleanup","status":"passed","matched_tokens":["orphan cleanup","deleted","retained","audit"],"missing_tokens":[],"request_id":"stage0-object-retention-cleanup-orphan_cleanup","request_id_echoed":true,"response_request_id_values":["stage0-object-retention-cleanup-orphan_cleanup"],"response_bytes":128}
{"check_id":"audit_refs","status":"passed","matched_tokens":["audit","object_storage_cleanup","admin","tenant"],"missing_tokens":[],"request_id":"stage0-object-retention-cleanup-audit_refs","request_id_echoed":true,"response_request_id_values":["stage0-object-retention-cleanup-audit_refs"],"response_bytes":128}
EOF
cat >"$object_retention_spoof_report" <<EOF
{
  "schema_version": "stage0.rev2.staging.object_storage_retention_cleanup",
  "environment": "staging",
  "kind": "object_storage_retention_cleanup",
  "status": "pass",
  "release_sha": "d3b1107c33dc40b8936f28549e06553fbd7b104a",
  "release_gate_check_id": "staging_object_storage_signed_downloads",
  "results_path": "$object_retention_spoof_results",
  "blocked_checks": [],
  "coverage": [
    {"area":"retention_policy","status":"pass"},
    {"area":"expired_export_cleanup","status":"pass"},
    {"area":"orphan_cleanup","status":"pass"},
    {"area":"audit_refs","status":"pass"}
  ],
  "split_evidence": {
    "canonical_pass_paths": true,
    "retention_cleanup_ready": true,
    "signed_url_ready": true
  },
  "gate_impact": {
    "can_clear_release_gate_check": true,
    "preserved_release_gate_check_id": null
  },
  "audit_linkage": {
    "verified": false,
    "cleanup_audit_refs": [],
    "missing_cleanup_audit_refs": []
  }
}
EOF
set +e
DRY_RUN=1 \
  OUT_DIR="$object_retention_spoof_dir/release-bundle" \
  CANONICAL_OBJECT_RETENTION_REPORT_PATH="$object_retention_spoof_report" \
  scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_spoof_status=$?
set -e
if [[ "$release_bundle_spoof_status" -ne 2 ]]; then
  printf 'release evidence bundle spoofed retention cleanup must exit 2, got %s\n' "$release_bundle_spoof_status" >&2
  exit 1
fi
python3 - "$object_retention_spoof_dir/release-bundle" <<'PY'
import json
import sys
from pathlib import Path

reports = [
    path
    for path in sorted(Path(sys.argv[1]).glob("*.json"))
    if json.loads(path.read_text(encoding="utf-8")).get("kind") == "release_evidence_bundle"
]
if len(reports) != 1:
    raise SystemExit("spoofed release bundle must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
probe = report.get("canonical_object_retention_cleanup_probe", {})
if probe.get("passed") is not False:
    raise SystemExit("release bundle must reject canonical retention cleanup without verified audit linkage")
missing = set(probe.get("missing_requirements", []))
for expected in ("audit_linkage_verified", "cleanup_audit_refs"):
    if expected not in missing:
        raise SystemExit(f"spoofed canonical retention cleanup missing requirement {expected}: {probe}")
if "canonical_object_storage_retention_cleanup_not_passed" not in report.get("blocking_reasons", []):
    raise SystemExit("spoofed release bundle must preserve canonical retention cleanup blocker")
if report.get("object_retention_cleanup_verified") is not False:
    raise SystemExit("spoofed release bundle must not verify object-retention cleanup")
audit_linkage = probe.get("audit_linkage", {})
if audit_linkage.get("verified") is not False or audit_linkage.get("cleanup_audit_refs") != []:
    raise SystemExit(f"spoofed release bundle must surface failed audit linkage: {audit_linkage}")
PY
object_retention_spoof_semantic_report="$object_retention_spoof_dir/object-storage-retention-cleanup.semantic-spoof.json"
object_retention_spoof_semantic_results="$object_retention_spoof_dir/object-storage-retention-cleanup.semantic-spoof.ndjson"
cp "$object_retention_canonical_report" "$object_retention_spoof_semantic_report"
cp "$object_retention_canonical_results" "$object_retention_spoof_semantic_results"
python3 - "$object_retention_spoof_semantic_report" "$object_retention_spoof_semantic_results" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
report = json.loads(report_path.read_text(encoding="utf-8"))
report["results_path"] = str(results_path)
report["audit_linkage"]["semantic_verified"] = False
report["audit_linkage"]["audit_endpoint_semantic_cleanup_refs"] = []
report["audit_linkage"]["audit_endpoint_semantic_cleanup_refs_by_probe"] = {
    "expired_export_cleanup": [],
    "orphan_cleanup": [],
}
report["audit_linkage"]["audit_endpoint_semantic_missing_cleanup_refs"] = ["au-007", "au-015"]
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
set +e
DRY_RUN=1 \
  OUT_DIR="$object_retention_spoof_dir/release-bundle-semantic-spoof" \
  CANONICAL_OBJECT_RETENTION_REPORT_PATH="$object_retention_spoof_semantic_report" \
  scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_spoof_semantic_status=$?
set -e
if [[ "$release_bundle_spoof_semantic_status" -ne 2 ]]; then
  printf 'release evidence bundle semantic audit spoof must exit 2, got %s\n' "$release_bundle_spoof_semantic_status" >&2
  exit 1
fi
python3 - "$object_retention_spoof_dir/release-bundle-semantic-spoof" <<'PY'
import json
import sys
from pathlib import Path

reports = [
    path
    for path in sorted(Path(sys.argv[1]).glob("*.json"))
    if json.loads(path.read_text(encoding="utf-8")).get("kind") == "release_evidence_bundle"
]
if len(reports) != 1:
    raise SystemExit("semantic spoof release bundle must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
probe = report.get("canonical_object_retention_cleanup_probe", {})
missing = set(probe.get("missing_requirements", []))
if probe.get("passed") is not False:
    raise SystemExit("release bundle must reject canonical retention cleanup without semantic audit linkage")
for expected in (
    "audit_linkage_semantic_verified",
    "no_audit_endpoint_semantic_missing_cleanup_refs",
    "audit_endpoint_semantic_cleanup_refs_by_probe:expired_export_cleanup",
    "audit_endpoint_semantic_cleanup_refs_by_probe:orphan_cleanup",
):
    if expected not in missing:
        raise SystemExit(f"semantic spoof missing requirement {expected}: {probe}")
if report.get("object_retention_cleanup_verified") is not False:
    raise SystemExit("semantic spoof must not verify object-retention cleanup")
PY
object_retention_spoof_missing_request_report="$object_retention_spoof_dir/object-storage-retention-cleanup.missing-request-id.json"
object_retention_spoof_missing_request_results="$object_retention_spoof_dir/object-storage-retention-cleanup.missing-request-id.ndjson"
cp "$object_retention_canonical_report" "$object_retention_spoof_missing_request_report"
cp "$object_retention_canonical_results" "$object_retention_spoof_missing_request_results"
python3 - "$object_retention_spoof_missing_request_report" "$object_retention_spoof_missing_request_results" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
report = json.loads(report_path.read_text(encoding="utf-8"))
report["results_path"] = str(results_path)
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
rows = [json.loads(line) for line in results_path.read_text(encoding="utf-8").splitlines() if line.strip()]
rows[1]["request_id_echoed"] = False
rows[1]["response_request_id_values"] = []
results_path.write_text("\n".join(json.dumps(row, sort_keys=True) for row in rows) + "\n", encoding="utf-8")
PY
set +e
DRY_RUN=1 \
  OUT_DIR="$object_retention_spoof_dir/release-bundle-missing-request-id" \
  CANONICAL_OBJECT_RETENTION_REPORT_PATH="$object_retention_spoof_missing_request_report" \
  scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_spoof_request_status=$?
set -e
if [[ "$release_bundle_spoof_request_status" -ne 2 ]]; then
  printf 'release evidence bundle missing request-id spoof must exit 2, got %s\n' "$release_bundle_spoof_request_status" >&2
  exit 1
fi
python3 - "$object_retention_spoof_dir/release-bundle-missing-request-id" <<'PY'
import json
import sys
from pathlib import Path

reports = [
    path
    for path in sorted(Path(sys.argv[1]).glob("*.json"))
    if json.loads(path.read_text(encoding="utf-8")).get("kind") == "release_evidence_bundle"
]
if len(reports) != 1:
    raise SystemExit("missing request-id spoof release bundle must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
probe = report.get("canonical_object_retention_cleanup_probe", {})
missing = set(probe.get("missing_requirements", []))
if probe.get("passed") is not False:
    raise SystemExit("release bundle must reject canonical retention cleanup without request-id echo")
if "result_request_id_echo:expired_export_cleanup" not in missing:
    raise SystemExit(f"missing request-id spoof must surface request-id echo requirement: {probe}")
if report.get("object_retention_cleanup_verified") is not False:
    raise SystemExit("missing request-id spoof must not verify object-retention cleanup")
PY
object_retention_spoof_audit_request_report="$object_retention_spoof_dir/object-storage-retention-cleanup.missing-audit-request-id.json"
object_retention_spoof_audit_request_results="$object_retention_spoof_dir/object-storage-retention-cleanup.missing-audit-request-id.ndjson"
cp "$object_retention_canonical_report" "$object_retention_spoof_audit_request_report"
cp "$object_retention_canonical_results" "$object_retention_spoof_audit_request_results"
python3 - "$object_retention_spoof_audit_request_report" "$object_retention_spoof_audit_request_results" <<'PY'
import json
import sys
from pathlib import Path

report_path = Path(sys.argv[1])
results_path = Path(sys.argv[2])
report = json.loads(report_path.read_text(encoding="utf-8"))
report["results_path"] = str(results_path)
report["audit_linkage"]["request_id_verified"] = False
report["audit_linkage"]["audit_endpoint_request_id_cleanup_refs_by_probe"] = {
    "expired_export_cleanup": ["au-007"],
    "orphan_cleanup": [],
}
report["audit_linkage"]["audit_endpoint_request_id_missing_cleanup_refs_by_probe"] = {
    "expired_export_cleanup": [],
    "orphan_cleanup": ["au-015"],
}
report["audit_linkage"]["audit_endpoint_request_id_missing_cleanup_refs"] = ["au-015"]
report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
set +e
DRY_RUN=1 \
  OUT_DIR="$object_retention_spoof_dir/release-bundle-missing-audit-request-id" \
  CANONICAL_OBJECT_RETENTION_REPORT_PATH="$object_retention_spoof_audit_request_report" \
  scripts/release_evidence_bundle_smoke.sh >/dev/null
release_bundle_spoof_audit_request_status=$?
set -e
if [[ "$release_bundle_spoof_audit_request_status" -ne 2 ]]; then
  printf 'release evidence bundle missing audit request-id spoof must exit 2, got %s\n' "$release_bundle_spoof_audit_request_status" >&2
  exit 1
fi
python3 - "$object_retention_spoof_dir/release-bundle-missing-audit-request-id" <<'PY'
import json
import sys
from pathlib import Path

reports = [
    path
    for path in sorted(Path(sys.argv[1]).glob("*.json"))
    if json.loads(path.read_text(encoding="utf-8")).get("kind") == "release_evidence_bundle"
]
if len(reports) != 1:
    raise SystemExit("missing audit request-id spoof release bundle must write exactly one report")
report = json.loads(reports[0].read_text(encoding="utf-8"))
probe = report.get("canonical_object_retention_cleanup_probe", {})
missing = set(probe.get("missing_requirements", []))
if probe.get("passed") is not False:
    raise SystemExit("release bundle must reject canonical retention cleanup without audit request-id linkage")
for expected in (
    "audit_linkage_request_id_verified",
    "no_audit_endpoint_request_id_missing_cleanup_refs:orphan_cleanup",
    "audit_endpoint_request_id_cleanup_refs_by_probe:orphan_cleanup",
):
    if expected not in missing:
        raise SystemExit(f"missing audit request-id spoof missing requirement {expected}: {probe}")
if report.get("object_retention_cleanup_verified") is not False:
    raise SystemExit("missing audit request-id spoof must not verify object-retention cleanup")
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
    {"name": "chat_task", "status": "passed", "load_report": "ops/evidence/staging/load-chat-$preflight_sha.json"},
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
if go_no_go.get("gate_fixtures_clear") is not True:
    raise SystemExit("staging smoke dry-run must recognize private beta staging gate fixtures are clear")
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
    "unverified_release_evidence:load_evidence",
):
    if reason not in blocking_reasons:
        raise SystemExit(f"staging smoke dry-run missing blocking reason {reason}")
private_beta_blockers = [reason for reason in blocking_reasons if reason.startswith("gate_fixture_blocked:private_beta_staging:")]
if private_beta_blockers:
    raise SystemExit(f"staging smoke dry-run must not preserve closed private beta blockers: {private_beta_blockers}")
production_context_blocked = go_no_go.get("production_context_blocked_conditions", [])
if not any(item.startswith("production_launch:") for item in production_context_blocked):
    raise SystemExit("staging smoke dry-run must include production gate blockers as context")
if any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking_reasons):
    raise SystemExit("staging smoke dry-run must not let production launch fixture blockers block staging smoke")
decision_inputs = go_no_go.get("decision_inputs", {})
if decision_inputs.get("smoke_passed") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record smoke_passed=false")
if decision_inputs.get("profile_post_deploy") is not True:
    raise SystemExit("staging smoke default dry-run decision inputs must record profile_post_deploy=true")
if decision_inputs.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record post_deploy_smoke_verified=false")
if decision_inputs.get("release_evidence_complete") is not False:
    raise SystemExit("staging smoke dry-run decision inputs must record release_evidence_complete=false")
if decision_inputs.get("gate_fixtures_clear") is not True:
    raise SystemExit("staging smoke dry-run decision inputs must record gate_fixtures_clear=true")
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
    {"name": "chat_task", "status": "passed", "load_report": "staging/load/chat-load-$complete_sha.json"},
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
release_metadata_ci_fixture_dir=".repo-validate-ci-image-refs-$$"
rm -rf "$release_metadata_ci_fixture_dir"
mkdir -p "$release_metadata_ci_fixture_dir"
cp "$complete_validate_dir/release-notes.md" "$release_metadata_ci_fixture_dir/release-notes.md"
cp "$complete_validate_dir/migration.json" "$release_metadata_ci_fixture_dir/migration.json"
cp "$complete_validate_dir/config.json" "$release_metadata_ci_fixture_dir/config.json"
cp "$complete_validate_dir/observability.json" "$release_metadata_ci_fixture_dir/observability.json"
cp "$complete_validate_dir/backup.json" "$release_metadata_ci_fixture_dir/backup.json"
cp "$complete_validate_dir/load.json" "$release_metadata_ci_fixture_dir/load.json"
cp "$complete_validate_dir/rollback.json" "$release_metadata_ci_fixture_dir/rollback.json"
cp "$complete_validate_dir/security.json" "$release_metadata_ci_fixture_dir/security.json"
cat >"$release_metadata_ci_fixture_dir/docker.json" <<EOF
{
  "schema_version": "stage1.ci_docker_image_build.v1",
  "environment": "ci",
  "kind": "ci_docker_image_build",
  "status": "pass",
  "release_gate_check_id": "ci_docker_image_build",
  "release_sha": "$complete_sha",
  "canonical_pass_path": true,
  "dry_run": false,
  "local_devport_debug": false,
  "allow_local_devport_evidence": false,
  "workflow_run": {
    "run_id": "1234567890",
    "run_url": "https://github.com/alphane-ai/zenari/actions/runs/1234567890",
    "workflow_file": ".github/workflows/stage0-rev2-ci.yml",
    "conclusion": "success"
  },
  "evidence_refs": [".github/workflows/stage0-rev2-ci.yml"],
  "image_prefix": "ghcr.io/alphane-ai/zenari",
  "image_set": ["backend", "web", "admin"],
  "images": {
    "backend": {"status": "pass", "tag": "ghcr.io/alphane-ai/zenari-backend:$complete_sha", "digest": "sha256:1111111111111111111111111111111111111111111111111111111111111111", "evidence_refs": ["ghcr.io/alphane-ai/zenari-backend:$complete_sha"]},
    "web": {"status": "pass", "tag": "ghcr.io/alphane-ai/zenari-web:$complete_sha", "digest": "sha256:2222222222222222222222222222222222222222222222222222222222222222", "evidence_refs": ["ghcr.io/alphane-ai/zenari-web:$complete_sha"]},
    "admin": {"status": "pass", "tag": "ghcr.io/alphane-ai/zenari-admin:$complete_sha", "digest": "sha256:3333333333333333333333333333333333333333333333333333333333333333", "evidence_refs": ["ghcr.io/alphane-ai/zenari-admin:$complete_sha"]}
  },
  "gate_impact": {
    "release_gate_check_id": "ci_docker_image_build",
    "can_clear_ci_gate_check": true
  },
  "secret_material_persisted": false,
  "raw_prompt_persisted": false,
  "raw_provider_payload_persisted": false,
  "raw_stripe_payload_persisted": false,
  "raw_support_body_projected": false,
  "signed_url_persisted": false,
  "authorization_header_persisted": false,
  "cookie_persisted": false
}
EOF
set +e
python3 scripts/generate_stage1_release_metadata_preflight.py \
  --evidence "$release_metadata_ci_fixture_dir/preflight.json" \
  --release-sha "$complete_sha" \
  --release-tag "stage0-synthetic" \
  --release-notes-path "$release_metadata_ci_fixture_dir/release-notes.md" \
  --ci-docker-evidence "$release_metadata_ci_fixture_dir/docker.json" \
  --migration-evidence "$release_metadata_ci_fixture_dir/migration.json" \
  --config-diff-evidence "$release_metadata_ci_fixture_dir/config.json" \
  --observability-evidence "$release_metadata_ci_fixture_dir/observability.json" \
  --backup-restore-evidence "$release_metadata_ci_fixture_dir/backup.json" \
  --load-evidence "$release_metadata_ci_fixture_dir/load.json" \
  --rollback-evidence "$release_metadata_ci_fixture_dir/rollback.json" \
  --security-scan-evidence "$release_metadata_ci_fixture_dir/security.json" >/dev/null
release_metadata_ci_status=$?
set -e
if [[ "$release_metadata_ci_status" -ne 0 ]]; then
  printf 'synthetic strict CI Docker evidence must derive image refs and complete metadata, got %s\n' "$release_metadata_ci_status" >&2
  exit 1
fi
python3 - "$release_metadata_ci_fixture_dir/preflight.json" "$complete_sha" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
sha = sys.argv[2]
if report.get("metadata_complete") is not True:
    raise SystemExit(f"CI-derived preflight must complete with strict staging refs: {report}")
source = report.get("image_refs_source", {})
if source.get("source") != "ci_docker_evidence":
    raise SystemExit(f"CI-derived image refs must cite ci_docker_evidence source: {source}")
if source.get("source_verified") is not True or source.get("derived_from_ci_docker_evidence") is not True:
    raise SystemExit(f"CI-derived image refs source must verify: {source}")
refs = report.get("image_refs", [])
if len(refs) < 3:
    raise SystemExit(f"CI-derived image refs must include required images: {refs}")
for name in ("backend", "web", "admin"):
    matches = [ref for ref in refs if name in ref]
    if not matches:
        raise SystemExit(f"CI-derived image refs missing {name}: {refs}")
    if not all(sha in ref and "@sha256:" in ref for ref in matches):
        raise SystemExit(f"CI-derived image refs must be release-SHA tagged immutable refs: {matches}")
slot = report.get("slot_results", {}).get("image_refs", {})
if slot.get("verified") is not True:
    raise SystemExit(f"CI-derived image refs slot must verify: {slot}")
PY
python3 - "$release_metadata_ci_fixture_dir/docker.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
data["canonical_pass_path"] = False
path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY
set +e
python3 scripts/generate_stage1_release_metadata_preflight.py \
  --evidence "$release_metadata_ci_fixture_dir/bad-preflight.json" \
  --release-sha "$complete_sha" \
  --release-tag "stage0-synthetic" \
  --release-notes-path "$release_metadata_ci_fixture_dir/release-notes.md" \
  --ci-docker-evidence "$release_metadata_ci_fixture_dir/docker.json" \
  --migration-evidence "$release_metadata_ci_fixture_dir/migration.json" \
  --config-diff-evidence "$release_metadata_ci_fixture_dir/config.json" \
  --observability-evidence "$release_metadata_ci_fixture_dir/observability.json" \
  --backup-restore-evidence "$release_metadata_ci_fixture_dir/backup.json" \
  --load-evidence "$release_metadata_ci_fixture_dir/load.json" \
  --rollback-evidence "$release_metadata_ci_fixture_dir/rollback.json" \
  --security-scan-evidence "$release_metadata_ci_fixture_dir/security.json" >/dev/null
release_metadata_bad_ci_status=$?
set -e
if [[ "$release_metadata_bad_ci_status" -ne 2 ]]; then
  printf 'bad CI Docker evidence must keep preflight blocked, got %s\n' "$release_metadata_bad_ci_status" >&2
  exit 1
fi
python3 - "$release_metadata_ci_fixture_dir/bad-preflight.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
source = report.get("image_refs_source", {})
if source.get("derived_from_ci_docker_evidence") is not False:
    raise SystemExit(f"bad CI Docker evidence must not derive image refs: {source}")
if "canonical_pass_path" not in source.get("failed_checks", []):
    raise SystemExit(f"bad CI Docker evidence must identify canonical_pass_path failure: {source}")
if report.get("image_refs"):
    raise SystemExit(f"bad CI Docker evidence must leave image refs empty: {report.get('image_refs')}")
if "image_refs" not in report.get("missing_slots", []):
    raise SystemExit("bad CI Docker evidence must keep image_refs missing")
PY
set +e
python3 scripts/generate_stage1_release_metadata_preflight.py \
  --evidence "$release_metadata_ci_fixture_dir/missing-ci-preflight.json" \
  --release-sha "$complete_sha" \
  --release-tag "stage0-synthetic" \
  --release-notes-path "$release_metadata_ci_fixture_dir/release-notes.md" \
  --ci-docker-evidence "$release_metadata_ci_fixture_dir/missing-docker.json" \
  --migration-evidence "$release_metadata_ci_fixture_dir/migration.json" \
  --config-diff-evidence "$release_metadata_ci_fixture_dir/config.json" \
  --observability-evidence "$release_metadata_ci_fixture_dir/observability.json" \
  --backup-restore-evidence "$release_metadata_ci_fixture_dir/backup.json" \
  --load-evidence "$release_metadata_ci_fixture_dir/load.json" \
  --rollback-evidence "$release_metadata_ci_fixture_dir/rollback.json" \
  --security-scan-evidence "$release_metadata_ci_fixture_dir/security.json" >/dev/null
release_metadata_missing_ci_status=$?
set -e
if [[ "$release_metadata_missing_ci_status" -ne 2 ]]; then
  printf 'missing CI Docker evidence must keep preflight blocked, got %s\n' "$release_metadata_missing_ci_status" >&2
  exit 1
fi
python3 - "$release_metadata_ci_fixture_dir/missing-ci-preflight.json" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
source = report.get("image_refs_source", {})
if source.get("reason") != "ci_docker_evidence_not_found":
    raise SystemExit(f"missing CI Docker evidence must record missing reason: {source}")
if report.get("image_refs"):
    raise SystemExit(f"missing CI Docker evidence must leave image refs empty: {report.get('image_refs')}")
if "image_refs" not in report.get("missing_slots", []):
    raise SystemExit("missing CI Docker evidence must keep image_refs missing")
PY
rm -rf "$release_metadata_ci_fixture_dir"
DRY_RUN=1 \
  OUT_DIR="$complete_validate_dir/staging" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenari-backend:$complete_sha,ghcr.io/alphane-ai/zenari-web:$complete_sha,ghcr.io/alphane-ai/zenari-admin:$complete_sha" \
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
if go_no_go.get("gate_fixtures_clear") is not True:
    raise SystemExit("complete-evidence staging smoke dry-run must expose gate_fixtures_clear=true")
if go_no_go.get("decision") != "no-go":
    raise SystemExit("complete-evidence staging smoke dry-run must remain no-go until post-deploy smoke is verified")
blocked = go_no_go.get("blocked_conditions", [])
private_beta_blocked = [item for item in blocked if item.startswith("private_beta_staging:")]
if private_beta_blocked:
    raise SystemExit(f"complete-evidence staging smoke dry-run must not preserve closed private beta blockers: {private_beta_blocked}")
production_context_blocked = go_no_go.get("production_context_blocked_conditions", [])
if not any(item.startswith("production_launch:") for item in production_context_blocked):
    raise SystemExit("complete-evidence staging smoke dry-run must include production blockers as context")
blocking_reasons = go_no_go.get("blocking_reasons", [])
if "staging_smoke_not_passed" not in blocking_reasons:
    raise SystemExit("complete-evidence staging smoke dry-run must still block on missing runtime smoke pass")
if "post_deploy_smoke_contract_unverified" not in blocking_reasons:
    raise SystemExit("complete-evidence staging smoke dry-run must still block on unverified post-deploy smoke evidence")
if any(reason.startswith("missing_release_evidence:") for reason in blocking_reasons):
    raise SystemExit(f"complete-evidence staging smoke dry-run must not report missing release evidence: {blocking_reasons}")
if any(reason.startswith("unverified_release_evidence:") for reason in blocking_reasons):
    raise SystemExit(f"complete-evidence staging smoke dry-run must not report unverified release evidence: {blocking_reasons}")
private_beta_blockers = [reason for reason in blocking_reasons if reason.startswith("gate_fixture_blocked:private_beta_staging:")]
if private_beta_blockers:
    raise SystemExit(f"complete-evidence staging smoke dry-run must not preserve closed private beta blockers: {private_beta_blockers}")
decision_inputs = go_no_go.get("decision_inputs", {})
if decision_inputs != {
    "profile_post_deploy": True,
    "smoke_passed": False,
    "post_deploy_smoke_verified": False,
    "release_evidence_complete": True,
    "gate_fixtures_clear": True,
}:
    raise SystemExit(f"complete-evidence staging smoke decision inputs mismatch: {decision_inputs}")
PY
cat >"$complete_validate_dir/metadata-preflight.json" <<EOF
{
  "schema_version": "stage1.release_metadata_preflight.v1",
  "kind": "stage1_release_metadata_preflight",
  "environment": "staging",
  "status": "passed",
  "release_sha": "$complete_sha",
  "current_git_head": "$complete_sha",
  "release_tag": "stage0-synthetic",
  "release_notes_path": "$complete_validate_dir/release-notes.md",
  "image_refs": [
    "ghcr.io/alphane-ai/zenari-backend:$complete_sha@sha256:1111111111111111111111111111111111111111111111111111111111111111",
    "ghcr.io/alphane-ai/zenari-web:$complete_sha@sha256:2222222222222222222222222222222222222222222222222222222222222222",
    "ghcr.io/alphane-ai/zenari-admin:$complete_sha@sha256:3333333333333333333333333333333333333333333333333333333333333333"
  ],
  "evidence_refs": {
    "migration_evidence": "$complete_validate_dir/migration.json",
    "config_diff_evidence": "$complete_validate_dir/config.json",
    "observability_evidence": "$complete_validate_dir/observability.json",
    "backup_restore_evidence": "$complete_validate_dir/backup.json",
    "load_evidence": "$complete_validate_dir/load.json",
    "rollback_evidence": "$complete_validate_dir/rollback.json",
    "security_scan_evidence": "$complete_validate_dir/security.json"
  },
  "slot_verified": {
    "release_sha": true,
    "release_notes_path": true,
    "image_refs": true,
    "migration_evidence": true,
    "config_diff_evidence": true,
    "observability_evidence": true,
    "backup_restore_evidence": true,
    "load_evidence": true,
    "rollback_evidence": true,
    "security_scan_evidence": true
  },
  "metadata_complete": true,
  "missing_slots": [],
  "unverified_slots": [],
  "blocking_reasons": []
}
EOF
set +e
DRY_RUN=1 \
  OUT_DIR="$complete_validate_dir/release-bundle" \
  RELEASE_METADATA_PREFLIGHT="$complete_validate_dir/metadata-preflight.json" \
  RELEASE_SHA="$complete_sha" \
  RELEASE_NOTES_SHA="$complete_sha" \
  RELEASE_TAG="stage0-synthetic" \
  RELEASE_NOTES_PATH="$complete_validate_dir/release-notes.md" \
  IMAGE_REFS="ghcr.io/alphane-ai/zenari-backend:$complete_sha@sha256:1111111111111111111111111111111111111111111111111111111111111111,ghcr.io/alphane-ai/zenari-web:$complete_sha@sha256:2222222222222222222222222222222222222222222222222222222222222222,ghcr.io/alphane-ai/zenari-admin:$complete_sha@sha256:3333333333333333333333333333333333333333333333333333333333333333" \
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
    raise SystemExit("complete-evidence release bundle dry-run must remain blocked until runtime probes pass")
if report.get("decision") != "no-go":
    raise SystemExit("complete-evidence release bundle dry-run must preserve no-go decision until runtime probes pass")
if report.get("release_sha") != expected_sha:
    raise SystemExit(f"complete-evidence release bundle must forward release SHA: {report}")
if report.get("release_evidence_complete") is not True:
    raise SystemExit("complete-evidence release bundle must forward and verify all release evidence slots")
if report.get("post_deploy_smoke_verified") is not False:
    raise SystemExit("complete-evidence release bundle must not verify runtime post-deploy smoke from dry-run evidence")
if report.get("object_retention_cleanup_verified") is not True:
    raise SystemExit("complete-evidence release bundle must verify canonical object-retention cleanup")
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
if runtime_requirements.get("required_base_url") != "STAGING_API_URL, STAGING_BASE_URL, or explicit probe URL env vars":
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
    raise SystemExit("complete-evidence release bundle must verify canonical legal/support visibility")
if report.get("legal_support_split_reports_verified") is not True:
    raise SystemExit("complete-evidence release bundle must verify canonical legal/support split reports")
if report.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("complete-evidence release bundle must use canonical staging legal/support split evidence")
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
):
    if reason not in blocking:
        raise SystemExit(f"complete-evidence release bundle missing runtime blocker {reason}: {blocking}")
for closed_reason in (
    "legal_support_external_user_visibility_not_passed",
    "canonical_object_storage_retention_cleanup_not_passed",
):
    if closed_reason in blocking:
        raise SystemExit(f"complete-evidence release bundle must not keep closed canonical blocker {closed_reason}: {blocking}")
private_beta_blockers = [reason for reason in blocking if reason.startswith("gate_fixture_blocked:private_beta_staging:")]
if private_beta_blockers:
    raise SystemExit(f"complete-evidence release bundle must not mix gate fixture blockers into bundle blockers: {private_beta_blockers}")
if any(reason.startswith("gate_fixture_blocked:production_launch:") for reason in blocking):
    raise SystemExit("complete-evidence release bundle must keep production fixture blockers out of bundle blockers")
production_context = report.get("production_gate_fixture_blocked_conditions", [])
if not any(item.startswith("production_launch:") for item in production_context):
    raise SystemExit("complete-evidence release bundle must preserve production fixture blockers as context")
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
    raise SystemExit("complete-evidence release bundle must verify canonical legal-pages split evidence")
if split_inputs.get("canonical_support_contact_external_user_verified") is not True:
    raise SystemExit("complete-evidence release bundle must verify canonical support-contact split evidence")
if split_inputs.get("legal_support_evidence_source") != "canonical_staging_split_evidence":
    raise SystemExit("complete-evidence release bundle must use canonical staging legal/support split evidence")
if split_inputs.get("canonical_object_retention_cleanup_verified") is not True:
    raise SystemExit("complete-evidence release bundle must verify canonical object-retention cleanup")
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
  IMAGE_REFS="ghcr.io/alphane-ai/zenari-backend:$complete_sha,ghcr.io/alphane-ai/zenari-web:$complete_sha,ghcr.io/alphane-ai/zenari-admin:$complete_sha" \
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
  IMAGE_REFS="ghcr.io/alphane-ai/zenari-backend:$complete_sha,ghcr.io/alphane-ai/zenari-web:$complete_sha,ghcr.io/alphane-ai/zenari-admin:$complete_sha" \
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

out_dir = Path(sys.argv[1])
reports = sorted(out_dir.glob("*.json"))
if len(reports) != 3:
    raise SystemExit(f"legal/support visibility dry-run must write combined plus two split reports, got {len(reports)}")
report_path = out_dir / "stage0-validate-legal-support-visibility.json"
if not report_path.exists():
    raise SystemExit("legal/support visibility dry-run must write the combined report at the run-id path")
report = json.loads(report_path.read_text(encoding="utf-8"))
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
    "/report-problem",
    "/legal/billing-policy",
}
if set(report.get("required_routes", [])) != required_routes:
    raise SystemExit(f"legal/support visibility required routes mismatch: {report.get('required_routes')}")
runtime_requirements = report.get("runtime_input_requirements", {})
if "STAGING_WEB_URL or WEB_URL" not in runtime_requirements.get("required_web_url", ""):
    raise SystemExit("legal/support visibility dry-run must name the staging web URL input requirement")
if "external-user HTTP GET" not in runtime_requirements.get("required_probe_mode", ""):
    raise SystemExit("legal/support visibility dry-run must name the external-user HTTP probe requirement")
if "source files or checked-in policy text alone cannot satisfy" not in runtime_requirements.get("source_file_policy", ""):
    raise SystemExit("legal/support visibility dry-run must reject source-file-only evidence")
expected_route_contract = {
    "terms": "/legal/terms",
    "privacy": "/legal/privacy",
    "acceptable_use": "/legal/acceptable-use",
    "ip_complaint": "/legal/ip-complaints",
    "ai_content_disclaimer": "/support",
    "support_contact": "/support",
    "report_problem": "/report-problem",
    "billing_policy": "/legal/billing-policy",
}
if runtime_requirements.get("required_routes") != expected_route_contract:
    raise SystemExit(f"legal/support visibility route contract mismatch: {runtime_requirements.get('required_routes')}")
expected_splits = runtime_requirements.get("required_exact_split_reports", {})
if expected_splits.get("legal_pages_external_user") != str(Path(sys.argv[1]) / "legal-pages-external-user.json"):
    raise SystemExit("legal/support visibility dry-run must name the exact legal pages split path")
if expected_splits.get("support_contact_external_user") != str(Path(sys.argv[1]) / "support-contact-external-user.json"):
    raise SystemExit("legal/support visibility dry-run must name the exact support contact split path")
readiness = report.get("input_readiness", {})
if readiness.get("web_url_ready") is not False or readiness.get("dry_run") is not False:
    raise SystemExit(f"legal/support visibility missing-URL run must expose blocked input readiness: {readiness}")
if readiness.get("external_probe_attempted") is not False:
    raise SystemExit("legal/support visibility missing-URL run must not claim external probe execution")
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
split_expectations = {
    "legal-pages-external-user.json": {
        "kind": "legal_pages_external_user_visibility",
        "coverage": {"legal_pages_visibility"},
        "gate_flag": "can_clear_legal_pages_subitem",
    },
    "support-contact-external-user.json": {
        "kind": "support_contact_external_user_visibility",
        "coverage": {"support_contact_visibility", "billing_policy_visibility"},
        "gate_flag": "can_clear_support_contact_subitem",
    },
}
for name, expectation in split_expectations.items():
    path = out_dir / name
    if not path.exists():
        raise SystemExit(f"legal/support visibility dry-run missing split report {name}")
    split = json.loads(path.read_text(encoding="utf-8"))
    if split.get("kind") != expectation["kind"]:
        raise SystemExit(f"{name} has wrong split kind: {split.get('kind')}")
    if split.get("environment") != "staging" or split.get("status") != "blocked":
        raise SystemExit(f"{name} dry-run split must stay blocked/staging-scoped")
    if split.get("release_gate_check_id") != "staging_legal_external_user_pages":
        raise SystemExit(f"{name} split must target legal/support release gate")
    if not split.get("blocked_checks"):
        raise SystemExit(f"{name} dry-run split must record blocked checks")
    split_requirements = split.get("runtime_input_requirements", {})
    if "source files or checked-in policy text alone cannot satisfy" not in split_requirements.get("source_file_policy", ""):
        raise SystemExit(f"{name} split must reject source-file-only evidence")
    if split_requirements.get("source_results_path") != str(out_dir / "stage0-validate-legal-support-visibility.ndjson"):
        raise SystemExit(f"{name} split must bind to combined source results path")
    split_gate = split.get("gate_impact", {})
    if split_gate.get("can_clear_release_gate_check") is not False:
        raise SystemExit(f"{name} split cannot clear the release gate by itself")
    if split_gate.get(expectation["gate_flag"]) is not False:
        raise SystemExit(f"{name} dry-run split subitem must remain blocked")
    split_areas = {item.get("area") for item in split.get("coverage", []) if isinstance(item, dict)}
    if not expectation["coverage"] <= split_areas:
        raise SystemExit(f"{name} split coverage mismatch: {split_areas}")
PY
legal_support_pass_dir="$(mktemp -d)"
legal_support_web_dir="$legal_support_pass_dir/web"
mkdir -p "$legal_support_web_dir/legal/terms" \
  "$legal_support_web_dir/legal/privacy" \
  "$legal_support_web_dir/legal/acceptable-use" \
  "$legal_support_web_dir/legal/ip-complaints" \
  "$legal_support_web_dir/legal/billing-policy" \
  "$legal_support_web_dir/support" \
  "$legal_support_web_dir/report-problem"
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
legal@zenari.ai
support@zenari.ai
EOF
cat >"$legal_support_web_dir/support/index.html" <<'EOF'
AI Content Responsibility
Acceptable Use Policy
Local alpha previews
support@zenari.ai
Report Problem
Submit Ticket
EOF
cat >"$legal_support_web_dir/report-problem/index.html" <<'EOF'
Report Problem
Submit Ticket
project
task
trace
export
quota
EOF
cat >"$legal_support_web_dir/legal/billing-policy/index.html" <<'EOF'
Billing, Cancellation, and Refund Policy
support@zenari.ai
Cancellation
EOF
legal_support_port="$(python3 - <<'PY'
import socket

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(("127.0.0.1", 0))
    print(sock.getsockname()[1])
PY
)"
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -keyout "$legal_support_pass_dir/server.key" \
  -out "$legal_support_pass_dir/server.crt" \
  -subj "/CN=zenari-staging.example.test" \
  -addext "subjectAltName=DNS:zenari-staging.example.test" >/dev/null 2>&1
cat >"$legal_support_pass_dir/https_server.py" <<'PY'
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import ssl
import sys

directory, port, cert_path, key_path = sys.argv[1:]
handler = partial(SimpleHTTPRequestHandler, directory=directory)
server = ThreadingHTTPServer(("127.0.0.1", int(port)), handler)
context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
context.load_cert_chain(certfile=cert_path, keyfile=key_path)
server.socket = context.wrap_socket(server.socket, server_side=True)
server.serve_forever()
PY
python3 "$legal_support_pass_dir/https_server.py" "$legal_support_web_dir" "$legal_support_port" "$legal_support_pass_dir/server.crt" "$legal_support_pass_dir/server.key" >"$legal_support_pass_dir/server.log" 2>&1 &
legal_support_server_pid=$!
for _ in $(seq 1 50); do
  if curl --silent --show-error --max-time 1 --cacert "$legal_support_pass_dir/server.crt" --resolve "zenari-staging.example.test:$legal_support_port:127.0.0.1" --noproxy "zenari-staging.example.test" "https://zenari-staging.example.test:$legal_support_port/legal/terms/" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! curl --silent --show-error --max-time 1 --cacert "$legal_support_pass_dir/server.crt" --resolve "zenari-staging.example.test:$legal_support_port:127.0.0.1" --noproxy "zenari-staging.example.test" "https://zenari-staging.example.test:$legal_support_port/legal/terms/" >/dev/null 2>&1; then
  stop_temp_servers "$legal_support_server_pid"
  printf 'failed to start local legal/support visibility fixture server\n' >&2
  cat "$legal_support_pass_dir/server.log" >&2 || true
  exit 1
fi
RUN_ID="stage0-validate-legal-support-pass" \
  OUT_DIR="$legal_support_pass_dir/out" \
  WEB_URL="https://zenari-staging.example.test:$legal_support_port" \
  WEB_URL_RESOLVE_ADDR="127.0.0.1" \
  WEB_URL_CA_CERT="$legal_support_pass_dir/server.crt" \
  RELEASE_SHA="legal-support-visibility-sha" \
  scripts/staging_legal_support_visibility_smoke.sh >/dev/null
stop_temp_servers "$legal_support_server_pid"
PYTHONDONTWRITEBYTECODE=1 python3 scripts/validate_stage1_staging_legal_support_evidence.py \
  --legal-evidence "$legal_support_pass_dir/out/legal-pages-external-user.json" \
  --support-evidence "$legal_support_pass_dir/out/support-contact-external-user.json"
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
runtime_requirements = report.get("runtime_input_requirements", {})
if "STAGING_WEB_URL or WEB_URL" not in runtime_requirements.get("required_web_url", ""):
    raise SystemExit("legal/support visibility pass fixture must preserve the staging web URL contract")
if "external-user HTTP GET" not in runtime_requirements.get("required_probe_mode", ""):
    raise SystemExit("legal/support visibility pass fixture must preserve the external-user HTTP probe contract")
if "source files or checked-in policy text alone cannot satisfy" not in runtime_requirements.get("source_file_policy", ""):
    raise SystemExit("legal/support visibility pass fixture must reject source-file-only evidence")
readiness = report.get("input_readiness", {})
if readiness.get("web_url_ready") is not True:
    raise SystemExit(f"legal/support visibility pass fixture must expose web_url readiness: {readiness}")
if readiness.get("external_probe_attempted") is not True:
    raise SystemExit(f"legal/support visibility pass fixture must expose external probe execution: {readiness}")
if readiness.get("legal_pages_split_ready") is not True or readiness.get("support_contact_split_ready") is not True:
    raise SystemExit(f"legal/support visibility pass fixture must expose split readiness: {readiness}")
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
        "tokens": ("support", "report_problem", "external-user"),
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
    split_requirements = split.get("runtime_input_requirements", {})
    if "STAGING_WEB_URL or WEB_URL" not in split_requirements.get("required_web_url", ""):
        raise SystemExit(f"{name} must preserve the staging web URL contract")
    if "source files or checked-in policy text alone cannot satisfy" not in split_requirements.get("source_file_policy", ""):
        raise SystemExit(f"{name} must reject source-file-only evidence")
    if split_requirements.get("source_results_path") != str(out_dir / "stage0-validate-legal-support-pass.ndjson"):
        raise SystemExit(f"{name} must cite the exact source probe results path")
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
  git grep -nE "(^|[^A-Za-z0-9_-])(AWS_SECRET_ACCESS_KEY|OPENAI_API_KEY|LLM_OPENAI_API_KEY|ZAI_API_KEY)[[:space:]]*[:=][[:space:]]*[\"']?[A-Za-z0-9._~+/=-]{16,}|(^|[^A-Za-z0-9_-])sk-(proj-)?[A-Za-z0-9_-]{20,}|(^|[^A-Za-z0-9_])ghp_[A-Za-z0-9_]{20,}" -- . >"$secret_candidates" || true
  cp "$secret_candidates" "$secret_findings"
  grep -Ev '^(\.env\.example|fixtures/.*|schemas/.*|ops/ci/stage0-rev2-ci\.yml|scripts/repo_validate\.sh|scripts/security_scan_smoke\.sh|backend/internal/security/redact_test\.go):|^backend/internal/server/server_test\.go:[0-9]+:.*sk-proj-[A-Za-z0-9_-]+|^backend/internal/stage0/services_test\.go:[0-9]+:.*sk-ant-[A-Za-z0-9_-]+' "$secret_findings" >"$secret_candidates.filtered" || true
  mv "$secret_candidates.filtered" "$secret_findings"
  if [[ -s "$secret_findings" ]]; then
    cat "$secret_findings"
    printf 'potential committed secret found\n' >&2
    exit 1
  fi
  rm -f "$secret_candidates" "$secret_findings"
fi

log "repo validation complete"
