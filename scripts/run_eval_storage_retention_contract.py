#!/usr/bin/env python3
"""Run deterministic Stage 0 Rev2 eval storage retention-contract cases."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "eval_storage_contract.json"

RETAINED_STATUSES = {"pass", "fail", "blocked"}


class EvalStorageRetentionContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalStorageRetentionContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalStorageRetentionContractError(message)


def parse_rfc3339(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvalStorageRetentionContractError(f"invalid fixture timestamp {value}") from exc
    require(parsed.tzinfo is not None, f"timestamp must include timezone: {value}")
    return parsed


def resolve_retention_case(
    case: dict[str, Any],
    retention: dict[str, Any],
    evaluation_time: datetime,
) -> dict[str, Any]:
    rows = case["rows"]
    row_ids = [row["id"] for row in rows]
    require(len(row_ids) == len(set(row_ids)), f"{case['case_id']} row ids must be unique")

    for row in rows:
        require(row["status"] in RETAINED_STATUSES, f"{row['id']} status must be retained")
        require(row["summary_json_present"] is True, f"{row['id']} must retain summary JSON")
        require(row["runner_sha256_present"] is True, f"{row['id']} must retain runner hash")
        completed_at = parse_rfc3339(row["completed_at"])
        parse_rfc3339(row["created_at"])
        age_days = (evaluation_time - completed_at).days
        require(age_days >= 0, f"{row['id']} cannot complete after retention evaluation time")

    if case["operation"] == "read_results":
        actual = {
            "action": "return_retained_rows",
            "retained_result_ids": row_ids,
            "denied_result_ids": [],
            "audit_required": False,
            "row_retained": retention["retain_pass_fail_blocked_results"],
            "summary_json_retained": retention["retain_summary_json"],
            "runner_sha256_retained": retention["retain_runner_hash"],
            "status_retained": True,
            "reason": "minimum_retention_window_keeps_eval_history",
        }
    elif case["actor"] == "public_api" and case["operation"] == "delete_result":
        actual = {
            "action": "deny_no_public_delete_operation",
            "retained_result_ids": row_ids,
            "denied_result_ids": row_ids,
            "audit_required": retention["deletion_requires_admin_audit"],
            "row_retained": retention["retain_pass_fail_blocked_results"],
            "summary_json_retained": retention["retain_summary_json"],
            "runner_sha256_retained": retention["retain_runner_hash"],
            "status_retained": True,
            "reason": "public_delete_endpoint_absent",
        }
    elif case["operation"] == "delete_result" and not case["audit_ref"]:
        actual = {
            "action": "reject_missing_admin_audit",
            "retained_result_ids": row_ids,
            "denied_result_ids": row_ids,
            "audit_required": retention["deletion_requires_admin_audit"],
            "row_retained": retention["retain_pass_fail_blocked_results"],
            "summary_json_retained": retention["retain_summary_json"],
            "runner_sha256_retained": retention["retain_runner_hash"],
            "status_retained": True,
            "reason": "admin_audit_required_before_deletion",
        }
    elif case["operation"] == "redact_summary" and case["audit_ref"]:
        actual = {
            "action": "allow_audited_redaction",
            "retained_result_ids": row_ids,
            "denied_result_ids": [],
            "audit_required": retention["redaction_requires_admin_audit"],
            "row_retained": retention["retain_pass_fail_blocked_results"],
            "summary_json_retained": retention["retain_summary_json"],
            "runner_sha256_retained": retention["retain_runner_hash"],
            "status_retained": True,
            "reason": "audited_redaction_preserves_gate_evidence",
        }
    else:
        raise EvalStorageRetentionContractError(f"{case['case_id']} has unsupported retention operation")

    expected = case["expected_outcome"]
    require(
        actual == expected,
        f"{case['case_id']} retention fixture mismatch: expected {expected}, got {actual}",
    )
    return actual


def run_retention_contract() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval storage contract must cite Rev2")
    retention = contract["retention_contract"]
    fixture = contract["retention_fixture_contract"]

    require(
        fixture["retention_runner"] == "scripts/run_eval_storage_retention_contract.py",
        "retention contract runner mismatch",
    )
    require(
        fixture["check_command"] == "python3 scripts/run_eval_storage_retention_contract.py --check",
        "retention contract check command mismatch",
    )
    for field in [
        "retain_pass_fail_blocked_results",
        "retain_summary_json",
        "retain_runner_hash",
        "deletion_requires_admin_audit",
        "redaction_requires_admin_audit",
        "no_public_delete_operation",
    ]:
        require(retention[field] is True, f"retention contract must set {field}")
    require(retention["minimum_retention_days"] >= 365, "eval result retention must be at least 365 days")

    evaluation_time = parse_rfc3339(fixture["evaluation_time"])
    executed_cases: list[dict[str, Any]] = []
    for case in fixture["cases"]:
        actual = resolve_retention_case(case, retention, evaluation_time)
        executed_cases.append(
            {
                "case_id": case["case_id"],
                "actual_outcome": actual,
                "expected_outcome": case["expected_outcome"],
            }
        )

    return {
        "schema_version": "stage0.rev2",
        "contract_path": str(CONTRACT.relative_to(ROOT)),
        "runner": "scripts/run_eval_storage_retention_contract.py",
        "cases_checked": len(executed_cases),
        "case_results": executed_cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate retention fixture cases")
    parser.add_argument("--json", action="store_true", help="print deterministic case results as JSON")
    args = parser.parse_args()

    try:
        result = run_retention_contract()
    except EvalStorageRetentionContractError as exc:
        print(f"eval storage retention contract failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"eval storage retention contract passed ({result['cases_checked']} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
