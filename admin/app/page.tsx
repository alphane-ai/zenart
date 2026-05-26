import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { StatGrid } from "@/components/StatGrid";
import { StatusBadge } from "@/components/StatusBadge";
import {
  getAbuseEvents,
  getAdminReviewDecisions,
  getAuditEvents,
  getExportJobs,
  getFeedbackItems,
  getProviderHealth,
  getQueueHealth,
  getRiskyExports,
  getSkillVersions
} from "@/lib/admin-api";

export default async function AdminHomePage() {
  const [
    providers,
    queues,
    exports,
    feedback,
    riskyExports,
    abuse,
    audit,
    skillVersions,
    reviews
  ] = await Promise.all([
    getProviderHealth(),
    getQueueHealth(),
    getExportJobs(),
    getFeedbackItems(),
    getRiskyExports(),
    getAbuseEvents(),
    getAuditEvents(),
    getSkillVersions(),
    getAdminReviewDecisions()
  ]);

  const unhealthyProviders = providers.filter((provider) => provider.status !== "healthy");
  const deadLetters = queues.reduce((sum, queue) => sum + queue.deadLetters, 0);
  const blockedExports = riskyExports.filter((item) => item.action === "block").length;
  const pendingSkillVersions = skillVersions.filter((item) => item.status === "review").length;
  const secondReviews = reviews.filter((review) => review.secondReviewRequired).length;

  return (
    <>
      <PageHeader
        title="Operations Overview"
        description="Stage 0 admin shell backed by typed development fixtures until the Go backend contracts are available."
        actions={
          <>
            <Link className="button" href="/audit">
              Search audit log
            </Link>
            <Link className="ghost-button" href="/support">
              Open support console
            </Link>
          </>
        }
      />

      <StatGrid
        stats={[
          {
            label: "Provider incidents",
            value: unhealthyProviders.length,
            detail: "health, spend caps, and routing risk"
          },
          {
            label: "Dead letters",
            value: deadLetters,
            detail: "queue items needing operator action"
          },
          {
            label: "Risky export blocks",
            value: blockedExports,
            detail: "safety decisions awaiting audit-safe closure"
          },
          {
            label: "Skill reviews",
            value: pendingSkillVersions,
            detail: "versions in review, canary, or rollback planning"
          },
          {
            label: "Second reviews",
            value: secondReviews,
            detail: "high-risk admin changes blocked before activation"
          }
        ]}
      />

      <section className="grid">
        <div className="panel span-6">
          <div className="panel-header">
            <div>
              <h3>Current Operational Pressure</h3>
              <p>Queues, feedback, abuse, and export work that need admin attention.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Surface</th>
                  <th>Open</th>
                  <th>Highest Risk</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Export jobs</td>
                  <td>{exports.filter((job) => job.status !== "completed").length}</td>
                  <td>
                    <StatusBadge value="warning" label="regenerate path" />
                  </td>
                </tr>
                <tr>
                  <td>Feedback queue</td>
                  <td>{feedback.filter((item) => item.status === "open").length}</td>
                  <td>
                    <StatusBadge value="info" label="learning governance" />
                  </td>
                </tr>
                <tr>
                  <td>Risky exports</td>
                  <td>{riskyExports.length}</td>
                  <td>
                    <StatusBadge value="danger" label="admin override audit" />
                  </td>
                </tr>
                <tr>
                  <td>Abuse queue</td>
                  <td>{abuse.filter((item) => item.resolution === "open").length}</td>
                  <td>
                    <StatusBadge value="danger" label="temporary hold" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="panel span-6">
          <div className="panel-header">
            <div>
              <h3>Recent Audit Events</h3>
              <p>Every review, override, support action, and quota mutation must be searchable.</p>
            </div>
          </div>
          <div className="record-list panel-body">
            {audit.slice(0, 4).map((event) => (
              <article className="record-card" key={event.id}>
                <header>
                  <div>
                    <h4>{event.action}</h4>
                    <p className="mono">{event.target}</p>
                  </div>
                  <StatusBadge value={event.risk} />
                </header>
                <p>
                  {event.actor} · {event.createdAt}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
