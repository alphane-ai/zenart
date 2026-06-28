import { expect, test } from "@playwright/test";

const invoiceContract = "listBillingInvoices:GET:/billing/invoices:include:not-required:false";
const teamSeatUsageContract = "getTeamSeatUsage:GET:/teams/{team_id}/seat-usage:include:not-required:false";
const teamSeatEntitlementContract = "checkTeamSeatEntitlement:GET:/teams/{team_id}/seat-entitlement:include:not-required:false";
const teamSeatAcceptContract = "acceptTeamInvite:POST:/teams/{team_id}/invites/{invite_id}/accept:include:X-Zenari-CSRF:true";

test("billing quota, invoices, and team seats remain locally covered", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Billing and Quota" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Start Checkout" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "createCheckoutSession:POST:/billing/checkout:include:X-Zenari-CSRF:true"
  );
  await expect(page.getByRole("button", { name: "Manage Billing" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "createBillingPortalSession:POST:/billing/portal:include:X-Zenari-CSRF:true"
  );
  await expect(page.getByRole("button", { name: "Cancel Subscription" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    "cancelSubscription:POST:/billing/subscription/cancel:include:X-Zenari-CSRF:true"
  );
  await expect(page.getByRole("button", { name: "Refresh Invoices" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    invoiceContract
  );

  const invoiceCard = page.locator("[data-billing-invoice-ui='stage1.invoice-receipt-product-ui']");
  await expect(invoiceCard).toHaveAttribute("data-billing-invoice-count", "2");
  await expect(invoiceCard).toHaveAttribute("data-billing-invoice-sync-status", "local");
  await expect(invoiceCard).toHaveAttribute("data-billing-invoice-contract", invoiceContract);

  const firstInvoice = invoiceCard.locator("[data-billing-invoice-row='in_test_local_alpha_001']");
  await expect(firstInvoice).toHaveAttribute("data-billing-invoice-provider", "stripe");
  await expect(firstInvoice).toHaveAttribute("data-billing-invoice-status", "paid");
  await expect(firstInvoice).toHaveAttribute("data-billing-invoice-has-invoice-url", "true");
  await expect(firstInvoice).toHaveAttribute("data-billing-invoice-has-receipt-url", "true");
  await expect(firstInvoice.getByRole("link", { name: "Invoice" })).toBeVisible();
  await expect(firstInvoice.getByRole("link", { name: "Receipt" })).toBeVisible();

  const teamSeatCard = page.locator("[data-team-seat-ui='stage1.team-seat-product-ui']");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-usage-contract", teamSeatUsageContract);
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-entitlement-contract", teamSeatEntitlementContract);
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-accept-contract", teamSeatAcceptContract);
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-team-id", "team_1");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billable", "3");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-available", "2");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-entitlement", "ok");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-pending-invite", "pending");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-projection", "stage1.team-seat-billing-safe-projection");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-provider", "stripe");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-proration", "create_prorations");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-invoice-impact", "prorated_on_next_invoice");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-sync-status", "local");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-safe-projection", "true");

  await expect(page.getByRole("button", { name: "Refresh Seats" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    `${teamSeatUsageContract}|${teamSeatEntitlementContract}`
  );
  await expect(page.getByRole("button", { name: "Accept Invite" })).toHaveAttribute(
    "data-csrf-ux-guard-contracts",
    teamSeatAcceptContract
  );

  await page.getByRole("button", { name: "Refresh Invoices" }).click();
  await expect(invoiceCard).toHaveAttribute("data-billing-invoice-sync-status", "unavailable");
  await expect(invoiceCard).toHaveAttribute("data-billing-invoice-count", "2");

  await page.getByRole("button", { name: "Refresh Seats" }).click();
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-safe-projection", "true");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-sync-status", "local");

  await page.getByRole("button", { name: "Accept Invite" }).click();
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-pending-invite", "accepted");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billable", "3");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-available", "2");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-safe-projection", "true");
  await expect(teamSeatCard).toHaveAttribute("data-team-seat-billing-sync-status", "local");
});
