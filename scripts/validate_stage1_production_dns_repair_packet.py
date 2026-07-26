#!/usr/bin/env python3
"""Validate the non-clearing Stage 1 production DNS repair packet."""

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
DEFAULT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-repair-packet.json"
DEFAULT_OPERATOR_MARKDOWN = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-operator-checklist.md"
DEFAULT_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_DNS_CUTOVER_PLAN = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-cutover-plan.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
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
PRIVATE_ENV_ALLOWED_VARIABLES = [
    "PRODUCTION_DNS_TARGET",
    "CLOUDFLARE_ZONE_ID",
    "CF_ZONE_ID",
    "CLOUDFLARE_API_TOKEN",
    "CF_API_TOKEN",
]
R2_S3_ENV_KEYS = [
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
]
OPERATOR_COMMAND_STEPS = [
    "generate_plan_with_private_env",
    "validate_plan",
    "verify_cloudflare_scope",
    "apply_reviewed_dns",
    "wait_and_probe_dns",
    "regenerate_repair_packet",
    "validate_repair_packet",
    "refresh_non_clearing_summary",
]


class ProductionDnsRepairPacketValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionDnsRepairPacketValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionDnsRepairPacketValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionDnsRepairPacketValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def load_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ProductionDnsRepairPacketValidationError(f"missing {display_path(path)}") from exc


