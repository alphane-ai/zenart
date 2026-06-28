#!/usr/bin/env python3
"""Validate exact Stage 1 staging legal/support external-user evidence."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
import ipaddress


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "fixtures" / "stage1" / "staging_legal_support" / "local_contract.json"
DEFAULT_LEGAL = ROOT / "ops" / "evidence" / "staging" / "legal-pages-external-user.json"
DEFAULT_SUPPORT = ROOT / "ops" / "evidence" / "staging" / "support-contact-external-user.json"
DEFAULT_LOCAL_LEGAL = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "legal-pages-external-user.local-devport.json"
DEFAULT_LOCAL_SUPPORT = ROOT / "ops" / "evidence" / "staging" / "local-devport" / "support-contact-external-user.local-devport.json"
SMOKE_SCRIPT = ROOT / "scripts" / "staging_legal_support_visibility_smoke.sh"
STAGING_RUNTIME_CONTRACT = ROOT / "fixtures" / "stage1" / "staging_runtime" / "local_contract.json"
STAGING_RUNTIME_VALIDATOR = ROOT / "scripts" / "validate_stage1_staging_runtime.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

PASS_STATUSES = {"pass", "passed"}
LEGAL_PAGE_ALIASES = {
    "terms": {"terms"},
    "privacy": {"privacy", "privacy_policy"},
    "acceptable_use": {"acceptable_use"},
    "ai_content_disclaimer": {"ai_content_disclaimer"},
    "ip_complaint": {"ip_complaint", "ip_complaints"},
}
REQUIRED_SUPPORT_SURFACES = {"support_contact", "report_problem", "billing_policy"}
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
    "missing_staging_web_url",
    "dry_run_no_external_user_probe",
    "local_devport_debug_evidence_cannot_clear_staging_gate",
    "local_devport_requires_allow_local_devport_evidence",
}


class Stage1StagingLegalSupportError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1StagingLegalSupportError(message)


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
        raise Stage1StagingLegalSupportError(f"{display_path(path)} invalid JSON: {exc}") from exc
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


def is_private_or_local_host(host: str) -> bool:
    normalized = host.strip().lower().strip("[]")
    if not normalized or normalized == "localhost" or normalized == "0.0.0.0" or normalized.endswith(".local"):
        return True
    try:
        ip = ipaddress.ip_address(normalized)
    except ValueError:
        return False
    return ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_unspecified


def validate_production_like_staging_url(value: Any, field: str, allow_local_devport: bool) -> None:
    require(isinstance(value, str) and value.strip(), f"{field} is required")
    parsed = urlparse(value)
    require(parsed.scheme in {"http", "https"} and parsed.netloc, f"{field} must be an absolute HTTP URL")
    if allow_local_devport:
        return
    require(parsed.scheme == "https", f"{field} must use https for strict staging evidence")
    require(not is_private_or_local_host(parsed.hostname or ""), f"{field} must not target localhost or private network in strict staging evidence")


def validate_absolute_http_url_or_empty(value: Any, field: str) -> None:
    if value in (None, ""):
        return
    require(isinstance(value, str), f"{field} must be a string")
    parsed = urlparse(value)
    require(parsed.scheme in {"http", "https"} and parsed.netloc, f"{field} must be an absolute HTTP URL")


def require_ref_list(value: Any, path: str) -> None:
    require(isinstance(value, list) and value, f"{path} must be a non-empty list")
    for idx, item in enumerate(value):
        require(isinstance(item, str) and item.strip(), f"{path}[{idx}] must be a non-empty string")


def validate_contract_fixture(contract: dict[str, Any]) -> None:
    assert_no_secret(contract, "contract")
    require(contract.get("schema_version") == "stage1.staging_legal_support.contract.v1", "contract schema_version mismatch")
    require(contract.get("kind") == "staging_legal_support_exact_evidence_contract", "contract kind mismatch")
    require(contract.get("canonical_legal_evidence_path") == "ops/evidence/staging/legal-pages-external-user.json", "legal path mismatch")
    require(contract.get("canonical_support_evidence_path") == "ops/evidence/staging/support-contact-external-user.json", "support path mismatch")
    require(contract.get("strict_legal_kind") == "legal_pages_external_user_visibility", "legal kind mismatch")
    require(contract.get("strict_support_kind") == "support_contact_external_user_visibility", "support kind mismatch")
    require(contract.get("required_environment") == "staging", "contract environment mismatch")
    require(contract.get("required_release_gate_check_id") == "staging_legal_external_user_pages", "contract release gate mismatch")
    require(set(LEGAL_PAGE_ALIASES) <= set(contract.get("required_legal_pages") or []), "contract missing legal pages")
    require(REQUIRED_SUPPORT_SURFACES <= set(contract.get("required_support_surfaces") or []), "contract missing support surfaces")
    safe_policy = contract.get("safe_projection_policy")
    require(isinstance(safe_policy, dict), "safe_projection_policy must be object")
    for value in safe_policy.values():
        require(value is False, "safe projection values must be false")
    strict = contract.get("strict_evidence_policy")
    require(isinstance(strict, dict), "strict_evidence_policy must be object")
    for key in (
        "external_user_probe_required",
        "all_legal_pages_http_200_required",
        "all_support_surfaces_http_200_required",
        "support_ticket_context_required",
        "billing_policy_required",
        "gate_impact_subitems_can_clear_required",
    ):
        require(strict.get(key) is True, f"strict_evidence_policy.{key} must be true")
    for key in (
        "allow_blocked_status",
        "allow_local_devport_debug",
        "allow_local_devport_evidence",
        "allow_dry_run_runtime_probe",
        "allow_raw_or_secret_payloads",
    ):
        require(strict.get(key) is False, f"strict_evidence_policy.{key} must be false")


def validate_code_anchors() -> None:
    require_text(
        SMOKE_SCRIPT,
        (
            "legal-pages-external-user.json",
            "support-contact-external-user.json",
            "legal-pages-external-user.local-devport.json",
            "support-contact-external-user.local-devport.json",
            "billing_policy",
            "external-user HTTP",
            "source_results_path",
            "report-problem",
            "ALLOW_LOCAL_DEVPORT_EVIDENCE",
            "local_devport_debug",
            "local_devport_debug_evidence_cannot_clear_staging_gate",
            "local-devport legal/support visibility runtime checks passed but remain blocked for staging",
        ),
    )
    require_text(
        STAGING_RUNTIME_CONTRACT,
        (
            "scripts/validate_stage1_staging_legal_support_evidence.py",
            "legal_support_external_user",
        ),
    )
    require_text(STAGING_RUNTIME_VALIDATOR, ("validate_stage1_staging_legal_support_evidence.py",))
    require_text(REPO_VALIDATE, ("validate_stage1_staging_legal_support_evidence.py --contract-only",))
    require_text(GAP_INVENTORY, ("VF-6f", "legal/support"))


def validate_legal_evidence(data: dict[str, Any], *, allow_local_devport: bool = False) -> None:
    assert_no_secret(data, "legal")
    require(data.get("environment") == "staging", "legal evidence must be staging")
    require(data.get("kind") == "legal_pages_external_user_visibility", "legal kind mismatch")
    if allow_local_devport:
        require(data.get("status") == "blocked", "local-devport legal status must stay blocked")
        require(data.get("runtime_checks_status") == "passed", "local-devport legal runtime checks must pass")
        require(data.get("local_devport_debug") is True, "local-devport legal evidence must mark local_devport_debug")
        require(data.get("allow_local_devport_evidence") is True, "local-devport legal evidence must record allow_local_devport_evidence")
    else:
        require(is_pass_status(data.get("status")), "legal status must pass")
        require(data.get("local_devport_debug") is not True, "strict legal evidence must not be local-devport debug")
    require(data.get("release_gate_check_id") == "staging_legal_external_user_pages", "legal release gate mismatch")
    validate_production_like_staging_url(data.get("web_url"), "legal.web_url", allow_local_devport)
    pages = data.get("pages")
    require(isinstance(pages, list), "legal.pages must be list")
    by_id = {item.get("page_id"): item for item in pages if isinstance(item, dict)}
    for required_id, aliases in LEGAL_PAGE_ALIASES.items():
        page = next((by_id[alias] for alias in aliases if alias in by_id), None)
        require(isinstance(page, dict), f"legal page missing: {required_id}")
        require(page.get("http_status") == 200, f"legal page {required_id} must return 200")
        require(str(page.get("visibility", "")).startswith("external_user"), f"legal page {required_id} must be external-user visible")
        require_ref_list(page.get("required_tokens"), f"legal page {required_id}.required_tokens")
        require(isinstance(page.get("probe_result"), str) and page["probe_result"], f"legal page {required_id}.probe_result required")
    coverage = data.get("coverage")
    require(isinstance(coverage, list) and coverage, "legal coverage required")
    for idx, item in enumerate(coverage):
        require(isinstance(item, dict), f"legal.coverage[{idx}] must be object")
        require(item.get("status") == "pass", f"legal.coverage[{idx}].status must pass")
        require_ref_list(item.get("evidence_refs"), f"legal.coverage[{idx}].evidence_refs")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "legal.gate_impact must be object")
    require(gate.get("can_clear_legal_pages_subitem") is (not allow_local_devport), "legal pages subitem gate mismatch")
    require(gate.get("can_clear_check_level_item") is (not allow_local_devport), "legal check-level item gate mismatch")


def validate_support_evidence(data: dict[str, Any], *, allow_local_devport: bool = False) -> None:
    assert_no_secret(data, "support")
    require(data.get("environment") == "staging", "support evidence must be staging")
    require(data.get("kind") == "support_contact_external_user_visibility", "support kind mismatch")
    if allow_local_devport:
        require(data.get("status") == "blocked", "local-devport support status must stay blocked")
        require(data.get("runtime_checks_status") == "passed", "local-devport support runtime checks must pass")
        require(data.get("local_devport_debug") is True, "local-devport support evidence must mark local_devport_debug")
        require(data.get("allow_local_devport_evidence") is True, "local-devport support evidence must record allow_local_devport_evidence")
    else:
        require(is_pass_status(data.get("status")), "support status must pass")
        require(data.get("local_devport_debug") is not True, "strict support evidence must not be local-devport debug")
    require(data.get("release_gate_check_id") == "staging_legal_external_user_pages", "support release gate mismatch")
    validate_production_like_staging_url(data.get("web_url"), "support.web_url", allow_local_devport)
    surfaces = data.get("support_surfaces")
    require(isinstance(surfaces, list), "support.support_surfaces must be list")
    by_id = {item.get("surface_id"): item for item in surfaces if isinstance(item, dict)}
    missing = REQUIRED_SUPPORT_SURFACES - set(by_id)
    require(not missing, f"support surfaces missing {sorted(missing)}")
    for surface_id in REQUIRED_SUPPORT_SURFACES:
        item = by_id[surface_id]
        require(item.get("http_status") == 200, f"support surface {surface_id} must return 200")
        require(str(item.get("visibility", "")).startswith("external_user"), f"support surface {surface_id} must be external-user visible")
        require_ref_list(item.get("required_tokens"), f"support surface {surface_id}.required_tokens")
        require(isinstance(item.get("probe_result"), str) and item["probe_result"], f"support surface {surface_id}.probe_result required")
    coverage = data.get("coverage")
    require(isinstance(coverage, list) and coverage, "support coverage required")
    areas = {item.get("area") for item in coverage if isinstance(item, dict)}
    require("support_contact_visibility" in areas, "support_contact_visibility coverage required")
    require("billing_policy_visibility" in areas or "billing_policy" in areas, "billing policy coverage required")
    for idx, item in enumerate(coverage):
        require(isinstance(item, dict), f"support.coverage[{idx}] must be object")
        require(item.get("status") == "pass", f"support.coverage[{idx}].status must pass")
        require_ref_list(item.get("evidence_refs"), f"support.coverage[{idx}].evidence_refs")
    ticket = data.get("ticket_context_probe")
    require(isinstance(ticket, dict), "ticket_context_probe must be object")
    require_ref_list(ticket.get("linked_admin_ticket_ids"), "ticket_context_probe.linked_admin_ticket_ids")
    captured = set(ticket.get("captured_context_fields") or [])
    require({"user_id", "project_id", "task_id", "trace_id", "export_id", "quota_transaction_id", "contact_email"} <= captured, "ticket context fields incomplete")
    require(isinstance(ticket.get("privacy_redaction"), str) and ticket["privacy_redaction"], "ticket privacy redaction required")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "support.gate_impact must be object")
    require(gate.get("can_clear_support_contact_subitem") is (not allow_local_devport), "support contact subitem gate mismatch")
    require(gate.get("can_clear_check_level_item") is (not allow_local_devport), "support check-level item gate mismatch")


def validate_blocked_legal_split(data: dict[str, Any]) -> None:
    assert_no_secret(data, "legal")
    require(data.get("environment") == "staging", "legal evidence must be staging")
    require(data.get("kind") == "legal_pages_external_user_visibility", "legal kind mismatch")
    require(data.get("status") == "blocked", "blocked legal status must be blocked")
    require(data.get("runtime_checks_status") == "blocked", "blocked legal runtime_checks_status must be blocked")
    require(data.get("local_devport_debug") is not True, "canonical blocked legal evidence must not be local-devport debug")
    require(data.get("allow_local_devport_evidence") is not True, "canonical blocked legal evidence must not allow local-devport evidence")
    require(data.get("release_gate_check_id") == "staging_legal_external_user_pages", "legal release gate mismatch")
    validate_absolute_http_url_or_empty(data.get("web_url"), "legal.web_url")
    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list) and blocked_checks, "blocked legal evidence must include blocked_checks")
    require(any("missing_staging_web_url" in str(item) for item in blocked_checks), "blocked legal evidence must preserve missing_staging_web_url")
    pages = data.get("pages")
    require(isinstance(pages, list), "legal.pages must be list")
    by_id = {item.get("page_id"): item for item in pages if isinstance(item, dict)}
    for required_id, aliases in LEGAL_PAGE_ALIASES.items():
        page = next((by_id[alias] for alias in aliases if alias in by_id), None)
        require(isinstance(page, dict), f"legal page missing: {required_id}")
        require(page.get("http_status") in (None, ""), f"blocked legal page {required_id} must not claim HTTP 200")
        require(str(page.get("visibility", "")).startswith("external_user"), f"legal page {required_id} visibility required")
        require_ref_list(page.get("required_tokens"), f"legal page {required_id}.required_tokens")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "legal.gate_impact must be object")
    require(gate.get("can_clear_legal_pages_subitem") is False, "blocked legal pages subitem cannot clear")
    require(gate.get("can_clear_check_level_item") is False, "blocked legal check-level item cannot clear")
    require(gate.get("can_clear_release_gate_check") is False, "blocked legal release gate cannot clear")
    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "legal.probe_contract must be object")
    require(probe_contract.get("canonical_legal_pages_report") == "ops/evidence/staging/legal-pages-external-user.json", "legal canonical report path mismatch")
    require(probe_contract.get("canonical_support_contact_report") == "ops/evidence/staging/support-contact-external-user.json", "support canonical report path mismatch")


def validate_blocked_support_split(data: dict[str, Any]) -> None:
    assert_no_secret(data, "support")
    require(data.get("environment") == "staging", "support evidence must be staging")
    require(data.get("kind") == "support_contact_external_user_visibility", "support kind mismatch")
    require(data.get("status") == "blocked", "blocked support status must be blocked")
    require(data.get("runtime_checks_status") == "blocked", "blocked support runtime_checks_status must be blocked")
    require(data.get("local_devport_debug") is not True, "canonical blocked support evidence must not be local-devport debug")
    require(data.get("allow_local_devport_evidence") is not True, "canonical blocked support evidence must not allow local-devport evidence")
    require(data.get("release_gate_check_id") == "staging_legal_external_user_pages", "support release gate mismatch")
    validate_absolute_http_url_or_empty(data.get("web_url"), "support.web_url")
    blocked_checks = data.get("blocked_checks")
    require(isinstance(blocked_checks, list) and blocked_checks, "blocked support evidence must include blocked_checks")
    require(any("missing_staging_web_url" in str(item) for item in blocked_checks), "blocked support evidence must preserve missing_staging_web_url")
    surfaces = data.get("support_surfaces")
    require(isinstance(surfaces, list), "support.support_surfaces must be list")
    by_id = {item.get("surface_id"): item for item in surfaces if isinstance(item, dict)}
    missing = REQUIRED_SUPPORT_SURFACES - set(by_id)
    require(not missing, f"support surfaces missing {sorted(missing)}")
    for surface_id in REQUIRED_SUPPORT_SURFACES:
        item = by_id[surface_id]
        require(item.get("http_status") in (None, ""), f"blocked support surface {surface_id} must not claim HTTP 200")
        require(str(item.get("visibility", "")).startswith("external_user"), f"support surface {surface_id} visibility required")
        require_ref_list(item.get("required_tokens"), f"support surface {surface_id}.required_tokens")
    ticket = data.get("ticket_context_probe")
    require(isinstance(ticket, dict), "ticket_context_probe must be object")
    require_ref_list(ticket.get("linked_admin_ticket_ids"), "ticket_context_probe.linked_admin_ticket_ids")
    captured = set(ticket.get("captured_context_fields") or [])
    require({"user_id", "project_id", "task_id", "trace_id", "export_id", "quota_transaction_id", "contact_email"} <= captured, "ticket context fields incomplete")
    require(isinstance(ticket.get("privacy_redaction"), str) and ticket["privacy_redaction"], "ticket privacy redaction required")
    gate = data.get("gate_impact")
    require(isinstance(gate, dict), "support.gate_impact must be object")
    require(gate.get("can_clear_support_contact_subitem") is False, "blocked support contact subitem cannot clear")
    require(gate.get("can_clear_check_level_item") is False, "blocked support check-level item cannot clear")
    require(gate.get("can_clear_release_gate_check") is False, "blocked support release gate cannot clear")
    probe_contract = data.get("probe_contract")
    require(isinstance(probe_contract, dict), "support.probe_contract must be object")
    require(probe_contract.get("canonical_legal_pages_report") == "ops/evidence/staging/legal-pages-external-user.json", "legal canonical report path mismatch")
    require(probe_contract.get("canonical_support_contact_report") == "ops/evidence/staging/support-contact-external-user.json", "support canonical report path mismatch")


def validate_evidence(legal_path: Path, support_path: Path, *, allow_local_devport: bool = False) -> None:
    validate_contract_fixture(load_json(CONTRACT))
    legal = load_json(legal_path)
    support = load_json(support_path)
    if legal.get("status") == "blocked" and support.get("status") == "blocked" and not allow_local_devport:
        validate_blocked_legal_split(legal)
        validate_blocked_support_split(support)
        raise Stage1StagingLegalSupportError("canonical legal/support external-user pass evidence is still missing; blocked probe evidence cannot clear staging gate")
    validate_legal_evidence(legal, allow_local_devport=allow_local_devport)
    validate_support_evidence(support, allow_local_devport=allow_local_devport)
    hard_markers = (normalized_string_values(legal) | normalized_string_values(support)) & BLOCKED_MARKERS
    if allow_local_devport:
        require(hard_markers == {"blocked", "local_devport_debug_evidence_cannot_clear_staging_gate"}, f"local-devport legal/support blockers mismatch: {sorted(hard_markers)}")
    else:
        require(not hard_markers, f"legal/support evidence contains blocked marker(s): {sorted(hard_markers)}")


def validate_contract_only() -> None:
    validate_contract_fixture(load_json(CONTRACT))
    validate_code_anchors()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--contract-only", action="store_true", help="validate contract/code anchors only")
    parser.add_argument("--legal-evidence", default=str(DEFAULT_LEGAL), help="legal pages split evidence")
    parser.add_argument("--support-evidence", default=str(DEFAULT_SUPPORT), help="support split evidence")
    parser.add_argument("--allow-local-devport", action="store_true", help="validate local-devport debug evidence without allowing it to clear staging")
    args = parser.parse_args()
    try:
        if args.contract_only:
            validate_contract_only()
        else:
            legal_path = DEFAULT_LOCAL_LEGAL if args.allow_local_devport and args.legal_evidence == str(DEFAULT_LEGAL) else Path(args.legal_evidence)
            support_path = DEFAULT_LOCAL_SUPPORT if args.allow_local_devport and args.support_evidence == str(DEFAULT_SUPPORT) else Path(args.support_evidence)
            validate_evidence(legal_path, support_path, allow_local_devport=args.allow_local_devport)
    except Stage1StagingLegalSupportError as exc:
        print(f"stage1 staging legal/support validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 staging legal/support contract passed" if args.contract_only else "stage1 staging legal/support evidence passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
