#!/usr/bin/env python3
"""Validate Stage 1 BE-14 API error taxonomy local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "api_error_taxonomy" / "local_contract.json"
API = ROOT / "backend" / "internal" / "api" / "error_taxonomy.go"
API_TESTS = ROOT / "backend" / "internal" / "api" / "error_taxonomy_test.go"
MIDDLEWARE = ROOT / "backend" / "internal" / "server" / "middleware.go"
SERVER_TESTS = ROOT / "backend" / "internal" / "server" / "server_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
OPENAPI_TESTS = ROOT / "backend" / "internal" / "server" / "openapi_contract_test.go"
WEB_GENERATED = ROOT / "web" / "lib" / "generated" / "zenart-api.ts"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class APIErrorTaxonomyContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise APIErrorTaxonomyContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_fixture() -> dict[str, Any]:
    try:
        data = json.loads(read_text(FIXTURE))
    except json.JSONDecodeError as exc:
        raise APIErrorTaxonomyContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_fixture()
    require(data.get("schema_version") == "stage1.api_error_taxonomy.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "backend_api_error_taxonomy_contract", "fixture kind mismatch")
    require({"BE-14", "FE-10", "FE-16", "OP-13"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("backend_package") == "backend/internal/api", "fixture backend package mismatch")
    require(data.get("openapi_source") == "openapi/zenart.v1.yaml", "fixture OpenAPI source mismatch")

    envelope = data.get("shared_envelope")
    require(isinstance(envelope, dict), "shared_envelope must be object")
    require(envelope.get("schema") == "ErrorEnvelope", "shared envelope schema mismatch")
    required_fields = set(envelope.get("required_fields") or [])
    require({"code", "message", "request_id", "taxonomy", "retryable", "blocked", "details", "field_errors"} <= required_fields, "ErrorEnvelope required fields incomplete")
    preserved = set(envelope.get("backward_compatible_fields_preserved") or [])
    require({"code", "message", "request_id", "details", "field_errors"} <= preserved, "fixture must preserve existing envelope fields")

    categories = set(data.get("taxonomy_categories") or [])
    require({"retryable", "blocked", "quota_insufficient", "provider_unavailable", "review_required"} <= categories, "fixture missing blueprint categories")

    states = data.get("blueprint_error_states")
    require(isinstance(states, list) and len(states) == 5, "fixture must list five blueprint error states")
    by_state = {item.get("state"): item for item in states if isinstance(item, dict)}
    for state in ("retryable", "blocked", "quota_insufficient", "provider_unavailable", "review_required"):
        require(state in by_state, f"fixture missing state {state}")
        require(isinstance(by_state[state].get("retryable"), bool), f"{state}.retryable must be bool")
        require(isinstance(by_state[state].get("blocked"), bool), f"{state}.blocked must be bool")

    runtime = data.get("runtime_wiring")
    require(isinstance(runtime, dict), "runtime_wiring must be object")
    require(runtime.get("writer") == "backend/internal/server/writeError", "runtime writer mismatch")
    require("taxonomy" in runtime.get("top_level_fields", []), "runtime must expose top-level taxonomy")
    require(runtime.get("details_projection") == "details.taxonomy", "runtime must expose details.taxonomy")

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_contract") == "pass", "local contract status mismatch")
    require(status.get("frontend_staging_error_state_evidence") == "open", "frontend staging evidence must remain open")
    require(status.get("production_security_evidence") == "open", "production evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local contract must not clear production security gate")


def validate_code() -> None:
    require_text(
        API,
        (
            "type ErrorTaxonomy struct",
            "ErrorCategoryRetryable",
            "ErrorCategoryBlocked",
            "ErrorCategoryQuotaInsufficient",
            "ErrorCategoryProviderUnavailable",
            "ErrorCategoryReviewRequired",
            "ClassifyError",
            "user_actionable",
        ),
    )
    require_text(
        API_TESTS,
        (
            "TestClassifyErrorCoversStage1Taxonomy",
            "rate_limit_exceeded",
            "safety_blocked",
            "batch_quota_insufficient",
            "provider_quota_unavailable",
            "provider_unavailable",
            "safety_review_required",
        ),
    )
    require_text(
        MIDDLEWARE,
        (
            "api.ClassifyError",
            '"taxonomy"',
            '"retryable"',
            '"blocked"',
            'details["taxonomy"]',
            "security.RedactMap(details)",
        ),
    )
    require_text(
        SERVER_TESTS,
        (
            "TestWriteErrorAddsStage1Taxonomy",
            "TestTaskStatusStubUsesErrorEnvelope",
            "quota_insufficient",
            "provider_quota_unavailable",
            "provider_unavailable",
            "review_required",
            "details.taxonomy",
        ),
    )
    require_text(
        OPENAPI,
        (
            "ErrorEnvelope:",
            "required: [code, message, request_id, taxonomy, retryable, blocked, details, field_errors]",
            "ErrorTaxonomy:",
            "enum: [validation, auth, forbidden, not_found, conflict, retryable, blocked, quota_insufficient, provider_unavailable, review_required, internal]",
            "user_actionable:",
        ),
    )
    require_text(OPENAPI_TESTS, ("TestOpenAPIOperationsDeclareSharedErrorEnvelope", "ErrorEnvelope:"))
    for generated in (WEB_GENERATED, ADMIN_GENERATED):
        require_text(
            generated,
            (
                "export type ErrorEnvelope",
                "taxonomy: {",
                "| \"quota_insufficient\"",
                "| \"provider_unavailable\"",
                "| \"review_required\"",
                "user_actionable: boolean",
                "retryable: boolean",
                "blocked: boolean",
            ),
        )


def validate_repo_wiring() -> None:
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_api_error_taxonomy_contract.py",
            "python3 scripts/validate_stage1_api_error_taxonomy_contract.py",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-2f",
            "validate_stage1_api_error_taxonomy_contract.py",
            "BE-14",
            "frontend staging error-state evidence remains open",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_code()
        validate_repo_wiring()
    except APIErrorTaxonomyContractError as exc:
        print(f"stage1 API error taxonomy contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 API error taxonomy contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
