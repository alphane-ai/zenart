#!/usr/bin/env python3
"""Validate Stage 0 Rev2 eval result storage and OpenAPI contract coverage."""

from __future__ import annotations

import json
import re
import sys
import hashlib
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2"
RESULTS = FIXTURE_DIR / "eval" / "starter_eval_results.json"
SUITE = FIXTURE_DIR / "eval" / "starter_eval_suite.json"
QA_RESULTS = FIXTURE_DIR / "eval" / "qa_results.json"
STORAGE_CONTRACT = FIXTURE_DIR / "eval" / "eval_storage_contract.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"
RUNNER = ROOT / "scripts" / "run_stage0_eval.py"

QA_CATEGORIES = {
    "file_integrity",
    "dimensions",
    "aspect_ratio",
    "safe_area",
    "blank_output",
    "duplicate_similarity",
    "four_option_distinctness",
    "text_readability",
    "structured_text",
    "product_logo_preservation",
    "forbidden_claims",
    "watermark_signature_risk",
    "export_completeness",
}

SAFETY_POINTS = {
    "brief",
    "provider_request",
    "provider_response",
    "qa",
    "export",
}

TRACE_KEYS = {
    "has_schema_validation",
    "has_provenance",
    "has_safety_status",
    "has_qa_eval_status",
    "has_quota_transaction",
    "has_admin_visibility",
    "has_user_failure_mapping",
}

EXPORT_KEYS = {
    "manifest",
    "qa_report",
    "metadata",
    "trace_provenance",
    "safety_disclaimer_when_applicable",
    "blocks_when_incomplete",
}

QA_EXPORT_GATE_KEYS = {
    "final_export_allowed",
    "blocking_qa_check_ids",
    "blocking_qa_categories",
    "safety_blocks_export",
    "export_artifacts_complete",
    "admin_override_required_for_export",
    "override_requires_audit",
}

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
    "status",
    "completed_after",
}


class EvalResultContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalResultContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalResultContractError(message)


def runner_sha256() -> str:
    content = RUNNER.read_text(encoding="utf-8")
    normalized = "\n".join(
        '            "runner_sha256": "<self>",' if '"runner_sha256": runner_digest' in line else line
        for line in content.splitlines()
    )
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


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


def validate_openapi_eval_result_schema() -> None:
    openapi_text = OPENAPI.read_text(encoding="utf-8")
    body = schema_block(openapi_text, "EvalResult")

    eval_path = re.search(
        r"^  /eval/results:\n(?P<body>.*?)(?=^  /|\Z)",
        openapi_text,
        flags=re.MULTILINE | re.DOTALL,
    )
    require(eval_path is not None, "OpenAPI /eval/results path missing")
    eval_path_body = eval_path.group("body")
    for parameter in [
        "EvalSuiteIdFilter",
        "EvalSubjectTypeFilter",
        "SubjectIdFilter",
        "CompletedAfterFilter",
        "StatusFilter",
    ]:
        require(parameter in eval_path_body, f"OpenAPI /eval/results missing {parameter}")

    for field in [
        "id",
        "suite_id",
        "subject",
        "status",
        "completed_at",
        "summary",
        "fixture_results",
        "runner_contract",
        "storage_contract",
        "created_at",
    ]:
        require_field_in_schema(body, "EvalResult", field)

    for field in [
        "total_fixtures",
        "passed_fixtures",
        "failed_fixtures",
        "blocked_fixtures",
        "golden_passed",
        "critical_safety_regressions",
        "regression_pass_rate",
        "trace_complete",
        "export_contract_complete",
        "qa_categories_covered",
        "safety_enforcement_points_covered",
    ]:
        require_field_in_schema(body, "EvalResult.summary", field)

    for category in QA_CATEGORIES:
        require(category in body, f"OpenAPI EvalResult summary missing QA category enum {category}")
    for point in SAFETY_POINTS:
        require(point in body, f"OpenAPI EvalResult summary missing safety point enum {point}")

    for field in [
        "fixture_id",
        "category",
        "workflow",
        "status",
        "candidate_count",
        "expected_safety_action",
        "observed_safety_action",
        "qa_check_ids",
        "trace_contract",
        "export_contract",
        "qa_export_gate",
        "failure_reasons",
    ]:
        require_field_in_schema(body, "EvalResult.fixture_results", field)

    for field in TRACE_KEYS:
        require_field_in_schema(body, "EvalResult.trace_contract", field)
    for field in EXPORT_KEYS:
        require_field_in_schema(body, "EvalResult.export_contract", field)
    for field in QA_EXPORT_GATE_KEYS:
        require_field_in_schema(body, "EvalResult.qa_export_gate", field)
    for field in ["runner", "runner_sha256", "deterministic_replay_command", "writes_stored_fixture", "check_mode_compares_exact_json"]:
        require_field_in_schema(body, "EvalResult.runner_contract", field)
    for field in ["required_columns", "required_indexes", "required_query_filters", "latest_result_resolvable"]:
        require_field_in_schema(body, "EvalResult.storage_contract", field)
    for token in STORAGE_COLUMNS | STORAGE_INDEXES | QUERY_FILTERS:
        require(token in body or token in eval_path_body, f"OpenAPI EvalResult contract missing {token}")
    require("const: true" in body, "OpenAPI EvalResult must preserve required true contract fields")


