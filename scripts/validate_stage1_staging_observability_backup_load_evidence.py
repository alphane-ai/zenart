#!/usr/bin/env python3
"""Validate exact Stage 1 staging observability/backup/load evidence."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "staging_observability_backup_load" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "20260527T013207Z-staging-observability-backup-load-36222.json"
PRIVATE_BETA_GATE = ROOT / "fixtures" / "stage0" / "rev2" / "release_gate_evidence.private_beta_staging.json"
SMOKE_SCRIPT = ROOT / "scripts" / "staging_observability_backup_load_smoke.sh"
STAGING_RUNTIME_CONTRACT = ROOT / "fixtures" / "stage1" / "staging_runtime" / "local_contract.json"
STAGING_RUNTIME_VALIDATOR = ROOT / "scripts" / "validate_stage1_staging_runtime.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RELEASE_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
PASS_STATUSES = {"pass", "passed", "validated"}
REQUIRED_SLOTS = {
    "observability_evidence",
    "backup_restore_evidence",
    "load_evidence",
    "post_deploy_smoke_evidence",
}
REQUIRED_SOURCE = {
    "observability_evidence": "ops/evidence/staging/20260527T1830Z-observability-runtime.json",
    "backup_restore_evidence": "ops/evidence/staging/20260527T2115Z-backup-restore.json",
    "load_evidence": "ops/evidence/staging/20260527T2120Z-load.json",
    "post_deploy_smoke_evidence": "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json",
}
REQUIRED_KIND_BY_SOURCE = {
    "ops/evidence/staging/20260527T1830Z-observability-runtime.json": "observability",
    "ops/evidence/staging/20260527T2115Z-backup-restore.json": "backup_restore",
    "ops/evidence/staging/20260527T2120Z-load.json": "load",
    "ops/evidence/staging/20260527T2125Z-post-deploy-smoke.json": "post_deploy_smoke",
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
    "raw_payload",
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
    "failed",
    "fail",
    "planned",
    "dry_run",
    "missing_release_sha",
    "staging_observability_restore_load_missing",
    "private_beta_gate_fixture_not_updated",
}


class Stage1StagingObservabilityBackupLoadError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1StagingObservabilityBackupLoadError(message)


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
        raise Stage1StagingObservabilityBackupLoadError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    return data


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")


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
    values = [value]
    if isinstance(value, dict):
        for child in value.values():
            values.extend(walk_values(child))
    elif isinstance(value, list):
        for child in value:
            values.extend(walk_values(child))
    return values


def normalized_string_values(value: Any) -> set[str]:
    return {child.strip().lower() for child in walk_values(value) if isinstance(child, str)}


def is_pass_status(value: Any) -> bool:
    return isinstance(value, str) and value.strip().lower() in PASS_STATUSES


def require_ref_under_staging(ref: str, path: str) -> None:
    require(ref.startswith("ops/evidence/staging/"), f"{path} must stay under ops/evidence/staging/: {ref}")


def require_ref_list(value: Any, path: str) -> None:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.staging_observability_backup_load.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "staging_observability_backup_load_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_combined_evidence_path") == "ops/evidence/staging/20260527T013207Z-staging-observability-backup-load-36222.json", "contract combined evidence path mismatch")
    require(contract.get("strict_kind") == "staging_observability_backup_load_preflight", "contract strict kind mismatch")
    require(contract.get("required_environment") == "staging", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "staging_observability_backup_load", "contract release gate mismatch")
    require(contract.get("required_release_sha_pattern") == "^[0-9a-f]{40}$", "contract release SHA pattern mismatch")
    require(REQUIRED_SLOTS <= set(contract.get("required_slots") or []), "contract missing required slots")
    required_entries = contract.get("required_verified_entries")
    require(isinstance(required_entries, dict), "required_verified_entries must be object")
    for slot in REQUIRED_SLOTS:
        require(isinstance(required_entries.get(slot), list) and required_entries[slot], f"required entries missing for {slot}")
    require(set(REQUIRED_SOURCE.values()) <= set(contract.get("required_source_evidence") or []), "contract missing source evidence refs")
    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for value in safe_policy.values():
        require(value is False, "safe_projection_policy values must be false")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    for key in (
        "release_sha_full_40_hex",
        "combined_preflight_status_passed",
        "all_slots_verified",
        "private_beta_gate_fixture_updated",
        "gate_impact_can_clear_required",
        "source_evidence_under_staging_required",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "allow_blocked_status",
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run",
        "allow_preserved_do_not_launch_conditions",
        "allow_raw_or_secret_payloads",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")


def validate_code_anchors() -> None:
    require_text(
        SMOKE_SCRIPT,
        (
            "staging_observability_backup_load_preflight",
            "observability_evidence",
            "backup_restore_evidence",
            "load_evidence",
            "post_deploy_smoke_evidence",
            "private_beta_gate_fixture_not_updated",
            "can_clear_aggregate_item",
            "release_gate_fixture",
        ),
    )
    require_text(
        STAGING_RUNTIME_CONTRACT,
        (
            "scripts/validate_stage1_staging_observability_backup_load_evidence.py",
            "observability",
            "backup_restore",
        ),
    )
    require_text(STAGING_RUNTIME_VALIDATOR, ("validate_stage1_staging_observability_backup_load_evidence.py",))
    require_text(REPO_VALIDATE, ("validate_stage1_staging_observability_backup_load_evidence.py --contract-only",))
    require_text(GAP_INVENTORY, ("VF-6e", "observability/backup/load"))


def validate_source_ref(ref: str, release_sha: str) -> None:
    require_ref_under_staging(ref, "source ref")
    data = load_json(ROOT / ref)
    assert_no_secret(data, ref)
    require(data.get("environment") == "staging", f"{ref} environment must be staging")
    require(data.get("kind") == REQUIRED_KIND_BY_SOURCE[ref], f"{ref} kind mismatch")
    require(is_pass_status(data.get("status")), f"{ref} status must pass")
    require(data.get("release_sha") == release_sha, f"{ref} release SHA mismatch")
    require(data.get("release_gate_check_id") == "staging_observability_backup_load", f"{ref} release gate mismatch")


def validate_evidence(evidence_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    assert_no_secret(data, "evidence")

    require(data.get("kind") == "staging_observability_backup_load_preflight", "kind mismatch")
    require(data.get("environment") == "staging", "environment must be staging")
    require(data.get("status") == "passed", "status must be passed")
    release_sha = data.get("release_sha")
    require(isinstance(release_sha, str) and RELEASE_SHA_RE.match(release_sha), "release_sha must be full 40-char hex")
    require(data.get("release_gate_check_id") == "staging_observability_backup_load", "release gate mismatch")
    require(data.get("overall_verified") is True, "overall_verified must be true")
    require(data.get("blocked_slots") == [], "blocked_slots must be empty")
    require(data.get("blocking_reasons") == [], "blocking_reasons must be empty")
    require(data.get("closure_blockers") == [], "closure_blockers must be empty")
    require(data.get("missing_blockers") == [], "missing_blockers must be empty")
    strings = normalized_string_values(data) & BLOCKED_MARKERS
    allowed_context = {"private_beta_gate_fixture_not_updated", "staging_observability_restore_load_missing"}
    require(not (strings - allowed_context), f"evidence contains blocked marker(s): {sorted(strings - allowed_context)}")

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_aggregate_item") is True, "gate_impact.can_clear_aggregate_item must be true")
    require(gate.get("preserved_do_not_launch_condition_id") in (None, ""), "preserved DNL must clear")
    require(gate.get("preserved_release_gate_check_id") in (None, ""), "preserved release gate must clear")
    require(gate.get("blocked_slots") == [], "gate blocked_slots must be empty")
    require(gate.get("closure_blockers") == [], "gate closure_blockers must be empty")

    gate_fixture = data.get("release_gate_fixture")
    require(isinstance(gate_fixture, dict), "release_gate_fixture must be object")
    require(gate_fixture.get("verified_for_aggregate_closure") is True, "release gate fixture must be updated")
    semantics = gate_fixture.get("semantic_checks")
    require(isinstance(semantics, dict) and semantics, "release gate fixture semantic checks required")
    for key, value in semantics.items():
        require(value is True, f"release_gate_fixture.semantic_checks.{key} must be true")
    require(gate_fixture.get("check_status") in {"pass", "passed"}, "release gate fixture check_status must pass")
    require(gate_fixture.get("do_not_launch_is_present") is False, "release gate DNL must be cleared")

    gate_json = load_json(PRIVATE_BETA_GATE)
    checks_by_id = {item.get("check_id"): item for item in gate_json.get("checks", []) if isinstance(item, dict)}
    dnl_by_id = {item.get("condition_id"): item for item in gate_json.get("do_not_launch_checks", []) if isinstance(item, dict)}
    require(checks_by_id.get("staging_observability_backup_load", {}).get("status") in {"pass", "passed"}, "private beta gate check must pass")
    require(dnl_by_id.get("staging_observability_restore_load_missing", {}).get("is_present") is False, "private beta DNL must be cleared")

    inputs = data.get("inputs")
    require(isinstance(inputs, dict), "inputs must be object")
    for slot, ref in REQUIRED_SOURCE.items():
        require(inputs.get(slot) == ref, f"inputs.{slot} must be {ref}")
        validate_source_ref(ref, release_sha)

    contract_entries = contract["required_verified_entries"]
    checks = data.get("checks")
    require(isinstance(checks, list), "checks must be list")
    by_slot = {item.get("slot"): item for item in checks if isinstance(item, dict)}
    require(REQUIRED_SLOTS <= set(by_slot), f"checks missing slots {sorted(REQUIRED_SLOTS - set(by_slot))}")
    for slot in REQUIRED_SLOTS:
        check = by_slot[slot]
        require(check.get("verified") is True, f"{slot} must be verified")
        require(check.get("ref") == REQUIRED_SOURCE[slot], f"{slot}.ref mismatch")
        semantic = check.get("semantic_checks")
        require(isinstance(semantic, dict) and semantic, f"{slot}.semantic_checks required")
        for key, value in semantic.items():
            require(value is True, f"{slot}.semantic_checks.{key} must be true")
        require(check.get("missing_entries") == [], f"{slot}.missing_entries must be empty")
        require(check.get("not_passed_entries") == [], f"{slot}.not_passed_entries must be empty")
        require(check.get("entries_missing_evidence_refs") == [], f"{slot}.entries_missing_evidence_refs must be empty")
        refs = check.get("entry_evidence_refs")
        require(isinstance(refs, dict), f"{slot}.entry_evidence_refs must be object")
        for entry in contract_entries[slot]:
            require(entry in refs and refs[entry], f"{slot}.{entry} evidence refs required")

    verified_slots = {
        "observability_evidence": set(data.get("verified_observability_entries") or []),
        "backup_restore_evidence": set(data.get("verified_postgres_restore_entries") or []) | set(data.get("verified_object_restore_entries") or []),
        "load_evidence": set(data.get("verified_load_entries") or []),
        "post_deploy_smoke_evidence": set(data.get("verified_post_deploy_smoke_entries") or []),
    }
    for slot, required in contract_entries.items():
        require(set(required) <= verified_slots[slot], f"verified entries missing for {slot}: {sorted(set(required) - verified_slots[slot])}")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="combined observability/backup/load evidence JSON")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        else:
            validate_evidence(Path(args.evidence))
    except Stage1StagingObservabilityBackupLoadError as exc:
        print(f"stage1 staging observability/backup/load validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 staging observability/backup/load contract passed" if args.contract_only else "stage1 staging observability/backup/load evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
