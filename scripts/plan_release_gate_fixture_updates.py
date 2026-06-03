#!/usr/bin/env python3
"""Plan Stage 0 Rev2 release gate fixture updates from runtime reconciliation.

The script is deliberately non-mutating by default. It converts the reconciler's
pass-ready checks into exact fixture/check/condition update suggestions and
leaves blocked or deferred checks untouched.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RECONCILIATION = ROOT / "ops" / "evidence" / "release" / "runtime-reconciliation.json"
DEFAULT_OUT = ROOT / "ops" / "evidence" / "release" / "fixture-update-plan.json"

GATE_FIXTURES = {
    "ci": "fixtures/stage0/rev2/release_gate_evidence.ci.json",
    "private_beta_staging": "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    "production_launch": "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
}

CHECK_TO_CONDITIONS = {
    ("ci", "ci_gate_runtime_execution"): ["ci_gate_not_executed_on_main"],
    ("ci", "ci_playwright_smoke"): ["ci_playwright_smoke_missing"],
    ("ci", "ci_docker_image_build"): ["ci_docker_image_build_missing"],
    ("private_beta_staging", "staging_object_storage_signed_downloads"): [
        "object_storage_signed_retention_runtime_missing",
    ],
    ("private_beta_staging", "staging_legal_external_user_pages"): [
        "external_user_legal_pages_missing",
    ],
    ("production_launch", "production_paid_billing_lifecycle"): [
        "paid_billing_or_comp_only_mode_missing",
    ],
    ("production_launch", "production_backup_rollback_incident"): [
        "backup_restore_rollback_smoke_missing",
        "production_deploy_rollback_smoke_missing",
        "ci_staging_gates_not_passed",
    ],
}

STRIPE_DEFERRED = ("production_launch", "production_paid_billing_lifecycle")


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"{rel(path)} must contain a JSON object")
    return data


def resolve(path: str | Path) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else ROOT / candidate


def check_evidence_paths(check: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for item in check.get("evidence", []):
        if isinstance(item, dict) and item.get("passed") is True and item.get("path"):
            paths.append(str(item["path"]))
    return paths


def planned_evidence_ref(gate: str, check_id: str, evidence_paths: list[str]) -> str:
    fixture = GATE_FIXTURES[gate]
    evidence = ", ".join(evidence_paths)
    upstream = ""
    if (gate, check_id) == ("production_launch", "production_backup_rollback_incident"):
        upstream = (
            "; upstream closure also requires fixtures/stage0/rev2/release_gate_evidence.ci.json "
            "and fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json to be go"
        )
    return (
        f"{evidence} provide validator-resolvable runtime evidence for {gate}.{check_id}; "
        f"update {fixture} only after this plan remains pass-ready and python3 scripts/validate_stage0_rev2.py passes"
        f"{upstream}"
    )


def gate_blockers_after_updates(
    fixture: dict[str, Any],
    ready_check_ids: set[str],
    clear_condition_ids: set[str],
) -> tuple[list[str], list[str], str]:
    blocked_checks = [
        check["check_id"]
        for check in fixture.get("checks", [])
        if check.get("status") != "pass" and check.get("check_id") not in ready_check_ids
    ]
    active_conditions = [
        condition["condition_id"]
        for condition in fixture.get("do_not_launch_checks", [])
        if condition.get("is_present") is True and condition.get("condition_id") not in clear_condition_ids
    ]
    status = "go" if not blocked_checks and not active_conditions else "no_go"
    return blocked_checks, active_conditions, status


def build_plan(reconciliation: dict[str, Any]) -> dict[str, Any]:
    if reconciliation.get("schema_version") != "stage0.rev2.release_runtime_reconciliation":
        raise SystemExit("input is not a Stage 0 Rev2 release runtime reconciliation report")

    ready_by_gate: dict[str, set[str]] = {gate: set() for gate in GATE_FIXTURES}
    blocked: list[dict[str, Any]] = []
    for gate, gate_report in reconciliation.get("gates", {}).items():
        if gate not in GATE_FIXTURES:
            continue
        for check in gate_report.get("checks", []):
            check_id = str(check.get("check_id") or "")
            computed_status = check.get("computed_status")
            if computed_status == "pass_ready" and check.get("can_update_fixture_to_pass") is True:
                ready_by_gate[gate].add(check_id)
            elif computed_status != "pass_ready":
                blocked.append(
                    {
                        "gate": gate,
                        "check_id": check_id,
                        "computed_status": computed_status,
                        "fixture_status": check.get("fixture_status"),
                        "blockers": check.get("blockers", []),
                    }
                )

    updates: list[dict[str, Any]] = []
    gate_decision_updates: list[dict[str, Any]] = []
    skipped_deferred: list[dict[str, Any]] = []

    for gate, ready_check_ids in ready_by_gate.items():
        fixture_path = resolve(GATE_FIXTURES[gate])
        fixture = load_json(fixture_path)
        clear_condition_ids: set[str] = set()
        for check_id in sorted(ready_check_ids):
            if (gate, check_id) == STRIPE_DEFERRED:
                skipped_deferred.append(
                    {
                        "gate": gate,
                        "check_id": check_id,
                        "reason": "stripe_deferred_by_user",
                    }
                )
                continue
            check_report = next(
                check
                for check in reconciliation["gates"][gate]["checks"]
                if check.get("check_id") == check_id
            )
            evidence_paths = check_evidence_paths(check_report)
            condition_ids = CHECK_TO_CONDITIONS.get((gate, check_id), [])
            clear_condition_ids.update(condition_ids)
            updates.append(
                {
                    "fixture": GATE_FIXTURES[gate],
                    "gate": gate,
                    "check_id": check_id,
                    "operation": "set_check_status_pass",
                    "current_status": check_report.get("fixture_status"),
                    "planned_status": "pass",
                    "planned_evidence_ref": planned_evidence_ref(gate, check_id, evidence_paths),
                    "required_evidence": evidence_paths,
                    "clear_do_not_launch_conditions": condition_ids,
                }
            )

        blocked_checks, active_conditions, status = gate_blockers_after_updates(
            fixture,
            ready_check_ids,
            clear_condition_ids,
        )
        gate_decision_updates.append(
            {
                "fixture": GATE_FIXTURES[gate],
                "gate": gate,
                "operation": "recompute_gate_decision_after_planned_updates",
                "planned_status": status,
                "planned_blocked_by_checks": blocked_checks,
                "planned_active_do_not_launch_conditions": active_conditions,
            }
        )

    return {
        "schema_version": "stage0.rev2.release_gate_fixture_update_plan",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "source_reconciliation": reconciliation.get("schema_version"),
        "mode": "dry_run_non_mutating",
        "mutation_policy": "does_not_edit_release_gate_fixtures_or_blueprint_checklist",
        "planned_update_count": len(updates),
        "planned_updates": updates,
        "planned_gate_decision_updates": gate_decision_updates,
        "blocked_checks": blocked,
        "skipped_deferred_checks": skipped_deferred,
        "operator_next_step": (
            "Apply fixture changes only when planned_update_count is non-zero, no planned update is deferred, "
            "and python3 scripts/validate_stage0_rev2.py passes after the corresponding blueprint checklist rows close."
        ),
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
    plan = build_plan(load_json(reconciliation_path))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.stdout:
        print(json.dumps(plan, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
