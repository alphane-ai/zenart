#!/usr/bin/env python3
"""Validate the non-clearing production legal/support operator packet."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-legal-support-operator-packet.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_production_legal_support_operator_packet.py"
SOURCE_PROBE = ROOT / "scripts" / "stage1_production_source_probe.py"
DNS_READINESS = ROOT / "scripts" / "stage1_production_dns_readiness.py"
DNS_CUTOVER_PLAN = ROOT / "scripts" / "stage1_production_dns_cutover_plan.py"
LEGAL_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_legal_support_evidence.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

REQUIRED_PAGE_IDS = [
    "terms",
    "privacy",
    "acceptable_use",
    "ai_content_disclaimer",
    "ip_complaint",
    "support_contact",
    "report_problem",
    "billing_policy",
    "support_sla",
]

OPERATOR_COMMAND_STEPS = [
    "plan_dns_cutover_with_private_env",
    "verify_cloudflare_scope_before_apply",
    "apply_dns_cutover_after_review",
    "refresh_dns_readiness",
    "run_legal_support_source_probe_after_https_passes",
    "generate_strict_legal_support_evidence",
    "validate_strict_legal_support_evidence",
    "refresh_production_launch_evidence",
    "validate_production_launch_evidence",
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
    "stripe-signature",
    "stripe_signature",
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


class LegalSupportOperatorPacketValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise LegalSupportOperatorPacketValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise LegalSupportOperatorPacketValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def validate_code_anchors() -> None:
    require_text(
        GENERATOR,
        (
            "stage1.production_legal_support_operator_packet.v1",
            "production-legal-support-operator-packet.json",
            "production_legal_support_policy",
            "https://zenari.ai",
            "support_sla",
            "stage1_production_source_probe.py --legal-support",
            "stage1_production_dns_cutover_plan.py",
            "--env <private-production-env>",
            "--verify-cloudflare",
            "operator_command_packet",
            "production-dns-cutover-plan.json",
            "validate_stage1_production_legal_support_evidence.py",
        ),
    )
    require_text(
        SOURCE_PROBE,
        (
            "LEGAL_PAGES",
            "SUPPORT_PAGES",
            "support_contact",
            "billing_policy",
            "ensure_production_https_base",
            "ensure_host_resolves",
        ),
    )
    require_text(DNS_READINESS, ("LEGAL_PATHS", "/legal/terms", "/legal/billing-policy", "/report-problem"))
    require_text(DNS_CUTOVER_PLAN, ("stage1.production_dns_cutover_plan.v1", "zenari.ai", "www.zenari.ai"))
    require_text(LEGAL_VALIDATOR, ("LEGAL_PAGES", "SUPPORT_PAGES", "support_sla", "paid_launch_policy_alignment"))
    require_text(
        REPO_VALIDATE,
        (
            "generate_stage1_production_legal_support_operator_packet.py --contract-only",
            "validate_stage1_production_legal_support_operator_packet.py --contract-only",
            "production-legal-support-operator-packet.json",
        ),
    )


def validate_required_paths(data: dict[str, Any]) -> None:
    rows = data.get("required_public_paths")
    require(isinstance(rows, list), "required_public_paths must be list")
    require(len(rows) == len(REQUIRED_PAGE_IDS), "required_public_paths length mismatch")
    seen: list[str] = []
    for idx, row in enumerate(rows):
        require(isinstance(row, dict), f"required_public_paths[{idx}] must be object")
        page_id = require_string(row.get("page_id"), f"required_public_paths[{idx}].page_id")
        seen.append(page_id)
        require(page_id in REQUIRED_PAGE_IDS, f"unexpected page id {page_id}")
        require(row.get("group") in {"legal", "support_billing"}, f"{page_id}.group mismatch")
        path = require_string(row.get("path"), f"{page_id}.path")
        require(path.startswith("/"), f"{page_id}.path must be absolute")
        require(row.get("method") == "GET", f"{page_id}.method must be GET")
        require(row.get("expected_http_status") == 200, f"{page_id}.expected_http_status must be 200")
        require(row.get("visibility") == "public", f"{page_id}.visibility must be public")
        require(row.get("external_user_visible") is True, f"{page_id}.external_user_visible must be true")
        require(row.get("admin_session_required") is False, f"{page_id}.admin_session_required must be false")
        tokens = row.get("required_tokens")
        require(isinstance(tokens, list) and len(tokens) >= 2, f"{page_id}.required_tokens must be specific")
        for token in tokens:
            require(isinstance(token, str) and token.strip(), f"{page_id}.required_tokens contains empty token")
    require(seen == REQUIRED_PAGE_IDS, "required_public_paths order mismatch")


def validate_packet(data: dict[str, Any]) -> None:
    assert_no_secret(data, "legal_support_operator_packet")
    require(data.get("schema_version") == "stage1.production_legal_support_operator_packet.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_legal_support_operator_packet", "kind mismatch")
    require(data.get("status") == "blocked", "operator packet must remain blocked")
    require(data.get("release_gate_check_id") == "production_legal_support_policy", "release gate check mismatch")
    require(data.get("release_gate_decision") == "no_go", "operator packet must remain no_go")
    require(data.get("production_web_url") == "https://zenari.ai", "production_web_url mismatch")
    require(data.get("non_clearing_operator_packet") is True, "non_clearing_operator_packet must be true")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_production_legal_support_policy") is False, "cannot clear legal/support")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    dns = data.get("dns_readiness")
    require(isinstance(dns, dict), "dns_readiness must be object")
    require(dns.get("path") == "ops/evidence/non_clearing/production-dns-readiness.json", "dns readiness path mismatch")
    require(dns.get("status") in {"missing", "blocked", "pass"}, "dns readiness status mismatch")
    require(dns.get("production_web_url") == "https://zenari.ai", "dns production_web_url mismatch")
    require_string(dns.get("first_blocker"), "dns_readiness.first_blocker")
    require(isinstance(dns.get("https_pass_count"), int), "dns_readiness.https_pass_count must be int")
    require(isinstance(dns.get("https_total"), int), "dns_readiness.https_total must be int")
    require(isinstance(dns.get("production_paths"), list), "dns_readiness.production_paths must be list")

    source = data.get("source_probe")
    require(isinstance(source, dict), "source_probe must be object")
    require(source.get("canonical_source_path") == "ops/evidence/production/production-legal-support-source.json", "source path mismatch")
    require(isinstance(source.get("canonical_source_exists"), bool), "canonical_source_exists must be bool")
    require("stage1_production_source_probe.py --legal-support" in require_string(source.get("source_probe_command"), "source_probe.source_probe_command"), "source probe command mismatch")
    diagnostic = source.get("source_diagnostic")
    require(isinstance(diagnostic, dict), "source_probe.source_diagnostic must be object")
    require(diagnostic.get("path") == "ops/evidence/production/source-probe-diagnostics.legal-support.json", "source diagnostic path mismatch")
    require(isinstance(diagnostic.get("exists"), bool), "source diagnostic exists must be bool")
    require_string(diagnostic.get("first_blocker"), "source diagnostic first_blocker")

    dns_https = data.get("required_dns_and_https")
    require(isinstance(dns_https, dict), "required_dns_and_https must be object")
    require(dns_https.get("apex_host") == "zenari.ai", "apex host mismatch")
    require(dns_https.get("allowed_public_url") == "https://zenari.ai", "allowed_public_url mismatch")
    disallowed = dns_https.get("disallowed_gate_inputs")
    require(isinstance(disallowed, list), "disallowed_gate_inputs must be list")
    for token in ("localhost", "127.0.0.1", "IP-only URL", "staging.zenari.ai"):
        require(token in disallowed, f"disallowed gate inputs missing {token}")
    require(dns_https.get("required_http_status") == 200, "required_http_status mismatch")
    cutover = data.get("dns_cutover_plan")
    require(isinstance(cutover, dict), "dns_cutover_plan must be object")
    require(cutover.get("path") == "ops/evidence/non_clearing/production-dns-cutover-plan.json", "dns cutover plan path mismatch")
    require(cutover.get("status") in {"missing", "blocked", "ready_to_apply", "applied", "observed_applied"}, "dns cutover plan status mismatch")
    require_string(cutover.get("first_blocker"), "dns_cutover_plan.first_blocker")

    validate_required_paths(data)

    for key in ("operator_next_actions", "blocked_until", "execution_order"):
        values = data.get(key)
        require(isinstance(values, list) and values, f"{key} must be non-empty list")
        for idx, value in enumerate(values):
            require(isinstance(value, str) and value.strip(), f"{key}[{idx}] must be non-empty string")
    order = "\n".join(data["execution_order"])
    for token in (
        "stage1_production_dns_readiness.py",
        "stage1_production_dns_cutover_plan.py",
        "--env <private-production-env>",
        "stage1_production_source_probe.py --legal-support",
        "generate_stage1_production_legal_support_evidence.py",
        "validate_stage1_production_legal_support_evidence.py",
    ):
        require(token in order, f"execution_order missing {token}")

    outputs = data.get("evidence_outputs")
    require(isinstance(outputs, dict), "evidence_outputs must be object")
    for key in ("source", "legal", "support_billing", "source_diagnostic", "dns_readiness", "dns_cutover_plan"):
        require_string(outputs.get(key), f"evidence_outputs.{key}")

    operator_commands = data.get("operator_command_packet")
    require(isinstance(operator_commands, list) and len(operator_commands) == len(OPERATOR_COMMAND_STEPS), "operator_command_packet step count mismatch")
    seen_steps: list[str] = []
    for idx, row in enumerate(operator_commands):
        require(isinstance(row, dict), f"operator_command_packet[{idx}] must be object")
        step_id = require_string(row.get("step_id"), f"operator_command_packet[{idx}].step_id")
        seen_steps.append(step_id)
        command = require_string(row.get("command"), f"operator_command_packet[{idx}].command")
        side_effect = require_string(row.get("side_effect"), f"operator_command_packet[{idx}].side_effect")
        require(isinstance(row.get("may_apply_production_dns"), bool), f"operator_command_packet[{idx}].may_apply_production_dns must be bool")
        require(isinstance(row.get("may_write_canonical_source"), bool), f"operator_command_packet[{idx}].may_write_canonical_source must be bool")
        require(isinstance(row.get("requires_review"), bool), f"operator_command_packet[{idx}].requires_review must be bool")

        if step_id in {"plan_dns_cutover_with_private_env", "verify_cloudflare_scope_before_apply", "apply_dns_cutover_after_review"}:
            require("stage1_production_dns_cutover_plan.py" in command, f"{step_id} must use DNS cutover plan")
            require("--env <private-production-env>" in command, f"{step_id} must use private env placeholder")
            require(".env" not in command, f"{step_id} must not use local .env")
        if step_id == "plan_dns_cutover_with_private_env":
            require("--apply" not in command, "DNS planning step must not apply")
            require(row["may_apply_production_dns"] is False, "DNS planning step must not apply production DNS")
            require(row["requires_review"] is False, "DNS planning step review flag mismatch")
        elif step_id == "verify_cloudflare_scope_before_apply":
            require("--verify-cloudflare" in command, "Cloudflare scope verify step must be explicit")
            require("--apply" not in command, "Cloudflare scope verify step must not apply")
            require(row["may_apply_production_dns"] is False, "Cloudflare scope verify step must not apply production DNS")
            require(row["requires_review"] is False, "Cloudflare scope verify step review flag mismatch")
            require("read-only Cloudflare zone and DNS permission preflight" in side_effect, "Cloudflare scope verify side effect mismatch")
        elif step_id == "apply_dns_cutover_after_review":
            require("--apply" in command, "DNS apply step must be explicit")
            require(row["may_apply_production_dns"] is True, "DNS apply step flag mismatch")
            require(row["requires_review"] is True, "DNS apply step must require review")
            require("applies reviewed production DNS cutover" in side_effect, "DNS apply side effect must be explicit")
        else:
            require(row["may_apply_production_dns"] is False, f"{step_id} must not apply production DNS")

        if row["may_write_canonical_source"]:
            require(
                step_id == "run_legal_support_source_probe_after_https_passes",
                "only legal/support source probe may write canonical source",
            )
            require("--write-canonical-source" in command, "canonical write step must be explicit")
            require("stage1_production_source_probe.py --legal-support" in command, "canonical write step must use legal/support source probe")
            require("--production-web-url https://zenari.ai" in command, "canonical write step must target https://zenari.ai")
            require(row["requires_review"] is True, "canonical write step must require review")
            require("after production DNS and HTTPS public pages pass" in side_effect, "canonical write side effect must be gated")
        else:
            require("--write-canonical-source" not in command, f"{step_id} must not write canonical source")
            if step_id != "apply_dns_cutover_after_review":
                require(row["requires_review"] is False, f"{step_id} review flag mismatch")
    require(seen_steps == OPERATOR_COMMAND_STEPS, "operator_command_packet order mismatch")

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("preserved_release_gate_check_id") == "production_legal_support_policy", "gate preservation mismatch")
    for key, value in gate.items():
        if key.startswith("can_clear_"):
            require(value is False, f"gate_impact.{key} must be false")


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
            print("stage1 production legal/support operator packet contract passed")
            return 0
        validate_packet(load_json(args.packet))
    except LegalSupportOperatorPacketValidationError as exc:
        raise SystemExit(f"stage1 production legal/support operator packet validation failed: {exc}") from exc
    print("stage1 production legal/support operator packet validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
