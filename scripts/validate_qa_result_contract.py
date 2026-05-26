#!/usr/bin/env python3
"""Validate the Stage 0 Rev2 QA result fixture contract."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
QA_RESULTS = FIXTURE_DIR / "eval" / "qa_results.json"
EVAL_SUITE = FIXTURE_DIR / "eval" / "starter_eval_suite.json"
EVAL_RESULTS = FIXTURE_DIR / "eval" / "starter_eval_results.json"
WORKFLOW_DIR = FIXTURE_DIR / "workflows"

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

QA_CATEGORIES = set(QA_CATEGORY_ORDER)

CHECKLIST_CATEGORY_GROUPS = {
    "file integrity/dimensions/aspect/safe-area QA": {
        "file_integrity",
        "dimensions",
        "aspect_ratio",
        "safe_area",
    },
    "blank/duplicate/four-option distinctness QA": {
        "blank_output",
        "duplicate_similarity",
        "four_option_distinctness",
    },
    "text readability or manual-review placeholder QA": {
        "text_readability",
    },
    "structured text QA": {
        "structured_text",
    },
    "product/logo preservation QA": {
        "product_logo_preservation",
    },
    "forbidden claims QA": {
        "forbidden_claims",
    },
    "export completeness QA": {
        "export_completeness",
    },
}

CATEGORY_CONTRACTS: dict[str, dict[str, Any]] = {
    "file_integrity": {
        "observed": {"mime_type", "checksum_sha256", "decoder_status", "byte_size"},
        "expected": {"mime_type", "checksum_sha256", "decoder_status", "byte_size_min"},
        "blocking": True,
        "review_required": True,
        "must_block_export": True,
    },
    "dimensions": {
        "observed": {"width_px", "height_px", "export_target"},
        "expected": {"width_px", "height_px", "export_target"},
        "blocking": True,
        "auto_fix_available": True,
        "must_block_export": True,
    },
    "aspect_ratio": {
        "observed": {"aspect_ratio", "export_target"},
        "expected": {"aspect_ratio", "export_target"},
        "auto_fix_available": True,
    },
    "safe_area": {
        "observed": {"cta_bottom_margin_px", "safe_area_bottom_min_px", "overlaps_platform_ui"},
        "expected": {"cta_bottom_margin_px_min", "overlaps_platform_ui"},
        "auto_fix_available": True,
    },
    "blank_output": {
        "observed": {"near_blank", "non_background_pixel_ratio", "detected_subjects"},
        "expected": {"near_blank", "non_background_pixel_ratio_min", "detected_subjects_min"},
        "blocking": True,
        "auto_fix_available": True,
        "must_block_export": True,
    },
    "duplicate_similarity": {
        "observed": {"duplicate_similarity", "candidate_pair"},
        "expected": {"duplicate_similarity_below", "candidate_pair_must_differ"},
        "blocking": True,
        "review_required": True,
        "must_block_export": True,
    },
    "four_option_distinctness": {
        "observed": {"strategic_options", "taxonomy_coverage"},
        "expected": {"strategic_options", "taxonomy_coverage"},
        "blocking": True,
        "review_required": True,
        "must_block_export": True,
    },
    "text_readability": {
        "observed": {"ocr_confidence", "min_font_px", "manual_review_placeholder"},
        "expected": {"ocr_confidence_min", "min_font_px", "manual_review_placeholder_allowed"},
        "review_required": True,
        "must_have_manual_review_placeholder": True,
    },
    "structured_text": {
        "observed": {"price", "date", "phone", "address", "qr_placeholder"},
        "expected": {"price", "date", "phone", "address", "qr_placeholder"},
        "auto_fix_available": True,
    },
    "product_logo_preservation": {
        "observed": {"logo_similarity", "product_shape_similarity", "unauthorized_color_change"},
        "expected": {"logo_similarity_min", "product_shape_similarity_min", "unauthorized_color_change"},
        "blocking": True,
        "review_required": True,
        "must_block_export": True,
    },
    "forbidden_claims": {
        "observed": {"claim_text", "claim_source", "source_citation_present"},
        "expected": {"claim_text_allowed", "requires_source_citation", "expected_safety_action"},
        "blocking": True,
        "review_required": True,
        "must_block_export": True,
        "must_have_safety_block": True,
    },
    "watermark_signature_risk": {
        "observed": {"watermark_probability", "signature_like_text_detected", "review_region"},
        "expected": {"watermark_probability_below", "signature_like_text_detected"},
        "review_required": True,
    },
    "export_completeness": {
        "observed": {
            "manifest_json",
            "qa_report_json",
            "metadata_json",
            "safety_disclaimer_when_applicable",
            "trace_provenance_json",
            "deterministic_file_names",
        },
        "expected": {
            "manifest_json",
            "qa_report_json",
            "metadata_json",
            "safety_disclaimer_when_applicable",
            "trace_provenance_json",
            "deterministic_file_names",
        },
        "blocking": True,
        "review_required": True,
        "must_block_export": True,
    },
}

class QAContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise QAContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise QAContractError(message)


def require_keys(container: dict[str, Any], keys: set[str], label: str) -> None:
    missing = keys - set(container)
    require(not missing, f"{label} missing keys: {sorted(missing)}")


def validate_category_item(item: dict[str, Any]) -> None:
    category = item["check_category"]
    contract = CATEGORY_CONTRACTS[category]
    observed = item["evidence"]["observed"]
    expected = item["evidence"]["expected"]
    label = item["check_id"]

    require_keys(observed, contract["observed"], f"{label} observed evidence")
    require_keys(expected, contract["expected"], f"{label} expected evidence")

    if contract.get("blocking"):
        require(item["severity"] == "blocking", f"{label} must be blocking")
    if contract.get("must_block_export"):
        require(
            item["export_gate"]["blocks_final_export"] is True,
            f"{label} must block final export",
        )
    if contract.get("auto_fix_available"):
        require(item["auto_fix_available"] is True, f"{label} must expose auto-fix availability")
    if contract.get("review_required"):
        require(item["review_required"] is True, f"{label} must require review")
    if contract.get("must_have_manual_review_placeholder"):
        require(
            observed["manual_review_placeholder"] is True
            and expected["manual_review_placeholder_allowed"] is True,
            f"{label} must use an explicit manual-review placeholder",
        )
    if contract.get("must_have_safety_block"):
        require(
            expected["expected_safety_action"] == "block",
            f"{label} must expect a safety block",
        )
    require(
        item["export_gate"]["override_requires_audit"] is True,
        f"{label} admin override path must require audit",
    )
    require(item["user_visible_message"], f"{label} must include user-visible message")
    require(item["admin_reason"], f"{label} must include admin reason")
    require(
        item["evidence"]["trace_id"].startswith("trace_"),
        f"{label} trace_id must be trace-scoped",
    )
    require(
        item["evidence"]["source_artifacts"],
        f"{label} must cite source artifacts",
    )


def validate_fixture_links(qa_results: list[dict[str, Any]]) -> None:
    suite = load_json(EVAL_SUITE)
    results = load_json(EVAL_RESULTS)
    workflows = {
        workflow["workflow_id"]: workflow
        for workflow in (load_json(path) for path in sorted(WORKFLOW_DIR.glob("*.json")))
    }
    workflow_ids = set(workflows)
    fixture_ids = {fixture["fixture_id"] for fixture in suite["fixtures"]}
    suite_workflows = {fixture["workflow"] for fixture in suite["fixtures"]}
    require(workflow_ids == suite_workflows, "workflow acceptance fixtures must match eval suite workflows")

    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result_by_fixture = {item["fixture_id"]: item for item in results[0]["fixture_results"]}
    summary_categories = set(results[0]["summary"]["qa_categories_covered"])
    required_categories = {
        category
        for workflow in workflows.values()
        for category in workflow["required_qa_checks"]
    }

    require(
        required_categories == QA_CATEGORIES,
        f"workflow acceptance required_qa_checks must cover every QA category exactly: {sorted(required_categories ^ QA_CATEGORIES)}",
    )
    require(summary_categories == required_categories, "eval result summary must match workflow required QA categories")
    for item in qa_results:
        fixture_id = item["evidence"]["fixture_id"]
        require(item["workflow"] in workflow_ids, f"{item['check_id']} references unknown workflow")
        require(
            item["check_category"] in workflows[item["workflow"]]["required_qa_checks"],
            f"{item['check_id']} category is not declared in {item['workflow']} required_qa_checks",
        )
        require(fixture_id in fixture_ids, f"{item['check_id']} references unknown eval fixture {fixture_id}")
        require(fixture_id in result_by_fixture, f"{item['check_id']} fixture missing eval result")
        require(
            result_by_fixture[fixture_id]["workflow"] == item["workflow"],
            f"{item['check_id']} workflow must match its eval result fixture",
        )
        require(
            item["check_id"] in result_by_fixture[fixture_id]["qa_check_ids"],
            f"{item['check_id']} missing from eval result fixture qa_check_ids",
        )
        require(
            result_by_fixture[fixture_id]["trace_contract"]["trace_id"].startswith("trace_"),
            f"{item['check_id']} eval result trace contract must be trace-scoped",
        )


def validate_workflow_coverage(qa_results: list[dict[str, Any]]) -> None:
    workflows = {
        workflow["workflow_id"]: workflow
        for workflow in (load_json(path) for path in sorted(WORKFLOW_DIR.glob("*.json")))
    }
    categories_by_workflow: dict[str, set[str]] = {}
    for item in qa_results:
        categories_by_workflow.setdefault(item["workflow"], set()).add(item["check_category"])

    for workflow, contract in workflows.items():
        required_categories = set(contract["required_qa_checks"])
        observed = categories_by_workflow.get(workflow, set())
        missing = required_categories - observed
        require(not missing, f"{workflow} missing QA categories: {sorted(missing)}")
        unexpected = observed - required_categories
        require(not unexpected, f"{workflow} has QA categories not declared in required_qa_checks: {sorted(unexpected)}")


def validate_qa_contract() -> None:
    qa_results = load_json(QA_RESULTS)
    require(isinstance(qa_results, list), "QA result fixture must be an array")
    require(qa_results, "QA result fixture must not be empty")

    check_ids = [item["check_id"] for item in qa_results]
    require(len(check_ids) == len(set(check_ids)), "QA result check_id values must be unique")

    categories = {item["check_category"] for item in qa_results}
    require(categories == QA_CATEGORIES, f"QA categories mismatch: {sorted(categories ^ QA_CATEGORIES)}")
    for group_name, group_categories in CHECKLIST_CATEGORY_GROUPS.items():
        missing = group_categories - categories
        require(not missing, f"{group_name} checklist group missing categories: {sorted(missing)}")

    for item in qa_results:
        validate_category_item(item)
    validate_fixture_links(qa_results)
    validate_workflow_coverage(qa_results)


def main() -> int:
    try:
        validate_qa_contract()
    except QAContractError as exc:
        print(f"QA result contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("QA result contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
