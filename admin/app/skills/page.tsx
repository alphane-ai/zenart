import Link from "next/link";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getSkills } from "@/lib/admin-api";
import type { Skill } from "@/lib/types";

export default async function SkillRegistryPage() {
  const skills = await getSkills();

  return (
    <>
      <PageHeader
        title="Skill Registry"
        description="Registry view for active skills, owners, risk labels, and active production versions."
        actions={
          <Link className="button" href="/skills/releases">
            Review versions
          </Link>
        }
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Registered Skills</h3>
            <p>Skills remain inactive until review, eval, release, and rollback metadata are complete.</p>
          </div>
        </div>
        <DataTable<Skill>
          rows={skills}
          columns={[
            { key: "name", header: "Skill", render: (row) => <strong>{row.name}</strong> },
            { key: "domain", header: "Domain", render: (row) => row.domain },
            { key: "version", header: "Active Version", render: (row) => row.activeVersion },
            { key: "owner", header: "Owner", render: (row) => row.owner },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "risk", header: "Risk", render: (row) => <StatusBadge value={row.risk} /> },
            { key: "updated", header: "Updated", render: (row) => row.updatedAt }
          ]}
        />
      </section>
    </>
  );
}
