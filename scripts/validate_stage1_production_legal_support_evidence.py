#!/usr/bin/env python3
"""Validate Stage 1 production legal/support exact evidence.

Contract-only mode checks OP-12/VF-7 validator-readable requirements. Strict
mode requires both canonical production legal/support files and rejects
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
CONTRACT = ROOT / "fixtures" / "stage1" / "production_legal_support" / "local_contract.json"
DEFAULT_LEGAL = ROOT / "ops" / "evidence" / "production" / "public-legal-policy.json"
DEFAULT_SUPPORT = ROOT / "ops" / "evidence" / "production" / "public-support-billing-policy.json"
SPLIT_GENERATOR = ROOT / "scripts" / "generate_stage1_production_legal_support_evidence.py"
PRODUCTION_LAUNCH_CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
PRODUCTION_LAUNCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_launch.py"
PRODUCTION_LAUNCH_GENERATOR = ROOT / "scripts" / "generate_stage1_production_launch_evidence.py"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
STAGING_LEGAL_SMOKE = ROOT / "scripts" / "staging_legal_support_visibility_smoke.sh"
WEB_LEGAL_POLICIES = ROOT / "web" / "lib" / "legal-policies.ts"
WEB_LEGAL_PAGE = ROOT / "web" / "components" / "legal-policy-page.tsx"
ADMIN_FIXTURES = ROOT / "admin" / "lib" / "fixtures.ts"
ADMIN_GOV_TEST = ROOT / "admin" / "tests" / "admin-governance.test.mjs"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
LEGAL_PAGES = {"terms", "privacy", "acceptable_use", "ai_content_disclaimer", "ip_complaint"}
SUPPORT_PAGES = {"support_contact", "report_problem", "billing_policy", "support_sla"}
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
    "public_legal_support_policy_not_deployed",
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


class Stage1ProductionLegalSupportError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1ProductionLegalSupportError(message)


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
        raise Stage1ProductionLegalSupportError(f"{display_path(path)} invalid JSON: {exc}") from exc
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
    require(contract.get("schema_version") == "stage1.production_legal_support.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "production_legal_support_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_legal_evidence_path") == "ops/evidence/production/public-legal-policy.json", "legal path mismatch")
    require(
        contract.get("canonical_support_billing_evidence_path") == "ops/evidence/production/public-support-billing-policy.json",
        "support/billing path mismatch",
    )
    require(contract.get("strict_legal_schema_version") == "stage1.production_legal_policy.v1", "strict legal schema mismatch")
    require(contract.get("strict_support_billing_schema_version") == "stage1.production_support_billing_policy.v1", "strict support schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_exact_production_legal_support_evidence_open", "contract status mismatch")
    require(contract.get("required_environment") == "production", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "production_legal_support_policy", "contract release gate mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")
    require(LEGAL_PAGES <= set(contract.get("required_legal_pages") or []), "contract missing required legal pages")
    require(SUPPORT_PAGES <= set(contract.get("required_support_billing_pages") or []), "contract missing required support/billing pages")
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
        "release_sha_must_match_between_legal_files",
        "canonical_pass_path_required",
        "legal_gate_impact_can_clear_required",
        "support_billing_gate_impact_can_clear_required",
        "public_external_user_probe_required",
        "support_sla_required",
        "paid_launch_policy_alignment_required",
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
    require(SPLIT_GENERATOR.exists() and SPLIT_GENERATOR.stat().st_mode & 0o111, "production legal/support split evidence generator must be executable")
    require_text(
        SPLIT_GENERATOR,
        (
            "DEFAULT_LEGAL",
            "DEFAULT_SUPPORT",
            "production-legal-support-source.json",
            "stage1.production_legal_support_source.v1",
            "source_probe_missing",
            "release_sha_missing_or_not_full_sha",
            "stage1.production_legal_policy.v1",
            "stage1.production_support_billing_policy.v1",
            "can_clear_public_legal_subitem",
            "can_clear_support_billing_policy_subitem",
            "blocked_report",
            "run_strict_validator",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_CONTRACT,
        (
            '"component_id": "legal_support_policy"',
            "ops/evidence/production/public-legal-policy.json",
            "ops/evidence/production/public-support-billing-policy.json",
            "scripts/generate_stage1_production_legal_support_evidence.py",
            "AI/content disclaimer",
            "IP complaint flow",
            "billing cancellation refund policy",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_VALIDATOR,
        (
            "legal_support_policy",
            "validate_production_legal_support_policy_evidence",
            "require_no_blocked_gate_signals",
        ),
    )
    require_text(PRODUCTION_LAUNCH_GENERATOR, ("legal_support_policy", "production_legal_support_ready", "check_level_clear_signal"))
    require_text(
        STAGE0_VALIDATOR,
        (
            "validate_production_legal_support_policy_evidence",
            "public_legal_support_policy_not_deployed",
            "paid billing lifecycle remains separately blocked",
            "policy visibility",
        ),
    )
    require_text(
        STAGING_LEGAL_SMOKE,
        (
            "Terms of Service",
            "Privacy Policy",
            "Acceptable Use Policy",
            "Billing, Cancellation, and Refund Policy",
            "support@zenari.ai",
        ),
    )
    require_text(
        WEB_LEGAL_POLICIES,
        (
            "Terms of Service",
            "Privacy Policy",
            "Acceptable Use Policy",
            "IP Complaint Flow",
            "Billing, Cancellation, and Refund Policy",
            "support@zenari.ai",
            "legal@zenari.ai",
            "past due",
            "Refunds and Credits",
        ),
    )
    require_text(WEB_LEGAL_PAGE, ("Visible support contact", "supportContactEmail", "billing, export, or complaint help"))
    require_text(ADMIN_FIXTURES, ("production_legal_support_policy_20260527T1900Z", "public_support_contact", "billing_policy_visibility"))
    require_text(ADMIN_GOV_TEST, ("production public support/billing policy evidence file is missing", "production_legal_support_policy"))
    require_text(BLUEPRINT, ("OP-12", "support SLA", "refund policy", "billing policy"))
    require_text(GAP_INVENTORY, ("OP-12", "Legal/support visibility", "production legal/support"))
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_production_legal_support_evidence.py --contract-only",
            "validate_stage1_production_legal_support_evidence.py --allow-preflight",
            "generate_stage1_production_legal_support_evidence.py",
            "stage1 production legal/support exact evidence strict fixture",
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
    require(data.get("release_gate_check_id") == "production_legal_support_policy", f"{path} release gate check mismatch")
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
    require(gate.get("can_clear_public_legal_subitem") is False, f"{path}.gate_impact cannot clear public legal subitem")
    require(gate.get("can_clear_support_billing_policy_subitem") is False, f"{path}.gate_impact cannot clear support/billing subitem")
    require(gate.get("can_clear_aggregate_production_gate") is False, f"{path}.gate_impact cannot clear aggregate production gate")
    require(
        gate.get("preserved_release_gate_check_id") == "production_legal_support_policy",
        f"{path}.gate_impact must preserve production legal/support release gate",
    )
    remaining = gate.get("remaining_blockers")
    require(isinstance(remaining, list) and remaining == blockers, f"{path}.gate_impact.remaining_blockers must mirror blocked_checks")
    return [str(item) for item in blockers]


def validate_blocked_diagnostics(legal_path: Path, support_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    legal = load_json(legal_path)
    support = load_json(support_path)
    legal_blockers = require_blocked_diagnostic_common(
        legal,
        path="legal_preflight",
        schema_version="stage1.production_public_legal_policy.blocked.v1",
        kind="production_public_legal_policy",
    )
    support_blockers = require_blocked_diagnostic_common(
        support,
        path="support_preflight",
        schema_version="stage1.production_public_support_billing_policy.blocked.v1",
        kind="production_public_support_billing_policy",
    )
    require(legal.get("release_sha") == support.get("release_sha"), "blocked legal/support diagnostics release_sha values must match")
    require(legal_blockers == support_blockers, "blocked legal/support diagnostics must share blockers")


def validate_common(data: dict[str, Any], *, path: str, schema_version: str, kind: str) -> str:
    assert_no_secret(data, path)
    require_no_blocked_gate_signals(data, path)
    require(data.get("schema_version") == schema_version, f"{path} schema_version mismatch")
    require(data.get("environment") == "production", f"{path} environment must be production")
    require(data.get("kind") == kind, f"{path} kind mismatch")
    require(is_pass_status(data.get("status")), f"{path} status must pass")
    require(data.get("release_gate_check_id") == "production_legal_support_policy", f"{path} release gate check mismatch")
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


def require_page_probe(probe: dict[str, Any], path: str) -> None:
    require(probe.get("status") == "pass", f"{path}.status must pass")
    require(probe.get("http_status") == 200, f"{path}.http_status must be 200")
    require(probe.get("visibility") == "public", f"{path}.visibility must be public")
    require(probe.get("external_user_visible") is True, f"{path}.external_user_visible must be true")
    require(probe.get("admin_session_required") is False, f"{path}.admin_session_required must be false")
    tokens = probe.get("required_tokens")
    require(isinstance(tokens, list) and len(tokens) >= 2, f"{path}.required_tokens must be specific")


def validate_legal(data: dict[str, Any]) -> str:
    release_sha = validate_common(
        data,
        path="legal",
        schema_version="stage1.production_legal_policy.v1",
        kind="production_public_legal_policy",
    )
    probes = data.get("page_probes")
    require(isinstance(probes, list) and probes, "legal.page_probes must be non-empty")
    by_id = {probe.get("page_id"): probe for probe in probes if isinstance(probe, dict)}
    require(LEGAL_PAGES <= set(by_id), f"legal missing page probes {sorted(LEGAL_PAGES - set(by_id))}")
    expected_tokens = {
        "terms": {"Terms", "support contact", "AI content"},
        "privacy": {"Privacy", "data deletion", "support contact"},
        "acceptable_use": {"Acceptable Use", "abuse", "support contact"},
        "ai_content_disclaimer": {"AI content", "responsibility", "review"},
        "ip_complaint": {"IP complaint", "copyright", "trademark", "takedown"},
    }
    for page_id, required in expected_tokens.items():
        probe = by_id[page_id]
        require_page_probe(probe, f"legal.page_probes.{page_id}")
        observed = {str(item) for item in probe.get("required_tokens", [])}
        require(required <= observed, f"legal.page_probes.{page_id} missing tokens {sorted(required - observed)}")
    coverage = data.get("coverage")
    require(isinstance(coverage, list) and coverage, "legal.coverage must be non-empty")
    require({"public_legal_pages", "gate_clearance"} <= {item.get("area") for item in coverage if isinstance(item, dict)}, "legal coverage missing required areas")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "legal.gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_legal_support_policy", "legal gate impact release gate mismatch")
    require(gate.get("can_clear_public_legal_subitem") is True, "legal gate must clear public legal subitem")
    require(gate.get("can_clear_aggregate_production_gate") in {False, None}, "legal gate must not clear aggregate production gate")
    return release_sha


def validate_support(data: dict[str, Any]) -> str:
    release_sha = validate_common(
        data,
        path="support",
        schema_version="stage1.production_support_billing_policy.v1",
        kind="production_public_support_billing_policy",
    )
    probes = data.get("page_probes")
    require(isinstance(probes, list) and probes, "support.page_probes must be non-empty")
    by_id = {probe.get("page_id"): probe for probe in probes if isinstance(probe, dict)}
    require(SUPPORT_PAGES <= set(by_id), f"support missing page probes {sorted(SUPPORT_PAGES - set(by_id))}")
    expected_tokens = {
        "support_contact": {"support contact", "report problem", "privacy redaction", "escalation"},
        "report_problem": {"project", "task", "trace", "export", "quota"},
        "billing_policy": {"billing", "cancellation", "refund", "credit", "quota reset", "past_due"},
        "support_sla": {"support SLA", "severity", "response time", "escalation"},
    }
    for page_id, required in expected_tokens.items():
        probe = by_id[page_id]
        require_page_probe(probe, f"support.page_probes.{page_id}")
        observed = {str(item) for item in probe.get("required_tokens", [])}
        require(required <= observed, f"support.page_probes.{page_id} missing tokens {sorted(required - observed)}")
    coverage = data.get("coverage")
    require(isinstance(coverage, list) and coverage, "support.coverage must be non-empty")
    areas = {item.get("area") for item in coverage if isinstance(item, dict)}
    require({"public_support_contact", "billing_policy_visibility", "support_sla", "gate_clearance"} <= areas, "support coverage missing required areas")
    policy = data.get("paid_launch_policy_alignment")
    require(isinstance(policy, dict), "support.paid_launch_policy_alignment must be object")
    require(policy.get("billing_policy_visible") is True, "billing policy must be visible")
    require(policy.get("refund_policy_visible") is True, "refund policy must be visible")
    require(policy.get("cancellation_policy_visible") is True, "cancellation policy must be visible")
    require(policy.get("support_sla_visible") is True, "support SLA must be visible")
    require(policy.get("standalone_production_readiness_claim") is False, "must not claim standalone production readiness")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "support.gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_legal_support_policy", "support gate impact release gate mismatch")
    require(gate.get("can_clear_support_billing_policy_subitem") is True, "support gate must clear support/billing policy subitem")
    require(gate.get("can_clear_aggregate_production_gate") in {False, None}, "support gate must not clear aggregate production gate")
    return release_sha


def validate_evidence(legal_path: Path, support_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    legal_sha = validate_legal(load_json(legal_path))
    support_sha = validate_support(load_json(support_path))
    require(legal_sha == support_sha, "legal and support/billing release_sha values must match")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing blocked production legal/support diagnostics")
    parser.add_argument("--legal-evidence", default=str(DEFAULT_LEGAL), help="production public legal policy evidence JSON path")
    parser.add_argument("--support-evidence", default=str(DEFAULT_SUPPORT), help="production public support/billing policy evidence JSON path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            validate_blocked_diagnostics(Path(args.legal_evidence), Path(args.support_evidence))
        else:
            validate_evidence(Path(args.legal_evidence), Path(args.support_evidence))
    except Stage1ProductionLegalSupportError as exc:
        print(f"stage1 production legal/support evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 production legal/support evidence contract passed")
    elif args.allow_preflight:
        print("stage1 production legal/support blocked/preflight evidence passed")
    else:
        print("stage1 production legal/support evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
