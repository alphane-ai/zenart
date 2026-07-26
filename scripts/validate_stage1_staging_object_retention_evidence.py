#!/usr/bin/env python3
"""Validate exact Stage 1 staging object retention/cleanup evidence."""

from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "staging_object_retention" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "object-storage-retention-cleanup.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "object-storage-retention-cleanup.ndjson"
DEFAULT_BLOCKED_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "object-storage-retention-cleanup.blocked.json"
DEFAULT_BLOCKED_RESULTS = ROOT / "ops" / "evidence" / "staging" / "object-storage-retention-cleanup.blocked.ndjson"
DEFAULT_PREFLIGHT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "object-storage-retention-cleanup.preflight.json"
DEFAULT_PREFLIGHT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "object-storage-retention-cleanup.preflight.ndjson"
DEFAULT_LOCAL_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "object-storage-retention-cleanup.local-devport.json"
DEFAULT_LOCAL_RESULTS = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "object-storage-retention-cleanup.local-devport.ndjson"
SIGNED_URL_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "20260527T2130Z-object-storage-signed-url.json"
SMOKE_SCRIPT = ROOT / "scripts" / "staging_object_storage_retention_cleanup_smoke.sh"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
OBJECTSTORE_S3 = ROOT / "backend" / "internal" / "objectstore" / "s3.go"
OBJECTSTORE_S3_ERROR = ROOT / "backend" / "internal" / "objectstore" / "s3_error.go"
OBJECTSTORE_PROBE = ROOT / "backend" / "internal" / "objectstore" / "probe.go"
OBJECTSTORE_TEST = ROOT / "backend" / "internal" / "objectstore" / "store_test.go"
STAGING_RUNTIME_CONTRACT = ROOT / "fixtures" / "stage1" / "staging_runtime" / "local_contract.json"
STAGING_RUNTIME_VALIDATOR = ROOT / "scripts" / "validate_stage1_staging_runtime.py"
STAGING_RUNTIME_GENERATOR = ROOT / "scripts" / "generate_stage1_staging_runtime_evidence.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
SIGNED_URL_PASS_STATUSES = PASS_STATUSES | {"pass_with_blockers_preserved"}
REQUIRED_CHECKS = {"retention_policy", "expired_export_cleanup", "orphan_cleanup", "audit_refs"}
SAFE_FALSE_FIELDS = {
    "secret_material_persisted",
    "raw_prompt_persisted",
    "raw_provider_payload_persisted",
    "raw_stripe_payload_persisted",
    "raw_support_body_projected",
    "signed_url_persisted",
    "authorization_header_persisted",
    "cookie_persisted",
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
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_event",
    "raw_response",
    "raw_payload",
    "raw_support_body",
    "download_url",
    "signed_url",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)
BLOCKED_MARKERS = {
    "blocked",
    "failed",
    "fail",
    "planned",
    "dry_run",
    "dry_run_no_staging_runtime_probe",
    "missing_staging_base_url_or_explicit_probe_urls",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
    "canonical_pass_paths_required_for_gate_closure",
}
LOCAL_DEBUG_TRUE_FIELDS = {"local_devport_debug", "allow_local_devport_evidence", "use_dev_identity_headers"}
CANONICAL_PATH_FALSE_FIELDS = {"canonical_pass_path", "canonical_pass_paths"}
GATE_EMPTY_FIELDS = {"blocked_checks", "blockers", "do_not_launch_conditions", "remaining_blockers"}
GATE_CLEAR_FIELDS = {"preserved_do_not_launch_condition_id", "preserved_release_gate_check_id"}
RESERVED_STAGING_HOST_SUFFIXES = (
    ".example",
    ".example.test",
    ".invalid",
    ".localhost",
    ".local",
    ".test",
)


