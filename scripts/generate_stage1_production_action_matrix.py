#!/usr/bin/env python3
"""Generate a short, non-clearing action matrix for final production blockers.

This artifact is intentionally smaller than the full production blocker
checklist. It groups the remaining production-only blockers into the lanes an
operator can act on, while preserving the launch no-go state and never storing
secret values.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MISSING_INPUT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
DEFAULT_DNS_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-repair-packet.json"
DEFAULT_BILLING_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-billing-operator-packet.json"
DEFAULT_SECURITY_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-security-operator-packet.json"
DEFAULT_GOVERNANCE_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-operator-packet.json"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.json"
DEFAULT_MARKDOWN = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.md"

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

LANE_ORDER = [
    "production_dns_https",
    "production_live_billing",
    "production_security_runtime",
    "production_governance_release",
]


class ProductionActionMatrixError(Exception):
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
        raise ProductionActionMatrixError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionActionMatrixError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionActionMatrixError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionActionMatrixError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionActionMatrixError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_action_matrix")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    assert_no_secret(text, "production_action_matrix_markdown")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def first_n(value: Any, count: int) -> list[str]:
    return string_list(value)[:count]


def group_by_id(missing: dict[str, Any]) -> dict[str, dict[str, Any]]:
    groups = missing.get("groups")
    if not isinstance(groups, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for group in groups:
        if isinstance(group, dict) and isinstance(group.get("group_id"), str):
            result[group["group_id"]] = group
    return result


def step_by_id(runbook: dict[str, Any]) -> dict[str, dict[str, Any]]:
    steps = runbook.get("steps")
    if not isinstance(steps, list):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for step in steps:
        if isinstance(step, dict) and isinstance(step.get("step_id"), str):
            result[step["step_id"]] = step
    return result


def packet_commands(packet: dict[str, Any], *, cap: int = 4) -> list[str]:
    commands = string_list(packet.get("commands_after_inputs")) or string_list(packet.get("execution_order"))
    return commands[:cap]


def packet_required_names(packet: dict[str, Any], group: dict[str, Any], *, cap: int = 12) -> list[str]:
    names = first_n(group.get("first_missing_required_inputs"), cap)
    names.extend(first_n(group.get("invalid_required_inputs"), cap))
    if names:
        return names[:cap]
    if isinstance(packet.get("required_inputs"), list):
        return first_n(packet.get("required_inputs"), cap)
    if isinstance(packet.get("required_live_artifacts"), list):
        return [str(item.get("name")) for item in packet["required_live_artifacts"] if isinstance(item, dict)][:cap]
    if isinstance(packet.get("required_security_runtime_refs"), list):
        return [str(item.get("flag")) for item in packet["required_security_runtime_refs"] if isinstance(item, dict)][:cap]
    if isinstance(packet.get("required_governance_components"), list):
        names = []
        for component in packet["required_governance_components"]:
            if not isinstance(component, dict):
                continue
            for key in ("runtime_flag", "audit_flag"):
                if component.get(key):
                    names.append(str(component[key]))
            for item in component.get("required_ids", []) if isinstance(component.get("required_ids"), list) else []:
                if isinstance(item, dict) and item.get("flag"):
                    names.append(str(item["flag"]))
            for item in component.get("required_section_refs", []) if isinstance(component.get("required_section_refs"), list) else []:
                if isinstance(item, dict) and item.get("flag"):
                    names.append(str(item["flag"]))
        return names[:cap]
    return []


def lane(
    *,
    lane_id: str,
    order: int,
    title: str,
    owner: str,
    help_kind: str,
    group: dict[str, Any],
    step: dict[str, Any],
    packet: dict[str, Any],
    immediate_action: str,
    agent_action_after_inputs: str,
    cap_required: int = 12,
) -> dict[str, Any]:
    blocker_count = int(group.get("blocking_input_count") or step.get("blocking_input_count") or 0)
    return {
        "lane_id": lane_id,
        "order": order,
        "title": title,
        "status": "blocked" if blocker_count else "ready",
        "owner": owner,
        "help_kind": help_kind,
        "blocking_input_count": blocker_count,
        "completion_percent": group.get("completion_percent", step.get("completion_percent", 0)),
        "required_configured": group.get("required_configured", step.get("required_configured", 0)),
        "required_total": group.get("required_total", step.get("required_total", 0)),
        "first_blocker": step.get("first_blocker") or (string_list(packet.get("blocked_until")) or ["not reported"])[0],
        "immediate_action": immediate_action,
        "agent_action_after_inputs": agent_action_after_inputs,
        "agent_can_execute_now": False,
        "agent_can_execute_after_inputs": True,
        "required_user_material": packet_required_names(packet, group, cap=cap_required),
        "blocked_until": first_n(step.get("blocked_until") or packet.get("blocked_until"), 8),
        "automation_commands": packet_commands(packet, cap=4),
        "source_probe_command": step.get("source_probe_command", ""),
        "evidence_generator": step.get("evidence_generator", ""),
        "strict_validator": step.get("strict_validator", ""),
        "operator_packet_ref": step.get("operator_packet_ref", ""),
        "source_output_path": step.get("source_output_path", ""),
    }


def build_matrix(args: argparse.Namespace) -> dict[str, Any]:
    missing = load_json(args.missing_input_checklist)
    runbook = load_json(args.source_runbook)
    dns = load_json(args.dns_packet)
    billing = load_json(args.billing_packet)
    security = load_json(args.security_packet)
    governance = load_json(args.governance_packet)

    groups = group_by_id(missing)
    steps = step_by_id(runbook)
    summary = missing.get("summary") if isinstance(missing.get("summary"), dict) else {}
    runbook_summary = runbook.get("summary") if isinstance(runbook.get("summary"), dict) else {}

    lanes = [
        lane(
            lane_id="production_dns_https",
            order=1,
            title="Production DNS and HTTPS",
            owner="operator_dns_control",
            help_kind="cloudflare_zone_token_and_target_or_manual_dns_change",
            group=groups.get("production_dns", {}),
            step=steps.get("production_dns_https", {}),
            packet=dns,
            immediate_action="Provide PRODUCTION_DNS_TARGET plus Cloudflare zone/token, or apply the apex/www records manually.",
            agent_action_after_inputs="Run DNS readiness, cutover plan, legal/support source probe, and strict production legal/support evidence.",
        ),
        lane(
            lane_id="production_live_billing",
            order=2,
            title="Production Stripe live billing lifecycle",
            owner="operator_live_stripe_account",
            help_kind="live_stripe_runtime_and_sanitized_live_artifact_ids",
            group=groups.get("billing", {}),
            step=steps.get("production_paid_billing_lifecycle", {}),
            packet=billing,
            immediate_action="Use live Stripe mode and collect sanitized live checkout, subscription, invoice, refund, quota, and webhook IDs.",
            agent_action_after_inputs="Validate the sanitized live billing proof, write canonical billing source, and generate strict billing evidence.",
        ),
        lane(
            lane_id="production_security_runtime",
            order=3,
            title="Production security launch checks",
            owner="agent_after_production_https_with_operator_refs",
            help_kind="production_runtime_security_refs",
            group=groups.get("security", {}),
            step=steps.get("production_security_launch_checks", {}),
            packet=security,
            immediate_action="Attach production runtime refs for session cookie, CSRF, redaction, admin privacy, key containment, CSP, RBAC, audit, and spend caps.",
            agent_action_after_inputs="Validate the security proof, write canonical security source, and generate strict production security evidence.",
        ),
        lane(
            lane_id="production_governance_release",
            order=4,
            title="Production governance release evidence",
            owner="operator_production_audit_refs",
            help_kind="production_runtime_request_ids_and_immutable_audit_refs",
            group=groups.get("governance", {}),
            step=steps.get("production_governance_release", {}),
            packet=governance,
            immediate_action="Provide activation, abuse, and skill release runtime request IDs plus immutable production audit refs.",
            agent_action_after_inputs="Validate governance proof, write canonical governance source, and generate strict governance release evidence.",
        ),
    ]

    blocker_total = sum(int(item["blocking_input_count"]) for item in lanes)
    data: dict[str, Any] = {
        "schema_version": "stage1.production_action_matrix.v1",
        "kind": "stage1_production_action_matrix",
        "environment": "production",
        "generated_at": now(),
        "status": "blocked" if blocker_total else "ready",
        "release_gate_decision": "no_go",
        "non_clearing_action_matrix": True,
        "canonical_pass_path": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "summary": {
            "stage1_gates_completed": runbook_summary.get("stage1_gates_completed"),
            "stage1_gates_total": runbook_summary.get("stage1_gates_total"),
            "stage1_completion_percent": runbook_summary.get("stage1_completion_percent"),
            "production_inputs_configured": summary.get("required_configured"),
            "production_inputs_total": summary.get("required_total"),
            "production_inputs_completion_percent": summary.get("required_completion_percent"),
            "production_inputs_missing": summary.get("required_missing"),
            "production_inputs_invalid": summary.get("required_invalid"),
            "blocking_input_count": blocker_total,
            "source_probes_ready": runbook_summary.get("ready_to_execute_count"),
            "source_probes_total": runbook_summary.get("runbook_step_count"),
            "source_probes_blocked": runbook_summary.get("blocked_step_count"),
        },
        "lanes": lanes,
        "immediate_user_help_queue": [
            {
                "rank": item["order"],
                "lane_id": item["lane_id"],
                "blocking_input_count": item["blocking_input_count"],
                "ask": item["immediate_action"],
                "first_required_material": item["required_user_material"][:4],
            }
            for item in lanes
            if item["blocking_input_count"]
        ],
        "not_current_blockers": [
            "staging aggregate is already go",
            "R2 zenari bucket is already a staging resource, not the current production blocker",
            "Stripe sandbox is not the current blocker; live mode proof is required",
            "z.ai/OpenAI-compatible LLM is not the current blocker",
            "worker/crawler/migrate are backend runtime entrypoints, not release images",
            "manager is legacy local-only and not a release surface",
        ],
        "source_refs": {
            "missing_input_checklist": display_path(args.missing_input_checklist),
            "source_runbook": display_path(args.source_runbook),
            "dns_packet": display_path(args.dns_packet),
            "billing_packet": display_path(args.billing_packet),
            "security_packet": display_path(args.security_packet),
            "governance_packet": display_path(args.governance_packet),
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "production_action_matrix")
    return data


def code(value: Any) -> str:
    text = str(value)
    return f"`{text}`"


def render_markdown(matrix: dict[str, Any]) -> str:
    summary = matrix.get("summary") if isinstance(matrix.get("summary"), dict) else {}
    lines = [
        "# Stage 1 Production Action Matrix",
        "",
        "This is a short non-clearing action matrix. It does not clear production launch or do-not-launch.",
        "",
        f"Generated at: {code(matrix.get('generated_at'))}",
        f"Release decision: {code(matrix.get('release_gate_decision'))}",
        f"Stage1 gates: {code(summary.get('stage1_gates_completed'))} / {code(summary.get('stage1_gates_total'))} = {code(str(summary.get('stage1_completion_percent')) + '%')}",
        f"Production inputs: {code(summary.get('production_inputs_configured'))} / {code(summary.get('production_inputs_total'))} = {code(str(summary.get('production_inputs_completion_percent')) + '%')}",
        f"Blocking production inputs: {code(summary.get('blocking_input_count'))}",
        f"Source probes ready: {code(summary.get('source_probes_ready'))} / {code(summary.get('source_probes_total'))}",
        "",
        "## Action Lanes",
        "",
        "| Order | Lane | Owner | Blockers | Percent | First blocker |",
        "| ---: | --- | --- | ---: | ---: | --- |",
    ]
    lanes = matrix.get("lanes") if isinstance(matrix.get("lanes"), list) else []
    for item in lanes:
        if not isinstance(item, dict):
            continue
        lines.append(
            "| "
            f"{item.get('order')} | "
            f"{item.get('title')} | "
            f"{item.get('owner')} | "
            f"{item.get('blocking_input_count')} | "
            f"{item.get('completion_percent')}% | "
            f"{item.get('first_blocker')} |"
        )
    lines.extend(["", "## Immediate Help Queue", ""])
    for item in matrix.get("immediate_user_help_queue", []) if isinstance(matrix.get("immediate_user_help_queue"), list) else []:
        if not isinstance(item, dict):
            continue
        lines.append(f"{item.get('rank')}. {item.get('lane_id')}: {item.get('ask')}")
        material = item.get("first_required_material") if isinstance(item.get("first_required_material"), list) else []
        if material:
            lines.append(f"   First required material: {', '.join(str(x) for x in material)}")
    lines.extend(["", "## Lane Details", ""])
    for item in lanes:
        if not isinstance(item, dict):
            continue
        lines.extend(
            [
                f"### {item.get('order')}. {item.get('title')}",
                "",
                f"- Help kind: {code(item.get('help_kind'))}",
                f"- Blocking inputs: {code(item.get('blocking_input_count'))}",
                f"- Immediate action: {item.get('immediate_action')}",
                f"- Agent action after inputs: {item.get('agent_action_after_inputs')}",
                f"- Source output: {code(item.get('source_output_path'))}",
                f"- Strict validator: {code(item.get('strict_validator'))}",
                "",
            ]
        )
        required = item.get("required_user_material") if isinstance(item.get("required_user_material"), list) else []
        if required:
            lines.append("Required material sample:")
            for name in required[:12]:
                lines.append(f"- {name}")
            lines.append("")
        commands = item.get("automation_commands") if isinstance(item.get("automation_commands"), list) else []
        if commands:
            lines.append("Automation commands after inputs:")
            for command in commands:
                lines.extend(["```bash", str(command), "```", ""])
    lines.extend(["## Not Current Blockers", ""])
    for item in matrix.get("not_current_blockers", []) if isinstance(matrix.get("not_current_blockers"), list) else []:
        lines.append(f"- {item}")
    lines.extend(["", "## Source JSON", ""])
    refs = matrix.get("source_refs") if isinstance(matrix.get("source_refs"), dict) else {}
    for key, value in refs.items():
        lines.append(f"- {key}: {code(value)}")
    text = "\n".join(lines)
    assert_no_secret(text, "production_action_matrix_markdown")
    return text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_MISSING_INPUT_CHECKLIST)
    parser.add_argument("--source-runbook", type=Path, default=DEFAULT_SOURCE_RUNBOOK)
    parser.add_argument("--dns-packet", type=Path, default=DEFAULT_DNS_PACKET)
    parser.add_argument("--billing-packet", type=Path, default=DEFAULT_BILLING_PACKET)
    parser.add_argument("--security-packet", type=Path, default=DEFAULT_SECURITY_PACKET)
    parser.add_argument("--governance-packet", type=Path, default=DEFAULT_GOVERNANCE_PACKET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--markdown", type=Path, default=DEFAULT_MARKDOWN)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if LANE_ORDER != [
            "production_dns_https",
            "production_live_billing",
            "production_security_runtime",
            "production_governance_release",
        ]:
            raise SystemExit("stage1 production action matrix lane contract mismatch")
        print("stage1 production action matrix generator contract passed")
        return 0
    matrix = build_matrix(args)
    write_json(args.output, matrix)
    write_text(args.markdown, render_markdown(matrix))
    print(f"wrote Stage 1 production action matrix to {display_path(args.output)} and {display_path(args.markdown)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
