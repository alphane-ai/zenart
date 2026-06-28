#!/usr/bin/env python3
"""Validate Stage 1 BE-13 rate-limit/spend-cap local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "rate_limit_spend_cap" / "local_contract.json"
RATELIMIT = ROOT / "backend" / "internal" / "ratelimit" / "ratelimit.go"
RATELIMIT_TESTS = ROOT / "backend" / "internal" / "ratelimit" / "ratelimit_test.go"
CONFIG = ROOT / "backend" / "internal" / "config" / "config.go"
CONFIG_TESTS = ROOT / "backend" / "internal" / "config" / "config_test.go"
SERVER = ROOT / "backend" / "internal" / "server" / "server.go"
MIDDLEWARE = ROOT / "backend" / "internal" / "server" / "middleware.go"
RATELIMIT_CONTEXT = ROOT / "backend" / "internal" / "server" / "ratelimit_context.go"
RUNTIME = ROOT / "backend" / "internal" / "app" / "runtime.go"
ENV_EXAMPLE = ROOT / ".env.example"
COMPOSE = ROOT / "docker-compose.yml"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class RateLimitContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RateLimitContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise RateLimitContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.rate_limit_spend_cap.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "backend_rate_limit_spend_cap_contract", "fixture kind mismatch")
    require({"BE-13", "BL-11", "PR-10", "OP-13"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("backend_package") == "backend/internal/ratelimit", "fixture backend_package mismatch")

    store_contract = data.get("store_contract")
    require(isinstance(store_contract, dict), "store_contract must be object")
    require(store_contract.get("interface") == "Store", "store contract interface mismatch")
    require(store_contract.get("local_store") == "MemoryStore", "local store mismatch")
    require(store_contract.get("production_store") == "RedisStore", "production store mismatch")
    require(store_contract.get("atomic_reservation") is True, "spend cap reservation must be atomic")
    require(store_contract.get("nonlocal_requires_redis") is True, "non-local rate limit must require Redis")

    scopes = data.get("covered_scopes")
    require(isinstance(scopes, list) and len(scopes) >= 4, "covered_scopes must include user, tenant, provider, admin_action")
    scope_names = {item.get("scope") for item in scopes if isinstance(item, dict)}
    require({"user", "tenant", "provider", "admin_action"} <= scope_names, "fixture missing one or more BE-13 scopes")

    routes = data.get("runtime_routes")
    require(isinstance(routes, list) and len(routes) >= 7, "runtime_routes must cover batch, provider, and admin billing routes")
    for route in (
        "POST /api/v1/projects/{project_id}/batch-generations",
        "POST /api/v1/packages/{package_id}/exports",
        "POST /api/admin/v1/providers/registry/{provider_id}/test-call",
        "POST /api/admin/v1/billing/manual-credit",
    ):
        require(route in routes, f"fixture missing runtime route {route}")

    errors = data.get("explainable_error_contract")
    require(isinstance(errors, dict), "explainable_error_contract must be object")
    require({"rate_limit_exceeded", "daily_spend_cap_exceeded", "provider_kill_switch_enabled"} <= set(errors.get("codes") or []), "fixture error codes incomplete")
    require(errors.get("audit_event") == "rate_limit.denied", "fixture audit event mismatch")
    flags = errors.get("audit_metadata_flags")
    require(isinstance(flags, dict), "audit metadata flags must be object")
    for key in ("raw_prompt_included", "raw_provider_payload", "raw_secret_projection"):
        require(flags.get(key) is False, f"{key} must be false")

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_contract") == "pass", "local contract status mismatch")
    require(status.get("staging_evidence") == "open", "staging evidence must remain open")
    require(status.get("production_security_evidence") == "open", "production security evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local contract must not clear production security gate")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")


def validate_code() -> None:
    require_text(
        RATELIMIT,
        (
            "type Enforcer struct",
            "type Store interface",
            "type RedisStore struct",
            "type MemoryStore struct",
            "type Decision struct",
            "ScopeUser",
            "ScopeTenant",
            "ScopeProvider",
            "ScopeAdminAction",
            "CodeRateLimitExceeded",
            "CodeDailySpendCapExceeded",
            "CodeProviderKillSwitchEnabled",
            "AuditMetadata",
            "PublicErrorDetails",
            "reserveScript",
            "raw_prompt_included",
            "raw_provider_payload",
            "raw_secret_projection",
        ),
    )
    require_text(
        RATELIMIT_TESTS,
        (
            "TestUserRateLimitAllowsThenBlocksWithExplainableDecision",
            "TestTenantRateLimitIsTenantScoped",
            "TestProviderSpendCapBlocksWithoutChargingRejectedCost",
            "TestProviderKillSwitchBlocksBeforeSpendReservation",
            "TestAdminActionDenialRequiresAuditMetadataWithoutRawPayloads",
            "TestDisabledPolicyAllowsWithoutCounting",
            "fixture-zai-secret-value",
        ),
    )
    require_text(
        CONFIG,
        (
            "type RateLimitConfig struct",
            "RATELIMIT_ENABLED",
            "RATELIMIT_STORE",
            "RATELIMIT_USER_REQUESTS_PER_MINUTE",
            "RATELIMIT_TENANT_REQUESTS_PER_MINUTE",
            "RATELIMIT_PROVIDER_REQUESTS_PER_MINUTE",
            "RATELIMIT_ADMIN_ACTIONS_PER_MINUTE",
            "RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS",
            "RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH",
            "PROVIDER_DAILY_SPEND_CAP_CENTS",
            "PROVIDER_EMERGENCY_KILL_SWITCH",
            "RATELIMIT_STORE=memory is only allowed when ZENARI_ENV=local",
        ),
    )
    require_text(
        CONFIG_TESTS,
        (
            "TestLoadAcceptsRateLimitConfig",
            "TestLoadRateLimitKeepsLegacyProviderSpendEnvFallback",
            "TestValidateRejectsInvalidRateLimitConfig",
            "TestValidateRejectsRateLimitMemoryStoreOutsideLocal",
        ),
    )
    require_text(
        ENV_EXAMPLE,
        (
            "RATELIMIT_ENABLED=true",
            "RATELIMIT_STORE=memory",
            "RATELIMIT_USER_REQUESTS_PER_MINUTE=60",
            "RATELIMIT_TENANT_REQUESTS_PER_MINUTE=240",
            "RATELIMIT_PROVIDER_REQUESTS_PER_MINUTE=120",
            "RATELIMIT_ADMIN_ACTIONS_PER_MINUTE=30",
            "RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS=0",
            "RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH=false",
        ),
    )
    require_text(
        COMPOSE,
        (
            "RATELIMIT_ENABLED",
            "RATELIMIT_STORE",
            "RATELIMIT_PROVIDER_DAILY_SPEND_CAP_CENTS",
            "RATELIMIT_PROVIDER_EMERGENCY_KILL_SWITCH",
        ),
    )
    require_text(
        MIDDLEWARE,
        (
            "withRateLimit",
            "rateLimitRoute",
            "adminActionRateLimit",
            "recordRateLimitDeniedAudit",
            "rate_limit.denied",
            "ratelimit.PublicErrorDetails",
            "ratelimit.AuditMetadata",
        ),
    )
    require_text(RATELIMIT_CONTEXT, ("ContextWithRateLimiter", "RateLimiterFromContext"))
    require_text(
        SERVER,
        (
            "WithRateLimiter",
            "batch_generation.create",
            "export.create",
            "provider.registry.health_probe",
            "provider.sandbox_test_call",
            "admin.billing.manual_credit",
            "admin.billing.refund_note",
            "admin.billing.subscription_sync",
            "admin.billing.account_lock",
        ),
    )
    require_text(
        RUNTIME,
        (
            "rateLimiterFromConfig",
            "ratelimit.RedisStore",
            "redis.NewClient",
            "ContextWithRateLimiter",
        ),
    )


def validate_repo_wiring() -> None:
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_rate_limit_spend_cap_contract.py",
            "python3 scripts/validate_stage1_rate_limit_spend_cap_contract.py",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-2e",
            "validate_stage1_rate_limit_spend_cap_contract.py",
            "BE-13",
            "Redis-backed staging runtime evidence remains open",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_code()
        validate_repo_wiring()
    except RateLimitContractError as exc:
        print(f"stage1 rate-limit/spend-cap contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 rate-limit/spend-cap contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
