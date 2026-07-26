#!/usr/bin/env python3
"""Validate local Stage 1 Stripe lifecycle reconciliation contract."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "stripe_lifecycle" / "local_reconciliation.json"
RECONCILER = ROOT / "backend" / "internal" / "billing" / "stripe_lifecycle_reconcile.go"
BILLING_TEST = ROOT / "backend" / "internal" / "billing" / "billing_test.go"
WEBHOOK = ROOT / "backend" / "internal" / "billing" / "stripe_webhook.go"
CHECKOUT = ROOT / "backend" / "internal" / "billing" / "stripe_checkout.go"
STAGING_VALIDATOR = ROOT / "scripts" / "validate_stage1_stripe_staging_evidence.py"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)


class StripeLifecycleContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise StripeLifecycleContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_fixture() -> dict[str, Any]:
    try:
        data = json.loads(read_text(FIXTURE))
    except json.JSONDecodeError as exc:
        raise StripeLifecycleContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture(data: dict[str, Any]) -> None:
    require(data.get("fixture_id") == "stripe_lifecycle_local_reconciliation", "unexpected fixture_id")
    require(data.get("contract_version") == 1, "contract_version must be 1")
    require(data.get("release_gate_status") == "contract_ready_staging_stripe_lifecycle_evidence_open", "release gate status must keep staging evidence open")
    require(data.get("reconciler") == "StripeLifecycleReconciler", "reconciler drift")

    input_data = data.get("input")
    require(isinstance(input_data, dict), "input must be an object")
    for key in ("tenant_id", "user_id", "bucket_id", "provider_subscription_id"):
        require(isinstance(input_data.get(key), str) and input_data[key], f"input.{key} required")
    require(input_data.get("reset_due_quotas") is True, "quota reset must be covered")

    required_events = set(data.get("required_event_types") or [])
    require(
        {"checkout.session.completed", "invoice.paid", "invoice.payment_failed", "customer.subscription.deleted"} <= required_events,
        "required event type coverage drift",
    )
    require({"active", "past_due", "cancelled"} <= set(data.get("required_subscription_statuses") or []), "subscription status coverage drift")
    require({"refund_note", "manual_credit"} <= set(data.get("required_admin_operations") or []), "admin refund/credit coverage drift")
    require({"admin_credit", "commit"} <= set(data.get("required_quota_transactions") or []), "quota transaction coverage drift")

    report = data.get("report_contract")
    require(isinstance(report, dict), "report_contract is required")
    for key in (
        "checkout_seen",
        "invoice_paid_seen",
        "payment_failed_seen",
        "cancel_seen",
        "refund_credit_seen",
        "quota_credit_seen",
        "quota_projection_valid",
        "quota_reset_invoked",
        "webhook_replay_idempotent",
        "ready_for_staging_evidence",
    ):
        require(report.get(key) is True, f"report_contract.{key} must be true")
    require(report.get("secret_material_projected") is False, "report must not project secret material")

    policy = data.get("safe_projection_policy")
    require(isinstance(policy, dict), "safe_projection_policy is required")
    require(policy.get("reads_raw_webhook_payload") is False, "reconciler must not read raw webhook payload")
    require(policy.get("projects_secret_material") is False, "reconciler must not project secret material")
    for key in ("uses_event_summary_counts", "uses_admin_operation_summary_counts", "uses_quota_transaction_summary_counts"):
        require(policy.get(key) is True, f"safe_projection_policy.{key} must be true")

    remaining = data.get("remaining_staging_evidence")
    require(isinstance(remaining, list), "remaining_staging_evidence must be a list")
    for item in (
        "Stripe test checkout session created against staging API",
        "Stripe CLI webhook replay proves first delivery mutates and replay does not",
        "invoice and receipt URLs visible in the deployed user billing UI",
        "quota reset and refund/credit reconciliation verified against deployed Postgres",
    ):
        require(item in remaining, f"missing remaining staging evidence {item!r}")
    require("BL-9 staging Stripe checkout/webhook evidence remains open" in data.get("release_note", ""), "release note must preserve BL-9 caveat")


def validate_code_anchors() -> None:
    reconciler_text = require_text(
        RECONCILER,
        (
            "type StripeLifecycleReconciler struct",
            "ReconcileStripeLifecycle",
            "ResetDueQuotas",
            "NewQuotaRepository(r.db).ResetWeekly",
            "FROM stripe_webhook_events",
            "FROM billing_admin_operations",
            "FROM quota_transactions",
            "DuplicateMutationCount",
            "LivemodeTrueCount",
            "WebhookReplayIdempotent",
            "SecretMaterialProjected: false",
            "contract_ready_staging_stripe_lifecycle_evidence_open",
            "ReadyForStagingEvidence",
        ),
    )
    require("payload" not in reconciler_text.lower(), "reconciler must not query/project raw webhook payload")
    require("webhook_secret" not in reconciler_text.lower(), "reconciler must not reference webhook secret")
    require("secret_key" not in reconciler_text.lower(), "reconciler must not reference Stripe secret key")

    require_text(
        BILLING_TEST,
        (
            "TestStripeLifecycleReconcilerReportsPaidPastDueCancelRefundCreditAndQuotaReset",
            "checkout.session.completed",
            "invoice.paid",
            "invoice.payment_failed",
            "customer.subscription.deleted",
            "refund_note",
            "manual_credit",
            "admin_credit",
            "ReadyForStagingEvidence",
            "SecretMaterialProjected",
            "TestStripeLifecycleReconcilerRejectsMissingScopeAndInvalidWindow",
        ),
    )
    require_text(
        WEBHOOK,
        (
            "ClaimEvent",
            "ON CONFLICT (id) DO NOTHING",
            "invoice.payment_failed",
            "invoice.paid",
            "customer.subscription.deleted",
            "livemode=true while STRIPE_MODE=test",
        ),
    )
    require_text(
        CHECKOUT,
        (
            "CancelSubscription",
            "ListInvoices",
            "cancel_at_period_end",
            "hosted_invoice_url",
            "invoice_pdf",
        ),
    )
    require_text(
        STAGING_VALIDATOR,
        (
            "refund_credit",
            "webhook_replay_idempotency",
            "quota_projection",
            "invoice_receipt_visibility",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "BL-4",
            "BL-5",
            "Stripe lifecycle",
            "staging Stripe",
        ),
    )
    require_text(REPO_VALIDATE, ("validate_stage1_stripe_lifecycle_reconciliation.py",))


def main() -> int:
    try:
        validate_fixture(load_fixture())
        validate_code_anchors()
    except StripeLifecycleContractError as exc:
        print(f"stage1 Stripe lifecycle reconciliation contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 Stripe lifecycle reconciliation contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
