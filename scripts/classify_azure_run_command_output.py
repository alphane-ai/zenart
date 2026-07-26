#!/usr/bin/env python3
"""Classify Azure Run Command ssh-repair output without persisting raw logs."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair.output.txt"
DEFAULT_OUTPUT = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair-diagnosis.json"
SCHEMA_VERSION = "stage1.azure_run_command_ssh_repair_diagnosis.v1"
EXPECTED_MARKERS = (
    "zenari_azure_run_command_payload=ssh_repair_v1",
    "zenari_azure_run_command_payload=complete",
)
DIAGNOSTIC_SECTIONS = (
    "ssh_socket_status",
    "sshd_config_test_before",
    "sshd_config_test_after",
    "firewall_summary",
    "azure_agent_recent_logs",
    "cloud_init_recent_logs",
    "ssh_recent_logs",
    "listening_ssh",
    "listening_ssh_after",
    "origin_diagnostics_begin",
    "origin_diagnostics_end",
)
ORIGIN_LISTENER_MISSING_FINDINGS = {
    "80": "origin_listener_80_missing",
    "443": "origin_listener_443_missing",
}
ORIGIN_PROBE_BLOCKED_FINDINGS = {
    "local_backend_healthz": "local_backend_healthz_blocked",
    "local_backend_readyz": "local_backend_readyz_blocked",
    "local_web_root": "local_web_root_blocked",
    "local_admin_root": "local_admin_root_blocked",
    "local_caddy_healthz": "local_caddy_healthz_blocked",
    "local_caddy_root": "local_caddy_root_blocked",
}
ORIGIN_PROBE_SERVER_ERROR_FINDINGS = {
    "local_backend_healthz": "local_backend_healthz_server_error",
    "local_backend_readyz": "local_backend_readyz_server_error",
    "local_web_root": "local_web_root_server_error",
    "local_admin_root": "local_admin_root_server_error",
    "local_caddy_healthz": "local_caddy_healthz_server_error",
    "local_caddy_root": "local_caddy_root_server_error",
}
ORIGIN_RUNTIME_BLOCKING_FINDINGS = {
    "origin_docker_cli_missing",
    "origin_docker_compose_missing",
    "origin_release_dir_missing",
    "origin_compose_file_missing",
    "origin_legacy_manager_present",
    "origin_worker_crawler_backend_image_mismatch",
    "origin_compose_core_services_not_running",
    "origin_backend_service_not_running",
    "origin_web_service_not_running",
    "origin_admin_service_not_running",
    "origin_worker_service_not_running",
    "origin_crawler_service_not_running",
    "origin_backend_database_url_missing",
    "origin_caddy_missing",
    "origin_caddy_not_running",
    "origin_listener_80_missing",
    "origin_listener_443_missing",
    *ORIGIN_PROBE_BLOCKED_FINDINGS.values(),
    *ORIGIN_PROBE_SERVER_ERROR_FINDINGS.values(),
}
ORIGIN_CORE_PROBES = (
    "local_backend_healthz",
    "local_backend_readyz",
    "local_web_root",
    "local_admin_root",
    "local_caddy_healthz",
    "local_caddy_root",
)
SSH_REPAIR_BLOCKING_FINDINGS = {
    "payload_start_marker_missing",
    "payload_completion_marker_missing",
    "diagnostic_sections_missing",
    "sshd_config_invalid",
}
SAFE_FALSE_FIELDS = {
    "secret_material_persisted": False,
    "raw_run_command_output_persisted": False,
    "password_persisted": False,
    "private_key_persisted": False,
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
    "raw_output",
    "raw_run_command_output",
}
RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|postgres(?:ql)?://|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|X-Amz-Signature|GoogleAccessId)"
)


class AzureRunCommandDiagnosisError(Exception):
    pass


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def assert_no_secret(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).strip().lower()
            if normalized in SECRET_FIELD_NAMES:
                raise AzureRunCommandDiagnosisError(f"{path}.{key} exposes secret/raw credential field")
            assert_no_secret(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            assert_no_secret(child, f"{path}[{idx}]")
    elif isinstance(value, str) and RAW_SECRET_RE.search(value):
        raise AzureRunCommandDiagnosisError(f"{path} contains raw secret-looking material")


def write_json(path: Path, data: dict[str, Any]) -> None:
    assert_no_secret(data, "azure_run_command_diagnosis")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def text_has_any(text: str, patterns: tuple[str, ...]) -> bool:
    lowered = text.lower()
    return any(pattern in lowered for pattern in patterns)


def parse_origin_kv(text: str) -> dict[str, str]:
    if "origin_diagnostics_begin" not in text:
        return {}
    after_begin = text.split("origin_diagnostics_begin", 1)[1]
    block = after_begin.split("origin_diagnostics_end", 1)[0]
    values: dict[str, str] = {}
    allowed = re.compile(r"^[A-Za-z0-9_./:,-]+$")
    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not re.fullmatch(r"[A-Za-z0-9_]+", key):
            continue
        if not allowed.fullmatch(value):
            value = "redacted_or_unclassified"
        values[key] = value[:160]
    return values


def summarize_origin(values: dict[str, str]) -> tuple[list[str], list[str], dict[str, str]]:
    findings: list[str] = []
    recommended_actions: list[str] = []
    summary_keys = (
        "docker_cli",
        "docker_compose",
        "passwordless_sudo",
        "release_dir_present",
        "compose_file_present",
        "compose_services",
        "compose_service_backend",
        "compose_service_web",
        "compose_service_admin",
        "compose_service_worker",
        "compose_service_crawler",
        "compose_service_manager",
        "compose_service_postgres",
        "compose_service_backend_state",
        "compose_service_web_state",
        "compose_service_admin_state",
        "compose_service_worker_state",
        "compose_service_crawler_state",
        "compose_core_services_running",
        "worker_crawler_backend_image_match",
        "manager_absent",
        "caddy_container",
        "caddy_running",
        "origin_listener_80",
        "origin_listener_443",
        "origin_listener_31080",
        "origin_listener_26080",
        "origin_listener_26081",
        "origin_listener_5432",
        "origin_listener_26432",
        "origin_postgres_container",
        "backend_database_url_present",
        "backend_database_host_class",
        "staging_quota_replay_db_candidate",
        "local_backend_healthz",
        "local_backend_readyz",
        "local_web_root",
        "local_admin_root",
        "local_caddy_healthz",
        "local_caddy_root",
    )
    summary = {key: values[key] for key in summary_keys if key in values}
    if not values:
        return findings, recommended_actions, summary

    findings.append("origin_diagnostics_present")
    if values.get("docker_cli") == "missing":
        findings.append("origin_docker_cli_missing")
        recommended_actions.append("Install Docker on the Azure VM before staging deploy or repair.")
    if values.get("docker_compose") == "missing":
        findings.append("origin_docker_compose_missing")
        recommended_actions.append("Install Docker Compose v2 on the Azure VM before staging deploy or repair.")
    if values.get("passwordless_sudo") == "missing":
        findings.append("origin_passwordless_sudo_missing")
        recommended_actions.append("Restore passwordless sudo for the staging Linux user before running deploy/repair helpers.")
    if values.get("release_dir_present") == "false":
        findings.append("origin_release_dir_missing")
        recommended_actions.append("Run scripts/azure_staging_bootstrap.sh and scripts/azure_staging_deploy.sh after SSH access is restored.")
    if values.get("compose_file_present") == "false":
        findings.append("origin_compose_file_missing")
        recommended_actions.append("Deploy the Zenari compose bundle to /opt/zenari/current before origin repair.")
    if values.get("compose_service_manager") == "present" or values.get("manager_absent") == "false":
        findings.append("origin_legacy_manager_present")
        recommended_actions.append("Remove legacy manager containers/services; Stage 1 release surfaces are backend, web, and admin.")
    if values.get("worker_crawler_backend_image_match") == "false":
        findings.append("origin_worker_crawler_backend_image_mismatch")
        recommended_actions.append("Redeploy with worker/crawler as backend runtime entrypoints sharing the backend image.")
    if values.get("compose_core_services_running") == "false":
        findings.append("origin_compose_core_services_not_running")
        recommended_actions.append("Restart the Zenari compose stack and inspect any non-running backend, web, admin, worker, or crawler service.")
    for service_name in ("backend", "web", "admin", "worker", "crawler"):
        service_state = values.get(f"compose_service_{service_name}_state")
        if service_state and service_state != "running":
            findings.append(f"origin_{service_name}_service_not_running")
            recommended_actions.append(f"Inspect and restart the {service_name} compose service before rerunning Azure origin readiness.")
    if values.get("compose_service_postgres") == "absent":
        findings.append("origin_postgres_service_missing")
        recommended_actions.append("Add or restore the postgres compose service or configure an external deployed staging database.")
    if values.get("origin_postgres_container") == "missing":
        findings.append("origin_postgres_container_missing")
        recommended_actions.append("Start the staging postgres service or configure an external deployed staging database.")
    elif values.get("origin_postgres_container") not in {None, "running", "present"}:
        findings.append("origin_postgres_container_not_running")
        recommended_actions.append("Inspect postgres container state and restart the staging compose database if needed.")
    if values.get("backend_database_url_present") == "false":
        findings.append("origin_backend_database_url_missing")
        recommended_actions.append("Configure DATABASE_URL for the deployed backend before quota replay evidence can pass.")
    if values.get("backend_database_host_class") in {"local_loopback", "compose_service", "private_ip"}:
        findings.append("origin_database_url_local")
    elif values.get("backend_database_host_class") == "public_or_external":
        findings.append("origin_database_url_external")
    elif values.get("backend_database_host_class") in {"missing", "reserved_or_unclassified"}:
        findings.append("origin_database_url_unavailable")
    if values.get("staging_quota_replay_db_candidate") == "local_compose":
        findings.append("origin_quota_replay_db_local_compose")
        recommended_actions.append("Expose a deployed non-local staging Postgres endpoint for strict quota replay, or run the strict evidence generator from an environment that can reach it without local loopback.")
    elif values.get("staging_quota_replay_db_candidate") == "external":
        findings.append("origin_quota_replay_db_external_candidate")
    elif values.get("staging_quota_replay_db_candidate") == "missing":
        findings.append("origin_quota_replay_db_missing")
        recommended_actions.append("Configure the staging quota replay database endpoint before running strict quota replay evidence.")
    if values.get("caddy_container") == "missing":
        findings.append("origin_caddy_missing")
        recommended_actions.append("Run scripts/azure_staging_proxy.sh after SSH access is restored.")
    elif values.get("caddy_running") == "false":
        findings.append("origin_caddy_not_running")
        recommended_actions.append("Restart the zenari-caddy container and rerun Azure origin readiness.")
    for port, finding in ORIGIN_LISTENER_MISSING_FINDINGS.items():
        if values.get(f"origin_listener_{port}") == "missing":
            findings.append(finding)
    for probe in (
        "local_backend_healthz",
        "local_backend_readyz",
        "local_web_root",
        "local_admin_root",
        "local_caddy_healthz",
        "local_caddy_root",
    ):
        value = values.get(probe)
        if value == "blocked":
            findings.append(ORIGIN_PROBE_BLOCKED_FINDINGS[probe])
        elif value and value.isdigit() and int(value) >= 500:
            findings.append(ORIGIN_PROBE_SERVER_ERROR_FINDINGS[probe])
    if any(item.endswith("_blocked") or item.endswith("_server_error") for item in findings):
        recommended_actions.append("Run scripts/azure_staging_origin_repair.sh after SSH access works, then refresh Azure origin readiness.")
    return findings, recommended_actions, summary


def http_probe_passed(value: str | None) -> bool:
    if value is None or not value.isdigit():
        return False
    status = int(value)
    return 200 <= status < 400


def classify_ssh_repair_status(findings: list[str]) -> str:
    if SSH_REPAIR_BLOCKING_FINDINGS.intersection(findings):
        return "blocked"
    if "payload_completed" in findings and "ssh_listener_checked" in findings:
        return "pass"
    return "blocked"


def classify_origin_runtime_status(origin_summary: dict[str, str], findings: list[str]) -> str:
    if not origin_summary:
        return "missing"
    if ORIGIN_RUNTIME_BLOCKING_FINDINGS.intersection(findings):
        return "blocked"
    if all(http_probe_passed(origin_summary.get(probe)) for probe in ORIGIN_CORE_PROBES):
        return "pass"
    return "missing"


def select_next_repair_lane(ssh_repair_status: str, origin_runtime_status: str, findings: list[str]) -> str:
    if ssh_repair_status != "pass":
        return "ssh_transport"
    if origin_runtime_status == "blocked":
        return "origin_runtime"
    if "origin_quota_replay_db_missing" in findings or "origin_quota_replay_db_local_compose" in findings:
        return "staging_database"
    if origin_runtime_status == "missing":
        return "origin_runtime_unknown"
    return "staging_origin_readiness"


def classify_text(text: str) -> tuple[str, str, str, str, list[str], list[str], list[str], dict[str, str]]:
    findings: list[str] = []
    recommended_actions: list[str] = []
    present_sections = [section for section in DIAGNOSTIC_SECTIONS if section in text]
    origin_values = parse_origin_kv(text)
    origin_findings, origin_actions, origin_summary = summarize_origin(origin_values)
    findings.extend(origin_findings)
    recommended_actions.extend(origin_actions)

    if EXPECTED_MARKERS[0] not in text:
        findings.append("payload_start_marker_missing")
        recommended_actions.append("Re-run the generated payload inside Azure Portal VM Run Command, not Cloud Shell.")
    if EXPECTED_MARKERS[1] not in text:
        findings.append("payload_completion_marker_missing")
        recommended_actions.append("Inspect Azure Run Command execution status and VM resource pressure because the payload did not complete.")

    if not present_sections:
        findings.append("diagnostic_sections_missing")
        recommended_actions.append("Capture the full Azure Run Command output and rerun this classifier.")

    if "sshd_config_test_after" in text and text_has_any(text, ("bad configuration option", "missing privilege separation directory", "no hostkeys available")):
        findings.append("sshd_config_invalid")
        recommended_actions.append("Fix sshd_config errors from the Run Command output, then rerun sshd -t and restart ssh.")

    if text_has_any(text, ("openssh-server", "apt-get install -y openssh-server", "yum install -y openssh-server", "dnf install -y openssh-server")):
        findings.append("openssh_server_install_attempted")
        recommended_actions.append("Confirm openssh-server installation finished and ssh/sshd service is enabled.")

    if "/run/sshd" in text:
        findings.append("run_sshd_directory_repaired")

    if text_has_any(text, ("ssh_socket_status_after", "ssh.socket")):
        findings.append("ssh_socket_checked")

    if text_has_any(text, ("listening_ssh_after", ":22")):
        findings.append("ssh_listener_checked")

    if text_has_any(text, ("ufw status", "iptables", "nft list ruleset", "firewall_summary")):
        findings.append("firewall_checked")

    if text_has_any(text, ("walinuxagent", "waagent", "azure_agent_recent_logs")):
        findings.append("azure_agent_checked")

    if text_has_any(text, ("cloud-init", "cloud_final", "cloud_init_recent_logs")):
        findings.append("cloud_init_checked")

    if text_has_any(text, ("zenari_azure_run_command_payload=complete",)):
        findings.append("payload_completed")

    ssh_repair_status = classify_ssh_repair_status(findings)
    origin_runtime_status = classify_origin_runtime_status(origin_summary, findings)
    next_repair_lane = select_next_repair_lane(ssh_repair_status, origin_runtime_status, findings)

    if ssh_repair_status == "pass" and origin_runtime_status == "pass":
        status = "pass"
        recommended_actions.append("Rerun scripts/azure_staging_ssh_preflight.sh and then scripts/stage1_azure_origin_readiness.py.")
    elif ssh_repair_status == "pass" and origin_runtime_status == "blocked":
        status = "blocked"
        recommended_actions.append("Run scripts/azure_staging_origin_repair.sh after SSH access works, then refresh Azure origin readiness.")
    elif ssh_repair_status == "pass":
        status = "blocked"
        recommended_actions.append("Rerun scripts/stage1_azure_origin_readiness.py and capture complete origin diagnostics before clearing staging runtime.")
    else:
        status = "blocked"
        recommended_actions.append("Do not treat this diagnosis as clearing staging or production gates.")

    return (
        status,
        ssh_repair_status,
        origin_runtime_status,
        next_repair_lane,
        sorted(set(findings)),
        present_sections,
        sorted(set(recommended_actions)),
        origin_summary,
    )


def build_report(input_path: Path, output_path: Path) -> dict[str, Any]:
    if not input_path.exists():
        data: dict[str, Any] = {
            "schema_version": SCHEMA_VERSION,
            "kind": "stage1_azure_run_command_ssh_repair_diagnosis",
            "status": "blocked",
            "release_gate_decision": "no_go",
            "generated_at": now(),
            "input_path": display_path(input_path),
            "output_path": display_path(output_path),
            "input_present": False,
            "ssh_repair_status": "blocked",
            "origin_runtime_status": "missing",
            "next_repair_lane": "ssh_transport",
            "raw_output_persisted": False,
            "can_clear_stage1_staging_runtime_gate": False,
            "can_clear_stage1_production_launch_gate": False,
            "findings": ["missing_output"],
            "present_sections": [],
            "recommended_actions": [
                "Run scripts/azure_staging_run_command_payload.sh, paste the generated payload into Azure Portal VM Run Command, save the non-secret output locally, then rerun this classifier.",
                "Do not use a missing-output diagnosis to clear staging or production gates.",
            ],
        }
        data.update(SAFE_FALSE_FIELDS)
        return data

    text = input_path.read_text(encoding="utf-8", errors="replace")
    if RAW_SECRET_RE.search(text):
        raise AzureRunCommandDiagnosisError("input contains secret-shaped material; redact before classification")
    (
        status,
        ssh_repair_status,
        origin_runtime_status,
        next_repair_lane,
        findings,
        present_sections,
        recommended_actions,
        origin_summary,
    ) = classify_text(text)
    data = {
        "schema_version": SCHEMA_VERSION,
        "kind": "stage1_azure_run_command_ssh_repair_diagnosis",
        "status": status,
        "release_gate_decision": "no_go",
        "generated_at": now(),
        "input_path": display_path(input_path),
        "output_path": display_path(output_path),
        "input_present": True,
        "ssh_repair_status": ssh_repair_status,
        "origin_runtime_status": origin_runtime_status,
        "next_repair_lane": next_repair_lane,
        "raw_output_persisted": False,
        "can_clear_stage1_staging_runtime_gate": False,
        "can_clear_stage1_production_launch_gate": False,
        "findings": findings,
        "present_sections": present_sections,
        "origin_summary": origin_summary,
        "recommended_actions": recommended_actions,
    }
    data.update(SAFE_FALSE_FIELDS)
    return data


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        if SCHEMA_VERSION != "stage1.azure_run_command_ssh_repair_diagnosis.v1":
            raise SystemExit("schema version mismatch")
        for snippet in (
            "missing_output",
            "payload_completion_marker_missing",
            "sshd_config_invalid",
            "ssh_socket_checked",
            "firewall_checked",
            "azure_agent_checked",
            "cloud_init_checked",
            "raw_output_persisted",
        ):
            if snippet not in Path(__file__).read_text(encoding="utf-8"):
                raise SystemExit(f"contract snippet missing: {snippet}")
        print("azure run command output classifier contract passed")
        return 0
    report = build_report(args.input, args.output)
    write_json(args.output, report)
    print(f"wrote Azure Run Command diagnosis to {display_path(args.output)}")
    return 0 if report["status"] == "pass" else 2


if __name__ == "__main__":
    raise SystemExit(main())
