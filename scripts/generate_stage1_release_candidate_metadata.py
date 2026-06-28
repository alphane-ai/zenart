#!/usr/bin/env python3
"""Generate a non-authoritative Stage 1 release candidate metadata draft.

This script records facts that can be derived from the current repository
without reading local secrets or claiming staging/production evidence. The
generated notes are intentionally no-go until strict CI, staging, and production
evidence is attached through the normal validators.
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
DEFAULT_NOTES = ROOT / "ops" / "release" / "stage1_release_candidate_metadata_draft.md"
DEFAULT_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-metadata-draft.json"
)
DEFAULT_MIGRATION_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-migration-draft.json"
)
DEFAULT_CONFIG_DIFF_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-config-diff-draft.json"
)
DEFAULT_OBSERVABILITY_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-observability-draft.json"
)
DEFAULT_BACKUP_RESTORE_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-backup-restore-draft.json"
)
DEFAULT_LOAD_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-load-draft.json"
)
DEFAULT_ROLLBACK_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-rollback-draft.json"
)
DEFAULT_SECURITY_SCAN_EVIDENCE = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-security-scan-draft.json"
)
ENV_EXAMPLE = ROOT / ".env.example"
MIGRATIONS_DIR = ROOT / "backend" / "migrations"
CONFIG_PATHS = [
    ".env.example",
    "docker-compose.yml",
    ".github/workflows/stage0-rev2-ci.yml",
    "backend/Dockerfile",
    "web/package.json",
    "admin/package.json",
    "ops/release/release_notes_template.md",
]

SECRET_KEY_RE = re.compile(r"(SECRET|TOKEN|KEY|PASSWORD|WEBHOOK|SIGNING|COOKIE|SESSION)", re.IGNORECASE)

STRICT_METADATA_SLOTS = [
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
]

DRAFT_EVIDENCE_SPECS = {
    "migration_evidence": {
        "path": DEFAULT_MIGRATION_EVIDENCE,
        "schema_version": "stage1.release_candidate_migration_draft.v1",
        "kind": "migration",
        "blocking_reasons": [
            "strict_staging_migration_run_evidence_missing",
            "deployed_database_migration_evidence_missing",
            "rollback_or_forward_repair_evidence_missing",
        ],
    },
    "config_diff_evidence": {
        "path": DEFAULT_CONFIG_DIFF_EVIDENCE,
        "schema_version": "stage1.release_candidate_config_diff_draft.v1",
        "kind": "config_diff",
        "blocking_reasons": [
            "strict_staging_config_diff_review_missing",
            "deployed_environment_diff_evidence_missing",
            "operator_approval_missing",
        ],
    },
    "observability_evidence": {
        "path": DEFAULT_OBSERVABILITY_EVIDENCE,
        "schema_version": "stage1.release_candidate_observability_draft.v1",
        "kind": "observability",
        "required_strict_components": [
            "request_id_propagation",
            "structured_json_logs",
            "opentelemetry_traces",
            "backend_worker_crawler_metrics",
            "dashboard_import",
            "alert_routes",
        ],
        "blocking_reasons": [
            "strict_staging_observability_evidence_missing",
            "dashboard_and_alert_runtime_evidence_missing",
            "request_trace_log_correlation_evidence_missing",
        ],
    },
    "backup_restore_evidence": {
        "path": DEFAULT_BACKUP_RESTORE_EVIDENCE,
        "schema_version": "stage1.release_candidate_backup_restore_draft.v1",
        "kind": "backup_restore",
        "required_strict_components": [
            "postgres_restore",
            "object_restore",
        ],
        "blocking_reasons": [
            "strict_staging_backup_restore_evidence_missing",
            "postgres_restore_runtime_evidence_missing",
            "object_restore_runtime_evidence_missing",
        ],
    },
    "load_evidence": {
        "path": DEFAULT_LOAD_EVIDENCE,
        "schema_version": "stage1.release_candidate_load_draft.v1",
        "kind": "load",
        "required_strict_components": [
            "chat_task",
            "worker_generation",
            "zip_export",
            "signed_download",
            "crawler_throttle",
            "quota_contention",
            "workspace_rendering",
        ],
        "blocking_reasons": [
            "strict_stage1_load_evidence_missing",
            "production_like_staging_load_rows_missing",
            "load_threshold_metrics_missing",
        ],
    },
    "rollback_evidence": {
        "path": DEFAULT_ROLLBACK_EVIDENCE,
        "schema_version": "stage1.release_candidate_rollback_draft.v1",
        "kind": "rollback",
        "required_strict_components": [
            "image_rollback",
            "feature_flag_rollback",
            "migration_compatibility",
            "worker_drain",
            "post_rollback_smoke",
        ],
        "blocking_reasons": [
            "strict_staging_rollback_evidence_missing",
            "image_and_feature_flag_rollback_evidence_missing",
            "worker_drain_post_rollback_smoke_missing",
        ],
    },
    "security_scan_evidence": {
        "path": DEFAULT_SECURITY_SCAN_EVIDENCE,
        "schema_version": "stage1.release_candidate_security_scan_draft.v1",
        "kind": "security_scan",
        "required_strict_components": [
            "dependency_scan",
            "image_scan",
            "secret_scan",
        ],
        "blocking_reasons": [
            "strict_security_scan_evidence_missing",
            "dependency_image_secret_scan_reports_missing",
            "security_operator_review_missing",
        ],
    },
}


class DraftMetadataError(Exception):
    pass


def run_git(args: list[str]) -> str:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=ROOT,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as exc:
        raise DraftMetadataError(exc.stderr.strip() or f"git {' '.join(args)} failed") from exc
    return completed.stdout.strip()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def list_migrations() -> list[str]:
    if not MIGRATIONS_DIR.exists():
        return []
    return [display_path(path) for path in sorted(MIGRATIONS_DIR.glob("*.sql"))]


def migration_file_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path_ref in list_migrations():
        path = ROOT / path_ref
        first_line = ""
        try:
            first_line = path.read_text(encoding="utf-8", errors="replace").splitlines()[0].strip()
        except IndexError:
            first_line = ""
        rows.append(
            {
                "path": path_ref,
                "filename": path.name,
                "first_line": first_line,
                "exists": path.exists(),
            }
        )
    return rows


def parse_env_example() -> dict[str, Any]:
    keys: list[str] = []
    secret_like_keys: list[str] = []
    if not ENV_EXAMPLE.exists():
        return {
            "path": display_path(ENV_EXAMPLE),
            "exists": False,
            "keys": keys,
            "secret_like_keys": secret_like_keys,
        }
    for line in ENV_EXAMPLE.read_text(encoding="utf-8", errors="replace").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.split("=", 1)[0].strip()
        if not key:
            continue
        keys.append(key)
        if SECRET_KEY_RE.search(key):
            secret_like_keys.append(key)
    return {
        "path": display_path(ENV_EXAMPLE),
        "exists": True,
        "key_count": len(keys),
        "keys": keys,
        "secret_like_keys": secret_like_keys,
    }


def config_file_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    status_by_path: dict[str, str] = {}
    for line in run_git(["status", "--short", "--", *CONFIG_PATHS]).splitlines():
        if not line.strip():
            continue
        status_by_path[line[3:]] = line[:2]
    for path_ref in CONFIG_PATHS:
        path = ROOT / path_ref
        rows.append(
            {
                "path": path_ref,
                "exists": path.exists(),
                "git_status": status_by_path.get(path_ref, ""),
            }
        )
    return rows


def git_status() -> dict[str, Any]:
    lines = [line for line in run_git(["status", "--short"]).splitlines() if line.strip()]
    return {
        "dirty": bool(lines),
        "entry_count": len(lines),
        "entries": lines,
    }


def existing_artifact(path: str) -> dict[str, Any]:
    candidate = ROOT / path
    return {
        "path": path,
        "exists": candidate.exists(),
        "strict_usable": False,
        "reason": "candidate_reference_only_not_validated_as_stage1_release_metadata",
    }


def collect_candidate_refs() -> dict[str, Any]:
    return {
        "ci_workflow": existing_artifact(".github/workflows/stage0-rev2-ci.yml"),
        "release_bundle": existing_artifact(
            "ops/evidence/release/staging/stage0-rev2-current-release-evidence-bundle.json"
        ),
        "release_metadata_preflight": existing_artifact(
            "ops/evidence/release/staging/stage1-release-metadata-preflight.json"
        ),
        "staging_runtime": existing_artifact("ops/evidence/staging/stage1-runtime.json"),
        "staging_provider_sandbox": existing_artifact("ops/evidence/staging/stage1-provider-sandbox.json"),
        "staging_stripe": existing_artifact("ops/evidence/staging/stripe-test-checkout-webhook.json"),
        "staging_safety_qa": existing_artifact("ops/evidence/staging/stage1-safety-qa-eval.json"),
        "staging_object_retention": existing_artifact(
            "ops/evidence/staging/object-storage-retention-cleanup.json"
        ),
        "production_launch": existing_artifact("ops/evidence/production/stage1-production-launch.json"),
    }


def build_migration_draft(release_sha: str) -> dict[str, Any]:
    files = migration_file_rows()
    return {
        "schema_version": "stage1.release_candidate_migration_draft.v1",
        "kind": "migration",
        "environment": "staging_metadata_draft",
        "status": "blocked",
        "release_sha": release_sha,
        "migration_count": len(files),
        "migration_files": files,
        "expand_contract_compatibility": "local_contract_only",
        "worker_schema_compatibility": "local_contract_only",
        "strict_usable": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "blocking_reasons": [
            "strict_staging_migration_run_evidence_missing",
            "deployed_database_migration_evidence_missing",
            "rollback_or_forward_repair_evidence_missing",
        ],
    }


def build_config_diff_draft(release_sha: str) -> dict[str, Any]:
    env_example = parse_env_example()
    return {
        "schema_version": "stage1.release_candidate_config_diff_draft.v1",
        "kind": "config_diff",
        "environment": "staging_metadata_draft",
        "status": "blocked",
        "release_sha": release_sha,
        "config_files": config_file_rows(),
        "env_example": env_example,
        "env_key_count": env_example.get("key_count", 0),
        "env_keys": env_example.get("keys", []),
        "sensitive_name_only_keys": env_example.get("secret_like_keys", []),
        "strict_usable": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "blocking_reasons": [
            "strict_staging_config_diff_review_missing",
            "deployed_environment_diff_evidence_missing",
            "operator_approval_missing",
        ],
    }


def build_strict_gap_draft(release_sha: str, slot: str) -> dict[str, Any]:
    spec = DRAFT_EVIDENCE_SPECS[slot]
    return {
        "schema_version": spec["schema_version"],
        "kind": spec["kind"],
        "environment": "staging_metadata_draft",
        "status": "blocked",
        "release_sha": release_sha,
        "slot": slot,
        "required_strict_components": list(spec.get("required_strict_components", [])),
        "strict_usable": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "blocking_reasons": list(spec["blocking_reasons"]),
    }


def build_sidecar(slot: str, release_sha: str) -> dict[str, Any]:
    if slot == "migration_evidence":
        return build_migration_draft(release_sha)
    if slot == "config_diff_evidence":
        return build_config_diff_draft(release_sha)
    return build_strict_gap_draft(release_sha, slot)


def render_notes(report: dict[str, Any]) -> str:
    migration_lines = "\n".join(f"- {path}" for path in report["migration_files"]) or "- n/a"
    env_keys = ", ".join(report["env_example"]["keys"]) or "n/a"
    secret_key_names = ", ".join(report["env_example"]["secret_like_keys"]) or "n/a"
    dirty_status = "dirty" if report["git_status"]["dirty"] else "clean"
    strict_open = "\n".join(f"- {slot}: missing strict validator-readable staging evidence" for slot in STRICT_METADATA_SLOTS)
    draft_lines = "\n".join(
        f"- {slot}: `{path}`; candidate-only and not strict staging evidence."
        for slot, path in report["preflight_inputs"].items()
        if slot.endswith("_evidence") and path
    )
    workflow_status = "present" if report["candidate_refs"]["ci_workflow"]["exists"] else "missing"

    return f"""# Stage 1 Release Candidate Metadata Draft

