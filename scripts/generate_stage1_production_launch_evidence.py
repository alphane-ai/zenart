#!/usr/bin/env python3
"""Generate aggregate Stage 1 production launch evidence.

The script writes a pass/go production launch aggregate only when all upstream
release gates, exact CI files, strict staging evidence, and production child
evidence satisfy the production contract. Missing or blocked prerequisites
produce an explicit blocked report instead of closing the launch gate.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "stage1-production-launch.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "production" / "stage1-production-launch.ndjson"
STRICT_VALIDATOR = "scripts/validate_stage1_production_launch.py"

PASS_STATUSES = {"pass", "passed"}
BLOCKED_MARKERS = {
    "blocked",
    "failed",
    "planned",
    "dry_run",
    "no_go",
    "no-go",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
    "blocked_by_upstream_gates",
    "blocked_by_other_production_runtime_items",
    "blocked_by_upstream_or_missing_exact_split_evidence",
    "pass_with_blockers_preserved",
    "missing",
    "deferred",
}
LOCAL_DEBUG_TRUE_FIELDS = {"local_devport_debug", "allow_local_devport_evidence"}
CANONICAL_PATH_FALSE_FIELDS = {"canonical_pass_path", "canonical_pass_paths"}
GATE_EMPTY_FIELDS = {
    "blocked_checks",
    "blocked_by_checks",
    "blockers",
    "do_not_launch_conditions",
    "active_do_not_launch_conditions",
    "remaining_blockers",
}
GATE_CLEAR_FIELDS = {
    "do_not_launch_condition_id",
    "preserved_do_not_launch_condition_id",
    "preserved_release_gate_check_id",
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
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
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


class GenerationError(Exception):
    pass


def repo_path(ref: str) -> Path:
    path = ROOT / ref
    try:
        path.resolve().relative_to(ROOT.resolve())
    except ValueError as exc:
        raise GenerationError(f"path escapes repo root: {ref}") from exc
    return path


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise GenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise GenerationError(f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_ndjson(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


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


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise GenerationError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise GenerationError(f"{path} contains raw secret-looking material")


def validate_secret_rejection_selftest() -> None:
    rejected = 0
    cases: list[tuple[str, Any]] = [
        ("forbidden secret field", {"component": {"secret": "redacted"}}),
        ("raw provider field", {"component": {"raw_provider_payload": {"id": "payload"}}}),
        ("raw Stripe field", {"component": {"raw_stripe_payload": {"id": "evt_test"}}}),
        ("Bearer token string", {"message": "Authorization failed for Bearer providersecretguardtoken123456"}),
        ("Stripe key string", {"message": "Stripe returned " + "sk_test_" + "secretguardtoken1234567890"}),
        ("Stripe signature string", {"message": "Stripe-Signature: t=1234567890,v1=abcdef1234567890"}),
        ("z.ai key string", {"message": "provider key " + ("0123456789abcdef" * 2) + "." + "abcdefghijklmnop"}),
    ]
    for label, payload in cases:
        try:
            assert_no_secret(payload, f"secret_selftest.{label}")
        except GenerationError:
            rejected += 1
    if rejected != len(cases):
        raise GenerationError(f"secret rejection selftest accepted {len(cases) - rejected} secret/raw case(s)")


def evidence_refs_from_component(component: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    single = component.get("required_evidence_ref")
    if isinstance(single, str):
        refs.append(single)
    multi = component.get("required_evidence_refs")
    if isinstance(multi, list):
        refs.extend(ref for ref in multi if isinstance(ref, str))
    return refs


def proof_anchors(component: dict[str, Any]) -> list[str]:
    return [str(item) for item in component.get("required_proofs", []) if str(item).strip()]


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def truthy_gate_value(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def falsey_gate_value(value: Any) -> bool:
    return value is False or (isinstance(value, str) and value.strip().lower() in {"false", "0", "no"})


def check_level_clear_signal(value: Any, component_id: str) -> bool:
    if not isinstance(value, dict) or value.get("environment") != "production":
        return False
    status = value.get("status")
    if not (is_pass_status(status) or status == "pass_with_blockers_preserved"):
        return False
    gate = value.get("gate_impact")
    if not isinstance(gate, dict):
        return False
    expected_checks = {
        "provider_claims": "production_provider_or_comp_only_mode",
        "security_launch_checks": "production_security_launch_checks",
        "legal_support_policy": "production_legal_support_policy",
        "activation_review_audit": "production_activation_review_audit",
        "abuse_throttle_hold": "production_abuse_throttle_hold",
        "skill_release_eval_canary": "production_skill_release_eval_canary",
    }
    expected_check = expected_checks.get(component_id)
    if expected_check and value.get("release_gate_check_id") != expected_check:
        return False
    if truthy_gate_value(gate.get("can_clear_check_level_item")):
        return True
    for key, child in gate.items():
        normalized = str(key).strip().lower()
        if normalized.startswith("can_clear_") and normalized.endswith("_subitem") and truthy_gate_value(child):
            return True
    return False


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
            if normalized in GATE_CLEAR_FIELDS and child not in (None, ""):
                blockers.append(f"{child_path} is not cleared")
            blockers.extend(blocked_gate_signal_blockers(child, child_path))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            blockers.extend(blocked_gate_signal_blockers(child, f"{path}[{idx}]"))
    return blockers


def run_validator(command: str) -> tuple[bool, str]:
    return run_command(command.split())


def run_command(parts: list[str]) -> tuple[bool, str]:
    result = subprocess.run(parts, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    output = (result.stderr or result.stdout).strip()
    return result.returncode == 0, output


def gate_status(item: dict[str, Any]) -> dict[str, Any]:
    gate_id = str(item["gate_id"])
    path_ref = str(item["path"])
    blockers: list[str] = []
    status = "missing"
    blocked_by_checks: list[Any] = []
    active_dnl: list[Any] = []
    path = repo_path(path_ref)
    if not path.exists():
        blockers.append(f"missing gate fixture: {path_ref}")
    else:
        try:
            data = load_json(path)
            assert_no_secret(data, f"{gate_id}.gate")
            blockers.extend(f"{path_ref} {blocker}" for blocker in blocked_gate_signal_blockers(data, f"{gate_id}.gate"))
            decision = data.get("gate_decision") if isinstance(data.get("gate_decision"), dict) else {}
            status = str(decision.get("status", "missing"))
            blocked_by_checks = decision.get("blocked_by_checks", [])
            active_dnl = decision.get("active_do_not_launch_conditions", [])
            if status != "go":
                blockers.append(f"{path_ref} gate status is {status}, not go")
            if blocked_by_checks:
                blockers.append(f"{path_ref} has blocked_by_checks")
            if active_dnl:
                blockers.append(f"{path_ref} has active do-not-launch conditions")
        except GenerationError as exc:
            blockers.append(str(exc))
    return {
        "gate_id": gate_id,
        "path": path_ref,
        "status": status,
        "blocked_by_checks": blocked_by_checks if isinstance(blocked_by_checks, list) else [],
        "active_do_not_launch_conditions": active_dnl if isinstance(active_dnl, list) else [],
        "blockers": blockers,
    }


def ci_status(ref: str) -> dict[str, Any]:
    blockers: list[str] = []
    status = "missing"
    path = repo_path(ref)
    if not path.exists():
        blockers.append(f"missing CI evidence: {ref}")
    else:
        try:
            data = load_json(path)
            assert_no_secret(data, f"ci.{ref}")
        except GenerationError as exc:
            blockers.append(str(exc))
        else:
            blockers.extend(f"{ref} {blocker}" for blocker in blocked_gate_signal_blockers(data, "ci.evidence"))
            status = str(data.get("status", "missing"))
            if data.get("environment") != "ci":
                blockers.append(f"{ref} environment is not ci")
            if not is_pass_status(data.get("status")):
                blockers.append(f"{ref} status is not pass/passed")
    return {"path": ref, "status": status, "blockers": blockers}


def release_bundle_status(config: dict[str, Any]) -> dict[str, Any]:
    path_ref = str(config.get("path") or "")
    required_status = str(config.get("required_status") or "passed")
    required_decision = str(config.get("required_decision") or "go")
    blockers: list[str] = []
    if not path_ref:
        return {
            "path": "",
            "exists": False,
            "status": "missing",
            "decision": "missing",
            "stage1_staging_runtime_verified": False,
            "stage1_load_verified": False,
            "blockers": ["missing release bundle evidence path"],
        }
    path = repo_path(path_ref)
    if not path.exists():
        return {
            "path": path_ref,
            "exists": False,
            "status": "missing",
            "decision": "missing",
            "stage1_staging_runtime_verified": False,
            "stage1_load_verified": False,
            "blockers": [f"missing release bundle evidence: {path_ref}"],
        }
    try:
        data = load_json(path)
        assert_no_secret(data, "release_bundle.evidence")
    except GenerationError as exc:
        return {
            "path": path_ref,
            "exists": True,
            "status": "invalid",
            "decision": "invalid",
            "stage1_staging_runtime_verified": False,
            "stage1_load_verified": False,
            "blockers": [str(exc)],
        }
    status = str(data.get("status", "missing"))
    decision = str(data.get("decision", "missing"))
    stage1_verified = data.get("stage1_staging_runtime_verified") is True
    stage1_quota_replay_verified = data.get("stage1_quota_replay_verified") is True
    stage1_load_verified = data.get("stage1_load_verified") is True
    object_retention_verified = data.get("object_retention_cleanup_verified") is True
    legal_support_verified = data.get("legal_support_visibility_verified") is True
    ci_ready = data.get("ci_closure_artifacts_ready") is True
    production_split = data.get("production_backup_rollback_split_preflight")
    production_split_ready = (
        isinstance(production_split, dict)
        and production_split.get("exact_split_files_ready") is True
        and production_split.get("upstream_ci_gate_status") == "go"
        and production_split.get("upstream_private_beta_staging_gate_status") == "go"
        and production_split.get("backup_restore_split", {}).get("passed") is True
        and production_split.get("rollback_incident_post_deploy_split", {}).get("passed") is True
    )
    if status != required_status:
        blockers.append(f"{path_ref} status is {status}, not {required_status}")
    if decision != required_decision:
        blockers.append(f"{path_ref} decision is {decision}, not {required_decision}")
    if config.get("required_stage1_staging_runtime_verified") is True and not stage1_verified:
        blockers.append(f"{path_ref} stage1_staging_runtime_verified is not true")
    if config.get("required_stage1_quota_replay_verified") is True and not stage1_quota_replay_verified:
        blockers.append(f"{path_ref} stage1_quota_replay_verified is not true")
    if config.get("required_stage1_load_verified") is True and not stage1_load_verified:
        blockers.append(f"{path_ref} stage1_load_verified is not true")
    if config.get("required_object_retention_cleanup_verified") is True and not object_retention_verified:
        blockers.append(f"{path_ref} object_retention_cleanup_verified is not true")
    if config.get("required_legal_support_visibility_verified") is True and not legal_support_verified:
        blockers.append(f"{path_ref} legal_support_visibility_verified is not true")
    if config.get("required_ci_closure_artifacts_ready") is True and not ci_ready:
        blockers.append(f"{path_ref} ci_closure_artifacts_ready is not true")
    if config.get("required_production_backup_rollback_split_ready") is True and not production_split_ready:
        blockers.append(f"{path_ref} production_backup_rollback_split_ready is not true")
    missing_slots = data.get("missing_slots", [])
    unverified_slots = data.get("unverified_slots", [])
    release_metadata_preflight = data.get("release_metadata_preflight")
    if not isinstance(release_metadata_preflight, dict):
        release_metadata_preflight = {}
    release_sha = data.get("release_sha") or release_metadata_preflight.get("release_sha")
    release_notes_path = data.get("release_notes_path") or release_metadata_preflight.get("release_notes_path")
    release_image_refs = data.get("image_refs") or release_metadata_preflight.get("image_refs")
    stage1_blocking_reasons = data.get("stage1_staging_runtime_blocking_reasons", [])
    stage1_quota_replay_blocking_reasons = data.get("stage1_quota_replay_blocking_reasons", [])
    stage1_load_blocking_reasons = data.get("stage1_load_blocking_reasons", [])
    blocking_reasons = data.get("blocking_reasons", [])
    ci_blocking_reasons = data.get("ci_closure_artifact_blocking_reasons", [])
    production_split_blocking_reasons = data.get("production_backup_rollback_split_blocking_reasons", [])
    if not isinstance(missing_slots, list):
        missing_slots = []
    if not isinstance(unverified_slots, list):
        unverified_slots = []
    if not isinstance(blocking_reasons, list):
        blocking_reasons = []
    if not isinstance(ci_blocking_reasons, list):
        ci_blocking_reasons = []
    if not isinstance(production_split_blocking_reasons, list):
        production_split_blocking_reasons = []
    if config.get("required_missing_slots_empty") is True and missing_slots:
        blockers.append(f"{path_ref} missing_slots is not empty")
    if config.get("required_unverified_slots_empty") is True and unverified_slots:
        blockers.append(f"{path_ref} unverified_slots is not empty")
    if config.get("required_blocking_reasons_empty") is True and blocking_reasons:
        blockers.append(f"{path_ref} blocking_reasons is not empty")
    return {
        "path": path_ref,
        "exists": True,
        "status": status,
        "decision": decision,
        "release_sha": release_sha,
        "release_notes_path": release_notes_path,
        "image_refs": release_image_refs if isinstance(release_image_refs, list) else [],
        "release_metadata_preflight": {
            "path": release_metadata_preflight.get("path"),
            "status": release_metadata_preflight.get("status"),
            "metadata_complete": release_metadata_preflight.get("metadata_complete"),
            "release_sha": release_metadata_preflight.get("release_sha"),
            "release_notes_path": release_metadata_preflight.get("release_notes_path"),
            "missing_slots": release_metadata_preflight.get("missing_slots", []),
            "unverified_slots": release_metadata_preflight.get("unverified_slots", []),
        },
        "stage1_staging_runtime_verified": stage1_verified,
        "stage1_quota_replay_verified": stage1_quota_replay_verified,
        "stage1_load_verified": stage1_load_verified,
        "object_retention_cleanup_verified": object_retention_verified,
        "legal_support_visibility_verified": legal_support_verified,
        "ci_closure_artifacts_ready": ci_ready,
        "production_backup_rollback_split_ready": production_split_ready,
        "stage1_staging_runtime_blocking_reasons": stage1_blocking_reasons if isinstance(stage1_blocking_reasons, list) else [],
        "stage1_quota_replay_blocking_reasons": stage1_quota_replay_blocking_reasons if isinstance(stage1_quota_replay_blocking_reasons, list) else [],
        "stage1_load_blocking_reasons": stage1_load_blocking_reasons if isinstance(stage1_load_blocking_reasons, list) else [],
        "missing_slots": missing_slots,
        "unverified_slots": unverified_slots,
        "ci_closure_artifact_blocking_reasons": ci_blocking_reasons,
        "production_backup_rollback_split_blocking_reasons": production_split_blocking_reasons,
        "blocking_reason_count": data.get("blocking_reason_count"),
        "blocking_reasons": blocking_reasons,
        "blockers": blockers,
    }


def component_status(component: dict[str, Any]) -> dict[str, Any]:
    component_id = str(component["component_id"])
    refs = evidence_refs_from_component(component)
    blockers: list[str] = []
    secret_leak_detected = False
    raw_payload_persisted = False
    exact_evidence = True
    check_level_clear_refs: list[str] = []

    for ref in refs:
        path = repo_path(ref)
        if not path.exists():
            blockers.append(f"missing evidence: {ref}")
            exact_evidence = False
            continue
        try:
            data = load_json(path)
            assert_no_secret(data, f"{component_id}.{ref}")
        except GenerationError as exc:
            blockers.append(str(exc))
            exact_evidence = False
            secret_leak_detected = True
            continue
        blockers.extend(f"{ref} {blocker}" for blocker in blocked_gate_signal_blockers(data, f"{component_id}.evidence"))
        if data.get("environment") != "production":
            blockers.append(f"{ref} environment is not production")
        if not is_pass_status(data.get("status")):
            blockers.append(f"{ref} status is not pass/passed")
        markers = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
        if markers:
            blockers.append(f"{ref} contains blocked marker(s): {markers}")
        gate_impact = data.get("gate_impact") if isinstance(data.get("gate_impact"), dict) else {}
        if gate_impact.get("can_clear_aggregate_production_gate") is False:
            blockers.append(f"{ref} preserves aggregate production blockers")
        if gate_impact.get("remaining_blockers"):
            blockers.append(f"{ref} has remaining production blockers")
        if check_level_clear_signal(data, component_id):
            check_level_clear_refs.append(ref)

    passed = not blockers
    check_level_passed = bool(refs) and set(refs) == set(check_level_clear_refs)
    return {
        "component_id": component_id,
        "environment": "production",
        "status": "passed" if passed else "blocked",
        "exact_evidence": exact_evidence and passed,
        "dry_run": False,
        "local_only": False,
        "secret_leak_detected": secret_leak_detected,
        "raw_payload_persisted": raw_payload_persisted,
        "blockers_preserved": not passed,
        "check_level_passed": check_level_passed,
        "check_level_blockers_preserved": check_level_passed and not passed,
        "check_level_evidence_refs": check_level_clear_refs,
        "evidence_refs": refs,
        "proofs": proof_anchors(component),
        "blockers": blockers,
    }


def build_report(contract: dict[str, Any], evidence_path: Path, results_path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    gates = [gate_status(item) for item in contract["required_gate_fixtures"] if isinstance(item, dict)]
    ci_evidence = [ci_status(str(ref)) for ref in contract.get("required_ci_evidence", [])]
    release_bundle = release_bundle_status(contract.get("required_release_bundle_evidence", {}))
    components = [component_status(item) for item in contract["required_components"] if isinstance(item, dict)]

    child_validator_blockers: list[str] = []
    child_validator_commands = [
        "python3 scripts/validate_stage0_rev2.py",
        "python3 scripts/validate_stage1_staging_runtime.py",
        "python3 scripts/validate_stage1_production_security_launch_evidence.py",
        "python3 scripts/validate_stage1_production_provider_claims_evidence.py",
        "python3 scripts/validate_stage1_production_governance_release_evidence.py",
        "python3 scripts/validate_stage1_production_legal_support_evidence.py",
        "python3 scripts/validate_stage1_production_billing_evidence.py",
        "python3 scripts/validate_stage1_production_backup_rollback_evidence.py",
    ]
    for command in child_validator_commands:
        passed, output = run_validator(command)
        if not passed:
            child_validator_blockers.append(f"{command}: {output}")

    blockers = [
        f"{gate['gate_id']}: {blocker}" for gate in gates for blocker in gate.get("blockers", [])
    ]
    blockers.extend(f"ci: {blocker}" for item in ci_evidence for blocker in item.get("blockers", []))
    blockers.extend(f"release_bundle: {blocker}" for blocker in release_bundle.get("blockers", []))
    blockers.extend(
        f"{component['component_id']}: {blocker}"
        for component in components
        for blocker in component.get("blockers", [])
    )
    blockers.extend(f"strict child validator failed: {blocker}" for blocker in child_validator_blockers)

    passed_all = not blockers
    runtime_input_readiness = {
        "ci_gate_ready": not any(gate["gate_id"] == "ci" and gate["blockers"] for gate in gates),
        "staging_gate_ready": not any(gate["gate_id"] == "private_beta_staging" and gate["blockers"] for gate in gates)
        and not any("validate_stage1_staging_runtime.py" in blocker for blocker in child_validator_blockers),
        "release_bundle_ready": not release_bundle.get("blockers"),
        "release_bundle_stage1_staging_runtime_verified": release_bundle.get("stage1_staging_runtime_verified") is True,
        "release_bundle_stage1_quota_replay_verified": release_bundle.get("stage1_quota_replay_verified") is True,
        "release_bundle_stage1_load_verified": release_bundle.get("stage1_load_verified") is True,
        "production_provider_ready_or_comp_only": not any(
            component["component_id"] == "provider_claims" and component["blockers"] for component in components
        )
        and not any("validate_stage1_production_provider_claims_evidence.py" in blocker for blocker in child_validator_blockers),
        "production_billing_ready": not any(
            component["component_id"] == "paid_billing_lifecycle" and component["blockers"] for component in components
        )
        and not any("validate_stage1_production_billing_evidence.py" in blocker for blocker in child_validator_blockers),
        "production_backup_restore_ready": not any(
            component["component_id"] == "backup_restore" and component["blockers"] for component in components
        )
        and not any("validate_stage1_production_backup_rollback_evidence.py" in blocker for blocker in child_validator_blockers),
        "production_rollback_incident_smoke_ready": not any(
            component["component_id"] == "rollback_incident_post_deploy" and component["blockers"] for component in components
        )
        and not any("validate_stage1_production_backup_rollback_evidence.py" in blocker for blocker in child_validator_blockers),
        "production_security_ready": not any(
            component["component_id"] == "security_launch_checks" and component["blockers"] for component in components
        )
        and not any("validate_stage1_production_security_launch_evidence.py" in blocker for blocker in child_validator_blockers),
        "production_legal_support_ready": not any(
            component["component_id"] == "legal_support_policy" and component["blockers"] for component in components
        )
        and not any("validate_stage1_production_legal_support_evidence.py" in blocker for blocker in child_validator_blockers),
        "production_governance_release_ready": not any(
            component["component_id"] in {"activation_review_audit", "abuse_throttle_hold", "skill_release_eval_canary"}
            and component["blockers"]
            for component in components
        )
        and not any("validate_stage1_production_governance_release_evidence.py" in blocker for blocker in child_validator_blockers),
        "release_notes_match_gate_fixtures": passed_all,
    }

    report: dict[str, Any] = {
        "schema_version": "stage1.production_launch.v1",
        "environment": "production",
        "kind": "stage1_production_launch",
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "status": "pass" if passed_all else "blocked",
        "release_gate_decision": "go" if passed_all else "no_go",
        "all_release_gates_go": not any(gate["blockers"] for gate in gates),
        "all_components_passed": not any(component["blockers"] for component in components),
        "do_not_launch_conditions": [] if passed_all else ["stage1_production_launch_evidence_incomplete"],
        "runtime_input_readiness": runtime_input_readiness,
        "release_gate_fixtures": gates,
        "ci_evidence": ci_evidence,
        "release_bundle_preflight": release_bundle,
        "components": components,
        "validator_commands": child_validator_commands + [f"python3 {STRICT_VALIDATOR}"],
        "blockers": blockers,
    }
    for field in SAFE_FALSE_FIELDS:
        report[field] = False

    rows = [
        {
            "component_id": component["component_id"],
            "environment": "production",
            "status": component["status"],
            "exact_evidence": component["exact_evidence"],
            "secret_leak_detected": component["secret_leak_detected"],
            "raw_payload_persisted": component["raw_payload_persisted"],
            "blockers_preserved": component["blockers_preserved"],
            "check_level_passed": component["check_level_passed"],
            "check_level_blockers_preserved": component["check_level_blockers_preserved"],
            "check_level_evidence_refs": component["check_level_evidence_refs"],
            "evidence_refs": component["evidence_refs"],
            "blockers": component["blockers"],
        }
        for component in components
    ]

    if passed_all:
        write_json(evidence_path, report)
        write_ndjson(results_path, rows)
        passed, output = run_command(
            [
                "python3",
                STRICT_VALIDATOR,
                "--evidence",
                str(evidence_path),
                "--results",
                str(results_path),
            ]
        )
        if passed:
            return report, rows
        report["status"] = "blocked"
        report["release_gate_decision"] = "no_go"
        report["all_release_gates_go"] = False
        report["all_components_passed"] = False
        report["do_not_launch_conditions"] = ["stage1_production_launch_strict_validator_failed"]
        report["blockers"] = [f"strict aggregate validator failed: {output}"]
        for row in rows:
            row["status"] = "blocked"
            row["exact_evidence"] = False
            row["blockers_preserved"] = True
            row["blockers"] = report["blockers"]

    return report, rows


def validate_contract_only() -> None:
    passed, output = run_validator("python3 scripts/validate_stage1_production_launch.py --contract-only")
    if not passed:
        raise GenerationError(output)
    validate_secret_rejection_selftest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate generator and aggregate gate contract anchors only")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="output aggregate evidence JSON path")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="output aggregate NDJSON results path")
    args = parser.parse_args()

    try:
        validate_contract_only()
        if args.contract_only:
            print("stage1 production launch generator contract passed")
            return 0
        evidence_path = Path(args.evidence)
        results_path = Path(args.results)
        if not evidence_path.is_absolute():
            evidence_path = ROOT / evidence_path
        if not results_path.is_absolute():
            results_path = ROOT / results_path
        contract = load_json(CONTRACT)
        report, rows = build_report(contract, evidence_path, results_path)
        assert_no_secret(report, "report")
        assert_no_secret(rows, "results")
        write_json(evidence_path, report)
        write_ndjson(results_path, rows)
    except GenerationError as exc:
        print(f"stage1 production launch evidence generation failed: {exc}", file=sys.stderr)
        return 1

    if report["status"] == "pass":
        print(f"stage1 production launch evidence generated: pass ({display_path(evidence_path)})")
        return 0
    print(f"stage1 production launch evidence generated: blocked ({display_path(evidence_path)})")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
