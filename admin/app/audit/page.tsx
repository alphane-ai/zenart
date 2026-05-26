import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAuditEvents } from "@/lib/admin-api";
import type { AuditEvent } from "@/lib/types";

export default async function AuditPage() {
  const events = await getAuditEvents();

  return (
    <>
      <PageHeader
        title="Audit Log Search"
        description="Searchable audit record surface for review, override, support, quota, abuse, safety, and release operations."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Search</h3>
            <p>Filters are static until the backend API lands, but the route and data contract are in place.</p>
          </div>
        </div>
        <div className="panel-body">
          <div className="form-row">
            <div className="field">
              <label htmlFor="actor">Actor</label>
              <input id="actor" defaultValue="local-dev-admin" />
            </div>
            <div className="field">
              <label htmlFor="target">Target</label>
              <input id="target" defaultValue="ex-887" />
            </div>
            <div className="field">
              <label htmlFor="risk">Risk</label>
              <select id="risk" defaultValue="all">
                <option value="all">All</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
        </div>
        <DataTable<AuditEvent>
          rows={events}
          columns={[
            { key: "created", header: "Created", render: (row) => row.createdAt },
            { key: "actor", header: "Actor", render: (row) => row.actor },
            { key: "action", header: "Action", render: (row) => row.action },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "risk", header: "Risk", render: (row) => <StatusBadge value={row.risk} /> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>
    </>
  );
}
