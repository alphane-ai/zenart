import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getMetaPrompts } from "@/lib/admin-api";
import type { PromptFragment } from "@/lib/types";

export default async function MetaPromptsPage() {
  const prompts = await getMetaPrompts();

  return (
    <>
      <PageHeader
        title="Meta Prompt and Image Spec Review"
        description="Review surface for meta prompts and image specifications tied to QA, safety, and export enforcement points."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Review Queue</h3>
            <p>Image specs must preserve product/logo constraints and structured text requirements.</p>
          </div>
        </div>
        <DataTable<PromptFragment>
          rows={prompts}
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
