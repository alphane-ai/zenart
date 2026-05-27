import type {
  AdminRbacEvidence,
  AdminRbacRuntimeDecision,
  AdminRbacSurfaceSummary,
  AdminRole
} from "@/lib/types";

const roleRank: Record<AdminRole, number> = {
  support_operator: 1,
  admin_viewer: 1,
  admin_operator: 2,
  admin_reviewer: 3,
  admin_superadmin: 4
};

function isExpired(expiresAt: string, now: Date) {
  if (expiresAt === "none") {
    return false;
  }

  const normalized = expiresAt.replace(" ", "T");
  return new Date(`${normalized}:00Z`).getTime() <= now.getTime();
}

function hasSufficientRole(item: AdminRbacEvidence) {
  return roleRank[item.attemptedRole] >= roleRank[item.requiredRole];
}

function expiryPolicyStatus(item: AdminRbacEvidence, expired: boolean) {
  if (item.overrideDurationPolicy === "non_expiring_policy_block") {
    return "non_expiring_policy_block";
  }

  if (item.overrideDurationPolicy === "second_review_deadline") {
    return expired ? "expired_temporary_window" : "second_review_deadline_open";
  }

  return expired ? "expired_temporary_window" : "valid_temporary_window";
}

export function buildAdminRbacRuntimeDecisions(
  evidence: AdminRbacEvidence[],
  now: Date
): AdminRbacRuntimeDecision[] {
  return evidence.map((item) => {
    const sufficientRole = hasSufficientRole(item);
    const expired = isExpired(item.overrideExpiresAt, now);
    const policyStatus = expiryPolicyStatus(item, expired);
    const secondReviewOpen =
      item.secondReviewRequired &&
      (item.secondReviewStatus === "required" || item.secondReviewStatus === "blocked");

    if (expired && item.expiryEnforced) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
        expiryPolicyStatus: policyStatus,
        effectiveDecision: "deny_mutation",
        requestOutcome: "denied_expired_override",
        mutationAllowed: false,
        queueAction: "block_and_preserve_state",
        releaseGateStatus: "release_gate_preserved",
        auditRef: item.auditRef,
        evidenceRefs: item.evidenceRefs,
        rationale: `${item.enforcementPoint} denied ${item.requestedAction} because the temporary override expired at ${item.overrideExpiresAt}; ${item.postDecisionControl}`
      };
    }

    if (!sufficientRole) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
        expiryPolicyStatus: policyStatus,
        effectiveDecision: "deny_mutation",
        requestOutcome: "denied_insufficient_role",
        mutationAllowed: false,
        queueAction: "block_and_preserve_state",
        releaseGateStatus: "release_gate_preserved",
        auditRef: item.auditRef,
        evidenceRefs: item.evidenceRefs,
        rationale: `${item.enforcementPoint} denied ${item.requestedAction} because ${item.attemptedRole} is below ${item.requiredRole}; ${item.postDecisionControl}`
      };
    }

    if (item.decision === "second_review_required" || (item.decision !== "denied" && secondReviewOpen)) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
        expiryPolicyStatus: policyStatus,
        effectiveDecision: "queue_for_review",
        requestOutcome: "queued_second_review",
        mutationAllowed: false,
        queueAction: "hold_for_second_review",
        releaseGateStatus: "canary_or_release_blocked",
        auditRef: item.auditRef,
        evidenceRefs: item.evidenceRefs,
        rationale: `${item.enforcementPoint} queued ${item.requestedAction} for second review; ${item.releaseGateImpact} ${item.postDecisionControl}`
      };
    }

    if (item.decision === "denied" || item.mutationOutcome === "blocked_no_mutation") {
      return {
        evidenceId: item.id,
        surface: item.surface,
        overrideScope: item.overrideScope,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
        expiryPolicyStatus: policyStatus,
        effectiveDecision: "deny_mutation",
        requestOutcome: "denied_policy_block",
        mutationAllowed: false,
        queueAction: "block_and_preserve_state",
        releaseGateStatus: "release_gate_preserved",
        auditRef: item.auditRef,
        evidenceRefs: item.evidenceRefs,
        rationale: `${item.enforcementPoint} preserved the block for ${item.requestedAction}; ${item.rationale} ${item.postDecisionControl}`
      };
    }

    return {
      evidenceId: item.id,
      surface: item.surface,
      overrideScope: item.overrideScope,
      target: item.target,
      enforcementPoint: item.enforcementPoint,
      expiryPolicyStatus: policyStatus,
      effectiveDecision: "allow_mutation",
      requestOutcome: "applied",
      mutationAllowed: true,
      queueAction: "apply_with_expiry",
      releaseGateStatus: "runtime_override_applied_with_expiry",
      auditRef: item.auditRef,
      evidenceRefs: item.evidenceRefs,
      rationale: `${item.enforcementPoint} applied ${item.requestedAction} with expiry ${item.overrideExpiresAt}; ${item.runtimeCheck}`
    };
  });
}

