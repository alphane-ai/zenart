#!/usr/bin/env python3
"""Validate Stage 1 export object access local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "export_object_access" / "local_contract.json"
RUNTIME = ROOT / "backend" / "internal" / "app" / "runtime.go"
SERVER = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_TEST = ROOT / "backend" / "internal" / "server" / "server_test.go"
STAGE0 = ROOT / "backend" / "internal" / "stage0" / "services.go"
STAGE0_TEST = ROOT / "backend" / "internal" / "stage0" / "services_test.go"
OBJECTSTORE = ROOT / "backend" / "internal" / "objectstore" / "store.go"
OBJECTSTORE_S3 = ROOT / "backend" / "internal" / "objectstore" / "s3.go"
OBJECTSTORE_S3_ERROR = ROOT / "backend" / "internal" / "objectstore" / "s3_error.go"
OBJECTSTORE_PROBE = ROOT / "backend" / "internal" / "objectstore" / "probe.go"
OBJECTSTORE_TEST = ROOT / "backend" / "internal" / "objectstore" / "store_test.go"
EXPORT_MANIFEST = ROOT / "backend" / "internal" / "export" / "manifest.go"
EXPORT_MANIFEST_TEST = ROOT / "backend" / "internal" / "export" / "manifest_test.go"
EXPORT_MANIFEST_FIXTURE = ROOT / "fixtures" / "stage1" / "export_manifest_render" / "local_contract.json"
EXPORT_OPS_FIXTURE = ROOT / "fixtures" / "stage1" / "export_ops" / "local_contract.json"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class ExportObjectAccessContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ExportObjectAccessContractError(message)


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
        raise ExportObjectAccessContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.export_object_access.local-contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "export_object_access_local_contract", "fixture kind mismatch")
    require({"AS-1", "AS-10", "AS-12", "FE-16", "AD-10", "OP-5", "VF-5"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")

    contract = data.get("local_contract")
    require(isinstance(contract, dict), "local_contract must be object")
    require(contract.get("object_key_scope") == "tenant-scoped-storage-key", "object key scope mismatch")
    require(contract.get("product_download_url") == "server-mediated-relative-signed-url", "download URL policy mismatch")
    require(contract.get("download_route") == "GET /api/v1/objects/download", "download route mismatch")
    require(contract.get("runtime_signer_wiring") == "stage0.NewService(...).WithDownloadURLSigner(api.SignDownloadURL)", "runtime signer wiring mismatch")
    for flag in (
        "download_metadata_requires_active_retention",
        "download_audit_required",
        "download_analytics_required",
        "duplicate_query_parameter_rejected",
        "expired_signed_url_rejected",
        "tampered_tenant_key_rejected",
        "invalid_tenant_scope_rejected_before_storage",
        "unsafe_object_key_rejected_before_storage",
        "content_disposition_filename_sanitized",
        "retention_cleanup_marks_metadata_deleted",
        "retention_cleanup_deletes_expired_object_and_marker",
        "retention_cleanup_preserves_unexpired_and_cross_tenant_objects",
    ):
        require(contract.get(flag) is True, f"fixture flag {flag} must be true")
    for flag in (
        "object_store_direct_signing_used_for_export_download",
        "manifest_object_key_persists_signed_url",
        "download_response_discloses_object_key_header",
        "signed_url_material_projected_to_audit_or_analytics",
    ):
        require(contract.get(flag) is False, f"fixture flag {flag} must be false")
    require(set(contract.get("download_metadata_allows_asset_types") or []) == {"export", "thumbnail"}, "download metadata asset types mismatch")

    tests = data.get("required_backend_tests")
    require(isinstance(tests, dict), "required_backend_tests must be object")
    for group, names in tests.items():
        require(isinstance(names, list) and names, f"required backend test group {group} must be non-empty")
        for name in names:
            require(isinstance(name, str) and name.startswith("Test"), f"invalid test name in {group}: {name!r}")

    for ref in data.get("required_source_files") or []:
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_export_object_access_contract") == "pass", "local contract status mismatch")
    require(status.get("strict_staging_signed_url_evidence") == "open", "strict signed URL staging evidence must remain open")
    require(status.get("strict_staging_retention_cleanup_evidence") == "open", "strict retention staging evidence must remain open")
    require(status.get("real_provider_asset_bytes") == "open", "real provider asset bytes must remain open")
    require(status.get("production_object_storage_evidence") == "open", "production object storage evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")
    require(status.get("can_clear_object_storage_do_not_launch") is False, "local contract must not clear object storage DNL")


def validate_runtime_wiring() -> None:
    require_text(
        RUNTIME,
        (
            "api := server.New",
            "stage0.NewService(stage0.NewRepository(db), objects, scanner)",
            "WithDownloadURLTTL(cfg.ObjectStorage.DownloadURLTTL)",
            "WithDownloadURLSigner(api.SignDownloadURL)",
            "stage0.ContextWithService(reqCtx, stage0Service)",
            "audit.ContextWithRecorder(reqCtx, auditStore)",
        ),
    )


def validate_server_download_path() -> None:
    require_text(
        SERVER,
        (
            's.mux.HandleFunc("GET /api/v1/objects/download", s.getSignedDownloadObject)',
            "func (s *Server) getSignedDownloadObject",
            "signedObjectParams(r)",
            '"signed_url_expired"',
            "tenantIDFromScopedObjectKey(key)",
            "s.signDownloadObjectKey(key, expires)",
            "audit.RecorderFromContext(r.Context())",
            "service.GetDownloadableObject(r.Context(), tenantID, key)",
            'Action:   "object.download"',
            '"object_metadata_id": objectMetadata.ID',
            '"signed_access":      true',
            'EventName:   "object_downloaded"',
            'SubjectType: "object_metadata"',
            'w.Header().Set("Cache-Control", "private, no-store, max-age=0")',
            'w.Header().Set("Pragma", "no-cache")',
            'w.Header().Set("Content-Disposition", `attachment; filename="`+downloadFilenameFromKey(reader.Object.Key)+`"`)',
            "func (s *Server) SignDownloadURL",
            "tenantScopedDownloadObjectKey(tenantID, objectKey)",
            "values.Set(\"key\", key)",
            "values.Set(\"sig\", s.signDownloadObjectKey(key, expires))",
            "func tenantIDFromScopedObjectKey",
            "hasUnsafeObjectKeySegment(parts[2])",
            "func downloadFilenameFromKey",
        ),
    )


def validate_stage0_export_access() -> None:
    require_text(
        STAGE0,
        (
            "downloadSigner func(context.Context, string, string, time.Duration) (string, error)",
            "func (s Service) WithDownloadURLSigner",
            "func (s Service) GetDownloadableObject",
            "s.repo.DownloadableObjectMetadata(ctx, tenantID, key, time.Now().UTC())",
            "func (s Service) GetExport",
            "s.downloadSigner != nil",
            "objectDownloadable(*export.Object, now)",
            "objectKey = export.Object.ObjectKey",
            "s.downloadSigner(ctx, tenantID, objectKey, downloadTTLForObject(*export.Object, now, s.downloadURLTTL))",
            "func objectDownloadable",
            "retention_state",
            "retention_until > $3",
            "asset_type IN ('export', 'thumbnail')",
            "security.RedactMap",
            "func (s Service) cleanupExpiredExportsAndOrphanedObjects",
            "s.objects.Delete(ctx, object.TenantID, object.Key)",
            "s.objects.CleanupExpiredForTenant(ctx, tenantID, now)",
            "s.repo.MarkCleanupObjectsDeleted(ctx, deletedObjects, now)",
            "recordCleanupRunAnalyticsForTenant",
            "recordCleanupRunAuditRefsForTenant",
        ),
    )


def validate_objectstore_and_manifest() -> None:
    require_text(
        OBJECTSTORE,
        (
            "type Store interface",
            "SignGetURL(ctx context.Context, tenantID, key string, ttl time.Duration)",
            "CleanupExpired(ctx context.Context, now time.Time)",
            "CleanupExpiredForTenant(ctx context.Context, tenantID string, now time.Time)",
            "func (s LocalStore) Put",
            "object.RetentionUntil.UTC().Format(time.RFC3339)",
            "func (s LocalStore) CleanupExpiredForTenant",
            "tenantIDFromScopedKey(objectKey)",
            "func tenantKey",
            "ErrTenantDenied",
        ),
    )
    require_text(
        EXPORT_MANIFEST,
        (
            "func ValidateFileEntry",
            'strings.ContainsAny(file.ObjectKey, "?#")',
            'strings.Contains(file.ObjectKey, "://")',
            "object_key must be a storage key without query or fragment",
            "secret-like export file field",
        ),
    )
    require_text(
        OBJECTSTORE_S3_ERROR,
        (
            "func s3ErrorSummary",
            "body_sha256=",
            "safeS3ErrorToken",
            "safeS3ErrorMessage",
            "security.RedactString",
        ),
    )
    require_text(
        OBJECTSTORE_S3,
        (
            "s3 get object failed: %s",
            "s3 put object failed: %s",
            "s3 delete object failed: %s",
            "s3 list objects failed: %s",
            "s3ErrorSummary(resp, body)",
        ),
    )
    require_text(
        OBJECTSTORE_PROBE,
        (
            "S3-compatible object storage credentials rejected: %s",
            "s3ErrorSummary(resp, body)",
        ),
    )


def validate_tests() -> None:
    data = load_json(FIXTURE)
    tests = data["required_backend_tests"]
    server_test = read_text(SERVER_TEST)
    stage0_test = read_text(STAGE0_TEST)
    objectstore_test = read_text(OBJECTSTORE_TEST)
    export_test = read_text(EXPORT_MANIFEST_TEST)

    for name in tests["server"]:
        require(name in server_test, f"backend/internal/server/server_test.go missing {name}")
    require("srv.SignDownloadURL(context.Background(), \"tenant_1\", stored.Key, time.Minute)" in server_test, "download happy-path test must use server-mediated signer")
    require("rec.Header().Get(\"X-Zenari-Object-Key\")" in server_test, "download test must assert object key response header is absent")
    require("strings.Contains(mustJSON(t, event.Metadata), downloadURL)" in server_test, "download audit test must reject signed URL leakage")
    require("strings.Contains(mustJSON(t, db.execs[0].args), downloadURL)" in server_test, "download analytics test must reject signed URL leakage")

    for name in tests["stage0"]:
        require(name in stage0_test, f"backend/internal/stage0/services_test.go missing {name}")
    require("object store SignGetURL should not be used for export downloads" in stage0_test, "stage0 export tests must forbid direct object-store signed URL use")
    require("metadata.Metadata[\"public\"] != \"ok\" || strings.Contains(string(metadataBody), \"abcdef\")" in stage0_test, "download metadata test must prove signed URL secret redaction")
    require("retention_state = 'active'" in stage0_test and "retention_until > $3" in stage0_test, "stage0 tests must assert active retention download guard")

    for name in tests["objectstore"]:
        require(name in objectstore_test, f"backend/internal/objectstore/store_test.go missing {name}")
    require("CleanupExpiredForTenant(context.Background(), \"tenant_1\"" in objectstore_test, "objectstore tests must cover tenant-scoped cleanup")
    require("tenant_2 object lookup" in objectstore_test, "objectstore cleanup tests must preserve cross-tenant object")
    for name in (
        "TestS3StorePutErrorDoesNotLeakSecretOrBody",
        "TestS3StoreListErrorDoesNotLeakSecretOrBody",
        "TestHTTPProbeErrorDoesNotLeakSecretOrBody",
    ):
        require(name in objectstore_test, f"backend/internal/objectstore/store_test.go missing {name}")
    require("body_sha256=" in objectstore_test, "objectstore tests must assert safe S3 error body hash")
    require("message=redacted object storage details" in objectstore_test, "objectstore tests must assert redacted S3 response details")

    for name in tests["export_manifest"]:
        require(name in export_test, f"backend/internal/export/manifest_test.go missing {name}")
    require("X-Amz-Signature" in export_test, "export manifest test must reject signed URL query material")


def validate_bridge_fixtures_inventory_and_repo_validate() -> None:
    manifest_fixture = load_json(EXPORT_MANIFEST_FIXTURE)
    require(manifest_fixture.get("schema_version") == "stage1.export_manifest_render.contract.v1", "export manifest fixture schema mismatch")
    status = manifest_fixture.get("non_launch_status") or {}
    require(status.get("signed_url_staging_evidence") == "open", "manifest fixture must keep signed URL staging evidence open")
    require(status.get("object_retention_cleanup_evidence") == "open", "manifest fixture must keep retention cleanup evidence open")

    ops_fixture = load_json(EXPORT_OPS_FIXTURE)
    require(ops_fixture.get("schema_version") == "stage1.export_ops.contract.v1", "export ops fixture schema mismatch")
    ops_status = ops_fixture.get("non_launch_status") or {}
    require(ops_status.get("can_clear_object_retention_gate") is False, "export ops fixture must not clear retention gate")

    require_text(
        GAP_INVENTORY,
        (
            "VF-5g",
            "validate_stage1_export_object_access_contract.py",
            "fixtures/stage1/export_object_access/local_contract.json",
            "server-mediated signed URL",
            "strict staging signed URL",
            "retention cleanup evidence remain open",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_export_object_access_contract.py",
            "python3 scripts/validate_stage1_export_object_access_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_runtime_wiring()
    validate_server_download_path()
    validate_stage0_export_access()
    validate_objectstore_and_manifest()
    validate_tests()
    validate_bridge_fixtures_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except ExportObjectAccessContractError as exc:
        print(f"stage1 export object access contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 export object access contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
