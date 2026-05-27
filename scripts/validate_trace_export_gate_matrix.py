#!/usr/bin/env python3
"""Validate Stage 0 Rev2 trace-to-export gate closure contracts."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
CONTRACT = FIXTURE_DIR / "trace_export_gate_matrix.json"
EVAL_RESULTS = FIXTURE_DIR / "starter_eval_results.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"
SAFETY_RULES = FIXTURE_DIR / "safety_rules.json"
TRACE_COMPLETENESS = FIXTURE_DIR / "trace_completeness.json"

REQUIRED_GATE_FIELDS = {
    "final_export_allowed",
    "blocking_qa_check_ids",
    "blocking_qa_categories",
    "safety_blocks_export",
    "export_artifacts_complete",
    "admin_override_required_for_export",
    "override_requires_audit",
}

EXPORT_ARTIFACT_FIELDS = [
    "manifest",
    "metadata",
    "qa_report",
    "trace_provenance",
]

REQUIRED_GATE_REASONS = {
    "blocking_qa",
    "safety_policy_block",
    "incomplete_export_artifacts",
    "qa_coverage_incomplete",
}


class TraceExportGateMatrixError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise TraceExportGateMatrixError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise TraceExportGateMatrixError(message)


def linked_safety_rule_ids(fixture_id: str, safety_rules: list[dict[str, Any]]) -> list[str]:
    return [
        rule["rule_id"]
        for rule in safety_rules
        if fixture_id in rule["eval_fixture_links"]
    ]


def expected_gate_reasons(eval_fixture: dict[str, Any]) -> list[str]:
    reasons = []
    gate = eval_fixture["qa_export_gate"]
    if gate["blocking_qa_check_ids"]:
        reasons.append("blocking_qa")
    if gate["safety_blocks_export"]:
        reasons.append("safety_policy_block")
    if not gate["export_artifacts_complete"]:
        reasons.append("incomplete_export_artifacts")
    if not eval_fixture["qa_coverage_contract"]["coverage_complete"]:
        reasons.append("qa_coverage_incomplete")
    return reasons


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    eval_results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)
    safety_rules = load_json(SAFETY_RULES)
    trace_contract = load_json(TRACE_COMPLETENESS)

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "gate matrix must cite Rev2")
    require(contract["links"]["eval_results"] == "fixtures/stage0/rev2/eval/starter_eval_results.json", "eval result link mismatch")
    require(contract["links"]["qa_results"] == "fixtures/stage0/rev2/eval/qa_results.json", "QA result link mismatch")
    require(contract["links"]["safety_rules"] == "fixtures/stage0/rev2/eval/safety_rules.json", "safety rule link mismatch")
    require(contract["links"]["trace_completeness"] == "fixtures/stage0/rev2/eval/trace_completeness.json", "trace link mismatch")
    require(set(contract["required_gate_fields"]) == REQUIRED_GATE_FIELDS, "required export gate fields mismatch")
    require(set(contract["gate_policies"].values()) == {True}, "all gate policies must be enabled")

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    trace_by_id = {trace["trace_id"]: trace for trace in trace_contract["traces"]}
    qa_by_id = {item["check_id"]: item for item in qa_results}

    case_ids = [case["case_id"] for case in contract["gate_cases"]]
    require(len(case_ids) == len(set(case_ids)), "gate case IDs must be unique")
    cases_by_fixture = {case["fixture_id"]: case for case in contract["gate_cases"]}
    require(set(cases_by_fixture) == set(eval_by_fixture), "gate matrix must cover every eval fixture exactly")

    saw_blocking_qa = False
    saw_safety_block = False
    saw_incomplete_export = False
    saw_unresolved_coverage = False
    saw_nonblocking_warning = False

    for fixture_id, eval_fixture in eval_by_fixture.items():
        case = cases_by_fixture[fixture_id]
        trace_id = eval_fixture["trace_contract"]["trace_id"]
        gate = eval_fixture["qa_export_gate"]
        export_contract = eval_fixture["export_contract"]

        require(case["trace_id"] == trace_id, f"{fixture_id} trace_id mismatch")
        require(case["workflow"] == eval_fixture["workflow"], f"{fixture_id} workflow mismatch")
        require(case["package_id"] == f"package_{fixture_id}", f"{fixture_id} package_id mismatch")
        require(case["export_id"] == f"export_{fixture_id}", f"{fixture_id} export_id mismatch")
        require(trace_id in trace_by_id, f"{fixture_id} missing trace completeness record")

        trace = trace_by_id[trace_id]
        require(trace["fixture_id"] == fixture_id, f"{fixture_id} trace fixture mismatch")
        require(trace["workflow"] == eval_fixture["workflow"], f"{fixture_id} trace workflow mismatch")
        require(trace["artifact_links"]["package_id"] == case["package_id"], f"{fixture_id} trace package link mismatch")
        require(trace["artifact_links"]["export_id"] == case["export_id"], f"{fixture_id} trace export link mismatch")

        for trace_field, export_field in {
            "manifest_linked": "manifest",
            "qa_report_linked": "qa_report",
            "metadata_linked": "metadata",
            "trace_provenance_linked": "trace_provenance",
            "safety_disclaimer_linked": "safety_disclaimer_when_applicable",
        }.items():
            require(
                trace["artifact_links"][trace_field] is export_contract[export_field],
                f"{fixture_id} trace {trace_field} must match eval export {export_field}",
            )

        require(
            trace["artifact_links"]["trace_provenance_linked"] is True,
            f"{fixture_id} must keep trace provenance linked even when export is blocked",
        )
        require(
            trace["artifact_links"]["safety_disclaimer_linked"] is True,
            f"{fixture_id} must keep applicable safety disclaimer linked even when export is blocked",
        )

        require(case["qa_check_ids"] == eval_fixture["qa_check_ids"], f"{fixture_id} QA check list mismatch")
        require(case["blocking_qa_check_ids"] == gate["blocking_qa_check_ids"], f"{fixture_id} blocking QA IDs mismatch")
        require(case["blocking_qa_categories"] == gate["blocking_qa_categories"], f"{fixture_id} blocking QA categories mismatch")
        require(case["safety_blocks_export"] is gate["safety_blocks_export"], f"{fixture_id} safety gate mismatch")
        require(case["export_artifacts_complete"] is gate["export_artifacts_complete"], f"{fixture_id} artifact gate mismatch")
        require(case["qa_coverage_complete"] is eval_fixture["qa_coverage_contract"]["coverage_complete"], f"{fixture_id} QA coverage mismatch")
        require(case["final_export_allowed"] is gate["final_export_allowed"], f"{fixture_id} final export gate mismatch")
        require(
            case["admin_override_required_for_export"] is gate["admin_override_required_for_export"],
            f"{fixture_id} admin override requirement mismatch",
        )
        require(case["override_requires_audit"] is gate["override_requires_audit"], f"{fixture_id} audit requirement mismatch")

        expected_missing = [field for field in EXPORT_ARTIFACT_FIELDS if export_contract[field] is False]
        require(case["missing_export_artifacts"] == expected_missing, f"{fixture_id} missing artifact list mismatch")
        require(
            gate["export_artifacts_complete"] is (not expected_missing),
            f"{fixture_id} export_artifacts_complete must reflect manifest/metadata/QA/trace artifacts",
        )

        safety_rule_ids = linked_safety_rule_ids(fixture_id, safety_rules)
        require(case["safety_rule_ids"] == safety_rule_ids, f"{fixture_id} linked safety rules mismatch")
        safety_decision = eval_fixture["safety_decision_contract"]
        require(
            safety_decision["source_rule_ids"] == safety_rule_ids,
            f"{fixture_id} safety decision source rules must match gate matrix rules",
        )
        require(
            safety_decision["decision"] == eval_fixture["observed_safety_action"],
            f"{fixture_id} safety decision must match observed eval action",
        )
        require(
            safety_decision["decision_source"] == ("linked_safety_rule" if safety_rule_ids else "default_no_match"),
            f"{fixture_id} safety decision source mismatch",
        )
        linked_rules = [rule for rule in safety_rules if rule["rule_id"] in safety_rule_ids]
        has_blocking_safety_rule = any(rule["action"] == "block" for rule in linked_rules)
        require(
            gate["safety_blocks_export"] is has_blocking_safety_rule,
            f"{fixture_id} safety_blocks_export must match linked blocking safety rules",
        )

        actual_blocking_qa = [
            check_id
            for check_id in eval_fixture["qa_check_ids"]
            if qa_by_id[check_id]["export_gate"]["blocks_final_export"] is True
        ]
        require(actual_blocking_qa == gate["blocking_qa_check_ids"], f"{fixture_id} blocking QA gate must match QA results")
        for check_id in gate["blocking_qa_check_ids"]:
            qa_result = qa_by_id[check_id]
            require(qa_result["evidence"]["fixture_id"] == fixture_id, f"{fixture_id} {check_id} fixture mismatch")
            require(qa_result["evidence"]["trace_id"] == trace_id, f"{fixture_id} {check_id} trace mismatch")
            require(qa_result["export_gate"]["blocks_final_export"] is True, f"{fixture_id} {check_id} must block export")

        expected_reasons = expected_gate_reasons(eval_fixture)
        require(case["gate_reasons"] == expected_reasons, f"{fixture_id} gate reasons mismatch")
        require(set(case["gate_reasons"]) <= REQUIRED_GATE_REASONS, f"{fixture_id} unsupported gate reasons")

        if gate["blocking_qa_check_ids"]:
            saw_blocking_qa = True
            require(gate["final_export_allowed"] is False, f"{fixture_id} blocking QA must deny final export")
        if gate["safety_blocks_export"]:
            saw_safety_block = True
            require(gate["final_export_allowed"] is False, f"{fixture_id} safety block must deny final export")
        if not gate["export_artifacts_complete"]:
            saw_incomplete_export = True
            require(gate["final_export_allowed"] is False, f"{fixture_id} incomplete export artifacts must deny download")
            require(export_contract["blocks_when_incomplete"] is True, f"{fixture_id} incomplete exports must block")
        if not eval_fixture["qa_coverage_contract"]["coverage_complete"]:
            saw_unresolved_coverage = True
            require(gate["final_export_allowed"] is False, f"{fixture_id} incomplete QA coverage must keep export closed")
        if eval_fixture["qa_check_ids"] and not gate["blocking_qa_check_ids"]:
            saw_nonblocking_warning = True

        if gate["admin_override_required_for_export"]:
            require(gate["override_requires_audit"] is True, f"{fixture_id} admin override must require audit")
        if gate["final_export_allowed"]:
            require(not case["gate_reasons"], f"{fixture_id} allowed export cannot have gate reasons")
            require(gate["export_artifacts_complete"] is True, f"{fixture_id} allowed export requires complete artifacts")
            require(eval_fixture["qa_coverage_contract"]["coverage_complete"] is True, f"{fixture_id} allowed export requires complete QA coverage")

    require(saw_blocking_qa, "gate matrix must include a blocking QA case")
    require(saw_safety_block, "gate matrix must include a safety-blocked case")
    require(saw_incomplete_export, "gate matrix must include an incomplete export artifact case")
    require(saw_unresolved_coverage, "gate matrix must include an unresolved QA coverage case")
    require(saw_nonblocking_warning, "gate matrix must include non-blocking QA evidence")


def main() -> int:
    try:
        validate_contract()
    except TraceExportGateMatrixError as exc:
        print(f"trace export gate matrix validation failed: {exc}", file=sys.stderr)
        return 1
    print("trace export gate matrix validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
