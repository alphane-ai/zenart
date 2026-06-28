#!/usr/bin/env python3
"""Validate Stage 0 Rev2 vertical workflow export ZIP evidence contracts."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
CONTRACT = FIXTURE_DIR / "eval" / "workflow_export_zip_evidence_contract.json"
WORKFLOW_DIR = FIXTURE_DIR / "workflows"

WORKFLOW_ORDER = [
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
]
WORKFLOWS = set(WORKFLOW_ORDER)
SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}
CHECKLIST_ITEMS = {
    "ecommerce_growth_pack_export_zip": (
        "ecommerce_growth_pack",
        "电商增长包 export ZIP evidence 通过：`ops/evidence/local_alpha/ecommerce_growth_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    ),
    "business_visual_doc_pack_export_zip": (
        "business_visual_doc_pack",
        "商业视觉文档包 export ZIP evidence 通过：`ops/evidence/local_alpha/business_visual_doc_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    ),
    "local_merchant_campaign_pack_export_zip": (
        "local_merchant_campaign_pack",
        "本地商家活动包 export ZIP evidence 通过：`ops/evidence/local_alpha/local_merchant_campaign_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    ),
    "character_ip_concept_pack_export_zip": (
        "character_ip_concept_pack",
        "角色/IP 概念包 export ZIP evidence 通过：`ops/evidence/local_alpha/character_ip_concept_pack.export_zip.json` proves manifest、QA report、safety report、provenance、metadata、AI disclaimer、trace payloads and four-option taxonomy。",
    ),
}
REQUIRED_MANIFEST_PAYLOADS = {
    "manifest.json",
    "metadata.json",
    "qa_report.json",
    "trace_provenance.json",
}
REQUIRED_REPORT_PAYLOADS = {
    "qa-report.json",
    "qa_report.json",
    "safety-policy-report.json",
}
REQUIRED_METADATA_PAYLOADS = {
    "metadata.json",
    "ppt-ready-metadata.json",
    "provenance.json",
    "ai-content-disclaimer.json",
    "trace_provenance.json",
}
REQUIRED_ASSERTIONS = {
    "manifest",
    "qa_report",
    "safety_report",
    "provenance",
    "metadata",
    "ai_disclaimer",
    "trace_payloads",
    "four_option_taxonomy",
    "workflow_required_assets",
    "running_local_stack",
}
LOCAL_ALPHA_WEB_PORT = 26080
LOCAL_ALPHA_WORKER_ROOT_REL = "web"


class WorkflowExportZipEvidenceContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowExportZipEvidenceContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise WorkflowExportZipEvidenceContractError(message)


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


def expected_evidence_file(workflow_id: str) -> str:
    return f"ops/evidence/local_alpha/{workflow_id}.export_zip.json"


def workflow_asset_payloads(workflow: dict[str, Any]) -> list[str]:
    return [f"assets/{asset['file_name']}" for asset in workflow["required_generated_assets"]]


def workflow_zip_payloads(workflow: dict[str, Any]) -> list[str]:
    payloads = workflow["runtime_evidence_contract"].get("required_export_payloads")
    require(isinstance(payloads, list) and payloads, f"{workflow['workflow_id']} runtime evidence contract must declare required_export_payloads")
    return payloads


def workflow_rendered_asset_payloads(workflow: dict[str, Any]) -> list[str]:
    rendered_payloads = [
        payload
        for payload in workflow_zip_payloads(workflow)
        if payload.startswith("assets/")
    ]
    expected_asset_payloads: list[str] = []
    require(
        "assets/local-rendered-asset-manifest.json" in rendered_payloads,
        f"{workflow['workflow_id']} ZIP payloads must include rendered asset manifest",
    )
    for source_payload in workflow_asset_payloads(workflow):
        source = source_payload.removeprefix("assets/")
        stem, dot, suffix = source.rpartition(".")
        require(dot and suffix, f"{workflow['workflow_id']} source asset output must include extension: {source}")
        if suffix == "json":
            require(
                source_payload in rendered_payloads,
                f"{workflow['workflow_id']} ZIP payloads missing direct JSON asset payload {source_payload}",
            )
            expected_asset_payloads.append(source_payload)
            continue
        rendered = f"assets/rendered/{stem}-{suffix}.svg"
        require(
            rendered in rendered_payloads,
            f"{workflow['workflow_id']} ZIP payloads missing rendered payload for {source_payload}: {rendered}",
        )
        expected_asset_payloads.append(rendered)
    return expected_asset_payloads


def validate_top_level(contract: dict[str, Any]) -> None:
    require(contract["schema_version"] == "stage0.rev2", "contract schema_version mismatch")
    require(
        contract["contract_id"] == "workflow_export_zip_evidence_contract_stage0_rev2",
        "contract id mismatch",
    )
    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "contract must cite Rev2")
    require(contract["created_by_lane"] == "lane2", "contract must be lane2-owned")
    require(
        set(contract["blueprint_sections"]) >= {"6.1", "25.12"},
        "contract must cite workflow/export blueprint sections",
    )
    require(
        contract["validator"] == "scripts/validate_workflow_export_zip_evidence_contract.py",
        "validator self-reference mismatch",
    )
    require(
        contract["workflow_acceptance_ref"] == "fixtures/stage0/rev2/workflows",
        "workflow acceptance ref mismatch",
    )
    require(contract["runtime_evidence_directory"] == "ops/evidence/local_alpha", "runtime evidence dir mismatch")
    require(
        set(contract["required_export_evidence_assertions"]) == REQUIRED_ASSERTIONS,
        "required export assertions mismatch",
    )
    summary = contract["summary"]
    require(summary["workflow_count"] == 4, "summary workflow_count mismatch")
    require(summary["closed_export_evidence_count"] + summary["open_export_evidence_count"] == 4, "summary counts mismatch")
    require(
        summary["runtime_file_required_for_checklist_closure"] is True,
        "runtime file must be required for checklist closure",
    )


def validate_workflow_contract_shape(
    workflow_id: str,
    item: dict[str, Any],
    workflow: dict[str, Any],
) -> None:
    require(item["workflow_id"] == workflow_id, f"{workflow_id} workflow_id mismatch")
    require(item["fixture_id"] == workflow["golden_fixture"]["fixture_id"], f"{workflow_id} fixture_id mismatch")
    require(item["expected_evidence_file"] == expected_evidence_file(workflow_id), f"{workflow_id} evidence file mismatch")
    require(item["required_export_target_id"] == "zip_delivery", f"{workflow_id} export target mismatch")
    checklist_workflow, _ = CHECKLIST_ITEMS[item["checklist_item_id"]]
    require(checklist_workflow == workflow_id, f"{workflow_id} checklist item id mismatch")

    export_target = workflow["export_targets"][0]
    require(export_target["target_id"] == "zip_delivery", f"{workflow_id} first export target must be zip_delivery")
    require(export_target["format"] == "zip", f"{workflow_id} export target must be zip")

    expected_source_assets = workflow_asset_payloads(workflow)
    expected_rendered_assets = workflow_rendered_asset_payloads(workflow)
    expected_zip_payloads = workflow_zip_payloads(workflow)
    require(item["required_asset_payloads"] == expected_rendered_assets, f"{workflow_id} asset payload order mismatch")
    require(set(item["required_manifest_payloads"]) == REQUIRED_MANIFEST_PAYLOADS, f"{workflow_id} manifest payload mismatch")
    require(set(item["required_report_payloads"]) == REQUIRED_REPORT_PAYLOADS, f"{workflow_id} report payload mismatch")
    require(set(item["required_metadata_payloads"]) == REQUIRED_METADATA_PAYLOADS, f"{workflow_id} metadata payload mismatch")
    require(item["required_strategy_taxonomy"] == workflow["four_option_taxonomy"], f"{workflow_id} taxonomy mismatch")
    require(
        item["required_zip_payloads"] == expected_zip_payloads,
        f"{workflow_id} ZIP payload set mismatch",
    )
    direct_required_files = {
        required_file
        for required_file in export_target["required_files"]
        if not required_file.startswith("assets/")
    }
    require(
        direct_required_files <= set(item["required_zip_payloads"]),
        f"{workflow_id} ZIP payloads must include direct export target required files",
    )
    require(
        set(export_target["required_files"]) <= set(workflow["golden_fixture"]["expected_export_files"]),
        f"{workflow_id} golden fixture must keep source export required files",
    )
    require(
        len(expected_source_assets) == len(workflow["four_option_taxonomy"]) or workflow_id == "character_ip_concept_pack",
        f"{workflow_id} source asset count should track strategy taxonomy",
    )

    closure = item["closure_contract"]
    require(closure["release_gate_check_id"] == "local_alpha_e2e_workflow_smoke", f"{workflow_id} release gate mismatch")
    require(closure["requires_running_local_stack"] is True, f"{workflow_id} must require running local stack")
    require(closure["requires_pass_status"] is True, f"{workflow_id} must require pass status")
    require(closure["missing_file_keeps_checklist_open"] is True, f"{workflow_id} missing file must keep checklist open")


def validate_blueprint_state(contract: dict[str, Any]) -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked = checked_items(text)
    unchecked = unchecked_items(text)
    for item in contract["workflow_export_contracts"]:
        workflow_id = item["workflow_id"]
        checklist_id = item["checklist_item_id"]
        _, checklist_text = CHECKLIST_ITEMS[checklist_id]
        if item["blueprint_checklist_state"] == "checked":
            require(checklist_text in checked, f"{workflow_id} export ZIP checklist item must be checked")
            require(checklist_text not in unchecked, f"{workflow_id} export ZIP checklist item cannot be both checked/open")
        else:
            require(checklist_text in unchecked, f"{workflow_id} export ZIP checklist item must remain open")
            require(checklist_text not in checked, f"{workflow_id} export ZIP checklist item must not be checked")


def validate_runtime_evidence(item: dict[str, Any], workflow: dict[str, Any]) -> None:
    workflow_id = item["workflow_id"]
    evidence_path = ROOT / item["expected_evidence_file"]
    if item["expected_runtime_status"] == "missing_runtime_evidence":
        require(not evidence_path.exists(), f"{workflow_id} evidence file exists but contract still marks it missing")
        require(item["blueprint_checklist_state"] == "open", f"{workflow_id} missing evidence must keep checklist open")
        return

    require(item["expected_runtime_status"] == "present_passed", f"{workflow_id} unsupported runtime status")
    require(evidence_path.is_file(), f"{workflow_id} export ZIP evidence file missing")
    evidence = load_json(evidence_path)
    require(
        evidence.get("schema_version") == "stage0.rev2.local-alpha-runtime-evidence",
        f"{workflow_id} evidence schema mismatch",
    )
    require(evidence.get("environment") == "local_alpha", f"{workflow_id} evidence environment mismatch")
    require(evidence.get("workflow_id") == workflow_id, f"{workflow_id} evidence workflow mismatch")
    require(evidence.get("fixture_id") == item["fixture_id"], f"{workflow_id} evidence fixture mismatch")
    require(evidence.get("evidence_kind") == "export_zip", f"{workflow_id} evidence kind mismatch")
    require(evidence.get("status") == "pass", f"{workflow_id} evidence must pass")
    require(evidence.get("release_gate_check_id") == "local_alpha_e2e_workflow_smoke", f"{workflow_id} gate check mismatch")
    require(evidence.get("proves_running_local_stack") is True, f"{workflow_id} must prove running local stack")
    validate_local_stack_port(evidence, workflow_id)
    require(evidence.get("byte_size", 0) > 0, f"{workflow_id} must record non-empty ZIP bytes")
    require(not evidence.get("missing_payloads"), f"{workflow_id} evidence must have no missing payloads")

    payloads = set(evidence.get("payloads", []))
    required_payloads = set(item["required_zip_payloads"])
    require(required_payloads <= payloads, f"{workflow_id} evidence missing payloads: {sorted(required_payloads - payloads)}")
    require(
        required_payloads <= set(evidence.get("required_payloads", [])),
        f"{workflow_id} evidence required_payloads missing contract payloads",
    )

    manifest = evidence.get("manifest")
    require(isinstance(manifest, dict), f"{workflow_id} evidence must include manifest summary")
    acceptance = manifest.get("workflow_acceptance")
    require(isinstance(acceptance, dict), f"{workflow_id} manifest must include workflow acceptance")
    require(acceptance.get("workflow_id") == workflow_id, f"{workflow_id} manifest workflow mismatch")
    require(acceptance.get("fixture_id") == item["fixture_id"], f"{workflow_id} manifest fixture mismatch")
    require(acceptance.get("export_target") == "zip_delivery", f"{workflow_id} manifest export target mismatch")
    require(
        acceptance.get("strategy_taxonomy") == workflow["four_option_taxonomy"],
        f"{workflow_id} manifest taxonomy mismatch",
    )
    require(
        set(workflow["export_targets"][0]["required_files"]) <= set(acceptance.get("required_files", [])),
        f"{workflow_id} manifest required files incomplete",
    )
    require(
        manifest.get("item_count") == len(workflow["required_generated_assets"]),
        f"{workflow_id} manifest item count must match required generated assets",
    )

    qa_report = evidence.get("qa_report")
    require(isinstance(qa_report, dict), f"{workflow_id} evidence must include QA report summary")
    require(qa_report.get("blocking_count") == 0, f"{workflow_id} export evidence cannot have blocking QA")

    safety_report = evidence.get("safety_report")
    require(isinstance(safety_report, dict), f"{workflow_id} evidence must include safety report summary")
    require(safety_report.get("status") == "pass", f"{workflow_id} safety report must pass")
    require(set(safety_report.get("enforcement_stages", [])) == SAFETY_POINTS, f"{workflow_id} safety stages mismatch")

    metadata = evidence.get("metadata_payload")
    require(isinstance(metadata, dict), f"{workflow_id} evidence must include metadata payload summary")
    for field in ["provider", "model", "skill", "safety", "prompt_spec"]:
        require(field in metadata, f"{workflow_id} metadata missing {field}")
    require(metadata["skill"] == workflow_id, f"{workflow_id} metadata skill mismatch")
    require(metadata["prompt_spec"] == workflow["four_option_taxonomy"], f"{workflow_id} metadata taxonomy mismatch")

    trace = evidence.get("trace_provenance")
    require(isinstance(trace, dict), f"{workflow_id} evidence must include trace provenance")
    require(trace.get("workflow_id") == workflow_id, f"{workflow_id} trace workflow mismatch")
    require(trace.get("workflow_fixture_id") == item["fixture_id"], f"{workflow_id} trace fixture mismatch")


def validate_local_stack_port(evidence: dict[str, Any], workflow_id: str) -> None:
    local_stack = evidence.get("local_stack")
    require(isinstance(local_stack, dict), f"{workflow_id} evidence missing local_stack")
    parsed = urlparse(str(local_stack.get("web_base_url", "")))
    require(parsed.scheme == "http", f"{workflow_id} local stack must use http")
    require(parsed.hostname == "127.0.0.1", f"{workflow_id} local stack must bind 127.0.0.1")
    require(parsed.port == LOCAL_ALPHA_WEB_PORT, f"{workflow_id} local stack must use web port {LOCAL_ALPHA_WEB_PORT}")
    require(local_stack.get("assigned_web_port") == LOCAL_ALPHA_WEB_PORT, f"{workflow_id} evidence must record assigned web port")
    require(
        local_stack.get("web_playwright_port_env") == str(LOCAL_ALPHA_WEB_PORT),
        f"{workflow_id} evidence must record WEB_PLAYWRIGHT_PORT={LOCAL_ALPHA_WEB_PORT}",
    )
    require(
        str(LOCAL_ALPHA_WEB_PORT) in str(local_stack.get("web_server_contract", "")),
        f"{workflow_id} web server contract must name assigned port",
    )
    require(
        local_stack.get("worker_clone_root_rel") == LOCAL_ALPHA_WORKER_ROOT_REL,
        f"{workflow_id} evidence must record worker_clone_root_rel={LOCAL_ALPHA_WORKER_ROOT_REL!r}",
    )
    require("worker_clone_root" not in local_stack, f"{workflow_id} evidence must not commit absolute worker_clone_root paths")


def validate_summary(contract: dict[str, Any]) -> None:
    contracts = contract["workflow_export_contracts"]
    closed = [item for item in contracts if item["expected_runtime_status"] == "present_passed"]
    open_items = [item for item in contracts if item["expected_runtime_status"] == "missing_runtime_evidence"]
    summary = contract["summary"]
    require(summary["closed_export_evidence_count"] == len(closed), "closed summary count mismatch")
    require(summary["open_export_evidence_count"] == len(open_items), "open summary count mismatch")
    require(
        summary["open_workflows_remain_blocked"] == [item["workflow_id"] for item in open_items],
        "open workflow summary mismatch",
    )


def validate_workflow_export_zip_evidence_contract() -> None:
    contract = load_json(CONTRACT)
    validate_top_level(contract)
    workflows = {path.stem: load_json(path) for path in sorted(WORKFLOW_DIR.glob("*.json"))}
    require(set(workflows) == WORKFLOWS, f"workflow fixture set mismatch: {sorted(set(workflows) ^ WORKFLOWS)}")

    contracts = {item["workflow_id"]: item for item in contract["workflow_export_contracts"]}
    require(set(contracts) == WORKFLOWS, "contract workflow set mismatch")
    require(list(contracts) == WORKFLOW_ORDER, "contract workflow order mismatch")
    require(set(CHECKLIST_ITEMS) == {item["checklist_item_id"] for item in contracts.values()}, "checklist id set mismatch")

    for workflow_id in WORKFLOW_ORDER:
        item = contracts[workflow_id]
        workflow = workflows[workflow_id]
        validate_workflow_contract_shape(workflow_id, item, workflow)
        validate_runtime_evidence(item, workflow)
    validate_blueprint_state(contract)
    validate_summary(contract)


def main() -> int:
    try:
        validate_workflow_export_zip_evidence_contract()
    except WorkflowExportZipEvidenceContractError as exc:
        print(f"workflow export ZIP evidence contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("workflow export ZIP evidence contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
