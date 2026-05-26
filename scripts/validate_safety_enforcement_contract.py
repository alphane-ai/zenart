#!/usr/bin/env python3
"""Validate the Stage 0 Rev2 safety enforcement contract fixture."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
CONTRACT = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "safety_enforcement_contract.json"
SAFETY_RULES = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "safety_rules.json"
EVAL_SUITE = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "starter_eval_suite.json"
EVAL_RESULTS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "starter_eval_results.json"
QA_RESULTS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "qa_results.json"
TRACE_COMPLETENESS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "trace_completeness.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"
STAGE0_SERVICE = ROOT / "backend" / "internal" / "stage0" / "services.go"
STAGE0_TEST = ROOT / "backend" / "internal" / "stage0" / "services_test.go"

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

SAFETY_ACTIONS = {
    "allow",
    "warn",
    "require_user_confirmation",
    "require_admin_review",
    "block",
}

ACTION_EXPORT_GATES = {
    "allow": "allow_when_export_contract_complete",
    "warn": "allow_with_warning",
    "require_user_confirmation": "hold_until_user_confirmation",
    "require_admin_review": "hold_until_admin_review",
    "block": "block_final_export",
}


class SafetyContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SafetyContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SafetyContractError(message)


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


def validate_fixture_links(contract: dict[str, Any]) -> None:
    suite = load_json(EVAL_SUITE)
    results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)
    rules = load_json(SAFETY_RULES)

    fixture_by_id = {fixture["fixture_id"]: fixture for fixture in suite["fixtures"]}
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result_by_fixture = {item["fixture_id"]: item for item in results[0]["fixture_results"]}
    qa_by_fixture: dict[str, list[dict[str, Any]]] = {}
    for item in qa_results:
        qa_by_fixture.setdefault(item["evidence"]["fixture_id"], []).append(item)

    linked_fixtures = {item["fixture_id"] for item in contract["fixture_links"]}
    rule_fixtures = set().union(*(set(rule["eval_fixture_links"]) for rule in rules))
    require(linked_fixtures <= rule_fixtures, f"safety contract fixture links missing rule refs: {sorted(linked_fixtures - rule_fixtures)}")

    for link in contract["fixture_links"]:
        fixture_id = link["fixture_id"]
        require(fixture_id in fixture_by_id, f"safety contract references unknown fixture {fixture_id}")
        require(fixture_id in result_by_fixture, f"safety contract fixture {fixture_id} missing eval result")
        require(set(link["required_enforcement_points"]) == SAFETY_POINTS, f"{fixture_id} must require all safety points")

        expected_action = link["expected_safety_action"]
        fixture_action = fixture_by_id[fixture_id]["expected_evidence"]["expected_safety_action"]
        result_action = result_by_fixture[fixture_id]["observed_safety_action"]
        if expected_action == "require_admin_review":
            matching_rules = [
                rule for rule in rules if fixture_id in rule["eval_fixture_links"]
            ]
            require(
                any(rule["action"] == "require_admin_review" for rule in matching_rules),
                f"{fixture_id} must link to a require_admin_review safety rule",
            )
        else:
            require(fixture_action == expected_action, f"{fixture_id} expected action mismatch in eval suite")
            require(result_action == expected_action, f"{fixture_id} observed action mismatch in eval result")

        if link["must_block_final_export"]:
            result = result_by_fixture[fixture_id]
            require(result["status"] == "blocked", f"{fixture_id} must be blocked in eval results")
            require(result["export_contract"]["blocks_when_incomplete"] is True, f"{fixture_id} must block incomplete export")
            if fixture_id in qa_by_fixture:
                require(
                    any(item["export_gate"]["blocks_final_export"] is True for item in qa_by_fixture[fixture_id]),
                    f"{fixture_id} linked QA result must block final export",
                )


def validate_openapi_and_storage_contract(contract: dict[str, Any]) -> None:
    openapi = OPENAPI.read_text(encoding="utf-8")
    migration = MIGRATION.read_text(encoding="utf-8")
    service = STAGE0_SERVICE.read_text(encoding="utf-8")
    tests = STAGE0_TEST.read_text(encoding="utf-8")

    safety_rule = schema_block(openapi, "SafetyRule")
    safety_create = schema_block(openapi, "SafetyDecisionCreate")
    safety_decision = schema_block(openapi, "SafetyDecision")
    trace = schema_block(openapi, "AgentTrace")

    require("operationId: createSafetyDecision" in openapi, "OpenAPI must expose createSafetyDecision")
    require("x-idempotency-required: true" in openapi, "createSafetyDecision must require idempotency")
    for point in SAFETY_POINTS:
        for body_name, body in {
            "SafetyRule": safety_rule,
            "SafetyDecisionCreate": safety_create,
            "AgentTrace": trace,
        }.items():
            require(point in body, f"OpenAPI {body_name} missing enforcement point {point}")
    for field in ["tenant_id", "rule_id", "subject_type", "subject_id", "enforcement_point", "decision", "rationale"]:
        require(f"{field}:" in safety_decision, f"SafetyDecision schema missing {field}")

    storage = contract["decision_storage_contract"]
    require(f"CREATE TABLE IF NOT EXISTS {storage['table']}" in migration, "safety decision table missing")
    for column in storage["required_columns"]:
        require(column in migration, f"safety_decisions storage missing {column}")
    require("tenant_id text NOT NULL REFERENCES tenants(id)" in migration, "safety_decisions must be tenant scoped")
    require("rationale text NOT NULL" in migration, "safety_decisions must persist rationale")
    require("idx_safety_decisions_subject" in migration, "safety decisions must be subject-indexed")

    for token in [
        "func (r Repository) EnforceSafety",
        "func (r Repository) RequireSafetyAllowed",
        "func (r Repository) findActiveSafetyRule",
        "INSERT INTO safety_decisions",
        "EnforcementPoint",
        "Decision",
        "Rationale",
    ]:
        require(token in service, f"backend safety enforcement implementation missing {token}")
    for token in [
        "func (r Repository) CreateExport",
        "func (r Repository) RegenerateExport",
        "func (r Repository) RecordExportArtifact",
        "hasBlockingExportQA",
        "ErrSafetyBlocked",
    ]:
        require(token in service, f"export safety/QA block implementation missing {token}")
    for point in SAFETY_POINTS:
        require(f'SafetyPoint{_go_const_suffix(point)}' in service, f"backend safety point const missing {point}")
    for token in [
        "EnforceBriefSafety",
        "EnforceProviderRequestSafety",
        "EnforceProviderResponseSafety",
        "EnforceQASafety",
        "EnforceExportSafety",
    ]:
        require(token in service, f"backend safety enforcement helper missing {token}")
    baseline_tokens = [
        "TestEnforceSafetyRecordsBlockDecisionForActiveRule",
        "TestSafetyEnforcementHelpersCoverRev2RuntimePoints",
        "TestCreateExportBlocksWhenQAHasBlockingResult",
        "TestCreateExportBlocksWhenExportSafetyRuleBlocks",
        "TestRecordExportArtifactBlocksWhenExportSafetyRuleBlocks",
    ]
    for token in baseline_tokens:
        require(token in tests, f"backend safety contract test missing {token}")

    policy = contract["release_gate_policy"]
    runtime_tokens = [
        "ErrSafetyReviewHold",
        'case "require_user_confirmation", "require_admin_review"',
        "TestEnforceSafetyRecordsWarnConfirmationAndAdminReviewDecisions",
        "TestRequireSafetyAllowedHoldsForConfirmationAndAdminReview",
    ]
    if policy["runtime_enforcement_validated"]:
        require(
            "findBlockingRule" not in service,
            "validated safety runtime must evaluate every active action, not block-only rules",
        )
        for token in runtime_tokens[:2]:
            require(token in service, f"validated safety runtime missing {token}")
        for token in runtime_tokens[2:]:
            require(token in tests, f"validated safety runtime test missing {token}")
    else:
        require(
            "findBlockingRule" in service,
            "evidence-only safety contract must keep runtime checklist open while backend is block-only",
        )


def validate_cross_contracts(contract: dict[str, Any]) -> None:
    rules = load_json(SAFETY_RULES)
    traces = load_json(TRACE_COMPLETENESS)
    results = load_json(EVAL_RESULTS)
    suite = load_json(EVAL_SUITE)
    fixture_by_id = {fixture["fixture_id"]: fixture for fixture in suite["fixtures"]}
    rule_by_id = {rule["rule_id"]: rule for rule in rules}

    require(set(contract["required_enforcement_points"]) == SAFETY_POINTS, "contract required enforcement points mismatch")
    runtime_points = {item["enforcement_point"] for item in contract["runtime_contracts"]}
    require(runtime_points == SAFETY_POINTS, f"runtime contracts missing points: {sorted(SAFETY_POINTS - runtime_points)}")
    for item in contract["runtime_contracts"]:
        require(set(item["required_decision_actions"]) == SAFETY_ACTIONS, f"{item['enforcement_point']} must list every decision action")
        require(item["trace_status_required"] is True, f"{item['enforcement_point']} must require trace safety status")
        require(item["blocks_export_when_blocking"] is True, f"{item['enforcement_point']} must block export when blocking")
        require(item["openapi_operation"] == "createSafetyDecision", f"{item['enforcement_point']} must cite createSafetyDecision")

    for rule in rules:
        require(set(rule["enforcement_points"]) == SAFETY_POINTS, f"{rule['rule_id']} must cover all safety points")
        if rule["severity"] == "critical":
            require(rule["action"] == "block", f"{rule['rule_id']} critical rules must block")
            require(rule["admin_override_eligible"] is False, f"{rule['rule_id']} critical rules must not allow admin override")
        require(rule["audit_required"] is True, f"{rule['rule_id']} safety decisions must require audit")

    matrix_points = {item["enforcement_point"] for item in contract["decision_matrix"]}
    require(matrix_points == SAFETY_POINTS, f"decision matrix missing points: {sorted(SAFETY_POINTS - matrix_points)}")
    for item in contract["decision_matrix"]:
        actions = item["actions"]
        decisions = {action["decision"] for action in actions}
        require(decisions == SAFETY_ACTIONS, f"{item['enforcement_point']} decision matrix must cover every action")
        for action in actions:
            decision = action["decision"]
            fixture_id = action["source_fixture_id"]
            rule_id = action["source_rule_id"]
            require(fixture_id in fixture_by_id, f"{item['enforcement_point']} {decision} references unknown fixture {fixture_id}")
            require(action["export_gate"] == ACTION_EXPORT_GATES[decision], f"{item['enforcement_point']} {decision} export gate mismatch")
            require(action["requires_trace_safety_status"] is True, f"{item['enforcement_point']} {decision} must require trace safety status")
            require(action["requires_persisted_decision"] is True, f"{item['enforcement_point']} {decision} must require persisted decision")
            if decision == "allow":
                require(rule_id == "default_no_match", f"{item['enforcement_point']} allow decision must use default_no_match")
                require(action["requires_audit"] is False, f"{item['enforcement_point']} allow decision must not require audit")
            else:
                require(rule_id in rule_by_id, f"{item['enforcement_point']} {decision} references unknown safety rule {rule_id}")
                rule = rule_by_id[rule_id]
                require(rule["action"] == decision, f"{rule_id} action must match decision matrix {decision}")
                require(fixture_id in rule["eval_fixture_links"], f"{rule_id} must link fixture {fixture_id}")
                require(action["requires_audit"] is True, f"{item['enforcement_point']} {decision} must require audit")
                require(item["enforcement_point"] in rule["enforcement_points"], f"{rule_id} missing matrix enforcement point {item['enforcement_point']}")

    require(set(traces["required_pipeline_steps"]) == SAFETY_POINTS, "trace contract pipeline steps must match safety enforcement points")
    for trace in traces["traces"]:
        require(trace["safety_status"]["present"] is True, f"{trace['trace_id']} must include safety status")
        require(set(trace["covered_steps"]) == SAFETY_POINTS, f"{trace['trace_id']} must cover every safety step")

    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    summary = results[0]["summary"]
    require(set(summary["safety_enforcement_points_covered"]) == SAFETY_POINTS, "eval result summary must cover every safety point")
    require(summary["critical_safety_regressions"] == 0, "eval result must have no critical safety regressions")
    for result in results[0]["fixture_results"]:
        require(result["trace_contract"]["has_safety_status"] is True, f"{result['fixture_id']} trace must include safety status")


def validate_release_policy(contract: dict[str, Any]) -> None:
    blueprint = BLUEPRINT.read_text(encoding="utf-8")
    checked = checked_items(blueprint)
    unchecked = unchecked_items(blueprint)
    item = "在 brief/provider request/provider response/QA/export 运行 safety policy。"

    policy = contract["release_gate_policy"]
    runtime_validated = policy["runtime_enforcement_validated"]
    if runtime_validated:
        require(policy["contract_evidence_only"] is False, "validated safety runtime must not be evidence-only")
        require(policy["blueprint_runtime_item_remains_open"] is False, "validated safety runtime must allow checklist closure")
        require(item in checked, "safety runtime checklist item must be checked after backend runtime enforcement")
        require(item not in unchecked, "safety runtime checklist item must not remain open after backend runtime enforcement")
    else:
        require(policy["contract_evidence_only"] is True, "unvalidated safety runtime must remain evidence-only")
        require(policy["blueprint_runtime_item_remains_open"] is True, "unvalidated safety runtime must keep checklist open")
        require(item in unchecked, "safety runtime checklist item must remain open until runtime evidence passes")
        require(item not in checked, "safety runtime checklist item must not be checked before runtime evidence passes")


def _go_const_suffix(point: str) -> str:
    if point == "qa":
        return "QA"
    return "".join(part.title() for part in point.split("_"))


def main() -> int:
    try:
        contract = load_json(CONTRACT)
        require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "contract must cite Rev2 blueprint")
        validate_cross_contracts(contract)
        validate_fixture_links(contract)
        validate_openapi_and_storage_contract(contract)
        validate_release_policy(contract)
    except SafetyContractError as exc:
        print(f"safety enforcement contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("safety enforcement contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