Authoritative source: `Docs/Stage1_20260621_blueprint.md`.

This draft is generated from repository state only. It does not close CI,
staging, production, or Do-Not-Launch gates.

## Identity

- Release SHA: `{report["release_sha"]}`
- Release tag: `n/a`
- Owner: `release-owner-unassigned`
- Reviewer: `reviewer-unassigned`
- Environment: `staging metadata draft`
- Date: `{report["generated_date"]}`
- Worktree state: `{dirty_status}`

## Scope

- User-facing changes: Stage 1 workspace, canvas, batch progress, billing, support, legal, and brand surfaces continue toward zenari.ai launch readiness.
- Admin/operator changes: Provider registry, strategy groups, queues, quota, billing operations, release readiness, safety, support, and audit surfaces are part of the current candidate scope.
- Release image scope: only backend, web, and admin are release images. Worker/crawler/migrate are backend runtime commands; manager is legacy local-only and not release metadata input.
- Backend runtime changes: Stage 1 API, worker fan-out, crawler governance, provider adapters, quota ledger, Stripe, object storage, trace, safety, team seats, and release validators are in scope through the backend image.
- Ops/config changes: Local ports, Stripe test placeholders, OpenAI-compatible provider placeholders, metrics ports, release metadata preflight, release bundle, staging runtime, and production launch gates are in scope.

