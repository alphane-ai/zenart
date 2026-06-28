#!/usr/bin/env python3
"""Validate the non-clearing Stage 1 production missing-input checklist."""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CHECKLIST = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_PROOF_BUNDLE = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"
REQUIRED_GROUPS = ["production_dns", "billing", "security", "governance"]
ACCEPTABLE_EVIDENCE_SOURCES = {
    "production_dns": "production_https_dns_or_cloudflare_cutover_evidence",
    "billing": "live_stripe_production_billing_evidence",
    "security": "production_https_runtime_security_evidence",
    "governance": "production_governance_audit_release_evidence",
}
REQUIRED_DISALLOWED_SUBSTITUTES = {
    "local_debug_evidence",
    "staging_preflight_evidence",
    "blocked_probe_evidence",
    "placeholder_values",
}
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


class ProductionMissingInputChecklistValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionMissingInputChecklistValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionMissingInputChecklistValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionMissingInputChecklistValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def require_optional_string(value: Any, path: str) -> str | None:
    if value is None:
        return None
    return require_string(value, path)


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


def validate_string_list(value: Any, path: str, *, max_len: int, allow_empty: bool = False) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    require(allow_empty or bool(value), f"{path} must be non-empty")
    require(len(value) <= max_len, f"{path} must contain at most {max_len} items")
    result: list[str] = []
    for idx, item in enumerate(value):
        text = require_string(item, f"{path}[{idx}]")
        require(len(text) <= 300, f"{path}[{idx}] is too long")
        result.append(text)
    return result


def proof_coverage(proof_bundle: dict[str, Any]) -> dict[str, Any]:
    coverage = proof_bundle.get("input_variable_coverage")
    require(isinstance(coverage, dict), "proof bundle missing input_variable_coverage")
    groups = coverage.get("groups")
    require(isinstance(groups, dict), "proof bundle missing input_variable_coverage.groups")
    return coverage


def validate_source_refs(data: dict[str, Any]) -> None:
    refs = data.get("source_refs")
    require(isinstance(refs, dict), "source_refs must be object")
    required = {"production_proof_bundle", "production_launch_operator_brief", "production_launch_input_packet"}
    require(required <= set(refs), "source_refs missing required entries")
    for key in sorted(required):
        require_string(refs.get(key), f"source_refs.{key}")


def validate_summary(data: dict[str, Any], proof_bundle: dict[str, Any]) -> dict[str, int]:
    coverage = proof_coverage(proof_bundle)
    summary = data.get("summary")
    require(isinstance(summary, dict), "summary must be object")
    configured = require_non_negative_int(summary.get("required_configured"), "summary.required_configured")
    total = require_non_negative_int(summary.get("required_total"), "summary.required_total")
    missing = require_non_negative_int(summary.get("required_missing"), "summary.required_missing")
    invalid = require_non_negative_int(summary.get("required_invalid"), "summary.required_invalid")
    blocking = require_non_negative_int(summary.get("blocking_input_count"), "summary.blocking_input_count")
    require(configured + missing + invalid == total, "summary counters must add up")
    require(blocking == missing + invalid, "summary blocking_input_count mismatch")
    require_percent(summary.get("required_completion_percent"), "summary.required_completion_percent")
    expected = {
        "required_configured": coverage.get("required_configured"),
        "required_total": coverage.get("required_total"),
        "required_missing": coverage.get("required_missing"),
        "required_invalid": coverage.get("required_invalid"),
        "blocking_input_count": coverage.get("blocking_input_count"),
        "required_completion_percent": coverage.get("required_completion_percent"),
    }
    for key, value in expected.items():
        require(summary.get(key) == value, f"summary.{key} must match production proof bundle")
    return {"configured": configured, "total": total, "missing": missing, "invalid": invalid, "blocking": blocking}


