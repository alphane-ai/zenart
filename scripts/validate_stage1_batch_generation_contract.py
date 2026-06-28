#!/usr/bin/env python3
"""Validate Stage 1 batch generation contract fixtures and code anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ROOT / "fixtures" / "stage1" / "batch_generation"
TASK_CONTRACT = ROOT / "backend" / "internal" / "task" / "batch_generation.go"
BATCH_REPOSITORY = ROOT / "backend" / "internal" / "task" / "batch_repository.go"
BATCH_SCHEDULER = ROOT / "backend" / "internal" / "task" / "batch_scheduler.go"
BATCH_EXECUTOR = ROOT / "backend" / "internal" / "task" / "batch_executor.go"
BATCH_RESULT_SINK = ROOT / "backend" / "internal" / "task" / "batch_result_sink.go"
BATCH_QUOTA_LEDGER = ROOT / "backend" / "internal" / "task" / "batch_quota_ledger.go"
WORKER_BATCH_RUNNER = ROOT / "backend" / "internal" / "worker" / "batch_runner.go"
TASK_TEST = ROOT / "backend" / "internal" / "task" / "batch_generation_test.go"
WORKER_BATCH_RUNNER_TEST = ROOT / "backend" / "internal" / "worker" / "batch_runner_test.go"
CONFIG = ROOT / "backend" / "internal" / "config" / "config.go"
CONFIG_TEST = ROOT / "backend" / "internal" / "config" / "config_test.go"
WORKER_MAIN = ROOT / "backend" / "cmd" / "worker" / "main.go"
WORKER_MAIN_TEST = ROOT / "backend" / "cmd" / "worker" / "main_test.go"
SERVER = ROOT / "backend" / "internal" / "server" / "server.go"
SERVER_TEST = ROOT / "backend" / "internal" / "server" / "server_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_QUEUE_PAGE = ROOT / "admin" / "app" / "queues" / "page.tsx"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
MIGRATION = ROOT / "backend" / "migrations" / "0011_stage1_provider_batch_contracts.sql"
ENV_EXAMPLE = ROOT / ".env.example"
DOCKER_COMPOSE = ROOT / "docker-compose.yml"

REQUIRED_FIXTURES = {
    "single",
    "four_variants",
    "twenty_variants",
    "partial_failure",
    "cancelled",
    "quota_insufficient",
}

BATCH_STATUSES = {
    "queued",
    "running",
    "partial_succeeded",
    "succeeded",
    "failed",
    "cancelled",
    "blocked",
}

CHILD_STATUSES = {
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "blocked",
}

NON_RETRYABLE_FAILURE_CODES = {
    "provider_request_invalid",
    "provider_usage_record_failed",
    "result_sink_unavailable",
    "result_persistence_failed",
    "result_persistence_missing_ids",
    "quota_insufficient",
    "safety_rejected",
    "safety_review_required",
    "content_blocked",
}

PROJECTION_FORBIDDEN_KEYS = {
    "secret",
    "secret_ref",
    "api_key",
    "provider_payload",
    "raw_provider_payload",
    "hidden_prompt",
    "raw_safety_payload",
    "internal_routing",
    "routing",
    "cost_cents",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)


class BatchContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise BatchContractError(message)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BatchContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    return data


def aggregate_status(children: list[dict[str, Any]]) -> str:
    if not children:
        return "queued"
    counts = {status: 0 for status in CHILD_STATUSES}
    for child in children:
        counts[child["status"]] += 1
    if counts["running"] > 0:
        return "running"
    if counts["queued"] > 0:
        if sum(counts[status] for status in ("succeeded", "failed", "cancelled", "blocked")) > 0:
            return "running"
        return "queued"
    if counts["blocked"] > 0 and counts["succeeded"] + counts["failed"] + counts["cancelled"] == 0:
        return "blocked"
    if counts["cancelled"] > 0 and counts["succeeded"] + counts["failed"] + counts["blocked"] == 0:
        return "cancelled"
    if counts["failed"] > 0 and counts["succeeded"] == 0 and counts["blocked"] == 0:
        return "failed"
    if counts["succeeded"] == len(children):
        return "succeeded"
    return "partial_succeeded"


def walk_projection(value: Any, path: str = "user_projection") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = key.lower()
            require(
                normalized not in PROJECTION_FORBIDDEN_KEYS,
                f"{path}.{key} exposes admin/provider-only field",
            )
            walk_projection(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            walk_projection(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains a raw secret-looking value")


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    text = path.read_text(encoding="utf-8")
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing contract snippet {snippet!r}")


def validate_fixture(path: Path) -> str:
    data = load_json(path)
    fixture_id = data.get("fixture_id")
    require(isinstance(fixture_id, str) and fixture_id, f"{path.name} missing fixture_id")
    require(data.get("contract_version") == 1, f"{fixture_id} contract_version must be 1")
    batch = data.get("batch")
    children = data.get("children")
    progress = data.get("progress")
    projection = data.get("user_projection")
    require(isinstance(batch, dict), f"{fixture_id} missing batch object")
    require(isinstance(children, list), f"{fixture_id} missing children array")
    require(isinstance(progress, dict), f"{fixture_id} missing progress object")
    require(isinstance(projection, dict), f"{fixture_id} missing user_projection object")

    batch_id = batch.get("id")
    tenant_id = batch.get("tenant_id")
    require(isinstance(batch_id, str) and batch_id, f"{fixture_id} batch.id is required")
    require(isinstance(tenant_id, str) and tenant_id, f"{fixture_id} batch.tenant_id is required")
    require(isinstance(batch.get("user_id"), str) and batch["user_id"], f"{fixture_id} batch.user_id is required")
    require(isinstance(batch.get("project_id"), str) and batch["project_id"], f"{fixture_id} batch.project_id is required")
    require(isinstance(batch.get("workspace_id"), str) and batch["workspace_id"], f"{fixture_id} batch.workspace_id is required")
    prompt_context = batch.get("prompt_context")
    require(isinstance(prompt_context, dict), f"{fixture_id} batch.prompt_context is required")
    require(isinstance(prompt_context.get("text"), str) and prompt_context["text"].strip(), f"{fixture_id} prompt text is required")
    requested_count = batch.get("requested_count")
    require(isinstance(requested_count, int) and 1 <= requested_count <= 20, f"{fixture_id} requested_count must be 1..20")
    require(len(children) <= requested_count, f"{fixture_id} children must not exceed requested_count")
    require(isinstance(batch.get("quota_reservation_id"), str) and batch["quota_reservation_id"], f"{fixture_id} quota_reservation_id is required")
    require(isinstance(batch.get("trace_id"), str) and batch["trace_id"], f"{fixture_id} trace_id is required")
    require(batch.get("status") in BATCH_STATUSES, f"{fixture_id} unsupported batch status {batch.get('status')!r}")
    require(aggregate_status(children) == batch["status"], f"{fixture_id} batch status must match child aggregate")

    estimated = require_int(batch, "quota_estimated_units", fixture_id)
    committed = require_int(batch, "quota_committed_units", fixture_id)
    refunded = require_int(batch, "quota_refunded_units", fixture_id)
    require(committed + refunded <= estimated, f"{fixture_id} batch quota over-accounted")

    progress_counts = {status: require_int(progress, status, fixture_id) for status in ("queued", "running", "succeeded", "failed", "cancelled", "blocked", "retryable")}
    require(sum(progress_counts[status] for status in ("queued", "running", "succeeded", "failed", "cancelled", "blocked")) == len(children), f"{fixture_id} progress counts must match child count")

    child_ids: set[str] = set()
    quota_child_estimate = 0
    quota_child_committed = 0
    quota_child_refunded = 0
    retryable = 0
    for child in children:
        require(isinstance(child, dict), f"{fixture_id} child must be an object")
        child_id = child.get("id")
        require(isinstance(child_id, str) and child_id, f"{fixture_id} child.id is required")
        require(child_id not in child_ids, f"{fixture_id} duplicate child id {child_id}")
        child_ids.add(child_id)
        require(child.get("batch_id") == batch_id, f"{fixture_id}/{child_id} batch_id mismatch")
        require(child.get("tenant_id") == tenant_id, f"{fixture_id}/{child_id} tenant_id mismatch")
        require(child.get("status") in CHILD_STATUSES, f"{fixture_id}/{child_id} unsupported child status")
        for key in ("provider_id", "model_id", "tool_type", "trace_id", "visible_trace_ref"):
            require(isinstance(child.get(key), str) and child[key], f"{fixture_id}/{child_id} {key} is required")
        retry_count = require_int(child, "retry_count", fixture_id)
        max_retries = require_int(child, "max_retries", fixture_id)
        require(0 <= retry_count <= max_retries, f"{fixture_id}/{child_id} retry_count must be <= max_retries")
        child_estimated = require_int(child, "quota_estimate_units", fixture_id)
        child_committed = require_int(child, "quota_committed_units", fixture_id)
        child_refunded = require_int(child, "quota_refunded_units", fixture_id)
        require(child_committed + child_refunded <= child_estimated, f"{fixture_id}/{child_id} child quota over-accounted")
        quota_child_estimate += child_estimated
        quota_child_committed += child_committed
        quota_child_refunded += child_refunded
        if child["status"] == "succeeded":
            require(isinstance(child.get("asset_id"), str) and child["asset_id"], f"{fixture_id}/{child_id} succeeded child requires asset_id")
            require(isinstance(child.get("canvas_object_id"), str) and child["canvas_object_id"], f"{fixture_id}/{child_id} succeeded child requires canvas_object_id")
            require(child_committed > 0 or child_estimated == 0, f"{fixture_id}/{child_id} succeeded child must commit quota")
        metadata = child.get("metadata", {})
        require(metadata is None or isinstance(metadata, dict), f"{fixture_id}/{child_id} metadata must be an object when present")
        if child["status"] == "failed":
            require(isinstance(child.get("failure_code"), str) and child["failure_code"], f"{fixture_id}/{child_id} failed child requires failure_code")
            failure_code = child["failure_code"]
            metadata_retryable = str((metadata or {}).get("retryable", "")).lower()
            metadata_dead_letter = str((metadata or {}).get("dead_letter_state", "")).lower()
            if retry_count < max_retries and failure_code not in NON_RETRYABLE_FAILURE_CODES and metadata_retryable != "false" and metadata_dead_letter != "dead_lettered":
                retryable += 1
            if retry_count >= max_retries or failure_code in NON_RETRYABLE_FAILURE_CODES or metadata_retryable == "false":
                require(metadata_dead_letter == "dead_lettered", f"{fixture_id}/{child_id} final failed child must expose dead_letter_state")
        if child["status"] == "blocked":
            require(isinstance(child.get("review_reason"), str) and child["review_reason"], f"{fixture_id}/{child_id} blocked child requires review_reason")
        if child["status"] in {"failed", "cancelled", "blocked"}:
            require(child_refunded > 0 or child_estimated == 0, f"{fixture_id}/{child_id} failed/cancelled/blocked child must refund quota")

    require(quota_child_estimate == estimated, f"{fixture_id} child quota estimate must equal batch estimate")
    require(quota_child_committed == committed, f"{fixture_id} child committed quota must equal batch committed quota")
    require(quota_child_refunded == refunded, f"{fixture_id} child refunded quota must equal batch refunded quota")
    require(progress_counts["retryable"] == retryable, f"{fixture_id} retryable progress count mismatch")
    walk_projection(projection)
    scheduler = data.get("scheduler")
    if fixture_id == "four_variants":
        require(isinstance(scheduler, dict), f"{fixture_id} scheduler evidence is required")
        require(scheduler.get("fanout_owner") == "backend_worker", f"{fixture_id} scheduler fanout_owner must be backend_worker")
        require(scheduler.get("claim_operation") == "ClaimRunnableChildren", f"{fixture_id} scheduler claim operation mismatch")
        require(scheduler.get("execution_operation") == "ExecuteClaimedChild", f"{fixture_id} scheduler execution operation mismatch")
        require(scheduler.get("result_sink_required") is True, f"{fixture_id} scheduler must require a result sink before success")
        require(scheduler.get("result_sink") == "PostgresBatchResultSink", f"{fixture_id} scheduler result sink mismatch")
        require(scheduler.get("usage_recording") == "RecordProviderUsage", f"{fixture_id} scheduler usage recording mismatch")
        require(scheduler.get("success_operation") == "CompleteChildSuccess", f"{fixture_id} scheduler success operation mismatch")
        require(scheduler.get("failure_operation") == "CompleteChildFailure", f"{fixture_id} scheduler failure operation mismatch")
        require(scheduler.get("retry_operation") == "MarkChildRetryScheduled", f"{fixture_id} scheduler retry operation mismatch")
        require(scheduler.get("retry_policy") == "provider_retryable_errors_requeue_without_quota_refund_until_max_retries", f"{fixture_id} scheduler retry policy mismatch")
        require(scheduler.get("dead_letter_policy") == "exhausted_or_non_retryable_failures_are_dead_lettered_and_refund_reserved_quota", f"{fixture_id} scheduler dead letter policy mismatch")
        require(scheduler.get("quota_policy") == "reserve_estimate_commit_actual_usage_refund_remainder", f"{fixture_id} scheduler quota policy mismatch")
        require(scheduler.get("claim_timeout_seconds") == 900, f"{fixture_id} scheduler claim timeout must be 900 seconds")
        require(scheduler.get("claim_lease_policy") == "expired_running_unaccounted_children_requeued_before_claim", f"{fixture_id} scheduler claim lease policy mismatch")
        require(scheduler.get("drain_policy") == "batch_runner_drain_stops_new_claims", f"{fixture_id} scheduler drain policy mismatch")
        require(scheduler.get("provider_idempotency_key_policy") == "batch_child_id_retry_attempt_stable_across_reclaim", f"{fixture_id} scheduler idempotency key policy mismatch")
        require(isinstance(scheduler.get("max_tenant_concurrency"), int) and scheduler["max_tenant_concurrency"] > 0, f"{fixture_id} scheduler tenant concurrency required")
        provider_limits = scheduler.get("provider_max_concurrency")
        require(isinstance(provider_limits, dict) and provider_limits.get("zenari-image-sandbox", 0) > 0, f"{fixture_id} scheduler provider concurrency required")
        model_limits = scheduler.get("provider_model_concurrency")
        require(isinstance(model_limits, dict) and model_limits.get("zenari-image-sandbox:image-fast-v1", 0) > 0, f"{fixture_id} scheduler provider/model concurrency required")
        claimed = scheduler.get("claimed_children")
        require(isinstance(claimed, list) and claimed, f"{fixture_id} scheduler claimed_children required")
        require(all(isinstance(item, str) and item in child_ids for item in claimed), f"{fixture_id} scheduler claimed unknown child")
        claim_metadata = scheduler.get("claim_metadata")
        require(isinstance(claim_metadata, dict), f"{fixture_id} scheduler claim_metadata required")
        require(claim_metadata.get("fanout_stage") == "claimed_by_worker_scheduler", f"{fixture_id} claim metadata fanout stage mismatch")
        require(claim_metadata.get("claimed_by_worker_id") == scheduler.get("worker_id"), f"{fixture_id} claim metadata worker mismatch")
        require(isinstance(claim_metadata.get("claim_expires_at"), str) and claim_metadata["claim_expires_at"].endswith("Z"), f"{fixture_id} claim metadata claim_expires_at required")
        require(str(claim_metadata.get("claim_attempt")) == "1", f"{fixture_id} claim metadata claim_attempt must be 1")
        release_metadata = scheduler.get("expired_claim_release_metadata")
        require(isinstance(release_metadata, dict), f"{fixture_id} expired claim release metadata required")
        require(release_metadata.get("fanout_stage") == "claim_timeout_requeued", f"{fixture_id} expired claim release fanout stage mismatch")
        require(release_metadata.get("claim_released_by") == "batch_claim_timeout", f"{fixture_id} expired claim release actor mismatch")
        require(not RAW_SECRET_RE.search(json.dumps(scheduler, ensure_ascii=False)), f"{fixture_id} scheduler evidence contains raw secret-looking value")
    return fixture_id


def require_int(obj: dict[str, Any], key: str, fixture_id: str) -> int:
    value = obj.get(key)
    require(isinstance(value, int), f"{fixture_id} {key} must be an integer")
    require(value >= 0, f"{fixture_id} {key} must be non-negative")
    return value


def validate() -> None:
    require_text(
        TASK_CONTRACT,
        (
            "BatchGenerationRequest",
            "GenerationChildTask",
            "AggregateBatchStatus",
            "QuotaReservationID",
            "QuotaBucketID",
            "VisibleTraceRef",
            "ReviewReason",
        ),
    )
    require_text(
        BATCH_REPOSITORY,
        (
            "BatchStore",
            "CreateBatch",
            "GetBatch",
            "ListBatchChildren",
            "GetBatchProgress",
            "CancelBatch",
            "RetryChild",
            "MarkChildRetryScheduled",
            "CompleteChildSuccess",
            "CompleteChildFailure",
            "WithQuotaLedger",
            "ReserveBatchQuota",
            "CommitBatchQuota",
            "RefundBatchQuota",
            "idempotencyFingerprint",
            "promptContextContainsSecret",
        ),
    )
    require_text(
        BATCH_SCHEDULER,
        (
            "BatchSchedulePolicy",
            "ClaimRunnableChildren",
            "MaxTenantConcurrency",
            "ProviderMaxConcurrency",
            "ProviderModelConcurrency",
            "AllowedProviderModelTools",
            "ClaimTimeout",
            "releaseExpiredClaimLeases",
            "claimed_by_worker_id",
            "claimed_by_worker_scheduler",
            "claim_expires_at",
            "claim_attempt",
            "claim_timeout_requeued",
            "quota_committed_units = 0",
            "quota_refunded_units = 0",
        ),
    )
    require_text(
        BATCH_EXECUTOR,
        (
            "BatchChildExecutor",
            "ExecuteClaimedChild",
            "BuildProviderRequestForChild",
            "RecordProviderUsage",
            "PersistBatchChildResult",
            "CompleteChildSuccess",
            "CompleteChildFailure",
            "MarkChildRetryScheduled",
            "provider_execution_succeeded",
            "provider_execution_failed",
            "dead_letter_state",
            "request_hash",
        ),
    )
    require_text(
        BATCH_RESULT_SINK,
        (
            "PostgresBatchResultSink",
            "PersistBatchChildResult",
            "INSERT INTO object_metadata",
            "INSERT INTO assets",
            "INSERT INTO canvas_nodes",
            "object_metadata_id",
            "object_store_ref_ready",
            "thumbnail_metadata_id",
            "lineage",
            "trace_projection",
            "provider_output_keys",
            "provider_output_sig",
        ),
    )
    require_text(
        BATCH_QUOTA_LEDGER,
        (
            "BatchQuotaLedger",
            "PostgresBatchQuotaLedger",
            "ResolveBatchQuotaBucket",
            "ReserveBatchQuota",
            "CommitBatchQuota",
            "RefundBatchQuota",
            "quota_transactions",
            "quota_buckets",
            "ErrBatchQuotaInsufficient",
        ),
    )
    require_text(
        WORKER_BATCH_RUNNER,
        (
            "BatchRunner",
            "RunOnce",
            "Drain()",
            "draining",
            "atomic.Bool",
            "ClaimRunnableChildren",
            "ExecuteClaimedChild",
        ),
    )
    require_text(
        TASK_TEST,
        (
            "TestBatchRepositoryReleaseExpiredClaimLeasesBeforeCountingConcurrency",
            "claim_timeout_requeued",
            "metadata->>'claim_expires_at'",
            "claim_expires_at",
            "claim_attempt",
        ),
    )
    require_text(
        WORKER_BATCH_RUNNER_TEST,
        (
            "TestBatchRunnerDrainStopsNewClaims",
            "runner.Drain()",
            "claimCalled",
        ),
    )
    require_text(
        CONFIG,
        (
            "BatchClaimTimeout",
            'durationEnv("WORKER_BATCH_CLAIM_TIMEOUT", 15*time.Minute)',
            "WORKER_BATCH_CLAIM_TIMEOUT must be > 0",
        ),
    )
    require_text(
        CONFIG_TEST,
        (
            "TestLoadAcceptsBatchWorkerPolicyConfig",
            "WORKER_BATCH_CLAIM_TIMEOUT",
            "TestValidateRejectsEnabledBatchWorkerWithoutClaimTimeout",
        ),
    )
    require_text(
        WORKER_MAIN,
        (
            "batchRunner.Drain()",
            "ClaimTimeout:              cfg.Worker.BatchClaimTimeout",
            "batchPolicyFromConfig",
        ),
    )
    require_text(
        WORKER_MAIN_TEST,
        (
            "TestBatchPolicyFromConfigMapsWorkerSettings",
            "BatchClaimTimeout",
            "policy.ClaimTimeout",
        ),
    )
    require_text(
        ENV_EXAMPLE,
        (
            "WORKER_BATCH_CLAIM_TIMEOUT=15m",
        ),
    )
    require_text(
        DOCKER_COMPOSE,
        (
            "WORKER_BATCH_CLAIM_TIMEOUT: ${WORKER_BATCH_CLAIM_TIMEOUT:-15m}",
        ),
    )
    require_text(
        MIGRATION,
        (
            "CREATE TABLE IF NOT EXISTS batch_generation_requests",
            "CREATE TABLE IF NOT EXISTS generation_child_tasks",
            "quota_bucket_id text REFERENCES quota_buckets(id)",
            "batch_generation_quota_balance_check",
            "generation_child_success_output_check",
            "generation_child_blocked_reason_check",
            "idx_generation_child_retry_queue",
            "dead_letter_state",
        ),
    )
    require_text(
        SERVER,
        (
            'POST /api/v1/projects/{project_id}/batch-generations',
            'GET /api/v1/batch-generations/{batch_id}',
            'GET /api/v1/batch-generations/{batch_id}/children',
            'GET /api/v1/batch-generations/{batch_id}/progress',
            'POST /api/v1/batch-generations/{batch_id}/cancel',
            'POST /api/v1/batch-generation-children/{child_id}/retry',
            'GET /api/admin/v1/batch-generations/queue-runtime',
            'GET /api/admin/v1/batch-generation-children',
            "PermissionAuditRead",
            "listAdminBatchQueueRuntime",
            "listAdminBatchGenerationChildren",
            "requireIdempotencyKey",
            "BatchStoreFromContext",
            "AdminBatchQueueReader",
        ),
    )
    require_text(
        SERVER_TEST,
        (
            "TestAdminBatchQueueRuntimeListsSafeProjection",
            "TestAdminBatchChildrenListsSafeProjection",
            "TestAdminBatchQueueRejectsInsufficientRoleBeforeReader",
            "prompt_context",
            "failure_message",
            "PermissionAuditRead",
        ),
    )
    require_text(
        OPENAPI,
        (
            "operationId: createBatchGeneration",
            "operationId: getBatchGeneration",
            "operationId: listBatchGenerationChildren",
            "operationId: getBatchGenerationProgress",
            "operationId: cancelBatchGeneration",
            "operationId: retryBatchGenerationChild",
            "operationId: listAdminBatchQueueRuntime",
            "operationId: listAdminBatchGenerationChildren",
            "BatchGenerationCreate",
            "BatchProgress",
            "GenerationChildTask",
            "AdminBatchQueueRuntime",
            "AdminBatchChildTask",
            "/batch-generations/queue-runtime",
            "/batch-generation-children",
            "x-idempotency-required: true",
        ),
    )
    require_text(
        ADMIN_GENERATED,
        (
            "listAdminBatchQueueRuntime",
            "listAdminBatchGenerationChildren",
            'path: "/batch-generations/queue-runtime"',
            'path: "/batch-generation-children"',
            'rbac: "admin"',
        ),
    )
    require_text(
        ADMIN_API,
        (
            "AdminBatchQueueRuntimeAPI",
            "AdminBatchChildTaskAPI",
            "mapAdminBatchQueueRuntime",
            "mapAdminBatchChildTask",
            "/api/admin/v1/batch-generations/queue-runtime?page_size=50",
            "/api/admin/v1/batch-generation-children?page_size=50",
            "stage1BatchQueueRuntime",
            "stage1BatchChildTasks",
        ),
    )
    require_text(
        ADMIN_QUEUE_PAGE,
        (
            "Stage 1 Batch Queue Runtime",
            "Stage 1 Batch Child Tasks",
            "Provider Strategy Group",
            "Claim Timeout",
            "Provider Usage",
        ),
    )
    require(FIXTURE_DIR.exists(), f"missing fixture dir {FIXTURE_DIR.relative_to(ROOT)}")
    seen = {validate_fixture(path) for path in sorted(FIXTURE_DIR.glob("*.json"))}
    require(seen == REQUIRED_FIXTURES, f"batch fixture set mismatch: missing {sorted(REQUIRED_FIXTURES - seen)}, extra {sorted(seen - REQUIRED_FIXTURES)}")


def main() -> int:
    try:
        validate()
    except BatchContractError as exc:
        print(f"stage1 batch generation contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 batch generation contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
