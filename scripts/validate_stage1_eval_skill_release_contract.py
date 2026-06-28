#!/usr/bin/env python3
"""Validate Stage 1 QA-6/QA-7 eval and skillbook local contract anchors."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "stage1" / "eval_skill_release" / "local_contract.json"
EVAL_CODE = ROOT / "backend" / "internal" / "eval" / "eval.go"
EVAL_TEST = ROOT / "backend" / "internal" / "eval" / "eval_test.go"
SKILLBOOK_CODE = ROOT / "backend" / "internal" / "skillbook" / "skillbook.go"
SKILLBOOK_TEST = ROOT / "backend" / "internal" / "skillbook" / "skillbook_test.go"
ADMIN_FIXTURE = ROOT / "fixtures" / "stage1" / "skill_eval_release" / "local_contract.json"
ADMIN_VALIDATOR = ROOT / "scripts" / "validate_stage1_skill_eval_release_contract.py"
GAP_INVENTORY = ROOT / "Docs" / "researches" / "stage1_gap_inventory.md"
REPO_VALIDATE = ROOT / "scripts" / "repo_validate.sh"

RAW_SECRET_RE = re.compile(
    r"(?i)(sk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}|"
    r"pk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|"
    r"[0-9a-f]{32}\.[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._~+/\-=]{8,})"
)

REQUIRED_SUITES = {
    "batch_generation",
    "provider_routing",
    "edit_tools",
    "export",
    "billing_quota",
    "safety",
}

FORBIDDEN_PROJECTION_FIELDS = {
    "prompt_fragment",
    "prompt_fragments",
    "internal_prompt",
    "hidden_policy",
    "raw_prompt",
    "provider_payload",
    "safety_payload",
}


class EvalSkillReleaseContractError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise EvalSkillReleaseContractError(message)


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
        raise EvalSkillReleaseContractError(f"{path.relative_to(ROOT)} invalid JSON: {exc}") from exc
    require(isinstance(data, dict), f"{path.relative_to(ROOT)} must contain JSON object")
    require(not RAW_SECRET_RE.search(json.dumps(data, ensure_ascii=False)), f"{path.relative_to(ROOT)} contains raw secret-looking material")
    return data


def validate_fixture() -> None:
    data = load_json(FIXTURE)
    require(data.get("schema_version") == "stage1.eval_skill_release.contract.v1", "fixture schema_version mismatch")
    require(data.get("kind") == "eval_skill_release_local_contract", "fixture kind mismatch")
    require({"QA-6", "QA-7", "AD-9", "VF-5"} <= set(data.get("blueprint_items") or []), "fixture blueprint_items incomplete")

    eval_contract = data.get("eval_contract")
    require(isinstance(eval_contract, dict), "eval_contract must be object")
    require(eval_contract.get("package") == "backend/internal/eval", "eval package mismatch")
    require(set(eval_contract.get("required_suites") or []) == REQUIRED_SUITES, "required suite set mismatch")
    require(
        set(eval_contract.get("required_functions") or [])
        == {
            "RequiredSuites",
            "ValidateSuite",
            "ValidateFixture",
            "ValidateStoredResult",
            "GateResults",
            "SafeResultProjection",
            "StableHash",
        },
        "eval required functions mismatch",
    )
    for requirement in (
        "pass_or_fail_status",
        "deterministic_runner_sha256",
        "source_fixture_digest",
        "trace_export_qa_safety_coverage",
        "fixture_coverage",
        "read_without_eval_rerun",
        "no_critical_safety_regressions_for_pass",
        "secret_like_summary_runner_storage_rejection",
    ):
        require(requirement in eval_contract.get("stored_result_requirements", []), f"missing eval requirement {requirement}")

    skillbook = data.get("skillbook_contract")
    require(isinstance(skillbook, dict), "skillbook_contract must be object")
    require(skillbook.get("package") == "backend/internal/skillbook", "skillbook package mismatch")
    require(set(skillbook.get("required_functions") or []) == {"EvaluateReleaseGate", "ProjectForUser"}, "skillbook function set mismatch")
    for requirement in (
        "version_status_active_or_canary",
        "review_passed",
        "latest_eval_passed",
        "eval_contract_complete",
        "canary_gate_passed_for_canary",
        "rollback_target_required_for_active",
        "no_critical_safety_regressions",
        "no_internal_prompt_fragments_projected",
        "no_hidden_policy_projected",
        "no_secret_like_template_metadata",
    ):
        require(requirement in skillbook.get("user_visible_requirements", []), f"missing skillbook requirement {requirement}")

    require(not (FORBIDDEN_PROJECTION_FIELDS & set(data.get("safe_user_projection_fields") or [])), "safe user projection includes forbidden fields")
    require(FORBIDDEN_PROJECTION_FIELDS <= set(data.get("forbidden_user_projection_fields") or []), "forbidden projection fields incomplete")

    status = data.get("non_launch_status")
    require(isinstance(status, dict), "non_launch_status must be object")
    require(status.get("local_eval_skill_release_contract") == "pass", "local contract status mismatch")
    require(status.get("staging_skill_release_eval_canary_evidence") == "open", "staging evidence must remain open")
    require(status.get("production_skill_canary_evidence") == "open", "production evidence must remain open")
    require(status.get("can_clear_stage1_safety_qa_gate") is False, "local contract must not clear safety/QA gate")
    require(status.get("can_clear_stage1_staging_runtime_gate") is False, "local contract must not clear staging gate")
    require(status.get("can_clear_stage1_production_launch_gate") is False, "local contract must not clear production gate")


def validate_eval_code() -> None:
    text = require_text(
        EVAL_CODE,
        (
            "package eval",
            "SuiteBatchGeneration",
            "SuiteProviderRouting",
            "SuiteEditTools",
            "SuiteExport",
            "SuiteBillingQuota",
            "SuiteSafety",
            "type Suite struct",
            "type Fixture struct",
            "type Result struct",
            "type Coverage struct",
            "type GateSummary struct",
            "func RequiredSuites",
            "func ValidateSuite",
            "func ValidateFixture",
            "func ValidateStoredResult",
            "func GateResults",
            "func SafeResultProjection",
            "func StableHash",
            "ReadWithoutEvalRerun",
            "CriticalSafetyRegressions",
            "TraceComplete",
            "ExportGateComplete",
            "QAComplete",
            "SafetyComplete",
            "SourceFixtureDigest",
            "RunnerSHA256",
            "readable without rerun",
            "coverage",
            "critical_safety_regressions",
            "func safeSummaryProjection",
            "security.IsSensitiveKey",
            "secret-like eval result field",
            "secret-like eval projection field",
        ),
    )
    for suite in REQUIRED_SUITES:
        require(f'"{suite}"' in text, f"eval code missing suite literal {suite}")


def validate_skillbook_code() -> None:
    text = require_text(
        SKILLBOOK_CODE,
        (
            "package skillbook",
            "VersionCanary",
            "VersionActive",
            "ReviewPassed",
            "type SkillTemplate struct",
            "type Version struct",
            "type ReleaseGate struct",
            "type UserProjection struct",
            "func EvaluateReleaseGate",
            "func ProjectForUser",
            "review_not_passed",
            "eval_gate_not_passed",
            "canary_gate_not_passed",
            "rollback_target_required",
            "critical_safety_regressions",
            "internal_prompt_fragments_not_projectable",
            "secret_like_skill_metadata",
            "PromptFragments",
            "InternalPrompt",
            "HiddenPolicy",
        ),
    )
    user_projection_block = text[text.index("type UserProjection struct") : text.index("var ErrValidation")]
    for forbidden in ("PromptFragments", "InternalPrompt", "HiddenPolicy", "RawPrompt", "ProviderPayload", "SafetyPayload"):
        require(forbidden not in user_projection_block, f"UserProjection must not expose {forbidden}")


def validate_tests() -> None:
    require_text(
        EVAL_TEST,
        (
            "TestGateResultsRequiresAllStage1Suites",
            "TestGateResultsBlocksMissingSuiteFailedStatusAndSafetyRegression",
            "TestValidateStoredResultRequiresCoverageRunnerDigestAndStoredRead",
            "TestSafeResultProjectionRedactsSummaryAndRejectsSecretLikeFields",
            "missing_suite_safety",
            "suite_billing_quota_not_pass",
            "critical_safety_regressions",
            "without rerun",
            "api_key",
            "kept api_key field",
        ),
    )
    require_text(
        SKILLBOOK_TEST,
        (
            "TestProjectForUserAllowsReviewedEvalPassedActiveVersion",
            "TestProjectForUserAllowsPassedCanaryVersion",
            "TestProjectForUserBlocksReviewEvalCanaryAndRollbackFailures",
            "TestProjectForUserDoesNotExposePromptFragmentsOrHiddenPolicies",
            "TestProjectForUserRejectsSecretLikeTemplateMetadata",
            "safe projection without internal fields",
            "review_not_passed",
            "eval_gate_not_passed",
            "canary_gate_not_passed",
            "rollback_target_required",
            "internal_prompt_fragments_not_projectable",
            "Bearer abcdefghijklmnop",
        ),
    )


def validate_admin_bridge() -> None:
    data = load_json(ADMIN_FIXTURE)
    require(data.get("schema_version") == "stage1.skill_eval_release.contract.v1", "admin skill/eval fixture schema mismatch")
    require({"AD-9", "QA-6", "QA-7"} <= set(data.get("blueprint_items") or []), "admin skill/eval fixture must still bridge QA-6/QA-7")
    require_text(
        ADMIN_VALIDATOR,
        (
            "validate Stage 1 AD-9 skill/eval release API/UI contract anchors".replace("validate", "Validate"),
            "can_clear_skill_release_eval_canary_gate",
            "read_without_eval_rerun",
        ),
    )


def validate_inventory_and_repo_validate() -> None:
    require_text(
        GAP_INVENTORY,
        (
            "QA-6",
            "QA-7",
            "VF-5e",
            "validate_stage1_eval_skill_release_contract.py",
            "fixtures/stage1/eval_skill_release/local_contract.json",
            "backend/internal/eval",
            "backend/internal/skillbook",
            "staging and production skill release/eval/canary evidence remain open",
        ),
    )
    require_text(
        REPO_VALIDATE,
        (
            "test -x scripts/validate_stage1_eval_skill_release_contract.py",
            "python3 scripts/validate_stage1_eval_skill_release_contract.py",
        ),
    )


def validate() -> None:
    validate_fixture()
    validate_eval_code()
    validate_skillbook_code()
    validate_tests()
    validate_admin_bridge()
    validate_inventory_and_repo_validate()


def main() -> int:
    try:
        validate()
    except EvalSkillReleaseContractError as exc:
        print(f"stage1 eval skill release contract validation failed: {exc}", file=sys.stderr)
        return 1
    print("stage1 eval skill release contract passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
