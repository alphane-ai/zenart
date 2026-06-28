#!/usr/bin/env python3
"""Validate Stage 1 BE-10/BE-11 trace projection local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "trace_projection" / "local_contract.json"
TRACE = ROOT / "backend" / "internal" / "trace" / "projection.go"
TRACE_TEST = ROOT / "backend" / "internal" / "trace" / "projection_test.go"
RESULT_SINK = ROOT / "backend" / "internal" / "task" / "batch_result_sink.go"
RESULT_SINK_TEST = ROOT / "backend" / "internal" / "task" / "batch_result_sink_test.go"
OPENAPI = ROOT / "openapi" / "zenart.v1.yaml"
OPENAPI_TEST = ROOT / "backend" / "internal" / "server" / "openapi_contract_test.go"
TRACE_COMPLETENESS_VALIDATOR = ROOT / "scripts" / "validate_trace_completeness.py"
TRACE_VISIBILITY_VALIDATOR = ROOT / "scripts" / "validate_trace_visibility_export_retention.py"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

PROMPT_FIELDS = {"text", "selected_object_ids", "reference_asset_ids", "brand_kit_id", "model_hints", "tool_hint"}
USER_VISIBLE_FIELDS = {"trace_id", "task_id", "workflow", "task_status", "user_message", "final_export_allowed", "denial_reasons", "export_id"}
USER_HIDDEN_FIELDS = {
    "provider_payload",
    "internal_prompt",
    "raw_safety_payload",
    "safety_rule_rationale",
    "admin_audit_notes",
    "quota_transaction_internal_metadata",
    "agent_step_payload",
}
ADMIN_VISIBLE_TABLES = {"agent_traces", "eval_results", "qa_results", "safety_decisions", "exports", "audit_logs"}
RETAINED_FILES = {"manifest.json", "qa_report.json", "metadata.json", "trace_provenance.json", "safety_disclaimer.md"}
BLOCKED_RETAINED_FILES = {"qa_report.json", "trace_provenance.json", "safety_disclaimer.md"}


class TraceProjectionContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise TraceProjectionContractError(message)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{path.relative_to(ROOT)} missing required snippet {snippet!r}")
    return text


def load_fixture() -> dict[str, Any]:
    try:
        data = json.loads(read_text(FIXTURE))
    except json.JSONDecodeError as exc:
        raise TraceProjectionContractError(f"{FIXTURE.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), "fixture must be a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), "fixture contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_fixture()
    require(data.get("schema_version") == "stage1.trace_projection.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "backend_trace_projection_contract", "fixture kind mismatch")
    require({"BE-10", "BE-11", "WK-9", "AS-10", "QA-8"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("backend_package") == "backend/internal/trace", "fixture backend_package mismatch")
    require(data.get("openapi_source") == "openapi/zenart.v1.yaml", "fixture OpenAPI source mismatch")

    prompt = data.get("prompt_context_payload")
    require(isinstance(prompt, dict), "prompt_context_payload must be object")
    require(PROMPT_FIELDS <= set(prompt.get("required_fields") or []), "prompt required fields incomplete")
    for key in (
        "text_kept_internal_only",
        "user_export_projection_uses_text_sha256",
        "selected_objects_projected",
        "assets_projected",
        "brand_projected",
        "model_hints_projected",
        "tool_hint_projected",
    ):
        require(prompt.get(key) is True, f"prompt context flag {key} must be true")

    projection = data.get("trace_projection")
    require(isinstance(projection, dict), "trace_projection must be object")
    require(projection.get("workflow") == "batch_generation", "trace workflow mismatch")
    required_safe = set(projection.get("required_safe_fields") or [])
    for field in (
        "prompt_context.text_sha256",
        "prompt_context.selected_object_ids",
        "prompt_context.reference_asset_ids",
        "prompt_context.brand_kit_id",
        "prompt_context.model_hints",
        "prompt_context.tool_hint",
        "user_trace_projection",
        "admin_trace_projection",
        "export_retention_projection",
    ):
        require(field in required_safe, f"trace_projection.required_safe_fields missing {field}")
    require(set(projection.get("user_visible_fields") or []) == USER_VISIBLE_FIELDS, "user visible fields mismatch")
    require(set(projection.get("user_hidden_fields") or []) == USER_HIDDEN_FIELDS, "user hidden fields mismatch")
    require(set(projection.get("admin_visible_tables") or []) == ADMIN_VISIBLE_TABLES, "admin visible tables mismatch")
    require(set(projection.get("retained_files") or []) == RETAINED_FILES, "retained files mismatch")
    require(set(projection.get("retained_when_blocked") or []) == BLOCKED_RETAINED_FILES, "blocked retained files mismatch")

    red_line = data.get("red_line_policy")
    require(isinstance(red_line, dict), "red_line_policy must be object")
    for key in (
        "raw_prompt_projected",
        "raw_provider_payload_saved",
        "raw_safety_payload_projected",
        "provider_payload_field_allowed",
        "internal_prompt_field_allowed",
        "raw_safety_payload_field_allowed",
        "secret_projection_allowed",
    ):
        require(red_line.get(key) is False, f"red_line_policy.{key} must be false")

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_contract") == "pass", "local contract status mismatch")
    require(status.get("staging_trace_runtime_evidence") == "open", "staging evidence must remain open")
    require(status.get("production_security_evidence") == "open", "production evidence must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_security_gate") is False, "local contract must not clear production security gate")


def validate_trace_package() -> None:
    require_text(
        TRACE,
        (
            "type PromptContextPayload struct",
            "Text              string",
            "SelectedObjectIDs []string",
            "ReferenceAssetIDs []string",
            "BrandKitID        string",
            "ModelHints        []string",
            "ToolHint          string",
            "type TraceProjection struct",
            "PromptContextProjection",
            "TextSHA256",
            "TextRedacted",
            "UserTraceProjection",
            "AdminTraceProjection",
            "ExportRetentionProjection",
            "BuildPromptContextPayload",
            "BuildTraceProjection",
            "ValidateUserExportProjection",
            "security.ClassifyString",
            "security.ClassifyValue",
            "RawPromptProjected",
            "RawProviderPayloadSaved",
            "RawSafetyPayloadProjected",
            "forbiddenProjectionKeys",
            "provider_payload",
            "internal_prompt",
            "raw_safety_payload",
            "agent_step_payload",
        ),
    )
    require_text(
        TRACE_TEST,
        (
            "TestBuildPromptContextPayloadCoversStage1Fields",
            "TestBuildTraceProjectionRedactsPromptAndRawPayloadBoundaries",
            "TestBuildTraceProjectionRejectsSecretsAndForbiddenFields",
            "TextSHA256",
            "TextRedacted",
            "raw_provider_payload_saved",
            "ValidateUserExportProjection",
        ),
    )


def validate_result_sink_wiring() -> None:
    require_text(
        RESULT_SINK,
        (
            'tracepkg "github.com/alphane-ai/zenart/backend/internal/trace"',
            "tracepkg.BuildPromptContextPayload",
            "tracepkg.BuildTraceProjection",
            "tracepkg.WorkflowBatchGeneration",
            "batchResultTraceProjection",
            "batchResultFallbackTraceProjection",
            "security.RedactString(err.Error())",
            '"trace_projection"',
            '"raw_provider_payload_saved": false',
            "ProviderRequestHash",
            "ProviderResponseID",
            "ProviderResponseStatus",
        ),
    )
    require_text(
        RESULT_SINK_TEST,
        (
            "TestPostgresBatchResultSinkPersistsObjectRefsAssetAndCanvasWithoutRawProviderOutput",
            "trace projection",
            "provider.example.test/private/raw-output.png",
            "raw generated text",
            "raw_provider_payload_saved",
        ),
    )


def validate_openapi_and_legacy_validators() -> None:
    require_text(
        OPENAPI,
        (
            "PromptContext:",
            "required: [text]",
            "selected_object_ids:",
            "reference_asset_ids:",
            "brand_kit_id:",
            "model_hints:",
            "tool_hint:",
            "AgentTrace:",
            "user_trace_projection:",
            "admin_trace_projection:",
            "export_retention_projection:",
            "visible_fields:",
            "hidden_fields:",
            "provider_payload",
            "internal_prompt",
            "raw_safety_payload",
            "retained_when_blocked:",
            "download_enabled:",
        ),
    )
    require_text(
        OPENAPI_TEST,
        (
            "TestOpenAPIAgentTraceRequiresCompletenessContract",
            "user_trace_projection:",
            "admin_trace_projection:",
            "hidden_fields:",
            "provider_payload",
            "raw_safety_payload",
        ),
    )
    require_text(TRACE_COMPLETENESS_VALIDATOR, ("REQUIRED_TRACE_FIELDS", "REQUIRED_STEPS", "validate_openapi_trace_schema"))
    require_text(TRACE_VISIBILITY_VALIDATOR, ("USER_HIDDEN_FIELDS", "validate_openapi_projection_schema", "trace_projection_cases"))


def validate_repo_wiring() -> None:
    require_text(REPO_VALIDATE, ("validate_stage1_trace_projection_contract.py",))
    require_text(
        GAP_INVENTORY,
        (
            "VF-2h",
            "backend/internal/trace",
            "PromptContextPayload",
            "TraceProjection",
            "raw prompt/provider/safety payload",
            "Staging trace runtime evidence remains open",
        ),
    )


def main() -> int:
    try:
        validate_fixture()
        validate_trace_package()
        validate_result_sink_wiring()
        validate_openapi_and_legacy_validators()
        validate_repo_wiring()
    except TraceProjectionContractError as exc:
        print(f"stage1 trace projection contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 trace projection contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
