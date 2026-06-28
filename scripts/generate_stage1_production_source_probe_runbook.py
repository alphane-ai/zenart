#!/usr/bin/env python3
"""Generate the non-clearing Stage 1 production source probe runbook.

The runbook is an operator handoff only. It sequences the final production
source probes and links each step to the missing-input checklist, operator
packet, canonical source output, diagnostic path, and strict validator. It must
never store secret values or raw provider/Stripe/support payloads.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
DEFAULT_INPUT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-input-packet.json"
DEFAULT_OPERATOR_BRIEF = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
DEFAULT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_PIPELINE = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"

STEP_CONTRACT = [
    {
        "step_id": "production_dns_https",
        "coverage_group": "production_dns",
        "probe_id": "production_legal_support_policy",
        "gate_ids": ["stage1_production_launch_preflight", "production_legal_support_policy"],
        "operator_packet_ref": "ops/evidence/non_clearing/production-legal-support-operator-packet.json",
        "operator_next_action": "Finish production DNS/HTTPS cutover and rerun the legal/support source probe against public production pages.",
    },
    {
        "step_id": "production_paid_billing_lifecycle",
        "coverage_group": "billing",
        "probe_id": "production_paid_billing_lifecycle",
        "gate_ids": ["stage1_production_launch_preflight", "production_paid_billing_lifecycle"],
        "operator_packet_ref": "ops/evidence/non_clearing/production-billing-operator-packet.json",
        "operator_next_action": "Collect sanitized live Stripe production proof, validate it, then write the billing canonical source.",
    },
    {
        "step_id": "production_security_launch_checks",
        "coverage_group": "security",
        "probe_id": "production_security_launch_checks",
        "gate_ids": ["stage1_production_launch_preflight", "production_security_launch_checks"],
        "operator_packet_ref": "ops/evidence/non_clearing/production-security-operator-packet.json",
        "operator_next_action": "Attach sanitized production security runtime refs and write the security canonical source.",
    },
    {
        "step_id": "production_governance_release",
        "coverage_group": "governance",
        "probe_id": "production_governance_release",
        "gate_ids": ["stage1_production_launch_preflight", "production_governance_release"],
        "operator_packet_ref": "ops/evidence/non_clearing/production-governance-operator-packet.json",
        "operator_next_action": "Attach sanitized production activation, abuse, and skill-release refs before writing governance source.",
    },
]

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

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
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


class ProductionSourceProbeRunbookError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionSourceProbeRunbookError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionSourceProbeRunbookError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionSourceProbeRunbookError(f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_source_probe_runbook")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionSourceProbeRunbookError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionSourceProbeRunbookError(f"{path} contains raw secret-looking material")


def safe_string(value: Any, limit: int = 320) -> str:
    text = str(value or "").strip()
    folded = " ".join(line.strip() for line in text.splitlines() if line.strip())
    folded = RAW_SECRET_RE.sub("[redacted]", folded)
    return folded[:limit]


def safe_string_list(value: Any, *, limit: int = 16, item_limit: int = 220) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value[:limit]:
        text = safe_string(item, item_limit)
        if text:
            result.append(text)
    return result


def group_by_id(checklist: dict[str, Any]) -> dict[str, dict[str, Any]]:
    groups = checklist.get("groups")
    if not isinstance(groups, list):
        raise ProductionSourceProbeRunbookError("missing-input checklist missing groups")
    mapped: dict[str, dict[str, Any]] = {}
    for group in groups:
        if isinstance(group, dict) and isinstance(group.get("group_id"), str):
            mapped[group["group_id"]] = group
    return mapped


def source_input_by_probe(input_packet: dict[str, Any]) -> dict[str, dict[str, Any]]:
    source_inputs = input_packet.get("source_inputs")
    if not isinstance(source_inputs, list):
        raise ProductionSourceProbeRunbookError("production launch input packet missing source_inputs")
    mapped: dict[str, dict[str, Any]] = {}
    for item in source_inputs:
        if isinstance(item, dict) and isinstance(item.get("probe_id"), str):
            mapped[item["probe_id"]] = item
    return mapped


def unique_safe_strings(values: list[Any], *, item_limit: int = 220) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = safe_string(value, item_limit)
        if text and text not in seen:
            result.append(text)
            seen.add(text)
    return result


def group_evidence_policy(group: dict[str, Any]) -> dict[str, Any]:
    items = group.get("items") if isinstance(group.get("items"), list) else []
    acceptable_sources = unique_safe_strings(
        [item.get("acceptable_evidence_source") for item in items if isinstance(item, dict)]
    )
    disallowed_substitutes = unique_safe_strings(
        [
            substitute
            for item in items
            if isinstance(item, dict)
            for substitute in (item.get("disallowed_substitutes") if isinstance(item.get("disallowed_substitutes"), list) else [])
        ]
    )
    sandbox_or_staging_flags = [
        item.get("can_be_satisfied_by_existing_sandbox_or_staging_resources")
        for item in items
        if isinstance(item, dict)
    ]
    can_use_existing_sandbox_or_staging = bool(sandbox_or_staging_flags) and all(
        flag is True for flag in sandbox_or_staging_flags
    )
    return {
        "acceptable_evidence_sources": acceptable_sources,
        "disallowed_substitutes": disallowed_substitutes,
        "can_be_satisfied_by_existing_sandbox_or_staging_resources": can_use_existing_sandbox_or_staging,
    }


def read_operator_packet(ref: str) -> dict[str, Any]:
    return read_json(ROOT / ref)


def build_step(
    order: int,
    contract: dict[str, Any],
    checklist_groups: dict[str, dict[str, Any]],
    source_inputs: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    group_id = contract["coverage_group"]
    probe_id = contract["probe_id"]
    group = checklist_groups.get(group_id)
    if not isinstance(group, dict):
        raise ProductionSourceProbeRunbookError(f"missing checklist group {group_id}")
    source_input = source_inputs.get(probe_id)
    if not isinstance(source_input, dict):
        raise ProductionSourceProbeRunbookError(f"missing source input {probe_id}")
    operator_packet_ref = contract["operator_packet_ref"]
    operator_packet = read_operator_packet(operator_packet_ref)
    packet_probe = operator_packet.get("source_probe") if isinstance(operator_packet.get("source_probe"), dict) else {}
    source_diagnostic = packet_probe.get("source_diagnostic") if isinstance(packet_probe.get("source_diagnostic"), dict) else {}
    dns_readiness = operator_packet.get("dns_readiness") if isinstance(operator_packet.get("dns_readiness"), dict) else {}
    items = group.get("items") if isinstance(group.get("items"), list) else []
    missing_or_invalid = []
    for item in items:
        if not isinstance(item, dict):
            continue
        names = item.get("accepted_variable_names")
        if isinstance(names, list) and names:
            missing_or_invalid.append(" or ".join(safe_string(name) for name in names if safe_string(name)))
        else:
            missing_or_invalid.append(safe_string(item.get("display_name")))
    evidence_policy = group_evidence_policy(group)
    first_blocker = (
        safe_string(dns_readiness.get("first_blocker")) if group_id == "production_dns" else ""
    ) or (
        safe_string(source_input.get("first_blocker"))
        or safe_string(source_diagnostic.get("first_blocker"))
        or (missing_or_invalid[0] if missing_or_invalid else "production input missing")
    )
    return {
        "step_id": contract["step_id"],
        "order": order,
        "coverage_group": group_id,
        "probe_id": probe_id,
        "gate_ids": contract["gate_ids"],
        "status": "blocked",
        "ready_to_execute": False,
        "blocking_input_count": group.get("blocking_input_count"),
        "required_total": group.get("required_total"),
        "required_configured": group.get("required_configured"),
        "completion_percent": group.get("completion_percent"),
        "required_before": [] if order == 1 else [STEP_CONTRACT[0]["step_id"]],
        "source_probe_command": safe_string(source_input.get("source_probe_command"), 600),
        "source_output_path": safe_string(source_input.get("source_path")),
        "diagnostic_path": safe_string(source_input.get("diagnostic_path")),
        "strict_validator": safe_string(source_input.get("strict_validator")),
        "evidence_generator": safe_string(source_input.get("evidence_generator")),
        "operator_packet_ref": operator_packet_ref,
        "source_template_ref": source_input.get("source_template_ref"),
        "proof_template_ref": source_input.get("proof_template_ref"),
        "first_blocker": first_blocker,
        "missing_or_invalid_inputs": missing_or_invalid,
        "acceptable_evidence_sources": evidence_policy["acceptable_evidence_sources"],
        "disallowed_substitutes": evidence_policy["disallowed_substitutes"],
        "can_be_satisfied_by_existing_sandbox_or_staging_resources": evidence_policy[
            "can_be_satisfied_by_existing_sandbox_or_staging_resources"
        ],
        "blocked_until": safe_string_list(operator_packet.get("blocked_until"), limit=12),
        "operator_next_action": contract["operator_next_action"],
    }


def build_runbook(args: argparse.Namespace) -> dict[str, Any]:
    input_packet = read_json(args.launch_input_packet)
    operator_brief = read_json(args.launch_operator_brief)
    checklist = read_json(args.missing_input_checklist)
    pipeline = read_json(args.launch_source_pipeline)
    checklist_groups = group_by_id(checklist)
    source_inputs = source_input_by_probe(input_packet)
    steps = [
        build_step(idx + 1, contract, checklist_groups, source_inputs)
        for idx, contract in enumerate(STEP_CONTRACT)
    ]
    checklist_summary = checklist.get("summary") if isinstance(checklist.get("summary"), dict) else {}
    brief_summary = operator_brief.get("summary") if isinstance(operator_brief.get("summary"), dict) else {}
    data: dict[str, Any] = {
        "schema_version": "stage1.production_source_probe_runbook.v1",
        "kind": "stage1_production_source_probe_runbook",
        "environment": "production",
        "status": "blocked",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "non_clearing_runbook": True,
        "canonical_pass_path": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "value_redaction": "variable_names_only",
        "source_refs": {
            "production_launch_input_packet": display_path(args.launch_input_packet),
            "production_launch_operator_brief": display_path(args.launch_operator_brief),
            "production_missing_input_checklist": display_path(args.missing_input_checklist),
            "production_launch_source_pipeline": display_path(args.launch_source_pipeline),
        },
        "summary": {
            "runbook_step_count": len(steps),
            "ready_to_execute_count": 0,
            "blocked_step_count": len(steps),
            "blocking_input_count": checklist_summary.get("blocking_input_count"),
            "production_inputs_configured": checklist_summary.get("required_configured"),
            "production_inputs_total": checklist_summary.get("required_total"),
            "production_inputs_missing": checklist_summary.get("required_missing"),
            "production_inputs_invalid": checklist_summary.get("required_invalid"),
            "production_inputs_completion_percent": checklist_summary.get("required_completion_percent"),
            "stage1_gates_completed": brief_summary.get("stage1_gates_completed"),
            "stage1_gates_total": brief_summary.get("stage1_gates_total"),
            "stage1_completion_percent": brief_summary.get("stage1_completion_percent"),
        },
        "pipeline_state": {
            "status": pipeline.get("status"),
            "release_gate_decision": pipeline.get("release_gate_decision"),
            "canonical_sources_requested": pipeline.get("canonical_sources_requested"),
            "canonical_sources_may_be_written": pipeline.get("canonical_sources_may_be_written"),
            "aggregate_attempted": pipeline.get("aggregate_attempted"),
            "blocked_checks": safe_string_list(pipeline.get("blocked_checks"), limit=8, item_limit=300),
        },
        "steps": steps,
        "operator_next_actions": [
            "Execute steps only after real production inputs are available; staging, local, sandbox, and templates remain non-clearing.",
            "After every canonical source is written, run each strict validator and then run the aggregate production launch validator.",
            "Keep production launch no_go until strict production evidence replaces every missing or invalid input in the checklist.",
            "Do not persist secret values, authorization headers, cookies, signed URLs, raw prompts, or raw provider/Stripe payloads.",
        ],
        "gate_impact": {
            "can_clear_stage1_production_launch_gate": False,
            "can_close_do_not_launch": False,
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "non_clearing_evidence_only": True,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "production_source_probe_runbook")
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--launch-input-packet", type=Path, default=DEFAULT_INPUT_PACKET)
    parser.add_argument("--launch-operator-brief", type=Path, default=DEFAULT_OPERATOR_BRIEF)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_CHECKLIST)
    parser.add_argument("--launch-source-pipeline", type=Path, default=DEFAULT_PIPELINE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        expected = [
            "production_dns_https",
            "production_paid_billing_lifecycle",
            "production_security_launch_checks",
            "production_governance_release",
        ]
        if [item["step_id"] for item in STEP_CONTRACT] != expected:
            raise SystemExit("stage1 production source probe runbook step contract mismatch")
        print("stage1 production source probe runbook contract passed")
        return 0
    data = build_runbook(args)
    write_json(args.output, data)
    print(f"wrote Stage 1 production source probe runbook to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
