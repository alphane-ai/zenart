#!/usr/bin/env python3
"""Build sanitized production proof candidates and run the guarded launch pipeline.

The bundle is intentionally non-clearing by default. It reads proof inputs from
environment variables or a local .env file, writes only sanitized candidate or
blocked proof JSON under ops/evidence/non_clearing, and then runs the guarded
production source pipeline. Canonical production sources are written only when
--write-canonical-sources is explicitly provided and every strict source probe
passes.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"
DEFAULT_BILLING_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.candidate.json"
DEFAULT_SECURITY_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.candidate.json"
DEFAULT_GOVERNANCE_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.candidate.json"
DEFAULT_BILLING_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.blocked.json"
DEFAULT_SECURITY_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.blocked.json"
DEFAULT_GOVERNANCE_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.blocked.json"
DEFAULT_LEGAL_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.legal-support.json"
DEFAULT_PIPELINE_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"
DEFAULT_PRODUCTION_WEB_URL = "https://zenari.ai"
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

BILLING_ENV_ARGS = {
    "STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID": "--checkout-session-id",
    "STAGE1_PROD_BILLING_CHECKOUT_CUSTOMER_ID": "--checkout-customer-id",
    "STAGE1_PROD_BILLING_PRICE_ID": "--price-id",
    "STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_ID": "--active-subscription-id",
    "STAGE1_PROD_BILLING_ACTIVE_CUSTOMER_ID": "--active-customer-id",
    "STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_STATUS": "--active-subscription-status",
    "STAGE1_PROD_BILLING_PAST_DUE_SUBSCRIPTION_ID": "--past-due-subscription-id",
    "STAGE1_PROD_BILLING_PAST_DUE_INVOICE_ID": "--past-due-invoice-id",
    "STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_ID": "--cancel-subscription-id",
    "STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_STATUS": "--cancel-subscription-status",
    "STAGE1_PROD_BILLING_SEAT_QUANTITY": "--seat-quantity",
    "STAGE1_PROD_BILLING_SYNCED_QUANTITY": "--synced-quantity",
    "STAGE1_PROD_BILLING_SUBSCRIPTION_ITEM_ID": "--subscription-item-id",
    "STAGE1_PROD_BILLING_PRORATION_BEHAVIOR": "--proration-behavior",
    "STAGE1_PROD_BILLING_SYNC_IDEMPOTENCY_KEY": "--sync-idempotency-key",
    "STAGE1_PROD_BILLING_VISIBLE_INVOICE_ID": "--visible-invoice-id",
    "STAGE1_PROD_BILLING_REFUND_STATUS": "--refund-status",
    "STAGE1_PROD_BILLING_ADMIN_OPERATION": "--admin-operation",
    "STAGE1_PROD_BILLING_REFUND_CHARGE_ID": "--refund-charge-id",
    "STAGE1_PROD_BILLING_REFUND_ID": "--refund-id",
    "STAGE1_PROD_BILLING_QUOTA_RESET_INVOICE_ID": "--quota-reset-invoice-id",
    "STAGE1_PROD_BILLING_WEBHOOK_EVENT_IDS": "--webhook-event-ids",
    "STAGE1_PROD_BILLING_FIRST_DELIVERY_MUTATIONS": "--first-delivery-mutations",
    "STAGE1_PROD_BILLING_REPLAY_DELIVERY_MUTATIONS": "--replay-delivery-mutations",
    "STAGE1_PROD_BILLING_DUPLICATE_MUTATION_COUNT": "--duplicate-mutation-count",
    "STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_ID": "--failed-export-refund-id",
    "STAGE1_PROD_BILLING_LIVE_TEST_SEPARATION_REF": "--live-test-separation-ref",
    "STAGE1_PROD_BILLING_PAID_CHECKOUT_REF": "--paid-checkout-ref",
    "STAGE1_PROD_BILLING_SUBSCRIPTION_ACTIVE_REF": "--subscription-active-ref",
    "STAGE1_PROD_BILLING_SUBSCRIPTION_PAST_DUE_REF": "--subscription-past-due-ref",
    "STAGE1_PROD_BILLING_SUBSCRIPTION_CANCEL_REF": "--subscription-cancel-ref",
    "STAGE1_PROD_BILLING_TEAM_SEAT_REF": "--team-seat-ref",
    "STAGE1_PROD_BILLING_INVOICE_VISIBILITY_REF": "--invoice-visibility-ref",
    "STAGE1_PROD_BILLING_LIFECYCLE_AUDIT_REF": "--lifecycle-audit-ref",
    "STAGE1_PROD_BILLING_REFUND_CREDIT_REF": "--refund-credit-ref",
    "STAGE1_PROD_BILLING_QUOTA_RESET_REF": "--quota-reset-ref",
    "STAGE1_PROD_BILLING_WEBHOOK_IDEMPOTENCY_REF": "--webhook-idempotency-ref",
    "STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_REF": "--failed-export-refund-ref",
    "STAGE1_PROD_BILLING_QUOTA_PROJECTION_REF": "--quota-projection-ref",
    "STAGE1_PROD_BILLING_REFUND_WEBHOOK_AUDIT_REF": "--refund-webhook-audit-ref",
}

SECURITY_ENV_ARGS = {
    "STAGE1_PROD_SECURITY_SAME_SITE": "--same-site",
    "STAGE1_PROD_SECURITY_RAW_SECRET_EXPOSURE_COUNT": "--raw-secret-exposure-count",
    "STAGE1_PROD_SECURITY_FRONTEND_SECRET_EXPOSURE_COUNT": "--frontend-secret-exposure-count",
    "STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF": "--secure-session-cookie-ref",
    "STAGE1_PROD_SECURITY_CSRF_SAME_SITE_REF": "--csrf-same-site-ref",
    "STAGE1_PROD_SECURITY_SECRET_REDACTION_REF": "--secret-redaction-ref",
    "STAGE1_PROD_SECURITY_ADMIN_SURFACE_PRIVACY_REF": "--admin-surface-privacy-ref",
    "STAGE1_PROD_SECURITY_PROVIDER_KEY_CONTAINMENT_REF": "--provider-key-containment-ref",
    "STAGE1_PROD_SECURITY_STRIPE_LIVE_TEST_SEPARATION_REF": "--stripe-live-test-separation-ref",
    "STAGE1_PROD_SECURITY_RATE_LIMIT_SPEND_CAP_REF": "--rate-limit-spend-cap-ref",
    "STAGE1_PROD_SECURITY_CSP_HEADERS_REF": "--csp-headers-ref",
    "STAGE1_PROD_SECURITY_RBAC_TENANT_ISOLATION_REF": "--rbac-tenant-isolation-ref",
    "STAGE1_PROD_SECURITY_AUDIT_REF": "--audit-ref",
}

GOVERNANCE_ENV_ARGS = {
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS": "--activation-runtime-request-ids",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_REFS": "--activation-audit-refs",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_HIGH_RISK_RBAC_REF": "--activation-high-risk-rbac-ref",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_REVIEWER_RATIONALE_REF": "--activation-reviewer-rationale-ref",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_SECOND_REVIEW_REF": "--activation-second-review-ref",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_IMMUTABILITY_REF": "--activation-audit-immutability-ref",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_GATES_REF": "--activation-gates-ref",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RUNTIME_REQUEST_IDS": "--abuse-runtime-request-ids",
    "STAGE1_PROD_GOVERNANCE_ABUSE_AUDIT_REFS": "--abuse-audit-refs",
    "STAGE1_PROD_GOVERNANCE_ABUSE_ACCOUNT_HOLD_REF": "--abuse-account-hold-ref",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RATE_LIMIT_REF": "--abuse-rate-limit-ref",
    "STAGE1_PROD_GOVERNANCE_ABUSE_SPEND_CAP_OR_KILL_SWITCH_REF": "--abuse-spend-cap-or-kill-switch-ref",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RBAC_AUDIT_REF": "--abuse-rbac-audit-ref",
    "STAGE1_PROD_GOVERNANCE_SKILL_RUNTIME_REQUEST_IDS": "--skill-runtime-request-ids",
    "STAGE1_PROD_GOVERNANCE_SKILL_AUDIT_REFS": "--skill-audit-refs",
    "STAGE1_PROD_GOVERNANCE_SKILL_OWNER_ID": "--skill-owner-id",
    "STAGE1_PROD_GOVERNANCE_SKILL_RISK_LEVEL": "--skill-risk-level",
    "STAGE1_PROD_GOVERNANCE_SKILL_SUITE_ID": "--skill-suite-id",
    "STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_ID": "--skill-rollback-target-id",
    "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_ID": "--skill-release-notes-id",
    "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_SAMPLE_SIZE": "--skill-canary-sample-size",
    "STAGE1_PROD_GOVERNANCE_SKILL_OWNER_RISK_REF": "--skill-owner-risk-ref",
    "STAGE1_PROD_GOVERNANCE_SKILL_EVAL_SUITE_REF": "--skill-eval-suite-ref",
    "STAGE1_PROD_GOVERNANCE_SKILL_SAFETY_REFS_REF": "--skill-safety-refs-ref",
    "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_METRICS_REF": "--skill-canary-metrics-ref",
    "STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_REF": "--skill-rollback-target-ref",
    "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_REF": "--skill-release-notes-ref",
}

PRODUCTION_DNS_REQUIRED_INPUTS = (
    {
        "requirement_id": "production_web_url",
        "display_name": "PRODUCTION_WEB_URL or --production-web-url",
        "accepted_variable_names": ("PRODUCTION_WEB_URL",),
    },
    {
        "requirement_id": "production_dns_target",
        "display_name": "PRODUCTION_DNS_TARGET",
        "accepted_variable_names": ("PRODUCTION_DNS_TARGET",),
    },
    {
        "requirement_id": "cloudflare_zone_id",
        "display_name": "CLOUDFLARE_ZONE_ID or CF_ZONE_ID",
        "accepted_variable_names": ("CLOUDFLARE_ZONE_ID", "CF_ZONE_ID"),
    },
    {
        "requirement_id": "cloudflare_dns_edit_token",
        "display_name": "CLOUDFLARE_API_TOKEN or CF_API_TOKEN",
        "accepted_variable_names": ("CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"),
    },
)

BILLING_REQUIRED_INPUTS = (
    {
        "requirement_id": "stripe_mode_live",
        "display_name": "STRIPE_MODE=live",
        "accepted_variable_names": ("STRIPE_MODE",),
        "validator": "stripe_mode_live",
    },
    {
        "requirement_id": "stripe_live_secret",
        "display_name": "STRIPE_SECRET_KEY or STRIPE_API_KEY with live key shape",
        "accepted_variable_names": ("STRIPE_SECRET_KEY", "STRIPE_API_KEY"),
        "validator": "stripe_live_secret",
    },
    {
        "requirement_id": "stripe_live_publishable",
        "display_name": "STRIPE_PUBLISHABLE_KEY or NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY with live key shape",
        "accepted_variable_names": ("STRIPE_PUBLISHABLE_KEY", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"),
        "validator": "stripe_live_publishable",
    },
    *(
        {
            "requirement_id": env_name.lower().removeprefix("stage1_prod_billing_"),
            "display_name": env_name,
            "accepted_variable_names": (env_name,),
        }
        for env_name in (
            "STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID",
            "STAGE1_PROD_BILLING_CHECKOUT_CUSTOMER_ID",
            "STAGE1_PROD_BILLING_PRICE_ID",
            "STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_ID",
            "STAGE1_PROD_BILLING_ACTIVE_CUSTOMER_ID",
            "STAGE1_PROD_BILLING_PAST_DUE_SUBSCRIPTION_ID",
            "STAGE1_PROD_BILLING_PAST_DUE_INVOICE_ID",
            "STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_ID",
            "STAGE1_PROD_BILLING_SEAT_QUANTITY",
            "STAGE1_PROD_BILLING_SYNCED_QUANTITY",
            "STAGE1_PROD_BILLING_SUBSCRIPTION_ITEM_ID",
            "STAGE1_PROD_BILLING_VISIBLE_INVOICE_ID",
            "STAGE1_PROD_BILLING_REFUND_CHARGE_ID",
            "STAGE1_PROD_BILLING_REFUND_ID",
            "STAGE1_PROD_BILLING_QUOTA_RESET_INVOICE_ID",
            "STAGE1_PROD_BILLING_WEBHOOK_EVENT_IDS",
            "STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_ID",
        )
    ),
)

BILLING_OPTIONAL_OR_DEFAULTED_INPUTS = (
    *(
        env_name
        for env_name in BILLING_ENV_ARGS
        if env_name
        not in {
            "STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID",
            "STAGE1_PROD_BILLING_CHECKOUT_CUSTOMER_ID",
            "STAGE1_PROD_BILLING_PRICE_ID",
            "STAGE1_PROD_BILLING_ACTIVE_SUBSCRIPTION_ID",
            "STAGE1_PROD_BILLING_ACTIVE_CUSTOMER_ID",
            "STAGE1_PROD_BILLING_PAST_DUE_SUBSCRIPTION_ID",
            "STAGE1_PROD_BILLING_PAST_DUE_INVOICE_ID",
            "STAGE1_PROD_BILLING_CANCEL_SUBSCRIPTION_ID",
            "STAGE1_PROD_BILLING_SEAT_QUANTITY",
            "STAGE1_PROD_BILLING_SYNCED_QUANTITY",
            "STAGE1_PROD_BILLING_SUBSCRIPTION_ITEM_ID",
            "STAGE1_PROD_BILLING_VISIBLE_INVOICE_ID",
            "STAGE1_PROD_BILLING_REFUND_CHARGE_ID",
            "STAGE1_PROD_BILLING_REFUND_ID",
            "STAGE1_PROD_BILLING_QUOTA_RESET_INVOICE_ID",
            "STAGE1_PROD_BILLING_WEBHOOK_EVENT_IDS",
            "STAGE1_PROD_BILLING_FAILED_EXPORT_REFUND_ID",
        }
    ),
)

SECURITY_REQUIRED_INPUTS = tuple(
    {
        "requirement_id": env_name.lower().removeprefix("stage1_prod_security_"),
        "display_name": env_name,
        "accepted_variable_names": (env_name,),
    }
    for env_name in SECURITY_ENV_ARGS
    if env_name
    not in {
        "STAGE1_PROD_SECURITY_SAME_SITE",
        "STAGE1_PROD_SECURITY_RAW_SECRET_EXPOSURE_COUNT",
        "STAGE1_PROD_SECURITY_FRONTEND_SECRET_EXPOSURE_COUNT",
    }
)

SECURITY_OPTIONAL_OR_DEFAULTED_INPUTS = tuple(
    env_name
    for env_name in SECURITY_ENV_ARGS
    if env_name
    in {
        "STAGE1_PROD_SECURITY_SAME_SITE",
        "STAGE1_PROD_SECURITY_RAW_SECRET_EXPOSURE_COUNT",
        "STAGE1_PROD_SECURITY_FRONTEND_SECRET_EXPOSURE_COUNT",
    }
)

GOVERNANCE_REQUIRED_INPUTS = tuple(
    {
        "requirement_id": env_name.lower().removeprefix("stage1_prod_governance_"),
        "display_name": env_name,
        "accepted_variable_names": (env_name,),
    }
    for env_name in GOVERNANCE_ENV_ARGS
    if env_name != "STAGE1_PROD_GOVERNANCE_SKILL_RISK_LEVEL"
)

GOVERNANCE_OPTIONAL_OR_DEFAULTED_INPUTS = ("STAGE1_PROD_GOVERNANCE_SKILL_RISK_LEVEL",)


class ProductionProofBundleError(Exception):
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
        key = key.strip().removeprefix("export ").strip()
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            values[key] = value.strip().strip("'\"")
    return values


def env_value(values: dict[str, str], key: str) -> str:
    return os.environ.get(key, values.get(key, "")).strip()


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionProofBundleError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionProofBundleError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_proof_bundle")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    value = result.stdout.strip().lower() if result.returncode == 0 else ""
    if not RELEASE_SHA_RE.fullmatch(value):
        raise ProductionProofBundleError("release_sha_missing_or_not_full_sha")
    return value


def scrub(text: str) -> str:
    return RAW_SECRET_RE.sub("[redacted]", text.strip())[:1200]


def env_args(values: dict[str, str], mapping: dict[str, str]) -> tuple[list[str], list[str]]:
    args: list[str] = []
    present: list[str] = []
    for env_name, cli_arg in mapping.items():
        value = env_value(values, env_name)
        if value:
            args.extend([cli_arg, value])
            present.append(env_name)
    return args, present


def first_present_variable(values: dict[str, str], variable_names: tuple[str, ...]) -> str:
    for name in variable_names:
        if env_value(values, name):
            return name
    return ""


def validate_requirement(values: dict[str, str], requirement: dict[str, Any]) -> tuple[str, str]:
    variable_names = tuple(str(name) for name in requirement.get("accepted_variable_names", ()))
    configured_name = first_present_variable(values, variable_names)
    if not configured_name:
        return "missing", ""
    validator = requirement.get("validator")
    if validator == "stripe_mode_live":
        return ("configured", configured_name) if env_value(values, configured_name).lower() == "live" else ("invalid", configured_name)
    if validator == "stripe_live_secret":
        value = env_value(values, configured_name)
        return ("configured", configured_name) if value.startswith(("sk_live_", "rk_live_")) else ("invalid", configured_name)
    if validator == "stripe_live_publishable":
        value = env_value(values, configured_name)
        return ("configured", configured_name) if value.startswith("pk_live_") else ("invalid", configured_name)
    return "configured", configured_name


def required_coverage(values: dict[str, str], requirements: tuple[dict[str, Any], ...]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    missing: list[str] = []
    invalid: list[str] = []
    configured: list[str] = []
    for requirement in requirements:
        status, configured_name = validate_requirement(values, requirement)
        display_name = str(requirement["display_name"])
        row: dict[str, Any] = {
            "requirement_id": requirement["requirement_id"],
            "display_name": display_name,
            "accepted_variable_names": list(requirement["accepted_variable_names"]),
            "status": status,
            "configured_variable_name": configured_name or None,
        }
        rows.append(row)
        if status == "configured":
            configured.append(configured_name)
        elif status == "invalid":
            invalid.append(display_name)
        else:
            missing.append(display_name)
    return {
        "required_total": len(requirements),
        "required_configured": len(configured),
        "required_missing": len(missing),
        "required_invalid": len(invalid),
        "configured_variable_names": sorted(set(configured)),
        "missing_required_inputs": missing,
        "invalid_required_inputs": invalid,
        "requirements": rows,
    }


def optional_coverage(values: dict[str, str], variable_names: tuple[str, ...]) -> dict[str, Any]:
    configured = [name for name in variable_names if env_value(values, name)]
    return {
        "optional_or_defaulted_total": len(variable_names),
        "optional_or_defaulted_configured": len(configured),
        "configured_variable_names": configured,
    }


def input_variable_coverage(values: dict[str, str], production_web_url: str) -> dict[str, Any]:
    production_dns = required_coverage(values, PRODUCTION_DNS_REQUIRED_INPUTS)
    if production_web_url.strip():
        for row in production_dns["requirements"]:
            if row["requirement_id"] == "production_web_url" and row["status"] == "missing":
                row["status"] = "configured"
                row["configured_variable_name"] = "--production-web-url"
                production_dns["required_missing"] -= 1
                production_dns["required_configured"] += 1
                production_dns["missing_required_inputs"] = [
                    item for item in production_dns["missing_required_inputs"] if item != "PRODUCTION_WEB_URL or --production-web-url"
                ]
                production_dns["configured_variable_names"].append("--production-web-url")
                production_dns["configured_variable_names"] = sorted(set(production_dns["configured_variable_names"]))
                break

    groups = {
        "production_dns": {
            **production_dns,
            "optional_or_defaulted_total": 0,
            "optional_or_defaulted_configured": 0,
            "optional_or_defaulted_configured_variable_names": [],
        },
        "billing": {
            **required_coverage(values, BILLING_REQUIRED_INPUTS),
            "optional_or_defaulted": optional_coverage(values, BILLING_OPTIONAL_OR_DEFAULTED_INPUTS),
        },
        "security": {
            **required_coverage(values, SECURITY_REQUIRED_INPUTS),
            "optional_or_defaulted": optional_coverage(values, SECURITY_OPTIONAL_OR_DEFAULTED_INPUTS),
        },
        "governance": {
            **required_coverage(values, GOVERNANCE_REQUIRED_INPUTS),
            "optional_or_defaulted": optional_coverage(values, GOVERNANCE_OPTIONAL_OR_DEFAULTED_INPUTS),
        },
    }
    required_total = sum(group["required_total"] for group in groups.values())
    required_configured = sum(group["required_configured"] for group in groups.values())
    required_missing = sum(group["required_missing"] for group in groups.values())
    required_invalid = sum(group["required_invalid"] for group in groups.values())
    blocking_input_count = required_missing + required_invalid
    return {
        "schema_version": "stage1.production_proof_bundle.input_variable_coverage.v1",
        "value_redaction": "variable_names_only",
        "required_total": required_total,
        "required_configured": required_configured,
        "required_missing": required_missing,
        "required_invalid": required_invalid,
        "blocking_input_count": blocking_input_count,
        "required_completion_percent": round((required_configured / required_total) * 100, 1) if required_total else 100.0,
        "groups": groups,
        "first_missing_or_invalid_inputs": [
            *groups["production_dns"]["missing_required_inputs"],
            *groups["production_dns"]["invalid_required_inputs"],
            *groups["billing"]["missing_required_inputs"],
            *groups["billing"]["invalid_required_inputs"],
            *groups["security"]["missing_required_inputs"],
            *groups["security"]["invalid_required_inputs"],
            *groups["governance"]["missing_required_inputs"],
            *groups["governance"]["invalid_required_inputs"],
        ][:12],
    }


def run_step(step_id: str, command: list[str], expected_exit_codes: set[int]) -> dict[str, Any]:
    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    output_summary = scrub(result.stderr or result.stdout)
    status = "pass" if result.returncode == 0 else ("blocked" if result.returncode == 2 else "failed")
    return {
        "step_id": step_id,
        "status": status,
        "exit_code": result.returncode,
        "expected_exit": result.returncode in expected_exit_codes,
        "command": " ".join(command),
        "output_summary": output_summary,
    }


def proof_status(path: Path, diagnostic: Path) -> dict[str, Any]:
    proof = load_json(path)
    blocked = load_json(diagnostic)
    if proof.get("status") == "pass":
        return {"status": "pass", "path": display_path(path), "schema_version": proof.get("schema_version")}
    if blocked.get("status") == "blocked":
        blockers = blocked.get("blocked_checks") if isinstance(blocked.get("blocked_checks"), list) else []
        sample_blockers = [str(item) for item in blockers[:8]]
        return {
            "status": "blocked",
            "path": display_path(diagnostic),
            "first_blocker": str(blockers[0]) if blockers else "not reported",
            "blocker_count": len(blockers),
            "sample_blockers": sample_blockers,
            "schema_version": blocked.get("schema_version"),
        }
    return {"status": "missing", "path": display_path(path)}


def build_summary(
    *,
    args: argparse.Namespace,
    release_sha: str,
    configured_env: dict[str, list[str]],
    coverage: dict[str, Any],
    steps: list[dict[str, Any]],
) -> dict[str, Any]:
    blocked = any(step.get("exit_code") != 0 for step in steps)
    pipeline = load_json(args.pipeline_summary)
    data: dict[str, Any] = {
        "schema_version": "stage1.production_proof_bundle.v1",
        "environment": "production",
        "kind": "stage1_production_proof_bundle",
        "status": "blocked" if blocked else "pass",
        "release_gate_decision": "no_go" if blocked else "go_candidate_requires_strict_production_launch_validation",
        "generated_at": now(),
        "release_sha": release_sha,
        "non_clearing_bundle": blocked,
        "canonical_sources_requested": args.write_canonical_sources is True,
        "production_web_url": args.production_web_url.rstrip("/"),
        "configured_input_variable_names": configured_env,
        "input_variable_coverage": coverage,
        "proofs": {
            "billing": proof_status(args.billing_proof, args.billing_diagnostic),
            "security": proof_status(args.security_proof, args.security_diagnostic),
            "governance": proof_status(args.governance_proof, args.governance_diagnostic),
        },
        "pipeline_summary": {
            "path": display_path(args.pipeline_summary),
            "status": pipeline.get("status", "missing") if pipeline else "missing",
            "release_gate_decision": pipeline.get("release_gate_decision", "no_go") if pipeline else "no_go",
            "aggregate_attempted": pipeline.get("aggregate_attempted", False) if pipeline else False,
        },
        "steps": steps,
        "blocked_checks": [
            f"{step['step_id']}: {step['output_summary'] or 'exit_' + str(step['exit_code'])}"
            for step in steps
            if step.get("status") != "pass"
        ],
        "gate_impact": {
            "can_clear_stage1_production_launch_gate": False,
            "requires_strict_validator": "python3 scripts/validate_stage1_production_launch.py",
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def run_bundle(args: argparse.Namespace) -> int:
    values = read_env_file(args.env)
    release_sha = args.release_sha or current_release_sha()
    if not RELEASE_SHA_RE.fullmatch(release_sha):
        raise ProductionProofBundleError("release_sha_missing_or_not_full_sha")

    billing_args, billing_env = env_args(values, BILLING_ENV_ARGS)
    security_args, security_env = env_args(values, SECURITY_ENV_ARGS)
    governance_args, governance_env = env_args(values, GOVERNANCE_ENV_ARGS)
    configured_env = {
        "billing": billing_env,
        "security": security_env,
        "governance": governance_env,
    }

    steps = [
        run_step(
            "billing_proof",
            [
                "python3",
                "scripts/stage1_stripe_live_billing_proof.py",
                "--env-file",
                display_path(args.env),
                "--release-sha",
                release_sha,
                "--output",
                display_path(args.billing_proof),
                "--diagnostic",
                display_path(args.billing_diagnostic),
                *billing_args,
            ],
            {0, 2},
        ),
        run_step(
            "security_proof",
            [
                "python3",
                "scripts/stage1_production_security_proof.py",
                "--release-sha",
                release_sha,
                "--output",
                display_path(args.security_proof),
                "--diagnostic",
                display_path(args.security_diagnostic),
                *security_args,
            ],
            {0, 2},
        ),
        run_step(
            "governance_proof",
            [
                "python3",
                "scripts/stage1_production_governance_proof.py",
                "--release-sha",
                release_sha,
                "--output",
                display_path(args.governance_proof),
                "--diagnostic",
                display_path(args.governance_diagnostic),
                *governance_args,
            ],
            {0, 2},
        ),
    ]

    pipeline_command = [
        "python3",
        "scripts/run_stage1_production_launch_source_pipeline.py",
        "--release-sha",
        release_sha,
        "--production-web-url",
        args.production_web_url.rstrip("/"),
        "--billing-proof",
        display_path(args.billing_proof),
        "--security-proof",
        display_path(args.security_proof),
        "--governance-proof",
        display_path(args.governance_proof),
        "--legal-diagnostic",
        display_path(args.legal_diagnostic),
        "--summary",
        display_path(args.pipeline_summary),
    ]
    if args.write_canonical_sources:
        pipeline_command.append("--write-canonical-sources")
    steps.append(run_step("launch_source_pipeline", pipeline_command, {0, 2}))

    coverage = input_variable_coverage(values, args.production_web_url)
    summary = build_summary(args=args, release_sha=release_sha, configured_env=configured_env, coverage=coverage, steps=steps)
    write_json(args.summary, summary)
    print(f"wrote Stage 1 production proof bundle summary to {display_path(args.summary)}")
    return 2 if summary["status"] == "blocked" else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--release-sha", default="")
    parser.add_argument("--production-web-url", default=DEFAULT_PRODUCTION_WEB_URL)
    parser.add_argument("--billing-proof", type=Path, default=DEFAULT_BILLING_PROOF)
    parser.add_argument("--security-proof", type=Path, default=DEFAULT_SECURITY_PROOF)
    parser.add_argument("--governance-proof", type=Path, default=DEFAULT_GOVERNANCE_PROOF)
    parser.add_argument("--billing-diagnostic", type=Path, default=DEFAULT_BILLING_DIAGNOSTIC)
    parser.add_argument("--security-diagnostic", type=Path, default=DEFAULT_SECURITY_DIAGNOSTIC)
    parser.add_argument("--governance-diagnostic", type=Path, default=DEFAULT_GOVERNANCE_DIAGNOSTIC)
    parser.add_argument("--legal-diagnostic", type=Path, default=DEFAULT_LEGAL_DIAGNOSTIC)
    parser.add_argument("--pipeline-summary", type=Path, default=DEFAULT_PIPELINE_SUMMARY)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--write-canonical-sources", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        required = {"billing": BILLING_ENV_ARGS, "security": SECURITY_ENV_ARGS, "governance": GOVERNANCE_ENV_ARGS}
        coverage_contracts = {
            "production_dns": PRODUCTION_DNS_REQUIRED_INPUTS,
            "billing": BILLING_REQUIRED_INPUTS,
            "security": SECURITY_REQUIRED_INPUTS,
            "governance": GOVERNANCE_REQUIRED_INPUTS,
        }
        if not all(required.values()) or not all(coverage_contracts.values()):
            raise SystemExit("production proof bundle env contract incomplete")
        print("stage1 production proof bundle contract passed")
        return 0
    try:
        return run_bundle(args)
    except ProductionProofBundleError as exc:
        print(f"stage1 production proof bundle failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