def validate_fixture_result_links() -> None:
    results = load_json(RESULTS)
    suite = load_json(SUITE)
    qa_results = load_json(QA_RESULTS)

    require(isinstance(results, list) and len(results) == 1, "starter eval results must contain one result")
    result = results[0]
    summary = result["summary"]

    require(result["completed_at"], "stored eval result must include completed_at")
    require(result["created_at"], "stored eval result must include created_at")
    require(set(summary["qa_categories_covered"]) == QA_CATEGORIES, "eval summary must cover every QA category")
    require(set(summary["safety_enforcement_points_covered"]) == SAFETY_POINTS, "eval summary must cover every safety point")
    require(summary["trace_complete"] is True, "eval summary must prove trace completeness")
    require(summary["export_contract_complete"] is True, "eval summary must prove export contract completeness")

    runner = result["runner_contract"]
    require(runner["runner"] == "scripts/run_stage0_eval.py", "eval runner contract must identify runner script")
    require(runner["runner_sha256"] == runner_sha256(), "eval runner hash must match deterministic runner digest")
    require(
        runner["deterministic_replay_command"] == "python3 scripts/run_stage0_eval.py --check",
        "eval runner contract must expose exact replay command",
    )
    require(runner["writes_stored_fixture"] is True, "eval runner must write stored fixture")
    require(runner["check_mode_compares_exact_json"] is True, "eval runner check mode must compare exact JSON")

    suite_fixtures = {fixture["fixture_id"]: fixture for fixture in suite["fixtures"]}
    qa_by_id = {item["check_id"]: item for item in qa_results}
    require(
        {item["fixture_id"] for item in result["fixture_results"]} == set(suite_fixtures),
        "eval result must include exactly one entry per suite fixture",
    )

    for item in result["fixture_results"]:
        fixture = suite_fixtures[item["fixture_id"]]
        require(item["category"] == fixture["category"], f"{item['fixture_id']} category mismatch")
        require(item["workflow"] == fixture["workflow"], f"{item['fixture_id']} workflow mismatch")
        require(
            item["candidate_count"] >= fixture["expected_evidence"]["minimum_candidates"],
            f"{item['fixture_id']} candidate count below fixture minimum",
        )
        require(
            item["expected_safety_action"] == fixture["expected_evidence"]["expected_safety_action"],
            f"{item['fixture_id']} expected safety action mismatch",
        )
        require(
            item["observed_safety_action"] in {"allow", "warn", "require_user_confirmation", "require_admin_review", "block"},
            f"{item['fixture_id']} observed safety action unsupported",
        )

        trace = item["trace_contract"]
        require(trace["trace_id"].startswith("trace_"), f"{item['fixture_id']} trace_id must be trace-scoped")
        for key in TRACE_KEYS:
            require(trace[key] is True, f"{item['fixture_id']} trace contract missing {key}")

        export = item["export_contract"]
        require(set(EXPORT_KEYS) <= set(export), f"{item['fixture_id']} export contract missing required keys")
        require(export["blocks_when_incomplete"] is True, f"{item['fixture_id']} incomplete export must block")
        if fixture["expected_evidence"]["must_include_qa_report"]:
            require(export["qa_report"] is True, f"{item['fixture_id']} export must include QA report")
        if fixture["expected_evidence"]["must_include_trace_provenance"]:
            require(export["trace_provenance"] is True, f"{item['fixture_id']} export must include trace provenance")

        for check_id in item["qa_check_ids"]:
            require(check_id in qa_by_id, f"{item['fixture_id']} references unknown QA check {check_id}")
            require(
                qa_by_id[check_id]["evidence"]["fixture_id"] == item["fixture_id"],
                f"{item['fixture_id']} references QA check {check_id} from another fixture",
            )

        qa_gate = item["qa_export_gate"]
        require(set(QA_EXPORT_GATE_KEYS) <= set(qa_gate), f"{item['fixture_id']} QA export gate missing required keys")
        expected_blocking_ids = [
            check_id
            for check_id in item["qa_check_ids"]
            if qa_by_id[check_id]["export_gate"]["blocks_final_export"] is True
        ]
        expected_blocking_categories = sorted(
            {
                qa_by_id[check_id]["check_category"]
                for check_id in expected_blocking_ids
            }
        )
        safety_blocks_export = item["observed_safety_action"] == "block"
        export_artifacts_complete = all(
            export[key]
            for key in [
                "manifest",
                "qa_report",
                "metadata",
                "trace_provenance",
                "safety_disclaimer_when_applicable",
            ]
        )
        expected_export_allowed = export_artifacts_complete and not expected_blocking_ids and not safety_blocks_export
        require(
            qa_gate["blocking_qa_check_ids"] == expected_blocking_ids,
            f"{item['fixture_id']} QA export gate blocking checks mismatch",
        )
        require(
            qa_gate["blocking_qa_categories"] == expected_blocking_categories,
            f"{item['fixture_id']} QA export gate blocking categories mismatch",
        )
        require(
            qa_gate["safety_blocks_export"] is safety_blocks_export,
            f"{item['fixture_id']} QA export gate safety block mismatch",
        )
        require(
            qa_gate["export_artifacts_complete"] is export_artifacts_complete,
            f"{item['fixture_id']} QA export gate artifact completeness mismatch",
        )
        require(
            qa_gate["final_export_allowed"] is expected_export_allowed,
            f"{item['fixture_id']} QA export gate final export decision mismatch",
        )
        require(
            qa_gate["admin_override_required_for_export"] is (not expected_export_allowed),
            f"{item['fixture_id']} QA export gate override requirement mismatch",
        )
        require(qa_gate["override_requires_audit"] is True, f"{item['fixture_id']} QA export override must require audit")
        if item["status"] == "pass":
            require(qa_gate["final_export_allowed"] is True, f"{item['fixture_id']} pass result must allow final export")
        else:
            require(qa_gate["final_export_allowed"] is False, f"{item['fixture_id']} blocked result must deny final export")