class Stage1StagingObjectRetentionError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1StagingObjectRetentionError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    if path == DEFAULT_EVIDENCE and not path.exists() and DEFAULT_BLOCKED_EVIDENCE.exists():
        raise Stage1StagingObjectRetentionError(
            "missing canonical pass evidence ops/evidence/staging/object-storage-retention-cleanup.json; "
            "blocked diagnostic evidence exists at ops/evidence/staging/object-storage-retention-cleanup.blocked.json"
        )
    if path == DEFAULT_RESULTS and not path.exists() and DEFAULT_BLOCKED_RESULTS.exists():
        raise Stage1StagingObjectRetentionError(
            "missing canonical pass results ops/evidence/staging/object-storage-retention-cleanup.ndjson; "
            "blocked diagnostic results exist at ops/evidence/staging/object-storage-retention-cleanup.blocked.ndjson"
        )
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise Stage1StagingObjectRetentionError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def load_ndjson(path: Path) -> list[dict[str, Any]]:
    require(path.exists(), f"missing {display_path(path)}")
    rows: list[dict[str, Any]] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise Stage1StagingObjectRetentionError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
        require(isinstance(value, dict), f"{display_path(path)}:{lineno} must contain a JSON object")
        rows.append(value)
    require(rows, f"{display_path(path)} must contain at least one row")
    return rows


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


def walk_values(value: Any) -> list[Any]:
    values = [value]
    if isinstance(value, dict):
        for child in value.values():
            values.extend(walk_values(child))
    elif isinstance(value, list):
        for child in value:
            values.extend(walk_values(child))
    return values


def normalized_string_values(value: Any) -> set[str]:
    return {child.strip().lower() for child in walk_values(value) if isinstance(child, str)}


