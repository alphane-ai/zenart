import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getSkillVersions } from "@/lib/admin-api";
import type { SkillVersion } from "@/lib/types";

export default async function SkillReleasesPage() {
  const versions = await getSkillVersions();

  return (
    <>
      <PageHeader
        title="Skill Version Review"
        description="Review, release, rollback, and canary controls for skill versions with eval summaries and provenance."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Release Queue</h3>
            <p>High-risk releases require a second reviewer before production activation.</p>
          </div>
        </div>
        <DataTable<SkillVersion>
          rows={versions}
          columns={[
            { key: "version", header: "Version", render: (row) => <span className="mono">{row.skillId}@{row.version}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "canary", header: "Canary", render: (row) => `${row.canaryPercent}%` },
            { key: "reviewer", header: "Reviewer", render: (row) => row.reviewer },
            { key: "eval", header: "Eval Summary", render: (row) => row.evalSummary },
            { key: "provenance", header: "Provenance", render: (row) => row.provenance },
            { key: "rollback", header: "Rollback Plan", render: (row) => row.rollbackPlan }
          ]}
        />
      </section>
    </>
  );
}
