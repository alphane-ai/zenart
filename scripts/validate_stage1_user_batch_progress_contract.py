#!/usr/bin/env python3
"""Validate Stage 1 user batch progress polling contract."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "user_batch_progress" / "progress_polling.json"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
WEB_GENERATED = ROOT / "web" / "lib" / "generated" / "zenart-api.ts"
WEB_BATCH_CLIENT = ROOT / "web" / "lib" / "batch-client.ts"
WEB_API_CLIENT = ROOT / "web" / "lib" / "api-client.ts"
WEB_CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
WORKSPACE_TEST = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
PLAYWRIGHT_TEST = ROOT / "web" / "tests" / "stage1-batch-generation.spec.ts"
WEB_PACKAGE = ROOT / "web" / "package.json"
API_CLIENT_TEST = ROOT / "web" / "lib" / "api-client.test.ts"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)


class UserBatchProgressContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise UserBatchProgressContractError(message)


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
        raise UserBatchProgressContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture(data: dict[str, Any]) -> None:
    require(data.get("fixture_id") == "user_batch_progress_polling", "unexpected fixture_id")
    require(data.get("contract_version") == 1, "contract_version must be 1")
    require(
        data.get("release_gate_status") == "contract_ready_staging_playwright_sse_evidence_open",
        "fixture must keep staging Playwright/SSE evidence open",
    )
    operations = data.get("api_operations")
    require(isinstance(operations, list) and len(operations) == 3, "fixture must list three GET operations")
    expected = {
        "getBatchGeneration": "/batch-generations/{batch_id}",
        "listBatchGenerationChildren": "/batch-generations/{batch_id}/children",
        "getBatchGenerationProgress": "/batch-generations/{batch_id}/progress",
    }
    seen = set()
    for operation in operations:
        require(isinstance(operation, dict), "api operation must be an object")
        operation_id = operation.get("operation_id")
        require(operation_id in expected, f"unexpected operation_id {operation_id!r}")
        seen.add(operation_id)
        require(operation.get("method") == "GET", f"{operation_id} must be GET")
        require(operation.get("path") == expected[operation_id], f"{operation_id} path drift")
        require(operation.get("credentials") == "include", f"{operation_id} must use same-site credentials")
        require(operation.get("csrf_header") == "not-required", f"{operation_id} must remain safe GET")
        require(operation.get("idempotency_required") is False, f"{operation_id} must not require idempotency")
    require(seen == set(expected), "fixture operation coverage mismatch")

    polling = data.get("polling_contract")
    require(isinstance(polling, dict), "polling_contract is required")
    require(polling.get("surface") == "web/components/workspace-app.tsx", "polling surface drift")
    require(polling.get("trigger") == "authenticated workspace view with latest queued or running batch", "polling trigger drift")
    require(polling.get("strategy") == "single timeout rescheduled by state changes", "polling strategy drift")
    require(polling.get("interval_ms") == 750, "polling interval drift")
    require(polling.get("manual_unsafe_action_added") is False, "polling must not add a manual unsafe action")
    require(polling.get("sync_statuses") == ["local", "api", "unavailable"], "sync statuses drift")

    projection = data.get("api_projection")
    require(isinstance(projection, dict), "api_projection is required")
    require(projection.get("status") == "partial_succeeded", "projection must use OpenAPI batch status")
    require(projection.get("progress_percent") == 100, "projection progress_percent drift")
    require(projection.get("retryable") == 1, "projection retryable drift")
    for key in ("result_asset_id", "result_canvas_object_id"):
        require(isinstance(projection.get(key), str) and projection[key], f"projection {key} is required")

    attributes = data.get("ui_contract_attributes")
    require(isinstance(attributes, list), "ui_contract_attributes must be a list")
    for attribute in (
        "data-batch-generation-progress-sync-status",
        "data-batch-generation-progress-synced-at",
        "data-batch-generation-progress-polling",
        "data-batch-generation-progress-operations",
        "data-batch-generation-result-asset-id",
        "data-batch-generation-result-canvas-object-id",
    ):
        require(attribute in attributes, f"missing UI attribute {attribute}")

    browser = data.get("local_browser_workflow")
    require(isinstance(browser, dict), "local_browser_workflow is required")
    require(browser.get("spec") == "web/tests/stage1-batch-generation.spec.ts", "local browser spec path drift")
    require(
        browser.get("script") == "npm --prefix web run smoke:stage1-batch-generation-playwright",
        "local browser script drift",
    )
    require(browser.get("surface") == "/workspace", "local browser surface drift")
    require(browser.get("evidence_classification") == "local_browser_contract_only", "browser evidence classification drift")
    browser_coverage = browser.get("coverage")
    require(isinstance(browser_coverage, list), "browser coverage must be a list")
    for coverage in (
        "Create Batch CSRF-guarded browser action",
        "local progress panel status/count/progress attributes",
        "Retry Child CSRF-guarded browser action",
        "Cancel Batch CSRF-guarded browser action",
        "progressbar and child-row visibility",
    ):
        require(coverage in browser_coverage, f"missing browser coverage {coverage!r}")

    remaining = data.get("remaining_staging_evidence")
    require(isinstance(remaining, list), "remaining_staging_evidence must be a list")
    for evidence in (
        "Playwright create/progress/cancel/retry workflow against deployed backend",
        "SSE or production-grade polling cadence evidence",
        "real provider-generated result asset and canvas object visibility",
        "staging worker-to-user progress latency evidence",
    ):
        require(evidence in remaining, f"missing remaining evidence {evidence!r}")
    require("Local user batch progress polling contract and local browser workflow coverage exist" in data.get("release_note", ""), "release_note must mention local browser coverage")
    require("deployed-backend staging Playwright workflow" in data.get("release_note", ""), "release_note must preserve staging caveat")


def validate_code_anchors() -> None:
    require_text(
        OPENAPI,
        (
            "operationId: getBatchGeneration",
            "operationId: listBatchGenerationChildren",
            "operationId: getBatchGenerationProgress",
            "description: Aggregated batch progress for polling UI.",
            "BatchProgress:",
            "retryable:",
        ),
    )
    require_text(
        WEB_GENERATED,
        (
            'getBatchGeneration: { method: "GET", path: "/batch-generations/{batch_id}"',
            'listBatchGenerationChildren: { method: "GET", path: "/batch-generations/{batch_id}/children"',
            'getBatchGenerationProgress: { method: "GET", path: "/batch-generations/{batch_id}/progress"',
        ),
    )
    require_text(
        WEB_BATCH_CLIENT,
        (
            "export interface BatchClient",
            "getBatchGeneration(batchId: string)",
            "listBatchGenerationChildren(batchId: string)",
            "getBatchGenerationProgress(batchId: string)",
            'this.apiClient.request<BatchProgress>("getBatchGenerationProgress"',
            'pathParams: {',
            "batch_id: batchId",
        ),
    )
    require_text(
        WEB_CONTRACTS,
        (
            "refreshBatchGenerationProgress(batchId: string): Promise<WorkspaceState>",
            'progressSyncStatus: "local" | "api" | "unavailable"',
            "progressSyncedAt?: string",
            "retryableCount: number",
            '"partial_succeeded"',
        ),
    )
    require_text(
        WEB_API_CLIENT,
        (
            "private readonly batchClient: BatchClient = createBatchClient()",
            "mapBatchFromApi",
            "refreshBatchGenerationProgress(batchId: string)",
            "this.batchClient.getBatchGeneration(batchId)",
            "this.batchClient.getBatchGenerationProgress(batchId)",
            "this.batchClient.listBatchGenerationChildren(batchId)",
            'progressSyncStatus: "api"',
            'progressSyncStatus: "unavailable"',
        ),
    )
    require_text(
        WORKSPACE,
        (
            "refreshBatchGenerationProgress(latestBatch.id)",
            "window.setTimeout",
            "data-batch-generation-progress-sync-status",
            "data-batch-generation-progress-polling",
            "data-batch-generation-progress-operations",
            "data-batch-generation-result-asset-id",
            "data-batch-generation-result-canvas-object-id",
            "Batch generation progress",
        ),
    )
    require_text(
        API_CLIENT_TEST,
        (
            "refreshes batch progress, children, and result ids through the batch API",
            "getBatchGenerationProgress",
            "listBatchGenerationChildren",
            "asset-batch-001-01",
            "canvas-batch-001-01",
            "partial_succeeded",
            'progressSyncStatus: "api"',
        ),
    )
    require_text(
        WORKSPACE_TEST,
        (
            "data-batch-generation-progress-sync-status",
            "data-batch-generation-progress-polling",
            "data-batch-generation-progress-operations",
            "Batch generation progress",
        ),
    )
    require_text(
        PLAYWRIGHT_TEST,
        (
            "workspace batch generation create, progress, retry, and cancel browser workflow remains locally covered",
            "data-batch-generation-contract",
            "data-batch-generation-latest-status",
            "data-batch-generation-progress-polling",
            "data-batch-generation-progress-operations",
            "Create Batch",
            "Retry Child",
            "Cancel Batch",
            "Batch generation progress",
            "child-001-04",
        ),
    )
    require_text(
        WEB_PACKAGE,
        (
            '"smoke:stage1-batch-generation-playwright": "playwright test tests/stage1-batch-generation.spec.ts"',
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "FE-10",
            "WK-7",
            "batch progress",
            "local browser workflow coverage",
        ),
    )
    require_text(REPO_VALIDATE, ("validate_stage1_user_batch_progress_contract.py",))


def main() -> int:
    try:
        validate_fixture(load_fixture())
        validate_code_anchors()
    except UserBatchProgressContractError as exc:
        print(f"stage1 user batch progress contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 user batch progress contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
