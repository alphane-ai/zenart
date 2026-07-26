#!/usr/bin/env python3
"""Validate the Azure staging password-to-key repair helper contract."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "azure_staging_password_key_repair.sh"
PREFLIGHT = ROOT / "scripts" / "azure_staging_ssh_preflight.sh"
ENV_EXAMPLE = ROOT / ".env.example"


class ContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def main() -> int:
    script = SCRIPT.read_text(encoding="utf-8")
    env_example = ENV_EXAMPLE.read_text(encoding="utf-8")
    required_snippets = (
        "STAGING_SSH_PASSWORD",
        "STAGING_SSH_HARD_TIMEOUT",
        "password_persisted=false",
        "log_user 0",
        "PubkeyAuthentication=no",
        "PreferredAuthentications=password",
        "StrictHostKeyChecking=accept-new",
        "ServerAliveInterval=5",
        "ServerAliveCountMax=2",
        "authorized_keys",
        "NOPASSWD:ALL",
        "ZENARI_REPAIR_PASSWORD",
        "unset ZENARI_REPAIR_PASSWORD",
        "azure_staging_ssh_preflight.sh",
    )
    for snippet in required_snippets:
        require(snippet in script, f"repair script missing {snippet!r}")
    preflight = PREFLIGHT.read_text(encoding="utf-8")
    for snippet in (
        "STAGING_SSH_HARD_TIMEOUT",
        "run_with_hard_timeout",
        "ServerAliveInterval=5",
        "ServerAliveCountMax=2",
        "return 124",
        "ssh_failure_reason=ssh_connect_timeout",
        "timed out during banner exchange",
        "check sshd health",
    ):
        require(snippet in preflight, f"ssh preflight missing {snippet!r}")
    require(
        re.search(r"^STAGING_SSH_PASSWORD=$", env_example, re.MULTILINE) is not None,
        ".env.example must expose blank STAGING_SSH_PASSWORD only",
    )
    require("STAGING_SSH_PASSWORD=" not in script, "repair script must not embed a password value")
    require("set -x" not in script, "repair script must not enable shell xtrace")
    require("echo \"$SSH_PASSWORD\"" not in script, "repair script must not echo password")
    print("azure staging password key repair contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
