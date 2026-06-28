#!/usr/bin/env python3
"""Validate the Azure staging Run Command payload helper contract."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "azure_staging_run_command_payload.sh"
CLI_PREFLIGHT = ROOT / "scripts" / "azure_staging_cli_preflight.sh"
INVOKE = ROOT / "scripts" / "azure_staging_run_command_invoke.sh"
RUNBOOK = ROOT / "ops" / "release" / "staging_deploy.md"


class ContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def main() -> int:
    text = SCRIPT.read_text(encoding="utf-8")
    cli_preflight = CLI_PREFLIGHT.read_text(encoding="utf-8")
    invoke = INVOKE.read_text(encoding="utf-8")
    runbook = RUNBOOK.read_text(encoding="utf-8")
    for snippet in (
        "Azure Portal Run Command / RunShellScript",
        "Do not paste it into Cloud Shell",
        "password_persisted=false",
        "PUBLIC_KEY_FINGERPRINT",
        "systemctl status ssh",
        "systemctl status ssh.socket",
        "journalctl -u ssh",
        "journalctl -u walinuxagent -u waagent",
        "journalctl -u cloud-init -u cloud-final",
        "ss -ltnp",
        "sshd -t",
        "sshd -T",
        "/run/sshd",
        "openssh-server",
        "ufw status verbose",
        "iptables -S",
        "nft list ruleset",
        "origin_diagnostics_begin",
        "origin_listener_80",
        "origin_listener_443",
        "origin_listener_5432",
        "origin_listener_26432",
        "local_backend_healthz",
        "local_web_root",
        "local_admin_root",
        "local_caddy_root",
        "docker compose config --services",
        "worker_crawler_backend_image_match",
        "manager_absent",
        "compose_service_postgres",
        "origin_postgres_container",
        "backend_database_host_class",
        "staging_quota_replay_db_candidate",
        "authorized_keys",
        "NOPASSWD:ALL",
        "systemctl unmask ssh",
        "systemctl enable ssh",
        "systemctl restart ssh",
        "systemctl restart ssh.socket",
        "zenari_azure_run_command_payload=complete",
    ):
        require(snippet in text, f"payload helper missing {snippet!r}")
    for forbidden in ("${STAGING_SSH_PASSWORD", "$STAGING_SSH_PASSWORD", "ZENARI_REPAIR_PASSWORD"):
        require(forbidden not in text, f"payload helper must not read SSH password via {forbidden!r}")
        require(forbidden not in cli_preflight, f"cli preflight must not read SSH password via {forbidden!r}")
        require(forbidden not in invoke, f"invoke helper must not read SSH password via {forbidden!r}")
    for snippet in (
        "az account show",
        "az vm list-ip-addresses",
        "azure_cli_preflight_status",
        "vm_found_by_public_ip",
    ):
        require(snippet in cli_preflight, f"cli preflight missing {snippet!r}")
    for snippet in (
        "RUN_AZURE_STAGING_RUN_COMMAND",
        "az vm run-command invoke",
        "AZURE_RESOURCE_GROUP",
        "AZURE_VM_NAME",
        "AZURE_SUBSCRIPTION_ID",
        "AZURE_TENANT_ID",
        "azure_staging_cli_preflight.sh --json",
        "azure_staging_run_command_payload.sh",
        "password_persisted=false",
    ):
        require(snippet in invoke, f"invoke helper missing {snippet!r}")
    require("set -x" not in text, "payload helper must not enable xtrace")
    require("set -x" not in cli_preflight, "cli preflight must not enable xtrace")
    require("set -x" not in invoke, "invoke helper must not enable xtrace")
    subprocess.run(["bash", "-n", str(SCRIPT)], cwd=ROOT, check=True)
    subprocess.run(["bash", "-n", str(CLI_PREFLIGHT)], cwd=ROOT, check=True)
    subprocess.run(["bash", "-n", str(INVOKE)], cwd=ROOT, check=True)
    subprocess.run([str(SCRIPT), "--contract-only"], cwd=ROOT, check=True)
    subprocess.run([str(CLI_PREFLIGHT), "--contract-only"], cwd=ROOT, check=True)
    subprocess.run([str(INVOKE), "--contract-only"], cwd=ROOT, check=True)
    with tempfile.TemporaryDirectory() as tmp:
        output = Path(tmp) / "azure-run-command-ssh-repair.sh"
        result = subprocess.run(
            [str(SCRIPT), "--output", str(output)],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        require("password_persisted=false" in result.stdout, "helper output must state no password persistence")
        payload = output.read_text(encoding="utf-8")
        require("PUBKEY=" in payload, "generated payload missing public key assignment")
        require("journalctl -u ssh" in payload, "generated payload missing ssh logs")
        require("journalctl -u walinuxagent -u waagent" in payload, "generated payload missing Azure agent logs")
        require("journalctl -u cloud-init -u cloud-final" in payload, "generated payload missing cloud-init logs")
        require("sshd_config_test_before" in payload, "generated payload missing sshd config test before repair")
        require("sshd_config_test_after" in payload, "generated payload missing sshd config test after repair")
        require("ssh_socket_status" in payload, "generated payload missing ssh socket diagnostics")
        require("firewall_summary" in payload, "generated payload missing firewall summary")
        require("origin_diagnostics_begin" in payload, "generated payload missing origin diagnostics start")
        require("origin_diagnostics_end" in payload, "generated payload missing origin diagnostics end")
        require("origin_listener_80" in payload, "generated payload missing origin listener 80 check")
        require("origin_listener_443" in payload, "generated payload missing origin listener 443 check")
        require("origin_listener_5432" in payload, "generated payload missing origin listener 5432 check")
        require("origin_listener_26432" in payload, "generated payload missing origin listener 26432 check")
        require("local_backend_healthz" in payload, "generated payload missing local backend health check")
        require("local_web_root" in payload, "generated payload missing local web probe")
        require("local_admin_root" in payload, "generated payload missing local admin probe")
        require("local_caddy_root" in payload, "generated payload missing local caddy probe")
        require("worker_crawler_backend_image_match" in payload, "generated payload missing backend image boundary check")
        require("manager_absent" in payload, "generated payload missing legacy manager absence check")
        require("compose_service_postgres" in payload, "generated payload missing postgres service check")
        require("origin_postgres_container" in payload, "generated payload missing postgres container check")
        require("backend_database_host_class" in payload, "generated payload missing backend database host classifier")
        require("staging_quota_replay_db_candidate" in payload, "generated payload missing quota replay DB candidate check")
        require("/run/sshd" in payload, "generated payload missing /run/sshd repair")
        require("openssh-server" in payload, "generated payload missing openssh-server repair")
        require("authorized_keys" in payload, "generated payload missing authorized_keys repair")
        require("STAGING_SSH_PASSWORD" not in payload, "generated payload must not contain password env key")
        subprocess.run(["bash", "-n", str(output)], cwd=ROOT, check=True)
    for snippet in (
        "scripts/azure_staging_run_command_payload.sh --output /tmp/zenari-azure-run-command-ssh-repair.sh",
        "scripts/azure_staging_cli_preflight.sh",
        "RUN_AZURE_STAGING_RUN_COMMAND=1",
        "AZURE_SUBSCRIPTION_ID=",
        "AZURE_TENANT_ID=",
        "AZURE_RESOURCE_GROUP=",
        "AZURE_VM_NAME=",
        "must list them blank",
        "ssh_connect_timeout",
        "zenari_azure_run_command_payload=complete",
        "STAGING_SSH_PASSWORD",
        "Azure Cloud Shell",
    ):
        require(snippet in runbook, f"staging deploy runbook missing {snippet!r}")
    print("azure staging run command payload contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
