#!/usr/bin/env python3
"""Validate Stage 1 Stripe test checkout/webhook staging lifecycle evidence."""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stripe-test-checkout-webhook.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stripe-test-checkout-webhook.ndjson"
DEFAULT_LOCAL_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "stripe-test-checkout-webhook.local-devport.json"
DEFAULT_LOCAL_RESULTS = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "stripe-test-checkout-webhook.local-devport.ndjson"
CONTRACT = ROOT / "fixtures" / "stage1" / "stripe" / "stripe_staging_lifecycle_contract.json"

SELFTEST = ROOT / "scripts" / "stripe_sandbox_selftest.sh"
SMOKE_SCRIPT = ROOT / "scripts" / "stage1_stripe_staging_smoke.sh"
CHECKOUT = ROOT / "backend" / "internal" / "billing" / "stripe_checkout.go"
WEBHOOK = ROOT / "backend" / "internal" / "billing" / "stripe_webhook.go"
CHECKOUT_TEST = ROOT / "backend" / "internal" / "billing" / "stripe_checkout_test.go"
WEBHOOK_TEST = ROOT / "backend" / "internal" / "billing" / "stripe_webhook_test.go"
CONFIG = ROOT / "backend" / "internal" / "config" / "config.go"
CONFIG_TEST = ROOT / "backend" / "internal" / "config" / "config_test.go"
SERVER = ROOT / "backend" / "internal" / "server" / "server.go"
BILLING_CLIENT = ROOT / "web" / "lib" / "billing-client.ts"
DEFAULT_PLAN_MIGRATION = ROOT / "backend" / "migrations" / "0015_stage1_default_paid_plan.sql"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)

SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "stripe-signature",
    "stripe_signature",
    "signature",
    "secret",
    "secret_key",
    "stripe_secret_key",
    "stripe_api_key",
    "api_key",
    "webhook_secret",
    "stripe_webhook_secret",
    "billing_webhook_secret",
    "raw_payload",
    "raw_event",
    "raw_response",
}

REQUIRED_SCENARIOS = {
    "checkout_session_created",
    "checkout_completed_paid",
    "invoice_paid",
    "invoice_payment_failed",
    "cancel_at_period_end",
    "subscription_cancelled",
    "refund_credit",
    "webhook_replay_idempotency",
    "quota_projection",
    "invoice_receipt_visibility",
}

REQUIRED_RESULTS = REQUIRED_SCENARIOS


class StripeEvidenceError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise StripeEvidenceError(message)


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
        value = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise StripeEvidenceError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(value, dict), f"{display_path(path)} must contain a JSON object")
    return value


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    require(path.exists(), f"missing {display_path(path)}")
    rows: list[dict[str, Any]] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise StripeEvidenceError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
        require(isinstance(value, dict), f"{display_path(path)}:{lineno} must contain a JSON object")
        rows.append(value)
    require(rows, f"{display_path(path)} must contain at least one result row")
    return rows


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret-bearing or raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def walk_values(value: Any, path: str = "$") -> list[tuple[str, Any]]:
    rows: list[tuple[str, Any]] = [(path, value)]
    if isinstance(value, dict):
        for key, child in value.items():
            rows.extend(walk_values(child, f"{path}.{key}"))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            rows.extend(walk_values(child, f"{path}[{idx}]"))
    return rows


def require_no_livemode_true(value: Any) -> None:
    for path, child in walk_values(value):
        if path.lower().endswith(".livemode"):
            require(child is False, f"{path} must be false")


def get_path(value: Any, dotted: str, default: Any = None) -> Any:
    current = value
    for part in dotted.split("."):
        if not isinstance(current, dict) or part not in current:
            return default
        current = current[part]
    return current


