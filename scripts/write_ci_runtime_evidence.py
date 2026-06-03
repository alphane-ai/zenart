#!/usr/bin/env python3
"""Write Stage 0 Rev2 installed CI runtime evidence JSON."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "ops" / "evidence" / "ci"
RELEASE_GATE_CHECK_IDS = {
    "workflow-run": "ci_gate_runtime_execution",
    "playwright-smoke": "ci_playwright_smoke",
    "docker-image-build": "ci_docker_image_build",
}


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def git_sha() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def slug(value: str) -> str:
    normalized = re.sub(r"[^A-Za-z0-9_.-]+", "-", value.strip().lower()).strip("-")
    return normalized or "unspecified"


def normalize_status(value: str) -> str:
    normalized = value.strip().lower().replace("_", "-")
    return {
        "success": "passed",
        "pass": "passed",
        "ok": "passed",
        "failure": "failed",
        "fail": "failed",
        "cancelled": "blocked-cancelled",
        "canceled": "blocked-cancelled",
        "skipped": "blocked-skipped",
        "timed-out": "failed",
        "timed_out": "failed",
        "timeout": "failed",
    }.get(normalized, normalized or "unknown")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--kind",
        required=True,
        choices=("workflow-run", "playwright-smoke", "docker-image-build"),
        help="Evidence category to write.",
    )
    parser.add_argument("--status", required=True, help="Runtime result status.")
    parser.add_argument("--job", default="", help="GitHub Actions job name.")
    parser.add_argument("--step", default="", help="GitHub Actions step name.")
    parser.add_argument("--exit-code", type=int, default=0, help="Observed command exit code.")
    parser.add_argument("--details", action="append", default=[], help="Additional detail string.")
    parser.add_argument("--evidence-ref", action="append", default=[], help="Related evidence path.")
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Output evidence directory.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    status = normalize_status(args.status)
    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    stamp = utc_stamp()
    sha = env("GITHUB_SHA") or git_sha()
    run_id = env("GITHUB_RUN_ID", "local")
    run_attempt = env("GITHUB_RUN_ATTEMPT", "0")
    ref_name = env("GITHUB_REF_NAME") or env("GITHUB_REF", "local")
    event_name = env("GITHUB_EVENT_NAME", "local")

    payload: dict[str, Any] = {
        "schema_version": "stage0.rev2.ci_runtime_evidence",
        "evidence_id": (
            f"ci_{args.kind.replace('-', '_')}_{run_id}_{run_attempt}_"
            f"{slug(args.job)}_{slug(args.step)}"
        ),
        "created_at": stamp,
        "created_by_lane": "lane20",
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "blueprint_sections": ["25.17", "25.20"],
        "environment": "ci",
        "release_gate_check_id": RELEASE_GATE_CHECK_IDS[args.kind],
        "scope": "installed_pr_main_workflow_runtime",
        "kind": args.kind,
        "status": status,
        "exit_code": args.exit_code,
        "workflow": {
            "name": env("GITHUB_WORKFLOW", "Stage 0 Rev2 CI"),
            "path": ".github/workflows/stage0-rev2-ci.yml",
            "event_name": event_name,
            "ref": env("GITHUB_REF", "local"),
            "ref_name": ref_name,
            "sha": sha,
            "run_id": run_id,
            "run_attempt": run_attempt,
            "server_url": env("GITHUB_SERVER_URL"),
            "repository": env("GITHUB_REPOSITORY"),
        },
        "job": args.job,
        "step": args.step,
        "details": args.details,
        "evidence_refs": args.evidence_ref,
        "runtime_claims": {
            "pr_main_workflow_run": "pr/main workflow run claimed by installed workflow event"
            if event_name in {"pull_request", "push"}
            else "local_or_non_pr_main_event",
            "installed_pr_main_playwright_smoke": "installed pr/main playwright smoke claimed by this evidence"
            if args.kind == "playwright-smoke"
            else "not_this_evidence_kind",
            "installed_pr_main_docker_image_build": "installed pr/main docker image build claimed by this evidence"
            if args.kind == "docker-image-build"
            else "not_this_evidence_kind",
        },
    }

    file_name = f"{stamp}-{args.kind}-{run_id}-{run_attempt}-{slug(args.job)}-{slug(args.step)}.json"
    path = out_dir / file_name
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        print(path.relative_to(ROOT))
    except ValueError:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
