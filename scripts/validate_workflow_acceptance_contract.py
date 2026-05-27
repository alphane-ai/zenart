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
TRACE_COMPLETENESS = FIXTURE_DIR / "eval" / "trace_completeness.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
LOCAL_ALPHA_EVIDENCE_DIR = ROOT / "ops" / "evidence" / "local_alpha"

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

TRACE_FIELDS = {
    "schema_validation",
    "provenance",
    "safety_status",
    "qa_eval_status",
    "quota_transaction_id",
    "admin_visibility",
    "user_failure_mapping",
}

TRACE_RESULT_KEYS = {
    "has_schema_validation": "schema_validation",
    "has_provenance": "provenance",
    "has_safety_status": "safety_status",
    "has_qa_eval_status": "qa_eval_status",
    "has_quota_transaction": "quota_transaction_id",
    "has_admin_visibility": "admin_visibility",
    "has_user_failure_mapping": "user_failure_mapping",
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

RUNTIME_OPERATION_ORDER = [
    "createChatSession",
    "createChatMessage",
    "createCandidateSet",
    "listCandidateAssets",
    "selectDirection",
    "createPackage",
    "createExport",
    "getExport",
]

PLAYWRIGHT_REQUIRED_ACTIONS = [
    "create_project",
    "fill_brief",
    "generate_candidates",
    "review_four_candidates",
    "select_candidate",
    "iterate_selection",
    "add_to_package",
    "preview_export",
    "download_export",
]

PATH_PARAM_COMPONENTS = {
    "project_id": "ProjectId",
    "chat_session_id": "ChatSessionId",
    "candidate_set_id": "CandidateSetId",
    "package_id": "PackageId",
    "export_id": "ExportId",
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

WORKFLOW_RUNTIME_CLOSED_ITEMS = {
    "ecommerce_growth_pack": {
        "api",
        "playwright",
    },
}

WORKFLOW_RUNTIME_EVIDENCE_KIND = {
    "api": "api_smoke",
    "playwright": "playwright_happy_path",
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


def schema_exists(openapi: str, schema_name: str) -> bool:
    if schema_name == "none":
        return True
    return re.search(rf"^    {re.escape(schema_name)}:\n", openapi, flags=re.MULTILINE) is not None


def openapi_operations(openapi: str) -> dict[str, dict[str, str]]:
    operations: dict[str, dict[str, str]] = {}
    current_path = ""
    current_method = ""
    current_block: list[str] = []

    def flush() -> None:
        if not current_path or not current_method or not current_block:
            return
        block = "".join(current_block)
        match = re.search(r"^\s+operationId:\s+([A-Za-z0-9_]+)\s*$", block, flags=re.MULTILINE)
        if match:
            operations[match.group(1)] = {
                "path_template": current_path,
                "method": current_method,
                "block": block,
            }

    for line in openapi.splitlines(keepends=True):
        if re.match(r"^  /.+:\n$", line):
            flush()
            current_path = line.strip()[:-1]
            current_method = ""
            current_block = []
            continue
        method_match = re.match(r"^    (get|post|put|patch|delete):\n$", line)
        if method_match:
            flush()
            current_method = method_match.group(1)
            current_block = [line]
            continue
        if current_method:
            if re.match(r"^    [a-zA-Z0-9_-]+:\n$", line):
                flush()
                current_method = ""
                current_block = []
            else:
                current_block.append(line)

    flush()
    return operations


def schema_ref(schema_name: str) -> str:
    return f'$ref: "#/components/schemas/{schema_name}"'


def runtime_evidence_file(workflow_id: str, item_key: str) -> Path:
    evidence_kind = WORKFLOW_RUNTIME_EVIDENCE_KIND[item_key]
    return LOCAL_ALPHA_EVIDENCE_DIR / f"{workflow_id}.{evidence_kind}.json"


def validate_closed_runtime_evidence(workflow_id: str, item_key: str) -> None:
    evidence_kind = WORKFLOW_RUNTIME_EVIDENCE_KIND[item_key]
    evidence_path = runtime_evidence_file(workflow_id, item_key)
    require(evidence_path.is_file(), f"{workflow_id} {item_key} runtime evidence file missing: {evidence_path.relative_to(ROOT)}")
    evidence = load_json(evidence_path)
    require(
        evidence.get("schema_version") == "stage0.rev2.local-alpha-runtime-evidence",
        f"{workflow_id} {item_key} runtime evidence schema mismatch",
    )
    require(evidence.get("environment") == "local_alpha", f"{workflow_id} {item_key} must be local_alpha evidence")
    require(evidence.get("workflow_id") == workflow_id, f"{workflow_id} {item_key} evidence workflow mismatch")
    require(evidence.get("evidence_kind") == evidence_kind, f"{workflow_id} {item_key} evidence kind mismatch")
    require(evidence.get("status") == "pass", f"{workflow_id} {item_key} evidence must pass")
    require(
        evidence.get("release_gate_check_id") == "local_alpha_e2e_workflow_smoke",
        f"{workflow_id} {item_key} evidence must target Local Alpha workflow smoke gate",
    )
    require(evidence.get("proves_running_local_stack") is True, f"{workflow_id} {item_key} must prove running local stack")


def validate_api_smoke_sequence(workflow_id: str, workflow: dict[str, Any], openapi: str, operations: dict[str, dict[str, str]]) -> None:
    contract = workflow["api_smoke_contract"]
    sequence = contract["request_sequence"]
    operation_ids = [step["operation_id"] for step in sequence]
    require(operation_ids == RUNTIME_OPERATION_ORDER, f"{workflow_id} API smoke sequence order mismatch: {operation_ids}")
    require(set(contract["operation_ids"]) == set(operation_ids), f"{workflow_id} operation_ids must match request_sequence")
    require([step["step"] for step in sequence] == list(range(1, len(sequence) + 1)), f"{workflow_id} API smoke steps must be sequential")

    required_input_keys = {
        item["key"]
        for item in workflow["required_inputs"]
        if item["required"] is True
    }
    assertion_text = " ".join(
        assertion
        for step in sequence
        for assertion in step["body_assertions"]
    )
    missing_inputs = required_input_keys - {key for key in required_input_keys if key in assertion_text}
    require(not missing_inputs, f"{workflow_id} API smoke sequence does not assert required inputs: {sorted(missing_inputs)}")

    taxonomy_missing = set(workflow["four_option_taxonomy"]) - {
        option for option in workflow["four_option_taxonomy"] if option in assertion_text
    }
    require(not taxonomy_missing, f"{workflow_id} API smoke sequence does not assert taxonomy: {sorted(taxonomy_missing)}")

    required_asset_files = {asset["file_name"] for asset in workflow["required_generated_assets"]}
    asset_missing = required_asset_files - {file_name for file_name in required_asset_files if file_name in assertion_text}
    require(not asset_missing, f"{workflow_id} API smoke sequence does not assert package assets: {sorted(asset_missing)}")

    for step in sequence:
        operation_id = step["operation_id"]
        require(operation_id in operations, f"{workflow_id} sequence cites unknown OpenAPI operation {operation_id}")
        operation = operations[operation_id]
        block = operation["block"]

        require(step["method"] == operation["method"], f"{workflow_id} {operation_id} method mismatch")
        require(step["path_template"] == operation["path_template"], f"{workflow_id} {operation_id} path mismatch")
        require(f'        "{step["success_status"]}":' in block, f"{workflow_id} {operation_id} success status missing in OpenAPI")
        require(schema_exists(openapi, step["response_schema"]), f"{workflow_id} {operation_id} response schema does not exist")
        require(schema_ref(step["response_schema"]) in block, f"{workflow_id} {operation_id} response schema mismatch")

        path_params = set(re.findall(r"{([a-z0-9_]+)}", step["path_template"]))
        require(path_params == set(step["path_params"]), f"{workflow_id} {operation_id} path_params mismatch")
        for param in step["path_params"]:
            component = PATH_PARAM_COMPONENTS[param]
            require(f'$ref: "#/components/parameters/{component}"' in block, f"{workflow_id} {operation_id} missing path parameter {component}")

        if step["requires_idempotency_key"]:
            require("x-idempotency-required: true" in block, f"{workflow_id} {operation_id} must require idempotency")
            require('$ref: "#/components/parameters/IdempotencyKey"' in block, f"{workflow_id} {operation_id} missing IdempotencyKey parameter")
        else:
            require("x-idempotency-required: true" not in block, f"{workflow_id} {operation_id} must not require idempotency")

        request_schema = step["request_schema"]
        require(schema_exists(openapi, request_schema), f"{workflow_id} {operation_id} request schema does not exist")
        if request_schema == "none":
            require("requestBody:" not in block, f"{workflow_id} {operation_id} must not define a request body")
        else:
            require("requestBody:" in block, f"{workflow_id} {operation_id} must define a request body")
            require(schema_ref(request_schema) in block, f"{workflow_id} {operation_id} request schema mismatch")

        if operation_id == "createCandidateSet":
            require(
                f"workflow_id equals {workflow_id}" in step["body_assertions"],
                f"{workflow_id} createCandidateSet must assert exact workflow_id",
            )
        if operation_id == "getExport":
            for evidence_file in ["manifest", "metadata", "qa_report", "trace_provenance"]:
                require(
                    any(evidence_file in assertion for assertion in step["body_assertions"]),
                    f"{workflow_id} getExport must assert {evidence_file}",
                )


def validate_playwright_contract(workflow_id: str, workflow: dict[str, Any], operations: dict[str, dict[str, str]]) -> None:
    contract = workflow["playwright_happy_path_contract"]
    journey = contract["user_journey"]
    selectors = set(contract["required_selectors"])
    actions = [step["action"] for step in journey]

    require(contract["execution_status"] == "not_executed", f"{workflow_id} Playwright contract must not claim runtime execution")
    require(
        contract["blueprint_checklist_remains_open"] is True,
        f"{workflow_id} Playwright contract must keep runtime checklist open",
    )
    require(
        contract["start_route"] == f"/projects/new?workflow={workflow_id}",
        f"{workflow_id} Playwright start route must deep-link the workflow",
    )
    require(
        contract["completion_route"] == "/projects/{project_id}/exports/{export_id}",
        f"{workflow_id} Playwright completion route must target export detail",
    )
    require([step["step"] for step in journey] == list(range(1, len(journey) + 1)), f"{workflow_id} Playwright journey steps must be sequential")
    for required_action in PLAYWRIGHT_REQUIRED_ACTIONS:
        require(required_action in actions, f"{workflow_id} Playwright journey missing {required_action}")

    optional_input_actions = {
        "file": "upload_reference",
        "date": "confirm_structured_details",
    }
    required_input_keys = {item["key"] for item in workflow["required_inputs"] if item["required"] is True}
    assertion_text = " ".join(
        assertion
        for step in journey
        for assertion in step["assertions"]
    )
    missing_inputs = required_input_keys - {key for key in required_input_keys if key in assertion_text}
    require(not missing_inputs, f"{workflow_id} Playwright journey does not assert required inputs: {sorted(missing_inputs)}")

    for item in workflow["required_inputs"]:
        expected_selector = f'[data-testid="brief-{item["key"]}"]'
        if item["type"] == "file":
            expected_selector = f'[data-testid="reference-upload-{item["key"]}"]'
        require(expected_selector in selectors, f"{workflow_id} Playwright selectors missing input selector {expected_selector}")
        if item["required"] and item["type"] in optional_input_actions:
            require(optional_input_actions[item["type"]] in actions, f"{workflow_id} Playwright journey missing {optional_input_actions[item['type']]}")

    workflow_selector = f'[data-testid="workflow-{workflow_id}"]'
    require(workflow_selector in selectors, f"{workflow_id} Playwright selectors missing {workflow_selector}")
    for selector in [
        '[data-testid="project-create"]',
        '[data-testid="generate-candidates"]',
        '[data-testid="candidate-grid"]',
        '[data-testid="candidate-select"]',
        '[data-testid="iterate-selected-direction"]',
        '[data-testid="package-add-selected"]',
        '[data-testid="export-preview"]',
        '[data-testid="export-download"]',
    ]:
        require(selector in selectors, f"{workflow_id} Playwright selectors missing {selector}")
    for step in journey:
        require(step["selector"] in selectors, f"{workflow_id} Playwright journey selector not declared: {step['selector']}")
        require(step["route"].startswith("/projects/"), f"{workflow_id} Playwright journey route must stay inside project workspace")

    taxonomy_text = " ".join(workflow["four_option_taxonomy"])
    for option in workflow["four_option_taxonomy"]:
        require(option in assertion_text or option in selectors or option in taxonomy_text, f"{workflow_id} Playwright journey missing taxonomy option {option}")
    review_steps = [step for step in journey if step["action"] == "review_four_candidates"]
    require(review_steps, f"{workflow_id} Playwright journey must review four candidates")
    require(
        any("exactly four" in assertion for step in review_steps for assertion in step["assertions"]),
        f"{workflow_id} Playwright candidate review must assert exactly four cards",
    )

    network_ids = [item["operation_id"] for item in contract["network_assertions"]]
    require(network_ids == RUNTIME_OPERATION_ORDER, f"{workflow_id} Playwright network operation order mismatch: {network_ids}")
    require(set(network_ids) == set(workflow["api_smoke_contract"]["operation_ids"]), f"{workflow_id} Playwright network operations must match API smoke operations")
    for assertion in contract["network_assertions"]:
        operation_id = assertion["operation_id"]
        operation = operations.get(operation_id)
        require(operation is not None, f"{workflow_id} Playwright network assertion cites unknown operation {operation_id}")
        require(assertion["method"] == operation["method"], f"{workflow_id} Playwright network {operation_id} method mismatch")
        require(assertion["path_template"] == operation["path_template"], f"{workflow_id} Playwright network {operation_id} path mismatch")
        require(f'        "{assertion["success_status"]}":' in operation["block"], f"{workflow_id} Playwright network {operation_id} success status missing in OpenAPI")

    artifact_text = " ".join(contract["artifact_assertions"])
    required_asset_files = {asset["file_name"] for asset in workflow["required_generated_assets"]}
    for file_name in required_asset_files:
        require(f"assets/{file_name}" in artifact_text, f"{workflow_id} Playwright artifact assertions missing assets/{file_name}")
    for evidence_file in REQUIRED_EXPORT_FILES:
        require(evidence_file in artifact_text, f"{workflow_id} Playwright artifact assertions missing {evidence_file}")

    require(
        contract["expected_user_steps"][0] == "create project"
        and contract["expected_user_steps"][-1] == "preview and download export",
        f"{workflow_id} Playwright expected user steps must span project creation through export download",
    )


def validate_blueprint_split(workflows: dict[str, dict[str, Any]]) -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked = checked_items(text)
    unchecked = unchecked_items(text)

    for workflow_id in workflows:
        items = WORKFLOW_CHECKLIST_ITEMS[workflow_id]
        require(items["fixture"] in checked, f"{workflow_id} fixture checklist item must be checked")
        closed_items = WORKFLOW_RUNTIME_CLOSED_ITEMS.get(workflow_id, set())
        for item_key, label in [("api", "API smoke"), ("playwright", "Playwright")]:
            if item_key in closed_items:
                require(items[item_key] in checked, f"{workflow_id} {label} checklist item must be checked")
                validate_closed_runtime_evidence(workflow_id, item_key)
            else:
                require(items[item_key] in unchecked, f"{workflow_id} {label} checklist item must remain open")
                require(items[item_key] not in checked, f"{workflow_id} {label} must not be checked without runtime evidence")
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
    operations = openapi_operations(openapi)
    require("strategy_taxonomy" in openapi, "CandidateAsset schema must expose strategy_taxonomy for workflow smoke assertions")
    require("file_name" in openapi, "CandidateAsset schema must expose file_name for package/export smoke assertions")
    for operation_id in RUNTIME_OPERATION_IDS:
        require(operation_id in operations, f"OpenAPI missing workflow smoke operation {operation_id}")

    for workflow_id, workflow in workflows.items():
        operation_ids = set(workflow["api_smoke_contract"]["operation_ids"])
        missing = RUNTIME_OPERATION_IDS - operation_ids
        require(not missing, f"{workflow_id} API smoke contract missing operation IDs: {sorted(missing)}")
        for operation_id in operation_ids:
            require(operation_id in operations, f"{workflow_id} cites unknown operation {operation_id}")
        validate_api_smoke_sequence(workflow_id, workflow, openapi, operations)
        require(
            workflow["api_smoke_contract"]["execution_status"] == "not_executed",
            f"{workflow_id} API smoke contract must not claim runtime execution",
        )
        require(
            workflow["playwright_happy_path_contract"]["execution_status"] == "not_executed",
            f"{workflow_id} Playwright contract must not claim runtime execution",
        )
        validate_playwright_contract(workflow_id, workflow, operations)


def validate_fixture_links(workflows: dict[str, dict[str, Any]]) -> None:
    suite = load_json(EVAL_SUITE)
    results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)
    safety_rules = load_json(SAFETY_RULES)
    trace_completeness = load_json(TRACE_COMPLETENESS)

    require(suite["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval suite must cite Rev2 blueprint")
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result = results[0]
    require(
        trace_completeness["blueprint_source"] == "Docs/stage0_blueprint_rev2.md",
        "trace completeness contract must cite Rev2 blueprint",
    )

    suite_by_id = {fixture["fixture_id"]: fixture for fixture in suite["fixtures"]}
    result_by_id = {item["fixture_id"]: item for item in result["fixture_results"]}
    trace_by_fixture = {
        item["fixture_id"]: item
        for item in trace_completeness["traces"]
    }
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
        contract = workflow["contract_evidence"]
        require(golden_id in suite_by_id, f"{workflow_id} golden fixture missing from eval suite")
        require(golden_id in result_by_id, f"{workflow_id} golden fixture missing from eval results")
        require(golden_id in trace_by_fixture, f"{workflow_id} golden fixture missing from trace completeness contract")
        require(suite_by_id[golden_id]["workflow"] == workflow_id, f"{workflow_id} golden fixture workflow mismatch")
        require(suite_by_id[golden_id]["category"] == "golden", f"{workflow_id} golden fixture must be category golden")
        require(result_by_id[golden_id]["candidate_count"] == 4, f"{workflow_id} golden eval must cover four candidates")
        require(result_by_id[golden_id]["export_contract"]["qa_report"] is True, f"{workflow_id} golden eval must include QA report")
        require(
            result_by_id[golden_id]["export_contract"]["trace_provenance"] is True,
            f"{workflow_id} golden eval must include trace provenance",
        )
        require(contract["eval_result_id"] == result["result_id"], f"{workflow_id} contract evidence result_id mismatch")
        require(contract["eval_suite_id"] == suite["suite_id"], f"{workflow_id} contract evidence suite_id mismatch")
        require(contract["golden_fixture_id"] == golden_id, f"{workflow_id} contract evidence golden fixture mismatch")
        require(
            contract["golden_eval_status"] == result_by_id[golden_id]["status"],
            f"{workflow_id} contract evidence status mismatch",
        )
        require(
            set(contract["required_trace_fields"]) == TRACE_FIELDS,
            f"{workflow_id} contract evidence trace fields mismatch",
        )
        require(
            set(contract["required_trace_fields"]) == set(trace_completeness["required_trace_fields"]),
            f"{workflow_id} contract evidence does not match trace completeness required fields",
        )
        require(
            set(contract["required_pipeline_steps"]) == SAFETY_POINTS,
            f"{workflow_id} contract evidence pipeline steps mismatch",
        )
        require(
            set(contract["required_pipeline_steps"]) == set(trace_completeness["required_pipeline_steps"]),
            f"{workflow_id} contract evidence does not match trace completeness pipeline steps",
        )
        require(
            contract["trace_id"] == result_by_id[golden_id]["trace_contract"]["trace_id"],
            f"{workflow_id} contract evidence trace_id mismatch with eval result",
        )
        trace = trace_by_fixture[golden_id]
        require(trace["workflow"] == workflow_id, f"{workflow_id} trace completeness workflow mismatch")
        require(trace["trace_id"] == contract["trace_id"], f"{workflow_id} trace completeness trace_id mismatch")
        require(set(trace["covered_steps"]) == SAFETY_POINTS, f"{workflow_id} trace completeness must cover all pipeline steps")
        require(
            [step["step_name"] for step in trace["step_events"]] == list(contract["required_pipeline_steps"]),
            f"{workflow_id} trace step event order mismatch",
        )
        for result_key, contract_field in TRACE_RESULT_KEYS.items():
            require(
                result_by_id[golden_id]["trace_contract"][result_key] is True,
                f"{workflow_id} eval result trace contract {result_key} must be true",
            )
            if contract_field == "quota_transaction_id":
                require(trace["quota_transaction_id"], f"{workflow_id} trace completeness missing quota_transaction_id")
            else:
                require(
                    trace[contract_field]["present"] is True,
                    f"{workflow_id} trace completeness missing {contract_field}",
                )
        require(
            contract["export_contract"] == result_by_id[golden_id]["export_contract"],
            f"{workflow_id} contract evidence export contract mismatch",
        )
        for key in ["manifest", "qa_report", "trace_provenance", "safety_disclaimer_when_applicable"]:
            require(trace["export_references"][key] is True, f"{workflow_id} trace export reference {key} must be true")
        for key, value in contract["qa_export_gate"].items():
            require(
                result_by_id[golden_id]["qa_export_gate"][key] == value,
                f"{workflow_id} contract evidence qa export gate {key} mismatch",
            )
        require(
            set(contract["source_fixtures"])
            == {
                "fixtures/stage0/rev2/eval/starter_eval_results.json",
                "fixtures/stage0/rev2/eval/starter_eval_suite.json",
                "fixtures/stage0/rev2/eval/trace_completeness.json",
            },
            f"{workflow_id} contract evidence source fixtures mismatch",
        )
        require(
            contract["validator"] == "scripts/validate_workflow_acceptance_contract.py",
            f"{workflow_id} contract evidence validator mismatch",
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
            REQUIRED_EXPORT_FILES <= golden_files,
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
