#!/usr/bin/env python3
"""Validate Stage 1 FE-12/FE-16 safety export state local UI contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "safety_export_state" / "local_contract.json"
CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
SAFETY_EXPORT = ROOT / "web" / "lib" / "safety-export-state.ts"
SAFETY_EXPORT_TEST = ROOT / "web" / "lib" / "safety-export-state.test.ts"
WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
WORKSPACE_TEST = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
CSS = ROOT / "web" / "app" / "globals.css"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class SafetyExportStateContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SafetyExportStateContractError(message)


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
        raise SafetyExportStateContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.safety-export-state-local-contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "blocked_export_product_ui_local_contract", "fixture kind mismatch")
    require({"FE-12", "FE-16", "QA-4", "QA-5", "AS-10", "VF-2"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    contract = data.get("product_ui_contract")
    require(isinstance(contract, dict), "product_ui_contract must be object")
    require(contract.get("blocked_export_download_cta_count") == 0, "blocked download CTA count policy mismatch")
    require(contract.get("blocked_export_share_cta_count") == 0, "blocked share CTA count policy mismatch")
    for flag in (
        "blocked_reasons_visible",
        "qa_block_findings_visible",
        "safety_block_findings_visible",
        "admin_review_required_count_visible",
        "manifest_summary_visible",
        "provenance_summary_visible",
    ):
        require(contract.get(flag) is True, f"fixture flag {flag} must be true")
    for flag in (
        "raw_provider_payload_projected",
        "raw_safety_payload_projected",
        "secret_like_value_projected",
    ):
        require(contract.get(flag) is False, f"fixture redaction flag {flag} must be false")
    required_anchors = set(data.get("required_ui_anchors") or [])
    require("data-safety-export-state-contract" in required_anchors, "fixture missing state anchor")
    require("data-safety-export-share-cta" in required_anchors, "fixture missing share CTA anchor")
    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_safety_export_state_contract") == "pass", "local status mismatch")
    require(status.get("staging_export_review_evidence") == "open", "staging review evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")


def validate_code() -> None:
    require_text(
        CONTRACTS,
        (
            "export interface SafetyExportStateEvidence",
            'schema_version: "stage1.safety-export-state-local-contract.v1"',
            "blocked_download_cta_count: 0",
            "blocked_share_cta_count: 0",
            "raw_provider_payload_projected: false",
            "raw_safety_payload_projected: false",
            "secret_like_value_projected: false",
            "can_clear_stage1_staging_runtime_gate: false",
        ),
    )
    require_text(
        SAFETY_EXPORT,
        (
            "export const blockedReasonsForExport",
            "export const buildSafetyExportStateEvidence",
            "export_status_blocked",
            "safety_policy_block",
            "qa:${finding.id}",
            "safety:${finding.stage}:${finding.ruleId}",
            "blocked_download_cta_count: 0",
            "blocked_share_cta_count: 0",
            "raw_provider_payload_projected: false",
            "raw_safety_payload_projected: false",
            "secret_like_value_projected: false",
            "can_clear_stage1_staging_runtime_gate: false",
        ),
    )
    require_text(
        WORKSPACE,
        (
            "buildSafetyExportStateEvidence",
            "blockedReasonsForExport",
            "data-safety-export-state-contract",
            "data-safety-export-state-status",
            "data-safety-export-blocked-count",
            "data-safety-export-qa-block-count",
            "data-safety-export-safety-block-count",
            "data-safety-export-admin-review-required-count",
            "data-safety-export-blocked-download-cta-count",
            "data-safety-export-blocked-share-cta-count",
            "data-safety-export-blocked-without-download-count",
            "data-safety-export-blocked-without-share-count",
            "data-safety-export-latest-blocked-reason",
            "data-safety-export-blocked-reasons",
            "data-safety-export-raw-provider-payload",
            "data-safety-export-raw-safety-payload",
            "data-safety-export-secret-like-projected",
            "data-safety-export-can-clear-staging",
            "data-safety-export-record-blocked-reasons",
            "data-safety-export-download-disabled-reason",
            "data-safety-export-share-disabled-reason",
            "data-safety-export-share-cta",
            "disabled={sessionBlocked || Boolean(shareLink) || shareBlocked}",
        ),
    )
    require_text(CSS, (".export-blocked-reason", "var(--danger)"))


def validate_tests() -> None:
    require_text(
        SAFETY_EXPORT_TEST,
        (
            "Stage 1 safety export state contract",
            "summarizes blocked safety exports without projecting raw payloads",
            "marks entitlement and quota blocked exports as requiring review without spending quota",
            "stage1.safety-export-state-local-contract.v1",
            "safety-illegal-abuse-v1",
            "qa-entitlement",
            "raw_provider_payload_projected: false",
            "raw_safety_payload_projected: false",
            "secret_like_value_projected: false",
        ),
    )
    require_text(
        WORKSPACE_TEST,
        (
            "exposes Stage 1 safety export state and blocks download/share controls for unsafe exports",
            "data-safety-export-state-contract",
            "stage1.safety-export-state-local-contract.v1",
            "data-safety-export-blocked-count",
            "data-safety-export-blocked-download-cta-count",
            "data-safety-export-blocked-share-cta-count",
            "data-safety-export-download-disabled-reason",
            "data-safety-export-share-cta",
        ),
    )


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-2ig",
            "validate_stage1_safety_export_state_contract.py",
            "fixtures/stage1/safety_export_state/local_contract.json",
            "FE-12",
            "FE-16",
            "blocked download/share CTAs",
            "Strict staging export review evidence remains open",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_safety_export_state_contract.py",
            "python3 scripts/validate_stage1_safety_export_state_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_code()
    validate_tests()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except SafetyExportStateContractError as exc:
        print(f"stage1 safety export state contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 safety export state contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
