import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getQueueHealth } from "@/lib/admin-api";
import type { QueueHealth } from "@/lib/types";

export default async function QueuesPage() {
  const queues = await getQueueHealth();

  return (
    <>
      <PageHeader
        title="Queue and Dead-letter Dashboard"
        description="Operational visibility for pending, running, failed, and dead-letter queue work."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Queues</h3>
            <p>Dead-letter work must be inspected before retry, regeneration, or permanent closure.</p>
          </div>
        </div>
        <DataTable<QueueHealth>
          rows={queues}
          columns={[
            { key: "name", header: "Queue", render: (row) => <strong>{row.name}</strong> },
            { key: "pending", header: "Pending", render: (row) => row.pending },
            { key: "running", header: "Running", render: (row) => row.running },
            { key: "dead", header: "Dead Letters", render: (row) => <StatusBadge value={row.deadLetters > 0 ? "warning" : "healthy"} label={String(row.deadLetters)} /> },
            { key: "oldest", header: "Oldest Age", render: (row) => `${row.oldestAgeMinutes} min` },
            { key: "action", header: "Action", render: (row) => row.action }
          ]}
        />
      </section>
    </>
  );
}
