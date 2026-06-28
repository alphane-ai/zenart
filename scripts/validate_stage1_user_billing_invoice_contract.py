#!/usr/bin/env python3
"""Validate Stage 1 user billing invoice/receipt contract anchors."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BILLING_CODE = ROOT / "backend" / "internal" / "billing" / "billing.go"
BILLING_STRIPE_CODE = ROOT / "backend" / "internal" / "billing" / "stripe_checkout.go"
BILLING_STRIPE_TESTS = ROOT / "backend" / "internal" / "billing" / "stripe_checkout_test.go"
SERVER_CODE = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_TESTS = ROOT / "backend" / "internal" / "server" / "server_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
WEB_GENERATED = ROOT / "web" / "lib" / "generated" / "zenart-api.ts"
WEB_BILLING_CLIENT = ROOT / "web" / "lib" / "billing-client.ts"
WEB_CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
WEB_API_CLIENT = ROOT / "web" / "lib" / "api-client.ts"
WEB_DEV_STATE = ROOT / "web" / "lib" / "dev-state.ts"
WEB_APP = ROOT / "web" / "components" / "workspace-app.tsx"
WEB_CSS = ROOT / "web" / "app" / "globals.css"
WEB_API_TESTS = ROOT / "web" / "lib" / "api-client.test.ts"
WEB_APP_TESTS = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
WEB_SECURITY_SPEC = ROOT / "web" / "tests" / "session-security.spec.ts"
USER_ROUTE_SMOKE = ROOT / "web" / "validation" / "user-routes-smoke.json"
SESSION_SECURITY_CONTRACT = ROOT / "web" / "validation" / "session-security-browser-contract.json"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"


class UserBillingInvoiceContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise UserBillingInvoiceContractError(message)


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
            "type BillingInvoice struct",
            'Provider        string    `json:"provider"`',
            'AmountDueCents  int64     `json:"amount_due_cents"`',
            'AmountPaidCents int64     `json:"amount_paid_cents"`',
            'InvoiceURL      string    `json:"invoice_url,omitempty"`',
            'ReceiptURL      string    `json:"receipt_url,omitempty"`',
            "type BillingInvoicePage struct",
            'Items []BillingInvoice `json:"items"`',
            "ListInvoices(ctx context.Context, subscriptionID string) (BillingInvoicePage, error)",
        ),
    )
    require_text(
        BILLING_STRIPE_CODE,
        (
            "func (a StripeAdapter) ListInvoices",
            'endpoint := "/v1/invoices?subscription="',
            "&limit=10",
            'HostedInvoiceURL string `json:"hosted_invoice_url"`',
            'InvoicePDF       string `json:"invoice_pdf"`',
            "stripe invoice response livemode=true while STRIPE_MODE=test",
            'Provider:        "stripe"',
            "Currency:        strings.ToUpper(invoice.Currency)",
            "InvoiceURL:      invoice.HostedInvoiceURL",
            "ReceiptURL:      invoice.InvoicePDF",
        ),
    )
    require_text(
        BILLING_STRIPE_TESTS,
        (
            "TestStripeListInvoicesMapsInvoiceAndReceiptURLs",
            "TestStripeListInvoicesRejectsLiveModeResponseInTestMode",
            "hosted_invoice_url",
            "invoice_pdf",
            "https://invoice.stripe.test/in_test_001.pdf",
            "ReceiptURL",
            "livemode rejection",
        ),
    )


def validate_server_contract() -> None:
    require_text(
        SERVER_CODE,
        (
            'GET /api/v1/billing/invoices',
            "func (s *Server) listBillingInvoices",
            "billingProviderFromContext",
            "s.currentBillingSubscription",
            "subscription.ProviderRef",
            "provider.ListInvoices",
            "billing_subscription_provider_ref_missing",
            "billing_invoice_lookup_failed",
        ),
    )
    require_text(
        SERVER_TESTS,
        (
            "TestListBillingInvoicesUsesStoredProviderReference",
            'req := httptest.NewRequest(http.MethodGet, "/api/v1/billing/invoices", nil)',
            "provider.invoiceSubscriptionID",
            '"sub_test_001"',
            "https://invoice.stripe.test/in_test_001",
            "https://invoice.stripe.test/in_test_001.pdf",
            "body.Items[0].ReceiptURL",
        ),
    )


def validate_openapi_and_generated_client() -> None:
    require_text(
        OPENAPI,
        (
            "/billing/invoices:",
            "operationId: listBillingInvoices",
            "x-rbac: user",
            "$ref: \"#/components/schemas/BillingInvoicePage\"",
            "BillingInvoicePage:",
            "BillingInvoice:",
            "required: [id, provider, status, currency, amount_due_cents, amount_paid_cents, created_at]",
            "amount_due_cents:",
            "amount_paid_cents:",
            "invoice_url:",
            "receipt_url:",
            "format: uri",
        ),
    )
    require_text(
        WEB_GENERATED,
        (
            '"listBillingInvoices"',
            'listBillingInvoices: { method: "GET", path: "/billing/invoices", rbac: "user", idempotencyRequired: false',
        ),
    )


def validate_web_contract() -> None:
    require_text(
        WEB_BILLING_CLIENT,
        (
            "export type BillingInvoice =",
            "amount_due_cents: number;",
            "amount_paid_cents: number;",
            "invoice_url?: string;",
            "receipt_url?: string;",
            "export type BillingInvoicePage =",
            "listInvoices(): Promise<BillingInvoicePage>;",
            'this.apiClient.request<BillingInvoicePage>("listBillingInvoices")',
        ),
    )
    require_text(
        WEB_CONTRACTS,
        (
            "invoices: BillingInvoice[];",
            'invoiceSyncStatus: "api" | "local" | "unavailable";',
            "invoiceSyncedAt?: string;",
            "export interface BillingInvoice",
            "amountDueCents: number;",
            "amountPaidCents: number;",
            "invoiceUrl?: string;",
            "receiptUrl?: string;",
            "refreshBillingInvoices(): Promise<WorkspaceState>;",
        ),
    )
    require_text(
        WEB_API_CLIENT,
        (
            "const mapBillingInvoice",
            "amount_due_cents: number;",
            "receipt_url?: string;",
            "amountDueCents: invoice.amount_due_cents",
            "receiptUrl: invoice.receipt_url",
            "const refreshBillingInvoiceProjection",
            "billingClient.listInvoices()",
            'invoiceSyncStatus: "api"',
            "async refreshBillingInvoices()",
            'invoiceSyncStatus: "unavailable"',
        ),
    )
    require_text(
        WEB_DEV_STATE,
        (
            "in_test_local_alpha_001",
            "in_test_local_alpha_002",
            "receiptUrl",
            'invoiceSyncStatus: "local"',
            "invoiceSyncedAt",
        ),
    )


def validate_web_ui_contract() -> None:
    require_text(
        WEB_APP,
        (
            '"Refresh Invoices"',
            '"Refresh Invoices": ["listBillingInvoices"]',
            'data-billing-invoice-ui="stage1.invoice-receipt-product-ui"',
            'data-billing-invoice-contract="listBillingInvoices:GET:/billing/invoices:include:not-required:false"',
            "data-billing-invoice-count={state.billing.invoices.length}",
            "data-billing-invoice-sync-status={state.billing.invoiceSyncStatus}",
            'unsafeActionGuardAttributes("Refresh Invoices", state)',
            "zenariClient.refreshBillingInvoices()",
            'data-billing-invoice-list="stage1"',
            "data-billing-invoice-row",
            "data-billing-invoice-provider",
            "data-billing-invoice-status",
            "data-billing-invoice-has-invoice-url",
            "data-billing-invoice-has-receipt-url",
            "Invoice",
            "Receipt",
        ),
    )
    require_text(
        WEB_CSS,
        (
            ".invoice-card",
            ".invoice-list",
            ".invoice-row",
            ".invoice-actions",
        ),
    )


def validate_tests_and_smoke_contracts() -> None:
    require_text(
        WEB_API_TESTS,
        (
            "refreshes invoice and receipt links through the billing API",
            "listInvoices: vi.fn",
            "receipt_url",
            "refreshBillingInvoices",
            "invoiceSyncStatus",
            "receiptUrl",
        ),
    )
    require_text(
        WEB_APP_TESTS,
        (
            '"Refresh Invoices"',
            '"data-billing-invoice-contract"',
            '"listBillingInvoices:GET:/billing/invoices:include:not-required:false"',
            "data-billing-invoice-has-receipt-url",
            "in_test_local_alpha_001",
        ),
    )
    require_text(
        WEB_SECURITY_SPEC,
        (
            '"listBillingInvoices"',
            '"listBillingInvoices:GET:include:not-required"',
            '"listBillingInvoices:/billing/invoices:/billing/invoices"',
            '"Refresh Invoices"',
        ),
    )
    require_text(
        USER_ROUTE_SMOKE,
        (
            '"Refresh Invoices"',
            '"Refresh Invoices=>listBillingInvoices:GET:not-required:false"',
            '"Refresh Invoices=>listBillingInvoices:GET:/billing/invoices:include:not-required:false"',
            '"listBillingInvoices:GET:include:not-required"',
            '"listBillingInvoices:/billing/invoices:/billing/invoices"',
        ),
    )
    require_text(
        SESSION_SECURITY_CONTRACT,
        (
            '"Refresh Invoices"',
            '"listBillingInvoices:GET:include:not-required"',
            '"listBillingInvoices:/billing/invoices:/billing/invoices"',
        ),
    )


def validate_inventory_and_repo_validator() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-4c",
            "user billing invoice/receipt UI",
            "stage1.invoice-receipt-product-ui",
            "GET /billing/invoices",
            "Refresh Invoices",
            "invoice/receipt product UI now exists locally",
            "Real Stripe invoice/receipt staging evidence remains open",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_user_billing_invoice_contract.py",
            "python3 scripts/validate_stage1_user_billing_invoice_contract.py",
        ),
    )


def validate() -> None:
    validate_backend_contract()
    validate_server_contract()
    validate_openapi_and_generated_client()
    validate_web_contract()
    validate_web_ui_contract()
    validate_tests_and_smoke_contracts()
    validate_inventory_and_repo_validator()


def main() -> int:
    try:
        validate()
    except UserBillingInvoiceContractError as exc:
        print(f"stage1 user billing invoice contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 user billing invoice contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
