#!/usr/bin/env python3
"""Validate Stage 1 provider usage cost reconciliation contract evidence."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "provider_cost_reconciliation" / "provider_cost_reconcile.json"
PROVIDER_COST = ROOT / "backend" / "internal" / "billing" / "provider_cost_reconcile.go"
BILLING = ROOT / "backend" / "internal" / "billing" / "billing.go"
BILLING_TESTS = ROOT / "backend" / "internal" / "billing" / "billing_test.go"
BATCH_EXECUTOR = ROOT / "backend" / "internal" / "task" / "batch_executor.go"
BATCH_EXECUTOR_TESTS = ROOT / "backend" / "internal" / "task" / "batch_executor_test.go"
PROVIDER_MIGRATION = ROOT / "backend" / "migrations" / "0011_stage1_provider_batch_contracts.sql"
STAGE0_MIGRATION = ROOT / "backend" / "migrations" / "0002_stage0_rev2_domains.sql"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)


class ProviderCostContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProviderCostContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")


def int_value(obj: dict[str, Any], key: str, context: str) -> int:
    value = obj.get(key)
    require(isinstance(value, int), f"{context}.{key} must be an integer")
    return value


def load_fixture() -> dict[str, Any]:
    try:
        data = json.loads(read_text(FIXTURE))
    except json.JSONDecodeError as exc:
        raise ProviderCostContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture(data: dict[str, Any]) -> None:
    require(data.get("fixture_id") == "provider_cost_quota_billing_reconciliation", "unexpected fixture_id")
    require(data.get("contract_version") == 1, "contract_version must be 1")
    require(data.get("tenant_id") == "tenant_1", "tenant_id fixture drift")
    require(isinstance(data.get("bucket_id"), str) and data["bucket_id"], "bucket_id is required")
    require(data.get("currency") == "USD", "currency must be USD in the local contract fixture")
    require(data.get("usage_source") == "provider_usage_logs joined to provider_model_capabilities", "usage_source must cite provider usage and capability join")
    require(data.get("quota_source") == "quota_transactions via QuotaRepository.ReconcileProviderUsage", "quota_source must cite quota reconciliation")
    require(data.get("release_gate_status") == "contract_ready_staging_provider_invoice_usage_evidence_open", "fixture must not close staging provider cost gate")

    required_evidence = data.get("required_staging_evidence")
    require(isinstance(required_evidence, list), "required_staging_evidence must be a list")
    for evidence in (
        "real provider usage export",
        "real provider invoice or billing-period spend report",
        "staging quota transaction reconciliation replay",
    ):
        require(evidence in required_evidence, f"missing required staging evidence {evidence!r}")
    require("real staging provider invoice" in data.get("release_note", ""), "release_note must preserve staging provider invoice caveat")

    tasks = data.get("tasks")
    require(isinstance(tasks, list) and tasks, "tasks must be a non-empty list")
    task_ids: set[str] = set()
    total_cost = 0
    reconciled = 0
    manual = 0
    outliers = 0
    adjustment_kinds: set[str] = set()
    spend_cap_flags: set[bool] = set()

    for index, task in enumerate(tasks):
        require(isinstance(task, dict), f"tasks[{index}] must be an object")
        context = str(task.get("task_id") or f"tasks[{index}]")
        task_id = task.get("task_id")
        require(isinstance(task_id, str) and task_id, f"{context}.task_id is required")
        require(task_id not in task_ids, f"duplicate task_id {task_id}")
        task_ids.add(task_id)
        for key in ("provider_id", "model_id", "status", "metadata_marker"):
            require(isinstance(task.get(key), str) and task[key] != "", f"{context}.{key} is required")
        require(task["metadata_marker"] == "provider_cost_reconciliation_id", f"{context}.metadata_marker must bind provider usage log metadata")

        actual = int_value(task, "actual_usage_units", context)
        accounted = int_value(task, "accounted_quota_units", context)
        adjusted = int_value(task, "adjusted_units", context)
        cost = int_value(task, "cost_cents", context)
        max_cost_units = int_value(task, "max_cost_units", context)
        estimated_cost = int_value(task, "estimated_cost_cents", context)
        provider_log_count = int_value(task, "provider_log_count", context)
        require(actual >= 0 and accounted >= 0 and adjusted >= 0 and cost >= 0, f"{context} units/cost must be non-negative")
        require(max_cost_units >= 0 and estimated_cost >= 0 and provider_log_count > 0, f"{context} capability/log values invalid")
        total_cost += cost
        spend_cap_flags.add(bool(task.get("spend_cap_exceeded")))

        status = task["status"]
        if status == "reconciled":
            reconciled += 1
            require(isinstance(task.get("quota_idempotency_key"), str) and task["quota_idempotency_key"], f"{context} reconciled task needs quota_idempotency_key")
            adjustment_kind = task.get("adjustment_kind")
            require(adjustment_kind in {"provider_usage_debit", "provider_usage_credit", ""}, f"{context}.adjustment_kind invalid")
            if adjustment_kind:
                adjustment_kinds.add(str(adjustment_kind))
                require(adjusted == abs(actual - accounted), f"{context}.adjusted_units must equal actual/accounted delta")
        elif status == "manual_review":
            manual += 1
            require(task.get("reason") in {"quota_idempotency_key_missing", "provider_usage_missing"}, f"{context}.reason invalid")
            require(not task.get("quota_idempotency_key"), f"{context} manual review task should not pretend to have quota key")
        else:
            raise ProviderCostContractError(f"{context}.status {status!r} invalid")

        if task.get("usage_outlier") is True:
            outliers += 1
            require(actual > max_cost_units * provider_log_count or cost > estimated_cost * provider_log_count * 2, f"{context} usage_outlier lacks threshold breach")

    require(total_cost == int_value(data, "total_cost_cents", "fixture"), "total_cost_cents does not match tasks")
    require(int_value(data, "daily_spend_cap_cents", "fixture") < total_cost, "fixture should exceed spend cap")
    require(data.get("spend_cap_exceeded") is True, "spend_cap_exceeded must be true")
    require(spend_cap_flags == {True}, "task spend_cap_exceeded flags must match report")
    require(reconciled == int_value(data, "reconciled_count", "fixture"), "reconciled_count mismatch")
    require(manual == int_value(data, "manual_review_count", "fixture"), "manual_review_count mismatch")
    require(outliers == int_value(data, "outlier_count", "fixture"), "outlier_count mismatch")
    require(len(tasks) == int_value(data, "task_count", "fixture"), "task_count mismatch")
    require("provider_usage_debit" in adjustment_kinds, "fixture must cover provider_usage_debit adjustment")

    anchors = data.get("required_code_anchors")
    require(isinstance(anchors, list) and len(anchors) >= 8, "required_code_anchors must list provider cost anchors")


def validate_code_anchors() -> None:
    require_text(
        PROVIDER_COST,
        (
            "type ProviderCostReconciler struct",
            "ReconcileProviderCost",
            "provider_usage_logs pul",
            "provider_model_capabilities pmc",
            "metadata->>'quota_idempotency_key'",
            "QuotaRepository",
            "ReconcileProviderUsage",
            "DailySpendCapCents",
            "SpendCapExceeded",
            "providerCostUsageOutlier",
            "provider_cost_reconciliation_id",
            "manual_review",
            "contract_ready_staging_provider_invoice_usage_evidence_open",
        ),
    )
    require_text(
        BILLING,
        (
            "type ProviderUsageLog struct",
            "RecordProviderUsage",
            "ReconcileProviderUsage",
            "provider_usage_debit",
            "provider_usage_credit",
            "metadata->>'reconciles_idempotency_key'",
        ),
    )
    require_text(
        BATCH_EXECUTOR,
        (
            "RecordProviderUsage",
            "BatchChildQuotaIdempotencyKey(batch, child)",
            "\"quota_idempotency_key\"",
            "\"usage_cost_units\"",
        ),
    )
    require_text(
        PROVIDER_MIGRATION,
        (
            "provider_model_capabilities",
            "max_cost_units",
            "cost_currency",
            "estimated_cost_cents",
        ),
    )
    require_text(
        STAGE0_MIGRATION,
        (
            "provider_usage_logs",
            "usage_units",
            "cost_cents",
            "idx_provider_usage_task",
        ),
    )
    require_text(
        BILLING_TESTS,
        (
            "TestProviderCostReconcilerDebitsQuotaFlagsOutliersAndManualReview",
            "TestProviderCostReconcilerRequiresScopeAndWindow",
            "provider_model_capabilities",
            "metadata->>'quota_idempotency_key'",
        ),
    )
    require_text(
        BATCH_EXECUTOR_TESTS,
        (
            "usage log quota idempotency key",
            "quota_reservation_1:child_1",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_provider_cost_reconciliation.py",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "provider-cost reconciliation",
            "ProviderCostReconciler",
            "real provider invoice",
        ),
    )


def main() -> int:
    try:
        validate_fixture(load_fixture())
        validate_code_anchors()
    except ProviderCostContractError as exc:
        print(f"stage1 provider cost reconciliation contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 provider cost reconciliation contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
