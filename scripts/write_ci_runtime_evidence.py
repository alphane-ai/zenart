#!/usr/bin/env python3
"""Write exact Stage 0 Rev2 CI runtime evidence artifacts."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "ops" / "evidence" / "ci"

KINDS = {
    "workflow-run": (
        "stage0-rev2-pr-main-run.json",
        "ci_gate_runtime_execution",
        "PR/main workflow run",
    ),
    "playwright-smoke": (
        "stage0-rev2-playwright-smoke.json",
        "ci_playwright_smoke",
        "Playwright smoke",
    ),
    "docker-image-build": (
        "stage0-rev2-docker-image-build.json",
        "ci_docker_image_build",
        "Docker image build",
    ),
}


def git_sha() -> str:
    value = os.environ.get("GITHUB_SHA")
    if value:
        return value
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


def git_ref() -> str:
    return os.environ.get("GITHUB_REF") or subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=ROOT,
        text=True,
    ).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=sorted(KINDS), required=True)
    parser.add_argument("--status", required=True)
    parser.add_argument("--job", required=True)
    parser.add_argument("--step", required=True)
    parser.add_argument("--exit-code", type=int, default=0)
    parser.add_argument("--details", action="append", default=[])
    parser.add_argument("--evidence-ref", action="append", default=[])
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    args = parser.parse_args()

    filename, check_id, label = KINDS[args.kind]
    status = "passed" if args.status in {"success", "passed", "pass"} and args.exit_code == 0 else "failed"
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    evidence_refs = [
        ".github/workflows/stage0-rev2-ci.yml",
        "ops/ci/stage0-rev2-ci.yml",
        *args.evidence_ref,
    ]
    evidence_refs = sorted(dict.fromkeys(evidence_refs))

    payload = {
        "schema_version": "stage0.rev2.ci_runtime",
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "environment": "ci",
        "release_gate_check_id": check_id,
        "status": status,
        "kind": args.kind,
        "label": label,
        "created_at": now,
        "created_by": "github-actions",
        "repository": os.environ.get("GITHUB_REPOSITORY", "alphane-ai/zenart"),
        "workflow": os.environ.get("GITHUB_WORKFLOW", "Stage 0 Rev2 CI"),
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "job": args.job,
        "step": args.step,
        "event_name": os.environ.get("GITHUB_EVENT_NAME"),
        "ref": git_ref(),
        "sha": git_sha(),
        "exit_code": args.exit_code,
        "details": args.details,
        "evidence_refs": evidence_refs,
        "preserved_blockers": [] if status == "passed" else [f"{check_id}_failed"],
    }
    if args.kind == "workflow-run":
        payload["pr_or_main_semantics"] = {
            "event_name": os.environ.get("GITHUB_EVENT_NAME"),
            "is_pull_request": os.environ.get("GITHUB_EVENT_NAME") == "pull_request",
            "is_main": git_ref() in {"refs/heads/main", "main"},
        }
    if args.kind == "playwright-smoke":
        payload["playwright_semantics"] = {
            "runtime_wrapper": "scripts/playwright_smoke.sh",
            "spec": "ops/ci/playwright-smoke.spec.ts",
        }
    if args.kind == "docker-image-build":
        payload["docker_image_build_semantics"] = {
            "sha_tagged": True,
            "images": ["backend", "web", "admin"],
        }

    path = out_dir / filename
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(path.relative_to(ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
