#!/usr/bin/env python3
"""Validate Stage 1 safety/QA/eval staging evidence.

The contract-only mode checks that Stage 1 has a precise evidence contract and
that it reuses the existing Stage 0 safety, QA, export gate, and override
validators. Strict mode requires canonical staging evidence and must not accept
local blocked probes as launch evidence.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "safety_qa_eval" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-safety-qa-eval.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-safety-qa-eval.ndjson"
DEFAULT_LOCAL_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "stage1-safety-qa-eval.local-devport.json"
DEFAULT_LOCAL_RESULTS = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "stage1-safety-qa-eval.local-devport.ndjson"
SMOKE_SCRIPT = ROOT / "scripts" / "stage1_safety_qa_eval_smoke.sh"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BATCH_PARTIAL = ROOT / "fixtures" / "stage1" / "batch_generation" / "partial_failure.json"
BATCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_batch_generation_contract.py"
SAFETY_VALIDATOR = ROOT / "scripts" / "validate_safety_enforcement_contract.py"
QA_VALIDATOR = ROOT / "scripts" / "validate_qa_result_contract.py"
EXPORT_GATE_VALIDATOR = ROOT / "scripts" / "validate_export_eligibility_decision_contract.py"
EXPORT_OVERRIDE_VALIDATOR = ROOT / "scripts" / "validate_export_override_contract.py"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
SERVER = ROOT / "backend" / "internal" / "server" / "server.go"
STAGE0_SERVICE = ROOT / "backend" / "internal" / "stage0" / "services.go"
WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
BATCH_EXECUTOR = ROOT / "backend" / "internal" / "task" / "batch_executor.go"
BATCH_REPOSITORY = ROOT / "backend" / "internal" / "task" / "batch_repository.go"
BATCH_EXECUTOR_TEST = ROOT / "backend" / "internal" / "task" / "batch_executor_test.go"
BATCH_GENERATION_TEST = ROOT / "backend" / "internal" / "task" / "batch_generation_test.go"
BATCH_RUNNER_TEST = ROOT / "backend" / "internal" / "worker" / "batch_runner_test.go"

REQUIRED_CHECKS = {
    "batch_blocked_child_refund",
    "batch_safety_review_reason",
    "edit_tool_policy_projection",
    "asset_import_policy_projection",
    "export_fail_closed",
    "admin_review_override",
    "support_ticket_redaction",
    "evidence_no_secret_material",
}

REQUIRED_SURFACES = {
    "batch_generation",
    "edit_tool",
    "asset_import",
    "export",
    "support_ticket",
    "admin_review",
}

REQUIRED_ENFORCEMENT_POINTS = {"brief", "provider_request", "provider_response", "qa", "export"}

SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "api_key",
    "provider_secret",
    "stripe_secret_key",
    "webhook_secret",
    "raw_prompt",
    "raw_provider_payload",
    "raw_safety_payload",
    "raw_support_body",
    "download_url",
    "signed_url",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|X-Amz-Signature|GoogleAccessId)"
)


class SafetyQAEvidenceError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SafetyQAEvidenceError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise SafetyQAEvidenceError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    require(path.exists(), f"missing {display_path(path)}")
    rows: list[dict[str, Any]] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SafetyQAEvidenceError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
        require(isinstance(row, dict), f"{display_path(path)}:{lineno} must contain a JSON object")
        rows.append(row)
    require(rows, f"{display_path(path)} must contain at least one result row")
    return rows


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")
    return text


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def is_private_or_local_host(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    if not normalized or normalized == "localhost" or normalized == "0.0.0.0" or normalized.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def validate_production_like_staging_url(value: Any, field: str, allow_local_devport: bool) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required")
    parsed = urlparse(value)
    require(parsed.scheme in {"http", "https"} and parsed.netloc, f"{field} must be an absolute HTTP URL")
    if allow_local_devport:
        return
    require(parsed.scheme == "https", f"{field} must use https for strict staging evidence")
    require(not is_private_or_local_host(parsed.hostname or ""), f"{field} must not target localhost or private network in strict staging evidence")


def validate_absolute_http_url(value: Any, field: str) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required")
    parsed = urlparse(value)
    require(parsed.scheme in {"http", "https"} and parsed.netloc, f"{field} must be an absolute HTTP URL")


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.safety_qa_eval.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "safety_qa_eval_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/staging/stage1-safety-qa-eval.json", "contract evidence path mismatch")
    require(contract.get("canonical_results_path") == "ops/evidence/staging/stage1-safety-qa-eval.ndjson", "contract results path mismatch")
    require(
        contract.get("local_devport_evidence_path")
        == "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.json",
        "contract local-devport evidence path mismatch",
    )
    require(
        contract.get("local_devport_results_path")
        == "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.ndjson",
        "contract local-devport results path mismatch",
    )
    require(contract.get("local_devport_can_clear_staging_gate") is False, "local devport evidence must not clear staging gate")
    require(contract.get("strict_schema_version") == "stage1.safety_qa_eval.v1", "contract strict schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_staging_safety_qa_eval_evidence_open", "contract must not close staging gate")
    require(REQUIRED_SURFACES <= set(contract.get("required_surfaces") or []), "contract missing required Stage 1 surfaces")
    require(REQUIRED_ENFORCEMENT_POINTS <= set(contract.get("required_enforcement_points") or []), "contract missing enforcement points")
    by_id = {item.get("check_id"): item for item in contract.get("required_checks") or [] if isinstance(item, dict)}
    require(REQUIRED_CHECKS <= set(by_id), f"contract missing checks {sorted(REQUIRED_CHECKS - set(by_id))}")
    require(REQUIRED_CHECKS <= set(contract.get("required_result_rows") or []), "contract missing required result rows")
    stage1_anchors = set(contract.get("required_stage1_anchors") or [])
    for anchor in (
        "backend/internal/task/batch_executor.go",
        "backend/internal/task/batch_repository.go",
        "backend/internal/task/batch_executor_test.go",
        "backend/internal/task/batch_generation_test.go",
        "backend/internal/worker/batch_runner_test.go",
    ):
        require(anchor in stage1_anchors, f"contract missing Stage 1 anchor {anchor}")
    for validator in (
        "scripts/validate_safety_enforcement_contract.py",
        "scripts/validate_qa_result_contract.py",
        "scripts/validate_export_eligibility_decision_contract.py",
        "scripts/validate_export_override_contract.py",
    ):
        require(validator in contract.get("required_stage0_validators", []), f"contract missing {validator}")
    policy = contract.get("safe_projection_policy")
    require(isinstance(policy, dict), "safe_projection_policy must be an object")
    for key in (
        "secret_material_persisted",
        "raw_prompt_persisted",
        "raw_provider_payload_persisted",
        "raw_safety_payload_persisted",
        "support_ticket_raw_body_projected_to_admin_evidence",
        "blocked_export_download_enabled",
    ):
        require(policy.get(key) is False, f"safe_projection_policy.{key} must be false")
    remaining = contract.get("remaining_staging_evidence")
    require(isinstance(remaining, list) and len(remaining) >= 6, "remaining_staging_evidence must preserve open staging proof")


def validate_code_anchors() -> None:
    require_text(
        SMOKE_SCRIPT,
        (
            "stage1-safety-qa-eval.json",
            "stage1-safety-qa-eval.ndjson",
            "stage1-safety-qa-eval.local-devport.json",
            "stage1-safety-qa-eval.local-devport.ndjson",
            "batch_blocked_child_refund",
            "batch_safety_review_reason",
            "edit_tool_policy_projection",
            "asset_import_policy_projection",
            "export_fail_closed",
            "admin_review_override",
            "support_ticket_redaction",
            "evidence_no_secret_material",
            "ALLOW_LOCAL_DEVPORT_EVIDENCE",
            "production_like_staging_urls_ready",
            "API_URL_RESOLVE_ADDR",
            "API_URL_CA_CERT",
            "WEB_URL_RESOLVE_ADDR",
            "WEB_URL_CA_CERT",
            "ADMIN_URL_RESOLVE_ADDR",
            "ADMIN_URL_CA_CERT",
            "--resolve",
            "--cacert",
            "api_network_args",
            "production_like_local_fixture_command",
            "USE_DEV_IDENTITY_HEADERS",
            "X-Zenari-User-ID",
            "local_devport_debug",
            "local_devport_debug_evidence_cannot_clear_staging_gate",
            "can_clear_stage1_safety_qa_gate",
            "validate_stage1_safety_qa_evidence.py",
        ),
    )
    require_text(
        BATCH_PARTIAL,
        (
            '"status": "blocked"',
            '"quota_refunded_units": 4',
            '"review_reason": "safety_review_required"',
            '"visible_trace_ref": "trace_projection_child_partial_4"',
        ),
    )
    require_text(
        BATCH_VALIDATOR,
        (
            "raw_safety_payload",
            "blocked child requires review_reason",
            "failed/cancelled/blocked child must refund quota",
            "generation_child_blocked_reason_check",
        ),
    )
    require_text(
        BATCH_EXECUTOR,
        (
            "type BatchSafetyGate interface",
            "EvaluateBatchChild",
            "func (e BatchChildExecutor) blockClaimedChild",
            "safety_gate_blocked",
            "provider_invoked",
            "BlockChildForReview",
            "sanitizeExecutionMessage",
        ),
    )
    require_text(
        BATCH_REPOSITORY,
        (
            "type BlockChildForReviewInput struct",
            "func (r BatchRepository) BlockChildForReview",
            "func (r BatchRepository) blockChildForReviewInDB",
            "status = 'blocked'",
            "review_reason = $3",
            "quota_refunded_units = quota_refunded_units + $4",
            "failure_code = ''",
            "failure_message = ''",
            "RefundBatchQuota",
            "normalizeBlockChildForReviewInput",
        ),
    )
    require_text(
        BATCH_EXECUTOR_TEST,
        (
            "TestBatchChildExecutorBlocksBeforeProviderInvokeWhenSafetyGateDenies",
            "provider was invoked despite safety block",
            "safety_gate_blocked",
            "provider_invoked",
            "safety_policy_id",
            "leaks prompt or payload",
        ),
    )
    require_text(
        BATCH_GENERATION_TEST,
        (
            "TestBatchRepositoryBlockChildForReviewRefundsRemainingQuota",
            "TestBatchRepositoryBlockChildForReviewRollsBackWhenLedgerRefundFails",
            "review_reason = $3",
            "status = 'blocked'",
        ),
    )
    require_text(
        BATCH_RUNNER_TEST,
        (
            "TestBatchRunnerRunOnceBlocksSafetyDeniedChildBeforeProvider",
            "provider was invoked despite safety gate block",
            "safety_gate_blocked",
            "provider_invoked",
        ),
    )
    for validator in (SAFETY_VALIDATOR, QA_VALIDATOR, EXPORT_GATE_VALIDATOR, EXPORT_OVERRIDE_VALIDATOR):
        require(validator.exists(), f"missing {display_path(validator)}")
    require_text(
        SAFETY_VALIDATOR,
        (
            "provider_request",
            "provider_response",
            "qa",
            "export",
            "deny_downloadable_artifact",
            "safety_override_block_to_warn_denied",
        ),
    )
    require_text(QA_VALIDATOR, ("file_integrity", "blank_output", "forbidden_claims", "export_completeness"))
    require_text(EXPORT_GATE_VALIDATOR, ("final_export_allowed", "safety_policy_block", "incomplete_export_artifacts"))
    require_text(EXPORT_OVERRIDE_VALIDATOR, ("critical_safety_rule", "missing_approval_audit", "source_not_override_eligible"))
    require_text(
        OPENAPI,
        (
            "operationId: createSafetyDecision",
            "operationId: createExportOverride",
            "/support/tickets:",
            "SafetyDecisionCreate",
            "ExportOverrideDecision",
        ),
    )
    require_text(
        SERVER,
        (
            "POST /api/admin/v1/safety/decisions",
            "POST /api/v1/support/tickets",
            "POST /api/admin/v1/exports/{export_id}/regenerate",
            "safety_blocked",
            "second_review_required",
        ),
    )
    require_text(
        STAGE0_SERVICE,
        (
            "EnforceSafety",
            "RecordExportArtifact",
            "CreateSupportTicket",
            "security.Redact",
        ),
    )
    require_text(
        WORKSPACE,
        (
            "data-safety-policy-stage-count",
            "data-safety-policy-finding-count",
            "No package items are eligible for final export.",
            "Support tickets attach project, export, task, trace",
        ),
    )
    require_text(REPO_VALIDATE, ("validate_stage1_safety_qa_evidence.py --contract-only",))
    require_text(GAP_INVENTORY, ("VF-5", "safety/QA/eval", "stage1-safety-qa-eval.json"))


def validate_blocked_probe_evidence(data: dict[str, Any], rows: list[dict[str, Any]], allow_local_devport: bool) -> None:
    require(data.get("schema_version") == "stage1.safety_qa_eval.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "safety/QA evidence must be staging evidence")
    require(data.get("kind") == "safety_qa_eval", "kind must be safety_qa_eval")
    require(data.get("status") == "blocked", "blocked safety/QA/eval evidence status must be blocked")
    if allow_local_devport:
        validate_production_like_staging_url(data.get("api_url"), "api_url", allow_local_devport=True)
        require(data.get("local_devport_debug") is True, "local-devport evidence must mark local_devport_debug")
    else:
        validate_absolute_http_url(data.get("api_url"), "api_url")
        require(data.get("local_devport_debug") is not True, "canonical blocked evidence must not be local-devport debug")
    for key in (
        "secret_material_persisted",
        "raw_prompt_persisted",
        "raw_provider_payload_persisted",
        "raw_safety_payload_persisted",
        "support_ticket_raw_body_projected_to_admin_evidence",
        "user_download_for_blocked_export",
    ):
        require(data.get(key) is False, f"{key} must be false")

    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list) and blocked_checks, "blocked evidence must include blocked_checks")
    if allow_local_devport:
        require(
            blocked_checks == ["local_devport_debug_evidence_cannot_clear_staging_gate"],
            "local-devport evidence must only be blocked by debug gate policy",
        )
    else:
        require("production_like_staging_url_required" in (data.get("blocked_reasons") or blocked_checks), "canonical blocked evidence must preserve staging URL blocker")

    readiness = data.get("runtime_input_readiness")
    require(isinstance(readiness, dict), "runtime_input_readiness must be object")
    for key in (
        "staging_api_url_ready",
        "admin_auth_ready",
        "user_auth_ready",
        "csrf_ready",
        "batch_runtime_ready",
        "export_runtime_ready",
    ):
        require(key in readiness, f"runtime_input_readiness.{key} must be present")
    if allow_local_devport:
        require(readiness.get("allow_local_devport_evidence") is True, "local-devport readiness flag must be true")
        require(readiness.get("canonical_pass_path") is False, "local-devport evidence must not claim canonical pass path")
    else:
        require(readiness.get("allow_local_devport_evidence") is not True, "canonical blocked evidence must not allow local-devport evidence")
        require(readiness.get("canonical_pass_path") is True, "canonical blocked evidence must identify canonical path")

    checks = data.get("checks")
    require(isinstance(checks, list) and checks, "checks must be non-empty")
    by_id = {item.get("check_id"): item for item in checks if isinstance(item, dict)}
    require(REQUIRED_CHECKS <= set(by_id), f"evidence missing checks {sorted(REQUIRED_CHECKS - set(by_id))}")
    for check_id in REQUIRED_CHECKS:
        check = by_id[check_id]
        require(check.get("request_id"), f"{check_id} must record request_id")
        require(check.get("secret_leak_detected") is False, f"{check_id} leaked secret material")
        if allow_local_devport:
            require(check.get("status") == "passed", f"local-devport {check_id} must pass before debug-only gate block")
        else:
            require(check.get("status") == "blocked", f"canonical blocked {check_id} must remain blocked")

    row_ids = {row.get("check_id") for row in rows}
    require(REQUIRED_CHECKS <= row_ids, f"results missing rows {sorted(REQUIRED_CHECKS - row_ids)}")
    for row in rows:
        if row.get("check_id") in REQUIRED_CHECKS:
            require(row.get("secret_leak_detected") is False, f"result {row.get('check_id')} leaked secret")
            if allow_local_devport:
                require(row.get("status") == "passed", f"local-devport result {row.get('check_id')} must pass before debug-only gate block")
            else:
                require(row.get("status") == "blocked", f"canonical blocked result {row.get('check_id')} must remain blocked")

    gate_impact = data.get("gate_impact")
    require(isinstance(gate_impact, dict), "gate_impact must be object")
    require(gate_impact.get("can_clear_stage1_safety_qa_gate") is False, "blocked safety/QA evidence cannot clear gate")
    require(
        gate_impact.get("preserved_release_gate_check_id") == "stage1_safety_qa_eval",
        "blocked safety/QA evidence must preserve release gate check",
    )
    require(isinstance(gate_impact.get("remaining_blockers"), list) and gate_impact["remaining_blockers"], "blocked evidence must list remaining blockers")

    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "probe_contract must be object")
    require(
        probe_contract.get("canonical_pass_report") == "ops/evidence/staging/stage1-safety-qa-eval.json",
        "probe_contract canonical report path mismatch",
    )
    require(
        probe_contract.get("canonical_pass_results") == "ops/evidence/staging/stage1-safety-qa-eval.ndjson",
        "probe_contract canonical results path mismatch",
    )
    require(
        probe_contract.get("local_devport_report")
        == "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.json",
        "probe_contract local-devport report path mismatch",
    )
    require(
        probe_contract.get("local_devport_results")
        == "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.ndjson",
        "probe_contract local-devport results path mismatch",
    )
    require(
        "cannot clear staging gates" in str(probe_contract.get("allow_local_devport_evidence_env") or ""),
        "probe_contract must state local-devport evidence cannot clear staging gates",
    )
    fixture_command = str(probe_contract.get("production_like_local_fixture_command") or "")
    for token in (
        "API_URL_RESOLVE_ADDR=127.0.0.1",
        "API_URL_CA_CERT=<self-signed-ca.pem>",
        "WEB_URL_RESOLVE_ADDR=127.0.0.1",
        "WEB_URL_CA_CERT=<self-signed-ca.pem>",
        "ADMIN_URL_RESOLVE_ADDR=127.0.0.1",
        "ADMIN_URL_CA_CERT=<self-signed-ca.pem>",
    ):
        require(token in fixture_command, f"probe_contract production-like fixture command must include {token}")


def validate_evidence(evidence_path: Path, results_path: Path, allow_local_devport: bool = False) -> None:
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "evidence")
    assert_no_secret(rows, "results")

    if data.get("status") == "blocked":
        validate_blocked_probe_evidence(data, rows, allow_local_devport=allow_local_devport)
        if allow_local_devport:
            return
        raise SafetyQAEvidenceError("canonical safety/QA/eval staging pass evidence is still missing; blocked probe evidence cannot clear staging gate")

    require(data.get("schema_version") == "stage1.safety_qa_eval.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "safety/QA evidence must be staging evidence")
    require(data.get("kind") == "safety_qa_eval", "kind must be safety_qa_eval")
    if allow_local_devport:
        require(data.get("status") == "blocked", "local-devport safety/QA/eval evidence must stay blocked")
        require(data.get("local_devport_debug") is True, "local-devport evidence must mark local_devport_debug")
        require(
            data.get("blocked_checks") == ["local_devport_debug_evidence_cannot_clear_staging_gate"],
            "local-devport evidence must only be blocked by debug gate policy",
        )
    else:
        require(data.get("status") == "pass", "safety/QA/eval evidence status must be pass")
        require(data.get("local_devport_debug") is not True, "strict staging evidence must not be local-devport debug")
    validate_production_like_staging_url(data.get("api_url"), "api_url", allow_local_devport)
    for key in (
        "secret_material_persisted",
        "raw_prompt_persisted",
        "raw_provider_payload_persisted",
        "raw_safety_payload_persisted",
        "support_ticket_raw_body_projected_to_admin_evidence",
        "user_download_for_blocked_export",
    ):
        require(data.get(key) is False, f"{key} must be false")
    require(data.get("admin_review_audit_present") is True, "admin review audit proof is required")

    readiness = data.get("runtime_input_readiness")
    require(isinstance(readiness, dict), "runtime_input_readiness must be object")
    for key in (
        "staging_api_url_ready",
        "admin_auth_ready",
        "user_auth_ready",
        "csrf_ready",
        "batch_runtime_ready",
        "export_runtime_ready",
    ):
        require(readiness.get(key) is True, f"runtime_input_readiness.{key} must be true")
    if allow_local_devport:
        require(readiness.get("allow_local_devport_evidence") is True, "local-devport readiness flag must be true")
        require(readiness.get("canonical_pass_path") is False, "local-devport evidence must not claim canonical pass path")
    else:
        require(readiness.get("allow_local_devport_evidence") is not True, "strict staging evidence must not allow local-devport evidence")

    checks = data.get("checks")
    require(isinstance(checks, list) and checks, "checks must be non-empty")
    by_id = {item.get("check_id"): item for item in checks if isinstance(item, dict)}
    require(REQUIRED_CHECKS <= set(by_id), f"evidence missing checks {sorted(REQUIRED_CHECKS - set(by_id))}")
    for check_id in REQUIRED_CHECKS:
        check = by_id[check_id]
        require(check.get("status") == "passed", f"{check_id} must pass")
        require(check.get("request_id"), f"{check_id} must record request_id")
        require(check.get("secret_leak_detected") is False, f"{check_id} leaked secret material")

    row_ids = {row.get("check_id") for row in rows}
    require(REQUIRED_CHECKS <= row_ids, f"results missing rows {sorted(REQUIRED_CHECKS - row_ids)}")
    for row in rows:
        if row.get("check_id") in REQUIRED_CHECKS:
            require(row.get("status") == "passed", f"result {row.get('check_id')} must pass")
            require(row.get("secret_leak_detected") is False, f"result {row.get('check_id')} leaked secret")

    batch = data.get("batch_runtime")
    require(isinstance(batch, dict), "batch_runtime must be object")
    require(batch.get("batch_id"), "batch_runtime.batch_id is required")
    require(batch.get("blocked_child_refunded") is True, "blocked child refund proof is required")
    require(batch.get("safety_review_reason_visible") is True, "safety review reason proof is required")

    gate_impact = data.get("gate_impact")
    require(isinstance(gate_impact, dict), "gate_impact must be object")
    if allow_local_devport:
        require(gate_impact.get("can_clear_stage1_safety_qa_gate") is False, "local-devport evidence cannot clear safety/QA gate")
        require(
            gate_impact.get("preserved_release_gate_check_id") == "stage1_safety_qa_eval",
            "local-devport evidence must preserve safety/QA release gate check",
        )
    else:
        require(gate_impact.get("can_clear_stage1_safety_qa_gate") is True, "strict pass evidence must clear safety/QA gate")

    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "probe_contract must be object")
    require(
        probe_contract.get("local_devport_report")
        == "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.json",
        "probe_contract local-devport report path mismatch",
    )
    require(
        probe_contract.get("local_devport_results")
        == "ops/evidence/staging/local-devport/stage1-safety-qa-eval.local-devport.ndjson",
        "probe_contract local-devport results path mismatch",
    )
    require(
        "cannot clear staging gates" in str(probe_contract.get("allow_local_devport_evidence_env") or ""),
        "probe_contract must state local-devport evidence cannot clear staging gates",
    )
    fixture_command = str(probe_contract.get("production_like_local_fixture_command") or "")
    for token in (
        "API_URL_RESOLVE_ADDR=127.0.0.1",
        "API_URL_CA_CERT=<self-signed-ca.pem>",
        "WEB_URL_RESOLVE_ADDR=127.0.0.1",
        "WEB_URL_CA_CERT=<self-signed-ca.pem>",
        "ADMIN_URL_RESOLVE_ADDR=127.0.0.1",
        "ADMIN_URL_CA_CERT=<self-signed-ca.pem>",
    ):
        require(token in fixture_command, f"probe_contract production-like fixture command must include {token}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors without requiring staging evidence")
    parser.add_argument("--allow-local-devport", action="store_true", help="allow localhost/private dev-port URLs for local debugging evidence")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="safety/QA/eval staging evidence JSON path")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="safety/QA/eval NDJSON result path")
    args = parser.parse_args()
    try:
        validate_contract_fixture(load_json(CONTRACT))
        validate_code_anchors()
        if not args.contract_only:
            evidence_path = DEFAULT_LOCAL_EVIDENCE if args.allow_local_devport and args.evidence == str(DEFAULT_EVIDENCE) else Path(args.evidence)
            results_path = DEFAULT_LOCAL_RESULTS if args.allow_local_devport and args.results == str(DEFAULT_RESULTS) else Path(args.results)
            validate_evidence(evidence_path, results_path, allow_local_devport=args.allow_local_devport)
    except SafetyQAEvidenceError as exc:
        print(f"stage1 safety/QA/eval evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 safety/QA/eval evidence contract passed")
    else:
        print("stage1 safety/QA/eval evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
