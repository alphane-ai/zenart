import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getProviderHealth } from "@/lib/admin-api";
import type { ProviderHealth } from "@/lib/types";

export default async function ProviderHealthPage() {
  const providers = await getProviderHealth();

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
    </>
  );
}
