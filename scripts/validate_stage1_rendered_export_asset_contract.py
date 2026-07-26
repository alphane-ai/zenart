#!/usr/bin/env python3
"""Validate Stage 1 ZIP rendered asset local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "rendered_export_asset" / "local_contract.json"
CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
DEV_STATE = ROOT / "web" / "lib" / "dev-state.ts"
DEV_STATE_TEST = ROOT / "web" / "lib" / "dev-state.test.ts"
EXPORT_DOWNLOAD_TEST = ROOT / "web" / "lib" / "export-download.test.ts"
WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
WORKSPACE_TEST = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
USER_ROUTES_SMOKE = ROOT / "web" / "validation" / "user-routes-smoke.json"
PACKAGE_EXPORT_SMOKE = ROOT / "web" / "validation" / "package-export-metadata-smoke.json"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class RenderedExportAssetContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RenderedExportAssetContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def forbid_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet not in text, f"{path.relative_to(ROOT)} must not contain stale snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise RenderedExportAssetContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.rendered-export-asset-local-contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "zip_export_rendered_asset_local_contract", "fixture kind mismatch")
    require({"FE-16", "AS-10", "AS-11", "VF-2", "VF-5"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    contract = data.get("local_contract")
    require(isinstance(contract, dict), "local_contract must be object")
    require(contract.get("render_mode") == "deterministic-local-svg-pdf", "render mode mismatch")
    require(contract.get("rendered_asset_manifest_payload") == "assets/local-rendered-asset-manifest.json", "rendered manifest payload mismatch")
    require(contract.get("rendered_asset_payload_prefix") == "assets/rendered/", "rendered prefix mismatch")
    require(contract.get("rendered_asset_content_type") == "image/svg+xml", "rendered content type mismatch")
    require(contract.get("placeholder_payload_count") == 0, "placeholder payload count must be zero")
    require("assets/README.txt" in set(contract.get("placeholder_payloads_disallowed") or []), "fixture must disallow assets/README.txt placeholder")
    require(contract.get("download_access_boundary_contract") == "stage1.export-download-access-boundary-local-contract.v1", "download access boundary contract mismatch")
    require(
        contract.get("download_access_boundary_scenario") == "local-browser-zip-does-not-clear-server-signed-url-or-retention-gates",
        "download access boundary scenario mismatch",
    )
    require(contract.get("product_download_url_policy") == "server-mediated-relative-signed-url", "download URL policy mismatch")
    require(contract.get("server_download_route") == "GET /api/v1/objects/download", "server download route mismatch")
    for flag in (
        "download_metadata_requires_active_retention",
        "download_audit_required",
        "download_analytics_required",
    ):
        require(contract.get(flag) is True, f"fixture flag {flag} must be true")
    require(contract.get("object_store_direct_signing_used_for_export_download") is False, "direct object signing flag must be false")
    for flag in (
        "raw_provider_payload_projected",
        "raw_safety_payload_projected",
        "secret_like_value_projected",
        "signed_url_persisted",
    ):
        require(contract.get(flag) is False, f"fixture flag {flag} must be false")
    anchors = set(data.get("required_ui_anchors") or [])
    require("data-rendered-export-asset-contract" in anchors, "fixture missing rendered asset contract UI anchor")
    require("data-export-download-rendered-asset-status" in anchors, "fixture missing download gate rendered asset anchor")
    require("data-export-download-access-boundary" in anchors, "fixture missing download access boundary button anchor")
    require("data-export-download-access-boundary-contract" in anchors, "fixture missing download access boundary panel anchor")
    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_rendered_export_asset_contract") == "pass", "local status mismatch")
    require(status.get("real_provider_asset_bytes") == "open", "real provider bytes must remain open")
    require(status.get("staging_signed_url_evidence") == "open", "staging signed URL evidence must remain open")
    require(status.get("object_retention_cleanup_evidence") == "open", "retention evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")


def validate_code() -> None:
    require_text(
        CONTRACTS,
        (
            "export interface RenderedExportAssetEvidence",
            "export interface ExportDownloadAccessBoundaryEvidence",
            'schema_version: "stage1.rendered-export-asset-local-contract.v1"',
            'schema_version: "stage1.export-download-access-boundary-local-contract.v1"',
            "local-browser-zip-does-not-clear-server-signed-url-or-retention-gates",
            'productDownloadUrlPolicy: "server-mediated-relative-signed-url"',
            'serverDownloadRoute: "GET /api/v1/objects/download"',
            "objectStoreDirectSigningUsedForExportDownload: false",
            "requiresActiveRetentionMetadata: true",
            "requiresDownloadAudit: true",
            "requiresDownloadAnalytics: true",
            'strictStagingSignedUrlEvidence: "open"',
            'strictStagingRetentionCleanupEvidence: "open"',
            'renderMode: "deterministic-local-svg-pdf"',
            "rawProviderPayloadProjected: false",
            "rawSafetyPayloadProjected: false",
            "secretLikeValueProjected: false",
            "signedUrlPersisted: false",
            'stagingSignedUrlEvidence: "open"',
            'objectRetentionCleanupEvidence: "open"',
            "canClearStage1StagingRuntimeGate: false",
            "canClearStage1ProductionLaunchGate: false",
        ),
    )
    dev_state = require_text(
        DEV_STATE,
        (
            'renderedAssetManifestPayloadName = "assets/local-rendered-asset-manifest.json"',
            "buildRenderedExportAssetEntries",
            "buildRenderedExportAssetManifestPayload",
            "buildRenderedExportAssetEvidence",
            "buildExportDownloadAccessBoundaryEvidence",
            "toRenderedAssetPayloadName",
            'contentType: "image/svg+xml"',
            '"stage1.rendered-export-asset-local-manifest.v1"',
            '"stage1.rendered-export-asset-local-contract.v1"',
            '"stage1.export-download-access-boundary-local-contract.v1"',
            '"server-mediated-relative-signed-url"',
            '"GET /api/v1/objects/download"',
            "objectStoreDirectSigningUsedForExportDownload: false",
            "strictStagingSignedUrlEvidence: \"open\"",
            "strictStagingRetentionCleanupEvidence: \"open\"",
            'signedUrlPersisted: false',
            'stagingSignedUrlEvidence: "open"',
            'objectRetentionCleanupEvidence: "open"',
            "canClearStage1StagingRuntimeGate: false",
            "canClearStage1ProductionLaunchGate: false",
        ),
    )
    require("outputName === \"assets/\" ? renderedAssetManifestPayloadName" in dev_state, "assets/ must map to rendered asset manifest")
    require("isSafeExportZipPayloadName(outputName)" in dev_state, "rendered payload mapping must keep unsafe manifest output guard")
    require("zipPayloadNames.includes(renderedAssetManifestPayloadName)" in dev_state, "download artifact gate must require rendered asset manifest")
    forbid_text(DEV_STATE, ('assets/README.txt",', '"assets-readme"',))
    require_text(
        WORKSPACE,
        (
            "buildRenderedExportAssetEvidence",
            "renderedAssetEvidence",
            "data-rendered-export-asset-contract",
            "data-rendered-export-asset-status",
            "data-rendered-export-asset-render-mode",
            "data-rendered-export-asset-manifest-payload",
            "data-rendered-export-asset-payload-count",
            "data-rendered-export-asset-placeholder-count",
            "data-rendered-export-asset-signed-url-persisted",
            "data-rendered-export-asset-staging-signed-url-evidence",
            "data-rendered-export-asset-retention-evidence",
            "data-rendered-export-asset-can-clear-staging",
            "data-rendered-export-asset-can-clear-production",
            "data-export-download-rendered-asset-status",
            "data-export-download-placeholder-payload-count",
            "data-export-download-access-boundary",
            "data-export-download-access-boundary-status",
            "data-export-download-url-policy",
            "data-export-download-direct-object-signing",
            "data-export-download-strict-staging-signed-url-evidence",
            "data-export-download-strict-staging-retention-evidence",
            "data-export-download-can-clear-staging",
            "data-export-download-can-clear-production",
            "data-export-download-can-clear-object-storage-dnl",
            "data-export-download-access-boundary-contract",
            "data-export-download-access-boundary-server-route",
            "data-export-download-access-boundary-requires-active-retention",
            "data-export-download-access-boundary-requires-audit",
            "data-export-download-access-boundary-requires-analytics",
        ),
    )


def validate_tests_and_static_artifacts() -> None:
    require_text(
        DEV_STATE_TEST,
        (
            "builds rendered export asset local evidence without placeholder payloads",
            "buildRenderedExportAssetEvidence",
            "buildExportDownloadAccessBoundaryEvidence",
            "stage1.rendered-export-asset-local-contract.v1",
            "stage1.export-download-access-boundary-local-contract.v1",
            "assets/local-rendered-asset-manifest.json",
            "assets/rendered/square_social_ad-png.svg",
            "placeholderPayloadCount: 0",
            "signedUrlPersisted: false",
            'stagingSignedUrlEvidence: "open"',
            'strictStagingSignedUrlEvidence: "open"',
            'strictStagingRetentionCleanupEvidence: "open"',
            "canClearStage1StagingRuntimeGate: false",
        ),
    )
    require_text(
        EXPORT_DOWNLOAD_TEST,
        (
            "buildRenderedExportAssetEvidence",
            "renderedAssetManifestPayloadName",
            "stage1.rendered-export-asset-local-manifest.v1",
            "assets/rendered/square_social_ad-png.svg",
            'expect(zip.file("assets/README.txt")).toBeNull()',
            "objectRetentionCleanupEvidence: \"open\"",
        ),
    )
    require_text(
        WORKSPACE_TEST,
        (
            "Rendered export asset local contract",
            "stage1.rendered-export-asset-local-contract.v1",
            "data-rendered-export-asset-status",
            "data-rendered-export-asset-placeholder-count",
            "data-rendered-export-asset-staging-signed-url-evidence",
            "data-export-download-rendered-asset-status",
            "stage1.export-download-access-boundary-local-contract.v1",
            "Export download access boundary",
            "data-export-download-access-boundary-status",
            "data-export-download-access-boundary-url-policy",
            "data-export-download-access-boundary-server-route",
            "data-export-download-access-boundary-strict-staging-signed-url-evidence",
            "data-export-download-access-boundary-strict-staging-retention-evidence",
            "data-export-download-access-boundary-can-clear-staging",
            "data-export-download-access-boundary-can-clear-production",
            "data-export-download-access-boundary-can-clear-object-storage-dnl",
            "data-export-download-access-boundary",
            "data-export-download-url-policy",
            "data-export-download-strict-staging-signed-url-evidence",
            "data-export-download-can-clear-staging",
            "assets/rendered/square_social_ad-png.svg",
        ),
    )
    for path in (USER_ROUTES_SMOKE, PACKAGE_EXPORT_SMOKE):
        text = require_text(
            path,
            (
                "assets/local-rendered-asset-manifest.json",
                "assets/rendered/square_social_ad-png.svg",
            ),
        )
        require("assets/README.txt" not in text, f"{path.relative_to(ROOT)} must not keep placeholder README payload")


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-2ih",
            "validate_stage1_rendered_export_asset_contract.py",
            "fixtures/stage1/rendered_export_asset/local_contract.json",
            "rendered asset manifest",
            "assets/local-rendered-asset-manifest.json",
            "staging signed URL evidence remains open",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_rendered_export_asset_contract.py",
            "python3 scripts/validate_stage1_rendered_export_asset_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_code()
    validate_tests_and_static_artifacts()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except RenderedExportAssetContractError as exc:
        print(f"stage1 rendered export asset contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 rendered export asset contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
