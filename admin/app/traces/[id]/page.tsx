import { KeyValue } from "@/components/KeyValue";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getTrace } from "@/lib/admin-api";

export default async function TraceDetailPage({ params }: { params: { id: string } }) {
  const trace = await getTrace(params.id);

  return (
    <>
      <PageHeader
        title={`Trace ${trace.id}`}
        description="Detailed invocation record for operational debugging, feedback attribution, and audit provenance."
      />
      <section className="grid">
        <div className="panel span-5">
          <div className="panel-header">
            <div>
              <h3>Attribution</h3>
              <p>Required links across workflow, skill, prompt, asset, package, export, and user.</p>
            </div>
            <StatusBadge value={trace.status} />
          </div>
          <div className="panel-body">
            <KeyValue
              items={[
                ["Workflow", trace.workflowId],
                ["User", trace.userId],
                ["Skill version", trace.skillVersion],
                ["Prompt version", trace.promptVersion],
                ["Asset", trace.assetId],
                ["Export", trace.exportId]
              ]}
            />
          </div>
        </div>
        <div className="panel span-7">
          <div className="panel-header">
            <div>
              <h3>Invocation Steps</h3>
              <p>Provider/model activity with latency, cost, and enforcement status.</p>
            </div>
          </div>
          <div className="timeline panel-body">
            {trace.steps.map((step) => (
              <div className="timeline-item" key={`${step.at}-${step.stage}`}>
                <div>
                  <strong>{step.at}</strong>
                  <p className="muted">{step.stage}</p>
                </div>
                <div>
                  <StatusBadge value={step.status} />
                  <p>
                    {step.provider} · {step.model} · {step.latencyMs} ms · ${step.costUsd.toFixed(2)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
