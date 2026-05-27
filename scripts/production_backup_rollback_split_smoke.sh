#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="${OUT_DIR:-ops/evidence/production}"
RUN_ID="${RUN_ID:-production-backup-rollback-split}"
REPORT_PATH="${REPORT_PATH:-$OUT_DIR/backup-rollback-split.blocked.json}"
RELEASE_SHA="${RELEASE_SHA:-${GITHUB_SHA:-}}"
EVIDENCE_ENVIRONMENT="${EVIDENCE_ENVIRONMENT:-production}"

BACKUP_RESTORE_EVIDENCE="${BACKUP_RESTORE_EVIDENCE:-ops/evidence/production/backup-restore.json}"
ROLLBACK_INCIDENT_SMOKE_EVIDENCE="${ROLLBACK_INCIDENT_SMOKE_EVIDENCE:-ops/evidence/production/rollback-incident-post-deploy-smoke.json}"
ADMIN_VISIBLE_PROBE_EVIDENCE="${ADMIN_VISIBLE_PROBE_EVIDENCE:-ops/evidence/production/20260527T1800Z-backup-rollback-incident-smoke.json}"
CI_GATE_FIXTURE="${CI_GATE_FIXTURE:-fixtures/stage0/rev2/release_gate_evidence.ci.json}"
PRIVATE_BETA_GATE_FIXTURE="${PRIVATE_BETA_GATE_FIXTURE:-fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json}"
PRODUCTION_GATE_FIXTURE="${PRODUCTION_GATE_FIXTURE:-fixtures/stage0/rev2/release_gate_evidence.production_launch.json}"

mkdir -p "$OUT_DIR"

python3 - \
  "$REPORT_PATH" \
  "$RUN_ID" \
  "$RELEASE_SHA" \
  "$EVIDENCE_ENVIRONMENT" \
  "$BACKUP_RESTORE_EVIDENCE" \
  "$ROLLBACK_INCIDENT_SMOKE_EVIDENCE" \
  "$ADMIN_VISIBLE_PROBE_EVIDENCE" \
  "$CI_GATE_FIXTURE" \
  "$PRIVATE_BETA_GATE_FIXTURE" \
  "$PRODUCTION_GATE_FIXTURE" <<'PY'
import json
import re
import sys
from pathlib import Path

(
    report_path_arg,
    run_id,
    release_sha,
    environment,
    backup_restore_ref,
    rollback_incident_ref,
    admin_probe_ref,
    ci_gate_ref,
    private_beta_gate_ref,
    production_gate_ref,
) = sys.argv[1:]

root = Path(".").resolve()
report_path = Path(report_path_arg)
if not report_path.is_absolute():
    report_path = root / report_path


def local_path(ref: str) -> Path:
    path = Path(ref)
    return path if path.is_absolute() else root / path


def load_json(ref: str) -> tuple[dict | None, str]:
    path = local_path(ref)
    if not path.exists():
        return None, "missing_file"
    try:
        return json.loads(path.read_text(encoding="utf-8")), ""
    except json.JSONDecodeError as exc:
        return None, f"invalid_json:{exc}"


def normalize(value: object) -> str:
    return str(value).strip().lower().replace("-", "_").replace(" ", "_")


def collect_statuses(value: object) -> set[str]:
    statuses: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in {"status", "result", "runtime_status"} and isinstance(nested, str):
                statuses.add(normalize(nested))
            statuses.update(collect_statuses(nested))
    elif isinstance(value, list):
        for item in value:
            statuses.update(collect_statuses(item))
    return statuses


def collect_blocker_markers(value: object, path: tuple[str, ...] = ()) -> list[str]:
    markers: list[str] = []
    marker_keys = {
        "remaining_blockers",
        "blocked_slots",
        "missing_blockers",
        "closure_blockers",
        "preserved_release_gate_check_id",
        "preserved_do_not_launch_condition_id",
        "preserved_do_not_launch_condition_ids",
    }
    if isinstance(value, dict):
        for key, nested in value.items():
            nested_path = path + (key,)
            if key in marker_keys:
                if nested not in (None, "", [], {}):
                    markers.append(".".join(nested_path))
            elif key == "can_clear_aggregate_item" and nested is False:
                markers.append(".".join(nested_path))
            elif key in {"can_clear_release_gate_check", "can_clear_check_level_items"} and nested is False:
                markers.append(".".join(nested_path))
            markers.extend(collect_blocker_markers(nested, nested_path))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            markers.extend(collect_blocker_markers(item, path + (str(index),)))
    return markers


def text_contains(data: object, tokens: tuple[str, ...]) -> bool:
    text = json.dumps(data, ensure_ascii=False, sort_keys=True).lower()
    return all(token in text for token in tokens)


