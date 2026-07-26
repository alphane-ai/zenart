#!/usr/bin/env python3
"""Validate Stage 1 production security launch exact evidence.

Contract-only mode checks OP-13 validator-readable requirements. Strict mode
requires canonical production security evidence and rejects check-level-only,
blocked, local, dry-run, preserved-DNL, raw payload, or secret-shaped evidence.
Allow-preflight mode validates blocked diagnostics from the split generator
without clearing gates.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "production_security" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "20260527T1700Z-security-launch-checks.json"
SPLIT_GENERATOR = ROOT / "scripts" / "generate_stage1_production_security_launch_evidence.py"
PRODUCTION_LAUNCH_CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
PRODUCTION_LAUNCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_launch.py"
PRODUCTION_LAUNCH_GENERATOR = ROOT / "scripts" / "generate_stage1_production_launch_evidence.py"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
SECURITY_SCAN_VALIDATOR = ROOT / "scripts" / "validate_stage1_security_scan_contract.py"
SECURITY_SCAN = ROOT / "scripts" / "security_scan_smoke.sh"
RATE_LIMIT_VALIDATOR = ROOT / "scripts" / "validate_stage1_rate_limit_spend_cap_contract.py"
STRIPE_STAGING_VALIDATOR = ROOT / "scripts" / "validate_stage1_stripe_staging_evidence.py"
PROVIDER_REGISTRY_VALIDATOR = ROOT / "scripts" / "validate_stage1_provider_registry_contract.py"
SECURITY_REDACT = ROOT / "backend" / "internal" / "security" / "redact.go"
SECURITY_TEST = ROOT / "backend" / "internal" / "security" / "redact_test.go"
SERVER_MIDDLEWARE = ROOT / "backend" / "internal" / "server" / "middleware.go"
SERVER_TEST = ROOT / "backend" / "internal" / "server" / "server_test.go"
WEB_REQUEST_SECURITY = ROOT / "web" / "lib" / "request-security.ts"
WEB_REQUEST_SECURITY_TEST = ROOT / "web" / "lib" / "request-security.test.ts"
ADMIN_FIXTURES = ROOT / "admin" / "lib" / "fixtures.ts"
ADMIN_GOV_TEST = ROOT / "admin" / "tests" / "admin-governance.test.mjs"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
REQUIRED_SECTIONS = {
    "secure_session_cookie",
    "csrf_same_site_enforcement",
    "secret_exposure_redaction",
    "admin_surface_privacy",
    "provider_key_containment",
    "stripe_live_test_separation",
    "rate_limit_spend_cap",
    "csp_headers",
    "rbac_tenant_isolation",
    "audit_refs",
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
    "stripe-signature",
    "stripe_signature",
    "signature",
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
    "security_privacy_legal_incomplete",
    "secret_exposure_runtime_not_verified",
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


class Stage1ProductionSecurityError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1ProductionSecurityError(message)


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
        raise Stage1ProductionSecurityError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def require_section_pass(data: dict[str, Any], section: str) -> dict[str, Any]:
    value = data.get(section)
    require(isinstance(value, dict), f"evidence.{section} must be an object")
    require(is_pass_status(value.get("status")), f"evidence.{section}.status must pass")
    if section == "audit_refs":
        refs = value.get("refs", value.get("evidence_refs"))
    else:
        refs = value.get("evidence_refs")
    require_ref_list(refs, f"evidence.{section}.evidence_refs")
    return value


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.production_security.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "production_security_launch_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/production/20260527T1700Z-security-launch-checks.json", "contract evidence path mismatch")
    require(contract.get("strict_schema_version") == "stage1.production_security_launch.v1", "strict schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_exact_production_security_launch_evidence_open", "contract status mismatch")
    require(contract.get("required_environment") == "production", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "production_security_launch_checks", "contract release gate mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")
    require(REQUIRED_SECTIONS <= set(contract.get("required_sections") or []), "contract missing required sections")
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
        "canonical_pass_path_required",
        "gate_impact_can_clear_required",
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
    require(SPLIT_GENERATOR.exists() and SPLIT_GENERATOR.stat().st_mode & 0o111, "production security launch evidence generator must be executable")
    require_text(
        SPLIT_GENERATOR,
        (
            "DEFAULT_EVIDENCE",
            "production-security-launch-source.json",
            "stage1.production_security_launch_source.v1",
            "source_probe_missing",
            "release_sha_missing_or_not_full_sha",
            "stage1.production_security_launch.v1",
            "production_security_launch_checks",
            "can_clear_security_launch_check",
            "blocked_report",
            "run_strict_validator",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_CONTRACT,
        (
            '"component_id": "security_launch_checks"',
            "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
            "scripts/generate_stage1_production_security_launch_evidence.py",
            "secure session cookies",
            "CSRF same-site enforcement",
            "secret redaction",
            "provider key containment",
            "Stripe live/test separation",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_VALIDATOR,
        (
            "security_launch_checks",
            "validate_production_security_launch_checks_evidence",
            "require_no_blocked_gate_signals",
        ),
    )
    require_text(PRODUCTION_LAUNCH_GENERATOR, ("security_launch_checks", "production_security_ready", "check_level_clear_signal"))
    require_text(
        STAGE0_VALIDATOR,
        (
            "validate_production_security_launch_checks_evidence",
            "production_security_launch_checks",
            "security_privacy_legal_incomplete",
            "secret_exposure_runtime_not_verified",
            "pass_with_blockers_preserved",
        ),
    )
    require_text(
        SECURITY_SCAN_VALIDATOR,
        (
            "production_security_launch_checks",
            "strict_staging_security_scan_evidence",
            "provider",
            "stripe",
            "rate_limit",
            "toolchain",
        ),
    )
    require_text(
        SECURITY_SCAN,
        (
            "stage1_security_coverage",
            "zai_key_shape",
            "stripe_key_shape",
            "production_gate",
        ),
    )
    require_text(
        RATE_LIMIT_VALIDATOR,
        (
            "daily_spend_cap_exceeded",
            "provider_kill_switch_enabled",
            "admin.billing.manual_credit",
            "ratelimit.RedisStore",
        ),
    )
    require_text(STRIPE_STAGING_VALIDATOR, ("livemode=true while STRIPE_MODE=test", "webhook_signature_persisted", "raw_stripe_payload_persisted"))
    require_text(
        PROVIDER_REGISTRY_VALIDATOR,
        (
            "kill_switch",
            "secret_ref",
            "provider_strategy_group_kill_switch_check",
            "secret_present",
        ),
    )
    require_text(SECURITY_REDACT, ("SecretKindProviderKey", "SecretKindWebhookSecret", "SecretKindSignedURL", "RedactString"))
    require_text(SECURITY_TEST, ("TestRedactStringHandlesProviderKeysAndInlineAssignments", "TestRedactStringCoversRawJSONPayloads"))
    require_text(SERVER_MIDDLEWARE, ("withSameSiteCSRF", "Access-Control-Allow-Headers", "CSRFHeaderName"))
    require_text(SERVER_TEST, ("TestStateChangingAPIRequiresSameSiteCSRFHeader", "TestBillingWebhookBypassesBrowserCSRFAndUsesSignatureProvider"))
    require_text(
        WEB_REQUEST_SECURITY,
        (
            "buildSessionSecurityContractEvidence",
            "serializeSetCookieContract",
            "buildSecureCookieSameSiteRuntimePairingDigest",
            "defaultSameSiteCsrfContract",
            "X-Zenari-CSRF",
            "same-site-origin-check",
            "secure-cookie-same-site-csrf-runtime",
        ),
    )
    require_text(WEB_REQUEST_SECURITY_TEST, ("same-site CSRF request contract", "secure-cookie", "X-Zenari-CSRF"))
    require_text(ADMIN_FIXTURES, ("production_security_launch_checks_20260527T1700Z", "secret_exposure_redaction", "admin_surface_privacy"))
    require_text(ADMIN_GOV_TEST, ("production_security_launch_checks", "20260527T1700Z-security-launch-checks.json"))
    require_text(BLUEPRINT, ("OP-13", "Production security launch checks", "provider key containment"))
    require_text(GAP_INVENTORY, ("QA-8", "Production security launch checks", "Strict staging security scan evidence"))
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_production_security_launch_evidence.py --contract-only",
            "validate_stage1_production_security_launch_evidence.py --allow-preflight",
            "generate_stage1_production_security_launch_evidence.py",
            "stage1 production security launch exact evidence strict fixture",
        ),
    )


def require_blocked_release_sha(value: Any, path: str) -> None:
    if value is None:
        return
    require(isinstance(value, str) and RELEASE_SHA_RE.fullmatch(value) is not None, f"{path} release_sha must be null or full lowercase SHA")


def validate_blocked_diagnostic(evidence_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    data = load_json(evidence_path)
    assert_no_secret(data, "security_preflight")
    require(data.get("schema_version") == "stage1.production_security_launch.blocked.v1", "security_preflight schema_version mismatch")
    require(data.get("environment") == "production", "security_preflight environment must be production")
    require(data.get("kind") == "production_security_launch_checks", "security_preflight kind mismatch")
    require(data.get("status") == "blocked", "security_preflight status must be blocked")
    require(data.get("release_gate_check_id") == "production_security_launch_checks", "security_preflight release gate check mismatch")
    require_blocked_release_sha(data.get("release_sha"), "security_preflight")
    require(data.get("canonical_pass_path") is False, "security_preflight.canonical_pass_path must be false")
    require(data.get("local_devport_debug") is False, "security_preflight.local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, "security_preflight.allow_local_devport_evidence must be false")
    require(data.get("dry_run") is False, "security_preflight.dry_run must be false")
    require(data.get("check_level_only") is False, "security_preflight.check_level_only must be false")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"security_preflight.{field} must be false")
    blockers = data.get("blocked_checks")
    require(isinstance(blockers, list) and blockers, "security_preflight.blocked_checks must be a non-empty list")
    for idx, blocker in enumerate(blockers):
        require(isinstance(blocker, str) and blocker.strip(), f"security_preflight.blocked_checks[{idx}] must be a non-empty string")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "security_preflight.gate_impact must be object")
    require(gate.get("can_clear_security_launch_check") is False, "security_preflight.gate_impact cannot clear security launch check")
    require(
        gate.get("preserved_release_gate_check_id") == "production_security_launch_checks",
        "security_preflight.gate_impact must preserve production security release gate",
    )
    remaining = gate.get("remaining_blockers")
    require(isinstance(remaining, list) and remaining == blockers, "security_preflight.gate_impact.remaining_blockers must mirror blocked_checks")


def validate_evidence(evidence_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    data = load_json(evidence_path)
    assert_no_secret(data, "evidence")
    require_no_blocked_gate_signals(data, "evidence")
    require(data.get("schema_version") == "stage1.production_security_launch.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment must be production")
    require(data.get("kind") == "production_security_launch_checks", "kind mismatch")
    require(is_pass_status(data.get("status")), "status must pass")
    require(data.get("release_gate_check_id") == "production_security_launch_checks", "release gate check mismatch")
    release_sha = data.get("release_sha")
    require(isinstance(release_sha, str) and RELEASE_SHA_RE.fullmatch(release_sha) is not None, "release_sha must be a full lowercase SHA")
    require(data.get("canonical_pass_path") is True, "canonical_pass_path must be true")
    require(data.get("local_devport_debug") is False, "local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, "allow_local_devport_evidence must be false")
    require(data.get("dry_run") is False, "dry_run must be false")
    require(data.get("check_level_only") is False, "check_level_only must be false")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    blocked = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    require(not blocked, f"evidence contains blocked/local/dry-run marker(s): {blocked}")

    for section in sorted(REQUIRED_SECTIONS):
        require_section_pass(data, section)
    require(data["secure_session_cookie"].get("http_only") is True, "secure_session_cookie.http_only must be true")
    require(data["secure_session_cookie"].get("secure") is True, "secure_session_cookie.secure must be true")
    require(str(data["secure_session_cookie"].get("same_site", "")).lower() in {"lax", "strict"}, "secure_session_cookie.same_site must be lax/strict")
    require(data["csrf_same_site_enforcement"].get("cross_site_mutations_denied") is True, "CSRF cross-site mutations must be denied")
    require(data["secret_exposure_redaction"].get("raw_secret_exposure_count") == 0, "raw secret exposure count must be zero")
    require(data["admin_surface_privacy"].get("raw_private_payload_visible") is False, "admin private payloads must not be visible")
    require(data["provider_key_containment"].get("frontend_secret_exposure_count") == 0, "frontend provider secret exposure must be zero")
    require(data["stripe_live_test_separation"].get("live_mode_isolated") is True, "Stripe live/test separation must be proven")
    require(data["rate_limit_spend_cap"].get("kill_switch_ready") is True, "rate_limit_spend_cap.kill_switch_ready must be true")
    require(data["csp_headers"].get("csp_present") is True, "csp_headers.csp_present must be true")
    require(data["rbac_tenant_isolation"].get("cross_tenant_denials") is True, "rbac_tenant_isolation.cross_tenant_denials must be true")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_security_launch_checks", "gate_impact release gate mismatch")
    require(gate.get("can_clear_security_launch_check") is True, "gate_impact must clear security launch check")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing blocked production security diagnostics")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="production security launch evidence JSON path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            validate_blocked_diagnostic(Path(args.evidence))
        else:
            validate_evidence(Path(args.evidence))
    except Stage1ProductionSecurityError as exc:
        print(f"stage1 production security launch evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 production security launch evidence contract passed")
    elif args.allow_preflight:
        print("stage1 production security launch blocked/preflight evidence passed")
    else:
        print("stage1 production security launch evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
