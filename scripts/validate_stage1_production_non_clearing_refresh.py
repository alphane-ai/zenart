#!/usr/bin/env python3
"""Validate the Stage 1 production non-clearing refresh summary."""

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
RUNNER = ROOT / "scripts" / "refresh_stage1_production_non_clearing_evidence.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-non-clearing-refresh.json"
EXPECTED_STEP_IDS = [
    "billing_live_proof_template",
    "production_source_probe_templates",
    "validate_production_source_probe_templates",
    "production_input_template",
    "validate_production_input_template",
    "production_dns_readiness",
    "validate_production_dns_readiness",
    "production_dns_cutover_plan",
    "validate_production_dns_cutover_plan",
    "production_proof_bundle",
    "validate_production_proof_bundle",
    "validate_production_launch_source_pipeline",
    "production_billing_operator_packet",
    "validate_production_billing_operator_packet",
    "production_security_operator_packet",
    "validate_production_security_operator_packet",
    "production_legal_support_operator_packet",
    "validate_production_legal_support_operator_packet",
    "production_governance_operator_packet",
    "validate_production_governance_operator_packet",
    "external_resource_readiness",
    "validate_external_resource_readiness",
    "production_launch_input_packet",
    "validate_production_launch_input_packet",
    "production_blocker_audit",
    "validate_production_blocker_audit",
    "production_launch_operator_brief",
    "validate_production_launch_operator_brief",
    "production_missing_input_checklist",
    "validate_production_missing_input_checklist",
    "production_source_probe_runbook",
    "validate_production_source_probe_runbook",
    "production_dns_repair_packet",
    "validate_production_dns_repair_packet",
    "production_blocker_checklist",
    "validate_production_blocker_checklist",
    "production_action_matrix",
    "validate_production_action_matrix",
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


class ProductionNonClearingRefreshValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionNonClearingRefreshValidationError(message)


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
        raise ProductionNonClearingRefreshValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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
        "stage1.production_non_clearing_refresh.v1",
        "production-non-clearing-refresh.json",
        "non_clearing_refresh",
        "canonical_sources_requested",
        "dns_apply_requested",
        "validate_stage1_production_source_probe_templates.py",
        "run_stage1_production_proof_bundle.py",
        "--legal-diagnostic",
        "--pipeline-summary",
        "TimeoutExpired",
        "step hard timeout",
        "EXPECTED_STEP_IDS",
        "validate_production_dns_cutover_plan",
        "generate_stage1_production_action_matrix.py",
        "validate_stage1_production_action_matrix.py",
        "blocked_evidence_details",
        "first_blocker_from_json",
    ):
        require(snippet in runner, f"{display_path(RUNNER)} missing required snippet {snippet!r}")
    repo_validate = read_text(REPO_VALIDATE)
    for snippet in (
        "refresh_stage1_production_non_clearing_evidence.py --contract-only",
        "validate_stage1_production_non_clearing_refresh.py --contract-only",
    ):
        require(snippet in repo_validate, f"{display_path(REPO_VALIDATE)} missing required snippet {snippet!r}")


def validate_step(step: dict[str, Any], path: str) -> None:
    require_string(step.get("step_id"), f"{path}.step_id")
    require(step.get("status") in {"pass", "blocked", "failed"}, f"{path}.status mismatch")
    require(isinstance(step.get("exit_code"), int), f"{path}.exit_code must be int")
    require(isinstance(step.get("expected_exit"), bool), f"{path}.expected_exit must be bool")
    command = require_string(step.get("command"), f"{path}.command")
    require("--write-canonical-sources" not in command, f"{path}.command must not write canonical sources")
    require(" --apply" not in command, f"{path}.command must not apply DNS")
    require(isinstance(step.get("output_summary"), str), f"{path}.output_summary must be string")


def require_counter(value: Any, path: str) -> int:
    require(isinstance(value, int), f"{path} must be int")
    require(value >= 0, f"{path} must be non-negative")
    return value


