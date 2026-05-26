"use client";

import { useEffect } from "react";
import { LegalPolicyKey } from "@/lib/legal-policies";
import { captureAnalyticsEvent } from "@/lib/telemetry";

export function LegalPolicyTelemetry({ policyKey }: { policyKey: LegalPolicyKey }) {
  useEffect(() => {
    captureAnalyticsEvent("legal_policy_viewed", undefined, {
      policyKey
    });
  }, [policyKey]);

  return null;
}
