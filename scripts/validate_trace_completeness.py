#!/usr/bin/env python3
"""Validate the Stage 0 Rev2 trace completeness fixture contract."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
TRACE_FIXTURE = FIXTURE_DIR / "trace_completeness.json"
EVAL_RESULTS = FIXTURE_DIR / "starter_eval_results.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"
SAFETY_RULES = FIXTURE_DIR / "safety_rules.json"

REQUIRED_TRACE_FIELDS = {
    "schema_validation",
    "provenance",
    "safety_status",
    "qa_eval_status",
    "quota_transaction_id",
    "admin_visibility",
    "user_failure_mapping",
}

REQUIRED_STEPS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

REQUIRED_STEP_ORDER = [
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
]

TRACE_CONTRACT_TO_FIXTURE_FIELD = {
    "schema_validation": "has_schema_validation",
    "provenance": "has_provenance",
    "safety_status": "has_safety_status",
    "qa_eval_status": "has_qa_eval_status",
    "admin_visibility": "has_admin_visibility",
    "user_failure_mapping": "has_user_failure_mapping",
}


class TraceContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise TraceContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise TraceContractError(message)


def schema_block(openapi_text: str, schema_name: str) -> str:
    match = re.search(
        rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(match is not None, f"OpenAPI schema {schema_name} missing")
    return match.group("body")


def require_field_in_schema(body: str, schema_name: str, field: str) -> None:
    require(f"{field}:" in body, f"OpenAPI schema {schema_name} missing {field}")
    require(
        re.search(rf"required: \[[^\]]*\b{re.escape(field)}\b", body)
        or re.search(rf"^\s+- {re.escape(field)}$", body, flags=re.MULTILINE),
        f"OpenAPI schema {schema_name} must require {field}",
    )


def validate_openapi_trace_schema() -> None:
    text = OPENAPI.read_text(encoding="utf-8")
    body = schema_block(text, "AgentTrace")
    for field in [
        "id",
        "task_id",
        "request_id",
        "workflow",
        "step_name",
        "schema_validation",
        "provenance",
        "safety_status",
        "qa_eval_status",
        "quota_transaction_id",
        "admin_visibility",
        "user_failure_mapping",
        "export_references",
        "artifact_links",
        "created_at",
    ]:
        require_field_in_schema(body, "AgentTrace", field)
    for point in REQUIRED_STEPS:
        require(point in body, f"OpenAPI AgentTrace step_name enum missing {point}")


def validate_trace_fixture() -> None:
    contract = load_json(TRACE_FIXTURE)
    eval_results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)
    safety_rules = load_json(SAFETY_RULES)

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "trace contract must cite Rev2")
    require(set(contract["required_trace_fields"]) == REQUIRED_TRACE_FIELDS, "trace contract required fields mismatch")
    require(set(contract["required_pipeline_steps"]) == REQUIRED_STEPS, "trace contract required steps mismatch")

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    eval_by_trace = {
        item["trace_contract"]["trace_id"]: item
        for item in eval_results[0]["fixture_results"]
    }
    eval_result_id = eval_results[0]["result_id"]
    eval_fixture_ids = {
        item["fixture_id"]
        for item in eval_results[0]["fixture_results"]
    }
    qa_by_fixture: dict[str, list[dict[str, Any]]] = {}
    for item in qa_results:
        qa_by_fixture.setdefault(item["evidence"]["fixture_id"], []).append(item)

    safety_points = set().union(*(set(rule["enforcement_points"]) for rule in safety_rules))
    require(REQUIRED_STEPS <= safety_points, f"safety rules missing trace enforcement steps: {sorted(REQUIRED_STEPS - safety_points)}")

    seen = set()
    seen_fixtures = set()
    workflows = set()
    for trace in contract["traces"]:
        trace_id = trace["trace_id"]
        require(trace_id not in seen, f"duplicate trace_id {trace_id}")
        seen.add(trace_id)
        seen_fixtures.add(trace["fixture_id"])
        workflows.add(trace["workflow"])
        require(trace_id in eval_by_trace, f"{trace_id} is missing from eval fixture trace contracts")
        require(
            trace["fixture_id"] == eval_by_trace[trace_id]["fixture_id"],
            f"{trace_id} fixture_id must match eval fixture result",
        )
        require(
            trace["workflow"] == eval_by_trace[trace_id]["workflow"],
            f"{trace_id} workflow must match eval fixture result",
        )
        require(set(trace["covered_steps"]) == REQUIRED_STEPS, f"{trace_id} must cover every pipeline step")
        validate_step_events(trace, eval_by_trace[trace_id])
        validate_eval_and_qa_refs(
            trace,
            eval_by_trace[trace_id],
            qa_by_fixture.get(trace["fixture_id"], []),
            eval_result_id,
        )

        eval_trace = eval_by_trace[trace_id]["trace_contract"]
        for contract_field, eval_field in TRACE_CONTRACT_TO_FIXTURE_FIELD.items():
            require(
                trace[contract_field]["present"] is True,
                f"{trace_id} fixture field {contract_field} must be present",
            )
            require(eval_trace[eval_field] is True, f"{trace_id} eval result missing {eval_field}")

        require(trace["quota_transaction_id"].startswith("quota_txn_"), f"{trace_id} must carry quota transaction id")
        for qa_item in qa_by_fixture.get(trace["fixture_id"], []):
            require(
                qa_item["evidence"]["trace_id"] == trace_id,
                f"{qa_item['check_id']} QA trace must match trace completeness fixture trace",
            )

        export_contract = eval_by_trace[trace_id]["export_contract"]
        for field in [
            "manifest",
            "qa_report",
            "metadata",
            "trace_provenance",
            "safety_disclaimer_when_applicable",
        ]:
            require(
                trace["export_references"][field] == export_contract[field],
                f"{trace_id} export reference {field} must match eval export contract",
            )
        validate_artifact_links(trace, eval_by_trace[trace_id])

    require(
        workflows
        == {
            "ecommerce_growth_pack",
            "business_visual_doc_pack",
            "local_merchant_campaign_pack",
            "character_ip_concept_pack",
        },
        "trace completeness fixture must cover all four vertical workflows",
    )
    require(seen == set(eval_by_trace), "trace completeness fixture must cover every eval result trace exactly")
    require(
        seen_fixtures == eval_fixture_ids,
        "trace completeness fixture must cover every eval fixture exactly",
    )


def validate_step_events(trace: dict[str, Any], eval_result: dict[str, Any] | None = None) -> None:
    trace_id = trace["trace_id"]
    events = trace["step_events"]
    require(len(events) == len(REQUIRED_STEP_ORDER), f"{trace_id} must emit one trace event per pipeline step")
    require(
        [event["step_name"] for event in events] == REQUIRED_STEP_ORDER,
        f"{trace_id} step_events must follow Rev2 pipeline order",
    )
    require(
        [event["emission_order"] for event in events] == list(range(1, len(REQUIRED_STEP_ORDER) + 1)),
        f"{trace_id} step_events must have deterministic emission_order values",
    )

    for event in events:
        step = event["step_name"]
        require(event["trace_id"] == trace_id, f"{trace_id} {step} event trace_id mismatch")
        require(event["task_id"] == trace["task_id"], f"{trace_id} {step} event task_id mismatch")
        require(event["request_id"] == trace["request_id"], f"{trace_id} {step} event request_id mismatch")
        require(event["storage_table"] == "agent_traces", f"{trace_id} {step} event must persist to agent_traces")
        require(
            event["quota_transaction_id"] == trace["quota_transaction_id"],
            f"{trace_id} {step} event quota transaction mismatch",
        )
        for field in [
            "schema_validation",
            "provenance",
            "safety_status",
            "qa_eval_status",
            "admin_visibility",
            "user_failure_mapping",
        ]:
            require(event[field]["present"] is True, f"{trace_id} {step} event missing {field}")
        require(
            event["safety_status"]["source"] == f"safety_decisions.enforcement_point.{step}",
            f"{trace_id} {step} event safety source must link to matching safety decision",
        )
        validate_safety_decision_ref(trace, event, eval_result)


def validate_eval_and_qa_refs(
    trace: dict[str, Any],
    eval_result: dict[str, Any],
    qa_items: list[dict[str, Any]],
    eval_result_id: str,
) -> None:
    trace_id = trace["trace_id"]
    qa_check_ids = [item["check_id"] for item in qa_items]
    blocking_qa_check_ids = eval_result["qa_export_gate"]["blocking_qa_check_ids"]
    coverage_complete = eval_result["qa_coverage_contract"]["coverage_complete"]
    final_export_allowed = eval_result["qa_export_gate"]["final_export_allowed"]

    require(
        trace["eval_result_ref"] == {
            "result_id": eval_result_id,
            "table": "eval_results",
            "fixture_id": eval_result["fixture_id"],
            "status": eval_result["status"],
            "qa_export_gate_final_export_allowed": final_export_allowed,
        },
        f"{trace_id} eval result ref must match stored eval result and export gate",
    )
    require(
        trace["qa_result_refs"] == {
            "table": "qa_results",
            "check_ids": qa_check_ids,
            "blocking_check_ids": blocking_qa_check_ids,
            "coverage_complete": coverage_complete,
        },
        f"{trace_id} QA result refs must match stored QA results and coverage",
    )

    events = {event["step_name"]: event for event in trace["step_events"]}
    require("qa_result_refs" in events["qa"], f"{trace_id} QA step must link QA result rows")
    require(
        events["qa"]["qa_result_refs"] == {
            "table": "qa_results",
            "check_ids": qa_check_ids,
            "coverage_complete": coverage_complete,
        },
        f"{trace_id} QA step result refs must match fixture QA results",
    )
    require("eval_result_ref" in events["export"], f"{trace_id} export step must link stored eval result")
    require(
        events["export"]["eval_result_ref"] == {
            "result_id": eval_result_id,
            "table": "eval_results",
            "fixture_id": eval_result["fixture_id"],
            "final_export_allowed": final_export_allowed,
            "blocking_qa_check_ids": blocking_qa_check_ids,
        },
        f"{trace_id} export step eval ref must match export gate state",
    )

    for step_name, event in events.items():
        if step_name != "qa":
            require("qa_result_refs" not in event, f"{trace_id} {step_name} step must not carry QA result refs")
        if step_name != "export":
            require("eval_result_ref" not in event, f"{trace_id} {step_name} step must not carry eval result ref")


def validate_safety_decision_ref(
    trace: dict[str, Any],
    event: dict[str, Any],
    eval_result: dict[str, Any] | None,
) -> None:
    trace_id = trace["trace_id"]
    step = event["step_name"]
    require("safety_decision_ref" in event, f"{trace_id} {step} event missing safety_decision_ref")
    ref = event["safety_decision_ref"]
    require(ref["table"] == "safety_decisions", f"{trace_id} {step} decision ref must persist to safety_decisions")
    require(ref["enforcement_point"] == step, f"{trace_id} {step} decision ref enforcement point mismatch")
    require(
        ref["decision_id"] == f"safety_decision_{trace['fixture_id']}_{step}",
        f"{trace_id} {step} decision ref must be fixture and step scoped",
    )
    if eval_result is None:
        return

    decision_contract = eval_result["safety_decision_contract"]
    require(ref["decision"] == decision_contract["decision"], f"{trace_id} {step} decision ref action mismatch")
    require(
        ref["decision_source"] == decision_contract["decision_source"],
        f"{trace_id} {step} decision source mismatch",
    )
    require(
        ref["source_rule_ids"] == decision_contract["source_rule_ids"],
        f"{trace_id} {step} decision source rules mismatch",
    )
    require(ref["audit_required"] is decision_contract["audit_required"], f"{trace_id} {step} audit flag mismatch")


def validate_artifact_links(trace: dict[str, Any], eval_result: dict[str, Any]) -> None:
    trace_id = trace["trace_id"]
    fixture_id = trace["fixture_id"]
    links = trace["artifact_links"]
    candidate_count = eval_result.get("candidate_count", 0)
    expected_assets = [
        f"asset_{fixture_id}_candidate_{index}"
        for index in range(1, candidate_count + 1)
    ]

    require(
        links["asset_ids"] == expected_assets,
        f"{trace_id} artifact asset links must match fixture candidate_count",
    )
    require(
        links["package_id"] == f"package_{fixture_id}",
        f"{trace_id} artifact package link must be fixture-scoped",
    )
    require(
        links["export_id"] == f"export_{fixture_id}",
        f"{trace_id} artifact export link must be fixture-scoped",
    )
    require(
        links["manifest_linked"] == trace["export_references"]["manifest"],
        f"{trace_id} manifest artifact link must match export references",
    )
    require(
        links["qa_report_linked"] == trace["export_references"]["qa_report"],
        f"{trace_id} QA report artifact link must match export references",
    )
    require(
        links["metadata_linked"] == eval_result["export_contract"]["metadata"],
        f"{trace_id} metadata artifact link must match eval export metadata",
    )
    require(
        links["trace_provenance_linked"] == trace["export_references"]["trace_provenance"],
        f"{trace_id} trace provenance artifact link must match export references",
    )
    require(
        links["safety_disclaimer_linked"] == trace["export_references"]["safety_disclaimer_when_applicable"],
        f"{trace_id} safety disclaimer artifact link must match export references",
    )
    require(
        links["trace_provenance_linked"] is True,
        f"{trace_id} must link trace provenance even when manifest or QA report is blocked",
    )
    require(
        links["safety_disclaimer_linked"] is True,
        f"{trace_id} must link applicable safety disclaimer even when export is blocked",
    )


def main() -> int:
    try:
        validate_openapi_trace_schema()
        validate_trace_fixture()
    except TraceContractError as exc:
        print(f"trace completeness validation failed: {exc}", file=sys.stderr)
        return 1
    print("trace completeness validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
