#!/usr/bin/env python3
"""Validate Stage 0 Rev2 final export eligibility decisions."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
CONTRACT = FIXTURE_DIR / "export_eligibility_decision_contract.json"
EVAL_RESULTS = FIXTURE_DIR / "starter_eval_results.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"
SAFETY_RULES = FIXTURE_DIR / "safety_rules.json"
TRACE_COMPLETENESS = FIXTURE_DIR / "trace_completeness.json"
TRACE_EXPORT_GATE_MATRIX = FIXTURE_DIR / "trace_export_gate_matrix.json"
EVAL_PACKAGE_READINESS = FIXTURE_DIR / "eval_package_readiness_contract.json"
EXPORT_OVERRIDE_CONTRACT = FIXTURE_DIR / "export_override_contract.json"

TRACE_ARTIFACT_LINKS = {
    "manifest": "manifest_linked",
    "metadata": "metadata_linked",
    "qa_report": "qa_report_linked",
    "trace_provenance": "trace_provenance_linked",
    "safety_disclaimer_when_applicable": "safety_disclaimer_linked",
}

EXPORT_ARTIFACTS = [
    "manifest",
    "metadata",
    "qa_report",
    "trace_provenance",
    "safety_disclaimer_when_applicable",
]

BLOCKING_SAFETY_DECISIONS = {
    "block",
    "require_user_confirmation",
    "require_admin_review",
}

REASON_REQUIREMENTS = {
    "blocking_qa": "resolve_blocking_qa",
    "safety_policy_block": "remove_policy_blocked_content",
    "safety_user_confirmation_required": "collect_user_confirmation",
    "safety_admin_review_required": "complete_admin_safety_review",
    "incomplete_export_artifacts": "persist_required_export_artifacts",
    "qa_coverage_incomplete": "complete_qa_coverage",
    "trace_incomplete": "complete_trace",
}

EXPECTED_LINKS = {
    "eval_results": "fixtures/stage0/rev2/eval/starter_eval_results.json",
    "qa_results": "fixtures/stage0/rev2/eval/qa_results.json",
    "safety_rules": "fixtures/stage0/rev2/eval/safety_rules.json",
    "trace_completeness": "fixtures/stage0/rev2/eval/trace_completeness.json",
    "trace_export_gate_matrix": "fixtures/stage0/rev2/eval/trace_export_gate_matrix.json",
    "eval_package_readiness": "fixtures/stage0/rev2/eval/eval_package_readiness_contract.json",
    "export_override_contract": "fixtures/stage0/rev2/eval/export_override_contract.json",
}

REQUIRED_TRACE_STEPS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

POSITIVE_ALLOW_PATH_SOURCE_REFS = {
    "schemas/stage0/rev2/eval_result.schema.json",
    "schemas/stage0/rev2/qa_result.schema.json",
    "schemas/stage0/rev2/trace_completeness.schema.json",
    "schemas/stage0/rev2/eval_package_readiness_contract.schema.json",
    "schemas/stage0/rev2/export_eligibility_decision_contract.schema.json",
}


class ExportEligibilityDecisionError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ExportEligibilityDecisionError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ExportEligibilityDecisionError(message)


def linked_safety_rule_ids(fixture_id: str, safety_rules: list[dict[str, Any]]) -> list[str]:
    return [
        rule["rule_id"]
        for rule in safety_rules
        if fixture_id in rule["eval_fixture_links"]
    ]


def trace_is_complete(trace_contract: dict[str, Any], trace: dict[str, Any], export_contract: dict[str, Any]) -> bool:
    fields_complete = all(
        trace[field]["present"] is True
        for field in (
            "schema_validation",
            "provenance",
            "safety_status",
            "qa_eval_status",
            "admin_visibility",
            "user_failure_mapping",
        )
    )
    artifact_links_complete = all(
        trace["artifact_links"][trace_key] is export_contract[export_key]
        for export_key, trace_key in TRACE_ARTIFACT_LINKS.items()
    )
    return (
        fields_complete
        and trace["covered_steps"] == trace_contract["required_pipeline_steps"]
        and isinstance(trace["quota_transaction_id"], str)
        and bool(trace["quota_transaction_id"])
        and trace["artifact_links"]["trace_provenance_linked"] is True
        and artifact_links_complete
    )


def expected_denial_reasons(eval_fixture: dict[str, Any], trace_complete: bool) -> list[str]:
    reasons = list(eval_fixture["qa_export_gate"]["denial_reasons"])
    if not trace_complete and "trace_incomplete" not in reasons:
        reasons.append("trace_incomplete")
    return reasons


def expected_requirements(eval_fixture: dict[str, Any], reasons: list[str], trace_complete: bool) -> list[str]:
    requirements = []
    if eval_fixture["status"] != "pass":
        requirements.append("pass_eval_suite")
    if eval_fixture["candidate_count"] < 1:
        requirements.append("generate_candidates")
    if not trace_complete:
        requirements.append("complete_trace")
    for reason in reasons:
        requirement = REASON_REQUIREMENTS[reason]
        if requirement not in requirements:
            requirements.append(requirement)
    return requirements


def expected_override_effect(
    eval_fixture: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    export_override_by_fixture: dict[str, list[dict[str, Any]]],
) -> str:
    gate = eval_fixture["qa_export_gate"]
    reasons = gate["denial_reasons"]
    if "safety_policy_block" in reasons or "incomplete_export_artifacts" in reasons:
        return "no_export_override_path"
    blocking_qa = gate["blocking_qa_check_ids"]
    eligible = [
        check_id
        for check_id in blocking_qa
        if qa_by_id[check_id]["export_gate"]["eligible_admin_override"] is True
    ]
    if eligible:
        decisions = export_override_by_fixture.get(eval_fixture["fixture_id"], [])
        for decision in decisions:
            require(
                decision["approval_audit"]["trace_linked"] is True
                and decision["approval_audit"]["export_linked"] is True,
                f"{eval_fixture['fixture_id']} override decision must link trace/export audit",
            )
            require(
                decision["expected_export_gate_after_override"]["final_export_allowed"] is False,
                f"{eval_fixture['fixture_id']} override cannot enable download while other blockers remain",
            )
        return "source_override_may_clear_blocker_but_download_stays_denied"
    safety_decision = eval_fixture["safety_decision_contract"]["decision"]
    if safety_decision == "require_admin_review":
        return "admin_review_required_but_download_stays_denied"
    if safety_decision == "require_user_confirmation":
        return "user_confirmation_required_but_download_stays_denied"
    if gate["final_export_allowed"]:
        return "download_allowed_without_override"
    return "no_source_override_needed_but_download_stays_denied"


def expected_case(
    eval_fixture: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    safety_rules: list[dict[str, Any]],
    trace_contract: dict[str, Any],
    trace_by_id: dict[str, dict[str, Any]],
    readiness_by_fixture: dict[str, dict[str, Any]],
    export_override_by_fixture: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    fixture_id = eval_fixture["fixture_id"]
    gate = eval_fixture["qa_export_gate"]
    trace_id = eval_fixture["trace_contract"]["trace_id"]
    trace = trace_by_id[trace_id]
    readiness = readiness_by_fixture[fixture_id]
    trace_complete = trace_is_complete(trace_contract, trace, eval_fixture["export_contract"])
    denial_reasons = expected_denial_reasons(eval_fixture, trace_complete)
    blocking_qa = gate["blocking_qa_check_ids"]
    override_eligible = [
        check_id
        for check_id in blocking_qa
        if qa_by_id[check_id]["export_gate"]["eligible_admin_override"] is True
    ]
    non_overrideable = [
        check_id
        for check_id in blocking_qa
        if qa_by_id[check_id]["export_gate"]["eligible_admin_override"] is False
    ]
    expected_allowed = (
        eval_fixture["status"] == "pass"
        and eval_fixture["candidate_count"] > 0
        and eval_fixture["qa_coverage_contract"]["coverage_complete"] is True
        and not blocking_qa
        and eval_fixture["safety_decision_contract"]["decision"] not in BLOCKING_SAFETY_DECISIONS
        and gate["export_artifacts_complete"] is True
        and trace_complete
        and readiness["package_download_allowed"] is True
    )
    return {
        "case_id": "export_eligibility_" + fixture_id.removeprefix("fx_"),
        "fixture_id": fixture_id,
        "workflow": eval_fixture["workflow"],
        "trace_id": trace_id,
        "package_id": trace["artifact_links"]["package_id"],
        "export_id": trace["artifact_links"]["export_id"],
        "eval_status": eval_fixture["status"],
        "candidate_count": eval_fixture["candidate_count"],
        "qa_coverage_complete": eval_fixture["qa_coverage_contract"]["coverage_complete"],
        "blocking_qa_check_ids": blocking_qa,
        "blocking_qa_override_eligible_ids": override_eligible,
        "non_overrideable_qa_blocker_ids": non_overrideable,
        "safety_decision": eval_fixture["safety_decision_contract"]["decision"],
        "safety_rule_ids": linked_safety_rule_ids(fixture_id, safety_rules),
        "export_artifacts_complete": gate["export_artifacts_complete"],
        "missing_export_artifacts": [
            artifact
            for artifact in EXPORT_ARTIFACTS
            if eval_fixture["export_contract"][artifact] is False
        ],
        "trace_complete": trace_complete,
        "package_readiness_download_allowed": readiness["package_download_allowed"],
        "final_export_allowed": gate["final_export_allowed"],
        "download_enabled": expected_allowed,
        "decision": "allow_download" if expected_allowed else "deny_download",
        "denial_reasons": [] if expected_allowed else denial_reasons,
        "requirements_to_allow": [] if expected_allowed else expected_requirements(eval_fixture, denial_reasons, trace_complete),
        "override_effect": expected_override_effect(eval_fixture, qa_by_id, export_override_by_fixture),
        "retained_artifacts_when_blocked": [] if expected_allowed else readiness["retained_artifacts_when_blocked"],
    }


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    eval_results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)
    safety_rules = load_json(SAFETY_RULES)
    trace_contract = load_json(TRACE_COMPLETENESS)
    gate_matrix = load_json(TRACE_EXPORT_GATE_MATRIX)
    readiness = load_json(EVAL_PACKAGE_READINESS)
    export_override = load_json(EXPORT_OVERRIDE_CONTRACT)

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "export eligibility must cite Rev2")
    require(contract["links"] == EXPECTED_LINKS, "export eligibility links must be exact")
    for policy_name, enabled in contract["decision_policy"].items():
        require(enabled is True, f"decision policy {policy_name} must be true")

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    qa_by_id = {item["check_id"]: item for item in qa_results}
    trace_by_id = {item["trace_id"]: item for item in trace_contract["traces"]}
    readiness_by_fixture = {item["fixture_id"]: item for item in readiness["readiness_cases"]}
    gate_by_fixture = {item["fixture_id"]: item for item in gate_matrix["gate_cases"]}
    cases_by_fixture = {item["fixture_id"]: item for item in contract["eligibility_cases"]}
    export_override_by_fixture: dict[str, list[dict[str, Any]]] = {}
    for decision in export_override["decisions"]:
        export_override_by_fixture.setdefault(decision["fixture_id"], []).append(decision)

    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    require(len(qa_by_id) == len(qa_results), "QA result IDs must be unique")
    require(len(trace_by_id) == len(trace_contract["traces"]), "trace IDs must be unique")
    require(len(cases_by_fixture) == len(contract["eligibility_cases"]), "eligibility cases must be unique per fixture")
    require(set(cases_by_fixture) == set(eval_by_fixture), "eligibility cases must cover every eval fixture exactly")
    require(set(readiness_by_fixture) == set(eval_by_fixture), "package readiness must cover every eval fixture")
    require(set(gate_by_fixture) == set(eval_by_fixture), "trace export gate matrix must cover every eval fixture")

    saw_override_eligible_qa = False
    saw_non_overrideable_qa = False
    saw_safety_block = False
    saw_user_confirmation = False
    saw_missing_artifacts = False
    saw_candidate_gap = False
    saw_trace_complete = False
    workflows_seen: set[str] = set()

    for fixture_id, eval_fixture in eval_by_fixture.items():
        workflows_seen.add(eval_fixture["workflow"])
        trace_id = eval_fixture["trace_contract"]["trace_id"]
        require(trace_id in trace_by_id, f"{fixture_id} missing trace contract")
        require(fixture_id in gate_by_fixture, f"{fixture_id} missing trace export gate matrix case")
        require(fixture_id in readiness_by_fixture, f"{fixture_id} missing package readiness case")

        case = cases_by_fixture[fixture_id]
        expected = expected_case(
            eval_fixture,
            qa_by_id,
            safety_rules,
            trace_contract,
            trace_by_id,
            readiness_by_fixture,
            export_override_by_fixture,
        )
        require(case == expected, f"{fixture_id} eligibility case diverges from source contracts")

        gate_case = gate_by_fixture[fixture_id]
        require(case["final_export_allowed"] is gate_case["final_export_allowed"], f"{fixture_id} final gate mismatch")
        require(case["denial_reasons"] == gate_case["denial_reasons"], f"{fixture_id} denial reason mismatch")
        require(case["missing_export_artifacts"] == gate_case["missing_export_artifacts"], f"{fixture_id} artifact gap mismatch")
        require(case["package_id"] == readiness_by_fixture[fixture_id]["package_id"], f"{fixture_id} package readiness link mismatch")
        require(case["export_id"] == readiness_by_fixture[fixture_id]["export_id"], f"{fixture_id} export readiness link mismatch")

        for check_id in case["blocking_qa_check_ids"]:
            require(check_id in qa_by_id, f"{fixture_id} references unknown QA check {check_id}")
            qa_result = qa_by_id[check_id]
            require(qa_result["evidence"]["fixture_id"] == fixture_id, f"{fixture_id} {check_id} fixture link mismatch")
            require(qa_result["evidence"]["trace_id"] == trace_id, f"{fixture_id} {check_id} trace link mismatch")
            require(qa_result["export_gate"]["blocks_final_export"] is True, f"{fixture_id} {check_id} must block export")
            require(
                qa_result["export_gate"]["override_requires_audit"] is True,
                f"{fixture_id} {check_id} override path must require audit",
            )

        if case["blocking_qa_override_eligible_ids"]:
            saw_override_eligible_qa = True
        if case["non_overrideable_qa_blocker_ids"]:
            saw_non_overrideable_qa = True
        if case["safety_decision"] == "block":
            saw_safety_block = True
            require(case["override_effect"] == "no_export_override_path", f"{fixture_id} safety block cannot be override-enabled")
        if case["safety_decision"] == "require_user_confirmation":
            saw_user_confirmation = True
        if case["missing_export_artifacts"]:
            saw_missing_artifacts = True
            require(case["override_effect"] == "no_export_override_path", f"{fixture_id} missing artifacts cannot be override-enabled")
        if case["candidate_count"] == 0:
            saw_candidate_gap = True
            require("generate_candidates" in case["requirements_to_allow"], f"{fixture_id} must require generated candidates")
        if case["trace_complete"]:
            saw_trace_complete = True
        if not case["final_export_allowed"]:
            require(case["download_enabled"] is False, f"{fixture_id} denied final export cannot enable download")
            require(case["decision"] == "deny_download", f"{fixture_id} denied final export must deny download")
            require("trace_provenance" in case["retained_artifacts_when_blocked"], f"{fixture_id} must retain trace provenance")
        else:
            require(case["download_enabled"] is True, f"{fixture_id} allowed final export must enable download")
            require(case["decision"] == "allow_download", f"{fixture_id} allowed final export must allow download")
            require(case["denial_reasons"] == [], f"{fixture_id} allowed final export cannot carry denials")

    require(
        workflows_seen
        == {
            "ecommerce_growth_pack",
            "business_visual_doc_pack",
            "local_merchant_campaign_pack",
            "character_ip_concept_pack",
        },
        "eligibility cases must cover all vertical workflows",
    )
    require(saw_override_eligible_qa, "eligibility contract must include override-eligible QA blockers")
    require(saw_non_overrideable_qa, "eligibility contract must include non-overrideable QA blockers")
    require(saw_safety_block, "eligibility contract must include safety policy block cases")
    require(saw_user_confirmation, "eligibility contract must include user-confirmation safety hold cases")
    require(saw_missing_artifacts, "eligibility contract must include missing export artifact cases")
    require(saw_candidate_gap, "eligibility contract must include candidate generation gap cases")
    require(saw_trace_complete, "eligibility contract must validate complete trace cases")
    validate_positive_allow_path_cases(contract, readiness, trace_contract)


def validate_positive_allow_path_cases(
    contract: dict[str, Any],
    readiness: dict[str, Any],
    trace_contract: dict[str, Any],
) -> None:
    cases = contract.get("positive_allow_path_cases")
    require(isinstance(cases, list) and cases, "eligibility contract must include positive allow-path cases")

    saw_allowed_download = False
    for case in cases:
        workflow_id = case["workflow"]
        workflow_path = ROOT / case["acceptance_fixture"]
        require(workflow_path.exists(), f"{case['case_id']} acceptance fixture missing")
        workflow = load_json(workflow_path)
        require(workflow["workflow_id"] == workflow_id, f"{case['case_id']} workflow fixture mismatch")
        require(
            set(case["export_required_files"]) == set(workflow["export_targets"][0]["required_files"]),
            f"{case['case_id']} export required files must match workflow acceptance fixture",
        )
        require(
            set(case["qa_categories_covered"]) == set(workflow["required_qa_checks"]),
            f"{case['case_id']} QA categories must satisfy workflow required QA checks",
        )
        require(case["candidate_count"] >= len(workflow["four_option_taxonomy"]), f"{case['case_id']} must cover four candidates")
        require(case["blocking_qa_check_ids"] == [], f"{case['case_id']} allow path cannot contain blocking QA")
        require(case["safety_decision"] in {"allow", "warn"}, f"{case['case_id']} allow path cannot use safety hold/block")
        require(case["missing_export_artifacts"] == [], f"{case['case_id']} allow path cannot miss export artifacts")
        require(case["trace_complete"] is True, f"{case['case_id']} trace must be complete")
        require(set(case["trace_steps"]) == REQUIRED_TRACE_STEPS, f"{case['case_id']} trace steps mismatch")
        require(case["package_readiness_download_allowed"] is True, f"{case['case_id']} package readiness must allow download")
        require(case["final_export_allowed"] is True, f"{case['case_id']} final export must be allowed")
        require(case["download_enabled"] is True, f"{case['case_id']} download must be enabled")
        require(case["decision"] == "allow_download", f"{case['case_id']} must allow download")
        require(case["denial_reasons"] == [], f"{case['case_id']} allow path cannot carry denial reasons")
        require(case["requirements_to_allow"] == [], f"{case['case_id']} allow path cannot carry unmet requirements")
        require(case["override_effect"] == "download_allowed_without_override", f"{case['case_id']} allow path must not require override")
        require(case["retained_artifacts_when_blocked"] == [], f"{case['case_id']} allow path cannot retain blocked artifacts")
        require(
            set(case["source_contract_refs"]) == POSITIVE_ALLOW_PATH_SOURCE_REFS,
            f"{case['case_id']} source contract refs mismatch",
        )
        require(
            set(trace_contract["required_pipeline_steps"]) == REQUIRED_TRACE_STEPS,
            f"{case['case_id']} must align with trace completeness required steps",
        )
        policy = readiness["package_readiness_policy"]
        for key in [
            "final_export_requires_eval_pass",
            "final_export_requires_complete_qa_coverage",
            "final_export_requires_complete_export_artifacts",
            "final_export_requires_no_blocking_qa",
            "final_export_requires_no_safety_hold_or_block",
        ]:
            require(policy[key] is True, f"{case['case_id']} readiness policy {key} must be true")

        saw_allowed_download = True

    require(saw_allowed_download, "eligibility contract must prove an allowed download path")


def main() -> int:
    try:
        validate_contract()
    except ExportEligibilityDecisionError as exc:
        print(f"export eligibility decision validation failed: {exc}", file=sys.stderr)
        return 1
    print("export eligibility decision validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
