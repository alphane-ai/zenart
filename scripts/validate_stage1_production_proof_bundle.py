#!/usr/bin/env python3
"""Validate Stage 1 production proof bundle summaries."""

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
RUNNER = ROOT / "scripts" / "run_stage1_production_proof_bundle.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"
REQUIRED_STEPS = {"billing_proof", "security_proof", "governance_proof", "launch_source_pipeline"}
REQUIRED_COVERAGE_GROUPS = {"production_dns", "billing", "security", "governance"}
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


class ProductionProofBundleValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionProofBundleValidationError(message)


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
        raise ProductionProofBundleValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


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
    runner = read_text(RUNNER)
    for snippet in (
        "stage1.production_proof_bundle.v1",
        "production-proof-bundle.json",
        "STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID",
        "stripe_live_publishable",
        "STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF",
        "STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS",
        "run_stage1_production_launch_source_pipeline.py",
        "--legal-diagnostic",
        "--write-canonical-sources",
    ):
        require(snippet in runner, f"{display_path(RUNNER)} missing required snippet {snippet!r}")
    repo_validate = read_text(REPO_VALIDATE)
    for snippet in (
        "run_stage1_production_proof_bundle.py --contract-only",
        "validate_stage1_production_proof_bundle.py --contract-only",
        "production-proof-bundle.json",
    ):
        require(snippet in repo_validate, f"{display_path(REPO_VALIDATE)} missing required snippet {snippet!r}")


def validate_step(step: dict[str, Any]) -> None:
    require_string(step.get("step_id"), "step.step_id")
    require(step.get("status") in {"pass", "blocked", "failed"}, "step.status mismatch")
    require(isinstance(step.get("exit_code"), int), "step.exit_code must be int")
    require(isinstance(step.get("expected_exit"), bool), "step.expected_exit must be bool")
    require_string(step.get("command"), "step.command")
    require(isinstance(step.get("output_summary"), str), "step.output_summary must be string")


def validate_coverage_group(group: dict[str, Any], path: str) -> None:
    for field in ("required_total", "required_configured", "required_missing", "required_invalid"):
        require(isinstance(group.get(field), int), f"{path}.{field} must be int")
        require(group[field] >= 0, f"{path}.{field} must be non-negative")
    require(
        group["required_configured"] + group["required_missing"] + group["required_invalid"] == group["required_total"],
        f"{path} required counters must add up",
    )
    for field in ("configured_variable_names", "missing_required_inputs", "invalid_required_inputs"):
        values = group.get(field)
        require(isinstance(values, list), f"{path}.{field} must be list")
        for idx, item in enumerate(values):
            require(isinstance(item, str), f"{path}.{field}[{idx}] must be string")
    requirements = group.get("requirements")
    require(isinstance(requirements, list), f"{path}.requirements must be list")
    require(len(requirements) == group["required_total"], f"{path}.requirements length mismatch")
    for idx, row in enumerate(requirements):
        row_path = f"{path}.requirements[{idx}]"
        require(isinstance(row, dict), f"{row_path} must be object")
        require_string(row.get("requirement_id"), f"{row_path}.requirement_id")
        require_string(row.get("display_name"), f"{row_path}.display_name")
        accepted = row.get("accepted_variable_names")
        require(isinstance(accepted, list) and accepted, f"{row_path}.accepted_variable_names must be non-empty list")
        require(row.get("status") in {"configured", "missing", "invalid"}, f"{row_path}.status mismatch")
        configured_name = row.get("configured_variable_name")
        if row.get("status") == "configured":
            require(isinstance(configured_name, str) and configured_name.strip(), f"{row_path}.configured_variable_name required")
        else:
            require(configured_name is None or isinstance(configured_name, str), f"{row_path}.configured_variable_name mismatch")

    optional = group.get("optional_or_defaulted")
    if optional is not None:
        require(isinstance(optional, dict), f"{path}.optional_or_defaulted must be object")
        for field in ("optional_or_defaulted_total", "optional_or_defaulted_configured"):
            require(isinstance(optional.get(field), int), f"{path}.optional_or_defaulted.{field} must be int")
            require(optional[field] >= 0, f"{path}.optional_or_defaulted.{field} must be non-negative")
        require(
            optional["optional_or_defaulted_configured"] <= optional["optional_or_defaulted_total"],
            f"{path}.optional_or_defaulted counters mismatch",
        )
        configured_optional = optional.get("configured_variable_names")
        require(isinstance(configured_optional, list), f"{path}.optional_or_defaulted.configured_variable_names must be list")


