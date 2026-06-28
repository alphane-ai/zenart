#!/usr/bin/env python3
"""Validate Stage 1 BE-6/BE-8/BE-9 canvas, asset, and tenant local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "canvas_assets" / "local_contract.json"
CANVAS = ROOT / "backend" / "internal" / "canvas" / "model.go"
CANVAS_TEST = ROOT / "backend" / "internal" / "canvas" / "model_test.go"
ASSETS = ROOT / "backend" / "internal" / "assets" / "model.go"
ASSETS_TEST = ROOT / "backend" / "internal" / "assets" / "model_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
RESULT_SINK = ROOT / "backend" / "internal" / "task" / "batch_result_sink.go"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
MIGRATIONS = ROOT / "backend" / "migrations"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

CANVAS_TYPES = {"image", "video", "text", "shape", "frame", "group", "vector", "generated_layer"}
ASSET_TYPES = {"image", "video", "audio", "font", "svg", "pdf", "pptx", "psd_manifest", "generated_image", "thumbnail"}
TENANT_CONSTRAINTS = {
    "fk_canvas_nodes_tenant_workspace",
    "fk_canvas_edges_tenant_from_node",
    "fk_assets_tenant_object",
    "fk_object_metadata_tenant_project",
    "idx_canvas_nodes_tenant_id_unique",
    "idx_assets_tenant_id_unique",
}


class CanvasAssetContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CanvasAssetContractError(message)


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
        raise CanvasAssetContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_fixture()
    require(data.get("schema_version") == "stage1.canvas_assets.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "backend_canvas_assets_tenant_contract", "fixture kind mismatch")
    require({"BE-6", "BE-8", "BE-9", "AS-1", "AS-2", "AS-3"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("openapi_source") == "openapi/zenart.v1.yaml", "fixture OpenAPI source mismatch")
    require(set(data.get("backend_packages") or []) == {"backend/internal/canvas", "backend/internal/assets"}, "fixture backend packages mismatch")

    canvas_contract = data.get("canvas_object_contract")
    require(isinstance(canvas_contract, dict), "canvas_object_contract must be object")
    require(set(canvas_contract.get("required_types") or []) == CANVAS_TYPES, "canvas required types mismatch")
    for field in ("tenant_id", "workspace_id", "object_type", "body", "transform", "z_index", "locked", "hidden", "asset_ref", "lineage_ref"):
        require(field in set(canvas_contract.get("required_fields") or []), f"canvas required_fields missing {field}")
    require(canvas_contract.get("tenant_projection") == "UserProjection", "canvas tenant_projection mismatch")
    require(canvas_contract.get("tenant_sql") == "TenantScopedListNodesSQL", "canvas tenant_sql mismatch")
    require(canvas_contract.get("secret_like_metadata_rejected") is True, "canvas secret policy must reject")

    visual_asset_contract = data.get("visual_asset_contract")
    require(isinstance(visual_asset_contract, dict), "visual_asset_contract must be object")
    require(set(visual_asset_contract.get("required_types") or []) == ASSET_TYPES, "asset required types mismatch")
    for field in ("tenant_id", "object_metadata_id", "storage_ref", "thumbnail_ref", "lineage", "raw_payload_persisted"):
        require(field in set(visual_asset_contract.get("required_fields") or []), f"asset required_fields missing {field}")
    require(visual_asset_contract.get("tenant_projection") == "UserProjection", "asset tenant_projection mismatch")
    require(visual_asset_contract.get("tenant_sql") == "TenantScopedListAssetsSQL", "asset tenant_sql mismatch")
    require(visual_asset_contract.get("raw_provider_payload_persisted") is False, "raw provider payload must not persist")

    tenant = data.get("tenant_isolation")
    require(isinstance(tenant, dict), "tenant_isolation must be object")
    require(set(tenant.get("migration_constraints") or []) == TENANT_CONSTRAINTS, "tenant constraints mismatch")
    require(tenant.get("user_projection_checks_tenant") is True, "tenant projection check flag mismatch")
    require(tenant.get("list_queries_require_tenant_predicate") is True, "tenant SQL flag mismatch")

    runtime = data.get("runtime_wiring")
    require(isinstance(runtime, dict), "runtime_wiring must be object")
    require(runtime.get("result_sink") == "backend/internal/task/PostgresBatchResultSink", "runtime sink mismatch")
    require({"object_metadata", "assets", "canvas_nodes"} <= set(runtime.get("required_persistence") or []), "runtime persistence incomplete")
    require({"storage_ref", "thumbnail_ref", "lineage", "trace_projection"} <= set(runtime.get("required_metadata") or []), "runtime metadata incomplete")
    require(runtime.get("raw_provider_payload_saved") is False, "runtime raw provider flag must be false")

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_contract") == "pass", "local contract status mismatch")
    require(status.get("staging_runtime_evidence") == "open", "staging evidence must remain open")
    require(status.get("production_security_evidence") == "open", "production evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local contract must not clear production security gate")


def validate_canvas_package() -> None:
    require_text(
        CANVAS,
        (
            "type CanvasObject struct",
            "type Transform struct",
            "type AssetRef struct",
            "type LineageRef struct",
            "ObjectTypeGeneratedLayer",
            "ZIndex",
            "Locked",
            "Hidden",
            "ValidateCanvasObject",
            "EnsureTenant",
            "ErrTenantDenied",
            "UserProjection",
            "TenantScopedListNodesSQL",
            "WHERE tenant_id = $1 AND workspace_id = $2",
            "security.ClassifyValue",
        ),
    )
    require_text(
        CANVAS_TEST,
        (
            "TestValidateCanvasObjectCoversStage1Fields",
            "TestCanvasObjectUserProjectionIsTenantScopedAndRedacted",
            "TestCanvasObjectRejectsSecretsAndUnsupportedTypes",
            "TestTenantScopedListNodesSQLKeepsTenantPredicate",
            "ObjectTypeGeneratedLayer",
            "ErrTenantDenied",
            "secret-like",
        ),
    )


def validate_assets_package() -> None:
    require_text(
        ASSETS,
        (
            "type VisualAsset struct",
            "type ObjectMetadata struct",
            "type StorageRef struct",
            "type SourceRef struct",
            "type Lineage struct",
            "AssetTypePSDManifest",
            "AssetTypeGeneratedImage",
            "AssetTypeThumbnail",
            "AssetStatusBlocked",
            "RawPayloadPersisted",
            "ValidateVisualAsset",
            "ValidateStorageRef",
            "EnsureTenant",
            "ErrTenantDenied",
            "UserProjection",
            "StorageRefFromObject",
            "TenantScopedListAssetsSQL",
            "JOIN object_metadata o ON o.tenant_id = a.tenant_id AND o.id = a.object_metadata_id",
            "WHERE a.tenant_id = $1",
            "security.ClassifyValue",
        ),
    )
    require_text(
        ASSETS_TEST,
        (
            "TestValidateVisualAssetCoversStorageThumbnailAndLineage",
            "TestVisualAssetProjectionIsTenantScoped",
            "TestVisualAssetRejectsUnsafeStorageRefsSecretsAndRawPayload",
            "TestTenantScopedListAssetsSQLKeepsTenantJoin",
            "AssetTypeGeneratedImage",
            "RawPayloadPersisted",
            "raw provider payload",
        ),
    )


def validate_openapi() -> None:
    require_text(
        OPENAPI,
        (
            "CanvasNodeCreate:",
            "CanvasNode:",
            "CanvasTransform:",
            "AssetRef:",
            "LineageRef:",
            "generated_layer",
            "z_index:",
            "locked:",
            "hidden:",
            "storage_ref:",
            "thumbnail_ref:",
            "lineage:",
            "Asset:",
            "ObjectMetadata:",
            "StorageRef:",
            "SourceRef:",
            "AssetLineage:",
            "psd_manifest",
            "generated_image",
            "raw_payload_persisted:",
            "Tenant-scoped object key only; credentials, query strings, fragments, and signed URLs are forbidden.",
        ),
    )


def validate_migrations() -> None:
    migration_text = "\n".join(path.read_text(encoding="utf-8") for path in MIGRATIONS.glob("*.sql"))
    for constraint in TENANT_CONSTRAINTS:
        require(constraint in migration_text, f"migrations missing tenant constraint {constraint}")


def validate_result_sink() -> None:
    require_text(
        RESULT_SINK,
        (
            "INSERT INTO object_metadata",
            "INSERT INTO assets",
            "INSERT INTO canvas_nodes",
            "storage_ref",
            "thumbnail_ref",
            "lineage",
            "trace_projection",
            '"raw_provider_payload_saved": false',
        ),
    )


def validate_repo_wiring_and_docs() -> None:
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_canvas_assets_contract.py",
            "python3 scripts/validate_stage1_canvas_assets_contract.py",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-2i",
            "scripts/validate_stage1_canvas_assets_contract.py",
            "BE-6",
            "BE-8",
            "BE-9",
            "backend/internal/canvas",
            "backend/internal/assets",
            "fixtures/stage1/canvas_assets/local_contract.json",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_canvas_package()
        validate_assets_package()
        validate_openapi()
        validate_migrations()
        validate_result_sink()
        validate_repo_wiring_and_docs()
    except CanvasAssetContractError as exc:
        print(f"stage1 canvas/assets contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 canvas/assets contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