function uniqueSorted<T extends string>(values: T[]) {
  return Array.from(new Set<T>(values)).sort();
}

export function buildAdminRbacSurfaceSummaries(
  evidence: AdminRbacEvidence[],
  decisions: AdminRbacRuntimeDecision[]
): AdminRbacSurfaceSummary[] {
  const evidenceBySurface = new Map<AdminRbacEvidence["surface"], AdminRbacEvidence[]>();
  const decisionsBySurface = new Map<AdminRbacRuntimeDecision["surface"], AdminRbacRuntimeDecision[]>();

  for (const item of evidence) {
    evidenceBySurface.set(item.surface, [...(evidenceBySurface.get(item.surface) ?? []), item]);
  }

  for (const decision of decisions) {
    decisionsBySurface.set(decision.surface, [...(decisionsBySurface.get(decision.surface) ?? []), decision]);
  }

  return Array.from(evidenceBySurface.entries())
    .map(([surface, surfaceEvidence]) => {
      const surfaceDecisions = decisionsBySurface.get(surface) ?? [];
      const allowedMutations = surfaceDecisions.filter(
        (decision) => decision.effectiveDecision === "allow_mutation"
      ).length;
      const queuedSecondReview = surfaceDecisions.filter(
        (decision) => decision.effectiveDecision === "queue_for_review"
      ).length;
      const deniedMutations = surfaceDecisions.filter(
        (decision) => decision.effectiveDecision === "deny_mutation"
      ).length;
      const expiredOverrideDenials = surfaceDecisions.filter(
        (decision) => decision.requestOutcome === "denied_expired_override"
      ).length;
      const requiredEvidence = uniqueSorted(surfaceEvidence.flatMap((item) => item.releaseEvidenceRequired));
      const releaseGateStatuses = uniqueSorted(surfaceDecisions.map((decision) => decision.releaseGateStatus));

      let operatorAction = "Apply only inside the audited temporary window and keep expiry visible.";
      if (expiredOverrideDenials > 0) {
        operatorAction = "Block stale override, preserve the last audited state, and require a fresh request.";
      } else if (deniedMutations > 0) {
        operatorAction = "Preserve the release gate and route the operator to the required evidence path.";
      } else if (queuedSecondReview > 0) {
        operatorAction = "Hold mutation until the second reviewer and immutable audit evidence are attached.";
      }

      return {
        surface,
        overrideScope: surfaceEvidence[0].overrideScope,
        totalEvidence: surfaceEvidence.length,
        allowedMutations,
        queuedSecondReview,
        deniedMutations,
        expiredOverrideDenials,
        releaseGateStatuses,
        auditRefs: uniqueSorted(surfaceEvidence.map((item) => item.auditRef)),
        releaseEvidenceRequired: requiredEvidence,
        decisionSummary: [
          `${allowedMutations} applied`,
          `${queuedSecondReview} second-review hold`,
          `${deniedMutations} denied`,
          `${expiredOverrideDenials} expired denial`
        ].join("; "),
        operatorAction
      };
    })
    .sort((a, b) => a.surface.localeCompare(b.surface));
}
