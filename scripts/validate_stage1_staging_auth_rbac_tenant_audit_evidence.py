#!/usr/bin/env python3
"""Validate exact Stage 1 staging auth/RBAC/tenant/audit evidence."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "staging_auth_rbac_tenant_audit" / "local_contract.json"
DEFAULT_EVIDENCE = ROOT / "ops" / "evidence" / "staging" / "20260527T1515Z-auth-rbac-tenant-audit.json"
PRIVATE_BETA_GATE = ROOT / "fixtures" / "stage0" / "rev2" / "release_gate_evidence.private_beta_staging.json"
ADMIN_FIXTURES = ROOT / "admin" / "lib" / "fixtures.ts"
ADMIN_GOV_TEST = ROOT / "admin" / "tests" / "admin-governance.test.mjs"
STAGE0_VALIDATOR = ROOT / "scripts" / "validate_stage0_rev2.py"
STAGING_RUNTIME_CONTRACT = ROOT / "fixtures" / "stage1" / "staging_runtime" / "local_contract.json"
STAGING_RUNTIME_VALIDATOR = ROOT / "scripts" / "validate_stage1_staging_runtime.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"

PASS_STATUSES = {"pass", "passed"}
REQUIRED_COVERAGE_AREAS = {
    "admin_session_boundary",
    "tenant_isolation_denial",
    "admin_rbac_runtime",
    "immutable_audit_linkage",
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
    "local_devport_debug_evidence_cannot_clear_staging_gate",
}
LOCAL_DEBUG_TRUE_FIELDS = {"local_devport_debug", "allow_local_devport_evidence", "use_dev_identity_headers"}
GATE_EMPTY_FIELDS = {"blocked_checks", "blockers", "do_not_launch_conditions"}


class Stage1StagingAuthRbacTenantAuditError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1StagingAuthRbacTenantAuditError(message)


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
        raise Stage1StagingAuthRbacTenantAuditError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def truthy_gate_value(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.strip().lower() in {"true", "1", "yes"})


def blocked_gate_signal_blockers(value: Any, path: str) -> list[str]:
    blockers: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            child_path = f"{path}.{key}"
            if normalized in LOCAL_DEBUG_TRUE_FIELDS and truthy_gate_value(child):
                blockers.append(f"{child_path} is true")
            if normalized in GATE_EMPTY_FIELDS and child not in (None, [], ""):
                blockers.append(f"{child_path} is not empty")
            if normalized.startswith("can_clear_") and child is False:
                blockers.append(f"{child_path} is false")
            blockers.extend(blocked_gate_signal_blockers(child, child_path))
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            blockers.extend(blocked_gate_signal_blockers(child, f"{path}[{idx}]"))
    return blockers


def require_no_blocked_gate_signals(value: Any, path: str) -> None:
    blockers = blocked_gate_signal_blockers(value, path)
    require(not blockers, f"{path} contains blocked/debug-only gate signal(s): {blockers}")


def require_string_list(value: Any, path: str) -> list[str]:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    result: list[str] = []
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")
        result.append(item)
    return result


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.staging_auth_rbac_tenant_audit.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "staging_auth_rbac_tenant_audit_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_evidence_path") == "ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json", "contract evidence path mismatch")
    require(contract.get("strict_schema_version") == "stage0.rev2", "contract strict schema mismatch")
    require(contract.get("required_environment") == "staging", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "staging_auth_rbac_tenant_audit", "contract release gate mismatch")
    require(contract.get("required_do_not_launch_condition_id") == "tenant_isolation_not_enforced", "contract DNL mismatch")
    require(REQUIRED_COVERAGE_AREAS <= set(contract.get("required_coverage_areas") or []), "contract missing coverage areas")
    for key in ("required_runtime_request_ids", "required_admin_rbac_evidence_ids", "required_audit_refs"):
        require_string_list(contract.get(key), f"contract.{key}")
    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for value in safe_policy.values():
        require(value is False, "safe projection values must be false")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    for key in (
        "external_user_admin_api_denial_required",
        "independent_admin_session_required",
        "cross_tenant_denial_required",
        "governed_admin_rbac_runtime_required",
        "expired_override_denial_required",
        "immutable_audit_linkage_required",
        "all_admin_rbac_evidence_rows_consumed",
        "private_beta_gate_check_pass_required",
        "tenant_isolation_dnl_cleared_required",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "allow_blocked_status",
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run",
        "allow_raw_or_secret_payloads",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")


def validate_code_anchors() -> None:
    require_text(
        STAGE0_VALIDATOR,
        (
            "validate_staging_auth_rbac_tenant_audit_evidence",
            "staging_auth_rbac_tenant_audit",
            "tenant_isolation_not_enforced",
            "admin_session_boundary",
            "immutable_audit_linkage",
        ),
    )
    require_text(
        ADMIN_FIXTURES,
        (
            "stagingAuthRbacTenantAuditEvidence",
            "rbac-provider-002",
            "tenant-alpha",
            "tenant-beta",
            "au-015",
        ),
    )
    require_text(
        ADMIN_GOV_TEST,
        (
            "staging auth rbac tenant audit evidence clears only its private beta check",
            "staging admin RBAC runtime evidence must cite expired provider override evidence",
            "validated auth/RBAC/tenant/audit runtime evidence should clear the matching tenant condition",
        ),
    )
    require_text(
        STAGING_RUNTIME_CONTRACT,
        (
            "scripts/validate_stage1_staging_auth_rbac_tenant_audit_evidence.py",
            "auth_rbac_tenant_audit",
        ),
    )
    require_text(STAGING_RUNTIME_VALIDATOR, ("validate_stage1_staging_auth_rbac_tenant_audit_evidence.py",))
    require_text(REPO_VALIDATE, ("validate_stage1_staging_auth_rbac_tenant_audit_evidence.py --contract-only",))
    require_text(GAP_INVENTORY, ("VF-6g", "auth/RBAC/tenant/audit"))
    require_text(BLUEPRINT, ("auth/RBAC", "tenant isolation", "audit"))


def validate_private_beta_gate() -> list[str]:
    gate = load_json(PRIVATE_BETA_GATE)
    checks = {item.get("check_id"): item for item in gate.get("checks", []) if isinstance(item, dict)}
    conditions = {item.get("condition_id"): item for item in gate.get("do_not_launch_checks", []) if isinstance(item, dict)}
    decision = gate.get("gate_decision") if isinstance(gate.get("gate_decision"), dict) else {}
    check = checks.get("staging_auth_rbac_tenant_audit")
    require(isinstance(check, dict), "private beta gate missing auth/RBAC check")
    require(check.get("status") == "pass", "private beta auth/RBAC check must pass")
    require("ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json" in str(check.get("evidence_ref", "")), "private beta auth/RBAC check must cite exact evidence")
    condition = conditions.get("tenant_isolation_not_enforced")
    require(isinstance(condition, dict), "private beta gate missing tenant isolation condition")
    require(condition.get("is_present") is False, "tenant isolation DNL must be cleared")
    require("ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json" in str(condition.get("evidence_ref", "")), "tenant isolation DNL must cite exact evidence")
    blocked_by_checks = decision.get("blocked_by_checks") if isinstance(decision.get("blocked_by_checks"), list) else []
    active_conditions = decision.get("active_do_not_launch_conditions") if isinstance(decision.get("active_do_not_launch_conditions"), list) else []
    require("staging_auth_rbac_tenant_audit" not in blocked_by_checks, "private beta decision must not block on auth/RBAC")
    require("tenant_isolation_not_enforced" not in active_conditions, "private beta decision must not keep tenant isolation DNL active")
    return blocked_by_checks


def validate_evidence(evidence_path: Path) -> None:
    contract = load_json(CONTRACT)
    validate_contract_fixture(contract)
    data = load_json(evidence_path)
    assert_no_secret(data, "evidence")
    require_no_blocked_gate_signals(data, "evidence")
    require(data.get("schema_version") == "stage0.rev2", "schema_version mismatch")
    require(data.get("environment") == "staging", "environment must be staging")
    require(data.get("status") == "pass", "status must be pass")
    require(data.get("release_gate_check_id") == "staging_auth_rbac_tenant_audit", "release gate mismatch")
    require(data.get("do_not_launch_condition_id") == "tenant_isolation_not_enforced", "DNL mismatch")

    runtime_ids = require_string_list(data.get("runtime_request_ids"), "runtime_request_ids")
    require(set(contract["required_runtime_request_ids"]) <= set(runtime_ids), "runtime_request_ids missing required probes")
    require(len(runtime_ids) == len(set(runtime_ids)), "runtime_request_ids must be unique")
    tenant_ids = require_string_list(data.get("tenant_ids"), "tenant_ids")
    require({"tenant-alpha", "tenant-beta"} <= set(tenant_ids), "tenant_ids must include cross-tenant probe pair")
    admin_rbac_ids = require_string_list(data.get("admin_rbac_evidence_ids"), "admin_rbac_evidence_ids")
    require(set(contract["required_admin_rbac_evidence_ids"]) == set(admin_rbac_ids), "admin_rbac_evidence_ids mismatch")
    require(len(admin_rbac_ids) == len(set(admin_rbac_ids)), "admin_rbac_evidence_ids must be unique")
    audit_refs = require_string_list(data.get("audit_refs"), "audit_refs")
    require(set(contract["required_audit_refs"]) <= set(audit_refs), "audit_refs missing required refs")
    require(len(audit_refs) == len(set(audit_refs)), "audit_refs must be unique")

    coverage = data.get("coverage")
    require(isinstance(coverage, list) and coverage, "coverage must be a non-empty list")
    by_area = {item.get("area"): item for item in coverage if isinstance(item, dict)}
    require(set(by_area) == REQUIRED_COVERAGE_AREAS, f"coverage areas mismatch: {sorted(set(by_area))}")
    expected_tokens = {
        "admin_session_boundary": ("external-user", "/api/admin", "admin session", "au-015"),
        "tenant_isolation_denial": ("tenant-alpha", "tenant-beta", "cross-tenant", "au-015"),
        "admin_rbac_runtime": ("rbac-provider-002", "expired", "second-review", "audit"),
        "immutable_audit_linkage": ("append-only", "immutable", "au-015", "audit"),
    }
    for area, item in by_area.items():
        require(item.get("status") == "pass", f"{area}.status must pass")
        for field in ("runtime_probe", "external_user_evidence", "rbac_audit_evidence"):
            text = item.get(field)
            require(isinstance(text, str) and len(text) >= 80, f"{area}.{field} must be detailed")
        artifacts = require_string_list(item.get("linked_admin_artifacts"), f"{area}.linked_admin_artifacts")
        require(any(ref.startswith("admin/") for ref in artifacts), f"{area} must link admin artifacts")
        refs = require_string_list(item.get("evidence_refs"), f"{area}.evidence_refs")
        require("ops/evidence/staging/20260527T1515Z-auth-rbac-tenant-audit.json" in refs, f"{area} must cite canonical evidence")
        combined = json.dumps(item, ensure_ascii=False).lower()
        for token in expected_tokens[area]:
            require(token.lower() in combined, f"{area} missing token {token!r}")
        require(any(ref in audit_refs or ref in admin_rbac_ids or ref.startswith(("sup-", "tr-", "ex-")) for ref in refs), f"{area} must cite validator-resolvable evidence refs")
    for required_id in contract["required_admin_rbac_evidence_ids"]:
        require(required_id in json.dumps(by_area["admin_rbac_runtime"], ensure_ascii=False), f"admin_rbac_runtime missing {required_id}")

    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "gate_impact must be object")
    require(gate.get("can_clear_check_level_item") is True, "gate_impact.can_clear_check_level_item must be true")
    expected_remaining_blockers = validate_private_beta_gate()
    expected_aggregate_status = "go" if not expected_remaining_blockers else "blocked_by_other_staging_runtime_items"
    require(gate.get("aggregate_private_beta_gate_status") == expected_aggregate_status, "auth/RBAC aggregate status must mirror current Private Beta/Staging blockers")
    require(gate.get("remaining_blockers") == expected_remaining_blockers, "auth/RBAC remaining blockers mismatch")
    hard_markers = normalized_string_values(data) & BLOCKED_MARKERS
    require(not hard_markers, f"evidence contains blocked marker(s): {sorted(hard_markers)}")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--evidence", default=str(DEFAULT_EVIDENCE), help="auth/RBAC/tenant/audit evidence JSON")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        else:
            validate_evidence(Path(args.evidence))
    except Stage1StagingAuthRbacTenantAuditError as exc:
        print(f"stage1 staging auth/RBAC/tenant/audit validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 staging auth/RBAC/tenant/audit contract passed" if args.contract_only else "stage1 staging auth/RBAC/tenant/audit evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
