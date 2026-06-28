const apiBase = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL ?? "http://127.0.0.1:31080";
const webUrl = process.env.NEXT_PUBLIC_MANAGER_WEB_URL ?? "http://127.0.0.1:26080";
const adminUrl = process.env.NEXT_PUBLIC_MANAGER_ADMIN_URL ?? "http://127.0.0.1:26081";
const managerUrl = process.env.NEXT_PUBLIC_MANAGER_URL ?? "http://127.0.0.1:26082";

const endpoints = [
  { id: "backend-api", label: "Backend API", value: apiBase, href: `${apiBase}/readyz`, port: "31080" },
  { id: "user-web", label: "User Web", value: webUrl, href: webUrl, port: "26080" },
  { id: "admin-web", label: "Admin Web", value: adminUrl, href: adminUrl, port: "26081" },
  { id: "manager-web", label: "Manager Web", value: managerUrl, href: managerUrl, port: "26082" }
];

const workflows = [
  {
    id: "subscription-ops",
    label: "Subscription Ops",
    href: `${adminUrl}/quota`,
    owner: "Admin quota",
    detail: "Plans, team seats, quota ledger, Stripe lifecycle evidence, invoice visibility"
  },
  {
    id: "provider-registry",
    label: "Provider Registry",
    href: `${adminUrl}/providers`,
    owner: "Admin providers",
    detail: "Provider health, model capabilities, secret references, kill switch, test calls"
  },
  {
    id: "strategy-groups",
    label: "Strategy Groups",
    href: `${adminUrl}/providers`,
    owner: "Routing policies",
    detail: "Tenant plan routing, cost weights, canary, fallback, provider/model concurrency"
  },
  {
    id: "batch-queues",
    label: "Batch Queues",
    href: `${adminUrl}/queues`,
    owner: "Worker runtime",
    detail: "Batch fan-out, child tasks, retries, dead letters, cancellation and refunds"
  },
  {
    id: "release-readiness",
    label: "Release Readiness",
    href: `${adminUrl}/release`,
    owner: "Evidence gates",
    detail: "Stage 1 staging runtime, production launch, CI evidence, strict validators"
  },
  {
    id: "user-workspace",
    label: "User Workspace",
    href: webUrl,
    owner: "Customer surface",
    detail: "Prompt composer, batch progress, canvas placement, billing and support paths"
  }
];

const gateRows = [
  {
    id: "local-dev-ports",
    label: "Local dev ports",
    status: "Registered",
    detail: "26080 user, 26081 admin, 26082 manager, 31080 backend, 26432 PostgreSQL, 26379 Redis, 26900/26901 MinIO, 31990-31992 metrics"
  },
  {
    id: "brand-surface",
    label: "Brand surface",
    status: "Zenari",
    detail: "Public UI and local operations are named zenari.ai; legacy identifiers remain compatibility-only"
  },
  {
    id: "launch-gate",
    label: "Stage 1 launch gate",
    status: "Evidence open",
    detail: "Local-devport evidence cannot clear staging or production gates"
  }
];

export default function ManagerHome() {
  return (
    <main className="manager-shell">
      <section className="manager-hero" aria-labelledby="manager-title">
        <div className="hero-copy">
          <p className="eyebrow">Stage 1 Local Manager</p>
          <h1 id="manager-title">zenari.ai Manager</h1>
          <p className="summary">
            Cross-surface operator entry for local subscription management, provider registry, strategy
            groups, queues, release evidence, and user workspace checks.
          </p>
        </div>
        <dl className="endpoint-grid" aria-label="Local dev endpoints">
          {endpoints.map((endpoint) => (
            <div key={endpoint.label} data-manager-endpoint={endpoint.id} data-manager-port={endpoint.port}>
              <dt>{endpoint.label}</dt>
              <dd>
                <a href={endpoint.href}>{endpoint.value}</a>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="manager-section" aria-labelledby="workflow-title">
        <div className="section-heading">
          <p className="eyebrow">Operator Workflows</p>
          <h2 id="workflow-title">Management Entrypoints</h2>
        </div>
        <div className="workflow-grid">
          {workflows.map((workflow) => (
            <a className="workflow-card" href={workflow.href} key={workflow.label} data-manager-workflow={workflow.id}>
              <span className="workflow-label">{workflow.label}</span>
              <span className="workflow-owner">{workflow.owner}</span>
              <span className="workflow-detail">{workflow.detail}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="manager-section" aria-labelledby="gate-title">
        <div className="section-heading">
          <p className="eyebrow">Gate Snapshot</p>
          <h2 id="gate-title">Local Readiness Boundaries</h2>
        </div>
        <div className="gate-list">
          {gateRows.map((row) => (
            <div className="gate-row" key={row.label} data-manager-boundary={row.id}>
              <div>
                <span className="gate-label">{row.label}</span>
                <span className="gate-detail">{row.detail}</span>
              </div>
              <span className="gate-status">{row.status}</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
