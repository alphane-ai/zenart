#!/usr/bin/env python3
"""Validate Stage 1 AD-11/OP-8 operations incident runbook admin contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "operations_incident_runbook" / "local_contract.json"
ADMIN_PAGE = ROOT / "admin" / "app" / "operations" / "page.tsx"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_FIXTURES = ROOT / "admin" / "lib" / "fixtures.ts"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"https://[^\\s\"']+X-Amz-Signature=[A-Za-z0-9]+)"
)


class OperationsIncidentRunbookContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise OperationsIncidentRunbookContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise OperationsIncidentRunbookContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    return data


def require_str_list(data: dict[str, Any], key: str, minimum: int = 1) -> set[str]:
    value = data.get(key)
    require(isinstance(value, list) and len(value) >= minimum, f"fixture {key} must contain at least {minimum} values")
    result: set[str] = set()
    for item in value:
        require(isinstance(item, str) and item.strip(), f"fixture {key} contains invalid value")
        result.add(item)
    return result


def validate_fixture() -> dict[str, Any]:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.operations_incident_runbook.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "operations_incident_runbook_admin_contract", "fixture kind mismatch")
    require({"AD-11", "OP-8", "OP-10", "OP-11", "VF-6", "VF-7"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("admin_route") == "admin/app/operations/page.tsx", "fixture admin route mismatch")
    require(data.get("route_marker") == "stage1.operations-incident-runbook-local-contract", "fixture route marker mismatch")

    require({"severity", "status", "customerImpact", "mitigation", "owner", "nextUpdateAt", "auditRefs", "rollbackPlan"} <= require_str_list(data, "required_incident_fields", 8), "fixture incident fields incomplete")
    require({"severity", "threshold", "routeTarget", "escalationRole", "runbook", "incidentRef", "auditRef", "runtimeEvidenceRef"} <= require_str_list(data, "required_alert_route_fields", 8), "fixture alert route fields incomplete")
    require({"ready_for_review", "blocked_until_evidence", "blocked_by_do_not_launch"} <= require_str_list(data, "required_action_statuses", 3), "fixture action statuses incomplete")
    require({"acknowledge", "escalate", "rollback", "maintenance_banner", "support_update"} <= require_str_list(data, "required_actions", 5), "fixture actions incomplete")
    require({"incident_log", "alert_route", "release_blocker", "maintenance_banner"} <= require_str_list(data, "required_source_surfaces", 4), "fixture source surfaces incomplete")
    require({"ops/evidence/production/backup-restore.json", "ops/evidence/production/rollback-incident-post-deploy-smoke.json", "ops/evidence/production/backup-rollback-split.blocked.json"} <= require_str_list(data, "required_rollback_evidence_refs", 3), "fixture rollback evidence refs incomplete")
    require({"staging_observability_restore_load_missing", "object_storage_signed_retention_runtime_missing", "production_backup_rollback_incident", "production_paid_billing_lifecycle"} <= require_str_list(data, "preserved_do_not_launch_conditions", 4), "fixture preserved DNL conditions incomplete")
    require({"staging_observability_backup_load", "staging_object_storage_signed_downloads", "production_backup_rollback_incident", "production_paid_billing_lifecycle"} <= require_str_list(data, "blocked_gate_checks", 4), "fixture blocked gate checks incomplete")

    non_launch = data.get("non_launch_status")
    require(isinstance(non_launch, dict), "fixture non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("staging_evidence") == "open", "staging evidence must remain open")
    require(non_launch.get("production_evidence") == "open", "production evidence must remain open")
    require(non_launch.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(non_launch.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")
    require(non_launch.get("can_close_do_not_launch") is False, "local contract must not close DNL")
    require(non_launch.get("manual_go_controls_enabled") is False, "local contract must disable manual go controls")

    for ref in data.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_admin_page(contract: dict[str, Any]) -> None:
    required_controls = tuple(contract["required_controls"])
    page = require_text(
        ADMIN_PAGE,
        (
            "OperationsIncidentRunbookContract",
            "OperationsIncidentRunbookAction",
            "getOperationsIncidentRunbookContract",
            "Incident Runbook Contract",
            "stage1.operations-incident-runbook-local-contract",
            "canClearStagingGate: false",
            "canClearProductionGate: false",
            "canCloseDoNotLaunch: false",
            "manualGoControlsEnabled: false",
            "Blocked Gate Checks",
            "Preserved DNL Conditions",
            "Required Incident Fields",
            "Required Alert Route Fields",
            "Required Rollback Evidence",
            "Operator Boundary",
        )
        + required_controls,
    )
    require(not re.search(r"<form|type=\"submit\"|manual go|mark go|set go", page, flags=re.I), "operations page must not expose mutation/manual gate controls")
    for key in (
        "required_incident_fields",
        "required_alert_route_fields",
        "required_rollback_evidence_refs",
        "preserved_do_not_launch_conditions",
        "blocked_gate_checks",
        "required_actions",
        "required_source_surfaces",
    ):
        for value in contract[key]:
            require(value in page or value in read_text(ADMIN_FIXTURES), f"operations page/fixtures missing contract value {value!r}")
    require(not RAW_SECRET_RE.search(page), "operations page contains raw secret-looking material")


def validate_types_api_and_fixtures(contract: dict[str, Any]) -> None:
    require_text(
        ADMIN_TYPES,
        (
            "export type OperationsIncidentRunbookAction",
            "export type OperationsIncidentRunbookContract",
            'schema: "stage1.operations-incident-runbook-local-contract.v1"',
            'routeMarker: "stage1.operations-incident-runbook-local-contract"',
            "preservedDoNotLaunchConditions: string[]",
            "blockedGateChecks: string[]",
            "actionMatrix: OperationsIncidentRunbookAction[]",
            "canClearStagingGate: false",
            "canClearProductionGate: false",
            "canCloseDoNotLaunch: false",
            "manualGoControlsEnabled: false",
        ),
    )
    fixtures = require_text(
        ADMIN_FIXTURES,
        (
            "export const operationsIncidentRunbookContract",
            "stage1.operations-incident-runbook-local-contract",
            "ops-runbook-acknowledge-alert",
            "ops-runbook-escalate-security",
            "ops-runbook-rollback-export",
            "ops-runbook-maintenance-banner",
            "ops-runbook-support-update",
            "blocked_by_do_not_launch",
            "blocked_until_evidence",
            "manualGoControlsEnabled: false",
        ),
    )
    require_text(ADMIN_API, ("operationsIncidentRunbookContract", "getOperationsIncidentRunbookContract"))

    action_match = re.search(r"actionMatrix:\s*\[(?P<body>[\s\S]*?)\n\s*\],\n\s*canClearStagingGate", fixtures)
    require(action_match is not None, "operations actionMatrix fixture block not found")
    body = action_match.group("body")
    for action in contract["required_actions"]:
        require(f'action: "{action}"' in body, f"actionMatrix missing action {action!r}")
    for surface in contract["required_source_surfaces"]:
        require(f'sourceSurface: "{surface}"' in body, f"actionMatrix missing source surface {surface!r}")
    for status in contract["required_action_statuses"]:
        require(f'status: "{status}"' in body, f"actionMatrix missing status {status!r}")
    require(not RAW_SECRET_RE.search(body), "operations runbook fixtures contain raw secret-looking material")


def validate_tests_and_wiring() -> None:
    require_text(
        ADMIN_TESTS,
        (
            "admin operations page exposes incident runbook contract without launch controls",
            "stage1.operations-incident-runbook-local-contract",
            "OperationsIncidentRunbookContract",
            "data-ops-incident-runbook-contract",
            "data-ops-runbook-action-matrix",
            "canClearProductionGate: false",
            "manualGoControlsEnabled: false",
            "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
        ),
    )
    require_text(REPO_VALIDATE, ("validate_stage1_operations_incident_runbook_contract.py",))
    require_text(GAP_INVENTORY, ("VF-6i", "Operations Incident Runbook"))


def main() -> int:
    try:
        contract = validate_fixture()
        validate_admin_page(contract)
        validate_types_api_and_fixtures(contract)
        validate_tests_and_wiring()
    except OperationsIncidentRunbookContractError as exc:
        print(f"stage1 operations incident runbook contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 operations incident runbook contract passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
