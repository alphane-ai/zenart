#!/usr/bin/env python3
"""Validate Stage 1 staging load evidence.

Contract-only mode checks that OP-7 has a precise validator-readable evidence
contract. Strict mode requires canonical production-like staging load evidence
and rejects local-devport, dry-run, legacy-only, unsafe, or partial evidence.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "load" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-load.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-load.ndjson"
DEFAULT_PREFLIGHT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-load.preflight.json"
DEFAULT_BLOCKED_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-load.blocked.json"
DEFAULT_BLOCKED_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-load.blocked.ndjson"
LOAD_SMOKE = ROOT / "scripts" / "load_smoke.sh"
STAGING_OBL_SMOKE = ROOT / "scripts" / "staging_observability_backup_load_smoke.sh"
STAGING_RUNTIME_VALIDATOR = ROOT / "scripts" / "validate_stage1_staging_runtime.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
WEB_BATCH_PLAYWRIGHT = ROOT / "web" / "tests" / "stage1-batch-generation.spec.ts"
WORKER_RUNNER = ROOT / "backend" / "internal" / "worker" / "batch_runner.go"
BATCH_EXECUTOR = ROOT / "backend" / "internal" / "task" / "batch_executor.go"
STRIPE_WEBHOOK = ROOT / "backend" / "internal" / "billing" / "stripe_webhook.go"

REQUIRED_MODES = {
    "chat_task",
    "worker_generation",
    "zip_export",
    "signed_download",
    "crawler_throttle",
    "quota_contention",
    "workspace_rendering",
}
REQUIRED_METRICS = {
    "request_count",
    "error_rate",
    "p95_ms",
    "queue_delay_p95_ms",
    "provider_fallback_rate",
    "export_success_rate",
    "billing_webhook_failure_rate",
}
SAFE_FALSE_FIELDS = {
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
}
SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "api_key",
    "provider_secret",
    "stripe_secret_key",
    "stripe_api_key",
    "webhook_secret",
    "stripe_webhook_secret",
    "billing_webhook_secret",
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_event",
    "raw_response",
    "raw_support_body",
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)
BLOCKED_MARKERS = {
    "blocked",
    "failed",
    "planned",
    "dry_run",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
    "missing_staging_runtime",
    "legacy_stage0_load_only",
}
RESERVED_STAGING_HOST_SUFFIXES = {
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".example.test",
    ".invalid",
    ".localhost",
    ".local",
    ".test",
}


class Stage1LoadEvidenceError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1LoadEvidenceError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise Stage1LoadEvidenceError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    require(path.exists(), f"missing {display_path(path)}")
    rows: list[dict[str, Any]] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise Stage1LoadEvidenceError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
        require(isinstance(row, dict), f"{display_path(path)}:{lineno} must contain a JSON object")
        rows.append(row)
    require(rows, f"{display_path(path)} must contain at least one result row")
    return rows


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")
    return text


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def walk_values(value: Any) -> list[Any]:
    rows = [value]
    if isinstance(value, dict):
        for child in value.values():
            rows.extend(walk_values(child))
    elif isinstance(value, list):
        for child in value:
            rows.extend(walk_values(child))
    return rows


def normalized_string_values(value: Any) -> set[str]:
    return {child.strip().lower() for child in walk_values(value) if isinstance(child, str)}


def number_value(value: Any, field: str) -> float:
    require(isinstance(value, (int, float)) and not isinstance(value, bool), f"{field} must be numeric")
    return float(value)


def is_reserved_or_local_host(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    if not normalized:
        return True
    if normalized in {"localhost", "0.0.0.0"}:
        return True
    if any(normalized == suffix[1:] or normalized.endswith(suffix) for suffix in RESERVED_STAGING_HOST_SUFFIXES):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def validate_strict_staging_url(value: Any, field: str) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required for canonical strict staging evidence")
    parsed = urlparse(value)
    require(parsed.scheme == "https" and parsed.netloc, f"{field} must be an absolute https URL")
    require(
        not is_reserved_or_local_host(parsed.hostname or ""),
        f"{field} must target a real staging host, not localhost/private/reserved test host",
    )


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.load.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "stage1_load_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/staging/stage1-load.json", "contract evidence path mismatch")
    require(contract.get("canonical_results_path") == "ops/evidence/staging/stage1-load.ndjson", "contract results path mismatch")
    require(contract.get("preflight_evidence_path") == "ops/evidence/staging/stage1-load.preflight.json", "preflight evidence path mismatch")
    require(contract.get("preflight_can_clear_staging_gate") is False, "preflight load evidence must not clear staging gate")
    require(contract.get("blocked_diagnostic_evidence_path") == "ops/evidence/staging/stage1-load.blocked.json", "blocked diagnostic evidence path mismatch")
    require(contract.get("blocked_diagnostic_results_path") == "ops/evidence/staging/stage1-load.blocked.ndjson", "blocked diagnostic results path mismatch")
    require(contract.get("blocked_diagnostic_can_clear_staging_gate") is False, "blocked diagnostic load must not clear staging gate")
    require(contract.get("legacy_stage0_load_evidence_path") == "ops/evidence/staging/20260527T2120Z-load.json", "legacy load evidence path mismatch")
    require(contract.get("local_devport_evidence_path") == "ops/evidence/staging/local-devport/stage1-load.local-devport.json", "local-devport evidence path mismatch")
    require(contract.get("local_devport_results_path") == "ops/evidence/staging/local-devport/stage1-load.local-devport.ndjson", "local-devport results path mismatch")
    require(contract.get("local_devport_can_clear_staging_gate") is False, "local devport load must not clear staging gate")
    require(contract.get("strict_schema_version") == "stage1.load.v1", "strict schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_staging_load_evidence_open", "contract must keep staging load evidence open")
    require(contract.get("required_environment") == "staging", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "staging_observability_backup_load", "contract release gate check mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")
    strict_target = contract.get("strict_staging_target_policy")
    require(isinstance(strict_target, dict), "strict_staging_target_policy must be object")
    require(strict_target.get("require_absolute_https_urls") is True, "strict staging target policy must require absolute https URLs")
    require(strict_target.get("reject_reserved_test_domains") is True, "strict staging target policy must reject reserved test domains")
    require(strict_target.get("reject_localhost_private_link_local_ips") is True, "strict staging target policy must reject local/private IPs")
    require(strict_target.get("required_target_urls") == ["api", "web", "admin"], "strict staging target policy URL list mismatch")
    require("example.test" in set(strict_target.get("reserved_domain_examples") or []), "strict staging target policy must name example.test")
    require(REQUIRED_MODES <= set(contract.get("required_modes") or []), "contract missing required modes")
    require(REQUIRED_MODES <= set(contract.get("required_result_rows") or []), "contract missing result rows")
    preflight = contract.get("preflight_policy")
    require(isinstance(preflight, dict), "preflight_policy must be object")
    require(preflight.get("load_mode") == "preflight_stage1", "preflight_policy load_mode mismatch")
    require(preflight.get("status_ready_does_not_clear_gate") is True, "preflight ready must not clear gate")
    require(preflight.get("requires_target_urls") == ["api", "web", "admin"], "preflight target URL list mismatch")
    require(preflight.get("requires_release_sha_full_length") is True, "preflight must require full release SHA")
    require(preflight.get("requires_canonical_write_enabled") is True, "preflight must require canonical write opt-in")
    require(preflight.get("blocked_by_default_local_devport") is True, "preflight must block default local devport inputs")
    require(REQUIRED_METRICS <= set(contract.get("required_metrics") or []), "contract missing required metrics")
    thresholds = contract.get("required_thresholds")
    require(isinstance(thresholds, dict), "required_thresholds must be object")
    for key in (
        "min_requests_per_mode",
        "min_concurrency",
        "max_error_rate",
        "max_p95_ms",
        "max_queue_delay_ms",
        "max_provider_fallback_rate",
        "max_billing_webhook_failure_rate",
    ):
        require(isinstance(thresholds.get(key), (int, float)), f"required_thresholds.{key} must be numeric")
    policy = contract.get("safe_projection_policy")
    require(isinstance(policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    require(strict.get("environment") == "staging", "strict policy environment mismatch")
    require(strict.get("kind") == "stage1_load", "strict policy kind mismatch")
    require(strict.get("status") == "pass", "strict policy status mismatch")
    for key in (
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run",
        "allow_legacy_stage0_load_only",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")
    for key in (
        "all_modes_required",
        "result_rows_required",
        "thresholds_must_pass",
        "safe_projection_must_pass",
        "canonical_pass_path_required",
        "gate_impact_can_clear_load_slot_required",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    generator = contract.get("generator_safety_policy")
    require(isinstance(generator, dict), "generator_safety_policy must be object")
    for key in (
        "canonical_paths_are_never_written_before_candidate_validation",
        "strict_validator_required_before_canonical_replace",
        "pass_evidence_written_only_after_strict_validator_accepts",
        "canonical_outputs_are_atomic",
        "failed_strict_candidate_writes_blocked_evidence_only",
    ):
        require(generator.get(key) is True, f"generator_safety_policy.{key} must be true")


def validate_code_anchors() -> None:
    require(LOAD_SMOKE.exists() and LOAD_SMOKE.stat().st_mode & 0o111, "scripts/load_smoke.sh must be executable")
    require_text(
        LOAD_SMOKE,
        (
            "chat_task",
            "worker_generation",
            "zip_export",
            "signed_download",
            "crawler_throttle",
            "quota_contention",
            "workspace_rendering",
            "preflight_stage1",
            "stage1-load.preflight.json",
            "stage1_load_preflight",
            "canonical_write_enabled",
            "blocked_stage1",
            "stage1-load.blocked.json",
            "stage1-load.blocked.ndjson",
            "blocked_diagnostic_report",
            "target_urls",
            "production_like_staging_targets",
            "pass_evidence_written_only_after_strict_validator_accepts",
            "canonical_outputs_are_atomic",
            "failed_strict_candidate_writes_blocked_evidence_only",
            "p95_ms",
            "DRY_RUN",
            "validate_stage1_load_evidence.py --evidence",
            "os.replace(candidate_report, canonical_report)",
        ),
    )
    require_text(STAGING_OBL_SMOKE, ("load_evidence", "staging_observability_backup_load", "verified_load_entries"))
    require_text(STAGING_RUNTIME_VALIDATOR, ("staging_observability_backup_load_smoke.sh", "observability", "backup_restore"))
    require_text(BLUEPRINT, ("OP-7", "ops/evidence/staging/stage1-load.json", "p95", "队列延迟"))
    require_text(GAP_INVENTORY, ("OP-7", "Load, observability, and backup/restore staging evidence remain open"))
    require_text(REPO_VALIDATE, ("validate_stage1_load_evidence.py --contract-only", "scripts/load_smoke.sh", "workspace_rendering", "preflight_stage1"))
    require_text(WEB_BATCH_PLAYWRIGHT, ("create, progress, retry, and cancel", "progressbar"))
    require_text(WORKER_RUNNER, ("BatchRunner", "RunOnce"))
    require_text(BATCH_EXECUTOR, ("BatchChildExecutor", "provider"))
    require_text(STRIPE_WEBHOOK, ("webhook", "livemode"))


def validate_mode_row(row: dict[str, Any], thresholds: dict[str, Any]) -> None:
    mode = row.get("mode")
    require(mode in REQUIRED_MODES, f"unexpected load mode {mode!r}")
    require(row.get("status") in {"pass", "passed"}, f"{mode} status must pass")
    metrics = row.get("metrics")
    require(isinstance(metrics, dict), f"{mode} metrics must be object")
    require(number_value(metrics.get("request_count"), f"{mode}.request_count") >= number_value(thresholds["min_requests_per_mode"], "min_requests_per_mode"), f"{mode} request_count below threshold")
    require(number_value(metrics.get("error_rate"), f"{mode}.error_rate") <= number_value(thresholds["max_error_rate"], "max_error_rate"), f"{mode} error_rate above threshold")
    require(number_value(metrics.get("p95_ms"), f"{mode}.p95_ms") <= number_value(thresholds["max_p95_ms"], "max_p95_ms"), f"{mode} p95_ms above threshold")
    require(number_value(metrics.get("queue_delay_p95_ms"), f"{mode}.queue_delay_p95_ms") <= number_value(thresholds["max_queue_delay_ms"], "max_queue_delay_ms"), f"{mode} queue_delay_p95_ms above threshold")
    require(number_value(metrics.get("provider_fallback_rate"), f"{mode}.provider_fallback_rate") <= number_value(thresholds["max_provider_fallback_rate"], "max_provider_fallback_rate"), f"{mode} provider_fallback_rate above threshold")
    require(number_value(metrics.get("export_success_rate"), f"{mode}.export_success_rate") >= 1.0 - number_value(thresholds["max_error_rate"], "max_error_rate"), f"{mode} export_success_rate below threshold")
    require(number_value(metrics.get("billing_webhook_failure_rate"), f"{mode}.billing_webhook_failure_rate") <= number_value(thresholds["max_billing_webhook_failure_rate"], "max_billing_webhook_failure_rate"), f"{mode} billing_webhook_failure_rate above threshold")
    for field in ("request_id_ref", "trace_ref", "audit_ref"):
        require(isinstance(row.get(field), str) and row[field].strip(), f"{mode} must include {field}")
    require(isinstance(row.get("evidence_refs"), list) and row["evidence_refs"], f"{mode} evidence_refs must be non-empty")


def validate_evidence(evidence_path: Path, results_path: Path, allow_local_devport: bool = False) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "evidence")
    assert_no_secret(rows, "results")

    require(data.get("schema_version") == "stage1.load.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "load evidence must be staging")
    require(data.get("kind") == "stage1_load", "kind mismatch")
    if allow_local_devport:
        require(data.get("status") == "blocked", "local-devport load evidence must stay blocked")
        require(data.get("local_devport_debug") is True, "local-devport load evidence must mark local_devport_debug")
        require(data.get("allow_local_devport_evidence") is True, "local-devport load evidence must mark allow_local_devport_evidence")
        require(data.get("canonical_pass_path") is False, "local-devport load evidence must not claim canonical pass path")
        require(
            data.get("blocked_checks") == ["local_devport_debug_evidence_cannot_clear_staging_gate"],
            "local-devport load evidence must only be blocked by debug gate policy",
        )
    else:
        require(data.get("status") == "pass", "status must be pass")
        require(data.get("canonical_pass_path") is True, "canonical_pass_path must be true")
        require(data.get("local_devport_debug") is False, "local_devport_debug must be false")
        require(data.get("allow_local_devport_evidence") is False, "allow_local_devport_evidence must be false")
    require(data.get("release_gate_check_id") == "staging_observability_backup_load", "release gate check mismatch")
    require(data.get("legacy_stage0_load_only") is False, "legacy_stage0_load_only must be false")
    require(data.get("dry_run") is False, "dry_run must be false")
    if not allow_local_devport:
        require(
            isinstance(data.get("release_sha"), str) and re.fullmatch(r"[0-9a-f]{40}", data["release_sha"]),
            "release_sha must be full 40-character lowercase hex for strict canonical load evidence",
        )
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    if not allow_local_devport:
        strings = normalized_string_values(data) | normalized_string_values(rows)
        blocked = sorted(strings & BLOCKED_MARKERS)
        require(not blocked, f"evidence contains blocked/local/dry-run marker(s): {blocked}")
        target_urls = data.get("target_urls")
        require(isinstance(target_urls, dict), "target_urls must be object for strict canonical load evidence")
        for key in ("api", "web", "admin"):
            validate_strict_staging_url(target_urls.get(key), f"target_urls.{key}")
        input_readiness = data.get("input_readiness")
        require(isinstance(input_readiness, dict), "input_readiness must be object")
        for key in (
            "api_url_ready",
            "web_url_ready",
            "admin_url_ready",
            "release_sha_provided",
            "release_sha_full_length",
            "canonical_pass_path",
            "production_like_staging_targets",
        ):
            require(input_readiness.get(key) is True, f"input_readiness.{key} must be true")
    thresholds = contract["required_thresholds"]
    require(number_value(data.get("requests_per_mode"), "requests_per_mode") >= number_value(thresholds["min_requests_per_mode"], "min_requests_per_mode"), "requests_per_mode below threshold")
    require(number_value(data.get("concurrency"), "concurrency") >= number_value(thresholds["min_concurrency"], "min_concurrency"), "concurrency below threshold")

    mode_ids = {row.get("mode") for row in rows}
    require(REQUIRED_MODES <= mode_ids, f"missing load mode rows {sorted(REQUIRED_MODES - mode_ids)}")
    for row in rows:
        validate_mode_row(row, thresholds)
    summary = data.get("summary")
    require(isinstance(summary, dict), "summary must be object")
    require(REQUIRED_METRICS <= set(summary), "summary missing required metrics")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    if allow_local_devport:
        require(gate.get("can_clear_load_slot") is False, "local-devport load evidence cannot clear load slot")
        require(gate.get("preserved_release_gate_check_id") == "staging_observability_backup_load", "local-devport load evidence must preserve release gate")
    else:
        require(gate.get("can_clear_load_slot") is True, "gate_impact.can_clear_load_slot must be true")
    require(gate.get("can_clear_stage1_staging_runtime_gate") is False, "load evidence alone must not clear Stage 1 staging runtime")
    require(gate.get("release_gate_check_id") == "staging_observability_backup_load", "gate_impact release gate mismatch")
    if not allow_local_devport:
        probe_contract = data.get("probe_contract")
        require(isinstance(probe_contract, dict), "probe_contract must be object")
        for key in (
            "pass_evidence_written_only_after_strict_validator_accepts",
            "canonical_outputs_are_atomic",
            "failed_strict_candidate_writes_blocked_evidence_only",
        ):
            require(probe_contract.get(key) is True, f"probe_contract.{key} must be true")


def validate_blocked_diagnostic(evidence_path: Path, results_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "blocked_diagnostic")
    assert_no_secret(rows, "blocked_diagnostic_results")

    require(data.get("schema_version") == "stage1.load.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "blocked diagnostic load evidence must be staging")
    require(data.get("kind") == "stage1_load", "kind mismatch")
    require(data.get("status") == "blocked", "blocked diagnostic status must be blocked")
    require(data.get("release_gate_check_id") == "staging_observability_backup_load", "release gate check mismatch")
    require(data.get("canonical_pass_path") is False, "blocked diagnostic must not claim canonical pass path")
    require(data.get("legacy_stage0_load_only") is False, "legacy_stage0_load_only must be false")
    require(data.get("local_devport_debug") is False, "blocked diagnostic must not be local-devport debug evidence")
    require(data.get("allow_local_devport_evidence") is False, "blocked diagnostic must not allow local-devport evidence")
    require(data.get("dry_run") is False, "blocked diagnostic must not be dry-run evidence")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    blocked_checks = data.get("blocked_checks")
    require(
        blocked_checks == ["missing_production_like_staging_load_runtime"],
        "blocked diagnostic must identify only missing production-like staging load runtime",
    )
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("release_gate_check_id") == "staging_observability_backup_load", "gate_impact release gate mismatch")
    require(gate.get("can_clear_load_slot") is False, "blocked diagnostic cannot clear load slot")
    require(gate.get("can_clear_stage1_staging_runtime_gate") is False, "blocked diagnostic cannot clear Stage 1 staging runtime")
    require(gate.get("preserved_release_gate_check_id") == "staging_observability_backup_load", "blocked diagnostic must preserve release gate")
    require(gate.get("preserved_do_not_launch_condition_id") == "stage1_load_runtime_missing", "blocked diagnostic must preserve DNL condition")

    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "probe_contract must be object")
    require(probe_contract.get("canonical_pass_report") == "ops/evidence/staging/stage1-load.json", "probe_contract canonical report mismatch")
    require(probe_contract.get("canonical_pass_results") == "ops/evidence/staging/stage1-load.ndjson", "probe_contract canonical results mismatch")
    require(probe_contract.get("blocked_diagnostic_report") == "ops/evidence/staging/stage1-load.blocked.json", "probe_contract blocked report mismatch")
    require(probe_contract.get("blocked_diagnostic_results") == "ops/evidence/staging/stage1-load.blocked.ndjson", "probe_contract blocked results mismatch")
    require(probe_contract.get("blocked_diagnostic_can_clear_staging_gate") is False, "probe_contract must keep blocked diagnostic non-clearing")

    require(number_value(data.get("requests_per_mode"), "requests_per_mode") >= 0, "requests_per_mode must be non-negative")
    require(number_value(data.get("concurrency"), "concurrency") >= 0, "concurrency must be non-negative")
    summary = data.get("summary")
    require(isinstance(summary, dict), "summary must be object")
    require(REQUIRED_METRICS <= set(summary), "summary missing required metrics")

    mode_ids = {row.get("mode") for row in rows}
    require(REQUIRED_MODES <= mode_ids, f"missing blocked load mode rows {sorted(REQUIRED_MODES - mode_ids)}")
    for row in rows:
        mode = row.get("mode")
        require(mode in REQUIRED_MODES, f"unexpected blocked load mode {mode!r}")
        require(row.get("status") == "blocked", f"{mode} blocked diagnostic row status must be blocked")
        require(row.get("blocked_checks") == blocked_checks, f"{mode} blocked checks mismatch")
        metrics = row.get("metrics")
        require(isinstance(metrics, dict), f"{mode} metrics must be object")
        require(REQUIRED_METRICS <= set(metrics), f"{mode} metrics missing required keys")
        for field in ("request_id_ref", "trace_ref", "audit_ref"):
            require(isinstance(row.get(field), str) and row[field].strip(), f"{mode} must include {field}")
        require(isinstance(row.get("evidence_refs"), list) and row["evidence_refs"], f"{mode} evidence_refs must be non-empty")


def validate_preflight(evidence_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    assert_no_secret(data, "preflight")

    require(data.get("schema_version") == "stage1.load.preflight.v1", "preflight schema_version mismatch")
    require(data.get("environment") == "staging", "preflight environment must be staging")
    require(data.get("kind") == "stage1_load_preflight", "preflight kind mismatch")
    require(data.get("status") in {"ready", "blocked"}, "preflight status must be ready or blocked")
    require(data.get("release_gate_check_id") == "staging_observability_backup_load", "preflight release gate check mismatch")
    require(data.get("canonical_pass_report") == "ops/evidence/staging/stage1-load.json", "preflight canonical report mismatch")
    require(data.get("canonical_pass_results") == "ops/evidence/staging/stage1-load.ndjson", "preflight canonical results mismatch")
    require(data.get("preflight_report") == "ops/evidence/staging/stage1-load.preflight.json", "preflight report path mismatch")
    require(data.get("can_clear_load_slot") is False, "preflight cannot clear load slot")
    require(data.get("can_clear_stage1_staging_runtime_gate") is False, "preflight cannot clear Stage 1 staging runtime")
    require(data.get("canonical_pass_path") is False, "preflight must not claim canonical pass path")
    targets = data.get("target_summaries")
    require(isinstance(targets, dict), "preflight target_summaries must be object")
    for key in ("api", "web", "admin"):
        target = targets.get(key)
        require(isinstance(target, dict), f"preflight target_summaries.{key} must be object")
        require(isinstance(target.get("ready"), bool), f"preflight target_summaries.{key}.ready must be boolean")
        require(isinstance(target.get("host"), str) and target["host"], f"preflight target_summaries.{key}.host must be present")
        require(isinstance(target.get("issues"), list), f"preflight target_summaries.{key}.issues must be list")
    readiness = data.get("input_readiness")
    require(isinstance(readiness, dict), "preflight input_readiness must be object")
    for key in (
        "api_url_ready",
        "web_url_ready",
        "admin_url_ready",
        "release_sha_provided",
        "release_sha_full_length",
        "requests_per_mode_ready",
        "concurrency_ready",
        "canonical_write_enabled",
    ):
        require(isinstance(readiness.get(key), bool), f"preflight input_readiness.{key} must be boolean")
    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list), "preflight blocked_checks must be list")
    expected_blockers = sorted(key for key, ready in readiness.items() if ready is not True)
    require(sorted(blocked_checks) == expected_blockers, "preflight blocked_checks must mirror false input readiness")
    if data.get("status") == "ready":
        require(not blocked_checks, "ready preflight must have no blocked checks")
    else:
        require(blocked_checks, "blocked preflight must list blocked checks")
    command = data.get("next_command_contract")
    require(isinstance(command, dict), "preflight next_command_contract must be object")
    require(command.get("command") == "WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE=1 LOAD_MODE=all scripts/load_smoke.sh", "preflight next command mismatch")
    require(command.get("requires_non_local_https_targets") is True, "preflight must require production-like staging targets")
    safe = data.get("safe_projection_policy")
    require(isinstance(safe, dict), "preflight safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe.get(field) is False, f"preflight safe_projection_policy.{field} must be false")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-local-devport", action="store_true", help="allow localhost/private dev-port debug evidence without clearing staging gates")
    parser.add_argument("--allow-blocked-diagnostic", action="store_true", help="validate blocked diagnostic evidence shape without clearing staging gates")
    parser.add_argument("--allow-preflight", action="store_true", help="validate Stage 1 load preflight shape without clearing staging gates")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="Stage 1 load evidence JSON path")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="Stage 1 load evidence NDJSON path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_blocked_diagnostic:
            evidence_path = DEFAULT_BLOCKED_EVIDENCE if args.evidence == str(DEFAULT_EVIDENCE) else Path(args.evidence)
            results_path = DEFAULT_BLOCKED_RESULTS if args.results == str(DEFAULT_RESULTS) else Path(args.results)
            validate_blocked_diagnostic(evidence_path, results_path)
        elif args.allow_preflight:
            evidence_path = DEFAULT_PREFLIGHT_EVIDENCE if args.evidence == str(DEFAULT_EVIDENCE) else Path(args.evidence)
            validate_preflight(evidence_path)
        else:
            validate_evidence(Path(args.evidence), Path(args.results), allow_local_devport=args.allow_local_devport)
    except Stage1LoadEvidenceError as exc:
        print(f"stage1 load evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 load evidence contract passed")
    else:
        print("stage1 load evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
