#!/usr/bin/env python3
"""Apply Stage 0 Rev2 release closure plans when explicitly requested.

Default mode is dry-run. The script applies only planner-produced fixture
updates and checklist closures, then runs the Stage 0 Rev2 validator in apply
mode. It does not synthesize evidence and it refuses deferred Stripe updates.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FIXTURE_PLAN = ROOT / "ops" / "evidence" / "release" / "fixture-update-plan.json"
DEFAULT_CHECKLIST_PLAN = ROOT / "ops" / "evidence" / "release" / "checklist-closure-plan.json"
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"

FIXTURE_SCHEMA = "stage0.rev2.release_gate_fixture_update_plan"
CHECKLIST_SCHEMA = "stage0.rev2.checklist_closure_plan"
STRIPE_DEFERRED = ("production_launch", "production_paid_billing_lifecycle")


class ApplyError(Exception):
    pass


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def resolve(path: str | Path) -> Path:
    candidate = Path(path)
    return candidate if candidate.is_absolute() else ROOT / candidate


def load_json(path: Path, schema: str) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ApplyError(f"{rel(path)} is invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ApplyError(f"{rel(path)} must contain a JSON object")
    if data.get("schema_version") != schema:
        raise ApplyError(f"{rel(path)} schema_version must be {schema!r}")
    return data


def load_fixture(path: Path) -> dict[str, Any]:
    return load_json(path, "stage0.rev2")


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.write_text(json.dumps(data, indent=2, sort_keys=False, ensure_ascii=False) + "\n", encoding="utf-8")


def planned_fixture_paths(plan: dict[str, Any]) -> set[str]:
    paths = {str(update.get("fixture")) for update in plan.get("planned_updates", []) if update.get("fixture")}
    paths.update(
        str(update.get("fixture"))
        for update in plan.get("planned_gate_decision_updates", [])
        if update.get("fixture")
    )
    return paths


def validate_plans(fixture_plan: dict[str, Any], checklist_plan: dict[str, Any]) -> None:
    if fixture_plan.get("mutation_policy") != "does_not_edit_release_gate_fixtures_or_blueprint_checklist":
        raise ApplyError("fixture plan mutation_policy is not the expected non-mutating planner policy")
    if checklist_plan.get("mutation_policy") != "does_not_edit_blueprint_checklist":
        raise ApplyError("checklist plan mutation_policy is not the expected non-mutating planner policy")
    for deferred in fixture_plan.get("skipped_deferred_checks", []):
        if (deferred.get("gate"), deferred.get("check_id")) == STRIPE_DEFERRED:
            raise ApplyError("refusing to apply closure plan while Stripe paid billing is deferred")
    for update in fixture_plan.get("planned_updates", []):
        if (update.get("gate"), update.get("check_id")) == STRIPE_DEFERRED:
            raise ApplyError("refusing to apply production paid billing lifecycle updates while Stripe is deferred")
        if update.get("operation") != "set_check_status_pass":
            raise ApplyError(f"unsupported fixture update operation: {update.get('operation')!r}")
        if update.get("planned_status") != "pass":
            raise ApplyError(f"fixture update planned_status must be pass: {update}")
        for evidence_path in update.get("required_evidence", []):
            if not resolve(evidence_path).is_file():
                raise ApplyError(f"required runtime evidence is missing: {evidence_path}")
    for update in checklist_plan.get("planned_closures", []):
        if update.get("operation") not in {"mark_checked", "already_checked_or_missing"}:
            raise ApplyError(f"unsupported checklist closure operation: {update.get('operation')!r}")


def apply_fixture_plan(plan: dict[str, Any], apply: bool) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    updates_by_fixture: dict[str, list[dict[str, Any]]] = {}
    for update in plan.get("planned_updates", []):
        updates_by_fixture.setdefault(update["fixture"], []).append(update)

    decision_by_fixture = {
        update["fixture"]: update
        for update in plan.get("planned_gate_decision_updates", [])
        if update.get("operation") == "recompute_gate_decision_after_planned_updates"
    }

    for fixture_rel in sorted(planned_fixture_paths(plan)):
        fixture_path = resolve(fixture_rel)
        fixture = load_fixture(fixture_path)
        changed = False
        for update in updates_by_fixture.get(fixture_rel, []):
            check = next(
                (item for item in fixture.get("checks", []) if item.get("check_id") == update["check_id"]),
                None,
            )
            if check is None:
                raise ApplyError(f"{fixture_rel} missing check_id {update['check_id']}")
            if check.get("status") != "pass":
                check["status"] = "pass"
                check["evidence_ref"] = update["planned_evidence_ref"]
                changed = True
                changes.append(
                    {
                        "path": fixture_rel,
                        "kind": "fixture_check",
                        "id": update["check_id"],
                        "operation": "set_status_pass",
                    }
                )
            for condition_id in update.get("clear_do_not_launch_conditions", []):
                condition = next(
                    (
                        item
                        for item in fixture.get("do_not_launch_checks", [])
                        if item.get("condition_id") == condition_id
                    ),
                    None,
                )
                if condition is None:
                    raise ApplyError(f"{fixture_rel} missing condition_id {condition_id}")
                if condition.get("is_present") is not False:
                    condition["is_present"] = False
                    condition["evidence_ref"] = update["planned_evidence_ref"]
                    changed = True
                    changes.append(
                        {
                            "path": fixture_rel,
                            "kind": "do_not_launch_condition",
                            "id": condition_id,
                            "operation": "set_not_present",
                        }
                    )

        decision_update = decision_by_fixture.get(fixture_rel)
        if decision_update is not None:
            decision = fixture.get("gate_decision")
            if not isinstance(decision, dict):
                raise ApplyError(f"{fixture_rel} missing gate_decision")
            expected = {
                "status": decision_update["planned_status"],
                "blocked_by_checks": decision_update["planned_blocked_by_checks"],
                "active_do_not_launch_conditions": decision_update["planned_active_do_not_launch_conditions"],
            }
            if any(decision.get(key) != value for key, value in expected.items()):
                decision.update(expected)
                changed = True
                changes.append(
                    {
                        "path": fixture_rel,
                        "kind": "gate_decision",
                        "id": fixture.get("gate"),
                        "operation": "recompute",
                    }
                )
        if apply and changed:
            write_json(fixture_path, fixture)
    return changes


def apply_checklist_plan(plan: dict[str, Any], apply: bool) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    mark_items = {
        update["item"]
        for update in plan.get("planned_closures", [])
        if update.get("operation") == "mark_checked"
    }
    if not mark_items:
        return changes

    lines = BLUEPRINT.read_text(encoding="utf-8").splitlines()
    new_lines: list[str] = []
    for line in lines:
        if line.startswith("- [ ] "):
            item = line[len("- [ ] ") :]
            if item in mark_items:
                new_lines.append("- [x] " + item)
                changes.append(
                    {
                        "path": rel(BLUEPRINT),
                        "kind": "blueprint_checklist",
                        "id": item,
                        "operation": "mark_checked",
                    }
                )
                continue
        new_lines.append(line)

    missing = sorted(mark_items - {change["id"] for change in changes})
    if missing:
        raise ApplyError("checklist plan contains items that are not open in the blueprint: " + json.dumps(missing))
    if apply:
        BLUEPRINT.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    return changes


def run_validator() -> None:
    result = subprocess.run(
        [sys.executable, str(VALIDATOR)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        output = "\n".join(part for part in [result.stdout.strip(), result.stderr.strip()] if part)
        raise ApplyError("stage0 validator failed after applying closure plan:\n" + output)


def build_report(changes: list[dict[str, Any]], applied: bool) -> dict[str, Any]:
    return {
        "schema_version": "stage0.rev2.release_closure_plan_apply_report",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "mode": "apply" if applied else "dry_run_non_mutating",
        "applied": applied,
        "change_count": len(changes),
        "changes": changes,
        "validator": "python3 scripts/validate_stage0_rev2.py" if applied else "not_run_in_dry_run",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-plan", default=str(DEFAULT_FIXTURE_PLAN))
    parser.add_argument("--checklist-plan", default=str(DEFAULT_CHECKLIST_PLAN))
    parser.add_argument("--out", help="Optional JSON apply report path.")
    parser.add_argument("--apply", action="store_true", help="Actually edit fixtures and blueprint, then validate.")
    parser.add_argument("--stdout", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        fixture_plan = load_json(resolve(args.fixture_plan), FIXTURE_SCHEMA)
        checklist_plan = load_json(resolve(args.checklist_plan), CHECKLIST_SCHEMA)
        validate_plans(fixture_plan, checklist_plan)
        fixture_changes = apply_fixture_plan(fixture_plan, args.apply)
        checklist_changes = apply_checklist_plan(checklist_plan, args.apply)
        changes = fixture_changes + checklist_changes
        if args.apply:
            run_validator()
        report = build_report(changes, args.apply)
        if args.out:
            out = resolve(args.out)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
        if args.stdout:
            print(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False))
        return 0
    except ApplyError as exc:
        print(f"release closure plan apply blocked: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
