#!/usr/bin/env python3
"""Validate Azure staging origin diagnostics/repair helper contracts."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ACTIVE_AZURE_STAGING_IP = "52.237.80.117"
DECOMMISSIONED_AZURE_STAGING_IPS = ("4.194.249.22", "20.212.249.236")
DIAGNOSTICS = ROOT / "scripts" / "azure_staging_origin_diagnostics.sh"
REPAIR = ROOT / "scripts" / "azure_staging_origin_repair.sh"
PROXY = ROOT / "scripts" / "azure_staging_proxy.sh"
DEPLOY = ROOT / "scripts" / "azure_staging_deploy.sh"
CLI_PREFLIGHT = ROOT / "scripts" / "azure_staging_cli_preflight.sh"
BOOTSTRAP = ROOT / "scripts" / "azure_staging_bootstrap.sh"
SSH_PREFLIGHT = ROOT / "scripts" / "azure_staging_ssh_preflight.sh"
PASSWORD_KEY_REPAIR = ROOT / "scripts" / "azure_staging_password_key_repair.sh"
RUN_COMMAND_INVOKE = ROOT / "scripts" / "azure_staging_run_command_invoke.sh"
TARGET_GUARD = ROOT / "scripts" / "azure_staging_target_guard.sh"
RUN_COMMAND_PAYLOAD = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-ssh-repair.sh"
RUN_COMMAND_PAYLOAD_GENERATOR = ROOT / "scripts" / "azure_staging_run_command_payload.sh"
RUN_COMMAND_CARD = ROOT / "ops" / "evidence" / "staging" / "azure-run-command-operator-card.md"
AZURE_READINESS = ROOT / "ops" / "evidence" / "staging" / "stage1-azure-origin-readiness.json"
STAGE1_AZURE_GENERATOR = ROOT / "scripts" / "stage1_azure_origin_readiness.py"
STAGE1_AZURE_VALIDATOR = ROOT / "scripts" / "validate_stage1_azure_origin_readiness.py"
ADMIN_RELEASE_PAGE = ROOT / "admin" / "app" / "release" / "page.tsx"
ADMIN_API = ROOT / "admin" / "lib" / "admin-api.ts"
ADMIN_RELEASE_SMOKE = ROOT / "admin" / "tests" / "stage1-admin-core-ops.spec.ts"
SCANNED_PATHS = (
    ROOT / ".env.example",
    ROOT / "Docs",
    ROOT / "admin",
    ROOT / "ops",
    ROOT / "scripts",
)
SKIP_DIR_NAMES = {
    ".git",
    ".next",
    ".turbo",
    ".cache",
    "__pycache__",
    "node_modules",
    "test-results",
    "playwright-report",
}
SKIP_FILE_SUFFIXES = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".zip",
    ".gz",
    ".heapsnapshot",
    ".DS_Store",
}


class ContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def require_snippets(path: Path, snippets: tuple[str, ...]) -> None:
    text = path.read_text(encoding="utf-8")
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing {snippet!r}")
    require("STAGING_SSH_PASSWORD" not in text, f"{path.relative_to(ROOT)} must not use password auth")
    require("set -x" not in text, f"{path.relative_to(ROOT)} must not enable shell xtrace")


def iter_scanned_files() -> list[Path]:
    files: list[Path] = []
    for root in SCANNED_PATHS:
        if not root.exists():
            continue
        if root.is_file():
            files.append(root)
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            parts = set(path.relative_to(ROOT).parts)
            if parts & SKIP_DIR_NAMES:
                continue
            if path.suffix in SKIP_FILE_SUFFIXES:
                continue
            files.append(path)
    return files


def validate_single_azure_staging_ip() -> None:
    required_active_refs = (
        RUN_COMMAND_CARD,
        TARGET_GUARD,
        RUN_COMMAND_PAYLOAD,
        RUN_COMMAND_PAYLOAD_GENERATOR,
        AZURE_READINESS,
        CLI_PREFLIGHT,
        STAGE1_AZURE_GENERATOR,
        STAGE1_AZURE_VALIDATOR,
        ADMIN_API,
        ADMIN_RELEASE_SMOKE,
    )
    for path in required_active_refs:
        text = path.read_text(encoding="utf-8", errors="replace")
        require(
            ACTIVE_AZURE_STAGING_IP in text,
            f"{path.relative_to(ROOT)} must reference active Azure staging IP {ACTIVE_AZURE_STAGING_IP}",
        )

    stale_hits: list[str] = []
    for path in iter_scanned_files():
        if path == Path(__file__).resolve():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for stale_ip in DECOMMISSIONED_AZURE_STAGING_IPS:
            if stale_ip in text:
                stale_hits.append(f"{path.relative_to(ROOT)} contains decommissioned Azure staging IP {stale_ip}")
    require(not stale_hits, "decommissioned Azure staging IP reference(s): " + "; ".join(stale_hits[:12]))


def validate_active_target_guards() -> None:
    guard_text = TARGET_GUARD.read_text(encoding="utf-8")
    require(ACTIVE_AZURE_STAGING_IP in guard_text, "azure staging target guard must pin active IP")
    for stale_ip in DECOMMISSIONED_AZURE_STAGING_IPS:
        require(stale_ip not in guard_text, "azure staging target guard must not mention retired IPs")
    require("zenari_assert_active_azure_staging_host" in guard_text, "target guard missing host assertion")
    require("zenari_assert_active_azure_staging_target" in guard_text, "target guard missing SSH target assertion")

    guarded_scripts = (
        CLI_PREFLIGHT,
        RUN_COMMAND_INVOKE,
        RUN_COMMAND_PAYLOAD_GENERATOR,
        SSH_PREFLIGHT,
        PASSWORD_KEY_REPAIR,
        BOOTSTRAP,
        DEPLOY,
        DIAGNOSTICS,
        REPAIR,
        PROXY,
    )
    for path in guarded_scripts:
        text = path.read_text(encoding="utf-8")
        require("azure_staging_target_guard.sh" in text, f"{path.relative_to(ROOT)} must source azure_staging_target_guard.sh")
        require(
            "zenari_assert_active_azure_staging_host" in text
            or "zenari_assert_active_azure_staging_target" in text,
            f"{path.relative_to(ROOT)} must assert the active Azure staging target before remote work",
        )


def main() -> int:
    validate_single_azure_staging_ip()
    validate_active_target_guards()
    require_snippets(
        DIAGNOSTICS,
        (
            "zenari-caddy",
            "ServerAliveInterval=5",
            "ServerAliveCountMax=2",
            "docker compose ps --format json",
            "127.0.0.1:31080/healthz",
            "127.0.0.1:31080/readyz",
            "127.0.0.1:26080/",
            "127.0.0.1:26081/",
            "local_caddy_healthz",
            "ss -ltnp",
            "manager_absent",
            "worker_crawler_backend_image_match",
        ),
    )
    require_snippets(
        REPAIR,
        (
            "ServerAliveInterval=5",
            "ServerAliveCountMax=2",
            "docker rm -f zenart-manager zenari-manager",
            "docker compose --profile frontend up -d --remove-orphans",
            "docker compose run --rm --entrypoint /app/migrate backend",
            "azure_staging_proxy.sh",
            "azure_staging_origin_diagnostics.sh",
            "stage1_azure_origin_readiness.py",
            "--env \"$ENV_FILE\"",
            "validate_stage1_azure_origin_readiness.py",
        ),
    )
    require_snippets(
        PROXY,
        (
            "reverse_proxy /healthz 127.0.0.1:31080",
            "reverse_proxy /readyz 127.0.0.1:31080",
            "reverse_proxy /api/* 127.0.0.1:31080",
            "reverse_proxy /admin 127.0.0.1:26081",
            "reverse_proxy /admin/* 127.0.0.1:26081",
            "reverse_proxy 127.0.0.1:26080",
            "STAGING_INCLUDE_PRODUCTION_HOSTS",
            "STAGING_PRODUCTION_HOSTS",
            "validate_production_hosts_dns_ready",
            "socket.getaddrinfo",
            "production_host_dns_not_ready",
            "set A/AAAA before enabling STAGING_INCLUDE_PRODUCTION_HOSTS",
            "invalid_production_host",
            "zenari.ai|www.zenari.ai",
            "caddy:2.9-alpine",
        ),
    )
    require_snippets(
        DEPLOY,
        (
            "docker rm -f zenart-manager zenari-manager",
            "docker compose --profile frontend up -d --build --remove-orphans",
            "docker compose run --rm --entrypoint /app/migrate backend",
            "worker/crawler share backend image",
        ),
    )
    print("azure staging origin ops contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
