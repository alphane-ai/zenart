#!/usr/bin/env python3
"""Validate Stage 1 batch quota retry/dead-letter reconciliation evidence."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "batch_quota_reconciliation" / "retry_dead_letter_reconciliation.json"
BATCH_EXECUTOR = ROOT / "backend" / "internal" / "task" / "batch_executor.go"
BATCH_REPOSITORY = ROOT / "backend" / "internal" / "task" / "batch_repository.go"
BATCH_RETRY = ROOT / "backend" / "internal" / "task" / "batch_retry.go"
BATCH_QUOTA_LEDGER = ROOT / "backend" / "internal" / "task" / "batch_quota_ledger.go"
BILLING = ROOT / "backend" / "internal" / "billing" / "billing.go"
BATCH_TESTS = ROOT / "backend" / "internal" / "task" / "batch_generation_test.go"
EXECUTOR_TESTS = ROOT / "backend" / "internal" / "task" / "batch_executor_test.go"
BILLING_TESTS = ROOT / "backend" / "internal" / "billing" / "billing_test.go"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)

REQUIRED_EVENT_KINDS = {
    "reserve",
    "commit",
    "refund",
    "retry_scheduled",
    "dead_letter_refund",
    "manual_retry_rereserve",
    "provider_usage_reconcile",
}


class ReconciliationContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ReconciliationContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")


def load_fixture() -> dict[str, Any]:
    try:
        data = json.loads(read_text(FIXTURE))
    except json.JSONDecodeError as exc:
        raise ReconciliationContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "reconciliation fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "reconciliation fixture contains raw secret-looking material")
    return data


def require_int(obj: dict[str, Any], key: str, context: str) -> int:
    value = obj.get(key)
    require(isinstance(value, int), f"{context}.{key} must be an integer")
    return value


def validate_fixture(data: dict[str, Any]) -> None:
    require(data.get("fixture_id") == "batch_quota_retry_dead_letter_reconciliation", "unexpected fixture_id")
    require(data.get("contract_version") == 1, "contract_version must be 1")
    for key in ("tenant_id", "user_id", "bucket_id", "batch_id", "quota_reservation_id"):
        require(isinstance(data.get(key), str) and data[key], f"{key} is required")
    events = data.get("events")
    require(isinstance(events, list) and events, "events must be a non-empty array")

    initial = data.get("initial_bucket")
    expected = data.get("expected_bucket")
    require(isinstance(initial, dict), "initial_bucket is required")
    require(isinstance(expected, dict), "expected_bucket is required")
    limit = require_int(initial, "limit_units", "initial_bucket")
    used = require_int(initial, "used_units", "initial_bucket")
    reserved = require_int(initial, "reserved_units", "initial_bucket")
    require(limit >= 0 and used >= 0 and reserved >= 0, "initial bucket units must be non-negative")
    require(used + reserved <= limit, "initial bucket over limit")

    seen_event_ids: set[str] = set()
    seen_kinds: set[str] = set()
    retry_events = 0
    dead_letter_events = 0
    manual_rereserve_events = 0
    reconciliation_adjustments: set[str] = set()
    quota_transaction_events = 0
    child_commit_units: dict[str, int] = {}
    child_refund_units: dict[str, int] = {}
    child_rereserve_units: dict[str, int] = {}
    child_post_rereserve_accounted: dict[str, int] = {}

    for index, event in enumerate(events):
        require(isinstance(event, dict), f"events[{index}] must be an object")
        context = str(event.get("event_id") or f"events[{index}]")
        event_id = event.get("event_id")
        require(isinstance(event_id, str) and event_id, f"{context}.event_id is required")
        require(event_id not in seen_event_ids, f"duplicate event_id {event_id}")
        seen_event_ids.add(event_id)
        kind = event.get("kind")
        require(kind in REQUIRED_EVENT_KINDS, f"{context}.kind {kind!r} is not supported")
        seen_kinds.add(kind)
        source = event.get("source")
        require(isinstance(source, str) and source, f"{context}.source is required")
        reserved_delta = require_int(event, "reserved_delta", context)
        used_delta = require_int(event, "used_delta", context)
        reserved += reserved_delta
        used += used_delta
        require(reserved >= 0, f"{context} drives reserved_units negative")
        require(used >= 0, f"{context} drives used_units negative")
        require(used + reserved <= limit, f"{context} exceeds bucket limit")

        child_id = event.get("child_id")
        if child_id is not None:
            require(isinstance(child_id, str) and child_id, f"{context}.child_id must be a non-empty string")

        if kind in {"reserve", "commit", "refund", "dead_letter_refund", "manual_retry_rereserve"}:
            quota_transaction_events += 1
            require(isinstance(event.get("idempotency_key"), str) and event["idempotency_key"], f"{context}.idempotency_key is required")
            require(event.get("transaction_kind") in {"reserve", "commit", "refund"}, f"{context}.transaction_kind is invalid")
            require(event.get("transaction_status") in {"reserved", "committed", "refunded"}, f"{context}.transaction_status is invalid")
            units = require_int(event, "units", context)
            require(units > 0, f"{context}.units must be positive")
            if kind == "reserve":
                require(event["transaction_kind"] == "reserve" and event["transaction_status"] == "reserved", f"{context} must be a reserved reserve")
                require(reserved_delta == units and used_delta == 0, f"{context} reserve delta mismatch")
            if kind == "commit":
                require(event["transaction_kind"] == "commit" and event["transaction_status"] == "committed", f"{context} must be a committed commit")
                require(reserved_delta == -units and used_delta == units, f"{context} commit delta mismatch")
                child_commit_units[str(child_id)] = child_commit_units.get(str(child_id), 0) + units
                if str(child_id) in child_rereserve_units:
                    child_post_rereserve_accounted[str(child_id)] = child_post_rereserve_accounted.get(str(child_id), 0) + units
            if kind == "refund":
                require(event["transaction_kind"] == "refund" and event["transaction_status"] == "refunded", f"{context} must be a refunded refund")
                require(reserved_delta == -units and used_delta == 0, f"{context} refund delta mismatch")
                child_refund_units[str(child_id)] = child_refund_units.get(str(child_id), 0) + units
                if str(child_id) in child_rereserve_units:
                    child_post_rereserve_accounted[str(child_id)] = child_post_rereserve_accounted.get(str(child_id), 0) + units
            if kind == "dead_letter_refund":
                dead_letter_events += 1
                require(event.get("dead_letter_state") == "dead_lettered", f"{context} must be dead_lettered")
                require(event["transaction_kind"] == "refund" and event["transaction_status"] == "refunded", f"{context} must refund on final failure")
                require(reserved_delta == -units and used_delta == 0, f"{context} dead-letter refund delta mismatch")
                child_refund_units[str(child_id)] = child_refund_units.get(str(child_id), 0) + units
            if kind == "manual_retry_rereserve":
                manual_rereserve_events += 1
                require(event["transaction_kind"] == "reserve" and event["transaction_status"] == "reserved", f"{context} manual retry must reserve")
                require(require_int(event, "previous_refunded_units", context) == units, f"{context} must reserve previous refunded units")
                require(reserved_delta == units and used_delta == 0, f"{context} manual retry delta mismatch")
                child_rereserve_units[str(child_id)] = child_rereserve_units.get(str(child_id), 0) + units

        if kind == "retry_scheduled":
            retry_events += 1
            require(event.get("quota_transaction") == "none", f"{context} retry scheduling must not write quota transaction")
            require(reserved_delta == 0 and used_delta == 0, f"{context} retry scheduling must not move quota")
            require(event.get("retry_state") == "scheduled", f"{context} retry_state must be scheduled")
            before = require_int(event, "retry_count_before", context)
            after = require_int(event, "retry_count_after", context)
            max_retries = require_int(event, "max_retries", context)
            require(after == before + 1 and after <= max_retries, f"{context} retry count transition invalid")

        if kind == "provider_usage_reconcile":
            actual = require_int(event, "actual_usage_units", context)
            accounted = require_int(event, "accounted_quota_units", context)
            adjusted = require_int(event, "adjusted_units", context)
            require(require_int(event, "provider_log_count", context) > 0, f"{context} provider_log_count must be positive")
            require(event.get("idempotent_on_replay") is True, f"{context} must declare idempotent_on_replay")
            adjustment_kind = event.get("adjustment_kind")
            require(adjustment_kind in {"provider_usage_debit", "provider_usage_credit"}, f"{context}.adjustment_kind is invalid")
            reconciliation_adjustments.add(adjustment_kind)
            if actual > accounted:
                require(adjustment_kind == "provider_usage_debit", f"{context} must debit under-accounted usage")
                require(adjusted == actual - accounted and reserved_delta == 0 and used_delta == adjusted, f"{context} debit delta mismatch")
            elif actual < accounted:
                require(adjustment_kind == "provider_usage_credit", f"{context} must credit over-accounted usage")
                require(adjusted == accounted - actual and reserved_delta == 0 and used_delta == -adjusted, f"{context} credit delta mismatch")
            else:
                raise ReconciliationContractError(f"{context} reconcile event must include a non-zero adjustment")

    require(REQUIRED_EVENT_KINDS <= seen_kinds, f"missing event kinds {sorted(REQUIRED_EVENT_KINDS - seen_kinds)}")
    require(retry_events >= 2, "fixture must include multiple retry_scheduled events")
    require(dead_letter_events >= 1, "fixture must include a dead_letter_refund event")
    require(manual_rereserve_events >= 1, "fixture must include manual retry re-reserve")
    require(quota_transaction_events >= 8, "fixture must include reserve/commit/refund transaction coverage")
    require(reconciliation_adjustments == {"provider_usage_debit", "provider_usage_credit"}, "fixture must cover debit and credit reconciliation")
    for child_id, rereserved in child_rereserve_units.items():
        require(child_post_rereserve_accounted.get(child_id, 0) == rereserved, f"{child_id} manual retry reserved units must be fully accounted after re-reserve")

    expected_limit = require_int(expected, "limit_units", "expected_bucket")
    expected_used = require_int(expected, "used_units", "expected_bucket")
    expected_reserved = require_int(expected, "reserved_units", "expected_bucket")
    require((limit, used, reserved) == (expected_limit, expected_used, expected_reserved), f"bucket math got limit={limit} used={used} reserved={reserved}, expected {expected}")

    anchors = data.get("required_code_anchors")
    require(isinstance(anchors, list) and anchors, "required_code_anchors must be non-empty")
    require(data.get("release_note", "").endswith("paid batch generation launch."), "release_note must preserve staging evidence caveat")


def validate_code_anchors() -> None:
    require_text(
        BATCH_RETRY,
        (
            "batchFailureAllowsRetry",
            "providerResponseStatusAllowsRetry",
            "childFailureRetryable",
            "dead_letter_state",
            "result_persistence_failed",
        ),
    )
    require_text(
        BATCH_EXECUTOR,
        (
            "MarkChildRetryScheduled",
            "CompleteChildFailure",
            "dead_letter_state",
            "dead_lettered",
            "QuotaRefundedUnits: child.QuotaEstimateUnits - child.QuotaCommittedUnits - child.QuotaRefundedUnits",
        ),
    )
    require_text(
        BATCH_REPOSITORY,
        (
            "MarkChildRetryScheduled",
            "retry_count = retry_count + 1",
            "quota_committed_units = 0",
            "quota_refunded_units = 0",
            "manual_retry_requested",
            "ReserveBatchQuota(ctx, r.db, retryReservation)",
            "QuotaReservationID + \":\" + before.ID + \":retry:\"",
        ),
    )
    require_text(
        BATCH_QUOTA_LEDGER,
        (
            "ReserveBatchQuota",
            "CommitBatchQuota",
            "RefundBatchQuota",
            "ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING",
            "reserved_units = reserved_units - $1, used_units = used_units + $1",
            "reserved_units = reserved_units - $1",
        ),
    )
    require_text(
        BILLING,
        (
            "ReconcileProviderUsage",
            "provider_usage_debit",
            "provider_usage_credit",
            "AdjustmentAlreadyRecorded",
            "UPDATE provider_usage_logs",
            "ErrProviderUsageMissing",
        ),
    )
    require_text(
        BATCH_TESTS,
        (
            "TestBatchRepositoryMarkChildRetryScheduledRequeuesWithoutRefund",
            "TestBatchRepositoryRetryChildRereservesRefundedQuotaWithLedger",
        ),
    )
    require_text(
        EXECUTOR_TESTS,
        (
            "TestBatchChildExecutorSchedulesRetryForRetryableProviderError",
            "TestBatchChildExecutorDeadLettersAfterRetryBudgetAndRefunds",
            "TestBatchChildExecutorRequiresResultSinkBeforeSuccess",
        ),
    )
    require_text(
        BILLING_TESTS,
        (
            "TestReconcileProviderUsageDebitsQuotaForUnderAccountedActualUsage",
            "TestReconcileProviderUsageCreditsQuotaForOverAccountedUsage",
            "TestReconcileProviderUsageReturnsMissingWhenNoLogsExist",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "manual retry re-reserves previously refunded quota",
            "local runtime replay evidence now covers provider usage debit/credit adjustments",
            "Staging validation remains incomplete",
            "real staging quota reconciliation replay",
        ),
    )


def main() -> int:
    try:
        validate_fixture(load_fixture())
        validate_code_anchors()
    except ReconciliationContractError as exc:
        print(f"stage1 batch quota reconciliation contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 batch quota reconciliation contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
