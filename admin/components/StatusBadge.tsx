import type { RiskLevel, StatusTone } from "@/lib/types";

const toneMap: Record<string, StatusTone> = {
  healthy: "ok",
  active: "ok",
  completed: "ok",
  passed: "ok",
  approved: "ok",
  allowed: "ok",
  submit_ready: "ok",
  pass: "ok",
  attached: "ok",
  complete: "ok",
  verified: "ok",
  resolved: "ok",
  available: "ok",
  stable: "ok",
  ready: "ok",
  applied_with_expiry: "ok",
  low: "ok",
  warning: "warn",
  warning_review: "warn",
  review_required: "warn",
  held_for_second_review: "warn",
  mixed_preserved: "warn",
  degraded: "warn",
  retrying: "warn",
  review: "warn",
  second_review_required: "warn",
  eval_passed: "warn",
  internal_canary: "warn",
  allowlist_canary: "warn",
  percent_canary: "warn",
  paused: "danger",
  rolled_back: "danger",
  deprecated: "danger",
  draft: "info",
  medium: "warn",
  missing: "warn",
  required: "warn",
  configured: "warn",
  imported: "warn",
  not_retry: "info",
  failed: "danger",
  blocked: "danger",
  blocked_by_policy_or_role: "danger",
  missing_audit: "danger",
  missing_runtime: "danger",
  missing_release_evidence: "danger",
  blocking_denied: "danger",
  exhausted: "danger",
  denied: "danger",
  suspended: "danger",
  critical: "danger",
  high: "danger",
  open: "info",
  pending: "info",
  info: "info"
};

export function StatusBadge({
  value,
  label
}: {
  value: string | RiskLevel;
  label?: string;
}) {
  const tone = toneMap[value] ?? "info";
  return <span className={`badge ${tone}`}>{label ?? value}</span>;
}