def expected_blocking_by_group(proof_bundle: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    groups = proof_coverage(proof_bundle)["groups"]
    expected: dict[str, list[dict[str, Any]]] = {}
    for group_id in REQUIRED_GROUPS:
        raw_group = groups.get(group_id)
        require(isinstance(raw_group, dict), f"proof bundle missing group {group_id}")
        requirements = raw_group.get("requirements")
        require(isinstance(requirements, list), f"proof bundle group {group_id} missing requirements")
        expected[group_id] = [
            item for item in requirements if isinstance(item, dict) and item.get("status") in {"missing", "invalid"}
        ]
    return expected


def validate_item(item: dict[str, Any], path: str, expected: dict[str, Any]) -> None:
    group_id = require_string(item.get("group_id"), f"{path}.group_id")
    require(group_id in REQUIRED_GROUPS, f"{path}.group_id mismatch")
    requirement_id = require_string(item.get("requirement_id"), f"{path}.requirement_id")
    display_name = require_string(item.get("display_name"), f"{path}.display_name")
    status = require_string(item.get("status"), f"{path}.status")
    require(status in {"missing", "invalid"}, f"{path}.status must be missing or invalid")
    accepted = validate_string_list(item.get("accepted_variable_names"), f"{path}.accepted_variable_names", max_len=8)
    configured_name = require_optional_string(item.get("configured_variable_name"), f"{path}.configured_variable_name")
    acceptable_source = require_string(item.get("acceptable_evidence_source"), f"{path}.acceptable_evidence_source")
    require(acceptable_source == ACCEPTABLE_EVIDENCE_SOURCES[group_id], f"{path}.acceptable_evidence_source mismatch")
    substitutes = set(validate_string_list(item.get("disallowed_substitutes"), f"{path}.disallowed_substitutes", max_len=8))
    require(REQUIRED_DISALLOWED_SUBSTITUTES <= substitutes, f"{path}.disallowed_substitutes missing common non-clearing substitutes")
    if group_id == "billing":
        require("stripe_sandbox_test_mode" in substitutes and "stripe_test_keys" in substitutes, f"{path}.billing substitutes must reject Stripe sandbox")
    require(
        item.get("can_be_satisfied_by_existing_sandbox_or_staging_resources") is False,
        f"{path}.can_be_satisfied_by_existing_sandbox_or_staging_resources must be false",
    )
    require_string(item.get("operator_action"), f"{path}.operator_action")
    require(requirement_id == expected.get("requirement_id"), f"{path}.requirement_id must match proof bundle")
    require(display_name == expected.get("display_name"), f"{path}.display_name must match proof bundle")
    require(status == expected.get("status"), f"{path}.status must match proof bundle")
    require(accepted == expected.get("accepted_variable_names"), f"{path}.accepted_variable_names must match proof bundle")
    expected_configured = expected.get("configured_variable_name")
    require(configured_name == expected_configured, f"{path}.configured_variable_name must match proof bundle")
    if status == "missing":
        require(configured_name is None, f"{path}.configured_variable_name must be null for missing inputs")
    else:
        require(configured_name in accepted, f"{path}.configured_variable_name must be one accepted variable name")


def validate_groups(data: dict[str, Any], proof_bundle: dict[str, Any], summary_counts: dict[str, int]) -> list[dict[str, Any]]:
    groups = data.get("groups")
    require(isinstance(groups, list), "groups must be list")
    require(len(groups) == len(REQUIRED_GROUPS), "groups length mismatch")
    proof_groups = proof_coverage(proof_bundle)["groups"]
    expected_items = expected_blocking_by_group(proof_bundle)
    totals = {"configured": 0, "total": 0, "missing": 0, "invalid": 0, "blocking": 0}
    flattened: list[dict[str, Any]] = []
    for idx, group in enumerate(groups):
        require(isinstance(group, dict), f"groups[{idx}] must be object")
        group_id = require_string(group.get("group_id"), f"groups[{idx}].group_id")
        require(group_id == REQUIRED_GROUPS[idx], f"groups[{idx}].group_id order mismatch")
        require_string(group.get("title"), f"{group_id}.title")
        raw_group = proof_groups[group_id]
        configured = require_non_negative_int(group.get("required_configured"), f"{group_id}.required_configured")
        total = require_non_negative_int(group.get("required_total"), f"{group_id}.required_total")
        missing = require_non_negative_int(group.get("required_missing"), f"{group_id}.required_missing")
        invalid = require_non_negative_int(group.get("required_invalid"), f"{group_id}.required_invalid")
        blocking = require_non_negative_int(group.get("blocking_input_count"), f"{group_id}.blocking_input_count")
        require(configured + missing + invalid == total, f"{group_id} counters must add up")
        require(blocking == missing + invalid, f"{group_id} blocking count mismatch")
        require(group.get("completion_percent") == round(configured * 100 / total, 1), f"{group_id}.completion_percent mismatch")
        require(group.get("required_configured") == raw_group.get("required_configured"), f"{group_id}.required_configured proof mismatch")
        require(group.get("required_total") == raw_group.get("required_total"), f"{group_id}.required_total proof mismatch")
        require(group.get("required_missing") == raw_group.get("required_missing"), f"{group_id}.required_missing proof mismatch")
        require(group.get("required_invalid") == raw_group.get("required_invalid"), f"{group_id}.required_invalid proof mismatch")
        validate_string_list(group.get("first_missing_required_inputs"), f"{group_id}.first_missing_required_inputs", max_len=12, allow_empty=True)
        validate_string_list(group.get("invalid_required_inputs"), f"{group_id}.invalid_required_inputs", max_len=8, allow_empty=True)
        require_string(group.get("operator_next_action"), f"{group_id}.operator_next_action")
        items = group.get("items")
        require(isinstance(items, list), f"{group_id}.items must be list")
        require(len(items) == blocking, f"{group_id}.items length must match blocking count")
        expected = expected_items[group_id]
        require(len(items) == len(expected), f"{group_id}.items length must match proof bundle")
        for item_idx, item in enumerate(items):
            require(isinstance(item, dict), f"{group_id}.items[{item_idx}] must be object")
            validate_item(item, f"{group_id}.items[{item_idx}]", expected[item_idx])
            flattened.append(item)
        totals["configured"] += configured
        totals["total"] += total
        totals["missing"] += missing
        totals["invalid"] += invalid
        totals["blocking"] += blocking
    for key in ("configured", "total", "missing", "invalid", "blocking"):
        require(totals[key] == summary_counts[key], f"group total {key} mismatch")
    return flattened


def validate_top_level_items(data: dict[str, Any], grouped_items: list[dict[str, Any]], summary_counts: dict[str, int]) -> None:
    items = data.get("items")
    require(isinstance(items, list), "items must be list")
    require(len(items) == summary_counts["blocking"], "items length must match blocking count")
    require(len(items) == summary_counts["missing"] + summary_counts["invalid"], "items length must equal missing + invalid")
    require(items == grouped_items, "top-level items must match grouped item order")


def validate_checklist(data: dict[str, Any], proof_bundle: dict[str, Any]) -> None:
    assert_no_secret(data, "checklist")
    require(data.get("schema_version") == "stage1.production_missing_input_checklist.v1", "schema_version mismatch")
    require(data.get("kind") == "stage1_production_missing_input_checklist", "kind mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("status") == "blocked", "checklist must remain blocked")
    require(data.get("release_gate_decision") == "no_go", "checklist must remain no_go")
    require(data.get("non_clearing_checklist") is True, "non_clearing_checklist must be true")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "checklist cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "checklist cannot close DNL")
    require(data.get("value_redaction") == "variable_names_only", "value_redaction mismatch")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    validate_source_refs(data)
    summary_counts = validate_summary(data, proof_bundle)
    grouped_items = validate_groups(data, proof_bundle, summary_counts)
    validate_top_level_items(data, grouped_items, summary_counts)
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
    parser.add_argument("--checklist", type=Path, default=DEFAULT_CHECKLIST)
    parser.add_argument("--proof-bundle", type=Path, default=DEFAULT_PROOF_BUNDLE)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        require(REQUIRED_GROUPS == ["production_dns", "billing", "security", "governance"], "required group contract mismatch")
        require(
            "acceptable_evidence_source" in Path(__file__).with_name("generate_stage1_production_missing_input_checklist.py").read_text(encoding="utf-8"),
            "generator must include acceptable evidence source fields",
        )
        print("stage1 production missing input checklist contract passed")
        return 0
    try:
        validate_checklist(load_json(args.checklist), load_json(args.proof_bundle))
    except ProductionMissingInputChecklistValidationError as exc:
        raise SystemExit(f"stage1 production missing input checklist validation failed: {exc}") from exc
    print("stage1 production missing input checklist validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
