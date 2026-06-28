#!/usr/bin/env python3
"""Validate Stage 1 AD-10 export ops API/UI contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "export_ops" / "local_contract.json"
MIGRATION = ROOT / "backend" / "migrations" / "0017_stage1_export_override_ops.sql"
STAGE0_CODE = ROOT / "backend" / "internal" / "stage0" / "services.go"
STAGE0_TESTS = ROOT / "backend" / "internal" / "stage0" / "services_test.go"
SERVER_CODE = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_TESTS = ROOT / "backend" / "internal" / "server" / "server_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_EXPORTS_PAGE = ROOT / "admin" / "app" / "exports" / "page.tsx"
ADMIN_EXPORT_DETAIL = ROOT / "admin" / "app" / "exports" / "[id]" / "page.tsx"
ADMIN_EXPORT_ACTIONS = ROOT / "admin" / "app" / "exports" / "actions.ts"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class ExportOpsContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ExportOpsContractError(message)


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
        raise ExportOpsContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.export_ops.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "export_ops_admin_contract", "fixture kind mismatch")
    require({"AD-10", "AS-10", "AS-12", "QA-5"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    for route in (
        "GET /api/admin/v1/exports",
        "POST /api/admin/v1/exports/{export_id}/regenerate",
        "POST /api/admin/v1/exports/{export_id}/override",
        "POST /api/admin/v1/exports/cleanup",
    ):
        require(route in data.get("required_backend_routes", []), f"fixture missing route {route}")
    permissions = data.get("required_permissions")
    require(isinstance(permissions, dict), "fixture required_permissions must be object")
    require(permissions.get("read") == "export:read", "fixture read permission mismatch")
    require(permissions.get("regenerate") == "export_override:admin", "fixture regenerate permission mismatch")
    require(permissions.get("override") == "export_override:admin", "fixture override permission mismatch")
    require(permissions.get("cleanup") == "object_cleanup:admin", "fixture cleanup permission mismatch")
    non_launch = data.get("non_launch_status")
    require(isinstance(non_launch, dict), "fixture non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("staging_evidence") == "open", "staging evidence must remain open")
    require(non_launch.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging runtime")
    require(non_launch.get("can_clear_object_retention_gate") is False, "local contract must not clear retention gate")
    for ref in data.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")


def validate_backend() -> None:
    require_text(
        MIGRATION,
        (
            "CREATE TABLE IF NOT EXISTS export_override_decisions",
            "UNIQUE (tenant_id, idempotency_key)",
            "CHECK (source_type IN ('qa_result', 'safety_decision', 'export_contract'))",
            "CHECK (outcome IN ('approved', 'denied'))",
            "audit_log_id text NOT NULL",
            "final_export_allowed boolean NOT NULL DEFAULT false",
        ),
    )
    require_text(
        STAGE0_CODE,
        (
            "type ExportOverrideDecisionInput struct",
            "type ExportOverrideDecision struct",
            "func (r Repository) RecordExportOverrideDecision",
            "func (r Repository) existingExportOverrideDecision",
            "INSERT INTO export_override_decisions",
            "FROM export_override_decisions",
            "GetExport(ctx, input.TenantID, input.ExportID)",
            "sourceGateResolved",
            "FinalExportAllowed: false",
            "security.RedactString",
            "security.RedactMap",
            "non-secret export override rationale is required",
        ),
    )
    require_text(
        SERVER_CODE,
        (
            'GET /api/admin/v1/exports',
            'POST /api/admin/v1/exports/{export_id}/regenerate',
            'POST /api/admin/v1/exports/{export_id}/override',
            'POST /api/admin/v1/exports/cleanup',
            "auth.PermissionExportRead",
            "auth.PermissionExportOverrideAdmin",
            "auth.PermissionObjectCleanupAdmin",
            "func (s *Server) listExports",
            "func (s *Server) regenerateExport",
            "func (s *Server) createExportOverride",
            "func (s *Server) cleanupExports",
            "func (s *Server) cleanupExports(w http.ResponseWriter, r *http.Request) {\n\tif !requireIdempotencyKey(w, r)",
            "requireIdempotencyKey",
            "audit.RecorderFromContext",
            "exportOverrideAuditMetadata",
            'Action:    "export.override"',
            "export_override_audit_record_error",
            "stage0.ExportOverrideDecisionInput",
            "r.PathValue(\"export_id\")",
            "cleanupExportsWithMode",
            "export.cleanup",
        ),
    )
    require_text(
        STAGE0_TESTS,
        (
            "TestRecordExportOverrideDecisionRedactsChecksTenantAndIsIdempotent",
            "INSERT INTO export_override_decisions",
            "GetExport",
            "SourceGateResolved",
            "FinalExportAllowed",
        ),
    )
    require_text(
        SERVER_TESTS,
        (
            "TestAdminExportRegenerateRequiresIdempotencyBeforeStorage",
            "TestAdminExportOverrideRecordsAuditAndRedacts",
            "TestAdminExportOverrideAuditFailureDoesNotRecord",
            "Idempotency-Key",
            "X-Zenari-CSRF",
            "export.override",
            "export_override_audit_record_error",
            "INSERT INTO export_override_decisions",
        ),
    )


def validate_openapi_admin() -> None:
    require_text(
        OPENAPI,
        (
            "/exports:",
            "operationId: listExports",
            "/exports/cleanup:",
            "operationId: cleanupExports",
            "/exports/{export_id}/regenerate:",
            "operationId: regenerateExport",
            "/exports/{export_id}/override:",
            "operationId: createExportOverride",
            "ExportOverrideCreate:",
            "ExportOverrideDecision:",
            "final_export_allowed:",
            "source_gate_resolved:",
            "x-idempotency-required: true",
        ),
    )
    require_text(
        ADMIN_GENERATED,
        (
            'listExports: { method: "GET", path: "/exports", rbac: "admin"',
            'cleanupExports: { method: "POST", path: "/exports/cleanup", rbac: "admin", idempotencyRequired: true',
            'regenerateExport: { method: "POST", path: "/exports/{export_id}/regenerate", rbac: "admin", idempotencyRequired: true',
            'createExportOverride: { method: "POST", path: "/exports/{export_id}/override", rbac: "admin", idempotencyRequired: true',
        ),
    )
    require_text(
        ADMIN_TYPES,
        (
            'source?: "api" | "fixture"',
            "downloadEnabled?: boolean",
            "signedUrlPresent?: boolean",
            "downloadExpiresAt?: string",
            "retentionUntil?: string",
            "blockedReasons?: string[]",
            "finalExportAllowed?: boolean",
            "manifestPresent?: boolean",
            "qaReportPresent?: boolean",
            "provenancePresent?: boolean",
            "traceId?: string",
        ),
    )
    require_text(
        ADMIN_API,
        (
            "type ExportAPI",
            "type ExportPage",
            "getExportJobs",
            "/api/admin/v1/exports?page_size=100",
            "mapExportToJob",
            'source: "api"',
            'source: "fixture"',
            "download_enabled",
            "download_expires_at",
            "retention_until",
            "denial_reasons",
            "manifestPresent",
            "qaReportPresent",
            "provenancePresent",
            "trace_id",
        ),
    )
    require_text(
        ADMIN_EXPORT_ACTIONS,
        (
            "regenerateExportAction",
            "createExportOverrideAction",
            "cleanupExportsAction",
            "/api/admin/v1/exports/${encodeURIComponent(exportID)}/regenerate",
            "/api/admin/v1/exports/${encodeURIComponent(exportID)}/override",
            "/api/admin/v1/exports/cleanup",
            '"Idempotency-Key"',
            '"X-Zenari-CSRF"',
            "second_reviewer_id",
            "second_review_rationale",
            "source_type",
            "denial_reason",
            "dry_run",
        ),
    )
    require_text(
        ADMIN_EXPORTS_PAGE,
        (
            "Export Operations",
            "live api",
            "fixture fallback",
            "Export API Contract",
            "listExports",
            "regenerateExport",
            "createExportOverride",
            "exports cleanup",
            "X-Zenari-CSRF",
            "Idempotency-Key",
            "Signed URL",
            "Retention Until",
            "Blocked Reasons",
            "Manifest",
            "QA Report",
            "Provenance",
            "Trace",
            "regenerateExportAction",
            "createExportOverrideAction",
            "cleanupExportsAction",
            'data-export-op-form="regenerateExport"',
            'data-export-op-form="createExportOverride"',
            'data-export-op-form="exportsCleanup"',
        ),
    )
    require_text(
        ADMIN_EXPORT_DETAIL,
        (
            "Stage 1 Export Safety",
            "Signed URL",
            "Retention until",
            "Blocked reasons",
            "Manifest",
            "QA report",
            "Provenance",
            "Trace",
            "finalExportAllowed",
        ),
    )
    require_text(
        ADMIN_TESTS,
        (
            "admin export pages expose regeneration governance evidence",
            "admin export operations expose API-backed override retention controls",
            "regenerateExportAction",
            "createExportOverrideAction",
            "cleanupExportsAction",
            "listExports",
            "regenerateExport",
            "createExportOverride",
            "Signed URL",
            "Retention",
            "Blocked Reasons",
            "Idempotency-Key",
            "X-Zenari-CSRF",
        ),
    )


def validate_inventory() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-5b",
            "scripts/validate_stage1_export_ops_contract.py",
            "AD-10",
            "GET /api/admin/v1/exports",
            "POST /api/admin/v1/exports/{export_id}/regenerate",
            "POST /api/admin/v1/exports/{export_id}/override",
            "POST /api/admin/v1/exports/cleanup",
        ),
    )


def validate_no_secret_material() -> None:
    for path in (
        FIXTURE,
        MIGRATION,
        STAGE0_CODE,
        SERVER_CODE,
        OPENAPI,
        ADMIN_API,
        ADMIN_EXPORTS_PAGE,
        ADMIN_EXPORT_ACTIONS,
    ):
        text = read_text(path)
        require(not RAW_SECRET_RE.search(text), f"{path.relative_to(ROOT)} contains raw secret-looking material")


def main() -> int:
    try:
        validate_fixture()
        validate_backend()
        validate_openapi_admin()
        validate_inventory()
        validate_no_secret_material()
    except ExportOpsContractError as exc:
        print(f"stage1 export ops contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 export ops contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
