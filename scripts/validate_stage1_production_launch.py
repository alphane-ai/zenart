#!/usr/bin/env python3
"""Validate Stage 1 aggregate production launch readiness evidence.

Contract-only mode validates the production launch gate definition and related
Stage 0/Stage 1 validators. Strict mode requires canonical production evidence,
passing CI and staging dependencies, and no active Do-Not-Launch conditions.
`--allow-preflight` accepts only the generator's blocked aggregate diagnostic so
Admin/Release can display it without treating it as launch-clearing evidence.
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
CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "stage1-production-launch.json"
DEFAULT_RESULTS = ROOT / "ops" / "evidence" / "production" / "stage1-production-launch.ndjson"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
README = ROOT / "README.md"
NO_GO_NOTES = ROOT / "ops" / "release" / "stage0_rev2_current_no_go_release_notes.md"
AGGREGATE_GENERATOR = ROOT / "scripts" / "generate_stage1_production_launch_evidence.py"

REQUIRED_COMPONENTS = {
    "provider_claims",
    "paid_billing_lifecycle",
    "backup_restore",
    "rollback_incident_post_deploy",
    "security_launch_checks",
    "legal_support_policy",
    "activation_review_audit",
    "abuse_throttle_hold",
    "skill_release_eval_canary",
}

REQUIRED_GATES = {
    "local_alpha",
    "ci",
    "private_beta_staging",
    "production_launch",
}

CHILD_VALIDATORS = {
    "scripts/validate_stage0_rev2.py",
    "scripts/validate_stage1_staging_runtime.py",
    "scripts/validate_stage1_production_security_launch_evidence.py",
    "scripts/validate_stage1_production_provider_claims_evidence.py",
    "scripts/validate_stage1_production_governance_release_evidence.py",
    "scripts/validate_stage1_production_legal_support_evidence.py",
    "scripts/validate_stage1_production_billing_evidence.py",
    "scripts/validate_stage1_production_backup_rollback_evidence.py",
    "scripts/render_no_go_release_notes.py",
}

STRICT_CHILD_VALIDATORS = {
    "scripts/validate_stage0_rev2.py",
    "scripts/validate_stage1_staging_runtime.py",
    "scripts/validate_stage1_production_security_launch_evidence.py",
    "scripts/validate_stage1_production_provider_claims_evidence.py",
    "scripts/validate_stage1_production_governance_release_evidence.py",
    "scripts/validate_stage1_production_legal_support_evidence.py",
    "scripts/validate_stage1_production_billing_evidence.py",
    "scripts/validate_stage1_production_backup_rollback_evidence.py",
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
}

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|X-Amz-Signature|GoogleAccessId)"
)

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

PASS_STATUSES = {"pass", "passed"}
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


class Stage1ProductionLaunchError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1ProductionLaunchError(message)


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
        raise Stage1ProductionLaunchError(f"path escapes repo root: {ref}") from exc
    return path


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise Stage1ProductionLaunchError(f"{display_path(path)} invalid JSON: {exc}") from exc
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
            raise Stage1ProductionLaunchError(f"{display_path(path)}:{lineno} invalid JSON: {exc}") from exc
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
        except Stage1ProductionLaunchError:
            rejected += 1
    require(rejected == len(cases), f"secret rejection selftest accepted {len(cases) - rejected} secret/raw case(s)")


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


def require_no_blocked_gate_signals(value: Any, path: str) -> None:
    blockers = blocked_gate_signal_blockers(value, path)
    require(not blockers, f"{path} contains blocked/debug-only gate signal(s): {blockers}")


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
    require(contract.get("schema_version") == "stage1.production_launch.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "production_launch_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/production/stage1-production-launch.json", "contract evidence path mismatch")
    require(contract.get("canonical_results_path") == "ops/evidence/production/stage1-production-launch.ndjson", "contract results path mismatch")
    require(contract.get("strict_schema_version") == "stage1.production_launch.v1", "contract strict schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_production_launch_evidence_open", "contract must not close production gate")

    gates = contract.get("required_gate_fixtures")
    require(isinstance(gates, list) and gates, "required_gate_fixtures must be non-empty")
    gate_by_id = {item.get("gate_id"): item for item in gates if isinstance(item, dict)}
    require(REQUIRED_GATES <= set(gate_by_id), f"contract missing gates {sorted(REQUIRED_GATES - set(gate_by_id))}")
    for gate_id in REQUIRED_GATES:
        item = gate_by_id[gate_id]
        require(item.get("required_status") == "go", f"{gate_id} must require go")
        path = item.get("path")
        require(isinstance(path, str) and path.startswith("fixtures/stage0/rev2/release_gate_evidence."), f"{gate_id} gate path mismatch")

    ci_refs = contract.get("required_ci_evidence")
    require(isinstance(ci_refs, list) and len(ci_refs) == 3, "required_ci_evidence must list three exact files")
    for ref in ci_refs:
        require(isinstance(ref, str) and ref.startswith("ops/evidence/ci/"), f"CI evidence ref must be under ops/evidence/ci/: {ref}")

    release_bundle = contract.get("required_release_bundle_evidence")
    require(isinstance(release_bundle, dict), "required_release_bundle_evidence must be object")
    require(
        release_bundle.get("path") == "ops/evidence/release/staging/stage0-rev2-current-release-evidence-bundle.json",
        "release bundle evidence path mismatch",
    )
    require(release_bundle.get("required_status") == "passed", "release bundle must require passed status")
    require(release_bundle.get("required_decision") == "go", "release bundle must require go decision")
    for key in (
        "required_stage1_staging_runtime_verified",
        "required_stage1_quota_replay_verified",
        "required_stage1_load_verified",
        "required_object_retention_cleanup_verified",
        "required_legal_support_visibility_verified",
        "required_ci_closure_artifacts_ready",
        "required_production_backup_rollback_split_ready",
        "required_missing_slots_empty",
        "required_unverified_slots_empty",
        "required_blocking_reasons_empty",
    ):
        require(release_bundle.get(key) is True, f"release bundle {key} must be true")

    components = contract.get("required_components")
    require(isinstance(components, list) and components, "required_components must be non-empty")
    by_id = {item.get("component_id"): item for item in components if isinstance(item, dict)}
    require(REQUIRED_COMPONENTS <= set(by_id), f"contract missing components {sorted(REQUIRED_COMPONENTS - set(by_id))}")
    for component_id in REQUIRED_COMPONENTS:
        component = by_id[component_id]
        refs = evidence_refs_from_contract_component(component)
        require(refs, f"{component_id} must declare evidence refs")
        for ref in refs:
            require(ref.startswith("ops/evidence/production/"), f"{component_id} evidence ref must stay under ops/evidence/production/: {ref}")
        status_values = set(component.get("required_status_values") or [])
        require(status_values & PASS_STATUSES, f"{component_id} must require pass status")
        proofs = component.get("required_proofs")
        require(isinstance(proofs, list) and len(proofs) >= 3, f"{component_id} required_proofs must be specific")

    child_validators = contract.get("required_child_validators")
    require(isinstance(child_validators, list), "required_child_validators must be list")
    declared = {item.get("validator") for item in child_validators if isinstance(item, dict)}
    require(CHILD_VALIDATORS <= declared, f"contract missing child validators {sorted(CHILD_VALIDATORS - declared)}")

    smoke_scripts = set(contract.get("required_stage0_smoke_scripts") or [])
    for script in ("scripts/production_backup_rollback_split_smoke.sh", "scripts/release_evidence_bundle_smoke.sh"):
        require(script in smoke_scripts, f"contract missing smoke script {script}")

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
    ):
        require(safe_policy.get(key) is False, f"safe_projection_policy.{key} must be false")

    strict_policy = contract.get("strict_evidence_policy")
    require(isinstance(strict_policy, dict), "strict_evidence_policy must be object")
    require(strict_policy.get("environment") == "production", "strict policy environment mismatch")
    require(strict_policy.get("kind") == "stage1_production_launch", "strict policy kind mismatch")
    require(strict_policy.get("status") == "pass", "strict policy status mismatch")
    require(strict_policy.get("release_gate_decision") == "go", "strict policy release gate mismatch")
    require(strict_policy.get("allow_blocked_component") is False, "strict policy must reject blocked components")
    require(strict_policy.get("allow_blockers_preserved_status") is False, "strict policy must reject blockers-preserved status")
    require(strict_policy.get("all_release_gate_fixtures_must_be_go") is True, "strict policy must require all gates go")
    require(strict_policy.get("allow_local_devport_debug") is False, "strict policy must reject local devport debug evidence")
    require(strict_policy.get("allow_local_devport_evidence") is False, "strict policy must reject local devport evidence")
    require(strict_policy.get("canonical_pass_path_required") is True, "strict policy must require canonical pass paths")
    require(strict_policy.get("gate_impact_can_clear_required") is True, "strict policy must require gate impact can_clear flags")
    require(strict_policy.get("strict_staging_validator_must_pass") is True, "strict policy must require strict staging validator")
    require(strict_policy.get("do_not_launch_conditions_must_be_empty") is True, "strict policy must require no active DNL")

    preflight_policy = contract.get("aggregate_preflight_policy")
    require(isinstance(preflight_policy, dict), "aggregate_preflight_policy must be object")
    require(preflight_policy.get("validator_command") == "python3 scripts/validate_stage1_production_launch.py --allow-preflight", "aggregate preflight validator command mismatch")
    require(preflight_policy.get("generator_command") == "python3 scripts/generate_stage1_production_launch_evidence.py", "aggregate preflight generator command mismatch")
    require(preflight_policy.get("accepted_schema_version") == "stage1.production_launch.v1", "aggregate preflight schema mismatch")
    require(preflight_policy.get("accepted_status") == "blocked", "aggregate preflight status mismatch")
    require(preflight_policy.get("accepted_release_gate_decision") == "no_go", "aggregate preflight decision mismatch")
    require(preflight_policy.get("can_clear_stage1_production_launch_gate") is False, "aggregate preflight must not clear production gate")
    require(preflight_policy.get("can_close_do_not_launch") is False, "aggregate preflight must not close DNL")
    require(preflight_policy.get("must_preserve_do_not_launch_condition") == "stage1_production_launch_evidence_incomplete", "aggregate preflight DNL mismatch")
    require(preflight_policy.get("must_surface_ci_evidence_state") is True, "aggregate preflight must surface CI evidence state")
    require(preflight_policy.get("must_surface_release_bundle_blockers") is True, "aggregate preflight must surface release bundle blockers")
    require(preflight_policy.get("must_surface_blocked_child_components") is True, "aggregate preflight must surface blocked child components")
    require(preflight_policy.get("strict_validator_still_rejects_preflight") is True, "aggregate preflight must keep strict validator rejecting blocked evidence")

    remaining = contract.get("remaining_production_evidence")
    require(isinstance(remaining, list) and len(remaining) >= 6, "remaining_production_evidence must preserve open production proof")


def validate_code_anchors() -> None:
    require(AGGREGATE_GENERATOR.exists(), "missing scripts/generate_stage1_production_launch_evidence.py")
    require(AGGREGATE_GENERATOR.stat().st_mode & 0o111 != 0, "scripts/generate_stage1_production_launch_evidence.py must be executable")
    require_text(
        AGGREGATE_GENERATOR,
        (
            "stage1-production-launch.json",
            "stage1-production-launch.ndjson",
            "stage1.production_launch.v1",
            "release_gate_decision",
            "required_release_bundle_evidence",
            "release_bundle_preflight",
            "stage1_staging_runtime_verified",
            "stage1_quota_replay_verified",
            "stage1_load_verified",
            "missing_slots",
            "unverified_slots",
            "blocking_reasons",
            "stage1_production_launch_evidence_incomplete",
            "strict child validator failed",
            "validate_stage1_production_security_launch_evidence.py",
            "validate_stage1_production_provider_claims_evidence.py",
            "validate_stage1_production_governance_release_evidence.py",
            "validate_stage1_production_legal_support_evidence.py",
            "validate_stage1_production_billing_evidence.py",
            "validate_stage1_production_backup_rollback_evidence.py",
            "local_devport_debug",
            "allow_local_devport_evidence",
            "canonical_pass_path",
            "can_clear_",
            "validate_secret_rejection_selftest",
            'assert_no_secret(report, "report")',
            'assert_no_secret(rows, "results")',
        ),
    )
    for validator in CHILD_VALIDATORS:
        path = resolve_repo_path(validator)
        require(path.exists(), f"missing {validator}")
        if validator.endswith(".py"):
            require(path.stat().st_mode & 0o111 != 0, f"{validator} must be executable")

    for script in ("scripts/production_backup_rollback_split_smoke.sh", "scripts/release_evidence_bundle_smoke.sh"):
        path = resolve_repo_path(script)
        require(path.exists(), f"missing {script}")
        require(path.stat().st_mode & 0o111 != 0, f"{script} must be executable")

    require_text(
        BLUEPRINT,
        (
            "VF-7",
            "scripts/validate_stage1_production_launch.py",
            "Production Launch",
            "CI Gate 和 Private Beta/Staging Gate fixture 均计算为 `go`",
            "Production backup/restore、rollback/incident/post-deploy smoke exact evidence",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage1_staging_runtime.py"),
        (
            "stage1-runtime.json",
            "stage1.staging_runtime.v1",
            "release_gate_decision",
        ),
    )
    require_text(
        resolve_repo_path("scripts/validate_stage0_rev2.py"),
        (
            "validate_production_security_launch_checks_evidence",
            "validate_production_legal_support_policy_evidence",
            "validate_production_backup_rollback_split_preflight_evidence",
            "ops/evidence/production/billing-lifecycle.json",
            "fixtures/stage0/rev2/release_gate_evidence.production_launch.json",
        ),
    )
    require_text(
        resolve_repo_path("scripts/production_backup_rollback_split_smoke.sh"),
        (
            "ops/evidence/production/backup-restore.json",
            "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
            "blocked_by_upstream_gates",
        ),
    )
    require_text(
        resolve_repo_path("scripts/render_no_go_release_notes.py"),
        (
            "Production Launch gate",
            "production_backup_rollback_split_summary",
            "stage0_rev2_current_no_go_release_notes.md",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "render_no_go_release_notes.py --check",
            "validate_stage1_staging_runtime.py --contract-only",
            "generate_stage1_production_launch_evidence.py --contract-only",
            "stage1_production_launch_evidence_incomplete",
            "require_no_blocked_gate_signals",
            "--allow-preflight",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-7",
            "production launch contract",
            "strict validator",
        ),
    )
    require_text(
        README,
        (
            "Production Launch Gate: no-go",
            "ops/evidence/production/backup-restore.json",
            "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
        ),
    )
    require_text(
        NO_GO_NOTES,
        (
            "Production Launch gate: `no_go`",
            "Production backup exact split",
            "Production rollback/incident/post-deploy exact split",
        ),
    )


def validate_gate_fixture(path_ref: str, gate_id: str) -> None:
    data = load_json(resolve_repo_path(path_ref))
    assert_no_secret(data, f"{gate_id}.gate")
    require_no_blocked_gate_signals(data, f"{gate_id}.gate")
    decision = data.get("gate_decision")
    require(isinstance(decision, dict), f"{gate_id} gate_decision must be object")
    require(decision.get("status") == "go", f"{gate_id} gate fixture must be go")
    require(decision.get("blocked_by_checks") == [], f"{gate_id} blocked_by_checks must be empty")
    require(decision.get("active_do_not_launch_conditions") == [], f"{gate_id} active DNL conditions must be empty")


def validate_component_ref(ref: str, component_id: str) -> dict[str, Any]:
    require(ref.startswith("ops/evidence/production/"), f"{component_id} evidence ref must stay under ops/evidence/production/: {ref}")
    data = load_json(resolve_repo_path(ref))
    assert_no_secret(data, f"{component_id}.evidence")
    require_no_blocked_gate_signals(data, f"{component_id}.evidence")
    require(data.get("environment") == "production", f"{component_id} evidence must be production")
    require(is_pass_status(data.get("status")), f"{component_id} evidence status must be pass/passed")
    strings = normalized_string_values(data)
    blocked = sorted(strings & BLOCKED_MARKERS)
    require(not blocked, f"{component_id} evidence contains blocked/deferred/no-go marker(s): {blocked}")
    for key in ("do_not_launch_condition_id", "preserved_do_not_launch_condition_id"):
        if key in data:
            require(data.get(key) in {None, ""}, f"{component_id} evidence must clear {key}")
    if "do_not_launch_condition_ids" in data:
        require(data.get("do_not_launch_condition_ids") in {[], None}, f"{component_id} evidence must clear do_not_launch_condition_ids")
    gate_impact = data.get("gate_impact") if isinstance(data.get("gate_impact"), dict) else {}
    require(gate_impact.get("can_clear_aggregate_production_gate") in {True, None}, f"{component_id} must not preserve aggregate production blockers")
    require(not gate_impact.get("remaining_blockers"), f"{component_id} gate_impact.remaining_blockers must be empty")
    return data


def validate_release_bundle_preflight(preflight: Any, contract_config: dict[str, Any]) -> None:
    require(isinstance(preflight, dict), "release_bundle_preflight must be object")
    path_ref = contract_config.get("path")
    require(preflight.get("path") == path_ref, "release_bundle_preflight path mismatch")
    require(preflight.get("exists") is True, "release_bundle_preflight evidence must exist")
    require(preflight.get("status") == contract_config.get("required_status"), "release_bundle_preflight status mismatch")
    require(preflight.get("decision") == contract_config.get("required_decision"), "release_bundle_preflight decision mismatch")
    for key in (
        "stage1_staging_runtime_verified",
        "stage1_quota_replay_verified",
        "stage1_load_verified",
        "object_retention_cleanup_verified",
        "legal_support_visibility_verified",
        "ci_closure_artifacts_ready",
        "production_backup_rollback_split_ready",
    ):
        require(preflight.get(key) is True, f"release_bundle_preflight.{key} must be true")
    require(preflight.get("missing_slots") == [], "release_bundle_preflight.missing_slots must be empty")
    require(preflight.get("unverified_slots") == [], "release_bundle_preflight.unverified_slots must be empty")
    require(preflight.get("blocking_reasons") == [], "release_bundle_preflight.blocking_reasons must be empty")
    require(preflight.get("blocking_reason_count") in {0, None}, "release_bundle_preflight.blocking_reason_count must be zero")
    require(preflight.get("blockers") == [], "release_bundle_preflight blockers must be empty")

    bundle = load_json(resolve_repo_path(str(path_ref)))
    assert_no_secret(bundle, "release_bundle.evidence")
    require(bundle.get("status") == contract_config.get("required_status"), "release bundle evidence status mismatch")
    require(bundle.get("decision") == contract_config.get("required_decision"), "release bundle evidence decision mismatch")
    require(bundle.get("stage1_staging_runtime_verified") is True, "release bundle must verify Stage 1 staging runtime")
    require(bundle.get("stage1_quota_replay_verified") is True, "release bundle must verify Stage 1 quota replay")
    require(bundle.get("stage1_load_verified") is True, "release bundle must verify Stage 1 load")
    require(bundle.get("object_retention_cleanup_verified") is True, "release bundle must verify object retention cleanup")
    require(bundle.get("legal_support_visibility_verified") is True, "release bundle must verify legal/support visibility")
    require(bundle.get("ci_closure_artifacts_ready") is True, "release bundle must verify CI closure artifacts")
    require(bundle.get("missing_slots") == [], "release bundle missing_slots must be empty")
    require(bundle.get("unverified_slots") == [], "release bundle unverified_slots must be empty")
    require(bundle.get("blocking_reasons") == [], "release bundle blocking_reasons must be empty")
    require(bundle.get("blocking_reason_count") in {0, None}, "release bundle blocking_reason_count must be zero")
    split = bundle.get("production_backup_rollback_split_preflight")
    require(isinstance(split, dict), "release bundle production split preflight must be object")
    require(split.get("exact_split_files_ready") is True, "release bundle must verify production backup/rollback split readiness")
    require(split.get("upstream_ci_gate_status") == "go", "release bundle production split must depend on CI go")
    require(split.get("upstream_private_beta_staging_gate_status") == "go", "release bundle production split must depend on staging go")
    require(split.get("backup_restore_split", {}).get("passed") is True, "release bundle backup split must pass")
    require(split.get("rollback_incident_post_deploy_split", {}).get("passed") is True, "release bundle rollback split must pass")


def run_strict_child_validator(command: str) -> None:
    parts = command.split()
    require(len(parts) == 2 and parts[0] == "python3", f"invalid validator command {command}")
    require(parts[1] in STRICT_CHILD_VALIDATORS, f"unexpected strict validator {parts[1]}")
    result = subprocess.run(parts, cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if result.returncode != 0:
        output = (result.stderr or result.stdout).strip()
        raise Stage1ProductionLaunchError(f"strict child validator failed: {command}: {output}")


def validate_component(component: dict[str, Any], contract_component: dict[str, Any]) -> None:
    component_id = component.get("component_id")
    require(component_id in REQUIRED_COMPONENTS, f"unexpected component {component_id!r}")
    require_no_blocked_gate_signals(component, f"{component_id}.aggregate")
    require(component.get("status") == "passed", f"{component_id} aggregate status must be passed")
    require(component.get("environment") == "production", f"{component_id} aggregate environment must be production")
    require(component.get("exact_evidence") is True, f"{component_id} must be exact evidence")
    require(component.get("dry_run") is False, f"{component_id} dry_run must be false")
    require(component.get("local_only") is False, f"{component_id} local_only must be false")
    require(component.get("secret_leak_detected") is False, f"{component_id} secret_leak_detected must be false")
    require(component.get("raw_payload_persisted") is False, f"{component_id} raw_payload_persisted must be false")
    require(component.get("blockers_preserved") is False, f"{component_id} blockers_preserved must be false")

    evidence_refs = component.get("evidence_refs")
    require(isinstance(evidence_refs, list) and evidence_refs, f"{component_id} evidence_refs must be non-empty")
    required_refs = set(evidence_refs_from_contract_component(contract_component))
    require(required_refs <= set(evidence_refs), f"{component_id} missing required evidence refs {sorted(required_refs - set(evidence_refs))}")
    for ref in evidence_refs:
        require(isinstance(ref, str), f"{component_id} evidence ref must be string")
        validate_component_ref(ref, str(component_id))

    proofs = component.get("proofs")
    require(isinstance(proofs, list) and proofs, f"{component_id} proofs must be non-empty")
    required_proofs = {str(item).lower() for item in contract_component.get("required_proofs", [])}
    proof_values = {str(item).lower() for item in proofs}
    missing = [proof for proof in sorted(required_proofs) if all(proof not in item for item in proof_values)]
    require(not missing, f"{component_id} missing proof anchors {missing}")


def validate_preflight_component(component: dict[str, Any], contract_component: dict[str, Any]) -> None:
    component_id = component.get("component_id")
    require(component_id in REQUIRED_COMPONENTS, f"unexpected preflight component {component_id!r}")
    require(component.get("environment") == "production", f"{component_id} preflight environment must be production")
    blockers = component.get("blockers")
    require(isinstance(blockers, list), f"{component_id} preflight blockers must be a list")
    if blockers:
        require(component.get("status") == "blocked", f"{component_id} preflight status must be blocked when blockers exist")
        require(component.get("exact_evidence") is False, f"{component_id} preflight exact_evidence must be false when blockers exist")
        require(component.get("blockers_preserved") is True, f"{component_id} preflight blockers_preserved must be true when blockers exist")
    else:
        require(component.get("status") == "passed", f"{component_id} preflight status must be passed when exact evidence is ready")
        require(component.get("exact_evidence") is True, f"{component_id} preflight exact_evidence must be true when exact evidence is ready")
        require(component.get("blockers_preserved") is False, f"{component_id} preflight blockers_preserved must be false when exact evidence is ready")
    require(component.get("dry_run") is False, f"{component_id} preflight dry_run must be false")
    require(component.get("local_only") is False, f"{component_id} preflight local_only must be false")
    require(component.get("secret_leak_detected") is False, f"{component_id} preflight secret_leak_detected must be false")
    require(component.get("raw_payload_persisted") is False, f"{component_id} preflight raw_payload_persisted must be false")

    evidence_refs = component.get("evidence_refs")
    require(isinstance(evidence_refs, list) and evidence_refs, f"{component_id} preflight evidence_refs must be non-empty")
    required_refs = set(evidence_refs_from_contract_component(contract_component))
    require(required_refs <= set(evidence_refs), f"{component_id} preflight missing required evidence refs {sorted(required_refs - set(evidence_refs))}")
    for ref in evidence_refs:
        require(isinstance(ref, str) and ref.startswith("ops/evidence/production/"), f"{component_id} preflight evidence ref must stay under ops/evidence/production/: {ref}")
        if resolve_repo_path(ref).exists():
            data = load_json(resolve_repo_path(ref))
            assert_no_secret(data, f"{component_id}.preflight_evidence")

    proofs = component.get("proofs")
    require(isinstance(proofs, list) and proofs, f"{component_id} preflight proofs must be non-empty")
    required_proofs = {str(item).lower() for item in contract_component.get("required_proofs", [])}
    proof_values = {str(item).lower() for item in proofs}
    missing = [proof for proof in sorted(required_proofs) if all(proof not in item for item in proof_values)]
    require(not missing, f"{component_id} preflight missing proof anchors {missing}")


def validate_preflight_evidence(evidence_path: Path, results_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "preflight")
    assert_no_secret(rows, "preflight_results")

    require(data.get("schema_version") == "stage1.production_launch.v1", "preflight schema_version mismatch")
    require(data.get("environment") == "production", "preflight aggregate evidence must be production")
    require(data.get("kind") == "stage1_production_launch", "preflight kind must be stage1_production_launch")
    require(data.get("status") == "blocked", "preflight aggregate status must be blocked")
    require(data.get("release_gate_decision") == "no_go", "preflight release_gate_decision must be no_go")
    require(data.get("all_release_gates_go") is False, "preflight all_release_gates_go must be false")
    require(data.get("all_components_passed") is False, "preflight all_components_passed must be false")
    require(data.get("do_not_launch_conditions") == ["stage1_production_launch_evidence_incomplete"], "preflight must preserve production launch DNL")
    blockers = data.get("blockers")
    require(isinstance(blockers, list) and blockers, "preflight blockers must be non-empty")
    blocker_text = "\n".join(str(item) for item in blockers)
    require("strict child validator failed" in blocker_text, "preflight must preserve blocker token 'strict child validator failed'")
    require(
        "release_bundle:" in blocker_text or "production_launch:" in blocker_text,
        "preflight must preserve release bundle or production launch fixture blocker context",
    )

    for key in (
        "secret_material_persisted",
        "raw_prompt_persisted",
        "raw_provider_payload_persisted",
        "raw_stripe_payload_persisted",
        "raw_support_body_projected",
        "signed_url_persisted",
        "authorization_header_persisted",
        "cookie_persisted",
    ):
        require(data.get(key) is False, f"preflight {key} must be false")

    runtime_inputs = data.get("runtime_input_readiness")
    require(isinstance(runtime_inputs, dict), "preflight runtime_input_readiness must be object")
    require(
        any(value is False for value in runtime_inputs.values()),
        "preflight runtime_input_readiness must preserve at least one blocked input",
    )
    for key in (
        "production_billing_ready",
        "production_security_ready",
        "production_legal_support_ready",
        "production_governance_release_ready",
        "release_notes_match_gate_fixtures",
    ):
        require(runtime_inputs.get(key) is False, f"preflight runtime_input_readiness.{key} must remain false")
    for key in (
        "release_bundle_ready",
        "release_bundle_stage1_staging_runtime_verified",
        "release_bundle_stage1_quota_replay_verified",
        "release_bundle_stage1_load_verified",
        "production_provider_ready_or_comp_only",
        "production_backup_restore_ready",
        "production_rollback_incident_smoke_ready",
    ):
        require(
            isinstance(runtime_inputs.get(key), bool),
            f"preflight runtime_input_readiness.{key} must reflect current exact split readiness",
        )

    gate_statuses = data.get("release_gate_fixtures")
    require(isinstance(gate_statuses, list), "preflight release_gate_fixtures must be list")
    by_gate = {item.get("gate_id"): item for item in gate_statuses if isinstance(item, dict)}
    require(REQUIRED_GATES <= set(by_gate), f"preflight missing gate fixtures {sorted(REQUIRED_GATES - set(by_gate))}")
    for gate_id in ("local_alpha", "ci", "private_beta_staging"):
        gate = by_gate[gate_id]
        require(gate.get("status") == "go", f"preflight {gate_id} gate should remain go when exact evidence has passed")
        require(gate.get("blockers") == [], f"preflight {gate_id} gate blockers should be empty when exact evidence has passed")
    production_gate = by_gate["production_launch"]
    require(production_gate.get("status") == "no_go", "preflight production_launch gate must remain no_go")
    require(
        isinstance(production_gate.get("blockers"), list) and production_gate.get("blockers"),
        "preflight production_launch gate blockers must be preserved",
    )

    ci_items = data.get("ci_evidence")
    require(isinstance(ci_items, list) and len(ci_items) == 3, "preflight must list three CI evidence entries")
    expected_ci = set(contract.get("required_ci_evidence") or [])
    ci_paths = {item.get("path") for item in ci_items if isinstance(item, dict)}
    require(expected_ci <= ci_paths, f"preflight missing CI refs {sorted(expected_ci - ci_paths)}")
    for item in ci_items:
        if isinstance(item, dict):
            blockers = item.get("blockers")
            require(isinstance(blockers, list), f"preflight CI {item.get('path')} blockers must be a list")
            if blockers:
                require(item.get("status") in {"missing", "blocked", "failed", "no_go"}, f"preflight CI {item.get('path')} has blockers but status is not blocked/missing")
            else:
                require(is_pass_status(item.get("status")), f"preflight CI {item.get('path')} without blockers must pass")

    release_bundle = data.get("release_bundle_preflight")
    require(isinstance(release_bundle, dict), "preflight release_bundle_preflight must be object")
    require(release_bundle.get("path") == contract.get("required_release_bundle_evidence", {}).get("path"), "preflight release bundle path mismatch")
    release_bundle_blockers = release_bundle.get("blockers")
    require(isinstance(release_bundle_blockers, list), "preflight release bundle blockers must be a list")
    if release_bundle_blockers:
        require(release_bundle.get("status") == "blocked", "preflight release bundle with blockers must be blocked")
        require(release_bundle.get("decision") == "no-go", "preflight release bundle with blockers must be no-go")
        require(
            release_bundle.get("production_backup_rollback_split_ready") is False
            or release_bundle.get("missing_slots")
            or release_bundle.get("unverified_slots")
            or release_bundle.get("blocking_reasons"),
            "preflight release bundle must preserve unresolved bundle blockers when present",
        )
    else:
        require(release_bundle.get("status") == "passed", "preflight release bundle without blockers must be passed")
        require(release_bundle.get("decision") == "go", "preflight release bundle without blockers must be go")
        for key in (
            "stage1_staging_runtime_verified",
            "stage1_quota_replay_verified",
            "stage1_load_verified",
            "object_retention_cleanup_verified",
            "legal_support_visibility_verified",
            "ci_closure_artifacts_ready",
            "production_backup_rollback_split_ready",
        ):
            require(release_bundle.get(key) is True, f"preflight release bundle {key} must be true when ready")
        require(release_bundle.get("blocking_reasons") == [], "preflight release bundle ready state must have no blocking_reasons")

    contract_by_id = {
        item["component_id"]: item for item in contract["required_components"] if isinstance(item, dict) and item.get("component_id")
    }
    components = data.get("components")
    require(isinstance(components, list) and components, "preflight components must be non-empty")
    by_component = {item.get("component_id"): item for item in components if isinstance(item, dict)}
    require(REQUIRED_COMPONENTS <= set(by_component), f"preflight missing components {sorted(REQUIRED_COMPONENTS - set(by_component))}")
    for component_id in REQUIRED_COMPONENTS:
        validate_preflight_component(by_component[component_id], contract_by_id[component_id])

    row_ids = {row.get("component_id") for row in rows}
    require(REQUIRED_COMPONENTS <= row_ids, f"preflight results missing rows {sorted(REQUIRED_COMPONENTS - row_ids)}")
    for row in rows:
        component_id = row.get("component_id")
        if component_id in REQUIRED_COMPONENTS:
            require(row.get("environment") == "production", f"preflight result {component_id} environment must be production")
            require(row.get("secret_leak_detected") is False, f"preflight result {component_id} leaked secret")
            require(row.get("raw_payload_persisted") is False, f"preflight result {component_id} persisted raw payload")
            row_blockers = row.get("blockers")
            require(isinstance(row_blockers, list), f"preflight result {component_id} blockers must be a list")
            if row_blockers:
                require(row.get("status") == "blocked", f"preflight result {component_id} status must be blocked when blockers exist")
                require(row.get("exact_evidence") is False, f"preflight result {component_id} exact_evidence must be false when blockers exist")
                require(row.get("blockers_preserved") is True, f"preflight result {component_id} blockers_preserved must be true when blockers exist")
            else:
                require(row.get("status") == "passed", f"preflight result {component_id} status must pass when blockers are empty")
                require(row.get("exact_evidence") is True, f"preflight result {component_id} exact_evidence must be true when blockers are empty")
                require(row.get("blockers_preserved") is False, f"preflight result {component_id} blockers_preserved must be false when blockers are empty")


def validate_evidence(evidence_path: Path, results_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    rows = load_ndjson(results_path)
    assert_no_secret(data, "evidence")
    assert_no_secret(rows, "results")
    require_no_blocked_gate_signals(data, "evidence")
    require_no_blocked_gate_signals(rows, "results")

    require(data.get("schema_version") == "stage1.production_launch.v1", "schema_version mismatch")
    require(data.get("environment") == "production", "aggregate evidence must be production")
    require(data.get("kind") == "stage1_production_launch", "kind must be stage1_production_launch")
    require(data.get("status") == "pass", "aggregate status must be pass")
    require(data.get("release_gate_decision") == "go", "release_gate_decision must be go")
    require(data.get("all_release_gates_go") is True, "all_release_gates_go must be true")
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
    ):
        require(data.get(key) is False, f"{key} must be false")

    runtime_inputs = data.get("runtime_input_readiness")
    require(isinstance(runtime_inputs, dict), "runtime_input_readiness must be object")
    for key in (
        "ci_gate_ready",
        "staging_gate_ready",
        "release_bundle_ready",
        "release_bundle_stage1_staging_runtime_verified",
        "release_bundle_stage1_quota_replay_verified",
        "release_bundle_stage1_load_verified",
        "production_provider_ready_or_comp_only",
        "production_billing_ready",
        "production_backup_restore_ready",
        "production_rollback_incident_smoke_ready",
        "production_security_ready",
        "production_legal_support_ready",
        "production_governance_release_ready",
        "release_notes_match_gate_fixtures",
    ):
        require(runtime_inputs.get(key) is True, f"runtime_input_readiness.{key} must be true")

    validate_release_bundle_preflight(
        data.get("release_bundle_preflight"),
        contract.get("required_release_bundle_evidence", {}),
    )

    gate_statuses = data.get("release_gate_fixtures")
    require(isinstance(gate_statuses, list), "release_gate_fixtures must be list")
    contract_gates = {item["gate_id"]: item for item in contract["required_gate_fixtures"] if isinstance(item, dict)}
    by_gate = {item.get("gate_id"): item for item in gate_statuses if isinstance(item, dict)}
    require(REQUIRED_GATES <= set(by_gate), f"aggregate evidence missing gate fixtures {sorted(REQUIRED_GATES - set(by_gate))}")
    for gate_id in REQUIRED_GATES:
        gate = by_gate[gate_id]
        require(gate.get("status") == "go", f"{gate_id} aggregate gate status must be go")
        require(gate.get("blocked_by_checks") == [], f"{gate_id} aggregate blocked_by_checks must be empty")
        require(gate.get("active_do_not_launch_conditions") == [], f"{gate_id} aggregate DNL conditions must be empty")
        require(gate.get("path") == contract_gates[gate_id]["path"], f"{gate_id} aggregate gate path mismatch")
        validate_gate_fixture(gate["path"], gate_id)

    for ci_ref in contract.get("required_ci_evidence", []):
        ci_data = load_json(resolve_repo_path(ci_ref))
        assert_no_secret(ci_data, f"ci.{ci_ref}")
        require_no_blocked_gate_signals(ci_data, f"ci.{ci_ref}")
        require(ci_data.get("environment") == "ci", f"{ci_ref} must be CI-scoped")
        require(is_pass_status(ci_data.get("status")), f"{ci_ref} must pass")

    for command in ("python3 scripts/validate_stage0_rev2.py", "python3 scripts/validate_stage1_staging_runtime.py"):
        require(command in data.get("validator_commands", []), f"aggregate evidence must record validator command {command}")
        run_strict_child_validator(command)
    for command in (
        "python3 scripts/validate_stage1_production_security_launch_evidence.py",
        "python3 scripts/validate_stage1_production_provider_claims_evidence.py",
        "python3 scripts/validate_stage1_production_governance_release_evidence.py",
        "python3 scripts/validate_stage1_production_legal_support_evidence.py",
        "python3 scripts/validate_stage1_production_billing_evidence.py",
        "python3 scripts/validate_stage1_production_backup_rollback_evidence.py",
    ):
        require(command in data.get("validator_commands", []), f"aggregate evidence must record validator command {command}")
        run_strict_child_validator(command)

    contract_by_id = {
        item["component_id"]: item for item in contract["required_components"] if isinstance(item, dict) and item.get("component_id")
    }
    components = data.get("components")
    require(isinstance(components, list) and components, "components must be non-empty")
    by_component = {item.get("component_id"): item for item in components if isinstance(item, dict)}
    require(REQUIRED_COMPONENTS <= set(by_component), f"aggregate evidence missing components {sorted(REQUIRED_COMPONENTS - set(by_component))}")
    for component_id in REQUIRED_COMPONENTS:
        validate_component(by_component[component_id], contract_by_id[component_id])

    row_ids = {row.get("component_id") for row in rows}
    require(REQUIRED_COMPONENTS <= row_ids, f"results missing rows {sorted(REQUIRED_COMPONENTS - row_ids)}")
    for row in rows:
        component_id = row.get("component_id")
        if component_id in REQUIRED_COMPONENTS:
            require(row.get("status") == "passed", f"result {component_id} status must be passed")
            require_no_blocked_gate_signals(row, f"result.{component_id}")
            require(row.get("exact_evidence") is True, f"result {component_id} exact_evidence must be true")
            require(row.get("secret_leak_detected") is False, f"result {component_id} leaked secret")
            require(row.get("raw_payload_persisted") is False, f"result {component_id} persisted raw payload")
            require(row.get("blockers_preserved") is False, f"result {component_id} blockers_preserved must be false")
            strings = normalized_string_values(row)
            blocked = sorted(strings & BLOCKED_MARKERS)
            require(not blocked, f"result {component_id} contains blocked/deferred/no-go marker(s): {blocked}")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    validate_secret_rejection_selftest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors without requiring production pass evidence")
    parser.add_argument("--allow-preflight", action="store_true", help="validate blocked aggregate diagnostic evidence without clearing production launch")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="Stage 1 production launch evidence JSON path")
    parser.add_argument("--results", default=str(DEFAULT_RESULTS), help="Stage 1 production launch NDJSON results path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            validate_preflight_evidence(Path(args.evidence), Path(args.results))
        else:
            validate_evidence(Path(args.evidence), Path(args.results))
    except Stage1ProductionLaunchError as exc:
        print(f"stage1 production launch validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 production launch contract passed")
    elif args.allow_preflight:
        print("stage1 production launch preflight evidence passed")
    else:
        print("stage1 production launch evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