def is_reserved_or_local_host(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    if not normalized:
        return True
    if normalized in {"localhost", "0.0.0.0"}:
        return True
    if any(normalized == suffix[1:] or normalized.endswith(suffix) for suffix in RESERVED_STAGING_HOST_SUFFIXES):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def validate_strict_staging_url(value: Any, field: str) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required for canonical strict staging evidence")
    parsed = urlparse(value)
    require(parsed.scheme == "https" and parsed.netloc, f"{field} must be an absolute https URL")
    require(
        not is_reserved_or_local_host(parsed.hostname or ""),
        f"{field} must target a real staging host, not localhost/private/reserved test host",
    )


def canonical_strict_paths(evidence_path: Path, results_path: Path) -> bool:
    return evidence_path.resolve() == DEFAULT_EVIDENCE.resolve() and results_path.resolve() == DEFAULT_RESULTS.resolve()


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def truthy_gate_value(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def falsey_gate_value(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {"false", "0", "no"})


def blocked_gate_signal_blockers(value: Any, path: str) -> list[str]:
    blockers: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            child_path = f"{path}.{key}"
            if normalized in LOCAL_DEBUG_TRUE_FIELDS and truthy_gate_value(child):
                blockers.append(f"{child_path} is true")
            if normalized in CANONICAL_PATH_FALSE_FIELDS and falsey_gate_value(child):
                blockers.append(f"{child_path} is false")
            if normalized.startswith("can_clear_") and falsey_gate_value(child):
                blockers.append(f"{child_path} is false")
            if normalized in GATE_EMPTY_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not empty")
            if normalized in GATE_CLEAR_FIELDS and child not in (None, "", []):
                blockers.append(f"{child_path} is not cleared")
            blockers.extend(blocked_gate_signal_blockers(child, child_path))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            blockers.extend(blocked_gate_signal_blockers(child, f"{path}[{idx}]"))
    return blockers


def require_no_blocked_gate_signals(value: Any, path: str) -> None:
    blockers = blocked_gate_signal_blockers(value, path)
    require(not blockers, f"{path} contains blocked/debug-only gate signal(s): {blockers}")


def require_ref_list(value: Any, path: str) -> None:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")


def empty_gate_value(value: Any) -> bool:
    if value in (None, ""):
        return True
    if isinstance(value, list):
        return all(empty_gate_value(item) for item in value)
    if isinstance(value, dict):
        return all(empty_gate_value(item) for item in value.values())
    return False


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.staging_object_retention.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "staging_object_retention_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/staging/object-storage-retention-cleanup.json", "contract evidence path mismatch")
    require(contract.get("canonical_results_path") == "ops/evidence/staging/object-storage-retention-cleanup.ndjson", "contract results path mismatch")
    require(contract.get("preflight_evidence_path") == "ops/evidence/staging/object-storage-retention-cleanup.preflight.json", "contract preflight evidence path mismatch")
    require(contract.get("preflight_results_path") == "ops/evidence/staging/object-storage-retention-cleanup.preflight.ndjson", "contract preflight results path mismatch")
    require(contract.get("preflight_can_clear_staging_gate") is False, "object-retention preflight must not clear staging gate")
    require(
        contract.get("local_devport_evidence_path")
        == "ops/evidence/staging/local-devport/object-storage-retention-cleanup.local-devport.json",
        "contract local-devport evidence path mismatch",
    )
    require(
        contract.get("local_devport_results_path")
        == "ops/evidence/staging/local-devport/object-storage-retention-cleanup.local-devport.ndjson",
        "contract local-devport results path mismatch",
    )
    require(contract.get("local_devport_can_clear_staging_gate") is False, "local-devport evidence must not clear staging gate")
    require(contract.get("strict_schema_version") == "stage0.rev2.staging.object_storage_retention_cleanup", "contract strict schema mismatch")
    require(contract.get("required_environment") == "staging", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "staging_object_storage_signed_downloads", "contract gate check mismatch")
    require(contract.get("required_do_not_launch_condition_id") == "object_storage_signed_retention_runtime_missing", "contract DNL mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")
    require(REQUIRED_CHECKS <= set(contract.get("required_checks") or []), "contract missing required object retention checks")
    require("ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json" in set(contract.get("required_split_evidence") or []), "contract missing signed URL split evidence")
    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    for key in (
        "canonical_pass_path_required",
        "release_sha_full_40_hex",
        "release_sha_must_match_signed_url_split",
        "admin_auth_required",
        "admin_identity_required",
        "csrf_required",
        "request_id_echo_required",
        "cleanup_audit_refs_required",
        "audit_endpoint_cleanup_ref_linkage_required",
        "gate_impact_can_clear_required",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "allow_blocked_status",
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run",
        "allow_preserved_do_not_launch_conditions",
        "allow_raw_or_secret_payloads",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")
    local_fixture = contract.get("production_like_local_fixture_policy")
    require(isinstance(local_fixture, dict), "production_like_local_fixture_policy must be object")
    require(
        local_fixture.get("resolve_addr_env") == "BASE_URL_RESOLVE_ADDR or STAGING_API_URL_RESOLVE_ADDR or STAGING_BASE_URL_RESOLVE_ADDR",
        "production-like fixture resolve env mismatch",
    )
    require(
        local_fixture.get("ca_cert_env") == "BASE_URL_CA_CERT or STAGING_API_URL_CA_CERT or STAGING_BASE_URL_CA_CERT",
        "production-like fixture CA env mismatch",
    )
    require(local_fixture.get("required_scheme") == "https", "production-like fixture must require https")
    require(
        local_fixture.get("can_clear_gate_from_noncanonical_paths") is False,
        "production-like fixture must not clear gates from noncanonical paths",
    )
    preflight = contract.get("preflight_policy")
    require(isinstance(preflight, dict), "preflight_policy must be object")
    require(preflight.get("mode_env") == "OBJECT_RETENTION_MODE=preflight_stage1", "preflight mode env mismatch")
    require(preflight.get("does_not_run_cleanup") is True, "preflight must not run cleanup")
    require(preflight.get("status_ready_does_not_clear_gate") is True, "preflight ready must not clear gate")
    require(preflight.get("can_clear_stage1_staging_runtime_gate") is False, "preflight cannot clear staging runtime")
    require(preflight.get("validates_input_readiness_only") is True, "preflight must be input-readiness only")
    require(preflight.get("requires_canonical_run_after_preflight") is True, "preflight must require canonical follow-up")
    strict_target = contract.get("strict_staging_target_policy")
    require(isinstance(strict_target, dict), "strict_staging_target_policy must be object")
    require(strict_target.get("canonical_pass_must_target_real_staging_host") is True, "strict staging target policy must require real staging host")
    require(strict_target.get("reject_reserved_test_domains") is True, "strict staging target policy must reject reserved test domains")
    require(strict_target.get("reject_localhost_private_link_local_ips") is True, "strict staging target policy must reject local/private IPs")
    require(strict_target.get("reject_local_resolve_addr_for_canonical_pass") is True, "strict staging target policy must reject local resolve semantics")
    require("example.test" in set(strict_target.get("reserved_domain_examples") or []), "strict staging target policy must name example.test")
    generator_safety = contract.get("generator_safety_policy")
    require(isinstance(generator_safety, dict), "generator_safety_policy must be object")
    for key in (
        "canonical_paths_are_never_written_before_candidate_validation",
        "strict_validator_required_before_canonical_replace",
        "pass_evidence_written_only_after_strict_validator_accepts",
        "canonical_outputs_are_atomic",
        "failed_strict_candidate_writes_blocked_evidence_only",
    ):
        require(generator_safety.get(key) is True, f"generator_safety_policy.{key} must be true")


def validate_code_anchors() -> None:
    require_text(
        SMOKE_SCRIPT,
        (
            "object-storage-retention-cleanup.json",
            "object-storage-retention-cleanup.ndjson",
            "object-storage-retention-cleanup.preflight.json",
            "OBJECT_RETENTION_MODE=preflight_stage1",
            "STAGING_API_URL",
            "STAGING_API_URL_RESOLVE_ADDR",
            "STAGING_API_URL_CA_CERT",
            "BASE_URL_RESOLVE_ADDR",
            "BASE_URL_CA_CERT",
            "--resolve",
            "--cacert",
            "production_like_local_fixture_command",
            "zenari-staging.example.test",
            "BASE_URL_RESOLVE_ADDR=127.0.0.1",
            "object_storage_retention_cleanup",
            "canonical_pass_paths_required_for_gate_closure",
            "pass_evidence_written_only_after_strict_validator_accepts",
            "canonical_outputs_are_atomic",
            "failed_strict_candidate_writes_blocked_evidence_only",
            "os.replace(tmp_results_name, canonical_results_path)",
            "os.replace(tmp_report_name, canonical_report_path)",
            "scripts/validate_stage1_staging_object_retention_evidence.py",
            "release_sha_matches_signed_url",
            "cleanup_audit_refs_by_probe",
            "request_id_verified",
            "Idempotency-Key: $request_id",
            "ALLOW_LOCAL_DEVPORT_EVIDENCE=1 writes debug-only evidence",
        ),
    )
    require_text(
        OPENAPI,
        (
            "operationId: getObjectStorageRetentionPolicy",
            "operationId: cleanupObjectStorageExpiredExports",
            "operationId: cleanupObjectStorageOrphans",
            "ObjectStorageRetentionPolicy:",
            "ObjectStorageCleanupRequest:",
            "ObjectStorageCleanupResult:",
            'x-idempotency-required: true',
        ),
    )
    require_text(
        ADMIN_GENERATED,
        (
            "getObjectStorageRetentionPolicy:",
            "cleanupObjectStorageExpiredExports:",
            "cleanupObjectStorageOrphans:",
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
        ),
    )
    require_text(
        OBJECTSTORE_S3,
        (
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
        STAGING_RUNTIME_CONTRACT,
        (
            "scripts/validate_stage1_staging_object_retention_evidence.py",
            "object_storage_retention_cleanup",
        ),
    )
    require_text(
        STAGING_RUNTIME_VALIDATOR,
        (
            "validate_stage1_staging_object_retention_evidence.py",
            "object_storage_retention_cleanup",
        ),
    )
    require_text(
        STAGING_RUNTIME_GENERATOR,
        (
            "required_validator",
            "strict child validator failed",
        ),
    )
    require_text(REPO_VALIDATE, ("validate_stage1_staging_object_retention_evidence.py --contract-only",))
    require_text(GAP_INVENTORY, ("VF-6d", "object retention"))


def validate_results(rows: list[dict[str, Any]]) -> None:
    assert_no_secret(rows, "results")
    seen: set[str] = set()
    for idx, row in enumerate(rows, 1):
        require_no_blocked_gate_signals(row, f"results[{idx}]")
        check_id = row.get("check_id")
        require(isinstance(check_id, str) and check_id in REQUIRED_CHECKS, f"results[{idx}].check_id unexpected")
        seen.add(check_id)
        require(row.get("status") == "passed", f"results[{idx}].status must be passed")
        require(row.get("request_id_echoed") is True, f"results[{idx}].request_id_echoed must be true")
        require(isinstance(row.get("request_id"), str) and row["request_id"], f"results[{idx}].request_id required")
        require(isinstance(row.get("matched_tokens"), list) and row["matched_tokens"], f"results[{idx}].matched_tokens required")
        require(row.get("missing_tokens") in ([], None), f"results[{idx}].missing_tokens must be empty")
        require(isinstance(row.get("response_bytes"), int) and row["response_bytes"] > 0, f"results[{idx}].response_bytes must be positive")
    require(REQUIRED_CHECKS <= seen, f"results missing checks {sorted(REQUIRED_CHECKS - seen)}")


def validate_preflight(evidence_path: Path, results_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "preflight")
    assert_no_secret(rows, "preflight_results")

    require(data.get("schema_version") == "stage0.rev2.staging.object_storage_retention_cleanup", "preflight schema_version mismatch")
    require(data.get("environment") == "staging", "preflight environment must be staging")
    require(data.get("kind") == "object_storage_retention_cleanup", "preflight kind mismatch")
    require(data.get("status") == "blocked", "preflight must stay blocked")
    require(data.get("release_gate_check_id") == "staging_object_storage_signed_downloads", "preflight release gate mismatch")
    require(data.get("do_not_launch_condition_id") == "object_storage_signed_retention_runtime_missing", "preflight DNL mismatch")
    result_path_value = data.get("results_path")
    require(isinstance(result_path_value, str) and result_path_value.endswith("object-storage-retention-cleanup.preflight.ndjson"), "preflight results_path mismatch")
    require(data.get("local_devport_debug") is False, "preflight must not be local-devport debug evidence")
    require(data.get("use_dev_identity_headers") is False, "preflight must not use dev identity headers")

    seen: set[str] = set()
    for idx, row in enumerate(rows, 1):
        check_id = row.get("check_id")
        require(isinstance(check_id, str) and check_id in REQUIRED_CHECKS, f"preflight_results[{idx}].check_id unexpected")
        seen.add(check_id)
        require(row.get("status") == "planned", f"preflight_results[{idx}].status must be planned")
        require(row.get("reason") == "preflight_stage1_no_runtime_probe", f"preflight_results[{idx}].reason mismatch")
        require(row.get("request_id_echoed") is False, f"preflight_results[{idx}] must not claim request-id echo")
        require(row.get("response_bytes") == 0, f"preflight_results[{idx}] must not contain runtime response bytes")
    require(REQUIRED_CHECKS <= seen, f"preflight results missing checks {sorted(REQUIRED_CHECKS - seen)}")

    readiness = data.get("input_readiness")
    require(isinstance(readiness, dict), "preflight input_readiness must be object")
    require(readiness.get("preflight_stage1") is True, "preflight input_readiness.preflight_stage1 must be true")
    require(readiness.get("canonical_pass_path") is False, "preflight must not claim canonical pass path")
    require(readiness.get("canonical_write_requested") is False, "preflight must not request canonical write")
    require(readiness.get("allow_local_devport_evidence") is False, "preflight must not allow local-devport evidence")
    require(readiness.get("use_dev_identity_headers") is False, "preflight must not use dev identity headers")
    for key in (
        "probe_urls_ready",
        "production_like_staging_targets",
        "auth_ready",
        "admin_user_id_ready",
        "admin_tenant_id_ready",
        "csrf_ready",
        "release_sha_provided",
        "signed_url_evidence_ready",
        "release_sha_matches_signed_url",
    ):
        require(isinstance(readiness.get(key), bool), f"preflight input_readiness.{key} must be boolean")

    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "preflight probe_contract must be object")
    require(probe_contract.get("preflight_report") == "ops/evidence/staging/object-storage-retention-cleanup.preflight.json", "preflight report path mismatch")
    require(probe_contract.get("preflight_results") == "ops/evidence/staging/object-storage-retention-cleanup.preflight.ndjson", "preflight results path mismatch")
    require(probe_contract.get("preflight_does_not_run_cleanup") is True, "preflight must declare no cleanup runtime probe")
    require(probe_contract.get("preflight_can_clear_stage1_staging_runtime_gate") is False, "preflight cannot clear Stage 1 staging runtime")
    require("OBJECT_RETENTION_MODE=preflight_stage1" in str(probe_contract.get("preflight_command", "")), "preflight command mismatch")

    runtime_requirements = data.get("runtime_input_requirements")
    require(isinstance(runtime_requirements, dict), "preflight runtime_input_requirements must be object")
    require(runtime_requirements.get("canonical_pass_report") == "ops/evidence/staging/object-storage-retention-cleanup.json", "canonical report mismatch")
    require(runtime_requirements.get("canonical_pass_results") == "ops/evidence/staging/object-storage-retention-cleanup.ndjson", "canonical results mismatch")
    require("preflight_stage1" in str(runtime_requirements.get("blocked_input_reason", "")), "preflight blocked input reason must name preflight")

    split = data.get("split_evidence")
    require(isinstance(split, dict), "preflight split_evidence must be object")
    require(split.get("retention_cleanup_ready") is False, "preflight cannot mark retention cleanup ready")
    require(split.get("canonical_pass_paths") is False, "preflight cannot claim canonical pass paths")

    coverage = data.get("coverage")
    require(isinstance(coverage, list), "preflight coverage must be list")
    by_area = {item.get("area"): item for item in coverage if isinstance(item, dict)}
    require(REQUIRED_CHECKS <= set(by_area), f"preflight coverage missing areas {sorted(REQUIRED_CHECKS - set(by_area))}")
    for area in REQUIRED_CHECKS:
        item = by_area[area]
        require(item.get("status") == "blocked", f"preflight coverage.{area}.status must be blocked")
        source_results = item.get("source_results")
        require(isinstance(source_results, list) and len(source_results) == 1, f"preflight coverage.{area}.source_results must contain one row")
        require(source_results[0].get("reason") == "preflight_stage1_no_runtime_probe", f"preflight coverage.{area} must cite preflight reason")

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "preflight gate_impact must be object")
    require(gate.get("can_clear_retention_cleanup_checklist_item") is False, "preflight cannot clear retention cleanup item")
    require(gate.get("can_clear_release_gate_check") is False, "preflight cannot clear release gate")
    require(gate.get("preserved_release_gate_check_id") == "staging_object_storage_signed_downloads", "preflight must preserve release gate")
    require(gate.get("preserved_do_not_launch_condition_id") == "object_storage_signed_retention_runtime_missing", "preflight must preserve DNL")
    strings = normalized_string_values(data) & BLOCKED_MARKERS
    require("blocked" in strings, "preflight must keep blocked marker")


def require_no_blocked_gate_signals_for_local_devport(value: Any, path: str) -> None:
    blockers = blocked_gate_signal_blockers(value, path)
    allowed_fragments = {
        "local_devport_debug",
        "allow_local_devport_evidence",
        "use_dev_identity_headers",
        "canonical_pass_path",
        "canonical_pass_paths",
        "can_clear_retention_cleanup_checklist_item",
        "can_clear_release_gate_check",
        "preserved_do_not_launch_condition_id",
        "preserved_release_gate_check_id",
        "remaining_release_gate_blockers_after_pass",
        "blocked_checks",
    }
    unexpected = [
        blocker
        for blocker in blockers
        if not any(fragment in blocker for fragment in allowed_fragments)
    ]
    require(not unexpected, f"{path} contains unexpected local-devport gate signal(s): {unexpected}")


def validate_evidence(evidence_path: Path, results_path: Path, *, allow_local_devport: bool = False) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "evidence")
    validate_results(rows)
    if allow_local_devport:
        require_no_blocked_gate_signals_for_local_devport(data, "evidence")
    else:
        require_no_blocked_gate_signals(data, "evidence")

    require(data.get("schema_version") == "stage0.rev2.staging.object_storage_retention_cleanup", "schema_version mismatch")
    require(data.get("environment") == "staging", "environment must be staging")
    require(data.get("kind") == "object_storage_retention_cleanup", "kind mismatch")
    if allow_local_devport:
        require(data.get("status") == "blocked", "local-devport evidence status must stay blocked")
    else:
        require(data.get("status") == "pass", "status must be pass")
    require(data.get("release_gate_check_id") == "staging_object_storage_signed_downloads", "release gate mismatch")
    release_sha = data.get("release_sha")
    require(isinstance(release_sha, str) and RELEASE_SHA_RE.match(release_sha), "release_sha must be full 40-char hex")
    if allow_local_devport:
        require(data.get("results_path") == "ops/evidence/staging/local-devport/object-storage-retention-cleanup.local-devport.ndjson", "local-devport results_path mismatch")
        require(data.get("local_devport_debug") is True, "local-devport evidence must mark local_devport_debug")
        require(data.get("use_dev_identity_headers") is True, "local-devport evidence should use dev identity headers")
    else:
        require(data.get("results_path") == "ops/evidence/staging/object-storage-retention-cleanup.ndjson", "results_path must be canonical")
        require(data.get("local_devport_debug") is not True, "local_devport_debug must be false")
        require(data.get("use_dev_identity_headers") is not True, "use_dev_identity_headers must be false")
        validate_strict_staging_url(data.get("base_url"), "evidence.base_url")
        csrf = data.get("csrf")
        require(isinstance(csrf, dict), "csrf must be object")
        validate_strict_staging_url(csrf.get("origin"), "evidence.csrf.origin")
        for idx, row in enumerate(rows, 1):
            validate_strict_staging_url(row.get("url"), f"results[{idx}].url")

    split = data.get("split_evidence")
    require(isinstance(split, dict), "split_evidence must be object")
    require(split.get("signed_url_evidence") == "ops/evidence/staging/20260527T2130Z-object-storage-signed-url.json", "signed URL split ref mismatch")
    require(split.get("signed_url_ready") is True, "signed_url_ready must be true")
    require(split.get("signed_url_release_sha") == release_sha, "signed URL release SHA must match")
    require(split.get("release_sha_matches_signed_url") is True, "release_sha_matches_signed_url must be true")
    require(split.get("retention_cleanup_runtime_ready") is True, "retention_cleanup_runtime_ready must be true")
    require(split.get("retention_cleanup_runtime_ready") is True, "retention_cleanup_runtime_ready must be true")
    require(split.get("retention_cleanup_ready") is (not allow_local_devport), "retention_cleanup_ready gate mismatch")
    require(split.get("canonical_pass_paths") is (not allow_local_devport), "canonical_pass_paths gate mismatch")

    signed_url = load_json(SIGNED_URL_EVIDENCE)
    assert_no_secret(signed_url, "signed_url_evidence")
    require(signed_url.get("environment") == "staging", "signed URL split must be staging")
    require(signed_url.get("kind") == "object_storage_signed_url", "signed URL split kind mismatch")
    require(signed_url.get("status") in SIGNED_URL_PASS_STATUSES, "signed URL split must pass or preserve only retention blockers")
    require(signed_url.get("release_sha") == release_sha, "signed URL split release SHA mismatch")

    readiness = data.get("input_readiness")
    require(isinstance(readiness, dict), "input_readiness must be object")
    for key in (
        "probe_urls_ready",
        "auth_ready",
        "admin_user_id_ready",
        "admin_tenant_id_ready",
        "csrf_ready",
        "release_sha_provided",
        "signed_url_evidence_ready",
        "release_sha_matches_signed_url",
    ):
        require(readiness.get(key) is True, f"input_readiness.{key} must be true")
    require(readiness.get("canonical_pass_path") is (not allow_local_devport), "input_readiness.canonical_pass_path gate mismatch")
    require(readiness.get("allow_local_devport_evidence") is allow_local_devport, "allow_local_devport_evidence gate mismatch")
    require(readiness.get("use_dev_identity_headers") is allow_local_devport, "use_dev_identity_headers gate mismatch")

    audit = data.get("audit_linkage")
    require(isinstance(audit, dict), "audit_linkage must be object")
    for key in ("verified", "semantic_verified", "request_id_verified"):
        require(audit.get(key) is True, f"audit_linkage.{key} must be true")
    by_probe = audit.get("cleanup_audit_refs_by_probe")
    req_by_probe = audit.get("audit_endpoint_request_id_cleanup_refs_by_probe")
    require(isinstance(by_probe, dict), "cleanup_audit_refs_by_probe must be object")
    require(isinstance(req_by_probe, dict), "audit endpoint request-id refs must be object")
    for check_id in ("expired_export_cleanup", "orphan_cleanup"):
        require(isinstance(by_probe.get(check_id), list) and by_probe[check_id], f"audit refs missing for {check_id}")
        require(isinstance(req_by_probe.get(check_id), list) and req_by_probe[check_id], f"request-id audit refs missing for {check_id}")
    for key in (
        "audit_endpoint_missing_cleanup_refs",
        "audit_endpoint_semantic_missing_cleanup_refs",
        "audit_endpoint_request_id_missing_cleanup_refs",
        "missing_cleanup_audit_refs",
    ):
        require(empty_gate_value(audit.get(key)), f"audit_linkage.{key} must be empty")

    coverage = data.get("coverage")
    require(isinstance(coverage, list), "coverage must be list")
    by_area = {item.get("area"): item for item in coverage if isinstance(item, dict)}
    require(REQUIRED_CHECKS <= set(by_area), f"coverage missing areas {sorted(REQUIRED_CHECKS - set(by_area))}")
    for area in REQUIRED_CHECKS:
        item = by_area[area]
        require(item.get("status") == "pass", f"coverage.{area}.status must pass")
        require(item.get("evidence_path_policy") == "ops/evidence/staging/", f"coverage.{area} path policy mismatch")
        require(item.get("release_sha_bound") is True, f"coverage.{area}.release_sha_bound must be true")
        require(item.get("admin_identity_bound") is True, f"coverage.{area}.admin_identity_bound must be true")
        require_ref_list(item.get("evidence_refs"), f"coverage.{area}.evidence_refs")
        require(isinstance(item.get("request_ids"), list) and item["request_ids"], f"coverage.{area}.request_ids required")
        related = item.get("source_results")
        require(isinstance(related, list) and related, f"coverage.{area}.source_results required")
        for source in related:
            require(isinstance(source, dict) and source.get("status") == "passed", f"coverage.{area}.source_results must pass")

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_retention_cleanup_checklist_item") is (not allow_local_devport), "retention cleanup gate item mismatch")
    require(gate.get("can_clear_release_gate_check") is (not allow_local_devport), "release gate check mismatch")
    if allow_local_devport:
        require(gate.get("preserved_release_gate_check_id") == "staging_object_storage_signed_downloads", "local-devport preserved release gate mismatch")
        require(gate.get("preserved_do_not_launch_condition_id") == "object_storage_signed_retention_runtime_missing", "local-devport preserved DNL mismatch")
        require(gate.get("remaining_release_gate_blockers_after_pass") == ["staging_object_storage_signed_downloads"], "local-devport remaining blockers mismatch")
    else:
        require(gate.get("preserved_release_gate_check_id") in (None, ""), "preserved release gate check must clear")
        require(gate.get("preserved_do_not_launch_condition_id") in (None, ""), "preserved DNL must clear")
        require(gate.get("remaining_release_gate_blockers_after_pass") in ([], None), "remaining blockers must be empty")
    require(sorted(data.get("required_checks") or []) == sorted(REQUIRED_CHECKS), "required_checks mismatch")
    strings = normalized_string_values(data) & BLOCKED_MARKERS
    if allow_local_devport:
        require(strings == {"blocked", "local_devport_debug_evidence_cannot_clear_staging_gate"}, f"local-devport blocked markers mismatch: {sorted(strings)}")
    else:
        require(not strings, f"evidence contains blocked marker(s): {sorted(strings)}")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing object-retention preflight evidence")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="object retention evidence JSON")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="object retention NDJSON results")
    parser.add_argument("--allow-local-devport", action="store_true", help="validate local-devport debug evidence without allowing it to clear staging")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            evidence_path = DEFAULT_PREFLIGHT_EVIDENCE if args.evidence == str(DEFAULT_EVIDENCE) else Path(args.evidence)
            results_path = DEFAULT_PREFLIGHT_RESULTS if args.results == str(DEFAULT_RESULTS) else Path(args.results)
            validate_preflight(evidence_path, results_path)
        else:
            evidence_path = DEFAULT_LOCAL_EVIDENCE if args.allow_local_devport and args.evidence == str(DEFAULT_EVIDENCE) else Path(args.evidence)
            results_path = DEFAULT_LOCAL_RESULTS if args.allow_local_devport and args.results == str(DEFAULT_RESULTS) else Path(args.results)
            validate_evidence(evidence_path, results_path, allow_local_devport=args.allow_local_devport)
    except Stage1StagingObjectRetentionError as exc:
        print(f"stage1 staging object retention validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 staging object retention contract passed" if args.contract_only else "stage1 staging object retention evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
