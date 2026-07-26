#!/usr/bin/env python3
"""Render the final non-clearing production blocker checklist as Markdown."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-blocker-checklist.md"
DEFAULT_OPERATOR_BRIEF = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
DEFAULT_MISSING_INPUT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
DEFAULT_DNS_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-repair-packet.json"
DEFAULT_BILLING_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-billing-operator-packet.json"
DEFAULT_SECURITY_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-operator-packet.json"
DEFAULT_GOVERNANCE_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-operator-packet.json"
DNS_PLAN_PRIVATE_ENV_COMMAND = (
    "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> "
    "--output ops/evidence/non_clearing/production-dns-cutover-plan.json"
)
DNS_APPLY_PRIVATE_ENV_COMMAND = (
    "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> "
    "--apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json"
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


class ProductionBlockerChecklistError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionBlockerChecklistError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionBlockerChecklistError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionBlockerChecklistError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionBlockerChecklistError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionBlockerChecklistError(f"{path} contains raw secret-looking material")


def write_text(path: Path, text: str) -> None:
    assert_no_secret(text, "production_blocker_checklist")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def field(value: Any, default: str = "missing") -> str:
    text = str(value).strip()
    return text if text else default


def code(value: Any) -> str:
    return f"`{field(value)}`"


def first_blocker(step: dict[str, Any]) -> str:
    return field(step.get("first_blocker"), "not reported")


def command_block(command: str) -> list[str]:
    return ["```bash", command, "```"]


def packet_status(packet: dict[str, Any]) -> str:
    return field(packet.get("status"), "missing")


def packet_first_blocker(packet: dict[str, Any]) -> str:
    for path in (
        ("live_proof", "blocked_diagnostic", "first_blocker"),
        ("proof", "blocked_diagnostic", "first_blocker"),
        ("source_probe", "source_diagnostic", "first_blocker"),
    ):
        value: Any = packet
        for key in path:
            if not isinstance(value, dict):
                value = ""
                break
            value = value.get(key)
        if str(value).strip():
            return str(value)
    blocked = string_list(packet.get("blocked_until"))
    return blocked[0] if blocked else "not reported"


def packet_command(packet: dict[str, Any]) -> str:
    for path in (
        ("live_proof", "proof_generator_command"),
        ("proof", "proof_generator_command"),
    ):
        value: Any = packet
        for key in path:
            if not isinstance(value, dict):
                value = ""
                break
            value = value.get(key)
        if str(value).strip():
            return str(value)
    execution_order = string_list(packet.get("execution_order"))
    return execution_order[0] if execution_order else "not reported"


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


def render_group_table(groups: list[dict[str, Any]]) -> list[str]:
    lines = [
        "## Blocking Input Groups",
        "",
        "| Group | Configured | Total | Percent | Missing | Invalid | Blockers |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for group in groups:
        lines.append(
            "| "
            f"{field(group.get('group_id'))} | "
            f"{field(group.get('required_configured'))} | "
            f"{field(group.get('required_total'))} | "
            f"{field(group.get('completion_percent'))}% | "
            f"{field(group.get('required_missing'))} | "
            f"{field(group.get('required_invalid'))} | "
            f"{field(group.get('blocking_input_count'))} |"
        )
    lines.append("")
    return lines


def render_probe_table(steps: list[dict[str, Any]]) -> list[str]:
    lines = [
        "## Production Source Probes",
        "",
        "| Order | Step | Probe | Ready | Percent | Blockers | First Blocker |",
        "| ---: | --- | --- | --- | ---: | ---: | --- |",
    ]
    for step in steps:
        lines.append(
            "| "
            f"{field(step.get('order'))} | "
            f"{field(step.get('step_id'))} | "
            f"{field(step.get('probe_id'))} | "
            f"{field(step.get('ready_to_execute'))} | "
            f"{field(step.get('completion_percent'))}% | "
            f"{field(step.get('blocking_input_count'))} | "
            f"{first_blocker(step)} |"
        )
    lines.append("")
    return lines


def render_packet_section(
    title: str,
    packet: dict[str, Any],
    *,
    required_label: str,
    details: list[str],
) -> list[str]:
    lines = [
        f"## {title}",
        "",
        f"- Status: {code(packet_status(packet))}",
        f"- Release gate decision: {code(packet.get('release_gate_decision'))}",
        f"- Release gate check: {code(packet.get('release_gate_check_id'))}",
        f"- Required {required_label} count: {code(packet_required_count(packet))}",
        f"- First blocker: {packet_first_blocker(packet)}",
        f"- Can clear Stage 1 production launch gate: {code(packet.get('can_clear_stage1_production_launch_gate'))}",
        f"- Can close do-not-launch: {code(packet.get('can_close_do_not_launch'))}",
        "",
    ]
    if details:
        lines.append("Required material:")
        for item in details:
            lines.append(f"- {item}")
        lines.append("")
    lines.extend(["Primary proof command:", ""])
    lines.extend(command_block(packet_command(packet)))
    lines.append("")
    for command in string_list(packet.get("execution_order"))[1:]:
        lines.extend(["Follow-up command:", ""])
        lines.extend(command_block(command))
        lines.append("")
    return lines


def render_dns_section(packet: dict[str, Any]) -> list[str]:
    summary = packet.get("summary") if isinstance(packet.get("summary"), dict) else {}
    lines = [
        "## DNS And HTTPS",
        "",
        f"- Status: {code(packet_status(packet))}",
        f"- Release gate decision: {code(packet.get('release_gate_decision'))}",
        f"- Production web URL: {code(packet.get('production_web_url'))}",
        f"- DNS blocker count: {code(summary.get('dns_blocker_count'))}",
        f"- Required input count: {code(summary.get('required_input_count'))}",
        f"- Production resolver: {code(summary.get('production_system_resolver_status'))}",
        f"- Production A: {code(summary.get('production_a_status'))}",
        f"- Production AAAA: {code(summary.get('production_aaaa_status'))}",
        f"- Can clear Stage 1 production launch gate: {code(packet.get('can_clear_stage1_production_launch_gate'))}",
        f"- Can close do-not-launch: {code(packet.get('can_close_do_not_launch'))}",
        "",
        "Required inputs:",
    ]
    for item in string_list(packet.get("required_inputs")):
        lines.append(f"- {item}")
    lines.extend(["", "Recommended records:"])
    for row in packet.get("recommended_records", []) if isinstance(packet.get("recommended_records"), list) else []:
        if isinstance(row, dict):
            lines.append(
                f"- {field(row.get('host'))}: {field(row.get('type'))} "
                f"{field(row.get('name'))} -> {field(row.get('content'))}, proxied {field(row.get('proxied'))}"
            )
    lines.append("")
    for command in string_list(packet.get("verification_commands")):
        lines.extend(["Verification command:", ""])
        lines.extend(command_block(command))
        lines.append("")
    for command in string_list(packet.get("commands_after_inputs")):
        lines.extend(["After-input command:", ""])
        lines.extend(command_block(command))
        lines.append("")
    return lines


def render_checklist(args: argparse.Namespace) -> str:
    brief = load_json(args.operator_brief)
    missing = load_json(args.missing_input_checklist)
    runbook = load_json(args.source_runbook)
    dns = load_json(args.dns_packet)
    billing = load_json(args.billing_packet)
    security = load_json(args.security_packet)
    governance = load_json(args.governance_packet)

    brief_summary = brief.get("summary") if isinstance(brief.get("summary"), dict) else {}
    missing_summary = missing.get("summary") if isinstance(missing.get("summary"), dict) else {}
    runbook_summary = runbook.get("summary") if isinstance(runbook.get("summary"), dict) else {}
    groups = missing.get("groups") if isinstance(missing.get("groups"), list) else []
    steps = runbook.get("steps") if isinstance(runbook.get("steps"), list) else []

    lines = [
        "# Stage 1 Final Production Blocker Checklist",
        "",
        "This is a non-clearing operator checklist. It summarizes final production blockers and preserves no_go until strict production evidence exists.",
        "",
        f"Generated at: {code(now())}",
        f"Stage1 gates: {code(brief_summary.get('stage1_gates_completed'))} / {code(brief_summary.get('stage1_gates_total'))} = {code(str(brief_summary.get('stage1_completion_percent')) + '%')}",
        f"Production inputs: {code(missing_summary.get('required_configured'))} / {code(missing_summary.get('required_total'))} = {code(str(missing_summary.get('required_completion_percent')) + '%')}",
        f"Production inputs missing: {code(missing_summary.get('required_missing'))}",
        f"Production inputs invalid: {code(missing_summary.get('required_invalid'))}",
        f"Blocking production inputs: {code(missing_summary.get('blocking_input_count'))}",
        f"Production source probes ready: {code(runbook_summary.get('ready_to_execute_count'))} / {code(runbook_summary.get('runbook_step_count'))}",
        f"Production source probes blocked: {code(runbook_summary.get('blocked_step_count'))}",
        f"Source-probe blocking input count: {code(runbook_summary.get('blocking_input_count'))}",
        f"Release decision: {code('no_go')}",
        "",
    ]
    lines.extend(render_group_table(groups))
    lines.extend(render_probe_table(steps))
    lines.extend(render_dns_section(dns))
    lines.extend(
        render_packet_section(
            "Billing Live Stripe Lifecycle",
            billing,
            required_label="live artifact",
            details=[
                f"{field(item.get('flag'))} with prefix {field(item.get('prefix'))}"
                for item in billing.get("required_live_artifacts", [])
                if isinstance(item, dict)
            ],
        )
    )
    lines.extend(
        render_packet_section(
            "Security Launch Checks",
            security,
            required_label="runtime ref",
            details=[
                f"{field(item.get('flag'))} for {field(item.get('section'))}"
                for item in security.get("required_security_runtime_refs", [])
                if isinstance(item, dict)
            ],
        )
    )
    governance_details: list[str] = []
    for component in governance.get("required_governance_components", []) if isinstance(governance.get("required_governance_components"), list) else []:
        if not isinstance(component, dict):
            continue
        governance_details.append(f"{field(component.get('component'))}: {field(component.get('runtime_flag'))}")
        governance_details.append(f"{field(component.get('component'))}: {field(component.get('audit_flag'))}")
        for item in component.get("required_ids", []) if isinstance(component.get("required_ids"), list) else []:
            if isinstance(item, dict):
                governance_details.append(f"{field(component.get('component'))}: {field(item.get('flag'))}")
        for item in component.get("required_section_refs", []) if isinstance(component.get("required_section_refs"), list) else []:
            if isinstance(item, dict):
                governance_details.append(f"{field(component.get('component'))}: {field(item.get('flag'))}")
    lines.extend(
        render_packet_section(
            "Governance Release",
            governance,
            required_label="runtime/audit/id/ref",
            details=governance_details,
        )
    )
    lines.extend(
        [
            "## Source JSON",
            "",
            f"- Operator brief: {code(display_path(args.operator_brief))}",
            f"- Missing input checklist: {code(display_path(args.missing_input_checklist))}",
            f"- Source probe runbook: {code(display_path(args.source_runbook))}",
            f"- DNS packet: {code(display_path(args.dns_packet))}",
            f"- Billing packet: {code(display_path(args.billing_packet))}",
            f"- Security packet: {code(display_path(args.security_packet))}",
            f"- Governance packet: {code(display_path(args.governance_packet))}",
            "",
        ]
    )
    text = "\n".join(lines)
    assert_no_secret(text, "production_blocker_checklist")
    return text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--operator-brief", type=Path, default=DEFAULT_OPERATOR_BRIEF)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_MISSING_INPUT_CHECKLIST)
    parser.add_argument("--source-runbook", type=Path, default=DEFAULT_SOURCE_RUNBOOK)
    parser.add_argument("--dns-packet", type=Path, default=DEFAULT_DNS_PACKET)
    parser.add_argument("--billing-packet", type=Path, default=DEFAULT_BILLING_PACKET)
    parser.add_argument("--security-packet", type=Path, default=DEFAULT_SECURITY_PACKET)
    parser.add_argument("--governance-packet", type=Path, default=DEFAULT_GOVERNANCE_PACKET)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def validate_contract() -> None:
    if DNS_PLAN_PRIVATE_ENV_COMMAND == DNS_APPLY_PRIVATE_ENV_COMMAND:
        raise SystemExit("DNS private-env plan/apply command contract mismatch")
    if "--env <private-production-env>" not in DNS_PLAN_PRIVATE_ENV_COMMAND:
        raise SystemExit("DNS private-env plan command missing private env placeholder")
    if "--env <private-production-env>" not in DNS_APPLY_PRIVATE_ENV_COMMAND or "--apply" not in DNS_APPLY_PRIVATE_ENV_COMMAND:
        raise SystemExit("DNS private-env apply command missing reviewable apply shape")
    print("stage1 production blocker checklist generator contract passed")


def main() -> int:
    args = parse_args()
    if args.contract_only:
        validate_contract()
        return 0
    write_text(args.output, render_checklist(args))
    print(f"wrote Stage 1 production blocker checklist to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
