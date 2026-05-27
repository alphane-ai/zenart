import { DataTable } from "@/components/DataTable";
import { StatusBadge } from "@/components/StatusBadge";
import type { AdminRbacRuntimeDecision } from "@/lib/types";

export function RbacRuntimeDecisionTable({
  rows
}: {
  rows: AdminRbacRuntimeDecision[];
}) {
  return (
    <DataTable<AdminRbacRuntimeDecision>
      rows={rows}
      columns={[
        { key: "evidence", header: "Runtime Evidence", render: (row) => <span className="mono">{row.evidenceId}</span> },
        { key: "enforcement", header: "Enforcement Point", render: (row) => row.enforcementPoint },
        {
          key: "expiry-policy",
          header: "Expiry Policy Status",
          render: (row) => <StatusBadge value={row.expiryPolicyStatus} label={row.expiryPolicyStatus} />
        },
        {
          key: "decision",
          header: "Effective Decision",
          render: (row) => (
            <StatusBadge
              value={
                row.effectiveDecision === "allow_mutation"
                  ? "allowed"
                  : row.effectiveDecision === "queue_for_review"
                    ? "warning"
                    : "denied"
              }
              label={row.effectiveDecision}
            />
          )
        },
        { key: "outcome", header: "Request Outcome", render: (row) => row.requestOutcome },
        { key: "mutation", header: "Mutation Allowed", render: (row) => (row.mutationAllowed ? "Yes" : "No") },
        { key: "queue", header: "Queue Action", render: (row) => row.queueAction },
        { key: "gate", header: "Release Gate Status", render: (row) => row.releaseGateStatus },
        { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
        { key: "evidence-refs", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
        { key: "rationale", header: "Runtime Rationale", render: (row) => row.rationale }
      ]}
    />
  );
}
