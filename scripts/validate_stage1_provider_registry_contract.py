#!/usr/bin/env python3
"""Validate Stage 1 provider registry contract fixtures and code anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "provider_registry" / "sandbox_registry.json"
PROVIDER_CONTRACT = ROOT / "backend" / "internal" / "provider" / "registry.go"
PROVIDER_BASE = ROOT / "backend" / "internal" / "provider" / "provider.go"
PROVIDER_OPENAI = ROOT / "backend" / "internal" / "provider" / "openai_compatible.go"
WORKER_MAIN = ROOT / "backend" / "cmd" / "worker" / "main.go"
CONFIG_CONTRACT = ROOT / "backend" / "internal" / "config" / "config.go"
SERVER_CONTRACT = ROOT / "backend" / "internal" / "server" / "server.go"
BATCH_ROUTING = ROOT / "backend" / "internal" / "task" / "batch_routing.go"
BATCH_REPOSITORY = ROOT / "backend" / "internal" / "task" / "batch_repository.go"
BATCH_ROUTING_TEST = ROOT / "backend" / "internal" / "task" / "batch_routing_test.go"
APP_RUNTIME = ROOT / "backend" / "internal" / "app" / "runtime.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
ADMIN_GENERATED = ROOT / "admin" / "lib" / "generated" / "zenart-api.ts"
ADMIN_ACTIONS = ROOT / "admin" / "app" / "providers" / "actions.ts"
ADMIN_CONTROLS = ROOT / "admin" / "app" / "providers" / "ProviderRegistryControls.tsx"
MIGRATION = ROOT / "backend" / "migrations" / "0011_stage1_provider_batch_contracts.sql"

MODES = {"dev", "sandbox", "production"}
STATUSES = {"enabled", "disabled", "kill_switch"}
STRATEGY_SELECTION_POLICIES = {"weighted", "priority", "canary", "failover"}
SECRET_REF_RE = re.compile(r"^(secrets|vault|aws-sm|gcp-sm|doppler|infisical|1password)/[A-Za-z0-9._:/-]+$")
RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{20,}|[0-9a-f]{32}\.[A-Za-z0-9_-]{16,})"
)
USER_FORBIDDEN_KEYS = {
    "secret",
    "secret_ref",
    "secret_present",
    "routing",
    "weight",
    "canary_percent",
    "max_concurrency",
    "fallback_provider_ids",
    "kill_switch",
    "health",
    "latency_ms",
    "error_rate_percent",
    "estimated_cost_cents",
    "max_cost_units",
    "cost_currency",
}


class ProviderRegistryContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProviderRegistryContractError(message)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ProviderRegistryContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    return data


def require_text(path: Path, snippets: tuple[str, ...]) -> None:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    text = path.read_text(encoding="utf-8")
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing contract snippet {snippet!r}")


def walk_user_projection(value: Any, path: str = "user_projection") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            require(key.lower() not in USER_FORBIDDEN_KEYS, f"{path}.{key} exposes admin/provider-only field")
            walk_user_projection(child, f"{path}.{key}")
    elif isinstance(value, list):
        for idx, child in enumerate(value):
            walk_user_projection(child, f"{path}[{idx}]")
    elif isinstance(value, str):
        require(not RAW_SECRET_RE.search(value), f"{path} contains a raw secret-looking value")


def validate_capability(provider_id: str, capability: dict[str, Any]) -> None:
    require(capability.get("provider_id") == provider_id, f"{provider_id} capability provider_id mismatch")
    for key in ("model_id", "endpoints", "input_types", "output_types"):
        require(key in capability, f"{provider_id} capability missing {key}")
    require(isinstance(capability["model_id"], str) and capability["model_id"], f"{provider_id} capability model_id required")
    for key in ("endpoints", "input_types", "output_types"):
        values = capability[key]
        require(isinstance(values, list) and values and all(isinstance(item, str) and item for item in values), f"{provider_id} capability {key} must be non-empty strings")
    for key in ("max_cost_units", "estimated_cost_cents"):
        value = capability.get(key, 0)
        require(isinstance(value, int) and value >= 0, f"{provider_id} capability {key} must be non-negative int")
    supports_batch = capability.get("supports_batch")
    require(isinstance(supports_batch, bool), f"{provider_id} capability supports_batch must be boolean")
    max_batch_size = capability.get("max_batch_size", 1)
    require(isinstance(max_batch_size, int) and max_batch_size >= 1, f"{provider_id} max_batch_size must be positive")
    if supports_batch:
        require(max_batch_size >= 2, f"{provider_id} batch-capable model must declare max_batch_size >= 2")
    for key in ("supports_seed", "supports_cancel"):
        require(isinstance(capability.get(key), bool), f"{provider_id} capability {key} must be boolean")


def validate_provider(provider: dict[str, Any]) -> None:
    provider_id = provider.get("provider_id")
    require(isinstance(provider_id, str) and provider_id, "provider_id is required")
    require(isinstance(provider.get("display_name"), str) and provider["display_name"], f"{provider_id} display_name is required")
    require(provider.get("mode") in MODES, f"{provider_id} unsupported mode {provider.get('mode')!r}")
    require(provider.get("status") in STATUSES, f"{provider_id} unsupported status {provider.get('status')!r}")
    secret_ref = provider.get("secret_ref", "")
    require(isinstance(secret_ref, str), f"{provider_id} secret_ref must be string")
    require(not RAW_SECRET_RE.search(secret_ref), f"{provider_id} secret_ref contains a raw secret-looking value")
    if provider["mode"] != "dev":
        require(SECRET_REF_RE.match(secret_ref) is not None, f"{provider_id} sandbox/production provider must use a secret manager ref")
    capabilities = provider.get("capabilities")
    require(isinstance(capabilities, list) and capabilities, f"{provider_id} capabilities must be non-empty")
    for capability in capabilities:
        require(isinstance(capability, dict), f"{provider_id} capability must be object")
        validate_capability(provider_id, capability)
    routing = provider.get("routing")
    require(isinstance(routing, dict), f"{provider_id} routing must be object")
    require(isinstance(routing.get("weight"), int) and routing["weight"] >= 0, f"{provider_id} routing.weight must be non-negative")
    require(isinstance(routing.get("canary_percent"), int) and 0 <= routing["canary_percent"] <= 100, f"{provider_id} canary_percent must be 0..100")
    require(isinstance(routing.get("max_concurrency"), int) and routing["max_concurrency"] >= 0, f"{provider_id} max_concurrency must be non-negative")
    require(isinstance(routing.get("kill_switch"), bool), f"{provider_id} kill_switch must be boolean")
    health = provider.get("health")
    require(isinstance(health, dict), f"{provider_id} health must be object")
    require(isinstance(health.get("available"), bool), f"{provider_id} health.available must be boolean")
    require(isinstance(health.get("latency_ms"), int) and health["latency_ms"] >= 0, f"{provider_id} latency_ms must be non-negative")
    require(isinstance(health.get("error_rate_percent"), int) and 0 <= health["error_rate_percent"] <= 100, f"{provider_id} error_rate_percent must be 0..100")
    metadata = provider.get("metadata", {})
    require(isinstance(metadata, dict), f"{provider_id} metadata must be object")
    for key, value in metadata.items():
        require(not RAW_SECRET_RE.search(str(key)), f"{provider_id} metadata key looks secret-bearing")
        require(not RAW_SECRET_RE.search(str(value)), f"{provider_id} metadata value looks secret-bearing")


def validate_strategy_group_member(group_id: str, member: dict[str, Any], provider_ids: set[str], external_provider_ids: set[str] | None = None) -> None:
    external_provider_ids = external_provider_ids or set()
    provider_id = member.get("provider_id")
    require(isinstance(provider_id, str) and provider_id, f"{group_id} strategy group member provider_id is required")
    require(provider_id in provider_ids or provider_id in external_provider_ids, f"{group_id} strategy group member references unknown provider {provider_id!r}")
    require(not RAW_SECRET_RE.search(provider_id), f"{group_id} strategy group member provider_id contains raw secret-looking value")
    for key in ("weight", "max_concurrency", "fallback_rank"):
        value = member.get(key)
        require(isinstance(value, int) and value >= 0, f"{group_id} strategy group member {provider_id} {key} must be non-negative int")
    canary_percent = member.get("canary_percent")
    require(isinstance(canary_percent, int) and 0 <= canary_percent <= 100, f"{group_id} strategy group member {provider_id} canary_percent must be 0..100")
    require(isinstance(member.get("enabled"), bool), f"{group_id} strategy group member {provider_id} enabled must be boolean")


def validate_strategy_group(group: dict[str, Any], provider_ids: set[str], external_provider_ids: set[str] | None = None) -> None:
    external_provider_ids = external_provider_ids or set()
    group_id = group.get("group_id")
    require(isinstance(group_id, str) and group_id, "strategy group group_id is required")
    require(isinstance(group.get("display_name"), str) and group["display_name"], f"{group_id} display_name is required")
    require(isinstance(group.get("tool_type"), str) and group["tool_type"], f"{group_id} tool_type is required")
    require(group.get("status") in STATUSES, f"{group_id} status invalid")
    require(group.get("selection_policy") in STRATEGY_SELECTION_POLICIES, f"{group_id} selection_policy invalid")
    require(isinstance(group.get("kill_switch"), bool), f"{group_id} kill_switch must be boolean")
    if group.get("status") == "kill_switch":
        require(group.get("kill_switch") is True, f"{group_id} kill_switch status must set kill_switch=true")
    require(not RAW_SECRET_RE.search(json.dumps(group, ensure_ascii=False)), f"{group_id} strategy group contains raw secret-looking value")
    fallback_provider_ids = group.get("fallback_provider_ids", [])
    require(isinstance(fallback_provider_ids, list), f"{group_id} fallback_provider_ids must be array")
    for provider_id in fallback_provider_ids:
        require(isinstance(provider_id, str) and provider_id, f"{group_id} fallback provider_id must be non-empty string")
        require(provider_id in provider_ids or provider_id in external_provider_ids, f"{group_id} fallback references unknown provider {provider_id!r}")
    members = group.get("members")
    require(isinstance(members, list) and members, f"{group_id} members must be non-empty array")
    seen_members: set[str] = set()
    enabled_members = 0
    for member in members:
        require(isinstance(member, dict), f"{group_id} strategy group member must be object")
        validate_strategy_group_member(group_id, member, provider_ids, external_provider_ids)
        member_provider_id = str(member["provider_id"])
        require(member_provider_id not in seen_members, f"{group_id} duplicate strategy group member {member_provider_id}")
        seen_members.add(member_provider_id)
        if member.get("enabled") is True:
            enabled_members += 1
    require(enabled_members > 0, f"{group_id} must leave at least one strategy member enabled")
    metadata = group.get("metadata", {})
    require(isinstance(metadata, dict), f"{group_id} metadata must be object")
    for key, value in metadata.items():
        require(isinstance(key, str) and isinstance(value, str), f"{group_id} metadata must be string map")
        require(not RAW_SECRET_RE.search(key) and not RAW_SECRET_RE.search(value), f"{group_id} metadata contains raw secret-looking value")


def validate() -> None:
    require_text(
        PROVIDER_BASE,
        (
            "SupportsBatch",
            "MaxBatchSize",
            "SupportsSeed",
            "SupportsCancel",
            "SupportedAspectRatios",
            "SupportedQualities",
        ),
    )
    require_text(
        PROVIDER_OPENAI,
        (
            "OpenAICompatibleProvider",
            "OpenAICompatibleConfig",
            "LiveCallsEnabled",
            "chat/completions",
            "Authorization",
            "openai_compatible_chat_completions_v1",
            "prompt_hash",
            "security.RedactString",
            "openAICompatibleErrorSummary",
            "body_sha256=",
            "sanitizeProviderErrorToken",
        ),
    )
    require_text(
        ROOT / "backend" / "internal" / "provider" / "openai_compatible_test.go",
        (
            "TestOpenAICompatibleProviderHTTPErrorDoesNotLeakSecretOrBody",
            "request_id=req_provider_429",
            "body_sha256=",
            "raw_provider_payload",
        ),
    )
    require_text(
        WORKER_MAIN,
        (
            "batchProviderClientsFromConfig",
            "LLM.EnableLiveCalls",
            "openai-compatible",
            "OpenAICompatibleProvider",
            "zenari-image-sandbox",
            "provider.DevProvider",
            "WithStrategyGroupReader",
        ),
    )
    require_text(
        CONFIG_CONTRACT,
        (
            "LLM_OPENAI_BASE_URL",
            "LLM_OPENAI_API_KEY",
            "ZAI_API_KEY",
            "OPENAI_API_KEY",
            "LLM_OPENAI_MODEL",
            "LLM_ENABLE_LIVE_CALLS",
            "openai-compatible",
            "LLM_OPENAI_API_KEY, ZAI_API_KEY, or OPENAI_API_KEY must be set to a non-placeholder value when LLM_ENABLE_LIVE_CALLS=true",
        ),
    )
    require_text(
        ROOT / "scripts" / "openai_compatible_provider_selftest.sh",
        (
            "LLM_OPENAI_BASE_URL",
            "LLM_OPENAI_API_KEY",
            "ZAI_API_KEY",
            "OPENAI_API_KEY",
            "LLM_OPENAI_MODEL",
            "models_url",
            "chat_completions_url",
            "summarize_provider_error_body",
            "provider_quota_unavailable",
            "provider_retryable_http_error",
            "invalid_api_key",
            "Insufficient balance or no resource package",
            "chat_completion_chars",
            "openai-compatible provider selftest passed",
        ),
    )
    require_text(
        PROVIDER_CONTRACT,
        (
            "RegistryEntry",
            "SecretRef",
            "AdminProjection",
            "PublicModelProjections",
            "ValidateRegistryEntry",
            "containsSecretValue",
            "CreateAdminRegistry",
            "RegistryCreateResult",
            "UpdateAdminRegistry",
            "RegistryUpdateResult",
            "DeleteAdminRegistry",
            "RegistryDeleteResult",
            "ProbeAdminRegistryHealth",
            "RegistryHealthProbeResult",
            "HealthSnapshot",
            "SetCapability",
            "replaceCapabilities",
            "RunSandboxTestCall",
            "SandboxTestCallResult",
            "StrategySelectionPolicy",
            "StrategyGroup",
            "StrategyGroupMember",
            "StrategyGroupCreate",
            "StrategyGroupUpdate",
            "ListStrategyGroups",
            "CreateStrategyGroup",
            "UpdateStrategyGroup",
            "ValidateStrategyGroup",
            "ValidateStrategyGroupMember",
            "replaceStrategyGroupMembers",
        ),
    )
    require_text(
        BATCH_ROUTING,
        (
            "StrategyGroupReader",
            "BatchRoutingDecision",
            "SelectBatchRoutingProvider",
            "strategyGroupMatchesTool",
            "kill_switch_fallback",
            "failover_primary",
            "weighted_slot",
            "canary_percent",
        ),
    )
    require_text(
        BATCH_REPOSITORY,
        (
            "WithStrategyGroupReader",
            "routeBatchChild",
            "routing_strategy_group_id",
            "routing_selection_policy",
            "routing_selection_reason",
            "routing_fallback_providers",
            "routing_considered",
        ),
    )
    require_text(
        BATCH_ROUTING_TEST,
        (
            "TestSelectBatchRoutingProviderUsesWeightedStrategyGroup",
            "TestSelectBatchRoutingProviderUsesKillSwitchFallback",
            "TestSelectBatchRoutingProviderUsesFailoverRank",
            "TestBatchRepositoryCreateBatchAppliesStrategyGroupMetadata",
        ),
    )
    require_text(
        APP_RUNTIME,
        (
            "providerRegistry := provider.NewRegistryRepository(db)",
            "WithStrategyGroupReader(providerRegistry)",
            "provider.ContextWithRegistryReader(reqCtx, providerRegistry)",
        ),
    )
    require_text(
        SERVER_CONTRACT,
        (
            "POST /api/admin/v1/providers/registry",
            "PATCH /api/admin/v1/providers/registry/{provider_id}",
            "DELETE /api/admin/v1/providers/registry/{provider_id}",
            "POST /api/admin/v1/providers/registry/{provider_id}/health-probe",
            "POST /api/admin/v1/providers/registry/{provider_id}/test-call",
            "provider.registry.create",
            "provider.registry.update",
            "provider.registry.delete",
            "provider.registry.health_probe",
            "provider.sandbox_test_call",
            "provider_registry_audit_not_connected",
            "provider_registry_rationale_required",
            "CreateAdminRegistry",
            "DeleteAdminRegistry",
            "ProbeAdminRegistryHealth",
            "provider_health_probe_rationale_required",
            "reference_changed",
            "capabilities_changed",
            "provider_test_call_rationale_required",
            "GET /api/admin/v1/providers/strategy-groups",
            "POST /api/admin/v1/providers/strategy-groups",
            "PATCH /api/admin/v1/providers/strategy-groups/{group_id}",
            "provider.strategy_group.create",
            "provider.strategy_group.update",
            "provider_strategy_group_rationale_required",
            "provider_strategy_group_audit_not_connected",
            "providerStrategyGroupAuditMetadata",
        ),
    )
    require_text(
        OPENAPI,
        (
            "operationId: createProviderRegistry",
            "operationId: updateProviderRegistry",
            "operationId: deleteProviderRegistry",
            "operationId: probeProviderRegistryHealth",
            "operationId: runProviderSandboxTestCall",
            "x-idempotency-required: true",
            "ProviderRegistryCreate",
            "ProviderRegistryCreateResult",
            "ProviderRegistryUpdate",
            "ProviderRegistryUpdateResult",
            "ProviderRegistryDelete",
            "ProviderRegistryDeleteResult",
            "ProviderRegistryHealthProbe",
            "ProviderRegistryHealthProbeResult",
            "secret_ref:",
            "capabilities:",
            "ProviderSandboxTestCallCreate",
            "ProviderSandboxTestCallResult",
            "operationId: listProviderStrategyGroups",
            "operationId: createProviderStrategyGroup",
            "operationId: updateProviderStrategyGroup",
            "ProviderStrategyGroupMember",
            "ProviderStrategyGroup",
            "ProviderStrategyGroupPage",
            "ProviderStrategyGroupCreate",
            "ProviderStrategyGroupCreateResult",
            "ProviderStrategyGroupUpdate",
            "ProviderStrategyGroupUpdateResult",
        ),
    )
    require_text(
        ADMIN_GENERATED,
        (
            "createProviderRegistry",
            "updateProviderRegistry",
            "deleteProviderRegistry",
            "probeProviderRegistryHealth",
            "runProviderSandboxTestCall",
            "listProviderStrategyGroups",
            "createProviderStrategyGroup",
            "updateProviderStrategyGroup",
        ),
    )
    require_text(
        ADMIN_ACTIONS,
        (
            "createProviderRegistryAction",
            "updateProviderRegistryAction",
            "deleteProviderRegistryAction",
            "probeProviderRegistryHealthAction",
            "runProviderSandboxTestCallAction",
            "/api/admin/v1/providers/registry",
            "health-probe",
            "method: \"DELETE\"",
            "X-Zenari-CSRF",
            "Idempotency-Key",
            "createProviderStrategyGroupAction",
            "updateProviderStrategyGroupAction",
            "/api/admin/v1/providers/strategy-groups",
            "strategyMembersFromFormData",
            "strategyMetadataField",
        ),
    )
    require_text(
        ADMIN_CONTROLS,
        (
            "Create Provider",
            "Save Routing",
            "Run Test Call",
            "Probe Health",
            "Delete Provider",
            "createProviderRegistryAction",
            "deleteProviderRegistryAction",
            "probeProviderRegistryHealthAction",
            "Create Strategy Group",
            "Save Strategy Group",
            "Selection policy",
            "Member provider IDs",
            "Kill switch group",
        ),
    )
    require_text(
        MIGRATION,
        (
            "CREATE TABLE IF NOT EXISTS provider_registry",
            "CREATE TABLE IF NOT EXISTS provider_model_capabilities",
            "CREATE TABLE IF NOT EXISTS provider_strategy_groups",
            "CREATE TABLE IF NOT EXISTS provider_strategy_group_members",
            "provider_registry_secret_ref_check",
            "provider_model_capability_batch_size_check",
            "provider_strategy_group_selection_policy_check",
            "provider_strategy_group_kill_switch_check",
            "idx_provider_strategy_groups_tool_status",
            "idx_provider_strategy_group_members_provider",
        ),
    )
    data = load_json(FIXTURE)
    require(data.get("fixture_id") == "sandbox_registry", "provider registry fixture_id mismatch")
    require(data.get("contract_version") == 1, "provider registry contract_version must be 1")
    providers = data.get("providers")
    require(isinstance(providers, list) and providers, "providers must be a non-empty array")
    for provider in providers:
        require(isinstance(provider, dict), "provider entry must be object")
        validate_provider(provider)
    provider_ids = {provider["provider_id"] for provider in providers}
    require("zenari-image-sandbox" in provider_ids, "fixture must include sandbox image provider")
    require("dev" in provider_ids, "fixture must include deterministic dev provider")
    sandbox_provider = next(provider for provider in providers if provider["provider_id"] == "zenari-image-sandbox")
    sandbox_metadata = sandbox_provider.get("metadata", {})
    require(sandbox_metadata.get("adapter") == "openai-compatible", "sandbox provider metadata must declare openai-compatible adapter")
    require(sandbox_metadata.get("adapter_endpoint_version") == "openai_compatible_chat_completions_v1", "sandbox provider metadata must declare chat completions endpoint version")
    require(sandbox_metadata.get("config_base_url_env") == "LLM_OPENAI_BASE_URL", "sandbox provider metadata must reference LLM_OPENAI_BASE_URL")
    require(sandbox_metadata.get("config_live_calls_env") == "LLM_ENABLE_LIVE_CALLS", "sandbox provider metadata must reference LLM_ENABLE_LIVE_CALLS")
    require(
        sandbox_metadata.get("config_api_key_aliases") == ["LLM_OPENAI_API_KEY", "ZAI_API_KEY", "OPENAI_API_KEY"],
        "sandbox provider metadata must declare safe API key alias names without values",
    )
    require("config_api_key_env" not in sandbox_metadata, "sandbox provider public metadata must not expose API key env metadata")
    admin_projection = data.get("admin_projection")
    require(isinstance(admin_projection, list), "admin_projection must be array")
    projected_admin_ids = {item.get("provider_id") for item in admin_projection if isinstance(item, dict)}
    require(projected_admin_ids == provider_ids, "admin_projection must cover all providers")
    for item in admin_projection:
        require(isinstance(item, dict), "admin projection item must be object")
        if item.get("mode") != "dev":
            require(item.get("secret_present") is True and SECRET_REF_RE.match(str(item.get("secret_ref", ""))), "admin projection must expose secret ref presence without raw secret")
        require(not RAW_SECRET_RE.search(json.dumps(item, ensure_ascii=False)), "admin projection contains raw secret-looking value")
    strategy_groups = data.get("strategy_groups")
    require(isinstance(strategy_groups, list) and strategy_groups, "strategy_groups must be a non-empty array")
    strategy_group_ids: set[str] = set()
    for group in strategy_groups:
        require(isinstance(group, dict), "strategy group entry must be object")
        validate_strategy_group(group, provider_ids)
        group_id = str(group["group_id"])
        require(group_id not in strategy_group_ids, f"duplicate strategy group_id {group_id}")
        strategy_group_ids.add(group_id)
    require("image-generation-default" in strategy_group_ids, "fixture must include image-generation-default strategy group")
    default_strategy_group = next(group for group in strategy_groups if group["group_id"] == "image-generation-default")
    require(default_strategy_group.get("tool_type") == "generate", "image-generation-default tool_type mismatch")
    require(default_strategy_group.get("selection_policy") == "weighted", "image-generation-default selection policy must start weighted")
    require("dev" in default_strategy_group.get("fallback_provider_ids", []), "image-generation-default must fall back to dev")
    default_member_ids = {member.get("provider_id") for member in default_strategy_group.get("members", []) if isinstance(member, dict)}
    require({"zenari-image-sandbox", "dev"} <= default_member_ids, "image-generation-default must include sandbox and dev members")
    require(default_strategy_group.get("metadata", {}).get("routing_surface") == "batch_generation", "image-generation-default routing_surface metadata mismatch")
    require(default_strategy_group.get("metadata", {}).get("release_gate") == "PR-3", "image-generation-default must bind to PR-3 routing gate")
    admin_create = data.get("admin_create")
    require(isinstance(admin_create, dict), "admin_create must be object")
    require(admin_create.get("operation_id") == "createProviderRegistry", "admin_create operation_id mismatch")
    require(admin_create.get("method") == "POST", "admin_create must use POST")
    require(admin_create.get("path") == "/providers/registry", "admin_create path mismatch")
    require(isinstance(admin_create.get("provider_id"), str) and admin_create["provider_id"], "admin_create provider_id required")
    require(admin_create.get("provider_id") not in provider_ids, "admin_create fixture should demonstrate adding a provider outside the current fixture registry")
    require(isinstance(admin_create.get("display_name"), str) and admin_create["display_name"], "admin_create display_name required")
    require(admin_create.get("mode") in MODES, "admin_create mode invalid")
    require(admin_create.get("status") in STATUSES, "admin_create status invalid")
    require(admin_create.get("required_rbac") == "provider_routing:admin", "admin_create RBAC mismatch")
    require(admin_create.get("idempotency_required") is True, "admin_create must require idempotency")
    require(admin_create.get("csrf_header") == "X-Zenari-CSRF", "admin_create CSRF header mismatch")
    require(SECRET_REF_RE.match(str(admin_create.get("secret_ref", ""))) is not None, "admin_create secret_ref must be secret manager reference")
    create_capabilities = admin_create.get("capabilities")
    require(isinstance(create_capabilities, list) and create_capabilities, "admin_create capabilities must be non-empty")
    require(admin_create.get("capability_count") == len(create_capabilities), "admin_create capability_count mismatch")
    for capability in create_capabilities:
        require(isinstance(capability, dict), "admin_create capability must be object")
        validate_capability(str(admin_create["provider_id"]), capability)
    validate_provider({
        "provider_id": admin_create["provider_id"],
        "display_name": admin_create["display_name"],
        "mode": admin_create["mode"],
        "status": admin_create["status"],
        "secret_ref": admin_create.get("secret_ref", ""),
        "capabilities": create_capabilities,
        "routing": admin_create.get("routing"),
        "health": admin_create.get("health"),
        "metadata": {},
    })
    create_audit = admin_create.get("audit_metadata")
    require(isinstance(create_audit, dict), "admin_create audit_metadata must be object")
    require(admin_create.get("audit_action") == "provider.registry.create", "admin_create audit action mismatch")
    require(create_audit.get("capability_count") == len(create_capabilities), "admin_create audit capability count mismatch")
    require(create_audit.get("estimated_cost_cents") == sum(capability.get("estimated_cost_cents", 0) for capability in create_capabilities), "admin_create audit cost mismatch")
    require(create_audit.get("secret_present") is True, "admin_create audit must summarize secret presence")
    require(not RAW_SECRET_RE.search(json.dumps(admin_create, ensure_ascii=False)), "admin_create contains raw secret-looking value")
    admin_strategy_create = data.get("admin_strategy_group_create")
    require(isinstance(admin_strategy_create, dict), "admin_strategy_group_create must be object")
    require(admin_strategy_create.get("operation_id") == "createProviderStrategyGroup", "admin_strategy_group_create operation_id mismatch")
    require(admin_strategy_create.get("method") == "POST", "admin_strategy_group_create must use POST")
    require(admin_strategy_create.get("path") == "/providers/strategy-groups", "admin_strategy_group_create path mismatch")
    require(admin_strategy_create.get("group_id") not in strategy_group_ids, "admin_strategy_group_create should demonstrate adding a new group")
    require(admin_strategy_create.get("required_rbac") == "provider_routing:admin", "admin_strategy_group_create RBAC mismatch")
    require(admin_strategy_create.get("idempotency_required") is True, "admin_strategy_group_create must require idempotency")
    require(admin_strategy_create.get("csrf_header") == "X-Zenari-CSRF", "admin_strategy_group_create CSRF header mismatch")
    require(isinstance(admin_strategy_create.get("rationale"), str) and admin_strategy_create["rationale"], "admin_strategy_group_create rationale required")
    require(admin_strategy_create.get("audit_action") == "provider.strategy_group.create", "admin_strategy_group_create audit action mismatch")
    validate_strategy_group(admin_strategy_create, provider_ids, {str(admin_create["provider_id"])})
    strategy_create_audit = admin_strategy_create.get("audit_metadata")
    require(isinstance(strategy_create_audit, dict), "admin_strategy_group_create audit_metadata must be object")
    require(strategy_create_audit.get("group_id") == admin_strategy_create.get("group_id"), "admin_strategy_group_create audit group_id mismatch")
    require(strategy_create_audit.get("tool_type") == admin_strategy_create.get("tool_type"), "admin_strategy_group_create audit tool_type mismatch")
    require(strategy_create_audit.get("status") == admin_strategy_create.get("status"), "admin_strategy_group_create audit status mismatch")
    require(strategy_create_audit.get("selection_policy") == admin_strategy_create.get("selection_policy"), "admin_strategy_group_create audit selection policy mismatch")
    require(strategy_create_audit.get("fallback_provider_ids") == admin_strategy_create.get("fallback_provider_ids"), "admin_strategy_group_create audit fallback mismatch")
    require(strategy_create_audit.get("kill_switch") == admin_strategy_create.get("kill_switch"), "admin_strategy_group_create audit kill_switch mismatch")
    require(strategy_create_audit.get("member_count") == len(admin_strategy_create.get("members", [])), "admin_strategy_group_create audit member count mismatch")
    require(strategy_create_audit.get("member_provider_ids") == [member.get("provider_id") for member in admin_strategy_create.get("members", [])], "admin_strategy_group_create audit member providers mismatch")
    require(strategy_create_audit.get("request_id_present") is True, "admin_strategy_group_create audit must preserve request_id presence")
    require(not RAW_SECRET_RE.search(json.dumps(admin_strategy_create, ensure_ascii=False)), "admin_strategy_group_create contains raw secret-looking value")
    admin_strategy_update = data.get("admin_strategy_group_update")
    require(isinstance(admin_strategy_update, dict), "admin_strategy_group_update must be object")
    require(admin_strategy_update.get("operation_id") == "updateProviderStrategyGroup", "admin_strategy_group_update operation_id mismatch")
    require(admin_strategy_update.get("method") == "PATCH", "admin_strategy_group_update must use PATCH")
    require(admin_strategy_update.get("path") == "/providers/strategy-groups/{group_id}", "admin_strategy_group_update path mismatch")
    require(admin_strategy_update.get("group_id") in strategy_group_ids, "admin_strategy_group_update must target an existing group")
    require(admin_strategy_update.get("required_rbac") == "provider_routing:admin", "admin_strategy_group_update RBAC mismatch")
    require(admin_strategy_update.get("idempotency_required") is True, "admin_strategy_group_update must require idempotency")
    require(admin_strategy_update.get("csrf_header") == "X-Zenari-CSRF", "admin_strategy_group_update CSRF header mismatch")
    require(isinstance(admin_strategy_update.get("rationale"), str) and admin_strategy_update["rationale"], "admin_strategy_group_update rationale required")
    require(admin_strategy_update.get("audit_action") == "provider.strategy_group.update", "admin_strategy_group_update audit action mismatch")
    validate_strategy_group(admin_strategy_update, provider_ids)
    require(admin_strategy_update.get("status") == "kill_switch", "admin_strategy_group_update must exercise kill_switch state")
    require(admin_strategy_update.get("kill_switch") is True, "admin_strategy_group_update kill_switch mismatch")
    update_members = admin_strategy_update.get("members", [])
    dev_update_member = next((member for member in update_members if isinstance(member, dict) and member.get("provider_id") == "dev"), None)
    sandbox_update_member = next((member for member in update_members if isinstance(member, dict) and member.get("provider_id") == "zenari-image-sandbox"), None)
    require(isinstance(dev_update_member, dict) and dev_update_member.get("enabled") is True and dev_update_member.get("weight") == 100, "admin_strategy_group_update must route fallback weight to dev")
    require(isinstance(sandbox_update_member, dict) and sandbox_update_member.get("enabled") is False and sandbox_update_member.get("weight") == 0, "admin_strategy_group_update must disable sandbox member during kill switch")
    strategy_update_audit = admin_strategy_update.get("audit_metadata")
    require(isinstance(strategy_update_audit, dict), "admin_strategy_group_update audit_metadata must be object")
    require(strategy_update_audit.get("group_id") == admin_strategy_update.get("group_id"), "admin_strategy_group_update audit group_id mismatch")
    require(strategy_update_audit.get("before_status") == default_strategy_group.get("status"), "admin_strategy_group_update before_status mismatch")
    require(strategy_update_audit.get("after_status") == admin_strategy_update.get("status"), "admin_strategy_group_update after_status mismatch")
    require(strategy_update_audit.get("before_member_count") == len(default_strategy_group.get("members", [])), "admin_strategy_group_update before member count mismatch")
    require(strategy_update_audit.get("after_member_count") == len(admin_strategy_update.get("members", [])), "admin_strategy_group_update after member count mismatch")
    require(strategy_update_audit.get("before_kill_switch") == default_strategy_group.get("kill_switch"), "admin_strategy_group_update before kill switch mismatch")
    require(strategy_update_audit.get("after_kill_switch") == admin_strategy_update.get("kill_switch"), "admin_strategy_group_update after kill switch mismatch")
    require(strategy_update_audit.get("selection_policy") == admin_strategy_update.get("selection_policy"), "admin_strategy_group_update audit selection policy mismatch")
    require(strategy_update_audit.get("member_count") == len(admin_strategy_update.get("members", [])), "admin_strategy_group_update audit member count mismatch")
    require(strategy_update_audit.get("member_provider_ids") == [member.get("provider_id") for member in admin_strategy_update.get("members", [])], "admin_strategy_group_update audit member providers mismatch")
    require(strategy_update_audit.get("request_id_present") is True, "admin_strategy_group_update audit must preserve request_id presence")
    require(not RAW_SECRET_RE.search(json.dumps(admin_strategy_update, ensure_ascii=False)), "admin_strategy_group_update contains raw secret-looking value")
    admin_update = data.get("admin_update")
    require(isinstance(admin_update, dict), "admin_update must be object")
    require(admin_update.get("operation_id") == "updateProviderRegistry", "admin_update operation_id mismatch")
    require(admin_update.get("method") == "PATCH", "admin_update must use PATCH")
    require(admin_update.get("path") == "/providers/registry/{provider_id}", "admin_update path mismatch")
    require(admin_update.get("provider_id") in provider_ids, "admin_update provider_id unknown")
    require(admin_update.get("required_rbac") == "provider_routing:admin", "admin_update RBAC mismatch")
    require(admin_update.get("idempotency_required") is True, "admin_update must require idempotency")
    require(admin_update.get("csrf_header") == "X-Zenari-CSRF", "admin_update CSRF header mismatch")
    require(SECRET_REF_RE.match(str(admin_update.get("secret_ref", ""))) is not None, "admin_update secret_ref must be secret manager reference")
    require(not RAW_SECRET_RE.search(json.dumps(admin_update, ensure_ascii=False)), "admin_update contains raw secret-looking value")
    update_capabilities = admin_update.get("capabilities")
    require(admin_update.get("capabilities_replace") is True, "admin_update must declare full capability replacement semantics")
    require(isinstance(update_capabilities, list) and update_capabilities, "admin_update capabilities must be non-empty")
    require(admin_update.get("capability_count") == len(update_capabilities), "admin_update capability_count mismatch")
    for capability in update_capabilities:
        require(isinstance(capability, dict), "admin_update capability must be object")
        validate_capability(str(admin_update["provider_id"]), capability)
    audit_metadata = admin_update.get("audit_metadata")
    require(isinstance(audit_metadata, dict), "admin_update audit_metadata must be object")
    require(audit_metadata.get("reference_changed") is True, "admin_update audit must record secret reference change as a boolean summary")
    require(audit_metadata.get("capabilities_changed") is True, "admin_update audit must record capability replacement")
    require(audit_metadata.get("before_capability_count") == 1, "admin_update before capability count mismatch")
    require(audit_metadata.get("after_capability_count") == len(update_capabilities), "admin_update after capability count mismatch")
    require(audit_metadata.get("before_estimated_cost_cents") == 12, "admin_update before cost mismatch")
    require(audit_metadata.get("after_estimated_cost_cents") == 24, "admin_update after cost mismatch")
    admin_delete = data.get("admin_delete")
    require(isinstance(admin_delete, dict), "admin_delete must be object")
    require(admin_delete.get("operation_id") == "deleteProviderRegistry", "admin_delete operation_id mismatch")
    require(admin_delete.get("method") == "DELETE", "admin_delete must use DELETE")
    require(admin_delete.get("path") == "/providers/registry/{provider_id}", "admin_delete path mismatch")
    require(admin_delete.get("provider_id") == admin_create.get("provider_id"), "admin_delete should target the admin_create provider")
    require(admin_delete.get("required_rbac") == "provider_routing:admin", "admin_delete RBAC mismatch")
    require(admin_delete.get("idempotency_required") is True, "admin_delete must require idempotency")
    require(admin_delete.get("csrf_header") == "X-Zenari-CSRF", "admin_delete CSRF header mismatch")
    require(admin_delete.get("audit_action") == "provider.registry.delete", "admin_delete audit action mismatch")
    delete_audit = admin_delete.get("audit_metadata")
    require(isinstance(delete_audit, dict), "admin_delete audit_metadata must be object")
    require(delete_audit.get("deleted_capability_count") == len(create_capabilities), "admin_delete deleted capability count mismatch")
    require(delete_audit.get("deleted_estimated_cost_cents") == sum(capability.get("estimated_cost_cents", 0) for capability in create_capabilities), "admin_delete deleted cost mismatch")
    require(delete_audit.get("secret_present") is True, "admin_delete audit must summarize secret presence")
    require(not RAW_SECRET_RE.search(json.dumps(admin_delete, ensure_ascii=False)), "admin_delete contains raw secret-looking value")
    health_probe = data.get("health_probe")
    require(isinstance(health_probe, dict), "health_probe must be object")
    require(health_probe.get("operation_id") == "probeProviderRegistryHealth", "health_probe operation_id mismatch")
    require(health_probe.get("method") == "POST", "health_probe must use POST")
    require(health_probe.get("path") == "/providers/registry/{provider_id}/health-probe", "health_probe path mismatch")
    require(health_probe.get("provider_id") in provider_ids, "health_probe provider_id unknown")
    require(health_probe.get("required_rbac") == "provider_routing:admin", "health_probe RBAC mismatch")
    require(health_probe.get("idempotency_required") is True, "health_probe must require idempotency")
    require(health_probe.get("csrf_header") == "X-Zenari-CSRF", "health_probe CSRF header mismatch")
    require(health_probe.get("audit_action") == "provider.registry.health_probe", "health_probe audit action mismatch")
    before_health = health_probe.get("before")
    after_health = health_probe.get("after")
    require(isinstance(before_health, dict) and isinstance(after_health, dict), "health_probe before/after must be objects")
    for label, health in (("before", before_health), ("after", after_health)):
        require(isinstance(health.get("available"), bool), f"health_probe {label}.available must be boolean")
        require(isinstance(health.get("latency_ms"), int) and health["latency_ms"] >= 0, f"health_probe {label}.latency_ms must be non-negative")
        require(isinstance(health.get("error_rate_percent"), int) and 0 <= health["error_rate_percent"] <= 100, f"health_probe {label}.error_rate_percent must be 0..100")
    probe_audit = health_probe.get("audit_metadata")
    require(isinstance(probe_audit, dict), "health_probe audit_metadata must be object")
    require(probe_audit.get("before_available") == before_health.get("available"), "health_probe before_available audit mismatch")
    require(probe_audit.get("after_available") == after_health.get("available"), "health_probe after_available audit mismatch")
    require(probe_audit.get("after_latency_ms") == after_health.get("latency_ms"), "health_probe after latency audit mismatch")
    require(probe_audit.get("after_error_rate_percent") == after_health.get("error_rate_percent"), "health_probe after error-rate audit mismatch")
    require(probe_audit.get("client_configured") is True, "health_probe audit must prove configured provider client")
    require(not RAW_SECRET_RE.search(json.dumps(health_probe, ensure_ascii=False)), "health_probe contains raw secret-looking value")
    user_projection = data.get("user_projection")
    require(isinstance(user_projection, list) and user_projection, "user_projection must be non-empty array")
    walk_user_projection(user_projection)
    projected_user_ids = {item.get("provider_id") for item in user_projection if isinstance(item, dict)}
    require(projected_user_ids <= provider_ids, "user projection contains unknown provider")
    sandbox_test_call = data.get("sandbox_test_call")
    require(isinstance(sandbox_test_call, dict), "sandbox_test_call must be object")
    require(sandbox_test_call.get("operation_id") == "runProviderSandboxTestCall", "sandbox test call operation_id mismatch")
    require(sandbox_test_call.get("method") == "POST", "sandbox test call must use POST")
    require(sandbox_test_call.get("path") == "/providers/registry/{provider_id}/test-call", "sandbox test call path mismatch")
    require(sandbox_test_call.get("provider_id") in provider_ids, "sandbox test call provider_id unknown")
    require(sandbox_test_call.get("status") == "succeeded", "sandbox test call fixture must succeed")
    require(sandbox_test_call.get("mode") in MODES, "sandbox test call mode invalid")
    require(sandbox_test_call.get("secret_present") is True, "sandbox test call must expose secret presence")
    require(SECRET_REF_RE.match(str(sandbox_test_call.get("secret_ref", ""))) is not None, "sandbox test call must expose secret ref only")
    require(sandbox_test_call.get("asset_persisted") is False, "sandbox test call must not persist user assets")
    require(sandbox_test_call.get("user_visible") is False, "sandbox test call must remain admin-only")
    require(sandbox_test_call.get("audit_action") == "provider.sandbox_test_call", "sandbox test call audit action mismatch")
    require(sandbox_test_call.get("required_rbac") == "provider_routing:admin", "sandbox test call RBAC mismatch")
    require(sandbox_test_call.get("idempotency_required") is True, "sandbox test call must require idempotency")
    require(sandbox_test_call.get("csrf_header") == "X-Zenari-CSRF", "sandbox test call CSRF header mismatch")
    require(not RAW_SECRET_RE.search(json.dumps(sandbox_test_call, ensure_ascii=False)), "sandbox test call contains raw secret-looking value")
    output_preview = sandbox_test_call.get("output_preview")
    require(isinstance(output_preview, dict), "sandbox test call output_preview must be object")
    require("prompt_hash" in output_preview and "prompt" not in output_preview, "sandbox test call must expose prompt hash, not raw prompt")


def main() -> int:
    try:
        validate()
    except ProviderRegistryContractError as exc:
        print(f"stage1 provider registry contract failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 provider registry contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
