"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function normalizedAdminAPIBaseURL() {
  const value = (process.env.ADMIN_API_BASE_URL || process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL)?.trim();
  if (!value) {
    return "";
  }
  return value.replace(/\/$/, "");
}

function localAdminDevIdentityHeaders(): Record<string, string> {
  if (
    process.env.ADMIN_DEV_IDENTITY_HEADERS_ENABLED !== "true" ||
    process.env.NEXT_PUBLIC_ADMIN_AUTH_MODE !== "local"
  ) {
    return {};
  }
  return {
    "X-Zenari-User-ID": process.env.SMOKE_ADMIN_USER_ID?.trim() || "local_admin_zenari.ai",
    "X-Zenari-Tenant-ID": process.env.SMOKE_ADMIN_TENANT_ID?.trim() || "tenant_local",
    "X-Zenari-Roles": process.env.LOCAL_ADMIN_ROLES?.trim() || "admin_superadmin"
  };
}

function integerField(formData: FormData, name: string) {
  const value = String(formData.get(name) ?? "").trim();
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function redirectTeamOps(state: string, teamID: string, status?: number) {
  const query = new URLSearchParams({ team_ops: state });
  if (teamID) {
    query.set("team_id", teamID);
  }
  if (status) {
    query.set("status", String(status));
  }
  redirect(`/quota?${query.toString()}`);
}

function redirectBillingOps(state: string, operation: string, status?: number) {
  const query = new URLSearchParams({ billing_ops: state });
  if (operation) {
    query.set("billing_operation", operation);
  }
  if (status) {
    query.set("status", String(status));
  }
  redirect(`/quota?${query.toString()}`);
}

async function adminMutationHeaders(idempotencyKey: string): Promise<HeadersInit> {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
    "X-Zenari-CSRF": "same-site-origin-check",
    cookie: (await cookies()).toString(),
    ...localAdminDevIdentityHeaders()
  };
}

function ticketMetadata(formData: FormData) {
  return {
    ticket_id: String(formData.get("ticket_id") ?? "").trim()
  };
}

export async function createAdminTeamAction(formData: FormData) {
  const teamID = String(formData.get("team_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !teamID) {
    redirectTeamOps("unavailable", teamID);
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/teams`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`team-create-${teamID}-${Date.now()}`),
    body: JSON.stringify({
      id: teamID,
      name: String(formData.get("team_name") ?? "").trim(),
      plan_id: String(formData.get("plan_id") ?? "").trim(),
      seat_limit: integerField(formData, "seat_limit"),
      owner_user_id: String(formData.get("owner_user_id") ?? "").trim(),
      owner_email: String(formData.get("owner_email") ?? "").trim(),
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: ticketMetadata(formData)
    })
  });

  if (!response.ok) {
    redirectTeamOps("create_failed", teamID, response.status);
  }

  revalidatePath("/quota");
  redirectTeamOps("created", teamID);
}

export async function createAdminTeamInviteAction(formData: FormData) {
  const teamID = String(formData.get("team_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !teamID) {
    redirectTeamOps("unavailable", teamID);
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/teams/${encodeURIComponent(teamID)}/invites`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`team-invite-${teamID}-${Date.now()}`),
    body: JSON.stringify({
      email: String(formData.get("email") ?? "").trim(),
      role: String(formData.get("role") ?? "").trim(),
      expires_at: String(formData.get("expires_at") ?? "").trim(),
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: ticketMetadata(formData)
    })
  });

  if (!response.ok) {
    redirectTeamOps("invite_failed", teamID, response.status);
  }

  revalidatePath("/quota");
  redirectTeamOps("invited", teamID);
}

