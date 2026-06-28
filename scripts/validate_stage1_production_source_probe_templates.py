#!/usr/bin/env python3
"""Validate non-clearing Stage 1 production source-probe templates."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE_DIR = ROOT / "ops" / "evidence" / "production" / "source-probe-templates"
GENERATOR = ROOT / "scripts" / "generate_stage1_production_source_probe_templates.py"
SOURCE_PROBE = ROOT / "scripts" / "stage1_production_source_probe.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
SYNTHETIC_RELEASE_SHA = "0123456789abcdef0123456789abcdef01234567"

EXPECTED_TEMPLATES = {
    "billing-paid-lifecycle-source.template.json": {
        "schema_version": "stage1.production_billing_source.v1",
        "kind": "production_billing_source",
        "required_top": {"lifecycle", "refund_credit_webhook"},
        "required_release_gate_check_id": "production_paid_billing_lifecycle",
    },
    "production-security-launch-source.template.json": {
        "schema_version": "stage1.production_security_launch_source.v1",
        "kind": "production_security_launch_source",
        "required_top": {
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
        },
        "required_release_gate_check_id": "production_security_launch_checks",
    },
    "production-security-proof.template.json": {
        "schema_version": "stage1.production_security_proof.template.v1",
        "kind": "production_security_launch_proof_template",
        "required_top": {
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
        },
    },
    "production-legal-support-source.template.json": {
        "schema_version": "stage1.production_legal_support_source.v1",
        "kind": "production_legal_support_source",
        "required_top": {"legal", "support_billing"},
        "required_release_gate_check_id": "production_legal_support_policy",
    },
    "production-governance-release-source.template.json": {
        "schema_version": "stage1.production_governance_release_source.v1",
        "kind": "production_governance_release_source",
        "required_top": {"activation", "abuse", "skill"},
    },
    "production-governance-proof.template.json": {
        "schema_version": "stage1.production_governance_proof.template.v1",
        "kind": "production_governance_release_proof_template",
        "required_top": {"activation", "abuse", "skill"},
    },
}

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

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class ProductionSourceProbeTemplateValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionSourceProbeTemplateValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ProductionSourceProbeTemplateValidationError(f"missing {display_path(path)}") from exc


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ProductionSourceProbeTemplateValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


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


def walk(value: Any) -> list[Any]:
    rows = [value]
    if isinstance(value, dict):
        for child in value.values():
            rows.extend(walk(child))
    elif isinstance(value, list):
        for child in value:
            rows.extend(walk(child))
    return rows


def collect_statuses(value: Any) -> list[str]:
    statuses: list[str] = []
    if isinstance(value, dict):
        status = value.get("status")
        if isinstance(status, str):
            statuses.append(status)
        for child in value.values():
            statuses.extend(collect_statuses(child))
    elif isinstance(value, list):
        for child in value:
            statuses.extend(collect_statuses(child))
    return statuses


def require_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty string")
    return value.strip()


def require_object(value: Any, path: str) -> dict[str, Any]:
    require(isinstance(value, dict), f"{path} must be object")
    return value


def require_list(value: Any, path: str) -> list[Any]:
    require(isinstance(value, list), f"{path} must be list")
    return value


def validate_code_anchors() -> None:
    generator = read_text(GENERATOR)
    for snippet in (
        "stage1 production source probe template contract passed",
        "template_only",
        "replace_me:",
        "self_test",
        "stage1_production_source_probe.py",
        "template source unexpectedly cleared",
        "template proof unexpectedly cleared",
    ):
        require(snippet in generator, f"{display_path(GENERATOR)} missing {snippet!r}")
    source_probe = read_text(SOURCE_PROBE)
    for snippet in (
        "--legal-support",
        "--billing-proof",
        "--security-proof",
        "--governance-proof",
        "canonical_source_written",
    ):
        require(snippet in source_probe, f"{display_path(SOURCE_PROBE)} missing {snippet!r}")
    repo_validate = read_text(REPO_VALIDATE)
    for snippet in (
        "generate_stage1_production_source_probe_templates.py --contract-only",
        "generate_stage1_production_source_probe_templates.py",
        "--self-test",
    ):
        require(snippet in repo_validate, f"{display_path(REPO_VALIDATE)} missing {snippet!r}")


def validate_common(path: Path, data: dict[str, Any], expected: dict[str, Any]) -> None:
    assert_no_secret(data, display_path(path))
    require(data.get("schema_version") == expected["schema_version"], f"{path.name} schema_version mismatch")
    require(data.get("kind") == expected["kind"], f"{path.name} kind mismatch")
    require(data.get("environment") == "production", f"{path.name} environment mismatch")
    require(data.get("status") == "template_only", f"{path.name} status must remain template_only")
    require(data.get("template_only") is True, f"{path.name} template_only must be true")
    require(data.get("local_devport_debug") is False, f"{path.name} local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, f"{path.name} allow_local_devport_evidence must be false")
    require(data.get("dry_run") is False, f"{path.name} dry_run must be false")
    require(RELEASE_SHA_RE.fullmatch(require_string(data.get("release_sha"), f"{path.name}.release_sha")) is not None, f"{path.name} release_sha mismatch")
    require_string(data.get("generated_at"), f"{path.name}.generated_at")
    require("replace_me:" in json.dumps(data, sort_keys=True), f"{path.name} must include replace_me placeholders")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{path.name} {field} must be false")
    for forbidden in (
        "canonical_source_written",
        "can_clear_stage1_production_launch_gate",
        "can_close_do_not_launch",
    ):
        require(data.get(forbidden) in {None, False}, f"{path.name} must not set {forbidden}=true")
    statuses = collect_statuses(data)
    require(statuses, f"{path.name} must include status fields")
    require(all(status == "template_only" for status in statuses), f"{path.name} must not include pass/blocked runtime statuses")
    require(set(expected["required_top"]) <= set(data), f"{path.name} missing required top-level sections")
    if expected.get("required_release_gate_check_id"):
        require(
            data.get("release_gate_check_id") == expected["required_release_gate_check_id"],
            f"{path.name} release_gate_check_id mismatch",
        )


def validate_billing(data: dict[str, Any]) -> None:
    require(data.get("stripe_mode") == "live", "billing template stripe_mode must be live")
    require(data.get("livemode") is True, "billing template livemode must be true")
    lifecycle = require_object(data.get("lifecycle"), "billing.lifecycle")
    refund = require_object(data.get("refund_credit_webhook"), "billing.refund_credit_webhook")
    for section in (
        "stripe_live_test_separation",
        "paid_checkout",
        "subscription_active",
        "subscription_past_due",
        "subscription_cancel",
        "team_seat_quantity_sync",
        "invoice_receipt_visibility",
        "audit_refs",
    ):
        require(section in lifecycle, f"billing.lifecycle missing {section}")
    for section in (
        "refund_or_credit",
        "quota_reset",
        "webhook_idempotency",
        "failed_export_refund",
        "quota_projection",
        "audit_refs",
    ):
        require(section in refund, f"billing.refund_credit_webhook missing {section}")


def validate_legal_support(data: dict[str, Any]) -> None:
    legal = require_object(data.get("legal"), "legal")
    support = require_object(data.get("support_billing"), "support_billing")
    legal_pages = require_list(legal.get("page_probes"), "legal.page_probes")
    support_pages = require_list(support.get("page_probes"), "support_billing.page_probes")
    require(len(legal_pages) == 5, "legal.page_probes length mismatch")
    require(len(support_pages) == 4, "support_billing.page_probes length mismatch")
    legal_paths = {require_string(page.get("path") if isinstance(page, dict) else None, "legal page path") for page in legal_pages}
    support_paths = {require_string(page.get("path") if isinstance(page, dict) else None, "support page path") for page in support_pages}
    require({"/legal/terms", "/legal/privacy", "/legal/acceptable-use", "/legal/ip-complaints", "/support"} <= legal_paths, "legal paths mismatch")
    require({"/support", "/report-problem", "/legal/billing-policy"} <= support_paths, "support paths mismatch")
    alignment = require_object(support.get("paid_launch_policy_alignment"), "support_billing.paid_launch_policy_alignment")
    require(alignment.get("status") == "template_only", "paid launch policy alignment must remain template_only")


def validate_governance(data: dict[str, Any]) -> None:
    expected_gate_ids = {
        "activation": "production_activation_review_audit",
        "abuse": "production_abuse_throttle_hold",
        "skill": "production_skill_release_eval_canary",
    }
    expected_sections = {
        "activation": {"high_risk_rbac", "reviewer_rationale", "second_review", "audit_immutability", "activation_gates"},
        "abuse": {"account_hold", "rate_limit", "spend_cap_or_kill_switch", "rbac_audit"},
        "skill": {"owner_risk", "eval_suite", "safety_refs", "canary_metrics", "rollback_target", "release_notes"},
    }
    for component, gate_id in expected_gate_ids.items():
        row = require_object(data.get(component), component)
        require(row.get("release_gate_check_id") == gate_id, f"{component} release_gate_check_id mismatch")
        require(set(expected_sections[component]) <= set(row), f"{component} section mismatch")
        require_list(row.get("runtime_request_ids"), f"{component}.runtime_request_ids")
        require_list(row.get("audit_refs"), f"{component}.audit_refs")


def validate_template(path: Path, data: dict[str, Any]) -> None:
    expected = EXPECTED_TEMPLATES[path.name]
    validate_common(path, data, expected)
    if path.name == "billing-paid-lifecycle-source.template.json":
        validate_billing(data)
    elif path.name == "production-legal-support-source.template.json":
        validate_legal_support(data)
    elif path.name in {"production-governance-release-source.template.json", "production-governance-proof.template.json"}:
        validate_governance(data)


def validate_template_dir(path: Path) -> None:
    require(path.exists() and path.is_dir(), f"missing template dir {display_path(path)}")
    actual = {item.name for item in path.glob("*.template.json")}
    require(actual == set(EXPECTED_TEMPLATES), f"template file set mismatch: got {sorted(actual)}")
    for name in sorted(EXPECTED_TEMPLATES):
        validate_template(path / name, load_json(path / name))


def run_self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        output_dir = Path(tmp) / "production-source-probes"
        result = subprocess.run(
            [
                sys.executable,
                str(GENERATOR),
                "--output-dir",
                str(output_dir),
                "--release-sha",
                SYNTHETIC_RELEASE_SHA,
                "--self-test",
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(result.returncode == 0, f"template self-test failed: {result.stderr or result.stdout}")
        validate_template_dir(output_dir)
        for produced in (output_dir / ".self-test-output").glob("*.json"):
            data = load_json(produced)
            status = data.get("status")
            require(status in {"blocked", "preflight_blocked"}, f"{produced.name} self-test artifact must stay blocked")
            require(data.get("canonical_source_written") in {None, False}, f"{produced.name} must not write canonical source")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template-dir", type=Path, default=DEFAULT_TEMPLATE_DIR)
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_code_anchors()
        if args.contract_only:
            print("stage1 production source probe template validation contract passed")
            return 0
        validate_template_dir(args.template_dir)
        if args.self_test:
            run_self_test()
    except ProductionSourceProbeTemplateValidationError as exc:
        raise SystemExit(f"stage1 production source probe template validation failed: {exc}") from exc
    print("stage1 production source probe template validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
