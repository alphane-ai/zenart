import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getFeedbackItems } from "@/lib/admin-api";
import type { FeedbackItem } from "@/lib/types";

export default async function FeedbackPage() {
  const feedback = await getFeedbackItems();

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
            { key: "attribution", header: "Attribution", render: (row) => row.attribution },
            { key: "signal", header: "Signal", render: (row) => row.signal }
          ]}
        />
      </section>
    </>
  );
}
