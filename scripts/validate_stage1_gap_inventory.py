#!/usr/bin/env python3
"""Validate the Stage 1 gap inventory current blocker snapshot."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
REFRESH = ROOT / "ops" / "evidence" / "non_clearing" / "production-non-clearing-refresh.json"
BRIEF = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
MISSING_INPUTS = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"
ACTION_MATRIX = ROOT / "ops" / "evidence" / "non_clearing" / "production-action-matrix.json"
EXTERNAL_READINESS = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-external-resource-readiness.preflight.json"
STAGING_RUNTIME = ROOT / "ops" / "evidence" / "staging" / "stage1-runtime.json"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"


class Stage1GapInventoryError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1GapInventoryError(message)


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
        raise Stage1GapInventoryError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def require_snippets(text: str, snippets: tuple[str, ...], *, source: str) -> None:
    for snippet in snippets:
        require(snippet in text, f"{source} missing required snippet {snippet!r}")


def pct(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.1f}"
    return str(value)


def validate_current_snapshot() -> None:
    inventory = read_text(GAP_INVENTORY)
    refresh = load_json(REFRESH)
    brief = load_json(BRIEF)
    missing = load_json(MISSING_INPUTS)
    runbook = load_json(SOURCE_RUNBOOK)
    matrix = load_json(ACTION_MATRIX)
    external = load_json(EXTERNAL_READINESS)
    staging = load_json(STAGING_RUNTIME)

    brief_summary = brief.get("summary") or {}
    missing_summary = missing.get("summary") or {}
    runbook_summary = runbook.get("summary") or {}
    refresh_steps = refresh.get("step_summary") or {}
    refresh_progress = refresh.get("progress") if isinstance(refresh.get("progress"), dict) else {}
    refresh_stage1 = refresh_progress.get("stage1") if isinstance(refresh_progress.get("stage1"), dict) else {}
    external_summary = external.get("resource_summary") or {}

    require(staging.get("status") == "pass", "staging runtime status must be pass for the current snapshot")
    require(staging.get("release_gate_decision") == "go", "staging runtime release gate decision must be go for the current snapshot")
    require(brief.get("release_gate_decision") == "no_go", "production operator brief must remain no_go")
    require(refresh.get("release_gate_decision") == "no_go", "non-clearing refresh must remain no_go")
    require(refresh.get("non_clearing_refresh") is True, "refresh must be non-clearing")
    require(refresh.get("dns_apply_requested") is False, "refresh must not request DNS apply")
    require(refresh.get("canonical_sources_requested") is False, "refresh must not write canonical sources")

    expected = (
        "## Current Production Launch Snapshot",
        "Status: current blocker inventory, not launch evidence.",
        f"Snapshot source: `{display_path(REFRESH)}`.",
        "Refresh command: `python3 scripts/refresh_stage1_production_non_clearing_evidence.py`.",
        "Validator command: `python3 scripts/validate_stage1_production_non_clearing_refresh.py`.",
        (
            f"- Stage1 gates: `{refresh_stage1['completed']}/{refresh_stage1['total']} = "
            f"{pct(refresh_stage1['completion_percent'])}%`; release decision `{refresh_stage1['release_gate_decision']}`."
        ),
        f"- Staging runtime: `{staging['status']} / {staging['release_gate_decision']}`.",
        (
            f"- External resources: `{external_summary['ready']}/{external_summary['total']} = "
            f"{pct(external_summary['ready_percent'])}%`."
        ),
        (
            f"- Production required inputs: `{missing_summary['required_configured']}/{missing_summary['required_total']} = "
            f"{pct(missing_summary['required_completion_percent'])}%`; missing `{missing_summary['required_missing']}`, "
            f"invalid `{missing_summary['required_invalid']}`, blocking `{missing_summary['blocking_input_count']}`."
        ),
        (
            f"- Production source probes: `{runbook_summary['ready_to_execute_count']}/{runbook_summary['runbook_step_count']}` ready, "
            f"`{runbook_summary['blocked_step_count']}` blocked, `{runbook_summary['blocking_input_count']}` blocking inputs."
        ),
        (
            f"- Non-clearing refresh steps: `{refresh_steps['passed']}/{refresh_steps['total']}` passed, "
            f"`{refresh_steps['blocked']}` blocked, `{refresh_steps['failed']}` failed, "
            f"`{refresh_steps['unexpected_exit_count']}` unexpected exits."
        ),
        "Non-current blockers:",
        "- R2 bucket `zenari`: not current blocker.",
        "- Stripe sandbox: not current blocker; production live evidence is still required.",
        "- z.ai/OpenAI-compatible provider: not current blocker.",
        "- Staging Azure and local dev ports: not current blockers for production launch.",
        "- `worker` / `crawler` / `migrate`: backend runtime entrypoints only, not release images.",
        "- `manager`: legacy local-only, not release surface.",
        "Staging/preflight evidence does not clear production gates. Production launch remains `no_go` until strict production evidence passes.",
        (
            "Release images remain closed to `web`, `admin`, and `backend`; `worker`, `crawler`, and `migrate` "
            "stay backend runtime targets, and `manager` stays legacy local-only."
        ),
    )
    require_snippets(inventory, expected, source=display_path(GAP_INVENTORY))

    lanes = matrix.get("lanes")
    require(isinstance(lanes, list) and lanes, "production action matrix must contain lanes")
    for lane in lanes:
        require(isinstance(lane, dict), "production action matrix lane must be object")
        lane_id = lane.get("lane_id")
        snippet = (
            f"- `{lane_id}`: `{pct(lane['completion_percent'])}%`, blockers `{lane['blocking_input_count']}`, "
            f"first blocker `{lane['first_blocker']}`."
        )
        require(snippet in inventory, f"{display_path(GAP_INVENTORY)} missing lane snapshot for {lane_id}")


def validate_cross_refs() -> None:
    inventory = read_text(GAP_INVENTORY)
    blueprint = read_text(BLUEPRINT)
    repo_validate = read_text(REPO_VALIDATE)
    require_snippets(
        inventory,
        (
            "FE-",
            "AD-",
            "BE-",
            "WK-",
            "PR-",
            "AS-",
            "BL-",
            "OP-",
            "VF-",
            "not launch evidence",
            "does not close any release gate",
            "validator-readable evidence",
        ),
        source=display_path(GAP_INVENTORY),
    )
    require("Docs/researches/stage1_gap_inventory.md" in blueprint, "blueprint must reference the gap inventory")
    require("validate_stage1_gap_inventory.py" in repo_validate, "repo_validate must run the gap inventory validator")


def validate() -> None:
    validate_current_snapshot()
    validate_cross_refs()


def main() -> int:
    try:
        validate()
    except Stage1GapInventoryError as exc:
        print(f"stage1 gap inventory validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 gap inventory validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
