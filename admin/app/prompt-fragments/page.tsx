import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getPromptFragments } from "@/lib/admin-api";
import type { PromptFragment } from "@/lib/types";

export default async function PromptFragmentsPage() {
  const fragments = await getPromptFragments();

  return (
    <>
      <PageHeader
        title="Prompt Fragment Review"
        description="Prompt candidates are reviewed with diffs, provenance, eval summaries, and risk labels before activation."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Candidate Fragments</h3>
            <p>Feedback can influence candidates but cannot bypass review and regression fixtures.</p>
          </div>
        </div>
        <DataTable<PromptFragment>
          rows={fragments}
          columns={[
            { key: "name", header: "Name", render: (row) => <strong>{row.name}</strong> },
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "risk", header: "Risk", render: (row) => <StatusBadge value={row.risk} /> },
            { key: "diff", header: "Diff", render: (row) => row.diffSummary },
            { key: "eval", header: "Eval", render: (row) => row.evalSummary }
          ]}
        />
      </section>
    </>
  );
}
