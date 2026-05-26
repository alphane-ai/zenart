#!/usr/bin/env python3
"""Validate Stage 0 Rev2 QA result category and outcome coverage."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
CONTRACT = FIXTURE_DIR / "qa_result_coverage.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"
EVAL_RESULTS = FIXTURE_DIR / "starter_eval_results.json"
TRACE_COMPLETENESS = FIXTURE_DIR / "trace_completeness.json"

QA_CATEGORY_ORDER = [
    "file_integrity",
    "dimensions",
    "aspect_ratio",
    "safe_area",
    "blank_output",
    "duplicate_similarity",
    "four_option_distinctness",
    "text_readability",
    "structured_text",
    "product_logo_preservation",
    "forbidden_claims",
    "watermark_signature_risk",
    "export_completeness",
]

REQUIRED_OUTCOMES = {"pass", "warn", "block"}


class QACoverageError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise QACoverageError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise QACoverageError(message)


def fixture_result_outcome(result: dict[str, Any]) -> str:
    if result["status"] == "pass" and result["qa_export_gate"]["final_export_allowed"] is True:
        return "pass"
    if any(result["qa_export_gate"]["blocking_qa_check_ids"]):
        return "block"
    return "warn"


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

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "QA coverage contract must cite Rev2")
    require(contract["qa_fixture"]["path"] == "fixtures/stage0/rev2/eval/qa_results.json", "QA fixture path mismatch")
    require(len(qa_results) >= contract["qa_fixture"]["minimum_fixture_count"], "QA fixture count below coverage contract")

    check_ids = [item["check_id"] for item in qa_results]
    require(len(check_ids) == len(set(check_ids)), "QA check_id values must be unique")
    require(set(contract["required_categories"]) == set(QA_CATEGORY_ORDER), "required QA categories mismatch")
    require(set(contract["required_outcomes"]) == REQUIRED_OUTCOMES, "required QA outcomes mismatch")

    category_contracts = {item["check_category"]: item for item in contract["category_contracts"]}
    require(set(category_contracts) == set(QA_CATEGORY_ORDER), "category coverage contract must cover every QA category")
    require(len(category_contracts) == len(contract["category_contracts"]), "duplicate category contract entries")

    qa_by_id = {item["check_id"]: item for item in qa_results}
    categories_seen = {item["check_category"] for item in qa_results}
    require(categories_seen == set(QA_CATEGORY_ORDER), "QA result fixtures must cover every required category")

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    fixture_results = eval_results[0]["fixture_results"]
    eval_by_fixture = {item["fixture_id"]: item for item in fixture_results}
    eval_by_trace = {item["trace_contract"]["trace_id"]: item for item in fixture_results}
    trace_ids = {trace["trace_id"] for trace in trace_contract["traces"]}

    for item in qa_results:
        contract_item = category_contracts[item["check_category"]]
        observed = set(item["evidence"]["observed"])
        expected = set(item["evidence"]["expected"])
        require(
            set(contract_item["required_observed_fields"]) <= observed,
            f"{item['check_id']} missing observed coverage fields",
        )
        require(
            set(contract_item["required_expected_fields"]) <= expected,
            f"{item['check_id']} missing expected coverage fields",
        )
        outcome = qa_result_outcome(item)
        require(
            outcome in contract_item["expected_outcomes"],
            f"{item['check_id']} outcome {outcome} is not allowed by its category contract",
        )
        require(item["export_gate"]["override_requires_audit"] is True, f"{item['check_id']} override must require audit")
        if outcome == "block":
            require(item["severity"] == "blocking", f"{item['check_id']} blocking outcome must use blocking severity")
            require(item["export_gate"]["blocks_final_export"] is True, f"{item['check_id']} must block final export")
        if outcome == "warn":
            require(item["severity"] == "warning", f"{item['check_id']} warning outcome must use warning severity")
            require(item["export_gate"]["blocks_final_export"] is False, f"{item['check_id']} warning must not block export")
        fixture_id = item["evidence"]["fixture_id"]
        trace_id = item["evidence"]["trace_id"]
        require(fixture_id in eval_by_fixture, f"{item['check_id']} references unknown eval fixture")
        require(trace_id in eval_by_trace, f"{item['check_id']} references unknown eval trace")
        require(trace_id in trace_ids, f"{item['check_id']} trace missing from trace completeness fixture")
        require(eval_by_fixture[fixture_id]["trace_contract"]["trace_id"] == trace_id, f"{item['check_id']} trace mismatch")

    summary_categories = set(eval_results[0]["summary"]["qa_categories_covered"])
    require(summary_categories == set(contract["required_categories"]), "eval result QA summary categories must match coverage contract")

    outcomes_seen = {fixture_result_outcome(item) for item in fixture_results}
    outcomes_seen.update(qa_result_outcome(item) for item in qa_results)
    require(REQUIRED_OUTCOMES <= outcomes_seen, f"QA coverage missing outcomes: {sorted(REQUIRED_OUTCOMES - outcomes_seen)}")

    examples = contract["outcome_examples"]
    example_outcomes = {item["outcome"] for item in examples}
    require(example_outcomes == REQUIRED_OUTCOMES, "outcome examples must cover pass, warn, and block exactly")
    for example in examples:
        fixture_id = example["fixture_id"]
        trace_id = example["trace_id"]
        require(fixture_id in eval_by_fixture, f"outcome example references unknown fixture {fixture_id}")
        require(trace_id in eval_by_trace, f"outcome example references unknown trace {trace_id}")
        result = eval_by_fixture[fixture_id]
        require(result["workflow"] == example["workflow"], f"{fixture_id} outcome example workflow mismatch")
        require(result["trace_contract"]["trace_id"] == trace_id, f"{fixture_id} outcome example trace mismatch")
        if example["source"] == "eval_result_fixture":
            require(fixture_result_outcome(result) == example["outcome"], f"{fixture_id} eval outcome example mismatch")
            require(
                result["qa_export_gate"]["final_export_allowed"] is example["final_export_allowed"],
                f"{fixture_id} final export allowance mismatch",
            )
        else:
            for check_id in example["check_ids"]:
                require(check_id in qa_by_id, f"outcome example references unknown check {check_id}")
                qa_item = qa_by_id[check_id]
                require(qa_item["evidence"]["fixture_id"] == fixture_id, f"{check_id} example fixture mismatch")
                require(qa_item["evidence"]["trace_id"] == trace_id, f"{check_id} example trace mismatch")
                require(qa_result_outcome(qa_item) == example["outcome"], f"{check_id} QA outcome example mismatch")
            require(
                result["qa_export_gate"]["final_export_allowed"] is example["final_export_allowed"],
                f"{fixture_id} final export allowance mismatch",
            )

    policy = contract["export_gate_policy"]
    require(policy["blocking_severity_blocks_final_export"] is True, "blocking export policy must be explicit")
    require(policy["warning_severity_does_not_block_final_export"] is True, "warning export policy must be explicit")
    require(policy["admin_override_requires_audit"] is True, "override audit policy must be explicit")


def main() -> int:
    try:
        validate_contract()
    except QACoverageError as exc:
        print(f"QA result coverage validation failed: {exc}", file=sys.stderr)
        return 1
    print("QA result coverage validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