## Migration List

{migration_lines}
- Expand/contract compatibility notes: compatible for local contract validation only; strict staging migration evidence is not attached.
- Worker schema compatibility notes: local contracts exist, but deployed worker drain and restart evidence is not attached.
- Rollback constraints: forward repair required for any production migration until rollback drill evidence is attached.

## Config Diff

- Environment variables added or tracked in `.env.example`: {env_keys}
- Secret-bearing variable names tracked without values: {secret_key_names}
- Secret source changes: names only; no secret values are recorded by this draft.
- Object storage changes: MinIO/S3-compatible local ports and bucket naming are documented in `.env.example` and `docker-compose.yml`; strict staging policy evidence remains required.
- Provider/model routing changes: provider registry and strategy-group contracts exist locally; strict staging provider sandbox evidence remains required.

## Feature Flags

- Enabled: Stage 1 local contract validators, release metadata preflight, Stripe test-mode placeholders, OpenAI-compatible provider contract checks.
- Disabled: production launch, Do-Not-Launch closure, live Stripe launch, release metadata completion.
- Emergency rollback flags: `PROVIDER_EMERGENCY_KILL_SWITCH=true`, `RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH=true`, `WORKER_BATCH_ENABLED=false`.

## Smoke Plan

- Backend health/readiness: run `scripts/staging_smoke.sh` against production-like staging and attach validator-readable evidence.
- Web smoke: run Playwright smoke from installed CI or production-like staging and attach evidence.
- Admin smoke: run admin provider, quota, billing, release, safety, support, and audit smoke against production-like staging and attach evidence.
- Export/package smoke: attach signed download, manifest, rendered export, retention, and cleanup evidence from staging.
- Signed download smoke: attach canonical staging signed URL and retention cleanup split evidence.
- Backend runtime smoke: attach worker drain, batch fan-out, queue, provider, and crawler governance evidence under the backend release image.
- Quota/rate-limit smoke: attach quota ledger, Stripe webhook, provider usage, and Redis-backed rate-limit evidence.