def gate_status(ref: str) -> dict:
    data, error = load_json(ref)
    if data is None:
        return {
            "path": ref,
            "exists": False,
            "gate_decision_status": "missing",
            "blocked_by_checks": [],
            "active_do_not_launch_conditions": [],
            "ready": False,
            "reason": error,
        }
    decision = data.get("gate_decision", {}) if isinstance(data.get("gate_decision"), dict) else {}
    blocked = decision.get("blocked_by_checks", [])
    active = decision.get("active_do_not_launch_conditions", [])
    return {
        "path": ref,
        "exists": True,
        "gate_decision_status": decision.get("status", "missing"),
        "blocked_by_checks": blocked if isinstance(blocked, list) else [],
        "active_do_not_launch_conditions": active if isinstance(active, list) else [],
        "ready": decision.get("status") == "go" and not blocked and not active,
        "reason": "",
    }


def admin_probe_semantics(data: object) -> dict:
    required_coverage_areas = {
        "backup_restore",
        "rollback_drill",
        "incident_alert_path",
        "post_deploy_smoke",
    }
    required_split_paths = {
        "backup_restore": "ops/evidence/production/backup-restore.json",
        "rollback_incident_post_deploy_smoke": "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
    }
    split_aliases = {
        "backup_restore": ("backup_restore",),
        "rollback_incident_post_deploy_smoke": (
            "rollback_incident_post_deploy_smoke",
            "rollback_incident_smoke",
        ),
    }
    result = {
        "ready": False,
        "required_coverage_areas": sorted(required_coverage_areas),
        "coverage_areas": [],
        "coverage_statuses": {},
        "gate_blocker_preservation": False,
        "split_readiness_paths": {},
        "split_readiness_blocked": False,
        "gate_impact_preserves_upstream": False,
        "missing_requirements": [],
    }
    if not isinstance(data, dict):
        result["missing_requirements"].append("admin_probe_json_object")
        return result

    coverage = data.get("coverage", [])
    if not isinstance(coverage, list):
        coverage = []
    coverage_by_area = {
        str(item.get("area", "")): item
        for item in coverage
        if isinstance(item, dict)
    }
    result["coverage_areas"] = sorted(area for area in coverage_by_area if area)
    result["coverage_statuses"] = {
        area: coverage_by_area[area].get("status")
        for area in sorted(coverage_by_area)
    }
    for area in sorted(required_coverage_areas):
        if coverage_by_area.get(area, {}).get("status") != "pass":
            result["missing_requirements"].append(f"coverage:{area}:status=pass")
    gate_preservation = coverage_by_area.get("gate_blocker_preservation", {})
    result["gate_blocker_preservation"] = (
        isinstance(gate_preservation, dict)
        and gate_preservation.get("status") == "blocked"
        and text_contains(gate_preservation, ("production_backup_rollback_incident",))
    )
    if not result["gate_blocker_preservation"]:
        result["missing_requirements"].append("coverage:gate_blocker_preservation:blocked")

    split_readiness = data.get("split_readiness", [])
    if not isinstance(split_readiness, list):
        split_readiness = []
    split_by_id = {
        str(item.get("split", "")): item
        for item in split_readiness
        if isinstance(item, dict)
    }
    result["split_readiness_paths"] = {
        split_id: next(
            (
                split_by_id.get(alias, {}).get("exact_evidence_path")
                for alias in split_aliases[split_id]
                if alias in split_by_id
            ),
            None,
        )
        for split_id in sorted(required_split_paths)
    }
    split_blockers = []
    for split_id, path in sorted(required_split_paths.items()):
        split = next(
            (
                split_by_id[alias]
                for alias in split_aliases[split_id]
                if alias in split_by_id
            ),
            {},
        )
        if split.get("exact_evidence_path") != path:
            split_blockers.append(f"split_readiness:{split_id}:path")
        if split.get("status") != "blocked_until_exact_split_file":
            split_blockers.append(f"split_readiness:{split_id}:blocked_until_exact_split_file")
        proof = split.get("required_runtime_proof", [])
        if not isinstance(proof, list) or not proof:
            split_blockers.append(f"split_readiness:{split_id}:required_runtime_proof")
    result["missing_requirements"].extend(split_blockers)
    result["split_readiness_blocked"] = not split_blockers

    gate_impact = data.get("gate_impact", {})
    remaining = gate_impact.get("remaining_blockers", []) if isinstance(gate_impact, dict) else []
    result["gate_impact_preserves_upstream"] = (
        isinstance(gate_impact, dict)
        and gate_impact.get("can_clear_check_level_items") is False
        and isinstance(remaining, list)
        and "ci_staging_gates_not_passed" in remaining
    )
    if not result["gate_impact_preserves_upstream"]:
        result["missing_requirements"].append("gate_impact:preserves_ci_staging_gates_not_passed")

    result["ready"] = not result["missing_requirements"]
    return result


