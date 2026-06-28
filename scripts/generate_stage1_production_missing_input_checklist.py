#!/usr/bin/env python3
"""Generate a non-clearing checklist of missing production launch inputs.

This checklist is derived from the Stage 1 production proof bundle. It is meant
for operator handoff and release UI display only: it records variable names,
requirement IDs, and next actions, but never stores secret values or raw
provider/Stripe/support payloads.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
DEFAULT_PROOF_BUNDLE = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"
DEFAULT_OPERATOR_BRIEF = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
DEFAULT_INPUT_PACKET = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-input-packet.json"

GROUP_CONTRACT = [
    {
        "group_id": "production_dns",
        "title": "Production DNS and HTTPS",
        "operator_action": "Configure the production DNS/HTTPS input in the production cutover environment; do not persist token values.",
    },
    {
        "group_id": "billing",
        "title": "Production paid billing lifecycle",
        "operator_action": "Provide sanitized live Stripe production proof refs; do not persist live keys, payloads, or signatures.",
    },
    {
        "group_id": "security",
        "title": "Production security launch checks",
        "operator_action": "Provide sanitized production security proof refs collected from public HTTPS production surfaces.",
    },
    {
        "group_id": "governance",
        "title": "Production governance release",
        "operator_action": "Provide sanitized production governance request, audit, review, canary, rollback, and release refs.",
    },
]

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

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
)
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
    "stripe-signature",
    "stripe_signature",
    "raw_prompt",
    "raw_provider_payload",
    "raw_stripe_payload",
    "raw_webhook_payload",
    "raw_payload",
    "raw_event",
    "raw_response",
    "raw_support_body",
    "database_url",
    "postgres_url",
    "download_url",
    "signed_url",
}


class ProductionMissingInputChecklistError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ProductionMissingInputChecklistError(f"missing {display_path(path)}") from exc
    except json.JSONDecodeError as exc:
        raise ProductionMissingInputChecklistError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionMissingInputChecklistError(f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionMissingInputChecklistError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionMissingInputChecklistError(f"{path} contains raw secret-looking material")


def int_value(value: Any, default: int = 0) -> int:
    return value if isinstance(value, int) and value >= 0 else default


def percent(configured: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(configured * 100 / total, 1)


def safe_string(value: Any, limit: int = 220) -> str:
    text = str(value or "").strip()
    folded = " ".join(line.strip() for line in text.splitlines() if line.strip())
    folded = RAW_SECRET_RE.sub("[redacted]", folded)
    return folded[:limit]


def safe_string_list(value: Any, *, limit: int = 12, item_limit: int = 180) -> list[str]:
    if not isinstance(value, list):
        return []
    return [safe_string(item, item_limit) for item in value[:limit] if safe_string(item, item_limit)]


def proof_coverage(bundle: dict[str, Any]) -> dict[str, Any]:
    coverage = bundle.get("input_variable_coverage")
    if not isinstance(coverage, dict):
        raise ProductionMissingInputChecklistError("proof bundle missing input_variable_coverage")
    groups = coverage.get("groups")
    if not isinstance(groups, dict):
        raise ProductionMissingInputChecklistError("proof bundle missing input_variable_coverage.groups")
    return coverage


def item_action(group_id: str, status: str, display_name: str) -> str:
    if status == "invalid":
        return f"Replace the configured {display_name} input with production-valid evidence; do not persist the value."
    if group_id == "production_dns":
        return f"Set {display_name} for production DNS/HTTPS cutover; do not persist credential values."
    if group_id == "billing":
        return f"Collect a sanitized live Stripe production proof ref for {display_name}; do not persist raw Stripe data."
    if group_id == "security":
        return f"Collect a sanitized production security proof ref for {display_name} from the HTTPS production surface."
    return f"Collect a sanitized production governance proof ref for {display_name}."


def acceptable_evidence_source(group_id: str) -> str:
    if group_id == "production_dns":
        return "production_https_dns_or_cloudflare_cutover_evidence"
    if group_id == "billing":
        return "live_stripe_production_billing_evidence"
    if group_id == "security":
        return "production_https_runtime_security_evidence"
    return "production_governance_audit_release_evidence"


def disallowed_substitutes(group_id: str) -> list[str]:
    common = ["local_debug_evidence", "staging_preflight_evidence", "blocked_probe_evidence", "placeholder_values"]
    if group_id == "billing":
        return [*common, "stripe_sandbox_test_mode", "stripe_test_keys"]
    if group_id == "production_dns":
        return [*common, "staging_domain", "localhost", "raw_dns_plan_without_observed_https_probe"]
    if group_id == "security":
        return [*common, "staging_security_scan_only", "dependency_scan_without_production_runtime_probe"]
    return [*common, "staging_admin_review_only", "draft_release_notes"]


def build_items(group_id: str, group: dict[str, Any]) -> list[dict[str, Any]]:
    requirements = group.get("requirements")
    if not isinstance(requirements, list):
        raise ProductionMissingInputChecklistError(f"{group_id} missing requirements")
    items: list[dict[str, Any]] = []
    for requirement in requirements:
        if not isinstance(requirement, dict):
            continue
        status = requirement.get("status")
        if status not in {"missing", "invalid"}:
            continue
        display_name = safe_string(requirement.get("display_name"))
        requirement_id = safe_string(requirement.get("requirement_id"))
        accepted_names = safe_string_list(requirement.get("accepted_variable_names"), limit=8)
        configured_name = requirement.get("configured_variable_name")
        items.append(
            {
                "group_id": group_id,
                "requirement_id": requirement_id,
                "display_name": display_name,
                "status": status,
                "accepted_variable_names": accepted_names,
                "configured_variable_name": safe_string(configured_name) if configured_name else None,
                "acceptable_evidence_source": acceptable_evidence_source(group_id),
                "disallowed_substitutes": disallowed_substitutes(group_id),
                "can_be_satisfied_by_existing_sandbox_or_staging_resources": False,
                "operator_action": item_action(group_id, status, display_name),
            }
        )
    return items


def build_groups(coverage: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    proof_groups = coverage["groups"]
    groups: list[dict[str, Any]] = []
    all_items: list[dict[str, Any]] = []
    for contract in GROUP_CONTRACT:
        group_id = contract["group_id"]
        raw_group = proof_groups.get(group_id)
        if not isinstance(raw_group, dict):
            raise ProductionMissingInputChecklistError(f"proof bundle missing group {group_id}")
        configured = int_value(raw_group.get("required_configured"))
        total = int_value(raw_group.get("required_total"))
        missing = int_value(raw_group.get("required_missing"))
        invalid = int_value(raw_group.get("required_invalid"))
        items = build_items(group_id, raw_group)
        group = {
            "group_id": group_id,
            "title": contract["title"],
            "required_total": total,
            "required_configured": configured,
            "required_missing": missing,
            "required_invalid": invalid,
            "blocking_input_count": missing + invalid,
            "completion_percent": percent(configured, total),
            "first_missing_required_inputs": safe_string_list(raw_group.get("missing_required_inputs"), limit=12),
            "invalid_required_inputs": safe_string_list(raw_group.get("invalid_required_inputs"), limit=8),
            "operator_next_action": contract["operator_action"],
            "items": items,
        }
        groups.append(group)
        all_items.extend(items)
    return groups, all_items


def build_summary(coverage: dict[str, Any], groups: list[dict[str, Any]]) -> dict[str, Any]:
    configured = int_value(coverage.get("required_configured"), sum(group["required_configured"] for group in groups))
    total = int_value(coverage.get("required_total"), sum(group["required_total"] for group in groups))
    missing = int_value(coverage.get("required_missing"), sum(group["required_missing"] for group in groups))
    invalid = int_value(coverage.get("required_invalid"), sum(group["required_invalid"] for group in groups))
    return {
        "required_total": total,
        "required_configured": configured,
        "required_missing": missing,
        "required_invalid": invalid,
        "blocking_input_count": int_value(coverage.get("blocking_input_count"), missing + invalid),
        "required_completion_percent": coverage.get("required_completion_percent", percent(configured, total)),
    }


def build_checklist(args: argparse.Namespace) -> dict[str, Any]:
    bundle = read_json(args.proof_bundle)
    coverage = proof_coverage(bundle)
    groups, items = build_groups(coverage)
    data: dict[str, Any] = {
        "schema_version": "stage1.production_missing_input_checklist.v1",
        "kind": "stage1_production_missing_input_checklist",
        "environment": "production",
        "status": "blocked",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "non_clearing_checklist": True,
        "canonical_pass_path": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "value_redaction": "variable_names_only",
        "source_refs": {
            "production_proof_bundle": display_path(args.proof_bundle),
            "production_launch_operator_brief": display_path(args.launch_operator_brief),
            "production_launch_input_packet": display_path(args.launch_input_packet),
        },
        "summary": build_summary(coverage, groups),
        "groups": groups,
        "items": items,
        "operator_next_actions": [
            "Keep production launch no_go until all checklist items are replaced by strict production evidence.",
            "Use production HTTPS surfaces and live production provider resources only for clearing evidence.",
            "Existing R2, Stripe sandbox, z.ai LLM, local devport, and staging resources cannot satisfy these production-only checklist items.",
            "Do not use local, staging, sandbox, placeholder, or preflight evidence to clear production gates.",
            "Do not persist secret values, authorization headers, cookies, signed URLs, raw prompts, or raw provider/Stripe payloads.",
        ],
        "gate_impact": {
            "can_clear_stage1_production_launch_gate": False,
            "can_close_do_not_launch": False,
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "non_clearing_evidence_only": True,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "production_missing_input_checklist")
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof-bundle", type=Path, default=DEFAULT_PROOF_BUNDLE)
    parser.add_argument("--launch-operator-brief", type=Path, default=DEFAULT_OPERATOR_BRIEF)
    parser.add_argument("--launch-input-packet", type=Path, default=DEFAULT_INPUT_PACKET)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if [item["group_id"] for item in GROUP_CONTRACT] != ["production_dns", "billing", "security", "governance"]:
            raise SystemExit("production missing input checklist group contract mismatch")
        print("stage1 production missing input checklist contract passed")
        return 0
    data = build_checklist(args)
    write_json(args.output, data)
    print(f"wrote Stage 1 production missing input checklist to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
