#!/usr/bin/env python3
"""Generate a non-clearing Stage 1 production launch operator brief.

The brief is a compact, screen-reader friendly summary of the last production
launch blockers. It is derived from validator-owned non-clearing evidence and
must never persist raw credentials, provider payloads, Stripe payloads, cookies,
authorization headers, signed URLs, or database URLs.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-launch-operator-brief.json"
DEFAULT_BLOCKER_AUDIT = ROOT / "ops" / "evidence" / "non_clearing" / "production-blocker-audit.json"
DEFAULT_PROOF_BUNDLE = ROOT / "ops" / "evidence" / "non_clearing" / "production-proof-bundle.json"
DEFAULT_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_DNS_CUTOVER_PLAN = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-cutover-plan.json"
DEFAULT_BILLING_DIAGNOSTIC = (
    ROOT / "ops" / "evidence" / "non_clearing" / "production-live-billing-proof.blocked.json"
)
DEFAULT_SECURITY_DIAGNOSTIC = (
    ROOT / "ops" / "evidence" / "non_clearing" / "production-security-proof.blocked.json"
)
DEFAULT_GOVERNANCE_DIAGNOSTIC = (
    ROOT / "ops" / "evidence" / "non_clearing" / "production-governance-proof.blocked.json"
)

BLOCKER_CONTRACT = [
    {
        "blocker_id": "production_dns_https",
        "title": "Production DNS and HTTPS",
        "coverage_group": "production_dns",
        "gate_ids": ["stage1_production_launch_preflight", "production_legal_support_policy"],
    },
    {
        "blocker_id": "production_paid_billing_lifecycle",
        "title": "Production paid billing lifecycle",
        "coverage_group": "billing",
        "gate_ids": ["production_paid_billing_lifecycle"],
    },
    {
        "blocker_id": "production_security_launch_checks",
        "title": "Production security launch checks",
        "coverage_group": "security",
        "gate_ids": ["production_security_launch_checks"],
    },
    {
        "blocker_id": "production_governance_release",
        "title": "Production governance release",
        "coverage_group": "governance",
        "gate_ids": ["production_governance_release"],
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


class ProductionLaunchOperatorBriefError(Exception):
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
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise ProductionLaunchOperatorBriefError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionLaunchOperatorBriefError(f"{display_path(path)} must contain a JSON object")
    return data


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionLaunchOperatorBriefError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionLaunchOperatorBriefError(f"{path} contains raw secret-looking material")


def sanitize_text(value: Any, limit: int = 240) -> str:
    text = str(value or "").strip()
    folded = " ".join(line.strip() for line in text.splitlines() if line.strip())
    folded = RAW_SECRET_RE.sub("[redacted]", folded)
    return folded[:limit]


def safe_string_list(value: Any, *, limit: int = 12, item_limit: int = 180) -> list[str]:
    if not isinstance(value, list):
        return []
    return [sanitize_text(item, item_limit) for item in value[:limit] if sanitize_text(item, item_limit)]


def int_value(value: Any, default: int = 0) -> int:
    return value if isinstance(value, int) and value >= 0 else default


def percent(configured: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(configured * 100 / total, 1)


def first_blocker_from(data: dict[str, Any], fallback: str) -> str:
    for key in ("first_blocker", "blocked_checks", "blockers"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return sanitize_text(value)
        if isinstance(value, list) and value:
            return sanitize_text(value[0])
    return sanitize_text(fallback)


def proof_first_blocker(bundle: dict[str, Any], proof_key: str, diagnostic: dict[str, Any], fallback: str) -> str:
    proofs = bundle.get("proofs") if isinstance(bundle.get("proofs"), dict) else {}
    proof = proofs.get(proof_key) if isinstance(proofs.get(proof_key), dict) else {}
    if proof.get("first_blocker"):
        return sanitize_text(proof["first_blocker"])
    return first_blocker_from(diagnostic, fallback)


def coverage_group(bundle: dict[str, Any], group: str) -> dict[str, Any]:
    coverage = bundle.get("input_variable_coverage") if isinstance(bundle.get("input_variable_coverage"), dict) else {}
    groups = coverage.get("groups") if isinstance(coverage.get("groups"), dict) else {}
    value = groups.get(group) if isinstance(groups.get(group), dict) else {}
    configured = int_value(value.get("required_configured"))
    total = int_value(value.get("required_total"))
    missing = int_value(value.get("required_missing"))
    invalid = int_value(value.get("required_invalid"))
    return {
        "required_configured": configured,
        "required_total": total,
        "required_missing": missing,
        "required_invalid": invalid,
        "blocking_input_count": missing + invalid,
        "completion_percent": percent(configured, total),
        "first_missing_required_inputs": safe_string_list(value.get("missing_required_inputs"), limit=12),
        "invalid_required_inputs": safe_string_list(value.get("invalid_required_inputs"), limit=8),
    }


def proof_diagnostic_summary(path: Path, data: dict[str, Any], first_blocker: str) -> dict[str, Any]:
    return {
        "path": display_path(path),
        "exists": path.exists(),
        "status": data.get("status", "missing") if data else "missing",
        "schema_version": data.get("schema_version", "missing") if data else "missing",
        "first_blocker": first_blocker,
        "canonical_source_written": data.get("canonical_source_written") is True if data else False,
    }


def build_matrix(args: argparse.Namespace, bundle: dict[str, Any], dns: dict[str, Any], cutover: dict[str, Any]) -> list[dict[str, Any]]:
    billing_diagnostic = read_json(args.billing_diagnostic)
    security_diagnostic = read_json(args.security_diagnostic)
    governance_diagnostic = read_json(args.governance_diagnostic)
    diagnostics = {
        "billing": (args.billing_diagnostic, billing_diagnostic),
        "security": (args.security_diagnostic, security_diagnostic),
        "governance": (args.governance_diagnostic, governance_diagnostic),
    }
    rows: list[dict[str, Any]] = []
    for item in BLOCKER_CONTRACT:
        group = item["coverage_group"]
        coverage = coverage_group(bundle, group)
        source_refs = {"production_proof_bundle": display_path(args.proof_bundle)}
        if group == "production_dns":
            first_blocker = first_blocker_from(dns, "production DNS/HTTPS evidence missing")
            actions = safe_string_list(cutover.get("operator_next_actions"), limit=6)
            if not actions:
                actions = [
                    "Configure production DNS target and Cloudflare DNS edit inputs.",
                    "Rerun production DNS readiness, then rerun legal/support source probes.",
                ]
            source_refs.update(
                {
                    "production_dns_readiness": display_path(args.dns_readiness),
                    "production_dns_cutover_plan": display_path(args.dns_cutover_plan),
                }
            )
            diagnostic = {
                "path": display_path(args.dns_readiness),
                "exists": args.dns_readiness.exists(),
                "status": dns.get("status", "missing") if dns else "missing",
                "schema_version": dns.get("schema_version", "missing") if dns else "missing",
                "first_blocker": first_blocker,
                "canonical_source_written": False,
            }
        elif group == "billing":
            path, diagnostic_data = diagnostics["billing"]
            first_blocker = proof_first_blocker(bundle, "billing", diagnostic_data, "production live billing proof missing")
            actions = [
                "Set production Stripe mode and live key shape only in the production execution environment.",
                "Collect sanitized live checkout, subscription, invoice, refund, quota reset, and webhook proof refs.",
                "Rerun the production proof bundle, then write canonical billing source only after strict validation passes.",
            ]
            source_refs["billing_diagnostic"] = display_path(path)
            diagnostic = proof_diagnostic_summary(path, diagnostic_data, first_blocker)
        elif group == "security":
            path, diagnostic_data = diagnostics["security"]
            first_blocker = proof_first_blocker(bundle, "security", diagnostic_data, "production security proof missing")
            actions = [
                "Run production security probes against HTTPS production surfaces.",
                "Record sanitized refs for session cookie, CSRF, redaction, provider key containment, CSP, RBAC, and audit checks.",
                "Rerun the production proof bundle, then write canonical security source only after strict validation passes.",
            ]
            source_refs["security_diagnostic"] = display_path(path)
            diagnostic = proof_diagnostic_summary(path, diagnostic_data, first_blocker)
        else:
            path, diagnostic_data = diagnostics["governance"]
            first_blocker = proof_first_blocker(bundle, "governance", diagnostic_data, "production governance proof missing")
            actions = [
                "Collect sanitized production activation, abuse-control, and skill-release runtime request refs.",
                "Attach audit, reviewer, RBAC, immutability, canary, rollback, and release-note refs.",
                "Rerun the production proof bundle, then write canonical governance source only after strict validation passes.",
            ]
            source_refs["governance_diagnostic"] = display_path(path)
            diagnostic = proof_diagnostic_summary(path, diagnostic_data, first_blocker)
        rows.append(
            {
                "blocker_id": item["blocker_id"],
                "title": item["title"],
                "status": "blocked" if coverage["blocking_input_count"] else "ready",
                "coverage_group": group,
                "gate_ids": item["gate_ids"],
                "required_configured": coverage["required_configured"],
                "required_total": coverage["required_total"],
                "required_missing": coverage["required_missing"],
                "required_invalid": coverage["required_invalid"],
                "blocking_input_count": coverage["blocking_input_count"],
                "completion_percent": coverage["completion_percent"],
                "first_blocker": first_blocker,
                "first_missing_required_inputs": coverage["first_missing_required_inputs"],
                "invalid_required_inputs": coverage["invalid_required_inputs"],
                "diagnostic": diagnostic,
                "source_refs": source_refs,
                "operator_next_actions": actions,
            }
        )
    return rows


def build_summary(audit: dict[str, Any], bundle: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    closure = audit.get("closure_summary") if isinstance(audit.get("closure_summary"), dict) else {}
    coverage = bundle.get("input_variable_coverage") if isinstance(bundle.get("input_variable_coverage"), dict) else {}
    configured = int_value(coverage.get("required_configured"), sum(int_value(row.get("required_configured")) for row in rows))
    total = int_value(coverage.get("required_total"), sum(int_value(row.get("required_total")) for row in rows))
    missing = int_value(coverage.get("required_missing"), sum(int_value(row.get("required_missing")) for row in rows))
    invalid = int_value(coverage.get("required_invalid"), sum(int_value(row.get("required_invalid")) for row in rows))
    open_gates = closure.get("open_gates") if isinstance(closure.get("open_gates"), list) else []
    return {
        "stage1_gates_completed": int_value(closure.get("completed")),
        "stage1_gates_total": int_value(closure.get("total")),
        "stage1_completion_percent": closure.get("completion_percent", 0),
        "open_gate_count": int_value(closure.get("open"), len(open_gates)),
        "final_blocker_count": len([row for row in rows if row.get("status") == "blocked"]),
        "production_inputs_configured": configured,
        "production_inputs_total": total,
        "production_inputs_completion_percent": coverage.get("required_completion_percent", percent(configured, total)),
        "production_inputs_missing": missing,
        "production_inputs_invalid": invalid,
        "blocking_input_count": int_value(coverage.get("blocking_input_count"), missing + invalid),
    }


def build_brief(args: argparse.Namespace) -> dict[str, Any]:
    audit = read_json(args.blocker_audit)
    bundle = read_json(args.proof_bundle)
    dns = read_json(args.dns_readiness)
    cutover = read_json(args.dns_cutover_plan)
    rows = build_matrix(args, bundle, dns, cutover)
    closure = audit.get("closure_summary") if isinstance(audit.get("closure_summary"), dict) else {}
    open_gates = safe_string_list(closure.get("open_gates"), limit=12)
    data: dict[str, Any] = {
        "schema_version": "stage1.production_launch_operator_brief.v1",
        "environment": "production",
        "kind": "stage1_production_launch_operator_brief",
        "status": "blocked",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "non_clearing_operator_brief": True,
        "canonical_pass_path": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "value_redaction": "variable_names_only",
        "source_refs": {
            "production_blocker_audit": display_path(args.blocker_audit),
            "production_proof_bundle": display_path(args.proof_bundle),
            "production_dns_readiness": display_path(args.dns_readiness),
            "production_dns_cutover_plan": display_path(args.dns_cutover_plan),
            "production_live_billing_diagnostic": display_path(args.billing_diagnostic),
            "production_security_diagnostic": display_path(args.security_diagnostic),
            "production_governance_diagnostic": display_path(args.governance_diagnostic),
        },
        "summary": build_summary(audit, bundle, rows),
        "open_gates": open_gates,
        "blocker_matrix": rows,
        "operator_next_actions": [
            "Keep production launch no_go until strict production evidence clears all four blocker classes.",
            "Do not use staging, sandbox, or local-only evidence to clear production launch gates.",
            "Fix production DNS/HTTPS before rerunning legal/support production source probes.",
            "Provide sanitized live production billing, security, and governance proofs before writing canonical production sources.",
        ],
        "gate_impact": {
            "can_clear_stage1_production_launch_gate": False,
            "can_close_do_not_launch": False,
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "non_clearing_evidence_only": True,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "production_launch_operator_brief")
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blocker-audit", type=Path, default=DEFAULT_BLOCKER_AUDIT)
    parser.add_argument("--proof-bundle", type=Path, default=DEFAULT_PROOF_BUNDLE)
    parser.add_argument("--dns-readiness", type=Path, default=DEFAULT_DNS_READINESS)
    parser.add_argument("--dns-cutover-plan", type=Path, default=DEFAULT_DNS_CUTOVER_PLAN)
    parser.add_argument("--billing-diagnostic", type=Path, default=DEFAULT_BILLING_DIAGNOSTIC)
    parser.add_argument("--security-diagnostic", type=Path, default=DEFAULT_SECURITY_DIAGNOSTIC)
    parser.add_argument("--governance-diagnostic", type=Path, default=DEFAULT_GOVERNANCE_DIAGNOSTIC)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if [item["blocker_id"] for item in BLOCKER_CONTRACT] != [
            "production_dns_https",
            "production_paid_billing_lifecycle",
            "production_security_launch_checks",
            "production_governance_release",
        ]:
            raise SystemExit("production launch operator brief blocker contract mismatch")
        print("stage1 production launch operator brief contract passed")
        return 0
    data = build_brief(args)
    write_json(args.output, data)
    print(f"wrote Stage 1 production launch operator brief to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
