#!/usr/bin/env python3
"""Generate a non-clearing production DNS repair packet.

This packet is an operator handoff for the apex DNS/HTTPS blocker. It reads the
existing DNS readiness and cutover plan evidence, summarizes the exact missing
inputs and next commands, and never applies DNS changes or persists secrets.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-repair-packet.json"
DEFAULT_OPERATOR_MARKDOWN = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-operator-checklist.md"
DEFAULT_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_DNS_CUTOVER_PLAN = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-cutover-plan.json"
DEFAULT_SOURCE_RUNBOOK = ROOT / "ops" / "evidence" / "non_clearing" / "production-source-probe-runbook.json"

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


class ProductionDnsRepairPacketError(Exception):
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
        raise ProductionDnsRepairPacketError(f"{display_path(path)} invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProductionDnsRepairPacketError(f"{display_path(path)} must contain a JSON object")
    return data


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionDnsRepairPacketError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionDnsRepairPacketError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_dns_repair_packet")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_text(path: Path, text: str) -> None:
    assert_no_secret(text, "production_dns_repair_operator_markdown")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def field(value: Any, default: str = "missing") -> str:
    text = str(value).strip()
    return text if text else default


def markdown_code(value: Any) -> str:
    return f"`{field(value)}`"


def render_string_list(title: str, items: list[str]) -> list[str]:
    lines = [f"## {title}", ""]
    if not items:
        lines.extend(["- none", ""])
        return lines
    for idx, item in enumerate(items, start=1):
        lines.append(f"{idx}. {item}")
    lines.append("")
    return lines


def render_command_list(title: str, commands: list[str]) -> list[str]:
    lines = [f"## {title}", ""]
    if not commands:
        lines.extend(["No commands recorded.", ""])
        return lines
    for idx, command in enumerate(commands, start=1):
        lines.extend([f"{idx}. Command:", "", "```bash", command, "```", ""])
    return lines


def private_env_template() -> dict[str, Any]:
    return {
        "path_placeholder": "<private-production-env>",
        "gitignore_required": True,
        "blank_values_only": True,
        "allowed_variable_names": [
            "PRODUCTION_DNS_TARGET",
            "CLOUDFLARE_ZONE_ID",
            "CF_ZONE_ID",
            "CLOUDFLARE_API_TOKEN",
            "CF_API_TOKEN",
        ],
        "template_lines": [
            "PRODUCTION_DNS_TARGET=",
            "CLOUDFLARE_ZONE_ID=",
            "CF_ZONE_ID=",
            "CLOUDFLARE_API_TOKEN=",
            "CF_API_TOKEN=",
        ],
    }


def operator_command_packet() -> list[dict[str, Any]]:
    return [
        {
            "step_id": "generate_plan_with_private_env",
            "command": "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "side_effect": "non-clearing plan only",
            "may_write_dns": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_plan",
            "command": "python3 scripts/validate_stage1_production_dns_cutover_plan.py --plan ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "side_effect": "local validation only",
            "may_write_dns": False,
            "requires_review": False,
        },
        {
            "step_id": "verify_cloudflare_scope",
            "command": "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --verify-cloudflare --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "side_effect": "read-only Cloudflare zone and DNS permission preflight",
            "may_write_dns": False,
            "requires_review": False,
        },
        {
            "step_id": "apply_reviewed_dns",
            "command": "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "side_effect": "operator-owned Cloudflare DNS write after review",
            "may_write_dns": True,
            "requires_review": True,
        },
        {
            "step_id": "wait_and_probe_dns",
            "command": "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json",
            "side_effect": "read-only DNS and HTTPS probe",
            "may_write_dns": False,
            "requires_review": False,
        },
        {
            "step_id": "regenerate_repair_packet",
            "command": "python3 scripts/generate_stage1_production_dns_repair_packet.py --operator-markdown ops/evidence/non_clearing/production-dns-operator-checklist.md",
            "side_effect": "non-clearing evidence refresh",
            "may_write_dns": False,
            "requires_review": False,
        },
        {
            "step_id": "validate_repair_packet",
            "command": "python3 scripts/validate_stage1_production_dns_repair_packet.py --operator-markdown ops/evidence/non_clearing/production-dns-operator-checklist.md",
            "side_effect": "local validation only",
            "may_write_dns": False,
            "requires_review": False,
        },
        {
            "step_id": "refresh_non_clearing_summary",
            "command": "python3 scripts/refresh_stage1_production_non_clearing_evidence.py || test $? -eq 2",
            "side_effect": "non-clearing summary refresh",
            "may_write_dns": False,
            "requires_review": False,
        },
    ]


def render_operator_markdown(packet: dict[str, Any]) -> str:
    summary = packet.get("summary") if isinstance(packet.get("summary"), dict) else {}
    current_dns = packet.get("current_dns") if isinstance(packet.get("current_dns"), dict) else {}
    gate = packet.get("gate_impact") if isinstance(packet.get("gate_impact"), dict) else {}
    source_refs = packet.get("source_refs") if isinstance(packet.get("source_refs"), dict) else {}
    credential_scope = packet.get("credential_scope") if isinstance(packet.get("credential_scope"), dict) else {}
    recommended = packet.get("recommended_records") if isinstance(packet.get("recommended_records"), list) else []
    doh_rows = packet.get("dns_over_https_probe_summary") if isinstance(packet.get("dns_over_https_probe_summary"), list) else []

    lines: list[str] = [
        "# Stage 1 Production DNS Operator Checklist",
        "",
        "This is a non-clearing operator handoff. It does not apply DNS changes and it does not clear production launch gates.",
        "",
        f"Status: {markdown_code(packet.get('status'))}",
        f"Release gate decision: {markdown_code(packet.get('release_gate_decision'))}",
        f"Production web URL: {markdown_code(packet.get('production_web_url'))}",
        f"DNS blocker count: {markdown_code(summary.get('dns_blocker_count'))}",
        f"Required input count: {markdown_code(summary.get('required_input_count'))}",
        "",
        "## Current Resolver State",
        "",
        f"- Production system resolver: {markdown_code(summary.get('production_system_resolver_status'))}",
        f"- Production A record: {markdown_code(summary.get('production_a_status'))}",
        f"- Production AAAA record: {markdown_code(summary.get('production_aaaa_status'))}",
        f"- Public production address count: {markdown_code(summary.get('public_production_address_count'))}",
        f"- Staging control resolver: {markdown_code(summary.get('staging_control_resolver_status'))}",
        f"- Staging A probe: {markdown_code(summary.get('staging_a_status'))}",
        f"- Cloudflare zone id configured: {markdown_code(summary.get('cloudflare_zone_id_configured'))}",
        f"- Cloudflare API token configured: {markdown_code(summary.get('cloudflare_api_token_configured'))}",
        f"- Cloudflare DNS credentials configured: {markdown_code(summary.get('cloudflare_dns_credentials_configured'))}",
        f"- R2 S3 credentials detected: {markdown_code(summary.get('r2_s3_credentials_detected'))}",
        f"- R2 S3 can manage DNS: {markdown_code(summary.get('r2_s3_can_manage_dns'))}",
        f"- Production DNS target status: {markdown_code(summary.get('production_dns_target_status'))}",
        "",
        "## Credential Scope",
        "",
        f"- Cloudflare DNS credentials configured: {markdown_code(credential_scope.get('cloudflare_dns_credentials_configured'))}",
        f"- R2 S3 credentials detected: {markdown_code(credential_scope.get('r2_s3_credentials_detected'))}",
        f"- R2 S3 present keys: {markdown_code(', '.join(string_list(credential_scope.get('r2_s3_present_keys'))) or 'none')}",
        f"- R2 S3 can manage DNS: {markdown_code(credential_scope.get('r2_s3_can_manage_dns'))}",
        f"- Operator note: {field(credential_scope.get('operator_note'))}",
        "",
        "## Current DNS Records",
        "",
        f"- zenari.ai A: {markdown_code(', '.join(string_list(current_dns.get('apex_a_records'))) or 'none')}",
        f"- zenari.ai AAAA: {markdown_code(', '.join(string_list(current_dns.get('apex_aaaa_records'))) or 'none')}",
        f"- zenari.ai CNAME: {markdown_code(', '.join(string_list(current_dns.get('apex_cname_records'))) or 'none')}",
        f"- www.zenari.ai A: {markdown_code(', '.join(string_list(current_dns.get('www_a_records'))) or 'none')}",
        f"- www.zenari.ai CNAME: {markdown_code(', '.join(string_list(current_dns.get('www_cname_records'))) or 'none')}",
        f"- staging.zenari.ai A control: {markdown_code(', '.join(string_list(current_dns.get('staging_a_records'))) or 'none')}",
        "",
        "## DNS Over HTTPS Fallback",
        "",
    ]
    if not doh_rows:
        lines.extend(["No DNS-over-HTTPS fallback probes recorded.", ""])
    for row in doh_rows:
        if not isinstance(row, dict):
            continue
        addresses = string_list(row.get("addresses"))
        lines.append(
            f"- {field(row.get('probe_id'))}: resolver {markdown_code(row.get('resolver'))}, "
            f"host {markdown_code(row.get('host'))}, rrtype {markdown_code(row.get('rrtype'))}, "
            f"status {markdown_code(row.get('status'))}, addresses {markdown_code(', '.join(addresses) or 'none')}, "
            f"error {markdown_code(row.get('error') or 'none')}"
        )
    lines.extend(
        [
            "",
            "## Public Production Addresses Observed",
            "",
            f"- {markdown_code(', '.join(string_list(packet.get('public_production_addresses_observed'))) or 'none')}",
            "",
        ]
    )
    lines.extend(
        [
        "## Recommended DNS Records",
        "",
        ]
    )
    if not recommended:
        lines.extend(["No recommended records recorded.", ""])
    for idx, row in enumerate(recommended, start=1):
        if not isinstance(row, dict):
            continue
        lines.extend(
            [
                f"{idx}. Host: {markdown_code(row.get('host'))}",
                f"   - Type: {markdown_code(row.get('type'))}",
                f"   - Name: {markdown_code(row.get('name'))}",
                f"   - Content: {markdown_code(row.get('content'))}",
                f"   - Proxied: {markdown_code(row.get('proxied'))}",
                f"   - TTL: {markdown_code(row.get('ttl'))}",
                f"   - Current status: {markdown_code(row.get('current_status'))}",
                f"   - Required when: {field(row.get('required_when'))}",
                "",
            ]
        )
    lines.extend(render_string_list("Required Inputs", string_list(packet.get("required_inputs"))))
    lines.extend(render_string_list("Blocked Checks", string_list(packet.get("blocked_checks"))))
    lines.extend(render_string_list("Cloudflare UI Steps", string_list(packet.get("cloudflare_ui_steps"))))
    lines.extend(render_string_list("Cloudflare API Plan", string_list(packet.get("cloudflare_api_plan"))))
    template = packet.get("private_env_template") if isinstance(packet.get("private_env_template"), dict) else {}
    lines.extend(
        [
            "## Private Env Template",
            "",
            f"- Path placeholder: {markdown_code(template.get('path_placeholder'))}",
            f"- Gitignored copy required: {markdown_code(template.get('gitignore_required'))}",
            f"- Blank values only in evidence: {markdown_code(template.get('blank_values_only'))}",
            "",
            "```dotenv",
        ]
    )
    lines.extend(string_list(template.get("template_lines")))
    lines.extend(["```", ""])
    lines.extend(render_command_list("Verification Commands", string_list(packet.get("verification_commands"))))
    lines.extend(render_command_list("Commands After Inputs", string_list(packet.get("commands_after_inputs"))))
    operator_commands = packet.get("operator_command_packet") if isinstance(packet.get("operator_command_packet"), list) else []
    lines.extend(["## Operator Command Packet", ""])
    if not operator_commands:
        lines.extend(["No operator command packet recorded.", ""])
    for idx, row in enumerate(operator_commands, start=1):
        if not isinstance(row, dict):
            continue
        lines.extend(
            [
                f"{idx}. Step: {markdown_code(row.get('step_id'))}",
                f"   - Side effect: {field(row.get('side_effect'))}",
                f"   - May write DNS: {markdown_code(row.get('may_write_dns'))}",
                f"   - Requires review: {markdown_code(row.get('requires_review'))}",
                "",
                "```bash",
                field(row.get("command")),
                "```",
                "",
            ]
        )
    lines.extend(render_string_list("Operator Next Actions", string_list(packet.get("operator_next_actions"))))
    lines.extend(
        [
            "## Gate Impact",
            "",
            f"- Can clear Stage 1 production launch gate: {markdown_code(gate.get('can_clear_stage1_production_launch_gate'))}",
            f"- Can clear production legal/support policy: {markdown_code(gate.get('can_clear_production_legal_support_policy'))}",
            f"- Can close do-not-launch: {markdown_code(gate.get('can_close_do_not_launch'))}",
            f"- Non-clearing evidence only: {markdown_code(gate.get('non_clearing_evidence_only'))}",
            f"- Preserved do-not-launch condition: {markdown_code(gate.get('preserved_do_not_launch_condition'))}",
            "",
            "## Source Evidence",
            "",
        ]
    )
    for key in ("dns_readiness", "dns_cutover_plan", "source_probe_runbook"):
        lines.append(f"- {key}: {markdown_code(source_refs.get(key))}")
    lines.append("")
    return "\n".join(lines)



def probe_status(container: dict[str, Any], *keys: str) -> str:
    value: Any = container
    for key in keys:
        if not isinstance(value, dict):
            return "missing"
        value = value.get(key)
    return str(value.get("status", "missing")) if isinstance(value, dict) else "missing"


def first_addresses(container: dict[str, Any], *keys: str) -> list[str]:
    value: Any = container
    for key in keys:
        if not isinstance(value, dict):
            return []
        value = value.get(key)
    if not isinstance(value, dict):
        return []
    addresses = value.get("addresses")
    if isinstance(addresses, list):
        return [str(item) for item in addresses if str(item).strip()]
    records = value.get("records")
    if isinstance(records, list):
        return [str(item) for item in records if str(item).strip()]
    return []


def doh_probe_summary(readiness: dict[str, Any]) -> list[dict[str, Any]]:
    probes = readiness.get("dns_over_https_probe") if isinstance(readiness.get("dns_over_https_probe"), dict) else {}
    rows: list[dict[str, Any]] = []
    for key in (
        "production_a_cloudflare",
        "production_aaaa_cloudflare",
        "production_a_google",
        "production_aaaa_google",
        "staging_a_cloudflare",
        "staging_a_google",
    ):
        probe = probes.get(key) if isinstance(probes.get(key), dict) else {}
        addresses = probe.get("addresses")
        rows.append(
            {
                "probe_id": key,
                "resolver": str(probe.get("resolver", "missing")),
                "host": str(probe.get("host", "missing")),
                "rrtype": str(probe.get("rrtype", "missing")),
                "status": str(probe.get("status", "missing")),
                "addresses": [str(item) for item in addresses if str(item).strip()] if isinstance(addresses, list) else [],
                "error": str(probe.get("error", ""))[:240],
            }
        )
    return rows


def target_kind_label(target: dict[str, Any]) -> str:
    target_kind = str(target.get("target_kind", "")).strip()
    if target_kind in {"ipv4", "a"}:
        return "ipv4"
    if target_kind in {"hostname", "cname"}:
        return "hostname"
    return "missing"


def target_record_content(target: dict[str, Any]) -> str:
    target_kind = target_kind_label(target)
    target_value = str(target.get("target", "")).strip()
    if target.get("status") == "ready" and target_kind in {"ipv4", "hostname"} and target_value:
        return target_value
    return "<PRODUCTION_DNS_TARGET>"


def recommended_records(target: dict[str, Any]) -> list[dict[str, Any]]:
    target_kind = target_kind_label(target)
    target_hint = str(target.get("target_hint", "set PRODUCTION_DNS_TARGET explicitly")).strip()
    target_value = target_record_content(target)
    if target_kind == "ipv4":
        return [
            {
                "host": "zenari.ai",
                "type": "A",
                "name": "@",
                "content": target_value,
                "proxied": True,
                "ttl": "auto",
                "required_when": "PRODUCTION_DNS_TARGET is an IPv4 production web ingress",
                "current_status": "missing",
            },
            {
                "host": "www.zenari.ai",
                "type": "CNAME",
                "name": "www",
                "content": "zenari.ai",
                "proxied": True,
                "ttl": "auto",
                "required_when": "Apex zenari.ai is configured",
                "current_status": "missing",
            },
        ]
    if target_kind == "hostname":
        return [
            {
                "host": "zenari.ai",
                "type": "CNAME",
                "name": "@",
                "content": target_value,
                "proxied": True,
                "ttl": "auto",
                "required_when": "PRODUCTION_DNS_TARGET is a production hostname and Cloudflare flattening is available",
                "current_status": "missing",
            },
            {
                "host": "www.zenari.ai",
                "type": "CNAME",
                "name": "www",
                "content": "zenari.ai",
                "proxied": True,
                "ttl": "auto",
                "required_when": "Apex zenari.ai is configured",
                "current_status": "missing",
            },
        ]
    return [
        {
            "host": "zenari.ai",
            "type": "A or flattened CNAME",
            "name": "@",
            "content": target_value,
            "proxied": True,
            "ttl": "auto",
            "required_when": target_hint,
            "current_status": "missing",
        },
        {
            "host": "www.zenari.ai",
            "type": "CNAME",
            "name": "www",
            "content": "zenari.ai",
            "proxied": True,
            "ttl": "auto",
            "required_when": "Apex zenari.ai is configured",
            "current_status": "missing",
        },
    ]


def build_packet(args: argparse.Namespace) -> dict[str, Any]:
    readiness = load_json(args.dns_readiness)
    cutover = load_json(args.dns_cutover_plan)
    runbook = load_json(args.source_runbook)
    readiness_blockers = string_list(readiness.get("blocked_checks"))
    cutover_blockers = string_list(cutover.get("blocked_checks"))
    all_blockers = readiness_blockers + cutover_blockers
    cloudflare = cutover.get("cloudflare_zone") if isinstance(cutover.get("cloudflare_zone"), dict) else {}
    credential_scope = cutover.get("credential_scope") if isinstance(cutover.get("credential_scope"), dict) else {}
    target = cutover.get("target") if isinstance(cutover.get("target"), dict) else {}
    current_records = cutover.get("current_records") if isinstance(cutover.get("current_records"), dict) else {}
    source_steps = runbook.get("steps") if isinstance(runbook.get("steps"), list) else []
    dns_step = next((step for step in source_steps if isinstance(step, dict) and step.get("step_id") == "production_dns_https"), {})
    doh_summary = doh_probe_summary(readiness)
    public_addresses = readiness.get("public_production_addresses_observed")
    required_inputs = [
        "PRODUCTION_DNS_TARGET",
        "CLOUDFLARE_ZONE_ID or CF_ZONE_ID",
        "CLOUDFLARE_API_TOKEN or CF_API_TOKEN",
    ]
    data: dict[str, Any] = {
        "schema_version": "stage1.production_dns_repair_packet.v1",
        "kind": "stage1_production_dns_repair_packet",
        "environment": "production",
        "status": "blocked" if all_blockers else "ready_to_apply_non_clearing",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "non_clearing_repair_packet": True,
        "canonical_pass_path": False,
        "can_apply_dns_changes": False,
        "can_clear_production_legal_support_policy": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "production_web_url": "https://zenari.ai",
        "source_refs": {
            "dns_readiness": display_path(args.dns_readiness),
            "dns_cutover_plan": display_path(args.dns_cutover_plan),
            "source_probe_runbook": display_path(args.source_runbook),
        },
        "summary": {
            "dns_blocker_count": len(all_blockers),
            "required_input_count": len(required_inputs),
            "production_system_resolver_status": probe_status(readiness, "system_resolver", "production"),
            "staging_control_resolver_status": probe_status(readiness, "system_resolver", "staging_control"),
            "production_a_status": probe_status(readiness, "authoritative_public_dns_probe", "production_a"),
            "production_aaaa_status": probe_status(readiness, "authoritative_public_dns_probe", "production_aaaa"),
            "staging_a_status": probe_status(readiness, "authoritative_public_dns_probe", "staging_a"),
            "public_production_address_count": len(public_addresses) if isinstance(public_addresses, list) else 0,
            "cloudflare_zone_id_configured": bool(cloudflare.get("zone_id_configured")),
            "cloudflare_api_token_configured": bool(cloudflare.get("api_token_configured")),
            "cloudflare_dns_credentials_configured": bool(credential_scope.get("cloudflare_dns_credentials_configured")),
            "r2_s3_credentials_detected": bool(credential_scope.get("r2_s3_credentials_detected")),
            "r2_s3_can_manage_dns": bool(credential_scope.get("r2_s3_can_manage_dns")),
            "production_dns_target_status": str(target.get("status", "missing")),
            "source_runbook_step_id": str(dns_step.get("step_id", "production_dns_https")),
            "source_runbook_blocking_input_count": int(dns_step.get("blocking_input_count", 3)) if isinstance(dns_step.get("blocking_input_count", 3), int) else 3,
        },
        "credential_scope": {
            "cloudflare_dns_credentials_configured": bool(credential_scope.get("cloudflare_dns_credentials_configured")),
            "cloudflare_zone_id_configured": bool(credential_scope.get("cloudflare_zone_id_configured")),
            "cloudflare_api_token_configured": bool(credential_scope.get("cloudflare_api_token_configured")),
            "r2_s3_credentials_detected": bool(credential_scope.get("r2_s3_credentials_detected")),
            "r2_s3_present_keys": string_list(credential_scope.get("r2_s3_present_keys")),
            "r2_s3_can_manage_dns": False,
            "dns_write_requires": string_list(credential_scope.get("dns_write_requires")),
            "operator_note": field(
                credential_scope.get("operator_note"),
                "Cloudflare R2 S3 access keys are object-storage credentials only and cannot create or edit zenari.ai DNS records.",
            ),
        },
        "current_dns": {
            "apex_a_records": first_addresses(current_records, "apex_a"),
            "apex_aaaa_records": first_addresses(current_records, "apex_aaaa"),
            "apex_cname_records": first_addresses(current_records, "apex_cname"),
            "www_a_records": first_addresses(current_records, "www_a"),
            "www_cname_records": first_addresses(current_records, "www_cname"),
            "staging_a_records": first_addresses(current_records, "staging_a"),
        },
        "public_production_addresses_observed": [str(item) for item in public_addresses if str(item).strip()] if isinstance(public_addresses, list) else [],
        "dns_over_https_probe_summary": doh_summary,
        "recommended_records": recommended_records(target),
        "cloudflare_ui_steps": [
            "Do not use Cloudflare R2 S3 access keys for this DNS change; they are object-storage credentials only.",
            "Open Cloudflare dashboard for the zenari.ai zone.",
            "Go to DNS > Records and create or update the apex record named @ using PRODUCTION_DNS_TARGET.",
            "Create or update www as a CNAME to zenari.ai.",
            "Keep records proxied unless the production ingress requires DNS-only validation during certificate issuance.",
            "Do not copy staging.zenari.ai records as the production target unless PRODUCTION_DNS_TARGET explicitly names that production ingress.",
        ],
        "cloudflare_api_plan": [
            "Do not export OBJECT_STORAGE_ACCESS_KEY or OBJECT_STORAGE_SECRET_KEY for DNS writes.",
            "Export CLOUDFLARE_ZONE_ID or CF_ZONE_ID only in the operator shell.",
            "Export CLOUDFLARE_API_TOKEN or CF_API_TOKEN with Zone DNS Edit permission only in the operator shell.",
            "Export PRODUCTION_DNS_TARGET as the production web ingress IPv4 address or hostname.",
            "Run stage1_production_dns_cutover_plan.py without --apply and confirm status ready_to_apply.",
            "Run stage1_production_dns_cutover_plan.py --verify-cloudflare and confirm cloudflare_scope_preflight.status is pass.",
            "Run stage1_production_dns_cutover_plan.py --apply only after reviewing the non-clearing plan.",
        ],
        "private_env_template": private_env_template(),
        "verification_commands": [
            "dig +short A zenari.ai",
            "dig +short AAAA zenari.ai",
            "dig +short CNAME www.zenari.ai",
            "curl -I --max-time 12 https://zenari.ai/",
            "curl -I --max-time 12 https://zenari.ai/legal/terms",
            "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json",
        ],
        "required_inputs": required_inputs,
        "blocked_checks": all_blockers,
        "commands_after_inputs": [
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --verify-cloudflare --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "python3 scripts/stage1_production_dns_cutover_plan.py --env <private-production-env> --apply --output ops/evidence/non_clearing/production-dns-cutover-plan.json",
            "python3 scripts/stage1_production_dns_readiness.py --output ops/evidence/non_clearing/production-dns-readiness.json",
            "python3 scripts/stage1_production_source_probe.py --legal-support --release-sha $(git rev-parse HEAD) --production-web-url https://zenari.ai --write-canonical-source",
            "python3 scripts/generate_stage1_production_legal_support_evidence.py --source ops/evidence/production/production-legal-support-source.json",
            "python3 scripts/validate_stage1_production_legal_support_evidence.py",
            "python3 scripts/generate_stage1_production_launch_evidence.py",
            "python3 scripts/validate_stage1_production_launch.py",
        ],
        "operator_command_packet": operator_command_packet(),
        "operator_next_actions": [
            "Set the explicit production DNS target; do not use staging host as an implicit production target.",
            "Provide Cloudflare zone id and a DNS-edit token only in the operator environment; do not persist token values.",
            "Generate the cutover plan, apply DNS only after reviewing the non-clearing plan, then wait for public propagation.",
            "Rerun DNS readiness and legal/support source probe after zenari.ai resolves and HTTPS public paths return pass.",
        ],
        "gate_impact": {
            "can_clear_stage1_production_launch_gate": False,
            "can_clear_production_legal_support_policy": False,
            "can_close_do_not_launch": False,
            "non_clearing_evidence_only": True,
            "preserved_do_not_launch_condition": "stage1_production_launch_evidence_incomplete",
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    assert_no_secret(data, "production_dns_repair_packet")
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dns-readiness", type=Path, default=DEFAULT_DNS_READINESS)
    parser.add_argument("--dns-cutover-plan", type=Path, default=DEFAULT_DNS_CUTOVER_PLAN)
    parser.add_argument("--source-runbook", type=Path, default=DEFAULT_SOURCE_RUNBOOK)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--operator-markdown",
        type=Path,
        default=None,
        help=f"Optional path for a human-readable non-clearing checklist, e.g. {display_path(DEFAULT_OPERATOR_MARKDOWN)}",
    )
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        print("stage1 production DNS repair packet generator contract passed")
        return 0
    packet = build_packet(args)
    write_json(args.output, packet)
    if args.operator_markdown:
        write_text(args.operator_markdown, render_operator_markdown(packet))
    print(f"wrote Stage 1 production DNS repair packet to {display_path(args.output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
