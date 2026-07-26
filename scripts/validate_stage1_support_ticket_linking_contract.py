#!/usr/bin/env python3
"""Validate Stage 1 BE-12 support ticket linking/redaction local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "support_ticket_linking" / "local_contract.json"
SUPPORT = ROOT / "backend" / "internal" / "support" / "ticket.go"
SUPPORT_TESTS = ROOT / "backend" / "internal" / "support" / "ticket_test.go"
STAGE0 = ROOT / "backend" / "internal" / "stage0" / "services.go"
STAGE0_TESTS = ROOT / "backend" / "internal" / "stage0" / "services_test.go"
MIGRATION_REV2 = ROOT / "backend" / "migrations" / "0006_support_ticket_evidence_links.sql"
MIGRATION_BATCH = ROOT / "backend" / "migrations" / "0011_stage1_provider_batch_contracts.sql"
MIGRATION_STAGE1 = ROOT / "backend" / "migrations" / "0018_stage1_support_ticket_links.sql"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_FIXTURES = ROOT / "admin" / "lib" / "fixtures.ts"
ADMIN_SUPPORT = ROOT / "admin" / "app" / "support" / "page.tsx"
WEB_CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
WEB_DEV_STATE = ROOT / "web" / "lib" / "dev-state.ts"
WEB_WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

REQUIRED_LINKS = {
    "project_id",
    "task_id",
    "batch_id",
    "trace_id",
    "asset_id",
    "linked_export_id",
    "quota_bucket_id",
    "billing_reference_id",
}


class SupportTicketContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SupportTicketContractError(message)


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
        raise SupportTicketContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_fixture()
    require(data.get("schema_version") == "stage1.support_ticket_linking.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "backend_support_ticket_linking_contract", "fixture kind mismatch")
    require({"BE-12", "AD-12", "OP-13", "QA-9", "BL-8"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("backend_package") == "backend/internal/support", "fixture backend_package mismatch")
    require(data.get("openapi_source") == "openapi/zenart.v1.yaml", "fixture OpenAPI source mismatch")
    require(REQUIRED_LINKS <= set(data.get("required_evidence_links") or []), "fixture required evidence links incomplete")

    redaction = data.get("redaction_contract")
    require(isinstance(redaction, dict), "redaction_contract must be object")
    for key in (
        "ticket_body_redacted_before_persistence",
        "metadata_redacted_before_persistence",
        "list_projection_redacts_stored_body",
        "list_projection_redacts_stored_metadata",
    ):
        require(redaction.get(key) is True, f"{key} must be true")
    for key in ("raw_provider_payload_allowed", "raw_prompt_allowed", "raw_billing_payload_allowed", "raw_secret_projection_allowed"):
        require(redaction.get(key) is False, f"{key} must be false")

    runtime = data.get("runtime_wiring")
    require(isinstance(runtime, dict), "runtime_wiring must be object")
    require(runtime.get("create_route") == "POST /api/v1/support/tickets", "create route mismatch")
    require(runtime.get("admin_list_route") == "GET /api/admin/v1/support/tickets", "admin list route mismatch")
    require(runtime.get("analytics_event") == "support_ticket_created", "analytics event mismatch")

    database = data.get("database_contract")
    require(isinstance(database, dict), "database_contract must be object")
    require(REQUIRED_LINKS - {"project_id"} <= set(link for link in data.get("required_evidence_links") or []), "database links incomplete")
    require(database.get("required_constraint") == "chk_support_tickets_required_evidence", "constraint mismatch")
    indexes = set(database.get("tenant_scoped_indexes") or [])
    require({"idx_support_tickets_tenant_batch", "idx_support_tickets_tenant_billing_ref"} <= indexes, "stage1 support indexes missing")

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_contract") == "pass", "local contract status mismatch")
    require(status.get("staging_support_workflow_evidence") == "open", "staging evidence must remain open")
    require(status.get("production_security_evidence") == "open", "production evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local contract must not clear production security gate")


def validate_backend() -> None:
    require_text(
        SUPPORT,
        (
            "type TicketEvidence struct",
            "ProjectID",
            "TaskID",
            "BatchID",
            "TraceID",
            "AssetID",
            "LinkedExportID",
            "QuotaBucketID",
            "BillingReferenceID",
            "NormalizeAndRedact",
            "security.RedactString",
            "security.RedactMap",
            "ErrMissingEvidence",
            "AnalyticsProperties",
        ),
    )
    require_text(
        SUPPORT_TESTS,
        (
            "TestNormalizeAndRedactRequiresStage1EvidenceLinks",
            "TestNormalizeAndRedactCoversProjectTaskBatchAssetExportBillingAndSecrets",
            "TestTicketEvidenceAnalyticsPropertiesAreSafeAndComplete",
        ),
    )
    require_text(
        STAGE0,
        (
            "support.NormalizeAndRedact",
            "BatchID",
            "BillingRefID",
            "batch_id",
            "billing_reference_id",
            "support_ticket_created",
            "security.RedactString(ticket.Body)",
            "security.RedactMap(ticket.Metadata)",
            "normalized.Evidence.AnalyticsProperties",
        ),
    )
    require_text(
        STAGE0_TESTS,
        (
            "TestCreateSupportTicketPersistsTenantUserAndLinks",
            "TestCreateSupportTicketRequiresRev2EvidenceLinks",
            "TestListSupportTicketsReturnsEvidenceLinks",
            "TestListSupportTicketsRedactsStoredSecrets",
            "batch_1",
            "billing:stripe:in_1",
            "billing_reference_id",
        ),
    )


def validate_migrations_and_openapi() -> None:
    require_text(
        MIGRATION_REV2,
        (
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS task_id text;",
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS trace_id text;",
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS asset_id text;",
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS quota_bucket_id text;",
        ),
    )
    require_text(
        MIGRATION_BATCH,
        (
            "CREATE TABLE IF NOT EXISTS batch_generation_requests",
            "idx_batch_generation_requests_tenant_id_unique",
            "ON batch_generation_requests(tenant_id, id)",
        ),
    )
    require_text(
        MIGRATION_STAGE1,
        (
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS batch_id text;",
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS billing_reference_id text;",
            "idx_batch_generation_requests_tenant_id_unique",
            "ON batch_generation_requests(tenant_id, id)",
            "idx_support_tickets_tenant_batch",
            "idx_support_tickets_tenant_billing_ref",
            "fk_support_tickets_tenant_batch",
            "chk_support_tickets_required_evidence",
            "batch_id IS NOT NULL AND batch_id <> ''",
            "billing_reference_id IS NOT NULL AND billing_reference_id <> ''",
        ),
    )
    require_text(
        OPENAPI,
        (
            "SupportTicketCreate:",
            "required: [project_id, task_id, batch_id, trace_id, asset_id, category, body, linked_export_id, quota_bucket_id, billing_reference_id]",
            "batch_id:",
            "billing_reference_id:",
            "raw billing payloads and secrets are forbidden",
            "Redacted public-safe support metadata",
        ),
    )


def validate_surfaces() -> None:
    require_text(
        ADMIN_TYPES,
        (
            "export type SupportTicket",
            "batchId: string",
            "quotaBucketId: string",
            "billingReferenceId: string",
        ),
    )
    require_text(
        ADMIN_FIXTURES,
        (
            "batchId",
            "quotaBucketId",
            "billingReferenceId",
            "billing_admin_operation:bao-2201",
        ),
    )
    require_text(
        ADMIN_SUPPORT,
        (
            "project, batch, task, trace, asset, export, quota, billing",
            "row.batchId",
            "row.quotaBucketId",
            "row.billingReferenceId",
        ),
    )
    require_text(
        WEB_CONTRACTS,
        (
            "linkedBatchId?: string",
            "linkedBillingReferenceId?: string",
        ),
    )
    require_text(
        WEB_DEV_STATE,
        (
            "linkedBatchId",
            "linkedBillingReferenceId",
            "batch-local-workspace",
        ),
    )
    require_text(
        WEB_WORKSPACE,
        (
            "Support tickets attach project, batch, export, task, trace, accepted reference, quota, and billing context",
            "problemContext.linkedBatchId",
            "problemContext.linkedBillingReferenceId",
            "ticket.linkedBillingReferenceId",
        ),
    )


def validate_repo_wiring() -> None:
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_support_ticket_linking_contract.py",
            "python3 scripts/validate_stage1_support_ticket_linking_contract.py",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-2g",
            "validate_stage1_support_ticket_linking_contract.py",
            "BE-12",
            "support workflow staging evidence remains open",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_backend()
        validate_migrations_and_openapi()
        validate_surfaces()
        validate_repo_wiring()
    except SupportTicketContractError as exc:
        print(f"stage1 support ticket linking contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 support ticket linking contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
