#!/usr/bin/env python3
"""Validate Stage 1 AS-6/AS-7 edit tools and mask local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "edit_tools_mask" / "local_contract.json"
BACKEND_EDITTOOLS = ROOT / "backend" / "internal" / "edittools" / "edittools.go"
BACKEND_EDITTOOLS_TEST = ROOT / "backend" / "internal" / "edittools" / "edittools_test.go"
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

TOOL_TYPES = {"crop", "rotate", "flip", "remove_background", "upscale", "erase", "expand"}
MASK_KINDS = {"brush", "rect", "lasso"}
BACKEND_FUNCTIONS = {
    "ValidateRequest",
    "ValidateMask",
    "BuildRevision",
    "BuildProviderRequest",
    "ProjectRevisionForUser",
    "ValidToolType",
    "ValidMaskKind",
    "IsAIEditTool",
    "IsMaskRequired",
}
FRONTEND_ATTRIBUTES = {
    "data-edit-tools-contract",
    "data-edit-tools-status",
    "data-edit-tools-active-tool",
    "data-edit-tools-available-tools",
    "data-edit-tools-source-asset-id",
    "data-edit-tools-source-node-id",
    "data-edit-tools-mask-kind",
    "data-edit-tools-mask-width",
    "data-edit-tools-mask-height",
    "data-edit-tools-source-width",
    "data-edit-tools-source-height",
    "data-edit-tools-mask-aligned",
    "data-edit-tools-mask-coverage",
    "data-edit-tools-revision-count",
    "data-edit-tools-last-revision-id",
    "data-edit-tools-last-action",
    "data-edit-tools-original-retained",
    "data-edit-tools-derived-asset-id",
    "data-edit-tools-derived-node-id",
    "data-edit-tools-lineage-tool",
    "data-edit-tools-raw-payload-persisted",
    "data-edit-tools-provider-request-required",
    "data-edit-tools-revision",
    "data-edit-tools-revision-source-asset",
    "data-edit-tools-revision-derived-asset",
    "data-edit-tools-revision-derived-node",
    "data-edit-tools-revision-original-retained",
    "data-edit-tools-revision-raw-payload-persisted",
}


class EditToolsMaskContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EditToolsMaskContractError(message)


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
        raise EditToolsMaskContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_fixture()
    require(data.get("schema_version") == "stage1.edit_tools_mask.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "edit_tools_mask_local_contract", "fixture kind mismatch")
    require({"AS-6", "AS-7", "QA-1", "QA-9"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")

    backend = data.get("backend_edit_contract")
    require(isinstance(backend, dict), "backend_edit_contract must be object")
    require(set(backend.get("tool_types") or []) == TOOL_TYPES, "backend tool type set mismatch")
    require(set(backend.get("mask_kinds") or []) == MASK_KINDS, "backend mask kind set mismatch")
    require(set(backend.get("required_functions") or []) == BACKEND_FUNCTIONS, "backend function set mismatch")
    require(set(backend.get("ai_edit_tools") or []) == {"remove_background", "upscale", "erase", "expand"}, "AI edit tool set mismatch")
    require(set(backend.get("mask_required_tools") or []) == {"erase", "expand"}, "mask-required tool set mismatch")
    require(backend.get("provider_endpoint") == "image.edit", "provider endpoint mismatch")
    require(backend.get("original_asset_retained") is True, "backend original retention flag mismatch")
    require(backend.get("derived_asset_revision_required") is True, "backend derived revision flag mismatch")
    require(backend.get("raw_provider_payload_persisted") is False, "backend raw-payload flag mismatch")
    require(backend.get("secret_like_request_rejection") is True, "backend secret rejection flag mismatch")
    require(backend.get("mask_dimensions_must_match_source") is True, "backend mask alignment flag mismatch")

    frontend = data.get("frontend_edit_contract")
    require(isinstance(frontend, dict), "frontend_edit_contract must be object")
    require(set(frontend.get("state_types") or []) == {"EditToolState", "EditMaskState", "EditToolRevision"}, "frontend state types mismatch")
    require(set(frontend.get("client_methods") or []) == {"setEditTool", "updateEditMask", "applyEditTool"}, "frontend client methods mismatch")
    require(frontend.get("ui_marker") == "stage1.edit-tools-mask-local-contract", "frontend UI marker mismatch")
    require(frontend.get("component") == "EditToolsPanel", "frontend component mismatch")
    require(frontend.get("apply_action_label") == "Apply Edit Tool", "apply action label mismatch")
    require(
        frontend.get("operation_contract")
        == "createUpload:POST:/uploads:include:X-Zenari-CSRF:true|createCanvasNode:POST:/workspaces/{workspace_id}/canvas/nodes:include:X-Zenari-CSRF:true|createCanvasVersion:POST:/workspaces/{workspace_id}/canvas/versions:include:X-Zenari-CSRF:true",
        "frontend operation contract mismatch",
    )
    require(FRONTEND_ATTRIBUTES <= set(frontend.get("required_data_attributes") or []), "frontend required attributes incomplete")
    require(frontend.get("derived_asset_library_lineage_kind") == "edit_tool_revision", "frontend lineage kind mismatch")
    require(frontend.get("derived_canvas_node_kind") == "iteration", "frontend derived node kind mismatch")
    require(frontend.get("mask_aligned_default") is True, "frontend mask default alignment mismatch")
    require(frontend.get("original_asset_retained") is True, "frontend original retention flag mismatch")
    require(frontend.get("raw_payload_persisted") is False, "frontend raw payload flag mismatch")

    tests = data.get("focused_tests")
    require(isinstance(tests, dict), "focused_tests must be object")
    require(
        set(tests.get("go") or [])
        == {
            "TestBuildRevisionKeepsOriginalAssetForNonDestructiveTransforms",
            "TestAIEditRevisionRequiresAlignedMaskAndBuildsProviderRequest",
            "TestEditToolRejectsMismatchedMaskSecretAndRawPayload",
            "TestRemoveBackgroundAndUpscaleBuildProviderRequestsWithoutMask",
        },
        "focused Go tests mismatch",
    )
    require(
        set(tests.get("web") or [])
        == {
            "applies local edit tools with aligned masks and derived asset revisions",
            "exposes local edit tool mask UI and derived revision contract",
        },
        "focused web tests mismatch",
    )

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_backend_edit_contract") == "pass", "local backend status mismatch")
    require(status.get("local_frontend_mask_ui") == "pass", "local frontend status mismatch")
    require(status.get("real_provider_edit_adapter") == "open", "real provider edit adapter must remain open")
    require(status.get("staging_playwright_evidence") == "open", "staging Playwright evidence must remain open")
    require(status.get("production_security_evidence") == "open", "production security evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local contract must not clear production security gate")


def validate_backend() -> None:
    text = require_text(
        BACKEND_EDITTOOLS,
        (
            "package edittools",
            "type ToolType string",
            "ToolCrop",
            "ToolRotate",
            "ToolFlip",
            "ToolRemoveBackground",
            "ToolUpscale",
            "ToolErase",
            "ToolExpand",
            "type MaskKind string",
            "MaskKindBrush",
            "MaskKindRect",
            "MaskKindLasso",
            "type MaskInput struct",
            "type Revision struct",
            "type UserProjection struct",
            "OriginalAssetRetained bool",
            "RawPayloadPersisted",
            "func ValidateRequest",
            "func ValidateMask",
            "func BuildRevision",
            "func BuildProviderRequest",
            "func ProjectRevisionForUser",
            "func IsAIEditTool",
            "func IsMaskRequired",
            "func ValidMaskKind",
            "mask dimensions must match source asset",
            "secret-like edit request",
            "secret-like mask field",
            "raw provider payload must not be persisted",
            "derived asset must be a new revision",
            "derived asset lineage must keep original and derived_from asset ids",
            "OriginalAssetRetained: true",
            "Endpoint:       \"image.edit\"",
            "Payload:        payload",
        ),
    )
    for function in BACKEND_FUNCTIONS:
        require(re.search(rf"func {re.escape(function)}\b", text), f"backend missing function {function}")
    for tool in TOOL_TYPES:
        require(f'"{tool}"' in text, f"backend missing tool literal {tool}")
    for kind in MASK_KINDS:
        require(f'"{kind}"' in text, f"backend missing mask kind literal {kind}")
    require_text(
        BACKEND_EDITTOOLS_TEST,
        (
            "TestBuildRevisionKeepsOriginalAssetForNonDestructiveTransforms",
            "TestAIEditRevisionRequiresAlignedMaskAndBuildsProviderRequest",
            "TestEditToolRejectsMismatchedMaskSecretAndRawPayload",
            "TestRemoveBackgroundAndUpscaleBuildProviderRequestsWithoutMask",
            "ProviderRequest.Endpoint != \"image.edit\"",
            "mask dimensions",
            "secret-like",
            "raw provider payload",
            "OriginalAssetRetained",
            "Lineage.RawPayloadPersisted",
        ),
    )


def validate_frontend() -> None:
    require_text(
        WEB_CONTRACTS,
        (
            "export type EditToolType",
            "\"crop\" | \"rotate\" | \"flip\" | \"remove_background\" | \"upscale\" | \"erase\" | \"expand\"",
            "export type MaskKind",
            "\"brush\" | \"rect\" | \"lasso\"",
            "export interface EditMaskState",
            "export interface EditToolRevision",
            "export interface EditToolState",
            "contract: \"stage1.edit-tools-mask-local-contract\";",
            "providerRequestRequired: boolean;",
            "originalAssetRetained: boolean;",
            "rawPayloadPersisted: false;",
            "setEditTool(tool: EditToolType)",
            "updateEditMask(mask: Partial<EditMaskState>)",
            "applyEditTool()",
        ),
    )
    require_text(
        WEB_DEV_STATE,
        (
            "export const defaultEditToolState: EditToolState",
            "contract: \"stage1.edit-tools-mask-local-contract\"",
            "availableTools: [\"crop\", \"rotate\", \"flip\", \"remove_background\", \"upscale\", \"erase\", \"expand\"]",
            "width: 1024",
            "height: 768",
            "coveragePct: 0.18",
            "sourceAssetId: \"asset_hero_1\"",
            "syncStatus: \"local\"",
        ),
    )
    require_text(
        WEB_API_CLIENT,
        (
            "const migrateEditTools",
            "async setEditTool(tool: EditToolType)",
            "async updateEditMask(mask: Partial<EditMaskState>)",
            "async applyEditTool()",
            "const providerRequestRequired = [\"remove_background\", \"upscale\", \"erase\", \"expand\"].includes(tool)",
            "const maskRequired = [\"erase\", \"expand\"].includes(tool)",
            "state.editTools.mask.width !== state.editTools.sourceWidth",
            "state.editTools.mask.height !== state.editTools.sourceHeight",
            "const revision: EditToolRevision",
            "originalAssetRetained: true",
            "rawPayloadPersisted: false",
            "kind: \"iteration\" as const",
            "lineageKind: \"edit_tool_revision\"",
            "selectedNodeIds: [derivedNodeId]",
            "lastAction: \"apply\"",
            "withQuota(",
        ),
    )
    workspace_text = require_text(
        WEB_WORKSPACE,
        (
            "| \"Apply Edit Tool\"",
            "\"Apply Edit Tool\": [\"createUpload\", \"createCanvasNode\", \"createCanvasVersion\"]",
            "function EditToolsPanel",
            "aria-label=\"Edit tools and mask\"",
            "data-edit-tools-contract={edit.contract}",
            "data-edit-tools-mask-aligned={String(maskAligned)}",
            "data-edit-tools-original-retained={String(latestRevision?.originalAssetRetained ?? true)}",
            "data-edit-tools-raw-payload-persisted={String(latestRevision?.lineage.rawPayloadPersisted ?? false)}",
            "data-edit-tools-provider-request-required={String(latestRevision?.providerRequestRequired ?? false)}",
            "aria-label={`Edit tool ${tool}`}",
            "aria-label=\"Mask kind\"",
            "aria-label=\"Mask coverage\"",
            "{...unsafeActionGuardAttributes(\"Apply Edit Tool\", state)}",
            "Apply Edit",
            "data-edit-tools-revision={latestRevision.id}",
        ),
    )
    for attribute in FRONTEND_ATTRIBUTES:
        require(attribute in workspace_text, f"workspace missing {attribute}")
    require_text(
        WEB_GLOBALS,
        (
            ".edit-tools-panel",
            ".edit-tool-row",
            ".edit-mask-grid",
            ".edit-revision-row",
        ),
    )
    require_text(
        WEB_API_CLIENT_TEST,
        (
            "applies local edit tools with aligned masks and derived asset revisions",
            "await client.setEditTool(\"erase\")",
            "await client.updateEditMask({ kind: \"rect\", coveragePct: 0.24 })",
            "await client.applyEditTool()",
            "derivedAssetId: \"asset-edit-001\"",
            "providerRequestRequired: true",
            "originalAssetRetained: true",
            "width: 1024",
            "height: 768",
            "rawPayloadPersisted: false",
            "lineageKind: \"edit_tool_revision\"",
        ),
    )
    require_text(
        WEB_WORKSPACE_TEST,
        (
            "exposes local edit tool mask UI and derived revision contract",
            "stage1.edit-tools-mask-local-contract",
            "data-edit-tools-mask-width",
            "data-edit-tools-mask-height",
            "Edit tool remove_background",
            "Apply Edit",
            "data-edit-tools-derived-asset-id",
            "data-edit-tools-original-retained",
            "data-edit-tools-raw-payload-persisted",
            "data-csrf-ux-guard-contracts",
            "createUpload:POST:/uploads:include:X-Zenari-CSRF:true|createCanvasNode:POST:/workspaces/{workspace_id}/canvas/nodes:include:X-Zenari-CSRF:true|createCanvasVersion:POST:/workspaces/{workspace_id}/canvas/versions:include:X-Zenari-CSRF:true",
            "edit_tool_revision",
        ),
    )


def validate_gap_inventory() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "validate_stage1_edit_tools_mask_contract.py",
            "stage1.edit-tools-mask-local-contract",
            "AS-6` and `AS-7",
            "local edit tools/mask contract",
            "real provider edit adapter",
            "staging Playwright evidence",
            "production security evidence",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_backend()
        validate_frontend()
        validate_gap_inventory()
    except EditToolsMaskContractError as exc:
        print(f"stage1 edit tools/mask contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 edit tools/mask contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
