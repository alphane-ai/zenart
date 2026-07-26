#!/usr/bin/env python3
"""Generate a non-clearing production billing operator packet.

The packet makes the live Stripe production blocker actionable without
persisting keys, webhook bodies, signatures, customer PII, auth headers, or raw
Stripe payloads. It records the exact live artifact IDs and audit refs required
by ``stage1_stripe_live_billing_proof.py`` and the follow-up source/evidence
commands, while preserving the production launch no-go state.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-billing-operator-packet.json"
DEFAULT_LIVE_PROOF_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.blocked.json"
DEFAULT_LIVE_PROOF_CANDIDATE = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.candidate.json"
DEFAULT_SOURCE_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.billing.json"
DEFAULT_SOURCE = ROOT / "ops" / "evidence" / "production" / "billing-paid-lifecycle-source.json"
DEFAULT_LIFECYCLE_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "billing-lifecycle.json"
DEFAULT_REFUND_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "billing-refund-credit-webhook.json"

SAFE_FALSE_FIELDS = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
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
    "database_url",
    "postgres_url",
    "download_url",
    "signed_url",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
)

LIVE_ARTIFACT_FIELDS = [
    {"flag": "--checkout-session-id", "name": "checkout_session_id", "prefix": "cs_live_", "section": "paid_checkout"},
    {"flag": "--checkout-customer-id", "name": "checkout_customer_id", "prefix": "cus_", "section": "paid_checkout"},
    {"flag": "--price-id", "name": "price_id", "prefix": "price_", "section": "paid_checkout"},
    {"flag": "--active-subscription-id", "name": "active_subscription_id", "prefix": "sub_", "section": "subscription_active"},
    {"flag": "--active-customer-id", "name": "active_customer_id", "prefix": "cus_", "section": "subscription_active"},
    {"flag": "--past-due-subscription-id", "name": "past_due_subscription_id", "prefix": "sub_", "section": "subscription_past_due"},
    {"flag": "--past-due-invoice-id", "name": "past_due_invoice_id", "prefix": "in_", "section": "subscription_past_due"},
    {"flag": "--cancel-subscription-id", "name": "cancel_subscription_id", "prefix": "sub_", "section": "subscription_cancel"},
    {"flag": "--subscription-item-id", "name": "subscription_item_id", "prefix": "si_", "section": "team_seat_quantity_sync"},
    {"flag": "--visible-invoice-id", "name": "visible_invoice_id", "prefix": "in_", "section": "invoice_receipt_visibility"},
    {"flag": "--refund-charge-id", "name": "refund_charge_id", "prefix": "ch_", "section": "refund_or_credit"},
    {"flag": "--refund-id", "name": "refund_id", "prefix": "re_", "section": "refund_or_credit"},
    {"flag": "--quota-reset-invoice-id", "name": "quota_reset_invoice_id", "prefix": "in_", "section": "quota_reset"},
    {"flag": "--failed-export-refund-id", "name": "failed_export_refund_id", "prefix": "re_", "section": "failed_export_refund"},
]

NUMERIC_FIELDS = [
    {"flag": "--seat-quantity", "name": "seat_quantity", "rule": "positive integer"},
    {"flag": "--synced-quantity", "name": "synced_quantity", "rule": "positive integer matching seat_quantity"},
    {"flag": "--first-delivery-mutations", "name": "first_delivery_mutations", "rule": "positive integer"},
    {"flag": "--replay-delivery-mutations", "name": "replay_delivery_mutations", "rule": "0"},
    {"flag": "--duplicate-mutation-count", "name": "duplicate_mutation_count", "rule": "0"},
]

REF_FIELDS = [
    "--live-test-separation-ref",
    "--paid-checkout-ref",
    "--subscription-active-ref",
    "--subscription-past-due-ref",
    "--subscription-cancel-ref",
    "--team-seat-ref",
    "--invoice-visibility-ref",
    "--lifecycle-audit-ref",
    "--refund-credit-ref",
    "--quota-reset-ref",
    "--webhook-idempotency-ref",
    "--failed-export-refund-ref",
    "--quota-projection-ref",
    "--refund-webhook-audit-ref",
]

BILLING_ENV_VARIABLES = [
    "STRIPE_MODE",
    "STRIPE_SECRET_KEY",
    "STRIPE_API_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID",
    "STAGE1_PROD_BILLING_CHECKOUT_CUSTOMER_ID",
    "STAGE1_PROD_BILLING_PRICE_ID",
    "STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_ID",
    "STAGE1_PROD_BILLING_ACTIVE_CUSTOMER_ID",
    "STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_STATUS",
    "STAGE1_PROD_BILLING_PAST_DUE_SUBSCRIPTION_ID",
    "STAGE1_PROD_BILLING_PAST_DUE_INVOICE_ID",
    "STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_ID",
    "STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_STATUS",
    "STAGE1_PROD_BILLING_SEAT_QUANTITY",
    "STAGE1_PROD_BILLING_SYNCED_QUANTITY",
    "STAGE1_PROD_BILLING_SUBSCRIPTION_ITEM_ID",
    "STAGE1_PROD_BILLING_PRORATION_BEHAVIOR",
    "STAGE1_PROD_BILLING_SYNC_IDEMPOTENCY_KEY",
    "STAGE1_PROD_BILLING_VISIBLE_INVOICE_ID",
    "STAGE1_PROD_BILLING_REFUND_STATUS",
    "STAGE1_PROD_BILLING_ADMIN_OPERATION",
    "STAGE1_PROD_BILLING_REFUND_CHARGE_ID",
    "STAGE1_PROD_BILLING_REFUND_ID",
    "STAGE1_PROD_BILLING_QUOTA_RESET_INVOICE_ID",
    "STAGE1_PROD_BILLING_WEBHOOK_EVENT_IDS",
    "STAGE1_PROD_BILLING_FIRST_DELIVERY_MUTATIONS",
    "STAGE1_PROD_BILLING_REPLAY_DELIVERY_MUTATIONS",
    "STAGE1_PROD_BILLING_DUPLICATE_MUTATION_COUNT",
    "STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_ID",
    "STAGE1_PROD_BILLING_LIVE_TEST_SEPARATION_REF",
    "STAGE1_PROD_BILLING_PAID_CHECKOUT_REF",
    "STAGE1_PROD_BILLING_SUBSCRIPTION_ACTIVE_REF",
    "STAGE1_PROD_BILLING_SUBSCRIPTION_PAST_DUE_REF",
    "STAGE1_PROD_BILLING_SUBSCRIPTION_CANCEL_REF",
    "STAGE1_PROD_BILLING_TEAM_SEAT_REF",
    "STAGE1_PROD_BILLING_INVOICE_VISIBILITY_REF",
    "STAGE1_PROD_BILLING_LIFECYCLE_AUDIT_REF",
    "STAGE1_PROD_BILLING_REFUND_CREDIT_REF",
    "STAGE1_PROD_BILLING_QUOTA_RESET_REF",
    "STAGE1_PROD_BILLING_WEBHOOK_IDEMPOTENCY_REF",
    "STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_REF",
    "STAGE1_PROD_BILLING_QUOTA_PROJECTION_REF",
    "STAGE1_PROD_BILLING_REFUND_WEBHOOK_AUDIT_REF",
]


class BillingOperatorPacketError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            values[key] = value.strip().strip("'\"")
    return values


def env_value(values: dict[str, str], key: str) -> str:
    return os.environ.get(key, values.get(key, ""))


def classify_secret_shape(value: str, *, publishable: bool = False) -> str:
    if not value:
        return "missing"
    if publishable:
        if value.startswith("pk_live_"):
            return "live_publishable"
        if value.startswith("pk_test_"):
            return "test_publishable"
        return "set_nonstandard_publishable"
    if value.startswith("sk_live_"):
        return "live_secret"
    if value.startswith("rk_live_"):
        return "live_restricted"
    if value.startswith("sk_test_"):
        return "test_secret"
    if value.startswith("rk_test_"):
        return "test_restricted"
    if value.startswith("whsec_"):
        return "webhook_secret_set"
    return "set_nonstandard"


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise BillingOperatorPacketError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise BillingOperatorPacketError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise BillingOperatorPacketError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise BillingOperatorPacketError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "billing_operator_packet")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def first_blocker(data: dict[str, Any]) -> str:
    blockers = string_list(data.get("blocked_checks")) or string_list(data.get("blockers"))
    return blockers[0] if blockers else "not reported"


def diagnostic_summary(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": display_path(path),
        "exists": path.exists(),
        "status": data.get("status", "missing") if data else "missing",
        "first_blocker": first_blocker(data) if data else "diagnostic_not_written",
        "canonical_source_written": data.get("canonical_source_written") is True if data else False,
    }


def env_classification(env_path: Path) -> dict[str, Any]:
    env = read_env_file(env_path)
    stripe_mode = env_value(env, "STRIPE_MODE").strip().lower()
    secret = env_value(env, "STRIPE_SECRET_KEY") or env_value(env, "STRIPE_API_KEY")
    publishable = env_value(env, "STRIPE_PUBLISHABLE_KEY") or env_value(env, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")
    return {
        "env_file": display_path(env_path),
        "env_file_present": env_path.exists(),
        "stripe_mode": stripe_mode or "missing",
        "secret_key_class": classify_secret_shape(secret),
        "publishable_key_class": classify_secret_shape(publishable, publishable=True),
        "webhook_secret_class": classify_secret_shape(env_value(env, "STRIPE_WEBHOOK_SECRET")),
        "live_secret_configured": classify_secret_shape(secret) in {"live_secret", "live_restricted"},
    }


def sandbox_scope(env: dict[str, Any]) -> dict[str, Any]:
    stripe_mode = str(env.get("stripe_mode", "missing"))
    secret_class = str(env.get("secret_key_class", "missing"))
    publishable_class = str(env.get("publishable_key_class", "missing"))
    sandbox_detected = stripe_mode == "test" or secret_class in {"test_secret", "test_restricted"} or publishable_class == "test_publishable"
    return {
        "stripe_sandbox_or_test_config_detected": sandbox_detected,
        "stripe_mode": stripe_mode,
        "secret_key_class": secret_class,
        "publishable_key_class": publishable_class,
        "sandbox_can_clear_production_live_billing": False,
        "live_billing_requires": [
            "STRIPE_MODE=live",
            "STRIPE_SECRET_KEY or STRIPE_API_KEY with sk_live_ or rk_live_ shape",
            "sanitized live checkout/subscription/invoice/refund/webhook artifact IDs",
            "production audit/runtime refs for every billing lifecycle section",
        ],
        "operator_note": (
            "Stripe sandbox/test keys and sandbox checkout/webhook evidence are useful for local validation only; "
            "they cannot clear the production_paid_billing_lifecycle gate."
        ),
    }


def live_proof_command(output_path: Path) -> list[str]:
    command = [
        "python3 scripts/stage1_stripe_live_billing_proof.py",
        "--release-sha $(git rev-parse HEAD)",
        f"--output {display_path(output_path)}",
        "--checkout-session-id <cs_live_...>",
        "--checkout-customer-id <cus_...>",
        "--price-id <price_...>",
        "--active-subscription-id <sub_...>",
        "--active-customer-id <cus_...>",
        "--past-due-subscription-id <sub_...>",
        "--past-due-invoice-id <in_...>",
        "--cancel-subscription-id <sub_...>",
        "--seat-quantity <positive-int>",
        "--synced-quantity <same-positive-int>",
        "--subscription-item-id <si_...>",
        "--visible-invoice-id <in_...>",
        "--refund-charge-id <ch_...>",
        "--refund-id <re_...>",
        "--quota-reset-invoice-id <in_...>",
        "--webhook-event-ids <evt_...,evt_...>",
        "--failed-export-refund-id <re_...>",
    ]
    command.extend(f"{flag} <audit-or-runtime-ref>" for flag in REF_FIELDS)
    return command


def private_env_template() -> dict[str, Any]:
    return {
        "path_placeholder": "<private-production-env>",
        "gitignore_required": True,
        "blank_values_only": True,
        "allowed_variable_names": BILLING_ENV_VARIABLES,
        "template_lines": [f"{name}=" for name in BILLING_ENV_VARIABLES],
    }


def operator_command_packet(args: argparse.Namespace) -> list[dict[str, Any]]:
    return [
        {
            "step_id": "run_private_env_proof_bundle",
            "command": "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
            "side_effect": "non-clearing proof candidates and blocked diagnostics only",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_live_billing_candidate_or_diagnostic",
            "command": f"python3 scripts/validate_stage1_stripe_live_billing_proof.py --proof {display_path(args.live_proof_candidate)} --diagnostic {display_path(args.live_proof_diagnostic)}",
            "side_effect": "local validation only",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "run_billing_source_probe_after_candidate_passes",
            "command": (
                "python3 scripts/stage1_production_source_probe.py --billing "
                "--release-sha $(git rev-parse HEAD) "
                f"--billing-proof {display_path(args.live_proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.billing.json "
                "--write-canonical-source"
            ),
            "side_effect": "writes billing canonical source only after live billing proof passes",
            "may_write_canonical_source": True,
            "requires_review": True,
        },
        {
            "step_id": "generate_strict_billing_evidence",
            "command": "python3 scripts/generate_stage1_production_billing_evidence.py --source ops/evidence/production/billing-paid-lifecycle-source.json",
            "side_effect": "writes strict production billing evidence from canonical source",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_strict_billing_evidence",
            "command": "python3 scripts/validate_stage1_production_billing_evidence.py",
            "side_effect": "strict production billing validation",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "refresh_non_clearing_summary",
            "command": "python3 scripts/refresh_stage1_production_non_clearing_evidence.py || test $? -eq 2",
            "side_effect": "non-clearing summary refresh",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
    ]


def build_packet(args: argparse.Namespace) -> dict[str, Any]:
    live_diagnostic = load_json(args.live_proof_diagnostic)
    source_diagnostic = load_json(args.source_diagnostic)
    env = env_classification(args.env_file)
    sandbox = sandbox_scope(env)
    live_ready = env["stripe_mode"] == "live" and env["live_secret_configured"] is True

    data: dict[str, Any] = {
        "schema_version": "stage1.production_billing_operator_packet.v1",
        "environment": "production",
        "kind": "stage1_production_billing_operator_packet",
        "status": "blocked",
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "release_sha": current_release_sha(),
        "non_clearing_operator_packet": True,
        "canonical_pass_path": False,
        "can_clear_production_paid_billing_lifecycle": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "local_env_classification": env,
        "sandbox_scope": sandbox,
        "live_mode_prerequisites": {
            "stripe_mode_must_be_live": True,
            "secret_key_must_be_live": True,
            "publishable_key_must_be_live_when_set": True,
            "current_local_env_live_ready": live_ready,
            "stripe_sandbox_or_test_config_detected": sandbox["stripe_sandbox_or_test_config_detected"],
            "sandbox_can_clear_production_live_billing": False,
            "sandbox_or_test_artifacts_allowed": False,
            "comp_only_substitute_allowed": False,
        },
        "required_live_artifacts": LIVE_ARTIFACT_FIELDS,
        "required_numeric_controls": NUMERIC_FIELDS,
        "required_webhook_controls": {
            "webhook_event_ids": "comma-separated evt_ IDs, including checkout.session.completed, invoice.paid, invoice.payment_failed evidence refs",
            "first_delivery_mutations": "positive integer",
            "replay_delivery_mutations": 0,
            "duplicate_mutation_count": 0,
            "idempotency_verified": True,
        },
        "required_audit_refs": REF_FIELDS,
        "private_env_template": private_env_template(),
        "live_proof": {
            "candidate_path": display_path(args.live_proof_candidate),
            "blocked_diagnostic": diagnostic_summary(args.live_proof_diagnostic, live_diagnostic),
            "proof_generator_command": " ".join(live_proof_command(args.live_proof_candidate)),
            "proof_validator_command": (
                f"python3 scripts/validate_stage1_stripe_live_billing_proof.py "
                f"--proof {display_path(args.live_proof_candidate)}"
            ),
        },
        "source_probe": {
            "canonical_source_path": display_path(args.source),
            "canonical_source_exists": args.source.exists(),
            "source_diagnostic": diagnostic_summary(args.source_diagnostic, source_diagnostic),
            "source_probe_command": (
                "python3 scripts/stage1_production_source_probe.py --billing "
                "--release-sha $(git rev-parse HEAD) "
                f"--billing-proof {display_path(args.live_proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.billing.json "
                "--write-canonical-source"
            ),
        },
        "blocked_until": [
            "Stripe sandbox/test configuration is replaced with production live-mode billing proof inputs",
            "STRIPE_MODE is live in the production runtime, not test",
            "STRIPE_SECRET_KEY or STRIPE_API_KEY is a live Stripe key in the production runtime",
            "all required live Stripe artifact IDs are supplied to stage1_stripe_live_billing_proof.py",
            "webhook replay/idempotency evidence shows zero replay and duplicate mutations",
            "stage1_production_source_probe.py --billing writes ops/evidence/production/billing-paid-lifecycle-source.json",
            "generate_stage1_production_billing_evidence.py writes strict lifecycle and refund/webhook evidence",
            "validate_stage1_production_billing_evidence.py passes without --allow-preflight",
        ],
        "execution_order": [
            " ".join(live_proof_command(args.live_proof_candidate)),
            f"python3 scripts/validate_stage1_stripe_live_billing_proof.py --proof {display_path(args.live_proof_candidate)}",
            (
                "python3 scripts/stage1_production_source_probe.py --billing "
                "--release-sha $(git rev-parse HEAD) "
                f"--billing-proof {display_path(args.live_proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.billing.json "
                "--write-canonical-source"
            ),
            "python3 scripts/generate_stage1_production_billing_evidence.py --source ops/evidence/production/billing-paid-lifecycle-source.json",
            "python3 scripts/validate_stage1_production_billing_evidence.py",
            "python3 scripts/generate_stage1_production_launch_evidence.py",
            "python3 scripts/validate_stage1_production_launch.py",
        ],
        "operator_command_packet": operator_command_packet(args),
        "evidence_outputs": {
            "live_proof_candidate": display_path(args.live_proof_candidate),
            "live_proof_diagnostic": display_path(args.live_proof_diagnostic),
            "source": display_path(args.source),
            "source_diagnostic": display_path(args.source_diagnostic),
            "lifecycle": display_path(args.lifecycle_evidence),
            "refund_credit_webhook": display_path(args.refund_evidence),
        },
        "gate_impact": {
            "preserved_release_gate_check_id": "production_paid_billing_lifecycle",
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "can_clear_billing_lifecycle_subitem": False,
            "can_clear_refund_credit_webhook_subitem": False,
            "can_clear_aggregate_production_gate": False,
            "can_clear_stage1_production_launch_gate": False,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--live-proof-diagnostic", type=Path, default=DEFAULT_LIVE_PROOF_DIAGNOSTIC)
    parser.add_argument("--live-proof-candidate", type=Path, default=DEFAULT_LIVE_PROOF_CANDIDATE)
    parser.add_argument("--source-diagnostic", type=Path, default=DEFAULT_SOURCE_DIAGNOSTIC)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--lifecycle-evidence", type=Path, default=DEFAULT_LIFECYCLE_EVIDENCE)
    parser.add_argument("--refund-evidence", type=Path, default=DEFAULT_REFUND_EVIDENCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if len(LIVE_ARTIFACT_FIELDS) != 14 or len(NUMERIC_FIELDS) != 5:
            raise SystemExit("production billing operator packet artifact contract mismatch")
        if "--webhook-idempotency-ref" not in REF_FIELDS:
            raise SystemExit("production billing operator packet ref contract incomplete")
        print("stage1 production billing operator packet generator contract passed")
        return 0
    packet = build_packet(args)
    write_json(args.output, packet)
    print(f"wrote Stage 1 production billing operator packet to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
