"use client";

import { ZenariApiClient } from "./generated/zenart-api";

export type CheckoutSessionCreate = {
  plan_id: string;
};

export type CheckoutSession = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  redirect_url: string;
  created_at: string;
};

export type BillingPortalSession = {
  id: string;
  tenant_id: string;
  user_id: string;
  provider: string;
  redirect_url: string;
  created_at: string;
};

export type SubscriptionCancellation = {
  id: string;
  provider: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end?: string | null;
  updated_at: string;
};

export type BillingInvoice = {
  id: string;
  provider: string;
  status: string;
  currency: string;
  amount_due_cents: number;
  amount_paid_cents: number;
  invoice_url?: string;
  receipt_url?: string;
  created_at: string;
};

export type BillingInvoicePage = {
  items: BillingInvoice[];
};

export type QuotaBucket = {
  id: string;
  limit_units: number;
  used_units: number;
  reserved_units: number;
  resets_at: string;
};

export type QuotaTransaction = {
  id: string;
  kind: string;
  units: number;
  status: string;
  created_at: string;
};

export type QuotaState = {
  buckets: QuotaBucket[];
  transactions: QuotaTransaction[];
};

export type UserSubscription = {
  id: string;
  plan_id: string;
  status: string;
  current_period_start: string;
  current_period_end?: string | null;
};

export type TeamSeatUsageResponse = {
  team_id: string;
  tenant_id: string;
  plan_id: string;
  seat_limit: number;
  active_seats: number;
  invited_seats: number;
  billable_seats: number;
  available_seats: number;
};

export type TeamSeatEntitlementResponse = {
  allowed: boolean;
  reason: "ok" | "seat_limit_exceeded";
  usage: TeamSeatUsageResponse;
};

export type TeamMemberResponse = {
  id: string;
  team_id: string;
  tenant_id: string;
  user_id: string;
  email: string;
  role: "owner" | "admin" | "member";
  status: "active" | "invited" | "removed";
  created_at: string;
  updated_at: string;
};

export interface BillingClient {
  getQuotaState(): Promise<QuotaState>;
  getSubscription(): Promise<UserSubscription>;
  listInvoices(): Promise<BillingInvoicePage>;
  createCheckoutSession(input: CheckoutSessionCreate, idempotencyKey: string): Promise<CheckoutSession>;
  createPortalSession(idempotencyKey: string): Promise<BillingPortalSession>;
  cancelSubscription(idempotencyKey: string): Promise<SubscriptionCancellation>;
  getTeamSeatUsage(teamId: string): Promise<TeamSeatUsageResponse>;
  checkTeamSeatEntitlement(teamId: string, additionalSeats?: number): Promise<TeamSeatEntitlementResponse>;
  acceptTeamInvite(teamId: string, inviteId: string, idempotencyKey: string): Promise<TeamMemberResponse>;
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.replace(/\/$/, "");

export class ApiBillingClient implements BillingClient {
  private readonly apiClient: ZenariApiClient;

  constructor(baseUrl = "/api/v1") {
    this.apiClient = new ZenariApiClient(normalizeBaseUrl(baseUrl));
  }

  getQuotaState() {
    return this.apiClient.request<QuotaState>("getQuota");
  }

  getSubscription() {
    return this.apiClient.request<UserSubscription>("getSubscription");
  }

  listInvoices() {
    return this.apiClient.request<BillingInvoicePage>("listBillingInvoices");
  }

  createCheckoutSession(input: CheckoutSessionCreate, idempotencyKey: string) {
    return this.apiClient.request<CheckoutSession>("createCheckoutSession", {
      idempotencyKey,
      body: input
    });
  }

  createPortalSession(idempotencyKey: string) {
    return this.apiClient.request<BillingPortalSession>("createBillingPortalSession", {
      idempotencyKey
    });
  }

  cancelSubscription(idempotencyKey: string) {
    return this.apiClient.request<SubscriptionCancellation>("cancelSubscription", {
      idempotencyKey
    });
  }

  getTeamSeatUsage(teamId: string) {
    return this.apiClient.request<TeamSeatUsageResponse>("getTeamSeatUsage", {
      pathParams: {
        team_id: teamId
      }
    });
  }

  checkTeamSeatEntitlement(teamId: string, additionalSeats = 1) {
    return this.apiClient.request<TeamSeatEntitlementResponse>("checkTeamSeatEntitlement", {
      pathParams: {
        team_id: teamId
      },
      query: {
        additional_seats: String(additionalSeats)
      }
    });
  }

  acceptTeamInvite(teamId: string, inviteId: string, idempotencyKey: string) {
    return this.apiClient.request<TeamMemberResponse>("acceptTeamInvite", {
      pathParams: {
        team_id: teamId,
        invite_id: inviteId
      },
      idempotencyKey
    });
  }
}

export const defaultCheckoutPlanId = "plan_pro";

export const createBillingClient = (baseUrl = "/api/v1"): BillingClient => new ApiBillingClient(baseUrl);