export async function removeAdminTeamMemberAction(formData: FormData) {
  const teamID = String(formData.get("team_id") ?? "").trim();
  const memberID = String(formData.get("member_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !teamID || !memberID) {
    redirectTeamOps("unavailable", teamID);
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/teams/${encodeURIComponent(teamID)}/members/${encodeURIComponent(memberID)}/remove`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`team-member-remove-${teamID}-${memberID}-${Date.now()}`),
    body: JSON.stringify({
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: ticketMetadata(formData)
    })
  });

  if (!response.ok) {
    redirectTeamOps("remove_failed", teamID, response.status);
  }

  revalidatePath("/quota");
  redirectTeamOps("removed", teamID);
}

export async function upsertTeamBillingLinkAction(formData: FormData) {
  const teamID = String(formData.get("team_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !teamID) {
    redirect("/quota?team_billing_link=unavailable");
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/team-seat-ops/${encodeURIComponent(teamID)}/billing-link`, {
    method: "PUT",
    cache: "no-store",
    headers: await adminMutationHeaders(`team-billing-link-${teamID}-${Date.now()}`),
    body: JSON.stringify({
      provider: String(formData.get("provider") ?? "").trim(),
      provider_subscription_id: String(formData.get("provider_subscription_id") ?? "").trim(),
      provider_subscription_item_id: String(formData.get("provider_subscription_item_id") ?? "").trim(),
      price_id: String(formData.get("price_id") ?? "").trim(),
      proration_behavior: String(formData.get("proration_behavior") ?? "").trim(),
      status: String(formData.get("status") ?? "").trim(),
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: ticketMetadata(formData)
    })
  });

  if (!response.ok) {
    redirect(`/quota?team_billing_link=failed&team_id=${encodeURIComponent(teamID)}&status=${response.status}`);
  }

  revalidatePath("/quota");
  redirect(`/quota?team_billing_link=saved&team_id=${encodeURIComponent(teamID)}`);
}

export async function createAdminBillingManualCreditAction(formData: FormData) {
  const operation = "manual_credit";
  const targetUserID = String(formData.get("target_user_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !targetUserID) {
    redirectBillingOps("unavailable", operation);
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/billing/manual-credit`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`admin-billing-${operation}-${targetUserID}-${Date.now()}`),
    body: JSON.stringify({
      target_user_id: targetUserID,
      bucket_id: String(formData.get("bucket_id") ?? "").trim(),
      units: integerField(formData, "units"),
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: ticketMetadata(formData)
    })
  });

  if (!response.ok) {
    redirectBillingOps("failed", operation, response.status);
  }

  revalidatePath("/quota");
  redirectBillingOps("recorded", operation);
}

export async function createAdminBillingRefundNoteAction(formData: FormData) {
  const operation = "refund_note";
  const targetUserID = String(formData.get("target_user_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !targetUserID) {
    redirectBillingOps("unavailable", operation);
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/billing/refund-note`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`admin-billing-${operation}-${targetUserID}-${Date.now()}`),
    body: JSON.stringify({
      target_user_id: targetUserID,
      subscription_id: String(formData.get("subscription_id") ?? "").trim(),
      provider: String(formData.get("provider") ?? "").trim(),
      provider_ref: String(formData.get("provider_ref") ?? "").trim(),
      note: String(formData.get("note") ?? "").trim(),
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: ticketMetadata(formData)
    })
  });

  if (!response.ok) {
    redirectBillingOps("failed", operation, response.status);
  }

  revalidatePath("/quota");
  redirectBillingOps("recorded", operation);
}

export async function createAdminBillingSubscriptionSyncAction(formData: FormData) {
  const operation = "sync_subscription";
  const targetUserID = String(formData.get("target_user_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !targetUserID) {
    redirectBillingOps("unavailable", operation);
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/billing/subscription-sync`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`admin-billing-${operation}-${targetUserID}-${Date.now()}`),
    body: JSON.stringify({
      target_user_id: targetUserID,
      subscription_id: String(formData.get("subscription_id") ?? "").trim(),
      provider: String(formData.get("provider") ?? "").trim(),
      provider_ref: String(formData.get("provider_ref") ?? "").trim(),
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: ticketMetadata(formData)
    })
  });

  if (!response.ok) {
    redirectBillingOps("failed", operation, response.status);
  }

  revalidatePath("/quota");
  redirectBillingOps("recorded", operation);
}

export async function createAdminBillingAccountLockAction(formData: FormData) {
  const operation = "account_lock";
  const targetUserID = String(formData.get("target_user_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !targetUserID) {
    redirectBillingOps("unavailable", operation);
  }

  const lockedValue = String(formData.get("locked") ?? "true").trim();
  const response = await fetch(`${apiBaseURL}/api/admin/v1/billing/account-lock`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`admin-billing-${operation}-${targetUserID}-${Date.now()}`),
    body: JSON.stringify({
      target_user_id: targetUserID,
      locked: lockedValue !== "false",
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: ticketMetadata(formData)
    })
  });

  if (!response.ok) {
    redirectBillingOps("failed", operation, response.status);
  }

  revalidatePath("/quota");
  redirectBillingOps("recorded", operation);
}
