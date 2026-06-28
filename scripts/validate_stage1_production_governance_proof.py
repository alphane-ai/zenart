#!/usr/bin/env python3
"""Validate the Stage 1 production governance proof helper contract."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "stage1_production_governance_proof.py"
SOURCE_PROBE = ROOT / "scripts" / "stage1_production_source_probe.py"
DEFAULT_PROOF = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.candidate.json"
DEFAULT_DIAGNOSTIC = ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.blocked.json"
SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
)
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|"
    r"t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)
COMPONENT_SECTIONS = {
    "activation": {
        "release_gate_check_id": "production_activation_review_audit",
        "sections": {
            "high_risk_rbac",
            "reviewer_rationale",
            "second_review",
            "audit_immutability",
            "activation_gates",
        },
    },
    "abuse": {
        "release_gate_check_id": "production_abuse_throttle_hold",
        "sections": {
            "account_hold",
            "rate_limit",
            "spend_cap_or_kill_switch",
            "rbac_audit",
        },
    },
    "skill": {
        "release_gate_check_id": "production_skill_release_eval_canary",
        "sections": {
            "owner_risk",
            "eval_suite",
            "safety_refs",
            "canary_metrics",
            "rollback_target",
            "release_notes",
        },
    },
}


class ProductionGovernanceProofValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionGovernanceProofValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionGovernanceProofValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionGovernanceProofValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in {"secret", "secret_key", "api_key", "authorization", "cookie", "raw_payload"}, f"{path}.{key} exposes secret/raw field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def require_refs(value: Any, path: str) -> None:
    require(isinstance(value, list) and value, f"{path} must be non-empty list")
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be non-empty string")


def validate_section(value: Any, path: str) -> dict[str, Any]:
    require(isinstance(value, dict), f"{path} must be object")
    require(value.get("status") == "pass", f"{path}.status must pass")
    require_refs(value.get("evidence_refs"), f"{path}.evidence_refs")
    return value


def validate_proof(data: dict[str, Any]) -> None:
    assert_no_secret(data, "proof")
    require(data.get("schema_version") == "stage1.production_governance_proof.v1", "proof schema_version mismatch")
    require(data.get("environment") == "production", "proof environment mismatch")
    require(data.get("kind") == "production_governance_release_proof", "proof kind mismatch")
    require(data.get("status") == "pass", "proof status must pass")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"proof {field} must be false")
    for component, spec in COMPONENT_SECTIONS.items():
        value = data.get(component)
        require(isinstance(value, dict), f"proof.{component} must be object")
        require(value.get("release_gate_check_id") == spec["release_gate_check_id"], f"proof.{component}.release_gate_check_id mismatch")
        require_refs(value.get("runtime_request_ids"), f"proof.{component}.runtime_request_ids")
        require_refs(value.get("audit_refs"), f"proof.{component}.audit_refs")
        require(spec["sections"] <= set(value), f"proof.{component} missing sections")
        for section in sorted(spec["sections"]):
            validate_section(value.get(section), f"proof.{component}.{section}")
    activation = data["activation"]
    require(activation["high_risk_rbac"].get("all_high_risk_surfaces_covered") is True, "activation high_risk_rbac mismatch")
    require(activation["reviewer_rationale"].get("rationale_required") is True, "activation rationale_required mismatch")
    require(activation["reviewer_rationale"].get("rationale_captured") is True, "activation rationale_captured mismatch")
    require(activation["second_review"].get("required_for_high_risk") is True, "activation second_review mismatch")
    require(activation["second_review"].get("distinct_reviewer_enforced") is True, "activation distinct reviewer mismatch")
    require(activation["audit_immutability"].get("immutable_audit_refs") is True, "activation audit immutability mismatch")
    for key in ("skill", "crawler", "prompt", "provider", "quota", "safety", "export"):
        require(activation["activation_gates"].get(key) is True, f"activation gate {key} mismatch")
    abuse = data["abuse"]
    require(abuse["account_hold"].get("hold_enforced") is True, "abuse hold mismatch")
    require(abuse["rate_limit"].get("rate_limit_enforced") is True, "abuse rate limit mismatch")
    require(abuse["spend_cap_or_kill_switch"].get("spend_cap_ready") is True, "abuse spend cap mismatch")
    require(abuse["spend_cap_or_kill_switch"].get("kill_switch_ready") is True, "abuse kill switch mismatch")
    require(abuse["rbac_audit"].get("rbac_enforced") is True, "abuse RBAC mismatch")
    require(abuse["rbac_audit"].get("immutable_audit_refs") is True, "abuse audit mismatch")
    skill = data["skill"]
    require(isinstance(skill["owner_risk"].get("owner_id"), str) and skill["owner_risk"]["owner_id"], "skill owner_id required")
    require(skill["owner_risk"].get("risk_level") in {"low", "medium", "high"}, "skill risk_level mismatch")
    require(skill["eval_suite"].get("eval_passed") is True, "skill eval_passed mismatch")
    require(isinstance(skill["eval_suite"].get("suite_id"), str) and skill["eval_suite"]["suite_id"], "skill suite_id required")
    require(skill["safety_refs"].get("safety_refs_complete") is True, "skill safety refs mismatch")
    require(skill["canary_metrics"].get("metrics_within_threshold") is True, "skill canary threshold mismatch")
    require(isinstance(skill["canary_metrics"].get("sample_size"), int) and skill["canary_metrics"]["sample_size"] > 0, "skill sample_size mismatch")
    require(isinstance(skill["rollback_target"].get("rollback_target_id"), str) and skill["rollback_target"]["rollback_target_id"], "skill rollback target required")
    require(skill["rollback_target"].get("route_smoke_passed") is True, "skill rollback smoke mismatch")
    require(isinstance(skill["release_notes"].get("release_notes_id"), str) and skill["release_notes"]["release_notes_id"], "skill release notes required")
    require(skill["release_notes"].get("go_no_go_recorded") is True, "skill go/no-go mismatch")


def validate_blocked(data: dict[str, Any]) -> None:
    assert_no_secret(data, "diagnostic")
    require(data.get("schema_version") == "stage1.production_governance_proof.blocked.v1", "diagnostic schema_version mismatch")
    require(data.get("environment") == "production", "diagnostic environment mismatch")
    require(data.get("kind") == "production_governance_release_proof", "diagnostic kind mismatch")
    require(data.get("status") == "blocked", "diagnostic status must be blocked")
    require(data.get("canonical_source_written") is False, "diagnostic must not write canonical source")
    blockers = data.get("blocked_checks")
    require(isinstance(blockers, list) and blockers, "diagnostic blocked_checks must be non-empty")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"diagnostic {field} must be false")


def validate_contract() -> None:
    require(SCRIPT.exists() and SCRIPT.stat().st_mode & 0o111, "stage1_production_governance_proof.py must be executable")
    text = SCRIPT.read_text(encoding="utf-8")
    for token in (
        "stage1.production_governance_proof.v1",
        "stage1.production_governance_proof.blocked.v1",
        "collect_blockers",
        "collect_refs_blockers",
        "collect_component_ref_blockers",
        "activation-runtime-request-ids",
        "abuse-runtime-request-ids",
        "skill-runtime-request-ids",
        "all_high_risk_surfaces_covered",
        "hold_enforced",
        "metrics_within_threshold",
        "operator_next_command_after_pass",
        "stage1_production_source_probe.py --governance",
    ):
        require(token in text, f"helper missing {token}")
    source_probe = SOURCE_PROBE.read_text(encoding="utf-8")
    require("--governance-proof" in source_probe and "build_governance_source" in source_probe, "source probe must accept governance proof")


def run_blocked_selftest() -> None:
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        diagnostic = Path(tmp) / "blocked.json"
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--diagnostic",
                str(diagnostic),
                "--release-sha",
                "0123456789abcdef0123456789abcdef01234567",
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(result.returncode == 2, f"blocked selftest must exit 2, got {result.returncode}: {result.stderr or result.stdout}")
        data = load_json(diagnostic)
        validate_blocked(data)
        blockers = data.get("blocked_checks")
        require(isinstance(blockers, list), "blocked selftest blocked_checks must be list")
        for expected in (
            "activation_runtime_request_ids_missing",
            "activation_high_risk_rbac_ref_missing",
            "abuse_runtime_request_ids_missing",
            "skill_runtime_request_ids_missing",
            "skill_canary_sample_size_must_be_integer",
        ):
            require(expected in blockers, f"blocked selftest missing aggregate blocker {expected}")
        require(len(blockers) >= 25, "blocked selftest must aggregate all missing governance proof inputs")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--proof", type=Path, default=DEFAULT_PROOF)
    parser.add_argument("--diagnostic", type=Path, default=DEFAULT_DIAGNOSTIC)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract()
        run_blocked_selftest()
        if args.contract_only:
            print("stage1 production governance proof helper contract passed")
            return 0
        if args.proof.exists():
            validate_proof(load_json(args.proof))
        elif args.diagnostic.exists():
            validate_blocked(load_json(args.diagnostic))
        else:
            raise ProductionGovernanceProofValidationError("missing proof or blocked diagnostic")
    except ProductionGovernanceProofValidationError as exc:
        raise SystemExit(f"stage1 production governance proof helper validation failed: {exc}") from exc
    print("stage1 production governance proof helper validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
