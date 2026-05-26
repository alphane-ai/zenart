export function StatGrid({
  stats
}: {
  stats: Array<{ label: string; value: string | number; detail: string }>;
}) {
  return (
    <section className="stat-grid" aria-label="Key metrics">
      {stats.map((stat) => (
        <article className="stat-card" key={stat.label}>
          <span>{stat.label}</span>
          <strong>{stat.value}</strong>
          <small>{stat.detail}</small>
        </article>
      ))}
    </section>
  );
}