def non_empty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def is_private_or_local_host(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    if not normalized or normalized == "localhost" or normalized == "0.0.0.0" or normalized.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def validate_production_like_staging_url(value: Any, field: str, allow_local_devport: bool) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required")
    parsed = urlparse(value)
    require(parsed.scheme in {"http", "https"} and parsed.netloc, f"{field} must be an absolute HTTP URL")
    if allow_local_devport:
        return
    require(parsed.scheme == "https", f"{field} must use https for strict staging evidence")
    require(not is_private_or_local_host(parsed.hostname or ""), f"{field} must not target localhost or private network in strict staging evidence")


def validate_absolute_http_url(value: Any, field: str) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required")
    parsed = urlparse(value)
    require(parsed.scheme in {"http", "https"} and parsed.netloc, f"{field} must be an absolute HTTP URL")


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.stripe_staging_lifecycle.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "stripe_test_checkout_webhook_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/staging/stripe-test-checkout-webhook.json", "contract evidence path mismatch")
    require(contract.get("canonical_results_path") == "ops/evidence/staging/stripe-test-checkout-webhook.ndjson", "contract results path mismatch")
    require(
        contract.get("local_devport_evidence_path")
        == "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.json",
        "contract local-devport evidence path mismatch",
    )
    require(
        contract.get("local_devport_results_path")
        == "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.ndjson",
        "contract local-devport results path mismatch",
    )
    require(contract.get("local_devport_can_clear_staging_gate") is False, "local devport evidence must not clear staging gate")
    require(contract.get("strict_schema_version") == "stage1.stripe_staging_lifecycle.v1", "contract strict schema mismatch")
    scenarios = contract.get("required_scenarios")
    require(isinstance(scenarios, list) and scenarios, "contract required_scenarios must be non-empty")
    by_id = {item.get("scenario_id"): item for item in scenarios if isinstance(item, dict)}
    require(REQUIRED_SCENARIOS <= set(by_id), f"contract missing scenarios {sorted(REQUIRED_SCENARIOS - set(by_id))}")
    for scenario_id, item in by_id.items():
        if scenario_id in REQUIRED_SCENARIOS:
            require(isinstance(item.get("required_fields"), list) and item["required_fields"], f"{scenario_id} required_fields missing")
    result_rows = set(contract.get("required_result_rows") or [])
    require(REQUIRED_RESULTS <= result_rows, f"contract missing result rows {sorted(REQUIRED_RESULTS - result_rows)}")
    anchors = set(contract.get("required_code_anchors") or [])
    for required in (
        "scripts/stage1_stripe_staging_smoke.sh",
        "scripts/stripe_sandbox_selftest.sh",
        "backend/internal/billing/stripe_checkout.go",
        "backend/internal/billing/stripe_webhook.go",
        "backend/internal/billing/stripe_checkout_test.go",
        "backend/internal/billing/stripe_webhook_test.go",
        "backend/internal/server/server.go",
        "web/lib/billing-client.ts",
    ):
        require(required in anchors, f"contract missing code anchor {required}")


