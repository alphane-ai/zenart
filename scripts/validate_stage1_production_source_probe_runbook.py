#!/usr/bin/env python3
"""Validate the non-clearing Stage 1 production source probe runbook."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
DEFAULT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_INPUT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-input-packet.json"
DEFAULT_OPERATOR_BRIEF = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
DEFAULT_PIPELINE = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"

STEP_CONTRACT = [
    {
        "step_id": "production_dns_https",
        "coverage_group": "production_dns",
        "probe_id": "production_legal_support_policy",
        "operator_packet_ref": "ops/evidence/non_clearing/production-legal-support-operator-packet.json",
        "source_output_path": "ops/evidence/production/production-legal-support-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.legal-support.json",
        "strict_validator": "python3 scripts/validate_stage1_production_legal_support_evidence.py",
    },
    {
        "step_id": "production_paid_billing_lifecycle",
        "coverage_group": "billing",
        "probe_id": "production_paid_billing_lifecycle",
        "operator_packet_ref": "ops/evidence/non_clearing/production-billing-operator-packet.json",
        "source_output_path": "ops/evidence/production/billing-paid-lifecycle-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.billing.json",
        "strict_validator": "python3 scripts/validate_stage1_production_billing_evidence.py",
    },
    {
        "step_id": "production_security_launch_checks",
        "coverage_group": "security",
        "probe_id": "production_security_launch_checks",
        "operator_packet_ref": "ops/evidence/non_clearing/production-security-operator-packet.json",
        "source_output_path": "ops/evidence/production/production-security-launch-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.security.json",
        "strict_validator": "python3 scripts/validate_stage1_production_security_launch_evidence.py",
    },
    {
        "step_id": "production_governance_release",
        "coverage_group": "governance",
        "probe_id": "production_governance_release",
        "operator_packet_ref": "ops/evidence/non_clearing/production-governance-operator-packet.json",
        "source_output_path": "ops/evidence/production/production-governance-release-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.governance.json",
        "strict_validator": "python3 scripts/validate_stage1_production_governance_release_evidence.py",
    },
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


class ProductionSourceProbeRunbookValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionSourceProbeRunbookValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionSourceProbeRunbookValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionSourceProbeRunbookValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def require_optional_string(value: Any, path: str) -> str | None:
    if value is None:
        return None
    return require_string(value, path)


def require_bool(value: Any, path: str) -> bool:
    require(isinstance(value, bool), f"{path} must be bool")
    return value


def require_non_negative_int(value: Any, path: str) -> int:
    require(isinstance(value, int), f"{path} must be int")
    require(value >= 0, f"{path} must be non-negative")
    return value


def require_percent(value: Any, path: str) -> float:
    require(isinstance(value, (int, float)), f"{path} must be numeric")
    numeric = float(value)
    require(math.isfinite(numeric), f"{path} must be finite")
    require(0 <= numeric <= 100, f"{path} must be between 0 and 100")
    return numeric


def validate_string_list(value: Any, path: str, *, max_len: int, allow_empty: bool = False) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    require(allow_empty or bool(value), f"{path} must be non-empty")
    require(len(value) <= max_len, f"{path} must contain at most {max_len} items")
    result: list[str] = []
    for idx, item in enumerate(value):
        text = require_string(item, f"{path}[{idx}]")
        require(len(text) <= 700, f"{path}[{idx}] is too long")
        result.append(text)
    return result


def checklist_group_map(checklist: dict[str, Any]) -> dict[str, dict[str, Any]]:
    groups = checklist.get("groups")
    require(isinstance(groups, list), "checklist.groups must be list")
    mapped: dict[str, dict[str, Any]] = {}
    for idx, group in enumerate(groups):
        require(isinstance(group, dict), f"checklist.groups[{idx}] must be object")
        group_id = require_string(group.get("group_id"), f"checklist.groups[{idx}].group_id")
        mapped[group_id] = group
    return mapped


def source_input_map(input_packet: dict[str, Any]) -> dict[str, dict[str, Any]]:
    source_inputs = input_packet.get("source_inputs")
    require(isinstance(source_inputs, list), "input packet source_inputs must be list")
    mapped: dict[str, dict[str, Any]] = {}
    for idx, item in enumerate(source_inputs):
        require(isinstance(item, dict), f"input packet source_inputs[{idx}] must be object")
        probe_id = require_string(item.get("probe_id"), f"input packet source_inputs[{idx}].probe_id")
        mapped[probe_id] = item
    return mapped


def normalize_ref(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def validate_source_refs(data: dict[str, Any], expected: dict[str, str]) -> None:
    refs = data.get("source_refs")
    require(isinstance(refs, dict), "source_refs must be object")
    for key, value in expected.items():
        require(refs.get(key) == value, f"source_refs.{key} mismatch")


def validate_summary(data: dict[str, Any], checklist: dict[str, Any]) -> None:
    summary = data.get("summary")
    require(isinstance(summary, dict), "summary must be object")
    require(summary.get("runbook_step_count") == len(STEP_CONTRACT), "summary.runbook_step_count mismatch")
    require(summary.get("ready_to_execute_count") == 0, "summary.ready_to_execute_count must remain 0")
    require(summary.get("blocked_step_count") == len(STEP_CONTRACT), "summary.blocked_step_count mismatch")
    checklist_summary = checklist.get("summary")
    require(isinstance(checklist_summary, dict), "checklist.summary must be object")
    expected_pairs = {
        "blocking_input_count": "blocking_input_count",
        "production_inputs_configured": "required_configured",
        "production_inputs_total": "required_total",
        "production_inputs_missing": "required_missing",
        "production_inputs_invalid": "required_invalid",
        "production_inputs_completion_percent": "required_completion_percent",
    }
    for runbook_key, checklist_key in expected_pairs.items():
        require(summary.get(runbook_key) == checklist_summary.get(checklist_key), f"summary.{runbook_key} mismatch")
    require_non_negative_int(summary.get("stage1_gates_completed"), "summary.stage1_gates_completed")
    require_non_negative_int(summary.get("stage1_gates_total"), "summary.stage1_gates_total")
    require_percent(summary.get("stage1_completion_percent"), "summary.stage1_completion_percent")


def validate_pipeline_state(data: dict[str, Any], pipeline: dict[str, Any]) -> None:
    state = data.get("pipeline_state")
    require(isinstance(state, dict), "pipeline_state must be object")
    require(state.get("status") == pipeline.get("status") == "blocked", "pipeline_state.status mismatch")
    require(state.get("release_gate_decision") == pipeline.get("release_gate_decision") == "no_go", "pipeline no_go mismatch")
    require_bool(state.get("canonical_sources_requested"), "pipeline_state.canonical_sources_requested")
    require_bool(state.get("canonical_sources_may_be_written"), "pipeline_state.canonical_sources_may_be_written")
    require(state.get("canonical_sources_may_be_written") is False, "runbook cannot say canonical sources may be written")
    require_bool(state.get("aggregate_attempted"), "pipeline_state.aggregate_attempted")
    validate_string_list(state.get("blocked_checks"), "pipeline_state.blocked_checks", max_len=8)


def expected_missing_inputs(group: dict[str, Any]) -> list[str]:
    items = group.get("items")
    require(isinstance(items, list), f"{group.get('group_id')}.items must be list")
    result: list[str] = []
    for idx, item in enumerate(items):
        require(isinstance(item, dict), f"{group.get('group_id')}.items[{idx}] must be object")
        names = item.get("accepted_variable_names")
        if isinstance(names, list) and names:
            result.append(" or ".join(require_string(name, f"{group.get('group_id')}.items[{idx}].accepted_variable_names") for name in names))
        else:
            result.append(require_string(item.get("display_name"), f"{group.get('group_id')}.items[{idx}].display_name"))
    return result


def unique_strings(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value and value not in seen:
            result.append(value)
            seen.add(value)
    return result


def expected_acceptable_evidence_sources(group: dict[str, Any]) -> list[str]:
    items = group.get("items")
    require(isinstance(items, list), f"{group.get('group_id')}.items must be list")
    sources: list[str] = []
    for idx, item in enumerate(items):
        require(isinstance(item, dict), f"{group.get('group_id')}.items[{idx}] must be object")
        sources.append(
            require_string(
                item.get("acceptable_evidence_source"),
                f"{group.get('group_id')}.items[{idx}].acceptable_evidence_source",
            )
        )
    return unique_strings(sources)


def expected_disallowed_substitutes(group: dict[str, Any]) -> list[str]:
    items = group.get("items")
    require(isinstance(items, list), f"{group.get('group_id')}.items must be list")
    substitutes: list[str] = []
    for idx, item in enumerate(items):
        require(isinstance(item, dict), f"{group.get('group_id')}.items[{idx}] must be object")
        item_substitutes = item.get("disallowed_substitutes")
        require(isinstance(item_substitutes, list), f"{group.get('group_id')}.items[{idx}].disallowed_substitutes must be list")
        for substitute_idx, substitute in enumerate(item_substitutes):
            substitutes.append(
                require_string(
                    substitute,
                    f"{group.get('group_id')}.items[{idx}].disallowed_substitutes[{substitute_idx}]",
                )
            )
    return unique_strings(substitutes)


def expected_sandbox_or_staging_allowed(group: dict[str, Any]) -> bool:
    items = group.get("items")
    require(isinstance(items, list), f"{group.get('group_id')}.items must be list")
    require(bool(items), f"{group.get('group_id')}.items must be non-empty")
    flags: list[bool] = []
    for idx, item in enumerate(items):
        require(isinstance(item, dict), f"{group.get('group_id')}.items[{idx}] must be object")
        flags.append(
            require_bool(
                item.get("can_be_satisfied_by_existing_sandbox_or_staging_resources"),
                f"{group.get('group_id')}.items[{idx}].can_be_satisfied_by_existing_sandbox_or_staging_resources",
            )
        )
    return all(flags)


def validate_step(
    step: dict[str, Any],
    idx: int,
    contract: dict[str, Any],
    checklist_groups: dict[str, dict[str, Any]],
    source_inputs: dict[str, dict[str, Any]],
) -> None:
    path = f"steps[{idx}]"
    require(step.get("step_id") == contract["step_id"], f"{path}.step_id mismatch")
    require(step.get("order") == idx + 1, f"{path}.order mismatch")
    require(step.get("coverage_group") == contract["coverage_group"], f"{path}.coverage_group mismatch")
    require(step.get("probe_id") == contract["probe_id"], f"{path}.probe_id mismatch")
    require(step.get("status") == "blocked", f"{path}.status must be blocked")
    require(step.get("ready_to_execute") is False, f"{path}.ready_to_execute must be false")
    gate_ids = validate_string_list(step.get("gate_ids"), f"{path}.gate_ids", max_len=4)
    require("stage1_production_launch_preflight" in gate_ids, f"{path}.gate_ids missing aggregate gate")
    group = checklist_groups.get(contract["coverage_group"])
    require(isinstance(group, dict), f"{path} missing checklist group")
    source_input = source_inputs.get(contract["probe_id"])
    require(isinstance(source_input, dict), f"{path} missing input packet source input")
    require(step.get("blocking_input_count") == group.get("blocking_input_count"), f"{path}.blocking_input_count mismatch")
    require(step.get("required_total") == group.get("required_total"), f"{path}.required_total mismatch")
    require(step.get("required_configured") == group.get("required_configured"), f"{path}.required_configured mismatch")
    require(step.get("completion_percent") == group.get("completion_percent"), f"{path}.completion_percent mismatch")
    if idx == 0:
        require(step.get("required_before") == [], f"{path}.required_before must be empty")
    else:
        require(step.get("required_before") == ["production_dns_https"], f"{path}.required_before must depend on DNS/HTTPS")
    require(step.get("source_probe_command") == source_input.get("source_probe_command"), f"{path}.source_probe_command mismatch")
    require(step.get("source_output_path") == contract["source_output_path"], f"{path}.source_output_path mismatch")
    require(step.get("source_output_path") == source_input.get("source_path"), f"{path}.source_output_path source input mismatch")
    require(step.get("diagnostic_path") == contract["diagnostic_path"], f"{path}.diagnostic_path mismatch")
    require(step.get("diagnostic_path") == source_input.get("diagnostic_path"), f"{path}.diagnostic_path source input mismatch")
    require(step.get("strict_validator") == contract["strict_validator"], f"{path}.strict_validator mismatch")
    require(step.get("strict_validator") == source_input.get("strict_validator"), f"{path}.strict_validator source input mismatch")
    require_string(step.get("evidence_generator"), f"{path}.evidence_generator")
    require(step.get("operator_packet_ref") == contract["operator_packet_ref"], f"{path}.operator_packet_ref mismatch")
    require_optional_string(step.get("source_template_ref"), f"{path}.source_template_ref")
    require_optional_string(step.get("proof_template_ref"), f"{path}.proof_template_ref")
    require_string(step.get("first_blocker"), f"{path}.first_blocker")
    require(step.get("missing_or_invalid_inputs") == expected_missing_inputs(group), f"{path}.missing_or_invalid_inputs mismatch")
    require(
        step.get("acceptable_evidence_sources") == expected_acceptable_evidence_sources(group),
        f"{path}.acceptable_evidence_sources mismatch",
    )
    require(
        step.get("disallowed_substitutes") == expected_disallowed_substitutes(group),
        f"{path}.disallowed_substitutes mismatch",
    )
    require(
        step.get("can_be_satisfied_by_existing_sandbox_or_staging_resources") == expected_sandbox_or_staging_allowed(group),
        f"{path}.can_be_satisfied_by_existing_sandbox_or_staging_resources mismatch",
    )
    require(
        step.get("can_be_satisfied_by_existing_sandbox_or_staging_resources") is False,
        f"{path} must reject existing sandbox/staging resources for production source probes",
    )
    validate_string_list(step.get("blocked_until"), f"{path}.blocked_until", max_len=12)
    require_string(step.get("operator_next_action"), f"{path}.operator_next_action")


def validate_steps(data: dict[str, Any], checklist: dict[str, Any], input_packet: dict[str, Any]) -> None:
    steps = data.get("steps")
    require(isinstance(steps, list), "steps must be list")
    require(len(steps) == len(STEP_CONTRACT), "steps length mismatch")
    checklist_groups = checklist_group_map(checklist)
    source_inputs = source_input_map(input_packet)
    for idx, step in enumerate(steps):
        require(isinstance(step, dict), f"steps[{idx}] must be object")
        validate_step(step, idx, STEP_CONTRACT[idx], checklist_groups, source_inputs)


def validate_gate_impact(data: dict[str, Any]) -> None:
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_stage1_production_launch_gate") is False, "gate_impact cannot clear production launch")
    require(gate.get("can_close_do_not_launch") is False, "gate_impact cannot close DNL")
    require(gate.get("non_clearing_evidence_only") is True, "gate_impact must mark non-clearing evidence")
    require(
        gate.get("preserved_do_not_launch_condition") == "stage1_production_launch_evidence_incomplete",
        "DNL preservation mismatch",
    )


def validate_runbook(
    data: dict[str, Any],
    checklist: dict[str, Any],
    input_packet: dict[str, Any],
    pipeline: dict[str, Any],
    expected_source_refs: dict[str, str],
) -> None:
    assert_no_secret(data, "runbook")
    require(data.get("schema_version") == "stage1.production_source_probe_runbook.v1", "schema_version mismatch")
    require(data.get("kind") == "stage1_production_source_probe_runbook", "kind mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("status") == "blocked", "runbook must remain blocked")
    require(data.get("release_gate_decision") == "no_go", "runbook must remain no_go")
    require(data.get("non_clearing_runbook") is True, "non_clearing_runbook must be true")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "runbook cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "runbook cannot close DNL")
    require(data.get("value_redaction") == "variable_names_only", "value_redaction mismatch")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    validate_source_refs(data, expected_source_refs)
    validate_summary(data, checklist)
    validate_pipeline_state(data, pipeline)
    validate_steps(data, checklist, input_packet)
    validate_string_list(data.get("operator_next_actions"), "operator_next_actions", max_len=8)
    validate_gate_impact(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runbook", type=Path, default=DEFAULT_RUNBOOK)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_CHECKLIST)
    parser.add_argument("--launch-input-packet", type=Path, default=DEFAULT_INPUT_PACKET)
    parser.add_argument("--launch-operator-brief", type=Path, default=DEFAULT_OPERATOR_BRIEF)
    parser.add_argument("--launch-source-pipeline", type=Path, default=DEFAULT_PIPELINE)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        expected_steps = [
            "production_dns_https",
            "production_paid_billing_lifecycle",
            "production_security_launch_checks",
            "production_governance_release",
        ]
        require([item["step_id"] for item in STEP_CONTRACT] == expected_steps, "step contract mismatch")
        print("stage1 production source probe runbook contract passed")
        return 0
    try:
        validate_runbook(
            load_json(args.runbook),
            load_json(args.missing_input_checklist),
            load_json(args.launch_input_packet),
            load_json(args.launch_source_pipeline),
            {
                "production_launch_input_packet": normalize_ref(args.launch_input_packet),
                "production_launch_operator_brief": normalize_ref(args.launch_operator_brief),
                "production_missing_input_checklist": normalize_ref(args.missing_input_checklist),
                "production_launch_source_pipeline": normalize_ref(args.launch_source_pipeline),
            },
        )
    except ProductionSourceProbeRunbookValidationError as exc:
        raise SystemExit(f"stage1 production source probe runbook validation failed: {exc}") from exc
    print("stage1 production source probe runbook validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
