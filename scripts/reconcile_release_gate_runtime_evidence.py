#!/usr/bin/env python3
"""Render a non-mutating Stage 0 Rev2 release runtime reconciliation report."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "ops" / "evidence" / "release" / "runtime-reconciliation.json"
BLUEPRINT = ROOT / "Docs" / "stage0_blueprint_rev2.md"

GATE_FIXTURES = {
    "ci": ROOT / "fixtures" / "stage0" / "rev2" / "release_gate_evidence.ci.json",
    "private_beta_staging": ROOT / "fixtures" / "stage0" / "rev2" / "release_gate_evidence.private_beta_staging.json",
    "production_launch": ROOT / "fixtures" / "stage0" / "rev2" / "release_gate_evidence.production_launch.json",
}

EVIDENCE_REQUIREMENTS = {
    "ci": {
        "ci_gate_runtime_execution": [ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-pr-main-run.json"],
        "ci_playwright_smoke": [ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-playwright-smoke.json"],
        "ci_docker_image_build": [ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-docker-image-build.json"],
    },
    "private_beta_staging": {
        "staging_object_storage_signed_downloads": [
            ROOT / "ops" / "evidence" / "staging" / "20260527T2130Z-object-storage-signed-url.json",
            ROOT / "ops" / "evidence" / "staging" / "object-storage-retention-cleanup.json",
        ],
        "staging_legal_external_user_pages": [
            ROOT / "ops" / "evidence" / "staging" / "legal-pages-external-user.json",
            ROOT / "ops" / "evidence" / "staging" / "support-contact-external-user.json",
        ],
    },
    "production_launch": {
        "production_paid_billing_lifecycle": [
            ROOT / "ops" / "evidence" / "production" / "billing-lifecycle.json",
            ROOT / "ops" / "evidence" / "production" / "billing-refund-credit-webhook.json",
        ],
        "production_backup_rollback_incident": [
            ROOT / "ops" / "evidence" / "production" / "backup-restore.json",
            ROOT / "ops" / "evidence" / "production" / "rollback-incident-post-deploy-smoke.json",
        ],
    },
}

DEFERRED_CHECKS = {
    ("production_launch", "production_paid_billing_lifecycle"): "stripe_deferred_by_user",
}

UPSTREAM_DEPENDENCIES = {
    ("production_launch", "production_backup_rollback_incident"): ["ci", "private_beta_staging"],
}


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def gate_decision(path: Path) -> str:
    data = load_json(path) or {}
    decision = data.get("gate_decision")
    if isinstance(decision, dict):
        return str(decision.get("status") or "unknown")
    return "unknown"


def evidence_passes(path: Path, gate: str, check_id: str) -> tuple[bool, str]:
    data = load_json(path)
    if data is None:
        return False, "missing_or_invalid_json"
    if data.get("environment") not in {"ci", "staging", "production"}:
        return False, "missing_runtime_environment"
    if data.get("release_gate_check_id") != check_id:
        return False, "release_gate_check_id_mismatch"
    if data.get("status") not in {"pass", "passed", "pass_with_blockers_preserved"}:
        return False, f"status_not_pass:{data.get('status')}"
    if gate == "ci":
        workflow = data.get("workflow")
        if not isinstance(workflow, dict) or workflow.get("run_id") in {None, "", "local"}:
            return False, "ci_missing_real_workflow_run"
    if gate == "private_beta_staging" and data.get("environment") != "staging":
        return False, "not_staging_environment"
    if gate == "production_launch" and data.get("environment") != "production":
        return False, "not_production_environment"
    return True, "pass"


def compute_check(gate: str, check_id: str, fixture_status: str, gate_ready: dict[str, bool]) -> dict[str, Any]:
    paths = EVIDENCE_REQUIREMENTS[gate][check_id]
    evidence_results = []
    for path in paths:
        passed, reason = evidence_passes(path, gate, check_id)
        evidence_results.append({"path": rel(path), "passed": passed, "reason": reason})
    missing_or_failed = [item for item in evidence_results if not item["passed"]]
    blockers = []
    if missing_or_failed:
        blockers.extend(f"{item['path']}:{item['reason']}" for item in missing_or_failed)

    deferred_reason = DEFERRED_CHECKS.get((gate, check_id))
    if deferred_reason:
        blockers.append(deferred_reason)

    for upstream_gate in UPSTREAM_DEPENDENCIES.get((gate, check_id), []):
        if not gate_ready.get(upstream_gate, False):
            blockers.append(f"upstream_gate_not_ready:{upstream_gate}")

    computed_status = "pass_ready" if not blockers else "blocked"
    return {
        "check_id": check_id,
        "fixture_status": fixture_status,
        "computed_status": computed_status,
        "can_update_fixture_to_pass": computed_status == "pass_ready" and fixture_status != "pass",
        "evidence": evidence_results,
        "blockers": blockers,
    }


def build_report() -> dict[str, Any]:
    fixture_decisions = {gate: gate_decision(path) for gate, path in GATE_FIXTURES.items()}
    gate_ready = {gate: status == "go" for gate, status in fixture_decisions.items()}
    gate_reports = {}
    for gate, checks in EVIDENCE_REQUIREMENTS.items():
        fixture = load_json(GATE_FIXTURES[gate]) or {}
        fixture_checks = {
            item.get("check_id"): item.get("status")
            for item in fixture.get("checks", [])
            if isinstance(item, dict)
        }
        gate_reports[gate] = {
            "fixture": rel(GATE_FIXTURES[gate]),
            "fixture_decision": fixture_decisions[gate],
            "checks": [
                compute_check(gate, check_id, str(fixture_checks.get(check_id, "missing")), gate_ready)
                for check_id in checks
            ],
        }

    ready_checks = [
        f"{gate}.{check['check_id']}"
        for gate, gate_report in gate_reports.items()
        for check in gate_report["checks"]
        if check["computed_status"] == "pass_ready"
    ]
    blocked_checks = [
        f"{gate}.{check['check_id']}"
        for gate, gate_report in gate_reports.items()
        for check in gate_report["checks"]
        if check["computed_status"] != "pass_ready"
    ]
    return {
        "schema_version": "stage0.rev2.release_runtime_reconciliation",
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "blueprint_source": rel(BLUEPRINT),
        "mode": "dry_run_non_mutating",
        "mutation_policy": "does_not_edit_release_gate_fixtures_or_blueprint_checklist",
        "gate_fixture_decisions": fixture_decisions,
        "ready_checks": ready_checks,
        "blocked_checks": blocked_checks,
        "gates": gate_reports,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="Output reconciliation report path.")
    parser.add_argument("--stdout", action="store_true", help="Also print the report JSON to stdout.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    out = Path(args.out)
    if not out.is_absolute():
        out = ROOT / out
    report = build_report()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.stdout:
        print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
