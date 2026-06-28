#!/usr/bin/env python3
"""Validate Stage 1 AD-12 support admin deletion governance anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "support_admin_deletion_governance" / "local_contract.json"
ADMIN_PAGE = ROOT / "admin" / "app" / "support" / "page.tsx"
ADMIN_TYPES = ROOT / "admin" / "lib" / "types.ts"
ADMIN_FIXTURES = ROOT / "admin" / "lib" / "fixtures.ts"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_TESTS = ROOT / "admin" / "tests" / "admin-data.test.mjs"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"https://[^\\s\"']+X-Amz-Signature=[A-Za-z0-9]+)"
)

MUTATION_CONTROL_RE = re.compile(
    r"(?i)(<form|type=\"submit\"|formAction=|server action|delete button|approve deletion|execute deletion|"
    r"confirm deletion|mark go|set go|manual go)"
)


class SupportAdminDeletionGovernanceContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SupportAdminDeletionGovernanceContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise SupportAdminDeletionGovernanceContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    return data


def require_str_list(data: dict[str, Any], key: str, minimum: int = 1) -> set[str]:
    value = data.get(key)
    require(isinstance(value, list) and len(value) >= minimum, f"fixture {key} must contain at least {minimum} values")
    result: set[str] = set()
    for item in value:
        require(isinstance(item, str) and item.strip(), f"fixture {key} contains invalid value")
        result.add(item)
    return result


def validate_fixture() -> dict[str, Any]:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.support_admin_deletion_governance.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "support_admin_deletion_governance_contract", "fixture kind mismatch")
    require({"AD-12", "BE-12", "OP-12", "OP-13", "VF-5", "VF-7"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("admin_route") == "admin/app/support/page.tsx", "fixture admin route mismatch")
    require(data.get("route_marker") == "stage1.support-admin-deletion-governance-local-contract", "fixture route marker mismatch")

    require(
        {
            "requestId",
            "requestType",
            "subjectUserId",
            "tenantId",
            "supportTicketId",
            "status",
            "requiredRole",
            "secondReviewRequired",
            "secondReviewStatus",
            "abuseHoldRef",
            "linkedTraceIds",
            "linkedAssetIds",
            "linkedExportIds",
            "billingReferenceIds",
            "retainedEvidenceRefs",
            "deletionPlan",
            "retentionBoundary",
            "blockedReason",
            "userVisibleMessage",
            "auditRef",
        }
        <= require_str_list(data, "required_deletion_fields", 20),
        "fixture required deletion fields incomplete",
    )
    require(
        {"account_deletion", "project_deletion", "export_deletion", "billing_data_erasure_review"}
        <= require_str_list(data, "required_request_types", 4),
        "fixture request types incomplete",
    )
    require(
        {"blocked_pending_evidence", "ready_for_second_review", "retention_hold", "closed_no_action"}
        <= require_str_list(data, "required_statuses", 4),
        "fixture statuses incomplete",
    )
    require(
        {"support_ticket", "abuse_hold", "trace_projection", "asset_or_export_ref", "billing_reference", "retention_boundary", "second_review", "immutable_audit"}
        <= require_str_list(data, "required_linked_evidence", 8),
        "fixture linked evidence requirements incomplete",
    )
    require(
        {"raw_support_body", "raw_prompt", "provider_payload", "billing_payload", "secret", "api_key", "authorization", "cookie", "signed_url", "stripe_payload", "webhook_signature"}
        <= require_str_list(data, "denied_projection_fields", 11),
        "fixture denied projection fields incomplete",
    )
    require(
        {"public_legal_support_policy_not_deployed", "production_security_launch_checks_incomplete", "production_paid_billing_lifecycle", "object_storage_signed_retention_runtime_missing"}
        <= require_str_list(data, "preserved_do_not_launch_conditions", 4),
        "fixture preserved DNL conditions incomplete",
    )
    require(
        {"staging_legal_external_user_pages", "production_legal_support_policy", "production_security_launch_checks", "production_paid_billing_lifecycle"}
        <= require_str_list(data, "blocked_gate_checks", 4),
        "fixture blocked gate checks incomplete",
    )

    non_launch = data.get("non_launch_status")
    require(isinstance(non_launch, dict), "fixture non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("staging_evidence") == "open", "staging evidence must remain open")
    require(non_launch.get("production_evidence") == "open", "production evidence must remain open")
    require(non_launch.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(non_launch.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")
    require(non_launch.get("can_close_do_not_launch") is False, "local contract must not close DNL")
    require(non_launch.get("mutation_controls_enabled") is False, "local contract must disable mutation controls")

    for ref in data.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_admin_page(contract: dict[str, Any]) -> None:
    page = require_text(
        ADMIN_PAGE,
        (
            "SupportAdminDeletionGovernanceContract",
            "SupportAdminDeletionRequest",
            "getSupportAdminDeletionGovernanceContract",
            "Deletion Governance",
            "stage1.support-admin-deletion-governance-local-contract",
            "canClearStagingGate: false",
            "canClearProductionGate: false",
            "canCloseDoNotLaunch: false",
            "mutationControlsEnabled: false",
            "Blocked Gate Checks",
            "Preserved DNL Conditions",
            "Required Deletion Fields",
            "Required Linked Evidence",
            "Denied Projection Fields",
            "Retention Boundary",
            "User Message",
        )
        + tuple(contract["required_controls"]),
    )
    require(not MUTATION_CONTROL_RE.search(page), "support page must not expose deletion mutation/manual gate controls")
    for key in (
        "required_deletion_fields",
        "required_request_types",
        "required_statuses",
        "required_linked_evidence",
        "denied_projection_fields",
        "preserved_do_not_launch_conditions",
        "blocked_gate_checks",
    ):
        for value in contract[key]:
            require(value in page or value in read_text(ADMIN_FIXTURES), f"support page/fixtures missing contract value {value!r}")
    require(not RAW_SECRET_RE.search(page), "support page contains raw secret-looking material")


def validate_types_api_and_fixtures(contract: dict[str, Any]) -> None:
    require_text(
        ADMIN_TYPES,
        (
            "export type SupportAdminDeletionRequest",
            "export type SupportAdminDeletionGovernanceContract",
            'schema: "stage1.support-admin-deletion-governance-local-contract.v1"',
            'routeMarker: "stage1.support-admin-deletion-governance-local-contract"',
            "deniedProjectionFields: string[]",
            "preservedDoNotLaunchConditions: string[]",
            "blockedGateChecks: string[]",
            "requests: SupportAdminDeletionRequest[]",
            "canClearStagingGate: false",
            "canClearProductionGate: false",
            "canCloseDoNotLaunch: false",
            "mutationControlsEnabled: false",
        ),
    )
    fixtures = require_text(
        ADMIN_FIXTURES,
        (
            "export const supportAdminDeletionGovernanceContract",
            "stage1.support-admin-deletion-governance-local-contract",
            "del-usr-301-account",
            "del-proj-790-export",
            "del-usr-455-crawler-project",
            "del-billing-usr-318-review",
            "raw_support_body",
            "webhook_signature",
            "mutationControlsEnabled: false",
        ),
    )
    require_text(ADMIN_API, ("supportAdminDeletionGovernanceContract", "getSupportAdminDeletionGovernanceContract"))

    requests_match = re.search(r"requests:\s*\[(?P<body>[\s\S]*?)\n\s*\],\n\s*canClearStagingGate", fixtures)
    require(requests_match is not None, "support deletion requests fixture block not found")
    body = requests_match.group("body")
    for request_type in contract["required_request_types"]:
        require(f'requestType: "{request_type}"' in body, f"requests missing request type {request_type!r}")
    for status in contract["required_statuses"]:
        require(f'status: "{status}"' in body, f"requests missing status {status!r}")
    for required_ref in ("supportTicketId", "abuseHoldRef", "retainedEvidenceRefs", "auditRef", "secondReviewStatus"):
        require(required_ref in body, f"requests missing required field {required_ref!r}")
    require(not RAW_SECRET_RE.search(body), "support deletion fixture requests contain raw secret-looking material")


def validate_tests_and_wiring() -> None:
    require_text(
        ADMIN_TESTS,
        (
            "admin support page exposes deletion governance contract without mutation controls",
            "stage1.support-admin-deletion-governance-local-contract",
            "SupportAdminDeletionGovernanceContract",
            "data-support-deletion-governance-contract",
            "data-support-deletion-request-links",
            "canClearProductionGate: false",
            "mutationControlsEnabled: false",
            "raw_support_body",
            "webhook_signature",
        ),
    )
    require_text(REPO_VALIDATE, ("validate_stage1_support_admin_deletion_governance_contract.py",))
    require_text(GAP_INVENTORY, ("VF-6j", "Support Admin Deletion Governance"))


def main() -> int:
    try:
        contract = validate_fixture()
        validate_admin_page(contract)
        validate_types_api_and_fixtures(contract)
        validate_tests_and_wiring()
    except SupportAdminDeletionGovernanceContractError as exc:
        print(f"stage1 support admin deletion governance contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 support admin deletion governance contract passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
