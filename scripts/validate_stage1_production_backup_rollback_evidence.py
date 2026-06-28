#!/usr/bin/env python3
"""Validate Stage 1 production backup/rollback exact evidence.

Contract-only mode checks that OP-10 and OP-11 have validator-readable exact
production evidence requirements. Strict mode requires both canonical split
files and rejects local, dry-run, blocked, no-go, preserved-blocker, raw
payload, or secret-shaped evidence.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "production_backup_rollback" / "local_contract.json"
DEFAULT_BACKUP_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "backup-restore.json"
DEFAULT_ROLLBACK_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "rollback-incident-post-deploy-smoke.json"
SPLIT_PREFLIGHT = ROOT / "ops" / "evidence" / "production" / "backup-rollback-split.blocked.json"
SPLIT_SMOKE = ROOT / "scripts" / "production_backup_rollback_split_smoke.sh"
SPLIT_GENERATOR = ROOT / "scripts" / "generate_stage1_production_backup_rollback_evidence.py"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
PRODUCTION_LAUNCH_VALIDATOR = ROOT / "scripts" / "validate_stage1_production_launch.py"
PRODUCTION_LAUNCH_GENERATOR = ROOT / "scripts" / "generate_stage1_production_launch_evidence.py"
PRODUCTION_LAUNCH_CONTRACT = ROOT / "fixtures" / "stage1" / "production_launch" / "local_contract.json"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
BACKEND_DOCKERFILE = ROOT / "backend" / "Dockerfile"
DOCKER_BUILD_SMOKE = ROOT / "scripts" / "docker_build_smoke.sh"
GITHUB_WORKFLOW = ROOT / ".github" / "workflows" / "stage0-rev2-ci.yml"
OPS_CI_WORKFLOW = ROOT / "ops" / "ci" / "stage0-rev2-ci.yml"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed"}
GO_STATUSES = {"go", "passed", "pass"}
BACKUP_CHECKLIST_ITEM = (
    "Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, "
    "object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。"
)
ROLLBACK_CHECKLIST_ITEM = (
    "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves app rollback, "
    "feature flag rollback, backend image runtime-worker rollback (/app/worker), worker drain, incident/alert path, "
    "migration compatibility, and post-deploy smoke under `ops/evidence/production/`。"
)
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
    "blocked_by_upstream_gates",
    "blocked_by_upstream_or_missing_exact_split_evidence",
    "failed",
    "fail",
    "planned",
    "dry_run",
    "no_go",
    "no-go",
    "missing",
    "deferred",
    "pass_with_blockers_preserved",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
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
    "preserved_do_not_launch_condition_ids",
}
BACKUP_SECTIONS = {
    "backup_schedule",
    "postgres_restore",
    "object_restore",
    "asset_lineage",
    "billing_ledger",
    "rpo_rto",
    "audit_refs",
}
ROLLBACK_SECTIONS = {
    "app_rollback",
    "feature_flag_rollback",
    "backend_runtime_worker_rollback",
    "worker_drain",
    "migration_compatibility",
    "incident_alert_path",
    "post_deploy_smoke",
    "upstream_gate_dependencies",
    "audit_refs",
}
UPSTREAM_GATE_REFS = {
    "ci": "fixtures/stage0/rev2/release_gate_evidence.ci.json",
    "private_beta_staging": "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    "strict_stage1_staging_runtime": "ops/evidence/staging/stage1-runtime.json",
}
CI_EVIDENCE_REFS = {
    "ops/evidence/ci/stage0-rev2-pr-main-run.json",
    "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
    "ops/evidence/ci/stage0-rev2-docker-image-build.json",
}


class Stage1ProductionBackupRollbackError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1ProductionBackupRollbackError(message)


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
        raise Stage1ProductionBackupRollbackError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


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


def is_go_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in GO_STATUSES


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
            if normalized in GATE_CLEAR_FIELDS and child not in (None, [], ""):
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


def require_section_pass(data: dict[str, Any], section: str, path: str) -> dict[str, Any]:
    value = data.get(section)
    require(isinstance(value, dict), f"{path}.{section} must be an object")
    require(is_pass_status(value.get("status")), f"{path}.{section}.status must pass")
    if section == "rpo_rto":
        for field in ("rpo_minutes", "rto_minutes"):
            metric = value.get(field)
            require(isinstance(metric, (int, float)) and not isinstance(metric, bool), f"{path}.{section}.{field} must be numeric")
            require(metric >= 0, f"{path}.{section}.{field} must be non-negative")
    if section == "audit_refs":
        refs = value.get("refs", value.get("evidence_refs"))
        require_ref_list(refs, f"{path}.{section}.refs")
    elif section in {"asset_lineage", "billing_ledger"}:
        refs = value.get("lineage_refs" if section == "asset_lineage" else "ledger_refs", value.get("evidence_refs"))
        require_ref_list(refs, f"{path}.{section}.refs")
    elif section != "upstream_gate_dependencies":
        refs = value.get("evidence_refs")
        require_ref_list(refs, f"{path}.{section}.evidence_refs")
    return value


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.production_backup_rollback.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "production_backup_rollback_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_backup_restore_evidence_path") == "ops/evidence/production/backup-restore.json", "backup evidence path mismatch")
    require(
        contract.get("canonical_rollback_incident_post_deploy_evidence_path")
        == "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
        "rollback evidence path mismatch",
    )
    require(contract.get("split_preflight_path") == "ops/evidence/production/backup-rollback-split.blocked.json", "split preflight path mismatch")
    preflight_policy = contract.get("split_preflight_policy")
    require(isinstance(preflight_policy, dict), "split_preflight_policy must be object")
    require(preflight_policy.get("validator_flag") == "--allow-preflight", "split preflight validator flag mismatch")
    require(preflight_policy.get("status_ready_does_not_clear_gate") is True, "split preflight ready must not clear production gate")
    require(preflight_policy.get("canonical_split_files_written") is False, "split preflight must not write canonical pass files")
    require(preflight_policy.get("can_clear_release_gate_check") is False, "split preflight must not clear release gate")
    require(preflight_policy.get("requires_ci_gate_go_for_strict_evidence") is True, "split preflight must require CI go for strict evidence")
    require(preflight_policy.get("requires_private_beta_staging_go_for_strict_evidence") is True, "split preflight must require private beta staging go")
    require(contract.get("strict_backup_schema_version") == "stage1.production_backup_restore.v1", "backup strict schema mismatch")
    require(
        contract.get("strict_rollback_schema_version") == "stage1.production_rollback_incident_post_deploy.v1",
        "rollback strict schema mismatch",
    )
    require(contract.get("release_gate_status") == "contract_ready_exact_production_backup_rollback_evidence_open", "contract status mismatch")
    require(contract.get("required_environment") == "production", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "production_backup_rollback_incident", "contract gate check mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")
    require(BACKUP_SECTIONS <= set(contract.get("required_backup_restore_sections") or []), "contract missing backup sections")
    require(ROLLBACK_SECTIONS <= set(contract.get("required_rollback_sections") or []), "contract missing rollback sections")
    require(set(contract.get("required_upstream_gate_refs") or []) >= set(UPSTREAM_GATE_REFS.values()), "contract missing upstream gate refs")
    require(set(contract.get("required_ci_evidence_refs") or []) >= CI_EVIDENCE_REFS, "contract missing CI evidence refs")
    policy = contract.get("safe_projection_policy")
    require(isinstance(policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    for key in (
        "release_sha_full_40_hex",
        "release_sha_must_match_between_split_files",
        "canonical_pass_path_required",
        "backup_gate_impact_can_clear_required",
        "rollback_gate_impact_can_clear_required",
        "backend_runtime_worker_rollback_target_required",
        "upstream_ci_gate_must_be_go",
        "upstream_private_beta_staging_gate_must_be_go",
        "strict_staging_runtime_must_be_pass",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run",
        "allow_blocked_status",
        "allow_no_go_status",
        "allow_preserved_blockers",
        "allow_raw_or_secret_payloads",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")


def validate_code_anchors() -> None:
    require(SPLIT_SMOKE.exists() and SPLIT_SMOKE.stat().st_mode & 0o111, "production split smoke must be executable")
    require(SPLIT_GENERATOR.exists() and SPLIT_GENERATOR.stat().st_mode & 0o111, "production split evidence generator must be executable")
    require_text(
        SPLIT_SMOKE,
        (
            "BACKUP_RESTORE_EVIDENCE",
            "ROLLBACK_INCIDENT_SMOKE_EVIDENCE",
            "ops/evidence/production/backup-restore.json",
            "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
            "backup_schedule",
            "postgres_restore",
            "object_restore",
            "feature_flag",
            "backend_runtime_worker_rollback",
            "runtime-worker",
            "worker_drain",
            "migration_compatibility",
            "post_deploy_smoke",
        ),
    )
    require_text(
        SPLIT_GENERATOR,
        (
            "DEFAULT_BACKUP",
            "DEFAULT_ROLLBACK",
            "ops/evidence/production/backup-restore.json",
            "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
            "release_sha_missing_or_not_full_sha",
            "stage1.production_backup_restore.v1",
            "stage1.production_rollback_incident_post_deploy.v1",
            "runtime-worker",
            "/app/worker",
            "strict_stage1_staging_runtime",
            "CI_EVIDENCE_REFS",
            "canonical_pass_path",
            "blocked_report",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_CONTRACT,
        (
            '"component_id": "backup_restore"',
            '"component_id": "rollback_incident_post_deploy"',
            "ops/evidence/production/backup-restore.json",
            "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
            "scripts/generate_stage1_production_backup_rollback_evidence.py",
            "CI and staging dependencies go",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_VALIDATOR,
        (
            "backup_restore",
            "rollback_incident_post_deploy",
            "Production backup/restore、rollback/incident/post-deploy smoke exact evidence",
            "ops/evidence/production/backup-restore.json",
            "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
        ),
    )
    require_text(
        PRODUCTION_LAUNCH_GENERATOR,
        (
            "production_rollback_incident_smoke_ready",
            "check_level_passed",
            "blocked_gate_signal_blockers",
        ),
    )
    require_text(
        STAGE0_VALIDATOR,
        (
            "Production backup/restore exact evidence file",
            "Production rollback/incident/post-deploy exact evidence file",
            "validate_production_backup_rollback_split_preflight_evidence",
            "production backup/rollback/post-deploy check cannot pass unless CI and Private Beta/Staging gates are computed ready",
        ),
    )
    require_text(
        BLUEPRINT,
        (
            "OP-10",
            "OP-11",
            "ops/evidence/production/backup-restore.json",
            "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
        ),
    )
    require_text(
        BACKEND_DOCKERFILE,
        (
            "AS runtime-server",
            'ENTRYPOINT ["/app/server"]',
            "AS runtime-worker",
            'ENTRYPOINT ["/app/worker"]',
        ),
    )
    require_text(
        DOCKER_BUILD_SMOKE,
        (
            "IMAGE_SET",
            "backend web admin",
            "runtime-server",
            "runtime-worker",
        ),
    )
    require_text(
        GITHUB_WORKFLOW,
        (
            "scripts/docker_build_smoke.sh",
            "write_stage1_ci_docker_evidence.py",
            "stage0-rev2-docker-image-build.json",
            "DOCKER_REPORT",
        ),
    )
    require_text(
        OPS_CI_WORKFLOW,
        (
            "scripts/docker_build_smoke.sh",
            "write_stage1_ci_docker_evidence.py",
            "stage0-rev2-docker-image-build.json",
            "DOCKER_REPORT",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "OP-10",
            "OP-11",
            "Production backup/restore and rollback/incident/post-deploy exact evidence",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "validate_stage1_production_backup_rollback_evidence.py --contract-only",
            "validate_stage1_production_backup_rollback_evidence.py --allow-preflight",
            "generate_stage1_production_backup_rollback_evidence.py",
            "stage1 production backup/rollback exact evidence strict fixture",
        ),
    )
    require_text(
        SPLIT_PREFLIGHT,
        (
            "production_backup_rollback_split_preflight",
            "all_exact_split_files_ready",
            "production_gate_fixture_has_unrelated_blockers",
        ),
    )


def validate_split_preflight(data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_backup_rollback_split_preflight")
    require(
        data.get("schema_version") == "stage0.rev2.production.backup_rollback_split_preflight",
        "split preflight schema_version mismatch",
    )
    require(data.get("environment") == "production", "split preflight environment must be production")
    require(data.get("kind") == "production_backup_rollback_split_preflight", "split preflight kind mismatch")
    split = data.get("split_evidence")
    require(isinstance(split, dict), "split preflight split_evidence must be object")
    status = data.get("status")
    exact_split_ready = split.get("all_exact_split_files_ready") is True
    require(
        status in {
            "blocked_by_upstream_gates",
            "exact_split_ready_blocked_by_other_production_runtime_items",
        },
        "split preflight must remain blocked until aggregate production launch is ready",
    )
    if exact_split_ready:
        require(
            status == "exact_split_ready_blocked_by_other_production_runtime_items",
            "split preflight with exact split files ready must expose other production runtime blockers",
        )
    else:
        require(status == "blocked_by_upstream_gates", "split preflight without exact split files must remain blocked_by_upstream_gates")
    require(data.get("release_gate_check_id") == "production_backup_rollback_incident", "split preflight gate check mismatch")
    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list) and blocked_checks, "split preflight blocked_checks must be non-empty")
    if exact_split_ready:
        require(
            "production_gate_fixture_has_unrelated_blockers" in blocked_checks,
            "ready split preflight must preserve unrelated production blockers",
        )
        require(
            "production_backup_restore_split_not_passed" not in blocked_checks
            and "production_rollback_incident_post_deploy_split_not_passed" not in blocked_checks,
            "ready split preflight must not preserve exact split blockers",
        )
    else:
        require(
            "production_backup_restore_split_not_passed" in blocked_checks,
            "split preflight must preserve backup split blocker",
        )
        require(
            "production_rollback_incident_post_deploy_split_not_passed" in blocked_checks,
            "split preflight must preserve rollback split blocker",
        )
    dnl = data.get("do_not_launch_condition_ids")
    require(isinstance(dnl, list), "split preflight DNL conditions must be a list")
    if exact_split_ready:
        for cleared in ("backup_restore_rollback_smoke_missing", "production_deploy_rollback_smoke_missing"):
            require(cleared not in dnl, f"ready split preflight must clear {cleared}")
    else:
        require(dnl, "split preflight must preserve DNL conditions")
        for required in ("backup_restore_rollback_smoke_missing", "production_deploy_rollback_smoke_missing"):
            require(required in dnl, f"split preflight must preserve {required}")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "split preflight gate_impact must be object")
    require(
        gate.get("can_clear_release_gate_check") is exact_split_ready,
        "split preflight release-gate readiness must mirror exact split readiness",
    )
    require(
        gate.get("can_clear_check_level_items") is exact_split_ready,
        "split preflight check-level readiness must mirror exact split readiness",
    )
    require(
        gate.get("preserved_release_gate_check_id") in ({None} if exact_split_ready else {"production_backup_rollback_incident"}),
        "split preflight preserved release gate check must mirror exact split readiness",
    )
    preserved = gate.get("preserved_do_not_launch_condition_ids")
    require(isinstance(preserved, list) and set(dnl) <= set(preserved), "split preflight gate impact must preserve DNL ids")
    admin_probe = data.get("admin_visible_probe")
    require(isinstance(admin_probe, dict), "split preflight admin_visible_probe must be object")
    require(admin_probe.get("path") == "ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json", "admin probe path mismatch")
    require(admin_probe.get("ready") is True, "admin visible blocked probe must be semantically ready")
    semantics = admin_probe.get("semantic_validation")
    require(isinstance(semantics, dict), "admin probe semantic_validation must be object")
    require(semantics.get("ready") is True, "admin probe semantic validation must be ready")
    require(semantics.get("gate_blocker_preservation") is True, "admin probe must preserve gate blockers")
    require(semantics.get("split_readiness_blocked") is True, "admin probe must keep split readiness blocked")
    require(semantics.get("gate_impact_preserves_upstream") is True, "admin probe must preserve upstream gate blockers")
    coverage_areas = set(semantics.get("required_coverage_areas") or [])
    require({"backup_restore", "rollback_drill", "incident_alert_path", "post_deploy_smoke"} <= coverage_areas, "admin probe coverage areas incomplete")
    split_paths = semantics.get("split_readiness_paths")
    require(isinstance(split_paths, dict), "admin probe split_readiness_paths must be object")
    require(split_paths.get("backup_restore") == "ops/evidence/production/backup-restore.json", "admin probe backup split path mismatch")
    require(
        split_paths.get("rollback_incident_post_deploy_smoke")
        == "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
        "admin probe rollback split path mismatch",
    )
    upstream = data.get("upstream_gates")
    require(isinstance(upstream, dict), "split preflight upstream_gates must be object")
    for gate_id in ("ci", "private_beta_staging", "production_launch"):
        gate_row = upstream.get(gate_id)
        require(isinstance(gate_row, dict), f"upstream gate {gate_id} must be object")
        if gate_id in {"ci", "private_beta_staging"}:
            require(gate_row.get("gate_decision_status") in {"go", "no_go"}, f"upstream gate {gate_id} status must be mirrored")
            continue
        require(gate_row.get("ready") is False, "production launch gate must remain not ready in blocked preflight")
    require(isinstance(exact_split_ready, bool), "split preflight exact split readiness must be boolean")
    backup = split.get("backup_restore")
    rollback = split.get("rollback_incident_post_deploy_smoke")
    for label, row, expected_path in (
        ("backup", backup, "ops/evidence/production/backup-restore.json"),
        ("rollback", rollback, "ops/evidence/production/rollback-incident-post-deploy-smoke.json"),
    ):
        require(isinstance(row, dict), f"split preflight {label} row must be object")
        require(row.get("path") == expected_path, f"split preflight {label} path mismatch")
        require(row.get("passed") is exact_split_ready, f"split preflight {label} pass state must mirror exact split readiness")
        if exact_split_ready:
            require(row.get("status") in {"pass", "passed"}, f"split preflight {label} status must pass when exact split is ready")
            require(row.get("missing_requirements") == [], f"split preflight {label} missing_requirements must be empty when ready")
        else:
            require(isinstance(row.get("missing_requirements"), list) and row["missing_requirements"], f"split preflight {label} missing_requirements required")
    requirements = data.get("runtime_input_requirements")
    require(isinstance(requirements, dict), "split preflight runtime_input_requirements must be object")
    required_split = requirements.get("required_split_evidence")
    require(isinstance(required_split, dict), "split preflight required_split_evidence must be object")
    require("Postgres restore" in required_split.get("backup_restore", {}).get("must_prove", []), "split preflight must require Postgres restore")
    rollback_proofs = required_split.get("rollback_incident_post_deploy_smoke", {}).get("must_prove", [])
    for token in ("backend image runtime-worker rollback", "backend release image", "runtime-worker backend target", "/app/worker entrypoint", "post-deploy smoke"):
        require(token in rollback_proofs, f"split preflight rollback requirements must include {token}")


def validate_common_evidence(data: dict[str, Any], *, path: str, schema_version: str, kind: str) -> str:
    assert_no_secret(data, path)
    require_no_blocked_gate_signals(data, path)
    require(data.get("schema_version") == schema_version, f"{path} schema_version mismatch")
    require(data.get("environment") == "production", f"{path} environment must be production")
    require(data.get("kind") == kind, f"{path} kind mismatch")
    require(is_pass_status(data.get("status")), f"{path} status must pass")
    require(data.get("release_gate_check_id") == "production_backup_rollback_incident", f"{path} release gate check mismatch")
    release_sha = data.get("release_sha")
    require(isinstance(release_sha, str) and RELEASE_SHA_RE.fullmatch(release_sha) is not None, f"{path} release_sha must be a full lowercase SHA")
    require(data.get("canonical_pass_path") is True, f"{path} canonical_pass_path must be true")
    require(data.get("local_devport_debug") is False, f"{path} local_devport_debug must be false")
    require(data.get("allow_local_devport_evidence") is False, f"{path} allow_local_devport_evidence must be false")
    require(data.get("dry_run") is False, f"{path} dry_run must be false")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{path}.{field} must be false")
    blocked = sorted(normalized_string_values(data) & BLOCKED_MARKERS)
    require(not blocked, f"{path} contains blocked/local/dry-run marker(s): {blocked}")
    return release_sha


def validate_backup_evidence(data: dict[str, Any]) -> str:
    release_sha = validate_common_evidence(
        data,
        path="backup",
        schema_version="stage1.production_backup_restore.v1",
        kind="production_backup_restore",
    )
    for section in sorted(BACKUP_SECTIONS):
        require_section_pass(data, section, "backup")
    schedule = data["backup_schedule"]
    require(isinstance(schedule.get("schedule_ref"), str) and schedule["schedule_ref"].strip(), "backup.backup_schedule.schedule_ref required")
    require(isinstance(schedule.get("timezone"), str) and schedule["timezone"].strip(), "backup.backup_schedule.timezone required")
    require(isinstance(data["postgres_restore"].get("restore_id"), str) and data["postgres_restore"]["restore_id"].strip(), "backup.postgres_restore.restore_id required")
    require(isinstance(data["object_restore"].get("restore_id"), str) and data["object_restore"]["restore_id"].strip(), "backup.object_restore.restore_id required")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "backup.gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_backup_rollback_incident", "backup gate impact release gate mismatch")
    require(gate.get("can_clear_backup_restore_split") is True, "backup gate impact must clear backup split")
    require(gate.get("check_level_item") == BACKUP_CHECKLIST_ITEM, "backup gate impact must back-reference checklist row")
    return release_sha


def validate_upstream_dependencies(data: dict[str, Any]) -> None:
    deps = require_section_pass(data, "upstream_gate_dependencies", "rollback")
    gates = deps.get("gates")
    require(isinstance(gates, dict), "rollback.upstream_gate_dependencies.gates must be object")
    for gate_id, expected_path in UPSTREAM_GATE_REFS.items():
        gate = gates.get(gate_id)
        require(isinstance(gate, dict), f"rollback upstream gate {gate_id} must be object")
        require(gate.get("path") == expected_path, f"rollback upstream gate {gate_id} path mismatch")
        require(is_go_status(gate.get("status")), f"rollback upstream gate {gate_id} must be go/pass")
    ci_refs = deps.get("ci_evidence_refs")
    require_ref_list(ci_refs, "rollback.upstream_gate_dependencies.ci_evidence_refs")
    require(CI_EVIDENCE_REFS <= set(ci_refs), "rollback upstream dependencies missing CI evidence refs")


def validate_backend_runtime_worker_rollback(data: dict[str, Any]) -> None:
    section = data.get("backend_runtime_worker_rollback")
    require(isinstance(section, dict), "rollback.backend_runtime_worker_rollback must be object")
    require(is_pass_status(section.get("status")), "rollback.backend_runtime_worker_rollback.status must pass")
    release_image = section.get("release_image_name") or section.get("image_name") or section.get("service")
    require(release_image == "backend", "rollback.backend_runtime_worker_rollback release image must be backend")
    require(section.get("docker_target") == "runtime-worker", "rollback.backend_runtime_worker_rollback docker_target must be runtime-worker")
    require(section.get("entrypoint") == "/app/worker", "rollback.backend_runtime_worker_rollback entrypoint must be /app/worker")
    require(section.get("standalone_release_image") is False, "rollback.backend_runtime_worker_rollback must not be standalone release image")
    refs = section.get("evidence_refs")
    require_ref_list(refs, "rollback.backend_runtime_worker_rollback.evidence_refs")
    require(
        any("stage0-rev2-docker-image-build.json" in ref for ref in refs),
        "rollback.backend_runtime_worker_rollback evidence_refs must cite CI Docker image build evidence",
    )


def validate_rollback_evidence(data: dict[str, Any]) -> str:
    release_sha = validate_common_evidence(
        data,
        path="rollback",
        schema_version="stage1.production_rollback_incident_post_deploy.v1",
        kind="production_rollback_incident_post_deploy_smoke",
    )
    for section in sorted(ROLLBACK_SECTIONS - {"upstream_gate_dependencies"}):
        require_section_pass(data, section, "rollback")
    validate_backend_runtime_worker_rollback(data)
    validate_upstream_dependencies(data)
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "rollback.gate_impact must be object")
    require(gate.get("release_gate_check_id") == "production_backup_rollback_incident", "rollback gate impact release gate mismatch")
    require(gate.get("can_clear_rollback_incident_post_deploy_split") is True, "rollback gate impact must clear rollback split")
    require(gate.get("check_level_item") == ROLLBACK_CHECKLIST_ITEM, "rollback gate impact must back-reference checklist row")
    upstream = data.get("upstream_gate_dependencies")
    require(isinstance(upstream, dict), "rollback.upstream_gate_dependencies must be object")
    summary = upstream.get("gate_decision_status_summary")
    require(
        isinstance(summary, str) and "gate_decision.status=go" in summary,
        "rollback upstream gate summary must prove CI/Private Beta/Staging go status",
    )
    return release_sha


def validate_evidence(backup_path: Path, rollback_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    validate_code_anchors()
    backup = load_json(backup_path)
    rollback = load_json(rollback_path)
    backup_sha = validate_backup_evidence(backup)
    rollback_sha = validate_rollback_evidence(rollback)
    require(backup_sha == rollback_sha, "backup and rollback release_sha values must match")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--allow-preflight", action="store_true", help="validate non-clearing production backup/rollback split preflight")
    parser.add_argument("--preflight", default=str(SPLIT_PREFLIGHT), help="production backup/rollback split preflight JSON path")
    parser.add_argument("--backup-evidence", default=str(DEFAULT_BACKUP_EVIDENCE), help="production backup exact evidence JSON path")
    parser.add_argument("--rollback-evidence", default=str(DEFAULT_ROLLBACK_EVIDENCE), help="production rollback exact evidence JSON path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        elif args.allow_preflight:
            validate_contract_only()
            validate_split_preflight(load_json(Path(args.preflight)))
        else:
            validate_evidence(Path(args.backup_evidence), Path(args.rollback_evidence))
    except Stage1ProductionBackupRollbackError as exc:
        print(f"stage1 production backup/rollback evidence validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 production backup/rollback evidence contract passed")
    elif args.allow_preflight:
        print("stage1 production backup/rollback split preflight passed")
    else:
        print("stage1 production backup/rollback evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
