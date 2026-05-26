#!/usr/bin/env python3
"""Validate Stage 0 Rev2 eval result storage, replay, and release-gate contracts."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
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

IDEMPOTENCY_FIELDS = {
    "tenant_id",
    "eval_suite_id",
    "subject_type",
    "subject_id",
    "subject_version",
    "runner_sha256",
}

OPENAPI_PARAMETERS = {
    "StatusFilter",
    "EvalSuiteIdFilter",
    "EvalSubjectTypeFilter",
    "SubjectIdFilter",
    "CompletedAfterFilter",
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
    require(table["latest_result_resolvable"] is True, "eval storage must support latest-result resolution")


def validate_write_and_replay_contract(contract: dict[str, Any]) -> None:
    write = contract["write_contract"]
    replay = contract["replay_contract"]
    runner_text = RUNNER.read_text(encoding="utf-8")

    require(write["runner"] == "scripts/run_stage0_eval.py", "write contract runner mismatch")
    require(write["write_command"] == "python3 scripts/run_stage0_eval.py --write", "write command mismatch")
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
    require("operationId: listEvalResults" in eval_path, "OpenAPI /eval/results must expose listEvalResults")
    require("x-rbac: admin" in eval_path, "OpenAPI /eval/results must require admin RBAC")
    require(read["admin_rbac_required"] is True, "read contract must require admin RBAC")
    require(read["tenant_filter_required"] is True, "read contract must require tenant filtering")
    require(read["latest_result_order"] == "completed_at_desc", "read contract latest order mismatch")
    require(read["page_schema"] == api["response_schema"] == "EvalResultPage", "read contract page schema mismatch")
    require('$ref: "#/components/schemas/EvalResultPage"' in eval_path, "OpenAPI /eval/results response schema mismatch")
    require("items:" in page and '$ref: "#/components/schemas/EvalResult"' in page, "EvalResultPage must contain EvalResult items")

    require(set(read["required_query_filters"]) == QUERY_FILTERS, "read contract query filters mismatch")
    require(set(api["required_parameters"]) == OPENAPI_PARAMETERS, "OpenAPI contract parameters mismatch")
    for parameter in OPENAPI_PARAMETERS:
        require(parameter in eval_path, f"OpenAPI /eval/results missing {parameter}")
    for token in STORAGE_COLUMNS | STORAGE_INDEXES | QUERY_FILTERS:
        require(token in result or token in eval_path, f"OpenAPI EvalResult storage contract missing {token}")


def validate_retention_and_release_gate(contract: dict[str, Any]) -> None:
    retention = contract["retention_contract"]
    release = contract["release_gate_contract"]
    activation = load_json(ACTIVATION)

    for field in [
        "retain_pass_fail_blocked_results",
        "retain_summary_json",
        "retain_runner_hash",
        "deletion_requires_admin_audit",
    ]:
        require(retention[field] is True, f"retention contract must set {field}")

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
