#!/usr/bin/env python3
"""Validate non-clearing Azure staging origin readiness evidence."""

from __future__ import annotations

import argparse
import ast
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-azure-origin-readiness.json"
GENERATOR = ROOT / "scripts" / "stage1_azure_origin_readiness.py"
SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
    "password_persisted",
)
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|X-Amz-Signature|GoogleAccessId)"
)
HTTP_NETWORK_PHASES = {
    "parse_url",
    "tcp_connect",
    "tcp_connected",
    "tls_clienthello_sent",
    "tls_established",
    "http_request_sent",
    "http_response_started",
}
HTTP_FAILURE_CATEGORIES = {
    "unsupported_url",
    "tcp_connect_timeout",
    "tcp_connect_failed",
    "tls_serverhello_timeout",
    "tls_certificate_error",
    "tls_error",
    "http_no_bytes_after_request",
    "https_no_bytes_after_tls",
    "origin_timeout",
    "origin_io_error",
    "invalid_http_response",
    "none",
}
SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "api_key",
    "password",
    "ssh_password",
    "private_key",
    "token",
    "raw_response",
    "raw_payload",
}
REQUIRED_REPAIR_COMMANDS = (
    "open ops/evidence/staging/azure-run-command-operator-card.md",
    "scripts/azure_staging_run_command_payload.sh",
    "python3 scripts/ingest_azure_run_command_output.py",
    "python3 scripts/sanitize_azure_run_command_output.py --output ops/evidence/staging/azure-run-command-ssh-repair.output.txt --require-marker",
    "python3 scripts/classify_azure_run_command_output.py --input ops/evidence/staging/azure-run-command-ssh-repair.output.txt --output ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json || test $? -eq 2",
    "scripts/azure_staging_cli_preflight.sh",
    "RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh",
    "scripts/azure_staging_password_key_repair.sh",
    "scripts/azure_staging_ssh_preflight.sh",
    "scripts/azure_staging_bootstrap.sh",
    "scripts/azure_staging_deploy.sh",
    "scripts/azure_staging_origin_repair.sh",
    "python3 scripts/stage1_azure_origin_readiness.py --env .env --output ops/evidence/staging/stage1-azure-origin-readiness.json || test $? -eq 2",
)
SSH_REASONS = {
    "ssh_key_auth_ok",
    "ssh_key_auth_permission_denied",
    "ssh_server_not_responding",
    "ssh_connect_timeout",
    "ssh_auth_hard_timeout",
    "ssh_key_auth_failed",
}
AZURE_CLI_REASONS = {
    "env_vm_found",
    "env_vm_not_found",
    "az_cli_missing",
    "az_not_logged_in",
    "vm_ip_discovery_failed",
    "vm_found_by_public_ip",
    "vm_not_found_by_public_ip",
    "az_cli_preflight_timeout",
    "az_cli_preflight_unparseable",
}
TRANSPORT_LANES = {
    "azure_network_access",
    "ssh_transport_or_auth",
    "vm_protocol_services_unresponsive",
    "origin_runtime",
    "origin_probe_non_clearing_pass",
}
TRANSPORT_NEXT_ACTIONS = {
    "inspect_azure_nsg_firewall_and_public_ip",
    "repair_ssh_auth_or_sshd",
    "azure_portal_run_command_or_serial_console",
    "repair_origin_services_after_ssh",
    "continue_strict_staging_runtime_evidence",
}
SSH_TRANSPORT_PHASES = {
    "banner_exchange_timeout",
    "transport_timeout_before_auth",
    "auth_reached",
    "post_auth_or_keepalive_timeout",
    "auth_or_transport_failed",
}
TRANSPORT_BLOCKED_REASONS = {
    "tcp_entry_ports_not_all_reachable",
    "ssh_banner_timeout_before_auth",
    "ssh_transport_timeout_before_auth",
    "ssh_auth_not_ok",
    "tls_serverhello_timeout",
    "http_zero_bytes_after_request",
    "http_response_not_started",
    "local_azure_cli_missing",
}


class AzureOriginReadinessValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AzureOriginReadinessValidationError(message)


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
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise AzureOriginReadinessValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret/raw credential field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def require_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty string")
    return value.strip()


