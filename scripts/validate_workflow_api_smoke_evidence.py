#!/usr/bin/env python3
"""Validate Stage 0 Rev2 vertical workflow API smoke evidence."""

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
EVIDENCE = FIXTURE_DIR / "eval" / "workflow_api_smoke_evidence.json"
RUNNER = ROOT / "scripts" / "run_workflow_api_smoke.py"

WORKFLOWS = {
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
}
WORKFLOW_CHECKLIST_ITEMS = {
    "ecommerce_growth_pack": "电商增长包 API smoke test 通过。",
    "business_visual_doc_pack": "商业视觉文档包 API smoke test 通过。",
    "local_merchant_campaign_pack": "本地商家活动包 API smoke test 通过。",
    "character_ip_concept_pack": "角色/IP 概念包 API smoke test 通过。",
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


class WorkflowAPISmokeEvidenceError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowAPISmokeEvidenceError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise WorkflowAPISmokeEvidenceError(message)


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
        "workflow API smoke fixture replay failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_evidence_shape(evidence: dict[str, Any]) -> None:
    require(evidence["schema_version"] == "stage0.rev2", "workflow API smoke evidence schema version mismatch")
    require(evidence["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "workflow API smoke evidence must cite Rev2")
    require(evidence["created_by_lane"] == "lane2", "workflow API smoke evidence must be lane2-owned")
    require(evidence["runner"] == "scripts/run_workflow_api_smoke.py", "workflow API smoke evidence runner mismatch")
    require(evidence["mode"] == "dry_run", "stored workflow API smoke evidence must be dry-run evidence")
    require(evidence["status"] == "planned", "stored workflow API smoke evidence must not claim runtime pass")
    policy = evidence["checklist_policy"]
    require(policy["api_smoke_checklist_remains_open"] is True, "dry-run evidence must keep API smoke checklist open")
    require(policy["local_alpha_gate_remains_open"] is True, "dry-run evidence must keep Local Alpha gate open")
    require(policy["runtime_evidence_required_for_closure"] is True, "API smoke closure must require runtime evidence")

    results = {item["workflow_id"]: item for item in evidence["workflow_results"]}
    require(set(results) == WORKFLOWS, f"workflow API smoke evidence workflow mismatch: {sorted(set(results) ^ WORKFLOWS)}")
    require(evidence["summary"]["workflow_count"] == 4, "workflow API smoke evidence must cover four workflows")
    require(evidence["summary"]["planned_workflows"] == 4, "dry-run evidence must plan all four workflows")
    require(evidence["summary"]["operation_count"] == 32, "workflow API smoke evidence must cover 32 operations")
    require(evidence["summary"]["required_runtime_assertions_covered"] is True, "runtime assertions must be covered")
    require(evidence["summary"]["openapi_contract_validated"] is True, "OpenAPI contract flag must be true")
    require(evidence["summary"]["fixture_contract_validated"] is True, "fixture contract flag must be true")


def validate_workflow_links(evidence: dict[str, Any]) -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked = checked_items(text)
    unchecked = unchecked_items(text)
    results = {item["workflow_id"]: item for item in evidence["workflow_results"]}

    for workflow_id, result in results.items():
        workflow = load_json(WORKFLOW_DIR / f"{workflow_id}.json")
        contract = workflow["api_smoke_contract"]
        checklist_item = WORKFLOW_CHECKLIST_ITEMS[workflow_id]

        require(result["checklist_item"] == checklist_item, f"{workflow_id} checklist item mismatch")
        require(checklist_item in unchecked, f"{workflow_id} API smoke checklist must remain open for dry-run evidence")
        require(checklist_item not in checked, f"{workflow_id} API smoke checklist must not be checked by dry-run evidence")
        require(result["status"] == "planned", f"{workflow_id} dry-run result must be planned")
        require(result["operation_ids"] == contract["operation_ids"], f"{workflow_id} operation_ids mismatch")
        require(result["operation_ids"] == RUNTIME_OPERATION_ORDER, f"{workflow_id} operation order mismatch")
        require(result["expected_runtime_assertions"] == contract["expected_runtime_assertions"], f"{workflow_id} expected assertions mismatch")

        request_results = result["request_results"]
        require(len(request_results) == len(contract["request_sequence"]), f"{workflow_id} request result count mismatch")
        for observed, expected in zip(request_results, contract["request_sequence"], strict=True):
            for key in [
                "step",
                "operation_id",
                "method",
                "path_template",
                "request_schema",
                "response_schema",
                "requires_idempotency_key",
            ]:
                require(observed[key] == expected[key], f"{workflow_id} {expected['operation_id']} {key} mismatch")
            require(observed["expected_status"] == expected["success_status"], f"{workflow_id} expected status mismatch")
            require(observed["actual_status"] == "not_executed", f"{workflow_id} dry-run must not record runtime status")
            require(observed["result"] == "planned", f"{workflow_id} dry-run request must be planned")
            require(observed["body_assertions"] == expected["body_assertions"], f"{workflow_id} body assertions mismatch")
            require(observed["resolved_path"].startswith("/"), f"{workflow_id} resolved path must be API-relative")
            require("{" not in observed["resolved_path"], f"{workflow_id} resolved path has unresolved parameter")

        assertions = result["contract_assertions"]
        missing = [key for key, value in assertions.items() if value is not True]
        require(not missing, f"{workflow_id} contract assertions not covered: {missing}")

        required_files = {
            "manifest.json",
            "metadata.json",
            "qa_report.json",
            "trace_provenance.json",
        }
        export_files = set(workflow["export_targets"][0]["required_files"])
        missing_export_files = required_files - export_files
        require(not missing_export_files, f"{workflow_id} export target missing evidence files: {sorted(missing_export_files)}")


def validate_workflow_api_smoke_evidence() -> None:
    evidence = load_json(EVIDENCE)
    validate_evidence_shape(evidence)
    validate_workflow_links(evidence)
    validate_runner_replay()


def main() -> int:
    try:
        validate_workflow_api_smoke_evidence()
    except WorkflowAPISmokeEvidenceError as exc:
        print(f"workflow API smoke evidence validation failed: {exc}", file=sys.stderr)
        return 1
    print("workflow API smoke evidence validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
