#!/usr/bin/env python3
"""Guard Stage 1 scope, local ports, and secret placeholder policy."""

from __future__ import annotations

import re
import subprocess
import sys
import json
from pathlib import Path

import validate_stage1_blueprint


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
ENV_EXAMPLE = ROOT / ".env.example"
DOCKER_COMPOSE = ROOT / "docker-compose.yml"
STRIPE_SELFTEST = ROOT / "scripts" / "stripe_sandbox_selftest.sh"

REAL_STRIPE_KEY_RE = re.compile(r"\b(?:sk|pk)_(?:test|live)_[A-Za-z0-9]{20,}\b")
REAL_ZAI_KEY_RE = re.compile(r"\b[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}\b")

REQUIRED_ENV_LINES = {
    "WEB_PORT=26080",
    "ADMIN_PORT=26081",
    "BACKEND_IMAGE=zenari-backend:local",
    "BACKEND_PORT=31080",
    "POSTGRES_PORT=26432",
    "REDIS_PORT=26379",
    "METRICS_PORT=31990",
    "WORKER_METRICS_PORT=31991",
    "CRAWLER_METRICS_PORT=31992",
    "APP_BRAND_NAME=zenari.ai",
    "APP_PUBLIC_DOMAIN=zenari.ai",
    "LLM_PROVIDER=openai-compatible",
    "LLM_OPENAI_BASE_URL=",
    "LLM_OPENAI_API_KEY=",
    "LLM_ENABLE_LIVE_CALLS=false",
}

BLANK_EXAMPLE_ENV_KEYS = {
    "LLM_OPENAI_BASE_URL",
    "LLM_OPENAI_API_KEY",
    "ZAI_API_KEY",
    "OPENAI_API_KEY",
    "STRIPE_API_BASE_URL",
    "STRIPE_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "BILLING_WEBHOOK_SECRET",
    "STRIPE_SANDBOX_PRODUCT_ID",
    "STRIPE_DEFAULT_PRICE_ID",
}

REQUIRED_ENV_KEYS = {
    "OBJECT_STORAGE_PROVIDER",
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_PUBLIC_ENDPOINT",
    "OBJECT_STORAGE_REGION",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
    "OBJECT_STORAGE_USE_SSL",
    "OBJECT_STORAGE_FORCE_PATH_STYLE",
    "OBJECT_STORAGE_LOCAL_ROOT",
    "OBJECT_STORAGE_SIGNING_KEY",
    "OBJECT_STORAGE_DOWNLOAD_URL_TTL",
    "OBJECT_STORAGE_CHECK_TIMEOUT",
    "MINIO_ROOT_USER",
    "MINIO_ROOT_PASSWORD",
    "MINIO_API_PORT",
    "MINIO_CONSOLE_PORT",
}

REQUIRED_COMPOSE_SNIPPETS = (
    "${WEB_PORT:-26080}:3000",
    "${ADMIN_PORT:-26081}:3001",
    "${BACKEND_PORT:-31080}:8080",
    "${POSTGRES_PORT:-26432}:5432",
    "${REDIS_PORT:-26379}:6379",
    "${MINIO_API_PORT:-26900}:9000",
    "${MINIO_CONSOLE_PORT:-26901}:9001",
    "image: ${BACKEND_IMAGE:-zenari-backend:local}",
    'entrypoint: ["/app/worker"]',
    "LLM_OPENAI_BASE_URL: ${LLM_OPENAI_BASE_URL:-https://api.z.ai/api/coding/paas/v4}",
)

RELEASE_IMAGES = {"backend", "web", "admin"}
NON_RELEASE_IMAGES = {"manager", "worker", "crawler", "migrate"}

IGNORED_SCAN_DIRS = {
    ".git",
    "node_modules",
    ".next",
    "coverage",
    "dist",
    "build",
    ".docker-data",
}

SCAN_SUFFIXES = {
    ".go",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".json",
    ".md",
    ".yaml",
    ".yml",
    ".sh",
    ".py",
    ".example",
}


class Stage1ScopeGuardError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1ScopeGuardError(message)


def load_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise Stage1ScopeGuardError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    return data


