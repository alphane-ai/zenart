#!/usr/bin/env python3
"""Generate a non-clearing production legal/support operator packet.

The packet turns the final legal/support production blocker into an exact
operator checklist: DNS, HTTPS, public page paths, required page tokens, and the
canonical source/evidence commands. It never clears the production launch gate
and never persists secrets, cookies, auth headers, raw payloads, or signed URLs.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-legal-support-operator-packet.json"
DEFAULT_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_DNS_CUTOVER_PLAN = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-cutover-plan.json"
DEFAULT_SOURCE_DIAGNOSTIC = ROOT / "ops" / "evidence" / "production" / "source-probe-diagnostics.legal-support.json"
DEFAULT_SOURCE = ROOT / "ops" / "evidence" / "production" / "production-legal-support-source.json"
DEFAULT_LEGAL_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "public-legal-policy.json"
DEFAULT_SUPPORT_EVIDENCE = ROOT / "ops" / "evidence" / "production" / "public-support-billing-policy.json"
DEFAULT_PRODUCTION_WEB_URL = "https://zenari.ai"

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

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
)

LEGAL_PAGES = [
    ("terms", "/legal/terms", ("Terms", "support contact", "AI content")),
    ("privacy", "/legal/privacy", ("Privacy", "data deletion", "support contact")),
    ("acceptable_use", "/legal/acceptable-use", ("Acceptable Use", "abuse", "support contact")),
    ("ai_content_disclaimer", "/support", ("AI content", "responsibility", "review")),
    ("ip_complaint", "/legal/ip-complaints", ("IP complaint", "copyright", "trademark", "takedown")),
]

SUPPORT_PAGES = [
    ("support_contact", "/support", ("support contact", "report problem", "privacy redaction", "escalation")),
    ("report_problem", "/report-problem", ("project", "task", "trace", "export", "quota")),
    ("billing_policy", "/legal/billing-policy", ("billing", "cancellation", "refund", "credit", "quota reset", "past_due")),
    ("support_sla", "/support", ("support SLA", "severity", "response time", "escalation")),
]

OPERATOR_COMMAND_STEPS = [
    "plan_dns_cutover_with_private_env",
    "apply_dns_cutover_after_review",
    "refresh_dns_readiness",
    "run_legal_support_source_probe_after_https_passes",
    "generate_strict_legal_support_evidence",
    "validate_strict_legal_support_evidence",
    "refresh_production_launch_evidence",
    "validate_production_launch_evidence",
]


class LegalSupportOperatorPacketError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        raise LegalSupportOperatorPacketError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise LegalSupportOperatorPacketError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise LegalSupportOperatorPacketError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise LegalSupportOperatorPacketError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "legal_support_operator_packet")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def current_release_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def first_blocker(data: dict[str, Any]) -> str:
    blockers = string_list(data.get("blocked_checks")) or string_list(data.get("blockers"))
    return blockers[0] if blockers else "not reported"


def path_for_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    return parsed.path or "/"


def https_path_summary(dns: dict[str, Any]) -> list[dict[str, Any]]:
    https = dns.get("https_probe") if isinstance(dns.get("https_probe"), dict) else {}
    rows = https.get("production_paths") if isinstance(https, dict) else []
    result: list[dict[str, Any]] = []
    if not isinstance(rows, list):
        return result
    for row in rows:
        if not isinstance(row, dict):
            continue
        result.append(
            {
                "path": path_for_url(str(row.get("url", ""))),
                "status": row.get("status", "missing"),
                "http_status": row.get("http_status"),
                "error_summary": str(row.get("error", ""))[:240],
            }
        )
    return result


def dns_summary(path: Path, dns: dict[str, Any]) -> dict[str, Any]:
    system = dns.get("system_resolver") if isinstance(dns.get("system_resolver"), dict) else {}
    public = dns.get("authoritative_public_dns_probe") if isinstance(dns.get("authoritative_public_dns_probe"), dict) else {}
    https_paths = https_path_summary(dns)
    return {
        "path": display_path(path),
        "status": dns.get("status", "missing") if dns else "missing",
        "production_web_url": dns.get("production_web_url", DEFAULT_PRODUCTION_WEB_URL) if dns else DEFAULT_PRODUCTION_WEB_URL,
        "first_blocker": first_blocker(dns) if dns else "production_dns_readiness_not_written",
        "system_resolver_status": (
            system.get("production", {}).get("status", "missing") if isinstance(system.get("production"), dict) else "missing"
        ),
        "public_dns_a_status": (
            public.get("production_a", {}).get("status", "missing") if isinstance(public.get("production_a"), dict) else "missing"
        ),
        "public_dns_aaaa_status": (
            public.get("production_aaaa", {}).get("status", "missing") if isinstance(public.get("production_aaaa"), dict) else "missing"
        ),
        "https_pass_count": sum(1 for item in https_paths if item.get("status") == "pass"),
        "https_total": len(https_paths),
        "production_paths": https_paths,
        "staging_control_status": (
            dns.get("https_probe", {}).get("staging_control", {}).get("status", "missing")
            if isinstance(dns.get("https_probe"), dict)
            else "missing"
        ),
    }


def source_diagnostic_summary(path: Path, diagnostic: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": display_path(path),
        "exists": path.exists(),
        "status": diagnostic.get("status", "missing") if diagnostic else "missing",
        "first_blocker": first_blocker(diagnostic) if diagnostic else "source_probe_diagnostic_not_written",
        "canonical_source_written": diagnostic.get("canonical_source_written") is True if diagnostic else False,
    }


def cutover_plan_summary(path: Path) -> dict[str, Any]:
    data = load_json(path)
    blockers = string_list(data.get("blocked_checks"))
    return {
        "path": display_path(path),
        "exists": path.exists(),
        "status": data.get("status", "missing") if data else "missing",
        "first_blocker": blockers[0] if blockers else "not reported",
        "required_command": (
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> "
            "--output ops/evidence/non_clearing/production-dns-cutover-plan.json"
        ),
    }


def page_requirements() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for group, pages in (("legal", LEGAL_PAGES), ("support_billing", SUPPORT_PAGES)):
        for page_id, path, tokens in pages:
            rows.append(
                {
                    "group": group,
                    "page_id": page_id,
                    "path": path,
                    "method": "GET",
                    "expected_http_status": 200,
                    "visibility": "public",
                    "external_user_visible": True,
                    "admin_session_required": False,
                    "required_tokens": list(tokens),
                }
            )
    return rows


def operator_command_packet(args: argparse.Namespace) -> list[dict[str, Any]]:
    production_web_url = args.production_web_url.rstrip("/")
    return [
        {
            "step_id": "plan_dns_cutover_with_private_env",
            "command": (
                "python3 scripts/stage1_production_dns_cutover_plan.py "
                "--env <private-production-env> "
                "--output ops/evidence/non_clearing/production-dns-cutover-plan.json"
            ),
            "side_effect": "non-clearing DNS cutover plan only; does not apply provider changes",
            "may_apply_production_dns": False,
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "verify_cloudflare_scope_before_apply",
            "command": (
                "python3 scripts/stage1_production_dns_cutover_plan.py "
                "--env <private-production-env> "
                "--verify-cloudflare "
                "--output ops/evidence/non_clearing/production-dns-cutover-plan.json"
            ),
            "side_effect": "read-only Cloudflare zone and DNS permission preflight",
            "may_apply_production_dns": False,
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "apply_dns_cutover_after_review",
            "command": (
                "python3 scripts/stage1_production_dns_cutover_plan.py "
                "--env <private-production-env> "
                "--apply "
                "--output ops/evidence/non_clearing/production-dns-cutover-plan.json"
            ),
            "side_effect": "applies reviewed production DNS cutover through the private production env",
            "may_apply_production_dns": True,
            "may_write_canonical_source": False,
            "requires_review": True,
        },
        {
            "step_id": "refresh_dns_readiness",
            "command": (
                "python3 scripts/stage1_production_dns_readiness.py "
                "--output ops/evidence/non_clearing/production-dns-readiness.json || test $? -eq 2"
            ),
            "side_effect": "non-clearing DNS and HTTPS readiness refresh",
            "may_apply_production_dns": False,
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "run_legal_support_source_probe_after_https_passes",
            "command": (
                "python3 scripts/stage1_production_source_probe.py --legal-support "
                "--release-sha $(git rev-parse HEAD) "
                f"--production-web-url {production_web_url} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.legal-support.json "
                "--write-canonical-source"
            ),
            "side_effect": "writes legal/support canonical source only after production DNS and HTTPS public pages pass",
            "may_apply_production_dns": False,
            "may_write_canonical_source": True,
            "requires_review": True,
        },
        {
            "step_id": "generate_strict_legal_support_evidence",
            "command": (
                "python3 scripts/generate_stage1_production_legal_support_evidence.py "
                "--source ops/evidence/production/production-legal-support-source.json"
            ),
            "side_effect": "writes strict production legal/support evidence from canonical source",
            "may_apply_production_dns": False,
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_strict_legal_support_evidence",
            "command": "python3 scripts/validate_stage1_production_legal_support_evidence.py",
            "side_effect": "strict production legal/support validation",
            "may_apply_production_dns": False,
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "refresh_production_launch_evidence",
            "command": "python3 scripts/generate_stage1_production_launch_evidence.py",
            "side_effect": "refreshes aggregate production launch evidence from canonical production sources",
            "may_apply_production_dns": False,
            "may_write_canonical_source": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_production_launch_evidence",
            "command": "python3 scripts/validate_stage1_production_launch.py",
            "side_effect": "strict aggregate production launch validation",
            "may_apply_production_dns": False,
            "may_write_canonical_source": False,
            "requires_review": False,
        },
    ]


def build_packet(args: argparse.Namespace) -> dict[str, Any]:
    dns = load_json(args.dns_readiness)
    diagnostic = load_json(args.source_diagnostic)
    dns_info = dns_summary(args.dns_readiness, dns)
    source_info = source_diagnostic_summary(args.source_diagnostic, diagnostic)
    source_exists = args.source.exists()

    data: dict[str, Any] = {
        "schema_version": "stage1.production_legal_support_operator_packet.v1",
        "environment": "production",
        "kind": "stage1_production_legal_support_operator_packet",
        "status": "blocked",
        "release_gate_check_id": "production_legal_support_policy",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "release_sha": current_release_sha(),
        "production_web_url": args.production_web_url.rstrip("/"),
        "non_clearing_operator_packet": True,
        "canonical_pass_path": False,
        "can_clear_production_legal_support_policy": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "dns_readiness": dns_info,
        "source_probe": {
            "canonical_source_path": display_path(args.source),
            "canonical_source_exists": source_exists,
            "source_diagnostic": source_info,
            "required_probe": "production HTTPS GET public-page token probe",
            "source_probe_command": (
                "python3 scripts/stage1_production_source_probe.py --legal-support "
                "--release-sha $(git rev-parse HEAD) "
                f"--production-web-url {args.production_web_url.rstrip('/')} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.legal-support.json "
                "--write-canonical-source"
            ),
        },
        "required_public_paths": page_requirements(),
        "required_dns_and_https": {
            "apex_host": "zenari.ai",
            "allowed_public_url": "https://zenari.ai",
            "disallowed_gate_inputs": ["localhost", "127.0.0.1", "IP-only URL", "staging.zenari.ai"],
            "required_public_dns": "public A/AAAA or provider-supported flattened CNAME for zenari.ai",
            "required_tls": "valid publicly trusted HTTPS certificate for zenari.ai",
            "required_http_status": 200,
        },
        "dns_cutover_plan": cutover_plan_summary(args.dns_cutover_plan),
        "operator_next_actions": [
            "Generate the DNS cutover plan with scripts/stage1_production_dns_cutover_plan.py --env <private-production-env>.",
            "Publish zenari.ai production DNS to the real production web ingress.",
            "Serve HTTPS 200 for every required public legal/support path on https://zenari.ai.",
            "Keep legal/support pages public; do not require admin session, cookies, bearer tokens, or localhost-only access.",
            "Rerun the legal/support source probe only after DNS and HTTPS are publicly reachable.",
            "Generate split legal/support evidence and run strict validation after the canonical source is written.",
        ],
        "blocked_until": [
            "ops/evidence/non_clearing/production-dns-readiness.json reports production system resolver pass",
            "ops/evidence/non_clearing/production-dns-cutover-plan.json is ready_to_apply, applied, or observed_applied",
            "ops/evidence/non_clearing/production-dns-readiness.json reports public A or AAAA readiness for zenari.ai",
            "all required https_probe.production_paths are pass with HTTP status below 400",
            "scripts/stage1_production_source_probe.py --legal-support writes ops/evidence/production/production-legal-support-source.json",
            "scripts/generate_stage1_production_legal_support_evidence.py writes strict production legal/support evidence",
            "python3 scripts/validate_stage1_production_legal_support_evidence.py passes without --allow-preflight",
        ],
        "execution_order": [
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --verify-cloudflare --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json || test \"$?\" = 2",
            "python3 scripts/validate_stage1_production_dns_readiness.py --evidence ops/evidence/non_clearing/production-dns-readiness.json",
            (
                "python3 scripts/stage1_production_source_probe.py --legal-support "
                "--release-sha $(git rev-parse HEAD) "
                f"--production-web-url {args.production_web_url.rstrip('/')} "
                "--diagnostic ops/evidence/production/source-probe-diagnostics.legal-support.json "
                "--write-canonical-source"
            ),
            "python3 scripts/generate_stage1_production_legal_support_evidence.py --source ops/evidence/production/production-legal-support-source.json",
            "python3 scripts/validate_stage1_production_legal_support_evidence.py",
            "python3 scripts/generate_stage1_production_launch_evidence.py",
            "python3 scripts/validate_stage1_production_launch.py",
        ],
        "operator_command_packet": operator_command_packet(args),
        "evidence_outputs": {
            "source": display_path(args.source),
            "legal": display_path(args.legal_evidence),
            "support_billing": display_path(args.support_evidence),
            "source_diagnostic": display_path(args.source_diagnostic),
            "dns_readiness": display_path(args.dns_readiness),
            "dns_cutover_plan": display_path(args.dns_cutover_plan),
        },
        "gate_impact": {
            "preserved_release_gate_check_id": "production_legal_support_policy",
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
            "can_clear_public_legal_subitem": False,
            "can_clear_support_billing_policy_subitem": False,
            "can_clear_aggregate_production_gate": False,
            "can_clear_stage1_production_launch_gate": False,
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--production-web-url", default=DEFAULT_PRODUCTION_WEB_URL)
    parser.add_argument("--dns-readiness", type=Path, default=DEFAULT_DNS_READINESS)
    parser.add_argument("--dns-cutover-plan", type=Path, default=DEFAULT_DNS_CUTOVER_PLAN)
    parser.add_argument("--source-diagnostic", type=Path, default=DEFAULT_SOURCE_DIAGNOSTIC)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--legal-evidence", type=Path, default=DEFAULT_LEGAL_EVIDENCE)
    parser.add_argument("--support-evidence", type=Path, default=DEFAULT_SUPPORT_EVIDENCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if args.production_web_url.rstrip("/") != DEFAULT_PRODUCTION_WEB_URL:
            raise SystemExit("production legal/support operator packet URL contract mismatch")
        if len(LEGAL_PAGES) != 5 or len(SUPPORT_PAGES) != 4:
            raise SystemExit("production legal/support operator page contract mismatch")
        print("stage1 production legal/support operator packet generator contract passed")
        return 0
    parsed = urllib.parse.urlparse(args.production_web_url)
    if parsed.scheme != "https" or parsed.hostname != "zenari.ai":
        raise SystemExit("production legal/support operator packet requires https://zenari.ai")
    packet = build_packet(args)
    write_json(args.output, packet)
    print(f"wrote Stage 1 production legal/support operator packet to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
