#!/usr/bin/env python3
"""Validate Stage 1 batch quota runtime replay evidence."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "batch_quota_reconciliation" / "runtime_replay.json"
WORKER_TEST = ROOT / "backend" / "internal" / "worker" / "batch_quota_runtime_replay_test.go"
LEDGER = ROOT / "backend" / "internal" / "task" / "batch_quota_ledger.go"
LEDGER_TEST = ROOT / "backend" / "internal" / "task" / "batch_quota_ledger_test.go"
REPOSITORY = ROOT / "backend" / "internal" / "task" / "batch_repository.go"
BILLING = ROOT / "backend" / "internal" / "billing" / "billing.go"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)

REQUIRED_COMPONENTS = {
    "BatchRunner.RunOnce",
    "BatchChildExecutor.ExecuteClaimedChild",
    "BatchRepository.RetryChild",
    "PostgresBatchQuotaLedger.ReserveBatchQuota",
    "PostgresBatchQuotaLedger.CommitBatchQuota",
    "PostgresBatchQuotaLedger.RefundBatchQuota",
    "QuotaRepository.ReconcileProviderUsage",
}

REQUIRED_KINDS = {
    "reserve",
    "commit",
    "refund",
    "retry_scheduled",
    "dead_letter_refund",
    "manual_retry_rereserve",
    "provider_usage_reconcile",
}


class RuntimeReplayError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeReplayError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def load_fixture() -> dict[str, Any]:
    text = read_text(FIXTURE)
    require(not RAW_SECRET_RE.search(text), "runtime replay fixture contains raw secret-looking material")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeReplayError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "runtime replay fixture must be a JSON object")
    return data


def int_value(obj: dict[str, Any], key: str, context: str) -> int:
    value = obj.get(key)
    require(isinstance(value, int), f"{context}.{key} must be an integer")
    return value


def non_empty_string(obj: dict[str, Any], key: str, context: str) -> str:
    value = obj.get(key)
    require(isinstance(value, str) and value, f"{context}.{key} must be a non-empty string")
    return value


def validate_fixture(data: dict[str, Any]) -> None:
    require(data.get("fixture_id") == "batch_quota_runtime_replay", "unexpected fixture_id")
    require(data.get("contract_version") == 1, "contract_version must be 1")
    require(data.get("generated_by_go_test") == "backend/internal/worker TestBatchQuotaRuntimeReplayProducesEvidenceFixture", "fixture must be bound to the Go replay test")
    components = set(data.get("runtime_components") or [])
    require(REQUIRED_COMPONENTS <= components, f"runtime_components missing {sorted(REQUIRED_COMPONENTS - components)}")
    require(data.get("release_note", "").startswith("Local runtime replay evidence only;"), "release_note must not claim staging evidence")
    require("real staging quota reconciliation replay" in data.get("release_note", ""), "release_note must preserve staging replay caveat")

    for key in ("tenant_id", "user_id", "bucket_id", "batch_id", "quota_reservation_id"):
        non_empty_string(data, key, "fixture")
    initial = data.get("initial_bucket")
    expected = data.get("expected_bucket")
    require(isinstance(initial, dict), "initial_bucket is required")
    require(isinstance(expected, dict), "expected_bucket is required")

    limit = int_value(initial, "limit_units", "initial_bucket")
    used = int_value(initial, "used_units", "initial_bucket")
    reserved = int_value(initial, "reserved_units", "initial_bucket")
    require(limit >= 0 and used >= 0 and reserved >= 0, "initial bucket units must be non-negative")
    require(used + reserved <= limit, "initial bucket exceeds limit")

    events = data.get("events")
    require(isinstance(events, list) and events, "events must be a non-empty array")
    seen_event_ids: set[str] = set()
    seen_kinds: set[str] = set()
    retry_events = 0
    dead_letter_events = 0
    manual_retry_events = 0
    reconciliation_kinds: set[str] = set()
    retry_attempt_keys = 0
    manual_child_rereserved: dict[str, int] = {}
    manual_child_accounted: dict[str, int] = {}
    provider_usage_recorded: dict[str, int] = {}

    for index, event in enumerate(events):
        require(isinstance(event, dict), f"events[{index}] must be an object")
        context = non_empty_string(event, "event_id", f"events[{index}]")
        require(context not in seen_event_ids, f"duplicate event_id {context}")
        seen_event_ids.add(context)
        kind = non_empty_string(event, "kind", context)
        require(kind in REQUIRED_KINDS, f"{context}.kind {kind!r} is unsupported")
        seen_kinds.add(kind)
        source = non_empty_string(event, "source", context)
        require(
            any(component in source for component in REQUIRED_COMPONENTS) or "BatchRepository.CreateBatch" in source,
            f"{context}.source {source!r} is not a known runtime source",
        )

        reserved_delta = int_value(event, "reserved_delta", context)
        used_delta = int_value(event, "used_delta", context)
        reserved += reserved_delta
        used += used_delta
        require(reserved >= 0, f"{context} drives reserved_units negative")
        require(used >= 0, f"{context} drives used_units negative")
        require(used + reserved <= limit, f"{context} exceeds bucket limit")

        child_id = event.get("child_id")
        if child_id is not None:
            require(isinstance(child_id, str) and child_id, f"{context}.child_id must be a non-empty string")

        if kind in {"reserve", "commit", "refund", "dead_letter_refund", "manual_retry_rereserve"}:
            key = non_empty_string(event, "idempotency_key", context)
            tx_kind = non_empty_string(event, "transaction_kind", context)
            tx_status = non_empty_string(event, "transaction_status", context)
            units = int_value(event, "units", context)
            require(units > 0, f"{context}.units must be positive")
            if kind == "reserve":
                require(tx_kind == "reserve" and tx_status == "reserved", f"{context} reserve status mismatch")
                require(reserved_delta == units and used_delta == 0, f"{context} reserve delta mismatch")
            if kind == "commit":
                require(tx_kind == "commit" and tx_status == "committed", f"{context} commit status mismatch")
                require(reserved_delta == -units and used_delta == units, f"{context} commit delta mismatch")
                provider_usage_recorded[str(child_id)] = int_value(event, "provider_usage_units", context)
                if ":attempt:" in key:
                    retry_attempt_keys += 1
                if str(child_id) in manual_child_rereserved:
                    manual_child_accounted[str(child_id)] = manual_child_accounted.get(str(child_id), 0) + units
            if kind == "refund":
                require(tx_kind == "refund" and tx_status == "refunded", f"{context} refund status mismatch")
                require(reserved_delta == -units and used_delta == 0, f"{context} refund delta mismatch")
                if ":attempt:" in key:
                    retry_attempt_keys += 1
                if str(child_id) in manual_child_rereserved:
                    manual_child_accounted[str(child_id)] = manual_child_accounted.get(str(child_id), 0) + units
                if child_id == "child_manual_retry_1":
                    require(event.get("dead_letter_state") == "not_dead_lettered", f"{context} must prove manual retry clears dead-letter metadata")
            if kind == "dead_letter_refund":
                dead_letter_events += 1
                require(tx_kind == "refund" and tx_status == "refunded", f"{context} dead-letter must refund")
                require(event.get("dead_letter_state") == "dead_lettered", f"{context} must be dead_lettered")
                require(reserved_delta == -units and used_delta == 0, f"{context} dead-letter delta mismatch")
            if kind == "manual_retry_rereserve":
                manual_retry_events += 1
                previous = int_value(event, "previous_refunded_units", context)
                require(previous == units, f"{context} must reserve previous refunded units")
                require(tx_kind == "reserve" and tx_status == "reserved", f"{context} manual retry reserve status mismatch")
                require(reserved_delta == units and used_delta == 0, f"{context} manual retry delta mismatch")
                manual_child_rereserved[str(child_id)] = units

        if kind == "retry_scheduled":
            retry_events += 1
            require(event.get("quota_transaction") == "none", f"{context} retry must not write quota transaction")
            require(reserved_delta == 0 and used_delta == 0, f"{context} retry must not move quota")
            before = int_value(event, "retry_count_before", context)
            after = int_value(event, "retry_count_after", context)
            max_retries = int_value(event, "max_retries", context)
            require(after == before + 1 and after <= max_retries, f"{context} invalid retry transition")

        if kind == "provider_usage_reconcile":
            actual = int_value(event, "actual_usage_units", context)
            accounted = int_value(event, "accounted_quota_units", context)
            adjusted = int_value(event, "adjusted_units", context)
            adjustment_kind = non_empty_string(event, "adjustment_kind", context)
            require(adjustment_kind in {"provider_usage_debit", "provider_usage_credit"}, f"{context}.adjustment_kind invalid")
            require(event.get("idempotent_on_replay") is True, f"{context} must be idempotent on replay")
            require(int_value(event, "provider_log_count", context) > 0, f"{context} must include provider logs")
            reconciliation_kinds.add(adjustment_kind)
            if adjustment_kind == "provider_usage_debit":
                require(actual > accounted and adjusted == actual - accounted and used_delta == adjusted, f"{context} debit math mismatch")
            if adjustment_kind == "provider_usage_credit":
                require(actual < accounted and adjusted == accounted - actual and used_delta == -adjusted, f"{context} credit math mismatch")
            require(provider_usage_recorded.get(str(child_id), actual) == actual, f"{context} must reconcile the runtime provider usage amount")

    require(REQUIRED_KINDS <= seen_kinds, f"missing event kinds {sorted(REQUIRED_KINDS - seen_kinds)}")
    require(retry_events >= 3, "runtime replay must include automatic retry scheduling")
    require(dead_letter_events >= 2, "runtime replay must include terminal refund paths")
    require(manual_retry_events == 1, "runtime replay must include one manual retry re-reserve")
    require(reconciliation_kinds == {"provider_usage_debit", "provider_usage_credit"}, "runtime replay must cover debit and credit reconciliation")
    require(retry_attempt_keys >= 4, "runtime replay must prove retry-attempt scoped quota idempotency keys")
    for child_id, units in manual_child_rereserved.items():
        require(manual_child_accounted.get(child_id) == units, f"{child_id} manual retry reserved units must be fully accounted")

    expected_limit = int_value(expected, "limit_units", "expected_bucket")
    expected_used = int_value(expected, "used_units", "expected_bucket")
    expected_reserved = int_value(expected, "reserved_units", "expected_bucket")
    require((limit, used, reserved) == (expected_limit, expected_used, expected_reserved), f"bucket math got limit={limit} used={used} reserved={reserved}, expected {expected}")


def validate_anchors() -> None:
    worker_test = read_text(WORKER_TEST)
    for snippet in (
        "TestBatchQuotaRuntimeReplayProducesEvidenceFixture",
        "BatchRunner.RunOnce",
        "task.BatchChildExecutor",
        "RetryChild(ctx",
        "ReconcileProviderUsage(\"child_reconcile_debit_1\")",
        "ReconcileProviderUsage(\"child_reconcile_credit_1\")",
        "assertJSONEqual",
    ):
        require(snippet in worker_test, f"{WORKER_TEST.relative_to(ROOT)} missing {snippet!r}")

    ledger = read_text(LEDGER)
    for snippet in (
        "func BatchChildQuotaIdempotencyKey",
        "\":attempt:\"",
        "BatchChildQuotaIdempotencyKey(batch, child)",
        "ON CONFLICT (tenant_id, idempotency_key, kind) DO NOTHING",
    ):
        require(snippet in ledger, f"{LEDGER.relative_to(ROOT)} missing {snippet!r}")

    ledger_test = read_text(LEDGER_TEST)
    require("TestPostgresBatchQuotaLedgerUsesRetryAttemptInChildIdempotency" in ledger_test, "missing retry-attempt ledger unit test")

    repository = read_text(REPOSITORY)
    for snippet in (
        "manual_retry_requested",
        "'dead_letter_state', 'not_dead_lettered'",
        "ReserveBatchQuota(ctx, r.db, retryReservation)",
    ):
        require(snippet in repository, f"{REPOSITORY.relative_to(ROOT)} missing {snippet!r}")

    billing = read_text(BILLING)
    for snippet in (
        "ReconcileProviderUsage",
        "provider_usage_debit",
        "provider_usage_credit",
        "AdjustmentAlreadyRecorded",
        "UPDATE provider_usage_logs",
    ):
        require(snippet in billing, f"{BILLING.relative_to(ROOT)} missing {snippet!r}")

    gap = read_text(GAP_INVENTORY)
    for snippet in (
        "local runtime replay evidence",
        "retry-attempt scoped quota idempotency",
        "real staging quota reconciliation replay",
        "Staging validation remains incomplete",
    ):
        require(snippet in gap, f"{GAP_INVENTORY.relative_to(ROOT)} missing {snippet!r}")


def main() -> int:
    try:
        validate_fixture(load_fixture())
        validate_anchors()
    except RuntimeReplayError as exc:
        print(f"stage1 batch quota runtime replay validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 batch quota runtime replay validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
