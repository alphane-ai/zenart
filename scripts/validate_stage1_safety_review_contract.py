#!/usr/bin/env python3
"""Validate Stage 1 AD-8 safety review API/UI contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "safety_review" / "local_contract.json"
MIGRATION = ROOT / "backend" / "migrations" / "0016_stage1_safety_review_ops.sql"
STAGE0_CODE = ROOT / "backend" / "internal" / "stage0" / "services.go"
STAGE0_TESTS = ROOT / "backend" / "internal" / "stage0" / "services_test.go"
SERVER_CODE = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_TESTS = ROOT / "backend" / "internal" / "server" / "server_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_SAFETY_PAGE = ROOT / "admin" / "app" / "safety" / "page.tsx"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class SafetyReviewContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SafetyReviewContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise SafetyReviewContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.safety_review.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "safety_review_admin_contract", "fixture kind mismatch")
    require({"AD-8", "QA-5", "VF-5"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require("GET /api/admin/v1/safety/reviews" in data.get("required_backend_routes", []), "fixture missing read route")
    require("POST /api/admin/v1/safety/reviews/{decision_id}/decision" in data.get("required_backend_routes", []), "fixture missing write route")
    require(data.get("required_permissions", {}).get("read") == "safety:read", "fixture read permission mismatch")
    require(data.get("required_permissions", {}).get("write") == "safety_rule:admin", "fixture write permission mismatch")
    non_launch = data.get("non_launch_status")
    require(isinstance(non_launch, dict), "fixture non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("staging_evidence") == "open", "staging evidence must remain open")
    require(non_launch.get("can_clear_stage1_safety_qa_gate") is False, "local contract must not clear staging safety QA gate")
    for ref in data.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")


def validate_backend() -> None:
    require_text(
        MIGRATION,
        (
            "CREATE TABLE IF NOT EXISTS safety_review_decisions",
            "UNIQUE (tenant_id, idempotency_key)",
            "audit_ref text NOT NULL",
            "CHECK (decision IN ('approved', 'rejected', 'escalated', 'blocked'))",
        ),
    )
    require_text(
        STAGE0_CODE,
        (
            "type SafetyReviewItem struct",
            "type SafetyReviewDecisionInput struct",
            "func (r Repository) ListSafetyReviewQueue",
            "func (r Repository) RecordSafetyReviewDecision",
            "FROM safety_decisions sd",
            "LEFT JOIN LATERAL",
            "FROM safety_review_decisions",
            "sd.tenant_id = $1",
            "sd.decision IN ('warn', 'require_admin_review', 'block')",
            "raw_prompt_persisted",
            "raw_provider_payload_persisted",
            "raw_safety_payload_persisted",
            "secret_material_persisted",
            "security.RedactString",
            "security.RedactMap",
            "existingSafetyReviewDecision",
            "ensureSafetyDecisionBelongsToTenant",
        ),
    )
    require_text(
        SERVER_CODE,
        (
            'GET /api/admin/v1/safety/reviews',
            'POST /api/admin/v1/safety/reviews/{decision_id}/decision',
            "auth.PermissionSafetyRead",
            "auth.PermissionSafetyRuleAdmin",
            "func (s *Server) listSafetyReviews",
            "func (s *Server) recordSafetyReviewDecision",
            "requireIdempotencyKey",
            "audit.RecorderFromContext",
            "safetyReviewAuditMetadata",
            'Action:    "safety.review"',
            "security.RedactString",
            "stage0.SafetyReviewDecisionInput",
        ),
    )
    require_text(
        STAGE0_TESTS,
        (
            "TestListSafetyReviewQueueUsesTenantStatusAndSafeProjection",
            "TestRecordSafetyReviewDecisionRedactsMetadataAndChecksTenant",
            "raw_prompt_persisted",
            "secret_material_persisted",
            "INSERT INTO safety_review_decisions",
        ),
    )
    require_text(
        SERVER_TESTS,
        (
            "TestAdminSafetyReviewsUsesPrincipalTenantAndSafeProjection",
            "TestAdminSafetyReviewDecisionRecordsAuditAndRedacts",
            "TestAdminSafetyReviewDecisionRequiresIdempotencyBeforeAudit",
            "X-Zenari-CSRF",
            "Idempotency-Key",
            "safety.review",
            "safety_review_audit_record_error",
        ),
    )


def validate_openapi_admin() -> None:
    require_text(
        OPENAPI,
        (
            "/safety/reviews:",
            "operationId: listSafetyReviews",
            "/safety/reviews/{decision_id}/decision:",
            "operationId: createSafetyReviewDecision",
            "SafetyReviewItem:",
            "SafetyReviewDecisionCreate:",
            "SafetyReviewDecision:",
            "raw_prompt_persisted:",
            "raw_provider_payload_persisted:",
            "raw_safety_payload_persisted:",
            "secret_material_persisted:",
            "x-idempotency-required: true",
        ),
    )
    require_text(
        ADMIN_GENERATED,
        (
            'listSafetyReviews: { method: "GET", path: "/safety/reviews", rbac: "admin"',
            'createSafetyReviewDecision: { method: "POST", path: "/safety/reviews/{decision_id}/decision", rbac: "admin", idempotencyRequired: true',
        ),
    )
    require_text(
        ADMIN_TYPES,
        (
            "safetyDecisionId?: string",
            "reviewStatus?:",
            "requiredEvidenceRefs?: string[]",
            'source?: "api" | "fixture"',
        ),
    )
    require_text(
        ADMIN_API,
        (
            "type SafetyReviewAPI",
            "type SafetyReviewPage",
            "/api/admin/v1/safety/reviews?status=pending&page_size=100",
            "mapSafetyReviewToRiskyExport",
            'source: "api"',
            'source: "fixture"',
            "safety_decision_id",
        ),
    )
    require_text(
        ADMIN_SAFETY_PAGE,
        (
            "Safety Review Queue",
            "live api",
            "fixture fallback",
            "Safety Decision",
            "Review Status",
            "User Outcome",
            "Evidence Refs",
        ),
    )
    require_text(
        ADMIN_TESTS,
        (
            "Safety Review Queue",
            "listSafetyReviews",
            "createSafetyReviewDecision",
            "raw_provider_payload_persisted",
        ),
    )


def validate_inventory() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-5a",
            "scripts/validate_stage1_safety_review_contract.py",
            "AD-8",
            "GET /api/admin/v1/safety/reviews",
            "POST /api/admin/v1/safety/reviews/{decision_id}/decision",
        ),
    )


def validate_no_secret_material() -> None:
    for path in (FIXTURE, MIGRATION, STAGE0_CODE, SERVER_CODE, OPENAPI, ADMIN_API, ADMIN_SAFETY_PAGE):
        text = read_text(path)
        require(not RAW_SECRET_RE.search(text), f"{path.relative_to(ROOT)} contains raw secret-looking material")


def main() -> int:
    try:
        validate_fixture()
        validate_backend()
        validate_openapi_admin()
        validate_inventory()
        validate_no_secret_material()
    except SafetyReviewContractError as exc:
        print(f"stage1 safety review contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 safety review contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
