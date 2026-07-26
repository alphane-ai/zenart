#!/usr/bin/env python3
"""Validate Stage 1 QA-8 local security scan contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "security_scan" / "local_contract.json"
SECURITY_SCAN = ROOT / "scripts" / "security_scan_smoke.sh"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
BLUEPRINT = ROOT / "Docs" / "Stage1_20260621_blueprint.md"
SECURITY = ROOT / "backend" / "internal" / "security" / "redact.go"
SECURITY_TEST = ROOT / "backend" / "internal" / "security" / "redact_test.go"
PROVIDER_OPENAI = ROOT / "backend" / "internal" / "provider" / "openai_compatible.go"
PROVIDER_OPENAI_TEST = ROOT / "backend" / "internal" / "provider" / "openai_compatible_test.go"
PROVIDER_EDIT = ROOT / "backend" / "internal" / "provider" / "adapters" / "edit" / "edit.go"
PROVIDER_VIDEO = ROOT / "backend" / "internal" / "provider" / "adapters" / "video" / "video.go"
BILLING_CHECKOUT = ROOT / "backend" / "internal" / "billing" / "stripe_checkout.go"
BILLING_WEBHOOK = ROOT / "backend" / "internal" / "billing" / "stripe_webhook.go"
BILLING_LIFECYCLE = ROOT / "backend" / "internal" / "billing" / "stripe_lifecycle_reconcile.go"
BILLING_WEBHOOK_TEST = ROOT / "backend" / "internal" / "billing" / "stripe_webhook_test.go"
GO_MOD = ROOT / "backend" / "go.mod"
DOCKERFILE = ROOT / "backend" / "Dockerfile"
BATCH_EXECUTOR = ROOT / "backend" / "internal" / "task" / "batch_executor.go"
BATCH_RESULT_SINK = ROOT / "backend" / "internal" / "task" / "batch_result_sink.go"
ASSETS = ROOT / "backend" / "internal" / "assets" / "model.go"
ASSETS_TEST = ROOT / "backend" / "internal" / "assets" / "model_test.go"
SUPPORT = ROOT / "backend" / "internal" / "support" / "ticket.go"
SUPPORT_TEST = ROOT / "backend" / "internal" / "support" / "ticket_test.go"
EXPORT = ROOT / "backend" / "internal" / "export" / "manifest.go"
EXPORT_TEST = ROOT / "backend" / "internal" / "export" / "manifest_test.go"
TRACE = ROOT / "backend" / "internal" / "trace" / "projection.go"
TRACE_TEST = ROOT / "backend" / "internal" / "trace" / "projection_test.go"
RATE_LIMIT_FIXTURE = ROOT / "fixtures" / "stage1" / "rate_limit_spend_cap" / "local_contract.json"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

REQUIRED_BLUEPRINT_ITEMS = {"BE-2", "BE-11", "QA-8", "OP-13"}
REQUIRED_COVERAGE = {"provider", "stripe", "batch", "assets", "support", "export", "trace", "rate_limit", "toolchain"}
REQUIRED_PATTERN_IDS = {
    "openai_key_shape",
    "zai_key_shape",
    "stripe_key_shape",
    "stripe_publishable_key_shape",
    "stripe_webhook_secret_shape",
    "github_token_shape",
}
REQUIRED_REPORT_CHECKS = {"dependency_scan", "image_scan", "secret_scan"}
REQUIRED_NPM_AUDIT_PROJECTS = {"web", "admin"}
REQUIRED_IMAGE_SET = {"zenari-stage0-backend", "zenari-stage0-web", "zenari-stage0-admin"}
DEFAULT_SCANNED_IMAGES = {
    "zenari-stage0-backend:local-security-scan",
    "zenari-stage0-web:local-security-scan",
    "zenari-stage0-admin:local-security-scan",
}


class SecurityScanContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SecurityScanContractError(message)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path) -> str:
    require(path.exists(), f"missing {display_path(path)}")
    return path.read_text(encoding="utf-8")


def require_text(path: Path, snippets: tuple[str, ...]) -> str:
    text = read_text(path)
    for snippet in snippets:
        require(snippet in text, f"{display_path(path)} missing required snippet {snippet!r}")
    return text


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path))
    except json.JSONDecodeError as exc:
        raise SecurityScanContractError(f"{display_path(path)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{display_path(path)} must contain a JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{display_path(path)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.security_scan.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "security_scan_local_contract", "fixture kind mismatch")
    require(data.get("blueprint_source") == "Docs/Stage1_20260621_blueprint.md", "fixture blueprint source mismatch")
    require(REQUIRED_BLUEPRINT_ITEMS <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")
    require(data.get("scan_script") == "scripts/security_scan_smoke.sh", "fixture scan_script mismatch")
    require(REQUIRED_PATTERN_IDS <= set(data.get("required_scan_patterns") or []), "fixture scan patterns incomplete")
    require(data.get("required_go_toolchain") == "go1.26.4", "fixture required_go_toolchain mismatch")

    coverage = data.get("stage1_security_coverage")
    require(isinstance(coverage, dict), "stage1_security_coverage must be object")
    require(REQUIRED_COVERAGE <= set(coverage), "fixture Stage 1 coverage incomplete")
    for key in REQUIRED_COVERAGE:
        require(isinstance(coverage.get(key), str) and coverage[key], f"coverage {key} must be non-empty")

    tests = set(data.get("required_backend_tests") or [])
    for test_name in (
        "TestRedactStringHandlesProviderKeysAndInlineAssignments",
        "TestRedactStringCoversRawJSONPayloads",
        "TestValidateManifestRejectsSignedURLAndSecretLikeFields",
        "TestVisualAssetRejectsUnsafeStorageRefsSecretsAndRawPayload",
        "TestNormalizeAndRedactCoversProjectTaskBatchAssetExportBillingAndSecrets",
        "TestOpenAICompatibleProviderHTTPErrorDoesNotLeakSecretOrBody",
        "TestStripeHandleWebhookRejectsInvalidSignature",
        "TestStripeHandleWebhookRejectsLiveModeEventInTestMode",
    ):
        require(test_name in tests, f"fixture required_backend_tests missing {test_name}")

    report = data.get("report_contract")
    require(isinstance(report, dict), "report_contract must be object")
    require(report.get("kind") == "security_scan", "report kind mismatch")
    require(set(report.get("checks") or []) == REQUIRED_REPORT_CHECKS, "report checks mismatch")
    dependency_audit = report.get("dependency_audit")
    require(isinstance(dependency_audit, dict), "report dependency_audit must be object")
    require(dependency_audit.get("npm_audit_level") == "moderate", "dependency audit level mismatch")
    require(set(dependency_audit.get("required_npm_audit_projects") or []) == REQUIRED_NPM_AUDIT_PROJECTS, "dependency audit projects mismatch")
    image_scan = report.get("image_scan")
    require(isinstance(image_scan, dict), "report image_scan must be object")
    require(set(image_scan.get("required_image_set") or []) == REQUIRED_IMAGE_SET, "image scan required image set mismatch")
    require(set(image_scan.get("default_scanned_images") or []) == DEFAULT_SCANNED_IMAGES, "image scan default scanned image tags mismatch")
    require(image_scan.get("allows_cached_trivy_db_for_local_evidence") is True, "local security scan must allow cached Trivy DB")
    require(image_scan.get("strict_production_requires_fresh_trivy_db") is True, "production security scan must require fresh Trivy DB")
    for field in (
        "stage1_security_coverage",
        "stage1_secret_scan_patterns",
        "scan_contract.dependency_scan.npm_audit_level",
        "scan_contract.dependency_scan.required_npm_audit_projects",
        "scan_contract.docker_image_scan.required_image_set",
        "scan_contract.docker_image_scan.scanned_images",
        "scan_contract.docker_image_scan.trivy_skip_db_update",
        "scan_contract.docker_image_scan.trivy_db_updated_at",
        "scan_contract.secret_scan.pattern_ids",
        "scan_contract.secret_scan.allowlisted_test_fixture_paths",
        "production_gate",
    ):
        require(field in set(report.get("required_fields") or []), f"report required_fields missing {field}")
    require(str(report.get("production_gate", "")).startswith("open_until_"), "production gate must remain open")

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_security_scan_contract") == "pass", "local contract status mismatch")
    require(status.get("strict_staging_security_scan_evidence") == "open", "strict staging evidence must remain open")
    require(status.get("production_security_launch_checks") == "open", "production security checks must remain open")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")


def validate_scan_script() -> None:
    text = require_text(
        SECURITY_SCAN,
        (
            "stage1_security_coverage",
            "stage1_secret_scan_patterns",
            "openai_key_shape",
            "zai_key_shape",
            "stripe_key_shape",
            "stripe_publishable_key_shape",
            "stripe_webhook_secret_shape",
            "github_token_shape",
            "[0-9a-f]{32}",
            "whsec_",
            "pk_(live|test)",
            "allowlisted_test_fixture_paths",
            "backend/internal/security/redact_test.go",
            "backend/internal/billing/stripe_webhook_test.go",
            "required_image_set",
            "RELEASE_IMAGE_SET",
            "zenari-stage0-backend:local-security-scan",
            "scanned_images",
            "TRIVY_SKIP_DB_UPDATE",
            'TRIVY_SKIP_DB_UPDATE="${TRIVY_SKIP_DB_UPDATE:-1}"',
            "TRIVY_SKIP_JAVA_DB_UPDATE",
            "TRIVY_DB_REPOSITORIES",
            "trivy_db_updated_at",
            "required_npm_audit_projects",
            "npm_audit_level",
            "npm audit --audit-level=moderate --json",
            "\"web\", \"admin\"",
            "\"moderate\", \"high\", \"critical\"",
            "missing npm audit vulnerability metadata",
            "npm audit moderate+ dependency scan failed",
            "production_gate",
            "open_until_production_release_security_launch_checks_attach_strict_secret_rbac_csrf_csp_rate_limit_provider_stripe_evidence",
            "private_beta_gate",
            "open_until_dependency_image_secret_scans_run_in_staging_release_context",
        ),
    )
    for surface in REQUIRED_COVERAGE:
        require(f'"{surface}"' in text, f"security scan script missing Stage 1 surface {surface}")
    require("git grep -nE \"$SECRET_PATTERN\"" in text, "security scan must use named SECRET_PATTERN grep")


def validate_security_redaction() -> None:
    require_text(
        SECURITY,
        (
            "SecretKindProviderKey",
            "SecretKindWebhookSecret",
            "SecretKindSignedURL",
            '"zai_key"',
            '"stripe_key"',
            '"stripe_webhook_secret"',
            "RedactString",
            "ClassifyString",
            "ClassifyValue",
            "SecretKindSignedURL",
            "signedDeliveryAssignmentPattern",
            "x-amz-signature",
            "googleaccessid",
            "Redacted",
        ),
    )
    require_text(
        SECURITY_TEST,
        (
            "TestRedactStringHandlesProviderKeysAndInlineAssignments",
            "strings.Repeat(\"a\", 32) + \".\" + strings.Repeat(\"b\", 16)",
            "assertSignal(t, findings, \"zai_key\")",
            '"rk_live_" + "abcdefghijklmnop"',
            "TestRedactStringCoversRawJSONPayloads",
            "TestRedactStringCoversLaunchProviderAndCommerceTokens",
            '"stripe_webhook=" + "whsec_"',
            "TestRedactValueCoversHeadersAndStringSlices",
            "TestRedactValueCoversLaunchMetadataContainers",
            "TestClassifyValueCoversLaunchMetadataContainers",
            "support_context",
            "download_url",
            "X-Amz-Signature",
            '"whsec_" + "abcdefghijklmnopqrstuvwxyz123456"',
        ),
    )


def validate_stage1_code_anchors() -> None:
    require_text(GO_MOD, ("go 1.26.4",))
    dockerfile_text = require_text(DOCKERFILE, ("gcr.io/distroless/static-debian12:nonroot AS runtime-base",))
    require(
        re.search(r"^FROM golang:1\.26\.4-[A-Za-z0-9_.-]+ AS build$", dockerfile_text, flags=re.MULTILINE) is not None,
        "backend/Dockerfile must pin the Go build image to golang:1.26.4-*",
    )
    require_text(
        PROVIDER_OPENAI,
        (
            "OpenAICompatibleProvider",
            "Authorization",
            "Bearer \"+strings.TrimSpace(cfg.APIKey)",
            "security.RedactString",
            "prompt_hash",
            "generated_text",
            "openai_compatible_chat_completions_v1",
        ),
    )
    require_text(
        PROVIDER_OPENAI_TEST,
        (
            "TestOpenAICompatibleProviderHTTPErrorDoesNotLeakSecretOrBody",
            "fakeZAIKey()",
            "strings.Contains(message, key)",
            "authorization",
            "error leaked secret-bearing detail",
        ),
    )
    for path, snippets in {
        PROVIDER_EDIT: (
            "raw_payload_allowed",
            "raw_payload_persisted",
            "security.RedactString(strings.TrimSpace(input.Prompt))",
            "security.ClassifyValue",
            "secret-like edit adapter input",
            "secret-like edit result field",
        ),
        PROVIDER_VIDEO: (
            "raw_payload_allowed",
            "raw_payload_persisted",
            "security.RedactString(strings.TrimSpace(input.Prompt))",
            "security.ClassifyValue",
            "secret-like video adapter input",
            "secret-like video result field",
        ),
    }.items():
        require_text(path, snippets)

    require_text(
        BILLING_CHECKOUT,
        (
            "SecretKey",
            "WebhookSecret",
            "PublishableKey",
            "stripe checkout response livemode=true while STRIPE_MODE=test",
            "stripe portal response livemode=true while STRIPE_MODE=test",
            "stripe subscription response livemode=true while STRIPE_MODE=test",
            "stripe invoice response livemode=true while STRIPE_MODE=test",
            "Authorization",
            "Bearer \"+a.Config.SecretKey",
        ),
    )
    require_text(
        BILLING_WEBHOOK,
        (
            "verifyStripeWebhookSignature",
            "hmac.New(sha256.New, []byte(secret))",
            "stripe webhook livemode=true while STRIPE_MODE=test",
            "ON CONFLICT (id) DO NOTHING",
            "StripeWebhookEvent",
            "Raw            json.RawMessage",
        ),
    )
    require_text(
        BILLING_LIFECYCLE,
        (
            "SecretMaterialProjected  bool",
            "SecretMaterialProjected: false",
            "WebhookReplayIdempotent",
            "ReadyForStagingEvidence",
            "ReleaseGateStatus",
        ),
    )
    require_text(
        BILLING_WEBHOOK_TEST,
        (
            "TestStripeHandleWebhookRejectsInvalidSignature",
            "TestStripeHandleWebhookRejectsLiveModeEventInTestMode",
            "whsec_local_webhook_secret",
            "stripeTestSignature",
        ),
    )
    require_text(
        BATCH_EXECUTOR,
        (
            "security.RedactString",
            "sanitizeExecutionMessage",
            "providerInvokeFailure",
            "request_hash",
            "PersistBatchChildResult",
        ),
    )
    require_text(
        BATCH_RESULT_SINK,
        (
            "raw_payload_persisted",
            '"raw_provider_payload_saved": false',
            '"trace_projection"',
            "tracepkg.BuildTraceProjection",
            "providerOutputSignature",
            "ProviderRequestHash",
        ),
    )
    require_text(
        ASSETS,
        (
            "ValidateStorageRef",
            "RawPayloadPersisted",
            "raw provider payload must not be persisted",
            "object_key must not contain query or fragment",
            "object_key must be a storage key, not a URL",
            "secret-like asset field",
            "security.ClassifyValue",
        ),
    )
    require_text(
        ASSETS_TEST,
        (
            "TestVisualAssetRejectsUnsafeStorageRefsSecretsAndRawPayload",
            "query or fragment",
            "provider_payload",
            "api_key",
            "RawPayloadPersisted = true",
        ),
    )
    require_text(
        SUPPORT,
        (
            "NormalizeAndRedact",
            "security.RedactString(strings.TrimSpace(body))",
            "security.RedactMap(metadata)",
            "ProjectID",
            "TaskID",
            "BatchID",
            "TraceID",
            "AssetID",
            "LinkedExportID",
            "QuotaBucketID",
            "BillingReferenceID",
        ),
    )
    require_text(
        SUPPORT_TEST,
        (
            "TestNormalizeAndRedactCoversProjectTaskBatchAssetExportBillingAndSecrets",
            "X-Amz-Signature",
            "api_key",
            "analytics properties leaked metadata secret",
        ),
    )
    require_text(
        EXPORT,
        (
            "ValidateManifest",
            "ValidateFileEntry",
            "secret-like export manifest field",
            "secret-like export file field",
            "object_key must be a storage key without query or fragment",
            "DownloadEnabled = false",
            "RawPayloadSafe: true",
        ),
    )
    require_text(EXPORT_TEST, ("TestValidateManifestRejectsSignedURLAndSecretLikeFields", "Bearer abcdefghijklmnop", "X-Amz-Signature"))
    require_text(
        TRACE,
        (
            "forbiddenProjectionKeys",
            "provider_payload",
            "raw_provider_payload",
            "raw_prompt",
            "raw_safety_payload",
            "authorization",
            "api_key",
            "security.ClassifyString",
            "security.ClassifyValue",
            "RawProviderPayloadSaved",
            "RawSafetyPayloadProjected",
        ),
    )
    require_text(TRACE_TEST, ("TestBuildTraceProjectionRejectsSecretsAndForbiddenFields", "ValidateUserExportProjection", "raw_provider_payload_saved"))


def validate_rate_limit_bridge() -> None:
    data = load_json(RATE_LIMIT_FIXTURE)
    explainable_error = data.get("explainable_error_contract")
    require(isinstance(explainable_error, dict), "rate-limit fixture missing explainable_error_contract")
    audit_flags = explainable_error.get("audit_metadata_flags")
    require(isinstance(audit_flags, dict), "rate-limit fixture missing audit_metadata_flags")
    for key in ("raw_prompt_included", "raw_provider_payload", "raw_secret_projection"):
        require(audit_flags.get(key) is False, f"rate-limit {key} must remain false")


def validate_wiring_and_inventory() -> None:
    require_text(BLUEPRINT, ("| BE-2 |", "| BE-11 |", "| QA-8 |", "| OP-13 |"))
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_security_scan_contract.py",
            "python3 scripts/validate_stage1_security_scan_contract.py",
            "run_node_audit_gate web",
            "run_node_audit_gate admin",
            "missing npm audit vulnerability metadata",
        ),
    )
    require_text(
        GAP_INVENTORY,
        (
            "VF-5f",
            "validate_stage1_security_scan_contract.py",
            "fixtures/stage1/security_scan/local_contract.json",
            "QA-8",
            "z.ai/OpenAI-compatible key shape",
            "Go 1.26.4",
            "Production security launch checks remain open",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_scan_script()
    validate_security_redaction()
    validate_stage1_code_anchors()
    validate_rate_limit_bridge()
    validate_wiring_and_inventory()


def main() -> int:
    try:
        validate()
    except SecurityScanContractError as exc:
        print(f"stage1 security scan contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 security scan contract validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
