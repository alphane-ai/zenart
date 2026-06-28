#!/usr/bin/env python3
"""Validate Stage 1 admin billing operation contract anchors."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BILLING_CODE = ROOT / "backend" / "internal" / "billing" / "billing.go"
BILLING_TESTS = ROOT / "backend" / "internal" / "billing" / "billing_test.go"
SERVER_CODE = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_CONTEXT = ROOT / "backend" / "internal" / "server" / "billing_context.go"
SERVER_TESTS = ROOT / "backend" / "internal" / "server" / "server_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
ADMIN_QUOTA_PAGE = ROOT / "admin" / "app" / "quota" / "page.tsx"
ADMIN_QUOTA_ACTIONS = ROOT / "admin" / "app" / "quota" / "actions.ts"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"


class AdminBillingOpsContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AdminBillingOpsContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def validate_backend_contract() -> None:
    require_text(
        BILLING_CODE,
        (
            "type AdminBillingOperation string",
            'AdminBillingOperationManualCredit     AdminBillingOperation = "manual_credit"',
            'AdminBillingOperationRefundNote       AdminBillingOperation = "refund_note"',
            'AdminBillingOperationSyncSubscription AdminBillingOperation = "sync_subscription"',
            'AdminBillingOperationAccountLock      AdminBillingOperation = "account_lock"',
            "type AdminBillingOperationInput struct",
            "type AdminBillingOperationResult struct",
            "type AdminBillingOperator interface",
            "ManualCredit(ctx context.Context, input AdminBillingOperationInput)",
            "RecordRefundNote(ctx context.Context, input AdminBillingOperationInput)",
            "SyncSubscription(ctx context.Context, input AdminBillingOperationInput)",
            "LockAccount(ctx context.Context, input AdminBillingOperationInput)",
            "type AdminBillingRepository struct",
            "func NewAdminBillingRepository",
            "func (r AdminBillingRepository) ManualCredit",
            "func (r AdminBillingRepository) RecordRefundNote",
            "func (r AdminBillingRepository) SyncSubscription",
            "func (r AdminBillingRepository) LockAccount",
            "INSERT INTO billing_admin_operations",
            "UPDATE billing_admin_operations",
            "INSERT INTO billing_account_locks",
            "security.RedactMap",
            "ErrAdminBillingValidation",
        ),
    )
    require_text(
        BILLING_TESTS,
        (
            "TestAdminBillingRepositoryManualCreditRecordsOperationAndQuotaCredit",
            "TestAdminBillingRepositoryRedactsMetadataBeforePersistence",
            "manual_credit_1",
            "refund_note_1",
            "billing_admin_operations",
            "UPDATE billing_admin_operations",
            "succeeded",
        ),
    )


def validate_server_contract() -> None:
    require_text(
        SERVER_CONTEXT,
        (
            "ContextWithBillingAdminOperator",
            "billingAdminOperatorFromContext",
            "billing.AdminBillingOperator",
        ),
    )
    require_text(
        SERVER_CODE,
        (
            'POST /api/admin/v1/billing/manual-credit',
            'POST /api/admin/v1/billing/refund-note',
            'POST /api/admin/v1/billing/subscription-sync',
            'POST /api/admin/v1/billing/account-lock',
            "auth.PermissionAdminQuotaEdit",
            "func (s *Server) createAdminBillingManualCredit",
            "func (s *Server) createAdminBillingRefundNote",
            "func (s *Server) createAdminBillingSubscriptionSync",
            "func (s *Server) createAdminBillingAccountLock",
            "func (s *Server) runAdminBillingOperation",
            "requireIdempotencyKey",
            "billingAdminOperatorFromContext",
            "audit.RecorderFromContext",
            "security.RedactString(input.Rationale)",
            "security.RedactMap(input.Metadata)",
            "billing_admin_target_user_required",
            "billing_admin_rationale_required",
            "billing_admin_note_invalid",
            "billing_admin_manual_credit_invalid",
            "billing_admin_refund_note_required",
            'Action:    auditAction + ".requested"',
            'Action:    auditAction + ".failed"',
            "billing.refund_note",
            "billing.subscription_sync",
            "billing.account_lock",
            "callAdminBillingOperator",
        ),
    )
    require_text(
        SERVER_TESTS,
        (
            "TestAdminBillingManualCreditRecordsAuditAndCallsOperator",
            "TestAdminBillingOpsRequireIdempotencyBeforeMutation",
            "TestAdminBillingOpsRejectInsufficientRoleBeforeMutation",
            "TestAdminBillingOpsRequireAuditBeforeMutation",
            "TestAdminBillingControlPlaneRoutesCallExpectedOperator",
            "fakeAdminBillingOperator",
            "billing.manual_credit.requested",
            "billing.refund_note",
            "billing.subscription_sync",
            "billing.account_lock",
        ),
    )


def validate_openapi_and_generated_client() -> None:
    require_text(
        OPENAPI,
        (
            "/billing/manual-credit:",
            "operationId: createAdminBillingManualCredit",
            "/billing/refund-note:",
            "operationId: createAdminBillingRefundNote",
            "/billing/subscription-sync:",
            "operationId: createAdminBillingSubscriptionSync",
            "/billing/account-lock:",
            "operationId: createAdminBillingAccountLock",
            "x-idempotency-required: true",
            "AdminBillingManualCreditCreate:",
            "AdminBillingRefundNoteCreate:",
            "AdminBillingSubscriptionSyncCreate:",
            "AdminBillingAccountLockCreate:",
            "AdminBillingOperation:",
            "enum: [manual_credit, refund_note, sync_subscription, account_lock]",
            "required: [target_user_id, bucket_id, units, rationale]",
            "required: [target_user_id, note, rationale]",
            "metadata:",
            "description: Public-safe operation metadata. Raw secrets are rejected or redacted before audit/persistence.",
        ),
    )
    require_text(
        ADMIN_GENERATED,
        (
            'createAdminBillingManualCredit: { method: "POST", path: "/billing/manual-credit", rbac: "admin", idempotencyRequired: true',
            'createAdminBillingRefundNote: { method: "POST", path: "/billing/refund-note", rbac: "admin", idempotencyRequired: true',
            'createAdminBillingSubscriptionSync: { method: "POST", path: "/billing/subscription-sync", rbac: "admin", idempotencyRequired: true',
            'createAdminBillingAccountLock: { method: "POST", path: "/billing/account-lock", rbac: "admin", idempotencyRequired: true',
        ),
    )


def validate_admin_ui_contract() -> None:
    require_text(
        ADMIN_TYPES,
        (
            "export type AdminBillingOperationKind",
            "manual_credit",
            "refund_note",
            "sync_subscription",
            "account_lock",
            "export type AdminBillingOperationStatus",
            "export type AdminBillingOperation =",
            "export type AdminBillingOpsSource",
        ),
    )
    require_text(
        ADMIN_API,
        (
            "export type AdminBillingOpsPanel",
            "getAdminBillingOpsPanel",
            "adminBillingOperationFixtures",
            "admin_billing_op_manual_credit_fixture_1",
            "admin_billing_op_refund_note_fixture_1",
            "admin_billing_op_subscription_sync_fixture_1",
            "admin_billing_op_account_lock_fixture_1",
            "Admin billing operation mutations require ADMIN_API_BASE_URL or NEXT_PUBLIC_ADMIN_API_BASE_URL.",
            "process.env.ADMIN_API_BASE_URL || process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL",
        ),
    )
    require_text(
        ADMIN_QUOTA_ACTIONS,
        (
            "createAdminBillingManualCreditAction",
            "createAdminBillingRefundNoteAction",
            "createAdminBillingSubscriptionSyncAction",
            "createAdminBillingAccountLockAction",
            "/api/admin/v1/billing/manual-credit",
            "/api/admin/v1/billing/refund-note",
            "/api/admin/v1/billing/subscription-sync",
            "/api/admin/v1/billing/account-lock",
            "adminMutationHeaders",
            '"Idempotency-Key"',
            '"X-Zenari-CSRF"',
            "ticketMetadata(formData)",
            "redirectBillingOps",
        ),
    )
    require_text(
        ADMIN_QUOTA_PAGE,
        (
            "Admin Billing Operations",
            'data-admin-endpoint="billing-ops"',
            'data-admin-billing-op="manual_credit"',
            'data-admin-billing-op="refund_note"',
            'data-admin-billing-op="sync_subscription"',
            'data-admin-billing-op="account_lock"',
            "Manual Credit",
            "Refund Note",
            "Subscription Sync",
            "Account Lock",
            "createAdminBillingManualCredit:POST:/billing/manual-credit:include:X-Zenari-CSRF:true",
            "createAdminBillingRefundNote:POST:/billing/refund-note:include:X-Zenari-CSRF:true",
            "createAdminBillingSubscriptionSync:POST:/billing/subscription-sync:include:X-Zenari-CSRF:true",
            "createAdminBillingAccountLock:POST:/billing/account-lock:include:X-Zenari-CSRF:true",
            "billingOpsMessage",
            "metadataStringFromRecord",
        ),
    )
    require_text(
        ADMIN_TESTS,
        (
            "admin quota page exposes audited billing operation controls",
            "createAdminBillingManualCreditAction",
            "createAdminBillingRefundNoteAction",
            "createAdminBillingSubscriptionSyncAction",
            "createAdminBillingAccountLockAction",
            "createAdminBillingManualCredit",
            "createAdminBillingRefundNote",
            "createAdminBillingSubscriptionSync",
            "createAdminBillingAccountLock",
        ),
    )


def validate_inventory_and_repo_validator() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "BL-8",
            "Admin billing ops API/backend/UI contract now exists",
            "Real Stripe refund execution",
            "quota reset automation",
            "staging evidence remain open",
            "`AD-7`: The quota page now exposes API-backed Team Seat Operations controls",
            "audited admin billing operation forms for manual credit, refund note, subscription sync, and account lock",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_admin_billing_ops_contract.py",
            "python3 scripts/validate_stage1_admin_billing_ops_contract.py",
        ),
    )


def main() -> int:
    try:
        validate_backend_contract()
        validate_server_contract()
        validate_openapi_and_generated_client()
        validate_admin_ui_contract()
        validate_inventory_and_repo_validator()
    except AdminBillingOpsContractError as exc:
        print(f"stage1 admin billing ops contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 admin billing ops contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
