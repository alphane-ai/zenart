import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getTraces } from "@/lib/admin-api";
import type { AgentTrace } from "@/lib/types";

export default async function TracesPage() {
  const traces = await getTraces();

  return (
    <>
      <PageHeader
        title="Agent Invocation Traces"
        description="Trace detail connects workflows, skill versions, prompt versions, providers, assets, packages, and export outcomes."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Recent Traces</h3>
            <p>Open a trace for provider/model steps, latency, cost, and enforcement status.</p>
          </div>
        </div>
        <DataTable<AgentTrace>
          rows={traces}
          columns={[
            { key: "trace", header: "Trace", render: (row) => <Link className="mono" href={`/traces/${row.id}`}>{row.id}</Link> },
            { key: "workflow", header: "Workflow", render: (row) => row.workflowId },
            { key: "user", header: "User", render: (row) => row.userId },
            { key: "skill", header: "Skill Version", render: (row) => row.skillVersion },
            { key: "prompt", header: "Prompt", render: (row) => row.promptVersion },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "export", header: "Export", render: (row) => row.exportId }
          ]}
        />
      </section>
    </>
  );
}
