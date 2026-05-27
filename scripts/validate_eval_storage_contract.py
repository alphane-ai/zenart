#!/usr/bin/env python3
"""Validate Stage 0 Rev2 eval result storage, replay, and release-gate contracts."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
CONTRACT = FIXTURE_DIR / "eval_storage_contract.json"
RESULTS = FIXTURE_DIR / "starter_eval_results.json"
ACTIVATION = FIXTURE_DIR / "activation_gate_contract.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"
RUNNER = ROOT / "scripts" / "run_stage0_eval.py"
READ_RUNNER = ROOT / "scripts" / "run_eval_storage_read_contract.py"
WRITE_RUNNER = ROOT / "scripts" / "run_eval_storage_write_contract.py"

STORAGE_COLUMNS = {
    "id",
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "subject_version",
    "status",
    "summary",
    "runner",
    "runner_sha256",
    "completed_at",
    "created_at",
}

STORAGE_INDEXES = {
    "idx_eval_results_tenant_suite_subject_created_at",
    "idx_eval_results_subject_status_completed_at",
}

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

IDEMPOTENCY_FIELDS = {
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "subject_version",
    "runner_sha256",
}

LATEST_ONLY_GROUP_FIELDS = {
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "subject_version",
    "runner_sha256",
}

OPENAPI_PARAMETERS = {
    "PageToken",
    "PageSize",
    "TenantIdFilter",
    "StatusFilter",
    "EvalSuiteIdFilter",
    "EvalSubjectTypeFilter",
    "SubjectIdFilter",
    "SubjectVersionFilter",
    "CompletedAfterFilter",
    "EvalLatestOnlyFilter",
}

SUMMARY_PROJECTION_FIELDS = {
    "total_fixtures",
    "passed_fixtures",
    "failed_fixtures",
    "blocked_fixtures",
    "golden_passed",
    "critical_safety_regressions",
    "regression_pass_rate",
    "trace_complete",
    "export_contract_complete",
    "qa_fixture_coverage_complete",
    "qa_categories_covered",
    "safety_enforcement_points_covered",
}

FIXTURE_RESULT_PROJECTION_FIELDS = {
    "fixture_id",
    "category",
    "workflow",
    "status",
    "expected_safety_action",
    "observed_safety_action",
    "safety_decision_contract",
    "qa_check_ids",
    "qa_coverage_contract",
    "trace_contract",
    "export_contract",
    "qa_export_gate",
    "failure_reasons",
}


class EvalStorageContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalStorageContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalStorageContractError(message)


def runner_sha256() -> str:
    content = RUNNER.read_text(encoding="utf-8")
    normalized = "\n".join(
        '            "runner_sha256": "<self>",' if '"runner_sha256": runner_digest' in line else line
        for line in content.splitlines()
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def expected_source_fixture_digests(contract: dict[str, Any]) -> list[dict[str, str]]:
    source_paths: list[Path] = []
    for source in contract["replay_contract"]["source_fixtures"]:
        source_path = ROOT / source
        if source_path.is_dir():
            source_paths.extend(sorted(source_path.glob("*.json")))
        else:
            source_paths.append(source_path)
    return [
        {
            "path": str(path.relative_to(ROOT)),
            "sha256": file_sha256(path),
        }
        for path in source_paths
    ]


def path_block(openapi_text: str, path: str) -> str:
    match = re.search(
        rf"^  {re.escape(path)}:\n(?P<body>.*?)(?=^  /|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(match is not None, f"OpenAPI path {path} missing")
    return match.group("body")


def schema_block(openapi_text: str, schema_name: str) -> str:
    match = re.search(
        rf"^    {schema_name}:\n(?P<body>.*?)(?=^    [A-Za-z0-9]+:|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(match is not None, f"OpenAPI schema {schema_name} missing")
    return match.group("body")


def validate_stored_result(contract: dict[str, Any], result: dict[str, Any]) -> None:
    stored = contract["stored_result_fixture"]
    require(stored["result_id"] == result["result_id"], "stored result_id must match eval result fixture")
    require(stored["suite_id"] == result["suite_id"], "stored suite_id must match eval result fixture")
    require(stored["status"] == result["status"], "stored status must match eval result fixture")
    require(result["completed_at"], "stored eval result must persist completed_at")
    require(result["created_at"], "stored eval result must persist created_at")
    require(
        result["completed_at"] == result["created_at"],
        "stored eval result fixture must use deterministic matching timestamps",
    )
    require(
        stored["candidate_status_after_eval"] == result["subject"]["candidate_status_after_eval"],
        "stored candidate_status_after_eval must match eval result fixture",
    )
    require(stored["runner_sha256_required"] is True, "stored result must require runner sha256")
    require(
        result["runner_contract"]["runner_sha256"] == runner_sha256(),
        "stored result runner hash must match deterministic runner digest",
    )
    require(
        result["runner_contract"]["source_fixture_digests"] == expected_source_fixture_digests(contract),
        "stored result source fixture digests must match replay sources",
    )


def validate_table_contract(contract: dict[str, Any], result: dict[str, Any]) -> None:
    migration = MIGRATION.read_text(encoding="utf-8")
    table = contract["table_contract"]
    result_storage = result["storage_contract"]

    require(table["table"] == "eval_results", "storage contract must target eval_results")
    require("CREATE TABLE IF NOT EXISTS eval_results" in migration, "eval_results table missing")
    require(set(table["required_columns"]) == STORAGE_COLUMNS, "eval storage required columns mismatch")
    require(set(result_storage["required_columns"]) == STORAGE_COLUMNS, "eval result fixture storage columns mismatch")
    for column in STORAGE_COLUMNS:
        require(column in migration, f"eval_results migration missing {column}")
    require("tenant_id text NOT NULL REFERENCES tenants(id)" in migration, "eval_results must be tenant scoped")
    require("summary jsonb NOT NULL" in migration, "eval_results summary must be persisted as jsonb")
    require("runner_sha256 text NOT NULL" in migration, "eval_results must persist runner_sha256")
    require("completed_at timestamptz NOT NULL" in migration, "eval_results must persist completed_at")

    require(set(table["required_indexes"]) == STORAGE_INDEXES, "eval storage required indexes mismatch")
    require(set(result_storage["required_indexes"]) == STORAGE_INDEXES, "eval result fixture storage indexes mismatch")
    for index in STORAGE_INDEXES:
        require(index in migration, f"eval_results migration missing index {index}")

    require(table["tenant_scoped"] is True, "eval storage must be tenant scoped")
    require(table["subject_scoped"] is True, "eval storage must be subject scoped")
    require(table["summary_json_contains_fixture_results"] is True, "eval storage summary must contain fixture results")
    require(
        set(table["summary_projection_fields"]) == SUMMARY_PROJECTION_FIELDS,
        "eval storage summary projection fields mismatch",
    )
    require(
        set(table["fixture_result_projection_fields"]) == FIXTURE_RESULT_PROJECTION_FIELDS,
        "eval storage fixture result projection fields mismatch",
    )
    require(table["admin_read_projection_required"] is True, "eval storage must require admin read projections")
    require(table["read_without_eval_rerun"] is True, "eval storage reads must not require eval rerun")
    require(
        set(result_storage["summary_projection_fields"]) == SUMMARY_PROJECTION_FIELDS,
        "eval result summary projection fields mismatch",
    )
    require(
        set(result_storage["fixture_result_projection_fields"]) == FIXTURE_RESULT_PROJECTION_FIELDS,
        "eval result fixture projection fields mismatch",
    )
    require(result_storage["admin_read_projection_required"] is True, "eval result must require admin read projections")
    require(result_storage["read_without_eval_rerun"] is True, "eval result reads must not require eval rerun")
    require(table["latest_result_resolvable"] is True, "eval storage must support latest-result resolution")
    require(table["immutable_rows"] is True, "eval storage rows must be immutable")
    require(set(table["idempotent_replay_key"]) == IDEMPOTENCY_FIELDS, "eval storage idempotent replay key mismatch")
    require(
        table["retention_contract_ref"] == "retention_contract",
        "eval storage table contract must link to retention contract",
    )
    require(table["no_public_delete_operation"] is True, "eval storage must not expose a public delete operation")
    require(result_storage["immutable_rows"] is True, "eval result storage fixture must declare immutable rows")
    require(set(result_storage["idempotent_replay_key"]) == IDEMPOTENCY_FIELDS, "eval result fixture idempotent replay key mismatch")
    require(
        result_storage["idempotent_replay_conflict_policy"]["exact_replay_returns_existing_row"] is True,
        "eval result storage fixture must return existing rows for exact replay",
    )
    require(
        result_storage["idempotent_replay_conflict_policy"]["same_key_different_result_rejected"] is True,
        "eval result storage fixture must reject divergent same-key replay",
    )
    require(
        result_storage["idempotent_replay_conflict_policy"]["same_subject_other_tenant_inserts_new_row"] is True,
        "eval result storage fixture must keep replay idempotency tenant-scoped",
    )
    require(
        result_storage["idempotent_replay_conflict_policy"]["conflict_requires_admin_audit"] is True,
        "eval result storage fixture must require admin audit for replay conflicts",
    )
    require(
        result_storage["idempotent_replay_conflict_policy"]["blocked_conflict_denies_activation"] is True,
        "eval result storage fixture must deny activation for replay conflicts",
    )
    require(
        result_storage["retention_contract"] == contract["retention_contract"],
        "eval result storage fixture must embed the sidecar retention contract",
    )
    require(result_storage["no_public_delete_operation"] is True, "eval result storage fixture must block public delete")


def write_row_key(row: dict[str, Any], key_fields: set[str]) -> tuple[str, ...]:
    return tuple(row[field] for field in key_fields)


def write_row_digest(row: dict[str, Any], digest_fields: set[str]) -> tuple[str, ...]:
    digest_row_fields = {
        "status": "status",
        "summary": "summary_sha256",
        "fixture_results": "fixture_results_sha256",
        "completed_at": "completed_at",
        "source_fixture_digests": "source_fixture_digests_sha256",
    }
    return tuple(row[digest_row_fields[field]] for field in sorted(digest_fields))


def parse_rfc3339(value: str) -> datetime:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvalStorageContractError(f"invalid fixture timestamp {value}") from exc


def row_sort_key(row: dict[str, Any]) -> tuple[datetime, datetime]:
    return (parse_rfc3339(row["completed_at"]), parse_rfc3339(row["created_at"]))


def apply_read_query(
    rows: list[dict[str, Any]],
    query: dict[str, Any],
    latest_group_fields: list[str],
) -> tuple[list[dict[str, Any]], str]:
    filtered = [
        row
        for row in rows
        if row["tenant_id"] == query["tenant_id"]
    ]
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
        require(isinstance(page_token, str) and page_token.startswith("after:"), "read page_token must use after:<result_id>")
        after_id = page_token.removeprefix("after:")
        matching_indexes = [index for index, row in enumerate(filtered_ordered) if row["id"] == after_id]
        require(matching_indexes, f"read page_token references a result outside the filtered page: {after_id}")
        filtered_ordered = filtered_ordered[matching_indexes[0] + 1 :]

    page_size = query.get("page_size", 25)
    require(isinstance(page_size, int), "read page_size must be an integer")
    require(1 <= page_size <= 100, "read page_size must be between 1 and 100")

    page = filtered_ordered[:page_size]
    if len(filtered_ordered) > page_size:
        next_page_token = f"after:{page[-1]['id']}"
    else:
        next_page_token = ""
    return page, next_page_token


def validate_write_fixture_contract(contract: dict[str, Any]) -> None:
    fixture = contract["write_fixture_contract"]
    write = contract["write_contract"]
    key_fields = set(fixture["idempotency_key_fields"])
    digest_fields = set(fixture["result_digest_fields"])
    mutation_guards = fixture["mutation_guards"]

    require(key_fields == IDEMPOTENCY_FIELDS, "eval write fixture idempotency fields mismatch")
    require(key_fields == set(write["idempotency_key_fields"]), "eval write fixture must mirror write idempotency fields")
    require(
        digest_fields == {"status", "summary", "fixture_results", "completed_at", "source_fixture_digests"},
        "eval write fixture result digest fields mismatch",
    )
    require(
        mutation_guards == {
            "exact_replay_must_not_update_completed_at": True,
            "divergent_replay_must_not_overwrite_existing_row": True,
            "tenant_isolation_partitions_idempotency_key": True,
            "conflict_row_requires_admin_audit_before_retry": True,
            "source_fixture_digest_change_rejected_under_same_key": True,
        },
        "eval write fixture mutation guards mismatch",
    )
    require(
        write["write_runner"] == "scripts/run_eval_storage_write_contract.py",
        "eval write fixture runner mismatch",
    )
    require(
        write["check_command"] == "python3 scripts/run_eval_storage_write_contract.py --check",
        "eval write fixture check command mismatch",
    )
    require(WRITE_RUNNER.exists(), "eval storage write runner missing")
    runner_text = WRITE_RUNNER.read_text(encoding="utf-8")
    for token in [
        "resolve_write_case",
        "cross_tenant_insert_allowed",
        "source_fixture_digest_conflict",
        "divergent_replay_summary_conflict",
        "exact_idempotent_replay",
    ]:
        require(token in runner_text, f"eval storage write runner missing {token}")

    required_cases = {
        "exact_replay_returns_existing_row",
        "same_key_changed_summary_rejects_conflict",
        "same_key_changed_source_digest_rejects_conflict",
        "same_subject_other_tenant_inserts_new_row",
    }
    cases = {case["case_id"]: case for case in fixture["cases"]}
    require(set(cases) == required_cases, "eval write fixture cases mismatch")

    exact = cases["exact_replay_returns_existing_row"]
    require(
        write_row_key(exact["existing_row"], key_fields) == write_row_key(exact["attempted_write"], key_fields),
        "exact replay must use the same idempotency key",
    )
    require(
        write_row_digest(exact["existing_row"], digest_fields) == write_row_digest(exact["attempted_write"], digest_fields),
        "exact replay must use the same result digest",
    )
    require(
        exact["expected_outcome"] == {
            "action": "return_existing_row",
            "stored_row_source": "existing_row",
            "requires_admin_audit": False,
            "activation_allowed": False,
            "reason": "exact_idempotent_replay",
        },
        "exact replay expected outcome mismatch",
    )
    require(
        exact["attempted_write"]["completed_at"] == exact["existing_row"]["completed_at"],
        "exact replay must preserve the stored completed_at timestamp",
    )

    conflict = cases["same_key_changed_summary_rejects_conflict"]
    require(
        write_row_key(conflict["existing_row"], key_fields) == write_row_key(conflict["attempted_write"], key_fields),
        "divergent replay must use the same idempotency key",
    )
    require(
        write_row_digest(conflict["existing_row"], digest_fields) != write_row_digest(conflict["attempted_write"], digest_fields),
        "divergent replay must change the result digest",
    )
    require(
        conflict["expected_outcome"] == {
            "action": "reject_conflict",
            "stored_row_source": "none",
            "requires_admin_audit": True,
            "activation_allowed": False,
            "reason": "divergent_replay_summary_conflict",
        },
        "divergent replay expected outcome mismatch",
    )
    require(
        conflict["existing_row"]["status"] == "blocked" and conflict["attempted_write"]["status"] == "pass",
        "divergent replay must prove a stale blocked row cannot be overwritten by a pass result",
    )

    source_conflict = cases["same_key_changed_source_digest_rejects_conflict"]
    source_conflict_existing = source_conflict["existing_row"]
    source_conflict_attempted = source_conflict["attempted_write"]
    require(
        write_row_key(source_conflict_existing, key_fields)
        == write_row_key(source_conflict_attempted, key_fields),
        "source digest replay conflict must use the same idempotency key",
    )
    for digest_field in ["status", "summary", "fixture_results", "completed_at"]:
        require(
            write_row_digest(source_conflict_existing, {digest_field})
            == write_row_digest(source_conflict_attempted, {digest_field}),
            f"source digest conflict must keep {digest_field} unchanged",
        )
    require(
        source_conflict_existing["source_fixture_digests_sha256"]
        != source_conflict_attempted["source_fixture_digests_sha256"],
        "source digest conflict must change source_fixture_digests_sha256",
    )
    require(
        write_row_digest(source_conflict_existing, digest_fields)
        != write_row_digest(source_conflict_attempted, digest_fields),
        "source digest conflict must change the full result digest",
    )
    require(
        source_conflict["expected_outcome"] == {
            "action": "reject_conflict",
            "stored_row_source": "none",
            "requires_admin_audit": True,
            "activation_allowed": False,
            "reason": "source_fixture_digest_conflict",
        },
        "source digest replay expected outcome mismatch",
    )

    cross_tenant = cases["same_subject_other_tenant_inserts_new_row"]
    existing = cross_tenant["existing_row"]
    attempted = cross_tenant["attempted_write"]
    require(existing["tenant_id"] != attempted["tenant_id"], "cross-tenant write case must use a different tenant")
    require(
        all(
            existing[field] == attempted[field]
            for field in ["eval_suite_id", "subject_type", "subject_id", "subject_version", "runner_sha256"]
        ),
        "cross-tenant write case must keep the same subject and runner outside tenant",
    )
    require(
        write_row_key(existing, key_fields) != write_row_key(attempted, key_fields),
        "cross-tenant write must not collide on the tenant-scoped idempotency key",
    )
    require(
        cross_tenant["expected_outcome"] == {
            "action": "insert_new_row",
            "stored_row_source": "attempted_write",
            "requires_admin_audit": False,
            "activation_allowed": False,
            "reason": "cross_tenant_insert_allowed",
        },
        "cross-tenant write expected outcome mismatch",
    )
    check = subprocess.run(
        [sys.executable, str(WRITE_RUNNER), "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        check.returncode == 0,
        "eval storage write runner failed: " + (check.stderr or check.stdout).strip(),
    )


def validate_read_fixture_contract(contract: dict[str, Any]) -> None:
    fixture = contract["read_fixture_contract"]
    read = contract["read_contract"]
    rows = fixture["fixture_rows"]
    cases = fixture["cases"]
    pagination_cases = fixture["pagination_cases"]
    empty_cases = fixture["expected_empty_cases"]
    latest_group_fields = fixture["latest_only_groups_by"]

    require(
        read["read_runner"] == "scripts/run_eval_storage_read_contract.py",
        "read contract runner mismatch",
    )
    require(
        read["check_command"] == "python3 scripts/run_eval_storage_read_contract.py --check",
        "read contract check command mismatch",
    )
    require(set(read["pagination_parameters"]) == {"PageToken", "PageSize"}, "read contract pagination parameters mismatch")
    require(read["cursor_token_format"] == "after_result_id", "read contract cursor token format mismatch")
    require(
        read["page_size_bounds"] == {"minimum": 1, "maximum": 100, "default": 25},
        "read contract page size bounds mismatch",
    )
    require(READ_RUNNER.exists(), "eval storage read runner missing")
    runner_text = READ_RUNNER.read_text(encoding="utf-8")
    for token in [
        "apply_read_query",
        "completed_after",
        "latest_group_fields",
        "subject_version",
        "tenant_id",
        "created_at",
        "page_token",
        "page_size",
        "next_page_token",
    ]:
        require(token in runner_text, f"eval storage read runner missing {token}")

    require(fixture["tenant_filter_required"] is True, "read fixture must require tenant filtering")
    require(read["tenant_filter_required"] is True, "read contract must require tenant filtering")
    require(fixture["ordering"] == ["completed_at_desc", "created_at_desc"], "read fixture ordering mismatch")
    require(set(latest_group_fields) == LATEST_ONLY_GROUP_FIELDS, "latest_only grouping fields mismatch")

    row_ids = [row["id"] for row in rows]
    require(len(row_ids) == len(set(row_ids)), "read fixture row ids must be unique")
    case_ids = [case["case_id"] for case in cases]
    require(len(case_ids) == len(set(case_ids)), "read fixture case ids must be unique")
    pagination_case_ids = [case["case_id"] for case in pagination_cases]
    require(len(pagination_case_ids) == len(set(pagination_case_ids)), "read fixture pagination case ids must be unique")
    empty_case_ids = [case["case_id"] for case in empty_cases]
    require(len(empty_case_ids) == len(set(empty_case_ids)), "read fixture empty case ids must be unique")
    require(not (set(case_ids) & set(empty_case_ids)), "read fixture positive and empty case ids must not overlap")
    require(
        not (set(case_ids) & set(pagination_case_ids) or set(pagination_case_ids) & set(empty_case_ids)),
        "read fixture pagination case ids must not overlap other cases",
    )
    row_by_id = {row["id"]: row for row in rows}

    for row in rows:
        parse_rfc3339(row["completed_at"])
        parse_rfc3339(row["created_at"])
        require(row["tenant_id"].startswith("tenant_"), f"{row['id']} must be tenant scoped")

    for case in cases:
        query = case["query"]
        require("tenant_id" in query, f"{case['case_id']} must include tenant_id")
        require("latest_only" in query, f"{case['case_id']} must include latest_only")
        require(
            set(query) <= QUERY_FIELDS,
            f"{case['case_id']} includes unsupported query filters: {sorted(set(query) - QUERY_FIELDS)}",
        )
        expected_ids = case["expected_result_ids"]
        require(all(result_id in row_by_id for result_id in expected_ids), f"{case['case_id']} expects unknown rows")
        expected_tenant_ids = {row_by_id[result_id]["tenant_id"] for result_id in expected_ids}
        require(
            expected_tenant_ids == {query["tenant_id"]},
            f"{case['case_id']} expected rows must stay inside the queried tenant",
        )
        page, next_page_token = apply_read_query(rows, query, latest_group_fields)
        actual_ids = [row["id"] for row in page]
        require(
            actual_ids == expected_ids,
            f"{case['case_id']} read fixture mismatch: expected {expected_ids}, got {actual_ids}",
        )
        require(next_page_token == "", f"{case['case_id']} non-pagination case must not return a next page token")
        require(expected_ids, f"{case['case_id']} positive read case must expect at least one row")

    required_cases = {
        "tenant_subject_filter_orders_by_completed_then_created",
        "status_and_completed_after_are_applied_after_tenant_scope",
        "latest_only_uses_runner_hash_scope_and_created_at_tiebreak",
        "subject_version_filter_keeps_old_version_addressable",
        "tenant_isolation_keeps_newer_other_tenant_out_of_acme_reads",
    }
    require(set(case_ids) == required_cases, "eval read fixture cases mismatch")

    required_pagination_cases = {
        "page_size_limits_after_stable_order",
        "page_token_resumes_after_prior_result_inside_tenant_scope",
    }
    require(set(pagination_case_ids) == required_pagination_cases, "eval read fixture pagination cases mismatch")
    first_page = {case["case_id"]: case for case in pagination_cases}["page_size_limits_after_stable_order"]
    second_page = {case["case_id"]: case for case in pagination_cases}["page_token_resumes_after_prior_result_inside_tenant_scope"]
    require(first_page["query"]["page_size"] == 2, "first pagination case must force a short page")
    require(first_page["expected_next_page_token"], "first pagination case must return a next page token")
    require(
        second_page["query"]["page_token"] == first_page["expected_next_page_token"],
        "second pagination case must resume from first page token",
    )
    for case in pagination_cases:
        query = case["query"]
        require("tenant_id" in query, f"{case['case_id']} must include tenant_id")
        require("latest_only" in query, f"{case['case_id']} must include latest_only")
        require("page_size" in query, f"{case['case_id']} must include page_size")
        require(
            set(query) <= QUERY_FIELDS,
            f"{case['case_id']} includes unsupported query filters: {sorted(set(query) - QUERY_FIELDS)}",
        )
        expected_ids = case["expected_result_ids"]
        require(all(result_id in row_by_id for result_id in expected_ids), f"{case['case_id']} expects unknown rows")
        page, next_page_token = apply_read_query(rows, query, latest_group_fields)
        actual_ids = [row["id"] for row in page]
        require(
            actual_ids == expected_ids,
            f"{case['case_id']} pagination read mismatch: expected {expected_ids}, got {actual_ids}",
        )
        require(
            next_page_token == case["expected_next_page_token"],
            f"{case['case_id']} next page token mismatch: expected {case['expected_next_page_token']}, got {next_page_token}",
        )
        require(expected_ids, f"{case['case_id']} pagination case must expect at least one row")
        expected_tenant_ids = {row_by_id[result_id]["tenant_id"] for result_id in expected_ids}
        require(
            expected_tenant_ids == {query["tenant_id"]},
            f"{case['case_id']} paginated rows must stay inside queried tenant",
        )

    required_empty_cases = {
        "completed_after_is_strict_and_tenant_scoped",
        "subject_version_filter_excludes_other_versions",
        "unknown_subject_returns_empty_inside_tenant_scope",
    }
    require(set(empty_case_ids) == required_empty_cases, "eval read fixture empty cases mismatch")
    for case in empty_cases:
        query = case["query"]
        require("tenant_id" in query, f"{case['case_id']} must include tenant_id")
        require("latest_only" in query, f"{case['case_id']} must include latest_only")
        require(
            set(query) <= QUERY_FIELDS,
            f"{case['case_id']} includes unsupported query filters: {sorted(set(query) - QUERY_FIELDS)}",
        )
        require(case["expected_result_ids"] == [], f"{case['case_id']} empty case must expect no rows")
        page, next_page_token = apply_read_query(rows, query, latest_group_fields)
        actual_ids = [row["id"] for row in page]
        require(actual_ids == [], f"{case['case_id']} expected no rows, got {actual_ids}")
        require(next_page_token == "", f"{case['case_id']} empty case must not return a next page token")

    strict_case = next(case for case in empty_cases if case["case_id"] == "completed_after_is_strict_and_tenant_scoped")
    require(
        any(
            row["tenant_id"] == strict_case["query"]["tenant_id"]
            and row["eval_suite_id"] == strict_case["query"]["eval_suite_id"]
            and row["subject_type"] == strict_case["query"]["subject_type"]
            and row["subject_id"] == strict_case["query"]["subject_id"]
            and row["status"] == strict_case["query"]["status"]
            and row["completed_at"] == strict_case["query"]["completed_after"]
            for row in rows
        ),
        "strict completed_after empty case must prove equality is excluded, not merely absent",
    )

    check = subprocess.run(
        [sys.executable, str(READ_RUNNER), "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(
        check.returncode == 0,
        "eval storage read runner failed: " + (check.stderr or check.stdout).strip(),
    )


def validate_write_and_replay_contract(contract: dict[str, Any]) -> None:
    write = contract["write_contract"]
    replay = contract["replay_contract"]
    runner_text = RUNNER.read_text(encoding="utf-8")

    require(write["runner"] == "scripts/run_stage0_eval.py", "write contract runner mismatch")
    require(write["write_command"] == "python3 scripts/run_stage0_eval.py --write", "write command mismatch")
    require(write["write_runner"] == "scripts/run_eval_storage_write_contract.py", "write contract case runner mismatch")
    require(
        write["check_command"] == "python3 scripts/run_eval_storage_write_contract.py --check",
        "write contract check command mismatch",
    )
    require("--write" in runner_text and "RESULT_PATH.write_text" in runner_text, "runner must implement stored fixture writes")
    require(write["writes_stored_fixture"] is True, "write contract must persist stored fixture")
    require(write["persists_runner_sha256"] is True, "write contract must persist runner hash")
    require(write["persists_completed_at"] is True, "write contract must persist completion time")
    require(write["persists_subject_version"] is True, "write contract must persist subject version")
    require(
        "DETERMINISTIC_COMPLETED_AT" in runner_text and '"completed_at": DETERMINISTIC_COMPLETED_AT' in runner_text,
        "runner must emit a deterministic completed_at for stored fixture replay",
    )
    require(set(write["idempotency_key_fields"]) == IDEMPOTENCY_FIELDS, "eval storage idempotency fields mismatch")
    require(
        write["transaction_boundary"] in {"single_eval_result_insert", "single_eval_result_upsert"},
        "eval storage transaction boundary unsupported",
    )

    require(replay["check_command"] == "python3 scripts/run_stage0_eval.py --check", "replay check command mismatch")
    require("--check" in runner_text and "stored eval results are stale" in runner_text, "runner must implement exact check mode")
    require(replay["check_mode_compares_exact_json"] is True, "replay check mode must compare exact JSON")
    require(replay["runner_sha256_matches_runner_file"] is True, "replay contract must require runner hash validation")
    require(replay["source_fixture_digests_required"] is True, "replay contract must require source fixture digests")
    require("source_fixture_digests" in runner_text, "runner must emit source fixture digests")
    for source in replay["source_fixtures"]:
        require((ROOT / source).exists(), f"replay source fixture missing: {source}")

    check = subprocess.run(
        [sys.executable, str(RUNNER), "--check"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    require(check.returncode == 0, "eval replay check failed: " + (check.stderr or check.stdout).strip())


def validate_read_and_openapi_contract(contract: dict[str, Any]) -> None:
    openapi = OPENAPI.read_text(encoding="utf-8")
    read = contract["read_contract"]
    api = contract["openapi_contract"]
    eval_path = path_block(openapi, api["path"])
    page = schema_block(openapi, "EvalResultPage")
    result = schema_block(openapi, "EvalResult")

    require(read["list_operation_id"] == api["operation_id"] == "listEvalResults", "eval result list operation mismatch")
    require(read["read_runner"] == "scripts/run_eval_storage_read_contract.py", "eval result read runner mismatch")
    require(
        read["check_command"] == "python3 scripts/run_eval_storage_read_contract.py --check",
        "eval result read check command mismatch",
    )
    require("operationId: listEvalResults" in eval_path, "OpenAPI /eval/results must expose listEvalResults")
    require("x-rbac: admin" in eval_path, "OpenAPI /eval/results must require admin RBAC")
    require(set(read["pagination_parameters"]) == {"PageToken", "PageSize"}, "eval result read pagination parameter mismatch")
    require(read["cursor_token_format"] == "after_result_id", "eval result read cursor token format mismatch")
    require(read["page_size_bounds"] == {"minimum": 1, "maximum": 100, "default": 25}, "eval result read page size bounds mismatch")
    require(read["admin_rbac_required"] is True, "read contract must require admin RBAC")
    require(read["tenant_filter_required"] is True, "read contract must require tenant filtering")
    require(read["latest_result_order"] == "completed_at_desc", "read contract latest order mismatch")
    require(read["stable_tie_break_order"] == "created_at_desc", "read contract must define stable created_at tie-break")
    require(
        read["subject_latest_resolution"] == "tenant_suite_subject_version_runner_hash",
        "read contract latest resolution scope mismatch",
    )
    require(read["page_schema"] == api["response_schema"] == "EvalResultPage", "read contract page schema mismatch")
    require('$ref: "#/components/schemas/EvalResultPage"' in eval_path, "OpenAPI /eval/results response schema mismatch")
    require("items:" in page and '$ref: "#/components/schemas/EvalResult"' in page, "EvalResultPage must contain EvalResult items")

    require(set(read["required_query_filters"]) == QUERY_FILTERS, "read contract query filters mismatch")
    require(set(api["required_parameters"]) == OPENAPI_PARAMETERS, "OpenAPI contract parameters mismatch")
    for parameter in OPENAPI_PARAMETERS:
        require(parameter in eval_path, f"OpenAPI /eval/results missing {parameter}")
    for token in STORAGE_COLUMNS | STORAGE_INDEXES | QUERY_FILTERS | IDEMPOTENCY_FIELDS | SUMMARY_PROJECTION_FIELDS | FIXTURE_RESULT_PROJECTION_FIELDS:
        require(token in result or token in eval_path, f"OpenAPI EvalResult storage contract missing {token}")
    require("EvalLatestOnlyFilter" in eval_path, "OpenAPI /eval/results must expose latest-only filter")
    require("delete:" not in eval_path and "operationId: deleteEval" not in openapi, "eval results must not expose public delete")
    require("immutable" in result.lower(), "OpenAPI EvalResult storage contract must document immutability")
    require("read_without_eval_rerun" in result, "OpenAPI EvalResult storage contract must expose read_without_eval_rerun")
    require("retention_contract" in result, "OpenAPI EvalResult storage contract must expose retention_contract")
    for token in [
        "retain_pass_fail_blocked_results",
        "retain_summary_json",
        "retain_runner_hash",
        "deletion_requires_admin_audit",
        "redaction_requires_admin_audit",
        "minimum_retention_days",
    ]:
        require(token in result, f"OpenAPI EvalResult storage retention contract missing {token}")


def validate_retention_and_release_gate(contract: dict[str, Any]) -> None:
    retention = contract["retention_contract"]
    release = contract["release_gate_contract"]
    activation = load_json(ACTIVATION)

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

    require(
        release["activation_contract_fixture"] == "fixtures/stage0/rev2/eval/activation_gate_contract.json",
        "release gate contract must cite activation fixture",
    )
    require(release["requires_eval_pass_for_skill_canary"] is True, "skill canary must require eval pass")
    require(release["requires_eval_pass_for_skill_active"] is True, "skill active must require eval pass")
    require(
        release["requires_eval_pass_for_prompt_fragment_active"] is True,
        "prompt fragment active must require eval pass",
    )
    require(release["blocked_result_denies_activation"] is True, "blocked eval result must deny activation")

    gates = {gate["gate_id"]: gate for gate in activation["gates"]}
    require("skill_version_canary_requires_eval_pass" in gates, "activation contract missing skill canary gate")
    require("skill_version_active_requires_eval_pass" in gates, "activation contract missing skill active gate")
    require("prompt_fragment_active_requires_eval_pass" in gates, "activation contract missing prompt active gate")
    for gate in gates.values():
        require(gate["required_eval_result"]["table"] == "eval_results", f"{gate['gate_id']} must use eval_results")
        require(gate["required_eval_result"]["status"] == "pass", f"{gate['gate_id']} must require pass status")
        require(gate["activation_allowed_without_passing_eval"] is False, f"{gate['gate_id']} must deny eval bypass")

    blocked_cases = [
        case
        for case in activation["decision_cases"]
        if case["eval_result_status"] == "blocked"
    ]
    require(blocked_cases, "activation contract must include blocked eval denial case")
    for case in blocked_cases:
        require(case["activation_outcome"]["allowed"] is False, f"{case['case_id']} must deny blocked eval activation")


def main() -> int:
    try:
        contract = load_json(CONTRACT)
        results = load_json(RESULTS)
        require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
        result = results[0]
        validate_stored_result(contract, result)
        validate_table_contract(contract, result)
        validate_write_fixture_contract(contract)
        validate_read_fixture_contract(contract)
        validate_write_and_replay_contract(contract)
        validate_read_and_openapi_contract(contract)
        validate_retention_and_release_gate(contract)
    except EvalStorageContractError as exc:
        print(f"eval storage contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("eval storage contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
