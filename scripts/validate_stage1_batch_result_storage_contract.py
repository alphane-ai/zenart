#!/usr/bin/env python3
"""Validate Stage 1 batch result object-storage ref contract."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "batch_result_storage" / "object_store_refs.json"
RESULT_SINK = ROOT / "backend" / "internal" / "task" / "batch_result_sink.go"
RESULT_SINK_TEST = ROOT / "backend" / "internal" / "task" / "batch_result_sink_test.go"
WORKER_MAIN = ROOT / "backend" / "cmd" / "worker" / "main.go"
BATCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_batch_generation_contract.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)


class BatchResultStorageContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise BatchResultStorageContractError(message)


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
        raise BatchResultStorageContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture(data: dict[str, Any]) -> None:
    require(data.get("fixture_id") == "batch_result_object_storage_refs", "unexpected fixture_id")
    require(data.get("contract_version") == 1, "contract_version must be 1")
    require(data.get("result_sink") == "postgres_asset_canvas_object_store", "result_sink must use object-store path")
    require(data.get("release_gate_status") == "contract_ready_real_rendered_asset_staging_evidence_open", "fixture must not close staging rendered asset gate")

    result_object = data.get("result_object")
    thumbnail_object = data.get("thumbnail_object")
    require(isinstance(result_object, dict), "result_object is required")
    require(isinstance(thumbnail_object, dict), "thumbnail_object is required")
    for name, item in (("result_object", result_object), ("thumbnail_object", thumbnail_object)):
        object_key = item.get("object_key")
        require(isinstance(object_key, str) and object_key.startswith("tenants/tenant_1/"), f"{name}.object_key must be tenant scoped")
        require("?" not in object_key and "#" not in object_key, f"{name}.object_key must not contain query or fragment")
        require(item.get("bucket") == "zenari-stage1-results", f"{name}.bucket drift")
        require(item.get("storage_state") == "object_store_ref_ready", f"{name}.storage_state must be object_store_ref_ready")
        require(item.get("raw_provider_payload_saved") is False, f"{name} must not persist raw provider payload")

    require(result_object.get("content_type") == "application/vnd.zenari.batch-result+json", "result content type drift")
    require(thumbnail_object.get("content_type") == "application/vnd.zenari.thumbnail+json", "thumbnail content type drift")
    require(thumbnail_object.get("asset_type") == "thumbnail", "thumbnail asset_type drift")
    require(thumbnail_object.get("placeholder_promoted") is False, "thumbnail must not promote placeholder as final asset")

    projection = data.get("asset_projection")
    require(isinstance(projection, dict), "asset_projection is required")
    for key in ("object_ref_persisted", "thumbnail_persisted", "lineage_persisted"):
        require(projection.get(key) is True, f"asset_projection.{key} must be true")
    require(projection.get("trace_projection") == "object_store_manifest", "trace_projection must cite object_store_manifest")

    remaining = data.get("remaining_staging_evidence")
    require(isinstance(remaining, list), "remaining_staging_evidence must be a list")
    for evidence in (
        "provider-generated binary image stored in object storage",
        "rendered thumbnail or poster object stored in object storage",
        "staging BatchRunner result-sink evidence with persisted asset/canvas ids",
        "signed URL download and retention cleanup proof for generated batch outputs",
    ):
        require(evidence in remaining, f"missing remaining evidence {evidence!r}")
    require("real provider image bytes" in data.get("release_note", ""), "release_note must preserve real image-byte caveat")


def validate_code_anchors() -> None:
    result_text = require_text(
        RESULT_SINK,
        (
            "objectstore.Store",
            "batch result object store is required",
            "persistBatchResultObjects",
            "batchResultStorageManifest",
            "batchResultThumbnailManifest",
            "application/vnd.zenari.batch-result+json",
            "application/vnd.zenari.thumbnail+json",
            "object_store_ref_ready",
            "storage_ref",
            "thumbnail_ref",
            "raw_provider_payload_saved",
            "placeholder_promoted",
            "Delete(context.Background(), input.Child.TenantID, storedResult.Key)",
            "Delete(context.Background(), input.Child.TenantID, storedThumbnail.Key)",
            "postgres_asset_canvas_object_store",
            "object_ref_persisted",
            "thumbnail_persisted",
        ),
    )
    require("metadata_only_pending_object_storage" not in result_text, "result sink must not keep metadata-only storage state")
    require("'metadata-only'" not in result_text and '"metadata-only"' not in result_text, "result sink must not write metadata-only bucket")

    require_text(
        RESULT_SINK_TEST,
        (
            "TestPostgresBatchResultSinkPersistsObjectRefsAssetAndCanvasWithoutRawProviderOutput",
            "batchFakeObjectStore",
            "object puts =",
            "object payload leaked raw provider output",
            "thumbnail metadata",
            "raw_provider_payload_saved",
            "postgres_asset_canvas_object_store",
            "TestPostgresBatchResultSinkRequiresObjectStore",
            "TestPostgresBatchResultSinkCleansObjectStoreOnDatabaseFailure",
        ),
    )
    require_text(
        WORKER_MAIN,
        (
            "batchObjects, err := objectstore.NewStore(cfg.ObjectStorage, nil)",
            "worker batch object store open failed",
            "NewPostgresBatchResultSink(store.NewPoolAdapter(pool), batchObjects)",
        ),
    )
    require_text(
        BATCH_VALIDATOR,
        (
            "object_store_ref_ready",
            "thumbnail_metadata_id",
            "provider_output_sig",
        ),
    )
    require_text(REPO_VALIDATE, ("validate_stage1_batch_result_storage_contract.py",))
    require_text(
        GAP_INVENTORY,
        (
            "object-store manifest refs",
            "thumbnail refs",
            "real provider image bytes",
        ),
    )


def main() -> int:
    try:
        validate_fixture(load_fixture())
        validate_code_anchors()
    except BatchResultStorageContractError as exc:
        print(f"stage1 batch result storage contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 batch result storage contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