def git_check_ignore(path: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", path],
        cwd=ROOT,
        text=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def iter_scanned_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        rel_parts = path.relative_to(ROOT).parts
        if any(part in IGNORED_SCAN_DIRS for part in rel_parts):
            continue
        if not path.is_file():
            continue
        if path.name == ".env":
            continue
        if path.suffix in SCAN_SUFFIXES or path.name in {".env.example", "Dockerfile"}:
            files.append(path)
    return files


def validate_secret_policy() -> None:
    env_text = ENV_EXAMPLE.read_text(encoding="utf-8")
    env_values = {
        line.split("=", 1)[0].strip(): line.split("=", 1)[1].strip()
        for line in env_text.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }
    require(not REAL_STRIPE_KEY_RE.search(env_text), ".env.example must not contain real Stripe keys")
    require(not REAL_ZAI_KEY_RE.search(env_text), ".env.example must not contain real z.ai/OpenAI-compatible keys")
    for key in sorted(BLANK_EXAMPLE_ENV_KEYS):
        require(key in env_values, f".env.example missing {key}")
        require(env_values[key] == "", f".env.example {key} must be blank")
    require(git_check_ignore(".env"), ".env must be ignored by git")

    leaked = []
    for path in iter_scanned_files():
        text = path.read_text(encoding="utf-8", errors="ignore")
        if REAL_ZAI_KEY_RE.search(text):
            leaked.append(str(path.relative_to(ROOT)))
    require(not leaked, f"possible z.ai/OpenAI-compatible key leaked into repo files: {leaked}")


def validate_env_and_compose() -> None:
    env_text = ENV_EXAMPLE.read_text(encoding="utf-8")
    compose_text = DOCKER_COMPOSE.read_text(encoding="utf-8")
    for required in sorted(REQUIRED_ENV_LINES):
        require(required in env_text, f".env.example missing {required}")
    env_keys = {
        line.split("=", 1)[0].strip()
        for line in env_text.splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    }
    for required in sorted(REQUIRED_ENV_KEYS):
        require(required in env_keys, f".env.example missing {required}")
    for required in REQUIRED_COMPOSE_SNIPPETS:
        require(required in compose_text, f"docker-compose.yml missing {required}")
    require(STRIPE_SELFTEST.exists(), "missing scripts/stripe_sandbox_selftest.sh")
    require(STRIPE_SELFTEST.stat().st_mode & 0o111 != 0, "scripts/stripe_sandbox_selftest.sh must be executable")


def validate_release_surface() -> None:
    blueprint_text = DEFAULT_BLUEPRINT.read_text(encoding="utf-8")
    compose_text = DOCKER_COMPOSE.read_text(encoding="utf-8")
    require(
        "release image 闭集只能是 `web`、`admin`、`backend`" in blueprint_text,
        "Stage 1 blueprint must define release images as web/admin/backend only",
    )
    require("source-only legacy local shell" in blueprint_text, "Stage 1 blueprint must mark manager as source-only legacy local")
    require(
        "禁止 manager/worker/crawler/migrate 作为独立 release image" in blueprint_text,
        "Stage 1 blueprint must forbid manager/worker/crawler/migrate release images",
    )
    require("image: ${BACKEND_IMAGE:-zenari-backend:local}" in compose_text, "backend services must share BACKEND_IMAGE")
    require(
        compose_text.count("image: ${BACKEND_IMAGE:-zenari-backend:local}") == 3,
        "backend, worker, and crawler must share exactly one backend image reference",
    )
    require(
        compose_text.count("build: *backend-build") == 1,
        "only the backend service may build BACKEND_IMAGE; worker and crawler must reuse the built backend image",
    )
    require("\n  manager:" not in compose_text, "manager must not be a docker-compose service")
    require("context: ./manager" not in compose_text, "manager must not be a docker image build context")
    require(not (ROOT / "manager" / "Dockerfile").exists(), "manager must not have a Dockerfile")
    require('profiles: ["frontend"]' in compose_text, "web/admin frontend profile must remain available")

    docker_smoke = (ROOT / "scripts" / "docker_build_smoke.sh").read_text(encoding="utf-8")
    require('IMAGE_SET="${IMAGE_SET:-backend web admin}"' in docker_smoke, "docker smoke image set must be backend/web/admin")
    require("worker\n# is not a standalone release image" in docker_smoke, "docker smoke must document worker as non-standalone")

    repo_validate = (ROOT / "scripts" / "repo_validate.sh").read_text(encoding="utf-8")
    require(
        "ZENARI_VALIDATE_LEGACY_MANAGER" in repo_validate,
        "repo_validate must keep manager behind explicit legacy validation",
    )
    require(
        "manager legacy local shell" in repo_validate,
        "repo_validate must document manager as a legacy local shell",
    )
    require(
        "SKIP_STRIPE_SANDBOX_SELFTEST" in repo_validate,
        "repo_validate must run Stripe sandbox selftest by default when local env and Stripe CLI are configured",
    )
    require(
        "RUN_STRIPE_SANDBOX_LIVE_SELFTEST" not in repo_validate,
        "repo_validate must not require a manual RUN_STRIPE_SANDBOX_LIVE_SELFTEST opt-in for the Stage 1 Stripe sandbox baseline",
    )

    ci_validator = (ROOT / "scripts" / "validate_stage1_ci_exact_evidence.py").read_text(encoding="utf-8")
    require("RELEASE_IMAGE_SET" in ci_validator, "CI exact validator must enforce closed release image set")

    proxy_script = (ROOT / "scripts" / "azure_staging_proxy.sh").read_text(encoding="utf-8")
    require("STAGING_EXPOSE_LEGACY_MANAGER" not in proxy_script, "azure staging proxy must not expose legacy manager")
    require("STAGING_MANAGER_HOST" not in proxy_script, "azure staging proxy must not define a manager host")
    require(
        "26082" not in proxy_script and "reverse_proxy /manager" not in proxy_script,
        "azure staging proxy must not expose /manager on the default public host",
    )

    release_contract = load_json(ROOT / "fixtures" / "stage1" / "release_metadata" / "local_contract.json")
    required_names = set(release_contract.get("required_image_names") or [])
    require(required_names == RELEASE_IMAGES, f"release metadata required_image_names must be exactly {sorted(RELEASE_IMAGES)}")
    forbidden_names = set(release_contract.get("forbidden_release_image_names") or [])
    require(NON_RELEASE_IMAGES <= forbidden_names, "release metadata contract must forbid manager/worker/crawler/migrate images")


def validate(path: Path) -> None:
    validate_stage1_blueprint.validate(path)
    validate_secret_policy()
    validate_env_and_compose()
    validate_release_surface()


def main() -> int:
    path = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_BLUEPRINT
    try:
        validate(path)
    except (Stage1ScopeGuardError, validate_stage1_blueprint.Stage1BlueprintError) as exc:
        print(f"stage1 scope guard failed: {exc}", file=sys.stderr)
        return 1
    print(f"stage1 scope guard passed: {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
