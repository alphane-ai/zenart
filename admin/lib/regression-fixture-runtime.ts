import type {
  AuditEvent,
  ExportJob,
  FailedTaskControl,
  FeedbackItem,
  RegressionFixture,
  RegressionFixtureRuntimeSummary,
  SkillCanaryMetric,
  SupportTicket
} from "@/lib/types";

type RegressionFixtureRuntimeInput = {
  fixtures: RegressionFixture[];
  feedbackItems: FeedbackItem[];
  supportTickets: SupportTicket[];
  exportJobs: ExportJob[];
  failedTaskControls: FailedTaskControl[];
  skillCanaryMetrics: SkillCanaryMetric[];
  auditEvents: AuditEvent[];
};

const fixturePathPattern = /^fixtures\/stage0\/rev2\/regressions\/.+\.json$/;

function highRiskGateStatus(fixture: RegressionFixture): RegressionFixtureRuntimeSummary["highRiskGateStatus"] {
  if (fixture.severity !== "high" && fixture.severity !== "critical") {
    return "not_high_risk";
  }

  return fixture.requiredGate === "production_launch" ? "late_gate" : "blocks_pre_production";
}

function releaseGateDisposition(
  fixture: RegressionFixture,
  blockerCodes: string[]
): RegressionFixtureRuntimeSummary["releaseGateDisposition"] {
  if (fixture.status === "resolved") {
    return blockerCodes.length === 0 ? "resolved" : "release_blocking";
  }

  if (fixture.status === "candidate") {
    return "candidate_only";
  }

  if (blockerCodes.length > 0 || fixture.status === "eval_blocking") {
    return "release_blocking";
  }

  return "gate_ready";
}

export function buildRegressionFixtureRuntimeSummaries({
  fixtures,
  feedbackItems,
  supportTickets,
  exportJobs,
  failedTaskControls,
  skillCanaryMetrics,
  auditEvents
}: RegressionFixtureRuntimeInput): RegressionFixtureRuntimeSummary[] {
  const sourceIds = new Set([
    ...feedbackItems.map((item) => item.id),
    ...supportTickets.map((ticket) => ticket.id),
    ...exportJobs.map((job) => job.id),
    ...failedTaskControls.map((task) => task.id)
  ]);
  const canaryMetricIds = new Set(skillCanaryMetrics.map((metric) => metric.id));
  const auditIds = new Set(auditEvents.map((event) => event.id));

  return fixtures.map((fixture) => {
    const blockerCodes: string[] = [];
    const sourceLinkStatus = sourceIds.has(fixture.sourceFeedbackId) ? "linked" : "missing_source";
    const fixturePathStatus = fixturePathPattern.test(fixture.fixturePath) ? "declared" : "invalid_path";
    const canaryMetricStatus = canaryMetricIds.has(fixture.linkedCanaryMetric) ? "linked" : "missing_metric";
    const auditStatus = auditIds.has(fixture.linkedAuditRef) ? "attached" : "missing_audit";
    const computedHighRiskGateStatus = highRiskGateStatus(fixture);

    if (sourceLinkStatus === "missing_source") {
      blockerCodes.push("missing_source_link");
    }

    if (fixturePathStatus === "invalid_path") {
      blockerCodes.push("invalid_fixture_path");
    }

    if (canaryMetricStatus === "missing_metric") {
      blockerCodes.push("missing_canary_metric");
    }

    if (auditStatus === "missing_audit") {
      blockerCodes.push("missing_audit_ref");
    }

    if (computedHighRiskGateStatus === "late_gate") {
      blockerCodes.push("high_risk_fixture_blocks_too_late");
    }

    if ((fixture.severity === "high" || fixture.severity === "critical") && fixture.status === "candidate") {
      blockerCodes.push("high_risk_candidate_not_converted");
    }

    const computedReleaseGateDisposition = releaseGateDisposition(fixture, blockerCodes);
    const operatorAction =
      computedReleaseGateDisposition === "release_blocking"
        ? `Keep ${fixture.requiredGate} blocked until ${fixture.id} has source, metric, audit, and regression fixture evidence.`
        : computedReleaseGateDisposition === "candidate_only"
          ? `Promote ${fixture.id} to converted or eval_blocking before it can influence release decisions.`
          : computedReleaseGateDisposition === "resolved"
            ? `Keep ${fixture.id} in the resolved fixture set for replay and audit history.`
            : `Use ${fixture.id} as a required regression fixture for ${fixture.requiredGate}.`;

    return {
      fixtureId: fixture.id,
      sourceFeedbackId: fixture.sourceFeedbackId,
      sourceKind: fixture.sourceKind,
      failureMode: fixture.failureMode,
      severity: fixture.severity,
      status: fixture.status,
      requiredGate: fixture.requiredGate,
      sourceLinkStatus,
      fixturePathStatus,
      canaryMetricStatus,
      auditStatus,
      highRiskGateStatus: computedHighRiskGateStatus,
      releaseGateDisposition: computedReleaseGateDisposition,
      blockerCodes,
      operatorAction
    };
  });
}
