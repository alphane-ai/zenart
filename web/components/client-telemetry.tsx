"use client";

import { useEffect } from "react";
import { captureAnalyticsEvent, reportFrontendError } from "@/lib/telemetry";

export function ClientTelemetry() {
  useEffect(() => {
    captureAnalyticsEvent("route_viewed");

    const onError = (event: ErrorEvent) => {
      reportFrontendError(event.error ?? event.message, "window-error", undefined, "window");
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      reportFrontendError(event.reason, "unhandled-rejection", undefined, "window");
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