def require_percent(value: Any, path: str) -> None:
    require(isinstance(value, (int, float)), f"{path} must be numeric")
    require(0 <= float(value) <= 100, f"{path} out of range")


def validate_progress(data: dict[str, Any]) -> None:
    progress = data.get("progress")
    require(isinstance(progress, dict), "progress must be object")
    stage1 = progress.get("stage1")
    require(isinstance(stage1, dict), "progress.stage1 must be object")
    require_counter(stage1.get("completed"), "progress.stage1.completed")
    require_counter(stage1.get("total"), "progress.stage1.total")
    require_percent(stage1.get("completion_percent"), "progress.stage1.completion_percent")
    require(stage1.get("release_gate_decision") in {"go", "no_go"}, "progress.stage1.release_gate_decision mismatch")

    external = progress.get("external_resources")
    require(isinstance(external, dict), "progress.external_resources must be object")
    require_counter(external.get("ready"), "progress.external_resources.ready")
    require_counter(external.get("total"), "progress.external_resources.total")
    require_percent(external.get("ready_percent"), "progress.external_resources.ready_percent")

    inputs = progress.get("production_inputs")
    require(isinstance(inputs, dict), "progress.production_inputs must be object")
    for key in ("configured", "total", "missing", "invalid", "blocking_input_count"):
        require_counter(inputs.get(key), f"progress.production_inputs.{key}")
    require_percent(inputs.get("completion_percent"), "progress.production_inputs.completion_percent")

    probes = progress.get("production_source_probes")
    require(isinstance(probes, dict), "progress.production_source_probes must be object")
    for key in ("ready", "total", "blocked", "blocking_input_count"):
        require_counter(probes.get(key), f"progress.production_source_probes.{key}")

    lanes = progress.get("production_action_lanes")
    require(isinstance(lanes, list), "progress.production_action_lanes must be list")
    require(lanes, "progress.production_action_lanes must not be empty")
    for idx, lane in enumerate(lanes):
        require(isinstance(lane, dict), f"progress.production_action_lanes[{idx}] must be object")
        require_string(lane.get("lane_id"), f"progress.production_action_lanes[{idx}].lane_id")
        require_counter(lane.get("blocking_input_count"), f"progress.production_action_lanes[{idx}].blocking_input_count")
        require_percent(lane.get("completion_percent"), f"progress.production_action_lanes[{idx}].completion_percent")
        require_string(lane.get("first_blocker"), f"progress.production_action_lanes[{idx}].first_blocker")