def validate_input_variable_coverage(data: dict[str, Any]) -> None:
    coverage = data.get("input_variable_coverage")
    require(isinstance(coverage, dict), "input_variable_coverage must be object")
    require(
        coverage.get("schema_version") == "stage1.production_proof_bundle.input_variable_coverage.v1",
        "input_variable_coverage schema_version mismatch",
    )
    require(coverage.get("value_redaction") == "variable_names_only", "input_variable_coverage must be variable-name only")
    for field in ("required_total", "required_configured", "required_missing", "required_invalid", "blocking_input_count"):
        require(isinstance(coverage.get(field), int), f"input_variable_coverage.{field} must be int")
        require(coverage[field] >= 0, f"input_variable_coverage.{field} must be non-negative")
    require(
        coverage["required_configured"] + coverage["required_missing"] + coverage["required_invalid"] == coverage["required_total"],
        "input_variable_coverage required counters must add up",
    )
    require(
        coverage["blocking_input_count"] == coverage["required_missing"] + coverage["required_invalid"],
        "input_variable_coverage blocking count mismatch",
    )
    pct = coverage.get("required_completion_percent")
    require(isinstance(pct, (int, float)), "input_variable_coverage.required_completion_percent must be numeric")
    require(0 <= float(pct) <= 100, "input_variable_coverage.required_completion_percent out of range")
    first = coverage.get("first_missing_or_invalid_inputs")
    require(isinstance(first, list), "input_variable_coverage.first_missing_or_invalid_inputs must be list")
    require(len(first) <= 12, "input_variable_coverage.first_missing_or_invalid_inputs must be capped")
    groups = coverage.get("groups")
    require(isinstance(groups, dict), "input_variable_coverage.groups must be object")
    require(REQUIRED_COVERAGE_GROUPS <= set(groups), "input_variable_coverage groups missing")
    for group in sorted(REQUIRED_COVERAGE_GROUPS):
        value = groups.get(group)
        require(isinstance(value, dict), f"input_variable_coverage.groups.{group} must be object")
        validate_coverage_group(value, f"input_variable_coverage.groups.{group}")


