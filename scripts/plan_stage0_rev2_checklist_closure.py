#!/usr/bin/env python3
"""Plan non-mutating Stage 0 Rev2 checklist closures from fixture update plans."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"
DEFAULT_FIXTURE_PLAN = ROOT / "ops" / "evidence" / "release" / "fixture-update-plan.json"
DEFAULT_OUT = ROOT / "ops" / "evidence" / "release" / "checklist-closure-plan.json"

GATE_ITEMS = {
    "ci": "CI Gate 全部通过。",
    "private_beta_staging": "Private Beta/Staging Gate 全部通过。",
    "production_launch": "Production Launch Gate 全部通过。",
}

GLOBAL_DO_NOT_LAUNCH_ITEM = "Do-Not-Launch Conditions 全部为 false。"

AGGREGATE_ITEMS = {
    "ci": "CI installed workflow runtime evidence 通过：PR/main run、Playwright smoke、Docker image build 均有 validator-resolvable evidence。",
    "private_beta_staging": "Private Beta/Staging external-user runtime evidence 通过：auth/RBAC/tenant、storage、quota/rate limit、support/abuse、safety/QA/crawler、observability/backup/load、legal visibility 均有 staging evidence。",
    "production_launch": "Production Launch runtime/deployment evidence 通过：provider-or-comp-only、paid lifecycle、skill canary、activation audit、abuse hold、security、backup/rollback/post-deploy smoke、legal/support policy 均有 production evidence。",
}

CHECK_ITEMS = {
    ("ci", "ci_gate_runtime_execution"): [
        "CI PR/main workflow run evidence 通过：已安装 workflow 的 PR/main run 结果写入 `ops/evidence/ci/`。",
    ],
    ("ci", "ci_playwright_smoke"): [
        "CI 在已安装 PR/main workflow 中运行 Playwright smoke。",
        "CI Playwright smoke runtime evidence 通过：已安装 PR/main workflow 运行 Playwright smoke 并写入 `ops/evidence/ci/`。",
    ],
    ("ci", "ci_docker_image_build"): [
        "CI 在已安装 PR/main workflow 中 build Docker images。",
        "CI Docker image build runtime evidence 通过：已安装 PR/main workflow build Docker images 并写入 `ops/evidence/ci/`。",
    ],
    ("private_beta_staging", "staging_object_storage_signed_downloads"): [
        "Private Beta/Staging object storage signed download/retention runtime evidence 通过。",
        "Private Beta/Staging object retention/cleanup runtime evidence 通过：staging evidence proves retention policy, expired export cleanup, orphan cleanup, and audit refs under `ops/evidence/staging/`。",
    ],
    ("private_beta_staging", "staging_legal_external_user_pages"): [
        "Private Beta/Staging legal/support external-user visibility runtime evidence 通过。",
        "Private Beta/Staging legal pages external-user visibility evidence 通过：staging evidence proves Terms、Privacy、Acceptable Use、AI/content disclaimer、IP complaint flow are externally visible under `ops/evidence/staging/`。",
        "Private Beta/Staging support contact external-user visibility evidence 通过：staging evidence proves visible support contact/report-problem path for external users under `ops/evidence/staging/`。",
    ],
    ("production_launch", "production_paid_billing_lifecycle"): [
        "Production paid billing lifecycle runtime/deployment evidence 通过。",
        "Production checkout/subscription/cancellation/past_due runtime evidence 通过 under `ops/evidence/production/`。",
        "Production refund/credit/quota reset/webhook idempotency runtime evidence 通过 under `ops/evidence/production/`。",
    ],
    ("production_launch", "production_backup_rollback_incident"): [
        "Production backup/rollback/incident/post-deploy smoke runtime/deployment evidence 通过。",
        "Production post-deploy smoke tests 通过。",
    ],
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


def checklist_state() -> tuple[set[str], set[str]]:
    text = BLUEPRINT.read_text(encoding="utf-8")
    checked: set[str] = set()
    unchecked: set[str] = set()
    for line in text.splitlines():
        match = re.match(r"^- \[([ xX])\] (.+)$", line)
        if not match:
            continue
        item = match.group(2)
        if match.group(1).lower() == "x":
            checked.add(item)
        else:
            unchecked.add(item)
    return checked, unchecked


def build_plan(fixture_plan: dict[str, Any]) -> dict[str, Any]:
    if fixture_plan.get("schema_version") != "stage0.rev2.release_gate_fixture_update_plan":
        raise SystemExit("input is not a Stage 0 Rev2 release gate fixture update plan")
    checked, unchecked = checklist_state()
    ready_checks = {
        (update["gate"], update["check_id"])
        for update in fixture_plan.get("planned_updates", [])
        if update.get("operation") == "set_check_status_pass"
    }
    planned_gate_status = {
        update["gate"]: update["planned_status"]
        for update in fixture_plan.get("planned_gate_decision_updates", [])
        if update.get("operation") == "recompute_gate_decision_after_planned_updates"
    }

    item_updates: list[dict[str, Any]] = []
    for key in sorted(ready_checks):
        for item in CHECK_ITEMS.get(key, []):
            item_updates.append(
                {
                    "item": item,
                    "operation": "mark_checked" if item in unchecked else "already_checked_or_missing",
                    "source_gate": key[0],
                    "source_check_id": key[1],
                }
            )

    for gate, aggregate_item in AGGREGATE_ITEMS.items():
        gate_specific_keys = {
            key for key in CHECK_ITEMS if key[0] == gate
        }
        if not gate_specific_keys <= ready_checks:
            continue
        item_updates.append(
            {
                "item": aggregate_item,
                "operation": "mark_checked" if aggregate_item in unchecked else "already_checked_or_missing",
                "source_gate": gate,
                "source_check_id": "aggregate_runtime",
            }
        )

    for gate, gate_item in GATE_ITEMS.items():
        if planned_gate_status.get(gate) != "go":
            continue
        aggregate_item = AGGREGATE_ITEMS[gate]
        aggregate_planned = any(
            item["item"] == aggregate_item and item["operation"] in {"mark_checked", "already_checked_or_missing"}
            for item in item_updates
        )
        if aggregate_item in checked or aggregate_planned:
            item_updates.append(
                {
                    "item": gate_item,
                    "operation": "mark_checked" if gate_item in unchecked else "already_checked_or_missing",
                    "source_gate": gate,
                    "source_check_id": "gate_decision",
                }
            )

    all_gates_go = all(planned_gate_status.get(gate) == "go" for gate in GATE_ITEMS)
    if all_gates_go:
        item_updates.append(
            {
                "item": GLOBAL_DO_NOT_LAUNCH_ITEM,
                "operation": "mark_checked"
                if GLOBAL_DO_NOT_LAUNCH_ITEM in unchecked
                else "already_checked_or_missing",
                "source_gate": "global",
                "source_check_id": "do_not_launch_conditions",
            }
        )

    blocked = fixture_plan.get("blocked_checks", [])
    return {
        "schema_version": "stage0.rev2.checklist_closure_plan",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "blueprint_source": "Docs/stage0_blueprint_rev2.md",
        "source_fixture_update_plan": fixture_plan.get("schema_version"),
        "mode": "dry_run_non_mutating",
        "mutation_policy": "does_not_edit_blueprint_checklist",
        "planned_closure_count": len([item for item in item_updates if item["operation"] == "mark_checked"]),
        "planned_closures": item_updates,
        "blocked_checks": blocked,
        "skipped_deferred_checks": fixture_plan.get("skipped_deferred_checks", []),
        "operator_next_step": (
            "Apply checklist closures only after matching release gate fixture updates are applied and "
            "python3 scripts/validate_stage0_rev2.py passes. Stripe-related rows remain open until the user resumes Stripe."
        ),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-plan", default=str(DEFAULT_FIXTURE_PLAN))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--stdout", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    fixture_plan_path = resolve(args.fixture_plan)
    out_path = resolve(args.out)
    if not fixture_plan_path.is_file():
        raise SystemExit(f"missing fixture update plan: {rel(fixture_plan_path)}")
    plan = build_plan(load_json(fixture_plan_path))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.stdout:
        print(json.dumps(plan, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