def validate_summary(data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_non_clearing_refresh")
    require(data.get("schema_version") == "stage1.production_non_clearing_refresh.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_non_clearing_refresh", "kind mismatch")
    require(data.get("status") in {"pass", "blocked", "failed"}, "status mismatch")
    require(data.get("release_gate_decision") == "no_go", "release_gate_decision must remain no_go")
    require(data.get("non_clearing_refresh") is True, "non_clearing_refresh must be true")
    require(data.get("canonical_sources_requested") is False, "canonical_sources_requested must be false")
    require(data.get("dns_apply_requested") is False, "dns_apply_requested must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "must not clear production launch")
    require(data.get("can_close_do_not_launch") is False, "must not close Do-Not-Launch")
    require_string(data.get("production_web_url"), "production_web_url")
    require_string(data.get("staging_web_url"), "staging_web_url")
    require_string(data.get("env_file"), "env_file")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    step_summary = data.get("step_summary")
    require(isinstance(step_summary, dict), "step_summary must be object")
    for key in ("total", "passed", "blocked", "failed", "unexpected_exit_count"):
        require_counter(step_summary.get(key), f"step_summary.{key}")
    require(
        step_summary["passed"] + step_summary["blocked"] + step_summary["failed"] == step_summary["total"],
        "step summary counters must add up",
    )
    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list), "blocked_checks must be list")
    for idx, item in enumerate(blocked_checks):
        text = require_string(item, f"blocked_checks[{idx}]")
        require(not text.startswith("production_dns_readiness: wrote Stage 1"), "blocked_checks must summarize DNS readiness blocker, not stdout")
        require(not text.startswith("production_dns_cutover_plan: wrote Stage 1"), "blocked_checks must summarize DNS cutover blocker, not stdout")
        require(not text.startswith("production_proof_bundle: wrote Stage 1"), "blocked_checks must summarize proof bundle blocker, not stdout")

    blocked_details = data.get("blocked_evidence_details")
    require(isinstance(blocked_details, list), "blocked_evidence_details must be list")
    require(len(blocked_details) == step_summary["blocked"], "blocked_evidence_details length must match blocked count")
    for idx, item in enumerate(blocked_details):
        require(isinstance(item, dict), f"blocked_evidence_details[{idx}] must be object")
        require_string(item.get("step_id"), f"blocked_evidence_details[{idx}].step_id")
        require_string(item.get("source"), f"blocked_evidence_details[{idx}].source")
        detail = require_string(item.get("detail"), f"blocked_evidence_details[{idx}].detail")
        require(not detail.startswith("wrote Stage 1"), f"blocked_evidence_details[{idx}].detail must not be stdout-only")

    steps = data.get("steps")
    require(isinstance(steps, list) and steps, "steps must be non-empty list")
    step_ids = [step.get("step_id") for step in steps if isinstance(step, dict)]
    require(step_ids == EXPECTED_STEP_IDS, f"refresh step order mismatch: expected {EXPECTED_STEP_IDS}, got {step_ids}")
    for idx, step in enumerate(steps):
        require(isinstance(step, dict), f"steps[{idx}] must be object")
        validate_step(step, f"steps[{idx}]")
    require(step_summary["total"] == len(steps), "step_summary.total must match steps length")

    validate_progress(data)
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("non_clearing_evidence_only") is True, "gate_impact.non_clearing_evidence_only must be true")
    require(
        gate.get("canonical_source_write_command") == "python3 scripts/run_stage1_production_proof_bundle.py --write-canonical-sources",
        "canonical source write command anchor mismatch",
    )
    require(gate.get("strict_launch_validator") == "python3 scripts/validate_stage1_production_launch.py", "strict validator mismatch")


def run_blocked_selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        summary = base / "refresh.json"
        env = base / ".env"
        env.write_text("STRIPE_MODE=test\n", encoding="utf-8")
        proof_bundle = base / "production-proof-bundle.json"
        pipeline = base / "production-launch-source-pipeline.json"
        result = subprocess.run(
            [
                sys.executable,
                str(RUNNER),
                "--env",
                str(env),
                "--production-web-url",
                "http://localhost:3000",
                "--staging-web-url",
                "http://localhost:3000",
                "--timeout",
                "0.2",
                "--summary",
                str(summary),
                "--proof-bundle-summary",
                str(proof_bundle),
                "--pipeline-summary",
                str(pipeline),
                "--billing-diagnostic",
                str(base / "billing-blocked.json"),
                "--security-diagnostic",
                str(base / "security-blocked.json"),
                "--governance-diagnostic",
                str(base / "governance-blocked.json"),
                "--legal-diagnostic",
                str(base / "legal-blocked.json"),
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=240,
        )
        require(result.returncode == 0, f"blocked refresh selftest should exit 0, got {result.returncode}: {result.stderr or result.stdout}")
        data = load_json(summary)
        validate_summary(data)
        require(data.get("release_gate_decision") == "no_go", "blocked refresh selftest must remain no_go")
        require(data.get("canonical_sources_requested") is False, "blocked refresh selftest must not request canonical sources")


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
            print("stage1 production non-clearing refresh contract passed")
            return 0
        validate_summary(load_json(args.summary))
    except ProductionNonClearingRefreshValidationError as exc:
        raise SystemExit(f"stage1 production non-clearing refresh validation failed: {exc}") from exc
    print("stage1 production non-clearing refresh validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
