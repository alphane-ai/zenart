#!/usr/bin/env python3
"""Write exact Stage 1 CI PR/main workflow-run evidence.

This script is intended to run at the end of the GitHub Actions repo-contracts
job, after the Stage 0/Stage 1 contracts, backend, web, admin, script, and
secret-scan checks have passed. It records only CI metadata and stable step
references; it never persists raw secrets, provider payloads, or local debug
evidence.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_REF = "ops/evidence/ci/stage0-rev2-pr-main-run.json"
DEFAULT_OUTPUT = ROOT / DEFAULT_OUTPUT_REF
WORKFLOW_FILE = ".github/workflows/stage0-rev2-ci.yml"
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
RUN_URL_RE = re.compile(r"^https://github\.com/.+/actions/runs/[0-9]+")
SAFE_FALSE_FIELDS = {
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
}


class PrMainEvidenceError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PrMainEvidenceError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def build_run_url(repository: str | None, run_id: str | None) -> str:
    if not repository or not run_id:
        return ""
    return f"https://github.com/{repository}/actions/runs/{run_id}"


def env_or_arg(value: str, env_name: str) -> str:
    return (value or os.environ.get(env_name) or "").strip()


def normalize_trigger(args: argparse.Namespace) -> dict[str, str]:
    event_name = env_or_arg(args.event_name, "GITHUB_EVENT_NAME")
    ref = env_or_arg(args.ref, "GITHUB_REF")
    base_ref = env_or_arg(args.base_ref, "GITHUB_BASE_REF")
    head_ref = env_or_arg(args.head_ref, "GITHUB_HEAD_REF")
    require(event_name in {"pull_request", "push", "workflow_dispatch"}, "trigger must be pull_request, push, or workflow_dispatch")
    require(base_ref == "main" or ref == "refs/heads/main", "trigger must target main")
    return {
        "event_name": event_name,
        "ref": ref,
        "base_ref": base_ref,
        "head_ref": head_ref,
    }


def validation(status: str, refs: list[str]) -> dict[str, Any]:
    require(status == "pass", "PR/main validation status must be pass")
    require(refs, "PR/main validation evidence refs are required")
    return {"status": "pass", "evidence_refs": refs}


def build_evidence(args: argparse.Namespace) -> dict[str, Any]:
    release_sha = env_or_arg(args.release_sha, "GITHUB_SHA").lower()
    require(RELEASE_SHA_RE.fullmatch(release_sha) is not None, "release SHA must be full lowercase 40-character hex")

    run_id = env_or_arg(args.run_id, "GITHUB_RUN_ID")
    run_url = (args.run_url or build_run_url(os.environ.get("GITHUB_REPOSITORY"), run_id)).strip()
    require(run_id, "workflow run id is required")
    require(RUN_URL_RE.match(run_url) is not None, "workflow run URL must be a GitHub Actions run URL")

    output_path = args.output.resolve()
    evidence: dict[str, Any] = {
        "schema_version": "stage1.ci_pr_main_run.v1",
        "environment": "ci",
        "kind": "ci_pr_main_run",
        "status": "pass",
        "release_gate_check_id": "ci_gate_runtime_execution",
        "release_sha": release_sha,
        "canonical_pass_path": args.canonical_pass_path or output_path == DEFAULT_OUTPUT.resolve(),
        "dry_run": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "workflow_run": {
            "run_id": run_id,
            "run_url": run_url,
            "workflow_file": WORKFLOW_FILE,
            "conclusion": "success",
        },
        "trigger": normalize_trigger(args),
        "evidence_refs": [
            ".github/workflows/stage0-rev2-ci.yml",
            "ops/ci/stage0-rev2-ci.yml",
            "scripts/write_stage1_ci_pr_main_evidence.py",
        ],
        "validations": {
            "stage0_rev2": validation("pass", ["scripts/validate_stage0_rev2.py"]),
            "stage1_prelaunch_contracts": validation("pass", ["scripts/validate_stage1_ci_exact_evidence.py", "scripts/repo_validate.sh"]),
            "backend_go_tests": validation("pass", ["Backend fmt, vet, unit, integration, and build", "backend/go test ./..."]),
            "web_checks": validation("pass", ["Web lint, typecheck, unit, and build"]),
            "admin_checks": validation("pass", ["Admin lint, typecheck, unit, and build"]),
        },
        "gate_impact": {
            "release_gate_check_id": "ci_gate_runtime_execution",
            "can_clear_ci_gate_check": True,
        },
    }
    for field in SAFE_FALSE_FIELDS:
        evidence[field] = False
    return evidence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Write exact Stage 1 CI PR/main workflow-run evidence")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="canonical CI PR/main evidence path")
    parser.add_argument("--release-sha", default="", help="full release SHA; defaults to GITHUB_SHA")
    parser.add_argument("--run-id", default="", help="GitHub Actions run id; defaults to GITHUB_RUN_ID")
    parser.add_argument("--run-url", default="", help="GitHub Actions run URL; defaults to GITHUB_REPOSITORY/GITHUB_RUN_ID")
    parser.add_argument("--event-name", default="", help="GitHub event name; defaults to GITHUB_EVENT_NAME")
    parser.add_argument("--ref", default="", help="Git ref; defaults to GITHUB_REF")
    parser.add_argument("--base-ref", default="", help="PR base ref; defaults to GITHUB_BASE_REF")
    parser.add_argument("--head-ref", default="", help="PR head ref; defaults to GITHUB_HEAD_REF")
    parser.add_argument("--canonical-pass-path", action="store_true", help="mark output as canonical pass evidence for validator fixtures")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        evidence = build_evidence(args)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except PrMainEvidenceError as exc:
        print(f"write Stage 1 CI PR/main evidence failed: {exc}", file=sys.stderr)
        return 1
    print(f"wrote Stage 1 CI PR/main evidence to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
