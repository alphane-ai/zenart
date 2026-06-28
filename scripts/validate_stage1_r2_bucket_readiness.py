#!/usr/bin/env python3
"""Validate the non-clearing Stage 1 R2 bucket readiness probe."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "r2_bucket_readiness" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-r2-bucket-readiness.preflight.json"
GENERATOR = ROOT / "scripts" / "stage1_r2_bucket_readiness.py"
VALIDATOR = ROOT / "scripts" / "validate_stage1_r2_bucket_readiness.py"
EXTERNAL_RESOURCE_CONTRACT = ROOT / "fixtures" / "stage1" / "external_resource_readiness" / "local_contract.json"
EXTERNAL_RESOURCE_GENERATOR = ROOT / "scripts" / "generate_stage1_external_resource_readiness.py"
EXTERNAL_RESOURCE_VALIDATOR = ROOT / "scripts" / "validate_stage1_external_resource_readiness.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
ENV_EXAMPLE = ROOT / ".env.example"
OBJECTSTORE_S3 = ROOT / "backend" / "internal" / "objectstore" / "s3.go"
OBJECTSTORE_S3_ERROR = ROOT / "backend" / "internal" / "objectstore" / "s3_error.go"
OBJECTSTORE_PROBE = ROOT / "backend" / "internal" / "objectstore" / "probe.go"
OBJECTSTORE_TEST = ROOT / "backend" / "internal" / "objectstore" / "store_test.go"
BACKEND_CONFIG = ROOT / "backend" / "internal" / "config" / "config.go"
BACKEND_CONFIG_TEST = ROOT / "backend" / "internal" / "config" / "config_test.go"

EXPECTED_CHECKS = [
    "cloudflare_token_verify",
    "cloudflare_create_bucket",
    "s3_head_bucket",
    "s3_put_object",
    "s3_get_object",
    "s3_list_prefix",
    "s3_delete_object",
    "s3_confirm_deleted",
]

REQUIRED_PASS_CHECKS = {
    "s3_head_bucket",
    "s3_put_object",
    "s3_get_object",
    "s3_list_prefix",
    "s3_delete_object",
    "s3_confirm_deleted",
}

SAFE_FALSE_FIELDS = {
    "secret_material_persisted",
    "authorization_header_persisted",
    "raw_response_body_persisted",
    "raw_endpoint_persisted",
    "access_key_persisted",
    "secret_key_persisted",
}

SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "access_key",
    "access_key_id",
    "secret_access_key",
    "api_key",
    "token",
    "api_token",
    "cloudflare_api_token",
    "object_storage_access_key",
    "object_storage_secret_key",
    "raw_response",
    "raw_response_body",
    "endpoint",
    "object_storage_endpoint",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"AWS4-HMAC-SHA256\s+Credential=|"
    r"X-Amz-Signature|"
    r"OBJECT_STORAGE_(?:ACCESS|SECRET)_KEY\s*=|"
    r"CLOUDFLARE_API_TOKEN\s*=)"
)


class R2ReadinessValidationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise R2ReadinessValidationError(message)


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
        raise R2ReadinessValidationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            require(normalized not in SECRET_FIELD_NAMES, f"{path}.{key} exposes secret/raw endpoint field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains secret-looking material")


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")


def parse_env_example(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in read_text(path).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def validate_contract_fixture() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.r2_bucket_readiness.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "r2_bucket_readiness_contract", "contract kind mismatch")
    require(contract.get("expected_bucket") == "zenari", "contract expected bucket mismatch")
    require(contract.get("canonical_preflight_path") == "ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json", "contract preflight path mismatch")
    require(contract.get("required_probe_ids") == EXPECTED_CHECKS, "contract required probe ids mismatch")
    policy = contract.get("preflight_policy")
    require(isinstance(policy, dict), "preflight_policy must be object")
    require(policy.get("generator_command") == "python3 scripts/stage1_r2_bucket_readiness.py", "generator command mismatch")
    require(policy.get("validator_command") == "python3 scripts/validate_stage1_r2_bucket_readiness.py --allow-preflight", "validator command mismatch")
    require(policy.get("accepted_schema_version") == "stage1.r2_bucket_readiness.preflight.v1", "accepted schema mismatch")
    require(policy.get("canonical_pass_path") is False, "R2 readiness preflight must not be canonical pass")
    require(policy.get("can_clear_stage1_staging_runtime_gate") is False, "R2 readiness must not clear staging runtime")
    require(policy.get("can_clear_object_retention_cleanup") is False, "R2 readiness must not clear object retention")
    require(policy.get("can_close_do_not_launch") is False, "R2 readiness must not close DNL")
    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    for ref in contract.get("required_files", []):
        require((ROOT / ref).exists(), f"contract required file missing: {ref}")
    env_example = parse_env_example(ENV_EXAMPLE)
    for key in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "R2_BUCKET_CREATE_JURISDICTION"):
        require(key in env_example, f".env.example missing {key}")
        require(env_example[key] == "", f".env.example {key} must be blank")
    return contract


def validate_code_anchors() -> None:
    require_text(
        ENV_EXAMPLE,
        (
            "OBJECT_STORAGE_BUCKET=",
            "CLOUDFLARE_ACCOUNT_ID=",
            "CLOUDFLARE_API_TOKEN=",
            "R2_BUCKET_CREATE_JURISDICTION=",
        ),
    )
    require_text(
        GENERATOR,
        (
            "stage1.r2_bucket_readiness.preflight.v1",
            "stage1_r2_bucket_readiness_preflight",
            "safe_http_error_detail",
            "body_sha256",
            "request_id",
            "cf_ray",
            "host_id",
            "SIGNED_URL_PARAM_RE",
            "SECRET_ASSIGNMENT_RE",
            "cloudflare_token_verify",
            "cloudflare_create_bucket",
            "s3_head_bucket",
            "s3_put_object",
            "s3_get_object",
            "s3_list_prefix",
            "s3_delete_object",
            "s3_confirm_deleted",
            "can_clear_stage1_staging_runtime_gate",
            "can_clear_object_retention_cleanup",
            "can_close_do_not_launch",
        ),
    )
    require_text(
        VALIDATOR,
        (
            "stage1.r2_bucket_readiness.contract.v1",
            "stage1.r2_bucket_readiness.preflight.v1",
            "validate_preflight",
            "--allow-preflight",
            "strict mode rejects R2 bucket readiness preflight",
        ),
    )
    require_text(
        EXTERNAL_RESOURCE_CONTRACT,
        (
            "r2_bucket_readiness",
            "stage1-r2-bucket-readiness.preflight.json",
            "validate_stage1_r2_bucket_readiness.py --allow-preflight",
        ),
    )
    require_text(
        EXTERNAL_RESOURCE_GENERATOR,
        (
            "stage1-r2-bucket-readiness.preflight.json",
            "load_r2_readiness",
            "r2_readiness_ready",
        ),
    )
    require_text(
        EXTERNAL_RESOURCE_VALIDATOR,
        (
            "validate_stage1_r2_bucket_readiness.py",
            "stage1-r2-bucket-readiness.preflight.json",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/stage1_r2_bucket_readiness.py",
            "test -x scripts/validate_stage1_r2_bucket_readiness.py",
            "python3 scripts/stage1_r2_bucket_readiness.py --contract-only",
            "python3 scripts/validate_stage1_r2_bucket_readiness.py --contract-only",
            "python3 scripts/validate_stage1_r2_bucket_readiness.py --allow-preflight",
        ),
    )
    require_text(
        OBJECTSTORE_S3_ERROR,
        (
            "func s3ErrorSummary",
            "body_sha256=",
            "safeS3ErrorToken",
            "safeS3ErrorMessage",
            "security.RedactString",
            "X-Amz-Request-Id",
            "X-Amz-Id-2",
            "Cf-Ray",
        ),
    )
    require_text(
        OBJECTSTORE_S3,
        (
            "s3 get object failed: %s",
            "s3 put object failed: %s",
            "s3 delete object failed: %s",
            "s3 list objects failed: %s",
            "s3ErrorSummary(resp, body)",
        ),
    )
    require_text(
        OBJECTSTORE_PROBE,
        (
            "S3-compatible object storage credentials rejected: %s",
            "unexpected S3-compatible object storage probe response: %s",
            "s3ErrorSummary(resp, body)",
        ),
    )
    require_text(
        OBJECTSTORE_TEST,
        (
            "TestS3StorePutErrorDoesNotLeakSecretOrBody",
            "TestS3StoreListErrorDoesNotLeakSecretOrBody",
            "TestHTTPProbeErrorDoesNotLeakSecretOrBody",
            "body_sha256=",
            "message=redacted object storage details",
        ),
    )
    require_text(
        BACKEND_CONFIG,
        (
            "endpointContainsBucketPath",
            "OBJECT_STORAGE_ENDPOINT must not include OBJECT_STORAGE_BUCKET as a path segment",
            "OBJECT_STORAGE_PUBLIC_ENDPOINT must not include OBJECT_STORAGE_BUCKET as a path segment",
        ),
    )
    require_text(
        BACKEND_CONFIG_TEST,
        (
            "TestValidateRejectsObjectStorageEndpointWithBucketPath",
            "TestValidateAcceptsR2AccountEndpointAndSeparateBucket",
            "r2.cloudflarestorage.com/zenari",
        ),
    )


def validate_preflight(data: dict[str, Any]) -> None:
    assert_no_secret(data, "r2_readiness")
    require(data.get("schema_version") == "stage1.r2_bucket_readiness.preflight.v1", "preflight schema_version mismatch")
    require(data.get("kind") == "stage1_r2_bucket_readiness_preflight", "preflight kind mismatch")
    require(data.get("environment") == "release", "preflight environment mismatch")
    require(data.get("status") in {"ready", "blocked", "missing"}, "preflight status mismatch")
    require(data.get("release_gate_decision") == "no_go", "preflight release gate decision must remain no_go")
    require(data.get("expected_bucket") == "zenari", "preflight expected bucket mismatch")
    require(data.get("canonical_pass_path") is False, "preflight canonical_pass_path must be false")
    require(data.get("can_clear_stage1_staging_runtime_gate") is False, "preflight must not clear staging runtime")
    require(data.get("can_clear_object_retention_cleanup") is False, "preflight must not clear object retention")
    require(data.get("can_close_do_not_launch") is False, "preflight must not close DNL")
    safe_policy = data.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"safe_projection_policy.{field} must be false")
        require(data.get(field) is False, f"preflight.{field} must be false")
    config = data.get("config_summary")
    require(isinstance(config, dict), "config_summary must be object")
    for key in (
        "provider_s3_compatible",
        "endpoint_present",
        "endpoint_https",
        "endpoint_public",
        "endpoint_host_suffix",
        "bucket_zenari",
        "region_present",
        "access_key_present",
        "secret_key_present",
        "force_path_style",
        "cloudflare_api_token_present",
        "cloudflare_account_id_present_or_derivable",
    ):
        require(key in config, f"config_summary.{key} missing")
    require(not str(config.get("endpoint_host_suffix", "")).startswith("http"), "endpoint_host_suffix must not include endpoint URL")
    probes = data.get("probes")
    require(isinstance(probes, list) and probes, "probes must be non-empty list")
    seen: list[str] = []
    for idx, probe in enumerate(probes):
        require(isinstance(probe, dict), f"probes[{idx}] must be object")
        check_id = probe.get("check_id")
        require(isinstance(check_id, str) and check_id, f"probes[{idx}].check_id must be string")
        seen.append(check_id)
        require(probe.get("status") in {"pass", "blocked", "missing", "skipped"}, f"probes[{idx}] status mismatch")
        require(isinstance(probe.get("reason"), str) and probe.get("reason").strip(), f"probes[{idx}].reason missing")
        for field in ("secret_material_persisted", "authorization_header_persisted", "raw_response_body_persisted"):
            require(probe.get(field) is False, f"probes[{idx}].{field} must be false")
        if "http_status" in probe:
            require(isinstance(probe["http_status"], int), f"probes[{idx}].http_status must be int")
        detail = probe.get("detail")
        if probe.get("status") == "blocked" and "http_status" in probe:
            require(isinstance(detail, dict), f"probes[{idx}].detail must be object for HTTP blocked probes")
            require(isinstance(detail.get("body_sha256"), str) and re.fullmatch(r"[0-9a-f]{16}", detail["body_sha256"]), f"probes[{idx}].detail.body_sha256 missing")
    for check_id in EXPECTED_CHECKS:
        require(check_id in seen, f"missing probe {check_id}")
    readiness = data.get("readiness")
    require(isinstance(readiness, dict), "readiness must be object")
    ready = readiness.get("r2_bucket_access_ready")
    require(isinstance(ready, bool), "readiness.r2_bucket_access_ready must be bool")
    by_id = {str(item.get("check_id")): item for item in probes if isinstance(item, dict)}
    required_pass = all(by_id.get(check_id, {}).get("status") == "pass" for check_id in REQUIRED_PASS_CHECKS)
    require(ready is required_pass, "r2_bucket_access_ready must match required S3 pass probes")
    if data.get("status") == "ready":
        require(required_pass, "ready status requires all required S3 probes to pass")
        require(not data.get("blockers"), "ready preflight must not have blockers")
    else:
        require(isinstance(data.get("blockers"), list) and data.get("blockers"), "non-ready preflight must include blockers")
    strict_followup = set(data.get("strict_followup_required") or [])
    require("python3 scripts/validate_stage1_staging_object_retention_evidence.py" in strict_followup, "strict followup must include object retention validator")
    require("python3 scripts/validate_stage1_staging_runtime.py" in strict_followup, "strict followup must include staging runtime validator")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Stage 1 R2 bucket readiness")
    parser.add_argument("--contract-only", action="store_true")
    parser.add_argument("--allow-preflight", action="store_true")
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract_fixture()
        validate_code_anchors()
        if args.contract_only:
            print("stage1 R2 bucket readiness contract validation passed")
            return 0
        data = load_json(args.evidence)
        if not args.allow_preflight:
            raise R2ReadinessValidationError(
                "strict mode rejects R2 bucket readiness preflight; use --allow-preflight for non-clearing diagnostics"
            )
        validate_preflight(data)
    except R2ReadinessValidationError as exc:
        print(f"stage1 R2 bucket readiness validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 R2 bucket readiness validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
