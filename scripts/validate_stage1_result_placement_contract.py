#!/usr/bin/env python3
"""Validate Stage 1 FE-11 result-to-canvas placement local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "result_placement" / "local_contract.json"
RESULT_PLACEMENT = ROOT / "web" / "lib" / "result-placement.ts"
RESULT_PLACEMENT_TEST = ROOT / "web" / "lib" / "result-placement.test.ts"
CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
API_CLIENT = ROOT / "web" / "lib" / "api-client.ts"
API_CLIENT_TEST = ROOT / "web" / "lib" / "api-client.test.ts"
WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
WORKSPACE_TEST = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class ResultPlacementContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ResultPlacementContractError(message)


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
        raise ResultPlacementContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.result-placement-contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "batch_result_to_canvas_asset_library_local_contract", "fixture kind mismatch")
    require({"FE-11", "WK-9", "AS-3", "AS-8", "VF-2"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    policy = data.get("placement_policy")
    require(isinstance(policy, dict), "placement_policy must be object")
    require(policy.get("source") == "succeeded batch child task with asset_id, canvas_object_id, and trace_id", "source policy mismatch")
    require(policy.get("canvas_node_kind") == "generated_layer", "canvas node kind mismatch")
    require(policy.get("asset_library_lineage_kind") == "batch_child_provider_result", "lineage policy mismatch")
    require(policy.get("idempotent_by") == ["canvas_object_id", "asset_id"], "idempotency policy mismatch")
    require(policy.get("edge_source") == "node-brief", "edge source mismatch")
    require(policy.get("canvas_version_snapshot_label") == "Batch result placement", "snapshot label mismatch")
    require(policy.get("raw_provider_payload_projected") is False, "raw provider payload must not project")
    require(policy.get("failed_or_cancelled_child_projected") is False, "failed/cancelled children must not project")
    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_result_placement_contract") == "pass", "local result placement status mismatch")
    require(status.get("local_api_refresh_projection") == "pass", "local API refresh projection status mismatch")
    require(status.get("staging_backend_result_visibility") == "open", "staging backend visibility must remain open")
    require(status.get("real_provider_asset_bytes") == "open", "real provider bytes must remain open")
    require(status.get("signed_url_retention_evidence") == "open", "signed URL/retention evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")


def validate_code() -> None:
    require_text(
        CONTRACTS,
        (
            '"generated_layer"',
            "export interface ResultPlacementEvidence",
            'schema_version: "stage1.result-placement-contract.v1"',
            "raw_provider_payload_projected: false",
        ),
    )
    require_text(
        RESULT_PLACEMENT,
        (
            "export const buildResultPlacementEvidence",
            "export const applyBatchResultPlacement",
            "createCanvasVersionSnapshot",
            "Batch result placement",
            'kind: "generated_layer"',
            'lineageKind: "batch_child_provider_result"',
            'from: "node-brief"',
            "raw_provider_payload_projected: false",
            "child.status === \"succeeded\"",
            "Boolean(child.assetId)",
            "Boolean(child.canvasObjectId)",
            "Boolean(child.traceId)",
        ),
    )
    require_text(
        API_CLIENT,
        (
            "applyBatchResultPlacement",
            "const refreshedBatch = mapBatchFromApi(batch, progress, children.items)",
            "applyBatchResultPlacement(mergeBatchGeneration(state, refreshedBatch), refreshedBatch)",
        ),
    )
    require_text(
        WORKSPACE,
        (
            "buildResultPlacementEvidence",
            "resultPlacementEvidence",
            "data-result-placement-contract",
            "data-result-placement-status",
            "data-result-placement-projected-child-count",
            "data-result-placement-canvas-object-count",
            "data-result-placement-asset-library-entry-count",
            "data-result-placement-latest-child-id",
            "data-result-placement-latest-asset-id",
            "data-result-placement-latest-canvas-object-id",
            "data-result-placement-latest-trace-id",
            "data-result-placement-duplicate-count",
            "data-result-placement-missing-count",
            "data-result-placement-raw-provider-payload",
        ),
    )


def validate_tests() -> None:
    require_text(
        RESULT_PLACEMENT_TEST,
        (
            "Stage 1 result placement contract",
            "projects successful batch children into canvas nodes and asset library entries",
            "keeps repeated progress refreshes idempotent",
            "canvas-batch-001-01",
            "asset-batch-001-01",
            "trace-child-001-01",
            "generated_layer",
            "batch_child_provider_result",
            "raw_provider_payload_projected: false",
        ),
    )
    require_text(
        API_CLIENT_TEST,
        (
            "refreshes batch progress, children, and result ids through the batch API",
            "canvas-batch-001-01",
            "canvas-batch-001-02",
            "generated_layer",
            "asset-batch-001-01",
            "trace-child-001-01",
            "batch_child_provider_result",
        ),
    )
    require_text(
        WORKSPACE_TEST,
        (
            "data-result-placement-contract",
            "stage1.result-placement-contract.v1",
            "data-result-placement-status",
            "data-result-placement-projected-child-count",
            "data-result-placement-canvas-object-count",
            "data-result-placement-asset-library-entry-count",
            "data-result-placement-raw-provider-payload",
        ),
    )


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "FE-11",
            "result placement",
            "validate_stage1_result_placement_contract.py",
            "fixtures/stage1/result_placement/local_contract.json",
            "web/lib/result-placement.ts",
            "real provider result visibility remains open",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_result_placement_contract.py",
            "python3 scripts/validate_stage1_result_placement_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_code()
    validate_tests()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except ResultPlacementContractError as exc:
        print(f"stage1 result placement contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 result placement contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
