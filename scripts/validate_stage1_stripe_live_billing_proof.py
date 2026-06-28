#!/usr/bin/env python3
"""Validate the Stage 1 Stripe live billing proof helper contract."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "stage1_stripe_live_billing_proof.py"
SOURCE_PROBE = ROOT / "scripts" / "stage1_production_source_probe.py"
DEFAULT_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.candidate.json"
DEFAULT_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.blocked.json"
SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
)
REQUIRED_LIFECYCLE = {
    "stripe_live_test_separation",
    "paid_checkout",
    "subscription_active",
    "subscription_past_due",
    "subscription_cancel",
    "team_seat_quantity_sync",
    "invoice_receipt_visibility",
    "audit_refs",
}
REQUIRED_REFUND = {
    "refund_or_credit",
    "quota_reset",
    "webhook_idempotency",
    "failed_export_refund",
    "quota_projection",
    "audit_refs",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|"
    r"t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)


class StripeLiveBillingProofValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise StripeLiveBillingProofValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise StripeLiveBillingProofValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise StripeLiveBillingProofValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in {"secret", "secret_key", "api_key", "authorization", "cookie", "raw_payload"}, f"{path}.{key} exposes secret/raw field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def validate_proof(data: dict[str, Any]) -> None:
    assert_no_secret(data, "proof")
    require(data.get("schema_version") == "stage1.production_live_billing_proof.v1", "proof schema_version mismatch")
    require(data.get("environment") == "production", "proof environment mismatch")
    require(data.get("kind") == "production_live_billing_proof", "proof kind mismatch")
    require(data.get("status") == "pass", "proof status must pass")
    require(data.get("stripe_mode") == "live", "proof stripe_mode must be live")
    require(data.get("livemode") is True, "proof livemode must be true")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"proof {field} must be false")
    lifecycle = data.get("lifecycle")
    refund = data.get("refund_credit_webhook")
    require(isinstance(lifecycle, dict), "proof.lifecycle must be object")
    require(isinstance(refund, dict), "proof.refund_credit_webhook must be object")
    require(REQUIRED_LIFECYCLE <= set(lifecycle), "proof lifecycle missing sections")
    require(REQUIRED_REFUND <= set(refund), "proof refund/webhook missing sections")
    for section_name, section in {**lifecycle, **refund}.items():
        require(isinstance(section, dict), f"{section_name} must be object")
        require(section.get("status") == "pass", f"{section_name}.status must pass")
        refs = section.get("refs") if section_name == "audit_refs" else section.get("evidence_refs")
        require(isinstance(refs, list) and refs, f"{section_name} refs/evidence_refs must be non-empty")


def validate_blocked(data: dict[str, Any]) -> None:
    assert_no_secret(data, "diagnostic")
    require(data.get("schema_version") == "stage1.production_live_billing_proof.blocked.v1", "diagnostic schema_version mismatch")
    require(data.get("environment") == "production", "diagnostic environment mismatch")
    require(data.get("kind") == "production_live_billing_proof", "diagnostic kind mismatch")
    require(data.get("status") == "blocked", "diagnostic status must be blocked")
    blockers = data.get("blocked_checks")
    require(isinstance(blockers, list) and blockers, "diagnostic blocked_checks must be non-empty")
    require(data.get("canonical_source_written") is False, "diagnostic must not write canonical source")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"diagnostic {field} must be false")


def validate_contract() -> None:
    require(SCRIPT.exists() and SCRIPT.stat().st_mode & 0o111, "stage1_stripe_live_billing_proof.py must be executable")
    text = SCRIPT.read_text(encoding="utf-8")
    for token in (
        "STRIPE_MODE_must_be_live",
        "STRIPE_SECRET_KEY_or_STRIPE_API_KEY_must_be_live",
        "STRIPE_PUBLISHABLE_KEY_or_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_missing",
        "stage1.production_live_billing_proof.v1",
        "stage1.production_live_billing_proof.blocked.v1",
        "collect_blockers",
        "collect_live_id_blockers",
        "collect_event_id_blockers",
        "checkout_session_id",
        "team_seat_quantity_sync",
        "webhook_idempotency",
        "failed_export_refund",
        "operator_next_command_after_pass",
        "stage1_production_source_probe.py --billing",
    ):
        require(token in text, f"helper missing {token}")
    source_probe = SOURCE_PROBE.read_text(encoding="utf-8")
    require("--billing-proof" in source_probe and "build_billing_source" in source_probe, "source probe must accept billing proof")


def run_blocked_selftest() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        env_file = tmpdir / ".env"
        env_file.write_text("STRIPE_MODE=test\nSTRIPE_SECRET_KEY=sk_test_placeholder\n", encoding="utf-8")
        diagnostic = tmpdir / "blocked.json"
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--env-file",
                str(env_file),
                "--diagnostic",
                str(diagnostic),
                "--release-sha",
                "0123456789abcdef0123456789abcdef01234567",
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(result.returncode == 2, f"blocked selftest must exit 2, got {result.returncode}: {result.stderr or result.stdout}")
        data = load_json(diagnostic)
        validate_blocked(data)
        blockers = data.get("blocked_checks")
        require(isinstance(blockers, list), "blocked selftest blocked_checks must be list")
        for expected in (
            "STRIPE_MODE_must_be_live",
            "STRIPE_SECRET_KEY_or_STRIPE_API_KEY_must_be_live",
            "STRIPE_PUBLISHABLE_KEY_or_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_missing",
            "checkout_session_id_missing",
            "active_subscription_id_missing",
            "webhook_event_ids_missing",
            "failed_export_refund_id_missing",
        ):
            require(expected in blockers, f"blocked selftest missing aggregate blocker {expected}")
        require(len(blockers) >= 20, "blocked selftest must aggregate all missing live billing proof inputs")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--proof", type=Path, default=DEFAULT_PROOF)
    parser.add_argument("--diagnostic", type=Path, default=DEFAULT_DIAGNOSTIC)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract()
        run_blocked_selftest()
        if args.contract_only:
            print("stage1 Stripe live billing proof helper contract passed")
            return 0
        if args.proof.exists():
            validate_proof(load_json(args.proof))
        elif args.diagnostic.exists():
            validate_blocked(load_json(args.diagnostic))
        else:
            raise StripeLiveBillingProofValidationError("missing proof or blocked diagnostic")
    except StripeLiveBillingProofValidationError as exc:
        raise SystemExit(f"stage1 Stripe live billing proof helper validation failed: {exc}") from exc
    print("stage1 Stripe live billing proof helper validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
