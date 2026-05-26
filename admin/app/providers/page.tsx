import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminRbacEvidence, getProviderHealth } from "@/lib/admin-api";
import type { AdminRbacEvidence, ProviderHealth } from "@/lib/types";

export default async function ProviderHealthPage() {
  const [providers, rbacEvidence] = await Promise.all([
    getProviderHealth(),
    getAdminRbacEvidence()
  ]);
  const providerRbacEvidence = rbacEvidence.filter((item) => item.surface === "provider_routing");

  return (
    <>
      <PageHeader
        title="Provider Health"
        description="Provider, model, spend-cap, error-rate, and routing action dashboard."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Providers</h3>
            <p>Operations can reduce routing load or block providers while preserving QA enforcement.</p>
          </div>
        </div>
        <DataTable<ProviderHealth>
          rows={providers}
          columns={[
            { key: "provider", header: "Provider", render: (row) => row.provider },
            { key: "model", header: "Model", render: (row) => row.model },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "latency", header: "P95 Latency", render: (row) => `${row.p95LatencyMs} ms` },
            { key: "errors", header: "Error Rate", render: (row) => `${(row.errorRate * 100).toFixed(1)}%` },
            { key: "spend", header: "Spend Cap", render: (row) => `${row.spendCapUsedPercent}%` },
            { key: "action", header: "Routing Action", render: (row) => row.routingAction },
            { key: "contract", header: "Contract Evidence", render: (row) => row.contractEvidence },
            { key: "canary", header: "Canary Evidence", render: (row) => row.canaryEvidence },
            { key: "release", header: "Release Evidence", render: (row) => row.releaseEvidence }
          ]}
        />
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Provider Routing RBAC Evidence</h3>
            <p>Provider routing changes must prove attempted role, required role, audit ref, and safety-preserving rationale before traffic shifts.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={providerRbacEvidence}
          columns={[
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "runtime", header: "Runtime Check", render: (row) => row.runtimeCheck },
            { key: "post-decision", header: "Post Decision Control", render: (row) => row.postDecisionControl },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
    </>
  );
}
