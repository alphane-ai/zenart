#!/usr/bin/env python3
"""Validate Stage 0 Rev2 eval result artifact storage and retrieval contract."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage0" / "rev2" / "eval"
CONTRACT = FIXTURE_DIR / "eval_result_artifact_contract.json"
RESULTS = FIXTURE_DIR / "starter_eval_results.json"
QA_RESULTS = FIXTURE_DIR / "qa_results.json"
SAFETY_RULES = FIXTURE_DIR / "safety_rules.json"
TRACE_EXPORT_GATE = FIXTURE_DIR / "trace_export_gate_matrix.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"

REQUIRED_ARTIFACT_LINKS = {
    "eval_result_json",
    "summary_json",
    "fixture_results_json",
    "source_fixture_digests_json",
    "runner_manifest_json",
    "qa_results_json",
    "safety_decisions_json",
    "trace_export_gate_matrix_json",
}

REQUIRED_OPENAPI_FIELDS = {
    "result_id",
    "tenant_id",
    "suite_id",
    "subject",
    "status",
    "completed_at",
    "object_key",
    "content_type",
    "sha256",
    "artifact_links",
    "download_url",
    "expires_at",
    "access_policy",
    "audit_required",
}

REQUIRED_OPERATION_TOKENS = {
    "/eval/results/{result_id}/artifact",
    "operationId: getEvalResultArtifact",
    "x-rbac: admin",
    "TenantIdFilter",
    "EvalResultArtifact",
    "format: uri",
    "direct_object_access_allowed",
}


class EvalResultArtifactContractError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise EvalResultArtifactContractError(f"{path.relative_to(ROOT)} is not valid JSON: {exc}") from exc


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalResultArtifactContractError(message)


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def parse_datetime(value: str, label: str) -> None:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise EvalResultArtifactContractError(f"{label} must be RFC3339 date-time: {value}") from exc


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


def require_field_in_schema(body: str, schema_name: str, field: str) -> None:
    require(f"{field}:" in body, f"OpenAPI schema {schema_name} missing {field}")
    require(
        re.search(rf"required: \[[^\]]*\b{re.escape(field)}\b", body)
        or re.search(rf"^\s+- {re.escape(field)}$", body, flags=re.MULTILINE),
        f"OpenAPI schema {schema_name} must require {field}",
    )


def validate_stored_result_ref(contract: dict[str, Any], result: dict[str, Any]) -> None:
    ref = contract["stored_result_ref"]
    subject = result["subject"]
    require(ref["path"] == "fixtures/stage0/rev2/eval/starter_eval_results.json", "stored result path mismatch")
    require(ref["result_id"] == result["result_id"], "artifact result_id must match stored result")
    require(ref["suite_id"] == result["suite_id"], "artifact suite_id must match stored result")
    require(ref["subject_type"] == subject["subject_type"], "artifact subject_type must match stored result")
    require(ref["subject_id"] == subject["subject_id"], "artifact subject_id must match stored result")
    require(ref["subject_version"] == subject["version"], "artifact subject_version must match stored result")
    require(ref["status"] == result["status"], "artifact status must match stored result")
    require(ref["runner_sha256"] == result["runner_contract"]["runner_sha256"], "artifact runner hash must match stored result")
    require(ref["completed_at"] == result["completed_at"], "artifact completed_at must match stored result")
    parse_datetime(ref["completed_at"], "stored_result_ref.completed_at")


def validate_artifact_manifest(contract: dict[str, Any], result: dict[str, Any]) -> None:
    ref = contract["stored_result_ref"]
    manifest = contract["artifact_manifest"]
    expected_object_key = f"tenants/{ref['tenant_id']}/eval-results/{ref['result_id']}.json"
    require(manifest["storage_table"] == "eval_results", "eval result artifact must bind to eval_results storage")
    require(manifest["object_key"] == expected_object_key, "eval result artifact object key must be tenant scoped")
    require(manifest["content_type"] == "application/json", "eval result artifact must be JSON")
    require(manifest["download_filename"] == f"{ref['result_id']}.json", "eval artifact download filename mismatch")
    require(set(manifest["artifact_links"]) == REQUIRED_ARTIFACT_LINKS, "eval artifact links must cover result, runner, QA, safety, and trace gates")

    expected_digests = {
        "result_json_sha256": canonical_sha256(result),
        "summary_json_sha256": canonical_sha256(result["summary"]),
        "fixture_results_json_sha256": canonical_sha256(result["fixture_results"]),
        "source_fixture_digests_json_sha256": canonical_sha256(result["runner_contract"]["source_fixture_digests"]),
        "runner_manifest_json_sha256": canonical_sha256(result["runner_contract"]),
    }
    for field, expected in expected_digests.items():
        require(manifest[field] == expected, f"eval artifact manifest stale digest for {field}")

    for field in [
        "contains_fixture_results",
        "contains_source_fixture_digests",
        "contains_runner_sha256",
        "contains_trace_export_gate_refs",
        "contains_qa_safety_refs",
    ]:
        require(manifest[field] is True, f"eval artifact manifest must set {field}")

    trace_ids = {item["trace_contract"]["trace_id"] for item in result["fixture_results"]}
    qa_check_ids = {
        check_id
        for item in result["fixture_results"]
        for check_id in item["qa_check_ids"]
    }
    qa_results = load_json(QA_RESULTS)
    resolved_qa_check_ids = {item["check_id"] for item in qa_results}
    require(
        qa_check_ids <= resolved_qa_check_ids,
        f"eval artifact QA refs missing declared checks: {sorted(qa_check_ids - resolved_qa_check_ids)}",
    )
    require(load_json(SAFETY_RULES), "eval artifact must link non-empty safety decisions/rules fixture")
    trace_gate = load_json(TRACE_EXPORT_GATE)
    gate_text = json.dumps(trace_gate, sort_keys=True)
    for trace_id in trace_ids:
        require(trace_id in gate_text, f"eval artifact trace export gate refs missing {trace_id}")


def validate_retrieval_and_retention(contract: dict[str, Any]) -> None:
    retrieval = contract["admin_retrieval_contract"]
    require(retrieval["operation_id"] == "getEvalResultArtifact", "eval artifact operation id mismatch")
    require(retrieval["path"] == "/eval/results/{result_id}/artifact", "eval artifact API path mismatch")
    require(retrieval["method"] == "GET", "eval artifact retrieval must be GET")
    for field in [
        "admin_rbac_required",
        "tenant_filter_required",
        "signed_url_required",
        "audit_log_required",
        "supports_blocked_results",
        "does_not_rerun_eval",
    ]:
        require(retrieval[field] is True, f"eval artifact retrieval must set {field}")
    require(retrieval["direct_object_access_allowed"] is False, "eval artifact retrieval must deny direct object access")
    require(retrieval["expires_in_seconds_max"] <= 900, "eval artifact signed URL expiry must be <= 900 seconds")

    retention = contract["retention_contract"]
    require(retention["artifact_retention_days_min"] >= 365, "eval artifact retention must be at least 365 days")
    for field in [
        "retain_pass_fail_blocked_artifacts",
        "retain_source_fixture_digests",
        "retain_runner_manifest",
        "redaction_preserves_hashes",
        "deletion_requires_admin_audit",
        "no_public_delete_operation",
    ]:
        require(retention[field] is True, f"eval artifact retention must set {field}")

    replay = contract["replay_verification_contract"]
    require(
        replay["validator"] == "scripts/validate_eval_result_artifact_contract.py",
        "eval artifact replay validator mismatch",
    )
    require(
        replay["check_command"] == "python3 scripts/validate_eval_result_artifact_contract.py",
        "eval artifact replay command mismatch",
    )
    for field in [
        "compares_exact_result_digest",
        "compares_source_fixture_digest",
        "compares_runner_digest",
        "requires_trace_export_gate_refs",
        "requires_qa_safety_refs",
    ]:
        require(replay[field] is True, f"eval artifact replay contract must set {field}")


def validate_openapi_contract(contract: dict[str, Any]) -> None:
    openapi_text = OPENAPI.read_text(encoding="utf-8")
    openapi_contract = contract["openapi_contract"]
    require(openapi_contract["schema_name"] == "EvalResultArtifact", "eval artifact OpenAPI schema name mismatch")
    require(openapi_contract["operation_id"] == "getEvalResultArtifact", "eval artifact OpenAPI operation mismatch")
    require(set(openapi_contract["required_schema_fields"]) == REQUIRED_OPENAPI_FIELDS, "eval artifact required schema fields mismatch")
    require(set(openapi_contract["required_operation_tokens"]) == REQUIRED_OPERATION_TOKENS, "eval artifact required operation tokens mismatch")

    body = schema_block(openapi_text, "EvalResultArtifact")
    for field in REQUIRED_OPENAPI_FIELDS:
        require_field_in_schema(body, "EvalResultArtifact", field)
    for token in [
        "format: uri",
        "direct_object_access_allowed:",
        "const: false",
        "audit_access_required:",
        "const: true",
        "eval_result_json",
        "source_fixture_digests_json",
        "trace_export_gate_matrix_json",
    ]:
        require(token in body, f"OpenAPI EvalResultArtifact missing contract token {token}")

    operation = path_block(openapi_text, "/eval/results/{result_id}/artifact")
    for token in [
        "operationId: getEvalResultArtifact",
        "x-rbac: admin",
        "$ref: \"#/components/parameters/TenantIdFilter\"",
        "$ref: \"#/components/schemas/EvalResultArtifact\"",
        "default:",
        "$ref: \"#/components/responses/Error\"",
    ]:
        require(token in operation, f"OpenAPI getEvalResultArtifact missing {token}")
    require("get:" in operation, "OpenAPI eval artifact operation must be GET")


def validate_contract() -> None:
    contract = load_json(CONTRACT)
    results = load_json(RESULTS)
    require(contract["blueprint_source"] == "Docs/stage0_blueprint_rev2.md", "eval artifact contract must cite Rev2")
    require(isinstance(results, list) and len(results) == 1, "starter eval result fixture must contain one result")
    result = results[0]
    validate_stored_result_ref(contract, result)
    validate_artifact_manifest(contract, result)
    validate_retrieval_and_retention(contract)
    validate_openapi_contract(contract)


def main() -> int:
    try:
        validate_contract()
    except EvalResultArtifactContractError as exc:
        print(f"eval result artifact contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("eval result artifact contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
