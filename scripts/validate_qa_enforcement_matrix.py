#!/usr/bin/env python3
"""Validate Stage 0 Rev2 QA enforcement matrix fixture links."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
CONTRACT = FIXTURE_DIR / "qa_enforcement_matrix.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"
EVAL_RESULTS = FIXTURE_DIR / "starter_eval_results.json"
TRACE_COMPLETENESS = FIXTURE_DIR / "trace_completeness.json"

REQUIRED_FAMILIES = {
    "integrity",
    "blank",
    "readability",
    "structured_text",
    "logo_preservation",
    "claims",
    "export_completeness",
}

REQUIRED_TRACE_STEPS = [
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
]


class QAEnforcementMatrixError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise QAEnforcementMatrixError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise QAEnforcementMatrixError(message)


def qa_result_outcome(item: dict[str, Any]) -> str:
    if item["export_gate"]["blocks_final_export"] is True:
        return "block"
    if item["severity"] == "warning":
        return "warn"
    return "pass"


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    qa_results = load_json(QA_RESULTS)
    eval_results = load_json(EVAL_RESULTS)
    trace_contract = load_json(TRACE_COMPLETENESS)

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "QA enforcement matrix must cite Rev2")
    require(contract["qa_fixture"]["path"] == "fixtures/stage0/rev2/eval/qa_results.json", "QA fixture path mismatch")
    require(
        contract["qa_fixture"]["requires_qa_result_schema"] == "schemas/stage0/rev2/qa_result.schema.json",
        "QA result schema link mismatch",
    )
    require(contract["eval_result_link"]["requires_qa_export_gate_match"] is True, "eval export gate link must be enforced")
    require(contract["trace_contract_link"]["requires_all_pipeline_steps"] is True, "trace pipeline coverage must be enforced")
    require(set(contract["required_families"]) == REQUIRED_FAMILIES, "required QA families mismatch")

    family_contracts = {item["family"]: item for item in contract["family_contracts"]}
    require(set(family_contracts) == REQUIRED_FAMILIES, "QA enforcement matrix must cover each required family once")
    require(len(family_contracts) == len(contract["family_contracts"]), "duplicate QA family contracts")

    check_ids = [item["check_id"] for item in qa_results]
    require(len(check_ids) == len(set(check_ids)), "QA result check_id values must be unique")
    qa_by_id = {item["check_id"]: item for item in qa_results}

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    eval_by_trace = {item["trace_contract"]["trace_id"]: item for item in eval_results[0]["fixture_results"]}
    trace_by_id = {trace["trace_id"]: trace for trace in trace_contract["traces"]}

    for family, family_contract in family_contracts.items():
        validate_family(family, family_contract, qa_by_id, eval_by_fixture, eval_by_trace, trace_by_id)

    policy = contract["export_gate_policy"]
    require(policy["blocking_checks_block_final_export"] is True, "blocking QA checks must block final export")
    require(
        policy["warning_checks_do_not_directly_block_final_export"] is True,
        "warning QA checks must not directly block final export",
    )
    require(policy["blocking_override_requires_audit"] is True, "blocking QA override must require audit")
    require(
        policy["export_completeness_missing_artifact_blocks_download"] is True,
        "missing export artifacts must block download",
    )
    require(policy["safety_block_also_blocks_export"] is True, "safety blocks must also block export")


def validate_family(
    family: str,
    family_contract: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    eval_by_fixture: dict[str, dict[str, Any]],
    eval_by_trace: dict[str, dict[str, Any]],
    trace_by_id: dict[str, dict[str, Any]],
) -> None:
    fixture_id = family_contract["fixture_id"]
    trace_id = family_contract["trace_id"]
    expected_categories = set(family_contract["qa_categories"])
    required_check_ids = family_contract["required_check_ids"]

    require(fixture_id in eval_by_fixture, f"{family} references unknown eval fixture {fixture_id}")
    require(trace_id in eval_by_trace, f"{family} references unknown eval trace {trace_id}")
    require(trace_id in trace_by_id, f"{family} references unknown trace completeness record {trace_id}")

    eval_fixture = eval_by_fixture[fixture_id]
    trace = trace_by_id[trace_id]
    require(eval_fixture["trace_contract"]["trace_id"] == trace_id, f"{family} eval fixture trace mismatch")
    require(eval_fixture["workflow"] == family_contract["workflow"], f"{family} eval workflow mismatch")
    require(trace["fixture_id"] == fixture_id, f"{family} trace fixture mismatch")
    require(trace["workflow"] == family_contract["workflow"], f"{family} trace workflow mismatch")
    require(trace["covered_steps"] == REQUIRED_TRACE_STEPS, f"{family} trace must cover the Rev2 pipeline in order")
    require(
        family_contract["required_trace_steps"] == REQUIRED_TRACE_STEPS,
        f"{family} contract must require the Rev2 pipeline order",
    )
    require(
        [event["step_name"] for event in trace["step_events"]] == REQUIRED_TRACE_STEPS,
        f"{family} trace step events must cover the Rev2 pipeline in order",
    )

    qa_items = []
    for check_id in required_check_ids:
        require(check_id in qa_by_id, f"{family} references unknown QA check {check_id}")
        item = qa_by_id[check_id]
        qa_items.append(item)
        require(item["workflow"] == family_contract["workflow"], f"{family} {check_id} workflow mismatch")
        require(item["evidence"]["fixture_id"] == fixture_id, f"{family} {check_id} fixture mismatch")
        require(item["evidence"]["trace_id"] == trace_id, f"{family} {check_id} trace mismatch")
        require(item["check_category"] in expected_categories, f"{family} {check_id} category not in contract")
        require(item["severity"] == family_contract["expected_severity"], f"{family} {check_id} severity mismatch")
        require(qa_result_outcome(item) == family_contract["expected_outcome"], f"{family} {check_id} outcome mismatch")
        require(
            item["export_gate"]["blocks_final_export"] is family_contract["expected_blocks_final_export"],
            f"{family} {check_id} export block mismatch",
        )
        require(
            item["export_gate"]["eligible_admin_override"] is family_contract["expected_admin_override_eligible"],
            f"{family} {check_id} admin override eligibility mismatch",
        )
        require(item["export_gate"]["override_requires_audit"] is True, f"{family} {check_id} must require override audit")
        require(item["evidence"]["source_artifacts"], f"{family} {check_id} must cite source artifacts")
        require(item["user_visible_message"].strip(), f"{family} {check_id} must include user-visible message")
        require(item["admin_reason"].strip(), f"{family} {check_id} must include admin reason")

        observed = set(item["evidence"]["observed"])
        expected = set(item["evidence"]["expected"])
        require(
            set(family_contract["required_observed_fields"]) <= observed,
            f"{family} {check_id} missing observed fields",
        )
        require(
            set(family_contract["required_expected_fields"]) <= expected,
            f"{family} {check_id} missing expected fields",
        )

    observed_categories = {item["check_category"] for item in qa_items}
    require(observed_categories == expected_categories, f"{family} category coverage mismatch")
    require(
        eval_fixture["qa_export_gate"]["final_export_allowed"] is family_contract["expected_final_export_allowed"],
        f"{family} eval final export allowance mismatch",
    )
    if family_contract["expected_blocks_final_export"]:
        missing_blocking = set(required_check_ids) - set(eval_fixture["qa_export_gate"]["blocking_qa_check_ids"])
        require(not missing_blocking, f"{family} blocking QA checks missing from eval export gate: {sorted(missing_blocking)}")
        missing_categories = expected_categories - set(eval_fixture["qa_export_gate"]["blocking_qa_categories"])
        require(not missing_categories, f"{family} blocking categories missing from eval export gate: {sorted(missing_categories)}")
    else:
        overlapping_blocks = set(required_check_ids) & set(eval_fixture["qa_export_gate"]["blocking_qa_check_ids"])
        require(not overlapping_blocks, f"{family} warning checks must not appear as eval blocking checks: {sorted(overlapping_blocks)}")

    if family == "claims":
        require(eval_fixture["qa_export_gate"]["safety_blocks_export"] is True, "claims safety block must block export")
    if family == "export_completeness":
        require(
            eval_fixture["qa_export_gate"]["export_artifacts_complete"] is False,
            "export completeness fixture must model incomplete artifacts",
        )


def main() -> int:
    try:
        validate_contract()
    except QAEnforcementMatrixError as exc:
        print(f"QA enforcement matrix validation failed: {exc}", file=sys.stderr)
        return 1
    print("QA enforcement matrix validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
