import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { getAdminRbacEvidence, getAdminReviewDecisions, getReleaseEvidence, getSkillVersions } from "@/lib/admin-api";
import type { AdminRbacEvidence, AdminReviewDecision, ReleaseEvidence, SkillVersion } from "@/lib/types";

export default async function SkillReleasesPage() {
  const [versions, reviews, evidence, rbacEvidence] = await Promise.all([
    getSkillVersions(),
    getAdminReviewDecisions(),
    getReleaseEvidence(),
    getAdminRbacEvidence()
  ]);
  const releaseRbacEvidence = rbacEvidence.filter((item) => item.surface === "skill_release");

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
            {
              key: "second-review",
              header: "Second Review",
              render: (row) => (
                <StatusBadge
                  value={row.secondReviewRequired ? "high" : "approved"}
                  label={row.secondReviewRequired ? row.secondReviewer : "Not required"}
                />
              )
            },
            { key: "rationale", header: "Reviewer Rationale", render: (row) => row.reviewerRationale },
            { key: "eval", header: "Eval Summary", render: (row) => row.evalSummary },
            { key: "provenance", header: "Provenance", render: (row) => row.provenance },
            { key: "canary-evidence", header: "Canary Evidence", render: (row) => row.canaryEvidence },
            { key: "release-evidence", header: "Release Evidence", render: (row) => row.releaseEvidence },
            { key: "rollback-target", header: "Rollback Target", render: (row) => <span className="mono">{row.rollbackTarget}</span> },
            { key: "rollback-audit", header: "Rollback Audit", render: (row) => <span className="mono">{row.rollbackAuditRef}</span> },
            { key: "rollback", header: "Rollback Plan", render: (row) => row.rollbackPlan }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Skill Release RBAC Evidence</h3>
            <p>Release and canary actions must expose attempted role, required role, second-review state, immutable audit ref, and release evidence refs.</p>
          </div>
        </div>
        <DataTable<AdminRbacEvidence>
          rows={releaseRbacEvidence}
          columns={[
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "required", header: "Required Role", render: (row) => row.requiredRole },
            { key: "attempted", header: "Attempted Role", render: (row) => row.attemptedRole },
            { key: "decision", header: "Decision", render: (row) => <StatusBadge value={row.decision} label={row.decision} /> },
            { key: "second-review", header: "Second Review", render: (row) => <StatusBadge value={row.secondReviewStatus} label={row.secondReviewStatus} /> },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Review Governance</h3>
            <p>Review decisions carry rationale, diff, provenance, eval, QA, evidence refs, and second-review flags.</p>
          </div>
        </div>
        <DataTable<AdminReviewDecision>
          rows={reviews}
          columns={[
            { key: "surface", header: "Surface", render: (row) => row.surface },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            {
              key: "second-review",
              header: "Second Review",
              render: (row) => (
                <StatusBadge
                  value={row.secondReviewRequired ? "high" : "approved"}
                  label={row.secondReviewRequired ? row.secondReviewer : "Not required"}
                />
              )
            },
            { key: "rationale", header: "Rationale", render: (row) => row.rationale },
            { key: "diff", header: "Diff", render: (row) => row.diffSummary },
            { key: "qa", header: "QA", render: (row) => row.qaSummary },
            { key: "evidence", header: "Evidence Refs", render: (row) => row.evidenceRefs.join(", ") }
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Release Gate Evidence</h3>
            <p>Provider, canary, release, smoke, rollback, and reviewer-rationale evidence are tracked per gate.</p>
          </div>
        </div>
        <DataTable<ReleaseEvidence>
          rows={evidence}
          columns={[
            { key: "gate", header: "Gate", render: (row) => row.gate },
            { key: "target", header: "Target", render: (row) => <span className="mono">{row.target}</span> },
            { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            { key: "provider", header: "Provider Evidence", render: (row) => row.providerEvidence },
            { key: "canary", header: "Canary Evidence", render: (row) => row.canaryEvidence },
            { key: "release", header: "Release Evidence", render: (row) => row.releaseEvidence },
            { key: "smoke", header: "Route Smoke", render: (row) => row.smokeEvidence },
            { key: "rollback", header: "Rollback", render: (row) => row.rollbackEvidence },
            { key: "rollback-target", header: "Rollback Target", render: (row) => <span className="mono">{row.rollbackTarget}</span> },
            { key: "audit", header: "Audit Ref", render: (row) => <span className="mono">{row.auditRef}</span> }
          ]}
        />
      </section>
    </>
  );
}
