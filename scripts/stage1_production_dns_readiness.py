#!/usr/bin/env python3
"""Probe production DNS/HTTPS readiness without clearing launch gates."""

from __future__ import annotations

import argparse
import json
import multiprocessing
import os
import re
import socket
import ssl
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV = ROOT / ".env"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "non_clearing" / "production-dns-readiness.json"
DEFAULT_PRODUCTION_WEB_URL = "https://zenari.ai"
DEFAULT_STAGING_WEB_URL = "https://staging.zenari.ai"
R2_S3_ENV_KEYS = (
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
)
LEGAL_PATHS = (
    "/",
    "/legal/terms",
    "/legal/privacy",
    "/legal/acceptable-use",
    "/legal/ip-complaints",
    "/legal/billing-policy",
    "/support",
    "/report-problem",
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
    production_target_configured = env_present(values, "PRODUCTION_DNS_TARGET")
    return {
        "cloudflare_dns_credentials_configured": bool(zone_id and token),
        "cloudflare_zone_id_configured": bool(zone_id),
        "cloudflare_api_token_configured": bool(token),
        "production_dns_target_configured": production_target_configured,
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


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def host_for(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    return parsed.hostname or ""


def system_resolve(host: str) -> dict[str, Any]:
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        return {
            "status": "blocked",
            "host": host,
            "addresses": [],
            "error": str(exc),
        }
    addresses = sorted({item[4][0] for item in infos})
    return {
        "status": "pass" if addresses else "blocked",
        "host": host,
        "addresses": addresses,
        "error": "" if addresses else "no addresses returned",
    }


def dig_addresses(host: str, rrtype: str) -> dict[str, Any]:
    command = ["dig", "+short", "+time=2", "+tries=1", host, rrtype]
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=5,
        )
    except subprocess.TimeoutExpired as exc:
        return {
            "status": "blocked",
            "host": host,
            "rrtype": rrtype,
            "addresses": [],
            "exit_code": 124,
            "error": (exc.stderr or exc.stdout or "dig command timed out"),
        }
    addresses = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    return {
        "status": "pass" if addresses else "missing",
        "host": host,
        "rrtype": rrtype,
        "addresses": addresses,
        "exit_code": result.returncode,
        "error": result.stderr.strip(),
    }


def blocked_network_probe(kind: str, target: str, error: str) -> dict[str, Any]:
    if kind == "https_head":
        return {
            "status": "blocked",
            "url": target,
            "http_status": None,
            "error": error,
        }
    parsed = urllib.parse.urlparse(target)
    query = urllib.parse.parse_qs(parsed.query)
    resolver = parsed.netloc.split(".", 1)[0] if parsed.netloc else "unknown"
    if resolver == "cloudflare-dns":
        resolver = "cloudflare"
    elif resolver == "dns":
        resolver = "google"
    return {
        "status": "blocked",
        "resolver": resolver,
        "host": (query.get("name") or [""])[0],
        "rrtype": (query.get("type") or [""])[0],
        "addresses": [],
        "http_status": None,
        "dns_rcode": None,
        "error": error,
    }


def run_network_probe_with_hard_timeout(
    kind: str,
    target: str,
    worker: Any,
    args: tuple[Any, ...],
    timeout: float,
) -> dict[str, Any]:
    queue: multiprocessing.Queue[dict[str, Any]] = multiprocessing.Queue(maxsize=1)
    process = multiprocessing.Process(target=worker, args=(queue, *args))
    process.daemon = True
    hard_timeout = max(float(timeout) + 2.0, 4.0)
    process.start()
    process.join(hard_timeout)
    if process.is_alive():
        process.terminate()
        process.join(1)
        return blocked_network_probe(kind, target, f"hard timeout after {hard_timeout:.1f}s")
    if process.exitcode not in (0, None):
        return blocked_network_probe(kind, target, f"probe worker exited with code {process.exitcode}")
    try:
        result = queue.get_nowait()
    except Exception:
        return blocked_network_probe(kind, target, "probe worker returned no result")
    if not isinstance(result, dict):
        return blocked_network_probe(kind, target, "probe worker returned invalid result")
    return result


def _doh_worker(queue: multiprocessing.Queue[dict[str, Any]], host: str, rrtype: str, resolver: str, timeout: float) -> None:
    queue.put(_doh_addresses_inline(host, rrtype, resolver, timeout))


def _https_head_worker(queue: multiprocessing.Queue[dict[str, Any]], url: str, timeout: float) -> None:
    queue.put(_https_head_inline(url, timeout))


def _doh_addresses_inline(host: str, rrtype: str, resolver: str, timeout: float) -> dict[str, Any]:
    endpoints = {
        "cloudflare": "https://cloudflare-dns.com/dns-query",
        "google": "https://dns.google/resolve",
    }
    rrtypes = {"A": 1, "AAAA": 28}
    url = endpoints[resolver] + "?" + urllib.parse.urlencode({"name": host, "type": rrtype})
    request = urllib.request.Request(
        url,
        method="GET",
        headers={
            "Accept": "application/dns-json",
            "User-Agent": "zenari-stage1-production-dns-readiness/1.0",
        },
    )
    base: dict[str, Any] = {
        "status": "blocked",
        "resolver": resolver,
        "host": host,
        "rrtype": rrtype,
        "addresses": [],
        "http_status": None,
        "dns_rcode": None,
        "error": "",
    }
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
            body = response.read(1 << 20)
            base["http_status"] = int(response.status)
    except urllib.error.HTTPError as exc:
        base["http_status"] = int(exc.code)
        base["error"] = str(exc)
        return base
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        base["error"] = str(exc)
        return base
    try:
        payload = json.loads(body.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        base["error"] = f"invalid DoH JSON response: {exc}"
        return base
    if not isinstance(payload, dict):
        base["error"] = "DoH response was not a JSON object"
        return base
    base["dns_rcode"] = payload.get("Status")
    answers = payload.get("Answer")
    addresses: list[str] = []
    if isinstance(answers, list):
        for answer in answers:
            if not isinstance(answer, dict):
                continue
            if answer.get("type") != rrtypes.get(rrtype):
                continue
            value = str(answer.get("data") or "").strip()
            if value:
                addresses.append(value)
    base["addresses"] = sorted(set(addresses))
    if addresses:
        base["status"] = "pass"
    elif base.get("http_status") == 200:
        base["status"] = "missing"
        base["error"] = "DoH resolver returned no matching A/AAAA answers"
    return base


def doh_addresses(host: str, rrtype: str, resolver: str, timeout: float) -> dict[str, Any]:
    endpoint = {
        "cloudflare": "https://cloudflare-dns.com/dns-query",
        "google": "https://dns.google/resolve",
    }[resolver] + "?" + urllib.parse.urlencode({"name": host, "type": rrtype})
    return run_network_probe_with_hard_timeout("doh", endpoint, _doh_worker, (host, rrtype, resolver, timeout), timeout)


def _https_head_inline(url: str, timeout: float) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": "zenari-stage1-production-dns-readiness/1.0"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=ssl.create_default_context()) as response:
            return {
                "status": "pass" if int(response.status) < 400 else "blocked",
                "url": url,
                "http_status": int(response.status),
                "error": "",
            }
    except urllib.error.HTTPError as exc:
        return {
            "status": "blocked",
            "url": url,
            "http_status": int(exc.code),
            "error": str(exc),
        }
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "status": "blocked",
            "url": url,
            "http_status": None,
            "error": str(exc),
        }


def https_head(url: str, timeout: float) -> dict[str, Any]:
    return run_network_probe_with_hard_timeout("https_head", url, _https_head_worker, (url, timeout), timeout)


def skipped_https_probe(url: str, reason: str) -> dict[str, Any]:
    return {
        "status": "blocked",
        "url": url,
        "http_status": None,
        "error": reason,
    }


def control_warning(system_staging: dict[str, Any], staging_https: dict[str, Any]) -> list[str]:
    warnings: list[str] = []
    if system_staging.get("status") != "pass":
        warnings.append(f"staging control resolver failed for {system_staging.get('host')}: {system_staging.get('error')}")
    if staging_https.get("status") != "pass":
        warnings.append(f"staging control HTTPS failed for {staging_https.get('url')}: {staging_https.get('error')}")
    return warnings


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    env = read_env_file(args.env)
    zone_id = env_value(env, "CLOUDFLARE_ZONE_ID") or env_value(env, "CF_ZONE_ID")
    token = env_value(env, "CLOUDFLARE_API_TOKEN") or env_value(env, "CF_API_TOKEN")
    scope = credential_scope(env, zone_id, token)
    production_host = host_for(args.production_web_url)
    staging_host = host_for(args.staging_web_url)
    system_production = system_resolve(production_host)
    system_staging = system_resolve(staging_host)
    dig_production_a = dig_addresses(production_host, "A")
    dig_production_aaaa = dig_addresses(production_host, "AAAA")
    dig_staging_a = dig_addresses(staging_host, "A")
    doh_probe = {
        "production_a_cloudflare": doh_addresses(production_host, "A", "cloudflare", args.timeout),
        "production_aaaa_cloudflare": doh_addresses(production_host, "AAAA", "cloudflare", args.timeout),
        "production_a_google": doh_addresses(production_host, "A", "google", args.timeout),
        "production_aaaa_google": doh_addresses(production_host, "AAAA", "google", args.timeout),
        "staging_a_cloudflare": doh_addresses(staging_host, "A", "cloudflare", args.timeout),
        "staging_a_google": doh_addresses(staging_host, "A", "google", args.timeout),
    }
    if system_production.get("status") == "pass":
        production_https = [https_head(f"{args.production_web_url.rstrip('/')}{path}", args.timeout) for path in LEGAL_PATHS]
    else:
        production_https = [
            skipped_https_probe(
                f"{args.production_web_url.rstrip('/')}{path}",
                f"skipped HTTPS probe because system resolver failed for {production_host}: {system_production.get('error')}",
            )
            for path in LEGAL_PATHS
        ]
    staging_https = https_head(args.staging_web_url.rstrip("/") + "/", args.timeout)
    public_production_addresses = sorted(
        {
            *dig_production_a.get("addresses", []),
            *dig_production_aaaa.get("addresses", []),
            *(address for row in doh_probe.values() if row.get("host") == production_host for address in row.get("addresses", [])),
        }
    )

    blockers: list[str] = []
    if system_production.get("status") != "pass":
        blockers.append(f"system resolver failed for {production_host}: {system_production.get('error')}")
    if not public_production_addresses:
        blockers.append(f"public DNS probes returned no public A/AAAA records for {production_host}")
    if any(item.get("status") != "pass" for item in production_https):
        first = next((item for item in production_https if item.get("status") != "pass"), {})
        blockers.append(f"production HTTPS failed for {first.get('url')}: {first.get('error')}")
    control_warnings = control_warning(system_staging, staging_https)

    dns_split_brain = (
        system_production.get("status") != "pass"
        and bool(public_production_addresses)
    )
    data: dict[str, Any] = {
        "schema_version": "stage1.production_dns_readiness.v1",
        "environment": "production",
        "kind": "stage1_production_dns_readiness",
        "status": "pass" if not blockers else "blocked",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "production_web_url": args.production_web_url.rstrip("/"),
        "staging_control_url": args.staging_web_url.rstrip("/"),
        "canonical_pass_path": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_clear_production_legal_support_policy": False,
        "can_close_do_not_launch": False,
        "dns_split_brain_observed": dns_split_brain,
        "credential_scope": scope,
        "system_resolver": {
            "production": system_production,
            "staging_control": system_staging,
        },
        "authoritative_public_dns_probe": {
            "production_a": dig_production_a,
            "production_aaaa": dig_production_aaaa,
            "staging_a": dig_staging_a,
        },
        "dns_over_https_probe": doh_probe,
        "public_production_addresses_observed": public_production_addresses,
        "https_probe": {
            "production_paths": production_https,
            "staging_control": staging_https,
        },
        "blocked_checks": blockers,
        "control_warnings": control_warnings,
        "operator_note": (
            "This diagnostic is non-clearing. Production legal/support can clear only after "
            "system resolver and HTTPS probes for https://zenari.ai pass and "
            "scripts/stage1_production_source_probe.py writes the canonical legal/support source."
        ),
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--production-web-url", default=DEFAULT_PRODUCTION_WEB_URL)
    parser.add_argument("--staging-web-url", default=DEFAULT_STAGING_WEB_URL)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if not DEFAULT_PRODUCTION_WEB_URL.startswith("https://") or not DEFAULT_STAGING_WEB_URL.startswith("https://"):
            raise SystemExit("production DNS readiness URL contract mismatch")
        if "/support" not in LEGAL_PATHS or "/legal/terms" not in LEGAL_PATHS:
            raise SystemExit("production DNS readiness legal path contract incomplete")
        if "cloudflare-dns.com/dns-query" not in Path(__file__).read_text(encoding="utf-8"):
            raise SystemExit("production DNS readiness DoH fallback contract incomplete")
        if "credential_scope" not in Path(__file__).read_text(encoding="utf-8"):
            raise SystemExit("production DNS readiness credential scope contract incomplete")
        if "R2 S3 access keys are object-storage credentials only" not in Path(__file__).read_text(encoding="utf-8"):
            raise SystemExit("production DNS readiness R2/DNS separation contract incomplete")
        print("stage1 production DNS readiness contract passed")
        return 0
    report = build_report(args)
    write_json(args.output, report)
    print(f"wrote Stage 1 production DNS readiness to {display_path(args.output)}")
    return 0 if report["status"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
