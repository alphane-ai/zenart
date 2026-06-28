#!/usr/bin/env python3
"""Validate Stage 1 release metadata preflight contract and evidence."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "release_metadata" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "release" / "staging" / "stage1-release-metadata-preflight.json"
GENERATOR = ROOT / "scripts" / "generate_stage1_release_metadata_preflight.py"
VALIDATOR = ROOT / "scripts" / "validate_stage1_release_metadata_contract.py"
RELEASE_BUNDLE = ROOT / "scripts" / "release_evidence_bundle_smoke.sh"
STAGING_SMOKE = ROOT / "scripts" / "staging_smoke.sh"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
RELEASE_CANDIDATE_GENERATOR = ROOT / "scripts" / "generate_stage1_release_candidate_metadata.py"
RELEASE_CANDIDATE_NOTES = ROOT / "ops" / "release" / "stage1_release_candidate_metadata_draft.md"
RELEASE_CANDIDATE_DRAFT = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-metadata-draft.json"
)
RELEASE_CANDIDATE_MIGRATION_DRAFT = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-migration-draft.json"
)
RELEASE_CANDIDATE_CONFIG_DIFF_DRAFT = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-config-diff-draft.json"
)
RELEASE_CANDIDATE_OBSERVABILITY_DRAFT = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-observability-draft.json"
)
RELEASE_CANDIDATE_BACKUP_RESTORE_DRAFT = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-backup-restore-draft.json"
)
RELEASE_CANDIDATE_LOAD_DRAFT = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-load-draft.json"
)
RELEASE_CANDIDATE_ROLLBACK_DRAFT = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-rollback-draft.json"
)
RELEASE_CANDIDATE_SECURITY_SCAN_DRAFT = (
    ROOT
    / "ops"
    / "evidence"
    / "release"
    / "staging"
    / "stage1-release-candidate-security-scan-draft.json"
)

REQUIRED_SLOTS = {
    "release_sha",
    "release_notes_path",
    "image_refs",
    "migration_evidence",
    "config_diff_evidence",
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "rollback_evidence",
    "security_scan_evidence",
}

RELEASE_CANDIDATE_SIDECARS = {
    "migration_evidence": (
        RELEASE_CANDIDATE_MIGRATION_DRAFT,
        "stage1.release_candidate_migration_draft.v1",
        "migration",
    ),
    "config_diff_evidence": (
        RELEASE_CANDIDATE_CONFIG_DIFF_DRAFT,
        "stage1.release_candidate_config_diff_draft.v1",
        "config_diff",
    ),
    "observability_evidence": (
        RELEASE_CANDIDATE_OBSERVABILITY_DRAFT,
        "stage1.release_candidate_observability_draft.v1",
        "observability",
    ),
    "backup_restore_evidence": (
        RELEASE_CANDIDATE_BACKUP_RESTORE_DRAFT,
        "stage1.release_candidate_backup_restore_draft.v1",
        "backup_restore",
    ),
    "load_evidence": (
        RELEASE_CANDIDATE_LOAD_DRAFT,
        "stage1.release_candidate_load_draft.v1",
        "load",
    ),
    "rollback_evidence": (
        RELEASE_CANDIDATE_ROLLBACK_DRAFT,
        "stage1.release_candidate_rollback_draft.v1",
        "rollback",
    ),
    "security_scan_evidence": (
        RELEASE_CANDIDATE_SECURITY_SCAN_DRAFT,
        "stage1.release_candidate_security_scan_draft.v1",
        "security_scan",
    ),
}

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

RELEASE_IMAGE_NAMES = {"backend", "web", "admin"}
FORBIDDEN_RELEASE_IMAGE_NAMES = {"manager", "worker", "crawler", "migrate"}

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


class ReleaseMetadataContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ReleaseMetadataContractError(message)


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
        raise ReleaseMetadataContractError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
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


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.release_metadata.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "release_metadata_contract", "contract kind mismatch")
    require({"OP-14", "VF-6", "VF-7", "VF-8"} <= set(contract.get("blueprint_items") or []), "contract blueprint_items incomplete")
    require(contract.get("canonical_evidence_path") == "ops/evidence/release/staging/stage1-release-metadata-preflight.json", "canonical evidence path mismatch")
    require(contract.get("strict_schema_version") == "stage1.release_metadata_preflight.v1", "strict schema mismatch")
    require(contract.get("release_gate_status") == "contract_ready_release_metadata_evidence_open", "release gate status mismatch")
    require(contract.get("required_environment") == "staging", "required environment mismatch")
    require(REQUIRED_SLOTS <= set(contract.get("required_slots") or []), "contract missing release metadata slots")
    require(set(contract.get("required_image_names") or []) == RELEASE_IMAGE_NAMES, "contract required_image_names must be exactly backend/web/admin")
    require(
        FORBIDDEN_RELEASE_IMAGE_NAMES <= set(contract.get("forbidden_release_image_names") or []),
        "contract must forbid manager/worker/crawler/migrate release images",
    )
    require(len(contract.get("required_release_notes_sections") or []) >= 10, "contract release notes sections incomplete")
    kinds = contract.get("required_evidence_kinds")
    require(isinstance(kinds, dict), "required_evidence_kinds must be object")
    accepted = contract.get("accepted_statuses_by_slot")
    require(isinstance(accepted, dict), "accepted_statuses_by_slot must be object")
    for slot in REQUIRED_SLOTS - {"release_sha", "release_notes_path", "image_refs"}:
        require(slot in kinds, f"missing expected kind for {slot}")
        require(slot in accepted and accepted[slot], f"missing accepted statuses for {slot}")
    policy = contract.get("safe_projection_policy")
    require(isinstance(policy, dict), "safe_projection_policy must be object")
    for field in SAFE_FALSE_FIELDS:
        require(policy.get(field) is False, f"safe_projection_policy.{field} must be false")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    require(strict.get("environment") == "staging", "strict policy environment mismatch")
    require(strict.get("kind") == "stage1_release_metadata_preflight", "strict policy kind mismatch")
    require(strict.get("status") == "passed", "strict policy status mismatch")
    require(strict.get("metadata_complete") is True, "strict policy must require metadata complete")
    for key in (
        "release_sha_required",
        "all_slots_required",
        "all_slots_verified",
        "safe_projection_must_pass",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "can_clear_stage1_staging_runtime_gate",
        "can_clear_stage1_production_launch_gate",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")
    remaining = contract.get("remaining_release_evidence")
    require(isinstance(remaining, list) and len(remaining) >= 3, "remaining_release_evidence must preserve open gates")


def validate_code_anchors() -> None:
    for path in (GENERATOR, VALIDATOR, RELEASE_CANDIDATE_GENERATOR):
        require(path.exists(), f"missing {display_path(path)}")
        require(path.stat().st_mode & 0o111 != 0, f"{display_path(path)} must be executable")
    require_text(
        RELEASE_CANDIDATE_GENERATOR,
        (
            "stage1-release-candidate-metadata-draft.json",
            "stage1-release-candidate-migration-draft.json",
            "stage1-release-candidate-config-diff-draft.json",
            "stage1-release-candidate-observability-draft.json",
            "stage1-release-candidate-backup-restore-draft.json",
            "stage1-release-candidate-load-draft.json",
            "stage1-release-candidate-rollback-draft.json",
            "stage1-release-candidate-security-scan-draft.json",
            "stage1_release_candidate_metadata_draft.md",
            "stage1.release_candidate_metadata_draft.v1",
            "stage1.release_candidate_migration_draft.v1",
            "stage1.release_candidate_config_diff_draft.v1",
            "stage1.release_candidate_observability_draft.v1",
            "stage1.release_candidate_backup_restore_draft.v1",
            "stage1.release_candidate_load_draft.v1",
            "stage1.release_candidate_rollback_draft.v1",
            "stage1.release_candidate_security_scan_draft.v1",
            "can_clear_stage1_staging_runtime_gate",
            "can_clear_stage1_production_launch_gate",
            "Do-Not-Launch",
            "--check",
        ),
    )
    require_text(
        GENERATOR,
        (
            "stage1-release-metadata-preflight.json",
            "stage1.release_metadata_preflight.v1",
            "metadata_complete",
            "release_notes_path",
            "image_refs",
            "image_refs_source",
            "derive_image_refs_from_ci_docker_evidence",
            "stage0-rev2-docker-image-build.json",
            "current_git_head",
            "current_git_head_match",
            "release_sha_source",
            "FORBIDDEN_RELEASE_IMAGE_NAMES",
            "release_image_closed_set",
            "derived_from_strict_ci_docker_evidence",
            "ci_docker_evidence_failed_strict_checks",
            "--ci-docker-evidence",
            "migration_evidence",
            "config_diff_evidence",
            "observability_evidence",
            "backup_restore_evidence",
            "load_evidence",
            "rollback_evidence",
            "security_scan_evidence",
            "can_clear_stage1_staging_runtime_gate",
            "can_clear_stage1_production_launch_gate",
        ),
    )
    require_text(
        RELEASE_BUNDLE,
        (
            "RELEASE_METADATA_PREFLIGHT",
            "load_release_metadata_preflight",
            "metadata_complete",
            "stage1-release-metadata-preflight.json",
        ),
    )
    require_text(
        STAGING_SMOKE,
        (
            "validate_release_notes_ref",
            "validate_image_refs",
            "validate_staging_evidence_ref",
            "migration_evidence",
            "config_diff_evidence",
            "security_scan_evidence",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "generate_stage1_release_candidate_metadata.py --check",
            "validate_stage1_release_metadata_contract.py",
            "generate_stage1_release_metadata_preflight.py --contract-only",
            "stage1-release-metadata-preflight.json",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-6b",
            "release metadata preflight",
            "release candidate metadata draft",
            "stage1-release-metadata-preflight.json",
        ),
    )
    require_text(BLUEPRINT, ("OP-14", "VF-7", "release gates"))


def validate_candidate_draft() -> None:
    data = load_json(RELEASE_CANDIDATE_DRAFT)
    assert_no_secret(data, "release_candidate_draft")
    require(data.get("schema_version") == "stage1.release_candidate_metadata_draft.v1", "candidate draft schema mismatch")
    require(data.get("kind") == "stage1_release_candidate_metadata_draft", "candidate draft kind mismatch")
    require(data.get("status") == "blocked", "candidate draft must remain blocked")
    require(data.get("decision") == "no-go", "candidate draft must remain no-go")
    require(data.get("metadata_complete") is False, "candidate draft must not mark metadata complete")
    require(data.get("can_clear_stage1_staging_runtime_gate") is False, "candidate draft must not clear staging gate")
    require(data.get("can_clear_stage1_production_launch_gate") is False, "candidate draft must not clear production gate")
    require(data.get("can_clear_do_not_launch") is False, "candidate draft must not clear Do-Not-Launch")
    require(data.get("release_notes_path") == "ops/release/stage1_release_candidate_metadata_draft.md", "candidate notes path mismatch")
    require(re.fullmatch(r"[0-9a-f]{40}", str(data.get("release_sha", ""))) is not None, "candidate draft must include full release SHA")
    required_slots = set(data.get("strict_metadata_slots_still_required") or [])
    require(REQUIRED_SLOTS - {"release_sha", "release_notes_path"} <= required_slots, "candidate draft must preserve strict open slots")
    preflight_inputs = data.get("preflight_inputs")
    require(isinstance(preflight_inputs, dict), "candidate draft must expose preflight_inputs")
    for slot, (path, _schema, _kind) in RELEASE_CANDIDATE_SIDECARS.items():
        require(preflight_inputs.get(slot) == display_path(path), f"candidate {slot} preflight path mismatch")
    notes = read_text(RELEASE_CANDIDATE_NOTES)
    require(str(data["release_sha"]) in notes, "candidate notes must cite release SHA")
    require("Decision: `no-go`" in notes, "candidate notes must record no-go decision")
    require("It does not close CI" in notes, "candidate notes must preserve non-authoritative warning")
    require("<" not in notes and ">" not in notes, "candidate notes must not contain unresolved angle placeholders")
    for section in (
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
    ):
        require(section in notes, f"candidate notes missing {section}")
    require("Draft metadata sidecars:" in notes, "candidate notes must cite draft metadata sidecars")
    for slot, (path, schema, kind) in RELEASE_CANDIDATE_SIDECARS.items():
        require(display_path(path) in notes, f"candidate notes must cite {slot} draft")
        sidecar = load_json(path)
        assert_no_secret(sidecar, display_path(path))
        require(sidecar.get("schema_version") == schema, f"{display_path(path)} schema mismatch")
        require(sidecar.get("kind") == kind, f"{display_path(path)} kind mismatch")
        require(sidecar.get("slot", slot) == slot, f"{display_path(path)} slot mismatch")
        require(sidecar.get("environment") == "staging_metadata_draft", f"{display_path(path)} environment mismatch")
        require(sidecar.get("status") == "blocked", f"{display_path(path)} must stay blocked")
        require(sidecar.get("release_sha") == data.get("release_sha"), f"{display_path(path)} release SHA mismatch")
        require(sidecar.get("strict_usable") is False, f"{display_path(path)} must not be strict usable")
        require(sidecar.get("can_clear_stage1_staging_runtime_gate") is False, f"{display_path(path)} must not clear staging")
        require(sidecar.get("can_clear_stage1_production_launch_gate") is False, f"{display_path(path)} must not clear production")
        require(sidecar.get("blocking_reasons"), f"{display_path(path)} must preserve blockers")


def validate_evidence(evidence_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    assert_no_secret(data, "evidence")
    require(data.get("schema_version") == "stage1.release_metadata_preflight.v1", "schema_version mismatch")
    require(data.get("kind") == "stage1_release_metadata_preflight", "kind mismatch")
    require(data.get("environment") == "staging", "environment mismatch")
    require(data.get("release_gate_decision") == "no_go", "metadata preflight must not close release gate")
    for field in SAFE_FALSE_FIELDS:
        require(data.get(field) is False, f"{field} must be false")
    gate_impact = data.get("gate_impact")
    require(isinstance(gate_impact, dict), "gate_impact must be object")
    require(gate_impact.get("can_clear_stage1_staging_runtime_gate") is False, "metadata preflight must not clear staging gate")
    require(gate_impact.get("can_clear_stage1_production_launch_gate") is False, "metadata preflight must not clear production gate")
    slot_results = data.get("slot_results")
    require(isinstance(slot_results, dict), "slot_results must be object")
    require(REQUIRED_SLOTS <= set(slot_results), f"slot_results missing {sorted(REQUIRED_SLOTS - set(slot_results))}")
    missing_slots = data.get("missing_slots")
    unverified_slots = data.get("unverified_slots")
    require(isinstance(missing_slots, list), "missing_slots must be list")
    require(isinstance(unverified_slots, list), "unverified_slots must be list")
    require(data.get("blocking_reason_count") == len(data.get("blocking_reasons", [])), "blocking_reason_count mismatch")
    metadata_complete = data.get("metadata_complete") is True
    if metadata_complete:
        require(data.get("status") == "passed", "complete metadata preflight must pass")
        require(missing_slots == [], "complete metadata preflight missing_slots must be empty")
        require(unverified_slots == [], "complete metadata preflight unverified_slots must be empty")
        require(re.fullmatch(r"[0-9a-f]{40}", str(data.get("release_sha", ""))) is not None, "complete metadata must include full release SHA")
        for slot, result in slot_results.items():
            require(isinstance(result, dict), f"{slot} result must be object")
            require(result.get("verified") is True, f"{slot} must be verified")
    else:
        require(data.get("status") == "blocked", "incomplete metadata preflight must be blocked")
        require(missing_slots or unverified_slots, "blocked metadata preflight must expose missing or unverified slots")
        reasons = data.get("blocking_reasons")
        require(isinstance(reasons, list) and reasons, "blocked metadata preflight must expose blocking reasons")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()
    validate_candidate_draft()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="release metadata preflight evidence path")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        else:
            validate_evidence(Path(args.evidence))
    except ReleaseMetadataContractError as exc:
        print(f"stage1 release metadata validation failed: {exc}", file=sys.stderr)
        return 1
    if args.contract_only:
        print("stage1 release metadata contract passed")
    else:
        print("stage1 release metadata evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
