#!/usr/bin/env python3
"""Build the Stage 0 Rev2 vertical workflow runtime evidence contract fixture."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "workflows"
API_EVIDENCE = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "workflow_api_smoke_evidence.json"
RESULT_PATH = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "workflow_runtime_evidence_contract.json"
DETERMINISTIC_CREATED_AT = "2026-05-26T00:00:00Z"
LOCAL_ALPHA_WEB_BASE_URL = "http://127.0.0.1:26080"
LOCAL_ALPHA_WEB_SERVER_CONTRACT = "web/playwright.config.ts webServer starts npm run dev -- --hostname 127.0.0.1 --port 26080"

WORKFLOW_ORDER = [
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
]

WORKFLOW_LABELS = {
    "ecommerce_growth_pack": "电商增长包",
    "business_visual_doc_pack": "商业视觉文档包",
    "local_merchant_campaign_pack": "本地商家活动包",
    "character_ip_concept_pack": "角色/IP 概念包",
}


class WorkflowRuntimeContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowRuntimeContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise WorkflowRuntimeContractError(message)


def expected_evidence_file(workflow_id: str, evidence_kind: str) -> str:
    suffixes = {
        "api_smoke": "api_smoke",
        "playwright_happy_path": "playwright_happy_path",
        "export_zip": "export_zip",
    }
    return f"ops/evidence/local_alpha/{workflow_id}.{suffixes[evidence_kind]}.json"


def runtime_file_status(workflow_id: str, evidence_kind: str) -> dict[str, Any]:
    expected_file = expected_evidence_file(workflow_id, evidence_kind)
    path = ROOT / expected_file
    status = "missing"
    if path.is_file():
        try:
            evidence = load_json(path)
        except WorkflowRuntimeContractError:
            status = "invalid_json"
        else:
            if (
                evidence.get("schema_version") == "stage0.rev2.local-alpha-runtime-evidence"
                and evidence.get("environment") == "local_alpha"
                and evidence.get("workflow_id") == workflow_id
                and evidence.get("evidence_kind") == evidence_kind
                and evidence.get("status") == "pass"
                and evidence.get("release_gate_check_id") == "local_alpha_e2e_workflow_smoke"
                and evidence.get("proves_running_local_stack") is True
                and evidence.get("local_stack", {}).get("web_base_url") == LOCAL_ALPHA_WEB_BASE_URL
                and evidence.get("local_stack", {}).get("web_server_contract") == LOCAL_ALPHA_WEB_SERVER_CONTRACT
            ):
                status = "present_passed"
            else:
                status = "present_failed_contract"
    return {
        "evidence_kind": evidence_kind,
        "expected_file": expected_file,
        "status": status,
    }


def checklist_items(workflow_id: str) -> dict[str, str]:
    label = WORKFLOW_LABELS[workflow_id]
    return {
        "api_smoke": f"{label} API smoke test 通过。",
        "playwright_happy_path": f"{label} Playwright happy path 通过。",
        "release_gate_runtime": (
            f"Local Alpha {label} runtime smoke evidence 写入 release gate fixture："
            f"`{expected_evidence_file(workflow_id, 'api_smoke')}`、"
            f"`{expected_evidence_file(workflow_id, 'playwright_happy_path')}`、"
            f"`{expected_evidence_file(workflow_id, 'export_zip')}` 均证明 running local stack。"
        ),
    }


def evidence_contract(workflow_id: str, evidence_kind: str, workflow: dict[str, Any]) -> dict[str, Any]:
    expected_file = expected_evidence_file(workflow_id, evidence_kind)
    if evidence_kind == "api_smoke":
        contract = workflow["api_smoke_contract"]
        return {
            "evidence_kind": evidence_kind,
            "expected_file": expected_file,
            "runtime_status": "not_executed",
            "checklist_item": checklist_items(workflow_id)["api_smoke"],
            "source_contract": f"fixtures/stage0/rev2/workflows/{workflow_id}.json#/api_smoke_contract",
            "required_assertions": contract["expected_runtime_assertions"],
            "operation_ids": contract["operation_ids"],
            "required_files": workflow["export_targets"][0]["required_files"],
            "must_prove_running_local_stack": True,
            "must_remain_open_until_runtime_passes": True,
        }
    if evidence_kind == "playwright_happy_path":
        contract = workflow["playwright_happy_path_contract"]
        return {
            "evidence_kind": evidence_kind,
            "expected_file": expected_file,
            "runtime_status": "not_executed",
            "checklist_item": checklist_items(workflow_id)["playwright_happy_path"],
            "source_contract": f"fixtures/stage0/rev2/workflows/{workflow_id}.json#/playwright_happy_path_contract",
            "start_route": contract["start_route"],
            "completion_route": contract["completion_route"],
            "required_actions": [step["action"] for step in contract["user_journey"]],
            "required_selectors": contract["required_selectors"],
            "operation_ids": [item["operation_id"] for item in contract["network_assertions"]],
            "artifact_assertions": contract["artifact_assertions"],
            "required_files": workflow["export_targets"][0]["required_files"],
            "must_prove_running_local_stack": True,
            "must_remain_open_until_runtime_passes": True,
        }
    if evidence_kind == "export_zip":
        export_target = workflow["export_targets"][0]
        asset_files = [f"assets/{asset['file_name']}" for asset in workflow["required_generated_assets"]]
        return {
            "evidence_kind": evidence_kind,
            "expected_file": expected_file,
            "runtime_status": "not_executed",
            "checklist_item": checklist_items(workflow_id)["release_gate_runtime"],
            "source_contract": f"fixtures/stage0/rev2/workflows/{workflow_id}.json#/export_targets/0",
            "format": export_target["format"],
            "required_files": export_target["required_files"],
            "required_asset_files": asset_files,
            "required_manifest_files": [
                "manifest.json",
                "metadata.json",
                "qa_report.json",
                "trace_provenance.json",
            ],
            "required_assertions": [
                "downloaded ZIP is produced by running local stack",
                "ZIP contains manifest.json",
                "ZIP contains metadata.json",
                "ZIP contains qa_report.json",
                "ZIP contains trace_provenance.json",
                "ZIP contains every required workflow asset",
                "manifest links QA report and trace provenance",
            ],
            "must_prove_running_local_stack": True,
            "must_remain_open_until_runtime_passes": True,
        }
    raise WorkflowRuntimeContractError(f"unknown evidence kind: {evidence_kind}")


def workflow_contract(workflow_id: str, workflow: dict[str, Any]) -> dict[str, Any]:
    evidence_items = [
        evidence_contract(workflow_id, "api_smoke", workflow),
        evidence_contract(workflow_id, "playwright_happy_path", workflow),
        evidence_contract(workflow_id, "export_zip", workflow),
    ]
    runtime_files = [runtime_file_status(workflow_id, kind) for kind in [
        "api_smoke",
        "playwright_happy_path",
        "export_zip",
    ]]
    missing_files = [
        item["expected_file"]
        for item in runtime_files
        if item["status"] != "present_passed"
    ]
    return {
        "workflow_id": workflow_id,
        "display_name": workflow["display_name"],
        "status": "planned",
        "checklist_items": checklist_items(workflow_id),
        "expected_evidence_files": [item["expected_file"] for item in evidence_items],
        "runtime_closure_contract": {
            "release_gate_check_id": "local_alpha_e2e_workflow_smoke",
            "pass_file_schema_version": "stage0.rev2.local-alpha-runtime-evidence",
            "pass_file_environment": "local_alpha",
            "pass_file_status": "pass",
            "allowed_closed_without_runtime_evidence": False,
            "missing_runtime_files_keep_checklist_open": True,
            "runtime_files": runtime_files,
            "missing_runtime_files": missing_files,
            "workflow_runtime_closed": not missing_files,
        },
        "evidence_contracts": evidence_items,
        "release_gate_check": {
            "gate": "local_alpha",
            "check_id": "local_alpha_e2e_workflow_smoke",
            "status_until_runtime_files_pass": "blocked",
            "required_evidence_files": [item["expected_file"] for item in evidence_items],
        },
    }


def build_contract() -> dict[str, Any]:
    api_evidence = load_json(API_EVIDENCE)
    require(api_evidence["status"] == "planned", "API smoke evidence must remain dry-run planned")
    workflows = [load_json(WORKFLOW_DIR / f"{workflow_id}.json") for workflow_id in WORKFLOW_ORDER]
    contracts = [workflow_contract(workflow["workflow_id"], workflow) for workflow in workflows]
    all_runtime_closed = all(contract["runtime_closure_contract"]["workflow_runtime_closed"] for contract in contracts)
    return {
        "schema_version": "stage0.rev2",
        "contract_id": "workflow_runtime_evidence_stage0_rev2_verticals",
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "created_by_lane": "lane2",
        "created_at": DETERMINISTIC_CREATED_AT,
        "blueprint_sections": ["6.1", "15.3", "24.1", "25.12", "25.17"],
        "runner": "scripts/run_workflow_runtime_contract.py",
        "validator": "scripts/validate_workflow_runtime_evidence_contract.py",
        "mode": "dry_run_contract",
        "status": "planned",
        "api_smoke_evidence_ref": "fixtures/stage0/rev2/eval/workflow_api_smoke_evidence.json",
        "workflow_runtime_contracts": contracts,
        "summary": {
            "workflow_count": len(contracts),
            "evidence_file_count": sum(len(item["expected_evidence_files"]) for item in contracts),
            "api_smoke_contracts": len(contracts),
            "playwright_happy_path_contracts": len(contracts),
            "export_zip_contracts": len(contracts),
            "runtime_evidence_required_for_closure": True,
            "local_alpha_e2e_workflow_smoke_remains_blocked": not all_runtime_closed,
        },
        "provenance": {
            "blueprint_sections": ["6.1", "15.3", "24.1", "25.12", "25.17"],
            "created_by_lane": "lane2",
            "source_fixtures": [
                f"fixtures/stage0/rev2/workflows/{workflow_id}.json"
                for workflow_id in WORKFLOW_ORDER
            ]
            + ["fixtures/stage0/rev2/eval/workflow_api_smoke_evidence.json"],
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-fixture", action="store_true", help="write deterministic runtime contract fixture")
    parser.add_argument("--check-fixture", action="store_true", help="compare deterministic output with stored fixture")
    args = parser.parse_args()

    try:
        contract = build_contract()
        encoded = json.dumps(contract, indent=2, sort_keys=False) + "\n"
        if args.write_fixture:
            RESULT_PATH.write_text(encoded, encoding="utf-8")
        elif args.check_fixture:
            require(RESULT_PATH.exists(), "stored workflow runtime evidence contract is missing")
            require(
                RESULT_PATH.read_text(encoding="utf-8") == encoded,
                "stored workflow runtime evidence contract is stale; run scripts/run_workflow_runtime_contract.py --write-fixture",
            )
        else:
            print(encoded, end="")
    except WorkflowRuntimeContractError as exc:
        print(f"workflow runtime evidence contract failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
