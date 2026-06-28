#!/usr/bin/env python3
"""Probe Azure staging origin reachability without persisting credentials."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import socket
import ssl
import subprocess
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "staging" / "stage1-azure-origin-readiness.json"
DEFAULT_AZURE_IP = "52.237.80.117"
DEFAULT_STAGING_WEB_URL = "https://staging.zenari.ai"
DEFAULT_SSH_USER = "sansha"
DEFAULT_SSH_HARD_TIMEOUT_SECONDS = 20
NON_SECRET_ENV_KEYS = {
    "STAGING_SSH_HOST",
    "STAGING_SSH_USER",
    "STAGING_SSH_TARGET",
    "STAGING_SSH_KEY",
    "STAGING_WEB_URL",
    "STAGING_PUBLIC_HOST",
}
SECRET_PRESENCE_ENV_KEYS = {"STAGING_SSH_PASSWORD"}
AZURE_ORIGIN_REPAIR_COMMANDS = [
    "open ops/evidence/staging/azure-run-command-operator-card.md",
    "scripts/azure_staging_run_command_payload.sh",
    "python3 scripts/ingest_azure_run_command_output.py",
    "python3 scripts/sanitize_azure_run_command_output.py --output ops/evidence/staging/azure-run-command-ssh-repair.output.txt --require-marker",
    "python3 scripts/classify_azure_run_command_output.py --input ops/evidence/staging/azure-run-command-ssh-repair.output.txt --output ops/evidence/staging/azure-run-command-ssh-repair-diagnosis.json || test $? -eq 2",
    "scripts/azure_staging_cli_preflight.sh",
    "RUN_AZURE_STAGING_RUN_COMMAND=1 scripts/azure_staging_run_command_invoke.sh",
    "scripts/azure_staging_password_key_repair.sh",
    "scripts/azure_staging_ssh_preflight.sh",
    "scripts/azure_staging_bootstrap.sh",
    "scripts/azure_staging_deploy.sh",
    "scripts/azure_staging_origin_repair.sh",
    "python3 scripts/stage1_azure_origin_readiness.py --env .env --output ops/evidence/staging/stage1-azure-origin-readiness.json || test $? -eq 2",
]
AZURE_CLI_PREFLIGHT_REASONS = {
    "env_vm_found",
    "env_vm_not_found",
    "az_cli_missing",
    "az_not_logged_in",
    "vm_ip_discovery_failed",
    "vm_found_by_public_ip",
    "vm_not_found_by_public_ip",
    "az_cli_preflight_timeout",
    "az_cli_preflight_unparseable",
}
SAFE_FALSE_FIELDS = {
    "secret_material_persisted": False,
    "raw_prompt_persisted": False,
    "raw_provider_payload_persisted": False,
    "raw_stripe_payload_persisted": False,
    "raw_support_body_projected": False,
    "signed_url_persisted": False,
    "authorization_header_persisted": False,
    "cookie_persisted": False,
    "password_persisted": False,
}
SECRET_FIELD_NAMES = {
    "authorization",
    "cookie",
    "set-cookie",
    "secret",
    "secret_key",
    "api_key",
    "password",
    "ssh_password",
    "private_key",
    "token",
    "raw_response",
    "raw_payload",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|X-Amz-Signature|GoogleAccessId)"
)


class AzureOriginReadinessError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def parse_env_file(path: Path | None) -> dict[str, str]:
    if path is None or not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key not in NON_SECRET_ENV_KEYS:
            continue
        try:
            parsed = shlex.split(value, comments=False, posix=True)
            value = parsed[0] if parsed else ""
        except ValueError:
            value = value.strip().strip('"').strip("'")
        value = value.strip()
        if value:
            values[key] = value
    return values


def env_key_present(path: Path | None, key: str) -> bool:
    if path is None or not path.exists():
        return False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        env_key = line.split("=", 1)[0].strip()
        if env_key == key:
            return True
    return False


def https_url_from_host(value: str) -> str:
    if value.startswith(("http://", "https://")):
        return value.rstrip("/")
    return f"https://{value.strip('/')}"


def apply_env_defaults(args: argparse.Namespace) -> argparse.Namespace:
    env = parse_env_file(args.env_file)
    target = env.get("STAGING_SSH_TARGET", "")
    target_user = target.split("@", 1)[0] if "@" in target else ""
    target_host = target.split("@", 1)[1] if "@" in target else ""
    args.azure_ip = args.azure_ip or env.get("STAGING_SSH_HOST") or target_host or DEFAULT_AZURE_IP
    args.ssh_user = args.ssh_user or env.get("STAGING_SSH_USER") or target_user or DEFAULT_SSH_USER
    args.ssh_key = args.ssh_key or env.get("STAGING_SSH_KEY") or str(Path.home() / ".ssh" / "id_ed25519_machine_login")
    if args.staging_web_url:
        args.staging_web_url = args.staging_web_url.rstrip("/")
    elif env.get("STAGING_WEB_URL"):
        args.staging_web_url = env["STAGING_WEB_URL"].rstrip("/")
    elif env.get("STAGING_PUBLIC_HOST"):
        args.staging_web_url = https_url_from_host(env["STAGING_PUBLIC_HOST"])
    else:
        args.staging_web_url = DEFAULT_STAGING_WEB_URL
    return args


def require_active_azure_ip(value: str) -> None:
    if value != DEFAULT_AZURE_IP:
        raise AzureOriginReadinessError(
            f"Azure staging origin probe must use active IP {DEFAULT_AZURE_IP}; got {value}"
        )


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise AzureOriginReadinessError(f"{path}.{key} exposes secret/raw credential field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise AzureOriginReadinessError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "azure_origin_readiness")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def host_for(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    return parsed.hostname or ""


def tcp_probe(host: str, port: int, timeout: float) -> dict[str, Any]:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        try:
            sock.connect((host, port))
        except OSError as exc:
            return {
                "host": host,
                "port": port,
                "status": "blocked",
                "error_summary": f"{type(exc).__name__}: {str(exc)[:180]}",
            }
    return {"host": host, "port": port, "status": "pass", "error_summary": ""}


def resolve_host(host: str) -> dict[str, Any]:
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        return {
            "host": host,
            "status": "blocked",
            "addresses": [],
            "error_summary": f"{type(exc).__name__}: {str(exc)[:180]}",
        }
    addresses = sorted({item[4][0] for item in infos})
    return {
        "host": host,
        "status": "pass" if addresses else "blocked",
        "addresses": addresses,
        "error_summary": "" if addresses else "no addresses returned",
    }


def http_probe(url: str, method: str, timeout: float) -> dict[str, Any]:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or ""
    scheme = parsed.scheme.lower()
    port = parsed.port or (443 if scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    base = {
        "url": url,
        "method": method,
        "http_status": None,
        "final_url_host": host,
        "body_sample_present": False,
        "response_bytes": 0,
    }
    if scheme not in {"http", "https"} or not host:
        return {
            **base,
            "status": "blocked",
            "network_phase": "parse_url",
            "failure_category": "unsupported_url",
            "error_summary": "unsupported or missing URL scheme/host",
        }

    sock: socket.socket | ssl.SSLSocket | None = None
    phase = "tcp_connect"
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        sock.settimeout(timeout)
        phase = "tcp_connected"
    except TimeoutError as exc:
        return {
            **base,
            "status": "blocked",
            "network_phase": phase,
            "failure_category": "tcp_connect_timeout",
            "error_summary": f"{type(exc).__name__}: {str(exc)[:180]}",
        }
    except OSError as exc:
        return {
            **base,
            "status": "blocked",
            "network_phase": phase,
            "failure_category": "tcp_connect_failed",
            "error_summary": f"{type(exc).__name__}: {str(exc)[:180]}",
        }

    try:
        if scheme == "https":
            phase = "tls_clienthello_sent"
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=host)
            phase = "tls_established"
        request = (
            f"{method} {path} HTTP/1.1\r\n"
            f"Host: {host}\r\n"
            "User-Agent: zenari-stage1-azure-origin-readiness/1.0\r\n"
            "Accept: */*\r\n"
            "Connection: close\r\n\r\n"
        ).encode("ascii", "replace")
        sock.sendall(request)
        phase = "http_request_sent"
        chunks: list[bytes] = []
        while sum(len(chunk) for chunk in chunks) < 4096:
            chunk = sock.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
            if b"\r\n\r\n" in b"".join(chunks):
                break
        data = b"".join(chunks)
        if not data:
            failure = "https_no_bytes_after_tls" if scheme == "https" else "http_no_bytes_after_request"
            return {
                **base,
                "status": "blocked",
                "network_phase": phase,
                "failure_category": failure,
                "error_summary": "request sent but origin returned zero bytes before timeout or close",
            }
        first_line = data.splitlines()[0].decode("iso-8859-1", "replace") if data.splitlines() else ""
        match = re.match(r"HTTP/\S+\s+(\d{3})\b", first_line)
        http_status = int(match.group(1)) if match else None
        body = data.split(b"\r\n\r\n", 1)[1] if b"\r\n\r\n" in data else b""
        return {
            **base,
            "status": "pass" if http_status is not None and http_status < 500 else "blocked",
            "http_status": http_status,
            "body_sample_present": bool(method == "GET" and body.strip()),
            "response_bytes": len(data),
            "network_phase": "http_response_started",
            "failure_category": "none" if http_status is not None else "invalid_http_response",
            "error_summary": "" if http_status is not None else "origin response did not start with HTTP status line",
        }
    except TimeoutError as exc:
        if phase == "tls_clienthello_sent":
            failure = "tls_serverhello_timeout"
        elif phase == "http_request_sent":
            failure = "https_no_bytes_after_tls" if scheme == "https" else "http_no_bytes_after_request"
        else:
            failure = "origin_timeout"
        return {
            **base,
            "status": "blocked",
            "network_phase": phase,
            "failure_category": failure,
            "error_summary": f"{type(exc).__name__}: {str(exc)[:180]}",
        }
    except ssl.SSLCertVerificationError as exc:
        return {
            **base,
            "status": "blocked",
            "network_phase": phase,
            "failure_category": "tls_certificate_error",
            "error_summary": f"{type(exc).__name__}: {str(exc)[:180]}",
        }
    except ssl.SSLError as exc:
        return {
            **base,
            "status": "blocked",
            "network_phase": phase,
            "failure_category": "tls_error",
            "error_summary": f"{type(exc).__name__}: {str(exc)[:180]}",
        }
    except OSError as exc:
        return {
            **base,
            "status": "blocked",
            "network_phase": phase,
            "failure_category": "origin_io_error",
            "error_summary": f"{type(exc).__name__}: {str(exc)[:180]}",
        }
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


def ssh_key_preflight(user: str, host: str, ssh_key: str, timeout: int, hard_timeout: int) -> dict[str, Any]:
    target = f"{user}@{host}"
    command = [
        "ssh",
        "-i",
        ssh_key,
        "-o",
        "BatchMode=yes",
        "-o",
        f"ConnectTimeout={timeout}",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "IdentitiesOnly=yes",
        target,
        "printf ssh-auth-ok",
    ]
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=hard_timeout,
        )
    except subprocess.TimeoutExpired as exc:
        output = ((exc.stderr or "") if isinstance(exc.stderr, str) else "") or ((exc.stdout or "") if isinstance(exc.stdout, str) else "")
        return {
            "target_user": user,
            "target_host": host,
            "status": "blocked",
            "exit_code": 124,
            "auth_method": "publickey_batchmode_only",
            "ssh_key_path": ssh_key,
            "reason": "ssh_auth_hard_timeout",
            "error_summary": (output.strip() or f"ssh command exceeded hard timeout after {hard_timeout}s")[:240],
            "password_attempted": False,
            "hard_timeout_seconds": hard_timeout,
        }
    output = (result.stderr or result.stdout).strip()
    if result.returncode == 0:
        status = "pass"
        reason = "ssh_key_auth_ok"
    elif "Permission denied" in output:
        status = "blocked"
        reason = "ssh_key_auth_permission_denied"
    elif "not responding" in output:
        status = "blocked"
        reason = "ssh_server_not_responding"
    elif "Connection timed out" in output or "Operation timed out" in output:
        status = "blocked"
        reason = "ssh_connect_timeout"
    else:
        status = "blocked"
        reason = "ssh_key_auth_failed"
    return {
        "target_user": user,
        "target_host": host,
        "status": status,
        "exit_code": result.returncode,
        "auth_method": "publickey_batchmode_only",
        "ssh_key_path": ssh_key,
        "reason": reason,
        "error_summary": output[:240],
        "password_attempted": False,
        "hard_timeout_seconds": hard_timeout,
    }


def azure_cli_preflight(timeout: int) -> dict[str, Any]:
    command = ["scripts/azure_staging_cli_preflight.sh", "--json"]
    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        output = ((exc.stderr or "") if isinstance(exc.stderr, str) else "") or ((exc.stdout or "") if isinstance(exc.stdout, str) else "")
        return {
            "status": "blocked",
            "reason": "az_cli_preflight_timeout",
            "subscription_id": "",
            "resource_group": "",
            "vm_name": "",
            "azure_ip": DEFAULT_AZURE_IP,
            "exit_code": 124,
            "error_summary": (output.strip() or f"Azure CLI preflight exceeded timeout after {timeout}s")[:240],
        }
    output = (result.stdout or "").strip()
    try:
        parsed = json.loads(output) if output else {}
    except json.JSONDecodeError:
        parsed = {}
    raw_status = str(parsed.get("status") or "blocked")
    status = "pass" if raw_status in {"pass", "ready"} else "blocked"
    reason = str(parsed.get("reason") or "az_cli_preflight_unparseable")
    error_summary = (result.stderr or "").strip()
    if status == "blocked" and not error_summary:
        error_summary = f"Azure CLI preflight blocked: {reason}"
    return {
        "status": status,
        "reason": reason,
        "subscription_id": str(parsed.get("subscription_id") or ""),
        "resource_group": str(parsed.get("resource_group") or ""),
        "vm_name": str(parsed.get("vm_name") or ""),
        "azure_ip": str(parsed.get("azure_ip") or DEFAULT_AZURE_IP),
        "exit_code": result.returncode,
        "error_summary": error_summary[:240],
    }


def operator_next_actions_for_ssh_reason(reason: str) -> list[str]:
    if reason in {"ssh_connect_timeout", "ssh_server_not_responding", "ssh_auth_hard_timeout"}:
        return [
            "Open ops/evidence/staging/azure-run-command-operator-card.md for the short Azure Portal Run Command checklist.",
            "Run scripts/azure_staging_run_command_payload.sh to generate a paste-ready Azure Portal Run Command payload with sshd diagnostics and public-key repair.",
            "Use Azure Portal Run Command or Serial Console to check sshd health, VM resource pressure, NSG/firewall rules, and system logs before retrying SSH key auth.",
            "Pipe or paste the Azure Run Command output through python3 scripts/ingest_azure_run_command_output.py to sanitize, classify, and refresh readiness/next-blockers evidence.",
            "After sshd responds to a publickey preflight, set STAGING_SSH_PASSWORD only in the gitignored local .env if password-to-key repair is still required.",
            "Run scripts/azure_staging_ssh_preflight.sh again; only run scripts/azure_staging_password_key_repair.sh when the VM accepts SSH/password auth without persisting the password.",
        ]
    return [
        "Set STAGING_SSH_PASSWORD only in the gitignored local .env, then run scripts/azure_staging_password_key_repair.sh to restore SSH key access without persisting the password.",
        "Run scripts/azure_staging_ssh_preflight.sh again after the key repair to verify passwordless SSH and sudo before touching origin services.",
    ]


def build_transport_diagnosis(
    tcp_results: list[dict[str, Any]],
    http_results: list[dict[str, Any]],
    ssh_result: dict[str, Any],
    cli_result: dict[str, Any],
) -> dict[str, Any]:
    tcp_22_reachable = any(row.get("port") == 22 and row.get("status") == "pass" for row in tcp_results)
    tcp_80_reachable = any(row.get("port") == 80 and row.get("status") == "pass" for row in tcp_results)
    tcp_443_reachable = any(row.get("port") == 443 and row.get("status") == "pass" for row in tcp_results)
    entry_ports_reachable = tcp_22_reachable and tcp_80_reachable and tcp_443_reachable

    ssh_reason = str(ssh_result.get("reason") or "ssh_key_auth_failed")
    ssh_error = str(ssh_result.get("error_summary") or "")
    ssh_error_lower = ssh_error.lower()
    ssh_timed_out_before_auth = ssh_reason in {"ssh_connect_timeout", "ssh_auth_hard_timeout"}
    ssh_banner_timeout = ssh_timed_out_before_auth and "banner exchange" in ssh_error_lower
    ssh_auth_reached = ssh_reason in {"ssh_key_auth_ok", "ssh_key_auth_permission_denied"}
    ssh_banner_received = ssh_auth_reached or ssh_reason == "ssh_server_not_responding"
    if ssh_banner_timeout:
        ssh_transport_phase = "banner_exchange_timeout"
    elif ssh_timed_out_before_auth:
        ssh_transport_phase = "transport_timeout_before_auth"
    elif ssh_auth_reached:
        ssh_transport_phase = "auth_reached"
    elif ssh_reason == "ssh_server_not_responding":
        ssh_transport_phase = "post_auth_or_keepalive_timeout"
    else:
        ssh_transport_phase = "auth_or_transport_failed"

    http_request_sent = any(
        row.get("network_phase") in {"http_request_sent", "http_response_started"} for row in http_results
    )
    http_response_started = any(row.get("network_phase") == "http_response_started" for row in http_results)
    http_zero_bytes_after_request = any(
        row.get("failure_category") in {"http_no_bytes_after_request", "https_no_bytes_after_tls"}
        for row in http_results
    )
    tls_serverhello_timeout = any(row.get("failure_category") == "tls_serverhello_timeout" for row in http_results)
    any_http_pass = any(row.get("status") == "pass" for row in http_results)

    blocked_reasons: list[str] = []
    if not entry_ports_reachable:
        blocked_reasons.append("tcp_entry_ports_not_all_reachable")
    if ssh_banner_timeout:
        blocked_reasons.append("ssh_banner_timeout_before_auth")
    elif ssh_timed_out_before_auth:
        blocked_reasons.append("ssh_transport_timeout_before_auth")
    elif ssh_result.get("status") != "pass":
        blocked_reasons.append("ssh_auth_not_ok")
    if tls_serverhello_timeout:
        blocked_reasons.append("tls_serverhello_timeout")
    if http_zero_bytes_after_request:
        blocked_reasons.append("http_zero_bytes_after_request")
    if not any_http_pass:
        blocked_reasons.append("http_response_not_started")
    if cli_result.get("reason") == "az_cli_missing":
        blocked_reasons.append("local_azure_cli_missing")

    protocol_services_unresponsive = entry_ports_reachable and not ssh_banner_received and not http_response_started
    if protocol_services_unresponsive:
        lane = "vm_protocol_services_unresponsive"
        next_action = "azure_portal_run_command_or_serial_console"
        operator_summary = (
            "TCP entry ports 22/80/443 accept connections, but SSH does not return a banner "
            "and HTTP/TLS probes do not produce usable origin responses; repair must run inside the Azure VM."
        )
    elif not entry_ports_reachable:
        lane = "azure_network_access"
        next_action = "inspect_azure_nsg_firewall_and_public_ip"
        operator_summary = "One or more Azure entry TCP ports are not reachable from this runner."
    elif ssh_result.get("status") != "pass":
        lane = "ssh_transport_or_auth"
        next_action = "repair_ssh_auth_or_sshd"
        operator_summary = "SSH is reachable at TCP level but not yet usable for staging deploy automation."
    elif not any_http_pass:
        lane = "origin_runtime"
        next_action = "repair_origin_services_after_ssh"
        operator_summary = "SSH is usable, but HTTP/HTTPS origin probes still do not return a successful response."
    else:
        lane = "origin_probe_non_clearing_pass"
        next_action = "continue_strict_staging_runtime_evidence"
        operator_summary = "Azure origin probes returned at least one usable HTTP response; strict staging gates still require canonical evidence."

    return {
        "status": "pass" if not blocked_reasons else "blocked",
        "lane": lane,
        "next_action": next_action,
        "operator_summary": operator_summary,
        "blocked_reasons": blocked_reasons,
        "tcp_entry_ports_reachable": entry_ports_reachable,
        "tcp_22_reachable": tcp_22_reachable,
        "tcp_80_reachable": tcp_80_reachable,
        "tcp_443_reachable": tcp_443_reachable,
        "ssh_transport_phase": ssh_transport_phase,
        "ssh_banner_received": ssh_banner_received,
        "ssh_auth_reached": ssh_auth_reached,
        "ssh_password_key_repair_viable": ssh_banner_received,
        "http_request_sent": http_request_sent,
        "http_response_started": http_response_started,
        "http_zero_bytes_after_request": http_zero_bytes_after_request,
        "tls_serverhello_timeout": tls_serverhello_timeout,
        "azure_portal_run_command_required": protocol_services_unresponsive or not ssh_banner_received,
    }


def build_report(args: argparse.Namespace) -> dict[str, Any]:
    staging_host = host_for(args.staging_web_url)
    tcp_ports = [int(port) for port in args.tcp_ports.split(",") if port.strip()]
    tcp_results = [tcp_probe(args.azure_ip, port, args.timeout) for port in tcp_ports]
    dns_result = resolve_host(staging_host)
    http_urls = [
        f"http://{args.azure_ip}/",
        f"https://{args.azure_ip}/",
        args.staging_web_url.rstrip("/") + "/",
    ]
    http_results = [http_probe(url, method, args.timeout) for url in http_urls for method in ("HEAD", "GET")]
    ssh_result = ssh_key_preflight(args.ssh_user, args.azure_ip, args.ssh_key, int(args.timeout), int(args.ssh_hard_timeout))
    cli_result = azure_cli_preflight(int(args.timeout))
    transport_diagnosis = build_transport_diagnosis(tcp_results, http_results, ssh_result, cli_result)
    local_repair_password_configured = env_key_present(args.env_file, "STAGING_SSH_PASSWORD")

    blockers: list[str] = []
    if not any(row.get("status") == "pass" and row.get("port") == 22 for row in tcp_results):
        blockers.append("azure_tcp_22_unreachable")
    if not any(row.get("status") == "pass" and row.get("port") in {80, 443} for row in tcp_results):
        blockers.append("azure_tcp_80_443_unreachable")
    if not any(row.get("status") == "pass" for row in http_results):
        blockers.append("azure_origin_http_no_successful_response")
    if dns_result.get("status") != "pass":
        blockers.append("staging_domain_dns_unresolved")
    if ssh_result.get("status") != "pass":
        blockers.append(str(ssh_result.get("reason", "ssh_key_auth_failed")))

    operator_next_actions = [
        *operator_next_actions_for_ssh_reason(str(ssh_result.get("reason", ""))),
        "Run scripts/azure_staging_origin_repair.sh after SSH works to restart compose, remove legacy manager containers, configure Caddy, and refresh Azure origin readiness evidence.",
        "Run scripts/azure_staging_origin_diagnostics.sh to inspect compose services, 80/443 listeners, Caddy, and local backend/web/admin origin probes.",
        "Do not use this staging origin probe to clear production zenari.ai DNS or production launch gates.",
    ]

    data: dict[str, Any] = {
        "schema_version": "stage1.azure_origin_readiness.v1",
        "kind": "stage1_azure_origin_readiness",
        "environment": "staging",
        "status": "pass" if not blockers else "blocked",
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "azure_ip": args.azure_ip,
        "staging_web_url": args.staging_web_url.rstrip("/"),
        "staging_host": staging_host,
        "non_clearing_origin_probe": True,
        "canonical_pass_path": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "can_close_do_not_launch": False,
        "tcp_ports": tcp_results,
        "staging_dns": dns_result,
        "http_probes": http_results,
        "ssh_key_preflight": ssh_result,
        "azure_cli_preflight": cli_result,
        "transport_diagnosis": transport_diagnosis,
        "blocked_checks": blockers,
        "ssh_hard_timeout_seconds": args.ssh_hard_timeout,
        "local_repair_password_env_key": "STAGING_SSH_PASSWORD",
        "local_repair_password_configured": local_repair_password_configured,
        "local_repair_password_required": True,
        "origin_repair_commands": AZURE_ORIGIN_REPAIR_COMMANDS,
        "origin_diagnostics_command": "scripts/azure_staging_origin_diagnostics.sh",
        "origin_repair_command": "scripts/azure_staging_origin_repair.sh",
        "operator_next_actions": operator_next_actions,
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env", dest="env_file", type=Path, help="Optional .env file for non-secret staging host/user/url defaults.")
    parser.add_argument("--azure-ip")
    parser.add_argument("--staging-web-url")
    parser.add_argument("--ssh-user")
    parser.add_argument("--ssh-key")
    parser.add_argument("--tcp-ports", default="22,80,443")
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--ssh-hard-timeout", type=int, default=DEFAULT_SSH_HARD_TIMEOUT_SECONDS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = apply_env_defaults(parse_args())
    if args.contract_only:
        if DEFAULT_AZURE_IP != "52.237.80.117":
            raise SystemExit("azure origin default IP contract mismatch")
        if not DEFAULT_STAGING_WEB_URL.startswith("https://"):
            raise SystemExit("staging web URL must be HTTPS")
        print("stage1 azure origin readiness contract passed")
        return 0
    try:
        require_active_azure_ip(args.azure_ip)
    except AzureOriginReadinessError as exc:
        raise SystemExit(str(exc)) from exc
    report = build_report(args)
    write_json(args.output, report)
    print(f"wrote Stage 1 Azure origin readiness to {display_path(args.output)}")
    return 0 if report["status"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
