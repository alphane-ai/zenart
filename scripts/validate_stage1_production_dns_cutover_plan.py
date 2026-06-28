#!/usr/bin/env python3
"""Validate non-clearing Stage 1 production DNS cutover plan evidence."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PLAN = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-cutover-plan.json"
GENERATOR = ROOT / "scripts" / "stage1_production_dns_cutover_plan.py"
LEGAL_OPERATOR_GENERATOR = ROOT / "scripts" / "generate_stage1_production_legal_support_operator_packet.py"
LEGAL_OPERATOR_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_legal_support_operator_packet.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
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


class ProductionDnsCutoverPlanValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProductionDnsCutoverPlanValidationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ProductionDnsCutoverPlanValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")


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


def validate_code_anchors() -> None:
    require_text(
        GENERATOR,
        (
            "stage1.production_dns_cutover_plan.v1",
            "production-dns-cutover-plan.json",
            "CLOUDFLARE_ZONE_ID",
            "PRODUCTION_DNS_TARGET",
            "credential_scope",
            "origin_https_preflight",
            "cloudflare_scope_preflight",
            "manual_dns_observation",
            "observed_applied",
            "r2_s3_can_manage_dns",
            "R2 S3 access keys are object-storage credentials only",
            "--verify-cloudflare",
            "Zone DNS Read and Zone DNS Edit",
            "Confirm the target origin already serves zenari.ai and www.zenari.ai over HTTPS",
            "zenari.ai",
            "www.zenari.ai",
            "--apply",
        ),
    )
    require_text(
        LEGAL_OPERATOR_GENERATOR,
        (
            "production-dns-cutover-plan.json",
            "stage1_production_dns_cutover_plan.py",
        ),
    )
    require_text(LEGAL_OPERATOR_VALIDATOR, ("production-dns-cutover-plan.json",))
    require_text(
        REPO_VALIDATE,
        (
            "stage1_production_dns_cutover_plan.py --contract-only",
            "validate_stage1_production_dns_cutover_plan.py --contract-only",
            "production-dns-cutover-plan.json",
        ),
    )


def validate_plan(data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_dns_cutover_plan")
    require(data.get("schema_version") == "stage1.production_dns_cutover_plan.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "environment mismatch")
    require(data.get("kind") == "stage1_production_dns_cutover_plan", "kind mismatch")
    require(data.get("status") in {"blocked", "ready_to_apply", "applied", "observed_applied"}, "status mismatch")
    require(data.get("release_gate_decision") == "no_go", "cutover plan must remain no_go")
    require(data.get("production_web_url") == "https://zenari.ai", "production_web_url mismatch")
    require(data.get("non_clearing_cutover_plan") is True, "non-clearing flag missing")
    require(data.get("canonical_pass_path") is False, "canonical_pass_path must be false")
    require(data.get("can_clear_production_legal_support_policy") is False, "cutover plan cannot clear legal/support")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "cutover plan cannot clear launch")
    require(data.get("can_close_do_not_launch") is False, "cutover plan cannot close DNL")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")

    require(data.get("required_hosts") == ["zenari.ai", "www.zenari.ai"], "required hosts mismatch")
    zone = data.get("cloudflare_zone")
    require(isinstance(zone, dict), "cloudflare_zone must be object")
    require(isinstance(zone.get("zone_id_configured"), bool), "zone_id_configured must be bool")
    require(isinstance(zone.get("api_token_configured"), bool), "api_token_configured must be bool")
    scope = data.get("credential_scope")
    require(isinstance(scope, dict), "credential_scope must be object")
    require(scope.get("cloudflare_dns_credentials_configured") == bool(zone.get("zone_id_configured") and zone.get("api_token_configured")), "credential_scope DNS credential flag mismatch")
    require(scope.get("cloudflare_zone_id_configured") == zone.get("zone_id_configured"), "credential_scope zone flag mismatch")
    require(scope.get("cloudflare_api_token_configured") == zone.get("api_token_configured"), "credential_scope token flag mismatch")
    require(isinstance(scope.get("r2_s3_credentials_detected"), bool), "credential_scope.r2_s3_credentials_detected must be bool")
    r2_keys = scope.get("r2_s3_present_keys")
    require(isinstance(r2_keys, list), "credential_scope.r2_s3_present_keys must be list")
    require(all(item in R2_S3_ENV_KEYS for item in r2_keys), "credential_scope.r2_s3_present_keys contains unexpected key")
    require(scope.get("r2_s3_can_manage_dns") is False, "R2 S3 credentials must not be treated as DNS credentials")
    dns_write_requires = scope.get("dns_write_requires")
    require(isinstance(dns_write_requires, list) and len(dns_write_requires) == 3, "credential_scope.dns_write_requires mismatch")
    require("Zone DNS Edit" in " ".join(str(item) for item in dns_write_requires), "credential_scope must require Zone DNS Edit")
    require("object-storage credentials only" in require_string(scope.get("operator_note"), "credential_scope.operator_note"), "credential_scope.operator_note must distinguish R2 from DNS")
    cloudflare_scope = data.get("cloudflare_scope_preflight")
    require(isinstance(cloudflare_scope, dict), "cloudflare_scope_preflight must be object")
    require(isinstance(cloudflare_scope.get("requested"), bool), "cloudflare_scope_preflight.requested must be bool")
    require(cloudflare_scope.get("status") in {"pass", "blocked", "not_run"}, "cloudflare_scope_preflight.status mismatch")
    require(cloudflare_scope.get("zone_id_configured") == zone.get("zone_id_configured"), "cloudflare_scope_preflight zone flag mismatch")
    require(cloudflare_scope.get("api_token_configured") == zone.get("api_token_configured"), "cloudflare_scope_preflight token flag mismatch")
    require("Zone DNS" in require_string(cloudflare_scope.get("required_scope"), "cloudflare_scope_preflight.required_scope"), "cloudflare_scope_preflight required_scope mismatch")
    scope_checks = cloudflare_scope.get("checks")
    require(isinstance(scope_checks, list), "cloudflare_scope_preflight.checks must be list")
    if cloudflare_scope.get("status") == "not_run":
        require(cloudflare_scope.get("requested") is False, "not_run Cloudflare scope preflight must not be requested")
        require_string(cloudflare_scope.get("reason"), "cloudflare_scope_preflight.reason")
        require(scope_checks == [], "cloudflare_scope_preflight.checks must be empty when not_run")
    else:
        require(cloudflare_scope.get("requested") is True, "Cloudflare scope preflight status requires explicit request")
        require_string(cloudflare_scope.get("reason") or "pass", "cloudflare_scope_preflight.reason")
        for idx, check in enumerate(scope_checks):
            require(isinstance(check, dict), f"cloudflare_scope_preflight.checks[{idx}] must be object")
            require_string(check.get("check_id"), f"cloudflare_scope_preflight.checks[{idx}].check_id")
            require(check.get("status") in {"pass", "blocked"}, f"cloudflare_scope_preflight.checks[{idx}].status mismatch")
            require(isinstance(check.get("success"), bool), f"cloudflare_scope_preflight.checks[{idx}].success must be bool")
            require(isinstance(check.get("error_count"), int), f"cloudflare_scope_preflight.checks[{idx}].error_count must be int")
            require(isinstance(check.get("error_summaries"), list), f"cloudflare_scope_preflight.checks[{idx}].error_summaries must be list")
            require(isinstance(check.get("result_count"), int), f"cloudflare_scope_preflight.checks[{idx}].result_count must be int")
    manual_dns = data.get("manual_dns_observation")
    require(isinstance(manual_dns, dict), "manual_dns_observation must be object")
    require(manual_dns.get("status") in {"observed_applied", "not_observed"}, "manual_dns_observation.status mismatch")
    require(isinstance(manual_dns.get("apex_matches_target"), bool), "manual_dns_observation.apex_matches_target must be bool")
    require(isinstance(manual_dns.get("www_points_to_apex"), bool), "manual_dns_observation.www_points_to_apex must be bool")
    require(isinstance(manual_dns.get("apex_expected"), str), "manual_dns_observation.apex_expected must be string")
    require(isinstance(manual_dns.get("apex_observed"), list), "manual_dns_observation.apex_observed must be list")
    require(isinstance(manual_dns.get("www_observed"), list), "manual_dns_observation.www_observed must be list")
    require(isinstance(manual_dns.get("can_omit_cloudflare_api_credentials"), bool), "manual_dns_observation.can_omit_cloudflare_api_credentials must be bool")
    if data.get("status") == "observed_applied":
        require(manual_dns.get("status") == "observed_applied", "observed_applied status requires manual DNS observation")
        require(manual_dns.get("can_omit_cloudflare_api_credentials") is True, "observed_applied must allow omitting Cloudflare API credentials")
        require("CLOUDFLARE_ZONE_ID_or_CF_ZONE_ID" not in (data.get("blocked_checks") or []), "observed_applied must not require Cloudflare zone id")
        require("CLOUDFLARE_API_TOKEN_or_CF_API_TOKEN" not in (data.get("blocked_checks") or []), "observed_applied must not require Cloudflare API token")
    else:
        require(manual_dns.get("can_omit_cloudflare_api_credentials") is False, "manual DNS credential omission requires observed_applied")
    target = data.get("target")
    require(isinstance(target, dict), "target must be object")
    require(target.get("target_kind") in {"missing", "invalid", "a", "cname"}, "target_kind mismatch")
    origin_preflight = data.get("origin_https_preflight")
    require(isinstance(origin_preflight, dict), "origin_https_preflight must be object")
    require(origin_preflight.get("status") in {"pass", "blocked", "not_run"}, "origin_https_preflight.status mismatch")
    require(origin_preflight.get("required_hosts") == ["zenari.ai", "www.zenari.ai"], "origin_https_preflight.required_hosts mismatch")
    probes = origin_preflight.get("probes")
    require(isinstance(probes, list), "origin_https_preflight.probes must be list")
    if origin_preflight.get("status") == "not_run":
        require_string(origin_preflight.get("reason"), "origin_https_preflight.reason")
        require(probes == [], "origin_https_preflight.probes must be empty when not_run")
    else:
        require(len(probes) == 2, "origin_https_preflight.probes must cover apex and www")
        for idx, probe in enumerate(probes):
            require(isinstance(probe, dict), f"origin_https_preflight.probes[{idx}] must be object")
            require_string(probe.get("connect_host"), f"origin_https_preflight.probes[{idx}].connect_host")
            require(probe.get("sni_host") in {"zenari.ai", "www.zenari.ai"}, f"origin_https_preflight.probes[{idx}].sni_host mismatch")
            require(probe.get("status") in {"pass", "blocked"}, f"origin_https_preflight.probes[{idx}].status mismatch")
            require(isinstance(probe.get("accepted_statuses"), list), f"origin_https_preflight.probes[{idx}].accepted_statuses must be list")
            if probe.get("status") == "blocked":
                require_string(probe.get("error_summary"), f"origin_https_preflight.probes[{idx}].error_summary")
    records = data.get("current_records")
    require(isinstance(records, dict), "current_records must be object")
    for key in ("apex_a", "apex_aaaa", "apex_cname", "www_a", "www_cname", "staging_a"):
        item = records.get(key)
        require(isinstance(item, dict), f"current_records.{key} must be object")
        require_string(item.get("host"), f"current_records.{key}.host")
        require_string(item.get("rrtype"), f"current_records.{key}.rrtype")
        require(item.get("status") in {"pass", "missing"}, f"current_records.{key}.status mismatch")
        require(isinstance(item.get("records"), list), f"current_records.{key}.records must be list")

    actions = data.get("operator_next_actions")
    require(isinstance(actions, list) and len(actions) >= 5, "operator_next_actions incomplete")
    outputs = data.get("evidence_outputs")
    require(isinstance(outputs, dict), "evidence_outputs must be object")
    for key in ("cutover_plan", "dns_readiness", "legal_support_operator_packet"):
        require_string(outputs.get(key), f"evidence_outputs.{key}")
    if data.get("status") == "blocked":
        blockers = data.get("blocked_checks")
        require(isinstance(blockers, list) and blockers, "blocked plan must include blockers")


def run_blocked_selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        env_path = Path(tmp) / ".env"
        env_path.write_text("STAGING_PUBLIC_HOST=staging.zenari.ai\n", encoding="utf-8")
        output = Path(tmp) / "production-dns-cutover-plan.json"
        result = subprocess.run(
            [
                sys.executable,
                str(GENERATOR),
                "--env",
                str(env_path),
                "--output",
                str(output),
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(result.returncode == 2, f"blocked selftest must exit 2, got {result.returncode}: {result.stderr or result.stdout}")
        validate_plan(load_json(output))
        plan = load_json(output)
        require(
            plan.get("target", {}).get("target_kind") == "missing",
            "blocked selftest must not treat STAGING_PUBLIC_HOST as production DNS target",
        )
        require(
            "PRODUCTION_DNS_TARGET_missing_or_invalid" in (plan.get("blocked_checks") or []),
            "blocked selftest must require explicit PRODUCTION_DNS_TARGET",
        )
        require(plan.get("origin_https_preflight", {}).get("status") == "not_run", "blocked selftest must not run origin HTTPS preflight")
        require(plan.get("cloudflare_scope_preflight", {}).get("status") == "not_run", "blocked selftest must not verify Cloudflare by default")
        require(plan.get("manual_dns_observation", {}).get("status") == "not_observed", "blocked selftest must not observe manual DNS applied")
        scope = plan.get("credential_scope") if isinstance(plan.get("credential_scope"), dict) else {}
        require(scope.get("r2_s3_credentials_detected") is False, "blocked selftest without R2 keys must report no R2 credentials")


def run_r2_not_dns_selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        env_path = Path(tmp) / ".env"
        env_path.write_text(
            "\n".join(
                [
                    "OBJECT_STORAGE_ENDPOINT=https://example.r2.cloudflarestorage.com/zenari",
                    "OBJECT_STORAGE_BUCKET=zenari",
                    "OBJECT_STORAGE_ACCESS_KEY=example-access-key",
                    "OBJECT_STORAGE_SECRET_KEY=example-secret-key",
                    "PRODUCTION_DNS_TARGET=52.237.80.117",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        output = Path(tmp) / "production-dns-cutover-plan.json"
        result = subprocess.run(
            [
                sys.executable,
                str(GENERATOR),
                "--env",
                str(env_path),
                "--output",
                str(output),
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(result.returncode == 2, f"R2-only selftest must remain blocked without DNS token, got {result.returncode}: {result.stderr or result.stdout}")
        plan = load_json(output)
        validate_plan(plan)
        scope = plan.get("credential_scope") if isinstance(plan.get("credential_scope"), dict) else {}
        require(scope.get("r2_s3_credentials_detected") is True, "R2-only selftest must detect R2 S3 credentials")
        require(scope.get("cloudflare_dns_credentials_configured") is False, "R2-only selftest must not report DNS credentials")
        require(scope.get("r2_s3_can_manage_dns") is False, "R2-only selftest must reject R2 as DNS credential")
        require("CLOUDFLARE_API_TOKEN_or_CF_API_TOKEN" in (plan.get("blocked_checks") or []), "R2-only selftest must still require DNS token")


def run_cloudflare_verify_missing_credentials_selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        env_path = Path(tmp) / ".env"
        env_path.write_text("PRODUCTION_DNS_TARGET=52.237.80.117\n", encoding="utf-8")
        output = Path(tmp) / "production-dns-cutover-plan.json"
        result = subprocess.run(
            [
                sys.executable,
                str(GENERATOR),
                "--env",
                str(env_path),
                "--verify-cloudflare",
                "--output",
                str(output),
            ],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        require(result.returncode == 2, f"Cloudflare verify selftest must remain blocked without credentials, got {result.returncode}")
        plan = load_json(output)
        validate_plan(plan)
        preflight = plan.get("cloudflare_scope_preflight", {})
        require(preflight.get("requested") is True, "Cloudflare verify selftest must mark preflight requested")
        require(preflight.get("status") == "blocked", "Cloudflare verify selftest must be blocked without credentials")
        require(preflight.get("reason") == "cloudflare_dns_credentials_missing", "Cloudflare verify missing credential reason mismatch")
        require("CLOUDFLARE_ZONE_DNS_SCOPE_PREFLIGHT_FAILED" in (plan.get("blocked_checks") or []), "Cloudflare verify selftest must add scope blocker")


def run_manual_dns_observation_unit_selftest() -> None:
    import importlib.util

    spec = importlib.util.spec_from_file_location("stage1_production_dns_cutover_plan", GENERATOR)
    require(spec is not None and spec.loader is not None, "could not load DNS cutover generator module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    current_records = {
        "apex_a": {"records": ["52.237.80.117"]},
        "www_cname": {"records": ["zenari.ai."]},
        "www_a": {"records": []},
    }
    target = {"status": "ready", "target_kind": "a", "target": "52.237.80.117"}
    observed = module.current_records_match_target(current_records, target)
    require(observed.get("status") == "observed_applied", "manual DNS unit selftest should observe applied DNS")
    require(observed.get("can_omit_cloudflare_api_credentials") is True, "manual DNS unit selftest should allow omitting API credentials")
    not_observed = module.current_records_match_target({"apex_a": {"records": []}, "www_cname": {"records": []}, "www_a": {"records": []}}, target)
    require(not_observed.get("status") == "not_observed", "manual DNS unit selftest should detect missing records")


def run_target_classification_selftest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        for target, expected_kind in (("52.237.80.117", "a"), ("prod-web.example.net", "cname")):
            env_path = Path(tmp) / f"{expected_kind}.env"
            env_path.write_text(f"PRODUCTION_DNS_TARGET={target}\n", encoding="utf-8")
            output = Path(tmp) / f"production-dns-cutover-plan-{expected_kind}.json"
            result = subprocess.run(
                [
                    sys.executable,
                    str(GENERATOR),
                    "--env",
                    str(env_path),
                    "--output",
                    str(output),
                ],
                cwd=ROOT,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
            )
            require(result.returncode == 2, f"target classification selftest must remain blocked without Cloudflare inputs, got {result.returncode}")
            plan = load_json(output)
            validate_plan(plan)
            require(plan.get("target", {}).get("status") == "ready", f"{target} should be classified as ready target")
            require(plan.get("target", {}).get("target_kind") == expected_kind, f"{target} target_kind mismatch")
            require(plan.get("origin_https_preflight", {}).get("status") == "not_run", "target classification without DNS credentials must not run origin preflight")
            require(plan.get("cloudflare_scope_preflight", {}).get("status") == "not_run", "target classification must not verify Cloudflare by default")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, default=DEFAULT_PLAN)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_code_anchors()
        run_blocked_selftest()
        run_r2_not_dns_selftest()
        run_cloudflare_verify_missing_credentials_selftest()
        run_manual_dns_observation_unit_selftest()
        run_target_classification_selftest()
        if args.contract_only:
            print("stage1 production DNS cutover plan contract passed")
            return 0
        validate_plan(load_json(args.plan))
    except ProductionDnsCutoverPlanValidationError as exc:
        raise SystemExit(f"stage1 production DNS cutover plan validation failed: {exc}") from exc
    print("stage1 production DNS cutover plan validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