def validate_storage_contract() -> None:
    migration = MIGRATION.read_text(encoding="utf-8")
    results = load_json(RESULTS)
    storage_contract = load_json(STORAGE_CONTRACT)
    storage = results[0]["storage_contract"]
    table_contract = storage_contract["table_contract"]
    write_contract = storage_contract["write_contract"]
    read_contract = storage_contract["read_contract"]
    replay_contract = storage_contract["replay_contract"]

    require(results[0]["completed_at"] == results[0]["created_at"], "deterministic fixture timestamps must match")
    require("CREATE TABLE IF NOT EXISTS eval_results" in migration, "eval_results table missing")
    require(set(storage["required_columns"]) == STORAGE_COLUMNS, "eval result storage columns mismatch")
    require(set(table_contract["required_columns"]) == STORAGE_COLUMNS, "eval storage contract columns mismatch")
    require(set(storage["required_indexes"]) == STORAGE_INDEXES, "eval result storage indexes mismatch")
    require(set(table_contract["required_indexes"]) == STORAGE_INDEXES, "eval storage contract indexes mismatch")
    require(set(storage["required_query_filters"]) == QUERY_FILTERS, "eval result query filters mismatch")
    require(set(read_contract["required_query_filters"]) == QUERY_FILTERS, "eval storage read filters mismatch")
    for column in STORAGE_COLUMNS:
        require(column in migration, f"eval_results storage missing {column}")
    require("tenant_id text NOT NULL REFERENCES tenants(id)" in migration, "eval_results must be tenant scoped")
    require("summary jsonb NOT NULL" in migration, "eval_results summary must be persisted as jsonb")
    require("runner_sha256 text NOT NULL" in migration, "eval_results must persist runner hash")
    require("completed_at timestamptz NOT NULL" in migration, "eval_results must persist completion time")
    for index in STORAGE_INDEXES:
        require(index in migration, f"eval_results storage missing index {index}")
    require(storage["summary_json_contains_fixture_results"] is True, "eval fixture details must be stored in summary json")
    require(storage["tenant_scoped"] is True, "eval storage contract must be tenant scoped")
    require(storage["subject_scoped"] is True, "eval storage contract must be subject scoped")
    require(storage["latest_result_resolvable"] is True, "eval storage must support latest-result resolution")
    require(table_contract["summary_json_contains_fixture_results"] is True, "eval storage contract must retain fixture results")
    require(table_contract["tenant_scoped"] is True, "eval storage table contract must be tenant scoped")
    require(table_contract["subject_scoped"] is True, "eval storage table contract must be subject scoped")
    require(table_contract["latest_result_resolvable"] is True, "eval storage table contract must resolve latest results")
    require(write_contract["write_command"] == "python3 scripts/run_stage0_eval.py --write", "eval storage write command mismatch")
    require(write_contract["persists_runner_sha256"] is True, "eval storage write contract must persist runner hash")
    require(write_contract["persists_completed_at"] is True, "eval storage write contract must persist completion time")
    require(write_contract["persists_subject_version"] is True, "eval storage write contract must persist subject version")
    require(read_contract["list_operation_id"] == "listEvalResults", "eval storage read contract must use listEvalResults")
    require(read_contract["admin_rbac_required"] is True, "eval storage read contract must require admin RBAC")
    require(read_contract["tenant_filter_required"] is True, "eval storage read contract must require tenant filter")
    require(replay_contract["check_command"] == "python3 scripts/run_stage0_eval.py --check", "eval replay command mismatch")
    require(replay_contract["check_mode_compares_exact_json"] is True, "eval replay contract must compare exact JSON")


def main() -> int:
    try:
        validate_openapi_eval_result_schema()
        validate_fixture_result_links()
        validate_storage_contract()
    except EvalResultContractError as exc:
        print(f"eval result contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("eval result contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
