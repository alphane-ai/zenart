#!/usr/bin/env python3
"""Validate Stage 1 provider sandbox evidence without accepting local-only substitutes."""

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
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-provider-sandbox.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-provider-sandbox.ndjson"
DEFAULT_LOCAL_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "stage1-provider-sandbox.local-devport.json"
DEFAULT_LOCAL_RESULTS = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "stage1-provider-sandbox.local-devport.ndjson"
SMOKE_SCRIPT = ROOT / "scripts" / "stage1_provider_sandbox_smoke.sh"
PROVIDER_SELFTEST = ROOT / "scripts" / "openai_compatible_provider_selftest.sh"
PROVIDER_ADAPTER = ROOT / "backend" / "internal" / "provider" / "openai_compatible.go"
WORKER_MAIN = ROOT / "backend" / "cmd" / "worker" / "main.go"
REGISTRY_VALIDATOR = ROOT / "scripts" / "validate_stage1_provider_registry_contract.py"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

REQUIRED_CHECKS = {
    "adapter_health_probe",
    "admin_registry",
    "admin_sandbox_test_call",
    "batch_create",
    "batch_progress",
    "batch_children",
}
REQUIRED_LLM_MODEL = "glm-5.2"


class ProviderSandboxEvidenceError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProviderSandboxEvidenceError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ProviderSandboxEvidenceError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    require(path.exists(), f"missing {display_path(path)}")
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ProviderSandboxEvidenceError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
        require(isinstance(item, dict), f"{display_path(path)}:{lineno} must be a JSON object")
        rows.append(item)
    require(rows, f"{display_path(path)} must contain at least one result row")
    return rows


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).lower()
            require(
                normalized not in {"authorization", "cookie", "admin_bearer_token", "llm_openai_api_key", "zai_api_key"},
                f"{path}.{key} exposes a secret-bearing field",
            )
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def require_no_missing_tokens(item: dict[str, Any], path: str) -> None:
    if item.get("status") != "passed":
        return
    missing = item.get("missing_tokens", [])
    require(isinstance(missing, list), f"{path}.missing_tokens must be an array")
    require(not missing, f"{path} passed with missing_tokens {missing!r}")


