#!/usr/bin/env python3
"""Validate Stage 1 .env.example coverage and redaction rules.

The real .env may contain local/staging secrets and must stay gitignored. This
validator reads only .env.example plus non-clearing production input metadata.
It makes sure operators can see every required variable name without any real
secret, endpoint credential, or production proof value being persisted.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_EXAMPLE = ROOT / ".env.example"
DEFAULT_MISSING_INPUT_CHECKLIST = (
    ROOT / "ops" / "evidence" / "non_clearing" / "production-missing-input-checklist.json"
)

RAW_SECRET_RE = re.compile(
    r"(?i)(cfat_[A-Za-z0-9_-]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|"
    r"(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|pk_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"whsec_[A-Za-z0-9]{16,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|"
    r"Bearer\s+[A-Za-z0-9._~+/\-=]{8,}|"
    r"Stripe-Signature\s*[:=]|t=\d{8,},v1=[0-9a-f]{16,}|"
    r"X-Amz-Signature|GoogleAccessId)"
)

REQUIRED_BLANK_KEYS = {
    # Staging/external access inputs.
    "STAGING_SSH_HOST",
    "STAGING_SSH_USER",
    "STAGING_SSH_TARGET",
    "STAGING_SSH_KEY",
    "STAGING_REMOTE_DIR",
    "STAGING_PUBLIC_HOST",
    "STAGING_ADMIN_HOST",
    "STAGING_PENDING_DOMAIN",
    "STAGING_API_URL",
    "STAGING_WEB_URL",
    "STAGING_ADMIN_URL",
    "ADMIN_BEARER_TOKEN",
    "ADMIN_SESSION_COOKIE",
    "STAGING_ADMIN_SESSION_COOKIE",
    "SMOKE_ADMIN_USER_ID",
    "SMOKE_ADMIN_TENANT_ID",
    "CSRF_ORIGIN",
    "STAGING_DATABASE_URL",
    "STAGING_QUOTA_REPLAY_API_URL",
    "STAGING_QUOTA_REPLAY_TENANT_ID",
    "STAGING_QUOTA_REPLAY_BATCH_ID",
    "AZURE_SUBSCRIPTION_ID",
    "AZURE_TENANT_ID",
    "AZURE_RESOURCE_GROUP",
    "AZURE_VM_NAME",
    # Production DNS and Cloudflare inputs.
    "PRODUCTION_DNS_TARGET",
    "PRODUCTION_WEB_URL",
    "PRODUCTION_API_URL",
    "PRODUCTION_ADMIN_URL",
    "CLOUDFLARE_ZONE_ID",
    "CF_ZONE_ID",
    "CLOUDFLARE_API_TOKEN",
    "CF_API_TOKEN",
    # Object storage and R2 credentials.
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
    "CLOUDFLARE_ACCOUNT_ID",
    "R2_BUCKET_CREATE_JURISDICTION",
    # Provider and LLM secrets.
    "MALWARE_SCAN_ENDPOINT",
    "MALWARE_SCAN_API_KEY",
    "LLM_OPENAI_BASE_URL",
    "LLM_OPENAI_API_KEY",
    "ZAI_API_KEY",
    "OPENAI_API_KEY",
    # Stripe keys and live proof supporting IDs/refs.
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

REQUIRED_PRESENT_KEYS = {
    "APP_BRAND_NAME",
    "NEXT_PUBLIC_APP_BRAND_NAME",
    "ZENARI_ENV",
    "WEB_PORT",
    "ADMIN_PORT",
    "BACKEND_PORT",
    "DATABASE_URL",
    "REDIS_ADDR",
    "OBJECT_STORAGE_PROVIDER",
    "CHECKOUT_PROVIDER",
    "STRIPE_MODE",
    "LLM_PROVIDER",
    "LLM_OPENAI_MODEL",
}

ALLOWED_NONBLANK_PRODUCTION_INPUT_KEYS = {
    # Local .env.example must default Stripe to sandbox mode; production live
    # mode is only accepted in the real production runtime.
    "STRIPE_MODE": {"test"},
}


class Stage1EnvExampleContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Stage1EnvExampleContractError(message)


def parse_env_example(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError as exc:
        raise Stage1EnvExampleContractError(f"missing {path.relative_to(ROOT)}") from exc
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("'\"")
        require(key, ".env.example contains an empty env key")
        require(key not in values, f".env.example duplicate key: {key}")
        values[key] = value
    return values


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise Stage1EnvExampleContractError(f"missing {path.relative_to(ROOT)}") from exc
    except json.JSONDecodeError as exc:
        raise Stage1EnvExampleContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
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


def accepted_variable_names(checklist: dict[str, Any]) -> list[str]:
    names: list[str] = []
    items = checklist.get("items")
    require(isinstance(items, list), "production missing-input checklist items must be list")
    for idx, item in enumerate(items):
        require(isinstance(item, dict), f"checklist.items[{idx}] must be object")
        accepted = item.get("accepted_variable_names")
        require(isinstance(accepted, list) and accepted, f"checklist.items[{idx}].accepted_variable_names missing")
        for name in accepted:
            text = str(name).strip()
            require(text, f"checklist.items[{idx}] contains blank accepted variable name")
            if text not in names:
                names.append(text)
    return names


def validate_env_example(env_values: dict[str, str], checklist: dict[str, Any], env_text: str) -> None:
    require(git_check_ignore(".env"), ".env must be ignored by git")
    require(not RAW_SECRET_RE.search(env_text), ".env.example contains secret-looking material")

    for key in sorted(REQUIRED_PRESENT_KEYS):
        require(key in env_values, f".env.example missing required Stage 1 key: {key}")

    for key in sorted(REQUIRED_BLANK_KEYS):
        require(key in env_values, f".env.example missing required blank key: {key}")
        require(env_values[key] == "", f".env.example {key} must be blank")

    missing_names = [name for name in accepted_variable_names(checklist) if name not in env_values]
    require(not missing_names, f".env.example missing production checklist variable names: {missing_names}")

    for name in accepted_variable_names(checklist):
        value = env_values.get(name, "")
        if not value:
            continue
        allowed = ALLOWED_NONBLANK_PRODUCTION_INPUT_KEYS.get(name)
        require(allowed is not None and value in allowed, f".env.example production input {name} must be blank")

    stage1_prod_nonblank = sorted(
        key for key, value in env_values.items() if key.startswith("STAGE1_PROD_") and value
    )
    require(not stage1_prod_nonblank, f".env.example Stage 1 production proof keys must be blank: {stage1_prod_nonblank}")

    require(env_values.get("STRIPE_MODE") == "test", ".env.example STRIPE_MODE must default to test")
    require(
        env_values.get("DATABASE_URL") == "postgres://zenari:zenari@postgres:5432/zenari?sslmode=disable",
        ".env.example DATABASE_URL must stay on the local docker-compose placeholder",
    )
    require(env_values.get("LLM_OPENAI_MODEL") == "glm-5.2", ".env.example LLM_OPENAI_MODEL must default to glm-5.2")
    require(env_values.get("LLM_ENABLE_LIVE_CALLS") == "false", ".env.example must not enable live LLM calls")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-example", type=Path, default=DEFAULT_ENV_EXAMPLE)
    parser.add_argument("--missing-input-checklist", type=Path, default=DEFAULT_MISSING_INPUT_CHECKLIST)
    parser.add_argument("--contract-only", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.contract_only:
        require("STRIPE_MODE" in ALLOWED_NONBLANK_PRODUCTION_INPUT_KEYS, "STRIPE_MODE sandbox exception missing")
        require("ZAI_API_KEY" in REQUIRED_BLANK_KEYS, "ZAI_API_KEY blank-key contract missing")
        require("OBJECT_STORAGE_SECRET_KEY" in REQUIRED_BLANK_KEYS, "object storage blank-key contract missing")
        require("AZURE_RESOURCE_GROUP" in REQUIRED_BLANK_KEYS, "Azure Run Command resource group blank-key contract missing")
        require("AZURE_VM_NAME" in REQUIRED_BLANK_KEYS, "Azure Run Command VM name blank-key contract missing")
        print("stage1 env example contract passed")
        return 0
    env_path = args.env_example if args.env_example.is_absolute() else ROOT / args.env_example
    checklist_path = (
        args.missing_input_checklist
        if args.missing_input_checklist.is_absolute()
        else ROOT / args.missing_input_checklist
    )
    env_text = env_path.read_text(encoding="utf-8")
    validate_env_example(parse_env_example(env_path), load_json(checklist_path), env_text)
    print("stage1 env example validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
