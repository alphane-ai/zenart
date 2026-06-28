#!/usr/bin/env python3
"""Ingest sanitized Stage 1 production return artifacts and refresh evidence.

This is the single local entry point to run after production operators return
sanitized billing, security, legal/support, governance, or DNS proof inputs.
It never stores raw secrets or raw provider/Stripe payloads. Canonical
production sources are written only when ``--write-canonical-sources`` is
explicitly passed to the guarded production proof bundle runner.
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
DEFAULT_ENV = ROOT / ".env"
DEFAULT_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-return-artifact-ingest.json"
DEFAULT_PRODUCTION_WEB_URL = "https://zenari.ai"
DEFAULT_STAGING_WEB_URL = "https://staging.zenari.ai"
DEFAULT_PROOF_BUNDLE = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"
DEFAULT_PIPELINE_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-source-pipeline.json"
DEFAULT_REFRESH_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "production-non-clearing-refresh.json"
DEFAULT_NEXT_BLOCKERS = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.json"
DEFAULT_CLOSURE_QUEUE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"
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


class ProductionReturnArtifactIngestError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    value = result.stdout.strip().lower() if result.returncode == 0 else ""
    if not RELEASE_SHA_RE.fullmatch(value):
        raise ProductionReturnArtifactIngestError("release_sha_missing_or_not_full_sha")
    return value


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionReturnArtifactIngestError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionReturnArtifactIngestError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_return_artifact_ingest")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def scrub(text: str) -> str:
    cleaned = RAW_SECRET_RE.sub("[redacted]", text.strip())
    return " ".join(line.strip() for line in cleaned.splitlines() if line.strip())[:1200]


def run_step(step_id: str, command: list[str], expected_exit_codes: set[int], timeout: float | None = None) -> dict[str, Any]:
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        output = "\n".join(part for part in (exc.stderr, exc.stdout, f"step hard timeout after {timeout:.1f}s" if timeout else "") if part)
        return {
            "step_id": step_id,
            "status": "blocked" if 124 in expected_exit_codes else "failed",
            "exit_code": 124,
            "expected_exit": 124 in expected_exit_codes,
            "command": " ".join(command),
            "output_summary": scrub(output),
        }
    if result.returncode == 0:
        status = "pass"
    elif result.returncode in expected_exit_codes:
        status = "blocked"
    else:
        status = "failed"
    return {
        "step_id": step_id,
        "status": status,
        "exit_code": result.returncode,
        "expected_exit": result.returncode in expected_exit_codes,
        "command": " ".join(command),
        "output_summary": scrub(result.stderr or result.stdout),
    }


def pct(numerator: int, denominator: int) -> float:
    return round((numerator / denominator) * 100, 1) if denominator else 0.0


def command_sequence(args: argparse.Namespace, release_sha: str) -> list[tuple[str, list[str], set[int], float | None]]:
    production_web_url = args.production_web_url.rstrip("/")
    staging_web_url = args.staging_web_url.rstrip("/")
    env_path = display_path(args.env)
    proof_bundle_command = [
        "python3",
        "scripts/run_stage1_production_proof_bundle.py",
        "--env",
        env_path,
        "--release-sha",
        release_sha,
        "--production-web-url",
        production_web_url,
        "--summary",
        display_path(args.proof_bundle_summary),
        "--pipeline-summary",
        display_path(args.pipeline_summary),
    ]
    if args.write_canonical_sources:
        proof_bundle_command.append("--write-canonical-sources")

    return [
        ("production_proof_bundle", proof_bundle_command, {0, 2}, None),
        (
            "validate_production_proof_bundle",
            ["python3", "scripts/validate_stage1_production_proof_bundle.py", "--summary", display_path(args.proof_bundle_summary)],
            {0},
            None,
        ),
        (
            "validate_production_launch_source_pipeline",
            ["python3", "scripts/validate_stage1_production_launch_source_pipeline.py", "--summary", display_path(args.pipeline_summary)],
            {0},
            None,
        ),
        ("strict_production_launch_validation", ["python3", "scripts/validate_stage1_production_launch.py"], {0, 1}, None),
        (
            "production_non_clearing_refresh",
            [
                "python3",
                "scripts/refresh_stage1_production_non_clearing_evidence.py",
                "--env",
                env_path,
                "--production-web-url",
                production_web_url,
                "--staging-web-url",
                staging_web_url,
                "--timeout",
                str(args.timeout),
                "--summary",
                display_path(args.refresh_summary),
                "--proof-bundle-summary",
                display_path(args.proof_bundle_summary),
                "--pipeline-summary",
                display_path(args.pipeline_summary),
            ],
            {0},
            max(240.0, args.timeout * 24.0),
        ),
        (
            "validate_production_non_clearing_refresh",
            ["python3", "scripts/validate_stage1_production_non_clearing_refresh.py", "--summary", display_path(args.refresh_summary)],
            {0},
            None,
        ),
        (
            "generate_release_closure_queue_initial",
            ["python3", "scripts/generate_stage1_release_evidence_closure_queue.py", "--output", display_path(args.closure_queue)],
            {0},
            None,
        ),
        (
            "generate_next_blockers_summary",
            ["python3", "scripts/generate_stage1_next_blockers_summary.py", "--output", display_path(args.next_blockers_summary)],
            {0, 2},
            None,
        ),
        (
            "validate_next_blockers_summary",
            ["python3", "scripts/validate_stage1_next_blockers_summary.py", "--summary", display_path(args.next_blockers_summary)],
            {0},
            None,
        ),
        (
            "generate_release_closure_queue_final",
            ["python3", "scripts/generate_stage1_release_evidence_closure_queue.py", "--output", display_path(args.closure_queue)],
            {0},
            None,
        ),
        (
            "validate_release_closure_queue",
            ["python3", "scripts/validate_stage1_release_evidence_closure_queue.py", "--allow-preflight"],
            {0},
            None,
        ),
    ]


def build_summary(args: argparse.Namespace, release_sha: str, steps: list[dict[str, Any]]) -> dict[str, Any]:
    unexpected = [step for step in steps if step.get("expected_exit") is not True]
    strict_step = next((step for step in steps if step.get("step_id") == "strict_production_launch_validation"), {})
    strict_passed = strict_step.get("exit_code") == 0
    blocked = [step for step in steps if step.get("status") == "blocked"]
    status = "failed" if unexpected else ("pass" if strict_passed else "blocked")
    data: dict[str, Any] = {
        "schema_version": "stage1.production_return_artifact_ingest.v1",
        "environment": "production",
        "kind": "stage1_production_return_artifact_ingest",
        "status": status,
        "release_gate_decision": "go_candidate_requires_full_release_queue_validation" if strict_passed and not unexpected else "no_go",
        "generated_at": now(),
        "release_sha": release_sha,
        "production_web_url": args.production_web_url.rstrip("/"),
        "staging_web_url": args.staging_web_url.rstrip("/"),
        "env_file": display_path(args.env),
        "canonical_sources_requested": args.write_canonical_sources is True,
        "strict_production_launch_validator_passed": strict_passed,
        "step_summary": {
            "total": len(steps),
            "passed": sum(1 for step in steps if step.get("status") == "pass"),
            "blocked": len(blocked),
            "failed": sum(1 for step in steps if step.get("status") == "failed"),
            "unexpected_exit_count": len(unexpected),
            "completion_percent": pct(sum(1 for step in steps if step.get("status") == "pass"), len(steps)),
        },
        "steps": steps,
        "blocked_checks": [
            f"{step['step_id']}: {step['output_summary'] or 'exit_' + str(step['exit_code'])}"
            for step in blocked
        ],
        "unexpected_steps": [
            {
                "step_id": str(step.get("step_id") or "unknown"),
                "exit_code": step.get("exit_code"),
                "output_summary": str(step.get("output_summary") or ""),
            }
            for step in unexpected
        ],
        "output_refs": {
            "summary": display_path(args.summary),
            "production_proof_bundle": display_path(args.proof_bundle_summary),
            "production_launch_source_pipeline": display_path(args.pipeline_summary),
            "production_non_clearing_refresh": display_path(args.refresh_summary),
            "stage1_next_blockers_summary": display_path(args.next_blockers_summary),
            "release_evidence_closure_queue": display_path(args.closure_queue),
        },
        "gate_impact": {
            "can_clear_stage1_production_launch_gate": strict_passed and not unexpected,
            "can_close_do_not_launch": False,
            "requires_strict_validator": "python3 scripts/validate_stage1_production_launch.py",
            "requires_release_queue_validator": "python3 scripts/validate_stage1_release_evidence_closure_queue.py --allow-preflight",
            "non_clearing_refresh_preserves_no_go_until_strict_pass": True,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def run_ingest(args: argparse.Namespace) -> int:
    release_sha = args.release_sha or current_release_sha()
    if not RELEASE_SHA_RE.fullmatch(release_sha):
        raise ProductionReturnArtifactIngestError("release_sha_missing_or_not_full_sha")
    steps: list[dict[str, Any]] = []
    for step_id, command, expected, timeout in command_sequence(args, release_sha):
        step = run_step(step_id, command, expected, timeout)
        steps.append(step)
        if step.get("expected_exit") is not True:
            break
    summary = build_summary(args, release_sha, steps)
    write_json(args.summary, summary)
    print(f"wrote Stage 1 production return artifact ingest summary to {display_path(args.summary)}")
    step_summary = summary["step_summary"]
    print(
        "production_return_artifact_ingest "
        f"{step_summary['passed']}/{step_summary['total']}={step_summary['completion_percent']}%; "
        f"status={summary['status']}; release={summary['release_gate_decision']}"
    )
    if summary["status"] == "failed":
        return 1
    return 0 if summary["status"] == "pass" else 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--release-sha", default="")
    parser.add_argument("--production-web-url", default=DEFAULT_PRODUCTION_WEB_URL)
    parser.add_argument("--staging-web-url", default=DEFAULT_STAGING_WEB_URL)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--summary", type=Path, default=DEFAULT_SUMMARY)
    parser.add_argument("--proof-bundle-summary", type=Path, default=DEFAULT_PROOF_BUNDLE)
    parser.add_argument("--pipeline-summary", type=Path, default=DEFAULT_PIPELINE_SUMMARY)
    parser.add_argument("--refresh-summary", type=Path, default=DEFAULT_REFRESH_SUMMARY)
    parser.add_argument("--next-blockers-summary", type=Path, default=DEFAULT_NEXT_BLOCKERS)
    parser.add_argument("--closure-queue", type=Path, default=DEFAULT_CLOSURE_QUEUE)
    parser.add_argument("--write-canonical-sources", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if args.write_canonical_sources:
            raise SystemExit("contract-only mode must not request canonical production source writes")
        step_ids = [step_id for step_id, _command, _expected, _timeout in command_sequence(args, "0123456789abcdef0123456789abcdef01234567")]
        expected = [
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
        if step_ids != expected:
            raise SystemExit(f"production return artifact ingest step order mismatch: expected {expected}, got {step_ids}")
        flattened = "\n".join(" ".join(command) for _step_id, command, _expected, _timeout in command_sequence(args, "0123456789abcdef0123456789abcdef01234567"))
        for required in (
            "run_stage1_production_proof_bundle.py",
            "validate_stage1_production_proof_bundle.py",
            "validate_stage1_production_launch_source_pipeline.py",
            "validate_stage1_production_launch.py",
            "refresh_stage1_production_non_clearing_evidence.py",
            "generate_stage1_next_blockers_summary.py",
            "validate_stage1_next_blockers_summary.py",
            "generate_stage1_release_evidence_closure_queue.py",
            "validate_stage1_release_evidence_closure_queue.py",
        ):
            if required not in flattened:
                raise SystemExit(f"production return artifact ingest command contract missing {required}")
        print("stage1 production return artifact ingest contract passed")
        return 0
    try:
        return run_ingest(args)
    except ProductionReturnArtifactIngestError as exc:
        print(f"stage1 production return artifact ingest failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