def validate_split(
    ref: str,
    *,
    split_id: str,
    required_tokens: tuple[str, ...],
    required_conditions: tuple[str, ...],
    required_refs: tuple[str, ...] = (),
) -> dict:
    data, error = load_json(ref)
    result = {
        "split_id": split_id,
        "path": ref,
        "exists": data is not None,
        "environment": None,
        "release_gate_check_id": None,
        "release_sha": None,
        "status": "missing" if data is None else "invalid",
        "passed": False,
        "missing_requirements": [],
    }
    if data is None:
        result["missing_requirements"].append(error)
        return result

    result["environment"] = data.get("environment")
    result["release_gate_check_id"] = data.get("release_gate_check_id")
    result["release_sha"] = data.get("release_sha")
    statuses = collect_statuses(data)
    blocker_markers = collect_blocker_markers(data)
    result["status"] = data.get("status", "unknown")

    if data.get("environment") != "production":
        result["missing_requirements"].append("environment=production")
    if data.get("release_gate_check_id") != "production_backup_rollback_incident":
        result["missing_requirements"].append("release_gate_check_id=production_backup_rollback_incident")
    if not release_sha:
        result["missing_requirements"].append("RELEASE_SHA")
    elif data.get("release_sha") != release_sha:
        result["missing_requirements"].append("release_sha_matches_candidate")
    if not (statuses & {"pass", "passed"}):
        result["missing_requirements"].append("status=pass_or_passed")
    if statuses & {"blocked", "blocked_by_upstream_gates", "fail", "failed"}:
        result["missing_requirements"].append("no_blocked_or_failed_nested_status")
    if blocker_markers:
        result["missing_requirements"].append(
            "no_preserved_blockers:" + ",".join(sorted(blocker_markers))
        )
    for token in required_tokens:
        if not text_contains(data, (token,)):
            result["missing_requirements"].append(f"token:{token}")
    for condition in required_conditions:
        if not text_contains(data, (condition,)):
            result["missing_requirements"].append(f"runtime_proof:{condition}")
    for ref_token in required_refs:
        if not text_contains(data, (ref_token,)):
            result["missing_requirements"].append(f"evidence_ref:{ref_token}")

    result["passed"] = not result["missing_requirements"]
    return result


ci_gate = gate_status(ci_gate_ref)
private_beta_gate = gate_status(private_beta_gate_ref)
production_gate = gate_status(production_gate_ref)
admin_probe, admin_probe_error = load_json(admin_probe_ref)
admin_probe_semantic = admin_probe_semantics(admin_probe)
admin_probe_ready = (
    isinstance(admin_probe, dict)
    and admin_probe.get("environment") == "production"
    and admin_probe.get("status") == "blocked_by_upstream_gates"
    and admin_probe.get("release_gate_check_id") == "production_backup_rollback_incident"
    and admin_probe_semantic["ready"]
)

backup_split = validate_split(
    backup_restore_ref,
    split_id="backup_restore",
    required_tokens=("backup", "postgres restore", "object restore", "rpo", "rto", "audit"),
    required_conditions=(
        "backup_schedule",
        "postgres_restore",
        "object_restore",
        "rpo",
        "rto",
    ),
)
rollback_split = validate_split(
    rollback_incident_ref,
    split_id="rollback_incident_post_deploy_smoke",
    required_tokens=("rollback", "incident", "migration compatibility", "post-deploy smoke"),
    required_conditions=(
        "app_rollback",
        "feature_flag",
        "worker_drain",
        "migration_compatibility",
        "incident",
        "post_deploy_smoke",
    ),
    required_refs=(
        "fixtures/stage0/rev2/release_gate_evidence.ci.json",
        "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
    ),
)

upstream_ready = ci_gate["ready"] and private_beta_gate["ready"]
split_files_ready = backup_split["passed"] and rollback_split["passed"]
production_other_blockers = [
    blocker
    for blocker in production_gate["blocked_by_checks"]
    if blocker != "production_backup_rollback_incident"
]
production_other_active_conditions = [
    condition
    for condition in production_gate["active_do_not_launch_conditions"]
    if condition
    not in {
        "backup_restore_rollback_smoke_missing",
        "production_deploy_rollback_smoke_missing",
        "ci_staging_gates_not_passed",
    }
]
production_fixture_allows_split_closure = not production_other_blockers and not production_other_active_conditions
all_passed = (
    environment == "production"
    and re.fullmatch(r"[0-9a-f]{40}", release_sha or "") is not None
    and admin_probe_ready
    and upstream_ready
    and split_files_ready
    and production_fixture_allows_split_closure
)

