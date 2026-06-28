#!/usr/bin/env python3
"""Plan or apply the Stage 1 production DNS cutover for zenari.ai.

Default mode is non-clearing and writes an operator plan. ``--apply`` is
available only when Cloudflare credentials and a production origin target are
present; secrets are never persisted in the plan or command output.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-cutover-plan.json"
DEFAULT_DNS_READINESS = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_PRODUCTION_WEB_URL = "https://zenari.ai"
REQUIRED_HOSTS = ("zenari.ai", "www.zenari.ai")
ORIGIN_PREFLIGHT_PATH = "/"
ORIGIN_PREFLIGHT_ACCEPTED_STATUSES = {200, 301, 302, 307, 308}
R2_S3_ENV_KEYS = (
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
)
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


class ProductionDnsCutoverPlanError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            values[key] = value.strip().strip("'\"")
    return values


def env_value(values: dict[str, str], key: str) -> str:
    return os.environ.get(key, values.get(key, "")).strip()


def env_present(values: dict[str, str], key: str) -> bool:
    return bool(env_value(values, key))


def credential_scope(values: dict[str, str], zone_id: str, token: str) -> dict[str, Any]:
    r2_present_keys = [key for key in R2_S3_ENV_KEYS if env_present(values, key)]
    return {
        "cloudflare_dns_credentials_configured": bool(zone_id and token),
        "cloudflare_zone_id_configured": bool(zone_id),
        "cloudflare_api_token_configured": bool(token),
        "r2_s3_credentials_detected": bool(r2_present_keys),
        "r2_s3_present_keys": r2_present_keys,
        "r2_s3_can_manage_dns": False,
        "dns_write_requires": [
            "CLOUDFLARE_ZONE_ID or CF_ZONE_ID",
            "CLOUDFLARE_API_TOKEN or CF_API_TOKEN with Zone DNS Edit permission",
            "PRODUCTION_DNS_TARGET",
        ],
        "operator_note": (
            "Cloudflare R2 S3 access keys are object-storage credentials only and cannot create or edit "
            "zenari.ai DNS records; use a Cloudflare API token with Zone DNS Edit permission."
        ),
    }


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise ProductionDnsCutoverPlanError(f"{path}.{key} exposes secret/raw payload field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise ProductionDnsCutoverPlanError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "production_dns_cutover_plan")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def run_dig(host: str, rrtype: str) -> dict[str, Any]:
    result = subprocess.run(
        ["dig", "+short", rrtype, host],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    rows = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return {
        "host": host,
        "rrtype": rrtype,
        "status": "pass" if rows else "missing",
        "records": rows,
        "exit_code": result.returncode,
    }


def normalize_dns_name(value: str) -> str:
    return value.strip().rstrip(".").lower()


def is_ipv4(value: str) -> bool:
    if re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", value) is None:
        return False
    return all(0 <= int(part) <= 255 for part in value.split("."))


def classify_target(value: str) -> dict[str, Any]:
    if not value:
        return {"status": "missing", "target_kind": "missing"}
    if is_ipv4(value):
        return {"status": "ready", "target_kind": "a", "target": value}
    if re.fullmatch(r"(?:\d{1,3}\.){3}\d{1,3}", value):
        return {
            "status": "blocked",
            "target_kind": "invalid",
            "target_hint": "set PRODUCTION_DNS_TARGET to a valid IPv4 address or hostname",
        }
    if re.fullmatch(r"[A-Za-z0-9.-]+\.[A-Za-z]{2,}\.?", value):
        return {"status": "ready", "target_kind": "cname", "target": value.rstrip(".")}
    return {"status": "blocked", "target_kind": "invalid", "target_hint": "set PRODUCTION_DNS_TARGET to an IPv4 address or hostname"}


def record_values(records: dict[str, Any], key: str) -> list[str]:
    item = records.get(key)
    if not isinstance(item, dict):
        return []
    values = item.get("records")
    if not isinstance(values, list):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def current_records_match_target(current_records: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    target_value = str(target.get("target", "")).strip()
    target_kind = str(target.get("target_kind", "")).strip()
    apex_records: list[str]
    apex_expected: str
    if target_kind == "a":
        apex_records = record_values(current_records, "apex_a")
        apex_expected = target_value
        apex_matches = target_value in apex_records
    elif target_kind == "cname":
        apex_records = [normalize_dns_name(value) for value in record_values(current_records, "apex_cname")]
        apex_expected = normalize_dns_name(target_value)
        apex_matches = apex_expected in apex_records
    else:
        return {
            "status": "not_observed",
            "reason": "production_dns_target_not_ready",
            "apex_matches_target": False,
            "www_points_to_apex": False,
            "apex_expected": "",
            "apex_observed": [],
            "www_observed": [],
            "can_omit_cloudflare_api_credentials": False,
        }
    www_cname_records = [normalize_dns_name(value) for value in record_values(current_records, "www_cname")]
    www_a_records = record_values(current_records, "www_a")
    www_points_to_apex = "zenari.ai" in www_cname_records or target_value in www_a_records
    status = "observed_applied" if apex_matches and www_points_to_apex else "not_observed"
    missing: list[str] = []
    if not apex_matches:
        missing.append("zenari.ai does not match PRODUCTION_DNS_TARGET")
    if not www_points_to_apex:
        missing.append("www.zenari.ai does not point to zenari.ai or PRODUCTION_DNS_TARGET")
    return {
        "status": status,
        "reason": "" if status == "observed_applied" else "; ".join(missing),
        "apex_matches_target": apex_matches,
        "www_points_to_apex": www_points_to_apex,
        "apex_expected": apex_expected,
        "apex_observed": apex_records,
        "www_observed": record_values(current_records, "www_cname") + www_a_records,
        "can_omit_cloudflare_api_credentials": status == "observed_applied",
    }


def origin_https_probe(connect_host: str, sni_host: str, timeout: float = 6.0) -> dict[str, Any]:
    base: dict[str, Any] = {
        "connect_host": connect_host,
        "sni_host": sni_host,
        "path": ORIGIN_PREFLIGHT_PATH,
        "status": "blocked",
        "http_status": None,
        "accepted_statuses": sorted(ORIGIN_PREFLIGHT_ACCEPTED_STATUSES),
        "error_summary": "",
    }
    try:
        context = ssl.create_default_context()
        with socket.create_connection((connect_host, 443), timeout=timeout) as raw_sock:
            with context.wrap_socket(raw_sock, server_hostname=sni_host) as tls_sock:
                tls_sock.settimeout(timeout)
                request = (
                    f"HEAD {ORIGIN_PREFLIGHT_PATH} HTTP/1.1\r\n"
                    f"Host: {sni_host}\r\n"
                    "User-Agent: zenari-stage1-production-dns-cutover/1.0\r\n"
                    "Connection: close\r\n\r\n"
                )
                tls_sock.sendall(request.encode("ascii"))
                response = tls_sock.recv(4096)
    except (OSError, TimeoutError, ssl.SSLError) as exc:
        base["error_summary"] = f"{type(exc).__name__}: {str(exc)[:180]}"
        return base
    first_line = response.splitlines()[0].decode("iso-8859-1", errors="replace") if response else ""
    match = re.match(r"HTTP/\d(?:\.\d)?\s+(\d{3})", first_line)
    if match is None:
        base["error_summary"] = "origin response did not start with an HTTP status line"
        return base
    status = int(match.group(1))
    base["http_status"] = status
    base["status"] = "pass" if status in ORIGIN_PREFLIGHT_ACCEPTED_STATUSES else "blocked"
    if base["status"] != "pass":
        base["error_summary"] = f"origin returned HTTP {status}, expected one of {sorted(ORIGIN_PREFLIGHT_ACCEPTED_STATUSES)}"
    return base


def build_origin_https_preflight(target: dict[str, Any], credentials_configured: bool) -> dict[str, Any]:
    if target.get("status") != "ready":
        return {
            "status": "not_run",
            "reason": "production_dns_target_not_ready",
            "required_hosts": list(REQUIRED_HOSTS),
            "probes": [],
        }
    if not credentials_configured:
        return {
            "status": "not_run",
            "reason": "cloudflare_dns_credentials_missing",
            "required_hosts": list(REQUIRED_HOSTS),
            "probes": [],
        }
    connect_host = str(target.get("target", "")).strip()
    probes = [origin_https_probe(connect_host, host) for host in REQUIRED_HOSTS]
    failed = [probe for probe in probes if probe.get("status") != "pass"]
    return {
        "status": "pass" if not failed else "blocked",
        "reason": "" if not failed else "production_origin_does_not_serve_required_https_hosts",
        "required_hosts": list(REQUIRED_HOSTS),
        "probes": probes,
    }


def summarize_cf_errors(response: dict[str, Any]) -> list[str]:
    errors = response.get("errors")
    if not isinstance(errors, list):
        return []
    rows: list[str] = []
    for item in errors[:4]:
        if not isinstance(item, dict):
            continue
        code = str(item.get("code", "")).strip()
        message = str(item.get("message", "")).strip()
        if code and message:
            rows.append(f"{code}: {message[:160]}")
        elif message:
            rows.append(message[:160])
        elif code:
            rows.append(code)
    return rows


def cloudflare_check(label: str, token: str, method: str, path: str) -> dict[str, Any]:
    response = cf_api(token, method, path)
    result = response.get("result")
    result_count = len(result) if isinstance(result, list) else (1 if isinstance(result, dict) else 0)
    success = response.get("success") is True
    return {
        "check_id": label,
        "status": "pass" if success else "blocked",
        "success": success,
        "error_count": len(response.get("errors", [])) if isinstance(response.get("errors"), list) else 0,
        "error_summaries": summarize_cf_errors(response),
        "result_count": result_count,
    }


def build_cloudflare_scope_preflight(zone_id: str, token: str, verify_cloudflare: bool) -> dict[str, Any]:
    base: dict[str, Any] = {
        "requested": verify_cloudflare,
        "status": "not_run",
        "reason": "verify_cloudflare_not_requested",
        "zone_id_configured": bool(zone_id),
        "api_token_configured": bool(token),
        "required_scope": "Zone DNS Read and Zone DNS Edit for zenari.ai",
        "checks": [],
    }
    if not verify_cloudflare:
        return base
    if not zone_id or not token:
        base["status"] = "blocked"
        base["reason"] = "cloudflare_dns_credentials_missing"
        return base

    checks = [
        cloudflare_check("zone_read", token, "GET", f"/zones/{zone_id}"),
        cloudflare_check("dns_records_list", token, "GET", f"/zones/{zone_id}/dns_records?per_page=1"),
    ]
    failed = [check for check in checks if check.get("status") != "pass"]
    return {
        **base,
        "status": "pass" if not failed else "blocked",
        "reason": "" if not failed else "cloudflare_zone_or_dns_scope_preflight_failed",
        "checks": checks,
    }


def cf_api(token: str, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            data = json.loads(exc.read().decode("utf-8"))
        except json.JSONDecodeError:
            data = {"success": False, "errors": [{"message": f"http_{exc.code}"}]}
    if not isinstance(data, dict):
        return {"success": False, "errors": [{"message": "non_object_response"}]}
    return data


def apply_cloudflare_records(zone_id: str, token: str, target: dict[str, Any], proxied: bool) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if target.get("target_kind") == "a":
        desired = [
            {"type": "A", "name": "zenari.ai", "content": target["target"], "ttl": 1, "proxied": proxied},
            {"type": "CNAME", "name": "www", "content": "zenari.ai", "ttl": 1, "proxied": proxied},
        ]
    elif target.get("target_kind") == "cname":
        desired = [
            {"type": "CNAME", "name": "zenari.ai", "content": target["target"], "ttl": 1, "proxied": proxied},
            {"type": "CNAME", "name": "www", "content": "zenari.ai", "ttl": 1, "proxied": proxied},
        ]
    else:
        raise ProductionDnsCutoverPlanError("production_dns_target_not_ready")

    for record in desired:
        list_response = cf_api(token, "GET", f"/zones/{zone_id}/dns_records?type={record['type']}&name={record['name']}")
        record_id = ""
        result_rows = list_response.get("result") if isinstance(list_response.get("result"), list) else []
        for item in result_rows:
            if isinstance(item, dict) and item.get("name") in {record["name"], f"{record['name']}.zenari.ai"}:
                record_id = str(item.get("id", ""))
                break
        if record_id:
            response = cf_api(token, "PUT", f"/zones/{zone_id}/dns_records/{record_id}", record)
            action = "updated"
        else:
            response = cf_api(token, "POST", f"/zones/{zone_id}/dns_records", record)
            action = "created"
        rows.append(
            {
                "host": record["name"],
                "type": record["type"],
                "action": action,
                "success": response.get("success") is True,
                "error_count": len(response.get("errors", [])) if isinstance(response.get("errors"), list) else 0,
            }
        )
    return rows


def build_plan(args: argparse.Namespace) -> tuple[dict[str, Any], int]:
    env = read_env_file(args.env)
    zone_id = env_value(env, "CLOUDFLARE_ZONE_ID") or env_value(env, "CF_ZONE_ID")
    token = env_value(env, "CLOUDFLARE_API_TOKEN") or env_value(env, "CF_API_TOKEN")
    raw_target = args.target or env_value(env, "PRODUCTION_DNS_TARGET")
    target = classify_target(raw_target)
    scope = credential_scope(env, zone_id, token)
    if not raw_target:
        staging_host = env_value(env, "STAGING_PUBLIC_HOST")
        if staging_host:
            target["staging_control_candidate"] = "present_but_not_used"
            target["target_hint"] = "set PRODUCTION_DNS_TARGET explicitly; staging host is only a control probe"
    readiness = load_json(args.dns_readiness)
    current_records = {
        "apex_a": run_dig("zenari.ai", "A"),
        "apex_aaaa": run_dig("zenari.ai", "AAAA"),
        "apex_cname": run_dig("zenari.ai", "CNAME"),
        "www_a": run_dig("www.zenari.ai", "A"),
        "www_cname": run_dig("www.zenari.ai", "CNAME"),
        "staging_a": run_dig("staging.zenari.ai", "A"),
    }
    manual_dns_observation = current_records_match_target(current_records, target)
    manual_dns_applied = manual_dns_observation.get("status") == "observed_applied"
    missing_credentials = []
    if not zone_id and not manual_dns_applied:
        missing_credentials.append("CLOUDFLARE_ZONE_ID_or_CF_ZONE_ID")
    if not token and not manual_dns_applied:
        missing_credentials.append("CLOUDFLARE_API_TOKEN_or_CF_API_TOKEN")
    cloudflare_scope_preflight = build_cloudflare_scope_preflight(zone_id, token, args.verify_cloudflare)
    origin_https_preflight = build_origin_https_preflight(target, bool(zone_id and token))
    blockers: list[str] = []
    if target.get("status") != "ready":
        blockers.append("PRODUCTION_DNS_TARGET_missing_or_invalid")
    if missing_credentials:
        blockers.extend(missing_credentials)
    if cloudflare_scope_preflight.get("status") == "blocked" and not manual_dns_applied:
        blockers.append("CLOUDFLARE_ZONE_DNS_SCOPE_PREFLIGHT_FAILED")
    if origin_https_preflight.get("status") == "blocked":
        blockers.append("PRODUCTION_DNS_TARGET_origin_https_preflight_failed")
    if args.apply and manual_dns_applied:
        blockers.append("apply_requested_after_dns_already_observed")
    if args.apply and blockers:
        blockers.append("apply_requested_without_required_inputs")

    apply_results: list[dict[str, Any]] = []
    if args.apply and not blockers:
        apply_results = apply_cloudflare_records(zone_id, token, target, args.proxied)
        if not all(item.get("success") is True for item in apply_results):
            blockers.append("cloudflare_dns_record_apply_failed")

    status = (
        "observed_applied"
        if manual_dns_applied and not args.apply and not blockers
        else ("applied" if args.apply and not blockers else ("ready_to_apply" if not blockers else "blocked"))
    )
    data: dict[str, Any] = {
        "schema_version": "stage1.production_dns_cutover_plan.v1",
        "environment": "production",
        "kind": "stage1_production_dns_cutover_plan",
        "status": status,
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "production_web_url": DEFAULT_PRODUCTION_WEB_URL,
        "non_clearing_cutover_plan": True,
        "canonical_pass_path": False,
        "can_clear_production_legal_support_policy": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "required_hosts": list(REQUIRED_HOSTS),
        "cloudflare_zone": {
            "zone_id_configured": bool(zone_id),
            "api_token_configured": bool(token),
            "proxied": args.proxied,
        },
        "credential_scope": scope,
        "cloudflare_scope_preflight": cloudflare_scope_preflight,
        "manual_dns_observation": manual_dns_observation,
        "target": target,
        "origin_https_preflight": origin_https_preflight,
        "current_records": current_records,
        "current_dns_readiness": {
            "path": display_path(args.dns_readiness),
            "status": readiness.get("status", "missing") if readiness else "missing",
            "first_blocker": (readiness.get("blocked_checks") or ["not reported"])[0] if isinstance(readiness.get("blocked_checks"), list) else "not reported",
        },
        "apply_results": apply_results,
        "blocked_checks": blockers,
        "operator_next_actions": [
            "Do not use Cloudflare R2 S3 access keys for DNS; they only prove object-storage access.",
            "Set CLOUDFLARE_ZONE_ID or CF_ZONE_ID for zenari.ai.",
            "Set CLOUDFLARE_API_TOKEN or CF_API_TOKEN with Zone DNS Edit permission.",
            "Set PRODUCTION_DNS_TARGET to the production web ingress IPv4 address or hostname.",
            "If zenari.ai and www.zenari.ai are already applied manually in Cloudflare UI, rerun this plan and confirm status observed_applied.",
            "Run with --verify-cloudflare to confirm the token can read the zone and DNS records before any DNS write.",
            "Confirm the target origin already serves zenari.ai and www.zenari.ai over HTTPS with matching SNI before applying DNS.",
            "Run this script without --apply first and confirm status ready_to_apply.",
            "Run with --apply, wait for DNS propagation, then rerun stage1_production_dns_readiness.py.",
            "Only after https://zenari.ai public legal/support paths pass should the legal/support source probe write canonical production source.",
        ],
        "evidence_outputs": {
            "cutover_plan": display_path(args.output),
            "dns_readiness": display_path(args.dns_readiness),
            "legal_support_operator_packet": "ops/evidence/non_clearing/production-legal-support-operator-packet.json",
        },
    }
    data.update(SAFE_FALSE_FIELDS)
    return data, 0 if status in {"ready_to_apply", "applied", "observed_applied"} else 2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--target", default="")
    parser.add_argument("--dns-readiness", type=Path, default=DEFAULT_DNS_READINESS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--proxied", action="store_true", default=True)
    parser.add_argument("--dns-only", dest="proxied", action="store_false")
    parser.add_argument("--verify-cloudflare", action="store_true", help="read-only Cloudflare zone/DNS scope preflight; never writes DNS")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if set(REQUIRED_HOSTS) != {"zenari.ai", "www.zenari.ai"}:
            raise SystemExit("production DNS cutover host contract mismatch")
        print("stage1 production DNS cutover plan contract passed")
        return 0
    try:
        plan, exit_code = build_plan(args)
        write_json(args.output, plan)
    except ProductionDnsCutoverPlanError as exc:
        print(f"stage1 production DNS cutover plan failed: {exc}", file=sys.stderr)
        return 1
    print(f"wrote Stage 1 production DNS cutover plan to {display_path(args.output)}")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
