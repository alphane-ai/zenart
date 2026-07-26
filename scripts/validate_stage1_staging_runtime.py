#!/usr/bin/env python3
"""Validate Stage 1 aggregate staging runtime readiness evidence.

Contract-only mode validates the exact Stage 1 staging runtime gate definition
and its child validators. Strict mode requires canonical staging evidence and
must reject local, blocked, dry-run, or partial evidence.
`--allow-preflight` accepts only the generator's blocked aggregate diagnostic:
it is useful for Admin/Release readiness visibility, but it cannot clear the
staging runtime gate.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "staging_runtime" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "stage1-runtime.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "staging" / "stage1-runtime.ndjson"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
AGGREGATE_GENERATOR = ROOT / "scripts" / "generate_stage1_staging_runtime_evidence.py"

CHILD_VALIDATORS = {
    "scripts/validate_stage1_staging_auth_rbac_tenant_audit_evidence.py",
    "scripts/validate_stage1_provider_sandbox_evidence.py",
    "scripts/validate_stage1_staging_quota_replay_evidence.py",
    "scripts/validate_stage1_stripe_staging_evidence.py",
    "scripts/validate_stage1_safety_qa_evidence.py",
    "scripts/validate_stage1_staging_object_retention_evidence.py",
    "scripts/validate_stage1_staging_observability_backup_load_evidence.py",
    "scripts/validate_stage1_load_evidence.py",
    "scripts/validate_stage1_staging_legal_support_evidence.py",
}

STAGE0_SMOKE_SCRIPTS = {
    "scripts/staging_observability_backup_load_smoke.sh",
    "scripts/staging_object_storage_retention_cleanup_smoke.sh",
    "scripts/staging_legal_support_visibility_smoke.sh",
}

REQUIRED_COMPONENTS = {
    "auth_rbac_tenant_audit",
    "batch_runtime",
    "staging_quota_replay",
    "provider_sandbox",
    "stripe_test_lifecycle",
    "object_storage_retention_cleanup",
    "safety_qa_eval",
    "observability",
    "backup_restore",
    "load",
    "legal_support_external_user",
}

STRICT_CHILD_VALIDATORS_BY_COMPONENT = {
    "auth_rbac_tenant_audit": ("scripts/validate_stage1_staging_auth_rbac_tenant_audit_evidence.py",),
    "provider_sandbox": ("scripts/validate_stage1_provider_sandbox_evidence.py",),
    "staging_quota_replay": ("scripts/validate_stage1_staging_quota_replay_evidence.py",),
    "stripe_test_lifecycle": ("scripts/validate_stage1_stripe_staging_evidence.py",),
    "object_storage_retention_cleanup": ("scripts/validate_stage1_staging_object_retention_evidence.py",),
    "safety_qa_eval": ("scripts/validate_stage1_safety_qa_evidence.py",),
    "observability": ("scripts/validate_stage1_staging_observability_backup_load_evidence.py",),
    "backup_restore": ("scripts/validate_stage1_staging_observability_backup_load_evidence.py",),
    "load": ("scripts/validate_stage1_load_evidence.py",),
    "legal_support_external_user": ("scripts/validate_stage1_staging_legal_support_evidence.py",),
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
    "raw_support_body",
    "download_url",
    "signed_url",
    "database_url",
    "staging_database_url",
}

RAW_SECRET_RE = re.compile(
    r"(?i)(postgres(?:ql)?://[^\s\"']+|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)

BLOCKED_MARKERS = {
    "blocked",
    "failed",
    "planned",
    "dry_run",
    "dry_run_no_staging_runtime_probe",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
    "missing_staging_runtime",
    "blocked_by_other_staging_runtime_items",
    "blocked_by_object_retention_cleanup",
    "blocked_by_restore_load_and_other_staging_runtime_items",
}

PASS_STATUSES = {"pass", "passed"}
CONTEXT_ONLY_BLOCKED_MARKERS = {
    "blocked_by_other_staging_runtime_items",
    "blocked_by_restore_load_and_other_staging_runtime_items",
    "blocked_by_object_retention_cleanup",
}
LOCAL_DEBUG_TRUE_FIELDS = {"local_devport_debug", "allow_local_devport_evidence"}
CANONICAL_PATH_FALSE_FIELDS = {"canonical_pass_path", "canonical_pass_paths"}
CONTEXT_ONLY_FALSE_CAN_CLEAR_FIELDS = {
    "can_clear_aggregate_item",
    "can_clear_release_gate_check",
    "can_clear_stage1_staging_runtime_gate",
    "can_clear_stage1_production_launch_gate",
}
GATE_EMPTY_FIELDS = {
    "blocked_checks",
    "blockers",
    "do_not_launch_conditions",
}
GATE_CLEAR_FIELDS = {
    "do_not_launch_condition_id",
    "preserved_do_not_launch_condition_id",
    "preserved_release_gate_check_id",
}


class Stage1StagingRuntimeError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1StagingRuntimeError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def resolve_repo_path(ref: str) -> Path:
    path = ROOT / ref
    try:
        path.resolve().relative_to(ROOT.resolve())
    except ValueError as exc:
        raise Stage1StagingRuntimeError(f"path escapes repo root: {ref}") from exc
    return path


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise Stage1StagingRuntimeError(f"{display_path(path)} invalid JSON: {exc}") from exc
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
            raise Stage1StagingRuntimeError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
        require(isinstance(value, dict), f"{display_path(path)}:{lineno} must be a JSON object")
        rows.append(value)
    require(rows, f"{display_path(path)} must contain at least one row")
    return rows


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")
    return text


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
    rows = [value]
    if isinstance(value, dict):
        for child in value.values():
            rows.extend(walk_values(child))
    elif isinstance(value, list):
        for child in value:
            rows.extend(walk_values(child))
    return rows


def normalized_string_values(value: Any) -> set[str]:
    return {child.strip().lower() for child in walk_values(value) if isinstance(child, str)}


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def truthy_gate_value(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def falsey_gate_value(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {"false", "0", "no"})


def has_component_clear_signal(value: Any) -> bool:
    if not isinstance(value, dict) or not is_pass_status(value.get("status")):
        return False
    gate = value.get("gate_impact")
    if not isinstance(gate, dict):
        return False
    for key, child in gate.items():
        normalized = str(key).strip().lower()
        if not normalized.startswith("can_clear_") or not truthy_gate_value(child):
            continue
        if normalized in {
            "can_clear_aggregate_item",
            "can_clear_release_gate_check",
            "can_clear_stage1_staging_runtime_gate",
            "can_clear_stage1_production_launch_gate",
        }:
            continue
        return True
    return False


def marker_scan_value(value: Any, component_id: str) -> Any:
    if (
        component_id != "legal_support_external_user"
        or not isinstance(value, dict)
        or value.get("environment") != "staging"
        or value.get("kind") != "support_contact_external_user_visibility"
        or value.get("release_gate_check_id") != "staging_legal_external_user_pages"
        or not is_pass_status(value.get("status"))
    ):
        return value
    gate = value.get("gate_impact")
    ticket_context = value.get("ticket_context_probe")
    if (
        not isinstance(gate, dict)
        or not truthy_gate_value(gate.get("can_clear_support_contact_subitem"))
        or not isinstance(ticket_context, dict)
        or ticket_context.get("mode") != "dry_run"
    ):
        return value
    sanitized = dict(value)
    sanitized_ticket_context = dict(ticket_context)
    sanitized_ticket_context["mode"] = "support_ticket_context_capture_probe"
    sanitized["ticket_context_probe"] = sanitized_ticket_context
    return sanitized


def blocked_markers_for_evidence(value: Any, component_id: str, *, allow_context_only: bool = False) -> set[str]:
    markers = normalized_string_values(marker_scan_value(value, component_id)) & BLOCKED_MARKERS
    if allow_context_only:
        markers -= CONTEXT_ONLY_BLOCKED_MARKERS
    return markers


def local_debug_blockers(value: Any, path: str, *, allow_context_only: bool = False) -> list[str]:
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
                if not (allow_context_only and normalized in CONTEXT_ONLY_FALSE_CAN_CLEAR_FIELDS):
                    blockers.append(f"{child_path} is false")
            if normalized in GATE_EMPTY_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not empty")
            if normalized in GATE_CLEAR_FIELDS and child not in (None, ""):
                if not allow_context_only:
                    blockers.append(f"{child_path} is not cleared")
            blockers.extend(local_debug_blockers(child, child_path, allow_context_only=allow_context_only))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            blockers.extend(local_debug_blockers(child, f"{path}[{idx}]", allow_context_only=allow_context_only))
    return blockers


def require_no_local_debug_flags(value: Any, path: str, *, allow_context_only: bool = False) -> None:
    blockers = local_debug_blockers(value, path, allow_context_only=allow_context_only)
    require(not blockers, f"{path} contains local-devport/debug-only gate signal(s): {blockers}")


def evidence_refs_from_contract_component(component: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    single = component.get("required_evidence_ref")
    if isinstance(single, str):
        refs.append(single)
    multi = component.get("required_evidence_refs")
    if isinstance(multi, list):
        refs.extend(ref for ref in multi if isinstance(ref, str))
    return refs


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.staging_runtime.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "staging_runtime_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/staging/stage1-runtime.json", "contract evidence path mismatch")
    require(contract.get("canonical_results_path") == "ops/evidence/staging/stage1-runtime.ndjson", "contract results path mismatch")
    require(contract.get("strict_schema_version") == "stage1.staging_runtime.v1", "contract strict schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_staging_runtime_evidence_open", "contract must not close staging gate")

    components = contract.get("required_components")
    require(isinstance(components, list) and components, "required_components must be non-empty")
    by_id = {item.get("component_id"): item for item in components if isinstance(item, dict)}
    require(REQUIRED_COMPONENTS <= set(by_id), f"contract missing components {sorted(REQUIRED_COMPONENTS - set(by_id))}")
    for component_id in REQUIRED_COMPONENTS:
        component = by_id[component_id]
        refs = evidence_refs_from_contract_component(component)
        require(refs, f"{component_id} must declare evidence refs")
        for ref in refs:
            require(ref.startswith("ops/evidence/staging/"), f"{component_id} evidence ref must stay under ops/evidence/staging/: {ref}")
        if "required_results_ref" in component:
            require(str(component["required_results_ref"]).startswith("ops/evidence/staging/"), f"{component_id} results ref must stay under ops/evidence/staging/")
        blocked_refs = component.get("blocked_evidence_refs")
        if blocked_refs is None and "blocked_evidence_ref" in component:
            blocked_refs = [component["blocked_evidence_ref"]]
        if blocked_refs is not None:
            require(isinstance(blocked_refs, list), f"{component_id} blocked evidence refs must be a list")
            for ref in blocked_refs:
                require(isinstance(ref, str) and ref.startswith("ops/evidence/staging/"), f"{component_id} blocked evidence ref must stay under ops/evidence/staging/: {ref}")
                require(".blocked." in ref, f"{component_id} blocked evidence ref must be explicitly blocked: {ref}")
        if "blocked_results_ref" in component:
            blocked_results_ref = str(component["blocked_results_ref"])
            require(blocked_results_ref.startswith("ops/evidence/staging/"), f"{component_id} blocked results ref must stay under ops/evidence/staging/")
            require(".blocked." in blocked_results_ref, f"{component_id} blocked results ref must be explicitly blocked")
        status_values = set(component.get("required_status_values") or [])
        require(status_values & PASS_STATUSES, f"{component_id} must require a pass status")
        proofs = component.get("required_proofs")
        require(isinstance(proofs, list) and len(proofs) >= 2, f"{component_id} required_proofs must be specific")

    child_validators = contract.get("required_child_validators")
    require(isinstance(child_validators, list), "required_child_validators must be list")
    declared_validators = {item.get("validator") for item in child_validators if isinstance(item, dict)}
    require(CHILD_VALIDATORS <= declared_validators, f"contract missing child validators {sorted(CHILD_VALIDATORS - declared_validators)}")
    for item in child_validators:
        if not isinstance(item, dict):
            continue
        validator = item.get("validator")
        if validator in CHILD_VALIDATORS:
            require(item.get("contract_only_command") == f"python3 {validator} --contract-only", f"{validator} contract-only command mismatch")
            require(item.get("strict_command") == f"python3 {validator}", f"{validator} strict command mismatch")

    stage0_scripts = set(contract.get("required_stage0_smoke_scripts") or [])
    require(STAGE0_SMOKE_SCRIPTS <= stage0_scripts, f"contract missing stage0 smoke scripts {sorted(STAGE0_SMOKE_SCRIPTS - stage0_scripts)}")

    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for key in (
        "secret_material_persisted",
        "raw_prompt_persisted",
        "raw_provider_payload_persisted",
        "raw_stripe_payload_persisted",
        "raw_support_body_projected",
        "signed_url_persisted",
        "authorization_header_persisted",
        "cookie_persisted",
        "database_url_persisted",
    ):
        require(safe_policy.get(key) is False, f"safe_projection_policy.{key} must be false")

    strict_policy = contract.get("strict_evidence_policy")
    require(isinstance(strict_policy, dict), "strict_evidence_policy must be object")
    require(strict_policy.get("environment") == "staging", "strict policy environment mismatch")
    require(strict_policy.get("kind") == "stage1_staging_runtime", "strict policy kind mismatch")
    require(strict_policy.get("status") == "pass", "strict policy status mismatch")
    require(strict_policy.get("allow_blocked_component") is False, "strict policy must reject blocked components")
    require(strict_policy.get("allow_local_alpha_component") is False, "strict policy must reject local alpha components")
    require(strict_policy.get("allow_local_devport_debug") is False, "strict policy must reject local devport debug evidence")
    require(strict_policy.get("allow_local_devport_evidence") is False, "strict policy must reject local devport evidence")
    require(strict_policy.get("allow_dry_run") is False, "strict policy must reject dry run evidence")
    require(strict_policy.get("canonical_pass_path_required") is True, "strict policy must require canonical pass paths")
    require(strict_policy.get("gate_impact_can_clear_required") is True, "strict policy must require gate impact can_clear flags")
    require(strict_policy.get("strict_child_validators_must_pass") is True, "strict policy must require child validators")

    preflight_policy = contract.get("aggregate_preflight_policy")
    require(isinstance(preflight_policy, dict), "aggregate_preflight_policy must be object")
    require(preflight_policy.get("validator_command") == "python3 scripts/validate_stage1_staging_runtime.py --allow-preflight", "aggregate preflight validator command mismatch")
    require(preflight_policy.get("generator_command") == "python3 scripts/generate_stage1_staging_runtime_evidence.py", "aggregate preflight generator command mismatch")
    require(preflight_policy.get("accepted_schema_version") == "stage1.staging_runtime.v1", "aggregate preflight schema mismatch")
    require(preflight_policy.get("accepted_status") == "blocked", "aggregate preflight status mismatch")
    require(preflight_policy.get("accepted_release_gate_decision") == "no_go", "aggregate preflight decision mismatch")
    require(preflight_policy.get("can_clear_stage1_staging_runtime_gate") is False, "aggregate preflight must not clear staging gate")
    require(preflight_policy.get("can_clear_stage1_production_launch_gate") is False, "aggregate preflight must not clear production gate")
    require(preflight_policy.get("canonical_pass_path_required_for_strict") is True, "aggregate preflight must preserve canonical strict requirement")
    require(preflight_policy.get("must_preserve_do_not_launch_condition") == "stage1_staging_runtime_evidence_incomplete", "aggregate preflight DNL mismatch")
    required_diagnostics = {
        "ops/evidence/staging/stage1-quota-replay.blocked.json",
        "ops/evidence/staging/object-storage-retention-cleanup.blocked.json",
        "ops/evidence/staging/stage1-load.blocked.json",
    }
    require(required_diagnostics <= set(preflight_policy.get("must_surface_blocked_child_diagnostics") or []), "aggregate preflight must surface blocked child diagnostics")
    require(preflight_policy.get("strict_validator_still_rejects_preflight") is True, "aggregate preflight must keep strict validator rejecting blocked evidence")

    remaining = contract.get("remaining_staging_evidence")
    require(isinstance(remaining, list) and len(remaining) >= 5, "remaining_staging_evidence must preserve open staging proof")


def validate_code_anchors() -> None:
    require(AGGREGATE_GENERATOR.exists(), "missing scripts/generate_stage1_staging_runtime_evidence.py")
    require(AGGREGATE_GENERATOR.stat().st_mode & 0o111 != 0, "scripts/generate_stage1_staging_runtime_evidence.py must be executable")
    require_text(
        AGGREGATE_GENERATOR,
        (
            "stage1-runtime.json",
            "stage1-runtime.ndjson",
            "stage1.staging_runtime.v1",
            "build_runtime_input_readiness",
            "release_gate_decision",
            "stage1_staging_runtime_evidence_incomplete",
            "strict child validator failed",
            "blocked_evidence_ref",
            "blocked_results_ref",
            "diagnostic_evidence_refs",
            "load_ready",
            "quota_replay_ready",
            "stage1-quota-replay.json",
            "stage1-quota-replay.ndjson",
            "local_devport_debug",
            "allow_local_devport_evidence",
            "canonical_pass_path",
            "can_clear_",
            'assert_no_secret(report, "report")',
            'assert_no_secret(rows, "results")',
        ),
    )
    for validator in CHILD_VALIDATORS:
        path = resolve_repo_path(validator)
        require(path.exists(), f"missing {validator}")
        require(path.stat().st_mode & 0o111 != 0, f"{validator} must be executable")
    for script in STAGE0_SMOKE_SCRIPTS:
        path = resolve_repo_path(script)
        require(path.exists(), f"missing {script}")
        require(path.stat().st_mode & 0o111 != 0, f"{script} must be executable")

    require_text(
        BLUEPRINT,
        (
            "OP-6",
            "ops/evidence/staging/stage1-runtime.json",
            "VF-6",
            "scripts/validate_stage1_staging_runtime.py",
            "auth、RBAC、batch、provider、Stripe、object storage、observability、backup、load、legal/support",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_staging_auth_rbac_tenant_audit_evidence.py"),
        (
            "20260527T1515Z-auth-rbac-tenant-audit.json",
            "staging_auth_rbac_tenant_audit",
            "tenant_isolation_not_enforced",
            "rbac-provider-002",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_provider_sandbox_evidence.py"),
        (
            "stage1-provider-sandbox.json",
            "stage1-provider-sandbox.ndjson",
            "stage1.provider_sandbox.v1",
            "provider_sandbox",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_staging_quota_replay_evidence.py"),
        (
            "stage1-quota-replay.json",
            "stage1-quota-replay.ndjson",
            "stage1.staging_quota_replay.v1",
            "deployed_staging_postgres",
            "idempotency_key_hash",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_stripe_staging_evidence.py"),
        (
            "stripe-test-checkout-webhook.json",
            "stripe-test-checkout-webhook.ndjson",
            "stage1.stripe_staging_lifecycle.v1",
            "stripe_test_checkout_webhook",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_safety_qa_evidence.py"),
        (
            "stage1-safety-qa-eval.json",
            "stage1-safety-qa-eval.ndjson",
            "stage1.safety_qa_eval.v1",
            "safety_qa_eval",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_staging_object_retention_evidence.py"),
        (
            "object-storage-retention-cleanup.json",
            "object-storage-retention-cleanup.ndjson",
            "stage0.rev2.staging.object_storage_retention_cleanup",
            "cleanup_audit_refs_by_probe",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_staging_observability_backup_load_evidence.py"),
        (
            "staging_observability_backup_load_preflight",
            "observability_evidence",
            "backup_restore_evidence",
            "post_deploy_smoke_evidence",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_staging_legal_support_evidence.py"),
        (
            "legal-pages-external-user.json",
            "support-contact-external-user.json",
            "support_ticket_context_required",
            "billing_policy",
        ),
    )
    require_text(
        resolve_repo_path("scripts/staging_object_storage_retention_cleanup_smoke.sh"),
        (
            "object-storage-retention-cleanup.json",
            "object-storage-retention-cleanup.ndjson",
            "object_storage_retention_cleanup",
        ),
    )
    require_text(
        resolve_repo_path("scripts/staging_observability_backup_load_smoke.sh"),
        (
            "staging_observability_backup_load_preflight",
            "observability",
            "backup_restore",
            "load",
            "post_deploy_smoke",
        ),
    )
    require_text(
        resolve_repo_path("scripts/staging_legal_support_visibility_smoke.sh"),
        (
            "legal-pages-external-user.json",
            "support-contact-external-user.json",
            "legal_support_external_user_visibility_runtime_probe",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_provider_sandbox_evidence.py --contract-only",
            "validate_stage1_staging_quota_replay_evidence.py --contract-only",
            "validate_stage1_stripe_staging_evidence.py --contract-only",
            "validate_stage1_safety_qa_evidence.py --contract-only",
            "validate_stage1_staging_auth_rbac_tenant_audit_evidence.py --contract-only",
            "validate_stage1_staging_object_retention_evidence.py --contract-only",
            "validate_stage1_staging_observability_backup_load_evidence.py --contract-only",
            "validate_stage1_load_evidence.py --contract-only",
            "validate_stage1_staging_legal_support_evidence.py --contract-only",
            "generate_stage1_staging_runtime_evidence.py --contract-only",
            "stage1_staging_runtime_evidence_incomplete",
            "require_no_local_debug_flags",
            "--allow-preflight",
        ),
    )
    require_text(GAP_INVENTORY, ("VF-6", "aggregate staging runtime", "VF-6d", "VF-6e", "VF-6f", "VF-6g", "VF-7"))


def validate_secret_rejection_selftest() -> None:
    secret_cases: list[tuple[str, Any]] = [
        ("secret field", {"secret": "redacted-but-forbidden-field"}),
        ("database URL field", {"database_url": "redacted-but-forbidden-field"}),
        ("raw provider field", {"component": {"raw_provider_payload": {"id": "payload"}}}),
        ("raw Stripe field", {"component": {"raw_stripe_payload": {"id": "evt_test"}}}),
        ("Bearer token string", {"message": "Authorization failed for Bearer providersecretguardtoken123456"}),
        ("Stripe key string", {"message": "Stripe returned " + "sk_test_" + "1234567890abcdef123456"}),
        ("Stripe signature string", {"message": "Stripe-Signature: t=1234567890,v1=abcdefabcdefabcdef"}),
        ("Postgres URL string", {"message": "postgresql://user:pass@staging-db.example.internal:5432/zenari"}),
        ("z.ai key string", {"message": "provider key " + ("0123456789abcdef" * 2) + "." + "abcdefghijklmnop"}),
    ]
    for label, payload in secret_cases:
        try:
            assert_no_secret(payload, f"secret_selftest.{label}")
        except Stage1StagingRuntimeError:
            continue
        raise Stage1StagingRuntimeError(f"secret rejection selftest accepted {label}")


def validate_component_ref(ref: str, component_id: str) -> dict[str, Any]:
    require(ref.startswith("ops/evidence/staging/"), f"{component_id} evidence ref must stay under ops/evidence/staging/: {ref}")
    path = resolve_repo_path(ref)
    data = load_json(path)
    assert_no_secret(data, f"{component_id}.evidence")
    allow_context_only = has_component_clear_signal(data)
    require_no_local_debug_flags(data, f"{component_id}.evidence", allow_context_only=allow_context_only)
    require(data.get("environment") == "staging", f"{component_id} evidence must be staging")
    require(is_pass_status(data.get("status")), f"{component_id} evidence status must be pass/passed")
    strings = normalized_string_values(data)
    blocked = sorted(blocked_markers_for_evidence(data, component_id, allow_context_only=allow_context_only))
    require(not blocked, f"{component_id} evidence contains blocked/local/dry-run marker(s): {blocked}")
    require("local_alpha" not in strings and "local-only" not in strings, f"{component_id} evidence must not be local-only")
    for key in ("do_not_launch_condition_id", "preserved_do_not_launch_condition_id"):
        if key in data:
            require(allow_context_only or data.get(key) in {None, ""}, f"{component_id} evidence must clear {key}")
    gate = data.get("release_gate") if isinstance(data.get("release_gate"), dict) else None
    if gate:
        for key in ("do_not_launch_condition_id", "preserved_do_not_launch_condition_id"):
            if key in gate:
                require(gate.get(key) in {None, ""}, f"{component_id} release_gate must clear {key}")
    return data


def validate_results_ref(ref: str, component_id: str) -> None:
    require(ref.startswith("ops/evidence/staging/"), f"{component_id} results ref must stay under ops/evidence/staging/: {ref}")
    rows = load_ndjson(resolve_repo_path(ref))
    assert_no_secret(rows, f"{component_id}.results")
    for idx, row in enumerate(rows):
        status = row.get("status")
        require_no_local_debug_flags(row, f"{component_id}.result[{idx + 1}]")
        require(is_pass_status(status), f"{component_id} result row {idx + 1} must pass")
        require(row.get("secret_leak_detected") in {False, None}, f"{component_id} result row {idx + 1} leaked secret material")
        strings = normalized_string_values(row)
        blocked = sorted(strings & BLOCKED_MARKERS)
        require(not blocked, f"{component_id} result row {idx + 1} contains blocked/local/dry-run marker(s): {blocked}")


def run_child_validator(command: str, component_id: str) -> None:
    parts = command.split()
    require(len(parts) == 2 and parts[0] == "python3", f"{component_id} invalid validator command")
    require(parts[1] in CHILD_VALIDATORS, f"{component_id} unexpected validator {parts[1]}")
    result = subprocess.run(parts, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        output = (result.stderr or result.stdout).strip()
        raise Stage1StagingRuntimeError(f"{component_id} strict child validator failed: {command}: {output}")


def validate_component(component: dict[str, Any], contract_component: dict[str, Any]) -> None:
    component_id = component.get("component_id")
    require(component_id in REQUIRED_COMPONENTS, f"unexpected component {component_id!r}")
    require_no_local_debug_flags(component, f"{component_id}.aggregate")
    require(component.get("status") == "passed", f"{component_id} aggregate status must be passed")
    require(component.get("environment") == "staging", f"{component_id} aggregate environment must be staging")
    require(component.get("exact_evidence") is True, f"{component_id} must be exact evidence")
    require(component.get("dry_run") is False, f"{component_id} dry_run must be false")
    require(component.get("local_only") is False, f"{component_id} local_only must be false")
    require(component.get("secret_leak_detected") is False, f"{component_id} secret_leak_detected must be false")
    require(component.get("raw_payload_persisted") is False, f"{component_id} raw_payload_persisted must be false")

    evidence_refs = component.get("evidence_refs")
    require(isinstance(evidence_refs, list) and evidence_refs, f"{component_id} evidence_refs must be non-empty")
    required_refs = set(evidence_refs_from_contract_component(contract_component))
    require(required_refs <= set(evidence_refs), f"{component_id} missing required evidence refs {sorted(required_refs - set(evidence_refs))}")
    for ref in evidence_refs:
        require(isinstance(ref, str), f"{component_id} evidence ref must be string")
        validate_component_ref(ref, component_id)

    expected_results = contract_component.get("required_results_ref")
    if expected_results:
        results_ref = component.get("results_ref")
        require(results_ref == expected_results, f"{component_id} results_ref mismatch")
        validate_results_ref(results_ref, component_id)

    proofs = component.get("proofs")
    require(isinstance(proofs, list) and proofs, f"{component_id} proofs must be non-empty")
    required_proofs = {str(item).lower() for item in contract_component.get("required_proofs", [])}
    proof_values = {str(item).lower() for item in proofs}
    missing = [proof for proof in sorted(required_proofs) if all(proof not in item for item in proof_values)]
    require(not missing, f"{component_id} missing proof anchors {missing}")

    for validator in STRICT_CHILD_VALIDATORS_BY_COMPONENT.get(str(component_id), ()):
        strict_command = f"python3 {validator}"
        require(strict_command in component.get("validator_commands", []), f"{component_id} must record strict validator command {strict_command}")
        run_child_validator(strict_command, str(component_id))


def validate_preflight_component(component: dict[str, Any], contract_component: dict[str, Any]) -> None:
    component_id = component.get("component_id")
    require(component_id in REQUIRED_COMPONENTS, f"unexpected preflight component {component_id!r}")
    require(component.get("environment") == "staging", f"{component_id} preflight environment must be staging")
    require(component.get("dry_run") is False, f"{component_id} preflight dry_run must be false")
    require(component.get("local_only") is False, f"{component_id} preflight local_only must be false")
    require(component.get("secret_leak_detected") is False, f"{component_id} preflight secret_leak_detected must be false")
    require(component.get("raw_payload_persisted") is False, f"{component_id} preflight raw_payload_persisted must be false")

    expected_refs = set(evidence_refs_from_contract_component(contract_component))
    evidence_refs = component.get("evidence_refs")
    require(isinstance(evidence_refs, list), f"{component_id} preflight evidence_refs must be list")
    require(expected_refs <= set(evidence_refs), f"{component_id} preflight missing canonical evidence refs {sorted(expected_refs - set(evidence_refs))}")
    for ref in evidence_refs:
        require(isinstance(ref, str) and ref.startswith("ops/evidence/staging/"), f"{component_id} preflight evidence ref must stay under ops/evidence/staging/: {ref}")

    expected_results = contract_component.get("required_results_ref")
    if expected_results:
        require(component.get("results_ref") == expected_results, f"{component_id} preflight results_ref mismatch")

    status = component.get("status")
    blockers = component.get("blockers")
    require(isinstance(blockers, list), f"{component_id} preflight blockers must be list")
    if status == "passed":
        require(component.get("exact_evidence") is True, f"{component_id} passed preflight component must be exact evidence")
        require(blockers == [], f"{component_id} passed preflight component must have no blockers")
        diagnostic_refs = component.get("diagnostic_evidence_refs")
        if diagnostic_refs is not None:
            require(isinstance(diagnostic_refs, list), f"{component_id} passed preflight diagnostic_evidence_refs must be list")
            require(set(diagnostic_refs) <= set(evidence_refs), f"{component_id} passed preflight diagnostic refs must only mirror canonical refs")
        diagnostic_results_ref = component.get("diagnostic_results_ref")
        require(diagnostic_results_ref in (None, "", component.get("results_ref")), f"{component_id} passed preflight diagnostic results must only mirror canonical results")
        return

    require(status == "blocked", f"{component_id} preflight component status must be passed or blocked")
    require(component.get("exact_evidence") is False, f"{component_id} blocked preflight component must not be exact evidence")
    require(blockers, f"{component_id} blocked preflight component must preserve blockers")
    joined = "\n".join(str(item) for item in blockers)
    require("missing canonical pass evidence" in joined, f"{component_id} blocked preflight must identify missing canonical evidence")
    require("strict child validator failed" in joined, f"{component_id} blocked preflight must preserve strict child validator failure")

    diagnostic_refs = component.get("diagnostic_evidence_refs")
    require(isinstance(diagnostic_refs, list) and diagnostic_refs, f"{component_id} blocked preflight must surface diagnostic evidence refs")
    for ref in diagnostic_refs:
        require(isinstance(ref, str) and ref.startswith("ops/evidence/staging/"), f"{component_id} diagnostic evidence ref must stay under ops/evidence/staging/: {ref}")
        require(".blocked." in ref, f"{component_id} diagnostic evidence ref must be explicitly blocked: {ref}")
        diagnostic = load_json(resolve_repo_path(ref))
        assert_no_secret(diagnostic, f"{component_id}.diagnostic_evidence")
    diagnostic_results_ref = component.get("diagnostic_results_ref")
    if expected_results:
        require(isinstance(diagnostic_results_ref, str) and diagnostic_results_ref.startswith("ops/evidence/staging/"), f"{component_id} blocked preflight must surface diagnostic results ref")
        require(".blocked." in diagnostic_results_ref, f"{component_id} diagnostic results ref must be explicitly blocked")
        diagnostic_rows = load_ndjson(resolve_repo_path(diagnostic_results_ref))
        assert_no_secret(diagnostic_rows, f"{component_id}.diagnostic_results")


def validate_preflight_evidence(evidence_path: Path, results_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "preflight")
    assert_no_secret(rows, "preflight_results")

    require(data.get("schema_version") == "stage1.staging_runtime.v1", "preflight schema_version mismatch")
    require(data.get("environment") == "staging", "preflight aggregate evidence must be staging")
    require(data.get("kind") == "stage1_staging_runtime", "preflight kind must be stage1_staging_runtime")
    require(data.get("status") == "blocked", "preflight aggregate status must be blocked")
    require(data.get("release_gate_decision") == "no_go", "preflight release_gate_decision must be no_go")
    require(data.get("all_components_passed") is False, "preflight all_components_passed must be false")
    require(data.get("do_not_launch_conditions") == ["stage1_staging_runtime_evidence_incomplete"], "preflight must preserve staging runtime DNL")
    blockers = data.get("blockers")
    require(isinstance(blockers, list) and blockers, "preflight blockers must be non-empty")
    blocker_text = "\n".join(str(item) for item in blockers)
    require("missing canonical pass evidence" in blocker_text, "preflight must preserve missing canonical evidence blockers")
    require("strict child validator failed" in blocker_text, "preflight must preserve strict child validator blockers")

    for key in (
        "secret_material_persisted",
        "raw_prompt_persisted",
        "raw_provider_payload_persisted",
        "raw_stripe_payload_persisted",
        "raw_support_body_projected",
        "signed_url_persisted",
        "authorization_header_persisted",
        "cookie_persisted",
        "database_url_persisted",
    ):
        require(data.get(key) is False, f"preflight {key} must be false")

    runtime_inputs = data.get("runtime_input_readiness")
    require(isinstance(runtime_inputs, dict), "preflight runtime_input_readiness must be object")
    for key in (
        "staging_api_ready",
        "staging_web_ready",
        "staging_admin_ready",
        "csrf_ready",
        "quota_replay_ready",
        "object_storage_ready",
        "load_ready",
    ):
        require(runtime_inputs.get(key) is False, f"preflight runtime_input_readiness.{key} must be false")

    contract_by_id = {
        item["component_id"]: item for item in contract["required_components"] if isinstance(item, dict) and item.get("component_id")
    }
    components = data.get("components")
    require(isinstance(components, list) and components, "preflight components must be non-empty")
    by_id = {item.get("component_id"): item for item in components if isinstance(item, dict)}
    require(REQUIRED_COMPONENTS <= set(by_id), f"preflight aggregate evidence missing components {sorted(REQUIRED_COMPONENTS - set(by_id))}")
    blocked_ids: set[str] = set()
    for component_id in REQUIRED_COMPONENTS:
        validate_preflight_component(by_id[component_id], contract_by_id[component_id])
        if by_id[component_id].get("status") == "blocked":
            blocked_ids.add(component_id)

    expected_blocked = {"staging_quota_replay", "object_storage_retention_cleanup", "load"}
    require(expected_blocked <= blocked_ids, f"preflight must preserve current blocked staging child diagnostics {sorted(expected_blocked - blocked_ids)}")

    row_ids = {row.get("component_id") for row in rows}
    require(REQUIRED_COMPONENTS <= row_ids, f"preflight results missing rows {sorted(REQUIRED_COMPONENTS - row_ids)}")
    for row in rows:
        component_id = row.get("component_id")
        if component_id not in REQUIRED_COMPONENTS:
            continue
        require(row.get("environment") == "staging", f"preflight result {component_id} environment must be staging")
        require(row.get("secret_leak_detected") is False, f"preflight result {component_id} leaked secret")
        require(row.get("raw_payload_persisted") is False, f"preflight result {component_id} persisted raw payload")
        if component_id in blocked_ids:
            require(row.get("status") == "blocked", f"preflight result {component_id} status must be blocked")
            require(row.get("exact_evidence") is False, f"preflight result {component_id} exact_evidence must be false")
            require(isinstance(row.get("blockers"), list) and row.get("blockers"), f"preflight result {component_id} must preserve blockers")
            require(isinstance(row.get("diagnostic_evidence_refs"), list) and row.get("diagnostic_evidence_refs"), f"preflight result {component_id} must surface diagnostic evidence refs")
            if contract_by_id[component_id].get("required_results_ref"):
                require(isinstance(row.get("diagnostic_results_ref"), str) and ".blocked." in row["diagnostic_results_ref"], f"preflight result {component_id} must surface blocked diagnostic results")
        else:
            require(row.get("status") == "passed", f"preflight result {component_id} status must be passed")
            require(row.get("exact_evidence") is True, f"preflight result {component_id} exact_evidence must be true")


def validate_evidence(evidence_path: Path, results_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "evidence")
    assert_no_secret(rows, "results")
    require_no_local_debug_flags(data, "evidence")
    require_no_local_debug_flags(rows, "results")

    require(data.get("schema_version") == "stage1.staging_runtime.v1", "schema_version mismatch")
    require(data.get("environment") == "staging", "aggregate evidence must be staging")
    require(data.get("kind") == "stage1_staging_runtime", "kind must be stage1_staging_runtime")
    require(data.get("status") == "pass", "aggregate status must be pass")
    require(data.get("release_gate_decision") == "go", "release_gate_decision must be go")
    require(data.get("all_components_passed") is True, "all_components_passed must be true")
    require(data.get("do_not_launch_conditions") == [], "do_not_launch_conditions must be empty")
    for key in (
        "secret_material_persisted",
        "raw_prompt_persisted",
        "raw_provider_payload_persisted",
        "raw_stripe_payload_persisted",
        "raw_support_body_projected",
        "signed_url_persisted",
        "authorization_header_persisted",
        "cookie_persisted",
        "database_url_persisted",
    ):
        require(data.get(key) is False, f"{key} must be false")

    runtime_inputs = data.get("runtime_input_readiness")
    require(isinstance(runtime_inputs, dict), "runtime_input_readiness must be object")
    for key in (
        "staging_api_ready",
        "staging_web_ready",
        "staging_admin_ready",
        "admin_auth_ready",
        "user_auth_ready",
        "csrf_ready",
        "stripe_test_ready",
        "provider_live_calls_ready",
        "object_storage_ready",
        "observability_ready",
        "backup_restore_ready",
        "load_ready",
        "quota_replay_ready",
    ):
        require(runtime_inputs.get(key) is True, f"runtime_input_readiness.{key} must be true")

    contract_by_id = {
        item["component_id"]: item for item in contract["required_components"] if isinstance(item, dict) and item.get("component_id")
    }
    components = data.get("components")
    require(isinstance(components, list) and components, "components must be non-empty")
    by_id = {item.get("component_id"): item for item in components if isinstance(item, dict)}
    require(REQUIRED_COMPONENTS <= set(by_id), f"aggregate evidence missing components {sorted(REQUIRED_COMPONENTS - set(by_id))}")
    for component_id in REQUIRED_COMPONENTS:
        validate_component(by_id[component_id], contract_by_id[component_id])

    row_ids = {row.get("component_id") for row in rows}
    require(REQUIRED_COMPONENTS <= row_ids, f"results missing rows {sorted(REQUIRED_COMPONENTS - row_ids)}")
    for row in rows:
        component_id = row.get("component_id")
        if component_id in REQUIRED_COMPONENTS:
            require(row.get("status") == "passed", f"result {component_id} status must be passed")
            require(row.get("exact_evidence") is True, f"result {component_id} exact_evidence must be true")
            require(row.get("secret_leak_detected") is False, f"result {component_id} leaked secret")
            require(row.get("raw_payload_persisted") is False, f"result {component_id} persisted raw payload")
            strings = normalized_string_values(row)
            blocked = sorted(strings & BLOCKED_MARKERS)
            require(not blocked, f"result {component_id} contains blocked/local/dry-run marker(s): {blocked}")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    validate_secret_rejection_selftest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors without requiring staging pass evidence")
    parser.add_argument("--allow-preflight", action="store_true", help="validate blocked aggregate diagnostic evidence without clearing the staging gate")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="Stage 1 staging runtime evidence JSON path")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="Stage 1 staging runtime NDJSON results path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            validate_preflight_evidence(Path(args.evidence), Path(args.results))
        else:
            validate_evidence(Path(args.evidence), Path(args.results))
    except Stage1StagingRuntimeError as exc:
        print(f"stage1 staging runtime validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 staging runtime contract passed")
    elif args.allow_preflight:
        print("stage1 staging runtime preflight evidence passed")
    else:
        print("stage1 staging runtime evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
