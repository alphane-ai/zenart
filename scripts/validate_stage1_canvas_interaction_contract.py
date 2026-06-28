#!/usr/bin/env python3
"""Validate Stage 1 FE-3/FE-5/FE-6/FE-7 local canvas interaction anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "canvas_interaction" / "local_contract.json"
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

CANVAS_NODE_FIELDS = {"width", "height", "zIndex", "locked", "hidden", "frameId"}
TOOLS = {"select", "hand", "frame", "text", "shape", "upload"}
SHORTCUTS = {"delete", "duplicate", "undo", "redo", "zoom_in", "zoom_out", "space_hand", "shift_multi_select"}
CLIENT_METHODS = {
    "selectCanvasNode",
    "moveCanvasNode",
    "setCanvasZoom",
    "fitCanvasToView",
    "setCanvasTool",
    "toggleCanvasNodeHidden",
    "toggleCanvasNodeLocked",
    "duplicateSelectedCanvasNodes",
    "deleteSelectedCanvasNodes",
}
MIGRATION_HELPERS = {"migrateCanvasNode", "migrateCanvasInteraction", "clampCanvasZoom"}
REQUIRED_DATA_ATTRIBUTES = {
    "data-canvas-interaction-contract",
    "data-canvas-interaction-status",
    "data-canvas-tool",
    "data-canvas-zoom",
    "data-canvas-selected-node-count",
    "data-canvas-selected-node-ids",
    "data-canvas-visible-node-count",
    "data-canvas-hidden-node-count",
    "data-canvas-locked-node-count",
    "data-canvas-last-action",
    "data-canvas-toolbar-tools",
    "data-canvas-keyboard-shortcuts",
    "data-canvas-layers-panel",
    "data-canvas-node",
    "data-canvas-node-selected",
    "data-canvas-node-locked",
    "data-canvas-node-hidden",
    "data-canvas-node-z-index",
    "data-canvas-layer-row",
    "data-canvas-layer-hidden",
    "data-canvas-layer-locked",
}


class CanvasInteractionContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CanvasInteractionContractError(message)


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
        raise CanvasInteractionContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_fixture()
    require(data.get("schema_version") == "stage1.canvas_interaction.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "frontend_canvas_interaction_local_contract", "fixture kind mismatch")
    require({"FE-3", "FE-5", "FE-6", "FE-7"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(
        {
            "web/lib/contracts.ts",
            "web/lib/dev-state.ts",
            "web/lib/api-client.ts",
            "web/components/workspace-app.tsx",
            "web/components/workspace-app.smoke.test.tsx",
            "web/lib/api-client.test.ts",
            "web/app/globals.css",
        }
        <= set(data.get("source_files") or []),
        "fixture source_files incomplete",
    )

    state_contract = data.get("state_contract")
    require(isinstance(state_contract, dict), "state_contract must be object")
    require(CANVAS_NODE_FIELDS == set(state_contract.get("canvas_node_fields") or []), "canvas node field set mismatch")
    require(state_contract.get("canvas_tool_type") == "CanvasTool", "canvas tool type mismatch")
    require(state_contract.get("interaction_state") == "CanvasInteractionState", "interaction state mismatch")
    require(state_contract.get("workspace_field") == "WorkspaceState.canvas.interaction", "workspace interaction field mismatch")
    require(state_contract.get("default_state") == "defaultCanvasInteraction", "default interaction state mismatch")
    require(state_contract.get("version_snapshot_builder") == "createCanvasVersionSnapshot", "version snapshot builder mismatch")

    client = data.get("local_client_contract")
    require(isinstance(client, dict), "local_client_contract must be object")
    require(client.get("class") == "DevZenariClient", "client class mismatch")
    require(MIGRATION_HELPERS == set(client.get("migration_helpers") or []), "client migration helpers mismatch")
    require(CLIENT_METHODS == set(client.get("methods") or []), "client methods mismatch")
    require(client.get("candidate_selection_selects_canvas_node") is True, "candidate selection must select canvas node")
    require(client.get("iteration_creates_selectable_canvas_node") is True, "iteration must create selectable node")
    require(client.get("local_storage_migration_required") is True, "local storage migration flag mismatch")

    ui = data.get("ui_contract")
    require(isinstance(ui, dict), "ui_contract must be object")
    require(ui.get("component") == "CanvasPanel", "UI component mismatch")
    require(ui.get("ui_marker") == "stage1.canvas-interaction-user-contract", "UI marker mismatch")
    require(ui.get("toolbar_marker") == "stage1.canvas-toolbar", "toolbar marker mismatch")
    require(ui.get("layers_marker") == "stage1.canvas-layers-panel", "layers marker mismatch")
    require(TOOLS == set(ui.get("tools") or []), "toolbar tools mismatch")
    require(SHORTCUTS == set(ui.get("keyboard_shortcuts") or []), "keyboard shortcuts mismatch")
    require(REQUIRED_DATA_ATTRIBUTES <= set(ui.get("required_data_attributes") or []), "required data attributes incomplete")
    for control in (
        "Canvas tool hand",
        "Zoom in canvas",
        "Fit",
        "Move Studio System",
        "Lock Studio System",
        "Unlock Studio System",
        "Hide Studio System",
        "Duplicate selected canvas nodes",
        "Delete selected canvas nodes",
    ):
        require(control in set(ui.get("controls") or []), f"UI controls missing {control}")

    tests = set(data.get("focused_tests") or [])
    require(
        {
            "tracks Stage 1 canvas toolbar, layers, zoom, drag, and keyboard interactions locally",
            "exposes Stage 1 canvas toolbar, layers, zoom, drag, and keyboard interaction contract",
        }
        == tests,
        "focused tests mismatch",
    )

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_frontend_interaction") == "pass", "local frontend interaction status mismatch")
    require(status.get("backend_canvas_versioning") == "open", "backend canvas versioning must remain open")
    require(status.get("edit_tool_runtime") == "open", "edit tool runtime must remain open")
    require(status.get("staging_playwright_evidence") == "open", "staging Playwright evidence must remain open")
    require(status.get("real_canvas_editor_library") == "open", "real editor library status must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local contract must not clear production security gate")


def validate_contract_types() -> None:
    require_text(
        WEB_CONTRACTS,
        (
            "export type CanvasTool = \"select\" | \"hand\" | \"frame\" | \"text\" | \"shape\" | \"upload\";",
            "export interface CanvasInteractionState",
            "contract: \"stage1.canvas-interaction-user-contract\";",
            "interaction: CanvasInteractionState;",
            "width?: number;",
            "height?: number;",
            "zIndex?: number;",
            "locked?: boolean;",
            "hidden?: boolean;",
            "frameId?: string;",
            "selectCanvasNode(nodeId: string, additive?: boolean): Promise<WorkspaceState>;",
            "moveCanvasNode(nodeId: string, delta: { x: number; y: number }): Promise<WorkspaceState>;",
            "setCanvasZoom(zoom: number): Promise<WorkspaceState>;",
            "fitCanvasToView(): Promise<WorkspaceState>;",
            "setCanvasTool(tool: CanvasTool): Promise<WorkspaceState>;",
            "toggleCanvasNodeHidden(nodeId: string): Promise<WorkspaceState>;",
            "toggleCanvasNodeLocked(nodeId: string): Promise<WorkspaceState>;",
            "duplicateSelectedCanvasNodes(): Promise<WorkspaceState>;",
            "deleteSelectedCanvasNodes(): Promise<WorkspaceState>;",
        ),
    )


def validate_dev_state() -> None:
    require_text(
        WEB_DEV_STATE,
        (
            "export const defaultCanvasInteraction: CanvasInteractionState",
            "contract: \"stage1.canvas-interaction-user-contract\"",
            "tool: \"select\"",
            "selectedNodeIds: [\"node-brief\"]",
            "keyboardShortcuts: [\"delete\", \"duplicate\", \"undo\", \"redo\", \"zoom_in\", \"zoom_out\", \"space_hand\", \"shift_multi_select\"]",
            "toolbarTools: [\"select\", \"hand\", \"frame\", \"text\", \"shape\", \"upload\"]",
            "layersPanelEnabled: true",
            "export const createCanvasVersionSnapshot",
            "width: 230",
            "height: 118",
            "zIndex: 1",
            "locked: false",
            "hidden: false",
            "interaction: defaultCanvasInteraction",
        ),
    )


def validate_client() -> None:
    text = require_text(
        WEB_API_CLIENT,
        (
            "const migrateCanvasNode",
            "const migrateCanvasInteraction",
            "const clampCanvasZoom",
            "nodes: state.canvas.nodes.map(migrateCanvasNode)",
            "interaction: migrateCanvasInteraction(state)",
            "async selectCandidate(candidateId: string)",
            "const state = migrateState(loadState());",
            "selectedNodeIds: [nodeId]",
            "async iterateSelected(instruction: string)",
            "lastAction: \"select\"",
            "async selectCanvasNode(nodeId: string, additive = false)",
            "async moveCanvasNode(nodeId: string, delta: { x: number; y: number })",
            "lastAction: \"drag\"",
            "async setCanvasZoom(zoom: number)",
            "zoom: clampCanvasZoom(zoom)",
            "async fitCanvasToView()",
            "lastAction: \"fit\"",
            "async setCanvasTool(tool: CanvasTool)",
            "async toggleCanvasNodeHidden(nodeId: string)",
            "lastAction: \"layer-hide\"",
            "async toggleCanvasNodeLocked(nodeId: string)",
            "lastAction: \"layer-lock\"",
            "async duplicateSelectedCanvasNodes()",
            "id: `${node.id}-copy-${state.canvas.nodes.length + index + 1}`",
            "async deleteSelectedCanvasNodes()",
            "lastAction: \"keyboard\"",
        ),
    )
    for method in CLIENT_METHODS:
        require(re.search(rf"async {re.escape(method)}\b", text), f"web/lib/api-client.ts missing async method {method}")


def validate_ui() -> None:
    text = require_text(
        WEB_WORKSPACE,
        (
            "function CanvasPanel",
            "aria-label=\"Stage 1 canvas editor\"",
            "data-canvas-interaction-contract={state.canvas.interaction.contract}",
            "data-canvas-interaction-status=\"local\"",
            "data-canvas-toolbar=\"stage1.canvas-toolbar\"",
            "data-canvas-layers-panel=\"stage1.canvas-layers-panel\"",
            "aria-label={`Canvas tool ${tool}`}",
            "aria-label=\"Zoom in canvas\"",
            "data-canvas-fit-control=\"fit\"",
            "aria-label=\"Duplicate selected canvas nodes\"",
            "aria-label=\"Delete selected canvas nodes\"",
            "event.key.toLowerCase() === \"d\"",
            "event.key === \"Delete\" || event.key === \"Backspace\"",
            "event.key === \"=\"",
            "event.key === \"-\"",
            "event.code === \"Space\"",
            "function CanvasNodeCard",
            "data-canvas-node={node.id}",
            "data-canvas-node-selected={String(selected)}",
            "data-canvas-node-locked={String(Boolean(node.locked))}",
            "data-canvas-node-hidden={String(Boolean(node.hidden))}",
            "data-canvas-node-z-index={node.zIndex ?? 1}",
            "aria-label={`Move ${node.title}`}",
            "data-canvas-layer-row={node.id}",
            "data-canvas-layer-hidden={String(Boolean(node.hidden))}",
            "data-canvas-layer-locked={String(Boolean(node.locked))}",
        ),
    )
    for attribute in REQUIRED_DATA_ATTRIBUTES:
        require(attribute in text, f"workspace UI missing {attribute}")
    require_text(
        WEB_GLOBALS,
        (
            ".canvas-toolbar",
            ".canvas-body",
            ".canvas-world",
            ".canvas-layers",
            ".canvas-layer",
            ".canvas-node.selected",
            ".canvas-node.locked",
            ".node-move-handle",
        ),
    )


def validate_tests() -> None:
    require_text(
        WEB_API_CLIENT_TEST,
        (
            "tracks Stage 1 canvas toolbar, layers, zoom, drag, and keyboard interactions locally",
            "await client.selectCandidate(\"cand-studio\")",
            "await client.selectCanvasNode(\"node-cand-studio\")",
            "await client.moveCanvasNode(\"node-cand-studio\", { x: 24, y: 18 })",
            "await client.setCanvasZoom(1.35)",
            "await client.fitCanvasToView()",
            "await client.setCanvasTool(\"hand\")",
            "await client.toggleCanvasNodeLocked(\"node-cand-studio\")",
            "await client.toggleCanvasNodeHidden(\"node-cand-studio\")",
            "await client.duplicateSelectedCanvasNodes()",
            "await client.deleteSelectedCanvasNodes()",
            "selectedNodeIds: [\"node-cand-studio\"]",
            "node-cand-studio-copy-",
        ),
    )
    require_text(
        WEB_WORKSPACE_TEST,
        (
            "exposes Stage 1 canvas toolbar, layers, zoom, drag, and keyboard interaction contract",
            "data-canvas-interaction-contract",
            "stage1.canvas-interaction-user-contract",
            "data-canvas-toolbar-tools",
            "select,hand,frame,text,shape,upload",
            "data-canvas-keyboard-shortcuts",
            "Canvas toolbar",
            "stage1.canvas-toolbar",
            "Canvas layers",
            "stage1.canvas-layers-panel",
            "Canvas tool hand",
            "Zoom in canvas",
            "Fit",
            "Select Studio System",
            "Move Studio System",
            "Lock Studio System",
            "Unlock Studio System",
            "node-cand-studio-copy-",
            "Hide Studio System",
        ),
    )


def validate_gap_inventory() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "validate_stage1_canvas_interaction_contract.py",
            "stage1.canvas-interaction-user-contract",
            "FE-3` to `FE-7",
            "local canvas interaction contract",
            "AS-4 backend versioning",
            "AS-5 version history preview/diff",
            "AS-6/AS-7 edit tools/mask UI",
            "staging Playwright evidence",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_contract_types()
        validate_dev_state()
        validate_client()
        validate_ui()
        validate_tests()
        validate_gap_inventory()
    except CanvasInteractionContractError as exc:
        print(f"stage1 canvas interaction contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 canvas interaction contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
