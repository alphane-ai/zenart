#!/usr/bin/env python3
"""Validate Stage 1 AS-4/AS-5 canvas versioning local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "canvas_versioning" / "local_contract.json"
CANVAS_VERSION = ROOT / "backend" / "internal" / "canvas" / "version.go"
CANVAS_VERSION_TEST = ROOT / "backend" / "internal" / "canvas" / "version_test.go"
WEB_CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
WEB_DEV_STATE = ROOT / "web" / "lib" / "dev-state.ts"
WEB_API_CLIENT = ROOT / "web" / "lib" / "api-client.ts"
WEB_API_CLIENT_TEST = ROOT / "web" / "lib" / "api-client.test.ts"
WEB_WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
WEB_WORKSPACE_TEST = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
WEB_GLOBALS = ROOT / "web" / "app" / "globals.css"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

BACKEND_FUNCTIONS = {
    "CreateVersionSnapshot",
    "DiffVersionSnapshots",
    "RestoreObjectVersions",
    "RestoreWorkspaceVersion",
    "TenantScopedListVersionsSQL",
    "TenantScopedCreateVersionSQL",
}
FRONTEND_ATTRIBUTES = {
    "data-canvas-version-history",
    "data-canvas-version-history-status",
    "data-canvas-version-active-id",
    "data-canvas-version-count",
    "data-canvas-version-preview-node-count",
    "data-canvas-version-diff-added",
    "data-canvas-version-diff-removed",
    "data-canvas-version-diff-changed",
    "data-canvas-version-diff-unchanged",
    "data-canvas-version-restore-restores",
    "data-canvas-version-restore-preserves",
    "data-canvas-version-restore-conflicts",
    "data-canvas-version-entry",
    "data-canvas-version-number",
    "data-canvas-version-node-count",
}


class CanvasVersioningContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CanvasVersioningContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_fixture() -> dict[str, Any]:
    try:
        data = json.loads(read_text(FIXTURE))
    except json.JSONDecodeError as exc:
        raise CanvasVersioningContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_fixture()
    require(data.get("schema_version") == "stage1.canvas_versioning.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "canvas_versioning_local_contract", "fixture kind mismatch")
    require({"AS-4", "AS-5", "FE-4"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")

    backend = data.get("backend_version_contract")
    require(isinstance(backend, dict), "backend_version_contract must be object")
    require(backend.get("snapshot_type") == "CanvasVersionSnapshot", "snapshot type mismatch")
    require(backend.get("object_version_type") == "CanvasObjectVersion", "object version type mismatch")
    require(backend.get("diff_type") == "CanvasVersionDiff", "diff type mismatch")
    require(backend.get("restore_plan_type") == "CanvasRestorePlan", "restore plan type mismatch")
    require(BACKEND_FUNCTIONS == set(backend.get("functions") or []), "backend function set mismatch")
    require(backend.get("restore_preserves_other_objects") is True, "restore preservation flag mismatch")
    require(backend.get("tenant_workspace_validation") is True, "tenant/workspace validation flag mismatch")
    require(backend.get("idempotent_create_sql") == "ON CONFLICT (workspace_id, version_number) DO NOTHING", "idempotent SQL mismatch")

    frontend = data.get("frontend_version_history_contract")
    require(isinstance(frontend, dict), "frontend_version_history_contract must be object")
    require({"versionNumber", "snapshot", "diff", "restorePreview"} == set(frontend.get("state_fields") or []), "frontend state fields mismatch")
    require(frontend.get("component") == "CanvasVersionHistory", "frontend component mismatch")
    require(frontend.get("ui_marker") == "stage1.canvas-version-history", "frontend UI marker mismatch")
    require(frontend.get("restore_action") == "Restore Version", "restore action mismatch")
    require(frontend.get("operation_contract") == "createCanvasVersion:POST:/workspaces/{workspace_id}/canvas/versions:include:X-Zenari-CSRF:true", "operation contract mismatch")
    require(FRONTEND_ATTRIBUTES <= set(frontend.get("required_data_attributes") or []), "frontend required attributes incomplete")

    tests = data.get("focused_tests")
    require(isinstance(tests, dict), "focused_tests must be object")
    require(
        {
            "TestVersionSnapshotDiffAndRestorePreservesOtherObjects",
            "TestWorkspaceVersionRestoreCanRecreateSnapshotWithoutDroppingCurrentOnlyConflicts",
            "TestVersionSnapshotRejectsTenantWorkspaceAndMissingObjectErrors",
            "TestTenantScopedVersionSQLKeepsTenantWorkspacePredicates",
        }
        == set(tests.get("go") or []),
        "focused Go tests mismatch",
    )
    require(
        {
            "restores canvas version snapshots while preserving later unversioned objects",
            "previews and restores Stage 1 canvas version history without dropping later nodes",
        }
        == set(tests.get("web") or []),
        "focused web tests mismatch",
    )

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_backend_version_contract") == "pass", "local backend status mismatch")
    require(status.get("local_frontend_version_history") == "pass", "local frontend status mismatch")
    require(status.get("staging_playwright_evidence") == "open", "staging Playwright evidence must remain open")
    require(status.get("real_collaborative_conflict_runtime") == "open", "real conflict runtime must remain open")
    require(status.get("real_editor_library_integration") == "open", "real editor integration must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local contract must not clear production security gate")


def validate_backend() -> None:
    text = require_text(
        CANVAS_VERSION,
        (
            "type CanvasVersionSnapshot struct",
            "type CanvasObjectVersion struct",
            "type CanvasVersionDiff struct",
            "type CanvasRestorePlan struct",
            "func CreateVersionSnapshot",
            "func DiffVersionSnapshots",
            "func RestoreObjectVersions",
            "func RestoreWorkspaceVersion",
            "plan.PreservedObjectIDs",
            "plan.RestoredObjectIDs",
            "ConflictObjectIDs",
            "EnsureTenant",
            "ValidateCanvasObject",
            "TenantScopedListVersionsSQL",
            "WHERE tenant_id = $1 AND workspace_id = $2",
            "TenantScopedCreateVersionSQL",
            "ON CONFLICT (workspace_id, version_number) DO NOTHING",
        ),
    )
    for function in BACKEND_FUNCTIONS:
        require(re.search(rf"func {re.escape(function)}\b", text), f"backend missing function {function}")

    require_text(
        CANVAS_VERSION_TEST,
        (
            "TestVersionSnapshotDiffAndRestorePreservesOtherObjects",
            "TestWorkspaceVersionRestoreCanRecreateSnapshotWithoutDroppingCurrentOnlyConflicts",
            "TestVersionSnapshotRejectsTenantWorkspaceAndMissingObjectErrors",
            "TestTenantScopedVersionSQLKeepsTenantWorkspacePredicates",
            "object-level restore should not reintroduce unrequested studio object",
            "node_current_only",
            "ErrTenantDenied",
        ),
    )


def validate_frontend() -> None:
    require_text(
        WEB_CONTRACTS,
        (
            "export interface CanvasVersion",
            "versionNumber?: number;",
            "snapshot?: {",
            "nodes: CanvasNode[];",
            "edges: CanvasEdge[];",
            "diff?: {",
            "restorePreview?: {",
            "preservesNodeIds: string[];",
            "conflictNodeIds: string[];",
        ),
    )
    require_text(
        WEB_DEV_STATE,
        (
            "const buildCanvasVersionDiff",
            "export const createCanvasVersionSnapshot",
            "versionNumber: nextVersionNumber",
            "snapshot: {",
            "diff: buildCanvasVersionDiff",
            "restorePreview:",
            "preservesNodeIds: []",
            "conflictNodeIds: []",
        ),
    )
    require_text(
        WEB_API_CLIENT,
        (
            "const migrateCanvasVersions",
            "const buildCanvasVersionDiff",
            "versions: migrateCanvasVersions(state)",
            "async restoreCanvasVersion(versionId: string)",
            "const snapshotNodes = cloneCanvasNodes(version.snapshot?.nodes ?? state.canvas.nodes)",
            "const preservedNodes = state.canvas.nodes.filter((node) => !snapshotNodeIds.has(node.id))",
            "restorePreview:",
            "preservesNodeIds: preservedNodeIds",
            "lastAction: \"undo\"",
        ),
    )
    workspace_text = require_text(
        WEB_WORKSPACE,
        (
            "function CanvasVersionHistory",
            "aria-label=\"Canvas version history\"",
            "data-canvas-version-history=\"stage1.canvas-version-history\"",
            "data-canvas-version-history-status=\"local\"",
            "data-canvas-version-active-id={activeVersionId}",
            "data-canvas-version-diff-added={activeDiff.addedNodeIds.join(\",\")}",
            "data-canvas-version-restore-preserves={activePreview.preservesNodeIds.join(\",\")}",
            "data-canvas-version-entry={version.id}",
            "{...unsafeActionGuardAttributes(\"Restore Version\", state)}",
        ),
    )
    for attribute in FRONTEND_ATTRIBUTES:
        require(attribute in workspace_text, f"workspace missing {attribute}")
    require_text(
        WEB_GLOBALS,
        (
            ".canvas-version-history",
            ".version-chip",
            ".version-chip.active",
        ),
    )
    require_text(
        WEB_API_CLIENT_TEST,
        (
            "restores canvas version snapshots while preserving later unversioned objects",
            "Selected Studio System",
            "addedNodeIds: [\"node-cand-studio\"]",
            "node-cand-utility",
            "preservesNodeIds: [\"node-cand-utility\"]",
        ),
    )
    require_text(
        WEB_WORKSPACE_TEST,
        (
            "previews and restores Stage 1 canvas version history without dropping later nodes",
            "Canvas version history",
            "stage1.canvas-version-history",
            "data-canvas-version-diff-added",
            "data-canvas-version-diff-changed",
            "data-canvas-version-restore-preserves",
            "Selected Studio System",
            "Canvas move",
            "Select Utility Kit",
        ),
    )


def validate_gap_inventory() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "validate_stage1_canvas_versioning_contract.py",
            "stage1.canvas-version-history",
            "AS-4` and `AS-5",
            "local canvas versioning contract",
            "staging Playwright evidence",
            "real collaborative conflict runtime",
            "real editor-library integration",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_backend()
        validate_frontend()
        validate_gap_inventory()
    except CanvasVersioningContractError as exc:
        print(f"stage1 canvas versioning contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 canvas versioning contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
