#!/usr/bin/env python3
"""Validate Stage 0 Rev2 eval-before-activation gate contracts."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
CONTRACT = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "activation_gate_contract.json"
EVAL_RESULTS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "starter_eval_results.json"
CRAWLER = ROOT / "fixtures" / "stage0" / "rev2" / "crawler" / "crawler_governance_cases.json"
FEEDBACK = ROOT / "fixtures" / "stage0" / "rev2" / "feedback" / "feedback_events.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"

EXPECTED_GATE_IDS = {
    "skill_version_canary_requires_eval_pass",
    "skill_version_active_requires_eval_pass",
    "prompt_fragment_active_requires_eval_pass",
}

CANARY_STATUSES = {"internal_canary", "allowlist_canary", "percent_canary"}
ACTIVE_STATUS = {"active"}
REQUIRED_EVAL_COLUMNS = {
    "id",
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "status",
    "summary",
    "created_at",
}


class ActivationGateContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ActivationGateContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ActivationGateContractError(message)


def schema_block(openapi_text: str, schema_name: str) -> str:
    match = re.search(
        rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(match is not None, f"OpenAPI schema {schema_name} missing")
    return match.group("body")


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


def validate_gate_shape(contract: dict[str, Any]) -> None:
    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "contract must cite Rev2")
    gates = {gate["gate_id"]: gate for gate in contract["gates"]}
    require(set(gates) == EXPECTED_GATE_IDS, f"activation gates mismatch: {sorted(set(gates) ^ EXPECTED_GATE_IDS)}")

    skill_canary = gates["skill_version_canary_requires_eval_pass"]
    require(skill_canary["subject_type"] == "skill_version", "skill canary gate must target skill_version")
    require(set(skill_canary["target_statuses"]) == CANARY_STATUSES, "skill canary gate must cover every canary status")

    skill_active = gates["skill_version_active_requires_eval_pass"]
    require(skill_active["subject_type"] == "skill_version", "skill active gate must target skill_version")
    require(set(skill_active["target_statuses"]) == ACTIVE_STATUS, "skill active gate must target active status")

    prompt_active = gates["prompt_fragment_active_requires_eval_pass"]
    require(prompt_active["subject_type"] == "prompt_fragment", "prompt active gate must target prompt_fragment")
    require(set(prompt_active["target_statuses"]) == ACTIVE_STATUS, "prompt active gate must target active status")

    for gate in gates.values():
        required = gate["required_eval_result"]
        require(required["table"] == "eval_results", f"{gate['gate_id']} must require eval_results")
        require(required["subject_type"] == gate["subject_type"], f"{gate['gate_id']} eval subject mismatch")
        require(required["status"] == "pass", f"{gate['gate_id']} must require pass status")
        summary = required["summary_requires"]
        require(summary["golden_passed"] is True, f"{gate['gate_id']} must require golden pass")
        require(summary["critical_safety_regressions"] == 0, f"{gate['gate_id']} must require zero critical safety regressions")
        require(summary["trace_complete"] is True, f"{gate['gate_id']} must require trace completeness")
        require(summary["export_contract_complete"] is True, f"{gate['gate_id']} must require export completeness")
        require(gate["activation_allowed_without_passing_eval"] is False, f"{gate['gate_id']} must deny eval bypass")


def validate_storage_and_openapi(contract: dict[str, Any]) -> None:
    migration = MIGRATION.read_text(encoding="utf-8")
    openapi = OPENAPI.read_text(encoding="utf-8")
    eval_result = schema_block(openapi, "EvalResult")
    skill_version = schema_block(openapi, "SkillVersion")
    prompt_fragment = schema_block(openapi, "PromptFragment")

    storage = contract["storage_contract"]
    require(set(storage["required_columns"]) == REQUIRED_EVAL_COLUMNS, "activation storage columns mismatch")
    require("CREATE TABLE IF NOT EXISTS eval_results" in migration, "eval_results table missing")
    require("tenant_id text NOT NULL REFERENCES tenants(id)" in migration, "eval_results must be tenant scoped")
    require("subject_type text NOT NULL" in migration, "eval_results missing subject_type")
    require("subject_id text NOT NULL" in migration, "eval_results missing subject_id")
    require("status text NOT NULL" in migration, "eval_results missing status")
    require("summary jsonb NOT NULL" in migration, "eval_results missing summary jsonb")

    for token in [
        "CREATE TABLE IF NOT EXISTS skill_versions",
        "status text NOT NULL DEFAULT 'review'",
        "eval_suite_id text",
        "CREATE TABLE IF NOT EXISTS prompt_fragments",
        "status text NOT NULL DEFAULT 'draft'",
    ]:
        require(token in migration, f"migration missing activation token {token}")

    for token in [
        "skill_version",
        "prompt_fragment",
        "eligible_for_canary",
        "eligible_for_active",
        "blocked",
        "critical_safety_regressions",
        "trace_complete",
        "export_contract_complete",
    ]:
        require(token in eval_result, f"OpenAPI EvalResult missing activation token {token}")
    require("eval_suite_id" in skill_version, "OpenAPI SkillVersion must expose eval_suite_id")
    require("release_gate" in skill_version, "OpenAPI SkillVersion must expose release_gate")
    require("release_gate" in prompt_fragment, "OpenAPI PromptFragment must expose release_gate")


def validate_eval_result_blocks_when_not_passed() -> None:
    results = load_json(EVAL_RESULTS)
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result = results[0]
    summary = result["summary"]
    require(result["status"] == "blocked", "current starter eval result must remain blocked until all blocking fixtures pass")
    require(
        result["subject"]["candidate_status_after_eval"] == "blocked",
        "blocked eval result must not mark subject eligible for canary or active",
    )
    require(summary["critical_safety_regressions"] == 0, "activation gate requires zero critical safety regressions")
    require(summary["trace_complete"] is True, "activation gate requires complete traces")
    require(summary["export_contract_complete"] is True, "activation gate requires export completeness")
    require(summary["blocked_fixtures"] > 0, "blocked starter eval result must include blocked fixtures")


def validate_bypass_policy(contract: dict[str, Any]) -> None:
    policy = contract["bypass_policy"]
    require(policy["crawler_feedback_direct_activation_allowed"] is False, "crawler/feedback bypass must be denied")
    require(policy["blocked_eval_result_allows_activation"] is False, "blocked eval results must deny activation")
    require(policy["critical_safety_regression_allows_activation"] is False, "critical safety regression bypass must be denied")

    for case in load_json(CRAWLER):
        require(
            case["import_governance"]["direct_activation_allowed"] is False,
            f"{case['fixture_id']} crawler case must deny direct activation",
        )
    for event in load_json(FEEDBACK):
        require(
            event["governance"]["may_activate_prompt_or_skill_directly"] is False,
            f"{event['event_id']} feedback event must deny direct activation",
        )


def validate_blueprint_policy() -> None:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked = checked_items(text)
    unchecked = unchecked_items(text)
    completed = {
        "skill canary 前要求 eval pass。",
        "prompt fragment active 前要求 eval pass。",
    }
    for item in completed:
        require(item in checked, f"blueprint checklist must mark {item} complete after contract validation")
        require(item not in unchecked, f"blueprint checklist must not leave {item} unchecked")
    require(
        "在 brief/provider request/provider response/QA/export 运行 safety policy。" in unchecked,
        "safety runtime policy must remain unchecked until runtime enforcement is validated",
    )


def main() -> int:
    try:
        contract = load_json(CONTRACT)
        validate_gate_shape(contract)
        validate_storage_and_openapi(contract)
        validate_eval_result_blocks_when_not_passed()
        validate_bypass_policy(contract)
        validate_blueprint_policy()
    except ActivationGateContractError as exc:
        print(f"activation gate contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("activation gate contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
