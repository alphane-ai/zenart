#!/usr/bin/env python3
"""Normalize a passed Playwright smoke report into exact Stage 1 CI evidence."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_REF = "ops/evidence/ci/stage0-rev2-playwright-smoke.json"
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
REQUIRED_COVERAGE = {
    "user_web",
    "admin_web",
    "billing",
    "workspace",
}


class PlaywrightEvidenceError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PlaywrightEvidenceError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PlaywrightEvidenceError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def normalize_status(value: Any) -> str:
    require(isinstance(value, str), "status must be a string")
    normalized = value.strip().lower()
    require(normalized in {"pass", "passed"}, f"status must be pass/passed, got {value!r}")
    return "pass"


def require_ref_list(value: Any, path: str) -> list[str]:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    refs: list[str] = []
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")
        refs.append(item.strip())
    return refs


def normalize_coverage(report: dict[str, Any]) -> dict[str, Any]:
    coverage = report.get("coverage")
    require(isinstance(coverage, dict), "source report coverage must be an object")
    missing = REQUIRED_COVERAGE - set(coverage)
    require(not missing, f"source report missing coverage sections: {sorted(missing)}")
    normalized: dict[str, Any] = {}
    for key in sorted(REQUIRED_COVERAGE):
        section = coverage.get(key)
        require(isinstance(section, dict), f"coverage.{key} must be an object")
        refs = require_ref_list(section.get("evidence_refs"), f"coverage.{key}.evidence_refs")
        row: dict[str, Any] = {
            "status": normalize_status(section.get("status")),
            "evidence_refs": refs,
        }
        if isinstance(section.get("url"), str) and section["url"].strip():
            row["url"] = section["url"].strip()
        normalized[key] = row
    return normalized


def validate_source_report(report: dict[str, Any]) -> None:
    normalize_status(report.get("status"))
    require(report.get("exit_code") == 0, "source report exit_code must be 0")
    require(report.get("spec_path") == "ops/ci/playwright-smoke.spec.ts", "source report spec_path mismatch")
    safe_projection = report.get("safe_projection")
    require(isinstance(safe_projection, dict), "source report safe_projection must be an object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_projection.get(field) is False, f"source report safe_projection.{field} must be false")


def build_run_url(repository: str | None, run_id: str | None) -> str:
    if not repository or not run_id:
        return ""
    return f"https://github.com/{repository}/actions/runs/{run_id}"


def build_evidence(args: argparse.Namespace) -> dict[str, Any]:
    source = args.source.resolve()
    require(source.exists(), f"missing source report: {display_path(source)}")
    report = load_json(source)
    validate_source_report(report)

    release_sha = (args.release_sha or os.environ.get("GITHUB_SHA") or "").strip().lower()
    require(RELEASE_SHA_RE.fullmatch(release_sha) is not None, "release SHA must be full lowercase 40-character hex")

    run_id = (args.run_id or os.environ.get("GITHUB_RUN_ID") or "").strip()
    run_url = (args.run_url or build_run_url(os.environ.get("GITHUB_REPOSITORY"), run_id)).strip()
    require(run_id, "workflow run id is required")
    require(RUN_URL_RE.match(run_url) is not None, "workflow run URL must be a GitHub Actions run URL")

    output_path = args.output.resolve()
    evidence_refs = [
        display_path(source),
        str(report.get("log_path", "")).strip(),
        "ops/ci/playwright-smoke.spec.ts",
        "scripts/playwright_smoke.sh",
    ]
    evidence_refs = [ref for ref in evidence_refs if ref]

    evidence: dict[str, Any] = {
        "schema_version": "stage1.ci_playwright_smoke.v1",
        "environment": "ci",
        "kind": "ci_playwright_smoke",
        "status": "pass",
        "release_gate_check_id": "ci_playwright_smoke",
        "release_sha": release_sha,
        "canonical_pass_path": output_path == DEFAULT_OUTPUT.resolve(),
        "dry_run": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "workflow_run": {
            "run_id": run_id,
            "run_url": run_url,
            "workflow_file": WORKFLOW_FILE,
            "conclusion": "success",
        },
        "trigger": {
            "event_name": os.environ.get("GITHUB_EVENT_NAME", ""),
            "ref": os.environ.get("GITHUB_REF", ""),
            "base_ref": os.environ.get("GITHUB_BASE_REF", ""),
            "head_ref": os.environ.get("GITHUB_HEAD_REF", ""),
        },
        "source_report": display_path(source),
        "web_url": report.get("web_url"),
        "admin_url": report.get("admin_url"),
        "spec_path": report.get("spec_path"),
        "evidence_refs": evidence_refs,
        "coverage": normalize_coverage(report),
        "gate_impact": {
            "release_gate_check_id": "ci_playwright_smoke",
            "can_clear_ci_gate_check": True,
        },
    }
    for field in SAFE_FALSE_FIELDS:
        evidence[field] = False
    return evidence


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Write exact Stage 1 CI Playwright smoke evidence")
    parser.add_argument("--source", type=Path, required=True, help="source JSON from scripts/playwright_smoke.sh")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="canonical CI Playwright evidence path")
    parser.add_argument("--release-sha", default="", help="full release SHA; defaults to GITHUB_SHA")
    parser.add_argument("--run-id", default="", help="GitHub Actions run id; defaults to GITHUB_RUN_ID")
    parser.add_argument("--run-url", default="", help="GitHub Actions run URL; defaults to GITHUB_REPOSITORY/GITHUB_RUN_ID")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        evidence = build_evidence(args)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except PlaywrightEvidenceError as exc:
        print(f"write Stage 1 CI Playwright evidence failed: {exc}", file=sys.stderr)
        return 1
    print(f"wrote Stage 1 CI Playwright evidence to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
