#!/usr/bin/env python3
"""Validate Stage 1 PR-7 provider video adapter local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "provider_video_adapter" / "local_contract.json"
ADAPTER = ROOT / "backend" / "internal" / "provider" / "adapters" / "video" / "video.go"
ADAPTER_TEST = ROOT / "backend" / "internal" / "provider" / "adapters" / "video" / "video_test.go"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

ASPECT_RATIOS = {"1:1", "16:9", "9:16"}
POLL_STATUSES = {"queued", "running", "succeeded", "failed", "cancelled"}


class ProviderVideoAdapterContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ProviderVideoAdapterContractError(message)


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
        raise ProviderVideoAdapterContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.provider_video_adapter.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "provider_video_adapter_local_contract", "fixture kind mismatch")
    require({"PR-7", "PR-1", "PR-2", "AS-1", "AS-2", "QA-9"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")

    adapter = data.get("adapter_contract")
    require(isinstance(adapter, dict), "adapter_contract must be object")
    require(adapter.get("package") == "backend/internal/provider/adapters/video", "adapter package mismatch")
    require(adapter.get("endpoint") == "video.generate", "adapter endpoint mismatch")
    require(adapter.get("status_endpoint") == "video.status", "adapter status endpoint mismatch")
    require(adapter.get("endpoint_version") == "zenari_video_generate_adapter_v1", "adapter endpoint version mismatch")
    require(adapter.get("provider_schema_name") == "zenari.video_generate.v1", "provider schema mismatch")
    require(adapter.get("status_schema_name") == "zenari.video_status.v1", "status schema mismatch")
    require(adapter.get("duration_seconds_min") == 1, "duration min mismatch")
    require(adapter.get("duration_seconds_max") == 30, "duration max mismatch")
    require(set(adapter.get("aspect_ratios") or []) == ASPECT_RATIOS, "aspect ratio set mismatch")
    require(set(adapter.get("poll_statuses") or []) == POLL_STATUSES, "poll status set mismatch")
    for flag in (
        "first_frame_input",
        "last_frame_input",
        "frame_inputs_must_be_storage_keys",
        "polling_projection_required",
        "storage_result_required",
        "video_asset_required",
        "poster_asset_required",
        "provider_client_wrapped",
        "request_hash_required",
        "secret_like_input_rejection",
        "secret_like_payload_rejection",
        "secret_like_result_rejection",
    ):
        require(adapter.get(flag) is True, f"adapter flag {flag} must be true")
    require(adapter.get("request_hash_encoding") == "json", "request hash encoding mismatch")
    require(adapter.get("result_kind") == "video_generation_result", "result kind mismatch")
    require(adapter.get("status_kind") == "video_generation_status", "status kind mismatch")
    require(adapter.get("raw_provider_payload_projected") is False, "adapter must not project raw payload")
    require(adapter.get("raw_payload_persisted") is False, "adapter must not persist raw payload")

    capability = data.get("capability_contract")
    require(isinstance(capability, dict), "capability_contract must be object")
    require(set(capability.get("endpoints") or []) == {"video.generate", "video.status"}, "capability endpoints mismatch")
    require(set(capability.get("input_types") or []) == {"prompt", "first_frame", "last_frame", "json"}, "capability input types mismatch")
    require(set(capability.get("output_types") or []) == {"video", "thumbnail"}, "capability output types mismatch")
    require(set(capability.get("tool_types") or []) == {"video.generate"}, "capability tool types mismatch")

    tests = data.get("focused_tests")
    require(isinstance(tests, dict), "focused_tests must be object")
    require(
        set(tests.get("go") or [])
        == {
            "TestBuildProviderRequestRequiresDurationAspectAndFrameStorageKeys",
            "TestClientInvokeProjectsQueuedStatusWithoutRawPayload",
            "TestClientInvokeProjectsStorageResultAssetAndPoster",
            "TestPollStatusBuildsStatusRequestAndProjectsSafeStatus",
            "TestProjectResultAssetRejectsSecretLikeStorageResult",
            "TestCapabilitiesExposeVideoGenerateStatusAndFrameInputs",
            "TestValidateInputRejectsSecretLikePrompt",
        },
        "focused Go tests mismatch",
    )

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_provider_video_adapter_contract") == "pass", "local adapter status mismatch")
    require(status.get("video_sandbox_fixture_replay") == "pass", "video fixture status mismatch")
    require(status.get("real_provider_video_runtime") == "open", "real provider video runtime must remain open")
    require(status.get("staging_provider_video_evidence") == "open", "staging provider video evidence must remain open")
    require(status.get("production_security_evidence") == "open", "production security evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local video adapter must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local video adapter must not clear production gate")


def validate_adapter_code() -> None:
    text = require_text(
        ADAPTER,
        (
            "package video",
            "const EndpointVersion = \"zenari_video_generate_adapter_v1\"",
            "type AspectRatio string",
            "AspectRatioSquare",
            "AspectRatioLandscape",
            "AspectRatioPortrait",
            "type PollStatus string",
            "PollStatusQueued",
            "PollStatusRunning",
            "PollStatusSucceeded",
            "PollStatusFailed",
            "PollStatusCancelled",
            "type Input struct",
            "type PollRequest struct",
            "type StatusProjection struct",
            "type ResultAsset struct",
            "type Client struct",
            "Inner provider.Client",
            "func BuildProviderRequest",
            "func (c Client) Invoke",
            "func (c Client) PollStatus",
            "func BuildStatusRequest",
            "func (c Client) Capabilities",
            "func ValidateInput",
            "func ValidateRequest",
            "func ProjectStatus",
            "func ProjectResultAsset",
            "func ValidAspectRatio",
            "func NormalizePollStatus",
            "func StableHash",
            "json.Marshal(value)",
            "Endpoint:       \"video.generate\"",
            "Endpoint:       \"video.status\"",
            "\"provider_schema_name\":    \"zenari.video_generate.v1\"",
            "\"provider_schema_name\":   \"zenari.video_status.v1\"",
            "\"storage_result_required\": true",
            "\"storage_result_allowed\": true",
            "duration_seconds must be between 1 and 30",
            "first_frame_object must be a storage key without query or fragment",
            "last_frame_object must be a storage key without query or fragment",
            "secret-like video adapter input",
            "secret-like video adapter payload",
            "secret-like video result field",
            "\"kind\":                   \"video_generation_result\"",
            "\"kind\":                   \"video_generation_status\"",
            "\"raw_payload_persisted\":  false",
            "security.RedactMap(output)",
        ),
    )
    for ratio in ASPECT_RATIOS:
        require(f'"{ratio}"' in text, f"adapter missing aspect ratio literal {ratio}")
    for status in POLL_STATUSES:
        require(f'"{status}"' in text, f"adapter missing poll status literal {status}")
    require("CompletedAt: now" not in text, "adapter must not fabricate provider CompletedAt from projection time")


def validate_tests() -> None:
    require_text(
        ADAPTER_TEST,
        (
            "TestBuildProviderRequestRequiresDurationAspectAndFrameStorageKeys",
            "TestClientInvokeProjectsQueuedStatusWithoutRawPayload",
            "TestClientInvokeProjectsStorageResultAssetAndPoster",
            "TestPollStatusBuildsStatusRequestAndProjectsSafeStatus",
            "TestProjectResultAssetRejectsSecretLikeStorageResult",
            "TestCapabilitiesExposeVideoGenerateStatusAndFrameInputs",
            "TestValidateInputRejectsSecretLikePrompt",
            "duration_seconds",
            "aspect_ratio",
            "first_frame_asset_id",
            "last_frame_asset_id",
            "video.generate",
            "video.status",
            "video_generation_status",
            "video_generation_result",
            "raw_provider_payload",
            "raw provider payload leaked",
            "adapter should not fabricate provider completion time",
            "Bearer abcdefghijklmnop",
        ),
    )


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "VF-3c",
            "validate_stage1_provider_video_adapter_contract.py",
            "fixtures/stage1/provider_video_adapter/local_contract.json",
            "PR-7",
            "duration/aspect/first-last-frame/status-polling/storage-result",
            "Real provider video runtime",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_provider_video_adapter_contract.py",
            "python3 scripts/validate_stage1_provider_video_adapter_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_adapter_code()
    validate_tests()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except ProviderVideoAdapterContractError as exc:
        print(f"stage1 provider video adapter contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 provider video adapter contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