blocked_checks = []
if environment != "production":
    blocked_checks.append("environment_not_production")
if not re.fullmatch(r"[0-9a-f]{40}", release_sha or ""):
    blocked_checks.append("release_sha_missing_or_not_full_sha")
if not admin_probe_ready:
    if admin_probe_error:
        blocked_checks.append(f"admin_visible_probe_not_ready:{admin_probe_error}")
    else:
        blocked_checks.append(
            "admin_visible_probe_not_ready:"
            + ",".join(admin_probe_semantic["missing_requirements"])
        )
if not ci_gate["ready"]:
    blocked_checks.append("ci_gate_not_go")
if not private_beta_gate["ready"]:
    blocked_checks.append("private_beta_staging_gate_not_go")
if not backup_split["passed"]:
    blocked_checks.append("production_backup_restore_split_not_passed")
if not rollback_split["passed"]:
    blocked_checks.append("production_rollback_incident_post_deploy_split_not_passed")
if split_files_ready and upstream_ready and not production_fixture_allows_split_closure:
    blocked_checks.append("production_gate_fixture_has_unrelated_blockers")

status = "passed" if all_passed else "blocked_by_upstream_gates"
report = {
    "schema_version": "stage0.rev2.production.backup_rollback_split_preflight",
    "blueprint_source": "Docs/stage0_blueprint_rev2.md",
    "created_by_lane": "lane5",
    "evidence_id": run_id,
    "environment": "production",
    "kind": "production_backup_rollback_split_preflight",
    "release_sha": release_sha,
    "status": status,
    "release_gate_check_id": "production_backup_rollback_incident",
    "do_not_launch_condition_ids": [
        "backup_restore_rollback_smoke_missing",
        "production_deploy_rollback_smoke_missing",
        "ci_staging_gates_not_passed",
    ],
    "admin_visible_probe": {
        "path": admin_probe_ref,
        "ready": admin_probe_ready,
        "required_status": "blocked_by_upstream_gates",
        "semantic_validation": admin_probe_semantic,
    },
    "upstream_gates": {
        "ci": ci_gate,
        "private_beta_staging": private_beta_gate,
        "production_launch": production_gate,
        "ci_and_private_beta_ready": upstream_ready,
        "production_fixture_allows_split_closure": production_fixture_allows_split_closure,
        "production_other_blockers": production_other_blockers,
        "production_other_active_conditions": production_other_active_conditions,
    },
    "split_evidence": {
        "backup_restore": backup_split,
        "rollback_incident_post_deploy_smoke": rollback_split,
        "all_exact_split_files_ready": split_files_ready,
    },
    "blocked_checks": blocked_checks,
    "runtime_input_requirements": {
        "required_release_sha": "full production release SHA matching both exact split evidence files",
        "required_upstream_gates": [
            "fixtures/stage0/rev2/release_gate_evidence.ci.json gate_decision.status=go",
            "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json gate_decision.status=go",
        ],
        "required_split_evidence": {
            "backup_restore": {
                "path": "ops/evidence/production/backup-restore.json",
                "must_prove": [
                    "backup schedule",
                    "Postgres restore",
                    "object restore",
                    "RPO/RTO",
                    "audit refs",
                ],
            },
            "rollback_incident_post_deploy_smoke": {
                "path": "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
                "must_prove": [
                    "app rollback",
                    "feature flag rollback",
                    "worker drain",
                    "migration compatibility",
                    "incident/alert path",
                    "post-deploy smoke",
                ],
            },
        },
    },
    "gate_impact": {
        "check_level_items": [
            "Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。",
            "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves rollback drill, incident/alert path, migration compatibility, and post-deploy smoke under `ops/evidence/production/`。",
        ],
        "can_clear_check_level_items": all_passed,
        "can_clear_release_gate_check": all_passed,
        "aggregate_production_gate_status": "ready" if all_passed else "blocked_by_upstream_or_missing_exact_split_evidence",
        "preserved_release_gate_check_id": None if all_passed else "production_backup_rollback_incident",
        "preserved_do_not_launch_condition_ids": [] if all_passed else [
            "backup_restore_rollback_smoke_missing",
            "production_deploy_rollback_smoke_missing",
            "ci_staging_gates_not_passed",
        ],
    },
}

report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
try:
    print(report_path.relative_to(root))
except ValueError:
    print(report_path)
raise SystemExit(0 if all_passed else 2)
PY
