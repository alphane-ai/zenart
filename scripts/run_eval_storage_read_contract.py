#!/usr/bin/env python3
"""Run deterministic Stage 0 Rev2 eval storage read-contract cases."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage0" / "rev2" / "eval" / "eval_storage_contract.json"

QUERY_FILTERS = {
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "subject_version",
    "status",
    "completed_after",
    "latest_only",
}

QUERY_FIELDS = QUERY_FILTERS | {
    "page_token",
    "page_size",
}


class EvalStorageReadContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalStorageReadContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalStorageReadContractError(message)


def parse_rfc3339(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvalStorageReadContractError(f"invalid fixture timestamp {value}") from exc


def row_sort_key(row: dict[str, Any]) -> tuple[datetime, datetime]:
    return (parse_rfc3339(row["completed_at"]), parse_rfc3339(row["created_at"]))


def apply_read_query(
    rows: list[dict[str, Any]],
    query: dict[str, Any],
    latest_group_fields: list[str],
) -> tuple[list[dict[str, Any]], str]:
    require("tenant_id" in query, "eval result reads must include tenant_id")
    require("latest_only" in query, "eval result reads must include latest_only")
    require(
        set(query) <= QUERY_FIELDS,
        f"unsupported query filters: {sorted(set(query) - QUERY_FIELDS)}",
    )

    filtered = [row for row in rows if row["tenant_id"] == query["tenant_id"]]
    for field in ["eval_suite_id", "subject_type", "subject_id", "subject_version", "status"]:
        if field in query:
            filtered = [row for row in filtered if row[field] == query[field]]

    if "completed_after" in query:
        completed_after = parse_rfc3339(query["completed_after"])
        filtered = [
            row
            for row in filtered
            if parse_rfc3339(row["completed_at"]) > completed_after
        ]

    ordered = sorted(filtered, key=row_sort_key, reverse=True)
    if not query["latest_only"]:
        filtered_ordered = ordered
    else:
        filtered_ordered: list[dict[str, Any]] = []
        seen_groups: set[tuple[str, ...]] = set()
        for row in ordered:
            group = tuple(row[field] for field in latest_group_fields)
            if group in seen_groups:
                continue
            seen_groups.add(group)
            filtered_ordered.append(row)

    page_token = query.get("page_token", "")
    if page_token:
        require(isinstance(page_token, str) and page_token.startswith("after:"), "page_token must use after:<result_id>")
        after_id = page_token.removeprefix("after:")
        matching_indexes = [index for index, row in enumerate(filtered_ordered) if row["id"] == after_id]
        require(matching_indexes, f"page_token references a result outside the filtered page: {after_id}")
        filtered_ordered = filtered_ordered[matching_indexes[0] + 1 :]

    page_size = query.get("page_size", 25)
    require(isinstance(page_size, int), "page_size must be an integer")
    require(1 <= page_size <= 100, "page_size must be between 1 and 100")

    page = filtered_ordered[:page_size]
    if len(filtered_ordered) > page_size:
        next_page_token = f"after:{page[-1]['id']}"
    else:
        next_page_token = ""
    return page, next_page_token


def run_read_contract() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval storage contract must cite Rev2")
    read_contract = contract["read_contract"]
    fixture = contract["read_fixture_contract"]
    rows = fixture["fixture_rows"]
    latest_group_fields = fixture["latest_only_groups_by"]

    require(read_contract["tenant_filter_required"] is True, "read contract must require tenant filtering")
    require(set(read_contract["pagination_parameters"]) == {"PageToken", "PageSize"}, "read contract pagination parameters mismatch")
    require(read_contract["cursor_token_format"] == "after_result_id", "read contract cursor token format mismatch")
    require(
        read_contract["page_size_bounds"] == {"minimum": 1, "maximum": 100, "default": 25},
        "read contract page size bounds mismatch",
    )
    require(fixture["tenant_filter_required"] is True, "read fixture must require tenant filtering")
    require(fixture["ordering"] == ["completed_at_desc", "created_at_desc"], "read fixture ordering mismatch")
    require(read_contract["latest_result_order"] == "completed_at_desc", "read contract latest order mismatch")
    require(read_contract["stable_tie_break_order"] == "created_at_desc", "read contract tie-break mismatch")
    require(
        read_contract["subject_latest_resolution"] == "tenant_suite_subject_version_runner_hash",
        "read contract latest-only grouping scope mismatch",
    )
    require(
        set(read_contract["required_query_filters"]) == QUERY_FILTERS,
        "read contract query filters mismatch",
    )

    row_ids = [row["id"] for row in rows]
    require(len(row_ids) == len(set(row_ids)), "read fixture row ids must be unique")
    for row in rows:
        require(row["tenant_id"].startswith("tenant_"), f"{row['id']} must be tenant-scoped")
        parse_rfc3339(row["completed_at"])
        parse_rfc3339(row["created_at"])

    executed_cases: list[dict[str, Any]] = []
    for section_name in ["cases", "pagination_cases", "expected_empty_cases"]:
        for case in fixture[section_name]:
            page, next_page_token = apply_read_query(rows, case["query"], latest_group_fields)
            actual_ids = [
                row["id"]
                for row in page
            ]
            expected_ids = case["expected_result_ids"]
            require(
                actual_ids == expected_ids,
                f"{case['case_id']} read fixture mismatch: expected {expected_ids}, got {actual_ids}",
            )
            require(
                next_page_token == case.get("expected_next_page_token", ""),
                f"{case['case_id']} next page token mismatch: expected {case.get('expected_next_page_token', '')}, got {next_page_token}",
            )
            require(
                all(row_id in row_ids for row_id in expected_ids),
                f"{case['case_id']} expects unknown rows",
            )
            if expected_ids:
                expected_tenants = {
                    row["tenant_id"]
                    for row in rows
                    if row["id"] in set(expected_ids)
                }
                require(
                    expected_tenants == {case["query"]["tenant_id"]},
                    f"{case['case_id']} expected rows cross tenant scope",
                )
            else:
                require(
                    section_name == "expected_empty_cases",
                    f"{case['case_id']} positive read case must return rows",
                )
            executed_cases.append(
                {
                    "case_id": case["case_id"],
                    "actual_result_ids": actual_ids,
                    "expected_result_ids": expected_ids,
                    "actual_next_page_token": next_page_token,
                    "expected_next_page_token": case.get("expected_next_page_token", ""),
                }
            )

    return {
        "schema_version": "stage0.rev2",
        "contract_path": str(CONTRACT.relative_to(ROOT)),
        "runner": "scripts/run_eval_storage_read_contract.py",
        "cases_checked": len(executed_cases),
        "case_results": executed_cases,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="validate read fixture cases")
    parser.add_argument("--json", action="store_true", help="print deterministic case results as JSON")
    args = parser.parse_args()

    try:
        result = run_read_contract()
    except EvalStorageReadContractError as exc:
        print(f"eval storage read contract failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"eval storage read contract passed ({result['cases_checked']} cases)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
