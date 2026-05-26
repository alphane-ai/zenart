import type { AdminRbacEvidence, AdminRbacRuntimeDecision, AdminRole } from "@/lib/types";

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

export function buildAdminRbacRuntimeDecisions(
  evidence: AdminRbacEvidence[],
  now: Date
): AdminRbacRuntimeDecision[] {
  return evidence.map((item) => {
    const sufficientRole = hasSufficientRole(item);
    const expired = isExpired(item.overrideExpiresAt, now);
    const secondReviewOpen =
      item.secondReviewRequired &&
      (item.secondReviewStatus === "required" || item.secondReviewStatus === "blocked");

    if (expired) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
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

    if (item.decision === "second_review_required" || (item.decision !== "denied" && secondReviewOpen)) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
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

    if (!sufficientRole) {
      return {
        evidenceId: item.id,
        surface: item.surface,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
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

    if (item.decision === "denied" || item.mutationOutcome === "blocked_no_mutation") {
      return {
        evidenceId: item.id,
        surface: item.surface,
        target: item.target,
        enforcementPoint: item.enforcementPoint,
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
      target: item.target,
      enforcementPoint: item.enforcementPoint,
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
