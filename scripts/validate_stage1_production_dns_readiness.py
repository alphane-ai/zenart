#!/usr/bin/env python3
"""Validate non-clearing Stage 1 production DNS readiness diagnostics."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
GENERATOR = ROOT / "scripts" / "stage1_production_dns_readiness.py"
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
R2_S3_ENV_KEYS = [
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
]
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,})"
)


class ProductionDnsReadinessError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionDnsReadinessError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionDnsReadinessError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionDnsReadinessError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ProductionDnsReadinessError(f"missing {display_path(path)}") from exc


def require_string(value: Any, path: str) -> str:
    require(isinstance(value, str) and value.strip(), f"{path} must be a non-empty string")
    return value.strip()


def require_string_list(value: Any, path: str, min_len: int = 0) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    rows: list[str] = []
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be non-empty string")
        rows.append(item.strip())
    require(len(rows) >= min_len, f"{path} must contain at least {min_len} entries")
    return rows


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in {"authorization", "cookie", "set-cookie", "secret", "api_key"}, f"{path}.{key} exposes secret field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains secret-looking material")


def require_probe(value: Any, path: str) -> dict[str, Any]:
    require(isinstance(value, dict), f"{path} must be object")
    require(value.get("status") in {"pass", "blocked", "missing"}, f"{path}.status mismatch")
    return value


def require_address_list(value: Any, path: str) -> list[str]:
    require(isinstance(value, list), f"{path} must be list")
    output: list[str] = []
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be non-empty string")
        output.append(item.strip())
    return output


def validate_code_anchors() -> None:
    text = read_text(GENERATOR)
    for snippet in (
        "stage1.production_dns_readiness.v1",
        "production-dns-readiness.json",
        "credential_scope",
        "r2_s3_can_manage_dns",
        "R2 S3 access keys are object-storage credentials only",
        "CLOUDFLARE_ZONE_ID",
        "CF_API_TOKEN",
        "PRODUCTION_DNS_TARGET",
    ):
        require(snippet in text, f"{display_path(GENERATOR)} missing required snippet {snippet!r}")


def validate_credential_scope(data: dict[str, Any]) -> None:
    scope = data.get("credential_scope")
    require(isinstance(scope, dict), "credential_scope must be object")
    require(isinstance(scope.get("cloudflare_dns_credentials_configured"), bool), "credential_scope.cloudflare_dns_credentials_configured must be bool")
    require(isinstance(scope.get("cloudflare_zone_id_configured"), bool), "credential_scope.cloudflare_zone_id_configured must be bool")
    require(isinstance(scope.get("cloudflare_api_token_configured"), bool), "credential_scope.cloudflare_api_token_configured must be bool")
    require(
        scope.get("cloudflare_dns_credentials_configured")
        == bool(scope.get("cloudflare_zone_id_configured") and scope.get("cloudflare_api_token_configured")),
        "credential_scope DNS configured flag mismatch",
    )
    require(isinstance(scope.get("production_dns_target_configured"), bool), "credential_scope.production_dns_target_configured must be bool")
    require(isinstance(scope.get("r2_s3_credentials_detected"), bool), "credential_scope.r2_s3_credentials_detected must be bool")
    r2_keys = require_string_list(scope.get("r2_s3_present_keys"), "credential_scope.r2_s3_present_keys")
    require(all(item in R2_S3_ENV_KEYS for item in r2_keys), "credential_scope.r2_s3_present_keys contains unexpected key")
    require(scope.get("r2_s3_credentials_detected") == bool(r2_keys), "credential_scope R2 detected flag mismatch")
    require(scope.get("r2_s3_can_manage_dns") is False, "R2 S3 credentials must not be treated as DNS credentials")
    dns_write_requires = require_string_list(scope.get("dns_write_requires"), "credential_scope.dns_write_requires", min_len=3)
    require(any("Zone DNS Edit" in item for item in dns_write_requires), "credential_scope.dns_write_requires must mention Zone DNS Edit")
    require("object-storage credentials only" in require_string(scope.get("operator_note"), "credential_scope.operator_note"), "credential_scope.operator_note must distinguish R2 from DNS")


def validate(data: dict[str, Any]) -> None:
    assert_no_secret(data, "dns_readiness")
    require(data.get("schema_version") == "stage1.production_dns_readiness.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_dns_readiness", "kind mismatch")
    require(data.get("status") in {"pass", "blocked"}, "status mismatch")
    require(data.get("release_gate_decision") == "no_go", "release gate decision must remain no_go")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "cannot clear production launch")
    require(data.get("can_clear_production_legal_support_policy") is False, "cannot clear legal/support")
    require(data.get("can_close_do_not_launch") is False, "cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    blocked = data.get("blocked_checks")
    require(isinstance(blocked, list), "blocked_checks must be list")
    if data.get("status") == "blocked":
        require(blocked, "blocked diagnostic must include blocked_checks")
    control_warnings = data.get("control_warnings")
    require(isinstance(control_warnings, list), "control_warnings must be list")
    for idx, warning in enumerate(control_warnings):
        require(isinstance(warning, str) and warning.strip(), f"control_warnings[{idx}] must be non-empty string")
    validate_credential_scope(data)
    system = data.get("system_resolver")
    require(isinstance(system, dict), "system_resolver must be object")
    require_probe(system.get("production"), "system_resolver.production")
    require_probe(system.get("staging_control"), "system_resolver.staging_control")
    dns = data.get("authoritative_public_dns_probe")
    require(isinstance(dns, dict), "authoritative_public_dns_probe must be object")
    for key in ("production_a", "production_aaaa", "staging_a"):
        require_probe(dns.get(key), f"authoritative_public_dns_probe.{key}")
    doh = data.get("dns_over_https_probe")
    require(isinstance(doh, dict), "dns_over_https_probe must be object")
    for key in (
        "production_a_cloudflare",
        "production_aaaa_cloudflare",
        "production_a_google",
        "production_aaaa_google",
        "staging_a_cloudflare",
        "staging_a_google",
    ):
        probe = require_probe(doh.get(key), f"dns_over_https_probe.{key}")
        require(probe.get("resolver") in {"cloudflare", "google"}, f"dns_over_https_probe.{key}.resolver mismatch")
        require(probe.get("rrtype") in {"A", "AAAA"}, f"dns_over_https_probe.{key}.rrtype mismatch")
        require_address_list(probe.get("addresses"), f"dns_over_https_probe.{key}.addresses")
        require("http_status" in probe, f"dns_over_https_probe.{key}.http_status missing")
        require("dns_rcode" in probe, f"dns_over_https_probe.{key}.dns_rcode missing")
        require(isinstance(probe.get("error"), str), f"dns_over_https_probe.{key}.error must be string")
    require_address_list(data.get("public_production_addresses_observed"), "public_production_addresses_observed")
    https = data.get("https_probe")
    require(isinstance(https, dict), "https_probe must be object")
    production_paths = https.get("production_paths")
    require(isinstance(production_paths, list) and production_paths, "https_probe.production_paths must be non-empty list")
    for idx, item in enumerate(production_paths):
        require_probe(item, f"https_probe.production_paths[{idx}]")
    require_probe(https.get("staging_control"), "https_probe.staging_control")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Stage 1 production DNS readiness")
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_code_anchors()
        if args.contract_only:
            print("stage1 production DNS readiness contract passed")
            return 0
        validate(load_json(args.evidence))
    except ProductionDnsReadinessError as exc:
        raise SystemExit(f"stage1 production DNS readiness validation failed: {exc}") from exc
    print("stage1 production DNS readiness validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
