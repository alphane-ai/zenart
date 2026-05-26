#!/usr/bin/env python3
"""Validate Stage 0 Rev2 vertical workflow acceptance fixture contracts."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
WORKFLOW_DIR = FIXTURE_DIR / "workflows"
EVAL_SUITE = FIXTURE_DIR / "eval" / "starter_eval_suite.json"
EVAL_RESULTS = FIXTURE_DIR / "eval" / "starter_eval_results.json"
QA_RESULTS = FIXTURE_DIR / "eval" / "qa_results.json"
SAFETY_RULES = FIXTURE_DIR / "eval" / "safety_rules.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"

WORKFLOWS = {
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
}

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

REQUIRED_EXPORT_FILES = {
    "manifest.json",
    "metadata.json",
    "qa_report.json",
    "trace_provenance.json",
}

RUNTIME_OPERATION_IDS = {
    "createChatSession",
    "createChatMessage",
    "createCandidateSet",
    "listCandidateAssets",
    "selectDirection",
    "createPackage",
    "createExport",
    "getExport",
}

WORKFLOW_CHECKLIST_ITEMS = {
    "ecommerce_growth_pack": {
        "fixture": "实现电商增长包 acceptance fixture。",
        "api": "电商增长包 API smoke test 通过。",
        "playwright": "电商增长包 Playwright happy path 通过。",
    },
    "business_visual_doc_pack": {
        "fixture": "实现商业视觉文档包 acceptance fixture。",
        "api": "商业视觉文档包 API smoke test 通过。",
        "playwright": "商业视觉文档包 Playwright happy path 通过。",
    },
    "local_merchant_campaign_pack": {
        "fixture": "实现本地商家活动包 acceptance fixture。",
        "api": "本地商家活动包 API smoke test 通过。",
        "playwright": "本地商家活动包 Playwright happy path 通过。",
    },
    "character_ip_concept_pack": {
        "fixture": "实现角色/IP 概念包 acceptance fixture。",
        "api": "角色/IP 概念包 API smoke test 通过。",
        "playwright": "角色/IP 概念包 Playwright happy path 通过。",
    },
}


class WorkflowAcceptanceContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowAcceptanceContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise WorkflowAcceptanceContractError(message)


def checked_items(text: str) -> set[str]:
    return {
        match.group(1)
        for match in re.finditer(r"^- \[x\] (.+)$", text, flags=re.MULTILINE)
    }


def unchecked_items(text: str) -> set[str]:
    return {
        match.group(1)
        for match in re.finditer(r"^- \[ \] (.+)$", text, flags=re.MULTILINE)
    }


def validate_blueprint_split(workflows: dict[str, dict[str, Any]]) -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked = checked_items(text)
    unchecked = unchecked_items(text)

    for workflow_id in workflows:
        items = WORKFLOW_CHECKLIST_ITEMS[workflow_id]
        require(items["fixture"] in checked, f"{workflow_id} fixture checklist item must be checked")
        require(items["api"] in unchecked, f"{workflow_id} API smoke checklist item must remain open")
        require(items["playwright"] in unchecked, f"{workflow_id} Playwright checklist item must remain open")
        workflow = workflows[workflow_id]
        require(
            workflow["api_smoke_contract"]["blueprint_checklist_remains_open"] is True,
            f"{workflow_id} API smoke contract must keep runtime checklist open",
        )
        require(
            workflow["playwright_happy_path_contract"]["blueprint_checklist_remains_open"] is True,
            f"{workflow_id} Playwright contract must keep runtime checklist open",
        )


def validate_openapi_operations(workflows: dict[str, dict[str, Any]]) -> None:
    openapi = OPENAPI.read_text(encoding="utf-8")
    for operation_id in RUNTIME_OPERATION_IDS:
        require(f"operationId: {operation_id}" in openapi, f"OpenAPI missing workflow smoke operation {operation_id}")

    for workflow_id, workflow in workflows.items():
        operation_ids = set(workflow["api_smoke_contract"]["operation_ids"])
        missing = RUNTIME_OPERATION_IDS - operation_ids
        require(not missing, f"{workflow_id} API smoke contract missing operation IDs: {sorted(missing)}")
        for operation_id in operation_ids:
            require(f"operationId: {operation_id}" in openapi, f"{workflow_id} cites unknown operation {operation_id}")
        require(
            workflow["api_smoke_contract"]["execution_status"] == "not_executed",
            f"{workflow_id} API smoke contract must not claim runtime execution",
        )
        require(
            workflow["playwright_happy_path_contract"]["execution_status"] == "not_executed",
            f"{workflow_id} Playwright contract must not claim runtime execution",
        )


def validate_fixture_links(workflows: dict[str, dict[str, Any]]) -> None:
    suite = load_json(EVAL_SUITE)
    results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)
    safety_rules = load_json(SAFETY_RULES)

    require(suite["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval suite must cite Rev2 blueprint")
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")

    suite_by_id = {fixture["fixture_id"]: fixture for fixture in suite["fixtures"]}
    result_by_id = {item["fixture_id"]: item for item in results[0]["fixture_results"]}
    qa_by_workflow: dict[str, set[str]] = {}
    for item in qa_results:
        qa_by_workflow.setdefault(item["workflow"], set()).add(item["check_category"])

    safety_fixture_domains: dict[str, set[str]] = {}
    for rule in safety_rules:
        require(set(rule["enforcement_points"]) == SAFETY_POINTS, f"{rule['rule_id']} must cover every safety point")
        for fixture_id in rule["eval_fixture_links"]:
            safety_fixture_domains.setdefault(fixture_id, set()).add(rule["domain"])

    for workflow_id, workflow in workflows.items():
        golden = workflow["golden_fixture"]
        golden_id = golden["fixture_id"]
        require(golden_id in suite_by_id, f"{workflow_id} golden fixture missing from eval suite")
        require(golden_id in result_by_id, f"{workflow_id} golden fixture missing from eval results")
        require(suite_by_id[golden_id]["workflow"] == workflow_id, f"{workflow_id} golden fixture workflow mismatch")
        require(suite_by_id[golden_id]["category"] == "golden", f"{workflow_id} golden fixture must be category golden")
        require(result_by_id[golden_id]["candidate_count"] == 4, f"{workflow_id} golden eval must cover four candidates")
        require(result_by_id[golden_id]["export_contract"]["qa_report"] is True, f"{workflow_id} golden eval must include QA report")
        require(
            result_by_id[golden_id]["export_contract"]["trace_provenance"] is True,
            f"{workflow_id} golden eval must include trace provenance",
        )

        qa_missing = set(workflow["required_qa_checks"]) - qa_by_workflow.get(workflow_id, set())
        require(not qa_missing, f"{workflow_id} missing linked QA fixture categories: {sorted(qa_missing)}")

        safety = workflow["required_safety_checks"]
        require(set(safety["enforcement_points"]) == SAFETY_POINTS, f"{workflow_id} must require every safety point")
        linked_domains = set().union(
            *(safety_fixture_domains.get(fixture_id, set()) for fixture_id in safety["linked_eval_fixtures"])
        )
        missing_domains = set(safety["linked_rule_domains"]) - linked_domains
        require(not missing_domains, f"{workflow_id} safety domains lack rule links: {sorted(missing_domains)}")

        for link in workflow["negative_fixture_links"]:
            fixture_id = link["fixture_id"]
            require(fixture_id in suite_by_id, f"{workflow_id} links unknown negative fixture {fixture_id}")
            require(fixture_id in result_by_id, f"{workflow_id} negative fixture {fixture_id} missing eval result")
            require(suite_by_id[fixture_id]["category"] == link["category"], f"{fixture_id} category mismatch")
            require(result_by_id[fixture_id]["status"] == link["expected_status"], f"{fixture_id} expected status mismatch")


def validate_workflow_shape(workflows: dict[str, dict[str, Any]]) -> None:
    for workflow_id, workflow in workflows.items():
        taxonomy = set(workflow["four_option_taxonomy"])
        assets = workflow["required_generated_assets"]
        asset_taxonomy = {asset["strategy_taxonomy"] for asset in assets}
        require(len(assets) == 4, f"{workflow_id} must define exactly four generated assets")
        require(asset_taxonomy == taxonomy, f"{workflow_id} generated assets must map one-to-one to taxonomy")

        output_files = set(workflow["required_package_outputs"])
        asset_files = {asset["file_name"] for asset in assets}
        missing_outputs = asset_files - output_files
        require(not missing_outputs, f"{workflow_id} generated assets missing from package outputs: {sorted(missing_outputs)}")

        for target in workflow["export_targets"]:
            files = set(target["required_files"])
            require(REQUIRED_EXPORT_FILES <= files, f"{workflow_id} export target {target['target_id']} missing contract files")
            expected_asset_paths = {f"assets/{file_name}" for file_name in asset_files}
            missing_asset_paths = expected_asset_paths - files
            require(
                not missing_asset_paths,
                f"{workflow_id} export target {target['target_id']} missing assets: {sorted(missing_asset_paths)}",
            )

        golden_files = set(workflow["golden_fixture"]["expected_export_files"])
        require(
            {"manifest.json", "qa_report.json", "trace_provenance.json"} <= golden_files,
            f"{workflow_id} golden fixture missing required export evidence files",
        )
        require(
            set(workflow["pass_thresholds"]["safety"]["required_enforcement_points"]) == SAFETY_POINTS,
            f"{workflow_id} pass threshold must require every safety point",
        )
        export = workflow["pass_thresholds"]["export"]
        for key in [
            "requires_manifest",
            "requires_assets",
            "requires_qa_report",
            "requires_metadata",
            "requires_safety_disclaimer_when_applicable",
            "requires_trace_provenance",
        ]:
            require(export[key] is True, f"{workflow_id} export threshold {key} must be true")


def validate_workflow_acceptance_contract() -> None:
    workflows = {
        path.stem: load_json(path)
        for path in sorted(WORKFLOW_DIR.glob("*.json"))
    }
    require(set(workflows) == WORKFLOWS, f"workflow fixture set mismatch: {sorted(set(workflows) ^ WORKFLOWS)}")
    for workflow_id, workflow in workflows.items():
        require(workflow["workflow_id"] == workflow_id, f"{workflow_id} fixture workflow_id mismatch")
        require(workflow["schema_version"] == "stage0.rev2", f"{workflow_id} schema version mismatch")

    validate_workflow_shape(workflows)
    validate_fixture_links(workflows)
    validate_openapi_operations(workflows)
    validate_blueprint_split(workflows)


def main() -> int:
    try:
        validate_workflow_acceptance_contract()
    except WorkflowAcceptanceContractError as exc:
        print(f"workflow acceptance contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("workflow acceptance contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