def validate_code_anchors() -> None:
    require_text(
        SMOKE_SCRIPT,
        (
            "stripe-test-checkout-webhook.json",
            "stripe-test-checkout-webhook.ndjson",
            "stripe-test-checkout-webhook.local-devport.json",
            "stripe-test-checkout-webhook.local-devport.ndjson",
            'PLAN_ID="${PLAN_ID:-plan_pro}"',
            "checkout_session_created",
            "checkout_completed_paid",
            "invoice_payment_failed",
            "cancel_at_period_end",
            "refund_credit",
            "webhook_replay_idempotency",
            "quota_projection",
            "resolve_user_quota_bucket_id",
            "production_like_staging_urls_ready",
            "API_URL_RESOLVE_ADDR",
            "API_URL_CA_CERT",
            "WEB_URL_RESOLVE_ADDR",
            "WEB_URL_CA_CERT",
            "ADMIN_URL_RESOLVE_ADDR",
            "ADMIN_URL_CA_CERT",
            "--resolve",
            "--cacert",
            "api_network_args",
            "production_like_local_fixture_command",
            "ALLOW_LOCAL_DEVPORT_EVIDENCE",
            "local_devport_debug",
            "local_devport_debug_evidence_cannot_clear_staging_gate",
            "can_clear_stripe_staging_gate",
            "FROM quota_buckets",
            "invoice_receipt_visibility",
            "USE_DEV_IDENTITY_HEADERS",
            "secret_material_persisted",
            "raw_webhook_secret_persisted",
            "redact_secret_file_in_place",
            "[redacted secret-bearing response omitted]",
            "persisted_evidence_ref",
            "validate_stage1_stripe_staging_evidence.py",
        ),
    )
    require_text(
        SELFTEST,
        (
            "STRIPE_MODE",
            "sk_test_",
            "pk_test_",
            "whsec_",
            '"livemode"',
            "products retrieve",
            "prices retrieve",
            "is_placeholder",
            "stripe CLI command failed",
        ),
    )
    require_text(
        CHECKOUT,
        (
            "CreateCheckout",
            "mode",
            "subscription",
            "metadata[tenant_id]",
            "metadata[user_id]",
            "metadata[plan_id]",
            "Stripe-Version",
            "Idempotency-Key",
            "checkoutIdempotencyKey",
            "livemode=true while STRIPE_MODE=test",
            "CancelSubscription",
            "cancel_at_period_end",
            "ListInvoices",
            "stripeErrorSummary",
            "body_sha256=",
            "security.RedactString",
            "stripeErrorObjectIDPattern",
        ),
    )
    require_text(
        CHECKOUT_TEST,
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
    require_text(
        WEBHOOK,
        (
            "verifyStripeWebhookSignature",
            "parseStripeWebhookEvent",
            "livemode=true while STRIPE_MODE=test",
            "ClaimEvent",
            "SyncSubscription",
            "MarkEventProcessed",
            "ON CONFLICT (id) DO NOTHING",
            "checkout.session.completed",
            "invoice.payment_failed",
            "invoice.paid",
            "customer.subscription.deleted",
        ),
    )
    require_text(
        CHECKOUT_TEST,
        (
            "TestStripeCreateCheckoutPostsSessionRequest",
            "metadata[tenant_id]",
            "Idempotency-Key",
            "RejectsLiveModeResponseInTestMode",
        ),
    )
    require_text(
        WEBHOOK_TEST,
        (
            "TestStripeHandleWebhookProcessesValidCheckoutEventOnce",
            "replay",
            "RejectsInvalidSignature",
            "RejectsLiveModeEventInTestMode",
            "TestStripeWebhookStatusMapping",
            "TestStripeEventRepositoryPersistsAndSyncsSubscription",
            "TestStripeEventRepositoryIdempotencyAndNoRows",
        ),
    )
    require_text(
        SERVER,
        (
            "POST /api/v1/billing/checkout",
            "POST /api/v1/billing/webhook",
            "POST /api/v1/billing/subscription/cancel",
            "GET /api/v1/billing/invoices",
            "POST /api/admin/v1/billing/manual-credit",
            "POST /api/admin/v1/billing/refund-note",
            "billing.manual_credit",
            "billing.refund_note",
        ),
    )
    require_text(
        BILLING_CLIENT,
        (
            "createCheckoutSession",
            "createPortalSession",
            "cancelSubscription",
            "listInvoices",
            'defaultCheckoutPlanId = "plan_pro"',
        ),
    )
    require_text(
        DEFAULT_PLAN_MIGRATION,
        (
            "INSERT INTO subscription_plans",
            "'plan_pro'",
            "'Zenari Pro'",
            '"default_checkout_plan":true',
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "BL-9",
            "Staging Stripe evidence",
            "VF-4",
        ),
    )


def scenario_map(data: dict[str, Any]) -> dict[str, dict[str, Any]]:
    scenarios = data.get("scenarios")
    require(isinstance(scenarios, list) and scenarios, "scenarios must be a non-empty list")
    mapped: dict[str, dict[str, Any]] = {}
    for item in scenarios:
        require(isinstance(item, dict), "each scenario must be an object")
        scenario_id = item.get("scenario_id")
        require(isinstance(scenario_id, str) and scenario_id.strip(), "scenario_id is required")
        require(scenario_id not in mapped, f"duplicate scenario {scenario_id}")
        mapped[scenario_id] = item
    require(REQUIRED_SCENARIOS <= set(mapped), f"missing scenarios {sorted(REQUIRED_SCENARIOS - set(mapped))}")
    return mapped


def require_scenario_pass(item: dict[str, Any], scenario_id: str) -> None:
    require(item.get("status") == "passed", f"{scenario_id} status must be passed")
    require(item.get("livemode") is False, f"{scenario_id} livemode must be false")
    require(non_empty(item.get("request_id")), f"{scenario_id} request_id is required")
    require(item.get("secret_leak_detected") is False, f"{scenario_id} secret_leak_detected must be false")


def validate_checkout(scenario: dict[str, Any]) -> None:
    checkout = scenario.get("checkout_session")
    require(isinstance(checkout, dict), "checkout_session_created.checkout_session must be object")
    require(str(checkout.get("id", "")).startswith("cs_test_"), "checkout session id must start with cs_test_")
    require(str(checkout.get("url", "")).startswith("https://"), "checkout url must be https")
    require(checkout.get("livemode") is False, "checkout session livemode must be false")
    require(non_empty(checkout.get("idempotency_key")), "checkout idempotency_key required")
    metadata = checkout.get("metadata")
    require(isinstance(metadata, dict), "checkout metadata must be object")
    for key in ("tenant_id", "user_id", "plan_id"):
        require(non_empty(metadata.get(key)), f"checkout metadata.{key} required")
    require(str(checkout.get("mode", "subscription")) == "subscription", "checkout mode must be subscription")


def validate_event_scenario(scenario: dict[str, Any], scenario_id: str, allowed_types: set[str], wanted_status: set[str]) -> None:
    event = scenario.get("event")
    require(isinstance(event, dict), f"{scenario_id}.event must be object")
    require(str(event.get("id", "")).startswith("evt_"), f"{scenario_id} event id must start with evt_")
    require(event.get("livemode") is False, f"{scenario_id} event livemode must be false")
    require(event.get("type") in allowed_types, f"{scenario_id} event type mismatch")
    subscription = scenario.get("subscription")
    require(isinstance(subscription, dict), f"{scenario_id}.subscription must be object")
    require(subscription.get("status") in wanted_status, f"{scenario_id} subscription status mismatch")
    require(non_empty(subscription.get("plan_id")), f"{scenario_id} subscription plan_id required")
    require(non_empty(subscription.get("provider_ref")) or non_empty(subscription.get("id")), f"{scenario_id} provider_ref or id required")


def validate_invoice_paid(scenario: dict[str, Any]) -> None:
    validate_event_scenario(
        scenario,
        "invoice_paid",
        {"invoice.paid", "invoice.payment_succeeded"},
        {"active", "trialing"},
    )
    invoice = scenario.get("invoice")
    require(isinstance(invoice, dict), "invoice_paid.invoice must be object")
    require(str(invoice.get("id", "")).startswith("in_"), "invoice id must start with in_")
    require(invoice.get("livemode") is False, "invoice livemode must be false")
    require(invoice.get("status") in {"paid", "succeeded"}, "invoice status must be paid")
    require(non_empty(invoice.get("hosted_invoice_url")), "invoice hosted_invoice_url required")


def validate_payment_failed(scenario: dict[str, Any]) -> None:
    validate_event_scenario(scenario, "invoice_payment_failed", {"invoice.payment_failed"}, {"past_due"})
    projection = scenario.get("account_projection")
    require(isinstance(projection, dict), "invoice_payment_failed.account_projection must be object")
    require(projection.get("subscription_status") == "past_due", "payment failed projection must be past_due")


def validate_cancel_at_period_end(scenario: dict[str, Any]) -> None:
    subscription = scenario.get("subscription")
    require(isinstance(subscription, dict), "cancel_at_period_end.subscription must be object")
    require(non_empty(subscription.get("id")), "cancel subscription id required")
    require(subscription.get("livemode") is False, "cancel subscription livemode must be false")
    require(subscription.get("cancel_at_period_end") is True, "cancel_at_period_end must be true")
    require(non_empty(subscription.get("current_period_end")), "current_period_end required")
    projection = scenario.get("account_projection")
    require(isinstance(projection, dict), "cancel_at_period_end.account_projection must be object")
    require(projection.get("cancel_at_period_end") is True, "account projection cancel_at_period_end must be true")


def validate_subscription_cancelled(scenario: dict[str, Any]) -> None:
    validate_event_scenario(
        scenario,
        "subscription_cancelled",
        {"customer.subscription.deleted", "customer.subscription.updated"},
        {"cancelled", "canceled", "expired"},
    )
    projection = scenario.get("account_projection")
    require(isinstance(projection, dict), "subscription_cancelled.account_projection must be object")
    require(projection.get("subscription_status") in {"cancelled", "canceled", "expired"}, "cancelled projection status mismatch")


def validate_refund_credit(scenario: dict[str, Any]) -> None:
    refund = scenario.get("refund")
    require(isinstance(refund, dict), "refund_credit.refund must be object")
    require(str(refund.get("id", "")).startswith(("re_", "ch_", "refund_")), "refund id must look like a refund reference")
    require(refund.get("livemode") is False, "refund livemode must be false")
    require(refund.get("status") in {"succeeded", "pending", "requires_action"}, "refund status mismatch")
    operation = scenario.get("admin_operation")
    require(isinstance(operation, dict), "refund_credit.admin_operation must be object")
    require(operation.get("operation") in {"refund_note", "manual_credit"}, "refund admin operation must be refund_note or manual_credit")
    require(non_empty(operation.get("idempotency_key")), "refund admin operation idempotency_key required")
    quota_credit = scenario.get("quota_credit")
    require(isinstance(quota_credit, dict), "refund_credit.quota_credit must be object")
    require(non_empty(quota_credit.get("transaction_id")), "refund quota credit transaction_id required")
    require(isinstance(quota_credit.get("units"), int) and quota_credit["units"] > 0, "refund quota credit units must be positive")


def validate_replay(scenario: dict[str, Any]) -> None:
    event = scenario.get("event")
    require(isinstance(event, dict), "webhook replay event must be object")
    require(str(event.get("id", "")).startswith("evt_"), "webhook replay event id required")
    require(event.get("livemode") is False, "webhook replay event livemode must be false")
    require(scenario.get("replay_attempted") is True, "webhook replay must be attempted")
    require(isinstance(scenario.get("first_delivery_mutations"), int), "first_delivery_mutations must be integer")
    require(scenario["first_delivery_mutations"] >= 1, "first delivery must mutate at least once")
    require(scenario.get("replay_delivery_mutations") == 0, "replay delivery must not mutate")
    require(scenario.get("duplicate_mutation_count") == 0, "duplicate mutation count must be zero")
    require(scenario.get("idempotency_verified") is True, "idempotency_verified must be true")


def validate_quota_projection(scenario: dict[str, Any]) -> None:
    quota = scenario.get("quota")
    require(isinstance(quota, dict), "quota_projection.quota must be object")
    for key in ("bucket_id", "limit_units", "used_units", "reserved_units"):
        require(key in quota, f"quota.{key} required")
    require(isinstance(quota["limit_units"], int) and quota["limit_units"] > 0, "quota limit_units must be positive")
    require(isinstance(quota["used_units"], int) and quota["used_units"] >= 0, "quota used_units must be non-negative")
    require(isinstance(quota["reserved_units"], int) and quota["reserved_units"] >= 0, "quota reserved_units must be non-negative")
    require(quota["used_units"] + quota["reserved_units"] <= quota["limit_units"], "quota projection must not exceed limit")
    transactions = quota.get("transactions")
    require(isinstance(transactions, list) and transactions, "quota transactions must be non-empty")
    kinds = {item.get("kind") for item in transactions if isinstance(item, dict)}
    require({"credit", "manual_credit"} & kinds, "quota transactions must include credit/manual_credit")


def validate_invoice_visibility(scenario: dict[str, Any]) -> None:
    invoice = scenario.get("invoice")
    require(isinstance(invoice, dict), "invoice_receipt_visibility.invoice must be object")
    require(str(invoice.get("id", "")).startswith("in_"), "visible invoice id required")
    require(invoice.get("livemode") is False, "visible invoice livemode must be false")
    require(non_empty(invoice.get("hosted_invoice_url")), "hosted_invoice_url required")
    require(non_empty(invoice.get("invoice_pdf")) or non_empty(invoice.get("receipt_url")), "invoice pdf or receipt_url required")
    projection = scenario.get("ui_projection")
    require(isinstance(projection, dict), "invoice_receipt_visibility.ui_projection must be object")
    require(projection.get("invoice_visible") is True, "invoice must be visible")
    require(projection.get("receipt_visible") is True, "receipt must be visible")
    require(projection.get("secret_visible") is False, "secret_visible must be false")


def validate_results(rows: list[dict[str, Any]]) -> None:
    by_id = {row.get("scenario_id") or row.get("check_id"): row for row in rows}
    require(REQUIRED_RESULTS <= set(by_id), f"results missing rows {sorted(REQUIRED_RESULTS - set(by_id))}")
    for scenario_id in REQUIRED_RESULTS:
        row = by_id[scenario_id]
        require(row.get("status") == "passed", f"result {scenario_id} must pass")
        require(row.get("livemode") is False, f"result {scenario_id} livemode must be false")
        require(row.get("secret_leak_detected") is False, f"result {scenario_id} secret_leak_detected must be false")
        require(non_empty(row.get("request_id")) or non_empty(row.get("evidence_ref")), f"result {scenario_id} request_id or evidence_ref required")


def validate_blocked_probe_evidence(data: dict[str, Any], rows: list[dict[str, Any]], allow_local_devport: bool) -> None:
    require(data.get("schema_version") == "stage1.stripe_staging_lifecycle.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "environment must be staging")
    require(data.get("kind") == "stripe_test_checkout_webhook", "kind mismatch")
    require(data.get("status") == "blocked", "blocked Stripe evidence status must be blocked")
    require(data.get("stripe_mode") == "test", "stripe_mode must be test")
    require(data.get("livemode") is False, "top-level livemode must be false")
    if allow_local_devport:
        validate_production_like_staging_url(data.get("api_url"), "api_url", allow_local_devport=True)
        validate_production_like_staging_url(data.get("web_url"), "web_url", allow_local_devport=True)
    else:
        validate_absolute_http_url(data.get("api_url"), "api_url")
        validate_absolute_http_url(data.get("web_url"), "web_url")
    require(data.get("secret_material_persisted") is False, "secret material must not be persisted")
    require(data.get("raw_webhook_secret_persisted") is False, "raw webhook secret must not be persisted")
    require(data.get("raw_stripe_key_persisted") is False, "raw Stripe key must not be persisted")
    require(data.get("webhook_signature_persisted") is False, "raw webhook signature must not be persisted")
    require(data.get("raw_stripe_payload_persisted") is False, "raw Stripe payload must not be persisted")

    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list) and blocked_checks, "blocked evidence must include blocked_checks")
    if allow_local_devport:
        require(
            blocked_checks == ["local_devport_debug_evidence_cannot_clear_staging_gate"],
            "local-devport Stripe evidence must only be blocked by debug gate policy",
        )
        require(data.get("local_devport_debug") is True, "local-devport evidence must mark local_devport_debug")
    else:
        require(data.get("local_devport_debug") is not True, "canonical blocked evidence must not be local-devport debug")
        require("production_like_staging_url_required" in blocked_checks, "canonical blocked evidence must preserve staging URL blocker")

    readiness = data.get("runtime_input_readiness")
    require(isinstance(readiness, dict), "runtime_input_readiness must be object")
    for key in ("staging_api_url_ready", "user_auth_ready", "admin_auth_ready", "csrf_ready", "stripe_cli_ready", "webhook_forwarding_ready"):
        require(key in readiness, f"runtime_input_readiness.{key} must be present")
    if allow_local_devport:
        require(readiness.get("allow_local_devport_evidence") is True, "local-devport readiness flag must be true")
        require(readiness.get("canonical_pass_path") is False, "local-devport evidence must not claim canonical pass path")
    else:
        require(readiness.get("allow_local_devport_evidence") is not True, "canonical blocked evidence must not allow local-devport evidence")
        require(readiness.get("canonical_pass_path") is True, "canonical blocked evidence must identify canonical path")

    scenarios = scenario_map(data)
    for scenario_id in REQUIRED_SCENARIOS:
        scenario = scenarios[scenario_id]
        require(scenario.get("livemode") is False, f"{scenario_id} livemode must be false")
        require(non_empty(scenario.get("request_id")), f"{scenario_id} request_id is required")
        require(scenario.get("secret_leak_detected") is False, f"{scenario_id} secret_leak_detected must be false")

    by_id = {row.get("scenario_id") or row.get("check_id"): row for row in rows}
    require(REQUIRED_RESULTS <= set(by_id), f"results missing rows {sorted(REQUIRED_RESULTS - set(by_id))}")
    for scenario_id in REQUIRED_RESULTS:
        row = by_id[scenario_id]
        require(row.get("livemode") is False, f"result {scenario_id} livemode must be false")
        require(row.get("secret_leak_detected") is False, f"result {scenario_id} secret_leak_detected must be false")
        require(non_empty(row.get("request_id")) or non_empty(row.get("evidence_ref")), f"result {scenario_id} request_id or evidence_ref required")

    gate_impact = data.get("gate_impact")
    require(isinstance(gate_impact, dict), "gate_impact must be object")
    require(gate_impact.get("can_clear_stripe_staging_gate") is False, "blocked Stripe evidence cannot clear staging gate")
    require(
        gate_impact.get("preserved_release_gate_check_id") == "stage1_stripe_test_checkout_webhook",
        "blocked Stripe evidence must preserve Stripe release gate",
    )
    require(
        gate_impact.get("preserved_do_not_launch_condition_id") == "stripe_staging_lifecycle_runtime_missing",
        "blocked Stripe evidence must preserve do-not-launch condition",
    )
    require(isinstance(gate_impact.get("remaining_blockers"), list) and gate_impact["remaining_blockers"], "blocked evidence must list remaining blockers")

    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "probe_contract must be object")
    require(
        probe_contract.get("canonical_pass_report") == "ops/evidence/staging/stripe-test-checkout-webhook.json",
        "probe_contract canonical report path mismatch",
    )
    require(
        probe_contract.get("canonical_pass_results") == "ops/evidence/staging/stripe-test-checkout-webhook.ndjson",
        "probe_contract canonical results path mismatch",
    )
    require(
        probe_contract.get("local_devport_report")
        == "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.json",
        "probe_contract local-devport report path mismatch",
    )
    require(
        probe_contract.get("local_devport_results")
        == "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.ndjson",
        "probe_contract local-devport results path mismatch",
    )
    require(
        "cannot clear staging gates" in str(probe_contract.get("allow_local_devport_evidence_env") or ""),
        "probe_contract must state local-devport evidence cannot clear staging gates",
    )
    fixture_command = str(probe_contract.get("production_like_local_fixture_command") or "")
    for token in (
        "API_URL_RESOLVE_ADDR=127.0.0.1",
        "API_URL_CA_CERT=<self-signed-ca.pem>",
        "WEB_URL_RESOLVE_ADDR=127.0.0.1",
        "WEB_URL_CA_CERT=<self-signed-ca.pem>",
        "ADMIN_URL_RESOLVE_ADDR=127.0.0.1",
        "ADMIN_URL_CA_CERT=<self-signed-ca.pem>",
    ):
        require(token in fixture_command, f"probe_contract production-like fixture command must include {token}")


