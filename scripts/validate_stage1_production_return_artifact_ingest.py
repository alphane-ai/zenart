#!/usr/bin/env python3
"""Validate the Stage 1 production return artifact ingest summary."""

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
RUNNER = ROOT / "scripts" / "ingest_stage1_production_return_artifacts.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-return-artifact-ingest.json"
EXPECTED_STEP_IDS = [
    "production_proof_bundle",
    "validate_production_proof_bundle",
    "validate_production_launch_source_pipeline",
    "strict_production_launch_validation",
    "production_non_clearing_refresh",
    "validate_production_non_clearing_refresh",
    "generate_release_closure_queue_initial",
    "generate_next_blockers_summary",
    "validate_next_blockers_summary",
    "generate_release_closure_queue_final",
    "validate_release_closure_queue",
]
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


class ProductionReturnArtifactIngestValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionReturnArtifactIngestValidationError(message)


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
        raise ProductionReturnArtifactIngestValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain JSON object")
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
    require(isinstance(value, str) and value.strip(), f"{path} must be non-empty string")
    return value.strip()


def require_counter(value: Any, path: str) -> int:
    require(isinstance(value, int), f"{path} must be int")
    require(value >= 0, f"{path} must be non-negative")
    return value


def require_percent(value: Any, path: str) -> None:
    require(isinstance(value, (int, float)), f"{path} must be numeric")
    require(0 <= float(value) <= 100, f"{path} out of range")


def validate_code_anchors() -> None:
    runner = read_text(RUNNER)
    for snippet in (
        "stage1.production_return_artifact_ingest.v1",
        "production-return-artifact-ingest.json",
        "run_stage1_production_proof_bundle.py",
        "validate_stage1_production_proof_bundle.py",
        "validate_stage1_production_launch_source_pipeline.py",
        "validate_stage1_production_launch.py",
        "refresh_stage1_production_non_clearing_evidence.py",
        "generate_stage1_next_blockers_summary.py",
        "validate_stage1_next_blockers_summary.py",
        "generate_stage1_release_evidence_closure_queue.py",
        "validate_stage1_release_evidence_closure_queue.py",
        "--write-canonical-sources",
        "strict_production_launch_validator_passed",
        "go_candidate_requires_full_release_queue_validation",
    ):
        require(snippet in runner, f"{display_path(RUNNER)} missing required snippet {snippet!r}")
    repo_validate = read_text(REPO_VALIDATE)
    for snippet in (
        "test -x scripts/ingest_stage1_production_return_artifacts.py",
        "test -x scripts/validate_stage1_production_return_artifact_ingest.py",
        "ingest_stage1_production_return_artifacts.py --contract-only",
        "validate_stage1_production_return_artifact_ingest.py --contract-only",
    ):
        require(snippet in repo_validate, f"{display_path(REPO_VALIDATE)} missing required snippet {snippet!r}")


def validate_step(step: dict[str, Any], path: str) -> None:
    step_id = require_string(step.get("step_id"), f"{path}.step_id")
    require(step.get("status") in {"pass", "blocked", "failed"}, f"{path}.status mismatch")
    require(isinstance(step.get("exit_code"), int), f"{path}.exit_code must be int")
    require(isinstance(step.get("expected_exit"), bool), f"{path}.expected_exit must be bool")
    command = require_string(step.get("command"), f"{path}.command")
    require(isinstance(step.get("output_summary"), str), f"{path}.output_summary must be string")
    if "--write-canonical-sources" in command:
        require(step_id == "production_proof_bundle", f"{path}.command may request canonical sources only in proof bundle step")
    require(" --apply" not in command, f"{path}.command must not apply DNS")


