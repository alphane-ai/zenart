import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import type { AdminRbacOverrideAttemptDecision } from "@/lib/types";

export function RbacOverrideAttemptDecisionTable({
  rows
}: {
  rows: AdminRbacOverrideAttemptDecision[];
}) {
  return (
    <DataTable<AdminRbacOverrideAttemptDecision>
      rows={rows}
      columns={[
        { key: "attempt", header: "Attempt", render: (row) => <span className="mono">{row.attemptId}</span> },
        { key: "evidence", header: "Evidence", render: (row) => <span className="mono">{row.evidenceId}</span> },
        { key: "surface", header: "Surface", render: (row) => row.surface },
        { key: "request", header: "Request ID", render: (row) => <span className="mono">{row.requestId}</span> },
        {
          key: "idempotency",
          header: "Idempotency",
          render: (row) => (
            <StatusBadge
              value={row.idempotencyStatus === "stable" ? "approved" : "blocked"}
              label={row.idempotencyStatus}
            />
          )
        },
        {
          key: "state",
          header: "State Digest",
          render: (row) => (
            <StatusBadge
              value={
                row.stateDigestStatus === "mutation_recorded" || row.stateDigestStatus === "mutation_preserved"
                  ? "approved"
                  : "blocked"
              }
              label={row.stateDigestStatus}
            />
          )
        },
        { key: "outcome", header: "Attempt Outcome", render: (row) => row.requestOutcome },
        { key: "submit", header: "Submit Allowed", render: (row) => (row.submitAllowed ? "Yes" : "No") },
        { key: "http", header: "Expected HTTP", render: (row) => row.expectedHttpStatus },
        { key: "runtime", header: "Runtime Outcome", render: (row) => row.runtimeRequestOutcome },
        { key: "gate", header: "Release Gate", render: (row) => row.releaseGateStatus },
        { key: "blockers", header: "Blockers", render: (row) => (row.blockerCodes.length > 0 ? row.blockerCodes.join(", ") : "none") },
        { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
        { key: "evidenceRefs", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
        { key: "rationale", header: "Rationale", render: (row) => row.rationale }
      ]}
    />
  );
}
