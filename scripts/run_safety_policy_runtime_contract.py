#!/usr/bin/env python3
"""Replay the Stage 0 Rev2 safety policy runtime contract from fixtures."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "safety_enforcement_contract.json"
EVAL_RESULTS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "starter_eval_results.json"
TRACE_COMPLETENESS = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "trace_completeness.json"
RUNNER = "scripts/run_safety_policy_runtime_contract.py"

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

ACTION_OUTCOMES = {
    "allow": ("allowed", True, False),
    "warn": ("allowed_with_warning", True, True),
    "require_user_confirmation": ("held_for_user_confirmation", False, True),
    "require_admin_review": ("held_for_admin_review", False, True),
    "block": ("blocked", False, True),
}

ACTION_ERRORS = {
    "allow": "",
    "warn": "",
    "require_user_confirmation": "ErrSafetyReviewHold",
    "require_admin_review": "ErrSafetyReviewHold",
    "block": "ErrSafetyBlocked",
}

ACTION_EXPORT_GATES = {
    "allow": "allow_when_export_contract_complete",
    "warn": "allow_with_warning",
    "require_user_confirmation": "hold_until_user_confirmation",
    "require_admin_review": "hold_until_admin_review",
    "block": "block_final_export",
}

ACTION_PRIORITY = {
    "allow": 0,
    "warn": 1,
    "require_user_confirmation": 2,
    "require_admin_review": 3,
    "block": 4,
}

ALLOWED_RATIONALES = {
    "no active safety rule matched",
    "active safety rule matched enforcement point",
}

ALLOWED_ANALYTICS_PROPERTIES = {
    "enforcement_point",
    "decision",
    "rule_id",
}

INPUT_GAP_ERRORS = {
    "missing_tenant_id": "ErrValidation",
    "missing_all_subjects": "ErrValidation",
    "blocked_export_rule": "ErrSafetyBlocked",
    "held_review_decision": "ErrSafetyReviewHold",
}


class SafetyReplayError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SafetyReplayError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SafetyReplayError(message)


def build_eval_result_index() -> dict[str, dict[str, Any]]:
    results = load_json(EVAL_RESULTS)
    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    return {
        item["fixture_id"]: item
        for item in results[0]["fixture_results"]
    }


def build_trace_index() -> dict[str, dict[str, Any]]:
    traces = load_json(TRACE_COMPLETENESS)
    return {
        trace["fixture_id"]: trace
        for trace in traces["traces"]
    }


def replay_decision_matrix(contract: dict[str, Any], eval_by_fixture: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    replayed: list[dict[str, Any]] = []
    seen_points: set[str] = set()

    for matrix in contract["decision_matrix"]:
        point = matrix["enforcement_point"]
        seen_points.add(point)
        decisions_in_order = [action["decision"] for action in matrix["actions"]]
        require(
            decisions_in_order == sorted(decisions_in_order, key=lambda decision: ACTION_PRIORITY[decision]),
            f"{point} decision matrix must preserve allow->warn->hold->block priority order",
        )
        for action in matrix["actions"]:
            decision = action["decision"]
            outcome, downstream_allowed, requires_audit = ACTION_OUTCOMES[decision]
            fixture_id = action["source_fixture_id"]
            require(fixture_id in eval_by_fixture, f"{point} {decision} references unknown eval fixture {fixture_id}")
            result = eval_by_fixture[fixture_id]
            require(action["requires_trace_safety_status"] is True, f"{point} {decision} must require trace safety status")
            require(action["requires_persisted_decision"] is True, f"{point} {decision} must require persisted decision")
            require(action["requires_audit"] is requires_audit, f"{point} {decision} audit requirement mismatch")

            if not downstream_allowed:
                require(
                    action["export_gate"] in {"hold_until_user_confirmation", "hold_until_admin_review", "block_final_export"},
                    f"{point} {decision} must not use an export-allowing gate",
                )
            else:
                require(
                    action["export_gate"] in {"allow_when_export_contract_complete", "allow_with_warning"},
                    f"{point} {decision} must use an export-allowing gate",
                )

            replayed.append(
                {
                    "enforcement_point": point,
                    "decision": decision,
                    "decision_priority": ACTION_PRIORITY[decision],
                    "source_fixture_id": fixture_id,
                    "observed_fixture_status": result["status"],
                    "runtime_outcome": outcome,
                    "expected_error": ACTION_ERRORS[decision],
                    "creates_downstream_artifacts": downstream_allowed,
                    "trace_status_required": action["requires_trace_safety_status"],
                    "persisted_decision_required": action["requires_persisted_decision"],
                    "audit_required": action["requires_audit"],
                }
            )

    require(seen_points == SAFETY_POINTS, f"decision matrix missing safety points: {sorted(SAFETY_POINTS - seen_points)}")
    require(len(replayed) == len(SAFETY_POINTS) * len(ACTION_OUTCOMES), "decision matrix replay count mismatch")
    return replayed


def replay_transition_gates(contract: dict[str, Any]) -> list[dict[str, Any]]:
    pipeline = contract["pipeline_sequence_contract"]
    gates = []
    seen_stages: set[str] = set()
    seen_points: set[str] = set()

    for gate in pipeline["transition_gates"]:
        seen_stages.add(gate["stage"])
        seen_points.add(gate["enforcement_point"])
        require(gate["trace_status_required"] is True, f"{gate['stage']} must require trace safety status")
        require(gate["downstream_artifacts_created_on_block"] is False, f"{gate['stage']} must fail closed")
        require(gate["required_subject_fields"], f"{gate['stage']} must declare required subject fields")
        gates.append(
            {
                "stage": gate["stage"],
                "enforcement_point": gate["enforcement_point"],
                "must_run_before": gate["must_run_before"],
                "required_subject_fields": gate["required_subject_fields"],
                "blocked_or_held_effect": gate["blocked_or_held_effect"],
                "blocked_or_held_creates_downstream_artifacts": gate["downstream_artifacts_created_on_block"],
                "trace_status_required": gate["trace_status_required"],
            }
        )

    bypass_stages = {
        case["transition_stage"]
        for case in pipeline["bypass_prevention_cases"]
    }
    require(seen_stages == bypass_stages, "bypass prevention cases must replay every transition gate")
    require(seen_points == SAFETY_POINTS, f"transition gates missing safety points: {sorted(SAFETY_POINTS - seen_points)}")
    return gates


def replay_fail_closed_cases(contract: dict[str, Any]) -> list[dict[str, Any]]:
    cases = []
    for case in contract["pipeline_sequence_contract"]["fail_closed_cases"]:
        input_gap = case["input_gap"]
        expected_error = INPUT_GAP_ERRORS[input_gap]
        require(case["expected_error"] == expected_error, f"{case['case_id']} expected error mismatch")
        require(case["creates_downstream_artifacts"] is False, f"{case['case_id']} must not create downstream artifacts")
        cases.append(
            {
                "case_id": case["case_id"],
                "input_gap": input_gap,
                "expected_error": expected_error,
                "creates_downstream_artifacts": False,
                "decision_rows_required_before_error": case["decision_rows_required_before_error"],
                "result": "passed",
            }
        )
    return cases


def replay_bypass_cases(contract: dict[str, Any]) -> list[dict[str, Any]]:
    pipeline = contract["pipeline_sequence_contract"]
    transitions = {
        item["stage"]: item
        for item in pipeline["transition_gates"]
    }
    cases = []
    seen_points: set[str] = set()

    for case in pipeline["bypass_prevention_cases"]:
        transition = transitions[case["transition_stage"]]
        seen_points.add(case["skipped_enforcement_point"])
        require(
            case["skipped_enforcement_point"] == transition["enforcement_point"],
            f"{case['case_id']} skipped point must match transition enforcement point",
        )
        require(case["attempted_downstream_transition"] == transition["must_run_before"], f"{case['case_id']} downstream mismatch")
        require(case["creates_downstream_artifacts"] is False, f"{case['case_id']} must not create downstream artifacts")
        require(case["trace_status_required"] is True, f"{case['case_id']} must require trace status")
        require(case["backend_evidence"], f"{case['case_id']} must cite backend evidence")
        cases.append(
            {
                "case_id": case["case_id"],
                "transition_stage": case["transition_stage"],
                "skipped_enforcement_point": case["skipped_enforcement_point"],
                "attempted_downstream_transition": case["attempted_downstream_transition"],
                "expected_error": case["expected_error"],
                "creates_downstream_artifacts": False,
                "trace_status_required": True,
                "result": "passed",
            }
        )

    require(seen_points == SAFETY_POINTS, f"bypass replay missing safety points: {sorted(SAFETY_POINTS - seen_points)}")
    return cases


def replay_override_downgrade_cases(
    contract: dict[str, Any],
    eval_by_fixture: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    cases = []
    seen_ids: set[str] = set()

    for case in contract["pipeline_sequence_contract"]["override_downgrade_prevention_cases"]:
        case_id = case["case_id"]
        fixture_id = case["fixture_id"]
        seen_ids.add(case_id)
        require(fixture_id in eval_by_fixture, f"{case_id} references unknown eval fixture {fixture_id}")
        result = eval_by_fixture[fixture_id]
        original_decision = result["safety_decision_contract"]["decision"]
        attempted_decision = case["attempted_override_decision"]

        require(case["original_decision"] == original_decision, f"{case_id} original decision mismatch")
        require(
            ACTION_PRIORITY[attempted_decision] < ACTION_PRIORITY[original_decision],
            f"{case_id} must attempt to downgrade to a weaker safety action",
        )
        require(
            case["attempted_export_gate"] == ACTION_EXPORT_GATES[attempted_decision],
            f"{case_id} attempted export gate must match attempted decision",
        )
        require(case["expected_error"] == ACTION_ERRORS[original_decision], f"{case_id} expected error mismatch")
        require(case["final_export_allowed"] is False, f"{case_id} must keep final export blocked or held")
        require(case["requires_admin_audit"] is True, f"{case_id} must require admin audit")
        require(case["creates_downstream_artifacts"] is False, f"{case_id} must fail closed")
        require(case["trace_status_required"] is True, f"{case_id} must require trace status")
        require(
            case["persisted_original_decision_required"] is True,
            f"{case_id} must preserve the original persisted safety decision",
        )
        require(result["qa_export_gate"]["final_export_allowed"] is False, f"{case_id} source fixture must not allow export")

        cases.append(
            {
                "case_id": case_id,
                "fixture_id": fixture_id,
                "original_decision": original_decision,
                "attempted_override_decision": attempted_decision,
                "attempted_export_gate": case["attempted_export_gate"],
                "expected_error": case["expected_error"],
                "final_export_allowed": False,
                "creates_downstream_artifacts": False,
                "trace_status_required": True,
                "persisted_original_decision_required": True,
                "result": "passed",
            }
        )

    require(len(seen_ids) == len(cases), "override downgrade case IDs must be unique")
    require(
        {
            "safety_override_block_to_admin_review_denied",
            "safety_override_block_to_warn_denied",
            "safety_override_admin_review_to_warn_denied",
            "safety_override_user_confirmation_to_allow_denied",
        } <= seen_ids,
        "override downgrade replay must cover block and hold downgrade attempts",
    )
    return cases


def replay_fixture_links(
    contract: dict[str, Any],
    eval_by_fixture: dict[str, dict[str, Any]],
    trace_by_fixture: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    links = []
    for link in contract["fixture_links"]:
        fixture_id = link["fixture_id"]
        require(fixture_id in eval_by_fixture, f"fixture link missing eval result: {fixture_id}")
        require(fixture_id in trace_by_fixture, f"fixture link missing trace completeness result: {fixture_id}")
        result = eval_by_fixture[fixture_id]
        trace = trace_by_fixture[fixture_id]
        decision = result["safety_decision_contract"]["decision"]
        decision_refs = link["per_point_decision_refs"]
        require(decision == link["expected_safety_action"], f"{fixture_id} safety action mismatch")
        require(trace["trace_id"] == link["trace_id"], f"{fixture_id} trace id mismatch")
        require(trace["safety_status"]["present"] is True, f"{fixture_id} trace safety status must be present")
        require(set(link["required_enforcement_points"]) == SAFETY_POINTS, f"{fixture_id} must cover all safety points")
        require(set(trace["covered_steps"]) == SAFETY_POINTS, f"{fixture_id} trace must cover all safety points")
        require(set(decision_refs) == SAFETY_POINTS, f"{fixture_id} decision refs must cover all safety points")
        events_by_step = {
            event["step_name"]: event
            for event in trace["step_events"]
        }
        require(set(events_by_step) >= SAFETY_POINTS, f"{fixture_id} trace events must cover all safety points")
        per_point_results = []
        for point in link["required_enforcement_points"]:
            event = events_by_step[point]
            decision_ref = event["safety_decision_ref"]
            expected_decision_id = decision_refs[point]
            require(event["safety_status"]["present"] is True, f"{fixture_id} {point} must have trace safety status")
            require(decision_ref["decision_id"] == expected_decision_id, f"{fixture_id} {point} decision ref mismatch")
            require(decision_ref["table"] == "safety_decisions", f"{fixture_id} {point} must persist to safety_decisions")
            require(decision_ref["enforcement_point"] == point, f"{fixture_id} {point} enforcement point mismatch")
            require(decision_ref["decision"] == decision, f"{fixture_id} {point} decision mismatch")
            require(
                decision_ref["decision_source"] == link["expected_decision_source"],
                f"{fixture_id} {point} decision source mismatch",
            )
            require(
                decision_ref["source_rule_ids"] == link["expected_source_rule_ids"],
                f"{fixture_id} {point} source rules mismatch",
            )
            require(
                decision_ref["audit_required"] is (decision != "allow"),
                f"{fixture_id} {point} audit requirement mismatch",
            )
            per_point_results.append(
                {
                    "enforcement_point": point,
                    "trace_id": trace["trace_id"],
                    "decision_id": expected_decision_id,
                    "decision": decision,
                    "decision_source": decision_ref["decision_source"],
                    "source_rule_ids": decision_ref["source_rule_ids"],
                    "audit_required": decision_ref["audit_required"],
                    "result": "passed",
                }
            )
        if link["must_block_final_export"]:
            require(result["qa_export_gate"]["final_export_allowed"] is False, f"{fixture_id} must not allow final export")
            require(result["qa_export_gate"]["safety_blocks_export"] is True, f"{fixture_id} must safety-block final export")
        links.append(
            {
                "fixture_id": fixture_id,
                "trace_id": trace["trace_id"],
                "expected_safety_action": link["expected_safety_action"],
                "observed_safety_action": decision,
                "final_export_allowed": result["qa_export_gate"]["final_export_allowed"],
                "must_block_final_export": link["must_block_final_export"],
                "per_point_decision_refs": per_point_results,
                "result": "passed",
            }
        )
    return links


def replay_decision_redaction_cases(contract: dict[str, Any]) -> list[dict[str, Any]]:
    redaction = contract["decision_redaction_contract"]
    allowed_sources = set(redaction["allowed_rationale_sources"])
    require(
        allowed_sources == {"no_active_safety_rule_matched", "active_safety_rule_matched_enforcement_point"},
        "decision redaction contract must allow only fixed system rationale sources",
    )
    require(
        set(redaction["analytics_payload_policy"]["allowed_properties"]) == ALLOWED_ANALYTICS_PROPERTIES,
        "safety decision analytics payload must stay minimized",
    )
    forbidden_inputs = set(redaction["forbidden_rationale_inputs"])
    require(
        {"brief_text", "provider_request_body", "provider_response_body", "qa_observed_text", "export_manifest"}
        <= forbidden_inputs,
        "decision redaction contract must forbid raw workflow payload surfaces",
    )
    require(
        {"api_key", "session_token", "authorization_header"} <= forbidden_inputs,
        "decision redaction contract must forbid secret-bearing rationale inputs",
    )

    cases = []
    seen_surfaces: set[str] = set()
    for case in redaction["runtime_replay_cases"]:
        seen_surfaces.add(case["input_surface"])
        rationale = case["stored_rationale"]
        analytics_properties = set(case["analytics_properties"])
        require(rationale in ALLOWED_RATIONALES, f"{case['case_id']} stores non-system rationale")
        require(
            analytics_properties == ALLOWED_ANALYTICS_PROPERTIES,
            f"{case['case_id']} analytics payload is not minimized",
        )
        serialized_outputs = json.dumps(
            {
                "rationale": rationale,
                "analytics_properties": sorted(analytics_properties),
            },
            sort_keys=True,
        )
        for fragment in case["forbidden_output_fragments"]:
            require(fragment not in serialized_outputs, f"{case['case_id']} leaks forbidden fragment {fragment!r}")
        require(case["expected_result"] == "redacted_or_not_persisted", f"{case['case_id']} expected result mismatch")
        cases.append(
            {
                "case_id": case["case_id"],
                "input_surface": case["input_surface"],
                "stored_rationale": rationale,
                "analytics_properties": sorted(analytics_properties),
                "forbidden_fragments_absent": True,
                "result": "passed",
            }
        )

    require(seen_surfaces == SAFETY_POINTS, f"decision redaction replay missing surfaces: {sorted(SAFETY_POINTS - seen_surfaces)}")
    return cases


def validate_declared_replay_contract(contract: dict[str, Any], summary: dict[str, Any]) -> None:
    declared = contract["runtime_replay_contract"]
    require(declared["runner"] == RUNNER, "runtime replay contract runner mismatch")
    require(declared["mode"] == "deterministic_fixture_replay", "runtime replay mode mismatch")
    require(declared["status"] == "pass", "runtime replay contract must pass")
    require(declared["transition_gate_cases_replayed"] == summary["transition_gate_cases"], "transition replay count mismatch")
    require(declared["decision_matrix_cases_replayed"] == summary["decision_matrix_cases"], "decision replay count mismatch")
    require(declared["fail_closed_cases_replayed"] == summary["fail_closed_cases"], "fail-closed replay count mismatch")
    require(declared["bypass_prevention_cases_replayed"] == summary["bypass_prevention_cases"], "bypass replay count mismatch")
    require(declared["override_downgrade_cases_replayed"] == summary["override_downgrade_cases"], "override downgrade replay count mismatch")
    require(declared["fixture_link_cases_replayed"] == summary["fixture_link_cases"], "fixture link replay count mismatch")
    require(
        declared["fixture_link_point_decision_refs_replayed"] == summary["fixture_link_point_decision_refs"],
        "fixture link point decision ref replay count mismatch",
    )
    require(
        declared["decision_redaction_cases_replayed"] == summary["decision_redaction_cases"],
        "decision redaction replay count mismatch",
    )
    require(declared["transition_points_replayed"] == summary["transition_points_replayed"], "transition point replay mismatch")
    require(declared["decision_priority_order_validated"] == summary["decision_priority_order_validated"], "decision priority replay mismatch")
    require(
        declared["decision_rationale_sources_validated"] == summary["decision_rationale_sources_validated"],
        "decision rationale source replay mismatch",
    )
    require(
        declared["analytics_payload_minimized"] == summary["analytics_payload_minimized"],
        "analytics payload minimization replay mismatch",
    )
    require(
        declared["held_or_blocked_require_audit_for_all_actions"] == summary["held_or_blocked_require_audit_for_all_actions"],
        "held/block audit replay mismatch",
    )
    require(declared["blocked_or_held_creates_downstream_artifacts"] is False, "blocked/held replay must be fail-closed")
    require(declared["trace_status_required_for_all_transitions"] is True, "all transitions must require trace status")
    require(declared["persisted_decision_required_for_all_actions"] is True, "all actions must require persisted decisions")
    require(declared["trace_decision_refs_replayed"] == summary["trace_decision_refs_replayed"], "trace decision ref replay mismatch")


def run() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    eval_by_fixture = build_eval_result_index()
    trace_by_fixture = build_trace_index()
    decisions = replay_decision_matrix(contract, eval_by_fixture)
    transitions = replay_transition_gates(contract)
    fail_closed = replay_fail_closed_cases(contract)
    bypass = replay_bypass_cases(contract)
    override_downgrades = replay_override_downgrade_cases(contract, eval_by_fixture)
    fixture_links = replay_fixture_links(contract, eval_by_fixture, trace_by_fixture)
    decision_redaction = replay_decision_redaction_cases(contract)

    blocked_or_held = [
        item for item in decisions
        if item["runtime_outcome"] in {"held_for_user_confirmation", "held_for_admin_review", "blocked"}
    ]
    summary = {
        "transition_gate_cases": len(transitions),
        "decision_matrix_cases": len(decisions),
        "fail_closed_cases": len(fail_closed),
        "bypass_prevention_cases": len(bypass),
        "override_downgrade_cases": len(override_downgrades),
        "fixture_link_cases": len(fixture_links),
        "fixture_link_point_decision_refs": sum(len(item["per_point_decision_refs"]) for item in fixture_links),
        "decision_redaction_cases": len(decision_redaction),
        "transition_points_replayed": {item["enforcement_point"] for item in transitions} == SAFETY_POINTS,
        "decision_priority_order_validated": all(
            [item["decision_priority"] for item in decisions if item["enforcement_point"] == point]
            == sorted([item["decision_priority"] for item in decisions if item["enforcement_point"] == point])
            for point in SAFETY_POINTS
        ),
        "decision_rationale_sources_validated": all(item["stored_rationale"] in ALLOWED_RATIONALES for item in decision_redaction),
        "analytics_payload_minimized": all(
            set(item["analytics_properties"]) == ALLOWED_ANALYTICS_PROPERTIES
            for item in decision_redaction
        ),
        "held_or_blocked_require_audit_for_all_actions": all(
            item["audit_required"]
            for item in decisions
            if item["runtime_outcome"] in {"held_for_user_confirmation", "held_for_admin_review", "blocked"}
        ),
        "blocked_or_held_creates_downstream_artifacts": any(item["creates_downstream_artifacts"] for item in blocked_or_held),
        "trace_status_required_for_all_transitions": all(item["trace_status_required"] for item in transitions + bypass),
        "persisted_decision_required_for_all_actions": all(item["persisted_decision_required"] for item in decisions),
        "trace_decision_refs_replayed": all(
            len(item["per_point_decision_refs"]) == len(SAFETY_POINTS)
            and {ref["enforcement_point"] for ref in item["per_point_decision_refs"]} == SAFETY_POINTS
            for item in fixture_links
        ),
    }
    validate_declared_replay_contract(contract, summary)
    return {
        "schema_version": "stage0.rev2",
        "runner": RUNNER,
        "contract": str(CONTRACT.relative_to(ROOT)),
        "status": "pass",
        "summary": summary,
        "transition_gate_results": transitions,
        "fail_closed_results": fail_closed,
        "bypass_prevention_results": bypass,
        "override_downgrade_results": override_downgrades,
        "decision_redaction_results": decision_redaction,
        "fixture_link_results": fixture_links,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="print replay details as JSON")
    args = parser.parse_args()
    try:
        result = run()
    except SafetyReplayError as exc:
        print(f"safety policy runtime replay failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        summary = result["summary"]
        print(
            "safety policy runtime replay passed "
            f"({summary['transition_gate_cases']} transitions, "
            f"{summary['decision_matrix_cases']} decisions, "
            f"{summary['fail_closed_cases']} fail-closed cases, "
            f"{summary['bypass_prevention_cases']} bypass cases, "
            f"{summary['override_downgrade_cases']} override downgrade cases, "
            f"{summary['decision_redaction_cases']} redaction cases)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
