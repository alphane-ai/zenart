#!/usr/bin/env python3
"""Validate Stage 0 Rev2 trace visibility and blocked-export retention projections."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
CONTRACT = FIXTURE_DIR / "trace_visibility_export_retention.json"
TRACE_COMPLETENESS = FIXTURE_DIR / "trace_completeness.json"
TRACE_EXPORT_GATE_MATRIX = FIXTURE_DIR / "trace_export_gate_matrix.json"
EVAL_RESULTS = FIXTURE_DIR / "starter_eval_results.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"

REQUIRED_PROJECTION_FIELDS = {
    "user_trace_projection",
    "admin_trace_projection",
    "export_retention_projection",
    "source_trace_ref",
    "source_eval_result_ref",
    "source_gate_case_ref",
}
USER_VISIBLE_FIELDS = {
    "trace_id",
    "task_id",
    "workflow",
    "task_status",
    "user_message",
    "final_export_allowed",
    "denial_reasons",
    "export_id",
}
USER_HIDDEN_FIELDS = {
    "provider_payload",
    "internal_prompt",
    "raw_safety_payload",
    "safety_rule_rationale",
    "admin_audit_notes",
    "quota_transaction_internal_metadata",
    "agent_step_payload",
}
ADMIN_VISIBLE_TABLES = {
    "agent_traces",
    "eval_results",
    "qa_results",
    "safety_decisions",
    "exports",
    "audit_logs",
}
SAFETY_STEPS = ["brief", "provider_request", "provider_response", "qa", "export"]


class TraceVisibilityContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise TraceVisibilityContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise TraceVisibilityContractError(message)


def schema_block(openapi_text: str, schema_name: str) -> str:
    match = re.search(
        rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(match is not None, f"OpenAPI schema {schema_name} missing")
    return match.group("body")


def validate_openapi_projection_schema() -> None:
    body = schema_block(OPENAPI.read_text(encoding="utf-8"), "AgentTrace")
    for field in [
        "user_trace_projection",
        "admin_trace_projection",
        "export_retention_projection",
        "visible_fields",
        "hidden_fields",
        "visible_tables",
        "retained_files",
        "retained_when_blocked",
        "download_enabled",
        "denial_reasons",
    ]:
        require(field in body, f"OpenAPI AgentTrace missing trace visibility projection field {field}")
    for forbidden in USER_HIDDEN_FIELDS:
        require(forbidden in body, f"OpenAPI AgentTrace must enumerate hidden user projection field {forbidden}")


def build_indexes() -> tuple[
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, list[dict[str, Any]]],
    str,
]:
    trace_contract = load_json(TRACE_COMPLETENESS)
    gate_matrix = load_json(TRACE_EXPORT_GATE_MATRIX)
    eval_results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    trace_by_fixture = {trace["fixture_id"]: trace for trace in trace_contract["traces"]}
    gate_by_fixture = {case["fixture_id"]: case for case in gate_matrix["gate_cases"]}
    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    qa_by_fixture: dict[str, list[dict[str, Any]]] = {}
    for item in qa_results:
        qa_by_fixture.setdefault(item["evidence"]["fixture_id"], []).append(item)
    return trace_by_fixture, gate_by_fixture, eval_by_fixture, qa_by_fixture, eval_results[0]["result_id"]


def retained_files_from_export_contract(export_contract: dict[str, bool]) -> list[str]:
    files = []
    if export_contract["manifest"]:
        files.append("manifest.json")
    if export_contract["qa_report"]:
        files.append("qa_report.json")
    if export_contract["metadata"]:
        files.append("metadata.json")
    if export_contract["trace_provenance"]:
        files.append("trace_provenance.json")
    if export_contract["safety_disclaimer_when_applicable"]:
        files.append("safety_disclaimer.md")
    return files


def validate_projection_case(
    case: dict[str, Any],
    trace: dict[str, Any],
    gate: dict[str, Any],
    eval_result: dict[str, Any],
    qa_items: list[dict[str, Any]],
    eval_result_id: str,
) -> None:
    fixture_id = case["fixture_id"]
    trace_id = trace["trace_id"]

    require(case["workflow"] == eval_result["workflow"] == trace["workflow"] == gate["workflow"], f"{fixture_id} workflow mismatch")
    require(
        case["source_trace_ref"] == {
            "trace_id": trace_id,
            "task_id": trace["task_id"],
            "request_id": trace["request_id"],
        },
        f"{fixture_id} source trace ref must match trace completeness",
    )
    require(
        case["source_eval_result_ref"] == {
            "result_id": eval_result_id,
            "fixture_id": fixture_id,
            "status": eval_result["status"],
            "final_export_allowed": eval_result["qa_export_gate"]["final_export_allowed"],
            "denial_reasons": eval_result["qa_export_gate"]["denial_reasons"],
        },
        f"{fixture_id} source eval result ref must match stored eval result",
    )
    require(
        case["source_gate_case_ref"] == {
            "case_id": gate["case_id"],
            "package_id": gate["package_id"],
            "export_id": gate["export_id"],
            "admin_override_required_for_export": gate["admin_override_required_for_export"],
            "override_requires_audit": gate["override_requires_audit"],
        },
        f"{fixture_id} source gate case ref must match trace export gate matrix",
    )

    user = case["user_trace_projection"]
    require(set(user["visible_fields"]) == USER_VISIBLE_FIELDS, f"{fixture_id} user projection visible fields mismatch")
    require(set(user["hidden_fields"]) == USER_HIDDEN_FIELDS, f"{fixture_id} user projection hidden fields mismatch")
    require(user["failure_mapping_required"] is trace["user_failure_mapping"]["present"], f"{fixture_id} user failure mapping mismatch")
    require(user["includes_denial_reasons"] is True, f"{fixture_id} user projection must expose denial reasons")
    require(
        user["download_enabled"] is eval_result["qa_export_gate"]["final_export_allowed"],
        f"{fixture_id} user download flag must follow final export gate",
    )

    admin = case["admin_trace_projection"]
    require(set(admin["visible_tables"]) == ADMIN_VISIBLE_TABLES, f"{fixture_id} admin visible tables mismatch")
    require(admin["rbac_scope"] == "admin_reviewer", f"{fixture_id} admin projection must require reviewer RBAC")
    require(admin["payload_redaction_required"] is True, f"{fixture_id} admin projection must require redaction")
    require(admin["links_trace_export_eval_qa_safety"] is trace["admin_visibility"]["present"], f"{fixture_id} admin link flag mismatch")
    require(admin["safety_decision_steps"] == SAFETY_STEPS, f"{fixture_id} admin safety steps mismatch")
    for event in trace["step_events"]:
        require(event["safety_decision_ref"]["enforcement_point"] in admin["safety_decision_steps"], f"{fixture_id} missing admin safety decision step")

    retention = case["export_retention_projection"]
    expected_files = retained_files_from_export_contract(eval_result["export_contract"])
    require(retention["package_id"] == gate["package_id"], f"{fixture_id} retention package mismatch")
    require(retention["export_id"] == gate["export_id"], f"{fixture_id} retention export mismatch")
    require(retention["retained_files"] == expected_files, f"{fixture_id} retained files must derive from export contract")
    require(retention["download_enabled"] is gate["final_export_allowed"], f"{fixture_id} retention download flag must match gate")
    require(retention["final_export_allowed"] is eval_result["qa_export_gate"]["final_export_allowed"], f"{fixture_id} retention export gate mismatch")
    require(retention["retention_reasons"] == gate["denial_reasons"], f"{fixture_id} retention reasons must match gate denial reasons")
    require("trace_provenance.json" in retention["retained_when_blocked"], f"{fixture_id} blocked exports must retain trace provenance")
    require("safety_disclaimer.md" in retention["retained_when_blocked"], f"{fixture_id} blocked exports must retain safety disclaimer")
    if qa_items or eval_result["export_contract"]["qa_report"]:
        require("qa_report.json" in retention["retained_when_blocked"], f"{fixture_id} blocked exports with QA evidence must retain QA report")
    require(
        set(retention["retained_when_blocked"]) <= set(retention["retained_files"]),
        f"{fixture_id} blocked retention files must be retained export files",
    )


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    trace_by_fixture, gate_by_fixture, eval_by_fixture, qa_by_fixture, eval_result_id = build_indexes()

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "projection contract must cite Rev2")
    require(set(contract["required_projection_fields"]) == REQUIRED_PROJECTION_FIELDS, "projection fields mismatch")
    for key, value in contract["projection_policies"].items():
        require(value is True, f"projection policy {key} must be true")

    seen = set()
    for case in contract["trace_projection_cases"]:
        fixture_id = case["fixture_id"]
        require(fixture_id not in seen, f"duplicate projection fixture {fixture_id}")
        seen.add(fixture_id)
        require(case["case_id"] == f"trace_visibility_case_{fixture_id.removeprefix('fx_')}", f"{fixture_id} case id mismatch")
        require(fixture_id in trace_by_fixture, f"{fixture_id} missing from trace completeness")
        require(fixture_id in gate_by_fixture, f"{fixture_id} missing from trace export gate matrix")
        require(fixture_id in eval_by_fixture, f"{fixture_id} missing from eval results")
        validate_projection_case(
            case,
            trace_by_fixture[fixture_id],
            gate_by_fixture[fixture_id],
            eval_by_fixture[fixture_id],
            qa_by_fixture.get(fixture_id, []),
            eval_result_id,
        )

    require(seen == set(eval_by_fixture), "projection contract must cover every eval fixture exactly")


def main() -> int:
    try:
        validate_openapi_projection_schema()
        validate_contract()
    except TraceVisibilityContractError as exc:
        print(f"trace visibility/export retention validation failed: {exc}", file=sys.stderr)
        return 1
    print("trace visibility/export retention validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
