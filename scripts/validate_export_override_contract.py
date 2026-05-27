#!/usr/bin/env python3
"""Validate Stage 0 Rev2 export override gate contracts."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
CONTRACT = FIXTURE_DIR / "export_override_contract.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"
EVAL_RESULTS = FIXTURE_DIR / "starter_eval_results.json"
TRACE_COMPLETENESS = FIXTURE_DIR / "trace_completeness.json"
SAFETY_RULES = FIXTURE_DIR / "safety_rules.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
REPLAY_RUNNER = ROOT / "scripts" / "run_export_override_contract.py"

SOURCE_TYPES = {"qa_result", "safety_decision", "export_contract"}
OUTCOMES = {"approved", "denied"}
DENIAL_REASONS = {
    "source_not_override_eligible",
    "critical_safety_rule",
    "incomplete_export_artifacts",
    "missing_approval_audit",
}
ADMIN_ROLES = {"admin_reviewer", "admin_superadmin"}


class ExportOverrideContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ExportOverrideContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ExportOverrideContractError(message)


def schema_block(openapi_text: str, schema_name: str) -> str:
    match = re.search(
        rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(match is not None, f"OpenAPI schema {schema_name} missing")
    return match.group("body")


def require_field_in_schema(body: str, schema_name: str, field: str) -> None:
    require(f"{field}:" in body, f"OpenAPI schema {schema_name} missing {field}")
    require(
        re.search(rf"required: \[[^\]]*\b{re.escape(field)}\b", body)
        or re.search(rf"^\s+- {re.escape(field)}$", body, flags=re.MULTILINE),
        f"OpenAPI schema {schema_name} must require {field}",
    )


def operation_block(openapi_text: str, path: str, operation_id: str) -> str:
    path_block = re.search(
        rf"^  {re.escape(path)}:\n(?P<body>.*?)(?=^  /|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(path_block is not None, f"OpenAPI path {path} missing")
    body = path_block.group("body")
    require(f"operationId: {operation_id}" in body, f"OpenAPI path {path} missing {operation_id}")
    return body


def validate_openapi(contract: dict[str, Any]) -> None:
    openapi = OPENAPI.read_text(encoding="utf-8")
    openapi_contract = contract["openapi_contract"]
    block = operation_block(openapi, openapi_contract["path"], openapi_contract["operation_id"])
    require("x-rbac: admin" in block, "export override operation must be admin-only")
    require("x-idempotency-required: true" in block, "export override operation must require idempotency")
    require("IdempotencyKey" in block, "export override operation must accept idempotency key")
    require("ExportId" in block, "export override operation must bind export_id")
    require("ExportOverrideCreate" in block, "export override operation must use request schema")
    require("ExportOverrideDecision" in block, "export override operation must use response schema")
    require('$ref: "#/components/responses/Error"' in block, "export override operation must use shared Error response")

    request = schema_block(openapi, "ExportOverrideCreate")
    response = schema_block(openapi, "ExportOverrideDecision")
    for field in [
        "source_type",
        "source_id",
        "trace_id",
        "decision",
        "rationale",
    ]:
        require_field_in_schema(request, "ExportOverrideCreate", field)
    for field in [
        "id",
        "tenant_id",
        "export_id",
        "source_type",
        "source_id",
        "trace_id",
        "requested_by_role",
        "resolved_by_role",
        "outcome",
        "denial_reason",
        "source_gate_resolved",
        "final_export_allowed",
        "audit_log_id",
        "created_at",
    ]:
        require_field_in_schema(response, "ExportOverrideDecision", field)
    for token in SOURCE_TYPES | OUTCOMES | DENIAL_REASONS | ADMIN_ROLES:
        require(token in request or token in response, f"OpenAPI override schema missing {token}")


def qa_result_outcome(item: dict[str, Any]) -> str:
    if item["export_gate"]["blocks_final_export"] is True:
        return "block"
    if item["severity"] == "warning":
        return "warn"
    return "pass"


def validate_decision_links(contract: dict[str, Any]) -> None:
    qa_results = load_json(QA_RESULTS)
    eval_results = load_json(EVAL_RESULTS)
    traces = load_json(TRACE_COMPLETENESS)
    safety_rules = load_json(SAFETY_RULES)

    require(set(contract["required_source_types"]) == SOURCE_TYPES, "override source types mismatch")
    require(set(contract["required_outcomes"]) == OUTCOMES, "override outcomes mismatch")
    require(set(contract["required_denial_reasons"]) == DENIAL_REASONS, "override denial reasons mismatch")

    qa_by_id = {item["check_id"]: item for item in qa_results}
    safety_by_id = {item["rule_id"]: item for item in safety_rules}
    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    trace_by_id = {trace["trace_id"]: trace for trace in traces["traces"]}

    seen_decisions = set()
    seen_source_types = set()
    seen_outcomes = set()
    seen_denial_reasons = set()
    has_approved_qa_override = False
    has_denied_eligible_missing_audit = False

    for decision in contract["decisions"]:
        decision_id = decision["decision_id"]
        require(decision_id not in seen_decisions, f"duplicate export override decision {decision_id}")
        seen_decisions.add(decision_id)
        seen_source_types.add(decision["source_type"])
        seen_outcomes.add(decision["decision"]["outcome"])
        if decision["decision"]["denial_reason"] is not None:
            seen_denial_reasons.add(decision["decision"]["denial_reason"])

        validate_cross_links(decision, qa_by_id, safety_by_id, eval_by_fixture, trace_by_id)
        validate_gate_transition(decision, eval_by_fixture[decision["fixture_id"]])

        if decision["decision"]["outcome"] == "approved":
            has_approved_qa_override = has_approved_qa_override or decision["source_type"] == "qa_result"
        if (
            decision["decision"]["denial_reason"] == "missing_approval_audit"
            and decision["source_override_eligible"] is True
        ):
            has_denied_eligible_missing_audit = True

    require(SOURCE_TYPES <= seen_source_types, f"missing override source types: {sorted(SOURCE_TYPES - seen_source_types)}")
    require(OUTCOMES <= seen_outcomes, f"missing override outcomes: {sorted(OUTCOMES - seen_outcomes)}")
    require(
        DENIAL_REASONS <= seen_denial_reasons,
        f"missing override denial reasons: {sorted(DENIAL_REASONS - seen_denial_reasons)}",
    )
    require(has_approved_qa_override, "override contract must include an approved eligible QA override")
    require(has_denied_eligible_missing_audit, "override contract must deny eligible override without complete audit")


def validate_cross_links(
    decision: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    safety_by_id: dict[str, dict[str, Any]],
    eval_by_fixture: dict[str, dict[str, Any]],
    trace_by_id: dict[str, dict[str, Any]],
) -> None:
    fixture_id = decision["fixture_id"]
    trace_id = decision["trace_id"]
    source_id = decision["source_id"]
    source_type = decision["source_type"]

    require(fixture_id in eval_by_fixture, f"{decision['decision_id']} references unknown eval fixture")
    require(trace_id in trace_by_id, f"{decision['decision_id']} references unknown trace")
    eval_fixture = eval_by_fixture[fixture_id]
    trace = trace_by_id[trace_id]
    require(eval_fixture["trace_contract"]["trace_id"] == trace_id, f"{decision['decision_id']} eval trace mismatch")
    require(eval_fixture["workflow"] == decision["workflow"], f"{decision['decision_id']} workflow mismatch")
    require(trace["fixture_id"] == fixture_id, f"{decision['decision_id']} trace fixture mismatch")
    require(trace["workflow"] == decision["workflow"], f"{decision['decision_id']} trace workflow mismatch")
    require(decision["export_id"] == trace["artifact_links"]["export_id"], f"{decision['decision_id']} export link mismatch")
    require(decision["export_id"] == f"export_{fixture_id}", f"{decision['decision_id']} export id must be fixture-scoped")
    require(decision["requested_by_role"] in ADMIN_ROLES, f"{decision['decision_id']} requester must be admin override role")
    require(decision["resolved_by_role"] in ADMIN_ROLES, f"{decision['decision_id']} resolver must be admin override role")
    require(decision["source_blocks_final_export"] is True, f"{decision['decision_id']} must model a blocking source")
    require(decision["source_gate_before_override"]["final_export_allowed"] is False, f"{decision['decision_id']} source gate must begin blocked")
    require(decision["source_gate_before_override"]["override_requires_audit"] is True, f"{decision['decision_id']} must require audit")
    require(
        decision["approval_audit"]["decision_audit_log_id"] != decision["approval_audit"]["approval_audit_log_id"],
        f"{decision['decision_id']} approval audit must be distinct from request audit when present",
    )
    if decision["approval_audit"]["approval_audit_complete"]:
        require(decision["approval_audit"]["approval_audit_log_id"] is not None, f"{decision['decision_id']} missing approval audit id")
        require(decision["approval_audit"]["rationale"].strip(), f"{decision['decision_id']} complete audit requires rationale")

    gate = eval_fixture["qa_export_gate"]
    before = decision["source_gate_before_override"]
    require(before["safety_blocks_export"] is gate["safety_blocks_export"], f"{decision['decision_id']} safety gate mismatch")
    require(before["export_artifacts_complete"] is gate["export_artifacts_complete"], f"{decision['decision_id']} artifact gate mismatch")

    if source_type == "qa_result":
        require(source_id in qa_by_id, f"{decision['decision_id']} references unknown QA result")
        qa = qa_by_id[source_id]
        require(qa["evidence"]["fixture_id"] == fixture_id, f"{decision['decision_id']} QA fixture mismatch")
        require(qa["evidence"]["trace_id"] == trace_id, f"{decision['decision_id']} QA trace mismatch")
        require(qa_result_outcome(qa) == "block", f"{decision['decision_id']} QA source must block")
        require(qa["export_gate"]["eligible_admin_override"] is decision["source_override_eligible"], f"{decision['decision_id']} QA override eligibility mismatch")
        require(qa["severity"] == decision["source_severity"], f"{decision['decision_id']} QA severity mismatch")
        require(source_id in gate["blocking_qa_check_ids"], f"{decision['decision_id']} QA source must be in eval blocking checks")
        require(source_id in before["blocking_source_ids"], f"{decision['decision_id']} source must be in before gate")
    elif source_type == "safety_decision":
        require(source_id in safety_by_id, f"{decision['decision_id']} references unknown safety rule")
        rule = safety_by_id[source_id]
        require(fixture_id in rule["eval_fixture_links"], f"{decision['decision_id']} safety rule fixture mismatch")
        require(rule["action"] == "block", f"{decision['decision_id']} safety source must be blocking")
        require(rule["admin_override_eligible"] is decision["source_override_eligible"], f"{decision['decision_id']} safety override eligibility mismatch")
        require(rule["severity"] == decision["source_severity"], f"{decision['decision_id']} safety severity mismatch")
        require(gate["safety_blocks_export"] is True, f"{decision['decision_id']} eval gate must safety-block export")
        require(source_id in before["blocking_source_ids"], f"{decision['decision_id']} safety source must be in before gate")
    elif source_type == "export_contract":
        require(source_id in qa_by_id, f"{decision['decision_id']} export contract source must link QA result")
        qa = qa_by_id[source_id]
        require(qa["check_category"] == "export_completeness", f"{decision['decision_id']} export source must be export completeness QA")
        require(qa["evidence"]["fixture_id"] == fixture_id, f"{decision['decision_id']} export QA fixture mismatch")
        require(qa["evidence"]["trace_id"] == trace_id, f"{decision['decision_id']} export QA trace mismatch")
        require(decision["source_override_eligible"] is False, f"{decision['decision_id']} incomplete export artifacts are not override eligible")
        require(gate["export_artifacts_complete"] is False, f"{decision['decision_id']} eval gate must have incomplete artifacts")
        require(source_id in before["blocking_source_ids"], f"{decision['decision_id']} export source must be in before gate")
    else:
        raise ExportOverrideContractError(f"{decision['decision_id']} unsupported source type")


def validate_gate_transition(decision: dict[str, Any], eval_fixture: dict[str, Any]) -> None:
    outcome = decision["decision"]["outcome"]
    denial = decision["decision"]["denial_reason"]
    audit_complete = decision["approval_audit"]["approval_audit_complete"]
    eligible = decision["source_override_eligible"]
    artifacts_complete = decision["source_gate_before_override"]["export_artifacts_complete"]
    expected = decision["expected_export_gate_after_override"]

    can_clear = eligible and audit_complete and artifacts_complete and decision["source_severity"] != "critical"
    if outcome == "approved":
        require(denial is None, f"{decision['decision_id']} approved override cannot have denial reason")
        require(can_clear, f"{decision['decision_id']} approved override lacks eligibility/audit/artifact prerequisites")
        require(decision["decision"]["source_gate_resolved"] is True, f"{decision['decision_id']} approved override must resolve source")
        require(expected["source_block_cleared"] is True, f"{decision['decision_id']} approved override must clear source block")
        require(decision["source_id"] not in expected["remaining_blocking_source_ids"], f"{decision['decision_id']} cleared source still blocks")
    else:
        require(denial in DENIAL_REASONS, f"{decision['decision_id']} denied override must have denial reason")
        require(decision["decision"]["source_gate_resolved"] is False, f"{decision['decision_id']} denied override cannot resolve source")
        require(expected["source_block_cleared"] is False, f"{decision['decision_id']} denied override cannot clear source")
        require(decision["source_id"] in expected["remaining_blocking_source_ids"], f"{decision['decision_id']} denied source must keep blocking")
        if denial == "missing_approval_audit":
            require(audit_complete is False, f"{decision['decision_id']} missing audit denial must have incomplete audit")
        if denial == "source_not_override_eligible":
            require(eligible is False, f"{decision['decision_id']} non-eligible denial must have ineligible source")
        if denial == "critical_safety_rule":
            require(decision["source_severity"] == "critical", f"{decision['decision_id']} critical denial must use critical source")
        if denial == "incomplete_export_artifacts":
            require(artifacts_complete is False, f"{decision['decision_id']} incomplete artifact denial must model incomplete export")

    unresolved_coverage = not eval_fixture["qa_coverage_contract"]["coverage_complete"]
    remaining_reasons = set(expected["remaining_gate_reasons"])
    if unresolved_coverage:
        require(
            "unresolved_qa_coverage" in remaining_reasons or expected["final_export_allowed"] is False,
            f"{decision['decision_id']} unresolved QA coverage must keep export closed",
        )
    if expected["remaining_blocking_source_ids"] or remaining_reasons:
        require(expected["final_export_allowed"] is False, f"{decision['decision_id']} remaining blockers must deny final export")
    if expected["final_export_allowed"]:
        require(not expected["remaining_blocking_source_ids"], f"{decision['decision_id']} allowed export cannot have blockers")
        require(not remaining_reasons, f"{decision['decision_id']} allowed export cannot have gate reasons")


def validate_policy(contract: dict[str, Any]) -> None:
    policy = contract["release_gate_policy"]
    require(policy["blocking_export_may_open_only_with_eligible_audited_override"] is True, "eligible audited override policy missing")
    require(policy["critical_safety_blocks_have_no_override_path"] is True, "critical safety no-override policy missing")
    require(policy["missing_manifest_or_trace_provenance_has_no_override_path"] is True, "export completeness no-override policy missing")
    require(policy["override_decisions_are_admin_only"] is True, "override admin-only policy missing")


def validate_replay_contract(contract: dict[str, Any]) -> None:
    replay = contract["replay_contract"]
    require(replay["runner"] == "scripts/run_export_override_contract.py", "override replay runner mismatch")
    require(
        replay["check_command"] == "python3 scripts/run_export_override_contract.py --check",
        "override replay check command mismatch",
    )
    require(replay["cases_replayed"] == len(contract["decisions"]), "override replay case count mismatch")
    for field in [
        "requires_eval_result_link",
        "requires_trace_export_link",
        "requires_qa_source_link",
        "requires_safety_source_link",
        "denies_critical_safety_override",
        "denies_incomplete_export_artifact_override",
        "denies_missing_audit_override",
        "approved_override_keeps_other_gate_reasons_closed",
    ]:
        require(replay[field] is True, f"override replay contract must set {field}")

    result = subprocess.run(
        [sys.executable, str(REPLAY_RUNNER), "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(result.returncode == 0, "override replay runner failed: " + (result.stderr or result.stdout).strip())


def main() -> int:
    try:
        contract = load_json(CONTRACT)
        require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "override contract must cite Rev2")
        validate_openapi(contract)
        validate_decision_links(contract)
        validate_policy(contract)
        validate_replay_contract(contract)
    except ExportOverrideContractError as exc:
        print(f"export override contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("export override contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
