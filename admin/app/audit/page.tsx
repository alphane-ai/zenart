import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminReviewDecisions, getAuditEvents } from "@/lib/admin-api";
import type { AdminReviewDecision, AuditEvent } from "@/lib/types";

export default async function AuditPage() {
  const [events, reviews] = await Promise.all([
    getAuditEvents(),
    getAdminReviewDecisions()
  ]);
  const filterPresets = [
    {
      name: "High-risk admin changes",
      filter: "risk:high OR risk:critical",
      evidence: "Requires rationale, immutable audit, and second-review status."
    },
    {
      name: "Support and quota actions",
      filter: "action:credited quota OR target:usr-*",
      evidence: "Must include support ticket, quota transaction, and reviewer reason."
    },
    {
      name: "Release and canary changes",
      filter: "action:started skill canary OR surface:skill_release",
      evidence: "Must preserve eval, canary, release, smoke, and rollback evidence."
    }
  ];

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
        <div className="panel-body filter-presets">
          {filterPresets.map((preset) => (
            <article className="record-card" key={preset.name}>
              <header>
                <div>
                  <h4>{preset.name}</h4>
                  <p className="mono">{preset.filter}</p>
                </div>
                <StatusBadge value="info" label="preset" />
              </header>
              <p>{preset.evidence}</p>
            </article>
          ))}
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

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Review Rationale Evidence</h3>
            <p>High-risk admin decisions must preserve reviewer rationale, evidence refs, and second-review status.</p>
          </div>
        </div>
        <DataTable<AdminReviewDecision>
          rows={reviews}
          columns={[
            { key: "created", header: "Created", render: (row) => row.createdAt },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "risk", header: "Risk", render: (row) => <StatusBadge value={row.risk} /> },
            {
              key: "second-review",
              header: "Second Review",
              render: (row) => (
                <StatusBadge
                  value={row.secondReviewRequired ? "high" : "approved"}
                  label={row.secondReviewRequired ? row.secondReviewer : "Not required"}
                />
              )
            },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>
    </>
  );
}
