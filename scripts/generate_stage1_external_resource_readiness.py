#!/usr/bin/env python3
"""Generate non-clearing Stage 1 external resource readiness preflight.

This artifact is intentionally an operator handoff. It reports which external
inputs are present enough to keep pursuing strict evidence, while redacting all
secret or endpoint values and preserving every launch gate blocker.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "external_resource_readiness" / "local_contract.json"
DEFAULT_ENV_FILE = ROOT / ".env"
DEFAULT_STAGING = ROOT / "ops" / "evidence" / "staging" / "stage1-runtime.json"
DEFAULT_PRODUCTION = ROOT / "ops" / "evidence" / "production" / "stage1-production-launch.json"
DEFAULT_R2_READINESS = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-r2-bucket-readiness.preflight.json"
DEFAULT_CI_PREFLIGHT = ROOT / "ops" / "evidence" / "ci" / "stage1-ci-exact.preflight.json"
DEFAULT_LLM_SELFTEST = ROOT / "ops" / "evidence" / "staging" / "openai-compatible-provider-selftest.json"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-external-resource-readiness.preflight.json"
DEFAULT_PRODUCTION_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_NON_CLEARING_REFRESH = ROOT / "ops" / "evidence" / "non_clearing" / "production-non-clearing-refresh.json"

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

RESERVED_STAGING_HOST_SUFFIXES = {
    ".example",
    ".example.com",
    ".example.net",
    ".example.org",
    ".example.test",
    ".invalid",
    ".localhost",
    ".local",
    ".test",
}

EXPECTED_RESOURCE_IDS = [
    "llm_zai_openai_compatible",
    "r2_zenari_bucket",
    "staging_public_urls",
    "staging_admin_access",
    "staging_quota_replay_db",
    "ci_exact_artifacts",
    "production_launch_inputs",
]

PRODUCTION_SOURCE_PROBES = [
    {
        "probe_id": "production_paid_billing_lifecycle",
        "path": "ops/evidence/production/billing-paid-lifecycle-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.billing.json",
        "schema_version": "stage1.production_billing_source.v1",
        "generator": "python3 scripts/generate_stage1_production_billing_evidence.py --source ops/evidence/production/billing-paid-lifecycle-source.json",
        "strict_validator": "python3 scripts/validate_stage1_production_billing_evidence.py",
    },
    {
        "probe_id": "production_security_launch_checks",
        "path": "ops/evidence/production/production-security-launch-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.security.json",
        "schema_version": "stage1.production_security_launch_source.v1",
        "generator": "python3 scripts/generate_stage1_production_security_launch_evidence.py --source ops/evidence/production/production-security-launch-source.json",
        "strict_validator": "python3 scripts/validate_stage1_production_security_launch_evidence.py",
    },
    {
        "probe_id": "production_legal_support_policy",
        "path": "ops/evidence/production/production-legal-support-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.legal-support.json",
        "schema_version": "stage1.production_legal_support_source.v1",
        "generator": "python3 scripts/generate_stage1_production_legal_support_evidence.py --source ops/evidence/production/production-legal-support-source.json",
        "strict_validator": "python3 scripts/validate_stage1_production_legal_support_evidence.py",
    },
    {
        "probe_id": "production_governance_release",
        "path": "ops/evidence/production/production-governance-release-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.governance.json",
        "schema_version": "stage1.production_governance_release_source.v1",
        "generator": "python3 scripts/generate_stage1_production_governance_release_evidence.py --source ops/evidence/production/production-governance-release-source.json",
        "strict_validator": "python3 scripts/validate_stage1_production_governance_release_evidence.py",
    },
]


class ExternalResourceReadinessError(Exception):
    pass


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def repo_path(path: Path) -> Path:
    if path.is_absolute():
        return path
    return ROOT / path


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise ExternalResourceReadinessError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ExternalResourceReadinessError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ExternalResourceReadinessError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ExternalResourceReadinessError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "preflight")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        if key:
            values[key] = value
    return values


def env_lookup(dotenv: dict[str, str], name: str) -> str:
    return os.environ.get(name) or dotenv.get(name, "")


def has_value(dotenv: dict[str, str], name: str) -> bool:
    value = env_lookup(dotenv, name).strip()
    if not value:
        return False
    lowered = value.lower()
    return not any(token in lowered for token in ("replace_me", "placeholder", "example.test", "from_stripe_cli"))


def present_count(dotenv: dict[str, str], names: list[str]) -> int:
    return sum(1 for name in names if has_value(dotenv, name))


def is_non_local_https_url(value: str) -> bool:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.hostname:
        return False
    hostname = parsed.hostname.lower()
    if hostname in {"localhost", "127.0.0.1", "0.0.0.0"}:
        return False
    if hostname.endswith((".local", ".test", ".example", ".example.test")):
        return False
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        return True
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved)


def non_local_https_count(dotenv: dict[str, str], names: list[str]) -> int:
    return sum(1 for name in names if is_non_local_https_url(env_lookup(dotenv, name).strip()))


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
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved or ip.is_unspecified


def url_readiness_issues(value: str, *, allow_postgres: bool) -> list[str]:
    parsed = urlparse(value or "")
    issues: list[str] = []
    allowed_schemes = {"postgres", "postgresql"} if allow_postgres else {"https"}
    if not value.strip():
        issues.append("missing_value")
    if parsed.scheme not in allowed_schemes:
        issues.append("invalid_scheme")
    if not parsed.netloc or not parsed.hostname:
        issues.append("missing_host")
    if parsed.hostname and is_reserved_or_local_host(parsed.hostname):
        issues.append("reserved_or_local_host")
    if allow_postgres:
        if not (parsed.username and parsed.password):
            issues.append("missing_database_credentials")
    else:
        if parsed.username or parsed.password:
            issues.append("contains_credentials")
        if parsed.query or parsed.fragment:
            issues.append("contains_query_or_fragment")
        if RAW_SECRET_RE.search(value or ""):
            issues.append("secret_shaped_material")
    return issues


def quota_replay_input_readiness(dotenv: dict[str, str]) -> dict[str, Any]:
    database_url = env_lookup(dotenv, "STAGING_DATABASE_URL").strip()
    override_api_url = env_lookup(dotenv, "STAGING_QUOTA_REPLAY_API_URL").strip()
    fallback_api_url = env_lookup(dotenv, "STAGING_API_URL").strip()
    api_url = override_api_url if has_value(dotenv, "STAGING_QUOTA_REPLAY_API_URL") else fallback_api_url
    database_issues = url_readiness_issues(database_url, allow_postgres=True)
    api_issues = url_readiness_issues(api_url, allow_postgres=False)
    tenant_present = has_value(dotenv, "STAGING_QUOTA_REPLAY_TENANT_ID")
    batch_present = has_value(dotenv, "STAGING_QUOTA_REPLAY_BATCH_ID")
    database_ready = not database_issues
    api_ready = not api_issues
    provided_checks = {
        "staging_database_url": has_value(dotenv, "STAGING_DATABASE_URL"),
        "staging_api_url": has_value(dotenv, "STAGING_QUOTA_REPLAY_API_URL") or has_value(dotenv, "STAGING_API_URL"),
        "tenant_id": tenant_present,
        "batch_id": batch_present,
    }
    ready_checks = {
        "staging_database_endpoint": database_ready,
        "staging_api_url": api_ready,
        "tenant_id": tenant_present,
        "batch_id": batch_present,
    }
    return {
        "database_endpoint_ready": database_ready,
        "staging_api_url_ready": api_ready,
        "tenant_id_provided": tenant_present,
        "batch_id_provided": batch_present,
        "provided_count": sum(1 for ready in provided_checks.values() if ready),
        "ready_count": sum(1 for ready in ready_checks.values() if ready),
        "total": len(ready_checks),
        "ready": all(ready_checks.values()),
        "database_issues": database_issues,
        "api_issues": api_issues,
    }


def quota_replay_input_blocker(state: dict[str, Any]) -> str:
    database_issues = ",".join(string_list(state.get("database_issues"))) or "none"
    api_issues = ",".join(string_list(state.get("api_issues"))) or "none"
    missing: list[str] = []
    if state.get("tenant_id_provided") is not True:
        missing.append("STAGING_QUOTA_REPLAY_TENANT_ID")
    if state.get("batch_id_provided") is not True:
        missing.append("STAGING_QUOTA_REPLAY_BATCH_ID")
    missing_text = f"; missing={','.join(missing)}" if missing else ""
    return (
        "staging_quota_replay_db: blocked - require STAGING_DATABASE_URL as deployed non-local Postgres with credentials "
        "and STAGING_API_URL or STAGING_QUOTA_REPLAY_API_URL as non-local HTTPS; "
        f"database_issues={database_issues}; api_issues={api_issues}{missing_text}; values redacted"
    )


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def aggregate_summary(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": display_path(path),
        "schema_version": data.get("schema_version", "missing"),
        "kind": data.get("kind", "missing"),
        "environment": data.get("environment", "unknown"),
        "status": data.get("status", "missing"),
        "release_gate_decision": data.get("release_gate_decision", "no_go"),
        "generated_at": data.get("generated_at", "unknown"),
        "blocker_count": len(string_list(data.get("blockers"))),
        "do_not_launch_conditions": string_list(data.get("do_not_launch_conditions")),
    }


def r2_aggregate_summary(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    summary = aggregate_summary(path, data)
    summary["canonical_path"] = "ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json"
    return summary


def component_pass(data: dict[str, Any], component_id: str) -> bool:
    components = data.get("components")
    if not isinstance(components, list):
        return False
    for item in components:
        if not isinstance(item, dict) or item.get("component_id") != component_id:
            continue
        return (
            item.get("status") in {"pass", "passed"}
            and item.get("exact_evidence") is True
            and item.get("local_only") is not True
            and item.get("dry_run") is not True
            and item.get("secret_leak_detected") is not True
            and item.get("raw_payload_persisted") is not True
            and not string_list(item.get("blockers"))
        )
    return False


def load_r2_readiness(path: Path) -> dict[str, Any]:
    data = load_json(path)
    if not data:
        return {}
    if data.get("schema_version") != "stage1.r2_bucket_readiness.preflight.v1":
        return {}
    if data.get("kind") != "stage1_r2_bucket_readiness_preflight":
        return {}
    return data


def load_ci_exact_preflight(path: Path) -> dict[str, Any]:
    data = load_json(path)
    if not data:
        return {}
    if data.get("schema_version") != "stage1.ci_exact.preflight.v1":
        return {}
    if data.get("kind") != "ci_exact_evidence_preflight":
        return {}
    return data


def load_llm_selftest(path: Path) -> dict[str, Any]:
    data = load_json(path)
    if not data:
        return {}
    if data.get("schema_version") != "stage1.openai_compatible_provider_selftest.v1":
        return {}
    if data.get("kind") != "openai_compatible_provider_selftest":
        return {}
    return data


def llm_selftest_ready(data: dict[str, Any], model: str) -> bool:
    return (
        data.get("status") == "passed"
        and data.get("provider") == "openai-compatible"
        and data.get("model") == model
        and isinstance(data.get("models_seen"), int)
        and data.get("models_seen", 0) > 0
        and isinstance(data.get("chat_completion_chars"), int)
        and data.get("chat_completion_chars", 0) > 0
        and data.get("secret_material_persisted") is False
        and data.get("authorization_header_persisted") is False
        and data.get("raw_provider_payload_persisted") is False
        and data.get("raw_prompt_persisted") is False
        and data.get("completion_text_persisted") is False
        and data.get("can_clear_stage1_production_launch_gate") is False
        and data.get("can_close_do_not_launch") is False
    )


def r2_readiness_ready(data: dict[str, Any]) -> bool:
    readiness = data.get("readiness")
    return (
        data.get("status") == "ready"
        and isinstance(readiness, dict)
        and readiness.get("r2_bucket_access_ready") is True
        and data.get("canonical_pass_path") is False
        and data.get("can_clear_stage1_staging_runtime_gate") is False
        and data.get("can_clear_object_retention_cleanup") is False
    )


def r2_blocker_summary(data: dict[str, Any]) -> str:
    if not data:
        return "R2 bucket readiness preflight missing or invalid - run python3 scripts/stage1_r2_bucket_readiness.py --create-bucket"
    probes = data.get("probes")
    if not isinstance(probes, list):
        return "R2 bucket readiness preflight missing or invalid - missing probe list"

    summaries: list[str] = []
    for probe in probes:
        if not isinstance(probe, dict):
            continue
        check_id = str(probe.get("check_id", "")).strip()
        if not check_id.startswith("s3_"):
            continue
        status = str(probe.get("status", "")).strip()
        if status in {"pass", "skipped"}:
            continue
        reason = " ".join(str(probe.get("reason", "not reported")).split())
        parts = [f"{check_id}: {status or 'blocked'} - {reason}"]
        if isinstance(probe.get("http_status"), int):
            parts.append(f"http_status={probe['http_status']}")
        detail = probe.get("detail")
        if isinstance(detail, dict):
            exception_type = str(detail.get("exception_type", "")).strip()
            if exception_type:
                parts.append(f"exception_type={exception_type}")
            missing_config = detail.get("missing_config")
            if isinstance(missing_config, list) and missing_config:
                parts.append("missing_config=" + ",".join(str(item) for item in missing_config))
        summaries.append("; ".join(parts))

    if summaries:
        return " | ".join(summaries[:3])
    blockers = string_list(data.get("blockers"))
    if blockers:
        joined = " | ".join(blockers[:3])
        if "http_status=" not in joined and data.get("status") == "blocked":
            joined = f"{joined}; missing or invalid R2 readiness probe detail"
        return joined
    return "R2 bucket readiness preflight missing or invalid - no S3 pass evidence"


def aggregate_blockers(*evidence: dict[str, Any]) -> list[str]:
    blockers: list[str] = []
    for item in evidence:
        blockers.extend(string_list(item.get("blockers")))
        preflight = item.get("release_bundle_preflight")
        if isinstance(preflight, dict):
            blockers.extend(string_list(preflight.get("blocking_reasons")))
            blockers.extend(string_list(preflight.get("blockers")))
    return blockers


def first_matching_blocker(candidates: list[str], patterns: tuple[str, ...]) -> str:
    for candidate in candidates:
        if any(pattern in candidate for pattern in patterns):
            return candidate
    return "not reported by current aggregate"


def status_for(provided: bool, verified: bool, blocker: str) -> str:
    if provided and verified:
        return "ready"
    if not provided:
        return "missing"
    if blocker != "not reported by current aggregate":
        return "blocked"
    return "provided_unverified"


def ci_exact_blocker(ci_preflight: dict[str, Any]) -> str:
    ci_state = canonical_ci_state(ci_preflight)
    if ci_state.get("status") == "current_sha_pass":
        return "ci_exact_artifacts: strict-pass for current release SHA"
    if ci_state.get("status") == "old_sha_pass":
        return (
            f"ci_exact_artifacts: current canonical files are for {ci_state.get('artifact_release_sha')}, "
            f"but current candidate is {ci_state.get('candidate_release_sha')}; fetch current GitHub Actions artifacts"
        )
    if ci_preflight.get("schema_version") != "stage1.ci_exact.preflight.v1":
        return "ci_exact_preflight: missing or invalid - run python3 scripts/generate_stage1_ci_exact_preflight.py"
    blocked_checks = string_list(ci_preflight.get("blocked_checks"))
    if blocked_checks:
        return f"ci_exact_preflight: blocked - blocked_checks={','.join(blocked_checks[:6])}"
    if ci_preflight.get("status") == "ready":
        return "ci_exact_preflight: ready - trigger GitHub Actions and fetch strict artifacts"
    return "ci_exact_preflight: blocked - exact GitHub Actions artifact readiness not reported"


def canonical_ci_state(ci_preflight: dict[str, Any]) -> dict[str, str]:
    paths = [
        ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-pr-main-run.json",
        ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-playwright-smoke.json",
        ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-docker-image-build.json",
    ]
    artifacts = [load_json(path) for path in paths]
    if not all(artifact.get("status") in {"pass", "passed"} for artifact in artifacts):
        return {"status": "missing_or_not_pass"}
    shas = {str(artifact.get("release_sha") or "") for artifact in artifacts}
    if len(shas) != 1:
        return {"status": "sha_mismatch"}
    artifact_sha = next(iter(shas))
    summary = ci_preflight.get("workflow_run_summary")
    candidate_sha = str(summary.get("release_sha") or "") if isinstance(summary, dict) else ""
    if artifact_sha and candidate_sha and artifact_sha == candidate_sha:
        return {"status": "current_sha_pass", "artifact_release_sha": artifact_sha, "candidate_release_sha": candidate_sha}
    if artifact_sha and candidate_sha and artifact_sha != candidate_sha:
        return {"status": "old_sha_pass", "artifact_release_sha": artifact_sha, "candidate_release_sha": candidate_sha}
    return {"status": "candidate_missing", "artifact_release_sha": artifact_sha, "candidate_release_sha": candidate_sha}


def missing_inputs_blocker(resource_id: str, names: list[str], requirement: str) -> str:
    return f"{resource_id}: missing - provide {', '.join(names)} for {requirement}; values redacted"


def source_probe_diagnostic_summary(path_ref: str) -> dict[str, Any]:
    path = ROOT / path_ref
    data = load_json(path)
    if not data:
        return {
            "path": path_ref,
            "status": "missing",
            "kind": "missing",
            "canonical_source_written": False,
            "first_blocker": "diagnostic_not_written",
            "blocker_count": 0,
        }
    blockers = string_list(data.get("blocked_checks"))
    return {
        "path": path_ref,
        "status": str(data.get("status", "missing")),
        "kind": str(data.get("kind", "missing")),
        "canonical_source_written": data.get("canonical_source_written") is True,
        "first_blocker": blockers[0] if blockers else "not reported",
        "blocker_count": len(blockers),
        "blockers": blockers[:6],
    }


def production_dns_readiness_summary() -> dict[str, Any]:
    path_ref = "ops/evidence/non_clearing/production-dns-readiness.json"
    data = load_json(ROOT / path_ref)
    if not data:
        return {
            "path": path_ref,
            "status": "missing",
            "first_blocker": "production_dns_readiness_not_written",
        }
    blockers = string_list(data.get("blocked_checks"))
    return {
        "path": path_ref,
        "status": str(data.get("status", "missing")),
        "dns_split_brain_observed": data.get("dns_split_brain_observed") is True,
        "first_blocker": blockers[0] if blockers else "not reported",
    }


def non_clearing_refresh_summary(path: Path = DEFAULT_NON_CLEARING_REFRESH) -> dict[str, Any]:
    path_ref = display_path(path)
    data = load_json(path)
    if not data:
        return {
            "path": path_ref,
            "status": "missing",
            "step_summary": {"total": 0, "passed": 0, "blocked": 0, "failed": 0},
            "blocked_evidence_details": [],
            "stage1_progress": {"completed": 0, "total": 0, "completion_percent": 0},
            "production_input_progress": {"configured": 0, "total": 0, "completion_percent": 0},
        }
    progress = data.get("progress") if isinstance(data.get("progress"), dict) else {}
    stage1 = progress.get("stage1") if isinstance(progress.get("stage1"), dict) else {}
    production_inputs = progress.get("production_inputs") if isinstance(progress.get("production_inputs"), dict) else {}
    details: list[dict[str, str]] = []
    for item in data.get("blocked_evidence_details", []) if isinstance(data.get("blocked_evidence_details"), list) else []:
        if not isinstance(item, dict):
            continue
        step_id = str(item.get("step_id") or "").strip()
        source = str(item.get("source") or "").strip()
        detail = str(item.get("detail") or "").strip()
        if step_id and source and detail:
            details.append({"step_id": step_id, "source": source, "detail": detail})
    return {
        "path": path_ref,
        "status": str(data.get("status", "missing")),
        "step_summary": data.get("step_summary") if isinstance(data.get("step_summary"), dict) else {},
        "blocked_evidence_details": details,
        "stage1_progress": {
            "completed": stage1.get("completed", 0),
            "total": stage1.get("total", 0),
            "completion_percent": stage1.get("completion_percent", 0),
        },
        "production_input_progress": {
            "configured": production_inputs.get("configured", 0),
            "total": production_inputs.get("total", 0),
            "completion_percent": production_inputs.get("completion_percent", 0),
        },
    }


def production_source_probe_requirements(production: dict[str, Any]) -> list[dict[str, Any]]:
    blockers = set(string_list(production.get("blockers")))
    blocked_checks = production.get("blocked_checks")
    if isinstance(blocked_checks, dict):
        for value in blocked_checks.values():
            if isinstance(value, list):
                blockers.update(string_list(value))
    elif isinstance(blocked_checks, list):
        for item in blocked_checks:
            if isinstance(item, dict):
                blockers.update(string_list(item.get("blockers")))
                blockers.update(string_list(item.get("blocking_reasons")))
            else:
                blockers.add(str(item))
    report: list[dict[str, Any]] = []
    for probe in PRODUCTION_SOURCE_PROBES:
        path = str(probe["path"])
        source_path = ROOT / path
        diagnostic_path = str(probe["diagnostic_path"])
        diagnostic = source_probe_diagnostic_summary(diagnostic_path)
        exists = source_path.exists()
        blocker_token = f"source_probe_missing: {path}"
        current_blocker = "none" if exists else blocker_token
        if not exists and diagnostic.get("status") == "blocked" and diagnostic.get("first_blocker") != "diagnostic_not_written":
            current_blocker = f"{blocker_token}; latest_diagnostic={diagnostic['first_blocker']}"
        supporting_diagnostics = []
        if probe["probe_id"] == "production_legal_support_policy":
            dns_diagnostic = production_dns_readiness_summary()
            supporting_diagnostics.append(dns_diagnostic)
            if not exists and dns_diagnostic.get("status") == "blocked":
                current_blocker = f"{blocker_token}; production_dns={dns_diagnostic['first_blocker']}"
        report.append(
            {
                **probe,
                "status": "present" if exists else "missing",
                "source_probe_exists": exists,
                "diagnostic": diagnostic,
                "supporting_diagnostics": supporting_diagnostics,
                "reported_by_production_aggregate": blocker_token in blockers,
                "current_blocker": current_blocker,
            }
        )
    return report


def resource_row(
    *,
    resource_id: str,
    lane: str,
    provided: bool,
    verified: bool,
    blocker: str,
    required_resource: str,
    provided_signal: str,
    validation_signal: str,
    gate_dependency: str,
    evidence_refs: list[str],
    validator: str,
    next_action: str,
    operator_ask: str,
) -> dict[str, Any]:
    status = status_for(provided, verified, blocker)
    return {
        "resource_id": resource_id,
        "lane": lane,
        "status": status,
        "current_blocker": "none" if status == "ready" else blocker,
        "required_resource": required_resource,
        "provided_signal": provided_signal,
        "validation_signal": validation_signal,
        "gate_dependency": gate_dependency,
        "evidence_refs": evidence_refs,
        "validator": validator,
        "next_action": next_action,
        "operator_ask": operator_ask,
    }


def row_by_id(rows: list[dict[str, Any]], resource_id: str) -> dict[str, Any]:
    for row in rows:
        if row.get("resource_id") == resource_id:
            return row
    return {}


def missing_values(dotenv: dict[str, str], names: list[str]) -> list[str]:
    return [name for name in names if not has_value(dotenv, name)]


def missing_non_local_https_values(dotenv: dict[str, str], names: list[str]) -> list[str]:
    return [name for name in names if not is_non_local_https_url(env_lookup(dotenv, name).strip())]


def staging_admin_auth_available(dotenv: dict[str, str]) -> bool:
    if has_value(dotenv, "ADMIN_BEARER_TOKEN") or has_value(dotenv, "STAGING_ADMIN_BEARER_TOKEN"):
        return True
    if has_value(dotenv, "ADMIN_SESSION_COOKIE") or has_value(dotenv, "STAGING_ADMIN_SESSION_COOKIE"):
        return True
    return (
        has_value(dotenv, "STAGING_API_URL")
        and has_value(dotenv, "LOCAL_SEED_ADMIN_EMAIL")
        and has_value(dotenv, "SMOKE_ADMIN_TENANT_ID")
    )


def build_operator_handoff(rows: list[dict[str, Any]], dotenv: dict[str, str], refresh_summary: dict[str, Any]) -> dict[str, Any]:
    staging_urls = row_by_id(rows, "staging_public_urls")
    staging_admin = row_by_id(rows, "staging_admin_access")
    quota_replay = row_by_id(rows, "staging_quota_replay_db")
    ci_exact = row_by_id(rows, "ci_exact_artifacts")
    production_inputs = row_by_id(rows, "production_launch_inputs")
    production_probe_requirements = [
        item
        for item in production_inputs.get("source_probe_requirements", [])
        if isinstance(item, dict)
    ]
    ready_ids = [str(row["resource_id"]) for row in rows if row.get("status") == "ready"]
    missing_ids = [str(row["resource_id"]) for row in rows if row.get("status") == "missing"]
    blocked_ids = [str(row["resource_id"]) for row in rows if row.get("status") == "blocked"]
    non_ready_ids = [str(row["resource_id"]) for row in rows if row.get("status") != "ready"]
    production_only_remaining = non_ready_ids == ["production_launch_inputs"]
    staging_url_names = ["STAGING_API_URL", "STAGING_WEB_URL", "STAGING_ADMIN_URL"]
    admin_identity_names = ["SMOKE_ADMIN_USER_ID", "SMOKE_ADMIN_TENANT_ID", "CSRF_ORIGIN"]
    quota_names = [
        "STAGING_DATABASE_URL",
        "STAGING_QUOTA_REPLAY_TENANT_ID",
        "STAGING_QUOTA_REPLAY_BATCH_ID",
    ]
    missing_variables = (
        missing_non_local_https_values(dotenv, staging_url_names)
        + missing_values(dotenv, admin_identity_names)
        + missing_values(dotenv, quota_names)
    )
    if not staging_admin_auth_available(dotenv):
        missing_variables.append("ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE or LOCAL_SEED_ADMIN_EMAIL local-session bootstrap")
    if not (has_value(dotenv, "STAGING_API_URL") or has_value(dotenv, "STAGING_QUOTA_REPLAY_API_URL")):
        missing_variables.append("STAGING_API_URL or STAGING_QUOTA_REPLAY_API_URL")
    quota_state = quota_replay_input_readiness(dotenv)
    if quota_state.get("database_endpoint_ready") is not True and "STAGING_DATABASE_URL" not in missing_variables:
        missing_variables.append("STAGING_DATABASE_URL deployed non-local Postgres endpoint")
    if quota_state.get("staging_api_url_ready") is not True and "STAGING_API_URL or STAGING_QUOTA_REPLAY_API_URL" not in missing_variables:
        missing_variables.append("STAGING_API_URL or STAGING_QUOTA_REPLAY_API_URL")
    if ci_exact.get("status") != "ready":
        missing_variables.append("GH_TOKEN or GITHUB_TOKEN when GitHub artifact access is private")
    if production_only_remaining:
        missing_variables = [
            "SANITIZED_LIVE_BILLING_PROOF_JSON for ops/evidence/production/billing-paid-lifecycle-source.json",
            "SANITIZED_PRODUCTION_SECURITY_PROOF_JSON for ops/evidence/production/production-security-launch-source.json",
            "PRODUCTION_WEB_URL resolving to public HTTPS legal/support pages for ops/evidence/production/production-legal-support-source.json",
            "SANITIZED_PRODUCTION_GOVERNANCE_PROOF_JSON for ops/evidence/production/production-governance-release-source.json",
            "PRODUCTION_LAUNCH_INPUT_PACKET at ops/evidence/non_clearing/production-launch-input-packet.json",
            "PRODUCTION_LAUNCH_OPERATOR_BRIEF at ops/evidence/non_clearing/production-launch-operator-brief.json",
            "PRODUCTION_MISSING_INPUT_CHECKLIST at ops/evidence/non_clearing/production-missing-input-checklist.json",
            "PRODUCTION_SOURCE_PROBE_RUNBOOK at ops/evidence/non_clearing/production-source-probe-runbook.json",
        ]
    resource_labels = {
        "staging_public_urls": "deployed staging HTTPS URLs",
        "staging_admin_access": "staging admin authenticated probes",
        "staging_quota_replay_db": "staging quota replay inputs/evidence",
        "ci_exact_artifacts": "current-SHA exact CI artifacts",
        "production_launch_inputs": "production source probes",
    }
    remaining_labels = [resource_labels.get(resource_id, resource_id) for resource_id in non_ready_ids]
    if production_only_remaining:
        current_loop_breaker = (
            "R2, Stripe sandbox, z.ai glm-5.2, staging evidence inputs/artifacts, and CI exact artifacts are ready; "
            "production source probes only remain: live Stripe billing, production security, "
            "production legal/support HTTPS, and production governance release."
        )
    else:
        current_loop_breaker = (
            "R2, Stripe sandbox, and z.ai glm-5.2 are ready; "
            f"remaining non-ready resources: {', '.join(remaining_labels) or 'none'}."
        )
    base_commands = [
        "python3 scripts/generate_stage1_external_resource_readiness.py",
        "OBJECT_RETENTION_MODE=preflight_stage1 scripts/staging_object_storage_retention_cleanup_smoke.sh",
        "WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE=1 scripts/staging_object_storage_retention_cleanup_smoke.sh",
        "python3 scripts/generate_stage1_staging_quota_replay_evidence.py",
        "LOAD_MODE=all WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE=1 scripts/load_smoke.sh",
        "python3 scripts/fetch_stage1_ci_artifacts.py --run-url <github-actions-run-url>",
        "python3 scripts/generate_stage1_staging_runtime_evidence.py",
        "python3 scripts/validate_stage1_staging_runtime.py",
    ]
    production_commands = [
        "python3 scripts/stage1_production_source_probe.py --billing --release-sha $(git rev-parse HEAD) --billing-proof <sanitized-live-billing-proof.json> --write-canonical-source",
        "python3 scripts/stage1_production_source_probe.py --security --release-sha $(git rev-parse HEAD) --security-proof <sanitized-production-security-proof.json> --write-canonical-source",
        "python3 scripts/stage1_production_source_probe.py --legal-support --release-sha $(git rev-parse HEAD) --production-web-url https://zenari.ai --write-canonical-source",
        "python3 scripts/stage1_production_source_probe.py --governance --release-sha $(git rev-parse HEAD) --governance-proof <sanitized-production-governance-proof.json> --write-canonical-source",
        "python3 scripts/generate_stage1_production_billing_evidence.py --source ops/evidence/production/billing-paid-lifecycle-source.json",
        "python3 scripts/generate_stage1_production_security_launch_evidence.py --source ops/evidence/production/production-security-launch-source.json",
        "python3 scripts/generate_stage1_production_legal_support_evidence.py --source ops/evidence/production/production-legal-support-source.json",
        "python3 scripts/generate_stage1_production_governance_release_evidence.py --source ops/evidence/production/production-governance-release-source.json",
        "python3 scripts/generate_stage1_production_launch_evidence.py",
        "python3 scripts/validate_stage1_production_launch.py",
    ]
    return {
        "status": "blocked",
        "current_loop_breaker": current_loop_breaker,
        "ready_resource_ids": ready_ids,
        "missing_resource_ids": missing_ids,
        "blocked_resource_ids": blocked_ids,
        "missing_variables": missing_variables,
        "resource_classes": (
            [
                "production source probe JSON files for billing, security, legal/support, and governance",
                "Stripe live-mode billing lifecycle evidence with livemode=true",
                "production DNS and HTTPS legal/support policy URLs",
                "sanitized production security launch proof",
                "sanitized production governance release proof",
            ]
            if production_only_remaining
            else [
                "GitHub Actions run URL or downloaded artifact directory with the three exact CI JSON files",
                "production deployment access",
                "Stripe live/test separation evidence",
                "provider/claims policy",
                "production backup/restore target",
                "rollback/post-deploy smoke path",
                "legal/support policy URLs",
                "production source probe JSON files for billing, security, legal/support, and governance",
            ]
        ),
        "production_source_probe_requirements": production_probe_requirements,
        "non_clearing_refresh_summary": refresh_summary,
        "commands_after_inputs": base_commands + production_commands,
        "input_packet_ref": "ops/evidence/non_clearing/production-launch-input-packet.json",
        "operator_brief_ref": "ops/evidence/non_clearing/production-launch-operator-brief.json",
        "missing_input_checklist_ref": "ops/evidence/non_clearing/production-missing-input-checklist.json",
        "source_probe_runbook_ref": "ops/evidence/non_clearing/production-source-probe-runbook.json",
        "resource_status": {
            "staging_public_urls": staging_urls.get("status", "missing"),
            "staging_admin_access": staging_admin.get("status", "missing"),
            "staging_quota_replay_db": quota_replay.get("status", "missing"),
            "ci_exact_artifacts": ci_exact.get("status", "missing"),
            "production_launch_inputs": production_inputs.get("status", "missing"),
        },
        "non_clearing_preflight": True,
    }


def build_rows(
    dotenv: dict[str, str],
    staging: dict[str, Any],
    production: dict[str, Any],
    r2_readiness: dict[str, Any],
    ci_preflight: dict[str, Any],
    llm_selftest: dict[str, Any],
) -> list[dict[str, Any]]:
    blockers = aggregate_blockers(staging, production)

    llm_env = ["LLM_PROVIDER", "LLM_OPENAI_BASE_URL", "LLM_OPENAI_API_KEY", "LLM_OPENAI_MODEL"]
    llm_present = present_count(dotenv, llm_env)
    llm_model_ready = env_lookup(dotenv, "LLM_OPENAI_MODEL").strip() == "glm-5.2"
    llm_provider_ready = env_lookup(dotenv, "LLM_PROVIDER").strip() == "openai-compatible"
    llm_direct_verified = llm_selftest_ready(llm_selftest, "glm-5.2")
    llm_staging_verified = component_pass(staging, "provider_sandbox")
    llm_verified = llm_direct_verified or llm_staging_verified
    llm_blocker = first_matching_blocker(blockers, ("provider_sandbox", "provider_quota", "provider_http_error", "provider_retryable_http_error"))
    if llm_present != len(llm_env) or not llm_model_ready or not llm_provider_ready:
        llm_blocker = missing_inputs_blocker(
            "llm_zai_openai_compatible",
            llm_env,
            "z.ai OpenAI-compatible glm-5.2 provider selftest and staging provider sandbox",
        )

    object_env = [
        "OBJECT_STORAGE_PROVIDER",
        "OBJECT_STORAGE_ENDPOINT",
        "OBJECT_STORAGE_REGION",
        "OBJECT_STORAGE_BUCKET",
        "OBJECT_STORAGE_ACCESS_KEY",
        "OBJECT_STORAGE_SECRET_KEY",
    ]
    object_present = present_count(dotenv, object_env)
    bucket_ready = env_lookup(dotenv, "OBJECT_STORAGE_BUCKET").strip() == "zenari"
    r2_verified = r2_readiness_ready(r2_readiness)
    object_verified = r2_verified
    object_blocker = first_matching_blocker(blockers, ("object-storage-retention-cleanup", "object_retention", "retention", "signed_download"))
    if object_present != len(object_env) or not bucket_ready:
        object_blocker = missing_inputs_blocker(
            "r2_zenari_bucket",
            object_env,
            "Cloudflare R2 S3-compatible bucket zenari readiness",
        )
    elif not r2_verified:
        object_blocker = r2_blocker_summary(r2_readiness)
    object_next_action = (
        "Run strict staging object retention probes with deployed admin access and write canonical object-storage-retention-cleanup evidence."
        if r2_verified
        else "Run python3 scripts/stage1_r2_bucket_readiness.py --create-bucket, then run strict staging object retention probes with deployed admin access."
    )
    object_operator_ask = (
        "No R2 bucket credential input needed; provide staging public URLs and admin access so canonical object retention probes can run."
        if r2_verified
        else "Provide a Cloudflare API token with Workers R2 Storage Write, or pre-create bucket zenari and provide S3 keys scoped to that bucket."
    )

    staging_urls = ["STAGING_API_URL", "STAGING_WEB_URL", "STAGING_ADMIN_URL"]
    staging_url_ready = non_local_https_count(dotenv, staging_urls)
    staging_url_verified = component_pass(staging, "legal_support_external_user")
    staging_url_blocker = first_matching_blocker(blockers, ("staging", "legal_support", "stage1-runtime", "missing canonical pass evidence"))
    if staging_url_ready != len(staging_urls):
        staging_url_blocker = missing_inputs_blocker(
            "staging_public_urls",
            staging_urls,
            "production-like non-local HTTPS staging API/Web/Admin probes",
        )

    admin_identity_env = ["SMOKE_ADMIN_USER_ID", "SMOKE_ADMIN_TENANT_ID", "CSRF_ORIGIN"]
    admin_present = present_count(dotenv, admin_identity_env) + (1 if staging_admin_auth_available(dotenv) else 0)
    admin_verified = component_pass(staging, "auth_rbac_tenant_audit") and component_pass(staging, "provider_sandbox")
    admin_blocker = first_matching_blocker(blockers, ("auth_rbac", "tenant_audit", "admin", "provider_sandbox"))
    if admin_present != len(admin_identity_env) + 1:
        admin_blocker = missing_inputs_blocker(
            "staging_admin_access",
            ["ADMIN_BEARER_TOKEN or ADMIN_SESSION_COOKIE or LOCAL_SEED_ADMIN_EMAIL local-session bootstrap"] + admin_identity_env,
            "admin-authenticated staging release probes",
        )

    quota_required_env = [
        "STAGING_DATABASE_URL",
        "STAGING_QUOTA_REPLAY_TENANT_ID",
        "STAGING_QUOTA_REPLAY_BATCH_ID",
    ]
    quota_input_state = quota_replay_input_readiness(dotenv)
    quota_present = int(quota_input_state["provided_count"])
    quota_input_ready = quota_input_state.get("ready") is True
    quota_canonical_verified = component_pass(staging, "staging_quota_replay")
    quota_verified = quota_canonical_verified or (quota_input_ready and component_pass(staging, "staging_quota_replay"))
    quota_blocker = first_matching_blocker(blockers, ("stage1-quota-replay", "quota_replay", "quota"))
    if quota_canonical_verified:
        quota_blocker = "none"
    elif quota_present != len(quota_required_env) + 1:
        quota_blocker = missing_inputs_blocker(
            "staging_quota_replay_db",
            quota_required_env + ["STAGING_API_URL or STAGING_QUOTA_REPLAY_API_URL"],
            "deployed staging quota replay against real tenant and batch evidence",
        )
    elif not quota_input_ready:
        quota_blocker = quota_replay_input_blocker(quota_input_state)

    ci_paths = [
        ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-pr-main-run.json",
        ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-playwright-smoke.json",
        ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-docker-image-build.json",
    ]
    ci_present = sum(1 for path in ci_paths if path.exists())
    ci_state = canonical_ci_state(ci_preflight)
    ci_verified = ci_state.get("status") == "current_sha_pass" and bool(production.get("ci_evidence")) and all(
        isinstance(item, dict) and item.get("status") in {"pass", "passed"} and not string_list(item.get("blockers"))
        for item in production.get("ci_evidence", [])
    )
    ci_blocker = first_matching_blocker(blockers, ("ci_pr_main_run", "ci_playwright_smoke", "ci_docker_image_build", "stage0-rev2"))
    if not ci_verified:
        ci_blocker = ci_exact_blocker(ci_preflight)

    production_verified = production.get("status") in {"pass", "passed"} and production.get("release_gate_decision") == "go"
    production_probe_requirements = production_source_probe_requirements(production)
    missing_production_source_probes = [
        item["path"] for item in production_probe_requirements if item.get("status") != "present"
    ]
    production_blocker = first_matching_blocker(
        blockers,
        (
            "production_backup",
            "provider_claims",
            "paid_billing",
            "security_launch",
            "legal_support_policy",
            "governance_release",
            "stage1_production_launch",
        ),
    )
    if not production_verified:
        if missing_production_source_probes:
            production_blocker = (
                "production_launch_inputs: missing_source_probes - "
                + ", ".join(missing_production_source_probes)
                + "; values redacted"
            )
        else:
            production_blocker = (
                "production_launch_inputs: missing - provide production deployment access, Stripe live/test separation evidence, "
                "provider/claims policy, backup/restore target, rollback/post-deploy smoke path, and legal/support policy URLs; values redacted"
            )

    return [
        resource_row(
            resource_id="llm_zai_openai_compatible",
            lane="provider",
            provided=llm_present == len(llm_env) and llm_model_ready and llm_provider_ready,
            verified=llm_verified,
            blocker=llm_blocker,
            required_resource="z.ai OpenAI-compatible coding endpoint key configured for glm-5.2 live provider calls",
            provided_signal=(
                f"{llm_present}/{len(llm_env)} LLM environment names present; "
                f"model_glm_5_2={llm_model_ready}; provider_openai_compatible={llm_provider_ready}; "
                f"direct_live_selftest={llm_direct_verified}; values redacted"
            ),
            validation_signal=(
                "direct OpenAI-compatible glm-5.2 live selftest exact pass; staging provider_sandbox follow-up remains required"
                if llm_direct_verified
                else (
                    "provider_sandbox component exact evidence pass"
                    if llm_staging_verified
                    else "direct LLM selftest and provider_sandbox strict staging evidence are not canonical pass"
                )
            ),
            gate_dependency="stage1_provider_sandbox",
            evidence_refs=[
                "ops/evidence/staging/openai-compatible-provider-selftest.json",
                "ops/evidence/staging/stage1-provider-sandbox.json",
                "ops/evidence/staging/stage1-provider-sandbox.ndjson",
            ],
            validator="bash scripts/openai_compatible_provider_selftest.sh --output ops/evidence/staging/openai-compatible-provider-selftest.json",
            next_action="Keep live provider keys only in ignored .env/environment, rerun provider sandbox smoke against real staging, then aggregate staging runtime.",
            operator_ask="No operator input needed while the existing z.ai key remains valid.",
        ),
        resource_row(
            resource_id="r2_zenari_bucket",
            lane="staging",
            provided=object_present == len(object_env) and bucket_ready,
            verified=object_verified,
            blocker=object_blocker,
            required_resource="Cloudflare R2 bucket named zenari with S3-compatible read/write/list access for staging object retention smoke",
            provided_signal=f"{object_present}/{len(object_env)} object storage environment names present; bucket_name_zenari={bucket_ready}; values redacted",
            validation_signal="R2 bucket readiness exact preflight pass: S3 head/put/get/list/delete succeeded" if object_verified else "R2 bucket readiness preflight is missing or blocked",
            gate_dependency="object_storage_retention_cleanup",
            evidence_refs=["ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json", "ops/evidence/staging/object-storage-retention-cleanup.json"],
            validator="python3 scripts/validate_stage1_r2_bucket_readiness.py --allow-preflight",
            next_action=object_next_action,
            operator_ask=object_operator_ask,
        ),
        resource_row(
            resource_id="staging_public_urls",
            lane="staging",
            provided=staging_url_ready == len(staging_urls),
            verified=staging_url_verified,
            blocker=staging_url_blocker,
            required_resource="Production-like non-local HTTPS staging API, Web, and Admin URLs",
            provided_signal=f"{staging_url_ready}/{len(staging_urls)} staging URL environment names contain non-local HTTPS values; values redacted",
            validation_signal="legal/support staging visibility exact evidence pass" if staging_url_verified else "staging public URL evidence is not enough to clear strict runtime",
            gate_dependency="stage1_staging_runtime_preflight",
            evidence_refs=["ops/evidence/staging/stage1-runtime.json", "ops/evidence/staging/stage1-runtime.ndjson"],
            validator="python3 scripts/validate_stage1_staging_runtime.py",
            next_action="Set STAGING_API_URL, STAGING_WEB_URL, and STAGING_ADMIN_URL to deployed non-local HTTPS origins, then rerun staging smoke scripts.",
            operator_ask="Send the real staging API/Web/Admin HTTPS URLs when deployed.",
        ),
        resource_row(
            resource_id="staging_admin_access",
            lane="staging",
            provided=admin_present == len(admin_identity_env) + 1,
            verified=admin_verified,
            blocker=admin_blocker,
            required_resource="Staging admin bearer/session/local-session bootstrap access, admin user id, tenant id, and CSRF origin for release evidence probes",
            provided_signal=f"{admin_present}/{len(admin_identity_env) + 1} staging admin access inputs present; bearer/session/local bootstrap accepted; values redacted",
            validation_signal="auth/RBAC and provider sandbox admin probes exact evidence pass" if admin_verified else "admin-authenticated staging probes are not all strict-pass",
            gate_dependency="stage1_provider_sandbox + object_storage_retention_cleanup + safety_qa_eval",
            evidence_refs=["ops/evidence/staging/stage1-provider-sandbox.json", "ops/evidence/staging/stage1-safety-qa-eval.json"],
            validator="python3 scripts/validate_stage1_staging_runtime.py",
            next_action="Load admin token/login context into ignored environment, rerun provider, safety, object retention, and release bundle staging probes.",
            operator_ask="Provide staging admin access method, admin user id, tenant id, and CSRF origin/header requirement after real staging URLs are available.",
        ),
        resource_row(
            resource_id="staging_quota_replay_db",
            lane="staging",
            provided=quota_canonical_verified or quota_present == len(quota_required_env) + 1,
            verified=quota_verified,
            blocker=quota_blocker,
            required_resource="Read-only deployed staging Postgres URL plus tenant and batch ids for quota replay against real provider usage logs",
            provided_signal=(
                "canonical quota replay exact evidence present; input values no longer required for readiness; values redacted"
                if quota_canonical_verified
                else f"{quota_present}/{len(quota_required_env) + 1} quota replay required inputs present; production_like_ready={quota_input_ready}; dedicated replay API URL may reuse STAGING_API_URL; values redacted"
            ),
            validation_signal="staging_quota_replay component exact evidence pass" if quota_verified else "quota replay canonical evidence is missing or blocked",
            gate_dependency="staging_quota_replay",
            evidence_refs=["ops/evidence/staging/stage1-quota-replay.json", "ops/evidence/staging/stage1-quota-replay.ndjson"],
            validator="python3 scripts/validate_stage1_staging_quota_replay_evidence.py",
            next_action=(
                "No quota replay input action needed; preserve canonical stage1-quota-replay evidence and keep staging runtime aggregate current."
                if quota_canonical_verified
                else "Run quota replay generator with deployed Postgres read access and real tenant/batch ids, then aggregate staging runtime."
            ),
            operator_ask=(
                "No quota replay DB input needed while canonical staging quota replay evidence remains strict-pass."
                if quota_canonical_verified
                else "Provide STAGING_DATABASE_URL read access plus STAGING_QUOTA_REPLAY_TENANT_ID and STAGING_QUOTA_REPLAY_BATCH_ID; STAGING_API_URL is reused unless STAGING_QUOTA_REPLAY_API_URL is set."
            ),
        ),
        resource_row(
            resource_id="ci_exact_artifacts",
            lane="ci",
            provided=ci_present == len(ci_paths),
            verified=ci_verified,
            blocker=ci_blocker,
            required_resource="Exact GitHub Actions PR/main, Playwright smoke, and Docker image build evidence artifacts",
            provided_signal=f"{ci_present}/{len(ci_paths)} canonical CI evidence files present; artifact values redacted by validators",
            validation_signal="production aggregate CI evidence exact pass" if ci_verified else "CI exact evidence is missing or not strict-pass",
            gate_dependency="ci_pr_main_run + ci_playwright_smoke + ci_docker_image_build",
            evidence_refs=[display_path(path) for path in ci_paths],
            validator="python3 scripts/validate_stage1_ci_exact_evidence.py",
            next_action="Trigger installed GitHub Actions workflow, then run python3 scripts/fetch_stage1_ci_artifacts.py --run-url <github-actions-run-url> to publish strict canonical CI evidence.",
            operator_ask="Provide a GitHub Actions run URL plus artifact access token if private, or provide a downloaded artifact directory containing the three exact CI JSON files.",
        ),
        {
            **resource_row(
            resource_id="production_launch_inputs",
            lane="production",
            provided=not missing_production_source_probes,
            verified=production_verified,
            blocker=production_blocker,
            required_resource="Production provider/claims, paid billing lifecycle, backup/rollback, security, legal/support, and governance release evidence inputs",
            provided_signal=f"{len(PRODUCTION_SOURCE_PROBES) - len(missing_production_source_probes)}/{len(PRODUCTION_SOURCE_PROBES)} required production source probes present; no secret values projected",
            validation_signal="stage1 production aggregate strict pass" if production_verified else "production launch aggregate remains blocked",
            gate_dependency="stage1_production_launch_preflight",
            evidence_refs=["ops/evidence/production/stage1-production-launch.json", "ops/evidence/production/stage1-production-launch.ndjson"],
            validator="python3 scripts/validate_stage1_production_launch.py",
            next_action="Create the missing safe production source probe JSON files, then rerun production child evidence generators for billing, security, legal/support, and governance.",
            operator_ask="No additional sandbox/LLM/Stripe-test input is needed; provide or run only the missing live production source probes listed in source_probe_requirements.",
            ),
            "source_probe_requirements": production_probe_requirements,
        },
    ]


def validate_contract_anchors() -> None:
    contract = load_json(CONTRACT)
    if contract.get("schema_version") != "stage1.external_resource_readiness.contract.v1":
        raise ExternalResourceReadinessError("contract schema_version mismatch")
    if contract.get("canonical_preflight_path") != "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json":
        raise ExternalResourceReadinessError("contract canonical_preflight_path mismatch")
    if contract.get("required_resource_ids") != EXPECTED_RESOURCE_IDS:
        raise ExternalResourceReadinessError("contract required_resource_ids mismatch")
    policy = contract.get("preflight_policy")
    if not isinstance(policy, dict):
        raise ExternalResourceReadinessError("contract preflight_policy must be object")
    if policy.get("generator_command") != "python3 scripts/generate_stage1_external_resource_readiness.py":
        raise ExternalResourceReadinessError("contract generator command mismatch")
    if policy.get("can_clear_stage1_staging_runtime_gate") is not False:
        raise ExternalResourceReadinessError("resource readiness preflight must not clear staging")
    if policy.get("can_clear_stage1_production_launch_gate") is not False:
        raise ExternalResourceReadinessError("resource readiness preflight must not clear production")
    if policy.get("can_close_do_not_launch") is not False:
        raise ExternalResourceReadinessError("resource readiness preflight must not close DNL")


def build_preflight(args: argparse.Namespace) -> dict[str, Any]:
    env_file = repo_path(args.env_file)
    dotenv = parse_env_file(env_file)
    staging_path = repo_path(args.staging)
    production_path = repo_path(args.production)
    staging = load_json(staging_path)
    production = load_json(production_path)
    r2_path = repo_path(args.r2_readiness)
    r2_readiness = load_r2_readiness(r2_path)
    ci_preflight_path = repo_path(args.ci_preflight)
    ci_preflight = load_ci_exact_preflight(ci_preflight_path)
    llm_selftest_path = repo_path(args.llm_selftest)
    llm_selftest = load_llm_selftest(llm_selftest_path)
    rows = build_rows(dotenv, staging, production, r2_readiness, ci_preflight, llm_selftest)
    refresh_summary = non_clearing_refresh_summary()
    by_status = {
        "ready": sum(1 for row in rows if row["status"] == "ready"),
        "provided_unverified": sum(1 for row in rows if row["status"] == "provided_unverified"),
        "blocked": sum(1 for row in rows if row["status"] == "blocked"),
        "missing": sum(1 for row in rows if row["status"] == "missing"),
    }
    ready_percent = round((by_status["ready"] / len(rows)) * 100, 1) if rows else 0.0
    blockers = [
        f"{row['resource_id']}: {row['status']} - {row['operator_ask']}"
        for row in rows
        if row["status"] != "ready"
    ]
    report: dict[str, Any] = {
        "schema_version": "stage1.external_resource_readiness.preflight.v1",
        "kind": "stage1_external_resource_readiness_preflight",
        "environment": "release",
        "status": "blocked",
        "release_gate_decision": "no_go",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source_aggregates": {
            "staging_runtime": aggregate_summary(staging_path, staging),
            "production_launch": aggregate_summary(production_path, production),
            "r2_bucket_readiness": r2_aggregate_summary(r2_path, r2_readiness) if r2_readiness else {
                "path": display_path(r2_path),
                "canonical_path": "ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json",
                "schema_version": "missing",
                "kind": "missing",
                "environment": "release",
                "status": "missing",
                "release_gate_decision": "no_go",
                "generated_at": "unknown",
                "blocker_count": 1,
                "do_not_launch_conditions": [],
            },
            "ci_exact_preflight": aggregate_summary(ci_preflight_path, ci_preflight) if ci_preflight else {
                "path": display_path(ci_preflight_path),
                "schema_version": "missing",
                "kind": "missing",
                "environment": "ci",
                "status": "missing",
                "release_gate_decision": "no_go",
                "generated_at": "unknown",
                "blocker_count": 1,
                "do_not_launch_conditions": [],
            },
            "llm_openai_compatible_selftest": aggregate_summary(llm_selftest_path, llm_selftest) if llm_selftest else {
                "path": display_path(llm_selftest_path),
                "schema_version": "missing",
                "kind": "missing",
                "environment": "staging",
                "status": "missing",
                "release_gate_decision": "no_go",
                "generated_at": "unknown",
                "blocker_count": 1,
                "do_not_launch_conditions": [],
            },
        },
        "resource_groups": rows,
        "operator_handoff": build_operator_handoff(rows, dotenv, refresh_summary),
        "non_clearing_refresh_summary": refresh_summary,
        "production_source_probe_requirements": production_source_probe_requirements(production),
        "resource_summary": {
            "total": len(rows),
            "ready": by_status["ready"],
            "provided_unverified": by_status["provided_unverified"],
            "blocked": by_status["blocked"],
            "missing": by_status["missing"],
            "ready_percent": ready_percent,
            "by_lane": {
                "provider": sum(1 for row in rows if row["lane"] == "provider"),
                "staging": sum(1 for row in rows if row["lane"] == "staging"),
                "ci": sum(1 for row in rows if row["lane"] == "ci"),
                "production": sum(1 for row in rows if row["lane"] == "production"),
            },
        },
        "blockers": blockers,
        "canonical_pass_path": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "strict_launch_evidence_required": [
            "python3 scripts/validate_stage1_staging_runtime.py",
            "python3 scripts/validate_stage1_production_launch.py",
            "python3 scripts/validate_stage1_ci_exact_evidence.py",
        ],
        "safe_projection_policy": {field: False for field in SAFE_FALSE_FIELDS},
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Stage 1 external resource readiness preflight")
    parser.add_argument("--contract-only", action="store_true", help="validate generator contract anchors only")
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--staging", type=Path, default=DEFAULT_STAGING)
    parser.add_argument("--production", type=Path, default=DEFAULT_PRODUCTION)
    parser.add_argument("--r2-readiness", type=Path, default=DEFAULT_R2_READINESS)
    parser.add_argument("--ci-preflight", type=Path, default=DEFAULT_CI_PREFLIGHT)
    parser.add_argument("--llm-selftest", type=Path, default=DEFAULT_LLM_SELFTEST)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract_anchors()
        if args.contract_only:
            print("stage1 external resource readiness generator contract passed")
            return 0
        report = build_preflight(args)
        write_json(repo_path(args.output), report)
    except ExternalResourceReadinessError as exc:
        print(f"generate Stage 1 external resource readiness failed: {exc}", file=sys.stderr)
        return 1
    print(f"wrote Stage 1 external resource readiness preflight to {display_path(repo_path(args.output))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
