import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../lib/fixtures.ts", import.meta.url), "utf8");

const parseFixtures = () => {
  const moduleSource = source
    .replace(/^import type[\s\S]*?from "@\/lib\/types";\n\n/, "")
    .replaceAll(/export const (\w+)[^=]*=/g, "const $1 =");
  return Function(`${moduleSource}\nreturn { skillVersions, releaseEvidence, supportTickets, supportEscalationRunbooks, supportUsers, riskyExports, abuseEvents, auditEvents, exportJobs, traces, quotaAccounts };`)();
};

const {
  skillVersions,
  releaseEvidence,
  supportTickets,
  supportEscalationRunbooks,
  supportUsers,
  riskyExports,
  abuseEvents,
  auditEvents,
  exportJobs,
  traces,
  quotaAccounts
} = parseFixtures();

const auditIds = new Set(auditEvents.map((event) => event.id));
const supportTicketIds = new Set(supportTickets.map((ticket) => ticket.id));
const supportTicketById = new Map(supportTickets.map((ticket) => [ticket.id, ticket]));
const supportUserIds = new Set(supportUsers.map((user) => user.id));
const traceIds = new Set(traces.map((trace) => trace.id));
const exportIds = new Set(exportJobs.map((job) => job.id));
const quotaUserIds = new Set(quotaAccounts.map((account) => account.userId));

test("abuse queue entries require actionable governance evidence", () => {
  for (const event of abuseEvents) {
    assert.ok(event.assignedRole, `${event.id} needs an assigned admin role`);
    assert.ok(event.allowedActions.length > 0, `${event.id} needs allowed actions`);
    assert.ok(event.reviewRationale.length > 20, `${event.id} needs reviewer rationale`);
    assert.notEqual(event.auditRef, "pending", `${event.id} needs immutable audit before closure`);

    if (event.linkedSupportTicket !== "pending") {
      assert.ok(
        supportTicketIds.has(event.linkedSupportTicket),
        `${event.id} links unknown support ticket ${event.linkedSupportTicket}`
      );
    }

    if (event.auditRef !== "pending") {
      assert.ok(auditIds.has(event.auditRef), `${event.id} links unknown audit event ${event.auditRef}`);
    }

    if (event.severity === "critical") {
      assert.equal(event.assignedRole, "admin_superadmin", `${event.id} critical abuse needs superadmin ownership`);
      assert.equal(event.resolution, "open", `${event.id} critical abuse stays open until audited escalation`);
    }
  }
});

test("support tickets link user, trace, export, quota, and audit evidence", () => {
  for (const ticket of supportTickets) {
    assert.ok(supportUserIds.has(ticket.userId), `${ticket.id} links unknown support user ${ticket.userId}`);

    if (ticket.traceId !== "none") {
      assert.ok(traceIds.has(ticket.traceId), `${ticket.id} links unknown trace ${ticket.traceId}`);
    }

    if (ticket.exportId !== "none") {
      assert.ok(exportIds.has(ticket.exportId), `${ticket.id} links unknown export ${ticket.exportId}`);
    }

    if (ticket.quotaTransactionId !== "none") {
      assert.ok(quotaUserIds.has(ticket.userId), `${ticket.id} has quota action without user quota account`);
    }

    if (ticket.auditRef !== "pending") {
      assert.ok(auditIds.has(ticket.auditRef), `${ticket.id} links unknown audit event ${ticket.auditRef}`);
    }
  }
});

test("support escalation runbooks gate customer updates and closure safety", () => {
  for (const runbook of supportEscalationRunbooks) {
    const ticket = supportTicketById.get(runbook.ticketId);
    assert.ok(ticket, `${runbook.ticketId} must link an existing support ticket`);
    assert.ok(runbook.owner.length > 0, `${runbook.ticketId} needs an escalation owner`);
    assert.ok(runbook.customerUpdateCadence.length > 20, `${runbook.ticketId} needs customer update cadence`);
    assert.ok(runbook.customerMessage.length > 20, `${runbook.ticketId} needs customer-safe message`);
    assert.ok(runbook.runbook.length > 30, `${runbook.ticketId} needs operator runbook guidance`);
    assert.ok(runbook.requiredEvidenceRefs.length > 0, `${runbook.ticketId} needs required evidence refs`);

    if (runbook.readiness === "ready") {
      assert.equal(runbook.closureBlockers.length, 0, `${runbook.ticketId} ready runbook cannot keep closure blockers`);
      assert.notEqual(ticket.auditRef, "pending", `${runbook.ticketId} ready runbook needs ticket audit ref`);
    } else {
      assert.ok(runbook.closureBlockers.length > 0, `${runbook.ticketId} blocked runbook needs closure blockers`);
    }

    if (ticket.status === "escalated") {
      assert.notEqual(runbook.escalationRole, "support_operator", `${runbook.ticketId} escalated ticket needs admin role boundary`);
    }
  }
});

test("high-risk audit and release operations are immutable and rollback-linked", () => {
  for (const event of auditEvents) {
    assert.equal(event.immutable, true, `${event.id} must be immutable`);
    assert.ok(event.evidenceRefs.length > 0, `${event.id} needs evidence refs`);

    if (event.risk === "high" || event.risk === "critical") {
      assert.notEqual(event.secondReviewStatus, "not_required", `${event.id} high-risk event needs second-review state`);
    }
  }

  for (const version of skillVersions) {
    assert.ok(version.rollbackTarget.length > 0, `${version.id} needs rollback target`);
    assert.ok(auditIds.has(version.rollbackAuditRef), `${version.id} links unknown rollback audit`);

    if (version.secondReviewRequired) {
      assert.match(version.secondReviewer, /required|admin/, `${version.id} needs second reviewer marker`);
    }
  }

  for (const evidence of releaseEvidence) {
    assert.ok(evidence.rollbackTarget.length > 0, `${evidence.id} needs rollback target`);
    assert.ok(auditIds.has(evidence.auditRef) || evidence.auditRef === evidence.id, `${evidence.id} links unknown audit ref`);
  }
});

test("blocking safety exports cannot be overridden without audit-safe eligibility", () => {
  for (const riskyExport of riskyExports) {
    assert.equal(riskyExport.auditRequired, true, `${riskyExport.id} must require audit`);
    assert.ok(riskyExport.reviewRationale.length > 20, `${riskyExport.id} needs review rationale`);

    if (riskyExport.action === "block") {
      assert.equal(riskyExport.overrideEligible, false, `${riskyExport.id} blocking safety action cannot be override eligible`);
    }

    if (riskyExport.overrideEligible) {
      assert.notEqual(riskyExport.action, "block", `${riskyExport.id} override must not bypass blocking action`);
    }
  }
});
