#!/usr/bin/env python3
"""Validate the non-clearing Stage 1 production launch operator brief."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BRIEF = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
REQUIRED_BLOCKER_IDS = [
    "production_dns_https",
    "production_paid_billing_lifecycle",
    "production_security_launch_checks",
    "production_governance_release",
]
REQUIRED_COVERAGE_GROUPS = ["production_dns", "billing", "security", "governance"]
SAFE_FALSE_FIELDS = (
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
)
SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "api_key",
    "provider_secret",
    "stripe_secret_key",
    "stripe_api_key",
    "webhook_secret",
    "stripe-signature",
    "stripe_signature",
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_payload",
    "raw_event",
    "raw_response",
    "raw_support_body",
    "database_url",
    "postgres_url",
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
)


class ProductionLaunchOperatorBriefValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionLaunchOperatorBriefValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionLaunchOperatorBriefValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionLaunchOperatorBriefValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains raw secret-looking material")


def require_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty string")
    return value.strip()


def require_non_negative_int(value: Any, path: str) -> int:
    require(isinstance(value, int), f"{path} must be int")
    require(value >= 0, f"{path} must be non-negative")
    return value


def require_percent(value: Any, path: str) -> float:
    require(isinstance(value, (int, float)), f"{path} must be numeric")
    numeric = float(value)
    require(math.isfinite(numeric), f"{path} must be finite")
    require(0 <= numeric <= 100, f"{path} must be between 0 and 100")
    return numeric


def validate_source_refs(data: dict[str, Any]) -> None:
    refs = data.get("source_refs")
    require(isinstance(refs, dict), "source_refs must be object")
    required = {
        "production_blocker_audit",
        "production_proof_bundle",
        "production_dns_readiness",
        "production_dns_cutover_plan",
        "production_live_billing_diagnostic",
        "production_security_diagnostic",
        "production_governance_diagnostic",
    }
    require(required <= set(refs), "source_refs missing required entries")
    for key in sorted(required):
        require_string(refs.get(key), f"source_refs.{key}")


def validate_summary(data: dict[str, Any]) -> dict[str, int]:
    summary = data.get("summary")
    require(isinstance(summary, dict), "summary must be object")
    completed = require_non_negative_int(summary.get("stage1_gates_completed"), "summary.stage1_gates_completed")
    total = require_non_negative_int(summary.get("stage1_gates_total"), "summary.stage1_gates_total")
    open_count = require_non_negative_int(summary.get("open_gate_count"), "summary.open_gate_count")
    require(total >= completed, "summary stage1 completed cannot exceed total")
    require(total == completed + open_count, "summary stage1 gate counters must add up")
    require_percent(summary.get("stage1_completion_percent"), "summary.stage1_completion_percent")
    final_blockers = require_non_negative_int(summary.get("final_blocker_count"), "summary.final_blocker_count")
    require(final_blockers == len(REQUIRED_BLOCKER_IDS), "summary.final_blocker_count must preserve four final blocker classes")
    configured = require_non_negative_int(summary.get("production_inputs_configured"), "summary.production_inputs_configured")
    inputs_total = require_non_negative_int(summary.get("production_inputs_total"), "summary.production_inputs_total")
    missing = require_non_negative_int(summary.get("production_inputs_missing"), "summary.production_inputs_missing")
    invalid = require_non_negative_int(summary.get("production_inputs_invalid"), "summary.production_inputs_invalid")
    blocking = require_non_negative_int(summary.get("blocking_input_count"), "summary.blocking_input_count")
    require(configured + missing + invalid == inputs_total, "summary production input counters must add up")
    require(blocking == missing + invalid, "summary blocking_input_count mismatch")
    require_percent(summary.get("production_inputs_completion_percent"), "summary.production_inputs_completion_percent")
    return {
        "configured": configured,
        "total": inputs_total,
        "missing": missing,
        "invalid": invalid,
        "blocking": blocking,
        "final_blockers": final_blockers,
    }


def validate_string_list(value: Any, path: str, *, max_len: int, allow_empty: bool = False) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    require(allow_empty or bool(value), f"{path} must be non-empty")
    require(len(value) <= max_len, f"{path} must contain at most {max_len} items")
    result: list[str] = []
    for idx, item in enumerate(value):
        text = require_string(item, f"{path}[{idx}]")
        require(len(text) <= 260, f"{path}[{idx}] is too long")
        result.append(text)
    return result


def validate_matrix(data: dict[str, Any], summary_counts: dict[str, int]) -> None:
    rows = data.get("blocker_matrix")
    require(isinstance(rows, list), "blocker_matrix must be list")
    require(len(rows) == len(REQUIRED_BLOCKER_IDS), "blocker_matrix length mismatch")
    seen_ids: list[str] = []
    seen_groups: list[str] = []
    totals = {"configured": 0, "total": 0, "missing": 0, "invalid": 0, "blocking": 0}
    for idx, row in enumerate(rows):
        require(isinstance(row, dict), f"blocker_matrix[{idx}] must be object")
        blocker_id = require_string(row.get("blocker_id"), f"blocker_matrix[{idx}].blocker_id")
        seen_ids.append(blocker_id)
        require(blocker_id == REQUIRED_BLOCKER_IDS[idx], f"blocker_matrix[{idx}] blocker order mismatch")
        require_string(row.get("title"), f"blocker_matrix[{idx}].title")
        require(row.get("status") == "blocked", f"{blocker_id}.status must remain blocked")
        coverage_group = require_string(row.get("coverage_group"), f"{blocker_id}.coverage_group")
        seen_groups.append(coverage_group)
        require(coverage_group == REQUIRED_COVERAGE_GROUPS[idx], f"{blocker_id}.coverage_group mismatch")
        validate_string_list(row.get("gate_ids"), f"{blocker_id}.gate_ids", max_len=4)
        configured = require_non_negative_int(row.get("required_configured"), f"{blocker_id}.required_configured")
        total = require_non_negative_int(row.get("required_total"), f"{blocker_id}.required_total")
        missing = require_non_negative_int(row.get("required_missing"), f"{blocker_id}.required_missing")
        invalid = require_non_negative_int(row.get("required_invalid"), f"{blocker_id}.required_invalid")
        blocking = require_non_negative_int(row.get("blocking_input_count"), f"{blocker_id}.blocking_input_count")
        require(configured + missing + invalid == total, f"{blocker_id} counters must add up")
        require(blocking == missing + invalid, f"{blocker_id} blocking count mismatch")
        require(blocking > 0, f"{blocker_id} must have at least one blocking input")
        require_percent(row.get("completion_percent"), f"{blocker_id}.completion_percent")
        require_string(row.get("first_blocker"), f"{blocker_id}.first_blocker")
        validate_string_list(
            row.get("first_missing_required_inputs"),
            f"{blocker_id}.first_missing_required_inputs",
            max_len=12,
            allow_empty=True,
        )
        validate_string_list(
            row.get("invalid_required_inputs"),
            f"{blocker_id}.invalid_required_inputs",
            max_len=8,
            allow_empty=True,
        )
        diagnostic = row.get("diagnostic")
        require(isinstance(diagnostic, dict), f"{blocker_id}.diagnostic must be object")
        require_string(diagnostic.get("path"), f"{blocker_id}.diagnostic.path")
        require(isinstance(diagnostic.get("exists"), bool), f"{blocker_id}.diagnostic.exists must be bool")
        require(diagnostic.get("status") in {"blocked", "missing"}, f"{blocker_id}.diagnostic.status mismatch")
        require_string(diagnostic.get("schema_version"), f"{blocker_id}.diagnostic.schema_version")
        require_string(diagnostic.get("first_blocker"), f"{blocker_id}.diagnostic.first_blocker")
        require(diagnostic.get("canonical_source_written") is False, f"{blocker_id}.diagnostic cannot write canonical source")
        refs = row.get("source_refs")
        require(isinstance(refs, dict), f"{blocker_id}.source_refs must be object")
        require_string(refs.get("production_proof_bundle"), f"{blocker_id}.source_refs.production_proof_bundle")
        validate_string_list(row.get("operator_next_actions"), f"{blocker_id}.operator_next_actions", max_len=6)
        totals["configured"] += configured
        totals["total"] += total
        totals["missing"] += missing
        totals["invalid"] += invalid
        totals["blocking"] += blocking
    require(seen_ids == REQUIRED_BLOCKER_IDS, "blocker_matrix blocker IDs mismatch")
    require(seen_groups == REQUIRED_COVERAGE_GROUPS, "blocker_matrix coverage groups mismatch")
    for key in ("configured", "total", "missing", "invalid", "blocking"):
        require(totals[key] == summary_counts[key], f"blocker_matrix total {key} mismatch")


def validate_brief(data: dict[str, Any]) -> None:
    assert_no_secret(data, "brief")
    require(data.get("schema_version") == "stage1.production_launch_operator_brief.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_launch_operator_brief", "kind mismatch")
    require(data.get("status") == "blocked", "brief must remain blocked")
    require(data.get("release_gate_decision") == "no_go", "brief must remain no_go")
    require(data.get("non_clearing_operator_brief") is True, "non_clearing_operator_brief must be true")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "brief cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "brief cannot close DNL")
    require(data.get("value_redaction") == "variable_names_only", "value_redaction mismatch")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    validate_source_refs(data)
    open_gates = validate_string_list(data.get("open_gates"), "open_gates", max_len=12)
    summary_counts = validate_summary(data)
    require(len(open_gates) == data["summary"]["open_gate_count"], "open_gates length mismatch")
    validate_matrix(data, summary_counts)
    validate_string_list(data.get("operator_next_actions"), "operator_next_actions", max_len=8)
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_stage1_production_launch_gate") is False, "gate_impact cannot clear production launch")
    require(gate.get("can_close_do_not_launch") is False, "gate_impact cannot close DNL")
    require(gate.get("non_clearing_evidence_only") is True, "gate_impact must mark non-clearing evidence")
    require(
        gate.get("preserved_do_not_launch_condition") == "stage1_production_launch_evidence_incomplete",
        "DNL preservation mismatch",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--brief", type=Path, default=DEFAULT_BRIEF)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        require(REQUIRED_BLOCKER_IDS == [
            "production_dns_https",
            "production_paid_billing_lifecycle",
            "production_security_launch_checks",
            "production_governance_release",
        ], "required blocker contract mismatch")
        require(REQUIRED_COVERAGE_GROUPS == ["production_dns", "billing", "security", "governance"], "coverage group contract mismatch")
        print("stage1 production launch operator brief contract passed")
        return 0
    try:
        validate_brief(load_json(args.brief))
    except ProductionLaunchOperatorBriefValidationError as exc:
        raise SystemExit(f"stage1 production launch operator brief validation failed: {exc}") from exc
    print("stage1 production launch operator brief validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
