#!/usr/bin/env python3
"""Validate the non-clearing Stage 1 next-blockers summary."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.json"
DEFAULT_MARKDOWN = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.md"
DEFAULT_CLOSURE_QUEUE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"
DEFAULT_ACTION_MATRIX = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.json"
DEFAULT_MISSING_INPUT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
DEFAULT_LAUNCH_SOURCE_PIPELINE = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"
DEFAULT_NON_CLEARING_REFRESH = ROOT / "ops" / "evidence" / "non_clearing" / "production-non-clearing-refresh.json"
DEFAULT_EXTERNAL_READINESS = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-external-resource-readiness.preflight.json"
DEFAULT_AZURE_READINESS = ROOT / "ops" / "evidence" / "staging" / "stage1-azure-origin-readiness.json"
DEFAULT_RUN_COMMAND_DIAGNOSIS = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair-diagnosis.json"

SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
    "raw_run_command_output_persisted",
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
    "raw_output",
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


class NextBlockersSummaryValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise NextBlockersSummaryValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise NextBlockersSummaryValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise NextBlockersSummaryValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain JSON object")
    return data


def load_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise NextBlockersSummaryValidationError(f"missing {display_path(path)}") from exc


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


def require_int(value: Any, path: str) -> int:
    require(isinstance(value, int), f"{path} must be int")
    require(value >= 0, f"{path} must be non-negative")
    return value


def require_num(value: Any, path: str) -> float:
    require(isinstance(value, (int, float)), f"{path} must be numeric")
    require(0 <= float(value) <= 100, f"{path} out of range")
    return float(value)


def require_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be non-empty string")
    return value.strip()


def require_list(value: Any, path: str, *, min_len: int = 0) -> list[Any]:
    require(isinstance(value, list), f"{path} must be list")
    require(len(value) >= min_len, f"{path} must have at least {min_len} items")
    return value


def token(markdown: str, value: Any, label: str) -> None:
    require(str(value) in markdown, f"markdown missing {label}: {value}")


def validate_summary(
    summary: dict[str, Any],
    markdown: str,
    closure: dict[str, Any],
    matrix: dict[str, Any],
    missing: dict[str, Any],
    source: dict[str, Any],
    pipeline: dict[str, Any],
    refresh: dict[str, Any],
    external: dict[str, Any],
    azure: dict[str, Any],
    diagnosis: dict[str, Any],
) -> None:
    assert_no_secret(summary, "stage1_next_blockers_summary")
    assert_no_secret(markdown, "stage1_next_blockers_markdown")
    require(summary.get("schema_version") == "stage1.next_blockers_summary.v1", "schema_version mismatch")
    require(summary.get("kind") == "stage1_next_blockers_summary", "kind mismatch")
    require(summary.get("environment") == "non_clearing", "environment mismatch")
    require(summary.get("status") in {"blocked", "pass"}, "status mismatch")
    require(summary.get("release_gate_decision") == "no_go", "release decision must stay no_go")
    for field in ("canonical_pass_path", "can_clear_stage1_staging_runtime_gate", "can_clear_stage1_production_launch_gate", "can_close_do_not_launch"):
        require(summary.get(field) is False, f"{field} must be false")
    for field in SAFE_FALSE_FIELDS:
        require(summary.get(field) is False, f"{field} must be false")

    queue = closure.get("queue_summary")
    matrix_summary = matrix.get("summary")
    missing_summary = missing.get("summary")
    source_summary = source.get("summary")
    refresh_summary = refresh.get("step_summary")
    external_summary = external.get("resource_summary")
    require(isinstance(queue, dict), "closure.queue_summary missing")
    require(isinstance(matrix_summary, dict), "matrix.summary missing")
    require(isinstance(missing_summary, dict), "missing.summary missing")
    require(isinstance(source_summary, dict), "source.summary missing")
    require(isinstance(refresh_summary, dict), "refresh.step_summary missing")
    require(isinstance(external_summary, dict), "external.resource_summary missing")

    stage1 = summary.get("stage1")
    require(isinstance(stage1, dict), "stage1 must be object")
    require_int(stage1.get("completed"), "stage1.completed")
    require_int(stage1.get("total"), "stage1.total")
    require_num(stage1.get("completion_percent"), "stage1.completion_percent")
    require_int(stage1.get("open"), "stage1.open")
    open_gates = require_list(stage1.get("open_gates"), "stage1.open_gates", min_len=1)
    require(stage1["completed"] == queue.get("completed"), "stage1.completed must match closure queue")
    require(stage1["total"] == queue.get("total"), "stage1.total must match closure queue")
    require(stage1["open"] == queue.get("open"), "stage1.open must match closure queue")
    require(open_gates == queue.get("open_gates"), "stage1.open_gates must match closure queue")

    inputs = summary.get("production_inputs")
    require(isinstance(inputs, dict), "production_inputs must be object")
    for source_key, summary_key in (
        ("required_configured", "configured"),
        ("required_total", "total"),
        ("required_missing", "missing"),
        ("required_invalid", "invalid"),
        ("blocking_input_count", "blocking_input_count"),
    ):
        require(inputs.get(summary_key) == missing_summary.get(source_key), f"production_inputs.{summary_key} mismatch")
    require_num(inputs.get("completion_percent"), "production_inputs.completion_percent")
    require(inputs["configured"] + inputs["missing"] + inputs["invalid"] == inputs["total"], "production input counters must add up")

    probes = summary.get("production_source_probes")
    require(isinstance(probes, dict), "production_source_probes must be object")
    require(probes.get("ready") == source_summary.get("ready_to_execute_count"), "source probes ready mismatch")
    require(probes.get("total") == source_summary.get("runbook_step_count"), "source probes total mismatch")
    require(probes.get("blocked") == source_summary.get("blocked_step_count"), "source probes blocked mismatch")
    require(probes.get("blocking_input_count") == source_summary.get("blocking_input_count"), "source probes blocking input mismatch")

    source_input_rows = summary.get("production_source_inputs")
    require(isinstance(source_input_rows, list), "production_source_inputs must be list")
    pipeline_rows = pipeline.get("missing_source_inputs")
    require(isinstance(pipeline_rows, list) and len(pipeline_rows) == 4, "pipeline missing_source_inputs must have four rows")
    require(len(source_input_rows) == len(pipeline_rows), "production source input row count mismatch")
    by_step = {
        row.get("source_step_id"): row
        for row in pipeline_rows
        if isinstance(row, dict) and isinstance(row.get("source_step_id"), str)
    }
    require(
        set(by_step) == {"billing_source_probe", "security_source_probe", "legal_support_source_probe", "governance_source_probe"},
        "pipeline source input step set mismatch",
    )
    for row in source_input_rows:
        require(isinstance(row, dict), "production_source_inputs item must be object")
        step_id = require_string(row.get("source_step_id"), "production_source_inputs.source_step_id")
        source_row = by_step.get(step_id)
        require(isinstance(source_row, dict), f"missing pipeline source row {step_id}")
        for key in (
            "probe_id",
            "coverage_group",
            "status",
            "candidate_proof_path",
            "candidate_proof_exists",
            "canonical_source_path",
            "strict_validator",
            "first_blocker",
        ):
            require(row.get(key) == source_row.get(key), f"production_source_inputs.{step_id}.{key} mismatch")
        for key in ("blocking_input_count", "required_configured", "required_total"):
            require(row.get(key) == source_row.get(key), f"production_source_inputs.{step_id}.{key} mismatch")
        require_num(row.get("completion_percent"), f"production_source_inputs.{step_id}.completion_percent")
        require(row.get("completion_percent") == source_row.get("completion_percent"), f"production_source_inputs.{step_id}.completion_percent mismatch")
        missing_inputs = row.get("missing_or_invalid_inputs")
        require(isinstance(missing_inputs, list) and missing_inputs, f"production_source_inputs.{step_id}.missing_or_invalid_inputs must be non-empty")
        require(missing_inputs == source_row.get("missing_or_invalid_inputs"), f"production_source_inputs.{step_id}.missing inputs mismatch")
        require_string(row.get("operator_next_action"), f"production_source_inputs.{step_id}.operator_next_action")

    refresh_out = summary.get("non_clearing_refresh")
    require(isinstance(refresh_out, dict), "non_clearing_refresh must be object")
    for key in ("passed", "total", "blocked", "failed"):
        require(refresh_out.get(key) == refresh_summary.get(key), f"non_clearing_refresh.{key} mismatch")

    external_out = summary.get("external_resource_readiness")
    require(isinstance(external_out, dict), "external_resource_readiness must be object")
    for key in ("ready", "total", "missing", "blocked", "provided_unverified"):
        require(external_out.get(key) == external_summary.get(key), f"external_resource_readiness.{key} mismatch")
    require_num(external_out.get("ready_percent"), "external_resource_readiness.ready_percent")
    require(external_out.get("ready_percent") == external_summary.get("ready_percent"), "external readiness percent mismatch")
    require_string(external_out.get("current_loop_breaker"), "external_resource_readiness.current_loop_breaker")

    azure_out = summary.get("azure_origin")
    require(isinstance(azure_out, dict), "azure_origin must be object")
    require(azure_out.get("status") == azure.get("status"), "azure status mismatch")
    require(azure_out.get("release_gate_decision") == azure.get("release_gate_decision"), "azure decision mismatch")
    require(azure_out.get("blocked_checks") == azure.get("blocked_checks"), "azure blocked checks mismatch")
    transport = azure.get("transport_diagnosis")
    require(isinstance(transport, dict), "azure.transport_diagnosis missing")
    for key in (
        "lane",
        "next_action",
        "operator_summary",
        "blocked_reasons",
        "ssh_transport_phase",
        "ssh_password_key_repair_viable",
        "azure_portal_run_command_required",
        "http_response_started",
    ):
        summary_key = {
            "lane": "transport_lane",
            "next_action": "transport_next_action",
            "operator_summary": "transport_summary",
            "blocked_reasons": "transport_blocked_reasons",
        }.get(key, key)
        require(azure_out.get(summary_key) == transport.get(key), f"azure transport {summary_key} mismatch")
    require_string(azure_out.get("transport_lane"), "azure_origin.transport_lane")
    require_string(azure_out.get("transport_next_action"), "azure_origin.transport_next_action")
    require_string(azure_out.get("transport_summary"), "azure_origin.transport_summary")
    require_list(azure_out.get("transport_blocked_reasons"), "azure_origin.transport_blocked_reasons", min_len=1)
    require_int(azure_out.get("repair_command_count"), "azure repair command count")
    require(azure_out["repair_command_count"] == len(azure.get("origin_repair_commands", [])), "azure repair command count mismatch")
    require("ingest_azure_run_command_output.py" in " ".join(azure_out.get("repair_commands", [])), "azure repair commands must include ingest")
    require("sanitize_azure_run_command_output.py" in " ".join(azure_out.get("repair_commands", [])), "azure repair commands must include sanitizer")
    require("classify_azure_run_command_output.py" in " ".join(azure_out.get("repair_commands", [])), "azure repair commands must include classifier")

    diag_out = summary.get("azure_run_command_diagnosis")
    require(isinstance(diag_out, dict), "azure_run_command_diagnosis must be object")
    azure_passed = azure.get("status") == "pass"
    expected_diag_status = "superseded" if azure_passed else diagnosis.get("status")
    expected_ssh_repair = "not_required" if azure_passed else diagnosis.get("ssh_repair_status")
    expected_origin_runtime = "not_required" if azure_passed else diagnosis.get("origin_runtime_status")
    expected_next_repair = "none" if azure_passed else diagnosis.get("next_repair_lane")
    expected_findings = [] if azure_passed else diagnosis.get("findings")
    require(diag_out.get("status") == expected_diag_status, "diagnosis status mismatch")
    require(diag_out.get("source_status") == diagnosis.get("status"), "diagnosis source_status mismatch")
    require(diag_out.get("superseded_by") == ("azure_origin_pass" if azure_passed else "none"), "diagnosis superseded_by mismatch")
    require(diag_out.get("ssh_repair_status") == expected_ssh_repair, "diagnosis ssh_repair_status mismatch")
    require(diag_out.get("origin_runtime_status") == expected_origin_runtime, "diagnosis origin_runtime_status mismatch")
    require(diag_out.get("next_repair_lane") == expected_next_repair, "diagnosis next_repair_lane mismatch")
    require(diag_out.get("findings") == expected_findings, "diagnosis findings mismatch")
    require(diag_out.get("source_findings") == diagnosis.get("findings"), "diagnosis source_findings mismatch")
    require(diag_out.get("input_present") == diagnosis.get("input_present"), "diagnosis input_present mismatch")
    require(diag_out.get("raw_output_persisted") is False, "diagnosis raw output must be false")
    require(isinstance(diag_out.get("origin_summary"), dict), "diagnosis origin_summary must be object")
    source_origin_summary = diagnosis.get("origin_summary") if isinstance(diagnosis.get("origin_summary"), dict) else {}
    require(diag_out.get("origin_summary") == source_origin_summary, "diagnosis origin_summary mismatch")

    lanes = require_list(summary.get("production_lanes"), "production_lanes", min_len=4)
    matrix_lanes = matrix.get("lanes")
    require(isinstance(matrix_lanes, list), "matrix.lanes missing")
    require(len(lanes) == len(matrix_lanes), "production lane count mismatch")
    for lane, source_lane in zip(lanes, matrix_lanes):
        require(lane.get("lane_id") == source_lane.get("lane_id"), "lane_id mismatch")
        require(lane.get("blocking_input_count") == source_lane.get("blocking_input_count"), f"{lane.get('lane_id')} blocker mismatch")
        require(lane.get("first_blocker") == source_lane.get("first_blocker"), f"{lane.get('lane_id')} first blocker mismatch")

    shortlist = require_list(summary.get("operator_shortlist"), "operator_shortlist", min_len=1)
    require(len(shortlist) <= 5, "operator_shortlist must have at most five items")
    source_lanes_by_id = {
        lane.get("lane_id"): lane
        for lane in matrix_lanes
        if isinstance(lane, dict) and isinstance(lane.get("lane_id"), str)
    }
    shortlist_ids: list[str] = []
    for idx, item in enumerate(shortlist, start=1):
        require(isinstance(item, dict), "operator_shortlist item must be object")
        require(item.get("order") == idx, f"operator_shortlist[{idx}].order mismatch")
        item_id = require_string(item.get("item_id"), f"operator_shortlist[{idx}].item_id")
        shortlist_ids.append(item_id)
        require_string(item.get("lane"), f"operator_shortlist[{idx}].lane")
        require_string(item.get("status"), f"operator_shortlist[{idx}].status")
        require(item.get("requires_external_input") is True, f"operator_shortlist[{idx}] must require external input")
        require_string(item.get("current_blocker"), f"operator_shortlist[{idx}].current_blocker")
        require_string(item.get("operator_action"), f"operator_shortlist[{idx}].operator_action")
        require_string(item.get("agent_action_after_input"), f"operator_shortlist[{idx}].agent_action_after_input")
        command = require_string(item.get("command"), f"operator_shortlist[{idx}].command")
        require_string(item.get("evidence_ref"), f"operator_shortlist[{idx}].evidence_ref")
        gate_impact = require_string(item.get("gate_impact"), f"operator_shortlist[{idx}].gate_impact")
        require(
            gate_impact in {"non_clearing_operator_shortlist_only", "non_clearing_parallel_ops_only"},
            f"operator_shortlist[{idx}].gate_impact mismatch",
        )
        require(item.get("can_clear_stage1_staging_runtime_gate") is False, f"operator_shortlist[{idx}] staging gate flag must be false")
        require(item.get("can_clear_stage1_production_launch_gate") is False, f"operator_shortlist[{idx}] production gate flag must be false")
        require(item.get("can_close_do_not_launch") is False, f"operator_shortlist[{idx}] DNL flag must be false")
        if item_id in source_lanes_by_id:
            source_lane = source_lanes_by_id[item_id]
            require(item.get("status") == source_lane.get("status"), f"operator_shortlist {item_id} status mismatch")
            require(item.get("current_blocker") == source_lane.get("first_blocker"), f"operator_shortlist {item_id} blocker mismatch")
            require(item.get("operator_action") == source_lane.get("immediate_action"), f"operator_shortlist {item_id} operator action mismatch")
            require(item.get("agent_action_after_input") == source_lane.get("agent_action_after_inputs"), f"operator_shortlist {item_id} agent action mismatch")
            automation = source_lane.get("automation_commands")
            require(isinstance(automation, list) and automation, f"matrix lane {item_id} must have automation command")
            require(command == automation[0], f"operator_shortlist {item_id} command mismatch")
            require(gate_impact == "non_clearing_operator_shortlist_only", f"operator_shortlist {item_id} gate impact mismatch")
    for lane_id in ("production_dns_https", "production_live_billing", "production_security_runtime", "production_governance_release"):
        require(lane_id in shortlist_ids, f"operator_shortlist missing production lane {lane_id}")
    azure_should_be_listed = not azure_passed
    if azure_should_be_listed:
        require("azure_run_command_output_missing" in shortlist_ids, "operator_shortlist missing Azure Run Command item")
        azure_shortlist = next(item for item in shortlist if isinstance(item, dict) and item.get("item_id") == "azure_run_command_output_missing")
        require("ingest_azure_run_command_output.py" in azure_shortlist.get("command", ""), "Azure shortlist item must use ingest command")
        require(azure_shortlist.get("gate_impact") == "non_clearing_parallel_ops_only", "Azure shortlist gate impact mismatch")
    else:
        require("azure_run_command_output_missing" not in shortlist_ids, "operator_shortlist must not list Azure Run Command after Azure origin pass")

    action_packet_min_len = 5 if azure_should_be_listed else 4
    action_packet = require_list(summary.get("operator_action_packet"), "operator_action_packet", min_len=action_packet_min_len)
    require(len(action_packet) <= 6, "operator_action_packet must stay compact")
    action_packet_ids: list[str] = []
    for idx, item in enumerate(action_packet):
        require(isinstance(item, dict), f"operator_action_packet[{idx}] must be object")
        item_id = require_string(item.get("item_id"), f"operator_action_packet[{idx}].item_id")
        action_packet_ids.append(item_id)
        require(isinstance(item.get("order"), int), f"operator_action_packet[{idx}].order must be int")
        owner = require_string(item.get("owner"), f"operator_action_packet[{idx}].owner")
        require(
            owner
            in {
                "operator_azure_portal",
                "operator_cloudflare_dns",
                "operator_production_account",
                "agent_after_operator_input",
                "agent_local",
            },
            f"operator_action_packet[{idx}].owner mismatch",
        )
        require_string(item.get("status"), f"operator_action_packet[{idx}].status")
        require(isinstance(item.get("requires_external_input"), bool), f"operator_action_packet[{idx}].requires_external_input must be bool")
        require_string(item.get("required_return_artifact"), f"operator_action_packet[{idx}].required_return_artifact")
        require_string(item.get("agent_command_after_return"), f"operator_action_packet[{idx}].agent_command_after_return")
        require_string(item.get("validation_after_return"), f"operator_action_packet[{idx}].validation_after_return")
        require_string(item.get("blind_handoff_note"), f"operator_action_packet[{idx}].blind_handoff_note")
        require_string(item.get("evidence_ref"), f"operator_action_packet[{idx}].evidence_ref")
        gate_impact = require_string(item.get("gate_impact"), f"operator_action_packet[{idx}].gate_impact")
        require(
            gate_impact in {"non_clearing_operator_shortlist_only", "non_clearing_parallel_ops_only"},
            f"operator_action_packet[{idx}].gate_impact mismatch",
        )
        require(item.get("can_clear_stage1_staging_runtime_gate") is False, f"operator_action_packet[{idx}] staging gate flag must be false")
        require(item.get("can_clear_stage1_production_launch_gate") is False, f"operator_action_packet[{idx}] production gate flag must be false")
        require(item.get("can_close_do_not_launch") is False, f"operator_action_packet[{idx}] DNL flag must be false")
    required_packet_ids = [
        "production_dns_https",
        "production_live_billing",
        "production_security_runtime",
        "production_governance_release",
    ]
    if azure_should_be_listed:
        required_packet_ids.append("azure_run_command_output_missing")
    for item_id in required_packet_ids:
        require(item_id in action_packet_ids, f"operator_action_packet missing {item_id}")
    packet_by_id = {item.get("item_id"): item for item in action_packet if isinstance(item, dict)}
    if azure_should_be_listed:
        require(packet_by_id["azure_run_command_output_missing"].get("owner") == "operator_azure_portal", "Azure packet owner mismatch")
        require("RunShellScript" in packet_by_id["azure_run_command_output_missing"].get("required_return_artifact", ""), "Azure packet must ask for RunShellScript output")
        require("ingest_azure_run_command_output.py" in packet_by_id["azure_run_command_output_missing"].get("agent_command_after_return", ""), "Azure packet ingest command missing")
    else:
        require("azure_run_command_output_missing" not in packet_by_id, "operator_action_packet must not list Azure Run Command after Azure origin pass")
    require(packet_by_id["production_dns_https"].get("owner") == "operator_cloudflare_dns", "DNS packet owner mismatch")
    require("Cloudflare DNS" in packet_by_id["production_dns_https"].get("required_return_artifact", ""), "DNS packet must require Cloudflare DNS or manual records")
    require("stage1_production_dns_cutover_plan.py" in packet_by_id["production_dns_https"].get("agent_command_after_return", ""), "DNS packet must start with DNS cutover plan")
    require("stage1_production_dns_readiness.py" in packet_by_id["production_dns_https"].get("validation_after_return", ""), "DNS packet validation must rerun DNS readiness")
    require("R2 S3" in packet_by_id["production_dns_https"].get("blind_handoff_note", ""), "DNS packet must warn R2 S3 credentials are not DNS credentials")
    require("Stripe live" in packet_by_id["production_live_billing"].get("required_return_artifact", ""), "billing packet must ask for live Stripe artifacts")
    require("sandbox" in packet_by_id["production_live_billing"].get("blind_handoff_note", "").lower(), "billing packet must reject sandbox loop")
    require("production runtime" in packet_by_id["production_security_runtime"].get("required_return_artifact", ""), "security packet must ask for production runtime refs")
    require("activation" in packet_by_id["production_governance_release"].get("required_return_artifact", ""), "governance packet must ask for governance refs")

    action = summary.get("top_priority_action")
    require(isinstance(action, dict), "top_priority_action must be object")
    action_id = require_string(action.get("action_id"), "top_priority_action.action_id")
    require_string(action.get("lane"), "top_priority_action.lane")
    require_string(action.get("why"), "top_priority_action.why")
    action_command = require_string(action.get("command"), "top_priority_action.command")
    require(isinstance(action.get("requires_external_input"), bool), "top_priority_action.requires_external_input must be bool")
    require_string(action.get("parallel_blocker", "none"), "top_priority_action.parallel_blocker")
    require_string(action.get("parallel_command", "none"), "top_priority_action.parallel_command")

    refs = summary.get("evidence_refs")
    require(isinstance(refs, dict), "evidence_refs must be object")
    for key in (
        "closure_queue",
        "production_action_matrix",
        "production_missing_input_checklist",
        "production_source_probe_runbook",
        "production_launch_source_pipeline",
        "production_non_clearing_refresh",
        "external_resource_readiness",
        "azure_origin_readiness",
        "azure_run_command_diagnosis",
    ):
        require_string(refs.get(key), f"evidence_refs.{key}")

    for required in (
        "# Stage 1 Next Blockers Summary",
        "non-clearing operator summary",
        "Stage1 gates",
        "Production inputs",
        "Production source probes",
        "External resources",
        "External Resources",
        "Azure TCP ports",
        "Azure HTTP probes",
        "Run Command lanes",
        "superseded_by",
        "Operator Shortlist",
        "Operator Action Packet",
        "Transport lane",
        "Transport reasons",
        "password/key repair viable",
        "Production Source Inputs",
        "Top Priority Action",
        "Parallel blocker",
        "Parallel command",
        "Evidence Refs",
        "no_go",
    ):
        require(required in markdown, f"markdown missing {required!r}")
    require(action_command in markdown, f"markdown missing top action command: {action_command}")
    for item in shortlist:
        token(markdown, item["item_id"], f"shortlist {item['item_id']}")
        token(markdown, item["command"], f"shortlist command {item['item_id']}")
    for item in action_packet:
        token(markdown, item["item_id"], f"action packet {item['item_id']}")
        token(markdown, item["required_return_artifact"], f"action packet return artifact {item['item_id']}")
        token(markdown, item["agent_command_after_return"], f"action packet command {item['item_id']}")
    if action_id == "azure_run_command_output_missing":
        require("ingest_azure_run_command_output.py" in markdown, "markdown missing Azure Run Command ingest action")
    if action_id == "production_source_probes_missing":
        require(
            "ingest_stage1_production_return_artifacts.py" in markdown
            or "run_stage1_production_launch_source_pipeline.py" in markdown,
            "markdown missing production return artifact ingest or source pipeline action",
        )
    for row in source_input_rows:
        token(markdown, row["source_step_id"], f"source input {row['source_step_id']}")
        token(markdown, row["canonical_source_path"], f"source input canonical {row['source_step_id']}")
    for value, label in (
        (stage1["completed"], "stage1.completed"),
        (stage1["total"], "stage1.total"),
        (stage1["completion_percent"], "stage1.completion_percent"),
        (inputs["configured"], "inputs.configured"),
        (inputs["total"], "inputs.total"),
        (inputs["completion_percent"], "inputs.completion_percent"),
        (probes["ready"], "probes.ready"),
        (probes["total"], "probes.total"),
        (refresh_out["passed"], "refresh.passed"),
        (refresh_out["total"], "refresh.total"),
        (external_out["ready"], "external.ready"),
        (external_out["total"], "external.total"),
        (external_out["ready_percent"], "external.ready_percent"),
        (azure_out["repair_command_count"], "azure.repair_command_count"),
        (azure_out["transport_lane"], "azure.transport_lane"),
        (azure_out["transport_next_action"], "azure.transport_next_action"),
        (action["action_id"], "top action id"),
    ):
        token(markdown, value, label)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--markdown", type=Path, default=DEFAULT_MARKDOWN)
    parser.add_argument("--closure-queue", type=Path, default=DEFAULT_CLOSURE_QUEUE)
    parser.add_argument("--action-matrix", type=Path, default=DEFAULT_ACTION_MATRIX)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_MISSING_INPUT_CHECKLIST)
    parser.add_argument("--source-runbook", type=Path, default=DEFAULT_SOURCE_RUNBOOK)
    parser.add_argument("--launch-source-pipeline", type=Path, default=DEFAULT_LAUNCH_SOURCE_PIPELINE)
    parser.add_argument("--non-clearing-refresh", type=Path, default=DEFAULT_NON_CLEARING_REFRESH)
    parser.add_argument("--external-readiness", type=Path, default=DEFAULT_EXTERNAL_READINESS)
    parser.add_argument("--azure-readiness", type=Path, default=DEFAULT_AZURE_READINESS)
    parser.add_argument("--run-command-diagnosis", type=Path, default=DEFAULT_RUN_COMMAND_DIAGNOSIS)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        source = Path(__file__).read_text(encoding="utf-8")
        for snippet in (
            "stage1.next_blockers_summary.v1",
            "top_priority_action",
            "external_resource_readiness",
            "production_source_probes_missing",
            "azure_run_command_diagnosis",
            "superseded_by",
            "production_lanes",
            "production_source_inputs",
            "parallel_blocker",
            "operator_shortlist",
            "azure_run_command_output_missing",
            "non_clearing_operator_shortlist_only",
            "raw_run_command_output_persisted",
            "classify_azure_run_command_output.py",
        ):
            if snippet not in source:
                raise SystemExit(f"missing contract snippet: {snippet}")
        print("stage1 next blockers summary validator contract passed")
        return 0
    validate_summary(
        load_json(args.summary),
        load_text(args.markdown),
        load_json(args.closure_queue),
        load_json(args.action_matrix),
        load_json(args.missing_input_checklist),
        load_json(args.source_runbook),
        load_json(args.launch_source_pipeline),
        load_json(args.non_clearing_refresh),
        load_json(args.external_readiness),
        load_json(args.azure_readiness),
        load_json(args.run_command_diagnosis),
    )
    print("stage1 next blockers summary validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