def require_list(value: Any, path: str) -> list[Any]:
    require(isinstance(value, list), f"{path} must be list")
    return value


def validate_probe(row: Any, path: str) -> dict[str, Any]:
    require(isinstance(row, dict), f"{path} must be object")
    require(row.get("status") in {"pass", "blocked"}, f"{path}.status mismatch")
    require_string(row.get("error_summary", "none") if row.get("status") == "blocked" else row.get("status"), f"{path}.status_or_error")
    return row


def validate(data: dict[str, Any]) -> None:
    assert_no_secret(data, "azure_origin_readiness")
    require(data.get("schema_version") == "stage1.azure_origin_readiness.v1", "schema_version mismatch")
    require(data.get("kind") == "stage1_azure_origin_readiness", "kind mismatch")
    require(data.get("environment") == "staging", "environment mismatch")
    require(data.get("status") in {"pass", "blocked"}, "status mismatch")
    require(data.get("release_gate_decision") == "no_go", "release gate decision must remain no_go")
    require(data.get("non_clearing_origin_probe") is True, "probe must be non-clearing")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_staging_runtime_gate") is False, "cannot clear staging runtime")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    require(data.get("azure_ip") == "52.237.80.117", "azure_ip mismatch")
    require(data.get("staging_web_url") == "https://staging.zenari.ai", "staging_web_url mismatch")
    require(data.get("staging_host") == "staging.zenari.ai", "staging_host mismatch")

    tcp_ports = data.get("tcp_ports")
    require(isinstance(tcp_ports, list) and len(tcp_ports) >= 3, "tcp_ports must include at least SSH/HTTP/HTTPS")
    seen_ports: set[int] = set()
    for idx, row in enumerate(tcp_ports):
        probe = validate_probe(row, f"tcp_ports[{idx}]")
        require(probe.get("host") == "52.237.80.117", f"tcp_ports[{idx}].host mismatch")
        require(isinstance(probe.get("port"), int), f"tcp_ports[{idx}].port must be int")
        seen_ports.add(probe["port"])
    require({22, 80, 443} <= seen_ports, "tcp_ports must include 22/80/443")

    dns = validate_probe(data.get("staging_dns"), "staging_dns")
    require(dns.get("host") == "staging.zenari.ai", "staging_dns.host mismatch")
    require(isinstance(dns.get("addresses"), list), "staging_dns.addresses must be list")

    http = data.get("http_probes")
    require(isinstance(http, list) and len(http) >= 4, "http_probes must include IP and staging URL probes")
    methods = set()
    for idx, row in enumerate(http):
        probe = validate_probe(row, f"http_probes[{idx}]")
        require_string(probe.get("url"), f"http_probes[{idx}].url")
        method = require_string(probe.get("method"), f"http_probes[{idx}].method")
        require(method in {"HEAD", "GET"}, f"http_probes[{idx}].method mismatch")
        methods.add(method)
        phase = require_string(probe.get("network_phase"), f"http_probes[{idx}].network_phase")
        require(phase in HTTP_NETWORK_PHASES, f"http_probes[{idx}].network_phase mismatch")
        category = require_string(probe.get("failure_category"), f"http_probes[{idx}].failure_category")
        require(category in HTTP_FAILURE_CATEGORIES, f"http_probes[{idx}].failure_category mismatch")
        require(isinstance(probe.get("response_bytes"), int), f"http_probes[{idx}].response_bytes must be int")
        if probe.get("status") == "pass":
            require(category == "none", f"http_probes[{idx}].pass must use none failure_category")
            require(probe.get("response_bytes", 0) > 0, f"http_probes[{idx}].pass must include response bytes")
        else:
            require(category != "none", f"http_probes[{idx}].blocked must include failure category")
        require("body_sample" not in probe, "http probe must not persist response body")
    require(methods == {"HEAD", "GET"}, "http_probes must include HEAD and GET")

    ssh = validate_probe(data.get("ssh_key_preflight"), "ssh_key_preflight")
    require(ssh.get("target_user") == "sansha", "ssh target user mismatch")
    require(ssh.get("target_host") == "52.237.80.117", "ssh target host mismatch")
    require(ssh.get("auth_method") == "publickey_batchmode_only", "ssh auth method mismatch")
    require(ssh.get("password_attempted") is False, "validator requires no password attempt")
    require(ssh.get("reason") in SSH_REASONS, "ssh reason mismatch")
    require(isinstance(ssh.get("hard_timeout_seconds"), int), "ssh hard_timeout_seconds must be int")
    require(ssh.get("hard_timeout_seconds", 0) >= 20, "ssh hard_timeout_seconds must be at least 20")
    cli = validate_probe(data.get("azure_cli_preflight"), "azure_cli_preflight")
    require(cli.get("reason") in AZURE_CLI_REASONS, "azure cli preflight reason mismatch")
    require(isinstance(cli.get("exit_code"), int), "azure cli preflight exit_code must be int")
    require(isinstance(cli.get("subscription_id"), str), "azure cli preflight subscription_id must be string")
    require(isinstance(cli.get("resource_group"), str), "azure cli preflight resource_group must be string")
    require(isinstance(cli.get("vm_name"), str), "azure cli preflight vm_name must be string")
    require(cli.get("azure_ip") == "52.237.80.117", "azure cli preflight azure_ip mismatch")

    transport = validate_probe(data.get("transport_diagnosis"), "transport_diagnosis")
    require(transport.get("lane") in TRANSPORT_LANES, "transport_diagnosis.lane mismatch")
    require(transport.get("next_action") in TRANSPORT_NEXT_ACTIONS, "transport_diagnosis.next_action mismatch")
    require_string(transport.get("operator_summary"), "transport_diagnosis.operator_summary")
    blocked_reasons = require_list(transport.get("blocked_reasons"), "transport_diagnosis.blocked_reasons")
    for reason in blocked_reasons:
        require(reason in TRANSPORT_BLOCKED_REASONS, f"transport_diagnosis blocked reason mismatch: {reason}")
    for field in (
        "tcp_entry_ports_reachable",
        "tcp_22_reachable",
        "tcp_80_reachable",
        "tcp_443_reachable",
        "ssh_banner_received",
        "ssh_auth_reached",
        "ssh_password_key_repair_viable",
        "http_request_sent",
        "http_response_started",
        "http_zero_bytes_after_request",
        "tls_serverhello_timeout",
        "azure_portal_run_command_required",
    ):
        require(isinstance(transport.get(field), bool), f"transport_diagnosis.{field} must be bool")
    require(transport.get("ssh_transport_phase") in SSH_TRANSPORT_PHASES, "transport_diagnosis.ssh_transport_phase mismatch")
    if transport.get("ssh_password_key_repair_viable") is True:
        require(transport.get("ssh_banner_received") is True, "password/key repair is viable only after SSH banner/auth is reachable")
    if transport.get("lane") == "vm_protocol_services_unresponsive":
        require(transport.get("tcp_entry_ports_reachable") is True, "protocol-unresponsive lane requires reachable entry TCP ports")
        require(transport.get("ssh_banner_received") is False, "protocol-unresponsive lane requires no SSH banner")
        require(transport.get("http_response_started") is False, "protocol-unresponsive lane requires no HTTP response start")
        require(
            transport.get("next_action") == "azure_portal_run_command_or_serial_console",
            "protocol-unresponsive lane must route to Azure Run Command/Serial Console",
        )
    if ssh.get("reason") == "ssh_connect_timeout":
        require(
            "ssh_banner_timeout_before_auth" in blocked_reasons or "ssh_transport_timeout_before_auth" in blocked_reasons,
            "ssh connect timeout must be reflected in transport_diagnosis.blocked_reasons",
        )
    if not any(row.get("status") == "pass" for row in http):
        require("http_response_not_started" in blocked_reasons, "no successful HTTP probe must be reflected in transport diagnosis")

    require(isinstance(data.get("ssh_hard_timeout_seconds"), int), "ssh_hard_timeout_seconds must be int")
    require(data.get("ssh_hard_timeout_seconds", 0) >= 20, "ssh_hard_timeout_seconds must default to at least 20")
    require(data.get("local_repair_password_env_key") == "STAGING_SSH_PASSWORD", "repair password env key mismatch")
    require(isinstance(data.get("local_repair_password_configured"), bool), "readiness evidence must only report password configured as a boolean")
    require(data.get("local_repair_password_required") is True, "repair password requirement mismatch")
    require(data.get("origin_diagnostics_command") == "scripts/azure_staging_origin_diagnostics.sh", "origin diagnostics command mismatch")
    require(data.get("origin_repair_command") == "scripts/azure_staging_origin_repair.sh", "origin repair command mismatch")
    commands = data.get("origin_repair_commands")
    require(isinstance(commands, list), "origin_repair_commands must be list")
    for command in REQUIRED_REPAIR_COMMANDS:
        require(command in commands, f"missing origin repair command {command}")

    blocked = data.get("blocked_checks")
    require(isinstance(blocked, list), "blocked_checks must be list")
    if data.get("status") == "blocked":
        require(blocked, "blocked readiness must include blocked_checks")
    actions = data.get("operator_next_actions")
    require(isinstance(actions, list) and len(actions) >= 3, "operator_next_actions incomplete")


