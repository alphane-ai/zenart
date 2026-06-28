#!/usr/bin/env python3
"""Validate the Azure Run Command output ingest workflow."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INGEST = ROOT / "scripts" / "ingest_azure_run_command_output.py"


class ContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def main() -> int:
    source = INGEST.read_text(encoding="utf-8")
    for snippet in (
        "sanitize_azure_run_command_output.py",
        "classify_azure_run_command_output.py",
        "stage1_azure_origin_readiness.py",
        "--env",
        ".env",
        "--azure-timeout",
        "--ssh-hard-timeout",
        "validate_stage1_azure_origin_readiness.py",
        "generate_stage1_next_blockers_summary.py",
        "validate_stage1_next_blockers_summary.py",
        "raw_input_persisted=false",
        "release_gate_decision=no_go",
        "allow_exit_2",
    ):
        require(snippet in source, f"ingest script missing {snippet!r}")
    require("set -x" not in source, "ingest script must not include shell xtrace")
    subprocess.run(["python3", str(INGEST), "--contract-only"], cwd=ROOT, check=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        raw = "\n".join(
            [
                "zenari_azure_run_command_payload=ssh_repair_v1",
                "Authorization: Bearer secret-token-value",
                "origin_diagnostics_begin",
                "docker_cli=present",
                "docker_compose=present",
                "release_dir_present=true",
                "compose_file_present=true",
                "compose_services=backend,web,admin,worker,crawler",
                "compose_service_backend=present",
                "compose_service_web=present",
                "compose_service_admin=present",
                "compose_service_worker=present",
                "compose_service_crawler=present",
                "compose_service_manager=absent",
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
                "local_backend_healthz=200",
                "local_backend_readyz=200",
                "local_web_root=200",
                "local_admin_root=200",
                "local_caddy_healthz=200",
                "local_caddy_root=200",
                "origin_diagnostics_end",
                "ssh_socket_status=",
                "sshd_config_test_after=",
                "listening_ssh_after=",
                "LISTEN 0 128 0.0.0.0:22",
                "zenari_azure_run_command_payload=complete",
            ]
        )
        sanitized = tmp_path / "sanitized.txt"
        diagnosis = tmp_path / "diagnosis.json"
        readiness = tmp_path / "readiness.json"
        next_blockers = tmp_path / "next-blockers.json"
        next_blockers_md = tmp_path / "next-blockers.md"
        status = subprocess.run(
            [
                "python3",
                str(INGEST),
                "--sanitized-output",
                str(sanitized),
                "--diagnosis-output",
                str(diagnosis),
                "--azure-readiness-output",
                str(readiness),
                "--next-blockers-output",
                str(next_blockers),
                "--next-blockers-markdown",
                str(next_blockers_md),
                "--azure-timeout",
                "1",
                "--ssh-hard-timeout",
                "20",
            ],
            cwd=ROOT,
            input=raw,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        ).returncode
        require(status in {0, 2}, f"ingest must complete with pass or blocked status, got {status}")
        require(sanitized.exists(), "ingest must write sanitized output")
        require(diagnosis.exists(), "ingest must write diagnosis")
        require(readiness.exists(), "ingest must write readiness")
        require(next_blockers.exists(), "ingest must write next blockers summary")
        require(next_blockers_md.exists(), "ingest must write next blockers markdown")
        require("secret-token-value" not in sanitized.read_text(encoding="utf-8"), "ingest must sanitize bearer token")
        diagnosis_data = json.loads(diagnosis.read_text(encoding="utf-8"))
        require(diagnosis_data.get("raw_output_persisted") is False, "diagnosis must not persist raw output")
        require("origin_diagnostics_present" in diagnosis_data.get("findings", []), "ingest diagnosis must include origin diagnostics")

        no_marker = subprocess.run(
            [
                "python3",
                str(INGEST),
                "--sanitized-output",
                str(tmp_path / "bad-sanitized.txt"),
                "--diagnosis-output",
                str(tmp_path / "bad-diagnosis.json"),
                "--azure-readiness-output",
                str(tmp_path / "bad-readiness.json"),
                "--next-blockers-output",
                str(tmp_path / "bad-next-blockers.json"),
                "--next-blockers-markdown",
                str(tmp_path / "bad-next-blockers.md"),
                "--azure-timeout",
                "1",
                "--ssh-hard-timeout",
                "20",
            ],
            cwd=ROOT,
            input="not azure output\n",
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        require(no_marker != 0, "ingest must reject unrelated output when marker is required")

        blocked = subprocess.run(
            [
                "python3",
                str(INGEST),
                "--allow-missing-marker",
                "--sanitized-output",
                str(tmp_path / "partial-sanitized.txt"),
                "--diagnosis-output",
                str(tmp_path / "partial-diagnosis.json"),
                "--azure-readiness-output",
                str(tmp_path / "partial-readiness.json"),
                "--next-blockers-output",
                str(tmp_path / "partial-next-blockers.json"),
                "--next-blockers-markdown",
                str(tmp_path / "partial-next-blockers.md"),
                "--azure-timeout",
                "1",
                "--ssh-hard-timeout",
                "20",
            ],
            cwd=ROOT,
            input="origin_diagnostics_begin\nlocal_backend_healthz=blocked\norigin_diagnostics_end\n",
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        ).returncode
        require(blocked == 2, "partial ingest should preserve blocked exit 2")

    print("azure run command output ingest validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
