#!/usr/bin/env python3
"""Validate Stage 0 Rev2 eval-to-package readiness links."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
CONTRACT = FIXTURE_DIR / "eval" / "eval_package_readiness_contract.json"
EVAL_RESULTS = FIXTURE_DIR / "eval" / "starter_eval_results.json"
QA_RESULTS = FIXTURE_DIR / "eval" / "qa_results.json"
SAFETY_RULES = FIXTURE_DIR / "eval" / "safety_rules.json"
TRACE_COMPLETENESS = FIXTURE_DIR / "eval" / "trace_completeness.json"
WORKFLOW_DIR = FIXTURE_DIR / "workflows"
RUNNER = ROOT / "scripts" / "run_stage0_eval.py"

EXPORT_ARTIFACT_KEYS = [
    "manifest",
    "metadata",
    "qa_report",
    "trace_provenance",
    "safety_disclaimer_when_applicable",
]

ARTIFACT_LABELS = {
    "safety_disclaimer_when_applicable": "safety_disclaimer",
}

BLOCKING_SAFETY_DECISIONS = {
    "block",
    "require_user_confirmation",
    "require_admin_review",
}

WORKFLOWS = {
    "ecommerce_growth_pack",
    "business_visual_doc_pack",
    "local_merchant_campaign_pack",
    "character_ip_concept_pack",
}


class EvalPackageReadinessError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalPackageReadinessError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalPackageReadinessError(message)


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def artifact_label(key: str) -> str:
    return ARTIFACT_LABELS.get(key, key)


def expected_case(fixture: dict[str, Any], trace: dict[str, Any]) -> dict[str, Any]:
    export_contract = fixture["export_contract"]
    gate = fixture["qa_export_gate"]
    missing = [
        artifact_label(key)
        for key in EXPORT_ARTIFACT_KEYS
        if export_contract[key] is False
    ]
    retained = [
        artifact_label(key)
        for key in EXPORT_ARTIFACT_KEYS
        if export_contract[key] is True
    ]
    return {
        "case_id": "package_readiness_" + fixture["fixture_id"].removeprefix("fx_"),
        "fixture_id": fixture["fixture_id"],
        "workflow": fixture["workflow"],
        "trace_id": fixture["trace_contract"]["trace_id"],
        "package_id": trace["artifact_links"]["package_id"],
        "export_id": trace["artifact_links"]["export_id"],
        "eval_status": fixture["status"],
        "qa_check_ids": fixture["qa_check_ids"],
        "safety_rule_ids": fixture["safety_decision_contract"]["source_rule_ids"],
        "candidate_count": fixture["candidate_count"],
        "qa_coverage_complete": fixture["qa_coverage_contract"]["coverage_complete"],
        "export_artifacts_complete": gate["export_artifacts_complete"],
        "missing_export_artifacts": missing,
        "final_export_allowed": gate["final_export_allowed"],
        "package_download_allowed": gate["final_export_allowed"],
        "expected_export_state": "download_allowed" if gate["final_export_allowed"] else "blocked_retained",
        "denial_reasons": gate["denial_reasons"],
        "retained_artifacts_when_blocked": [] if gate["final_export_allowed"] else retained,
    }


def validate_runner_replay(contract: dict[str, Any], eval_result: dict[str, Any]) -> None:
    replay = contract["runner_replay"]
    runner_contract = eval_result["runner_contract"]
    require(replay["runner"] == runner_contract["runner"], "runner path must match stored eval result")
    require(replay["runner_sha256"] == runner_contract["runner_sha256"], "runner SHA must match stored eval result")
    require(
        replay["source_fixture_digests"] == runner_contract["source_fixture_digests"],
        "source fixture digests must match stored eval result",
    )
    for item in replay["source_fixture_digests"]:
        path = ROOT / item["path"]
        require(path.exists(), f"source fixture digest path missing: {item['path']}")
        require(file_sha256(path) == item["sha256"], f"source fixture digest mismatch: {item['path']}")

    result = subprocess.run(
        [sys.executable, str(RUNNER), "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        result.returncode == 0,
        "eval runner exact replay failed: " + (result.stderr or result.stdout).strip(),
    )


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    eval_results = load_json(EVAL_RESULTS)
    qa_results = load_json(QA_RESULTS)
    safety_rules = load_json(SAFETY_RULES)
    trace_contract = load_json(TRACE_COMPLETENESS)
    workflows = {path.stem: load_json(path) for path in sorted(WORKFLOW_DIR.glob("*.json"))}

    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "readiness contract must cite Rev2")
    require(set(workflows) == WORKFLOWS, "readiness contract must resolve all four workflow fixtures")
    require(isinstance(eval_results, list) and len(eval_results) == 1, "starter eval results must contain one result")
    eval_result = eval_results[0]
    validate_runner_replay(contract, eval_result)

    qa_by_id = {item["check_id"]: item for item in qa_results}
    safety_by_id = {item["rule_id"]: item for item in safety_rules}
    trace_by_id = {item["trace_id"]: item for item in trace_contract["traces"]}
    eval_by_fixture = {item["fixture_id"]: item for item in eval_result["fixture_results"]}
    cases_by_fixture = {item["fixture_id"]: item for item in contract["readiness_cases"]}

    require(len(qa_by_id) == len(qa_results), "QA result check IDs must be unique")
    require(len(safety_by_id) == len(safety_rules), "safety rule IDs must be unique")
    require(len(trace_by_id) == len(trace_contract["traces"]), "trace IDs must be unique")
    require(len(cases_by_fixture) == len(contract["readiness_cases"]), "readiness cases must be unique per fixture")
    require(set(cases_by_fixture) == set(eval_by_fixture), "readiness cases must cover every eval fixture exactly")

    policy = contract["package_readiness_policy"]
    for key, value in policy.items():
        require(value is True, f"package readiness policy {key} must be true")

    workflows_seen: set[str] = set()
    blocked_cases = 0
    for fixture_id, fixture in eval_by_fixture.items():
        workflows_seen.add(fixture["workflow"])
        case = cases_by_fixture[fixture_id]
        trace_id = fixture["trace_contract"]["trace_id"]
        require(trace_id in trace_by_id, f"{fixture_id} trace missing from trace completeness")
        trace = trace_by_id[trace_id]
        expected = expected_case(fixture, trace)
        require(case == expected, f"{fixture_id} readiness case diverges from eval/trace source records")

        require(workflows[fixture["workflow"]]["workflow_id"] == fixture["workflow"], f"{fixture_id} workflow fixture mismatch")
        require(trace["fixture_id"] == fixture_id, f"{fixture_id} trace fixture mismatch")
        require(trace["workflow"] == fixture["workflow"], f"{fixture_id} trace workflow mismatch")
        require(trace["artifact_links"]["package_id"] == case["package_id"], f"{fixture_id} package link mismatch")
        require(trace["artifact_links"]["export_id"] == case["export_id"], f"{fixture_id} export link mismatch")
        require(trace["export_references"]["trace_provenance"] is True, f"{fixture_id} must retain trace provenance")

        for check_id in case["qa_check_ids"]:
            require(check_id in qa_by_id, f"{fixture_id} readiness case references unknown QA check {check_id}")
            require(qa_by_id[check_id]["evidence"]["fixture_id"] == fixture_id, f"{fixture_id} QA fixture link mismatch")
            require(qa_by_id[check_id]["evidence"]["trace_id"] == trace_id, f"{fixture_id} QA trace link mismatch")
        for rule_id in case["safety_rule_ids"]:
            require(rule_id in safety_by_id, f"{fixture_id} readiness case references unknown safety rule {rule_id}")
            require(fixture_id in safety_by_id[rule_id]["eval_fixture_links"], f"{fixture_id} safety rule fixture link mismatch")

        gate = fixture["qa_export_gate"]
        safety_decision = fixture["safety_decision_contract"]["decision"]
        expected_allowed = (
            fixture["status"] == "pass"
            and fixture["qa_coverage_contract"]["coverage_complete"] is True
            and gate["export_artifacts_complete"] is True
            and not gate["blocking_qa_check_ids"]
            and safety_decision not in BLOCKING_SAFETY_DECISIONS
        )
        require(gate["final_export_allowed"] is expected_allowed, f"{fixture_id} final export gate mismatch")
        require(case["package_download_allowed"] is expected_allowed, f"{fixture_id} package download gate mismatch")
        if expected_allowed:
            require(case["expected_export_state"] == "download_allowed", f"{fixture_id} pass case must allow download")
            require(case["denial_reasons"] == [], f"{fixture_id} pass case cannot carry denial reasons")
            require(case["retained_artifacts_when_blocked"] == [], f"{fixture_id} pass case cannot carry blocked retention")
        else:
            blocked_cases += 1
            require(case["expected_export_state"] == "blocked_retained", f"{fixture_id} blocked case state mismatch")
            require(case["denial_reasons"], f"{fixture_id} blocked case must name denial reasons")
            require(case["package_download_allowed"] is False, f"{fixture_id} blocked case cannot allow package download")
            require("trace_provenance" in case["retained_artifacts_when_blocked"], f"{fixture_id} blocked case must retain trace provenance")

    require(workflows_seen == WORKFLOWS, "readiness cases must cover all four vertical workflows")
    require(blocked_cases > 0, "readiness contract must include blocked export examples")


def main() -> int:
    try:
        validate_contract()
    except EvalPackageReadinessError as exc:
        print(f"eval package readiness validation failed: {exc}", file=sys.stderr)
        return 1
    print("eval package readiness validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