def validate_evidence(path: Path, results_path: Path, allow_local_devport: bool = False) -> None:
    data = load_json(path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "evidence")
    assert_no_secret(rows, "results")
    require_no_livemode_true(data)
    require_no_livemode_true(rows)

    if data.get("status") == "blocked":
        validate_blocked_probe_evidence(data, rows, allow_local_devport=allow_local_devport)
        if allow_local_devport:
            return
        raise StripeEvidenceError("canonical Stripe staging pass evidence is still missing; blocked probe evidence cannot clear staging gate")

    require(data.get("schema_version") == "stage1.stripe_staging_lifecycle.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "environment must be staging")
    require(data.get("kind") == "stripe_test_checkout_webhook", "kind mismatch")
    if allow_local_devport:
        require(data.get("status") == "blocked", "local-devport Stripe evidence must stay blocked")
        require(data.get("local_devport_debug") is True, "local-devport evidence must mark local_devport_debug")
        require(
            data.get("blocked_checks") == ["local_devport_debug_evidence_cannot_clear_staging_gate"],
            "local-devport Stripe evidence must only be blocked by debug gate policy",
        )
    else:
        require(data.get("status") == "pass", "status must be pass")
        require(data.get("local_devport_debug") is not True, "strict staging evidence must not be local-devport debug")
    require(data.get("stripe_mode") == "test", "stripe_mode must be test")
    require(data.get("livemode") is False, "top-level livemode must be false")
    validate_production_like_staging_url(data.get("api_url"), "api_url", allow_local_devport)
    validate_production_like_staging_url(data.get("web_url"), "web_url", allow_local_devport)
    require(data.get("secret_material_present") is True, "evidence must prove secret material was configured by presence only")
    require(data.get("secret_material_persisted") is False, "secret material must not be persisted")
    require(data.get("raw_webhook_secret_persisted") is False, "raw webhook secret must not be persisted")
    require(data.get("raw_stripe_key_persisted") is False, "raw Stripe key must not be persisted")
    require(data.get("webhook_signature_persisted") is False, "raw webhook signature must not be persisted")
    require(data.get("raw_stripe_payload_persisted") is False, "raw Stripe payload must not be persisted")

    readiness = data.get("runtime_input_readiness")
    require(isinstance(readiness, dict), "runtime_input_readiness must be object")
    for key in ("staging_api_url_ready", "user_auth_ready", "admin_auth_ready", "csrf_ready", "stripe_cli_ready", "webhook_forwarding_ready"):
        require(readiness.get(key) is True, f"runtime_input_readiness.{key} must be true")
    if allow_local_devport:
        require(readiness.get("allow_local_devport_evidence") is True, "local-devport readiness flag must be true")
        require(readiness.get("canonical_pass_path") is False, "local-devport evidence must not claim canonical pass path")
    else:
        require(readiness.get("allow_local_devport_evidence") is not True, "strict staging evidence must not allow local-devport evidence")

    scenarios = scenario_map(data)
    for scenario_id, scenario in scenarios.items():
        if scenario_id in REQUIRED_SCENARIOS:
            require_scenario_pass(scenario, scenario_id)

    validate_checkout(scenarios["checkout_session_created"])
    validate_event_scenario(
        scenarios["checkout_completed_paid"],
        "checkout_completed_paid",
        {"checkout.session.completed"},
        {"active", "trialing"},
    )
    validate_invoice_paid(scenarios["invoice_paid"])
    validate_payment_failed(scenarios["invoice_payment_failed"])
    validate_cancel_at_period_end(scenarios["cancel_at_period_end"])
    validate_subscription_cancelled(scenarios["subscription_cancelled"])
    validate_refund_credit(scenarios["refund_credit"])
    validate_replay(scenarios["webhook_replay_idempotency"])
    validate_quota_projection(scenarios["quota_projection"])
    validate_invoice_visibility(scenarios["invoice_receipt_visibility"])
    validate_results(rows)

    summary = data.get("summary")
    require(isinstance(summary, dict), "summary must be object")
    require(summary.get("checkout_created") is True, "summary.checkout_created must be true")
    require(summary.get("webhook_replay_idempotent") is True, "summary.webhook_replay_idempotent must be true")
    require(summary.get("refund_credit_reconciled") is True, "summary.refund_credit_reconciled must be true")
    require(summary.get("invoice_receipt_visible") is True, "summary.invoice_receipt_visible must be true")
    statuses = set(summary.get("subscription_statuses") or [])
    require({"active", "past_due"} <= statuses, "summary must include active and past_due statuses")
    require({"cancelled", "canceled", "cancel_at_period_end"} & statuses, "summary must include cancelled/cancel_at_period_end status")

    gate_impact = data.get("gate_impact")
    require(isinstance(gate_impact, dict), "gate_impact must be object")
    if allow_local_devport:
        require(gate_impact.get("can_clear_stripe_staging_gate") is False, "local-devport Stripe evidence cannot clear staging gate")
        require(
            gate_impact.get("preserved_release_gate_check_id") == "stage1_stripe_test_checkout_webhook",
            "local-devport Stripe evidence must preserve Stripe release gate",
        )
    else:
        require(gate_impact.get("can_clear_stripe_staging_gate") is True, "strict pass evidence must clear Stripe staging gate")

    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "probe_contract must be object")
    require(
        probe_contract.get("local_devport_report")
        == "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.json",
        "probe_contract local-devport report path mismatch",
    )
    require(
        probe_contract.get("local_devport_results")
        == "ops/evidence/staging/local-devport/stripe-test-checkout-webhook.local-devport.ndjson",
        "probe_contract local-devport results path mismatch",
    )
    require(
        "cannot clear staging gates" in str(probe_contract.get("allow_local_devport_evidence_env") or ""),
        "probe_contract must state local-devport evidence cannot clear staging gates",
    )
    fixture_command = str(probe_contract.get("production_like_local_fixture_command") or "")
    for token in (
        "API_URL_RESOLVE_ADDR=127.0.0.1",
        "API_URL_CA_CERT=<self-signed-ca.pem>",
        "WEB_URL_RESOLVE_ADDR=127.0.0.1",
        "WEB_URL_CA_CERT=<self-signed-ca.pem>",
        "ADMIN_URL_RESOLVE_ADDR=127.0.0.1",
        "ADMIN_URL_CA_CERT=<self-signed-ca.pem>",
    ):
        require(token in fixture_command, f"probe_contract production-like fixture command must include {token}")


def validate_contract_only() -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract fixture and code anchors only")
    parser.add_argument("--allow-local-devport", action="store_true", help="allow localhost/private dev-port URLs for local debugging evidence")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="Stripe staging evidence JSON path")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="Stripe staging NDJSON result path")
    args = parser.parse_args()

    try:
        validate_contract_only()
        if not args.contract_only:
            evidence_path = DEFAULT_LOCAL_EVIDENCE if args.allow_local_devport and args.evidence == str(DEFAULT_EVIDENCE) else Path(args.evidence)
            results_path = DEFAULT_LOCAL_RESULTS if args.allow_local_devport and args.results == str(DEFAULT_RESULTS) else Path(args.results)
            validate_evidence(evidence_path, results_path, allow_local_devport=args.allow_local_devport)
    except StripeEvidenceError as exc:
        print(f"stage1 Stripe staging evidence validation failed: {exc}", file=sys.stderr)
        return 1

    if args.contract_only:
        print("stage1 Stripe staging evidence contract passed")
    else:
        print("stage1 Stripe staging evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
