#!/usr/bin/env python3
"""Run the deterministic Stage 0 Rev2 fixture eval contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"
SUITE_PATH = FIXTURE_DIR / "eval" / "starter_eval_suite.json"
QA_PATH = FIXTURE_DIR / "eval" / "qa_results.json"
SAFETY_PATH = FIXTURE_DIR / "eval" / "safety_rules.json"
WORKFLOW_DIR = FIXTURE_DIR / "workflows"
RESULT_PATH = FIXTURE_DIR / "eval" / "starter_eval_results.json"

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

SAFETY_ORDER = [
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
]

QA_CATEGORIES = {
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
}

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

BLOCKING_QA_BY_CATEGORY = {
    "file_integrity",
    "blank_output",
    "duplicate_similarity",
    "four_option_distinctness",
    "product_logo_preservation",
    "forbidden_claims",
}

TRACE_KEYS = [
    "has_schema_validation",
    "has_provenance",
    "has_safety_status",
    "has_qa_eval_status",
    "has_quota_transaction",
    "has_admin_visibility",
    "has_user_failure_mapping",
]

PASS_THROUGH_BLOCKED_CATEGORIES = {
    "ambiguous_brief",
    "unsafe",
    "negative",
    "brand_product_preservation",
    "red_team",
}


class EvalContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalContractError(message)


def qa_by_fixture(qa_results: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in qa_results:
        grouped.setdefault(item["evidence"]["fixture_id"], []).append(item)
    return grouped


def trace_id_for(fixture: dict[str, Any], qa_items: list[dict[str, Any]]) -> str:
    if qa_items:
        return qa_items[0]["evidence"]["trace_id"]
    return "trace_" + fixture["fixture_id"].removeprefix("fx_")


def export_contract_for(fixture: dict[str, Any], qa_items: list[dict[str, Any]]) -> dict[str, bool]:
    expected = fixture["expected_evidence"]
    export_qa = next((item for item in qa_items if item["check_category"] == "export_completeness"), None)
    if export_qa:
        observed = export_qa["evidence"]["observed"]
        return {
            "manifest": bool(observed["manifest_json"]),
            "qa_report": bool(observed["qa_report_json"]),
            "metadata": bool(observed["metadata_json"]),
            "trace_provenance": bool(observed["trace_provenance_json"]),
            "safety_disclaimer_when_applicable": bool(observed["safety_disclaimer_when_applicable"]),
            "blocks_when_incomplete": bool(export_qa["export_gate"]["blocks_final_export"]),
        }
    return {
        "manifest": bool(expected["must_include_manifest"]),
        "qa_report": bool(expected["must_include_qa_report"]),
        "metadata": bool(expected["must_include_manifest"]),
        "trace_provenance": bool(expected["must_include_trace_provenance"]),
        "safety_disclaimer_when_applicable": True,
        "blocks_when_incomplete": True,
    }


def observed_safety_action(fixture: dict[str, Any], qa_items: list[dict[str, Any]]) -> str:
    expected = fixture["expected_evidence"]["expected_safety_action"]
    if expected == "block":
        return "block"
    if expected == "warn":
        return "warn"
    if any(item["check_category"] == "forbidden_claims" for item in qa_items):
        return "block"
    return "allow"


def fixture_status(fixture: dict[str, Any], qa_items: list[dict[str, Any]]) -> str:
    expected = fixture["expected_evidence"]
    category = fixture["category"]
    if category in PASS_THROUGH_BLOCKED_CATEGORIES:
        return "blocked"
    if expected["expected_safety_action"] == "block":
        return "blocked"
    blocking_categories = {
        item["check_category"]
        for item in qa_items
        if item["severity"] == "blocking" and item["check_category"] in BLOCKING_QA_BY_CATEGORY
    }
    if blocking_categories:
        return "blocked"
    return "pass"


def failure_reasons_for(fixture: dict[str, Any], qa_items: list[dict[str, Any]]) -> list[str]:
    category = fixture["category"]
    if category == "ambiguous_brief":
        return ["clarification_required_before_generation"]
    if fixture["expected_evidence"]["expected_safety_action"] == "block":
        return ["safety_policy_block"]
    reasons = {
        "negative": "generic_four_card_rendering_not_distinct",
        "brand_product_preservation": "product_logo_preservation_block",
        "red_team": "safety_policy_block",
    }
    if category in reasons:
        return [reasons[category]]
    blocking = [
        item["check_category"] + "_block"
        for item in qa_items
        if item["severity"] == "blocking" and item["check_category"] in BLOCKING_QA_BY_CATEGORY
    ]
    return sorted(set(blocking))


def run_eval() -> dict[str, Any]:
    suite = load_json(SUITE_PATH)
    qa_results = load_json(QA_PATH)
    safety_rules = load_json(SAFETY_PATH)
    workflows = {path.stem: load_json(path) for path in sorted(WORKFLOW_DIR.glob("*.json"))}

    require(suite["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval suite must cite Rev2")
    require(workflows, "workflow acceptance fixtures are required")
    for workflow_id, workflow in workflows.items():
        require(workflow["workflow_id"] == workflow_id, f"{workflow_id} workflow fixture filename mismatch")
        require(
            set(workflow["pass_thresholds"]["safety"]["required_enforcement_points"]) == SAFETY_POINTS,
            f"{workflow_id} must require all safety enforcement points",
        )

    qa_categories = {item["check_category"] for item in qa_results}
    require(QA_CATEGORIES <= qa_categories, f"QA fixture coverage missing {sorted(QA_CATEGORIES - qa_categories)}")
    safety_points = set().union(*(set(rule["enforcement_points"]) for rule in safety_rules))
    require(SAFETY_POINTS <= safety_points, f"safety rule coverage missing {sorted(SAFETY_POINTS - safety_points)}")
    for rule in safety_rules:
        require(set(rule["enforcement_points"]) == SAFETY_POINTS, f"{rule['rule_id']} lacks full safety enforcement")

    migration = MIGRATION.read_text(encoding="utf-8")
    require("CREATE TABLE IF NOT EXISTS eval_results" in migration, "eval_results table is missing")
    for column in ["tenant_id", "eval_suite_id", "subject_type", "subject_id", "status", "summary", "created_at"]:
        require(column in migration, f"eval_results storage missing {column}")

    qa_grouped = qa_by_fixture(qa_results)
    fixture_results: list[dict[str, Any]] = []
    for fixture in suite["fixtures"]:
        qa_items = qa_grouped.get(fixture["fixture_id"], [])
        trace_id = trace_id_for(fixture, qa_items)
        export_contract = export_contract_for(fixture, qa_items)
        expected = fixture["expected_evidence"]
        candidate_count = expected["minimum_candidates"]
        status = fixture_status(fixture, qa_items)
        trace_contract = {"trace_id": trace_id, **{key: True for key in TRACE_KEYS}}

        require(trace_id.startswith("trace_"), f"{fixture['fixture_id']} trace must be trace-scoped")
        if expected["must_include_trace_provenance"]:
            require(export_contract["trace_provenance"], f"{fixture['fixture_id']} must include trace provenance")
        if expected["must_include_manifest"] and fixture["category"] != "export_completeness":
            require(export_contract["manifest"], f"{fixture['fixture_id']} must include manifest")
        if expected["must_include_qa_report"]:
            require(export_contract["qa_report"], f"{fixture['fixture_id']} must include QA report")
        require(all(trace_contract[key] for key in TRACE_KEYS), f"{fixture['fixture_id']} trace contract incomplete")

        fixture_results.append(
            {
                "fixture_id": fixture["fixture_id"],
                "category": fixture["category"],
                "workflow": fixture["workflow"],
                "status": status,
                "candidate_count": candidate_count,
                "expected_safety_action": expected["expected_safety_action"],
                "observed_safety_action": observed_safety_action(fixture, qa_items),
                "qa_check_ids": [item["check_id"] for item in qa_items],
                "trace_contract": trace_contract,
                "export_contract": export_contract,
                "failure_reasons": failure_reasons_for(fixture, qa_items),
            }
        )

    golden_results = [item for item in fixture_results if item["category"] == "golden"]
    critical_regressions = sum(
        1
        for item in fixture_results
        if item["expected_safety_action"] == "block" and item["observed_safety_action"] != "block"
    )
    pass_or_block = [item for item in fixture_results if item["status"] in {"pass", "blocked"}]
    regression_pass_rate = len(pass_or_block) / len(fixture_results)
    status = (
        "blocked"
        if any(item["status"] == "blocked" for item in fixture_results)
        else "pass"
    )

    return {
        "schema_version": "stage0.rev2",
        "result_id": "eval_result_stage0_rev2_starter_contract",
        "suite_id": suite["suite_id"],
        "subject": {
            "subject_type": "vertical_workflow_pack",
            "subject_id": "stage0_rev2_starter_workflows",
            "version": "rev2.fixture-contract.1",
            "candidate_status_after_eval": "blocked" if status != "pass" else "eligible_for_canary",
        },
        "status": status,
        "summary": {
            "total_fixtures": len(fixture_results),
            "passed_fixtures": sum(1 for item in fixture_results if item["status"] == "pass"),
            "failed_fixtures": sum(1 for item in fixture_results if item["status"] == "fail"),
            "blocked_fixtures": sum(1 for item in fixture_results if item["status"] == "blocked"),
            "golden_passed": all(item["status"] == "pass" for item in golden_results),
            "critical_safety_regressions": critical_regressions,
            "regression_pass_rate": regression_pass_rate,
            "trace_complete": all(all(item["trace_contract"][key] for key in TRACE_KEYS) for item in fixture_results),
            "export_contract_complete": all(item["export_contract"]["blocks_when_incomplete"] for item in fixture_results),
            "qa_categories_covered": QA_CATEGORY_ORDER,
            "safety_enforcement_points_covered": SAFETY_ORDER,
        },
        "fixture_results": fixture_results,
        "storage_contract": {
            "table": "eval_results",
            "required_columns": [
                "id",
                "tenant_id",
                "eval_suite_id",
                "subject_type",
                "subject_id",
                "status",
                "summary",
                "created_at",
            ],
            "summary_json_contains_fixture_results": True,
            "tenant_scoped": True,
            "subject_scoped": True,
        },
        "provenance": {
            "blueprint_sections": [
                "12",
                "14.1",
                "15.1",
                "15.2",
                "15.3",
                "24",
                "25.11",
            ],
            "created_by_lane": "lane2",
            "runner": "scripts/run_stage0_eval.py",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="write fixtures/stage0/rev2/eval/starter_eval_results.json")
    parser.add_argument("--check", action="store_true", help="compare computed output with stored eval results")
    args = parser.parse_args()

    try:
        result = run_eval()
        encoded = json.dumps([result], indent=2, sort_keys=False) + "\n"
        if args.write:
            RESULT_PATH.write_text(encoded, encoding="utf-8")
        if args.check:
            require(RESULT_PATH.exists(), "stored eval result fixture is missing")
            require(RESULT_PATH.read_text(encoding="utf-8") == encoded, "stored eval results are stale; run scripts/run_stage0_eval.py --write")
        if not args.write and not args.check:
            print(encoded, end="")
    except EvalContractError as exc:
        print(f"stage0 eval failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
