"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

function normalizedAdminAPIBaseURL() {
  const value = process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL?.trim();
  if (!value) {
    return "";
  }
  return value.replace(/\/$/, "");
}

async function adminMutationHeaders(idempotencyKey: string): Promise<HeadersInit> {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    Origin: process.env.PUBLIC_ADMIN_ORIGIN ?? "http://localhost:26081",
    "X-Zenari-CSRF": "same-site-origin-check",
    cookie: (await cookies()).toString()
  };
}

function redirectExportOps(state: string, exportID: string, status?: number) {
  const query = new URLSearchParams({ export_ops: state });
  if (exportID) {
    query.set("export_id", exportID);
  }
  if (status) {
    query.set("status", String(status));
  }
  redirect(`/exports?${query.toString()}`);
}

export async function regenerateExportAction(formData: FormData) {
  const exportID = String(formData.get("export_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !exportID) {
    redirectExportOps("regenerate_unavailable", exportID);
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/exports/${encodeURIComponent(exportID)}/regenerate`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`export-regenerate-${exportID}-${Date.now()}`),
    body: JSON.stringify({
      rationale: String(formData.get("rationale") ?? "").trim(),
      second_reviewer_id: String(formData.get("second_reviewer_id") ?? "").trim(),
      second_reviewer_role: String(formData.get("second_reviewer_role") ?? "").trim(),
      second_review_rationale: String(formData.get("second_review_rationale") ?? "").trim()
    })
  });

  if (!response.ok) {
    redirectExportOps("regenerate_failed", exportID, response.status);
  }

  revalidatePath("/exports");
  redirectExportOps("regenerated", exportID);
}

export async function createExportOverrideAction(formData: FormData) {
  const exportID = String(formData.get("export_id") ?? "").trim();
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL || !exportID) {
    redirectExportOps("override_unavailable", exportID);
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/exports/${encodeURIComponent(exportID)}/override`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`export-override-${exportID}-${Date.now()}`),
    body: JSON.stringify({
      source_type: String(formData.get("source_type") ?? "").trim(),
      source_id: String(formData.get("source_id") ?? "").trim(),
      trace_id: String(formData.get("trace_id") ?? "").trim(),
      decision: String(formData.get("decision") ?? "").trim(),
      denial_reason: String(formData.get("denial_reason") ?? "").trim() || undefined,
      rationale: String(formData.get("rationale") ?? "").trim(),
      metadata: {
        ticket_id: String(formData.get("ticket_id") ?? "").trim()
      }
    })
  });

  if (!response.ok) {
    redirectExportOps("override_failed", exportID, response.status);
  }

  revalidatePath("/exports");
  redirectExportOps("override_recorded", exportID);
}

export async function cleanupExportsAction(formData: FormData) {
  const apiBaseURL = normalizedAdminAPIBaseURL();
  if (!apiBaseURL) {
    redirectExportOps("cleanup_unavailable", "");
  }

  const response = await fetch(`${apiBaseURL}/api/admin/v1/exports/cleanup`, {
    method: "POST",
    cache: "no-store",
    headers: await adminMutationHeaders(`export-cleanup-${Date.now()}`),
    body: JSON.stringify({
      rationale: String(formData.get("rationale") ?? "").trim(),
      limit: Number.parseInt(String(formData.get("limit") ?? "25"), 10),
      dry_run: formData.get("dry_run") === "on",
      second_reviewer_id: String(formData.get("second_reviewer_id") ?? "").trim(),
      second_reviewer_role: String(formData.get("second_reviewer_role") ?? "").trim(),
      second_review_rationale: String(formData.get("second_review_rationale") ?? "").trim()
    })
  });

  if (!response.ok) {
    redirectExportOps("cleanup_failed", "", response.status);
  }

  revalidatePath("/exports");
  redirectExportOps("cleanup_recorded", "");
}
