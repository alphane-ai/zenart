"use client";

import { WorkspaceState } from "./contracts";

export type AnalyticsEventName =
  | "route_viewed"
  | "brief_confirmed"
  | "reference_attached"
  | "candidate_selected"
  | "iteration_submitted"
  | "package_item_added"
  | "export_requested"
  | "billing_viewed"
  | "checkout_started"
  | "billing_scenario_selected"
  | "account_updated"
  | "support_ticket_opened"
  | "legal_policy_viewed"
  | "frontend_error_reported";

export interface AnalyticsEvent {
  id: string;
  name: AnalyticsEventName;
  occurredAt: string;
  route: string;
  sessionId?: string;
  projectId?: string;
  properties: Record<string, string | number | boolean | undefined>;
}

export interface FrontendErrorReport {
  id: string;
  occurredAt: string;
  route: string;
  sessionId?: string;
  projectId?: string;
  message: string;
  source: "window-error" | "unhandled-rejection" | "action-error";
  component?: string;
}

export const analyticsEventTaxonomy: Record<AnalyticsEventName, string> = {
  route_viewed: "User route was viewed.",
  brief_confirmed: "User confirmed the starting brief.",
  reference_attached: "User attached or attempted a reference.",
  candidate_selected: "User selected one of four candidates.",
  iteration_submitted: "User submitted an iteration instruction.",
  package_item_added: "User added a selected item to the package.",
  export_requested: "User requested ZIP or PDF export.",
  billing_viewed: "User viewed billing and quota state.",
  checkout_started: "User started local mock checkout.",
  billing_scenario_selected: "User selected a local billing edge scenario.",
  account_updated: "User saved account settings.",
  support_ticket_opened: "User opened a support ticket.",
  legal_policy_viewed: "User viewed a legal or policy route.",
  frontend_error_reported: "Client captured a sanitized frontend error report."
};

export const analyticsStorageKey = "zenart.dev.analytics.v1";
export const frontendErrorStorageKey = "zenart.dev.frontend-errors.v1";

const maxStoredRecords = 100;

const isBrowser = () => typeof window !== "undefined";

const safeRoute = () => {
  if (!isBrowser()) {
    return "server";
  }

  return `${window.location.pathname}${window.location.search}`;
};

const readStoredArray = <T>(storageKey: string): T[] => {
  if (!isBrowser()) {
    return [];
  }

  const stored = window.localStorage.getItem(storageKey);
  if (!stored) {
    return [];
  }

  try {
    const parsed = JSON.parse(stored) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const writeStoredArray = <T>(storageKey: string, value: T[]) => {
  if (isBrowser()) {
    window.localStorage.setItem(storageKey, JSON.stringify(value.slice(0, maxStoredRecords)));
  }
};

const nextId = (prefix: string, existingLength: number) => `${prefix}-${String(existingLength + 1).padStart(3, "0")}`;

const baseContext = (state?: WorkspaceState) => ({
  route: safeRoute(),
  sessionId: state?.session.id,
  projectId: state?.activeProjectId
});

export const captureAnalyticsEvent = (
  name: AnalyticsEventName,
  state?: WorkspaceState,
  properties: AnalyticsEvent["properties"] = {}
): AnalyticsEvent => {
  const existing = readStoredArray<AnalyticsEvent>(analyticsStorageKey);
  const event: AnalyticsEvent = {
    id: nextId("event", existing.length),
    name,
    occurredAt: new Date().toISOString(),
    ...baseContext(state),
    properties
  };

  writeStoredArray(analyticsStorageKey, [event, ...existing]);
  return event;
};

export const sanitizeErrorMessage = (error: unknown) => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown frontend error";

  return raw
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/(token|secret|password|api[_-]?key)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 240);
};

export const reportFrontendError = (
  error: unknown,
  source: FrontendErrorReport["source"],
  state?: WorkspaceState,
  component?: string
): FrontendErrorReport => {
  const existing = readStoredArray<FrontendErrorReport>(frontendErrorStorageKey);
  const report: FrontendErrorReport = {
    id: nextId("front-error", existing.length),
    occurredAt: new Date().toISOString(),
    ...baseContext(state),
    message: sanitizeErrorMessage(error),
    source,
    component
  };

  writeStoredArray(frontendErrorStorageKey, [report, ...existing]);
  captureAnalyticsEvent("frontend_error_reported", state, {
    source,
    component,
    errorId: report.id
  });
  return report;
};

export const listAnalyticsEvents = () => readStoredArray<AnalyticsEvent>(analyticsStorageKey);

export const listFrontendErrorReports = () => readStoredArray<FrontendErrorReport>(frontendErrorStorageKey);
