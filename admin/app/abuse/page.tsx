import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAbuseEvents } from "@/lib/admin-api";
import type { AbuseEvent } from "@/lib/types";

export default async function AbusePage() {
  const events = await getAbuseEvents();

  return (
    <>
      <PageHeader
        title="Abuse Queue"
        description="Abuse monitoring for generation spikes, quota drain, safety blocks, prompt extraction, impersonation, crawler abuse, and export/share abuse."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Incidents</h3>
            <p>Admin actions include rate-limit, temporary hold, severity assignment, and resolution.</p>
          </div>
        </div>
        <DataTable<AbuseEvent>
          rows={events}
          columns={[
            { key: "id", header: "Incident", render: (row) => <span className="mono">{row.id}</span> },
            { key: "user", header: "User", render: (row) => row.userId },
            { key: "category", header: "Category", render: (row) => row.category },
            { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
            { key: "resolution", header: "Resolution", render: (row) => <StatusBadge value={row.resolution === "temporary_hold" ? "blocked" : row.resolution} label={row.resolution} /> },
            { key: "evidence", header: "Evidence", render: (row) => row.evidence }
          ]}
        />
      </section>
    </>
  );
}