## Evidence

- CI workflow file: `{workflow_status}` at `.github/workflows/stage0-rev2-ci.yml`.
- Draft metadata sidecars:
{draft_lines}
- Release metadata preflight: `ops/evidence/release/staging/stage1-release-metadata-preflight.json`.
- Release bundle: `ops/evidence/release/staging/stage0-rev2-current-release-evidence-bundle.json`.
- Production launch evidence: `ops/evidence/production/stage1-production-launch.json`.
- Strict metadata slots still open:
{strict_open}

## Rollback Plan

- Previous SHA: `not-selected`
- Image rollback command: `not-ready; requires CI image refs for backend, web, and admin`.
- Feature flag rollback: set `WORKER_BATCH_ENABLED=false`, provider kill switches on, and keep production launch gate no-go.
- Migration repair plan: forward repair only until staging rollback and production backup/rollback split evidence pass.
- Worker drain plan: use worker drain procedure after staging evidence proves idempotent restart and no duplicate child execution.
- Owner and escalation: release owner not assigned in this draft.

## Known Risks

- Open private beta blockers: strict staging runtime, load, object retention, provider sandbox, Stripe, observability, backup, safety, and legal/support evidence must remain validator-owned.
- Open production do-not-launch conditions: CI exact evidence, staging runtime, release bundle, production billing, security, provider claims, backup/restore, rollback, legal/support, and governance evidence remain open.
- Operational risks: worktree is `{dirty_status}`; release SHA identifies HEAD only and does not by itself prove current uncommitted changes.
- User/support risks: paid launch support, billing, refund, IP complaint, and incident paths still require staging and production proof.

## Go/No-Go

