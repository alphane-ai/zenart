#!/usr/bin/env python3
"""Validate the final non-clearing production blocker Markdown checklist."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-blocker-checklist.md"
DEFAULT_OPERATOR_BRIEF = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
DEFAULT_MISSING_INPUT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
DEFAULT_DNS_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-repair-packet.json"
DEFAULT_BILLING_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-billing-operator-packet.json"
DEFAULT_SECURITY_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-operator-packet.json"
DEFAULT_GOVERNANCE_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-operator-packet.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_production_blocker_checklist.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
DNS_PLAN_PRIVATE_ENV_COMMAND = (
    "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> "
    "--output ops/evidence/non_clearing/production-dns-cutover-plan.json"
)
DNS_APPLY_PRIVATE_ENV_COMMAND = (
    "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> "
    "--apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json"
)
DNS_PLAN_LEGACY_COMMAND = "python3 scripts/stage1_production_dns_cutover_plan.py --output ops/evidence/non_clearing/production-dns-cutover-plan.json"
DNS_APPLY_LEGACY_COMMAND = "python3 scripts/stage1_production_dns_cutover_plan.py --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json"

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


class ProductionBlockerChecklistValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionBlockerChecklistValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionBlockerChecklistValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionBlockerChecklistValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain JSON object")
    return data


def load_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ProductionBlockerChecklistValidationError(f"missing {display_path(path)}") from exc


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = load_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing {snippet!r}")


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


def string_list(value: Any, path: str, *, min_len: int = 0) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    require(len(value) >= min_len, f"{path} must contain at least {min_len} items")
    result: list[str] = []
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be non-empty string")
        result.append(item.strip())
    return result


def token(markdown: str, value: Any, label: str) -> None:
    require(str(value) in markdown, f"checklist missing {label}: {value}")


def packet_required_count(packet: dict[str, Any]) -> int:
    if isinstance(packet.get("required_live_artifacts"), list):
        return len(packet["required_live_artifacts"])
    if isinstance(packet.get("required_security_runtime_refs"), list):
        return len(packet["required_security_runtime_refs"])
    if isinstance(packet.get("required_governance_components"), list):
        total = 0
        for component in packet["required_governance_components"]:
            if not isinstance(component, dict):
                continue
            total += 2
            total += len(component.get("required_ids", []) if isinstance(component.get("required_ids"), list) else [])
            total += len(component.get("required_section_refs", []) if isinstance(component.get("required_section_refs"), list) else [])
        return total
    return 0


def validate_checklist(
    markdown: str,
    brief: dict[str, Any],
    missing: dict[str, Any],
    runbook: dict[str, Any],
    dns: dict[str, Any],
    billing: dict[str, Any],
    security: dict[str, Any],
    governance: dict[str, Any],
    refs: dict[str, str],
) -> None:
    assert_no_secret(markdown, "production_blocker_checklist")
    for required in (
        "# Stage 1 Final Production Blocker Checklist",
        "non-clearing operator checklist",
        "preserves no_go",
        "Release decision: `no_go`",
        "## Blocking Input Groups",
        "## Production Source Probes",
        "## DNS And HTTPS",
        "## Billing Live Stripe Lifecycle",
        "## Security Launch Checks",
        "## Governance Release",
        "## Source JSON",
    ):
        require(required in markdown, f"checklist missing required text: {required}")

    brief_summary = brief.get("summary")
    missing_summary = missing.get("summary")
    runbook_summary = runbook.get("summary")
    require(isinstance(brief_summary, dict), "brief.summary must be object")
    require(isinstance(missing_summary, dict), "missing.summary must be object")
    require(isinstance(runbook_summary, dict), "runbook.summary must be object")
    for value, label in (
        (brief_summary.get("stage1_gates_completed"), "stage1_gates_completed"),
        (brief_summary.get("stage1_gates_total"), "stage1_gates_total"),
        (brief_summary.get("stage1_completion_percent"), "stage1_completion_percent"),
        (missing_summary.get("required_configured"), "required_configured"),
        (missing_summary.get("required_total"), "required_total"),
        (missing_summary.get("required_completion_percent"), "required_completion_percent"),
        (missing_summary.get("required_missing"), "required_missing"),
        (missing_summary.get("required_invalid"), "required_invalid"),
        (missing_summary.get("blocking_input_count"), "blocking_input_count"),
        (runbook_summary.get("ready_to_execute_count"), "ready_to_execute_count"),
        (runbook_summary.get("runbook_step_count"), "runbook_step_count"),
        (runbook_summary.get("blocked_step_count"), "blocked_step_count"),
        (runbook_summary.get("blocking_input_count"), "runbook_blocking_input_count"),
    ):
        token(markdown, value, label)

    groups = missing.get("groups")
    require(isinstance(groups, list) and len(groups) == 4, "missing input checklist must expose 4 groups")
    for group in groups:
        require(isinstance(group, dict), "group must be object")
        for key in ("group_id", "required_configured", "required_total", "completion_percent", "required_missing", "required_invalid", "blocking_input_count"):
            token(markdown, group.get(key), f"group.{key}")

    steps = runbook.get("steps")
    require(isinstance(steps, list) and len(steps) == 4, "runbook must expose 4 source probe steps")
    for step in steps:
        require(isinstance(step, dict), "source probe step must be object")
        for key in ("step_id", "probe_id", "ready_to_execute", "completion_percent", "blocking_input_count", "first_blocker"):
            token(markdown, step.get(key), f"step.{key}")

    dns_summary = dns.get("summary")
    require(isinstance(dns_summary, dict), "dns.summary must be object")
    for value, label in (
        (dns.get("status"), "dns.status"),
        (dns.get("release_gate_decision"), "dns.release_gate_decision"),
        (dns.get("production_web_url"), "dns.production_web_url"),
        (dns_summary.get("dns_blocker_count"), "dns_blocker_count"),
        (dns_summary.get("required_input_count"), "dns_required_input_count"),
        (dns_summary.get("production_system_resolver_status"), "dns_resolver_status"),
        (dns_summary.get("production_a_status"), "dns_a_status"),
        (dns_summary.get("production_aaaa_status"), "dns_aaaa_status"),
    ):
        token(markdown, value, label)
    for item in string_list(dns.get("required_inputs"), "dns.required_inputs", min_len=3):
        token(markdown, item, "dns.required_input")
    for command in string_list(dns.get("verification_commands"), "dns.verification_commands", min_len=6):
        token(markdown, command, "dns.verification_command")
    for command in string_list(dns.get("commands_after_inputs"), "dns.commands_after_inputs", min_len=8):
        token(markdown, command, "dns.after_input_command")
    dns_commands = string_list(dns.get("commands_after_inputs"), "dns.commands_after_inputs", min_len=8)
    require(DNS_PLAN_PRIVATE_ENV_COMMAND in dns_commands, "dns.commands_after_inputs must use private-env DNS plan command")
    require(DNS_APPLY_PRIVATE_ENV_COMMAND in dns_commands, "dns.commands_after_inputs must use review-gated private-env DNS apply command")
    require(DNS_PLAN_LEGACY_COMMAND not in dns_commands, "dns.commands_after_inputs must not use legacy DNS plan command")
    require(DNS_APPLY_LEGACY_COMMAND not in dns_commands, "dns.commands_after_inputs must not use legacy DNS apply command")
    require(DNS_PLAN_PRIVATE_ENV_COMMAND in markdown, "checklist missing private-env DNS plan command")
    require(DNS_APPLY_PRIVATE_ENV_COMMAND in markdown, "checklist missing private-env DNS apply command")
    require(DNS_PLAN_LEGACY_COMMAND not in markdown, "checklist must not contain legacy DNS plan command")
    require(DNS_APPLY_LEGACY_COMMAND not in markdown, "checklist must not contain legacy DNS apply command")

    for name, packet, required_count in (
        ("billing", billing, packet_required_count(billing)),
        ("security", security, packet_required_count(security)),
        ("governance", governance, packet_required_count(governance)),
    ):
        require(packet.get("status") == "blocked", f"{name} packet must remain blocked")
        require(packet.get("release_gate_decision") == "no_go", f"{name} packet must remain no_go")
        token(markdown, packet.get("release_gate_check_id"), f"{name}.release_gate_check_id")
        token(markdown, required_count, f"{name}.required_count")
        token(markdown, packet.get("can_clear_stage1_production_launch_gate"), f"{name}.can_clear_stage1")
        token(markdown, packet.get("can_close_do_not_launch"), f"{name}.can_close_dnl")
        for command in string_list(packet.get("execution_order"), f"{name}.execution_order", min_len=7):
            token(markdown, command, f"{name}.execution_order")

    for item in billing.get("required_live_artifacts", []):
        require(isinstance(item, dict), "billing required artifact must be object")
        token(markdown, item.get("flag"), "billing.required_live_artifact.flag")
        token(markdown, item.get("prefix"), "billing.required_live_artifact.prefix")
    for item in security.get("required_security_runtime_refs", []):
        require(isinstance(item, dict), "security required ref must be object")
        token(markdown, item.get("flag"), "security.required_ref.flag")
        token(markdown, item.get("section"), "security.required_ref.section")
    for component in governance.get("required_governance_components", []):
        require(isinstance(component, dict), "governance component must be object")
        token(markdown, component.get("component"), "governance.component")
        token(markdown, component.get("runtime_flag"), "governance.runtime_flag")
        token(markdown, component.get("audit_flag"), "governance.audit_flag")
        for item in component.get("required_ids", []) if isinstance(component.get("required_ids"), list) else []:
            require(isinstance(item, dict), "governance required id must be object")
            token(markdown, item.get("flag"), "governance.required_id.flag")
        for item in component.get("required_section_refs", []) if isinstance(component.get("required_section_refs"), list) else []:
            require(isinstance(item, dict), "governance required section must be object")
            token(markdown, item.get("flag"), "governance.required_section.flag")

    for label, ref in refs.items():
        require(ref in markdown, f"checklist missing source ref {label}: {ref}")


def validate_contract() -> None:
    require_text(
        GENERATOR,
        (
            "DNS_PLAN_PRIVATE_ENV_COMMAND",
            "DNS_APPLY_PRIVATE_ENV_COMMAND",
            "stage1_production_dns_cutover_plan.py --env <private-production-env>",
            "render_dns_section",
            "production-blocker-checklist.md",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "generate_stage1_production_blocker_checklist.py --contract-only",
            "validate_stage1_production_blocker_checklist.py --contract-only",
            "validate_stage1_production_blocker_checklist.py",
        ),
    )
    if DNS_PLAN_PRIVATE_ENV_COMMAND == DNS_APPLY_PRIVATE_ENV_COMMAND:
        raise ProductionBlockerChecklistValidationError("DNS private-env command contract mismatch")
    for command, label in (
        (DNS_PLAN_PRIVATE_ENV_COMMAND, "plan"),
        (DNS_APPLY_PRIVATE_ENV_COMMAND, "apply"),
    ):
        require("--env <private-production-env>" in command, f"DNS {label} command missing private env placeholder")
    require("--apply" in DNS_APPLY_PRIVATE_ENV_COMMAND, "DNS apply command missing --apply")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checklist", type=Path, default=DEFAULT_CHECKLIST)
    parser.add_argument("--operator-brief", type=Path, default=DEFAULT_OPERATOR_BRIEF)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_MISSING_INPUT_CHECKLIST)
    parser.add_argument("--source-runbook", type=Path, default=DEFAULT_SOURCE_RUNBOOK)
    parser.add_argument("--dns-packet", type=Path, default=DEFAULT_DNS_PACKET)
    parser.add_argument("--billing-packet", type=Path, default=DEFAULT_BILLING_PACKET)
    parser.add_argument("--security-packet", type=Path, default=DEFAULT_SECURITY_PACKET)
    parser.add_argument("--governance-packet", type=Path, default=DEFAULT_GOVERNANCE_PACKET)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        validate_contract()
        print("stage1 production blocker checklist contract passed")
        return 0
    try:
        validate_checklist(
            load_text(args.checklist),
            load_json(args.operator_brief),
            load_json(args.missing_input_checklist),
            load_json(args.source_runbook),
            load_json(args.dns_packet),
            load_json(args.billing_packet),
            load_json(args.security_packet),
            load_json(args.governance_packet),
            {
                "operator_brief": display_path(args.operator_brief),
                "missing_input_checklist": display_path(args.missing_input_checklist),
                "source_runbook": display_path(args.source_runbook),
                "dns_packet": display_path(args.dns_packet),
                "billing_packet": display_path(args.billing_packet),
                "security_packet": display_path(args.security_packet),
                "governance_packet": display_path(args.governance_packet),
            },
        )
    except ProductionBlockerChecklistValidationError as exc:
        raise SystemExit(f"stage1 production blocker checklist validation failed: {exc}") from exc
    print("stage1 production blocker checklist validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
