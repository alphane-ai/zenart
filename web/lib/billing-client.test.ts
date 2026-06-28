import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiBillingClient, defaultCheckoutPlanId } from "./billing-client";

describe("billing API client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads quota state without CSRF because the operation is safe", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          buckets: [
            {
              id: "quota_1",
              limit_units: 100,
              used_units: 25,
              reserved_units: 5,
              resets_at: "2026-07-01T00:00:00Z"
            }
          ],
          transactions: [
            {
              id: "txn_1",
              kind: "commit",
              units: 4,
              status: "committed",
              created_at: "2026-06-21T10:00:00Z"
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const client = new ApiBillingClient("/api/v1");

    const state = await client.getQuotaState();

    expect(state.buckets[0]).toMatchObject({
      id: "quota_1",
      used_units: 25,
      reserved_units: 5
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/quota",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: expect.not.objectContaining({
          "X-Zenari-CSRF": "same-site-origin-check"
        })
      })
    );
  });

  it("loads subscription state without CSRF because the operation is safe", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "sub_1",
          plan_id: "plan_pro",
          status: "active",
          current_period_start: "2026-06-01T00:00:00Z",
          current_period_end: "2026-07-01T00:00:00Z"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const client = new ApiBillingClient("/api/v1");

    const subscription = await client.getSubscription();

    expect(subscription).toMatchObject({
      id: "sub_1",
      plan_id: "plan_pro",
      status: "active"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/billing/subscription",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: expect.not.objectContaining({
          "X-Zenari-CSRF": "same-site-origin-check"
        })
      })
    );
  });

  it("lists invoices without CSRF because the operation is safe", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "in_test_001",
              provider: "stripe",
              status: "paid",
              currency: "USD",
              amount_due_cents: 2900,
              amount_paid_cents: 2900,
              invoice_url: "https://invoice.stripe.test/in_test_001",
              created_at: "2026-06-21T10:00:00Z"
            }
          ]
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const client = new ApiBillingClient("/api/v1");

    const invoices = await client.listInvoices();

    expect(invoices.items[0]).toMatchObject({
      id: "in_test_001",
      status: "paid",
      amount_paid_cents: 2900
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/billing/invoices",
      expect.objectContaining({
        method: "GET",
        credentials: "include",
        headers: expect.not.objectContaining({
          "X-Zenari-CSRF": "same-site-origin-check"
        })
      })
    );
  });

  it("creates checkout sessions through the generated same-site API client", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_test_001",
          tenant_id: "tenant_1",
          user_id: "user_1",
          provider: "stripe",
          redirect_url: "https://checkout.stripe.test/cs_test_001",
          created_at: "2026-06-21T10:00:00Z"
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const client = new ApiBillingClient("/api/v1");

    const session = await client.createCheckoutSession(
      { plan_id: defaultCheckoutPlanId },
      "checkout-user-dev-001-plan_pro"
    );

    expect(session).toMatchObject({
      id: "cs_test_001",
      provider: "stripe",
      redirect_url: "https://checkout.stripe.test/cs_test_001"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/billing/checkout",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "Idempotency-Key": "checkout-user-dev-001-plan_pro",
          "X-Zenari-CSRF": "same-site-origin-check"
        }),
        body: JSON.stringify({ plan_id: defaultCheckoutPlanId })
      })
    );
  });

  it("creates billing portal sessions with CSRF and idempotency", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "bps_test_001",
          tenant_id: "tenant_1",
          user_id: "user_1",
          provider: "stripe",
          redirect_url: "https://billing.stripe.test/session/bps_test_001",
          created_at: "2026-06-21T10:00:00Z"
        }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const client = new ApiBillingClient("/api/v1");

    const session = await client.createPortalSession("portal-user-dev-001");

    expect(session).toMatchObject({
      id: "bps_test_001",
      provider: "stripe"
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/billing/portal",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Idempotency-Key": "portal-user-dev-001",
          "X-Zenari-CSRF": "same-site-origin-check"
        })
      })
    );
  });

  it("cancels subscriptions with CSRF and idempotency", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "sub_test_001",
          provider: "stripe",
          status: "active",
          cancel_at_period_end: true,
          current_period_end: "2026-07-01T00:00:00Z",
          updated_at: "2026-06-21T10:00:00Z"
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      )
    );
    const client = new ApiBillingClient("/api/v1");

    const cancelled = await client.cancelSubscription("cancel-user-dev-001");

    expect(cancelled).toMatchObject({
      id: "sub_test_001",
      cancel_at_period_end: true
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/billing/subscription/cancel",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Idempotency-Key": "cancel-user-dev-001",
          "X-Zenari-CSRF": "same-site-origin-check"
        })
      })
    );
  });
});
