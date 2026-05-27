#!/usr/bin/env python3
"""Validate Stage 0 Rev2 workflow safety coverage links."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
WORKFLOW_DIR = FIXTURE_DIR / "workflows"
EVAL_DIR = FIXTURE_DIR / "eval"
CONTRACT = EVAL_DIR / "workflow_safety_coverage_contract.json"
SAFETY_RULES = EVAL_DIR / "safety_rules.json"
EVAL_RESULTS = EVAL_DIR / "starter_eval_results.json"
TRACE_COMPLETENESS = EVAL_DIR / "trace_completeness.json"

REQUIRED_ENFORCEMENT_POINTS = [
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
]

REQUIRED_WORKFLOWS = {
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
}

SAFETY_EXPORT_GATE_EFFECT = {
    "allow": "allow_when_export_contract_complete",
    "warn": "allow_with_warning",
    "require_user_confirmation": "hold_until_user_confirmation",
    "require_admin_review": "hold_until_admin_review",
    "block": "block_final_export",
}


class WorkflowSafetyCoverageError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowSafetyCoverageError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise WorkflowSafetyCoverageError(message)


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    safety_rules = load_json(SAFETY_RULES)
    eval_results = load_json(EVAL_RESULTS)
    trace_contract = load_json(TRACE_COMPLETENESS)
    workflows = {
        path.stem: load_json(path)
        for path in sorted(WORKFLOW_DIR.glob("*.json"))
    }

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "contract must cite Rev2")
    require(set(contract["required_enforcement_points"]) == set(REQUIRED_ENFORCEMENT_POINTS), "enforcement points mismatch")
    require(set(workflows) == REQUIRED_WORKFLOWS, "workflow fixture set mismatch")
    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")

    rule_by_id = {rule["rule_id"]: rule for rule in safety_rules}
    require(len(rule_by_id) == len(safety_rules), "safety rule ids must be unique")
    for rule in safety_rules:
        require(
            rule["enforcement_points"] == REQUIRED_ENFORCEMENT_POINTS,
            f"{rule['rule_id']} must cover every Rev2 enforcement point in order",
        )

    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    trace_by_id = {item["trace_id"]: item for item in trace_contract["traces"]}
    trace_by_fixture = {item["fixture_id"]: item for item in trace_contract["traces"]}

    workflow_contracts = {item["workflow_id"]: item for item in contract["workflow_contracts"]}
    require(set(workflow_contracts) == REQUIRED_WORKFLOWS, "contract must cover each workflow once")
    require(len(workflow_contracts) == len(contract["workflow_contracts"]), "duplicate workflow safety contracts")

    for workflow_id, workflow_contract in workflow_contracts.items():
        validate_workflow_contract(
            workflow_id,
            workflow_contract,
            workflows[workflow_id],
            rule_by_id,
            eval_by_fixture,
            trace_by_id,
            trace_by_fixture,
        )

    policy = contract["export_gate_policy"]
    require(policy["block_action_blocks_final_export"] is True, "safety block export policy must be explicit")
    require(
        policy["warn_action_allows_only_with_complete_export_and_qa"] is True,
        "warn export policy must require complete QA/export gates",
    )
    require(policy["user_confirmation_holds_final_export"] is True, "user confirmation hold policy must be explicit")
    require(policy["admin_review_holds_final_export"] is True, "admin review hold policy must be explicit")
    require(policy["all_safety_decisions_are_trace_linked"] is True, "trace-linked safety policy must be explicit")


def validate_workflow_contract(
    workflow_id: str,
    workflow_contract: dict[str, Any],
    workflow: dict[str, Any],
    rule_by_id: dict[str, dict[str, Any]],
    eval_by_fixture: dict[str, dict[str, Any]],
    trace_by_id: dict[str, dict[str, Any]],
    trace_by_fixture: dict[str, dict[str, Any]],
) -> None:
    expected_path = f"fixtures/stage0/rev2/workflows/{workflow_id}.json"
    required_checks = workflow["required_safety_checks"]
    domain_contract = workflow["domain_acceptance_contract"]

    require(workflow["workflow_id"] == workflow_id, f"{workflow_id} workflow fixture id mismatch")
    require(workflow_contract["acceptance_fixture"] == expected_path, f"{workflow_id} acceptance fixture path mismatch")
    require(
        workflow_contract["required_enforcement_points"] == REQUIRED_ENFORCEMENT_POINTS,
        f"{workflow_id} contract must require all enforcement points",
    )
    require(
        required_checks["enforcement_points"] == REQUIRED_ENFORCEMENT_POINTS,
        f"{workflow_id} workflow fixture must require all enforcement points",
    )
    require(
        set(workflow_contract["required_safety_domains"]) == set(required_checks["linked_rule_domains"]),
        f"{workflow_id} contract safety domains must match workflow required_safety_checks",
    )
    require(
        set(workflow_contract["required_safety_domains"]) == set(domain_contract["required_safety_domains"]),
        f"{workflow_id} contract safety domains must match domain acceptance contract",
    )

    linked_rule_ids = [item["rule_id"] for item in workflow_contract["linked_rules"]]
    require(len(linked_rule_ids) == len(set(linked_rule_ids)), f"{workflow_id} linked rules must be unique")
    linked_domains = {item["domain"] for item in workflow_contract["linked_rules"]}
    require(
        set(workflow_contract["required_safety_domains"]) <= linked_domains,
        f"{workflow_id} linked rules do not cover declared domains",
    )

    acceptance_linked_fixtures = set(required_checks["linked_eval_fixtures"])
    example_fixtures = {item["fixture_id"] for item in workflow_contract["coverage_examples"]}
    require(
        acceptance_linked_fixtures <= example_fixtures,
        f"{workflow_id} coverage examples must include every acceptance-linked safety fixture",
    )

    rule_fixture_links: set[str] = set()
    for linked_rule in workflow_contract["linked_rules"]:
        rule_id = linked_rule["rule_id"]
        require(rule_id in rule_by_id, f"{workflow_id} links unknown safety rule {rule_id}")
        rule = rule_by_id[rule_id]
        require(rule["domain"] == linked_rule["domain"], f"{workflow_id} {rule_id} domain mismatch")
        require(rule["action"] == linked_rule["action"], f"{workflow_id} {rule_id} action mismatch")
        require(rule["severity"] == linked_rule["severity"], f"{workflow_id} {rule_id} severity mismatch")
        require(
            rule["admin_override_eligible"] is linked_rule["admin_override_eligible"],
            f"{workflow_id} {rule_id} override eligibility mismatch",
        )
        require(rule["audit_required"] is linked_rule["audit_required"] is True, f"{workflow_id} {rule_id} must require audit")
        require(
            rule["enforcement_points"] == workflow_contract["required_enforcement_points"],
            f"{workflow_id} {rule_id} enforcement point mismatch",
        )
        require(
            set(linked_rule["eval_fixture_ids"]) <= set(rule["eval_fixture_links"]),
            f"{workflow_id} {rule_id} cites fixtures not linked from safety rule",
        )
        rule_fixture_links.update(linked_rule["eval_fixture_ids"])

    require(
        acceptance_linked_fixtures <= rule_fixture_links,
        f"{workflow_id} acceptance safety fixture links are not covered by linked rules",
    )

    for example in workflow_contract["coverage_examples"]:
        validate_coverage_example(
            workflow_id,
            example,
            linked_rule_ids,
            eval_by_fixture,
            trace_by_id,
            trace_by_fixture,
        )


def validate_coverage_example(
    workflow_id: str,
    example: dict[str, Any],
    linked_rule_ids: list[str],
    eval_by_fixture: dict[str, dict[str, Any]],
    trace_by_id: dict[str, dict[str, Any]],
    trace_by_fixture: dict[str, dict[str, Any]],
) -> None:
    fixture_id = example["fixture_id"]
    trace_id = example["trace_id"]
    expected_rules = example["expected_source_rule_ids"]

    require(fixture_id in eval_by_fixture, f"{workflow_id} example references unknown eval fixture {fixture_id}")
    require(trace_id in trace_by_id, f"{workflow_id} example references unknown trace {trace_id}")
    require(fixture_id in trace_by_fixture, f"{workflow_id} example fixture missing trace completeness record")
    require(set(expected_rules) <= set(linked_rule_ids), f"{workflow_id} example cites rule outside workflow contract")

    result = eval_by_fixture[fixture_id]
    trace = trace_by_id[trace_id]
    decision = result["safety_decision_contract"]
    gate = result["qa_export_gate"]

    require(result["workflow"] == example["fixture_workflow"], f"{workflow_id} example eval workflow mismatch")
    require(trace["workflow"] == example["fixture_workflow"], f"{workflow_id} example trace workflow mismatch")
    require(result["trace_contract"]["trace_id"] == trace_id, f"{workflow_id} example eval trace mismatch")
    require(trace["fixture_id"] == fixture_id, f"{workflow_id} example trace fixture mismatch")
    require(trace_by_fixture[fixture_id]["trace_id"] == trace_id, f"{workflow_id} example fixture trace mismatch")

    require(decision["decision"] == example["expected_decision"], f"{workflow_id} {fixture_id} safety decision mismatch")
    require(result["observed_safety_action"] == example["expected_decision"], f"{workflow_id} {fixture_id} observed action mismatch")
    require(decision["source_rule_ids"] == expected_rules, f"{workflow_id} {fixture_id} source rule mismatch")
    require(decision["enforcement_points"] == REQUIRED_ENFORCEMENT_POINTS, f"{workflow_id} {fixture_id} decision point mismatch")
    require(decision["trace_status_required"] is True, f"{workflow_id} {fixture_id} must require trace status")
    require(decision["persisted_decision_required"] is True, f"{workflow_id} {fixture_id} must require persisted decisions")
    require(decision["audit_required"] is bool(expected_rules), f"{workflow_id} {fixture_id} audit requirement mismatch")
    require(
        decision["export_gate_effect"] == example["expected_export_gate_effect"],
        f"{workflow_id} {fixture_id} export gate effect mismatch",
    )
    require(
        decision["export_gate_effect"] == SAFETY_EXPORT_GATE_EFFECT[decision["decision"]],
        f"{workflow_id} {fixture_id} export gate effect does not match safety action",
    )

    require(gate["final_export_allowed"] is example["expected_final_export_allowed"], f"{workflow_id} {fixture_id} final export mismatch")
    require(gate["safety_blocks_export"] is example["expected_safety_blocks_export"], f"{workflow_id} {fixture_id} safety block mismatch")
    require(gate["denial_reasons"] == example["expected_denial_reasons"], f"{workflow_id} {fixture_id} denial reasons mismatch")
    if decision["decision"] == "block":
        require(gate["safety_blocks_export"] is True, f"{workflow_id} {fixture_id} block action must block export")
        require("safety_policy_block" in gate["denial_reasons"], f"{workflow_id} {fixture_id} block action must cite safety policy")
    if decision["decision"] == "require_user_confirmation":
        require("safety_user_confirmation_required" in gate["denial_reasons"], f"{workflow_id} {fixture_id} must cite confirmation hold")
    if decision["decision"] == "require_admin_review":
        require("safety_admin_review_required" in gate["denial_reasons"], f"{workflow_id} {fixture_id} must cite admin review hold")

    require(trace["covered_steps"] == REQUIRED_ENFORCEMENT_POINTS, f"{workflow_id} {fixture_id} trace step coverage mismatch")
    require(
        [event["step_name"] for event in trace["step_events"]] == REQUIRED_ENFORCEMENT_POINTS,
        f"{workflow_id} {fixture_id} trace event order mismatch",
    )
    for event in trace["step_events"]:
        safety_ref = event["safety_decision_ref"]
        require(safety_ref["table"] == "safety_decisions", f"{workflow_id} {fixture_id} safety ref table mismatch")
        require(safety_ref["enforcement_point"] == event["step_name"], f"{workflow_id} {fixture_id} safety ref point mismatch")
        require(safety_ref["decision"] == decision["decision"], f"{workflow_id} {fixture_id} safety ref decision mismatch")
        require(safety_ref["source_rule_ids"] == expected_rules, f"{workflow_id} {fixture_id} safety ref rule mismatch")
        require(safety_ref["audit_required"] is decision["audit_required"], f"{workflow_id} {fixture_id} safety ref audit mismatch")

    for key in ["qa_report", "trace_provenance", "safety_disclaimer_when_applicable"]:
        require(trace["export_references"][key] is True, f"{workflow_id} {fixture_id} trace export reference {key} missing")


def main() -> int:
    try:
        validate_contract()
    except WorkflowSafetyCoverageError as exc:
        print(f"Workflow safety coverage validation failed: {exc}", file=sys.stderr)
        return 1
    print("Workflow safety coverage validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
