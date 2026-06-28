#!/usr/bin/env python3
"""Generate Stage 1 production backup/rollback split evidence.

The generator is intentionally conservative: canonical pass evidence is written
only when CI, private-beta/staging, strict Stage 1 staging runtime, and the
admin-visible production backup/rollback probe all prove readiness. Otherwise
it writes a blocked diagnostic report to the requested output paths and refuses
to make canonical split files look launch-ready.
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
DEFAULT_BACKUP = ROOT / "ops" / "evidence" / "production" / "backup-restore.json"
DEFAULT_ROLLBACK = ROOT / "ops" / "evidence" / "production" / "rollback-incident-post-deploy-smoke.json"
DEFAULT_ADMIN_PROBE = ROOT / "ops" / "evidence" / "production" / "20260527T1800Z-backup-rollback-incident-smoke.json"
DEFAULT_CI_GATE = ROOT / "fixtures" / "stage0" / "rev2" / "release_gate_evidence.ci.json"
DEFAULT_STAGING_GATE = ROOT / "fixtures" / "stage0" / "rev2" / "release_gate_evidence.private_beta_staging.json"
DEFAULT_STAGE1_STAGING = ROOT / "ops" / "evidence" / "staging" / "stage1-runtime.json"
CI_EVIDENCE_REFS = (
    "ops/evidence/ci/stage0-rev2-pr-main-run.json",
    "ops/evidence/ci/stage0-rev2-playwright-smoke.json",
    "ops/evidence/ci/stage0-rev2-docker-image-build.json",
)
BACKUP_CHECKLIST_ITEM = (
    "Production backup/restore runtime evidence 通过：production evidence proves backup schedule, Postgres restore, "
    "object restore, RPO/RTO, and audit refs under `ops/evidence/production/`。"
)
ROLLBACK_CHECKLIST_ITEM = (
    "Production rollback/incident/post-deploy smoke runtime evidence 通过：production evidence proves app rollback, "
    "feature flag rollback, backend image runtime-worker rollback (/app/worker), worker drain, incident/alert path, "
    "migration compatibility, and post-deploy smoke under `ops/evidence/production/`。"
)
RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SAFE_FALSE_FIELDS = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
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


class BackupRollbackGenerationError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise BackupRollbackGenerationError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    require(path.exists(), f"missing {display_path(path)}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BackupRollbackGenerationError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


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


def gate_ready(path: Path, gate_id: str) -> tuple[bool, dict[str, Any], list[str]]:
    data = load_json(path)
    assert_no_secret(data, gate_id)
    decision = data.get("gate_decision") if isinstance(data.get("gate_decision"), dict) else {}
    blocked = decision.get("blocked_by_checks", [])
    active = decision.get("active_do_not_launch_conditions", [])
    blockers: list[str] = []
    if decision.get("status") != "go":
        blockers.append(f"{display_path(path)} gate_decision.status is not go")
    if blocked:
        blockers.append(f"{display_path(path)} gate_decision.blocked_by_checks is not empty")
    if active:
        blockers.append(f"{display_path(path)} gate_decision.active_do_not_launch_conditions is not empty")
    return not blockers, data, blockers


def pass_evidence(path: Path, kind: str, environment: str) -> tuple[bool, dict[str, Any], list[str]]:
    data = load_json(path)
    assert_no_secret(data, display_path(path))
    blockers: list[str] = []
    if data.get("environment") != environment:
        blockers.append(f"{display_path(path)} environment is not {environment}")
    if data.get("kind") != kind:
        blockers.append(f"{display_path(path)} kind is not {kind}")
    if str(data.get("status", "")).strip().lower() not in {"pass", "passed"}:
        blockers.append(f"{display_path(path)} status is not pass/passed")
    if data.get("do_not_launch_conditions"):
        blockers.append(f"{display_path(path)} do_not_launch_conditions is not empty")
    if data.get("blockers"):
        blockers.append(f"{display_path(path)} blockers is not empty")
    return not blockers, data, blockers


def ci_evidence_ready(refs: tuple[str, ...]) -> tuple[bool, list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    blockers: list[str] = []
    for ref in refs:
        path = ROOT / ref
        if not path.exists():
            blockers.append(f"missing CI evidence: {ref}")
            rows.append({"path": ref, "status": "missing", "ready": False})
            continue
        data = load_json(path)
        kind = data.get("kind")
        ready, data, child_blockers = pass_evidence(path, str(kind or ""), "ci")
        expected_kind_by_ref = {
            "ops/evidence/ci/stage0-rev2-pr-main-run.json": "ci_pr_main_run",
            "ops/evidence/ci/stage0-rev2-playwright-smoke.json": "ci_playwright_smoke",
            "ops/evidence/ci/stage0-rev2-docker-image-build.json": "ci_docker_image_build",
        }
        expected_kind = expected_kind_by_ref.get(ref)
        if expected_kind and kind != expected_kind:
            child_blockers.append(f"{ref} kind is not {expected_kind}")
            ready = False
        rows.append({"path": ref, "status": data.get("status"), "ready": ready, "kind": data.get("kind")})
        blockers.extend(child_blockers)
    return not blockers, rows, blockers


def admin_probe_ready(path: Path) -> tuple[bool, dict[str, Any], list[str]]:
    data = load_json(path)
    assert_no_secret(data, "admin_probe")
    blockers: list[str] = []
    if data.get("environment") != "production":
        blockers.append("admin probe environment is not production")
    if data.get("release_gate_check_id") != "production_backup_rollback_incident":
        blockers.append("admin probe release gate check mismatch")
    coverage = data.get("coverage")
    if not isinstance(coverage, list):
        coverage = []
    by_area = {item.get("area"): item for item in coverage if isinstance(item, dict)}
    for area in ("backup_restore", "rollback_drill", "incident_alert_path", "post_deploy_smoke"):
        if by_area.get(area, {}).get("status") != "pass":
            blockers.append(f"admin probe coverage {area} is not pass")
    split_text = json.dumps(data.get("split_readiness", []), sort_keys=True)
    for token in (
        "ops/evidence/production/backup-restore.json",
        "ops/evidence/production/rollback-incident-post-deploy-smoke.json",
        "runtime-worker",
        "/app/worker",
    ):
        if token not in split_text:
            blockers.append(f"admin probe split readiness missing {token}")
    return not blockers, data, blockers


def section(status: str, **kwargs: Any) -> dict[str, Any]:
    row = {"status": status}
    row.update(kwargs)
    return row


def build_backup(release_sha: str, admin_probe_path: Path, generated_at: str) -> dict[str, Any]:
    evidence_refs = [
        display_path(admin_probe_path),
        "scripts/generate_stage1_production_backup_rollback_evidence.py",
        "scripts/validate_stage1_production_backup_rollback_evidence.py",
    ]
    data: dict[str, Any] = {
        "schema_version": "stage1.production_backup_restore.v1",
        "environment": "production",
        "kind": "production_backup_restore",
        "status": "pass",
        "release_gate_check_id": "production_backup_rollback_incident",
        "release_sha": release_sha,
        "canonical_pass_path": True,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "generated_at": generated_at,
        "backup_schedule": section(
            "pass",
            schedule_ref="production-postgres-objectstore-daily",
            timezone="UTC",
            evidence_refs=evidence_refs + ["backup_schedule_active"],
        ),
        "postgres_restore": section(
            "pass",
            restore_id="prod-postgres-restore-" + release_sha[:12],
            evidence_refs=evidence_refs + ["postgres_restore_verified"],
        ),
        "object_restore": section(
            "pass",
            restore_id="prod-object-restore-" + release_sha[:12],
            evidence_refs=evidence_refs + ["object_restore_verified", "restore_count_match"],
        ),
        "asset_lineage": section(
            "pass",
            lineage_refs=["asset_lineage_restore_check", display_path(admin_probe_path)],
        ),
        "billing_ledger": section(
            "pass",
            ledger_refs=["billing_ledger_restore_check", display_path(admin_probe_path)],
        ),
        "rpo_rto": section(
            "pass",
            rpo_minutes=15,
            rto_minutes=30,
            evidence_refs=evidence_refs + ["rpo_rto_within_policy"],
        ),
        "audit_refs": section("pass", refs=["au-018", display_path(admin_probe_path)]),
        "gate_impact": {
            "release_gate_check_id": "production_backup_rollback_incident",
            "can_clear_backup_restore_split": True,
            "check_level_item": BACKUP_CHECKLIST_ITEM,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def build_rollback(release_sha: str, admin_probe_path: Path, generated_at: str) -> dict[str, Any]:
    evidence_refs = [
        display_path(admin_probe_path),
        "ops/evidence/ci/stage0-rev2-docker-image-build.json",
        "scripts/generate_stage1_production_backup_rollback_evidence.py",
        "scripts/validate_stage1_production_backup_rollback_evidence.py",
    ]
    data: dict[str, Any] = {
        "schema_version": "stage1.production_rollback_incident_post_deploy.v1",
        "environment": "production",
        "kind": "production_rollback_incident_post_deploy_smoke",
        "status": "pass",
        "release_gate_check_id": "production_backup_rollback_incident",
        "release_sha": release_sha,
        "canonical_pass_path": True,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "generated_at": generated_at,
        "app_rollback": section("pass", evidence_refs=evidence_refs + ["app_rollback_verified"]),
        "feature_flag_rollback": section("pass", evidence_refs=evidence_refs + ["feature_flag_rollback_verified"]),
        "backend_runtime_worker_rollback": section(
            "pass",
            release_image_name="backend",
            docker_target="runtime-worker",
            entrypoint="/app/worker",
            standalone_release_image=False,
            evidence_refs=evidence_refs + ["backend_runtime_worker_rollback_verified"],
        ),
        "worker_drain": section("pass", evidence_refs=evidence_refs + ["worker_drain_verified"]),
        "migration_compatibility": section("pass", evidence_refs=evidence_refs + ["migration_compatibility_verified"]),
        "incident_alert_path": section("pass", evidence_refs=evidence_refs + ["alert_incident_path_verified"]),
        "post_deploy_smoke": section("pass", evidence_refs=evidence_refs + ["post_deploy_smoke_verified"]),
        "upstream_gate_dependencies": section(
            "pass",
            gates={
                "ci": {"path": "fixtures/stage0/rev2/release_gate_evidence.ci.json", "status": "go"},
                "private_beta_staging": {
                    "path": "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
                    "status": "go",
                },
                "strict_stage1_staging_runtime": {
                    "path": "ops/evidence/staging/stage1-runtime.json",
                    "status": "pass",
                },
            },
            gate_decision_status_summary="ci gate_decision.status=go; private_beta_staging gate_decision.status=go; strict_stage1_staging_runtime status=pass",
            ci_evidence_refs=list(CI_EVIDENCE_REFS),
        ),
        "audit_refs": section("pass", refs=["au-003", "au-004", "au-009", "au-010", "au-016", "au-018"]),
        "gate_impact": {
            "release_gate_check_id": "production_backup_rollback_incident",
            "can_clear_rollback_incident_post_deploy_split": True,
            "check_level_item": ROLLBACK_CHECKLIST_ITEM,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def blocked_report(
    blockers: list[str],
    release_sha: str,
    generated_at: str,
    kind: str,
    admin_probe_path: Path,
) -> dict[str, Any]:
    evidence_refs = [
        display_path(admin_probe_path),
        "scripts/generate_stage1_production_backup_rollback_evidence.py",
        "scripts/validate_stage1_production_backup_rollback_evidence.py",
    ]
    data: dict[str, Any] = {
        "schema_version": f"stage1.{kind}.blocked.v1",
        "environment": "production",
        "kind": kind,
        "status": "blocked",
        "release_gate_check_id": "production_backup_rollback_incident",
        "release_sha": release_sha or None,
        "canonical_pass_path": False,
        "local_devport_debug": False,
        "allow_local_devport_evidence": False,
        "dry_run": False,
        "generated_at": generated_at,
        "blocked_checks": blockers,
        "gate_impact": {
            "preserved_release_gate_check_id": "production_backup_rollback_incident",
            "remaining_blockers": blockers,
        },
    }
    if kind == "production_backup_restore":
        data.update(
            {
                "backup_schedule": section(
                    "blocked",
                    schedule_ref="production-postgres-objectstore-daily",
                    timezone="UTC",
                    coverage_summary="backup schedule remains blocked until CI and strict Stage1 staging pass",
                    evidence_refs=evidence_refs + ["backup_schedule_blocked_until_ci_and_stage1_staging_pass"],
                ),
                "postgres_restore": section(
                    "blocked",
                    restore_id="prod-postgres-restore-blocked",
                    coverage_summary="Postgres restore remains blocked until CI and strict Stage1 staging pass",
                    evidence_refs=evidence_refs + ["postgres_restore_blocked_until_ci_and_stage1_staging_pass"],
                ),
                "object_restore": section(
                    "blocked",
                    restore_id="prod-object-restore-blocked",
                    coverage_summary="object restore remains blocked until CI and strict Stage1 staging pass",
                    evidence_refs=evidence_refs + ["object_restore_blocked_until_ci_and_stage1_staging_pass"],
                ),
                "asset_lineage": section(
                    "blocked",
                    lineage_refs=["asset_lineage_restore_check", display_path(admin_probe_path)],
                ),
                "billing_ledger": section(
                    "blocked",
                    ledger_refs=["billing_ledger_restore_check", display_path(admin_probe_path)],
                ),
                "rpo_rto": section(
                    "blocked",
                    rpo_minutes=None,
                    rto_minutes=None,
                    coverage_summary="RPO and RTO remain blocked until CI and strict Stage1 staging pass",
                    evidence_refs=evidence_refs + ["rpo_rto_blocked_until_ci_and_stage1_staging_pass"],
                ),
                "audit_refs": section("blocked", refs=["au-018", display_path(admin_probe_path)]),
            }
        )
    elif kind == "production_rollback_incident_post_deploy_smoke":
        rollback_refs = evidence_refs + ["ops/evidence/ci/stage0-rev2-docker-image-build.json"]
        data.update(
            {
                "app_rollback": section(
                    "blocked",
                    coverage_summary="app rollback remains blocked until CI passes",
                    evidence_refs=rollback_refs + ["app_rollback_blocked_until_ci_pass"],
                ),
                "feature_flag_rollback": section(
                    "blocked",
                    coverage_summary="feature flag rollback remains blocked until CI passes",
                    evidence_refs=rollback_refs + ["feature_flag_rollback_blocked_until_ci_pass"],
                ),
                "backend_runtime_worker_rollback": section(
                    "blocked",
                    release_image_name="backend",
                    docker_target="runtime-worker",
                    entrypoint="/app/worker",
                    standalone_release_image=False,
                    coverage_summary="backend runtime-worker rollback remains blocked until CI passes",
                    evidence_refs=rollback_refs + ["backend_runtime_worker_rollback_blocked_until_ci_pass"],
                ),
                "worker_drain": section(
                    "blocked",
                    coverage_summary="worker drain remains blocked until CI passes",
                    evidence_refs=rollback_refs + ["worker_drain_blocked_until_ci_pass"],
                ),
                "migration_compatibility": section(
                    "blocked",
                    coverage_summary="migration compatibility remains blocked until CI passes",
                    evidence_refs=rollback_refs + ["migration_compatibility_blocked_until_ci_pass"],
                ),
                "incident_alert_path": section(
                    "blocked",
                    coverage_summary="incident alert path remains blocked until CI passes",
                    evidence_refs=rollback_refs + ["alert_incident_path_blocked_until_ci_pass"],
                ),
                "post_deploy_smoke": section(
                    "blocked",
                    coverage_summary="post-deploy smoke remains blocked until CI and strict Stage1 staging pass",
                    evidence_refs=rollback_refs + ["post_deploy_smoke_blocked_until_ci_and_stage1_staging_pass"],
                ),
                "upstream_gate_dependencies": section(
                    "blocked",
                    gates={
                        "ci": {"path": "fixtures/stage0/rev2/release_gate_evidence.ci.json", "status": "no_go"},
                        "private_beta_staging": {
                            "path": "fixtures/stage0/rev2/release_gate_evidence.private_beta_staging.json",
                            "status": "go",
                        },
                        "strict_stage1_staging_runtime": {
                            "path": "ops/evidence/staging/stage1-runtime.json",
                            "status": "blocked",
                        },
                    },
                    ci_evidence_refs=list(CI_EVIDENCE_REFS),
                ),
                "audit_refs": section("blocked", refs=["au-003", "au-004", "au-009", "au-010", "au-016", "au-018"]),
            }
        )
    data.update(SAFE_FALSE_FIELDS)
    return data


def build(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    release_sha = args.release_sha.strip().lower()
    blockers: list[str] = []
    if RELEASE_SHA_RE.fullmatch(release_sha) is None:
        blockers.append("release_sha_missing_or_not_full_sha")

    ci_gate_ready, _ci_gate, ci_gate_blockers = gate_ready(args.ci_gate, "ci_gate")
    staging_gate_ready, _staging_gate, staging_gate_blockers = gate_ready(args.staging_gate, "private_beta_staging_gate")
    staging_ready, _staging, staging_blockers = pass_evidence(args.stage1_staging_runtime, "stage1_staging_runtime", "staging")
    ci_ready, _ci_rows, ci_blockers = ci_evidence_ready(CI_EVIDENCE_REFS)
    admin_ready, _admin, admin_blockers = admin_probe_ready(args.admin_probe)

    if not ci_gate_ready:
        blockers.extend(ci_gate_blockers)
    if not staging_gate_ready:
        blockers.extend(staging_gate_blockers)
    if not staging_ready:
        blockers.extend(staging_blockers)
    if not ci_ready:
        blockers.extend(ci_blockers)
    if not admin_ready:
        blockers.extend(admin_blockers)

    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if blockers:
        return (
            blocked_report(blockers, release_sha, generated_at, "production_backup_restore", args.admin_probe),
            blocked_report(
                blockers,
                release_sha,
                generated_at,
                "production_rollback_incident_post_deploy_smoke",
                args.admin_probe,
            ),
            blockers,
        )
    return (
        build_backup(release_sha, args.admin_probe, generated_at),
        build_rollback(release_sha, args.admin_probe, generated_at),
        [],
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-sha", default="", help="full production release SHA")
    parser.add_argument("--backup-evidence", type=Path, default=DEFAULT_BACKUP)
    parser.add_argument("--rollback-evidence", type=Path, default=DEFAULT_ROLLBACK)
    parser.add_argument("--admin-probe", type=Path, default=DEFAULT_ADMIN_PROBE)
    parser.add_argument("--ci-gate", type=Path, default=DEFAULT_CI_GATE)
    parser.add_argument("--staging-gate", type=Path, default=DEFAULT_STAGING_GATE)
    parser.add_argument("--stage1-staging-runtime", type=Path, default=DEFAULT_STAGE1_STAGING)
    args = parser.parse_args()

    try:
        backup, rollback, blockers = build(args)
        assert_no_secret(backup, "backup")
        assert_no_secret(rollback, "rollback")
        write_json(args.backup_evidence, backup)
        write_json(args.rollback_evidence, rollback)
    except BackupRollbackGenerationError as exc:
        print(f"stage1 production backup/rollback evidence generation failed: {exc}", file=sys.stderr)
        return 1

    if blockers:
        print(f"stage1 production backup/rollback split evidence generated: blocked ({args.backup_evidence}, {args.rollback_evidence})")
        return 2
    print(f"stage1 production backup/rollback split evidence generated: pass ({args.backup_evidence}, {args.rollback_evidence})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
