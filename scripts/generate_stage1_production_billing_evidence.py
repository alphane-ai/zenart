#!/usr/bin/env python3
"""Generate Stage 1 production paid billing split evidence.

The generator is deliberately conservative. It writes canonical pass evidence
only from a production source probe that proves Stripe live-mode paid checkout,
subscription lifecycle, refund/credit, quota reset, webhook idempotency, team
seat sync, and invoice visibility. Without that source it writes blocked
diagnostics and exits 2, so deferred/comp-only evidence cannot accidentally
clear the production paid billing gate.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LIFECYCLE = ROOT / "ops" / "evidence" / "production" / "billing-lifecycle.json"
DEFAULT_REFUND = ROOT / "ops" / "evidence" / "production" / "billing-refund-credit-webhook.json"
DEFAULT_SOURCE = ROOT / "ops" / "evidence" / "production" / "billing-paid-lifecycle-source.json"
STRICT_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_billing_evidence.py"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
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
LIFECYCLE_SECTIONS = (
    "stripe_live_test_separation",
    "paid_checkout",
    "subscription_active",
    "subscription_past_due",
    "subscription_cancel",
    "team_seat_quantity_sync",
    "invoice_receipt_visibility",
    "audit_refs",
)
REFUND_SECTIONS = (
    "refund_or_credit",
    "quota_reset",
    "webhook_idempotency",
    "failed_export_refund",
    "quota_projection",
    "audit_refs",
)


class ProductionBillingGenerationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionBillingGenerationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProductionBillingGenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


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


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def section_from_source(source: dict[str, Any], key: str, parent: str) -> dict[str, Any]:
    value = source.get(key)
    require(isinstance(value, dict), f"{parent}.{key} must be an object")
    return dict(value)


def source_blockers(source_path: Path, data: dict[str, Any], release_sha: str) -> list[str]:
    blockers: list[str] = []
    try:
        assert_no_secret(data, "source")
    except ProductionBillingGenerationError as exc:
        blockers.append(str(exc))
    blockers.extend(blocked_gate_signal_blockers(data, "source"))
    markers = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    if markers:
        blockers.append(f"{display_path(source_path)} contains blocked/deferred marker(s): {markers}")
    if data.get("schema_version") != "stage1.production_billing_source.v1":
        blockers.append(f"{display_path(source_path)} schema_version is not stage1.production_billing_source.v1")
    if data.get("environment") != "production":
        blockers.append(f"{display_path(source_path)} environment is not production")
    if not is_pass_status(data.get("status")):
        blockers.append(f"{display_path(source_path)} status is not pass/passed")
    if data.get("stripe_mode") != "live":
        blockers.append(f"{display_path(source_path)} stripe_mode is not live")
    if data.get("livemode") is not True:
        blockers.append(f"{display_path(source_path)} livemode is not true")
    if data.get("release_sha") and str(data.get("release_sha")).strip().lower() != release_sha:
        blockers.append(f"{display_path(source_path)} release_sha does not match requested release")
    lifecycle = data.get("lifecycle")
    refund = data.get("refund_credit_webhook")
    if not isinstance(lifecycle, dict):
        blockers.append(f"{display_path(source_path)} lifecycle object is missing")
    else:
        for section in LIFECYCLE_SECTIONS:
            if not isinstance(lifecycle.get(section), dict):
                blockers.append(f"{display_path(source_path)} lifecycle.{section} object is missing")
    if not isinstance(refund, dict):
        blockers.append(f"{display_path(source_path)} refund_credit_webhook object is missing")
    else:
        for section in REFUND_SECTIONS:
            if not isinstance(refund.get(section), dict):
                blockers.append(f"{display_path(source_path)} refund_credit_webhook.{section} object is missing")
    return blockers


def common_base(schema_version: str, kind: str, release_sha: str, generated_at: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": schema_version,
        "environment": "production",
        "kind": kind,
        "status": "pass",
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "release_sha": release_sha,
        "canonical_pass_path": True,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "invite_comp_only_substitute": False,
        "generated_at": generated_at,
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def build_pass(data: dict[str, Any], release_sha: str, source_path: Path, generated_at: str) -> tuple[dict[str, Any], dict[str, Any]]:
    lifecycle_source = data["lifecycle"]
    refund_source = data["refund_credit_webhook"]
    lifecycle = common_base("stage1.production_billing_lifecycle.v1", "production_paid_billing_lifecycle", release_sha, generated_at)
    for section in LIFECYCLE_SECTIONS:
        lifecycle[section] = section_from_source(lifecycle_source, section, "lifecycle")
    lifecycle["source_probe"] = display_path(source_path)
    lifecycle["gate_impact"] = {
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "can_clear_billing_lifecycle_subitem": True,
    }

    refund = common_base(
        "stage1.production_billing_refund_credit_webhook.v1",
        "production_billing_refund_credit_webhook",
        release_sha,
        generated_at,
    )
    for section in REFUND_SECTIONS:
        refund[section] = section_from_source(refund_source, section, "refund_credit_webhook")
    refund["source_probe"] = display_path(source_path)
    refund["gate_impact"] = {
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "can_clear_refund_credit_webhook_subitem": True,
    }
    return lifecycle, refund


def blocked_report(blockers: list[str], release_sha: str, generated_at: str, kind: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": f"stage1.{kind}.blocked.v1",
        "environment": "production",
        "kind": kind,
        "status": "blocked",
        "release_gate_check_id": "production_paid_billing_lifecycle",
        "release_sha": release_sha or None,
        "canonical_pass_path": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "invite_comp_only_substitute": False,
        "generated_at": generated_at,
        "blocked_checks": blockers,
        "gate_impact": {
            "can_clear_billing_lifecycle_subitem": False,
            "can_clear_refund_credit_webhook_subitem": False,
            "preserved_release_gate_check_id": "production_paid_billing_lifecycle",
            "remaining_blockers": blockers,
        },
    }
    if kind == "production_billing_lifecycle":
        data["required_runtime_semantics"] = [
            "checkout",
            "subscription",
            "cancellation",
            "past_due",
            "team seat quantity sync",
            "invoice receipt visibility",
        ]
        data["blocked_runtime_summary"] = (
            "Production billing lifecycle remains blocked until live Stripe proof covers checkout, "
            "subscription active state, cancellation, past_due invoice handling, team seat quantity sync, "
            "and invoice receipt visibility."
        )
    if kind == "production_billing_refund_credit_webhook":
        data["required_runtime_semantics"] = [
            "refund",
            "credit",
            "quota reset",
            "webhook",
            "idempotency",
            "failed export refund",
        ]
        data["blocked_runtime_summary"] = (
            "Production refund/credit/webhook evidence remains blocked until live Stripe proof covers refund, "
            "credit, quota reset, webhook idempotency, failed export refund, quota projection, and audit refs."
        )
    data.update(SAFE_FALSE_FIELDS)
    return data


def run_strict_validator(lifecycle_path: Path, refund_path: Path) -> tuple[bool, str]:
    result = subprocess.run(
        [
            sys.executable,
            str(STRICT_VALIDATOR),
            "--lifecycle-evidence",
            str(lifecycle_path),
            "--refund-evidence",
            str(refund_path),
        ],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    output = (result.stderr or result.stdout).strip()
    return result.returncode == 0, output


def build(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    source_path = args.source
    release_sha = args.release_sha.strip().lower()
    blockers: list[str] = []
    if source_path.exists():
        source = load_json(source_path)
        if not release_sha:
            release_sha = str(source.get("release_sha", "")).strip().lower()
    else:
        source = {}
        blockers.append(f"source_probe_missing: {display_path(source_path)}")
    if RELEASE_SHA_RE.fullmatch(release_sha) is None:
        blockers.append("release_sha_missing_or_not_full_sha")
    if source:
        blockers.extend(source_blockers(source_path, source, release_sha))

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if blockers:
        return (
            blocked_report(blockers, release_sha, generated_at, "production_billing_lifecycle"),
            blocked_report(blockers, release_sha, generated_at, "production_billing_refund_credit_webhook"),
            blockers,
        )
    lifecycle, refund = build_pass(source, release_sha, source_path, generated_at)
    return lifecycle, refund, []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-sha", default="", help="full production release SHA; defaults to source.release_sha")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="safe production billing source probe JSON")
    parser.add_argument("--lifecycle-evidence", type=Path, default=DEFAULT_LIFECYCLE)
    parser.add_argument("--refund-evidence", type=Path, default=DEFAULT_REFUND)
    args = parser.parse_args()

    try:
        lifecycle, refund, blockers = build(args)
        assert_no_secret(lifecycle, "lifecycle")
        assert_no_secret(refund, "refund")
        write_json(args.lifecycle_evidence, lifecycle)
        write_json(args.refund_evidence, refund)
        if not blockers:
            passed, output = run_strict_validator(args.lifecycle_evidence, args.refund_evidence)
            if not passed:
                generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                blockers = [f"strict_validator_failed: {output}"]
                write_json(
                    args.lifecycle_evidence,
                    blocked_report(blockers, lifecycle.get("release_sha", ""), generated_at, "production_billing_lifecycle"),
                )
                write_json(
                    args.refund_evidence,
                    blocked_report(blockers, refund.get("release_sha", ""), generated_at, "production_billing_refund_credit_webhook"),
                )
    except ProductionBillingGenerationError as exc:
        print(f"stage1 production billing evidence generation failed: {exc}", file=sys.stderr)
        return 1

    if blockers:
        print(f"stage1 production billing split evidence generated: blocked ({args.lifecycle_evidence}, {args.refund_evidence})")
        return 2
    print(f"stage1 production billing split evidence generated: pass ({args.lifecycle_evidence}, {args.refund_evidence})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
