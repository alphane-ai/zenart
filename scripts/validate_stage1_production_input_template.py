#!/usr/bin/env python3
"""Validate the blank Stage 1 production input env template."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE = ROOT / "ops" / "evidence" / "non_clearing" / "production-input-template.env"
DEFAULT_MANIFEST = ROOT / "ops" / "evidence" / "non_clearing" / "production-input-template.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_production_input_template.py"
RUNNER = ROOT / "scripts" / "run_stage1_production_proof_bundle.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
REQUIRED_GROUPS = ("production_dns", "billing", "security", "governance")
REQUIRED_TEMPLATE_VARIABLE_COUNTS = {
    "production_dns": 6,
    "billing": 22,
    "security": 10,
    "governance": 26,
}
REQUIRED_REQUIREMENT_COUNTS = {
    "production_dns": 4,
    "billing": 20,
    "security": 10,
    "governance": 26,
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
    "stripe_webhook_secret",
    "billing_webhook_secret",
    "stripe-signature",
    "stripe_signature",
    "signature",
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


class ProductionInputTemplateValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionInputTemplateValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ProductionInputTemplateValidationError(f"missing {display_path(path)}") from exc


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ProductionInputTemplateValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def parse_template(text: str) -> list[str]:
    assert_no_secret(text, "production_input_template")
    names: list[str] = []
    for line_number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        require("=" in line, f"template line {line_number} must be KEY=")
        key, value = line.split("=", 1)
        require(value == "", f"template line {line_number} must keep {key} blank")
        require(re.fullmatch(r"[A-Z][A-Z0-9_]*", key) is not None, f"invalid env key on line {line_number}: {key}")
        names.append(key)
    require(len(names) == len(set(names)), "template variables must be unique")
    return names


def validate_code_anchors() -> None:
    generator = read_text(GENERATOR)
    for snippet in (
        "stage1.production_input_template.v1",
        "production-input-template.env",
        "production-input-template.json",
        "blank_values_only",
        "generate_stage1_production_input_template.py",
        "validate_stage1_production_input_template.py",
        "run_stage1_production_proof_bundle.py",
    ):
        require(snippet in generator, f"{display_path(GENERATOR)} missing {snippet!r}")
    runner = read_text(RUNNER)
    for snippet in (
        "PRODUCTION_DNS_REQUIRED_INPUTS",
        "BILLING_REQUIRED_INPUTS",
        "SECURITY_REQUIRED_INPUTS",
        "GOVERNANCE_REQUIRED_INPUTS",
        "input_variable_coverage",
    ):
        require(snippet in runner, f"{display_path(RUNNER)} missing {snippet!r}")
    repo_validate = read_text(REPO_VALIDATE)
    for snippet in (
        "generate_stage1_production_input_template.py --contract-only",
        "validate_stage1_production_input_template.py --contract-only",
        "production-input-template.env",
    ):
        require(snippet in repo_validate, f"{display_path(REPO_VALIDATE)} missing {snippet!r}")


def string_list(value: Any, path: str, *, min_len: int = 0) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    require(len(value) >= min_len, f"{path} must contain at least {min_len} items")
    result: list[str] = []
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be non-empty string")
        result.append(item.strip())
    return result


def validate_manifest(data: dict[str, Any], template_names: list[str], template_path: Path, manifest_path: Path) -> None:
    assert_no_secret(data, "production_input_template_manifest")
    require(data.get("schema_version") == "stage1.production_input_template.v1", "schema_version mismatch")
    require(data.get("kind") == "stage1_production_input_template", "kind mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("status") == "template_only", "status mismatch")
    require(data.get("release_gate_decision") == "no_go", "template must remain no_go")
    require(data.get("template_path") == display_path(template_path), "template_path mismatch")
    require(data.get("manifest_path") == display_path(manifest_path), "manifest_path mismatch")
    require(data.get("non_clearing_template") is True, "template must be non-clearing")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "template cannot clear launch gate")
    require(data.get("can_close_do_not_launch") is False, "template cannot close do-not-launch")
    require(data.get("value_policy") == "blank_values_only", "value_policy mismatch")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    groups = data.get("groups")
    require(isinstance(groups, list) and len(groups) == len(REQUIRED_GROUPS), "groups length mismatch")
    seen_groups: list[str] = []
    required_requirement_total = 0
    required_template_variable_total = 0
    optional_total = 0
    group_variables: list[str] = []
    for idx, group in enumerate(groups):
        require(isinstance(group, dict), f"groups[{idx}] must be object")
        group_id = group.get("group_id")
        require(group_id in REQUIRED_GROUPS, f"unexpected group {group_id}")
        seen_groups.append(str(group_id))
        require(group.get("required_requirement_count") == REQUIRED_REQUIREMENT_COUNTS[group_id], f"{group_id} required count mismatch")
        require(
            group.get("required_template_variable_count") == REQUIRED_TEMPLATE_VARIABLE_COUNTS[group_id],
            f"{group_id} template variable count mismatch",
        )
        required_vars = string_list(group.get("required_template_variables"), f"groups.{group_id}.required_template_variables")
        require(len(required_vars) == REQUIRED_TEMPLATE_VARIABLE_COUNTS[group_id], f"{group_id} required variable list length mismatch")
        optional_vars = string_list(group.get("optional_or_defaulted_variables"), f"groups.{group_id}.optional_or_defaulted_variables")
        require(group.get("optional_or_defaulted_count") == len(optional_vars), f"{group_id} optional count mismatch")
        string_list(group.get("notes"), f"groups.{group_id}.notes", min_len=1)
        required_requirement_total += int(group["required_requirement_count"])
        required_template_variable_total += int(group["required_template_variable_count"])
        optional_total += int(group["optional_or_defaulted_count"])
        group_variables.extend(required_vars)
        group_variables.extend(optional_vars)
    require(seen_groups == list(REQUIRED_GROUPS), "group order mismatch")
    require(data.get("required_requirement_count") == required_requirement_total, "required_requirement_count mismatch")
    require(data.get("required_template_variable_count") == required_template_variable_total, "required_template_variable_count mismatch")
    require(data.get("optional_or_defaulted_variable_count") == optional_total, "optional variable count mismatch")
    require(data.get("template_variable_count") == len(template_names), "template variable count mismatch")
    require(set(template_names) == set(group_variables), "template variables must match manifest groups")

    commands = string_list(data.get("commands_after_fill"), "commands_after_fill", min_len=4)
    for snippet in (
        "run_stage1_production_proof_bundle.py",
        "validate_stage1_production_proof_bundle.py",
        "generate_stage1_production_action_matrix.py",
        "validate_stage1_production_action_matrix.py",
    ):
        require(any(snippet in command for command in commands), f"commands_after_fill missing {snippet}")
    source = data.get("source_contract")
    require(isinstance(source, dict), "source_contract must be object")
    require(source.get("runner") == "scripts/run_stage1_production_proof_bundle.py", "source_contract.runner mismatch")
    require(source.get("coverage_schema") == "stage1.production_proof_bundle.input_variable_coverage.v1", "coverage schema mismatch")
    require(
        data.get("generator_command") == "python3 scripts/generate_stage1_production_input_template.py",
        "generator_command mismatch",
    )
    require(
        data.get("validator_command") == "python3 scripts/validate_stage1_production_input_template.py",
        "validator_command mismatch",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        validate_code_anchors()
        print("stage1 production input template contract passed")
        return 0
    try:
        template_names = parse_template(read_text(args.template))
        validate_manifest(load_json(args.manifest), template_names, args.template, args.manifest)
    except ProductionInputTemplateValidationError as exc:
        raise SystemExit(f"stage1 production input template validation failed: {exc}") from exc
    print("stage1 production input template validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
