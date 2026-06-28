#!/usr/bin/env python3
"""Validate the guarded Stage 1 production launch source pipeline summary."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
RUNNER = ROOT / "scripts" / "run_stage1_production_launch_source_pipeline.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"
REQUIRED_SOURCE_STEPS = {
    "billing_source_probe",
    "security_source_probe",
    "legal_support_source_probe",
    "governance_source_probe",
}
REQUIRED_MISSING_INPUTS = {
    "billing_source_probe": {
        "probe_id": "production_paid_billing_lifecycle",
        "proof_id": "billing",
        "proof_validator": "validate_stage1_stripe_live_billing_proof.py",
        "canonical_source_path": "ops/evidence/production/billing-paid-lifecycle-source.json",
        "strict_validator": "validate_stage1_production_billing_evidence.py",
    },
    "security_source_probe": {
        "probe_id": "production_security_launch_checks",
        "proof_id": "security",
        "proof_validator": "validate_stage1_production_security_proof.py",
        "canonical_source_path": "ops/evidence/production/production-security-launch-source.json",
        "strict_validator": "validate_stage1_production_security_launch_evidence.py",
    },
    "legal_support_source_probe": {
        "probe_id": "production_legal_support_policy",
        "proof_id": None,
        "proof_validator": None,
        "canonical_source_path": "ops/evidence/production/production-legal-support-source.json",
        "strict_validator": "validate_stage1_production_legal_support_evidence.py",
    },
    "governance_source_probe": {
        "probe_id": "production_governance_release",
        "proof_id": "governance",
        "proof_validator": "validate_stage1_production_governance_proof.py",
        "canonical_source_path": "ops/evidence/production/production-governance-release-source.json",
        "strict_validator": "validate_stage1_production_governance_release_evidence.py",
    },
}
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


class ProductionLaunchSourcePipelineValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionLaunchSourcePipelineValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ProductionLaunchSourcePipelineValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def require_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty string")
    return value.strip()


def validate_code_anchors() -> None:
    require_text(
        RUNNER,
        (
            "stage1.production_launch_source_pipeline.v1",
            "production-launch-source-pipeline.json",
            "--write-canonical-sources",
            "missing_source_inputs",
            "production-launch-input-packet.json",
            "production-missing-input-checklist.json",
            "stage1_production_source_probe.py",
            "--billing-proof",
            "--security-proof",
            "--governance-proof",
            "generate_stage1_production_launch_evidence.py",
            "validate_stage1_production_launch.py",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "run_stage1_production_launch_source_pipeline.py --contract-only",
            "validate_stage1_production_launch_source_pipeline.py --contract-only",
            "production-launch-source-pipeline.json",
        ),
    )


def require_optional_string(value: Any, path: str) -> str | None:
    if value is None:
        return None
    return require_string(value, path)


def validate_missing_source_inputs(data: dict[str, Any], proof_paths: dict[str, str]) -> None:
    rows = data.get("missing_source_inputs")
    require(isinstance(rows, list) and len(rows) == 4, "missing_source_inputs must list four production source lanes")
    by_step: dict[str, dict[str, Any]] = {}
    for row in rows:
        require(isinstance(row, dict), "missing_source_inputs item must be object")
        step_id = require_string(row.get("source_step_id"), "missing_source_inputs.source_step_id")
        by_step[step_id] = row
    require(set(by_step) == set(REQUIRED_MISSING_INPUTS), "missing_source_inputs source_step_id set mismatch")

    for step_id, expected in REQUIRED_MISSING_INPUTS.items():
        row = by_step[step_id]
        proof_id = expected["proof_id"]
        expected_candidate = proof_paths.get(proof_id) if proof_id else None
        require(row.get("probe_id") == expected["probe_id"], f"{step_id} probe_id mismatch")
        require(row.get("status") == "blocked", f"{step_id} must remain blocked")
        require(row.get("ready_to_write_canonical_source") is False, f"{step_id} must not be ready to write canonical source")
        require(row.get("candidate_proof_path") == expected_candidate, f"{step_id} candidate_proof_path mismatch")
        candidate_exists = row.get("candidate_proof_exists")
        require(candidate_exists in {True, False, None}, f"{step_id} candidate_proof_exists must be bool/null")
        proof_validator = require_optional_string(row.get("proof_validator"), f"{step_id}.proof_validator")
        if expected["proof_validator"] is None:
            require(proof_validator is None, f"{step_id} proof_validator must be null")
        else:
            require(
                proof_validator is not None and expected["proof_validator"] in proof_validator,
                f"{step_id} proof_validator mismatch",
            )
        require(row.get("canonical_source_path") == expected["canonical_source_path"], f"{step_id} canonical_source_path mismatch")
        require_string(row.get("diagnostic_path"), f"{step_id}.diagnostic_path")
        require_string(row.get("source_template_ref"), f"{step_id}.source_template_ref")
        proof_template_ref = row.get("proof_template_ref")
        if expected_candidate is None:
            require(proof_template_ref is None, f"{step_id} proof_template_ref must be null")
        else:
            require_string(proof_template_ref, f"{step_id}.proof_template_ref")
        require("stage1_production_source_probe.py" in require_string(row.get("source_probe_command"), f"{step_id}.source_probe_command"), f"{step_id} source probe command mismatch")
        require("generate_stage1_production_" in require_string(row.get("evidence_generator"), f"{step_id}.evidence_generator"), f"{step_id} evidence generator mismatch")
        strict_validator = require_string(row.get("strict_validator"), f"{step_id}.strict_validator")
        require(expected["strict_validator"] in strict_validator, f"{step_id} strict validator mismatch")
        require(isinstance(row.get("blocking_input_count"), int), f"{step_id} blocking_input_count must be int")
        require(isinstance(row.get("required_total"), int), f"{step_id} required_total must be int")
        require(isinstance(row.get("completion_percent"), (int, float)), f"{step_id} completion_percent must be numeric")
        require_string(row.get("first_blocker"), f"{step_id}.first_blocker")
        missing = row.get("missing_or_invalid_inputs")
        require(isinstance(missing, list) and missing, f"{step_id} missing_or_invalid_inputs must be non-empty list")
        for idx, item in enumerate(missing):
            require_string(item, f"{step_id}.missing_or_invalid_inputs[{idx}]")
        require_string(row.get("operator_next_action"), f"{step_id}.operator_next_action")
        commands = row.get("next_commands")
        require(isinstance(commands, list) and len(commands) >= 3, f"{step_id} next_commands must list executable sequence")
        require(any("stage1_production_source_probe.py" in str(command) for command in commands), f"{step_id} next_commands missing source probe")


def validate_summary(data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_launch_source_pipeline")
    require(data.get("schema_version") == "stage1.production_launch_source_pipeline.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_launch_source_pipeline", "kind mismatch")
    require(data.get("status") in {"blocked", "pass"}, "status mismatch")
    require(data.get("canonical_sources_requested") in {True, False}, "canonical_sources_requested must be bool")
    require(data.get("canonical_sources_may_be_written") == data.get("canonical_sources_requested"), "canonical source write flags mismatch")
    require_string(data.get("release_gate_decision"), "release_gate_decision")
    require_string(data.get("production_web_url"), "production_web_url")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    readiness = data.get("proof_readiness")
    require(isinstance(readiness, list) and len(readiness) == 3, "proof_readiness must list billing/security/governance")
    proof_ids = {item.get("proof_id") for item in readiness if isinstance(item, dict)}
    require(proof_ids == {"billing", "security", "governance"}, "proof_readiness proof ids mismatch")
    for item in readiness:
        require(isinstance(item, dict), "proof_readiness item must be object")
        require_string(item.get("path"), "proof_readiness.path")
        require(isinstance(item.get("exists"), bool), "proof_readiness.exists must be bool")
        require(item.get("required") is True, "proof_readiness.required must be true")

    proof_paths = {
        item["proof_id"]: item["path"]
        for item in readiness
        if isinstance(item, dict) and isinstance(item.get("proof_id"), str) and isinstance(item.get("path"), str)
    }
    validate_missing_source_inputs(data, proof_paths)

    steps = data.get("steps")
    require(isinstance(steps, list) and steps, "steps must be non-empty list")
    step_ids = {step.get("step_id") for step in steps if isinstance(step, dict)}
    require(REQUIRED_SOURCE_STEPS <= step_ids, f"summary missing source steps {sorted(REQUIRED_SOURCE_STEPS - step_ids)}")
    for step in steps:
        require(isinstance(step, dict), "step must be object")
        require_string(step.get("step_id"), "step.step_id")
        require(step.get("status") in {"pass", "blocked", "failed"}, "step.status mismatch")
        require(isinstance(step.get("exit_code"), int), "step.exit_code must be int")
        require(isinstance(step.get("expected_exit"), bool), "step.expected_exit must be bool")
        require_string(step.get("command"), "step.command")
        require(isinstance(step.get("output_summary"), str), "step.output_summary must be string")

    if data.get("status") == "blocked":
        require(data.get("release_gate_decision") == "no_go", "blocked pipeline must stay no_go")
        require(data.get("non_clearing_pipeline_summary") is True, "blocked pipeline must be non-clearing")
        blockers = data.get("blocked_checks")
        require(isinstance(blockers, list) and blockers, "blocked pipeline must include blocked_checks")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_stage1_production_launch_gate") is False, "pipeline summary must not clear launch gate directly")
    require(gate.get("requires_strict_validator") == "python3 scripts/validate_stage1_production_launch.py", "strict validator anchor mismatch")


def run_blocked_selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        summary = base / "production-launch-source-pipeline.json"
        result = subprocess.run(
            [
                sys.executable,
                str(RUNNER),
                "--release-sha",
                "0123456789abcdef0123456789abcdef01234567",
                "--production-web-url",
                "http://localhost:3000",
                "--billing-proof",
                str(base / "missing-billing-proof.json"),
                "--security-proof",
                str(base / "missing-security-proof.json"),
                "--governance-proof",
                str(base / "missing-governance-proof.json"),
                "--billing-diagnostic",
                str(base / "billing-diagnostic.json"),
                "--security-diagnostic",
                str(base / "security-diagnostic.json"),
                "--legal-diagnostic",
                str(base / "legal-diagnostic.json"),
                "--governance-diagnostic",
                str(base / "governance-diagnostic.json"),
                "--summary",
                str(summary),
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(result.returncode == 2, f"blocked selftest must exit 2, got {result.returncode}: {result.stderr or result.stdout}")
        validate_summary(load_json(summary))
        for unexpected in (
            ROOT / "ops" / "evidence" / "production" / "billing-paid-lifecycle-source.json",
            ROOT / "ops" / "evidence" / "production" / "production-security-launch-source.json",
            ROOT / "ops" / "evidence" / "production" / "production-legal-support-source.json",
            ROOT / "ops" / "evidence" / "production" / "production-governance-release-source.json",
        ):
            require(not unexpected.exists(), f"blocked selftest must not create {display_path(unexpected)}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_code_anchors()
        run_blocked_selftest()
        if args.contract_only:
            print("stage1 production launch source pipeline contract passed")
            return 0
        validate_summary(load_json(args.summary))
    except ProductionLaunchSourcePipelineValidationError as exc:
        raise SystemExit(f"stage1 production launch source pipeline validation failed: {exc}") from exc
    print("stage1 production launch source pipeline validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
