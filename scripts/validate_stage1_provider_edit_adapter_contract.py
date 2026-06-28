#!/usr/bin/env python3
"""Validate Stage 1 PR-6 provider edit adapter local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "provider_edit_adapter" / "local_contract.json"
ADAPTER = ROOT / "backend" / "internal" / "provider" / "adapters" / "edit" / "edit.go"
ADAPTER_TEST = ROOT / "backend" / "internal" / "provider" / "adapters" / "edit" / "edit_test.go"
PROVIDER_BASE = ROOT / "backend" / "internal" / "provider" / "provider.go"
PROVIDER_OPENAI = ROOT / "backend" / "internal" / "provider" / "openai_compatible.go"
PROVIDER_OPENAI_TEST = ROOT / "backend" / "internal" / "provider" / "openai_compatible_test.go"
PROVIDER_TEST = ROOT / "backend" / "internal" / "provider" / "provider_test.go"
REGISTRY_FIXTURE = ROOT / "fixtures" / "stage1" / "provider_registry" / "sandbox_registry.json"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

EDIT_TOOLS = {"remove_background", "upscale", "erase", "expand"}
MASK_KINDS = {"brush", "rect", "lasso"}
MASK_REQUIRED_TOOLS = {"erase", "expand"}
CAPABILITY_TOOLS = {"generate", "remove_background", "upscale", "erase", "expand"}


class ProviderEditAdapterContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProviderEditAdapterContractError(message)


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
        raise ProviderEditAdapterContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.provider_edit_adapter.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "provider_edit_adapter_local_contract", "fixture kind mismatch")
    require({"PR-6", "AS-6", "AS-7", "PR-1", "PR-2", "QA-9"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")

    adapter = data.get("adapter_contract")
    require(isinstance(adapter, dict), "adapter_contract must be object")
    require(adapter.get("package") == "backend/internal/provider/adapters/edit", "adapter package mismatch")
    require(adapter.get("endpoint") == "image.edit", "adapter endpoint mismatch")
    require(adapter.get("endpoint_version") == "zenari_image_edit_adapter_v1", "adapter endpoint version mismatch")
    require(adapter.get("provider_schema_name") == "zenari.image_edit.v1", "adapter provider schema mismatch")
    require(set(adapter.get("tool_types") or []) == EDIT_TOOLS, "adapter tool type set mismatch")
    require(set(adapter.get("mask_kinds") or []) == MASK_KINDS, "adapter mask kind set mismatch")
    require(set(adapter.get("mask_required_tools") or []) == MASK_REQUIRED_TOOLS, "adapter mask-required set mismatch")
    for flag in (
        "source_dimensions_required",
        "mask_dimensions_must_match_source",
        "provider_client_wrapped",
        "request_hash_required",
        "secret_like_input_rejection",
        "secret_like_result_rejection",
        "result_asset_required",
        "derived_from_source_asset",
        "original_asset_retained",
    ):
        require(adapter.get(flag) is True, f"adapter flag {flag} must be true")
    require(adapter.get("request_hash_encoding") == "json", "adapter request hash encoding mismatch")
    require(adapter.get("raw_provider_payload_projected") is False, "adapter must not project raw provider payload")
    require(adapter.get("raw_payload_persisted") is False, "adapter must not persist raw payload")
    require(adapter.get("result_kind") == "image_edit_result", "adapter result kind mismatch")

    capability = data.get("capability_contract")
    require(isinstance(capability, dict), "capability_contract must be object")
    require(capability.get("provider_id") == "zenari-image-sandbox", "capability provider id mismatch")
    require(capability.get("model_id") == "image-fast-v1", "capability model id mismatch")
    require(set(capability.get("endpoints") or []) == {"image.generate", "image.edit"}, "capability endpoints mismatch")
    require(set(capability.get("input_types") or []) == {"prompt", "reference_image", "mask"}, "capability input types mismatch")
    require(set(capability.get("output_types") or []) == {"image"}, "capability output types mismatch")
    require(set(capability.get("tool_types") or []) == CAPABILITY_TOOLS, "capability tool types mismatch")

    tests = data.get("focused_tests")
    require(isinstance(tests, dict), "focused_tests must be object")
    require(
        set(tests.get("go") or [])
        == {
            "TestBuildProviderRequestRequiresAlignedMaskForErase",
            "TestBuildProviderRequestForRemoveBackgroundDoesNotRequireMask",
            "TestClientInvokeProjectsSafeDerivedAssetAndDropsRawProviderPayload",
            "TestProjectResultAssetRejectsSecretLikeResultObjectKey",
            "TestCapabilitiesExposeEditToolsAndMaskInput",
            "TestValidateInputRejectsSecretLikePrompt",
            "TestOpenAICompatibleProviderStatusAndCapabilitiesHideKey",
        },
        "focused Go tests mismatch",
    )

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_provider_edit_adapter_contract") == "pass", "local adapter status mismatch")
    require(status.get("provider_registry_capability_contract") == "pass", "registry capability status mismatch")
    require(status.get("real_provider_edit_runtime") == "open", "real provider edit runtime must remain open")
    require(status.get("staging_provider_edit_evidence") == "open", "staging provider edit evidence must remain open")
    require(status.get("production_security_evidence") == "open", "production security evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local adapter must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local adapter must not clear production gate")


def validate_adapter_code() -> None:
    text = require_text(
        ADAPTER,
        (
            "package edit",
            "const EndpointVersion = \"zenari_image_edit_adapter_v1\"",
            "ToolRemoveBackground ToolType = \"remove_background\"",
            "ToolUpscale",
            "ToolErase",
            "ToolExpand",
            "MaskBrush",
            "MaskRect",
            "MaskLasso",
            "type Input struct",
            "type EditResultAsset struct",
            "type Client struct",
            "Inner provider.Client",
            "func BuildProviderRequest",
            "func (c Client) Invoke",
            "func (c Client) Capabilities",
            "func ValidateInput",
            "func ValidateRequest",
            "func ProjectResultAsset",
            "func StableRequestHash",
            "json.Marshal(value)",
            "Endpoint:       \"image.edit\"",
            "\"provider_schema_name\": \"zenari.image_edit.v1\"",
            "mask dimensions must match source dimensions",
            "secret-like edit adapter input",
            "secret-like edit adapter payload",
            "secret-like edit result field",
            "\"kind\":                   \"image_edit_result\"",
            "\"raw_payload_persisted\":  false",
            "security.RedactMap(output)",
        ),
    )
    for tool in EDIT_TOOLS:
        require(f'"{tool}"' in text, f"adapter missing tool literal {tool}")
    for kind in MASK_KINDS:
        require(f'"{kind}"' in text, f"adapter missing mask kind literal {kind}")
    require(re.search(r"case ToolErase, ToolExpand:", text), "adapter must require masks for erase and expand")
    require("RawPayloadPersisted:  false" in text, "adapter result must set RawPayloadPersisted false")
    require("CompletedAt: now" not in text, "adapter must not fabricate provider CompletedAt from projection time")


def validate_tests() -> None:
    require_text(
        ADAPTER_TEST,
        (
            "TestBuildProviderRequestRequiresAlignedMaskForErase",
            "TestBuildProviderRequestForRemoveBackgroundDoesNotRequireMask",
            "TestClientInvokeProjectsSafeDerivedAssetAndDropsRawProviderPayload",
            "TestProjectResultAssetRejectsSecretLikeResultObjectKey",
            "TestCapabilitiesExposeEditToolsAndMaskInput",
            "TestValidateInputRejectsSecretLikePrompt",
            "mask dimensions",
            "raw_provider_payload",
            "raw provider payload leaked",
            "remove_background",
            "upscale",
            "erase",
            "expand",
            "Bearer abcdefghijklmnop",
            "adapter should not fabricate provider completion time",
        ),
    )
    require_text(
        PROVIDER_OPENAI_TEST,
        (
            "TestOpenAICompatibleProviderStatusAndCapabilitiesHideKey",
            "image.edit",
            "remove_background",
            "upscale",
            "erase",
            "expand",
            "containsString(capability.ToolTypes, tool)",
        ),
    )


def validate_provider_capabilities() -> None:
    require_text(
        PROVIDER_BASE,
        (
            "type Capability struct",
            "Endpoints",
            "InputTypes",
            "OutputTypes",
            "ToolTypes",
        ),
    )
    require_text(
        PROVIDER_OPENAI,
        (
            "OpenAICompatibleProvider",
            "Capabilities() []Capability",
            "\"image.edit\"",
            "\"mask\"",
            "\"remove_background\"",
            "\"upscale\"",
            "\"erase\"",
            "\"expand\"",
        ),
    )
    require_text(
        PROVIDER_TEST,
        (
            "\"tool_types\":[\"generate\",\"remove_background\",\"upscale\",\"erase\",\"expand\"]",
            "ToolTypes:             []string{\"generate\", \"remove_background\", \"upscale\", \"erase\", \"expand\"}",
        ),
    )


def validate_registry_fixture() -> None:
    data = load_json(REGISTRY_FIXTURE)
    providers = data.get("providers")
    require(isinstance(providers, list), "provider registry fixture providers must be array")
    sandbox = next((item for item in providers if item.get("provider_id") == "zenari-image-sandbox"), None)
    require(isinstance(sandbox, dict), "provider registry fixture missing zenari-image-sandbox")
    capabilities = sandbox.get("capabilities")
    require(isinstance(capabilities, list) and capabilities, "sandbox capabilities must be non-empty")
    capability = capabilities[0]
    require(set(capability.get("endpoints") or []) >= {"image.generate", "image.edit"}, "sandbox capability must expose image.edit")
    require("mask" in set(capability.get("input_types") or []), "sandbox capability must expose mask input")
    require(set(capability.get("tool_types") or []) == CAPABILITY_TOOLS, "sandbox capability edit tool set mismatch")

    projection = data.get("user_projection")
    require(isinstance(projection, list), "provider registry user_projection must be array")
    sandbox_projection = next((item for item in projection if item.get("provider_id") == "zenari-image-sandbox"), None)
    require(isinstance(sandbox_projection, dict), "provider registry user projection missing sandbox provider")
    require(set(sandbox_projection.get("tool_types") or []) == CAPABILITY_TOOLS, "sandbox user projection edit tool set mismatch")
    require("image.edit" in set(sandbox_projection.get("endpoints") or []), "sandbox user projection missing image.edit")


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-3b",
            "validate_stage1_provider_edit_adapter_contract.py",
            "fixtures/stage1/provider_edit_adapter/local_contract.json",
            "PR-6",
            "remove-background/upscale/erase/expand",
            "Real provider edit runtime",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_provider_edit_adapter_contract.py",
            "python3 scripts/validate_stage1_provider_edit_adapter_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_adapter_code()
    validate_tests()
    validate_provider_capabilities()
    validate_registry_fixture()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except ProviderEditAdapterContractError as exc:
        print(f"stage1 provider edit adapter contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 provider edit adapter contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
