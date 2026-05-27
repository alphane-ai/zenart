#!/usr/bin/env python3
"""Run deterministic Stage 0 Rev2 eval storage write-contract cases."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "eval_storage_contract.json"

IDEMPOTENCY_FIELDS = {
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "subject_version",
    "runner_sha256",
}

RESULT_DIGEST_FIELDS = {
    "status",
    "summary",
    "fixture_results",
    "completed_at",
    "source_fixture_digests",
}

DIGEST_FIELD_MAP = {
    "status": "status",
    "summary": "summary_sha256",
    "fixture_results": "fixture_results_sha256",
    "completed_at": "completed_at",
    "source_fixture_digests": "source_fixture_digests_sha256",
}


class EvalStorageWriteContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalStorageWriteContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalStorageWriteContractError(message)


def row_key(row: dict[str, Any], fields: set[str]) -> tuple[str, ...]:
    return tuple(str(row[field]) for field in sorted(fields))


def row_digest(row: dict[str, Any], fields: set[str]) -> tuple[str, ...]:
    return tuple(str(row[DIGEST_FIELD_MAP[field]]) for field in sorted(fields))


def resolve_write_case(case: dict[str, Any], key_fields: set[str], digest_fields: set[str]) -> dict[str, Any]:
    existing = case["existing_row"]
    attempted = case["attempted_write"]
    expected = case["expected_outcome"]

    same_key = row_key(existing, key_fields) == row_key(attempted, key_fields)
    same_digest = row_digest(existing, digest_fields) == row_digest(attempted, digest_fields)

    if not same_key:
        actual = {
            "action": "insert_new_row",
            "stored_row_source": "attempted_write",
            "requires_admin_audit": False,
            "activation_allowed": False,
            "reason": "cross_tenant_insert_allowed",
        }
    elif same_digest:
        actual = {
            "action": "return_existing_row",
            "stored_row_source": "existing_row",
            "requires_admin_audit": False,
            "activation_allowed": False,
            "reason": "exact_idempotent_replay",
        }
    elif existing["source_fixture_digests_sha256"] != attempted["source_fixture_digests_sha256"]:
        actual = {
            "action": "reject_conflict",
            "stored_row_source": "none",
            "requires_admin_audit": True,
            "activation_allowed": False,
            "reason": "source_fixture_digest_conflict",
        }
    else:
        actual = {
            "action": "reject_conflict",
            "stored_row_source": "none",
            "requires_admin_audit": True,
            "activation_allowed": False,
            "reason": "divergent_replay_summary_conflict",
        }

    require(
        actual == expected,
        f"{case['case_id']} write fixture mismatch: expected {expected}, got {actual}",
    )
    return actual


def run_write_contract() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval storage contract must cite Rev2")
    write = contract["write_contract"]
    fixture = contract["write_fixture_contract"]

    require(write["write_runner"] == "scripts/run_eval_storage_write_contract.py", "write contract runner mismatch")
    require(
        write["check_command"] == "python3 scripts/run_eval_storage_write_contract.py --check",
        "write contract check command mismatch",
    )
    require(set(write["idempotency_key_fields"]) == IDEMPOTENCY_FIELDS, "write idempotency fields mismatch")
    require(set(fixture["idempotency_key_fields"]) == IDEMPOTENCY_FIELDS, "write fixture idempotency fields mismatch")
    require(set(fixture["result_digest_fields"]) == RESULT_DIGEST_FIELDS, "write fixture digest fields mismatch")

    executed_cases: list[dict[str, Any]] = []
    for case in fixture["cases"]:
        actual = resolve_write_case(case, IDEMPOTENCY_FIELDS, RESULT_DIGEST_FIELDS)
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
        "runner": "scripts/run_eval_storage_write_contract.py",
        "cases_checked": len(executed_cases),
        "case_results": executed_cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate write fixture cases")
    parser.add_argument("--json", action="store_true", help="print deterministic case results as JSON")
    args = parser.parse_args()

    try:
        result = run_write_contract()
    except EvalStorageWriteContractError as exc:
        print(f"eval storage write contract failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"eval storage write contract passed ({result['cases_checked']} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