def is_private_or_local_host(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    if not normalized or normalized == "localhost" or normalized == "0.0.0.0" or normalized.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def validate_production_like_staging_url(value: Any, field: str, allow_local_devport: bool) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required")
    parsed = urlparse(value)
    require(parsed.scheme in {"http", "https"} and parsed.netloc, f"{field} must be an absolute HTTP URL")
    if allow_local_devport:
        return
    require(parsed.scheme == "https", f"{field} must use https for strict staging evidence")
    require(not is_private_or_local_host(parsed.hostname or ""), f"{field} must not target localhost or private network in strict staging evidence")


def validate_absolute_http_url(value: Any, field: str) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required")
    parsed = urlparse(value)
    require(parsed.scheme in {"http", "https"} and parsed.netloc, f"{field} must be an absolute HTTP URL")


def validate_contract_only() -> None:
    require_text(
        SMOKE_SCRIPT,
        (
            "PROVIDER_ID",
            "zenari-image-sandbox",
            "USER_MODEL_ID=\"${USER_MODEL_ID:-$MODEL_ID}\"",
            "LLM_ENABLE_LIVE_CALLS",
            "LLM_PROVIDER",
            "LLM_OPENAI_BASE_URL",
            "LLM_OPENAI_RESOLVE_ADDR",
            "LLM_OPENAI_CA_CERT",
            "API_URL_RESOLVE_ADDR",
            "API_URL_CA_CERT",
            "--resolve",
            "--cacert",
            "adapter_health_probe",
            "scripts/openai_compatible_provider_selftest.sh",
            "chat_completion_chars",
            "USE_DEV_IDENTITY_HEADERS",
            "X-Zenari-User-ID",
            "X-Zenari-Tenant-ID",
            "X-Zenari-Roles",
            "AUTO_SEED_PROVIDER_REGISTRY",
            "PROVIDER_SECRET_REF",
            "OUT_DIR_WAS_SET",
            "stage1-provider-sandbox.local-devport.json",
            "stage1-provider-sandbox.local-devport.ndjson",
            "local_devport_debug",
            "local_devport_debug_evidence_cannot_clear_staging_gate",
            "can_clear_provider_sandbox_gate",
            "redact_secret_file_in_place",
            "[redacted secret-bearing response omitted]",
            "persisted_body_path",
            "adapter_health_provider_failure",
            "admin_registry_seed",
            "PATCH",
            "sandbox_provider_update_body",
            "provider_registry_sandbox_ready",
            "secret_ref",
            "config_base_url_env",
            "config_live_calls_env",
            "ALLOW_LOCAL_DEVPORT_EVIDENCE",
            "production_like_staging_url_ready",
            "succeeded_children_not_ready",
            "missing_succeeded_child_asset_canvas",
            "provider_child_failures",
            "batch_children:provider_child_failure:",
            "provider_failure_blocker_prefix",
            "provider_health_preflight",
            "provider_quota_unavailable",
            "production_like_local_fixture_command",
            "admin_sandbox_test_call",
            "batch_create",
            "batch_progress",
            "batch_children",
            "stage1-provider-sandbox.json",
        ),
    )
    require_text(
        PROVIDER_ADAPTER,
        (
            "OpenAICompatibleProvider",
            "chat/completions",
            "openai_compatible_chat_completions_v1",
            "openAICompatibleModelIDs",
            "openai-compatible health probe missing configured model",
            "security.RedactString",
            "prompt_hash",
            "openAICompatibleErrorSummary",
            "body_sha256=",
            "sanitizeProviderErrorToken",
        ),
    )
    require_text(
        ROOT / "backend" / "internal" / "provider" / "openai_compatible_test.go",
        (
            "TestOpenAICompatibleProviderHTTPErrorDoesNotLeakSecretOrBody",
            "request_id=req_provider_429",
            "body_sha256=",
            "raw_provider_payload",
        ),
    )
    require_text(
        PROVIDER_SELFTEST,
        (
            "LLM_PROVIDER",
            "LLM_OPENAI_BASE_URL",
            "LLM_OPENAI_API_KEY",
            "LLM_OPENAI_RESOLVE_ADDR",
            "LLM_OPENAI_CA_CERT",
            "ZAI_API_KEY",
            "LLM_OPENAI_MODEL",
            "LLM_ENABLE_LIVE_CALLS",
            "PRESET_LLM_OPENAI_API_KEY",
            "PRESET_LLM_OPENAI_RESOLVE_ADDR",
            "PRESET_LLM_OPENAI_CA_CERT",
            "models_url",
            "chat_completions_url",
            "provider_network_args",
            "--resolve",
            "--cacert",
            "chat completions response must contain non-empty choices array",
            "summarize_provider_error_body",
            "summarize_provider_error",
            "provider_quota_unavailable",
            "provider_retryable_http_error",
            "invalid_api_key",
            "Insufficient balance or no resource package",
            "Authorization: Bearer",
            "model {model!r} not found",
            "chat_completion_chars",
            "openai-compatible provider selftest passed",
        ),
    )
    require_text(
        WORKER_MAIN,
        (
            "batchProviderClientsFromConfig",
            "LLM.EnableLiveCalls",
            "OpenAICompatibleProvider",
            "zenari-image-sandbox",
        ),
    )
    require_text(
        REGISTRY_VALIDATOR,
        (
            "OpenAICompatibleProvider",
            "LLM_OPENAI_BASE_URL",
            "LLM_ENABLE_LIVE_CALLS",
            "openai_compatible_chat_completions_v1",
        ),
    )


def validate_blocked_probe_evidence(data: dict[str, Any], rows: list[dict[str, Any]], allow_local_devport: bool) -> None:
    require(data.get("schema_version") == "stage1.provider_sandbox.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "provider sandbox evidence must be staging evidence")
    require(data.get("kind") == "provider_sandbox", "kind must be provider_sandbox")
    require(data.get("status") == "blocked", "blocked provider sandbox evidence status must be blocked")
    if allow_local_devport:
        validate_production_like_staging_url(data.get("api_url"), "api_url", allow_local_devport=True)
        require(data.get("local_devport_debug") is True, "local-devport evidence must mark local_devport_debug")
    else:
        validate_absolute_http_url(data.get("api_url"), "api_url")
        require(data.get("local_devport_debug") is not True, "canonical blocked evidence must not be local-devport debug")
    require(data.get("provider_id") == "zenari-image-sandbox", "provider_id must be zenari-image-sandbox")
    for field in ("model_id", "user_model_id", "llm_openai_model"):
        if field in data:
            require(data.get(field) == REQUIRED_LLM_MODEL, f"{field} must be {REQUIRED_LLM_MODEL}")
    require(data.get("adapter") == "openai-compatible", "adapter must be openai-compatible")
    require(data.get("adapter_endpoint_version") == "openai_compatible_chat_completions_v1", "endpoint version mismatch")
    require(data.get("llm_provider") == "openai-compatible", "llm_provider must be openai-compatible")
    require(data.get("secret_material_persisted") is False, "evidence must prove no secret material was persisted")
    require(data.get("user_visible_provider_secret") is False, "user-visible provider secret exposure must be false")
    require(data.get("raw_prompt_persisted") is False, "raw prompt must not be persisted in evidence")
    require(data.get("raw_provider_payload_persisted") is False, "raw provider payload must not be persisted in evidence")

    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list) and blocked_checks, "blocked provider evidence must include blocked_checks")
    if allow_local_devport:
        require(
            "local_devport_debug_evidence_cannot_clear_staging_gate" in blocked_checks,
            "local-devport evidence must explicitly preserve the canonical staging gate",
        )
        debug_gate_only = (
            "local_devport_debug_evidence_cannot_clear_staging_gate" in blocked_checks
            and set(blocked_checks)
            <= {
                "local_devport_debug_evidence_cannot_clear_staging_gate",
                "adapter_health_probe:local_devport_offline_adapter_probe_skipped",
            }
        )
        provider_failure_blockers = [str(item) for item in blocked_checks if str(item).startswith("batch_children:provider_child_failure:")]
        runtime_debug_blockers = [
            str(item)
            for item in blocked_checks
            if str(item) not in {
                "local_devport_debug_evidence_cannot_clear_staging_gate",
                "adapter_health_probe:local_devport_offline_adapter_probe_skipped",
            }
            and not str(item).startswith("batch_children:provider_child_failure:")
        ]
        require(
            debug_gate_only or provider_failure_blockers or runtime_debug_blockers,
            "local-devport evidence must be blocked by debug gate, provider child failure, or local runtime blocker",
        )

    readiness = data.get("runtime_input_readiness")
    require(isinstance(readiness, dict), "runtime_input_readiness must be object")
    for key in (
        "staging_api_url_ready",
        "admin_auth_ready",
        "user_auth_ready",
        "csrf_ready",
        "llm_live_config_ready",
        "worker_batch_enabled",
    ):
        require(key in readiness, f"runtime_input_readiness.{key} must be present")
    if allow_local_devport:
        require(readiness.get("allow_local_devport_evidence") is True, "local-devport readiness flag must be true")
        require(readiness.get("canonical_pass_path") is False, "local-devport evidence must not claim canonical pass path")
    else:
        require(readiness.get("allow_local_devport_evidence") is not True, "canonical blocked evidence must not allow local-devport evidence")
        require(readiness.get("canonical_pass_path") is True, "canonical blocked evidence must identify canonical path")

    checks = data.get("checks")
    require(isinstance(checks, list) and checks, "checks must be non-empty")
    by_id = {item.get("check_id"): item for item in checks if isinstance(item, dict)}
    require(REQUIRED_CHECKS <= set(by_id), f"missing checks {sorted(REQUIRED_CHECKS - set(by_id))}")
    for check_id in REQUIRED_CHECKS:
        check = by_id[check_id]
        require(check.get("status") in {"passed", "failed", "blocked"}, f"{check_id} blocked diagnostic status mismatch")
        require(check.get("request_id"), f"{check_id} must record request_id")
        require(check.get("secret_leak_detected") is False, f"{check_id} must prove no secret leak")
        require_no_missing_tokens(check, f"check {check_id}")

    row_ids = {row.get("check_id") for row in rows}
    require(REQUIRED_CHECKS <= row_ids, f"results missing rows {sorted(REQUIRED_CHECKS - row_ids)}")
    for row in rows:
        if row.get("check_id") in REQUIRED_CHECKS:
            require(row.get("status") in {"passed", "failed", "blocked"}, f"result {row.get('check_id')} blocked diagnostic status mismatch")
            require(row.get("secret_leak_detected") is False, f"result {row.get('check_id')} leaked secret")
            require_no_missing_tokens(row, f"result {row.get('check_id')}")

    batch = data.get("batch_runtime")
    require(isinstance(batch, dict), "batch_runtime must be object")
    require(batch.get("provider_id") == "zenari-image-sandbox", "batch provider_id mismatch")
    require(batch.get("model_id") == REQUIRED_LLM_MODEL, f"batch model_id must be {REQUIRED_LLM_MODEL}")

    gate_impact = data.get("gate_impact")
    require(isinstance(gate_impact, dict), "gate_impact must be object")
    require(gate_impact.get("can_clear_provider_sandbox_gate") is False, "blocked provider evidence cannot clear provider sandbox gate")
    require(
        gate_impact.get("preserved_release_gate_check_id") == "stage1_provider_sandbox",
        "blocked provider evidence must preserve provider sandbox release gate",
    )
    require(
        gate_impact.get("preserved_do_not_launch_condition_id") == "provider_sandbox_runtime_missing",
        "blocked provider evidence must preserve do-not-launch condition",
    )
    require(isinstance(gate_impact.get("remaining_blockers"), list) and gate_impact["remaining_blockers"], "blocked provider evidence must list remaining blockers")

    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "probe_contract must be object")
    require(
        probe_contract.get("canonical_pass_report") == "ops/evidence/staging/stage1-provider-sandbox.json",
        "probe_contract canonical report path mismatch",
    )
    require(
        probe_contract.get("canonical_pass_results") == "ops/evidence/staging/stage1-provider-sandbox.ndjson",
        "probe_contract canonical results path mismatch",
    )
    require(
        probe_contract.get("local_devport_report")
        == "ops/evidence/staging/local-devport/stage1-provider-sandbox.local-devport.json",
        "probe_contract local-devport report path mismatch",
    )
    require(
        probe_contract.get("local_devport_results")
        == "ops/evidence/staging/local-devport/stage1-provider-sandbox.local-devport.ndjson",
        "probe_contract local-devport results path mismatch",
    )
    require(
        "cannot clear staging gates" in str(probe_contract.get("allow_local_devport_evidence_env") or ""),
        "probe_contract must state local-devport evidence cannot clear staging gates",
    )
    require(
        "API_URL_RESOLVE_ADDR=127.0.0.1" in str(probe_contract.get("production_like_local_fixture_command") or ""),
        "probe_contract must document production-like local fixture resolve support",
    )
    require(probe_contract.get("provider_failure_blocker_prefix") == "batch_children:provider_child_failure:", "probe_contract provider failure prefix mismatch")


