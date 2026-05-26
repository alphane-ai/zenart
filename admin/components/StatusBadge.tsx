import type { RiskLevel, StatusTone } from "@/lib/types";

const toneMap: Record<string, StatusTone> = {
  healthy: "ok",
  active: "ok",
  completed: "ok",
  passed: "ok",
  approved: "ok",
  resolved: "ok",
  low: "ok",
  warning: "warn",
  degraded: "warn",
  retrying: "warn",
  review: "warn",
  second_review_required: "warn",
  canary: "warn",
  medium: "warn",
  missing: "warn",
  failed: "danger",
  blocked: "danger",
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
