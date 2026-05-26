#!/usr/bin/env python3
"""Validate Stage 0 Rev2 fixture/provenance/release-gate basics."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
SCHEMA_DIR = ROOT / "schemas" / "stage0" / "rev2"
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"

WORKFLOWS = {
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
}

EVAL_CATEGORIES = {
    "golden",
    "ambiguous_brief",
    "unsafe",
    "negative",
    "brand_product_preservation",
    "text_heavy",
    "export_completeness",
    "red_team",
}

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

CRAWLER_CASES = {
    "approved_source",
    "disallowed_source",
    "robots_denied",
    "duplicate_hash",
    "pending_review_import",
}

CHECKED_ITEMS = {
    "定义 eval suite schema。",
    "创建四条 workflow golden fixtures。",
    "创建 ambiguous/unsafe/negative fixtures。",
    "创建 brand/product preservation fixtures。",
    "创建 text-heavy fixtures。",
    "创建 export completeness fixtures。",
    "定义 QA result schema。",
    "实现 safety rule schema。",
    "实现 red-team fixtures。",
    "定义 vertical acceptance schema。",
    "每条 workflow 定义 required inputs。",
    "每条 workflow 定义 clarification questions。",
    "每条 workflow 定义 4-option taxonomy。",
    "每条 workflow 定义 required package outputs。",
    "每条 workflow 定义 QA/safety/export pass thresholds。",
    "实现 source legal metadata。",
    "添加 disallowed source、robots denied、duplicate hash、pending-review import tests。",
    "实现 feedback taxonomy。",
    "实现 feedback attribution。",
    "实现 abuse event model。",
}

FORBIDDEN_CHECKED_ITEMS = {
    "实现 eval runner。",
    "存储 eval results。",
    "skill canary 前要求 eval pass。",
    "prompt fragment active 前要求 eval pass。",
    "在 brief/provider request/provider response/QA/export 运行 safety policy。",
    "实现 crawler source approval。",
    "实现 provenance links。",
    "实现 temporary hold/throttle hooks。",
    "实现 admin abuse queue。",
}


class ValidationError(Exception):
    pass


def fail(message: str) -> None:
    raise ValidationError(message)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"{path.relative_to(ROOT)} is not valid JSON: {exc}")


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else [value]


def walk_values(value: Any) -> list[Any]:
    values = [value]
    if isinstance(value, dict):
        for child in value.values():
            values.extend(walk_values(child))
    elif isinstance(value, list):
        for child in value:
            values.extend(walk_values(child))
    return values


def validate_json_files() -> None:
    required = [
        SCHEMA_DIR / "eval_suite.schema.json",
        SCHEMA_DIR / "qa_result.schema.json",
        SCHEMA_DIR / "safety_rule.schema.json",
        SCHEMA_DIR / "workflow_acceptance.schema.json",
        SCHEMA_DIR / "crawler_governance.schema.json",
        SCHEMA_DIR / "feedback_event.schema.json",
        SCHEMA_DIR / "abuse_event.schema.json",
        SCHEMA_DIR / "release_gate_evidence.schema.json",
        FIXTURE_DIR / "eval" / "starter_eval_suite.json",
        FIXTURE_DIR / "eval" / "qa_results.json",
        FIXTURE_DIR / "eval" / "safety_rules.json",
        FIXTURE_DIR / "crawler" / "crawler_governance_cases.json",
        FIXTURE_DIR / "feedback" / "feedback_events.json",
        FIXTURE_DIR / "abuse" / "abuse_events.json",
        FIXTURE_DIR / "release_gate_evidence.local_alpha.json",
    ]
    for path in required:
        require(path.exists(), f"missing required file: {path.relative_to(ROOT)}")

    for path in sorted(SCHEMA_DIR.glob("*.json")) + sorted(FIXTURE_DIR.rglob("*.json")):
        load_json(path)


def validate_provenance() -> None:
    for path in sorted(FIXTURE_DIR.rglob("*.json")):
        data = load_json(path)
        for value in walk_values(data):
            if isinstance(value, dict) and "created_by_lane" in value:
                require(
                    value["created_by_lane"] == "lane6",
                    f"{path.relative_to(ROOT)} has non-lane6 provenance",
                )
                require(
                    value.get("blueprint_sections"),
                    f"{path.relative_to(ROOT)} provenance lacks blueprint_sections",
                )


def validate_workflows() -> None:
    workflow_files = sorted((FIXTURE_DIR / "workflows").glob("*.json"))
    workflow_ids = set()
    for path in workflow_files:
        data = load_json(path)
        workflow_ids.add(data["workflow_id"])
        require(
            len(data["four_option_taxonomy"]) == 4,
            f"{path.relative_to(ROOT)} must define exactly four taxonomy options",
        )
        require(
            set(data["pass_thresholds"]["safety"]["required_enforcement_points"]) == SAFETY_POINTS,
            f"{path.relative_to(ROOT)} must require all safety enforcement points",
        )
        export = data["pass_thresholds"]["export"]
        for key in [
            "requires_manifest",
            "requires_assets",
            "requires_qa_report",
            "requires_metadata",
            "requires_safety_disclaimer_when_applicable",
            "requires_trace_provenance",
        ]:
            require(export.get(key) is True, f"{path.relative_to(ROOT)} export threshold {key} must be true")
    require(workflow_ids == WORKFLOWS, f"workflow fixtures mismatch: {sorted(workflow_ids)}")


def validate_eval_suite() -> None:
    data = load_json(FIXTURE_DIR / "eval" / "starter_eval_suite.json")
    require(data["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval suite must cite authoritative blueprint")
    categories = {fixture["category"] for fixture in data["fixtures"]}
    require(EVAL_CATEGORIES <= categories, f"eval suite missing categories: {sorted(EVAL_CATEGORIES - categories)}")
    golden_workflows = {
        fixture["workflow"]
        for fixture in data["fixtures"]
        if fixture["category"] == "golden"
    }
    require(golden_workflows == WORKFLOWS, "eval suite must include one golden fixture per workflow")
    for fixture in data["fixtures"]:
        require(fixture["workflow"] in WORKFLOWS, f"unknown workflow in {fixture['fixture_id']}")
        evidence = fixture["expected_evidence"]
        if fixture["category"] == "golden":
            require(evidence["minimum_candidates"] == 4, f"{fixture['fixture_id']} must expect four candidates")
            require(evidence["must_include_manifest"], f"{fixture['fixture_id']} must require manifest")
            require(evidence["must_include_qa_report"], f"{fixture['fixture_id']} must require QA report")
            require(evidence["must_include_trace_provenance"], f"{fixture['fixture_id']} must require trace provenance")


def validate_qa_and_safety() -> None:
    qa_results = load_json(FIXTURE_DIR / "eval" / "qa_results.json")
    severities = {item["severity"] for item in qa_results}
    require({"warning", "blocking"} <= severities, "QA fixtures must include warning and blocking examples")

    rules = load_json(FIXTURE_DIR / "eval" / "safety_rules.json")
    domains = {item["domain"] for item in rules}
    require({"financial", "adult_minor", "ip_brand"} <= domains, "safety fixtures lack required high-risk domains")
    for rule in rules:
        require(
            set(rule["enforcement_points"]) == SAFETY_POINTS,
            f"{rule['rule_id']} must cover all enforcement points",
        )
        if rule["severity"] == "critical":
            require(rule["action"] == "block", f"{rule['rule_id']} critical rules must block")


def validate_crawler_feedback_abuse() -> None:
    crawler = load_json(FIXTURE_DIR / "crawler" / "crawler_governance_cases.json")
    cases = {item["case_type"] for item in crawler}
    require(CRAWLER_CASES <= cases, f"crawler fixtures missing cases: {sorted(CRAWLER_CASES - cases)}")
    for case in crawler:
        require(
            case["import_governance"]["direct_activation_allowed"] is False,
            f"{case['fixture_id']} must deny direct activation",
        )
        require(
            case["import_governance"]["provenance_links_required"] is True,
            f"{case['fixture_id']} must require provenance links",
        )

    feedback = load_json(FIXTURE_DIR / "feedback" / "feedback_events.json")
    require(
        {"select", "reject", "qa_warning"} <= {item["event_type"] for item in feedback},
        "feedback fixtures must cover select, reject, and QA warning",
    )
    for event in feedback:
        require(
            event["governance"]["may_activate_prompt_or_skill_directly"] is False,
            f"{event['event_id']} must not allow direct activation",
        )

    abuse = load_json(FIXTURE_DIR / "abuse" / "abuse_events.json")
    require(
        {"repeated_safety_blocks", "prompt_injection", "crawler_abuse"} <= {item["event_type"] for item in abuse},
        "abuse fixtures missing required event types",
    )
    for event in abuse:
        controls = event["controls"]
        require(
            controls["rate_limit"] or controls["temporary_hold"] or controls["admin_abuse_queue"],
            f"{event['event_id']} must have at least one control",
        )


def validate_release_gate_evidence() -> None:
    data = load_json(FIXTURE_DIR / "release_gate_evidence.local_alpha.json")
    require(data["gate"] == "local_alpha", "release gate fixture must target local alpha")
    check_ids = {check["check_id"] for check in data["checks"]}
    require(
        {"workflow_fixture_coverage", "eval_fixture_coverage", "crawler_governance_fixture_coverage"} <= check_ids,
        "local alpha evidence missing fixture coverage checks",
    )
    do_not_launch = {item["condition_id"]: item["is_present"] for item in data["do_not_launch_checks"]}
    require(
        do_not_launch.get("generic_workflow_only") is False,
        "release evidence must guard against generic workflow-only completion",
    )
    require(
        do_not_launch.get("missing_export_provenance_fixture") is False,
        "release evidence must guard against missing export provenance fixtures",
    )


def validate_blueprint_checklist() -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked_lines = {
        match.group(1)
        for match in re.finditer(r"^- \[x\] (.+)$", text, flags=re.MULTILINE)
    }
    missing = CHECKED_ITEMS - checked_lines
    require(not missing, f"blueprint missing completed fixture/schema checklist marks: {sorted(missing)}")

    forbidden = FORBIDDEN_CHECKED_ITEMS & checked_lines
    require(
        not forbidden,
        f"blueprint marks implementation items complete from lane6 fixture work: {sorted(forbidden)}",
    )


def main() -> int:
    checks = [
        validate_json_files,
        validate_provenance,
        validate_workflows,
        validate_eval_suite,
        validate_qa_and_safety,
        validate_crawler_feedback_abuse,
        validate_release_gate_evidence,
        validate_blueprint_checklist,
    ]
    try:
        for check in checks:
            check()
    except ValidationError as exc:
        print(f"stage0 rev2 validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage0 rev2 validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
