#!/usr/bin/env python3
"""Generate a non-clearing production governance/release operator packet.

The packet turns the governance/release production blocker into exact runtime
and audit inputs for ``stage1_production_governance_proof.py`` and the
follow-up source/evidence commands. It never persists cookies, authorization
headers, secrets, raw payloads, database URLs, or signed URLs, and it never
clears production launch gates.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-operator-packet.json"
DEFAULT_PROOF_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.blocked.json"
DEFAULT_PROOF_CANDIDATE = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.candidate.json"
DEFAULT_SOURCE_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.governance.json"
DEFAULT_SOURCE = ROOT / "ops" / "evidence" / "production" / "production-governance-release-source.json"
DEFAULT_ACTIVATION_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "20260527T1430Z-activation-review-audit.json"
DEFAULT_ABUSE_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "20260527T1330Z-abuse-throttle-hold.json"
DEFAULT_SKILL_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "20260527T1600Z-skill-release-eval-canary.json"

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
    "stripe-signature",
    "stripe_signature",
    "signature",
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_payload",
    "raw_event",
    "raw_response",
    "raw_support_body",
    "database_url",
    "postgres_url",
    "download_url",
    "signed_url",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
)

GOVERNANCE_COMPONENTS = [
    {
        "component": "activation",
        "release_gate_check_id": "production_activation_review_audit",
        "runtime_flag": "--activation-runtime-request-ids",
        "audit_flag": "--activation-audit-refs",
        "required_section_refs": [
            {"section": "high_risk_rbac", "flag": "--activation-high-risk-rbac-ref", "required_assertions": {"all_high_risk_surfaces_covered": True}},
            {"section": "reviewer_rationale", "flag": "--activation-reviewer-rationale-ref", "required_assertions": {"rationale_required": True, "rationale_captured": True}},
            {"section": "second_review", "flag": "--activation-second-review-ref", "required_assertions": {"required_for_high_risk": True, "distinct_reviewer_enforced": True}},
            {"section": "audit_immutability", "flag": "--activation-audit-immutability-ref", "required_assertions": {"immutable_audit_refs": True}},
            {
                "section": "activation_gates",
                "flag": "--activation-gates-ref",
                "required_assertions": {
                    "skill": True,
                    "crawler": True,
                    "prompt": True,
                    "provider": True,
                    "quota": True,
                    "safety": True,
                    "export": True,
                },
            },
        ],
    },
    {
        "component": "abuse",
        "release_gate_check_id": "production_abuse_throttle_hold",
        "runtime_flag": "--abuse-runtime-request-ids",
        "audit_flag": "--abuse-audit-refs",
        "required_section_refs": [
            {"section": "account_hold", "flag": "--abuse-account-hold-ref", "required_assertions": {"hold_enforced": True}},
            {"section": "rate_limit", "flag": "--abuse-rate-limit-ref", "required_assertions": {"rate_limit_enforced": True}},
            {
                "section": "spend_cap_or_kill_switch",
                "flag": "--abuse-spend-cap-or-kill-switch-ref",
                "required_assertions": {"spend_cap_ready": True, "kill_switch_ready": True},
            },
            {"section": "rbac_audit", "flag": "--abuse-rbac-audit-ref", "required_assertions": {"rbac_enforced": True, "immutable_audit_refs": True}},
        ],
    },
    {
        "component": "skill",
        "release_gate_check_id": "production_skill_release_eval_canary",
        "runtime_flag": "--skill-runtime-request-ids",
        "audit_flag": "--skill-audit-refs",
        "required_ids": [
            {"field": "owner_id", "flag": "--skill-owner-id"},
            {"field": "suite_id", "flag": "--skill-suite-id"},
            {"field": "rollback_target_id", "flag": "--skill-rollback-target-id"},
            {"field": "release_notes_id", "flag": "--skill-release-notes-id"},
            {"field": "canary_sample_size", "flag": "--skill-canary-sample-size", "rule": "positive integer"},
        ],
        "required_section_refs": [
            {"section": "owner_risk", "flag": "--skill-owner-risk-ref", "required_assertions": {"risk_level": "low|medium|high"}},
            {"section": "eval_suite", "flag": "--skill-eval-suite-ref", "required_assertions": {"eval_passed": True}},
            {"section": "safety_refs", "flag": "--skill-safety-refs-ref", "required_assertions": {"safety_refs_complete": True}},
            {"section": "canary_metrics", "flag": "--skill-canary-metrics-ref", "required_assertions": {"metrics_within_threshold": True, "sample_size": "positive integer"}},
            {"section": "rollback_target", "flag": "--skill-rollback-target-ref", "required_assertions": {"route_smoke_passed": True}},
            {"section": "release_notes", "flag": "--skill-release-notes-ref", "required_assertions": {"go_no_go_recorded": True}},
        ],
    },
]

GOVERNANCE_ENV_VARIABLES = [
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_REFS",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_HIGH_RISK_RBAC_REF",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_REVIEWER_RATIONALE_REF",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_SECOND_REVIEW_REF",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_AUDIT_IMMUTABILITY_REF",
    "STAGE1_PROD_GOVERNANCE_ACTIVATION_GATES_REF",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RUNTIME_REQUEST_IDS",
    "STAGE1_PROD_GOVERNANCE_ABUSE_AUDIT_REFS",
    "STAGE1_PROD_GOVERNANCE_ABUSE_ACCOUNT_HOLD_REF",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RATE_LIMIT_REF",
    "STAGE1_PROD_GOVERNANCE_ABUSE_SPEND_CAP_OR_KILL_SWITCH_REF",
    "STAGE1_PROD_GOVERNANCE_ABUSE_RBAC_AUDIT_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_RUNTIME_REQUEST_IDS",
    "STAGE1_PROD_GOVERNANCE_SKILL_AUDIT_REFS",
    "STAGE1_PROD_GOVERNANCE_SKILL_OWNER_ID",
    "STAGE1_PROD_GOVERNANCE_SKILL_RISK_LEVEL",
    "STAGE1_PROD_GOVERNANCE_SKILL_SUITE_ID",
    "STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_ID",
    "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_ID",
    "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_SAMPLE_SIZE",
    "STAGE1_PROD_GOVERNANCE_SKILL_OWNER_RISK_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_EVAL_SUITE_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_SAFETY_REFS_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_CANARY_METRICS_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_ROLLBACK_TARGET_REF",
    "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_REF",
]


class GovernanceOperatorPacketError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise GovernanceOperatorPacketError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise GovernanceOperatorPacketError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise GovernanceOperatorPacketError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise GovernanceOperatorPacketError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "governance_operator_packet")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def first_blocker(data: dict[str, Any]) -> str:
    blockers = string_list(data.get("blocked_checks")) or string_list(data.get("blockers"))
    return blockers[0] if blockers else "not reported"


def diagnostic_summary(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": display_path(path),
        "exists": path.exists(),
        "status": data.get("status", "missing") if data else "missing",
        "first_blocker": first_blocker(data) if data else "diagnostic_not_written",
        "canonical_source_written": data.get("canonical_source_written") is True if data else False,
    }


def proof_command(output_path: Path) -> list[str]:
    command = [
        "python3 scripts/stage1_production_governance_proof.py",
        "--release-sha $(git rev-parse HEAD)",
        f"--output {display_path(output_path)}",
        "--skill-risk-level <low|medium|high>",
    ]
    for component in GOVERNANCE_COMPONENTS:
        command.extend(
            [
                f"{component['runtime_flag']} <production-runtime-request-id[,id]>",
                f"{component['audit_flag']} <immutable-production-audit-ref[,ref]>",
            ]
        )
        for required_id in component.get("required_ids", []):
            command.append(f"{required_id['flag']} <production-{required_id['field'].replace('_', '-')}>")
        for section in component["required_section_refs"]:
            command.append(f"{section['flag']} <production-{component['component']}-{section['section'].replace('_', '-')}-ref>")
    return command


def private_env_template() -> dict[str, Any]:
    return {
        "path_placeholder": "<private-production-env>",
        "gitignore_required": True,
        "blank_values_only": True,
        "allowed_variable_names": GOVERNANCE_ENV_VARIABLES,
        "template_lines": [f"{name}=" for name in GOVERNANCE_ENV_VARIABLES],
    }


def operator_command_packet(args: argparse.Namespace) -> list[dict[str, Any]]:
    return [
        {
            "step_id": "run_private_env_proof_bundle",
            "command": "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
            "side_effect": "non-clearing proof candidates and blocked diagnostics only",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_governance_candidate_or_diagnostic",
            "command": f"python3 scripts/validate_stage1_production_governance_proof.py --proof {display_path(args.proof_candidate)} --diagnostic {display_path(args.proof_diagnostic)}",
            "side_effect": "local validation only",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "run_governance_source_probe_after_candidate_passes",
            "command": (
                "python3 scripts/stage1_production_source_probe.py --governance "
                "--release-sha $(git rev-parse HEAD) "
                f"--governance-proof {display_path(args.proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.governance.json "
                "--write-canonical-source"
            ),
            "side_effect": "writes governance canonical source only after production governance proof passes",
            "may_write_canonical_source": True,
            "requires_review": True,
        },
        {
            "step_id": "generate_strict_governance_evidence",
            "command": "python3 scripts/generate_stage1_production_governance_release_evidence.py --source ops/evidence/production/production-governance-release-source.json",
            "side_effect": "writes strict production governance evidence from canonical source",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_strict_governance_evidence",
            "command": "python3 scripts/validate_stage1_production_governance_release_evidence.py",
            "side_effect": "strict production governance validation",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "refresh_non_clearing_summary",
            "command": "python3 scripts/refresh_stage1_production_non_clearing_evidence.py || test $? -eq 2",
            "side_effect": "non-clearing summary refresh",
            "may_write_canonical_source": False,
            "requires_review": False,
        },
    ]


def build_packet(args: argparse.Namespace) -> dict[str, Any]:
    proof_diagnostic = load_json(args.proof_diagnostic)
    source_diagnostic = load_json(args.source_diagnostic)
    data: dict[str, Any] = {
        "schema_version": "stage1.production_governance_operator_packet.v1",
        "environment": "production",
        "kind": "stage1_production_governance_operator_packet",
        "status": "blocked",
        "release_gate_check_id": "production_governance_release",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "release_sha": current_release_sha(),
        "non_clearing_operator_packet": True,
        "canonical_pass_path": False,
        "can_clear_production_governance_release": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "required_governance_components": GOVERNANCE_COMPONENTS,
        "private_env_template": private_env_template(),
        "proof": {
            "candidate_path": display_path(args.proof_candidate),
            "blocked_diagnostic": diagnostic_summary(args.proof_diagnostic, proof_diagnostic),
            "proof_generator_command": " ".join(proof_command(args.proof_candidate)),
            "proof_validator_command": (
                f"python3 scripts/validate_stage1_production_governance_proof.py "
                f"--proof {display_path(args.proof_candidate)}"
            ),
        },
        "source_probe": {
            "canonical_source_path": display_path(args.source),
            "canonical_source_exists": args.source.exists(),
            "source_diagnostic": diagnostic_summary(args.source_diagnostic, source_diagnostic),
            "source_probe_command": (
                "python3 scripts/stage1_production_source_probe.py --governance "
                "--release-sha $(git rev-parse HEAD) "
                f"--governance-proof {display_path(args.proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.governance.json "
                "--write-canonical-source"
            ),
        },
        "operator_command_packet": operator_command_packet(args),
        "blocked_until": [
            "production activation runtime request IDs and immutable audit refs are provided",
            "activation high-risk RBAC, reviewer rationale, second review, audit immutability, and activation gate refs all pass",
            "production abuse runtime request IDs and immutable audit refs are provided",
            "abuse account hold, rate limit, spend cap or kill switch, and RBAC audit refs all pass",
            "production skill runtime request IDs and immutable audit refs are provided",
            "skill owner/risk, eval suite, safety refs, canary metrics, rollback target, and release notes refs all pass",
            "stage1_production_source_probe.py --governance writes ops/evidence/production/production-governance-release-source.json",
            "generate_stage1_production_governance_release_evidence.py writes strict production governance/release evidence",
            "validate_stage1_production_governance_release_evidence.py passes without --allow-preflight",
        ],
        "execution_order": [
            " ".join(proof_command(args.proof_candidate)),
            f"python3 scripts/validate_stage1_production_governance_proof.py --proof {display_path(args.proof_candidate)}",
            (
                "python3 scripts/stage1_production_source_probe.py --governance "
                "--release-sha $(git rev-parse HEAD) "
                f"--governance-proof {display_path(args.proof_candidate)} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.governance.json "
                "--write-canonical-source"
            ),
            "python3 scripts/generate_stage1_production_governance_release_evidence.py --source ops/evidence/production/production-governance-release-source.json",
            "python3 scripts/validate_stage1_production_governance_release_evidence.py",
            "python3 scripts/generate_stage1_production_launch_evidence.py",
            "python3 scripts/validate_stage1_production_launch.py",
        ],
        "evidence_outputs": {
            "proof_candidate": display_path(args.proof_candidate),
            "proof_diagnostic": display_path(args.proof_diagnostic),
            "source": display_path(args.source),
            "source_diagnostic": display_path(args.source_diagnostic),
            "activation_review_audit": display_path(args.activation_evidence),
            "abuse_throttle_hold": display_path(args.abuse_evidence),
            "skill_release_eval_canary": display_path(args.skill_evidence),
        },
        "gate_impact": {
            "preserved_release_gate_check_id": "production_governance_release",
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "can_clear_activation_review_audit_component": False,
            "can_clear_abuse_throttle_hold_component": False,
            "can_clear_skill_release_eval_canary_component": False,
            "can_clear_aggregate_production_gate": False,
            "can_clear_stage1_production_launch_gate": False,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof-diagnostic", type=Path, default=DEFAULT_PROOF_DIAGNOSTIC)
    parser.add_argument("--proof-candidate", type=Path, default=DEFAULT_PROOF_CANDIDATE)
    parser.add_argument("--source-diagnostic", type=Path, default=DEFAULT_SOURCE_DIAGNOSTIC)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--activation-evidence", type=Path, default=DEFAULT_ACTIVATION_EVIDENCE)
    parser.add_argument("--abuse-evidence", type=Path, default=DEFAULT_ABUSE_EVIDENCE)
    parser.add_argument("--skill-evidence", type=Path, default=DEFAULT_SKILL_EVIDENCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        components = [item["component"] for item in GOVERNANCE_COMPONENTS]
        if components != ["activation", "abuse", "skill"]:
            raise SystemExit("production governance operator packet component contract mismatch")
        section_count = sum(len(item["required_section_refs"]) for item in GOVERNANCE_COMPONENTS)
        if section_count != 15:
            raise SystemExit("production governance operator packet section contract mismatch")
        if len(GOVERNANCE_ENV_VARIABLES) != 27:
            raise SystemExit("production governance operator packet private env contract mismatch")
        print("stage1 production governance operator packet generator contract passed")
        return 0
    packet = build_packet(args)
    write_json(args.output, packet)
    print(f"wrote Stage 1 production governance operator packet to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