def normalize_ref(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


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
    require(isinstance(value, str) and value.strip(), f"{path} must be non-empty string")
    return value.strip()


def require_bool(value: Any, path: str) -> bool:
    require(isinstance(value, bool), f"{path} must be bool")
    return value


def require_int(value: Any, path: str) -> int:
    require(isinstance(value, int), f"{path} must be int")
    require(value >= 0, f"{path} must be non-negative")
    return value


def string_list(value: Any, path: str, *, min_len: int = 0) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    require(len(value) >= min_len, f"{path} must contain at least {min_len} items")
    result: list[str] = []
    for idx, item in enumerate(value):
        text = require_string(item, f"{path}[{idx}]")
        require(len(text) <= 700, f"{path}[{idx}] is too long")
        result.append(text)
    return result


def source_status(data: dict[str, Any], *keys: str) -> str:
    value: Any = data
    for key in keys:
        if not isinstance(value, dict):
            return "missing"
        value = value.get(key)
    return str(value.get("status", "missing")) if isinstance(value, dict) else "missing"


def source_addresses(data: dict[str, Any], *keys: str) -> list[str]:
    value: Any = data
    for key in keys:
        if not isinstance(value, dict):
            return []
        value = value.get(key)
    if not isinstance(value, dict):
        return []
    addresses = value.get("addresses")
    if not isinstance(addresses, list):
        return []
    return [str(item) for item in addresses if str(item).strip()]


def validate_packet(
    packet: dict[str, Any],
    dns_readiness: dict[str, Any],
    dns_cutover_plan: dict[str, Any],
    source_runbook: dict[str, Any],
    refs: dict[str, str],
) -> None:
    assert_no_secret(packet, "dns_repair_packet")
    require(packet.get("schema_version") == "stage1.production_dns_repair_packet.v1", "schema_version mismatch")
    require(packet.get("kind") == "stage1_production_dns_repair_packet", "kind mismatch")
    require(packet.get("environment") == "production", "environment mismatch")
    require(packet.get("status") in {"blocked", "ready_to_apply_non_clearing"}, "status mismatch")
    require(packet.get("release_gate_decision") == "no_go", "release_gate_decision must remain no_go")
    require(packet.get("non_clearing_repair_packet") is True, "non-clearing flag missing")
    require(packet.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(packet.get("can_apply_dns_changes") is False, "packet cannot apply DNS changes")
    require(packet.get("can_clear_production_legal_support_policy") is False, "packet cannot clear legal/support")
    require(packet.get("can_clear_stage1_production_launch_gate") is False, "packet cannot clear production launch")
    require(packet.get("can_close_do_not_launch") is False, "packet cannot close DNL")
    require(packet.get("production_web_url") == "https://zenari.ai", "production_web_url mismatch")
    for field in SAFE_FALSE_FIELDS:
        require(packet.get(field) is False, f"{field} must be false")
    source_refs = packet.get("source_refs")
    require(isinstance(source_refs, dict), "source_refs must be object")
    for key, value in refs.items():
        require(source_refs.get(key) == value, f"source_refs.{key} mismatch")

    summary = packet.get("summary")
    require(isinstance(summary, dict), "summary must be object")
    blocked_checks = string_list(packet.get("blocked_checks"), "blocked_checks", min_len=1 if packet.get("status") == "blocked" else 0)
    require(summary.get("dns_blocker_count") == len(blocked_checks), "summary.dns_blocker_count mismatch")
    require(summary.get("required_input_count") == 3, "summary.required_input_count mismatch")
    require(
        summary.get("production_system_resolver_status") == source_status(dns_readiness, "system_resolver", "production"),
        "production resolver status mismatch",
    )
    require(
        summary.get("staging_control_resolver_status") == source_status(dns_readiness, "system_resolver", "staging_control"),
        "staging resolver status mismatch",
    )
    require(
        summary.get("production_a_status") == source_status(dns_readiness, "authoritative_public_dns_probe", "production_a"),
        "production A status mismatch",
    )
    require(
        summary.get("production_aaaa_status") == source_status(dns_readiness, "authoritative_public_dns_probe", "production_aaaa"),
        "production AAAA status mismatch",
    )
    public_addresses = string_list(packet.get("public_production_addresses_observed"), "public_production_addresses_observed")
    source_public_addresses = [
        str(item)
        for item in dns_readiness.get("public_production_addresses_observed", [])
        if str(item).strip()
    ] if isinstance(dns_readiness.get("public_production_addresses_observed"), list) else []
    require(public_addresses == source_public_addresses, "public production address projection mismatch")
    require(summary.get("public_production_address_count") == len(public_addresses), "public production address count mismatch")
    doh_rows = packet.get("dns_over_https_probe_summary")
    require(isinstance(doh_rows, list) and len(doh_rows) == 6, "dns_over_https_probe_summary must contain six probes")
    expected_doh_ids = [
        "production_a_cloudflare",
        "production_aaaa_cloudflare",
        "production_a_google",
        "production_aaaa_google",
        "staging_a_cloudflare",
        "staging_a_google",
    ]
    for idx, row in enumerate(doh_rows):
        require(isinstance(row, dict), f"dns_over_https_probe_summary[{idx}] must be object")
        probe_id = require_string(row.get("probe_id"), f"dns_over_https_probe_summary[{idx}].probe_id")
        require(probe_id == expected_doh_ids[idx], f"dns_over_https_probe_summary[{idx}].probe_id order mismatch")
        require_string(row.get("resolver"), f"dns_over_https_probe_summary[{idx}].resolver")
        require_string(row.get("host"), f"dns_over_https_probe_summary[{idx}].host")
        require_string(row.get("rrtype"), f"dns_over_https_probe_summary[{idx}].rrtype")
        require(
            row.get("status") == source_status(dns_readiness, "dns_over_https_probe", probe_id),
            f"dns_over_https_probe_summary[{idx}].status source mismatch",
        )
        row_addresses = string_list(row.get("addresses"), f"dns_over_https_probe_summary[{idx}].addresses")
        require(
            row_addresses == source_addresses(dns_readiness, "dns_over_https_probe", probe_id),
            f"dns_over_https_probe_summary[{idx}].addresses source mismatch",
        )
        require(isinstance(row.get("error"), str), f"dns_over_https_probe_summary[{idx}].error must be string")
    cloudflare = dns_cutover_plan.get("cloudflare_zone") if isinstance(dns_cutover_plan.get("cloudflare_zone"), dict) else {}
    target = dns_cutover_plan.get("target") if isinstance(dns_cutover_plan.get("target"), dict) else {}
    require(summary.get("cloudflare_zone_id_configured") is bool(cloudflare.get("zone_id_configured")), "zone id status mismatch")
    require(summary.get("cloudflare_api_token_configured") is bool(cloudflare.get("api_token_configured")), "api token status mismatch")
    cutover_scope = dns_cutover_plan.get("credential_scope") if isinstance(dns_cutover_plan.get("credential_scope"), dict) else {}
    credential_scope = packet.get("credential_scope")
    require(isinstance(credential_scope, dict), "credential_scope must be object")
    require(
        summary.get("cloudflare_dns_credentials_configured") is bool(cutover_scope.get("cloudflare_dns_credentials_configured")),
        "summary.cloudflare_dns_credentials_configured mismatch",
    )
    require(summary.get("r2_s3_credentials_detected") is bool(cutover_scope.get("r2_s3_credentials_detected")), "summary.r2_s3_credentials_detected mismatch")
    require(summary.get("r2_s3_can_manage_dns") is False, "summary.r2_s3_can_manage_dns must be false")
    require(credential_scope.get("cloudflare_dns_credentials_configured") is bool(cutover_scope.get("cloudflare_dns_credentials_configured")), "credential_scope DNS flag mismatch")
    require(credential_scope.get("cloudflare_zone_id_configured") is bool(cutover_scope.get("cloudflare_zone_id_configured")), "credential_scope zone flag mismatch")
    require(credential_scope.get("cloudflare_api_token_configured") is bool(cutover_scope.get("cloudflare_api_token_configured")), "credential_scope token flag mismatch")
    require(credential_scope.get("r2_s3_credentials_detected") is bool(cutover_scope.get("r2_s3_credentials_detected")), "credential_scope R2 flag mismatch")
    r2_keys = string_list(credential_scope.get("r2_s3_present_keys"), "credential_scope.r2_s3_present_keys")
    require(all(key in R2_S3_ENV_KEYS for key in r2_keys), "credential_scope.r2_s3_present_keys contains unexpected key")
    require(credential_scope.get("r2_s3_can_manage_dns") is False, "R2 S3 credentials must not manage DNS")
    dns_write_requires = string_list(credential_scope.get("dns_write_requires"), "credential_scope.dns_write_requires", min_len=3)
    require(any("Zone DNS Edit" in item for item in dns_write_requires), "credential_scope.dns_write_requires must mention Zone DNS Edit")
    require("object-storage credentials only" in require_string(credential_scope.get("operator_note"), "credential_scope.operator_note"), "credential_scope.operator_note must distinguish R2 from DNS")
    require(summary.get("production_dns_target_status") == str(target.get("status", "missing")), "target status mismatch")
    require(summary.get("source_runbook_step_id") == "production_dns_https", "source runbook step mismatch")
    require_int(summary.get("source_runbook_blocking_input_count"), "summary.source_runbook_blocking_input_count")

    current_dns = packet.get("current_dns")
    require(isinstance(current_dns, dict), "current_dns must be object")
    for key in ("apex_a_records", "apex_aaaa_records", "apex_cname_records", "www_a_records", "www_cname_records", "staging_a_records"):
        string_list(current_dns.get(key), f"current_dns.{key}")
    recommended = packet.get("recommended_records")
    require(isinstance(recommended, list) and len(recommended) == 2, "recommended_records must contain apex and www records")
    recommended_hosts: list[str] = []
    target_content = str(target.get("target", "")).strip() if target.get("status") == "ready" else ""
    allowed_record_contents = {"<PRODUCTION_DNS_TARGET>", "zenari.ai"}
    if target_content:
        allowed_record_contents.add(target_content)
    for idx, row in enumerate(recommended):
        require(isinstance(row, dict), f"recommended_records[{idx}] must be object")
        host = require_string(row.get("host"), f"recommended_records[{idx}].host")
        recommended_hosts.append(host)
        require(host in {"zenari.ai", "www.zenari.ai"}, f"recommended_records[{idx}].host mismatch")
        require_string(row.get("type"), f"recommended_records[{idx}].type")
        require_string(row.get("name"), f"recommended_records[{idx}].name")
        content = require_string(row.get("content"), f"recommended_records[{idx}].content")
        require(content in allowed_record_contents, f"recommended_records[{idx}].content must be target, placeholder, or apex host")
        require(row.get("proxied") is True, f"recommended_records[{idx}].proxied must default true")
        require_string(row.get("ttl"), f"recommended_records[{idx}].ttl")
        require_string(row.get("required_when"), f"recommended_records[{idx}].required_when")
        require_string(row.get("current_status"), f"recommended_records[{idx}].current_status")
    require(recommended_hosts == ["zenari.ai", "www.zenari.ai"], "recommended_records order mismatch")
    ui_steps = string_list(packet.get("cloudflare_ui_steps"), "cloudflare_ui_steps", min_len=5)
    api_plan = string_list(packet.get("cloudflare_api_plan"), "cloudflare_api_plan", min_len=5)
    private_env = packet.get("private_env_template")
    require(isinstance(private_env, dict), "private_env_template must be object")
    require(private_env.get("path_placeholder") == "<private-production-env>", "private_env_template path placeholder mismatch")
    require(private_env.get("gitignore_required") is True, "private_env_template must require gitignore")
    require(private_env.get("blank_values_only") is True, "private_env_template must be blank-values-only")
    allowed_variables = string_list(private_env.get("allowed_variable_names"), "private_env_template.allowed_variable_names", min_len=5)
    require(allowed_variables == PRIVATE_ENV_ALLOWED_VARIABLES, "private_env_template allowed variables mismatch")
    template_lines = string_list(private_env.get("template_lines"), "private_env_template.template_lines", min_len=5)
    require(template_lines == [f"{name}=" for name in PRIVATE_ENV_ALLOWED_VARIABLES], "private_env_template lines must be blank assignments")
    verification_commands = string_list(packet.get("verification_commands"), "verification_commands", min_len=6)
    require(any("DNS > Records" in step for step in ui_steps), "cloudflare_ui_steps must mention DNS records")
    require(any("R2 S3 access keys" in step and "object-storage credentials only" in step for step in ui_steps), "cloudflare_ui_steps must distinguish R2 from DNS")
    require(any("PRODUCTION_DNS_TARGET" in step for step in api_plan), "cloudflare_api_plan must mention production target")
    require(any("OBJECT_STORAGE_ACCESS_KEY" in step and "OBJECT_STORAGE_SECRET_KEY" in step for step in api_plan), "cloudflare_api_plan must reject object storage keys for DNS")
    for command in (
        "dig +short A zenari.ai",
        "dig +short CNAME www.zenari.ai",
        "curl -I --max-time 12 https://zenari.ai/",
        "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json",
    ):
        require(command in verification_commands, f"verification_commands missing {command}")
    required_inputs = string_list(packet.get("required_inputs"), "required_inputs", min_len=3)
    require(required_inputs == ["PRODUCTION_DNS_TARGET", "CLOUDFLARE_ZONE_ID or CF_ZONE_ID", "CLOUDFLARE_API_TOKEN or CF_API_TOKEN"], "required_inputs mismatch")
    commands = string_list(packet.get("commands_after_inputs"), "commands_after_inputs", min_len=9)
    for command in (
        "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
        "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --verify-cloudflare --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
        "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
        "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json",
        "python3 scripts/stage1_production_source_probe.py --legal-support --release-sha $(git rev-parse HEAD) --production-web-url https://zenari.ai --write-canonical-source",
    ):
        require(command in commands, f"commands_after_inputs missing {command}")
    for command in commands:
        if "stage1_production_dns_cutover_plan.py" in command:
            require("--env <private-production-env>" in command, "cutover commands_after_inputs must use private env placeholder")
    operator_commands = packet.get("operator_command_packet")
    require(isinstance(operator_commands, list) and len(operator_commands) == len(OPERATOR_COMMAND_STEPS), "operator_command_packet step count mismatch")
    seen_steps: list[str] = []
    for idx, row in enumerate(operator_commands):
        require(isinstance(row, dict), f"operator_command_packet[{idx}] must be object")
        step_id = require_string(row.get("step_id"), f"operator_command_packet[{idx}].step_id")
        seen_steps.append(step_id)
        command = require_string(row.get("command"), f"operator_command_packet[{idx}].command")
        side_effect = require_string(row.get("side_effect"), f"operator_command_packet[{idx}].side_effect")
        may_write_dns = require_bool(row.get("may_write_dns"), f"operator_command_packet[{idx}].may_write_dns")
        requires_review = require_bool(row.get("requires_review"), f"operator_command_packet[{idx}].requires_review")
        require("CLOUDFLARE_API_TOKEN" not in command, f"operator_command_packet[{idx}] must not inline Cloudflare token variable")
        require("CF_API_TOKEN" not in command, f"operator_command_packet[{idx}] must not inline Cloudflare token variable")
        if step_id in {"generate_plan_with_private_env", "verify_cloudflare_scope", "apply_reviewed_dns"}:
            require("<private-production-env>" in command, f"operator_command_packet[{idx}] must use private env placeholder")
        if step_id == "verify_cloudflare_scope":
            require("--verify-cloudflare" in command, "verify_cloudflare_scope must be explicit")
            require("--apply" not in command, "verify_cloudflare_scope must not apply DNS")
            require(may_write_dns is False, "verify_cloudflare_scope must not write DNS")
            require(requires_review is False, "verify_cloudflare_scope must not require review")
            require("read-only Cloudflare zone and DNS permission preflight" in side_effect, "verify_cloudflare_scope side effect mismatch")
        if may_write_dns:
            require(step_id == "apply_reviewed_dns", "only apply_reviewed_dns may write DNS")
            require("--apply" in command, "DNS write step must be explicit --apply")
            require(requires_review is True, "DNS write step must require review")
            require("Cloudflare DNS write" in side_effect, "DNS write side effect must be explicit")
        else:
            require("--apply" not in command, f"non-DNS-write step {step_id} must not include --apply")
            require(requires_review is False, f"non-DNS-write step {step_id} must not require review")
    require(seen_steps == OPERATOR_COMMAND_STEPS, "operator_command_packet order mismatch")
    string_list(packet.get("operator_next_actions"), "operator_next_actions", min_len=4)
    gate = packet.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_stage1_production_launch_gate") is False, "gate impact cannot clear launch")
    require(gate.get("can_clear_production_legal_support_policy") is False, "gate impact cannot clear legal/support")
    require(gate.get("can_close_do_not_launch") is False, "gate impact cannot close DNL")
    require(gate.get("non_clearing_evidence_only") is True, "gate impact must be non-clearing")
    require(source_runbook.get("kind") == "stage1_production_source_probe_runbook", "source runbook ref must be valid")


def validate_operator_markdown(markdown: str, packet: dict[str, Any]) -> None:
    assert_no_secret(markdown, "dns_repair_operator_markdown")
    require("# Stage 1 Production DNS Operator Checklist" in markdown, "operator markdown missing title")
    require("non-clearing operator handoff" in markdown, "operator markdown must state non-clearing handoff")
    require("does not apply DNS changes" in markdown, "operator markdown must state it does not apply DNS changes")
    require("does not clear production launch gates" in markdown, "operator markdown must preserve launch blocker")
    for token in (
        "Status:",
        "`blocked`",
        "Release gate decision:",
        "`no_go`",
        "Production web URL:",
        "`https://zenari.ai`",
        "DNS blocker count:",
        "Required input count:",
        "## Current Resolver State",
        "## Current DNS Records",
        "## Credential Scope",
        "## DNS Over HTTPS Fallback",
        "## Public Production Addresses Observed",
        "## Recommended DNS Records",
        "## Required Inputs",
        "## Blocked Checks",
        "## Cloudflare UI Steps",
        "## Cloudflare API Plan",
        "## Private Env Template",
        "## Verification Commands",
        "## Commands After Inputs",
        "## Operator Command Packet",
        "## Operator Next Actions",
        "## Gate Impact",
        "## Source Evidence",
        "PRODUCTION_DNS_TARGET",
        "CLOUDFLARE_ZONE_ID or CF_ZONE_ID",
        "CLOUDFLARE_API_TOKEN or CF_API_TOKEN",
        "R2 S3 credentials detected:",
        "R2 S3 can manage DNS: `False`",
        "Cloudflare R2 S3 access keys are object-storage credentials only",
        "<private-production-env>",
        "zenari.ai",
        "www.zenari.ai",
        "dig +short A zenari.ai",
        "dig +short CNAME www.zenari.ai",
        "curl -I --max-time 12 https://zenari.ai/",
        "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json",
        "production_a_cloudflare",
        "production_a_google",
        "staging_a_cloudflare",
        "Can clear Stage 1 production launch gate: `False`",
        "Can close do-not-launch: `False`",
        "Non-clearing evidence only: `True`",
    ):
        require(token in markdown, f"operator markdown missing token: {token}")
    summary = packet.get("summary") if isinstance(packet.get("summary"), dict) else {}
    require(f"DNS blocker count: `{summary.get('dns_blocker_count')}`" in markdown, "operator markdown DNS blocker count mismatch")
    require(f"Required input count: `{summary.get('required_input_count')}`" in markdown, "operator markdown required input count mismatch")
    require(
        f"R2 S3 credentials detected: `{summary.get('r2_s3_credentials_detected')}`" in markdown,
        "operator markdown R2 credential flag mismatch",
    )
    require(
        f"Public production address count: `{summary.get('public_production_address_count')}`" in markdown,
        "operator markdown public address count mismatch",
    )
    public_addresses = packet.get("public_production_addresses_observed")
    require(isinstance(public_addresses, list), "public_production_addresses_observed must be list before markdown validation")
    observed_text = ", ".join(str(item) for item in public_addresses if str(item).strip()) or "none"
    require(f"`{observed_text}`" in markdown, "operator markdown public addresses mismatch")
    doh_rows = packet.get("dns_over_https_probe_summary")
    require(isinstance(doh_rows, list), "dns_over_https_probe_summary must be list before markdown validation")
    for idx, row in enumerate(doh_rows):
        require(isinstance(row, dict), f"dns_over_https_probe_summary[{idx}] must be object before markdown validation")
        for key in ("probe_id", "resolver", "host", "rrtype", "status"):
            text = require_string(row.get(key), f"dns_over_https_probe_summary[{idx}].{key}")
            require(text in markdown, f"operator markdown missing dns_over_https_probe_summary[{idx}].{key}")
    for field in ("required_inputs", "blocked_checks", "cloudflare_ui_steps", "cloudflare_api_plan", "verification_commands", "commands_after_inputs"):
        values = packet.get(field)
        require(isinstance(values, list), f"{field} must be list before markdown validation")
        for item in values:
            text = require_string(item, field)
            require(text in markdown, f"operator markdown missing {field} item: {text}")
    private_env = packet.get("private_env_template") if isinstance(packet.get("private_env_template"), dict) else {}
    for item in string_list(private_env.get("template_lines"), "private_env_template.template_lines"):
        require(item in markdown, f"operator markdown missing private env template line: {item}")
    operator_commands = packet.get("operator_command_packet")
    require(isinstance(operator_commands, list), "operator_command_packet must be list before markdown validation")
    for idx, row in enumerate(operator_commands):
        require(isinstance(row, dict), f"operator_command_packet[{idx}] must be object before markdown validation")
        for key in ("step_id", "command", "side_effect"):
            text = require_string(row.get(key), f"operator_command_packet[{idx}].{key}")
            require(text in markdown, f"operator markdown missing operator_command_packet[{idx}].{key}")
    recommended = packet.get("recommended_records")
    require(isinstance(recommended, list), "recommended_records must be list before markdown validation")
    for idx, row in enumerate(recommended):
        require(isinstance(row, dict), f"recommended_records[{idx}] must be object before markdown validation")
        for key in ("host", "type", "name", "content", "ttl", "current_status", "required_when"):
            text = require_string(row.get(key), f"recommended_records[{idx}].{key}")
            require(text in markdown, f"operator markdown missing recommended_records[{idx}].{key}")


def run_ready_target_selftests() -> None:
    cutover_generator = ROOT / "scripts" / "stage1_production_dns_cutover_plan.py"
    repair_generator = ROOT / "scripts" / "generate_stage1_production_dns_repair_packet.py"
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        readiness = tmpdir / "production-dns-readiness.json"
        readiness.write_text(
            json.dumps(
                {
                    "schema_version": "stage1.production_dns_readiness.v1",
                    "system_resolver": {
                        "production": {"status": "blocked"},
                        "staging_control": {"status": "pass"},
                    },
                    "authoritative_public_dns_probe": {
                        "production_a": {"status": "missing"},
                        "production_aaaa": {"status": "missing"},
                        "staging_a": {"status": "pass"},
                    },
                    "dns_over_https_probe": {
                        "production_a_cloudflare": {"status": "missing", "addresses": []},
                        "production_aaaa_cloudflare": {"status": "missing", "addresses": []},
                        "production_a_google": {"status": "missing", "addresses": []},
                        "production_aaaa_google": {"status": "missing", "addresses": []},
                        "staging_a_cloudflare": {"status": "pass", "addresses": ["104.21.62.40"]},
                        "staging_a_google": {"status": "pass", "addresses": ["172.67.219.243"]},
                    },
                    "public_production_addresses_observed": [],
                    "blocked_checks": ["synthetic_dns_not_applied"],
                }
            ),
            encoding="utf-8",
        )
        cases = [
            ("52.237.80.117", "A"),
            ("prod-web.example.net", "CNAME"),
        ]
        for target, expected_apex_type in cases:
            cutover = tmpdir / f"cutover-{expected_apex_type}.json"
            packet = tmpdir / f"repair-{expected_apex_type}.json"
            result = subprocess.run(
                [
                    sys.executable,
                    str(cutover_generator),
                    "--dns-readiness",
                    str(readiness),
                    "--target",
                    target,
                    "--output",
                    str(cutover),
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            require(result.returncode == 2, f"synthetic cutover plan must remain non-clearing blocked without Cloudflare inputs: {result.stderr or result.stdout}")
            result = subprocess.run(
                [
                    sys.executable,
                    str(repair_generator),
                    "--dns-readiness",
                    str(readiness),
                    "--dns-cutover-plan",
                    str(cutover),
                    "--source-runbook",
                    str(DEFAULT_SOURCE_RUNBOOK),
                    "--output",
                    str(packet),
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            require(result.returncode == 0, f"synthetic repair packet generation failed: {result.stderr or result.stdout}")
            data = load_json(packet)
            recommended = data.get("recommended_records")
            require(isinstance(recommended, list) and recommended, "synthetic repair packet missing recommended records")
            apex = recommended[0]
            require(isinstance(apex, dict), "synthetic apex recommended record must be object")
            require(apex.get("type") == expected_apex_type, f"target {target} should recommend apex {expected_apex_type}, got {apex.get('type')}")
            require(apex.get("content") == target, f"target {target} should be projected into the apex recommended record")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--packet", type=Path, default=DEFAULT_PACKET)
    parser.add_argument("--dns-readiness", type=Path, default=DEFAULT_DNS_READINESS)
    parser.add_argument("--dns-cutover-plan", type=Path, default=DEFAULT_DNS_CUTOVER_PLAN)
    parser.add_argument("--source-runbook", type=Path, default=DEFAULT_SOURCE_RUNBOOK)
    parser.add_argument("--operator-markdown", type=Path)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        print("stage1 production DNS repair packet contract passed")
        return 0
    try:
        run_ready_target_selftests()
        packet = load_json(args.packet)
        validate_packet(
            packet,
            load_json(args.dns_readiness),
            load_json(args.dns_cutover_plan),
            load_json(args.source_runbook),
            {
                "dns_readiness": normalize_ref(args.dns_readiness),
                "dns_cutover_plan": normalize_ref(args.dns_cutover_plan),
                "source_probe_runbook": normalize_ref(args.source_runbook),
            },
        )
        if args.operator_markdown:
            validate_operator_markdown(load_text(args.operator_markdown), packet)
    except ProductionDnsRepairPacketValidationError as exc:
        raise SystemExit(f"stage1 production DNS repair packet validation failed: {exc}") from exc
    print("stage1 production DNS repair packet validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
