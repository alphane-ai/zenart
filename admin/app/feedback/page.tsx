import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatGrid } from "@/components/StatGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { getFeedbackItems, getRegressionFixtures, getRegressionFixtureRuntimeSummaries } from "@/lib/admin-api";
import type { FeedbackItem, RegressionFixture, RegressionFixtureRuntimeSummary } from "@/lib/types";

export default async function FeedbackPage() {
  const [feedback, regressionFixtures, regressionRuntime] = await Promise.all([
    getFeedbackItems(),
    getRegressionFixtures(),
    getRegressionFixtureRuntimeSummaries()
  ]);
  const releaseBlockingCount = regressionRuntime.filter((item) => item.releaseGateDisposition === "release_blocking").length;
  const gateReadyCount = regressionRuntime.filter((item) => item.releaseGateDisposition === "gate_ready").length;
  const candidateOnlyCount = regressionRuntime.filter((item) => item.releaseGateDisposition === "candidate_only").length;
  const missingEvidenceCount = regressionRuntime.filter((item) => item.blockerCodes.length > 0).length;

  return (
    <>
      <PageHeader
        title="Feedback Queue"
        description="Feedback taxonomy queue with attribution and learning-governance signals."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Signals</h3>
            <p>Explicit rejection, delayed feedback, and support tickets stay distinct from non-selection.</p>
          </div>
        </div>
        <DataTable<FeedbackItem>
          rows={feedback}
          columns={[
            { key: "id", header: "ID", render: (row) => <span className="mono">{row.id}</span> },
            { key: "kind", header: "Kind", render: (row) => row.kind },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "delayed", header: "Delayed", render: (row) => (row.delayed ? "Yes" : "No") },
            { key: "filter", header: "Filter Decision", render: (row) => <StatusBadge value={row.filterDecision === "eligible" ? "approved" : row.filterDecision === "hold" ? "warning" : "blocked"} label={row.filterDecision} /> },
            { key: "weight", header: "Weight", render: (row) => row.weight.toFixed(2) },
            { key: "attribution", header: "Attribution", render: (row) => row.attribution },
            { key: "available", header: "Learning At", render: (row) => row.availableForLearningAt },
            { key: "fixture", header: "Regression Fixture", render: (row) => row.regressionFixtureRef },
            { key: "signal", header: "Signal", render: (row) => row.signal },
            { key: "reason", header: "Weighting Reason", render: (row) => row.weightingReason }
          ]}
        />
      </section>

      <StatGrid
        stats={[
          {
            label: "Release Blocking",
            value: releaseBlockingCount,
            detail: "Eval-blocking or evidence-incomplete regression fixtures."
          },
          {
            label: "Gate Ready",
            value: gateReadyCount,
            detail: "Converted fixtures with linked source, audit, and canary metric evidence."
          },
          {
            label: "Candidate Only",
            value: candidateOnlyCount,
            detail: "Samples that cannot influence release decisions yet."
          },
          {
            label: "Evidence Gaps",
            value: missingEvidenceCount,
            detail: "Fixtures with missing source, metric, audit, or path evidence."
          }
        ]}
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Regression Fixture Runtime Gates</h3>
            <p>Runtime summaries keep admin bad samples out of release decisions until source links, fixture declarations, canary metrics, and immutable audit refs are complete.</p>
          </div>
        </div>
        <DataTable<RegressionFixtureRuntimeSummary>
          rows={regressionRuntime}
          columns={[
            { key: "fixture", header: "Fixture", render: (row) => <span className="mono">{row.fixtureId}</span> },
            { key: "source", header: "Source Link", render: (row) => <StatusBadge value={row.sourceLinkStatus} label={`${row.sourceKind} · ${row.sourceFeedbackId}`} /> },
            { key: "failure", header: "Failure Mode", render: (row) => row.failureMode },
            { key: "status", header: "Fixture Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
            { key: "gate", header: "Required Gate", render: (row) => row.requiredGate },
            { key: "disposition", header: "Release Gate Disposition", render: (row) => <StatusBadge value={row.releaseGateDisposition} label={row.releaseGateDisposition} /> },
            { key: "path", header: "Fixture Path", render: (row) => <StatusBadge value={row.fixturePathStatus} label={row.fixturePathStatus} /> },
            { key: "metric", header: "Canary Metric", render: (row) => <StatusBadge value={row.canaryMetricStatus} label={row.canaryMetricStatus} /> },
            { key: "audit", header: "Audit", render: (row) => <StatusBadge value={row.auditStatus} label={row.auditStatus} /> },
            { key: "risk", header: "High Risk Gate", render: (row) => <StatusBadge value={row.highRiskGateStatus} label={row.highRiskGateStatus} /> },
            {
              key: "blockers",
              header: "Blockers",
              render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none")
            },
            { key: "operator", header: "Operator Action", render: (row) => row.operatorAction }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Bad Samples to Regression Fixtures</h3>
            <p>Admin bad samples, QA warnings, support tickets, and export failures become gate-linked regression fixtures before learning or release decisions.</p>
          </div>
        </div>
        <DataTable<RegressionFixture>
          rows={regressionFixtures}
          columns={[
            { key: "id", header: "Fixture", render: (row) => <span className="mono">{row.id}</span> },
            { key: "source", header: "Source", render: (row) => `${row.sourceKind} · ${row.sourceFeedbackId}` },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} label={row.status} /> },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
            { key: "failure", header: "Failure Mode", render: (row) => row.failureMode },
            { key: "gate", header: "Required Gate", render: (row) => row.requiredGate },
            { key: "eval", header: "Eval Suite", render: (row) => row.evalSuiteId },
            { key: "metric", header: "Canary Metric", render: (row) => <span className="mono">{row.linkedCanaryMetric}</span> },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.linkedAuditRef}</span> },
            { key: "path", header: "Fixture Path", render: (row) => row.fixturePath },
            { key: "assertion", header: "Expected Assertion", render: (row) => row.expectedAssertion },
            { key: "rationale", header: "Reviewer Rationale", render: (row) => row.reviewerRationale }
          ]}
        />
      </section>
    </>
  );
}
