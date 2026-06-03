import Link from "next/link";
import {
  apiBaseUrl,
  deliveryLanes,
  managerMetrics,
  surfaceStatuses
} from "@/lib/manager-data";

const statusLabels = {
  ready: "Ready",
  blocked: "Blocked",
  provisional: "Provisional",
  watch: "Watch"
};

export default function ManagerHomePage() {
  return (
    <main className="manager-shell">
      <aside className="rail" aria-label="Manager navigation">
        <Link className="brand" href="/">
          <strong>ZenArt Manager</strong>
          <span>Stage 0 Rev2 delivery</span>
        </Link>
        <nav>
          <a href="#surfaces">Surfaces</a>
          <a href="#lanes">Delivery Lanes</a>
          <a href="#gates">Release Gates</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>Manager Console</p>
            <h1>Release and local-stack status</h1>
          </div>
          <a className="api-pill" href={apiBaseUrl}>
            Backend {apiBaseUrl.replace("http://", "")}
          </a>
        </header>

        <section className="metrics" aria-label="Stage 0 metrics">
          {managerMetrics.map((metric) => (
            <article className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <p>{metric.detail}</p>
            </article>
          ))}
        </section>

        <section className="panel" id="surfaces">
          <div className="panel-heading">
            <div>
              <p>Port-safe local stack</p>
              <h2>Four testable surfaces</h2>
            </div>
          </div>
          <div className="surface-grid">
            {surfaceStatuses.map((surface) => (
              <a className="surface-row" href={surface.url} key={surface.name}>
                <div>
                  <strong>{surface.name}</strong>
                  <span>{surface.url}</span>
                </div>
                <div>
                  <span className={`badge ${surface.status}`}>{statusLabels[surface.status]}</span>
                  <small>{surface.evidence}</small>
                </div>
              </a>
            ))}
          </div>
        </section>

        <section className="panel" id="lanes">
          <div className="panel-heading">
            <div>
              <p>Execution oversight</p>
              <h2>DAG-aware work lanes</h2>
            </div>
          </div>
          <div className="lane-table">
            <div className="table-head">
              <span>Lane</span>
              <span>Focus</span>
              <span>State</span>
              <span>Next action</span>
            </div>
            {deliveryLanes.map((lane) => (
              <div className="table-row" key={lane.lane}>
                <strong>{lane.lane}</strong>
                <span>{lane.focus}</span>
                <span className={`badge ${lane.state}`}>{statusLabels[lane.state]}</span>
                <span>{lane.nextAction}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel" id="gates">
          <div className="panel-heading">
            <div>
              <p>Master integration rule</p>
              <h2>Dependency-gated closure</h2>
            </div>
          </div>
          <div className="gate-note">
            <p>
              Worker lanes can claim topological DAG nodes ahead of unfinished dependencies and
              produce provisional implementation or evidence. The master lane may close checklist
              rows only after prerequisite evidence has landed, validation passes, and the
              dependency-ready integration frontier includes that row.
            </p>
          </div>
        </section>
      </section>
    </main>
  );
}
