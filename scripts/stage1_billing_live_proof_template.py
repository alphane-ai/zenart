#!/usr/bin/env python3
"""Generate a sanitized Stage 1 live billing proof template.

The template is intentionally non-clearing. It documents every live Stripe
artifact and billing runtime semantic required before
``billing-paid-lifecycle-source.json`` can be assembled.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "templates" / "billing-live-proof.template.json"
SYNTHETIC_RELEASE_SHA = "0123456789abcdef0123456789abcdef01234567"
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


def section(*tokens: str, **extra: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "status": "template_only",
        "evidence_refs": ["replace_me:production/live-billing/evidence-ref"],
        "required_tokens": list(tokens),
    }
    data.update(extra)
    return data


def build_template(release_sha: str) -> dict[str, Any]:
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    data: dict[str, Any] = {
        "schema_version": "stage1.production_live_billing_proof.template.v1",
        "environment": "production",
        "kind": "production_live_billing_proof_template",
        "status": "template_only",
        "template_only": True,
        "release_sha": release_sha,
        "generated_at": generated_at,
        "stripe_mode": "live",
        "livemode": True,
        "operator_note": (
            "Replace every replace_me value with sanitized production Stripe live "
            "artifact IDs and runtime evidence refs. Do not include raw Stripe "
            "payloads, secrets, webhook signatures, cookies, authorization headers, "
            "or signed URLs. After replacing values and setting every section status "
            "to pass, use scripts/stage1_production_source_probe.py --billing."
        ),
        "lifecycle": {
            "stripe_live_test_separation": section(
                "live",
                "test isolated",
                stripe_mode="live",
                live_mode_enabled="replace_me:true",
                test_mode_isolated="replace_me:true",
                live_artifacts_verified="replace_me:true",
                test_artifact_refs=[],
            ),
            "paid_checkout": section(
                "checkout",
                "livemode",
                livemode="replace_me:true",
                checkout_session_id="replace_me:cs_live_...",
                customer_id="replace_me:cus_...",
                price_id="replace_me:price_...",
            ),
            "subscription_active": section(
                "active",
                livemode="replace_me:true",
                subscription_status="replace_me:active",
                subscription_id="replace_me:sub_...",
                customer_id="replace_me:cus_...",
            ),
            "subscription_past_due": section(
                "past_due",
                livemode="replace_me:true",
                subscription_status="replace_me:past_due",
                subscription_id="replace_me:sub_...",
                invoice_id="replace_me:in_...",
            ),
            "subscription_cancel": section(
                "cancel",
                livemode="replace_me:true",
                subscription_id="replace_me:sub_...",
                cancel_at_period_end="replace_me:true",
            ),
            "team_seat_quantity_sync": section(
                "team seat",
                "subscription item",
                seat_quantity="replace_me:positive-integer",
                synced_quantity="replace_me:same-positive-integer",
                provider_subscription_item_id="replace_me:si_...",
                proration_behavior="replace_me:create_prorations|none|always_invoice",
                sync_idempotency_key="replace_me:non-secret-idempotency-key",
                idempotency_verified="replace_me:true",
            ),
            "invoice_receipt_visibility": section(
                "invoice",
                "receipt",
                livemode="replace_me:true",
                invoice_id="replace_me:in_...",
                invoice_visible="replace_me:true",
                receipt_visible="replace_me:true",
                secret_visible="replace_me:false",
                hosted_invoice_url_visible="replace_me:true",
                invoice_pdf_visible="replace_me:true",
                internal_url_visible="replace_me:false",
                public_invoice_links_safe="replace_me:true",
            ),
            "audit_refs": section("audit", refs=["replace_me:audit://production/live-billing/lifecycle"]),
        },
        "refund_credit_webhook": {
            "refund_or_credit": section(
                "refund",
                "credit",
                livemode="replace_me:true",
                refund_status="replace_me:succeeded|paid|posted|credited",
                admin_operation="replace_me:refund_note|manual_credit",
                charge_id="replace_me:ch_...",
                refund_id="replace_me:re_... when admin_operation=refund_note",
            ),
            "quota_reset": section(
                "quota reset",
                reset_invoked="replace_me:true",
                invoice_id="replace_me:in_...",
            ),
            "webhook_idempotency": section(
                "webhook",
                "idempotency",
                livemode="replace_me:true",
                replay_attempted="replace_me:true",
                first_delivery_mutations="replace_me:integer>=1",
                replay_delivery_mutations="replace_me:0",
                duplicate_mutation_count="replace_me:0",
                idempotency_verified="replace_me:true",
                event_ids=["replace_me:evt_..."],
                event_types_observed=[
                    "checkout.session.completed",
                    "invoice.paid",
                    "invoice.payment_failed",
                ],
            ),
            "failed_export_refund": section(
                "failed export",
                "refund",
                livemode="replace_me:true",
                refund_issued="replace_me:true",
                refund_id="replace_me:re_...",
            ),
            "quota_projection": section(
                "quota",
                "projection",
                projection_valid="replace_me:true",
                secret_fields_projected="replace_me:false",
            ),
            "audit_refs": section("audit", refs=["replace_me:audit://production/live-billing/refund-webhook"]),
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def assert_template_safe(data: dict[str, Any]) -> None:
    if data.get("status") in {"pass", "passed"}:
        raise SystemExit("billing live proof template must not use pass status")
    if data.get("template_only") is not True:
        raise SystemExit("billing live proof template must carry template_only=true")
    text = json.dumps(data, sort_keys=True)
    if "replace_me:" not in text:
        raise SystemExit("billing live proof template must include replace_me placeholders")
    for key, expected in SAFE_FALSE_FIELDS.items():
        if data.get(key) is not expected:
            raise SystemExit(f"billing live proof template {key} must be {expected}")


def self_test(template_path: Path, release_sha: str) -> None:
    out_dir = template_path.parent / ".self-test-output"
    out_dir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            sys.executable,
            "scripts/stage1_production_source_probe.py",
            "--billing",
            "--release-sha",
            release_sha,
            "--billing-proof",
            str(template_path),
            "--billing-source",
            str(out_dir / "billing-source.json"),
            "--diagnostic",
            str(out_dir / "billing-diagnostic.json"),
            "--write-canonical-source",
        ],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 2:
        detail = (result.stderr or result.stdout).strip()
        raise SystemExit(f"billing live proof template unexpectedly cleared or errored ({result.returncode}): {detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--release-sha", default=SYNTHETIC_RELEASE_SHA)
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    data = build_template(args.release_sha)
    assert_template_safe(data)
    if args.contract_only:
        print("stage1 billing live proof template contract passed")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.self_test:
        self_test(args.output, args.release_sha)
    print(f"wrote Stage 1 billing live proof template to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