def validate_evidence(evidence_path: Path, results_path: Path, allow_local_devport: bool = False) -> None:
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "evidence")
    assert_no_secret(rows, "results")

    if data.get("status") == "blocked":
        validate_blocked_probe_evidence(data, rows, allow_local_devport=allow_local_devport)
        if allow_local_devport:
            return
        raise ProviderSandboxEvidenceError("canonical provider sandbox staging pass evidence is still missing; blocked probe evidence cannot clear staging gate")

    require(data.get("schema_version") == "stage1.provider_sandbox.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "provider sandbox evidence must be staging evidence")
    require(data.get("kind") == "provider_sandbox", "kind must be provider_sandbox")
    blocked_checks = data.get("blocked_checks")
    if not isinstance(blocked_checks, list):
        blocked_checks = []
    provider_failure_blockers = [
        str(item)
        for item in blocked_checks
        if str(item).startswith("batch_children:provider_child_failure:")
    ]
    adapter_probe_skipped = "adapter_health_probe:local_devport_offline_adapter_probe_skipped" in blocked_checks
    debug_gate_only = (
        "local_devport_debug_evidence_cannot_clear_staging_gate" in blocked_checks
        and set(blocked_checks)
        <= {
            "local_devport_debug_evidence_cannot_clear_staging_gate",
            "adapter_health_probe:local_devport_offline_adapter_probe_skipped",
        }
    )
    if allow_local_devport:
        require(
            "local_devport_debug_evidence_cannot_clear_staging_gate" in blocked_checks,
            "local-devport evidence must explicitly preserve the canonical staging gate",
        )
        require(data.get("status") == "blocked", "local-devport provider sandbox evidence must stay blocked")
        require(data.get("local_devport_debug") is True, "local-devport evidence must mark local_devport_debug")
        runtime_debug_blockers = [
            str(item)
            for item in blocked_checks
            if str(item) not in {
                "local_devport_debug_evidence_cannot_clear_staging_gate",
                "adapter_health_probe:local_devport_offline_adapter_probe_skipped",
            }
            and not str(item).startswith("batch_children:provider_child_failure:")
        ]
        require(
            debug_gate_only or provider_failure_blockers or runtime_debug_blockers,
            "local-devport evidence must be blocked by debug gate, provider child failure, or local runtime blocker",
        )
    else:
        require(data.get("status") == "pass", "provider sandbox evidence status must be pass")
        require(data.get("local_devport_debug") is not True, "strict staging evidence must not be local-devport debug")
    validate_production_like_staging_url(data.get("api_url"), "api_url", allow_local_devport)
    require(data.get("provider_id") == "zenari-image-sandbox", "provider_id must be zenari-image-sandbox")
    for field in ("model_id", "user_model_id", "llm_openai_model"):
        if field in data:
            require(data.get(field) == REQUIRED_LLM_MODEL, f"{field} must be {REQUIRED_LLM_MODEL}")
    require(data.get("adapter") == "openai-compatible", "adapter must be openai-compatible")
    require(data.get("adapter_endpoint_version") == "openai_compatible_chat_completions_v1", "endpoint version mismatch")
    if allow_local_devport and adapter_probe_skipped:
        require(data.get("live_calls_enabled") is False, "local-devport offline evidence must record live_calls_enabled=false")
    else:
        require(data.get("live_calls_enabled") is True, "live_calls_enabled must be true")
    require(data.get("llm_provider") == "openai-compatible", "llm_provider must be openai-compatible")
    if allow_local_devport and adapter_probe_skipped:
        require(data.get("secret_material_present") is False, "local-devport offline evidence must not require secret material")
    else:
        require(data.get("secret_material_present") is True, "evidence must prove secret material was configured by presence only")
    require(data.get("secret_material_persisted") is False, "evidence must prove no secret material was persisted")
    if provider_failure_blockers:
        require(data.get("asset_persisted") is False, "provider-failure evidence must not claim generated asset persistence")
        require(data.get("canvas_persisted") is False, "provider-failure evidence must not claim canvas persistence")
        require(data.get("usage_recorded") is False, "provider-failure evidence must not claim provider usage")
    else:
        require(data.get("asset_persisted") is True, "batch runtime must persist a generated asset")
        require(data.get("canvas_persisted") is True, "batch runtime must persist a canvas object")
        require(data.get("usage_recorded") is True, "provider usage must be recorded")
    if allow_local_devport and adapter_probe_skipped:
        require(data.get("health_probe_passed") is False, "local-devport offline evidence must not claim adapter health passed")
    elif provider_failure_blockers:
        require(data.get("health_probe_passed") is False, "provider-failure evidence must not claim adapter health passed")
    else:
        require(data.get("health_probe_passed") is True, "adapter health probe must pass")
    require(data.get("provider_cost_reconciled") in {True, "contract_only"}, "provider cost reconciliation status missing")
    require(data.get("admin_only_test_call") is True, "sandbox test call must be admin-only")
    require(data.get("user_visible_provider_secret") is False, "user-visible provider secret exposure must be false")
    require(data.get("raw_prompt_persisted") is False, "raw prompt must not be persisted in evidence")
    require(data.get("raw_provider_payload_persisted") is False, "raw provider payload must not be persisted in evidence")

    readiness = data.get("runtime_input_readiness")
    require(isinstance(readiness, dict), "runtime_input_readiness must be object")
    for key in (
        "staging_api_url_ready",
        "admin_auth_ready",
        "user_auth_ready",
        "csrf_ready",
        "worker_batch_enabled",
    ):
        require(readiness.get(key) is True, f"runtime_input_readiness.{key} must be true")
    if allow_local_devport and adapter_probe_skipped:
        require(readiness.get("llm_live_config_ready") is False, "local-devport offline evidence must record missing live LLM config")
    else:
        require(readiness.get("llm_live_config_ready") is True, "runtime_input_readiness.llm_live_config_ready must be true")
    if allow_local_devport:
        require(readiness.get("allow_local_devport_evidence") is True, "local-devport readiness flag must be true")
        require(readiness.get("canonical_pass_path") is False, "local-devport evidence must not claim canonical pass path")
    else:
        require(readiness.get("allow_local_devport_evidence") is not True, "strict staging evidence must not allow local-devport evidence")

    checks = data.get("checks")
    require(isinstance(checks, list) and checks, "checks must be non-empty")
    by_id = {item.get("check_id"): item for item in checks if isinstance(item, dict)}
    require(REQUIRED_CHECKS <= set(by_id), f"missing checks {sorted(REQUIRED_CHECKS - set(by_id))}")
    for check_id in REQUIRED_CHECKS:
        check = by_id[check_id]
        if allow_local_devport and adapter_probe_skipped and check_id == "adapter_health_probe":
            require(check.get("status") == "blocked", "adapter_health_probe must be blocked when local-devport offline probe is skipped")
            require(check.get("reason") == "local_devport_offline_adapter_probe_skipped", "adapter_health_probe skip reason mismatch")
            require(check.get("http_status") is None, "adapter_health_probe skipped row must not claim http_status")
        elif provider_failure_blockers and check_id == "adapter_health_probe":
            require(check.get("status") == "failed", "adapter_health_probe must fail when provider selftest diagnostics block the run")
            require(check.get("reason") == "openai_compatible_selftest_failed", "adapter_health_probe provider failure reason mismatch")
            require(check.get("http_status") in {200, 201, 202}, "adapter selftest wrapper should record sanitized execution status")
        elif provider_failure_blockers and check_id in {"batch_create", "batch_progress", "batch_children"}:
            require(check.get("status") in {"passed", "failed", "blocked"}, f"{check_id} provider-failure diagnostic status must be passed, failed, or blocked")
            if check.get("status") == "blocked":
                require(check.get("reason") == "provider_health_preflight_failed", f"{check_id} blocked provider-failure reason mismatch")
        else:
            require(check.get("status") == "passed", f"{check_id} must pass")
        if not (
            (allow_local_devport and adapter_probe_skipped and check_id == "adapter_health_probe")
            or (provider_failure_blockers and check_id == "adapter_health_probe")
            or (provider_failure_blockers and check_id in {"batch_create", "batch_progress", "batch_children"} and check.get("status") == "blocked")
        ):
            require(check.get("http_status") in {200, 201, 202}, f"{check_id} has unexpected http_status")
        require(check.get("request_id"), f"{check_id} must record request_id")
        require(check.get("secret_leak_detected") is False, f"{check_id} must prove no secret leak")
        require_no_missing_tokens(check, f"check {check_id}")

    row_ids = {row.get("check_id") for row in rows}
    require(REQUIRED_CHECKS <= row_ids, f"results missing rows {sorted(REQUIRED_CHECKS - row_ids)}")
    for row in rows:
        if row.get("check_id") in REQUIRED_CHECKS:
            if allow_local_devport and adapter_probe_skipped and row.get("check_id") == "adapter_health_probe":
                require(row.get("status") == "blocked", "result adapter_health_probe must be blocked when local-devport offline probe is skipped")
                require(row.get("reason") == "local_devport_offline_adapter_probe_skipped", "result adapter_health_probe skip reason mismatch")
            elif provider_failure_blockers and row.get("check_id") == "adapter_health_probe":
                require(row.get("status") == "failed", "result adapter_health_probe must fail when provider diagnostics block the run")
                require(row.get("reason") == "openai_compatible_selftest_failed", "result adapter_health_probe provider failure reason mismatch")
            elif provider_failure_blockers and row.get("check_id") in {"batch_create", "batch_progress", "batch_children"}:
                require(row.get("status") in {"passed", "failed", "blocked"}, f"result {row.get('check_id')} provider-failure diagnostic status must be passed, failed, or blocked")
                if row.get("status") == "blocked":
                    require(row.get("reason") == "provider_health_preflight_failed", f"result {row.get('check_id')} blocked provider-failure reason mismatch")
            else:
                require(row.get("status") == "passed", f"result {row.get('check_id')} must pass")
            require(row.get("secret_leak_detected") is False, f"result {row.get('check_id')} leaked secret")
            require_no_missing_tokens(row, f"result {row.get('check_id')}")

    batch = data.get("batch_runtime")
    require(isinstance(batch, dict), "batch_runtime must be object")
    require(batch.get("provider_id") == "zenari-image-sandbox", "batch provider_id mismatch")
    require(batch.get("model_id") == REQUIRED_LLM_MODEL, f"batch model_id must be {REQUIRED_LLM_MODEL}")
    if provider_failure_blockers:
        require(batch.get("batch_id") or any(str(item.get("child_id")) == "provider_health_preflight" for item in batch.get("provider_child_failures") or []), "provider-failure evidence must include batch_id or provider_health_preflight sentinel")
        failures = batch.get("provider_child_failures")
        require(isinstance(failures, list) and failures, "provider-failure evidence must include provider_child_failures")
        require(batch.get("succeeded_children", 0) == 0, "provider-failure evidence must not claim succeeded children")
        require(batch.get("failed_children", 0) >= 1, "provider-failure evidence must include failed child count")
        require(not batch.get("asset_id"), "provider-failure evidence must not include asset_id")
        require(not batch.get("canvas_object_id"), "provider-failure evidence must not include canvas_object_id")
        require(int(batch.get("usage_units") or 0) == 0, "provider-failure evidence must not include usage units")
        for failure in failures:
            require(isinstance(failure, dict), "provider_child_failures entries must be objects")
            require(failure.get("child_id"), "provider child failure must include child_id")
            require(failure.get("failure_code") or failure.get("provider_error_code"), "provider child failure must include a failure code")
            require(failure.get("provider_http_status") or failure.get("provider_code") or failure.get("failure_kind"), "provider child failure must include provider diagnostic fields")
    else:
        require(batch.get("succeeded_children", 0) >= 1, "batch must have at least one succeeded child")
        require(batch.get("asset_id"), "batch asset_id is required")
        require(batch.get("canvas_object_id"), "batch canvas_object_id is required")
        require(batch.get("usage_units", 0) >= 1, "batch usage_units must be positive")

    gate_impact = data.get("gate_impact")
    require(isinstance(gate_impact, dict), "gate_impact must be object")
    if allow_local_devport:
        require(gate_impact.get("can_clear_provider_sandbox_gate") is False, "local-devport provider evidence cannot clear provider sandbox gate")
        require(
            gate_impact.get("preserved_release_gate_check_id") == "stage1_provider_sandbox",
            "local-devport provider evidence must preserve provider sandbox release gate",
        )
    else:
        require(gate_impact.get("can_clear_provider_sandbox_gate") is True, "strict pass evidence must clear provider sandbox gate")

    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "probe_contract must be object")
    require(
        probe_contract.get("local_devport_report")
        == "ops/evidence/staging/local-devport/stage1-provider-sandbox.local-devport.json",
        "probe_contract local-devport report path mismatch",
    )
    require(
        probe_contract.get("local_devport_results")
        == "ops/evidence/staging/local-devport/stage1-provider-sandbox.local-devport.ndjson",
        "probe_contract local-devport results path mismatch",
    )
    require(
        "cannot clear staging gates" in str(probe_contract.get("allow_local_devport_evidence_env") or ""),
        "probe_contract must state local-devport evidence cannot clear staging gates",
    )
    require(
        "API_URL_RESOLVE_ADDR=127.0.0.1" in str(probe_contract.get("production_like_local_fixture_command") or ""),
        "probe_contract must document production-like local fixture resolve support",
    )
    require(probe_contract.get("provider_failure_blocker_prefix") == "batch_children:provider_child_failure:", "probe_contract provider failure prefix mismatch")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate scripts/code anchors without requiring staging evidence")
    parser.add_argument("--allow-local-devport", action="store_true", help="allow localhost/private dev-port URLs for local debugging evidence")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="provider sandbox evidence JSON path")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="provider sandbox NDJSON result path")
    args = parser.parse_args()
    try:
        validate_contract_only()
        if not args.contract_only:
            evidence_path = DEFAULT_LOCAL_EVIDENCE if args.allow_local_devport and args.evidence == str(DEFAULT_EVIDENCE) else Path(args.evidence)
            results_path = DEFAULT_LOCAL_RESULTS if args.allow_local_devport and args.results == str(DEFAULT_RESULTS) else Path(args.results)
            validate_evidence(evidence_path, results_path, allow_local_devport=args.allow_local_devport)
    except ProviderSandboxEvidenceError as exc:
        print(f"stage1 provider sandbox evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 provider sandbox evidence contract passed")
    else:
        print("stage1 provider sandbox evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
