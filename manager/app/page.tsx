const apiBase = process.env.NEXT_PUBLIC_MANAGER_API_BASE_URL ?? "http://127.0.0.1:31080";
const webUrl = process.env.NEXT_PUBLIC_MANAGER_WEB_URL ?? "http://127.0.0.1:26080";
const adminUrl = process.env.NEXT_PUBLIC_MANAGER_ADMIN_URL ?? "http://127.0.0.1:26081";

export default function ManagerHome() {
  return (
    <main className="manager-shell">
      <section className="manager-panel" aria-labelledby="manager-title">
        <div>
          <p className="eyebrow">Stage 0 Rev2</p>
          <h1 id="manager-title">ZenArt Manager</h1>
          <p className="summary">Release coordination, evidence review, and local alpha operations.</p>
        </div>
        <dl className="endpoint-grid">
          <div>
            <dt>Backend</dt>
            <dd>{apiBase}</dd>
          </div>
          <div>
            <dt>User Web</dt>
            <dd>{webUrl}</dd>
          </div>
          <div>
            <dt>Admin</dt>
            <dd>{adminUrl}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
