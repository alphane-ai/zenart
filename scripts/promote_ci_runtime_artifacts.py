#!/usr/bin/env python3
"""Promote downloaded Stage 0 Rev2 GitHub Actions CI artifacts into canonical evidence.

This script is intentionally strict: it refuses local/non-PR-main evidence and
does not create pass evidence unless the downloaded artifact set proves the
installed workflow run, Playwright smoke, and all Docker image builds passed.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = ROOT / "ops" / "evidence" / "ci"
EXPECTED_SCHEMA = "stage0.rev2.ci_runtime_evidence"
EXPECTED_SCOPE = "installed_pr_main_workflow_runtime"
EXPECTED_WORKFLOW_PATH = ".github/workflows/stage0-rev2-ci.yml"
EXPECTED_STATUS = "passed"

CANONICAL_OUTPUTS = {
    "workflow-run": ("ci_gate_runtime_execution", "stage0-rev2-pr-main-run.json"),
    "playwright-smoke": ("ci_playwright_smoke", "stage0-rev2-playwright-smoke.json"),
    "docker-image-build": ("ci_docker_image_build", "stage0-rev2-docker-image-build.json"),
}
REQUIRED_DOCKER_IMAGES = {"backend", "web", "admin"}


class PromotionError(Exception):
    pass


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise PromotionError(f"{rel(path)} is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise PromotionError(f"{rel(path)} must contain a JSON object")
    return data


def is_pr_or_main_event(evidence: dict[str, Any]) -> bool:
    workflow = evidence.get("workflow")
    if not isinstance(workflow, dict):
        return False
    event_name = workflow.get("event_name")
    ref_name = workflow.get("ref_name")
    ref = workflow.get("ref")
    if event_name == "pull_request":
        return True
    if event_name == "push" and (ref_name == "main" or ref == "refs/heads/main"):
        return True
    return False


def workflow_identity(evidence: dict[str, Any]) -> tuple[str, str, str]:
    workflow = evidence.get("workflow")
    if not isinstance(workflow, dict):
        raise PromotionError("CI runtime evidence lacks workflow object")
    run_id = str(workflow.get("run_id") or "")
    run_attempt = str(workflow.get("run_attempt") or "")
    sha = str(workflow.get("sha") or "")
    if run_id in {"", "local"}:
        raise PromotionError("CI runtime evidence must come from a real GitHub Actions run_id")
    if sha in {"", "unknown"}:
        raise PromotionError("CI runtime evidence must include a real workflow sha")
    return run_id, run_attempt, sha


def validate_base(path: Path, evidence: dict[str, Any], kind: str, check_id: str) -> None:
    if evidence.get("schema_version") != EXPECTED_SCHEMA:
        raise PromotionError(f"{rel(path)} has wrong schema_version={evidence.get('schema_version')!r}")
    if evidence.get("environment") != "ci":
        raise PromotionError(f"{rel(path)} must declare environment='ci'")
    if evidence.get("scope") != EXPECTED_SCOPE:
        raise PromotionError(f"{rel(path)} has wrong scope={evidence.get('scope')!r}")
    if evidence.get("kind") != kind:
        raise PromotionError(f"{rel(path)} has wrong kind={evidence.get('kind')!r}; expected {kind!r}")
    if evidence.get("release_gate_check_id") != check_id:
        raise PromotionError(
            f"{rel(path)} targets release_gate_check_id={evidence.get('release_gate_check_id')!r}; "
            f"expected {check_id!r}"
        )
    if evidence.get("status") != EXPECTED_STATUS:
        raise PromotionError(f"{rel(path)} must be passed; got status={evidence.get('status')!r}")
    if int(evidence.get("exit_code", 0)) != 0:
        raise PromotionError(f"{rel(path)} must have exit_code=0")
    workflow = evidence.get("workflow")
    if not isinstance(workflow, dict) or workflow.get("path") != EXPECTED_WORKFLOW_PATH:
        raise PromotionError(f"{rel(path)} must cite workflow path {EXPECTED_WORKFLOW_PATH}")
    if not is_pr_or_main_event(evidence):
        raise PromotionError(f"{rel(path)} is not from a pull_request or main push workflow event")
    workflow_identity(evidence)


def docker_image_name(evidence: dict[str, Any]) -> str | None:
    candidates = [str(evidence.get("step") or ""), *[str(item) for item in evidence.get("details", [])]]
    for image in REQUIRED_DOCKER_IMAGES:
        if any(image in candidate for candidate in candidates):
            return image
    return None


def collect_artifacts(input_dir: Path) -> dict[str, list[tuple[Path, dict[str, Any]]]]:
    if not input_dir.exists():
        raise PromotionError(f"input artifact directory does not exist: {input_dir}")
    collected: dict[str, list[tuple[Path, dict[str, Any]]]] = {
        kind: [] for kind in CANONICAL_OUTPUTS
    }
    for path in sorted(input_dir.rglob("*.json")):
        evidence = load_json(path)
        kind = evidence.get("kind")
        if kind in collected and evidence.get("schema_version") == EXPECTED_SCHEMA:
            collected[kind].append((path, evidence))
    return collected


def choose_workflow_evidence(items: list[tuple[Path, dict[str, Any]]]) -> tuple[Path, dict[str, Any]]:
    check_id, _ = CANONICAL_OUTPUTS["workflow-run"]
    for path, evidence in items:
        try:
            validate_base(path, evidence, "workflow-run", check_id)
        except PromotionError:
            continue
        return path, evidence
    raise PromotionError("no passed PR/main workflow-run CI evidence found in input artifacts")


def choose_playwright_evidence(items: list[tuple[Path, dict[str, Any]]]) -> tuple[Path, dict[str, Any]]:
    check_id, _ = CANONICAL_OUTPUTS["playwright-smoke"]
    for path, evidence in items:
        try:
            validate_base(path, evidence, "playwright-smoke", check_id)
        except PromotionError:
            continue
        return path, evidence
    raise PromotionError("no passed PR/main Playwright smoke CI evidence found in input artifacts")


def choose_docker_evidence(items: list[tuple[Path, dict[str, Any]]]) -> dict[str, tuple[Path, dict[str, Any]]]:
    check_id, _ = CANONICAL_OUTPUTS["docker-image-build"]
    by_image: dict[str, tuple[Path, dict[str, Any]]] = {}
    for path, evidence in items:
        try:
            validate_base(path, evidence, "docker-image-build", check_id)
        except PromotionError:
            continue
        image = docker_image_name(evidence)
        if image is not None:
            by_image.setdefault(image, (path, evidence))
    missing = REQUIRED_DOCKER_IMAGES - set(by_image)
    if missing:
        raise PromotionError(f"missing passed PR/main Docker image evidence for: {sorted(missing)}")
    return by_image


def canonical_payload(
    kind: str,
    check_id: str,
    source_paths: list[Path],
    evidences: list[dict[str, Any]],
) -> dict[str, Any]:
    run_ids = {workflow_identity(evidence)[0] for evidence in evidences}
    attempts = {workflow_identity(evidence)[1] for evidence in evidences}
    shas = {workflow_identity(evidence)[2] for evidence in evidences}
    if len(run_ids) != 1:
        raise PromotionError(f"{kind} canonical evidence must come from one workflow run; got {sorted(run_ids)}")
    if len(shas) != 1:
        raise PromotionError(f"{kind} canonical evidence must come from one sha; got {sorted(shas)}")
    workflow = evidences[0]["workflow"]
    payload: dict[str, Any] = {
        "schema_version": EXPECTED_SCHEMA,
        "evidence_id": f"ci_{kind.replace('-', '_')}_{next(iter(run_ids))}_{next(iter(attempts))}_canonical",
        "created_at": utc_stamp(),
        "created_by_lane": "main-session",
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "blueprint_sections": ["25.20"],
        "environment": "ci",
        "release_gate_check_id": check_id,
        "scope": EXPECTED_SCOPE,
        "kind": kind,
        "status": EXPECTED_STATUS,
        "exit_code": 0,
        "workflow": workflow,
        "source_artifacts": [rel(path) for path in source_paths],
        "evidence_refs": sorted({ref for evidence in evidences for ref in evidence.get("evidence_refs", [])}),
        "runtime_claims": {
            "pr_main_workflow_run": "real GitHub Actions pull_request or main push run",
            "installed_pr_main_playwright_smoke": kind == "playwright-smoke",
            "installed_pr_main_docker_image_build": kind == "docker-image-build",
        },
    }
    if kind == "docker-image-build":
        payload["docker_images"] = sorted(REQUIRED_DOCKER_IMAGES)
    return payload


def write_payload(out_dir: Path, file_name: str, payload: dict[str, Any], dry_run: bool) -> Path:
    path = out_dir / file_name
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input-dir",
        required=True,
        help="Directory containing downloaded GitHub Actions evidence artifacts.",
    )
    parser.add_argument("--out-dir", default=str(DEFAULT_OUT_DIR), help="Canonical CI evidence output directory.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print planned outputs without writing.")
    parser.add_argument(
        "--copy-raw",
        action="store_true",
        help="Also copy validated source JSON files into a raw/ subdirectory for auditability.",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    input_dir = Path(args.input_dir)
    if not input_dir.is_absolute():
        input_dir = ROOT / input_dir
    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = ROOT / out_dir

    try:
        collected = collect_artifacts(input_dir)
        workflow_path, workflow_evidence = choose_workflow_evidence(collected["workflow-run"])
        playwright_path, playwright_evidence = choose_playwright_evidence(collected["playwright-smoke"])
        docker_by_image = choose_docker_evidence(collected["docker-image-build"])

        selected: dict[str, tuple[list[Path], list[dict[str, Any]]]] = {
            "workflow-run": ([workflow_path], [workflow_evidence]),
            "playwright-smoke": ([playwright_path], [playwright_evidence]),
            "docker-image-build": (
                [item[0] for item in docker_by_image.values()],
                [item[1] for item in docker_by_image.values()],
            ),
        }

        outputs: list[Path] = []
        for kind, (check_id, file_name) in CANONICAL_OUTPUTS.items():
            source_paths, evidences = selected[kind]
            payload = canonical_payload(kind, check_id, source_paths, evidences)
            outputs.append(write_payload(out_dir, file_name, payload, args.dry_run))

        if args.copy_raw and not args.dry_run:
            raw_dir = out_dir / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            for source_paths, _ in selected.values():
                for source_path in source_paths:
                    shutil.copy2(source_path, raw_dir / source_path.name)

    except PromotionError as exc:
        print(f"CI runtime artifact promotion blocked: {exc}", file=sys.stderr)
        return 2

    prefix = "would write" if args.dry_run else "wrote"
    for path in outputs:
        print(f"{prefix} {rel(path)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
