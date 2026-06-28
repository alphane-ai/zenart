#!/usr/bin/env python3
"""Validate Stage 1 FE-8 prompt composer local payload contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "prompt_composer" / "local_contract.json"
PROMPT_CONTEXT = ROOT / "web" / "lib" / "prompt-context.ts"
PROMPT_CONTEXT_TEST = ROOT / "web" / "lib" / "prompt-context.test.ts"
CONTRACTS = ROOT / "web" / "lib" / "contracts.ts"
API_CLIENT = ROOT / "web" / "lib" / "api-client.ts"
WORKSPACE = ROOT / "web" / "components" / "workspace-app.tsx"
WORKSPACE_TEST = ROOT / "web" / "components" / "workspace-app.smoke.test.tsx"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)


class PromptComposerContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise PromptComposerContractError(message)


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
        raise PromptComposerContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.prompt-composer-contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "prompt_composer_payload_local_contract", "fixture kind mismatch")
    require({"FE-8", "FE-9", "WK-6", "BE-10", "VF-2"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    required_payload_fields = {
        "prompt_context.text",
        "prompt_context.selected_object_ids",
        "prompt_context.reference_asset_ids",
        "prompt_context.brand_kit_id",
        "prompt_context.model_hints",
        "prompt_context.tool_hint",
        "requested_count",
        "aspect_ratio",
        "quality",
        "allowed_models",
    }
    require(required_payload_fields <= set(data.get("payload_fields") or []), "fixture payload_fields incomplete")
    policy = data.get("projection_policy")
    require(isinstance(policy, dict), "projection_policy must be object")
    require(policy.get("selected_object_chips") == "visible_canvas_nodes_only", "selected object projection policy mismatch")
    require(policy.get("references") == "accepted_upload_refs_or_active_reusable_asset_library_items", "reference projection policy mismatch")
    require(policy.get("brand_kit") == "active_default_or_allowed_brand_mention", "brand kit projection policy mismatch")
    require(policy.get("model_hints") == "allowed_model_mentions_only", "model projection policy mismatch")
    require(policy.get("forbidden_or_unresolved_models_projected") is False, "forbidden models must not project")
    require(policy.get("duplicates_projected_once") is True, "duplicates must project once")
    require(policy.get("raw_provider_payload_persisted") is False, "raw provider payload must not persist")
    require(policy.get("raw_hidden_prompt_projected") is False, "raw hidden prompt must not project")
    require(policy.get("secret_like_value_projected") is False, "secret-like values must not project")
    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_prompt_composer_contract") == "pass", "local prompt composer status mismatch")
    require(status.get("local_batch_payload_storage") == "pass", "local batch payload storage status mismatch")
    require(status.get("staging_prompt_composer_evidence") == "open", "staging prompt composer evidence must remain open")
    require(status.get("deployed_backend_batch_payload_evidence") == "open", "deployed backend evidence must remain open")
    require(status.get("real_provider_result_visibility") == "open", "real provider visibility evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")


def validate_types_and_module() -> None:
    require_text(
        CONTRACTS,
        (
            'PromptComposerAspectRatio = "1:1" | "4:5" | "16:9" | "9:16"',
            'PromptComposerQuality = "draft" | "standard" | "high"',
            "export interface PromptComposerContext",
            "export interface PromptComposerPayload",
            'schema_version: "stage1.prompt-composer-contract.v1"',
            'prompt_context_status: "local"',
            "promptContext?: PromptComposerContext",
            "promptComposerPayload?: PromptComposerPayload",
            "createBatchGeneration(countOrPayload?: number | PromptComposerPayload)",
        ),
    )
    require_text(
        PROMPT_CONTEXT,
        (
            "export type PromptComposerInput",
            "defaultPromptComposerModels",
            "defaultPromptComposerSkills",
            "buildPromptComposerMentionOptions",
            "buildPromptComposerPayload",
            "buildMentionPickerOptions",
            "resolveMentions",
            "selected_object_ids",
            "reference_asset_ids",
            "brand_kit_id",
            "model_hints",
            "tool_hint",
            "forbidden_model_mention_count",
            "secret_like_value_projected",
            "raw_provider_payload_persisted: false",
            "raw_hidden_prompt_projected: false",
            "payloadHasSecretLikeValue",
        ),
    )


def validate_api_and_workspace() -> None:
    require_text(
        API_CLIENT,
        (
            "buildPromptComposerPayload",
            "PromptComposerPayload",
            "typeof countOrPayload === \"number\"",
            "payload.prompt_context.text",
            "payload.allowed_models[0]",
            "promptContext: payload.prompt_context",
            "promptComposerPayload: payload",
            "batch.prompt_context.selected_object_ids",
            "batch.prompt_context.reference_asset_ids",
        ),
    )
    require_text(
        WORKSPACE,
        (
            "PromptComposerAspectRatio",
            "PromptComposerQuality",
            "buildPromptComposerPayload",
            "Prompt composer controls",
            "stage1.prompt-composer-contract.v1",
            "data-prompt-composer-status",
            "data-prompt-composer-requested-count",
            "data-prompt-composer-aspect-ratio",
            "data-prompt-composer-quality",
            "data-prompt-composer-selected-object-count",
            "data-prompt-composer-reference-asset-count",
            "data-prompt-composer-brand-kit-id",
            "data-prompt-composer-model-hints",
            "data-prompt-composer-allowed-models",
            "data-prompt-composer-tool-hint",
            "data-prompt-composer-forbidden-model-count",
            "data-prompt-composer-redaction-secret-like",
            "zenariClient.createBatchGeneration(promptComposerPayload)",
            "data-batch-generation-prompt-context-selected-object-ids",
            "data-batch-generation-prompt-context-reference-asset-ids",
            "data-batch-generation-prompt-context-brand-kit-id",
            "data-batch-generation-prompt-context-model-hints",
        ),
    )


def validate_tests() -> None:
    require_text(
        PROMPT_CONTEXT_TEST,
        (
            "Stage 1 prompt composer payload contract",
            "projects selected objects, accepted references, Brand Kit, allowed model hints, and batch params",
            "blocks forbidden model mentions and rejected or archived assets from projection",
            "stores the composer payload on locally created batch generations",
            "@object[Confirmed Brief]",
            "@asset[Primary logo reference]",
            "@brand[Aurora Retail]",
            "@model[image-fast-v1]",
            "internal-shadow-model",
            "unsafe-reference.exe",
            "asset_archived_1",
            "secret_like_value_projected: false",
        ),
    )
    require_text(
        WORKSPACE_TEST,
        (
            "Prompt composer controls",
            "data-prompt-composer-contract",
            "stage1.prompt-composer-contract.v1",
            "data-prompt-composer-selected-object-count",
            "data-prompt-composer-reference-asset-count",
            "data-prompt-composer-brand-kit-id",
            "data-prompt-composer-model-hints",
            "data-prompt-composer-redaction-secret-like",
            "data-batch-generation-prompt-context-selected-object-ids",
            "data-batch-generation-prompt-context-reference-asset-ids",
            "data-batch-generation-prompt-context-brand-kit-id",
        ),
    )


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "FE-8",
            "prompt composer",
            "validate_stage1_prompt_composer_contract.py",
            "fixtures/stage1/prompt_composer/local_contract.json",
            "web/lib/prompt-context.ts",
            "staging prompt composer evidence remains open",
            "real provider result visibility remains open",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_prompt_composer_contract.py",
            "python3 scripts/validate_stage1_prompt_composer_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_types_and_module()
    validate_api_and_workspace()
    validate_tests()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except PromptComposerContractError as exc:
        print(f"stage1 prompt composer contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 prompt composer contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
