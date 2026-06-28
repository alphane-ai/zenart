#!/usr/bin/env python3
"""Validate Stage 1 AD-13 audit search/export admin contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "audit_search_export" / "local_contract.json"
ADMIN_PAGE = ROOT / "admin" / "app" / "audit" / "page.tsx"
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


class AuditSearchExportContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AuditSearchExportContractError(message)


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
        raise AuditSearchExportContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    return data


def validate_fixture() -> dict[str, Any]:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.audit_search_export.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "audit_search_export_admin_contract", "fixture kind mismatch")
    require({"AD-13", "BE-4", "VF-8"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("admin_route") == "admin/app/audit/page.tsx", "fixture admin route mismatch")
    require(data.get("route_marker") == "stage1.audit-search-export-local-contract", "fixture route marker mismatch")

    required_facets = set(data.get("required_search_facets") or [])
    require({"actor", "target", "risk", "second_review_status", "evidence_ref"} <= required_facets, "fixture search facets incomplete")

    allowlist = data.get("field_allowlist")
    require(isinstance(allowlist, list) and len(allowlist) >= 8, "fixture field_allowlist incomplete")
    require("evidenceRefs" in allowlist and "rationale" in allowlist, "fixture field_allowlist missing audit evidence/rationale")

    denied = set(data.get("denied_fields") or [])
    require({"raw_payload", "provider_payload", "hidden_prompt", "secret", "api_key", "signed_url", "stripe_payload"} <= denied, "fixture denied_fields incomplete")

    non_launch = data.get("non_launch_status")
    require(isinstance(non_launch, dict), "fixture non_launch_status must be object")
    require(non_launch.get("local_contract") == "pass", "local contract status mismatch")
    require(non_launch.get("staging_evidence") == "open", "staging evidence must remain open")
    require(non_launch.get("production_evidence") == "open", "production evidence must remain open")
    require(non_launch.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(non_launch.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")
    require(non_launch.get("can_close_do_not_launch") is False, "local contract must not close DNL")

    for ref in data.get("required_files", []):
        require((ROOT / ref).exists(), f"fixture required file missing: {ref}")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_admin_page(contract: dict[str, Any]) -> None:
    required_controls = tuple(contract["required_controls"])
    require_text(
        ADMIN_PAGE,
        (
            "AuditSearchExportManifest",
            "stage1.audit-search-export-local-contract",
            "auditFieldAllowlist",
            "auditDeniedFields",
            "auditExportManifest",
            "filteredAuditEvents",
            "auditSearchFacets",
            "Audit Export Manifest",
            "Allowed Export Fields",
            "Denied Raw Fields",
            "Search Facets",
            "Filtered Audit Results",
            "canClearStagingGate: false",
            "canClearProductionGate: false",
            "canCloseDoNotLaunch: false",
        )
        + required_controls,
    )
    page = read_text(ADMIN_PAGE)
    require(not re.search(r"<form|type=\"submit\"|manual go|mark go|set go", page, flags=re.I), "audit page must not expose mutation/manual gate controls")
    for denied_field in contract["denied_fields"]:
        require(denied_field in page, f"audit page must display denied field {denied_field!r}")
    for field in contract["field_allowlist"]:
        require(field in page, f"audit page must include field allowlist entry {field!r}")
    for preset in contract["required_filter_presets"]:
        require(preset in page, f"audit page missing filter preset {preset!r}")
    require(not RAW_SECRET_RE.search(page), "audit page contains raw secret-looking material")


def validate_types_and_fixtures(contract: dict[str, Any]) -> None:
    require_text(
        ADMIN_TYPES,
        (
            "export type AuditSearchExportManifest",
            'schema: "stage1.audit-search-export-local-contract.v1"',
            "fieldAllowlist: string[]",
            "deniedFields: string[]",
            "canClearStagingGate: false",
            "canClearProductionGate: false",
            "canCloseDoNotLaunch: false",
        ),
    )
    fixtures = require_text(
        ADMIN_FIXTURES,
        (
            "export const auditEvents",
            "immutable: true",
            "secondReviewStatus",
            "evidenceRefs",
            "local-dev-admin",
            "security-admin",
        ),
    )
    match = re.search(r"export const auditEvents: AuditEvent\[\] = \[(?P<body>[\s\S]*?)\n\];", fixtures)
    require(match is not None, "auditEvents fixture block not found")
    audit_fixture_body = match.group("body")
    denied_field_re = re.compile(
        r"(?i)(raw_payload|provider_payload|hidden_prompt|api_key|authorization|cookie|signed_url|"
        r"stripe_payload|webhook_signature)\s*[:=]"
    )
    require(not denied_field_re.search(audit_fixture_body), "audit fixtures must not contain denied raw field/value shapes")
    require(
        "sk_test_" not in audit_fixture_body and "whsec_" not in audit_fixture_body and "Bearer " not in audit_fixture_body,
        "audit fixtures must not contain raw key material",
    )
    require_text(ADMIN_API, ("getAuditEvents", "return auditEvents"))


def validate_tests_and_wiring() -> None:
    require_text(
        ADMIN_TESTS,
        (
            "admin audit page exposes search, filtered results, and safe export contract",
            "stage1.audit-search-export-local-contract",
            "data-audit-export-manifest",
            "AuditSearchExportManifest",
            "canClearProductionGate: false",
            "raw_payload",
            "provider_payload",
            "hidden_prompt",
            "signed_url",
        ),
    )
    require_text(REPO_VALIDATE, ("validate_stage1_audit_search_export_contract.py",))
    require_text(GAP_INVENTORY, ("VF-6h", "Audit Log Search"))


def main() -> int:
    try:
        contract = validate_fixture()
        validate_admin_page(contract)
        validate_types_and_fixtures(contract)
        validate_tests_and_wiring()
    except AuditSearchExportContractError as exc:
        print(f"stage1 audit search/export contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 audit search/export contract passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
