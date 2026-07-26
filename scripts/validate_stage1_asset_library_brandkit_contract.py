#!/usr/bin/env python3
"""Validate Stage 1 AS-8/AS-9 asset library and Brand Kit local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "asset_library_brandkit" / "local_contract.json"
ASSET_LIBRARY = ROOT / "backend" / "internal" / "assets" / "library.go"
ASSET_LIBRARY_TEST = ROOT / "backend" / "internal" / "assets" / "library_test.go"
BRANDKIT = ROOT / "backend" / "internal" / "brandkit" / "model.go"
BRANDKIT_TEST = ROOT / "backend" / "internal" / "brandkit" / "model_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
MIGRATION = ROOT / "backend" / "migrations" / "0019_stage1_asset_library_brand_kits.sql"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
SERVER = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_TEST = ROOT / "backend" / "internal" / "server" / "server_test.go"
STAGE0_REPOSITORY = ROOT / "backend" / "internal" / "stage0" / "services.go"
WEB_CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
WEB_ASSET_LIBRARY_CLIENT = ROOT / "web" / "lib" / "asset-library-client.ts"
WEB_API_CLIENT = ROOT / "web" / "lib" / "api-client.ts"
WEB_WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
WEB_WORKSPACE_TEST = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
WEB_API_CLIENT_TEST = ROOT / "web" / "lib" / "api-client.test.ts"
WEB_USER_ROUTE_SMOKE = ROOT / "web" / "validation" / "user-routes-smoke.json"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

ASSET_ACTIONS = {"insert_canvas", "attach_prompt", "favorite", "archive", "reuse_project"}
ASSET_VISIBILITY = {"project", "tenant", "private"}
BRANDKIT_FIELDS = {"logos", "palette", "fonts", "guidelines", "source_refs", "project_bindings"}
BRANDKIT_STATUSES = {"draft", "active", "archived"}
TENANT_CONSTRAINTS = {
    "idx_asset_library_entries_tenant_id_unique",
    "idx_brand_kits_tenant_id_unique",
    "fk_asset_library_entries_tenant_asset",
    "fk_asset_library_entries_tenant_created_by",
    "fk_brand_kits_tenant_created_by",
}
API_ROUTES = {
    "GET /api/v1/assets/library",
    "POST /api/v1/assets/library",
    "PATCH /api/v1/assets/library/{entry_id}",
    "GET /api/v1/brand-kits",
    "POST /api/v1/brand-kits",
    "PATCH /api/v1/brand-kits/{brand_kit_id}",
    "GET /api/v1/projects/{project_id}/brand-kit-default",
    "PUT /api/v1/projects/{project_id}/brand-kit-default",
}
API_HANDLERS = {
    "listAssetLibrary",
    "createAssetLibraryEntry",
    "updateAssetLibraryEntry",
    "listBrandKits",
    "createBrandKit",
    "updateBrandKit",
    "getProjectDefaultBrandKit",
    "setProjectDefaultBrandKit",
}
REPOSITORY_METHODS = {
    "ListAssetLibrary",
    "CreateAssetLibraryEntry",
    "GetAssetLibraryEntry",
    "UpdateAssetLibraryEntry",
    "ListBrandKits",
    "CreateBrandKit",
    "GetBrandKit",
    "UpdateBrandKit",
    "GetProjectDefaultBrandKit",
    "SetProjectDefaultBrandKit",
}
FRONTEND_OPERATIONS = {
    "listAssetLibrary",
    "createAssetLibraryEntry",
    "updateAssetLibraryEntry",
    "listBrandKits",
    "createBrandKit",
    "updateBrandKit",
    "getProjectDefaultBrandKit",
    "setProjectDefaultBrandKit",
}
FOCUSED_SERVER_TESTS = {
    "TestAssetLibraryUsesPrincipalTenantProjectAndSafeProjection",
    "TestBrandKitsUsesPrincipalTenantProjectAndSafeProjection",
    "TestProjectDefaultBrandKitUsesPrincipalTenantAndPathProject",
    "TestCreateAssetLibraryEntryUsesPrincipalTenantAndIdempotency",
    "TestUpdateAssetLibraryEntryRequiresIdempotencyBeforeStorage",
    "TestCreateBrandKitRejectsSecretLikeGuidelinesBeforeStorage",
    "TestSetProjectDefaultBrandKitUsesPrincipalTenantAndPathProject",
}


class AssetBrandKitContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssetBrandKitContractError(message)


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
        raise AssetBrandKitContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_fixture()
    require(data.get("schema_version") == "stage1.asset_library_brandkit.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "asset_library_brandkit_tenant_contract", "fixture kind mismatch")
    require({"AS-8", "AS-9", "FE-13", "FE-14"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(set(data.get("backend_packages") or []) == {"backend/internal/assets", "backend/internal/brandkit"}, "backend package mismatch")
    require(data.get("openapi_source") == "openapi/zenart.v1.yaml", "fixture OpenAPI source mismatch")

    asset_contract = data.get("asset_library_contract")
    require(isinstance(asset_contract, dict), "asset_library_contract must be object")
    require(ASSET_ACTIONS == set(asset_contract.get("actions") or []), "asset actions mismatch")
    require(ASSET_VISIBILITY == set(asset_contract.get("visibility") or []), "asset visibility mismatch")
    for key in ("tenant_scoped_projection", "prompt_attachment_builder", "canvas_insertion_builder", "tenant_sql"):
        require(isinstance(asset_contract.get(key), str) and asset_contract[key], f"asset contract missing {key}")
    require(asset_contract.get("private_reuse_allowed") is False, "private reuse must be denied")
    require(asset_contract.get("archived_prompt_or_canvas_use_allowed") is False, "archived use must be denied")

    brand_contract = data.get("brand_kit_contract")
    require(isinstance(brand_contract, dict), "brand_kit_contract must be object")
    require(BRANDKIT_FIELDS == set(brand_contract.get("fields") or []), "brand kit fields mismatch")
    require(BRANDKIT_STATUSES == set(brand_contract.get("statuses") or []), "brand kit statuses mismatch")
    for key in ("tenant_scoped_projection", "prompt_context_projection", "project_default_lookup", "tenant_sql"):
        require(isinstance(brand_contract.get(key), str) and brand_contract[key], f"brand contract missing {key}")
    require(brand_contract.get("prompt_context_requires_active") is True, "prompt context must require active brand kit")
    require(brand_contract.get("palette_hex_required") is True, "palette hex validation required")
    require(brand_contract.get("secret_like_guidelines_rejected") is True, "secret-like guidelines must be rejected")

    persistence = data.get("persistence")
    require(isinstance(persistence, dict), "persistence must be object")
    require({"asset_library_entries", "brand_kits"} == set(persistence.get("tables") or []), "persistence tables mismatch")
    require(TENANT_CONSTRAINTS == set(persistence.get("tenant_constraints") or []), "tenant constraints mismatch")

    api_runtime = data.get("api_runtime_contract")
    require(isinstance(api_runtime, dict), "api_runtime_contract must be object")
    require(API_ROUTES == set(api_runtime.get("routes") or []), "API runtime routes mismatch")
    require(API_HANDLERS == set(api_runtime.get("handlers") or []), "API runtime handlers mismatch")
    require(REPOSITORY_METHODS == set(api_runtime.get("repository_methods") or []), "API runtime repository methods mismatch")
    for key in (
        "principal_tenant_required",
        "project_filter_required",
        "safe_projection_required",
        "secret_like_projection_redacted",
        "write_idempotency_required",
        "write_validation_required",
    ):
        require(api_runtime.get(key) is True, f"api_runtime_contract {key} must be true")
    require(FOCUSED_SERVER_TESTS == set(api_runtime.get("focused_server_tests") or []), "API runtime focused server tests mismatch")

    frontend = data.get("frontend_picker_contract")
    require(isinstance(frontend, dict), "frontend_picker_contract must be object")
    require(
        {
            "web/lib/contracts.ts",
            "web/lib/asset-library-client.ts",
            "web/lib/api-client.ts",
            "web/components/workspace-app.tsx",
            "web/validation/user-routes-smoke.json",
        }
        <= set(frontend.get("source_files") or []),
        "frontend picker source files incomplete",
    )
    require(frontend.get("state_contract") == "AssetLibraryState", "frontend state contract mismatch")
    require(frontend.get("client_contract") == "AssetLibraryClient", "frontend client contract mismatch")
    require(FRONTEND_OPERATIONS == set(frontend.get("operations") or []), "frontend operations mismatch")
    require(frontend.get("ui_marker") == "stage1.asset-library-brandkit-user-picker", "frontend UI marker mismatch")
    require(frontend.get("refresh_control") == "Refresh Assets", "frontend refresh control mismatch")
    require(frontend.get("safe_action_label") == "asset-library-refresh", "frontend safe action label mismatch")
    require(frontend.get("package_behavior") == "local_reference_package_item", "frontend package behavior mismatch")
    require(frontend.get("write_api_claimed") is True, "frontend picker must claim local write API coverage")
    require(
        {
            "data-asset-library-brandkit-ui",
            "data-asset-library-sync-status",
            "data-asset-library-operation-count",
            "data-asset-library-operations",
            "data-asset-library-operation-contracts",
            "data-asset-library-item-count",
            "data-asset-library-reusable-count",
            "data-asset-library-packaged-count",
            "data-brand-kit-count",
            "data-brand-kit-default-id",
            "data-brand-kit-default-palette-count",
            "data-asset-library-create-contract",
            "data-asset-library-favorite-contract",
            "data-asset-library-archive-contract",
            "data-brand-kit-create-contract",
            "data-brand-kit-write-api",
            "data-brand-kit-default-contract",
        }
        <= set(frontend.get("required_data_attributes") or []),
        "frontend picker required attributes incomplete",
    )
    require(
        {
            "refreshes asset library and Brand Kit picker data through the read API",
            "writes asset library and Brand Kit changes through idempotent API calls",
            "renders asset library and Brand Kit picker contract on the workspace",
        }
        == set(frontend.get("focused_web_tests") or []),
        "frontend picker focused tests mismatch",
    )

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_contract") == "pass", "local contract status mismatch")
    require(status.get("local_read_api_runtime") == "pass", "local read API runtime status mismatch")
    require(status.get("local_write_api_runtime") == "pass", "local write API runtime status mismatch")
    require(status.get("local_frontend_picker") == "pass", "local frontend picker status mismatch")
    require(status.get("frontend_ui") == "local_picker_and_write_contract", "frontend UI status mismatch")
    require(status.get("write_api_runtime") == "local_pass", "write API runtime status mismatch")
    require(status.get("staging_runtime_evidence") == "open", "staging runtime evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")


def validate_go_packages() -> None:
    require_text(
        ASSET_LIBRARY,
        (
            "type LibraryEntry struct",
            "type LibraryActionRequest struct",
            "LibraryActionInsertCanvas",
            "LibraryActionAttachPrompt",
            "LibraryVisibilityTenant",
            "ValidateLibraryEntry",
            "LibraryUserProjection",
            "BuildPromptAttachment",
            "BuildCanvasInsertion",
            "ValidateLibraryAction",
            "LibraryAllowsProject",
            "TenantScopedListLibrarySQL",
            "asset_library_entries",
            "JOIN assets a ON a.tenant_id = l.tenant_id AND a.id = l.asset_id",
            "security.ClassifyValue",
        ),
    )
    require_text(
        ASSET_LIBRARY_TEST,
        (
            "TestLibraryEntryProjectionAndPromptAttachmentAreTenantScoped",
            "TestLibraryCanvasInsertionUsesSafeAssetProjection",
            "TestLibraryEntryRejectsUnsafeReuseSecretsAndArchivedActions",
            "TestTenantScopedListLibrarySQLKeepsTenantAndProjectPredicates",
            "ErrTenantDenied",
            "secret-like",
        ),
    )
    require_text(
        BRANDKIT,
        (
            "type BrandKit struct",
            "type LogoAssetRef struct",
            "type ColorSwatch struct",
            "type FontRef struct",
            "type Guideline struct",
            "type SourceRef struct",
            "type ProjectBinding struct",
            "BrandKitStatusActive",
            "ValidateBrandKit",
            "ValidateLogoAssets",
            "PromptContextProjection",
            "ProjectDefault",
            "TenantScopedListBrandKitsSQL",
            "brand_kits",
            "project_bindings @> jsonb_build_array",
            "security.ClassifyValue",
        ),
    )
    require_text(
        BRANDKIT_TEST,
        (
            "TestBrandKitProjectionAndPromptContextAreTenantScoped",
            "TestBrandKitValidatesLogoAssetsProjectDefaultAndSecrets",
            "TestBrandKitRejectsInvalidPaletteAndInactivePromptContext",
            "TestTenantScopedListBrandKitsSQLKeepsTenantAndProjectPredicates",
            "ErrTenantDenied",
            "secret-like",
        ),
    )


def validate_openapi() -> None:
    require_text(
        OPENAPI,
        (
            "/assets/library:",
            "operationId: listAssetLibrary",
            "operationId: createAssetLibraryEntry",
            "/assets/library/{entry_id}:",
            "operationId: updateAssetLibraryEntry",
            "/brand-kits:",
            "operationId: listBrandKits",
            "operationId: createBrandKit",
            "/brand-kits/{brand_kit_id}:",
            "operationId: updateBrandKit",
            "/projects/{project_id}/brand-kit-default:",
            "operationId: getProjectDefaultBrandKit",
            "operationId: setProjectDefaultBrandKit",
            "AssetLibraryEntryCreate:",
            "AssetLibraryEntryUpdate:",
            "BrandKitCreate:",
            "BrandKitUpdate:",
            "ProjectDefaultBrandKitSet:",
            "x-idempotency-required: true",
            "ProjectIdQuery:",
            "AssetLibraryEntry:",
            "AssetLibraryEntryPage:",
            "BrandKit:",
            "BrandKitPage:",
            "LogoAssetRef:",
            "ColorSwatch:",
            "FontRef:",
            "BrandGuideline:",
            "BrandKitSourceRef:",
            "BrandKitProjectBinding:",
            "enum: [project, tenant, private]",
            "enum: [draft, active, archived]",
            "pattern: \"^#[0-9A-Fa-f]{6}$\"",
            "secret-looking material is rejected",
        ),
    )


def validate_migration() -> None:
    text = require_text(
        MIGRATION,
        (
            "CREATE TABLE IF NOT EXISTS asset_library_entries",
            "CREATE TABLE IF NOT EXISTS brand_kits",
            "asset_library_visibility_check",
            "asset_library_private_reuse_check",
            "brand_kits_status_check",
            "brand_kits_logo_refs_array_check",
            "idx_asset_library_entries_tenant_id_unique",
            "idx_brand_kits_tenant_id_unique",
        ),
    )
    for constraint in TENANT_CONSTRAINTS:
        require(constraint in text, f"migration missing {constraint}")


def validate_runtime_api() -> None:
    require_text(
        SERVER,
        (
            's.mux.Handle("GET /api/v1/assets/library"',
            's.mux.Handle("POST /api/v1/assets/library"',
            's.mux.Handle("PATCH /api/v1/assets/library/{entry_id}"',
            's.mux.Handle("GET /api/v1/brand-kits"',
            's.mux.Handle("POST /api/v1/brand-kits"',
            's.mux.Handle("PATCH /api/v1/brand-kits/{brand_kit_id}"',
            's.mux.Handle("GET /api/v1/projects/{project_id}/brand-kit-default"',
            's.mux.Handle("PUT /api/v1/projects/{project_id}/brand-kit-default"',
            "func (s *Server) listAssetLibrary",
            "func (s *Server) createAssetLibraryEntry",
            "func (s *Server) updateAssetLibraryEntry",
            "func (s *Server) listBrandKits",
            "func (s *Server) createBrandKit",
            "func (s *Server) updateBrandKit",
            "func (s *Server) getProjectDefaultBrandKit",
            "func (s *Server) setProjectDefaultBrandKit",
            "PrincipalFromContext",
            "requireIdempotencyKey",
            "stage0RepoFrom",
            "repo.ListAssetLibrary",
            "repo.CreateAssetLibraryEntry",
            "repo.UpdateAssetLibraryEntry",
            "repo.ListBrandKits",
            "repo.CreateBrandKit",
            "repo.UpdateBrandKit",
            "repo.GetProjectDefaultBrandKit",
            "repo.SetProjectDefaultBrandKit",
        ),
    )
    require_text(
        STAGE0_REPOSITORY,
        (
            "type AssetLibraryEntry struct",
            "type BrandKit struct",
            "type AssetLibraryEntryCreate struct",
            "type AssetLibraryEntryUpdate struct",
            "type BrandKitCreate struct",
            "type BrandKitUpdate struct",
            "type ProjectDefaultBrandKitSet struct",
            "func (r Repository) ListAssetLibrary",
            "func (r Repository) CreateAssetLibraryEntry",
            "func (r Repository) GetAssetLibraryEntry",
            "func (r Repository) UpdateAssetLibraryEntry",
            "func (r Repository) ListBrandKits",
            "func (r Repository) CreateBrandKit",
            "func (r Repository) GetBrandKit",
            "func (r Repository) UpdateBrandKit",
            "func (r Repository) GetProjectDefaultBrandKit",
            "func (r Repository) SetProjectDefaultBrandKit",
            "asset_library_entries",
            "brand_kits",
            "WHERE l.tenant_id = $1",
            "WHERE tenant_id = $1",
            "project_bindings @> jsonb_build_array",
            "security.RedactMap",
            "security.RedactString",
            "validateAssetLibraryWrite",
            "validateBrandKitWrite",
            "redactMapSlice",
        ),
    )
    require_text(
        SERVER_TEST,
        (
            "TestAssetLibraryUsesPrincipalTenantProjectAndSafeProjection",
            "TestBrandKitsUsesPrincipalTenantProjectAndSafeProjection",
            "TestProjectDefaultBrandKitUsesPrincipalTenantAndPathProject",
            "TestCreateAssetLibraryEntryUsesPrincipalTenantAndIdempotency",
            "TestUpdateAssetLibraryEntryRequiresIdempotencyBeforeStorage",
            "TestCreateBrandKitRejectsSecretLikeGuidelinesBeforeStorage",
            "TestSetProjectDefaultBrandKitUsesPrincipalTenantAndPathProject",
            "tenant_id=tenant_2",
            'query.args[0] != "tenant_1"',
            "secret-value",
            "security.Redacted",
            "Idempotency-Key",
        ),
    )


def validate_frontend_picker() -> None:
    require_text(
        WEB_CONTRACTS,
        (
            "export interface AssetLibraryItem",
            "export interface BrandKitItem",
            "export interface AssetLibraryState",
            '| "listAssetLibrary"',
            '| "createAssetLibraryEntry"',
            '| "updateAssetLibraryEntry"',
            '| "listBrandKits"',
            '| "createBrandKit"',
            '| "updateBrandKit"',
            '| "getProjectDefaultBrandKit"',
            '| "setProjectDefaultBrandKit"',
            "packagedAssetIds: string[]",
        ),
    )
    require_text(
        WEB_ASSET_LIBRARY_CLIENT,
        (
            "export interface AssetLibraryClient",
            "class ApiAssetLibraryClient",
            'listAssetLibrary(projectId: string, status = "active")',
            "createAssetLibraryEntry(input: AssetLibraryEntryCreateRequest, idempotencyKey: string)",
            "updateAssetLibraryEntry(entryId: string, input: AssetLibraryEntryUpdateRequest, idempotencyKey: string)",
            'listBrandKits(projectId: string, status = "active")',
            "createBrandKit(input: BrandKitWriteRequest, idempotencyKey: string)",
            "updateBrandKit(brandKitId: string, input: BrandKitUpdateRequest, idempotencyKey: string)",
            "getProjectDefaultBrandKit(projectId: string)",
            "setProjectDefaultBrandKit(projectId: string, brandKitId: string, idempotencyKey: string)",
            '"listAssetLibrary"',
            '"createAssetLibraryEntry"',
            '"updateAssetLibraryEntry"',
            '"listBrandKits"',
            '"createBrandKit"',
            '"updateBrandKit"',
            '"getProjectDefaultBrandKit"',
            '"setProjectDefaultBrandKit"',
            'baseUrl = "/api/v1"',
        ),
    )
    require_text(
        WEB_API_CLIENT,
        (
            "mapAssetLibraryEntry",
            "mapBrandKit",
            "refreshAssetLibraryProjection",
            "async refreshAssetLibrary()",
            "async packageAssetLibraryItem(entryId: string)",
            "async createAssetLibraryEntryFromSelection()",
            "async toggleAssetLibraryFavorite(entryId: string)",
            "async archiveAssetLibraryEntry(entryId: string)",
            "async createBrandKitFromLogoAsset(entryId: string)",
            "async updateBrandKitGuidelines(brandKitId: string)",
            "async setDefaultBrandKit(brandKitId: string)",
            'sourceId: `asset-library:${entry.assetId}`',
            'type: "reference"',
            "assetLibraryOperations",
        ),
    )
    require_text(
        WEB_WORKSPACE,
        (
            '"Refresh Asset Library": ["listAssetLibrary", "listBrandKits", "getProjectDefaultBrandKit"]',
            '"Add Asset": ["createAssetLibraryEntry"]',
            '"Favorite Asset": ["updateAssetLibraryEntry"]',
            '"Archive Asset": ["updateAssetLibraryEntry"]',
            '"Create Brand Kit": ["createBrandKit"]',
            '"Update Brand Kit": ["updateBrandKit"]',
            '"Set Brand Kit": ["setProjectDefaultBrandKit"]',
            '"asset-library-refresh"',
            'aria-label="Asset Library and Brand Kit"',
            'data-asset-library-brandkit-ui="stage1.asset-library-brandkit-user-picker"',
            "data-asset-library-sync-status",
            "data-asset-library-operation-contracts",
            "data-asset-library-packaged-count",
            "data-brand-kit-default-palette-count",
            "Refresh Assets",
            'data-asset-library-refresh-contract="listAssetLibrary:GET:not-required:false+listBrandKits:GET:not-required:false+getProjectDefaultBrandKit:GET:not-required:false"',
            'data-asset-library-create-contract="createAssetLibraryEntry:POST:required:true"',
            'data-asset-library-favorite-contract="updateAssetLibraryEntry:PATCH:required:true"',
            'data-asset-library-archive-contract="updateAssetLibraryEntry:PATCH:required:true"',
            'data-brand-kit-create-contract="createBrandKit:POST:required:true"',
            'data-brand-kit-update-contract="updateBrandKit:PATCH:required:true"',
            'data-brand-kit-write-api="createBrandKit,updateBrandKit,setProjectDefaultBrandKit"',
            'data-brand-kit-default-contract="setProjectDefaultBrandKit:PUT:required:true"',
            "zenariClient.refreshAssetLibrary()",
            "zenariClient.packageAssetLibraryItem(item.id)",
            "zenariClient.createAssetLibraryEntryFromSelection()",
            "zenariClient.toggleAssetLibraryFavorite(item.id)",
            "zenariClient.archiveAssetLibraryEntry(item.id)",
            "zenariClient.createBrandKitFromLogoAsset(item.id)",
            "zenariClient.updateBrandKitGuidelines(kit.id)",
            "zenariClient.setDefaultBrandKit(kit.id)",
        ),
    )
    require_text(
        WEB_API_CLIENT_TEST,
        (
            "refreshes asset library and Brand Kit picker data through the read API",
            "packages reusable asset library entries as local references without replacing write API coverage",
            "writes asset library and Brand Kit product actions through idempotent APIs",
            "assetLibraryClient.listAssetLibrary",
            "assetLibraryClient.createAssetLibraryEntry",
            "assetLibraryClient.updateAssetLibraryEntry",
            "assetLibraryClient.listBrandKits",
            "assetLibraryClient.createBrandKit",
            "assetLibraryClient.updateBrandKit",
            "assetLibraryClient.getProjectDefaultBrandKit",
            "assetLibraryClient.setProjectDefaultBrandKit",
            'sourceId: "asset-library:asset_hero_1"',
            'type: "reference"',
        ),
    )
    require_text(
        WEB_WORKSPACE_TEST,
        (
            "renders asset library and Brand Kit picker contract on the workspace",
            'data-asset-library-brandkit-ui", "stage1.asset-library-brandkit-user-picker"',
            'data-asset-library-operation-count", "8"',
            'data-asset-library-operations",',
            "listAssetLibrary,createAssetLibraryEntry,updateAssetLibraryEntry,listBrandKits,createBrandKit,updateBrandKit,getProjectDefaultBrandKit,setProjectDefaultBrandKit",
            "data-asset-library-operation-contracts",
            "data-asset-library-refresh-contract",
            "data-asset-library-create-contract",
            "data-brand-kit-create-contract",
            "data-brand-kit-update-contract",
            "data-brand-kit-default-contract",
            "Launch hero generated image",
            "data-asset-library-lineage-kind",
            "data-asset-library-packaged",
        ),
    )
    require_text(
        WEB_USER_ROUTE_SMOKE,
        (
            "Refresh Asset Library",
            "asset-library-refresh",
            "Refresh Asset Library=>listAssetLibrary:GET:not-required:false+listBrandKits:GET:not-required:false+getProjectDefaultBrandKit:GET:not-required:false",
            "listAssetLibrary",
            "createAssetLibraryEntry",
            "updateAssetLibraryEntry",
            "listBrandKits",
            "createBrandKit",
            "updateBrandKit",
            "getProjectDefaultBrandKit",
            "setProjectDefaultBrandKit",
            "Update Brand Kit",
        ),
    )


def validate_repo_wiring_and_docs() -> None:
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_asset_library_brandkit_contract.py",
            "python3 scripts/validate_stage1_asset_library_brandkit_contract.py",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-2j",
            "scripts/validate_stage1_asset_library_brandkit_contract.py",
            "backend/internal/brandkit",
            "backend/internal/assets/library.go",
            "stage1.asset-library-brandkit-user-picker",
            "web/lib/asset-library-client.ts",
            "web/components/workspace-app.tsx",
            "fixtures/stage1/asset_library_brandkit/local_contract.json",
            "AS-8",
            "AS-9",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_go_packages()
        validate_openapi()
        validate_migration()
        validate_runtime_api()
        validate_frontend_picker()
        validate_repo_wiring_and_docs()
    except AssetBrandKitContractError as exc:
        print(f"stage1 asset library/brand kit contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 asset library/brand kit contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
