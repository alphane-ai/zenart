#!/usr/bin/env python3
"""Validate Stage 1 AS-10/AS-11 export manifest/render local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "export_manifest_render" / "local_contract.json"
EXPORT_MANIFEST = ROOT / "backend" / "internal" / "export" / "manifest.go"
EXPORT_TEST = ROOT / "backend" / "internal" / "export" / "manifest_test.go"
EXPORT_OPS_FIXTURE = ROOT / "fixtures" / "stage1" / "export_ops" / "local_contract.json"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

FILE_ROLES = {
    "rendered_asset",
    "manifest",
    "qa_report",
    "metadata",
    "trace_provenance",
    "safety_disclaimer",
    "psd_layer_manifest",
}
FILE_FORMATS = {"png", "svg", "pdf", "psd_manifest", "json", "md"}
REQUIRED_ZIP_ENTRIES = {
    "manifest.json",
    "qa_report.json",
    "metadata.json",
    "trace_provenance.json",
    "safety_disclaimer.md",
}
RETAINED_WHEN_BLOCKED = {"qa_report.json", "trace_provenance.json", "safety_disclaimer.md"}


class ExportManifestRenderContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ExportManifestRenderContractError(message)


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
        raise ExportManifestRenderContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.export_manifest_render.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "export_manifest_render_local_contract", "fixture kind mismatch")
    require({"AS-10", "AS-11", "QA-4", "FE-16", "AD-10"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")

    contract = data.get("manifest_contract")
    require(isinstance(contract, dict), "manifest_contract must be object")
    require(contract.get("package") == "backend/internal/export", "manifest package mismatch")
    require(contract.get("go_package") == "exportkit", "manifest Go package mismatch")
    require(
        set(contract.get("required_functions") or [])
        == {
            "ValidateManifest",
            "ValidateFileEntry",
            "EvaluateGate",
            "BuildRenderPlan",
            "ValidFileRole",
            "ValidFileFormat",
            "StableHash",
        },
        "required functions mismatch",
    )
    require(set(contract.get("file_roles") or []) == FILE_ROLES, "file roles mismatch")
    require(set(contract.get("file_formats") or []) == FILE_FORMATS, "file formats mismatch")
    require(set(contract.get("required_zip_entries") or []) == REQUIRED_ZIP_ENTRIES, "required zip entries mismatch")
    require(set(contract.get("retained_when_blocked") or []) == RETAINED_WHEN_BLOCKED, "blocked retention file set mismatch")
    for flag in (
        "qa_report_required",
        "safety_report_required",
        "trace_provenance_required",
        "license_required",
        "disclaimer_required",
        "fail_closed_when_incomplete",
        "object_keys_must_not_be_signed_urls",
        "secret_like_manifest_rejection",
    ):
        require(contract.get(flag) is True, f"manifest flag {flag} must be true")
    require(contract.get("placeholder_rendered_asset_allowed") is False, "placeholder rendered assets must be disallowed")
    require(contract.get("psd_output_policy") == "layer_manifest_only_until_real_psd_renderer", "PSD output policy mismatch")
    require(contract.get("raw_payload_persisted") is False, "raw payload persistence flag mismatch")

    tests = data.get("focused_tests")
    require(isinstance(tests, dict), "focused_tests must be object")
    require(
        set(tests.get("go") or [])
        == {
            "TestBuildRenderPlanIncludesManifestQAProvenanceAndDisclaimer",
            "TestEvaluateGateFailsClosedForMissingQAProvenanceAndSafety",
            "TestPlaceholderRenderedOutputCannotBePromotedAsFinishedExport",
            "TestPSDLayerManifestIsAllowedButPlaceholderPSDManifestIsBlocked",
            "TestValidateManifestRejectsSignedURLAndSecretLikeFields",
        },
        "focused Go tests mismatch",
    )

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_export_manifest_render_contract") == "pass", "local contract status mismatch")
    require(status.get("real_png_svg_pdf_renderer") == "open", "real renderer must remain open")
    require(status.get("real_psd_renderer") == "open", "real PSD renderer must remain open")
    require(status.get("signed_url_staging_evidence") == "open", "signed URL evidence must remain open")
    require(status.get("object_retention_cleanup_evidence") == "open", "object retention evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")


def validate_export_code() -> None:
    text = require_text(
        EXPORT_MANIFEST,
        (
            "package exportkit",
            "type FileRole string",
            "FileRoleRenderedAsset",
            "FileRoleManifest",
            "FileRoleQAReport",
            "FileRoleMetadata",
            "FileRoleTraceProvenance",
            "FileRoleSafetyDisclaimer",
            "FileRolePSDLayerManifest",
            "type FileFormat string",
            "FileFormatPNG",
            "FileFormatSVG",
            "FileFormatPDF",
            "FileFormatPSDManifest",
            "type FileEntry struct",
            "type QAReport struct",
            "type SafetyReport struct",
            "type Provenance struct",
            "type Manifest struct",
            "type GateDecision struct",
            "type RenderPlan struct",
            "func ValidateManifest",
            "func ValidateFileEntry",
            "func EvaluateGate",
            "func BuildRenderPlan",
            "func ValidFileRole",
            "func ValidFileFormat",
            "func StableHash",
            "json.Marshal(value)",
            "placeholder file",
            "cannot be promoted as rendered output",
            "QA report is required",
            "safety report is required",
            "trace provenance is required",
            "license and disclaimer refs are required",
            "object_key must be a storage key without query or fragment",
            "secret-like export manifest field",
            "secret-like export file field",
            "placeholder_rendered_output",
            "qa_report_not_pass",
            "safety_not_allowed",
            "manifest.json",
            "qa_report.json",
            "metadata.json",
            "trace_provenance.json",
            "safety_disclaimer.md",
            "RawPayloadSafe: true",
        ),
    )
    for role in FILE_ROLES:
        require(f'"{role}"' in text, f"export manifest missing file role literal {role}")
    for file_format in FILE_FORMATS:
        require(f'"{file_format}"' in text, f"export manifest missing file format literal {file_format}")


def validate_tests() -> None:
    require_text(
        EXPORT_TEST,
        (
            "TestBuildRenderPlanIncludesManifestQAProvenanceAndDisclaimer",
            "TestEvaluateGateFailsClosedForMissingQAProvenanceAndSafety",
            "TestPlaceholderRenderedOutputCannotBePromotedAsFinishedExport",
            "TestPSDLayerManifestIsAllowedButPlaceholderPSDManifestIsBlocked",
            "TestValidateManifestRejectsSignedURLAndSecretLikeFields",
            "manifest.json",
            "qa_report.json",
            "metadata.json",
            "trace_provenance.json",
            "safety_disclaimer.md",
            "placeholder_rendered_output",
            "psd_manifest",
            "X-Amz-Signature",
            "Bearer abcdefghijklmnop",
            "ErrExportValidation",
        ),
    )


def validate_export_ops_bridge() -> None:
    data = load_json(EXPORT_OPS_FIXTURE)
    require(data.get("schema_version") == "stage1.export_ops.contract.v1", "export ops fixture schema mismatch")
    require("AD-10" in set(data.get("blueprint_items") or []), "export ops fixture must still cover AD-10")
    require("AS-10" in set(data.get("blueprint_items") or []), "export ops fixture must bridge AS-10")


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-5d",
            "validate_stage1_export_manifest_render_contract.py",
            "fixtures/stage1/export_manifest_render/local_contract.json",
            "AS-10",
            "AS-11",
            "placeholder rendered assets",
            "Real PNG/SVG/PDF rendering",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_export_manifest_render_contract.py",
            "python3 scripts/validate_stage1_export_manifest_render_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_export_code()
    validate_tests()
    validate_export_ops_bridge()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except ExportManifestRenderContractError as exc:
        print(f"stage1 export manifest/render contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 export manifest/render contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
