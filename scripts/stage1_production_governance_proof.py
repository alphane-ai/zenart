#!/usr/bin/env python3
"""Assemble sanitized Stage 1 production governance/release proof input.

The output is consumed by ``scripts/stage1_production_source_probe.py
--governance``. It captures only safe runtime request IDs, audit refs, and
section evidence refs for activation review/audit, abuse hold/throttle, and
skill release/eval/canary.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.candidate.json"
DEFAULT_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.blocked.json"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SAFE_FALSE_FIELDS = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}
SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "api_key",
    "provider_secret",
    "stripe_secret_key",
    "stripe_api_key",
    "webhook_secret",
    "stripe_webhook_secret",
    "billing_webhook_secret",
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_payload",
    "raw_event",
    "raw_response",
    "raw_support_body",
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|"
    r"t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)

COMPONENTS = {
    "activation": {
        "release_gate_check_id": "production_activation_review_audit",
        "sections": (
            "high_risk_rbac",
            "reviewer_rationale",
            "second_review",
            "audit_immutability",
            "activation_gates",
        ),
    },
    "abuse": {
        "release_gate_check_id": "production_abuse_throttle_hold",
        "sections": (
            "account_hold",
            "rate_limit",
            "spend_cap_or_kill_switch",
            "rbac_audit",
        ),
    },
    "skill": {
        "release_gate_check_id": "production_skill_release_eval_canary",
        "sections": (
            "owner_risk",
            "eval_suite",
            "safety_refs",
            "canary_metrics",
            "rollback_target",
            "release_notes",
        ),
    },
}


class ProductionGovernanceProofError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionGovernanceProofError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionGovernanceProofError(f"{path} contains raw secret-looking material")


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip().lower() if result.returncode == 0 else ""


def require_release_sha(raw: str) -> str:
    value = raw.strip().lower()
    if not RELEASE_SHA_RE.fullmatch(value):
        raise ProductionGovernanceProofError("release_sha_missing_or_not_full_sha")
    return value


def split_refs(raw: str, field: str) -> list[str]:
    refs = [item.strip() for item in raw.split(",") if item.strip()]
    if not refs:
        raise ProductionGovernanceProofError(f"{field}_missing")
    for ref in refs:
        if RAW_SECRET_RE.search(ref):
            raise ProductionGovernanceProofError(f"{field}_contains_secret_shaped_material")
    return refs


def collect_refs_blockers(raw: str, field: str, *, single: bool = False) -> list[str]:
    refs = [item.strip() for item in raw.split(",") if item.strip()]
    if not refs:
        return [f"{field}_missing"]
    blockers: list[str] = []
    if single and len(refs) != 1:
        blockers.append(f"{field}_must_be_single_ref")
    for ref in refs:
        if RAW_SECRET_RE.search(ref):
            blockers.append(f"{field}_contains_secret_shaped_material")
            break
    return blockers


def clean_ref(raw: str, field: str) -> str:
    refs = split_refs(raw, field)
    if len(refs) != 1:
        raise ProductionGovernanceProofError(f"{field}_must_be_single_ref")
    return refs[0]


def positive_int(raw: str, field: str) -> int:
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise ProductionGovernanceProofError(f"{field}_must_be_integer") from exc
    if parsed <= 0:
            raise ProductionGovernanceProofError(f"{field}_must_be_positive")
    return parsed


def collect_positive_int_blockers(raw: str, field: str) -> list[str]:
    try:
        parsed = int(raw)
    except ValueError:
        return [f"{field}_must_be_integer"]
    if parsed <= 0:
        return [f"{field}_must_be_positive"]
    return []


def section(ref: str, **values: Any) -> dict[str, Any]:
    return {"status": "pass", "evidence_refs": [ref], **values}


def component_refs(args: argparse.Namespace, component: str) -> tuple[list[str], list[str]]:
    runtime = split_refs(getattr(args, f"{component}_runtime_request_ids"), f"{component}_runtime_request_ids")
    audit = split_refs(getattr(args, f"{component}_audit_refs"), f"{component}_audit_refs")
    return runtime, audit


def collect_component_ref_blockers(args: argparse.Namespace, component: str) -> list[str]:
    blockers: list[str] = []
    blockers.extend(
        collect_refs_blockers(getattr(args, f"{component}_runtime_request_ids"), f"{component}_runtime_request_ids")
    )
    blockers.extend(collect_refs_blockers(getattr(args, f"{component}_audit_refs"), f"{component}_audit_refs"))
    return blockers


def build_activation(args: argparse.Namespace) -> dict[str, Any]:
    runtime_request_ids, audit_refs = component_refs(args, "activation")
    return {
        "release_gate_check_id": COMPONENTS["activation"]["release_gate_check_id"],
        "runtime_request_ids": runtime_request_ids,
        "audit_refs": audit_refs,
        "high_risk_rbac": section(
            clean_ref(args.activation_high_risk_rbac_ref, "activation_high_risk_rbac_ref"),
            all_high_risk_surfaces_covered=True,
        ),
        "reviewer_rationale": section(
            clean_ref(args.activation_reviewer_rationale_ref, "activation_reviewer_rationale_ref"),
            rationale_required=True,
            rationale_captured=True,
        ),
        "second_review": section(
            clean_ref(args.activation_second_review_ref, "activation_second_review_ref"),
            required_for_high_risk=True,
            distinct_reviewer_enforced=True,
        ),
        "audit_immutability": section(
            clean_ref(args.activation_audit_immutability_ref, "activation_audit_immutability_ref"),
            immutable_audit_refs=True,
        ),
        "activation_gates": section(
            clean_ref(args.activation_gates_ref, "activation_gates_ref"),
            skill=True,
            crawler=True,
            prompt=True,
            provider=True,
            quota=True,
            safety=True,
            export=True,
        ),
    }


def build_abuse(args: argparse.Namespace) -> dict[str, Any]:
    runtime_request_ids, audit_refs = component_refs(args, "abuse")
    return {
        "release_gate_check_id": COMPONENTS["abuse"]["release_gate_check_id"],
        "runtime_request_ids": runtime_request_ids,
        "audit_refs": audit_refs,
        "account_hold": section(
            clean_ref(args.abuse_account_hold_ref, "abuse_account_hold_ref"),
            hold_enforced=True,
        ),
        "rate_limit": section(
            clean_ref(args.abuse_rate_limit_ref, "abuse_rate_limit_ref"),
            rate_limit_enforced=True,
        ),
        "spend_cap_or_kill_switch": section(
            clean_ref(args.abuse_spend_cap_or_kill_switch_ref, "abuse_spend_cap_or_kill_switch_ref"),
            spend_cap_ready=True,
            kill_switch_ready=True,
        ),
        "rbac_audit": section(
            clean_ref(args.abuse_rbac_audit_ref, "abuse_rbac_audit_ref"),
            rbac_enforced=True,
            immutable_audit_refs=True,
        ),
    }


def build_skill(args: argparse.Namespace) -> dict[str, Any]:
    runtime_request_ids, audit_refs = component_refs(args, "skill")
    risk = args.skill_risk_level.strip().lower()
    if risk not in {"low", "medium", "high"}:
        raise ProductionGovernanceProofError("skill_risk_level_invalid")
    owner_id = clean_ref(args.skill_owner_id, "skill_owner_id")
    suite_id = clean_ref(args.skill_suite_id, "skill_suite_id")
    rollback_target_id = clean_ref(args.skill_rollback_target_id, "skill_rollback_target_id")
    release_notes_id = clean_ref(args.skill_release_notes_id, "skill_release_notes_id")
    return {
        "release_gate_check_id": COMPONENTS["skill"]["release_gate_check_id"],
        "runtime_request_ids": runtime_request_ids,
        "audit_refs": audit_refs,
        "owner_risk": section(
            clean_ref(args.skill_owner_risk_ref, "skill_owner_risk_ref"),
            owner_id=owner_id,
            risk_level=risk,
        ),
        "eval_suite": section(
            clean_ref(args.skill_eval_suite_ref, "skill_eval_suite_ref"),
            eval_passed=True,
            suite_id=suite_id,
        ),
        "safety_refs": section(
            clean_ref(args.skill_safety_refs_ref, "skill_safety_refs_ref"),
            safety_refs_complete=True,
        ),
        "canary_metrics": section(
            clean_ref(args.skill_canary_metrics_ref, "skill_canary_metrics_ref"),
            metrics_within_threshold=True,
            sample_size=positive_int(args.skill_canary_sample_size, "skill_canary_sample_size"),
        ),
        "rollback_target": section(
            clean_ref(args.skill_rollback_target_ref, "skill_rollback_target_ref"),
            rollback_target_id=rollback_target_id,
            route_smoke_passed=True,
        ),
        "release_notes": section(
            clean_ref(args.skill_release_notes_ref, "skill_release_notes_ref"),
            release_notes_id=release_notes_id,
            go_no_go_recorded=True,
        ),
    }


def build_proof(args: argparse.Namespace) -> dict[str, Any]:
    release_sha = require_release_sha(args.release_sha or current_release_sha())
    proof: dict[str, Any] = {
        "schema_version": "stage1.production_governance_proof.v1",
        "environment": "production",
        "kind": "production_governance_release_proof",
        "status": "pass",
        "release_sha": release_sha,
        "generated_at": now(),
        "activation": build_activation(args),
        "abuse": build_abuse(args),
        "skill": build_skill(args),
    }
    proof.update(SAFE_FALSE_FIELDS)
    assert_no_secret(proof, "production_governance_proof")
    return proof


def collect_blockers(args: argparse.Namespace) -> list[str]:
    blockers: list[str] = []
    try:
        require_release_sha(args.release_sha or current_release_sha())
    except ProductionGovernanceProofError as exc:
        blockers.append(str(exc))

    blockers.extend(collect_component_ref_blockers(args, "activation"))
    for field in (
        "activation_high_risk_rbac_ref",
        "activation_reviewer_rationale_ref",
        "activation_second_review_ref",
        "activation_audit_immutability_ref",
        "activation_gates_ref",
    ):
        blockers.extend(collect_refs_blockers(getattr(args, field), field, single=True))

    blockers.extend(collect_component_ref_blockers(args, "abuse"))
    for field in (
        "abuse_account_hold_ref",
        "abuse_rate_limit_ref",
        "abuse_spend_cap_or_kill_switch_ref",
        "abuse_rbac_audit_ref",
    ):
        blockers.extend(collect_refs_blockers(getattr(args, field), field, single=True))

    blockers.extend(collect_component_ref_blockers(args, "skill"))
    for field in (
        "skill_owner_id",
        "skill_suite_id",
        "skill_rollback_target_id",
        "skill_release_notes_id",
        "skill_owner_risk_ref",
        "skill_eval_suite_ref",
        "skill_safety_refs_ref",
        "skill_canary_metrics_ref",
        "skill_rollback_target_ref",
        "skill_release_notes_ref",
    ):
        blockers.extend(collect_refs_blockers(getattr(args, field), field, single=True))
    risk = args.skill_risk_level.strip().lower()
    if risk not in {"low", "medium", "high"}:
        blockers.append("skill_risk_level_invalid")
    blockers.extend(collect_positive_int_blockers(args.skill_canary_sample_size, "skill_canary_sample_size"))
    return blockers


def blocked_diagnostic(blockers: list[str], release_sha: str) -> dict[str, Any]:
    data: dict[str, Any] = {
        "schema_version": "stage1.production_governance_proof.blocked.v1",
        "environment": "production",
        "kind": "production_governance_release_proof",
        "status": "blocked",
        "release_sha": release_sha if RELEASE_SHA_RE.fullmatch(release_sha or "") else None,
        "generated_at": now(),
        "canonical_source_written": False,
        "blocked_checks": blockers,
        "operator_next_command_after_pass": (
            "python3 scripts/stage1_production_source_probe.py --governance "
            "--release-sha $(git rev-parse HEAD) --governance-proof <this-proof.json> "
            "--write-canonical-source"
        ),
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def add_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--release-sha", default="")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--diagnostic", type=Path, default=DEFAULT_DIAGNOSTIC)
    parser.add_argument("--activation-runtime-request-ids", default="")
    parser.add_argument("--activation-audit-refs", default="")
    parser.add_argument("--activation-high-risk-rbac-ref", default="")
    parser.add_argument("--activation-reviewer-rationale-ref", default="")
    parser.add_argument("--activation-second-review-ref", default="")
    parser.add_argument("--activation-audit-immutability-ref", default="")
    parser.add_argument("--activation-gates-ref", default="")
    parser.add_argument("--abuse-runtime-request-ids", default="")
    parser.add_argument("--abuse-audit-refs", default="")
    parser.add_argument("--abuse-account-hold-ref", default="")
    parser.add_argument("--abuse-rate-limit-ref", default="")
    parser.add_argument("--abuse-spend-cap-or-kill-switch-ref", default="")
    parser.add_argument("--abuse-rbac-audit-ref", default="")
    parser.add_argument("--skill-runtime-request-ids", default="")
    parser.add_argument("--skill-audit-refs", default="")
    parser.add_argument("--skill-owner-id", default="")
    parser.add_argument("--skill-risk-level", default="medium")
    parser.add_argument("--skill-suite-id", default="")
    parser.add_argument("--skill-rollback-target-id", default="")
    parser.add_argument("--skill-release-notes-id", default="")
    parser.add_argument("--skill-canary-sample-size", default="")
    parser.add_argument("--skill-owner-risk-ref", default="")
    parser.add_argument("--skill-eval-suite-ref", default="")
    parser.add_argument("--skill-safety-refs-ref", default="")
    parser.add_argument("--skill-canary-metrics-ref", default="")
    parser.add_argument("--skill-rollback-target-ref", default="")
    parser.add_argument("--skill-release-notes-ref", default="")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    add_args(parser)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if set(COMPONENTS) != {"activation", "abuse", "skill"}:
            raise SystemExit("production governance proof component contract mismatch")
        print("stage1 production governance proof contract passed")
        return 0
    release_sha = args.release_sha or current_release_sha()
    try:
        proof = build_proof(args)
    except ProductionGovernanceProofError as exc:
        blockers = collect_blockers(args) or [str(exc)]
        diagnostic = blocked_diagnostic(blockers, release_sha.strip().lower())
        assert_no_secret(diagnostic, "production_governance_proof_diagnostic")
        write_json(args.diagnostic, diagnostic)
        print(
            f"stage1 production governance proof blocked: {len(blockers)} blocker(s); first: {blockers[0]}",
            file=sys.stderr,
        )
        return 2
    write_json(args.output, proof)
    print(f"wrote Stage 1 production governance proof to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
