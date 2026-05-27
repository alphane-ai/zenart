#!/usr/bin/env python3
"""Replay Stage 0 Rev2 export override gate decisions from fixtures."""

from __future__ import annotations

import argparse
import json
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

SOURCE_TYPES = {"qa_result", "safety_decision", "export_contract"}
DENIAL_REASONS = {
    "source_not_override_eligible",
    "critical_safety_rule",
    "incomplete_export_artifacts",
    "missing_approval_audit",
}
ADMIN_ROLES = {"admin_reviewer", "admin_superadmin"}


class ExportOverrideReplayError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ExportOverrideReplayError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ExportOverrideReplayError(message)


def build_indexes() -> tuple[
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
    dict[str, dict[str, Any]],
]:
    qa_by_id = {item["check_id"]: item for item in load_json(QA_RESULTS)}
    safety_by_id = {item["rule_id"]: item for item in load_json(SAFETY_RULES)}
    eval_results = load_json(EVAL_RESULTS)
    traces = load_json(TRACE_COMPLETENESS)

    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    eval_by_fixture = {item["fixture_id"]: item for item in eval_results[0]["fixture_results"]}
    trace_by_id = {item["trace_id"]: item for item in traces["traces"]}
    return qa_by_id, safety_by_id, eval_by_fixture, trace_by_id


def expected_denial_reason(decision: dict[str, Any], eval_fixture: dict[str, Any]) -> str:
    if decision["approval_audit"]["approval_audit_complete"] is False:
        return "missing_approval_audit"
    if decision["source_type"] == "safety_decision" and decision["source_severity"] == "critical":
        return "critical_safety_rule"
    if decision["source_gate_before_override"]["export_artifacts_complete"] is False:
        return "incomplete_export_artifacts"
    if decision["source_override_eligible"] is False:
        return "source_not_override_eligible"
    if eval_fixture["safety_decision_contract"]["decision"] == "block":
        return "critical_safety_rule"
    return "source_not_override_eligible"


def source_metadata(
    decision: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    safety_by_id: dict[str, dict[str, Any]],
    eval_fixture: dict[str, Any],
) -> dict[str, Any]:
    source_id = decision["source_id"]
    source_type = decision["source_type"]
    if source_type == "qa_result":
        qa = qa_by_id[source_id]
        return {
            "severity": qa["severity"],
            "override_eligible": qa["export_gate"]["eligible_admin_override"],
            "blocks_export": qa["export_gate"]["blocks_final_export"],
            "source_fixture_id": qa["evidence"]["fixture_id"],
            "source_trace_id": qa["evidence"]["trace_id"],
        }
    if source_type == "safety_decision":
        rule = safety_by_id[source_id]
        return {
            "severity": rule["severity"],
            "override_eligible": rule["admin_override_eligible"],
            "blocks_export": rule["action"] == "block",
            "source_fixture_id": decision["fixture_id"],
            "source_trace_id": decision["trace_id"],
        }
    if source_type == "export_contract":
        qa = qa_by_id[source_id]
        return {
            "severity": qa["severity"],
            "override_eligible": False,
            "blocks_export": not eval_fixture["qa_export_gate"]["export_artifacts_complete"],
            "source_fixture_id": qa["evidence"]["fixture_id"],
            "source_trace_id": qa["evidence"]["trace_id"],
        }
    raise ExportOverrideReplayError(f"{decision['decision_id']} unsupported source type")


