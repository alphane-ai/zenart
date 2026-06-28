#!/usr/bin/env python3
"""Generate non-clearing Stage 1 release evidence closure queue preflight.

The Admin release page already renders a prioritized evidence closure queue.
This script writes the same operator-facing queue as machine-readable JSON from
the current staging and production aggregate evidence. The output is a
diagnostic preflight only: it cannot clear staging, production, CI, or
Do-Not-Launch gates.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "release_evidence_closure_queue" / "local_contract.json"
DEFAULT_STAGING = ROOT / "ops" / "evidence" / "staging" / "stage1-runtime.json"
DEFAULT_PRODUCTION = ROOT / "ops" / "evidence" / "production" / "stage1-production-launch.json"
DEFAULT_R2_READINESS = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-r2-bucket-readiness.preflight.json"
DEFAULT_CI_PREFLIGHT = ROOT / "ops" / "evidence" / "ci" / "stage1-ci-exact.preflight.json"
DEFAULT_CI_PR_MAIN = ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-pr-main-run.json"
DEFAULT_CI_PLAYWRIGHT = ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-playwright-smoke.json"
DEFAULT_CI_DOCKER = ROOT / "ops" / "evidence" / "ci" / "stage0-rev2-docker-image-build.json"
DEFAULT_AZURE_ORIGIN_READINESS = ROOT / "ops" / "evidence" / "staging" / "stage1-azure-origin-readiness.json"
DEFAULT_AZURE_RUN_COMMAND_DIAGNOSIS = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair-diagnosis.json"
DEFAULT_NEXT_BLOCKERS_SUMMARY = ROOT / "ops" / "evidence" / "non_clearing" / "stage1-next-blockers-summary.json"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-evidence-closure-queue.preflight.json"

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
    "download_url",
    "signed_url",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)


class ReleaseEvidenceClosureQueueError(Exception):
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
    except FileNotFoundError as exc:
        raise ReleaseEvidenceClosureQueueError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ReleaseEvidenceClosureQueueError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ReleaseEvidenceClosureQueueError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ReleaseEvidenceClosureQueueError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ReleaseEvidenceClosureQueueError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "preflight")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def release_bundle_preflight(staging: dict[str, Any], production: dict[str, Any]) -> dict[str, Any]:
    staging_preflight = staging.get("release_bundle_preflight")
    production_preflight = production.get("release_bundle_preflight")
    if isinstance(staging_preflight, dict):
        return staging_preflight
    if isinstance(production_preflight, dict):
        return production_preflight
    return {}


def aggregate_blockers(evidence: dict[str, Any], preflight: dict[str, Any]) -> list[str]:
    blockers = string_list(evidence.get("blockers"))
    blockers.extend(string_list(preflight.get("blocking_reasons")))
    blockers.extend(string_list(preflight.get("blockers")))
    return blockers


def first_matching_blocker(candidates: list[str], patterns: tuple[str, ...]) -> str:
    for candidate in candidates:
        if any(pattern in candidate for pattern in patterns):
            return candidate
    return "not reported by current aggregate"


def source_probe_missing_blocker(*refs: str) -> str:
    for ref in refs:
        data = load_optional_json(ROOT / ref)
        for blocker in string_list(data.get("blocked_checks")):
            if blocker.startswith("source_probe_missing:"):
                return blocker
    return ""


def load_optional_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def r2_bucket_blocker(r2_readiness: dict[str, Any]) -> str:
    if r2_readiness.get("schema_version") != "stage1.r2_bucket_readiness.preflight.v1":
        return "R2 bucket readiness preflight missing or invalid"
    readiness = r2_readiness.get("readiness")
    if r2_readiness.get("status") == "ready" and isinstance(readiness, dict) and readiness.get("r2_bucket_access_ready") is True:
        return (
            "R2 bucket access ready; object_retention_cleanup still needs canonical staging evidence "
            "ops/evidence/staging/object-storage-retention-cleanup.json from deployed admin probes"
        )
    blockers = string_list(r2_readiness.get("blockers"))
    for blocker in blockers:
        if "s3_put_object" in blocker or "s3_head_bucket" in blocker:
            return blocker
    return blockers[0] if blockers else "R2 bucket readiness preflight has no blocker details"


def ci_exact_blocker(ci_preflight: dict[str, Any], gate: str) -> str:
    ci_state = canonical_ci_state(ci_preflight)
    if ci_state.get("status") == "current_sha_pass":
        return f"{gate}: exact CI artifacts strict-pass for current release SHA; canonical evidence can close this CI row"
    if ci_state.get("status") == "old_sha_pass":
        return (
            f"{gate}: exact CI artifacts strict-pass for {ci_state.get('artifact_release_sha')}, "
            f"but current candidate is {ci_state.get('candidate_release_sha')}; fetch current GitHub Actions artifacts"
        )
    if ci_preflight.get("schema_version") != "stage1.ci_exact.preflight.v1":
        return f"{gate}: ci_exact_preflight missing or invalid - run python3 scripts/generate_stage1_ci_exact_preflight.py"
    blocked_checks = string_list(ci_preflight.get("blocked_checks"))
    if blocked_checks:
        return f"{gate}: ci_exact_preflight blocked_checks={','.join(blocked_checks[:6])}"
    if ci_preflight.get("status") == "ready":
        return f"{gate}: ci_exact_preflight ready - trigger GitHub Actions and fetch strict artifacts"
    return f"{gate}: ci_exact_preflight blocked - exact GitHub Actions artifact readiness not reported"


def canonical_ci_state(ci_preflight: dict[str, Any]) -> dict[str, str]:
    paths = [DEFAULT_CI_PR_MAIN, DEFAULT_CI_PLAYWRIGHT, DEFAULT_CI_DOCKER]
    artifacts = [load_optional_json(path) for path in paths]
    if not all(artifact.get("status") in {"pass", "passed"} for artifact in artifacts):
        return {"status": "missing_or_not_pass"}
    shas = {str(artifact.get("release_sha") or "") for artifact in artifacts}
    if len(shas) != 1:
        return {"status": "sha_mismatch"}
    artifact_sha = next(iter(shas))
    candidate = (
        ci_preflight.get("workflow_run_summary", {}).get("release_sha")
        if isinstance(ci_preflight.get("workflow_run_summary"), dict)
        else ""
    )
    candidate_sha = str(candidate or "")
    if artifact_sha and candidate_sha and artifact_sha == candidate_sha:
        return {"status": "current_sha_pass", "artifact_release_sha": artifact_sha, "candidate_release_sha": candidate_sha}
    if artifact_sha and candidate_sha and artifact_sha != candidate_sha:
        return {"status": "old_sha_pass", "artifact_release_sha": artifact_sha, "candidate_release_sha": candidate_sha}
    return {"status": "candidate_missing", "artifact_release_sha": artifact_sha, "candidate_release_sha": candidate_sha}


def aggregate_passed(evidence: dict[str, Any]) -> bool:
    return (
        evidence.get("status") in {"pass", "passed"}
        and evidence.get("release_gate_decision") == "go"
        and not string_list(evidence.get("blockers"))
        and not string_list(evidence.get("do_not_launch_conditions"))
    )


def readiness_passed(evidence: dict[str, Any], key: str) -> bool:
    readiness = evidence.get("runtime_input_readiness")
    return isinstance(readiness, dict) and readiness.get(key) is True


def closure_queue(
    staging: dict[str, Any],
    production: dict[str, Any],
    r2_readiness: dict[str, Any],
    ci_preflight: dict[str, Any],
) -> list[dict[str, str]]:
    preflight = release_bundle_preflight(staging, production)
    staging_blockers = aggregate_blockers(staging, preflight)
    production_blockers = aggregate_blockers(production, preflight)
    staging_runtime_passed = aggregate_passed(staging)
    quota_replay_passed = staging_runtime_passed or readiness_passed(staging, "quota_replay_ready")
    load_passed = staging_runtime_passed or readiness_passed(staging, "load_ready")
    object_retention_passed = staging_runtime_passed or readiness_passed(staging, "object_storage_ready")
    ci_artifacts_passed = canonical_ci_state(ci_preflight).get("status") == "current_sha_pass"
    provider_claims_passed = readiness_passed(production, "production_provider_ready_or_comp_only")
    backup_rollback_passed = (
        readiness_passed(production, "production_backup_restore_ready")
        and readiness_passed(production, "production_rollback_incident_smoke_ready")
    )
    return [
        {
            "priority": "P0",
            "lane": "staging",
            "row_status": "passed" if staging_runtime_passed else "open",
            "gate": "stage1_staging_runtime_preflight",
            "required_evidence": "ops/evidence/staging/stage1-runtime.json + .ndjson blocked aggregate diagnostic",
            "validator": "python3 scripts/validate_stage1_staging_runtime.py --allow-preflight",
            "generator": "python3 scripts/generate_stage1_staging_runtime_evidence.py writes blocked aggregate diagnostics until quota replay, object retention, and load canonical pass evidence exists; strict python3 scripts/validate_stage1_staging_runtime.py must still reject blocked aggregate evidence",
            "current_blocker": "stage1 staging runtime strict aggregate passed" if staging_runtime_passed else first_matching_blocker(staging_blockers, ("stage1_staging_runtime_evidence_incomplete", "missing canonical pass evidence", "strict child validator failed")),
            "dnl_impact": "no current DNL impact; strict staging runtime gate is go" if staging_runtime_passed else "does not clear staging or production launch; preserves stage1_staging_runtime_evidence_incomplete",
        },
        {
            "priority": "P0",
            "lane": "staging",
            "row_status": "passed" if quota_replay_passed else "open",
            "gate": "staging_quota_replay",
            "required_evidence": "ops/evidence/staging/stage1-quota-replay.json + .ndjson",
            "validator": "python3 scripts/validate_stage1_staging_quota_replay_evidence.py",
            "generator": "python3 scripts/generate_stage1_staging_quota_replay_evidence.py --preflight writes ops/evidence/staging/stage1-quota-replay.preflight.json, then python3 scripts/generate_stage1_staging_quota_replay_evidence.py",
            "current_blocker": "canonical staging quota replay evidence passed" if quota_replay_passed else first_matching_blocker(staging_blockers, ("stage1-quota-replay", "quota_replay")),
            "dnl_impact": "no current DNL impact; quota replay is verified by staging runtime aggregate" if quota_replay_passed else "keeps stage1_staging_runtime and release bundle preflight blocked",
        },
        {
            "priority": "P0",
            "lane": "staging",
            "row_status": "passed" if load_passed else "open",
            "gate": "stage1_load",
            "required_evidence": "ops/evidence/staging/stage1-load.json + .ndjson",
            "validator": "python3 scripts/validate_stage1_load_evidence.py",
            "generator": "LOAD_MODE=preflight_stage1 scripts/load_smoke.sh, then WRITE_CANONICAL_STAGE1_LOAD_EVIDENCE=1 LOAD_MODE=all scripts/load_smoke.sh",
            "current_blocker": "canonical Stage 1 load evidence passed" if load_passed else first_matching_blocker(staging_blockers, ("stage1_load", "stage1-load", "load_not_ready")),
            "dnl_impact": "no current DNL impact; OP-7 load is verified by staging runtime aggregate" if load_passed else "keeps OP-7 load and release bundle preflight blocked",
        },
        {
            "priority": "P0",
            "lane": "staging",
            "row_status": "passed" if object_retention_passed else "open",
            "gate": "object_retention_cleanup",
            "required_evidence": "ops/evidence/staging/object-storage-retention-cleanup.json + .ndjson",
            "validator": "python3 scripts/validate_stage1_staging_object_retention_evidence.py",
            "generator": "OBJECT_RETENTION_MODE=preflight_stage1 scripts/staging_object_storage_retention_cleanup_smoke.sh writes ops/evidence/staging/object-storage-retention-cleanup.preflight.json, then WRITE_CANONICAL_STAGE1_OBJECT_RETENTION_EVIDENCE=1 scripts/staging_object_storage_retention_cleanup_smoke.sh",
            "current_blocker": "canonical object retention cleanup evidence passed; R2 bucket access ready" if object_retention_passed else r2_bucket_blocker(r2_readiness),
            "dnl_impact": "no current DNL impact; object retention cleanup is verified by staging runtime aggregate" if object_retention_passed else "keeps private beta staging storage readiness blocked",
        },
        {
            "priority": "P0",
            "lane": "ci",
            "row_status": "passed" if ci_artifacts_passed else "open",
            "gate": "ci_pr_main_run",
            "required_evidence": "ops/evidence/ci/stage0-rev2-pr-main-run.json",
            "validator": "python3 scripts/validate_stage1_ci_exact_evidence.py",
            "generator": "python3 scripts/generate_stage1_ci_exact_preflight.py, then python3 scripts/fetch_stage1_ci_artifacts.py --run-url <github-actions-run-url> downloads artifacts, validates, and publishes canonical evidence",
            "current_blocker": ci_exact_blocker(ci_preflight, "ci_pr_main_run"),
            "dnl_impact": "no current DNL impact; exact CI PR/main evidence is strict-pass for current release SHA" if ci_artifacts_passed else "keeps CI gate and production launch blocked",
        },
        {
            "priority": "P0",
            "lane": "ci",
            "row_status": "passed" if ci_artifacts_passed else "open",
            "gate": "ci_playwright_smoke",
            "required_evidence": "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
            "validator": "python3 scripts/validate_stage1_ci_exact_evidence.py",
            "generator": "python3 scripts/generate_stage1_ci_exact_preflight.py, then python3 scripts/fetch_stage1_ci_artifacts.py --run-url <github-actions-run-url> downloads artifacts, validates, and publishes canonical evidence",
            "current_blocker": ci_exact_blocker(ci_preflight, "ci_playwright_smoke"),
            "dnl_impact": "no current DNL impact; exact CI Playwright evidence is strict-pass for current release SHA" if ci_artifacts_passed else "keeps browser smoke release coverage unverified",
        },
        {
            "priority": "P0",
            "lane": "ci",
            "row_status": "passed" if ci_artifacts_passed else "open",
            "gate": "ci_docker_image_build",
            "required_evidence": "ops/evidence/ci/stage0-rev2-docker-image-build.json",
            "validator": "python3 scripts/validate_stage1_ci_exact_evidence.py",
            "generator": "python3 scripts/generate_stage1_ci_exact_preflight.py, then python3 scripts/fetch_stage1_ci_artifacts.py --run-url <github-actions-run-url> downloads artifacts, validates, and publishes canonical evidence",
            "current_blocker": ci_exact_blocker(ci_preflight, "ci_docker_image_build"),
            "dnl_impact": "no current DNL impact; exact CI Docker image evidence is strict-pass for current release SHA" if ci_artifacts_passed else "keeps production image build evidence incomplete",
        },
        {
            "priority": "P0",
            "lane": "production",
            "row_status": "open",
            "gate": "stage1_production_launch_preflight",
            "required_evidence": "ops/evidence/production/stage1-production-launch.json + .ndjson blocked aggregate diagnostic",
            "validator": "python3 scripts/validate_stage1_production_launch.py --allow-preflight",
            "generator": "python3 scripts/generate_stage1_production_launch_evidence.py writes blocked aggregate diagnostics until CI, strict staging, release bundle, and production child evidence are all canonical pass; strict python3 scripts/validate_stage1_production_launch.py must still reject blocked aggregate evidence",
            "current_blocker": first_matching_blocker(production_blockers, ("stage1_production_launch_evidence_incomplete", "missing CI evidence", "release_bundle", "strict child validator failed")),
            "dnl_impact": "does not clear production launch; preserves stage1_production_launch_evidence_incomplete",
        },
        {
            "priority": "P1",
            "lane": "production",
            "row_status": "passed" if backup_rollback_passed else "open",
            "gate": "production_backup_rollback_split",
            "required_evidence": "ops/evidence/production/backup-restore.json + rollback-incident-post-deploy-smoke.json",
            "validator": "python3 scripts/validate_stage1_production_backup_rollback_evidence.py",
            "generator": "scripts/production_backup_rollback_split_smoke.sh writes production_backup_rollback_split_preflight at ops/evidence/production/backup-rollback-split.blocked.json, then python3 scripts/generate_stage1_production_backup_rollback_evidence.py writes canonical production split evidence after CI and staging gates are go",
            "current_blocker": "canonical production backup/rollback split evidence passed" if backup_rollback_passed else first_matching_blocker(production_blockers, ("production_backup", "production_rollback", "backup_restore", "rollback")),
            "dnl_impact": "no current DNL impact; backup/rollback split evidence is verified" if backup_rollback_passed else "cannot pass until CI and private beta staging are already go",
        },
        {
            "priority": "P1",
            "lane": "production",
            "row_status": "passed" if provider_claims_passed else "open",
            "gate": "production_provider_claims",
            "required_evidence": "ops/evidence/production/provider-mode.json + public-paid-real-generation-claims.json",
            "validator": "python3 scripts/validate_stage1_production_provider_claims_evidence.py",
            "generator": "python3 scripts/generate_stage1_production_provider_claims_evidence.py writes blocked diagnostics accepted by --allow-preflight until production provider/claims source evidence exists",
            "current_blocker": "canonical production provider/claims invite-comp-only evidence passed" if provider_claims_passed else first_matching_blocker(production_blockers, ("provider_claims", "provider_or_comp", "provider-mode", "public-paid-real-generation-claims")),
            "dnl_impact": "no current DNL impact; provider/claims component is verified" if provider_claims_passed else "keeps provider/claims production component and aggregate launch blocked",
        },
        {
            "priority": "P1",
            "lane": "production",
            "row_status": "open",
            "gate": "production_paid_billing_lifecycle",
            "required_evidence": "ops/evidence/production/billing-lifecycle.json + billing-refund-credit-webhook.json",
            "validator": "python3 scripts/validate_stage1_production_billing_evidence.py",
            "generator": "python3 scripts/generate_stage1_production_billing_evidence.py writes blocked diagnostics accepted by --allow-preflight until production Stripe live-mode source evidence exists",
            "current_blocker": source_probe_missing_blocker(
                "ops/evidence/production/billing-lifecycle.json",
                "ops/evidence/production/billing-refund-credit-webhook.json",
            )
            or first_matching_blocker(production_blockers, ("paid_billing", "billing-lifecycle", "billing-refund", "production_billing")),
            "dnl_impact": "keeps paid billing lifecycle and production launch blocked",
        },
        {
            "priority": "P1",
            "lane": "production",
            "row_status": "open",
            "gate": "production_security_launch_checks",
            "required_evidence": "ops/evidence/production/20260527T1700Z-security-launch-checks.json",
            "validator": "python3 scripts/validate_stage1_production_security_launch_evidence.py",
            "generator": "python3 scripts/generate_stage1_production_security_launch_evidence.py writes blocked diagnostics accepted by --allow-preflight until production security source evidence exists",
            "current_blocker": source_probe_missing_blocker("ops/evidence/production/20260527T1700Z-security-launch-checks.json")
            or first_matching_blocker(production_blockers, ("security_launch", "security_privacy", "secret_exposure", "production_security")),
            "dnl_impact": "keeps production security launch checks and aggregate launch blocked",
        },
        {
            "priority": "P1",
            "lane": "production",
            "row_status": "open",
            "gate": "production_legal_support_policy",
            "required_evidence": "ops/evidence/production/public-legal-policy.json + public-support-billing-policy.json",
            "validator": "python3 scripts/validate_stage1_production_legal_support_evidence.py",
            "generator": "python3 scripts/generate_stage1_production_legal_support_evidence.py writes blocked diagnostics accepted by --allow-preflight until production legal/support source evidence exists",
            "current_blocker": source_probe_missing_blocker(
                "ops/evidence/production/public-legal-policy.json",
                "ops/evidence/production/public-support-billing-policy.json",
            )
            or first_matching_blocker(production_blockers, ("legal_support_policy", "public_legal_support", "public-legal-policy", "public-support-billing-policy")),
            "dnl_impact": "keeps legal/support policy and production launch blocked",
        },
        {
            "priority": "P2",
            "lane": "production",
            "row_status": "open",
            "gate": "production_governance_release",
            "required_evidence": "ops/evidence/production/20260527T1430Z-activation-review-audit.json + 20260527T1330Z-abuse-throttle-hold.json + 20260527T1600Z-skill-release-eval-canary.json",
            "validator": "python3 scripts/validate_stage1_production_governance_release_evidence.py",
            "generator": "python3 scripts/generate_stage1_production_governance_release_evidence.py writes blocked diagnostics accepted by --allow-preflight until production governance/release source evidence exists",
            "current_blocker": source_probe_missing_blocker(
                "ops/evidence/production/20260527T1430Z-activation-review-audit.json",
                "ops/evidence/production/20260527T1330Z-abuse-throttle-hold.json",
                "ops/evidence/production/20260527T1600Z-skill-release-eval-canary.json",
            )
            or first_matching_blocker(production_blockers, ("activation_review", "abuse_throttle", "skill_release", "governance_release")),
            "dnl_impact": "keeps activation review, abuse hold, skill canary, and aggregate launch blocked",
        },
    ]


def validate_contract_anchors() -> None:
    contract = load_json(CONTRACT)
    if contract.get("schema_version") != "stage1.release_evidence_closure_queue.contract.v1":
        raise ReleaseEvidenceClosureQueueError("contract schema_version mismatch")
    if contract.get("canonical_preflight_path") != "ops/evidence/release/staging/stage1-evidence-closure-queue.preflight.json":
        raise ReleaseEvidenceClosureQueueError("contract canonical_preflight_path mismatch")
    policy = contract.get("preflight_policy")
    if not isinstance(policy, dict):
        raise ReleaseEvidenceClosureQueueError("contract preflight_policy must be object")
    if policy.get("generator_command") != "python3 scripts/generate_stage1_release_evidence_closure_queue.py":
        raise ReleaseEvidenceClosureQueueError("contract generator command mismatch")
    if policy.get("can_clear_stage1_staging_runtime_gate") is not False:
        raise ReleaseEvidenceClosureQueueError("closure queue preflight must not clear staging")
    if policy.get("can_clear_stage1_production_launch_gate") is not False:
        raise ReleaseEvidenceClosureQueueError("closure queue preflight must not clear production")
    if policy.get("can_close_do_not_launch") is not False:
        raise ReleaseEvidenceClosureQueueError("closure queue preflight must not close DNL")


def aggregate_summary(path: Path, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": display_path(path),
        "schema_version": data.get("schema_version"),
        "kind": data.get("kind"),
        "environment": data.get("environment"),
        "status": data.get("status"),
        "release_gate_decision": data.get("release_gate_decision"),
        "generated_at": data.get("generated_at"),
        "blocker_count": len(string_list(data.get("blockers"))),
        "do_not_launch_conditions": string_list(data.get("do_not_launch_conditions")),
    }


def azure_parallel_operational_blockers(
    azure_readiness_path: Path,
    run_command_diagnosis_path: Path,
) -> list[dict[str, Any]]:
    azure = load_optional_json(azure_readiness_path)
    diagnosis = load_optional_json(run_command_diagnosis_path)
    transport = azure.get("transport_diagnosis") if isinstance(azure.get("transport_diagnosis"), dict) else {}
    if azure.get("status") == "pass":
        return []
    if not azure and not diagnosis:
        return [
            {
                "blocker_id": "azure_origin_readiness_missing",
                "lane": "staging_ops",
                "status": "blocked",
                "release_gate_impact": "non_clearing_parallel_ops_only",
                "source_refs": [
                    display_path(azure_readiness_path),
                    display_path(run_command_diagnosis_path),
                ],
                "current_blocker": "Azure origin readiness evidence is missing; generate non-clearing Azure origin diagnostics.",
                "next_action": "python3 scripts/stage1_azure_origin_readiness.py --env .env --output ops/evidence/staging/stage1-azure-origin-readiness.json || test $? -eq 2",
                "operator_command": "python3 scripts/stage1_azure_origin_readiness.py --env .env --output ops/evidence/staging/stage1-azure-origin-readiness.json || test $? -eq 2",
                "can_clear_stage1_staging_runtime_gate": False,
                "can_clear_stage1_production_launch_gate": False,
                "can_close_do_not_launch": False,
            }
        ]
    if azure.get("status") == "blocked" or diagnosis.get("status") == "blocked":
        transport_summary = str(transport.get("operator_summary") or "Azure origin is not currently returning usable SSH/HTTP responses.")
        next_lane = str(diagnosis.get("next_repair_lane") or transport.get("next_action") or "azure_portal_run_command_or_serial_console")
        input_present = diagnosis.get("input_present")
        if input_present is False:
            current_blocker = f"{transport_summary} Azure Run Command output is missing."
            next_action = "Run Azure Portal VM RunShellScript payload, then pipe output through python3 scripts/ingest_azure_run_command_output.py."
        else:
            current_blocker = f"{transport_summary} Run Command next repair lane: {next_lane}."
            next_action = "Follow azure-run-command-ssh-repair-diagnosis.json recommended actions, then refresh Azure origin readiness."
        return [
            {
                "blocker_id": "azure_origin_run_command_required",
                "lane": "staging_ops",
                "status": "blocked",
                "release_gate_impact": "non_clearing_parallel_ops_only",
                "source_refs": [
                    display_path(azure_readiness_path),
                    display_path(run_command_diagnosis_path),
                ],
                "current_blocker": current_blocker,
                "next_action": next_action,
                "operator_command": "python3 scripts/ingest_azure_run_command_output.py",
                "transport_lane": str(transport.get("lane") or "unknown"),
                "transport_next_action": str(transport.get("next_action") or "unknown"),
                "run_command_next_repair_lane": next_lane,
                "run_command_input_present": bool(input_present) if isinstance(input_present, bool) else False,
                "can_clear_stage1_staging_runtime_gate": False,
                "can_clear_stage1_production_launch_gate": False,
                "can_close_do_not_launch": False,
            }
        ]
    return []


def operator_action_packet_summary(next_blockers_summary_path: Path) -> dict[str, Any]:
    data = load_optional_json(next_blockers_summary_path)
    packet = [item for item in data.get("operator_action_packet", []) if isinstance(item, dict)]
    items: list[dict[str, Any]] = []
    owner_counts: dict[str, int] = {}
    gate_impacts: dict[str, int] = {}
    for item in packet:
        owner = str(item.get("owner") or "unknown")
        gate_impact = str(item.get("gate_impact") or "unknown")
        owner_counts[owner] = owner_counts.get(owner, 0) + 1
        gate_impacts[gate_impact] = gate_impacts.get(gate_impact, 0) + 1
        items.append(
            {
                "order": int(item.get("order", len(items)) or len(items)),
                "item_id": str(item.get("item_id") or "unknown"),
                "owner": owner,
                "status": str(item.get("status") or "blocked"),
                "requires_external_input": bool(item.get("requires_external_input", True)),
                "required_return_artifact": str(item.get("required_return_artifact") or "not reported"),
                "agent_command_after_return": str(item.get("agent_command_after_return") or "not reported"),
                "validation_after_return": str(item.get("validation_after_return") or "not reported"),
                "evidence_ref": str(item.get("evidence_ref") or "not reported"),
                "gate_impact": gate_impact,
                "can_clear_stage1_staging_runtime_gate": False,
                "can_clear_stage1_production_launch_gate": False,
                "can_close_do_not_launch": False,
            }
        )

    source_gate_flags_all_false = all(
        item.get("can_clear_stage1_staging_runtime_gate") is False
        and item.get("can_clear_stage1_production_launch_gate") is False
        and item.get("can_close_do_not_launch") is False
        for item in packet
    )
    requires_external_input = sum(1 for item in items if item.get("requires_external_input") is True)
    return {
        "source_path": display_path(next_blockers_summary_path),
        "source_schema_version": str(data.get("schema_version") or "missing"),
        "status": str(data.get("status") or "missing"),
        "release_gate_decision": str(data.get("release_gate_decision") or "no_go"),
        "canonical_pass_path": False,
        "total": len(items),
        "blocked": sum(1 for item in items if item.get("status") == "blocked"),
        "requires_external_input": requires_external_input,
        "owner_counts": dict(sorted(owner_counts.items())),
        "gate_impact_counts": dict(sorted(gate_impacts.items())),
        "source_gate_flags_all_false": source_gate_flags_all_false,
        "items": items,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
    }


def build_preflight(args: argparse.Namespace) -> dict[str, Any]:
    staging_path = repo_path(args.staging)
    production_path = repo_path(args.production)
    r2_path = repo_path(args.r2_readiness)
    ci_preflight_path = repo_path(args.ci_preflight)
    azure_readiness_path = repo_path(args.azure_origin_readiness)
    run_command_diagnosis_path = repo_path(args.azure_run_command_diagnosis)
    next_blockers_summary_path = repo_path(args.next_blockers_summary)
    staging = load_json(staging_path)
    production = load_json(production_path)
    r2_readiness = load_optional_json(r2_path)
    ci_preflight = load_optional_json(ci_preflight_path)
    if ci_preflight.get("schema_version") != "stage1.ci_exact.preflight.v1":
        ci_preflight = {}
    rows = closure_queue(staging, production, r2_readiness, ci_preflight)
    parallel_blockers = azure_parallel_operational_blockers(azure_readiness_path, run_command_diagnosis_path)
    action_packet_summary = operator_action_packet_summary(next_blockers_summary_path)
    open_rows = [row for row in rows if row.get("row_status") != "passed"]
    open_gates = [row["gate"] for row in open_rows]
    status = "blocked"
    report: dict[str, Any] = {
        "schema_version": "stage1.release_evidence_closure_queue.preflight.v1",
        "kind": "stage1_release_evidence_closure_queue_preflight",
        "environment": "release",
        "status": status,
        "release_gate_decision": "no_go",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source_aggregates": {
            "staging_runtime": aggregate_summary(staging_path, staging),
            "production_launch": aggregate_summary(production_path, production),
            "r2_bucket_readiness": aggregate_summary(r2_path, r2_readiness) if r2_readiness else {
                "path": display_path(r2_path),
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
        },
        "queue": rows,
        "parallel_operational_blockers": parallel_blockers,
        "operator_action_packet_summary": action_packet_summary,
        "queue_summary": {
            "total": len(rows),
            "open": len(open_rows),
            "completed": len(rows) - len(open_rows),
            "completion_percent": round(((len(rows) - len(open_rows)) / len(rows)) * 100, 1) if rows else 0,
            "by_priority": {
                "P0": sum(1 for row in open_rows if row["priority"] == "P0"),
                "P1": sum(1 for row in open_rows if row["priority"] == "P1"),
                "P2": sum(1 for row in open_rows if row["priority"] == "P2"),
            },
            "by_lane": {
                "staging": sum(1 for row in open_rows if row["lane"] == "staging"),
                "ci": sum(1 for row in open_rows if row["lane"] == "ci"),
                "production": sum(1 for row in open_rows if row["lane"] == "production"),
            },
            "open_gates": open_gates,
            "parallel_operational_blockers": len(parallel_blockers),
            "operator_action_packet_items": action_packet_summary["total"],
        },
        "canonical_pass_path": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "do_not_launch_conditions_preserved": sorted(
            set(aggregate_summary(staging_path, staging)["do_not_launch_conditions"])
            | set(aggregate_summary(production_path, production)["do_not_launch_conditions"])
        ),
        "strict_launch_evidence_required": [
            "ops/evidence/ci/stage0-rev2-pr-main-run.json",
            "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
            "ops/evidence/ci/stage0-rev2-docker-image-build.json",
            "ops/evidence/staging/stage1-runtime.json",
            "ops/evidence/production/stage1-production-launch.json",
        ],
        "safe_projection_policy": {field: False for field in SAFE_FALSE_FIELDS},
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False
    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Stage 1 release evidence closure queue preflight")
    parser.add_argument("--contract-only", action="store_true", help="validate generator contract anchors only")
    parser.add_argument("--staging", type=Path, default=DEFAULT_STAGING)
    parser.add_argument("--production", type=Path, default=DEFAULT_PRODUCTION)
    parser.add_argument("--r2-readiness", type=Path, default=DEFAULT_R2_READINESS)
    parser.add_argument("--ci-preflight", type=Path, default=DEFAULT_CI_PREFLIGHT)
    parser.add_argument("--azure-origin-readiness", type=Path, default=DEFAULT_AZURE_ORIGIN_READINESS)
    parser.add_argument("--azure-run-command-diagnosis", type=Path, default=DEFAULT_AZURE_RUN_COMMAND_DIAGNOSIS)
    parser.add_argument("--next-blockers-summary", type=Path, default=DEFAULT_NEXT_BLOCKERS_SUMMARY)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_contract_anchors()
        if args.contract_only:
            print("stage1 release evidence closure queue generator contract passed")
            return 0
        report = build_preflight(args)
        write_json(repo_path(args.output), report)
    except ReleaseEvidenceClosureQueueError as exc:
        print(f"generate Stage 1 release evidence closure queue failed: {exc}", file=sys.stderr)
        return 1
    print(f"wrote Stage 1 release evidence closure queue preflight to {display_path(repo_path(args.output))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
