#!/usr/bin/env python3
"""Validate Stage 1 production provider/claims exact evidence.

Contract-only mode checks provider-claims requirements. Strict mode requires
both canonical production provider files and rejects check-level-only,
preserved-blocker, blocked, local, dry-run, raw payload, or secret-shaped
evidence. Allow-preflight mode validates blocked diagnostics from the split
generator without clearing gates.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "production_provider_claims" / "local_contract.json"
DEFAULT_PROVIDER = ROOT / "ops" / "evidence" / "production" / "provider-mode.json"
DEFAULT_CLAIMS = ROOT / "ops" / "evidence" / "production" / "public-paid-real-generation-claims.json"
SPLIT_GENERATOR = ROOT / "scripts" / "generate_stage1_production_provider_claims_evidence.py"
PRODUCTION_LAUNCH_CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
PRODUCTION_LAUNCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_launch.py"
PRODUCTION_LAUNCH_GENERATOR = ROOT / "scripts" / "generate_stage1_production_launch_evidence.py"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
PROVIDER_REGISTRY_VALIDATOR = ROOT / "scripts" / "validate_stage1_provider_registry_contract.py"
PROVIDER_COST_VALIDATOR = ROOT / "scripts" / "validate_stage1_provider_cost_reconciliation.py"
PROVIDER_SANDBOX_VALIDATOR = ROOT / "scripts" / "validate_stage1_provider_sandbox_evidence.py"
ADMIN_FIXTURES = ROOT / "admin" / "lib" / "fixtures.ts"
ADMIN_GOV_TEST = ROOT / "admin" / "tests" / "admin-governance.test.mjs"
ADMIN_PROVIDERS_PAGE = ROOT / "admin" / "app" / "providers" / "page.tsx"
ADMIN_PROVIDER_CONTROLS = ROOT / "admin" / "app" / "providers" / "ProviderRegistryControls.tsx"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SECRET_REF_RE = re.compile(r"^(secrets|vault|aws-sm|gcp-sm|doppler|infisical|1password)/[A-Za-z0-9._:/-]+$")
PASS_STATUSES = {"pass", "passed"}
LAUNCH_MODES = {"real_provider", "invite_comp_only"}
PROVIDER_MODE_SECTIONS = {"launch_mode", "provider_mode", "provider_contract", "monitoring_cost", "routing_safety", "audit_refs"}
CLAIM_SECTIONS = {"public_claim_probes", "paid_real_generation_claims", "dev_provider_claim_denial", "audit_refs"}
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
    "raw_payload",
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
    "blocked_by_other_production_runtime_items",
    "blocked_by_upstream_gates",
    "failed",
    "fail",
    "planned",
    "dry_run",
    "no_go",
    "no-go",
    "missing",
    "deferred",
    "pass_with_blockers_preserved",
    "dev_mock_provider_public_claims_unresolved",
    "real_provider_or_comp_only_mode_missing",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
}
LOCAL_DEBUG_TRUE_FIELDS = {"local_devport_debug", "allow_local_devport_evidence"}
CANONICAL_PATH_FALSE_FIELDS = {"canonical_pass_path", "canonical_pass_paths"}
GATE_EMPTY_FIELDS = {
    "blocked_checks",
    "blocked_by_checks",
    "blockers",
    "do_not_launch_conditions",
    "active_do_not_launch_conditions",
    "remaining_blockers",
}
GATE_CLEAR_FIELDS = {
    "do_not_launch_condition_id",
    "do_not_launch_condition_ids",
    "preserved_do_not_launch_condition_id",
    "preserved_release_gate_check_id",
    "preserved_do_not_launch_condition_ids",
}


class Stage1ProductionProviderClaimsError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1ProductionProviderClaimsError(message)


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
        raise Stage1ProductionProviderClaimsError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


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


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def truthy_gate_value(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def falsey_gate_value(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {"false", "0", "no"})


def blocked_gate_signal_blockers(value: Any, path: str) -> list[str]:
    blockers: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            child_path = f"{path}.{key}"
            if normalized in LOCAL_DEBUG_TRUE_FIELDS and truthy_gate_value(child):
                blockers.append(f"{child_path} is true")
            if normalized in CANONICAL_PATH_FALSE_FIELDS and falsey_gate_value(child):
                blockers.append(f"{child_path} is false")
            if normalized.startswith("can_clear_") and falsey_gate_value(child):
                blockers.append(f"{child_path} is false")
            if normalized in GATE_EMPTY_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not empty")
            if normalized in GATE_CLEAR_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not cleared")
            blockers.extend(blocked_gate_signal_blockers(child, child_path))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            blockers.extend(blocked_gate_signal_blockers(child, f"{path}[{idx}]"))
    return blockers


def require_no_blocked_gate_signals(value: Any, path: str) -> None:
    blockers = blocked_gate_signal_blockers(value, path)
    require(not blockers, f"{path} contains blocked/debug-only gate signal(s): {blockers}")


def require_ref_list(value: Any, path: str) -> None:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.production_provider_claims.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "production_provider_claims_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_provider_mode_evidence_path") == "ops/evidence/production/provider-mode.json", "provider mode path mismatch")
    require(contract.get("canonical_public_claims_evidence_path") == "ops/evidence/production/public-paid-real-generation-claims.json", "public claims path mismatch")
    require(contract.get("strict_provider_mode_schema_version") == "stage1.production_provider_mode.v1", "strict provider schema mismatch")
    require(contract.get("strict_public_claims_schema_version") == "stage1.production_public_paid_real_generation_claims.v1", "strict claims schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_exact_production_provider_claims_evidence_open", "contract status mismatch")
    require(contract.get("required_environment") == "production", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "production_provider_or_comp_only_mode", "contract release gate mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")
    require(set(contract.get("allowed_launch_modes") or []) == LAUNCH_MODES, "allowed launch modes mismatch")
    require(PROVIDER_MODE_SECTIONS <= set(contract.get("required_provider_mode_sections") or []), "contract missing provider mode sections")
    require(CLAIM_SECTIONS <= set(contract.get("required_public_claim_sections") or []), "contract missing public claim sections")
    policy = contract.get("safe_projection_policy")
    require(isinstance(policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    blocked_policy = contract.get("blocked_diagnostic_policy")
    require(isinstance(blocked_policy, dict), "blocked_diagnostic_policy must be object")
    require(blocked_policy.get("validator_flag") == "--allow-preflight", "blocked diagnostic validator flag mismatch")
    require(blocked_policy.get("status") == "blocked", "blocked diagnostic status mismatch")
    require(blocked_policy.get("canonical_pass_path") is False, "blocked diagnostic must not claim canonical pass path")
    require(blocked_policy.get("check_level_only") is False, "blocked diagnostic must not be check-level-only pass")
    require(blocked_policy.get("can_clear_release_gate_check") is False, "blocked diagnostic cannot clear release gate")
    require(blocked_policy.get("requires_blocked_checks") is True, "blocked diagnostic must require blockers")
    require(blocked_policy.get("requires_preserved_release_gate_check_id") is True, "blocked diagnostic must preserve release gate")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    for key in (
        "release_sha_full_40_hex",
        "release_sha_must_match_between_provider_files",
        "canonical_pass_path_required",
        "provider_mode_subitem_gate_impact_can_clear_required",
        "public_claims_subitem_gate_impact_can_clear_required",
        "aggregate_production_gate_impact_must_not_claim_clearance",
        "provider_secret_ref_required_for_real_provider",
        "staging_verification_required_for_real_provider",
        "monitoring_cost_required",
        "dev_provider_public_routing_forbidden",
        "silent_fallback_forbidden",
        "claim_mode_alignment_required",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "allow_check_level_only_pass",
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run",
        "allow_blocked_status",
        "allow_no_go_status",
        "allow_preserved_blockers",
        "allow_preserved_do_not_launch_conditions",
        "allow_raw_or_secret_payloads",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")


def validate_code_anchors() -> None:
    require(SPLIT_GENERATOR.exists() and SPLIT_GENERATOR.stat().st_mode & 0o111, "production provider claims split evidence generator must be executable")
    require_text(
        SPLIT_GENERATOR,
        (
            "DEFAULT_PROVIDER",
            "DEFAULT_CLAIMS",
            "provider-claims-source.json",
            "stage1.production_provider_claims_source.v1",
            "source_probe_missing",
            "release_sha_missing_or_not_full_sha",
            "stage1.production_provider_mode.v1",
            "stage1.production_public_paid_real_generation_claims.v1",
            "can_clear_provider_mode_subitem",
            "can_clear_public_paid_real_generation_claims_subitem",
            "can_clear_aggregate_production_gate",
            "blocked_report",
            "run_strict_validator",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_CONTRACT,
        (
            '"component_id": "provider_claims"',
            "ops/evidence/production/provider-mode.json",
            "ops/evidence/production/public-paid-real-generation-claims.json",
            "scripts/generate_stage1_production_provider_claims_evidence.py",
            "real provider contract or invite/comp-only mode",
            "no dev-provider public routing",
            "paid and real-generation claims gated",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_VALIDATOR,
        (
            "provider_claims",
            "production_provider_ready_or_comp_only",
            "require_no_blocked_gate_signals",
        ),
    )
    require_text(PRODUCTION_LAUNCH_GENERATOR, ("provider_claims", "production_provider_ready_or_comp_only", "check_level_clear_signal"))
    require_text(
        STAGE0_VALIDATOR,
        (
            "Production provider-or-comp-only cannot close from provider abstractions",
            "Production provider mode pass evidence must cite both launch-mode and public-claims production files",
            "real_provider_or_comp_only_mode_missing",
            "dev_mock_provider_public_claims_unresolved",
        ),
    )
    require_text(PROVIDER_REGISTRY_VALIDATOR, ("secret_ref", "strategy group", "kill_switch", "provider_strategy_group"))
    require_text(PROVIDER_COST_VALIDATOR, ("ProviderCostReconciler", "provider_usage_logs", "real provider invoice or billing-period spend report"))
    require_text(PROVIDER_SANDBOX_VALIDATOR, ("stage1-provider-sandbox.json", "local_devport_debug", "provider_child_failure"))
    require_text(ADMIN_FIXTURES, ("production_provider_mode_20260527T1930Z", "public_paid_real_generation_claims", "provider_contract_monitoring_cost"))
    require_text(ADMIN_GOV_TEST, ("production public paid/real-generation claims evidence file is missing", "production_provider_or_comp_only_mode"))
    require_text(ADMIN_PROVIDERS_PAGE, ("Provider Strategy", "Provider Registry", "secret"))
    require_text(ADMIN_PROVIDER_CONTROLS, ("strategy group", "kill switch", "secret_ref"))
    require_text(BLUEPRINT, ("PR-10", "Production", "provider/claims", "comp-only"))
    require_text(GAP_INVENTORY, ("provider/claims", "production provider", "real provider"))
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_production_provider_claims_evidence.py --contract-only",
            "validate_stage1_production_provider_claims_evidence.py --allow-preflight",
            "generate_stage1_production_provider_claims_evidence.py",
            "stage1 production provider claims exact evidence strict fixture",
        ),
    )


def require_blocked_release_sha(value: Any, path: str) -> None:
    if value is None:
        return
    require(isinstance(value, str) and RELEASE_SHA_RE.fullmatch(value) is not None, f"{path} release_sha must be null or full lowercase SHA")


def require_blocked_diagnostic_common(data: dict[str, Any], *, path: str, schema_version: str, kind: str) -> list[str]:
    assert_no_secret(data, path)
    require(data.get("schema_version") == schema_version, f"{path} schema_version mismatch")
    require(data.get("environment") == "production", f"{path} environment must be production")
    require(data.get("kind") == kind, f"{path} kind mismatch")
    require(data.get("status") == "blocked", f"{path} status must be blocked")
    require(data.get("release_gate_check_id") == "production_provider_or_comp_only_mode", f"{path} release gate check mismatch")
    require_blocked_release_sha(data.get("release_sha"), path)
    require(data.get("canonical_pass_path") is False, f"{path}.canonical_pass_path must be false")
    require(data.get("local_devport_debug") is False, f"{path}.local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, f"{path}.allow_local_devport_evidence must be false")
    require(data.get("dry_run") is False, f"{path}.dry_run must be false")
    require(data.get("check_level_only") is False, f"{path}.check_level_only must be false")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{path}.{field} must be false")
    blockers = data.get("blocked_checks")
    require(isinstance(blockers, list) and blockers, f"{path}.blocked_checks must be a non-empty list")
    for idx, blocker in enumerate(blockers):
        require(isinstance(blocker, str) and blocker.strip(), f"{path}.blocked_checks[{idx}] must be a non-empty string")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), f"{path}.gate_impact must be object")
    require(gate.get("can_clear_provider_mode_subitem") is False, f"{path}.gate_impact cannot clear provider subitem")
    require(
        gate.get("can_clear_public_paid_real_generation_claims_subitem") is False,
        f"{path}.gate_impact cannot clear public claims subitem",
    )
    require(gate.get("can_clear_aggregate_production_gate") is False, f"{path}.gate_impact cannot clear aggregate production gate")
    require(
        gate.get("preserved_release_gate_check_id") == "production_provider_or_comp_only_mode",
        f"{path}.gate_impact must preserve production provider claims release gate",
    )
    remaining = gate.get("remaining_blockers")
    require(isinstance(remaining, list) and remaining == blockers, f"{path}.gate_impact.remaining_blockers must mirror blocked_checks")
    return [str(item) for item in blockers]


def validate_blocked_diagnostics(provider_path: Path, claims_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    provider = load_json(provider_path)
    claims = load_json(claims_path)
    provider_blockers = require_blocked_diagnostic_common(
        provider,
        path="provider_preflight",
        schema_version="stage1.production_provider_mode.blocked.v1",
        kind="production_provider_mode",
    )
    claims_blockers = require_blocked_diagnostic_common(
        claims,
        path="claims_preflight",
        schema_version="stage1.production_public_paid_real_generation_claims.blocked.v1",
        kind="production_public_paid_real_generation_claims",
    )
    require(provider.get("release_sha") == claims.get("release_sha"), "blocked provider diagnostics release_sha values must match")
    require(provider_blockers == claims_blockers, "blocked provider diagnostics must share blockers")


def validate_common(data: dict[str, Any], *, path: str, schema_version: str, kind: str) -> str:
    assert_no_secret(data, path)
    require_no_blocked_gate_signals(data, path)
    require(data.get("schema_version") == schema_version, f"{path} schema_version mismatch")
    require(data.get("environment") == "production", f"{path} environment must be production")
    require(data.get("kind") == kind, f"{path} kind mismatch")
    require(is_pass_status(data.get("status")), f"{path} status must pass")
    require(data.get("release_gate_check_id") == "production_provider_or_comp_only_mode", f"{path} release gate check mismatch")
    release_sha = data.get("release_sha")
    require(isinstance(release_sha, str) and RELEASE_SHA_RE.fullmatch(release_sha) is not None, f"{path} release_sha must be full lowercase SHA")
    require(data.get("canonical_pass_path") is True, f"{path}.canonical_pass_path must be true")
    require(data.get("local_devport_debug") is False, f"{path}.local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, f"{path}.allow_local_devport_evidence must be false")
    require(data.get("dry_run") is False, f"{path}.dry_run must be false")
    require(data.get("check_level_only") is False, f"{path}.check_level_only must be false")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{path}.{field} must be false")
    blocked = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    require(not blocked, f"{path} contains blocked/deferred/local/dry-run marker(s): {blocked}")
    require_ref_list(data.get("runtime_request_ids"), f"{path}.runtime_request_ids")
    require_ref_list(data.get("audit_refs"), f"{path}.audit_refs")
    return release_sha


def validate_provider(data: dict[str, Any]) -> str:
    release_sha = validate_common(
        data,
        path="provider",
        schema_version="stage1.production_provider_mode.v1",
        kind="production_provider_mode",
    )
    launch_mode = data.get("launch_mode")
    require(launch_mode in LAUNCH_MODES, "provider.launch_mode must be real_provider or invite_comp_only")
    provider_mode = data.get("provider_mode")
    require(isinstance(provider_mode, dict), "provider.provider_mode must be object")
    require(provider_mode.get("dev_provider_public_routing") is False, "dev provider public routing must be false")
    require(provider_mode.get("silent_fallback_enabled") is False, "silent fallback must be false")
    require(provider_mode.get("paid_generation_enabled") is (launch_mode == "real_provider"), "paid_generation_enabled must match launch mode")
    require(provider_mode.get("invite_comp_only") is (launch_mode == "invite_comp_only"), "invite_comp_only flag must match launch mode")
    if launch_mode == "real_provider":
        require(isinstance(provider_mode.get("production_provider_id"), str) and provider_mode["production_provider_id"], "real provider mode requires production_provider_id")
    else:
        require(provider_mode.get("production_provider_id") in (None, ""), "invite_comp_only must not claim production_provider_id")
    contract = data.get("provider_contract")
    require(isinstance(contract, dict), "provider.provider_contract must be object")
    if launch_mode == "real_provider":
        require(contract.get("status") == "verified", "real provider contract status must be verified")
        require(isinstance(contract.get("provider_id"), str) and contract["provider_id"] == provider_mode.get("production_provider_id"), "provider contract id mismatch")
        require(SECRET_REF_RE.match(str(contract.get("secret_ref", ""))) is not None, "real provider must use secret manager ref")
        require(contract.get("request_response_schema_verified") is True, "request/response schema must be verified")
        require(contract.get("safety_policy_verified") is True, "safety policy must be verified")
        require(isinstance(contract.get("staging_verification_id"), str) and contract["staging_verification_id"], "staging verification id required")
    else:
        require(contract.get("status") == "not_required_invite_comp_only", "invite_comp_only provider contract status mismatch")
        require(contract.get("secret_ref") in (None, ""), "invite_comp_only must not claim provider secret ref")
        require(contract.get("request_response_schema_verified") is False, "invite_comp_only must not claim request/response verification")
    monitoring = data.get("monitoring_cost")
    require(isinstance(monitoring, dict), "provider.monitoring_cost must be object")
    for key in ("dashboard_id", "alert_route_id", "provider_usage_log_ref", "cost_meter_ref", "spend_cap_ref"):
        require(isinstance(monitoring.get(key), str) and monitoring[key], f"provider.monitoring_cost.{key} required")
    routing = data.get("routing_safety")
    require(isinstance(routing, dict), "provider.routing_safety must be object")
    require(routing.get("kill_switch_ready") is True, "provider.routing_safety.kill_switch_ready must be true")
    require(routing.get("strategy_group_audited") is True, "provider.routing_safety.strategy_group_audited must be true")
    require(routing.get("fallback_policy_explicit") is True, "provider.routing_safety.fallback_policy_explicit must be true")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "provider.gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_provider_or_comp_only_mode", "provider gate impact release gate mismatch")
    require(gate.get("can_clear_provider_mode_subitem") is True, "provider mode gate must clear provider subitem")
    require(gate.get("can_clear_aggregate_production_gate") in {False, None}, "provider mode gate must not clear aggregate production gate")
    return release_sha


def require_claim_probe(probe: dict[str, Any], path: str) -> None:
    require(probe.get("status") == "pass", f"{path}.status must pass")
    require(probe.get("http_status") == 200, f"{path}.http_status must be 200")
    require(probe.get("visibility") == "public", f"{path}.visibility must be public")
    require(isinstance(probe.get("required_tokens"), list) and probe["required_tokens"], f"{path}.required_tokens must be non-empty")


def validate_claims(data: dict[str, Any], launch_mode: str) -> str:
    release_sha = validate_common(
        data,
        path="claims",
        schema_version="stage1.production_public_paid_real_generation_claims.v1",
        kind="production_public_paid_real_generation_claims",
    )
    require(data.get("launch_mode") == launch_mode, "claims.launch_mode must match provider launch mode")
    probes = data.get("public_claim_probes")
    require(isinstance(probes, list) and probes, "claims.public_claim_probes must be non-empty")
    by_surface = {probe.get("surface"): probe for probe in probes if isinstance(probe, dict)}
    require({"public_home", "billing_policy", "admin_provider_health"} <= set(by_surface), "claims missing required surfaces")
    for surface in ("public_home", "billing_policy", "admin_provider_health"):
        require_claim_probe(by_surface[surface], f"claims.public_claim_probes.{surface}")
    paid_claims = data.get("paid_real_generation_claims")
    require(isinstance(paid_claims, dict), "claims.paid_real_generation_claims must be object")
    if launch_mode == "real_provider":
        require(paid_claims.get("paid_claims_enabled") is True, "real provider mode must enable paid claims")
        require(paid_claims.get("real_generation_claims_enabled") is True, "real provider mode must enable real-generation claims")
        require(paid_claims.get("claims_backed_by_provider_evidence") is True, "real provider claims must be backed by provider evidence")
    else:
        require(paid_claims.get("paid_claims_enabled") is False, "invite_comp_only must hide paid claims")
        require(paid_claims.get("real_generation_claims_enabled") is False, "invite_comp_only must hide real-generation claims")
        require(paid_claims.get("invite_comp_only_disclosed") is True, "invite_comp_only must be disclosed")
    require(paid_claims.get("mock_checkout_readiness_claim") is False, "mock checkout readiness claim must be false")
    require(paid_claims.get("unsupported_real_generation_claim") is False, "unsupported real-generation claim must be false")
    dev_denial = data.get("dev_provider_claim_denial")
    require(isinstance(dev_denial, dict), "claims.dev_provider_claim_denial must be object")
    require(dev_denial.get("dev_provider_presented_as_production") is False, "dev provider must not be presented as production")
    require(dev_denial.get("development_only_label_visible") is True, "development-only label must be visible")
    require(dev_denial.get("silent_fallback_claim") is False, "silent fallback claim must be false")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "claims.gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_provider_or_comp_only_mode", "claims gate impact release gate mismatch")
    require(gate.get("can_clear_public_paid_real_generation_claims_subitem") is True, "claims gate must clear public claims subitem")
    require(gate.get("can_clear_aggregate_production_gate") in {False, None}, "claims gate must not clear aggregate production gate")
    return release_sha


def validate_evidence(provider_path: Path, claims_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    provider = load_json(provider_path)
    provider_sha = validate_provider(provider)
    claims_sha = validate_claims(load_json(claims_path), str(provider.get("launch_mode")))
    require(provider_sha == claims_sha, "provider and public claims release_sha values must match")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing blocked production provider/claims diagnostics")
    parser.add_argument("--provider-evidence", default=str(DEFAULT_PROVIDER), help="production provider mode evidence JSON path")
    parser.add_argument("--claims-evidence", default=str(DEFAULT_CLAIMS), help="production public paid/real-generation claims evidence JSON path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            validate_blocked_diagnostics(Path(args.provider_evidence), Path(args.claims_evidence))
        else:
            validate_evidence(Path(args.provider_evidence), Path(args.claims_evidence))
    except Stage1ProductionProviderClaimsError as exc:
        print(f"stage1 production provider claims evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 production provider claims evidence contract passed")
    elif args.allow_preflight:
        print("stage1 production provider claims blocked/preflight evidence passed")
    else:
        print("stage1 production provider claims evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
