import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getFailedTaskControls, getQueueHealth } from "@/lib/admin-api";
import type { FailedTaskControl, QueueHealth } from "@/lib/types";

function actionTone(task: FailedTaskControl) {
  if (task.actionEligibility === "blocked") {
    return "blocked";
  }

  return task.actionEligibility === "requires_review" ? "warning" : "approved";
}

export default async function QueuesPage() {
  const [queues, failedTasks] = await Promise.all([
    getQueueHealth(),
    getFailedTaskControls()
  ]);

  return (
    <>
      <PageHeader
        title="Queue and Dead-letter Dashboard"
        description="Operational visibility for pending, running, failed, and dead-letter queue work."
      />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Queues</h3>
            <p>Dead-letter work must be inspected before retry, regeneration, or permanent closure.</p>
          </div>
        </div>
        <DataTable<QueueHealth>
          rows={queues}
          columns={[
            { key: "name", header: "Queue", render: (row) => <strong>{row.name}</strong> },
            { key: "pending", header: "Pending", render: (row) => row.pending },
            { key: "running", header: "Running", render: (row) => row.running },
            { key: "dead", header: "Dead Letters", render: (row) => <StatusBadge value={row.deadLetters > 0 ? "warning" : "healthy"} label={String(row.deadLetters)} /> },
            { key: "oldest", header: "Oldest Age", render: (row) => `${row.oldestAgeMinutes} min` },
            { key: "action", header: "Action", render: (row) => row.action },
            { key: "retry", header: "Retry Policy", render: (row) => row.retryPolicy },
            { key: "cancel", header: "Cancel Policy", render: (row) => row.cancelPolicy },
            { key: "role", header: "Owner Role", render: (row) => row.ownerRole },
            { key: "incident", header: "Incident", render: (row) => <span className="mono">{row.linkedIncident}</span> },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Failed Task Retry and Cancel Controls</h3>
            <p>Retry, cancel, and hold decisions require support linkage, role eligibility, user-visible messaging, version evidence, and immutable audit refs.</p>
          </div>
        </div>
        <DataTable<FailedTaskControl>
          rows={failedTasks}
          columns={[
            { key: "task", header: "Task", render: (row) => <span className="mono">{row.id}</span> },
            { key: "queue", header: "Queue", render: (row) => <span className="mono">{row.queueId}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "request", header: "Requested Action", render: (row) => <StatusBadge value={actionTone(row)} label={row.requestedAction} /> },
            { key: "eligibility", header: "Eligibility", render: (row) => row.actionEligibility },
            { key: "retry-count", header: "Retry Count", render: (row) => `${row.retryCount}/${row.maxRetries}` },
            { key: "timeout", header: "Timeout", render: (row) => `${row.timeoutSeconds}s` },
            { key: "error", header: "Error Code", render: (row) => <span className="mono">{row.errorCode}</span> },
            { key: "message", header: "User Message", render: (row) => row.userMessage },
            { key: "versions", header: "Versions", render: (row) => `${row.appVersion} · ${row.workerVersion} · ${row.schemaVersion}` },
            { key: "role", header: "Allowed Role", render: (row) => row.allowedRole },
            { key: "ticket", header: "Support Ticket", render: (row) => <span className="mono">{row.supportTicketId}</span> },
            { key: "trace", header: "Trace", render: (row) => <span className="mono">{row.traceId}</span> },
            { key: "runbook", header: "Operator Runbook", render: (row) => row.operatorRunbook },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
