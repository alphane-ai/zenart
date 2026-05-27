#!/usr/bin/env python3
"""Validate Stage 0 Rev2 vertical workflow runtime evidence contracts."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
WORKFLOW_DIR = FIXTURE_DIR / "workflows"
CONTRACT = FIXTURE_DIR / "eval" / "workflow_runtime_evidence_contract.json"
API_EVIDENCE = FIXTURE_DIR / "eval" / "workflow_api_smoke_evidence.json"
RUNNER = ROOT / "scripts" / "run_workflow_runtime_contract.py"
LOCAL_ALPHA_GATE = FIXTURE_DIR / "release_gate_evidence.local_alpha.json"
LOCAL_ALPHA_EVIDENCE_DIR = ROOT / "ops" / "evidence" / "local_alpha"

WORKFLOWS = {
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
}
WORKFLOW_ORDER = [
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
]
EVIDENCE_KINDS = {
    "api_smoke",
    "playwright_happy_path",
    "export_zip",
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
PLAYWRIGHT_ACTIONS = [
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
REQUIRED_EXPORT_FILES = {
    "manifest.json",
    "metadata.json",
    "qa_report.json",
    "trace_provenance.json",
}
LOCAL_ALPHA_AGGREGATE_ITEM = (
    "Local Alpha workflow API/Playwright end-to-end smoke evidence 通过并写入 release gate fixture。"
)
LOCAL_ALPHA_RUNTIME_CLOSED_WORKFLOWS = {
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
}
LOCAL_ALPHA_RUNTIME_CLOSED_ITEM_KEYS = {
    "ecommerce_growth_pack": {
        "api_smoke",
        "playwright_happy_path",
        "release_gate_runtime",
    },
    "business_visual_doc_pack": {
        "api_smoke",
        "playwright_happy_path",
        "release_gate_runtime",
    },
    "local_merchant_campaign_pack": {
        "api_smoke",
        "playwright_happy_path",
        "release_gate_runtime",
    },
    "character_ip_concept_pack": {
        "api_smoke",
        "playwright_happy_path",
        "release_gate_runtime",
    },
}


class WorkflowRuntimeEvidenceContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowRuntimeEvidenceContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise WorkflowRuntimeEvidenceContractError(message)


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


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def expected_file(workflow_id: str, kind: str) -> str:
    suffix = {
        "api_smoke": "api_smoke",
        "playwright_happy_path": "playwright_happy_path",
        "export_zip": "export_zip",
    }[kind]
    return f"ops/evidence/local_alpha/{workflow_id}.{suffix}.json"


def expected_files(workflow_id: str) -> list[str]:
    return [
        expected_file(workflow_id, kind)
        for kind in ["api_smoke", "playwright_happy_path", "export_zip"]
    ]


def validate_closed_runtime_evidence_file(path: str, workflow_id: str, kind: str) -> None:
    evidence_path = ROOT / path
    require(evidence_path.is_file(), f"{workflow_id} {kind} closed runtime evidence file is missing: {path}")
    evidence = load_json(evidence_path)
    require(
        evidence.get("schema_version") == "stage0.rev2.local-alpha-runtime-evidence",
        f"{workflow_id} {kind} runtime evidence schema mismatch",
    )
    require(evidence.get("environment") == "local_alpha", f"{workflow_id} {kind} must be local_alpha evidence")
    require(evidence.get("workflow_id") == workflow_id, f"{workflow_id} {kind} evidence workflow mismatch")
    require(evidence.get("evidence_kind") == kind, f"{workflow_id} {kind} evidence kind mismatch")
    require(evidence.get("status") == "pass", f"{workflow_id} {kind} evidence must pass")
    require(
        evidence.get("release_gate_check_id") == "local_alpha_e2e_workflow_smoke",
        f"{workflow_id} {kind} evidence must target Local Alpha workflow smoke gate",
    )
    require(evidence.get("proves_running_local_stack") is True, f"{workflow_id} {kind} must prove running local stack")


def validate_runner_replay() -> None:
    result = subprocess.run(
        [sys.executable, str(RUNNER), "--check-fixture"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "workflow runtime evidence contract replay failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_top_level(contract: dict[str, Any]) -> None:
    require(contract["schema_version"] == "stage0.rev2", "runtime contract schema version mismatch")
    require(contract["contract_id"] == "workflow_runtime_evidence_stage0_rev2_verticals", "runtime contract id mismatch")
    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "runtime contract must cite Rev2")
    require(contract["created_by_lane"] == "lane2", "runtime contract must be lane2-owned")
    require(contract["runner"] == "scripts/run_workflow_runtime_contract.py", "runtime contract runner mismatch")
    require(contract["validator"] == "scripts/validate_workflow_runtime_evidence_contract.py", "runtime contract validator mismatch")
    require(contract["mode"] == "dry_run_contract", "runtime contract must be dry-run contract evidence")
    require(contract["status"] == "planned", "runtime contract must not claim runtime pass")
    require(
        contract["api_smoke_evidence_ref"] == "fixtures/stage0/rev2/eval/workflow_api_smoke_evidence.json",
        "API smoke evidence link mismatch",
    )
    require(set(contract["blueprint_sections"]) >= {"6.1", "25.12"}, "runtime contract must cite workflow sections")
    summary = contract["summary"]
    require(summary["workflow_count"] == 4, "runtime contract must cover four workflows")
    require(summary["evidence_file_count"] == 12, "runtime contract must require 12 per-workflow evidence files")
    require(summary["api_smoke_contracts"] == 4, "runtime contract must cover four API smokes")
    require(summary["playwright_happy_path_contracts"] == 4, "runtime contract must cover four Playwright paths")
    require(summary["export_zip_contracts"] == 4, "runtime contract must cover four export ZIP checks")
    require(summary["runtime_evidence_required_for_closure"] is True, "runtime closure must require evidence")
    require(
        summary["local_alpha_e2e_workflow_smoke_remains_blocked"] is False,
        "runtime contract must not keep Local Alpha workflow smoke blocked after all runtime files pass",
    )


def validate_blueprint_and_release_gate(contract: dict[str, Any]) -> None:
    blueprint = BLUEPRINT.read_text(encoding="utf-8")
    checked = checked_items(blueprint)
    unchecked = unchecked_items(blueprint)
    gate = load_json(LOCAL_ALPHA_GATE)
    local_alpha_check = {
        item["check_id"]: item
        for item in gate["checks"]
    }["local_alpha_e2e_workflow_smoke"]

    require(LOCAL_ALPHA_AGGREGATE_ITEM in checked, "Local Alpha aggregate workflow runtime item must be checked")
    require(LOCAL_ALPHA_AGGREGATE_ITEM not in unchecked, "Local Alpha aggregate runtime item cannot remain open")
    require(local_alpha_check["status"] == "pass", "Local Alpha workflow smoke gate must pass")

    evidence_ref = local_alpha_check["evidence_ref"]
    for workflow in contract["workflow_runtime_contracts"]:
        workflow_id = workflow["workflow_id"]
        items = workflow["checklist_items"]
        closed_item_keys = LOCAL_ALPHA_RUNTIME_CLOSED_ITEM_KEYS.get(workflow_id, set())
        for item_key in ["api_smoke", "playwright_happy_path", "release_gate_runtime"]:
            if item_key in closed_item_keys:
                require(items[item_key] in checked, f"{workflow_id} {item_key} checklist item must be checked")
                continue
            require(items[item_key] in unchecked, f"{workflow_id} {item_key} checklist item must remain open")
            require(items[item_key] not in checked, f"{workflow_id} {item_key} must not be checked by runtime evidence")
        if workflow_id in LOCAL_ALPHA_RUNTIME_CLOSED_WORKFLOWS:
            for kind, path in zip(["api_smoke", "playwright_happy_path", "export_zip"], expected_files(workflow_id), strict=True):
                require(path in evidence_ref, f"{workflow_id} release gate evidence must cite {path}")
                validate_closed_runtime_evidence_file(path, workflow_id, kind)


def validate_api_evidence_link(contract: dict[str, Any]) -> None:
    api_evidence = load_json(API_EVIDENCE)
    require(api_evidence["status"] == "planned", "API smoke evidence must remain planned")
    require(api_evidence["mode"] == "dry_run", "API smoke evidence must be dry-run")
    api_workflows = {item["workflow_id"]: item for item in api_evidence["workflow_results"]}
    require(set(api_workflows) == WORKFLOWS, "API smoke evidence workflow set mismatch")

    for workflow in contract["workflow_runtime_contracts"]:
        workflow_id = workflow["workflow_id"]
        api_contract = next(item for item in workflow["evidence_contracts"] if item["evidence_kind"] == "api_smoke")
        require(api_contract["operation_ids"] == api_workflows[workflow_id]["operation_ids"], f"{workflow_id} API operations mismatch")
        require(
            api_contract["required_assertions"] == api_workflows[workflow_id]["expected_runtime_assertions"],
            f"{workflow_id} API runtime assertions mismatch",
        )


def validate_workflow_contracts(contract: dict[str, Any]) -> None:
    workflows = {path.stem: load_json(path) for path in sorted(WORKFLOW_DIR.glob("*.json"))}
    require(set(workflows) == WORKFLOWS, f"workflow fixture set mismatch: {sorted(set(workflows) ^ WORKFLOWS)}")

    workflow_contracts = {item["workflow_id"]: item for item in contract["workflow_runtime_contracts"]}
    require(set(workflow_contracts) == WORKFLOWS, "runtime contract workflow set mismatch")
    require(list(workflow_contracts) == WORKFLOW_ORDER, "runtime contract workflow order mismatch")

    for workflow_id, runtime_contract in workflow_contracts.items():
        workflow = workflows[workflow_id]
        require(runtime_contract["display_name"] == workflow["display_name"], f"{workflow_id} display name mismatch")
        require(runtime_contract["status"] == "planned", f"{workflow_id} runtime contract must remain planned")
        workflow_expected_files = expected_files(workflow_id)
        require(runtime_contract["expected_evidence_files"] == workflow_expected_files, f"{workflow_id} evidence files mismatch")
        validate_runtime_closure_contract(workflow_id, runtime_contract["runtime_closure_contract"], workflow_expected_files)

        release_gate = runtime_contract["release_gate_check"]
        require(release_gate["gate"] == "local_alpha", f"{workflow_id} release gate must be local_alpha")
        require(release_gate["check_id"] == "local_alpha_e2e_workflow_smoke", f"{workflow_id} release gate check mismatch")
        require(release_gate["status_until_runtime_files_pass"] == "blocked", f"{workflow_id} release gate must remain blocked")
        require(release_gate["required_evidence_files"] == workflow_expected_files, f"{workflow_id} release gate evidence file mismatch")

        evidence_contracts = {item["evidence_kind"]: item for item in runtime_contract["evidence_contracts"]}
        require(set(evidence_contracts) == EVIDENCE_KINDS, f"{workflow_id} evidence kinds mismatch")
        validate_api_contract(workflow_id, evidence_contracts["api_smoke"], workflow)
        validate_playwright_contract(workflow_id, evidence_contracts["playwright_happy_path"], workflow)
        validate_export_zip_contract(workflow_id, evidence_contracts["export_zip"], workflow)


def validate_runtime_closure_contract(workflow_id: str, closure: dict[str, Any], workflow_expected_files: list[str]) -> None:
    require(
        closure["release_gate_check_id"] == "local_alpha_e2e_workflow_smoke",
        f"{workflow_id} runtime closure release gate mismatch",
    )
    require(
        closure["pass_file_schema_version"] == "stage0.rev2.local-alpha-runtime-evidence",
        f"{workflow_id} runtime closure schema version mismatch",
    )
    require(closure["pass_file_environment"] == "local_alpha", f"{workflow_id} runtime closure environment mismatch")
    require(closure["pass_file_status"] == "pass", f"{workflow_id} runtime closure pass status mismatch")
    require(
        closure["allowed_closed_without_runtime_evidence"] is False,
        f"{workflow_id} runtime closure must disallow closure without runtime evidence",
    )
    require(
        closure["missing_runtime_files_keep_checklist_open"] is True,
        f"{workflow_id} missing runtime files must keep checklist items open",
    )

    expected_by_kind = {
        "api_smoke": expected_file(workflow_id, "api_smoke"),
        "playwright_happy_path": expected_file(workflow_id, "playwright_happy_path"),
        "export_zip": expected_file(workflow_id, "export_zip"),
    }
    runtime_files = {item["evidence_kind"]: item for item in closure["runtime_files"]}
    require(set(runtime_files) == EVIDENCE_KINDS, f"{workflow_id} runtime closure evidence kind mismatch")
    require(
        [runtime_files[kind]["expected_file"] for kind in ["api_smoke", "playwright_happy_path", "export_zip"]]
        == workflow_expected_files,
        f"{workflow_id} runtime closure file order mismatch",
    )

    missing_files: list[str] = []
    for kind, expected_path in expected_by_kind.items():
        item = runtime_files[kind]
        require(item["expected_file"] == expected_path, f"{workflow_id} {kind} closure expected file mismatch")
        path = ROOT / expected_path
        if path.is_file():
            evidence = load_json(path)
            passes = (
                evidence.get("schema_version") == closure["pass_file_schema_version"]
                and evidence.get("environment") == closure["pass_file_environment"]
                and evidence.get("workflow_id") == workflow_id
                and evidence.get("evidence_kind") == kind
                and evidence.get("status") == closure["pass_file_status"]
                and evidence.get("release_gate_check_id") == closure["release_gate_check_id"]
                and evidence.get("proves_running_local_stack") is True
            )
            expected_status = "present_passed" if passes else "present_failed_contract"
        else:
            expected_status = "missing"
        require(
            item["status"] == expected_status,
            f"{workflow_id} {kind} runtime closure status {item['status']} != {expected_status}",
        )
        if expected_status != "present_passed":
            missing_files.append(expected_path)

    require(
        closure["missing_runtime_files"] == missing_files,
        f"{workflow_id} runtime closure missing files mismatch",
    )
    require(
        closure["workflow_runtime_closed"] is (len(missing_files) == 0),
        f"{workflow_id} runtime closure boolean mismatch",
    )


def validate_common_evidence_fields(workflow_id: str, item: dict[str, Any], kind: str, workflow: dict[str, Any]) -> None:
    require(item["expected_file"] == expected_file(workflow_id, kind), f"{workflow_id} {kind} expected file mismatch")
    require(item["runtime_status"] == "not_executed", f"{workflow_id} {kind} must not claim execution")
    require(item["source_contract"].startswith(f"fixtures/stage0/rev2/workflows/{workflow_id}.json#"), f"{workflow_id} {kind} source contract mismatch")
    require(item["must_prove_running_local_stack"] is True, f"{workflow_id} {kind} must prove running local stack")
    require(item["must_remain_open_until_runtime_passes"] is True, f"{workflow_id} {kind} must keep checklist open")
    require(set(item["required_files"]) == set(workflow["export_targets"][0]["required_files"]), f"{workflow_id} {kind} required files mismatch")


def validate_api_contract(workflow_id: str, item: dict[str, Any], workflow: dict[str, Any]) -> None:
    validate_common_evidence_fields(workflow_id, item, "api_smoke", workflow)
    require(item["checklist_item"].endswith("API smoke test 通过。"), f"{workflow_id} API checklist item mismatch")
    require(item["operation_ids"] == RUNTIME_OPERATION_ORDER, f"{workflow_id} API operation order mismatch")
    require(item["required_assertions"] == workflow["api_smoke_contract"]["expected_runtime_assertions"], f"{workflow_id} API assertions mismatch")
    assertion_text = " ".join(item["required_assertions"])
    require("four" in assertion_text and "candidate" in assertion_text, f"{workflow_id} API contract must assert four candidates")
    api_operation_ids = [step["operation_id"] for step in workflow["api_smoke_contract"]["request_sequence"]]
    require("selectDirection" in api_operation_ids, f"{workflow_id} API contract must include direction selection")
    require("export" in assertion_text.lower(), f"{workflow_id} API contract must assert export behavior")
    request_assertion_text = " ".join(
        assertion
        for step in workflow["api_smoke_contract"]["request_sequence"]
        for assertion in step["body_assertions"]
    )
    taxonomy_text = assertion_text + " " + request_assertion_text
    taxonomy_terms = set(workflow["four_option_taxonomy"])
    require(
        any(term in taxonomy_text for term in taxonomy_terms) or "taxonomy" in taxonomy_text,
        f"{workflow_id} API contract must assert taxonomy coverage",
    )


def validate_playwright_contract(workflow_id: str, item: dict[str, Any], workflow: dict[str, Any]) -> None:
    validate_common_evidence_fields(workflow_id, item, "playwright_happy_path", workflow)
    source = workflow["playwright_happy_path_contract"]
    require(item["checklist_item"].endswith("Playwright happy path 通过。"), f"{workflow_id} Playwright checklist item mismatch")
    require(item["start_route"] == source["start_route"], f"{workflow_id} Playwright start route mismatch")
    require(item["completion_route"] == source["completion_route"], f"{workflow_id} Playwright completion route mismatch")
    require(item["operation_ids"] == RUNTIME_OPERATION_ORDER, f"{workflow_id} Playwright operation order mismatch")
    require(item["required_selectors"] == source["required_selectors"], f"{workflow_id} Playwright selectors mismatch")
    for action in PLAYWRIGHT_ACTIONS:
        require(action in item["required_actions"], f"{workflow_id} Playwright action missing {action}")
    artifact_text = " ".join(item["artifact_assertions"])
    for required_file in REQUIRED_EXPORT_FILES:
        require(required_file in artifact_text, f"{workflow_id} Playwright artifact assertion missing {required_file}")


def validate_export_zip_contract(workflow_id: str, item: dict[str, Any], workflow: dict[str, Any]) -> None:
    validate_common_evidence_fields(workflow_id, item, "export_zip", workflow)
    require("runtime smoke evidence" in item["checklist_item"], f"{workflow_id} export ZIP checklist item mismatch")
    require(item["format"] == "zip", f"{workflow_id} export format must be zip")
    required_asset_files = [f"assets/{asset['file_name']}" for asset in workflow["required_generated_assets"]]
    require(item["required_asset_files"] == required_asset_files, f"{workflow_id} export asset files mismatch")
    require(set(item["required_manifest_files"]) == REQUIRED_EXPORT_FILES, f"{workflow_id} export manifest files mismatch")
    require(REQUIRED_EXPORT_FILES <= set(item["required_files"]), f"{workflow_id} export required files missing manifest bundle")
    require(set(required_asset_files) <= set(item["required_files"]), f"{workflow_id} export required files missing assets")
    assertion_text = " ".join(item["required_assertions"])
    for required in ["running local stack", "manifest.json", "qa_report.json", "trace_provenance.json", "every required workflow asset"]:
        require(required in assertion_text, f"{workflow_id} export ZIP assertions missing {required}")


def validate_workflow_runtime_evidence_contract() -> None:
    contract = load_json(CONTRACT)
    validate_top_level(contract)
    validate_blueprint_and_release_gate(contract)
    validate_workflow_contracts(contract)
    validate_api_evidence_link(contract)
    validate_runner_replay()


def main() -> int:
    try:
        validate_workflow_runtime_evidence_contract()
    except WorkflowRuntimeEvidenceContractError as exc:
        print(f"workflow runtime evidence contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("workflow runtime evidence contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