- Decision: `no-go`
- Approver: `not-approved`
- Conditions: no-go until CI, staging, smoke, observability, restore, rollback, security, release owner, image refs, and production split evidence are attached and validators pass.
- Follow-up deadline: `n/a`
"""


def build_report(notes_path: Path, sidecar_paths: dict[str, Path], release_sha_override: str = "") -> dict[str, Any]:
    release_sha = release_sha_override.strip().lower() or run_git(["rev-parse", "HEAD"])
    if re.fullmatch(r"[0-9a-f]{40}", release_sha) is None:
        raise DraftMetadataError("release SHA must be a full 40-character lowercase hex SHA")
    short_sha = release_sha[:12]
    now = datetime.now(timezone.utc).replace(microsecond=0)
    report: dict[str, Any] = {
        "schema_version": "stage1.release_candidate_metadata_draft.v1",
        "kind": "stage1_release_candidate_metadata_draft",
        "environment": "staging_metadata_draft",
        "generated_at": now.isoformat(),
        "generated_date": now.date().isoformat(),
        "status": "blocked",
        "decision": "no-go",
        "release_sha": release_sha,
        "release_sha_short": short_sha,
        "release_notes_path": display_path(notes_path),
        "metadata_complete": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_clear_do_not_launch": False,
        "git_status": git_status(),
        "migration_files": list_migrations(),
        "env_example": parse_env_example(),
        "candidate_refs": collect_candidate_refs(),
        "strict_metadata_slots_still_required": STRICT_METADATA_SLOTS,
        "preflight_inputs": {
            "release_sha": release_sha,
            "release_notes_path": display_path(notes_path),
            "image_refs": [],
            "migration_evidence": display_path(sidecar_paths["migration_evidence"]),
            "config_diff_evidence": display_path(sidecar_paths["config_diff_evidence"]),
            "observability_evidence": display_path(sidecar_paths["observability_evidence"]),
            "backup_restore_evidence": display_path(sidecar_paths["backup_restore_evidence"]),
            "load_evidence": display_path(sidecar_paths["load_evidence"]),
            "rollback_evidence": display_path(sidecar_paths["rollback_evidence"]),
            "security_scan_evidence": display_path(sidecar_paths["security_scan_evidence"]),
        },
    }
    return report


def validate_sidecar(path: Path, release_sha: str, expected_schema: str, expected_kind: str) -> None:
    parsed = json.loads(path.read_text(encoding="utf-8"))
    if parsed.get("schema_version") != expected_schema:
        raise DraftMetadataError(f"{display_path(path)} schema mismatch")
    if parsed.get("kind") != expected_kind:
        raise DraftMetadataError(f"{display_path(path)} kind mismatch")
    if parsed.get("release_sha") != release_sha:
        raise DraftMetadataError(f"{display_path(path)} release SHA mismatch")
    if parsed.get("status") != "blocked":
        raise DraftMetadataError(f"{display_path(path)} must remain blocked")
    if parsed.get("environment") != "staging_metadata_draft":
        raise DraftMetadataError(f"{display_path(path)} must stay draft-scoped")
    if parsed.get("strict_usable") is not False:
        raise DraftMetadataError(f"{display_path(path)} must not be strict usable")
    if parsed.get("can_clear_stage1_staging_runtime_gate") is not False:
        raise DraftMetadataError(f"{display_path(path)} must not clear staging")
    if parsed.get("can_clear_stage1_production_launch_gate") is not False:
        raise DraftMetadataError(f"{display_path(path)} must not clear production")


def validate_artifacts(
    report: dict[str, Any],
    notes_path: Path,
    evidence_path: Path,
    sidecar_paths: dict[str, Path],
) -> None:
    if report.get("status") != "blocked" or report.get("decision") != "no-go":
        raise DraftMetadataError("draft must remain blocked/no-go")
    if report.get("can_clear_stage1_staging_runtime_gate") is not False:
        raise DraftMetadataError("draft must not clear staging runtime gate")
    if report.get("can_clear_stage1_production_launch_gate") is not False:
        raise DraftMetadataError("draft must not clear production launch gate")
    notes = notes_path.read_text(encoding="utf-8")
    required_sections = [
        "## Identity",
        "## Scope",
        "## Migration List",
        "## Config Diff",
        "## Feature Flags",
        "## Smoke Plan",
        "## Evidence",
        "## Rollback Plan",
        "## Known Risks",
        "## Go/No-Go",
    ]
    missing = [section for section in required_sections if section not in notes]
    if missing:
        raise DraftMetadataError(f"release notes missing required sections: {missing}")
    if report["release_sha"] not in notes:
        raise DraftMetadataError("release notes must reference release SHA")
    if "<" in notes or ">" in notes:
        raise DraftMetadataError("release notes must not contain angle-bracket placeholders")
    parsed = json.loads(evidence_path.read_text(encoding="utf-8"))
    if parsed.get("release_sha") != report["release_sha"]:
        raise DraftMetadataError("evidence release SHA mismatch")
    preflight = parsed.get("preflight_inputs", {})
    for slot, path in sidecar_paths.items():
        if preflight.get(slot) != display_path(path):
            raise DraftMetadataError(f"{slot} path mismatch")
        spec = DRAFT_EVIDENCE_SPECS[slot]
        validate_sidecar(path, report["release_sha"], spec["schema_version"], spec["kind"])


def release_sha_for_check(evidence_path: Path, release_sha_override: str) -> str:
    if release_sha_override.strip():
        return release_sha_override
    parsed = json.loads(evidence_path.read_text(encoding="utf-8"))
    release_sha = str(parsed.get("release_sha") or "").strip().lower()
    if re.fullmatch(r"[0-9a-f]{40}", release_sha) is None:
        raise DraftMetadataError("existing evidence release SHA must be a full 40-character lowercase hex SHA")
    return release_sha


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notes", default=str(DEFAULT_NOTES), help="release notes draft output path")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="metadata draft JSON output path")
    parser.add_argument("--migration-evidence", default=str(DEFAULT_MIGRATION_EVIDENCE), help="migration draft JSON output path")
    parser.add_argument("--config-diff-evidence", default=str(DEFAULT_CONFIG_DIFF_EVIDENCE), help="config diff draft JSON output path")
    parser.add_argument("--observability-evidence", default=str(DEFAULT_OBSERVABILITY_EVIDENCE), help="observability draft JSON output path")
    parser.add_argument("--backup-restore-evidence", default=str(DEFAULT_BACKUP_RESTORE_EVIDENCE), help="backup/restore draft JSON output path")
    parser.add_argument("--load-evidence", default=str(DEFAULT_LOAD_EVIDENCE), help="load draft JSON output path")
    parser.add_argument("--rollback-evidence", default=str(DEFAULT_ROLLBACK_EVIDENCE), help="rollback draft JSON output path")
    parser.add_argument("--security-scan-evidence", default=str(DEFAULT_SECURITY_SCAN_EVIDENCE), help="security scan draft JSON output path")
    parser.add_argument("--release-sha", default="", help="full release SHA for the candidate; defaults to git HEAD")
    parser.add_argument("--check", action="store_true", help="validate existing generated artifacts")
    args = parser.parse_args()

    notes_path = Path(args.notes)
    evidence_path = Path(args.evidence)
    if not notes_path.is_absolute():
        notes_path = ROOT / notes_path
    if not evidence_path.is_absolute():
        evidence_path = ROOT / evidence_path
    sidecar_paths = {
        "migration_evidence": Path(args.migration_evidence),
        "config_diff_evidence": Path(args.config_diff_evidence),
        "observability_evidence": Path(args.observability_evidence),
        "backup_restore_evidence": Path(args.backup_restore_evidence),
        "load_evidence": Path(args.load_evidence),
        "rollback_evidence": Path(args.rollback_evidence),
        "security_scan_evidence": Path(args.security_scan_evidence),
    }
    sidecar_paths = {slot: path if path.is_absolute() else ROOT / path for slot, path in sidecar_paths.items()}

    try:
        if args.check:
            report = build_report(notes_path, sidecar_paths, release_sha_for_check(evidence_path, args.release_sha))
            validate_artifacts(report, notes_path, evidence_path, sidecar_paths)
        else:
            report = build_report(notes_path, sidecar_paths, args.release_sha)
            for slot, path in sidecar_paths.items():
                write_json(path, build_sidecar(slot, report["release_sha"]))
            notes = render_notes(report)
            write_text(notes_path, notes)
            write_json(evidence_path, report)
            validate_artifacts(report, notes_path, evidence_path, sidecar_paths)
    except (DraftMetadataError, OSError, json.JSONDecodeError) as exc:
        print(f"stage1 release candidate metadata draft failed: {exc}", file=sys.stderr)
        return 1
    print(
        "stage1 release candidate metadata draft "
        f"{'validated' if args.check else 'generated'}: {display_path(evidence_path)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
