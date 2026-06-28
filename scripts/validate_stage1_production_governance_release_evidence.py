#!/usr/bin/env python3
"""Validate Stage 1 production governance/release exact evidence.

Contract-only mode checks the Stage 1 exact-evidence contract for production
activation review/audit, abuse throttle/hold, and skill release/eval/canary.
Strict mode requires all three canonical production files and rejects
check-level-only, preserved-blocker, blocked, local, dry-run, raw payload, or
secret-shaped evidence. Allow-preflight mode validates blocked diagnostics from
the split generator without clearing gates.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "production_governance_release" / "local_contract.json"
DEFAULT_ACTIVATION = ROOT / "ops" / "evidence" / "production" / "20260527T1430Z-activation-review-audit.json"
DEFAULT_ABUSE = ROOT / "ops" / "evidence" / "production" / "20260527T1330Z-abuse-throttle-hold.json"
DEFAULT_SKILL = ROOT / "ops" / "evidence" / "production" / "20260527T1600Z-skill-release-eval-canary.json"
SPLIT_GENERATOR = ROOT / "scripts" / "generate_stage1_production_governance_release_evidence.py"
PRODUCTION_LAUNCH_CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
PRODUCTION_LAUNCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_launch.py"
PRODUCTION_LAUNCH_GENERATOR = ROOT / "scripts" / "generate_stage1_production_launch_evidence.py"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
SKILL_ADMIN_VALIDATOR = ROOT / "scripts" / "validate_stage1_skill_eval_release_contract.py"
EVAL_SKILL_VALIDATOR = ROOT / "scripts" / "validate_stage1_eval_skill_release_contract.py"
ADMIN_FIXTURES = ROOT / "admin" / "lib" / "fixtures.ts"
ADMIN_GOV_TEST = ROOT / "admin" / "tests" / "admin-governance.test.mjs"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
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
    "activation_eval_review_audit_runtime_missing",
    "admin_high_risk_review_runtime_missing",
    "abuse_throttle_hold_missing",
    "skill_release_eval_canary_missing",
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

COMPONENTS = {
    "activation": {
        "schema_version": "stage1.production_activation_review_audit.v1",
        "kind": "production_activation_review_audit",
        "release_gate_check_id": "production_activation_review_audit",
        "gate_clear_field": "can_clear_activation_review_audit_component",
        "sections": {
            "high_risk_rbac",
            "reviewer_rationale",
            "second_review",
            "audit_immutability",
            "activation_gates",
        },
        "section_checks": {
            "high_risk_rbac": ("all_high_risk_surfaces_covered",),
            "reviewer_rationale": ("rationale_required", "rationale_captured"),
            "second_review": ("required_for_high_risk", "distinct_reviewer_enforced"),
            "audit_immutability": ("immutable_audit_refs",),
            "activation_gates": ("skill", "crawler", "prompt", "provider", "quota", "safety", "export"),
        },
    },
    "abuse": {
        "schema_version": "stage1.production_abuse_throttle_hold.v1",
        "kind": "production_abuse_throttle_hold",
        "release_gate_check_id": "production_abuse_throttle_hold",
        "gate_clear_field": "can_clear_abuse_throttle_hold_component",
        "sections": {
            "account_hold",
            "rate_limit",
            "spend_cap_or_kill_switch",
            "rbac_audit",
        },
        "section_checks": {
            "account_hold": ("hold_enforced",),
            "rate_limit": ("rate_limit_enforced",),
            "spend_cap_or_kill_switch": ("spend_cap_ready", "kill_switch_ready"),
            "rbac_audit": ("rbac_enforced", "immutable_audit_refs"),
        },
    },
    "skill": {
        "schema_version": "stage1.production_skill_release_eval_canary.v1",
        "kind": "production_skill_release_eval_canary",
        "release_gate_check_id": "production_skill_release_eval_canary",
        "gate_clear_field": "can_clear_skill_release_eval_canary_component",
        "sections": {
            "owner_risk",
            "eval_suite",
            "safety_refs",
            "canary_metrics",
            "rollback_target",
            "release_notes",
        },
        "section_checks": {
            "owner_risk": ("owner_id", "risk_level"),
            "eval_suite": ("eval_passed", "suite_id"),
            "safety_refs": ("safety_refs_complete",),
            "canary_metrics": ("metrics_within_threshold", "sample_size"),
            "rollback_target": ("rollback_target_id", "route_smoke_passed"),
            "release_notes": ("release_notes_id", "go_no_go_recorded"),
        },
    },
}


class Stage1ProductionGovernanceReleaseError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1ProductionGovernanceReleaseError(message)


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
        raise Stage1ProductionGovernanceReleaseError(f"{display_path(path)} invalid JSON: {exc}") from exc
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
    require(contract.get("schema_version") == "stage1.production_governance_release.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "production_governance_release_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_activation_evidence_path") == "ops/evidence/production/20260527T1430Z-activation-review-audit.json", "activation path mismatch")
    require(contract.get("canonical_abuse_evidence_path") == "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json", "abuse path mismatch")
    require(contract.get("canonical_skill_evidence_path") == "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json", "skill path mismatch")
    require(contract.get("strict_activation_schema_version") == COMPONENTS["activation"]["schema_version"], "activation schema mismatch")
    require(contract.get("strict_abuse_schema_version") == COMPONENTS["abuse"]["schema_version"], "abuse schema mismatch")
    require(contract.get("strict_skill_schema_version") == COMPONENTS["skill"]["schema_version"], "skill schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_exact_production_governance_release_evidence_open", "contract status mismatch")
    require(contract.get("required_environment") == "production", "contract environment mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")

    by_component = {item.get("component_id"): item for item in contract.get("required_components", []) if isinstance(item, dict)}
    require(set(by_component) == {"activation_review_audit", "abuse_throttle_hold", "skill_release_eval_canary"}, "contract component set mismatch")
    require(
        by_component["activation_review_audit"].get("release_gate_check_id") == "production_activation_review_audit",
        "activation release gate mismatch",
    )
    require(by_component["abuse_throttle_hold"].get("release_gate_check_id") == "production_abuse_throttle_hold", "abuse release gate mismatch")
    require(
        by_component["skill_release_eval_canary"].get("release_gate_check_id") == "production_skill_release_eval_canary",
        "skill release gate mismatch",
    )

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
        "release_sha_must_match_between_all_files",
        "canonical_pass_path_required",
        "gate_impact_can_clear_component_required",
        "aggregate_production_gate_impact_must_not_claim_clearance",
        "runtime_request_ids_required",
        "audit_refs_required",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "allow_check_level_only_pass",
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run",
        "allow_blocked_status",
        "allow_no_go_status",
        "allow_pass_with_blockers_preserved",
        "allow_preserved_do_not_launch_conditions",
        "allow_raw_or_secret_payloads",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")


def validate_code_anchors() -> None:
    require(SPLIT_GENERATOR.exists() and SPLIT_GENERATOR.stat().st_mode & 0o111, "production governance/release split evidence generator must be executable")
    require_text(
        SPLIT_GENERATOR,
        (
            "DEFAULT_ACTIVATION",
            "DEFAULT_ABUSE",
            "DEFAULT_SKILL",
            "production-governance-release-source.json",
            "stage1.production_governance_release_source.v1",
            "source_probe_missing",
            "release_sha_missing_or_not_full_sha",
            "stage1.production_activation_review_audit.v1",
            "stage1.production_abuse_throttle_hold.v1",
            "stage1.production_skill_release_eval_canary.v1",
            "can_clear_activation_review_audit_component",
            "can_clear_abuse_throttle_hold_component",
            "can_clear_skill_release_eval_canary_component",
            "blocked_report",
            "run_strict_validator",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_CONTRACT,
        (
            '"component_id": "activation_review_audit"',
            '"component_id": "abuse_throttle_hold"',
            '"component_id": "skill_release_eval_canary"',
            "scripts/generate_stage1_production_governance_release_evidence.py",
            "high-risk RBAC",
            "account hold",
            "canary metrics",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_VALIDATOR,
        (
            "activation_review_audit",
            "abuse_throttle_hold",
            "skill_release_eval_canary",
            "require_no_blocked_gate_signals",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_GENERATOR,
        (
            "production_activation_review_audit",
            "production_abuse_throttle_hold",
            "production_skill_release_eval_canary",
            "check_level_clear_signal",
        ),
    )
    require_text(
        STAGE0_VALIDATOR,
        (
            "validate_production_abuse_throttle_hold_evidence",
            "validate_production_skill_release_eval_canary_evidence",
            "validate_production_activation_review_audit_evidence",
            "abuse throttle/hold production evidence must preserve unrelated launch blockers",
            "skill release production evidence must preserve unrelated launch blockers",
            "activation review production evidence must preserve unrelated launch blockers",
        ),
    )
    require_text(
        ADMIN_FIXTURES,
        (
            "productionAbuseThrottleHoldEvidence",
            "productionActivationReviewAuditEvidence",
            "productionSkillReleaseEvalCanaryEvidence",
            "rollback target",
            "second-review",
        ),
    )
    require_text(
        ADMIN_GOV_TEST,
        (
            "production abuse throttle hold evidence clears only the production abuse check",
            "production activation review audit evidence covers every high-risk admin override gate",
            "production skill release eval canary evidence clears only the production skill check",
        ),
    )
    require_text(SKILL_ADMIN_VALIDATOR, ("can_clear_skill_release_eval_canary_gate", "read_without_eval_rerun", "skill_release:admin"))
    require_text(EVAL_SKILL_VALIDATOR, ("staging_skill_release_eval_canary_evidence", "production_skill_canary_evidence", "can_clear_stage1_production_launch_gate"))
    require_text(BLUEPRINT, ("AD-9", "VF-7", "Production Launch"))
    require_text(GAP_INVENTORY, ("activation/review/audit", "abuse", "skill canary"))
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_production_governance_release_evidence.py --contract-only",
            "validate_stage1_production_governance_release_evidence.py --allow-preflight",
            "generate_stage1_production_governance_release_evidence.py",
            "stage1 production governance/release exact evidence strict fixture",
        ),
    )


def require_blocked_release_sha(value: Any, path: str) -> None:
    if value is None:
        return
    require(isinstance(value, str) and RELEASE_SHA_RE.fullmatch(value) is not None, f"{path} release_sha must be null or full lowercase SHA")


def validate_blocked_component(data: dict[str, Any], *, component: str) -> list[str]:
    info = COMPONENTS[component]
    path = f"{component}_preflight"
    assert_no_secret(data, path)
    require(data.get("schema_version") == f"stage1.{info['kind']}.blocked.v1", f"{path} schema_version mismatch")
    require(data.get("environment") == "production", f"{path} environment must be production")
    require(data.get("kind") == info["kind"], f"{path} kind mismatch")
    require(data.get("status") == "blocked", f"{path} status must be blocked")
    require(data.get("release_gate_check_id") == info["release_gate_check_id"], f"{path} release gate check mismatch")
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
    require(gate.get(info["gate_clear_field"]) is False, f"{path}.gate_impact cannot clear component")
    require(gate.get("can_clear_aggregate_production_gate") is False, f"{path}.gate_impact cannot clear aggregate production gate")
    require(
        gate.get("preserved_release_gate_check_id") == info["release_gate_check_id"],
        f"{path}.gate_impact must preserve component release gate",
    )
    remaining = gate.get("remaining_blockers")
    require(isinstance(remaining, list) and remaining == blockers, f"{path}.gate_impact.remaining_blockers must mirror blocked_checks")
    return [str(item) for item in blockers]


def validate_blocked_diagnostics(activation_path: Path, abuse_path: Path, skill_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    activation = load_json(activation_path)
    abuse = load_json(abuse_path)
    skill = load_json(skill_path)
    activation_blockers = validate_blocked_component(activation, component="activation")
    abuse_blockers = validate_blocked_component(abuse, component="abuse")
    skill_blockers = validate_blocked_component(skill, component="skill")
    require(
        len({activation.get("release_sha"), abuse.get("release_sha"), skill.get("release_sha")}) == 1,
        "blocked governance/release diagnostics release_sha values must match",
    )
    require(
        activation_blockers == abuse_blockers == skill_blockers,
        "blocked governance/release diagnostics must share blockers",
    )


def validate_common(data: dict[str, Any], *, component: str) -> str:
    info = COMPONENTS[component]
    path = component
    assert_no_secret(data, path)
    require_no_blocked_gate_signals(data, path)
    require(data.get("schema_version") == info["schema_version"], f"{path} schema_version mismatch")
    require(data.get("environment") == "production", f"{path} environment must be production")
    require(data.get("kind") == info["kind"], f"{path} kind mismatch")
    require(is_pass_status(data.get("status")), f"{path} status must pass")
    require(data.get("release_gate_check_id") == info["release_gate_check_id"], f"{path} release gate check mismatch")
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
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), f"{path}.gate_impact must be object")
    require(gate.get("release_gate_check_id") == info["release_gate_check_id"], f"{path} gate impact release gate mismatch")
    require(gate.get(info["gate_clear_field"]) is True, f"{path} gate must clear component")
    require(gate.get("can_clear_aggregate_production_gate") in {False, None}, f"{path} gate must not clear aggregate production gate")
    return release_sha


def require_section_status(section: Any, path: str) -> dict[str, Any]:
    require(isinstance(section, dict), f"{path} must be object")
    require(is_pass_status(section.get("status")), f"{path}.status must pass")
    refs = section.get("evidence_refs")
    if refs is not None:
        require_ref_list(refs, f"{path}.evidence_refs")
    return section


def validate_activation(data: dict[str, Any]) -> str:
    release_sha = validate_common(data, component="activation")
    for section_name in COMPONENTS["activation"]["sections"]:
        require_section_status(data.get(section_name), f"activation.{section_name}")
    require(data["high_risk_rbac"].get("all_high_risk_surfaces_covered") is True, "activation high-risk RBAC coverage required")
    require(data["reviewer_rationale"].get("rationale_required") is True, "activation reviewer rationale required flag missing")
    require(data["reviewer_rationale"].get("rationale_captured") is True, "activation reviewer rationale captured flag missing")
    require(data["second_review"].get("required_for_high_risk") is True, "activation second review high-risk flag missing")
    require(data["second_review"].get("distinct_reviewer_enforced") is True, "activation distinct reviewer enforcement missing")
    require(data["audit_immutability"].get("immutable_audit_refs") is True, "activation immutable audit refs required")
    gates = data["activation_gates"]
    for key in ("skill", "crawler", "prompt", "provider", "quota", "safety", "export"):
        require(gates.get(key) is True, f"activation gate {key} must be true")
    return release_sha


def validate_abuse(data: dict[str, Any]) -> str:
    release_sha = validate_common(data, component="abuse")
    for section_name in COMPONENTS["abuse"]["sections"]:
        require_section_status(data.get(section_name), f"abuse.{section_name}")
    require(data["account_hold"].get("hold_enforced") is True, "abuse account hold enforcement required")
    require(data["rate_limit"].get("rate_limit_enforced") is True, "abuse rate limit enforcement required")
    spend = data["spend_cap_or_kill_switch"]
    require(spend.get("spend_cap_ready") is True or spend.get("kill_switch_ready") is True, "abuse spend cap or kill switch required")
    require(data["rbac_audit"].get("rbac_enforced") is True, "abuse RBAC enforcement required")
    require(data["rbac_audit"].get("immutable_audit_refs") is True, "abuse immutable audit refs required")
    return release_sha


def validate_skill(data: dict[str, Any]) -> str:
    release_sha = validate_common(data, component="skill")
    for section_name in COMPONENTS["skill"]["sections"]:
        require_section_status(data.get(section_name), f"skill.{section_name}")
    require(isinstance(data["owner_risk"].get("owner_id"), str) and data["owner_risk"]["owner_id"], "skill owner_id required")
    require(data["owner_risk"].get("risk_level") in {"low", "medium", "high"}, "skill risk_level invalid")
    require(data["eval_suite"].get("eval_passed") is True, "skill eval suite must pass")
    require(isinstance(data["eval_suite"].get("suite_id"), str) and data["eval_suite"]["suite_id"], "skill suite_id required")
    require(data["safety_refs"].get("safety_refs_complete") is True, "skill safety refs must be complete")
    require(data["canary_metrics"].get("metrics_within_threshold") is True, "skill canary metrics must be within threshold")
    require(isinstance(data["canary_metrics"].get("sample_size"), int) and data["canary_metrics"]["sample_size"] > 0, "skill canary sample_size required")
    require(isinstance(data["rollback_target"].get("rollback_target_id"), str) and data["rollback_target"]["rollback_target_id"], "skill rollback target required")
    require(data["rollback_target"].get("route_smoke_passed") is True, "skill rollback route smoke must pass")
    require(isinstance(data["release_notes"].get("release_notes_id"), str) and data["release_notes"]["release_notes_id"], "skill release notes id required")
    require(data["release_notes"].get("go_no_go_recorded") is True, "skill go/no-go release note must be recorded")
    return release_sha


def validate_evidence(activation_path: Path, abuse_path: Path, skill_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    activation_sha = validate_activation(load_json(activation_path))
    abuse_sha = validate_abuse(load_json(abuse_path))
    skill_sha = validate_skill(load_json(skill_path))
    require(len({activation_sha, abuse_sha, skill_sha}) == 1, "activation, abuse, and skill release_sha values must match")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing blocked production governance/release diagnostics")
    parser.add_argument("--activation-evidence", default=str(DEFAULT_ACTIVATION), help="production activation review/audit evidence JSON path")
    parser.add_argument("--abuse-evidence", default=str(DEFAULT_ABUSE), help="production abuse throttle/hold evidence JSON path")
    parser.add_argument("--skill-evidence", default=str(DEFAULT_SKILL), help="production skill release/eval/canary evidence JSON path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            validate_blocked_diagnostics(Path(args.activation_evidence), Path(args.abuse_evidence), Path(args.skill_evidence))
        else:
            validate_evidence(Path(args.activation_evidence), Path(args.abuse_evidence), Path(args.skill_evidence))
    except Stage1ProductionGovernanceReleaseError as exc:
        print(f"stage1 production governance/release evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 production governance/release evidence contract passed")
    elif args.allow_preflight:
        print("stage1 production governance/release blocked/preflight evidence passed")
    else:
        print("stage1 production governance/release evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
