#!/usr/bin/env python3
"""Validate the non-clearing Stage 1 production launch input packet."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-input-packet.json"
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
    "stripe_webhook_secret",
    "billing_webhook_secret",
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
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)


class ProductionLaunchInputPacketError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionLaunchInputPacketError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionLaunchInputPacketError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionLaunchInputPacketError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def validate_template_refs(data: dict[str, Any]) -> None:
    refs = data.get("template_refs")
    require(isinstance(refs, dict), "template_refs must be object")
    required = {
        "billing_live_proof_template",
        "billing_source_template",
        "security_proof_template",
        "security_source_template",
        "legal_support_source_template",
        "governance_proof_template",
        "governance_source_template",
    }
    require(required <= set(refs), "template_refs missing required templates")
    for name in sorted(required):
        value = refs.get(name)
        require(isinstance(value, dict), f"template_refs.{name} must be object")
        path_ref = require_string(value.get("path"), f"template_refs.{name}.path")
        require(path_ref.startswith("ops/evidence/non_clearing/templates/"), f"template_refs.{name}.path must be non-clearing")
        require(value.get("exists") is True, f"template_refs.{name} must exist")
        require(value.get("template_only") is True, f"template_refs.{name} must be template_only")
        require(str(value.get("schema_version", "")).strip(), f"template_refs.{name}.schema_version missing")


def validate_source_inputs(data: dict[str, Any]) -> None:
    rows = data.get("source_inputs")
    require(isinstance(rows, list), "source_inputs must be list")
    require(len(rows) == len(REQUIRED_PROBE_IDS), "source_inputs length mismatch")
    seen: list[str] = []
    for idx, row in enumerate(rows):
        require(isinstance(row, dict), f"source_inputs[{idx}] must be object")
        probe_id = require_string(row.get("probe_id"), f"source_inputs[{idx}].probe_id")
        seen.append(probe_id)
        require(probe_id in REQUIRED_PROBE_IDS, f"source_inputs[{idx}].probe_id unexpected")
        require(row.get("status") in {"missing", "present"}, f"source_inputs[{idx}].status mismatch")
        exists = row.get("source_probe_exists")
        require(isinstance(exists, bool), f"source_inputs[{idx}].source_probe_exists must be bool")
        if row.get("status") == "missing":
            require(exists is False, f"source_inputs[{idx}] must not claim source exists while status is missing")
        if row.get("status") == "present":
            require(exists is True, f"source_inputs[{idx}] must claim source exists while status is present")
        require_string(row.get("source_path"), f"source_inputs[{idx}].source_path")
        require_string(row.get("source_schema_version"), f"source_inputs[{idx}].source_schema_version")
        require_string(row.get("diagnostic_path"), f"source_inputs[{idx}].diagnostic_path")
        require_string(row.get("missing_input"), f"source_inputs[{idx}].missing_input")
        require_string(row.get("source_template_ref"), f"source_inputs[{idx}].source_template_ref")
        require_string(row.get("source_probe_command"), f"source_inputs[{idx}].source_probe_command")
        require_string(row.get("evidence_generator"), f"source_inputs[{idx}].evidence_generator")
        require_string(row.get("strict_validator"), f"source_inputs[{idx}].strict_validator")
        blockers = row.get("blockers")
        require(isinstance(blockers, list), f"source_inputs[{idx}].blockers must be list")
        require(len(blockers) <= 6, f"source_inputs[{idx}].blockers must be capped")
        require_string(row.get("first_blocker"), f"source_inputs[{idx}].first_blocker")
        if probe_id != "production_legal_support_policy":
            require_string(row.get("proof_template_ref"), f"source_inputs[{idx}].proof_template_ref")
            if probe_id == "production_paid_billing_lifecycle":
                diagnostics = row.get("supporting_diagnostics")
                require(isinstance(diagnostics, list), "billing source input supporting_diagnostics must be list")
                require(
                    "ops/evidence/non_clearing/production-billing-operator-packet.json" in diagnostics,
                    "billing source input must reference production billing operator packet",
                )
            if probe_id == "production_security_launch_checks":
                diagnostics = row.get("supporting_diagnostics")
                require(isinstance(diagnostics, list), "security source input supporting_diagnostics must be list")
                require(
                    "ops/evidence/non_clearing/production-security-operator-packet.json" in diagnostics,
                    "security source input must reference production security operator packet",
                )
            if probe_id == "production_governance_release":
                diagnostics = row.get("supporting_diagnostics")
                require(isinstance(diagnostics, list), "governance source input supporting_diagnostics must be list")
                require(
                    "ops/evidence/non_clearing/production-governance-operator-packet.json" in diagnostics,
                    "governance source input must reference production governance operator packet",
                )
        else:
            require(row.get("proof_template_ref") is None, "legal/support source input must not require proof template")
            diagnostics = row.get("supporting_diagnostics")
            require(isinstance(diagnostics, list), "legal/support source input supporting_diagnostics must be list")
            require(
                "ops/evidence/non_clearing/production-dns-readiness.json" in diagnostics,
                "legal/support source input must reference production DNS readiness",
            )
            require(
                "ops/evidence/non_clearing/production-legal-support-operator-packet.json" in diagnostics,
                "legal/support source input must reference production legal/support operator packet",
            )
    require(seen == REQUIRED_PROBE_IDS, "source_inputs order mismatch")


def validate_execution_order(data: dict[str, Any]) -> None:
    order = data.get("execution_order")
    require(isinstance(order, dict), "execution_order must be object")
    for key in (
        "generate_templates",
        "run_one_shot_proof_bundle_preflight",
        "write_canonical_sources_after_real_inputs",
        "generate_and_validate_after_sources",
    ):
        values = order.get(key)
        require(isinstance(values, list) and values, f"execution_order.{key} must be non-empty list")
        for idx, value in enumerate(values):
            require(isinstance(value, str) and value.strip(), f"execution_order.{key}[{idx}] must be non-empty string")
    templates = "\n".join(order["generate_templates"])
    require("stage1_billing_live_proof_template.py" in templates, "execution_order must generate billing live proof template")
    require("generate_stage1_production_source_probe_templates.py" in templates, "execution_order must generate production source templates")
    require(
        "validate_stage1_production_source_probe_templates.py" in templates,
        "execution_order must validate production source templates after generation",
    )
    require("--write-canonical-source" not in templates, "template generation must not request canonical writes")
    one_shot = "\n".join(order["run_one_shot_proof_bundle_preflight"])
    require("run_stage1_production_proof_bundle.py" in one_shot, "execution_order must include proof bundle preflight")
    require("validate_stage1_production_proof_bundle.py" in one_shot, "execution_order must validate proof bundle")
    require("--write-canonical-sources" not in one_shot, "proof bundle preflight must not request canonical writes")
    joined = "\n".join(order["write_canonical_sources_after_real_inputs"])
    for token in ("--billing", "--security", "--legal-support", "--governance", "--write-canonical-source"):
        require(token in joined, f"execution_order write source commands missing {token}")
    post = "\n".join(order["generate_and_validate_after_sources"])
    require("validate_stage1_production_launch.py" in post, "execution_order must end with production launch validation")


def validate_proof_bundle(data: dict[str, Any]) -> None:
    bundle = data.get("proof_bundle")
    require(isinstance(bundle, dict), "proof_bundle must be object")
    require(bundle.get("runner") == "scripts/run_stage1_production_proof_bundle.py", "proof_bundle runner mismatch")
    require(bundle.get("validator") == "scripts/validate_stage1_production_proof_bundle.py", "proof_bundle validator mismatch")
    summary = bundle.get("summary")
    require(isinstance(summary, dict), "proof_bundle.summary must be object")
    require(summary.get("path") == "ops/evidence/non_clearing/production-proof-bundle.json", "proof_bundle summary path mismatch")
    require(summary.get("status") in {"missing", "blocked", "pass"}, "proof_bundle summary status mismatch")
    require(summary.get("release_gate_decision") in {"no_go", "go_candidate_requires_strict_production_launch_validation"}, "proof_bundle summary decision mismatch")
    require(isinstance(summary.get("canonical_sources_requested"), bool), "proof_bundle summary canonical_sources_requested must be bool")
    if summary.get("status") == "blocked":
        require(summary.get("canonical_sources_requested") is False, "blocked proof bundle summary must not request canonical sources")
    first_blockers = summary.get("first_blockers")
    require(isinstance(first_blockers, list) and first_blockers, "proof_bundle.summary.first_blockers must be non-empty list")
    coverage = summary.get("input_variable_coverage")
    require(isinstance(coverage, dict), "proof_bundle.summary.input_variable_coverage must be object")
    for field in (
        "required_total",
        "required_configured",
        "required_missing",
        "required_invalid",
        "blocking_input_count",
    ):
        require(isinstance(coverage.get(field), int), f"proof_bundle.summary.input_variable_coverage.{field} must be int")
        require(coverage[field] >= 0, f"proof_bundle.summary.input_variable_coverage.{field} must be non-negative")
    require(
        coverage["required_configured"] + coverage["required_missing"] + coverage["required_invalid"] == coverage["required_total"],
        "proof_bundle.summary.input_variable_coverage required counters must add up",
    )
    require(
        coverage["blocking_input_count"] == coverage["required_missing"] + coverage["required_invalid"],
        "proof_bundle.summary.input_variable_coverage blocking count mismatch",
    )
    pct = coverage.get("required_completion_percent")
    require(isinstance(pct, (int, float)), "proof_bundle.summary.input_variable_coverage.required_completion_percent must be numeric")
    require(0 <= float(pct) <= 100, "proof_bundle.summary.input_variable_coverage.required_completion_percent out of range")
    first_inputs = coverage.get("first_missing_or_invalid_inputs")
    require(isinstance(first_inputs, list), "proof_bundle.summary.input_variable_coverage.first_missing_or_invalid_inputs must be list")
    require(len(first_inputs) <= 12, "proof_bundle.summary.input_variable_coverage.first_missing_or_invalid_inputs must be capped")
    groups_summary = coverage.get("groups")
    require(isinstance(groups_summary, dict), "proof_bundle.summary.input_variable_coverage.groups must be object")
    require({"production_dns", "billing", "security", "governance"} <= set(groups_summary), "proof_bundle summary coverage groups missing")
    for group, value in groups_summary.items():
        require(isinstance(value, dict), f"proof_bundle.summary.input_variable_coverage.groups.{group} must be object")
        for field in ("required_total", "required_configured", "required_missing", "required_invalid"):
            require(isinstance(value.get(field), int), f"proof_bundle summary coverage {group}.{field} must be int")
    for field in ("billing_status", "security_status", "governance_status", "pipeline_status"):
        require(isinstance(summary.get(field), str) and summary.get(field), f"proof_bundle.summary.{field} must be string")

    groups = bundle.get("required_env_variable_groups")
    require(isinstance(groups, dict), "proof_bundle.required_env_variable_groups must be object")
    required_groups = {"production_dns", "billing", "security", "governance"}
    require(required_groups <= set(groups), "proof_bundle env groups missing")
    required_tokens = {
        "production_dns": ("PRODUCTION_DNS_TARGET", "CLOUDFLARE_API_TOKEN or CF_API_TOKEN"),
        "billing": ("STRIPE_MODE=live", "STAGE1_PROD_BILLING_CHECKOUT_SESSION_ID"),
        "security": ("STAGE1_PROD_SECURITY_SECURE_SESSION_COOKIE_REF", "STAGE1_PROD_SECURITY_AUDIT_REF"),
        "governance": (
            "STAGE1_PROD_GOVERNANCE_ACTIVATION_RUNTIME_REQUEST_IDS",
            "STAGE1_PROD_GOVERNANCE_SKILL_RELEASE_NOTES_REF",
        ),
    }
    for group, tokens in required_tokens.items():
        values = groups.get(group)
        require(isinstance(values, list) and values, f"proof_bundle.required_env_variable_groups.{group} must be list")
        joined = "\n".join(str(item) for item in values)
        for token in tokens:
            require(token in joined, f"proof_bundle.required_env_variable_groups.{group} missing {token}")

    commands = bundle.get("operator_commands")
    require(isinstance(commands, dict), "proof_bundle.operator_commands must be object")
    preflight = commands.get("non_clearing_preflight")
    canonical = commands.get("canonical_after_real_production_inputs_pass")
    require(isinstance(preflight, list) and preflight, "proof_bundle non-clearing preflight commands missing")
    require(isinstance(canonical, list) and canonical, "proof_bundle canonical commands missing")
    preflight_text = "\n".join(str(item) for item in preflight)
    canonical_text = "\n".join(str(item) for item in canonical)
    require("run_stage1_production_proof_bundle.py" in preflight_text, "proof_bundle preflight must run bundle")
    require("validate_stage1_production_proof_bundle.py" in preflight_text, "proof_bundle preflight must validate bundle")
    require("--write-canonical-sources" not in preflight_text, "proof_bundle preflight must be non-clearing")
    require("--write-canonical-sources" in canonical_text, "proof_bundle canonical command must be explicit")
    require("validate_stage1_production_launch.py" in canonical_text, "proof_bundle canonical path must run strict launch validator")
    policy = require_string(bundle.get("canonical_write_policy"), "proof_bundle.canonical_write_policy")
    require("--write-canonical-sources" in policy, "proof_bundle canonical policy must name explicit write flag")


def validate_packet(data: dict[str, Any]) -> None:
    assert_no_secret(data, "packet")
    require(data.get("schema_version") == "stage1.production_launch_input_packet.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_launch_input_packet", "kind mismatch")
    require(data.get("status") == "blocked", "packet must remain blocked")
    require(data.get("release_gate_decision") == "no_go", "packet must remain no_go")
    require(data.get("non_clearing_input_packet") is True, "non_clearing_input_packet must be true")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "packet cannot clear production launch")
    require(data.get("can_close_do_not_launch") is False, "packet cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    require_string(data.get("source_readiness_ref"), "source_readiness_ref")
    require_string(data.get("closure_queue_ref"), "closure_queue_ref")
    closure = data.get("closure_summary")
    require(isinstance(closure, dict), "closure_summary must be object")
    require(closure.get("release_gate_decision") == "no_go", "closure summary must remain no_go")
    dns = data.get("production_dns_readiness")
    require(isinstance(dns, dict), "production_dns_readiness must be object")
    require(dns.get("path") == "ops/evidence/non_clearing/production-dns-readiness.json", "production DNS readiness path mismatch")
    require(dns.get("status") in {"missing", "blocked", "pass"}, "production DNS readiness status mismatch")
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
    require(isinstance(data.get("missing_variables"), list), "missing_variables must be list")
    gate_impact = data.get("gate_impact")
    require(isinstance(gate_impact, dict), "gate_impact must be object")
    for key, value in gate_impact.items():
        if key.startswith("can_clear_"):
            require(value is False, f"gate_impact.{key} must be false")
    require(gate_impact.get("preserved_do_not_launch_condition") == "stage1_production_launch_evidence_incomplete", "DNL preservation mismatch")
    validate_template_refs(data)
    validate_proof_bundle(data)
    validate_source_inputs(data)
    validate_execution_order(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Stage 1 production launch input packet")
    parser.add_argument("--packet", type=Path, default=DEFAULT_PACKET)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.contract_only:
            require(len(REQUIRED_PROBE_IDS) == 4, "probe id contract mismatch")
            print("stage1 production launch input packet contract passed")
            return 0
        data = load_json(args.packet)
        validate_packet(data)
    except ProductionLaunchInputPacketError as exc:
        raise SystemExit(f"stage1 production launch input packet validation failed: {exc}") from exc
    print("stage1 production launch input packet validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
