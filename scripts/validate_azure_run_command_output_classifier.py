#!/usr/bin/env python3
"""Validate Azure Run Command output classifier contract and sample behavior."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CLASSIFIER = ROOT / "scripts" / "classify_azure_run_command_output.py"


class ContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def load_json(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    require(isinstance(data, dict), f"{path} must contain object")
    return data


def main() -> int:
    text = CLASSIFIER.read_text(encoding="utf-8")
    for snippet in (
        "stage1.azure_run_command_ssh_repair_diagnosis.v1",
        "missing_output",
        "payload_completion_marker_missing",
        "sshd_config_invalid",
        "ssh_socket_checked",
        "firewall_checked",
        "azure_agent_checked",
        "cloud_init_checked",
        "origin_diagnostics_present",
        "origin_docker_cli_missing",
        "origin_caddy_missing",
        "origin_compose_core_services_not_running",
        "origin_backend_service_not_running",
        "origin_listener_80_missing",
        "local_backend_healthz_blocked",
        "origin_postgres_service_missing",
        "origin_database_url_local",
        "origin_quota_replay_db_local_compose",
        "origin_quota_replay_db_external_candidate",
        "origin_summary",
        "raw_output_persisted",
        "can_clear_stage1_staging_runtime_gate",
        "can_clear_stage1_production_launch_gate",
        "Azure Portal VM Run Command",
    ):
        require(snippet in text, f"classifier missing {snippet!r}")
    for forbidden in ("set -x", "STAGING_SSH_PASSWORD", "raw_run_command_output\": text"):
        require(forbidden not in text, f"classifier must not persist/read sensitive raw material via {forbidden!r}")
    subprocess.run(["python3", str(CLASSIFIER), "--contract-only"], cwd=ROOT, check=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        missing_input = tmp_path / "missing.txt"
        missing_output = tmp_path / "missing.json"
        status = subprocess.run(
            ["python3", str(CLASSIFIER), "--input", str(missing_input), "--output", str(missing_output)],
            cwd=ROOT,
            check=False,
        ).returncode
        require(status == 2, f"missing input must exit 2, got {status}")
        missing = load_json(missing_output)
        require(missing["status"] == "blocked", "missing output must be blocked")
        require(missing["ssh_repair_status"] == "blocked", "missing output SSH repair status must be blocked")
        require(missing["origin_runtime_status"] == "missing", "missing output origin runtime status must be missing")
        require(missing["next_repair_lane"] == "ssh_transport", "missing output next lane must be ssh_transport")
        require("missing_output" in missing["findings"], "missing output finding required")
        require(missing["raw_output_persisted"] is False, "raw output must not be persisted")

        sample_input = tmp_path / "sample.txt"
        sample_output = tmp_path / "sample.json"
        sample_input.write_text(
            "\n".join(
                [
                    "zenari_azure_run_command_payload=ssh_repair_v1",
                    "ssh_socket_status=",
                    "systemd ssh.socket loaded active listening",
                    "sshd_config_test_before=",
                    "sshd_effective_port=",
                    "port 22",
                    "firewall_summary=",
                    "ufw status inactive",
                    "azure_agent_recent_logs=",
                    "waagent healthy",
                    "cloud_init_recent_logs=",
                    "cloud-init complete",
                    "ssh_recent_logs=",
                    "listening_ssh=",
                    "LISTEN 0 128 0.0.0.0:22",
                    "sshd_config_test_after=",
                    "ssh_socket_status_after=",
                    "listening_ssh_after=",
                    "LISTEN 0 128 0.0.0.0:22",
                    "origin_diagnostics_begin",
                    "origin_diag_version=v1",
                    "docker_cli=present",
                    "docker_compose=present",
                    "passwordless_sudo=present",
                    "release_dir_present=true",
                    "compose_file_present=true",
                    "compose_services=backend,web,admin,worker,crawler",
                    "compose_service_backend=present",
                    "compose_service_web=present",
                    "compose_service_admin=present",
                    "compose_service_worker=present",
                    "compose_service_crawler=present",
                    "compose_service_manager=absent",
                    "compose_service_postgres=present",
                    "compose_service_backend_state=running",
                    "compose_service_web_state=running",
                    "compose_service_admin_state=running",
                    "compose_service_worker_state=running",
                    "compose_service_crawler_state=running",
                    "compose_core_services_running=true",
                    "worker_crawler_backend_image_match=true",
                    "manager_absent=true",
                    "caddy_container=present",
                    "caddy_running=true",
                    "origin_listener_80=present",
                    "origin_listener_443=present",
                    "origin_listener_31080=present",
                    "origin_listener_26080=present",
                    "origin_listener_26081=present",
                    "origin_listener_5432=missing",
                    "origin_listener_26432=missing",
                    "origin_postgres_container=missing",
                    "backend_database_url_present=true",
                    "backend_database_host_class=public_or_external",
                    "staging_quota_replay_db_candidate=external",
                    "local_backend_healthz=200",
                    "local_backend_readyz=200",
                    "local_web_root=200",
                    "local_admin_root=200",
                    "local_caddy_healthz=200",
                    "local_caddy_root=200",
                    "origin_diagnostics_end",
                    "zenari_azure_run_command_payload=complete",
                ]
            ),
            encoding="utf-8",
        )
        subprocess.run(
            ["python3", str(CLASSIFIER), "--input", str(sample_input), "--output", str(sample_output)],
            cwd=ROOT,
            check=True,
        )
        sample = load_json(sample_output)
        require(sample["status"] == "pass", "complete sample should pass classifier")
        require(sample["ssh_repair_status"] == "pass", "complete sample SSH repair status should pass")
        require(sample["origin_runtime_status"] == "pass", "complete sample origin runtime status should pass")
        require(sample["next_repair_lane"] == "staging_origin_readiness", "complete sample next lane should be staging readiness")
        require("payload_completed" in sample["findings"], "sample must include payload_completed")
        require("ssh_listener_checked" in sample["findings"], "sample must include ssh listener finding")
        require("origin_diagnostics_present" in sample["findings"], "sample must include origin diagnostics finding")
        require(sample["origin_summary"]["docker_cli"] == "present", "sample must summarize docker cli")
        require(sample["origin_summary"]["manager_absent"] == "true", "sample must summarize manager absence")
        require(sample["origin_summary"]["compose_core_services_running"] == "true", "sample must summarize core service running state")
        require(sample["origin_summary"]["compose_service_backend_state"] == "running", "sample must summarize backend service state")
        require(sample["origin_summary"]["local_backend_healthz"] == "200", "sample must summarize backend health")
        require(sample["origin_summary"]["backend_database_host_class"] == "public_or_external", "sample must summarize DB host class")
        require("origin_quota_replay_db_external_candidate" in sample["findings"], "sample must detect external quota replay DB candidate")
        require(sample["raw_output_persisted"] is False, "sample must not persist raw output")
        require("LISTEN 0 128" not in json.dumps(sample), "sample JSON must not persist raw log lines")

        origin_blocked_input = tmp_path / "origin-blocked.txt"
        origin_blocked_output = tmp_path / "origin-blocked.json"
        origin_blocked_input.write_text(
            "\n".join(
                [
                    "zenari_azure_run_command_payload=ssh_repair_v1",
                    "ssh_socket_status=",
                    "sshd_config_test_after=",
                    "listening_ssh_after=",
                    "LISTEN 0 128 0.0.0.0:22",
                    "origin_diagnostics_begin",
                    "docker_cli=missing",
                    "docker_compose=missing",
                    "release_dir_present=false",
                    "compose_file_present=false",
                    "compose_service_postgres=absent",
                    "compose_service_backend_state=exited",
                    "compose_service_web_state=missing",
                    "compose_service_admin_state=running",
                    "compose_service_worker_state=running",
                    "compose_service_crawler_state=running",
                    "compose_core_services_running=false",
                    "worker_crawler_backend_image_match=unknown",
                    "manager_absent=false",
                    "caddy_container=missing",
                    "caddy_running=false",
                    "origin_listener_80=missing",
                    "origin_listener_443=missing",
                    "origin_listener_5432=present",
                    "origin_postgres_container=running",
                    "backend_database_url_present=true",
                    "backend_database_host_class=compose_service",
                    "staging_quota_replay_db_candidate=local_compose",
                    "local_backend_healthz=blocked",
                    "local_caddy_root=blocked",
                    "origin_diagnostics_end",
                    "zenari_azure_run_command_payload=complete",
                ]
            ),
            encoding="utf-8",
        )
        origin_blocked_status = subprocess.run(
            ["python3", str(CLASSIFIER), "--input", str(origin_blocked_input), "--output", str(origin_blocked_output)],
            cwd=ROOT,
            check=False,
        ).returncode
        require(origin_blocked_status == 2, f"origin blocked sample must exit 2, got {origin_blocked_status}")
        origin_blocked = load_json(origin_blocked_output)
        require(origin_blocked["status"] == "blocked", "origin blocked sample must not pass overall classifier")
        require(origin_blocked["ssh_repair_status"] == "pass", "origin blocked sample SSH repair status should pass")
        require(origin_blocked["origin_runtime_status"] == "blocked", "origin blocked sample origin runtime status should be blocked")
        require(origin_blocked["next_repair_lane"] == "origin_runtime", "origin blocked sample next lane should be origin runtime")
        for finding in (
            "origin_docker_cli_missing",
            "origin_docker_compose_missing",
            "origin_release_dir_missing",
            "origin_compose_file_missing",
            "origin_compose_core_services_not_running",
            "origin_backend_service_not_running",
            "origin_web_service_not_running",
            "origin_legacy_manager_present",
            "origin_postgres_service_missing",
            "origin_database_url_local",
            "origin_quota_replay_db_local_compose",
            "origin_caddy_missing",
            "origin_listener_80_missing",
            "origin_listener_443_missing",
            "local_backend_healthz_blocked",
            "local_caddy_root_blocked",
        ):
            require(finding in origin_blocked["findings"], f"origin blocked sample missing {finding}")
        require("LISTEN 0 128" not in json.dumps(origin_blocked), "origin blocked JSON must not persist raw log lines")

        secret_input = tmp_path / "secret.txt"
        secret_output = tmp_path / "secret.json"
        secret_input.write_text("zenari_azure_run_command_payload=ssh_repair_v1\nBearer secret-token-value\n", encoding="utf-8")
        secret_status = subprocess.run(
            ["python3", str(CLASSIFIER), "--input", str(secret_input), "--output", str(secret_output)],
            cwd=ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        require(secret_status != 0, "secret-shaped input must fail classification")
        require(not secret_output.exists(), "secret-shaped classification must not write output")

    print("azure run command output classifier validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
