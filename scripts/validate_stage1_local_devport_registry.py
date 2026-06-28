#!/usr/bin/env python3
"""Validate the local Zenari Stage 1 dev-port registry contract.

The registry itself lives at ``~/.devport`` and is intentionally outside this
repository. This validator keeps the local operator registry aligned with the
Stage 1 three-surface boundary: web, admin, and backend are release surfaces;
worker/crawler/migrate are backend runtime entrypoints; manager is legacy
local-only.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DEVPORT = Path.home() / ".devport"
ENV_EXAMPLE = ROOT / ".env.example"
COMPOSE = ROOT / "docker-compose.yml"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"

SECTION_HEADING = "## Zenari Stage0 Rev2 / Stage1 local reservations"
NEXT_SECTION_RE = re.compile(r"^##\s+", re.MULTILINE)

REQUIRED_PORT_CELLS = {
    "Zenari PostgreSQL": "`26432`",
    "Zenari Redis": "`26379`",
    "Zenari MinIO API": "`26900`",
    "Zenari MinIO console": "`26901`",
    "Zenari backend API": "`31080`",
    "Zenari Stripe CLI webhook forward target": "reuses `31080`",
    "Zenari user Web": "`26080`",
    "Zenari admin Web": "`26081`",
    "Zenari admin Playwright validation server": "`26181`",
    "Zenari legacy manager Web": "`26082`",
}

REQUIRED_SECTION_SNIPPETS = (
    "from `/Users/mac/Github/zenart`",
    "BACKEND_PORT=31080",
    "WEB_PORT=26080",
    "ADMIN_PORT=26081",
    "ADMIN_PLAYWRIGHT_PORT=26181",
    "NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:31080",
    "NEXT_PUBLIC_ADMIN_API_BASE_URL=http://127.0.0.1:31080",
    "STRIPE_CLI_FORWARD_TO=http://localhost:31080/api/v1/billing/webhook",
    "backend release unit for API plus worker/crawler/migrate runtime commands",
    "admin console for provider health/routing, provider strategy groups, quota, billing/subscription evidence",
    "temporary Playwright validation server for admin smoke tests",
    "separate from Docker-published admin `26081`",
    "Legacy/non-release local shell only",
    "not a Stage1 release unit, compose service, CI exact Docker image, staging/prod surface, or Playwright blocker",
    "Core admin workflows live under Zenari admin Web",
    "backend/worker/crawler metrics ports",
    "31990-31992",
)

REQUIRED_REPO_SNIPPETS = {
    ENV_EXAMPLE: (
        "WEB_PORT=26080",
        "ADMIN_PORT=26081",
        "ADMIN_PLAYWRIGHT_PORT=26181",
        "BACKEND_PORT=31080",
        "NEXT_PUBLIC_API_BASE_URL=http://localhost:31080",
        "NEXT_PUBLIC_ADMIN_API_BASE_URL=http://localhost:31080",
        "STRIPE_CLI_FORWARD_TO=http://localhost:31080/api/v1/billing/webhook",
    ),
    COMPOSE: (
        "${BACKEND_PORT:-31080}:8080",
        "${WEB_PORT:-26080}:3000",
        "${ADMIN_PORT:-26081}:3001",
        "NEXT_PUBLIC_API_BASE_URL:-http://localhost:31080",
        "NEXT_PUBLIC_ADMIN_API_BASE_URL:-http://localhost:31080",
        "not independent Stage 1 release images",
        "runtime entrypoints",
    ),
    BLUEPRINT: (
        "release image 闭集只能是 `web`、`admin`、`backend`",
        "Worker、crawler、migrate 是 backend 镜像/二进制内的运行命令和进程形态",
        "`manager/` 是 legacy 本地 shell，不是独立上线业务面",
    ),
}

SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)"
)


class DevportRegistryError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise DevportRegistryError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise DevportRegistryError(f"missing {display_path(path)}") from exc


def zenari_section(devport_text: str) -> str:
    start = devport_text.find(SECTION_HEADING)
    require(start >= 0, f"{display_path(DEFAULT_DEVPORT)} missing {SECTION_HEADING!r}")
    next_match = NEXT_SECTION_RE.search(devport_text, start + len(SECTION_HEADING))
    end = next_match.start() if next_match else len(devport_text)
    section = devport_text[start:end]
    require(section.strip(), "Zenari devport section is empty")
    return section


def validate_repo_contract() -> None:
    for path, snippets in REQUIRED_REPO_SNIPPETS.items():
        text = read_text(path)
        for snippet in snippets:
            require(snippet in text, f"{display_path(path)} missing {snippet!r}")


def validate_devport(path: Path) -> None:
    text = read_text(path)
    require(not SECRET_RE.search(text), f"{display_path(path)} contains secret-looking material")
    require("Zenari Stage0 Rev2 / Stage1 local reservations" in text, "Zenari devport section missing")
    section = zenari_section(text)

    for service, port_cell in REQUIRED_PORT_CELLS.items():
        row_re = re.compile(rf"^\|\s*{re.escape(service)}\s*\|\s*{re.escape(port_cell)}\s*\|", re.MULTILINE)
        require(row_re.search(section) is not None, f"Zenari devport section missing {service} port cell {port_cell}")

    for snippet in REQUIRED_SECTION_SNIPPETS:
        require(snippet in section, f"Zenari devport section missing {snippet!r}")

    require("Zenari manager Web | `26082`" not in section, "manager row must be explicitly legacy manager Web")
    require("release unit" in section and "legacy manager" in section, "manager non-release status must be documented")
    require("worker/crawler/migrate" in section, "backend runtime entrypoint scope must name worker/crawler/migrate")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--devport", type=Path, default=DEFAULT_DEVPORT)
    parser.add_argument("--contract-only", action="store_true", help="validate repository anchors only")
    parser.add_argument(
        "--allow-missing-devport",
        action="store_true",
        help="skip the external ~/.devport read when the file is absent",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        validate_repo_contract()
        if args.contract_only:
            print("stage1 local devport registry contract passed")
            return 0
        if not args.devport.exists() and args.allow_missing_devport:
            print(f"stage1 local devport registry skipped: missing {display_path(args.devport)}")
            return 0
        validate_devport(args.devport)
    except DevportRegistryError as exc:
        raise SystemExit(f"stage1 local devport registry validation failed: {exc}") from exc
    print("stage1 local devport registry validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
