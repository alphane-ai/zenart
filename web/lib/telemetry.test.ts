import { beforeEach, describe, expect, it } from "vitest";
import {
  analyticsEventTaxonomy,
  analyticsStorageKey,
  captureAnalyticsEvent,
  frontendErrorStorageKey,
  listAnalyticsEvents,
  listFrontendErrorReports,
  reportFrontendError,
  sanitizeErrorMessage
} from "./telemetry";
import { createInitialWorkspace } from "./dev-state";

describe("client telemetry contracts", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/workspace");
  });

  it("defines the user-route analytics taxonomy required by Rev2", () => {
    expect(Object.keys(analyticsEventTaxonomy)).toEqual([
      "route_viewed",
      "brief_confirmed",
      "reference_attached",
      "candidate_selected",
      "iteration_submitted",
      "package_item_added",
      "export_requested",
      "billing_viewed",
      "checkout_started",
      "billing_scenario_selected",
      "account_updated",
      "support_ticket_opened",
      "legal_policy_viewed",
      "frontend_error_reported"
    ]);
  });

  it("captures client-side UI funnel events with session and project context", () => {
    const state = createInitialWorkspace();
    const event = captureAnalyticsEvent("candidate_selected", state, {
      candidateId: "cand-studio"
    });

    expect(event).toMatchObject({
      id: "event-001",
      name: "candidate_selected",
      route: "/workspace",
      sessionId: "user-dev-001",
      projectId: "project-001",
      properties: {
        candidateId: "cand-studio"
      }
    });
    expect(listAnalyticsEvents()).toHaveLength(1);
    expect(window.localStorage.getItem(analyticsStorageKey)).toContain("candidate_selected");
  });

  it("reports sanitized frontend errors and emits an analytics marker", () => {
    const state = createInitialWorkspace();
    const report = reportFrontendError(
      new Error("failed token=abc123 for dev@zenart.local"),
      "action-error",
      state,
      "export"
    );

    expect(report).toMatchObject({
      id: "front-error-001",
      route: "/workspace",
      sessionId: "user-dev-001",
      projectId: "project-001",
      message: "failed token=[redacted] for [redacted-email]",
      source: "action-error",
      component: "export"
    });
    expect(listFrontendErrorReports()).toHaveLength(1);
    expect(listAnalyticsEvents()[0]).toMatchObject({
      name: "frontend_error_reported",
      properties: {
        source: "action-error",
        component: "export",
        errorId: "front-error-001"
      }
    });
    expect(window.localStorage.getItem(frontendErrorStorageKey)).toContain("front-error-001");
  });

  it("bounds sanitized frontend error text", () => {
    expect(sanitizeErrorMessage(`x${"a".repeat(260)}`)).toHaveLength(240);
  });
});
