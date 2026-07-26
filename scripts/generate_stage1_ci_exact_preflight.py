#!/usr/bin/env python3
"""Generate non-clearing Stage 1 CI exact evidence preflight.

This preflight checks whether the local workflow and GitHub Actions metadata are
ready to produce exact CI evidence. It never writes the canonical pass artifacts
and cannot clear CI, staging, production, or launch gates.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "ci_exact" / "local_contract.json"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "ci" / "stage1-ci-exact.preflight.json"
WORKFLOW = ROOT / ".github" / "workflows" / "stage0-rev2-ci.yml"
OPS_CI = ROOT / "ops" / "ci" / "stage0-rev2-ci.yml"
PLAYWRIGHT_SPEC = ROOT / "ops" / "ci" / "playwright-smoke.spec.ts"
PR_WRITER = ROOT / "scripts" / "write_stage1_ci_pr_main_evidence.py"
PLAYWRIGHT_WRITER = ROOT / "scripts" / "write_stage1_ci_playwright_evidence.py"
DOCKER_WRITER = ROOT / "scripts" / "write_stage1_ci_docker_evidence.py"
DOCKER_SMOKE = ROOT / "scripts" / "docker_build_smoke.sh"
PLAYWRIGHT_SMOKE = ROOT / "scripts" / "playwright_smoke.sh"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
RUN_ID_RE = re.compile(r"^[0-9]+$")
REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
RUN_URL_RE = re.compile(r"^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/actions/runs/[0-9]+$")
RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|X-Amz-Signature|GoogleAccessId)"
)

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


class CiExactPreflightError(Exception):
    pass


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CiExactPreflightError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise CiExactPreflightError(f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "preflight")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in {
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
                "raw_prompt",
                "raw_provider_payload",
                "raw_stripe_payload",
                "raw_payload",
                "raw_response",
                "download_url",
                "signed_url",
            }:
                raise CiExactPreflightError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise CiExactPreflightError(f"{path} contains raw secret-looking material")


def env_or_arg(value: str, env_name: str) -> str:
    return (value or os.environ.get(env_name) or "").strip()


def current_git_head() -> str:
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (OSError, subprocess.CalledProcessError):
        return ""
    return completed.stdout.strip().lower()


def git_worktree_status() -> dict[str, Any]:
    try:
        completed = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=ROOT,
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError:
        return {
            "available": False,
            "clean": False,
            "changed_file_count": 0,
            "sample_changed_files": [],
        }
    rows = [line for line in completed.stdout.splitlines() if line.strip()]
    sample = []
    for row in rows[:12]:
        path = row[3:] if len(row) > 3 else row
        sample.append(path)
    return {
        "available": completed.returncode == 0,
        "clean": completed.returncode == 0 and not rows,
        "changed_file_count": len(rows),
        "sample_changed_files": sample,
    }


def file_ready(path: Path, required_snippets: tuple[str, ...] = ()) -> dict[str, Any]:
    exists = path.exists()
    executable = os.access(path, os.X_OK) if exists and path.suffix in {".py", ".sh"} else True
    snippets_present: list[str] = []
    missing_snippets: list[str] = []
    if exists and required_snippets:
        text = path.read_text(encoding="utf-8", errors="ignore")
        for snippet in required_snippets:
            if snippet in text:
                snippets_present.append(snippet)
            else:
                missing_snippets.append(snippet)
    return {
        "path": display_path(path),
        "exists": exists,
        "executable": executable,
        "required_snippets_present": snippets_present,
        "missing_snippets": missing_snippets,
        "ready": exists and executable and not missing_snippets,
    }


def build_run_url(repository: str, run_id: str) -> str:
    if not repository or not run_id:
        return ""
    return f"https://github.com/{repository}/actions/runs/{run_id}"


def build_preflight(args: argparse.Namespace) -> dict[str, Any]:
    explicit_release_sha = env_or_arg(args.release_sha, "GITHUB_SHA").lower()
    git_head = current_git_head()
    worktree = git_worktree_status()
    release_sha = explicit_release_sha or git_head
    run_id = env_or_arg(args.run_id, "GITHUB_RUN_ID")
    repository = env_or_arg(args.repository, "GITHUB_REPOSITORY")
    run_url = (args.run_url or build_run_url(repository, run_id)).strip()
    event_name = env_or_arg(args.event_name, "GITHUB_EVENT_NAME")
    ref = env_or_arg(args.ref, "GITHUB_REF")
    base_ref = env_or_arg(args.base_ref, "GITHUB_BASE_REF")
    head_ref = env_or_arg(args.head_ref, "GITHUB_HEAD_REF")

    checks = {
        "release_sha_full_length": bool(RELEASE_SHA_RE.fullmatch(release_sha)),
        "github_run_id_present": bool(RUN_ID_RE.fullmatch(run_id)),
        "github_repository_present": bool(REPOSITORY_RE.fullmatch(repository)),
        "github_run_url_actions": bool(RUN_URL_RE.fullmatch(run_url)),
        "trigger_targets_main": event_name in {"pull_request", "push", "workflow_dispatch"} and (base_ref == "main" or ref == "refs/heads/main"),
        "git_worktree_clean": worktree.get("clean") is True,
    }
    anchors = {
        "workflow": file_ready(WORKFLOW, ("write_stage1_ci_pr_main_evidence.py", "write_stage1_ci_playwright_evidence.py", "write_stage1_ci_docker_evidence.py")),
        "ops_ci": file_ready(OPS_CI, ("stage0-rev2-pr-main-run.json", "stage0-rev2-playwright-smoke.json", "stage0-rev2-docker-image-build.json")),
        "playwright_spec": file_ready(PLAYWRIGHT_SPEC, ("billing smoke validates quota", "workspace smoke validates core workspace shell")),
        "pr_main_writer": file_ready(PR_WRITER, ("stage1.ci_pr_main_run.v1", "canonical_pass_path")),
        "playwright_writer": file_ready(PLAYWRIGHT_WRITER, ("stage1.ci_playwright_smoke.v1", "safe_projection")),
        "docker_writer": file_ready(DOCKER_WRITER, ("stage1.ci_docker_image_build.v1", "sha256:")),
        "docker_smoke": file_ready(DOCKER_SMOKE, ("docker build", "backend", "web", "admin")),
        "playwright_smoke": file_ready(PLAYWRIGHT_SMOKE, ("ops/ci/playwright-smoke.spec.ts", "WEB_URL", "ADMIN_URL")),
    }
    checks["installed_workflow_ready"] = anchors["workflow"]["ready"] is True
    checks["ops_ci_shadow_ready"] = anchors["ops_ci"]["ready"] is True
    checks["writer_scripts_ready"] = all(
        anchors[key]["ready"] is True for key in ("pr_main_writer", "playwright_writer", "docker_writer")
    )
    checks["smoke_sources_ready"] = all(
        anchors[key]["ready"] is True for key in ("playwright_spec", "docker_smoke", "playwright_smoke")
    )

    blocked_checks = [key for key, ready in checks.items() if ready is not True]
    status = "ready" if not blocked_checks else "blocked"
    canonical_artifacts = {
        "pr_main_run": "ops/evidence/ci/stage0-rev2-pr-main-run.json",
        "playwright_smoke": "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
        "docker_image_build": "ops/evidence/ci/stage0-rev2-docker-image-build.json",
    }
    report: dict[str, Any] = {
        "schema_version": "stage1.ci_exact.preflight.v1",
        "environment": "ci",
        "kind": "ci_exact_evidence_preflight",
        "status": status,
        "release_gate_check_id": "ci_exact_evidence",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "preflight_report": "ops/evidence/ci/stage1-ci-exact.preflight.json",
        "canonical_artifacts": canonical_artifacts,
        "canonical_evidence_ready": False,
        "canonical_pass_path": False,
        "can_clear_ci_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "checks": checks,
        "blocked_checks": blocked_checks,
        "workflow_run_summary": {
            "release_sha": release_sha,
            "release_sha_source": "explicit" if explicit_release_sha else ("git_head" if git_head else "missing"),
            "current_git_head": git_head,
            "current_git_head_match": bool(git_head and release_sha == git_head),
            "git_worktree_clean": worktree.get("clean") is True,
            "git_worktree_changed_file_count": worktree.get("changed_file_count", 0),
            "git_worktree_sample_changed_files": worktree.get("sample_changed_files", []),
            "run_id": run_id,
            "repository": repository,
            "run_url": run_url,
            "event_name": event_name,
            "ref": ref,
            "base_ref": base_ref,
            "head_ref": head_ref,
        },
        "anchors": anchors,
        "next_command_contract": {
            "workflow": ".github/workflows/stage0-rev2-ci.yml",
            "requires_github_actions": True,
            "required_exact_artifacts": list(canonical_artifacts.values()),
            "strict_validator": "python3 scripts/validate_stage1_ci_exact_evidence.py",
        },
        "safe_projection_policy": {field: False for field in SAFE_FALSE_FIELDS},
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate non-clearing Stage 1 CI exact evidence preflight")
    parser.add_argument("--contract-only", action="store_true", help="validate generator contract anchors only")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--release-sha", default="", help="full release SHA; defaults to GITHUB_SHA")
    parser.add_argument("--run-id", default="", help="GitHub Actions run id; defaults to GITHUB_RUN_ID")
    parser.add_argument("--repository", default="", help="GitHub repository owner/name; defaults to GITHUB_REPOSITORY")
    parser.add_argument("--run-url", default="", help="GitHub Actions run URL; defaults to repository/run id")
    parser.add_argument("--event-name", default="", help="GitHub event name; defaults to GITHUB_EVENT_NAME")
    parser.add_argument("--ref", default="", help="Git ref; defaults to GITHUB_REF")
    parser.add_argument("--base-ref", default="", help="PR base ref; defaults to GITHUB_BASE_REF")
    parser.add_argument("--head-ref", default="", help="PR head ref; defaults to GITHUB_HEAD_REF")
    return parser.parse_args()


def validate_contract_anchors() -> None:
    contract = load_json(CONTRACT)
    if contract.get("preflight_evidence_path") != "ops/evidence/ci/stage1-ci-exact.preflight.json":
        raise CiExactPreflightError("CI exact contract preflight_evidence_path mismatch")
    policy = contract.get("preflight_policy")
    if not isinstance(policy, dict):
        raise CiExactPreflightError("CI exact contract preflight_policy must be object")
    if policy.get("status_ready_does_not_clear_gate") is not True:
        raise CiExactPreflightError("CI exact preflight ready must not clear gate")
    if policy.get("canonical_artifacts_written") is not False:
        raise CiExactPreflightError("CI exact preflight must not write canonical artifacts")
    if policy.get("requires_github_actions_for_strict_evidence") is not True:
        raise CiExactPreflightError("CI exact preflight must require GitHub Actions for strict evidence")


def main() -> int:
    args = parse_args()
    try:
        validate_contract_anchors()
        if args.contract_only:
            print("stage1 CI exact preflight generator contract passed")
            return 0
        report = build_preflight(args)
        write_json(args.output.resolve(), report)
    except CiExactPreflightError as exc:
        print(f"generate Stage 1 CI exact preflight failed: {exc}", file=sys.stderr)
        return 1
    print(f"wrote Stage 1 CI exact preflight to {display_path(args.output.resolve())}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