def validate_summary(data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_return_artifact_ingest")
    require(data.get("schema_version") == "stage1.production_return_artifact_ingest.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_return_artifact_ingest", "kind mismatch")
    require(data.get("status") in {"pass", "blocked", "failed"}, "status mismatch")
    release_decision = data.get("release_gate_decision")
    require(release_decision in {"no_go", "go_candidate_requires_full_release_queue_validation"}, "release_gate_decision mismatch")
    require_string(data.get("release_sha"), "release_sha")
    require_string(data.get("production_web_url"), "production_web_url")
    require_string(data.get("staging_web_url"), "staging_web_url")
    require_string(data.get("env_file"), "env_file")
    require(isinstance(data.get("canonical_sources_requested"), bool), "canonical_sources_requested must be bool")
    require(isinstance(data.get("strict_production_launch_validator_passed"), bool), "strict_production_launch_validator_passed must be bool")
    if data.get("strict_production_launch_validator_passed") is True:
        require(data.get("release_gate_decision") == "go_candidate_requires_full_release_queue_validation", "strict pass must be go candidate")
    else:
        require(data.get("release_gate_decision") == "no_go", "strict non-pass must remain no_go")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    step_summary = data.get("step_summary")
    require(isinstance(step_summary, dict), "step_summary must be object")
    for key in ("total", "passed", "blocked", "failed", "unexpected_exit_count"):
        require_counter(step_summary.get(key), f"step_summary.{key}")
    require_percent(step_summary.get("completion_percent"), "step_summary.completion_percent")
    require(
        step_summary["passed"] + step_summary["blocked"] + step_summary["failed"] == step_summary["total"],
        "step_summary counters must add up",
    )

    steps = data.get("steps")
    require(isinstance(steps, list) and steps, "steps must be non-empty list")
    step_ids = [step.get("step_id") for step in steps if isinstance(step, dict)]
    require(step_ids == EXPECTED_STEP_IDS[: len(step_ids)], f"step order mismatch: expected prefix {EXPECTED_STEP_IDS}, got {step_ids}")
    for idx, step in enumerate(steps):
        require(isinstance(step, dict), f"steps[{idx}] must be object")
        validate_step(step, f"steps[{idx}]")
    require(step_summary["total"] == len(steps), "step_summary.total must match steps length")

    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list), "blocked_checks must be list")
    for idx, item in enumerate(blocked_checks):
        require_string(item, f"blocked_checks[{idx}]")
    unexpected_steps = data.get("unexpected_steps")
    require(isinstance(unexpected_steps, list), "unexpected_steps must be list")
    require(len(unexpected_steps) == step_summary["unexpected_exit_count"], "unexpected_steps count mismatch")

    refs = data.get("output_refs")
    require(isinstance(refs, dict), "output_refs must be object")
    for key in (
        "summary",
        "production_proof_bundle",
        "production_launch_source_pipeline",
        "production_non_clearing_refresh",
        "stage1_next_blockers_summary",
        "release_evidence_closure_queue",
    ):
        require_string(refs.get(key), f"output_refs.{key}")

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(isinstance(gate.get("can_clear_stage1_production_launch_gate"), bool), "gate_impact.can_clear_stage1_production_launch_gate must be bool")
    require(gate.get("can_close_do_not_launch") is False, "ingest summary must not close Do-Not-Launch directly")
    require(gate.get("requires_strict_validator") == "python3 scripts/validate_stage1_production_launch.py", "strict validator mismatch")
    require(gate.get("requires_release_queue_validator") == "python3 scripts/validate_stage1_release_evidence_closure_queue.py --allow-preflight", "release queue validator mismatch")
    require(gate.get("non_clearing_refresh_preserves_no_go_until_strict_pass") is True, "non-clearing preservation flag mismatch")


def run_blocked_selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        env = base / ".env"
        env.write_text("STRIPE_MODE=test\n", encoding="utf-8")
        summary = base / "production-return-artifact-ingest.json"
        result = subprocess.run(
            [
                sys.executable,
                str(RUNNER),
                "--env",
                str(env),
                "--release-sha",
                "0123456789abcdef0123456789abcdef01234567",
                "--production-web-url",
                "http://localhost:3000",
                "--staging-web-url",
                "http://localhost:3000",
                "--timeout",
                "0.2",
                "--summary",
                str(summary),
                "--proof-bundle-summary",
                str(base / "proof-bundle.json"),
                "--pipeline-summary",
                str(base / "pipeline.json"),
                "--refresh-summary",
                str(base / "refresh.json"),
                "--next-blockers-summary",
                str(base / "next-blockers.json"),
                "--closure-queue",
                str(base / "closure-queue.json"),
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=360,
        )
        require(result.returncode in {0, 2}, f"blocked ingest selftest should exit 0 or 2, got {result.returncode}: {result.stderr or result.stdout}")
        validate_summary(load_json(summary))
        data = load_json(summary)
        require(data.get("release_gate_decision") == "no_go", "blocked ingest selftest must stay no_go")
        require(data.get("canonical_sources_requested") is False, "blocked ingest selftest must not request canonical writes")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_code_anchors()
        if args.contract_only:
            print("stage1 production return artifact ingest contract passed")
            return 0
        validate_summary(load_json(args.summary))
    except ProductionReturnArtifactIngestValidationError as exc:
        raise SystemExit(f"stage1 production return artifact ingest validation failed: {exc}") from exc
    print("stage1 production return artifact ingest validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
