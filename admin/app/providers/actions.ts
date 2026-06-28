"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ProviderRegistryCapability, ProviderRoutingPolicy } from "@/lib/types";

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

function fallbackProviderIDs(formData: FormData) {
  return listField(formData, "fallback_provider_ids");
}

function metadataField(formData: FormData) {
  const region = String(formData.get("metadata_region") ?? "").trim();
  if (!region) {
    return {};
  }
  return { region };
}

function strategyMetadataField(formData: FormData) {
  const surface = String(formData.get("strategy_metadata_surface") ?? "").trim();
  if (!surface) {
    return {};
  }
  return { routing_surface: surface };
}

function listField(formData: FormData, name: string) {
  return String(formData.get(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function strategyMembersFromFormData(formData: FormData) {
  const providerIDs = listField(formData, "member_provider_ids");
  return providerIDs.map((providerID, index) => ({
    provider_id: providerID,
    weight: integerField(formData, `member_${index}_weight`),
    canary_percent: integerField(formData, `member_${index}_canary_percent`),
    max_concurrency: integerField(formData, `member_${index}_max_concurrency`),
    fallback_rank: integerField(formData, `member_${index}_fallback_rank`),
    enabled: formData.get(`member_${index}_enabled`) === "on"
  }));
}

function capabilityFromFormData(formData: FormData, providerID: string): ProviderRegistryCapability {
  const supportsBatch = formData.get("supports_batch") === "on";
  return {
    provider_id: providerID,
    model_id: String(formData.get("model_id") ?? "").trim(),
    endpoints: listField(formData, "endpoints"),
    input_types: listField(formData, "input_types"),
    output_types: listField(formData, "output_types"),
    tool_types: listField(formData, "tool_types"),
    max_cost_units: integerField(formData, "max_cost_units"),
    cost_currency: String(formData.get("cost_currency") ?? "").trim(),
    estimated_cost_cents: integerField(formData, "estimated_cost_cents"),
    supports_batch: supportsBatch,
    max_batch_size: supportsBatch ? integerField(formData, "max_batch_size") : 1,
    supports_seed: formData.get("supports_seed") === "on",
    supports_cancel: formData.get("supports_cancel") === "on",
    supported_aspect_ratios: listField(formData, "supported_aspect_ratios"),
    supported_qualities: listField(formData, "supported_qualities")
  };
}

export async function createProviderRegistryAction(formData: FormData) {
  const providerID = String(formData.get("provider_id") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const mode = String(formData.get("mode") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const secretRef = String(formData.get("secret_ref") ?? "").trim();
  const rationale = String(formData.get("rationale") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !providerID) {
    redirect("/providers?registry_create=unavailable");
  }

  const routing: ProviderRoutingPolicy = {
    weight: integerField(formData, "weight"),
    canary_percent: integerField(formData, "canary_percent"),
    max_concurrency: integerField(formData, "max_concurrency"),
    fallback_provider_ids: fallbackProviderIDs(formData),
    kill_switch: formData.get("kill_switch") === "on" || status === "kill_switch"
  };
  const cookieHeader = (await cookies()).toString();

  const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/registry`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `provider-registry-create-${providerID}-${Date.now()}`,
      Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
      "X-Zenari-CSRF": "same-site-origin-check",
      cookie: cookieHeader,
      ...localAdminDevIdentityHeaders()
    },
    body: JSON.stringify({
      provider_id: providerID,
      display_name: displayName,
      mode,
      status,
      secret_ref: secretRef,
      routing,
      health: {
        available: formData.get("health_available") === "on",
        latency_ms: integerField(formData, "latency_ms"),
        error_rate_percent: integerField(formData, "error_rate_percent"),
        last_checked_at: new Date().toISOString(),
        message: String(formData.get("health_message") ?? "").trim()
      },
      capabilities: [capabilityFromFormData(formData, providerID)],
      metadata: metadataField(formData),
      rationale
    })
  });

  if (!response.ok) {
    redirect(`/providers?registry_create=failed&provider_id=${encodeURIComponent(providerID)}&status=${response.status}`);
  }

  revalidatePath("/providers");
  redirect(`/providers?registry_create=saved&provider_id=${encodeURIComponent(providerID)}`);
}

export async function createProviderStrategyGroupAction(formData: FormData) {
  const groupID = String(formData.get("group_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !groupID) {
    redirect("/providers?strategy_create=unavailable");
  }
  const cookieHeader = (await cookies()).toString();

  const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/strategy-groups`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `provider-strategy-group-create-${groupID}-${Date.now()}`,
      Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
      "X-Zenari-CSRF": "same-site-origin-check",
      cookie: cookieHeader,
      ...localAdminDevIdentityHeaders()
    },
    body: JSON.stringify({
      group_id: groupID,
      display_name: String(formData.get("strategy_display_name") ?? "").trim(),
      tool_type: String(formData.get("strategy_tool_type") ?? "").trim(),
      status: String(formData.get("strategy_status") ?? "").trim(),
      selection_policy: String(formData.get("selection_policy") ?? "").trim(),
      fallback_provider_ids: listField(formData, "strategy_fallback_provider_ids"),
      kill_switch: formData.get("strategy_kill_switch") === "on",
      members: strategyMembersFromFormData(formData),
      metadata: strategyMetadataField(formData),
      rationale: String(formData.get("strategy_rationale") ?? "").trim()
    })
  });

  if (!response.ok) {
    redirect(`/providers?strategy_create=failed&provider_id=${encodeURIComponent(groupID)}&status=${response.status}`);
  }

  revalidatePath("/providers");
  redirect(`/providers?strategy_create=saved&provider_id=${encodeURIComponent(groupID)}`);
}

export async function updateProviderStrategyGroupAction(formData: FormData) {
  const groupID = String(formData.get("group_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !groupID) {
    redirect("/providers?strategy_update=unavailable");
  }
  const cookieHeader = (await cookies()).toString();

  const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/strategy-groups/${encodeURIComponent(groupID)}`, {
    method: "PATCH",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `provider-strategy-group-update-${groupID}-${Date.now()}`,
      Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
      "X-Zenari-CSRF": "same-site-origin-check",
      cookie: cookieHeader,
      ...localAdminDevIdentityHeaders()
    },
    body: JSON.stringify({
      display_name: String(formData.get("strategy_display_name") ?? "").trim(),
      tool_type: String(formData.get("strategy_tool_type") ?? "").trim(),
      status: String(formData.get("strategy_status") ?? "").trim(),
      selection_policy: String(formData.get("selection_policy") ?? "").trim(),
      fallback_provider_ids: listField(formData, "strategy_fallback_provider_ids"),
      kill_switch: formData.get("strategy_kill_switch") === "on",
      members: strategyMembersFromFormData(formData),
      metadata: strategyMetadataField(formData),
      rationale: String(formData.get("strategy_rationale") ?? "").trim()
    })
  });

  if (!response.ok) {
    redirect(`/providers?strategy_update=failed&provider_id=${encodeURIComponent(groupID)}&status=${response.status}`);
  }

  revalidatePath("/providers");
  redirect(`/providers?strategy_update=saved&provider_id=${encodeURIComponent(groupID)}`);
}

export async function updateProviderRegistryAction(formData: FormData) {
  const providerID = String(formData.get("provider_id") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const secretRef = String(formData.get("secret_ref") ?? "").trim();
  const rationale = String(formData.get("rationale") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !providerID) {
    redirect("/providers?registry_update=unavailable");
  }

  const routing: ProviderRoutingPolicy = {
    weight: integerField(formData, "weight"),
    canary_percent: integerField(formData, "canary_percent"),
    max_concurrency: integerField(formData, "max_concurrency"),
    fallback_provider_ids: fallbackProviderIDs(formData),
    kill_switch: formData.get("kill_switch") === "on" || status === "kill_switch"
  };
  const cookieHeader = (await cookies()).toString();

  const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/registry/${encodeURIComponent(providerID)}`, {
    method: "PATCH",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `provider-registry-${providerID}-${Date.now()}`,
      Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
      "X-Zenari-CSRF": "same-site-origin-check",
      cookie: cookieHeader,
      ...localAdminDevIdentityHeaders()
    },
    body: JSON.stringify({
      status,
      secret_ref: secretRef,
      routing,
      capabilities: [capabilityFromFormData(formData, providerID)],
      rationale
    })
  });

  if (!response.ok) {
    redirect(`/providers?registry_update=failed&provider_id=${encodeURIComponent(providerID)}&status=${response.status}`);
  }

  revalidatePath("/providers");
  redirect(`/providers?registry_update=saved&provider_id=${encodeURIComponent(providerID)}`);
}

export async function deleteProviderRegistryAction(formData: FormData) {
  const providerID = String(formData.get("provider_id") ?? "").trim();
  const rationale = String(formData.get("delete_rationale") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !providerID) {
    redirect("/providers?registry_delete=unavailable");
  }
  const cookieHeader = (await cookies()).toString();

  const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/registry/${encodeURIComponent(providerID)}`, {
    method: "DELETE",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `provider-registry-delete-${providerID}-${Date.now()}`,
      Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
      "X-Zenari-CSRF": "same-site-origin-check",
      cookie: cookieHeader,
      ...localAdminDevIdentityHeaders()
    },
    body: JSON.stringify({
      rationale
    })
  });

  if (!response.ok) {
    redirect(`/providers?registry_delete=failed&provider_id=${encodeURIComponent(providerID)}&status=${response.status}`);
  }

  revalidatePath("/providers");
  redirect(`/providers?registry_delete=saved&provider_id=${encodeURIComponent(providerID)}`);
}

export async function probeProviderRegistryHealthAction(formData: FormData) {
  const providerID = String(formData.get("provider_id") ?? "").trim();
  const rationale = String(formData.get("health_rationale") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !providerID) {
    redirect("/providers?provider_health_probe=unavailable");
  }
  const cookieHeader = (await cookies()).toString();

  const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/registry/${encodeURIComponent(providerID)}/health-probe`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `provider-health-probe-${providerID}-${Date.now()}`,
      Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
      "X-Zenari-CSRF": "same-site-origin-check",
      cookie: cookieHeader,
      ...localAdminDevIdentityHeaders()
    },
    body: JSON.stringify({
      rationale
    })
  });

  if (!response.ok) {
    redirect(`/providers?provider_health_probe=failed&provider_id=${encodeURIComponent(providerID)}&status=${response.status}`);
  }

  revalidatePath("/providers");
  redirect(`/providers?provider_health_probe=saved&provider_id=${encodeURIComponent(providerID)}`);
}

export async function runProviderSandboxTestCallAction(formData: FormData) {
  const providerID = String(formData.get("provider_id") ?? "").trim();
  const modelID = String(formData.get("model_id") ?? "").trim();
  const toolType = String(formData.get("tool_type") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const rationale = String(formData.get("test_rationale") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !providerID) {
    redirect("/providers?provider_test=unavailable");
  }
  const cookieHeader = (await cookies()).toString();

  const response = await fetch(`${apiBaseURL}/api/admin/v1/providers/registry/${encodeURIComponent(providerID)}/test-call`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `provider-test-call-${providerID}-${Date.now()}`,
      Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
      "X-Zenari-CSRF": "same-site-origin-check",
      cookie: cookieHeader,
      ...localAdminDevIdentityHeaders()
    },
    body: JSON.stringify({
      model_id: modelID,
      tool_type: toolType,
      prompt,
      rationale
    })
  });

  if (!response.ok) {
    redirect(`/providers?provider_test=failed&provider_id=${encodeURIComponent(providerID)}&status=${response.status}`);
  }

  revalidatePath("/providers");
  redirect(`/providers?provider_test=saved&provider_id=${encodeURIComponent(providerID)}`);
}
