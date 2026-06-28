#!/usr/bin/env python3
"""Validate the non-clearing Stage 1 production blocker audit."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_AUDIT = ROOT / "ops" / "evidence" / "non_clearing" / "production-blocker-audit.json"
REQUIRED_PROBE_IDS = [
    "production_paid_billing_lifecycle",
    "production_security_launch_checks",
    "production_legal_support_policy",
    "production_governance_release",
]
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
REQUIRED_PROOF_BUNDLE_GROUPS = {"production_dns", "billing", "security", "governance"}
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


class ProductionBlockerAuditValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionBlockerAuditValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionBlockerAuditValidationError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionBlockerAuditValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def validate_env_classification(data: dict[str, Any]) -> None:
    env = data.get("local_env_classification")
    require(isinstance(env, dict), "local_env_classification must be object")
    require(isinstance(env.get("env_file_present"), bool), "env_file_present must be bool")
    stripe = env.get("stripe")
    require(isinstance(stripe, dict), "local_env_classification.stripe must be object")
    for key in ("mode", "api_key_class", "secret_key_class", "publishable_key_class", "webhook_secret_class"):
        value = require_string(stripe.get(key), f"local_env_classification.stripe.{key}")
        require("_" in value or value in {"test", "live", "missing", "set_nonstandard"}, f"unexpected stripe {key}: {value}")
    require(isinstance(stripe.get("live_secret_configured"), bool), "stripe.live_secret_configured must be bool")
    for section in ("llm", "object_storage", "staging"):
        require(isinstance(env.get(section), dict), f"local_env_classification.{section} must be object")


def validate_source_rows(data: dict[str, Any]) -> None:
    rows = data.get("production_source_audit")
    require(isinstance(rows, list), "production_source_audit must be list")
    require(len(rows) == len(REQUIRED_PROBE_IDS), "production_source_audit length mismatch")
    seen: list[str] = []
    for idx, row in enumerate(rows):
        require(isinstance(row, dict), f"production_source_audit[{idx}] must be object")
        probe_id = require_string(row.get("probe_id"), f"production_source_audit[{idx}].probe_id")
        seen.append(probe_id)
        require(probe_id in REQUIRED_PROBE_IDS, f"unexpected probe id {probe_id}")
        require(row.get("status") in {"source_missing", "source_present_strict_blocked", "source_present_strict_pass"}, f"{probe_id} status mismatch")
        require(isinstance(row.get("source_probe_exists"), bool), f"{probe_id} source_probe_exists must be bool")
        require_string(row.get("source_path"), f"{probe_id}.source_path")
        require_string(row.get("missing_input"), f"{probe_id}.missing_input")
        require_string(row.get("operator_action"), f"{probe_id}.operator_action")
        require_string(row.get("first_blocker"), f"{probe_id}.first_blocker")
        diagnostic = row.get("diagnostic")
        require(isinstance(diagnostic, dict), f"{probe_id}.diagnostic must be object")
        require_string(diagnostic.get("path"), f"{probe_id}.diagnostic.path")
        require(isinstance(diagnostic.get("exists"), bool), f"{probe_id}.diagnostic.exists must be bool")
        strict = row.get("strict_validation")
        require(isinstance(strict, dict), f"{probe_id}.strict_validation must be object")
        require_string(strict.get("command"), f"{probe_id}.strict_validation.command")
        require(isinstance(strict.get("exit_code"), int), f"{probe_id}.strict_validation.exit_code must be int")
        require(strict.get("status") in {"pass", "blocked"}, f"{probe_id}.strict_validation.status mismatch")
        require_string(strict.get("summary"), f"{probe_id}.strict_validation.summary")
    require(seen == REQUIRED_PROBE_IDS, "production_source_audit order mismatch")
    open_ids = data.get("open_source_probe_ids")
    require(isinstance(open_ids, list), "open_source_probe_ids must be list")
    require(set(open_ids) <= set(REQUIRED_PROBE_IDS), "open_source_probe_ids contains unexpected probe")
    require(data.get("final_blocker_count") == len(open_ids), "final_blocker_count mismatch")


def validate_proof_bundle_summary(data: dict[str, Any]) -> None:
    bundle = data.get("production_proof_bundle")
    require(isinstance(bundle, dict), "production_proof_bundle must be object")
    require(bundle.get("path") == "ops/evidence/non_clearing/production-proof-bundle.json", "production_proof_bundle path mismatch")
    require(isinstance(bundle.get("exists"), bool), "production_proof_bundle.exists must be bool")
    require(bundle.get("status") in {"missing", "blocked", "pass"}, "production_proof_bundle.status mismatch")
    require(bundle.get("release_gate_decision") in {"no_go", "go_candidate_requires_strict_production_launch_validation"}, "production_proof_bundle decision mismatch")
    require(isinstance(bundle.get("canonical_sources_requested"), bool), "production_proof_bundle.canonical_sources_requested must be bool")
    if bundle.get("status") == "blocked":
        require(bundle.get("canonical_sources_requested") is False, "blocked proof bundle must not request canonical sources")
    statuses = bundle.get("proof_statuses")
    require(isinstance(statuses, dict), "production_proof_bundle.proof_statuses must be object")
    require({"billing", "security", "governance"} <= set(statuses), "production_proof_bundle.proof_statuses missing groups")
    for group in ("billing", "security", "governance"):
        require(statuses.get(group) in {"missing", "blocked", "pass"}, f"production_proof_bundle.proof_statuses.{group} mismatch")

    coverage = bundle.get("input_variable_coverage")
    require(isinstance(coverage, dict), "production_proof_bundle.input_variable_coverage must be object")
    require(
        coverage.get("schema_version") in {"missing", "stage1.production_proof_bundle.input_variable_coverage.v1"},
        "production_proof_bundle.input_variable_coverage schema mismatch",
    )
    require(coverage.get("value_redaction") in {"missing", "variable_names_only"}, "production_proof_bundle input coverage redaction mismatch")
    for field in ("required_total", "required_configured", "required_missing", "required_invalid", "blocking_input_count"):
        require(isinstance(coverage.get(field), int), f"production_proof_bundle.input_variable_coverage.{field} must be int")
        require(coverage[field] >= 0, f"production_proof_bundle.input_variable_coverage.{field} must be non-negative")
    require(
        coverage["required_configured"] + coverage["required_missing"] + coverage["required_invalid"] == coverage["required_total"],
        "production_proof_bundle input coverage counters must add up",
    )
    require(
        coverage["blocking_input_count"] == coverage["required_missing"] + coverage["required_invalid"],
        "production_proof_bundle input coverage blocking count mismatch",
    )
    pct = coverage.get("required_completion_percent")
    require(isinstance(pct, (int, float)), "production_proof_bundle.input_variable_coverage.required_completion_percent must be numeric")
    require(0 <= float(pct) <= 100, "production_proof_bundle.input_variable_coverage.required_completion_percent out of range")
    first = coverage.get("first_missing_or_invalid_inputs")
    require(isinstance(first, list), "production_proof_bundle.input_variable_coverage.first_missing_or_invalid_inputs must be list")
    require(len(first) <= 12, "production_proof_bundle first missing inputs must be capped")
    groups = coverage.get("groups")
    require(isinstance(groups, dict), "production_proof_bundle.input_variable_coverage.groups must be object")
    if coverage["required_total"] > 0:
        require(REQUIRED_PROOF_BUNDLE_GROUPS <= set(groups), "production_proof_bundle coverage groups missing")
    for group, value in groups.items():
        require(group in REQUIRED_PROOF_BUNDLE_GROUPS, f"unexpected production_proof_bundle coverage group {group}")
        require(isinstance(value, dict), f"production_proof_bundle.input_variable_coverage.groups.{group} must be object")
        for field in ("required_total", "required_configured", "required_missing", "required_invalid"):
            require(isinstance(value.get(field), int), f"production_proof_bundle.input_variable_coverage.groups.{group}.{field} must be int")
            require(value[field] >= 0, f"production_proof_bundle.input_variable_coverage.groups.{group}.{field} must be non-negative")
        require(
            value["required_configured"] + value["required_missing"] + value["required_invalid"] == value["required_total"],
            f"production_proof_bundle.input_variable_coverage.groups.{group} counters must add up",
        )


def validate_audit(data: dict[str, Any]) -> None:
    assert_no_secret(data, "audit")
    require(data.get("schema_version") == "stage1.production_blocker_audit.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_blocker_audit", "kind mismatch")
    require(data.get("status") in {"blocked", "ready"}, "status mismatch")
    require(data.get("release_gate_decision") == "no_go", "audit must not issue go decision")
    require(data.get("non_clearing_audit") is True, "non_clearing_audit must be true")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "audit cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "audit cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    refs = data.get("source_refs")
    require(isinstance(refs, dict), "source_refs must be object")
    for key in ("closure_queue", "input_packet", "production_dns_readiness", "production_proof_bundle"):
        require_string(refs.get(key), f"source_refs.{key}")
    closure = data.get("closure_summary")
    require(isinstance(closure, dict), "closure_summary must be object")
    require(closure.get("release_gate_decision") == "no_go", "closure_summary must remain no_go")
    dns = data.get("production_dns_readiness")
    require(isinstance(dns, dict), "production_dns_readiness must be object")
    require(dns.get("production_web_url") == "https://zenari.ai", "production_web_url mismatch")
    require_string(dns.get("first_blocker"), "production_dns_readiness.first_blocker")
    if dns.get("status") != "missing":
        require(isinstance(dns.get("public_production_address_count"), int), "production_dns_readiness.public_production_address_count must be int")
        require(dns.get("public_production_address_count", 0) >= 0, "production_dns_readiness.public_production_address_count must be non-negative")
        doh_statuses = dns.get("doh_probe_statuses")
        require(isinstance(doh_statuses, dict), "production_dns_readiness.doh_probe_statuses must be object")
        expected_doh = {
            "production_a_cloudflare",
            "production_aaaa_cloudflare",
            "production_a_google",
            "production_aaaa_google",
            "staging_a_cloudflare",
            "staging_a_google",
        }
        require(expected_doh <= set(doh_statuses), "production_dns_readiness.doh_probe_statuses incomplete")
        for key, value in doh_statuses.items():
            require(key in expected_doh, f"production_dns_readiness.doh_probe_statuses unexpected key {key}")
            require(value in {"pass", "blocked", "missing"}, f"production_dns_readiness.doh_probe_statuses.{key} status mismatch")
    validate_env_classification(data)
    validate_proof_bundle_summary(data)
    validate_source_rows(data)
    summary = data.get("operator_summary")
    require(isinstance(summary, dict), "operator_summary must be object")
    require(summary.get("additional_sandbox_or_llm_inputs_needed") is False, "audit must not ask for extra sandbox/LLM input")
    require(summary.get("stripe_sandbox_is_not_current_blocker") is True, "audit must classify Stripe sandbox as non-blocking")
    require(summary.get("staging_is_not_current_blocker") is True, "audit must classify staging as non-blocking")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_stage1_production_launch_gate") is False, "gate_impact cannot clear production launch")
    require(gate.get("can_close_do_not_launch") is False, "gate_impact cannot close DNL")
    require(gate.get("preserved_do_not_launch_condition") == "stage1_production_launch_evidence_incomplete", "DNL preservation mismatch")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        require(len(REQUIRED_PROBE_IDS) == 4, "required probe contract mismatch")
        print("stage1 production blocker audit contract passed")
        return 0
    try:
        validate_audit(load_json(args.audit))
    except ProductionBlockerAuditValidationError as exc:
        raise SystemExit(f"stage1 production blocker audit validation failed: {exc}") from exc
    print("stage1 production blocker audit validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
