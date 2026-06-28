#!/usr/bin/env python3
"""Validate Stage 1 external resource readiness contract and preflight."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "external_resource_readiness" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-external-resource-readiness.preflight.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_external_resource_readiness.py"
VALIDATOR = ROOT / "scripts" / "validate_stage1_external_resource_readiness.py"
RELEASE_READINESS_CONTRACT = ROOT / "fixtures" / "stage1" / "release_readiness" / "local_contract.json"
RELEASE_READINESS_VALIDATOR = ROOT / "scripts" / "validate_stage1_release_readiness_contract.py"
R2_READINESS_CONTRACT = ROOT / "fixtures" / "stage1" / "r2_bucket_readiness" / "local_contract.json"
R2_READINESS_VALIDATOR = ROOT / "scripts" / "validate_stage1_r2_bucket_readiness.py"
ADMIN_PAGE = ROOT / "admin" / "app" / "release" / "page.tsx"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

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

EXPECTED_RESOURCE_IDS = [
    "llm_zai_openai_compatible",
    "r2_zenari_bucket",
    "staging_public_urls",
    "staging_admin_access",
    "staging_quota_replay_db",
    "ci_exact_artifacts",
    "production_launch_inputs",
]

EXPECTED_PRODUCTION_SOURCE_PROBES = [
    {
        "probe_id": "production_paid_billing_lifecycle",
        "path": "ops/evidence/production/billing-paid-lifecycle-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.billing.json",
        "schema_version": "stage1.production_billing_source.v1",
    },
    {
        "probe_id": "production_security_launch_checks",
        "path": "ops/evidence/production/production-security-launch-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.security.json",
        "schema_version": "stage1.production_security_launch_source.v1",
    },
    {
        "probe_id": "production_legal_support_policy",
        "path": "ops/evidence/production/production-legal-support-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.legal-support.json",
        "schema_version": "stage1.production_legal_support_source.v1",
    },
    {
        "probe_id": "production_governance_release",
        "path": "ops/evidence/production/production-governance-release-source.json",
        "diagnostic_path": "ops/evidence/production/source-probe-diagnostics.governance.json",
        "schema_version": "stage1.production_governance_release_source.v1",
    },
]

REQUIRED_ROW_FIELDS = {
    "resource_id",
    "lane",
    "status",
    "current_blocker",
    "required_resource",
    "provided_signal",
    "validation_signal",
    "gate_dependency",
    "evidence_refs",
    "validator",
    "next_action",
    "operator_ask",
}


class ExternalResourceReadinessContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ExternalResourceReadinessContractError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise ExternalResourceReadinessContractError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain JSON object")
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


def validate_contract_fixture() -> dict[str, Any]:
    contract = load_json(CONTRACT)
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.external_resource_readiness.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "external_resource_readiness_contract", "contract kind mismatch")
    require({"R-3", "OP-2", "OP-5", "OP-7", "VF-6", "VF-7", "VF-8"} <= set(contract.get("blueprint_items") or []), "contract blueprint_items incomplete")
    require(contract.get("release_gate_status") == "contract_ready_external_resources_open", "contract release gate status mismatch")
    require(contract.get("canonical_preflight_path") == "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json", "contract preflight path mismatch")
    require(contract.get("required_resource_ids") == EXPECTED_RESOURCE_IDS, "required_resource_ids mismatch")
    require(set(contract.get("required_resource_fields") or []) == REQUIRED_ROW_FIELDS, "required_resource_fields mismatch")
    handoff_fields = set(contract.get("required_operator_handoff_fields") or [])
    require(
        {
            "status",
            "current_loop_breaker",
            "ready_resource_ids",
            "missing_resource_ids",
            "blocked_resource_ids",
            "missing_variables",
            "resource_classes",
            "commands_after_inputs",
            "resource_status",
            "non_clearing_preflight",
            "input_packet_ref",
            "operator_brief_ref",
            "missing_input_checklist_ref",
            "source_probe_runbook_ref",
        }
        <= handoff_fields,
        "required_operator_handoff_fields mismatch",
    )
    policy = contract.get("preflight_policy")
    require(isinstance(policy, dict), "preflight_policy must be object")
    require(policy.get("generator_command") == "python3 scripts/generate_stage1_external_resource_readiness.py", "preflight generator command mismatch")
    require(policy.get("validator_command") == "python3 scripts/validate_stage1_external_resource_readiness.py --allow-preflight", "preflight validator command mismatch")
    require(policy.get("accepted_schema_version") == "stage1.external_resource_readiness.preflight.v1", "preflight accepted schema mismatch")
    require(policy.get("accepted_kind") == "stage1_external_resource_readiness_preflight", "preflight accepted kind mismatch")
    require(policy.get("accepted_status") == "blocked", "preflight accepted status mismatch")
    require(policy.get("canonical_pass_path") is False, "preflight canonical_pass_path must be false")
    require(policy.get("can_clear_stage1_staging_runtime_gate") is False, "preflight must not clear staging gate")
    require(policy.get("can_clear_stage1_production_launch_gate") is False, "preflight must not clear production gate")
    require(policy.get("can_close_do_not_launch") is False, "preflight must not close DNL")
    require(policy.get("strict_validator_still_rejects_preflight") is True, "strict reject policy mismatch")
    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    non_launch = contract.get("non_launch_status")
    require(isinstance(non_launch, dict), "non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("resource_evidence") == "open", "resource evidence status mismatch")
    require(non_launch.get("can_close_do_not_launch") is False, "local contract must not close DNL")
    for ref in contract.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    return contract


def validate_code_anchors() -> None:
    require_text(
        GENERATOR,
        (
            "stage1.external_resource_readiness.preflight.v1",
            "stage1_external_resource_readiness_preflight",
            "stage1-r2-bucket-readiness.preflight.json",
            "stage1-ci-exact.preflight.json",
            "load_r2_readiness",
            "load_ci_exact_preflight",
            "r2_readiness_ready",
            "ci_exact_blocker",
            "llm_zai_openai_compatible",
            "r2_zenari_bucket",
            "staging_public_urls",
            "staging_admin_access",
            "staging_quota_replay_db",
            "ci_exact_artifacts",
            "production_launch_inputs",
            "production_source_probe_requirements",
            "billing-paid-lifecycle-source.json",
            "production-security-launch-source.json",
            "production-legal-support-source.json",
            "production-governance-release-source.json",
            "ready_percent",
            "operator_handoff",
            "current_loop_breaker",
            "non_clearing_refresh_summary",
            "production-non-clearing-refresh.json",
            "commands_after_inputs",
            "operator_brief_ref",
            "missing_input_checklist_ref",
            "source_probe_runbook_ref",
            "can_clear_stage1_staging_runtime_gate",
            "can_clear_stage1_production_launch_gate",
            "can_close_do_not_launch",
        ),
    )
    require_text(
        VALIDATOR,
        (
            "stage1.external_resource_readiness.contract.v1",
            "stage1.external_resource_readiness.preflight.v1",
            "validate_stage1_r2_bucket_readiness.py",
            "stage1-r2-bucket-readiness.preflight.json",
            "validate_preflight_evidence",
            "--allow-preflight",
            "strict mode rejects external resource readiness preflight",
            "EXPECTED_RESOURCE_IDS",
        ),
    )
    require_text(
        ADMIN_PAGE,
        (
            "External Resource Readiness",
            "Stage1ExternalResourceGroup",
            "resourceReadiness",
            "operatorHandoff",
            "Operator Handoff",
            "isolated staging",
            "not production server access",
            "currentBlocker",
            "Current Blocker",
            "stage1-external-resource-readiness.preflight.json",
            "generate_stage1_external_resource_readiness.py",
            "validate_stage1_external_resource_readiness.py --allow-preflight",
        ),
    )
    require_text(
        ADMIN_API,
        (
            "ops/evidence/release/staging/stage1-external-resource-readiness.preflight.json",
            "ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json",
            "validate_stage1_r2_bucket_readiness.py --allow-preflight",
            "mapStage1ExternalResourceReadiness",
            "mapStage1ExternalResourceHandoff",
            "missingStage1ExternalResourceHandoff",
            "missingStage1ExternalResourceReadiness",
            "missingInputChecklistRef",
            "resourceReadiness",
            "Stage1ExternalResourceReadiness",
            "Stage1ExternalResourceGroup",
            "Stage1ExternalResourceHandoff",
            "operator_handoff",
            "operatorHandoff",
            "current_blocker",
            "currentBlocker",
            "missing_input_checklist_ref",
            "source_probe_runbook_ref",
        ),
    )
    require_text(
        ADMIN_TYPES,
        (
            "Stage1ExternalResourceReadiness",
            "Stage1ExternalResourceGroup",
            "Stage1ExternalResourceHandoff",
            "resourceReadiness",
            "operatorHandoff",
            "readyPercent",
            "operatorAsk",
            "currentBlocker",
            "missingInputChecklistRef",
        ),
    )
    require_text(
        RELEASE_READINESS_CONTRACT,
        (
            "external_resource_readiness",
            "stage1-external-resource-readiness.preflight.json",
            "generate_stage1_external_resource_readiness.py",
            "validate_stage1_external_resource_readiness.py --allow-preflight",
        ),
    )
    require_text(
        R2_READINESS_CONTRACT,
        (
            "stage1.r2_bucket_readiness.contract.v1",
            "stage1-r2-bucket-readiness.preflight.json",
            "zenari",
        ),
    )
    require_text(
        R2_READINESS_VALIDATOR,
        (
            "stage1.r2_bucket_readiness.preflight.v1",
            "validate_preflight",
        ),
    )
    require_text(
        RELEASE_READINESS_VALIDATOR,
        (
            "validate_stage1_external_resource_readiness.py",
            "stage1-external-resource-readiness.preflight.json",
            "External Resource Readiness",
        ),
    )
    require_text(
        ADMIN_TESTS,
        (
            "external_resource_readiness",
            "stage1-external-resource-readiness.preflight.json",
            "r2_bucket_readiness",
            "stage1-r2-bucket-readiness.preflight.json",
            "validate_stage1_r2_bucket_readiness.py",
            "generate_stage1_external_resource_readiness.py",
            "validate_stage1_external_resource_readiness.py",
            "External Resource Readiness",
            "Current Blocker",
            "currentBlocker",
            "missingInputChecklistRef",
            "production-missing-input-checklist.json",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/generate_stage1_external_resource_readiness.py",
            "test -x scripts/validate_stage1_external_resource_readiness.py",
            "python3 scripts/generate_stage1_external_resource_readiness.py --contract-only",
            "python3 scripts/validate_stage1_external_resource_readiness.py --contract-only",
            "python3 scripts/validate_stage1_external_resource_readiness.py --allow-preflight",
        ),
    )


def validate_preflight_evidence(data: dict[str, Any]) -> None:
    assert_no_secret(data, "preflight")
    require(data.get("schema_version") == "stage1.external_resource_readiness.preflight.v1", "preflight schema_version mismatch")
    require(data.get("kind") == "stage1_external_resource_readiness_preflight", "preflight kind mismatch")
    require(data.get("environment") == "release", "preflight environment mismatch")
    require(data.get("status") == "blocked", "preflight status must be blocked")
    require(data.get("release_gate_decision") == "no_go", "preflight release gate decision must be no_go")
    require(data.get("canonical_pass_path") is False, "preflight canonical_pass_path must be false")
    require(data.get("can_clear_stage1_staging_runtime_gate") is False, "preflight cannot clear Stage 1 staging runtime")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "preflight cannot clear Stage 1 production launch")
    require(data.get("can_close_do_not_launch") is False, "preflight cannot close DNL")
    safe_policy = data.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "preflight safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(safe_policy.get(field) is False, f"preflight.safe_projection_policy.{field} must be false")
        require(data.get(field) is False, f"preflight.{field} must be false")
    source = data.get("source_aggregates")
    require(isinstance(source, dict), "source_aggregates must be object")
    require(isinstance(source.get("staging_runtime"), dict), "source_aggregates.staging_runtime missing")
    require(isinstance(source.get("production_launch"), dict), "source_aggregates.production_launch missing")
    require(isinstance(source.get("r2_bucket_readiness"), dict), "source_aggregates.r2_bucket_readiness missing")
    require(isinstance(source.get("ci_exact_preflight"), dict), "source_aggregates.ci_exact_preflight missing")
    require(isinstance(source.get("llm_openai_compatible_selftest"), dict), "source_aggregates.llm_openai_compatible_selftest missing")
    require(isinstance(source["r2_bucket_readiness"].get("path"), str) and source["r2_bucket_readiness"].get("path"), "source_aggregates.r2_bucket_readiness path missing")
    require(
        source["r2_bucket_readiness"].get("canonical_path") == "ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json",
        "source_aggregates.r2_bucket_readiness canonical path mismatch",
    )
    require(
        str(source["ci_exact_preflight"].get("path", "")).endswith("stage1-ci-exact.preflight.json"),
        "source_aggregates.ci_exact_preflight path mismatch",
    )
    require(
        str(source["llm_openai_compatible_selftest"].get("path", "")).endswith("openai-compatible-provider-selftest.json"),
        "source_aggregates.llm_openai_compatible_selftest path mismatch",
    )
    rows = data.get("resource_groups")
    require(isinstance(rows, list), "resource_groups must be list")
    require(len(rows) == len(EXPECTED_RESOURCE_IDS), "resource_groups length mismatch")
    seen: list[str] = []
    production_source_probe_requirements = data.get("production_source_probe_requirements")
    require(isinstance(production_source_probe_requirements, list), "production_source_probe_requirements must be list")
    validate_production_source_probe_requirements(production_source_probe_requirements, "production_source_probe_requirements")
    validate_non_clearing_refresh_summary(
        data.get("non_clearing_refresh_summary"),
        "non_clearing_refresh_summary",
    )
    for idx, row in enumerate(rows):
        require(isinstance(row, dict), f"resource_groups[{idx}] must be object")
        require(REQUIRED_ROW_FIELDS <= set(row), f"resource_groups[{idx}] missing required fields")
        resource_id = row.get("resource_id")
        require(resource_id == EXPECTED_RESOURCE_IDS[idx], f"resource_groups[{idx}] resource order mismatch")
        seen.append(str(resource_id))
        require(row.get("lane") in {"provider", "staging", "ci", "production"}, f"resource_groups[{idx}] lane mismatch")
        require(row.get("status") in {"ready", "provided_unverified", "blocked", "missing"}, f"resource_groups[{idx}] status mismatch")
        for field in REQUIRED_ROW_FIELDS - {"evidence_refs"}:
            require(isinstance(row.get(field), str) and row.get(field).strip(), f"resource_groups[{idx}].{field} must be non-empty string")
        require(isinstance(row.get("evidence_refs"), list) and row.get("evidence_refs"), f"resource_groups[{idx}].evidence_refs must be non-empty list")
        if resource_id == "llm_zai_openai_compatible":
            refs = set(row.get("evidence_refs") or [])
            require(
                "ops/evidence/staging/openai-compatible-provider-selftest.json" in refs,
                "llm_zai_openai_compatible must reference direct OpenAI-compatible provider selftest evidence",
            )
            require(
                row.get("validator") == "bash scripts/openai_compatible_provider_selftest.sh --output ops/evidence/staging/openai-compatible-provider-selftest.json",
                "llm_zai_openai_compatible validator mismatch",
            )
            if row.get("status") == "ready":
                signal = str(row.get("validation_signal", ""))
                require(
                    "direct OpenAI-compatible glm-5.2 live selftest exact pass" in signal
                    or "provider_sandbox component exact evidence pass" in signal,
                    "llm_zai_openai_compatible ready row must cite direct LLM selftest or provider sandbox exact pass",
                )
                require(
                    "No operator input needed" in str(row.get("operator_ask")),
                    "llm_zai_openai_compatible ready row must not ask for additional LLM credentials",
                )
        if resource_id == "r2_zenari_bucket":
            refs = set(row.get("evidence_refs") or [])
            require("ops/evidence/release/staging/stage1-r2-bucket-readiness.preflight.json" in refs, "r2_zenari_bucket must reference R2 readiness preflight")
            require(row.get("validator") == "python3 scripts/validate_stage1_r2_bucket_readiness.py --allow-preflight", "r2_zenari_bucket validator mismatch")
            if row.get("status") == "ready":
                require(
                    "R2 bucket readiness" in str(row.get("validation_signal")),
                    "r2_zenari_bucket ready status must be based on R2 bucket readiness preflight",
                )
                require(
                    "No R2 bucket credential input needed" in str(row.get("operator_ask")),
                    "r2_zenari_bucket ready row must not ask for Cloudflare/R2 credentials",
                )
                require(
                    "strict staging object retention probes" in str(row.get("next_action"))
                    and "canonical object-storage-retention-cleanup evidence" in str(row.get("next_action")),
                    "r2_zenari_bucket ready row must point to strict object-retention evidence follow-up",
                )
            else:
                blocker = str(row.get("current_blocker", ""))
                require(
                    "s3_" in blocker
                    or "R2 bucket readiness preflight" in blocker
                    or "OBJECT_STORAGE_" in blocker
                    or "not reported" in blocker,
                    "r2_zenari_bucket must surface R2/S3 readiness blocker",
                )
                require(
                    "http_status=" in blocker
                    or "missing or invalid" in blocker
                    or "incomplete or invalid" in blocker
                    or "OBJECT_STORAGE_" in blocker
                    or "not reported" in blocker,
                    "r2_zenari_bucket must include actionable HTTP status or missing-preflight reason when blocked",
                )
        if resource_id == "ci_exact_artifacts" and row.get("status") != "ready":
            blocker = str(row.get("current_blocker", ""))
            require(
                "ci_exact_preflight" in blocker or "ci_exact_artifacts" in blocker,
                "ci_exact_artifacts must surface CI exact preflight or artifact SHA blocker",
            )
            require(
                "blocked_checks=" in blocker
                or "missing or invalid" in blocker
                or "ready - trigger" in blocker
                or "fetch current GitHub Actions artifacts" in blocker,
                "ci_exact_artifacts blocker must include actionable CI preflight detail",
            )
        if resource_id == "staging_public_urls" and row.get("status") == "missing":
            blocker = str(row.get("current_blocker", ""))
            require("STAGING_API_URL" in blocker and "STAGING_WEB_URL" in blocker and "STAGING_ADMIN_URL" in blocker, "staging_public_urls missing row must name required URL variables")
            require("non-local HTTPS" in blocker, "staging_public_urls missing row must require non-local HTTPS URLs")
        if resource_id == "staging_admin_access" and row.get("status") == "missing":
            blocker = str(row.get("current_blocker", ""))
            require("ADMIN_BEARER_TOKEN" in blocker and "SMOKE_ADMIN_USER_ID" in blocker and "SMOKE_ADMIN_TENANT_ID" in blocker and "CSRF_ORIGIN" in blocker, "staging_admin_access missing row must name required admin probe variables")
        if resource_id == "staging_quota_replay_db" and row.get("status") == "missing":
            blocker = str(row.get("current_blocker", ""))
            require(
                "STAGING_DATABASE_URL" in blocker
                and "STAGING_QUOTA_REPLAY_TENANT_ID" in blocker
                and "STAGING_QUOTA_REPLAY_BATCH_ID" in blocker
                and "STAGING_API_URL or STAGING_QUOTA_REPLAY_API_URL" in blocker,
                "staging_quota_replay_db missing row must name required quota replay variables and API URL fallback",
            )
        if resource_id == "staging_quota_replay_db" and row.get("status") == "blocked":
            blocker = str(row.get("current_blocker", ""))
            require(
                "STAGING_DATABASE_URL" in blocker
                and "STAGING_API_URL or STAGING_QUOTA_REPLAY_API_URL" in blocker
                and "non-local Postgres" in blocker
                and "non-local HTTPS" in blocker,
                "staging_quota_replay_db blocked row must name production-like DB/API requirements",
            )
            require(
                "database_issues=" in blocker and "api_issues=" in blocker,
                "staging_quota_replay_db blocked row must include redacted input issue summaries",
            )
        if resource_id == "staging_quota_replay_db" and row.get("status") == "ready":
            refs = set(row.get("evidence_refs") or [])
            require(
                "ops/evidence/staging/stage1-quota-replay.json" in refs
                and "ops/evidence/staging/stage1-quota-replay.ndjson" in refs,
                "staging_quota_replay_db ready row must reference strict quota replay evidence",
            )
            require(
                "staging_quota_replay component exact evidence pass" in str(row.get("validation_signal")),
                "staging_quota_replay_db ready row must cite exact quota replay component evidence",
            )
            require(
                "No quota replay DB input needed" in str(row.get("operator_ask")),
                "staging_quota_replay_db ready row must not ask for DB inputs after canonical evidence is strict-pass",
            )
        if resource_id == "production_launch_inputs" and row.get("status") == "missing":
            blocker = str(row.get("current_blocker", ""))
            require(
                "missing_source_probes" in blocker
                and "billing-paid-lifecycle-source.json" in blocker
                and "production-security-launch-source.json" in blocker
                and "production-legal-support-source.json" in blocker
                and "production-governance-release-source.json" in blocker,
                "production_launch_inputs missing row must name exact production source probes",
            )
        if resource_id == "production_launch_inputs":
            row_probe_requirements = row.get("source_probe_requirements")
            require(isinstance(row_probe_requirements, list), "production_launch_inputs.source_probe_requirements must be list")
            validate_production_source_probe_requirements(row_probe_requirements, "production_launch_inputs.source_probe_requirements")
        if row.get("status") == "ready":
            provided_signal = str(row.get("provided_signal", "")).strip()
            validation_signal = str(row.get("validation_signal", "")).strip().lower()
            if resource_id != "staging_quota_replay_db":
                require(not re.match(r"^0/\d+", provided_signal), f"resource_groups[{idx}] ready row has zero provided inputs")
            else:
                require(
                    not re.match(r"^0/\d+", provided_signal)
                    or "canonical quota replay exact evidence present" in provided_signal,
                    "staging_quota_replay_db ready row must have inputs or canonical exact evidence",
                )
            require(
                (("exact" in validation_signal and "pass" in validation_signal) or "strict pass" in validation_signal),
                f"resource_groups[{idx}] ready row lacks strict/exact pass validation signal",
            )
        if row.get("resource_id") == "staging_admin_access" and row.get("status") == "ready":
            require(
                not str(row.get("provided_signal", "")).strip().startswith("0/4"),
                "staging_admin_access cannot be ready without admin access inputs",
            )
    require(seen == EXPECTED_RESOURCE_IDS, "resource ids mismatch")
    handoff = data.get("operator_handoff")
    require(isinstance(handoff, dict), "operator_handoff must be object")
    require(handoff.get("status") == "blocked", "operator_handoff status must remain blocked")
    require(handoff.get("non_clearing_preflight") is True, "operator_handoff must be marked non-clearing")
    loop_breaker = str(handoff.get("current_loop_breaker", ""))
    require("R2" in loop_breaker and "Stripe sandbox" in loop_breaker and "z.ai glm-5.2" in loop_breaker, "operator_handoff must record cleared R2/Stripe/GLM resources")
    if "staging evidence inputs/artifacts" in loop_breaker:
        require(
            "Azure origin reachability" in loop_breaker and "production loop is source probes" in loop_breaker,
            "operator_handoff staging-artifact wording must preserve Azure origin and production source-probe blockers",
        )
    missing_variables = handoff.get("missing_variables")
    require(isinstance(missing_variables, list), "operator_handoff.missing_variables must be list")
    require(
        handoff.get("input_packet_ref") == "ops/evidence/non_clearing/production-launch-input-packet.json",
        "operator_handoff.input_packet_ref mismatch",
    )
    require(
        handoff.get("operator_brief_ref") == "ops/evidence/non_clearing/production-launch-operator-brief.json",
        "operator_handoff.operator_brief_ref mismatch",
    )
    require(
        handoff.get("missing_input_checklist_ref") == "ops/evidence/non_clearing/production-missing-input-checklist.json",
        "operator_handoff.missing_input_checklist_ref mismatch",
    )
    require(
        handoff.get("source_probe_runbook_ref") == "ops/evidence/non_clearing/production-source-probe-runbook.json",
        "operator_handoff.source_probe_runbook_ref mismatch",
    )
    resource_status = handoff.get("resource_status")
    require(isinstance(resource_status, dict), "operator_handoff.resource_status must be object")
    if resource_status.get("staging_public_urls") == "missing":
        for variable in ("STAGING_API_URL", "STAGING_WEB_URL", "STAGING_ADMIN_URL"):
            require(variable in missing_variables, f"operator_handoff missing {variable}")
    if resource_status.get("staging_admin_access") == "missing":
        for variable in ("SMOKE_ADMIN_USER_ID", "SMOKE_ADMIN_TENANT_ID", "CSRF_ORIGIN"):
            require(variable in missing_variables, f"operator_handoff missing {variable}")
        require(
            any("ADMIN_BEARER_TOKEN" in str(variable) and "ADMIN_SESSION_COOKIE" in str(variable) for variable in missing_variables),
            "operator_handoff must name admin bearer/session/local bootstrap when admin auth is missing",
        )
    if resource_status.get("staging_quota_replay_db") == "missing":
        for variable in ("STAGING_DATABASE_URL", "STAGING_QUOTA_REPLAY_TENANT_ID", "STAGING_QUOTA_REPLAY_BATCH_ID"):
            require(variable in missing_variables, f"operator_handoff missing {variable}")
    require(
        "STAGING_QUOTA_REPLAY_API_URL" not in missing_variables,
        "operator_handoff should not require STAGING_QUOTA_REPLAY_API_URL when STAGING_API_URL can be reused",
    )
    production_only_remaining = (
        resource_status.get("production_launch_inputs") == "missing"
        and resource_status.get("staging_public_urls") == "ready"
        and resource_status.get("staging_admin_access") == "ready"
        and resource_status.get("staging_quota_replay_db") == "ready"
        and resource_status.get("ci_exact_artifacts") == "ready"
    )
    if production_only_remaining:
        require("production source probes only" in loop_breaker, "operator_handoff must identify final production source probes")
    else:
        require("remaining non-ready resources" in loop_breaker, "operator_handoff must dynamically list non-ready resources")
        if resource_status.get("staging_public_urls") == "ready":
            require("deployed staging HTTPS URLs" not in loop_breaker, "loop breaker must not list ready staging public URLs")
        if resource_status.get("staging_admin_access") == "ready":
            require("staging admin authenticated probes" not in loop_breaker, "loop breaker must not list ready staging admin access")
        if resource_status.get("staging_quota_replay_db") == "ready":
            require("staging quota replay inputs/evidence" not in loop_breaker, "loop breaker must not list ready quota replay")
        if resource_status.get("ci_exact_artifacts") != "ready":
            require("current-SHA exact CI artifacts" in loop_breaker, "loop breaker must list non-ready CI exact artifacts")
        if resource_status.get("production_launch_inputs") != "ready":
            require("production source probes" in loop_breaker, "loop breaker must list non-ready production source probes")
    if production_only_remaining:
        require(
            any("PRODUCTION_LAUNCH_INPUT_PACKET" in str(variable) for variable in missing_variables),
            "operator_handoff must point to production launch input packet",
        )
        require(
            any("PRODUCTION_LAUNCH_OPERATOR_BRIEF" in str(variable) for variable in missing_variables),
            "operator_handoff must point to production launch operator brief",
        )
        require(
            any("PRODUCTION_MISSING_INPUT_CHECKLIST" in str(variable) for variable in missing_variables),
            "operator_handoff must point to production missing-input checklist",
        )
        require(
            any("PRODUCTION_SOURCE_PROBE_RUNBOOK" in str(variable) for variable in missing_variables),
            "operator_handoff must point to production source probe runbook",
        )
    resource_classes = handoff.get("resource_classes")
    require(isinstance(resource_classes, list), "operator_handoff.resource_classes must be list")
    require(
        (
            any("GitHub Actions run URL" in str(item) for item in resource_classes)
            and any("Stripe live/test separation evidence" in str(item) for item in resource_classes)
        )
        or (
            any("production source probe JSON files" in str(item) for item in resource_classes)
            and any("Stripe live-mode billing lifecycle evidence" in str(item) for item in resource_classes)
        ),
        "operator_handoff must name either CI/staging resource classes or final production source classes",
    )
    handoff_probe_requirements = handoff.get("production_source_probe_requirements")
    require(isinstance(handoff_probe_requirements, list), "operator_handoff.production_source_probe_requirements must be list")
    validate_production_source_probe_requirements(handoff_probe_requirements, "operator_handoff.production_source_probe_requirements")
    validate_non_clearing_refresh_summary(
        handoff.get("non_clearing_refresh_summary"),
        "operator_handoff.non_clearing_refresh_summary",
    )
    commands = handoff.get("commands_after_inputs")
    require(isinstance(commands, list), "operator_handoff.commands_after_inputs must be list")
    for command in (
        "python3 scripts/generate_stage1_external_resource_readiness.py",
        "WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE=1 scripts/staging_object_storage_retention_cleanup_smoke.sh",
        "python3 scripts/fetch_stage1_ci_artifacts.py --run-url <github-actions-run-url>",
        "python3 scripts/stage1_production_source_probe.py --billing --release-sha $(git rev-parse HEAD) --billing-proof <sanitized-live-billing-proof.json> --write-canonical-source",
        "python3 scripts/stage1_production_source_probe.py --legal-support --release-sha $(git rev-parse HEAD) --production-web-url https://zenari.ai --write-canonical-source",
        "python3 scripts/validate_stage1_staging_runtime.py",
        "python3 scripts/validate_stage1_production_launch.py",
    ):
        require(command in commands, f"operator_handoff missing command {command}")
    for resource_id in ("staging_public_urls", "staging_admin_access", "staging_quota_replay_db", "ci_exact_artifacts", "production_launch_inputs"):
        require(resource_id in resource_status, f"operator_handoff.resource_status missing {resource_id}")
    summary = data.get("resource_summary")
    require(isinstance(summary, dict), "resource_summary must be object")
    total = summary.get("total")
    ready = summary.get("ready")
    provided_unverified = summary.get("provided_unverified")
    blocked = summary.get("blocked")
    missing = summary.get("missing")
    require(total == len(EXPECTED_RESOURCE_IDS), "resource_summary total mismatch")
    require(isinstance(ready, int), "resource_summary ready must be int")
    require(isinstance(provided_unverified, int), "resource_summary provided_unverified must be int")
    require(isinstance(blocked, int), "resource_summary blocked must be int")
    require(isinstance(missing, int), "resource_summary missing must be int")
    require(ready + provided_unverified + blocked + missing == total, "resource_summary counts do not add up")
    require(isinstance(summary.get("ready_percent"), (int, float)), "resource_summary ready_percent must be numeric")
    require(0 <= float(summary.get("ready_percent")) <= 100, "resource_summary ready_percent out of range")
    blockers = data.get("blockers")
    require(isinstance(blockers, list), "blockers must be list")
    require(len(blockers) == total - ready, "blockers must enumerate non-ready resources")
    strict_required = set(data.get("strict_launch_evidence_required") or [])
    require("python3 scripts/validate_stage1_staging_runtime.py" in strict_required, "strict launch evidence must include staging runtime")
    require("python3 scripts/validate_stage1_production_launch.py" in strict_required, "strict launch evidence must include production launch")
    require("python3 scripts/validate_stage1_ci_exact_evidence.py" in strict_required, "strict launch evidence must include CI exact evidence")


def validate_non_clearing_refresh_summary(value: Any, label: str) -> None:
    require(isinstance(value, dict), f"{label} must be object")
    require(
        value.get("path") == "ops/evidence/non_clearing/production-non-clearing-refresh.json",
        f"{label}.path mismatch",
    )
    require(value.get("status") in {"blocked", "pass", "failed", "missing"}, f"{label}.status mismatch")
    step_summary = value.get("step_summary")
    require(isinstance(step_summary, dict), f"{label}.step_summary must be object")
    for key in ("total", "passed", "blocked", "failed"):
        require(isinstance(step_summary.get(key), int), f"{label}.step_summary.{key} must be int")
    stage1 = value.get("stage1_progress")
    require(isinstance(stage1, dict), f"{label}.stage1_progress must be object")
    for key in ("completed", "total", "completion_percent"):
        require(isinstance(stage1.get(key), (int, float)), f"{label}.stage1_progress.{key} must be numeric")
    production_inputs = value.get("production_input_progress")
    require(isinstance(production_inputs, dict), f"{label}.production_input_progress must be object")
    for key in ("configured", "total", "completion_percent"):
        require(isinstance(production_inputs.get(key), (int, float)), f"{label}.production_input_progress.{key} must be numeric")
    details = value.get("blocked_evidence_details")
    require(isinstance(details, list), f"{label}.blocked_evidence_details must be list")
    if value.get("status") == "blocked":
        require(len(details) >= 3, f"{label}.blocked_evidence_details must include expected blocked refresh steps")
    by_step: dict[str, dict[str, Any]] = {}
    for idx, item in enumerate(details):
        require(isinstance(item, dict), f"{label}.blocked_evidence_details[{idx}] must be object")
        step_id = item.get("step_id")
        require(isinstance(step_id, str) and step_id.strip(), f"{label}.blocked_evidence_details[{idx}].step_id missing")
        require(isinstance(item.get("source"), str) and item.get("source").strip(), f"{label}.blocked_evidence_details[{idx}].source missing")
        detail = item.get("detail")
        require(isinstance(detail, str) and detail.strip(), f"{label}.blocked_evidence_details[{idx}].detail missing")
        require(not detail.startswith("wrote Stage 1"), f"{label}.blocked_evidence_details[{idx}].detail must not be stdout-only")
        by_step[step_id] = item
    if value.get("status") == "blocked":
        expected = {
            "production_dns_readiness": "ops/evidence/non_clearing/production-dns-readiness.json",
            "production_dns_cutover_plan": "ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "production_proof_bundle": "ops/evidence/non_clearing/production-proof-bundle.json",
        }
        for step_id, source in expected.items():
            require(step_id in by_step, f"{label} missing blocked detail for {step_id}")
            require(by_step[step_id].get("source") == source, f"{label}.{step_id} source mismatch")


def validate_production_source_probe_requirements(items: list[Any], label: str) -> None:
    require(len(items) == len(EXPECTED_PRODUCTION_SOURCE_PROBES), f"{label} length mismatch")
    for idx, expected in enumerate(EXPECTED_PRODUCTION_SOURCE_PROBES):
        item = items[idx]
        require(isinstance(item, dict), f"{label}[{idx}] must be object")
        require(item.get("probe_id") == expected["probe_id"], f"{label}[{idx}] probe_id mismatch")
        require(item.get("path") == expected["path"], f"{label}[{idx}] path mismatch")
        require(item.get("diagnostic_path") == expected["diagnostic_path"], f"{label}[{idx}] diagnostic_path mismatch")
        require(item.get("schema_version") == expected["schema_version"], f"{label}[{idx}] schema_version mismatch")
        require(item.get("status") in {"missing", "present"}, f"{label}[{idx}] status mismatch")
        require(isinstance(item.get("source_probe_exists"), bool), f"{label}[{idx}] source_probe_exists must be bool")
        require(isinstance(item.get("reported_by_production_aggregate"), bool), f"{label}[{idx}] reported_by_production_aggregate must be bool")
        require(str(item.get("current_blocker", "")).strip(), f"{label}[{idx}] current_blocker missing")
        supporting = item.get("supporting_diagnostics", [])
        require(isinstance(supporting, list), f"{label}[{idx}] supporting_diagnostics must be list")
        for supporting_idx, supporting_item in enumerate(supporting):
            require(isinstance(supporting_item, dict), f"{label}[{idx}] supporting_diagnostics[{supporting_idx}] must be object")
            require(isinstance(supporting_item.get("path"), str) and supporting_item.get("path").strip(), f"{label}[{idx}] supporting_diagnostics[{supporting_idx}].path missing")
            require(isinstance(supporting_item.get("status"), str) and supporting_item.get("status").strip(), f"{label}[{idx}] supporting_diagnostics[{supporting_idx}].status missing")
            require(isinstance(supporting_item.get("first_blocker"), str) and supporting_item.get("first_blocker").strip(), f"{label}[{idx}] supporting_diagnostics[{supporting_idx}].first_blocker missing")
        if expected["probe_id"] == "production_legal_support_policy":
            require(
                any(item.get("path") == "ops/evidence/non_clearing/production-dns-readiness.json" for item in supporting),
                f"{label}[{idx}] legal/support must include production DNS readiness supporting diagnostic",
            )
        diagnostic = item.get("diagnostic")
        require(isinstance(diagnostic, dict), f"{label}[{idx}] diagnostic must be object")
        require(diagnostic.get("path") == expected["diagnostic_path"], f"{label}[{idx}] diagnostic.path mismatch")
        require(diagnostic.get("status") in {"missing", "blocked"}, f"{label}[{idx}] diagnostic.status mismatch")
        require(isinstance(diagnostic.get("canonical_source_written"), bool), f"{label}[{idx}] diagnostic canonical_source_written must be bool")
        require(isinstance(diagnostic.get("first_blocker"), str) and diagnostic.get("first_blocker").strip(), f"{label}[{idx}] diagnostic.first_blocker missing")
        require(isinstance(diagnostic.get("blocker_count"), int), f"{label}[{idx}] diagnostic.blocker_count must be int")
        if "blockers" in diagnostic:
            blockers = diagnostic.get("blockers")
            require(isinstance(blockers, list), f"{label}[{idx}] diagnostic.blockers must be list")
            require(len(blockers) <= 6, f"{label}[{idx}] diagnostic.blockers must be capped")
            for blocker_idx, blocker in enumerate(blockers):
                require(isinstance(blocker, str) and blocker.strip(), f"{label}[{idx}] diagnostic.blockers[{blocker_idx}] must be non-empty string")
        require(str(item.get("generator", "")).startswith("python3 scripts/generate_stage1_production_"), f"{label}[{idx}] generator mismatch")
        require(str(item.get("strict_validator", "")).startswith("python3 scripts/validate_stage1_production_"), f"{label}[{idx}] strict_validator mismatch")
        if item.get("status") == "missing":
            require(
                str(item.get("current_blocker")).startswith(f"source_probe_missing: {expected['path']}"),
                f"{label}[{idx}] missing current_blocker mismatch",
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate Stage 1 external resource readiness")
    parser.add_argument("--contract-only", action="store_true", help="validate local contract and code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing external resource readiness preflight")
    parser.add_argument("--evidence", type=Path, default=DEFAULT_EVIDENCE)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract_fixture()
        validate_code_anchors()
        if args.contract_only:
            print("stage1 external resource readiness contract validation passed")
            return 0
        data = load_json(args.evidence)
        if not args.allow_preflight:
            raise ExternalResourceReadinessContractError(
                "strict mode rejects external resource readiness preflight; use --allow-preflight for non-clearing diagnostics"
            )
        validate_preflight_evidence(data)
    except ExternalResourceReadinessContractError as exc:
        print(f"stage1 external resource readiness validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 external resource readiness validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