def validate_contract() -> None:
    text = read_text(GENERATOR)
    for snippet in (
        "stage1.azure_origin_readiness.v1",
        "52.237.80.117",
        "https://staging.zenari.ai",
        "require_active_azure_ip",
        "Azure staging origin probe must use active IP",
        "NON_SECRET_ENV_KEYS",
        "SECRET_PRESENCE_ENV_KEYS",
        "parse_env_file",
        "env_key_present",
        "apply_env_defaults",
        "STAGING_SSH_HOST",
        "STAGING_SSH_USER",
        "STAGING_WEB_URL",
        "STAGING_PUBLIC_HOST",
        "publickey_batchmode_only",
        "ServerAliveInterval=5",
        "ServerAliveCountMax=2",
        "operator_next_actions_for_ssh_reason",
        "ssh_connect_timeout",
        "ssh_server_not_responding",
        "ssh_auth_hard_timeout",
        "Azure Portal Run Command or Serial Console",
        "azure-run-command-operator-card.md",
        "azure_staging_run_command_payload.sh",
        "ingest_azure_run_command_output.py",
        "sanitize_azure_run_command_output.py",
        "classify_azure_run_command_output.py",
        "azure-run-command-ssh-repair-diagnosis.json",
        "azure_staging_cli_preflight.sh",
        "azure_staging_run_command_invoke.sh",
        "azure_cli_preflight",
        "az_cli_missing",
        "vm_found_by_public_ip",
        "check sshd health",
        "password_attempted",
        "non_clearing_origin_probe",
        "network_phase",
        "failure_category",
        "transport_diagnosis",
        "vm_protocol_services_unresponsive",
        "ssh_banner_timeout_before_auth",
        "ssh_password_key_repair_viable",
        "azure_portal_run_command_or_serial_console",
        "response_bytes",
        "ssh_hard_timeout_seconds",
        "local_repair_password_env_key",
        "origin_repair_commands",
        "azure_staging_origin_diagnostics.sh",
        "azure_staging_origin_repair.sh",
    ):
        require(snippet in text, f"generator missing contract snippet {snippet!r}")
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        raise AzureOriginReadinessValidationError(f"generator syntax invalid: {exc}") from exc
    env_keys: set[str] | None = None
    for node in tree.body:
        if isinstance(node, ast.Assign):
            names = [target.id for target in node.targets if isinstance(target, ast.Name)]
            if "NON_SECRET_ENV_KEYS" in names and isinstance(node.value, (ast.Set, ast.List, ast.Tuple)):
                env_keys = {item.value for item in node.value.elts if isinstance(item, ast.Constant) and isinstance(item.value, str)}
    require(env_keys is not None, "generator must declare NON_SECRET_ENV_KEYS literal")
    require("STAGING_SSH_PASSWORD" not in env_keys, "generator must not parse STAGING_SSH_PASSWORD as an env-file key")
    require("SECRET_PRESENCE_ENV_KEYS" in text, "generator must declare secret-presence-only env keys")
    require("local_repair_password_configured" in text, "generator must emit password presence boolean")
    require("os.getenv" not in text and "os.environ" not in text, "generator must not read process environment secrets")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.contract_only:
            validate_contract()
            print("stage1 azure origin readiness contract passed")
            return 0
        validate(load_json(args.evidence))
    except AzureOriginReadinessValidationError as exc:
        raise SystemExit(f"stage1 azure origin readiness validation failed: {exc}") from exc
    print("stage1 azure origin readiness validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
