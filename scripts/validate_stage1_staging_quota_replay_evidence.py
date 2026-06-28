#!/usr/bin/env python3
"""Validate Stage 1 staging quota replay evidence.

Contract-only mode validates the evidence contract and code anchors. Strict mode
requires canonical production-like staging evidence generated from deployed
Postgres batch/quota/provider usage rows. Local runtime replay fixtures remain
local-only and cannot clear this validator.
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
CONTRACT = ROOT / "fixtures" / "stage1" / "staging_quota_replay" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-quota-replay.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-quota-replay.ndjson"
DEFAULT_PREFLIGHT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-quota-replay.preflight.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_staging_quota_replay_evidence.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
LOCAL_REPLAY_VALIDATOR = ROOT / "scripts" / "validate_stage1_batch_quota_runtime_replay.py"
WORKER_REPLAY_TEST = ROOT / "backend" / "internal" / "worker" / "batch_quota_runtime_replay_test.go"
BATCH_LEDGER = ROOT / "backend" / "internal" / "task" / "batch_quota_ledger.go"
BATCH_REPOSITORY = ROOT / "backend" / "internal" / "task" / "batch_repository.go"
BILLING = ROOT / "backend" / "internal" / "billing" / "billing.go"

REQUIRED_EVENT_KINDS = {
    "reserve",
    "commit",
    "refund",
    "retry_scheduled",
    "dead_letter_refund",
    "manual_retry_rereserve",
    "provider_usage_debit",
    "provider_usage_credit",
}
REQUIRED_TABLES = {
    "batch_generation_requests",
    "generation_child_tasks",
    "quota_buckets",
    "quota_transactions",
    "provider_usage_logs",
}
REQUIRED_COMPONENTS = {
    "BatchRunner.RunOnce",
    "BatchChildExecutor.ExecuteClaimedChild",
    "PostgresBatchQuotaLedger.ReserveBatchQuota",
    "PostgresBatchQuotaLedger.CommitBatchQuota",
    "PostgresBatchQuotaLedger.RefundBatchQuota",
    "BatchRepository.RetryChild",
    "QuotaRepository.ReconcileProviderUsage",
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
    "database_url_persisted",
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
    "database_url",
    "staging_database_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(postgres(?:ql)?://[^\\s\"']+|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\\.[A-Za-z0-9_-]{16,}|Bearer\\s+[A-Za-z0-9._~+/=-]{8,}|"
    r"Stripe-Signature\\s*[:=]|t=\\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)
BLOCKED_MARKERS = {
    "blocked",
    "failed",
    "planned",
    "dry_run",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
    "missing_staging_quota_replay_inputs",
    "staging_quota_replay_evidence_incomplete",
    "local_runtime_replay_only",
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


class StagingQuotaReplayError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise StagingQuotaReplayError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise StagingQuotaReplayError(f"{display_path(path)} invalid JSON: {exc}") from exc
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
            raise StagingQuotaReplayError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
        require(isinstance(row, dict), f"{display_path(path)}:{lineno} must contain a JSON object")
        rows.append(row)
    require(rows, f"{display_path(path)} must contain at least one row")
    return rows


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


def validate_staging_url(value: Any, field: str) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required")
    parsed = urlparse(value)
    require(parsed.scheme == "https", f"{field} must be https")
    host = parsed.hostname or ""
    require(not is_reserved_or_local_host(host), f"{field} must not use localhost/private/reserved host")
    require(not parsed.username and not parsed.password, f"{field} must not include credentials")
    require(not parsed.query and not parsed.fragment, f"{field} must not include query or fragment")


def int_value(obj: dict[str, Any], key: str, context: str) -> int:
    value = obj.get(key)
    require(isinstance(value, int) and not isinstance(value, bool), f"{context}.{key} must be an integer")
    return int(value)


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.staging_quota_replay.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "staging_quota_replay_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/staging/stage1-quota-replay.json", "canonical evidence path mismatch")
    require(contract.get("canonical_results_path") == "ops/evidence/staging/stage1-quota-replay.ndjson", "canonical results path mismatch")
    require(contract.get("preflight_evidence_path") == "ops/evidence/staging/stage1-quota-replay.preflight.json", "preflight evidence path mismatch")
    require(contract.get("preflight_can_clear_staging_gate") is False, "preflight quota replay evidence must not clear staging gate")
    require(contract.get("strict_schema_version") == "stage1.staging_quota_replay.v1", "strict schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_staging_quota_replay_open", "contract must not close staging gate")
    require(set(contract.get("required_runtime_components") or []) >= REQUIRED_COMPONENTS, "contract missing runtime components")
    require(set(contract.get("required_event_kinds") or []) >= REQUIRED_EVENT_KINDS, "contract missing event kinds")
    require(set(contract.get("required_source_tables") or []) >= REQUIRED_TABLES, "contract missing source tables")
    required_inputs = " ".join(str(item) for item in contract.get("required_staging_inputs") or [])
    require("STAGING_API_URL" in required_inputs, "contract must allow quota replay API to reuse STAGING_API_URL")
    require("STAGING_QUOTA_REPLAY_API_URL" in required_inputs, "contract must keep dedicated quota replay API override")
    preflight = contract.get("preflight_policy")
    require(isinstance(preflight, dict), "preflight_policy must be object")
    require(preflight.get("generator_flag") == "--preflight", "preflight generator flag mismatch")
    require(preflight.get("status_ready_does_not_clear_gate") is True, "preflight ready must not clear gate")
    require(preflight.get("requires_non_local_https_staging_api") is True, "preflight must require non-local HTTPS staging API")
    require(preflight.get("requires_real_deployed_postgres") is True, "preflight must require real deployed Postgres")
    require(preflight.get("requires_tenant_and_batch_ids") is True, "preflight must require tenant and batch IDs")
    require(preflight.get("database_url_persisted") is False, "preflight must not persist database URL")
    require(preflight.get("hashes_tenant_and_batch_ids") is True, "preflight must hash tenant and batch IDs")
    generator_safety = contract.get("generator_safety_policy")
    require(isinstance(generator_safety, dict), "generator_safety_policy must be object")
    for key in (
        "strict_input_precheck_required",
        "invalid_strict_inputs_write_blocked_evidence_only",
        "pass_evidence_written_only_after_strict_validator_accepts",
        "canonical_outputs_are_atomic",
        "staging_api_url_sanitized_on_blocked_output",
    ):
        require(generator_safety.get(key) is True, f"generator_safety_policy.{key} must be true")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    for key in (
        "require_https_staging_url",
        "require_canonical_pass_path",
        "require_real_database_read",
        "require_retry_dead_letter_manual_retry",
        "require_provider_usage_debit_credit",
        "require_idempotent_replay",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in ("allow_local_devport_debug", "allow_local_devport_evidence", "allow_dry_run"):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")
    safe = contract.get("safe_projection_policy")
    require(isinstance(safe, dict), "safe_projection_policy must be object")
    for key in SAFE_FALSE_FIELDS:
        require(safe.get(key) is False, f"safe_projection_policy.{key} must be false")


def validate_code_anchors() -> None:
    require(GENERATOR.exists(), "missing scripts/generate_stage1_staging_quota_replay_evidence.py")
    require(GENERATOR.stat().st_mode & 0o111 != 0, "generate_stage1_staging_quota_replay_evidence.py must be executable")
    require_text(
        GENERATOR,
        (
            "stage1-quota-replay.json",
            "stage1-quota-replay.blocked.json",
            "stage1-quota-replay.preflight.json",
            "stage1_staging_quota_replay_preflight",
            "--preflight",
            "database_url_persisted",
            "tenant_id_hash",
            "batch_id_hash",
            "STAGING_DATABASE_URL",
            "STAGING_API_URL",
            "STAGING_QUOTA_REPLAY_API_URL",
            "STAGING_QUOTA_REPLAY_API_URL can override the general STAGING_API_URL",
            "strict_input_blockers",
            "public_staging_api_ref",
            "write_validated_canonical",
            "tmp_evidence.replace(evidence_path)",
            "batch_generation_requests",
            "generation_child_tasks",
            "quota_transactions",
            "provider_usage_logs",
            "missing_staging_quota_replay_inputs",
            'assert_no_secret(report, "report")',
            'assert_no_secret(rows, "results")',
        ),
    )
    require_text(
        LOCAL_REPLAY_VALIDATOR,
        (
            "local runtime replay evidence",
            "real staging quota reconciliation replay",
            "BatchRunner.RunOnce",
            "QuotaRepository.ReconcileProviderUsage",
        ),
    )
    require_text(WORKER_REPLAY_TEST, ("TestBatchQuotaRuntimeReplayProducesEvidenceFixture", "Local runtime replay evidence only;"))
    require_text(BATCH_LEDGER, ("BatchChildQuotaIdempotencyKey", "\":attempt:\"", "ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING"))
    require_text(BATCH_REPOSITORY, ("manual_retry_requested", "ReserveBatchQuota(ctx, r.db, retryReservation)", "'dead_letter_state', 'not_dead_lettered'"))
    require_text(BILLING, ("ReconcileProviderUsage", "provider_usage_debit", "provider_usage_credit", "UPDATE provider_usage_logs"))
    require_text(REPO_VALIDATE, ("validate_stage1_staging_quota_replay_evidence.py --contract-only", "generate_stage1_staging_quota_replay_evidence.py --contract-only", "--preflight"))
    require_text(GAP_INVENTORY, ("staging quota replay evidence", "real deployed Postgres/provider usage logs", "Strict staging quota replay remains open"))


def validate_event_row(row: dict[str, Any]) -> None:
    context = str(row.get("event_id") or row.get("child_id") or "result")
    kind = row.get("kind")
    require(kind in REQUIRED_EVENT_KINDS, f"{context}.kind {kind!r} is unsupported")
    require(row.get("environment") == "staging", f"{context}.environment must be staging")
    require(row.get("source_table") in REQUIRED_TABLES, f"{context}.source_table invalid")
    require(isinstance(row.get("source_component"), str) and row["source_component"], f"{context}.source_component is required")
    if kind in {"reserve", "commit", "refund", "dead_letter_refund", "manual_retry_rereserve"}:
        require(isinstance(row.get("idempotency_key_hash"), str) and len(row["idempotency_key_hash"]) >= 12, f"{context} must expose hashed idempotency key")
        require("idempotency_key" not in row, f"{context} must not expose raw idempotency_key")
        require(int_value(row, "units", context) > 0, f"{context}.units must be positive")
        require(row.get("idempotent_on_replay") is True, f"{context} must be idempotent on replay")
    if kind == "retry_scheduled":
        require(row.get("quota_transaction") == "none", f"{context} retry_scheduled must not write quota transaction")
        require(row.get("retry_state") == "scheduled", f"{context} retry_state must be scheduled")
    if kind == "dead_letter_refund":
        require(row.get("dead_letter_state") == "dead_lettered", f"{context} must be dead_lettered")
    if kind == "manual_retry_rereserve":
        require(row.get("manual_retry_requested") is True, f"{context} must prove manual retry request")
    if kind in {"provider_usage_debit", "provider_usage_credit"}:
        require(int_value(row, "provider_log_count", context) > 0, f"{context}.provider_log_count must be positive")
        require(int_value(row, "adjusted_units", context) > 0, f"{context}.adjusted_units must be positive")
        require(row.get("provider_usage_reconciled") is True, f"{context} must mark provider usage reconciled")


def validate_evidence(evidence_path: Path, results_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "evidence")
    assert_no_secret(rows, "results")

    require(data.get("schema_version") == "stage1.staging_quota_replay.v1", "evidence schema_version mismatch")
    require(data.get("kind") == "stage1_staging_quota_replay", "evidence kind mismatch")
    require(data.get("environment") == "staging", "evidence environment must be staging")
    require(data.get("status") == "pass", "strict staging quota replay status must be pass")
    require(data.get("release_gate_decision") == "go", "strict staging quota replay decision must be go")
    require(data.get("canonical_pass_path") is True, "canonical_pass_path must be true")
    require(data.get("dry_run") is False, "dry_run must be false")
    require(data.get("local_devport_debug") is False, "local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, "allow_local_devport_evidence must be false")
    validate_staging_url(data.get("staging_api_url"), "staging_api_url")
    require(data.get("database_read_provenance") == "deployed_staging_postgres", "database_read_provenance mismatch")
    require(set(data.get("source_tables") or []) >= REQUIRED_TABLES, "source_tables missing required tables")
    require(set(data.get("runtime_components") or []) >= REQUIRED_COMPONENTS, "runtime_components missing required components")
    for key in SAFE_FALSE_FIELDS:
        require(data.get(key) is False, f"{key} must be false")
    strings = normalized_string_values(data)
    blocked = sorted(strings & BLOCKED_MARKERS)
    require(not blocked, f"evidence contains blocked/local marker(s): {blocked}")

    event_kinds: set[str] = set()
    child_ids: set[str] = set()
    for row in rows:
        validate_event_row(row)
        event_kinds.add(str(row["kind"]))
        child_id = row.get("child_id")
        if isinstance(child_id, str) and child_id:
            child_ids.add(child_id)
    require(REQUIRED_EVENT_KINDS <= event_kinds, f"results missing event kinds {sorted(REQUIRED_EVENT_KINDS - event_kinds)}")
    require(len(child_ids) >= 4, "results must cover at least four child tasks across retry/dead-letter/manual/reconcile cases")

    coverage = data.get("coverage")
    require(isinstance(coverage, dict), "coverage must be object")
    for key in (
        "retry_scheduled",
        "dead_letter_refund",
        "manual_retry_rereserve",
        "provider_usage_debit",
        "provider_usage_credit",
        "idempotent_replay",
    ):
        require(coverage.get(key) is True, f"coverage.{key} must be true")
    require(data.get("result_row_count") == len(rows), "result_row_count must match NDJSON rows")


def validate_preflight(evidence_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    assert_no_secret(data, "preflight")

    require(data.get("schema_version") == "stage1.staging_quota_replay.preflight.v1", "preflight schema_version mismatch")
    require(data.get("kind") == "stage1_staging_quota_replay_preflight", "preflight kind mismatch")
    require(data.get("environment") == "staging", "preflight environment must be staging")
    require(data.get("status") in {"ready", "blocked"}, "preflight status must be ready or blocked")
    require(data.get("release_gate_check_id") == "staging_quota_replay", "preflight release gate check mismatch")
    require(data.get("canonical_pass_report") == "ops/evidence/staging/stage1-quota-replay.json", "preflight canonical report mismatch")
    require(data.get("canonical_pass_results") == "ops/evidence/staging/stage1-quota-replay.ndjson", "preflight canonical results mismatch")
    require(data.get("preflight_report") == "ops/evidence/staging/stage1-quota-replay.preflight.json", "preflight report path mismatch")
    require(data.get("can_clear_quota_replay_slot") is False, "preflight cannot clear quota replay slot")
    require(data.get("can_clear_stage1_staging_runtime_gate") is False, "preflight cannot clear Stage 1 staging runtime")
    require(data.get("canonical_pass_path") is False, "preflight must not claim canonical pass path")
    require(data.get("database_url_persisted") is False, "preflight must not persist database URL")
    targets = data.get("target_summaries")
    require(isinstance(targets, dict), "preflight target_summaries must be object")
    for key in ("staging_api_url", "staging_database_endpoint"):
        target = targets.get(key)
        require(isinstance(target, dict), f"preflight target_summaries.{key} must be object")
        require(isinstance(target.get("ready"), bool), f"preflight target_summaries.{key}.ready must be boolean")
        require(isinstance(target.get("scheme"), str) and target["scheme"], f"preflight target_summaries.{key}.scheme must be present")
        require(isinstance(target.get("host"), str) and target["host"], f"preflight target_summaries.{key}.host must be present")
        require(isinstance(target.get("issues"), list), f"preflight target_summaries.{key}.issues must be list")
    readiness = data.get("input_readiness")
    require(isinstance(readiness, dict), "preflight input_readiness must be object")
    for key in (
        "staging_api_url_ready",
        "staging_database_endpoint_ready",
        "tenant_id_provided",
        "batch_id_provided",
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
    refs = data.get("input_refs")
    require(isinstance(refs, dict), "preflight input_refs must be object")
    tenant_hash = refs.get("tenant_id_hash")
    batch_hash = refs.get("batch_id_hash")
    if readiness.get("tenant_id_provided"):
        require(isinstance(tenant_hash, str) and len(tenant_hash) >= 12, "tenant_id_hash must be present when tenant is provided")
    if readiness.get("batch_id_provided"):
        require(isinstance(batch_hash, str) and len(batch_hash) >= 12, "batch_id_hash must be present when batch is provided")
    command = data.get("next_command_contract")
    require(isinstance(command, dict), "preflight next_command_contract must be object")
    require(command.get("command") == "python3 scripts/generate_stage1_staging_quota_replay_evidence.py", "preflight next command mismatch")
    require(command.get("requires_real_deployed_postgres") is True, "preflight must require deployed Postgres")
    require(command.get("requires_non_local_https_staging_api") is True, "preflight must require non-local HTTPS staging API")
    safe = data.get("safe_projection_policy")
    require(isinstance(safe, dict), "preflight safe_projection_policy must be object")
    for key in SAFE_FALSE_FIELDS:
        require(safe.get(key) is False, f"preflight safe_projection_policy.{key} must be false")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate quota replay preflight shape without clearing staging gates")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="canonical staging quota replay evidence JSON")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="canonical staging quota replay NDJSON rows")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            evidence_path = DEFAULT_PREFLIGHT_EVIDENCE if args.evidence == str(DEFAULT_EVIDENCE) else Path(args.evidence)
            validate_preflight(evidence_path)
        else:
            validate_evidence(Path(args.evidence), Path(args.results))
    except StagingQuotaReplayError as exc:
        print(f"stage1 staging quota replay validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 staging quota replay contract passed")
    else:
        print("stage1 staging quota replay evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