def replay_decision(
    decision: dict[str, Any],
    qa_by_id: dict[str, dict[str, Any]],
    safety_by_id: dict[str, dict[str, Any]],
    eval_by_fixture: dict[str, dict[str, Any]],
    trace_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    decision_id = decision["decision_id"]
    fixture_id = decision["fixture_id"]
    trace_id = decision["trace_id"]

    require(decision["source_type"] in SOURCE_TYPES, f"{decision_id} source type unsupported")
    require(decision["requested_by_role"] in ADMIN_ROLES, f"{decision_id} requester must be admin")
    require(decision["resolved_by_role"] in ADMIN_ROLES, f"{decision_id} resolver must be admin")
    require(fixture_id in eval_by_fixture, f"{decision_id} fixture missing from eval results")
    require(trace_id in trace_by_id, f"{decision_id} trace missing from trace completeness")

    eval_fixture = eval_by_fixture[fixture_id]
    trace = trace_by_id[trace_id]
    require(eval_fixture["trace_contract"]["trace_id"] == trace_id, f"{decision_id} eval trace mismatch")
    require(trace["fixture_id"] == fixture_id, f"{decision_id} trace fixture mismatch")
    require(trace["artifact_links"]["export_id"] == decision["export_id"], f"{decision_id} export link mismatch")

    metadata = source_metadata(decision, qa_by_id, safety_by_id, eval_fixture)
    require(metadata["source_fixture_id"] == fixture_id, f"{decision_id} source fixture mismatch")
    require(metadata["source_trace_id"] == trace_id, f"{decision_id} source trace mismatch")
    require(metadata["severity"] == decision["source_severity"], f"{decision_id} source severity mismatch")
    require(
        metadata["override_eligible"] is decision["source_override_eligible"],
        f"{decision_id} source override eligibility mismatch",
    )
    require(metadata["blocks_export"] is True, f"{decision_id} source must block export")
    require(decision["source_blocks_final_export"] is True, f"{decision_id} must model a blocking source")

    before = decision["source_gate_before_override"]
    gate = eval_fixture["qa_export_gate"]
    require(before["final_export_allowed"] is False, f"{decision_id} before gate must be closed")
    require(before["safety_blocks_export"] is gate["safety_blocks_export"], f"{decision_id} safety gate mismatch")
    require(before["export_artifacts_complete"] is gate["export_artifacts_complete"], f"{decision_id} artifact gate mismatch")
    require(before["override_requires_audit"] is True, f"{decision_id} before gate must require audit")
    require(decision["source_id"] in before["blocking_source_ids"], f"{decision_id} source must be a before-gate blocker")

    audit = decision["approval_audit"]
    require(audit["trace_linked"] is True and audit["export_linked"] is True, f"{decision_id} audit must link trace and export")
    if audit["approval_audit_complete"]:
        require(audit["approval_audit_log_id"], f"{decision_id} complete audit requires approval id")
        require(audit["rationale"].strip(), f"{decision_id} complete audit requires rationale")
        require(
            audit["decision_audit_log_id"] != audit["approval_audit_log_id"],
            f"{decision_id} approval audit must differ from request audit",
        )

    can_approve = (
        decision["source_override_eligible"] is True
        and audit["approval_audit_complete"] is True
        and before["export_artifacts_complete"] is True
        and decision["source_severity"] != "critical"
        and gate["safety_blocks_export"] is False
    )
    expected_outcome = "approved" if can_approve else "denied"
    expected_denial = None if can_approve else expected_denial_reason(decision, eval_fixture)
    expected_source_resolved = can_approve

    actual_decision = {
        "outcome": expected_outcome,
        "denial_reason": expected_denial,
        "source_gate_resolved": expected_source_resolved,
    }
    require(
        decision["decision"] == actual_decision,
        f"{decision_id} decision mismatch: expected {actual_decision}, got {decision['decision']}",
    )

    after = decision["expected_export_gate_after_override"]
    expected_remaining_blockers = [
        source_id
        for source_id in before["blocking_source_ids"]
        if not (can_approve and source_id == decision["source_id"])
    ]
    require(
        after["source_block_cleared"] is can_approve,
        f"{decision_id} source clear state mismatch",
    )
    require(
        after["remaining_blocking_source_ids"] == expected_remaining_blockers,
        f"{decision_id} remaining blockers mismatch",
    )

    remaining_reasons = set(after["remaining_gate_reasons"])
    if not eval_fixture["qa_coverage_contract"]["coverage_complete"] and decision["source_type"] == "qa_result":
        require("unresolved_qa_coverage" in remaining_reasons, f"{decision_id} unresolved QA coverage must remain explicit")
    if before["export_artifacts_complete"] is False:
        require("incomplete_export_artifacts" in remaining_reasons, f"{decision_id} incomplete artifacts must remain explicit")
    if gate["safety_blocks_export"]:
        require("critical_safety_block" in remaining_reasons, f"{decision_id} critical safety block must remain explicit")
    if not can_approve and decision["source_type"] == "qa_result" and decision["source_override_eligible"] is False:
        require("non_overrideable_qa_block" in remaining_reasons, f"{decision_id} non-overrideable QA block must remain explicit")
    if not can_approve and not audit["approval_audit_complete"]:
        require("missing_approval_audit" in remaining_reasons, f"{decision_id} missing audit must remain explicit")

    final_allowed = (
        can_approve
        and not expected_remaining_blockers
        and not remaining_reasons
        and gate["export_artifacts_complete"]
        and eval_fixture["qa_coverage_contract"]["coverage_complete"]
        and not gate["safety_blocks_export"]
    )
    require(after["final_export_allowed"] is final_allowed, f"{decision_id} final export allowance mismatch")

    return {
        "decision_id": decision_id,
        "source_type": decision["source_type"],
        "fixture_id": fixture_id,
        "trace_id": trace_id,
        "export_id": decision["export_id"],
        "actual_decision": actual_decision,
        "expected_export_gate_after_override": after,
        "result": "passed",
    }


def replay_contract() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    qa_by_id, safety_by_id, eval_by_fixture, trace_by_id = build_indexes()

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "override contract must cite Rev2")
    replay = contract["replay_contract"]
    require(replay["runner"] == "scripts/run_export_override_contract.py", "override replay runner mismatch")
    require(
        replay["check_command"] == "python3 scripts/run_export_override_contract.py --check",
        "override replay check command mismatch",
    )
    require(replay["requires_eval_result_link"] is True, "override replay must require eval result links")
    require(replay["requires_trace_export_link"] is True, "override replay must require trace export links")
    require(replay["requires_qa_source_link"] is True, "override replay must require QA source links")
    require(replay["requires_safety_source_link"] is True, "override replay must require safety source links")
    require(replay["denies_critical_safety_override"] is True, "override replay must deny critical safety overrides")
    require(replay["denies_incomplete_export_artifact_override"] is True, "override replay must deny incomplete exports")
    require(replay["denies_missing_audit_override"] is True, "override replay must deny missing audit overrides")
    require(replay["approved_override_keeps_other_gate_reasons_closed"] is True, "approved override must preserve remaining blockers")

    seen_source_types: set[str] = set()
    seen_denial_reasons: set[str] = set()
    results = []
    for decision in contract["decisions"]:
        result = replay_decision(decision, qa_by_id, safety_by_id, eval_by_fixture, trace_by_id)
        results.append(result)
        seen_source_types.add(decision["source_type"])
        if decision["decision"]["denial_reason"] is not None:
            seen_denial_reasons.add(decision["decision"]["denial_reason"])

    require(SOURCE_TYPES <= seen_source_types, f"override replay missing source types: {sorted(SOURCE_TYPES - seen_source_types)}")
    require(
        DENIAL_REASONS <= seen_denial_reasons,
        f"override replay missing denial reasons: {sorted(DENIAL_REASONS - seen_denial_reasons)}",
    )
    require(replay["cases_replayed"] == len(results), "override replay case count mismatch")

    return {
        "schema_version": "stage0.rev2",
        "contract_path": str(CONTRACT.relative_to(ROOT)),
        "runner": "scripts/run_export_override_contract.py",
        "cases_checked": len(results),
        "case_results": results,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate export override replay cases")
    parser.add_argument("--json", action="store_true", help="print deterministic replay results as JSON")
    args = parser.parse_args()

    try:
        result = replay_contract()
    except ExportOverrideReplayError as exc:
        print(f"export override replay contract failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"export override replay contract passed ({result['cases_checked']} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
