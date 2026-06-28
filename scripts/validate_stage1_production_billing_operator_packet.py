#!/usr/bin/env python3
"""Validate the non-clearing production billing operator packet."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-billing-operator-packet.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_production_billing_operator_packet.py"
LIVE_PROOF_HELPER = ROOT / "scripts" / "stage1_stripe_live_billing_proof.py"
LIVE_PROOF_VALIDATOR = ROOT / "scripts" / "validate_stage1_stripe_live_billing_proof.py"
SOURCE_PROBE = ROOT / "scripts" / "stage1_production_source_probe.py"
BILLING_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_billing_evidence.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

REQUIRED_ARTIFACT_NAMES = [
    "checkout_session_id",
    "checkout_customer_id",
    "price_id",
    "active_subscription_id",
    "active_customer_id",
    "past_due_subscription_id",
    "past_due_invoice_id",
    "cancel_subscription_id",
    "subscription_item_id",
    "visible_invoice_id",
    "refund_charge_id",
    "refund_id",
    "quota_reset_invoice_id",
    "failed_export_refund_id",
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

OPERATOR_COMMAND_STEPS = [
    "run_private_env_proof_bundle",
    "validate_live_billing_candidate_or_diagnostic",
    "run_billing_source_probe_after_candidate_passes",
    "generate_strict_billing_evidence",
    "validate_strict_billing_evidence",
    "refresh_non_clearing_summary",
]

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


class BillingOperatorPacketValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise BillingOperatorPacketValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise BillingOperatorPacketValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def require_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty string")
    return value.strip()


def string_list(value: Any, path: str) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    result: list[str] = []
    for idx, item in enumerate(value):
        result.append(require_string(item, f"{path}[{idx}]"))
    return result


def validate_code_anchors() -> None:
    require_text(
        GENERATOR,
        (
            "stage1.production_billing_operator_packet.v1",
            "production-billing-operator-packet.json",
            "production_paid_billing_lifecycle",
            "checkout_session_id",
            "webhook_event_ids",
            "sandbox_scope",
            "sandbox_can_clear_production_live_billing",
            "stage1_stripe_live_billing_proof.py",
            "stage1_production_source_probe.py --billing",
        ),
    )
    require_text(
        LIVE_PROOF_HELPER,
        (
            "STRIPE_MODE_must_be_live",
            "STRIPE_SECRET_KEY_or_STRIPE_API_KEY_must_be_live",
            "checkout_session_id",
            "webhook_idempotency",
            "stage1.production_live_billing_proof.v1",
        ),
    )
    require_text(LIVE_PROOF_VALIDATOR, ("REQUIRED_LIFECYCLE", "REQUIRED_REFUND", "stripe_mode must be live"))
    require_text(SOURCE_PROBE, ("build_billing_source", "--billing-proof", "billing proof livemode must be true"))
    require_text(BILLING_VALIDATOR, ("LIFECYCLE_SECTIONS", "REFUND_SECTIONS", "invite_comp_only_substitute"))
    require_text(
        REPO_VALIDATE,
        (
            "generate_stage1_production_billing_operator_packet.py --contract-only",
            "validate_stage1_production_billing_operator_packet.py --contract-only",
            "production-billing-operator-packet.json",
        ),
    )


def validate_packet(data: dict[str, Any]) -> None:
    assert_no_secret(data, "billing_operator_packet")
    require(data.get("schema_version") == "stage1.production_billing_operator_packet.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_billing_operator_packet", "kind mismatch")
    require(data.get("status") == "blocked", "operator packet must remain blocked")
    require(data.get("release_gate_check_id") == "production_paid_billing_lifecycle", "release gate check mismatch")
    require(data.get("release_gate_decision") == "no_go", "operator packet must remain no_go")
    require(data.get("non_clearing_operator_packet") is True, "non_clearing_operator_packet must be true")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_production_paid_billing_lifecycle") is False, "cannot clear billing")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    env = data.get("local_env_classification")
    require(isinstance(env, dict), "local_env_classification must be object")
    for key in ("stripe_mode", "secret_key_class", "publishable_key_class", "webhook_secret_class"):
        require_string(env.get(key), f"local_env_classification.{key}")
    require(isinstance(env.get("live_secret_configured"), bool), "live_secret_configured must be bool")
    sandbox = data.get("sandbox_scope")
    require(isinstance(sandbox, dict), "sandbox_scope must be object")
    require(
        sandbox.get("stripe_mode") == env.get("stripe_mode"),
        "sandbox_scope.stripe_mode must mirror local_env_classification",
    )
    require(
        sandbox.get("secret_key_class") == env.get("secret_key_class"),
        "sandbox_scope.secret_key_class must mirror local_env_classification",
    )
    require(
        sandbox.get("publishable_key_class") == env.get("publishable_key_class"),
        "sandbox_scope.publishable_key_class must mirror local_env_classification",
    )
    require(
        isinstance(sandbox.get("stripe_sandbox_or_test_config_detected"), bool),
        "sandbox_scope.stripe_sandbox_or_test_config_detected must be bool",
    )
    require(
        sandbox.get("sandbox_can_clear_production_live_billing") is False,
        "sandbox_scope.sandbox_can_clear_production_live_billing must be false",
    )
    live_requires = string_list(sandbox.get("live_billing_requires"), "sandbox_scope.live_billing_requires")
    require("STRIPE_MODE=live" in live_requires, "sandbox_scope.live_billing_requires must include STRIPE_MODE=live")
    require(
        any("sk_live_" in item and "rk_live_" in item for item in live_requires),
        "sandbox_scope.live_billing_requires must mention live Stripe key shapes",
    )
    operator_note = require_string(sandbox.get("operator_note"), "sandbox_scope.operator_note")
    require(
        "cannot clear the production_paid_billing_lifecycle gate" in operator_note,
        "sandbox_scope.operator_note must preserve non-clearing billing boundary",
    )
    prereq = data.get("live_mode_prerequisites")
    require(isinstance(prereq, dict), "live_mode_prerequisites must be object")
    require(prereq.get("stripe_mode_must_be_live") is True, "stripe mode live prerequisite missing")
    require(prereq.get("secret_key_must_be_live") is True, "secret key live prerequisite missing")
    require(prereq.get("publishable_key_must_be_live_when_set") is True, "publishable key live prerequisite missing")
    require(
        prereq.get("stripe_sandbox_or_test_config_detected")
        == sandbox.get("stripe_sandbox_or_test_config_detected"),
        "live_mode_prerequisites sandbox detection must mirror sandbox_scope",
    )
    require(
        prereq.get("sandbox_can_clear_production_live_billing") is False,
        "live_mode_prerequisites sandbox clear flag must be false",
    )
    require(prereq.get("sandbox_or_test_artifacts_allowed") is False, "sandbox artifacts must be disallowed")
    require(prereq.get("comp_only_substitute_allowed") is False, "comp-only substitute must be disallowed")

    artifacts = data.get("required_live_artifacts")
    require(isinstance(artifacts, list), "required_live_artifacts must be list")
    require(len(artifacts) == len(REQUIRED_ARTIFACT_NAMES), "required_live_artifacts length mismatch")
    seen: list[str] = []
    for idx, item in enumerate(artifacts):
        require(isinstance(item, dict), f"required_live_artifacts[{idx}] must be object")
        name = require_string(item.get("name"), f"required_live_artifacts[{idx}].name")
        seen.append(name)
        require(name in REQUIRED_ARTIFACT_NAMES, f"unexpected artifact {name}")
        flag = require_string(item.get("flag"), f"{name}.flag")
        require(flag.startswith("--"), f"{name}.flag must be CLI flag")
        require_string(item.get("prefix"), f"{name}.prefix")
        require_string(item.get("section"), f"{name}.section")
    require(seen == REQUIRED_ARTIFACT_NAMES, "required_live_artifacts order mismatch")

    numeric = data.get("required_numeric_controls")
    require(isinstance(numeric, list) and len(numeric) == 5, "required_numeric_controls mismatch")
    webhook = data.get("required_webhook_controls")
    require(isinstance(webhook, dict), "required_webhook_controls must be object")
    require(webhook.get("replay_delivery_mutations") == 0, "webhook replay mutation rule mismatch")
    require(webhook.get("duplicate_mutation_count") == 0, "webhook duplicate mutation rule mismatch")
    require(webhook.get("idempotency_verified") is True, "webhook idempotency rule mismatch")
    refs = data.get("required_audit_refs")
    require(isinstance(refs, list) and "--webhook-idempotency-ref" in refs, "required_audit_refs incomplete")

    private_env = data.get("private_env_template")
    require(isinstance(private_env, dict), "private_env_template must be object")
    require(private_env.get("path_placeholder") == "<private-production-env>", "private_env_template placeholder mismatch")
    require(private_env.get("gitignore_required") is True, "private_env_template must require gitignore")
    require(private_env.get("blank_values_only") is True, "private_env_template must be blank-values-only")
    allowed_variables = string_list(private_env.get("allowed_variable_names"), "private_env_template.allowed_variable_names")
    require(allowed_variables == BILLING_ENV_VARIABLES, "private_env_template allowed variables mismatch")
    template_lines = string_list(private_env.get("template_lines"), "private_env_template.template_lines")
    require(template_lines == [f"{name}=" for name in BILLING_ENV_VARIABLES], "private_env_template lines must be blank assignments")

    proof = data.get("live_proof")
    require(isinstance(proof, dict), "live_proof must be object")
    require(proof.get("candidate_path") == "ops/evidence/non_clearing/production-live-billing-proof.candidate.json", "proof candidate path mismatch")
    blocked = proof.get("blocked_diagnostic")
    require(isinstance(blocked, dict), "live_proof.blocked_diagnostic must be object")
    blocked_path = require_string(blocked.get("path"), "blocked diagnostic path")
    require(
        blocked_path == "ops/evidence/non_clearing/production-live-billing-proof.blocked.json"
        or blocked_path.endswith("/production-live-billing-proof.blocked.json"),
        "blocked diagnostic path mismatch",
    )
    require(isinstance(blocked.get("exists"), bool), "blocked diagnostic exists must be bool")
    require_string(blocked.get("first_blocker"), "blocked diagnostic first_blocker")
    require("stage1_stripe_live_billing_proof.py" in require_string(proof.get("proof_generator_command"), "proof_generator_command"), "proof generator command mismatch")
    require("validate_stage1_stripe_live_billing_proof.py" in require_string(proof.get("proof_validator_command"), "proof_validator_command"), "proof validator command mismatch")

    source = data.get("source_probe")
    require(isinstance(source, dict), "source_probe must be object")
    require(source.get("canonical_source_path") == "ops/evidence/production/billing-paid-lifecycle-source.json", "source path mismatch")
    require(isinstance(source.get("canonical_source_exists"), bool), "canonical_source_exists must be bool")
    require("stage1_production_source_probe.py --billing" in require_string(source.get("source_probe_command"), "source_probe_command"), "source probe command mismatch")
    diagnostic = source.get("source_diagnostic")
    require(isinstance(diagnostic, dict), "source_diagnostic must be object")
    require(diagnostic.get("path") == "ops/evidence/production/source-probe-diagnostics.billing.json", "source diagnostic path mismatch")
    require(isinstance(diagnostic.get("exists"), bool), "source diagnostic exists must be bool")
    require_string(diagnostic.get("first_blocker"), "source diagnostic first_blocker")

    for key in ("blocked_until", "execution_order"):
        values = data.get(key)
        require(isinstance(values, list) and values, f"{key} must be non-empty list")
        for idx, value in enumerate(values):
            require(isinstance(value, str) and value.strip(), f"{key}[{idx}] must be non-empty string")
    require(
        "Stripe sandbox/test configuration is replaced with production live-mode billing proof inputs"
        in data["blocked_until"],
        "blocked_until must require replacing sandbox/test billing config with live proof inputs",
    )
    order = "\n".join(data["execution_order"])
    for token in (
        "stage1_stripe_live_billing_proof.py",
        "validate_stage1_stripe_live_billing_proof.py",
        "stage1_production_source_probe.py --billing",
        "generate_stage1_production_billing_evidence.py",
        "validate_stage1_production_billing_evidence.py",
    ):
        require(token in order, f"execution_order missing {token}")

    operator_commands = data.get("operator_command_packet")
    require(isinstance(operator_commands, list) and len(operator_commands) == len(OPERATOR_COMMAND_STEPS), "operator_command_packet step count mismatch")
    seen_steps: list[str] = []
    for idx, row in enumerate(operator_commands):
        require(isinstance(row, dict), f"operator_command_packet[{idx}] must be object")
        step_id = require_string(row.get("step_id"), f"operator_command_packet[{idx}].step_id")
        seen_steps.append(step_id)
        command = require_string(row.get("command"), f"operator_command_packet[{idx}].command")
        side_effect = require_string(row.get("side_effect"), f"operator_command_packet[{idx}].side_effect")
        require(isinstance(row.get("may_write_canonical_source"), bool), f"operator_command_packet[{idx}].may_write_canonical_source must be bool")
        require(isinstance(row.get("requires_review"), bool), f"operator_command_packet[{idx}].requires_review must be bool")
        require("sk_live_" not in command and "rk_live_" not in command, f"operator_command_packet[{idx}] must not inline Stripe key")
        if step_id == "run_private_env_proof_bundle":
            require("<private-production-env>" in command, "proof bundle step must use private env placeholder")
            require("run_stage1_production_proof_bundle.py" in command, "proof bundle step must use bundle runner")
        if row["may_write_canonical_source"]:
            require(step_id == "run_billing_source_probe_after_candidate_passes", "only billing source probe may write canonical source")
            require("--write-canonical-source" in command, "canonical write step must be explicit")
            require(row["requires_review"] is True, "canonical write step must require review")
            require("after live billing proof passes" in side_effect, "canonical write side effect must be gated")
        else:
            require("--write-canonical-source" not in command, f"{step_id} must not write canonical source")
            require(row["requires_review"] is False, f"{step_id} review flag mismatch")
    require(seen_steps == OPERATOR_COMMAND_STEPS, "operator_command_packet order mismatch")

    outputs = data.get("evidence_outputs")
    require(isinstance(outputs, dict), "evidence_outputs must be object")
    for key in ("live_proof_candidate", "live_proof_diagnostic", "source", "source_diagnostic", "lifecycle", "refund_credit_webhook"):
        require_string(outputs.get(key), f"evidence_outputs.{key}")

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("preserved_release_gate_check_id") == "production_paid_billing_lifecycle", "gate preservation mismatch")
    for key, value in gate.items():
        if key.startswith("can_clear_"):
            require(value is False, f"gate_impact.{key} must be false")


def run_sandbox_scope_selftest() -> None:
    with tempfile.TemporaryDirectory(prefix="zenari-billing-packet-") as tmp:
        tmpdir = Path(tmp)
        env_path = tmpdir / ".env"
        packet_path = tmpdir / "packet.json"
        env_path.write_text(
            "\n".join(
                (
                    "STRIPE_MODE=test",
                    "STRIPE_SECRET_KEY=sk_test_placeholder",
                    "STRIPE_PUBLISHABLE_KEY=pk_test_placeholder",
                    "STRIPE_WEBHOOK_SECRET=whsec_placeholder",
                    "",
                )
            ),
            encoding="utf-8",
        )
        child_env = {
            key: value
            for key, value in dict(os.environ).items()
            if key not in set(BILLING_ENV_VARIABLES) | {"STRIPE_WEBHOOK_SECRET", "BILLING_WEBHOOK_SECRET"}
        }
        result = subprocess.run(
            [
                sys.executable,
                str(GENERATOR),
                "--env-file",
                str(env_path),
                "--output",
                str(packet_path),
            ],
            cwd=ROOT,
            env=child_env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(
            result.returncode == 0,
            f"sandbox_scope selftest generator failed: {result.stderr.strip() or result.stdout.strip()}",
        )
        packet = load_json(packet_path)
        validate_packet(packet)
        sandbox = packet.get("sandbox_scope", {})
        require(
            sandbox.get("stripe_sandbox_or_test_config_detected") is True,
            "sandbox_scope selftest must detect Stripe test config",
        )
        require(
            sandbox.get("sandbox_can_clear_production_live_billing") is False,
            "sandbox_scope selftest must keep production billing non-clearing",
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", type=Path, default=DEFAULT_PACKET)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.contract_only:
            validate_code_anchors()
            print("stage1 production billing operator packet contract passed")
            return 0
        run_sandbox_scope_selftest()
        validate_packet(load_json(args.packet))
    except BillingOperatorPacketValidationError as exc:
        raise SystemExit(f"stage1 production billing operator packet validation failed: {exc}") from exc
    print("stage1 production billing operator packet validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
