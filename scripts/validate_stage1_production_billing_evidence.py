#!/usr/bin/env python3
"""Validate Stage 1 production paid billing lifecycle exact evidence.

Contract-only mode checks that BL-10 has validator-readable production billing
requirements. Strict mode requires both canonical production billing files and
rejects invite/comp-only, deferred, blocked, local, dry-run, no-go,
preserved-blocker, raw payload, or secret-shaped evidence. Allow-preflight mode
validates blocked diagnostics from the split generator without clearing gates.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "production_billing" / "local_contract.json"
DEFAULT_LIFECYCLE = ROOT / "ops" / "evidence" / "production" / "billing-lifecycle.json"
DEFAULT_REFUND = ROOT / "ops" / "evidence" / "production" / "billing-refund-credit-webhook.json"
SPLIT_GENERATOR = ROOT / "scripts" / "generate_stage1_production_billing_evidence.py"
PRODUCTION_LAUNCH_CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
PRODUCTION_LAUNCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_launch.py"
PRODUCTION_LAUNCH_GENERATOR = ROOT / "scripts" / "generate_stage1_production_launch_evidence.py"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
STRIPE_STAGING_VALIDATOR = ROOT / "scripts" / "validate_stage1_stripe_staging_evidence.py"
STRIPE_LIFECYCLE_VALIDATOR = ROOT / "scripts" / "validate_stage1_stripe_lifecycle_reconciliation.py"
ADMIN_BILLING_VALIDATOR = ROOT / "scripts" / "validate_stage1_admin_billing_ops_contract.py"
TEAM_SEAT_VALIDATOR = ROOT / "scripts" / "validate_stage1_team_seat_billing_contract.py"
USER_BILLING_VALIDATOR = ROOT / "scripts" / "validate_stage1_user_billing_invoice_contract.py"
CHECKOUT = ROOT / "backend" / "internal" / "billing" / "stripe_checkout.go"
WEBHOOK = ROOT / "backend" / "internal" / "billing" / "stripe_webhook.go"
BILLING = ROOT / "backend" / "internal" / "billing" / "billing.go"
RECONCILER = ROOT / "backend" / "internal" / "billing" / "stripe_lifecycle_reconcile.go"
CONFIG = ROOT / "backend" / "internal" / "config" / "config.go"
CONFIG_TEST = ROOT / "backend" / "internal" / "config" / "config_test.go"
SERVER = ROOT / "backend" / "internal" / "server" / "server.go"
ADMIN_QUOTA_PAGE = ROOT / "admin" / "app" / "quota" / "page.tsx"
WEB_BILLING_CLIENT = ROOT / "web" / "lib" / "billing-client.ts"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
TESTLIKE_ARTIFACT_RE = re.compile(r"(^|[_:\-/])(test|fixture|sandbox|mock|dryrun|dev)([_:\-/]|$)", re.IGNORECASE)
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
    "invite/comp-only",
    "invite_comp_only",
    "comp-only",
    "comp_only",
    "pass_with_blockers_preserved",
    "paid_billing_or_comp_only_mode_missing",
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
    "preserved_do_not_launch_condition_id",
    "preserved_release_gate_check_id",
    "preserved_do_not_launch_condition_ids",
}
LIFECYCLE_SECTIONS = {
    "stripe_live_test_separation",
    "paid_checkout",
    "subscription_active",
    "subscription_past_due",
    "subscription_cancel",
    "team_seat_quantity_sync",
    "invoice_receipt_visibility",
    "audit_refs",
}
REFUND_SECTIONS = {
    "refund_or_credit",
    "quota_reset",
    "webhook_idempotency",
    "failed_export_refund",
    "quota_projection",
    "audit_refs",
}


class Stage1ProductionBillingError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1ProductionBillingError(message)


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
        raise Stage1ProductionBillingError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def require_empty_list(value: Any, path: str) -> None:
    require(isinstance(value, list) and not value, f"{path} must be an empty list")


def require_livemode_true(value: dict[str, Any], path: str) -> None:
    require(value.get("livemode") is True, f"{path}.livemode must be true for production strict evidence")


def require_provider_id(value: Any, path: str, prefixes: tuple[str, ...]) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty provider id")
    candidate = value.strip()
    require(candidate.startswith(prefixes), f"{path} must start with one of {prefixes}")
    require(not TESTLIKE_ARTIFACT_RE.search(candidate), f"{path} must not be test/sandbox/dev/fixture-shaped")
    return candidate


def require_nonempty_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty string")
    return value.strip()


def require_event_id_list(value: Any, path: str) -> None:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    for idx, item in enumerate(value):
        require_provider_id(item, f"{path}[{idx}]", ("evt_",))


def require_section_pass(data: dict[str, Any], section: str, path: str) -> dict[str, Any]:
    value = data.get(section)
    require(isinstance(value, dict), f"{path}.{section} must be an object")
    require(is_pass_status(value.get("status")), f"{path}.{section}.status must pass")
    if section == "audit_refs":
        refs = value.get("refs", value.get("evidence_refs"))
        require_ref_list(refs, f"{path}.{section}.refs")
    else:
        refs = value.get("evidence_refs")
        require_ref_list(refs, f"{path}.{section}.evidence_refs")
    return value


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.production_billing.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "production_paid_billing_lifecycle_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_lifecycle_evidence_path") == "ops/evidence/production/billing-lifecycle.json", "lifecycle path mismatch")
    require(
        contract.get("canonical_refund_credit_webhook_evidence_path") == "ops/evidence/production/billing-refund-credit-webhook.json",
        "refund/webhook path mismatch",
    )
    require(contract.get("strict_lifecycle_schema_version") == "stage1.production_billing_lifecycle.v1", "lifecycle schema mismatch")
    require(
        contract.get("strict_refund_credit_webhook_schema_version") == "stage1.production_billing_refund_credit_webhook.v1",
        "refund/webhook schema mismatch",
    )
    require(contract.get("release_gate_status") == "contract_ready_exact_production_paid_billing_evidence_open", "contract status mismatch")
    require(contract.get("required_environment") == "production", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "production_paid_billing_lifecycle", "contract release gate mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")
    require(LIFECYCLE_SECTIONS <= set(contract.get("required_lifecycle_sections") or []), "contract missing lifecycle sections")
    require(REFUND_SECTIONS <= set(contract.get("required_refund_credit_webhook_sections") or []), "contract missing refund/webhook sections")
    policy = contract.get("safe_projection_policy")
    require(isinstance(policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    blocked_policy = contract.get("blocked_diagnostic_policy")
    require(isinstance(blocked_policy, dict), "blocked_diagnostic_policy must be object")
    require(blocked_policy.get("validator_flag") == "--allow-preflight", "blocked diagnostic validator flag mismatch")
    require(blocked_policy.get("status") == "blocked", "blocked diagnostic status mismatch")
    require(blocked_policy.get("canonical_pass_path") is False, "blocked diagnostic must not claim canonical pass path")
    require(blocked_policy.get("can_clear_release_gate_check") is False, "blocked diagnostic cannot clear release gate")
    require(blocked_policy.get("requires_blocked_checks") is True, "blocked diagnostic must require blockers")
    require(blocked_policy.get("requires_preserved_release_gate_check_id") is True, "blocked diagnostic must preserve release gate")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    for key in (
        "release_sha_full_40_hex",
        "release_sha_must_match_between_billing_files",
        "canonical_pass_path_required",
        "lifecycle_gate_impact_can_clear_required",
        "refund_credit_webhook_gate_impact_can_clear_required",
        "stripe_live_test_separation_required",
        "webhook_replay_must_be_idempotent",
        "team_seat_quantity_sync_required",
        "invoice_receipt_visibility_required",
        "stripe_livemode_true_required",
        "no_test_artifact_ids",
        "team_seat_provider_subscription_item_required",
        "team_seat_proration_behavior_required",
        "team_seat_idempotency_required",
        "invoice_hosted_link_visibility_required",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "allow_invite_comp_only_substitute",
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run",
        "allow_blocked_status",
        "allow_no_go_status",
        "allow_deferred_status",
        "allow_preserved_blockers",
        "allow_raw_or_secret_payloads",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")


def validate_code_anchors() -> None:
    require(SPLIT_GENERATOR.exists() and SPLIT_GENERATOR.stat().st_mode & 0o111, "production billing split evidence generator must be executable")
    require_text(
        SPLIT_GENERATOR,
        (
            "DEFAULT_LIFECYCLE",
            "DEFAULT_REFUND",
            "billing-paid-lifecycle-source.json",
            "stage1.production_billing_source.v1",
            "source_probe_missing",
            "release_sha_missing_or_not_full_sha",
            "stage1.production_billing_lifecycle.v1",
            "stage1.production_billing_refund_credit_webhook.v1",
            "livemode",
            "webhook_idempotency",
            "can_clear_billing_lifecycle_subitem",
            "can_clear_refund_credit_webhook_subitem",
            "blocked_report",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_CONTRACT,
        (
            '"component_id": "paid_billing_lifecycle"',
            "ops/evidence/production/billing-lifecycle.json",
            "ops/evidence/production/billing-refund-credit-webhook.json",
            "scripts/generate_stage1_production_billing_evidence.py",
            "Stripe live/test separation",
            "team seat quantity sync",
            "invoice and receipt visibility",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_VALIDATOR,
        (
            "paid_billing_lifecycle",
            "ops/evidence/production/billing-lifecycle.json",
            "require_no_blocked_gate_signals",
            "production_billing_ready",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_GENERATOR,
        (
            "production_billing_ready",
            "paid_billing_lifecycle",
            "blocked_gate_signal_blockers",
        ),
    )
    require_text(
        STAGE0_VALIDATOR,
        (
            "production_paid_billing_lifecycle",
            "paid_billing_or_comp_only_mode_missing",
            "Production refund/credit/quota reset/webhook idempotency runtime evidence",
            "it cannot substitute for `ops/evidence/production/billing-lifecycle.json`",
        ),
    )
    require_text(
        STRIPE_STAGING_VALIDATOR,
        (
            "checkout_session_created",
            "invoice_payment_failed",
            "refund_credit",
            "webhook_replay_idempotency",
            "quota_projection",
            "invoice_receipt_visibility",
        ),
    )
    require_text(STRIPE_LIFECYCLE_VALIDATOR, ("StripeLifecycleReconciler", "refund_note", "manual_credit", "quota_reset_invoked"))
    require_text(ADMIN_BILLING_VALIDATOR, ("manual_credit", "refund_note", "billing.refund_note", "billing.manual_credit"))
    require_text(TEAM_SEAT_VALIDATOR, ("Stripe subscription item", "proration_behavior", "stripe team seat response livemode=true"))
    require_text(USER_BILLING_VALIDATOR, ("GET /billing/invoices", "hosted_invoice_url", "invoice_pdf", "Refresh Invoices"))
    require_text(
        CHECKOUT,
        (
            "CreateCheckout",
            "CancelSubscription",
            "ListInvoices",
            "SyncTeamSeatQuantity",
            "livemode=true while STRIPE_MODE=test",
            "stripeErrorSummary",
            "body_sha256=",
            "security.RedactString",
            "stripeErrorObjectIDPattern",
        ),
    )
    require_text(
        ROOT / "backend" / "internal" / "billing" / "stripe_checkout_test.go",
        (
            "TestStripeCreateCheckoutRedactsNon2xxResponseBody",
            "TestStripeSharedRequestHelperRedactsNon2xxResponseBody",
            "payment_method=pm_card_visa",
            "body_sha256=",
        ),
    )
    require_text(
        CONFIG,
        (
            "STRIPE_SECRET_KEY or STRIPE_API_KEY must match STRIPE_MODE",
            "STRIPE_PUBLISHABLE_KEY must match STRIPE_MODE",
            "STRIPE_MODE=live is not allowed when ZENARI_ENV is local",
        ),
    )
    require_text(
        CONFIG_TEST,
        (
            "TestValidateRejectsStripeTestModeWithLiveKeys",
            "TestValidateRejectsStripeLiveModeWithTestKeysOutsideLocal",
            "TestValidateRejectsStripeLiveModeInLocalEnvironment",
        ),
    )
    require_text(WEBHOOK, ("verifyStripeWebhookSignature", "ClaimEvent", "MarkEventProcessed", "invoice.payment_failed", "invoice.paid"))
    require_text(BILLING, ("AdminBillingOperationManualCredit", "AdminBillingOperationRefundNote", "team_seat_billing_syncs", "quota_transactions"))
    require_text(RECONCILER, ("ReconcileStripeLifecycle", "WebhookReplayIdempotent", "RefundCreditSeen", "QuotaResetInvoked"))
    require_text(SERVER, ("POST /api/v1/billing/checkout", "POST /api/v1/billing/webhook", "POST /api/admin/v1/billing/manual-credit", "POST /api/admin/v1/billing/refund-note"))
    require_text(ADMIN_QUOTA_PAGE, ("data-admin-billing-op=\"manual_credit\"", "data-admin-billing-op=\"refund_note\"", "Stripe subscription item", "Production billing evidence"))
    require_text(WEB_BILLING_CLIENT, ("createCheckoutSession", "cancelSubscription", "listInvoices", "defaultCheckoutPlanId"))
    require_text(BLUEPRINT, ("BL-10", "ops/evidence/production/billing-lifecycle.json", "Production billing lifecycle evidence"))
    require_text(GAP_INVENTORY, ("BL-10", "Production billing evidence remains open", "VF-7"))
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_production_billing_evidence.py --contract-only",
            "validate_stage1_production_billing_evidence.py --allow-preflight",
            "generate_stage1_production_billing_evidence.py",
            "stage1 production billing exact evidence strict fixture",
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
    require(data.get("release_gate_check_id") == "production_paid_billing_lifecycle", f"{path} release gate check mismatch")
    require_blocked_release_sha(data.get("release_sha"), path)
    require(data.get("canonical_pass_path") is False, f"{path}.canonical_pass_path must be false")
    require(data.get("local_devport_debug") is False, f"{path}.local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, f"{path}.allow_local_devport_evidence must be false")
    require(data.get("dry_run") is False, f"{path}.dry_run must be false")
    require(data.get("invite_comp_only_substitute") is False, f"{path}.invite_comp_only_substitute must be false")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{path}.{field} must be false")
    blockers = data.get("blocked_checks")
    require(isinstance(blockers, list) and blockers, f"{path}.blocked_checks must be a non-empty list")
    for idx, blocker in enumerate(blockers):
        require(isinstance(blocker, str) and blocker.strip(), f"{path}.blocked_checks[{idx}] must be a non-empty string")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), f"{path}.gate_impact must be object")
    require(gate.get("can_clear_billing_lifecycle_subitem") is False, f"{path}.gate_impact cannot clear lifecycle subitem")
    require(gate.get("can_clear_refund_credit_webhook_subitem") is False, f"{path}.gate_impact cannot clear refund/webhook subitem")
    require(
        gate.get("preserved_release_gate_check_id") == "production_paid_billing_lifecycle",
        f"{path}.gate_impact must preserve production billing release gate",
    )
    remaining = gate.get("remaining_blockers")
    require(isinstance(remaining, list) and remaining == blockers, f"{path}.gate_impact.remaining_blockers must mirror blocked_checks")
    return [str(item) for item in blockers]


def validate_blocked_diagnostics(lifecycle_path: Path, refund_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    lifecycle = load_json(lifecycle_path)
    refund = load_json(refund_path)
    lifecycle_blockers = require_blocked_diagnostic_common(
        lifecycle,
        path="lifecycle_preflight",
        schema_version="stage1.production_billing_lifecycle.blocked.v1",
        kind="production_billing_lifecycle",
    )
    refund_blockers = require_blocked_diagnostic_common(
        refund,
        path="refund_preflight",
        schema_version="stage1.production_billing_refund_credit_webhook.blocked.v1",
        kind="production_billing_refund_credit_webhook",
    )
    require(lifecycle.get("release_sha") == refund.get("release_sha"), "blocked billing diagnostics release_sha values must match")
    require(lifecycle_blockers == refund_blockers, "blocked billing diagnostics must share blockers")


def validate_common_evidence(data: dict[str, Any], *, path: str, schema_version: str, kind: str) -> str:
    assert_no_secret(data, path)
    require_no_blocked_gate_signals(data, path)
    require(data.get("schema_version") == schema_version, f"{path} schema_version mismatch")
    require(data.get("environment") == "production", f"{path} environment must be production")
    require(data.get("kind") == kind, f"{path} kind mismatch")
    require(is_pass_status(data.get("status")), f"{path} status must pass")
    require(data.get("release_gate_check_id") == "production_paid_billing_lifecycle", f"{path} release gate check mismatch")
    release_sha = data.get("release_sha")
    require(isinstance(release_sha, str) and RELEASE_SHA_RE.fullmatch(release_sha) is not None, f"{path} release_sha must be a full lowercase SHA")
    require(data.get("canonical_pass_path") is True, f"{path} canonical_pass_path must be true")
    require(data.get("local_devport_debug") is False, f"{path} local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, f"{path} allow_local_devport_evidence must be false")
    require(data.get("dry_run") is False, f"{path} dry_run must be false")
    require(data.get("invite_comp_only_substitute") is False, f"{path} invite_comp_only_substitute must be false")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{path}.{field} must be false")
    blocked = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    require(not blocked, f"{path} contains blocked/deferred/local/dry-run marker(s): {blocked}")
    return release_sha


def validate_lifecycle(data: dict[str, Any]) -> str:
    release_sha = validate_common_evidence(
        data,
        path="lifecycle",
        schema_version="stage1.production_billing_lifecycle.v1",
        kind="production_paid_billing_lifecycle",
    )
    for section in sorted(LIFECYCLE_SECTIONS):
        require_section_pass(data, section, "lifecycle")
    separation = data["stripe_live_test_separation"]
    require(separation.get("stripe_mode") == "live", "lifecycle.stripe_live_test_separation.stripe_mode must be live")
    require(separation.get("live_mode_enabled") is True, "lifecycle.stripe_live_test_separation.live_mode_enabled must be true")
    require(separation.get("test_mode_isolated") is True, "lifecycle.stripe_live_test_separation.test_mode_isolated must be true")
    require(separation.get("live_artifacts_verified") is True, "lifecycle.stripe_live_test_separation.live_artifacts_verified must be true")
    require_empty_list(separation.get("test_artifact_refs"), "lifecycle.stripe_live_test_separation.test_artifact_refs")
    checkout = data["paid_checkout"]
    require_livemode_true(checkout, "lifecycle.paid_checkout")
    require_provider_id(checkout.get("checkout_session_id"), "lifecycle.paid_checkout.checkout_session_id", ("cs_live_",))
    require_provider_id(checkout.get("customer_id"), "lifecycle.paid_checkout.customer_id", ("cus_",))
    require_provider_id(checkout.get("price_id"), "lifecycle.paid_checkout.price_id", ("price_",))
    active = data["subscription_active"]
    require_livemode_true(active, "lifecycle.subscription_active")
    require(active.get("subscription_status") in {"active", "trialing"}, "lifecycle.subscription_active status mismatch")
    require_provider_id(active.get("subscription_id"), "lifecycle.subscription_active.subscription_id", ("sub_",))
    require_provider_id(active.get("customer_id"), "lifecycle.subscription_active.customer_id", ("cus_",))
    past_due = data["subscription_past_due"]
    require_livemode_true(past_due, "lifecycle.subscription_past_due")
    require(past_due.get("subscription_status") == "past_due", "lifecycle.subscription_past_due status mismatch")
    require_provider_id(past_due.get("subscription_id"), "lifecycle.subscription_past_due.subscription_id", ("sub_",))
    require_provider_id(past_due.get("invoice_id"), "lifecycle.subscription_past_due.invoice_id", ("in_",))
    cancel = data["subscription_cancel"]
    require_livemode_true(cancel, "lifecycle.subscription_cancel")
    require(cancel.get("cancel_at_period_end") is True or cancel.get("subscription_status") in {"cancelled", "canceled"}, "lifecycle.subscription_cancel must show cancellation")
    require_provider_id(cancel.get("subscription_id"), "lifecycle.subscription_cancel.subscription_id", ("sub_",))
    team = data["team_seat_quantity_sync"]
    require(isinstance(team.get("seat_quantity"), int) and team["seat_quantity"] > 0, "lifecycle.team_seat_quantity_sync.seat_quantity must be positive")
    require(isinstance(team.get("synced_quantity"), int) and team["synced_quantity"] == team["seat_quantity"], "lifecycle team seat synced quantity mismatch")
    require_provider_id(team.get("provider_subscription_item_id"), "lifecycle.team_seat_quantity_sync.provider_subscription_item_id", ("si_",))
    require(team.get("proration_behavior") in {"create_prorations", "none", "always_invoice"}, "lifecycle.team_seat_quantity_sync.proration_behavior mismatch")
    require_nonempty_string(team.get("sync_idempotency_key"), "lifecycle.team_seat_quantity_sync.sync_idempotency_key")
    require(team.get("idempotency_verified") is True, "lifecycle.team_seat_quantity_sync.idempotency_verified must be true")
    invoice = data["invoice_receipt_visibility"]
    require_livemode_true(invoice, "lifecycle.invoice_receipt_visibility")
    require_provider_id(invoice.get("invoice_id"), "lifecycle.invoice_receipt_visibility.invoice_id", ("in_",))
    require(invoice.get("invoice_visible") is True, "lifecycle invoice must be visible")
    require(invoice.get("receipt_visible") is True, "lifecycle receipt must be visible")
    require(invoice.get("secret_visible") is False, "lifecycle invoice secret_visible must be false")
    require(invoice.get("hosted_invoice_url_visible") is True, "lifecycle hosted invoice URL must be visible")
    require(invoice.get("invoice_pdf_visible") is True, "lifecycle invoice PDF must be visible")
    require(invoice.get("internal_url_visible") is False, "lifecycle internal invoice URL must not be visible")
    require(invoice.get("public_invoice_links_safe") is True, "lifecycle public invoice links must be marked safe")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "lifecycle.gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_paid_billing_lifecycle", "lifecycle gate impact release gate mismatch")
    require(gate.get("can_clear_billing_lifecycle_subitem") is True, "lifecycle gate impact must clear lifecycle subitem")
    return release_sha


def validate_refund(data: dict[str, Any]) -> str:
    release_sha = validate_common_evidence(
        data,
        path="refund",
        schema_version="stage1.production_billing_refund_credit_webhook.v1",
        kind="production_billing_refund_credit_webhook",
    )
    for section in sorted(REFUND_SECTIONS):
        require_section_pass(data, section, "refund")
    refund = data["refund_or_credit"]
    require_livemode_true(refund, "refund.refund_or_credit")
    require(refund.get("refund_status") in {"succeeded", "paid", "posted", "credited"}, "refund.refund_or_credit refund_status mismatch")
    require(refund.get("admin_operation") in {"refund_note", "manual_credit"}, "refund.refund_or_credit admin_operation mismatch")
    require_provider_id(refund.get("charge_id"), "refund.refund_or_credit.charge_id", ("ch_",))
    if refund.get("admin_operation") == "refund_note":
        require_provider_id(refund.get("refund_id"), "refund.refund_or_credit.refund_id", ("re_",))
    quota_reset = data["quota_reset"]
    require(quota_reset.get("reset_invoked") is True, "refund.quota_reset.reset_invoked must be true")
    require_provider_id(quota_reset.get("invoice_id"), "refund.quota_reset.invoice_id", ("in_",))
    webhook = data["webhook_idempotency"]
    require_livemode_true(webhook, "refund.webhook_idempotency")
    require(webhook.get("replay_attempted") is True, "refund.webhook_idempotency replay_attempted must be true")
    require(isinstance(webhook.get("first_delivery_mutations"), int) and webhook["first_delivery_mutations"] >= 1, "refund webhook first delivery must mutate")
    require(webhook.get("replay_delivery_mutations") == 0, "refund webhook replay must not mutate")
    require(webhook.get("duplicate_mutation_count") == 0, "refund webhook duplicate mutation count must be zero")
    require(webhook.get("idempotency_verified") is True, "refund webhook idempotency must be verified")
    require_event_id_list(webhook.get("event_ids"), "refund.webhook_idempotency.event_ids")
    observed_types = set(webhook.get("event_types_observed") or [])
    require({"checkout.session.completed", "invoice.paid", "invoice.payment_failed"} <= observed_types, "refund webhook must observe checkout, invoice.paid, and invoice.payment_failed")
    failed_export = data["failed_export_refund"]
    require_livemode_true(failed_export, "refund.failed_export_refund")
    require(failed_export.get("refund_issued") is True, "refund.failed_export_refund.refund_issued must be true")
    require_provider_id(failed_export.get("refund_id"), "refund.failed_export_refund.refund_id", ("re_",))
    quota = data["quota_projection"]
    require(quota.get("projection_valid") is True, "refund.quota_projection.projection_valid must be true")
    require(quota.get("secret_fields_projected") in (False, 0), "refund.quota_projection.secret_fields_projected must be false")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "refund.gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_paid_billing_lifecycle", "refund gate impact release gate mismatch")
    require(gate.get("can_clear_refund_credit_webhook_subitem") is True, "refund gate impact must clear refund/webhook subitem")
    return release_sha


def validate_evidence(lifecycle_path: Path, refund_path: Path) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    lifecycle_sha = validate_lifecycle(load_json(lifecycle_path))
    refund_sha = validate_refund(load_json(refund_path))
    require(lifecycle_sha == refund_sha, "billing lifecycle and refund/webhook release_sha values must match")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing blocked production billing diagnostics")
    parser.add_argument("--lifecycle-evidence", default=str(DEFAULT_LIFECYCLE), help="production billing lifecycle evidence JSON path")
    parser.add_argument("--refund-evidence", default=str(DEFAULT_REFUND), help="production refund/credit/webhook evidence JSON path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            validate_blocked_diagnostics(Path(args.lifecycle_evidence), Path(args.refund_evidence))
        else:
            validate_evidence(Path(args.lifecycle_evidence), Path(args.refund_evidence))
    except Stage1ProductionBillingError as exc:
        print(f"stage1 production billing evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 production billing evidence contract passed")
    elif args.allow_preflight:
        print("stage1 production billing blocked/preflight evidence passed")
    else:
        print("stage1 production billing evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