def validate_summary(data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_proof_bundle")
    require(data.get("schema_version") == "stage1.production_proof_bundle.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_proof_bundle", "kind mismatch")
    require(data.get("status") in {"blocked", "pass"}, "status mismatch")
    require(isinstance(data.get("canonical_sources_requested"), bool), "canonical_sources_requested must be bool")
    require_string(data.get("production_web_url"), "production_web_url")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    configured = data.get("configured_input_variable_names")
    require(isinstance(configured, dict), "configured_input_variable_names must be object")
    require({"billing", "security", "governance"} <= set(configured), "configured env groups missing")
    for group in ("billing", "security", "governance"):
        require(isinstance(configured.get(group), list), f"configured_input_variable_names.{group} must be list")
    validate_input_variable_coverage(data)

    proofs = data.get("proofs")
    require(isinstance(proofs, dict), "proofs must be object")
    require({"billing", "security", "governance"} <= set(proofs), "proofs missing groups")
    for group in ("billing", "security", "governance"):
        proof = proofs.get(group)
        require(isinstance(proof, dict), f"proofs.{group} must be object")
        require(proof.get("status") in {"pass", "blocked", "missing"}, f"proofs.{group}.status mismatch")
        require_string(proof.get("path"), f"proofs.{group}.path")
        if proof.get("status") == "blocked":
            require(isinstance(proof.get("blocker_count"), int), f"proofs.{group}.blocker_count must be int")
            require(proof["blocker_count"] >= 1, f"proofs.{group}.blocker_count must be positive")
            sample = proof.get("sample_blockers")
            require(isinstance(sample, list) and sample, f"proofs.{group}.sample_blockers must be non-empty list")
            require(len(sample) <= 8, f"proofs.{group}.sample_blockers must be capped")
            for idx, item in enumerate(sample):
                require(isinstance(item, str) and item.strip(), f"proofs.{group}.sample_blockers[{idx}] must be non-empty string")

    pipeline = data.get("pipeline_summary")
    require(isinstance(pipeline, dict), "pipeline_summary must be object")
    require_string(pipeline.get("path"), "pipeline_summary.path")
    require(pipeline.get("status") in {"missing", "blocked", "pass"}, "pipeline_summary.status mismatch")

    steps = data.get("steps")
    require(isinstance(steps, list), "steps must be list")
    step_ids = {step.get("step_id") for step in steps if isinstance(step, dict)}
    require(REQUIRED_STEPS <= step_ids, f"missing required steps {sorted(REQUIRED_STEPS - step_ids)}")
    for step in steps:
        require(isinstance(step, dict), "steps item must be object")
        validate_step(step)

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_stage1_production_launch_gate") is False, "bundle summary must not clear launch gate directly")
    require(gate.get("requires_strict_validator") == "python3 scripts/validate_stage1_production_launch.py", "strict validator anchor mismatch")
    if data.get("status") == "blocked":
        require(data.get("release_gate_decision") == "no_go", "blocked bundle must remain no_go")
        require(data.get("non_clearing_bundle") is True, "blocked bundle must be non-clearing")
        blockers = data.get("blocked_checks")
        require(isinstance(blockers, list) and blockers, "blocked bundle must include blocked_checks")
        coverage = data.get("input_variable_coverage")
        require(isinstance(coverage, dict), "blocked bundle must include input coverage")


def run_blocked_selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        env_path = base / ".env"
        env_path.write_text("STRIPE_MODE=test\n", encoding="utf-8")
        summary = base / "production-proof-bundle.json"
        result = subprocess.run(
            [
                sys.executable,
                str(RUNNER),
                "--env",
                str(env_path),
                "--release-sha",
                "0123456789abcdef0123456789abcdef01234567",
                "--production-web-url",
                "http://localhost:3000",
                "--billing-proof",
                str(base / "billing-proof.json"),
                "--security-proof",
                str(base / "security-proof.json"),
                "--governance-proof",
                str(base / "governance-proof.json"),
                "--billing-diagnostic",
                str(base / "billing-blocked.json"),
                "--security-diagnostic",
                str(base / "security-blocked.json"),
                "--governance-diagnostic",
                str(base / "governance-blocked.json"),
                "--legal-diagnostic",
                str(base / "legal-blocked.json"),
                "--pipeline-summary",
                str(base / "pipeline.json"),
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
        data = load_json(summary)
        require(data.get("status") == "blocked", "blocked selftest summary must stay blocked")
        require(data.get("canonical_sources_requested") is False, "blocked selftest must not request canonical sources")
        coverage = data.get("input_variable_coverage")
        require(isinstance(coverage, dict), "blocked selftest must include input coverage")
        require(coverage.get("blocking_input_count", 0) > 0, "blocked selftest must report missing/invalid inputs")


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
            print("stage1 production proof bundle contract passed")
            return 0
        validate_summary(load_json(args.summary))
    except ProductionProofBundleValidationError as exc:
        raise SystemExit(f"stage1 production proof bundle validation failed: {exc}") from exc
    print("stage1 production proof bundle validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
