#!/usr/bin/env python3
"""Plan the runtime input artifacts still needed for Stage 0 Rev2 release closure."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RECONCILIATION = ROOT / "ops" / "evidence" / "release" / "runtime-reconciliation.json"
DEFAULT_OUT = ROOT / "ops" / "evidence" / "release" / "runtime-input-manifest.json"

COMMANDS = {
    ("ci", "ci_gate_runtime_execution"): "RUN_ID=<github-actions-run-id> DRY_RUN=1 scripts/collect_release_runtime_artifacts.sh",
    ("ci", "ci_playwright_smoke"): "RUN_ID=<github-actions-run-id> DRY_RUN=1 scripts/collect_release_runtime_artifacts.sh",
    ("ci", "ci_docker_image_build"): "RUN_ID=<github-actions-run-id> DRY_RUN=1 scripts/collect_release_runtime_artifacts.sh",
    ("private_beta_staging", "staging_object_storage_signed_downloads"): (
        "STAGING_OBJECT_RETENTION_URL=<external-url> RUN_ID=<run-id> "
        "scripts/staging_object_storage_retention_cleanup_smoke.sh"
    ),
    ("private_beta_staging", "staging_legal_external_user_pages"): (
        "STAGING_WEB_URL=<external-url> RUN_ID=<run-id> "
        "scripts/staging_legal_support_visibility_smoke.sh"
    ),
    ("production_launch", "production_paid_billing_lifecycle"): (
        "Stripe deferred by user; resume paid billing before generating production billing lifecycle artifacts"
    ),
    ("production_launch", "production_backup_rollback_incident"): (
        "No new production backup/rollback artifact required if canonical production evidence remains pass; "
        "close upstream CI and Private Beta/Staging gates first"
    ),
}

INPUT_DIRS = {
    "ci": "ops/evidence/runtime-inputs/ci",
    "private_beta_staging": "ops/evidence/runtime-inputs/staging",
    "production_launch": "ops/evidence/runtime-inputs/production",
}


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def resolve(path: str | Path) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else ROOT / candidate


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"{rel(path)} must contain a JSON object")
    return data


def blocker_kind(blockers: list[str]) -> str:
    if any("stripe_deferred_by_user" in blocker for blocker in blockers):
        return "deferred_by_user"
    if any(blocker.startswith("upstream_gate_not_ready:") for blocker in blockers):
        return "upstream_gate_dependency"
    if any("missing_or_invalid_json" in blocker or "status_not_pass" in blocker for blocker in blockers):
        return "runtime_artifact_required"
    return "blocked"


def evidence_items(gate: str, check: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for evidence in check.get("evidence", []):
        if not isinstance(evidence, dict):
            continue
        path = str(evidence.get("path") or "")
        passed = evidence.get("passed") is True
        reason = str(evidence.get("reason") or "")
        items.append(
            {
                "canonical_path": path,
                "input_dir": INPUT_DIRS.get(gate, "ops/evidence/runtime-inputs"),
                "passed": passed,
                "reason": reason,
                "action": "keep" if passed else "provide_or_promote_real_runtime_artifact",
            }
        )
    return items


def build_manifest(reconciliation: dict[str, Any]) -> dict[str, Any]:
    if reconciliation.get("schema_version") != "stage0.rev2.release_runtime_reconciliation":
        raise SystemExit("input is not a Stage 0 Rev2 release runtime reconciliation report")

    requirements: list[dict[str, Any]] = []
    for gate, gate_report in reconciliation.get("gates", {}).items():
        for check in gate_report.get("checks", []):
            if check.get("computed_status") == "pass_ready":
                continue
            check_id = str(check.get("check_id") or "")
            blockers = [str(item) for item in check.get("blockers", [])]
            kind = blocker_kind(blockers)
            requirements.append(
                {
                    "gate": gate,
                    "check_id": check_id,
                    "status": check.get("computed_status"),
                    "fixture_status": check.get("fixture_status"),
                    "blocker_kind": kind,
                    "deferred": kind == "deferred_by_user",
                    "input_dir": INPUT_DIRS.get(gate, "ops/evidence/runtime-inputs"),
                    "operator_command": COMMANDS.get((gate, check_id), "See release runtime closure runbook"),
                    "evidence": evidence_items(gate, check),
                    "blockers": blockers,
                }
            )

    return {
        "schema_version": "stage0.rev2.release_runtime_input_manifest",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "source_reconciliation": reconciliation.get("schema_version"),
        "mode": "dry_run_non_mutating",
        "mutation_policy": "does_not_edit_runtime_evidence_release_fixtures_or_blueprint",
        "summary": {
            "ready_check_count": len(reconciliation.get("ready_checks", [])),
            "blocked_check_count": len(requirements),
            "runtime_artifact_required_count": sum(
                1 for item in requirements if item["blocker_kind"] == "runtime_artifact_required"
            ),
            "upstream_dependency_count": sum(
                1 for item in requirements if item["blocker_kind"] == "upstream_gate_dependency"
            ),
            "deferred_by_user_count": sum(1 for item in requirements if item["deferred"]),
        },
        "requirements": requirements,
        "next_pipeline_command": "scripts/run_release_closure_pipeline.sh --apply",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reconciliation", default=str(DEFAULT_RECONCILIATION))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--stdout", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    reconciliation_path = resolve(args.reconciliation)
    out_path = resolve(args.out)
    if not reconciliation_path.is_file():
        raise SystemExit(f"missing reconciliation report: {rel(reconciliation_path)}")
    manifest = build_manifest(load_json(reconciliation_path))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.stdout:
        print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
