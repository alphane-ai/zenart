#!/usr/bin/env python3
"""Generate a blank production input env template for Stage 1 launch proofs.

The template is deliberately non-clearing: it contains variable names only and
empty values. Operators can use it as a checklist for a private production env
file, while validators can prove the template stays aligned with the proof
bundle input contract.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import run_stage1_production_proof_bundle as proof_bundle


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TEMPLATE = ROOT / "ops" / "evidence" / "non_clearing" / "production-input-template.env"
DEFAULT_MANIFEST = ROOT / "ops" / "evidence" / "non_clearing" / "production-input-template.json"

SAFE_FALSE_FIELDS = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
}
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

GROUPS = [
    {
        "group_id": "production_dns",
        "title": "Production DNS and HTTPS",
        "required": proof_bundle.PRODUCTION_DNS_REQUIRED_INPUTS,
        "optional": (),
        "notes": [
            "PRODUCTION_WEB_URL should be the public HTTPS production URL.",
            "Cloudflare values may be omitted only when DNS is applied manually and evidence is recorded elsewhere.",
        ],
    },
    {
        "group_id": "billing",
        "title": "Production Stripe live billing lifecycle",
        "required": proof_bundle.BILLING_REQUIRED_INPUTS,
        "optional": proof_bundle.BILLING_OPTIONAL_OR_DEFAULTED_INPUTS,
        "notes": [
            "Use live mode only. Do not put sandbox IDs in this production template.",
            "Store raw Stripe keys only in a private local env file, never in committed evidence.",
        ],
    },
    {
        "group_id": "security",
        "title": "Production security runtime refs",
        "required": proof_bundle.SECURITY_REQUIRED_INPUTS,
        "optional": proof_bundle.SECURITY_OPTIONAL_OR_DEFAULTED_INPUTS,
        "notes": [
            "Refs should point to sanitized production runtime or audit evidence.",
            "Counts must remain zero for raw secret and frontend secret exposure.",
        ],
    },
    {
        "group_id": "governance",
        "title": "Production governance release refs",
        "required": proof_bundle.GOVERNANCE_REQUIRED_INPUTS,
        "optional": proof_bundle.GOVERNANCE_OPTIONAL_OR_DEFAULTED_INPUTS,
        "notes": [
            "Refs should be immutable production audit refs or production runtime request IDs.",
            "Skill risk level is optional/defaulted by the proof helper unless explicitly set.",
        ],
    },
]


class ProductionInputTemplateError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionInputTemplateError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionInputTemplateError(f"{path} contains raw secret-looking material")


def accepted_names(requirement: dict[str, Any]) -> list[str]:
    return [str(name) for name in requirement.get("accepted_variable_names", ()) if str(name).strip()]


def unique_preserve_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def group_manifest(group: dict[str, Any]) -> dict[str, Any]:
    required = list(group["required"])
    optional = tuple(str(name) for name in group["optional"])
    required_variables = unique_preserve_order([name for requirement in required for name in accepted_names(requirement)])
    return {
        "group_id": group["group_id"],
        "title": group["title"],
        "required_requirement_count": len(required),
        "required_template_variable_count": len(required_variables),
        "required_template_variables": required_variables,
        "optional_or_defaulted_count": len(optional),
        "optional_or_defaulted_variables": list(optional),
        "notes": list(group["notes"]),
    }


def build_manifest(args: argparse.Namespace, template_text: str) -> dict[str, Any]:
    groups = [group_manifest(group) for group in GROUPS]
    required_total = sum(group["required_requirement_count"] for group in groups)
    required_template_variable_count = sum(group["required_template_variable_count"] for group in groups)
    optional_total = sum(group["optional_or_defaulted_count"] for group in groups)
    template_variables = parse_template_variable_names(template_text)
    data: dict[str, Any] = {
        "schema_version": "stage1.production_input_template.v1",
        "kind": "stage1_production_input_template",
        "environment": "production",
        "status": "template_only",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "template_path": display_path(args.output),
        "manifest_path": display_path(args.manifest),
        "non_clearing_template": True,
        "canonical_pass_path": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "value_policy": "blank_values_only",
        "template_variable_count": len(template_variables),
        "required_requirement_count": required_total,
        "required_template_variable_count": required_template_variable_count,
        "optional_or_defaulted_variable_count": optional_total,
        "groups": groups,
        "commands_after_fill": [
            "python3 scripts/run_stage1_production_proof_bundle.py --env <private-production-env> || test $? -eq 2",
            "python3 scripts/validate_stage1_production_proof_bundle.py --summary ops/evidence/non_clearing/production-proof-bundle.json",
            "python3 scripts/generate_stage1_production_action_matrix.py",
            "python3 scripts/validate_stage1_production_action_matrix.py",
        ],
        "generator_command": "python3 scripts/generate_stage1_production_input_template.py",
        "validator_command": "python3 scripts/validate_stage1_production_input_template.py",
        "source_contract": {
            "runner": "scripts/run_stage1_production_proof_bundle.py",
            "validator": "scripts/validate_stage1_production_proof_bundle.py",
            "coverage_schema": "stage1.production_proof_bundle.input_variable_coverage.v1",
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "production_input_template_manifest")
    return data


def parse_template_variable_names(text: str) -> list[str]:
    names: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if value != "":
            raise ProductionInputTemplateError(f"{key} must have a blank value")
        if not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ProductionInputTemplateError(f"invalid env variable name {key!r}")
        names.append(key)
    return names


def render_template() -> str:
    lines = [
        "# Stage 1 production input template for zenari.ai",
        "# Values are intentionally blank. Keep filled copies private and gitignored.",
        "# This file is non-clearing evidence and cannot close production launch gates.",
        "",
    ]
    for group in GROUPS:
        manifest = group_manifest(group)
        lines.extend(
            [
                f"# {manifest['title']}",
                f"# Required proof requirements: {manifest['required_requirement_count']}",
                f"# Required template variables: {manifest['required_template_variable_count']}",
            ]
        )
        for note in manifest["notes"]:
            lines.append(f"# {note}")
        for requirement in group["required"]:
            names = accepted_names(requirement)
            display_name = str(requirement.get("display_name", names[0] if names else "unknown"))
            lines.append(f"# {display_name}")
            if len(names) > 1:
                lines.append(f"# Accepted alternatives: {', '.join(names)}")
            for name in names:
                lines.append(f"{name}=")
            lines.append("")
        optional = tuple(str(name) for name in group["optional"])
        if optional:
            lines.append(f"# Optional/defaulted variables for {manifest['title']}")
            for name in optional:
                lines.append(f"{name}=")
            lines.append("")
    text = "\n".join(lines).rstrip() + "\n"
    parse_template_variable_names(text)
    assert_no_secret(text, "production_input_template")
    return text


def write_text(path: Path, text: str) -> None:
    assert_no_secret(text, "production_input_template")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_input_template_manifest")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        expected_groups = [group["group_id"] for group in GROUPS]
        if expected_groups != ["production_dns", "billing", "security", "governance"]:
            raise SystemExit("production input template group contract mismatch")
        print("stage1 production input template generator contract passed")
        return 0
    template = render_template()
    manifest = build_manifest(args, template)
    write_text(args.output, template)
    write_json(args.manifest, manifest)
    print(f"wrote Stage 1 production input template to {display_path(args.output)} and {display_path(args.manifest)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
